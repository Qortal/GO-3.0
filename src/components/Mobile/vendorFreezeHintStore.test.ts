import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  android: true,
  listeners: {} as Record<string, (event: unknown) => void>,
  /** Capacitor App plugin listeners ('resume'). */
  appListeners: {} as Record<string, () => void>,
  prefs: new Map<string, string>(),
  /** Preferences.get rejects while set (a storage hiccup). */
  prefsReadFails: false,
  plugin: {
    getBackgroundSyncState: vi.fn(),
    acknowledgeVendorFreezeHint: vi.fn(),
    isIgnoringBatteryOptimizations: vi.fn(),
    requestIgnoreBatteryOptimizations: vi.fn(),
    openAppBatterySettings: vi.fn(),
    openVendorBatterySettings: vi.fn() as ReturnType<typeof vi.fn> | undefined,
    addListener: vi.fn(),
  },
}));

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      isNativePlatform: () => native.android,
      getPlatform: () => (native.android ? 'android' : 'web'),
    },
  };
});
vi.mock('../../plugins/QortalBackground', () => ({
  QortalBackground: native.plugin,
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (name: string, fn: () => void) => {
      native.appListeners[name] = fn;
      return {
        remove: vi.fn(async () => {
          if (native.appListeners[name] === fn)
            delete native.appListeners[name];
        }),
      };
    }),
  },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => {
      if (native.prefsReadFails) throw new Error('storage busy');
      return { value: native.prefs.get(key) ?? null };
    }),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      native.prefs.set(key, value);
    }),
  },
}));

import { Preferences } from '@capacitor/preferences';
import {
  VENDOR_FREEZE_HINT_PREFS_KEY,
  claimVendorFreezeCardPop,
  getVendorFreezeHintSnapshot,
  resetVendorFreezeHintStoreForTests,
  startVendorFreezeHintStore,
  useVendorFreezeBellBadge,
  useVendorFreezeHint,
  vendorFreezeHintActions,
} from './vendorFreezeHintStore';
import { initialUiState } from './vendorFreezeHintPolicy';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

const night = (at: number, extra: Record<string, unknown> = {}) => ({
  at,
  gapMs: 6 * HOUR,
  ignoring: false,
  charging: true,
  ...extra,
});

const baseState = {
  mode: 'charging',
  charging: true,
  unmetered: true,
  relayProfile: 'leaf',
  keepAliveActive: false,
  vendorFreezeCount: 0,
  vendorFreezeLastAt: null,
  vendorFreezeHintPending: false,
  manufacturer: 'vivo',
  vendorFreezeRecent: [] as unknown[],
  ignoringBatteryOptimizations: false,
};

let nativeState: Record<string, unknown>;

const storedUi = () =>
  JSON.parse(native.prefs.get(VENDOR_FREEZE_HINT_PREFS_KEY) ?? 'null');

/** Installed (and migrated) a month ago, nothing shown since. */
const seedUi = (extra: Record<string, unknown> = {}) => {
  native.prefs.set(
    VENDOR_FREEZE_HINT_PREFS_KEY,
    JSON.stringify({ ...initialUiState(NOW - 30 * DAY), ...extra })
  );
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const start = async () => {
  const stop = startVendorFreezeHintStore();
  await act(async () => {
    await settle();
    await settle();
  });
  return stop;
};

const resume = async () => {
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    await settle();
  });
};

/**
 * Back from a system dialog (the 'Allow in background' prompt): Android only
 * paused GO, so Capacitor's App 'resume' and window focus fire, but no
 * visibilitychange.
 */
const appResume = async () => {
  await act(async () => {
    native.appListeners.resume?.();
    await settle();
    await settle();
  });
};

describe('vendorFreezeHintStore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    resetVendorFreezeHintStoreForTests();
    native.android = true;
    native.listeners = {};
    native.appListeners = {};
    native.prefs.clear();
    native.prefsReadFails = false;
    nativeState = { ...baseState };
    native.plugin.getBackgroundSyncState.mockImplementation(async () => ({
      ...nativeState,
    }));
    native.plugin.acknowledgeVendorFreezeHint.mockResolvedValue({ ok: true });
    native.plugin.isIgnoringBatteryOptimizations.mockResolvedValue({
      ignoring: true,
    });
    native.plugin.requestIgnoreBatteryOptimizations.mockResolvedValue({
      success: true,
    });
    native.plugin.openAppBatterySettings.mockResolvedValue({ success: true });
    native.plugin.openVendorBatterySettings = vi
      .fn()
      .mockResolvedValue({ opened: 'vendor' });
    native.plugin.addListener.mockImplementation(
      async (name: string, fn: (event: unknown) => void) => {
        native.listeners[name] = fn;
        return { remove: vi.fn() };
      }
    );
  });
  afterEach(() => {
    resetVendorFreezeHintStoreForTests();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does nothing off Android', async () => {
    native.android = false;
    const stop = await start();
    expect(getVendorFreezeHintSnapshot().ready).toBe(false);
    expect(native.plugin.getBackgroundSyncState).not.toHaveBeenCalled();
    expect(Preferences.get).not.toHaveBeenCalled();
    await expect(
      vendorFreezeHintActions.openBatterySettings()
    ).resolves.toBeNull();
    await expect(vendorFreezeHintActions.allowInBackground()).resolves.toBe(
      false
    );
    stop();
  });

  it('first run after the update: ignores the old flag and older freezes, no quiet time', async () => {
    nativeState = {
      ...nativeState,
      vendorFreezeHintPending: true,
      vendorFreezeCount: 9,
      vendorFreezeRecent: [night(NOW - 2 * DAY), night(NOW - DAY)],
    };
    const stop = await start();
    const snapshot = getVendorFreezeHintSnapshot();
    expect(snapshot).toMatchObject({
      ready: true,
      manufacturer: 'vivo',
      brand: 'vivo',
      mode: 'charging',
      freezeCount: 9,
      bell: null,
      dontShowAgain: false,
    });
    // The settings still show the week's facts.
    expect(snapshot.settings).toEqual({
      episodes7d: 2,
      lastAt: NOW - DAY,
      variant: 'fixable',
    });
    expect(storedUi()).toEqual(initialUiState(NOW));
    expect(native.plugin.acknowledgeVendorFreezeHint).toHaveBeenCalledTimes(1);

    // Two freezes after the update show the notice at once.
    nativeState.vendorFreezeRecent = [
      night(NOW - 2 * DAY),
      night(NOW - DAY),
      night(NOW + DAY),
      night(NOW + 2 * DAY),
    ];
    vi.setSystemTime(NOW + 2 * DAY + HOUR);
    await resume();
    expect(getVendorFreezeHintSnapshot().bell).toMatchObject({
      badge: true,
      isNew: false,
      shownAt: NOW + 2 * DAY + HOUR,
    });
    stop();
  });

  it('records a new card once, with the badge, and persists it', async () => {
    seedUi();
    nativeState.vendorFreezeRecent = [night(NOW - 2 * DAY), night(NOW - DAY)];
    const stop = await start();
    expect(getVendorFreezeHintSnapshot().bell).toEqual({
      episodes: 2,
      lastAt: NOW - DAY,
      since: NOW - 7 * DAY,
      variant: 'fixable',
      shownAt: NOW,
      badge: true,
      isNew: false,
    });
    expect(storedUi()).toMatchObject({ cardShownAt: NOW, shownCount: 1 });

    // A later return does not count it again.
    vi.setSystemTime(NOW + HOUR);
    await resume();
    expect(storedUi()).toMatchObject({ cardShownAt: NOW, shownCount: 1 });
    stop();
  });

  it('acknowledging clears the badge and keeps the card; X removes it', async () => {
    seedUi();
    nativeState.vendorFreezeRecent = [night(NOW - 2 * DAY), night(NOW - DAY)];
    const stop = await start();
    const { result } = renderHook(() => useVendorFreezeBellBadge());
    expect(result.current).toBe(1);

    vi.setSystemTime(NOW + MIN);
    await act(() => vendorFreezeHintActions.acknowledge());
    expect(result.current).toBe(0);
    expect(getVendorFreezeHintSnapshot().bell).toMatchObject({ badge: false });
    expect(storedUi()).toMatchObject({
      ackAt: NOW + MIN,
      cooldownFrom: NOW + MIN,
    });

    await act(() => vendorFreezeHintActions.closeCard());
    expect(getVendorFreezeHintSnapshot().bell).toBeNull();
    expect(storedUi()).toMatchObject({ cardClosed: true });
    stop();
  });

  it.each([
    ['expandSteps', () => vendorFreezeHintActions.expandSteps()],
    ['allowInBackground', () => vendorFreezeHintActions.allowInBackground()],
    [
      'openBatterySettings',
      () => vendorFreezeHintActions.openBatterySettings(),
    ],
    ['setDontShowAgain', () => vendorFreezeHintActions.setDontShowAgain(true)],
  ])('%s acknowledges', async (_name, action) => {
    seedUi();
    nativeState.vendorFreezeRecent = [night(NOW - 2 * DAY), night(NOW - DAY)];
    const stop = await start();
    expect(getVendorFreezeHintSnapshot().bell?.badge).toBe(true);
    vi.setSystemTime(NOW + MIN);
    await act(async () => {
      await action();
    });
    expect(getVendorFreezeHintSnapshot().bell).toMatchObject({ badge: false });
    expect(storedUi()).toMatchObject({ cooldownFrom: NOW + MIN });
    stop();
  });

  it('allowInBackground opens the exemption dialog and reads the result on App resume', async () => {
    seedUi();
    const stop = await start();
    await act(async () => {
      await expect(vendorFreezeHintActions.allowInBackground()).resolves.toBe(
        true
      );
    });
    expect(native.plugin.requestIgnoreBatteryOptimizations).toHaveBeenCalled();
    expect(getVendorFreezeHintSnapshot().ignoringBatteryOptimizations).toBe(
      false
    );
    // The dialog granted it; GO comes back with no visibilitychange.
    nativeState.ignoringBatteryOptimizations = true;
    await appResume();
    expect(getVendorFreezeHintSnapshot().ignoringBatteryOptimizations).toBe(
      true
    );
    stop();
    // Stopping removes the App listener too.
    await act(settle);
    expect(native.appListeners.resume).toBeUndefined();
  });

  it('window focus also re-reads, and one return reads native state once', async () => {
    seedUi();
    const stop = await start();
    expect(native.plugin.getBackgroundSyncState).toHaveBeenCalledTimes(1);
    nativeState.ignoringBatteryOptimizations = true;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await settle();
      await settle();
    });
    expect(native.plugin.getBackgroundSyncState).toHaveBeenCalledTimes(2);
    expect(getVendorFreezeHintSnapshot().ignoringBatteryOptimizations).toBe(
      true
    );

    // resume, focus and visibilitychange of the same return share one read.
    native.plugin.getBackgroundSyncState.mockClear();
    let answer: (value: unknown) => void = () => {};
    native.plugin.getBackgroundSyncState.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve))
    );
    await act(async () => {
      native.appListeners.resume?.();
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();
    });
    expect(native.plugin.getBackgroundSyncState).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer({ ...nativeState });
      await settle();
    });
    // The next return reads again.
    await appResume();
    expect(native.plugin.getBackgroundSyncState).toHaveBeenCalledTimes(2);
    stop();
  });

  it('a failed read of the stored state raises no card, writes nothing, and retries on the next return', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Ticked on an earlier run; then storage fails for a while.
    seedUi({ dontShowAgain: true, shownCount: 1 });
    const before = native.prefs.get(VENDOR_FREEZE_HINT_PREFS_KEY);
    native.prefsReadFails = true;
    const stop = await start();
    expect(getVendorFreezeHintSnapshot()).toMatchObject({
      ready: true,
      bell: null,
    });

    // Two new nights after the failed read: the memory stand-in would allow
    // a card, but the stored tick may say no, so none is raised.
    nativeState.vendorFreezeRecent = [night(NOW + DAY), night(NOW + 2 * DAY)];
    vi.setSystemTime(NOW + 2 * DAY + HOUR);
    await resume();
    expect(getVendorFreezeHintSnapshot().bell).toBeNull();
    expect(getVendorFreezeHintSnapshot().settings.episodes7d).toBe(2);

    // An action while the state is unknown is kept in memory only.
    const actedAt = NOW + 2 * DAY + 2 * HOUR;
    vi.setSystemTime(actedAt);
    await act(() => vendorFreezeHintActions.expandSteps());
    expect(Preferences.set).not.toHaveBeenCalled();
    expect(native.prefs.get(VENDOR_FREEZE_HINT_PREFS_KEY)).toBe(before);

    // Storage works again: the next return reads it. The tick holds and the
    // acknowledgement made meanwhile is kept.
    native.prefsReadFails = false;
    vi.setSystemTime(actedAt + HOUR);
    await resume();
    expect(getVendorFreezeHintSnapshot()).toMatchObject({
      bell: null,
      dontShowAgain: true,
    });
    expect(storedUi()).toMatchObject({
      dontShowAgain: true,
      shownCount: 1,
      ackAt: actedAt,
      cooldownFrom: actedAt,
    });
    stop();
    warn.mockRestore();
  });

  it('after a failed read, a stored state without the tick raises the card', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedUi();
    nativeState.vendorFreezeRecent = [night(NOW - 2 * DAY), night(NOW - DAY)];
    native.prefsReadFails = true;
    const stop = await start();
    expect(getVendorFreezeHintSnapshot().bell).toBeNull();
    native.prefsReadFails = false;
    await resume();
    expect(getVendorFreezeHintSnapshot().bell).toMatchObject({ badge: true });
    expect(storedUi()).toMatchObject({ shownCount: 1, cardShownAt: NOW });
    stop();
    warn.mockRestore();
  });

  it('a failed first read never writes a first-run state', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    native.prefsReadFails = true;
    const stop = await start();
    expect(Preferences.set).not.toHaveBeenCalled();
    expect(native.plugin.acknowledgeVendorFreezeHint).not.toHaveBeenCalled();
    // The read works on the next return: a real first run (migration).
    native.prefsReadFails = false;
    vi.setSystemTime(NOW + MIN);
    await resume();
    expect(storedUi()).toEqual(initialUiState(NOW + MIN));
    expect(native.plugin.acknowledgeVendorFreezeHint).toHaveBeenCalledTimes(1);
    stop();
    warn.mockRestore();
  });

  it('fixes and stores times written while the clock was ahead', async () => {
    seedUi({ ackAt: NOW + 30 * DAY, cooldownFrom: NOW + 30 * DAY });
    const stop = await start();
    expect(storedUi()).toMatchObject({ ackAt: NOW, cooldownFrom: NOW });
    // 15 days on, two new nights raise a card (not 30 days from the wrong
    // date).
    const later = NOW + 15 * DAY;
    nativeState.vendorFreezeRecent = [
      night(later - 2 * DAY),
      night(later - DAY),
    ];
    vi.setSystemTime(later);
    await resume();
    expect(getVendorFreezeHintSnapshot().bell).toMatchObject({ badge: true });
    stop();
  });

  it('openBatterySettings uses the vendor page, else falls back to App info', async () => {
    seedUi();
    const stop = await start();
    await expect(vendorFreezeHintActions.openBatterySettings()).resolves.toBe(
      'vendor'
    );
    expect(native.plugin.openAppBatterySettings).not.toHaveBeenCalled();

    // An older native build without the method.
    native.plugin.openVendorBatterySettings = undefined;
    await expect(vendorFreezeHintActions.openBatterySettings()).resolves.toBe(
      'app_details'
    );
    native.plugin.openVendorBatterySettings = vi
      .fn()
      .mockRejectedValue(new Error('UNIMPLEMENTED'));
    native.plugin.openAppBatterySettings.mockRejectedValue(new Error('no'));
    await expect(
      vendorFreezeHintActions.openBatterySettings()
    ).resolves.toBeNull();
    stop();
  });

  it('the tick stops new cards; unticking turns them back on', async () => {
    seedUi({ dontShowAgain: true });
    nativeState.vendorFreezeRecent = [night(NOW - 2 * DAY), night(NOW - DAY)];
    const stop = await start();
    expect(getVendorFreezeHintSnapshot()).toMatchObject({
      bell: null,
      dontShowAgain: true,
    });
    expect(getVendorFreezeHintSnapshot().settings.variant).toBe('fixable');
    await act(() => vendorFreezeHintActions.setDontShowAgain(false));
    expect(getVendorFreezeHintSnapshot()).toMatchObject({
      dontShowAgain: false,
    });
    expect(getVendorFreezeHintSnapshot().bell?.isNew).toBe(false);
    expect(storedUi()).toMatchObject({ dontShowAgain: false, shownCount: 1 });
    stop();
  });

  it('re-reads native state on every return to GO, and never polls', async () => {
    seedUi();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = await start();
    expect(native.plugin.getBackgroundSyncState).toHaveBeenCalledTimes(1);
    expect(getVendorFreezeHintSnapshot().bell).toBeNull();

    nativeState.vendorFreezeRecent = [night(NOW - 2 * DAY), night(NOW - DAY)];
    await resume();
    expect(native.plugin.getBackgroundSyncState).toHaveBeenCalledTimes(2);
    expect(getVendorFreezeHintSnapshot().bell?.badge).toBe(true);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
    stop();
  });

  it('shows a live freeze at once, then reads the full list', async () => {
    seedUi();
    nativeState.vendorFreezeRecent = [night(NOW - DAY)];
    const stop = await start();
    expect(getVendorFreezeHintSnapshot().bell).toBeNull();

    native.plugin.getBackgroundSyncState.mockImplementationOnce(
      () => new Promise(() => {})
    );
    await act(async () => {
      native.listeners.vendorFreezeDetected?.({
        count: 2,
        lastAt: NOW - MIN,
        manufacturer: 'vivo',
        gapMs: 3 * HOUR,
        ignoring: false,
        charging: true,
      });
      await settle();
    });
    expect(getVendorFreezeHintSnapshot()).toMatchObject({
      freezeCount: 2,
      bell: { badge: true, episodes: 2, lastAt: NOW - MIN },
    });
    expect(native.plugin.getBackgroundSyncState).toHaveBeenCalledTimes(2);
    stop();
  });

  it('shows nothing with background sync off', async () => {
    seedUi();
    nativeState = {
      ...nativeState,
      mode: 'off',
      vendorFreezeRecent: [night(NOW - 2 * DAY), night(NOW - DAY)],
    };
    const stop = await start();
    expect(getVendorFreezeHintSnapshot()).toMatchObject({
      ready: true,
      bell: null,
      settings: { variant: 'none', episodes7d: 0 },
    });
    expect(storedUi().shownCount).toBe(0);
    stop();
  });

  it('asks the separate method on an older build that does not report the exemption', async () => {
    seedUi();
    const {
      ignoringBatteryOptimizations: _omit,
      vendorFreezeRecent: _r,
      ...old
    } = baseState;
    nativeState = old;
    const stop = await start();
    expect(native.plugin.isIgnoringBatteryOptimizations).toHaveBeenCalled();
    expect(getVendorFreezeHintSnapshot()).toMatchObject({
      ready: true,
      ignoringBatteryOptimizations: true,
      bell: null,
      settings: { variant: 'none' },
    });
    stop();
  });

  it('keeps listening until the last caller stops', async () => {
    seedUi();
    const stopA = await start();
    const stopB = startVendorFreezeHintStore();
    stopA();
    stopA();
    await resume();
    expect(native.plugin.getBackgroundSyncState).toHaveBeenCalledTimes(2);
    stopB();
    await resume();
    expect(native.plugin.getBackgroundSyncState).toHaveBeenCalledTimes(2);
  });

  it('pops the bell once per new card, not for a card from an earlier run', async () => {
    // An unacknowledged card an earlier run raised, shown on this cold start.
    seedUi({ cardShownAt: NOW - DAY, shownCount: 1 });
    nativeState.vendorFreezeRecent = [night(NOW - 2 * DAY), night(NOW - DAY)];
    const stop = await start();
    const earlier = getVendorFreezeHintSnapshot().bell;
    expect(earlier).toMatchObject({ badge: true, shownAt: NOW - DAY });
    expect(claimVendorFreezeCardPop(earlier?.shownAt ?? null)).toBe(false);
    expect(claimVendorFreezeCardPop(null)).toBe(false);

    // A card raised in this run pops once; a remount asks again: no pop.
    expect(claimVendorFreezeCardPop(NOW + HOUR)).toBe(true);
    expect(claimVendorFreezeCardPop(NOW + HOUR)).toBe(false);
    // The next card pops again.
    expect(claimVendorFreezeCardPop(NOW + 20 * DAY)).toBe(true);
    stop();
  });

  it('feeds React through useVendorFreezeHint', async () => {
    seedUi();
    nativeState.vendorFreezeRecent = [night(NOW - 2 * DAY), night(NOW - DAY)];
    const { result } = renderHook(() => useVendorFreezeHint());
    expect(result.current.ready).toBe(false);
    const stop = await start();
    expect(result.current).toMatchObject({
      ready: true,
      brand: 'vivo',
      bell: { badge: true },
    });
    const before = result.current;
    // An unchanged re-read keeps the same snapshot object.
    await resume();
    expect(result.current).toBe(before);
    stop();
  });
});
