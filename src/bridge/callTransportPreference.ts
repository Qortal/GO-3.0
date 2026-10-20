/**
 * GO call transport preference: how 1:1 call audio may travel.
 *
 *  - 'webrtc' (default): WebRTC first, protected. GO never sends host or
 *    private-network ICE candidates and never runs ICE checks that would show
 *    them; the peer can see GO's public IPv4 (NAT) address
 *    (see webrtcPrivacy.ts). Reticulum stays armed as the automatic fallback.
 *  - 'reticulum': "Private calls". No WebRTC at all: the audio surface refuses
 *    `start-direct-voice-rtc`, the privacy guard gathers and sends no ICE
 *    candidates, and the bridge should not expose `groupCall.sendRtcSignal`
 *    (so useVoiceCall never prefers WebRTC and Hub peers stay on Reticulum).
 *
 * A change applies to calls (peer connections) that start afterwards; a
 * WebRTC leg that is already up stays until hang-up.
 *
 * GO-only state. Persisted per device in localStorage; every storage access is
 * wrapped because it can throw (private mode, blocked storage, previews).
 */

import { useSyncExternalStore } from 'react';

export type CallTransportPreference = 'webrtc' | 'reticulum';

export const CALL_TRANSPORT_PREFERENCE_KEY = 'go.calls.transport';
export const DEFAULT_CALL_TRANSPORT_PREFERENCE: CallTransportPreference =
  'webrtc';

type Listener = (preference: CallTransportPreference) => void;

const listeners = new Set<Listener>();
let cached: CallTransportPreference | null = null;
let storageListenerInstalled = false;

export function isCallTransportPreference(
  value: unknown
): value is CallTransportPreference {
  return value === 'webrtc' || value === 'reticulum';
}

function readStored(): CallTransportPreference | null {
  try {
    const raw = globalThis.localStorage?.getItem(CALL_TRANSPORT_PREFERENCE_KEY);
    return isCallTransportPreference(raw) ? raw : null;
  } catch {
    return null;
  }
}

function notify(preference: CallTransportPreference): void {
  for (const listener of [...listeners]) {
    try {
      listener(preference);
    } catch (error) {
      console.warn('[callTransportPreference] listener failed', error);
    }
  }
}

function ensureStorageListener(): void {
  if (storageListenerInstalled || typeof window === 'undefined') return;
  storageListenerInstalled = true;
  try {
    window.addEventListener('storage', (event: StorageEvent) => {
      if (event.key !== null && event.key !== CALL_TRANSPORT_PREFERENCE_KEY) {
        return;
      }
      const next = readStored() ?? DEFAULT_CALL_TRANSPORT_PREFERENCE;
      if (next === cached) return;
      cached = next;
      notify(next);
    });
  } catch {
    /* no window events (worker / test realm) */
  }
}

/** Current preference; 'webrtc' unless the user picked "Private calls". */
export function getCallTransportPreference(): CallTransportPreference {
  if (cached === null) {
    cached = readStored() ?? DEFAULT_CALL_TRANSPORT_PREFERENCE;
  }
  return cached;
}

/** True unless the user chose Reticulum-only ("Private calls"). */
export function isWebRtcCallTransportAllowed(): boolean {
  return getCallTransportPreference() === 'webrtc';
}

/**
 * Persist a new preference and notify subscribers. Unknown values are ignored.
 * The in-memory value changes even when storage is unavailable, so the choice
 * still holds for the rest of the session.
 */
export function setCallTransportPreference(
  value: CallTransportPreference
): void {
  if (!isCallTransportPreference(value)) return;
  // Read before writing: an empty cache would otherwise load the new value.
  const previous = getCallTransportPreference();
  try {
    globalThis.localStorage?.setItem(CALL_TRANSPORT_PREFERENCE_KEY, value);
  } catch {
    /* storage blocked: keep the in-memory choice */
  }
  cached = value;
  if (previous !== value) notify(value);
}

/** Subscribe to preference changes. Returns an unsubscribe function. */
export function subscribeCallTransportPreference(
  listener: Listener
): () => void {
  ensureStorageListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Alias kept for callers written against the task wording `subscribe(cb)`. */
export const subscribe = subscribeCallTransportPreference;

/** React binding for settings UI: `[preference, setPreference]`. */
export function useCallTransportPreference(): [
  CallTransportPreference,
  (value: CallTransportPreference) => void,
] {
  const preference = useSyncExternalStore(
    subscribeCallTransportPreference,
    getCallTransportPreference,
    () => DEFAULT_CALL_TRANSPORT_PREFERENCE
  );
  return [preference, setCallTransportPreference];
}

/** Test-only: forget the cached value and all listeners. */
export function __resetCallTransportPreferenceForTests(): void {
  cached = null;
  listeners.clear();
}
