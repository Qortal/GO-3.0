import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

/**
 * GO's native call plumbing (android QortalCallPlugin / CallSession):
 * ringing notification, call notification with Mute / Hang up, the
 * microphone foreground service, keeping the page alive during a call,
 * showing GO over the lock screen only for a call.
 *
 * Use it through src/bridge/nativeCallSession.ts (no-op off GO).
 */

export type NativeCallAction =
  | 'accept'
  | 'decline'
  | 'hangup'
  | 'mute'
  | 'unmute'
  | 'open';

export type NativeCallActionEvent = {
  action: NativeCallAction;
  /** Empty when the notification had none (should not happen). */
  callId: string;
  /** 'notification' (button), 'launch' (GO opened by it), 'legacy-notification'. */
  source?: string;
  /** Epoch ms when the user tapped. */
  at?: number;
};

export type NativeRingState = {
  ringing: boolean;
  callId?: string;
  fromAddress?: string;
  name?: string;
  /** 'native' (seen while the page slept), 'page', 'legacy'. */
  source?: string;
  /** The tray notification with the ringtone is up: the page should not ring too. */
  posted?: boolean;
  /** Silenced by the power key (no ringtone). */
  silent?: boolean;
  /** The page has taken this ring up (showIncomingCall with its callId). */
  confirmed?: boolean;
  reason?: string;
};

export type NativeCallKind = 'dm' | 'group';

export type NativeCallPhase =
  | 'calling'
  | 'connecting'
  | 'joining'
  | 'connected';

/** Keys the page may translate for the native call notifications. */
export const NATIVE_CALL_STRING_KEYS = [
  'call_incoming_title',
  'call_incoming_text',
  'call_action_accept',
  'call_action_decline',
  'call_action_hang_up',
  'call_action_leave',
  'call_action_mute',
  'call_action_unmute',
  'call_status_calling',
  'call_status_connecting',
  'call_status_ongoing',
  'call_status_group',
  'call_status_muted',
  'call_unknown_caller',
] as const;

export type NativeCallStringKey = (typeof NATIVE_CALL_STRING_KEYS)[number];

export interface QortalCallPlugin {
  /**
   * A call dials / connects / runs (`active: true`, any number of updates)
   * or ended. Keeps the page alive and the CPU awake, makes the status
   * service a microphone foreground service with the call notification.
   * `micForeground` false = Android refused the microphone type (GO was off
   * screen); GO retries when it comes on screen ('callForegroundChanged').
   */
  setCallActive(options: {
    active: boolean;
    callId?: string;
    kind?: NativeCallKind;
    phase?: NativeCallPhase;
    peerName?: string;
    /** data:image/...;base64 only (the page fetched it). */
    avatarDataUrl?: string;
    muted?: boolean;
    /** Epoch ms the call connected (chronometer). */
    connectedAt?: number;
  }): Promise<{
    ok: boolean;
    active: boolean;
    micForeground: boolean | null;
    typeFlags: number;
  }>;

  /**
   * The page rings (or updates name / avatar). Native posts the ringing
   * notification only while GO is off screen, the screen is off or the
   * phone is locked; 'ringStateChanged' says when (posted).
   */
  showIncomingCall(options: {
    callId: string;
    fromAddress?: string;
    fromName?: string;
    avatarDataUrl?: string;
    kind?: NativeCallKind;
  }): Promise<{ ok: boolean }>;

  /** Stop the ringtone without declining (Android back on the ring screen). */
  silenceRing(options?: { callId?: string }): Promise<{ ok: boolean }>;

  /**
   * The ring ended. Pass the callId: without it only a ring the page
   * confirmed stops (a native ring the page has not seen yet survives).
   */
  cancelIncomingCall(options?: {
    callId?: string;
    reason?: string;
  }): Promise<{ ok: boolean }>;

  /** Addresses this signed-in page answers calls for ([] on logout). */
  setRingAddresses(options: {
    addresses: string[];
  }): Promise<{ ok: boolean; count: number }>;

  /** Last accept / decline / open / hangup (<= 60 s old), or {}. */
  getPendingCallAction(): Promise<Partial<NativeCallActionEvent>>;

  clearPendingCallAction(): Promise<{ ok: boolean }>;

  getRingState(): Promise<NativeRingState>;

  /** locked: lock screen up (GO may be over it); secure: PIN set; interactive: screen on. */
  isDeviceLocked(): Promise<{
    locked: boolean;
    secure: boolean;
    interactive: boolean;
  }>;

  /** Ask Android to unlock (PIN / fingerprint over GO). */
  requestUnlock(): Promise<{
    result: 'unlocked' | 'cancelled' | 'error' | 'not-locked' | 'unavailable';
  }>;

  /** Android 14+ may refuse the full-screen ring. */
  canUseFullScreenIntent(): Promise<{ allowed: boolean }>;

  /** Android's own switch for GO's full-screen notifications (Android 14+). */
  openFullScreenIntentSettings(): Promise<{ opened: boolean }>;

  /** GO's language for the call notifications (persisted). */
  setStrings(options: {
    strings: Partial<Record<NativeCallStringKey, string>>;
  }): Promise<{ ok: boolean; kept: number }>;

  /** Copy diagnostics. */
  getState(): Promise<Record<string, unknown>>;

  addListener(
    eventName: 'callAction',
    listenerFunc: (event: NativeCallActionEvent) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'ringStateChanged',
    listenerFunc: (event: NativeRingState) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'deviceLockChanged',
    listenerFunc: (event: { locked: boolean; interactive: boolean }) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'callForegroundChanged',
    listenerFunc: (event: {
      micForeground: boolean | null;
      typeFlags: number;
      callId: string;
    }) => void
  ): Promise<PluginListenerHandle>;
}

const QortalCall = registerPlugin<QortalCallPlugin>('QortalCall');

export { QortalCall };
