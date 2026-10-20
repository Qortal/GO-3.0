/**
 * GO-only: how long a DM call keeps advertising native WebRTC audio while
 * the peer has not acknowledged it. On a slow mobile uplink every early
 * capability bundle could reach the Hub after its 20 s signal TTL, and the
 * Hub only starts its WebRTC answerer after one capability it accepts, so GO
 * keeps advertising for about 2 minutes. Desktop keeps its 7 attempts.
 */
import { createHash } from 'node:crypto';
import React from 'react';
import { Provider, createStore } from 'jotai';
import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userInfoAtom } from '../atoms/global';
import { buildDirectVoiceCallChatId } from '../lib/call/directVoiceCallChatId';
import { buildDmVoiceRoomId } from '../lib/call/directVoiceReticulumMedia';
import {
  directVoiceCapabilityRetryDelaysMs,
  useVoiceCall,
} from './useVoiceCall';

const platform = vi.hoisted(() => ({ go: false }));
vi.mock('../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/platform')>()),
  isCapacitor: () => platform.go,
}));
vi.mock('../encryption/addressKeyCheck', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../encryption/addressKeyCheck')>()),
  publicKeyBelongsToAddress: () => true,
}));

const goodReadiness = () => ({
  status: 'good',
  reasons: [],
  cpuLoad: 0.1,
  memoryPressure: 'normal',
  eventLoopLagMs: 0,
});

type RtcSignalInput = {
  signalType: string;
  payload: string;
  roomId?: string;
  callSessionId?: string;
};

async function connectedCallThatIsNeverAcked() {
  let callEventHandler:
    | ((event: string, payload: unknown) => void | Promise<void>)
    | null = null;
  let groupCallEventHandler:
    | ((event: string, payload: unknown) => void | Promise<void>)
    | null = null;
  const sendRtcSignal = vi.fn(async (_input: RtcSignalInput) => ({
    success: true,
  }));
  const callApi = {
    onEvent: vi.fn(
      (cb: (event: string, payload: unknown) => void | Promise<void>) => {
        callEventHandler = cb;
        return vi.fn();
      }
    ),
    setLocalAddresses: vi.fn(async () => ({ success: true })),
    initiate: vi.fn(async () => ({ success: true })),
    hangup: vi.fn(async () => ({ success: true })),
    sendRtcSignal,
  };
  Object.assign(window as any, {
    call: callApi,
    groupCall: {
      onEvent: vi.fn(
        (cb: (event: string, payload: unknown) => void | Promise<void>) => {
          groupCallEventHandler = cb;
          return vi.fn();
        }
      ),
      join: vi.fn(async () => ({
        success: true,
        callSessionId: 'dm-media-session',
        mediaSessionGeneration: 1,
      })),
      leave: vi.fn(async () => ({ success: true })),
      sendRtcSignal,
      setLocalAddresses: vi.fn(async () => {}),
      requestPeerMediaRecovery: vi.fn(async () => ({ success: true })),
      // DM media is ready (Reticulum audio up), only WebRTC is unacked.
      getRoomParticipants: vi.fn(async () => [
        { address: 'Qme' },
        { address: 'Qpeer' },
      ]),
      getLinkStats: vi.fn(async () => ({
        success: true,
        stats: { establishedLinks: 1, participants: 2 },
      })),
      sendKey: vi.fn(async () => ({ success: true })),
      sendAudio: vi.fn(async () => ({ success: true })),
    },
    audioSurface: {
      sendCommand: vi.fn(async () => ({ ok: true })),
      onEvent: vi.fn(() => vi.fn()),
    },
    hub: { getIceServers: vi.fn(async () => []) },
    electronAPI: {
      getSystemCallReadiness: vi.fn(async () => goodReadiness()),
      refreshSystemCallReadiness: vi.fn(async () => goodReadiness()),
      reticulumGetLocalDestinationHash: vi.fn(async () => ({
        destinationHash: 'a'.repeat(32),
      })),
      reticulumGetLocalIdentityPublicKeyBase64: vi.fn(async () => ({
        publicKeyBase64: 'cmV0aWN1bHVtLWlkZW50aXR5',
      })),
    },
    sendMessage: vi.fn(async () => ({ signature: 'sig', publicKey: 'pub' })),
  });
  const store = createStore();
  store.set(userInfoAtom, { address: 'Qme', publicKey: 'pub' });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(
    () =>
      useVoiceCall({
        callApi,
        callApiSignsSignals: true,
        enableDirectVoiceWebRtc: true,
        createCallId: () => 'capability-retry-call',
        skipDirectFriendValidation: true,
        skipSystemReadiness: true,
      }),
    { wrapper }
  );
  await act(async () => {
    await hook.result.current.initiateCall(
      'Qpeer',
      buildDirectVoiceCallChatId('Qme', 'Qpeer'),
      async () => ({ signature: 'sig', publicKey: 'pub' })
    );
    await callEventHandler?.('call:accepted', {
      callId: 'capability-retry-call',
    });
  });
  const capabilities = () =>
    sendRtcSignal.mock.calls.filter(
      ([input]) => input.signalType === 'capability'
    );
  await waitFor(() => expect(capabilities()).toHaveLength(1));
  return {
    hook,
    capabilities,
    sendRtcSignal,
    groupCallEvent: (event: string, payload: unknown) =>
      groupCallEventHandler?.(event, payload),
  };
}

describe('direct voice capability adverts', () => {
  beforeEach(() => {
    // WebCrypto digests finish on Node's thread pool, outside the fake
    // clock; the same SHA-256 from a microtask keeps every advert inside
    // the timer step that fires it.
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
      async (_algorithm, data) => {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data as ArrayBuffer);
        return new Uint8Array(createHash('sha256').update(bytes).digest())
          .buffer;
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    platform.go = false;
  });

  it('keeps the desktop schedule and extends it on GO only', () => {
    expect(directVoiceCapabilityRetryDelaysMs(false)).toEqual([
      1_000, 1_500, 2_500, 4_000, 6_000, 8_000, 10_000,
    ]);
    const go = directVoiceCapabilityRetryDelaysMs(true);
    expect(go.slice(0, 7)).toEqual(directVoiceCapabilityRetryDelaysMs(false));
    expect(go.slice(7)).toEqual([15_000, 20_000, 30_000, 30_000]);
    expect(go.reduce((sum, ms) => sum + ms, 0)).toBe(128_000);
  });

  it('desktop: 7 adverts, then it stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    platform.go = false;
    const { capabilities, hook } = await connectedCallThatIsNeverAcked();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200_000);
    });
    expect(capabilities()).toHaveLength(7);
    // Still in the call: the list ran out, nothing ended it.
    expect(hook.result.current.callState).toBe('connected');
    hook.unmount();
  });

  it('GO: keeps advertising for about 2 minutes while unacknowledged', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    platform.go = true;
    const { capabilities, hook } = await connectedCallThatIsNeverAcked();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(capabilities()).toHaveLength(9);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200_000);
    });
    expect(capabilities()).toHaveLength(11);
    expect(hook.result.current.callState).toBe('connected');
    hook.unmount();
  });

  it('GO: stops advertising once the peer acknowledges', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    platform.go = true;
    const { capabilities, groupCallEvent, hook } =
      await connectedCallThatIsNeverAcked();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    const sent = capabilities().length;
    expect(sent).toBeGreaterThan(7);
    const capabilityId = JSON.parse(capabilities()[0]![0].payload).capabilityId;
    const roomId = await buildDmVoiceRoomId(
      buildDirectVoiceCallChatId('Qme', 'Qpeer')
    );
    await act(async () => {
      await groupCallEvent('gcall:rtc-signal', {
        verified: true,
        roomId,
        callSessionId: 'dm-media-session',
        mediaSessionGeneration: 1,
        fromAddress: 'Qpeer',
        toAddress: 'Qme',
        signalType: 'ack',
        payload: JSON.stringify({
          kind: 'capability-ack',
          generation: 'native_audio_v1',
          capabilityId,
        }),
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200_000);
    });
    expect(capabilities()).toHaveLength(sent);
    hook.unmount();
  });
});
