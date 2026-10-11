import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getLoopLagSnapshot,
  installLoopLagProbe,
  resetLoopLagForTests,
  runTimedTask,
} from './loopLag';

type Fn = (...args: unknown[]) => unknown;

function fakeScope() {
  const q: Fn[] = [];
  const timeoutCalls: unknown[][] = [];
  const intervalCalls: unknown[][] = [];
  const scope = {
    setTimeout: vi.fn((fn: Fn, ...rest: unknown[]) => {
      timeoutCalls.push([fn, ...rest]);
      q.push(fn);
      return q.length;
    }),
    setInterval: vi.fn((fn: Fn, ...rest: unknown[]) => {
      intervalCalls.push([fn, ...rest]);
      q.push(fn);
      return q.length;
    }),
  };
  return { scope: scope as any, q, timeoutCalls, intervalCalls };
}

let t = 0;
const now = () => t;

beforeEach(() => {
  resetLoopLagForTests();
  t = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loopLag', () => {
  it('reports how late a timer fired and passes its arguments through', () => {
    const { scope, q, timeoutCalls } = fakeScope();
    installLoopLagProbe(scope, now);
    const cb = vi.fn();
    const id = scope.setTimeout(cb, 100, 'a');
    expect(id).toBe(1);
    // The raw timer gets the same delay; no extra timer is scheduled.
    expect(timeoutCalls).toHaveLength(1);
    expect(timeoutCalls[0][1]).toBe(100);
    t = 1_350;
    q[0]();
    expect(cb).toHaveBeenCalledWith('a');
    const snap = getLoopLagSnapshot();
    expect(snap.installed).toBe(true);
    expect(snap.lag).toMatchObject({ n: 1, max: 1_250 });
    expect(snap.lagRecent).toMatchObject({ n: 1, max: 1_250 });
  });

  it('records the longest timer task', () => {
    const { scope, q } = fakeScope();
    installLoopLagProbe(scope, now);
    scope.setTimeout(() => {
      t += 300;
    }, 0);
    q[0]();
    const snap = getLoopLagSnapshot();
    expect(snap.longestTaskMs).toBe(300);
    expect(snap.longestTaskKind).toBe('timer');
    expect(snap.longestTaskAt).not.toBeNull();
    expect(snap.tasksOver50Ms).toBe(1);
    expect(snap.tasksOver1s).toBe(0);
  });

  it('counts a minute-late timer as a suspension, not lag', () => {
    const { scope, q } = fakeScope();
    installLoopLagProbe(scope, now);
    scope.setTimeout(() => {}, 0);
    t = 61_000;
    q[0]();
    const snap = getLoopLagSnapshot();
    expect(snap.suspendedCount).toBe(1);
    expect(snap.suspendedMaxMs).toBe(61_000);
    expect(snap.lag).toBeNull();
  });

  it('measures each interval tick from the previous one', () => {
    const { scope, q, intervalCalls } = fakeScope();
    installLoopLagProbe(scope, now);
    const cb = vi.fn();
    scope.setInterval(cb, 1_000);
    expect(intervalCalls[0][1]).toBe(1_000);
    t = 1_000;
    q[0]();
    t = 2_600;
    q[0]();
    expect(cb).toHaveBeenCalledTimes(2);
    const snap = getLoopLagSnapshot();
    expect(snap.lag).toMatchObject({ n: 2, max: 600 });
  });

  it('forwards a string handler untouched', () => {
    const { scope, timeoutCalls } = fakeScope();
    installLoopLagProbe(scope, now);
    scope.setTimeout('doSomething()', 5, 'x');
    expect(timeoutCalls[0]).toEqual(['doSomething()', 5, 'x']);
  });

  it('does not wrap twice', () => {
    const { scope, q } = fakeScope();
    installLoopLagProbe(scope, now);
    installLoopLagProbe(scope, now);
    scope.setTimeout(() => {}, 10);
    t = 20;
    q[0]();
    expect(getLoopLagSnapshot().lag?.n).toBe(1);
  });

  it('times a message or socket task and keeps its result or error', () => {
    let p = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => p);
    expect(
      runTimedTask('socket', () => {
        p += 120;
        return 'value';
      })
    ).toBe('value');
    expect(getLoopLagSnapshot()).toMatchObject({
      longestTaskMs: 120,
      longestTaskKind: 'socket',
      tasksOver50Ms: 1,
    });
    expect(() =>
      runTimedTask('message', () => {
        p += 1_500;
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(getLoopLagSnapshot()).toMatchObject({
      longestTaskMs: 1_500,
      longestTaskKind: 'message',
      tasksOver50Ms: 2,
      tasksOver1s: 1,
    });
    // Without an installed probe the snapshot says so.
    expect(getLoopLagSnapshot().installed).toBe(false);
  });
});
