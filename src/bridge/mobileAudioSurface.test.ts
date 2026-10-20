import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AudioSurfaceCommand,
  AudioSurfaceEvent,
} from '../lib/group-call/audioSurfaceBridge';
import { encodeAudioPacketV2 } from '../lib/group-call/audioPacketCodec';

const h = vi.hoisted(() => {
  const state = { native: true };

  /** One capture source: a track and its clones share it. */
  type FakeSource = { tracks: Set<FakeTrack> };

  class FakeTrack {
    static count = 0;
    kind = 'audio';
    enabled = true;
    readyState: 'live' | 'ended' = 'live';
    id: string;
    source: FakeSource;
    listeners = new Map<string, Set<(event: unknown) => void>>();
    constructor(source?: FakeSource) {
      FakeTrack.count += 1;
      this.id = `track-${FakeTrack.count}`;
      this.source = source ?? { tracks: new Set() };
      this.source.tracks.add(this);
    }
    clone() {
      const t = new FakeTrack(this.source);
      t.enabled = this.enabled;
      return t;
    }
    /** Like browsers: stop() fires no 'ended'. */
    stop() {
      this.readyState = 'ended';
    }
    addEventListener(type: string, cb: (event: unknown) => void) {
      const set = this.listeners.get(type) ?? new Set();
      set.add(cb);
      this.listeners.set(type, set);
    }
    removeEventListener(type: string, cb: (event: unknown) => void) {
      this.listeners.get(type)?.delete(cb);
    }
    /** The capture source dies: every live track on it ends with 'ended'. */
    endSource() {
      for (const t of [...this.source.tracks]) {
        if (t.readyState === 'ended') continue;
        t.readyState = 'ended';
        for (const cb of [...(t.listeners.get('ended') ?? [])]) {
          cb({ type: 'ended' });
        }
      }
    }
  }

  class FakeMediaStream {
    tracks: FakeTrack[];
    constructor(tracks: FakeTrack[] = []) {
      this.tracks = [...tracks];
    }
    getTracks() {
      return [...this.tracks];
    }
    getAudioTracks() {
      return this.tracks.filter((t) => t.kind === 'audio');
    }
  }

  type TransportOptions = {
    offerer: boolean;
    getIceServers: () => Promise<RTCIceServer[]>;
    localStream: FakeMediaStream;
    onSignal: (signal: unknown) => void;
    onRemoteStream: (stream: unknown) => void;
    onState?: (state: string) => void;
    onDiagnostic?: (stage: string, detail: Record<string, unknown>) => void;
  };

  class FakeTransport {
    static instances: FakeTransport[] = [];
    options: TransportOptions & { unansweredOfferRetryDelaysMs?: number[] };
    started = 0;
    closed = false;
    open = false;
    signals: unknown[] = [];
    /** Streams given to replaceLocalStream (mic restart). */
    replaced: FakeMediaStream[] = [];
    /** Next replaceLocalStream throws this (e.g. sender missing). */
    failReplace: string | null = null;
    /** Track A's GO-only methods (feature-detected by the surface). */
    retryUnansweredOffer?: ReturnType<typeof vi.fn>;
    resendCurrentAnswer?: ReturnType<typeof vi.fn>;
    constructor(options: TransportOptions) {
      this.options = options;
      this.retryUnansweredOffer = vi.fn(() => true);
      this.resendCurrentAnswer = vi.fn(() => true);
      FakeTransport.instances.push(this);
    }
    async start() {
      this.started += 1;
    }
    isOpen() {
      return this.open && !this.closed;
    }
    setMuted(muted: boolean) {
      for (const t of this.options.localStream.getAudioTracks()) {
        t.enabled = !muted;
      }
    }
    async handleSignal(signal: unknown) {
      this.signals.push(signal);
    }
    /** Like the real transport: replaceTrack, then stop the old stream. */
    async replaceLocalStream(stream: FakeMediaStream) {
      this.replaced.push(stream);
      if (this.closed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (this.failReplace) {
        const message = this.failReplace;
        this.failReplace = null;
        stream.getTracks().forEach((t) => t.stop());
        throw new Error(message);
      }
      const previous = this.options.localStream;
      this.options.localStream = stream;
      previous.getTracks().forEach((t) => t.stop());
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.options.onState?.('closed');
    }
  }

  class FakeRuntime {
    static instances: FakeRuntime[] = [];
    commands: Array<{ type: string }> = [];
    listener: ((event: unknown) => void) | null = null;
    /** Events the next handleCommand emits before it answers. */
    emitDuringCommand: unknown[] = [];
    // The members applyGoGroupRtcTransportPolicy wraps (the real runtime's
    // private group WebRTC edge handling).
    groupRtcTransports = new Map<string, { isOpen(): boolean }>();
    syncCalls = 0;
    /** The real runtime's sender diagnostics (GO's Copy diagnostics). */
    senderDiagnostics: Record<string, unknown> | (() => never) = {
      hasMicStream: true,
      micTracks: [{ enabled: true, muted: false, readyState: 'live' }],
      hasCaptureNode: true,
      senderEncodeSummary: { mode: 'worker-direct' },
    };
    senderEngine = {
      getDiagnosticsSnapshot: () =>
        typeof this.senderDiagnostics === 'function'
          ? this.senderDiagnostics()
          : this.senderDiagnostics,
    };
    constructor() {
      FakeRuntime.instances.push(this);
    }
    onEvent(cb: (event: unknown) => void) {
      this.listener = cb;
      return () => {
        this.listener = null;
      };
    }
    emit(event: unknown) {
      this.listener?.(event);
    }
    start() {}
    dispose() {}
    async handleCommand(command: { type: string }) {
      this.commands.push(command);
      const pending = this.emitDuringCommand.splice(0);
      for (const event of pending) this.emit(event);
      return { ok: true };
    }
    createGroupRtcTransport() {
      return { isOpen: () => false };
    }
    async syncGroupRtcTransports() {
      this.syncCalls += 1;
    }
    async sendGroupRtcSignal() {}
    closeGroupRtcTransport(peer: string) {
      this.groupRtcTransports.delete(peer);
    }
  }

  /**
   * Models CallAudioRouter: owners, the kind's default (1:1 earpiece, group
   * loudspeaker), a hand-picked route, a headset that wins over the
   * earpiece/loudspeaker choice, and 'audioRouteChanged' listeners.
   */
  const native = {
    owners: new Set<string>(),
    kind: 'dm',
    builtin: 'earpiece' as 'earpiece' | 'speaker',
    explicit: null as string | null,
    headset: null as null | 'wired' | 'bluetooth',
    /** More state for every answer, e.g. a phone call's focus / mode. */
    extra: {} as Record<string, unknown>,
    listeners: [] as Array<(state: Record<string, unknown>) => void>,
  };
  const nativeState = () => {
    const route =
      native.explicit ?? native.headset ?? (native.builtin as string);
    return {
      ok: true,
      active: native.owners.size > 0,
      route,
      routes: [
        'earpiece',
        'speaker',
        ...(native.headset ? [native.headset] : []),
      ],
      speaker: route === 'speaker',
      kind: native.kind,
      owners: native.owners.size,
      ...native.extra,
    };
  };
  const routing = {
    startCall: vi.fn(
      async (o?: { speaker?: boolean; owner?: string; kind?: string }) => {
        const first = native.owners.size === 0;
        native.owners.add(o?.owner ?? 'legacy');
        if (first || (o?.kind && o.kind !== native.kind)) {
          native.kind = o?.kind ?? 'dm';
          if (first) native.explicit = null;
          native.builtin = native.kind === 'group' ? 'speaker' : 'earpiece';
        }
        if (typeof o?.speaker === 'boolean') {
          native.builtin = o.speaker ? 'speaker' : 'earpiece';
        }
        return nativeState();
      }
    ),
    setSpeaker: vi.fn(async (o: { speaker: boolean }) => {
      native.builtin = o.speaker ? 'speaker' : 'earpiece';
      if (native.explicit === 'speaker' || native.explicit === 'earpiece') {
        native.explicit = null;
      }
      return nativeState();
    }),
    setAudioRoute: vi.fn(async (o: { route: string }) => {
      native.explicit = o.route;
      return nativeState();
    }),
    reapply: vi.fn(async () => nativeState()),
    endCall: vi.fn(async (o?: { owner?: string }) => {
      native.owners.delete(o?.owner ?? 'legacy');
      return nativeState();
    }),
    addListener: vi.fn(
      async (_event: string, cb: (state: Record<string, unknown>) => void) => {
        native.listeners.push(cb);
        return { remove: async () => {} };
      }
    ),
    /**
     * Android reports a route change (headset, Bluetooth, route sheet).
     * `extra`: more state, e.g. a phone call's focus / mode.
     */
    emitChanged: (reason: string, extra: Record<string, unknown> = {}) => {
      const state = { ...nativeState(), ...extra, reason };
      for (const cb of native.listeners) cb(state);
    },
  };

  /** One entry per installWebRtcPrivacyGuard() call: was the surface set? */
  const guardCalls: Array<{ surfaceAlreadySet: boolean }> = [];
  /** What the privacy guard's registry lists (listGuardedPeerConnections). */
  const guardedPcs: Array<{
    pc: unknown;
    serial: number;
    createdAt: number;
    mode: string;
    stunProbe: boolean;
  }> = [];

  return {
    state,
    FakeTrack,
    FakeMediaStream,
    FakeTransport,
    FakeRuntime,
    routing,
    native,
    guardCalls,
    guardedPcs,
  };
});

vi.mock('../plugins/AudioRouting', () => ({ AudioRouting: h.routing }));
vi.mock('../utils/platform', () => ({ isCapacitor: () => h.state.native }));
vi.mock('../lib/call/directVoiceWebRtcTransport', () => ({
  DirectVoiceWebRtcTransport: h.FakeTransport,
}));
vi.mock('../lib/group-call/groupCallAudioEngineRuntime', () => ({
  GroupCallAudioEngineRuntime: h.FakeRuntime,
}));
vi.mock('./webrtcPrivacy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./webrtcPrivacy')>()),
  installWebRtcPrivacyGuard: vi.fn(() => {
    h.guardCalls.push({
      surfaceAlreadySet:
        typeof window !== 'undefined' && Boolean(window.audioSurface),
    });
    return true;
  }),
  listGuardedPeerConnections: vi.fn(() => [...h.guardedPcs]),
}));

// ── WebCodecs / WebAudio fakes ──────────────────────────────────────────────

class FakeAudioEncoder {
  static instances: FakeAudioEncoder[] = [];
  static isConfigSupported = vi.fn(async (config: unknown) => ({
    supported: true,
    config,
  }));
  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
  config: Record<string, unknown> | null = null;
  encoded = 0;
  constructor(
    public init: {
      output: (chunk: unknown) => void;
      error: (e: unknown) => void;
    }
  ) {
    FakeAudioEncoder.instances.push(this);
  }
  configure(config: Record<string, unknown>) {
    this.config = config;
    this.state = 'configured';
  }
  encode() {
    this.encoded += 1;
    const bytes = new Uint8Array([0xf8, 0xff, 0xfe, this.encoded & 0xff]);
    this.init.output({
      byteLength: bytes.length,
      copyTo: (dst: Uint8Array) => dst.set(bytes),
    });
  }
  close() {
    this.state = 'closed';
  }
  fail() {
    this.state = 'closed';
    this.init.error(new Error('encoder exploded'));
  }
}

class FakeAudioDecoder {
  static instances: FakeAudioDecoder[] = [];
  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
  decodeQueueSize = 0;
  decoded = 0;
  constructor(
    public init: {
      output: (data: unknown) => void;
      error: (e: unknown) => void;
    }
  ) {
    FakeAudioDecoder.instances.push(this);
  }
  configure() {
    this.state = 'configured';
  }
  decode() {
    this.decoded += 1;
    this.init.output(new FakeAudioData());
  }
  close() {
    this.state = 'closed';
  }
  fail() {
    this.state = 'closed';
    this.init.error(new Error('decoder exploded'));
  }
}

class FakeAudioData {
  numberOfFrames = 960;
  copyTo(dst: Float32Array) {
    dst.fill(0.1);
  }
  close() {}
}

class FakeEncodedAudioChunk {
  constructor(public init: unknown) {}
}

type FakeSourceNode = {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  stream: InstanceType<typeof h.FakeMediaStream>;
};

class FakeAudioContext {
  static sources: FakeSourceNode[] = [];
  state = 'running';
  destination = {};
  audioWorklet = { addModule: vi.fn(async () => {}) };
  createMediaStreamSource(stream: InstanceType<typeof h.FakeMediaStream>) {
    const node = { connect: vi.fn(), disconnect: vi.fn(), stream };
    FakeAudioContext.sources.push(node);
    return node;
  }
  async resume() {}
  async close() {
    this.state = 'closed';
  }
}

class FakeWorkletNode {
  static instances: FakeWorkletNode[] = [];
  port = {
    onmessage: null as null | ((e: { data: unknown }) => void),
    postMessage: vi.fn(),
  };
  constructor(
    public ctx: unknown,
    public name: string
  ) {
    FakeWorkletNode.instances.push(this);
  }
  connect() {}
  disconnect() {}
}

// ── Harness ─────────────────────────────────────────────────────────────────

const OWNER = 'dvc:owner-1';
const ROOM = 'dmv:0123456789abcdef01';
const PEER = 'QPeerAddressPeerAddressPeerAddr';
const ME = 'QMyAddressMyAddressMyAddressMyA';
const KEY = new Uint8Array(32).fill(7);

type Surface = NonNullable<Window['audioSurface']>;
type MasModule = typeof import('./mobileAudioSurface');
type PrefModule = typeof import('./callTransportPreference');

let mas: MasModule;
let pref: PrefModule;
let surface: Surface;
let events: AudioSurfaceEvent[];
let gcListeners: Set<(event: string, payload: unknown) => void>;
let sendAudio: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;

const send = (command: Record<string, unknown>) =>
  surface.sendCommand(command as unknown as AudioSurfaceCommand);

const rtcCommand = (over: Record<string, unknown> = {}) => ({
  type: 'start-direct-voice-rtc',
  ownerId: OWNER,
  roomId: ROOM,
  peerAddress: PEER,
  initiator: true,
  inputDeviceId: null,
  outputDeviceId: null,
  muted: false,
  hearCall: true,
  iceServers: [{ urls: 'stun:snapshot.example:3478' }],
  ...over,
});

const mediaCommand = (over: Record<string, unknown> = {}) => ({
  type: 'start-direct-voice-media',
  ownerId: OWNER,
  roomId: ROOM,
  peerAddress: PEER,
  localAddress: ME,
  roomKey: KEY.slice().buffer,
  inputDeviceId: null,
  outputDeviceId: null,
  muted: false,
  hearCall: true,
  profile: 'low-latency',
  ...over,
});

const ofType = <T extends AudioSurfaceEvent['type']>(type: T) =>
  events.filter((e) => e.type === type) as Array<
    Extract<AudioSurfaceEvent, { type: T }>
  >;

/** Array.prototype.at(-1) without ES2022 lib (tsconfig is ES2020). */
const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1];

const lastTransport = () => {
  const t = last(h.FakeTransport.instances);
  if (!t) throw new Error('no transport');
  return t;
};

/** The newest capture node (a replaced call leaves its old one behind). */
const captureNode = () => {
  const node = last(
    FakeWorkletNode.instances.filter((n) => n.name === 'pcm-capture')
  );
  if (!node) throw new Error('no capture node');
  return node;
};

const captureFrame = () =>
  captureNode().port.onmessage?.({ data: new Float32Array(960).fill(0.2) });

const deliverPeerPacket = (seq = 1) => {
  const packet = encodeAudioPacketV2(
    PEER,
    true,
    seq,
    Date.now() >>> 0,
    new Uint8Array([1, 2, 3, 4]),
    KEY
  );
  for (const cb of gcListeners) {
    cb('gcall:audio', { roomId: ROOM, data: packet });
  }
};

const remoteAudio = () =>
  document.querySelector<HTMLAudioElement>('audio[data-go-call-audio]');

/** Remote WebRTC audio arrives and starts playing. */
const playRemote = async () => {
  const t = lastTransport();
  t.options.onRemoteStream(new h.FakeMediaStream([new h.FakeTrack()]));
  await vi.waitFor(() => expect(remoteAudio()).not.toBeNull());
  remoteAudio()!.dispatchEvent(new Event('playing'));
};

beforeEach(async () => {
  vi.resetModules();
  h.state.native = true;
  h.FakeTransport.instances = [];
  h.FakeRuntime.instances = [];
  h.guardCalls.length = 0;
  h.guardedPcs.length = 0;
  FakeAudioContext.sources = [];
  FakeAudioEncoder.instances = [];
  FakeAudioDecoder.instances = [];
  FakeWorkletNode.instances = [];
  h.routing.startCall.mockClear();
  h.routing.setSpeaker.mockClear();
  h.routing.setAudioRoute.mockClear();
  h.routing.reapply.mockClear();
  h.routing.endCall.mockClear();
  h.routing.addListener.mockClear();
  h.native.owners.clear();
  h.native.kind = 'dm';
  h.native.builtin = 'earpiece';
  h.native.explicit = null;
  h.native.headset = null;
  h.native.extra = {};
  h.native.listeners.length = 0;
  localStorage.removeItem('go.calls.transport');
  document.querySelectorAll('audio').forEach((a) => a.remove());

  vi.stubGlobal('AudioEncoder', FakeAudioEncoder);
  vi.stubGlobal('AudioDecoder', FakeAudioDecoder);
  vi.stubGlobal('AudioData', FakeAudioData);
  vi.stubGlobal('EncodedAudioChunk', FakeEncodedAudioChunk);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  vi.stubGlobal('MediaStream', h.FakeMediaStream);
  vi.stubGlobal('RTCPeerConnection', function RTCPeerConnection() {});
  if (typeof URL.createObjectURL !== 'function') {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL =
      () => 'blob:worklet';
  }
  getUserMedia = vi.fn(async () => new h.FakeMediaStream([new h.FakeTrack()]));
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  gcListeners = new Set();
  sendAudio = vi.fn(async () => ({ sent: 1 }));
  (window as unknown as { groupCall: unknown }).groupCall = {
    sendAudio,
    onEvent: (cb: (event: string, payload: unknown) => void) => {
      gcListeners.add(cb);
      return () => gcListeners.delete(cb);
    },
  };
  (window as unknown as { hub: unknown }).hub = {
    getIceServers: vi.fn(async () => [{ urls: 'stun:live.example:3478' }]),
  };
  delete (window as { audioSurface?: unknown }).audioSurface;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  mas = await import('./mobileAudioSurface');
  pref = await import('./callTransportPreference');
  mas.installMobileAudioSurface();
  surface = window.audioSurface!;
  events = [];
  surface.onEvent((e) => events.push(e));
});

afterEach(() => {
  mas.__resetMobileAudioSurfaceForTests();
  delete (window as { audioSurface?: unknown }).audioSurface;
  localStorage.removeItem('go.calls.transport');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('mobile audio surface — install', () => {
  it('installs the WebRTC privacy guard before window.audioSurface exists', async () => {
    // beforeEach removed window.audioSurface, then installed the surface.
    expect(h.guardCalls).toEqual([{ surfaceAlreadySet: false }]);
    expect(window.audioSurface).toBeDefined();
    expect(await surface.getWindowRole()).toBe('mobile-main');
  });

  it('installs the guard even where the audio surface itself cannot run', () => {
    mas.__resetMobileAudioSurfaceForTests();
    delete (window as { audioSurface?: unknown }).audioSurface;
    vi.stubGlobal('AudioEncoder', undefined);
    h.guardCalls.length = 0;
    mas.installMobileAudioSurface();
    expect(h.guardCalls).toEqual([{ surfaceAlreadySet: false }]);
    expect(window.audioSurface).toBeUndefined();
  });

  it('never answers an unknown command with ok:true', async () => {
    const res = await send({ type: 'start-hologram-call' });
    expect(res).toEqual({
      ok: false,
      error: 'unsupported-audio-surface-command',
    });
  });

  it('keeps device/identity commands inert (ok) before a group call', async () => {
    expect(await send({ type: 'set-ui-active', uiActive: true })).toEqual({
      ok: true,
    });
    expect(await send({ type: 'clear-join-error' })).toEqual({ ok: true });
    expect(h.FakeRuntime.instances).toHaveLength(0);
  });
});

describe('start-direct-voice-rtc', () => {
  it('starts the shared transport on the call route (earpiece for 1:1)', async () => {
    const res = await send(rtcCommand({ muted: true }));
    expect(res).toEqual({ ok: true, payload: { transport: 'webrtc-native' } });
    const t = lastTransport();
    expect(t.options.offerer).toBe(true);
    expect(t.started).toBe(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(t.options.localStream.getAudioTracks()[0].enabled).toBe(false);
    expect(h.routing.startCall).toHaveBeenCalledWith({
      owner: 'surface',
      kind: 'dm',
    });
    expect(mas.isCallSpeakerOn()).toBe(false);
    expect(mas.getCallAudioRouteKind()).toBe('direct');
  });

  it('refuses when the user chose Reticulum-only calls', async () => {
    pref.setCallTransportPreference('reticulum');
    const res = await send(rtcCommand());
    expect(res).toEqual({ ok: false, error: 'webrtc-disabled-by-user' });
    expect(h.FakeTransport.instances).toHaveLength(0);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(h.routing.startCall).not.toHaveBeenCalled();
  });

  it('fails cleanly without RTCPeerConnection', async () => {
    vi.stubGlobal('RTCPeerConnection', undefined);
    expect(await send(rtcCommand())).toEqual({
      ok: false,
      error: 'native-webrtc-unavailable',
    });
  });

  it('reports a missing microphone like desktop', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('NotAllowedError'));
    expect(await send(rtcCommand())).toEqual({
      ok: false,
      error: 'native-webrtc-microphone-unavailable',
    });
    expect(h.routing.endCall).toHaveBeenCalled();
    // The owner was released: another call may start.
    expect((await send(rtcCommand({ ownerId: 'dvc:other' }))).ok).toBe(true);
  });

  it('rejects malformed starts', async () => {
    expect(await send(rtcCommand({ roomId: ' ' }))).toEqual({
      ok: false,
      error: 'invalid-direct-voice-rtc-config',
    });
    expect(await send(rtcCommand({ ownerId: '' }))).toEqual({
      ok: false,
      error: 'invalid-direct-voice-owner',
    });
  });

  it('prefers live ICE servers and falls back to the command snapshot', async () => {
    await send(rtcCommand());
    const t = lastTransport();
    expect(await t.options.getIceServers()).toEqual([
      { urls: 'stun:live.example:3478' },
    ]);
    (window.hub!.getIceServers as ReturnType<typeof vi.fn>).mockResolvedValue(
      []
    );
    expect(await t.options.getIceServers()).toEqual([
      { urls: 'stun:snapshot.example:3478' },
    ]);
  });

  it('emits owner-scoped signals and projects state like desktop', async () => {
    await send(rtcCommand());
    const t = lastTransport();
    const signal = {
      kind: 'description',
      generation: 'gen-123456',
      description: { type: 'offer', sdp: 'v=0' },
    };
    t.options.onSignal(signal);
    expect(ofType('direct-voice-rtc-signal')).toEqual([
      {
        type: 'direct-voice-rtc-signal',
        ownerId: OWNER,
        roomId: ROOM,
        peerAddress: PEER,
        signal,
      },
    ]);

    t.options.onState?.('recovering');
    t.open = true;
    t.options.onState?.('open'); // transport open, remote audio not playing
    expect(ofType('direct-voice-rtc-state').map((e) => e.state)).toEqual([
      'connecting',
      'connecting',
    ]);
    expect(ofType('direct-voice-media-ready')).toHaveLength(0);

    await playRemote();
    expect(ofType('direct-voice-media-ready')).toEqual([
      {
        type: 'direct-voice-media-ready',
        ownerId: OWNER,
        roomId: ROOM,
        peerAddress: PEER,
      },
    ]);
    expect(last(ofType('direct-voice-rtc-state'))?.state).toBe('open');
    t.options.onState?.('open');
    expect(last(ofType('direct-voice-rtc-state'))?.state).toBe('open');
  });

  it('plays remote audio through a hidden autoplay element that follows hearCall', async () => {
    await send(rtcCommand({ hearCall: false }));
    lastTransport().options.onRemoteStream(
      new h.FakeMediaStream([new h.FakeTrack()])
    );
    await vi.waitFor(() => expect(remoteAudio()).not.toBeNull());
    const audio = remoteAudio()!;
    expect(audio.autoplay).toBe(true);
    expect(audio.muted).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    await send({
      type: 'update-direct-voice-media',
      ownerId: OWNER,
      hearCall: true,
    });
    expect(audio.muted).toBe(false);
  });

  it('forwards diagnostics with owner/room/peer', async () => {
    await send(rtcCommand());
    lastTransport().options.onDiagnostic?.('ice-state', {
      iceConnectionState: 'checking',
    });
    expect(ofType('direct-voice-rtc-diagnostic')[0]).toMatchObject({
      ownerId: OWNER,
      roomId: ROOM,
      peerAddress: PEER,
      stage: 'ice-state',
    });
  });
});

describe('apply / stop direct-voice-rtc', () => {
  const signal = {
    kind: 'ice-candidates',
    generation: 'gen-123456',
    candidates: [],
  };

  it('answers session-not-ready without a transport (hook keeps its queue)', async () => {
    const res = await send({
      type: 'apply-direct-voice-rtc-signal',
      ownerId: OWNER,
      roomId: ROOM,
      peerAddress: PEER,
      signal,
    });
    expect(res).toEqual({
      ok: false,
      error: 'direct-voice-rtc-session-not-ready',
    });
  });

  it('applies signals only for the owner, room and peer', async () => {
    await send(rtcCommand());
    const apply = (over: Record<string, unknown>) =>
      send({
        type: 'apply-direct-voice-rtc-signal',
        ownerId: OWNER,
        roomId: ROOM,
        peerAddress: PEER,
        signal,
        ...over,
      });
    expect((await apply({ ownerId: 'dvc:stale' })).ok).toBe(false);
    expect((await apply({ roomId: 'dmv:other' })).ok).toBe(false);
    expect((await apply({ peerAddress: 'QOther' })).ok).toBe(false);
    expect(await apply({})).toEqual({ ok: true });
    expect(lastTransport().signals).toEqual([signal]);
  });

  it('ignores a stale stop and tears down on the owner stop', async () => {
    await send(rtcCommand());
    await playRemote();
    const t = lastTransport();
    const micTrack = t.options.localStream.getAudioTracks()[0];
    expect(
      await send({ type: 'stop-direct-voice-rtc', ownerId: 'dvc:stale' })
    ).toEqual({
      ok: true,
      payload: { ignored: 'stale-owner' },
    });
    expect(t.closed).toBe(false);

    const res = await send({ type: 'stop-direct-voice-rtc', ownerId: OWNER });
    expect(res).toEqual({ ok: true, payload: { idle: true } });
    expect(t.closed).toBe(true);
    expect(micTrack.readyState).toBe('ended');
    expect(remoteAudio()).toBeNull();
    expect(h.routing.endCall).toHaveBeenCalledTimes(1);
    // A closing transport must not reach the hook (desktop parity).
    expect(
      ofType('direct-voice-rtc-state').some((e) => e.state === 'closed')
    ).toBe(false);
  });
});

describe('Private calls chosen around a call', () => {
  it('keeps a live WebRTC leg until hang-up; the next call stays on Reticulum', async () => {
    await send(rtcCommand());
    await send(mediaCommand());
    const t = lastTransport();
    t.open = true;
    t.options.onState?.('open');
    await playRemote();
    pref.setCallTransportPreference('reticulum');
    await new Promise((r) => setTimeout(r, 20));
    // No silent gap: the leg the peer still plays keeps carrying audio.
    expect(t.closed).toBe(false);
    expect(
      ofType('direct-voice-rtc-state').some((e) => e.state === 'closed')
    ).toBe(false);
    expect(
      await send({
        type: 'apply-direct-voice-rtc-signal',
        ownerId: OWNER,
        roomId: ROOM,
        peerAddress: PEER,
        signal: { kind: 'ice-candidates', generation: 'g', candidates: [] },
      })
    ).toEqual({ ok: true });

    await send({ type: 'stop-direct-voice-rtc', ownerId: OWNER });
    await send({ type: 'stop-direct-voice-media', ownerId: OWNER });
    expect(await send(rtcCommand({ ownerId: 'dvc:next-call' }))).toEqual({
      ok: false,
      error: 'webrtc-disabled-by-user',
    });
    expect(h.FakeTransport.instances).toHaveLength(1);
  });

  it('refuses a start that was waiting for the mic when Private calls was chosen', async () => {
    let resolveMic: (stream: unknown) => void = () => {};
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMic = resolve;
        })
    );
    const pending = send(rtcCommand());
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    pref.setCallTransportPreference('reticulum');
    const baseTrack = new h.FakeTrack();
    resolveMic(new h.FakeMediaStream([baseTrack]));
    expect(await pending).toEqual({
      ok: false,
      error: 'webrtc-disabled-by-user',
    });
    expect(h.FakeTransport.instances).toHaveLength(0);
    expect(baseTrack.readyState).toBe('ended'); // mic closed again
    expect(h.routing.endCall).toHaveBeenCalledTimes(1); // call route left
    expect(mas.getCallAudioRouteKind()).toBeNull();
    // Owner released: the Reticulum media of the same or a later call runs.
    expect((await send(mediaCommand({ ownerId: 'dvc:later' }))).ok).toBe(true);
  });

  it('drops a leg whose transport was still starting when Private calls was chosen', async () => {
    let finishStart: () => void = () => {};
    vi.spyOn(h.FakeTransport.prototype, 'start').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStart = resolve;
        })
    );
    const pending = send(rtcCommand());
    await vi.waitFor(() => expect(h.FakeTransport.instances).toHaveLength(1));
    pref.setCallTransportPreference('reticulum');
    finishStart();
    expect(await pending).toEqual({
      ok: false,
      error: 'webrtc-disabled-by-user',
    });
    expect(lastTransport().closed).toBe(true);
    expect(mas.getCallAudioRouteKind()).toBeNull();
  });
});

describe('ended owners (call teardown began)', () => {
  it('refuses a media start the hook issues after its teardown began', async () => {
    await send({ type: 'stop-direct-voice-rtc', ownerId: OWNER });
    expect(await send(mediaCommand())).toEqual({
      ok: false,
      error: 'direct-voice-owner-ended',
    });
    expect(await send(rtcCommand())).toEqual({
      ok: false,
      error: 'direct-voice-owner-ended',
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(h.routing.startCall).not.toHaveBeenCalled();
    // A new call (new owner) is unaffected.
    expect((await send(mediaCommand({ ownerId: 'dvc:next' }))).ok).toBe(true);
  });

  it('lets the next call replace an ended owner that still holds media', async () => {
    const firstBase = new h.FakeTrack();
    getUserMedia.mockResolvedValueOnce(new h.FakeMediaStream([firstBase]));
    await send(mediaCommand());
    // Teardown sent only stop-direct-voice-rtc (desktop parity keeps the
    // Reticulum session and the owner here).
    expect(
      await send({ type: 'stop-direct-voice-rtc', ownerId: OWNER })
    ).toEqual({ ok: true, payload: { idle: false } });
    expect(firstBase.readyState).toBe('live');

    expect((await send(mediaCommand({ ownerId: 'dvc:next' }))).ok).toBe(true);
    expect(firstBase.readyState).toBe('ended');
    expect(h.routing.endCall).toHaveBeenCalledTimes(1);
    expect(h.routing.startCall).toHaveBeenCalledTimes(2);
    captureFrame();
    await vi.waitFor(() => expect(sendAudio).toHaveBeenCalled());
  });

  it('still refuses a second owner while the first call is live', async () => {
    await send(mediaCommand());
    expect(await send(rtcCommand({ ownerId: 'dvc:intruder' }))).toEqual({
      ok: false,
      error: 'direct-voice-runtime-in-use',
    });
  });

  it('ends media an ended owner still holds 10 s after its teardown began', async () => {
    const base = new h.FakeTrack();
    getUserMedia.mockResolvedValueOnce(new h.FakeMediaStream([base]));
    await send(mediaCommand());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await send({ type: 'stop-direct-voice-rtc', ownerId: OWNER });
      await vi.advanceTimersByTimeAsync(9_000);
      expect(base.readyState).toBe('live');
      await vi.advanceTimersByTimeAsync(1_500);
      expect(base.readyState).toBe('ended');
      expect(h.routing.endCall).toHaveBeenCalledTimes(1);
      expect(mas.getCallAudioRouteKind()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    // Nothing left to replace: the next call starts normally.
    expect((await send(mediaCommand({ ownerId: 'dvc:next' }))).ok).toBe(true);
  });

  it('a normal teardown leaves nothing for the safety net', async () => {
    await send(rtcCommand());
    await send(mediaCommand());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await send({ type: 'stop-direct-voice-rtc', ownerId: OWNER });
      expect(
        await send({ type: 'stop-direct-voice-media', ownerId: OWNER })
      ).toEqual({ ok: true, payload: { idle: true } });
      expect((await send(mediaCommand({ ownerId: 'dvc:next' }))).ok).toBe(true);
      await vi.advanceTimersByTimeAsync(11_000);
    } finally {
      vi.useRealTimers();
    }
    // The next call is untouched by the old owner's timer.
    captureFrame();
    await vi.waitFor(() => expect(sendAudio).toHaveBeenCalled());
    expect(h.routing.endCall).toHaveBeenCalledTimes(1);
  });
});

describe('start-direct-voice-media with WebRTC', () => {
  it('keeps an RTC leg for the same room/peer and shares one microphone', async () => {
    await send(rtcCommand());
    const t = lastTransport();
    const res = await send(mediaCommand());
    expect(res).toEqual({
      ok: true,
      payload: { usingAudioSurfaceMedia: true },
    });
    expect(t.closed).toBe(false);
    expect(h.FakeTransport.instances).toHaveLength(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.routing.startCall).toHaveBeenCalledTimes(1);
  });

  it('does not emit media-ready at capture start, only on the first decoded frame', async () => {
    await send(mediaCommand());
    expect(ofType('direct-voice-media-ready')).toHaveLength(0);
    deliverPeerPacket(1);
    await vi.waitFor(() =>
      expect(ofType('direct-voice-media-ready')).toEqual([
        {
          type: 'direct-voice-media-ready',
          ownerId: OWNER,
          roomId: ROOM,
          peerAddress: PEER,
        },
      ])
    );
    deliverPeerPacket(2);
    await vi.waitFor(() =>
      expect(FakeAudioDecoder.instances[0].decoded).toBeGreaterThanOrEqual(2)
    );
    expect(ofType('direct-voice-media-ready')).toHaveLength(1);
  });

  it('sends Reticulum audio until WebRTC plays, then stops sending and playing it', async () => {
    await send(rtcCommand());
    await send(mediaCommand());
    captureFrame();
    await vi.waitFor(() => expect(sendAudio).toHaveBeenCalledTimes(1));
    expect(sendAudio.mock.calls[0][0]).toBe(ROOM);
    expect(sendAudio.mock.calls[0][1]).toBe(PEER);

    const t = lastTransport();
    t.open = true;
    t.options.onState?.('open');
    await playRemote();
    const encodedBefore = last(FakeAudioEncoder.instances)!.encoded;
    captureFrame();
    captureFrame();
    await Promise.resolve();
    expect(sendAudio).toHaveBeenCalledTimes(1);
    expect(last(FakeAudioEncoder.instances)!.encoded).toBe(encodedBefore);

    // Inbound fallback frames are ignored while WebRTC plays.
    deliverPeerPacket(5);
    await new Promise((r) => setTimeout(r, 20));
    expect(FakeAudioDecoder.instances.reduce((n, d) => n + d.decoded, 0)).toBe(
      0
    );

    // ICE drops: Reticulum resumes on its own.
    t.open = false;
    t.options.onState?.('recovering');
    expect(last(ofType('direct-voice-rtc-state'))?.state).toBe('connecting');
    captureFrame();
    await vi.waitFor(() => expect(sendAudio).toHaveBeenCalledTimes(2));
    deliverPeerPacket(6);
    await vi.waitFor(() =>
      expect(
        FakeAudioDecoder.instances.reduce((n, d) => n + d.decoded, 0)
      ).toBe(1)
    );
  });

  it('configures Opus like desktop (voip, in-band FEC, 20 ms, profile bitrate)', async () => {
    await send(mediaCommand({ profile: 'high-stability' }));
    const config = FakeAudioEncoder.instances[0].config!;
    expect(config).toMatchObject({
      codec: 'opus',
      sampleRate: 48_000,
      numberOfChannels: 1,
      bitrate: 32_000,
      opus: expect.objectContaining({
        application: 'voip',
        useinbandfec: true,
        frameDuration: 20_000,
      }),
    });
  });

  it('rebuilds the Opus encoder after a WebCodecs error', async () => {
    await send(mediaCommand());
    captureFrame();
    await vi.waitFor(() => expect(sendAudio).toHaveBeenCalledTimes(1));
    FakeAudioEncoder.instances[0].fail();
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 1_000);
    captureFrame(); // triggers the rebuild
    await vi.waitFor(() => expect(FakeAudioEncoder.instances).toHaveLength(2));
    await vi.waitFor(() =>
      expect(FakeAudioEncoder.instances[1].state).toBe('configured')
    );
    captureFrame();
    await vi.waitFor(() => expect(sendAudio).toHaveBeenCalledTimes(2));
    spy.mockRestore();
  });

  it('rebuilds a speaker decoder after a WebCodecs error', async () => {
    await send(mediaCommand());
    deliverPeerPacket(1);
    await vi.waitFor(() => expect(FakeAudioDecoder.instances).toHaveLength(1));
    await vi.waitFor(() =>
      expect(FakeAudioDecoder.instances[0].decoded).toBe(1)
    );
    FakeAudioDecoder.instances[0].fail();
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 1_000);
    deliverPeerPacket(2);
    expect(FakeAudioDecoder.instances).toHaveLength(2);
    expect(FakeAudioDecoder.instances[1].decoded).toBe(1);
    spy.mockRestore();
  });

  it('applies mute to both legs and to the WebRTC track', async () => {
    await send(rtcCommand());
    await send(mediaCommand());
    const rtcTrack = lastTransport().options.localStream.getAudioTracks()[0];
    await send({
      type: 'update-direct-voice-media',
      ownerId: OWNER,
      muted: true,
    });
    expect(rtcTrack.enabled).toBe(false);
    captureFrame();
    await Promise.resolve();
    expect(sendAudio).not.toHaveBeenCalled();
    await send({
      type: 'update-direct-voice-media',
      ownerId: OWNER,
      muted: false,
    });
    expect(rtcTrack.enabled).toBe(true);
  });

  it('stop-direct-voice-media ends both legs (desktop parity)', async () => {
    await send(rtcCommand());
    await send(mediaCommand());
    const t = lastTransport();
    const res = await send({ type: 'stop-direct-voice-media', ownerId: OWNER });
    expect(res).toEqual({ ok: true, payload: { idle: true } });
    expect(t.closed).toBe(true);
    expect(h.routing.endCall).toHaveBeenCalledTimes(1);
  });
});

describe('owner scoping', () => {
  it('refuses a second owner while a call is active and ignores its stops', async () => {
    await send(mediaCommand());
    expect(await send(mediaCommand({ ownerId: 'dvc:intruder' }))).toEqual({
      ok: false,
      error: 'direct-voice-runtime-in-use',
    });
    expect(
      await send({ type: 'stop-direct-voice-media', ownerId: 'dvc:intruder' })
    ).toEqual({ ok: true, payload: { ignored: 'stale-owner' } });
    expect(
      await send({
        type: 'update-direct-voice-media',
        ownerId: 'dvc:intruder',
        muted: true,
      })
    ).toEqual({ ok: true, payload: { ignored: 'stale-owner' } });
    captureFrame();
    await vi.waitFor(() => expect(sendAudio).toHaveBeenCalled());
    await send({ type: 'stop-direct-voice-media', ownerId: OWNER });
    expect((await send(mediaCommand({ ownerId: 'dvc:next' }))).ok).toBe(true);
  });

  it('cleans up a failed media start so the next call can run', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('NotReadableError'));
    const res = await send(mediaCommand());
    expect(res).toEqual({ ok: false, error: 'NotReadableError' });
    expect(h.routing.endCall).toHaveBeenCalled();
    expect((await send(mediaCommand({ ownerId: 'dvc:retry' }))).ok).toBe(true);
  });

  it('rejects a bad room key like desktop', async () => {
    expect(
      await send(mediaCommand({ roomKey: new Uint8Array(16).buffer }))
    ).toEqual({
      ok: false,
      error: 'invalid-direct-voice-media-config',
    });
  });
});

describe('speaker / route API', () => {
  it('1:1 starts on the earpiece, group calls on the loudspeaker', async () => {
    const seen: boolean[] = [];
    mas.onCallSpeakerChange((on) => seen.push(on));
    await send(mediaCommand());
    expect(h.routing.startCall).toHaveBeenLastCalledWith({
      owner: 'surface',
      kind: 'dm',
    });
    await send({ type: 'stop-direct-voice-media', ownerId: OWNER });
    expect(h.routing.endCall).toHaveBeenLastCalledWith({ owner: 'surface' });

    await send({
      type: 'join-group-call',
      roomId: 'gcall-qortal-1',
      chatId: '1',
    });
    expect(h.routing.startCall).toHaveBeenLastCalledWith({
      owner: 'surface',
      kind: 'group',
    });
    expect(mas.isCallSpeakerOn()).toBe(true);
    expect(mas.getCallAudioRouteKind()).toBe('group');
    expect(seen).toEqual([true]);

    await send({ type: 'clear-join-error' });
    expect(h.FakeRuntime.instances[0].commands.map((c) => c.type)).toContain(
      'clear-join-error'
    );

    await send({ type: 'leave-group-call' });
    expect(mas.getCallAudioRouteKind()).toBeNull();
    expect(mas.isCallSpeakerOn()).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('remembers a speaker tap made before the call audio starts', async () => {
    expect(await mas.setCallSpeaker(true)).toBe(true);
    expect(h.routing.setSpeaker).not.toHaveBeenCalled(); // no call mode yet
    await send(mediaCommand());
    expect(h.routing.startCall).toHaveBeenLastCalledWith({
      owner: 'surface',
      kind: 'dm',
      speaker: true,
    });
    expect(mas.isCallSpeakerOn()).toBe(true);
  });

  it('lets a native route listener report the real route during a call', async () => {
    const seen: boolean[] = [];
    mas.onCallSpeakerChange((on) => seen.push(on));
    mas.reportNativeCallSpeaker(true); // no call: ignored
    expect(seen).toEqual([]);
    await send(mediaCommand());
    mas.reportNativeCallSpeaker(true);
    expect(mas.isCallSpeakerOn()).toBe(true);
    expect(seen).toEqual([true]);
  });

  it('switches the live route from the speaker button', async () => {
    await send(mediaCommand());
    h.routing.setSpeaker.mockClear();
    expect(await mas.setCallSpeaker(true)).toBe(true);
    // On: the loudspeaker as a hand-picked route (beats a headset too).
    expect(h.routing.setAudioRoute).toHaveBeenCalledWith({ route: 'speaker' });
    expect(mas.isCallSpeakerOn()).toBe(true);
    // Off: back to the private route (headset if any, else earpiece).
    expect(await mas.setCallSpeaker(false)).toBe(false);
    expect(h.routing.setSpeaker).toHaveBeenCalledWith({ speaker: false });
    expect(mas.isCallSpeakerOn()).toBe(false);
  });

  it('starts on the earpiece in GO but keeps the old answer elsewhere', () => {
    expect(mas.isCallSpeakerOn()).toBe(false);
    h.state.native = false; // desktop: the shared widget reads this at mount
    expect(mas.isCallSpeakerOn()).toBe(true);
  });

  it('does not call native routing outside GO', async () => {
    h.state.native = false;
    await send(mediaCommand());
    expect(h.routing.startCall).not.toHaveBeenCalled();
    expect(mas.getCallAudioRouteKind()).toBe('direct');
  });

  it('a group call join ends a 1:1 call', async () => {
    await send(rtcCommand());
    await send(mediaCommand());
    const t = lastTransport();
    await send({
      type: 'join-group-call',
      roomId: 'gcall-qortal-1',
      chatId: '1',
    });
    expect(t.closed).toBe(true);
    expect(mas.getCallAudioRouteKind()).toBe('group');
  });

  it('logout-cleanup ends the 1:1 call', async () => {
    await send(rtcCommand());
    await send(mediaCommand());
    const t = lastTransport();
    expect(await send({ type: 'logout-cleanup' })).toEqual({ ok: true });
    expect(t.closed).toBe(true);
    expect(mas.getCallAudioRouteKind()).toBeNull();
  });
});

// ── Wave 2: native call audio owner, sends, diagnostics, group runtime ─────

const GROUP_ROOM = 'gcall-qortal-77';
const joinGroup = () =>
  send({ type: 'join-group-call', roomId: GROUP_ROOM, chatId: '77' });
const runtime = () => {
  const rt = last(h.FakeRuntime.instances);
  if (!rt) throw new Error('no runtime');
  return rt;
};
const groupSnapshot = (over: Record<string, unknown> = {}) => ({
  type: 'snapshot',
  snapshot: {
    roomState: 'connected',
    roomId: GROUP_ROOM,
    myRole: 'root-forwarder',
    participants: [
      { address: ME, publicKey: 'a', speaking: true, role: 'root-forwarder' },
      { address: PEER, publicKey: 'b', speaking: false, role: 'participant' },
      {
        address: 'QThird',
        publicKey: 'c',
        speaking: false,
        role: 'participant',
      },
    ],
    activeSpeakers: [ME],
    topologyLabel: 'Reticulum',
    gcallJoinError: null,
    metrics: {
      packetsReceived: 120,
      packetsDecoded: 118,
      packetsForwarded: 60,
      packetsDropped: 2,
    },
    ...over,
  },
});
/** Lets queued surface commands and timers settle. */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await surface.sendCommand({ type: 'set-ui-active', uiActive: true } as never);
};

describe('native call audio owner (AudioRouting)', () => {
  it('holds the call audio as owner "surface" and lets go only of its own hold', async () => {
    // The call session hook already holds the call audio.
    await h.routing.startCall({ owner: 'session', kind: 'dm' });
    await send(mediaCommand());
    expect([...h.native.owners].sort()).toEqual(['session', 'surface']);
    await send({ type: 'stop-direct-voice-media', ownerId: OWNER });
    expect(h.routing.endCall).toHaveBeenLastCalledWith({ owner: 'surface' });
    // Android stays in call mode for the session until it ends its hold.
    expect([...h.native.owners]).toEqual(['session']);
  });

  it('re-asserts with reapply() after the mic opens, keeping a hand-picked route', async () => {
    await h.routing.startCall({ owner: 'session', kind: 'dm' });
    await h.routing.setAudioRoute({ route: 'bluetooth' }); // route sheet
    await send(mediaCommand());
    expect(h.routing.reapply).toHaveBeenCalled();
    expect(h.routing.setSpeaker).not.toHaveBeenCalled();
    expect(h.native.explicit).toBe('bluetooth');
    expect(mas.isCallSpeakerOn()).toBe(false);
  });

  it('follows the route Android reports (route sheet, headset) with one listener', async () => {
    const seen: boolean[] = [];
    mas.onCallSpeakerChange((on) => seen.push(on));
    await send(rtcCommand());
    await send(mediaCommand());
    expect(h.routing.addListener).toHaveBeenCalledTimes(1);
    expect(h.routing.addListener.mock.calls[0][0]).toBe('audioRouteChanged');
    h.native.explicit = 'speaker';
    h.routing.emitChanged('user-route');
    expect(mas.isCallSpeakerOn()).toBe(true);
    h.native.explicit = null;
    h.native.headset = 'wired';
    h.routing.emitChanged('device-added');
    expect(mas.isCallSpeakerOn()).toBe(false);
    expect(seen).toEqual([true, false]);
    expect(mas.getMobileCallAudioDiagnostics().route.native).toMatchObject({
      route: 'wired',
      reason: 'device-added',
    });
  });

  it('speaker off goes back to a connected headset, not the earpiece', async () => {
    h.native.headset = 'wired';
    await send(mediaCommand());
    expect(mas.isCallSpeakerOn()).toBe(false);
    expect(await mas.setCallSpeaker(true)).toBe(true);
    expect(h.native.explicit).toBe('speaker');
    expect(await mas.setCallSpeaker(false)).toBe(false);
    expect(h.native.explicit).toBeNull();
    expect(mas.getMobileCallAudioDiagnostics().route.native?.route).toBe(
      'wired'
    );
  });

  it('hands a group call over to a 1:1 call with the new kind', async () => {
    await joinGroup();
    expect(h.native.kind).toBe('group');
    expect(mas.isCallSpeakerOn()).toBe(true);
    await send(mediaCommand());
    expect(runtime().commands.map((c) => c.type)).toContain('leave-group-call');
    expect(h.routing.startCall).toHaveBeenLastCalledWith({
      owner: 'surface',
      kind: 'dm',
    });
    expect(mas.getCallAudioRouteKind()).toBe('direct');
    expect(mas.isCallSpeakerOn()).toBe(false);
  });

  it('records a native failure for Copy diagnostics and keeps the call going', async () => {
    h.routing.startCall.mockRejectedValueOnce(new Error('plugin missing'));
    expect((await send(mediaCommand())).ok).toBe(true);
    expect(mas.getMobileCallAudioDiagnostics().route.lastError).toBe(
      'startCall: plugin missing'
    );
  });
});

describe('sendAudio results (hosted Hub managers and the old port)', () => {
  const sendOnce = async (result: unknown) => {
    sendAudio.mockResolvedValue(result);
    captureFrame();
    await vi.waitFor(() => expect(sendAudio).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    sendAudio.mockClear();
  };
  const tx = () => mas.getMobileCallAudioDiagnostics().direct?.reticulum?.tx;

  it('counts {success:false} and {sent:0} as failures, with the reason', async () => {
    await send(mediaCommand());
    await sendOnce({ success: true });
    expect(tx()).toMatchObject({ sentPackets: 1, sendFailures: 0 });
    await sendOnce({ success: false, error: 'direct-link-not-ready' });
    expect(tx()).toMatchObject({
      sentPackets: 1,
      sendFailures: 1,
      lastSendError: 'direct-link-not-ready',
    });
    await sendOnce({ sent: 0, reason: 'no_peer' });
    expect(tx()).toMatchObject({ sendFailures: 2, lastSendError: 'no_peer' });
    await sendOnce({ sent: 1 });
    expect(tx()).toMatchObject({ sentPackets: 2, sendFailures: 2 });
  });
});

describe('getMobileCallAudioDiagnostics', () => {
  it('describes a 1:1 call on WebRTC without addresses, keys or SDP', async () => {
    await send(rtcCommand());
    await send(mediaCommand());
    const t = lastTransport();
    t.open = true;
    t.options.onState?.('open');
    await playRemote();
    deliverPeerPacket();
    const d = mas.getMobileCallAudioDiagnostics();
    expect(d.installed).toBe(true);
    expect(d.route).toMatchObject({ kind: 'direct', speaker: false });
    expect(d.mic).toMatchObject({ open: true, holders: 2, trackState: 'live' });
    expect(d.direct).toMatchObject({
      active: true,
      owner: true,
      carriedBy: 'webrtc',
      mediaReady: true,
      rtc: { state: 'open', transportState: 'open', remoteAudioPlaying: true },
    });
    expect(d.direct?.reticulum?.tx.capturedFrames).toBeGreaterThanOrEqual(0);
    expect(d.group).toBeNull();
    expect(d.transportPreference).toBe('webrtc');
    const json = JSON.stringify(d);
    expect(json).not.toContain(PEER);
    expect(json).not.toContain(ME);
    expect(json).not.toContain(ROOM);
  });

  it('is safe before install and after a call', async () => {
    mas.__resetMobileAudioSurfaceForTests();
    expect(mas.getMobileCallAudioDiagnostics()).toMatchObject({
      installed: false,
      direct: null,
      group: null,
      mic: null,
    });
  });
});

describe('group calls on the shared runtime', () => {
  it('passes participants and speaking state from the runtime to the UI', async () => {
    await joinGroup();
    runtime().emit(groupSnapshot());
    runtime().emit({
      type: 'group-call-rtc-state',
      roomId: GROUP_ROOM,
      peerAddress: PEER,
      state: 'connecting',
    });
    const snapshots = ofType('snapshot');
    expect(last(snapshots)?.snapshot.participants).toHaveLength(3);
    expect(last(snapshots)?.snapshot.activeSpeakers).toEqual([ME]);
    const g = mas.getMobileCallAudioDiagnostics().group;
    expect(g).toMatchObject({
      active: true,
      runtimeLoaded: true,
      roomState: 'connected',
      myRole: 'root-forwarder',
      participants: 3,
      speaking: 1,
      transport: 'Reticulum',
      packetsForwarded: 60,
      rtcPolicy: 'applied',
    });
    expect(Object.values(g!.rtcEdges)).toEqual(['connecting']);
    expect(JSON.stringify(g)).not.toContain(PEER);
  });

  it("reports the group engine's own capture as group.mic, not the 1:1 mic", async () => {
    await joinGroup();
    runtime().emit(groupSnapshot({ muted: true }));
    const d = mas.getMobileCallAudioDiagnostics();
    // The shared mic only serves 1:1 calls; the group sender has its own.
    expect(d.mic).toMatchObject({ use: '1:1', open: false, holders: 0 });
    expect(d.group?.mic).toEqual({
      open: true,
      tracks: 1,
      trackState: 'live',
      trackMuted: false,
      capturing: true,
      userMuted: true,
      encoder: 'worker-direct',
    });
    // A runtime whose sender diagnostics fail still gives a snapshot.
    runtime().senderDiagnostics = () => {
      throw new Error('boom');
    };
    expect(mas.getMobileCallAudioDiagnostics().group).toMatchObject({
      active: true,
      mic: null,
    });
  });

  it('gives the call audio back when the runtime leaves on its own', async () => {
    await joinGroup();
    expect(mas.getCallAudioRouteKind()).toBe('group');
    h.routing.endCall.mockClear();
    // e.g. this account joined the same call on another device.
    runtime().emit(groupSnapshot({ roomState: 'idle', roomId: '' }));
    await settle();
    expect(mas.getCallAudioRouteKind()).toBeNull();
    expect(h.routing.endCall).toHaveBeenCalledWith({ owner: 'surface' });
    // A later join works normally.
    await joinGroup();
    expect(mas.getCallAudioRouteKind()).toBe('group');
  });

  it('keeps the route when a join passes through idle (switching rooms)', async () => {
    await joinGroup();
    runtime().emitDuringCommand = [
      groupSnapshot({ roomState: 'idle', roomId: '' }),
      groupSnapshot({ roomState: 'joining', roomId: 'gcall-qortal-78' }),
    ];
    h.routing.endCall.mockClear();
    await send({
      type: 'join-group-call',
      roomId: 'gcall-qortal-78',
      chatId: '78',
    });
    await settle();
    expect(mas.getCallAudioRouteKind()).toBe('group');
    expect(h.routing.endCall).not.toHaveBeenCalled();
  });

  it('a 1:1 ring that is declined during a group call leaves the group alone', async () => {
    await joinGroup();
    const before = runtime().commands.length;
    h.routing.endCall.mockClear();
    getUserMedia.mockClear();
    // The hook's teardown after a declined/missed ring (no media was started).
    for (const type of [
      'stop-direct-voice-rtc',
      'stop-direct-voice-media',
      'stop-direct-voice-receive',
    ]) {
      expect(await send({ type, ownerId: 'dvc:ring' })).toEqual({
        ok: true,
        payload: { ignored: 'stale-owner' },
      });
    }
    expect(runtime().commands.slice(before)).toEqual([]);
    expect(mas.getCallAudioRouteKind()).toBe('group');
    expect(h.routing.endCall).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(mas.getMobileCallAudioDiagnostics().group?.active).toBe(true);
  });

  it('applies a "Private calls" change to the runtime edges right away', async () => {
    await joinGroup();
    const rt = runtime();
    const before = rt.syncCalls;
    pref.setCallTransportPreference('reticulum');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(rt.syncCalls).toBe(before + 1);
    await send({ type: 'leave-group-call' });
    pref.setCallTransportPreference('webrtc');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(rt.syncCalls).toBe(before + 1); // no call: nothing to do
  });
});

// ── Build 4: mic restart, tx level diagnostics, RTP counters, bundle results ─

type FakeStream = InstanceType<typeof h.FakeMediaStream>;
type FakeTrackT = InstanceType<typeof h.FakeTrack>;

/** A capture that getUserMedia hands out next (a new source). */
const nextCapture = (): { base: FakeTrackT; stream: FakeStream } => {
  const base = new h.FakeTrack();
  const stream = new h.FakeMediaStream([base]);
  getUserMedia.mockResolvedValueOnce(stream);
  return { base, stream };
};

const sameSource = (a: FakeTrackT | undefined, b: FakeTrackT) =>
  !!a && a.source === b.source;

/** The Reticulum leg's current capture track (newest source node). */
const sessionTrack = (): FakeTrackT => {
  const node = last(FakeAudioContext.sources);
  if (!node) throw new Error('no source node');
  return node.stream.getAudioTracks()[0] as FakeTrackT;
};

const rtcTrack = (): FakeTrackT =>
  lastTransport().options.localStream.getAudioTracks()[0] as FakeTrackT;

/** A 1:1 call with both legs, WebRTC open and playing. */
const startFullCall = async (over: Record<string, unknown> = {}) => {
  await send(rtcCommand(over));
  await send(mediaCommand(over));
  const t = lastTransport();
  t.open = true;
  t.options.onState?.('open');
  await playRemote();
  return t;
};

/** Fake time (timers + Date) and let the command queue run after each step. */
const useFakeClock = () =>
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
    ],
  });
const tick = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 5; i += 1) await vi.advanceTimersByTimeAsync(0);
};

const logLines = () =>
  (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.map((args) =>
    args.map(String).join(' ')
  );
const warnLines = () =>
  (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.map((args) =>
    args.map(String).join(' ')
  );

/** A peer connection as the privacy guard's registry lists it. */
const fakePc = (track: () => unknown, report: Map<string, unknown>) => ({
  signalingState: 'stable',
  getSenders: () => [{ track: track() }],
  getStats: vi.fn(async () => report),
});
const listPc = (pc: unknown, over: Record<string, unknown> = {}) => {
  h.guardedPcs.push({
    pc,
    serial: h.guardedPcs.length + 1,
    createdAt: Date.now(),
    mode: 'hide-local',
    stunProbe: false,
    ...over,
  });
};

const statsReport = () =>
  new Map<string, unknown>([
    [
      'ms1',
      {
        id: 'ms1',
        type: 'media-source',
        kind: 'audio',
        trackIdentifier: 'track-secret',
        audioLevel: 0.0213,
        totalAudioEnergy: 0.512,
        totalSamplesDuration: 10.4,
      },
    ],
    [
      'out1',
      {
        id: 'out1',
        type: 'outbound-rtp',
        kind: 'audio',
        mediaSourceId: 'ms1',
        ssrc: 1234,
        packetsSent: 500,
        bytesSent: 40_000,
      },
    ],
    [
      'outv',
      { id: 'outv', type: 'outbound-rtp', kind: 'video', packetsSent: 9999 },
    ],
    [
      'rin1',
      {
        id: 'rin1',
        type: 'remote-inbound-rtp',
        kind: 'audio',
        localId: 'out1',
        packetsLost: 1,
        fractionLost: 0,
        roundTripTime: 0.05,
        jitter: 0.003,
      },
    ],
    [
      'in1',
      {
        id: 'in1',
        type: 'inbound-rtp',
        kind: 'audio',
        packetsReceived: 490,
        packetsLost: 2,
        jitter: 0.004,
        audioLevel: 0.1,
        totalAudioEnergy: 0.7,
      },
    ],
    [
      'lc1',
      {
        id: 'lc1',
        type: 'local-candidate',
        address: '203.0.113.7',
        ip: '203.0.113.7',
        port: 61000,
        candidateType: 'srflx',
      },
    ],
    [
      'cp1',
      {
        id: 'cp1',
        type: 'candidate-pair',
        localCandidateId: 'lc1',
        currentRoundTripTime: 0.05,
      },
    ],
  ]);

/**
 * Route state while a phone call holds the audio: focus taken from GO,
 * AudioManager.MODE_IN_CALL.
 */
const PHONE_CALL = { focus: 'loss_transient', mode: 2 };

describe('mic restart (1:1)', () => {
  beforeEach(() => {
    useFakeClock();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves both legs to a new capture when the Bluetooth headset leaves, breaking the old one first', async () => {
    h.native.headset = 'bluetooth';
    const first = nextCapture();
    const t = await startFullCall();
    const oldRtc = rtcTrack();
    const oldSession = sessionTrack();
    const oldSourceNode = last(FakeAudioContext.sources)!;
    expect(sameSource(oldRtc, first.base)).toBe(true);
    expect(sameSource(oldSession, first.base)).toBe(true);
    const eventsBefore = events.length;
    h.routing.reapply.mockClear();

    const fresh = new h.FakeTrack();
    let atGetUserMedia: string[] = [];
    getUserMedia.mockImplementationOnce(async () => {
      atGetUserMedia = [
        first.base.readyState,
        oldRtc.readyState,
        oldSession.readyState,
      ];
      return new h.FakeMediaStream([fresh]);
    });

    h.native.headset = null;
    h.routing.emitChanged('devices-removed');
    await tick(900);
    expect(getUserMedia).toHaveBeenCalledTimes(1); // route settling
    await tick(200);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1][0]).toMatchObject({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    // Break first: nothing of the old capture was live at getUserMedia.
    expect(atGetUserMedia).toEqual(['ended', 'ended', 'ended']);

    // WebRTC: replaceLocalStream with a clone of the new capture.
    expect(t.replaced).toHaveLength(1);
    expect(sameSource(rtcTrack(), fresh)).toBe(true);
    expect(rtcTrack()).not.toBe(fresh);
    expect(rtcTrack().enabled).toBe(true);
    expect(rtcTrack().readyState).toBe('live');
    // Reticulum: a new source node into the same capture worklet.
    expect(sameSource(sessionTrack(), fresh)).toBe(true);
    expect(sessionTrack().readyState).toBe('live');
    expect(last(FakeAudioContext.sources)!.connect).toHaveBeenCalledTimes(1);
    expect(oldSourceNode.disconnect).toHaveBeenCalled();
    // Route re-asserted afterwards; the call itself saw nothing.
    expect(h.routing.reapply).toHaveBeenCalled();
    expect(events.slice(eventsBefore)).toEqual([]);
    expect(t.closed).toBe(false);

    const mic = mas.getMobileCallAudioDiagnostics().mic;
    expect(mic).toMatchObject({
      open: true,
      holders: 2,
      trackState: 'live',
      generation: 2,
      restarts: 1,
      restartFailures: 0,
      restarting: false,
      lastRestart: { reason: 'route:devices-removed', ok: true, moved: 2 },
    });
    expect(
      mas.getMobileCallAudioDiagnostics().direct?.reticulum?.tx.micSwaps
    ).toBe(1);
    expect(logLines().some((l) => l.includes('mic restarted'))).toBe(true);
  });

  it('keeps the mute state on the WebRTC track across a restart', async () => {
    h.native.headset = 'wired';
    const t = await startFullCall({ muted: true });
    expect(rtcTrack().enabled).toBe(false);
    nextCapture();
    h.native.headset = null;
    h.routing.emitChanged('devices-removed-waiting');
    await tick(1_100);
    expect(t.replaced).toHaveLength(1);
    expect(rtcTrack().enabled).toBe(false); // still muted
    expect(sessionTrack().enabled).toBe(true); // muting is the worklet's job
    await send({
      type: 'update-direct-voice-media',
      ownerId: OWNER,
      muted: false,
    });
    expect(rtcTrack().enabled).toBe(true); // unmute reaches the new track
  });

  it('a mute while the sender is still switching tracks reaches the new track', async () => {
    h.native.headset = 'wired';
    const t = await startFullCall();
    const replace = t.replaceLocalStream.bind(t);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.replaceLocalStream = async (stream: FakeStream) => {
      await gate;
      return replace(stream);
    };
    nextCapture();
    h.native.headset = null;
    h.routing.emitChanged('devices-removed');
    await tick(1_100);
    // replaceTrack is slow: after 2 s the command queue moves on.
    await tick(2_100);
    await send({
      type: 'update-direct-voice-media',
      ownerId: OWNER,
      muted: true,
    });
    release();
    await tick(0);
    expect(t.replaced).toHaveLength(1);
    expect(rtcTrack().readyState).toBe('live');
    expect(rtcTrack().enabled).toBe(false); // muted, not the stale "unmuted"
  });

  it('restarts when a wired headset is plugged in (devices-added)', async () => {
    await send(mediaCommand());
    const { base } = nextCapture();
    h.native.headset = 'wired';
    h.routing.emitChanged('devices-added');
    await tick(1_100);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(sameSource(sessionTrack(), base)).toBe(true);
  });

  it('ignores route events that do not change an input device', async () => {
    h.native.headset = 'bluetooth';
    await startFullCall();
    expect(mas.getMobileCallAudioDiagnostics().mic?.captureInputs).toBe(
      'bluetooth'
    );
    for (const reason of [
      'start',
      'start-again',
      'reapply',
      'reassert',
      'user-route',
      'speaker-choice',
      'focus-gain',
      'after-phone-call',
      'moved-elsewhere',
      // Same headsets as before (e.g. the device list re-reported).
      'devices-added',
      'devices-removed',
    ]) {
      h.routing.emitChanged(reason);
    }
    // Speaker button taps: their results list the same headsets.
    for (let i = 0; i < 4; i += 1) await mas.setCallSpeaker(i % 2 === 0);
    // A headset change during a phone call: CallAudioRouter's automatic
    // re-apply waits ('-waiting', focus lost / phone call mode), and so do
    // its other updates then. The phone call holds the audio.
    h.native.extra = PHONE_CALL;
    h.native.headset = null;
    h.routing.emitChanged('devices-removed-waiting');
    h.routing.emitChanged('moved-elsewhere');
    h.routing.emitChanged('reapply-phone-call');
    await mas.setCallSpeaker(false); // its result: the phone call's mode
    await tick(10_000);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(mas.getMobileCallAudioDiagnostics().mic?.restarts).toBe(0);
  });

  it('restarts at once when the capture ends, also with only the WebRTC leg', async () => {
    const first = nextCapture();
    await send(rtcCommand());
    const t = lastTransport();
    const { base } = nextCapture();
    first.base.endSource();
    await tick(0);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(t.replaced).toHaveLength(1);
    expect(sameSource(rtcTrack(), base)).toBe(true);
    expect(mas.getMobileCallAudioDiagnostics().mic?.lastRestart?.reason).toBe(
      'track-ended'
    );
  });

  it('merges a burst of triggers and keeps restarts 2 s apart, 6 a minute', async () => {
    const first = nextCapture();
    await send(mediaCommand());
    // A burst: headset gone, then the capture ends too.
    h.native.headset = 'bluetooth';
    h.routing.emitChanged('devices-added');
    first.base.endSource();
    h.native.headset = null;
    h.routing.emitChanged('devices-removed');
    await tick(0); // the ended capture does not wait for the route to settle
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(mas.getMobileCallAudioDiagnostics().mic?.lastRestart?.reason).toBe(
      'route:devices-added+track-ended+route:devices-removed'
    );
    // Another change 0.5 s after it waits for the 2 s gap (not the 1 s settle).
    await tick(500);
    h.native.headset = 'wired';
    h.routing.emitChanged('devices-added');
    await tick(1_200);
    expect(getUserMedia).toHaveBeenCalledTimes(2); // 1.7 s after the restart
    await tick(400);
    expect(getUserMedia).toHaveBeenCalledTimes(3); // 2.1 s

    // Keep plugging: at most 6 restarts in any minute.
    for (let i = 0; i < 8; i += 1) {
      h.native.headset = h.native.headset ? null : 'wired';
      h.routing.emitChanged(
        h.native.headset ? 'devices-added' : 'devices-removed'
      );
      await tick(3_000);
    }
    expect(getUserMedia.mock.calls.length - 1).toBe(6);
    await tick(40_000);
    expect(getUserMedia.mock.calls.length - 1).toBe(7); // the merged rest
    await tick(60_000);
    expect(getUserMedia.mock.calls.length - 1).toBe(7);
  });

  it('a hang-up never waits for a restart that is pending or running', async () => {
    h.native.headset = 'bluetooth';
    await startFullCall();
    // Pending (route settling): the hang-up cancels it.
    h.native.headset = null;
    h.routing.emitChanged('devices-removed');
    expect(
      await send({ type: 'stop-direct-voice-media', ownerId: OWNER })
    ).toEqual({ ok: true, payload: { idle: true } });
    await tick(5_000);
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    // Running (getUserMedia never answers): the hang-up is not held up.
    h.native.headset = 'bluetooth';
    await startFullCall({ ownerId: 'dvc:second' });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    let answerLate: (stream: FakeStream) => void = () => {};
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise<FakeStream>((resolve) => {
          answerLate = resolve;
        })
    );
    h.native.headset = null;
    h.routing.emitChanged('devices-removed');
    await tick(1_100);
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expect(mas.getMobileCallAudioDiagnostics().mic?.restarting).toBe(true);
    expect(
      await send({ type: 'stop-direct-voice-media', ownerId: 'dvc:second' })
    ).toEqual({ ok: true, payload: { idle: true } });
    expect(mas.getMobileCallAudioDiagnostics().mic).toMatchObject({
      open: false,
      holders: 0,
      restarting: false,
    });
    const late = new h.FakeTrack();
    answerLate(new h.FakeMediaStream([late]));
    await tick(0);
    expect(late.readyState).toBe('ended'); // the late capture is closed
    await tick(20_000);
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    // The next call opens its own microphone.
    expect((await send(mediaCommand({ ownerId: 'dvc:third' }))).ok).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(4);
    expect(sessionTrack().readyState).toBe('live');
  });

  it('tries a failed getUserMedia again a few times, then waits for the next change', async () => {
    h.native.headset = 'wired';
    await send(mediaCommand());
    for (let i = 0; i < 3; i += 1) {
      getUserMedia.mockRejectedValueOnce(new Error('NotReadableError'));
    }
    h.native.headset = null;
    h.routing.emitChanged('devices-removed');
    await tick(1_100);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    await tick(4_100);
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    await tick(4_100);
    expect(getUserMedia).toHaveBeenCalledTimes(4);
    await tick(30_000);
    expect(getUserMedia).toHaveBeenCalledTimes(4); // gave up
    expect(mas.getMobileCallAudioDiagnostics().mic).toMatchObject({
      restartFailures: 3,
      lastRestart: { ok: false, error: 'NotReadableError' },
    });
    expect(warnLines().some((l) => l.includes('mic restart gave up'))).toBe(
      true
    );
    // The next headset change tries again, and the capture comes back.
    const { base } = nextCapture();
    h.native.headset = 'wired';
    h.routing.emitChanged('devices-added');
    await tick(1_100);
    expect(getUserMedia).toHaveBeenCalledTimes(5);
    expect(sameSource(sessionTrack(), base)).toBe(true);
    expect(sessionTrack().readyState).toBe('live');
  });

  it('reopens a capture a phone call ended once GO has the call audio back', async () => {
    const first = nextCapture();
    await send(mediaCommand());
    for (let i = 0; i < 3; i += 1) {
      getUserMedia.mockRejectedValueOnce(new Error('NotReadableError'));
    }
    first.base.endSource(); // the phone call took the microphone
    await tick(0);
    await tick(4_100);
    await tick(4_100);
    await tick(30_000);
    expect(getUserMedia).toHaveBeenCalledTimes(4); // 1 + 3 failed, gave up
    const { base } = nextCapture();
    h.routing.emitChanged('after-phone-call');
    await tick(1_100);
    expect(getUserMedia).toHaveBeenCalledTimes(5);
    expect(sameSource(sessionTrack(), base)).toBe(true);
    expect(sessionTrack().readyState).toBe('live');
    // With a live capture the same event changes nothing.
    h.routing.emitChanged('focus-gain');
    await tick(5_000);
    expect(getUserMedia).toHaveBeenCalledTimes(5);
  });

  it('a headset that came or went during a phone call is caught up afterwards', async () => {
    h.native.headset = 'bluetooth';
    await startFullCall();
    const t = lastTransport();
    h.native.extra = PHONE_CALL;
    h.native.headset = null;
    // What CallAudioRouter emits then: devices-* is an automatic re-apply,
    // which waits while the focus is lost or the mode is a phone call's.
    h.routing.emitChanged('devices-removed-waiting');
    // The phone call ends: focus comes back while its mode is still on.
    h.native.extra = { focus: 'gain', mode: 2 };
    h.routing.emitChanged('focus-gain-phone-call');
    await tick(10_000);
    expect(getUserMedia).toHaveBeenCalledTimes(1); // the phone call holds it
    expect(
      logLines().some(
        (l) =>
          l.includes('AudioRouting.changed') &&
          l.includes('"inputChanged":true') &&
          l.includes('"held":true')
      )
    ).toBe(true);
    const { base } = nextCapture();
    h.native.extra = { focus: 'gain', mode: 3 }; // GO's communication mode
    h.routing.emitChanged('after-phone-call');
    await tick(1_100);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(sameSource(sessionTrack(), base)).toBe(true);
    expect(sameSource(rtcTrack(), base)).toBe(true);
    expect(t.replaced).toHaveLength(1);
    expect(mas.getMobileCallAudioDiagnostics().mic?.lastRestart?.reason).toBe(
      'route:after-phone-call+device'
    );
    // Caught up once: a later all-clear with a live capture changes nothing.
    h.routing.emitChanged('focus-gain');
    await tick(5_000);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('a getUserMedia that never answers counts as failed after 8 s', async () => {
    h.native.headset = 'wired';
    await send(mediaCommand());
    getUserMedia.mockImplementationOnce(() => new Promise(() => {}));
    h.native.headset = null;
    h.routing.emitChanged('devices-removed');
    await tick(1_100);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    await tick(8_000);
    expect(mas.getMobileCallAudioDiagnostics().mic?.lastRestart).toMatchObject({
      ok: false,
      error: 'getUserMedia-timeout',
    });
    const { base } = nextCapture();
    await tick(4_100); // the retry
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expect(sameSource(sessionTrack(), base)).toBe(true);
  });

  it('moves the WebRTC leg a moment later when its sender is being re-created', async () => {
    h.native.headset = 'bluetooth';
    const t = await startFullCall();
    t.failReplace = 'native-webrtc-audio-sender-missing';
    const { base } = nextCapture();
    h.native.headset = null;
    h.routing.emitChanged('devices-removed');
    await tick(1_100);
    expect(t.replaced).toHaveLength(1);
    expect(t.replaced[0].getAudioTracks()[0].readyState).toBe('ended');
    expect(sameSource(sessionTrack(), base)).toBe(true); // Reticulum moved
    await tick(600);
    expect(t.replaced).toHaveLength(2);
    expect(sameSource(rtcTrack(), base)).toBe(true);
    expect(rtcTrack().readyState).toBe('live');
    expect(getUserMedia).toHaveBeenCalledTimes(2); // no extra capture
  });

  it('a WebRTC leg starting during a restart shares its getUserMedia', async () => {
    h.native.headset = 'wired';
    await send(mediaCommand());
    let answer: (stream: FakeStream) => void = () => {};
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise<FakeStream>((resolve) => {
          answer = resolve;
        })
    );
    h.native.headset = null;
    h.routing.emitChanged('devices-removed');
    await tick(1_100);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    const starting = send(rtcCommand());
    await tick(0);
    const base = new h.FakeTrack();
    answer(new h.FakeMediaStream([base]));
    expect((await starting).ok).toBe(true);
    await tick(0);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(sameSource(rtcTrack(), base)).toBe(true);
    expect(sameSource(sessionTrack(), base)).toBe(true);
    expect(mas.getMobileCallAudioDiagnostics().mic).toMatchObject({
      holders: 2,
      trackState: 'live',
    });
  });

  it('compares with the devices the capture was opened on, whatever update brings the change first', async () => {
    h.native.headset = 'bluetooth';
    const t = await startFullCall();
    // Android 12+: the headset leaves, the communication device moves and
    // CallAudioRouter re-asserts first (its re-apply already lists the new
    // routes); the device callback comes after it.
    const first = nextCapture();
    h.native.headset = null;
    h.routing.emitChanged('reassert');
    h.routing.emitChanged('devices-removed');
    await tick(1_100);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(t.replaced).toHaveLength(1);
    expect(sameSource(rtcTrack(), first.base)).toBe(true);
    expect(sameSource(sessionTrack(), first.base)).toBe(true);
    expect(mas.getMobileCallAudioDiagnostics().mic).toMatchObject({
      restarts: 1,
      captureInputs: '',
      lastRestart: {
        reason: 'route:reassert+route:devices-removed',
        ok: true,
      },
    });

    // A call result (speaker button) that lands before the device event.
    await tick(5_000);
    const second = nextCapture();
    h.native.headset = 'wired';
    await mas.setCallSpeaker(false);
    h.routing.emitChanged('devices-added');
    await tick(1_100);
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expect(sameSource(rtcTrack(), second.base)).toBe(true);
    expect(mas.getMobileCallAudioDiagnostics().mic?.lastRestart?.reason).toBe(
      'route:speaker-off+route:devices-added'
    );

    // Only a call result shows it (the device event is still to come).
    await tick(5_000);
    const third = nextCapture();
    h.native.headset = null;
    await mas.setCallSpeaker(true);
    await tick(1_100);
    expect(getUserMedia).toHaveBeenCalledTimes(4);
    expect(sameSource(sessionTrack(), third.base)).toBe(true);
    // The late device event and the restart's own re-apply change nothing.
    h.routing.emitChanged('devices-removed');
    await tick(10_000);
    expect(getUserMedia).toHaveBeenCalledTimes(4);
    expect(mas.getMobileCallAudioDiagnostics().mic?.restarts).toBe(3);
  });

  it('moves the WebRTC leg again when a slow swap fails after the queue moved on', async () => {
    h.native.headset = 'wired';
    const t = await startFullCall();
    const replace = t.replaceLocalStream.bind(t);
    let fail: (error: Error) => void = () => {};
    let first = true;
    t.replaceLocalStream = async (stream: FakeStream) => {
      if (first) {
        first = false;
        t.replaced.push(stream);
        // replaceTrack stalls, then fails (e.g. ICE recovery closed the pc).
        await new Promise<void>((_, reject) => {
          fail = reject;
        });
      }
      return replace(stream);
    };
    const { base } = nextCapture();
    h.native.headset = null;
    h.routing.emitChanged('devices-removed');
    await tick(1_100); // the restart: the WebRTC swap stalls
    await tick(2_100); // the command queue moves on after 2 s
    await tick(600); // a resync runs while that swap still stalls
    fail(new Error('InvalidStateError'));
    await tick(0);
    await tick(600);
    expect(t.replaced).toHaveLength(2);
    expect(sameSource(rtcTrack(), base)).toBe(true);
    expect(rtcTrack().readyState).toBe('live');
    expect(sameSource(sessionTrack(), base)).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(2); // no extra capture
    expect(warnLines().some((l) => l.includes('mic swap failed'))).toBe(true);
  });

  it('a restart while a slow swap still runs closes its clone first and moves that leg after it', async () => {
    h.native.headset = 'wired';
    const t = await startFullCall();
    const replace = t.replaceLocalStream.bind(t);
    let finishSwap: () => void = () => {};
    let first = true;
    let handedOver: FakeTrackT | null = null;
    t.replaceLocalStream = async (stream: FakeStream) => {
      if (first) {
        first = false;
        handedOver = stream.getAudioTracks()[0] as FakeTrackT;
        await new Promise<void>((resolve) => {
          finishSwap = resolve;
        });
      }
      return replace(stream);
    };
    nextCapture();
    h.native.headset = null;
    h.routing.emitChanged('devices-removed');
    await tick(1_100); // restart 1: the WebRTC swap stalls
    await tick(2_100);
    const fresh = new h.FakeTrack();
    let atGetUserMedia = '';
    getUserMedia.mockImplementationOnce(async () => {
      atGetUserMedia = handedOver?.readyState ?? 'none';
      return new h.FakeMediaStream([fresh]);
    });
    h.native.headset = 'wired';
    h.routing.emitChanged('devices-added');
    await tick(1_100); // restart 2 while swap 1 still runs
    // Break first also covers the clone the slow swap is handing over.
    expect(atGetUserMedia).toBe('ended');
    expect(mas.getMobileCallAudioDiagnostics().mic?.lastRestart).toMatchObject({
      ok: true,
      error: 'some-consumers-pending',
    });
    await tick(600); // the resync finds that leg still swapping
    expect(sameSource(rtcTrack(), fresh)).toBe(false);
    finishSwap(); // swap 1 completes now, for the older capture
    await tick(0);
    await tick(600);
    expect(sameSource(rtcTrack(), fresh)).toBe(true);
    expect(rtcTrack().readyState).toBe('live');
    expect(sameSource(sessionTrack(), fresh)).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(3);
  });

  it('leaves a group call alone (its engine has its own microphone)', async () => {
    h.native.headset = 'bluetooth';
    await joinGroup();
    h.native.headset = null;
    h.routing.emitChanged('devices-removed');
    await tick(5_000);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

describe('capture level diagnostics (no restart on silence)', () => {
  const frame = (value: number) =>
    captureNode().port.onmessage?.({ data: new Float32Array(960).fill(value) });

  it('logs digital silence once, appends peak/zeroRunMs to the tx line, never reopens the mic', async () => {
    await send(mediaCommand());
    const txCall = () =>
      (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
        (args) => String(args[0]).startsWith('[audioSurface] tx ')
      );
    frame(0);
    const call = txCall()!;
    // Existing fields first, the new ones at the end (log parsers keep working).
    expect(String(call[0])).toMatch(/ rtcSkipped=%d peak=%s zeroRunMs=%d$/);
    expect(call.slice(-2)).toEqual(['0.0000', 20]);

    for (let i = 1; i < 249; i += 1) frame(0);
    const silence = () =>
      warnLines().filter((l) => l.includes('mic digital silence'));
    expect(silence()).toHaveLength(0);
    frame(0); // 250 frames = 5 s
    expect(silence()).toHaveLength(1);
    for (let i = 0; i < 300; i += 1) frame(0);
    expect(silence()).toHaveLength(1);
    let tx = mas.getMobileCallAudioDiagnostics().direct?.reticulum?.tx;
    expect(tx).toMatchObject({
      peakDbfs: -120,
      zeroRunMs: 550 * 20,
      longestZeroRunMs: 550 * 20,
      zeroFrames: 550,
      silenceReports: 1,
    });
    // Sound again (muted or not, the clone is what the mic delivers).
    await send({
      type: 'update-direct-voice-media',
      ownerId: OWNER,
      muted: true,
    });
    frame(0.25);
    tx = mas.getMobileCallAudioDiagnostics().direct?.reticulum?.tx;
    expect(tx).toMatchObject({ zeroRunMs: 0, longestZeroRunMs: 11_000 });
    expect(tx?.peakDbfs).toBeCloseTo(-12, 0);
    expect(logLines().some((l) => l.includes('mic sound again'))).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(mas.getMobileCallAudioDiagnostics().mic?.restarts).toBe(0);
  });
});

describe('WebRTC leg RTP counters (rtc tx-stats)', () => {
  beforeEach(() => {
    useFakeClock();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls the connection that carries the mic every 5 s while open, numbers only', async () => {
    const t = await startFullCall();
    const report = statsReport();
    const probe = fakePc(() => null, report);
    const other = fakePc(() => new h.FakeTrack(), report);
    const call = fakePc(() => rtcTrack(), report);
    listPc(probe, { stunProbe: true });
    listPc(other);
    listPc(call);
    await tick(5_000);
    expect(call.getStats).toHaveBeenCalledTimes(1);
    expect(probe.getStats).not.toHaveBeenCalled();
    expect(other.getStats).not.toHaveBeenCalled();
    const line = logLines().find((l) => l.includes(' tx-stats {'))!;
    expect(line).toBeDefined();
    const expected = {
      source: {
        audioLevel: 0.0213,
        totalAudioEnergy: 0.512,
        totalSamplesDuration: 10.4,
      },
      outbound: { packetsSent: 500, bytesSent: 40_000 },
      remoteInbound: {
        packetsLost: 1,
        fractionLost: 0,
        roundTripTime: 0.05,
        jitter: 0.003,
      },
      inbound: {
        packetsReceived: 490,
        packetsLost: 2,
        jitter: 0.004,
        audioLevel: 0.1,
        totalAudioEnergy: 0.7,
      },
    };
    expect(line).toBe(
      `[audioSurface] rtc %s %s tx-stats ${JSON.stringify(expected)}`
    );
    const d = mas.getMobileCallAudioDiagnostics();
    expect(d.direct?.rtcStats).toMatchObject({ ...expected, polls: 1 });
    for (const text of [line, JSON.stringify(d)]) {
      expect(text).not.toContain('203.0.113');
      expect(text).not.toContain('track-secret');
      expect(text).not.toContain('ssrc');
      expect(text).not.toContain('9999');
    }

    // Not while the leg is down; stops with the leg.
    t.open = false;
    await tick(5_000);
    expect(call.getStats).toHaveBeenCalledTimes(1);
    t.open = true;
    await tick(5_000);
    expect(call.getStats).toHaveBeenCalledTimes(2);
    await send({ type: 'stop-direct-voice-rtc', ownerId: OWNER });
    await tick(20_000);
    expect(call.getStats).toHaveBeenCalledTimes(2);
  });

  it('follows the sender to the new mic track after a restart', async () => {
    h.native.headset = 'bluetooth';
    await startFullCall();
    const call = fakePc(() => rtcTrack(), statsReport());
    // The registry still lists the connection; its sender now has the new clone.
    listPc(call);
    nextCapture();
    h.native.headset = null;
    h.routing.emitChanged('devices-removed');
    await tick(1_100);
    await tick(5_000);
    expect(call.getStats).toHaveBeenCalled();
  });

  it("falls back to the transport's own connection outside the guard", async () => {
    const t = await startFullCall();
    const call = fakePc(() => rtcTrack(), statsReport());
    (t as unknown as { pc: unknown }).pc = call;
    await tick(5_000);
    expect(call.getStats).toHaveBeenCalledTimes(1);
  });
});

describe('failed control bundles (go-gcall-control-bundle-result)', () => {
  const result = (detail: Record<string, unknown>) =>
    window.dispatchEvent(
      new CustomEvent('go-gcall-control-bundle-result', {
        detail: {
          signalId: 'sig-1',
          ok: false,
          reason: 'expired',
          roomId: ROOM,
          ...detail,
        },
      })
    );

  it('asks the transport to re-offer an unanswered offer after 20/30/45 s', async () => {
    await send(rtcCommand());
    expect(lastTransport().options.unansweredOfferRetryDelaysMs).toEqual([
      20_000, 30_000, 45_000,
    ]);
  });

  it('re-offers at once for a lost offer and re-sends a lost answer, for this call only', async () => {
    await send(rtcCommand());
    const t = lastTransport();
    result({ signalType: 'offer', ok: true });
    result({ signalType: 'offer', roomId: 'dmv:other-call' });
    result({ signalType: 'capability' });
    result({ signalType: 'candidate' });
    expect(t.retryUnansweredOffer).not.toHaveBeenCalled();
    expect(t.resendCurrentAnswer).not.toHaveBeenCalled();

    result({ signalType: 'offer' });
    expect(t.retryUnansweredOffer).toHaveBeenCalledWith('bundle-failed');
    result({ signalType: 'answer', reason: 'link' });
    expect(t.resendCurrentAnswer).toHaveBeenCalledTimes(1);
    expect(
      logLines().some(
        (l) => l.includes('control-bundle-failed') && l.includes('"acted":true')
      )
    ).toBe(true);
    const rtcDiag = mas.getMobileCallAudioDiagnostics().direct?.rtc;
    expect(rtcDiag).toMatchObject({ reoffers: 1, answerResends: 1 });
    expect(logLines().join('\n')).not.toContain('sig-1');
  });

  it('spaces and caps the retries per leg', async () => {
    useFakeClock();
    try {
      await send(rtcCommand());
      const t = lastTransport();
      result({ signalType: 'offer' });
      result({ signalType: 'offer' }); // 0 s later
      expect(t.retryUnansweredOffer).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 10; i += 1) {
        await tick(3_000);
        result({ signalType: 'offer' });
      }
      expect(t.retryUnansweredOffer).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('works without the transport methods and without a WebRTC leg', async () => {
    result({ signalType: 'offer' }); // no leg at all
    await send(rtcCommand());
    const t = lastTransport();
    delete t.retryUnansweredOffer;
    delete t.resendCurrentAnswer;
    expect(() => result({ signalType: 'offer' })).not.toThrow();
    expect(() => result({ signalType: 'answer' })).not.toThrow();
    expect(
      logLines().some(
        (l) =>
          l.includes('control-bundle-failed') && l.includes('"acted":false')
      )
    ).toBe(true);
  });
});
