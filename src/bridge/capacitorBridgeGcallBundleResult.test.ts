import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// python's gcall_control_bundle_result (qortal_presence_host.py) reaches the
// audio surface as the window event go-gcall-control-bundle-result.
const native = vi.hoisted(() => ({
  listener: null as ((event: { frame: string }) => void) | null,
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
        if (prop === 'presenceCommand') {
          return ({ id }: { id: string }) => {
            queueMicrotask(() =>
              native.listener?.({
                frame: JSON.stringify({ type: 'resp', id, ok: true }),
              })
            );
            return Promise.resolve({});
          };
        }
        return () => Promise.resolve({});
      },
    }
  ),
}));

vi.mock('./nativeCallSession', () => ({
  setNativeRingAddresses: async () => {},
}));

const ROOM = 'dmv:0123456789abcdef01';
const EVENT = 'go-gcall-control-bundle-result';

let bridge: typeof import('./capacitorBridge');

async function installBridge(): Promise<void> {
  vi.resetModules();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const { Capacitor } = await import('@capacitor/core');
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    bridge = await import('./capacitorBridge');
    bridge.installReticulumBridges();
    void bridge.ensureReticulumBridgeStarted().catch(() => {});
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
}

function pythonEvent(event: string, payload: unknown): void {
  native.listener?.({
    frame: JSON.stringify({ type: 'event', event, payload }),
  });
}

describe('gcall control bundle results', () => {
  let heard: unknown[];
  const listen = (event: Event) =>
    heard.push((event as CustomEvent<unknown>).detail);

  beforeEach(() => {
    heard = [];
    window.addEventListener(EVENT, listen);
  });

  afterEach(() => {
    window.removeEventListener(EVENT, listen);
    vi.restoreAllMocks();
  });

  it('forwards the python event to the audio surface as a window event', async () => {
    native.listener = null;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await installBridge();
    await vi.waitFor(() => expect(native.listener).not.toBeNull(), {
      timeout: 10_000,
    });
    expect(bridge.GO_GCALL_CONTROL_BUNDLE_RESULT_EVENT).toBe(EVENT);

    pythonEvent('gcall_control_bundle_result', {
      signalId: 'b5b0f6a4-offer',
      signalType: 'offer',
      signalKind: 'description',
      roomId: ROOM,
      linkId: 'f'.repeat(32),
      ok: false,
      reason: 'infeasible',
      sent: 0,
      total: 9,
      ageMs: 12_004,
    });
    expect(heard).toEqual([
      {
        signalId: 'b5b0f6a4-offer',
        signalType: 'offer',
        signalKind: 'description',
        ok: false,
        reason: 'infeasible',
        roomId: ROOM,
        sent: 0,
        total: 9,
        ageMs: 12_004,
      },
    ]);

    // Other python events do not produce it.
    pythonEvent('group_audio_send_failed', { reason: 'link_not_ready' });
    expect(heard).toHaveLength(1);
  });

  it('drops malformed results', async () => {
    const { forwardGcallControlBundleResult } =
      await import('./capacitorBridge');
    expect(forwardGcallControlBundleResult(null)).toBe(false);
    expect(
      forwardGcallControlBundleResult({ signalType: 'offer', roomId: ROOM })
    ).toBe(false); // no ok
    expect(forwardGcallControlBundleResult({ ok: true, roomId: ROOM })).toBe(
      false
    ); // no signalType
    expect(
      forwardGcallControlBundleResult({ ok: 'yes', signalType: 'offer' })
    ).toBe(false);
    expect(heard).toEqual([]);
    expect(
      forwardGcallControlBundleResult({
        ok: true,
        signalType: 'answer',
        roomId: ROOM,
        reason: 'sent',
        sent: 'many',
      })
    ).toBe(true);
    expect(heard).toEqual([
      {
        signalId: '',
        signalType: 'answer',
        signalKind: '',
        ok: true,
        reason: 'sent',
        roomId: ROOM,
        sent: 0,
        total: 0,
        ageMs: 0,
      },
    ]);
  });
});
