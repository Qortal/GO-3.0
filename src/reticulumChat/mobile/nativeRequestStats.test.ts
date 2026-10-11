import { describe, expect, it } from 'vitest';

import { createNativeRequestStats } from './nativeRequestStats';

describe('nativeRequestStats', () => {
  it('summarizes round trips', () => {
    const stats = createNativeRequestStats();
    stats.replied('send_reticulum_chat', 1_000, 1_010);
    stats.replied('send_reticulum_chat', 1_000, 1_020);
    stats.replied('nativefs:path', 1_000, 1_030);
    const snap = stats.snapshot([], 2_000);
    expect(snap.rtt).toMatchObject({ n: 3, max: 30 });
    expect(snap.rttRecent).toMatchObject({ n: 3, max: 30 });
    expect(snap.byLabel.map((l) => [l.label, l.n])).toEqual([
      ['send_reticulum_chat', 2],
      ['nativefs:path', 1],
    ]);
    expect(snap).toMatchObject({
      pending: 0,
      timeouts: 0,
      lateReplies: 0,
      unmatchedReplies: 0,
      lostOnClose: 0,
    });
  });

  it('counts a reply after its timeout as late', () => {
    const stats = createNativeRequestStats();
    stats.timedOut('w-1', 'prepare_reticulum_resource_session', 25_000);
    stats.unknownReply('w-1', 39_000);
    // A second reply to the same id is no longer ours.
    stats.unknownReply('w-1', 40_000);
    const snap = stats.snapshot([], 41_000);
    expect(snap).toMatchObject({
      timeouts: 1,
      lateReplies: 1,
      lateByMaxMs: 14_000,
      unmatchedReplies: 1,
      rtt: null,
    });
    expect(snap.byLabel[0]).toMatchObject({
      label: 'prepare_reticulum_resource_session',
      n: 0,
      timeouts: 1,
      late: 1,
    });
  });

  it('counts a reply without a timed-out request as unmatched', () => {
    const stats = createNativeRequestStats();
    stats.unknownReply('w-9');
    expect(stats.snapshot([]).unmatchedReplies).toBe(1);
  });

  it('folds labels past the cap into "other"', () => {
    const stats = createNativeRequestStats();
    for (let i = 0; i < 33; i++) stats.replied(`cmd_${i}`, 0, 5);
    stats.timedOut('w-1', 'cmd_99', 10);
    const snap = stats.snapshot([], 20);
    expect(snap.byLabel[0]).toMatchObject({
      label: 'other',
      n: 1,
      timeouts: 1,
    });
    expect(snap.byLabel).toHaveLength(8);
  });

  it('groups pending requests by label, oldest first', () => {
    const stats = createNativeRequestStats();
    const snap = stats.snapshot(
      [
        { label: 'nativefs:path', startedAt: 8_000 },
        { label: 'prepare_reticulum_resource_session', startedAt: 1_000 },
        { label: 'prepare_reticulum_resource_session', startedAt: 5_000 },
        { label: 'send_reticulum_chat', startedAt: 9_500 },
      ],
      10_000
    );
    expect(snap.pending).toBe(4);
    expect(snap.oldestPending).toEqual([
      {
        label: 'prepare_reticulum_resource_session',
        count: 2,
        oldestMs: 9_000,
      },
      { label: 'nativefs:path', count: 1, oldestMs: 2_000 },
      { label: 'send_reticulum_chat', count: 1, oldestMs: 500 },
    ]);
  });

  it('adds requests lost when the socket closed', () => {
    const stats = createNativeRequestStats();
    stats.lostOnClose(2);
    stats.lostOnClose(0);
    expect(stats.snapshot([]).lostOnClose).toBe(2);
  });
});
