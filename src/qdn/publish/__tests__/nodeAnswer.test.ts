import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../background/background', () => ({
  createEndpoint: vi.fn(
    async (endpoint: string) => `http://node.test${endpoint}`
  ),
  getBaseApi: vi.fn(async () => 'http://node.test'),
}));

import '../../../i18n/i18n';
import { isNodeApiKeyRequiredError } from '../nodeAnswer';
import { publishData } from '../publish';
import type { PublishProgress } from '../publishProgress';

const KEY_MESSAGE =
  'Your node needs its API key to publish. Add it in node settings.';

// What Core answers a call that needs the key, from outside loopback.
const keyMissing = () =>
  new Response(`{"error":4,"message":"Missing 'X-API-KEY' header"}`, {
    status: 401,
  });
const keyInvalid = () =>
  new Response('{"error":4,"message":"API key invalid"}', { status: 403 });
const ok = (body = 'txbytes') => new Response(body, { status: 200 });

type Answer = (path: string, method: string) => Response | Promise<Response>;

/** The node answers by path; the name lookup (GET /names/…) always works. */
function stubNode(answer: Answer) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const { pathname } = new URL(url);
    if (pathname.startsWith('/names/')) {
      return new Response(JSON.stringify({ name: 'Alice' }), { status: 200 });
    }
    return answer(pathname, init?.method ?? 'GET');
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const postedPaths = (fetchMock: ReturnType<typeof stubNode>) =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([url]) => new URL(url).pathname);

/** A small Q-App publish sent in one piece, e.g. a Q-Mintership+ vote. */
const publishVote = (seen: PublishProgress[]) =>
  publishData({
    data: 'aGVsbG8=',
    identifier: 'vote-1',
    registeredName: 'Alice',
    service: 'DOCUMENT_PRIVATE',
    uploadType: 'base64',
    withFee: false,
    onProgress: (progress: PublishProgress) => seen.push(progress),
  });

/** A file sent in parts (here one part). */
const publishFile = (seen: PublishProgress[]) =>
  publishData({
    data: new File([new Uint8Array(10)], 'clip.mp4'),
    identifier: 'video-1',
    registeredName: 'Alice',
    service: 'VIDEO',
    uploadType: 'file',
    withFee: false,
    onProgress: (progress: PublishProgress) => seen.push(progress),
  });

const retries = (seen: PublishProgress[]) =>
  seen.filter((progress) => progress.stage === 'retrying').length;

describe('publishData and the node’s answers', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('a node that needs its API key', () => {
    it.each([
      ['401 Missing X-API-KEY header', keyMissing],
      ['403 API key invalid', keyInvalid],
    ])('fails at once on %s, with the key message', async (_label, refuse) => {
      const fetchMock = stubNode(() => refuse());
      const seen: PublishProgress[] = [];

      const error = await publishVote(seen).catch((e) => e);

      expect(isNodeApiKeyRequiredError(error)).toBe(true);
      expect(error.message).toBe(KEY_MESSAGE);
      // Asked once, not three times 25 s apart.
      expect(postedPaths(fetchMock)).toEqual([
        '/arbitrary/DOCUMENT_PRIVATE/Alice/vote-1/base64',
      ]);
      // A refusal is not "your node did not answer".
      expect(retries(seen)).toBe(0);
    });

    it('says so when the space check is refused, not "not enough space"', async () => {
      const fetchMock = stubNode((path) =>
        path === '/arbitrary/check/tmp' ? keyMissing() : ok()
      );

      const error = await publishFile([]).catch((e) => e);

      expect(isNodeApiKeyRequiredError(error)).toBe(true);
      expect(error.message).toBe(KEY_MESSAGE);
      expect(postedPaths(fetchMock)).toEqual([]);
    });

    it('stops at the first refused part', async () => {
      const fetchMock = stubNode((path) =>
        path.endsWith('/chunk') ? keyInvalid() : ok()
      );
      const seen: PublishProgress[] = [];

      const error = await publishFile(seen).catch((e) => e);

      expect(isNodeApiKeyRequiredError(error)).toBe(true);
      expect(postedPaths(fetchMock)).toEqual([
        '/arbitrary/VIDEO/Alice/video-1/chunk',
      ]);
      expect(retries(seen)).toBe(0);
    });

    it('says so when the finalize is refused', async () => {
      stubNode((path) => (path.endsWith('/finalize') ? keyMissing() : ok()));

      const error = await publishFile([]).catch((e) => e);

      expect(isNodeApiKeyRequiredError(error)).toBe(true);
      expect(error.message).toBe(KEY_MESSAGE);
    });
  });

  describe('a node that does not answer', () => {
    it.each([
      [
        'a 502 from the proxy in front of it',
        () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
      ],
      [
        'a network error',
        () => Promise.reject(new TypeError('Failed to fetch')),
      ],
    ])('is asked again after %s, with the retry hint', async (_label, fail) => {
      vi.useFakeTimers();
      let uploads = 0;
      const fetchMock = stubNode((path) => {
        if (!path.endsWith('/base64')) return ok();
        uploads += 1;
        return uploads === 1 ? fail() : ok();
      });
      const seen: PublishProgress[] = [];

      const pending = publishVote(seen);
      await vi.advanceTimersByTimeAsync(25_000);

      await expect(pending).resolves.toBeUndefined();
      expect(retries(seen)).toBe(1);
      expect(postedPaths(fetchMock)).toHaveLength(2);
      expect(seen[seen.length - 1]).toEqual({ stage: 'published' });
    });

    it('is asked again for a part that got no answer', async () => {
      vi.useFakeTimers();
      let chunks = 0;
      stubNode((path) => {
        if (!path.endsWith('/chunk')) return ok();
        chunks += 1;
        return chunks === 1
          ? new Response('Service Unavailable', { status: 503 })
          : ok();
      });
      const seen: PublishProgress[] = [];

      const pending = publishFile(seen);
      await vi.advanceTimersByTimeAsync(25_000);

      await expect(pending).resolves.toBeUndefined();
      expect(chunks).toBe(2);
      expect(retries(seen)).toBe(1);
    });
  });

  it('fails at once on another refusal, with Core’s own words', async () => {
    const coreSays = '{"error":102,"message":"invalid data"}';
    const fetchMock = stubNode(() => new Response(coreSays, { status: 400 }));
    const seen: PublishProgress[] = [];

    const error = await publishVote(seen).catch((e) => e);

    expect(isNodeApiKeyRequiredError(error)).toBe(false);
    expect(error.message).toBe(coreSays);
    expect(postedPaths(fetchMock)).toHaveLength(1);
    expect(retries(seen)).toBe(0);
  });
});
