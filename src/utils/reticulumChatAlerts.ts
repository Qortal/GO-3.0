/**
 * Stable identities for Reticulum chat OS alerts (DM / mention) and a
 * registry of the alerts this device has actually shown.
 *
 * The alert key is what both platforms use to update or cancel a tray entry:
 * on Android it becomes the notification tag (+ hashed id), on desktop it is
 * the key of the live `Notification` map in `background.ts`. Because keys are
 * stable per conversation, the tray entry can be cancelled when the chat is
 * read on another device (`read_sync`), without knowing which event fired it.
 */

export const reticulumDmAlertKey = (peerAddress: string): string =>
  `reticulum-dm:${peerAddress}`;

export const reticulumMentionAlertKey = (groupId: number | string): string =>
  `reticulum-mention:${groupId}`;

/**
 * Deterministic small integer for an Android notification id. Kept identical
 * to the historical `mobileOsNotifications` hash so ids stay stable across
 * releases (`h = (h * 31 + charCode) >>> 0`, then `h % 90000 + 1000`).
 */
export const hashNotificationId = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return (hash % 90000) + 1000;
};

export const chatAlertIdFromKey = (key: string): number =>
  hashNotificationId(key);

const shownAlertKeys = new Set<string>();

export const rememberShownAlert = (key: string): void => {
  if (!key) return;
  shownAlertKeys.add(key);
};

export const forgetShownAlert = (key: string): void => {
  shownAlertKeys.delete(key);
};

export const wasAlertShown = (key: string): boolean => shownAlertKeys.has(key);

export const listShownAlertKeys = (): string[] => Array.from(shownAlertKeys);

type AlertDismissHandlers = {
  isNative: boolean;
  /** Cancel the Android tray entry for this key (best effort). */
  dismissNative: (alertKey: string) => void;
  /** Close the desktop `Notification` shown for this key, if still open. */
  closeDesktop: (alertKey: string) => void;
};

/**
 * Core of `dismissOsNotificationByKey` (kept here so it is unit-testable
 * without loading `background.ts`). No-op unless the key was shown on this
 * device; forgets the key afterwards either way. Returns whether a dismiss
 * was attempted.
 */
export const dismissShownAlert = (
  alertKey: string,
  handlers: AlertDismissHandlers
): boolean => {
  if (!alertKey || !wasAlertShown(alertKey)) return false;
  try {
    if (handlers.isNative) {
      handlers.dismissNative(alertKey);
    } else {
      handlers.closeDesktop(alertKey);
    }
  } catch (error) {
    console.error('[reticulumChatAlerts] Failed to dismiss alert', error);
  } finally {
    forgetShownAlert(alertKey);
  }
  return true;
};

// ── Catch-up window ────────────────────────────────────────────────────────
// Messages pulled in by catch-up after GO was frozen, killed or offline carry
// their send time, which is older than the listener's start. They are still
// new to the user when they were sent after GO last ran, so the alert gate
// starts at min(listeningSince, lastRunMark) - 60 s, never more than 7 days
// back. The mark is written only when the page is hidden or unloaded (no
// timer); without one (first run, restored or rebuilt DB) the gate starts at
// listeningSince, so imported history never alerts.

export const CHAT_ALERT_CLOCK_SKEW_MS = 60_000;
export const CHAT_ALERT_MAX_CATCH_UP_MS = 7 * 24 * 60 * 60 * 1000;
const CHAT_ALERT_LAST_RUN_MARK_PREFIX = 'go-chat-alert-last-run:';

export const readChatAlertLastRunMark = (address: string): number | null => {
  if (!address) return null;
  try {
    const value = Number(
      window.localStorage.getItem(CHAT_ALERT_LAST_RUN_MARK_PREFIX + address)
    );
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};

export const writeChatAlertLastRunMark = (
  address: string,
  at: number = Date.now()
): void => {
  if (!address || !Number.isFinite(at)) return;
  try {
    window.localStorage.setItem(
      CHAT_ALERT_LAST_RUN_MARK_PREFIX + address,
      String(Math.floor(at))
    );
  } catch {
    /* storage unavailable: the gate falls back to listeningSince */
  }
};

/** Oldest message timestamp that may still raise a tray alert. */
export const chatAlertFloor = ({
  listeningSince,
  lastRunMark,
  now = Date.now(),
}: {
  listeningSince: number;
  lastRunMark?: number | null;
  now?: number;
}): number => {
  const mark = Number(lastRunMark);
  const start =
    Number.isFinite(mark) && mark > 0
      ? Math.min(listeningSince, mark)
      : listeningSince;
  return Math.max(
    start - CHAT_ALERT_CLOCK_SKEW_MS,
    now - CHAT_ALERT_MAX_CATCH_UP_MS
  );
};

/**
 * Whether a message reached this device by catch-up (GO was frozen, killed or
 * offline when it was sent) rather than live. Catch-up messages may already
 * have been read on another device whose read sync has not arrived yet.
 * `timestamp < listeningSince - skew` implies this too, since now >= listeningSince.
 */
export const isChatAlertCatchUp = ({
  timestamp,
  now = Date.now(),
}: {
  timestamp: number;
  now?: number;
}): boolean =>
  Number.isFinite(timestamp) && now - timestamp > CHAT_ALERT_CLOCK_SKEW_MS;

/**
 * Unread DM messages with `peer` in a `getDirectSummaries` result. The
 * enriched summary folds unread missed calls into `unreadCount`; the missed
 * call has its own alert, so only messages count here.
 */
export const unreadDirectMessageCount = (
  summaries: unknown,
  peer: string
): number => {
  if (!Array.isArray(summaries)) return 0;
  const summary = summaries.find(
    (item: any) => String(item?.peerAddress || '') === peer
  ) as { unreadCount?: number; unreadMissedCallCount?: number } | undefined;
  return (
    Number(summary?.unreadCount || 0) -
    Number(summary?.unreadMissedCallCount || 0)
  );
};

// ── Coalescing ─────────────────────────────────────────────────────────────
// Only catch-up alerts on the phone go through here; live alerts post at once
// as before. Catch-up can deliver many messages within a second, and some of
// them may have been read on another device already. Catch-up alerts are
// offered with a short settle (so a read sync that lands meanwhile cancels
// them) and never post on the leading edge. When an alert is due, the newest
// still-wanted one posts and the others due with it are dropped, so the phone
// sounds at most once per 60 s. The native alert has no silent mode today
// (every post sounds), so dropped alerts are not posted; their chats still
// show as unread in GO. The one-shot timer is armed only while an alert
// waits; nothing runs while idle.

const CHAT_ALERT_AUDIBLE_INTERVAL_MS = 60_000;
/** How long a catch-up alert waits for a read sync from another device. */
export const CHAT_ALERT_CATCH_UP_SETTLE_MS = 10_000;
const CHAT_ALERT_MAX_PENDING = 32;

/**
 * Posts the alert; returns (or resolves) false when it is no longer wanted
 * (read, being viewed). `isCancelled` turns true when the alert is cancelled
 * or the coalescer cleared while an async post is still checking.
 */
type ChatAlertPost = (isCancelled: () => boolean) => boolean | Promise<boolean>;

export type ChatAlertCoalescer = {
  offer: (
    alertKey: string,
    post: ChatAlertPost,
    options?: { settleMs?: number }
  ) => void;
  cancel: (alertKey: string) => void;
  isPending: (alertKey: string) => boolean;
  clear: () => void;
};

type ChatAlertEntry = {
  key: string;
  post: ChatAlertPost;
  readyAt: number;
  cancelled: boolean;
};

export const createChatAlertCoalescer = ({
  intervalMs = CHAT_ALERT_AUDIBLE_INTERVAL_MS,
  now = () => Date.now(),
  setTimer = (callback: () => void, ms: number) =>
    setTimeout(callback, ms) as unknown,
  clearTimer = (handle: unknown) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
}: {
  intervalMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
} = {}): ChatAlertCoalescer => {
  const pending = new Map<string, ChatAlertEntry>();
  let lastPostAt: number | null = null;
  let timer: unknown = null;
  // Alerts taken out of `pending` for the running flush, newest last; null
  // when no flush runs. Bounded by CHAT_ALERT_MAX_PENDING.
  let batch: ChatAlertEntry[] | null = null;

  const arm = () => {
    if (timer !== null || batch !== null || pending.size === 0) return;
    let dueAt = Infinity;
    for (const entry of pending.values()) {
      dueAt = Math.min(dueAt, entry.readyAt);
    }
    if (lastPostAt !== null) dueAt = Math.max(dueAt, lastPostAt + intervalMs);
    timer = setTimer(flush, Math.max(0, dueAt - now()));
  };

  const finish = (posted: boolean) => {
    if (posted) lastPostAt = now();
    batch = null;
    arm();
  };

  // Tries the newest alert of the batch; sync posts settle synchronously.
  const postNext = (entries: ChatAlertEntry[]) => {
    const entry = entries.pop();
    if (!entry) {
      finish(false);
      return;
    }
    if (entry.cancelled) {
      postNext(entries);
      return;
    }
    const done = (posted: boolean) => {
      // Posted: the older alerts due with it are dropped (see above).
      if (posted) {
        finish(true);
        return;
      }
      entry.cancelled = true;
      postNext(entries);
    };
    let result: boolean | Promise<boolean>;
    try {
      result = entry.post(() => entry.cancelled);
    } catch (error) {
      console.error('[reticulumChatAlerts] Alert post failed', error);
      result = false;
    }
    if (result && typeof (result as Promise<boolean>).then === 'function') {
      (result as Promise<boolean>).then(
        (value) => done(value !== false),
        (error) => {
          console.error('[reticulumChatAlerts] Alert post failed', error);
          done(false);
        }
      );
    } else {
      done(result !== false);
    }
  };

  const run = (entries: ChatAlertEntry[]) => {
    // `batch` keeps every entry (the one being posted too) for cancel().
    batch = entries.slice();
    postNext(entries);
  };

  function flush() {
    timer = null;
    const at = now();
    const due: ChatAlertEntry[] = [];
    for (const [key, entry] of pending) {
      if (entry.readyAt > at) continue;
      due.push(entry);
      pending.delete(key);
    }
    if (due.length === 0) {
      arm();
      return;
    }
    run(due);
  }

  const cancelInBatch = (alertKey?: string) => {
    for (const entry of batch ?? []) {
      if (alertKey === undefined || entry.key === alertKey) {
        entry.cancelled = true;
      }
    }
  };

  return {
    offer: (alertKey, post, { settleMs = 0 } = {}) => {
      if (!alertKey) return;
      const at = now();
      const entry: ChatAlertEntry = {
        key: alertKey,
        post,
        readyAt: at + Math.max(0, settleMs),
        cancelled: false,
      };
      const idle =
        settleMs <= 0 &&
        timer === null &&
        batch === null &&
        (lastPostAt === null || at - lastPostAt >= intervalMs);
      if (idle) {
        run([entry]);
        return;
      }
      pending.delete(alertKey);
      pending.set(alertKey, entry);
      if (pending.size > CHAT_ALERT_MAX_PENDING) {
        const oldest = pending.keys().next().value;
        if (oldest !== undefined) pending.delete(oldest);
      }
      arm();
    },
    cancel: (alertKey) => {
      pending.delete(alertKey);
      cancelInBatch(alertKey);
      if (pending.size === 0 && timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },
    isPending: (alertKey) =>
      pending.has(alertKey) ||
      Boolean(
        batch?.some((entry) => entry.key === alertKey && !entry.cancelled)
      ),
    clear: () => {
      pending.clear();
      cancelInBatch();
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
};
