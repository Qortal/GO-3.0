/**
 * The prewarm stays in the background: it can be cancelled while queued,
 * never holds a blocking slot next to a visible avatar, and does not load
 * cached images nothing shows.
 */
import { describe, expect, it, vi } from 'vitest';
import type { QdnAvatarMeta } from './avatarStore';
import { qdnAvatarKey, type QdnAvatarKey } from './keys';
import {
  createAvatarTestHarness,
  imageResponse,
  notFoundResponse,
  PNG_BYTES,
  statusResponse,
} from './testHarness';

const keyOf = (name: string) => qdnAvatarKey(name)!;

const meta = (
  key: QdnAvatarKey,
  extra: Partial<QdnAvatarMeta> = {}
): QdnAvatarMeta => ({
  key,
  size: PNG_BYTES.byteLength,
  fetchedAt: 0,
  lastUsedAt: 0,
  useCount: 0,
  ...extra,
});

const stored = (key: QdnAvatarKey) => ({
  key,
  bytes: PNG_BYTES.slice().buffer,
  type: 'image/png',
});

const never = () => new Promise<Response>(() => {});

describe('cancelPrewarm', () => {
  it('drops a queued prewarm job and lets prewarm() return at once', async () => {
    const h = createAvatarTestHarness({
      handler: never,
      limits: { maxConcurrent: 1 },
    });
    await h.cache.init();
    // The only slot is busy, so the prewarm job waits in the queue.
    h.cache.request(keyOf('busy'), { name: 'busy', priority: 'high' });
    await h.idle();

    const done = vi.fn();
    void h.cache.prewarm(['later']).then(done);
    await h.idle();
    expect(h.cache.debugState().queued.map((job) => job.key)).toEqual([
      keyOf('later'),
    ]);

    expect(h.cache.cancelPrewarm(keyOf('later'))).toBe(true);
    await h.idle();

    expect(done).toHaveBeenCalledTimes(1);
    expect(h.cache.debugState().queued).toEqual([]);
    expect(h.calls.map((call) => call.name)).toEqual(['busy']);
  });

  it('keeps a job something else asked for', async () => {
    const h = createAvatarTestHarness({
      handler: never,
      limits: { maxConcurrent: 1 },
    });
    await h.cache.init();
    h.cache.request(keyOf('busy'), { name: 'busy', priority: 'high' });
    await h.idle();

    // On screen.
    void h.cache.prewarm(['shown']);
    await h.idle();
    const unsubscribe = h.cache.subscribe(keyOf('shown'), () => {});
    expect(h.cache.cancelPrewarm(keyOf('shown'))).toBe(false);
    unsubscribe();

    // Asked for by a notification icon.
    void h.cache.prewarm(['notified']);
    await h.idle();
    void h.cache.getDataUrl('notified', { timeoutMs: 60_000 });
    await h.idle();
    expect(h.cache.cancelPrewarm(keyOf('notified'))).toBe(false);

    expect(h.cache.cancelPrewarm(null)).toBe(false);
    expect(h.cache.cancelPrewarm(keyOf('unknown'))).toBe(false);
  });
});

describe('prewarm and blocking requests', () => {
  it('waits for a visible blocking request to finish before its own', async () => {
    const blocking: Array<(response: Response) => void> = [];
    const h = createAvatarTestHarness({
      handler: (_url, info) => {
        if (info.kind === 'async') return notFoundResponse('File not found');
        if (info.kind === 'status') return statusResponse('DOWNLOADING');
        return new Promise<Response>((resolve) => {
          blocking.push(resolve);
        });
      },
    });
    await h.cache.init();
    const unsubscribe = h.cache.subscribe(keyOf('visible'), () => {});
    h.cache.request(keyOf('visible'), { name: 'visible' });
    await h.idle();
    expect(blocking).toHaveLength(1);

    void h.cache.prewarm(['background']);
    await h.idle();
    const backgroundKinds = () =>
      h.calls.filter((call) => call.name === 'background').map((c) => c.kind);
    // The second blocking slot stays free for avatars on screen.
    expect(backgroundKinds()).toEqual(['async', 'status']);

    blocking.shift()!(imageResponse());
    await h.idle();
    expect(backgroundKinds()).toEqual(['async', 'status', 'blocking']);
    unsubscribe();
  });
});

describe('prewarm of cached avatars', () => {
  it('does not load a fresh cached image nobody shows', async () => {
    const h = createAvatarTestHarness({
      handler: never,
      limits: { preloadCount: 0 },
    });
    const key = keyOf('cached');
    await h.store.putEntry(meta(key, { fetchedAt: h.now() }), stored(key));
    await h.cache.init();

    const result = await h.cache.prewarm(['cached']);
    await h.idle();

    expect(result.skipped).toBe(1);
    expect(h.created).toEqual([]);
    expect(h.calls).toEqual([]);

    // Shown later: loaded from storage as usual.
    h.cache.subscribe(key, () => {});
    h.cache.request(key, { name: 'cached' });
    await h.idle();
    expect(h.cache.getSnapshot(key).src).toBe('blob:test/1');
  });
});
