/**
 * GO-only race guard in useVoiceCall: the peer hangs up while
 * start-direct-voice-media is still running. Teardown has already stopped
 * (or skipped) media, so the start that finishes afterwards must neither
 * leave the mic and call audio running nor report "Voice call failed" and
 * hang up a call that is already over. Desktop keeps its behaviour.
 */
import React from 'react';
import { Provider, createStore } from 'jotai';
import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blockedAddressesAtom,
  dmFriendsByAddressAtom,
  infoSnackGlobalAtom,
  userInfoAtom,
} from '../atoms/global';
import { buildDirectVoiceCallChatId } from '../lib/call/directVoiceCallChatId';
import {
  buildDmVoiceRoomId,
  GCALL_KEY_MESSAGE_VERSION,
} from '../lib/call/directVoiceReticulumMedia';
import { buildMediaKeyCommitmentHex } from '../lib/group-call/mediaKeyCommitment';
import nacl from '../encryption/nacl-fast';
import { useVoiceCall } from './useVoiceCall';

const platform = vi.hoisted(() => ({ go: true }));
vi.mock('../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/platform')>()),
  isCapacitor: () => platform.go,
}));
vi.mock('../encryption/addressKeyCheck', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../encryption/addressKeyCheck')>()),
  publicKeyBelongsToAddress: () => true,
}));

function base58Encode(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt(0);
  for (const byte of bytes) value = value * BigInt(256) + BigInt(byte);
  let encoded = '';
  while (value > 0) {
    encoded = alphabet[Number(value % BigInt(58))] + encoded;
    value = value / BigInt(58);
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = alphabet[0] + encoded;
  }
  return encoded || alphabet[0];
}

const goodReadiness = () => ({
  status: 'good',
  reasons: [],
  cpuLoad: 0.1,
  memoryPressure: 'normal',
  eventLoopLagMs: 0,
});

type Command = { type?: string; ownerId?: string };

async function placeCallAndHangUpDuringMediaStart(startAnswer: {
  ok: boolean;
  error?: string;
}) {
  let callEventHandler:
    | ((event: string, payload: unknown) => void | Promise<void>)
    | null = null;
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
  };
  let releaseStart!: () => void;
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  const commands: Command[] = [];
  const sendCommand = vi.fn(async (command: Command) => {
    commands.push(command);
    if (command.type === 'start-direct-voice-media') {
      await startGate;
      return startAnswer;
    }
    return { ok: true };
  });
  const myAddr = 'Qme';
  const peerAddr = 'Qbuddy';
  const peerPublicKey = base58Encode(
    (
      nacl as unknown as {
        sign: { keyPair: () => { publicKey: Uint8Array } };
      }
    ).sign.keyPair().publicKey
  );

  Object.assign(window as any, {
    AudioContext: class {
      state = 'running';
      sampleRate = 48_000;
      currentTime = 0;
      destination = {};
      createGain = vi.fn(() => ({
        gain: {
          cancelScheduledValues: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          setValueAtTime: vi.fn(),
          value: 0,
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
      createOscillator = vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        frequency: { setValueAtTime: vi.fn(), value: 0 },
        start: vi.fn(),
        stop: vi.fn(),
        type: 'sine',
      }));
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {});
    },
    call: callApi,
    groupCall: {
      onEvent: vi.fn(() => vi.fn()),
      join: vi.fn(async () => ({
        success: true,
        callSessionId: 'call-session',
        mediaSessionGeneration: 1,
      })),
      leave: vi.fn(async () => ({ success: true })),
      setLocalAddresses: vi.fn(async () => {}),
      requestPeerMediaRecovery: vi.fn(async () => ({ success: true })),
      getRoomParticipants: vi.fn(async () => [
        { address: myAddr },
        { address: peerAddr },
      ]),
      getLinkStats: vi.fn(async () => ({
        success: true,
        stats: { establishedLinks: 1, participants: 2 },
      })),
      sendKey: vi.fn(async () => ({ success: true })),
      sendAudio: vi.fn(async () => ({ success: true })),
    },
    audioSurface: { sendCommand, onEvent: vi.fn(() => vi.fn()) },
    electronAPI: {
      getSystemCallReadiness: vi.fn(async () => goodReadiness()),
      refreshSystemCallReadiness: vi.fn(async () => goodReadiness()),
      reticulumGetLocalDestinationHash: vi.fn(async () => ({
        destinationHash: 'd'.repeat(32),
      })),
      reticulumGetLocalIdentityPublicKeyBase64: vi.fn(async () => ({
        publicKeyBase64: 'cmV0aWN1bHVtLWlkZW50aXR5',
      })),
    },
    sendMessage: vi.fn(async () => ({ signature: 'sig' })),
  });

  const chatId = buildDirectVoiceCallChatId(myAddr, peerAddr);
  const store = createStore();
  store.set(userInfoAtom, { address: myAddr, publicKey: 'pub' });
  store.set(blockedAddressesAtom, {});
  store.set(dmFriendsByAddressAtom, {
    [peerAddr]: { publicKey: peerPublicKey, addedAt: 1 },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const { result } = renderHook(() => useVoiceCall(), { wrapper });

  await act(async () => {
    await result.current.initiateCall(peerAddr, chatId, async () => ({
      signature: 'sig',
      publicKey: 'pub',
    }));
  });
  const callId = (
    callApi.initiate.mock.calls[0] as unknown[] | undefined
  )?.[5] as string;
  await act(async () => {
    await callEventHandler?.('call:accepted', { callId });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() =>
    expect(commands.map((c) => c.type)).toContain('start-direct-voice-media')
  );
  const ownerId = commands.find(
    (c) => c.type === 'start-direct-voice-media'
  )?.ownerId;

  // The peer hangs up while the surface is still starting media.
  await act(async () => {
    void callEventHandler?.('call:hangup', { callId });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() =>
    expect(commands.map((c) => c.type)).toContain('stop-direct-voice-rtc')
  );
  const commandsBeforeRelease = commands.length;
  await act(async () => {
    releaseStart();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return {
    store,
    callApi,
    ownerId,
    after: commands.slice(commandsBeforeRelease),
  };
}

describe('useVoiceCall GO teardown race guard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    platform.go = true;
  });

  it('GO: stops media that came up after the hang-up began', async () => {
    const { after, ownerId, callApi, store } =
      await placeCallAndHangUpDuringMediaStart({ ok: true });
    expect(after).toContainEqual({ type: 'stop-direct-voice-media', ownerId });
    expect(callApi.hangup).not.toHaveBeenCalled();
    expect(store.get(infoSnackGlobalAtom)?.message ?? '').not.toMatch(
      /failed/i
    );
  });

  it('GO: a start refused because the call ended stays quiet', async () => {
    const { callApi, store } = await placeCallAndHangUpDuringMediaStart({
      ok: false,
      error: 'direct-voice-owner-ended',
    });
    expect(callApi.hangup).not.toHaveBeenCalled();
    expect(store.get(infoSnackGlobalAtom)?.message ?? '').not.toMatch(
      /failed/i
    );
  });

  it('desktop keeps its old behaviour (no GO guard)', async () => {
    platform.go = false;
    const { after, store } = await placeCallAndHangUpDuringMediaStart({
      ok: false,
      error: 'direct-voice-owner-ended',
    });
    // Desktop reports the failed start as before (the GO guard is off).
    expect(store.get(infoSnackGlobalAtom)?.message ?? '').toMatch(/failed/i);
    expect(after.map((c) => c.type)).not.toContain('stop-direct-voice-media');
  });

  it('desktop: a late successful start is left as before', async () => {
    platform.go = false;
    const { after } = await placeCallAndHangUpDuringMediaStart({ ok: true });
    expect(after.map((c) => c.type)).not.toContain('stop-direct-voice-media');
  });
});

// ── Earlier windows: the hang-up lands before the media start begins ──────

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

function installCallWindow(opts: {
  myAddr: string;
  peerAddr: string;
  joinGate?: Promise<void>;
  leaveGate: Promise<void>;
  decryptGate?: Promise<void>;
  decryptedKey?: string;
  startAnswer: { ok: boolean; error?: string };
}) {
  let callEventHandler:
    | ((event: string, payload: unknown) => void | Promise<void>)
    | null = null;
  let gcallEventHandler:
    | ((event: string, payload: unknown) => void | Promise<void>)
    | null = null;
  const callApi = {
    onEvent: vi.fn(
      (cb: (event: string, payload: unknown) => void | Promise<void>) => {
        callEventHandler = cb;
        return vi.fn();
      }
    ),
    setLocalAddresses: vi.fn(async () => ({ success: true })),
    initiate: vi.fn(async () => ({ success: true })),
    accept: vi.fn(async () => ({ success: true })),
    hangup: vi.fn(async () => ({ success: true })),
  };
  const commands: Command[] = [];
  const sendCommand = vi.fn(async (command: Command) => {
    commands.push(command);
    if (command.type === 'start-direct-voice-media') return opts.startAnswer;
    return { ok: true };
  });
  const join = vi.fn(async () => {
    await opts.joinGate;
    return {
      success: true,
      callSessionId: 'call-session',
      mediaSessionGeneration: 1,
    };
  });
  const leave = vi.fn(async () => {
    await opts.leaveGate;
    return { success: true };
  });
  const sendKeyRequest = vi.fn(async () => ({ success: true }));
  Object.assign(window as any, {
    AudioContext: class {
      state = 'running';
      sampleRate = 48_000;
      currentTime = 0;
      destination = {};
      createGain = vi.fn(() => ({
        gain: {
          cancelScheduledValues: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          setValueAtTime: vi.fn(),
          value: 0,
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
      createOscillator = vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        frequency: { setValueAtTime: vi.fn(), value: 0 },
        start: vi.fn(),
        stop: vi.fn(),
        type: 'sine',
      }));
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {});
    },
    call: callApi,
    groupCall: {
      onEvent: vi.fn(
        (cb: (event: string, payload: unknown) => void | Promise<void>) => {
          gcallEventHandler = cb;
          return vi.fn();
        }
      ),
      join,
      leave,
      setLocalAddresses: vi.fn(async () => {}),
      requestPeerMediaRecovery: vi.fn(async () => ({ success: true })),
      getRoomParticipants: vi.fn(async () => [
        { address: opts.myAddr },
        { address: opts.peerAddr },
      ]),
      getLinkStats: vi.fn(async () => ({
        success: true,
        stats: { establishedLinks: 1, participants: 2 },
      })),
      sendKey: vi.fn(async () => ({ success: true })),
      sendKeyRequest,
      sendAudio: vi.fn(async () => ({ success: true })),
    },
    audioSurface: { sendCommand, onEvent: vi.fn(() => vi.fn()) },
    electronAPI: {
      getSystemCallReadiness: vi.fn(async () => goodReadiness()),
      refreshSystemCallReadiness: vi.fn(async () => goodReadiness()),
      reticulumGetLocalDestinationHash: vi.fn(async () => ({
        destinationHash: 'd'.repeat(32),
      })),
      reticulumGetLocalIdentityPublicKeyBase64: vi.fn(async () => ({
        publicKeyBase64: 'cmV0aWN1bHVtLWlkZW50aXR5',
      })),
    },
    sendMessage: vi.fn(async (type: string) => {
      if (type === 'decryptBoxWithMyKey') {
        await opts.decryptGate;
        return { decryptedKey: opts.decryptedKey };
      }
      return { signature: 'sig' };
    }),
  });
  return {
    callApi,
    commands,
    join,
    leave,
    sendKeyRequest,
    callEvent: (event: string, payload: unknown) =>
      callEventHandler?.(event, payload),
    gcallEvent: (event: string, payload: unknown) =>
      gcallEventHandler?.(event, payload),
  };
}

function renderVoiceCall(myAddr: string, peerAddr: string) {
  const store = createStore();
  store.set(userInfoAtom, { address: myAddr, publicKey: 'pub' });
  store.set(blockedAddressesAtom, {});
  store.set(dmFriendsByAddressAtom, {
    [peerAddr]: {
      publicKey: base58Encode(
        (
          nacl as unknown as {
            sign: { keyPair: () => { publicKey: Uint8Array } };
          }
        ).sign.keyPair().publicKey
      ),
      addedAt: 1,
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const { result } = renderHook(() => useVoiceCall(), { wrapper });
  return { store, result };
}

/** Each start-direct-voice-media must be followed by a stop for its owner. */
function startsLeftRunning(commands: Command[]): Command[] {
  return commands.filter(
    (c, i) =>
      c.type === 'start-direct-voice-media' &&
      !commands
        .slice(i + 1)
        .some(
          (later) =>
            later.type === 'stop-direct-voice-media' &&
            later.ownerId === c.ownerId
        )
  );
}

/** Caller: the peer hangs up while GO's GC_JOIN is still running. */
async function callerHangUpDuringJoin(startAnswer: {
  ok: boolean;
  error?: string;
}) {
  const myAddr = 'Qme';
  const peerAddr = 'Qbuddy';
  const joinGate = gate();
  const leaveGate = gate();
  const win = installCallWindow({
    myAddr,
    peerAddr,
    joinGate: joinGate.promise,
    leaveGate: leaveGate.promise,
    startAnswer,
  });
  const { store, result } = renderVoiceCall(myAddr, peerAddr);
  const chatId = buildDirectVoiceCallChatId(myAddr, peerAddr);
  await act(async () => {
    await result.current.initiateCall(peerAddr, chatId, async () => ({
      signature: 'sig',
      publicKey: 'pub',
    }));
  });
  const callId = (
    win.callApi.initiate.mock.calls[0] as unknown[] | undefined
  )?.[5] as string;
  await act(async () => {
    void win.callEvent('call:accepted', { callId });
    await tick(20);
  });
  await waitFor(() => expect(win.join).toHaveBeenCalled());
  // Hang-up while GC_JOIN runs; teardown then waits in GC_LEAVE.
  await act(async () => {
    void win.callEvent('call:hangup', { callId });
    await tick(20);
  });
  await waitFor(() => expect(win.leave).toHaveBeenCalled());
  // GC_JOIN finishes while teardown is still leaving the room.
  await act(async () => {
    joinGate.open();
    await tick(50);
  });
  await act(async () => {
    leaveGate.open();
    await tick(50);
  });
  return { store, ...win };
}

/** Callee: the peer hangs up while the room key is being decrypted. */
async function calleeHangUpDuringKeyDecrypt() {
  const myAddr = 'Qme';
  const peerAddr = 'Qbuddy';
  const decryptGate = gate();
  const leaveGate = gate();
  const keyBytes = new Uint8Array(32).fill(7);
  const win = installCallWindow({
    myAddr,
    peerAddr,
    leaveGate: leaveGate.promise,
    decryptGate: decryptGate.promise,
    decryptedKey: btoa(String.fromCharCode(...keyBytes)),
    startAnswer: { ok: true },
  });
  const { store, result } = renderVoiceCall(myAddr, peerAddr);
  const chatId = buildDirectVoiceCallChatId(myAddr, peerAddr);
  const roomId = await buildDmVoiceRoomId(chatId);
  await act(async () => {
    await win.callEvent('call:incoming', {
      callId: 'call-in',
      fromAddress: peerAddr,
      chatId,
    });
  });
  await act(async () => {
    await result.current.acceptCall();
  });
  await waitFor(() => expect(win.sendKeyRequest).toHaveBeenCalled());
  const keyCommitment = await buildMediaKeyCommitmentHex(
    keyBytes,
    'call-session',
    1
  );
  // The caller's key arrives; decryptBoxWithMyKey is still pending...
  await act(async () => {
    void win.gcallEvent('gcall:key', {
      roomId,
      recipientAddress: myAddr,
      encryptedKey: btoa(String.fromCharCode(...new Uint8Array(80).fill(1))),
      verified: true,
      keyMessageVersion: GCALL_KEY_MESSAGE_VERSION,
      callSessionId: 'call-session',
      mediaSessionGeneration: 1,
      keyCommitment,
      fromAddress: peerAddr,
    });
    await tick(20);
  });
  // ...when the peer hangs up; teardown then waits in GC_LEAVE.
  await act(async () => {
    void win.callEvent('call:hangup', { callId: 'call-in' });
    await tick(20);
  });
  await waitFor(() => expect(win.leave).toHaveBeenCalled());
  await act(async () => {
    decryptGate.open();
    await tick(100);
  });
  const whileLeaving = [...win.commands];
  await act(async () => {
    leaveGate.open();
    await tick(50);
  });
  return { store, whileLeaving, ...win };
}

describe('useVoiceCall GO race guard: hang-up before the media start', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    platform.go = true;
  });

  it('GO caller: hang-up during GC_JOIN leaves no media running', async () => {
    const { commands, callApi, store } = await callerHangUpDuringJoin({
      ok: true,
    });
    expect(startsLeftRunning(commands)).toEqual([]);
    expect(commands.map((c) => c.type)).not.toContain(
      'start-direct-voice-media'
    );
    expect(callApi.hangup).not.toHaveBeenCalled();
    expect(store.get(infoSnackGlobalAtom)?.message ?? '').not.toMatch(
      /failed/i
    );
  });

  it('GO caller: hang-up during GC_JOIN with an ended owner stays quiet', async () => {
    const { callApi, store } = await callerHangUpDuringJoin({
      ok: false,
      error: 'direct-voice-owner-ended',
    });
    expect(callApi.hangup).not.toHaveBeenCalled();
    expect(store.get(infoSnackGlobalAtom)?.message ?? '').not.toMatch(
      /failed/i
    );
  });

  it('desktop caller: the GC_JOIN window keeps its old behaviour', async () => {
    platform.go = false;
    const { commands } = await callerHangUpDuringJoin({ ok: true });
    // Desktop still starts media after the join (the GO guard is off).
    expect(commands.map((c) => c.type)).toContain('start-direct-voice-media');
  });

  it('GO callee: hang-up during the key decrypt stays quiet, no mic', async () => {
    const { commands, callApi, store } = await calleeHangUpDuringKeyDecrypt();
    expect(commands.map((c) => c.type)).not.toContain(
      'start-direct-voice-media'
    );
    expect(startsLeftRunning(commands)).toEqual([]);
    expect(callApi.hangup).not.toHaveBeenCalled();
    expect(store.get(infoSnackGlobalAtom)?.message ?? '').not.toMatch(
      /failed/i
    );
  });

  it('desktop callee: the key-decrypt window keeps its old behaviour', async () => {
    platform.go = false;
    const { whileLeaving, store } = await calleeHangUpDuringKeyDecrypt();
    // Desktop applies the late key as before: it starts media, or reports
    // the failure (the GO guard is off).
    const started = whileLeaving.some(
      (c) => c.type === 'start-direct-voice-media'
    );
    const failed = /failed/i.test(
      store.get(infoSnackGlobalAtom)?.message ?? ''
    );
    expect(started || failed).toBe(true);
  });
});
