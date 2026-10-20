/**
 * GO-only glue between the call state in the page and Android's native call
 * plumbing (src/plugins/QortalCall.ts, src/plugins/AudioRouting.ts).
 *
 * Mount `useNativeCallSession` once per call surface (1:1 and group). It:
 * - rings natively while GO is off screen / the screen is off / the phone is
 *   locked (the page rings itself on screen; `nativeRinging` tells it when
 *   to stay quiet), with the caller's name and avatar;
 * - while a call dials or runs, keeps the page alive off screen, makes the
 *   status service a microphone foreground service with the call
 *   notification (Mute / Hang up), and holds the call audio (earpiece +
 *   proximity for 1:1, loudspeaker for groups, headsets first);
 * - turns notification buttons into the callbacks (accept / decline /
 *   hang up / mute), also when Accept was tapped before the page had seen
 *   the call (it waits for the ring with that callId, up to 60 s);
 * - reports the lock screen (`deviceLocked`): GO shows over it only during a
 *   call, so the page must show only the call screen then;
 * - call waiting: a call that rings while another runs (a 1:1 call during a
 *   group call) never ends the running call's native session; answering it
 *   moves the session over to the new call (`activeCall`, runningCallFor);
 * - with `localAddress`, hands the signed-in address to native ringing (a
 *   call request rings while the page is frozen off screen).
 *
 * Everything is a no-op off GO (desktop Electron, browser): isCapacitor().
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { isCapacitor } from '../utils/platform';
import {
  QortalCall,
  type NativeCallAction,
  type NativeCallActionEvent,
  type NativeCallKind,
  type NativeCallPhase,
  type NativeCallStringKey,
  type NativeRingState,
} from '../plugins/QortalCall';
import {
  AudioRouting,
  type AudioRoute,
  type AudioRouteState,
} from '../plugins/AudioRouting';

/** Owner name this module uses for AudioRouting (see AudioRouting.ts). */
export const NATIVE_CALL_AUDIO_OWNER = 'session';
/** A notification action waits this long for its call to ring in the page. */
export const PENDING_ACTION_MAX_AGE_MS = 60_000;
/** Largest avatar handed to the notification (bytes, before base64). */
export const MAX_AVATAR_BYTES = 512 * 1024;
const AVATAR_FETCH_TIMEOUT_MS = 4_000;
const AVATAR_CACHE_MAX = 24;

export type NativeCallMode = 'idle' | 'ringing' | 'active';

export type NativeCallStep = {
  mode: NativeCallMode;
  /** For mode 'active'. */
  phase?: NativeCallPhase;
};

/**
 * Map the page's call states to what native needs.
 * DM (useVoiceCall): idle | calling | ringing | connected | ended.
 * Group (roomState): idle | joining | connected | ended.
 */
export function nativeCallStep(
  callState: string | null | undefined
): NativeCallStep {
  switch (callState) {
    case 'ringing':
      return { mode: 'ringing' };
    case 'calling':
      return { mode: 'active', phase: 'calling' };
    case 'joining':
      return { mode: 'active', phase: 'joining' };
    case 'connecting':
      return { mode: 'active', phase: 'connecting' };
    case 'connected':
      return { mode: 'active', phase: 'connected' };
    default:
      return { mode: 'idle' };
  }
}

export type PendingNativeAction = {
  action: NativeCallAction;
  callId: string;
  at: number;
};

/**
 * Which callback a notification action maps to right now, or 'wait' (keep
 * it until the call rings in the page), or 'drop'.
 *
 * `runningCallId`: while a call rings, the id of the call that already runs
 * next to it (call waiting, e.g. a group call while a 1:1 call rings). Its
 * ongoing notification's Hang up / Mute still reach that call.
 */
export function routeNativeAction(
  action: NativeCallAction,
  actionCallId: string,
  step: NativeCallStep,
  currentCallId: string | null | undefined,
  runningCallId?: string | null
):
  | 'accept'
  | 'decline'
  | 'hangup'
  | 'mute'
  | 'unmute'
  | 'open'
  | 'wait'
  | 'drop' {
  const sameCall =
    !actionCallId || !currentCallId || actionCallId === currentCallId;
  const forRunningCall =
    step.mode === 'ringing' &&
    !!runningCallId &&
    !!actionCallId &&
    actionCallId === runningCallId;
  switch (action) {
    case 'accept':
    case 'decline':
      if (step.mode === 'ringing' && sameCall) return action;
      if (step.mode === 'active' && sameCall && action === 'accept') {
        // Already answered (e.g. on screen a moment earlier).
        return 'drop';
      }
      return step.mode === 'idle' ? 'wait' : 'drop';
    case 'hangup':
      if (step.mode === 'active' && sameCall) return 'hangup';
      if (forRunningCall) return 'hangup';
      // Hang up on a call still ringing in the page = decline.
      if (step.mode === 'ringing' && sameCall) return 'decline';
      return 'drop';
    case 'mute':
    case 'unmute':
      if (step.mode === 'active' && sameCall) return action;
      return forRunningCall ? action : 'drop';
    case 'open':
      return 'open';
    default:
      return 'drop';
  }
}

/** A call that runs (dials, joins, connects): what the native session shows. */
export type NativeRunningCall = {
  phase: NativeCallPhase;
  callId: string;
  peerName: string | null;
  peerAvatarUrl: string | null;
  isGroup: boolean;
  muted: boolean;
};

/** The running call's own inputs (see NativeCallSessionOptions.activeCall). */
export type NativeActiveCallInput = {
  callState: string | null | undefined;
  callId?: string | null;
  peerName?: string | null;
  peerAvatarUrl?: string | null;
  isGroup?: boolean;
  muted?: boolean;
};

function runningCallFrom(
  input: NativeActiveCallInput | null | undefined
): NativeRunningCall | null {
  if (!input) return null;
  const step = nativeCallStep(input.callState);
  if (step.mode !== 'active' || !step.phase) return null;
  return {
    phase: step.phase,
    callId: input.callId ?? '',
    peerName: input.peerName ?? null,
    peerAvatarUrl: input.peerAvatarUrl ?? null,
    isGroup: !!input.isGroup,
    muted: !!input.muted,
  };
}

/**
 * The call the native session holds (call notification, microphone service,
 * call audio), or null. A call that rings never ends one that runs:
 * - the main inputs are a running call: that one;
 * - they ring: the `explicit` running call when the caller passes one
 *   (`activeCall`), else the call that ran when the ring started (`held`);
 * - idle: the `explicit` running call, if any.
 */
export function runningCallFor(
  step: NativeCallStep,
  main: NativeActiveCallInput,
  explicit: NativeActiveCallInput | null | undefined,
  held: NativeRunningCall | null
): NativeRunningCall | null {
  if (step.mode === 'active') return runningCallFrom(main);
  if (explicit !== undefined) return runningCallFrom(explicit);
  return step.mode === 'ringing' ? held : null;
}

/** A waiting action is still good for the call that now rings. */
export function pendingMatches(
  pending: PendingNativeAction | null,
  ringingCallId: string | null | undefined,
  now: number
): boolean {
  if (!pending) return false;
  if (
    now - pending.at > PENDING_ACTION_MAX_AGE_MS ||
    now < pending.at - 5_000
  ) {
    return false;
  }
  if (pending.action !== 'accept' && pending.action !== 'decline') return false;
  return !pending.callId || !ringingCallId || pending.callId === ringingCallId;
}

// ── Avatars ────────────────────────────────────────────────────────────────

const avatarCache = new Map<string, string | null>();

function rememberAvatar(url: string, dataUrl: string | null): void {
  if (avatarCache.has(url)) avatarCache.delete(url);
  avatarCache.set(url, dataUrl);
  while (avatarCache.size > AVATAR_CACHE_MAX) {
    const oldest = avatarCache.keys().next().value;
    if (oldest === undefined) break;
    avatarCache.delete(oldest);
  }
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}

/**
 * The avatar as a data: URL for the notification (native never fetches:
 * the page holds the node connection). data:image URLs pass through;
 * http(s) / blob URLs are fetched once and cached; anything else is null.
 */
export async function avatarDataUrlFor(
  url: string | null | undefined
): Promise<string | null> {
  if (!url) return null;
  // Bundled seed avatars come as app-relative paths (same origin).
  if (url.startsWith('/') && !url.startsWith('//')) {
    try {
      url = new URL(url, window.location.href).toString();
    } catch {
      return null;
    }
  }
  if (url.startsWith('data:image/')) {
    return url.length <= MAX_AVATAR_BYTES * 1.4 ? url : null;
  }
  if (!/^(https?:|blob:)/i.test(url)) return null;
  if (avatarCache.has(url)) return avatarCache.get(url) ?? null;
  let result: string | null = null;
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), AVATAR_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller?.signal });
    if (response.ok) {
      const blob = await response.blob();
      if (
        blob.size > 0 &&
        blob.size <= MAX_AVATAR_BYTES &&
        (!blob.type || blob.type.startsWith('image/'))
      ) {
        const dataUrl = await blobToDataUrl(blob);
        result = dataUrl && dataUrl.startsWith('data:image/') ? dataUrl : null;
      }
    }
  } catch {
    result = null;
  } finally {
    clearTimeout(timer);
  }
  rememberAvatar(url, result);
  return result;
}

/** avatarDataUrlFor as state, while `enabled`. */
function useAvatarDataUrl(
  url: string | null | undefined,
  enabled: boolean
): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void avatarDataUrlFor(url).then((value) => {
      if (!cancelled) setDataUrl(value);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, url]);
  return enabled ? dataUrl : null;
}

// ── Non-React helpers (all no-ops off GO) ───────────────────────────────────

export function isNativeCallSupported(): boolean {
  return isCapacitor();
}

async function safe<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  if (!isCapacitor()) return fallback;
  try {
    return await run();
  } catch (error) {
    console.warn('[nativeCall]', error);
    return fallback;
  }
}

/**
 * Addresses the signed-in page answers calls for, so native can ring a
 * CALL_REQUEST while the page is frozen. Call with [] on logout.
 */
export function setNativeRingAddresses(addresses: string[]): Promise<void> {
  return safe(async () => {
    await QortalCall.setRingAddresses({
      addresses: addresses.filter((a) => typeof a === 'string' && !!a),
    });
  }, undefined);
}

/** GO's language for the call notifications (keys: NATIVE_CALL_STRING_KEYS). */
export function setNativeCallStrings(
  strings: Partial<Record<NativeCallStringKey, string>>
): Promise<void> {
  return safe(async () => {
    await QortalCall.setStrings({ strings });
  }, undefined);
}

export function nativeShowIncomingCall(options: {
  callId: string;
  fromAddress?: string;
  fromName?: string;
  avatarDataUrl?: string;
  kind?: NativeCallKind;
}): Promise<void> {
  return safe(async () => {
    await QortalCall.showIncomingCall(options);
  }, undefined);
}

/** Stop the ringtone, keep the call offer (the page silences its own ring). */
export function nativeSilenceRing(callId?: string | null): Promise<void> {
  return safe(async () => {
    await QortalCall.silenceRing({ callId: callId || undefined });
  }, undefined);
}

export function nativeCancelIncomingCall(
  callId: string,
  reason = 'page'
): Promise<void> {
  return safe(async () => {
    await QortalCall.cancelIncomingCall({ callId, reason });
  }, undefined);
}

export type NativeDeviceLockState = {
  locked: boolean;
  secure: boolean;
  interactive: boolean;
};

export function getNativeDeviceLockState(): Promise<NativeDeviceLockState> {
  return safe(() => QortalCall.isDeviceLocked(), {
    locked: false,
    secure: false,
    interactive: true,
  });
}

/** Android's own unlock prompt over GO (e.g. "Open GO" from the call screen). */
export function requestNativeUnlock(): Promise<string> {
  return safe(
    async () => (await QortalCall.requestUnlock()).result,
    'unavailable'
  );
}

export function getNativeAudioRoutes(): Promise<AudioRouteState | null> {
  return safe(() => AudioRouting.getAudioRoutes(), null);
}

export function setNativeAudioRoute(
  route: AudioRoute
): Promise<AudioRouteState | null> {
  return safe(() => AudioRouting.setAudioRoute({ route }), null);
}

export function canUseNativeFullScreenRing(): Promise<boolean> {
  return safe(
    async () => (await QortalCall.canUseFullScreenIntent()).allowed,
    true
  );
}

export function openNativeFullScreenRingSettings(): Promise<boolean> {
  return safe(
    async () => (await QortalCall.openFullScreenIntentSettings()).opened,
    false
  );
}

export function getNativeCallDiagnostics(): Promise<Record<
  string,
  unknown
> | null> {
  return safe(() => QortalCall.getState(), null);
}

// ── Hook ────────────────────────────────────────────────────────────────────

export type NativeCallSessionOptions = {
  /** DM callState or group roomState (see nativeCallStep). */
  callState: string | null | undefined;
  callId?: string | null;
  peerName?: string | null;
  peerAddress?: string | null;
  /** data:, http(s): or blob: image URL. */
  peerAvatarUrl?: string | null;
  isGroup?: boolean;
  muted?: boolean;
  /**
   * Hold the call audio (AudioRouting owner 'session'): default route,
   * headsets, proximity. Default true.
   */
  manageAudio?: boolean;
  onAccept?: (callId: string) => void;
  onDecline?: (callId: string) => void;
  onHangup?: (callId: string) => void;
  /** nextMuted: the notification's Mute (true) or Unmute (false). */
  onToggleMute?: (nextMuted: boolean, callId: string) => void;
  /** The call notification was tapped (GO opened): show the call screen. */
  onOpen?: (callId: string) => void;
  /**
   * The call that runs while `callState` is 'ringing' (call waiting, e.g. a
   * group call while a 1:1 call rings), so its notification and microphone
   * service stay up to date during the ring. Optional: without it the hook
   * keeps the running call as it was when the ring started. A ring never
   * ends a running call either way.
   */
  activeCall?: NativeActiveCallInput | null;
  /**
   * The signed-in address (null / '' when signed out). Lets Android ring a
   * call request for it while the page is frozen off screen. Omit it when
   * something else calls setNativeRingAddresses.
   */
  localAddress?: string | null;
};

export type NativeCallSessionState = {
  /** Running on GO (Android). */
  supported: boolean;
  /** Lock screen is up (GO may be shown over it): show only the call screen. */
  deviceLocked: boolean;
  screenOn: boolean;
  /** The tray ringtone plays: the page must not play its own ring. */
  nativeRinging: boolean;
  /** Mic works off screen (null = unknown / no call). */
  micForeground: boolean | null;
  audioRoute: AudioRoute | null;
  audioRoutes: AudioRoute[];
  /** 'gain' | 'loss' | 'loss_transient' | 'duck' while a call holds audio. */
  audioFocus: string | null;
  setAudioRoute: (route: AudioRoute) => Promise<void>;
  requestUnlock: () => Promise<string>;
  /** Same as deviceLocked (name the GO call UI adapter reads). */
  keyguardLocked: boolean;
  /** Stop the ringtone without declining (Android back on the ring screen). */
  silenceRinger: () => void;
};

export function useNativeCallSession(
  options: NativeCallSessionOptions
): NativeCallSessionState {
  const supported = isCapacitor();
  const {
    callState,
    callId,
    peerName,
    peerAddress,
    peerAvatarUrl,
    isGroup = false,
    muted = false,
    manageAudio = true,
  } = options;
  const step = nativeCallStep(callState);
  const kind: NativeCallKind = isGroup ? 'group' : 'dm';
  const id = callId ?? '';

  // The running call. While another call rings, the one that ran when the
  // ring started is kept (unless the caller passes `activeCall`), so a ring
  // never takes the running call's microphone service and audio away.
  const heldRef = useRef<NativeRunningCall | null>(null);
  const running = runningCallFor(
    step,
    { callState, callId, peerName, peerAvatarUrl, isGroup, muted },
    options.activeCall,
    heldRef.current
  );
  if (step.mode !== 'ringing') heldRef.current = running;
  const runningKind: NativeCallKind = running?.isGroup ? 'group' : 'dm';
  const runningId = running?.callId ?? '';

  const [deviceLocked, setDeviceLocked] = useState(false);
  const [screenOn, setScreenOn] = useState(true);
  const [nativeRingCallId, setNativeRingCallId] = useState<string | null>(null);
  const [micForeground, setMicForeground] = useState<boolean | null>(null);
  const [audio, setAudio] = useState<AudioRouteState | null>(null);
  const [audioFocus, setAudioFocus] = useState<string | null>(null);

  // Latest values for the event handlers (subscribed once).
  const latest = useRef({ options, step, id, runningId });
  latest.current = { options, step, id, runningId };
  const pendingRef = useRef<PendingNativeAction | null>(null);

  // One tap reaches the page twice on a cold start (the retained event and
  // getPendingCallAction); handle it once.
  const handledRef = useRef<string[]>([]);
  const runAction = useCallback(
    (action: NativeCallAction, actionCallId: string, at: number) => {
      const {
        options: o,
        step: s,
        id: current,
        runningId: runningNow,
      } = latest.current;
      const target = routeNativeAction(
        action,
        actionCallId,
        s,
        current,
        s.mode === 'ringing' ? runningNow : null
      );
      const useId = actionCallId || current;
      if (target !== 'wait') {
        // Waiting is not handling: the replay for the ringing call must run.
        const key = `${action}|${useId}|${at}`;
        if (handledRef.current.includes(key)) return;
        handledRef.current = [...handledRef.current.slice(-15), key];
      }
      switch (target) {
        case 'accept':
          pendingRef.current = null;
          o.onAccept?.(useId);
          break;
        case 'decline':
          pendingRef.current = null;
          o.onDecline?.(useId);
          break;
        case 'hangup':
          o.onHangup?.(useId);
          break;
        case 'mute':
          o.onToggleMute?.(true, useId);
          break;
        case 'unmute':
          o.onToggleMute?.(false, useId);
          break;
        case 'open':
          o.onOpen?.(useId);
          break;
        case 'wait':
          pendingRef.current = { action, callId: actionCallId, at };
          break;
        default:
          break;
      }
    },
    []
  );

  // Native events: once per mount.
  useEffect(() => {
    if (!supported) return undefined;
    let disposed = false;
    const handles: PluginListenerHandle[] = [];
    const keep = (p: Promise<PluginListenerHandle>) => {
      p.then((h) => {
        if (disposed) void h.remove();
        else handles.push(h);
      }).catch(() => {});
    };
    keep(
      QortalCall.addListener('callAction', (event: NativeCallActionEvent) => {
        runAction(event.action, event.callId || '', event.at || Date.now());
        if (
          event.action === 'accept' ||
          event.action === 'decline' ||
          event.action === 'open'
        ) {
          void QortalCall.clearPendingCallAction().catch(() => {});
        }
      })
    );
    keep(
      QortalCall.addListener('ringStateChanged', (event: NativeRingState) => {
        setNativeRingCallId(
          event.ringing && event.posted ? event.callId || '' : null
        );
      })
    );
    keep(
      QortalCall.addListener('deviceLockChanged', (event) => {
        setDeviceLocked(!!event.locked);
        setScreenOn(event.interactive !== false);
      })
    );
    keep(
      QortalCall.addListener('callForegroundChanged', (event) => {
        setMicForeground(
          typeof event.micForeground === 'boolean' ? event.micForeground : null
        );
      })
    );
    keep(
      AudioRouting.addListener('audioRouteChanged', (event) => setAudio(event))
    );
    keep(
      AudioRouting.addListener('audioFocusChanged', (event) =>
        setAudioFocus(event.focus || null)
      )
    );
    void QortalCall.isDeviceLocked()
      .then((s) => {
        if (disposed) return;
        setDeviceLocked(!!s.locked);
        setScreenOn(s.interactive !== false);
      })
      .catch(() => {});
    void QortalCall.getRingState()
      .then((s) => {
        if (!disposed)
          setNativeRingCallId(s.ringing && s.posted ? s.callId || '' : null);
      })
      .catch(() => {});
    // Accept tapped before this page subscribed (cold start).
    void QortalCall.getPendingCallAction()
      .then((p) => {
        if (disposed || !p || !p.action) return;
        runAction(p.action, p.callId || '', p.at || Date.now());
        void QortalCall.clearPendingCallAction().catch(() => {});
      })
      .catch(() => {});
    return () => {
      disposed = true;
      for (const h of handles) void h.remove();
    };
  }, [supported, runAction]);

  // The signed-in address, for the native ring while the page is frozen.
  const localAddress = options.localAddress;
  useEffect(() => {
    if (!supported || localAddress === undefined) return undefined;
    const addresses = localAddress ? [localAddress] : [];
    void setNativeRingAddresses(addresses);
    return () => {
      // Signed out or the call UI went away: no native ring for it.
      if (addresses.length > 0) void setNativeRingAddresses([]);
    };
  }, [supported, localAddress]);

  // Caller and running-call avatars as data: URLs (they differ while a
  // second call rings).
  const ringAvatarDataUrl = useAvatarDataUrl(
    peerAvatarUrl,
    supported && step.mode === 'ringing'
  );
  const runningAvatarDataUrl = useAvatarDataUrl(
    running?.peerAvatarUrl ?? null,
    supported && running !== null
  );

  // Ringing.
  const ringingId = step.mode === 'ringing' ? id : null;
  useEffect(() => {
    if (!supported || !ringingId) return undefined;
    void QortalCall.showIncomingCall({
      callId: ringingId,
      fromAddress: peerAddress || undefined,
      fromName: peerName || undefined,
      avatarDataUrl: ringAvatarDataUrl || undefined,
      kind,
    }).catch(() => {});
    return undefined;
  }, [supported, ringingId, peerAddress, peerName, ringAvatarDataUrl, kind]);

  useEffect(() => {
    if (!supported || !ringingId) return undefined;
    // An Accept / Decline that came before the page knew the call.
    if (pendingMatches(pendingRef.current, ringingId, Date.now())) {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) runAction(pending.action, ringingId, pending.at);
    }
    return () => {
      // The ring is over for the page (answered, declined, cancelled, gone).
      void QortalCall.cancelIncomingCall({
        callId: ringingId,
        reason: 'page-ring-ended',
      }).catch(() => {});
    };
  }, [supported, ringingId, runAction]);

  // In a call. One native call session from the first running state to the
  // first state with no running call; the callId may arrive after dialing
  // started, and a call answered while another ran (call waiting) takes the
  // session over without dropping the microphone service.
  const active = running !== null;
  const connectedAtRef = useRef<number>(0);
  const sessionIdRef = useRef<string>('');
  const audioPlanRef = useRef({ manageAudio, kind: runningKind });
  audioPlanRef.current = { manageAudio, kind: runningKind };
  const audioKindRef = useRef<NativeCallKind | null>(null);
  useEffect(() => {
    if (!supported || !active) return undefined;
    connectedAtRef.current = 0;
    sessionIdRef.current = '';
    // Fixed for this session: whether this hook holds the call audio.
    const plan = audioPlanRef.current;
    audioKindRef.current = plan.kind;
    if (plan.manageAudio) {
      void AudioRouting.startCall({
        owner: NATIVE_CALL_AUDIO_OWNER,
        kind: plan.kind,
      })
        .then((state) => setAudio(state))
        .catch(() => {});
    }
    return () => {
      const endedId = sessionIdRef.current;
      void QortalCall.setCallActive({
        active: false,
        callId: endedId || undefined,
      }).catch(() => {});
      if (plan.manageAudio) {
        void AudioRouting.endCall({ owner: NATIVE_CALL_AUDIO_OWNER }).catch(
          () => {}
        );
      }
      audioKindRef.current = null;
      setMicForeground(null);
    };
  }, [supported, active]);

  // Call waiting answered across kinds (group -> 1:1): the new call gets
  // its own default route (earpiece for 1:1, loudspeaker for groups).
  useEffect(() => {
    if (!supported || !active || !audioPlanRef.current.manageAudio) return;
    if (audioKindRef.current === null || audioKindRef.current === runningKind) {
      return;
    }
    audioKindRef.current = runningKind;
    void AudioRouting.startCall({
      owner: NATIVE_CALL_AUDIO_OWNER,
      kind: runningKind,
    })
      .then((state) => setAudio(state))
      .catch(() => {});
  }, [supported, active, runningKind]);

  const phase = running?.phase;
  const runningPeerName = running?.peerName ?? null;
  const runningMuted = running?.muted ?? false;
  useEffect(() => {
    if (!supported || !active) return;
    if (
      runningId &&
      sessionIdRef.current &&
      runningId !== sessionIdRef.current
    ) {
      // Another call took this session over: its own call timer.
      connectedAtRef.current = 0;
    }
    if (runningId) sessionIdRef.current = runningId;
    if (phase === 'connected' && !connectedAtRef.current) {
      connectedAtRef.current = Date.now();
    }
    void QortalCall.setCallActive({
      active: true,
      callId: runningId || undefined,
      kind: runningKind,
      phase,
      peerName: runningPeerName || undefined,
      avatarDataUrl: runningAvatarDataUrl || undefined,
      muted: runningMuted,
      connectedAt: connectedAtRef.current || undefined,
    })
      .then((r) => {
        if (r && typeof r.micForeground === 'boolean') {
          setMicForeground(r.micForeground);
        }
      })
      .catch(() => {});
  }, [
    supported,
    active,
    runningId,
    phase,
    runningPeerName,
    runningAvatarDataUrl,
    runningMuted,
    runningKind,
  ]);

  // Ring state from native belongs to the call that rings now.
  const nativeRinging =
    supported &&
    nativeRingCallId !== null &&
    (!nativeRingCallId || !ringingId || nativeRingCallId === ringingId);

  const silenceRinger = useCallback(() => {
    void nativeSilenceRing(latest.current.id);
  }, []);

  const setAudioRoute = useCallback(async (route: AudioRoute) => {
    const state = await setNativeAudioRoute(route);
    if (state) setAudio(state);
  }, []);

  return {
    supported,
    deviceLocked: supported && deviceLocked,
    screenOn,
    nativeRinging,
    micForeground: supported ? micForeground : null,
    audioRoute: (audio?.route as AudioRoute | undefined) ?? null,
    audioRoutes: (audio?.routes as AudioRoute[] | undefined) ?? [],
    audioFocus: supported ? audioFocus : null,
    setAudioRoute,
    requestUnlock: requestNativeUnlock,
    keyguardLocked: supported && deviceLocked,
    silenceRinger,
  };
}

/**
 * Lock screen state only (for components that must hide wallet / chats
 * while GO is shown over the lock screen). false off GO.
 */
export function useNativeDeviceLocked(): boolean {
  const supported = isCapacitor();
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (!supported) return undefined;
    let disposed = false;
    let handle: PluginListenerHandle | null = null;
    QortalCall.addListener('deviceLockChanged', (event) =>
      setLocked(!!event.locked)
    )
      .then((h) => {
        if (disposed) void h.remove();
        else handle = h;
      })
      .catch(() => {});
    void getNativeDeviceLockState().then((s) => {
      if (!disposed) setLocked(s.locked);
    });
    return () => {
      disposed = true;
      if (handle) void handle.remove();
    };
  }, [supported]);
  return supported && locked;
}
