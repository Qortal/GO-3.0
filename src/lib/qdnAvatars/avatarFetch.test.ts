import { describe, expect, it, vi } from 'vitest';
import { fetchAvatarAttempt, fetchAvatarPublishStatus } from './avatarFetch';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const json404 = (message: string) =>
  new Response(JSON.stringify({ error: 1401, message }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });

describe('fetchAvatarAttempt', () => {
  it('accepts image bytes served as octet-stream', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(PNG, {
          headers: { 'content-type': 'application/octet-stream' },
        })
    );
    const outcome = await fetchAvatarAttempt(fetchImpl, 'http://n/a', {
      timeoutMs: 1000,
    });
    expect(outcome.kind).toBe('image');
    if (outcome.kind === 'image') {
      expect(outcome.image.type).toBe('image/png');
      expect(outcome.image.bytes.byteLength).toBe(PNG.byteLength);
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://n/a',
      expect.objectContaining({ credentials: 'omit' })
    );
  });

  it('reports "never published" from the 404 text', async () => {
    const outcome = await fetchAvatarAttempt(
      async () =>
        json404(
          "Couldn't find PUT transaction for name bob, service THUMBNAIL and identifier qortal_avatar"
        ),
      'http://n/a',
      { timeoutMs: 1000 }
    );
    expect(outcome).toEqual({ kind: 'missing' });
  });

  it('treats other 404s and empty bodies as not on the node yet', async () => {
    await expect(
      fetchAvatarAttempt(async () => json404('File not found'), 'u', {
        timeoutMs: 1000,
      })
    ).resolves.toEqual({ kind: 'unavailable', status: 404 });
    await expect(
      fetchAvatarAttempt(
        async () => json404('Data unavailable. Please try again later.'),
        'u',
        { timeoutMs: 1000 }
      )
    ).resolves.toEqual({ kind: 'unavailable', status: 404 });
    await expect(
      fetchAvatarAttempt(async () => new Response(''), 'u', {
        timeoutMs: 1000,
      })
    ).resolves.toEqual({ kind: 'unavailable', status: 200 });
  });

  it('rejects non-image bodies and large files', async () => {
    await expect(
      fetchAvatarAttempt(async () => new Response('<html></html>'), 'u', {
        timeoutMs: 1000,
      })
    ).resolves.toEqual({ kind: 'invalid' });
    await expect(
      fetchAvatarAttempt(
        async () =>
          new Response(PNG, { headers: { 'content-length': '5000000' } }),
        'u',
        { timeoutMs: 1000 }
      )
    ).resolves.toEqual({ kind: 'error', reason: 'too_large' });
    await expect(
      fetchAvatarAttempt(async () => new Response(new Uint8Array(64)), 'u', {
        timeoutMs: 1000,
        maxBytes: 32,
      })
    ).resolves.toEqual({ kind: 'error', reason: 'too_large' });
  });

  it('reports HTTP errors, network errors and timeouts', async () => {
    await expect(
      fetchAvatarAttempt(async () => new Response('x', { status: 503 }), 'u', {
        timeoutMs: 1000,
      })
    ).resolves.toEqual({ kind: 'error', reason: 'http', status: 503 });
    await expect(
      fetchAvatarAttempt(
        async () => {
          throw new TypeError('Failed to fetch');
        },
        'u',
        { timeoutMs: 1000 }
      )
    ).resolves.toEqual({ kind: 'error', reason: 'network' });

    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        );
      });
    await expect(
      fetchAvatarAttempt(hanging, 'u', { timeoutMs: 20 })
    ).resolves.toEqual({ kind: 'error', reason: 'timeout' });
  });
});

describe('fetchAvatarPublishStatus', () => {
  const statusOf = (body: unknown, status = 200) =>
    fetchAvatarPublishStatus(
      async () => new Response(JSON.stringify(body), { status }),
      'u',
      { timeoutMs: 1000 }
    );

  it('maps the node resource status', async () => {
    await expect(statusOf({ status: 'NOT_PUBLISHED' })).resolves.toBe(
      'not_published'
    );
    await expect(statusOf({ status: 'MISSING_DATA' })).resolves.toBe(
      'published'
    );
    await expect(statusOf({ status: 'READY' })).resolves.toBe('published');
  });

  it('is unknown on errors and odd answers', async () => {
    await expect(statusOf({ error: 1 }, 404)).resolves.toBe('unknown');
    await expect(statusOf({ nothing: true })).resolves.toBe('unknown');
    await expect(
      fetchAvatarPublishStatus(
        async () => {
          throw new Error('offline');
        },
        'u',
        { timeoutMs: 1000 }
      )
    ).resolves.toBe('unknown');
  });
});

describe('injected timers', () => {
  it('times out on the given timer, also when the fetch ignores the abort', async () => {
    const timers: Array<() => void> = [];
    const setTimer = vi.fn((fn: () => void) => {
      timers.push(fn);
      return timers.length;
    });
    const clearTimer = vi.fn();
    const outcome = fetchAvatarAttempt(
      () => new Promise<Response>(() => {}),
      'u',
      { timeoutMs: 6_000, setTimer, clearTimer }
    );
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 6_000);
    timers[0]();
    await expect(outcome).resolves.toEqual({
      kind: 'error',
      reason: 'timeout',
    });
    expect(clearTimer).toHaveBeenCalledWith(1);

    const status = fetchAvatarPublishStatus(
      () => new Promise<Response>(() => {}),
      'u',
      { timeoutMs: 6_000, setTimer, clearTimer }
    );
    timers[1]();
    await expect(status).resolves.toBe('unknown');
  });
});
