import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_LOCK_DISABLED_STORAGE_KEY,
  AUTO_LOCK_LAST_ACTIVITY_STORAGE_KEY,
  AUTO_LOCK_PREFERENCE_CHANGE_EVENT,
  AUTO_LOCK_TIMEOUT_STORAGE_KEY,
  clearAutoLockLastActivityAt,
  isAutoLockDue,
  normalizeAutoLockTimeoutMinutes,
  readAutoLockLastActivityAt,
  readAutoLockTimeoutFromStorage,
  resolveAutoLockTimeoutMinutes,
  writeAutoLockLastActivityAt,
  writeAutoLockTimeoutToStorage,
} from './autoLock';

describe('auto-lock settings', () => {
  afterEach(() => {
    window.localStorage.removeItem(AUTO_LOCK_DISABLED_STORAGE_KEY);
    window.localStorage.removeItem(AUTO_LOCK_TIMEOUT_STORAGE_KEY);
    window.sessionStorage.removeItem(AUTO_LOCK_LAST_ACTIVITY_STORAGE_KEY);
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

  it('never treats a blank or null value as disabled', () => {
    expect(normalizeAutoLockTimeoutMinutes('')).toBe(30);
    expect(normalizeAutoLockTimeoutMinutes(null)).toBe(30);
    expect(normalizeAutoLockTimeoutMinutes('180')).toBe(180);
  });

  it('persists the selected timeout and notifies listeners', () => {
    const listener = vi.fn();
    window.addEventListener(AUTO_LOCK_PREFERENCE_CHANGE_EVENT, listener);
    expect(writeAutoLockTimeoutToStorage(180)).toBe(true);
    expect(readAutoLockTimeoutFromStorage()).toBe(180);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual({ timeoutMinutes: 180 });
    writeAutoLockTimeoutToStorage(0, { notify: false });
    expect(readAutoLockTimeoutFromStorage()).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTO_LOCK_PREFERENCE_CHANGE_EVENT, listener);
  });

  it('defaults to 30 minutes when nothing is stored', () => {
    expect(readAutoLockTimeoutFromStorage()).toBe(30);
  });

  it('migrates the legacy disabled flag from storage', () => {
    window.localStorage.setItem(AUTO_LOCK_DISABLED_STORAGE_KEY, 'true');
    expect(readAutoLockTimeoutFromStorage()).toBe(0);
    window.localStorage.setItem(AUTO_LOCK_TIMEOUT_STORAGE_KEY, '60');
    expect(readAutoLockTimeoutFromStorage()).toBe(60);
  });

  it('persists last-activity timestamps across watcher remounts', () => {
    writeAutoLockLastActivityAt(1_700_000_000_000);
    expect(readAutoLockLastActivityAt()).toBe(1_700_000_000_000);
    clearAutoLockLastActivityAt();
    expect(readAutoLockLastActivityAt(42)).toBe(42);
  });
});
