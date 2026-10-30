import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Fake OPFS for the mobile fs shim: directories, files, an exclusive lock per
 * file while a sync access handle is open, and switches for slow, failing or
 * hung opens. Based on the harness that reproduced the EMFILE cascade
 * (October 2026).
 */
type FakeOpfsOptions = {
  /** Delay of every createSyncAccessHandle, in ms (timer based). */
  openDelayMs: number;
  /** createSyncAccessHandle rejects (a renderer that ran out of handles). */
  failOpens: boolean;
  /** createSyncAccessHandle never settles. */
  hangOpens: boolean;
};

type FakeFile = { data: Uint8Array; size: number; locked: boolean };

/** A later boot of the same origin: the OPFS root survives the page. */
type ReusedOpfs = { root: any };

function installFakeOpfs(
  initial: Partial<FakeOpfsOptions> = {},
  reuse?: ReusedOpfs
) {
  const opts: FakeOpfsOptions = {
    openDelayMs: 0,
    failOpens: false,
    hangOpens: false,
    ...initial,
  };
  const stats = { open: 0, opensOk: 0, opensFailed: 0, hung: 0 };
  const lockedFiles: FakeFile[] = [];
  const notFound = () =>
    Object.assign(new Error('NotFoundError'), { name: 'NotFoundError' });
  const makeDir = (): any => {
    const files = new Map<string, FakeFile>();
    const dirs = new Map<string, any>();
    return {
      kind: 'directory',
      files,
      async getDirectoryHandle(name: string, o?: { create?: boolean }) {
        let dir = dirs.get(name);
        if (!dir) {
          if (!o?.create) throw notFound();
          dir = makeDir();
          dirs.set(name, dir);
        }
        return dir;
      },
      async getFileHandle(name: string, o?: { create?: boolean }) {
        let file = files.get(name);
        if (!file) {
          if (!o?.create) throw notFound();
          file = { data: new Uint8Array(0), size: 0, locked: false };
          files.set(name, file);
        }
        const rec = file;
        return {
          kind: 'file',
          createSyncAccessHandle: () => {
            if (opts.hangOpens) {
              stats.hung += 1;
              return new Promise(() => {});
            }
            return new Promise((resolve, reject) => {
              setTimeout(() => {
                if (opts.failOpens || rec.locked) {
                  stats.opensFailed += 1;
                  const name = rec.locked
                    ? 'NoModificationAllowedError'
                    : 'TooManyOpenHandles';
                  reject(Object.assign(new Error(name), { name }));
                  return;
                }
                rec.locked = true;
                lockedFiles.push(rec);
                stats.open += 1;
                stats.opensOk += 1;
                let closed = false;
                resolve({
                  getSize: () => rec.size,
                  truncate: (n: number) => {
                    if (n < rec.data.length) rec.data = rec.data.slice(0, n);
                    rec.size = n;
                  },
                  flush: () => {},
                  read: (buf: Uint8Array, o2?: { at?: number }) => {
                    const at = o2?.at ?? 0;
                    const n = Math.max(
                      0,
                      Math.min(buf.byteLength, rec.size - at)
                    );
                    buf.set(rec.data.subarray(at, at + n));
                    return n;
                  },
                  write: (buf: Uint8Array, o2?: { at?: number }) => {
                    const at = o2?.at ?? 0;
                    const end = at + buf.byteLength;
                    if (end > rec.data.length) {
                      const grown = new Uint8Array(end);
                      grown.set(rec.data);
                      rec.data = grown;
                    }
                    rec.data.set(buf, at);
                    rec.size = Math.max(rec.size, end);
                    return buf.byteLength;
                  },
                  close: () => {
                    if (closed) return;
                    closed = true;
                    rec.locked = false;
                    stats.open -= 1;
                  },
                });
              }, opts.openDelayMs);
            });
          },
        };
      },
      async removeEntry(name: string) {
        if (files.get(name)?.locked) {
          throw Object.assign(new Error('NoModificationAllowedError'), {
            name: 'NoModificationAllowedError',
          });
        }
        files.delete(name);
      },
      async *keys() {
        for (const key of [...files.keys()]) yield key;
        for (const key of [...dirs.keys()]) yield key;
      },
    };
  };
  const root = reuse?.root ?? makeDir();
  Object.defineProperty(globalThis.navigator, 'storage', {
    value: {
      getDirectory: async () => root,
      estimate: async () => ({ usage: 1e6, quota: 1e10 }),
    },
    configurable: true,
  });
  /** The renderer died: every lock is released. */
  const killAll = () => {
    for (const rec of lockedFiles) rec.locked = false;
    lockedFiles.length = 0;
    stats.open = 0;
  };
  const slotFilesOnDisk = async (): Promise<number> => {
    const pool = await root.getDirectoryHandle('qgo-chat-fs', {
      create: true,
    });
    return [...pool.files.keys()].filter((name: string) =>
      name.startsWith('slot-')
    ).length;
  };
  return { opts, stats, root, killAll, slotFilesOnDisk };
}

type Shim = typeof import('./fs');

async function bootShim(
  initial: Partial<FakeOpfsOptions> = {},
  reuse?: ReusedOpfs
) {
  vi.resetModules();
  const fake = installFakeOpfs(initial, reuse);
  const shim: Shim = await import('./fs');
  await shim.initMobileFs();
  const logger = await import('./logger');
  return { fake, shim, logger };
}

/** One new file per call: the engine's per-event wake-up notes did this. */
function writeNew(shim: Shim, name: string): 'ok' | string {
  try {
    shim.writeFileSync(
      `/qgo/appData/qortal-shared/reticulum-chat-notify/${name}.json`,
      '{"eventId":"x"}'
    );
    return 'ok';
  } catch (err) {
    return (err as { code?: string }).code ?? 'error';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mobile fs shim handle pool', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps up with 100-write bursts every 2 s when opens take 400 ms', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, shim } = await bootShim();
    vi.useFakeTimers();
    fake.opts.openDelayMs = 400;
    const outcomes: Record<string, number> = {};
    let n = 0;
    for (let burst = 0; burst < 12; burst += 1) {
      for (let i = 0; i < 100; i += 1) {
        const r = writeNew(shim, `burst-${n++}`);
        outcomes[r] = (outcomes[r] ?? 0) + 1;
      }
      await vi.advanceTimersByTimeAsync(2_000);
    }
    expect(outcomes).toEqual({ ok: 1_200 });
    const stats = shim.getMobileFsStats();
    expect(stats.emfile.count).toBe(0);
    expect(stats.files).toBe(1_200);
    expect(stats.byArea.notify).toBe(1_200);
    // Each batch is published as it opens, so the pool is full again
    // between bursts.
    expect(stats.spares).toBe(256);
    expect(stats.topUp.failed).toBe(0);
    expect(stats.openHandles).toBe(1_200 + 256 + 1);
  });

  it('refills on its own once failing opens recover, with no further writes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, shim, logger } = await bootShim();
    vi.useFakeTimers();
    const slotFilesBefore = await fake.slotFilesOnDisk();
    fake.opts.failOpens = true;
    for (let i = 0; i < 256; i += 1)
      expect(writeNew(shim, `a-${i}`)).toBe('ok');
    await vi.advanceTimersByTimeAsync(0);
    expect(writeNew(shim, 'dry')).toBe('EMFILE');

    let stats = shim.getMobileFsStats();
    expect(stats.spares).toBe(0);
    expect(stats.emfile.count).toBe(1);
    expect(stats.emfile.firstAt).toBeGreaterThan(0);
    expect(stats.emfile.lastAt).toBeGreaterThanOrEqual(stats.emfile.firstAt);
    expect(stats.topUp.failed).toBeGreaterThan(0);
    expect(stats.topUp.lastErrorName).toBe('TooManyOpenHandles');
    expect(stats.topUp.retryPending).toBe(true);
    // Minted slot files whose open failed are removed again.
    expect(await fake.slotFilesOnDisk()).toBe(slotFilesBefore);
    // The failure reached the logger (Copy diagnostics), not just console.
    expect(
      logger
        .getBootFaultLogs()
        .some((line) =>
          line.includes(
            '[mobile-fs] slot_open_failed failed=32 of=32 error=TooManyOpenHandles'
          )
        )
    ).toBe(true);

    // Still failing: the retry backs off (1 s, then 2 s) instead of spinning.
    const runsBefore = stats.topUp.runs;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(shim.getMobileFsStats().topUp.runs).toBe(runsBefore + 1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(shim.getMobileFsStats().topUp.runs).toBe(runsBefore + 1);

    fake.opts.failOpens = false;
    await vi.advanceTimersByTimeAsync(1_000);
    stats = shim.getMobileFsStats();
    expect(stats.topUp.runs).toBe(runsBefore + 2);
    expect(stats.spares).toBe(256);
    expect(stats.topUp.retryPending).toBe(false);
    expect(stats.emfile.count).toBe(1);
    expect(writeNew(shim, 'after')).toBe('ok');
  });

  it('starts a new top-up when one hangs for more than 30 s', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, shim } = await bootShim();
    vi.useFakeTimers();
    fake.opts.hangOpens = true;
    for (let i = 0; i < 256; i += 1)
      expect(writeNew(shim, `h-${i}`)).toBe('ok');
    // Let the run reach createSyncAccessHandle while opens still hang.
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.stats.hung).toBe(32);
    expect(writeNew(shim, 'dry-1')).toBe('EMFILE');
    let stats = shim.getMobileFsStats();
    expect(stats.topUp.inFlight).toBe(true);
    expect(stats.topUp.runs).toBe(1);

    fake.opts.hangOpens = false;
    await vi.advanceTimersByTimeAsync(29_000);
    // Inside the watchdog window: no second run yet.
    expect(writeNew(shim, 'dry-2')).toBe('EMFILE');
    expect(shim.getMobileFsStats().topUp.runs).toBe(1);
    expect(shim.getMobileFsStats().topUp.inFlightMs).toBeGreaterThanOrEqual(
      29_000
    );

    await vi.advanceTimersByTimeAsync(2_000);
    expect(writeNew(shim, 'dry-3')).toBe('EMFILE');
    await vi.advanceTimersByTimeAsync(10);
    stats = shim.getMobileFsStats();
    expect(stats.topUp.watchdogRestarts).toBe(1);
    expect(stats.topUp.runs).toBe(2);
    expect(stats.spares).toBe(256);
    expect(stats.topUp.inFlight).toBe(false);
    expect(stats.emfile.count).toBe(3);
    expect(writeNew(shim, 'after')).toBe('ok');
  });

  it('keeps attachment blobs at boot and forgets the last page notes and temp files', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = await bootShim();
    const blob = (i: number) =>
      `/qgo/appData/qortal-shared/reticulum-resources/blobs/${String(i).padStart(64, 'a')}/assembled.enc`;
    const notify = (i: number) =>
      `/qgo/appData/qortal-shared/reticulum-chat-notify/950-${1_000 + i}-abc${i}.json`;
    const temp = (i: number) =>
      `/qgo/appData/qortal-shared/reticulum-chat-temp/t${i}.page.recv`;
    // Each refill batch waits for a timer, so give the pool time between
    // groups of writes (it is not what this test is about).
    for (let i = 0; i < 1_500; i += 1) {
      first.shim.writeFileSync(blob(i), new Uint8Array(64));
      if (i % 50 === 0) await sleep(5);
    }
    for (let i = 0; i < 3_000; i += 1) {
      first.shim.writeFileSync(notify(i), '{"eventId":"x","groupId":950}');
      if (i % 50 === 0) await sleep(5);
    }
    await sleep(20); // let the pool refill before the next burst
    for (let i = 0; i < 40; i += 1) {
      first.shim.writeFileSync(temp(i), 'x');
      first.shim.writeFileSync(`/tmp/reticulum-resource-imports/${i}`, 'x');
    }
    await sleep(300); // index flush (200 ms debounce)
    expect(first.shim.getMobileFsStats()).toMatchObject({
      files: 4_580,
      byArea: { notify: 3_000, temp: 80, resources: 1_500, other: 0 },
      emfile: { count: 0 },
    });

    // The renderer dies; a new page boots on the same OPFS.
    first.fake.killAll();
    const second = await bootShim({}, first.fake);
    let blobsKept = 0;
    for (let i = 0; i < 1_500; i += 1) {
      if (second.shim.existsSync(blob(i))) blobsKept += 1;
    }
    const notifyKept = second.shim.readdirSync(
      '/qgo/appData/qortal-shared/reticulum-chat-notify'
    ).length;
    expect({ blobsKept, notifyKept }).toEqual({
      blobsKept: 1_500,
      notifyKept: 0,
    });
    expect(second.shim.existsSync(temp(0))).toBe(false);
    expect(second.shim.existsSync('/tmp/reticulum-resource-imports/0')).toBe(
      false
    );
    expect(second.shim.readFileSync(blob(7)).byteLength).toBe(64);
    const stats = second.shim.getMobileFsStats();
    expect(stats.boot).toEqual({ dropped: 3_080, evicted: 0, openFailed: 0 });
    expect(stats.files).toBe(1_500);
    expect(stats.openHandles).toBe(1_500 + 256 + 1);
    // The OPFS root (and its counters) came from the first install.
    expect(first.fake.stats.open).toBe(1_500 + 256 + 1);
    // The forgotten files' slots are reused before new ones are minted.
    expect(stats.reclaimable).toBeLessThanOrEqual(512);
  });

  it('still caps the index at 2,048 files at boot', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = await bootShim();
    for (let i = 0; i < 2_100; i += 1) {
      first.shim.writeFileSync(`/qgo/userData/blobs/${i}`, 'x');
      if (i % 50 === 0) await sleep(5);
    }
    await sleep(300);
    first.fake.killAll();
    const second = await bootShim({}, first.fake);
    const stats = second.shim.getMobileFsStats();
    expect(stats.boot.evicted).toBe(2_100 - 2_048);
    expect(stats.files).toBe(2_048);
  });
});
