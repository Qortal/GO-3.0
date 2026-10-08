import { afterEach, describe, expect, it, vi } from 'vitest';

// The native Reticulum plugin. `ready` only arrives when the test sends it,
// as after a WebView rebuild where the first `ready` went to the old page.
const native = vi.hoisted(() => ({
  listener: null as ((event: { frame: string }) => void) | null,
  presenceStarts: 0,
}));

vi.mock('../plugins/Reticulum', () => ({
  Reticulum: new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (prop === 'addListener') {
          return (_name: string, cb: (event: { frame: string }) => void) => {
            native.listener = cb;
            return Promise.resolve({ remove: () => Promise.resolve() });
          };
        }
        if (prop === 'presenceStart') {
          return () => {
            native.presenceStarts += 1;
            return Promise.resolve({ started: true });
          };
        }
        return () => Promise.resolve({});
      },
    }
  ),
}));

const PHONE_HASH = 'a'.repeat(32);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('bridge ready after a missed first ready', () => {
  it('asks the bridge again instead of waiting forever', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { Capacitor } = await import('@capacitor/core');
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const bridge = await import('./capacitorBridge');
    bridge.installReticulumBridges();

    void window.presence?.getAllOnline();
    void window.presence?.heartbeat({
      id: 'x',
      type: 'PRESENCE_HEARTBEAT',
      senderAddress: '',
      timestamp: Date.now(),
      payload: {},
      signature: 'sig',
    } as never);
    await vi.waitFor(() => expect(native.presenceStarts).toBe(1), {
      timeout: 10_000,
    });

    // No `ready` within the first wait: the page asks again.
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(native.presenceStarts).toBe(2));
    expect(window.__qortalMobileReticulum?.destinationHash ?? null).toBeNull();

    // The running bridge answers that with `ready`.
    native.listener?.({
      frame: JSON.stringify({
        type: 'event',
        event: 'ready',
        payload: { destinationHash: PHONE_HASH },
      }),
    });
    await vi.waitFor(() =>
      expect(window.__qortalMobileReticulum?.destinationHash).toBe(PHONE_HASH)
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(native.presenceStarts).toBe(2);
  });
});
