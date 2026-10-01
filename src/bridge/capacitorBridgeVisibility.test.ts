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

// Chromium's own view of the page, which the override must not trust once
// Android has said whether GO is on screen.
const real = { state: 'visible' as DocumentVisibilityState, focus: true };

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

/** A visibilitychange fired by Chromium itself. */
function chromiumVisibility(state: DocumentVisibilityState): void {
  real.state = state;
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('page visibility override', () => {
  let bridge: BridgeModule;
  let seen: string[];
  let edges: string[];
  const record = () => seen.push(document.visibilityState);

  beforeEach(async () => {
    real.state = 'visible';
    real.focus = true;
    vi.spyOn(Document.prototype, 'visibilityState', 'get').mockImplementation(
      () => real.state
    );
    vi.spyOn(Document.prototype, 'hasFocus').mockImplementation(
      () => real.focus
    );
    bridge = await loadBridge();
    bridge.installPageVisibilityOverride();
    seen = [];
    edges = [];
    document.addEventListener('visibilitychange', record);
    bridge.subscribeAppLifecycle((state) => edges.push(state));
  });

  afterEach(() => {
    document.removeEventListener('visibilitychange', record);
    bridge.setNativeAppStateQueryForTests(null);
    bridge.uninstallPageVisibilityOverrideForTests();
    vi.restoreAllMocks();
  });

  it('shows the real value until Android has answered', () => {
    expect(document.visibilityState).toBe('visible');
    expect(document.hidden).toBe(false);
    chromiumVisibility('hidden');
    expect(document.visibilityState).toBe('hidden');
    expect(document.hidden).toBe(true);
    chromiumVisibility('visible');
    // Real edges reach app code while there is nothing better to go on.
    expect(seen).toEqual(['hidden', 'visible']);
  });

  it('reports hidden while GO is off screen even if Chromium says visible', () => {
    bridge.reportNativeAppState(false);
    expect(document.visibilityState).toBe('hidden');
    expect(document.hidden).toBe(true);
    // One synthetic change for app code.
    expect(seen).toEqual(['hidden']);
  });

  it('drops the keep-alive hidden/visible flip from Chromium', () => {
    // Order on the phone varies; Chromium first here.
    chromiumVisibility('hidden');
    bridge.reportNativeAppState(false);
    // Native keep-alive re-shows the WebView to Chromium 500 ms later.
    chromiumVisibility('visible');
    chromiumVisibility('visible');
    expect(seen).toEqual(['hidden']);
    expect(document.hidden).toBe(true);
    expect(edges).toEqual(['background']);
  });

  it('comes back on the foreground edge only', () => {
    bridge.reportNativeAppState(false);
    chromiumVisibility('hidden');
    // Page unfrozen and shown before appStateChange lands: still hidden.
    chromiumVisibility('visible');
    expect(document.hidden).toBe(true);
    bridge.reportNativeAppState(true);
    expect(document.visibilityState).toBe('visible');
    expect(seen).toEqual(['hidden', 'visible']);
    expect(edges).toEqual(['background', 'foreground']);
  });

  it('keeps later real edges while GO is on screen', () => {
    bridge.reportNativeAppState(true);
    chromiumVisibility('hidden');
    expect(document.hidden).toBe(true);
    chromiumVisibility('visible');
    expect(seen).toEqual(['hidden', 'visible']);
  });

  it('never reports focus while GO is off screen', () => {
    expect(document.hasFocus()).toBe(true);
    bridge.reportNativeAppState(false);
    expect(document.hasFocus()).toBe(false);
    bridge.reportNativeAppState(true);
    expect(document.hasFocus()).toBe(true);
    real.focus = false;
    expect(document.hasFocus()).toBe(false);
  });

  it('recovers a lost resume by asking Android', async () => {
    const query = vi.fn().mockResolvedValue({ isActive: true });
    bridge.setNativeAppStateQueryForTests(query);
    bridge.reportNativeAppState(false);
    chromiumVisibility('visible');
    await flush();
    expect(query).toHaveBeenCalledTimes(1);
    expect(document.hidden).toBe(false);
    expect(seen).toEqual(['hidden', 'visible']);
    expect(edges).toEqual(['background', 'foreground']);
  });

  it('lets an appStateChange that lands first beat a stale query', async () => {
    let answer!: (v: { isActive: boolean }) => void;
    bridge.setNativeAppStateQueryForTests(
      () => new Promise((resolve) => (answer = resolve))
    );
    bridge.reportNativeAppState(false);
    chromiumVisibility('visible');
    bridge.reportNativeAppState(true);
    bridge.reportNativeAppState(false);
    await flush();
    answer({ isActive: true });
    await flush();
    expect(document.hidden).toBe(true);
  });

  it('does not ask Android when both agree', async () => {
    const query = vi.fn().mockResolvedValue({ isActive: false });
    bridge.setNativeAppStateQueryForTests(query);
    bridge.reportNativeAppState(false);
    chromiumVisibility('hidden');
    await flush();
    expect(query).not.toHaveBeenCalled();
  });

  it('recovers a lost resume on window focus when Chromium stays visible', async () => {
    // Keep-alive: Chromium never saw the page hidden, so no visibilitychange
    // will fire when the user comes back.
    const query = vi.fn().mockResolvedValue({ isActive: true });
    bridge.setNativeAppStateQueryForTests(query);
    bridge.reportNativeAppState(false);
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(query).toHaveBeenCalledTimes(1);
    expect(document.hidden).toBe(false);
    expect(seen).toEqual(['hidden', 'visible']);
    expect(edges).toEqual(['background', 'foreground']);
  });

  it('recovers a lost resume on a touch', async () => {
    const query = vi.fn().mockResolvedValue({ isActive: true });
    bridge.setNativeAppStateQueryForTests(query);
    bridge.reportNativeAppState(false);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flush();
    expect(document.hidden).toBe(false);
  });

  it('does not ask Android on focus while GO is on screen', async () => {
    const query = vi.fn().mockResolvedValue({ isActive: true });
    bridge.setNativeAppStateQueryForTests(query);
    bridge.reportNativeAppState(true);
    window.dispatchEvent(new Event('focus'));
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flush();
    expect(query).not.toHaveBeenCalled();
  });

  it('reports the real visibility for network upkeep', () => {
    bridge.reportNativeAppState(false);
    // Kept alive: app code sees hidden, the lease sweep keeps running.
    expect(document.hidden).toBe(true);
    expect(bridge.isPageReallyHidden()).toBe(false);
    chromiumVisibility('hidden');
    expect(bridge.isPageReallyHidden()).toBe(true);
  });

  it('restores the real properties on uninstall', () => {
    bridge.reportNativeAppState(false);
    bridge.uninstallPageVisibilityOverrideForTests();
    expect(document.visibilityState).toBe('visible');
    expect(document.hasFocus()).toBe(true);
  });
});

describe('own outbox pending', () => {
  beforeEach(() => {
    plugin.setOutboxPending.mockReset().mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    native.platform = false;
  });

  it('sends changes only, in order', async () => {
    native.platform = true;
    const bridge = await loadBridge();
    bridge.reportOwnOutboxPending(true);
    bridge.reportOwnOutboxPending(true);
    bridge.reportOwnOutboxPending(false);
    bridge.reportOwnOutboxPending(false);
    bridge.reportOwnOutboxPending(true);
    await vi.waitFor(() =>
      expect(plugin.setOutboxPending).toHaveBeenCalledTimes(3)
    );
    expect(plugin.setOutboxPending.mock.calls).toEqual([
      [{ pending: true }],
      [{ pending: false }],
      [{ pending: true }],
    ]);
  });

  it('survives a native build without the method', async () => {
    native.platform = true;
    const bridge = await loadBridge();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    plugin.setOutboxPending.mockRejectedValueOnce(new Error('UNIMPLEMENTED'));
    bridge.reportOwnOutboxPending(true);
    bridge.reportOwnOutboxPending(false);
    await vi.waitFor(() =>
      expect(plugin.setOutboxPending).toHaveBeenCalledTimes(2)
    );
    warn.mockRestore();
  });

  it('does nothing off native', async () => {
    const bridge = await loadBridge();
    bridge.reportOwnOutboxPending(true);
    await flush();
    expect(plugin.setOutboxPending).not.toHaveBeenCalled();
  });
});

describe('relay profile', () => {
  let relayListener: ((event: { profile: string }) => void) | null;

  beforeEach(() => {
    native.platform = true;
    relayListener = null;
    plugin.getBackgroundSyncState.mockReset();
    plugin.addListener
      .mockReset()
      .mockImplementation(async (name: string, fn: any) => {
        if (name === 'relayProfileChanged') relayListener = fn;
        return { remove: async () => {} };
      });
  });
  afterEach(() => {
    native.platform = false;
  });

  it('seeds from the native state and follows events', async () => {
    plugin.getBackgroundSyncState.mockResolvedValue({ relayProfile: 'full' });
    const bridge = await loadBridge();
    const profiles: string[] = [];
    bridge.subscribeRelayProfile((p) => profiles.push(p));
    await vi.waitFor(() => expect(profiles).toEqual(['full']));
    expect(bridge.getRelayProfile()).toBe('full');
    relayListener?.({ profile: 'leaf' });
    relayListener?.({ profile: 'leaf' });
    relayListener?.({ profile: 'bogus' });
    expect(profiles).toEqual(['full', 'leaf']);
  });

  it('stays a leaf on a native build without background sync', async () => {
    plugin.getBackgroundSyncState.mockRejectedValue(new Error('UNIMPLEMENTED'));
    const bridge = await loadBridge();
    const profiles: string[] = [];
    bridge.subscribeRelayProfile((p) => profiles.push(p));
    await flush();
    await flush();
    expect(profiles).toEqual([]);
    expect(bridge.getRelayProfile()).toBe('leaf');
  });

  it('tells Python the seeded profile even when it is the default leaf', async () => {
    // A new page after the Activity was recreated: Python may still hold
    // 'full' caps from the page before.
    plugin.getBackgroundSyncState.mockResolvedValue({ relayProfile: 'leaf' });
    const bridge = await loadBridge();
    const pushed: string[] = [];
    bridge.setOverlayProfilePushForTests((p) => pushed.push(p));
    bridge.subscribeRelayProfile(() => {});
    await vi.waitFor(() => expect(pushed).toEqual(['leaf']));
    relayListener?.({ profile: 'full' });
    relayListener?.({ profile: 'leaf' });
    expect(pushed).toEqual(['leaf', 'full', 'leaf']);
  });

  it('pushes a seeded full profile once', async () => {
    plugin.getBackgroundSyncState.mockResolvedValue({ relayProfile: 'full' });
    const bridge = await loadBridge();
    const pushed: string[] = [];
    bridge.setOverlayProfilePushForTests((p) => pushed.push(p));
    bridge.subscribeRelayProfile(() => {});
    await vi.waitFor(() => expect(pushed).toEqual(['full']));
    await flush();
    expect(pushed).toEqual(['full']);
  });

  it('ignores a seed answer older than an event', async () => {
    let answer!: (v: { relayProfile: string }) => void;
    plugin.getBackgroundSyncState.mockImplementation(
      () => new Promise((resolve) => (answer = resolve))
    );
    const bridge = await loadBridge();
    bridge.subscribeRelayProfile(() => {});
    await vi.waitFor(() => expect(relayListener).not.toBeNull());
    relayListener?.({ profile: 'full' });
    answer({ relayProfile: 'leaf' });
    await flush();
    expect(bridge.getRelayProfile()).toBe('full');
  });
});
