import { act, renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installPageVisibilityOverride,
  reportNativeAppState,
  uninstallPageVisibilityOverrideForTests,
} from '../bridge/capacitorBridge';
import { usePageVisible } from './usePageVisible';

// Chromium's own view: the phone keep-alive holds the page visible while GO
// is in the background.
const real = { state: 'visible' as DocumentVisibilityState };

/** The read-marking pattern of ChatDirect / ChatGroup. */
function useAutoMarkRead(
  markRead: (timestamp: number) => void,
  latest: number,
  isActive = true
): void {
  const pageVisible = usePageVisible();
  useEffect(() => {
    if (!isActive || !pageVisible) return;
    markRead(latest);
  }, [isActive, latest, markRead, pageVisible]);
}

describe('usePageVisible', () => {
  beforeEach(() => {
    real.state = 'visible';
    vi.spyOn(Document.prototype, 'visibilityState', 'get').mockImplementation(
      () => real.state
    );
    (window as any).Capacitor = { isNativePlatform: () => true };
    installPageVisibilityOverride();
    act(() => reportNativeAppState(true));
  });

  afterEach(() => {
    uninstallPageVisibilityOverrideForTests();
    delete (window as any).Capacitor;
    vi.restoreAllMocks();
  });

  it('does not mark messages read while GO is off screen', () => {
    const markRead = vi.fn();
    const { rerender } = renderHook(
      ({ latest }) => useAutoMarkRead(markRead, latest),
      { initialProps: { latest: 1 } }
    );
    expect(markRead).toHaveBeenCalledWith(1);
    markRead.mockClear();

    // GO leaves the screen; keep-alive leaves Chromium's page visible.
    act(() => reportNativeAppState(false));
    expect(document.hidden).toBe(true);
    rerender({ latest: 2 });
    rerender({ latest: 3 });
    expect(markRead).not.toHaveBeenCalled();

    // Back on screen: the synthetic visibilitychange re-runs the effect.
    act(() => reportNativeAppState(true));
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith(3);
  });

  it('is always visible off native', () => {
    delete (window as any).Capacitor;
    act(() => reportNativeAppState(false));
    const { result } = renderHook(() => usePageVisible());
    expect(result.current).toBe(true);
  });
});
