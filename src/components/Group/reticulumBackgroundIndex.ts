import { reticulumVisibleSearchTextFromPayload } from './reticulumSearchText';

/**
 * The chat page's own search/mention index of group messages (Group.tsx).
 *
 * The engine indexes text and signed mentions when it stores an event; the
 * page adds mentions it can resolve from names. Each re-index is several
 * database writes plus a summary refresh on the engine thread, so:
 * - an event the page has indexed (or is indexing) is never indexed again;
 *   a repeated emission only records a mention notification still missing;
 * - on GO the start-up prefetch only re-indexes messages newer than the last
 *   run's watermark, instead of 50 messages of every group at every start;
 *   a group whose newest message (from the summaries already loaded) is not
 *   past its watermark costs no history read at all, and the loop starts
 *   after the first paint, at idle, with at most 2 groups at a time.
 */

export type ReticulumBackgroundIndexEvent = {
  eventId?: string;
  eventType?: string;
  groupId?: number;
  targetEventId?: string;
  encryptedPayload?: string;
  timestamp?: number;
};

type ReticulumBackgroundEventTracker = {
  /** True when this caller should index the event (not indexed, not in flight). */
  claimIndex: (eventId: string) => boolean;
  /** Gives a claim back without indexing (not indexable yet, or it failed). */
  releaseIndex: (eventId: string) => void;
  markIndexed: (eventId: string) => void;
  isIndexed: (eventId: string) => boolean;
  isNotified: (eventId: string) => boolean;
  /** True the first time a mention notification is recorded for the event. */
  claimNotification: (eventId: string) => boolean;
  clear: () => void;
  sizes: () => { indexed: number; notified: number; inFlight: number };
};

const DEFAULT_TTL_MS = 2 * 60 * 60_000;
const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_PRUNE_INTERVAL_MS = 60_000;
// An index RPC that never settles must not block that event for good.
const IN_FLIGHT_STALE_MS = 2 * 60_000;

export const createReticulumBackgroundEventTracker = ({
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
  pruneIntervalMs = DEFAULT_PRUNE_INTERVAL_MS,
  now = Date.now,
}: {
  ttlMs?: number;
  maxEntries?: number;
  pruneIntervalMs?: number;
  now?: () => number;
} = {}): ReticulumBackgroundEventTracker => {
  // Insertion order is age order (entries are re-inserted when touched), so
  // pruning drops from the front and never sorts.
  const indexed = new Map<string, number>();
  const notified = new Map<string, number>();
  const inFlight = new Map<string, number>();
  const slack = Math.max(64, Math.floor(maxEntries / 10));
  let lastPruneAt = Number.NEGATIVE_INFINITY;

  const fresh = (map: Map<string, number>, eventId: string): boolean => {
    const seenAt = map.get(eventId);
    if (seenAt === undefined) return false;
    if (seenAt >= now() - ttlMs) return true;
    map.delete(eventId);
    return false;
  };
  const touch = (map: Map<string, number>, eventId: string, at: number) => {
    map.delete(eventId);
    map.set(eventId, at);
  };
  const prune = (map: Map<string, number>, at: number) => {
    const cutoff = at - ttlMs;
    for (const [eventId, seenAt] of map) {
      if (seenAt >= cutoff) break;
      map.delete(eventId);
    }
    let excess = map.size - maxEntries;
    if (excess <= 0) return;
    for (const eventId of map.keys()) {
      if (excess-- <= 0) break;
      map.delete(eventId);
    }
  };
  // Amortised: a full pass at most once a minute, or when a map outgrows
  // its cap by the slack, never on every lookup.
  const maybePrune = (at: number) => {
    if (
      at - lastPruneAt < pruneIntervalMs &&
      indexed.size <= maxEntries + slack &&
      notified.size <= maxEntries + slack
    ) {
      return;
    }
    lastPruneAt = at;
    prune(indexed, at);
    prune(notified, at);
  };

  return {
    claimIndex: (eventId) => {
      if (!eventId || fresh(indexed, eventId)) return false;
      const since = inFlight.get(eventId);
      if (since !== undefined && now() - since < IN_FLIGHT_STALE_MS) {
        return false;
      }
      inFlight.set(eventId, now());
      return true;
    },
    releaseIndex: (eventId) => {
      inFlight.delete(eventId);
    },
    markIndexed: (eventId) => {
      if (!eventId) return;
      inFlight.delete(eventId);
      const at = now();
      touch(indexed, eventId, at);
      maybePrune(at);
    },
    isIndexed: (eventId) => !!eventId && fresh(indexed, eventId),
    isNotified: (eventId) => !!eventId && fresh(notified, eventId),
    claimNotification: (eventId) => {
      if (!eventId || fresh(notified, eventId)) return false;
      const at = now();
      touch(notified, eventId, at);
      maybePrune(at);
      return true;
    },
    clear: () => {
      indexed.clear();
      notified.clear();
      inFlight.clear();
    },
    sizes: () => ({
      indexed: indexed.size,
      notified: notified.size,
      inFlight: inFlight.size,
    }),
  };
};

type ReticulumBackgroundIndexBridge = {
  indexSearchText?: (eventId: string, text: string) => Promise<unknown>;
  replaceMentions?: (
    eventId: string,
    mentionedAddresses: string[]
  ) => Promise<unknown>;
  deleteSearchText?: (eventId: string) => Promise<unknown>;
  deleteMentions?: (eventId: string) => Promise<unknown>;
};

export type ReticulumBackgroundIndexDeps<
  E extends ReticulumBackgroundIndexEvent,
> = {
  tracker: ReticulumBackgroundEventTracker;
  bridge: ReticulumBackgroundIndexBridge | undefined;
  /** Open/closed is known for the group; until then nothing is indexed. */
  isGroupReady: (groupId: number) => boolean;
  /** Signed plus name-resolved mentions of the message. */
  mentionedAddresses: (payload: unknown, groupId: number) => Promise<string[]>;
  /**
   * The local address when the event is an authorized mention of this
   * account, else []. An @everyone can be authorized only on a later
   * emission, so an event with [] is not marked as notified.
   */
  notificationAddresses: (event: E) => string[];
  recordMentionNotification: (
    event: E,
    groupId: number,
    mentionedAddresses: string[]
  ) => void;
  scheduleSummaryRefresh: () => void;
};

const INDEXED_EVENT_TYPES = new Set(['message', 'edit', 'attachment_manifest']);

/**
 * Indexes one group event for search and mentions, at most once per event id,
 * and records its mention notification at most once.
 */
export const processReticulumBackgroundIndexEvent = async <
  E extends ReticulumBackgroundIndexEvent,
>(
  event: E,
  options: { recordMentionNotification?: boolean },
  deps: ReticulumBackgroundIndexDeps<E>
): Promise<void> => {
  if (!event?.eventId || !event?.groupId || !event?.eventType) return;
  const eventId = String(event.eventId);
  const { tracker } = deps;
  const wantsNotification = options.recordMentionNotification === true;
  const ownsIndex = tracker.claimIndex(eventId);
  if (!ownsIndex && (!wantsNotification || tracker.isNotified(eventId))) {
    return;
  }

  if (event.eventType === 'delete') {
    if (!ownsIndex) return;
    if (!event.targetEventId) {
      tracker.releaseIndex(eventId);
      return;
    }
    try {
      await deps.bridge?.deleteSearchText?.(event.targetEventId);
      await deps.bridge?.deleteMentions?.(event.targetEventId);
    } catch (error) {
      tracker.releaseIndex(eventId);
      throw error;
    }
    tracker.markIndexed(eventId);
    deps.scheduleSummaryRefresh();
    return;
  }

  const groupId = Number(event.groupId);
  if (
    !INDEXED_EVENT_TYPES.has(event.eventType) ||
    !Number.isInteger(groupId) ||
    groupId <= 0 ||
    !deps.isGroupReady(groupId)
  ) {
    // Not indexed now; a later emission or prefetch may still index it.
    if (ownsIndex) tracker.releaseIndex(eventId);
    return;
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(String(event.encryptedPayload || ''));
  } catch {
    payload = event.encryptedPayload || '';
  }

  const text = reticulumVisibleSearchTextFromPayload(payload);
  const targetEventId =
    event.eventType === 'edit' && event.targetEventId
      ? event.targetEventId
      : eventId;
  if (!targetEventId || !text) {
    if (ownsIndex) {
      tracker.markIndexed(eventId);
      deps.scheduleSummaryRefresh();
    }
    return;
  }

  if (ownsIndex) {
    try {
      await deps.bridge?.indexSearchText?.(targetEventId, text);
      const mentionedAddresses = await deps.mentionedAddresses(
        payload,
        groupId
      );
      await deps.bridge?.replaceMentions?.(targetEventId, mentionedAddresses);
    } catch (error) {
      tracker.releaseIndex(eventId);
      throw error;
    }
  }
  if (wantsNotification) {
    const notificationAddresses = deps.notificationAddresses(event);
    if (
      notificationAddresses.length > 0 &&
      tracker.claimNotification(eventId)
    ) {
      deps.recordMentionNotification(event, groupId, notificationAddresses);
    }
  }
  if (ownsIndex) {
    tracker.markIndexed(eventId);
    deps.scheduleSummaryRefresh();
  }
};

const WATERMARK_STORAGE_PREFIX = 'qortal_reticulum_bg_index_watermarks:';

/** Per group: the newest message timestamp the prefetch has indexed. */
export const readReticulumBackgroundIndexWatermarks = (
  address: string
): Record<string, number> => {
  if (!address) return {};
  try {
    const raw = window.localStorage.getItem(WATERMARK_STORAGE_PREFIX + address);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const watermarks: Record<string, number> = {};
    for (const [groupId, value] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      const timestamp = Number(value);
      if (
        /^\d+$/.test(groupId) &&
        Number.isFinite(timestamp) &&
        timestamp > 0
      ) {
        watermarks[groupId] = timestamp;
      }
    }
    return watermarks;
  } catch {
    return {};
  }
};

export const writeReticulumBackgroundIndexWatermark = (
  address: string,
  groupId: number,
  timestamp: number
): void => {
  if (
    !address ||
    !Number.isInteger(groupId) ||
    groupId <= 0 ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0
  ) {
    return;
  }
  try {
    const watermarks = readReticulumBackgroundIndexWatermarks(address);
    if ((watermarks[String(groupId)] || 0) >= timestamp) return;
    watermarks[String(groupId)] = timestamp;
    window.localStorage.setItem(
      WATERMARK_STORAGE_PREFIX + address,
      JSON.stringify(watermarks)
    );
  } catch {
    // Storage blocked or full: the next start re-indexes, as before.
  }
};

/** Groups the GO prefetch reads at the same time. */
export const RETICULUM_GO_PREFETCH_CONCURRENCY = 2;

/** The prefetch reads this channel (Group.tsx getHistory). */
const PREFETCH_CHANNEL_ID = 'general';

type ReticulumPrefetchSummary = {
  channelId?: string;
  lastEvent?: { timestamp?: number } | null;
  updatedAt?: number;
  readThroughTimestamp?: number;
  channels?: ReticulumPrefetchSummary[] | null;
};

/**
 * The newest 'general' activity the engine's summary of a group knows, for
 * the GO prefetch gate: its newest message, or a newer edit of one
 * (readThroughTimestamp, which an edit moves without changing lastEvent; the
 * edit is in getHistory, so the watermark then moves past it too). 0 when
 * the group has no summary or no 'general' message: getChatSummaries lists
 * every local group with a readable chat message, so once the summaries for
 * the pushed memberships are loaded there is nothing newer to index there.
 */
export const newestReticulumPrefetchTimestamp = (
  summary: ReticulumPrefetchSummary | null | undefined
): number => {
  // No per-channel list (an older shape): the group's newest message, which
  // is never older than its 'general' one.
  const channels = Array.isArray(summary?.channels)
    ? summary.channels
    : summary
      ? [{ ...summary, channelId: PREFETCH_CHANNEL_ID }]
      : [];
  let newest = 0;
  for (const channel of channels) {
    if ((channel?.channelId || PREFETCH_CHANNEL_ID) !== PREFETCH_CHANNEL_ID) {
      continue;
    }
    for (const value of [
      channel?.lastEvent?.timestamp,
      channel?.updatedAt,
      channel?.readThroughTimestamp,
    ]) {
      const timestamp = Number(value);
      if (Number.isFinite(timestamp) && timestamp > newest) newest = timestamp;
    }
  }
  return newest;
};

/**
 * The GO prefetch gate's answer for one group from the summaries atom (read
 * fresh per group): its newest 'general' activity, or null (unknown: read
 * history) while the atom is empty. An emptied atom, e.g. a refresh that
 * failed or found no engine while the prefetch runs, says nothing about any
 * group; skipping on it would mark every remaining group done for the session.
 */
export const newestKnownReticulumPrefetchTimestamp = (
  summaries: Record<string, ReticulumPrefetchSummary> | null | undefined,
  groupId: number
): number | null => {
  if (!summaries || Object.keys(summaries).length === 0) return null;
  return newestReticulumPrefetchTimestamp(summaries[String(groupId)]);
};

type IdleScheduler = (
  callback: () => void,
  options?: { timeout?: number }
) => unknown;

/**
 * Resolves when the main thread is idle (or after timeoutMs at the latest,
 * so a busy page still gets there).
 */
export const waitForReticulumPrefetchIdle = (
  timeoutMs = 2_000
): Promise<void> =>
  new Promise<void>((resolve) => {
    const ric = (globalThis as { requestIdleCallback?: IdleScheduler })
      .requestIdleCallback;
    if (typeof ric === 'function') {
      ric(() => resolve(), { timeout: timeoutMs });
    } else {
      setTimeout(resolve, 0);
    }
  });

/**
 * Resolves after the next frame was painted and the main thread is idle:
 * start-up work then never competes with the first screen. While the page
 * is hidden no frame comes, so the work waits until GO is shown.
 */
export const waitForReticulumPrefetchFirstPaintThenIdle = (
  timeoutMs = 5_000
): Promise<void> =>
  new Promise<void>((resolve) => {
    const afterPaint = () => {
      void waitForReticulumPrefetchIdle(timeoutMs).then(resolve);
    };
    if (typeof globalThis.requestAnimationFrame === 'function') {
      // rAF runs just before the paint; the task after it runs once painted.
      globalThis.requestAnimationFrame(() => setTimeout(afterPaint, 0));
    } else {
      setTimeout(afterPaint, 0);
    }
  });

/**
 * Re-indexes the newest messages of each group once per page session. With
 * watermarkAddress (GO) only messages newer than that account's watermark
 * for the group are indexed, and the watermark moves past them.
 *
 * GO also passes:
 * - newestKnownTimestamp: the newest message the loaded summaries know for
 *   the group; when it is not past the watermark the group is done without
 *   a getHistory call (0 RPCs for unchanged groups);
 * - concurrency 2 and beforeGroup (an idle wait before each history read).
 * Desktop passes none of them and keeps the old one-by-one loop.
 */
export const prefetchReticulumBackgroundHistory = async <
  E extends ReticulumBackgroundIndexEvent,
>({
  groupIds,
  getHistory,
  processEvent,
  isCancelled,
  isPrefetched,
  markPrefetched,
  watermarkAddress,
  onGroupError,
  newestKnownTimestamp,
  concurrency = 1,
  beforeGroup,
}: {
  groupIds: number[];
  getHistory: (groupId: number) => Promise<unknown>;
  processEvent: (event: E) => Promise<void>;
  isCancelled: () => boolean;
  isPrefetched: (groupId: number) => boolean;
  markPrefetched: (groupId: number) => void;
  watermarkAddress: string | null;
  onGroupError: (groupId: number, error: unknown) => void;
  /** Only used with watermarkAddress; null means unknown (read history). */
  newestKnownTimestamp?: (groupId: number) => number | null;
  concurrency?: number;
  beforeGroup?: () => Promise<void>;
}): Promise<void> => {
  const watermarks = watermarkAddress
    ? readReticulumBackgroundIndexWatermarks(watermarkAddress)
    : null;
  let nextIndex = 0;

  const prefetchGroups = async (): Promise<void> => {
    while (nextIndex < groupIds.length) {
      const groupId = groupIds[nextIndex];
      nextIndex += 1;
      if (isCancelled()) return;
      if (isPrefetched(groupId)) continue;
      const watermark = watermarks?.[String(groupId)] || 0;
      if (watermarks && newestKnownTimestamp) {
        const newest = newestKnownTimestamp(groupId);
        if (
          newest !== null &&
          Number.isFinite(newest) &&
          Math.max(0, newest) <= watermark
        ) {
          // Nothing newer than what an earlier start indexed.
          markPrefetched(groupId);
          continue;
        }
      }
      try {
        if (beforeGroup) {
          await beforeGroup();
          if (isCancelled()) return;
        }
        const history = await getHistory(groupId);
        if (isCancelled() || !Array.isArray(history)) continue;
        const pending = (history as E[]).filter(
          (event) => watermark <= 0 || Number(event?.timestamp) > watermark
        );
        for (const event of pending) {
          if (isCancelled()) return;
          await processEvent(event);
        }
        if (isCancelled()) return;
        markPrefetched(groupId);
        if (watermarks && watermarkAddress) {
          const latest = pending.reduce((max, event) => {
            const timestamp = Number(event?.timestamp);
            return Number.isFinite(timestamp) && timestamp > max
              ? timestamp
              : max;
          }, watermark);
          if (latest > watermark) {
            watermarks[String(groupId)] = latest;
            writeReticulumBackgroundIndexWatermark(
              watermarkAddress,
              groupId,
              latest
            );
          }
        }
      } catch (error) {
        onGroupError(groupId, error);
      }
    }
  };

  const wanted = Number.isFinite(concurrency) ? Math.floor(concurrency) : 1;
  const lanes = Math.max(1, Math.min(groupIds.length, wanted));
  await Promise.all(Array.from({ length: lanes }, () => prefetchGroups()));
};
