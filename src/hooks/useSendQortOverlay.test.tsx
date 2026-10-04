import { act, renderHook } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSendQortOverlay } from './useSendQortOverlay';
import { useAppLock } from './useAppLock';
import { appLockedAtom, isIdleAtom } from '../atoms/presence';
import {
  PENDING_DEEP_LINK_TTL_MS,
  clearAppLockLatch,
  clearAppSessionUnlocked,
  markAppSessionUnlocked,
} from '../lib/appLock';
import {
  clearPendingJoinGroupRequest,
  clearPendingPaymentRequest,
  getPendingJoinGroupRequest,
  getPendingPaymentRequest,
  handleQortalDeepLink,
} from '../utils/paymentLink';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';

// src/test/setup.ts stubs asmcrypto out; link parsing checks addresses.
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);

const ADDRESS = 'QgB7zMfujQMLkisp1Lc8PBkVYs75sYB3vV';
// A registered name: links may name the recipient instead of an address.
const RECIPIENT = 'AliceShop';
const PASSWORD = 'correct horse';
const PAY_LINK = `qortal://pay?recipient=${RECIPIENT}&amount=1.5`;

type HarnessProps = { authenticated: boolean };

const store = getDefaultStore();
let clock = 1_000_000;

/** App's wiring: the lock decides when the wallet is open and unlocked. */
const useHarness = ({ authenticated }: HarnessProps) => {
  const lock = useAppLock({
    authenticated,
    mainWindow: true,
    walletAddress: authenticated ? ADDRESS : null,
    verifyPassword: async (password) => {
      if (password !== PASSWORD) throw new Error('wrong password');
    },
  });
  const send = useSendQortOverlay({
    walletUnlocked: lock.walletUnlocked,
    walletUnlockedRef: lock.walletUnlockedRef,
    address: authenticated ? ADDRESS : '',
    now: () => clock,
  });
  return { lock, send };
};

const mount = (authenticated: boolean) =>
  renderHook((props: HarnessProps) => useHarness(props), {
    initialProps: { authenticated },
  });

beforeEach(() => {
  clock = 1_000_000;
  store.set(appLockedAtom, false);
  store.set(isIdleAtom, false);
  markAppSessionUnlocked(ADDRESS);
});

afterEach(() => {
  clearPendingPaymentRequest();
  clearPendingJoinGroupRequest();
  clearAppLockLatch();
  clearAppSessionUnlocked();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('useSendQortOverlay (GO-10)', () => {
  it('opens a payment link at the login screen only after the login', () => {
    const { result, rerender } = mount(false);
    act(() => {
      handleQortalDeepLink(PAY_LINK);
    });
    expect(result.current.send.isOpen).toBe(false);

    // The verified login wrote the marker (see beforeEach).
    rerender({ authenticated: true });
    expect(result.current.send.isOpen).toBe(true);
    expect(result.current.send.paymentTo).toBe(RECIPIENT);
    expect(result.current.send.paymentAmount).toBe(1.5);
    expect(getPendingPaymentRequest()).toBeNull();
  });

  it('holds a payment link that arrives while locked and opens Send after the unlock', async () => {
    const { result } = mount(true);
    act(() => result.current.lock.lockApp());
    act(() => {
      handleQortalDeepLink(PAY_LINK);
    });
    expect(result.current.send.isOpen).toBe(false);

    await act(() => result.current.lock.unlockApp(PASSWORD));
    expect(result.current.send.isOpen).toBe(true);
    expect(result.current.send.paymentTo).toBe(RECIPIENT);
  });

  it('drops a waiting link once it has gone stale', async () => {
    const { result } = mount(true);
    act(() => result.current.lock.lockApp());
    act(() => {
      handleQortalDeepLink(PAY_LINK);
    });
    clock += PENDING_DEEP_LINK_TTL_MS + 1;

    await act(() => result.current.lock.unlockApp(PASSWORD));
    expect(result.current.send.isOpen).toBe(false);
    expect(getPendingPaymentRequest()).toBeNull();
  });

  it('closing Send only closes it and forgets the recipient', () => {
    const { result } = mount(true);
    act(() => {
      handleQortalDeepLink(PAY_LINK);
    });
    expect(result.current.send.isOpen).toBe(true);

    act(() => result.current.send.close());
    expect(result.current.send.isOpen).toBe(false);
    expect(result.current.send.paymentTo).toBe('');
    expect(result.current.send.paymentAmount).toBeUndefined();
    // Still signed in and unlocked: nothing about the session changed.
    expect(result.current.lock.walletUnlocked).toBe(true);
    expect(result.current.lock.lockScreenActive).toBe(false);
  });

  it('starts the next Send empty after a payment and Continue', () => {
    const { result } = mount(true);
    act(() => {
      handleQortalDeepLink(PAY_LINK);
    });
    act(() => result.current.send.markSent());
    expect(result.current.send.isOpen).toBe(false);
    expect(result.current.send.isSuccessOpen).toBe(true);

    act(() => result.current.send.continueAfterSuccess());
    expect(result.current.send.isSuccessOpen).toBe(false);

    act(() => result.current.send.openManual());
    expect(result.current.send.isOpen).toBe(true);
    expect(result.current.send.paymentTo).toBe('');
    expect(result.current.send.paymentAmount).toBeUndefined();
  });

  it('opens a manual Send empty even after Send was left prefilled', () => {
    const { result } = mount(true);
    act(() => {
      handleQortalDeepLink(PAY_LINK);
    });
    act(() => result.current.send.openManual());
    expect(result.current.send.paymentTo).toBe('');
    expect(result.current.send.paymentAmount).toBeUndefined();
  });

  it('does not open a delivered link again on the next login', () => {
    const { result, rerender } = mount(true);
    act(() => {
      handleQortalDeepLink(PAY_LINK);
    });
    act(() => result.current.send.close());

    rerender({ authenticated: false });
    act(() => result.current.send.closeAll());
    rerender({ authenticated: true });
    expect(result.current.send.isOpen).toBe(false);
  });

  it('delivers a join-group link held by the lock exactly once', async () => {
    const joinGroup = vi.fn();
    subscribeToEvent('globalActionJoinGroup', joinGroup);
    try {
      const { result } = mount(true);
      act(() => result.current.lock.lockApp());
      act(() => {
        handleQortalDeepLink('qortal://use-group/action-join/groupid-42');
      });
      expect(joinGroup).not.toHaveBeenCalled();

      await act(() => result.current.lock.unlockApp(PASSWORD));
      expect(joinGroup).toHaveBeenCalledTimes(1);
      expect(joinGroup.mock.calls[0][0].detail).toEqual({ groupId: '42' });
      expect(getPendingJoinGroupRequest()).toBeNull();
    } finally {
      unsubscribeFromEvent('globalActionJoinGroup', joinGroup);
    }
  });
});
