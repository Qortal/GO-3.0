import { getDefaultStore } from 'jotai';
import { appLockedAtom } from '../atoms/presence';
import { executeEvent } from '../utils/events';
import { isAutoLockDue, type AutoLockTimeoutMinutes } from './autoLock';

/**
 * App lock state that has to outlive the React tree.
 *
 * The lock itself (`appLockedAtom`) lives in memory, so on its own it does not
 * survive a page reload: a reload used to land back in the unlocked wallet
 * through App's boot resume (`getWalletInfo` → 'authenticated'). Two small
 * records close that:
 *
 * - The lock latch, written when the app locks and removed only by a verified
 *   unlock (password or fingerprint). It is kept in sessionStorage and
 *   localStorage, so it survives an in-page reload and an app restart. While
 *   it is set, the boot resume is skipped, and any other way into the
 *   authenticated shell shows the lock screen.
 * - The unlocked-session marker, sessionStorage only: "this tab had an
 *   unlocked session for this address". Only a verified unlock writes it. The
 *   boot resume needs it, so a cold start (fresh WebView) or a reload after a
 *   crash always goes through the normal fingerprint/password login, and an
 *   authenticated shell without it (a stored session resumed with no check)
 *   shows the lock screen.
 */

/** sessionStorage + localStorage key for the lock latch. */
export const APP_LOCK_LATCH_STORAGE_KEY = 'go_app_lock_latch_v1';
/** sessionStorage key for the unlocked-session marker. */
export const APP_UNLOCKED_SESSION_STORAGE_KEY = 'go_app_unlocked_session_v1';
/**
 * Same key as `utils/lastAuthenticatedWallet.ts` (not exported there); the
 * test suite checks the two stay in step.
 */
const WALLET_AUTO_SELECT_SESSION_KEY =
  'qortal:last-authenticated-wallet-auto-select-attempted';

/** Event-bus name for "lock the app now" (phone account menu). */
export const LOCK_APP_NOW_EVENT = 'lockAppNow';

/**
 * Stacking order of the lock screen: above every dialog (MUI modals sit at
 * 50000, the PDF viewer at 990000000, the avatar cropper at 2147483000) and
 * below only the root crash screen, which replaces the whole tree anyway.
 */
export const APP_LOCK_SCREEN_Z_INDEX = 2147483600;

/** A deep link that arrived before the wallet was unlocked expires after this. */
export const PENDING_DEEP_LINK_TTL_MS = 10 * 60 * 1_000;

export type AppLockLatch = {
  /** Wallet that was locked; null when unknown or unreadable. */
  address: string | null;
  lockedAt: number;
};

type StorageName = 'sessionStorage' | 'localStorage';
const LATCH_STORES: StorageName[] = ['sessionStorage', 'localStorage'];

const getStore = (name: StorageName): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window[name] ?? null;
  } catch {
    return null;
  }
};

const normalizeAddress = (address?: string | null): string =>
  typeof address === 'string' ? address.trim() : '';

/** In-memory mirrors, for when Web Storage is unavailable or throws. */
let memoryLatch: AppLockLatch | null = null;
let memoryUnlockedAddress: string | null = null;

/** Parse a stored latch. Anything present but unreadable still counts. */
export function parseAppLockLatch(raw: string | null): AppLockLatch | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    const address = normalizeAddress(parsed?.address) || null;
    const lockedAt = Number(parsed?.lockedAt);
    return {
      address,
      lockedAt: Number.isFinite(lockedAt) && lockedAt > 0 ? lockedAt : 0,
    };
  } catch {
    // Fail closed: a damaged latch keeps the lock until a verified unlock.
    return { address: null, lockedAt: 0 };
  }
}

export function writeAppLockLatch(
  address?: string | null,
  now = Date.now()
): void {
  const latch: AppLockLatch = {
    address: normalizeAddress(address) || null,
    lockedAt: now,
  };
  memoryLatch = latch;
  const raw = JSON.stringify(latch);
  for (const name of LATCH_STORES) {
    try {
      getStore(name)?.setItem(APP_LOCK_LATCH_STORAGE_KEY, raw);
    } catch {
      /* quota / private mode: the other store and memory still hold it */
    }
  }
}

export function readAppLockLatch(): AppLockLatch | null {
  for (const name of LATCH_STORES) {
    try {
      const latch = parseAppLockLatch(
        getStore(name)?.getItem(APP_LOCK_LATCH_STORAGE_KEY) ?? null
      );
      if (latch) return latch;
    } catch {
      /* unreadable store: try the next one */
    }
  }
  return memoryLatch;
}

/** Only after a verified unlock (password or fingerprint). */
export function clearAppLockLatch(): void {
  memoryLatch = null;
  for (const name of LATCH_STORES) {
    try {
      getStore(name)?.removeItem(APP_LOCK_LATCH_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function markAppSessionUnlocked(address?: string | null): void {
  const normalized = normalizeAddress(address);
  if (!normalized) return;
  memoryUnlockedAddress = normalized;
  try {
    getStore('sessionStorage')?.setItem(
      APP_UNLOCKED_SESSION_STORAGE_KEY,
      normalized
    );
  } catch {
    /* memory mirror still covers this page */
  }
}

export function readAppSessionUnlockedAddress(): string | null {
  try {
    const stored = normalizeAddress(
      getStore('sessionStorage')?.getItem(APP_UNLOCKED_SESSION_STORAGE_KEY)
    );
    if (stored) return stored;
  } catch {
    /* fall back to memory */
  }
  return memoryUnlockedAddress;
}

export function isAppSessionUnlocked(address?: string | null): boolean {
  const normalized = normalizeAddress(address);
  return Boolean(normalized) && readAppSessionUnlockedAddress() === normalized;
}

export function clearAppSessionUnlocked(): void {
  memoryUnlockedAddress = null;
  try {
    getStore('sessionStorage')?.removeItem(APP_UNLOCKED_SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Let the account picker auto-open the top wallet's unlock screen again. */
export function resetWalletAutoSelectForReload(): void {
  try {
    getStore('sessionStorage')?.removeItem(WALLET_AUTO_SELECT_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Before the crash screen reloads the page: the reload must not resume the
 * wallet (a Q-App can crash GO on purpose), and the picker should offer the
 * fingerprint/password unlock straight away.
 */
export function prepareCrashReload(): void {
  clearAppSessionUnlocked();
  resetWalletAutoSelectForReload();
}

export type BootResumeInput = {
  /** Address of the wallet the background still holds keys for. */
  walletAddress?: string | null;
  latch: AppLockLatch | null;
  unlockedSessionAddress: string | null;
  /** Last recorded user activity, or null when there is none. */
  lastActivityAt: number | null;
  timeoutMinutes: AutoLockTimeoutMinutes;
  now: number;
};

/**
 * May App's boot code put a wallet whose keys are still stored straight back
 * into the authenticated shell, without a password or fingerprint? Only for a
 * reload of a tab that was unlocked for that same wallet, never while locked,
 * and never once the idle timeout has passed.
 */
export function canResumeSessionAtBoot({
  walletAddress,
  latch,
  unlockedSessionAddress,
  lastActivityAt,
  timeoutMinutes,
  now,
}: BootResumeInput): boolean {
  const address = normalizeAddress(walletAddress);
  if (!address) return false;
  if (latch) return false;
  if (normalizeAddress(unlockedSessionAddress) !== address) return false;
  if (
    lastActivityAt != null &&
    lastActivityAt > 0 &&
    isAutoLockDue(lastActivityAt, now, timeoutMinutes)
  ) {
    return false;
  }
  return true;
}

export type LockScreenInput = {
  authenticated: boolean;
  mainWindow: boolean;
  /** The in-memory lock (`appLockedAtom`). */
  appLocked: boolean;
  /** A lock latch is stored. */
  latched: boolean;
  /**
   * This tab holds the unlocked-session marker for the wallet on screen: a
   * password or fingerprint check let it in (see `markAppSessionUnlocked`).
   */
  sessionUnlocked: boolean;
  /** A password/fingerprint unlock is completing right now. */
  verifiedEntryInFlight: boolean;
};

/**
 * Is the lock screen up? Besides the in-memory lock, any authenticated shell
 * that this tab did not enter through a verified unlock is locked, in the same
 * render, so nothing of the wallet shows before the lock: one entered behind
 * a stored latch, and one with no unlocked-session marker for its wallet (a
 * session resumed without a password or fingerprint check).
 */
export function isLockScreenActive({
  authenticated,
  mainWindow,
  appLocked,
  latched,
  sessionUnlocked,
  verifiedEntryInFlight,
}: LockScreenInput): boolean {
  if (!authenticated || !mainWindow) return false;
  if (appLocked) return true;
  return (latched || !sessionUnlocked) && !verifiedEntryInFlight;
}

/** Is a deep link noticed at `seenAt` still worth opening at `now`? */
export function isPendingDeepLinkFresh(
  seenAt: number | null,
  now: number,
  ttlMs = PENDING_DEEP_LINK_TTL_MS
): boolean {
  if (seenAt == null) return true;
  return now - seenAt <= ttlMs;
}

/** Ask App to lock now, exactly as the idle timer does. */
export function requestAppLockNow(): void {
  executeEvent(LOCK_APP_NOW_EVENT, {});
}

/**
 * Is the lock screen up? For code outside React, such as the Q-App request
 * handlers: a request that runs without a prompt must not run while locked.
 */
export function isAppLockedNow(): boolean {
  return getDefaultStore().get(appLockedAtom);
}

/** Resolves once the app is unlocked (at once when it is not locked). */
export function waitForAppUnlock(): Promise<void> {
  const store = getDefaultStore();
  if (!store.get(appLockedAtom)) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = store.sub(appLockedAtom, () => {
      if (store.get(appLockedAtom)) return;
      unsubscribe();
      resolve();
    });
  });
}
