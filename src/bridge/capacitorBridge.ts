/**
 * Capacitor bridge layer for the mobilized Qortal Hub.
 *
 * The Hub renderer was built for two environments: the Electron desktop shell
 * (full `window.electronAPI` / `window.coreSetup` / `window.presence` / `window.chat`
 * / `window.call` / `window.groupCall` bridges) and a plain browser ("HUB_WEB"
 * mode) where none of those exist. Every consumer is guarded for the web case
 * (`if (!window.presence) return`, `window.chat?.…`, `!!window.coreSetup`, etc.),
 * so the cleanest mobile base is exactly that web mode: leave the desktop/P2P
 * bridges undefined and the corresponding UI hides itself gracefully.
 *
 * This module therefore does NOT stub `electronAPI`, `coreSetup`, `presence`,
 * `chat`, `call`, `groupCall` or `audioSurface`: doing so would falsely flip
 * those features "on" and surface buttons that cannot work yet. Instead it:
 *   1. Detects the native Capacitor runtime.
 *   2. Adds mobile-shell niceties (hide splash, Android hardware back button).
 *   3. Marks the documented seam where later phases inject the *real*,
 *      Reticulum-backed `window.presence` / `window.chat` / `window.call` /
 *      `window.groupCall` implementations (see installReticulumBridges()).
 */

import { Capacitor } from '@capacitor/core';
import { Reticulum } from '../plugins/Reticulum';
import type { RelayProfile } from '../plugins/QortalBackground';
import { compactDmVoiceJoinWireChatId } from '../lib/call/dmVoiceWire';
import { installMobileAudioSurface } from './mobileAudioSurface';
import { verifyQchatFileLinkAuth } from '../utils/qchatFileAuthVerify';
import {
  errorCode as fileOpenErrorCode,
  openFileInViewerApp,
} from '../utils/nativeFileOpen';
import { cleanFileName } from '../utils/receivedFileName';
import { P2P_HEALTH_RECEIVING_STABLE_MS } from '../lib/p2pHealth';
import {
  encodeJoinWire,
  encodeJoinIdentityWire,
  encodeLeaveWire,
  encodeKeyWire,
  encodeKeyRequestWire,
  decodeJoinWire,
  decodeKeyWireSingle,
  decodeKeyRequestWireSingle,
  decodeKeyBody,
  decodeKeyRequestBody,
  parseFragmentMeta,
  parseFragmentPart,
  reassembleBody,
  isGroupCallReticulumWireType,
  uint8ToBase64,
  base64ToUint8,
  type GcKeyDecoded,
  type GcKeyRequestDecoded,
  type FragmentMeta,
} from './groupCallWire';

/**
 * True when running inside the native Capacitor Android/iOS WebView. Not on
 * the Electron desktop, whose preload names the platform 'electron', which
 * Capacitor also counts as native (same rule as utils/platform).
 */
export const isCapacitor = (): boolean => {
  try {
    return (
      Capacitor?.isNativePlatform?.() === true &&
      Capacitor.getPlatform?.() !== 'electron'
    );
  } catch {
    return false;
  }
};

/**
 * Event name dispatched on the Android hardware back press.
 * UI layers (e.g. the mobile tab bar / Group view stack) can listen and call
 * `event.preventDefault()` to consume it; otherwise the app is minimized.
 */
export const ANDROID_BACK_EVENT = 'qortal-android-back';

let installed = false;

export function installCapacitorBridge(): void {
  if (installed) return;
  installed = true;

  if (!isCapacitor()) {
    // Plain web / Electron: nothing to do here. Web-mode degradation and the
    // Electron preload bridges both work without this shim.
    return;
  }

  guardBlobWindowOpen();
  installPageVisibilityOverride();
  // Received chat files stay in GO's private storage; logout deletes them.
  void import('../utils/receivedChatFiles')
    .then(({ installReceivedChatFileCleanup }) =>
      installReceivedChatFileCleanup()
    )
    .catch(() => {});

  // Hide the native splash immediately. The launch window is just a solid dark
  // color (no logo), and the in-app HTML splash already covers the WebView, so
  // there's nothing to wait for and no old-logo flash to bridge.
  void import('@capacitor/splash-screen')
    .then(({ SplashScreen }) => {
      SplashScreen.hide().catch(() => {});
    })
    .catch(() => {});

  // Android hardware back button: let the UI handle it; default to minimizing
  // the app (never silently exit on a single back press).
  void import('@capacitor/app')
    .then(({ App }) => {
      // Payment / resource deep links (qortal:// , qort:) opened via a scanned
      // QR code or an external link. Handle both the cold-launch URL and any
      // link received while the app is already running.
      const routeDeepLink = (url?: string | null) => {
        if (!url) return;
        void import('../utils/paymentLink')
          .then(({ handleQortalDeepLink }) => {
            try {
              handleQortalDeepLink(url);
            } catch {
              /* ignore malformed link */
            }
          })
          .catch(() => {});
      };

      App.getLaunchUrl()
        .then((res) => routeDeepLink(res?.url))
        .catch(() => {});

      App.addListener('appUrlOpen', (event) => {
        routeDeepLink(event?.url);
      });

      App.addListener('backButton', () => {
        const ev = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
        const notPrevented = window.dispatchEvent(ev);
        if (notPrevented) {
          App.minimizeApp().catch(() => {
            // minimizeApp is Android-only; ignore elsewhere.
          });
        }
      });

      // Resume repaint: soft layout nudge only. Native onResume owns the
      // heavier wake; repeating body display toggles here caused unlock flicker.
      void Promise.resolve(
        App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) scheduleWebViewReflow();
          reportNativeAppState(isActive);
        })
      )
        .then(() => {
          appStateChangeAvailable = true;
        })
        .catch(() => {});

      // Seed the page visibility override; until this (or the first
      // appStateChange) lands, page code sees Chromium's own value.
      queryNativeAppState = () => App.getState();
      reconcileNativeAppState();
    })
    .catch(() => {});

  // Backstop for WebViews that don't reliably deliver appStateChange.
  document.addEventListener('visibilitychange', () => {
    const visible = document.visibilityState === 'visible';
    if (visible) scheduleWebViewReflow();
    reportAppLifecycle(visible ? 'foreground' : 'background', 'visibility');
  });
}

export type AppLifecycleState = 'foreground' | 'background';

// Capacitor's appStateChange is the source of truth for foreground/background.
// The page's visibility is only a fallback for when the App plugin is missing:
// on native it is not reliable (the page may be kept 'visible' while GO is in
// the background).
let appStateChangeAvailable = false;
let appLifecycleState: AppLifecycleState | null =
  typeof document !== 'undefined' && document.visibilityState === 'hidden'
    ? 'background'
    : 'foreground';
const appLifecycleListeners = new Set<(state: AppLifecycleState) => void>();

/**
 * Record an app foreground/background edge. Repeats of the current state are
 * dropped, so appStateChange and visibilitychange for the same transition
 * reach listeners once. Exported for tests.
 */
export function reportAppLifecycle(
  state: AppLifecycleState,
  source: 'app' | 'visibility'
): void {
  if (source === 'app') appStateChangeAvailable = true;
  else if (appStateChangeAvailable) return;
  if (state === appLifecycleState) return;
  appLifecycleState = state;
  for (const listener of [...appLifecycleListeners]) {
    try {
      listener(state);
    } catch (err) {
      console.warn('[Lifecycle] listener failed', err);
    }
  }
}

// ── Page visibility for app code (native only) ─────────────────────────────
// Native keep-alive holds the WebView visible to Chromium while GO is off
// screen, so the chat engine is not frozen after 60 s. App code must still
// see 'hidden' then (tray alerts, read marking, presence 'away', pollers), so
// document.visibilityState / hidden / hasFocus() follow appStateChange once
// it is known, and Chromium's own value before that. Chromium's
// visibilitychange events that do not change what app code sees (hidden,
// then visible again 500 ms later when keep-alive starts) are dropped;
// changes that come from appStateChange are dispatched as a synthetic
// visibilitychange. Chromium's internal visibility is unaffected.

// null until appStateChange or App.getState() has answered.
let nativeAppActive: boolean | null = null;
let nativeAppStateSeq = 0;
let queryNativeAppState: (() => Promise<{ isActive: boolean }>) | null = null;
let nativeAppStateQueryInFlight = false;
let visibilityOverrideInstalled = false;
let realVisibilityState: (() => string) | null = null;
let lastEffectiveHidden = false;
let dispatchingSyntheticVisibility = false;

function findPropertyDescriptor(
  target: object,
  name: string
): PropertyDescriptor | undefined {
  for (let o: object | null = target; o; o = Object.getPrototypeOf(o)) {
    const descriptor = Object.getOwnPropertyDescriptor(o, name);
    if (descriptor) return descriptor;
  }
  return undefined;
}

function readRealVisibilityState(): string {
  try {
    return realVisibilityState ? realVisibilityState() : 'visible';
  } catch {
    return 'visible';
  }
}

/**
 * Chromium's own visibility, ignoring the override. True only when the page
 * really is hidden (and so about to be frozen); false while native keep-alive
 * holds it visible in the background. For network upkeep that must keep
 * running as long as the engine does; UI and pollers use document.hidden.
 */
export function isPageReallyHidden(): boolean {
  if (typeof document === 'undefined') return false;
  if (!visibilityOverrideInstalled) return document.hidden;
  return readRealVisibilityState() === 'hidden';
}

/** What app code sees: hidden while Android says GO is not on screen. */
function isPageEffectivelyHidden(): boolean {
  if (nativeAppActive === false) return true;
  return readRealVisibilityState() === 'hidden';
}

/**
 * Override document.visibilityState / hidden / hasFocus() for app code.
 * Native only (installCapacitorBridge); exported for tests.
 */
export function installPageVisibilityOverride(): void {
  if (visibilityOverrideInstalled || typeof document === 'undefined') return;
  const stateGetter = findPropertyDescriptor(document, 'visibilityState')?.get;
  if (typeof stateGetter !== 'function') return;
  const nativeHasFocus =
    typeof document.hasFocus === 'function' ? document.hasFocus : null;
  realVisibilityState = () => String(stateGetter.call(document));
  try {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () =>
        isPageEffectivelyHidden() ? 'hidden' : readRealVisibilityState(),
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => isPageEffectivelyHidden(),
    });
    if (nativeHasFocus) {
      // Window focus can outlive the Activity; never report focus while GO
      // is off screen (read marking and "hub is being viewed" rely on it).
      Object.defineProperty(document, 'hasFocus', {
        configurable: true,
        writable: true,
        value: function hasFocus(): boolean {
          if (nativeAppActive === false) return false;
          return nativeHasFocus.call(document);
        },
      });
    }
  } catch (err) {
    // All or nothing: a half-installed override would disagree with itself.
    for (const name of ['visibilityState', 'hidden', 'hasFocus']) {
      try {
        delete (document as unknown as Record<string, unknown>)[name];
      } catch {
        /* ignore */
      }
    }
    realVisibilityState = null;
    console.warn('[Lifecycle] page visibility override unavailable', err);
    return;
  }
  visibilityOverrideInstalled = true;
  lastEffectiveHidden = isPageEffectivelyHidden();
  // Window capture runs before every document listener; installed first
  // (main.tsx), it also runs before any other window capture listener.
  window.addEventListener('visibilitychange', filterChromiumVisibility, true);
  // While keep-alive holds the page visible, Chromium fires no
  // visibilitychange when the user comes back, so a lost resume event
  // would leave app code 'hidden' for good. Window focus (every return to
  // GO) and a touch are proof enough to re-ask Android.
  window.addEventListener('focus', reconcileIfOffScreen, true);
  window.addEventListener('pointerdown', reconcileIfOffScreen, true);
}

function reconcileIfOffScreen(): void {
  if (nativeAppActive === false) reconcileNativeAppState();
}

function filterChromiumVisibility(event: Event): void {
  if (dispatchingSyntheticVisibility) return;
  const hidden = isPageEffectivelyHidden();
  if (hidden === lastEffectiveHidden) {
    event.stopImmediatePropagation();
  } else {
    lastEffectiveHidden = hidden;
  }
  // Chromium disagreeing with Android is expected while keep-alive holds the
  // page visible, but a lost resume event looks the same: re-ask Android.
  const realVisible = readRealVisibilityState() !== 'hidden';
  if (nativeAppActive !== null && realVisible !== nativeAppActive) {
    reconcileNativeAppState();
  }
}

function syncEffectiveVisibility(): void {
  if (!visibilityOverrideInstalled) return;
  const hidden = isPageEffectivelyHidden();
  if (hidden === lastEffectiveHidden) return;
  lastEffectiveHidden = hidden;
  dispatchingSyntheticVisibility = true;
  try {
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  } finally {
    dispatchingSyntheticVisibility = false;
  }
}

/**
 * Android's answer to "is GO on screen" (appStateChange / App.getState()).
 * Drives the lifecycle emitter and the page visibility app code sees.
 * Exported for tests.
 */
export function reportNativeAppState(isActive: boolean): void {
  nativeAppStateSeq += 1;
  nativeAppActive = isActive;
  reportAppLifecycle(isActive ? 'foreground' : 'background', 'app');
  syncEffectiveVisibility();
}

/** Ask Android for the current state; an event that lands first wins. */
function reconcileNativeAppState(): void {
  if (!queryNativeAppState || nativeAppStateQueryInFlight) return;
  const seq = nativeAppStateSeq;
  nativeAppStateQueryInFlight = true;
  void Promise.resolve()
    .then(() => queryNativeAppState?.())
    .then((result) => {
      if (seq !== nativeAppStateSeq) return;
      if (typeof result?.isActive !== 'boolean') return;
      if (result.isActive === nativeAppActive) return;
      reportNativeAppState(result.isActive);
    })
    .catch(() => {})
    .finally(() => {
      nativeAppStateQueryInFlight = false;
    });
}

/** Test hook: point the override at a fake App.getState(). */
export function setNativeAppStateQueryForTests(
  query: (() => Promise<{ isActive: boolean }>) | null
): void {
  queryNativeAppState = query;
}

/** Test hook: restore the real document properties. */
export function uninstallPageVisibilityOverrideForTests(): void {
  if (!visibilityOverrideInstalled) return;
  window.removeEventListener(
    'visibilitychange',
    filterChromiumVisibility,
    true
  );
  window.removeEventListener('focus', reconcileIfOffScreen, true);
  window.removeEventListener('pointerdown', reconcileIfOffScreen, true);
  for (const name of ['visibilityState', 'hidden', 'hasFocus']) {
    delete (document as unknown as Record<string, unknown>)[name];
  }
  visibilityOverrideInstalled = false;
  realVisibilityState = null;
}

/**
 * The current app state, the one edges are measured against. A newly started
 * chat engine is told this once, since it only hears edges afterwards.
 */
export function getAppLifecycleState(): AppLifecycleState {
  return appLifecycleState ?? 'foreground';
}

/** Foreground/background edges of the app (deduplicated). */
export function subscribeAppLifecycle(
  listener: (state: AppLifecycleState) => void
): () => void {
  appLifecycleListeners.add(listener);
  return () => {
    appLifecycleListeners.delete(listener);
  };
}

// Device network as the native radio probe reports it; `null` until known.
let deviceNetworkOnline: boolean | null = null;
let deviceNetworkWatcherBound = false;
const deviceNetworkRegainedListeners = new Set<() => void>();

/**
 * Record the device network state. Listeners hear only an offline -> online
 * edge; the first report just sets the baseline. Exported for tests.
 */
export function reportDeviceNetwork(online: boolean): void {
  const regained = deviceNetworkOnline === false && online;
  deviceNetworkOnline = online;
  if (!regained) return;
  for (const listener of [...deviceNetworkRegainedListeners]) {
    try {
      listener();
    } catch (err) {
      console.warn('[Network] listener failed', err);
    }
  }
}

function bindDeviceNetworkWatcher(): void {
  if (deviceNetworkWatcherBound || !isCapacitor()) return;
  deviceNetworkWatcherBound = true;
  void import('../plugins/QortalBackground')
    .then(({ QortalBackground }) => {
      void QortalBackground.getDeviceNetwork()
        .then((result) => {
          // An event may have landed first; it is newer.
          if (deviceNetworkOnline === null) {
            deviceNetworkOnline = result?.online !== false;
          }
        })
        .catch(() => {});
      void Promise.resolve(
        QortalBackground.addListener('deviceNetwork', (event) => {
          reportDeviceNetwork(event?.online !== false);
        })
      ).catch(() => {});
    })
    .catch(() => {});
}

/** Called when the device network comes back after being offline. */
export function subscribeDeviceNetworkRegained(
  listener: () => void
): () => void {
  bindDeviceNetworkWatcher();
  deviceNetworkRegainedListeners.add(listener);
  return () => {
    deviceNetworkRegainedListeners.delete(listener);
  };
}

// ── Background sync: relay profile and own outbox (native) ────────────────
// The native keep-alive controller (QortalBackground) decides the relay
// profile: 'full' while charging on an unmetered network, 'leaf' otherwise.
// The engine switches group-control relaying and Python its neighbour caps.
// Older native builds lack these methods; the calls then fail quietly and
// the phone stays a leaf.

let relayProfile: RelayProfile = 'leaf';
let relayProfileSeq = 0;
let backgroundSyncWatcherBound = false;
const relayProfileListeners = new Set<(profile: RelayProfile) => void>();
let pushOverlayProfileRef: ((profile: RelayProfile) => void) | null = null;

export const getRelayProfile = (): RelayProfile => relayProfile;

/** Test hook: stand in for the bridge's configure_overlay_profile push. */
export function setOverlayProfilePushForTests(
  push: ((profile: RelayProfile) => void) | null
): void {
  pushOverlayProfileRef = push;
}

/**
 * Record the native relay profile; listeners hear changes only. Returns
 * whether it changed.
 */
export function reportRelayProfile(profile: unknown): boolean {
  relayProfileSeq += 1;
  const next: RelayProfile = profile === 'full' ? 'full' : 'leaf';
  if (next === relayProfile) return false;
  relayProfile = next;
  pushOverlayProfileRef?.(next);
  for (const listener of [...relayProfileListeners]) {
    try {
      listener(next);
    } catch (err) {
      console.warn('[BackgroundSync] relay profile listener failed', err);
    }
  }
  return true;
}

function bindBackgroundSyncWatcher(): void {
  if (backgroundSyncWatcherBound || !isCapacitor()) return;
  backgroundSyncWatcherBound = true;
  void import('../plugins/QortalBackground')
    .then(({ QortalBackground }) => {
      // Events fired while the page was frozen may be lost; re-read the
      // native state at start and on every return to the foreground.
      const refresh = (initial: boolean): void => {
        const seq = relayProfileSeq;
        void Promise.resolve()
          .then(() => QortalBackground.getBackgroundSyncState())
          .then((state) => {
            const changed =
              seq === relayProfileSeq &&
              reportRelayProfile(state?.relayProfile);
            // Python and the service outlive the page: a new page starts
            // as a leaf while Python may still hold 'full' caps from the
            // last one, so tell it once even when nothing changed here.
            if (initial && !changed) pushOverlayProfileRef?.(relayProfile);
          })
          .catch(() => {});
      };
      refresh(true);
      subscribeAppLifecycle((state) => {
        if (state === 'foreground') refresh(false);
      });
      void Promise.resolve(
        QortalBackground.addListener('relayProfileChanged', (event) => {
          reportRelayProfile(event?.profile);
        })
      ).catch(() => {});
    })
    .catch(() => {});
}

/** Relay profile changes ('full' while charging on an unmetered network). */
export function subscribeRelayProfile(
  listener: (profile: RelayProfile) => void
): () => void {
  bindBackgroundSyncWatcher();
  relayProfileListeners.add(listener);
  return () => {
    relayProfileListeners.delete(listener);
  };
}

let ownOutboxPendingReported: boolean | null = null;
let ownOutboxChain: Promise<void> = Promise.resolve();

/**
 * Tell the native keep-alive whether own messages still wait to leave the
 * phone (it keeps the page awake up to 3 min after GO leaves the screen).
 * Changes only, in order. Native only; exported for tests.
 */
export function reportOwnOutboxPending(pending: boolean): void {
  if (!isCapacitor()) return;
  if (pending === ownOutboxPendingReported) return;
  ownOutboxPendingReported = pending;
  ownOutboxChain = ownOutboxChain
    .then(() => import('../plugins/QortalBackground'))
    .then(({ QortalBackground }) =>
      QortalBackground.setOutboxPending({ pending })
    )
    .then(() => undefined)
    .catch((err) => {
      console.warn('[BackgroundSync] setOutboxPending failed', err);
    });
}

/**
 * Logout: ask the native side to close the hub sockets. The native default
 * delay (5 s) lets the offline presence notice sent just before leave first;
 * the next login's status service start redials. Native only, best effort.
 */
export function pauseReticulumNetworkForLogout(): void {
  if (!isCapacitor()) return;
  if (typeof Reticulum.presencePauseNetwork !== 'function') return;
  try {
    // An older native build rejects the unknown method; that is harmless.
    void Promise.resolve(
      Reticulum.presencePauseNetwork({ reason: 'logout' })
    ).catch((err) => {
      console.warn('[Presence] network pause failed', err);
    });
  } catch (err) {
    console.warn('[Presence] network pause failed', err);
  }
}

/**
 * `window.open` of a `blob:` / `data:` URL does not open a new window in the
 * Capacitor WebView: it navigates the app itself to the raw bytes, leaving the
 * user on a bare page with no close, no share and a dead back button. Route
 * those to the in-app file viewer instead; everything else is untouched.
 */
function guardBlobWindowOpen(): void {
  const nativeOpen = window.open.bind(window);
  window.open = ((
    url?: string | URL,
    target?: string,
    features?: string
  ): Window | null => {
    const href = url == null ? '' : String(url).trim();
    if (/^(blob|data):/i.test(href)) {
      void import('../utils/fileViewerEvents')
        .then(({ openFileViewer }) => openFileViewer({ url: href }))
        .catch(() => {});
      return null;
    }
    return nativeOpen(url, target, features);
  }) as typeof window.open;
}

const WEBVIEW_REFLOW_DEBOUNCE_MS = 400;
let lastWebViewReflowAt = 0;
let webViewReflowFollowUpTimer: number | null = null;

/** Debounced soft reflow — coalesces appStateChange + visibilitychange. */
function scheduleWebViewReflow(): void {
  const now = Date.now();
  if (now - lastWebViewReflowAt < WEBVIEW_REFLOW_DEBOUNCE_MS) return;
  lastWebViewReflowAt = now;
  forceWebViewReflow();
  if (webViewReflowFollowUpTimer != null) {
    window.clearTimeout(webViewReflowFollowUpTimer);
  }
  // One quiet follow-up if the OEM window lands a beat late.
  webViewReflowFollowUpTimer = window.setTimeout(() => {
    webViewReflowFollowUpTimer = null;
    forceWebViewReflow();
  }, 250);
}

/**
 * Soft layout/repaint pass after resume. Avoid display:none — hiding the whole
 * document for a reflow read visibly glitches for as long as wake handlers fire.
 */
function forceWebViewReflow(): void {
  try {
    void document.documentElement.offsetHeight;
  } catch {
    /* best-effort */
  }
}

let reticulumBridgesInstalled = false;

/**
 * Master switch for the native (Chaquopy) presence bridge. When false,
 * `window.presence` is never installed and the embedded Python/RNS transport is
 * never touched (the app behaves like the plain web build).
 */
const PRESENCE_BRIDGE_ENABLED = true;

/** Online entries expire if not refreshed within this window (heartbeats ~25 s). */
const PRESENCE_TTL_MS = 90_000;
/**
 * Keep same-account device hashes for DM routing after the online dot
 * expires, and across an app relaunch, so the engine can pull from our own
 * Hub before its next presence heartbeat arrives. Bounded to an hour: a
 * longer window feeds the engine stale hashes as "verified" DM peers.
 */
const CHAT_ENDPOINT_TTL_MS = 60 * 60 * 1000;
const ACCOUNT_ENDPOINTS_STORAGE_KEY = 'qortal.go.account-endpoints.v1';
/** Cap on fan-out neighbours we advertise to the bridge (matches OVERLAY_MAX). */
const MAX_NEIGHBORS = 24;
/** 16-byte Reticulum destination hash, hex. */
const DEST_HASH_RE = /^[0-9a-f]{32}$/;
/** A peer counts as "receiving" while we saw traffic from it this recently. */
const RECEIVING_PEER_TTL_MS = 90_000;

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;
const asObject = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
const asUserStatus = (v: unknown): UserStatus | null =>
  v === 'online' || v === 'busy' || v === 'idle' ? v : null;

/**
 * Reticulum overlay health snapshot for the mobile shell.
 *
 * The desktop renderer reads `window.electronAPI.reticulumGetStatus()` to drive
 * the core P2P-health indicator (which also gates the voice-call button). On
 * mobile `window.electronAPI` is intentionally absent (defining it would flip
 * the app into HUB_ELECTRON mode), so we publish the same shape here and let
 * CoreSyncStatus consume it via getMobileReticulumStatus()/onMobileReticulumStatus().
 */
export type MobileReticulumStatus = {
  onlineRemoteHubInterfaces: number;
  p2pActiveOverlayPeers: number;
  /** Peers we have actually received overlay traffic from recently. */
  p2pReceivingOverlayPeers: number;
  /** How long that set has been continuously non-empty. */
  p2pReceivingOverlayPeersStableMs: number;
  bridgeState: 'starting' | 'ready' | 'failed';
  /**
   * Why the Python presence bridge is not running, when it is not. Until this
   * existed a bridge that failed to boot (Chaquopy could not load a native
   * module, the host thread died, …) only left a line in logcat while the
   * badge kept saying "starting"; every chat send then failed with unrelated
   * looking errors. Shown in the Reticulum badge so a field report carries
   * the real cause.
   */
  bridgeError: string | null;
};

let mobileReticulumStatus: MobileReticulumStatus | null = null;
const mobileReticulumStatusCbs = new Set<(s: MobileReticulumStatus) => void>();

export const getMobileReticulumStatus = (): MobileReticulumStatus | null =>
  mobileReticulumStatus;

export const onMobileReticulumStatus = (
  cb: (s: MobileReticulumStatus) => void
): (() => void) => {
  mobileReticulumStatusCbs.add(cb);
  if (mobileReticulumStatus) {
    try {
      cb(mobileReticulumStatus);
    } catch {
      /* ignore */
    }
  }
  return () => mobileReticulumStatusCbs.delete(cb);
};

/**
 * Turns a bridge boot failure into the text shown in the Reticulum badge.
 *
 * The Python bridge is an embedded CPython whose extension modules (`_ssl`,
 * `cryptography`'s `_rust.so`, cffi, …) Chaquopy extracts into the app's data
 * directory and `dlopen`s at import time. Hardened Android builds can forbid
 * exactly that ("dynamic code loading from storage" on GrapheneOS), and the
 * loader error is the only trace of it. Recognise those errors so the message
 * points at the setting instead of leaving the user with a dead chat.
 */
const describePresenceBridgeFailure = (raw: unknown): string => {
  const text =
    raw instanceof Error
      ? raw.message
      : typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object' && 'message' in raw
          ? String((raw as { message?: unknown }).message ?? '')
          : String(raw ?? '');
  const compact = text.replace(/\s+/g, ' ').trim().slice(0, 400);
  const nativeLoadFailure =
    /dlopen|cannot locate symbol|library ".*" not found|Permission denied|EACCES|ImportError|No module named|_rust|_cffi_backend|_ssl|chaquopy/i.test(
      compact
    );
  const base = compact
    ? `Reticulum bridge failed to start: ${compact}`
    : 'Reticulum bridge failed to start';
  return nativeLoadFailure
    ? `${base} — the app could not load its bundled Python/crypto libraries. On GrapheneOS open App info → Exploit protection for Qortal GO and allow "Dynamic code loading" (memory and storage), then restart the app.`
    : base;
};

const publishMobileReticulumStatus = (next: MobileReticulumStatus): void => {
  const prev = mobileReticulumStatus;
  // Stability is a continuously rising number, so compare the threshold
  // crossing instead — that is the only part of it health depends on.
  const settled = (s: MobileReticulumStatus) =>
    s.p2pReceivingOverlayPeersStableMs >= P2P_HEALTH_RECEIVING_STABLE_MS;
  if (
    prev &&
    prev.onlineRemoteHubInterfaces === next.onlineRemoteHubInterfaces &&
    prev.p2pActiveOverlayPeers === next.p2pActiveOverlayPeers &&
    prev.p2pReceivingOverlayPeers === next.p2pReceivingOverlayPeers &&
    settled(prev) === settled(next) &&
    prev.bridgeState === next.bridgeState &&
    prev.bridgeError === next.bridgeError
  ) {
    return;
  }
  mobileReticulumStatus = next;
  mobileReticulumStatusCbs.forEach((cb) => {
    try {
      cb(next);
    } catch {
      /* ignore */
    }
  });
};

/**
 * Local Reticulum identity exposed to the DM voice media helpers.
 *
 * The desktop reads `window.electronAPI.reticulumGet{LocalDestinationHash,
 * LocalIdentityPublicKeyBase64}`. Mobile keeps `electronAPI` undefined (defining
 * it flips HUB_ELECTRON), so we stash the bridge-reported values on a global the
 * patched `directVoiceReticulumMedia` fetchers fall back to.
 */
type MobileReticulumInfo = {
  destinationHash: string | null;
  identityPublicKeyBase64: string | null;
};

declare global {
  interface Window {
    __qortalMobileReticulum?: MobileReticulumInfo;
  }
}

const getMobileReticulumInfo = (): MobileReticulumInfo => {
  if (!window.__qortalMobileReticulum) {
    window.__qortalMobileReticulum = {
      destinationHash: null,
      identityPublicKeyBase64: null,
    };
  }
  return window.__qortalMobileReticulum;
};

/**
 * Polls the bridge-reported local Reticulum identity (set on the `ready`
 * frame). Mirrors the desktop preload's reticulumGetLocal* retry semantics so
 * the Q-Chat file transfer accept flow works the same on mobile.
 */
export const fetchMobileReticulumIdentity = async (): Promise<{
  destinationHash: string | null;
  identityPublicKeyBase64: string | null;
}> => {
  const immediate = getMobileReticulumInfo();
  if (immediate.destinationHash && immediate.identityPublicKeyBase64) {
    return { ...immediate };
  }
  // The local identity is only populated when the Python bridge emits its
  // `ready` frame. A file send can be attempted before presence has booted the
  // bridge (the first announce is deferred ~2s after login, and may never run
  // if the user appears offline), so kick the bridge here instead of failing
  // with "Reticulum identity is unavailable". ensureBridgeStarted itself waits
  // for `ready`, after which the identity is set.
  if (ensureBridgeStartedRef) {
    try {
      await ensureBridgeStartedRef();
    } catch {
      /* fall through to polling below */
    }
  }
  const maxAttempts = 50; // ~10s of additional polling after the ready gate
  const delayMs = 200;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const info = getMobileReticulumInfo();
    if (info.destinationHash && info.identityPublicKeyBase64) {
      return { ...info };
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return { ...getMobileReticulumInfo() };
};

// ── Bridge command/response correlation ─────────────────────────────────────
// presence_bridge.py answers every cmd with a `{type:"resp", id, ok, ...}`
// frame. The desktop daemon correlates these in its stdio pump; on mobile the
// frames arrive through the same `presence` listener as events, so we keep a
// pending-promise map keyed by the command id we pass to the native plugin.

let ensureBridgeStartedRef: (() => Promise<void>) | null = null;
let waitForBridgeReadyRef: ((timeoutMs: number) => Promise<void>) | null =
  null;

/**
 * Frame taps for the mobile Reticulum chat engine: every python event frame
 * (chat messages, resource sessions, ready, …) is fanned out so the engine
 * worker sees the same event stream the desktop daemon's stdio pump provides.
 */
type PythonEventTap = (frame: Record<string, unknown>) => void;
const pythonEventTaps = new Set<PythonEventTap>();

export const registerPythonEventTap = (tap: PythonEventTap): (() => void) => {
  pythonEventTaps.add(tap);
  return () => {
    pythonEventTaps.delete(tap);
  };
};

export const ensureReticulumBridgeStarted = (): Promise<void> => {
  if (!ensureBridgeStartedRef) {
    return Promise.reject(new Error('Reticulum bridge is not installed'));
  }
  return ensureBridgeStartedRef();
};

/** Presence snapshot for the chat engine (peers / leases / overlay health). */
export type ReticulumChatPresenceSnapshot = {
  peers: Array<{ destinationHash: string; lastSeen: number }>;
  leases: Array<{
    destinationHash: string;
    address: string;
    sessionId: string;
    lastSeen: number;
    expiresAt: number;
    verification: string;
  }>;
  healthy: boolean;
};

let reticulumChatPresenceSnapshotRef:
  | (() => ReticulumChatPresenceSnapshot)
  | null = null;

export const getReticulumChatPresenceSnapshot =
  (): ReticulumChatPresenceSnapshot => {
    if (reticulumChatPresenceSnapshotRef) {
      return reticulumChatPresenceSnapshotRef();
    }
    return { peers: [], leases: [], healthy: false };
  };

const pendingCommandResps = new Map<
  string,
  (frame: Record<string, unknown>) => void
>();

const resolveCommandResp = (frame: Record<string, unknown>): void => {
  const id = typeof frame.id === 'string' ? frame.id : undefined;
  if (!id) return;
  const resolve = pendingCommandResps.get(id);
  if (resolve) resolve(frame);
};

const communityIceServers: { urls: string }[] = [];

const iceUrlFromEndpoint = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const endpoint = value as { host?: unknown; port?: unknown; expiresAt?: unknown };
  const host = typeof endpoint.host === 'string' ? endpoint.host.trim() : '';
  const port = Number(endpoint.port);
  if (!host || !Number.isFinite(port) || port < 1 || port > 65535) return '';
  if (
    typeof endpoint.expiresAt === 'number' &&
    endpoint.expiresAt > 0 &&
    endpoint.expiresAt <= Date.now()
  ) {
    return '';
  }
  return `stun:${host}:${port}`;
};

const rememberCommunityIceServers = (endpoints: unknown): { urls: string }[] => {
  if (!Array.isArray(endpoints)) return communityIceServers;
  const next: { urls: string }[] = [];
  const seen = new Set<string>();
  for (const endpoint of endpoints) {
    const url = iceUrlFromEndpoint(endpoint);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    next.push({ urls: url });
  }
  if (next.length > 0) {
    communityIceServers.splice(0, communityIceServers.length, ...next);
  }
  return communityIceServers;
};

/**
 * Sends a presence-bridge command and resolves with the bridge's resp frame
 * (`{ok: boolean, error?, reason?, ...}`). Used by flows that need the result
 * (Q-Chat file transfer), unlike the fire-and-forget presence/call paths.
 */
export const presenceCommandWithResult = async (
  action: string,
  payload: Record<string, unknown>,
  timeoutMs = 20_000
): Promise<Record<string, unknown>> => {
  if (!ensureBridgeStartedRef) {
    throw new Error('Reticulum bridge is not installed');
  }
  // Kick start, but only wait until the Python `ready` event. Awaiting the
  // full ensureBridgeStarted() promise deadlocks if that function itself
  // calls presenceCommandWithResult.
  void ensureBridgeStartedRef();
  if (waitForBridgeReadyRef) {
    await waitForBridgeReadyRef(Math.min(Math.max(timeoutMs, 1_000), 30_000));
  } else {
    await ensureBridgeStartedRef();
  }
  const id = `cmd-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const result = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingCommandResps.delete(id);
      reject(new Error(`Reticulum command timed out: ${action}`));
    }, timeoutMs);
    pendingCommandResps.set(id, (frame) => {
      window.clearTimeout(timer);
      pendingCommandResps.delete(id);
      resolve(frame);
    });
  });
  try {
    await Reticulum.presenceCommand({ action, payload, id });
  } catch (err) {
    const resolve = pendingCommandResps.get(id);
    if (resolve) pendingCommandResps.delete(id);
    throw err;
  }
  return result;
};

// ── Q-Chat Reticulum file transfer (mobile) ─────────────────────────────────
// Mobile port of the desktop main-process logic in reticulum-daemon.ts:
//   • sender: register pending sends with the bridge, persist them across app
//     restarts, and answer inbound QCHAT_FILE_LINK_AUTH packets (verify the
//     downloader's signed auth, then authorize/reject the RNS link).
//   • receiver: forward accept commands. Completed files stay in GO's
//     private storage (N-22, N-27): the chat opens them in GO's viewer and
//     "Save to device" exports one (src/utils/receivedChatFiles.ts).
// All transfer bytes move inside the Python bridge as RNS Resources; this
// layer only drives the control protocol.

type QchatPendingSendRecord = {
  transferId: string;
  senderAddress: string;
  allowedRecipientAddress: string;
  filePath: string;
  fileName: string;
  size: number;
  sha256: string;
  createdAt: number;
  expiresAt: number;
};

const QCHAT_PENDING_SENDS_STORAGE_KEY = 'qortal-mobile-qchat-pending-sends';
const QCHAT_FILE_OFFER_TTL_MS = 2 * 60 * 60 * 1000;
const QCHAT_COMPLETED_GRACE_MS = 10 * 60 * 1000;

const qchatPendingSends = new Map<string, QchatPendingSendRecord>();
const qchatCompletedSends = new Map<string, number>();
const qchatFileEventCbs = new Set<(payload: Record<string, unknown>) => void>();
let qchatPendingSendsLoaded = false;
let qchatPendingSendsHydrated = false;

const loadQchatPendingSends = (): void => {
  if (qchatPendingSendsLoaded) return;
  qchatPendingSendsLoaded = true;
  try {
    const raw = localStorage.getItem(QCHAT_PENDING_SENDS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const now = Date.now();
    for (const item of parsed) {
      const rec = asObject(item);
      if (!rec) continue;
      const transferId = asString(rec.transferId);
      const expiresAt = Number(rec.expiresAt || 0);
      if (!transferId || expiresAt <= now) continue;
      qchatPendingSends.set(transferId, {
        transferId,
        senderAddress: asString(rec.senderAddress) ?? '',
        allowedRecipientAddress: asString(rec.allowedRecipientAddress) ?? '',
        filePath: asString(rec.filePath) ?? '',
        fileName: asString(rec.fileName) ?? '',
        size: Number(rec.size || 0),
        sha256: asString(rec.sha256) ?? '',
        createdAt: Number(rec.createdAt || now),
        expiresAt,
      });
    }
  } catch {
    /* corrupted store; start fresh */
  }
};

const persistQchatPendingSends = (): void => {
  const now = Date.now();
  for (const [transferId, rec] of [...qchatPendingSends]) {
    if (rec.expiresAt <= now) qchatPendingSends.delete(transferId);
  }
  try {
    localStorage.setItem(
      QCHAT_PENDING_SENDS_STORAGE_KEY,
      JSON.stringify([...qchatPendingSends.values()])
    );
  } catch {
    /* storage full; pending sends survive only in memory */
  }
};

const markQchatSendCompleted = (transferId: string): void => {
  const now = Date.now();
  for (const [id, exp] of [...qchatCompletedSends]) {
    if (exp <= now) qchatCompletedSends.delete(id);
  }
  qchatCompletedSends.set(transferId, now + QCHAT_COMPLETED_GRACE_MS);
  if (qchatPendingSends.delete(transferId)) persistQchatPendingSends();
};

const emitQchatFileEvent = (payload: Record<string, unknown>): void => {
  qchatFileEventCbs.forEach((cb) => {
    try {
      cb(payload);
    } catch {
      /* ignore */
    }
  });
};

/** Subscribe to Q-Chat file transfer events (mobile onQchatFileTransferEvent). */
export const onMobileQchatFileTransferEvent = (
  cb: (payload: Record<string, unknown>) => void
): (() => void) => {
  qchatFileEventCbs.add(cb);
  return () => {
    qchatFileEventCbs.delete(cb);
  };
};

/**
 * Look up an outgoing (sender-side) pending share by transferId. Used by the
 * transfer notification layer to detect direction and show time remaining.
 */
export const getQchatPendingSendInfo = (
  transferId: string
): { fileName: string; size: number; expiresAt: number } | null => {
  loadQchatPendingSends();
  const rec = qchatPendingSends.get(transferId);
  if (!rec) return null;
  return { fileName: rec.fileName, size: rec.size, expiresAt: rec.expiresAt };
};

const rejectQchatFileAuth = (
  linkId: string,
  transferId: string,
  reason: string
): void => {
  console.error('[QchatFile] auth rejected:', reason, transferId);
  emitQchatFileEvent({ status: 'failed', transferId, reason });
  void presenceCommandWithResult('reject_qchat_file_resource', {
    linkId,
    transferId,
    reason,
  }).catch((err) => console.error('[QchatFile] reject failed:', err));
};

const handleQchatFileAuth = async (
  payload: Record<string, unknown>
): Promise<void> => {
  const transferId = String(payload.transferId || '').trim();
  const linkId = String(payload.linkId || '');
  const auth = asObject(payload.auth);
  if (!transferId || !linkId || !auth) return;
  loadQchatPendingSends();
  const pending = qchatPendingSends.get(transferId);
  if (!pending) {
    if (qchatCompletedSends.has(transferId)) {
      console.log('[QchatFile] duplicate auth for completed transfer', transferId);
      return;
    }
    rejectQchatFileAuth(linkId, transferId, 'no_pending_transfer');
    return;
  }
  if (pending.expiresAt <= Date.now()) {
    qchatPendingSends.delete(transferId);
    persistQchatPendingSends();
    rejectQchatFileAuth(linkId, transferId, 'transfer_expired');
    return;
  }
  try {
    const stat = await Reticulum.qchatFileStat({ path: pending.filePath });
    if (!stat.exists) {
      qchatPendingSends.delete(transferId);
      persistQchatPendingSends();
      rejectQchatFileAuth(linkId, transferId, 'file_missing');
      return;
    }
  } catch {
    /* stat unavailable; let the bridge surface a send failure if needed */
  }
  const failure = verifyQchatFileLinkAuth(auth, pending);
  if (failure) {
    rejectQchatFileAuth(linkId, transferId, failure);
    return;
  }
  try {
    const res = await presenceCommandWithResult(
      'authorize_qchat_file_resource',
      { linkId, transferId }
    );
    if (res.ok !== true) {
      console.error(
        '[QchatFile] authorize failed:',
        res.error || res.reason || 'unknown'
      );
    }
  } catch (err) {
    console.error('[QchatFile] authorize failed:', err);
  }
};

/**
 * A peer picks the name of every file it sends. The chat and the transfer
 * notifications get it cleaned: no bidi or other invisible characters, so
 * "holiday[RLO]gpj.apk" cannot read as "holidaykpa.jpg" (N-27).
 */
export const withCleanQchatFileName = (
  payload: Record<string, unknown>
): Record<string, unknown> => {
  const fileName = asString(payload.fileName);
  if (fileName === undefined) return payload;
  const cleaned = cleanFileName(fileName) || 'file';
  return cleaned === fileName ? payload : { ...payload, fileName: cleaned };
};

/**
 * A `qchat_file_transfer` frame from the presence bridge. Exported for the
 * tests that check a received file is never copied anywhere.
 */
export const handleQchatFileTransferEvent = (
  payload: Record<string, unknown>
): void => {
  const status = asString(payload.status);
  if (status === 'auth') {
    void handleQchatFileAuth(payload);
    // The auth handshake is internal; the renderer only sees the outcome.
    return;
  }
  if (status === 'sent') {
    const transferId = asString(payload.transferId);
    if (transferId) markQchatSendCompleted(transferId);
  }
  // A received file stays where the transfer wrote it, in GO's private
  // storage. Nothing is copied to public Downloads (N-22, N-27).
  emitQchatFileEvent(withCleanQchatFileName(payload));
};

/**
 * Mobile implementation of the chat's "Open" action for received files. An
 * app package is refused (code PACKAGE_ARCHIVE_REFUSED) without asking native.
 */
export const mobileQchatFileOpen = async (payload: {
  uri: string;
  fileName?: string;
}): Promise<{ ok: boolean; error?: string; code?: string }> => {
  try {
    await openFileInViewerApp(payload);
    return { ok: true };
  } catch (err) {
    const code = fileOpenErrorCode(err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ...(code ? { code } : {}),
    };
  }
};

/** Re-register persisted pending sends with the (re)started bridge. */
const hydrateQchatPendingSends = (): void => {
  if (qchatPendingSendsHydrated) return;
  qchatPendingSendsHydrated = true;
  loadQchatPendingSends();
  const now = Date.now();
  for (const record of [...qchatPendingSends.values()]) {
    if (record.expiresAt <= now) {
      qchatPendingSends.delete(record.transferId);
      continue;
    }
    void (async () => {
      try {
        const stat = await Reticulum.qchatFileStat({ path: record.filePath });
        if (!stat.exists) {
          qchatPendingSends.delete(record.transferId);
          persistQchatPendingSends();
          return;
        }
        const res = await presenceCommandWithResult(
          'send_qchat_file_resource',
          {
            allowedRecipientAddress: record.allowedRecipientAddress,
            transferId: record.transferId,
            filePath: record.filePath,
            fileName: record.fileName,
            size: record.size,
            sha256: record.sha256,
            expiresAt: record.expiresAt,
          }
        );
        if (res.ok !== true) {
          console.error(
            '[QchatFile] pending send hydration failed:',
            record.transferId,
            res.error || res.reason
          );
        }
      } catch (err) {
        console.error('[QchatFile] pending send hydration failed:', err);
      }
    })();
  }
  persistQchatPendingSends();
};

/** Mobile implementation of electronAPI.qchatFileSend. */
export const mobileQchatFileSend = async (payload: {
  transferId: string;
  senderAddress?: string;
  allowedRecipientAddress?: string;
  recipientAddress?: string;
  filePath: string;
  fileName: string;
  size: number;
  sha256?: string;
  expiresAt?: number;
}): Promise<{ ok: boolean; error?: string }> => {
  try {
    const allowedRecipientAddress = String(
      payload.allowedRecipientAddress || payload.recipientAddress || ''
    ).trim();
    const senderAddress = String(payload.senderAddress || '').trim();
    const transferId = String(payload.transferId || '').trim();
    if (!allowedRecipientAddress) {
      return { ok: false, error: 'Missing allowed recipient address' };
    }
    if (!senderAddress) return { ok: false, error: 'Missing sender address' };
    if (!transferId) return { ok: false, error: 'Missing transfer id' };
    const createdAt = Date.now();
    const requestedExpiresAt = Number(payload.expiresAt || 0);
    const expiresAt =
      Number.isFinite(requestedExpiresAt) && requestedExpiresAt > createdAt
        ? requestedExpiresAt
        : createdAt + QCHAT_FILE_OFFER_TTL_MS;
    const sha256 =
      typeof payload.sha256 === 'string'
        ? payload.sha256.trim().toLowerCase()
        : '';
    const res = await presenceCommandWithResult('send_qchat_file_resource', {
      allowedRecipientAddress,
      transferId,
      filePath: payload.filePath,
      fileName: payload.fileName,
      size: Number(payload.size || 0),
      sha256,
      expiresAt,
    });
    if (res.ok !== true) {
      return {
        ok: false,
        error: String(res.error || res.reason || 'Reticulum send failed'),
      };
    }
    loadQchatPendingSends();
    qchatPendingSends.set(transferId, {
      transferId,
      senderAddress,
      allowedRecipientAddress,
      filePath: payload.filePath,
      fileName: payload.fileName,
      size: Number(payload.size || 0),
      sha256,
      createdAt,
      expiresAt,
    });
    persistQchatPendingSends();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/** Mobile implementation of electronAPI.qchatFileAccept. */
export const mobileQchatFileAccept = async (payload: {
  transferId: string;
  senderAddress?: string;
  recipientAddress?: string;
  authMessage?: Record<string, unknown>;
  savePath?: string;
  fileName: string;
  size: number;
  sha256?: string;
  senderReticulumDestinationHash?: string;
  senderReticulumIdentityPublicKeyBase64?: string;
}): Promise<{ ok: boolean; error?: string }> => {
  try {
    const peerPresenceHash = String(
      payload.senderReticulumDestinationHash || ''
    )
      .trim()
      .toLowerCase();
    const reticulumIdentityPublicKeyBase64 = String(
      payload.senderReticulumIdentityPublicKeyBase64 || ''
    ).trim();
    if (!peerPresenceHash || !DEST_HASH_RE.test(peerPresenceHash)) {
      return {
        ok: false,
        error: 'Missing or invalid sender Reticulum destination hash in offer',
      };
    }
    if (!reticulumIdentityPublicKeyBase64) {
      return { ok: false, error: 'Missing sender Reticulum public key in offer' };
    }
    if (!payload.authMessage || typeof payload.authMessage !== 'object') {
      return { ok: false, error: 'Missing Reticulum link auth message' };
    }
    const res = await presenceCommandWithResult(
      'accept_qchat_file_resource',
      {
        peerPresenceHash,
        reticulumIdentityPublicKeyBase64,
        authMessage: payload.authMessage,
        transferId: String(payload.transferId || ''),
        savePath: String(payload.savePath || ''),
        fileName: String(payload.fileName || ''),
        size: Number(payload.size || 0),
        ...(typeof payload.sha256 === 'string'
          ? { sha256: payload.sha256 }
          : {}),
      },
      30_000
    );
    if (res.ok === true) return { ok: true };
    return {
      ok: false,
      error: String(
        res.error || res.reason || 'Reticulum transfer accept failed'
      ),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

const setLocalReticulumDestinationHash = (hash: string): void => {
  getMobileReticulumInfo().destinationHash = hash;
};

const setLocalReticulumIdentity = (b64: string): void => {
  getMobileReticulumInfo().identityPublicKeyBase64 = b64;
};

/**
 * Phase 3a — presence over the native Reticulum transport.
 *
 * Wires `window.presence` to the native Chaquopy presence bridge
 * (presence_bridge.py via ReticulumPlugin) AND runs a minimal port of the
 * desktop presence overlay coordinator (electron/src/presence.ts).
 *
 * Outbound: the web layer builds + signs each PresenceEnvelope (usePresence +
 * signPresenceMessage); we forward announce/heartbeat/offline to the bridge.
 * Crucially, the bridge only fans presence out to neighbours it has been told
 * about, so we feed it the peers it discovers (`candidate_peer_discovered`,
 * inbound `presence_message`) back via `overlay_sync_state` + the
 * `overlayNeighborHashes` on each publish. Without that, fan-out is empty and
 * peers never see this account online.
 *
 * Inbound: the bridge emits a `presence_message` event for every signed
 * presence packet it receives. We aggregate those into a live session map so
 * getAllOnline()/getStatus()/onUpdate(Batch) surface who's online.
 *
 * MVP scope: we trust peers the bridge discovers rather than re-verifying each
 * Ed25519 signature in JS (the bridge already drops malformed packets; presence
 * is broadcast online-status). Full per-peer verification is a follow-up.
 *
 * window.chat / window.call / window.groupCall remain undefined (Phases 3b/3c).
 */
export function installReticulumBridges(): void {
  if (!PRESENCE_BRIDGE_ENABLED) return;
  if (reticulumBridgesInstalled) return;
  if (!isCapacitor()) return;
  reticulumBridgesInstalled = true;

  const startedCallbacks = new Set<() => void>();
  let bridgeReady = false;
  // Last fatal bridge failure (native start rejected, Python host thread
  // died). Cleared by the next `ready` frame. Surfaced through the status
  // object so the Reticulum badge can show it.
  let bridgeError: string | null = null;
  let bridgeStartPromise: Promise<void> | null = null;
  let frameListenerAttached = false;
  // Resolvers waiting for the Python bridge `ready` frame. ensureBridgeStarted
  // gates the first command (publish_presence / file send / call) on this so we
  // don't fire into a half-booted bridge and trip the command timeout.
  const bridgeReadyResolvers = new Set<() => void>();
  let firstPublishDone = false;

  // ── Overlay coordinator state (minimal mobile port of presence.ts) ──────
  const neighborHashes = new Set<string>();
  /**
   * Live presence sessions per account, keyed by session id: one per device
   * signed into that account, including this one (recorded on publish, as the
   * desktop records its `local` route). The status shown for an account is
   * the most available of its devices (busy > online > idle), like
   * `getAddressAggregate` in electron/src/presence.ts. With one entry per
   * account, an idle desktop Hub overwrote the phone the user was on.
   */
  const sessionsByAddress = new Map<string, Map<string, PresenceSession>>();
  /**
   * `sessionsByAddress` only covers the online dot. Account endpoint
   * leases must enumerate *all* live destination hashes for an address —
   * otherwise a second device signed into the same account is invisible and
   * Saved Messages cannot sync between them.
   */
  const accountEndpoints = new Map<
    string,
    Map<string, { sessionId: string; lastSeen: number }>
  >();
  const persistAccountEndpoints = (): void => {
    const now = Date.now();
    const rows: Array<{
      address: string;
      destinationHash: string;
      sessionId: string;
      lastSeen: number;
    }> = [];
    for (const [address, endpoints] of accountEndpoints) {
      for (const [hash, entry] of endpoints) {
        if (now - entry.lastSeen > CHAT_ENDPOINT_TTL_MS) continue;
        rows.push({
          address,
          destinationHash: hash,
          sessionId: entry.sessionId,
          lastSeen: entry.lastSeen,
        });
      }
    }
    try {
      localStorage.setItem(ACCOUNT_ENDPOINTS_STORAGE_KEY, JSON.stringify(rows));
    } catch {
      /* storage full; keep in-memory only */
    }
  };
  let persistAccountEndpointsTimer = 0;
  const rememberAccountEndpoint = (
    address: string,
    destinationHash: unknown,
    sessionId: string
  ): void => {
    const hash = String(destinationHash || '').toLowerCase();
    if (!address || !DEST_HASH_RE.test(hash)) return;
    let endpoints = accountEndpoints.get(address);
    if (!endpoints) {
      endpoints = new Map();
      accountEndpoints.set(address, endpoints);
    }
    endpoints.set(hash, { sessionId, lastSeen: Date.now() });
    if (!persistAccountEndpointsTimer) {
      persistAccountEndpointsTimer = window.setTimeout(() => {
        persistAccountEndpointsTimer = 0;
        persistAccountEndpoints();
      }, 10_000);
    }
  };
  try {
    const raw = localStorage.getItem(ACCOUNT_ENDPOINTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      const now = Date.now();
      for (const row of parsed) {
        if (!row || typeof row !== 'object') continue;
        const address = String(row.address || '').trim();
        const hash = String(row.destinationHash || '').toLowerCase();
        const lastSeen = Number(row.lastSeen || 0);
        if (
          !address ||
          !DEST_HASH_RE.test(hash) ||
          !Number.isFinite(lastSeen) ||
          now - lastSeen > CHAT_ENDPOINT_TTL_MS
        ) {
          continue;
        }
        let endpoints = accountEndpoints.get(address);
        if (!endpoints) {
          endpoints = new Map();
          accountEndpoints.set(address, endpoints);
        }
        endpoints.set(hash, {
          sessionId: String(row.sessionId || ''),
          lastSeen,
        });
      }
    }
  } catch {
    /* corrupted store; start empty */
  }
  const liveAccountEndpoints = (): Array<{
    address: string;
    destinationHash: string;
    sessionId: string;
    lastSeen: number;
  }> => {
    const now = Date.now();
    const localHash = (
      getMobileReticulumInfo().destinationHash || ''
    ).toLowerCase();
    const out: Array<{
      address: string;
      destinationHash: string;
      sessionId: string;
      lastSeen: number;
    }> = [];
    for (const [address, endpoints] of [...accountEndpoints]) {
      for (const [hash, entry] of [...endpoints]) {
        if (now - entry.lastSeen > PRESENCE_TTL_MS) {
          endpoints.delete(hash);
          continue;
        }
        // A looped-back announce of our own endpoint would otherwise look like
        // a peer device to route to.
        if (hash === localHash) continue;
        out.push({
          address,
          destinationHash: hash,
          sessionId: entry.sessionId,
          lastSeen: entry.lastSeen,
        });
      }
      if (endpoints.size === 0) accountEndpoints.delete(address);
    }
    return out;
  };
  const overlaySyncAccountLeases = () => {
    const now = Date.now();
    const localHash = (
      getMobileReticulumInfo().destinationHash || ''
    ).toLowerCase();
    const leases: Array<{
      address: string;
      destinationHash: string;
      sessionId: string;
      lastSeen: number;
      expiresAt: number;
      verification: 'relayed-bound';
    }> = [];
    for (const [address, endpoints] of accountEndpoints) {
      for (const [hash, entry] of endpoints) {
        if (now - entry.lastSeen > CHAT_ENDPOINT_TTL_MS) continue;
        if (hash === localHash) continue;
        leases.push({
          address,
          destinationHash: hash,
          sessionId: entry.sessionId || 'account-endpoint',
          lastSeen: entry.lastSeen,
          expiresAt: entry.lastSeen + CHAT_ENDPOINT_TTL_MS,
          verification: 'relayed-bound',
        });
      }
    }
    return leases;
  };
  type UpdatePayload = {
    address: string;
    online: boolean;
    status: UserStatus | null;
  };
  const updateCbs = new Set<(p: UpdatePayload) => void>();
  const batchCbs = new Set<(ps: UpdatePayload[]) => void>();
  const clearedCbs = new Set<() => void>();

  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let syncInFlight = false;
  let syncQueuedAgain = false;

  const neighborList = (): string[] => [...neighborHashes].slice(0, MAX_NEIGHBORS);

  // Mirror the desktop reticulumGetStatus snapshot for CoreSyncStatus/p2pHealth.
  let onlineRemoteHubInterfaces = 0;

  // Peers we have actually received overlay traffic from, and since when the
  // set has been continuously non-empty. p2pHealth gates the call buttons on
  // these, so without them mobile would sit permanently on 'bad'.
  const receivingPeerLastSeen = new Map<string, number>();
  let receivingSinceMs: number | null = null;

  const markReceivingPeer = (raw: unknown): void => {
    const hash = asString(raw)?.trim().toLowerCase();
    if (!hash || !DEST_HASH_RE.test(hash)) return;
    receivingPeerLastSeen.set(hash, Date.now());
  };

  const refreshMobileStatus = (): void => {
    const now = Date.now();
    for (const [hash, lastSeen] of [...receivingPeerLastSeen]) {
      if (now - lastSeen > RECEIVING_PEER_TTL_MS) {
        receivingPeerLastSeen.delete(hash);
      }
    }
    if (receivingPeerLastSeen.size === 0) {
      receivingSinceMs = null;
    } else if (receivingSinceMs === null) {
      receivingSinceMs = now;
    }
    publishMobileReticulumStatus({
      onlineRemoteHubInterfaces,
      p2pActiveOverlayPeers: neighborHashes.size,
      p2pReceivingOverlayPeers: receivingPeerLastSeen.size,
      p2pReceivingOverlayPeersStableMs: receivingSinceMs
        ? now - receivingSinceMs
        : 0,
      bridgeState: bridgeReady ? 'ready' : bridgeError ? 'failed' : 'starting',
      bridgeError: bridgeReady ? null : bridgeError,
    });
  };

  // Neighbour caps: 'leaf' = phone defaults (6 + 6), 'full' = desktop-sized
  // (12 + 8) while charging on an unmetered network. Idempotent in Python;
  // an older bridge rejects the unknown action, which is harmless.
  const pushOverlayProfile = (profile: RelayProfile): void => {
    if (!bridgeReady) return;
    void Promise.resolve()
      .then(() =>
        Reticulum.presenceCommand({
          action: 'configure_overlay_profile',
          payload: { profile },
        })
      )
      .catch((err) => {
        console.warn('[Presence] configure_overlay_profile failed:', err);
      });
  };
  pushOverlayProfileRef = pushOverlayProfile;
  bindBackgroundSyncWatcher();

  // Tell the bridge which discovered peers to fan presence out to. Debounced,
  // single-flight, and re-run if state changed while a sync was in flight.
  // An unchanged neighbor set is already a no-op on the Python side; skip
  // the JNI hop unless the list changed or the last push is stale.
  let lastOverlaySyncKey = '';
  let lastOverlaySyncAt = 0;
  const pushOverlaySync = async (): Promise<void> => {
    if (!bridgeReady) return;
    const overlayKey = `${neighborList().join(',')}|${overlaySyncAccountLeases().length}`;
    // Real visibility: keep-alive keeps the engine (and these leases)
    // working while GO is off screen.
    const minMs = isPageReallyHidden() ? 60_000 : 20_000;
    if (
      overlayKey === lastOverlaySyncKey &&
      Date.now() - lastOverlaySyncAt < minMs
    ) {
      return;
    }
    if (syncInFlight) {
      syncQueuedAgain = true;
      return;
    }
    syncInFlight = true;
    try {
      const accountEndpointLeases = overlaySyncAccountLeases();
      await Reticulum.presenceCommand({
        action: 'overlay_sync_state',
        payload: {
          verifiedPeers: [],
          activeNeighborHashes: neighborList(),
          accountEndpointLeases,
        },
      });
      lastOverlaySyncKey = overlayKey;
      lastOverlaySyncAt = Date.now();
    } catch (err) {
      console.error('[Presence] overlay_sync_state failed:', err);
    } finally {
      syncInFlight = false;
      if (syncQueuedAgain) {
        syncQueuedAgain = false;
        scheduleSync();
      }
    }
  };

  const scheduleSync = (): void => {
    if (syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void pushOverlaySync();
    }, 400);
  };

  const addNeighbor = (raw: unknown): void => {
    const hash = asString(raw)?.trim().toLowerCase();
    if (!hash || !DEST_HASH_RE.test(hash)) return;
    if (neighborHashes.has(hash)) return;
    if (neighborHashes.size >= MAX_NEIGHBORS) return;
    neighborHashes.add(hash);
    refreshMobileStatus();
    scheduleSync();
  };

  const STATUS_PRIORITY: Record<UserStatus, number> = {
    busy: 3,
    online: 2,
    idle: 1,
  };

  const isSessionLive = (session: PresenceSession, now: number): boolean =>
    now - session.lastSeen <= PRESENCE_TTL_MS;

  const liveSessions = (now: number = Date.now()): PresenceSession[] => {
    const out: PresenceSession[] = [];
    for (const sessions of sessionsByAddress.values()) {
      for (const session of sessions.values()) {
        if (isSessionLive(session, now)) out.push(session);
      }
    }
    return out;
  };

  /** Drops expired sessions; returns the accounts that lost one. */
  const pruneExpiredSessions = (now: number = Date.now()): Set<string> => {
    const changed = new Set<string>();
    for (const [address, sessions] of [...sessionsByAddress]) {
      for (const [key, session] of [...sessions]) {
        if (isSessionLive(session, now)) continue;
        sessions.delete(key);
        changed.add(address);
      }
      if (sessions.size === 0) sessionsByAddress.delete(address);
    }
    return changed;
  };

  /** The most available status across an account's live devices. */
  const aggregateStatus = (
    address: string,
    now: number = Date.now()
  ): UserStatus | null => {
    let best: UserStatus | null = null;
    for (const session of sessionsByAddress.get(address)?.values() ?? []) {
      if (!isSessionLive(session, now)) continue;
      if (
        best === null ||
        STATUS_PRIORITY[session.status] > STATUS_PRIORITY[best]
      ) {
        best = session.status;
      }
    }
    return best;
  };

  const emitAggregates = (addresses: Iterable<string>): void => {
    const now = Date.now();
    const payloads: UpdatePayload[] = [];
    for (const address of addresses) {
      const status = aggregateStatus(address, now);
      payloads.push({ address, online: status !== null, status });
    }
    if (payloads.length === 0) return;
    updateCbs.forEach((cb) => {
      payloads.forEach((payload) => {
        try {
          cb(payload);
        } catch {
          /* ignore */
        }
      });
    });
    batchCbs.forEach((cb) => {
      try {
        cb(payloads);
      } catch {
        /* ignore */
      }
    });
  };

  /**
   * Applies one signed presence envelope to the session map and returns its
   * account, or null when it carries none. `routeHash` is the device's
   * Reticulum destination; `local` marks this device's own publish.
   */
  const applyPresenceEnvelope = (
    env: Record<string, unknown>,
    routeHash: string,
    local: boolean
  ): string | null => {
    const envPayload = asObject(env.payload) ?? {};
    const address =
      asString(envPayload.address) ?? asString(env.senderAddress) ?? '';
    if (!address) return null;
    const sessionId = asString(envPayload.sessionId) ?? '';
    const key = sessionId || routeHash || address;
    let sessions = sessionsByAddress.get(address);

    if (asString(env.type) === 'PRESENCE_OFFLINE') {
      if (sessions) {
        // Only this device went offline; an older envelope without a session
        // id cannot say which one, so it clears the account as before.
        if (sessionId) sessions.delete(key);
        else sessions.clear();
        if (sessions.size === 0) sessionsByAddress.delete(address);
      }
      return address;
    }

    const now = Date.now();
    const existing = sessions?.get(key);
    if (!sessions) {
      sessions = new Map();
      sessionsByAddress.set(address, sessions);
    }
    sessions.set(key, {
      address,
      publicKey: asString(envPayload.publicKey) ?? existing?.publicKey ?? '',
      sessionId: sessionId || existing?.sessionId || '',
      lastSeen: now,
      firstSeen: existing?.firstSeen ?? now,
      originNodeId: local ? 'local' : 'reticulum',
      viaPeerId: routeHash || existing?.viaPeerId || '',
      clientVersion:
        asString(envPayload.clientVersion) ?? existing?.clientVersion,
      status: asUserStatus(envPayload.status) ?? 'online',
      signatureValid: true,
    });
    return address;
  };

  // Inbound signed presence packet relayed by the bridge → update session map.
  const handlePresenceMessage = (payload: Record<string, unknown>): void => {
    const route = asObject(payload.route);
    if (route) {
      addNeighbor(route.destinationHash);
      addNeighbor(route.viaDestinationHash);
      markReceivingPeer(route.destinationHash);
    }
    const env = asObject(payload.envelope);
    if (!env) return;
    const routeHash = String(route?.destinationHash || '').toLowerCase();
    const address = applyPresenceEnvelope(env, routeHash, false);
    if (!address) return;

    if (asString(env.type) === 'PRESENCE_OFFLINE') {
      const endpoints = accountEndpoints.get(address);
      if (endpoints && routeHash) {
        endpoints.delete(routeHash);
        if (endpoints.size === 0) accountEndpoints.delete(address);
      } else {
        accountEndpoints.delete(address);
      }
    } else {
      const envPayload = asObject(env.payload) ?? {};
      rememberAccountEndpoint(
        address,
        route?.destinationHash,
        asString(envPayload.sessionId) ?? ''
      );
    }
    emitAggregates([address]);
  };

  // ── 1:1 call signaling (port of electron/src/call.ts) ──────────────────
  // Signaling only: CALL_REQUEST/ACCEPT/REJECT/HANGUP over the same Reticulum
  // overlay used by presence. The renderer (useVoiceCall) signs every envelope
  // via window.sendMessage('signPresenceMessage') BEFORE calling window.call.*,
  // so this layer just encodes the compact wire, floods it to overlay neighbours
  // (fanout_call, the bridge forwards by overlay target address U), and maps
  // inbound `call_message` frames to the renderer's call:* events.
  //
  // MVP scope: like presence, we trust the bridge-relayed signaling rather than
  // re-verifying Ed25519 in JS (full per-message verification is a follow-up).
  const CALL_MAX_HOPS = 4;
  const CALL_TTL_MS = 60_000;
  const CALL_OVERLAY_SEEN_TTL_MS = 60_000;
  const CALL_ACCEPT_REPEAT_ATTEMPTS = 5;
  const CALL_ACCEPT_REPEAT_MS = 350;
  const CALL_WIRE = {
    REQUEST: 'CR',
    ACCEPT: 'CA',
    REJECT: 'CX',
    HANGUP: 'CH',
  } as const;

  type CallDirection = 'outbound' | 'inbound';
  type CallEnvelope =
    | {
        type: 'CALL_REQUEST';
        callId: string;
        fromAddress: string;
        fromPublicKey: string;
        chatId: string;
        signature: string;
        timestamp: number;
      }
    | {
        type: 'CALL_ACCEPT' | 'CALL_HANGUP';
        callId: string;
        fromPublicKey: string;
        signature: string;
        timestamp: number;
      }
    | {
        type: 'CALL_REJECT';
        callId: string;
        reason?: string;
        fromPublicKey: string;
        signature: string;
        timestamp: number;
      };
  type CallRecord = {
    callId: string;
    localAddress: string;
    remoteAddress: string;
    chatId: string;
    direction: CallDirection;
    state: 'pending' | 'active' | 'ended';
    cleanupTimer?: ReturnType<typeof setTimeout>;
    repeatTimers?: Set<ReturnType<typeof setTimeout>>;
  };

  const callLocalAddresses = new Set<string>();
  const activeCalls = new Map<string, CallRecord>();
  const callEventCbs = new Set<(event: string, payload: unknown) => void>();
  const seenCallOverlayIds = new Map<string, number>();
  let pendingIncoming: Array<{
    env: Extract<CallEnvelope, { type: 'CALL_REQUEST' }>;
    senderHash: string;
    receivedAt: number;
  }> = [];

  const buildDirectCallChatId = (a: string, b: string): string =>
    `direct:${[a, b].sort().join(':')}`;

  const emitCall = (event: string, payload: unknown): void => {
    console.log('[Call] emit', event, payload, `(subs=${callEventCbs.size})`);
    callEventCbs.forEach((cb) => {
      try {
        cb(event, payload);
      } catch {
        /* ignore */
      }
    });
  };

  const clearCallTimers = (call: CallRecord): void => {
    if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
    call.repeatTimers?.forEach((t) => clearTimeout(t));
    call.repeatTimers?.clear();
  };

  const encodeCallWire = (env: CallEnvelope): Record<string, unknown> => {
    switch (env.type) {
      case 'CALL_REQUEST': {
        const wire: Record<string, unknown> = {
          t: CALL_WIRE.REQUEST,
          c: env.callId,
          a: env.fromAddress,
          k: env.fromPublicKey,
          g: env.signature,
          m: env.timestamp,
        };
        // direct: chatId is derivable from sender + overlay target → omit (MDU).
        if (!env.chatId.startsWith('direct:')) wire.H = env.chatId;
        return wire;
      }
      case 'CALL_ACCEPT':
        return {
          t: CALL_WIRE.ACCEPT,
          c: env.callId,
          k: env.fromPublicKey,
          g: env.signature,
          m: env.timestamp,
        };
      case 'CALL_REJECT':
        return {
          t: CALL_WIRE.REJECT,
          c: env.callId,
          ...(env.reason ? { e: env.reason } : {}),
          k: env.fromPublicKey,
          g: env.signature,
          m: env.timestamp,
        };
      case 'CALL_HANGUP':
        return {
          t: CALL_WIRE.HANGUP,
          c: env.callId,
          k: env.fromPublicKey,
          g: env.signature,
          m: env.timestamp,
        };
      default:
        return {};
    }
  };

  const decodeCallWire = (
    wire: Record<string, unknown>
  ): CallEnvelope | null => {
    const num = (v: unknown): v is number => typeof v === 'number';
    const str = (v: unknown): v is string => typeof v === 'string';
    switch (wire.t) {
      case CALL_WIRE.REQUEST: {
        if (!str(wire.c) || !str(wire.a) || !str(wire.k) || !str(wire.g) || !num(wire.m))
          return null;
        const chatId = str(wire.H)
          ? wire.H
          : str(wire.U) && wire.U.length > 0
            ? buildDirectCallChatId(wire.a, wire.U)
            : null;
        if (!chatId) return null;
        return {
          type: 'CALL_REQUEST',
          callId: wire.c,
          fromAddress: wire.a,
          fromPublicKey: wire.k,
          chatId,
          signature: wire.g,
          timestamp: wire.m,
        };
      }
      case CALL_WIRE.ACCEPT:
        if (!str(wire.c) || !str(wire.k) || !str(wire.g) || !num(wire.m)) return null;
        return {
          type: 'CALL_ACCEPT',
          callId: wire.c,
          fromPublicKey: wire.k,
          signature: wire.g,
          timestamp: wire.m,
        };
      case CALL_WIRE.REJECT:
        if (!str(wire.c) || !str(wire.k) || !str(wire.g) || !num(wire.m)) return null;
        return {
          type: 'CALL_REJECT',
          callId: wire.c,
          ...(str(wire.e) ? { reason: wire.e } : {}),
          fromPublicKey: wire.k,
          signature: wire.g,
          timestamp: wire.m,
        };
      case CALL_WIRE.HANGUP:
        if (!str(wire.c) || !str(wire.k) || !str(wire.g) || !num(wire.m)) return null;
        return {
          type: 'CALL_HANGUP',
          callId: wire.c,
          fromPublicKey: wire.k,
          signature: wire.g,
          timestamp: wire.m,
        };
      default:
        return null;
    }
  };

  const attachCallOverlayMeta = (
    wire: Record<string, unknown>,
    targetAddress: string,
    hops: number
  ): Record<string, unknown> => ({
    ...wire,
    U: targetAddress,
    L: Math.max(0, Math.trunc(hops)),
    X: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
  });

  const seenCallOverlayId = (id: string): boolean => {
    const now = Date.now();
    for (const [k, exp] of [...seenCallOverlayIds]) {
      if (exp <= now) seenCallOverlayIds.delete(k);
    }
    if (seenCallOverlayIds.has(id)) return true;
    seenCallOverlayIds.set(id, now + CALL_OVERLAY_SEEN_TTL_MS);
    return false;
  };

  const fanoutCallWire = async (
    wire: Record<string, unknown>
  ): Promise<void> => {
    await ensureBridgeStarted();
    try {
      const res = await Reticulum.presenceCommand({
        action: 'fanout_call',
        payload: { messages: [wire], overlayNeighborHashes: neighborList() },
      });
      console.log(
        '[Call] fanout_call t=%s U=%s neighbors=%d ->',
        String(wire.t),
        String(wire.U ?? ''),
        neighborList().length,
        res
      );
    } catch (err) {
      console.error('[Call] fanout_call failed:', err);
    }
  };

  const sendCallEnvelope = (targetAddress: string, env: CallEnvelope): void => {
    const wire = attachCallOverlayMeta(
      encodeCallWire(env),
      targetAddress,
      CALL_MAX_HOPS
    );
    void fanoutCallWire(wire);
  };

  // Recipient address resolution for an inbound CALL_REQUEST (direct + support).
  const callRecipientAddresses = (
    chatId: string,
    fromAddress: string
  ): Set<string> | null => {
    if (chatId.startsWith('direct:')) {
      const parts = chatId.slice('direct:'.length).split(':').filter(Boolean);
      if (parts.length !== 2) return null;
      const set = new Set(parts);
      if (!set.has(fromAddress)) return null;
      set.delete(fromAddress);
      return set.size === 1 ? set : null;
    }
    if (chatId.startsWith('support:')) {
      if (chatId === 'support:queue') return null;
      const parts = chatId.slice('support:'.length).split(':').filter(Boolean);
      if (parts.length < 2) return null;
      const set = new Set(parts);
      set.delete(fromAddress);
      return set.size > 0 ? set : null;
    }
    return null;
  };

  const localCallRecipient = (
    env: Extract<CallEnvelope, { type: 'CALL_REQUEST' }>
  ): string | null => {
    const recipients = callRecipientAddresses(env.chatId, env.fromAddress);
    if (!recipients) return null;
    for (const addr of callLocalAddresses) {
      if (recipients.has(addr)) return addr;
    }
    return null;
  };

  const applyIncomingRequest = (
    env: Extract<CallEnvelope, { type: 'CALL_REQUEST' }>
  ): void => {
    if (activeCalls.has(env.callId)) return;
    const localRecipient = localCallRecipient(env);
    if (!localRecipient) return;

    const record: CallRecord = {
      callId: env.callId,
      localAddress: localRecipient,
      remoteAddress: env.fromAddress,
      chatId: env.chatId,
      direction: 'inbound',
      state: 'pending',
    };
    record.cleanupTimer = setTimeout(() => {
      if (activeCalls.get(env.callId)?.state === 'pending') {
        activeCalls.delete(env.callId);
      }
    }, CALL_TTL_MS);
    activeCalls.set(env.callId, record);
    emitCall('call:incoming', {
      callId: env.callId,
      fromAddress: env.fromAddress,
      chatId: env.chatId,
    });
  };

  const flushPendingIncoming = (): void => {
    if (callLocalAddresses.size === 0) return;
    const pending = pendingIncoming;
    pendingIncoming = [];
    const now = Date.now();
    for (const p of pending) {
      if (now - p.receivedAt > CALL_TTL_MS) continue;
      applyIncomingRequest(p.env);
    }
  };

  const handleCallEnvelope = (
    env: CallEnvelope,
    senderHash: string
  ): void => {
    if (env.type === 'CALL_REQUEST') {
      const skew = Date.now() - env.timestamp;
      if (skew > 30_000 || skew < -10_000) return;
      if (callLocalAddresses.size === 0) {
        pendingIncoming = pendingIncoming.filter(
          (p) => p.env.callId !== env.callId
        );
        pendingIncoming.push({ env, senderHash, receivedAt: Date.now() });
        return;
      }
      applyIncomingRequest(env);
      return;
    }
    const call = activeCalls.get(env.callId);
    if (!call) return;
    if (env.type === 'CALL_ACCEPT') {
      if (call.direction !== 'outbound') return;
      clearCallTimers(call);
      call.state = 'active';
      emitCall('call:accepted', { callId: env.callId });
    } else if (env.type === 'CALL_REJECT') {
      clearCallTimers(call);
      call.state = 'ended';
      activeCalls.delete(env.callId);
      emitCall('call:rejected', { callId: env.callId, reason: env.reason });
    } else if (env.type === 'CALL_HANGUP') {
      clearCallTimers(call);
      call.state = 'ended';
      activeCalls.delete(env.callId);
      emitCall('call:hangup', { callId: env.callId });
    }
  };

  // Inbound call signaling frame from the bridge → decode + dispatch.
  const handleCallMessage = (payload: Record<string, unknown>): void => {
    const wire = asObject(payload.wire);
    if (!wire) return;
    console.log(
      '[Call] rx call_message t=%s U=%s a=%s localAddrs=%d',
      String(wire.t),
      String(wire.U ?? ''),
      String(wire.a ?? ''),
      callLocalAddresses.size
    );
    const senderHash = asString(payload.senderDestinationHash) ?? '';
    // Overlay dedup + leaf targeting: only process wires addressed to us.
    if (typeof wire.X === 'string') {
      if (seenCallOverlayId(wire.X)) return;
      const target = asString(wire.U);
      if (
        target &&
        callLocalAddresses.size > 0 &&
        !callLocalAddresses.has(target)
      ) {
        // Not for us; mobile is a leaf and does not relay others' calls.
        return;
      }
    }
    const env = decodeCallWire(wire);
    if (!env) return;
    handleCallEnvelope(env, senderHash);
  };

  const handleFrame = (frameStr: string): void => {
    let frame: Record<string, unknown> | undefined;
    try {
      frame = asObject(JSON.parse(frameStr));
    } catch {
      return; // partial / non-JSON frame
    }
    if (!frame) return;
    if (frame.type === 'resp') {
      resolveCommandResp(frame);
      return;
    }
    if (frame.type !== 'event') return;
    // The chat engine worker consumes python events the switch below does not
    // handle (reticulum_chat_message, resource sessions, ready, …).
    for (const tap of pythonEventTaps) {
      try {
        tap(frame);
      } catch (err) {
        console.warn('[Presence] python event tap failed:', err);
      }
    }
    switch (frame.event) {
      case 'error': {
        // qortal_presence_host emits this when presence_bridge.main() dies.
        // Without it the badge stayed on "starting" forever and every chat
        // call failed with a generic timeout.
        const errPayload = asObject(frame.payload);
        if (asString(errPayload?.code) === 'host_fatal') {
          bridgeReady = false;
          bridgeError = describePresenceBridgeFailure(
            asString(errPayload?.message) || 'Python bridge exited'
          );
          console.error(
            '[Presence] bridge host fatal:',
            errPayload?.message,
            errPayload?.detail
          );
          refreshMobileStatus();
        }
        break;
      }
      case 'ready': {
        bridgeReady = true;
        bridgeError = null;
        // Release anyone awaiting ensureBridgeStarted's readiness gate.
        [...bridgeReadyResolvers].forEach((resolve) => {
          try {
            resolve();
          } catch {
            /* ignore */
          }
        });
        bridgeReadyResolvers.clear();
        const readyPayload = asObject(frame.payload);
        const readyHash = asString(readyPayload?.destinationHash);
        if (readyHash && DEST_HASH_RE.test(readyHash.toLowerCase())) {
          setLocalReticulumDestinationHash(readyHash.toLowerCase());
        }
        const readyIdentity = asString(readyPayload?.identityPublicKeyBase64);
        if (readyIdentity) setLocalReticulumIdentity(readyIdentity);
        startedCallbacks.forEach((cb) => {
          try {
            cb();
          } catch {
            /* ignore */
          }
        });
        refreshMobileStatus();
        void pushOverlaySync();
        // Python may outlive the page (Activity recreated, task swiped away
        // while the service kept the process): always push the current
        // profile, a stale 'full' must drop back to leaf. Idempotent.
        pushOverlayProfile(relayProfile);
        hydrateQchatPendingSends();
        void window.hub?.getIceServers?.().catch(() => {});
        break;
      }
      case 'transport_state': {
        const tp = asObject(frame.payload);
        const hubs = tp?.onlineRemoteHubInterfaces;
        if (typeof hubs === 'number') onlineRemoteHubInterfaces = hubs;
        refreshMobileStatus();
        break;
      }
      case 'candidate_peer_discovered':
        addNeighbor(asObject(frame.payload)?.peerHash);
        break;
      case 'presence_message':
        handlePresenceMessage(asObject(frame.payload) ?? {});
        break;
      case 'call_message':
        handleCallMessage(asObject(frame.payload) ?? {});
        break;
      case 'group_call_message':
        void handleGroupCallMessage(asObject(frame.payload) ?? {});
        break;
      case 'qchat_file_transfer':
        handleQchatFileTransferEvent(asObject(frame.payload) ?? {});
        break;
      case 'group_audio_packet':
        handleGroupAudioPacket(asObject(frame.payload) ?? {});
        break;
      case 'group_audio_link_established': {
        const lp = asObject(frame.payload);
        const peer = asString(lp?.peerPresenceHash)?.toLowerCase();
        const linkId = asString(lp?.linkId);
        if (peer && linkId) {
          establishedLinkIdByPeer.set(peer, linkId);
          console.log(
            '[GCall] audio link established peer=%s link=%s',
            peer.slice(0, 8),
            linkId.slice(0, 8)
          );
          // Authenticate every room this peer participates in (the link must be
          // verified before the Hub will deliver GC_KEY over it).
          for (const [rid, byAddr] of gcPeersByRoom) {
            for (const p of byAddr.values()) {
              if (p.destinationHash?.toLowerCase() === peer) {
                void sendLinkAuthForRoom(rid);
                break;
              }
            }
          }
        }
        break;
      }
      case 'group_audio_link_closed': {
        const lp = asObject(frame.payload);
        const peer = asString(lp?.peerPresenceHash)?.toLowerCase();
        if (peer) establishedLinkIdByPeer.delete(peer);
        break;
      }
      case 'group_audio_send_failed': {
        // The bridge drops an outbound audio packet (link not ready / closed /
        // generation changed / overlay congestion). The renderer's tx counter
        // only sees the send *command* succeed, so without this we can't see
        // the real delivery loss. Aggregate by reason and log (throttled) so we
        // can tell "link not ready" drops from genuine RNS packet loss.
        const lp = asObject(frame.payload);
        const reason = asString(lp?.reason) || asString(lp?.code) || 'unknown';
        audioSendFailCounts.set(
          reason,
          (audioSendFailCounts.get(reason) ?? 0) + 1
        );
        audioSendFailTotal += 1;
        const now = Date.now();
        if (now - audioSendFailLastLogAt >= 2500) {
          audioSendFailLastLogAt = now;
          const breakdown = [...audioSendFailCounts.entries()]
            .map(([r, n]) => `${r}=${n}`)
            .join(' ');
          console.log(
            '[GCall] audio send-failed total=%d %s',
            audioSendFailTotal,
            breakdown
          );
        }
        break;
      }
      case 'community_stun_endpoint': {
        rememberCommunityIceServers([asObject(frame.payload)]);
        break;
      }
      default:
        break;
    }
  };

  // The native presence bridge boots an embedded CPython interpreter + RNS.
  // Start it LAZILY (first announce, i.e. after login) rather than at app
  // launch, and keep every failure contained so it can never regress the
  // stability of the login / core app.
  // Resolves once the Python bridge emits `ready`, or after a bounded wait so a
  // bridge that never reports ready can't deadlock the first command forever.
  const waitForBridgeReady = (timeoutMs: number): Promise<void> => {
    if (bridgeReady) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        bridgeReadyResolvers.delete(finish);
        resolve();
      };
      bridgeReadyResolvers.add(finish);
      window.setTimeout(finish, timeoutMs);
    });
  };

  const ensureBridgeStarted = (): Promise<void> => {
    if (bridgeStartPromise) return bridgeStartPromise;
    bridgeStartPromise = (async () => {
      if (!frameListenerAttached) {
        frameListenerAttached = true;
        try {
          await Reticulum.addListener('presence', (event) => {
            handleFrame(event.frame);
          });
        } catch (err) {
          console.error('[Presence] addListener failed:', err);
        }
      }
      try {
        await Reticulum.presenceStart();
        // presenceStart() resolves as soon as Kotlin queues the start command;
        // the embedded CPython/RNS boot (identity load, hub TCP connects) is
        // still in flight. Block here until the bridge reports `ready` so the
        // first publish_presence / file send doesn't race a half-booted bridge
        // and time out. Bounded so a stalled boot degrades to a retry instead
        // of hanging.
        await waitForBridgeReady(30_000);
        // The wait also ends without `ready`, and nothing asks again: a
        // `ready` sent while this page was not listening yet (GO rebuilt the
        // screen while the first start was still running) left presence at
        // "0, connecting" until a restart, because without our destination
        // hash presence never announces. presenceStart on a running bridge
        // re-sends `ready`.
        for (let attempt = 0; !bridgeReady && attempt < 3; attempt += 1) {
          console.warn(
            `[Presence] Bridge ready not seen; asking again (${attempt + 1}/3)`
          );
          await Reticulum.presenceStart();
          await waitForBridgeReady(10_000);
        }
        if (!bridgeReady) bridgeStartPromise = null;
      } catch (err) {
        console.error('[Presence] presenceStart failed:', err);
        bridgeError = describePresenceBridgeFailure(err);
        refreshMobileStatus();
        bridgeStartPromise = null; // allow retry on next announce
      }
    })();
    return bridgeStartPromise;
  };
  ensureBridgeStartedRef = ensureBridgeStarted;
  waitForBridgeReadyRef = waitForBridgeReady;

  // Presence snapshot for the mobile chat engine. Mirrors the desktop
  // PresenceManager accessors: verified transport peers ({destinationHash,
  // lastSeen}), account endpoint leases, and an overlay-health boolean.
  reticulumChatPresenceSnapshotRef = () => {
    const now = Date.now();
    const peers: Array<{ destinationHash: string; lastSeen: number }> = [];
    const seenPeerHashes = new Set<string>();
    const leases: ReturnType<
      typeof getReticulumChatPresenceSnapshot
    >['leases'] = [];
    const localHash = (
      getMobileReticulumInfo().destinationHash || ''
    ).toLowerCase();
    for (const [address, endpoints] of [...accountEndpoints]) {
      for (const [hash, entry] of [...endpoints]) {
        if (now - entry.lastSeen > CHAT_ENDPOINT_TTL_MS) {
          endpoints.delete(hash);
          continue;
        }
        if (hash === localHash) continue;
        if (!seenPeerHashes.has(hash)) {
          seenPeerHashes.add(hash);
          peers.push({
            destinationHash: hash,
            lastSeen: entry.lastSeen,
          });
        }
        leases.push({
          destinationHash: hash,
          address,
          sessionId: entry.sessionId,
          lastSeen: entry.lastSeen,
          expiresAt: entry.lastSeen + CHAT_ENDPOINT_TTL_MS,
          verification: 'relayed-bound',
        });
      }
      if (endpoints.size === 0) accountEndpoints.delete(address);
    }
    for (const neighbor of neighborList()) {
      const hash = String(neighbor || '').toLowerCase();
      if (/^[0-9a-f]{32}$/.test(hash) && !seenPeerHashes.has(hash)) {
        seenPeerHashes.add(hash);
        peers.push({ destinationHash: hash, lastSeen: now });
      }
    }
    return {
      peers,
      leases,
      healthy:
        peers.length > 0 ||
        liveSessions().some((s) => s.originNodeId !== 'local') ||
        onlineRemoteHubInterfaces > 0,
    };
  };

  const publish = async (
    envelope: PresenceEnvelope
  ): Promise<{ success: boolean }> => {
    try {
      // Wait for the bridge's resp frame instead of fire-and-forget: a publish
      // that Python rejects ("Bridge not started", wire build failure, …) must
      // surface as success:false so usePresence retries the announce instead
      // of believing it is online while nothing ever reaches the network.
      // First publish after a cold boot can still be slow even once `ready`
      // fires (overlay sync + path nudges + fan-out), so give it extra headroom
      // before falling back to usePresence's retry loop.
      const timeoutMs = firstPublishDone ? 20_000 : 35_000;
      const resp = await presenceCommandWithResult(
        'publish_presence',
        {
          envelope,
          overlayNeighborHashes: neighborList(),
        },
        timeoutMs
      );
      if (resp.ok === false) {
        console.warn('[Presence] publish rejected by bridge:', resp.error ?? resp);
        return { success: false };
      }
      firstPublishDone = true;
      // Count this device among its account's sessions, as the desktop does
      // with its `local` route: our own packets never loop back, so without
      // this GO would show its own account with only the other devices' status.
      const localHash = (
        getMobileReticulumInfo().destinationHash || ''
      ).toLowerCase();
      const address = applyPresenceEnvelope(
        envelope as unknown as Record<string, unknown>,
        localHash,
        true
      );
      if (address) emitAggregates([address]);
      return { success: true };
    } catch (err) {
      console.error('[Presence] publish failed:', err);
      return { success: false };
    }
  };

  // Developer diagnostics reachable from remote devtools (logcat is muted on
  // some vendor builds): `await __qgoBridgeDiag.threadReport()` returns the
  // Python bridge's per-thread CPU report, tids matching /proc/<pid>/task.
  (window as unknown as Record<string, unknown>).__qgoBridgeDiag = {
    threadReport: () =>
      presenceCommandWithResult('debug_thread_report', {}, 15_000),
    wireMix: () => presenceCommandWithResult('debug_wire_mix', {}, 15_000),
  };

  window.presence = {
    announce: publish,
    heartbeat: publish,
    offline: publish,
    getStatus: async (address: string) => {
      const sessions = liveSessions().filter((s) => s.address === address);
      const lastSeen = sessions.reduce((m, s) => Math.max(m, s.lastSeen), 0);
      return {
        online: sessions.length > 0,
        lastSeen: lastSeen || null,
        sessions,
      };
    },
    getOnlineAddresses: async () => [
      ...new Set(liveSessions().map((s) => s.address)),
    ],
    getAllOnline: async () => liveSessions(),
    onUpdate: (cb) => {
      updateCbs.add(cb);
      return () => updateCbs.delete(cb);
    },
    onUpdateBatch: (cb) => {
      batchCbs.add(cb);
      return () => batchCbs.delete(cb);
    },
    onCleared: (cb) => {
      clearedCbs.add(cb);
      return () => clearedCbs.delete(cb);
    },
    onStarted: (cb: () => void) => {
      startedCallbacks.add(cb);
      if (bridgeReady) {
        try {
          cb();
        } catch {
          /* ignore */
        }
      }
      return () => startedCallbacks.delete(cb);
    },
  };

  window.hub = {
    getBootstrapIceServers: () => communityIceServers.map((server) => ({ ...server })),
    getIceServers: async () => {
      try {
        const frame = await presenceCommandWithResult(
          'get_community_stun_endpoints',
          {}
        );
        const payload = asObject(frame.payload);
        rememberCommunityIceServers(payload?.endpoints);
      } catch {
        // Cached community servers (if any) still let WebRTC try; Reticulum
        // remains the media fallback when ICE is empty.
      }
      return communityIceServers.map((server) => ({ ...server }));
    },
    reportStunCallOutcome: async () => ({ ok: true }),
    reportObservedStunSources: async () => ({ ok: true }),
  };

  // ── window.call — 1:1 voice call signaling over Reticulum ──────────────
  window.call = {
    initiate: async (
      targetAddress: string,
      chatId: string,
      localAddress: string,
      signature: string,
      publicKey: string,
      callId: string,
      timestamp: number
    ) => {
      try {
        await ensureBridgeStarted();
        const record: CallRecord = {
          callId,
          localAddress,
          remoteAddress: targetAddress,
          chatId,
          direction: 'outbound',
          state: 'pending',
        };
        record.cleanupTimer = setTimeout(() => {
          if (activeCalls.get(callId)?.state === 'pending') {
            activeCalls.delete(callId);
          }
        }, CALL_TTL_MS);
        activeCalls.set(callId, record);
        sendCallEnvelope(targetAddress, {
          type: 'CALL_REQUEST',
          callId,
          fromAddress: localAddress,
          fromPublicKey: publicKey,
          chatId,
          signature,
          timestamp,
        });
        return { success: true, callId };
      } catch (err) {
        console.error('[Call] initiate failed:', err);
        return { success: false, error: String(err) };
      }
    },
    accept: async (
      callId: string,
      signature: string,
      publicKey: string,
      timestamp: number
    ) => {
      const call = activeCalls.get(callId);
      if (!call || call.direction !== 'inbound') return { success: false };
      if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
      call.state = 'active';
      const env: CallEnvelope = {
        type: 'CALL_ACCEPT',
        callId,
        fromPublicKey: publicKey,
        signature,
        timestamp,
      };
      // Repeat the ACCEPT a few times — the caller may still be settling its
      // overlay route when the first packet floods out.
      call.repeatTimers?.forEach((t) => clearTimeout(t));
      call.repeatTimers = new Set();
      sendCallEnvelope(call.remoteAddress, env);
      for (let i = 1; i < CALL_ACCEPT_REPEAT_ATTEMPTS; i += 1) {
        const timer = setTimeout(() => {
          call.repeatTimers?.delete(timer);
          const latest = activeCalls.get(callId);
          if (latest && latest.state === 'active' && latest.direction === 'inbound') {
            sendCallEnvelope(latest.remoteAddress, env);
          }
        }, CALL_ACCEPT_REPEAT_MS * i);
        call.repeatTimers.add(timer);
      }
      return { success: true };
    },
    reject: async (
      callId: string,
      reason?: string,
      signature?: string,
      publicKey?: string,
      timestamp?: number
    ) => {
      const call = activeCalls.get(callId);
      if (!call) return { success: false };
      clearCallTimers(call);
      call.state = 'ended';
      activeCalls.delete(callId);
      sendCallEnvelope(call.remoteAddress, {
        type: 'CALL_REJECT',
        callId,
        reason,
        fromPublicKey: publicKey ?? '',
        signature: signature ?? '',
        timestamp: timestamp ?? Date.now(),
      });
      return { success: true };
    },
    hangup: async (
      callId: string,
      signature: string,
      publicKey: string,
      timestamp: number
    ) => {
      const call = activeCalls.get(callId);
      if (!call) return { success: false };
      clearCallTimers(call);
      call.state = 'ended';
      activeCalls.delete(callId);
      sendCallEnvelope(call.remoteAddress, {
        type: 'CALL_HANGUP',
        callId,
        fromPublicKey: publicKey,
        signature,
        timestamp,
      });
      return { success: true };
    },
    setLocalAddresses: async (addresses: string[]) => {
      const next = new Set<string>();
      for (const a of addresses) {
        if (typeof a === 'string' && a) next.add(a);
      }
      // useVoiceCall re-asserts this every 2.5 s as a bridge-restart guard.
      // On mobile the set lives in this same JS context, so an unchanged set
      // needs no work (and no logcat line).
      const unchanged =
        next.size === callLocalAddresses.size &&
        [...next].every((a) => callLocalAddresses.has(a));
      if (unchanged) return { success: true };
      callLocalAddresses.clear();
      for (const a of next) callLocalAddresses.add(a);
      console.log('[Call] setLocalAddresses', [...callLocalAddresses]);
      flushPendingIncoming();
      return { success: true };
    },
    onEvent: (cb: (event: string, payload: unknown) => void) => {
      callEventCbs.add(cb);
      // Replay any inbound call still ringing (renderer may subscribe late).
      for (const c of activeCalls.values()) {
        if (c.direction === 'inbound' && c.state === 'pending') {
          try {
            cb('call:incoming', {
              callId: c.callId,
              fromAddress: c.remoteAddress,
              chatId: c.chatId,
            });
          } catch {
            /* ignore */
          }
        }
      }
      return () => callEventCbs.delete(cb);
    },
  };

  // ── window.groupCall — DM (1:1) voice media coordination over Reticulum ──
  // Port of the desktop GroupCallManager, reduced to the 2-party DM path:
  //   • join/leave/key/key-request flood over the SAME overlay used for calls
  //     (fanout_group_call → peer receives group_call_message).
  //   • audio frames go over send_group_audio (FD3 replacement) routed by the
  //     peer's Reticulum destination hash learned from its GJ.
  //   • inbound group_call_message → gcall:* events for useVoiceCall; inbound
  //     group_audio_packet → gcall:audio for window.audioSurface to decrypt.
  // Like presence/call signaling this trusts bridge-relayed frames rather than
  // re-verifying Ed25519 in JS (full verification is a follow-up).
  const GC_OVERLAY_SEEN_TTL_MS = 60_000;
  type GcRoom = {
    chatId: string;
    callSessionId: string;
    mediaSessionGeneration: number;
  };
  type GcPeer = {
    address: string;
    destinationHash: string;
    identityPublicKeyBase64?: string;
  };
  const gcLocalAddresses = new Set<string>();
  const gcRooms = new Map<string, GcRoom>();
  // roomId → (address → peer); for DM there is a single peer.
  const gcPeersByRoom = new Map<string, Map<string, GcPeer>>();
  // roomId → our own signed GC_JOIN wire, replayed over the audio link as the
  // Hub's required link-auth (QGCCTL1) so the Hub marks our link "verified" and
  // stops dropping our audio with `audio-unverified-address`.
  const gcJoinWireByRoom = new Map<string, Record<string, unknown>>();
  // roomId → linkId observed on INBOUND audio-link frames (the Hub's established
  // RNS link to us). RNS links are bidirectional, so replying with our link-auth
  // over this exact linkId reaches the Hub on the link it associates with us —
  // the only way the Hub verifies our link and then delivers GC_KEY over it.
  // (Sends with an empty linkId fall back to the data-plane, which the Hub's
  // link-control decoder never sees.)
  const inboundAudioLinkIdByRoom = new Map<string, string>();
  const gcEventCbs = new Set<(event: string, payload: unknown) => void>();
  const establishedLinkIdByPeer = new Map<string, string>();
  const registeredPeerHashes = new Set<string>();
  // Outbound-audio delivery-failure diagnostics (see group_audio_send_failed).
  const audioSendFailCounts = new Map<string, number>();
  let audioSendFailTotal = 0;
  let audioSendFailLastLogAt = 0;
  const seenGcOverlayIds = new Map<string, number>();
  // Fragment reassembly buffers, keyed by digest `z`.
  type FragBuf = { meta: FragmentMeta; parts: Map<number, string>; expiresAt: number };
  const gkFragments = new Map<string, FragBuf>();
  const gqFragments = new Map<string, FragBuf>();

  const randomUuid = (): string => {
    try {
      if (crypto?.randomUUID) return crypto.randomUUID();
    } catch {
      /* fall through */
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
      .toString(36)
      .slice(2)}`;
  };

  const emitGc = (event: string, payload: unknown): void => {
    gcEventCbs.forEach((cb) => {
      try {
        cb(event, payload);
      } catch {
        /* ignore */
      }
    });
  };

  const seenGcOverlayId = (id: string): boolean => {
    const now = Date.now();
    for (const [k, exp] of [...seenGcOverlayIds]) {
      if (exp <= now) seenGcOverlayIds.delete(k);
    }
    if (seenGcOverlayIds.has(id)) return true;
    seenGcOverlayIds.set(id, now + GC_OVERLAY_SEEN_TTL_MS);
    return false;
  };

  // Hub relays group-call overlay wires ONLY when they carry overlay meta
  // (`X` dedupe id + `L` hopsRemaining — parseReticulumOverlayMeta). Without it
  // the frame dies at the first hub, so two mobiles that aren't direct overlay
  // neighbors never exchange GJ/GK and a mobile↔mobile call hangs on
  // "Connecting" with establishedLinks=0. Call signaling (CR/CA) already
  // attaches this meta, which is why ringing worked while media setup didn't.
  // 13 chars: exactly the X placeholder width reserved by the size budget in
  // groupCallWire.ts (byteLengthUtf8JsonWithBridgeSender), so fragments built
  // against RT_RETICULUM_MAX_WIRE_JSON_BYTES still fit after meta is attached.
  const attachGcOverlayMeta = (
    wire: Record<string, unknown>
  ): Record<string, unknown> => {
    const overlayId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(0, 13);
    // Mark our own id as seen so relayed echoes of our wires are dropped
    // instead of being processed as if a peer sent them (e.g. our own GJ).
    seenGcOverlayId(overlayId);
    return { ...wire, X: overlayId, L: CALL_MAX_HOPS };
  };

  const fanoutGroupCall = async (
    messages: Record<string, unknown>[]
  ): Promise<void> => {
    if (messages.length === 0) return;
    await ensureBridgeStarted();
    try {
      const res = await Reticulum.presenceCommand({
        action: 'fanout_group_call',
        payload: {
          messages: messages.map(attachGcOverlayMeta),
          overlayNeighborHashes: neighborList(),
        },
      });
      console.log(
        '[GCall] fanout t=%s neighbors=%d ->',
        String(messages[0]?.t ?? ''),
        neighborList().length,
        res
      );
    } catch (err) {
      console.error('[GCall] fanout_group_call failed:', err);
    }
  };

  // Point-to-point delivery of group-call control frames to one peer over the
  // established overlay link (handle_send_group_call → _send_wire_to_overlay_peer).
  // Single-frame signals (CR/CA/CH, GJ) cross the gossip fanout reliably, but the
  // *fragmented* room key (GK0/GK1) and key-request (GQ0/GQ1) lose fragments on the
  // multi-hop relay path so reassembly never completes and audio never decrypts.
  // The audio data-plane proves a reliable point-to-point route to the peer's
  // Reticulum destination exists, so we deliver every key fragment directly there
  // (in addition to fanout) — making the key cross as reliably as the audio.
  const sendGroupCallDirect = async (
    peerHash: string,
    frames: Record<string, unknown>[]
  ): Promise<boolean> => {
    const key = (peerHash || '').trim().toLowerCase();
    if (!DEST_HASH_RE.test(key) || frames.length === 0) return false;
    await ensureBridgeStarted();
    let allOk = true;
    for (const message of frames) {
      try {
        await Reticulum.presenceCommand({
          action: 'send_group_call',
          payload: { peerPresenceHash: key, message },
        });
      } catch (err) {
        allOk = false;
        console.error('[GCall] send_group_call (direct) failed:', err);
      }
    }
    console.log(
      '[GCall] direct t=%s frames=%d peer=%s ok=%s',
      String(frames[0]?.t ?? ''),
      frames.length,
      key.slice(0, 8),
      allOk
    );
    return allOk;
  };

  // Hub v2.0 gates inbound link audio behind an audio-link auth: the peer must
  // send `QGCCTL1\0` + a signed GC_JOIN *over the audio link* (decodeGcLinkControlWire
  // → handleReticulumLinkAuthJoinWire), otherwise the Hub closes the link with
  // `audio-unverified-address` and drops our audio. The desktop sends this through
  // the same enqueueGroupAudio path, so we replay our cached signed GJ as an opaque
  // audio frame (the bridge wraps QGAU, the peer bridge unwraps → the Hub sees the
  // QGCCTL1 frame). No Python bridge change needed.
  const GC_LINK_CONTROL_MAGIC = new TextEncoder().encode('QGCCTL1\u0000');
  // Per-room bounded resend of the link-auth (handles packet loss / the link
  // establishing without a renderer-visible event).
  const gcLinkAuthTimers = new Map<string, ReturnType<typeof setInterval>>();

  // Resolve the routable peer destination for a room (from any learned peer).
  const peerDestForRoomAny = (roomId: string): string => {
    const byAddr = gcPeersByRoom.get(roomId);
    if (!byAddr) return '';
    for (const peer of byAddr.values()) {
      if (peer.destinationHash && DEST_HASH_RE.test(peer.destinationHash)) {
        return peer.destinationHash.toLowerCase();
      }
    }
    return '';
  };

  // Send our cached signed GC_JOIN as a `QGCCTL1\0` link-control frame over the
  // same audio path the media uses. An empty linkId lets the bridge route it
  // over the peer's active audio link (identical to how audio frames flow), so
  // this does not depend on a renderer-visible `group_audio_link_established`.
  // All real audio links that might reach the peer for this room. The peer's
  // AUDIO reticulum destination often differs from its presence hash, and the
  // link can be inbound (Hub→us) or outbound (us→peer-audio-dest), so we collect
  // every established link plus the inbound link seen for the room. In a 1:1 DM
  // these all lead to the same peer, so fanning out is safe and robust.
  const candidateLinkIdsForRoom = (roomId: string): string[] => {
    const linkIds = new Set<string>();
    const peerDest = peerDestForRoomAny(roomId);
    if (peerDest) {
      const direct = establishedLinkIdByPeer.get(peerDest);
      if (direct) linkIds.add(direct);
    }
    for (const id of establishedLinkIdByPeer.values()) linkIds.add(id);
    const inbound = inboundAudioLinkIdByRoom.get(roomId);
    if (inbound) linkIds.add(inbound);
    return [...linkIds];
  };

  // Send group-call control wires (GC_JOIN auth, GC_KEY, GC_KEY_REQUEST) over the
  // established RNS audio link(s) as `QGCCTL1\0`+JSON link-control frames. The Hub
  // delivers AND accepts GC_KEY / GC_KEY_REQUEST *only* over these link-control
  // frames (electron group-call.ts sendKey → sendReticulumLinkControlToAddresses;
  // inbound via decodeGcLinkControlWire) — never over the overlay. So the room
  // key only crosses to the Hub when we ride the verified link here.
  const sendControlFramesOverLinks = async (
    roomId: string,
    frames: Record<string, unknown>[]
  ): Promise<boolean> => {
    if (frames.length === 0) return false;
    const linkIds = candidateLinkIdsForRoom(roomId);
    if (linkIds.length === 0) return false; // no real link yet
    const peerDest = peerDestForRoomAny(roomId);
    if (!peerDest) return false;
    let sentAny = false;
    for (const frame of frames) {
      const body = new TextEncoder().encode(JSON.stringify(frame));
      const buf = new Uint8Array(GC_LINK_CONTROL_MAGIC.length + body.length);
      buf.set(GC_LINK_CONTROL_MAGIC, 0);
      buf.set(body, GC_LINK_CONTROL_MAGIC.length);
      const b64 = uint8ToBase64(buf);
      for (const linkId of linkIds) {
        try {
          await Reticulum.presenceCommand({
            action: 'send_group_audio',
            payload: {
              linkId,
              roomId,
              peerPresenceHash: peerDest,
              peerDestinationHash: peerDest,
              receivedAtWallMs: Date.now(),
              data: b64,
            },
          });
          sentAny = true;
        } catch (err) {
          console.error('[GCall] control-over-link send failed:', err);
        }
      }
    }
    return sentAny;
  };

  const sendLinkAuthForRoom = async (roomId: string): Promise<void> => {
    const gj = gcJoinWireByRoom.get(roomId);
    if (!gj) return;
    const ok = await sendControlFramesOverLinks(roomId, [gj]);
    if (ok) {
      const linkIds = candidateLinkIdsForRoom(roomId);
      console.log(
        '[GCall] link-auth GJ sent room=%s peer=%s links=%d',
        roomId.slice(0, 12),
        peerDestForRoomAny(roomId).slice(0, 8),
        linkIds.length
      );
    }
  };

  // Begin resending link-auth for a room: fast (every 1.5s) so a verified link
  // comes up quickly through packet loss, bounded so we never spam forever. The
  // Hub only delivers GC_KEY over a *verified* link, so without this the room
  // key never crosses and audio never decrypts.
  const startLinkAuthForRoom = (roomId: string): void => {
    if (gcLinkAuthTimers.has(roomId)) return;
    let ticks = 0;
    void sendLinkAuthForRoom(roomId);
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks > 30 || !gcJoinWireByRoom.has(roomId)) {
        clearInterval(timer);
        gcLinkAuthTimers.delete(roomId);
        return;
      }
      void sendLinkAuthForRoom(roomId);
    }, 1500);
    gcLinkAuthTimers.set(roomId, timer);
  };

  const stopLinkAuthForRoom = (roomId: string): void => {
    const timer = gcLinkAuthTimers.get(roomId);
    if (timer) {
      clearInterval(timer);
      gcLinkAuthTimers.delete(roomId);
    }
  };

  const registerPeerIdentity = async (
    peerHash: string,
    identityPublicKeyBase64: string
  ): Promise<void> => {
    const key = peerHash.trim().toLowerCase();
    if (registeredPeerHashes.has(key)) return;
    registeredPeerHashes.add(key);
    try {
      await Reticulum.presenceCommand({
        action: 'register_peer_identity',
        payload: {
          peerPresenceHash: key,
          reticulumIdentityPublicKeyBase64: identityPublicKeyBase64,
        },
      });
    } catch (err) {
      registeredPeerHashes.delete(key);
      console.error('[GCall] register_peer_identity failed:', err);
    }
  };

  const openAudioLinkForPeer = async (peerHash: string): Promise<void> => {
    const key = peerHash.trim().toLowerCase();
    if (!DEST_HASH_RE.test(key)) return;
    // Fire-and-forget: the established linkId arrives via the
    // `group_audio_link_established` event (presenceCommand does not return the
    // bridge's resp payload). Opening warms the RNS path for the packet send too.
    try {
      await Reticulum.presenceCommand({
        action: 'open_group_audio_link',
        payload: { peerPresenceHash: key },
      });
    } catch (err) {
      console.error('[GCall] open_group_audio_link failed:', err);
    }
  };

  const recordPeerFromJoin = (
    roomId: string,
    peer: GcPeer,
    peerPresenceHash: string
  ): void => {
    let byAddr = gcPeersByRoom.get(roomId);
    if (!byAddr) {
      byAddr = new Map();
      gcPeersByRoom.set(roomId, byAddr);
    }
    // GJ is authoritative: drop address-less destination stashes from earlier
    // learning so a stale dest can't shadow the fresh one in peerDestForRoomAny.
    for (const [k, p] of [...byAddr]) {
      if (!p.address && p.destinationHash !== peer.destinationHash) {
        byAddr.delete(k);
      }
    }
    byAddr.set(peer.address, peer);
    const hash = (peerPresenceHash || peer.destinationHash).toLowerCase();
    if (peer.identityPublicKeyBase64) {
      void registerPeerIdentity(hash, peer.identityPublicKeyBase64);
    }
    void openAudioLinkForPeer(hash);
  };

  const DM_ROOM_PREFIX = 'dmv:';

  // DM voice peer learning that does NOT depend on the lossy overlay GJ. The
  // overlay broadcast of GJ/GK can be dropped between mobile and Hub, but the
  // direct-RNS audio data-plane reliably arrives. useVoiceCall hands us the peer
  // *address* via requestPeerMediaRecovery at media-start, and we learn the
  // peer's Reticulum *destination* from inbound audio packets. Together they let
  // the media-readiness gate pass and outbound audio resolve (packet-mode send
  // recalls the peer identity from its presence announce) even if no GJ arrives.
  const noteDmPeerAddress = (roomId: string, address: string): void => {
    if (!roomId.startsWith(DM_ROOM_PREFIX) || !address) return;
    let byAddr = gcPeersByRoom.get(roomId);
    if (!byAddr) {
      byAddr = new Map();
      gcPeersByRoom.set(roomId, byAddr);
    }
    if (byAddr.has(address)) return;
    // Adopt a destination already learned from audio (stashed under its hash).
    let dest = '';
    for (const [k, p] of [...byAddr]) {
      if (!p.address && p.destinationHash) {
        dest = p.destinationHash;
        byAddr.delete(k);
        break;
      }
    }
    byAddr.set(address, { address, destinationHash: dest });
  };

  const noteDmPeerDestination = (
    roomId: string,
    destHash: string,
    authoritative = false
  ): void => {
    if (!roomId.startsWith(DM_ROOM_PREFIX)) return;
    const hash = (destHash || '').trim().toLowerCase();
    if (!DEST_HASH_RE.test(hash)) return;
    let byAddr = gcPeersByRoom.get(roomId);
    if (!byAddr) {
      byAddr = new Map();
      gcPeersByRoom.set(roomId, byAddr);
    }
    // DM has a single peer: fill the existing entry's destination, else stash it
    // under the hash until the address is known (requestPeerMediaRecovery).
    let existing: GcPeer | null = null;
    for (const p of byAddr.values()) {
      existing = p;
      break;
    }
    if (existing) {
      if (!existing.destinationHash) {
        existing.destinationHash = hash;
      } else if (authoritative && existing.destinationHash !== hash) {
        // The peer's audio destination CHANGES between calls (per-session RNS
        // destination). The room id doesn't, so a destination learned in a
        // previous call goes stale and every key/audio send to it dies in the
        // void while the peer keeps re-requesting the key. A frame that names
        // its own sender destination is authoritative — adopt it and drop the
        // stale link mapping.
        const old = existing.destinationHash.toLowerCase();
        console.log(
          '[GCall] peer dest updated room=%s old=%s new=%s',
          roomId.slice(0, 12),
          old.slice(0, 8),
          hash.slice(0, 8)
        );
        existing.destinationHash = hash;
        establishedLinkIdByPeer.delete(old);
      }
    } else {
      byAddr.set(hash, { address: '', destinationHash: hash });
    }
    void openAudioLinkForPeer(hash);
  };

  const peerDestForRoom = (roomId: string, toAddress: string): string | null => {
    const byAddr = gcPeersByRoom.get(roomId);
    const peer = byAddr?.get(toAddress);
    if (peer?.destinationHash) return peer.destinationHash.toLowerCase();
    // DM fallback: single peer in the room.
    if (byAddr && byAddr.size === 1) {
      const only = [...byAddr.values()][0];
      return only?.destinationHash?.toLowerCase() ?? null;
    }
    return null;
  };

  const emitGcKey = (key: GcKeyDecoded): void => {
    emitGc('gcall:key', {
      roomId: key.roomId,
      recipientAddress: key.toAddress,
      fromAddress: key.fromAddress,
      fromPublicKey: key.fromPublicKey,
      encryptedKey: key.encryptedKey,
      timestamp: key.timestamp,
      keyMessageVersion: key.keyMessageVersion,
      callSessionId: key.callSessionId,
      mediaSessionGeneration: key.mediaSessionGeneration,
      keyCommitment: key.keyCommitment,
      verified: true,
      deliveryKind: 'live',
    });
  };

  const emitGcKeyRequest = (req: GcKeyRequestDecoded): void => {
    emitGc('gcall:key-request', {
      roomId: req.roomId,
      toAddress: req.toAddress,
      fromAddress: req.fromAddress,
      fromPublicKey: req.fromPublicKey,
      callSessionId: req.callSessionId,
      mediaSessionGeneration: req.mediaSessionGeneration,
      keyMessageVersion: req.keyMessageVersion,
      verified: true,
    });
  };

  const ingestFragment = async (
    wire: Record<string, unknown>,
    kind: 'GK' | 'GQ'
  ): Promise<void> => {
    const k0 = kind === 'GK' ? 'GK0' : 'GQ0';
    const k1 = kind === 'GK' ? 'GK1' : 'GQ1';
    const store = kind === 'GK' ? gkFragments : gqFragments;
    const now = Date.now();
    for (const [z, buf] of [...store]) {
      if (buf.expiresAt <= now) store.delete(z);
    }
    const meta = parseFragmentMeta(wire, k0);
    if (meta) {
      const existing = store.get(meta.z);
      store.set(meta.z, {
        meta,
        parts: existing?.parts ?? new Map(),
        expiresAt: now + 15_000,
      });
    } else {
      const part = parseFragmentPart(wire, k1);
      if (!part) return;
      let buf = store.get(part.z);
      if (!buf) {
        buf = { meta: { roomId: part.R, z: part.z, n: part.n, f: 0 }, parts: new Map(), expiresAt: now + 15_000 };
        store.set(part.z, buf);
      }
      buf.parts.set(part.x, part.p);
    }
    const buf = store.get(meta?.z ?? parseFragmentPart(wire, k1)?.z ?? '');
    if (!buf) return;
    console.log(
      '[GCall] %s frag z=%s parts=%d/%d',
      kind,
      buf.meta.z.slice(0, 8),
      buf.parts.size,
      buf.meta.n || 0
    );
    if (buf.meta.f <= 0 || buf.parts.size < buf.meta.n) return;
    const json = await reassembleBody(buf.meta.n, buf.meta.f, buf.meta.z, buf.parts);
    store.delete(buf.meta.z);
    if (!json) {
      console.warn('[GCall] %s reassembly FAILED z=%s', kind, buf.meta.z.slice(0, 8));
      return;
    }
    console.log('[GCall] %s reassembled OK z=%s', kind, buf.meta.z.slice(0, 8));
    if (kind === 'GK') {
      const key = decodeKeyBody(buf.meta.roomId, json);
      if (key && (gcLocalAddresses.size === 0 || gcLocalAddresses.has(key.toAddress))) {
        emitGcKey(key);
      }
    } else {
      const req = decodeKeyRequestBody(buf.meta.roomId, json);
      if (req && (gcLocalAddresses.size === 0 || gcLocalAddresses.has(req.toAddress))) {
        emitGcKeyRequest(req);
      }
    }
  };

  const handleGroupCallMessage = async (
    payload: Record<string, unknown>
  ): Promise<void> => {
    const wire = asObject(payload.wire);
    if (!wire) return;
    if (typeof wire.X === 'string' && seenGcOverlayId(wire.X)) return;
    const peerPresenceHash = (asString(payload.peerPresenceHash) ?? '').toLowerCase();
    const t = asString(wire.t);
    // Learn the Hub's inbound RNS audio link for this room so we can reply with
    // link-auth over it (see inboundAudioLinkIdByRoom).
    const inLinkId = asString(payload.linkId);
    const inRoom = asString(wire.R);
    if (inLinkId && inRoom) {
      inboundAudioLinkIdByRoom.set(inRoom, inLinkId);
      // When mobile is the CALLER, the Hub's overlay GJ (which carries its audio
      // destination) often never arrives — but its link-control frames (GAC etc.)
      // do, and they carry the Hub's dest in senderDestinationHash. Learn it here
      // so the peer becomes routable and link-auth can ride this link. Without
      // this, peerDest stays empty → sendControlFramesOverLinks bails → no
      // link-auth is ever sent and readiness times out with establishedLinks=0.
      const explicitLinkDest =
        asString(payload.senderDestinationHash) ||
        asString(payload.peerDestinationHash) ||
        '';
      const learnedLinkDest = explicitLinkDest || peerPresenceHash || '';
      if (learnedLinkDest) {
        // Frames that name their sender's destination are authoritative and may
        // replace a stale destination from a previous call to the same room.
        noteDmPeerDestination(inRoom, learnedLinkDest, !!explicitLinkDest);
      }
      // Kick off (idempotent) link-auth over this newly-known link so the Hub
      // verifies us and flips from "connecting" to connected. No-op if we never
      // joined this room (gcJoinWireByRoom empty).
      startLinkAuthForRoom(inRoom);
    }
    if (t && t !== 'GJ' && t !== 'GI') {
      console.log(
        '[GCall] rx wire t=%s src=%s room=%s',
        t,
        inLinkId ? 'audio-link' : 'overlay',
        (asString(wire.R) ?? '').slice(0, 18)
      );
    }
    if (t === 'GJ') {
      const join = decodeJoinWire(wire);
      if (!join) return;
      if (!gcRooms.has(join.roomId)) return; // not a room we're in
      recordPeerFromJoin(
        join.roomId,
        {
          address: join.fromAddress,
          destinationHash: join.reticulumDestinationHash,
          identityPublicKeyBase64: join.reticulumIdentityPublicKeyBase64,
        },
        peerPresenceHash
      );
      emitGc('gcall:participant-joined', {
        roomId: join.roomId,
        chatId: join.chatId,
        address: join.fromAddress,
        publicKey: join.fromPublicKey,
        timestamp: join.timestamp,
        ...(typeof join.joinGeneration === 'number'
          ? { joinGeneration: join.joinGeneration }
          : {}),
      });
      return;
    }
    if (t === 'GI') {
      const d = asString(wire.d)?.toLowerCase();
      const rk = asString(wire.rk);
      if (d && rk) void registerPeerIdentity(peerPresenceHash || d, rk);
      return;
    }
    if (t === 'GK') {
      const key = decodeKeyWireSingle(wire);
      if (key && (gcLocalAddresses.size === 0 || gcLocalAddresses.has(key.toAddress))) {
        emitGcKey(key);
      }
      return;
    }
    if (t === 'GQ') {
      const req = decodeKeyRequestWireSingle(wire);
      if (req && (gcLocalAddresses.size === 0 || gcLocalAddresses.has(req.toAddress))) {
        emitGcKeyRequest(req);
      }
      return;
    }
    if (t === 'GK0' || t === 'GK1') {
      await ingestFragment(wire, 'GK');
      return;
    }
    if (t === 'GQ0' || t === 'GQ1') {
      await ingestFragment(wire, 'GQ');
      return;
    }
    // GL / GH / GT etc.: not needed for DM media.
  };

  const handleGroupAudioPacket = (payload: Record<string, unknown>): void => {
    const roomId = asString(payload.roomId) ?? '';
    const dataB64 = asString(payload.data);
    const inLinkId = asString(payload.linkId);
    if (inLinkId && roomId) inboundAudioLinkIdByRoom.set(roomId, inLinkId);
    // Learn the peer's Reticulum AUDIO destination from EVERY inbound frame —
    // including link-control frames (the Hub sends only key-requests over the
    // link until it has the key, so if we only learned the dest from raw audio
    // the caller could never open an outbound link, leaving establishedLinks=0
    // and timing out media readiness). This opens our link back to the right
    // audio dest (which differs from the presence hash).
    const explicitDestEarly = asString(payload.peerDestinationHash) || '';
    const learnedDestEarly =
      explicitDestEarly || asString(payload.peerPresenceHash) || '';
    if (roomId && learnedDestEarly) {
      noteDmPeerDestination(roomId, learnedDestEarly, !!explicitDestEarly);
    }
    if (!dataB64) return;
    let bytes: Uint8Array;
    try {
      bytes = base64ToUint8(dataB64);
    } catch {
      return;
    }
    // The Hub delivers GK/GQ control frames over the audio link as a link-control
    // wire: the bridge unwraps the QGAU envelope and hands us the inner payload,
    // which is either bare JSON or `QGCCTL1\0` + JSON (decodeGcLinkControlWire on
    // desktop). Detect both, strip the magic, and reroute to the control handler
    // instead of treating it as (undecodable) audio.
    let jsonBytes: Uint8Array | null = null;
    if (bytes.length > 1 && bytes[0] === 0x7b /* '{' */) {
      jsonBytes = bytes;
    } else if (
      bytes.length > GC_LINK_CONTROL_MAGIC.length &&
      GC_LINK_CONTROL_MAGIC.every((b, i) => bytes[i] === b)
    ) {
      jsonBytes = bytes.subarray(GC_LINK_CONTROL_MAGIC.length);
    }
    if (jsonBytes) {
      try {
        const obj = JSON.parse(new TextDecoder().decode(jsonBytes));
        if (obj && isGroupCallReticulumWireType(obj.t)) {
          void handleGroupCallMessage({
            wire: obj,
            senderDestinationHash: payload.peerDestinationHash,
            peerPresenceHash: payload.peerPresenceHash,
            linkId: payload.linkId,
          });
          return;
        }
      } catch {
        /* not JSON → real audio */
      }
    }
    // Learn the peer's Reticulum destination from the (reliable) audio data-plane
    // so readiness can pass and outbound audio can be routed even when the
    // overlay GJ never arrived.
    const explicitDest = asString(payload.peerDestinationHash) || '';
    const learnedDest =
      explicitDest || asString(payload.peerPresenceHash) || '';
    if (roomId && learnedDest) {
      noteDmPeerDestination(roomId, learnedDest, !!explicitDest);
    }
    emitGc('gcall:audio', {
      roomId,
      data: bytes,
      transport: asString(payload.linkId) ? 'link' : 'packet',
      peerPresenceHash: asString(payload.peerPresenceHash) ?? '',
      peerDestinationHash: asString(payload.peerDestinationHash) ?? '',
      bridgeReceivedAtWallMs: Number(payload.receivedAtWallMs) || Date.now(),
    });
  };

  window.groupCall = {
    setLocalAddresses: async (addresses: string[]) => {
      gcLocalAddresses.clear();
      for (const a of addresses) {
        if (typeof a === 'string' && a) gcLocalAddresses.add(a);
      }
      return { success: true };
    },
    join: async (
      roomId: string,
      chatId: string,
      fromAddress: string,
      signature: string,
      fromPublicKey: string,
      timestamp: number,
      reticulumDestinationHash: string,
      _topologyHint?: unknown,
      joinGeneration?: number,
      reticulumIdentityPublicKeyBase64?: string,
      joinRkSignature?: string
    ) => {
      try {
        await ensureBridgeStarted();
        const existing = gcRooms.get(roomId);
        const room: GcRoom = existing ?? {
          chatId,
          callSessionId: randomUuid(),
          mediaSessionGeneration: 1,
        };
        gcRooms.set(roomId, room);
        gcLocalAddresses.add(fromAddress);
        const isDm = roomId.startsWith('dmv:');
        // The DM room id is stable across calls (derived from the address
        // pair), so per-room link/peer state from a previous call is stale by
        // definition when a NEW call session starts: the inbound link is dead
        // and the peer's audio destination has likely rotated. Keeping them
        // makes key/audio sends ride dead routes. Drop them and re-learn from
        // this call's live frames.
        if (isDm && !existing) {
          inboundAudioLinkIdByRoom.delete(roomId);
          const byAddr = gcPeersByRoom.get(roomId);
          if (byAddr) {
            for (const [k, p] of [...byAddr]) {
              if (!p.address) {
                byAddr.delete(k);
              } else if (p.destinationHash) {
                establishedLinkIdByPeer.delete(p.destinationHash.toLowerCase());
                p.destinationHash = '';
              }
            }
          }
        }
        const wireChatId = compactDmVoiceJoinWireChatId(roomId, chatId);
        const gj = encodeJoinWire({
          roomId,
          chatId: wireChatId,
          fromAddress,
          fromPublicKey,
          signature,
          timestamp,
          reticulumDestinationHash,
          reticulumIdentityPublicKeyBase64,
          // DM joins are signed WITHOUT joinGeneration → omit it on the wire.
          ...(isDm ? {} : { joinGeneration }),
        });
        const messages: Record<string, unknown>[] = [gj];
        if (reticulumIdentityPublicKeyBase64 && joinRkSignature) {
          const gi = encodeJoinIdentityWire({
            fromAddress,
            signature: joinRkSignature,
            timestamp,
            reticulumDestinationHash,
            reticulumIdentityPublicKeyBase64,
            ...(isDm ? {} : { joinGeneration }),
          });
          if (gi) messages.push(gi);
        }
        // Cache our signed join so it can be replayed as the Hub's required
        // QGCCTL1 audio-link auth, and start resending it over the audio path so
        // the Hub verifies our link and begins delivering GC_KEY over it.
        gcJoinWireByRoom.set(roomId, gj);
        startLinkAuthForRoom(roomId);
        await fanoutGroupCall(messages);
        return {
          success: true,
          callSessionId: room.callSessionId,
          mediaSessionGeneration: room.mediaSessionGeneration,
        };
      } catch (err) {
        console.error('[GCall] join failed:', err);
        return { success: false, error: String(err) };
      }
    },
    leave: async (
      roomId: string,
      fromAddress: string,
      signature: string,
      fromPublicKey: string,
      timestamp: number
    ) => {
      const peers = gcPeersByRoom.get(roomId);
      stopLinkAuthForRoom(roomId);
      gcRooms.delete(roomId);
      gcPeersByRoom.delete(roomId);
      gcJoinWireByRoom.delete(roomId);
      inboundAudioLinkIdByRoom.delete(roomId);
      try {
        await fanoutGroupCall([
          encodeLeaveWire({ roomId, fromAddress, fromPublicKey, signature, timestamp }),
        ]);
      } catch {
        /* ignore */
      }
      if (peers) {
        for (const peer of peers.values()) {
          const hash = peer.destinationHash.toLowerCase();
          establishedLinkIdByPeer.delete(hash);
          try {
            await Reticulum.presenceCommand({
              action: 'close_group_audio_link',
              payload: { peerPresenceHash: hash },
            });
          } catch {
            /* ignore */
          }
        }
      }
      return { success: true };
    },
    sendKey: async (
      roomId: string,
      toAddress: string,
      encryptedKey: string,
      fromAddress: string,
      signature: string,
      fromPublicKey: string,
      timestamp: number,
      meta: {
        keyMessageVersion: number;
        callSessionId: string;
        mediaSessionGeneration: number;
        keyCommitment: string;
        encryptedKeyDigest: string;
      }
    ) => {
      noteDmPeerAddress(roomId, toAddress);
      try {
        const frames = await encodeKeyWire({
          type: 'GC_KEY',
          roomId,
          toAddress,
          fromAddress,
          fromPublicKey,
          encryptedKey,
          keyMessageVersion: meta.keyMessageVersion,
          callSessionId: meta.callSessionId,
          mediaSessionGeneration: meta.mediaSessionGeneration,
          keyCommitment: meta.keyCommitment,
          encryptedKeyDigest: meta.encryptedKeyDigest,
          signature,
          timestamp,
        });
        // The Hub accepts GC_KEY ONLY over the RNS audio link as a QGCCTL1
        // link-control frame (never the overlay), so ride the verified link
        // first. Keep the direct/fanout overlay paths as best-effort fallbacks.
        await sendControlFramesOverLinks(roomId, frames);
        const peerDest = peerDestForRoom(roomId, toAddress);
        if (peerDest) await sendGroupCallDirect(peerDest, frames);
        await fanoutGroupCall(frames);
        return { success: true };
      } catch (err) {
        console.error('[GCall] sendKey failed:', err);
        return { success: false, error: String(err) };
      }
    },
    sendKeyRequest: async (
      roomId: string,
      toAddress: string,
      fromAddress: string,
      signature: string,
      fromPublicKey: string,
      timestamp: number,
      callSessionId: string,
      mediaSessionGeneration: number
    ) => {
      noteDmPeerAddress(roomId, toAddress);
      try {
        const frames = await encodeKeyRequestWire({
          type: 'GC_KEY_REQUEST',
          roomId,
          toAddress,
          fromAddress,
          fromPublicKey,
          callSessionId,
          mediaSessionGeneration,
          keyMessageVersion: 3,
          signature,
          timestamp,
        });
        // Mirror the Hub: GC_KEY_REQUEST also rides the link-control path.
        await sendControlFramesOverLinks(roomId, frames);
        const peerDest = peerDestForRoom(roomId, toAddress);
        if (peerDest) await sendGroupCallDirect(peerDest, frames);
        await fanoutGroupCall(frames);
        return { success: true };
      } catch (err) {
        console.error('[GCall] sendKeyRequest failed:', err);
        return { success: false, error: String(err) };
      }
    },
    sendAudio: async (roomId: string, toAddress: string, data: Uint8Array) => {
      const peerDest = peerDestForRoom(roomId, toAddress);
      if (!peerDest) return { sent: 0, reason: 'no_peer' };
      // Ride a real established audio link so our audio is on a verified link
      // (the Hub drops audio from an unverified link / the data-plane). The
      // peer's AUDIO reticulum dest often differs from its presence hash, so
      // fall back to ANY established link for the call, then the inbound link.
      const candidates = candidateLinkIdsForRoom(roomId);
      // Prefer the Hub's INBOUND link — the one its GAC/link-control arrives on
      // and the one we send link-auth over, so the Hub verifies it. RNS links
      // are bidirectional, so sending audio back over that same link lands on
      // the link the Hub associates with us. Sending over our own separately
      // established link (establishedLinkIdByPeer) lands the audio on a link the
      // Hub never verified → it drops it as unverified and stays "connecting".
      const linkId =
        inboundAudioLinkIdByRoom.get(roomId) ||
        establishedLinkIdByPeer.get(peerDest) ||
        candidates[0] ||
        '';
      try {
        await Reticulum.presenceCommand({
          action: 'send_group_audio',
          payload: {
            linkId,
            roomId,
            peerPresenceHash: peerDest,
            peerDestinationHash: peerDest,
            receivedAtWallMs: Date.now(),
            data: uint8ToBase64(data),
          },
        });
        return { sent: 1 };
      } catch (err) {
        return { sent: 0, reason: String(err) };
      }
    },
    getRoomParticipants: async (roomId: string) => {
      const byAddr = gcPeersByRoom.get(roomId);
      if (!byAddr) return [];
      return [...byAddr.values()]
        .filter((p) => !!p.address)
        .map((p) => ({ address: p.address }));
    },
    getLinkStats: async (roomId: string) => {
      const byAddr = gcPeersByRoom.get(roomId);
      if (!byAddr) {
        return { success: true, stats: { establishedLinks: 0, participants: 0 } };
      }
      let established = 0;
      let routable = 0;
      for (const peer of byAddr.values()) {
        const hash = peer.destinationHash?.toLowerCase();
        if (hash && DEST_HASH_RE.test(hash)) {
          routable += 1;
          if (establishedLinkIdByPeer.has(hash)) established += 1;
        }
      }
      // On mobile, audio rides the overlay/packet path keyed by the peer's
      // Reticulum destination hash (learned from its GJ). A dedicated RNS link
      // is an optimization, not a precondition for sending audio — so treat a
      // known, routable peer destination as a "ready route". Without this the
      // shared DM readiness gate (which requires establishedLinks > 0) always
      // false-times-out at 12s and the call drops at ~14s with no audio.
      const establishedLinks = established > 0 ? established : routable;
      return {
        success: true,
        stats: { establishedLinks, participants: byAddr.size },
      };
    },
    requestPeerMediaRecovery: async (
      roomId: string,
      toAddress: string,
      _reason?: string
    ) => {
      // Record the DM peer address up-front (the overlay GJ may never arrive),
      // so the readiness gate can recognize the peer once its destination is
      // learned from the inbound audio data-plane.
      noteDmPeerAddress(roomId, toAddress);
      const peerDest = peerDestForRoom(roomId, toAddress);
      if (peerDest) {
        await openAudioLinkForPeer(peerDest);
        // Ensure link-auth is running for this room (no-op if already started).
        startLinkAuthForRoom(roomId);
        void sendLinkAuthForRoom(roomId);
      }
      return { success: true };
    },
    reportTransportHealth: async (_roomId: string, _peers: string[]) => {
      return { success: true };
    },
    onEvent: (cb: (event: string, payload: unknown) => void) => {
      gcEventCbs.add(cb);
      return () => gcEventCbs.delete(cb);
    },
  } as unknown as Window['groupCall'];

  // window.audioSurface — in-WebView WebCodecs/AudioWorklet duplex engine that
  // rides on the window.groupCall transport above (installed only when the
  // WebView supports WebCodecs; otherwise the call stays connected but silent).
  installMobileAudioSurface();

  // p2pHealth only flips to 'good' once the receiving-peer set has been stable
  // for 30 s, so republish on a tighter cadence than the lease sweep below or
  // the call buttons stay disabled far longer than they need to. Once settled
  // (or the screen is off) a slower tick is enough — visibilitychange below
  // snaps back to fresh numbers the moment the user looks at the app.
  let statusRefreshTimer: ReturnType<typeof setInterval> | null = null;
  const armStatusRefresh = (): void => {
    if (statusRefreshTimer != null) {
      window.clearInterval(statusRefreshTimer);
      statusRefreshTimer = null;
    }
    if (typeof document !== 'undefined' && document.hidden) return;
    const settled =
      receivingSinceMs != null &&
      Date.now() - receivingSinceMs >= P2P_HEALTH_RECEIVING_STABLE_MS;
    statusRefreshTimer = window.setInterval(
      refreshMobileStatus,
      settled ? 15_000 : 5_000
    );
  };
  armStatusRefresh();

  // Android throttles WebView timers while backgrounded, so after a wake the
  // bridge can be running on a neighbour list the sweep below won't refresh for
  // another 20 s. Chat subscription fanouts fail outright with no route in that
  // window, so re-sync the overlay as soon as the app is in front again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshMobileStatus();
      if (bridgeReady) void pushOverlaySync();
    }
    armStatusRefresh();
  });

  // Keep the bridge's neighbour leases warm (90 s grace) and prune expired
  // online entries so the UI doesn't show stale peers. A really hidden
  // WebView is about to be frozen; skip the work, Python keeps the last
  // neighbor set. Keep-alive (GO off screen, page still visible to Chromium)
  // keeps it running so neighbours found in the background are synced.
  setInterval(() => {
    if (isPageReallyHidden()) return;
    if (bridgeReady && neighborHashes.size > 0) void pushOverlaySync();
    refreshMobileStatus();
    armStatusRefresh();
    // Expired devices: tell listeners, or the account keeps its last dot
    // (often Idle) until the app restarts.
    emitAggregates(pruneExpiredSessions());
  }, 20_000);
}
