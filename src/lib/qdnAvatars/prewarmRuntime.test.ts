import { afterEach, describe, expect, it, vi } from 'vitest';
import { setQdnAvatarCacheForTests } from './defaultCache';
import { prewarmQdnAvatars } from './index';
import {
  cancelQdnAvatarPrewarmEntry,
  isQdnAvatarPrewarmEntryPending,
  qdnAvatarCacheHasWork,
  readCachedQdnAvatarChecker,
} from './prewarmRuntime';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
  notPublishedResponse,
} from './testHarness';

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

/** Moves the harness clock in small steps so fetch chains can progress. */
const advanceBy = async (
  h: ReturnType<typeof createAvatarTestHarness>,
  ms: number,
  step = 1_000
) => {
  for (let passed = 0; passed < ms; passed += step) await h.advance(step);
};

describe('isQdnAvatarPrewarmEntryPending', () => {
  it('tells a prewarm job that never got a slot from a node failure', async () => {
    // Slow node: every visible avatar request hangs.
    const hanging: Array<() => void> = [];
    const h = createAvatarTestHarness({
      handler: (_url, info) =>
        info.name.startsWith('v')
          ? new Promise<Response>((resolve) => {
              hanging.push(() => resolve(imageResponse()));
            })
          : imageResponse(),
    });
    setQdnAvatarCacheForTests(h.cache);
    await h.cache.init();
    for (let i = 0; i < 20; i += 1) {
      h.cache.request(h.cache.keyFor(`v${i}`), {
        name: `v${i}`,
        priority: 'high',
      });
    }

    const result = prewarmQdnAvatars(['p1'], {
      limit: 1,
      maxConsecutiveFailures: 1,
    });
    await advanceBy(h, 45_000);
    // prewarm() stopped waiting and calls it a failure, but the node was
    // never asked: the job is still queued behind the visible avatars.
    await expect(result).resolves.toMatchObject({ failed: 1 });
    expect(h.calls.some((call) => call.name === 'p1')).toBe(false);
    expect(isQdnAvatarPrewarmEntryPending('p1')).toBe(true);
    expect(isQdnAvatarPrewarmEntryPending({ name: 'p1' })).toBe(true);

    // The node answers again: the queue drains and 'p1' is done.
    h.setHandler(() => imageResponse());
    for (const release of hanging.splice(0)) release();
    await advanceBy(h, 5_000);
    expect(h.calls.some((call) => call.name === 'p1')).toBe(true);
    expect(isQdnAvatarPrewarmEntryPending('p1')).toBe(false);
  });

  it('is false for unknown, failed or broken entries', async () => {
    const h = createAvatarTestHarness({
      handler: () => {
        throw new TypeError('offline');
      },
    });
    setQdnAvatarCacheForTests(h.cache);
    await h.cache.init();
    expect(isQdnAvatarPrewarmEntryPending('Never Asked')).toBe(false);
    expect(isQdnAvatarPrewarmEntryPending('')).toBe(false);
    expect(isQdnAvatarPrewarmEntryPending(null as any)).toBe(false);

    const result = prewarmQdnAvatars(['Down'], { limit: 1 });
    await advanceBy(h, 10_000);
    await expect(result).resolves.toMatchObject({ failed: 1 });
    expect(isQdnAvatarPrewarmEntryPending('Down')).toBe(false);
  });
});

describe('cache queue view', () => {
  it('reads the queue from the cache diagnostic view (contract)', async () => {
    // prewarmRuntime has no public accessor for the queue yet and reads
    // debugState(): if its shape changes, this test must fail, not the
    // prewarm silently counting busy avatars as node failures.
    const hanging: Array<() => void> = [];
    const h = createAvatarTestHarness({
      handler: () =>
        new Promise<Response>((resolve) => {
          hanging.push(() => resolve(imageResponse()));
        }),
    });
    setQdnAvatarCacheForTests(h.cache);
    await h.cache.init();
    expect(qdnAvatarCacheHasWork()).toBe(false);

    const names = ['a', 'b', 'c', 'd'];
    for (const name of names) h.cache.request(h.cache.keyFor(name), { name });
    await flushAsync();
    const debug = h.cache.debugState();
    expect(debug.active).toHaveLength(3);
    expect(debug.active.every((key) => typeof key === 'string')).toBe(true);
    expect(debug.queued).toHaveLength(1);
    expect(typeof debug.queued[0].key).toBe('string');
    expect(qdnAvatarCacheHasWork()).toBe(true);
    for (const name of names) {
      expect(isQdnAvatarPrewarmEntryPending(name)).toBe(true);
    }

    while (hanging.length) {
      for (const release of hanging.splice(0)) release();
      await h.idle();
    }
    expect(qdnAvatarCacheHasWork()).toBe(false);
    expect(isQdnAvatarPrewarmEntryPending('a')).toBe(false);
    expect(h.cache.debugState().metas.map((meta) => meta.key)).toContain(
      h.cache.keyFor('a')
    );
  });

  it('drops a queued prewarm job only when the cache can', () => {
    const h = createAvatarTestHarness();
    const cancelPrewarm = vi.fn();
    setQdnAvatarCacheForTests({ ...h.cache, cancelPrewarm } as any);
    cancelQdnAvatarPrewarmEntry({
      name: 'Owner',
      identifier: 'qortal_group_avatar_5',
    });
    expect(cancelPrewarm).toHaveBeenCalledWith(
      'THUMBNAIL/owner/qortal_group_avatar_5'
    );

    setQdnAvatarCacheForTests(h.cache);
    expect(() => cancelQdnAvatarPrewarmEntry('Anyone')).not.toThrow();
    expect(() => cancelQdnAvatarPrewarmEntry(null as any)).not.toThrow();
  });

  it('knows which avatars GO showed on this device before', async () => {
    const h = createAvatarTestHarness({
      handler: (_url, info) =>
        info.name === 'Gone' ? notPublishedResponse('Gone') : imageResponse(),
    });
    setQdnAvatarCacheForTests(h.cache);
    await prewarmQdnAvatars(['Seen', 'Gone']);
    await h.idle();
    const isCached = await readCachedQdnAvatarChecker();
    expect(isCached('seen')).toBe(true);
    // A confirmed "no avatar" is a record too: the node was asked before.
    expect(isCached('Gone')).toBe(true);
    expect(isCached('Never')).toBe(false);
    expect(isCached('')).toBe(false);
  });
});
