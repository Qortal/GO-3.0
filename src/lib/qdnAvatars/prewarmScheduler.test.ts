import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  QdnAvatarPrewarmEntry,
  QdnAvatarPrewarmResult,
} from './avatarCache';
import {
  createQdnAvatarPrewarmScheduler,
  resetQdnAvatarPrewarmStateForTests,
  type QdnAvatarPrewarmRunReport,
  type QdnAvatarPrewarmSchedulerDeps,
} from './prewarmScheduler';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const ok: QdnAvatarPrewarmResult = {
  fetched: 1,
  failed: 0,
  skipped: 0,
  stopped: false,
};
const fail: QdnAvatarPrewarmResult = {
  fetched: 0,
  failed: 1,
  skipped: 0,
  stopped: true,
};
const skip: QdnAvatarPrewarmResult = {
  fetched: 0,
  failed: 0,
  skipped: 1,
  stopped: false,
};

type Setup = Partial<QdnAvatarPrewarmSchedulerDeps> & {
  entries?: QdnAvatarPrewarmEntry[] | (() => QdnAvatarPrewarmEntry[]);
  answer?: (entry: QdnAvatarPrewarmEntry) => QdnAvatarPrewarmResult;
};

function setup(options: Setup = {}) {
  const seen: string[] = [];
  const reports: QdnAvatarPrewarmRunReport[] = [];
  const entries = options.entries ?? ['a', 'b', 'c'];
  const scheduler = createQdnAvatarPrewarmScheduler({
    account: 'QAccount',
    collect: () => (typeof entries === 'function' ? entries() : entries),
    prewarmOne: async (entry) => {
      seen.push(typeof entry === 'string' ? entry : entry.name);
      return options.answer ? options.answer(entry) : ok;
    },
    afterRun: (report) => {
      reports.push(report);
    },
    timing: { attemptGapMs: 0, ...options.timing },
    ...(options.isOnline ? { isOnline: options.isOnline } : {}),
    ...(options.isVisible ? { isVisible: options.isVisible } : {}),
    ...(options.isNodeUnavailable
      ? { isNodeUnavailable: options.isNodeUnavailable }
      : {}),
    ...(options.isPending ? { isPending: options.isPending } : {}),
    ...(options.hasOtherWork ? { hasOtherWork: options.hasOtherWork } : {}),
    ...(options.cancelPending ? { cancelPending: options.cancelPending } : {}),
    ...(options.onWake ? { onWake: options.onWake } : {}),
    ...(options.account ? { account: options.account } : {}),
  });
  return { scheduler, seen, reports };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetQdnAvatarPrewarmStateForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createQdnAvatarPrewarmScheduler', () => {
  it('waits a few seconds after login before the first run', async () => {
    const { scheduler, seen, reports } = setup();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(11 * SECOND);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(2 * SECOND);
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(reports[0]).toMatchObject({
      outcome: 'done',
      planned: 3,
      attempts: 3,
      fetched: 3,
    });
    scheduler.stop();
  });

  it('runs a follow-up only for names that showed up later, then every few hours', async () => {
    let list: QdnAvatarPrewarmEntry[] = ['a', 'b'];
    const { scheduler, seen, reports } = setup({
      entries: () => list,
      answer: (entry) =>
        seen.filter((n) => n === entry).length > 1 ? skip : ok,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    expect(seen).toEqual(['a', 'b']);

    // Follow-up 3 min later: same names → nothing to do.
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(reports.map((r) => r.outcome)).toEqual(['done', 'nothing-new']);
    expect(seen).toEqual(['a', 'b']);

    // Next regular run comes 3 h after the first one, with the new name.
    list = ['a', 'b', 'd'];
    await vi.advanceTimersByTimeAsync(3 * HOUR - 3 * MINUTE - 5 * SECOND);
    expect(seen).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(seen).toEqual(['a', 'b', 'a', 'b', 'd']);
    expect(reports[2]).toMatchObject({ outcome: 'done', attempts: 1 });
    scheduler.stop();
  });

  it('follows up when the lists grew after the first run', async () => {
    let list: QdnAvatarPrewarmEntry[] = ['a'];
    const { scheduler, seen } = setup({ entries: () => list });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    list = ['a', { name: 'Owner', identifier: 'qortal_group_avatar_5' }];
    await vi.advanceTimersByTimeAsync(3 * MINUTE + SECOND);
    expect(seen).toEqual(['a', 'a', 'Owner']);
    scheduler.stop();
  });

  it('gives up after three failures in a row and backs off', async () => {
    const { scheduler, seen, reports } = setup({
      entries: ['a', 'b', 'c', 'd', 'e'],
      answer: () => fail,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(reports[0]).toMatchObject({ outcome: 'gave-up', failed: 3 });

    // No follow-up; the next try is 1 h later, then 3 h.
    await vi.advanceTimersByTimeAsync(HOUR - 30 * SECOND);
    expect(seen).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(SECOND * 31);
    expect(seen).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(3 * HOUR - 30 * SECOND);
    expect(seen).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(SECOND * 31);
    expect(seen).toHaveLength(9);
    scheduler.stop();
  });

  it('a success resets the failure count', async () => {
    const answers = [fail, fail, ok, fail, fail, ok];
    const { scheduler, reports } = setup({
      entries: ['a', 'b', 'c', 'd', 'e', 'f'],
      answer: () => answers.shift() ?? ok,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    expect(reports[0]).toMatchObject({
      outcome: 'done',
      attempts: 6,
      failed: 4,
      fetched: 2,
    });
    scheduler.stop();
  });

  it('cached avatars do not use the run budget', async () => {
    const entries = Array.from({ length: 80 }, (_, i) => `n${i}`);
    const { scheduler, seen, reports } = setup({
      entries,
      answer: (entry) => (Number(String(entry).slice(1)) < 10 ? skip : ok),
      timing: { maxAttemptsPerRun: 60 },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    expect(seen).toHaveLength(70);
    expect(reports[0]).toMatchObject({ attempts: 60, planned: 80 });
    scheduler.stop();
  });

  it('pauses between network fetches', async () => {
    const { scheduler, seen } = setup({ timing: { attemptGapMs: SECOND } });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(12 * SECOND + 100);
    expect(seen).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(SECOND);
    expect(seen).toEqual(['a', 'b']);
    scheduler.stop();
  });

  it('does nothing while offline and resumes when back online', async () => {
    let online = false;
    const { scheduler, seen } = setup({ isOnline: () => online });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(seen).toEqual([]);

    online = true;
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(9 * SECOND);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(2 * SECOND);
    expect(seen).toEqual(['a', 'b', 'c']);
    scheduler.stop();
  });

  it('stops mid-run when GO goes to the background and resumes later', async () => {
    let visible = true;
    let backgrounded = false;
    const { scheduler, seen, reports } = setup({
      isVisible: () => visible,
      answer: (entry) => {
        if (entry === 'b' && !backgrounded) {
          backgrounded = true;
          visible = false;
          return fail;
        }
        return ok;
      },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    expect(seen).toEqual(['a', 'b']);
    expect(reports[0]).toMatchObject({ outcome: 'interrupted', failed: 0 });

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(seen).toEqual(['a', 'b']);

    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(11 * SECOND);
    expect(seen).toEqual(['a', 'b', 'a', 'b', 'c']);
    scheduler.stop();
  });

  it('skips runs while the node is known to be unavailable', async () => {
    let unavailable = true;
    const { scheduler, seen } = setup({
      isNodeUnavailable: () => unavailable,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(seen).toEqual([]);
    unavailable = false;
    await vi.advanceTimersByTimeAsync(6 * MINUTE);
    expect(seen).toEqual(['a', 'b', 'c']);
    scheduler.stop();
  });

  it('stop() ends a run after the current avatar and cancels timers', async () => {
    let release: (() => void) | null = null;
    const seen: string[] = [];
    const scheduler = createQdnAvatarPrewarmScheduler({
      account: 'QAccount',
      collect: () => ['a', 'b', 'c'],
      prewarmOne: (entry) => {
        seen.push(String(entry));
        return new Promise((resolve) => {
          release = () => resolve(ok);
        });
      },
      timing: { attemptGapMs: 0 },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    expect(seen).toEqual(['a']);
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
    release?.();
    await vi.advanceTimersByTimeAsync(10 * HOUR);
    expect(seen).toEqual(['a']);
  });

  it('a restart soon after a run keeps the schedule (lock / unlock)', async () => {
    const first = setup();
    first.scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    first.scheduler.stop();
    expect(first.seen).toHaveLength(3);

    const second = setup();
    second.scheduler.start();
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(second.seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(second.seen).toEqual(['a', 'b', 'c']);
    second.scheduler.stop();

    // Another account has its own schedule.
    const other = setup({ account: 'QOther' });
    other.scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    expect(other.seen).toEqual(['a', 'b', 'c']);
    other.scheduler.stop();
  });

  it('a follow-up cut short still finishes its new names', async () => {
    let list: QdnAvatarPrewarmEntry[] = ['a'];
    let visible = true;
    const { scheduler, seen, reports } = setup({
      entries: () => list,
      isVisible: () => visible,
      answer: (entry) => {
        if (entry === 'c' && visible && !seen.slice(0, -1).includes('c')) {
          visible = false;
          return fail;
        }
        return seen.filter((n) => n === entry).length > 1 ? skip : ok;
      },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    list = ['a', 'b', 'c', 'd'];
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(seen).toEqual(['a', 'a', 'b', 'c']);
    expect(reports.map((r) => r.outcome)).toEqual(['done', 'interrupted']);

    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(11 * SECOND);
    expect(reports.map((r) => r.outcome)).toEqual([
      'done',
      'interrupted',
      'done',
    ]);
    expect(seen.slice(4)).toEqual(['a', 'b', 'c', 'd']);
    scheduler.stop();
  });

  it('a lock / unlock before the follow-up keeps the follow-up', async () => {
    let list: QdnAvatarPrewarmEntry[] = ['a'];
    const first = setup({ entries: () => list });
    first.scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    expect(first.seen).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(MINUTE);
    first.scheduler.stop();

    list = ['a', 'late'];
    const second = setup({ entries: () => list });
    second.scheduler.start();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(second.seen).toEqual([]);
    // Due 3 min after the first run, not 3 h.
    await vi.advanceTimersByTimeAsync(MINUTE + 10 * SECOND);
    expect(second.seen).toEqual(['a', 'late']);
    second.scheduler.stop();
  });

  it('when the cache is busy, waits without blaming the node', async () => {
    // Visible avatars keep the cache busy: 'b' never got a fetch slot.
    const pending = new Set<string>();
    const { scheduler, seen, reports } = setup({
      entries: ['a', 'b', 'c', 'd', 'e'],
      isPending: (entry) => pending.has(String(entry)),
      answer: (entry) => {
        if (entry === 'b' && !seen.slice(0, -1).includes('b')) {
          pending.add('b');
          return fail;
        }
        return seen.filter((n) => n === entry).length > 1 ? skip : ok;
      },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    // Nothing is queued behind 'b'.
    expect(seen).toEqual(['a', 'b']);
    expect(reports[0]).toMatchObject({ outcome: 'busy', failed: 0 });

    // Still busy 3 min later: the run ends before queueing anything.
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(seen).toEqual(['a', 'b']);
    expect(reports[1]).toMatchObject({ outcome: 'busy', planned: 0 });

    // The cache got to 'b': the next run carries on.
    pending.delete('b');
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(seen).toEqual(['a', 'b', 'a', 'b', 'c', 'd', 'e']);
    expect(reports[2]).toMatchObject({ outcome: 'done', failed: 0 });
    scheduler.stop();
  });

  it('a busy cache does not add to the failure backoff', async () => {
    let busy = true;
    const { scheduler, seen, reports } = setup({
      entries: ['a', 'b', 'c', 'd'],
      // Only what the prewarm queued stays stuck.
      isPending: (entry) => busy && seen.includes(String(entry)),
      answer: () => fail,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    expect(reports.map((r) => r.outcome)).toEqual(['busy']);

    // Real failures now: the first give-up waits 1 h (not 3 h).
    busy = false;
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(reports.map((r) => r.outcome)).toEqual(['busy', 'gave-up']);
    const before = seen.length;
    await vi.advanceTimersByTimeAsync(HOUR - 30 * SECOND);
    expect(seen).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(31 * SECOND);
    expect(seen.length).toBeGreaterThan(before);
    scheduler.stop();
  });

  it('leaves avatars a visible screen is fetching to that screen', async () => {
    // Slow node right after login: Home is still fetching the own avatar and
    // the featured Q-Apps, and those fetches fail.
    const visible = new Set(['own', 'tube', 'quitter']);
    const { scheduler, seen, reports } = setup({
      entries: ['own', 'tube', 'quitter', 'dm1', 'group1'],
      isPending: (entry) => visible.has(String(entry)),
      answer: (entry) => (visible.has(String(entry)) ? fail : ok),
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    // Their failures are not the prewarm's: it still reaches the others.
    expect(seen).toEqual(['dm1', 'group1']);
    expect(reports[0]).toMatchObject({
      outcome: 'done',
      attempts: 2,
      failed: 0,
      fetched: 2,
    });
    scheduler.stop();
  });

  it('waits for visible avatars before each prewarm fetch', async () => {
    let work = true;
    const { scheduler, seen } = setup({ hasOtherWork: () => work });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND + MINUTE);
    expect(seen).toEqual([]);
    work = false;
    await vi.advanceTimersByTimeAsync(2 * SECOND);
    expect(seen).toEqual(['a', 'b', 'c']);
    scheduler.stop();
  });

  it('a cache that stays busy ends the run without blaming the node', async () => {
    let work = true;
    const { scheduler, seen, reports } = setup({ hasOtherWork: () => work });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND + 2 * MINUTE);
    expect(seen).toEqual([]);
    expect(reports[0]).toMatchObject({ outcome: 'busy', failed: 0 });
    work = false;
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(reports[1]).toMatchObject({ outcome: 'done', fetched: 3 });
    scheduler.stop();
  });

  it('pauses at least as long as a slow fetch took', async () => {
    const seen: string[] = [];
    const scheduler = createQdnAvatarPrewarmScheduler({
      account: 'QAccount',
      collect: () => ['a', 'b'],
      prewarmOne: async (entry) => {
        seen.push(String(entry));
        await new Promise((resolve) => setTimeout(resolve, 10 * SECOND));
        return ok;
      },
      timing: { attemptGapMs: SECOND },
    });
    scheduler.start();
    // 'a' starts at 12 s and takes 10 s: 'b' not before 32 s.
    await vi.advanceTimersByTimeAsync(31 * SECOND);
    expect(seen).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(2 * SECOND);
    expect(seen).toEqual(['a', 'b']);
    scheduler.stop();
  });

  it('never runs two prewarm avatars at once across schedulers', async () => {
    let release: (() => void) | null = null;
    const first: string[] = [];
    const cancelled: QdnAvatarPrewarmEntry[] = [];
    const timing = {
      attemptGapMs: 0,
      initialDelayMs: 0,
      busyDelayMs: 5 * SECOND,
    };
    const a = createQdnAvatarPrewarmScheduler({
      account: 'QFirst',
      collect: () => ['a1', 'a2'],
      prewarmOne: async (entry) => {
        first.push(String(entry));
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return ok;
      },
      cancelPending: (entry) => cancelled.push(entry),
      timing,
    });
    a.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(first).toEqual(['a1']);

    // Lock / account switch while 'a1' is still on a slow node.
    a.stop();
    expect(cancelled).toEqual(['a1']);
    const second: string[] = [];
    const b = createQdnAvatarPrewarmScheduler({
      account: 'QSecond',
      collect: () => ['b1'],
      prewarmOne: async (entry) => {
        second.push(String(entry));
        return ok;
      },
      timing,
    });
    b.start();
    await vi.advanceTimersByTimeAsync(30 * SECOND);
    expect(second).toEqual([]);

    release?.();
    await vi.advanceTimersByTimeAsync(5 * SECOND + 100);
    expect(second).toEqual(['b1']);
    // The stopped scheduler did not go on with 'a2'.
    expect(first).toEqual(['a1']);
    b.stop();
  });

  it('stop() drops the prewarm job a run left queued', async () => {
    const cancelled: QdnAvatarPrewarmEntry[] = [];
    let queuedB = false;
    const { scheduler, reports } = setup({
      // The prewarm call for 'b' returned while its job was still queued.
      isPending: (entry) => entry === 'b' && queuedB,
      answer: (entry) => {
        if (entry !== 'b') return ok;
        queuedB = true;
        return fail;
      },
      cancelPending: (entry) => cancelled.push(entry),
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    expect(reports.map((r) => r.outcome)).toEqual(['busy']);
    expect(cancelled).toEqual([]);
    scheduler.stop();
    expect(cancelled).toEqual(['b']);
  });

  it('wakes up for every due run, also when it is skipped', async () => {
    let wakes = 0;
    let online = true;
    const { scheduler, seen } = setup({
      isNodeUnavailable: () => true,
      isOnline: () => online,
      onWake: () => {
        wakes += 1;
      },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    expect(wakes).toBe(1);
    await vi.advanceTimersByTimeAsync(15 * MINUTE);
    expect(wakes).toBe(2);
    online = false;
    await vi.advanceTimersByTimeAsync(15 * MINUTE);
    expect(wakes).toBe(3);
    expect(seen).toEqual([]);
    scheduler.stop();
  });

  it('survives a throwing collector and prewarm', async () => {
    const scheduler = createQdnAvatarPrewarmScheduler({
      account: 'QAccount',
      collect: () => {
        throw new Error('boom');
      },
      prewarmOne: async () => {
        throw new Error('boom');
      },
      timing: { attemptGapMs: 0 },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(13 * SECOND);
    expect(scheduler.isRunning()).toBe(false);
    scheduler.stop();
  });
});
