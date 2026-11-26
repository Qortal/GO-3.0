import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DirectVoiceWebRtcTransport,
  type DirectVoiceRtcSignal,
} from './directVoiceWebRtcTransport';

/** Candidate pairs as getStats() lists them: id → answered checks. */
type Pairs = Record<string, number>;

class MockPeerConnection {
  static instances: MockPeerConnection[] = [];
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'complete';
  signalingState: RTCSignalingState = 'stable';
  remoteDescription: RTCSessionDescription | null = null;
  localDescription: RTCSessionDescription | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  pairs: Pairs = { old: 5 };
  selected = 'old';
  failStats = false;
  receivers: unknown[] = [];
  addTrack = vi.fn();
  addIceCandidate = vi.fn(async () => {});
  getReceivers = vi.fn(() => this.receivers);
  createOffer = vi.fn(
    async (_options?: RTCOfferOptions) =>
      ({ type: 'offer', sdp: 'offer' }) as RTCSessionDescriptionInit
  );
  createAnswer = vi.fn(
    async () => ({ type: 'answer', sdp: 'answer' }) as RTCSessionDescriptionInit
  );
  setRemoteDescription = vi.fn(async (d: RTCSessionDescriptionInit) => {
    this.remoteDescription = {
      ...d,
      toJSON: () => d,
    } as unknown as RTCSessionDescription;
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
  });
  setLocalDescription = vi.fn(async (d: RTCSessionDescriptionInit) => {
    this.localDescription = {
      ...d,
      toJSON: () => d,
    } as unknown as RTCSessionDescription;
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
  });
  getStats = vi.fn(async () => {
    if (this.failStats) throw new Error('no stats');
    const report = new Map<string, unknown>();
    for (const [id, responsesReceived] of Object.entries(this.pairs)) {
      report.set(id, { id, type: 'candidate-pair', responsesReceived });
    }
    report.set('T', {
      id: 'T',
      type: 'transport',
      selectedCandidatePairId: this.selected,
    });
    return report as unknown as RTCStatsReport;
  });
  close = vi.fn();

  constructor() {
    MockPeerConnection.instances.push(this);
  }

  become(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  /** The connection comes up and the peer's audio track arrives. */
  connect(): void {
    this.become('connected');
    this.ontrack?.({
      track: { kind: 'audio' },
      streams: [{}],
    } as unknown as RTCTrackEvent);
  }
}

const track = {
  kind: 'audio',
  enabled: true,
  readyState: 'live',
  stop: vi.fn(),
} as unknown as MediaStreamTrack;
const localStream = {
  getAudioTracks: () => [track],
  getTracks: () => [track],
} as unknown as MediaStream;

async function openTransport(offerer: boolean) {
  const states: string[] = [];
  const signals: DirectVoiceRtcSignal[] = [];
  const diagnostics: Array<[string, Record<string, unknown>]> = [];
  const transport = new DirectVoiceWebRtcTransport({
    offerer,
    getIceServers: async () => [{ urls: 'stun:example.test:3478' }],
    localStream,
    onSignal: (signal) => signals.push(signal),
    onRemoteStream: vi.fn(),
    onState: (state) => states.push(state),
    onDiagnostic: (stage, detail) => diagnostics.push([stage, detail]),
  });
  await transport.start();
  const pc = MockPeerConnection.instances[0]!;
  if (offerer) {
    const offer = signals.find((s) => s.kind === 'description')!;
    await transport.handleSignal({
      kind: 'description',
      generation: offer.generation,
      description: { type: 'answer', sdp: 'answer' },
    });
  } else {
    await transport.handleSignal({
      kind: 'description',
      generation: 'generation_first',
      description: { type: 'offer', sdp: 'offer' },
    });
  }
  pc.connect();
  expect(transport.isOpen()).toBe(true);
  signals.length = 0;
  states.length = 0;
  pc.createOffer.mockClear();
  const stage = (name: string) =>
    diagnostics.filter(([s]) => s === name).map(([, detail]) => detail);
  return { transport, pc, states, signals, stage };
}

const offers = (signals: DirectVoiceRtcSignal[]) =>
  signals.filter(
    (s) => s.kind === 'description' && s.description.type === 'offer'
  ).length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'RTCPeerConnection',
    MockPeerConnection as unknown as typeof RTCPeerConnection
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  MockPeerConnection.instances = [];
});

describe('DirectVoiceWebRtcTransport: a path that may be gone', () => {
  it('stops being open at once and restarts ICE 3 s later', async () => {
    const { transport, pc, states, signals, stage } = await openTransport(true);

    expect(transport.suspectPath('network-changed')).toBe(true);
    expect(transport.isOpen()).toBe(false);
    expect(states).toEqual(['recovering']);
    expect(stage('path-suspected')).toEqual([
      { reason: 'network-changed', wasOpen: true },
    ]);

    await vi.advanceTimersByTimeAsync(2_900);
    expect(offers(signals)).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(offers(signals)).toBe(1);
    expect(pc.createOffer).toHaveBeenCalledWith({ iceRestart: true });
    expect(MockPeerConnection.instances).toHaveLength(1);
    transport.close();
  });

  it('opens again on the new path, though WebRTC never called the old one lost', async () => {
    const { transport, pc, states, signals, stage } = await openTransport(true);
    transport.suspectPath('network-changed');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(offers(signals)).toBe(1);

    // Selected, but no check over it has been answered yet.
    pc.pairs = { old: 5, fresh: 0 };
    pc.selected = 'fresh';
    await vi.advanceTimersByTimeAsync(600);
    expect(transport.isOpen()).toBe(false);

    pc.pairs = { old: 5, fresh: 1 };
    await vi.advanceTimersByTimeAsync(600);
    expect(transport.isOpen()).toBe(true);
    expect(states[states.length - 1]).toBe('open');
    expect(stage('path-works')).toEqual([
      { afterMs: expect.any(Number), newPath: true },
    ]);

    // Nothing more: no second restart, no more stats.
    const looks = pc.getStats.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(offers(signals)).toBe(1);
    expect(pc.getStats.mock.calls.length).toBe(looks);
    transport.close();
  });

  it('opens again without a restart when the old path answers', async () => {
    const { transport, pc, signals, stage } = await openTransport(true);
    transport.suspectPath('rtp-silent');
    // Answers to checks sent before count for nothing, up to a second later.
    await vi.advanceTimersByTimeAsync(300);
    pc.pairs = { old: 6 };
    await vi.advanceTimersByTimeAsync(400);
    expect(transport.isOpen()).toBe(false);
    pc.pairs = { old: 7 };
    await vi.advanceTimersByTimeAsync(1_300);
    expect(transport.isOpen()).toBe(false);

    pc.pairs = { old: 8 };
    await vi.advanceTimersByTimeAsync(600);
    expect(transport.isOpen()).toBe(true);
    expect(stage('path-works')).toEqual([
      { afterMs: expect.any(Number), newPath: false },
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(offers(signals)).toBe(0);
    transport.close();
  });

  it('goes on restarting like for a lost connection while nothing answers', async () => {
    const { transport, pc, signals } = await openTransport(true);
    transport.suspectPath('network-changed');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(offers(signals)).toBe(1);
    await vi.advanceTimersByTimeAsync(6_100);
    expect(offers(signals)).toBe(2);
    // Two attempts, then the usual 30 s.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(offers(signals)).toBe(2);
    expect(transport.isOpen()).toBe(false);
    expect(pc.connectionState).toBe('connected');
    transport.close();
  });

  it("leaves it to WebRTC's own states once it has noticed", async () => {
    const { transport, pc, states, signals } = await openTransport(true);
    transport.suspectPath('network-changed');
    await vi.advanceTimersByTimeAsync(2_000);
    pc.become('disconnected');
    const looks = pc.getStats.mock.calls.length;
    // The restart still comes 3 s after the network changed, not later.
    await vi.advanceTimersByTimeAsync(1_100);
    expect(offers(signals)).toBe(1);
    expect(pc.getStats.mock.calls.length).toBe(looks);

    pc.become('connected');
    expect(transport.isOpen()).toBe(true);
    expect(states[states.length - 1]).toBe('open');
    transport.close();
  });

  it('a restart made before WebRTC noticed does not cost one later', async () => {
    const { transport, pc, signals } = await openTransport(true);
    // The far phone: RTP stops, and the peer is out of reach for 14 s.
    transport.suspectPath('rtp-silent');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(offers(signals)).toBe(1); // the extra one
    await vi.advanceTimersByTimeAsync(900);
    pc.become('disconnected');
    // From here as without it: 3 s, 6 s later, then the 30 s pause.
    await vi.advanceTimersByTimeAsync(2_900);
    expect(offers(signals)).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(offers(signals)).toBe(2);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(offers(signals)).toBe(3);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(offers(signals)).toBe(3);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(offers(signals)).toBe(4);
    transport.close();
  });

  it('a switch of network restarts ICE 3 s later, however recent the last one', async () => {
    const { transport, signals } = await openTransport(true);
    // No network at all for 4 s: RTP stops first, its restart is lost.
    transport.suspectPath('rtp-silent');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(offers(signals)).toBe(1);
    await vi.advanceTimersByTimeAsync(400);
    transport.suspectPath('network-changed');
    await vi.advanceTimersByTimeAsync(2_900);
    expect(offers(signals)).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(offers(signals)).toBe(2);
    transport.close();
  });

  it('restarts stay 6 s apart on the same network', async () => {
    const { transport, pc, signals } = await openTransport(true);
    transport.suspectPath('rtp-silent');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(offers(signals)).toBe(1);
    pc.pairs = { old: 5, fresh: 1 };
    pc.selected = 'fresh';
    await vi.advanceTimersByTimeAsync(600);
    expect(transport.isOpen()).toBe(true);
    transport.suspectPath('rtp-silent');
    await vi.advanceTimersByTimeAsync(5_200);
    expect(offers(signals)).toBe(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(offers(signals)).toBe(2);
    transport.close();
  });

  it('sends an answer again while the path is suspected', async () => {
    const { transport, pc, signals } = await openTransport(false);
    transport.suspectPath('network-changed');
    await transport.handleSignal({
      kind: 'description',
      generation: 'generation_second',
      description: { type: 'offer', sdp: 'restart' },
    });
    const answers = () =>
      signals.filter(
        (s) => s.kind === 'description' && s.description.type === 'answer'
      ).length;
    expect(answers()).toBe(1);
    // "connected" is still the old path.
    pc.iceConnectionState = 'connected';
    await vi.advanceTimersByTimeAsync(2_100);
    expect(transport.resendCurrentAnswer()).toBe(true);
    expect(answers()).toBe(2);
    pc.pairs = { old: 5, fresh: 2 };
    pc.selected = 'fresh';
    await vi.advanceTimersByTimeAsync(600);
    expect(transport.isOpen()).toBe(true);
    expect(transport.resendCurrentAnswer()).toBe(false);
    transport.close();
  });

  it('a track event does not open a suspected path', async () => {
    const { transport, pc } = await openTransport(true);
    transport.suspectPath('network-changed');
    pc.ontrack?.({
      track: { kind: 'audio' },
      streams: [{}],
    } as unknown as RTCTrackEvent);
    expect(transport.isOpen()).toBe(false);
    transport.close();
  });

  it("the answerer waits for the peer's restart and opens on its path", async () => {
    const { transport, pc, states, signals } = await openTransport(false);
    expect(transport.suspectPath('network-changed')).toBe(true);
    await vi.advanceTimersByTimeAsync(3_100);
    expect(offers(signals)).toBe(0);
    expect(states).toEqual(['recovering', 'connecting']);

    await transport.handleSignal({
      kind: 'description',
      generation: 'generation_second',
      description: { type: 'offer', sdp: 'restart' },
    });
    expect(
      signals.some(
        (s) => s.kind === 'description' && s.description.type === 'answer'
      )
    ).toBe(true);
    expect(transport.isOpen()).toBe(false);
    pc.pairs = { old: 5, fresh: 2 };
    pc.selected = 'fresh';
    await vi.advanceTimersByTimeAsync(600);
    expect(transport.isOpen()).toBe(true);
    transport.close();
  });

  it('does nothing before the first connection, after the end, or without stats', async () => {
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers: async () => [],
      localStream,
      onSignal: vi.fn(),
      onRemoteStream: vi.fn(),
    });
    expect(transport.suspectPath('network-changed')).toBe(false);
    await transport.start();
    expect(transport.suspectPath('network-changed')).toBe(false);
    transport.close();

    const opened = await (async () => {
      MockPeerConnection.instances = [];
      return openTransport(true);
    })();
    (opened.pc as unknown as { getStats?: unknown }).getStats = undefined;
    expect(opened.transport.suspectPath('network-changed')).toBe(false);
    expect(opened.transport.isOpen()).toBe(true);
    opened.transport.close();
    expect(opened.transport.suspectPath('network-changed')).toBe(false);
  });

  it('during a recovery only another switch of network matters', async () => {
    const { transport, pc, signals } = await openTransport(true);
    pc.become('disconnected');
    expect(transport.suspectPath('rtp-silent')).toBe(false);
    expect(transport.suspectPath('peer-on-reticulum')).toBe(false);
    // Both attempts are used up: the next would come after 30 s.
    await vi.advanceTimersByTimeAsync(3_100);
    await vi.advanceTimersByTimeAsync(6_100);
    expect(offers(signals)).toBe(2);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(offers(signals)).toBe(2);

    expect(transport.suspectPath('network-changed')).toBe(true);
    await vi.advanceTimersByTimeAsync(3_100);
    expect(offers(signals)).toBe(3);
    // A switch after that: two attempts for this network as well.
    expect(transport.suspectPath('network-changed')).toBe(true);
    await vi.advanceTimersByTimeAsync(9_200);
    expect(offers(signals)).toBe(5);
    // WebRTC decides when it is back: no stats are needed.
    expect(pc.getStats).not.toHaveBeenCalled();
    pc.become('connected');
    expect(transport.isOpen()).toBe(true);
    transport.close();
  });

  it('a second switch of network starts the checks over', async () => {
    const { transport, pc } = await openTransport(true);
    transport.suspectPath('network-changed');
    await vi.advanceTimersByTimeAsync(1_400);
    pc.pairs = { old: 6 };
    expect(transport.suspectPath('network-changed')).toBe(true);
    // That answer came before the second switch.
    await vi.advanceTimersByTimeAsync(1_400);
    expect(transport.isOpen()).toBe(false);
    pc.pairs = { old: 7 };
    await vi.advanceTimersByTimeAsync(600);
    expect(transport.isOpen()).toBe(true);
    transport.close();
  });

  it('survives stats that fail and stops looking when the call ends', async () => {
    const { transport, pc } = await openTransport(true);
    pc.failStats = true;
    transport.suspectPath('network-changed');
    await vi.advanceTimersByTimeAsync(1_600);
    pc.failStats = false;
    await vi.advanceTimersByTimeAsync(600);
    expect(transport.isOpen()).toBe(false);
    pc.pairs = { old: 6 };
    await vi.advanceTimersByTimeAsync(600);
    expect(transport.isOpen()).toBe(true);

    transport.suspectPath('network-changed');
    await vi.advanceTimersByTimeAsync(600);
    transport.close();
    expect(vi.getTimerCount()).toBe(0);
    const looks = pc.getStats.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pc.getStats.mock.calls.length).toBe(looks);
  });

  it('the peer is heard again: the next restart does not wait for the cooldown', async () => {
    const { transport, pc, signals, stage } = await openTransport(true);
    transport.suspectPath('rtp-silent');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(offers(signals)).toBe(1);
    pc.become('disconnected');
    await vi.advanceTimersByTimeAsync(9_100);
    // Two attempts for an outage that is not over; then 30 s of nothing.
    expect(offers(signals)).toBe(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(offers(signals)).toBe(3);

    expect(transport.peerHeardAgain()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(offers(signals)).toBe(4);
    expect(pc.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });
    expect(stage('peer-heard-again')).toEqual([{ attempts: 2 }]);

    // Not again and again: the attempts stay 6 s apart, however often.
    for (let i = 0; i < 5; i += 1) {
      expect(transport.peerHeardAgain()).toBe(i === 0);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(offers(signals)).toBe(4);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(offers(signals)).toBe(5);
    // And the usual limit counts from there.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(offers(signals)).toBe(6);
    transport.close();
  });

  it('hearing the peer changes nothing while nothing waits', async () => {
    const { transport, pc, signals } = await openTransport(true);
    // Open.
    expect(transport.peerHeardAgain()).toBe(false);
    // Lost, but nothing has been tried yet: the 3 s as ever.
    transport.suspectPath('network-changed');
    expect(transport.peerHeardAgain()).toBe(false);
    await vi.advanceTimersByTimeAsync(2_900);
    expect(offers(signals)).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(offers(signals)).toBe(1);
    expect(transport.peerHeardAgain()).toBe(true);
    // Connected again: no more restarts.
    pc.pairs = { old: 5, next: 1 };
    pc.selected = 'next';
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.isOpen()).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(offers(signals)).toBe(1);
    transport.suspectPath('rtp-silent');
    await vi.advanceTimersByTimeAsync(3_100);
    transport.close();
    expect(transport.peerHeardAgain()).toBe(false);

    // Before the first connection the peer is heard over Reticulum anyway.
    MockPeerConnection.instances = [];
    const fresh = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers: async () => [],
      localStream,
      onSignal: vi.fn(),
      onRemoteStream: vi.fn(),
    });
    await fresh.start();
    MockPeerConnection.instances[0]!.become('failed');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(MockPeerConnection.instances).toHaveLength(2);
    expect(fresh.peerHeardAgain()).toBe(false);
    fresh.close();
  });

  it("the answerer's peer restarts, so hearing it changes nothing", async () => {
    const { transport, pc } = await openTransport(false);
    pc.become('disconnected');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(transport.peerHeardAgain()).toBe(false);
    expect(pc.createOffer).not.toHaveBeenCalled();
    transport.close();
  });

  it('a connection that failed is replaced, without looking at the old one', async () => {
    const { transport, pc, signals } = await openTransport(true);
    transport.suspectPath('network-changed');
    pc.become('failed');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(MockPeerConnection.instances).toHaveLength(2);
    expect(offers(signals)).toBe(1);
    const looks = pc.getStats.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pc.getStats.mock.calls.length).toBe(looks);
    const next = MockPeerConnection.instances[1]!;
    expect(next.getStats).not.toHaveBeenCalled();
    next.connect();
    expect(transport.isOpen()).toBe(true);
    transport.close();
  });
});

describe('DirectVoiceWebRtcTransport.inboundAudioAgeMs', () => {
  const receiver = (timestamps: number[], kind = 'audio') => ({
    track: { kind },
    getSynchronizationSources: () =>
      timestamps.map((timestamp) => ({
        timestamp,
        source: 1,
        rtpTimestamp: 1,
      })),
  });

  it('is the age of the newest packet that was played', async () => {
    const { transport, pc } = await openTransport(true);
    const now = () => performance.timeOrigin + performance.now();
    pc.receivers = [
      receiver([now()], 'video'),
      receiver([now() - 900, now() - 250]),
    ];
    expect(transport.inboundAudioAgeMs()).toBeCloseTo(250, -1);
    // Played a moment ahead of this clock.
    pc.receivers = [receiver([now() + 20])];
    expect(transport.inboundAudioAgeMs()).toBe(0);
    transport.close();
  });

  it('tells no packets at all from not knowing', async () => {
    const { transport, pc } = await openTransport(true);
    pc.receivers = [receiver([])];
    expect(transport.inboundAudioAgeMs()).toBe(Infinity);
    pc.receivers = [{ track: { kind: 'audio' } }];
    expect(transport.inboundAudioAgeMs()).toBeNull();
    pc.receivers = [];
    expect(transport.inboundAudioAgeMs()).toBeNull();
    // Another clock (page time instead of the epoch): never taken for an age.
    pc.receivers = [receiver([performance.now()])];
    expect(transport.inboundAudioAgeMs()).toBeNull();
    pc.receivers = [receiver([Number.NaN])];
    expect(transport.inboundAudioAgeMs()).toBe(Infinity);
    transport.close();
    expect(transport.inboundAudioAgeMs()).toBeNull();
  });
});
