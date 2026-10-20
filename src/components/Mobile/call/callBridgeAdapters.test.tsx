import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  checkFullScreenRingAllowed,
  hasNativeCallSessionModule,
  openFullScreenRingSettings,
  parseNativeRoutes,
  useFullScreenRingAllowed,
  useNativeCallSessionAdapter,
} from './callBridgeAdapters';

describe('parseNativeRoutes', () => {
  it('reads the AudioRouting state (routes as strings)', () => {
    expect(
      parseNativeRoutes({
        ok: true,
        routes: ['speaker', 'earpiece', 'bluetooth'],
        route: 'bluetooth',
        speaker: false,
      })
    ).toEqual({
      routes: [
        { type: 'earpiece' },
        { type: 'speaker' },
        { type: 'bluetooth' },
      ],
      current: 'bluetooth',
      native: true,
    });
  });

  it('reads objects with names and aliases', () => {
    expect(
      parseNativeRoutes({
        routes: [
          { type: 'builtin_earpiece' },
          { type: 'bluetooth_sco', name: 'Buds' },
          { type: 'usb_headset' },
        ],
        current: 'wired_headset',
      })
    ).toEqual({
      routes: [
        { type: 'earpiece' },
        { type: 'bluetooth', name: 'Buds' },
        { type: 'wired' },
      ],
      current: 'wired',
      native: true,
    });
  });

  it('rejects empty answers', () => {
    expect(parseNativeRoutes(null)).toBeNull();
    expect(parseNativeRoutes({ ok: true, speaker: true })).toBeNull();
    expect(parseNativeRoutes({ routes: ['nope'] })).toBeNull();
  });
});

describe('useNativeCallSessionAdapter', () => {
  it('uses the Android call session module and is quiet off GO', () => {
    expect(hasNativeCallSessionModule).toBe(true);
    const { result } = renderHook(() =>
      useNativeCallSessionAdapter({
        callState: 'ringing',
        callId: 'c1',
        peerName: 'bob',
        peerAvatarUrl: null,
        isGroup: false,
        muted: false,
        onAccept: vi.fn(),
        onDecline: vi.fn(),
        onHangup: vi.fn(),
        onToggleMute: vi.fn(),
      })
    );
    expect(result.current.nativeRinging).toBe(false);
    expect(result.current.keyguardLocked).toBe(false);
  });
});

describe('full-screen ring permission', () => {
  it('is unknown off GO and opens nothing there', async () => {
    await expect(checkFullScreenRingAllowed()).resolves.toBeNull();
    await expect(openFullScreenRingSettings()).resolves.toBe(false);
    const { result } = renderHook(() => useFullScreenRingAllowed());
    expect(result.current).toBeNull();
  });
});
