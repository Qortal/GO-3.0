import { describe, expect, it, vi } from 'vitest';
import {
  createMacrotaskScheduler,
  digestCoalesceKey,
  SocketEventPump,
  staleSocketFrameKind,
  type SocketEventFrame,
} from './socketEventPump';

const NOW = 1_700_000_000_000;

const chat = (
  wire: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  frameExtra: Record<string, unknown> = {}
): SocketEventFrame => ({
  type: 'event',
  event: 'reticulum_chat_message',
  payload: {
    wire: { t: 'RCHAT', ...wire },
    peerPresenceHash: 'a'.repeat(32),
    ...extra,
  },
  ...frameExtra,
});

const digest = (
  g: number,
  o: string | undefined,
  generatedAt: number | undefined,
  tag: string
): SocketEventFrame =>
  chat({
    v: 3,
    k: 'group_state_digest_v3',
    g,
    ...(o ? { o } : {}),
    d: { eventHash: tag, ...(generatedAt != null ? { generatedAt } : {}) },
  });

/** A pump on a manual scheduler and fake clocks; each handler costs 1 ms. */
function makePump(options: { coalesceAbove?: number } = {}) {
  const clock = { now: NOW, perf: 0 };
  const runs: Array<() => void> = [];
  const handled: SocketEventFrame[] = [];
  const errors: unknown[] = [];
  let fail: ((frame: SocketEventFrame) => boolean) | null = null;
  const pump = new SocketEventPump({
    handle: (frame) => {
      clock.perf += 1;
      if (fail?.(frame)) throw new Error('boom');
      handled.push(frame);
    },
    schedule: (run) => runs.push(run),
    now: () => clock.now,
    perfNow: () => clock.perf,
    onError: (err) => errors.push(err),
    ...options,
  });
  const runNext = () => {
    const run = runs.shift();
    run?.();
    return Boolean(run);
  };
  const runAll = () => {
    while (runNext()) {
      /* drain */
    }
  };
  return {
    pump,
    clock,
    runs,
    handled,
    errors,
    runNext,
    runAll,
    failWhen: (fn: (frame: SocketEventFrame) => boolean) => {
      fail = fn;
    },
  };
}

const tagOf = (frame: SocketEventFrame) =>
  frame.payload?.wire?.d?.eventHash ?? frame.payload?.n ?? frame.payload?.id;

describe('socket event pump: order and slices', () => {
  it('hands frames over in arrival order, at most one 8 ms slice per task', () => {
    const { pump, handled, runs, runNext, runAll } = makePump();
    for (let i = 0; i < 20; i += 1) {
      pump.push({
        type: 'event',
        event: 'reticulum_resource',
        payload: { n: i },
      });
    }
    // One task is scheduled for the whole burst, nothing runs inline.
    expect(runs).toHaveLength(1);
    expect(handled).toHaveLength(0);
    runNext();
    expect(handled).toHaveLength(8);
    expect(runs).toHaveLength(1);
    runAll();
    expect(handled.map(tagOf)).toEqual([...Array(20).keys()]);
    expect(pump.stats().slices).toBe(3);
    expect(pump.stats().maxSliceMs).toBe(8);
    expect(pump.depth).toBe(0);
  });

  it('keeps going after a handler throws, and reports it', () => {
    const { pump, handled, errors, failWhen, runAll } = makePump();
    failWhen((frame) => frame.payload.n === 1);
    for (let i = 0; i < 3; i += 1) {
      pump.push({ type: 'event', event: 'x', payload: { n: i } });
    }
    runAll();
    expect(handled.map(tagOf)).toEqual([0, 2]);
    expect(errors).toHaveLength(1);
  });

  it('reports depth, age and wait, and clears on stop', () => {
    const { pump, clock, runNext } = makePump();
    for (let i = 0; i < 10; i += 1) {
      pump.push({ type: 'event', event: 'x', payload: { n: i } }, clock.now);
    }
    clock.now += 1_500;
    expect(pump.stats()).toMatchObject({
      depth: 10,
      oldestAgeMs: 1_500,
      maxDepth: 10,
      maxDepthAt: NOW,
      enqueued: 10,
      handled: 0,
    });
    runNext();
    const stats = pump.stats();
    expect(stats.depth).toBe(2);
    expect(stats.handled).toBe(8);
    expect(stats.wait).toMatchObject({ n: 8, max: 1_500 });
    pump.clear();
    expect(pump.stats()).toMatchObject({
      depth: 0,
      cleared: 2,
      oldestAgeMs: null,
    });
    // A slice scheduled before the stop finds nothing.
    runNext();
    expect(pump.stats().handled).toBe(8);
  });
});

describe('socket event pump: stale gossip', () => {
  it('drops gossip past the engine lifetime for its kind and counts it', () => {
    const { pump, clock, handled, runAll } = makePump();
    const old = NOW - 9_000;
    pump.push(chat({ k: 'typing', g: 5, a: 'Q1', ts: old }));
    pump.push(chat({ k: 'typing', g: 5, a: 'Q1', ts: NOW - 1_000 }));
    pump.push(chat({ k: 'dm_notify', d: { n: NOW - 121_000 } }));
    pump.push(chat({ k: 'dm_notify', d: { n: NOW - 60_000 } }));
    pump.push(chat({ k: 'dm_probe', q: { n: NOW - 121_000 } }));
    pump.push(chat({ k: 'dm_probe', q: { n: NOW - 1_000 } }));
    // Kinds the engine does not time go by how long this phone has had them.
    pump.push(
      chat({ k: 'dm_typing', ts: NOW }, {}, { _queuedAtMs: NOW - 9_000 })
    );
    pump.push(chat({ k: 'dm_typing', ts: old }, {}, { _queuedAtMs: NOW }));
    pump.push(
      chat(
        { k: 'public_activity_req_v1', q: 'f'.repeat(16) },
        {},
        { _queuedAtMs: NOW - 31_000 }
      )
    );
    pump.push(chat({ k: 'public_activity_req_v1', q: 'e'.repeat(16) }));
    clock.now = NOW;
    runAll();
    expect(handled.map((f) => f.payload.wire.k)).toEqual([
      'typing',
      'dm_notify',
      'dm_probe',
      'dm_typing',
      'public_activity_req_v1',
    ]);
    expect(pump.stats()).toMatchObject({
      staleGossipDropped: 5,
      staleGossipByKind: {
        typing: 1,
        dm_notify: 1,
        dm_probe: 1,
        dm_typing: 1,
        public_activity_req_v1: 1,
      },
      digestsCoalesced: 0,
    });
  });

  it('judges age when the frame reaches the front, not when it arrived', () => {
    const { pump, clock, handled, runNext } = makePump();
    for (let i = 0; i < 8; i += 1) {
      pump.push({ type: 'event', event: 'x', payload: { n: i } });
    }
    pump.push(chat({ k: 'typing', g: 5, a: 'Q1', ts: NOW - 5_000 }));
    runNext();
    clock.now += 4_000;
    runNext();
    expect(handled).toHaveLength(8);
    expect(pump.stats().staleGossipByKind).toEqual({ typing: 1 });
  });

  it('never drops group_sub, events, resources or link states, however old', () => {
    const ancient = NOW - 10 * 60 * 60_000;
    const { pump, handled, runAll } = makePump();
    const frames = [
      chat(
        { k: 'group_sub', groups: [5], ts: ancient, n: ancient },
        {},
        { _queuedAtMs: ancient }
      ),
      chat({ k: 'event_notice_v3', g: 5, n: { ts: ancient } }),
      chat({ k: 'dm_event', e: { ts: ancient } }),
      chat({ k: 'event_offer', g: 5, o: { ts: ancient } }),
      {
        type: 'event',
        event: 'reticulum_chat_resource',
        _queuedAtMs: ancient,
        payload: { status: 'received', transferId: 't1' },
      },
      {
        type: 'event',
        event: 'overlay_link_state',
        _queuedAtMs: ancient,
        payload: { linkId: 'l1', established: true },
      },
      // A typing frame inside some other event is not chat gossip.
      {
        type: 'event',
        event: 'reticulum_resource',
        payload: { wire: { t: 'RCHAT', k: 'typing', ts: ancient } },
      },
    ];
    for (const frame of frames) pump.push(frame, ancient);
    runAll();
    expect(handled).toEqual(frames);
    expect(pump.stats().staleGossipDropped).toBe(0);
  });

  it('matches the engine bounds exactly at the edge', () => {
    const at = (wire: Record<string, unknown>) =>
      staleSocketFrameKind(chat(wire), NOW, NOW);
    expect(at({ k: 'typing', ts: NOW - 8_000 })).toBeNull();
    expect(at({ k: 'typing', ts: NOW - 8_001 })).toBe('typing');
    expect(at({ k: 'dm_notify', d: { n: NOW - 120_000 } })).toBeNull();
    expect(at({ k: 'dm_notify', d: { n: NOW - 120_001 } })).toBe('dm_notify');
    expect(at({ k: 'dm_notify', d: {} })).toBeNull();
    expect(at({ k: 'typing' })).toBeNull();
  });

  it('ignores a Python stamp from a jumped clock', () => {
    const frame = chat(
      { k: 'dm_typing', ts: NOW },
      {},
      { _queuedAtMs: NOW + 60_000 }
    );
    expect(staleSocketFrameKind(frame, NOW + 1_000, NOW)).toBeNull();
    const ancient = chat(
      { k: 'dm_typing', ts: NOW },
      {},
      { _queuedAtMs: NOW - 3 * 60 * 60_000 }
    );
    expect(staleSocketFrameKind(ancient, NOW + 1_000, NOW)).toBeNull();
  });
});

describe('socket event pump: digest coalescing', () => {
  it('leaves digests alone while the queue is short', () => {
    const { pump, handled, runAll } = makePump({ coalesceAbove: 5 });
    pump.push(digest(5, 'origin-a', 1, 'a1'));
    pump.push(digest(5, 'origin-a', 2, 'a2'));
    runAll();
    expect(handled.map(tagOf)).toEqual(['a1', 'a2']);
    expect(pump.stats().digestsCoalesced).toBe(0);
  });

  it('keeps the newest digest per group and origin once the queue is long', () => {
    const { pump, handled, runAll } = makePump({ coalesceAbove: 3 });
    pump.push(digest(5, 'origin-a', 100, 'a1'));
    pump.push(digest(5, 'origin-b', 100, 'b1'));
    pump.push(digest(6, 'origin-a', 100, 'g6'));
    pump.push({ type: 'event', event: 'x', payload: { n: 'mid' } });
    // Queue holds 4 > 3: a newer digest from origin-a replaces a1.
    pump.push(digest(5, 'origin-a', 200, 'a2'));
    // Relayed out of order: the queued a2 is newer, so a0 goes.
    pump.push(digest(5, 'origin-a', 50, 'a0'));
    // Same group, another origin: kept.
    pump.push(digest(5, 'origin-c', 10, 'c1'));
    pump.push(chat({ k: 'group_sub', groups: [5] }));
    runAll();
    expect(handled.map((f) => tagOf(f) ?? f.payload.wire.k)).toEqual([
      'b1',
      'g6',
      'mid',
      'a2',
      'c1',
      'group_sub',
    ]);
    expect(pump.stats()).toMatchObject({
      digestsCoalesced: 2,
      staleGossipDropped: 2,
      staleGossipByKind: { group_state_digest_v3: 2 },
      enqueued: 8,
      handled: 6,
    });
  });

  it('keys an origin-less digest by its sender, and takes arrival order without times', () => {
    const { pump, handled, runAll } = makePump({ coalesceAbove: 0 });
    const fromSender = (sender: string, tag: string) =>
      chat(
        { v: 3, k: 'group_state_digest_v3', g: 9, d: { eventHash: tag } },
        { peerPresenceHash: sender }
      );
    pump.push(fromSender('A'.repeat(32), 's1'));
    pump.push(fromSender('a'.repeat(32), 's2'));
    pump.push(fromSender('b'.repeat(32), 't1'));
    runAll();
    expect(handled.map(tagOf)).toEqual(['s2', 't1']);
    expect(digestCoalesceKey(fromSender('a'.repeat(32), 'x'))).toBe(
      `9|p:${'a'.repeat(32)}`
    );
    expect(
      digestCoalesceKey(
        chat(
          { k: 'group_state_digest_v3', g: 0, d: {} },
          { peerPresenceHash: '' }
        )
      )
    ).toBeNull();
  });

  it('never merges a digest with one already handed to the engine', () => {
    const { pump, handled, runNext, runAll } = makePump({ coalesceAbove: 0 });
    pump.push(digest(5, 'origin-a', 1, 'a1'));
    runNext();
    pump.push({ type: 'event', event: 'x', payload: { n: 1 } });
    pump.push(digest(5, 'origin-a', 2, 'a2'));
    runAll();
    expect(handled.map(tagOf)).toEqual(['a1', 1, 'a2']);
  });
});

describe('socket event pump: scheduling', () => {
  it('runs scheduled work in a later task, in order, past a failing one', async () => {
    const schedule = createMacrotaskScheduler();
    const order: number[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    schedule(() => order.push(1));
    schedule(() => {
      throw new Error('boom');
    });
    schedule(() => order.push(3));
    expect(order).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual([1, 3]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('gives the frames left behind a next slice even if a slice throws', () => {
    const runs: Array<() => void> = [];
    let calls = 0;
    const pump = new SocketEventPump({
      handle: () => undefined,
      schedule: (run) => runs.push(run),
      perfNow: () => {
        calls += 1;
        if (calls === 2) throw new Error('clock');
        return 0;
      },
    });
    pump.push({ type: 'event', event: 'x', payload: {} });
    pump.push({ type: 'event', event: 'x', payload: {} });
    expect(() => runs.shift()!()).toThrow('clock');
    expect(runs).toHaveLength(1);
    runs.shift()!();
    expect(pump.depth).toBe(0);
  });

  it('schedules once per burst and again only while frames wait', () => {
    const schedule = vi.fn();
    const pump = new SocketEventPump({
      handle: () => undefined,
      schedule,
      perfNow: () => 0,
    });
    pump.push({ type: 'event', event: 'x', payload: {} });
    pump.push({ type: 'event', event: 'x', payload: {} });
    expect(schedule).toHaveBeenCalledTimes(1);
    schedule.mock.calls[0][0]();
    expect(pump.depth).toBe(0);
    expect(schedule).toHaveBeenCalledTimes(1);
    pump.push({ type: 'event', event: 'x', payload: {} });
    expect(schedule).toHaveBeenCalledTimes(2);
  });
});
