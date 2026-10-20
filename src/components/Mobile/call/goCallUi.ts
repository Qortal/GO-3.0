/**
 * Shared bits of GO's phone call UI: when it is used, its layers, the
 * "call screen open" flag and the store the in-bar strip slot reads.
 */
import { useSyncExternalStore } from 'react';
import { atom } from 'jotai';
import { isCapacitor } from '../../../utils/platform';
import { APP_LOCK_SCREEN_Z_INDEX } from '../../../lib/appLock';
import { BACK_PRIORITY } from '../../../utils/androidBack';
import type { MobileCallKind, MobileCallView } from './callUiModel';

/**
 * GO's own call UI replaces the Hub's call widgets on the Android app only.
 * isCapacitor() is false on Electron (Capacitor.isNativePlatform() is not),
 * so desktop keeps every Hub call widget exactly as before.
 */
export const isGoCallUi = (): boolean => isCapacitor();

/**
 * Layers. The call screen sits over the top bar (1250), the tab bar, the
 * immersive pill and the Tabs grid (2001), under dialogs (MUI modals are
 * forced to 50000). The ring screen goes over everything GO draws (dialogs,
 * the Q-Wallets overlay, the PDF / file / image viewers at 990000000, the
 * avatar cropper at 2147483000): a call must never ring behind something.
 *
 * Over the phone's own lock screen (Android keyguard) only the call may be
 * seen, so the call screen and the cover under it go up there too. All of
 * these stay under GO's own lock screen (APP_LOCK_SCREEN_Z_INDEX); while GO
 * is locked the call is drawn inside the lock layer, just above it.
 */
export const CALL_SCREEN_Z = 2050;
export const CALL_FLOATING_STRIP_Z = 1260;
export const CALL_KEYGUARD_COVER_Z = APP_LOCK_SCREEN_Z_INDEX - 60;
export const CALL_SCREEN_KEYGUARD_Z = APP_LOCK_SCREEN_Z_INDEX - 50;
export const CALL_INCOMING_Z = APP_LOCK_SCREEN_Z_INDEX - 40;
export const CALL_SCREEN_LOCKED_Z = APP_LOCK_SCREEN_Z_INDEX + 10;
export const CALL_INCOMING_LOCKED_Z = APP_LOCK_SCREEN_Z_INDEX + 20;

/**
 * Android back. The ring screen is drawn over everything, so it goes first
 * (above the Q-App approval, BACK_PRIORITY.call + 10, which may sit under
 * it). Over the phone's lock, back takes GO off screen (the lock shows)
 * before anything hidden under the call can react; a call sheet open there
 * still closes first.
 */
export const CALL_RING_BACK_PRIORITY = BACK_PRIORITY.call + 30;
export const CALL_SHEET_LOCKED_BACK_PRIORITY = BACK_PRIORITY.call + 25;
export const CALL_KEYGUARD_BACK_PRIORITY = BACK_PRIORITY.call + 20;
export const CALL_SHEET_BACK_PRIORITY = BACK_PRIORITY.call + 5;

/**
 * Android keeps GO over the phone's lock a little after a ring or call
 * (CallSession: 3 s after a ring ends, up to 15 s after Accept until the page
 * starts the call). The cover stays that long after the last call surface.
 */
export const KEYGUARD_COVER_GRACE_MS = 16_000;

// ---- Call layer -------------------------------------------------------------

let callLayerContainer: HTMLDivElement | null = null;

/**
 * The body-level element the call views are portalled into (when GO's own
 * lock is not up). One fixed element, so the phone locking or unlocking
 * during a call never remounts the call screen; it is also what stays usable
 * while the rest of the page is made inert over the phone's lock.
 */
export function getGoCallLayerContainer(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (!callLayerContainer) {
    callLayerContainer = document.createElement('div');
    callLayerContainer.setAttribute('data-go-call-layer-root', '');
  }
  if (!callLayerContainer.isConnected) {
    document.body.appendChild(callLayerContainer);
  }
  return callLayerContainer;
}

// ---- Back over GO's lock ----------------------------------------------------

let ringBackOverAppLock = false;

/** MobileCallRoot: the ring screen is up over GO's own lock. */
export function setGoCallRingOverAppLock(on: boolean): void {
  ringBackOverAppLock = on;
}

/**
 * True while the ring screen is shown over GO's own lock. GO's back-button
 * lock gate (useAppLock) can let back through then: the ring's handler runs
 * first and always takes it (it silences the ring), so nothing under the
 * lock reacts.
 */
export function goCallRingOverAppLock(): boolean {
  return ringBackOverAppLock;
}

/** The full call screen is up (not minimized to the strip). */
export const mobileCallScreenOpenAtom = atom(false);

// ---- Strip slot -------------------------------------------------------------
// The strip is best drawn in the top bar's own wrapper (App.tsx), where it
// takes room instead of covering headers. That wrapper sits outside the call
// providers, so MobileCallRoot publishes what the strip shows here and the
// slot renders it; with no slot mounted the root floats the strip instead.

export interface CallStripActions {
  open: () => void;
  toggleMute: () => void;
  hangUp: () => void;
}

export interface CallStripState {
  view: MobileCallView | null;
  actions: CallStripActions | null;
  /** The slot should show the strip now (root decides; e.g. not over the lock). */
  show: boolean;
}

let stripState: CallStripState = { view: null, actions: null, show: false };
let slotCount = 0;
let slotVisible = true;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((cb) => cb());

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function publishCallStrip(next: CallStripState): void {
  if (
    next.view === stripState.view &&
    next.actions === stripState.actions &&
    next.show === stripState.show
  ) {
    return;
  }
  stripState = next;
  notify();
}

export function useCallStripState(): CallStripState {
  return useSyncExternalStore(
    subscribe,
    () => stripState,
    () => stripState
  );
}

/** A slot is mounted in the top bar: the root does not float the strip. */
export function registerCallStripSlot(): () => void {
  slotCount += 1;
  notify();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    slotCount = Math.max(0, slotCount - 1);
    notify();
  };
}

export function useCallStripSlotMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => slotCount > 0,
    () => slotCount > 0
  );
}

/** The slot reports whether it is on screen (immersive bars slide away). */
export function setCallStripSlotVisible(visible: boolean): void {
  if (slotVisible === visible) return;
  slotVisible = visible;
  notify();
}

/** A slot is mounted and on screen, so the strip can live there. */
export function useCallStripSlotUsable(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => slotCount > 0 && slotVisible,
    () => slotCount > 0 && slotVisible
  );
}

/**
 * A call is up on this phone (dialling, joining, connected), read from what
 * MobileCallRoot publishes; false while only a ring is showing and after
 * "Call ended". For screens outside the call providers (Home settings).
 */
export function useGoCallInProgress(): boolean {
  return useGoCallInProgressKind() !== null;
}

const inProgressKind = (): MobileCallKind | null =>
  stripState.view && stripState.view.phase !== 'ended'
    ? stripState.view.kind
    : null;

/** Same as {@link useGoCallInProgress}, saying which kind of call is up. */
export function useGoCallInProgressKind(): MobileCallKind | null {
  return useSyncExternalStore(subscribe, inProgressKind, inProgressKind);
}

// ---- Relaying (group calls) -------------------------------------------------

/**
 * Whether this phone forwards other people's audio in `roomId`, as the
 * hosted Hub group-call manager sees it (Hub's own forward-recipient rule:
 * never in a 2-person room). GO's window.groupCall may offer it as
 * `isRelayingAudio(roomId)` (synchronous); null when it does not (desktop,
 * an older bridge, managers not loaded yet) so the caller can fall back.
 */
export function readHostedGroupRelaying(roomId: string): boolean | null {
  if (typeof window === 'undefined' || !roomId) return null;
  try {
    const api = (window as unknown as { groupCall?: Record<string, unknown> })
      .groupCall;
    const probe = api?.isRelayingAudio;
    if (typeof probe !== 'function') return null;
    const value = (probe as (id: string) => unknown).call(api, roomId);
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

/** Tests only. */
export function resetCallStripStoreForTests(): void {
  stripState = { view: null, actions: null, show: false };
  slotCount = 0;
  slotVisible = true;
  ringBackOverAppLock = false;
  notify();
}
