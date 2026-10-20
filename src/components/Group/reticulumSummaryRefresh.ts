type ReticulumMentionSummary = {
  mentionCount?: number;
};

type SequenceRef = {
  current: number;
};

type TimerRef = {
  current: ReturnType<typeof setTimeout> | null;
};

type TimestampRef = {
  current: number | null;
};

export const getReticulumMentionBadgeCount = (
  summaries: Record<string, ReticulumMentionSummary>
): number =>
  Object.values(summaries || {}).reduce(
    (total, summary) => total + Math.max(0, Number(summary?.mentionCount) || 0),
    0
  );

export const beginReticulumSummaryRefresh = (
  sequenceRef: SequenceRef
): (() => boolean) => {
  const refreshSequence = ++sequenceRef.current;
  return () => refreshSequence !== sequenceRef.current;
};

export const RETICULUM_SUMMARY_REFRESH_DEBOUNCE_MS = 150;
export const RETICULUM_SUMMARY_REFRESH_MAX_WAIT_MS = 500;
// GO: during catch-up the engine reports summary changes several times a
// second, and each refresh recomputes every changed channel on the engine
// thread. Badges a second late are fine there; explicit refreshes after a
// read still use the short cadence above.
export const RETICULUM_SUMMARY_REFRESH_GO_DEBOUNCE_MS = 1_000;
export const RETICULUM_SUMMARY_REFRESH_GO_MAX_WAIT_MS = 3_000;

export const scheduleReticulumSummaryRefresh = (
  timerRef: TimerRef,
  refreshWindowStartedAtRef: TimestampRef,
  refresh: () => void | Promise<unknown>,
  debounceMs = RETICULUM_SUMMARY_REFRESH_DEBOUNCE_MS,
  maxWaitMs = RETICULUM_SUMMARY_REFRESH_MAX_WAIT_MS
): void => {
  const now = Date.now();
  if (refreshWindowStartedAtRef.current === null) {
    refreshWindowStartedAtRef.current = now;
  }

  if (timerRef.current) {
    clearTimeout(timerRef.current);
  }

  const elapsed = Math.max(0, now - refreshWindowStartedAtRef.current);
  const delay = Math.max(0, Math.min(debounceMs, maxWaitMs - elapsed));
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    refreshWindowStartedAtRef.current = null;
    void refresh();
  }, delay);
};

export type ReticulumSummaryRefreshStats = {
  /** getSummaries calls that returned a result. */
  runs: number;
  /** Results equal to the previous ones (nothing re-rendered). */
  unchanged: number;
  /** Requests that joined a queued follow-up instead of their own run. */
  coalesced: number;
  lastMs: number;
  maxMs: number;
  totalMs: number;
  /** Epoch ms of the last result; 0 when none yet. */
  lastAt: number;
};

const emptyRefreshStats = (): ReticulumSummaryRefreshStats => ({
  runs: 0,
  unchanged: 0,
  coalesced: 0,
  lastMs: 0,
  maxMs: 0,
  totalMs: 0,
  lastAt: 0,
});

let summaryRefreshStats = emptyRefreshStats();

/** Group.tsx: one getSummaries round trip and whether its result changed. */
export const noteReticulumSummaryRefreshRun = (
  durationMs: number,
  changed: boolean,
  now = Date.now()
): void => {
  const ms = Math.max(0, Math.round(Number(durationMs) || 0));
  summaryRefreshStats = {
    ...summaryRefreshStats,
    runs: summaryRefreshStats.runs + 1,
    unchanged: summaryRefreshStats.unchanged + (changed ? 0 : 1),
    lastMs: ms,
    maxMs: Math.max(summaryRefreshStats.maxMs, ms),
    totalMs: summaryRefreshStats.totalMs + ms,
    lastAt: now,
  };
};

/** For Copy diagnostics: getSummaries refresh counts since the page started. */
export const getReticulumSummaryRefreshStats =
  (): ReticulumSummaryRefreshStats => ({ ...summaryRefreshStats });

export const resetReticulumSummaryRefreshStatsForTests = (): void => {
  summaryRefreshStats = emptyRefreshStats();
};

export type ReticulumSummaryRefreshFlight = {
  running: boolean;
  queued: {
    promise: Promise<boolean>;
    resolve: (value: boolean) => void;
    reject: (error: unknown) => void;
  } | null;
  latest: (() => Promise<boolean>) | null;
};

export const createReticulumSummaryRefreshFlight =
  (): ReticulumSummaryRefreshFlight => ({
    running: false,
    queued: null,
    latest: null,
  });

const startReticulumSummaryRefreshFlight = (
  flight: ReticulumSummaryRefreshFlight
): Promise<boolean> => {
  flight.running = true;
  const refresh = flight.latest;
  const run = (async () => (refresh ? refresh() : false))();
  const settle = () => {
    const queued = flight.queued;
    flight.queued = null;
    if (!queued) {
      flight.running = false;
      return;
    }
    // Still marked running: the follow-up starts here, so no other caller
    // can start a parallel refresh in between.
    startReticulumSummaryRefreshFlight(flight).then(
      queued.resolve,
      queued.reject
    );
  };
  run.then(settle, settle);
  return run;
};

/**
 * Single-flight for getSummaries: while one refresh runs, every new request
 * shares one follow-up that starts when it ends, with the newest refresh
 * function. So refreshes never overlap on the engine, and a caller always
 * gets a result read after its request.
 */
export const runReticulumSummaryRefreshSingleFlight = (
  flight: ReticulumSummaryRefreshFlight,
  refresh: () => Promise<boolean>
): Promise<boolean> => {
  flight.latest = refresh;
  if (!flight.running) return startReticulumSummaryRefreshFlight(flight);
  if (flight.queued) {
    summaryRefreshStats = {
      ...summaryRefreshStats,
      coalesced: summaryRefreshStats.coalesced + 1,
    };
    return flight.queued.promise;
  }
  let resolve: (value: boolean) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<boolean>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  flight.queued = { promise, resolve, reject };
  return promise;
};

/** Deep equality for plain summary data (what the engine bridge returns). */
export const reticulumSummaryValuesEqual = (
  left: unknown,
  right: unknown
): boolean => {
  if (Object.is(left, right)) return true;
  if (
    !left ||
    !right ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  if (Array.isArray(left)) {
    const rightArray = right as unknown[];
    if (left.length !== rightArray.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!reticulumSummaryValuesEqual(left[index], rightArray[index])) {
        return false;
      }
    }
    return true;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  if (leftKeys.length !== Object.keys(rightRecord).length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(rightRecord, key)) return false;
    if (!reticulumSummaryValuesEqual(leftRecord[key], rightRecord[key])) {
      return false;
    }
  }
  return true;
};

/**
 * Builds the summaries record (by group id) from a getSummaries result,
 * reusing the previous object of every group whose summary did not change,
 * and the previous record itself when nothing changed. Unchanged groups then
 * keep their identity, so list rows and the open chat skip re-rendering.
 */
export const shareReticulumChatSummaries = <T>(
  previous: Record<string, T> | null | undefined,
  summaries: readonly unknown[]
): Record<string, T> => {
  const next: Record<string, T> = {};
  for (const summary of summaries) {
    const groupId = Number((summary as { groupId?: unknown })?.groupId);
    if (!Number.isInteger(groupId) || groupId <= 0) continue;
    next[String(groupId)] = summary as T;
  }
  const prior = previous || {};
  let unchanged = Object.keys(prior).length === Object.keys(next).length;
  for (const key of Object.keys(next)) {
    if (
      Object.prototype.hasOwnProperty.call(prior, key) &&
      reticulumSummaryValuesEqual(prior[key], next[key])
    ) {
      next[key] = prior[key];
    } else {
      unchanged = false;
    }
  }
  return unchanged && previous ? previous : next;
};
