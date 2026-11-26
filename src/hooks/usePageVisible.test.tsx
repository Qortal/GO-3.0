import { act, renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installPageVisibilityOverride,
  reportNativeAppState,
  uninstallPageVisibilityOverrideForTests,
} from '../bridge/capacitorBridge';
import { usePageVisible } from './usePageVisible';
import {
  noteIncomingRing,
  RING_WAKE_WINDOW_MS,
  resetRingWakeAttentionForTests,
} from '../utils/ringWakeAttention';
import { isHubBeingViewed } from '../utils/reticulumDmNotifications';

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
    resetRingWakeAttentionForTests();
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

  it('does not mark read when a call woke GO and was missed, until a touch', () => {
    const markRead = vi.fn();
    // GO is off screen when the call arrives.
    act(() => reportNativeAppState(false));
    const { rerender } = renderHook(
      ({ latest }) => useAutoMarkRead(markRead, latest),
      { initialProps: { latest: 1 } }
    );
    expect(markRead).not.toHaveBeenCalled();

    // The ring wakes the screen and brings GO up; nobody is looking.
    act(() => {
      noteIncomingRing();
      reportNativeAppState(true);
    });
    rerender({ latest: 2 });
    expect(markRead).not.toHaveBeenCalled();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    expect(isHubBeingViewed()).toBe(false);

    // The user picks the phone up and touches it.
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(markRead).toHaveBeenCalledWith(2);
    expect(isHubBeingViewed()).toBe(true);
  });

  it('a ring that wakes GO marks it unattended even if the page woke first', () => {
    const markRead = vi.fn();
    act(() => reportNativeAppState(false));
    renderHook(() => useAutoMarkRead(markRead, 1));
    const wokeAt = Date.now();
    act(() => reportNativeAppState(true));
    markRead.mockClear();
    act(() => noteIncomingRing(wokeAt + RING_WAKE_WINDOW_MS - 1));
    const { result } = renderHook(() => usePageVisible());
    expect(result.current).toBe(false);
  });

  it('a call that rings while the user is already looking changes nothing', () => {
    const markRead = vi.fn();
    const { rerender } = renderHook(
      ({ latest }) => useAutoMarkRead(markRead, latest),
      { initialProps: { latest: 1 } }
    );
    markRead.mockClear();
    act(() => noteIncomingRing(Date.now() + RING_WAKE_WINDOW_MS + 1_000));
    rerender({ latest: 2 });
    expect(markRead).toHaveBeenCalledWith(2);
  });

  it('going off screen clears the unattended state', () => {
    act(() => reportNativeAppState(false));
    act(() => noteIncomingRing());
    act(() => reportNativeAppState(true));
    const { result } = renderHook(() => usePageVisible());
    expect(result.current).toBe(false);
    act(() => reportNativeAppState(false));
    // The user opens GO themselves later: seen.
    act(() => reportNativeAppState(true));
    expect(result.current).toBe(true);
  });

  it('is always visible off native', () => {
    delete (window as any).Capacitor;
    act(() => reportNativeAppState(false));
    const { result } = renderHook(() => usePageVisible());
    expect(result.current).toBe(true);
  });
});
