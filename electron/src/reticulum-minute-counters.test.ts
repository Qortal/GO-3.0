import { describe, expect, it } from 'vitest';
import { createMinuteCounters } from './reticulum-minute-counters';

const KEYS = ['a', 'b'] as const;

describe('createMinuteCounters', () => {
  it('reports minutes=1 and zero counts before and right after the first bump', () => {
    const counters = createMinuteCounters(KEYS, 10);
    expect(counters.snapshot(0)).toEqual({
      minutes: 1,
      counts: { a: 0, b: 0 },
    });
    counters.bump(5_000, 'a');
    expect(counters.snapshot(5_000)).toEqual({
      minutes: 1,
      counts: { a: 1, b: 0 },
    });
  });

  it('adds bumps within one minute to one bucket and starts a new one at the next minute', () => {
    const counters = createMinuteCounters(KEYS, 10);
    counters.bump(0, 'a');
    counters.bump(59_999, 'a', 2);
    expect(counters.snapshot(59_999)).toEqual({
      minutes: 1,
      counts: { a: 3, b: 0 },
    });
    counters.bump(60_000, 'b');
    expect(counters.snapshot(60_000)).toEqual({
      minutes: 2,
      counts: { a: 3, b: 1 },
    });
    // A snapshot of minute 0 does not see the minute-1 bucket.
    expect(counters.snapshot(59_999).counts).toEqual({ a: 3, b: 0 });
  });

  it('sums the whole window and drops buckets that age out', () => {
    const counters = createMinuteCounters(KEYS, 10);
    counters.bump(0, 'a');
    counters.bump(4 * 60_000, 'a');
    counters.bump(9 * 60_000, 'b');
    expect(counters.snapshot(9.5 * 60_000)).toEqual({
      minutes: 10,
      counts: { a: 2, b: 1 },
    });
    expect(counters.snapshot(10.5 * 60_000)).toEqual({
      minutes: 10,
      counts: { a: 1, b: 1 },
    });
    // A later bump prunes old buckets from memory as well.
    counters.bump(30 * 60_000, 'a');
    expect(counters.snapshot(30 * 60_000)).toEqual({
      minutes: 10,
      counts: { a: 1, b: 0 },
    });
  });

  it('clears the buckets when the clock goes backwards', () => {
    const counters = createMinuteCounters(KEYS, 10);
    counters.bump(20 * 60_000, 'a', 5);
    counters.bump(5 * 60_000, 'b');
    expect(counters.snapshot(5 * 60_000)).toEqual({
      minutes: 1,
      counts: { a: 0, b: 1 },
    });
  });

  it('ignores non-finite input', () => {
    const counters = createMinuteCounters(KEYS, 10);
    counters.bump(Number.NaN, 'a');
    counters.bump(0, 'a', Number.POSITIVE_INFINITY);
    expect(counters.snapshot(0).counts).toEqual({ a: 0, b: 0 });
  });
});
