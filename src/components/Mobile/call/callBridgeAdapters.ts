/**
 * Small adapters between the GO call UI and the GO call plumbing that other
 * work streams own:
 *
 * - `src/bridge/nativeCallSession.ts` (Android call session: ringing
 *   notification, ongoing-call notification, mic foreground service, lock
 *   screen). Used through `useNativeCallSessionAdapter`.
 * - `src/bridge/callTransportPreference.ts` (Direct / Private calls setting).
 * - Audio routes: `AudioRouting.listRoutes / setRoute / routeChanged` when the
 *   native plugin has them, else the speaker toggle in mobileAudioSurface.
 *
 * The bridge modules are picked up with an eager `import.meta.glob`, so this
 * file builds whether or not they exist yet; when one is missing the code
 * below falls back to what GO did before (or to the same localStorage key).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioRouting } from '../../../plugins/AudioRouting';
import { QortalBackground } from '../../../plugins/QortalBackground';
import * as mobileAudioSurface from '../../../bridge/mobileAudioSurface';
import {
  isCallSpeakerOn,
  setCallSpeaker,
} from '../../../bridge/mobileAudioSurface';
import {
  dismissIncomingCallOsNotification,
  showIncomingCallOsNotification,
} from '../../../utils/mobileOsNotifications';
import { isCapacitor } from '../../../utils/platform';
import type { NativeCallState } from './callUiModel';
import { shortCallAddress } from './callUiModel';

// ---- Native call session --------------------------------------------------

export interface NativeCallSessionOptions {
  callState: NativeCallState;
  callId: string | null;
  peerName: string;
  peerAvatarUrl: string | null;
  isGroup: boolean;
  muted: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onHangup: () => void;
  /** `nextMuted`: the notification's Mute (true) / Unmute (false). */
  onToggleMute: (nextMuted?: boolean) => void;
  /** A call notification opened GO: show the call screen. */
  onOpen?: () => void;
  peerAddress?: string | null;
  /**
   * The signed-in address ('' / null when signed out): lets Android ring a
   * call request for it while the page is frozen off screen.
   */
  localAddress?: string | null;
}

/** What the call UI reads back from the native session, all optional. */
export interface NativeCallSessionInfo {
  /** Android rings natively: skip the in-page chime. */
  nativeRinging?: boolean;
  /** The phone's own lock screen is up: show only the call UI. */
  keyguardLocked?: boolean;
  /** Stop the ringtone without declining (Android back on the ring screen). */
  silenceRinger?: () => void;
  /** Android's own unlock prompt over GO. */
  requestUnlock?: () => Promise<unknown>;
}

type NativeCallSessionModule = {
  useNativeCallSession?: (options: Record<string, unknown>) => unknown;
  setNativeCallStrings?: (strings: Record<string, string>) => Promise<void>;
  nativeShowIncomingCall?: (options: {
    callId: string;
    fromAddress?: string;
    fromName?: string;
    avatarDataUrl?: string;
    kind?: 'dm' | 'group';
  }) => Promise<void>;
  nativeCancelIncomingCall?: (callId: string, reason?: string) => Promise<void>;
  nativeSilenceRing?: (callId?: string | null) => Promise<void>;
  avatarDataUrlFor?: (url: string | null | undefined) => Promise<string | null>;
  canUseNativeFullScreenRing?: () => Promise<boolean>;
  openNativeFullScreenRingSettings?: () => Promise<boolean>;
};

type CallActionListenerHandle = { remove: () => unknown };
type QortalCallPluginModule = {
  QortalCall?: {
    addListener?: (
      event: 'callAction',
      cb: (event: { action?: string; callId?: string }) => void
    ) => Promise<CallActionListenerHandle>;
  };
};

const qortalCallModules = import.meta.glob<QortalCallPluginModule>(
  '../../../plugins/QortalCall.ts',
  { eager: true }
);
const qortalCallPlugin =
  Object.values(qortalCallModules)[0]?.QortalCall ?? null;

const nativeSessionModules = import.meta.glob<NativeCallSessionModule>(
  '../../../bridge/nativeCallSession.ts',
  { eager: true }
);

const nativeSessionModule: NativeCallSessionModule | null =
  Object.values(nativeSessionModules)[0] ?? null;

const externalNativeSession: ((o: Record<string, unknown>) => unknown) | null =
  typeof nativeSessionModule?.useNativeCallSession === 'function'
    ? nativeSessionModule.useNativeCallSession
    : null;

/**
 * Hands GO's own language to the call notifications (Android's ringing and
 * ongoing-call texts). No-op without the native session module.
 */
export function pushNativeCallStrings(strings: Record<string, string>): void {
  try {
    void nativeSessionModule
      ?.setNativeCallStrings?.(strings)
      ?.catch?.(() => undefined);
  } catch {
    /* best effort */
  }
}

/** True when the Android call-session module is part of this build. */
export const hasNativeCallSessionModule = externalNativeSession !== null;

/**
 * Before the native call session existed, MobileIncomingCallBridge (now
 * removed) posted the ringing notification and wired its Accept / Decline
 * buttons. Same behaviour, with the caller's name instead of a short
 * address; only used by a build without src/bridge/nativeCallSession.ts.
 */
function useLegacyNativeCallSession(options: NativeCallSessionOptions): void {
  const acceptRef = useRef(options.onAccept);
  const declineRef = useRef(options.onDecline);
  acceptRef.current = options.onAccept;
  declineRef.current = options.onDecline;

  useEffect(() => {
    if (!isCapacitor()) return undefined;
    let handle: { remove: () => void } | null = null;
    let disposed = false;
    void QortalBackground.addListener('incomingCallAction', (event) => {
      if (event?.action === 'accept') acceptRef.current();
      else if (event?.action === 'decline') declineRef.current();
    })
      .then((h) => {
        if (disposed) h.remove();
        else handle = h;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      handle?.remove();
    };
  }, []);

  const { callState, callId, isGroup, peerName, peerAddress } = options;
  useEffect(() => {
    if (!isCapacitor()) return;
    if (callState === 'ringing' && callId && !isGroup) {
      void showIncomingCallOsNotification({
        callId,
        fromAddress: peerAddress ?? '',
        fromName: peerName || shortCallAddress(peerAddress ?? ''),
      });
      return;
    }
    void dismissIncomingCallOsNotification();
  }, [callState, callId, isGroup, peerName, peerAddress]);
}

function readSessionInfo(value: unknown): NativeCallSessionInfo {
  if (!value || typeof value !== 'object') return {};
  const v = value as Record<string, unknown>;
  return {
    nativeRinging: v.nativeRinging === true,
    keyguardLocked: v.keyguardLocked === true,
    silenceRinger:
      typeof v.silenceRinger === 'function'
        ? (v.silenceRinger as () => void)
        : undefined,
    requestUnlock:
      typeof v.requestUnlock === 'function'
        ? (v.requestUnlock as () => Promise<unknown>)
        : undefined,
  };
}

/** Mounts the Android call session (or the old notification bridge). */
export function useNativeCallSessionAdapter(
  options: NativeCallSessionOptions
): NativeCallSessionInfo {
  if (externalNativeSession) {
    // Chosen once at module load, so the hook order never changes. The
    // session hands back the call id it acted on; the UI acts on the call
    // it shows, so the ids are dropped here.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return readSessionInfo(
      externalNativeSession({
        ...options,
        onAccept: () => options.onAccept(),
        onDecline: () => options.onDecline(),
        onHangup: () => options.onHangup(),
        onToggleMute: (nextMuted: unknown) =>
          options.onToggleMute(
            typeof nextMuted === 'boolean' ? nextMuted : undefined
          ),
        onOpen: () => options.onOpen?.(),
      })
    );
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useLegacyNativeCallSession(options);
  return {};
}

// ---- Full-screen ring (Android 14+) ----------------------------------------

/**
 * Android 14+ lets an app show a call over the lock screen (full-screen
 * notification) only with the user's OK. True when it may (and below
 * Android 14), false when the switch is off, null when unknown (off GO, no
 * native module).
 */
export async function checkFullScreenRingAllowed(): Promise<boolean | null> {
  if (!isCapacitor()) return null;
  const check = nativeSessionModule?.canUseNativeFullScreenRing;
  if (typeof check !== 'function') return null;
  try {
    const allowed = await check();
    return typeof allowed === 'boolean' ? allowed : null;
  } catch {
    return null;
  }
}

/** Opens Android's own switch for it (a system screen, not a web page). */
export async function openFullScreenRingSettings(): Promise<boolean> {
  const open = nativeSessionModule?.openNativeFullScreenRingSettings;
  if (!isCapacitor() || typeof open !== 'function') return false;
  try {
    return (await open()) === true;
  } catch {
    return false;
  }
}

/**
 * The full-screen ring permission, read on mount and again whenever GO comes
 * back on screen (e.g. from Android's settings). null = unknown.
 */
export function useFullScreenRingAllowed(enabled = true): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled || !isCapacitor()) {
      setAllowed(null);
      return undefined;
    }
    let disposed = false;
    const read = () => {
      void checkFullScreenRingAllowed().then((value) => {
        if (!disposed) setAllowed(value);
      });
    };
    read();
    const onVisible = () => {
      if (document.visibilityState === 'visible') read();
    };
    // Capacitor also fires 'resume' on document when the activity resumes.
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('resume', read);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('resume', read);
    };
  }, [enabled]);
  return allowed;
}

// ---- A ring beside a running call ------------------------------------------

export interface NativeSideRingOptions {
  /** A 1:1 call rings while another call runs (e.g. a group call). */
  enabled: boolean;
  callId: string | null;
  fromAddress: string;
  fromName: string;
  avatarUrl: string | null;
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * The Android call session (useNativeCallSession) follows one call at a
 * time. While a group call runs it must stay on that call: switching it to
 * 'ringing' would drop the microphone service, the Wi-Fi lock and the
 * ongoing-call notification for the whole ring, and Android 14+ may refuse
 * the microphone service again from the background afterwards. So a ring
 * that comes during a call is posted on its own here (CallSession keeps a
 * ring and an active call side by side) and its notification buttons are
 * handled here: the session hook drops them, they are not for its call.
 * No-op off GO or without the native module. Returns `silence` (Android
 * back on the ring screen: stop the ringtone, keep the call offer).
 */
export function useNativeSideRing(options: NativeSideRingOptions): {
  silence: () => void;
} {
  const session = nativeSessionModule;
  const supported =
    isCapacitor() && typeof session?.nativeShowIncomingCall === 'function';
  const ringId =
    supported && options.enabled && options.callId ? options.callId : null;
  const { fromAddress, fromName, avatarUrl } = options;
  const handlersRef = useRef({
    onAccept: options.onAccept,
    onDecline: options.onDecline,
  });
  handlersRef.current = {
    onAccept: options.onAccept,
    onDecline: options.onDecline,
  };

  // The caller's picture as a data: URL (native never fetches).
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  useEffect(() => {
    setAvatarDataUrl(null);
    if (!ringId || !avatarUrl || !session?.avatarDataUrlFor) return undefined;
    let cancelled = false;
    session
      .avatarDataUrlFor(avatarUrl)
      .then((dataUrl) => {
        if (!cancelled) setAvatarDataUrl(dataUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ringId, avatarUrl, session]);

  // Post the ring (again with the name / picture once known).
  useEffect(() => {
    if (!ringId) return;
    void session
      ?.nativeShowIncomingCall?.({
        callId: ringId,
        fromAddress: fromAddress || undefined,
        fromName: fromName || undefined,
        avatarDataUrl: avatarDataUrl || undefined,
        kind: 'dm',
      })
      ?.catch?.(() => undefined);
  }, [ringId, fromAddress, fromName, avatarDataUrl, session]);

  // The page's ring is over (answered, declined, cancelled, gone).
  useEffect(() => {
    if (!ringId) return undefined;
    return () => {
      void session
        ?.nativeCancelIncomingCall?.(ringId, 'page-ring-ended')
        ?.catch?.(() => undefined);
    };
  }, [ringId, session]);

  // Accept / Decline on this ring's notification.
  useEffect(() => {
    if (!ringId || typeof qortalCallPlugin?.addListener !== 'function') {
      return undefined;
    }
    let disposed = false;
    let handle: CallActionListenerHandle | null = null;
    try {
      qortalCallPlugin
        .addListener('callAction', (event) => {
          if (!event || event.callId !== ringId) return;
          if (event.action === 'accept') handlersRef.current.onAccept();
          else if (event.action === 'decline' || event.action === 'hangup') {
            handlersRef.current.onDecline();
          }
        })
        .then((h) => {
          if (disposed) void h.remove();
          else handle = h;
        })
        .catch(() => undefined);
    } catch {
      /* no native call actions */
    }
    return () => {
      disposed = true;
      if (handle) void handle.remove();
    };
  }, [ringId]);

  const silence = useCallback(() => {
    if (!ringId) return;
    void session?.nativeSilenceRing?.(ringId)?.catch?.(() => undefined);
  }, [ringId, session]);

  return { silence };
}

// ---- Call transport preference (Direct / Private) -------------------------

export type CallTransportPreference = 'webrtc' | 'reticulum';

type TransportPreferenceModule = {
  getCallTransportPreference?: () => CallTransportPreference;
  setCallTransportPreference?: (value: CallTransportPreference) => void;
  subscribe?: (cb: () => void) => () => void;
  subscribeCallTransportPreference?: (cb: () => void) => () => void;
};

const transportModules = import.meta.glob<TransportPreferenceModule>(
  '../../../bridge/callTransportPreference.ts',
  { eager: true }
);
const transportModule: TransportPreferenceModule | null =
  Object.values(transportModules)[0] ?? null;

/** Same key and default as src/bridge/callTransportPreference.ts. */
export const CALL_TRANSPORT_STORAGE_KEY = 'go.calls.transport';
const fallbackListeners = new Set<() => void>();

function readFallbackPreference(): CallTransportPreference {
  try {
    return localStorage.getItem(CALL_TRANSPORT_STORAGE_KEY) === 'reticulum'
      ? 'reticulum'
      : 'webrtc';
  } catch {
    return 'webrtc';
  }
}

export function getCallTransportPreferenceSafe(): CallTransportPreference {
  try {
    const value = transportModule?.getCallTransportPreference?.();
    if (value === 'webrtc' || value === 'reticulum') return value;
  } catch {
    /* fall through to storage */
  }
  return readFallbackPreference();
}

export function setCallTransportPreferenceSafe(
  value: CallTransportPreference
): void {
  if (typeof transportModule?.setCallTransportPreference === 'function') {
    transportModule.setCallTransportPreference(value);
    return;
  }
  try {
    localStorage.setItem(CALL_TRANSPORT_STORAGE_KEY, value);
  } catch {
    /* blocked storage: the choice lasts until reload */
  }
  fallbackListeners.forEach((cb) => cb());
}

function subscribeCallTransportPreferenceSafe(cb: () => void): () => void {
  const sub =
    transportModule?.subscribe ??
    transportModule?.subscribeCallTransportPreference;
  if (typeof sub === 'function') {
    try {
      const off = sub(cb);
      if (typeof off === 'function') return off;
    } catch {
      /* fall back below */
    }
  }
  fallbackListeners.add(cb);
  return () => {
    fallbackListeners.delete(cb);
  };
}

export function useCallTransportPreference(): [
  CallTransportPreference,
  (value: CallTransportPreference) => void,
] {
  const [value, setValue] = useState<CallTransportPreference>(
    getCallTransportPreferenceSafe
  );
  useEffect(
    () =>
      subscribeCallTransportPreferenceSafe(() =>
        setValue(getCallTransportPreferenceSafe())
      ),
    []
  );
  const update = useCallback((next: CallTransportPreference) => {
    setCallTransportPreferenceSafe(next);
    setValue(getCallTransportPreferenceSafe());
  }, []);
  return [value, update];
}

// ---- Audio routes ---------------------------------------------------------

export type CallAudioRouteType = 'earpiece' | 'speaker' | 'bluetooth' | 'wired';

export interface CallAudioRoute {
  type: CallAudioRouteType;
  /** Device name from Android (Bluetooth), when known. */
  name?: string;
}

export interface CallAudioRoutesState {
  routes: CallAudioRoute[];
  current: CallAudioRouteType;
  /** Android reported its routes (else: speaker / earpiece only). */
  native: boolean;
}

type RoutingWithRoutes = {
  listRoutes?: () => Promise<unknown>;
  setRoute?: (options: { type: CallAudioRouteType }) => Promise<unknown>;
  addListener?: (
    event: string,
    cb: (payload: unknown) => void
  ) => Promise<{ remove: () => void }> | { remove: () => void };
};

const ROUTE_TYPES: CallAudioRouteType[] = [
  'earpiece',
  'speaker',
  'bluetooth',
  'wired',
];
const ROUTE_ALIASES: Record<string, CallAudioRouteType> = {
  earpiece: 'earpiece',
  builtin_earpiece: 'earpiece',
  phone: 'earpiece',
  speaker: 'speaker',
  builtin_speaker: 'speaker',
  bluetooth: 'bluetooth',
  bluetooth_sco: 'bluetooth',
  bluetooth_a2dp: 'bluetooth',
  ble_headset: 'bluetooth',
  hearing_aid: 'bluetooth',
  wired: 'wired',
  wired_headset: 'wired',
  wired_headphones: 'wired',
  usb_headset: 'wired',
  headset: 'wired',
};

const routeType = (value: unknown): CallAudioRouteType | null => {
  if (typeof value !== 'string') return null;
  return ROUTE_ALIASES[value.trim().toLowerCase()] ?? null;
};

/** Reads `{routes, route|current}` (AudioRouting state) from the native plugin. */
export function parseNativeRoutes(raw: unknown): CallAudioRoutesState | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const list = Array.isArray(value.routes) ? value.routes : null;
  if (!list) return null;
  const routes: CallAudioRoute[] = [];
  for (const entry of list) {
    const type = routeType(
      typeof entry === 'string'
        ? entry
        : (entry as Record<string, unknown>)?.type
    );
    if (!type || routes.some((r) => r.type === type)) continue;
    const name =
      typeof entry === 'object' && entry
        ? (entry as Record<string, unknown>).name
        : undefined;
    routes.push(
      typeof name === 'string' && name.trim() ? { type, name } : { type }
    );
  }
  if (routes.length === 0) return null;
  routes.sort(
    (a, b) => ROUTE_TYPES.indexOf(a.type) - ROUTE_TYPES.indexOf(b.type)
  );
  // AudioRouting reports `route` (and `current`); `active` there is a boolean.
  const current =
    routeType(value.route) ??
    routeType(value.current) ??
    routeType(value.active) ??
    routes[0].type;
  return { routes, current, native: true };
}

const fallbackRoutes = (): CallAudioRoutesState => ({
  routes: [{ type: 'earpiece' }, { type: 'speaker' }],
  current: isCallSpeakerOn() ? 'speaker' : 'earpiece',
  native: false,
});

/**
 * The call's audio routes while `active`: Android's list when the plugin has
 * one (with plug/unplug updates), otherwise speaker / earpiece. `select`
 * switches the route and returns once it is applied.
 */
export function useCallAudioRoutes(active: boolean): CallAudioRoutesState & {
  select: (type: CallAudioRouteType) => void;
} {
  const [state, setState] = useState<CallAudioRoutesState>(fallbackRoutes);
  const nativeRef = useRef(false);
  const routing = AudioRouting as unknown as RoutingWithRoutes;

  const refresh = useCallback(async () => {
    try {
      const raw = await routing.listRoutes?.();
      const parsed = parseNativeRoutes(raw);
      if (parsed) {
        nativeRef.current = true;
        setState(parsed);
        return;
      }
    } catch {
      /* plugin without routes: speaker toggle */
    }
    nativeRef.current = false;
    setState(fallbackRoutes());
  }, [routing]);

  useEffect(() => {
    if (!active) return undefined;
    let disposed = false;
    let handle: { remove: () => void } | null = null;
    void refresh();
    try {
      const maybe = routing.addListener?.('routeChanged', (payload) => {
        const parsed = parseNativeRoutes(payload);
        if (parsed) {
          nativeRef.current = true;
          setState(parsed);
        } else {
          void refresh();
        }
      });
      Promise.resolve(maybe)
        .then((h) => {
          if (!h) return;
          if (disposed) h.remove();
          else handle = h;
        })
        .catch(() => undefined);
    } catch {
      /* no route events */
    }
    // mobileAudioSurface announces speaker changes (call start defaults:
    // earpiece for 1:1, loudspeaker for groups); older builds only had the
    // flag, so a slow poll keeps the button honest there too.
    const onSpeaker = (
      mobileAudioSurface as unknown as {
        onCallSpeakerChange?: (cb: (speaker: boolean) => void) => () => void;
      }
    ).onCallSpeakerChange;
    let offSpeaker: (() => void) | null = null;
    if (typeof onSpeaker === 'function') {
      try {
        offSpeaker = onSpeaker((speaker) => {
          if (nativeRef.current) {
            void refresh();
            return;
          }
          setState({
            ...fallbackRoutes(),
            current: speaker ? 'speaker' : 'earpiece',
          });
        });
      } catch {
        offSpeaker = null;
      }
    }
    const poll = window.setInterval(() => {
      if (nativeRef.current) return;
      const speaker = isCallSpeakerOn();
      setState((prev) => {
        const current: CallAudioRouteType = speaker ? 'speaker' : 'earpiece';
        return prev.current === current && !prev.native
          ? prev
          : { ...fallbackRoutes(), current };
      });
    }, 1_500);
    return () => {
      disposed = true;
      handle?.remove();
      offSpeaker?.();
      window.clearInterval(poll);
    };
  }, [active, refresh, routing]);

  const select = useCallback(
    (type: CallAudioRouteType) => {
      setState((prev) => ({ ...prev, current: type }));
      const viaSpeakerToggle = async () => {
        const applied = await setCallSpeaker(type === 'speaker');
        setState((prev) =>
          prev.native
            ? prev
            : { ...prev, current: applied ? 'speaker' : 'earpiece' }
        );
      };
      if (nativeRef.current && typeof routing.setRoute === 'function') {
        void routing
          .setRoute({ type })
          .then(() => refresh())
          .catch(() => viaSpeakerToggle());
        return;
      }
      void viaSpeakerToggle();
    },
    [refresh, routing]
  );

  return { ...state, select };
}
