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
 *
 * 1:1 calls follow the desktop runtime (groupCallAudioEngineRuntime.ts) command
 * for command: native WebRTC audio through the shared, unmodified
 * DirectVoiceWebRtcTransport when the peer supports it, with the Reticulum Opus
 * path above armed as the automatic fallback. One microphone capture feeds both;
 * while WebRTC is open and its remote audio plays, Reticulum frames are neither
 * sent nor played. A path that breaks is left before WebRTC notices (see "Lost
 * path"). Every DM command is owner-scoped (`ownerId`) like desktop.
 * When a headset comes or goes mid-call, or the capture ends, the surface
 * reopens the microphone and moves both legs to it (see "Mic restart").
 * GO's WebRTC neither signals local addresses nor runs ICE checks that would
 * show them (webrtcPrivacy.ts): the peer can see GO's public IPv4 NAT address
 * (or a TURN relay), never a LAN, carrier (CGNAT) or IPv6 address. The
 * "Private calls" preference (callTransportPreference.ts) turns WebRTC off for
 * calls that start after it is chosen; a WebRTC leg that is already up stays
 * until hang-up.
 */

import {
  encodeAudioPacketV2,
  decodeAudioPackets,
} from '../lib/group-call/audioPacketCodec';
import type {
  AudioSurfaceCommand,
  AudioSurfaceEvent,
  AudioSurfaceResponse,
} from '../lib/group-call/audioSurfaceBridge';
import type { GroupCallControllerSnapshot } from '../lib/group-call/audioEngineTypes';
import { configureWebCodecsOpusEncoderForGcall } from '../lib/group-call/configureWebCodecsOpusEncoderForGcall';
import {
  getGroupCallAudioTuning,
  type GroupCallAudioQualityProfile,
} from '../lib/group-call/groupCallAudioProfile';
import {
  DirectVoiceWebRtcTransport,
  type DirectVoicePathSuspicion,
  type DirectVoiceRtcSignal,
  type DirectVoiceRtcState,
} from '../lib/call/directVoiceWebRtcTransport';
import { AudioRouting, type AudioRouteState } from '../plugins/AudioRouting';
import { isCapacitor } from '../utils/platform';
import {
  getCallTransportPreference,
  subscribeCallTransportPreference,
} from './callTransportPreference';
import { subscribeDefaultNetworkChanged } from './defaultNetworkChange';
import {
  getWebRtcPrivacyStats,
  installWebRtcPrivacyGuard,
  listGuardedPeerConnections,
} from './webrtcPrivacy';

// ── In-call audio route (Android) ─────────────────────────────────────────
//
// 1:1 calls start on the earpiece (private; Android's proximity handling turns
// the screen off at the ear), group calls on the loudspeaker. The speaker
// button switches for the rest of that call. A tap on the button before the
// route exists (while "Calling…"/ringing) is kept for the call that follows.
//
// Native side: CallAudioRouter (AudioRoutingPlugin). The surface is one
// owner of the call audio ('surface'); the call session hook
// (nativeCallSession.ts) holds 'session'. Android leaves call mode only when
// the last owner lets go, so the surface switching legs (or a group call
// handing over to a 1:1 call) never drops the call's audio mode. Native picks
// the route: a wired/USB headset, then Bluetooth, then the earpiece /
// loudspeaker choice (default by kind), and reports changes as
// 'audioRouteChanged'.

export type CallAudioRouteKind = 'direct' | 'group';

// null until first set: GO starts on the earpiece (1:1 default); outside GO
// (the shared desktop widget also reads this) the historic answer stays
// "loudspeaker", so desktop UI is unchanged.
let callSpeakerOn: boolean | null = null;
let callAudioRouteKind: CallAudioRouteKind | null = null;
let speakerChoiceAt = 0;
const SPEAKER_CHOICE_TTL_MS = 120_000;
const speakerListeners = new Set<(speaker: boolean) => void>();

const defaultSpeakerFor = (kind: CallAudioRouteKind): boolean =>
  kind === 'group';

const currentSpeaker = (): boolean => callSpeakerOn ?? !isCapacitor();

function setSpeakerState(next: boolean): void {
  const previous = currentSpeaker();
  callSpeakerOn = next;
  if (previous === next) return;
  for (const listener of [...speakerListeners]) {
    try {
      listener(next);
    } catch {
      /* ignore */
    }
  }
}

/** AudioRouting owner for the surface's call media. */
const SURFACE_AUDIO_OWNER = 'surface';

/** What Android last reported about the call route (Copy diagnostics). */
export type NativeCallRouteSnapshot = {
  route: string | null;
  routes: string[];
  speaker: boolean | null;
  active: boolean | null;
  owners: number | null;
  kind: string | null;
  focus: string | null;
  proximity: boolean | null;
  mode: number | null;
  /** AudioDeviceInfo type of Android's communication device (-1: none). */
  commDeviceType?: number | null;
  reason: string | null;
  at: number;
};

let lastNativeRoute: NativeCallRouteSnapshot | null = null;
let lastNativeRouteError: string | null = null;
let nativeRouteListenerInstalled = false;
/**
 * The installed surface's reaction to Android's call route (mic restart when
 * a headset comes or goes). Runs for every route event and every
 * AudioRouting call result: `source` is the event's reason or the call
 * ('surface-start', 'reapply', 'speaker-off', …); `previousInputs` are the
 * headset input routes of the snapshot before this one.
 */
let nativeRouteMicHook:
  | ((
      state: AudioRouteState,
      source: string,
      previousInputs: string | null
    ) => void)
  | null = null;
/**
 * Headset input routes ('bluetooth', 'wired') in Android's latest route
 * state that listed its routes, and when it came.
 */
let lastNativeInputRoutes: { inputs: string; at: number } | null = null;
/** When the current call audio route was entered. */
let callAudioRouteEnteredAt = 0;
/** Stops the installed surface's timers and listeners (tests). */
let disposeInstalledSurface: (() => void) | null = null;

const nativeKindFor = (kind: CallAudioRouteKind): 'dm' | 'group' =>
  kind === 'group' ? 'group' : 'dm';

/** The headset input routes in a route list, e.g. 'bluetooth,wired'. */
function inputRoutesOf(routes: unknown): string {
  return Array.isArray(routes)
    ? MIC_INPUT_ROUTES.filter((r) => routes.includes(r)).join(',')
    : '';
}

/**
 * Headset input routes of the current call route, or null when no route
 * state of this call listed them yet.
 */
function currentNativeInputRoutes(): string | null {
  if (callAudioRouteKind === null || !lastNativeInputRoutes) return null;
  return lastNativeInputRoutes.at >= callAudioRouteEnteredAt
    ? lastNativeInputRoutes.inputs
    : null;
}

function rememberNativeRoute(state: unknown, reason: string): void {
  if (!state || typeof state !== 'object') return;
  const s = state as Partial<AudioRouteState>;
  const previousInputs = lastNativeInputRoutes?.inputs ?? null;
  if (Array.isArray(s.routes)) {
    lastNativeInputRoutes = { inputs: inputRoutesOf(s.routes), at: Date.now() };
  }
  rememberNativeRouteSnapshot(s, reason);
  // The call audio is over for the surface: nothing to restart.
  if (reason === 'surface-end') return;
  try {
    nativeRouteMicHook?.(s as AudioRouteState, reason, previousInputs);
  } catch {
    /* never break the route UI */
  }
}

function rememberNativeRouteSnapshot(
  s: Partial<AudioRouteState>,
  reason: string
): void {
  lastNativeRoute = {
    route: typeof s.route === 'string' ? s.route : null,
    routes: Array.isArray(s.routes)
      ? s.routes.filter((r) => typeof r === 'string').map(String)
      : [],
    speaker: typeof s.speaker === 'boolean' ? s.speaker : null,
    active: typeof s.active === 'boolean' ? s.active : null,
    owners: typeof s.owners === 'number' ? s.owners : null,
    kind: typeof s.kind === 'string' ? s.kind : null,
    focus: typeof s.focus === 'string' ? s.focus : null,
    proximity: typeof s.proximity === 'boolean' ? s.proximity : null,
    mode: typeof s.mode === 'number' ? s.mode : null,
    commDeviceType:
      typeof s.commDeviceType === 'number' ? s.commDeviceType : null,
    reason: typeof s.reason === 'string' ? s.reason : reason,
    at: Date.now(),
  };
}

/** Loudspeaker as Android applied it (route 'speaker'); null if unknown. */
function nativeSpeakerOf(state: unknown): boolean | null {
  if (!state || typeof state !== 'object') return null;
  const s = state as Partial<AudioRouteState>;
  if (typeof s.route === 'string') return s.route === 'speaker';
  if (typeof s.speaker === 'boolean') return s.speaker;
  return null;
}

/** Follow Android's route (headset plugged in, Bluetooth, route sheet). */
function ensureNativeRouteListener(): void {
  if (nativeRouteListenerInstalled || !isCapacitor()) return;
  nativeRouteListenerInstalled = true;
  try {
    const pending = AudioRouting.addListener(
      'audioRouteChanged',
      (state: AudioRouteState) => {
        // Also hands the event to the mic restart (nativeRouteMicHook).
        rememberNativeRoute(state, 'changed');
        const speaker = nativeSpeakerOf(state);
        if (speaker !== null) reportNativeCallSpeaker(speaker);
      }
    );
    void Promise.resolve(pending).catch(() => {
      nativeRouteListenerInstalled = false;
    });
  } catch {
    nativeRouteListenerInstalled = false;
  }
}

/** A native answer during the call moves the UI's speaker state with it. */
function applyNativeSpeaker(state: unknown): void {
  if (callAudioRouteKind === null) return;
  const speaker = nativeSpeakerOf(state);
  if (speaker !== null) setSpeakerState(speaker);
}

function noteNativeRouteError(stage: string, error: unknown): void {
  lastNativeRouteError = `${stage}: ${
    error instanceof Error ? error.message : String(error)
  }`;
  console.warn(`[audioSurface] AudioRouting.${stage} failed`, error);
}

/**
 * Force Android into in-call audio mode (MODE_IN_COMMUNICATION) on the route
 * for this kind of call. Without it the echo-cancelled capture pins output to
 * the earpiece at low volume regardless of the UI. No-op outside GO. Entering
 * an already active route keeps it (and the user's speaker choice).
 */
async function enterCallAudioRoute(kind: CallAudioRouteKind): Promise<void> {
  if (callAudioRouteKind !== null) return;
  const choiceFresh =
    speakerChoiceAt > 0 && Date.now() - speakerChoiceAt < SPEAKER_CHOICE_TTL_MS;
  speakerChoiceAt = 0;
  callAudioRouteKind = kind;
  callAudioRouteEnteredAt = Date.now();
  setSpeakerState(choiceFresh ? currentSpeaker() : defaultSpeakerFor(kind));
  if (!isCapacitor()) return;
  ensureNativeRouteListener();
  try {
    // No speaker flag unless the user tapped the button before the call
    // audio existed: native picks the kind's default (and keeps a route the
    // user picked in the route sheet when the session hook started first).
    const r = await AudioRouting.startCall({
      owner: SURFACE_AUDIO_OWNER,
      kind: nativeKindFor(kind),
      ...(choiceFresh ? { speaker: currentSpeaker() } : {}),
    });
    rememberNativeRoute(r, 'surface-start');
    applyNativeSpeaker(r);
    console.log('[audioSurface] AudioRouting.startCall', JSON.stringify(r));
  } catch (e) {
    noteNativeRouteError('startCall', e);
  }
}

/**
 * Re-assert the route. getUserMedia()'s echo-canceller grabs the
 * communication device and resets the route *after* we set it, so re-apply
 * once capture is live (and once more shortly after, since the AEC route grab
 * is async). reapply() keeps every choice (a route picked in the route sheet
 * stays); on Android 12+ native also re-asserts by itself.
 */
async function reassertCallAudioRoute(): Promise<void> {
  if (!isCapacitor() || callAudioRouteKind === null) return;
  try {
    const r = await AudioRouting.reapply();
    rememberNativeRoute(r, 'reapply');
    applyNativeSpeaker(r);
    console.log('[audioSurface] AudioRouting.reapply', JSON.stringify(r));
  } catch (e) {
    noteNativeRouteError('reapply', e);
  }
  setTimeout(() => {
    if (!isCapacitor() || callAudioRouteKind === null) return;
    AudioRouting.reapply()
      .then((r) => {
        rememberNativeRoute(r, 'reapply+600');
        applyNativeSpeaker(r);
      })
      .catch(() => {});
  }, 600);
}

async function leaveCallAudioRoute(): Promise<void> {
  if (callAudioRouteKind === null) return;
  callAudioRouteKind = null;
  speakerChoiceAt = 0;
  // The next 1:1 call starts on the earpiece again; show that in the UI.
  setSpeakerState(false);
  if (!isCapacitor()) return;
  try {
    // Only the surface lets go: the call session may still hold the call
    // audio (e.g. a group call handing over to a 1:1 call).
    const r = await AudioRouting.endCall({ owner: SURFACE_AUDIO_OWNER });
    rememberNativeRoute(r, 'surface-end');
  } catch (e) {
    noteNativeRouteError('endCall', e);
  }
}

/**
 * Loudspeaker (true) vs private route (false) for the active call (UI
 * speaker button). On: the loudspeaker as a hand-picked route (it also takes
 * the call off a headset). Off: the private route again, i.e. a connected
 * headset, else the earpiece. Before a call's audio route exists the choice
 * is remembered for that call instead of switching the phone into call mode
 * early.
 */
export async function setCallSpeaker(speaker: boolean): Promise<boolean> {
  setSpeakerState(speaker);
  if (callAudioRouteKind === null) {
    speakerChoiceAt = Date.now();
    return speaker;
  }
  if (!isCapacitor()) return speaker;
  try {
    const r = speaker
      ? await AudioRouting.setAudioRoute({ route: 'speaker' })
      : await AudioRouting.setSpeaker({ speaker: false });
    rememberNativeRoute(r, speaker ? 'speaker-on' : 'speaker-off');
    const applied = nativeSpeakerOf(r) ?? speaker;
    if (callAudioRouteKind !== null) setSpeakerState(applied);
    return applied;
  } catch (e) {
    noteNativeRouteError(speaker ? 'setAudioRoute' : 'setSpeaker', e);
    return speaker;
  }
}

export function isCallSpeakerOn(): boolean {
  return currentSpeaker();
}

/** Subscribe to speaker on/off changes (route start/end, button, default). */
export function onCallSpeakerChange(
  listener: (speaker: boolean) => void
): () => void {
  speakerListeners.add(listener);
  return () => {
    speakerListeners.delete(listener);
  };
}

/**
 * For native route listeners (headset plugged in, Bluetooth connected, …):
 * record what Android actually routes to, so the UI follows. Does not call
 * back into native code.
 */
export function reportNativeCallSpeaker(speaker: boolean): void {
  if (callAudioRouteKind === null) return;
  setSpeakerState(speaker === true);
}

/** 'direct' / 'group' while a call holds the in-call audio route, else null. */
export function getCallAudioRouteKind(): CallAudioRouteKind | null {
  return callAudioRouteKind;
}

const SAMPLE_RATE = 48_000;
const FRAME_SAMPLES = 960; // 20 ms @ 48 kHz
const FRAME_DURATION_MS = 20;
const VAD_RMS_THRESHOLD = 0.0025;
/** Minimum spacing between WebCodecs rebuilds after an error. */
const CODEC_REBUILD_MIN_INTERVAL_MS = 250;
/** Cap on the live ICE-server refresh inside a command (python round trip). */
const ICE_SERVER_FETCH_TIMEOUT_MS = 1_500;
/** How many ended 1:1 owners (one per call) the surface remembers. */
const ENDED_DIRECT_VOICE_OWNER_MEMORY = 32;
/**
 * After stop-direct-voice-rtc the hook's teardown sends stop-direct-voice-media
 * within milliseconds; media an ended owner still holds after this long is
 * ended by the surface.
 */
const ENDED_DIRECT_VOICE_OWNER_REAP_MS = 10_000;

// ── 1:1 mic restart (see the shared microphone in installMobileAudioSurface) ─
/** Restarts are at least this far apart… */
const MIC_RESTART_MIN_GAP_MS = 2_000;
/** …and at most this many in any minute (later requests wait, merged). */
const MIC_RESTART_MAX_PER_MINUTE = 6;
/** Let CallAudioRouter and Chromium finish moving the call first. */
const MIC_RESTART_ROUTE_SETTLE_MS = 1_000;
/** A failed getUserMedia is tried again after this, a few times in a row. */
const MIC_RESTART_RETRY_MS = 4_000;
const MIC_RESTART_MAX_FAILURES_IN_ROW = 3;
/** A getUserMedia that has not answered by then counts as failed. */
const MIC_RESTART_GUM_TIMEOUT_MS = 8_000;
/** Moving the consumers to the new capture never holds commands longer. */
const MIC_SWAP_TIMEOUT_MS = 2_000;
/** A consumer that could not move yet (WebRTC re-creating its connection). */
const MIC_RESYNC_RETRY_MS = 500;
const MIC_RESYNC_MAX_TRIES = 8;
/** Android reports these when a headset / Bluetooth / USB device comes or goes. */
const MIC_INPUT_DEVICE_REASONS = new Set(['devices-added', 'devices-removed']);
/** Routes that bring their own microphone. */
const MIC_INPUT_ROUTES = ['bluetooth', 'wired'];
/** GO has the call audio again (after a phone call / lost audio focus). */
const MIC_AUDIO_BACK_REASONS = new Set(['after-phone-call', 'focus-gain']);
/** Audio focus a phone call (or another call app) took from GO. */
const MIC_FOCUS_LOST = new Set(['loss', 'loss_transient']);

/**
 * AudioManager mode of a ringing or running phone call (ringtone, in call,
 * call screening, redirects): every mode CallRoutePolicy.mayTakeCommunicationMode
 * refuses (normal = 0 and in communication = 3 are GO's to use).
 */
const isPhoneCallMode = (mode: unknown): boolean =>
  typeof mode === 'number' && mode > 0 && mode !== 3;

// ── Capture level diagnostics (never a reason to restart the mic) ─────────
/** A frame whose peak is below this is digital silence (< 1 LSB of 16 bit). */
const MIC_ZERO_PEAK = 1e-6;
/** Digital silence this long (frames) is logged once. Platform echo
 *  cancellation can output zeros while the far end talks, so it is only
 *  reported, never acted on. */
const MIC_SILENCE_LOG_FRAMES = 250;

// ── 1:1 WebRTC leg ────────────────────────────────────────────────────────
/** RTP counters of an open 1:1 WebRTC leg are logged this often. */
const RTC_TX_STATS_INTERVAL_MS = 5_000;
/**
 * GO's offer without an answer is sent again (ICE restart, new generation)
 * after these waits. The Hub drops a signal signed more than 20 s before it
 * arrives, and a slow mobile uplink can hold GO's reliable control channel
 * longer than that.
 */
const UNANSWERED_OFFER_RETRY_DELAYS_MS: readonly number[] = [
  20_000, 30_000, 45_000,
];
/** Python's report on a signed control bundle (capacitorBridge relays it). */
const GCALL_CONTROL_BUNDLE_RESULT_EVENT = 'go-gcall-control-bundle-result';
/** Re-offers / answer re-sends from failed bundles: spacing and cap per leg. */
const CONTROL_BUNDLE_RETRY_MIN_GAP_MS = 3_000;
const CONTROL_BUNDLE_RETRY_MAX_PER_LEG = 5;

// ── 1:1 WebRTC leg: lost path (see rtpArrives in installMobileAudioSurface) ──
/** RTP from the peer counts as arriving while its newest packet is younger. */
const RTP_ARRIVES_MAX_AGE_MS = 400;
/** Read again at most this often (Reticulum frames come 50 times a second). */
const RTP_AGE_CACHE_MS = 100;
/** An open leg is looked at this often… */
const RTP_WATCH_INTERVAL_MS = 250;
/** …and its path is suspected after this long without RTP. */
const RTP_SILENT_MS = 2_000;
/** The peer may still be on Reticulum for this long after the leg opened. */
const RTP_OPEN_GRACE_MS = 2_000;
/** Reticulum audio this far behind waited in a queue: from before the leg opened. */
const RETICULUM_STALE_MS = 1_500;
/** Without Reticulum audio for this long, the next says the network is back. */
const PEER_AWAY_MS = 2_000;

/**
 * GO's opt-in options for the shared DirectVoiceWebRtcTransport (desktop
 * passes none). Spread into the options so a transport build without them
 * simply ignores them.
 */
function goDirectVoiceTransportOptions(): {
  unansweredOfferRetryDelaysMs: number[];
} {
  return {
    unansweredOfferRetryDelaysMs: [...UNANSWERED_OFFER_RETRY_DELAYS_MS],
  };
}

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
 * Why a window.groupCall.sendAudio result means "not sent", or null when the
 * frame was handed on. The hosted Hub managers answer like desktop IPC
 * ({success, error}); the old GO port answered {sent, reason}.
 */
function sendAudioFailure(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as {
    success?: unknown;
    error?: unknown;
    sent?: unknown;
    reason?: unknown;
  };
  if ('success' in r) {
    return r.success === false ? String(r.error ?? 'send-failed') : null;
  }
  if ('sent' in r) {
    return Number(r.sent) > 0 ? null : String(r.reason ?? 'not-sent');
  }
  return null;
}

/** Reticulum (Opus) leg counters of one 1:1 session (Copy diagnostics). */
export type MobileVoiceSessionStats = {
  capturing: boolean;
  muted: boolean;
  hearCall: boolean;
  audioContext: string;
  tx: {
    capturedFrames: number;
    encodedChunks: number;
    sentPackets: number;
    sendFailures: number;
    lastSendError: string | null;
    encoderErrors: number;
    encoderRebuilds: number;
    skippedForWebRtc: number;
    /** Captured peak of the last few seconds in dBFS (-120 = digital silence). */
    peakDbfs?: number;
    /** Digital silence right now / the longest run this call (ms). */
    zeroRunMs?: number;
    longestZeroRunMs?: number;
    /** Captured frames that were digital silence. */
    zeroFrames?: number;
    /** "mic digital silence" log lines (≥ 5 s runs). */
    silenceReports?: number;
    /** Mic restarts this capture moved to. */
    micSwaps?: number;
  };
  rx: {
    sources: number;
    events: number;
    decryptedPackets: number;
    decodedFrames: number;
    decoderErrors: number;
    decoderRebuilds: number;
    skippedForWebRtc: number;
    playbackQueue: number;
    playbackPeakQueue: number;
    latencyMs: number;
  };
};

/**
 * One inbound speaker: its own Opus decoder and jitter-buffered playback node.
 * Group calls need one of these per participant — a single decoder fed by
 * interleaved streams from several speakers produces garbage — and the
 * AudioContext graph mixes them for free because they share a destination.
 */
type SourcePipeline = {
  /** Replaced when WebCodecs closes it after a decode error. */
  decoder: AudioDecoder;
  playbackNode: AudioWorkletNode;
  lastDecoderBuildAt: number;
};

/** Frames held while a new speaker's pipeline is still being constructed. */
const MAX_PENDING_FRAMES_PER_SOURCE = 25;

type MobileVoiceSessionOptions = {
  roomId: string;
  sendTargets: string[];
  localAddress: string;
  roomKey: Uint8Array;
  muted?: boolean;
  hearCall?: boolean;
  profile?: GroupCallAudioQualityProfile;
  /** Shared microphone (one capture for WebRTC and Reticulum). Returns a
   *  track this session owns and stops, plus an idempotent release; without
   *  it the session opens its own getUserMedia. */
  acquireMicTrack?: () => Promise<MicHandle>;
  /** True while native WebRTC carries the call: no Reticulum send. */
  shouldSuppressReticulum?: () => boolean;
  /** True while the peer's voice is heard as RTP: no Reticulum playout. */
  shouldSuppressPlayout?: () => boolean;
  /**
   * Inbound packets of the peer would go to playout (not suppressed), `lateMs`
   * behind the quickest ones of this call. False: not these.
   */
  onPeerAudio?: (lateMs: number) => boolean;
  /** Called for every decoded inbound frame (drives media-ready). */
  onDecodedFrame?: () => void;
};

/**
 * A clone of the shared microphone track. `track` is the clone in use: a mic
 * restart hands the consumer a fresh clone through `onReplace` (set by the
 * consumer; throwing keeps it on the old one) and then updates `track`.
 * release() stops the clone in use (idempotent).
 */
type MicHandle = {
  track: MediaStreamTrack;
  release: () => void;
  onReplace: ((next: MediaStreamTrack) => Promise<void> | void) | null;
};

/** Peak of a captured frame as dBFS, -120 for digital silence. */
const peakToDbfs = (peak: number): number =>
  peak > MIC_ZERO_PEAK
    ? Math.max(-120, Math.round(200 * Math.log10(peak)) / 10)
    : -120;

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
};

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

  private profile: GroupCallAudioQualityProfile;
  private readonly acquireMicTrack?: () => Promise<MicHandle>;
  private readonly shouldSuppressReticulum?: () => boolean;
  private readonly shouldSuppressPlayout?: () => boolean;
  private readonly onPeerAudio?: (lateMs: number) => boolean;
  private readonly onDecodedFrame?: () => void;
  private micHandle: MicHandle | null = null;
  private encoderBuild: Promise<void> | null = null;
  private lastEncoderBuildAt = 0;
  // Codec health: WebCodecs closes a codec on error; we rebuild it instead of
  // leaving that speaker (decoder) or our mic (encoder) dead for the call.
  private rxDecoderErrors = 0;
  private rxDecoderRebuilds = 0;
  private txEncoderErrors = 0;
  private txEncoderRebuilds = 0;
  // Frames skipped because native WebRTC carried the call at that moment.
  private rxSuppressedByRtc = 0;
  private txSuppressedByRtc = 0;

  /** Addresses our encoded audio is fanned out to. */
  private sendTargets: string[];
  private sources = new Map<string, SourcePipeline>();
  private sourceBuilds = new Map<string, Promise<SourcePipeline | null>>();
  private pendingBySource = new Map<string, Uint8Array[]>();
  private playbackStarted = false;

  private ctx: AudioContext | null = null;
  private ctxPromise: Promise<AudioContext> | null = null;
  private micStream: MediaStream | null = null;
  /** Feeds captureNode; re-created when a mic restart hands over a track. */
  private micSource: MediaStreamAudioSourceNode | null = null;
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
  private txLastSendError: string | null = null;
  private txLastLogAt = 0;
  // Capture level: peak since the last tx log line (and of the window before,
  // for Copy diagnostics), digital-silence runs. A dead capture shows here as
  // peak=0.0000 with zeroRunMs climbing while frames keep arriving.
  private txPeak = 0;
  private txLastWindowPeak = 0;
  private txZeroFrames = 0;
  private txZeroRunFrames = 0;
  private txLongestZeroRunFrames = 0;
  private txSilenceReported = false;
  private txSilenceReports = 0;
  private micSwaps = 0;
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

  constructor(opts: MobileVoiceSessionOptions) {
    this.roomId = opts.roomId;
    this.sendTargets = [...opts.sendTargets];
    this.localAddress = opts.localAddress;
    this.roomKey = opts.roomKey;
    this.muted = opts.muted === true;
    this.hearCall = opts.hearCall !== false;
    this.profile = opts.profile ?? 'low-latency';
    this.acquireMicTrack = opts.acquireMicTrack;
    this.shouldSuppressReticulum = opts.shouldSuppressReticulum;
    this.shouldSuppressPlayout = opts.shouldSuppressPlayout;
    this.onPeerAudio = opts.onPeerAudio;
    this.onDecodedFrame = opts.onDecodedFrame;
  }

  setRoomKey(k: Uint8Array): void {
    this.roomKey = k;
  }

  isCaptureStarted(): boolean {
    return this.capturing;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  /** Counters for Copy diagnostics (no addresses, no keys). */
  getStats(): MobileVoiceSessionStats {
    return {
      capturing: this.capturing,
      muted: this.muted,
      hearCall: this.hearCall,
      audioContext: this.ctx?.state ?? 'none',
      tx: {
        capturedFrames: this.txCapturedFrames,
        encodedChunks: this.txEncodedChunks,
        sentPackets: this.txSentPackets,
        sendFailures: this.txSendFailures,
        lastSendError: this.txLastSendError,
        encoderErrors: this.txEncoderErrors,
        encoderRebuilds: this.txEncoderRebuilds,
        skippedForWebRtc: this.txSuppressedByRtc,
        peakDbfs: peakToDbfs(Math.max(this.txPeak, this.txLastWindowPeak)),
        zeroRunMs: this.txZeroRunFrames * FRAME_DURATION_MS,
        longestZeroRunMs: this.txLongestZeroRunFrames * FRAME_DURATION_MS,
        zeroFrames: this.txZeroFrames,
        silenceReports: this.txSilenceReports,
        micSwaps: this.micSwaps,
      },
      rx: {
        sources: this.sources.size,
        events: this.rxEvents,
        decryptedPackets: this.rxDecryptedPackets,
        decodedFrames: this.rxDecodedFrames,
        decoderErrors: this.rxDecoderErrors,
        decoderRebuilds: this.rxDecoderRebuilds,
        skippedForWebRtc: this.rxSuppressedByRtc,
        playbackQueue: this.rxPlaybackQ,
        playbackPeakQueue: this.rxPlaybackPeakQ,
        latencyMs: Math.round(this.rxLatencyMs),
      },
    };
  }

  /** Change the Opus profile; a live encoder is rebuilt with the new tuning. */
  setProfile(profile: GroupCallAudioQualityProfile | undefined): void {
    if (!profile || profile === this.profile) return;
    this.profile = profile;
    const encoder = this.encoder;
    if (!encoder) return;
    this.encoder = null;
    this.encodeMetaQueue = [];
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      /* ignore */
    }
    this.lastEncoderBuildAt = 0;
    this.ensureEncoder();
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

        const pipeline = {
          playbackNode,
          lastDecoderBuildAt: Date.now(),
        } as SourcePipeline;
        pipeline.decoder = this.createDecoder(pipeline);
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

  /** Opus decoder feeding one speaker's playback worklet. */
  private createDecoder(pipeline: SourcePipeline): AudioDecoder {
    const decoder = new AudioDecoder({
      output: (data: AudioData) => {
        try {
          // Counted before the hearCall check: "media is flowing" does not
          // depend on whether the user deafened the call.
          this.rxDecodedFrames += 1;
          this.onDecodedFrame?.();
          if (!this.hearCall) return;
          const n = data.numberOfFrames;
          const pcm = new Float32Array(n);
          data.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
          let sumSq = 0;
          for (let i = 0; i < n; i++) sumSq += pcm[i]! * pcm[i]!;
          const rms = n > 0 ? Math.sqrt(sumSq / n) : 0;
          if (rms > this.rxPeakRms) this.rxPeakRms = rms;
          pipeline.playbackNode.port.postMessage(pcm, [pcm.buffer]);
        } catch {
          /* drop frame */
        } finally {
          data.close();
        }
      },
      error: () => {
        // WebCodecs closes the decoder on error; decodeInto() rebuilds it.
        this.rxDecoderErrors += 1;
      },
    });
    decoder.configure({
      codec: 'opus',
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 1,
    });
    return decoder;
  }

  private decodeInto(
    pipeline: SourcePipeline,
    opusFrame: Uint8Array,
    timestampMs: number
  ): void {
    if (pipeline.decoder.state === 'closed') {
      const now = Date.now();
      if (now - pipeline.lastDecoderBuildAt < CODEC_REBUILD_MIN_INTERVAL_MS) {
        return;
      }
      pipeline.lastDecoderBuildAt = now;
      try {
        pipeline.decoder = this.createDecoder(pipeline);
        this.rxDecoderRebuilds += 1;
      } catch {
        return;
      }
    }
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
    // Once native RTP plays, ignore fallback frames still in flight so the two
    // playback paths never double the same voice (desktop RT:6660-6668).
    if (this.shouldSuppressPlayout?.()) {
      this.rxSuppressedByRtc += 1;
      return;
    }
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
    const lateMs =
      nowMs -
      packets[0].timestampMs -
      Math.min(this.rxOffsetBaseline, nowMs - packets[0].timestampMs);
    if (this.onPeerAudio?.(lateMs) === false) {
      this.rxSuppressedByRtc += 1;
      return;
    }
    for (const pkt of packets) {
      const offset = nowMs - pkt.timestampMs;
      if (offset < this.rxOffsetBaseline) this.rxOffsetBaseline = offset;
      this.rxLatencyMs = offset - this.rxOffsetBaseline;
      // The packet's own sender address is the most precise split; fall back to
      // the transport's peer hash, and finally to a single shared pipeline.
      const sourceKey = pkt.sourceAddr || payload.peerPresenceHash || 'default';
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
        '[audioSurface] rx sources=%d events=%d decryptedPackets=%d decodedFrames=%d peakRms=%s decodeQ=%d playQ=%d/%d latencyMs=%d hear=%s ctx=%s decErr=%d decRebuild=%d rtcSkipped=%d',
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
        this.ctx?.state ?? 'none',
        this.rxDecoderErrors,
        this.rxDecoderRebuilds,
        this.rxSuppressedByRtc
      );
      this.rxPeakRms = 0;
    }
  }

  /** Opus encoder configured like desktop group/DM voice (voip, in-band FEC,
   *  20 ms, profile bitrate). Replaces any previous encoder. */
  private async buildEncoder(): Promise<void> {
    const encoder = new AudioEncoder({
      output: (chunk: EncodedAudioChunk) => {
        if (this.encoder === encoder) this.onEncodedChunk(chunk);
      },
      error: () => {
        // WebCodecs has closed this encoder; the next captured frame rebuilds.
        this.txEncoderErrors += 1;
        if (this.encoder === encoder) {
          this.encoder = null;
          this.encodeMetaQueue = [];
        }
      },
    });
    try {
      await configureWebCodecsOpusEncoderForGcall(
        encoder,
        getGroupCallAudioTuning(this.profile),
        {
          sampleRate: SAMPLE_RATE,
          numberOfChannels: 1,
          frameDurationMs: FRAME_DURATION_MS,
        }
      );
    } catch (err) {
      try {
        encoder.close();
      } catch {
        /* ignore */
      }
      throw err;
    }
    if (this.disposed) {
      try {
        encoder.close();
      } catch {
        /* ignore */
      }
      return;
    }
    const previous = this.encoder;
    this.encodeMetaQueue = [];
    this.encoder = encoder;
    if (previous && previous !== encoder) {
      try {
        if (previous.state !== 'closed') previous.close();
      } catch {
        /* ignore */
      }
    }
  }

  /** Rebuild a closed encoder in the background (rate limited). */
  private ensureEncoder(): void {
    if (this.disposed || !this.capturing || this.encoderBuild) return;
    if (this.encoder && this.encoder.state !== 'closed') return;
    const now = Date.now();
    if (now - this.lastEncoderBuildAt < CODEC_REBUILD_MIN_INTERVAL_MS) return;
    this.lastEncoderBuildAt = now;
    this.txEncoderRebuilds += 1;
    this.encoderBuild = this.buildEncoder()
      .catch((err) => {
        console.warn('[audioSurface] Opus encoder rebuild failed', err);
      })
      .finally(() => {
        this.encoderBuild = null;
      });
  }

  /** Open the microphone: the surface's shared capture, else our own. */
  private async openMicStream(): Promise<MediaStream> {
    if (this.acquireMicTrack) {
      const handle = await this.acquireMicTrack();
      this.micHandle = handle;
      handle.onReplace = (next) => this.replaceMicTrack(next);
      // The capture worklet path owns muting (frames are dropped while
      // muted), so this track stays enabled even if WebRTC's is disabled.
      handle.track.enabled = true;
      return new MediaStream([handle.track]);
    }
    return navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  }

  /**
   * Mic restart: capture from `next`, a clone of the new shared microphone.
   * The new source is connected before the old one is dropped. The surface
   * stops the old clone afterwards. Throws (and changes nothing) when the
   * session is gone or the graph refuses the track.
   */
  replaceMicTrack(next: MediaStreamTrack): void {
    if (this.disposed) throw new Error('session disposed');
    next.enabled = true; // muting stays in onCapturedFrame
    const stream = new MediaStream([next]);
    const ctx = this.ctx;
    const capture = this.captureNode;
    if (ctx && ctx.state !== 'closed' && capture) {
      const source = ctx.createMediaStreamSource(stream);
      source.connect(capture);
      const old = this.micSource;
      this.micSource = source;
      try {
        old?.disconnect();
      } catch {
        /* ignore */
      }
    }
    // Before the worklet exists (capture still starting) startCapture builds
    // its source from this stream.
    this.micStream = stream;
    this.micSwaps += 1;
    this.txZeroRunFrames = 0;
    this.txSilenceReported = false;
  }

  private closeMic(): void {
    try {
      this.micStream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    const handle = this.micHandle;
    this.micStream = null;
    this.micHandle = null;
    handle?.release();
  }

  /** Start mic capture → encode → send. */
  async startCapture(): Promise<void> {
    if (this.capturing || this.disposed) return;
    this.capturing = true;
    try {
      // Microphone first: Chromium switches to communication mode when the
      // echo-cancelled capture opens, and an AudioContext created after that
      // plays on the call route together with WebRTC audio.
      this.micStream = await this.openMicStream();
      if (this.disposed) throw new Error('session disposed');
      const ctx = await this.ensureContext();

      await this.buildEncoder();
      this.lastEncoderBuildAt = Date.now();

      const source = ctx.createMediaStreamSource(this.micStream);
      const capture = await this.makeWorkletNode('pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      capture.port.onmessage = (e: MessageEvent) => {
        this.onCapturedFrame(e.data as Float32Array);
      };
      source.connect(capture);
      this.micSource = source;
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
        this.captureNode?.disconnect();
      } catch {
        /* ignore */
      }
      this.captureNode = null;
      try {
        this.micSource?.disconnect();
      } catch {
        /* ignore */
      }
      this.micSource = null;
      this.closeMic();
      throw err;
    }
  }

  private onCapturedFrame(frame: Float32Array): void {
    if (this.disposed) return;
    this.txCapturedFrames += 1;
    // Measured before mute / WebRTC: the clone stays enabled, so this is what
    // the microphone delivers whichever leg carries the call.
    let peak = 0;
    for (let i = 0; i < frame.length; i++) {
      const a = Math.abs(frame[i]!);
      if (a > peak) peak = a;
    }
    this.noteCapturedPeak(peak);
    this.maybeLogTx();
    if (this.muted) return;
    // Native WebRTC carries our voice: skip encoding so the fallback neither
    // costs battery nor consumes sequence numbers (desktop RT:2176-2186).
    if (this.shouldSuppressReticulum?.()) {
      this.txSuppressedByRtc += 1;
      return;
    }
    if (!this.encoder || this.encoder.state === 'closed') {
      this.encoder = null;
      this.ensureEncoder();
      return;
    }
    if (this.encoder.state !== 'configured') return;
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
    // A frame still in the encoder when WebRTC took over: drop it without
    // consuming a sequence number, so a later fallback has no artificial gap.
    if (this.shouldSuppressReticulum?.()) {
      this.txSuppressedByRtc += 1;
      return;
    }
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
          // Count a real send vs a drop so we can see whether audio leaves.
          const failure = sendAudioFailure(r);
          if (failure === null) {
            this.txSentPackets += 1;
          } else {
            this.txSendFailures += 1;
            this.txLastSendError = failure;
          }
        })
        .catch((error) => {
          this.txSendFailures += 1;
          this.txLastSendError = errorMessage(error);
        });
    }
  }

  /** Level bookkeeping for one captured frame (diagnostics only). */
  private noteCapturedPeak(peak: number): void {
    if (peak > this.txPeak) this.txPeak = peak;
    if (peak > MIC_ZERO_PEAK) {
      if (this.txSilenceReported) {
        console.log(
          '[audioSurface] mic sound again after %d ms of digital silence',
          this.txZeroRunFrames * FRAME_DURATION_MS
        );
      }
      this.txZeroRunFrames = 0;
      this.txSilenceReported = false;
      return;
    }
    this.txZeroFrames += 1;
    this.txZeroRunFrames += 1;
    if (this.txZeroRunFrames > this.txLongestZeroRunFrames) {
      this.txLongestZeroRunFrames = this.txZeroRunFrames;
    }
    if (
      !this.txSilenceReported &&
      this.txZeroRunFrames >= MIC_SILENCE_LOG_FRAMES
    ) {
      // Reported, never acted on: echo cancellation may output zeros while
      // the other side talks. A dead capture after a device change is handled
      // by the device-change restart instead.
      this.txSilenceReported = true;
      this.txSilenceReports += 1;
      console.warn(
        '[audioSurface] mic digital silence',
        JSON.stringify({
          zeroRunMs: this.txZeroRunFrames * FRAME_DURATION_MS,
          muted: this.muted,
          webrtcCarries: this.shouldSuppressReticulum?.() === true,
          micSwaps: this.micSwaps,
        })
      );
    }
  }

  private maybeLogTx(): void {
    const now = Date.now();
    if (now - this.txLastLogAt < 2500) return;
    this.txLastLogAt = now;
    // capturedFrames>0 ⇒ mic worklet alive; muted ⇒ caller silenced us;
    // encodedChunks ⇒ Opus encoder producing; sentPackets ⇒ bridge accepted
    // for transmit; sendFailures ⇒ no peer dest / link error; peak ⇒ loudest
    // captured sample since the last line (0.0000 with zeroRunMs climbing =
    // the capture delivers digital silence). New fields go at the end.
    console.log(
      '[audioSurface] tx capturedFrames=%d muted=%s encodedChunks=%d sentPackets=%d sendFailures=%d lastSendErr=%s encErr=%d encRebuild=%d rtcSkipped=%d peak=%s zeroRunMs=%d',
      this.txCapturedFrames,
      this.muted,
      this.txEncodedChunks,
      this.txSentPackets,
      this.txSendFailures,
      this.txLastSendError ?? 'none',
      this.txEncoderErrors,
      this.txEncoderRebuilds,
      this.txSuppressedByRtc,
      this.txPeak.toFixed(4),
      this.txZeroRunFrames * FRAME_DURATION_MS
    );
    this.txLastWindowPeak = this.txPeak;
    this.txPeak = 0;
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
    try {
      this.micSource?.disconnect();
    } catch {
      /* ignore */
    }
    this.micSource = null;
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
    this.closeMic();
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

const trimId = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/** Same rule as the desktop runtime: exactly 32 bytes, copied. */
const normalizeRoomKey = (
  value: ArrayBuffer | Uint8Array | undefined
): Uint8Array | null => {
  const bytes =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : null;
  if (!bytes || bytes.byteLength !== 32) return null;
  return new Uint8Array(bytes);
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Desktop projection (RT:1786-1808): 'open' only once remote audio plays. */
function projectDirectVoiceRtcState(
  state: DirectVoiceRtcState,
  remoteAudioPlaying: boolean
): 'connecting' | 'open' | 'closed' | 'failed' {
  if (state === 'open') return remoteAudioPlaying ? 'open' : 'connecting';
  if (state === 'closed') return 'closed';
  if (state === 'idle' || state === 'connecting' || state === 'recovering') {
    return 'connecting';
  }
  return 'failed';
}

/** Native WebRTC leg of the current 1:1 call (desktop runtime equivalent). */
type DirectVoiceRtc = {
  transport: DirectVoiceWebRtcTransport;
  /** Clone of the shared mic; WebRTC owns its enabled flag (mute). */
  mic: MicHandle;
  remoteAudio: HTMLAudioElement | null;
  /** Remote audio reached `playing` (gates the Reticulum fallback). */
  mediaReadyEmitted: boolean;
  lifecycle: number;
  ownerId: string;
  roomId: string;
  peerAddress: string;
  /** Diagnostics: last transport state and its projection for the hook. */
  transportState: string;
  projectedState: string;
  startedAt: number;
  playingAt: number | null;
  /** getStats() poll while the leg is open (RTC_TX_STATS_INTERVAL_MS). */
  statsTimer: ReturnType<typeof setInterval> | null;
  statsInFlight: boolean;
  statsPolls: number;
  statsMisses: number;
  txStats: (RtcTxStats & { at: number }) | null;
  /** Lost path: the age of the newest RTP packet and when it was read. */
  rtpAge: number | null;
  rtpAgeAt: number;
  /** Since when the leg is open (0 = not), and whether RTP has arrived then. */
  openSince: number;
  rtpSeen: boolean;
  rtpWatchTimer: ReturnType<typeof setInterval> | null;
  /** When the peer was last heard over Reticulum with the leg not open. */
  peerHeardAt: number;
  /** Re-offers / answer re-sends after Python reported a failed bundle. */
  controlRetries: Record<'offer' | 'answer', { count: number; lastAt: number }>;
};

/**
 * RTP counters of the 1:1 WebRTC leg (RTCPeerConnection.getStats, audio
 * only). Numbers only: no ids, addresses, candidates or codecs.
 * roundTripTime and jitter are in seconds, as in the stats API.
 */
export type RtcTxStats = {
  /** What the microphone track delivers to the sender. */
  source: {
    audioLevel: number | null;
    totalAudioEnergy: number | null;
    totalSamplesDuration: number | null;
  } | null;
  outbound: {
    packetsSent: number | null;
    bytesSent: number | null;
  } | null;
  /** The peer's receiver report on our stream. */
  remoteInbound: {
    packetsLost: number | null;
    fractionLost: number | null;
    roundTripTime: number | null;
    jitter: number | null;
  } | null;
  inbound: {
    packetsReceived: number | null;
    packetsLost: number | null;
    jitter: number | null;
    audioLevel: number | null;
    totalAudioEnergy: number | null;
  } | null;
};

/** Pick the named numeric fields of one stats entry; null when none is set. */
function pickRtcNumbers<K extends string>(
  stat: Record<string, unknown> | null,
  keys: readonly K[]
): Record<K, number | null> | null {
  if (!stat) return null;
  let any = false;
  const out = {} as Record<K, number | null>;
  for (const key of keys) {
    const value = stat[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
      any = true;
    } else {
      out[key] = null;
    }
  }
  return any ? out : null;
}

/** The audio entries of a getStats() report (see RtcTxStats). */
export function summarizeRtcTxStats(report: {
  forEach: (cb: (stat: unknown) => void) => void;
}): RtcTxStats {
  const audio = (stat: Record<string, unknown>) =>
    (stat.kind ?? stat.mediaType) === 'audio';
  const byType = new Map<string, Array<Record<string, unknown>>>();
  report.forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const stat = raw as Record<string, unknown>;
    if (typeof stat.type !== 'string' || !audio(stat)) return;
    const list = byType.get(stat.type) ?? [];
    list.push(stat);
    byType.set(stat.type, list);
  });
  const most = (type: string, counter: string) => {
    const list = byType.get(type) ?? [];
    let best: Record<string, unknown> | null = null;
    for (const stat of list) {
      const n =
        typeof stat[counter] === 'number' ? (stat[counter] as number) : 0;
      const b =
        best && typeof best[counter] === 'number'
          ? (best[counter] as number)
          : -1;
      if (!best || n > b) best = stat;
    }
    return best;
  };
  const outbound = most('outbound-rtp', 'packetsSent');
  const sources = byType.get('media-source') ?? [];
  const source =
    sources.find((s) => outbound && s.id === outbound.mediaSourceId) ??
    sources[0] ??
    null;
  const remotes = byType.get('remote-inbound-rtp') ?? [];
  const remote =
    remotes.find((s) => outbound && s.localId === outbound.id) ??
    remotes[0] ??
    null;
  return {
    source: pickRtcNumbers(source, [
      'audioLevel',
      'totalAudioEnergy',
      'totalSamplesDuration',
    ] as const),
    outbound: pickRtcNumbers(outbound, ['packetsSent', 'bytesSent'] as const),
    remoteInbound: pickRtcNumbers(remote, [
      'packetsLost',
      'fractionLost',
      'roundTripTime',
      'jitter',
    ] as const),
    inbound: pickRtcNumbers(most('inbound-rtp', 'packetsReceived'), [
      'packetsReceived',
      'packetsLost',
      'jitter',
      'audioLevel',
      'totalAudioEnergy',
    ] as const),
  };
}

/** Copy diagnostics: the surface's call audio, without addresses or keys. */
export type MobileCallAudioDiagnostics = {
  at: number;
  installed: boolean;
  route: {
    kind: CallAudioRouteKind | null;
    speaker: boolean;
    native: NativeCallRouteSnapshot | null;
    lastError: string | null;
  };
  transportPreference: string;
  privacy: Record<string, number>;
  /**
   * The surface's shared microphone, used by 1:1 calls only (`use: '1:1'`).
   * A group call captures with its own engine: see `group.mic`.
   */
  mic: {
    use?: '1:1';
    open: boolean;
    holders: number;
    trackState: string;
    /** Captures opened for 1:1 calls since install (a restart opens one). */
    generation?: number;
    /** Mic restarts (headset came or went, capture ended) and failures. */
    restarts?: number;
    restartFailures?: number;
    /** A restart is waiting or running. */
    restarting?: boolean;
    /**
     * Headset input routes ('bluetooth', 'wired', comma-separated; '' =
     * none) Android listed when the capture was opened; null = unknown.
     */
    captureInputs?: string | null;
    lastRestart?: {
      reason: string;
      ok: boolean;
      /** Consumers moved to the new capture. */
      moved: number;
      ms: number;
      error: string | null;
      ageMs: number;
    } | null;
  } | null;
  direct: {
    active: boolean;
    owner: boolean;
    room: string | null;
    peer: string | null;
    /** 'webrtc' while WebRTC carries the audio, else 'reticulum' / 'none'. */
    carriedBy: 'webrtc' | 'reticulum' | 'none';
    mediaReady: boolean;
    rtc: {
      state: string;
      transportState: string;
      remoteAudioPlaying: boolean;
      ageMs: number;
      playingAfterMs: number | null;
      /** Re-offers / answer re-sends after a failed control bundle. */
      reoffers?: number;
      answerResends?: number;
    } | null;
    /** Last RTP counters of the WebRTC leg (polled every 5 s while open). */
    rtcStats?: (RtcTxStats & { ageMs: number; polls: number }) | null;
    reticulum: MobileVoiceSessionStats | null;
  } | null;
  group: {
    active: boolean;
    runtimeLoaded: boolean;
    room: string | null;
    roomState: string | null;
    myRole: string | null;
    participants: number;
    speaking: number;
    transport: string | null;
    joinError: string | null;
    packetsReceived: number | null;
    packetsDecoded: number | null;
    packetsForwarded: number | null;
    packetsDropped: number | null;
    rtcEdges: Record<string, string>;
    rtcPolicy: string;
    /** The group engine's own capture (its sender's getUserMedia). */
    mic?: {
      open: boolean;
      tracks: number;
      trackState: string;
      /** The track's source is muted (e.g. Android took the mic away). */
      trackMuted: boolean | null;
      capturing: boolean;
      /** The user's mute in the group call. */
      userMuted: boolean | null;
      encoder: string | null;
    } | null;
  } | null;
};

// ── Group calls: "Private calls" for the runtime's DataChannel edges ──────
//
// The shared GroupCallAudioEngineRuntime opens one RTCPeerConnection +
// DataChannel per topology edge (createGroupRtcTransport) as soon as it has a
// topology, whether or not it can signal WebRTC. With "Private calls"
// (callTransportPreference 'reticulum') or without
// window.groupCall.sendRtcSignal (hidden by the hosted bridge for that
// setting, missing in the old port) GO must not create them at all. The
// runtime cannot be changed for GO (it is Hub-shared), so the GO surface
// wraps three of its (TypeScript-private) methods on the instance it owns:
//   createGroupRtcTransport  → an inert stand-in (no peer connection, never
//                              stored) while WebRTC is not allowed;
//   syncGroupRtcTransports   → also closes edges that are not open yet, so
//                              nothing new connects after the switch;
//   sendGroupRtcSignal       → refused before signing (no capability is
//                              advertised), except on an edge that is open.
// An edge that is already open stays until it closes (same rule as a live
// 1:1 WebRTC leg: the setting applies to connections made after it). When
// WebRTC is allowed again the next sync (3 s maintenance, or right away on
// the setting change) creates real edges. Audio on edges without WebRTC goes
// over Reticulum, exactly as when a peer has no WebRTC.
// The names are checked at run time (applyGoGroupRtcTransportPolicy returns
// false and logs if one is missing) and by a test against the real runtime.

type GroupRtcTransportLike = {
  isOpen(): boolean;
};

type GroupRtcPolicyTarget = {
  groupRtcTransports?: unknown;
  /** Capability bookkeeping (Map / Set); optional — only cleaned up. */
  groupRtcCapabilityLastSentAt?: unknown;
  groupRtcCapabilities?: unknown;
  createGroupRtcTransport?: (peerAddress: string) => unknown;
  syncGroupRtcTransports?: () => Promise<void>;
  sendGroupRtcSignal?: (peerAddress: string, signal: unknown) => Promise<void>;
  closeGroupRtcTransport?: (peerAddress: string, reason: string) => void;
};

/** Stands in for a DataChannel edge GO must not create (no peer connection). */
const INERT_GROUP_RTC_TRANSPORT = Object.freeze({
  isOpen: () => false,
  send: () => false,
  start: async () => {},
  enableNegotiation: async () => {},
  handleSignal: async () => {},
  restartIce: async () => {},
  requestRecovery: async () => {},
  updateIceServers: async () => {},
  close: () => {},
});

export const GROUP_RTC_DISABLED_ERROR = 'group-rtc-disabled-by-user';

/** Group WebRTC edges are allowed: the setting and the bridge both allow it. */
export function isGroupWebRtcAllowed(): boolean {
  try {
    if (getCallTransportPreference() === 'reticulum') return false;
  } catch {
    /* default: allowed by the setting */
  }
  const gc = (window as unknown as { groupCall?: { sendRtcSignal?: unknown } })
    .groupCall;
  return typeof gc?.sendRtcSignal === 'function';
}

/**
 * Wrap the runtime instance's group WebRTC edge handling (see above).
 * Returns false (and changes nothing) when the runtime lacks a member.
 */
export function applyGoGroupRtcTransportPolicy(
  runtime: unknown,
  isAllowed: () => boolean = isGroupWebRtcAllowed
): boolean {
  const rt = runtime as GroupRtcPolicyTarget | null;
  if (
    !rt ||
    !(rt.groupRtcTransports instanceof Map) ||
    typeof rt.createGroupRtcTransport !== 'function' ||
    typeof rt.syncGroupRtcTransports !== 'function' ||
    typeof rt.sendGroupRtcSignal !== 'function' ||
    typeof rt.closeGroupRtcTransport !== 'function'
  ) {
    return false;
  }
  const transports = rt.groupRtcTransports as Map<
    string,
    GroupRtcTransportLike
  >;
  const create = rt.createGroupRtcTransport.bind(rt);
  const sync = rt.syncGroupRtcTransports.bind(rt);
  const sendSignal = rt.sendGroupRtcSignal.bind(rt);
  const close = rt.closeGroupRtcTransport.bind(rt);
  const openEdge = (peerAddress: string): boolean => {
    try {
      return transports.get(peerAddress)?.isOpen() === true;
    } catch {
      return false;
    }
  };
  // A refused send must not count as sent. The runtime stamps a capability
  // as sent before it calls sendGroupRtcSignal (retry only after 12 s) and
  // replies to a peer's capability only the first time it sees it; both
  // would hold WebRTC up for up to 12 s after the switch back to Direct (a
  // Hub that answers waits for GO's capability before it negotiates). The
  // inert stand-ins are never stored or closed, so the runtime would not
  // clear that bookkeeping itself.
  const forgetRefusedCapability = (peerAddress: string, signal: unknown) => {
    try {
      const lastSentAt = rt.groupRtcCapabilityLastSentAt;
      if (lastSentAt instanceof Map) lastSentAt.delete(peerAddress);
      const capabilities = rt.groupRtcCapabilities;
      if (
        capabilities instanceof Set &&
        (signal as { type?: unknown } | null)?.type === 'capability'
      ) {
        capabilities.delete(peerAddress);
      }
    } catch {
      /* bookkeeping only */
    }
  };
  rt.createGroupRtcTransport = (peerAddress: string) => {
    const existing = transports.get(peerAddress);
    if (existing) return existing;
    if (!isAllowed()) return INERT_GROUP_RTC_TRANSPORT;
    return create(peerAddress);
  };
  rt.syncGroupRtcTransports = async () => {
    if (!isAllowed()) {
      for (const peerAddress of [...transports.keys()]) {
        if (!openEdge(peerAddress)) close(peerAddress, 'go-private-calls');
      }
    }
    return sync();
  };
  rt.sendGroupRtcSignal = async (peerAddress: string, signal: unknown) => {
    if (!isAllowed() && !openEdge(peerAddress)) {
      forgetRefusedCapability(peerAddress, signal);
      throw new Error(GROUP_RTC_DISABLED_ERROR);
    }
    return sendSignal(peerAddress, signal);
  };
  return true;
}

/** Short, non-identifying form of an address or room id for diagnostics. */
const shortId = (value: string | null | undefined): string | null => {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return null;
  return v.length <= 10 ? v : `${v.slice(0, 6)}…${v.slice(-2)}`;
};

let surfaceDiagnostics:
  | (() => Pick<MobileCallAudioDiagnostics, 'mic' | 'direct' | 'group'>)
  | null = null;

/**
 * Snapshot of GO's call audio for Copy diagnostics: route (with what Android
 * reported), 1:1 legs (WebRTC state, Reticulum tx/rx counters), the group
 * runtime's state, mic and privacy counters. Never contains keys, SDP, IP
 * addresses or full Qortal addresses. Safe to call at any time.
 */
export function getMobileCallAudioDiagnostics(): MobileCallAudioDiagnostics {
  let transportPreference = 'unknown';
  try {
    transportPreference = getCallTransportPreference();
  } catch {
    /* keep unknown */
  }
  let privacy: Record<string, number> = {};
  try {
    privacy = { ...getWebRtcPrivacyStats() } as unknown as Record<
      string,
      number
    >;
  } catch {
    /* keep empty */
  }
  let surface: Pick<MobileCallAudioDiagnostics, 'mic' | 'direct' | 'group'> = {
    mic: null,
    direct: null,
    group: null,
  };
  try {
    if (surfaceDiagnostics) surface = surfaceDiagnostics();
  } catch {
    /* keep empty */
  }
  return {
    at: Date.now(),
    installed: surfaceDiagnostics !== null,
    route: {
      kind: callAudioRouteKind,
      speaker: currentSpeaker(),
      native: lastNativeRoute
        ? { ...lastNativeRoute, routes: [...lastNativeRoute.routes] }
        : null,
      lastError: lastNativeRouteError,
    },
    transportPreference,
    privacy,
    ...surface,
  };
}

export function installMobileAudioSurface(): void {
  if (installed) return;
  if (typeof window === 'undefined') return;
  // Before any call can create an RTCPeerConnection in GO's window (the DM
  // transport below, the group runtime, the hook's screen-share viewer).
  // No-op outside GO; idempotent if the bridge installed it already.
  try {
    installWebRtcPrivacyGuard();
  } catch (e) {
    console.warn('[audioSurface] WebRTC privacy guard failed to install', e);
  }
  if (window.audioSurface) return;
  if (!isMobileAudioSurfaceSupported()) {
    console.warn(
      '[audioSurface] WebCodecs/AudioWorklet unavailable — DM voice will stay silent on this device'
    );
    return;
  }
  installed = true;

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

  // ── 1:1 call state (mirrors the desktop runtime's directVoice* fields) ──
  /** Reticulum Opus media (or receive-only) for the current 1:1 call. */
  let session: MobileVoiceSession | null = null;
  let rtc: DirectVoiceRtc | null = null;
  let rtcLifecycle = 0;
  let dmOwnerId = '';
  let dmRoomId = '';
  let dmPeerAddress = '';
  let dmLocalAddress = '';
  let dmMuted = false;
  let dmHearCall = true;
  let dmReticulumMediaReadyEmitted = false;

  // ── Shared microphone: one getUserMedia, a clone per consumer ──────────
  //
  // Mic restart. When Android's route shows that a headset (Bluetooth,
  // wired, USB) came or went since the capture was opened (any route event
  // or AudioRouting result; while a phone call holds the audio, once GO has
  // it back), or the capture ended (tried again when a phone call that
  // held the microphone is over), the surface opens the microphone
  // again and moves both consumers (the Reticulum capture worklet and the
  // WebRTC sender, via the shared transport's replaceLocalStream) to the new
  // capture. Field case: a call kept a live track that delivered digital
  // silence after the Bluetooth headset left, while a fresh getUserMedia had
  // sound. Break first: the old capture and every clone are stopped BEFORE
  // the new getUserMedia, so Chromium closes the old source and opens a new
  // AudioRecord (a getUserMedia next to a live one hands back that same,
  // possibly dead, source). Never on silence alone: platform echo
  // cancellation can output zeros while the far end talks, so silence is
  // only logged (tx `peak` / `zeroRunMs`). Restarts are debounced (2 s
  // apart, 6 a minute), run in the command queue in two short steps (the
  // getUserMedia wait is outside it, so a hang-up never waits for it), keep
  // the mute state, end on hang-up and re-assert the call route afterwards
  // (Chromium's echo canceller grabs the communication device).
  type MicHolder = {
    handle: MicHandle;
    /** micGeneration the holder's clone was taken from. */
    generation: number;
    released: boolean;
    swapping: boolean;
    /** The clone a running swap hands over (live until it settles). */
    pendingTrack: MediaStreamTrack | null;
  };
  let micStream: MediaStream | null = null;
  let micPending: Promise<MediaStream> | null = null;
  /** null while that consumer's acquireMic is still running. */
  const micHolders = new Map<symbol, MicHolder | null>();
  let micGeneration = 0;
  let detachMicWatch: (() => void) | null = null;
  let micRestartTimer: ReturnType<typeof setTimeout> | null = null;
  let micRestartDueAt = 0;
  let micRestartReasons: string[] = [];
  let micRestartEpoch = 0;
  let micRestartInFlight: {
    epoch: number;
    reasons: string[];
    startedAt: number;
    pending: Promise<MediaStream>;
  } | null = null;
  let micRestartWatchdog: ReturnType<typeof setTimeout> | null = null;
  let micRestartAgain = false;
  let micLastRestartAt = 0;
  const micRestartTimes: number[] = [];
  let micRestartFailuresInRow = 0;
  let micResyncTimer: ReturnType<typeof setTimeout> | null = null;
  let micResyncTries = 0;
  /**
   * Headset input routes ('bluetooth,wired', '' = none) Android listed when
   * the current capture's getUserMedia started; null until a route state of
   * this call listed them (the next one becomes the baseline). Every route
   * update is compared with it, not with the update before: native
   * re-computes the routes on every re-apply, so an earlier event or call
   * result can already carry the new device set.
   */
  let micCaptureInputs: string | null = null;
  /** Same, for the getUserMedia in micPending. */
  let micOpeningInputs: string | null = null;
  const micRestartStats = {
    restarts: 0,
    failures: 0,
    last: null as {
      reason: string;
      ok: boolean;
      moved: number;
      ms: number;
      error: string | null;
      at: number;
    } | null,
  };

  const liveMicTrack = (): MediaStreamTrack | null =>
    micStream?.getAudioTracks().find((t) => t.readyState === 'live') ?? null;

  const liveMicHolders = (): MicHolder[] =>
    [...micHolders.values()].filter(
      (holder): holder is MicHolder => !!holder && !holder.released
    );

  const stopTrackQuietly = (track: MediaStreamTrack | null | undefined) => {
    try {
      track?.stop();
    } catch {
      /* ignore */
    }
  };

  /** The capture's source ended (our own stop() fires no 'ended'). */
  const watchMicSource = (stream: MediaStream): (() => void) | null => {
    const base = stream.getAudioTracks()[0];
    if (!base || typeof base.addEventListener !== 'function') return null;
    const onEnded = () => {
      if (micStream !== stream) return;
      console.warn('[audioSurface] mic capture ended');
      requestMicRestart('track-ended', 0);
    };
    base.addEventListener('ended', onEnded);
    return () => {
      try {
        base.removeEventListener('ended', onEnded);
      } catch {
        /* ignore */
      }
    };
  };

  /** Make `stream` the shared capture: a new generation of clones. */
  const adoptMicStream = (stream: MediaStream): void => {
    if (micStream === stream) return;
    detachMicWatch?.();
    detachMicWatch = null;
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = stream;
    micGeneration += 1;
    detachMicWatch = watchMicSource(stream);
  };

  /** Drop a waiting or running restart (the last consumer let go). */
  const abortMicRestart = (): void => {
    if (micRestartTimer) clearTimeout(micRestartTimer);
    micRestartTimer = null;
    if (micRestartWatchdog) clearTimeout(micRestartWatchdog);
    micRestartWatchdog = null;
    if (micResyncTimer) clearTimeout(micResyncTimer);
    micResyncTimer = null;
    micResyncTries = 0;
    micRestartReasons = [];
    micRestartAgain = false;
    micRestartFailuresInRow = 0;
    if (micRestartInFlight && micPending === micRestartInFlight.pending) {
      micPending = null;
    }
    micRestartInFlight = null;
    // A getUserMedia still on its way finds a stale epoch and is stopped.
    micRestartEpoch += 1;
  };

  const stopMicIfUnused = (): void => {
    if (micHolders.size > 0) return;
    abortMicRestart();
    detachMicWatch?.();
    detachMicWatch = null;
    micCaptureInputs = null;
    if (!micStream) return;
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  };

  /** Returns a clone of the call microphone and whether getUserMedia ran. */
  const acquireMic = async (): Promise<{
    handle: MicHandle;
    opened: boolean;
  }> => {
    const token = Symbol('mic');
    micHolders.set(token, null);
    try {
      let base = liveMicTrack();
      let opened = false;
      if (!base) {
        // Also joins a restart's getUserMedia that is on its way.
        if (!micPending) {
          micOpeningInputs = currentNativeInputRoutes();
          const pending: Promise<MediaStream> = navigator.mediaDevices
            .getUserMedia(MIC_CONSTRAINTS)
            .finally(() => {
              if (micPending === pending) micPending = null;
            });
          micPending = pending;
        }
        const stream = await micPending;
        if (micStream !== stream) {
          adoptMicStream(stream);
          micCaptureInputs = micOpeningInputs;
        }
        opened = true;
        base = liveMicTrack();
      }
      if (!base) throw new Error('microphone-track-missing');
      if (!micHolders.has(token)) throw new Error('microphone-released');
      const holder: MicHolder = {
        generation: micGeneration,
        released: false,
        swapping: false,
        pendingTrack: null,
        handle: {
          track: base.clone(),
          onReplace: null,
          release: () => {
            if (holder.released) return;
            holder.released = true;
            stopTrackQuietly(holder.handle.track);
            stopTrackQuietly(holder.pendingTrack);
            micHolders.delete(token);
            stopMicIfUnused();
          },
        },
      };
      micHolders.set(token, holder);
      return { opened, handle: holder.handle };
    } catch (error) {
      micHolders.delete(token);
      stopMicIfUnused();
      throw error;
    }
  };

  const pruneMicRestartTimes = (now: number): void => {
    while (micRestartTimes.length && now - micRestartTimes[0]! >= 60_000) {
      micRestartTimes.shift();
    }
  };

  /**
   * Restart the 1:1 microphone in `delayMs` (or later: restarts are at least
   * MIC_RESTART_MIN_GAP_MS apart and at most MIC_RESTART_MAX_PER_MINUTE a
   * minute). Requests before it runs are merged into it; one that comes
   * while a restart runs schedules one more after it.
   */
  const requestMicRestart = (reason: string, delayMs: number): void => {
    if (liveMicHolders().length === 0) return;
    if (!micRestartReasons.includes(reason)) micRestartReasons.push(reason);
    // A new device change (not our own retry) earns fresh attempts.
    if (reason !== 'retry') micRestartFailuresInRow = 0;
    if (micRestartInFlight) {
      micRestartAgain = true;
      return;
    }
    const now = Date.now();
    pruneMicRestartTimes(now);
    let dueAt = Math.max(
      now + delayMs,
      micLastRestartAt + MIC_RESTART_MIN_GAP_MS
    );
    if (micRestartTimes.length >= MIC_RESTART_MAX_PER_MINUTE) {
      dueAt = Math.max(dueAt, micRestartTimes[0]! + 60_000);
    }
    if (micRestartTimer) {
      if (micRestartDueAt <= dueAt) return;
      clearTimeout(micRestartTimer);
    }
    micRestartDueAt = dueAt;
    micRestartTimer = setTimeout(
      () => {
        micRestartTimer = null;
        void runSerialized(beginMicRestart).catch(() => {});
      },
      Math.max(0, dueAt - now)
    );
  };

  /** Step 1 (command queue): stop everything, start the new getUserMedia. */
  const beginMicRestart = async (): Promise<void> => {
    if (micRestartInFlight || liveMicHolders().length === 0) return;
    const reasons = micRestartReasons.length ? micRestartReasons : ['unknown'];
    micRestartReasons = [];
    micRestartAgain = false;
    // This capture is opened on the devices there are now: later route
    // updates are compared with them.
    micCaptureInputs = currentNativeInputRoutes();
    micOpeningInputs = micCaptureInputs;
    micResyncTries = 0;
    if (micResyncTimer) clearTimeout(micResyncTimer);
    micResyncTimer = null;
    const now = Date.now();
    micLastRestartAt = now;
    pruneMicRestartTimes(now);
    micRestartTimes.push(now);
    const epoch = ++micRestartEpoch;

    // Break first: no live track may keep the old source open, including
    // the clone a slow swap is still handing over (it then hands over an
    // ended track, and the holder is moved to the new capture after it).
    detachMicWatch?.();
    detachMicWatch = null;
    const old = micStream;
    micStream = null;
    old?.getTracks().forEach((t) => stopTrackQuietly(t));
    for (const holder of liveMicHolders()) {
      stopTrackQuietly(holder.handle.track);
      stopTrackQuietly(holder.pendingTrack);
    }
    console.log(
      '[audioSurface] mic restart',
      JSON.stringify({
        reasons,
        consumers: liveMicHolders().length,
        muted: dmMuted,
        route: lastNativeRoute?.route ?? null,
      })
    );

    let gum: Promise<MediaStream>;
    try {
      gum = navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch (error) {
      gum = Promise.reject(error);
    }
    // Shared with an acquireMic that comes meanwhile (a leg starting).
    const pending: Promise<MediaStream> = gum.finally(() => {
      if (micPending === pending) micPending = null;
    });
    pending.catch(() => {});
    micPending = pending;
    micRestartInFlight = { epoch, reasons, startedAt: now, pending };
    micRestartWatchdog = setTimeout(() => {
      micRestartWatchdog = null;
      void runSerialized(async () =>
        failMicRestart(epoch, new Error('getUserMedia-timeout'))
      ).catch(() => {});
    }, MIC_RESTART_GUM_TIMEOUT_MS);
    gum.then(
      (stream) => {
        void runSerialized(() => finishMicRestart(epoch, stream)).catch(
          () => {}
        );
      },
      (error) => {
        void runSerialized(async () => failMicRestart(epoch, error)).catch(
          () => {}
        );
      }
    );
  };

  const noteMicRestart = (
    reasons: string[],
    startedAt: number,
    ok: boolean,
    moved: number,
    error: string | null
  ): void => {
    if (ok) micRestartStats.restarts += 1;
    else micRestartStats.failures += 1;
    micRestartStats.last = {
      reason: reasons.join('+'),
      ok,
      moved,
      ms: Date.now() - startedAt,
      error,
      at: Date.now(),
    };
  };

  /** A restart's getUserMedia failed or never answered. */
  const failMicRestart = (epoch: number, error: unknown): void => {
    const run = micRestartInFlight;
    if (!run || run.epoch !== epoch) return;
    if (micRestartWatchdog) clearTimeout(micRestartWatchdog);
    micRestartWatchdog = null;
    if (micPending === run.pending) micPending = null;
    micRestartInFlight = null;
    micRestartFailuresInRow += 1;
    const message = errorMessage(error);
    noteMicRestart(run.reasons, run.startedAt, false, 0, message);
    console.warn(
      '[audioSurface] mic restart failed',
      JSON.stringify({
        error: message,
        failuresInRow: micRestartFailuresInRow,
      })
    );
    if (micRestartFailuresInRow < MIC_RESTART_MAX_FAILURES_IN_ROW) {
      requestMicRestart('retry', MIC_RESTART_RETRY_MS);
    } else {
      console.warn(
        '[audioSurface] mic restart gave up until the next device change'
      );
    }
  };

  /** Step 2 (command queue): the new capture is open; move the consumers. */
  const finishMicRestart = async (
    epoch: number,
    stream: MediaStream
  ): Promise<void> => {
    const run = micRestartInFlight;
    if (!run || run.epoch !== epoch) {
      // Hung up, timed out or replaced meanwhile. Keep it only if a leg
      // that started meanwhile took it as its microphone.
      if (micStream !== stream) stream.getTracks().forEach(stopTrackQuietly);
      return;
    }
    const base = stream.getAudioTracks().find((t) => t.readyState === 'live');
    if (!base) {
      stream.getTracks().forEach(stopTrackQuietly);
      failMicRestart(epoch, new Error('microphone-track-missing'));
      return;
    }
    if (micRestartWatchdog) clearTimeout(micRestartWatchdog);
    micRestartWatchdog = null;
    micRestartInFlight = null;
    micRestartFailuresInRow = 0;
    adoptMicStream(stream);
    const stale = liveMicHolders().filter(
      (h) => h.generation !== micGeneration
    ).length;
    const ok = await syncMicHolders();
    const moved =
      stale -
      liveMicHolders().filter((h) => h.generation !== micGeneration).length;
    noteMicRestart(
      run.reasons,
      run.startedAt,
      true,
      moved,
      ok ? null : 'some-consumers-pending'
    );
    console.log(
      '[audioSurface] mic restarted',
      JSON.stringify({
        reasons: run.reasons,
        ms: Date.now() - run.startedAt,
        moved,
        pending: stale - moved,
        generation: micGeneration,
      })
    );
    // Not awaited: the route call must not hold the command queue.
    void reassertCallAudioRoute();
    if (micRestartAgain) {
      micRestartAgain = false;
      requestMicRestart(
        'changed-while-restarting',
        MIC_RESTART_ROUTE_SETTLE_MS
      );
    }
  };

  /** Hand one consumer a clone of `base`; false if it stayed where it was. */
  const swapMicHolder = (
    holder: MicHolder,
    base: MediaStreamTrack
  ): Promise<boolean> => {
    const generation = micGeneration;
    const prev = holder.handle.track;
    const next = base.clone();
    next.enabled = prev.enabled;
    holder.swapping = true;
    holder.pendingTrack = next;
    const settle = () => {
      holder.swapping = false;
      if (holder.pendingTrack === next) holder.pendingTrack = null;
    };
    return Promise.resolve()
      .then(() => holder.handle.onReplace?.(next))
      .then(
        () => {
          settle();
          if (holder.released) {
            stopTrackQuietly(next);
            return false;
          }
          if (generation !== micGeneration) {
            // A newer restart ran meanwhile and skipped this consumer (it
            // was still swapping): move it to that capture now.
            stopTrackQuietly(next);
            scheduleMicResync();
            return false;
          }
          holder.handle.track = next;
          holder.generation = generation;
          if (prev !== next) stopTrackQuietly(prev);
          return true;
        },
        (error) => {
          settle();
          stopTrackQuietly(next);
          console.warn('[audioSurface] mic swap failed', errorMessage(error));
          // Also when a resync already ran while this swap was slow.
          if (!holder.released) scheduleMicResync();
          return false;
        }
      );
  };

  /**
   * Move every consumer still on an older capture to a clone of the current
   * one. Waits at most MIC_SWAP_TIMEOUT_MS (a slow one finishes on its own);
   * a consumer that could not move yet is tried again shortly, without a new
   * getUserMedia. A consumer whose earlier swap is still running is not
   * done: its swap schedules the next try when it settles (failed, or for an
   * older capture).
   */
  const syncMicHolders = async (): Promise<boolean> => {
    const base = liveMicTrack();
    if (!base) return false;
    const behind = liveMicHolders().filter(
      (h) => h.generation !== micGeneration
    );
    const stale = behind.filter((h) => !h.swapping);
    if (stale.length === 0) {
      if (behind.length > 0) return false;
      micResyncTries = 0;
      return true;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const results = await Promise.race([
      Promise.all(stale.map((h) => swapMicHolder(h, base))),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), MIC_SWAP_TIMEOUT_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);
    const ok =
      Array.isArray(results) &&
      results.every(Boolean) &&
      stale.length === behind.length;
    if (ok) micResyncTries = 0;
    else scheduleMicResync();
    return ok;
  };

  const scheduleMicResync = (): void => {
    if (micResyncTimer || liveMicHolders().length === 0) return;
    if (micResyncTries >= MIC_RESYNC_MAX_TRIES) {
      console.warn('[audioSurface] mic swap gave up for a consumer');
      return;
    }
    micResyncTries += 1;
    micResyncTimer = setTimeout(() => {
      micResyncTimer = null;
      void runSerialized(() => syncMicHolders()).catch(() => {});
    }, MIC_RESYNC_RETRY_MS);
  };

  /**
   * A phone call (or another call app) holds the call audio, so the mic is
   * not reopened now. Native's verdict: '<reason>-phone-call'; for
   * '<reason>-waiting' and 'moved-elsewhere' (an automatic re-assert that
   * waits) the state shows why (focus lost, or a phone call's mode; without
   * either the restart is not held up); any other update or call result
   * only while the mode is a phone call's.
   */
  const routeHeldElsewhere = (raw: string, state: AudioRouteState): boolean => {
    if (raw.endsWith('-phone-call')) return true;
    if (raw.endsWith('-waiting') || raw === 'moved-elsewhere') {
      return (
        (typeof state.focus === 'string' && MIC_FOCUS_LOST.has(state.focus)) ||
        isPhoneCallMode(state.mode)
      );
    }
    return isPhoneCallMode(state.mode);
  };

  // Android's call route (every event and every AudioRouting call result):
  // restart when a headset input came or went since the capture was opened.
  nativeRouteMicHook = (state, source, previousInputs) => {
    // A state without its route list says nothing about the devices.
    if (!state || !Array.isArray(state.routes) || state.active === false) {
      return;
    }
    const consumers = liveMicHolders().length;
    if (consumers === 0) return;
    const raw =
      typeof state.reason === 'string' && state.reason ? state.reason : source;
    const inputs = inputRoutesOf(state.routes);
    if (micCaptureInputs === null) {
      // Opened before this call listed its routes: these are its devices.
      micCaptureInputs = inputs;
      return;
    }
    const base = raw.replace(/-(waiting|phone-call)$/, '');
    const deviceEvent = MIC_INPUT_DEVICE_REASONS.has(base);
    // Against the devices the capture was opened on (an earlier event or
    // call result may already have carried the new ones); a device event
    // also counts when it changed them since the last state. Devices
    // without a microphone and re-reported lists (registration) change
    // nothing here.
    const captureChanged = inputs !== micCaptureInputs;
    const inputChanged =
      captureChanged ||
      (deviceEvent && previousInputs !== null && previousInputs !== inputs);
    const held = routeHeldElsewhere(raw, state);
    if (deviceEvent || inputChanged) {
      console.log(
        '[audioSurface] AudioRouting.changed',
        JSON.stringify({
          reason: raw,
          route: state.route ?? null,
          inputRoutes: inputs,
          captureInputs: micCaptureInputs,
          commDeviceType:
            typeof state.commDeviceType === 'number'
              ? state.commDeviceType
              : null,
          inputChanged,
          held,
          micConsumers: consumers,
        })
      );
    }
    if (MIC_AUDIO_BACK_REASONS.has(raw)) {
      // GO has the call audio back (a phone call ended). A headset that came
      // or went meanwhile, or a capture that ended and whose restarts failed
      // while the phone call held the microphone, is opened again now. A
      // live capture on the same devices is left alone.
      if (captureChanged) {
        requestMicRestart(`route:${raw}+device`, MIC_RESTART_ROUTE_SETTLE_MS);
      } else if (!liveMicTrack() && !micRestartInFlight) {
        requestMicRestart(`route:${raw}`, MIC_RESTART_ROUTE_SETTLE_MS);
      }
      return;
    }
    // Held: the next update once GO has the audio again (after-phone-call,
    // focus-gain, a re-apply) still differs from the capture's devices.
    if (!inputChanged || held) return;
    // A waiting restart already opens on the devices there are then.
    if (!deviceEvent && micRestartTimer) return;
    requestMicRestart(
      `route:${raw.replace(/-waiting$/, '')}`,
      MIC_RESTART_ROUTE_SETTLE_MS
    );
  };

  /** True while native WebRTC is connected and its remote audio plays. */
  const rtcCarriesAudio = (): boolean =>
    !!rtc && rtc.mediaReadyEmitted && rtc.transport.isOpen();

  // ── Lost path ────────────────────────────────────────────────────────────
  //
  // WebRTC needs about 6 s to call a connection lost. Nothing is said about it
  // on the wire, so each side finds out by itself, sooner:
  //  - this phone's default network is replaced: its RTP goes nowhere from
  //    then on, so the Reticulum leg takes over at once;
  //  - the peer speaks over Reticulum again while its RTP has stopped: its
  //    side has found out, and may not hear this phone's RTP either;
  //  - RTP has stopped for 2 s (a peer that is muted sends no Reticulum
  //    audio, but RTP it does).
  // The transport then stops being open and checks by itself when a path
  // works again (suspectPath). After a switch to Wi-Fi the peer's RTP can go
  // on coming over mobile data for a while, so what is played is decided by
  // the packets, not by the connection's state: RTP while it arrives.
  const readRtpAge = (entry: DirectVoiceRtc): number | null => {
    const now = Date.now();
    if (Math.abs(now - entry.rtpAgeAt) >= RTP_AGE_CACHE_MS) {
      entry.rtpAgeAt = now;
      try {
        entry.rtpAge = entry.transport.inboundAudioAgeMs();
      } catch {
        entry.rtpAge = null;
      }
    }
    return entry.rtpAge;
  };

  /** The peer's voice is heard as RTP: its Reticulum copy is not played. */
  const rtpArrives = (): boolean => {
    const entry = rtc;
    if (!entry || !entry.mediaReadyEmitted) return false;
    const age = readRtpAge(entry);
    if (age === null) return entry.transport.isOpen();
    return age < RTP_ARRIVES_MAX_AGE_MS;
  };

  const suspectRtcPath = (
    entry: DirectVoiceRtc,
    reason: DirectVoicePathSuspicion
  ): boolean => {
    try {
      return entry.transport.suspectPath(reason) === true;
    } catch (error) {
      logRtc('path-suspicion-failed', { reason, error: errorMessage(error) });
      return false;
    }
  };

  /** The leg is not open (any more): its next RTP begins a new time. */
  const forgetRtp = (entry: DirectVoiceRtc): void => {
    entry.openSince = 0;
    entry.rtpSeen = false;
  };

  const watchRtp = (entry: DirectVoiceRtc): void => {
    if (rtc !== entry) return;
    if (!entry.mediaReadyEmitted || !entry.transport.isOpen()) {
      forgetRtp(entry);
      return;
    }
    if (!entry.openSince) entry.openSince = Date.now();
    const age = readRtpAge(entry);
    if (age === null) return;
    if (age < RTP_ARRIVES_MAX_AGE_MS) entry.rtpSeen = true;
    // Only once RTP has arrived over this open leg: one whose peer sends none
    // at all (its microphone is gone) would be suspected for ever.
    else if (entry.rtpSeen && age >= RTP_SILENT_MS) {
      suspectRtcPath(entry, 'rtp-silent');
    }
  };

  /** Heard again after an outage: WebRTC need not wait to try again. */
  const notePeerHeard = (entry: DirectVoiceRtc): void => {
    const now = Date.now();
    const away = now - entry.peerHeardAt;
    entry.peerHeardAt = now;
    if (away >= 0 && away < PEER_AWAY_MS) return;
    try {
      entry.transport.peerHeardAgain();
    } catch (error) {
      logRtc('restart-failed', { error: errorMessage(error) });
    }
  };

  /**
   * The peer's Reticulum audio is about to be played: its RTP has not arrived
   * just now. False when it is too old to be heard in an open leg.
   */
  const notePeerReticulumAudio = (lateMs: number): boolean => {
    const entry = rtc;
    if (!entry) return true;
    if (!entry.transport.isOpen()) {
      notePeerHeard(entry);
      return true;
    }
    if (!entry.mediaReadyEmitted) return true;
    if (lateMs > RETICULUM_STALE_MS) return false;
    if (entry.rtpSeen && Date.now() - entry.openSince >= RTP_OPEN_GRACE_MS) {
      suspectRtcPath(entry, 'peer-on-reticulum');
    }
    return true;
  };

  const startRtpWatch = (entry: DirectVoiceRtc): void => {
    if (entry.rtpWatchTimer) return;
    entry.rtpWatchTimer = setInterval(
      () => watchRtp(entry),
      RTP_WATCH_INTERVAL_MS
    );
  };

  const stopRtpWatch = (entry: DirectVoiceRtc): void => {
    if (entry.rtpWatchTimer) clearInterval(entry.rtpWatchTimer);
    entry.rtpWatchTimer = null;
  };

  const unsubscribeDefaultNetwork = subscribeDefaultNetworkChanged(() => {
    const entry = rtc;
    if (!entry) return;
    logRtc('network-changed', {
      acted: suspectRtcPath(entry, 'network-changed'),
    });
  });

  const hasActiveDirectVoiceSession = (): boolean =>
    Boolean(rtc || session || dmRoomId || dmPeerAddress || dmLocalAddress);

  // Owners whose call is over. useVoiceCall makes a new ownerId per call and
  // sends stop-direct-voice-rtc only from its end-of-call teardown (or for a
  // start it cancels after that), always before stop-direct-voice-media.
  // GO-only guard against a race desktop shares: the hook can still issue
  // start-direct-voice-media while it tears down (e.g. the room key lands
  // then), and that start would keep the mic open, the phone in call mode and
  // block every later call with 'direct-voice-runtime-in-use'.
  const endedDirectVoiceOwners = new Set<string>();
  const markDirectVoiceOwnerEnded = (ownerId: string): void => {
    if (!ownerId) return;
    endedDirectVoiceOwners.delete(ownerId);
    endedDirectVoiceOwners.add(ownerId);
    while (endedDirectVoiceOwners.size > ENDED_DIRECT_VOICE_OWNER_MEMORY) {
      const oldest = endedDirectVoiceOwners.values().next().value;
      if (typeof oldest !== 'string') break;
      endedDirectVoiceOwners.delete(oldest);
    }
  };

  /** End what an ended owner still holds (mic, session, route). */
  const endEndedOwnerMedia = async (reason: string): Promise<void> => {
    console.warn(
      '[audioSurface] 1:1 media outlived its call; ending it',
      reason
    );
    await closeDirectVoice(reason);
    dmOwnerId = '';
    await leaveRouteIfIdle();
  };

  /**
   * Desktop claimDirectVoiceOwner: one owner (useVoiceCall instance) at a
   * time, plus the GO-only ended-owner rules above: an ended owner may not
   * start anything, and an ended owner that still holds media gives way.
   */
  const claimDirectVoiceOwner = async (
    ownerIdInput: unknown
  ): Promise<AudioSurfaceResponse | null> => {
    const ownerId = trimId(ownerIdInput);
    if (!ownerId) return { ok: false, error: 'invalid-direct-voice-owner' };
    if (endedDirectVoiceOwners.has(ownerId)) {
      return { ok: false, error: 'direct-voice-owner-ended' };
    }
    if (dmOwnerId && dmOwnerId !== ownerId) {
      if (hasActiveDirectVoiceSession()) {
        if (!endedDirectVoiceOwners.has(dmOwnerId)) {
          return { ok: false, error: 'direct-voice-runtime-in-use' };
        }
        await endEndedOwnerMedia('owner-replaced');
      }
      dmOwnerId = '';
    }
    dmOwnerId = ownerId;
    return null;
  };

  /** Safety net: an ended owner's media must not outlive its teardown. */
  const scheduleEndedOwnerReap = (ownerId: string): void => {
    setTimeout(() => {
      void runSerialized(async () => {
        if (
          dmOwnerId !== ownerId ||
          !endedDirectVoiceOwners.has(ownerId) ||
          !hasActiveDirectVoiceSession()
        ) {
          return;
        }
        await endEndedOwnerMedia('ended-owner-reaped');
      });
    }, ENDED_DIRECT_VOICE_OWNER_REAP_MS);
  };

  const isDirectVoiceOwner = (ownerIdInput: unknown): boolean => {
    const ownerId = trimId(ownerIdInput);
    return Boolean(ownerId) && ownerId === dmOwnerId;
  };

  const releaseDirectVoiceOwnerIfIdle = (): void => {
    if (!hasActiveDirectVoiceSession()) dmOwnerId = '';
  };

  const staleOwner = (): AudioSurfaceResponse => ({
    ok: true,
    payload: { ignored: 'stale-owner' },
  });

  const emitDirectVoiceMediaReady = (): void => {
    if (!dmOwnerId || !dmRoomId || !dmPeerAddress) return;
    emit({
      type: 'direct-voice-media-ready',
      ownerId: dmOwnerId,
      roomId: dmRoomId,
      peerAddress: dmPeerAddress,
    });
  };

  const createDirectVoiceSession = (opts: {
    roomId: string;
    peerAddress: string;
    localAddress: string;
    roomKey: Uint8Array;
    profile?: GroupCallAudioQualityProfile;
  }): MobileVoiceSession => {
    const s: MobileVoiceSession = new MobileVoiceSession({
      roomId: opts.roomId,
      sendTargets: [opts.peerAddress],
      localAddress: opts.localAddress,
      roomKey: opts.roomKey,
      muted: dmMuted,
      hearCall: dmHearCall,
      profile: opts.profile,
      acquireMicTrack: async () => (await acquireMic()).handle,
      shouldSuppressReticulum: rtcCarriesAudio,
      shouldSuppressPlayout: rtpArrives,
      onPeerAudio: notePeerReticulumAudio,
      // Desktop emits media-ready on the first decoded inbound frame
      // (RT:6688-6700), not when capture starts.
      onDecodedFrame: () => {
        if (session !== s || dmReticulumMediaReadyEmitted) return;
        if (!dmOwnerId || !dmRoomId || !dmPeerAddress) return;
        dmReticulumMediaReadyEmitted = true;
        emitDirectVoiceMediaReady();
      },
    });
    return s;
  };

  const logRtc = (stage: string, detail?: Record<string, unknown>): void => {
    // Transport diagnostics never contain SDP, candidates or addresses.
    console.log(
      '[audioSurface] rtc %s %s',
      stage,
      detail ? JSON.stringify(detail) : ''
    );
  };

  // ── WebRTC leg RTP counters (Copy diagnostics, console) ─────────────────
  /**
   * The leg's RTCPeerConnection: the one whose sender carries the leg's mic
   * clone. Found in the privacy guard's registry (STUN probes skipped), else
   * on the shared transport (outside the guard).
   */
  const findRtcPeerConnection = (
    entry: DirectVoiceRtc
  ): RTCPeerConnection | null => {
    const track = entry.mic.track;
    const carriesMic = (candidate: unknown): candidate is RTCPeerConnection => {
      try {
        const pc = candidate as RTCPeerConnection | null;
        return (
          !!pc &&
          typeof pc.getSenders === 'function' &&
          typeof pc.getStats === 'function' &&
          pc.signalingState !== 'closed' &&
          pc.getSenders().some((sender) => sender.track === track)
        );
      } catch {
        return false;
      }
    };
    let found: RTCPeerConnection | null = null;
    try {
      for (const info of listGuardedPeerConnections()) {
        if (!info.stunProbe && carriesMic(info.pc)) found = info.pc; // newest
      }
    } catch {
      /* registry unavailable */
    }
    if (found) return found;
    const own = (entry.transport as unknown as { pc?: unknown }).pc;
    return carriesMic(own) ? own : null;
  };

  /** One getStats() of an open leg, logged as `rtc tx-stats` (numbers only). */
  const pollRtcTxStats = async (entry: DirectVoiceRtc): Promise<void> => {
    if (rtc !== entry || entry.statsInFlight || !entry.transport.isOpen()) {
      return;
    }
    const pc = findRtcPeerConnection(entry);
    if (!pc) {
      entry.statsMisses += 1;
      return;
    }
    entry.statsInFlight = true;
    try {
      const report = await pc.getStats();
      if (rtc !== entry) return;
      const stats = summarizeRtcTxStats(report);
      entry.txStats = { ...stats, at: Date.now() };
      entry.statsPolls += 1;
      logRtc('tx-stats', stats);
    } catch (error) {
      entry.statsMisses += 1;
      if (entry.statsMisses <= 3) {
        logRtc('tx-stats-failed', { error: errorMessage(error) });
      }
    } finally {
      entry.statsInFlight = false;
    }
  };

  const startRtcTxStats = (entry: DirectVoiceRtc): void => {
    if (entry.statsTimer) return;
    entry.statsTimer = setInterval(() => {
      void pollRtcTxStats(entry);
    }, RTC_TX_STATS_INTERVAL_MS);
  };

  const stopRtcTxStats = (entry: DirectVoiceRtc): void => {
    if (entry.statsTimer) clearInterval(entry.statsTimer);
    entry.statsTimer = null;
  };

  // ── Python's report on a signed control bundle (slow uplinks) ───────────
  //
  // GO's reliable control channel can need longer than the Hub's 20 s
  // signal TTL on a slow mobile uplink; Python then reports the bundle as
  // failed or expired. A lost offer is re-sent at once as a new offer
  // generation (a normal re-offer to an unmodified Hub); a lost answer is
  // signalled again. The transport's own slow timer
  // (UNANSWERED_OFFER_RETRY_DELAYS_MS) stays as the fallback. Spaced and
  // capped per leg, so a channel that keeps failing at once cannot loop.
  const onControlBundleResult = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail as {
      signalType?: unknown;
      ok?: unknown;
      reason?: unknown;
      roomId?: unknown;
    } | null;
    if (!detail || typeof detail !== 'object' || detail.ok !== false) return;
    const type = String(detail.signalType ?? '').replace(/^rtc-/, '');
    if (type !== 'offer' && type !== 'answer') return;
    const entry = rtc;
    if (!entry) return;
    const roomId = trimId(detail.roomId);
    if (roomId && roomId !== entry.roomId) return;
    const reason =
      typeof detail.reason === 'string' && detail.reason
        ? detail.reason.replace(/[A-Za-z0-9]{20,}/g, 'id').slice(0, 40)
        : 'unknown';
    const transport = entry.transport as unknown as {
      retryUnansweredOffer?: (why: string) => boolean;
      resendCurrentAnswer?: () => boolean;
    };
    const method =
      type === 'offer'
        ? transport.retryUnansweredOffer
        : transport.resendCurrentAnswer;
    if (typeof method !== 'function') {
      logRtc('control-bundle-failed', { signal: type, reason, acted: false });
      return;
    }
    const slot = entry.controlRetries[type];
    const now = Date.now();
    if (
      slot.count >= CONTROL_BUNDLE_RETRY_MAX_PER_LEG ||
      now - slot.lastAt < CONTROL_BUNDLE_RETRY_MIN_GAP_MS
    ) {
      logRtc('control-bundle-failed', {
        signal: type,
        reason,
        acted: false,
        throttled: true,
      });
      return;
    }
    let acted = false;
    try {
      acted =
        type === 'offer'
          ? transport.retryUnansweredOffer!('bundle-failed') === true
          : transport.resendCurrentAnswer!() === true;
    } catch (error) {
      logRtc('control-bundle-retry-failed', {
        signal: type,
        error: errorMessage(error),
      });
    }
    if (acted) {
      slot.count += 1;
      slot.lastAt = now;
    }
    logRtc('control-bundle-failed', { signal: type, reason, acted });
  };
  try {
    window.addEventListener(
      GCALL_CONTROL_BUNDLE_RESULT_EVENT,
      onControlBundleResult
    );
  } catch {
    /* no window events: the transport's own timer still re-offers */
  }

  /** Desktop closeDirectVoiceRtc: callbacks of the old transport go quiet. */
  const closeDirectVoiceRtc = (reason: string): void => {
    rtcLifecycle += 1;
    const entry = rtc;
    rtc = null;
    if (!entry) return;
    stopRtcTxStats(entry);
    stopRtpWatch(entry);
    logRtc('closed', { reason, privacy: getWebRtcPrivacyStats() });
    try {
      entry.transport.close();
    } catch {
      /* ignore */
    }
    entry.mic.release();
    const audio = entry.remoteAudio;
    entry.remoteAudio = null;
    if (audio) {
      audio.onplaying = null;
      try {
        audio.pause();
      } catch {
        /* ignore */
      }
      audio.srcObject = null;
      audio.remove();
    }
    entry.mediaReadyEmitted = false;
  };

  /** Desktop attachDirectVoiceRtcRemoteStream (RT:1878-1948). */
  const attachDirectVoiceRtcRemoteStream = async (
    entry: DirectVoiceRtc,
    stream: MediaStream
  ): Promise<void> => {
    if (rtc !== entry) return;
    let audio = entry.remoteAudio;
    if (!audio) {
      // A plain media element: Chromium plays WebRTC remote audio through the
      // call stream once the echo-cancelled mic is open, so it follows the
      // Android in-call route (earpiece / speaker / headset). GO's WebView
      // allows playback without a user gesture
      // (setMediaPlaybackRequiresUserGesture(false), MainActivity.java).
      const el = document.createElement('audio');
      el.autoplay = true;
      el.setAttribute('playsinline', '');
      el.setAttribute('data-go-call-audio', 'direct');
      el.style.display = 'none';
      el.onplaying = () => {
        if (rtc !== entry || entry.mediaReadyEmitted) return;
        if (!dmRoomId || !dmPeerAddress) return;
        entry.mediaReadyEmitted = true;
        entry.playingAt = Date.now();
        logRtc('remote-audio-playing');
        emitDirectVoiceMediaReady();
        if (entry.transport.isOpen()) {
          entry.projectedState = 'open';
          emit({
            type: 'direct-voice-rtc-state',
            ownerId: dmOwnerId,
            roomId: dmRoomId,
            peerAddress: dmPeerAddress,
            state: 'open',
          });
        }
      };
      document.body.appendChild(el);
      entry.remoteAudio = el;
      audio = el;
    }
    if (audio.srcObject !== stream) {
      // A recreated peer connection delivers a new stream. Require it to
      // reach playback before suppressing the Reticulum fallback again.
      entry.mediaReadyEmitted = false;
    }
    audio.muted = !dmHearCall;
    audio.srcObject = stream;
    if (rtc !== entry || audio !== entry.remoteAudio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      return;
    }
    const element = audio;
    await element.play().catch((error) => {
      logRtc('remote-audio-play-failed', { error: errorMessage(error) });
      // GO's WebView allows autoplay, so this should not happen; if a
      // WebView build ever refuses, the next tap anywhere starts playback.
      const retry = () => {
        if (rtc === entry && entry.remoteAudio === element) {
          void element.play().catch(() => {});
        }
      };
      document.addEventListener('pointerdown', retry, {
        once: true,
        capture: true,
      });
    });
  };

  /** End the 1:1 call's media (both legs). The owner is left to the caller. */
  const closeDirectVoice = async (reason: string): Promise<void> => {
    closeDirectVoiceRtc(reason);
    const s = session;
    session = null;
    await s?.dispose();
    dmRoomId = '';
    dmPeerAddress = '';
    dmLocalAddress = '';
    dmMuted = false;
    dmHearCall = true;
    dmReticulumMediaReadyEmitted = false;
  };

  /** Leave the in-call route once nothing uses it any more. */
  const leaveRouteIfIdle = async (): Promise<void> => {
    if (rtc || session || groupCallActive) return;
    await leaveCallAudioRoute();
  };

  /** A refused/abandoned RTC start: give back what only the RTC leg used. */
  const releaseAfterAbandonedRtcStart = async (): Promise<void> => {
    if (!session && !dmLocalAddress) {
      dmRoomId = '';
      dmPeerAddress = '';
    }
    releaseDirectVoiceOwnerIfIdle();
    await leaveRouteIfIdle();
  };

  /** A DM call and a group call would fight over the mic: a DM ends a group. */
  const endGroupCallForDirectVoice = async (): Promise<void> => {
    if (!groupCallActive) return;
    groupCallActive = false;
    try {
      await groupRuntime?.handleCommand({ type: 'leave-group-call' });
    } catch {
      /* ignore */
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
  // Diagnostics: the runtime's last snapshot and its WebRTC edge states.
  let lastGroupSnapshot: GroupCallControllerSnapshot | null = null;
  const groupRtcEdgeStates = new Map<string, string>();
  let groupRtcPolicy: 'not-loaded' | 'applied' | 'unavailable' | 'off-go' =
    'not-loaded';

  /**
   * The runtime can leave a group call on its own (another device of this
   * account took the seat, a failed rejoin): its snapshot goes back to idle
   * without a leave-group-call through the surface. Give the call audio
   * back then, or Android stays in call mode on the earpiece. Queued behind
   * any surface command, so a join that passes through 'idle' (switching
   * rooms) is judged by the state after it.
   */
  const releaseGroupRouteIfRuntimeLeft = (): void => {
    void runSerialized(async () => {
      const state = lastGroupSnapshot?.roomState;
      if (!groupCallActive || (state !== 'idle' && state !== 'ended')) return;
      groupCallActive = false;
      groupRtcEdgeStates.clear();
      console.log('[audioSurface] group call ended by the engine (%s)', state);
      await leaveRouteIfIdle();
    });
  };

  const noteGroupRuntimeEvent = (event: AudioSurfaceEvent): void => {
    if (event.type === 'snapshot') {
      lastGroupSnapshot = event.snapshot;
      const state = event.snapshot?.roomState;
      if (groupCallActive && (state === 'idle' || state === 'ended')) {
        releaseGroupRouteIfRuntimeLeft();
      }
      return;
    }
    // Emitted by the runtime but missing from the shared event union.
    const loose = event as unknown as {
      type?: string;
      peerAddress?: string;
      state?: string;
    };
    if (loose.type === 'group-call-rtc-state' && loose.peerAddress) {
      if (loose.state === 'closed') {
        groupRtcEdgeStates.delete(loose.peerAddress);
      } else {
        groupRtcEdgeStates.set(loose.peerAddress, String(loose.state));
      }
    }
  };

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
          const { GroupCallAudioEngineRuntime } =
            await import('../lib/group-call/groupCallAudioEngineRuntime');
          const rt =
            new GroupCallAudioEngineRuntime() as unknown as GroupRuntime;
          if (isCapacitor()) {
            groupRtcPolicy = applyGoGroupRtcTransportPolicy(rt)
              ? 'applied'
              : 'unavailable';
            if (groupRtcPolicy === 'unavailable') {
              console.warn(
                '[audioSurface] group runtime changed: "Private calls" relies on the WebRTC privacy guard alone for group edges'
              );
            }
          } else {
            groupRtcPolicy = 'off-go';
          }
          rt.onEvent((event) => {
            noteGroupRuntimeEvent(event);
            emit(event);
          });
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
    'clear-join-error',
  ]);

  const warnedUnknownCommands = new Set<string>();

  const startDirectVoiceRtc = async (
    command: Extract<AudioSurfaceCommand, { type: 'start-direct-voice-rtc' }>
  ): Promise<AudioSurfaceResponse> => {
    const roomId = trimId(command.roomId);
    const peerAddress = trimId(command.peerAddress);
    if (!roomId || !peerAddress) {
      return { ok: false, error: 'invalid-direct-voice-rtc-config' };
    }
    // "Private calls": never start WebRTC. ok:false keeps useVoiceCall from
    // acknowledging the peer's capability, so the peer stays on Reticulum.
    if (getCallTransportPreference() === 'reticulum') {
      return { ok: false, error: 'webrtc-disabled-by-user' };
    }
    if (typeof RTCPeerConnection !== 'function') {
      return { ok: false, error: 'native-webrtc-unavailable' };
    }
    const ownerError = await claimDirectVoiceOwner(command.ownerId);
    if (ownerError) return ownerError;
    const ownerId = trimId(command.ownerId);
    await endGroupCallForDirectVoice();
    if (dmRoomId && (dmRoomId !== roomId || dmPeerAddress !== peerAddress)) {
      await closeDirectVoice('session-changed');
    }
    dmRoomId = roomId;
    dmPeerAddress = peerAddress;
    dmMuted = command.muted === true;
    dmHearCall = command.hearCall !== false;
    session?.setMuted(dmMuted);
    session?.setHearCall(dmHearCall);

    const created = !rtc;
    if (!rtc) {
      const lifecycle = ++rtcLifecycle;
      await enterCallAudioRoute('direct');
      let mic: MicHandle;
      let micOpened = false;
      try {
        const acquired = await acquireMic();
        mic = acquired.handle;
        micOpened = acquired.opened;
      } catch (error) {
        logRtc('microphone-unavailable', { error: errorMessage(error) });
        if (!session && !dmLocalAddress) {
          dmRoomId = '';
          dmPeerAddress = '';
        }
        releaseDirectVoiceOwnerIfIdle();
        await leaveRouteIfIdle();
        return { ok: false, error: 'native-webrtc-microphone-unavailable' };
      }
      if (
        lifecycle !== rtcLifecycle ||
        rtc ||
        dmRoomId !== roomId ||
        dmPeerAddress !== peerAddress
      ) {
        mic.release();
        return { ok: false, error: 'native-webrtc-start-cancelled' };
      }
      if (getCallTransportPreference() === 'reticulum') {
        // "Private calls" was chosen while the mic was opening (the first-use
        // permission dialog can hold this start for as long as it is shown).
        mic.release();
        await releaseAfterAbandonedRtcStart();
        return { ok: false, error: 'webrtc-disabled-by-user' };
      }
      mic.track.enabled = !dmMuted;
      const localStream = new MediaStream([mic.track]);
      const initialIceServers = (command.iceServers ?? []).map((server) => ({
        ...server,
      }));
      const entry = {
        mic,
        remoteAudio: null,
        mediaReadyEmitted: false,
        lifecycle,
        ownerId,
        roomId,
        peerAddress,
        transportState: 'idle',
        projectedState: 'connecting',
        startedAt: Date.now(),
        playingAt: null,
        statsTimer: null,
        statsInFlight: false,
        statsPolls: 0,
        statsMisses: 0,
        txStats: null,
        rtpAge: null,
        rtpAgeAt: -Infinity,
        openSince: 0,
        rtpSeen: false,
        rtpWatchTimer: null,
        peerHeardAt: 0,
        controlRetries: {
          offer: { count: 0, lastAt: 0 },
          answer: { count: 0, lastAt: 0 },
        },
      } as unknown as DirectVoiceRtc;
      const isCurrent = (): boolean =>
        rtc === entry &&
        entry.lifecycle === rtcLifecycle &&
        dmOwnerId === ownerId &&
        dmRoomId === roomId &&
        dmPeerAddress === peerAddress;
      entry.transport = new DirectVoiceWebRtcTransport({
        // GO only (desktop passes none): re-offer an offer that got no answer.
        ...goDirectVoiceTransportOptions(),
        offerer: command.initiator === true,
        getIceServers: async () => {
          try {
            const live = await withTimeout(
              Promise.resolve(window.hub?.getIceServers?.()),
              ICE_SERVER_FETCH_TIMEOUT_MS
            );
            if (Array.isArray(live) && live.length > 0) {
              return live.map((server) => ({ ...server }));
            }
          } catch {
            // The command's snapshot (fetched by the hook just now) remains.
          }
          return initialIceServers.map((server) => ({ ...server }));
        },
        localStream,
        onSignal: (signal) => {
          if (!isCurrent()) return;
          emit({
            type: 'direct-voice-rtc-signal',
            ownerId,
            roomId,
            peerAddress,
            signal,
          });
        },
        onRemoteStream: (stream) => {
          if (!isCurrent()) return;
          void attachDirectVoiceRtcRemoteStream(entry, stream).catch(
            (error) => {
              logRtc('playback-failed', { error: errorMessage(error) });
            }
          );
        },
        onState: (state) => {
          if (
            rtc !== entry ||
            entry.lifecycle !== rtcLifecycle ||
            dmOwnerId !== ownerId
          ) {
            return;
          }
          const projected = projectDirectVoiceRtcState(
            state,
            entry.mediaReadyEmitted
          );
          entry.transportState = state;
          entry.projectedState = projected;
          if (state !== 'open') forgetRtp(entry);
          logRtc('state', { transport: state, projected });
          emit({
            type: 'direct-voice-rtc-state',
            ownerId,
            roomId,
            peerAddress,
            state: projected,
          });
        },
        onDiagnostic: (stage, detail) => {
          if (!isCurrent()) return;
          logRtc(stage, detail);
          emit({
            type: 'direct-voice-rtc-diagnostic',
            ownerId,
            roomId,
            peerAddress,
            stage,
            detail,
          });
        },
      });
      // Mic restart: the sender moves to the new capture (replaceTrack, no
      // renegotiation, nothing new on the wire), keeping the mute state.
      const transport = entry.transport;
      mic.onReplace = async (next) => {
        if (rtc !== entry || entry.transport !== transport) {
          throw new Error('rtc-leg-replaced');
        }
        next.enabled = !dmMuted;
        await transport.replaceLocalStream(new MediaStream([next]));
        // A mute change while replaceTrack ran reached the old track only.
        if (rtc === entry) transport.setMuted(dmMuted);
      };
      rtc = entry;
      startRtcTxStats(entry);
      startRtpWatch(entry);
      if (micOpened) {
        // getUserMedia's echo-canceller grabs the communication device.
        await reassertCallAudioRoute();
      }
    }
    const current = rtc;
    try {
      await current.transport.start();
      if (
        created &&
        rtc === current &&
        getCallTransportPreference() === 'reticulum'
      ) {
        // Chosen while the peer connection was being set up (ICE servers,
        // offer). Its connection may already be relay-only with no servers
        // (webrtcPrivacy reads the mode at creation), so it could never
        // connect: drop it like a start refused up front.
        closeDirectVoiceRtc('webrtc-disabled-by-user');
        await releaseAfterAbandonedRtcStart();
        return { ok: false, error: 'webrtc-disabled-by-user' };
      }
      return { ok: true, payload: { transport: 'webrtc-native' } };
    } catch (error) {
      if (rtc === current) closeDirectVoiceRtc('start-failed');
      if (!session && !dmLocalAddress) {
        dmRoomId = '';
        dmPeerAddress = '';
      }
      releaseDirectVoiceOwnerIfIdle();
      await leaveRouteIfIdle();
      return { ok: false, error: errorMessage(error) };
    }
  };

  const startDirectVoiceMedia = async (
    command: Extract<AudioSurfaceCommand, { type: 'start-direct-voice-media' }>
  ): Promise<AudioSurfaceResponse> => {
    const roomId = trimId(command.roomId);
    const peerAddress = trimId(command.peerAddress);
    const localAddress = trimId(command.localAddress);
    const key = normalizeRoomKey(command.roomKey);
    if (!roomId || !peerAddress || !localAddress || !key) {
      return { ok: false, error: 'invalid-direct-voice-media-config' };
    }
    const ownerError = await claimDirectVoiceOwner(command.ownerId);
    if (ownerError) return ownerError;
    await endGroupCallForDirectVoice();
    const sessionChanged =
      dmRoomId &&
      (dmRoomId !== roomId ||
        dmPeerAddress !== peerAddress ||
        (dmLocalAddress !== '' && dmLocalAddress !== localAddress));
    if (sessionChanged) await closeDirectVoice('session-changed');
    // NOTE: a WebRTC leg for this same room/peer stays up (useVoiceCall may
    // start it before the Reticulum key exchange finishes).
    dmRoomId = roomId;
    dmPeerAddress = peerAddress;
    dmLocalAddress = localAddress;
    dmMuted = command.muted === true;
    dmHearCall = command.hearCall !== false;
    dmReticulumMediaReadyEmitted = false;
    rtc?.transport.setMuted(dmMuted);
    if (rtc?.remoteAudio) rtc.remoteAudio.muted = !dmHearCall;
    try {
      let s = session;
      if (s && s.roomId === roomId && !s.isDisposed()) {
        s.localAddress = localAddress;
        s.setRoomKey(key);
        s.setMuted(dmMuted);
        s.setHearCall(dmHearCall);
        s.setProfile(command.profile);
      } else {
        session = null;
        await s?.dispose();
        s = createDirectVoiceSession({
          roomId,
          peerAddress,
          localAddress,
          roomKey: key,
          profile: command.profile,
        });
        session = s;
      }
      await enterCallAudioRoute('direct');
      const micWasOpen = micHolders.size > 0;
      // Capture first (mic before the playback AudioContext), then playback.
      await s.startCapture();
      await s.startPlayback();
      if (!micWasOpen) {
        // getUserMedia's echo-canceller just grabbed the communication device
        // and may have bounced the route — re-assert it.
        await reassertCallAudioRoute();
      }
      return { ok: true, payload: { usingAudioSurfaceMedia: true } };
    } catch (error) {
      // Leave nothing half-started behind (the hook ends the call on ok:false).
      const s = session;
      session = null;
      await s?.dispose();
      dmLocalAddress = '';
      dmReticulumMediaReadyEmitted = false;
      if (!rtc) {
        dmRoomId = '';
        dmPeerAddress = '';
      }
      releaseDirectVoiceOwnerIfIdle();
      await leaveRouteIfIdle();
      return { ok: false, error: errorMessage(error) };
    }
  };

  const handleCommand = async (
    command: AudioSurfaceCommand
  ): Promise<AudioSurfaceResponse> => {
    if (STICKY_COMMANDS.has(command.type)) {
      stickyCommands.set(command.type, command);
    }
    switch (command.type) {
      case 'start-direct-voice-receive': {
        const roomId = trimId(command.roomId);
        const peerAddress = trimId(command.peerAddress);
        const key = normalizeRoomKey(command.roomKey);
        if (!roomId || !peerAddress || !key) {
          return { ok: false, error: 'invalid-direct-voice-receive-config' };
        }
        const ownerError = await claimDirectVoiceOwner(command.ownerId);
        if (ownerError) return ownerError;
        await endGroupCallForDirectVoice();
        if (
          dmRoomId &&
          (dmRoomId !== roomId || dmPeerAddress !== peerAddress)
        ) {
          await closeDirectVoice('session-changed');
        }
        dmRoomId = roomId;
        dmPeerAddress = peerAddress;
        dmHearCall = command.hearCall !== false;
        dmReticulumMediaReadyEmitted = false;
        if (session && session.roomId === roomId && !session.isDisposed()) {
          session.setRoomKey(key);
          session.setHearCall(dmHearCall);
        } else {
          const old = session;
          session = null;
          await old?.dispose();
          session = createDirectVoiceSession({
            roomId,
            peerAddress,
            localAddress: '',
            roomKey: key,
            profile: command.profile,
          });
        }
        await enterCallAudioRoute('direct');
        await session.startPlayback();
        return { ok: true };
      }
      case 'update-direct-voice-receive': {
        if (!isDirectVoiceOwner(command.ownerId)) return staleOwner();
        if (typeof command.hearCall === 'boolean') {
          dmHearCall = command.hearCall;
          session?.setHearCall(command.hearCall);
          if (rtc?.remoteAudio) rtc.remoteAudio.muted = !command.hearCall;
        }
        return { ok: true };
      }
      case 'stop-direct-voice-receive': {
        if (!isDirectVoiceOwner(command.ownerId)) return staleOwner();
        if (session && !session.isCaptureStarted()) {
          const s = session;
          session = null;
          await s.dispose();
          dmReticulumMediaReadyEmitted = false;
        }
        if (!session && !rtc && !dmLocalAddress) {
          dmRoomId = '';
          dmPeerAddress = '';
        }
        releaseDirectVoiceOwnerIfIdle();
        await leaveRouteIfIdle();
        return { ok: true, payload: { idle: !hasActiveDirectVoiceSession() } };
      }
      case 'start-direct-voice-rtc':
        return startDirectVoiceRtc(command);
      case 'apply-direct-voice-rtc-signal': {
        if (
          !isDirectVoiceOwner(command.ownerId) ||
          !rtc ||
          command.roomId !== dmRoomId ||
          command.peerAddress !== dmPeerAddress
        ) {
          return { ok: false, error: 'direct-voice-rtc-session-not-ready' };
        }
        try {
          await rtc.transport.handleSignal(
            command.signal as DirectVoiceRtcSignal
          );
          return { ok: true };
        } catch (error) {
          return { ok: false, error: errorMessage(error) };
        }
      }
      case 'stop-direct-voice-rtc': {
        // The hook's teardown has begun for this owner (see
        // endedDirectVoiceOwners), whether or not it is the current owner.
        const stoppingOwner = trimId(command.ownerId);
        markDirectVoiceOwnerEnded(stoppingOwner);
        if (!isDirectVoiceOwner(command.ownerId)) return staleOwner();
        closeDirectVoiceRtc('host-stop');
        if (!session && !dmLocalAddress) {
          dmRoomId = '';
          dmPeerAddress = '';
        }
        releaseDirectVoiceOwnerIfIdle();
        await leaveRouteIfIdle();
        // Desktop keeps Reticulum media here; stop-direct-voice-media follows.
        if (dmOwnerId === stoppingOwner && hasActiveDirectVoiceSession()) {
          scheduleEndedOwnerReap(stoppingOwner);
        }
        return { ok: true, payload: { idle: !hasActiveDirectVoiceSession() } };
      }
      case 'start-direct-voice-media':
        return startDirectVoiceMedia(command);
      case 'update-direct-voice-media': {
        if (!isDirectVoiceOwner(command.ownerId)) return staleOwner();
        if (!dmRoomId) return { ok: true };
        if (typeof command.muted === 'boolean') {
          dmMuted = command.muted;
          session?.setMuted(command.muted);
          rtc?.transport.setMuted(command.muted);
        }
        if (typeof command.hearCall === 'boolean') {
          dmHearCall = command.hearCall;
          session?.setHearCall(command.hearCall);
          if (rtc?.remoteAudio) rtc.remoteAudio.muted = !command.hearCall;
        }
        session?.setProfile(command.profile);
        // Input/output device ids are ignored on GO: Android routes call
        // audio natively (AudioRouting) and the WebView has no setSinkId.
        return { ok: true };
      }
      case 'stop-direct-voice-media': {
        if (!isDirectVoiceOwner(command.ownerId)) return staleOwner();
        // Desktop stopDirectVoiceMedia also closes the WebRTC leg.
        await closeDirectVoice('direct-voice-media-stopped');
        releaseDirectVoiceOwnerIfIdle();
        await leaveRouteIfIdle();
        return { ok: true, payload: { idle: !hasActiveDirectVoiceSession() } };
      }
      case 'join-group-call': {
        // A group call and a DM call cannot share the mic or the room key.
        if (hasActiveDirectVoiceSession()) {
          await closeDirectVoice('group-call-started');
          dmOwnerId = '';
          await leaveCallAudioRoute();
        }
        const rt = await ensureGroupRuntime();
        if (!rt) return { ok: false, error: 'group-calls-unavailable' };
        const routeWasActive = callAudioRouteKind !== null;
        groupRtcEdgeStates.clear();
        await enterCallAudioRoute('group');
        const res = await rt.handleCommand(command);
        if (!res.ok) {
          if (!groupCallActive && !routeWasActive) await leaveCallAudioRoute();
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
        groupRtcEdgeStates.clear();
        if (groupCallActive) {
          groupCallActive = false;
          await leaveRouteIfIdle();
        }
        return res;
      }
      case 'logout-cleanup': {
        // Desktop cleanupForLogout: leave the group call and end any 1:1 media.
        await closeDirectVoice('logout');
        dmOwnerId = '';
        let res: AudioSurfaceResponse = { ok: true };
        if (groupRuntime) {
          res = await groupRuntime.handleCommand(command);
        }
        groupCallActive = false;
        await leaveCallAudioRoute();
        return res;
      }
      default: {
        if (GROUP_COMMANDS.has(command.type)) {
          // Only wake the engine for state it needs to remember; muting with
          // no call in progress shouldn't pull in the whole runtime.
          const rt =
            groupRuntime ??
            (groupCallActive ? await ensureGroupRuntime() : null);
          if (rt) return rt.handleCommand(command);
          // Device/identity commands are inert until a group call needs them.
          return { ok: true };
        }
        // Never answer an unknown command with ok:true: callers (useVoiceCall)
        // would take that as "this feature works" (e.g. ack a WebRTC
        // capability the phone cannot honour).
        const type = String((command as { type?: unknown }).type);
        if (!warnedUnknownCommands.has(type)) {
          warnedUnknownCommands.add(type);
          console.warn('[audioSurface] unsupported command', type);
        }
        return { ok: false, error: 'unsupported-audio-surface-command' };
      }
    }
  };

  // Commands must run one at a time: a concurrent stop (from the previous
  // call's teardown) grabs the `session` variable and disposes the session a
  // racing start just created — start-direct-voice-media then dies with
  // "session disposed" and the caller hangs up before sending the room key.
  let commandChain: Promise<unknown> = Promise.resolve();
  const runSerialized = <T>(task: () => Promise<T>): Promise<T> => {
    const run = commandChain.then(task);
    commandChain = run.catch(() => {});
    return run;
  };

  // "Private calls" switched on mid-call does NOT close a WebRTC leg that is
  // already up: the peer already knows this call's addresses, and closing
  // GO's side leaves both sides silent until the peer's ICE notices (the Hub
  // keeps preferring its still-"open" RTC), after which the hook cannot bring
  // WebRTC back in that call. The choice applies to WebRTC legs started after
  // it (start-direct-voice-rtc checks it before and during the start, and
  // webrtcPrivacy gives new peer connections the matching mode).
  //
  // Group calls follow the same rule through applyGoGroupRtcTransportPolicy;
  // a change is applied to the runtime's edges right away instead of at its
  // next 3 s maintenance tick. Deferred one task so the bridge (which shows
  // or hides groupCall.sendRtcSignal on the same change) has updated first.
  try {
    subscribeCallTransportPreference(() => {
      setTimeout(() => {
        const rt = groupRuntime as unknown as GroupRtcPolicyTarget | null;
        if (!groupCallActive || !rt || groupRtcPolicy !== 'applied') return;
        void rt.syncGroupRtcTransports?.().catch(() => {});
      }, 0);
    });
  } catch {
    /* preference store unavailable: the 3 s maintenance applies it */
  }

  /**
   * The group engine captures with its own sender (not the shared 1:1 mic
   * above), so read its state from the runtime's sender diagnostics.
   */
  const groupMicDiagnostics = (
    snap: GroupCallControllerSnapshot | null
  ): NonNullable<MobileCallAudioDiagnostics['group']>['mic'] => {
    if (!groupRuntime) return null;
    try {
      const sender = (
        groupRuntime as unknown as {
          senderEngine?: {
            getDiagnosticsSnapshot?: () => Record<string, unknown>;
          };
        }
      ).senderEngine?.getDiagnosticsSnapshot?.();
      if (!sender) return null;
      const tracks = Array.isArray(sender.micTracks)
        ? (sender.micTracks as Array<{ readyState?: unknown; muted?: unknown }>)
        : [];
      const first = tracks[0];
      const encode = sender.senderEncodeSummary as
        | { mode?: unknown }
        | null
        | undefined;
      return {
        open: sender.hasMicStream === true,
        tracks: tracks.length,
        trackState:
          typeof first?.readyState === 'string' ? first.readyState : 'none',
        trackMuted: typeof first?.muted === 'boolean' ? first.muted : null,
        capturing: sender.hasCaptureNode === true,
        userMuted: typeof snap?.muted === 'boolean' ? snap.muted : null,
        encoder: typeof encode?.mode === 'string' ? encode.mode : null,
      };
    } catch {
      return null;
    }
  };

  surfaceDiagnostics = () => {
    const track = liveMicTrack();
    const entry = rtc;
    const snap = lastGroupSnapshot;
    const dmActive = hasActiveDirectVoiceSession();
    const now = Date.now();
    const rtcEdges: Record<string, string> = {};
    for (const [peer, state] of groupRtcEdgeStates) {
      rtcEdges[shortId(peer) ?? '?'] = state;
    }
    const metrics = snap?.metrics;
    const metric = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    const lastRestart = micRestartStats.last;
    const rtcStats = entry?.txStats ?? null;
    return {
      mic: {
        use: '1:1',
        open: Boolean(micStream),
        holders: micHolders.size,
        trackState: track?.readyState ?? (micStream ? 'ended' : 'none'),
        generation: micGeneration,
        restarts: micRestartStats.restarts,
        restartFailures: micRestartStats.failures,
        restarting: Boolean(micRestartInFlight || micRestartTimer),
        captureInputs: micCaptureInputs,
        lastRestart: lastRestart
          ? {
              reason: lastRestart.reason,
              ok: lastRestart.ok,
              moved: lastRestart.moved,
              ms: lastRestart.ms,
              error: lastRestart.error,
              ageMs: now - lastRestart.at,
            }
          : null,
      },
      direct:
        dmActive || dmOwnerId
          ? {
              active: dmActive,
              owner: Boolean(dmOwnerId),
              room: shortId(dmRoomId),
              peer: shortId(dmPeerAddress),
              carriedBy: rtcCarriesAudio()
                ? 'webrtc'
                : session
                  ? 'reticulum'
                  : 'none',
              mediaReady:
                dmReticulumMediaReadyEmitted ||
                Boolean(entry?.mediaReadyEmitted),
              rtc: entry
                ? {
                    state: entry.projectedState,
                    transportState: entry.transportState,
                    remoteAudioPlaying: entry.mediaReadyEmitted,
                    ageMs: now - entry.startedAt,
                    playingAfterMs:
                      entry.playingAt !== null
                        ? entry.playingAt - entry.startedAt
                        : null,
                    reoffers: entry.controlRetries.offer.count,
                    answerResends: entry.controlRetries.answer.count,
                  }
                : null,
              rtcStats:
                entry && rtcStats
                  ? {
                      source: rtcStats.source ? { ...rtcStats.source } : null,
                      outbound: rtcStats.outbound
                        ? { ...rtcStats.outbound }
                        : null,
                      remoteInbound: rtcStats.remoteInbound
                        ? { ...rtcStats.remoteInbound }
                        : null,
                      inbound: rtcStats.inbound
                        ? { ...rtcStats.inbound }
                        : null,
                      ageMs: now - rtcStats.at,
                      polls: entry.statsPolls,
                    }
                  : null,
              reticulum: session ? session.getStats() : null,
            }
          : null,
      group:
        groupRuntime || groupCallActive
          ? {
              active: groupCallActive,
              runtimeLoaded: Boolean(groupRuntime),
              room: shortId(snap?.roomId),
              roomState: snap?.roomState ?? null,
              myRole: snap?.myRole ?? null,
              participants: snap?.participants?.length ?? 0,
              speaking: snap?.activeSpeakers?.length ?? 0,
              transport: snap?.topologyLabel ?? null,
              joinError: snap?.gcallJoinError ?? null,
              packetsReceived: metric(metrics?.packetsReceived),
              packetsDecoded: metric(metrics?.packetsDecoded),
              packetsForwarded: metric(metrics?.packetsForwarded),
              packetsDropped: metric(metrics?.packetsDropped),
              rtcEdges,
              rtcPolicy: groupRtcPolicy,
              mic: groupMicDiagnostics(snap),
            }
          : null,
    };
  };

  window.audioSurface = {
    isReady: async () => true,
    ensureReady: async () => ({ success: true }),
    sendCommand: async (command: AudioSurfaceCommand) =>
      runSerialized(async () => {
        try {
          return await handleCommand(command);
        } catch (error) {
          return {
            ok: false as const,
            error: errorMessage(error),
          };
        }
      }),
    onEvent: (cb: (event: AudioSurfaceEvent) => void) => {
      eventCbs.add(cb);
      return () => {
        eventCbs.delete(cb);
      };
    },
    getWindowRole: async () => 'mobile-main',
  };

  disposeInstalledSurface = () => {
    nativeRouteMicHook = null;
    try {
      window.removeEventListener(
        GCALL_CONTROL_BUNDLE_RESULT_EVENT,
        onControlBundleResult
      );
    } catch {
      /* ignore */
    }
    unsubscribeDefaultNetwork();
    if (rtc) {
      stopRtcTxStats(rtc);
      stopRtpWatch(rtc);
    }
    for (const timer of [micRestartTimer, micRestartWatchdog, micResyncTimer]) {
      if (timer) clearTimeout(timer);
    }
    micRestartTimer = null;
    micRestartWatchdog = null;
    micResyncTimer = null;
    micRestartEpoch += 1;
    micRestartInFlight = null;
  };
}

/** Test-only: allow installMobileAudioSurface() to run again. */
export function __resetMobileAudioSurfaceForTests(): void {
  try {
    disposeInstalledSurface?.();
  } catch {
    /* ignore */
  }
  disposeInstalledSurface = null;
  nativeRouteMicHook = null;
  installed = false;
  callSpeakerOn = null;
  callAudioRouteKind = null;
  speakerChoiceAt = 0;
  speakerListeners.clear();
  lastNativeRoute = null;
  lastNativeInputRoutes = null;
  callAudioRouteEnteredAt = 0;
  lastNativeRouteError = null;
  nativeRouteListenerInstalled = false;
  surfaceDiagnostics = null;
}
