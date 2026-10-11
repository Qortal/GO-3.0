import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSendFailuresForTests,
  describeSendError,
  getRecentSendFailures,
  getRecentSendTimings,
  recordSendFailure,
  recordSendRecovered,
  recordSendTiming,
} from './sendFailureLog';

describe('sendFailureLog', () => {
  beforeEach(() => clearSendFailuresForTests());

  it('turns the shapes a send rejects with into one line', () => {
    expect(
      describeSendError(new Error('reticulumChat:publishEvent timed out'))
    ).toBe('reticulumChat:publishEvent timed out');
    expect(describeSendError('Local user is not a member of this group')).toBe(
      'Local user is not a member of this group'
    );
    expect(
      describeSendError({ error: 'author is not a current group member' })
    ).toBe('author is not a current group member');
    expect(describeSendError(undefined)).toBe('unknown error');
    expect(describeSendError(`x${'y'.repeat(400)}`).length).toBe(300);
  });

  it('keeps the most recent failures only', () => {
    for (let i = 0; i < 25; i++) recordSendFailure(`g${i}`, 3, `e${i}`);
    const recent = getRecentSendFailures();
    expect(recent).toHaveLength(20);
    expect(recent[0].target).toBe('g5');
    expect(recent[recent.length - 1]).toMatchObject({
      target: 'g24',
      attempts: 3,
      error: 'e24',
    });
  });

  it('records a plain failure without an attempt log as before', () => {
    const record = recordSendFailure('g1', 3, 'Invalid event');
    expect(record).toEqual({
      at: expect.any(Number),
      target: 'g1',
      attempts: 3,
      error: 'Invalid event',
    });
    expect(record).not.toHaveProperty('attemptLog');
    expect(record).not.toHaveProperty('outcome');
    expect(recordSendFailure('g1', 3, 'x', [])).not.toHaveProperty(
      'attemptLog'
    );
  });

  it('keeps the last 5 attempts of a failure, normalised', () => {
    const log = [
      { ms: 1, error: 'a' },
      { ms: 2.4, error: 'b' },
      { ms: -5, error: 'c' },
      { ms: Number.NaN, error: `  d\n${'x'.repeat(400)}` },
      { ms: 5, error: { error: 'e' } as unknown as string },
      { ms: 6, error: null, duplicate: true },
    ];
    const record = recordSendFailure('g1', 6, 'f', log);
    expect(record.attemptLog).toHaveLength(5);
    expect(record.attemptLog?.[0]).toEqual({ ms: 2, error: 'b' });
    expect(record.attemptLog?.[1]).toEqual({ ms: 0, error: 'c' });
    expect(record.attemptLog?.[2].ms).toBe(0);
    expect(record.attemptLog?.[2].error?.length).toBe(300);
    expect(record.attemptLog?.[2].error?.startsWith('d x')).toBe(true);
    expect(record.attemptLog?.[3]).toEqual({ ms: 5, error: 'e' });
    expect(record.attemptLog?.[4]).toEqual({
      ms: 6,
      error: null,
      duplicate: true,
    });
    // The caller's array is not kept by reference.
    log.push({ ms: 7, error: 'g' });
    expect(getRecentSendFailures()[0].attemptLog).toHaveLength(5);
  });

  it('marks a retried send that went through as recovered', () => {
    const record = recordSendRecovered('g2', 3, [
      { ms: 45_000, error: 'reticulumChat:publishEvent timed out' },
      { ms: 300, error: 'Invalid event' },
      { ms: 120, error: null, duplicate: true },
    ]);
    expect(record).toEqual({
      at: expect.any(Number),
      target: 'g2',
      attempts: 3,
      error: 'Invalid event',
      outcome: 'recovered',
      attemptLog: [
        { ms: 45_000, error: 'reticulumChat:publishEvent timed out' },
        { ms: 300, error: 'Invalid event' },
        { ms: 120, error: null, duplicate: true },
      ],
    });
    expect(getRecentSendFailures()).toEqual([record]);
    expect(recordSendRecovered('g3', 1, []).error).toBe('');
  });

  it('never lets recovered sends push the failures out', () => {
    recordSendFailure('g-lost', 3, 'failed-permanent');
    for (let i = 0; i < 25; i += 1) {
      recordSendRecovered(`g${i}`, 2, [
        { ms: 100, error: 'bridge stall' },
        { ms: 50, error: null },
      ]);
    }
    const recent = getRecentSendFailures();
    expect(recent.map((r) => r.target)).toEqual([
      'g-lost',
      'g20',
      'g21',
      'g22',
      'g23',
      'g24',
    ]);
    // Failures still roll over at 20.
    for (let i = 0; i < 25; i += 1) recordSendFailure(`f${i}`, 1, 'x');
    const all = getRecentSendFailures();
    expect(all).toHaveLength(20);
    expect(all[all.length - 1].target).toBe('f24');
  });

  it('keeps the last 20 send times and clears them with the failures', () => {
    recordSendTiming(Number.NaN);
    recordSendTiming(-1);
    recordSendTiming(Number.POSITIVE_INFINITY);
    expect(getRecentSendTimings()).toEqual([]);
    for (let i = 0; i < 25; i++) recordSendTiming(i + 0.4);
    const timings = getRecentSendTimings();
    expect(timings).toHaveLength(20);
    expect(timings[0]).toBe(5);
    expect(timings[19]).toBe(24);
    recordSendFailure('g1', 3, 'x');
    clearSendFailuresForTests();
    expect(getRecentSendTimings()).toEqual([]);
    expect(getRecentSendFailures()).toEqual([]);
  });
});
