import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isRecentlyReachableForCall,
  RECENT_CALL_ENDPOINT_MAX_AGE_MS,
  useCallReachable,
} from './recentCallEndpoint';

let lastSeen: number | null = null;

describe('recentCallEndpoint', () => {
  beforeEach(() => {
    lastSeen = null;
    (window as any).Capacitor = { isNativePlatform: () => true };
    (window as any).presence = { getCallEndpointLastSeen: () => lastSeen };
  });
  afterEach(() => {
    delete (window as any).Capacitor;
    delete (window as any).presence;
    vi.useRealTimers();
  });

  it('a friend heard within the hour can be rung on GO', () => {
    const now = 10_000_000;
    lastSeen = now - 10 * 60_000;
    expect(isRecentlyReachableForCall('Qfriend', now)).toBe(true);
    lastSeen = now - RECENT_CALL_ENDPOINT_MAX_AGE_MS - 1;
    expect(isRecentlyReachableForCall('Qfriend', now)).toBe(false);
    lastSeen = null;
    expect(isRecentlyReachableForCall('Qfriend', now)).toBe(false);
    expect(isRecentlyReachableForCall('', now)).toBe(false);
  });

  it('desktop and web keep the online-only rule', () => {
    delete (window as any).Capacitor;
    lastSeen = Date.now();
    expect(isRecentlyReachableForCall('Qfriend')).toBe(false);
  });

  it('a throwing or missing bridge means not reachable', () => {
    (window as any).presence = {
      getCallEndpointLastSeen: () => {
        throw new Error('x');
      },
    };
    expect(isRecentlyReachableForCall('Qfriend')).toBe(false);
    (window as any).presence = {};
    expect(isRecentlyReachableForCall('Qfriend')).toBe(false);
  });

  it('useCallReachable: online wins; offline but recent stays callable until it expires', () => {
    vi.useFakeTimers({ now: 50_000_000 });
    lastSeen = Date.now() - (RECENT_CALL_ENDPOINT_MAX_AGE_MS - 45_000);
    const { result, rerender } = renderHook(
      ({ online }) => useCallReachable('Qfriend', online),
      { initialProps: { online: true } }
    );
    expect(result.current).toBe(true);
    rerender({ online: false });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(false);
  });
});
