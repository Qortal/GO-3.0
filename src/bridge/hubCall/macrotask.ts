/**
 * "Run on a later macrotask" without timers, for GO's WebView and workers.
 *
 * setTimeout(fn, 0) is clamped to >= 4 ms once nested and is throttled in
 * hidden pages (screen off at the ear via the proximity sensor, phone
 * locked), which is exactly when a call must keep flowing. A MessageChannel
 * message is its own task, is never clamped and is not timer-throttled (the
 * same trick React's scheduler uses). Used for:
 *   - the `setImmediate` polyfill (group-call.ts per-frame Reticulum audio
 *     flush, nodeGlobals.ts),
 *   - the inline Ed25519 verify shim (verify-worker-pool.ts).
 * Falls back to setTimeout(0) where MessageChannel does not exist.
 *
 * Tasks run in FIFO order, one per message (an exception in one task is
 * reported like any uncaught error and does not stop the next). No deps.
 */

export type MacrotaskHandle = number;

export type MacrotaskQueue = {
  /** Runs `fn(...args)` on a later macrotask; never synchronously. */
  set(fn: (...args: unknown[]) => void, ...args: unknown[]): MacrotaskHandle;
  /** Cancels a task that has not run yet. */
  clear(handle: MacrotaskHandle | null | undefined): void;
  /** 'message-channel' or 'timeout' (diagnostics, tests). */
  readonly kind: 'message-channel' | 'timeout';
};

type Task = { fn: (...args: unknown[]) => void; args: unknown[] };

type PortLike = {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  unref?: () => void;
  close?: () => void;
};

type ChannelCtorLike = new () => { port1: unknown; port2: unknown };

/** `ChannelCtor`: defaults to the global MessageChannel; `null` = none. */
export function createMacrotaskQueue(
  ChannelCtor: ChannelCtorLike | null | undefined = (
    globalThis as { MessageChannel?: ChannelCtorLike }
  ).MessageChannel
): MacrotaskQueue {
  const tasks = new Map<MacrotaskHandle, Task>();
  let nextHandle = 1;

  if (typeof ChannelCtor === 'function') {
    let channel: { port1: PortLike; port2: PortLike } | null = null;
    try {
      channel = new ChannelCtor() as unknown as {
        port1: PortLike;
        port2: PortLike;
      };
    } catch {
      channel = null;
    }
    if (channel) {
      const { port1, port2 } = channel;
      port1.onmessage = (event) => {
        const handle = event?.data as MacrotaskHandle;
        const task = tasks.get(handle);
        if (!task) return;
        tasks.delete(handle);
        task.fn(...task.args);
      };
      // Node (tests): an active MessagePort keeps the process alive.
      port1.unref?.();
      port2.unref?.();
      return {
        kind: 'message-channel',
        set(fn, ...args) {
          const handle = nextHandle++;
          tasks.set(handle, { fn, args });
          port2.postMessage(handle);
          return handle;
        },
        clear(handle) {
          if (typeof handle === 'number') tasks.delete(handle);
        },
      };
    }
  }

  const timers = new Map<MacrotaskHandle, ReturnType<typeof setTimeout>>();
  return {
    kind: 'timeout',
    set(fn, ...args) {
      const handle = nextHandle++;
      timers.set(
        handle,
        setTimeout(() => {
          timers.delete(handle);
          fn(...args);
        }, 0)
      );
      return handle;
    },
    clear(handle) {
      if (typeof handle !== 'number') return;
      const timer = timers.get(handle);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(handle);
    },
  };
}

let shared: MacrotaskQueue | null = null;

/** The process-wide queue (created on first use). */
export function sharedMacrotaskQueue(): MacrotaskQueue {
  if (!shared) shared = createMacrotaskQueue();
  return shared;
}
