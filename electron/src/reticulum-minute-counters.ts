/**
 * Per-minute counters for diagnostics: bumped inline on existing paths, never
 * on a timer. Pure TypeScript with no Node imports, so the mobile engine
 * worker can bundle it too.
 */
export type MinuteCounterSnapshot<K extends string> = {
  /** Minutes the counts cover: 1 right after the first bump, at most the window. */
  minutes: number;
  counts: Record<K, number>;
};

export type MinuteCounters<K extends string> = {
  bump(now: number, key: K, n?: number): void;
  snapshot(now: number): MinuteCounterSnapshot<K>;
};

export function createMinuteCounters<K extends string>(
  keys: readonly K[],
  windowMinutes = 10
): MinuteCounters<K> {
  const window = Math.max(1, Math.floor(windowMinutes) || 1);
  let buckets: Array<{ minute: number; counts: Record<K, number> }> = [];
  let firstMinute: number | null = null;
  const empty = (): Record<K, number> =>
    Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

  return {
    bump(now: number, key: K, n = 1): void {
      if (!Number.isFinite(now) || !Number.isFinite(n)) return;
      const minute = Math.floor(now / 60_000);
      let last = buckets[buckets.length - 1];
      if (last && minute < last.minute) {
        // The clock went back: start over rather than keep counts from the
        // "future" that would never age out.
        buckets = [];
        firstMinute = minute;
        last = undefined;
      }
      if (firstMinute === null) firstMinute = minute;
      if (!last || last.minute !== minute) {
        last = { minute, counts: empty() };
        buckets.push(last);
        buckets = buckets.filter((bucket) => bucket.minute > minute - window);
      }
      if (typeof last.counts[key] !== 'number') last.counts[key] = 0;
      last.counts[key] += n;
    },
    snapshot(now: number): MinuteCounterSnapshot<K> {
      const minute = Math.floor(now / 60_000);
      const counts = empty();
      for (const bucket of buckets) {
        if (bucket.minute <= minute - window || bucket.minute > minute) {
          continue;
        }
        for (const key of keys) counts[key] += bucket.counts[key] ?? 0;
      }
      const minutes =
        firstMinute === null
          ? 1
          : Math.max(1, Math.min(window, minute - firstMinute + 1));
      return { minutes, counts };
    },
  };
}
