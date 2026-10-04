import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./globalApi', () => ({
  getBaseApiReact: () => 'http://node:12391',
}));

import { qdnAvatarKey } from '../lib/qdnAvatars';
import { setQdnAvatarCacheForTests } from '../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
  PNG_BYTES,
} from '../lib/qdnAvatars/testHarness';
import {
  getQMinterWebsiteAvatarCandidates,
  getQMinterWebsiteAvatarUrl,
} from './openQMinterWebsite';

const never = () => new Promise<Response>(() => {});

afterEach(async () => {
  // Lets the queued cache request reach this test's cache, not the real one.
  await flushAsync();
  setQdnAvatarCacheForTests(null);
});

describe('Q-Minter website icon candidates', () => {
  it('puts the icon GO ships first, before the node URLs', () => {
    setQdnAvatarCacheForTests(
      createAvatarTestHarness({
        seeds: { [qdnAvatarKey('Q-Minter')!]: '/seeds/q-minter.webp' },
        handler: never,
      }).cache
    );

    expect(getQMinterWebsiteAvatarCandidates()).toEqual([
      '/seeds/q-minter.webp',
      'http://node:12391/arbitrary/THUMBNAIL/Q-Minter/qortal_avatar?async=true',
      'http://node:12391/site/Q-Minter/favicon.ico',
      'http://node:12391/render/WEBSITE/Q-Minter/favicon.ico',
    ]);
    expect(getQMinterWebsiteAvatarUrl()).toBe('/seeds/q-minter.webp');
  });

  it('prefers the cached live icon', async () => {
    const h = createAvatarTestHarness({ handler: never });
    setQdnAvatarCacheForTests(h.cache);
    await h.cache.putImage('Q-Minter', PNG_BYTES);

    expect(getQMinterWebsiteAvatarCandidates()[0]).toBe('blob:test/1');
  });

  it('asks the cache for the icon only after the caller has rendered', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const key = qdnAvatarKey('Q-Minter')!;
    const listener = vi.fn();
    h.cache.subscribe(key, listener);

    getQMinterWebsiteAvatarCandidates();
    getQMinterWebsiteAvatarCandidates();

    // Nothing reaches subscribers while the caller is still rendering.
    expect(listener).not.toHaveBeenCalled();
    expect(h.calls).toHaveLength(0);

    await flushAsync(10);

    expect(h.calls.map((call) => call.kind)).toEqual(['async']);
    expect(getQMinterWebsiteAvatarCandidates()[0]).toMatch(/^blob:test\//);
  });

  it('falls back to the node URLs, asking only once per name', () => {
    setQdnAvatarCacheForTests(
      createAvatarTestHarness({ handler: never }).cache
    );

    const candidates = getQMinterWebsiteAvatarCandidates();
    expect(candidates[0]).toBe(
      'http://node:12391/arbitrary/THUMBNAIL/Q-Minter/qortal_avatar?async=true'
    );
    expect(candidates.filter((url) => url.includes('THUMBNAIL'))).toHaveLength(
      1
    );
  });
});
