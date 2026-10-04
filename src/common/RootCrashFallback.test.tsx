import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RootCrashFallback from './RootCrashFallback';
import {
  clearAppSessionUnlocked,
  isAppSessionUnlocked,
  markAppSessionUnlocked,
} from '../lib/appLock';
import {
  hasAttemptedLastWalletAutoSelectThisSession,
  markLastWalletAutoSelectAttemptedThisSession,
} from '../utils/lastAuthenticatedWallet';

const ADDRESS = 'QgB7zMfujQMLkisp1Lc8PBkVYs75sYB3vV';

describe('RootCrashFallback', () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    clearAppSessionUnlocked();
    window.sessionStorage.clear();
  });

  it('reloads into the fingerprint/password unlock, never the open wallet (N-09)', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    });
    markAppSessionUnlocked(ADDRESS);
    markLastWalletAutoSelectAttemptedThisSession();

    render(<RootCrashFallback error={new Error('boom')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(reload).toHaveBeenCalledTimes(1);
    // No resume on the next boot, and the picker opens the unlock screen.
    expect(isAppSessionUnlocked(ADDRESS)).toBe(false);
    expect(hasAttemptedLastWalletAutoSelectThisSession()).toBe(false);
  });
});
