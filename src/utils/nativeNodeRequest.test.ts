import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  value: null as null | { apikey?: unknown; url?: unknown },
}));

vi.mock('../background/background', () => ({
  getApiKeyFromStorage: async () => storage.value,
  getBaseApi: async () =>
    storage.value && typeof storage.value.url === 'string' && storage.value.url
      ? storage.value.url
      : 'https://ext-node.qortal.link',
}));

import {
  createNativeNodeRequest,
  redactUrlQueries,
  stripUrlQuery,
} from './nativeNodeRequest';

describe('createNativeNodeRequest', () => {
  beforeEach(() => {
    storage.value = null;
  });

  it('splits the API key out of the URL for a keyed custom node', async () => {
    storage.value = { apikey: ' SECRET ', url: 'http://192.168.1.20:12391' };
    const request = await createNativeNodeRequest(
      '/arbitrary/FILE/Qortino%20AI/qshare_file_x'
    );
    expect(request).toEqual({
      apiKey: 'SECRET',
      url: 'http://192.168.1.20:12391/arbitrary/FILE/Qortino%20AI/qshare_file_x',
    });
    expect(request.url).not.toContain('SECRET');
  });

  it('keeps an existing query and still leaves the key out', async () => {
    storage.value = { apikey: 'SECRET', url: 'https://node.example' };
    const request = await createNativeNodeRequest(
      '/arbitrary/FILE/GO%203.0/x?attachment=true'
    );
    expect(request.url).toBe(
      'https://node.example/arbitrary/FILE/GO%203.0/x?attachment=true'
    );
    expect(request.apiKey).toBe('SECRET');
  });

  it('sends no key for a node without one, or the public default', async () => {
    storage.value = { apikey: '', url: 'http://127.0.0.1:12391' };
    expect(await createNativeNodeRequest('/a')).toEqual({
      url: 'http://127.0.0.1:12391/a',
    });

    storage.value = null;
    expect(await createNativeNodeRequest('/a')).toEqual({
      url: 'https://ext-node.qortal.link/a',
    });

    // A stray key with no custom node is not sent to the public node.
    storage.value = { apikey: 'SECRET', url: '' };
    expect(await createNativeNodeRequest('/a')).toEqual({
      url: 'https://ext-node.qortal.link/a',
    });
  });

  it('refuses a path the URL parser would rewrite', async () => {
    storage.value = { apikey: 'SECRET', url: 'http://127.0.0.1:12391' };
    await expect(
      createNativeNodeRequest('/arbitrary/FILE/x/..%2F..%2Fadmin')
    ).rejects.toThrow();
  });
});

describe('stripUrlQuery', () => {
  it('drops the query, fragment and user info', () => {
    expect(
      stripUrlQuery(
        'http://192.168.1.20:12391/arbitrary/FILE/Qortino%20AI/x?apiKey=SECRET'
      )
    ).toBe('http://192.168.1.20:12391/arbitrary/FILE/Qortino%20AI/x');
    expect(stripUrlQuery('https://node/a#apiKey=SECRET')).toBe(
      'https://node/a'
    );
    expect(stripUrlQuery('https://user:pass@node/a?x=1')).toBe(
      'https://node/a'
    );
    expect(stripUrlQuery('https://node/a')).toBe('https://node/a');
    expect(stripUrlQuery(undefined as unknown as string)).toBe('');
  });
});

describe('redactUrlQueries', () => {
  it('cleans URLs and loose key values inside text', () => {
    const text =
      'Failed to fetch (http://10.0.0.2:12391/arbitrary/FILE/a/b?async=true&apiKey=SECRET) apiKey=SECRET2';
    const out = redactUrlQueries(text);
    expect(out).not.toContain('SECRET');
    expect(out).toBe(
      'Failed to fetch (http://10.0.0.2:12391/arbitrary/FILE/a/b) apiKey=<redacted>'
    );
    expect(redactUrlQueries('HTTP 404')).toBe('HTTP 404');
  });
});
