import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://node.test',
  getBaseApiReactForAvatar: () => 'http://node.test',
}));

import { fetchQuitterFeedPage } from './quitterFeedApi';

const resource = (name: string, n: number) => ({
  created: 1000 - n,
  identifier: `post-${n}`,
  latestSignature: `sig-${n}`,
  name,
  service: 'DOCUMENT',
  size: 100,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchQuitterFeedPage hidden authors', () => {
  it('leaves hidden publishers out without downloading their posts', async () => {
    const search = [
      resource('Alice', 1),
      resource('Bob', 2),
      resource('Carol Dee', 3),
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

    const page = await fetchQuitterFeedPage({
      hiddenAuthors: ['@bob', 'carol  dee'],
      itemLimit: 10,
      searchLimit: 10,
    });

    expect(page.items.map((item) => item.author)).toEqual(['Alice', 'Dan']);
    const documentUrls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/arbitrary/DOCUMENT/'));
    expect(documentUrls.some((url) => url.includes('/Bob/'))).toBe(false);
    expect(documentUrls.some((url) => url.includes('Carol'))).toBe(false);
  });
});
