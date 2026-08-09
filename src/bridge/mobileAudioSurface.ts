/**
 * Mobile `window.audioSurface` — a lean WebView audio engine for 1:1 DM voice.
 *
 * The desktop runs the full GroupCallAudioEngineRuntime inside an isolated,
 * cross-origin-isolated BrowserWindow (SharedArrayBuffer + AudioWorklet rings).
 * The Capacitor WebView is not cross-origin isolated, so instead of porting that
 * engine we implement a self-contained duplex pipeline that is *wire compatible*
 * with desktop peers:
 *   • capture: getUserMedia → AudioWorklet (960-sample/20 ms frames) → WebCodecs
 *     Opus encoder → encodeAudioPacketV2(roomKey) → window.groupCall.sendAudio
 *   • playback: window.groupCall 'gcall:audio' → decodeAudioPackets(roomKey) →
 *     WebCodecs Opus decoder → AudioWorklet jitter buffer → speakers
 *
 * Audio geometry matches gcallVoiceAudioConstants: 48 kHz mono, 20 ms frames.
 * If WebCodecs/AudioWorklet are unavailable the surface is not installed and the
 * call stays connected but silent (useVoiceCall degrades gracefully).
 */

import { Capacitor } from '@capacitor/core';
import {
  encodeAudioPacketV2,
  decodeAudioPackets,
} from '../lib/group-call/audioPacketCodec';
import type {
  AudioSurfaceCommand,
  AudioSurfaceEvent,
  AudioSurfaceResponse,
} from '../lib/group-call/audioSurfaceBridge';
import { AudioRouting } from '../plugins/AudioRouting';

// Mirrors the UI toggle so a route change can be re-applied if a new call
// session starts while the user previously chose the earpiece.
let callSpeakerOn = true;

/**
 * Force Android into in-call audio mode and route playback to the loudspeaker
 * (default) instead of the earpiece. Without this the echo-cancelled mic
 * capture pins output to the tiny earpiece at low volume and the remote party
 * is inaudible. No-op off-native.
 */
async function enterCallAudioRoute(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const r = await AudioRouting.startCall({ speaker: callSpeakerOn });
    console.log('[audioSurface] AudioRouting.startCall', JSON.stringify(r));
  } catch (e) {
    console.warn('[audioSurface] AudioRouting.startCall failed', e);
  }
}

/**
 * Re-assert the speaker route. getUserMedia()'s echo-canceller grabs the
 * communication device and resets the route back to the earpiece *after* we
 * set it, so we must re-apply once capture is live (and once more shortly
 * after, since the AEC route grab is async).
 */
async function reassertCallAudioRoute(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const r = await AudioRouting.setSpeaker({ speaker: callSpeakerOn });
    console.log('[audioSurface] AudioRouting.reassert', JSON.stringify(r));
  } catch (e) {
    console.warn('[audioSurface] AudioRouting.reassert failed', e);
  }
  setTimeout(() => {
    if (!Capacitor.isNativePlatform()) return;
    AudioRouting.setSpeaker({ speaker: callSpeakerOn })
      .then((r) =>
        console.log('[audioSurface] AudioRouting.reassert+600', JSON.stringify(r))
      )
      .catch(() => {});
  }, 600);
}

async function leaveCallAudioRoute(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await AudioRouting.endCall();
  } catch (e) {
    console.warn('[audioSurface] AudioRouting.endCall failed', e);
  }
}

/** Toggle loudspeaker vs earpiece for the active call (UI loudspeaker button). */
export async function setCallSpeaker(speaker: boolean): Promise<boolean> {
  callSpeakerOn = speaker;
  if (!Capacitor.isNativePlatform()) return speaker;
  try {
    const r = await AudioRouting.setSpeaker({ speaker });
    return r?.speaker ?? speaker;
  } catch (e) {
    console.warn('[audioSurface] AudioRouting.setSpeaker failed', e);
    return speaker;
  }
}

export function isCallSpeakerOn(): boolean {
  return callSpeakerOn;
}

const SAMPLE_RATE = 48_000;
const FRAME_SAMPLES = 960; // 20 ms @ 48 kHz
const OPUS_BITRATE = 24_000;
const VAD_RMS_THRESHOLD = 0.0025;

type WebCodecsCtor = {
  AudioEncoder?: typeof AudioEncoder;
  AudioDecoder?: typeof AudioDecoder;
  AudioData?: typeof AudioData;
  EncodedAudioChunk?: typeof EncodedAudioChunk;
};

export function isMobileAudioSurfaceSupported(): boolean {
  const g = globalThis as unknown as WebCodecsCtor;
  return (
    typeof g.AudioEncoder === 'function' &&
    typeof g.AudioDecoder === 'function' &&
    typeof g.AudioData === 'function' &&
    typeof g.EncodedAudioChunk === 'function' &&
    typeof AudioContext === 'function' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this._buf = new Float32Array(${FRAME_SAMPLES}); this._n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this._buf[this._n++] = ch[i];
        if (this._n >= ${FRAME_SAMPLES}) { this.port.postMessage(this._buf.slice(0)); this._n = 0; }
      }
    }
    return true;
  }
}
class PcmPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // ~12 frames ≈ 240 ms jitter buffer. The decoder tends to burst frames
    // faster than real-time (bursty pipe delivery) so this buffer sits near
    // full; capping it low keeps steady-state downlink latency ~240 ms instead
    // of the ~800 ms a deep buffer pins it at, while still absorbing jitter.
    this._q = []; this._cur = null; this._off = 0; this._maxQ = 12;
    this._tick = 0; this._peakQ = 0;
    this.port.onmessage = (e) => {
      const f = e.data;
      if (f && f.length) { this._q.push(f); if (this._q.length > this._maxQ) this._q.shift(); }
      if (this._q.length > this._peakQ) this._peakQ = this._q.length;
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    let i = 0;
    while (i < out.length) {
      if (!this._cur) {
        this._cur = this._q.shift() || null;
        this._off = 0;
        if (!this._cur) { while (i < out.length) out[i++] = 0; break; }
      }
      out[i++] = this._cur[this._off++];
      if (this._off >= this._cur.length) this._cur = null;
    }
    // ~375 process calls/sec @ 48k/128 — report queue depth ~1/sec.
    if (++this._tick >= 375) {
      this._tick = 0;
      this.port.postMessage({ t: 'q', peakQ: this._peakQ, q: this._q.length });
      this._peakQ = this._q.length;
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
registerProcessor('pcm-playback', PcmPlaybackProcessor);
`;

let workletModuleUrl: string | null = null;
const ensureWorkletUrl = (): string => {
  if (!workletModuleUrl) {
    workletModuleUrl = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: 'application/javascript' })
    );
  }
  return workletModuleUrl;
};

const toUint8 = (k: ArrayBuffer | Uint8Array): Uint8Array =>
  k instanceof Uint8Array ? new Uint8Array(k) : new Uint8Array(k);

type GroupCallLike = {
  sendAudio: (
    roomId: string,
    toAddress: string,
    data: Uint8Array
  ) => Promise<unknown>;
  onEvent: (cb: (event: string, payload: unknown) => void) => () => void;
};

const getGroupCall = (): GroupCallLike | null => {
  const gc = (window as unknown as { groupCall?: GroupCallLike }).groupCall;
  return gc?.sendAudio && gc?.onEvent ? gc : null;
};

/**
 * One inbound speaker: its own Opus decoder and jitter-buffered playback node.
 * Group calls need one of these per participant — a single decoder fed by
 * interleaved streams from several speakers produces garbage — and the
 * AudioContext graph mixes them for free because they share a destination.
 */
type SourcePipeline = {
  decoder: AudioDecoder;
  playbackNode: AudioWorkletNode;
};

/** Frames held while a new speaker's pipeline is still being constructed. */
const MAX_PENDING_FRAMES_PER_SOURCE = 25;

/**
 * Full-duplex voice session bound to a (roomId, roomKey). Sends one encoded
 * stream to every target address and plays back each inbound speaker
 * separately, which covers both 1:1 DMs (a single target) and group calls.
 */
class MobileVoiceSession {
  roomId: string;
  localAddress: string;
  roomKey: Uint8Array;
  muted = false;
  hearCall = true;

  /** Addresses our encoded audio is fanned out to. */
  private sendTargets: string[];
  private sources = new Map<string, SourcePipeline>();
  private sourceBuilds = new Map<string, Promise<SourcePipeline | null>>();
  private pendingBySource = new Map<string, Uint8Array[]>();
  private playbackStarted = false;

  private ctx: AudioContext | null = null;
  private ctxPromise: Promise<AudioContext> | null = null;
  private micStream: MediaStream | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private encoder: AudioEncoder | null = null;
  private gcUnsub: (() => void) | null = null;
  private seq = 0;
  private frameIndex = 0;
  private encodeMetaQueue: Array<{ vad: boolean; ts: number }> = [];
  private capturing = false;
  private disposed = false;
  // Diagnostics: distinguish "key/crypto wrong" (events arrive, 0 packets decrypt)
  // from "playback broken" (packets decrypt + decoder emits frames, but silent).
  private rxEvents = 0;
  private rxDecryptedPackets = 0;
  private rxDecodedFrames = 0;
  private rxLastLogAt = 0;
  // Diagnostics for the OUTBOUND path: distinguish "mic never captured"
  // (capturedFrames stays 0 → worklet/getUserMedia dead) from "captured but
  // muted/not sent" (capturedFrames climbs, sentPackets flat) from "sent but
  // peer never receives" (sentPackets climbs but remote stays connecting).
  private txCapturedFrames = 0;
  private txEncodedChunks = 0;
  private txSentPackets = 0;
  private txSendFailures = 0;
  private txLastLogAt = 0;
  // Peak RMS of decoded inbound PCM since the last rx log. >0 ⇒ the peer is
  // sending real audio energy (so silence on the device is a playback/route
  // problem); ≈0 ⇒ the peer is sending silent frames (e.g. mic not engaged).
  private rxPeakRms = 0;
  // Playback worklet jitter-buffer depth (frames) reported ~1/sec.
  private rxPlaybackPeakQ = 0;
  private rxPlaybackQ = 0;
  // Relative inbound latency: (arrivalNow - senderTs) minus the smallest such
  // offset seen this call. Cancels the unknown sender-clock offset, so a value
  // that climbs toward ~30 000 ms is the lag building up in the transport.
  private rxOffsetBaseline = Number.POSITIVE_INFINITY;
  private rxLatencyMs = 0;

  constructor(opts: {
    roomId: string;
    sendTargets: string[];
    localAddress: string;
    roomKey: Uint8Array;
    muted?: boolean;
    hearCall?: boolean;
  }) {
    this.roomId = opts.roomId;
    this.sendTargets = [...opts.sendTargets];
    this.localAddress = opts.localAddress;
    this.roomKey = opts.roomKey;
    this.muted = opts.muted === true;
    this.hearCall = opts.hearCall !== false;
  }

  setRoomKey(k: Uint8Array): void {
    this.roomKey = k;
  }

  /** Replace the fan-out list as participants join or leave a group call. */
  setSendTargets(targets: string[]): void {
    this.sendTargets = [...new Set(targets.filter(Boolean))];
  }

  private async ensureContext(): Promise<AudioContext> {
    // Reuse a live context. A *closed* context (left over from a torn-down
    // session or a backgrounded WebView) has no execution context, so any
    // AudioWorkletNode built on it throws "No execution context available" —
    // recreate in that case.
    if (this.ctx && this.ctx.state !== 'closed') return this.ctx;
    // Serialize creation: startPlayback() and startCapture() are awaited
    // concurrently, and without this guard each would `new AudioContext()`,
    // leaving one orphaned/detached context whose worklet node construction
    // fails intermittently. A single shared promise gives both one context.
    if (!this.ctxPromise) {
      this.ctxPromise = (async () => {
        const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
        await ctx.audioWorklet.addModule(ensureWorkletUrl());
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }
        this.ctx = ctx;
        return ctx;
      })();
      this.ctxPromise.catch(() => {
        // Allow a later retry to rebuild the context after a failed attempt.
        this.ctxPromise = null;
      });
    }
    return this.ctxPromise;
  }

  /**
   * Build an AudioWorkletNode, tolerating the transient "No execution context
   * available" Blink error that the WebView throws when the AudioContext's
   * realm isn't fully live yet (e.g. just after resume() or a focus change).
   * Resume + retry a few times so mic capture reliably comes up — without it a
   * single failure leaves the peer hearing nothing and the remote stuck on
   * "connecting…".
   */
  private async makeWorkletNode(
    name: string,
    options: AudioWorkletNodeOptions
  ): Promise<AudioWorkletNode> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (this.disposed) throw new Error('session disposed');
      const ctx = await this.ensureContext();
      try {
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
        return new AudioWorkletNode(ctx, name, options);
      } catch (err) {
        lastErr = err;
        // A closed/detached context will never recover — drop it so the next
        // attempt rebuilds a fresh one.
        if (ctx.state === 'closed') {
          this.ctx = null;
          this.ctxPromise = null;
        }
        await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error('AudioWorkletNode creation failed');
  }

  /** Start decode + playback of inbound audio (callee receive / full media). */
  async startPlayback(): Promise<void> {
    if (this.playbackStarted || this.disposed) return;
    this.playbackStarted = true;
    // Build the context up front so the first speaker's pipeline comes up
    // quickly, then attach per-speaker pipelines lazily as audio arrives.
    await this.ensureContext();
    if (this.disposed) return;

    const gc = getGroupCall();
    if (gc) {
      this.gcUnsub = gc.onEvent((event, payload) => {
        if (event !== 'gcall:audio') return;
        this.onInboundAudio(
          payload as {
            roomId?: string;
            data?: unknown;
            peerPresenceHash?: string;
          }
        );
      });
    }
  }

  /** Build (or reuse) the decode + playback chain for one inbound speaker. */
  private getSource(sourceKey: string): SourcePipeline | null {
    const existing = this.sources.get(sourceKey);
    if (existing) return existing;
    if (this.sourceBuilds.has(sourceKey) || this.disposed) return null;

    const build = (async (): Promise<SourcePipeline | null> => {
      try {
        const ctx = await this.ensureContext();
        const playbackNode = await this.makeWorkletNode('pcm-playback', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        if (this.disposed) {
          playbackNode.disconnect();
          return null;
        }
        playbackNode.connect(ctx.destination);
        playbackNode.port.onmessage = (e: MessageEvent) => {
          const d = e.data as { t?: string; peakQ?: number; q?: number };
          if (d && d.t === 'q') {
            this.rxPlaybackPeakQ = d.peakQ ?? 0;
            this.rxPlaybackQ = d.q ?? 0;
          }
        };

        const decoder = new AudioDecoder({
          output: (data: AudioData) => {
            try {
              if (!this.hearCall) {
                data.close();
                return;
              }
              const n = data.numberOfFrames;
              const pcm = new Float32Array(n);
              data.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
              this.rxDecodedFrames += 1;
              let sumSq = 0;
              for (let i = 0; i < n; i++) sumSq += pcm[i]! * pcm[i]!;
              const rms = n > 0 ? Math.sqrt(sumSq / n) : 0;
              if (rms > this.rxPeakRms) this.rxPeakRms = rms;
              playbackNode.port.postMessage(pcm, [pcm.buffer]);
            } catch {
              /* drop frame */
            } finally {
              data.close();
            }
          },
          error: () => {
            /* decoder reset on next packet */
          },
        });
        decoder.configure({
          codec: 'opus',
          sampleRate: SAMPLE_RATE,
          numberOfChannels: 1,
        });

        const pipeline: SourcePipeline = { decoder, playbackNode };
        this.sources.set(sourceKey, pipeline);
        this.flushPending(sourceKey, pipeline);
        return pipeline;
      } catch {
        return null;
      } finally {
        this.sourceBuilds.delete(sourceKey);
      }
    })();

    this.sourceBuilds.set(sourceKey, build);
    return null;
  }

  /** Replay frames that arrived while this speaker's pipeline was building. */
  private flushPending(sourceKey: string, pipeline: SourcePipeline): void {
    const pending = this.pendingBySource.get(sourceKey);
    this.pendingBySource.delete(sourceKey);
    if (!pending) return;
    for (const frame of pending) {
      this.decodeInto(pipeline, frame, Date.now());
    }
  }

  private decodeInto(
    pipeline: SourcePipeline,
    opusFrame: Uint8Array,
    timestampMs: number
  ): void {
    if (pipeline.decoder.state !== 'configured') return;
    try {
      pipeline.decoder.decode(
        new EncodedAudioChunk({
          type: 'key',
          timestamp: timestampMs * 1000,
          data: opusFrame,
        })
      );
    } catch {
      /* skip malformed */
    }
  }

  private onInboundAudio(payload: {
    roomId?: string;
    data?: unknown;
    peerPresenceHash?: string;
  }): void {
    if (payload.roomId !== this.roomId || this.disposed) return;
    let bytes: Uint8Array | null = null;
    const d = payload.data;
    if (d instanceof Uint8Array) bytes = d;
    else if (d instanceof ArrayBuffer) bytes = new Uint8Array(d);
    else if (Array.isArray(d)) bytes = new Uint8Array(d as number[]);
    if (!bytes) return;
    this.rxEvents += 1;
    const packets = decodeAudioPackets(bytes, this.roomKey);
    this.rxDecryptedPackets += packets.length;
    if (packets.length === 0) return;

    const nowMs = Date.now();
    for (const pkt of packets) {
      const offset = nowMs - pkt.timestampMs;
      if (offset < this.rxOffsetBaseline) this.rxOffsetBaseline = offset;
      this.rxLatencyMs = offset - this.rxOffsetBaseline;
      // The packet's own sender address is the most precise split; fall back to
      // the transport's peer hash, and finally to a single shared pipeline.
      const sourceKey =
        pkt.sourceAddr || payload.peerPresenceHash || 'default';
      const pipeline = this.getSource(sourceKey);
      if (pipeline) {
        this.decodeInto(pipeline, pkt.opusFrame, pkt.timestampMs);
        continue;
      }
      let pending = this.pendingBySource.get(sourceKey);
      if (!pending) {
        pending = [];
        this.pendingBySource.set(sourceKey, pending);
      }
      if (pending.length < MAX_PENDING_FRAMES_PER_SOURCE) {
        pending.push(pkt.opusFrame);
      }
    }
    const now = Date.now();
    if (now - this.rxLastLogAt >= 2500) {
      this.rxLastLogAt = now;
      // events = inbound gcall:audio batches; decryptedPackets = passed roomKey
      // auth (0 ⇒ key mismatch / no shared key); decodedFrames = Opus→PCM output
      // (>0 ⇒ pipeline producing audio); ctx = AudioContext state (must be running).
      let decodeQueue = 0;
      for (const pipeline of this.sources.values()) {
        decodeQueue += pipeline.decoder.decodeQueueSize ?? 0;
      }
      console.log(
        '[audioSurface] rx sources=%d events=%d decryptedPackets=%d decodedFrames=%d peakRms=%s decodeQ=%d playQ=%d/%d latencyMs=%d hear=%s ctx=%s',
        this.sources.size,
        this.rxEvents,
        this.rxDecryptedPackets,
        this.rxDecodedFrames,
        this.rxPeakRms.toFixed(4),
        decodeQueue,
        this.rxPlaybackQ,
        this.rxPlaybackPeakQ,
        Math.round(this.rxLatencyMs),
        this.hearCall,
        this.ctx?.state ?? 'none'
      );
      this.rxPeakRms = 0;
    }
  }

  /** Start mic capture → encode → send. */
  async startCapture(): Promise<void> {
    if (this.capturing || this.disposed) return;
    this.capturing = true;
    try {
      const ctx = await this.ensureContext();

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      const encoder = new AudioEncoder({
        output: (chunk: EncodedAudioChunk) => this.onEncodedChunk(chunk),
        error: () => {
          /* encoder will be recreated on teardown */
        },
      });
      encoder.configure({
        codec: 'opus',
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 1,
        bitrate: OPUS_BITRATE,
      });
      this.encoder = encoder;

      const source = ctx.createMediaStreamSource(this.micStream);
      const capture = await this.makeWorkletNode('pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      capture.port.onmessage = (e: MessageEvent) => {
        this.onCapturedFrame(e.data as Float32Array);
      };
      source.connect(capture);
      this.captureNode = capture;
      const tracks = this.micStream.getAudioTracks();
      console.log(
        '[audioSurface] capture started (mic live) muted=%s tracks=%d trackState=%s ctx=%s',
        this.muted,
        tracks.length,
        tracks[0]?.readyState ?? 'none',
        ctx.state
      );
    } catch (err) {
      // Reset so a later retry (media-recovery / re-arm) can re-enter instead
      // of being short-circuited by the `capturing` guard while no mic node
      // actually exists — otherwise the remote stays stuck on "connecting…".
      this.capturing = false;
      try {
        this.encoder?.close();
      } catch {
        /* ignore */
      }
      this.encoder = null;
      try {
        this.micStream?.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      this.micStream = null;
      throw err;
    }
  }

  private onCapturedFrame(frame: Float32Array): void {
    if (this.disposed || !this.encoder || this.encoder.state !== 'configured') return;
    this.txCapturedFrames += 1;
    this.maybeLogTx();
    if (this.muted) return;
    let sumSq = 0;
    for (let i = 0; i < frame.length; i++) sumSq += frame[i]! * frame[i]!;
    const rms = Math.sqrt(sumSq / frame.length);
    const vad = rms > VAD_RMS_THRESHOLD;
    const ts = Date.now() >>> 0;
    this.encodeMetaQueue.push({ vad, ts });
    try {
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: SAMPLE_RATE,
        numberOfFrames: FRAME_SAMPLES,
        numberOfChannels: 1,
        timestamp: this.frameIndex * 20_000,
        data: frame as unknown as BufferSource,
      });
      this.frameIndex += 1;
      this.encoder.encode(audioData);
      audioData.close();
    } catch {
      this.encodeMetaQueue.pop();
    }
  }

  private onEncodedChunk(chunk: EncodedAudioChunk): void {
    const meta = this.encodeMetaQueue.shift();
    if (!meta || this.disposed) return;
    const opus = new Uint8Array(chunk.byteLength);
    chunk.copyTo(opus);
    if (opus.length < 1 || opus.length > 4096) return;
    const seq = this.seq & 0xffff;
    this.seq = (this.seq + 1) & 0xffff;
    let packet: Uint8Array;
    try {
      packet = encodeAudioPacketV2(
        this.localAddress,
        meta.vad,
        seq,
        meta.ts,
        opus,
        this.roomKey
      );
    } catch {
      return;
    }
    this.txEncodedChunks += 1;
    const gc = getGroupCall();
    if (!gc) return;
    for (const target of this.sendTargets) {
      void gc
        .sendAudio(this.roomId, target, packet)
        .then((r) => {
          // sendAudio resolves { sent, reason }; count a real send vs a drop
          // (no_peer / link error) so we can see whether audio actually leaves.
          const sent =
            r && typeof r === 'object' && 'sent' in r
              ? Number((r as { sent?: number }).sent) || 0
              : 1;
          if (sent > 0) this.txSentPackets += 1;
          else this.txSendFailures += 1;
        })
        .catch(() => {
          this.txSendFailures += 1;
        });
    }
  }

  private maybeLogTx(): void {
    const now = Date.now();
    if (now - this.txLastLogAt < 2500) return;
    this.txLastLogAt = now;
    // capturedFrames>0 ⇒ mic worklet alive; muted ⇒ caller silenced us;
    // encodedChunks ⇒ Opus encoder producing; sentPackets ⇒ bridge accepted
    // for transmit; sendFailures ⇒ no peer dest / link error.
    console.log(
      '[audioSurface] tx capturedFrames=%d muted=%s encodedChunks=%d sentPackets=%d sendFailures=%d',
      this.txCapturedFrames,
      this.muted,
      this.txEncodedChunks,
      this.txSentPackets,
      this.txSendFailures
    );
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  setHearCall(hearCall: boolean): void {
    this.hearCall = hearCall;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.capturing = false;
    try {
      this.gcUnsub?.();
    } catch {
      /* ignore */
    }
    this.gcUnsub = null;
    try {
      this.captureNode?.disconnect();
    } catch {
      /* ignore */
    }
    for (const pipeline of this.sources.values()) {
      try {
        pipeline.playbackNode.disconnect();
      } catch {
        /* ignore */
      }
      try {
        if (pipeline.decoder.state !== 'closed') pipeline.decoder.close();
      } catch {
        /* ignore */
      }
    }
    this.sources.clear();
    this.sourceBuilds.clear();
    this.pendingBySource.clear();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    try {
      if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
    } catch {
      /* ignore */
    }
    this.encoder = null;
    this.captureNode = null;
    try {
      await this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.ctxPromise = null;
  }
}

let installed = false;

export function installMobileAudioSurface(): void {
  if (installed) return;
  if (typeof window === 'undefined') return;
  if (window.audioSurface) return;
  if (!isMobileAudioSurfaceSupported()) {
    console.warn(
      '[audioSurface] WebCodecs/AudioWorklet unavailable — DM voice will stay silent on this device'
    );
    return;
  }
  installed = true;

  let session: MobileVoiceSession | null = null;
  const eventCbs = new Set<(event: AudioSurfaceEvent) => void>();
  const emit = (event: AudioSurfaceEvent): void => {
    eventCbs.forEach((cb) => {
      try {
        cb(event);
      } catch {
        /* ignore */
      }
    });
  };

  const teardown = async (): Promise<void> => {
    const s = session;
    session = null;
    await s?.dispose();
    // A DM call and a group call would fight over the mic, so starting either
    // one ends the other.
    if (groupCallActive) {
      groupCallActive = false;
      try {
        await groupRuntime?.handleCommand({ type: 'leave-group-call' });
      } catch {
        /* ignore */
      }
    }
    await leaveCallAudioRoute();
  };

  // Multi-party calls need the real engine: membership, epoch keying and
  // topology all live in GroupCallAudioEngineRuntime, and reimplementing them
  // would put mobile on a different wire protocol than every desktop peer.
  // It is plain web code (WebCodecs + AudioWorklet + window.groupCall), so we
  // load it lazily on the first group command rather than at startup.
  type GroupRuntime = {
    handleCommand: (c: AudioSurfaceCommand) => Promise<AudioSurfaceResponse>;
    onEvent: (cb: (e: AudioSurfaceEvent) => void) => void;
    start: () => void;
    dispose: () => void;
  };
  let groupRuntime: GroupRuntime | null = null;
  let groupRuntimeLoad: Promise<GroupRuntime | null> | null = null;
  let groupCallActive = false;

  // `set-user` and friends arrive long before the first call. Because the
  // engine is created lazily it would otherwise join without an identity, so
  // keep the latest of each and replay them on construction.
  const STICKY_COMMANDS = new Set<AudioSurfaceCommand['type']>([
    'set-user',
    'set-ui-active',
    'set-device-preferences',
    'set-audio-quality-profile',
  ]);
  const stickyCommands = new Map<string, AudioSurfaceCommand>();

  const ensureGroupRuntime = async (): Promise<GroupRuntime | null> => {
    if (groupRuntime) return groupRuntime;
    if (!groupRuntimeLoad) {
      groupRuntimeLoad = (async () => {
        try {
          const { GroupCallAudioEngineRuntime } = await import(
            '../lib/group-call/groupCallAudioEngineRuntime'
          );
          const rt = new GroupCallAudioEngineRuntime() as unknown as GroupRuntime;
          rt.onEvent(emit);
          rt.start();
          for (const c of stickyCommands.values()) {
            try {
              await rt.handleCommand(c);
            } catch (e) {
              console.warn('[audioSurface] replay failed', c.type, e);
            }
          }
          groupRuntime = rt;
          return rt;
        } catch (e) {
          console.warn('[audioSurface] group call engine failed to load', e);
          groupRuntimeLoad = null;
          return null;
        }
      })();
    }
    return groupRuntimeLoad;
  };

  const GROUP_COMMANDS = new Set<AudioSurfaceCommand['type']>([
    'join-group-call',
    'leave-group-call',
    'set-muted',
    'set-hear-call',
    'set-audio-quality-profile',
    'export-diagnostics',
    'list-audio-devices',
    'set-device-preferences',
    'set-user',
    'set-ui-active',
    'logout-cleanup',
  ]);

  const handleCommand = async (
    command: AudioSurfaceCommand
  ): Promise<AudioSurfaceResponse> => {
    if (STICKY_COMMANDS.has(command.type)) {
      stickyCommands.set(command.type, command);
    }
    switch (command.type) {
      case 'start-direct-voice-receive': {
        await teardown();
        session = new MobileVoiceSession({
          roomId: command.roomId,
          sendTargets: [command.peerAddress],
          localAddress: '',
          roomKey: toUint8(command.roomKey),
          hearCall: command.hearCall,
        });
        await enterCallAudioRoute();
        await session.startPlayback();
        return { ok: true };
      }
      case 'update-direct-voice-receive': {
        if (session && typeof command.hearCall === 'boolean') {
          session.setHearCall(command.hearCall);
        }
        return { ok: true };
      }
      case 'stop-direct-voice-receive': {
        await teardown();
        return { ok: true };
      }
      case 'start-direct-voice-media': {
        await teardown();
        session = new MobileVoiceSession({
          roomId: command.roomId,
          sendTargets: [command.peerAddress],
          localAddress: command.localAddress,
          roomKey: toUint8(command.roomKey),
          muted: command.muted,
          hearCall: command.hearCall,
        });
        await enterCallAudioRoute();
        await session.startPlayback();
        await session.startCapture();
        // getUserMedia's AEC just grabbed the comm device and likely bounced
        // the route back to the earpiece — re-assert the speaker now.
        await reassertCallAudioRoute();
        emit({
          type: 'direct-voice-media-ready',
          roomId: command.roomId,
          peerAddress: command.peerAddress,
        });
        return { ok: true };
      }
      case 'update-direct-voice-media': {
        if (session) {
          if (typeof command.muted === 'boolean') session.setMuted(command.muted);
          if (typeof command.hearCall === 'boolean') session.setHearCall(command.hearCall);
        }
        return { ok: true };
      }
      case 'stop-direct-voice-media': {
        await teardown();
        return { ok: true };
      }
      case 'join-group-call': {
        // A group call and a DM call cannot share the mic or the room key.
        await teardown();
        const rt = await ensureGroupRuntime();
        if (!rt) return { ok: false, error: 'group-calls-unavailable' };
        await enterCallAudioRoute();
        const res = await rt.handleCommand(command);
        if (!res.ok) {
          await leaveCallAudioRoute();
          return res;
        }
        groupCallActive = true;
        // The engine's getUserMedia grabs the comm device and drops us back to
        // the earpiece, same as the DM path.
        await reassertCallAudioRoute();
        return res;
      }
      case 'leave-group-call': {
        const res = groupRuntime
          ? await groupRuntime.handleCommand(command)
          : { ok: true as const };
        if (groupCallActive) {
          groupCallActive = false;
          await leaveCallAudioRoute();
        }
        return res;
      }
      default: {
        if (GROUP_COMMANDS.has(command.type)) {
          // Only wake the engine for state it needs to remember; muting with
          // no call in progress shouldn't pull in the whole runtime.
          const rt = groupRuntime ?? (groupCallActive ? await ensureGroupRuntime() : null);
          if (rt) return rt.handleCommand(command);
        }
        // Remaining device commands are inert on mobile.
        return { ok: true };
      }
    }
  };

  // Commands must run one at a time: a concurrent stop (from the previous
  // call's teardown) grabs the `session` variable and disposes the session a
  // racing start just created — start-direct-voice-media then dies with
  // "session disposed" and the caller hangs up before sending the room key.
  let commandChain: Promise<unknown> = Promise.resolve();

  window.audioSurface = {
    isReady: async () => true,
    ensureReady: async () => ({ success: true }),
    sendCommand: async (command: AudioSurfaceCommand) => {
      const run = commandChain.then(async () => {
        try {
          return await handleCommand(command);
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });
      commandChain = run.catch(() => {});
      return run as Promise<AudioSurfaceResponse>;
    },
    onEvent: (cb: (event: AudioSurfaceEvent) => void) => {
      eventCbs.add(cb);
      return () => eventCbs.delete(cb);
    },
    getWindowRole: async () => 'mobile-main',
  };
}
