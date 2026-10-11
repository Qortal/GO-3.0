/**
 * Engine worker loop lag, measured from the timers and message handlers that
 * already run (no sampler, no extra wakeup).
 *
 * `installLoopLagProbe` wraps the worker's setTimeout/setInterval: every
 * existing timer then reports how late it fired (the loop lag) and how long
 * its callback ran. `runTimedTask` times the synchronous part of a message or
 * socket handler. Worker-only module singleton; only the snapshot crosses to
 * the main thread.
 */
import {
  createLatencyStats,
  minuteMaxima,
  noteLatency,
  summarizeLatency,
  type LatencySummary,
} from './latencyStats';

/** A timer this late means the worker or page was frozen, not busy. */
export const LOOP_SUSPEND_MS = 60_000;

export type LoopTaskKind = 'timer' | 'message' | 'socket';

export type LoopLagSnapshot = {
  installed: boolean;
  /** When the probe was installed (ms since epoch); 0 when it is not. */
  since: number;
  /** Timer lateness since start / over the last 10 minutes. */
  lag: LatencySummary | null;
  lagRecent: LatencySummary | null;
  /** Max lateness per minute, last 10 minutes, oldest first. */
  lagPerMinute: Array<number | null>;
  longestTaskMs: number;
  longestTaskKind: LoopTaskKind | null;
  longestTaskAt: number | null;
  tasksOver50Ms: number;
  tasksOver1s: number;
  /** Timers 60 s or more late (a frozen page or a vendor freezer). */
  suspendedCount: number;
  suspendedMaxMs: number;
};

const perfNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const state = {
  installed: false,
  since: 0,
  lag: createLatencyStats(),
  longest: 0,
  longestKind: null as LoopTaskKind | null,
  longestAt: 0,
  over50: 0,
  over1s: 0,
  suspended: 0,
  suspendedMax: 0,
};

export function noteTimerLateness(lateMs: number, at = Date.now()): void {
  if (!Number.isFinite(lateMs)) return;
  if (lateMs >= LOOP_SUSPEND_MS) {
    state.suspended += 1;
    state.suspendedMax = Math.max(state.suspendedMax, lateMs);
    return;
  }
  noteLatency(state.lag, Math.max(0, lateMs), at);
}

export function noteTaskDuration(
  kind: LoopTaskKind,
  ms: number,
  at = Date.now()
): void {
  if (!(ms >= 50)) return;
  state.over50 += 1;
  if (ms >= 1_000) state.over1s += 1;
  if (ms > state.longest) {
    state.longest = ms;
    state.longestKind = kind;
    state.longestAt = at;
  }
}

/**
 * Times the synchronous part of one task. Promise continuations it starts are
 * not included, so this is a lower bound.
 */
export function runTimedTask<T>(kind: LoopTaskKind, fn: () => T): T {
  const s = perfNow();
  try {
    return fn();
  } finally {
    noteTaskDuration(kind, perfNow() - s);
  }
}

type TimerScope = {
  setTimeout: typeof setTimeout;
  setInterval: typeof setInterval;
};

/**
 * Wraps setTimeout/setInterval so every EXISTING timer reports how late it
 * fired and how long its callback ran. Adds no timer and no wakeup: the delay,
 * `this`, arguments and returned id are passed through unchanged. Call once,
 * before the engine is imported; a second call is a no-op.
 */
export function installLoopLagProbe(
  scope: TimerScope = globalThis as unknown as TimerScope,
  now: () => number = perfNow
): void {
  if (state.installed) return;
  state.installed = true;
  state.since = Date.now();
  const rawTimeout = scope.setTimeout.bind(scope) as (
    ...a: unknown[]
  ) => unknown;
  const rawInterval = scope.setInterval.bind(scope) as (
    ...a: unknown[]
  ) => unknown;
  (scope as any).setTimeout = function (
    handler: unknown,
    delay?: number,
    ...args: unknown[]
  ) {
    if (typeof handler !== 'function') {
      return rawTimeout(handler, delay, ...args);
    }
    const due = now() + Math.max(0, Number(delay) || 0);
    return rawTimeout(function (this: unknown) {
      const s = now();
      noteTimerLateness(s - due);
      try {
        return (handler as (...a: unknown[]) => unknown).apply(this, args);
      } finally {
        noteTaskDuration('timer', now() - s);
      }
    }, delay);
  };
  (scope as any).setInterval = function (
    handler: unknown,
    delay?: number,
    ...args: unknown[]
  ) {
    if (typeof handler !== 'function') {
      return rawInterval(handler, delay, ...args);
    }
    const wait = Math.max(0, Number(delay) || 0);
    let due = now() + wait;
    return rawInterval(function (this: unknown) {
      const s = now();
      noteTimerLateness(s - due);
      due = s + wait;
      try {
        return (handler as (...a: unknown[]) => unknown).apply(this, args);
      } finally {
        noteTaskDuration('timer', now() - s);
      }
    }, delay);
  };
}

export function getLoopLagSnapshot(now = Date.now()): LoopLagSnapshot {
  return {
    installed: state.installed,
    since: state.since,
    lag: summarizeLatency(state.lag, now),
    lagRecent: summarizeLatency(state.lag, now, 600_000),
    lagPerMinute: minuteMaxima(state.lag, now),
    longestTaskMs: Math.round(state.longest),
    longestTaskKind: state.longestKind,
    longestTaskAt: state.longestAt || null,
    tasksOver50Ms: state.over50,
    tasksOver1s: state.over1s,
    suspendedCount: state.suspended,
    suspendedMaxMs: Math.round(state.suspendedMax),
  };
}

export function resetLoopLagForTests(): void {
  state.installed = false;
  state.since = 0;
  state.lag = createLatencyStats();
  state.longest = 0;
  state.longestKind = null;
  state.longestAt = 0;
  state.over50 = 0;
  state.over1s = 0;
  state.suspended = 0;
  state.suspendedMax = 0;
}
