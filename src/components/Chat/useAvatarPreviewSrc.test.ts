import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAvatarPreviewSrc } from './useAvatarPreviewSrc';

type FakeLoad = {
  url: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
};
const loads: FakeLoad[] = [];

beforeEach(() => {
  loads.length = 0;
  vi.stubGlobal(
    'Image',
    class {
      url = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        this.url = value;
        loads.push(this);
      }
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAvatarPreviewSrc', () => {
  it('opens with the small image, then swaps in the full one', () => {
    const { result } = renderHook(() => useAvatarPreviewSrc());
    act(() => {
      expect(result.current.showPreview('http://node/full', 'blob:small')).toBe(
        true
      );
    });
    expect(result.current.previewSrc).toBe('blob:small');
    expect(loads.map((load) => load.url)).toEqual(['http://node/full']);
    act(() => {
      loads[0].onload?.();
    });
    expect(result.current.previewSrc).toBe('http://node/full');
  });

  it('keeps the small image when the full one fails', () => {
    const { result } = renderHook(() => useAvatarPreviewSrc());
    act(() => {
      result.current.showPreview('http://node/full', 'blob:small');
    });
    act(() => {
      loads[0].onerror?.();
    });
    expect(result.current.previewSrc).toBe('blob:small');
  });

  it('ignores a full image that loads after the preview was closed', () => {
    const { result } = renderHook(() => useAvatarPreviewSrc());
    act(() => {
      result.current.showPreview('http://node/full', 'blob:small');
    });
    act(() => {
      result.current.clearPreview();
    });
    act(() => {
      loads[0].onload?.();
    });
    expect(result.current.previewSrc).toBeNull();
  });

  it('shows the full image directly without a small one, and nothing without either', () => {
    const { result } = renderHook(() => useAvatarPreviewSrc());
    act(() => {
      result.current.showPreview('http://node/full');
    });
    expect(result.current.previewSrc).toBe('http://node/full');
    expect(loads).toHaveLength(0);
    act(() => {
      result.current.clearPreview();
    });
    let shown = true;
    act(() => {
      shown = result.current.showPreview(undefined, undefined);
    });
    expect(shown).toBe(false);
    expect(result.current.previewSrc).toBeNull();
  });
});
