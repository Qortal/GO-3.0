import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDGE_CROSSFADE_MS } from './ImmersiveEdges';
import { useImmersiveBarTheme } from './useImmersiveBarTheme';

describe('useImmersiveBarTheme', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const half = () =>
    act(() => {
      vi.advanceTimersByTime(EDGE_CROSSFADE_MS / 2);
    });

  it('draws the bar light over a light page in the dark theme, once the colour shows', () => {
    const { result, rerender } = renderHook(
      ({ color, enabled }) => useImmersiveBarTheme(color, 'dark', enabled),
      { initialProps: { color: '#ffffff' as string | null, enabled: true } }
    );
    // The white is still fading in.
    expect(result.current).toBeUndefined();
    half();
    expect(result.current?.palette.mode).toBe('light');

    // A dark page again: GO's own theme, halfway through that fade.
    rerender({ color: '#101114', enabled: true });
    expect(result.current?.palette.mode).toBe('light');
    half();
    expect(result.current).toBeUndefined();

    // Over the Tabs grid (not on the page colour): GO's own, at once.
    rerender({ color: '#ffffff', enabled: true });
    half();
    expect(result.current?.palette.mode).toBe('light');
    rerender({ color: '#ffffff', enabled: false });
    expect(result.current).toBeUndefined();
  });

  it('draws it dark over a dark page in the light theme', () => {
    const { result } = renderHook(() =>
      useImmersiveBarTheme('#0e0f14', 'light', true)
    );
    half();
    expect(result.current?.palette.mode).toBe('dark');
  });

  it('keeps GO’s own theme while the page colour is unknown', () => {
    const { result } = renderHook(() =>
      useImmersiveBarTheme(null, 'dark', true)
    );
    half();
    expect(result.current).toBeUndefined();
  });
});
