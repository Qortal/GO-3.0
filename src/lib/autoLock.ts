export const AUTO_LOCK_TIMEOUT_OPTIONS = [0, 10, 30, 60, 180] as const;

export type AutoLockTimeoutMinutes =
  (typeof AUTO_LOCK_TIMEOUT_OPTIONS)[number];

export const DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES: AutoLockTimeoutMinutes = 30;

/** localStorage key shared by System Settings and the App idle watcher. */
export const AUTO_LOCK_DISABLED_STORAGE_KEY = 'hub_auto_lock_disabled';

/**
 * sessionStorage key for the idle watcher's last user-activity timestamp.
 * Survives React effect remounts so a settings re-render cannot reset the
 * idle clock (and delay the lock screen after a long screen-off).
 */
export const AUTO_LOCK_LAST_ACTIVITY_STORAGE_KEY =
  'hub_auto_lock_last_activity_at';

/** Fired after the settings toggle writes a new preference. */
export const AUTO_LOCK_PREFERENCE_CHANGE_EVENT =
  'qortal:auto-lock-preference-changed';

export function readAutoLockDisabledFromStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(AUTO_LOCK_DISABLED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeAutoLockDisabledToStorage(
  disabled: boolean,
  options?: { notify?: boolean }
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      AUTO_LOCK_DISABLED_STORAGE_KEY,
      disabled ? 'true' : 'false'
    );
    if (options?.notify !== false) {
      window.dispatchEvent(
        new CustomEvent(AUTO_LOCK_PREFERENCE_CHANGE_EVENT, {
          detail: { disabled },
        })
      );
    }
  } catch (error) {
    console.warn('Unable to persist auto-lock preference.', error);
  }
}

export function timeoutMinutesForAutoLockDisabled(
  disabled: boolean
): AutoLockTimeoutMinutes {
  return disabled ? 0 : DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES;
}

export function normalizeAutoLockTimeoutMinutes(
  value: unknown
): AutoLockTimeoutMinutes {
  const numericValue = Number(value);
  return AUTO_LOCK_TIMEOUT_OPTIONS.includes(
    numericValue as AutoLockTimeoutMinutes
  )
    ? (numericValue as AutoLockTimeoutMinutes)
    : DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES;
}

export function resolveAutoLockTimeoutMinutes(
  value: unknown,
  legacyDisabled: boolean
): AutoLockTimeoutMinutes {
  return value == null
    ? legacyDisabled
      ? 0
      : DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES
    : normalizeAutoLockTimeoutMinutes(value);
}

export function isAutoLockDue(
  lastActivityAt: number,
  now: number,
  timeoutMinutes: AutoLockTimeoutMinutes
): boolean {
  return (
    timeoutMinutes > 0 &&
    now - lastActivityAt >= timeoutMinutes * 60 * 1_000
  );
}

export function readAutoLockLastActivityAt(fallback = Date.now()): number {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.sessionStorage.getItem(
      AUTO_LOCK_LAST_ACTIVITY_STORAGE_KEY
    );
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writeAutoLockLastActivityAt(timestamp: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      AUTO_LOCK_LAST_ACTIVITY_STORAGE_KEY,
      String(timestamp)
    );
  } catch {
    /* private mode / quota — in-memory watcher still works */
  }
}

export function clearAutoLockLastActivityAt(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(AUTO_LOCK_LAST_ACTIVITY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
