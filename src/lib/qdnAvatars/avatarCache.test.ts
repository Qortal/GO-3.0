import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openQdnAvatarStore, type QdnAvatarMeta } from './avatarStore';
import { createQdnAvatarCache, qdnAvatarRefreshSpread } from './avatarCache';
import {
  parseQdnAvatarKey,
  qdnAvatarKey,
  qdnGroupAvatarIdentifier,
} from './keys';
import {
  API_BASE,
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
  notFoundResponse,
  notPublishedResponse,
  PNG_BYTES,
  statusResponse,
} from './testHarness';

const HOUR = 60 * 60 * 1000;
const keyOf = (name: string) => qdnAvatarKey(name)!;

const storedMeta = (
  name: string,
  extra: Partial<QdnAvatarMeta> = {}
): QdnAvatarMeta => ({
  key: keyOf(name),
  size: PNG_BYTES.byteLength,
  fetchedAt: 0,
  lastUsedAt: 0,
  useCount: 0,
  ...extra,
});

const storedImage = (name: string) => ({
  key: keyOf(name),
  bytes: PNG_BYTES.slice().buffer,
  type: 'image/png',
});

describe('QDN avatar cache: fetching', () => {
  it('uses the async URL first and caches the image', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    const key = keyOf('Alice');
    h.cache.request(key, { name: 'Alice' });
    await flushAsync();

    expect(h.calls.map((call) => call.url)).toEqual([
      `${API_BASE}/arbitrary/THUMBNAIL/Alice/qortal_avatar?async=true`,
    ]);
    expect(h.cache.getSnapshot(key)).toEqual({
      src: 'blob:test/1',
      status: 'ready',
      source: 'cache',
    });
    // Already cached: no new request.
    h.cache.request(key, { name: 'alice' });
    await flushAsync();
    expect(h.calls).toHaveLength(1);
  });

  it('falls back to a blocking fetch when the node is still fetching', async () => {
    const h = createAvatarTestHarness({
      handler: (_url, { kind }) => {
        if (kind === 'async') return notFoundResponse('File not found');
        if (kind === 'status') return statusResponse('MISSING_DATA');
        return imageResponse();
      },
    });
    const key = keyOf('Bob');
    h.cache.request(key, { name: 'Bob' });
    await flushAsync();

    expect(h.kinds()).toEqual(['async', 'status', 'blocking']);
    expect(h.calls[2].url).toBe(
      `${API_BASE}/arbitrary/THUMBNAIL/Bob/qortal_avatar`
    );
    expect(h.cache.getSnapshot(key).status).toBe('ready');
  });

  it('also tries the blocking fetch when the async request times out', async () => {
    const h = createAvatarTestHarness({
      limits: { asyncTimeoutMs: 10 },
      handler: (_url, { kind }) => {
        if (kind === 'async') {
          return new Promise<Response>(() => {
            // never answers; the attempt times out
          });
        }
        if (kind === 'status') return statusResponse('DOWNLOADING');
        return imageResponse();
      },
    });
    h.cache.request(keyOf('Slow'), { name: 'Slow' });
    await h.idle();
    expect(h.kinds()).toEqual(['async']);
    await h.advance(10);
    await h.idle();
    expect(h.kinds()).toEqual(['async', 'status', 'blocking']);
    expect(h.cache.getSnapshot(keyOf('Slow')).status).toBe('ready');
  });

  it('marks a never-published avatar missing without a blocking fetch', async () => {
    const h = createAvatarTestHarness({
      handler: (_url, { kind }) =>
        kind === 'status'
          ? statusResponse('NOT_PUBLISHED')
          : notFoundResponse('File not found'),
    });
    const key = keyOf('Carol');
    h.cache.request(key, { name: 'Carol' });
    await flushAsync();
    expect(h.kinds()).toEqual(['async', 'status']);
    expect(h.cache.getSnapshot(key)).toEqual({
      src: undefined,
      status: 'missing',
      source: null,
    });

    // Re-checked only after about 6 hours.
    await h.advance(5 * HOUR);
    h.cache.request(key, { name: 'Carol' });
    await flushAsync();
    expect(h.calls).toHaveLength(2);
    await h.advance(1 * HOUR + 1);
    h.cache.request(key, { name: 'Carol' });
    await flushAsync();
    expect(h.kinds()).toEqual(['async', 'status', 'async', 'status']);
  });

  it('trusts the blocking 404 "no PUT transaction" answer as missing', async () => {
    const h = createAvatarTestHarness({
      handler: (_url, { kind }) => {
        if (kind === 'async') return notFoundResponse();
        if (kind === 'status') return new Response('', { status: 500 });
        return notPublishedResponse('dave');
      },
    });
    const key = keyOf('Dave');
    h.cache.request(key, { name: 'Dave' });
    await flushAsync();
    expect(h.kinds()).toEqual(['async', 'status', 'blocking']);
    expect(h.cache.getSnapshot(key).status).toBe('missing');
  });

  it('backs off after failures: 30 s, then 2 min', async () => {
    const h = createAvatarTestHarness({
      handler: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const key = keyOf('Erin');
    h.cache.request(key, { name: 'Erin' });
    await flushAsync();
    expect(h.calls).toHaveLength(1);
    expect(h.cache.getSnapshot(key).status).toBe('failed');

    await h.advance(29_000);
    h.cache.request(key, { name: 'Erin' });
    await flushAsync();
    expect(h.calls).toHaveLength(1);

    await h.advance(1_001);
    h.cache.request(key, { name: 'Erin' });
    await flushAsync();
    expect(h.calls).toHaveLength(2);

    await h.advance(60_000);
    h.cache.request(key, { name: 'Erin' });
    await flushAsync();
    expect(h.calls).toHaveLength(2);
    await h.advance(60_001);
    h.cache.request(key, { name: 'Erin' });
    await flushAsync();
    expect(h.calls).toHaveLength(3);
  });

  it('retries on its own while an avatar is on screen', async () => {
    let fail = true;
    const h = createAvatarTestHarness({
      handler: () => {
        if (fail) throw new TypeError('Failed to fetch');
        return imageResponse();
      },
    });
    const key = keyOf('Frank');
    const unsubscribe = h.cache.subscribe(key, () => {});
    h.cache.request(key, { name: 'Frank' });
    await flushAsync();
    expect(h.cache.getSnapshot(key).status).toBe('failed');

    fail = false;
    await h.advance(30_000);
    await flushAsync();
    expect(h.calls).toHaveLength(2);
    expect(h.cache.getSnapshot(key).status).toBe('ready');
    unsubscribe();
  });

  it('runs at most 3 requests at once and one per name', async () => {
    const pending: Array<() => void> = [];
    const h = createAvatarTestHarness({
      handler: () =>
        new Promise<Response>((resolve) => {
          pending.push(() => resolve(imageResponse()));
        }),
    });
    const names = ['n1', 'n2', 'n3', 'n4', 'n5'];
    for (const name of names) h.cache.request(keyOf(name), { name });
    h.cache.request(keyOf('n1'), { name: 'N1' });
    h.cache.request(keyOf('n5'), { name: 'n5' });
    await flushAsync();
    expect(h.calls).toHaveLength(3);
    expect(h.cache.debugState().activeCount).toBe(3);

    while (pending.length) {
      pending.shift()!();
      await flushAsync();
    }
    expect(h.calls).toHaveLength(5);
    for (const name of names) {
      expect(h.cache.getSnapshot(keyOf(name)).status).toBe('ready');
    }
  });

  it('keeps a slot free for quick requests while blocking fetches wait', async () => {
    const h = createAvatarTestHarness({
      handler: (_url, { kind, name }) => {
        if (kind === 'blocking') return new Promise<Response>(() => {});
        if (kind === 'status') return statusResponse('MISSING_DATA');
        return name === 'quick' ? imageResponse() : notFoundResponse();
      },
    });
    for (const name of ['b1', 'b2', 'b3']) {
      h.cache.request(keyOf(name), { name });
    }
    await flushAsync();
    expect(h.calls.filter((call) => call.kind === 'blocking')).toHaveLength(2);
    h.cache.request(keyOf('quick'), { name: 'quick' });
    await flushAsync();
    expect(h.cache.getSnapshot(keyOf('quick')).status).toBe('ready');
  });

  it('treats an image the browser cannot decode as no avatar', async () => {
    const cache = createQdnAvatarCache({
      getApiBase: () => API_BASE,
      fetch: async () => imageResponse(),
      openStore: () => openQdnAvatarStore({ factory: null }),
      downscale: async () => null,
    });
    const key = keyOf('Broken');
    cache.request(key, { name: 'Broken' });
    await flushAsync();
    expect(cache.getSnapshot(key).status).toBe('missing');
  });

  it('never throws when the node URL cannot be read', async () => {
    const cache = createQdnAvatarCache({
      getApiBase: () => {
        throw new Error('no node');
      },
      fetch: async () => imageResponse(),
      openStore: async () => await openQdnAvatarStore({ factory: null }),
    });
    const key = keyOf('Gina');
    expect(() => cache.request(key, { name: 'Gina' })).not.toThrow();
    await flushAsync();
    expect(cache.getSnapshot(key).status).toBe('failed');
  });

  it('works on group avatars', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    const key = qdnAvatarKey('Owner', qdnGroupAvatarIdentifier(7))!;
    h.cache.request(key, { name: 'Owner' });
    await flushAsync();
    expect(h.calls[0].url).toBe(
      `${API_BASE}/arbitrary/THUMBNAIL/Owner/qortal_group_avatar_7?async=true`
    );
    expect(h.cache.getSnapshot(key).status).toBe('ready');
  });
});

describe('QDN avatar cache: storage and freshness', () => {
  it('shows a stored image at once and refreshes it after 24 h', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    const now = h.now();
    await h.store.putEntry(
      storedMeta('Hank', { fetchedAt: now - 25 * HOUR }),
      storedImage('Hank')
    );
    const key = keyOf('Hank');
    h.cache.request(key, { name: 'Hank' });
    await flushAsync();
    // The stored copy was shown first, then replaced by the refreshed one.
    expect(h.created).toEqual(['blob:test/1', 'blob:test/2']);
    expect(h.calls).toHaveLength(1);
    expect(h.cache.getSnapshot(key).src).toBe('blob:test/2');

    await h.advance(30_000);
    expect(h.revoked).toEqual(['blob:test/1']);
  });

  it('does not refetch a stored image younger than 24 h', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    await h.store.putEntry(
      storedMeta('Ivy', { fetchedAt: h.now() - 2 * HOUR }),
      storedImage('Ivy')
    );
    h.cache.request(keyOf('Ivy'), { name: 'Ivy' });
    await flushAsync();
    expect(h.calls).toHaveLength(0);
    expect(h.cache.getSnapshot(keyOf('Ivy')).status).toBe('ready');
  });

  it('spreads re-checks per avatar so they do not all run together', async () => {
    const names = Array.from({ length: 40 }, (_, i) => `user${i}`);
    const spreads = names.map((name) => qdnAvatarRefreshSpread(keyOf(name)));
    for (const value of spreads) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    // Fixed per key, and different keys land at different times.
    expect(qdnAvatarRefreshSpread(keyOf('user0'))).toBe(spreads[0]);
    expect(new Set(spreads.map((v) => Math.floor(v * 4))).size).toBe(4);

    // With a 25 % spread, an avatar late in the spread is fresh at 26 h and
    // stale once its own period (24-30 h) has passed.
    const late = names[spreads.findIndex((v) => v > 0.5)];
    const check = async (ageHours: number) => {
      const h = createAvatarTestHarness({
        handler: () => imageResponse(),
        limits: { refreshSpread: 0.25 },
      });
      await h.store.putEntry(
        storedMeta(late, { fetchedAt: h.now() - ageHours * HOUR }),
        storedImage(late)
      );
      h.cache.request(keyOf(late), { name: late });
      await flushAsync();
      return h.calls.length;
    };
    expect(await check(26)).toBe(0);
    expect(await check(31)).toBe(1);
  });

  it('keeps a cached image when a refresh says "missing"', async () => {
    const h = createAvatarTestHarness({
      handler: (_url, { kind }) =>
        kind === 'status'
          ? statusResponse('NOT_PUBLISHED')
          : notFoundResponse(),
    });
    await h.store.putEntry(
      storedMeta('Jack', { fetchedAt: h.now() - 30 * HOUR }),
      storedImage('Jack')
    );
    h.cache.request(keyOf('Jack'), { name: 'Jack' });
    await flushAsync();
    expect(h.cache.getSnapshot(keyOf('Jack')).status).toBe('ready');
  });

  it('persists to IndexedDB and reads it back after a restart', async () => {
    const factory = new IDBFactory();
    const openStore = () =>
      openQdnAvatarStore({ factory, name: 'go-qdn-avatars-test' });
    const first = createAvatarTestHarness({
      openStore,
      handler: () => imageResponse(),
    });
    first.cache.request(keyOf('Kim'), { name: 'Kim' });
    await flushAsync(10);
    expect(first.cache.debugState().storeKind).toBe('indexeddb');

    const second = createAvatarTestHarness({
      openStore,
      handler: () => imageResponse(),
    });
    second.cache.request(keyOf('kim'), { name: 'kim' });
    await flushAsync(10);
    expect(second.calls).toHaveLength(0);
    expect(second.cache.getSnapshot(keyOf('KIM')).status).toBe('ready');
  });

  it('works as an in-memory cache without IndexedDB', async () => {
    const h = createAvatarTestHarness({
      openStore: () => openQdnAvatarStore({ factory: null }),
      handler: () => imageResponse(),
    });
    h.cache.request(keyOf('Lou'), { name: 'Lou' });
    await flushAsync();
    expect(h.cache.debugState().storeKind).toBe('memory');
    expect(h.cache.getSnapshot(keyOf('Lou')).status).toBe('ready');
  });

  it('evicts the least used images first, never ones on screen', async () => {
    const h = createAvatarTestHarness({
      limits: { maxImages: 3 },
      handler: () => imageResponse(),
    });
    const now = h.now();
    // Old, rarely used.
    await h.store.putEntry(
      storedMeta('old', { fetchedAt: now, lastUsedAt: now - 30 * 24 * HOUR }),
      storedImage('old')
    );
    // Old but on screen.
    await h.store.putEntry(
      storedMeta('watched', {
        fetchedAt: now,
        lastUsedAt: now - 60 * 24 * HOUR,
      }),
      storedImage('watched')
    );
    // Recent and often used.
    await h.store.putEntry(
      storedMeta('busy', { fetchedAt: now, lastUsedAt: now, useCount: 20 }),
      storedImage('busy')
    );
    const unsubscribe = h.cache.subscribe(keyOf('watched'), () => {});
    h.cache.request(keyOf('watched'), { name: 'watched' });
    h.cache.request(keyOf('fresh'), { name: 'fresh' });
    await flushAsync();
    await h.advance(2_000);

    const kept = h.cache
      .debugState()
      .metas.map((meta) => parseQdnAvatarKey(meta.key)!.name)
      .sort();
    expect(kept).toEqual(['busy', 'fresh', 'watched']);
    const stored = (await h.store.loadAllMeta()).map(
      (meta) => parseQdnAvatarKey(meta.key)!.name
    );
    expect(stored.sort()).toEqual(['busy', 'fresh', 'watched']);
    unsubscribe();
  });

  it('counts uses (throttled) and stores the counters', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    const key = keyOf('Mia');
    h.cache.noteUse(key); // before the image exists
    h.cache.request(key, { name: 'Mia' });
    await flushAsync();
    expect(h.cache.debugState().metas[0].useCount).toBe(1);

    h.cache.noteUse(key); // throttled
    await h.advance(31 * 60 * 1000);
    h.cache.noteUse(key);
    await h.advance(5_000);
    const stored = await h.store.loadAllMeta();
    expect(stored[0].useCount).toBe(2);
    expect(stored[0].lastUsedAt).toBe(h.now() - 5_000);
  });
});

describe('QDN avatar cache: seeds, helpers, clearing', () => {
  it('shows the bundled seed until the live icon arrives', async () => {
    let answer: (() => void) | null = null;
    const key = keyOf('Q-Tube');
    const h = createAvatarTestHarness({
      seeds: { [key]: '/assets/q-tube.webp' },
      handler: () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(imageResponse());
        }),
    });
    expect(h.cache.getSnapshot(key)).toEqual({
      src: '/assets/q-tube.webp',
      status: 'loading',
      source: 'seed',
    });
    h.cache.request(key, { name: 'Q-Tube' });
    await flushAsync();
    expect(h.cache.getSnapshot(key).source).toBe('seed');
    answer!();
    await flushAsync();
    expect(h.cache.getSnapshot(key)).toEqual({
      src: 'blob:test/1',
      status: 'ready',
      source: 'cache',
    });
  });

  it('keeps the seed when the node has no icon', async () => {
    const key = keyOf('Q-Mail');
    const h = createAvatarTestHarness({
      seeds: { [key]: '/assets/q-mail.webp' },
      handler: () => {
        throw new TypeError('offline');
      },
    });
    h.cache.request(key, { name: 'Q-Mail' });
    await flushAsync();
    expect(h.cache.getSnapshot(key)).toEqual({
      src: '/assets/q-mail.webp',
      status: 'failed',
      source: 'seed',
    });
  });

  it('notifies only the subscribers of the avatar that changed', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    let aliceCalls = 0;
    let bobCalls = 0;
    h.cache.subscribe(keyOf('alice'), () => {
      aliceCalls += 1;
    });
    h.cache.subscribe(keyOf('bob'), () => {
      bobCalls += 1;
    });
    await flushAsync();
    const bobBefore = bobCalls;
    h.cache.request(keyOf('alice'), { name: 'alice' });
    await flushAsync();
    expect(aliceCalls).toBeGreaterThan(0);
    expect(bobCalls).toBe(bobBefore);
  });

  it('returns a data URL for notifications', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    await expect(h.cache.getDataUrl('Nina')).resolves.toBe(
      'data:image/png;base64,iVBORw0KGgoAAAAA'
    );
    // Second time from the cache.
    await expect(h.cache.getDataUrl('nina')).resolves.toMatch(
      /^data:image\/png/
    );
    expect(h.calls).toHaveLength(1);
  });

  it('getDataUrl uses the seed when the node fails, null otherwise', async () => {
    const seedKey = keyOf('Q-Shop');
    const h = createAvatarTestHarness({
      seeds: { [seedKey]: '/assets/q-shop.webp' },
      handler: (url) => {
        if (url === '/assets/q-shop.webp') return imageResponse();
        throw new TypeError('offline');
      },
    });
    await expect(h.cache.getDataUrl('Q-Shop')).resolves.toMatch(
      /^data:image\/png;base64,/
    );
    await expect(h.cache.getDataUrl('Nobody')).resolves.toBeNull();
    await expect(h.cache.getDataUrl('')).resolves.toBeNull();
  });

  it('prewarms quietly and stops after repeated failures', async () => {
    const h = createAvatarTestHarness({
      handler: () => {
        throw new TypeError('offline');
      },
    });
    const result = await h.cache.prewarm(
      ['p1', 'p2', { name: 'P2' }, 'p3', 'p4', 'p5'],
      { limit: 10 }
    );
    expect(result).toEqual({
      fetched: 0,
      failed: 3,
      skipped: 2,
      stopped: true,
    });
    expect(h.calls).toHaveLength(3);
  });

  it('prewarm fetches what is not cached and respects the limit', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    await h.store.putEntry(
      storedMeta('cached', { fetchedAt: h.now() }),
      storedImage('cached')
    );
    const result = await h.cache.prewarm(['cached', 'a', 'b', 'c'], {
      limit: 3,
    });
    expect(result).toEqual({
      fetched: 2,
      failed: 0,
      skipped: 1,
      stopped: false,
    });
    expect(h.calls.map((call) => call.name)).toEqual(['a', 'b']);
  });

  it('refresh() fetches again at once, putImage() stores an image', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    const key = keyOf('Olga');
    h.cache.request(key, { name: 'Olga' });
    await flushAsync();
    h.cache.refresh('Olga');
    await flushAsync();
    expect(h.calls).toHaveLength(2);

    const stored = await h.cache.putImage(
      'Pete',
      new Blob([PNG_BYTES.slice()])
    );
    expect(stored).toBe(true);
    expect(h.cache.getSnapshot(keyOf('Pete')).status).toBe('ready');
    await expect(
      h.cache.putImage('Wallet', 'data:image/png;base64,iVBORw0KGgoAAAAA')
    ).resolves.toBe(true);
    expect(h.cache.getSnapshot(keyOf('wallet')).status).toBe('ready');
    await expect(
      h.cache.putImage('Pete', new Blob(['not an image']))
    ).resolves.toBe(false);
  });

  it('clear() forgets everything, in memory and in storage', async () => {
    const key = keyOf('Q-Tube');
    const h = createAvatarTestHarness({
      seeds: { [key]: '/assets/q-tube.webp' },
      handler: () => imageResponse(),
    });
    h.cache.request(key, { name: 'Q-Tube' });
    h.cache.request(keyOf('Quinn'), { name: 'Quinn' });
    await flushAsync();
    expect(h.cache.getSnapshot(key).source).toBe('cache');

    await h.cache.clear();
    expect(h.revoked.sort()).toEqual(['blob:test/1', 'blob:test/2']);
    expect(await h.store.loadAllMeta()).toEqual([]);
    expect(h.cache.debugState().metas).toEqual([]);
    expect(h.cache.getSnapshot(key)).toEqual({
      src: '/assets/q-tube.webp',
      status: 'loading',
      source: 'seed',
    });
    expect(h.cache.getSnapshot(keyOf('Quinn')).src).toBeUndefined();
  });

  it('discards fetches that finish after clear()', async () => {
    let answer: (() => void) | null = null;
    const h = createAvatarTestHarness({
      handler: () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(imageResponse());
        }),
    });
    h.cache.request(keyOf('Rae'), { name: 'Rae' });
    await flushAsync();
    await h.cache.clear();
    answer!();
    await flushAsync();
    expect(h.cache.debugState().metas).toEqual([]);
    expect(await h.store.loadAllMeta()).toEqual([]);
  });
});
