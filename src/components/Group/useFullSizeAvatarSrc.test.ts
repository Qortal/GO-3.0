import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  noteAvatarPublishedHere,
  PUBLISHED_AVATAR_SETTLE_MS,
  resetAvatarPublishesForTests,
} from './avatarPreviewUrls';
import {
  FULL_SIZE_AVATAR_TIMEOUT_MS,
  useFullSizeAvatarSrc,
} from './useFullSizeAvatarSrc';

type FakeImage = {
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
};

let images: FakeImage[] = [];

beforeEach(() => {
  images = [];
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decoding = 'auto';
      src = '';
      constructor() {
        images.push(this);
      }
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetAvatarPublishesForTests();
});

const FULL =
  'http://node:12391/arbitrary/THUMBNAIL/Owner/qortal_group_avatar_5';

describe('useFullSizeAvatarSrc', () => {
  it('shows the cached copy until the full-size image has loaded', () => {
    const { result } = renderHook(() =>
      useFullSizeAvatarSrc('blob:cached', FULL)
    );
    expect(result.current).toBe('blob:cached');
    expect(images).toHaveLength(1);
    expect(images[0].src).toBe(FULL);
    act(() => images[0].onload?.());
    expect(result.current).toBe(FULL);
  });

  it('keeps the cached copy when the node fails', () => {
    const { result } = renderHook(() =>
      useFullSizeAvatarSrc('blob:cached', FULL)
    );
    act(() => images[0].onerror?.());
    expect(result.current).toBe('blob:cached');
  });

  it('loads nothing without a cached image or while disabled', () => {
    const none = renderHook(() => useFullSizeAvatarSrc(undefined, FULL));
    expect(none.result.current).toBeUndefined();
    const disabled = renderHook(() =>
      useFullSizeAvatarSrc('blob:cached', FULL, false)
    );
    expect(disabled.result.current).toBe('blob:cached');
    expect(images).toHaveLength(0);
  });

  it('ignores a load that finishes after the URL changed', () => {
    const { result, rerender } = renderHook(
      ({ url }) => useFullSizeAvatarSrc('blob:cached', url),
      { initialProps: { url: FULL } }
    );
    const first = images[0];
    rerender({ url: `${FULL}-new` });
    act(() => first.onload?.());
    expect(result.current).toBe('blob:cached');
    act(() => images[1].onload?.());
    expect(result.current).toBe(`${FULL}-new`);
  });

  it('drops the full-size image when the cached copy changes', () => {
    const { result, rerender } = renderHook(
      ({ cached }) => useFullSizeAvatarSrc(cached, FULL),
      { initialProps: { cached: 'blob:old' } }
    );
    act(() => images[0].onload?.());
    expect(result.current).toBe(FULL);

    // A new avatar arrived in the cache (put after a publish, or a refresh):
    // the node URL is the same, so the old full-size file must not stay.
    rerender({ cached: 'blob:new' });
    expect(result.current).toBe('blob:new');
    expect(images).toHaveLength(2);
    // Loaded again past the WebView's HTTP cache.
    expect(images[1].src).toBe(`${FULL}?v=r1`);
    act(() => images[1].onload?.());
    expect(result.current).toBe(`${FULL}?v=r1`);
  });

  it('keeps the cached copy right after the avatar was published here', () => {
    noteAvatarPublishedHere('owner', 'qortal_group_avatar_5', Date.now());
    const { result } = renderHook(() =>
      useFullSizeAvatarSrc('blob:just-published', FULL)
    );
    expect(result.current).toBe('blob:just-published');
    expect(images).toHaveLength(0);
  });

  it('loads past the HTTP cache once a publish from here has settled', () => {
    const publishedAt = Date.now() - PUBLISHED_AVATAR_SETTLE_MS - 1;
    noteAvatarPublishedHere('Owner', 'qortal_group_avatar_5', publishedAt);
    renderHook(() => useFullSizeAvatarSrc('blob:cached', FULL));
    expect(images[0].src).toBe(`${FULL}?v=${publishedAt}`);
  });

  it('cancels the download when no longer needed', () => {
    const { rerender, unmount } = renderHook(
      ({ enabled }) => useFullSizeAvatarSrc('blob:cached', FULL, enabled),
      { initialProps: { enabled: true } }
    );
    rerender({ enabled: false });
    expect(images[0].src).toBe('');
    expect(images[0].onload).toBeNull();
    rerender({ enabled: true });
    unmount();
    expect(images[1].src).toBe('');
  });

  it('gives up on a node that does not answer', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useFullSizeAvatarSrc('blob:cached', FULL)
    );
    act(() => {
      vi.advanceTimersByTime(FULL_SIZE_AVATAR_TIMEOUT_MS);
    });
    expect(images[0].src).toBe('');
    expect(images[0].onload).toBeNull();
    expect(result.current).toBe('blob:cached');
    expect(images).toHaveLength(1);
  });
});
