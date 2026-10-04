import { act, renderHook } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppLock, type LockedApproval } from './useAppLock';
import { appLockedAtom, isIdleAtom } from '../atoms/presence';
import {
  clearAppLockLatch,
  clearAppSessionUnlocked,
  isAppSessionUnlocked,
  markAppSessionUnlocked,
  readAppLockLatch,
  requestAppLockNow,
  writeAppLockLatch,
} from '../lib/appLock';
import { AUTO_LOCK_LAST_ACTIVITY_STORAGE_KEY } from '../lib/autoLock';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../utils/events';
import {
  hasAttemptedLastWalletAutoSelectThisSession,
  markLastWalletAutoSelectAttemptedThisSession,
} from '../utils/lastAuthenticatedWallet';
import { ANDROID_BACK_EVENT } from '../bridge/capacitorBridge';
import { registerAndroidBackHandler } from '../utils/androidBack';

const ADDRESS = 'QgB7zMfujQMLkisp1Lc8PBkVYs75sYB3vV';
const PASSWORD = 'correct horse';

type Props = Parameters<typeof useAppLock>[0];

const baseProps = (overrides: Partial<Props> = {}): Props => ({
  authenticated: true,
  mainWindow: true,
  walletAddress: ADDRESS,
  verifyPassword: async (password) => {
    if (password !== PASSWORD) throw new Error('wrong password');
  },
  ...overrides,
});

const mount = (overrides: Partial<Props> = {}) =>
  renderHook((props: Props) => useAppLock(props), {
    initialProps: baseProps(overrides),
  });

const store = getDefaultStore();

beforeEach(() => {
  store.set(appLockedAtom, false);
  store.set(isIdleAtom, false);
  // An unlocked session: this tab let the wallet in with a password check.
  markAppSessionUnlocked(ADDRESS);
});

afterEach(() => {
  clearAppLockLatch();
  clearAppSessionUnlocked();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('useAppLock', () => {
  it('locks like the idle timer and stores a latch that outlives the page', () => {
    const onLock = vi.fn();
    const { result } = mount({ onLock });
    expect(result.current.lockScreenActive).toBe(false);

    act(() => result.current.lockApp());

    expect(result.current.lockScreenActive).toBe(true);
    expect(result.current.walletUnlocked).toBe(false);
    expect(store.get(appLockedAtom)).toBe(true);
    expect(store.get(isIdleAtom)).toBe(true);
    expect(readAppLockLatch()?.address).toBe(ADDRESS);
    expect(isAppSessionUnlocked(ADDRESS)).toBe(false);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('does nothing outside the wallet', () => {
    const { result } = mount({ authenticated: false });
    act(() => result.current.lockApp());
    expect(store.get(appLockedAtom)).toBe(false);
    expect(readAppLockLatch()).toBeNull();
  });

  it('locks from "Lock now" in the account menu', () => {
    const { result } = mount();
    expect(result.current.lockScreenActive).toBe(false);
    act(() => requestAppLockNow());
    expect(result.current.lockScreenActive).toBe(true);
    expect(readAppLockLatch()).not.toBeNull();
  });

  it('unlocks only with the right password, and clears the latch', async () => {
    const { result } = mount();
    act(() => result.current.lockApp());

    let error: unknown = null;
    await act(async () => {
      try {
        await result.current.unlockApp('guess');
      } catch (err) {
        error = err;
      }
    });
    expect(String(error)).toContain('wrong password');
    expect(result.current.lockScreenActive).toBe(true);
    expect(readAppLockLatch()).not.toBeNull();

    await act(() => result.current.unlockApp(PASSWORD));
    expect(result.current.lockScreenActive).toBe(false);
    expect(store.get(appLockedAtom)).toBe(false);
    expect(readAppLockLatch()).toBeNull();
    expect(isAppSessionUnlocked(ADDRESS)).toBe(true);
    expect(
      Number(window.sessionStorage.getItem(AUTO_LOCK_LAST_ACTIVITY_STORAGE_KEY))
    ).toBeGreaterThan(0);
  });

  it('keeps the lock across a reload: an unverified way in shows the lock screen (N-09)', () => {
    const first = mount();
    act(() => first.result.current.lockApp());
    first.unmount();
    // Reload: the in-memory lock is gone, the latch is not.
    store.set(appLockedAtom, false);
    markLastWalletAutoSelectAttemptedThisSession();

    const { result } = mount({ authenticated: false });
    // The picker will open the account's unlock screen again.
    expect(hasAttemptedLastWalletAutoSelectThisSession()).toBe(false);
    expect(result.current.lockScreenActive).toBe(false);

    // Something puts the shell up without a password or fingerprint.
    const { result: entered } = mount();
    expect(entered.current.lockScreenActive).toBe(true);
    expect(entered.current.walletUnlocked).toBe(false);
    expect(store.get(appLockedAtom)).toBe(true);
  });

  it('lets a verified password or fingerprint login through the latch, with no lock flash', async () => {
    writeAppLockLatch(ADDRESS);
    clearAppSessionUnlocked();
    const { result, rerender } = mount({ authenticated: false });
    const seenWhileLoggingIn: boolean[] = [];

    await act(async () => {
      const unlocked = await result.current.runVerifiedEntry(
        async () => {
          rerender(baseProps({ authenticated: true }));
          seenWhileLoggingIn.push(result.current.lockScreenActive);
          return true;
        },
        () => ADDRESS
      );
      expect(unlocked).toBe(true);
    });

    expect(seenWhileLoggingIn).toEqual([false]);
    expect(result.current.lockScreenActive).toBe(false);
    expect(readAppLockLatch()).toBeNull();
    expect(isAppSessionUnlocked(ADDRESS)).toBe(true);
    expect(store.get(appLockedAtom)).toBe(false);
  });

  it('keeps the latch when the login fails', async () => {
    writeAppLockLatch(ADDRESS);
    const { result } = mount({ authenticated: false });
    await act(async () => {
      await result.current.runVerifiedEntry(
        async () => false,
        () => ADDRESS
      );
    });
    expect(readAppLockLatch()).not.toBeNull();
  });

  it('declines approval dialogs while locked, as a tap on Decline would (GO-04)', () => {
    const decline = vi.fn();
    const approvals: LockedApproval[] = [{ open: true, decline }];
    const { result, rerender } = mount({ approvals });
    expect(decline).not.toHaveBeenCalled();

    act(() => result.current.lockApp());
    expect(decline).toHaveBeenCalledTimes(1);

    // A new request that arrives behind the lock is declined too.
    const late = vi.fn();
    rerender(baseProps({ approvals: [{ open: true, decline: late }] }));
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('holds deep-linked tabs while locked and opens them after the unlock', async () => {
    const addTab = vi.fn();
    subscribeToEvent('addTab', addTab);
    try {
      const { result } = mount();
      act(() => result.current.lockApp());
      act(() => executeEvent('addTab', { data: { name: 'Evil' } }));
      expect(addTab).not.toHaveBeenCalled();

      await act(() => result.current.unlockApp(PASSWORD));
      expect(addTab).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribeFromEvent('addTab', addTab);
    }
  });

  it('locks a shell this tab never unlocked, with no latch either (N-09)', async () => {
    // A stored session resumed without a password or fingerprint check (the
    // syncing-node dialog's Continue), after a crash Reload or a cold start.
    clearAppSessionUnlocked();
    const { result } = mount();
    expect(result.current.lockScreenActive).toBe(true);
    expect(result.current.walletUnlocked).toBe(false);
    expect(store.get(appLockedAtom)).toBe(true);
    // Being on screen does not make it an unlocked session.
    expect(isAppSessionUnlocked(ADDRESS)).toBe(false);

    await act(() => result.current.unlockApp(PASSWORD));
    expect(result.current.lockScreenActive).toBe(false);
    expect(isAppSessionUnlocked(ADDRESS)).toBe(true);
  });

  it('marks the wallet on screen when a verified login names no address', async () => {
    clearAppSessionUnlocked();
    const { result, rerender } = mount({ authenticated: false });
    await act(async () => {
      await result.current.runVerifiedEntry(
        async () => {
          rerender(baseProps({ authenticated: true }));
          return true;
        },
        () => undefined
      );
    });
    expect(isAppSessionUnlocked(ADDRESS)).toBe(true);
    expect(result.current.lockScreenActive).toBe(false);
  });

  it('keeps the back button away from the screens under the lock', async () => {
    const handler = vi.fn(() => true);
    const unregister = registerAndroidBackHandler(handler);
    const pressBack = () => {
      const event = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
      // The bridge minimizes GO when this returns true.
      return window.dispatchEvent(event);
    };
    try {
      const { result } = mount();
      act(() => result.current.lockApp());
      expect(pressBack()).toBe(true);
      expect(handler).not.toHaveBeenCalled();

      await act(() => result.current.unlockApp(PASSWORD));
      expect(pressBack()).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
    }
  });

  it('refuses Q-App requests from the moment it locks until the unlock (GO-04)', async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const frameWindow = frame.contentWindow as Window;
    const goHandler = vi.fn();
    frameWindow.addEventListener('message', goHandler);
    const request = (port?: { postMessage: () => void }) => {
      const event = new MessageEvent('message', {
        data: { action: 'GET_USER_ACCOUNT', requestedHandler: 'UI' },
      });
      Object.defineProperty(event, 'ports', { value: port ? [port] : [] });
      return event;
    };
    try {
      const { result } = mount();
      frameWindow.dispatchEvent(request());
      expect(goHandler).toHaveBeenCalledTimes(1);

      const port = { postMessage: vi.fn() };
      act(() => {
        result.current.lockApp();
        // Before React has rendered the lock.
        frameWindow.dispatchEvent(request(port));
      });
      frameWindow.dispatchEvent(request());
      expect(goHandler).toHaveBeenCalledTimes(1);
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ result: null })
      );

      await act(() => result.current.unlockApp(PASSWORD));
      frameWindow.dispatchEvent(request());
      expect(goHandler).toHaveBeenCalledTimes(2);
    } finally {
      frameWindow.removeEventListener('message', goHandler);
      frame.remove();
    }
  });
});
