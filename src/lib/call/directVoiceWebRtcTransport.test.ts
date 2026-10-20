import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DirectVoiceWebRtcTransport,
  type DirectVoiceRtcSignal,
} from './directVoiceWebRtcTransport';

class MockPeerConnection {
  static instances: MockPeerConnection[] = [];
  static emitCandidateDuringSetLocal = false;
  static deferSetLocalDescription = false;
  static releaseSetLocalDescription: (() => void) | null = null;
  connectionState: RTCPeerConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'complete';
  signalingState: RTCSignalingState = 'stable';
  remoteDescription: RTCSessionDescription | null = null;
  localDescription: RTCSessionDescription | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  private eventListeners = new Map<string, Set<() => void>>();
  addTrack = vi.fn();
  replaceTrack = vi.fn(async () => {});
  getSenders = vi.fn(() => [
    {
      track: { kind: 'audio' },
      replaceTrack: this.replaceTrack,
    } as unknown as RTCRtpSender,
  ]);
  addIceCandidate = vi.fn(async () => {});
  createAnswer = vi.fn(
    async () => ({ type: 'answer', sdp: 'answer' }) as RTCSessionDescriptionInit
  );
  createOffer = vi.fn(
    async () => ({ type: 'offer', sdp: 'offer' }) as RTCSessionDescriptionInit
  );
  setRemoteDescription = vi.fn(
    async (description: RTCSessionDescriptionInit) => {
      this.remoteDescription = {
        type: description.type,
        sdp: description.sdp ?? '',
        toJSON: () => description,
      } as RTCSessionDescription;
      this.signalingState =
        description.type === 'offer' ? 'have-remote-offer' : 'stable';
    }
  );
  setLocalDescription = vi.fn(
    async (description: RTCSessionDescriptionInit) => {
      if (MockPeerConnection.emitCandidateDuringSetLocal) {
        this.onicecandidate?.({
          candidate: {
            type: 'host',
            protocol: 'udp',
            toJSON: () => ({
              candidate: 'candidate:1 1 UDP 1 127.0.0.1 9 typ host',
            }),
          } as RTCIceCandidate,
        } as RTCPeerConnectionIceEvent);
      }
      this.localDescription = {
        type: description.type,
        sdp: description.sdp ?? '',
        toJSON: () => description,
      } as RTCSessionDescription;
      this.signalingState =
        description.type === 'offer' ? 'have-local-offer' : 'stable';
      if (MockPeerConnection.deferSetLocalDescription) {
        await new Promise<void>((resolve) => {
          MockPeerConnection.releaseSetLocalDescription = resolve;
        });
      }
    }
  );
  setConfiguration = vi.fn();
  getConfiguration = vi.fn(() => ({ iceServers: [] }));
  addEventListener = vi.fn((type: string, listener: () => void) => {
    const listeners = this.eventListeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.eventListeners.set(type, listeners);
  });
  removeEventListener = vi.fn((type: string, listener: () => void) => {
    this.eventListeners.get(type)?.delete(listener);
  });
  emitEvent(type: string): void {
    for (const listener of this.eventListeners.get(type) ?? []) listener();
  }
  close = vi.fn();

  constructor(_configuration?: RTCConfiguration) {
    MockPeerConnection.instances.push(this);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  MockPeerConnection.instances = [];
  MockPeerConnection.emitCandidateDuringSetLocal = false;
  MockPeerConnection.deferSetLocalDescription = false;
  MockPeerConnection.releaseSetLocalDescription = null;
});

describe('DirectVoiceWebRtcTransport', () => {
  const audioTrack = {
    id: 'mic-track',
    kind: 'audio',
    enabled: true,
    readyState: 'live',
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
  const localStream = {
    getAudioTracks: () => [audioTrack],
    getTracks: () => [audioTrack],
  } as unknown as MediaStream;

  it('keeps a candidate that arrives before its offer', async () => {
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const transport = new DirectVoiceWebRtcTransport({
      offerer: false,
      getIceServers: async () => [{ urls: 'stun:example.test:3478' }],
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });
    await transport.start();

    const candidate = {
      candidate: 'candidate:1 1 UDP 1 127.0.0.1 9 typ host',
    };
    await transport.handleSignal({
      kind: 'ice',
      generation: 'generation_1234',
      candidate,
    });
    await transport.handleSignal({
      kind: 'description',
      generation: 'generation_1234',
      description: { type: 'offer', sdp: 'offer' },
    });

    const pc = MockPeerConnection.instances[0]!;
    expect(pc.setRemoteDescription).toHaveBeenCalledOnce();
    expect(pc.addTrack).toHaveBeenCalledWith(audioTrack, localStream);
    expect(pc.addIceCandidate).toHaveBeenCalledWith(candidate);
    expect(emitted).toContainEqual({
      kind: 'description',
      generation: 'generation_1234',
      description: { type: 'answer', sdp: 'answer' },
    });
    transport.close();
  });

  it('applies every candidate in an authenticated candidate batch', async () => {
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const transport = new DirectVoiceWebRtcTransport({
      offerer: false,
      getIceServers: async () => [],
      localStream,
      onSignal: vi.fn(),
      onRemoteStream: vi.fn(),
    });
    await transport.start();
    await transport.handleSignal({
      kind: 'description',
      generation: 'generation_batch',
      description: { type: 'offer', sdp: 'offer' },
    });
    await transport.handleSignal({
      kind: 'ice-candidates',
      generation: 'generation_batch',
      candidates: [{ candidate: 'candidate-1' }, { candidate: 'candidate-2' }],
    });

    expect(
      MockPeerConnection.instances[0]!.addIceCandidate
    ).toHaveBeenCalledTimes(2);
    transport.close();
  });

  it('does not let a retired offer generation replace the current one', async () => {
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const transport = new DirectVoiceWebRtcTransport({
      offerer: false,
      getIceServers: async () => [],
      localStream,
      onSignal: vi.fn(),
      onRemoteStream: vi.fn(),
    });
    await transport.start();
    const offer = (generation: string) =>
      transport.handleSignal({
        kind: 'description' as const,
        generation,
        description: { type: 'offer' as const, sdp: generation },
      });
    await offer('generation_old');
    await offer('generation_new');
    await offer('generation_old');

    expect(
      MockPeerConnection.instances[0]!.setRemoteDescription
    ).toHaveBeenCalledTimes(2);
    transport.close();
  });

  it('opens native media when the peer connection connects', async () => {
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const onState = vi.fn();
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers: async () => [],
      localStream,
      onSignal: vi.fn(),
      onRemoteStream: vi.fn(),
      onState,
    });

    await transport.start();
    const pc = MockPeerConnection.instances[0]!;
    pc.connectionState = 'connected';
    pc.onconnectionstatechange?.();

    expect(transport.isOpen()).toBe(false);

    pc.ontrack?.({
      track: { kind: 'audio' } as MediaStreamTrack,
      streams: [{} as MediaStream],
    } as RTCTrackEvent);

    expect(transport.isOpen()).toBe(true);
    expect(onState).toHaveBeenLastCalledWith('open');
    transport.close();
  });

  it('delivers the remote stream and replaces the microphone track', async () => {
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const previousTrack = {
      id: 'previous-mic',
      kind: 'audio',
      enabled: true,
      readyState: 'live',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const previousStream = {
      getAudioTracks: () => [previousTrack],
      getTracks: () => [previousTrack],
    } as unknown as MediaStream;
    const nextTrack = {
      id: 'next-mic',
      kind: 'audio',
      enabled: true,
      readyState: 'live',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const nextStream = {
      getAudioTracks: () => [nextTrack],
      getTracks: () => [nextTrack],
    } as unknown as MediaStream;
    const remoteTrack = { kind: 'audio' } as MediaStreamTrack;
    const remoteStream = {} as MediaStream;
    const onRemoteStream = vi.fn();
    const transport = new DirectVoiceWebRtcTransport({
      offerer: false,
      getIceServers: async () => [],
      localStream: previousStream,
      onSignal: vi.fn(),
      onRemoteStream,
    });

    await transport.start();
    const pc = MockPeerConnection.instances[0]!;
    pc.ontrack?.({
      track: remoteTrack,
      streams: [remoteStream],
    } as RTCTrackEvent);
    await transport.replaceLocalStream(nextStream);

    expect(onRemoteStream).toHaveBeenCalledWith(remoteStream);
    expect(pc.replaceTrack).toHaveBeenCalledWith(nextTrack);
    expect(previousTrack.stop).toHaveBeenCalledOnce();
    transport.close();
  });

  it('retries recovery when a restart offer receives no answer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers: async () => [],
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });

    await transport.start();
    const pc = MockPeerConnection.instances[0]!;
    pc.connectionState = 'connected';
    pc.ontrack?.({
      track: { kind: 'audio' } as MediaStreamTrack,
      streams: [{} as MediaStream],
    } as RTCTrackEvent);
    pc.onconnectionstatechange?.();
    expect(transport.isOpen()).toBe(true);

    pc.connectionState = 'disconnected';
    pc.onconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(pc.createOffer).toHaveBeenCalledTimes(2);
    expect(pc.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });

    // No answer and no further connection-state event: the watchdog must
    // still produce another restart attempt rather than remaining on the
    // Reticulum fallback forever.
    await vi.advanceTimersByTimeAsync(6_000);
    expect(pc.createOffer).toHaveBeenCalledTimes(3);
    expect(
      emitted.filter(
        (signal) =>
          signal.kind === 'description' && signal.description.type === 'offer'
      )
    ).toHaveLength(3);

    transport.close();
  });

  it('cancels the recovery watchdog after WebRTC reconnects', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers: async () => [],
      localStream,
      onSignal: vi.fn(),
      onRemoteStream: vi.fn(),
    });

    await transport.start();
    const pc = MockPeerConnection.instances[0]!;
    pc.connectionState = 'connected';
    pc.ontrack?.({
      track: { kind: 'audio' } as MediaStreamTrack,
      streams: [{} as MediaStream],
    } as RTCTrackEvent);
    pc.onconnectionstatechange?.();

    pc.connectionState = 'disconnected';
    pc.onconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(pc.createOffer).toHaveBeenCalledTimes(2);

    pc.connectionState = 'connected';
    pc.onconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(transport.isOpen()).toBe(true);
    expect(pc.createOffer).toHaveBeenCalledTimes(2);
    transport.close();
  });

  it('adopts late ICE servers and requests a bounded restart from the offerer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const getIceServers = vi
      .fn<() => Promise<RTCIceServer[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ urls: 'stun:community.test:3478' }]);
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers,
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });

    await transport.start();
    const pc = MockPeerConnection.instances[0]!;
    const firstOffer = emitted.find(
      (signal) =>
        signal.kind === 'description' && signal.description.type === 'offer'
    );
    expect(firstOffer?.kind).toBe('description');

    await vi.advanceTimersByTimeAsync(750);
    expect(pc.setConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        iceServers: [{ urls: 'stun:community.test:3478' }],
      })
    );
    // The first offer is still outstanding, so the refresh waits for a stable
    // signaling state instead of causing offer glare.
    expect(pc.createOffer).toHaveBeenCalledTimes(1);

    await transport.handleSignal({
      kind: 'description',
      generation: firstOffer!.generation,
      description: { type: 'answer', sdp: 'answer' },
    });
    expect(pc.createOffer).toHaveBeenCalledTimes(2);
    expect(pc.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });
    transport.close();
  });

  it('asks the offerer to restart when the answerer discovers ICE servers late', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const getIceServers = vi
      .fn<() => Promise<RTCIceServer[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ urls: 'stun:community.test:3478' }]);
    const transport = new DirectVoiceWebRtcTransport({
      offerer: false,
      getIceServers,
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });

    await transport.start();
    await transport.handleSignal({
      kind: 'description',
      generation: 'generation_1234',
      description: { type: 'offer', sdp: 'offer' },
    });
    await vi.advanceTimersByTimeAsync(750);

    expect(emitted).toContainEqual({
      kind: 'ice-refresh-request',
      generation: 'generation_1234',
    });
    transport.close();
  });

  it('signals an answer before a refresh that arrives while the answer is pending', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const getIceServers = vi
      .fn<() => Promise<RTCIceServer[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ urls: 'stun:community.test:3478' }]);
    const transport = new DirectVoiceWebRtcTransport({
      offerer: false,
      getIceServers,
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });

    await transport.start();
    MockPeerConnection.deferSetLocalDescription = true;
    const handling = transport.handleSignal({
      kind: 'description',
      generation: 'generation_1234',
      description: { type: 'offer', sdp: 'offer' },
    });
    await vi.waitFor(() => {
      expect(MockPeerConnection.releaseSetLocalDescription).toBeTypeOf(
        'function'
      );
    });
    await vi.advanceTimersByTimeAsync(750);
    MockPeerConnection.releaseSetLocalDescription?.();
    await handling;

    expect(emitted.map((signal) => signal.kind)).toEqual([
      'description',
      'ice-refresh-request',
    ]);
    transport.close();
  });

  it('keeps bounded recovery available when a proactive restart fails', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const getIceServers = vi
      .fn<() => Promise<RTCIceServer[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ urls: 'stun:community.test:3478' }]);
    const emitted: DirectVoiceRtcSignal[] = [];
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers,
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });

    await transport.start();
    const pc = MockPeerConnection.instances[0]!;
    const initialOffer = emitted.find(
      (signal) =>
        signal.kind === 'description' && signal.description.type === 'offer'
    );
    expect(initialOffer?.kind).toBe('description');
    await vi.advanceTimersByTimeAsync(750);
    pc.createOffer.mockRejectedValueOnce(new Error('restart-failed'));
    await expect(
      transport.handleSignal({
        kind: 'description',
        generation: initialOffer!.generation,
        description: { type: 'answer', sdp: 'answer' },
      })
    ).rejects.toThrow('restart-failed');

    await vi.advanceTimersByTimeAsync(3_000);
    expect(pc.createOffer).toHaveBeenCalledTimes(3);
    transport.close();
  });

  it('signals candidates gathered during local description setup after SDP', async () => {
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers: async () => [{ urls: 'stun:example.test:3478' }],
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });
    MockPeerConnection.emitCandidateDuringSetLocal = true;
    await transport.start();
    expect(emitted.map((signal) => signal.kind)).toEqual([
      'description',
      'ice-candidates',
    ]);
    expect(emitted[1]).toMatchObject({
      kind: 'ice-candidates',
      candidates: [{ candidate: 'candidate:1 1 UDP 1 127.0.0.1 9 typ host' }],
    });
    transport.close();
  });

  it('signals SDP promptly and batches candidates gathered later', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers: async () => [{ urls: 'stun:example.test:3478' }],
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });

    MockPeerConnection.deferSetLocalDescription = true;
    const startPromise = transport.start();
    await vi.advanceTimersByTimeAsync(0);
    const pc = MockPeerConnection.instances[0]!;
    pc.iceGatheringState = 'gathering';
    pc.onicecandidate?.({
      candidate: {
        type: 'srflx',
        protocol: 'udp',
        toJSON: () => ({
          candidate: 'candidate:1 1 UDP 1 203.0.113.1 5000 typ srflx',
        }),
      } as RTCIceCandidate,
    } as RTCPeerConnectionIceEvent);
    expect(emitted).toEqual([]);
    MockPeerConnection.releaseSetLocalDescription?.();
    await vi.advanceTimersByTimeAsync(0);

    await startPromise;
    expect(emitted.map((signal) => signal.kind)).toEqual([
      'description',
      'ice-candidates',
    ]);

    pc.onicecandidate?.({
      candidate: {
        type: 'relay',
        protocol: 'udp',
        toJSON: () => ({
          candidate: 'candidate:2 1 UDP 1 203.0.113.2 5001 typ relay',
        }),
      } as RTCIceCandidate,
    } as RTCPeerConnectionIceEvent);
    await vi.advanceTimersByTimeAsync(75);
    expect(emitted.map((signal) => signal.kind)).toEqual([
      'description',
      'ice-candidates',
      'ice-candidates',
    ]);
    transport.close();
  });

  it('does not delay SDP when ICE gathering never completes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers: async () => [{ urls: 'stun:unresponsive.test:3478' }],
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });

    MockPeerConnection.deferSetLocalDescription = true;
    const startPromise = transport.start();
    await vi.advanceTimersByTimeAsync(0);
    const pc = MockPeerConnection.instances[0]!;
    pc.iceGatheringState = 'gathering';
    MockPeerConnection.releaseSetLocalDescription?.();
    await startPromise;
    expect(emitted.map((signal) => signal.kind)).toEqual(['description']);

    pc.onicecandidate?.({
      candidate: {
        type: 'host',
        protocol: 'udp',
        toJSON: () => ({
          candidate: 'candidate:3 1 UDP 1 192.0.2.1 5002 typ host',
        }),
      } as RTCIceCandidate,
    } as RTCPeerConnectionIceEvent);
    await vi.advanceTimersByTimeAsync(75);
    expect(emitted.map((signal) => signal.kind)).toEqual([
      'description',
      'ice-candidates',
    ]);
    transport.close();
  });
});

// GO opt-in recovery of a lost offer / answer. On a slow mobile uplink the
// offer bundle can miss the Hub's 20 s signal TTL; nothing re-offered an
// offer that was never answered, so WebRTC stayed "connecting" all call.
describe('DirectVoiceWebRtcTransport unanswered offer / answer recovery', () => {
  const audioTrack = {
    id: 'mic-track',
    kind: 'audio',
    enabled: true,
    readyState: 'live',
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
  const localStream = {
    getAudioTracks: () => [audioTrack],
    getTracks: () => [audioTrack],
  } as unknown as MediaStream;

  type Diagnostic = [string, Record<string, unknown>];

  function offerer(unansweredOfferRetryDelaysMs?: readonly number[]) {
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const diagnostics: Diagnostic[] = [];
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers: async () => [{ urls: 'stun:stun.example.test:3478' }],
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
      onDiagnostic: (stage, detail) => diagnostics.push([stage, detail]),
      ...(unansweredOfferRetryDelaysMs ? { unansweredOfferRetryDelaysMs } : {}),
    });
    const offers = () =>
      emitted.filter(
        (
          signal
        ): signal is Extract<DirectVoiceRtcSignal, { kind: 'description' }> =>
          signal.kind === 'description' && signal.description.type === 'offer'
      );
    const stages = (stage: string) =>
      diagnostics
        .filter(([name]) => name === stage)
        .map(([, detail]) => detail);
    return { transport, emitted, diagnostics, offers, stages };
  }

  function answerer() {
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const diagnostics: Diagnostic[] = [];
    const transport = new DirectVoiceWebRtcTransport({
      offerer: false,
      getIceServers: async () => [{ urls: 'stun:stun.example.test:3478' }],
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
      onDiagnostic: (stage, detail) => diagnostics.push([stage, detail]),
    });
    const answers = () =>
      emitted.filter(
        (
          signal
        ): signal is Extract<DirectVoiceRtcSignal, { kind: 'description' }> =>
          signal.kind === 'description' && signal.description.type === 'answer'
      );
    const stages = (stage: string) =>
      diagnostics
        .filter(([name]) => name === stage)
        .map(([, detail]) => detail);
    return { transport, emitted, diagnostics, answers, stages };
  }

  it('leaves an unanswered offer alone unless opted in (desktop parity)', async () => {
    vi.useFakeTimers();
    const { transport, offers, diagnostics } = offerer();
    await transport.start();
    await vi.advanceTimersByTimeAsync(180_000);

    expect(offers()).toHaveLength(1);
    expect(MockPeerConnection.instances[0]!.createOffer).toHaveBeenCalledOnce();
    expect(
      diagnostics.filter(([stage]) => stage.startsWith('offer-unanswered'))
    ).toEqual([]);
    transport.close();
  });

  it('re-offers with an ICE restart on the configured delays, then gives up', async () => {
    vi.useFakeTimers();
    const { transport, offers, stages } = offerer([20_000, 30_000, 45_000]);
    await transport.start();
    const pc = MockPeerConnection.instances[0]!;
    expect(offers()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(19_999);
    expect(offers()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(offers()).toHaveLength(2);
    expect(pc.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });
    expect(offers()[1]!.generation).not.toBe(offers()[0]!.generation);
    expect(stages('offer-unanswered-retry')).toEqual([
      { attempt: 1, reason: 'timer', waitedMs: 20_000 },
    ]);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(offers()).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(offers()).toHaveLength(4);
    expect(stages('offer-unanswered-gave-up')).toEqual([]);

    // One more wait of the last delay, then it stops for good.
    await vi.advanceTimersByTimeAsync(45_000);
    expect(stages('offer-unanswered-gave-up')).toEqual([
      { retries: 3, reason: 'timer' },
    ]);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(offers()).toHaveLength(4);
    expect(new Set(offers().map((offer) => offer.generation)).size).toBe(4);
    // Same peer connection throughout: a re-offer, not a new call leg.
    expect(MockPeerConnection.instances).toHaveLength(1);
    transport.close();
  });

  it('stops once the answer for the current generation is applied', async () => {
    vi.useFakeTimers();
    const { transport, offers, stages } = offerer([20_000, 30_000]);
    await transport.start();
    const pc = MockPeerConnection.instances[0]!;
    await vi.advanceTimersByTimeAsync(20_000);
    const [first, second] = offers();
    expect(second).toBeDefined();

    // A late answer for the retired offer is ignored...
    await transport.handleSignal({
      kind: 'description',
      generation: first!.generation,
      description: { type: 'answer', sdp: 'late-answer' },
    });
    expect(pc.setRemoteDescription).not.toHaveBeenCalled();
    // ...the one for the current offer is applied and ends the retries.
    await transport.handleSignal({
      kind: 'description',
      generation: second!.generation,
      description: { type: 'answer', sdp: 'answer' },
    });
    expect(pc.setRemoteDescription).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(offers()).toHaveLength(2);
    expect(stages('offer-unanswered-gave-up')).toEqual([]);
    expect(transport.retryUnansweredOffer('bundle-failed')).toBe(false);
    transport.close();
  });

  it('stops when the connection comes up and when the transport closes', async () => {
    vi.useFakeTimers();
    const connected = offerer([20_000]);
    await connected.transport.start();
    const pc = MockPeerConnection.instances[0]!;
    pc.connectionState = 'connected';
    pc.onconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(connected.offers()).toHaveLength(1);
    connected.transport.close();

    const closed = offerer([20_000]);
    await closed.transport.start();
    closed.transport.close();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(closed.offers()).toHaveLength(1);
    expect(closed.transport.retryUnansweredOffer('bundle-failed')).toBe(false);
  });

  it('retryUnansweredOffer re-offers at once and spaced, without using up the timer steps', async () => {
    vi.useFakeTimers();
    const { transport, offers, stages } = offerer([20_000, 30_000]);
    await transport.start();

    // Right after the offer: deferred to 2 s after it, not sent twice.
    expect(transport.retryUnansweredOffer('bundle-failed')).toBe(true);
    expect(transport.retryUnansweredOffer('bundle-failed')).toBe(true);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(offers()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(offers()).toHaveLength(2);
    expect(stages('offer-unanswered-retry')).toEqual([
      { attempt: 1, reason: 'bundle-failed', waitedMs: 2_000 },
    ]);

    // Later: immediate (t = 7 s).
    await vi.advanceTimersByTimeAsync(5_000);
    expect(transport.retryUnansweredOffer('bundle-failed')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(offers()).toHaveLength(3);
    expect(stages('offer-unanswered-retry')[1]).toEqual({
      attempt: 2,
      reason: 'bundle-failed',
      waitedMs: 0,
    });

    // The timer still has both of its steps, counted from the newest offer:
    // 20 s after the t = 7 s re-offer...
    await vi.advanceTimersByTimeAsync(19_999);
    expect(offers()).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(offers()).toHaveLength(4);
    expect(stages('offer-unanswered-retry')[2]).toEqual({
      attempt: 3,
      reason: 'timer',
      waitedMs: 20_000,
    });
    // ...then 30 s, then one last wait of 30 s before it gives up.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(offers()).toHaveLength(5);
    expect(stages('offer-unanswered-gave-up')).toEqual([]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(stages('offer-unanswered-gave-up')).toEqual([
      { retries: 4, reason: 'timer' },
    ]);
    expect(transport.retryUnansweredOffer('bundle-failed')).toBe(false);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(offers()).toHaveLength(5);
    transport.close();
  });

  it('a burst of failed offer bundles keeps the slow timer for later (bad-uplink window)', async () => {
    vi.useFakeTimers();
    const { transport, offers, stages } = offerer([20_000, 30_000, 45_000]);
    await transport.start();
    // Every offer is reported lost soon after it is sent, for as long as
    // the caller keeps asking: own cap of 5, then false (timer goes on).
    const acted: boolean[] = [];
    for (let i = 0; i < 7; i += 1) {
      await vi.advanceTimersByTimeAsync(3_000);
      acted.push(transport.retryUnansweredOffer('bundle-failed'));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(acted).toEqual([true, true, true, true, true, false, false]);
    expect(offers()).toHaveLength(6);
    expect(stages('offer-unanswered-gave-up')).toEqual([]);

    // Last fast re-offer at t = 15 s; the timer's three steps all follow it.
    const at = (ms: number) => vi.advanceTimersByTimeAsync(ms);
    await at(20_000 - 6_000 - 1); // t = 34.999 s
    expect(offers()).toHaveLength(6);
    await at(1); // t = 35 s
    expect(offers()).toHaveLength(7);
    await at(30_000); // t = 65 s
    expect(offers()).toHaveLength(8);
    await at(45_000); // t = 110 s
    expect(offers()).toHaveLength(9);
    expect(
      stages('offer-unanswered-retry').map((detail) => detail.reason)
    ).toEqual([
      'bundle-failed',
      'bundle-failed',
      'bundle-failed',
      'bundle-failed',
      'bundle-failed',
      'timer',
      'timer',
      'timer',
    ]);
    await at(45_000);
    expect(stages('offer-unanswered-gave-up')).toEqual([
      { retries: 8, reason: 'timer' },
    ]);
    transport.close();
  });

  it('retryUnansweredOffer is bounded without configured delays too', async () => {
    vi.useFakeTimers();
    const { transport, offers, stages } = offerer();
    await transport.start();
    for (let i = 0; i < 8; i += 1) {
      await vi.advanceTimersByTimeAsync(3_000);
      transport.retryUnansweredOffer('bundle-failed');
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(offers()).toHaveLength(6);
    expect(stages('offer-unanswered-gave-up')).toEqual([
      { retries: 5, reason: 'bundle-failed' },
    ]);
    transport.close();
  });

  it('retryUnansweredOffer does nothing on the answerer', async () => {
    vi.useFakeTimers();
    const { transport, emitted } = answerer();
    await transport.start();
    await transport.handleSignal({
      kind: 'description',
      generation: 'generation_hub',
      description: { type: 'offer', sdp: 'offer' },
    });
    expect(transport.retryUnansweredOffer('bundle-failed')).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(
      emitted.filter((signal) => signal.kind === 'description')
    ).toHaveLength(1);
    transport.close();
  });

  it('resendCurrentAnswer re-signals the same answer until ICE connects', async () => {
    vi.useFakeTimers();
    const { transport, answers, stages } = answerer();
    await transport.start();
    expect(transport.resendCurrentAnswer()).toBe(false); // no answer yet
    await transport.handleSignal({
      kind: 'description',
      generation: 'generation_hub',
      description: { type: 'offer', sdp: 'offer' },
    });
    expect(answers()).toHaveLength(1);

    // Spaced 2 s after the first copy.
    expect(transport.resendCurrentAnswer()).toBe(true);
    expect(transport.resendCurrentAnswer()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(answers()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(answers()).toHaveLength(2);
    expect(answers()[1]).toEqual(answers()[0]);
    expect(answers()[1]!.generation).toBe('generation_hub');
    expect(stages('answer-resent')).toEqual([
      expect.objectContaining({ attempt: 1, waitedMs: 2_000 }),
    ]);

    // Bounded per generation.
    for (let i = 0; i < 6; i += 1) {
      await vi.advanceTimersByTimeAsync(2_000);
      transport.resendCurrentAnswer('bundle-failed');
    }
    expect(answers()).toHaveLength(5);

    // A new offer generation gets a fresh budget; a connection ends it.
    await transport.handleSignal({
      kind: 'description',
      generation: 'generation_hub_2',
      description: { type: 'offer', sdp: 'offer-2' },
    });
    expect(answers()).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(transport.resendCurrentAnswer('bundle-failed')).toBe(true);
    expect(answers()).toHaveLength(7);
    expect(answers()[6]!.generation).toBe('generation_hub_2');
    const pc = MockPeerConnection.instances[0]!;
    pc.connectionState = 'connected';
    pc.onconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(transport.resendCurrentAnswer('bundle-failed')).toBe(false);
    transport.close();
  });

  it('resendCurrentAnswer follows a new offer generation', async () => {
    vi.useFakeTimers();
    const { transport, answers } = answerer();
    await transport.start();
    const offer = (generation: string) =>
      transport.handleSignal({
        kind: 'description',
        generation,
        description: { type: 'offer', sdp: generation },
      });
    await offer('generation_one');
    expect(transport.resendCurrentAnswer('bundle-failed')).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    // The Hub re-offers before the deferred copy went out.
    await offer('generation_two');
    expect(transport.resendCurrentAnswer('bundle-failed')).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(answers().map((answer) => answer.generation)).toEqual([
      'generation_one',
      'generation_two',
      'generation_two',
    ]);
    transport.close();
  });

  it('resendCurrentAnswer does nothing on the offerer', async () => {
    vi.useFakeTimers();
    const { transport, offers } = offerer([20_000]);
    await transport.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(transport.resendCurrentAnswer()).toBe(false);
    expect(offers()).toHaveLength(1);
    transport.close();
  });
});
