/**
 * Background prewarm of the avatar cache while the user is signed in.
 *
 * - First run a few seconds after login (after an idle callback), so it never
 *   competes with startup. One follow-up run a few minutes later picks up
 *   lists that loaded late (DMs, groups, tabs), only if they added names.
 * - Then at most every `intervalMs` (3 h) while GO is open.
 * - One avatar at a time app-wide (also across lock / unlock and account
 *   switches) at the lowest queue priority, at most `maxAttemptsPerRun`
 *   network fetches per run (cached avatars cost nothing).
 * - Visible avatars first: each prewarm fetch waits until the cache has
 *   nothing else queued or running, and after each fetch the run pauses at
 *   least as long as the fetch took, so on a slow node the prewarm holds a
 *   fetch slot at most about half the time.
 * - An avatar a visible screen is already fetching is left to that screen
 *   (its failure is not the prewarm's). When the cache stays too busy, the
 *   run ends without blaming the node and tries again a few minutes later;
 *   the next avatar is never queued while the previous one still is.
 * - A run gives up after `maxConsecutiveFailures` failed avatars in a row and
 *   waits longer each time the node keeps failing (1 h, 3 h, 6 h).
 * - Nothing runs while the device is offline, GO is in the background or the
 *   node is known to be unavailable; a run cut short by that resumes later.
 * - stop() (lock, logout, account switch) drops the queued prewarm job when
 *   the cache supports it (`cancelPending`).
 */
import type {
  QdnAvatarPrewarmEntry,
  QdnAvatarPrewarmResult,
} from './avatarCache';
import { qdnAvatarKey } from './keys';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type QdnAvatarPrewarmTiming = {
  /** Delay between login (or unlock) and the first run. */
  initialDelayMs: number;
  /** Delay before the one follow-up run after the first complete run. */
  followUpDelayMs: number;
  /** Delay between complete runs. */
  intervalMs: number;
  /** Delay after a run gave up on failures: 1st, 2nd, 3rd+ time in a row. */
  failureDelaysMs: number[];
  /** Delay after GO is visible / online again. */
  resumeDelayMs: number;
  /** Delay while the node is known to be unavailable. */
  nodeUnavailableDelayMs: number;
  /** Delay after a run ended because the cache was busy. */
  busyDelayMs: number;
  /** Minimum pause after each network fetch (it grows with the fetch time). */
  attemptGapMs: number;
  /** Cap of the pause after a slow fetch. */
  maxAttemptGapMs: number;
  /** How often to look again while the cache is busy with other avatars. */
  quietCheckMs: number;
  /** How long one avatar waits for a quiet cache before the run ends. */
  maxQuietWaitMs: number;
  maxAttemptsPerRun: number;
  maxConsecutiveFailures: number;
};

export const DEFAULT_QDN_AVATAR_PREWARM_TIMING: QdnAvatarPrewarmTiming = {
  initialDelayMs: 12_000,
  followUpDelayMs: 3 * MINUTE,
  intervalMs: 3 * HOUR,
  failureDelaysMs: [HOUR, 3 * HOUR, 6 * HOUR],
  resumeDelayMs: 10_000,
  nodeUnavailableDelayMs: 15 * MINUTE,
  busyDelayMs: 3 * MINUTE,
  attemptGapMs: 1_000,
  maxAttemptGapMs: MINUTE,
  quietCheckMs: 2_000,
  maxQuietWaitMs: 2 * MINUTE,
  maxAttemptsPerRun: 60,
  maxConsecutiveFailures: 3,
};

export type QdnAvatarPrewarmOutcome =
  /** Every planned avatar was handled (or the run's budget was used). */
  | 'done'
  /** Too many failures in a row: the node is struggling. */
  | 'gave-up'
  /** Offline or in the background mid-run; resumes when that ends. */
  | 'interrupted'
  /**
   * The cache stayed busy with visible avatars, or still has the last
   * prewarm avatar (from this or an earlier scheduler) queued or running:
   * not a node failure, tries again in a few minutes.
   */
  | 'busy'
  /** A follow-up run found no new names. */
  | 'nothing-new'
  /** stop() was called. */
  | 'cancelled';

export type QdnAvatarPrewarmRunReport = {
  outcome: QdnAvatarPrewarmOutcome;
  planned: number;
  attempts: number;
  fetched: number;
  failed: number;
};

export type QdnAvatarPrewarmSchedulerDeps = {
  /** Account the runs belong to (timing is remembered per account). */
  account: string;
  /** The avatars to prewarm, most important first. */
  collect: () => Promise<QdnAvatarPrewarmEntry[]> | QdnAvatarPrewarmEntry[];
  /** Prewarms one avatar (prewarmQdnAvatars([entry])). */
  prewarmOne: (entry: QdnAvatarPrewarmEntry) => Promise<QdnAvatarPrewarmResult>;
  /**
   * True while the cache still has work queued or running for `entry`: a
   * prewarm call that returned before its job got a slot, or a visible
   * screen fetching the same avatar.
   */
  isPending?: (entry: QdnAvatarPrewarmEntry) => boolean;
  /** True while the cache has any avatar queued or running. */
  hasOtherWork?: () => boolean;
  /** Drops the queued prewarm job for `entry`, if the cache can. */
  cancelPending?: (entry: QdnAvatarPrewarmEntry) => void;
  /**
   * Called whenever a run is due, also when it is skipped (offline, in the
   * background, node unavailable).
   */
  onWake?: () => Promise<void> | void;
  /** Called after every run that was not cancelled. */
  afterRun?: (report: QdnAvatarPrewarmRunReport) => Promise<void> | void;
  isOnline?: () => boolean;
  isVisible?: () => boolean;
  /** True while the node is known to be down (skips the run). */
  isNodeUnavailable?: () => boolean;
  timing?: Partial<QdnAvatarPrewarmTiming>;
  now?: () => number;
};

export type QdnAvatarPrewarmScheduler = {
  start: () => void;
  stop: () => void;
  /** Tests: true while a run is in progress. */
  isRunning: () => boolean;
};

type AccountState = {
  nextDueAt: number;
  failureStreak: number;
  /** A run completed (or gave up) in this session. */
  firstRunDone: boolean;
  /** When the pending follow-up run is due (0: none pending). */
  followUpDueAt: number;
  /** Avatars a run already handled, for the follow-up's "anything new?". */
  handledKeys: Set<string>;
};

/** Each account's schedule, kept across lock/unlock in this session. */
const accountStates = new Map<string, AccountState>();

/**
 * The prewarm avatar the cache had not finished when its run ended. There is
 * one avatar cache for every account, so this is app-wide: no run queues a
 * new avatar while this one is still queued or running.
 */
let pendingEntry: QdnAvatarPrewarmEntry | null = null;

/**
 * The prewarm call in progress, app-wide. stop() cannot interrupt it (it may
 * wait up to about 42 s on a slow node), so a scheduler started meanwhile
 * (unlock, account switch) must not start a second one next to it: two
 * prewarm jobs could hold both blocking fetch slots.
 */
let inFlight: { entry: QdnAvatarPrewarmEntry; owner: symbol } | null = null;

/** Tests only. */
export function resetQdnAvatarPrewarmStateForTests(): void {
  accountStates.clear();
  pendingEntry = null;
  inFlight = null;
}

const defaultIsOnline = () =>
  typeof navigator === 'undefined' || navigator.onLine !== false;

const defaultIsVisible = () =>
  typeof document === 'undefined' || document.visibilityState !== 'hidden';

const waitForIdle = () =>
  new Promise<void>((resolve) => {
    const ric = (
      globalThis as {
        requestIdleCallback?: (
          callback: () => void,
          options?: { timeout?: number }
        ) => unknown;
      }
    ).requestIdleCallback;
    if (typeof ric === 'function') {
      ric(() => resolve(), { timeout: 3_000 });
    } else {
      setTimeout(resolve, 0);
    }
  });

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const entryKey = (entry: QdnAvatarPrewarmEntry) =>
  typeof entry === 'string'
    ? qdnAvatarKey(entry)
    : qdnAvatarKey(entry?.name, entry?.identifier);

export function createQdnAvatarPrewarmScheduler(
  deps: QdnAvatarPrewarmSchedulerDeps
): QdnAvatarPrewarmScheduler {
  const timing = { ...DEFAULT_QDN_AVATAR_PREWARM_TIMING, ...deps.timing };
  const now = deps.now ?? (() => Date.now());
  const isOnline = deps.isOnline ?? defaultIsOnline;
  const isVisible = deps.isVisible ?? defaultIsVisible;
  const isNodeUnavailable = deps.isNodeUnavailable ?? (() => false);
  const account = deps.account;

  const isPending = (entry: QdnAvatarPrewarmEntry): boolean => {
    try {
      return deps.isPending?.(entry) === true;
    } catch {
      return false;
    }
  };

  const hasOtherWork = (): boolean => {
    try {
      return deps.hasOtherWork?.() === true;
    } catch {
      return false;
    }
  };

  const cancelPending = (entry: QdnAvatarPrewarmEntry | null) => {
    if (entry == null) return;
    try {
      deps.cancelPending?.(entry);
    } catch {
      // best effort
    }
  };

  const owner = Symbol('qdn-avatar-prewarm');
  let started = false;
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let detachWait: (() => void) | null = null;
  let nextIsFollowUp = false;

  const state = (): AccountState => {
    let current = accountStates.get(account);
    if (!current) {
      current = {
        nextDueAt: 0,
        failureStreak: 0,
        firstRunDone: false,
        followUpDueAt: 0,
        handledKeys: new Set(),
      };
      accountStates.set(account, current);
    }
    return current;
  };

  const clearTimer = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
  };

  const clearWait = () => {
    detachWait?.();
    detachWait = null;
  };

  const schedule = (delayMs: number) => {
    clearTimer();
    clearWait();
    if (stopped) return;
    timer = setTimeout(
      () => {
        timer = null;
        void fire();
      },
      Math.max(0, delayMs)
    );
  };

  /** Waits for GO to be online and visible again, then resumes shortly. */
  const waitForConditions = () => {
    clearWait();
    if (stopped) return;
    const check = () => {
      if (stopped || !isOnline() || !isVisible()) return;
      schedule(timing.resumeDelayMs);
    };
    try {
      window.addEventListener('online', check);
      document.addEventListener('visibilitychange', check);
      detachWait = () => {
        window.removeEventListener('online', check);
        document.removeEventListener('visibilitychange', check);
      };
    } catch {
      // No DOM: try again after the regular interval.
      schedule(timing.intervalMs);
    }
  };

  /** Waits until visible avatars no longer need the cache's fetch slots. */
  const waitForQuietCache = async (): Promise<
    'ok' | 'busy' | 'cancelled' | 'interrupted'
  > => {
    const step = Math.max(10, timing.quietCheckMs);
    let waited = 0;
    while (hasOtherWork()) {
      if (waited >= timing.maxQuietWaitMs) return 'busy';
      await sleep(step);
      waited += step;
      if (stopped) return 'cancelled';
      if (!isOnline() || !isVisible()) return 'interrupted';
    }
    return 'ok';
  };

  const runOnce = async (
    followUp: boolean
  ): Promise<QdnAvatarPrewarmRunReport> => {
    const report: QdnAvatarPrewarmRunReport = {
      outcome: 'done',
      planned: 0,
      attempts: 0,
      fetched: 0,
      failed: 0,
    };
    await waitForIdle();
    if (stopped) return { ...report, outcome: 'cancelled' };

    // A stopped scheduler (lock, account switch) still waits on its avatar.
    if (inFlight != null) return { ...report, outcome: 'busy' };
    // The cache has not served the last prewarm avatar yet (visible avatars
    // keep it busy): do not queue another one behind it.
    if (pendingEntry != null) {
      if (isPending(pendingEntry)) return { ...report, outcome: 'busy' };
      pendingEntry = null;
    }

    let entries: QdnAvatarPrewarmEntry[] = [];
    try {
      const collected = await deps.collect();
      entries = Array.isArray(collected) ? collected : [];
    } catch {
      entries = [];
    }
    if (stopped) return { ...report, outcome: 'cancelled' };

    const planned: Array<{ entry: QdnAvatarPrewarmEntry; key: string }> = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const key = entryKey(entry);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      planned.push({ entry, key });
    }
    report.planned = planned.length;
    // Keys are marked handled only once a run got through them, so a
    // follow-up cut short (or out of budget) still finishes its new names.
    const handled = state().handledKeys;
    if (followUp && planned.every(({ key }) => handled.has(key))) {
      return { ...report, outcome: 'nothing-new' };
    }

    let consecutiveFailures = 0;
    for (const { entry, key } of planned) {
      if (stopped) return { ...report, outcome: 'cancelled' };
      if (!isOnline() || !isVisible()) {
        return { ...report, outcome: 'interrupted' };
      }
      if (report.attempts >= timing.maxAttemptsPerRun) break;

      // Visible avatars first.
      const quiet = await waitForQuietCache();
      if (quiet !== 'ok') return { ...report, outcome: quiet };
      // A visible screen is fetching this one: leave it to that screen, and
      // do not count its failure (a slow node right after login fails the
      // very avatars Home shows, which would end the run early).
      if (isPending(entry)) {
        handled.add(key);
        continue;
      }
      if (inFlight != null) return { ...report, outcome: 'busy' };

      const startedAt = now();
      let result: QdnAvatarPrewarmResult;
      inFlight = { entry, owner };
      try {
        result = await deps.prewarmOne(entry);
      } catch {
        result = { fetched: 0, failed: 1, skipped: 0, stopped: false };
      } finally {
        if (inFlight?.owner === owner) inFlight = null;
      }
      const elapsed = Math.max(0, now() - startedAt);
      const failed = (result?.failed ?? 0) > 0;
      const fetched = (result?.fetched ?? 0) > 0;
      // Still queued or running in the cache: the prewarm call stopped
      // waiting, the cache did not fail. Never queue the next one behind it.
      if (failed && isPending(entry)) {
        pendingEntry = entry;
        if (stopped) {
          // Locked or switched account meanwhile: do not let it run later.
          cancelPending(entry);
          return { ...report, outcome: 'cancelled' };
        }
        if (!isOnline() || !isVisible()) {
          return { ...report, outcome: 'interrupted' };
        }
        return { ...report, outcome: 'busy' };
      }
      if (stopped) return { ...report, outcome: 'cancelled' };
      // Cached, recently confirmed missing or in backoff: no network used.
      if (!failed && !fetched && (result?.skipped ?? 0) > 0) {
        handled.add(key);
        continue;
      }

      // A fetch cut off by going offline or to the background is not the
      // node's fault.
      if (failed && (!isOnline() || !isVisible())) {
        return { ...report, outcome: 'interrupted' };
      }
      handled.add(key);
      report.attempts += 1;
      if (failed) {
        report.failed += 1;
        consecutiveFailures += 1;
        if (consecutiveFailures >= timing.maxConsecutiveFailures) {
          return { ...report, outcome: 'gave-up' };
        }
      } else {
        if (fetched) report.fetched += 1;
        consecutiveFailures = 0;
      }
      // At least as long as the fetch took (capped): on a slow node the
      // prewarm holds a fetch slot at most about half the time.
      const gap = Math.max(
        timing.attemptGapMs,
        Math.min(elapsed, timing.maxAttemptGapMs)
      );
      if (gap > 0) await sleep(gap);
    }
    return report;
  };

  const fire = async () => {
    if (stopped || running) return;
    try {
      void Promise.resolve(deps.onWake?.()).catch(() => undefined);
    } catch {
      // best effort
    }
    if (!isOnline() || !isVisible()) {
      waitForConditions();
      return;
    }
    if (isNodeUnavailable()) {
      schedule(timing.nodeUnavailableDelayMs);
      return;
    }

    const followUp = nextIsFollowUp;
    nextIsFollowUp = false;
    running = true;
    let report: QdnAvatarPrewarmRunReport;
    try {
      report = await runOnce(followUp);
    } catch {
      report = {
        outcome: 'gave-up',
        planned: 0,
        attempts: 0,
        fetched: 0,
        failed: 0,
      };
    } finally {
      running = false;
    }
    if (report.outcome === 'cancelled' || stopped) {
      // A cancelled follow-up stays pending (followUpDueAt) for start().
      return;
    }

    try {
      await deps.afterRun?.(report);
    } catch {
      // best effort
    }
    if (stopped) return;

    const current = state();
    const at = now();
    switch (report.outcome) {
      case 'interrupted':
        // Resume (cached avatars are skipped for free) once back. A pending
        // follow-up stays pending.
        nextIsFollowUp = followUp;
        waitForConditions();
        if (isOnline() && isVisible()) schedule(timing.resumeDelayMs);
        return;
      case 'busy':
        // Not the node's fault: no failure, the regular schedule is kept.
        nextIsFollowUp = followUp;
        schedule(timing.busyDelayMs);
        return;
      case 'gave-up': {
        current.failureStreak += 1;
        const delays = timing.failureDelaysMs;
        const delay =
          delays[Math.min(current.failureStreak, delays.length) - 1] ??
          timing.intervalMs;
        current.nextDueAt = at + delay;
        current.firstRunDone = true;
        current.followUpDueAt = 0;
        schedule(delay);
        return;
      }
      case 'nothing-new':
        current.followUpDueAt = 0;
        schedule(Math.max(0, current.nextDueAt - at));
        return;
      default:
        current.failureStreak = 0;
        current.nextDueAt = at + timing.intervalMs;
        if (!current.firstRunDone) {
          current.firstRunDone = true;
          current.followUpDueAt = at + timing.followUpDelayMs;
          nextIsFollowUp = true;
          schedule(timing.followUpDelayMs);
        } else {
          current.followUpDueAt = 0;
          schedule(timing.intervalMs);
        }
    }
  };

  return {
    start: () => {
      if (started || stopped || !account) return;
      started = true;
      const current = state();
      const at = now();
      if (current.followUpDueAt > 0) {
        // Locked (or switched away) before the follow-up ran: keep it.
        nextIsFollowUp = true;
        schedule(Math.max(timing.initialDelayMs, current.followUpDueAt - at));
        return;
      }
      const due = current.nextDueAt - at;
      // Ran recently (e.g. before a lock/unlock): keep the schedule.
      schedule(due > timing.initialDelayMs ? due : timing.initialDelayMs);
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearTimer();
      clearWait();
      // The current avatar finishes (or times out) on its own; drop what is
      // still queued so it does not run under the next account.
      if (inFlight?.owner === owner) cancelPending(inFlight.entry);
      cancelPending(pendingEntry);
    },
    isRunning: () => running,
  };
}
