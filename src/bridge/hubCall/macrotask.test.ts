import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMacrotaskQueue } from './macrotask';
import { installHubCallNodeGlobals } from './nodeGlobals';

afterEach(() => {
  vi.useRealTimers();
});

describe('macrotask queue (setImmediate polyfill / verify deferral on GO)', () => {
  it('runs on a later macrotask, FIFO, with args; clear cancels', async () => {
    const queue = createMacrotaskQueue();
    expect(queue.kind).toBe('message-channel');
    const order: unknown[] = [];
    queue.set((...args) => order.push(['a', ...args]), 1, 2);
    const cancelled = queue.set(() => order.push('cancelled'));
    queue.set(() => order.push('b'));
    queue.clear(cancelled);
    await Promise.resolve();
    expect(order).toEqual([]);
    await vi.waitFor(() => expect(order).toEqual([['a', 1, 2], 'b']));
  });

  it('is not driven by timers (clamped/throttled while the page is hidden)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    const queue = createMacrotaskQueue();
    const ran = await new Promise<boolean>((resolve) => {
      queue.set(() => resolve(true));
    });
    // Resolved although no fake timer was ever advanced.
    expect(ran).toBe(true);
  });

  it('falls back to setTimeout(0) without MessageChannel', async () => {
    const queue = createMacrotaskQueue(null);
    expect(queue.kind).toBe('timeout');
    const order: string[] = [];
    queue.set(() => order.push('x'));
    const cancelled = queue.set(() => order.push('cancelled'));
    queue.clear(cancelled);
    expect(order).toEqual([]);
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['x']);
  });

  it('nodeGlobals installs a MessageChannel setImmediate where none exists', async () => {
    const g = globalThis as Record<string, unknown>;
    const savedSet = g.setImmediate;
    const savedClear = g.clearImmediate;
    delete g.setImmediate;
    delete g.clearImmediate;
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    try {
      installHubCallNodeGlobals();
      expect(typeof g.setImmediate).toBe('function');
      const setImmediatePolyfill = g.setImmediate as (
        fn: (...a: unknown[]) => void,
        ...args: unknown[]
      ) => number;
      const clearImmediatePolyfill = g.clearImmediate as (id: number) => void;
      const seen: unknown[] = [];
      const id = setImmediatePolyfill(() => seen.push('cancelled'));
      clearImmediatePolyfill(id);
      await new Promise<void>((resolve) => {
        setImmediatePolyfill((value) => {
          seen.push(value);
          resolve();
        }, 'ran');
      });
      expect(seen).toEqual(['ran']);
    } finally {
      vi.useRealTimers();
      g.setImmediate = savedSet;
      g.clearImmediate = savedClear;
    }
  });
});
