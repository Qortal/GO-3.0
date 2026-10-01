/**
 * Everything that reached the notifications panel, kept after it leaves it.
 *
 * The panel itself only holds what is current: the node sends the last three
 * days, a swiped card is gone, and a read mention clears. The history keeps a
 * copy of each item as it arrives, per account and on this device only, so
 * the person can find it again later.
 */
import { getNotificationPanelDismissKey } from '../atoms/global';

export type NotificationHistoryEntry = {
  key: string;
  /** When the notification happened (or was first seen, if it has no time). */
  at: number;
  notification: Record<string, any>;
};

const STORAGE_PREFIX = 'qortal-go:notification-history:v1:';
const MAX_ENTRIES = 300;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** A notification this big is not a notification; it is not worth keeping. */
const MAX_ENTRY_CHARS = 8000;

const cache = new Map<string, NotificationHistoryEntry[]>();
/** One empty list, so a snapshot without an account stays the same object. */
const EMPTY: NotificationHistoryEntry[] = [];
const listeners = new Set<() => void>();

const storageKey = (address: string) => `${STORAGE_PREFIX}${address}`;

function notificationTime(notification: Record<string, any>): number | null {
  const raw =
    notification?.data?.created ??
    notification?.data?.timestamp ??
    notification?.timestamp;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function historyKey(notification: Record<string, any>): string | null {
  const panelKey = getNotificationPanelDismissKey(notification);
  if (panelKey) return panelKey;
  if (notification?.signature) return `sig:${notification.signature}`;
  const data = notification?.data;
  if (data?.identifier || data?.created) {
    return `${notification?.event ?? 'n'}:${data?.name ?? ''}:${data?.identifier ?? ''}:${data?.created ?? ''}`;
  }
  return null;
}

function load(address: string): NotificationHistoryEntry[] {
  const cached = cache.get(address);
  if (cached) return cached;
  let entries: NotificationHistoryEntry[] = [];
  try {
    const raw = JSON.parse(
      globalThis.localStorage?.getItem(storageKey(address)) || '[]'
    );
    if (Array.isArray(raw)) {
      const cutoff = Date.now() - MAX_AGE_MS;
      entries = raw.filter(
        (entry) =>
          entry &&
          typeof entry.key === 'string' &&
          Number(entry.at) > cutoff &&
          entry.notification &&
          typeof entry.notification === 'object'
      );
    }
  } catch {
    entries = [];
  }
  cache.set(address, entries);
  return entries;
}

function save(address: string, entries: NotificationHistoryEntry[]): void {
  cache.set(address, entries);
  try {
    globalThis.localStorage?.setItem(
      storageKey(address),
      JSON.stringify(entries)
    );
  } catch {
    /* kept for this run */
  }
  listeners.forEach((listener) => listener());
}

/**
 * Adds what is new in the panel's list. An item already kept is updated in
 * place (a mention card's count grows), never duplicated.
 */
export function recordNotificationHistory(
  address: string | null | undefined,
  notifications: Array<Record<string, any>>
): void {
  if (!address || !Array.isArray(notifications) || !notifications.length) {
    return;
  }
  const entries = load(address);
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  let changed = false;
  for (const notification of notifications) {
    const key = historyKey(notification);
    if (!key) continue;
    let copy: Record<string, any>;
    try {
      const text = JSON.stringify(notification);
      if (!text || text.length > MAX_ENTRY_CHARS) continue;
      copy = JSON.parse(text);
    } catch {
      continue;
    }
    const existing = byKey.get(key);
    const at = notificationTime(notification) ?? existing?.at ?? Date.now();
    if (
      existing &&
      existing.at === at &&
      JSON.stringify(existing.notification) === JSON.stringify(copy)
    ) {
      continue;
    }
    byKey.set(key, { key, at, notification: copy });
    changed = true;
  }
  if (!changed) return;
  const cutoff = Date.now() - MAX_AGE_MS;
  save(
    address,
    Array.from(byKey.values())
      .filter((entry) => entry.at > cutoff)
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_ENTRIES)
  );
}

/** Newest first. */
export function getNotificationHistory(
  address: string | null | undefined
): NotificationHistoryEntry[] {
  return address ? load(address) : EMPTY;
}

export function clearNotificationHistory(
  address: string | null | undefined
): void {
  if (!address) return;
  save(address, []);
}

export function subscribeNotificationHistory(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test hook. */
export function resetNotificationHistoryForTests(): void {
  cache.clear();
  listeners.clear();
}
