import { describe, expect, it } from 'vitest';

import {
  LATENCY_SLOTS,
  createLatencyStats,
  minuteMaxima,
  noteLatency,
  summarizeLatency,
} from './latencyStats';

const MIN = 60_000;

describe('latencyStats', () => {
  it('keeps percentiles at bucket bounds, never above max', () => {
    const stats = createLatencyStats();
    for (let i = 0; i < 100; i++) noteLatency(stats, 10, 1_000 + i);
    noteLatency(stats, 9_400, 5_000);
    expect(summarizeLatency(stats, 6_000)).toEqual({
      n: 101,
      p50: 12,
      p95: 12,
      max: 9_400,
      maxAt: 5_000,
    });
    const single = createLatencyStats();
    noteLatency(single, 7, 1);
    // Bucket bound 8, but never above the max seen.
    expect(summarizeLatency(single, 1)).toMatchObject({ p50: 7, p95: 7 });
    const huge = createLatencyStats();
    noteLatency(huge, 95_000, 1);
    expect(summarizeLatency(huge, 1)).toMatchObject({
      p50: 95_000,
      p95: 95_000,
      max: 95_000,
    });
  });

  it('summarizes only the slots inside the window', () => {
    const stats = createLatencyStats();
    noteLatency(stats, 500, 0);
    noteLatency(stats, 20, 15 * MIN + 1_000);
    const now = 15 * MIN + 2_000;
    expect(summarizeLatency(stats, now, 600_000)).toEqual({
      n: 1,
      p50: 20,
      p95: 20,
      max: 20,
      maxAt: 15 * MIN + 1_000,
    });
    expect(summarizeLatency(stats, now)).toMatchObject({ n: 2, max: 500 });
    expect(summarizeLatency(stats, 40 * MIN, 600_000)).toBeNull();
    expect(summarizeLatency(createLatencyStats())).toBeNull();
  });

  it('keeps at most ten minute slots, also after a backwards clock jump', () => {
    const stats = createLatencyStats();
    for (let m = 0; m < 25; m++) noteLatency(stats, m, m * MIN);
    expect(stats.slots).toHaveLength(LATENCY_SLOTS);
    expect(stats.slots[0].minute).toBe(15);
    noteLatency(stats, 3, 2 * MIN);
    expect(stats.slots).toHaveLength(LATENCY_SLOTS);
    expect(stats.slots[stats.slots.length - 1].minute).toBe(2);
    expect(stats.total.n).toBe(26);
  });

  it('lists per-minute maxima oldest first, null for empty minutes', () => {
    const stats = createLatencyStats();
    noteLatency(stats, 40, 7 * MIN + 1);
    noteLatency(stats, 90, 7 * MIN + 2);
    noteLatency(stats, 5, 9 * MIN);
    expect(minuteMaxima(stats, 9 * MIN + 30_000, 4)).toEqual([
      null,
      90,
      null,
      5,
    ]);
    expect(minuteMaxima(stats, 9 * MIN)).toHaveLength(LATENCY_SLOTS);
  });

  it('ignores NaN and Infinity and counts negatives as 0', () => {
    const stats = createLatencyStats();
    noteLatency(stats, Number.NaN, 1);
    noteLatency(stats, Number.POSITIVE_INFINITY, 1);
    expect(summarizeLatency(stats, 1)).toBeNull();
    noteLatency(stats, -5, 1);
    expect(summarizeLatency(stats, 1)).toEqual({
      n: 1,
      p50: 0,
      p95: 0,
      max: 0,
      maxAt: 0,
    });
  });
});
