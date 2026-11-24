/**
 * GO: an incoming call wakes the screen and brings GO over the lock screen,
 * so Android reports the page visible although nobody is looking at it. If
 * the call is then missed, whatever GO shows (often the caller's DM) would be
 * marked read: the missed call and any unread messages vanish from the
 * unread counts and the bell without the user ever seeing them.
 *
 * A ring that starts while GO is off screen (or that woke it a moment ago)
 * marks the page "unattended" until the user touches the screen or presses
 * a key, or GO goes off screen again. usePageVisible reports false while it
 * is unattended, so read marking waits for a real look. Answering or
 * declining is a touch, so normal calls are unaffected.
 *
 * Desktop and web never set the flag (isCapacitor is false there).
 */
import { isCapacitor } from './platform';

/** A ring this soon after GO came on screen counts as having woken it. */
export const RING_WAKE_WINDOW_MS = 5_000;

let unattended = false;
let lastBecameVisibleAt = 0;
let ringNotedAt = 0;
let installed = false;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* a listener's error must not stop the others */
    }
  }
};

const setUnattended = (next: boolean) => {
  if (unattended === next) return;
  unattended = next;
  notify();
};

const onUserInput = () => setUnattended(false);

const onVisibilityChange = () => {
  if (document.hidden) {
    setUnattended(false);
    return;
  }
  const now = Date.now();
  lastBecameVisibleAt = now;
  // A ring noted while GO stayed off screen, then GO opened well after it:
  // the user opened GO, not the ring.
  if (unattended && now - ringNotedAt > RING_WAKE_WINDOW_MS) {
    setUnattended(false);
  }
};

function install(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  if (!document.hidden) lastBecameVisibleAt = Date.now();
  document.addEventListener('visibilitychange', onVisibilityChange);
  // Capture phase: a touch counts even if a component stops propagation.
  for (const type of ['pointerdown', 'touchstart', 'keydown'] as const) {
    window.addEventListener(type, onUserInput, {
      capture: true,
      passive: true,
    });
  }
}

/** Call when an incoming call starts ringing on this device. */
export function noteIncomingRing(now: number = Date.now()): void {
  if (!isCapacitor() || typeof document === 'undefined') return;
  install();
  if (document.hidden || now - lastBecameVisibleAt <= RING_WAKE_WINDOW_MS) {
    ringNotedAt = now;
    setUnattended(true);
  }
}

/**
 * The user acted on the call (answered or declined, also from the native
 * notification, which is not a touch on the page): they are looking.
 */
export function noteUserAttention(): void {
  setUnattended(false);
}

/** True while a ring woke GO and nobody has touched it since. */
export function isRingWakeUnattended(): boolean {
  return unattended;
}

export function subscribeRingWakeAttention(listener: () => void): () => void {
  install();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only. */
export function resetRingWakeAttentionForTests(): void {
  unattended = false;
  lastBecameVisibleAt = 0;
  ringNotedAt = 0;
  if (installed && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    for (const type of ['pointerdown', 'touchstart', 'keydown'] as const) {
      window.removeEventListener(type, onUserInput, { capture: true });
    }
  }
  installed = false;
  listeners.clear();
}
