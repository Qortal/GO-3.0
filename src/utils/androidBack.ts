import { useEffect, useRef } from 'react';
import { ANDROID_BACK_EVENT } from '../bridge/capacitorBridge';

/**
 * Centralized Android hardware-back dispatcher.
 *
 * The Capacitor bridge dispatches a cancelable `ANDROID_BACK_EVENT` on every
 * hardware back press and minimizes the app only if nobody consumes it. Raw
 * `addEventListener` listeners fire in registration order with no notion of
 * priority, which is fragile when several overlays are mounted at once
 * (settings dialog over a chat detail over the tab shell, etc.).
 *
 * This module layers a small priority registry on top of that event: handlers
 * registered with a higher priority run first, and the first handler that
 * returns `true` consumes the press (preventing the default minimize). Handlers
 * registered later at the same priority run before earlier ones, so the most
 * recently mounted overlay wins ties — which matches user expectation.
 */

/** Return `true` to consume the back press and stop propagation. */
export type AndroidBackHandler = () => boolean;

interface BackEntry {
  handler: AndroidBackHandler;
  priority: number;
  seq: number;
}

const entries: BackEntry[] = [];
let seqCounter = 0;
let listening = false;

/** Conventional priority bands so call sites stay readable. */
export const BACK_PRIORITY = {
  /** Active call / full-screen media surfaces. */
  call: 100,
  /** Modal dialogs (settings, request prompts). */
  dialog: 80,
  /** Slide-in overlays (tabs grid, drawers, minting). */
  overlay: 70,
  /** In-section detail views (open chat thread, forum thread). */
  detail: 40,
  /** Section-level toggles (groups <-> DMs). */
  section: 30,
  /** Top-level view mode (return to Home). */
  root: 10,
} as const;

function dispatch(ev: Event): void {
  if (entries.length === 0) return;
  const ordered = [...entries].sort(
    (a, b) => b.priority - a.priority || b.seq - a.seq
  );
  for (const entry of ordered) {
    let consumed = false;
    try {
      consumed = entry.handler();
    } catch {
      consumed = false;
    }
    if (consumed) {
      if (typeof (ev as CustomEvent).preventDefault === 'function') {
        ev.preventDefault();
      }
      return;
    }
  }
}

/**
 * Register a back handler. Returns an unregister function. Most callers should
 * prefer the {@link useAndroidBack} hook.
 */
export function registerAndroidBackHandler(
  handler: AndroidBackHandler,
  priority = BACK_PRIORITY.root
): () => void {
  const entry: BackEntry = { handler, priority, seq: seqCounter++ };
  entries.push(entry);
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener(ANDROID_BACK_EVENT, dispatch);
    listening = true;
  }
  return () => {
    const idx = entries.indexOf(entry);
    if (idx >= 0) entries.splice(idx, 1);
  };
}

/**
 * React hook to participate in the Android back stack. The handler is kept in a
 * ref so it always sees fresh state without re-registering on every render.
 *
 * @param handler returns `true` to consume the press.
 * @param options.priority one of {@link BACK_PRIORITY} (default: root).
 * @param options.enabled when false the handler is not registered.
 */
export function useAndroidBack(
  handler: AndroidBackHandler,
  options?: { priority?: number; enabled?: boolean }
): void {
  const priority = options?.priority ?? BACK_PRIORITY.root;
  const enabled = options?.enabled ?? true;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    return registerAndroidBackHandler(() => handlerRef.current(), priority);
  }, [enabled, priority]);
}
