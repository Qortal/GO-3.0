/**
 * Holds app-navigation events while the app lock is up.
 *
 * Deep links (qortal://APP/..., App Links), notification taps and Q-App
 * requests such as OPEN_NEW_TAB or SHOW_PDF_READER open tabs and viewers
 * through the DOM event bus (`executeEvent` dispatches on `document`). While
 * GO is locked those must not open anything under the lock screen: a Q-App
 * opened that way would run behind it. The gate listens on `window` in the
 * capture phase, which runs before any `document` listener, and stops the
 * event there. Held events are delivered again, in order, after a verified
 * unlock; anything older than the TTL is dropped.
 */

/** Events that open a Q-App tab, the apps view, a viewer or a dialog. */
export const APP_LOCK_GATED_EVENTS = [
  'addTab',
  'open-apps-mode',
  'openPdf',
  'openUserLookupDrawer',
  'globalActionJoinGroup',
  // Something shared from another app: the chat picker or the chat it opens.
  'chat-share-request',
] as const;

export const APP_LOCK_EVENT_TTL_MS = 5 * 60 * 1_000;
export const APP_LOCK_EVENT_QUEUE_MAX = 8;

type HeldEvent = { name: string; detail: unknown; at: number };

export type AppLockEventGateOptions = {
  isLocked: () => boolean;
  events?: readonly string[];
  ttlMs?: number;
  maxQueued?: number;
  now?: () => number;
  target?: Window;
  /** Delivers a held event; defaults to dispatching it on `document`. */
  deliver?: (name: string, detail: unknown) => void;
};

export type AppLockEventGate = {
  /** Starts listening; returns the uninstall function. */
  install: () => () => void;
  /** Delivers the held events that are still fresh, then forgets them all. */
  flush: () => number;
  /** Forgets the held events without delivering them. */
  clear: () => void;
  size: () => number;
};

const defaultDeliver = (name: string, detail: unknown) => {
  document.dispatchEvent(new CustomEvent(name, { detail }));
};

export function createAppLockEventGate({
  isLocked,
  events = APP_LOCK_GATED_EVENTS,
  ttlMs = APP_LOCK_EVENT_TTL_MS,
  maxQueued = APP_LOCK_EVENT_QUEUE_MAX,
  now = Date.now,
  target,
  deliver = defaultDeliver,
}: AppLockEventGateOptions): AppLockEventGate {
  let held: HeldEvent[] = [];
  let delivering = false;

  const onEvent = (event: Event) => {
    if (delivering || !isLocked()) return;
    event.stopImmediatePropagation();
    held.push({
      name: event.type,
      detail: (event as CustomEvent).detail,
      at: now(),
    });
    // Keep the newest: those are what the user did last.
    if (held.length > maxQueued) held = held.slice(held.length - maxQueued);
  };

  return {
    install: () => {
      const host = target ?? (typeof window !== 'undefined' ? window : null);
      if (!host) return () => {};
      events.forEach((name) =>
        host.addEventListener(name, onEvent, { capture: true })
      );
      return () => {
        events.forEach((name) =>
          host.removeEventListener(name, onEvent, { capture: true })
        );
      };
    },
    flush: () => {
      const current = now();
      const fresh = held.filter((item) => current - item.at <= ttlMs);
      held = [];
      delivering = true;
      try {
        fresh.forEach((item) => deliver(item.name, item.detail));
      } finally {
        delivering = false;
      }
      return fresh.length;
    },
    clear: () => {
      held = [];
    },
    size: () => held.length,
  };
}

export type BackButtonLockGateOptions = {
  isLocked: () => boolean;
  /** The bridge's hardware-back event (`ANDROID_BACK_EVENT`). */
  eventName: string;
  target?: Window;
};

/**
 * While locked, the Android back button must not drive the screens under the
 * lock (close settings or a chat, step a Q-App back). Stops the bridge's back
 * event before any handler sees it, without `preventDefault()`: the bridge
 * then minimizes GO, as it does when nothing handles back. Returns the
 * uninstall function.
 */
export function installBackButtonLockGate({
  isLocked,
  eventName,
  target,
}: BackButtonLockGateOptions): () => void {
  const host = target ?? (typeof window !== 'undefined' ? window : null);
  if (!host) return () => {};
  const onBack = (event: Event) => {
    if (isLocked()) event.stopImmediatePropagation();
  };
  host.addEventListener(eventName, onBack, { capture: true });
  return () => host.removeEventListener(eventName, onBack, { capture: true });
}
