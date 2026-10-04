import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const endpoints = vi.hoisted(() => [] as string[]);

vi.mock('../../../background/background', () => ({
  createEndpoint: vi.fn(async (endpoint: string) => {
    endpoints.push(endpoint);
    return `http://node.test${endpoint}`;
  }),
  getBaseApi: vi.fn(async () => 'http://node.test'),
}));

import { publishData } from '../publish';

// E2a: the upload POST carries the node API key, so the identifier and name a
// Q-App supplies must stay one path segment each.
describe('publishData upload path', () => {
  beforeEach(() => {
    endpoints.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { method?: string }) =>
        init?.method === 'POST'
          ? new Response('txbytes', { status: 200 })
          : new Response(JSON.stringify({ name: 'Alice' }), { status: 200 })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const publish = (identifier: string, registeredName = 'Alice Bob') =>
    publishData({
      data: 'aGVsbG8=',
      identifier,
      registeredName,
      service: 'DOCUMENT',
      uploadType: 'base64',
      withFee: false,
    });

  it('encodes a slash or dot path in the identifier as one segment', async () => {
    await publish('x/../../admin/apikey/generate');
    const upload = endpoints.find((e) => e.startsWith('/arbitrary/'));
    expect(upload).toBe(
      '/arbitrary/DOCUMENT/Alice%20Bob/x%2F..%2F..%2Fadmin%2Fapikey%2Fgenerate/base64?fee=null'
    );
  });

  it('keeps an ordinary identifier as it was', async () => {
    await publish('qblog_post_abc-1');
    expect(endpoints.find((e) => e.startsWith('/arbitrary/'))).toBe(
      '/arbitrary/DOCUMENT/Alice%20Bob/qblog_post_abc-1/base64?fee=null'
    );
  });

  it('encodes ? and # in the name', async () => {
    await publish('', 'a?b#c');
    expect(endpoints.find((e) => e.startsWith('/arbitrary/'))).toBe(
      '/arbitrary/DOCUMENT/a%3Fb%23c/base64?fee=null'
    );
  });
});
