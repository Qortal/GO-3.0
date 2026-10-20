/**
 * `better-sqlite3` stand-in backed by the official @sqlite.org/sqlite-wasm
 * build with its OPFS SyncAccessHandle-pool VFS: real persistent SQLite,
 * fully synchronous, inside a dedicated worker — the same execution model the
 * chat engine was written against.
 *
 * Only the surface the chat DB and resource store use is implemented:
 * prepare (run/get/all with positional or @named binds), exec, pragma,
 * transaction, close. The OPFS VFS has no shared memory, so WAL runs with an
 * exclusive lock (SQLite then keeps the WAL index in heap memory). That
 * allows one connection per file, which is all the engine opens; a second
 * one in the same worker is refused (see openDatabases).
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { noteSqliteCommit } from '../engineIoStats';
import { log as logInfo, warn as logWarn } from './logger';

let sqlite3: any = null;
let poolUtil: any = null;

/** Startup slower than this is logged (only logged: see initMobileSqlite). */
const SLOW_INIT_MS = 4_000;

/**
 * GrapheneOS lets users turn off the WebView JIT per app or globally (many
 * do as part of hardening). WebAssembly then runs in the DrumBrake
 * interpreter, or is unavailable on Vanadium builds older than 141 that have
 * no interpreter. This hint is only for the second case, where WebAssembly
 * is missing or fails to load.
 */
const WEBVIEW_JIT_HINT =
  'On GrapheneOS check Settings > Apps > Qortal GO > Exploit protection and make sure "WebView JIT" is allowed, then reopen the app.';

/** Must resolve before any Database is constructed. */
export async function initMobileSqlite(): Promise<void> {
  if (poolUtil) return;
  // Name the platform gaps explicitly. Without these checks the failure was a
  // deep stack trace from inside the wasm loader that told the user nothing.
  if (typeof WebAssembly === 'undefined') {
    throw new Error(
      `WebAssembly is disabled in this WebView, so chat history storage cannot start. ${WEBVIEW_JIT_HINT}`
    );
  }
  const storage = (globalThis as any).navigator?.storage;
  if (!storage || typeof storage.getDirectory !== 'function') {
    throw new Error(
      'Private file storage (OPFS) is unavailable in this WebView, so chat history cannot be stored.'
    );
  }
  const startedAt = Date.now();
  try {
    sqlite3 = await sqlite3InitModule({
      print: () => {},
      printErr: (msg: string) => console.warn('[sqlite-wasm]', msg),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isWasmFailure =
      (typeof WebAssembly !== 'undefined' &&
        (err instanceof WebAssembly.CompileError ||
          err instanceof WebAssembly.LinkError ||
          err instanceof WebAssembly.RuntimeError)) ||
      /webassembly|wasm/i.test(message);
    throw new Error(
      isWasmFailure
        ? `The chat database engine (WebAssembly) could not be loaded in this WebView: ${message}. ${WEBVIEW_JIT_HINT}`
        : `The chat database engine failed to load: ${message}`
    );
  }
  poolUtil = await sqlite3.installOpfsSAHPoolVfs({
    name: 'qgo-sql',
    directory: '.qgo-sqlite',
    initialCapacity: 16,
  });
  await ensureFreePoolSlots();
  const elapsed = Date.now() - startedAt;
  // Always report the timing for Copy diagnostics. It is not a JIT signal:
  // Vanadium's DrumBrake interpreter starts sqlite-wasm in 100-136 ms with
  // JIT off, as fast as with JIT.
  try {
    (self as unknown as Worker).postMessage({
      t: 'engine-timing',
      sqliteInitMs: elapsed,
    });
  } catch {
    /* not inside a worker */
  }
  if (elapsed > SLOW_INIT_MS) {
    // Log only. The old user hint here ("usually means no JIT") could not
    // fire with JIT off on Vanadium and would blame JIT for a slow disk or a
    // busy phone; Copy diagnostics reads GrapheneOS's own JIT flag instead.
    console.warn(`[sqlite-wasm] slow_init ms=${elapsed}`);
  }
}

/**
 * Free SAH-pool slots wanted before any database opens. In WAL mode every
 * open database keeps a second file (<name>-wal) in the pool, and the switch
 * into WAL briefly needs a rollback journal. A database already in WAL mode
 * whose -wal cannot be created cannot be read at all, so the slots are added
 * here, where waiting is possible, rather than found missing on a write.
 * initialCapacity only applies to a brand-new pool: phones that already have
 * one keep the capacity it was created with.
 */
const MIN_FREE_POOL_SLOTS = 8;

async function ensureFreePoolSlots(): Promise<void> {
  const free = freePoolSlots();
  if (free >= MIN_FREE_POOL_SLOTS) return;
  try {
    await poolUtil.addCapacity(MIN_FREE_POOL_SLOTS - free);
  } catch (err) {
    // Not fatal: a database that cannot get its -wal slot stays in its
    // rollback journal (see Database.applyJournalMode).
    logWarn(
      `[sqlite-wasm] pool_capacity_failed free=${free} error=${errorToken(err)}`
    );
  }
}

function freePoolSlots(): number {
  try {
    return poolUtil.getCapacity() - poolUtil.getFileCount();
  } catch {
    return 0;
  }
}

function poolHasFile(path: string): boolean {
  try {
    return poolUtil.getFileNames().includes(path);
  } catch {
    return false;
  }
}

/** Files SQLite keeps next to a database in this pool. */
const SIDECAR_SUFFIXES = ['-wal', '-journal'] as const;

/**
 * Size the -wal file is cut back to after a checkpoint. A normal WAL stays
 * under the default autocheckpoint (1,000 pages, 8 MB at sqlite-wasm's 8 KB
 * pages), so this only shrinks it after one very large transaction (a
 * migration or an index rebuild) instead of keeping that size forever.
 */
const WAL_SIZE_LIMIT_BYTES = 16 * 1024 * 1024;

/**
 * Whether a database that asks for WAL gets it. With this off, a file already
 * in WAL mode is converted back to the rollback journal when the engine asks
 * for WAL. Reading a WAL file at all needs the exclusive lock the constructor
 * takes, so a build that turns this off must keep taking it.
 */
let walEnabled = true;

/** Tests only: build with WAL off (the way back from WAL). */
export function __setMobileSqliteWalForTests(enabled: boolean): void {
  walEnabled = enabled;
}

/** `journal_mode = WAL` as the engine (and better-sqlite3 users) write it. */
const WAL_REQUEST_RE = /^\s*journal_mode\s*=\s*['"]?wal['"]?\s*;?\s*$/i;

/**
 * Prepared statements kept per connection. The engine re-runs a few hundred
 * distinct statements, and preparing one again on every call is pure parse
 * cost, which is high with the WebView JIT off. Beyond this many, the least
 * recently used are finalized.
 */
const STATEMENT_CACHE_MAX = 256;

/** Bind parameter names per prepared statement (index 0 = parameter 1). */
const paramNamesByStmt = new WeakMap<object, Array<string | null>>();

function paramNames(stmt: any): Array<string | null> {
  let names = paramNamesByStmt.get(stmt);
  if (!names) {
    const count = sqlite3.capi.sqlite3_bind_parameter_count(stmt.pointer);
    names = [];
    for (let i = 1; i <= count; i++) {
      names.push(
        sqlite3.capi.sqlite3_bind_parameter_name(stmt.pointer, i) || null
      );
    }
    paramNamesByStmt.set(stmt, names);
  }
  return names;
}

function finalizeQuietly(stmt: any): void {
  try {
    stmt.finalize();
  } catch {
    /* already finalized, or its connection is gone */
  }
}

/** A short token for log lines: the SQLite code if there is one. */
function errorToken(err: unknown): string {
  const message = String(
    (err as { message?: unknown } | null)?.message ?? err ?? ''
  );
  const code = /SQLITE_[A-Z_]+/.exec(message)?.[0];
  if (code) return code;
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name ? name : 'error';
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * Databases open in this worker, by pool file name. With WAL and the
 * exclusive lock each connection keeps its own in-memory WAL index, and the
 * pool VFS's locks do nothing; a second connection to the same file would
 * write over the first one's WAL frames and corrupt the database. So opening
 * a file that is already open here is refused instead.
 */
const openDatabases = new Map<string, Database>();

export type MobileSqliteDatabaseStats = {
  name: string;
  journalMode: string;
  statementsCached: number;
  statementHits: number;
  statementMisses: number;
};

export type MobileSqliteStats = {
  pool: { capacity: number; files: number } | null;
  databases: MobileSqliteDatabaseStats[];
};

/** For diagnostics: pool use and, per open database, journal mode and statement cache. */
export function getMobileSqliteStats(): MobileSqliteStats {
  let pool: { capacity: number; files: number } | null = null;
  try {
    if (poolUtil) {
      pool = {
        capacity: poolUtil.getCapacity(),
        files: poolUtil.getFileCount(),
      };
    }
  } catch {
    pool = null;
  }
  return {
    pool,
    databases: [...openDatabases.values()].map((db) => db.stats()),
  };
}

/**
 * The engine worker runs SQLite synchronously, so a slow statement blocks
 * every other request queued behind it. Anything past this threshold is worth
 * seeing in the log.
 */
const SLOW_STATEMENT_MS = 150;

function trackStatement<T>(sql: string, run: () => T): T {
  const startedAt = Date.now();
  try {
    return run();
  } finally {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= SLOW_STATEMENT_MS) {
      // Through the engine logger, so it reaches Copy diagnostics (the boot
      // buffer keeps only the first few; see bootFaultRepeatKey).
      logWarn(
        `[sqlite-wasm] slow_statement ms=${elapsed} sql=${sql
          .replace(/\s+/g, ' ')
          .slice(0, 200)}`
      );
    }
  }
}

/**
 * SQLite result codes that mean the file itself is inconsistent. Primary code
 * 11 (SQLITE_CORRUPT) plus its extended forms: 267 (CORRUPT_VTAB), 523
 * (CORRUPT_SEQUENCE), 779 (CORRUPT_INDEX).
 */
function isCorruptionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = Number((err as { resultCode?: unknown }).resultCode);
  if (Number.isFinite(code) && (code & 0xff) === 11) return true;
  return /SQLITE_CORRUPT|database disk image is malformed/i.test(
    String((err as { message?: unknown }).message || '')
  );
}

/** How many in-place REINDEX repairs to attempt per session before giving up on the file. */
const MAX_REINDEX_REPAIRS = 3;

export class DatabaseRebuiltError extends Error {
  constructor(name: string) {
    super(
      `SQLite file ${name} was unrecoverably corrupt and has been discarded; the engine must restart`
    );
    this.name = 'DatabaseRebuiltError';
  }
}

function toBindValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  return value;
}

class Statement {
  constructor(
    private readonly owner: Database,
    private readonly sql: string
  ) {}

  private get db(): any {
    return this.owner.handle();
  }

  private withStmt<T>(params: unknown[], fn: (stmt: any) => T): T {
    return this.owner.guarded(this.sql, () => {
      const stmt = this.owner.acquireStatement(this.sql);
      let ok = false;
      try {
        this.bindParams(stmt, params);
        const result = fn(stmt);
        ok = true;
        return result;
      } finally {
        this.owner.releaseStatement(this.sql, stmt, ok);
      }
    });
  }

  private bindParams(stmt: any, params: unknown[]): void {
    if (params.length === 0) return;
    const single = params[0];
    const isNamedObject =
      params.length === 1 &&
      single !== null &&
      typeof single === 'object' &&
      !(single instanceof Uint8Array) &&
      !Array.isArray(single);

    if (isNamedObject) {
      const source = single as Record<string, unknown>;
      // Read once per prepared statement: a cached statement is bound many
      // times, and each name lookup is a call into wasm.
      const names = paramNames(stmt);
      for (let i = 1; i <= names.length; i++) {
        const name = names[i - 1];
        if (!name) continue;
        const bare = name.slice(1); // strip @ : $ prefix
        if (bare in source) {
          stmt.bind(i, toBindValue(source[bare]));
        } else if (name in source) {
          stmt.bind(i, toBindValue(source[name]));
        } else {
          throw new Error(`Missing named parameter "${bare}"`);
        }
      }
      return;
    }

    const flat = params.length === 1 && Array.isArray(single) ? single : params;
    flat.forEach((value, idx) => {
      stmt.bind(idx + 1, toBindValue(value));
    });
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    return this.withStmt(params, (stmt) => {
      stmt.step();
      const changes = this.db.changes();
      // A write outside a transaction commits on its own (Copy diagnostics).
      if (changes > 0 && !this.owner.inTransaction) noteSqliteCommit();
      return {
        changes,
        lastInsertRowid: Number(
          sqlite3.capi.sqlite3_last_insert_rowid(this.db.pointer)
        ),
      };
    });
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    return this.withStmt(params, (stmt) => {
      if (!stmt.step()) return undefined;
      return stmt.get({}) as Record<string, unknown>;
    });
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    return this.withStmt(params, (stmt) => {
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) {
        rows.push(stmt.get({}) as Record<string, unknown>);
      }
      return rows;
    });
  }
}

type TransactionFn<T extends unknown[], R> = (...args: T) => R;

export class Database {
  private db: any;
  public open = true;
  public readonly name: string;
  private readonly flat: string;
  private reindexRepairs = 0;
  /** Set when corruption surfaced inside a transaction; repaired after rollback. */
  private repairPending = false;
  private rebuilt = false;
  /** Whether this connection holds the exclusive lock (see the constructor). */
  private exclusive = false;
  /** Journal mode as SQLite last reported it; 'unknown' until asked. */
  private journalMode = 'unknown';
  /**
   * Idle prepared statements by SQL text, least recently used first. A
   * statement is taken out while it runs, so a nested use of the same SQL
   * gets a fresh one instead of resetting it mid-step.
   */
  private readonly idleStatements = new Map<string, any>();
  private statementHits = 0;
  private statementMisses = 0;

  /** Raw sqlite-wasm handle; throws once the file has been discarded. */
  handle(): any {
    if (this.rebuilt) throw new DatabaseRebuiltError(this.name);
    return this.db;
  }

  /** A prepared statement for sql, ready to bind: the cached one or a new one. */
  acquireStatement(sql: string): any {
    const db = this.handle();
    const cached = this.idleStatements.get(sql);
    if (cached) {
      this.idleStatements.delete(sql);
      this.statementHits += 1;
      return cached;
    }
    this.statementMisses += 1;
    return db.prepare(sql);
  }

  /**
   * Called after every use. Only a statement that ran cleanly on a still-open
   * connection is kept, reset and with its binds cleared, so it holds no read
   * snapshot (which would stop checkpoints) and no bound blob. Anything else
   * is finalized, as every statement was before the cache.
   */
  releaseStatement(sql: string, stmt: any, ok: boolean): void {
    if (ok && this.open && !this.rebuilt && !this.idleStatements.has(sql)) {
      try {
        stmt.reset(true);
        this.idleStatements.set(sql, stmt);
        if (this.idleStatements.size > STATEMENT_CACHE_MAX) {
          const oldest = this.idleStatements.keys().next().value as string;
          finalizeQuietly(this.idleStatements.get(oldest));
          this.idleStatements.delete(oldest);
        }
        return;
      } catch {
        /* reset failed: finalize below */
      }
    }
    finalizeQuietly(stmt);
  }

  /**
   * Finalizes every cached statement. Needed before close: sqlite3_close_v2
   * leaves a connection with live statements open as a "zombie", which here
   * would keep the file (and its -wal) held until the worker dies.
   */
  private dropStatementCache(): void {
    for (const stmt of this.idleStatements.values()) finalizeQuietly(stmt);
    this.idleStatements.clear();
  }

  stats(): MobileSqliteDatabaseStats {
    return {
      name: baseName(this.name),
      journalMode: this.journalMode,
      statementsCached: this.idleStatements.size,
      statementHits: this.statementHits,
      statementMisses: this.statementMisses,
    };
  }

  /**
   * Runs one statement with corruption self-healing.
   *
   * Android kills the WebView freely, and this device's chat DB has already
   * been left with an index that disagrees with its table
   * (SQLITE_CORRUPT_INDEX). REINDEX rebuilds every index from table data,
   * which fixes exactly that class; the statement is then retried once. If
   * the file is beyond that, it is discarded and the engine is asked to
   * restart so history re-syncs from peers instead of failing forever.
   */
  guarded<T>(sql: string, run: () => T): T {
    try {
      return trackStatement(sql, run);
    } catch (err) {
      if (!isCorruptionError(err)) throw err;
      if (this.inTransaction) {
        // Cannot safely REINDEX mid-transaction; transaction() repairs after
        // the rollback and the caller's normal retry then succeeds.
        this.repairPending = true;
        throw err;
      }
      this.repair(err);
      try {
        return trackStatement(sql, run);
      } catch (retryErr) {
        if (isCorruptionError(retryErr)) this.discardAndRestart(retryErr);
        throw retryErr;
      }
    }
  }

  private repair(cause: unknown): void {
    if (this.rebuilt) return;
    if (this.reindexRepairs >= MAX_REINDEX_REPAIRS) {
      this.discardAndRestart(cause);
      return;
    }
    this.reindexRepairs += 1;
    // Nothing prepared before a corruption is trusted after it.
    this.dropStatementCache();
    const startedAt = Date.now();
    console.warn(
      `[sqlite-wasm] corruption detected in ${this.name} (attempt ${this.reindexRepairs}/${MAX_REINDEX_REPAIRS}); running REINDEX`,
      cause instanceof Error ? cause.message : cause
    );
    try {
      this.db.exec('REINDEX');
      console.warn(
        `[sqlite-wasm] REINDEX of ${this.name} completed in ${Date.now() - startedAt}ms`
      );
    } catch (reindexErr) {
      console.error(`[sqlite-wasm] REINDEX of ${this.name} failed`, reindexErr);
      this.discardAndRestart(reindexErr);
    }
  }

  /**
   * Last resort: the on-disk file is unrecoverable. Close it, drop it from
   * the SAH pool, and tell the main thread to restart the engine, which
   * recreates the schema on a fresh file. Throws DatabaseRebuiltError.
   */
  private discardAndRestart(cause: unknown): never {
    if (!this.rebuilt) {
      this.rebuilt = true;
      this.open = false;
      console.error(
        `[sqlite-wasm] ${this.name} is unrecoverably corrupt; discarding file and restarting engine`,
        cause instanceof Error ? cause.message : cause
      );
      if (openDatabases.get(this.flat) === this) {
        openDatabases.delete(this.flat);
      }
      this.dropStatementCache();
      try {
        this.db.close();
      } catch {
        /* already closed */
      }
      // The -wal and -journal go too: left behind, SQLite would replay the
      // corrupt file's pages into the fresh one of the same name. The main
      // file first; if the worker dies in between, the constructor removes
      // the orphans.
      for (const path of [
        this.flat,
        ...SIDECAR_SUFFIXES.map((suffix) => this.flat + suffix),
      ]) {
        try {
          poolUtil.unlink(path);
        } catch (unlinkErr) {
          console.error(
            '[sqlite-wasm] unlink after corruption failed',
            unlinkErr
          );
        }
      }
      try {
        (self as unknown as Worker).postMessage({
          t: 'db-rebuilt',
          name: this.name,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      } catch {
        /* not inside a worker (tests) */
      }
    }
    throw new DatabaseRebuiltError(this.name);
  }
  /**
   * Nesting depth of the connection's active transaction.
   *
   * SQLite allows one transaction per connection, so this has to be tracked
   * per Database rather than per transaction function: the engine routinely
   * calls one wrapped transaction from inside another, and each of those would
   * otherwise issue its own BEGIN.
   */
  private txDepth = 0;

  /**
   * True while the connection has an open transaction.
   *
   * Read from SQLite's autocommit flag rather than the depth counter so the
   * shim stays correct even when a transaction was opened by raw SQL that
   * never went through transaction().
   */
  get inTransaction(): boolean {
    try {
      return sqlite3.capi.sqlite3_get_autocommit(this.db.pointer) === 0;
    } catch {
      return this.txDepth > 0;
    }
  }

  constructor(filename: string, _options?: Record<string, unknown>) {
    if (!poolUtil) {
      throw new Error(
        'initMobileSqlite() must complete before opening databases'
      );
    }
    // The SAH pool VFS namespaces by filename only; flatten the virtual path.
    this.name = filename;
    this.flat = '/' + filename.replace(/^\/+/, '').replace(/[/\\]/g, '__');
    if (openDatabases.has(this.flat)) {
      throw new Error(
        `SQLite file ${filename} is already open in this worker; a second connection would corrupt it`
      );
    }
    this.removeOrphanSidecars();
    this.db = new poolUtil.OpfsSAHPoolDb(this.flat);
    // Before anything reads the file. Without shared memory SQLite can only
    // use WAL under the exclusive lock, and it cannot read a file that is
    // already in WAL mode without it either. Opening the database does not
    // read it yet, so this is in time on every open.
    this.exclusive = this.setLockingMode('exclusive');
    openDatabases.set(this.flat, this);
  }

  /**
   * A -wal or -journal whose database is gone is left from a discard that
   * was cut short. SQLite would replay it into the new, empty file of the
   * same name, bringing the discarded pages straight back.
   */
  private removeOrphanSidecars(): void {
    if (poolHasFile(this.flat)) return;
    for (const suffix of SIDECAR_SUFFIXES) {
      if (!poolHasFile(this.flat + suffix)) continue;
      try {
        poolUtil.unlink(this.flat + suffix);
        logWarn(
          `[sqlite-wasm] orphan_removed name=${baseName(this.name)} file=${suffix}`
        );
      } catch (err) {
        logWarn(
          `[sqlite-wasm] orphan_remove_failed name=${baseName(this.name)} file=${suffix} error=${errorToken(err)}`
        );
      }
    }
  }

  /** First column of the first row of a PRAGMA, straight on the handle. */
  private readPragmaValue(directive: string): unknown {
    const rows: unknown[][] = [];
    this.db.exec({
      sql: `PRAGMA ${directive}`,
      rowMode: 'array',
      resultRows: rows,
    });
    return rows[0]?.[0];
  }

  private tryPragma(directive: string): void {
    try {
      this.db.exec(`PRAGMA ${directive}`);
    } catch (err) {
      console.warn(`[sqlite-wasm] pragma failed: ${directive}`, err);
    }
  }

  /** True when SQLite reports the requested locking mode afterwards. */
  private setLockingMode(mode: 'exclusive' | 'normal'): boolean {
    try {
      const value = this.readPragmaValue(
        `locking_mode = ${mode.toUpperCase()}`
      );
      return String(value).toLowerCase() === mode;
    } catch (err) {
      logWarn(
        `[sqlite-wasm] locking_mode_failed name=${baseName(this.name)} mode=${mode} error=${errorToken(err)}`
      );
      return false;
    }
  }

  private currentJournalMode(): string | undefined {
    try {
      const value = this.readPragmaValue('journal_mode');
      return value == null ? undefined : String(value).toLowerCase();
    } catch {
      return undefined;
    }
  }

  /** Pool slots the switch into WAL may take: the -wal and the journal of the switch. */
  private walSlotsNeeded(): number {
    return SIDECAR_SUFFIXES.filter((suffix) => !poolHasFile(this.flat + suffix))
      .length;
  }

  /**
   * Answers the engine's `journal_mode = WAL`. Without the exclusive lock
   * SQLite used to answer "delete", which cost about five OPFS flushes per
   * commit. Worse, the pool VFS reports a reserved lock as always held, so
   * SQLite never rolls back a journal left by a crash: a WebView killed in
   * the middle of a commit could leave a corrupt file. A WAL commit only
   * appends to the -wal file (flushed at checkpoints), and frames cut off by
   * a crash are ignored on the next open. If WAL cannot be turned on, the
   * file stays in the mode it is in and the lock goes back to normal, as
   * before; nothing is deleted.
   */
  private applyJournalMode(): string | undefined {
    const name = baseName(this.name);
    if (!walEnabled) return this.leaveWal(name);
    let reason = '';
    let mode: string | undefined;
    if (!this.exclusive) {
      reason = 'no_exclusive_lock';
    } else if (freePoolSlots() < this.walSlotsNeeded()) {
      reason = 'pool_full';
    } else {
      try {
        const value = this.readPragmaValue('journal_mode = WAL');
        mode = value == null ? undefined : String(value).toLowerCase();
      } catch (err) {
        reason = errorToken(err);
      }
    }
    if (mode === undefined) mode = this.currentJournalMode();
    this.journalMode = mode ?? 'unknown';
    if (mode === 'wal') {
      // NORMAL syncs the WAL at checkpoints only. A commit survives an app or
      // WebView kill once written; a power cut can lose the last few, never
      // corrupt the file.
      this.tryPragma('synchronous = NORMAL');
      this.tryPragma(`journal_size_limit = ${WAL_SIZE_LIMIT_BYTES}`);
      logInfo(`[sqlite-wasm] journal_mode name=${name} mode=wal`);
      return mode;
    }
    logWarn(
      `[sqlite-wasm] wal_unavailable name=${name} reason=${reason || `mode_${this.journalMode}`} mode=${this.journalMode}`
    );
    // SQLite ignores this while the file is in WAL mode, so it cannot leave a
    // WAL file unreadable.
    if (this.exclusive) this.exclusive = !this.setLockingMode('normal');
    return mode;
  }

  /** WAL turned off in this build: back to the rollback journal, then the normal lock. */
  private leaveWal(name: string): string | undefined {
    let mode: string | undefined;
    try {
      const value = this.readPragmaValue('journal_mode = DELETE');
      mode = value == null ? undefined : String(value).toLowerCase();
    } catch (err) {
      logWarn(
        `[sqlite-wasm] wal_exit_failed name=${name} error=${errorToken(err)}`
      );
    }
    if (mode === undefined) mode = this.currentJournalMode();
    this.journalMode = mode ?? 'unknown';
    if (mode !== 'wal' && this.exclusive) {
      this.exclusive = !this.setLockingMode('normal');
    }
    return mode;
  }

  prepare(sql: string): Statement {
    return new Statement(this, sql);
  }

  exec(sql: string): this {
    this.guarded(sql, () => this.handle().exec(sql));
    return this;
  }

  pragma(directive: string, options?: { simple?: boolean }): unknown {
    if (WAL_REQUEST_RE.test(directive)) {
      const mode = this.applyJournalMode();
      if (options?.simple) return mode;
      return mode === undefined ? [] : [{ journal_mode: mode }];
    }
    try {
      const rows: Record<string, unknown>[] = [];
      this.db.exec({
        sql: `PRAGMA ${directive}`,
        rowMode: 'object',
        resultRows: rows,
      });
      if (options?.simple) {
        const first = rows[0];
        if (!first) return undefined;
        return first[Object.keys(first)[0]];
      }
      return rows;
    } catch (err) {
      // The engine treats these pragmas as best-effort tuning (WAL itself is
      // handled above), so degrade quietly.
      console.warn(`[sqlite-wasm] pragma failed: ${directive}`, err);
      return options?.simple ? undefined : [];
    }
  }

  transaction<T extends unknown[], R>(
    fn: TransactionFn<T, R>
  ): TransactionFn<T, R> & {
    deferred: TransactionFn<T, R>;
    immediate: TransactionFn<T, R>;
    exclusive: TransactionFn<T, R>;
  } {
    const self = this;
    // Resolve the handle lazily so a discarded file surfaces as
    // DatabaseRebuiltError rather than a "closed db" error.
    const db = {
      exec: (sql: string) => self.handle().exec(sql),
    };
    const wrapped =
      (mode: string) =>
      (...args: T): R => {
        // better-sqlite3 supports nesting via savepoints — mirror that.
        if (self.inTransaction) {
          const sp = `qgo_sp_${++self.txDepth}`;
          db.exec(`SAVEPOINT ${sp}`);
          try {
            const result = fn(...args);
            db.exec(`RELEASE ${sp}`);
            return result;
          } catch (err) {
            db.exec(`ROLLBACK TO ${sp}`);
            db.exec(`RELEASE ${sp}`);
            throw err;
          } finally {
            self.txDepth--;
          }
        }
        self.txDepth++;
        try {
          db.exec(`BEGIN ${mode}`);
        } catch (err) {
          self.txDepth--;
          throw err;
        }
        try {
          const result = fn(...args);
          db.exec('COMMIT');
          noteSqliteCommit();
          return result;
        } catch (err) {
          try {
            db.exec('ROLLBACK');
          } catch {
            /* already rolled back */
          }
          if (self.repairPending || isCorruptionError(err)) {
            // Now outside the transaction: rebuild indexes so the caller's
            // next attempt (the engine retries all of these) goes through.
            self.repairPending = false;
            try {
              self.repair(err);
            } catch (repairErr) {
              if (repairErr instanceof DatabaseRebuiltError) throw repairErr;
            }
          }
          throw err;
        } finally {
          self.txDepth--;
        }
      };
    const main = wrapped('') as TransactionFn<T, R> & {
      deferred: TransactionFn<T, R>;
      immediate: TransactionFn<T, R>;
      exclusive: TransactionFn<T, R>;
    };
    main.deferred = wrapped('DEFERRED');
    main.immediate = wrapped('IMMEDIATE');
    main.exclusive = wrapped('EXCLUSIVE');
    return main;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    if (openDatabases.get(this.flat) === this) openDatabases.delete(this.flat);
    this.dropStatementCache();
    try {
      // In WAL mode this also checkpoints and removes the -wal file.
      this.db.close();
    } catch (err) {
      console.warn('[sqlite-wasm] close failed', err);
    }
  }
}

export type { Database as DB, Statement };
export default Database;
