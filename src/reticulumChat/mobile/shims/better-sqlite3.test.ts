import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The real sqlite-wasm build and its SAH-pool VFS, on a fake OPFS. Each
 * bootWorker() is a fresh worker: new module state and a new wasm instance
 * on the same storage. The fake OPFS can "kill the process" after a given
 * number of storage writes: later writes are dropped, as when Android kills
 * the WebView, and the next boot sees exactly what had been written.
 */
const sqliteWasm = vi.hoisted(() => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { resolve } = require('node:path') as typeof import('node:path');
  const { pathToFileURL } = require('node:url') as typeof import('node:url');
  const dist = resolve(
    process.cwd(),
    'node_modules/@sqlite.org/sqlite-wasm/dist'
  );
  return {
    // The browser build: the node build has no OPFS VFS.
    indexUrl: pathToFileURL(resolve(dist, 'index.mjs')).href,
    wasm: readFileSync(resolve(dist, 'sqlite3.wasm')),
    boots: 0,
  };
});

vi.mock('@sqlite.org/sqlite-wasm', async () => {
  const real = await import(
    /* @vite-ignore */ `${sqliteWasm.indexUrl}?boot=${++sqliteWasm.boots}`
  );
  return {
    default: (opts: Record<string, unknown>) =>
      real.default({
        ...opts,
        // No fetch of file: URLs here; hand the bytes over directly.
        instantiateWasm(imports: any, done: (i: any, m: any) => void) {
          WebAssembly.instantiate(sqliteWasm.wasm, imports).then((r) =>
            done(r.instance, r.module)
          );
          return {};
        },
      }),
  };
});

type FakeRec = { data: Uint8Array; size: number; locked: boolean };

function makeFakeOpfs() {
  const state = {
    flushes: 0,
    writes: 0,
    killAfter: Infinity,
    dead: false,
  };
  const recs: FakeRec[] = [];
  const notFound = () =>
    Object.assign(new Error('NotFoundError'), { name: 'NotFoundError' });
  class FileSystemHandle {}
  class FileSystemDirectoryHandle extends FileSystemHandle {}
  class FileSystemFileHandle extends FileSystemHandle {
    createSyncAccessHandle(): unknown {
      throw new Error('abstract');
    }
  }
  // False once the "process" is dead: the write never reaches the disk.
  const mutate = () => {
    if (state.dead) return false;
    if (state.writes >= state.killAfter) {
      state.dead = true;
      return false;
    }
    state.writes += 1;
    return true;
  };
  const bytes = (b: ArrayBufferView) =>
    b instanceof Uint8Array
      ? b
      : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  const makeFileHandle = (rec: FakeRec) => {
    const handle = Object.create(FileSystemFileHandle.prototype);
    handle.kind = 'file';
    handle.rec = rec;
    handle.createSyncAccessHandle = async () => {
      if (rec.locked) {
        throw Object.assign(new Error('NoModificationAllowedError'), {
          name: 'NoModificationAllowedError',
        });
      }
      rec.locked = true;
      let closed = false;
      return {
        getSize: () => rec.size,
        truncate: (n: number) => {
          if (!mutate()) return;
          if (n < rec.data.length) rec.data = rec.data.slice(0, n);
          rec.size = n;
        },
        flush: () => {
          state.flushes += 1;
        },
        read: (buf: ArrayBufferView, o?: { at?: number }) => {
          const at = o?.at ?? 0;
          const view = bytes(buf);
          const n = Math.max(0, Math.min(view.byteLength, rec.size - at));
          view.set(rec.data.subarray(at, at + n));
          return n;
        },
        write: (buf: ArrayBufferView, o?: { at?: number }) => {
          const view = bytes(buf);
          if (!mutate()) return view.byteLength;
          const at = o?.at ?? 0;
          const end = at + view.byteLength;
          if (end > rec.data.length) {
            const grown = new Uint8Array(Math.max(end, rec.data.length * 2));
            grown.set(rec.data);
            rec.data = grown;
          }
          rec.data.set(view, at);
          rec.size = Math.max(rec.size, end);
          return view.byteLength;
        },
        close: () => {
          if (closed) return;
          closed = true;
          rec.locked = false;
        },
      };
    };
    return handle;
  };
  const makeDir = (): any => {
    const entries = new Map<string, any>();
    const dir = Object.create(FileSystemDirectoryHandle.prototype);
    Object.assign(dir, {
      kind: 'directory',
      entries,
      async getDirectoryHandle(name: string, o?: { create?: boolean }) {
        let d = entries.get(name);
        if (!d) {
          if (!o?.create) throw notFound();
          d = makeDir();
          entries.set(name, d);
        }
        return d;
      },
      async getFileHandle(name: string, o?: { create?: boolean }) {
        let h = entries.get(name);
        if (!h) {
          if (!o?.create) throw notFound();
          const rec: FakeRec = {
            data: new Uint8Array(0),
            size: 0,
            locked: false,
          };
          recs.push(rec);
          h = makeFileHandle(rec);
          entries.set(name, h);
        }
        return h;
      },
      async removeEntry(name: string) {
        if (!entries.delete(name)) throw notFound();
      },
      async *[Symbol.asyncIterator]() {
        for (const entry of [...entries.entries()]) yield entry;
      },
    });
    return dir;
  };
  const root = makeDir();
  const decoder = new TextDecoder();
  /** Pool files by the path in their SAH-pool header (empty = free slot). */
  const pooled = (): Map<string, FakeRec> => {
    const out = new Map<string, FakeRec>();
    const opaque = root.entries.get('.qgo-sqlite')?.entries.get('.opaque')
      ?.entries as Map<string, any> | undefined;
    for (const h of opaque?.values() ?? []) {
      const rec = h.rec as FakeRec;
      const header = rec.data.subarray(0, Math.min(512, rec.size));
      const end = header.indexOf(0);
      const path = decoder.decode(header.subarray(0, end < 0 ? 0 : end));
      if (path) out.set(path, rec);
    }
    return out;
  };
  return {
    root,
    state,
    globals: {
      FileSystemHandle,
      FileSystemDirectoryHandle,
      FileSystemFileHandle,
    },
    pooled,
    files: () => [...pooled().keys()].sort(),
    /** The process died: its handles are gone, storage keeps what was written. */
    reboot() {
      for (const rec of recs) rec.locked = false;
      state.dead = false;
      state.killAfter = Infinity;
    },
  };
}

type FakeOpfs = ReturnType<typeof makeFakeOpfs>;
type Shim = typeof import('./better-sqlite3');

let warnSpy: ReturnType<typeof vi.spyOn>;

function warnLines(): string[] {
  return warnSpy.mock.calls.map((call) => call.map(String).join(' '));
}

async function bootWorker(opfs: FakeOpfs): Promise<Shim> {
  vi.resetModules();
  vi.stubGlobal('FileSystemHandle', opfs.globals.FileSystemHandle);
  vi.stubGlobal(
    'FileSystemDirectoryHandle',
    opfs.globals.FileSystemDirectoryHandle
  );
  vi.stubGlobal('FileSystemFileHandle', opfs.globals.FileSystemFileHandle);
  Object.defineProperty(globalThis.navigator, 'storage', {
    value: { getDirectory: async () => opfs.root },
    configurable: true,
  });
  const shim = await import('./better-sqlite3');
  await shim.initMobileSqlite();
  return shim;
}

/** What the chat DB and the resource store do right after opening. */
function openLikeEngine(shim: Shim, name = 'qortal-shared/chat.db') {
  const db = new shim.Database(name);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

const FLAT = '/qortal-shared__chat.db';

function count(db: any, table = 't'): number {
  return Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c);
}

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mobile sqlite shim: WAL (D1)', () => {
  it('answers journal_mode = WAL with wal under the exclusive lock', async () => {
    const opfs = makeFakeOpfs();
    const shim = await bootWorker(opfs);
    const db = new shim.Database('qortal-shared/chat.db');
    expect(db.pragma('journal_mode = WAL', { simple: true })).toBe('wal');
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('locking_mode', { simple: true })).toBe('exclusive');
    expect(db.pragma('synchronous', { simple: true })).toBe(1); // NORMAL
    expect(db.pragma('journal_mode = WAL')).toEqual([{ journal_mode: 'wal' }]);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('a');
    expect(opfs.files()).toEqual([FLAT, `${FLAT}-wal`]);
    expect(shim.getMobileSqliteStats().databases[0]).toMatchObject({
      name: 'chat.db',
      journalMode: 'wal',
    });
    db.close();
    // A clean close checkpoints and removes the -wal.
    expect(opfs.files()).toEqual([FLAT]);
  });

  it('keeps 1,000 rows written without a close, across a process kill', async () => {
    const opfs = makeFakeOpfs();
    let shim = await bootWorker(opfs);
    let db = openLikeEngine(shim);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
    for (let i = 0; i < 1000; i++) insert.run(`row ${i}`);
    expect(opfs.files()).toContain(`${FLAT}-wal`);
    // No close: the WebView is killed with the handles open.
    opfs.reboot();
    shim = await bootWorker(opfs);
    db = openLikeEngine(shim);
    expect(count(db)).toBe(1000);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    db.close();
  });

  it('is all-or-nothing when killed at any write of a commit, checkpoint or close', async () => {
    // Build the same starting file once per kill point; every write of the
    // transaction, the forced checkpoint and the close is a kill point.
    const run = async (killAt: number | null) => {
      const opfs = makeFakeOpfs();
      let shim = await bootWorker(opfs);
      let db = openLikeEngine(shim);
      db.exec(
        'CREATE TABLE t (id INTEGER PRIMARY KEY, k TEXT, v TEXT); CREATE INDEX t_k ON t (k); CREATE INDEX t_v ON t (v)'
      );
      const insert = db.prepare('INSERT INTO t (k, v) VALUES (?, ?)');
      db.transaction(() => {
        for (let i = 0; i < 300; i++)
          insert.run(`k${i}`, `${'x'.repeat(40)}${i}`);
      })();
      const before = opfs.state.writes;
      if (killAt !== null) opfs.state.killAfter = before + killAt;
      try {
        db.transaction(() => {
          db.prepare("UPDATE t SET k = 'n' || k, v = v || 'y'").run();
          for (let i = 0; i < 150; i++) {
            insert.run(`z${i}`, `${'w'.repeat(60)}${i}`);
          }
        })();
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.close();
      } catch {
        /* a dead process does not get to handle errors either */
      }
      const writes = opfs.state.writes - before;
      opfs.reboot();
      shim = await bootWorker(opfs);
      db = openLikeEngine(shim);
      const result = {
        writes,
        integrity: db.pragma('integrity_check', { simple: true }),
        rows: count(db),
        renamed: Number(
          db.prepare("SELECT COUNT(*) AS c FROM t WHERE k LIKE 'n%'").get().c
        ),
      };
      db.close();
      return result;
    };
    const full = await run(null);
    expect(full).toMatchObject({ integrity: 'ok', rows: 450, renamed: 300 });
    expect(full.writes).toBeGreaterThan(10);
    for (let killAt = 0; killAt < full.writes; killAt++) {
      const after = await run(killAt);
      expect(after.integrity, `kill at write ${killAt}`).toBe('ok');
      const old = after.rows === 300 && after.renamed === 0;
      const committed = after.rows === 450 && after.renamed === 300;
      expect(old || committed, `kill at write ${killAt}`).toBe(true);
    }
  }, 120_000);

  it('converts an existing rollback-journal file to WAL safely, even if killed midway', async () => {
    const seed = async () => {
      const opfs = makeFakeOpfs();
      const shim = await bootWorker(opfs);
      shim.__setMobileSqliteWalForTests(false); // an older build's file
      const db = openLikeEngine(shim);
      expect(db.pragma('journal_mode', { simple: true })).toBe('delete');
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
      const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
      db.transaction(() => {
        for (let i = 0; i < 200; i++) insert.run(`old ${i}`);
      })();
      db.close();
      opfs.reboot();
      return opfs;
    };
    const upgrade = async (opfs: FakeOpfs, killAt: number | null) => {
      const shim = await bootWorker(opfs);
      const before = opfs.state.writes;
      if (killAt !== null) opfs.state.killAfter = before + killAt;
      try {
        const db = openLikeEngine(shim);
        db.prepare('INSERT INTO t (v) VALUES (?)').run('new');
      } catch {
        /* killed */
      }
      return opfs.state.writes - before;
    };
    const total = await upgrade(await seed(), null);
    for (let killAt = 0; killAt <= total; killAt++) {
      const opfs = await seed();
      await upgrade(opfs, killAt);
      opfs.reboot();
      const shim = await bootWorker(opfs);
      const db = openLikeEngine(shim);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect([200, 201]).toContain(count(db));
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      db.close();
    }
  }, 60_000);

  it('stays in the rollback journal, logged and with data kept, when WAL cannot be turned on', async () => {
    const opfs = makeFakeOpfs();
    const shim = await bootWorker(opfs);
    // Use up the pool's free slots: room for the database and the journal
    // a rollback-journal write needs, but not for a -wal as well.
    const freeSlots = () => {
      const pool = shim.getMobileSqliteStats().pool!;
      return pool.capacity - pool.files;
    };
    expect(freeSlots()).toBeGreaterThanOrEqual(8);
    const fillers: any[] = [];
    while (freeSlots() > 2) {
      fillers.push(new shim.Database(`filler-${fillers.length}.db`));
    }
    const db = new shim.Database('qortal-shared/chat.db');
    expect(db.pragma('journal_mode = WAL', { simple: true })).toBe('delete');
    expect(db.pragma('locking_mode', { simple: true })).toBe('normal');
    expect(
      warnLines().some((line) =>
        /wal_unavailable name=chat\.db reason=pool_full mode=delete/.test(line)
      )
    ).toBe(true);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('kept');
    db.close();
    for (const filler of fillers) filler.close();
    // Closed databases keep their slots, so the pool is still full here.
    expect(freeSlots()).toBeLessThan(2);
    // The next worker start adds free slots; then the file goes to WAL, and
    // nothing was lost on the way.
    opfs.reboot();
    const next = await bootWorker(opfs);
    const again = openLikeEngine(next);
    expect(again.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(count(again)).toBe(1);
    again.close();
  });

  it('falls back when SQLite keeps the old mode or the switch throws', async () => {
    const opfs = makeFakeOpfs();
    const shim = await bootWorker(opfs);
    const db = new shim.Database('qortal-shared/chat.db');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    // SQLite does not change the journal mode inside a transaction.
    db.exec('BEGIN');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('in tx');
    expect(db.pragma('journal_mode = WAL', { simple: true })).toBe('delete');
    db.exec('COMMIT');
    expect(count(db)).toBe(1);
    expect(
      warnLines().some((line) =>
        /wal_unavailable name=chat\.db reason=mode_delete mode=delete/.test(
          line
        )
      )
    ).toBe(true);
    db.close();

    const again = new shim.Database('qortal-shared/chat.db');
    const realRead = (again as any).readPragmaValue.bind(again);
    vi.spyOn(again as any, 'readPragmaValue').mockImplementation(
      (directive: unknown) => {
        if (directive === 'journal_mode = WAL') {
          throw new Error(
            'SQLITE_IOERR: sqlite3 result code 10: disk I/O error'
          );
        }
        return realRead(directive);
      }
    );
    expect(again.pragma('journal_mode = WAL')).toEqual([
      { journal_mode: 'delete' },
    ]);
    expect(
      warnLines().some((line) => /reason=SQLITE_IOERR mode=delete/.test(line))
    ).toBe(true);
    expect(again.pragma('locking_mode', { simple: true })).toBe('normal');
    expect(count(again)).toBe(1);
    again.close();
  });

  it('removes -wal and -journal on the discard path', async () => {
    const opfs = makeFakeOpfs();
    const shim = await bootWorker(opfs);
    const db = openLikeEngine(shim);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('a');
    expect(opfs.files()).toEqual([FLAT, `${FLAT}-wal`]);
    expect(() =>
      (db as any).discardAndRestart(new Error('SQLITE_CORRUPT test'))
    ).toThrow(shim.DatabaseRebuiltError);
    expect(opfs.files()).toEqual([]);
    expect(shim.getMobileSqliteStats().databases).toEqual([]);
    // The engine restarts on a fresh, empty file.
    const fresh = openLikeEngine(shim);
    expect(
      fresh
        .prepare("SELECT COUNT(*) AS c FROM sqlite_schema WHERE name = 't'")
        .get()
    ).toEqual({ c: 0 });
    fresh.close();
  });

  it('removes the -wal on the discard path even when the close fails', async () => {
    const opfs = makeFakeOpfs();
    const shim = await bootWorker(opfs);
    const db = openLikeEngine(shim);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('a');
    // A clean close would checkpoint and delete the -wal itself.
    vi.spyOn((db as any).db, 'close').mockImplementation(() => {
      throw new Error('SQLITE_CORRUPT: database disk image is malformed');
    });
    expect(() =>
      (db as any).discardAndRestart(new Error('SQLITE_CORRUPT test'))
    ).toThrow(shim.DatabaseRebuiltError);
    expect(opfs.files()).toEqual([]);
  });

  it('removes an orphan -wal left by a discard that was cut short', async () => {
    const opfs = makeFakeOpfs();
    let shim = await bootWorker(opfs);
    const db = openLikeEngine(shim);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('discarded');
    // Killed after the main file was unlinked, before its -wal was: clear
    // the main file's pool header the way the pool's unlink does.
    const main = opfs.pooled().get(FLAT)!;
    main.data = new Uint8Array(4096);
    main.size = 4096;
    opfs.reboot();
    shim = await bootWorker(opfs);
    expect(opfs.files()).toEqual([`${FLAT}-wal`]);
    const fresh = openLikeEngine(shim);
    expect(
      fresh
        .prepare("SELECT COUNT(*) AS c FROM sqlite_schema WHERE name = 't'")
        .get()
    ).toEqual({ c: 0 });
    expect(
      warnLines().some((line) =>
        /orphan_removed name=chat\.db file=-wal/.test(line)
      )
    ).toBe(true);
    fresh.close();
  });

  it('refuses a second connection to a file that is open in this worker', async () => {
    const opfs = makeFakeOpfs();
    const shim = await bootWorker(opfs);
    const db = openLikeEngine(shim);
    expect(() => new shim.Database('qortal-shared/chat.db')).toThrow(
      /already open in this worker/
    );
    // The resource store is a different file and opens fine.
    const other = openLikeEngine(shim, 'reticulum-resources/resources.db');
    expect(other.pragma('journal_mode', { simple: true })).toBe('wal');
    db.close();
    other.close();
    const reopened = openLikeEngine(shim);
    reopened.close();
  });

  it('can be turned off again: a WAL file goes back to the rollback journal', async () => {
    const opfs = makeFakeOpfs();
    let shim = await bootWorker(opfs);
    let db = openLikeEngine(shim);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('a');
    opfs.reboot(); // killed with a -wal on disk
    shim = await bootWorker(opfs);
    shim.__setMobileSqliteWalForTests(false);
    db = openLikeEngine(shim);
    expect(db.pragma('journal_mode', { simple: true })).toBe('delete');
    expect(db.pragma('locking_mode', { simple: true })).toBe('normal');
    expect(count(db)).toBe(1);
    expect(opfs.files()).toEqual([FLAT]);
    db.close();
  });

  it('flushes about once per 50+ writes instead of several times per write', async () => {
    const bench = async (wal: boolean) => {
      const opfs = makeFakeOpfs();
      const shim = await bootWorker(opfs);
      shim.__setMobileSqliteWalForTests(wal);
      const db = openLikeEngine(shim, `bench-${wal}.db`);
      // The gap-scanner update the round-1 investigators measured.
      db.exec(`CREATE TABLE r (group_id INTEGER NOT NULL, author TEXT NOT NULL,
        from_seq INTEGER NOT NULL, to_seq INTEGER NOT NULL, peer TEXT,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (group_id, author, from_seq, to_seq));
        CREATE INDEX r_due ON r (next_attempt_at, group_id);`);
      const insert = db.prepare('INSERT INTO r VALUES (?, ?, ?, ?, ?, ?)');
      db.transaction(() => {
        for (let i = 0; i < 2000; i++) {
          insert.run(1000 + (i % 10), `Q${i % 300}`, i, i + 1, `p${i}`, i);
        }
      })();
      const update = db.prepare(`UPDATE r SET peer = COALESCE(@peer, peer),
        next_attempt_at = MAX(next_attempt_at, @next)
        WHERE group_id = @group_id AND author = @author
          AND from_seq = @from_seq AND to_seq = @to_seq`);
      const f0 = opfs.state.flushes;
      for (let i = 0; i < 500; i++) {
        update.run({
          group_id: 1000 + (i % 10),
          author: `Q${i % 300}`,
          from_seq: i,
          to_seq: i + 1,
          peer: 'p',
          next: 5_000 + i,
        });
      }
      const flushes = opfs.state.flushes - f0;
      db.close();
      return flushes;
    };
    const walFlushes = await bench(true);
    const journalFlushes = await bench(false);
    expect(walFlushes).toBeLessThanOrEqual(10); // ≤ 1 per 50 writes
    expect(journalFlushes).toBeGreaterThanOrEqual(4 * 500);
  });
});

describe('mobile sqlite shim: statement cache (B11)', () => {
  it('prepares a statement once and reuses it for run, get and all', async () => {
    const opfs = makeFakeOpfs();
    const shim = await bootWorker(opfs);
    const db = openLikeEngine(shim);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, b TEXT)');
    const insert = db.prepare('INSERT INTO t (a, b) VALUES (?, ?)');
    const byId = db.prepare('SELECT a, b FROM t WHERE id = ?');
    const misses0 = shim.getMobileSqliteStats().databases[0].statementMisses;
    for (let i = 0; i < 100; i++) {
      expect(insert.run(`a${i}`, `b${i}`)).toEqual({
        changes: 1,
        lastInsertRowid: i + 1,
      });
      expect(byId.get(i + 1)).toEqual({ a: `a${i}`, b: `b${i}` });
    }
    // Binds are cleared between uses: a missing positional value is NULL,
    // as with a freshly prepared statement.
    insert.run('only a');
    expect(byId.get(101)).toEqual({ a: 'only a', b: null });
    // A new wrapper for the same SQL shares the cached statement.
    expect(db.prepare('SELECT a, b FROM t WHERE id = ?').get(5)).toEqual({
      a: 'a4',
      b: 'b4',
    });
    expect(
      db.prepare('SELECT id FROM t WHERE id <= ? ORDER BY id').all(3)
    ).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const stats = shim.getMobileSqliteStats().databases[0];
    expect(stats.statementMisses - misses0).toBe(3);
    expect(stats.statementHits).toBeGreaterThanOrEqual(200);
    db.close();
  });

  it('binds named parameters on a reused statement and keeps failing ones out', async () => {
    const opfs = makeFakeOpfs();
    const shim = await bootWorker(opfs);
    const db = openLikeEngine(shim);
    db.exec(
      'CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT UNIQUE, b INTEGER)'
    );
    const upsert = db.prepare('INSERT INTO t (a, b) VALUES (@a, @b)');
    upsert.run({ a: 'x', b: 1 });
    upsert.run({ a: 'y', b: true });
    expect(() => upsert.run({ a: 'z' })).toThrow(/Missing named parameter "b"/);
    expect(() => upsert.run({ a: 'x', b: 3 })).toThrow(/UNIQUE/);
    upsert.run({ a: 'z', b: undefined });
    expect(db.prepare('SELECT a, b FROM t ORDER BY id').all()).toEqual([
      { a: 'x', b: 1 },
      { a: 'y', b: 1 },
      { a: 'z', b: null },
    ]);
    db.close();
  });

  it('gives a nested use of the same SQL its own statement', async () => {
    const opfs = makeFakeOpfs();
    const shim = await bootWorker(opfs);
    const db = openLikeEngine(shim);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO t (v) VALUES (?), (?), (?)').run(
      'one',
      'two',
      'three'
    );
    const sql = 'SELECT id, v FROM t WHERE id >= @from AND v <> @not';
    expect(db.prepare(sql).all({ from: 1, not: '' })).toHaveLength(3); // cached
    let inner: unknown;
    // Binding reads the parameter object, so a getter runs while the outer
    // statement is checked out with @from already bound: the same SQL runs
    // again from inside it and must not reset the outer one's binds.
    const params = {
      from: 2,
      get not() {
        inner = db.prepare(sql).all({ from: 3, not: '' });
        return 'three';
      },
    };
    expect(db.prepare(sql).all(params)).toEqual([{ id: 2, v: 'two' }]);
    expect(inner).toEqual([{ id: 3, v: 'three' }]);
    expect(db.prepare(sql).all({ from: 1, not: 'one' })).toHaveLength(2);
    expect(shim.getMobileSqliteStats().databases[0].statementsCached).toBe(2);
    db.close();
  });

  it('holds no read snapshot between uses, so checkpoints complete', async () => {
    const opfs = makeFakeOpfs();
    const shim = await bootWorker(opfs);
    const db = openLikeEngine(shim);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
    for (let i = 0; i < 50; i++) insert.run(`v${i}`);
    // get() stops after the first row; the cached statement must be reset.
    expect(db.prepare('SELECT v FROM t ORDER BY id').get()).toEqual({
      v: 'v0',
    });
    const [result] = db.pragma('wal_checkpoint(TRUNCATE)') as Array<
      Record<string, number>
    >;
    expect(result.busy).toBe(0);
    expect(result.log).toBe(0); // truncated: every frame was checkpointed
    db.close();
  });

  it('finalizes cached statements on close, so the file really closes', async () => {
    const opfs = makeFakeOpfs();
    const shim = await bootWorker(opfs);
    const db = openLikeEngine(shim);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    for (let i = 0; i < 10; i++) {
      db.prepare('INSERT INTO t (v) VALUES (?)').run(String(i));
      db.prepare('SELECT * FROM t WHERE id = ?').get(i);
    }
    expect(shim.getMobileSqliteStats().databases[0].statementsCached).toBe(2);
    db.close();
    // Closed for real (no zombie connection): checkpointed, -wal removed.
    expect(opfs.files()).toEqual([FLAT]);
    expect(shim.getMobileSqliteStats().databases).toEqual([]);
    const reopened = openLikeEngine(shim);
    expect(count(reopened)).toBe(10);
    reopened.close();
  });

  it('drops the cache on a corruption repair and the retry uses fresh statements', async () => {
    const opfs = makeFakeOpfs();
    let shim = await bootWorker(opfs);
    let db = openLikeEngine(shim);
    db.exec(
      'CREATE TABLE t (id INTEGER PRIMARY KEY, k TEXT); CREATE INDEX t_k ON t (k)'
    );
    const insert = db.prepare('INSERT INTO t (k) VALUES (?)');
    db.transaction(() => {
      for (let i = 0; i < 2000; i++)
        insert.run(`key-${String(i).padStart(5, '0')}`);
    })();
    const pageSize = Number(db.pragma('page_size', { simple: true }));
    db.close(); // checkpointed into the main file
    // The kind of damage seen on phones: an index entry that disagrees with
    // its row. Rewrite the key of row 1235 inside the index leaf page only
    // (page type 0x0a), keeping the b-tree itself valid and in order.
    const main = opfs.pooled().get(FLAT)!;
    const needle = new TextEncoder().encode('key-01234');
    let patched = 0;
    for (let at = 4096; at + needle.length <= main.size; at++) {
      if (!needle.every((b, i) => main.data[at + i] === b)) continue;
      const pageStart = 4096 + Math.floor((at - 4096) / pageSize) * pageSize;
      const header = pageStart === 4096 ? pageStart + 100 : pageStart;
      if (main.data[header] !== 0x0a) continue;
      main.data[at + needle.length - 1] = '3'.charCodeAt(0);
      patched += 1;
    }
    expect(patched).toBe(1);
    opfs.reboot();
    shim = await bootWorker(opfs);
    db = openLikeEngine(shim);
    // A statement cached before the corruption shows up (rowid lookup, no
    // index involved).
    expect(db.prepare('SELECT k FROM t WHERE id = ?').get(1)).toEqual({
      k: 'key-00000',
    });
    const before = shim.getMobileSqliteStats().databases[0];
    expect(before.statementsCached).toBe(1);
    // Updating the row cannot find its index entry (SQLITE_CORRUPT_INDEX),
    // REINDEX rebuilds the index from the table, and the statement is
    // retried once on a fresh prepare.
    expect(
      db.prepare('UPDATE t SET k = ? WHERE id = ?').run('changed', 1235)
    ).toMatchObject({ changes: 1 });
    expect(warnLines().some((line) => /corruption detected/.test(line))).toBe(
      true
    );
    const after = shim.getMobileSqliteStats().databases[0];
    // Only the retried statement is cached now: the old one was dropped.
    expect(after.statementsCached).toBe(1);
    expect(after.statementMisses - before.statementMisses).toBe(2);
    expect(db.prepare('SELECT k FROM t WHERE id = ?').get(2)).toEqual({
      k: 'key-00001',
    });
    expect(db.prepare('SELECT id FROM t WHERE k = ?').get('changed')).toEqual({
      id: 1235,
    });
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    db.close();
  });

  it('keeps transactions and rollbacks working with cached statements', async () => {
    const opfs = makeFakeOpfs();
    const shim = await bootWorker(opfs);
    const db = openLikeEngine(shim);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT UNIQUE)');
    const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
    const read = db.prepare('SELECT COUNT(*) AS c FROM t');
    const addAll = db.transaction((values: string[]) => {
      for (const v of values) {
        insert.run(v);
        read.get();
      }
    });
    addAll(['a', 'b']);
    expect(() => addAll(['c', 'a'])).toThrow(/UNIQUE/);
    expect(read.get()).toEqual({ c: 2 });
    const nested = db.transaction(() => {
      insert.run('d');
      expect(() => addAll(['e', 'd'])).toThrow(/UNIQUE/);
      insert.run('f');
    });
    nested();
    expect(db.prepare('SELECT v FROM t ORDER BY id').all()).toEqual([
      { v: 'a' },
      { v: 'b' },
      { v: 'd' },
      { v: 'f' },
    ]);
    db.close();
  });
});
