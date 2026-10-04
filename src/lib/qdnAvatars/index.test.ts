import { afterEach, describe, expect, it } from 'vitest';
import { setQdnAvatarCacheForTests } from './defaultCache';
import { getQdnAvatarSnapshot, requestQdnAvatar } from './index';
import { createAvatarTestHarness, imageResponse } from './testHarness';

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

describe('requestQdnAvatar', () => {
  it('fetches the avatar in the background at the given priority', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);

    requestQdnAvatar('Alice', { priority: 'high' });
    await h.idle();

    expect(h.calls.map((call) => call.name)).toEqual(['Alice']);
    expect(h.cache.getSnapshot(h.cache.keyFor('alice')).status).toBe('ready');
  });

  it('does nothing for an empty name and never throws', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);

    expect(() => requestQdnAvatar('  ')).not.toThrow();
    expect(() => requestQdnAvatar(null)).not.toThrow();
    await h.idle();

    expect(h.calls).toEqual([]);
  });

  it('does not keep the object URL alive like the non-React reads do', async () => {
    const h = createAvatarTestHarness({
      handler: () => imageResponse(),
      limits: { maxImages: 1 },
    });
    setQdnAvatarCacheForTests(h.cache);
    await h.cache.init();

    requestQdnAvatar('first');
    await h.idle();
    const firstUrl = h.cache.getSnapshot(h.cache.keyFor('first')).src;
    expect(firstUrl).toMatch(/^blob:test\//);

    // Two more names push 'first' out of a one-image cache.
    requestQdnAvatar('second');
    await h.idle();
    requestQdnAvatar('third');
    await h.idle();
    await h.advance(2_000); // eviction
    await h.advance(30_000); // delayed revoke

    expect(h.cache.debugState().metas.length).toBe(1);
    expect(h.revoked).toContain(firstUrl);
  });

  it('getQdnAvatarSnapshot reads without fetching', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);

    expect(getQdnAvatarSnapshot('Bob').src).toBeUndefined();
    await h.idle();

    expect(h.calls).toEqual([]);
  });
});
