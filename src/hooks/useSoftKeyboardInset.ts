import { useSyncExternalStore } from 'react';
import {
  getGoLayout,
  getGoWindowMetrics,
  GO_WINDOW_METRICS_EVENT,
  isGoLayout,
  subscribeGoLayout,
  type GoDeviceOrientation,
} from '../layout/goLayout';

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
 *
 * On GO the baseline is the layout store's keyboard-proof stableHeight instead,
 * so a rotation, fold or split-screen resize never reads as a keyboard (see
 * startGo below).
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

// ---- GO -----------------------------------------------------------------
// Heights are remembered per device orientation: a landscape keyboard is far
// shorter, and one shared value let rotations poison it.

const GO_STORAGE_KEYS: Record<GoDeviceOrientation, string> = {
  portrait: `${STORAGE_KEY}.portrait`,
  landscape: `${STORAGE_KEY}.landscape`,
};
const GO_FALLBACK_PX: Record<GoDeviceOrientation, number> = {
  portrait: FALLBACK_KEYBOARD_PX,
  landscape: 200,
};
// Old single-key values above this were most likely written by a rotation
// (portrait height minus landscape height), not by a keyboard.
const GO_LEGACY_MAX_PX = 420;
// After a rotation or resize, the viewport and the store settle at different
// times; nothing measured in this window is trusted or remembered.
const GO_QUIET_MS = 700;
// Only remember a height that agrees with native's IME report.
const GO_IME_MATCH_PX = 32;

const goStored: Partial<Record<GoDeviceOrientation, number>> = {};
// Inset behind the same gate as currentInset but without the 160 px floor,
// for useSoftKeyboardOpen's own thresholds.
let goGatedInset = 0;
let goEpoch = 0;
let goQuietUntil = 0;
let goQuietTimer: ReturnType<typeof setTimeout> | null = null;

function readGoStoredHeights(): void {
  for (const o of ['portrait', 'landscape'] as const) {
    try {
      const stored = Number(window.localStorage.getItem(GO_STORAGE_KEYS[o]));
      if (stored >= MIN_KEYBOARD_PX && stored <= MAX_KEYBOARD_PX) {
        goStored[o] = stored;
      }
    } catch {
      /* private mode / no storage */
    }
  }
  if (goStored.portrait !== undefined) return;
  try {
    const legacy = Number(window.localStorage.getItem(STORAGE_KEY));
    if (legacy >= MIN_KEYBOARD_PX && legacy <= GO_LEGACY_MAX_PX) {
      goStored.portrait = legacy;
      window.localStorage.setItem(GO_STORAGE_KEYS.portrait, String(legacy));
    }
  } catch {
    /* private mode / no storage */
  }
}

function startGo(): void {
  readGoStoredHeights();

  const viewport = window.visualViewport;
  if (!viewport) return;
  goEpoch = getGoLayout().epoch;

  const update = () => {
    const layout = getGoLayout();
    // Mid-rotation the store can hold its old snapshot (up to 300 ms) while the
    // viewport is already new; measuring across the two reads a closed or a
    // window-sized keyboard. Keep the old values until it publishes, which
    // calls back here.
    if (
      layout.go &&
      getGoWindowMetrics() &&
      Math.abs(layout.width - Math.round(window.innerWidth)) > 1
    ) {
      return;
    }
    const now = Date.now();
    let wasOpen = currentInset > 0;
    if (layout.epoch !== goEpoch) {
      // New window shape: re-baseline, and let a keyboard that is really up
      // prove itself again.
      goEpoch = layout.epoch;
      goQuietUntil = now + GO_QUIET_MS;
      wasOpen = false;
      if (goQuietTimer !== null) clearTimeout(goQuietTimer);
      goQuietTimer = setTimeout(() => {
        goQuietTimer = null;
        update();
      }, GO_QUIET_MS + 16);
    }
    const quiet = now < goQuietUntil;
    const m = layout.nativeMetrics ? getGoWindowMetrics() : null;
    const raw = Math.max(0, Math.round(layout.stableHeight - viewport.height));
    // With native metrics the keyboard can only open once native reports an
    // IME; while it closes the inset follows the viewport down.
    const gateOpen = m ? m.ime >= MIN_KEYBOARD_PX || wasOpen : !quiet;
    const gated = gateOpen ? raw : 0;
    const next = gated > MIN_KEYBOARD_PX ? gated : 0;

    let changed = next !== currentInset || gated !== goGatedInset;
    currentInset = next;
    goGatedInset = gated;

    const o = layout.deviceOrientation;
    if (
      next > 0 &&
      !quiet &&
      next <= MAX_KEYBOARD_PX &&
      (!m || Math.abs(next - m.ime) <= GO_IME_MATCH_PX) &&
      goStored[o] !== next
    ) {
      goStored[o] = next;
      changed = true;
      try {
        window.localStorage.setItem(GO_STORAGE_KEYS[o], String(next));
      } catch {
        /* private mode / no storage */
      }
    }
    if (changed) notify();
  };

  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  window.addEventListener(GO_WINDOW_METRICS_EVENT, update);
  subscribeGoLayout(update);
}

function getGoLastKeyboardHeight(): number {
  const layout = getGoLayout();
  const o = layout.deviceOrientation;
  const height = goStored[o] ?? GO_FALLBACK_PX[o];
  // A short window cannot spare a full keyboard's height for the emoji panel.
  return layout.short
    ? Math.min(height, Math.round(layout.stableHeight * 0.5))
    : height;
}

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
  if (isGoLayout()) {
    startGo();
    return;
  }
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
  if (isGoLayout()) return getGoLastKeyboardHeight();
  return lastKeyboardHeight || FALLBACK_KEYBOARD_PX;
}

/**
 * GO only: the keyboard inset behind the same gate as
 * {@link getSoftKeyboardInset} but without its 160 px floor, so
 * useSoftKeyboardOpen can apply its own threshold. 0 off GO.
 */
export function getSoftKeyboardGatedInset(): number {
  start();
  return isGoLayout() ? goGatedInset : 0;
}

/** Subscribes to every change of the keyboard store. */
export function subscribeSoftKeyboard(listener: () => void): () => void {
  return subscribe(listener);
}

/** Pixels the keyboard is covering right now, re-rendering as it animates. */
export function useSoftKeyboardInset(): number {
  return useSyncExternalStore(subscribe, getSoftKeyboardInset, () => 0);
}

// On GO the height also depends on orientation and the short flag, which
// change without the keyboard moving.
function subscribeLastHeight(listener: () => void): () => void {
  const unsubscribe = subscribe(listener);
  const unsubscribeLayout = isGoLayout()
    ? subscribeGoLayout(listener)
    : undefined;
  return () => {
    unsubscribe();
    unsubscribeLayout?.();
  };
}

/** Last known keyboard height, re-rendering when the device reports a new one. */
export function useLastSoftKeyboardHeight(): number {
  return useSyncExternalStore(
    subscribeLastHeight,
    getLastSoftKeyboardHeight,
    () => FALLBACK_KEYBOARD_PX
  );
}
