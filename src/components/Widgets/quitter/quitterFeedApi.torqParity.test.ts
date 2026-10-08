import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://node.test',
  getBaseApiReactForAvatar: () => 'http://node.test',
}));

import {
  fetchQuitterFeedPage,
  fetchQuitterFollowedNames,
} from './quitterFeedApi';

const resource = (name: string, n: number, size = 100) => ({
  created: 1000 - n,
  identifier: `id-${n}`,
  latestSignature: `sig-${n}`,
  name,
  service: 'DOCUMENT',
  size,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Matches Torq's own feed (qapp-core lists and its follow sync). */
describe('Torq Feed reads like Torq', () => {
  it('skips deleted and oversized posts without downloading them', async () => {
    const search = [
      resource('Alice', 1),
      resource('Bob', 2, 32),
      resource('Carol', 3, 6 * 1024 * 1024),
      resource('Dan', 4),
    ];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/arbitrary/resources/search')) {
        return { ok: true, json: async () => search };
      }
      const name = decodeURIComponent(url.split('/')[5]);
      return {
        ok: true,
        text: async () =>
          JSON.stringify({ name, text: `hi from ${name}`, timestamp: 1 }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const page = await fetchQuitterFeedPage({ itemLimit: 10, searchLimit: 10 });

    expect(page.items.map((item) => item.author)).toEqual(['Alice', 'Dan']);
    const downloads = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/arbitrary/DOCUMENT/'));
    expect(downloads).toHaveLength(2);
  });

  it('reads every follow, not just the newest few, and leaves unfollows out', async () => {
    // 150 follows, plus 3 unfollowed (republished empty).
    const follows = [
      ...Array.from({ length: 150 }, (_, n) => resource('me', n, 60)),
      ...Array.from({ length: 3 }, (_, n) => resource('me', 500 + n, 32)),
    ];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/arbitrary/resources/search')) {
        expect(url).toContain('limit=0');
        return { ok: true, json: async () => follows };
      }
      // /arbitrary/resources/onchain/data: the follow bodies.
      const asked = JSON.parse(String(init?.body)) as { identifier: string }[];
      return {
        ok: true,
        json: async () =>
          asked.map(({ identifier }) => ({
            identifier,
            data: btoa(JSON.stringify({ followedName: `user-${identifier}` })),
          })),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const names = await fetchQuitterFollowedNames('me-everything');

    expect(names).toHaveLength(150);
    expect(names).toContain('user-id-149');
    expect(names).not.toContain('user-id-500');
    // Read in batches of 100.
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes('onchain'))
    ).toHaveLength(2);
  });
});
