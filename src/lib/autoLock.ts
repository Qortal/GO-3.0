export const AUTO_LOCK_TIMEOUT_OPTIONS = [0, 10, 30, 60, 180] as const;

export type AutoLockTimeoutMinutes =
  (typeof AUTO_LOCK_TIMEOUT_OPTIONS)[number];

export const DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES: AutoLockTimeoutMinutes = 30;

/**
 * Legacy localStorage flag from the old on/off toggle. Still read so existing
 * "disabled" preferences migrate, and still written for older builds.
 */
export const AUTO_LOCK_DISABLED_STORAGE_KEY = 'hub_auto_lock_disabled';

/**
 * localStorage key shared by System Settings and the App idle watcher. This is
 * the only persistent store on mobile, where `window.electronAPI` is absent.
 */
export const AUTO_LOCK_TIMEOUT_STORAGE_KEY = 'hub_auto_lock_timeout_minutes';

/**
 * sessionStorage key for the idle watcher's last user-activity timestamp.
 * Survives React effect remounts so a settings re-render cannot reset the
 * idle clock (and delay the lock screen after a long screen-off).
 */
export const AUTO_LOCK_LAST_ACTIVITY_STORAGE_KEY =
  'hub_auto_lock_last_activity_at';

/** Fired after System Settings writes a new timeout preference. */
export const AUTO_LOCK_PREFERENCE_CHANGE_EVENT =
  'qortal:auto-lock-preference-changed';

export function readAutoLockTimeoutFromStorage(): AutoLockTimeoutMinutes {
  if (typeof window === 'undefined') return DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES;
  try {
    return resolveAutoLockTimeoutMinutes(
      window.localStorage.getItem(AUTO_LOCK_TIMEOUT_STORAGE_KEY),
      window.localStorage.getItem(AUTO_LOCK_DISABLED_STORAGE_KEY) === 'true'
    );
  } catch {
    return DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES;
  }
}

/** Returns false when the preference could not be persisted. */
export function writeAutoLockTimeoutToStorage(
  timeoutMinutes: AutoLockTimeoutMinutes,
  options?: { notify?: boolean }
): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(
      AUTO_LOCK_TIMEOUT_STORAGE_KEY,
      String(timeoutMinutes)
    );
    window.localStorage.setItem(
      AUTO_LOCK_DISABLED_STORAGE_KEY,
      timeoutMinutes === 0 ? 'true' : 'false'
    );
  } catch (error) {
    console.warn('Unable to persist auto-lock preference.', error);
    return false;
  }
  if (options?.notify !== false) {
    window.dispatchEvent(
      new CustomEvent(AUTO_LOCK_PREFERENCE_CHANGE_EVENT, {
        detail: { timeoutMinutes },
      })
    );
  }
  return true;
}

export function normalizeAutoLockTimeoutMinutes(
  value: unknown
): AutoLockTimeoutMinutes {
  // Number('') and Number(null) are 0, which would silently disable locking.
  const numericValue = value == null || value === '' ? NaN : Number(value);
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
