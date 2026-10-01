import { beforeEach, describe, expect, it, vi } from 'vitest';

type BridgeModule = typeof import('./capacitorBridge');

// Lifecycle and network state is module-level; load a fresh copy per test.
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

describe('app lifecycle edges', () => {
  let bridge: BridgeModule;
  let seen: string[];

  beforeEach(async () => {
    bridge = await loadBridge();
    seen = [];
    bridge.subscribeAppLifecycle((state) => seen.push(state));
  });

  it('drops the startup foreground and repeated edges', () => {
    bridge.reportAppLifecycle('foreground', 'app');
    bridge.reportAppLifecycle('background', 'app');
    bridge.reportAppLifecycle('background', 'app');
    bridge.reportAppLifecycle('foreground', 'app');
    expect(seen).toEqual(['background', 'foreground']);
  });

  it('coalesces visibility with appStateChange for the same edge', () => {
    bridge.reportAppLifecycle('background', 'visibility');
    bridge.reportAppLifecycle('background', 'app');
    expect(seen).toEqual(['background']);
  });

  it('ignores page visibility once appStateChange is available', () => {
    bridge.reportAppLifecycle('background', 'app');
    // A page kept 'visible' while GO is in the background must not count.
    bridge.reportAppLifecycle('foreground', 'visibility');
    expect(seen).toEqual(['background']);
    bridge.reportAppLifecycle('foreground', 'app');
    expect(seen).toEqual(['background', 'foreground']);
  });

  it('falls back to page visibility without the App plugin', () => {
    bridge.reportAppLifecycle('background', 'visibility');
    bridge.reportAppLifecycle('background', 'visibility');
    bridge.reportAppLifecycle('foreground', 'visibility');
    expect(seen).toEqual(['background', 'foreground']);
  });

  it('stops notifying after unsubscribe', () => {
    const other: string[] = [];
    const off = bridge.subscribeAppLifecycle((state) => other.push(state));
    off();
    bridge.reportAppLifecycle('background', 'app');
    expect(other).toEqual([]);
    expect(seen).toEqual(['background']);
  });
});

describe('device network regain', () => {
  it('fires only on an offline -> online edge', async () => {
    const bridge = await loadBridge();
    const regained = vi.fn();
    bridge.subscribeDeviceNetworkRegained(regained);
    bridge.reportDeviceNetwork(true); // baseline
    bridge.reportDeviceNetwork(true);
    expect(regained).not.toHaveBeenCalled();
    bridge.reportDeviceNetwork(false);
    bridge.reportDeviceNetwork(false);
    expect(regained).not.toHaveBeenCalled();
    bridge.reportDeviceNetwork(true);
    expect(regained).toHaveBeenCalledTimes(1);
    bridge.reportDeviceNetwork(true);
    expect(regained).toHaveBeenCalledTimes(1);
  });

  it('treats a first offline report as a baseline', async () => {
    const bridge = await loadBridge();
    const regained = vi.fn();
    bridge.subscribeDeviceNetworkRegained(regained);
    bridge.reportDeviceNetwork(false);
    bridge.reportDeviceNetwork(true);
    expect(regained).toHaveBeenCalledTimes(1);
  });
});
