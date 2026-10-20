import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginReticulumSummaryRefresh,
  createReticulumSummaryRefreshFlight,
  getReticulumMentionBadgeCount,
  getReticulumSummaryRefreshStats,
  noteReticulumSummaryRefreshRun,
  resetReticulumSummaryRefreshStatsForTests,
  RETICULUM_SUMMARY_REFRESH_GO_DEBOUNCE_MS,
  RETICULUM_SUMMARY_REFRESH_GO_MAX_WAIT_MS,
  runReticulumSummaryRefreshSingleFlight,
  scheduleReticulumSummaryRefresh,
  shareReticulumChatSummaries,
} from './reticulumSummaryRefresh';

describe('Reticulum summary refresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows an authoritative mention count to decrease after reads', () => {
    expect(
      getReticulumMentionBadgeCount({
        '519': { mentionCount: 3 },
        '716': { mentionCount: 2 },
      })
    ).toBe(5);
    expect(
      getReticulumMentionBadgeCount({
        '519': { mentionCount: 0 },
        '716': { mentionCount: 0 },
      })
    ).toBe(0);
  });

  it('rejects an older refresh after a newer refresh starts', () => {
    const sequence = { current: 0 };
    const firstWasSuperseded = beginReticulumSummaryRefresh(sequence);
    expect(firstWasSuperseded()).toBe(false);

    const secondWasSuperseded = beginReticulumSummaryRefresh(sequence);
    expect(firstWasSuperseded()).toBe(true);
    expect(secondWasSuperseded()).toBe(false);
  });

  it('debounces a short burst of summary changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const timerRef: {
      current: ReturnType<typeof setTimeout> | null;
    } = { current: null };
    const refreshWindowStartedAtRef: { current: number | null } = {
      current: null,
    };
    const refresh = vi.fn();

    scheduleReticulumSummaryRefresh(
      timerRef,
      refreshWindowStartedAtRef,
      refresh
    );
    vi.advanceTimersByTime(100);
    scheduleReticulumSummaryRefresh(
      timerRef,
      refreshWindowStartedAtRef,
      refresh
    );
    vi.advanceTimersByTime(149);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(timerRef.current).toBeNull();
    expect(refreshWindowStartedAtRef.current).toBeNull();
  });

  it('cannot be postponed indefinitely by continuous summary changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const timerRef: {
      current: ReturnType<typeof setTimeout> | null;
    } = { current: null };
    const refreshWindowStartedAtRef: { current: number | null } = {
      current: null,
    };
    const refresh = vi.fn();

    for (let elapsed = 0; elapsed <= 400; elapsed += 100) {
      if (elapsed > 0) vi.advanceTimersByTime(100);
      scheduleReticulumSummaryRefresh(
        timerRef,
        refreshWindowStartedAtRef,
        refresh
      );
    }
    vi.advanceTimersByTime(99);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('Reticulum summary refresh single-flight', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const deferred = () => {
    let resolve: (value: boolean) => void = () => undefined;
    const promise = new Promise<boolean>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  it('runs one shared follow-up for every request made during a run', async () => {
    const flight = createReticulumSummaryRefreshFlight();
    const runs: Array<ReturnType<typeof deferred>> = [];
    let active = 0;
    let maxActive = 0;
    const refresh = vi.fn(() => {
      const run = deferred();
      runs.push(run);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return run.promise.finally(() => {
        active -= 1;
      });
    });

    const first = runReticulumSummaryRefreshSingleFlight(flight, refresh);
    const second = runReticulumSummaryRefreshSingleFlight(flight, refresh);
    const third = runReticulumSummaryRefreshSingleFlight(flight, refresh);
    expect(second).toBe(third);
    expect(refresh).toHaveBeenCalledTimes(1);

    runs[0].resolve(true);
    await expect(first).resolves.toBe(true);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    runs[1].resolve(false);
    await expect(second).resolves.toBe(false);
    expect(maxActive).toBe(1);
    expect(flight.running).toBe(false);
  });

  it('runs the newest refresh function for the follow-up', async () => {
    const flight = createReticulumSummaryRefreshFlight();
    const gate = deferred();
    const older = vi.fn(() => gate.promise);
    const newer = vi.fn(async () => true);

    void runReticulumSummaryRefreshSingleFlight(flight, older);
    const followUp = runReticulumSummaryRefreshSingleFlight(flight, newer);
    gate.resolve(true);
    await expect(followUp).resolves.toBe(true);
    expect(older).toHaveBeenCalledTimes(1);
    expect(newer).toHaveBeenCalledTimes(1);
  });

  it('recovers after a failed refresh', async () => {
    const flight = createReticulumSummaryRefreshFlight();
    await expect(
      runReticulumSummaryRefreshSingleFlight(flight, async () => {
        throw new Error('engine gone');
      })
    ).rejects.toThrow('engine gone');
    await expect(
      runReticulumSummaryRefreshSingleFlight(flight, async () => true)
    ).resolves.toBe(true);
  });

  // Group.tsx: every summaryChanged schedules; the timer runs the
  // single-flight refresh, which calls getSummaries.
  const runBurst = async ({
    getSummariesMs,
    debounceMs,
    maxWaitMs,
  }: {
    getSummariesMs: number;
    debounceMs?: number;
    maxWaitMs?: number;
  }) => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = {
      current: null,
    };
    const windowRef: { current: number | null } = { current: null };
    const flight = createReticulumSummaryRefreshFlight();
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    const getSummaries = () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<boolean>((resolve) =>
        setTimeout(() => {
          active -= 1;
          resolve(true);
        }, getSummariesMs)
      );
    };
    const run = () =>
      runReticulumSummaryRefreshSingleFlight(flight, getSummaries);
    for (let index = 0; index < 20; index += 1) {
      if (index > 0) await vi.advanceTimersByTimeAsync(50);
      scheduleReticulumSummaryRefresh(
        timerRef,
        windowRef,
        run,
        debounceMs,
        maxWaitMs
      );
    }
    await vi.advanceTimersByTimeAsync(10_000);
    return { calls, maxActive };
  };

  it('turns 20 summary changes in 1 s into at most 2 getSummaries calls', async () => {
    const result = await runBurst({ getSummariesMs: 20 });
    expect(result.calls).toBeLessThanOrEqual(2);
    expect(result.maxActive).toBe(1);
  });

  it('never overlaps getSummaries when it is slower than the cadence', async () => {
    const result = await runBurst({ getSummariesMs: 700 });
    expect(result.calls).toBeLessThanOrEqual(2);
    expect(result.maxActive).toBe(1);
  });

  it('refreshes once for the burst on the GO cadence', async () => {
    const result = await runBurst({
      getSummariesMs: 700,
      debounceMs: RETICULUM_SUMMARY_REFRESH_GO_DEBOUNCE_MS,
      maxWaitMs: RETICULUM_SUMMARY_REFRESH_GO_MAX_WAIT_MS,
    });
    expect(result.calls).toBe(1);
  });
});

describe('shareReticulumChatSummaries', () => {
  const summary = (groupId: number, unreadCount: number) => ({
    groupId,
    unreadCount,
    lastEvent: { eventId: `e${groupId}`, timestamp: 1_000 + unreadCount },
    channels: [{ groupId, channelId: 'general', unreadCount }],
  });

  it('keeps the same record when an equal refresh arrives', () => {
    const previous = shareReticulumChatSummaries<any>({}, [
      summary(1, 2),
      summary(2, 0),
    ]);
    const next = shareReticulumChatSummaries<any>(previous, [
      summary(1, 2),
      summary(2, 0),
    ]);
    expect(next).toBe(previous);
  });

  it('reuses unchanged groups when another group changed', () => {
    const previous = shareReticulumChatSummaries<any>({}, [
      summary(1, 2),
      summary(2, 0),
    ]);
    const next = shareReticulumChatSummaries<any>(previous, [
      summary(1, 2),
      summary(2, 1),
    ]);
    expect(next).not.toBe(previous);
    expect(next['1']).toBe(previous['1']);
    expect(next['2']).not.toBe(previous['2']);
    expect(next['2'].unreadCount).toBe(1);
  });

  it('sees a nested channel change and a removed group', () => {
    const previous = shareReticulumChatSummaries<any>({}, [
      summary(1, 2),
      summary(2, 0),
    ]);
    const changed = summary(1, 2);
    changed.channels[0].unreadCount = 5;
    const next = shareReticulumChatSummaries<any>(previous, [changed]);
    expect(Object.keys(next)).toEqual(['1']);
    expect(next['1'].channels[0].unreadCount).toBe(5);
  });

  it('drops entries without a valid group id', () => {
    const next = shareReticulumChatSummaries<any>({}, [
      { groupId: 0 },
      { groupId: 'x' },
      summary(3, 1),
    ]);
    expect(Object.keys(next)).toEqual(['3']);
  });
});

describe('summary refresh stats', () => {
  it('counts runs, unchanged results and coalesced requests', async () => {
    resetReticulumSummaryRefreshStatsForTests();
    noteReticulumSummaryRefreshRun(40, true, 1_000);
    noteReticulumSummaryRefreshRun(900, false, 2_000);

    const flight = createReticulumSummaryRefreshFlight();
    let release: (value: boolean) => void = () => undefined;
    const first = runReticulumSummaryRefreshSingleFlight(
      flight,
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        })
    );
    const refresh = async () => true;
    // The first request during a run gets the follow-up; the next two join it.
    void runReticulumSummaryRefreshSingleFlight(flight, refresh);
    void runReticulumSummaryRefreshSingleFlight(flight, refresh);
    const last = runReticulumSummaryRefreshSingleFlight(flight, refresh);
    release(true);
    await first;
    await last;

    expect(getReticulumSummaryRefreshStats()).toEqual({
      runs: 2,
      unchanged: 1,
      coalesced: 2,
      lastMs: 900,
      maxMs: 900,
      totalMs: 940,
      lastAt: 2_000,
    });
  });
});
