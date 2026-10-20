import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RETICULUM_GO_PREFETCH_CONCURRENCY,
  createReticulumBackgroundEventTracker,
  newestKnownReticulumPrefetchTimestamp,
  newestReticulumPrefetchTimestamp,
  prefetchReticulumBackgroundHistory,
  processReticulumBackgroundIndexEvent,
  readReticulumBackgroundIndexWatermarks,
  waitForReticulumPrefetchFirstPaintThenIdle,
  writeReticulumBackgroundIndexWatermark,
  type ReticulumBackgroundIndexDeps,
  type ReticulumBackgroundIndexEvent,
} from './reticulumBackgroundIndex';

type TestEvent = ReticulumBackgroundIndexEvent & {
  directMentionAuthorized?: boolean;
  privilegedMentionAuthorized?: boolean;
};

const LOCAL = 'QLocalAddressxxxxxxxxxxxxxxxxxxx';

const message = (
  eventId: string,
  timestamp: number,
  extra: Partial<TestEvent> = {}
): TestEvent => ({
  eventId,
  eventType: 'message',
  groupId: 7,
  timestamp,
  encryptedPayload: JSON.stringify({ message: `hello ${eventId}` }),
  ...extra,
});

const makeDeps = (
  overrides: Partial<ReticulumBackgroundIndexDeps<TestEvent>> = {}
) => {
  const bridge = {
    indexSearchText: vi.fn(async () => ({ success: true })),
    replaceMentions: vi.fn(async () => ({ success: true })),
    deleteSearchText: vi.fn(async () => ({ success: true })),
    deleteMentions: vi.fn(async () => ({ success: true })),
  };
  const deps: ReticulumBackgroundIndexDeps<TestEvent> = {
    tracker: createReticulumBackgroundEventTracker(),
    bridge,
    isGroupReady: () => true,
    mentionedAddresses: vi.fn(async () => [LOCAL]),
    notificationAddresses: (event) =>
      event.directMentionAuthorized || event.privilegedMentionAuthorized
        ? [LOCAL]
        : [],
    recordMentionNotification: vi.fn(),
    scheduleSummaryRefresh: vi.fn(),
    ...overrides,
  };
  return { deps, bridge };
};

const live = { recordMentionNotification: true };

describe('processReticulumBackgroundIndexEvent', () => {
  it('indexes a twice-emitted event once and records its notification once', async () => {
    const { deps, bridge } = makeDeps();
    const event = message('e1', 1_000, { directMentionAuthorized: true });

    await processReticulumBackgroundIndexEvent(event, live, deps);
    await processReticulumBackgroundIndexEvent({ ...event }, live, deps);

    expect(bridge.indexSearchText).toHaveBeenCalledTimes(1);
    expect(bridge.replaceMentions).toHaveBeenCalledTimes(1);
    expect(bridge.replaceMentions).toHaveBeenCalledWith('e1', [LOCAL]);
    expect(deps.recordMentionNotification).toHaveBeenCalledTimes(1);
    expect(deps.scheduleSummaryRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not index again when the duplicate arrives while the first is still indexing', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { deps, bridge } = makeDeps();
    bridge.indexSearchText.mockImplementationOnce(async () => {
      await gate;
      return { success: true };
    });
    const event = message('e2', 1_000, { directMentionAuthorized: true });

    const first = processReticulumBackgroundIndexEvent(event, live, deps);
    const second = processReticulumBackgroundIndexEvent(event, live, deps);
    await second;
    release();
    await first;

    expect(bridge.indexSearchText).toHaveBeenCalledTimes(1);
    expect(bridge.replaceMentions).toHaveBeenCalledTimes(1);
    expect(deps.recordMentionNotification).toHaveBeenCalledTimes(1);
  });

  it('records the notification of an event the prefetch indexed, without RPCs', async () => {
    const { deps, bridge } = makeDeps();
    const event = message('e3', 1_000, { directMentionAuthorized: true });

    await processReticulumBackgroundIndexEvent(event, {}, deps);
    expect(deps.recordMentionNotification).not.toHaveBeenCalled();
    await processReticulumBackgroundIndexEvent(event, live, deps);

    expect(bridge.indexSearchText).toHaveBeenCalledTimes(1);
    expect(bridge.replaceMentions).toHaveBeenCalledTimes(1);
    expect(deps.recordMentionNotification).toHaveBeenCalledTimes(1);
  });

  it('still notifies an @everyone that is authorized only on a later emission', async () => {
    const { deps, bridge } = makeDeps();
    const unauthorized = message('e4', 1_000);
    await processReticulumBackgroundIndexEvent(unauthorized, live, deps);
    expect(deps.recordMentionNotification).not.toHaveBeenCalled();

    await processReticulumBackgroundIndexEvent(
      { ...unauthorized, privilegedMentionAuthorized: true },
      live,
      deps
    );
    expect(deps.recordMentionNotification).toHaveBeenCalledTimes(1);
    expect(bridge.indexSearchText).toHaveBeenCalledTimes(1);
  });

  it('gives the claim back when indexing fails, so a later emission retries', async () => {
    const { deps, bridge } = makeDeps();
    bridge.indexSearchText.mockRejectedValueOnce(new Error('rpc timeout'));
    const event = message('e5', 1_000);

    await expect(
      processReticulumBackgroundIndexEvent(event, live, deps)
    ).rejects.toThrow('rpc timeout');
    await processReticulumBackgroundIndexEvent(event, live, deps);

    expect(bridge.indexSearchText).toHaveBeenCalledTimes(2);
    expect(deps.tracker.isIndexed('e5')).toBe(true);
  });

  it('waits for the group to be ready before indexing', async () => {
    let ready = false;
    const { deps, bridge } = makeDeps({ isGroupReady: () => ready });
    const event = message('e6', 1_000);

    await processReticulumBackgroundIndexEvent(event, {}, deps);
    expect(bridge.indexSearchText).not.toHaveBeenCalled();
    ready = true;
    await processReticulumBackgroundIndexEvent(event, {}, deps);
    expect(bridge.indexSearchText).toHaveBeenCalledTimes(1);
  });

  it('removes a deleted message from the index once', async () => {
    const { deps, bridge } = makeDeps();
    const deletion: TestEvent = {
      eventId: 'd1',
      eventType: 'delete',
      groupId: 7,
      targetEventId: 'e1',
    };
    await processReticulumBackgroundIndexEvent(deletion, live, deps);
    await processReticulumBackgroundIndexEvent(deletion, live, deps);

    expect(bridge.deleteSearchText).toHaveBeenCalledTimes(1);
    expect(bridge.deleteMentions).toHaveBeenCalledTimes(1);
    expect(bridge.indexSearchText).not.toHaveBeenCalled();
  });

  it('indexes an edit under the edited message', async () => {
    const { deps, bridge } = makeDeps();
    await processReticulumBackgroundIndexEvent(
      message('edit1', 2_000, { eventType: 'edit', targetEventId: 'e1' }),
      {},
      deps
    );
    expect(bridge.indexSearchText).toHaveBeenCalledWith('e1', 'hello edit1');
  });
});

describe('createReticulumBackgroundEventTracker', () => {
  it('forgets events after the TTL without a full scan per lookup', () => {
    let now = 1_000;
    const tracker = createReticulumBackgroundEventTracker({
      ttlMs: 100,
      now: () => now,
    });
    expect(tracker.claimIndex('a')).toBe(true);
    expect(tracker.claimIndex('a')).toBe(false);
    tracker.markIndexed('a');
    expect(tracker.isIndexed('a')).toBe(true);
    now += 101;
    expect(tracker.isIndexed('a')).toBe(false);
    expect(tracker.claimIndex('a')).toBe(true);
  });

  it('keeps the maps near their cap, dropping the oldest entries', () => {
    let now = 0;
    const tracker = createReticulumBackgroundEventTracker({
      maxEntries: 100,
      pruneIntervalMs: 1_000_000,
      now: () => now,
    });
    for (let index = 0; index < 1_000; index += 1) {
      now += 1;
      tracker.claimIndex(`e${index}`);
      tracker.markIndexed(`e${index}`);
    }
    expect(tracker.sizes().indexed).toBeLessThanOrEqual(100 + 64);
    expect(tracker.isIndexed('e999')).toBe(true);
    expect(tracker.isIndexed('e0')).toBe(false);
  });

  it('records each notification once', () => {
    const tracker = createReticulumBackgroundEventTracker();
    expect(tracker.claimNotification('n')).toBe(true);
    expect(tracker.claimNotification('n')).toBe(false);
    expect(tracker.isNotified('n')).toBe(true);
  });
});

describe('prefetchReticulumBackgroundHistory', () => {
  const ADDRESS = 'QAccountAddressxxxxxxxxxxxxxxxxx';

  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  const mount = async ({
    history,
    watermarkAddress,
  }: {
    history: Record<number, TestEvent[]>;
    watermarkAddress: string | null;
  }) => {
    // A fresh page: new tracker, nothing prefetched yet.
    const { deps, bridge } = makeDeps();
    const prefetched = new Set<number>();
    await prefetchReticulumBackgroundHistory<TestEvent>({
      groupIds: Object.keys(history).map(Number),
      getHistory: async (groupId) => history[groupId],
      processEvent: (event) =>
        processReticulumBackgroundIndexEvent(event, {}, deps),
      isCancelled: () => false,
      isPrefetched: (groupId) => prefetched.has(groupId),
      markPrefetched: (groupId) => prefetched.add(groupId),
      watermarkAddress,
      onGroupError: () => undefined,
    });
    return { bridge, prefetched };
  };

  it('makes no index RPCs on a second start with an unchanged watermark', async () => {
    const history = {
      7: [message('a', 1_000), message('b', 2_000)],
      8: [message('c', 1_500, { groupId: 8 })],
    };
    const first = await mount({ history, watermarkAddress: ADDRESS });
    expect(first.bridge.indexSearchText).toHaveBeenCalledTimes(3);
    expect(readReticulumBackgroundIndexWatermarks(ADDRESS)).toEqual({
      '7': 2_000,
      '8': 1_500,
    });

    const second = await mount({ history, watermarkAddress: ADDRESS });
    expect(second.bridge.indexSearchText).not.toHaveBeenCalled();
    expect(second.bridge.replaceMentions).not.toHaveBeenCalled();
    expect([...second.prefetched].sort()).toEqual([7, 8]);
  });

  it('indexes only messages newer than the watermark', async () => {
    await mount({
      history: { 7: [message('a', 1_000)] },
      watermarkAddress: ADDRESS,
    });
    const next = await mount({
      history: { 7: [message('a', 1_000), message('new', 3_000)] },
      watermarkAddress: ADDRESS,
    });
    expect(next.bridge.indexSearchText).toHaveBeenCalledTimes(1);
    expect(next.bridge.indexSearchText).toHaveBeenCalledWith(
      'new',
      'hello new'
    );
    expect(readReticulumBackgroundIndexWatermarks(ADDRESS)['7']).toBe(3_000);
  });

  it('keeps watermarks per account', async () => {
    const history = { 7: [message('a', 1_000)] };
    await mount({ history, watermarkAddress: ADDRESS });
    const other = await mount({
      history,
      watermarkAddress: 'QOtherAccountxxxxxxxxxxxxxxxxxxx',
    });
    expect(other.bridge.indexSearchText).toHaveBeenCalledTimes(1);
  });

  it('re-indexes everything without a watermark (desktop)', async () => {
    const history = { 7: [message('a', 1_000), message('b', 2_000)] };
    await mount({ history, watermarkAddress: null });
    const second = await mount({ history, watermarkAddress: null });
    expect(second.bridge.indexSearchText).toHaveBeenCalledTimes(2);
    expect(readReticulumBackgroundIndexWatermarks(ADDRESS)).toEqual({});
  });

  it('still indexes when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const history = { 7: [message('a', 1_000)] };
    const first = await mount({ history, watermarkAddress: ADDRESS });
    const second = await mount({ history, watermarkAddress: ADDRESS });
    expect(first.bridge.indexSearchText).toHaveBeenCalledTimes(1);
    expect(second.bridge.indexSearchText).toHaveBeenCalledTimes(1);
  });

  it('leaves the watermark alone when a group fails part way', async () => {
    const { deps } = makeDeps();
    const errors: number[] = [];
    let calls = 0;
    await prefetchReticulumBackgroundHistory<TestEvent>({
      groupIds: [7],
      getHistory: async () => [message('a', 1_000), message('b', 2_000)],
      processEvent: async (event) => {
        calls += 1;
        if (event.eventId === 'b') throw new Error('rpc timeout');
        await processReticulumBackgroundIndexEvent(event, {}, deps);
      },
      isCancelled: () => false,
      isPrefetched: () => false,
      markPrefetched: () => undefined,
      watermarkAddress: ADDRESS,
      onGroupError: (groupId) => errors.push(groupId),
    });
    expect(calls).toBe(2);
    expect(errors).toEqual([7]);
    expect(readReticulumBackgroundIndexWatermarks(ADDRESS)).toEqual({});
  });
});

describe('GO prefetch: summary gate, idle start, 2 groups in flight', () => {
  const ADDRESS = 'QAccountAddressxxxxxxxxxxxxxxxxx';

  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  // What Group.tsx keeps in reticulumChatSummariesAtom for a group.
  const summary = (general: number | null, other = 0) => ({
    groupId: 7,
    updatedAt: Math.max(general || 0, other),
    channels: [
      ...(other ? [{ channelId: 'dev', lastEvent: { timestamp: other } }] : []),
      ...(general !== null
        ? [
            {
              channelId: 'general',
              lastEvent: { timestamp: general },
              updatedAt: general,
            },
          ]
        : []),
    ],
  });

  const goMount = async ({
    history,
    summaries,
    concurrency = RETICULUM_GO_PREFETCH_CONCURRENCY,
    beforeGroup,
  }: {
    history: Record<number, TestEvent[]>;
    summaries: Record<number, ReturnType<typeof summary> | undefined>;
    concurrency?: number;
    beforeGroup?: () => Promise<void>;
  }) => {
    const { deps, bridge } = makeDeps();
    const prefetched = new Set<number>();
    const getHistory = vi.fn(async (groupId: number) => history[groupId]);
    await prefetchReticulumBackgroundHistory<TestEvent>({
      groupIds: Object.keys(history).map(Number),
      getHistory,
      processEvent: (event) =>
        processReticulumBackgroundIndexEvent(event, {}, deps),
      isCancelled: () => false,
      isPrefetched: (groupId) => prefetched.has(groupId),
      markPrefetched: (groupId) => prefetched.add(groupId),
      watermarkAddress: ADDRESS,
      newestKnownTimestamp: (groupId) =>
        newestReticulumPrefetchTimestamp(summaries[groupId]),
      concurrency,
      beforeGroup,
      onGroupError: () => undefined,
    });
    return { bridge, getHistory, prefetched };
  };

  it('makes 0 getHistory calls for groups that did not change since the last start', async () => {
    const history = {
      7: [message('a', 1_000), message('b', 2_000)],
      8: [message('c', 1_500, { groupId: 8 })],
    };
    // First start ever: no watermark yet, so both groups are read once.
    const first = await goMount({
      history,
      summaries: { 7: summary(2_000), 8: summary(1_500) },
    });
    expect(first.getHistory).toHaveBeenCalledTimes(2);
    expect(first.bridge.indexSearchText).toHaveBeenCalledTimes(3);

    // Next start, nothing new: no RPC at all, every group counts as done.
    const second = await goMount({
      history,
      summaries: { 7: summary(2_000), 8: summary(1_500) },
    });
    expect(second.getHistory).not.toHaveBeenCalled();
    expect(second.bridge.indexSearchText).not.toHaveBeenCalled();
    expect([...second.prefetched].sort()).toEqual([7, 8]);
  });

  it('reads only the group whose newest general message is past its watermark', async () => {
    writeReticulumBackgroundIndexWatermark(ADDRESS, 7, 2_000);
    writeReticulumBackgroundIndexWatermark(ADDRESS, 8, 1_500);
    const run = await goMount({
      history: {
        7: [message('a', 1_000), message('b', 2_000), message('new', 3_000)],
        8: [message('c', 1_500, { groupId: 8 })],
      },
      // Group 8 only moved in another channel: the prefetch reads 'general'.
      summaries: { 7: summary(3_000), 8: summary(1_500, 9_000) },
    });
    expect(run.getHistory).toHaveBeenCalledTimes(1);
    expect(run.getHistory).toHaveBeenCalledWith(7);
    expect(run.bridge.indexSearchText).toHaveBeenCalledTimes(1);
    expect(run.bridge.indexSearchText).toHaveBeenCalledWith('new', 'hello new');
    expect(readReticulumBackgroundIndexWatermarks(ADDRESS)['7']).toBe(3_000);
  });

  it('skips a group without any summary (no chat message once loaded)', async () => {
    const run = await goMount({
      history: { 7: [], 9: [] },
      summaries: { 7: undefined, 9: summary(null, 4_000) },
    });
    expect(run.getHistory).not.toHaveBeenCalled();
    expect([...run.prefetched].sort()).toEqual([7, 9]);
  });

  it('reads history when the newest message is unknown (null)', async () => {
    writeReticulumBackgroundIndexWatermark(ADDRESS, 7, 2_000);
    const { deps } = makeDeps();
    const getHistory = vi.fn(async () => [message('a', 1_000)]);
    await prefetchReticulumBackgroundHistory<TestEvent>({
      groupIds: [7],
      getHistory,
      processEvent: (event) =>
        processReticulumBackgroundIndexEvent(event, {}, deps),
      isCancelled: () => false,
      isPrefetched: () => false,
      markPrefetched: () => undefined,
      watermarkAddress: ADDRESS,
      newestKnownTimestamp: () => null,
      onGroupError: () => undefined,
    });
    expect(getHistory).toHaveBeenCalledTimes(1);
  });

  it('never has more than 2 groups in flight on GO, and reads every group', async () => {
    const groupIds = [1, 2, 3, 4, 5, 6, 7];
    let inFlight = 0;
    let maxInFlight = 0;
    const release: Array<() => void> = [];
    const read: number[] = [];
    const done = prefetchReticulumBackgroundHistory<TestEvent>({
      groupIds,
      getHistory: (groupId) =>
        new Promise((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          read.push(groupId);
          release.push(() => {
            inFlight -= 1;
            resolve([message(`m${groupId}`, 1_000 + groupId, { groupId })]);
          });
        }),
      processEvent: async () => undefined,
      isCancelled: () => false,
      isPrefetched: () => false,
      markPrefetched: () => undefined,
      watermarkAddress: ADDRESS,
      newestKnownTimestamp: () => 5_000,
      concurrency: RETICULUM_GO_PREFETCH_CONCURRENCY,
      onGroupError: () => undefined,
    });
    // Answer one read at a time; the next group may start after each answer.
    for (
      let step = 0;
      step < 100 && (read.length < groupIds.length || release.length > 0);
      step += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(inFlight).toBeLessThanOrEqual(2);
      release.shift()?.();
    }
    await done;
    expect(RETICULUM_GO_PREFETCH_CONCURRENCY).toBe(2);
    expect(maxInFlight).toBe(2);
    expect(read.sort((a, b) => a - b)).toEqual(groupIds);
    expect(inFlight).toBe(0);
  });

  it('keeps the desktop loop one group at a time', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await prefetchReticulumBackgroundHistory<TestEvent>({
      groupIds: [1, 2, 3],
      getHistory: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return [];
      },
      processEvent: async () => undefined,
      isCancelled: () => false,
      isPrefetched: () => false,
      markPrefetched: () => undefined,
      watermarkAddress: null,
      onGroupError: () => undefined,
    });
    expect(maxInFlight).toBe(1);
  });

  it('waits for idle before each history read, not for skipped groups', async () => {
    writeReticulumBackgroundIndexWatermark(ADDRESS, 8, 1_500);
    const order: string[] = [];
    const run = await goMount({
      history: {
        7: [message('a', 1_000)],
        8: [message('c', 1_500, { groupId: 8 })],
      },
      summaries: { 7: summary(1_000), 8: summary(1_500) },
      concurrency: 1,
      beforeGroup: async () => {
        order.push('idle');
      },
    });
    expect(run.getHistory).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['idle']);
  });

  it('starts only after a frame was painted and the main thread is idle', async () => {
    const frames: Array<() => void> = [];
    const idles: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal(
      'requestIdleCallback',
      (callback: () => void, options?: { timeout?: number }) => {
        expect(options?.timeout).toBeGreaterThan(0);
        idles.push(callback);
        return idles.length;
      }
    );
    let started = false;
    const waiting = waitForReticulumPrefetchFirstPaintThenIdle().then(() => {
      started = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    // No frame yet (first paint pending, or GO hidden): nothing runs.
    expect(started).toBe(false);
    expect(idles).toHaveLength(0);

    frames.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(started).toBe(false);
    expect(idles).toHaveLength(1);

    idles.shift()?.();
    await waiting;
    expect(started).toBe(true);
  });

  it('reads a group whose only news is an edit newer than the watermark, once', async () => {
    // The message was indexed by an earlier start; it was then edited while
    // GO was closed. The edit moves the channel's readThroughTimestamp, not
    // its lastEvent.
    writeReticulumBackgroundIndexWatermark(ADDRESS, 7, 2_000);
    const edited = {
      groupId: 7,
      updatedAt: 2_000,
      channels: [
        {
          channelId: 'general',
          lastEvent: { timestamp: 2_000 },
          updatedAt: 2_000,
          readThroughTimestamp: 2_500,
        },
      ],
    };
    const history = {
      7: [
        message('m1', 2_000),
        message('edit1', 2_500, { eventType: 'edit', targetEventId: 'm1' }),
      ],
    };
    const run = await goMount({ history, summaries: { 7: edited as any } });
    expect(run.getHistory).toHaveBeenCalledTimes(1);
    expect(run.bridge.indexSearchText).toHaveBeenCalledTimes(1);
    expect(run.bridge.indexSearchText).toHaveBeenCalledWith(
      'm1',
      'hello edit1'
    );
    // The watermark moved past the edit: the next start skips the group.
    expect(readReticulumBackgroundIndexWatermarks(ADDRESS)['7']).toBe(2_500);
    const next = await goMount({ history, summaries: { 7: edited as any } });
    expect(next.getHistory).not.toHaveBeenCalled();
  });

  it('treats an emptied summaries atom as unknown, so groups are read, not skipped', async () => {
    expect(newestKnownReticulumPrefetchTimestamp({}, 7)).toBeNull();
    expect(newestKnownReticulumPrefetchTimestamp(null, 7)).toBeNull();
    expect(newestKnownReticulumPrefetchTimestamp(undefined, 7)).toBeNull();
    // Loaded: a group missing from it has no chat message (0, skip).
    const loaded = { '7': summary(2_000) };
    expect(newestKnownReticulumPrefetchTimestamp(loaded, 7)).toBe(2_000);
    expect(newestKnownReticulumPrefetchTimestamp(loaded, 8)).toBe(0);

    // The atom empties while the run is under way (a failed refresh): the
    // remaining groups are read instead of being marked done unread.
    writeReticulumBackgroundIndexWatermark(ADDRESS, 7, 2_000);
    writeReticulumBackgroundIndexWatermark(ADDRESS, 8, 1_000);
    let atom: Record<string, ReturnType<typeof summary>> = {
      '7': summary(2_000),
      '8': { ...summary(3_000), groupId: 8 },
    };
    const getHistory = vi.fn(async (groupId: number) => {
      atom = {};
      return [message(`n${groupId}`, 3_000, { groupId })];
    });
    const prefetched = new Set<number>();
    await prefetchReticulumBackgroundHistory<TestEvent>({
      groupIds: [8, 9, 7],
      getHistory,
      processEvent: async () => undefined,
      isCancelled: () => false,
      isPrefetched: (groupId) => prefetched.has(groupId),
      markPrefetched: (groupId) => prefetched.add(groupId),
      watermarkAddress: ADDRESS,
      newestKnownTimestamp: (groupId) =>
        newestKnownReticulumPrefetchTimestamp(atom, groupId),
      concurrency: 1,
      onGroupError: () => undefined,
    });
    expect(getHistory.mock.calls.map(([groupId]) => groupId)).toEqual([
      8, 9, 7,
    ]);
  });

  it('reads the newest general message from a summary', () => {
    expect(newestReticulumPrefetchTimestamp(undefined)).toBe(0);
    expect(newestReticulumPrefetchTimestamp(summary(null, 9_000))).toBe(0);
    expect(newestReticulumPrefetchTimestamp(summary(2_000, 9_000))).toBe(2_000);
    // An older shape without channels falls back to the group's newest.
    expect(
      newestReticulumPrefetchTimestamp({
        lastEvent: { timestamp: 4_000 },
        updatedAt: 3_000,
      })
    ).toBe(4_000);
  });
});
