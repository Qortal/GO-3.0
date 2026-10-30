import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The native Reticulum plugin: captures the frame listener and answers every
// command with ok, as presence_bridge.py does.
const native = vi.hoisted(() => ({
  listener: null as ((event: { frame: string }) => void) | null,
  commands: [] as Array<{ action: string; payload: unknown }>,
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
          return ({ action, payload, id }) => {
            native.commands.push({ action, payload });
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

const PHONE_HASH = 'a'.repeat(32);
const DESKTOP_HASH = 'b'.repeat(32);
const OTHER_PHONE_HASH = 'c'.repeat(32);

type Update = { address: string; online: boolean; status: string | null };

function frame(event: string, payload: Record<string, unknown>): void {
  native.listener?.({
    frame: JSON.stringify({ type: 'event', event, payload }),
  });
}

function envelope(
  type: string,
  address: string,
  sessionId: string,
  status?: string
): Record<string, unknown> {
  return {
    id: `${type}-${sessionId}`,
    type,
    senderAddress: address,
    timestamp: Date.now(),
    payload: { address, publicKey: 'pk', sessionId, status },
    signature: 'sig',
  };
}

function inbound(
  type: string,
  address: string,
  sessionId: string,
  hash: string,
  status?: string
): void {
  frame('presence_message', {
    route: { destinationHash: hash },
    envelope: envelope(type, address, sessionId, status),
  });
}

async function installBridge(): Promise<void> {
  vi.resetModules();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const { Capacitor } = await import('@capacitor/core');
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const bridge = await import('./capacitorBridge');
    bridge.installReticulumBridges();
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
  // Start the bridge and report ready, as Python does after boot.
  void window.presence?.getAllOnline();
  await window.presence?.heartbeat(envelope('X', '', '', 'online') as never);
}

describe('mobile presence across devices of one account', () => {
  let updates: Update[];
  let off: (() => void) | undefined;

  beforeEach(async () => {
    native.listener = null;
    native.commands = [];
    // Fake from the start so the bridge's 20 s sweep runs on the fake clock.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pending = installBridge();
    // The first command waits for `ready`.
    // The first import of the bridge is slow when the suite runs in parallel.
    await vi.waitFor(() => expect(native.listener).not.toBeNull(), {
      timeout: 10_000,
    });
    frame('ready', { destinationHash: PHONE_HASH });
    await pending;
    updates = [];
    off = window.presence?.onUpdateBatch((batch) => updates.push(...batch));
  });

  afterEach(() => {
    off?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows online while one device is idle and another is online', async () => {
    inbound('PRESENCE_HEARTBEAT', 'QPeer', 'phone', OTHER_PHONE_HASH, 'online');
    inbound('PRESENCE_HEARTBEAT', 'QPeer', 'desktop', DESKTOP_HASH, 'idle');

    expect(updates[updates.length - 1]).toEqual({
      address: 'QPeer',
      online: true,
      status: 'online',
    });
    const sessions = await window.presence!.getAllOnline();
    expect(sessions.filter((s) => s.address === 'QPeer')).toHaveLength(2);
  });

  it('keeps the account online when only one device goes offline', () => {
    inbound('PRESENCE_HEARTBEAT', 'QPeer', 'phone', OTHER_PHONE_HASH, 'online');
    inbound('PRESENCE_HEARTBEAT', 'QPeer', 'desktop', DESKTOP_HASH, 'idle');
    inbound('PRESENCE_OFFLINE', 'QPeer', 'phone', OTHER_PHONE_HASH);

    expect(updates[updates.length - 1]).toEqual({
      address: 'QPeer',
      online: true,
      status: 'idle',
    });

    inbound('PRESENCE_OFFLINE', 'QPeer', 'desktop', DESKTOP_HASH);
    expect(updates[updates.length - 1]).toEqual({
      address: 'QPeer',
      online: false,
      status: null,
    });
  });

  it('counts this phone among its own account devices', async () => {
    inbound('PRESENCE_HEARTBEAT', 'QMe', 'desktop', DESKTOP_HASH, 'idle');
    expect(updates[updates.length - 1]?.status).toBe('idle');

    await window.presence!.heartbeat(
      envelope('PRESENCE_HEARTBEAT', 'QMe', 'this-phone', 'online') as never
    );
    expect(updates[updates.length - 1]).toEqual({
      address: 'QMe',
      online: true,
      status: 'online',
    });
  });

  it('does not repeat an account whose devices changed nothing', async () => {
    inbound('PRESENCE_HEARTBEAT', 'QPeer', 'phone', OTHER_PHONE_HASH, 'online');
    inbound('PRESENCE_HEARTBEAT', 'QPeer', 'phone', OTHER_PHONE_HASH, 'online');
    inbound('PRESENCE_HEARTBEAT', 'QPeer', 'desktop', DESKTOP_HASH, 'idle');
    expect(updates).toEqual([
      { address: 'QPeer', online: true, status: 'online' },
    ]);

    inbound('PRESENCE_HEARTBEAT', 'QPeer', 'phone', OTHER_PHONE_HASH, 'busy');
    expect(updates[updates.length - 1]).toEqual({
      address: 'QPeer',
      online: true,
      status: 'busy',
    });

    // A reader that takes the whole list hears about every account again.
    await window.presence!.getAllOnline();
    updates = [];
    inbound('PRESENCE_HEARTBEAT', 'QPeer', 'phone', OTHER_PHONE_HASH, 'busy');
    expect(updates).toEqual([
      { address: 'QPeer', online: true, status: 'busy' },
    ]);
  });

  it('reports expired devices as gone instead of keeping their last status', async () => {
    inbound('PRESENCE_HEARTBEAT', 'QPeer', 'desktop', DESKTOP_HASH, 'idle');
    updates = [];

    vi.advanceTimersByTime(120_000);

    expect(updates).toContainEqual({
      address: 'QPeer',
      online: false,
      status: null,
    });
    expect(await window.presence!.getAllOnline()).toEqual([]);
  });
});
