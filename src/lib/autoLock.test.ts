import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_LOCK_DISABLED_STORAGE_KEY,
  AUTO_LOCK_PREFERENCE_CHANGE_EVENT,
  isAutoLockDue,
  normalizeAutoLockTimeoutMinutes,
  readAutoLockDisabledFromStorage,
  resolveAutoLockTimeoutMinutes,
  timeoutMinutesForAutoLockDisabled,
  writeAutoLockDisabledToStorage,
} from './autoLock';

describe('auto-lock settings', () => {
  afterEach(() => {
    window.localStorage.removeItem(AUTO_LOCK_DISABLED_STORAGE_KEY);
  });

  it('defaults invalid or missing values to 30 minutes', () => {
    expect(normalizeAutoLockTimeoutMinutes(undefined)).toBe(30);
    expect(normalizeAutoLockTimeoutMinutes(15)).toBe(30);
  });

  it('accepts every supported timeout', () => {
    expect([0, 10, 30, 60, 180].map(normalizeAutoLockTimeoutMinutes)).toEqual([
      0, 10, 30, 60, 180,
    ]);
  });

  it('migrates the previous disabled preference', () => {
    expect(resolveAutoLockTimeoutMinutes(undefined, true)).toBe(0);
    expect(resolveAutoLockTimeoutMinutes(undefined, false)).toBe(30);
    expect(resolveAutoLockTimeoutMinutes(60, true)).toBe(60);
  });

  it('never locks automatically when disabled', () => {
    expect(isAutoLockDue(0, 24 * 60 * 60 * 1_000, 0)).toBe(false);
  });

  it('locks once the selected inactivity period has elapsed', () => {
    expect(isAutoLockDue(1_000, 10 * 60 * 1_000, 10)).toBe(false);
    expect(isAutoLockDue(1_000, 10 * 60 * 1_000 + 1_000, 10)).toBe(true);
  });

  it('maps the disable toggle to a timeout of 0 or the default 30', () => {
    expect(timeoutMinutesForAutoLockDisabled(true)).toBe(0);
    expect(timeoutMinutesForAutoLockDisabled(false)).toBe(30);
  });

  it('persists the disable toggle and notifies listeners', () => {
    const listener = vi.fn();
    window.addEventListener(AUTO_LOCK_PREFERENCE_CHANGE_EVENT, listener);
    writeAutoLockDisabledToStorage(true);
    expect(readAutoLockDisabledFromStorage()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    writeAutoLockDisabledToStorage(false, { notify: false });
    expect(readAutoLockDisabledFromStorage()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTO_LOCK_PREFERENCE_CHANGE_EVENT, listener);
  });
});
