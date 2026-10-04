/**
 * Regression tests for races and failure paths of the QDN avatar cache:
 * refresh/putImage against running fetches, storage that hangs or throws,
 * overloaded or wrong nodes, clear() with avatars on screen, fetch order,
 * object URL lifetime, queue limits and node switches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryAvatarStore,
  type QdnAvatarMeta,
  type QdnAvatarStore,
} from './avatarStore';
import { setQdnAvatarCacheForTests } from './defaultCache';
import { peekQdnAvatarSrc, getQdnAvatarSnapshot } from './index';
import { qdnAvatarKey, type QdnAvatarKey } from './keys';
import {
  API_BASE,
  createAvatarTestHarness,
  imageResponse,
  notFoundResponse,
  statusResponse,
} from './testHarness';
import type { AvatarImageBytes } from './imageBytes';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const keyOf = (name: string) => qdnAvatarKey(name)!;

// Two different "PNG" files: byte 4 tells them apart.
const OLD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 1, 1, 1, 0, 0, 0, 0]);
const NEW = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2, 2, 2, 2, 0, 0, 0, 0]);
const versionOf = (bytes: ArrayBuffer | undefined) =>
  bytes ? new Uint8Array(bytes)[4] : undefined;

const storedVersion = async (store: QdnAvatarStore, key: QdnAvatarKey) =>
  versionOf((await store.loadImages([key])).get(key)?.bytes);

const meta = (
  key: QdnAvatarKey,
  extra: Partial<QdnAvatarMeta> = {}
): QdnAvatarMeta => ({
  key,
  size: OLD.byteLength,
  fetchedAt: 0,
  lastUsedAt: 0,
  useCount: 0,
  ...extra,
});

const stored = (key: QdnAvatarKey, bytes = OLD) => ({
  key,
  bytes: bytes.slice().buffer,
  type: 'image/png',
});

/** A node whose answers the test hands out one by one. */
function controlledNode() {
  const pending: Array<(response: Response) => void> = [];
  return {
    handler: () =>
      new Promise<Response>((resolve) => {
        pending.push(resolve);
      }),
    pending,
    answer: (response: Response) => pending.shift()!(response),
  };
}

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

describe('refresh() and putImage() win over fetches already running', () => {
  it('R1: refresh() during a fetch discards its answer and asks again', async () => {
    const node = controlledNode();
    const h = createAvatarTestHarness({ handler: node.handler });
    const key = keyOf('me');
    h.cache.subscribe(key, () => {});
    h.cache.request(key, { name: 'me' });
    await h.idle();
    expect(h.calls).toHaveLength(1);

    h.cache.refresh('me'); // e.g. the avatar changed on another device
    node.answer(imageResponse(OLD)); // the fetch that started before
    await h.idle();
    expect(h.calls).toHaveLength(2);
    expect(h.cache.debugState().metas).toEqual([]);

    node.answer(imageResponse(NEW));
    await h.idle();
    expect(await storedVersion(h.store, key)).toBe(2);
    // The node may still have served the old file: checked again soon.
    const saved = h.cache.debugState().metas[0];
    expect(saved.fetchedAt).toBe(h.now() - DAY + 10 * MINUTE);
  });

  it('R1: refresh() before storage is read still fetches a fresh image', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse(NEW) });
    const key = keyOf('me');
    await h.store.putEntry(meta(key, { fetchedAt: h.now() }), stored(key));
    h.cache.refresh('me');
    await h.idle();
    expect(h.calls).toHaveLength(1);
    expect(await storedVersion(h.store, key)).toBe(2);
  });

  it('R2: putImage() is not overwritten by a fetch that started before', async () => {
    const node = controlledNode();
    const h = createAvatarTestHarness({ handler: node.handler });
    const key = keyOf('me');
    h.cache.subscribe(key, () => {});
    h.cache.request(key, { name: 'me' });
    await h.idle();

    await expect(h.cache.putImage('me', NEW.slice())).resolves.toBe(true);
    const putUrl = h.cache.getSnapshot(key).src;
    node.answer(imageResponse(OLD));
    await h.idle();

    expect(await storedVersion(h.store, key)).toBe(2);
    expect(h.cache.getSnapshot(key).src).toBe(putUrl);
    expect(h.calls).toHaveLength(1);
    // The node copy is checked again after about 10 minutes.
    expect(h.cache.debugState().metas[0].fetchedAt).toBe(
      h.now() - DAY + 10 * MINUTE
    );
  });

  it('R2: putImage() drops fetches still queued for that avatar', async () => {
    const node = controlledNode();
    const h = createAvatarTestHarness({
      handler: node.handler,
      limits: { maxConcurrent: 1 },
    });
    h.cache.request(keyOf('other'), { name: 'other' });
    h.cache.request(keyOf('me'), { name: 'me' });
    await h.idle();
    expect(h.cache.debugState().queued.map((job) => job.key)).toEqual([
      keyOf('me'),
    ]);
    await h.cache.putImage('me', NEW.slice());
    expect(h.cache.debugState().queued).toEqual([]);
    node.answer(imageResponse(OLD));
    await h.idle();
    expect(h.calls.map((call) => call.name)).toEqual(['other']);
  });

  it('R2: a fetch that starts while putImage() shrinks the image loses too', async () => {
    let release: () => void = () => {};
    const shrinking = new Promise<void>((resolve) => {
      release = resolve;
    });
    const node = controlledNode();
    const h = createAvatarTestHarness({
      handler: node.handler,
      downscale: async (image: AvatarImageBytes) => {
        if (versionOf(image.bytes) === 2) await shrinking;
        return image;
      },
    });
    const key = keyOf('me');
    const put = h.cache.putImage('me', NEW.slice());
    await h.idle();
    h.cache.request(key, { name: 'me' }); // no record yet: fetches
    await h.idle();
    expect(h.calls).toHaveLength(1);
    release();
    await expect(put).resolves.toBe(true);
    node.answer(imageResponse(OLD));
    await h.idle();
    expect(await storedVersion(h.store, key)).toBe(2);
  });

  it('R2: of two putImage() calls the later one wins, with no fetch', async () => {
    const gates = new Map<number, () => void>();
    const h = createAvatarTestHarness({
      handler: () => imageResponse(OLD),
      downscale: async (image: AvatarImageBytes) => {
        await new Promise<void>((resolve) => {
          gates.set(versionOf(image.bytes)!, resolve);
        });
        return image;
      },
    });
    const key = keyOf('me');
    h.cache.subscribe(key, () => {});
    await h.cache.init();
    const first = h.cache.putImage('me', OLD.slice());
    await h.idle();
    const second = h.cache.putImage('me', NEW.slice());
    await h.idle();
    // The earlier one finishes shrinking first: it lost, and must not ask
    // the node (the later one is about to store its image).
    gates.get(1)!();
    await expect(first).resolves.toBe(false);
    await h.idle();
    gates.get(2)!();
    await expect(second).resolves.toBe(true);
    await h.idle();
    expect(await storedVersion(h.store, key)).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});

describe('storage that hangs or fails', () => {
  it('R4: a storage open that never finishes falls back to memory', async () => {
    let lateResolve: (store: QdnAvatarStore) => void = () => {};
    const h = createAvatarTestHarness({
      openStore: () =>
        new Promise<QdnAvatarStore>((resolve) => {
          lateResolve = resolve;
        }),
      handler: () => imageResponse(),
    });
    const key = keyOf('y');
    h.cache.subscribe(key, () => {});
    h.cache.request(key, { name: 'y' });
    await h.idle();
    expect(h.calls).toHaveLength(0);

    await h.advance(3_000);
    await h.idle();
    expect(h.cache.debugState().storeKind).toBe('memory');
    expect(h.calls).toHaveLength(1);
    expect(h.cache.getSnapshot(key).status).toBe('ready');

    // The database opens after all: it is closed, not used.
    const close = vi.fn();
    lateResolve({ ...createMemoryAvatarStore(), kind: 'indexeddb', close });
    await h.idle();
    expect(close).toHaveBeenCalled();
    expect(h.cache.debugState().storeKind).toBe('memory');
  });

  it('clear() also empties a storage that was too slow at start', async () => {
    let opens = 0;
    const slowDisk = createMemoryAvatarStore();
    await slowDisk.putEntry(meta(keyOf('secret')), stored(keyOf('secret')));
    const h = createAvatarTestHarness({
      openStore: () => {
        opens += 1;
        // Hangs at start; opens (and clears) when clear() asks again.
        return opens === 1 ? new Promise(() => {}) : Promise.resolve(slowDisk);
      },
    });
    const init = h.cache.init();
    await h.idle();
    await h.advance(3_000);
    await init;
    expect(h.cache.debugState().storeKind).toBe('memory');
    await h.cache.clear();
    expect(opens).toBe(2);
    expect(await slowDisk.loadAllMeta()).toEqual([]);
  });

  it('R4: reading the records that never finishes falls back to memory', async () => {
    const close = vi.fn();
    const hanging: QdnAvatarStore = {
      ...createMemoryAvatarStore(),
      kind: 'indexeddb',
      loadAllMeta: () => new Promise(() => {}),
      close,
    };
    const h = createAvatarTestHarness({
      openStore: async () => hanging,
      handler: () => imageResponse(),
    });
    h.cache.request(keyOf('y'), { name: 'y' });
    await h.idle();
    await h.advance(3_000);
    await h.idle();
    expect(close).toHaveBeenCalled();
    expect(h.cache.debugState().storeKind).toBe('memory');
    expect(h.cache.getSnapshot(keyOf('y')).status).toBe('ready');
  });

  const flakyStore = () => {
    const base = createMemoryAvatarStore();
    const state = { broken: true, loads: 0 };
    const store: QdnAvatarStore = {
      ...base,
      kind: 'indexeddb',
      loadAllMeta: () => base.loadAllMeta(),
      loadImages: async (keys) => {
        state.loads += 1;
        if (state.broken) throw new Error('IDB busy');
        return base.loadImages(keys);
      },
    };
    return { base, store, state };
  };

  it('R8: a failed read of stored bytes keeps the record and reads again', async () => {
    const { base, store, state } = flakyStore();
    const key = keyOf('u');
    const h = createAvatarTestHarness({
      store,
      handler: () => notFoundResponse(),
    });
    await base.putEntry(meta(key, { fetchedAt: h.now() }), stored(key));
    h.cache.subscribe(key, () => {});
    h.cache.request(key, { name: 'u' });
    await h.idle();
    expect(h.calls).toHaveLength(0);
    expect(h.cache.debugState().metas[0].size).toBe(OLD.byteLength);

    state.broken = false;
    await h.advance(5_000);
    await h.idle();
    expect(h.cache.getSnapshot(key).status).toBe('ready');
    expect(h.calls).toHaveLength(0);
  });

  it('R8: storage that keeps failing shows the node copy, never deletes the bytes', async () => {
    const { base, store } = flakyStore();
    const key = keyOf('u');
    const h = createAvatarTestHarness({
      store,
      handler: (_url, { kind }) =>
        kind === 'status'
          ? statusResponse('NOT_PUBLISHED')
          : notFoundResponse('File not found'),
    });
    await base.putEntry(meta(key, { fetchedAt: h.now() }), stored(key));
    h.cache.subscribe(key, () => {});
    h.cache.request(key, { name: 'u' });
    await h.idle();
    await h.advance(5_000);
    await h.idle();
    expect(h.calls).toHaveLength(0);
    await h.advance(10_000);
    await h.idle();
    // Third failed read: ask the node (an unsynced one says "missing").
    expect(h.kinds()).toEqual(['async', 'status']);
    await h.advance(5_000);
    expect(await storedVersion(base, key)).toBe(1);
    const kept = (await base.loadAllMeta())[0];
    expect(kept.size).toBe(OLD.byteLength);
    expect(kept.missing).toBeFalsy();
  });
});

describe('answers that are not about the avatar', () => {
  it.each([503, 500, 429])(
    'R6: HTTP %s on the quick request only backs off',
    async (status) => {
      const h = createAvatarTestHarness({
        handler: () => new Response('busy', { status }),
      });
      const key = keyOf('w');
      h.cache.request(key, { name: 'w' });
      await h.idle();
      expect(h.kinds()).toEqual(['async']);
      expect(h.cache.getSnapshot(key).status).toBe('failed');
    }
  );

  it('R7: a 200 that is not an image (captive portal) is a failure, not "missing"', async () => {
    const h = createAvatarTestHarness({
      handler: () => new Response('<html>login</html>', { status: 200 }),
    });
    const key = keyOf('v');
    h.cache.request(key, { name: 'v' });
    await h.idle();
    expect(h.kinds()).toEqual(['async']);
    expect(h.cache.getSnapshot(key).status).toBe('failed');
    await h.advance(5_000);
    expect(await h.store.loadAllMeta()).toEqual([]);
    // Backoff, then asked again.
    await h.advance(30_000);
    h.cache.request(key, { name: 'v' });
    await h.idle();
    expect(h.calls).toHaveLength(2);
  });

  it('R7: a non-image after the blocking request is a failure too', async () => {
    const h = createAvatarTestHarness({
      handler: (_url, { kind }) => {
        if (kind === 'async') return notFoundResponse();
        if (kind === 'status') return statusResponse('MISSING_DATA');
        return new Response('<html>login</html>', { status: 200 });
      },
    });
    const key = keyOf('v');
    h.cache.request(key, { name: 'v' });
    await h.idle();
    expect(h.kinds()).toEqual(['async', 'status', 'blocking']);
    expect(h.cache.getSnapshot(key).status).toBe('failed');
  });

  it('an image the browser cannot decode is "missing" in memory only', async () => {
    const h = createAvatarTestHarness({
      handler: () => imageResponse(),
      downscale: async () => null,
    });
    const key = keyOf('Broken');
    h.cache.request(key, { name: 'Broken' });
    await h.idle();
    expect(h.cache.getSnapshot(key).status).toBe('missing');
    h.cache.noteUse(key);
    await h.advance(10_000);
    expect(await h.store.loadAllMeta()).toEqual([]);
    // Not asked again during this session.
    h.cache.request(key, { name: 'Broken' });
    await h.idle();
    expect(h.calls).toHaveLength(1);
  });
});

describe('node switches', () => {
  it('a "missing" answer from one node is checked again on another', async () => {
    const h = createAvatarTestHarness({
      handler: (_url, { kind }) =>
        kind === 'status'
          ? statusResponse('NOT_PUBLISHED')
          : notFoundResponse(),
    });
    const key = keyOf('Carol');
    h.cache.request(key, { name: 'Carol' });
    await h.idle();
    expect(h.cache.getSnapshot(key).status).toBe('missing');
    const record = (await h.store.loadAllMeta())[0];
    expect(record.missingNode).toBeTruthy();
    expect(JSON.stringify(record)).not.toContain('node:12391');

    h.cache.request(key, { name: 'Carol' });
    await h.idle();
    expect(h.calls).toHaveLength(2);

    h.setApiBase('http://other-node:12391');
    h.setHandler(() => imageResponse());
    h.cache.request(key, { name: 'Carol' });
    await h.idle();
    expect(h.calls[2].url).toContain('other-node');
    expect(h.cache.getSnapshot(key).status).toBe('ready');
  });

  it('forgets backoff from the old node', async () => {
    const h = createAvatarTestHarness({
      handler: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const key = keyOf('Erin');
    h.cache.request(key, { name: 'Erin' });
    await h.idle();
    h.cache.request(key, { name: 'Erin' });
    await h.idle();
    expect(h.calls).toHaveLength(1);

    h.setApiBase(`${API_BASE}0`);
    h.cache.request(key, { name: 'Erin' });
    await h.idle();
    expect(h.calls).toHaveLength(2);
  });
});

describe('clear(), order and limits', () => {
  it('R3: clear() asks again for avatars still on screen', async () => {
    let first = true;
    const h = createAvatarTestHarness({
      handler: () => {
        if (first) {
          first = false;
          return new Promise<Response>(() => {});
        }
        return imageResponse();
      },
    });
    const key = keyOf('x');
    h.cache.subscribe(key, () => {});
    h.cache.request(key, { name: 'x' });
    await h.idle();
    await h.cache.clear();
    await h.idle();
    expect(h.calls).toHaveLength(2);
    expect(h.cache.getSnapshot(key).status).toBe('ready');
  });

  it('clear() does not wait forever for a storage that hangs', async () => {
    const h = createAvatarTestHarness({
      store: {
        ...createMemoryAvatarStore(),
        clear: () => new Promise<void>(() => {}),
      },
    });
    await h.cache.init();
    let done = false;
    const clearing = h.cache.clear().then(() => {
      done = true;
    });
    await h.idle();
    expect(done).toBe(false);
    await h.advance(3_000);
    await clearing;
    expect(done).toBe(true);
  });

  it('R9: avatars on screen are fetched in the order they were asked for', async () => {
    const node = controlledNode();
    const h = createAvatarTestHarness({ handler: node.handler });
    const names = ['top', 'r2', 'r3', 'r4', 'r5', 'r6', 'bottom'];
    for (const name of names) h.cache.subscribe(keyOf(name), () => {});
    for (const name of names) h.cache.request(keyOf(name), { name });
    await h.idle();
    while (node.pending.length) {
      node.answer(imageResponse());
      await h.idle();
    }
    expect(h.calls.map((call) => call.name)).toEqual(names);
  });

  it('R9: rows that come on screen later go first, each batch top to bottom', async () => {
    const node = controlledNode();
    const h = createAvatarTestHarness({
      handler: node.handler,
      limits: { maxConcurrent: 1 },
    });
    await h.cache.init();
    const show = (names: string[]) => {
      for (const name of names) h.cache.subscribe(keyOf(name), () => {});
      for (const name of names) h.cache.request(keyOf(name), { name });
    };
    show(['busy', 'a1', 'a2']); // first render
    await h.idle();
    show(['b1', 'b2']); // scrolled: two more rows
    await h.idle();
    while (node.pending.length) {
      node.answer(imageResponse());
      await h.idle();
    }
    expect(h.calls.map((call) => call.name)).toEqual([
      'busy',
      'b1',
      'b2',
      'a1',
      'a2',
    ]);
  });

  it('R9: on-screen avatars go before off-screen ones of the same priority', async () => {
    const node = controlledNode();
    const h = createAvatarTestHarness({
      handler: node.handler,
      limits: { maxConcurrent: 1 },
    });
    await h.cache.init();
    h.cache.request(keyOf('busy'), { name: 'busy' });
    h.cache.request(keyOf('off1'), { name: 'off1', priority: 'high' });
    h.cache.request(keyOf('off2'), { name: 'off2', priority: 'high' });
    h.cache.subscribe(keyOf('on'), () => {});
    h.cache.request(keyOf('on'), { name: 'on', priority: 'normal' });
    await h.idle();
    while (node.pending.length) {
      node.answer(imageResponse());
      await h.idle();
    }
    // Unwatched high work drops to normal; watched first, then newest first.
    expect(h.calls.map((call) => call.name)).toEqual([
      'busy',
      'on',
      'off2',
      'off1',
    ]);
  });

  it('keeps at most maxQueue jobs, dropping the oldest nobody shows', async () => {
    const h = createAvatarTestHarness({
      handler: () => new Promise<Response>(() => {}),
      limits: { maxConcurrent: 1, maxQueue: 3 },
    });
    await h.cache.init();
    h.cache.subscribe(keyOf('shown'), () => {});
    h.cache.request(keyOf('running'), { name: 'running' });
    h.cache.request(keyOf('shown'), { name: 'shown' });
    for (const name of ['a', 'b', 'c', 'd']) {
      h.cache.request(keyOf(name), { name });
    }
    const queued = h.cache.debugState().queued.map((job) => job.key);
    expect(queued).toHaveLength(3);
    expect(queued).toContain(keyOf('shown'));
    expect(queued).toContain(keyOf('d'));
    expect(queued).not.toContain(keyOf('a'));
  });

  it('stops retrying when the avatar leaves the screen', async () => {
    const h = createAvatarTestHarness({
      handler: () => {
        throw new TypeError('offline');
      },
    });
    const key = keyOf('gone');
    const unsubscribe = h.cache.subscribe(key, () => {});
    h.cache.request(key, { name: 'gone' });
    await h.idle();
    expect(h.calls).toHaveLength(1);
    unsubscribe();
    await h.advance(HOUR);
    expect(h.calls).toHaveLength(1);
  });

  it('a failed refresh of a shown image waits an hour, without the retry ladder', async () => {
    const h = createAvatarTestHarness({
      handler: () => {
        throw new TypeError('offline');
      },
    });
    const key = keyOf('Hank');
    await h.store.putEntry(meta(key, { fetchedAt: h.now() - 25 * HOUR }), {
      ...stored(key),
    });
    h.cache.subscribe(key, () => {});
    h.cache.request(key, { name: 'Hank' });
    await h.idle();
    expect(h.calls).toHaveLength(1);
    expect(h.cache.getSnapshot(key).status).toBe('ready');

    await h.advance(30_000);
    await h.advance(2 * MINUTE);
    await h.advance(10 * MINUTE);
    h.cache.request(key, { name: 'Hank' });
    await h.idle();
    expect(h.calls).toHaveLength(1);

    await h.advance(HOUR);
    h.cache.request(key, { name: 'Hank' });
    await h.idle();
    expect(h.calls).toHaveLength(2);
  });

  it('getDataUrl waits across the hand-off to the blocking request', async () => {
    let answerBlocking: () => void = () => {};
    const h = createAvatarTestHarness({
      handler: (_url, { kind }) => {
        if (kind === 'async') return notFoundResponse();
        if (kind === 'status') return statusResponse('MISSING_DATA');
        return new Promise<Response>((resolve) => {
          answerBlocking = () => resolve(imageResponse());
        });
      },
    });
    let result: string | null | undefined;
    const pending = h.cache.getDataUrl('Slow', { timeoutMs: 60_000 });
    void pending.then((value) => {
      result = value;
    });
    await h.idle();
    expect(h.kinds()).toEqual(['async', 'status', 'blocking']);
    expect(result).toBeUndefined();
    answerBlocking();
    await expect(pending).resolves.toMatch(/^data:image\/png;base64,/);
  });
});

describe('object URL lifetime', () => {
  it('R5: a URL handed to non-React code lives until clear()', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse(NEW) });
    setQdnAvatarCacheForTests(h.cache);
    const key = keyOf('z');
    await h.store.putEntry(
      meta(key, { fetchedAt: h.now() - 25 * HOUR }),
      stored(key)
    );
    await h.cache.init();
    const peeked = peekQdnAvatarSrc('z'); // queues the stale refresh
    expect(peeked).toBe('blob:test/1');
    await h.idle();
    expect(getQdnAvatarSnapshot('z').src).toBe('blob:test/2');

    await h.advance(60_000);
    expect(h.revoked).not.toContain('blob:test/1');

    await h.cache.clear();
    expect(h.revoked).toContain('blob:test/1');
    expect(h.revoked).toContain('blob:test/2');
  });

  it('revokes the URL of an evicted image (unless it was handed out)', async () => {
    const h = createAvatarTestHarness({
      handler: () => imageResponse(),
      limits: { maxImages: 1 },
    });
    await h.cache.init();
    h.cache.request(keyOf('first'), { name: 'first' });
    await h.idle();
    h.cache.retainUrl(h.cache.getSnapshot(keyOf('first')).src);
    h.cache.request(keyOf('second'), { name: 'second' });
    await h.idle();
    h.cache.request(keyOf('third'), { name: 'third' });
    await h.idle();
    await h.advance(2_000); // eviction
    await h.advance(30_000); // delayed revoke
    const left = h.cache.debugState().metas.length;
    expect(left).toBe(1);
    expect(h.revoked).toContain('blob:test/2');
    expect(h.revoked).not.toContain('blob:test/1');
  });

  it('loads the most used stored images together with the records', async () => {
    const h = createAvatarTestHarness();
    const key = keyOf('fav');
    await h.store.putEntry(
      meta(key, { fetchedAt: h.now(), useCount: 50, lastUsedAt: h.now() }),
      stored(key)
    );
    await h.cache.init();
    // No request yet, already in memory: shows on the first render.
    expect(h.cache.getSnapshot(key).src).toBe('blob:test/1');
    expect(h.calls).toHaveLength(0);
  });
});
