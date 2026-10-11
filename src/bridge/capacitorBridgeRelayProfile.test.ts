import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type BridgeModule = typeof import('./capacitorBridge');

const native = vi.hoisted(() => ({ platform: false }));
const plugin = vi.hoisted(() => ({
  setOutboxPending: vi.fn(),
  getBackgroundSyncState: vi.fn(),
  addListener: vi.fn(),
  getDeviceNetwork: vi.fn(),
}));

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: Object.create(actual.Capacitor, {
      isNativePlatform: { value: () => native.platform },
    }),
  };
});
vi.mock('../plugins/QortalBackground', () => ({ QortalBackground: plugin }));

// The relay profile is module-level state; load a fresh copy per test.
async function loadBridge(): Promise<BridgeModule> {
  vi.resetModules();
  // Re-importing re-registers Capacitor plugins, which only logs a warning.
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    return await import('./capacitorBridge');
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
}

describe('relay profile since (Copy diagnostics)', () => {
  let bridge: BridgeModule;

  beforeEach(async () => {
    bridge = await loadBridge();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is null until the profile really changes on this page', () => {
    expect(bridge.getRelayProfileSince()).toBeNull();
    vi.setSystemTime(1_000);
    // The page starts as a leaf; another leaf is no change.
    expect(bridge.reportRelayProfile('leaf')).toBe(false);
    expect(bridge.reportRelayProfile(undefined)).toBe(false);
    expect(bridge.getRelayProfileSince()).toBeNull();
  });

  it('records the time of each real change only', () => {
    vi.setSystemTime(5_000);
    expect(bridge.reportRelayProfile('full')).toBe(true);
    expect(bridge.getRelayProfileSince()).toBe(5_000);

    vi.setSystemTime(9_000);
    expect(bridge.reportRelayProfile('full')).toBe(false);
    expect(bridge.getRelayProfileSince()).toBe(5_000);

    vi.setSystemTime(12_000);
    expect(bridge.reportRelayProfile('leaf')).toBe(true);
    expect(bridge.getRelayProfileSince()).toBe(12_000);
    expect(bridge.getRelayProfile()).toBe('leaf');
  });

  it('keeps listener semantics unchanged', () => {
    const heard: string[] = [];
    const off = bridge.subscribeRelayProfile((profile) => heard.push(profile));
    vi.setSystemTime(20_000);
    bridge.reportRelayProfile('full');
    bridge.reportRelayProfile('full');
    bridge.reportRelayProfile('leaf');
    off();
    expect(heard).toEqual(['full', 'leaf']);
    expect(bridge.getRelayProfileSince()).toBe(20_000);
  });
});

describe('unlock device probe (Copy diagnostics)', () => {
  beforeEach(() => {
    native.platform = true;
    plugin.getBackgroundSyncState.mockReset();
    plugin.addListener
      .mockReset()
      .mockImplementation(async () => ({ remove: async () => {} }));
  });
  afterEach(() => {
    native.platform = false;
  });

  it('stores device facts after an unlock once the watcher is bound', async () => {
    plugin.getBackgroundSyncState.mockResolvedValue({
      relayProfile: 'leaf',
      charging: true,
      plugType: 'usb',
      batteryPct: 64,
      batteryTempC: 31.2,
      thermalStatus: 2,
      powerSave: false,
    });
    const bridge = await loadBridge();
    const timings = await import('../utils/unlockTimings');
    timings.resetUnlockTimingsForTests();
    // Not bound yet: an unlock records only itself.
    timings.recordUnlockTiming('unlock', 900, 'password');
    await vi.waitFor(() =>
      expect(plugin.getBackgroundSyncState).not.toHaveBeenCalled()
    );

    bridge.subscribeRelayProfile(() => {});
    await vi.waitFor(() =>
      expect(plugin.getBackgroundSyncState).toHaveBeenCalledTimes(1)
    );
    // The watcher's own seed read; the probe has not run.
    await vi.waitFor(() => expect(plugin.addListener).toHaveBeenCalled());
    expect(timings.getUnlockTimingSnapshot().events).toHaveLength(1);

    timings.recordUnlockTiming('kdf', 400);
    timings.recordUnlockTiming('unlock', 1_200, 'fingerprint');
    await vi.waitFor(() =>
      expect(timings.getUnlockTimingSnapshot().events).toHaveLength(4)
    );
    const events = timings.getUnlockTimingSnapshot().events;
    expect(events.map((e) => e.step)).toEqual([
      'unlock',
      'kdf',
      'unlock',
      'device',
    ]);
    expect(events[3]).toMatchObject({
      step: 'device',
      ms: -1,
      detail:
        'charging usb, battery 64%, 31.2 °C, thermal moderate, power save off',
    });
    // One native read for the seed, one for the unlock.
    expect(plugin.getBackgroundSyncState).toHaveBeenCalledTimes(2);
  });

  it('records nothing extra when native has no device facts or fails', async () => {
    plugin.getBackgroundSyncState.mockResolvedValue({ relayProfile: 'leaf' });
    const bridge = await loadBridge();
    const timings = await import('../utils/unlockTimings');
    timings.resetUnlockTimingsForTests();
    bridge.subscribeRelayProfile(() => {});
    await vi.waitFor(() => expect(plugin.addListener).toHaveBeenCalled());

    timings.recordUnlockTiming('unlock', 900, 'password');
    await vi.waitFor(() =>
      expect(plugin.getBackgroundSyncState).toHaveBeenCalledTimes(2)
    );
    plugin.getBackgroundSyncState.mockRejectedValue(new Error('UNIMPLEMENTED'));
    timings.recordUnlockTiming('unlock', 800, 'password');
    await vi.waitFor(() =>
      expect(plugin.getBackgroundSyncState).toHaveBeenCalledTimes(3)
    );
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(timings.getUnlockTimingSnapshot().events.map((e) => e.step)).toEqual(
      ['unlock', 'unlock']
    );
  });
});
