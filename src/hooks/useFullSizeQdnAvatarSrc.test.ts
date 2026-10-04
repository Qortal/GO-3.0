import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/globalApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/globalApi')>()),
  getBaseApiReact: () => 'http://node.test',
}));

import {
  noteAvatarPublishedHere,
  resetAvatarPublishesForTests,
} from '../components/Group/avatarPreviewUrls';
import type { QdnAvatarSnapshot } from '../lib/qdnAvatars';
import { useFullSizeQdnAvatarSrc } from './useFullSizeQdnAvatarSrc';

type FakeLoad = { url: string; onload: (() => void) | null };
const loads: FakeLoad[] = [];
class FakeImage {
  url = '';
  decoding = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) {
    this.url = value;
    if (value) loads.push(this);
  }
}

const FULL_URL = 'http://node.test/arbitrary/THUMBNAIL/Alice/qortal_avatar';
const cached: QdnAvatarSnapshot = {
  src: 'blob:cached',
  status: 'ready',
  source: 'cache',
};
const seed: QdnAvatarSnapshot = {
  src: '/seed.webp',
  status: 'loading',
  source: 'seed',
};

beforeEach(() => {
  loads.length = 0;
  vi.stubGlobal('Image', FakeImage);
  resetAvatarPublishesForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useFullSizeQdnAvatarSrc', () => {
  it('returns the cached copy, then the full-size image once loaded', () => {
    const { result } = renderHook(() =>
      useFullSizeQdnAvatarSrc('Alice', cached)
    );
    expect(result.current).toEqual({
      src: 'blob:cached',
      isFullSize: false,
      justPublished: false,
    });
    expect(loads.map((load) => load.url)).toEqual([FULL_URL]);
    act(() => {
      loads[0].onload?.();
    });
    expect(result.current.src).toBe(FULL_URL);
    expect(result.current.isFullSize).toBe(true);
  });

  it('loads nothing without a cached node image or when disabled', () => {
    const fromSeed = renderHook(() => useFullSizeQdnAvatarSrc('Alice', seed));
    expect(fromSeed.result.current.src).toBe('/seed.webp');
    renderHook(() => useFullSizeQdnAvatarSrc('Alice', cached, false));
    renderHook(() => useFullSizeQdnAvatarSrc('', cached));
    expect(loads).toHaveLength(0);
  });

  it('keeps the cached copy right after a publish from this device', () => {
    noteAvatarPublishedHere('alice');
    const { result } = renderHook(() =>
      useFullSizeQdnAvatarSrc('Alice', cached)
    );
    expect(result.current).toEqual({
      src: 'blob:cached',
      isFullSize: false,
      justPublished: true,
    });
    expect(loads).toHaveLength(0);
  });
});
