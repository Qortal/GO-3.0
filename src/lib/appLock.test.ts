import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appLockedAtom } from '../atoms/presence';
import {
  APP_LOCK_LATCH_STORAGE_KEY,
  APP_UNLOCKED_SESSION_STORAGE_KEY,
  LOCK_APP_NOW_EVENT,
  PENDING_DEEP_LINK_TTL_MS,
  canResumeSessionAtBoot,
  clearAppLockLatch,
  clearAppSessionUnlocked,
  isAppLockedNow,
  isAppSessionUnlocked,
  isLockScreenActive,
  isPendingDeepLinkFresh,
  markAppSessionUnlocked,
  parseAppLockLatch,
  prepareCrashReload,
  readAppLockLatch,
  readAppSessionUnlockedAddress,
  requestAppLockNow,
  resetWalletAutoSelectForReload,
  waitForAppUnlock,
  writeAppLockLatch,
  type BootResumeInput,
} from './appLock';
import {
  hasAttemptedLastWalletAutoSelectThisSession,
  markLastWalletAutoSelectAttemptedThisSession,
} from '../utils/lastAuthenticatedWallet';

const ADDRESS = 'QgB7zMfujQMLkisp1Lc8PBkVYs75sYB3vV';
const OTHER = 'QMjCNsctvWLoDdPSRpHn6TF2j96iDr9YWm';

afterEach(() => {
  clearAppLockLatch();
  clearAppSessionUnlocked();
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('lock latch', () => {
  it('is written to sessionStorage and localStorage', () => {
    writeAppLockLatch(` ${ADDRESS} `, 1_000);
    const expected = { address: ADDRESS, lockedAt: 1_000 };
    expect(
      JSON.parse(window.sessionStorage.getItem(APP_LOCK_LATCH_STORAGE_KEY)!)
    ).toEqual(expected);
    expect(
      JSON.parse(window.localStorage.getItem(APP_LOCK_LATCH_STORAGE_KEY)!)
    ).toEqual(expected);
    expect(readAppLockLatch()).toEqual(expected);
  });

  it('survives losing sessionStorage (app restart)', () => {
    writeAppLockLatch(ADDRESS, 1_000);
    window.sessionStorage.clear();
    expect(readAppLockLatch()).toEqual({ address: ADDRESS, lockedAt: 1_000 });
  });

  it('survives losing localStorage (only the tab survived)', () => {
    writeAppLockLatch(ADDRESS, 1_000);
    window.localStorage.clear();
    expect(readAppLockLatch()?.address).toBe(ADDRESS);
  });

  it('is gone from every store once cleared', () => {
    writeAppLockLatch(ADDRESS);
    clearAppLockLatch();
    expect(
      window.sessionStorage.getItem(APP_LOCK_LATCH_STORAGE_KEY)
    ).toBeNull();
    expect(window.localStorage.getItem(APP_LOCK_LATCH_STORAGE_KEY)).toBeNull();
    expect(readAppLockLatch()).toBeNull();
  });

  it('still locks when the stored value is damaged', () => {
    window.localStorage.setItem(APP_LOCK_LATCH_STORAGE_KEY, '{not json');
    expect(readAppLockLatch()).toEqual({ address: null, lockedAt: 0 });
    expect(parseAppLockLatch('')).toEqual({ address: null, lockedAt: 0 });
    expect(parseAppLockLatch(null)).toBeNull();
  });

  it('is kept in memory when Web Storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    writeAppLockLatch(ADDRESS, 5);
    expect(readAppLockLatch()).toEqual({ address: ADDRESS, lockedAt: 5 });
  });
});

describe('unlocked-session marker', () => {
  it('is per address and per tab (sessionStorage only)', () => {
    markAppSessionUnlocked(ADDRESS);
    expect(
      window.sessionStorage.getItem(APP_UNLOCKED_SESSION_STORAGE_KEY)
    ).toBe(ADDRESS);
    expect(
      window.localStorage.getItem(APP_UNLOCKED_SESSION_STORAGE_KEY)
    ).toBeNull();
    expect(isAppSessionUnlocked(ADDRESS)).toBe(true);
    expect(isAppSessionUnlocked(OTHER)).toBe(false);
    expect(isAppSessionUnlocked('')).toBe(false);
  });

  it('ignores an empty address', () => {
    markAppSessionUnlocked('  ');
    expect(readAppSessionUnlockedAddress()).toBeNull();
  });

  it('is cleared on lock and logout', () => {
    markAppSessionUnlocked(ADDRESS);
    clearAppSessionUnlocked();
    expect(isAppSessionUnlocked(ADDRESS)).toBe(false);
  });
});

describe('crash reload', () => {
  it('uses the same session key as the account picker', () => {
    markLastWalletAutoSelectAttemptedThisSession();
    expect(hasAttemptedLastWalletAutoSelectThisSession()).toBe(true);
    resetWalletAutoSelectForReload();
    expect(hasAttemptedLastWalletAutoSelectThisSession()).toBe(false);
  });

  it('drops the unlocked session and re-arms the picker unlock screen', () => {
    markAppSessionUnlocked(ADDRESS);
    markLastWalletAutoSelectAttemptedThisSession();
    prepareCrashReload();
    expect(isAppSessionUnlocked(ADDRESS)).toBe(false);
    expect(hasAttemptedLastWalletAutoSelectThisSession()).toBe(false);
  });
});

describe('canResumeSessionAtBoot', () => {
  const base: BootResumeInput = {
    walletAddress: ADDRESS,
    latch: null,
    unlockedSessionAddress: ADDRESS,
    lastActivityAt: 1_000,
    timeoutMinutes: 30,
    now: 1_000 + 60_000,
  };

  it('resumes a reload of a tab that was unlocked for this wallet', () => {
    expect(canResumeSessionAtBoot(base)).toBe(true);
    expect(canResumeSessionAtBoot({ ...base, lastActivityAt: null })).toBe(
      true
    );
  });

  it('never resumes while the app is locked (N-09)', () => {
    expect(
      canResumeSessionAtBoot({
        ...base,
        latch: { address: ADDRESS, lockedAt: 1 },
      })
    ).toBe(false);
    expect(
      canResumeSessionAtBoot({
        ...base,
        latch: { address: null, lockedAt: 0 },
      })
    ).toBe(false);
  });

  it('never resumes a cold start or a crash reload (no unlocked tab)', () => {
    expect(
      canResumeSessionAtBoot({ ...base, unlockedSessionAddress: null })
    ).toBe(false);
  });

  it('never resumes a different wallet than the one unlocked', () => {
    expect(
      canResumeSessionAtBoot({ ...base, unlockedSessionAddress: OTHER })
    ).toBe(false);
    expect(canResumeSessionAtBoot({ ...base, walletAddress: '' })).toBe(false);
  });

  it('never resumes once the idle timeout has passed', () => {
    expect(
      canResumeSessionAtBoot({
        ...base,
        now: base.lastActivityAt! + 30 * 60 * 1_000,
      })
    ).toBe(false);
  });

  it('keeps "Disabled" working as before', () => {
    expect(
      canResumeSessionAtBoot({
        ...base,
        timeoutMinutes: 0,
        now: base.lastActivityAt! + 24 * 60 * 60 * 1_000,
      })
    ).toBe(true);
  });
});

describe('isLockScreenActive', () => {
  const base = {
    authenticated: true,
    mainWindow: true,
    appLocked: false,
    latched: false,
    sessionUnlocked: true,
    verifiedEntryInFlight: false,
  };

  it('is down in a normal unlocked session', () => {
    expect(isLockScreenActive(base)).toBe(false);
  });

  it('is up while the app is locked', () => {
    expect(isLockScreenActive({ ...base, appLocked: true })).toBe(true);
  });

  it('locks a shell entered behind a stored latch without an unlock', () => {
    expect(isLockScreenActive({ ...base, latched: true })).toBe(true);
  });

  it('locks a shell this tab never unlocked (a session resumed with no check)', () => {
    expect(isLockScreenActive({ ...base, sessionUnlocked: false })).toBe(true);
    // A verified login writes the marker as it completes.
    expect(
      isLockScreenActive({
        ...base,
        sessionUnlocked: false,
        verifiedEntryInFlight: true,
      })
    ).toBe(false);
  });

  it('lets a verified password or fingerprint unlock through the latch', () => {
    expect(
      isLockScreenActive({
        ...base,
        latched: true,
        verifiedEntryInFlight: true,
      })
    ).toBe(false);
    // ...but never an explicit lock.
    expect(
      isLockScreenActive({
        ...base,
        appLocked: true,
        verifiedEntryInFlight: true,
      })
    ).toBe(true);
  });

  it('is never up outside the wallet (login screens)', () => {
    expect(
      isLockScreenActive({
        ...base,
        authenticated: false,
        appLocked: true,
        latched: true,
        sessionUnlocked: false,
      })
    ).toBe(false);
  });
});

describe('isPendingDeepLinkFresh', () => {
  it('keeps a link until the TTL has passed', () => {
    expect(isPendingDeepLinkFresh(null, 10)).toBe(true);
    expect(isPendingDeepLinkFresh(0, PENDING_DEEP_LINK_TTL_MS)).toBe(true);
    expect(isPendingDeepLinkFresh(0, PENDING_DEEP_LINK_TTL_MS + 1)).toBe(false);
  });
});

describe('requestAppLockNow', () => {
  it('asks App over the event bus', () => {
    const listener = vi.fn();
    document.addEventListener(LOCK_APP_NOW_EVENT, listener);
    requestAppLockNow();
    document.removeEventListener(LOCK_APP_NOW_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('lock state outside React', () => {
  const store = getDefaultStore();
  afterEach(() => store.set(appLockedAtom, false));

  it('reports the lock and waits for the unlock', async () => {
    expect(isAppLockedNow()).toBe(false);
    await expect(waitForAppUnlock()).resolves.toBeUndefined();

    store.set(appLockedAtom, true);
    expect(isAppLockedNow()).toBe(true);
    let released = false;
    const waiting = waitForAppUnlock().then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);

    store.set(appLockedAtom, false);
    await waiting;
    expect(released).toBe(true);
  });
});
