import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { appLockedAtom, isIdleAtom } from '../atoms/presence';
import {
  readAutoLockLastActivityAt,
  writeAutoLockLastActivityAt,
} from '../lib/autoLock';
import {
  LOCK_APP_NOW_EVENT,
  clearAppLockLatch,
  clearAppSessionUnlocked,
  isAppSessionUnlocked,
  isLockScreenActive,
  markAppSessionUnlocked,
  readAppLockLatch,
  resetWalletAutoSelectForReload,
  writeAppLockLatch,
} from '../lib/appLock';
import {
  createAppLockEventGate,
  installBackButtonLockGate,
} from '../lib/appLockEventGate';
import { createQappRequestLockGate } from '../lib/appLockQappGate';
import { ANDROID_BACK_EVENT } from '../bridge/capacitorBridge';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';

/** An approval dialog that must not wait behind the lock. */
export type LockedApproval = { open: boolean; decline: () => void };

type UseAppLockOptions = {
  authenticated: boolean;
  mainWindow: boolean;
  walletAddress?: string | null;
  /** Checks the wallet password; throws when it is wrong. */
  verifyPassword: (password: string) => Promise<void>;
  /** Declined, as if Decline had been tapped, while the lock is up. */
  approvals?: LockedApproval[];
  /** Runs when the app locks: close screens that must not merely hide. */
  onLock?: () => void;
};

/**
 * The app lock (N-09, GO-04, GO-39). Keeps the idle-timer policy App already
 * has, and adds:
 *
 * - a lock latch that survives a reload or restart, so neither resumes the
 *   wallet without the fingerprint or password (see `lib/appLock.ts`);
 * - "Lock now" over the event bus (`LOCK_APP_NOW_EVENT`);
 * - `lockScreenActive`, which also covers a shell this tab did not enter
 *   through a verified unlock (behind a latch, or with no unlocked-session
 *   marker for its wallet);
 * - while locked: approvals declined, deep links, notification taps and Q-App
 *   tab requests held until the unlock, every other Q-App request refused,
 *   and the Android back button kept away from the screens under the lock.
 */
export function useAppLock({
  authenticated,
  mainWindow,
  walletAddress,
  verifyPassword,
  approvals = [],
  onLock,
}: UseAppLockOptions) {
  const [isAppLocked, setIsAppLocked] = useAtom(appLockedAtom);
  const setIsIdle = useSetAtom(isIdleAtom);

  // Read before any effect runs: App clears the idle stamp at boot.
  const [bootLastActivityAt] = useState<number | null>(() => {
    // A reload while locked opens the account's unlock screen again.
    if (readAppLockLatch()) resetWalletAutoSelectForReload();
    return readAutoLockLastActivityAt(0) || null;
  });
  const [latched, setLatched] = useState(() => readAppLockLatch() !== null);
  const [verifiedEntryInFlight, setVerifiedEntryInFlight] = useState(false);

  const lockScreenActive = isLockScreenActive({
    authenticated,
    mainWindow,
    appLocked: isAppLocked,
    latched,
    // Read on every render: only verified unlocks write it, and logout or a
    // lock removes it.
    sessionUnlocked: isAppSessionUnlocked(walletAddress),
    verifiedEntryInFlight,
  });
  const lockScreenActiveRef = useRef(lockScreenActive);
  lockScreenActiveRef.current = lockScreenActive;
  /** Open and unlocked: Send/Receive and payment deep links need this. */
  const walletUnlocked = authenticated && mainWindow && !lockScreenActive;
  const walletUnlockedRef = useRef(walletUnlocked);
  walletUnlockedRef.current = walletUnlocked;
  const onLockRef = useRef(onLock);
  onLockRef.current = onLock;
  const walletAddressRef = useRef(walletAddress);
  walletAddressRef.current = walletAddress;

  /** A password or fingerprint check just let this wallet in. */
  const noteVerifiedWalletEntry = useCallback((address?: string | null) => {
    clearAppLockLatch();
    setLatched(false);
    markAppSessionUnlocked(address);
  }, []);

  /**
   * Runs a login that checks the password or fingerprint itself. The shell it
   * opens is not held behind the latch, and a success clears the latch.
   */
  const runVerifiedEntry = useCallback(
    async (
      login: () => Promise<boolean>,
      getAddress: () => string | null | undefined
    ): Promise<boolean> => {
      setVerifiedEntryInFlight(true);
      try {
        const unlocked = await login();
        if (unlocked) {
          noteVerifiedWalletEntry(getAddress() || walletAddressRef.current);
        }
        return unlocked;
      } finally {
        setVerifiedEntryInFlight(false);
      }
    },
    [noteVerifiedWalletEntry]
  );

  // Q-App requests are refused while locked (GO-04); see lib/appLockQappGate.
  const [qappGate] = useState(() =>
    createQappRequestLockGate({ isLocked: () => lockScreenActiveRef.current })
  );

  const lockApp = useCallback(() => {
    if (!authenticated || !mainWindow) return;
    writeAppLockLatch(walletAddress);
    clearAppSessionUnlocked();
    lockScreenActiveRef.current = true;
    // At once, not after the next render: a Q-App request in between would
    // still run.
    qappGate.engage();
    setLatched(true);
    onLockRef.current?.();
    setIsIdle(true);
    setIsAppLocked(true);
  }, [
    authenticated,
    mainWindow,
    qappGate,
    setIsAppLocked,
    setIsIdle,
    walletAddress,
  ]);

  const unlockApp = useCallback(
    async (password: string) => {
      await verifyPassword(password);
      // Clear idle before releasing the lock so the idle watcher cannot lock
      // the app again between these state updates.
      writeAutoLockLastActivityAt(Date.now());
      noteVerifiedWalletEntry(walletAddress);
      setIsIdle(false);
      setIsAppLocked(false);
    },
    [
      noteVerifiedWalletEntry,
      setIsAppLocked,
      setIsIdle,
      verifyPassword,
      walletAddress,
    ]
  );

  // A shell entered any way other than a verified unlock is locked; keep the
  // in-memory lock (presence, call overlays) in step.
  useEffect(() => {
    if (!lockScreenActive || isAppLocked) return;
    setIsIdle(true);
    setIsAppLocked(true);
  }, [isAppLocked, lockScreenActive, setIsAppLocked, setIsIdle]);

  // Q-App requests: refused for as long as the lock is up.
  useLayoutEffect(() => {
    if (!lockScreenActive) return undefined;
    qappGate.engage();
    return () => qappGate.release();
  }, [lockScreenActive, qappGate]);
  useEffect(() => () => qappGate.release(), [qappGate]);

  // The back button minimizes GO while locked; nothing under the lock reacts.
  useEffect(
    () =>
      installBackButtonLockGate({
        isLocked: () => lockScreenActiveRef.current,
        eventName: ANDROID_BACK_EVENT,
      }),
    []
  );

  // "Lock now" (phone account menu): the same lock as the idle timer.
  useEffect(() => {
    const onLockNow = () => lockApp();
    subscribeToEvent(LOCK_APP_NOW_EVENT, onLockNow);
    return () => unsubscribeFromEvent(LOCK_APP_NOW_EVENT, onLockNow);
  }, [lockApp]);

  // Deep links, notification taps and Q-App requests that open tabs or
  // viewers wait while locked and are delivered after the unlock.
  const [eventGate] = useState(() =>
    createAppLockEventGate({ isLocked: () => lockScreenActiveRef.current })
  );
  useEffect(() => eventGate.install(), [eventGate]);
  useEffect(() => {
    if (lockScreenActive) return;
    if (authenticated) eventGate.flush();
    else eventGate.clear();
  }, [authenticated, eventGate, lockScreenActive]);

  // Approvals never wait behind the lock: one that is open, or arrives, while
  // locked is declined, and the asking Q-App gets the answer to Decline.
  // Checked after every render while locked, so a request that replaces a
  // declined one in the same render is caught too.
  useEffect(() => {
    if (!lockScreenActive) return;
    approvals.forEach((approval) => {
      if (approval.open) approval.decline();
    });
  }, [approvals, lockScreenActive]);

  return {
    isAppLocked,
    lockScreenActive,
    walletUnlocked,
    walletUnlockedRef,
    bootLastActivityAt,
    lockApp,
    unlockApp,
    runVerifiedEntry,
    noteVerifiedWalletEntry,
  };
}
