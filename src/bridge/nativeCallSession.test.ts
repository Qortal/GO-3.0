import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: any) => void;

const env = vi.hoisted(() => ({ capacitor: true }));
const listeners = vi.hoisted(() => new Map<string, Listener[]>());
const calls = vi.hoisted(() => [] as Array<[string, any]>);

const makePlugin = vi.hoisted(() => (name: string) => {
  const record =
    (method: string, result: any = { ok: true }) =>
    (options?: any) => {
      calls.push([`${name}.${method}`, options]);
      return Promise.resolve(
        typeof result === 'function' ? result(options) : result
      );
    };
  return {
    addListener: (event: string, fn: Listener) => {
      const key = `${name}:${event}`;
      listeners.set(key, [...(listeners.get(key) ?? []), fn]);
      return Promise.resolve({
        remove: () => {
          listeners.set(
            key,
            (listeners.get(key) ?? []).filter((l) => l !== fn)
          );
          return Promise.resolve();
        },
      });
    },
    setCallActive: record('setCallActive', (o: any) => ({
      ok: true,
      active: !!o?.active,
      micForeground: o?.active ? true : null,
      typeFlags: o?.active ? 640 : 0,
    })),
    showIncomingCall: record('showIncomingCall'),
    cancelIncomingCall: record('cancelIncomingCall'),
    silenceRing: record('silenceRing'),
    setRingAddresses: record('setRingAddresses', { ok: true, count: 1 }),
    getPendingCallAction: record('getPendingCallAction', {}),
    clearPendingCallAction: record('clearPendingCallAction'),
    getRingState: record('getRingState', { ringing: false }),
    isDeviceLocked: record('isDeviceLocked', {
      locked: true,
      secure: true,
      interactive: true,
    }),
    requestUnlock: record('requestUnlock', { result: 'unlocked' }),
    setStrings: record('setStrings', { ok: true, kept: 1 }),
    getState: record('getState', {}),
    canUseFullScreenIntent: record('canUseFullScreenIntent', { allowed: true }),
    openFullScreenIntentSettings: record('openFullScreenIntentSettings', {
      opened: true,
    }),
    startCall: record('startCall', {
      ok: true,
      route: 'earpiece',
      routes: ['earpiece', 'speaker'],
      speaker: false,
    }),
    endCall: record('endCall', { ok: true, speaker: false }),
    getAudioRoutes: record('getAudioRoutes', {
      ok: true,
      route: 'earpiece',
      routes: ['earpiece', 'speaker'],
      speaker: false,
    }),
    setAudioRoute: record('setAudioRoute', (o: any) => ({
      ok: true,
      route: o.route,
      routes: ['earpiece', 'speaker'],
      speaker: o.route === 'speaker',
    })),
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: (name: string) => makePlugin(name),
}));

vi.mock('../utils/platform', () => ({
  isCapacitor: () => env.capacitor,
}));

import {
  nativeCallStep,
  pendingMatches,
  routeNativeAction,
  runningCallFor,
  setNativeRingAddresses,
  useNativeCallSession,
  avatarDataUrlFor,
} from './nativeCallSession';

const emit = async (key: string, event: any) => {
  await act(async () => {
    for (const fn of listeners.get(key) ?? []) fn(event);
  });
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const called = (method: string) => calls.filter(([m]) => m === method);
const lastCall = (method: string) => {
  const list = called(method);
  return list[list.length - 1];
};

describe('nativeCallStep', () => {
  it('maps DM and group states', () => {
    expect(nativeCallStep('ringing')).toEqual({ mode: 'ringing' });
    expect(nativeCallStep('calling')).toEqual({
      mode: 'active',
      phase: 'calling',
    });
    expect(nativeCallStep('connected')).toEqual({
      mode: 'active',
      phase: 'connected',
    });
    expect(nativeCallStep('joining')).toEqual({
      mode: 'active',
      phase: 'joining',
    });
    expect(nativeCallStep('ended')).toEqual({ mode: 'idle' });
    expect(nativeCallStep('idle')).toEqual({ mode: 'idle' });
    expect(nativeCallStep(undefined)).toEqual({ mode: 'idle' });
  });
});

describe('routeNativeAction', () => {
  const ringing = { mode: 'ringing' as const };
  const active = { mode: 'active' as const, phase: 'connected' as const };
  const idle = { mode: 'idle' as const };

  it('answers and declines the ringing call only', () => {
    expect(routeNativeAction('accept', 'c1', ringing, 'c1')).toBe('accept');
    expect(routeNativeAction('decline', 'c1', ringing, 'c1')).toBe('decline');
    expect(routeNativeAction('accept', 'c2', ringing, 'c1')).toBe('drop');
    // Before the page knows the call: wait for it.
    expect(routeNativeAction('accept', 'c1', idle, null)).toBe('wait');
    expect(routeNativeAction('decline', 'c1', idle, '')).toBe('wait');
    // Already answered.
    expect(routeNativeAction('accept', 'c1', active, 'c1')).toBe('drop');
  });

  it('hangs up and mutes the active call only', () => {
    expect(routeNativeAction('hangup', 'c1', active, 'c1')).toBe('hangup');
    expect(routeNativeAction('hangup', 'c2', active, 'c1')).toBe('drop');
    expect(routeNativeAction('hangup', 'c1', ringing, 'c1')).toBe('decline');
    expect(routeNativeAction('mute', 'c1', active, 'c1')).toBe('mute');
    expect(routeNativeAction('unmute', '', active, 'c1')).toBe('unmute');
    expect(routeNativeAction('mute', 'c1', idle, null)).toBe('drop');
    expect(routeNativeAction('open', 'c1', idle, null)).toBe('open');
  });

  it('reaches the call that runs while another one rings', () => {
    expect(routeNativeAction('hangup', 'g1', ringing, 'd1', 'g1')).toBe(
      'hangup'
    );
    expect(routeNativeAction('mute', 'g1', ringing, 'd1', 'g1')).toBe('mute');
    expect(routeNativeAction('hangup', 'd1', ringing, 'd1', 'g1')).toBe(
      'decline'
    );
    // Accept / decline always mean the ringing call.
    expect(routeNativeAction('accept', 'd1', ringing, 'd1', 'g1')).toBe(
      'accept'
    );
    expect(routeNativeAction('accept', 'g1', ringing, 'd1', 'g1')).toBe('drop');
    // Without an id it is the ring's (native fills in the ringing callId).
    expect(routeNativeAction('mute', '', ringing, 'd1', 'g1')).toBe('drop');
  });
});

describe('runningCallFor', () => {
  const group = { callState: 'connected', callId: 'g1', isGroup: true };
  const held = {
    phase: 'connected' as const,
    callId: 'g1',
    peerName: null,
    peerAvatarUrl: null,
    isGroup: true,
    muted: false,
  };

  it('keeps the running call while another rings', () => {
    expect(
      runningCallFor(nativeCallStep('connected'), group, undefined, null)
    ).toMatchObject({ callId: 'g1', isGroup: true, phase: 'connected' });
    const ring = { callState: 'ringing', callId: 'd1' };
    expect(
      runningCallFor(nativeCallStep('ringing'), ring, undefined, held)
    ).toBe(held);
    expect(
      runningCallFor(nativeCallStep('ringing'), ring, undefined, null)
    ).toBe(null);
    // An explicit running call wins over the held one; null = none runs.
    expect(
      runningCallFor(
        nativeCallStep('ringing'),
        ring,
        { ...group, muted: true },
        held
      )
    ).toMatchObject({ callId: 'g1', muted: true });
    expect(runningCallFor(nativeCallStep('ringing'), ring, null, held)).toBe(
      null
    );
    expect(
      runningCallFor(
        nativeCallStep('idle'),
        { callState: 'idle' },
        undefined,
        held
      )
    ).toBe(null);
  });
});

describe('pendingMatches', () => {
  it('keeps an early accept for its call for 60 s', () => {
    const pending = { action: 'accept' as const, callId: 'c1', at: 1_000 };
    expect(pendingMatches(pending, 'c1', 2_000)).toBe(true);
    expect(pendingMatches(pending, 'c2', 2_000)).toBe(false);
    expect(pendingMatches(pending, 'c1', 62_000)).toBe(false);
    expect(pendingMatches(null, 'c1', 2_000)).toBe(false);
    expect(
      pendingMatches({ action: 'mute', callId: 'c1', at: 1_000 }, 'c1', 2_000)
    ).toBe(false);
  });
});

describe('avatarDataUrlFor', () => {
  it('passes data:image URLs and refuses other schemes', async () => {
    expect(await avatarDataUrlFor('data:image/png;base64,AAAA')).toBe(
      'data:image/png;base64,AAAA'
    );
    expect(await avatarDataUrlFor('javascript:alert(1)')).toBeNull();
    expect(await avatarDataUrlFor('data:text/html;base64,AAAA')).toBeNull();
    expect(await avatarDataUrlFor(null)).toBeNull();
  });

  it('reads app-relative seed avatars from the same origin', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await avatarDataUrlFor('/seed-avatars/test-call.png');
      const requested = String(
        (fetchMock.mock.calls[0] as unknown[] | undefined)?.[0] ?? ''
      );
      expect(requested).toBe(
        new URL('/seed-avatars/test-call.png', window.location.href).toString()
      );
      expect(result).toMatch(/^data:image\/png;base64,/);
      expect(await avatarDataUrlFor('//evil.example/a.png')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('useNativeCallSession', () => {
  beforeEach(() => {
    env.capacitor = true;
    listeners.clear();
    calls.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing off GO (desktop)', async () => {
    env.capacitor = false;
    const onAccept = vi.fn();
    const { result } = renderHook(() =>
      useNativeCallSession({ callState: 'ringing', callId: 'c1', onAccept })
    );
    await flush();
    expect(calls).toEqual([]);
    expect(result.current.supported).toBe(false);
    expect(result.current.deviceLocked).toBe(false);
    await setNativeRingAddresses(['Qme']);
    expect(calls).toEqual([]);
  });

  it('rings natively, then cancels the ring when the page stops ringing', async () => {
    const { rerender } = renderHook(
      ({ state }) =>
        useNativeCallSession({
          callState: state,
          callId: 'c1',
          peerName: 'Alice',
          peerAddress: 'Qalice',
        }),
      { initialProps: { state: 'ringing' } }
    );
    await flush();
    expect(called('QortalCall.showIncomingCall')).toEqual([
      [
        'QortalCall.showIncomingCall',
        {
          callId: 'c1',
          fromAddress: 'Qalice',
          fromName: 'Alice',
          avatarDataUrl: undefined,
          kind: 'dm',
        },
      ],
    ]);
    rerender({ state: 'idle' });
    await flush();
    expect(called('QortalCall.cancelIncomingCall')).toEqual([
      [
        'QortalCall.cancelIncomingCall',
        { callId: 'c1', reason: 'page-ring-ended' },
      ],
    ]);
  });

  it('runs a call: active with audio, updates, then ends both', async () => {
    const { rerender, result } = renderHook(
      ({ state, muted }) =>
        useNativeCallSession({
          callState: state,
          callId: 'c1',
          peerName: 'Alice',
          muted,
        }),
      { initialProps: { state: 'calling', muted: false } }
    );
    await flush();
    expect(called('AudioRouting.startCall')).toEqual([
      ['AudioRouting.startCall', { owner: 'session', kind: 'dm' }],
    ]);
    expect(called('QortalCall.setCallActive')[0][1]).toMatchObject({
      active: true,
      callId: 'c1',
      kind: 'dm',
      phase: 'calling',
      peerName: 'Alice',
      muted: false,
    });
    expect(result.current.micForeground).toBe(true);
    rerender({ state: 'connected', muted: true });
    await flush();
    const last = lastCall('QortalCall.setCallActive')?.[1];
    expect(last).toMatchObject({
      active: true,
      phase: 'connected',
      muted: true,
    });
    expect(typeof last.connectedAt).toBe('number');
    // One audio session for the whole call.
    expect(called('AudioRouting.startCall')).toHaveLength(1);
    rerender({ state: 'ended', muted: true });
    await flush();
    expect(lastCall('QortalCall.setCallActive')?.[1]).toEqual({
      active: false,
      callId: 'c1',
    });
    expect(called('AudioRouting.endCall')).toEqual([
      ['AudioRouting.endCall', { owner: 'session' }],
    ]);
  });

  it('group calls start on the loudspeaker plan (kind group)', async () => {
    renderHook(() =>
      useNativeCallSession({
        callState: 'joining',
        callId: 'g1',
        isGroup: true,
      })
    );
    await flush();
    expect(called('AudioRouting.startCall')).toEqual([
      ['AudioRouting.startCall', { owner: 'session', kind: 'group' }],
    ]);
  });

  it('maps notification buttons to the callbacks', async () => {
    const onHangup = vi.fn();
    const onToggleMute = vi.fn();
    renderHook(() =>
      useNativeCallSession({
        callState: 'connected',
        callId: 'c1',
        onHangup,
        onToggleMute,
      })
    );
    await flush();
    await emit('QortalCall:callAction', { action: 'mute', callId: 'c1' });
    await emit('QortalCall:callAction', { action: 'unmute', callId: 'c1' });
    await emit('QortalCall:callAction', { action: 'hangup', callId: 'c1' });
    expect(onToggleMute.mock.calls).toEqual([
      [true, 'c1'],
      [false, 'c1'],
    ]);
    expect(onHangup).toHaveBeenCalledWith('c1');
  });

  it('handles one tap once even when it arrives twice', async () => {
    const onAccept = vi.fn();
    renderHook(() =>
      useNativeCallSession({ callState: 'ringing', callId: 'c1', onAccept })
    );
    await flush();
    const tap = { action: 'accept', callId: 'c1', at: 123 };
    await emit('QortalCall:callAction', tap);
    await emit('QortalCall:callAction', tap);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('keeps an Accept that came before the call rang in the page', async () => {
    const onAccept = vi.fn();
    const { rerender } = renderHook(
      ({ state }) =>
        useNativeCallSession({
          callState: state,
          callId: state === 'idle' ? null : 'c9',
          onAccept,
        }),
      { initialProps: { state: 'idle' } }
    );
    await flush();
    await emit('QortalCall:callAction', {
      action: 'accept',
      callId: 'c9',
      at: Date.now(),
    });
    expect(onAccept).not.toHaveBeenCalled();
    rerender({ state: 'ringing' });
    await flush();
    expect(onAccept).toHaveBeenCalledWith('c9');
  });

  it('reports the lock screen and the native ringtone', async () => {
    const { result } = renderHook(() =>
      useNativeCallSession({ callState: 'ringing', callId: 'c1' })
    );
    await flush();
    expect(result.current.deviceLocked).toBe(true);
    expect(result.current.nativeRinging).toBe(false);
    await emit('QortalCall:ringStateChanged', {
      ringing: true,
      posted: true,
      callId: 'c1',
    });
    expect(result.current.nativeRinging).toBe(true);
    await emit('QortalCall:deviceLockChanged', {
      locked: false,
      interactive: true,
    });
    expect(result.current.deviceLocked).toBe(false);
    await emit('QortalCall:ringStateChanged', { ringing: false, callId: 'c1' });
    expect(result.current.nativeRinging).toBe(false);
  });

  it('silences the native ring without declining', async () => {
    const onDecline = vi.fn();
    const { result } = renderHook(() =>
      useNativeCallSession({ callState: 'ringing', callId: 'c1', onDecline })
    );
    await flush();
    expect(result.current.keyguardLocked).toBe(true);
    act(() => result.current.silenceRinger());
    await flush();
    expect(called('QortalCall.silenceRing')).toEqual([
      ['QortalCall.silenceRing', { callId: 'c1' }],
    ]);
    expect(onDecline).not.toHaveBeenCalled();
  });

  it('switches the audio route on request', async () => {
    const { result } = renderHook(() =>
      useNativeCallSession({ callState: 'connected', callId: 'c1' })
    );
    await flush();
    await act(async () => {
      await result.current.setAudioRoute('speaker');
    });
    expect(called('AudioRouting.setAudioRoute')).toEqual([
      ['AudioRouting.setAudioRoute', { route: 'speaker' }],
    ]);
    expect(result.current.audioRoute).toBe('speaker');
  });

  describe('a 1:1 call rings during a group call (call waiting)', () => {
    type Props = {
      state: string;
      id: string | null;
      group: boolean;
      muted?: boolean;
      activeCall?: any;
    };
    const mount = (
      initialProps: Props,
      callbacks: Record<string, (...args: any[]) => void> = {}
    ) =>
      renderHook(
        ({ state, id, group, muted, activeCall }: Props) =>
          useNativeCallSession({
            callState: state,
            callId: id,
            isGroup: group,
            peerName: group ? 'Group' : 'Alice',
            muted,
            activeCall,
            ...callbacks,
          }),
        { initialProps }
      );
    const ended = () =>
      called('QortalCall.setCallActive').filter(([, o]) => !o.active);

    it('declining the ring leaves the group call alone', async () => {
      const { rerender } = mount({ state: 'connected', id: 'g1', group: true });
      await flush();
      expect(called('AudioRouting.startCall')).toHaveLength(1);
      rerender({ state: 'ringing', id: 'd1', group: false });
      await flush();
      expect(called('QortalCall.showIncomingCall')[0][1]).toMatchObject({
        callId: 'd1',
        kind: 'dm',
      });
      rerender({ state: 'connected', id: 'g1', group: true });
      await flush();
      expect(called('QortalCall.cancelIncomingCall')).toEqual([
        [
          'QortalCall.cancelIncomingCall',
          { callId: 'd1', reason: 'page-ring-ended' },
        ],
      ]);
      // No teardown of the group's native session at any point.
      expect(ended()).toEqual([]);
      expect(called('AudioRouting.endCall')).toEqual([]);
      expect(called('AudioRouting.startCall')).toHaveLength(1);
      // Every update during and after the ring was the group call.
      for (const [, o] of called('QortalCall.setCallActive')) {
        expect(o).toMatchObject({ active: true, callId: 'g1', kind: 'group' });
      }
    });

    it('answering moves the session to the 1:1 call without dropping it', async () => {
      const { rerender } = mount({ state: 'connected', id: 'g1', group: true });
      await flush();
      rerender({ state: 'ringing', id: 'd1', group: false });
      await flush();
      rerender({ state: 'connected', id: 'direct:QA:QB', group: false });
      await flush();
      expect(ended()).toEqual([]);
      expect(called('AudioRouting.endCall')).toEqual([]);
      // The 1:1 call's own default route.
      expect(called('AudioRouting.startCall')).toEqual([
        ['AudioRouting.startCall', { owner: 'session', kind: 'group' }],
        ['AudioRouting.startCall', { owner: 'session', kind: 'dm' }],
      ]);
      expect(lastCall('QortalCall.setCallActive')?.[1]).toMatchObject({
        active: true,
        callId: 'direct:QA:QB',
        kind: 'dm',
        phase: 'connected',
      });
      // Ending it ends the one session, with the call that ran last.
      rerender({ state: 'idle', id: null, group: false });
      await flush();
      expect(ended()).toEqual([
        ['QortalCall.setCallActive', { active: false, callId: 'direct:QA:QB' }],
      ]);
      expect(called('AudioRouting.endCall')).toHaveLength(1);
    });

    it('a ring that ends with nothing running ends the held call too', async () => {
      const { rerender } = mount({ state: 'connected', id: 'g1', group: true });
      await flush();
      rerender({ state: 'ringing', id: 'd1', group: false });
      await flush();
      rerender({ state: 'idle', id: null, group: false });
      await flush();
      expect(ended()).toEqual([
        ['QortalCall.setCallActive', { active: false, callId: 'g1' }],
      ]);
    });

    it('a ring with no call running starts no call session', async () => {
      const { rerender } = mount({ state: 'ringing', id: 'd1', group: false });
      await flush();
      rerender({ state: 'idle', id: null, group: false });
      await flush();
      expect(called('QortalCall.setCallActive')).toEqual([]);
      expect(called('AudioRouting.startCall')).toEqual([]);
    });

    it('the group call notification still hangs up / mutes the group call during the ring', async () => {
      const onHangup = vi.fn();
      const onDecline = vi.fn();
      const onToggleMute = vi.fn();
      const { rerender } = mount(
        { state: 'connected', id: 'g1', group: true },
        { onHangup, onDecline, onToggleMute }
      );
      await flush();
      rerender({ state: 'ringing', id: 'd1', group: false });
      await flush();
      await emit('QortalCall:callAction', { action: 'mute', callId: 'g1' });
      await emit('QortalCall:callAction', { action: 'hangup', callId: 'g1' });
      expect(onToggleMute).toHaveBeenCalledWith(true, 'g1');
      expect(onHangup).toHaveBeenCalledWith('g1');
      expect(onDecline).not.toHaveBeenCalled();
      // Hang up on the ringing call itself is still a decline.
      await emit('QortalCall:callAction', { action: 'hangup', callId: 'd1' });
      expect(onDecline).toHaveBeenCalledWith('d1');
    });

    it('follows the running call passed as activeCall during the ring', async () => {
      const { rerender } = mount({ state: 'connected', id: 'g1', group: true });
      await flush();
      rerender({
        state: 'ringing',
        id: 'd1',
        group: false,
        activeCall: {
          callState: 'connected',
          callId: 'g1',
          isGroup: true,
          peerName: 'Group',
          muted: true,
        },
      });
      await flush();
      expect(lastCall('QortalCall.setCallActive')?.[1]).toMatchObject({
        active: true,
        callId: 'g1',
        kind: 'group',
        muted: true,
      });
      expect(ended()).toEqual([]);
    });
  });

  it('hands the signed-in address to native ringing, and none once signed out', async () => {
    const { rerender, unmount } = renderHook(
      ({ address }) =>
        useNativeCallSession({ callState: 'idle', localAddress: address }),
      { initialProps: { address: 'Qme' as string | null } }
    );
    await flush();
    expect(called('QortalCall.setRingAddresses')).toEqual([
      ['QortalCall.setRingAddresses', { addresses: ['Qme'] }],
    ]);
    rerender({ address: null });
    await flush();
    expect(lastCall('QortalCall.setRingAddresses')?.[1]).toEqual({
      addresses: [],
    });
    rerender({ address: 'Qme' });
    await flush();
    unmount();
    await flush();
    expect(lastCall('QortalCall.setRingAddresses')?.[1]).toEqual({
      addresses: [],
    });
  });

  it('leaves the ring addresses alone without localAddress', async () => {
    renderHook(() => useNativeCallSession({ callState: 'idle' }));
    await flush();
    expect(called('QortalCall.setRingAddresses')).toEqual([]);
  });

  it('ends the native call when the call screen unmounts mid-call', async () => {
    const { unmount } = renderHook(() =>
      useNativeCallSession({ callState: 'connected', callId: 'c1' })
    );
    await flush();
    unmount();
    await flush();
    expect(lastCall('QortalCall.setCallActive')?.[1]).toEqual({
      active: false,
      callId: 'c1',
    });
    expect(called('AudioRouting.endCall')).toHaveLength(1);
  });
});
