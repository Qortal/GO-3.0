import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getEngineIoStats,
  installOpfsFlushProbe,
  noteEngineRpc,
  noteSocketFrame,
  noteSqliteCommit,
  resetEngineIoStatsForTests,
} from './engineIoStats';

const MIN = 60_000;
const T0 = 1_800_000_000_000;

describe('engine I/O stats', () => {
  beforeEach(() => resetEngineIoStatsForTests());
  afterEach(() => vi.useRealTimers());

  it('ranks RPC methods by total time and keeps the blocking part', () => {
    for (let i = 0; i < 10; i++)
      noteEngineRpc('getSummaries', 90, 300, true, T0);
    noteEngineRpc('getSummaries', 900, 1_200, true, T0);
    noteEngineRpc('markRead', 1, 50, false, T0);
    noteEngineRpc('markRead', 2, 60, true, T0);
    noteEngineRpc('bad method name!', 1, 5, true, T0);
    const stats = getEngineIoStats(T0);
    expect(stats.rpc.calls).toBe(14);
    expect(stats.rpc.methods[0]).toEqual({
      method: 'getSummaries',
      n: 11,
      errors: 0,
      totalMs: 4_200,
      p95: 1_200,
      max: 1_200,
      syncMaxMs: 900,
    });
    expect(stats.rpc.methods[1]).toMatchObject({
      method: 'markRead',
      n: 2,
      errors: 1,
      totalMs: 110,
    });
    // An odd name from the page is counted, not printed.
    expect(stats.rpc.methods.map((m) => m.method)).toContain('other');
    expect(getEngineIoStats(T0, 1).rpc.methods).toHaveLength(1);
  });

  it('wraps flush once and counts flushes and commits per minute', () => {
    const calls: number[] = [];
    class FakeHandle {
      flush(value: number): number {
        calls.push(value);
        return value * 2;
      }
    }
    const scope = { FileSystemSyncAccessHandle: FakeHandle };
    expect(installOpfsFlushProbe(scope)).toBe(true);
    expect(installOpfsFlushProbe(scope)).toBe(true);
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const handle = new FakeHandle();
    expect(handle.flush(21)).toBe(42);
    vi.setSystemTime(T0 + MIN);
    handle.flush(1);
    handle.flush(2);
    expect(calls).toEqual([21, 1, 2]);
    noteSqliteCommit(T0);
    noteSqliteCommit(T0 + 2 * MIN);
    const stats = getEngineIoStats(T0 + 2 * MIN);
    expect(stats.flush.installed).toBe(true);
    // Minutes 0, 1 and 2 since the first flush.
    expect(stats.flush.rate).toEqual({ total: 3, recent: 3, minutes: 3 });
    expect(stats.flush.recent?.n).toBe(3);
    expect(stats.commits).toEqual({ total: 2, recent: 2, minutes: 3 });
    // Ten minutes on, only the newest minute is still in the window.
    expect(getEngineIoStats(T0 + 11 * MIN).commits).toEqual({
      total: 2,
      recent: 1,
      minutes: 10,
    });
  });

  it('reports no probe where sync access handles do not exist', () => {
    expect(installOpfsFlushProbe({})).toBe(false);
    expect(getEngineIoStats(T0).flush).toEqual({
      installed: false,
      rate: { total: 0, recent: 0, minutes: 0 },
      recent: null,
    });
  });

  it('measures how many socket frames were handled back to back', () => {
    // 5 frames queued behind each other, a pause, then 2.
    let t = 0;
    for (let i = 0; i < 5; i++) {
      noteSocketFrame(t, t + 10, T0);
      t += 10.5;
    }
    t += 500;
    noteSocketFrame(t, t + 1, T0 + 1_000);
    noteSocketFrame(t + 1.5, t + 2, T0 + 1_000);
    const stats = getEngineIoStats(T0 + 1_000);
    expect(stats.socketFrames).toEqual({
      rate: { total: 7, recent: 7, minutes: 1 },
      maxBackToBack: 5,
      maxBackToBackAt: T0,
      recentMaxBackToBack: 5,
    });
    expect(
      getEngineIoStats(T0 + 20 * MIN).socketFrames.recentMaxBackToBack
    ).toBe(0);
  });
});
