/**
 * GO runs the shared, unmodified GroupCallAudioEngineRuntime in its WebView
 * (mobileAudioSurface.ts loads it for group calls). These tests use the REAL
 * runtime class to check what GO depends on:
 *  - the WebView is not cross-origin isolated (no SharedArrayBuffer): every
 *    shared-memory ring the runtime uses must fall back to postMessage;
 *  - the members applyGoGroupRtcTransportPolicy wraps still exist (an
 *    upstream rename must fail here, not silently in a call);
 *  - "Private calls": no RTCPeerConnection, no signed capability, also for an
 *    inbound offer, and the switch both ways in the middle of a call;
 *  - forwarder/root relaying goes through window.groupCall.sendAudioBatch,
 *    which the hosted Hub managers provide.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DmVoiceGcallInboundPlayout } from '../lib/call/dmVoiceGcallInboundPlayout';
import { GroupCallAudioEngineRuntime } from '../lib/group-call/groupCallAudioEngineRuntime';
import { GroupCallAudioSenderEngine } from '../lib/group-call/groupCallAudioSenderEngine';
import { buildGroupCallTopology } from '../lib/group-call/groupCallTopology';
import {
  __resetCallTransportPreferenceForTests,
  setCallTransportPreference,
} from './callTransportPreference';
import {
  applyGoGroupRtcTransportPolicy,
  GROUP_RTC_DISABLED_ERROR,
  isGroupWebRtcAllowed,
} from './mobileAudioSurface';

const ME = 'QAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PEER_A = 'QBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PEER_B = 'QCccccccccccccccccccccccccccccccccc';
const ROOM = 'gcall-qortal-4242';

type EdgeLike = { isOpen: () => boolean; close: () => void };

type RuntimeInternals = {
  snapshot: { roomId: string };
  userInfo: { address: string; publicKey: string } | null;
  callSessionId: string;
  mediaSessionGeneration: number;
  topology: unknown;
  groupRtcTransports: Map<string, EdgeLike>;
  groupRtcCapabilities: Set<string>;
  groupRtcCapabilityLastSentAt: Map<string, number>;
  senderEngine: { getDiagnosticsSnapshot?: () => Record<string, unknown> };
  syncGroupRtcTransports: () => Promise<void>;
  handleGroupRtcSignal: (payload: unknown) => Promise<void>;
  groupRtcConnectionId: (peer: string) => string;
  sendGroupPacketToTargets: (
    packet: Uint8Array,
    targets: string[]
  ) => Promise<void>;
  stopGroupRtcMaintenance: () => void;
  dispose: () => void;
};

class FakePeerConnection {
  static created = 0;
  onicecandidate: unknown = null;
  ondatachannel: unknown = null;
  onconnectionstatechange: unknown = null;
  connectionState = 'new';
  signalingState = 'stable';
  localDescription: unknown = null;
  remoteDescription: unknown = null;
  constructor(public config: unknown) {
    FakePeerConnection.created += 1;
  }
  createDataChannel() {
    return { readyState: 'connecting', close() {} };
  }
  async createOffer() {
    return { type: 'offer', sdp: 'v=0' };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'v=0' };
  }
  async setLocalDescription(d: unknown) {
    this.localDescription = d;
  }
  async setRemoteDescription(d: unknown) {
    this.remoteDescription = d;
  }
  async addIceCandidate() {}
  getConfiguration() {
    return {};
  }
  setConfiguration() {}
  close() {}
}

let rt: RuntimeInternals;
let sendRtcSignal: ReturnType<typeof vi.fn>;
let sendAudioBatch: ReturnType<typeof vi.fn>;
let sendMessage: ReturnType<typeof vi.fn>;

function makeRuntime(): RuntimeInternals {
  const runtime =
    new GroupCallAudioEngineRuntime() as unknown as RuntimeInternals;
  runtime.snapshot = { ...runtime.snapshot, roomId: ROOM };
  runtime.userInfo = { address: ME, publicKey: 'pub-me' };
  runtime.callSessionId = 'session-1';
  runtime.mediaSessionGeneration = 1;
  // ME sorts first: root forwarder with two members (edges to both).
  runtime.topology = buildGroupCallTopology([ME, PEER_A, PEER_B], 1);
  return runtime;
}

/** A verified GC_RTC_SIGNAL capability from a peer (Hubs retry every 12 s). */
function inboundCapability(from: string) {
  return {
    roomId: ROOM,
    callSessionId: 'session-1',
    mediaSessionGeneration: 1,
    fromAddress: from,
    toAddress: ME,
    connectionId: rt.groupRtcConnectionId(from),
    signalType: 'capability',
    payload: JSON.stringify({ type: 'capability', version: 1 }),
    verified: true,
  };
}

/** Capability signals GO handed to window.groupCall.sendRtcSignal for `to`. */
const capabilitiesSentTo = (to: string): number =>
  sendRtcSignal.mock.calls.filter(
    (call) =>
      (call[0] as { toAddress?: string; signalType?: string }).toAddress ===
        to && (call[0] as { signalType?: string }).signalType === 'capability'
  ).length;

/** A verified, well-formed GC_RTC_SIGNAL from a peer, as the bridge emits it. */
function inboundOffer(from: string) {
  const signal = {
    type: 'offer',
    generation: 'gen-abcdefgh',
    description: { type: 'offer', sdp: 'v=0' },
  };
  return {
    roomId: ROOM,
    callSessionId: 'session-1',
    mediaSessionGeneration: 1,
    fromAddress: from,
    toAddress: ME,
    connectionId: rt.groupRtcConnectionId(from),
    signalType: 'offer',
    payload: JSON.stringify(signal),
    verified: true,
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  __resetCallTransportPreferenceForTests();
  localStorage.removeItem('go.calls.transport');
  FakePeerConnection.created = 0;
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
  sendRtcSignal = vi.fn(async () => ({ success: true }));
  sendAudioBatch = vi.fn(async () => ({ success: true }));
  sendMessage = vi.fn(async () => ({ signature: 'sig' }));
  (window as unknown as Record<string, unknown>).groupCall = {
    sendRtcSignal,
    sendAudioBatch,
    sendAudio: vi.fn(async () => ({ success: true })),
    onEvent: vi.fn(() => () => {}),
  };
  (window as unknown as Record<string, unknown>).sendMessage = sendMessage;
  (window as unknown as Record<string, unknown>).hub = {
    getIceServers: vi.fn(async () => []),
  };
  rt = makeRuntime();
});

afterEach(() => {
  rt.stopGroupRtcMaintenance();
  rt.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).groupCall;
  delete (window as unknown as Record<string, unknown>).sendMessage;
  localStorage.removeItem('go.calls.transport');
});

describe('shared group runtime inside GO (not cross-origin isolated)', () => {
  it('still has every member the GO WebRTC policy wraps', () => {
    // Read (not wrapped) by the policy and by GO's Copy diagnostics.
    expect(rt.groupRtcCapabilityLastSentAt).toBeInstanceOf(Map);
    expect(rt.groupRtcCapabilities).toBeInstanceOf(Set);
    expect(typeof rt.senderEngine?.getDiagnosticsSnapshot).toBe('function');
    expect(rt.senderEngine.getDiagnosticsSnapshot?.()).toMatchObject({
      hasMicStream: false,
      micTracks: [],
      hasCaptureNode: false,
    });
    expect(applyGoGroupRtcTransportPolicy(rt)).toBe(true);
    expect(applyGoGroupRtcTransportPolicy({})).toBe(false);
  });

  it('uses postMessage instead of shared-memory rings without SharedArrayBuffer', () => {
    vi.stubGlobal('SharedArrayBuffer', undefined);
    const playout = new DmVoiceGcallInboundPlayout() as unknown as {
      canUseSharedPcmRing: () => boolean;
    };
    expect(playout.canUseSharedPcmRing()).toBe(false);
    const sender = new GroupCallAudioSenderEngine() as unknown as {
      createEncodeWorkerSharedRing: () => unknown;
    };
    expect(sender.createEncodeWorkerSharedRing()).toBeNull();
  });
});

describe('"Private calls" for group WebRTC edges', () => {
  it('creates no peer connection and advertises nothing', async () => {
    applyGoGroupRtcTransportPolicy(rt);
    setCallTransportPreference('reticulum');
    expect(isGroupWebRtcAllowed()).toBe(false);
    await rt.syncGroupRtcTransports();
    await flush();
    expect(FakePeerConnection.created).toBe(0);
    expect(rt.groupRtcTransports.size).toBe(0);
    expect(sendRtcSignal).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled(); // nothing signed
  });

  it('ignores an inbound offer without creating a peer connection', async () => {
    applyGoGroupRtcTransportPolicy(rt);
    setCallTransportPreference('reticulum');
    await rt.handleGroupRtcSignal(inboundOffer(PEER_A));
    await flush();
    expect(FakePeerConnection.created).toBe(0);
    expect(rt.groupRtcTransports.size).toBe(0);
    expect(sendRtcSignal).not.toHaveBeenCalled();
  });

  it('creates none either when the bridge hides sendRtcSignal', async () => {
    applyGoGroupRtcTransportPolicy(rt);
    delete (window.groupCall as unknown as Record<string, unknown>)
      .sendRtcSignal;
    await rt.syncGroupRtcTransports();
    await flush();
    expect(FakePeerConnection.created).toBe(0);
  });

  it('without the GO policy the runtime would create them (why it exists)', async () => {
    setCallTransportPreference('reticulum');
    delete (window.groupCall as unknown as Record<string, unknown>)
      .sendRtcSignal;
    await rt.syncGroupRtcTransports();
    await flush();
    expect(FakePeerConnection.created).toBe(2);
  });

  it('allowed: one edge per topology target and a signed capability', async () => {
    applyGoGroupRtcTransportPolicy(rt);
    await rt.syncGroupRtcTransports();
    await flush();
    expect(FakePeerConnection.created).toBe(2);
    expect([...rt.groupRtcTransports.keys()].sort()).toEqual(
      [PEER_A, PEER_B].sort()
    );
    await vi.waitFor(() => expect(sendRtcSignal).toHaveBeenCalled());
    const first = sendRtcSignal.mock.calls[0][0] as { signalType: string };
    expect(first.signalType).toBe('capability');
  });

  it('switched on mid-call: open edges stay, the rest close, nothing new', async () => {
    applyGoGroupRtcTransportPolicy(rt);
    const open: EdgeLike = { isOpen: () => true, close: vi.fn() };
    const pending: EdgeLike = { isOpen: () => false, close: vi.fn() };
    rt.groupRtcTransports.set(PEER_A, open);
    rt.groupRtcTransports.set(PEER_B, pending);
    setCallTransportPreference('reticulum');
    await rt.syncGroupRtcTransports();
    await flush();
    expect(rt.groupRtcTransports.get(PEER_A)).toBe(open);
    expect(open.close).not.toHaveBeenCalled();
    expect(pending.close).toHaveBeenCalled();
    expect(rt.groupRtcTransports.has(PEER_B)).toBe(false);
    expect(FakePeerConnection.created).toBe(0);
    // The open edge may still signal (its own ICE); a closed one may not.
    const sendSignal = (
      rt as unknown as {
        sendGroupRtcSignal: (peer: string, s: unknown) => Promise<void>;
      }
    ).sendGroupRtcSignal;
    await expect(
      sendSignal(PEER_B, { type: 'capability', version: 1 })
    ).rejects.toThrow(GROUP_RTC_DISABLED_ERROR);
  });

  it('switched off mid-call: the next sync builds the edges', async () => {
    applyGoGroupRtcTransportPolicy(rt);
    setCallTransportPreference('reticulum');
    await rt.syncGroupRtcTransports();
    expect(FakePeerConnection.created).toBe(0);
    setCallTransportPreference('webrtc');
    await rt.syncGroupRtcTransports();
    await flush();
    expect(FakePeerConnection.created).toBe(2);
    // ...and announces GO at once: the refused attempts under "Private
    // calls" must not hold the runtime's 12 s capability retry.
    await vi.waitFor(() => {
      expect(capabilitiesSentTo(PEER_A)).toBe(1);
      expect(capabilitiesSentTo(PEER_B)).toBe(1);
    });
  });

  it('switched off mid-call: a Hub that advertised meanwhile gets an answer', async () => {
    // GO is root here (it answers; the Hubs offer only after GO's capability).
    applyGoGroupRtcTransportPolicy(rt);
    setCallTransportPreference('reticulum');
    await rt.handleGroupRtcSignal(inboundCapability(PEER_A));
    await rt.syncGroupRtcTransports();
    await flush();
    expect(sendRtcSignal).not.toHaveBeenCalled();
    expect(rt.groupRtcCapabilities.has(PEER_A)).toBe(false);
    expect(rt.groupRtcCapabilityLastSentAt.has(PEER_A)).toBe(false);
    setCallTransportPreference('webrtc');
    await rt.syncGroupRtcTransports();
    await flush();
    await vi.waitFor(() => expect(capabilitiesSentTo(PEER_A)).toBe(1));
    // The Hub's next capability (its own 12 s retry) is answered too.
    await rt.handleGroupRtcSignal(inboundCapability(PEER_A));
    await flush();
    await vi.waitFor(() => expect(capabilitiesSentTo(PEER_A)).toBe(2));
    expect(rt.groupRtcCapabilities.has(PEER_A)).toBe(true);
  });
});

describe('forwarder duties', () => {
  it('relays to members over Reticulum (sendAudioBatch) where no edge is open', async () => {
    const packet = new Uint8Array([1, 2, 3]);
    await rt.sendGroupPacketToTargets(packet, [PEER_A, PEER_B]);
    expect(sendAudioBatch).toHaveBeenCalledWith(
      ROOM,
      expect.arrayContaining([PEER_A, PEER_B]),
      packet
    );
  });
});
