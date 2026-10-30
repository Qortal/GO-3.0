/**
 * Log-scale latency histogram: a total since start plus ten lazily rotated
 * one-minute slots. No timers: a slot is opened by the first sample of its
 * minute.
 *
 * Lives in the engine worker. Only summaries (plain objects, safe for
 * postMessage) cross to the main thread; the raw stats never leave it.
 */

const LATENCY_BOUNDS_MS = [
  1, 2, 3, 5, 8, 12, 20, 30, 50, 80, 120, 200, 300, 500, 800, 1_200, 2_000,
  3_000, 5_000, 8_000, 12_000, 20_000, 30_000, 60_000,
] as const;
const SLOT_MS = 60_000;
export const LATENCY_SLOTS = 10;

type Bucketed = { counts: number[]; n: number; max: number; maxAt: number };
export type LatencyStats = {
  total: Bucketed;
  slots: Array<Bucketed & { minute: number }>;
};
/** Percentiles are bucket bounds (rounded up), never above `max`. */
export type LatencySummary = {
  n: number;
  p50: number;
  p95: number;
  max: number;
  maxAt: number;
};

const empty = (): Bucketed => ({
  counts: new Array(LATENCY_BOUNDS_MS.length + 1).fill(0),
  n: 0,
  max: 0,
  maxAt: 0,
});

export const createLatencyStats = (): LatencyStats => ({
  total: empty(),
  slots: [],
});

function bucketOf(ms: number): number {
  for (let i = 0; i < LATENCY_BOUNDS_MS.length; i++) {
    if (ms <= LATENCY_BOUNDS_MS[i]) return i;
  }
  return LATENCY_BOUNDS_MS.length;
}

function add(b: Bucketed, i: number, ms: number, at: number): void {
  b.counts[i] += 1;
  b.n += 1;
  if (ms > b.max) {
    b.max = ms;
    b.maxAt = at;
  }
}

/** NaN and Infinity are ignored; negative values count as 0. */
export function noteLatency(
  stats: LatencyStats,
  ms: number,
  at = Date.now()
): void {
  if (!Number.isFinite(ms)) return;
  const v = Math.max(0, ms);
  const i = bucketOf(v);
  add(stats.total, i, v, at);
  const minute = Math.floor(at / SLOT_MS);
  let slot = stats.slots[stats.slots.length - 1];
  // A new slot whenever the minute differs (also after a backwards clock
  // jump), so at most LATENCY_SLOTS are ever kept.
  if (!slot || slot.minute !== minute) {
    slot = { ...empty(), minute };
    stats.slots.push(slot);
    while (stats.slots.length > LATENCY_SLOTS) stats.slots.shift();
  }
  add(slot, i, v, at);
}

function pct(b: Bucketed, q: number): number {
  const rank = Math.max(1, Math.ceil(b.n * q));
  let seen = 0;
  for (let i = 0; i < b.counts.length; i++) {
    seen += b.counts[i];
    if (seen >= rank) {
      return i < LATENCY_BOUNDS_MS.length
        ? Math.min(LATENCY_BOUNDS_MS[i], b.max)
        : b.max;
    }
  }
  return b.max;
}

function merge(into: Bucketed, from: Bucketed): void {
  for (let i = 0; i < into.counts.length; i++) {
    into.counts[i] += from.counts[i] ?? 0;
  }
  into.n += from.n;
  if (from.n > 0 && (into.n === from.n || from.max > into.max)) {
    into.max = from.max;
    into.maxAt = from.maxAt;
  }
}

function summarize(b: Bucketed): LatencySummary | null {
  if (b.n <= 0) return null;
  return {
    n: b.n,
    p50: pct(b, 0.5),
    p95: pct(b, 0.95),
    max: b.max,
    maxAt: b.maxAt,
  };
}

/**
 * Since start, or the slots of the last `windowMs` when given. Null when
 * nothing was noted (in that window).
 */
export function summarizeLatency(
  stats: LatencyStats,
  now = Date.now(),
  windowMs?: number
): LatencySummary | null {
  if (windowMs === undefined) return summarize(stats.total);
  const fromMinute = Math.floor((now - windowMs) / SLOT_MS);
  const merged = empty();
  for (const slot of stats.slots) {
    if (slot.minute >= fromMinute) merge(merged, slot);
  }
  return summarize(merged);
}

/** Max per minute for the last `count` minutes, oldest first; null for a minute with no samples. */
export function minuteMaxima(
  stats: LatencyStats,
  now = Date.now(),
  count = LATENCY_SLOTS
): Array<number | null> {
  const current = Math.floor(now / SLOT_MS);
  const out: Array<number | null> = [];
  for (let minute = current - count + 1; minute <= current; minute++) {
    let max: number | null = null;
    for (const slot of stats.slots) {
      if (slot.minute === minute && slot.n > 0) {
        max = max === null ? slot.max : Math.max(max, slot.max);
      }
    }
    out.push(max);
  }
  return out;
}
