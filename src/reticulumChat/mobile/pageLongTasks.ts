/**
 * Long tasks on the page's main thread (PerformanceObserver 'longtask': any
 * task over 50 ms), for Copy diagnostics: they are what users feel as lag
 * when they move around the app. Counts since the page started plus one-minute
 * slots for the last 10 minutes. Installed once on GO; the observer callback
 * only adds numbers.
 */

const MINUTE_MS = 60_000;
const WINDOW_MINUTES = 10;

type Slot = { minute: number; count: number; totalMs: number; maxMs: number };

const stats = {
  installed: false,
  count: 0,
  totalMs: 0,
  maxMs: 0,
  maxAt: 0,
  over1s: 0,
  firstAt: 0,
  slots: [] as Slot[],
};

export type PageLongTaskStats = {
  /** False where the browser has no long-task observer (then all are 0). */
  installed: boolean;
  count: number;
  totalMs: number;
  maxMs: number;
  maxAt: number | null;
  over1s: number;
  /** The last `minutes` minutes (up to 10, fewer right after the first task). */
  recent: { minutes: number; count: number; totalMs: number; maxMs: number };
};

/** One long task of `durationMs` that started at `at` (epoch ms). */
export function notePageLongTask(durationMs: number, at = Date.now()): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  stats.count += 1;
  stats.totalMs += durationMs;
  if (durationMs >= 1_000) stats.over1s += 1;
  if (durationMs > stats.maxMs) {
    stats.maxMs = durationMs;
    stats.maxAt = at;
  }
  if (!stats.firstAt) stats.firstAt = at;
  const minute = Math.floor(at / MINUTE_MS);
  let slot = stats.slots[stats.slots.length - 1];
  if (!slot || slot.minute !== minute) {
    slot = { minute, count: 0, totalMs: 0, maxMs: 0 };
    stats.slots.push(slot);
    while (stats.slots.length > WINDOW_MINUTES) stats.slots.shift();
  }
  slot.count += 1;
  slot.totalMs += durationMs;
  slot.maxMs = Math.max(slot.maxMs, durationMs);
}

/** Start observing; idempotent, and false where 'longtask' is not supported. */
export function installPageLongTaskProbe(): boolean {
  if (stats.installed) return true;
  try {
    const Observer = (
      globalThis as {
        PerformanceObserver?: typeof PerformanceObserver;
      }
    ).PerformanceObserver;
    if (
      typeof Observer !== 'function' ||
      !Observer.supportedEntryTypes?.includes('longtask')
    ) {
      return false;
    }
    const origin = performance.timeOrigin || Date.now() - performance.now();
    const observer = new Observer((list) => {
      for (const entry of list.getEntries()) {
        notePageLongTask(entry.duration, Math.round(origin + entry.startTime));
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
    stats.installed = true;
    return true;
  } catch {
    return false;
  }
}

export function getPageLongTaskStats(now = Date.now()): PageLongTaskStats {
  const minute = Math.floor(now / MINUTE_MS);
  const recent = { minutes: 0, count: 0, totalMs: 0, maxMs: 0 };
  for (const slot of stats.slots) {
    if (slot.minute <= minute - WINDOW_MINUTES || slot.minute > minute) {
      continue;
    }
    recent.count += slot.count;
    recent.totalMs += slot.totalMs;
    recent.maxMs = Math.max(recent.maxMs, slot.maxMs);
  }
  if (stats.firstAt) {
    recent.minutes = Math.min(
      WINDOW_MINUTES,
      Math.max(1, minute - Math.floor(stats.firstAt / MINUTE_MS) + 1)
    );
  }
  return {
    installed: stats.installed,
    count: stats.count,
    totalMs: Math.round(stats.totalMs),
    maxMs: Math.round(stats.maxMs),
    maxAt: stats.maxAt || null,
    over1s: stats.over1s,
    recent: {
      ...recent,
      totalMs: Math.round(recent.totalMs),
      maxMs: Math.round(recent.maxMs),
    },
  };
}

export function resetPageLongTasksForTests(): void {
  Object.assign(stats, {
    installed: false,
    count: 0,
    totalMs: 0,
    maxMs: 0,
    maxAt: 0,
    over1s: 0,
    firstAt: 0,
    slots: [],
  });
}
