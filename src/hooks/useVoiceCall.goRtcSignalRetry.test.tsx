/**
 * GO-only: a WebRTC offer, answer or candidate batch that the call manager
 * refuses (or throws on) is signed again and sent again, for a bounded time
 * and only while it still belongs to the call. The audio link counts as not
 * ready for moments while a call starts, and these signals are made once: a
 * lost candidate batch alone kept a call off Direct. The same file covers the
 * other half, GO no longer causing those moments itself by asking for
 * recovery of a link that is up.
 */
import { createHash } from 'node:crypto';
import React from 'react';
import { Provider, createStore } from 'jotai';
import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userInfoAtom } from '../atoms/global';
import { buildDirectVoiceCallChatId } from '../lib/call/directVoiceCallChatId';
import {
  buildDmVoiceRoomId,
  GCALL_KEY_MESSAGE_VERSION,
} from '../lib/call/directVoiceReticulumMedia';
import { buildMediaKeyCommitmentHex } from '../lib/group-call/mediaKeyCommitment';
import {
  directVoiceRtcSignalRetryDelaysMs,
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

const CALL_ID = 'signal-retry-call';
const NOT_READY = { success: false, error: 'direct-link-not-ready' };
const NULL_SLICE = new TypeError(
  "Cannot read properties of null (reading 'slice')"
);

type RtcSignalInput = {
  signalType: string;
  signalId: string;
  payload: string;
  callSessionId: string;
  timestamp: number;
};
type SendResult = { success: boolean; error?: string };
type EventHandler = (event: string, payload: unknown) => void | Promise<void>;

const goodReadiness = () => ({
  status: 'good',
  reasons: [],
  cpuLoad: 0.1,
  memoryPressure: 'normal',
  eventLoopLagMs: 0,
});

async function connectedCall(options?: {
  linkUp?: () => boolean;
  /** The peer has not joined the media room yet. */
  alone?: boolean;
}) {
  let callEventHandler: EventHandler | null = null;
  let groupCallEventHandler: EventHandler | null = null;
  const surfaceHandlers = new Set<(event: unknown) => void>();
  /** Answers for offer/answer/candidate sends, in order; then 'sent'. */
  const answers: Array<SendResult | Error> = [];
  let answerAll: (() => SendResult | Promise<SendResult>) | null = null;
  const sendRtcSignal = vi.fn(async (input: RtcSignalInput) => {
    // Capability adverts repeat on their own schedule; not under test here.
    if (input.signalType === 'capability') return { success: true };
    if (answerAll) return answerAll();
    const next = answers.shift() ?? { success: true };
    if (next instanceof Error) throw next;
    return next;
  });
  const callApi = {
    onEvent: vi.fn((cb: EventHandler) => {
      callEventHandler = cb;
      return vi.fn();
    }),
    setLocalAddresses: vi.fn(async () => ({ success: true })),
    initiate: vi.fn(async () => ({ success: true })),
    hangup: vi.fn(async () => ({ success: true })),
  };
  const requestPeerMediaRecovery = vi.fn(async () => ({ success: true }));
  const linkUp = options?.linkUp ?? (() => true);
  Object.assign(window as any, {
    call: callApi,
    groupCall: {
      onEvent: vi.fn((cb: EventHandler) => {
        groupCallEventHandler = cb;
        return vi.fn();
      }),
      join: vi.fn(async () => ({
        success: true,
        callSessionId: 'dm-media-session',
        mediaSessionGeneration: 1,
      })),
      leave: vi.fn(async () => ({ success: true })),
      sendRtcSignal,
      setLocalAddresses: vi.fn(async () => {}),
      requestPeerMediaRecovery,
      getRoomParticipants: vi.fn(async () => [
        { address: 'Qme' },
        ...(options?.alone ? [] : [{ address: 'Qpeer' }]),
      ]),
      getLinkStats: vi.fn(async () => ({
        success: true,
        stats: {
          establishedLinks: linkUp() ? 1 : 0,
          participants: options?.alone ? 1 : 2,
        },
      })),
      sendKey: vi.fn(async () => ({ success: true })),
      sendAudio: vi.fn(async () => ({ success: true })),
    },
    audioSurface: {
      sendCommand: vi.fn(async () => ({ ok: true })),
      onEvent: vi.fn((cb: (event: unknown) => void) => {
        surfaceHandlers.add(cb);
        return () => surfaceHandlers.delete(cb);
      }),
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
        createCallId: () => CALL_ID,
        skipDirectFriendValidation: true,
        skipSystemReadiness: true,
      }),
    { wrapper }
  );
  const chatId = buildDirectVoiceCallChatId('Qme', 'Qpeer');
  await act(async () => {
    await hook.result.current.initiateCall('Qpeer', chatId, async () => ({
      signature: 'sig',
      publicKey: 'pub',
    }));
    await callEventHandler?.('call:accepted', { callId: CALL_ID });
  });
  await waitFor(() =>
    expect(
      sendRtcSignal.mock.calls.some(([s]) => s.signalType === 'capability')
    ).toBe(true)
  );
  const roomId = await buildDmVoiceRoomId(chatId);
  const surface = (event: Record<string, unknown>) =>
    act(async () => {
      for (const cb of [...surfaceHandlers]) {
        cb({ roomId, peerAddress: 'Qpeer', ...event });
      }
    });
  return {
    hook,
    roomId,
    answers,
    answerAllWith: (fn: (() => SendResult | Promise<SendResult>) | null) => {
      answerAll = fn;
    },
    requestPeerMediaRecovery,
    callEvent: (event: string, payload: unknown) =>
      callEventHandler?.(event, payload),
    groupCallEvent: (event: string, payload: unknown) =>
      groupCallEventHandler?.(event, payload),
    signal: (signal: Record<string, unknown>) =>
      surface({ type: 'direct-voice-rtc-signal', signal }),
    rtcState: (state: string) =>
      surface({ type: 'direct-voice-rtc-state', state }),
    /** Offer/answer/candidate sends, oldest first. */
    sent: () =>
      sendRtcSignal.mock.calls
        .map(([input]) => input)
        .filter((input) => input.signalType !== 'capability'),
    types: () =>
      sendRtcSignal.mock.calls
        .map(([input]) => input.signalType)
        .filter((type) => type !== 'capability'),
  };
}

const offer = (generation = 'G1', sdp = 'o') => ({
  kind: 'description',
  generation,
  description: { type: 'offer', sdp },
});
const answer = (generation = 'G1', sdp = 'a') => ({
  kind: 'description',
  generation,
  description: { type: 'answer', sdp },
});
const candidates = (generation = 'G1') => ({
  kind: 'ice-candidates',
  generation,
  candidates: [{ candidate: 'candidate:1 1 udp 1 192.0.2.1 9 typ srflx' }],
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('GO: a refused WebRTC signal is sent again', () => {
  beforeEach(() => {
    platform.go = true;
    // WebCrypto digests finish on Node's thread pool, outside the fake
    // clock; the same SHA-256 from a microtask keeps every send inside the
    // timer step that fires it.
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
      async (_algorithm, data) => {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data as ArrayBuffer);
        return new Uint8Array(createHash('sha256').update(bytes).digest())
          .buffer;
      }
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    platform.go = false;
  });

  it('a refused candidate batch is sent again, freshly signed', async () => {
    const call = await connectedCall();
    call.answers.push(NOT_READY);
    await call.signal(candidates());
    await advance(0);
    expect(call.types()).toEqual(['candidate']);
    await advance(5_000);
    expect(call.types()).toEqual(['candidate', 'candidate']);
    const [first, second] = call.sent();
    expect(second!.payload).toBe(first!.payload);
    expect(JSON.parse(second!.payload)).toEqual(candidates());
    // The Hub drops a signal signed more than 20 s ago and one whose id it
    // has seen, so a resend is a new signature over a new id and time.
    expect(second!.timestamp).toBeGreaterThan(first!.timestamp);
    expect(second!.signalId).not.toBe(first!.signalId);
    const signed = (window as any).sendMessage.mock.calls
      .filter(([type]: [string]) => type === 'signPresenceMessage')
      .map(([, fields]: [string, RtcSignalInput]) => fields)
      .filter((fields: RtcSignalInput) => fields.signalType === 'candidate');
    expect(signed.map((f: RtcSignalInput) => f.timestamp)).toEqual([
      first!.timestamp,
      second!.timestamp,
    ]);
    // Delivered: nothing more goes out.
    await advance(60_000);
    expect(call.types()).toHaveLength(2);
    call.hook.unmount();
  });

  it('a refused answer is sent again before its candidates', async () => {
    const call = await connectedCall();
    call.answers.push(NOT_READY, NOT_READY);
    await call.signal(answer());
    await call.signal(candidates());
    await advance(5_000);
    expect(call.types()).toEqual(['answer', 'answer', 'answer', 'candidate']);
    expect(new Set(call.sent().map((s) => s.signalId)).size).toBe(4);
    call.hook.unmount();
  });

  it('a send that throws is sent again, and its candidates after it', async () => {
    const call = await connectedCall();
    call.answers.push(NULL_SLICE, { success: true }, NOT_READY);
    await call.signal(answer());
    await call.signal(candidates());
    await advance(5_000);
    expect(call.types()).toEqual([
      'answer',
      'answer',
      'candidate',
      'candidate',
    ]);
    call.hook.unmount();
  });

  it('a refused offer and a failed signature are sent again', async () => {
    const call = await connectedCall();
    call.answers.push(NOT_READY);
    const sendMessage = (window as any).sendMessage;
    sendMessage.mockRejectedValueOnce(new Error('timeout'));
    await call.signal(offer());
    await advance(5_000);
    // First attempt: not signed. Second: refused. Third: sent.
    expect(call.types()).toEqual(['offer', 'offer']);
    call.hook.unmount();
  });

  it('is not sent again after this side hung up', async () => {
    const call = await connectedCall();
    call.answerAllWith(() => NOT_READY);
    await call.signal(candidates());
    await advance(0);
    const before = call.types().length;
    await act(async () => {
      call.hook.result.current.hangUp();
    });
    call.answerAllWith(null);
    await advance(60_000);
    expect(call.types()).toHaveLength(before);
    expect(call.hook.result.current.callState).toBe('idle');
    call.hook.unmount();
  });

  it('is not sent again after the other side hung up', async () => {
    const call = await connectedCall();
    call.answerAllWith(() => NOT_READY);
    await call.signal(answer());
    await call.signal(candidates());
    await advance(0);
    const before = call.types().length;
    await act(async () => {
      void call.callEvent('call:hangup', { callId: CALL_ID });
    });
    await advance(60_000);
    // Neither the answer again nor the candidates that waited behind it.
    expect(call.types()).toHaveLength(before);
    call.hook.unmount();
  });

  it('is not sent again while a hang-up is still tearing down', async () => {
    const call = await connectedCall();
    call.answerAllWith(() => NOT_READY);
    await call.signal(candidates());
    await advance(0);
    const before = call.types().length;
    // Neither the surface nor the room answers the teardown.
    (window as any).audioSurface.sendCommand.mockImplementation(
      () => new Promise(() => {})
    );
    (window as any).groupCall.leave.mockImplementation(
      () => new Promise(() => {})
    );
    await act(async () => {
      void call.callEvent('call:hangup', { callId: CALL_ID });
    });
    await advance(60_000);
    expect(call.types()).toHaveLength(before);
    call.hook.unmount();
  });

  it('a hang-up while the refusal is under way stops the resend', async () => {
    const call = await connectedCall();
    let refuse!: (result: SendResult) => void;
    call.answerAllWith(
      () =>
        new Promise<SendResult>((resolve) => {
          refuse = resolve;
        })
    );
    await call.signal(answer());
    await advance(0);
    expect(call.types()).toEqual(['answer']);
    await act(async () => {
      void call.callEvent('call:hangup', { callId: CALL_ID });
      refuse(NOT_READY);
    });
    await advance(60_000);
    expect(call.types()).toEqual(['answer']);
    call.hook.unmount();
  });

  it('is not sent again once the transport has a new generation', async () => {
    const call = await connectedCall();
    call.answers.push(NOT_READY);
    await call.signal(offer('G1'));
    await advance(0);
    await call.signal(offer('G2'));
    await advance(60_000);
    expect(
      call.sent().map((s) => [s.signalType, JSON.parse(s.payload).generation])
    ).toEqual([
      ['offer', 'G1'],
      ['offer', 'G2'],
    ]);
    call.hook.unmount();
  });

  it('a new offer does not sit out the wait of the old one', async () => {
    const call = await connectedCall();
    call.answerAllWith(() => NOT_READY);
    await call.signal(offer('G1'));
    // Six refusals; the seventh attempt is 2.5 s away.
    await advance(5_300);
    const before = call.types().length;
    expect(before).toBe(7);
    call.answerAllWith(null);
    await call.signal(offer('G2'));
    await advance(300);
    expect(call.sent()).toHaveLength(before + 1);
    expect(JSON.parse(call.sent()[before]!.payload).generation).toBe('G2');
    call.hook.unmount();
  });

  it('old candidates are not sent again behind a new generation', async () => {
    const call = await connectedCall();
    call.answers.push(NOT_READY);
    await call.signal(candidates('G1'));
    await advance(0);
    await call.signal(answer('G2'));
    await advance(60_000);
    expect(
      call.sent().map((s) => [s.signalType, JSON.parse(s.payload).generation])
    ).toEqual([
      ['candidate', 'G1'],
      ['answer', 'G2'],
    ]);
    call.hook.unmount();
  });

  /** The caller's room key for a media session, as the peer delivers it. */
  const applyRoomKey = async (
    call: Awaited<ReturnType<typeof connectedCall>>,
    session: { callSessionId: string; mediaSessionGeneration: number }
  ) => {
    const roomKey = new Uint8Array(32).fill(7);
    const keyCommitment = await buildMediaKeyCommitmentHex(
      roomKey,
      session.callSessionId,
      session.mediaSessionGeneration
    );
    (window as any).sendMessage.mockImplementation(async (type: string) =>
      type === 'decryptBoxWithMyKey'
        ? { decryptedKey: btoa(String.fromCharCode(...roomKey)) }
        : { signature: 'sig', publicKey: 'pub' }
    );
    await act(async () => {
      await call.groupCallEvent('gcall:key', {
        roomId: call.roomId,
        recipientAddress: 'Qme',
        fromAddress: 'Qpeer',
        verified: true,
        keyMessageVersion: GCALL_KEY_MESSAGE_VERSION,
        encryptedKey: btoa('x'.repeat(80)),
        keyCommitment,
        ...session,
      });
    });
    await advance(0);
  };

  it('a resend signs for the media session of the moment', async () => {
    const call = await connectedCall();
    call.answers.push({ success: false, error: 'media-session-mismatch' });
    await call.signal(answer());
    await advance(0);
    await applyRoomKey(call, {
      callSessionId: 'adopted-session',
      mediaSessionGeneration: 1,
    });
    await advance(5_000);
    expect(call.sent().map((s) => s.callSessionId)).toEqual([
      'dm-media-session',
      'adopted-session',
    ]);
    call.hook.unmount();
  });

  it('is not sent again after the media generation changed', async () => {
    const call = await connectedCall();
    call.answers.push(NOT_READY);
    await call.signal(answer());
    await advance(0);
    await applyRoomKey(call, {
      callSessionId: 'next-session',
      mediaSessionGeneration: 2,
    });
    await advance(60_000);
    expect(call.types()).toEqual(['answer']);
    call.hook.unmount();
  });

  it('a session that changes while a signal is signed is signed again', async () => {
    const call = await connectedCall();
    let sign!: (value: unknown) => void;
    (window as any).sendMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          sign = resolve;
        })
    );
    await call.signal(candidates());
    await advance(0);
    await applyRoomKey(call, {
      callSessionId: 'adopted-session',
      mediaSessionGeneration: 1,
    });
    await act(async () => {
      sign({ signature: 'sig', publicKey: 'pub' });
    });
    await advance(5_000);
    expect(call.sent().map((s) => s.callSessionId)).toEqual([
      'adopted-session',
    ]);
    call.hook.unmount();
  });

  it('only the newest copy of an answer is sent again', async () => {
    const call = await connectedCall();
    call.answers.push(NOT_READY);
    await call.signal(answer('G1', 'old'));
    await advance(0);
    await call.signal(answer('G1', 'with-candidates'));
    await advance(60_000);
    expect(
      call.sent().map((s) => JSON.parse(s.payload).description.sdp)
    ).toEqual(['old', 'with-candidates']);
    call.hook.unmount();
  });

  it('is not sent again once WebRTC is open', async () => {
    const call = await connectedCall();
    call.answers.push(NOT_READY);
    await call.signal(candidates());
    await advance(0);
    await call.rtcState('open');
    await advance(60_000);
    expect(call.types()).toEqual(['candidate']);
    call.hook.unmount();
  });

  it('stops after the last wait when every attempt is refused', async () => {
    const call = await connectedCall();
    call.answerAllWith(() => NOT_READY);
    const delays = directVoiceRtcSignalRetryDelaysMs(true);
    const total = delays.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeLessThan(20_000);
    await call.signal(candidates());
    await advance(total + 5_000);
    expect(call.types()).toHaveLength(delays.length + 1);
    await advance(120_000);
    expect(call.types()).toHaveLength(delays.length + 1);
    call.hook.unmount();
  });

  it('slow failures cannot stretch the resends past 20 s', async () => {
    const call = await connectedCall();
    call.answerAllWith(
      () =>
        new Promise<SendResult>((resolve) => {
          setTimeout(
            () => resolve({ success: false, error: 'bridge-timeout' }),
            6_000
          );
        })
    );
    await call.signal(answer());
    await advance(200_000);
    // Started at about 0, 6.3, 12.7 and 19.3 s; a fifth would be past 20 s.
    expect(call.types()).toHaveLength(4);
    call.hook.unmount();
  });

  it.each([
    'room-not-found',
    'rtc-signal-too-large',
    'sender-not-local',
    'sender-public-key-mismatch',
    'payload-hash-mismatch',
  ])('a refusal no resend can cure is final: %s', async (error) => {
    const call = await connectedCall();
    call.answers.push({ success: false, error });
    await call.signal(candidates());
    await advance(60_000);
    expect(call.types()).toEqual(['candidate']);
    call.hook.unmount();
  });

  it('a signal given up on does not block the ones after it', async () => {
    const call = await connectedCall();
    call.answers.push({ success: false, error: 'rtc-signal-too-large' });
    await call.signal(offer());
    await call.signal(candidates());
    await advance(1_000);
    expect(call.types()).toEqual(['offer', 'candidate']);
    call.hook.unmount();
  });

  it('desktop: sends each signal once, as before', async () => {
    platform.go = false;
    const call = await connectedCall();
    call.answers.push(NOT_READY, NULL_SLICE);
    await call.signal(answer());
    await call.signal(candidates());
    await advance(60_000);
    expect(call.types()).toEqual(['answer', 'candidate']);
    expect(directVoiceRtcSignalRetryDelaysMs(false)).toEqual([]);
    call.hook.unmount();
  });
});

describe('GO: no recovery request for an audio link that is up', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    platform.go = false;
  });

  it('GO: call start and the readiness check leave it alone', async () => {
    platform.go = true;
    const call = await connectedCall({ linkUp: () => true });
    await advance(5_000);
    expect(call.requestPeerMediaRecovery).not.toHaveBeenCalled();
    call.hook.unmount();
  });

  it('GO: the peer joining leaves it alone, and asks when it is down', async () => {
    platform.go = true;
    let up = true;
    const call = await connectedCall({ linkUp: () => up });
    await advance(1_000);
    const joined = () =>
      act(async () => {
        await call.groupCallEvent('gcall:participant-joined', {
          roomId: call.roomId,
          address: 'Qpeer',
        });
      });
    await joined();
    await advance(100);
    expect(call.requestPeerMediaRecovery).not.toHaveBeenCalled();
    up = false;
    await joined();
    await advance(100);
    expect(call.requestPeerMediaRecovery).toHaveBeenCalledTimes(1);
    expect(call.requestPeerMediaRecovery).toHaveBeenCalledWith(
      call.roomId,
      'Qpeer',
      'dm-peer-joined'
    );
    call.hook.unmount();
  });

  it('GO: asks once a second until it is up, then stops', async () => {
    platform.go = true;
    let up = false;
    const call = await connectedCall({ linkUp: () => up });
    await advance(3_200);
    const readiness = () =>
      call.requestPeerMediaRecovery.mock.calls.filter(
        (args: unknown[]) => args[2] === 'dm-readiness:caller-start'
      ).length;
    expect(readiness()).toBeGreaterThanOrEqual(3);
    up = true;
    await advance(600);
    const before = readiness();
    await advance(10_000);
    expect(readiness()).toBe(before);
    call.hook.unmount();
  });

  it('GO: an up link is left alone while the peer is not listed yet', async () => {
    platform.go = true;
    const call = await connectedCall({ linkUp: () => true, alone: true });
    await advance(5_000);
    expect(call.requestPeerMediaRecovery).not.toHaveBeenCalled();
    call.hook.unmount();
  });

  it('GO: link stats that fail count as down', async () => {
    platform.go = true;
    const call = await connectedCall({
      linkUp: () => {
        throw new Error('no stats');
      },
    });
    await advance(100);
    expect(call.requestPeerMediaRecovery).toHaveBeenCalledWith(
      call.roomId,
      'Qpeer',
      'dm-call-start'
    );
    call.hook.unmount();
  });

  it('desktop: asks first, as before', async () => {
    platform.go = false;
    const call = await connectedCall({ linkUp: () => true });
    await advance(1_000);
    const reasons = call.requestPeerMediaRecovery.mock.calls.map(
      (args: unknown[]) => args[2]
    );
    expect(reasons).toContain('dm-call-start');
    expect(reasons).toContain('dm-readiness:caller-start');
    call.hook.unmount();
  });
});
