/**
 * `better-sqlite3` stand-in backed by the official @sqlite.org/sqlite-wasm
 * build with its OPFS SyncAccessHandle-pool VFS: real persistent SQLite,
 * fully synchronous, inside a dedicated worker — the same execution model the
 * chat engine was written against.
 *
 * Only the surface the chat DB and resource store use is implemented:
 * prepare (run/get/all with positional or @named binds), exec, pragma,
 * transaction, close. WAL is quietly downgraded (the OPFS VFS has no shared
 * memory), which is fine — the engine only ever opens one connection per DB.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

let sqlite3: any = null;
let poolUtil: any = null;

/** Must resolve before any Database is constructed. */
export async function initMobileSqlite(): Promise<void> {
  if (poolUtil) return;
  sqlite3 = await sqlite3InitModule({
    print: () => {},
    printErr: (msg: string) => console.warn('[sqlite-wasm]', msg),
  });
  poolUtil = await sqlite3.installOpfsSAHPoolVfs({
    name: 'qgo-sql',
    directory: '.qgo-sqlite',
    initialCapacity: 16,
  });
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
      console.warn(
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
      const stmt = this.db.prepare(this.sql);
      try {
        this.bindParams(stmt, params);
        return fn(stmt);
      } finally {
        stmt.finalize();
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
      const count = sqlite3.capi.sqlite3_bind_parameter_count(stmt.pointer);
      for (let i = 1; i <= count; i++) {
        const name = sqlite3.capi.sqlite3_bind_parameter_name(stmt.pointer, i);
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
      return {
        changes: this.db.changes(),
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

  /** Raw sqlite-wasm handle; throws once the file has been discarded. */
  handle(): any {
    if (this.rebuilt) throw new DatabaseRebuiltError(this.name);
    return this.db;
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
      try {
        this.db.close();
      } catch {
        /* already closed */
      }
      try {
        poolUtil.unlink(this.flat);
      } catch (unlinkErr) {
        console.error('[sqlite-wasm] unlink after corruption failed', unlinkErr);
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
    this.db = new poolUtil.OpfsSAHPoolDb(this.flat);
  }

  prepare(sql: string): Statement {
    return new Statement(this, sql);
  }

  exec(sql: string): this {
    this.guarded(sql, () => this.handle().exec(sql));
    return this;
  }

  pragma(directive: string, options?: { simple?: boolean }): unknown {
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
      // WAL and friends are not available on the OPFS VFS; the engine treats
      // these pragmas as best-effort tuning, so degrade silently.
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
    try {
      this.db.close();
    } catch (err) {
      console.warn('[sqlite-wasm] close failed', err);
    }
  }
}

export type { Database as DB, Statement };
export default Database;
