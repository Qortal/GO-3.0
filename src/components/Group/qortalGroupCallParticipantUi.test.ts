import { createElement } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import { qdnAvatarKey } from '../../lib/qdnAvatars/keys';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
  notPublishedResponse,
} from '../../lib/qdnAvatars/testHarness';
import {
  qortalAvatarThumbnailSrc,
  useQortalAvatarThumbnailSrc,
} from './qortalGroupCallParticipantUi';

vi.mock('../../App', () => ({
  getBaseApiReactForAvatar: () => 'http://node:12391',
}));

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

const NODE_URL = (name: string) =>
  `http://node:12391/arbitrary/THUMBNAIL/${encodeURIComponent(
    name
  )}/qortal_avatar?async=true`;

describe('qortalAvatarThumbnailSrc', () => {
  it('returns undefined without a name', () => {
    expect(qortalAvatarThumbnailSrc(undefined)).toBeUndefined();
    expect(qortalAvatarThumbnailSrc('  ')).toBeUndefined();
  });

  it('shows the node image while the cache loads, then the cached copy', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    expect(qortalAvatarThumbnailSrc('Alice B')).toBe(NODE_URL('Alice B'));
    // Nothing is fetched while rendering.
    expect(h.calls).toHaveLength(0);
    await flushAsync();
    expect(h.calls).toHaveLength(1);
    // Next render: the cached copy, no new request.
    expect(qortalAvatarThumbnailSrc('Alice B')).toBe('blob:test/1');
    await flushAsync();
    expect(h.calls).toHaveLength(1);
  });

  it('gives a caller that renders once an image to load itself', async () => {
    const h = createAvatarTestHarness({
      handler: () => new Promise<Response>(() => {}),
    });
    setQdnAvatarCacheForTests(h.cache);
    // Like the incoming-call overlay: rendered once, never again.
    const Tile = ({ name }: { name: string }) =>
      createElement('img', { alt: name, src: qortalAvatarThumbnailSrc(name) });
    render(createElement(Tile, { name: 'Eve' }));
    await act(async () => {
      await flushAsync();
    });
    expect(screen.getByAltText('Eve').getAttribute('src')).toBe(
      NODE_URL('Eve')
    );
  });

  it('does not pin the object URLs it hands out', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    qortalAvatarThumbnailSrc('Frank');
    await flushAsync();
    expect(qortalAvatarThumbnailSrc('Frank')).toBe('blob:test/1');
    expect(h.cache.debugState().retainedUrls).toEqual([]);
  });

  it('does not notify other components while rendering', async () => {
    const h = createAvatarTestHarness({
      handler: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    setQdnAvatarCacheForTests(h.cache);
    qortalAvatarThumbnailSrc('Carol');
    await flushAsync();
    expect(h.cache.getSnapshot(qdnAvatarKey('Carol')).status).toBe('failed');
    // Backoff over: the next lookup turns 'failed' into 'loading'.
    await h.advance(31_000);
    h.setHandler(() => new Promise<Response>(() => {}));
    const listener = vi.fn();
    const unsubscribe = h.cache.subscribe(qdnAvatarKey('Carol'), listener);
    await flushAsync();
    listener.mockClear();

    // Called many times in one render pass: one lookup, after the render.
    qortalAvatarThumbnailSrc('Carol');
    qortalAvatarThumbnailSrc('Carol');
    expect(listener).not.toHaveBeenCalled();
    await flushAsync();
    expect(listener).toHaveBeenCalled();
    expect(h.cache.getSnapshot(qdnAvatarKey('Carol')).status).toBe('loading');
    expect(h.calls).toHaveLength(2);
    unsubscribe();
  });

  it('uses the node URL only when the cache is unavailable', () => {
    setQdnAvatarCacheForTests({
      keyFor: () => {
        throw new Error('no cache');
      },
      getSnapshot: () => {
        throw new Error('no cache');
      },
    } as never);
    expect(qortalAvatarThumbnailSrc('Alice B')).toBe(NODE_URL('Alice B'));
  });

  it('returns undefined for a name the node says has no avatar', async () => {
    const h = createAvatarTestHarness({
      handler: () => notPublishedResponse('Nobody'),
    });
    setQdnAvatarCacheForTests(h.cache);
    qortalAvatarThumbnailSrc('Nobody');
    await flushAsync();
    expect(qortalAvatarThumbnailSrc('Nobody')).toBeUndefined();
  });

  it('returns a bundled seed at once', () => {
    const h = createAvatarTestHarness({
      seeds: { [qdnAvatarKey('Q-Mail')]: '/seed/q-mail.webp' },
      handler: () => new Promise<Response>(() => {}),
    });
    setQdnAvatarCacheForTests(h.cache);
    expect(qortalAvatarThumbnailSrc('Q-Mail')).toBe('/seed/q-mail.webp');
  });
});

describe('useQortalAvatarThumbnailSrc', () => {
  it('updates when the image arrives', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { result } = renderHook(() => useQortalAvatarThumbnailSrc('Dan'));
    expect(result.current).toBeUndefined();
    await act(async () => {
      await flushAsync();
    });
    expect(result.current).toBe('blob:test/1');
  });
});
