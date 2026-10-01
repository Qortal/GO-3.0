/**
 * Dedicated worker hosting the Hub 2.0 Reticulum chat engine on mobile.
 *
 * Boot order matters: Buffer/process globals and the OPFS-backed fs +
 * sqlite-wasm shims must be live before the engine modules are imported
 * (their module scopes touch fs/sqlite on load), hence the dynamic import.
 */
import { Buffer } from 'buffer';
import { createLogThrottle } from './shims/logger';

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
 * Budget each message kind (5 per 10 s) under a 15-lines-per-10-s ceiling and
 * collapse the rest into one summary line (see createLogThrottle).
 */
function throttleWorkerConsole(): void {
  const decide = createLogThrottle();
  const emitSummary = console.log.bind(console);
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const { emit, summary } = decide(level, args);
      if (summary) emitSummary(summary);
      if (emit) original(...args);
    };
  }
}

throttleWorkerConsole();

type BootMessage = {
  t: 'boot';
  // Never the API key: membership checks do not use one (groupValidation.ts).
  config: { apiBase: string; apiKeyConfigured?: boolean | null };
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
    for (const queued of early.splice(0)) enqueueWorkerMessage(queued);
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

/**
 * UI RPCs (and the replies the engine is awaiting) are handled immediately;
 * Python event floods (presence, digests) are drained a few per macrotask so
 * a burst cannot starve a `getDirectHistory` call for seconds. App state
 * edges and the relay profile also skip the queue: queued before boot, a
 * stale one must not be applied after a newer one sent once the engine is up.
 */
const PRIORITY_TYPES = new Set([
  'rpc',
  'cmdres',
  'signres',
  'nativefsres',
  'boot',
  'stop',
  'lifecycle',
  'network-regained',
  'relay-profile',
]);
const deferred: unknown[] = [];
let pumping = false;

function enqueueWorkerMessage(data: any): void {
  if (data && PRIORITY_TYPES.has(data.t)) {
    handler(data);
    return;
  }
  deferred.push(data);
  if (pumping) return;
  pumping = true;
  const pump = () => {
    let n = 0;
    while (deferred.length && n < 4) {
      handler(deferred.shift());
      n += 1;
    }
    if (deferred.length) {
      setTimeout(pump, 0);
      return;
    }
    pumping = false;
  };
  pump();
}

function attachRpcPort(port: MessagePort): void {
  port.onmessage = (event: MessageEvent) => {
    handler(event.data);
  };
}

self.onmessage = (event: MessageEvent) => {
  if (event.data?.t === 'rpc-port' && event.ports[0]) {
    attachRpcPort(event.ports[0]);
    return;
  }
  enqueueWorkerMessage(event.data);
};
