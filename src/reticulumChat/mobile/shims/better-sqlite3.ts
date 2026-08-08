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

function toBindValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  return value;
}

class Statement {
  constructor(
    private readonly db: any,
    private readonly sql: string
  ) {}

  private withStmt<T>(
    params: unknown[],
    fn: (stmt: any) => T
  ): T {
    const stmt = this.db.prepare(this.sql);
    try {
      this.bindParams(stmt, params);
      return fn(stmt);
    } finally {
      stmt.finalize();
    }
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

  constructor(filename: string, _options?: Record<string, unknown>) {
    if (!poolUtil) {
      throw new Error(
        'initMobileSqlite() must complete before opening databases'
      );
    }
    // The SAH pool VFS namespaces by filename only; flatten the virtual path.
    this.name = filename;
    const flat =
      '/' + filename.replace(/^\/+/, '').replace(/[/\\]/g, '__');
    this.db = new poolUtil.OpfsSAHPoolDb(flat);
  }

  prepare(sql: string): Statement {
    return new Statement(this.db, sql);
  }

  exec(sql: string): this {
    this.db.exec(sql);
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
    const db = this.db;
    const wrapped = (mode: string) =>
      (...args: T): R => {
        // better-sqlite3 supports nesting via savepoints — mirror that.
        if (txDepth > 0) {
          const sp = `qgo_sp_${++txDepth}`;
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
            txDepth--;
          }
        }
        txDepth++;
        db.exec(`BEGIN ${mode}`);
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
          throw err;
        } finally {
          txDepth--;
        }
      };
    let txDepth = 0;
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
