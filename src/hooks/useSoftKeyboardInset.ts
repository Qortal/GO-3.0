import { useSyncExternalStore } from 'react';

/**
 * Tracks how much of the viewport the soft keyboard is currently covering, and
 * remembers the last height it had.
 *
 * The remembered height is what lets an in-page panel (the emoji keyboard) take
 * the keyboard's place: we dismiss the keyboard and reserve exactly the space it
 * was using, so the composer never moves.
 *
 * Measured through the VisualViewport API against the tallest viewport we have
 * seen, the same way {@link useSoftKeyboardOpen} detects the keyboard.
 */

const STORAGE_KEY = 'qortal.softKeyboardHeight';
const MIN_KEYBOARD_PX = 160;
const MAX_KEYBOARD_PX = 520;
const FALLBACK_KEYBOARD_PX = 300;

let baselineHeight = 0;
let currentInset = 0;
let lastKeyboardHeight = 0;
let started = false;

const listeners = new Set<() => void>();

function readStoredHeight(): number {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    if (stored >= MIN_KEYBOARD_PX && stored <= MAX_KEYBOARD_PX) return stored;
  } catch {
    /* private mode / no storage */
  }
  return FALLBACK_KEYBOARD_PX;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  lastKeyboardHeight = readStoredHeight();

  const viewport = window.visualViewport;
  if (!viewport) return;
  baselineHeight = viewport.height;

  const update = () => {
    if (viewport.height > baselineHeight) baselineHeight = viewport.height;
    const inset = Math.max(0, Math.round(baselineHeight - viewport.height));
    const next = inset > MIN_KEYBOARD_PX ? inset : 0;
    if (next === currentInset) return;
    currentInset = next;
    if (next > 0 && next <= MAX_KEYBOARD_PX && next !== lastKeyboardHeight) {
      lastKeyboardHeight = next;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* private mode / no storage */
      }
    }
    notify();
  };

  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Pixels the keyboard is currently covering (0 when it is closed). */
export function getSoftKeyboardInset(): number {
  start();
  return currentInset;
}

/**
 * Height the keyboard had the last time it was open — or a sensible default on
 * a device where it has not been seen yet.
 */
export function getLastSoftKeyboardHeight(): number {
  start();
  return lastKeyboardHeight || FALLBACK_KEYBOARD_PX;
}

/**
 * Resolves once the keyboard has finished retracting, so the caller can reserve
 * its space without the two overlapping. Falls back to a timeout on platforms
 * that never report the resize.
 */
export function waitForSoftKeyboardClose(timeoutMs = 400): Promise<void> {
  start();
  if (currentInset === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unsubscribe();
      window.clearTimeout(timer);
      resolve();
    };
    const unsubscribe = subscribe(() => {
      if (currentInset === 0) finish();
    });
    const timer = window.setTimeout(finish, timeoutMs);
  });
}

/** Pixels the keyboard is covering right now, re-rendering as it animates. */
export function useSoftKeyboardInset(): number {
  return useSyncExternalStore(subscribe, getSoftKeyboardInset, () => 0);
}

/** Last known keyboard height, re-rendering when the device reports a new one. */
export function useLastSoftKeyboardHeight(): number {
  return useSyncExternalStore(
    subscribe,
    getLastSoftKeyboardHeight,
    () => FALLBACK_KEYBOARD_PX
  );
}

export default useLastSoftKeyboardHeight;
