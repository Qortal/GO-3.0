/**
 * Dedicated worker hosting the Hub 2.0 Reticulum chat engine on mobile.
 *
 * Boot order matters: Buffer/process globals and the OPFS-backed fs +
 * sqlite-wasm shims must be live before the engine modules are imported
 * (their module scopes touch fs/sqlite on load), hence the dynamic import.
 */
import { Buffer } from 'buffer';

(globalThis as any).Buffer = (globalThis as any).Buffer || Buffer;
(globalThis as any).process = (globalThis as any).process || {
  // VITEST=1 deliberately routes the engine's digest/author-tree builds
  // through their inline branches: the pooled variants open the SQLite file
  // from a second connection, which the OPFS SAH-pool VFS cannot allow.
  env: { VITEST: '1' },
  pid: 1,
  platform: 'android',
  cwd: () => '/',
  nextTick: (fn: () => void) => queueMicrotask(fn),
};
if (typeof (globalThis as any).setImmediate !== 'function') {
  (globalThis as any).setImmediate = (
    fn: (...a: unknown[]) => void,
    ...args: unknown[]
  ) => setTimeout(fn, 0, ...args);
  (globalThis as any).clearImmediate = (id: number) => clearTimeout(id);
}

/**
 * Every console call in here is marshalled to the main thread and on to
 * logcat. The engine logs per-peer and per-group, so one repeating fault (a
 * storage error, an unreachable peer) turns into thousands of messages a
 * minute and saturates the JS bridge badly enough to stop the UI painting.
 * Collapse repeats of the same message into a periodic summary.
 */
function throttleWorkerConsole(): void {
  const WINDOW_MS = 10_000;
  const LIMIT = 5;
  const seen = new Map<string, { count: number; windowStart: number }>();
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const key = `${level}:${String(args[0] ?? '').slice(0, 120)}`;
      const now = Date.now();
      const entry = seen.get(key);
      if (!entry || now - entry.windowStart > WINDOW_MS) {
        if (entry && entry.count > LIMIT) {
          original(
            `[MobileChat] (${entry.count - LIMIT} further repeats suppressed)`,
            args[0]
          );
        }
        seen.set(key, { count: 1, windowStart: now });
        original(...args);
        return;
      }
      entry.count += 1;
      if (entry.count <= LIMIT) original(...args);
    };
  }
}

throttleWorkerConsole();

type BootMessage = {
  t: 'boot';
  config: { apiBase: string; apiKey?: string };
};

const early: unknown[] = [];
let handler: (data: any) => void;

async function boot(msg: BootMessage): Promise<void> {
  try {
    const { initMobileFs } = await import('./shims/fs');
    await initMobileFs();
    const { initMobileSqlite } = await import('./shims/better-sqlite3');
    await initMobileSqlite();
    const host = await import('./engineHost');
    host.startEngine(msg.config);
    handler = host.handleMainMessage;
    for (const queued of early.splice(0)) handler(queued);
  } catch (err) {
    console.error('[MobileChat] engine boot failed', err);
    (self as unknown as Worker).postMessage({
      t: 'engine-failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

handler = (data: any) => {
  if (data && data.t === 'boot') {
    handler = (d) => early.push(d);
    void boot(data as BootMessage);
  } else {
    early.push(data);
  }
};

self.onmessage = (event: MessageEvent) => handler(event.data);
