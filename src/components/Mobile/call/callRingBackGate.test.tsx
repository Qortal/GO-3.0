import { act, renderHook } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppLock } from '../../../hooks/useAppLock';
import { appLockedAtom, isIdleAtom } from '../../../atoms/presence';
import {
  clearAppLockLatch,
  clearAppSessionUnlocked,
  markAppSessionUnlocked,
} from '../../../lib/appLock';
import { ANDROID_BACK_EVENT } from '../../../bridge/capacitorBridge';
import { registerAndroidBackHandler } from '../../../utils/androidBack';
import {
  CALL_RING_BACK_PRIORITY,
  resetCallStripStoreForTests,
  setGoCallRingOverAppLock,
} from './goCallUi';

// GO's app lock stops Android back before any handler (the bridge then
// takes GO off screen). A call ringing over the lock is the exception: its
// back handler silences the ring, and nothing under the lock may react.

const ADDRESS = 'QgB7zMfujQMLkisp1Lc8PBkVYs75sYB3vV';
const registerBackAt = registerAndroidBackHandler as (
  handler: () => boolean,
  priority?: number
) => () => void;

const pressBack = () => {
  const event = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
  // true = nobody took it (the bridge minimizes GO).
  return window.dispatchEvent(event);
};

const store = getDefaultStore();

beforeEach(() => {
  store.set(appLockedAtom, false);
  store.set(isIdleAtom, false);
  markAppSessionUnlocked(ADDRESS);
  resetCallStripStoreForTests();
});

afterEach(() => {
  clearAppLockLatch();
  clearAppSessionUnlocked();
  window.sessionStorage.clear();
  resetCallStripStoreForTests();
});

describe('back over GO lock with a ringing call', () => {
  it('reaches the ring, never what is under the lock', () => {
    const underLock = vi.fn(() => true);
    const ring = vi.fn(() => true);
    const offUnder = registerBackAt(underLock);
    const offRing = registerBackAt(ring, CALL_RING_BACK_PRIORITY);
    try {
      const { result } = renderHook(() =>
        useAppLock({
          authenticated: true,
          mainWindow: true,
          walletAddress: ADDRESS,
          verifyPassword: async () => undefined,
        })
      );
      act(() => result.current.lockApp());

      // Locked, no ring: GO goes off screen, no handler runs.
      expect(pressBack()).toBe(true);
      expect(ring).not.toHaveBeenCalled();
      expect(underLock).not.toHaveBeenCalled();

      // Ring over the lock: the ring's handler takes it.
      setGoCallRingOverAppLock(true);
      expect(pressBack()).toBe(false);
      expect(ring).toHaveBeenCalledTimes(1);
      expect(underLock).not.toHaveBeenCalled();

      // Ring over: the lock gate is back.
      setGoCallRingOverAppLock(false);
      expect(pressBack()).toBe(true);
      expect(ring).toHaveBeenCalledTimes(1);
      expect(underLock).not.toHaveBeenCalled();
    } finally {
      offRing();
      offUnder();
    }
  });
});
