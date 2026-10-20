import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getPageLongTaskStats,
  installPageLongTaskProbe,
  notePageLongTask,
  resetPageLongTasksForTests,
} from './pageLongTasks';

const MIN = 60_000;
const T0 = 1_800_000_000_000;

describe('page long tasks', () => {
  beforeEach(() => resetPageLongTasksForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('sums long tasks since start and over the last 10 minutes', () => {
    notePageLongTask(80, T0);
    notePageLongTask(1_500, T0 + MIN);
    notePageLongTask(60, T0 + 12 * MIN);
    expect(getPageLongTaskStats(T0 + 12 * MIN)).toEqual({
      installed: false,
      count: 3,
      totalMs: 1_640,
      maxMs: 1_500,
      maxAt: T0 + MIN,
      over1s: 1,
      recent: { minutes: 10, count: 1, totalMs: 60, maxMs: 60 },
    });
    expect(getPageLongTaskStats(T0 + MIN).recent).toEqual({
      minutes: 2,
      count: 2,
      totalMs: 1_580,
      maxMs: 1_500,
    });
  });

  it('observes long tasks where the browser supports them', () => {
    let callback: ((list: { getEntries(): unknown[] }) => void) | null = null;
    const observe = vi.fn();
    class FakeObserver {
      static supportedEntryTypes = ['longtask'];
      constructor(cb: (list: { getEntries(): unknown[] }) => void) {
        callback = cb;
      }
      observe = observe;
    }
    vi.stubGlobal('PerformanceObserver', FakeObserver);
    expect(installPageLongTaskProbe()).toBe(true);
    expect(installPageLongTaskProbe()).toBe(true);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith({ type: 'longtask', buffered: true });
    callback!({ getEntries: () => [{ duration: 230, startTime: 10 }] });
    expect(getPageLongTaskStats()).toMatchObject({
      installed: true,
      count: 1,
      maxMs: 230,
    });
  });

  it('stays off without long-task support', () => {
    class NoLongTasks {
      static supportedEntryTypes = ['mark'];
    }
    vi.stubGlobal('PerformanceObserver', NoLongTasks);
    expect(installPageLongTaskProbe()).toBe(false);
    expect(getPageLongTaskStats().installed).toBe(false);
  });
});
