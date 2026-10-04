import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
} from '../../lib/qdnAvatars/testHarness';
import {
  EAGER_ROW_AVATARS,
  rowAvatarPriority,
  useGroupRowAvatar,
} from './useGroupRowAvatar';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node:12391',
}));

let images: { src: string; onload: (() => void) | null }[] = [];

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
  setQdnAvatarCacheForTests(null);
  vi.unstubAllGlobals();
});

const settle = async () => {
  await act(async () => {
    await flushAsync();
  });
};

const FULL =
  'http://node:12391/arbitrary/THUMBNAIL/Owner/qortal_group_avatar_5';

describe('useGroupRowAvatar', () => {
  it('shows the cached image and previews it, then the full size', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { result } = renderHook(() => useGroupRowAvatar('Owner', 5));
    expect(result.current.isLoaded).toBe(false);
    expect(result.current.openPreview()).toBe(false);

    await settle();
    expect(result.current.src).toBe('blob:test/1');
    expect(result.current.isLoaded).toBe(true);
    expect(h.calls[0].url).toContain(
      '/arbitrary/THUMBNAIL/Owner/qortal_group_avatar_5?async=true'
    );

    let opened = false;
    act(() => {
      opened = result.current.openPreview();
    });
    expect(opened).toBe(true);
    // The cached copy at once, no empty overlay on a slow node.
    expect(result.current.previewOpen).toBe(true);
    expect(result.current.previewSrc).toBe('blob:test/1');
    const preload = images.find((image) => image.src === FULL);
    expect(preload).toBeTruthy();
    act(() => preload?.onload?.());
    expect(result.current.previewSrc).toBe(FULL);

    act(() => result.current.closePreview());
    expect(result.current.previewOpen).toBe(false);
  });

  it('turns the clickable look and the preview off when the image fails to render', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { result } = renderHook(() => useGroupRowAvatar('Owner', 5));
    await settle();
    act(() => {
      result.current.openPreview();
    });
    expect(result.current.previewOpen).toBe(true);

    act(() => result.current.imgProps.onError());
    expect(result.current.isLoaded).toBe(false);
    expect(result.current.previewOpen).toBe(false);
    expect(result.current.openPreview()).toBe(false);
  });

  it('fetches nothing without an owner name', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { result } = renderHook(() => useGroupRowAvatar(undefined, 5));
    await settle();
    expect(result.current.src).toBeUndefined();
    expect(h.calls).toHaveLength(0);
  });

  it('serves rows at the top before rows further down', async () => {
    const pending: { name: string; resolve: (r: Response) => void }[] = [];
    const h = createAvatarTestHarness({
      handler: (_url, { name }) =>
        new Promise<Response>((resolve) => pending.push({ name, resolve })),
    });
    setQdnAvatarCacheForTests(h.cache);
    const count = EAGER_ROW_AVATARS + 10;
    // Mounted in one commit, top row first, like GroupList's .map.
    renderHook(() => {
      for (let i = 0; i < count; i += 1) {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useGroupRowAvatar(`Owner${i}`, i, { priority: rowAvatarPriority(i) });
      }
    });
    await settle();
    const order: string[] = [];
    for (let guard = 0; guard < 100 && pending.length > 0; guard += 1) {
      const next = pending.shift();
      if (!next) break;
      order.push(next.name);
      next.resolve(imageResponse());
      await settle();
    }
    const index = (name: string) => order.indexOf(name);
    const lastTop = Math.max(
      ...Array.from({ length: EAGER_ROW_AVATARS }, (_, i) => index(`Owner${i}`))
    );
    const firstLower = Math.min(
      ...Array.from({ length: count - EAGER_ROW_AVATARS }, (_, i) =>
        index(`Owner${EAGER_ROW_AVATARS + i}`)
      )
    );
    expect(order).toHaveLength(count);
    expect(lastTop).toBeLessThan(firstLower);
  });
});

describe('rowAvatarPriority', () => {
  it('is normal for the first rows and low after', () => {
    expect(rowAvatarPriority(0)).toBe('normal');
    expect(rowAvatarPriority(EAGER_ROW_AVATARS - 1)).toBe('normal');
    expect(rowAvatarPriority(EAGER_ROW_AVATARS)).toBe('low');
    expect(rowAvatarPriority(3, 2)).toBe('low');
  });
});
