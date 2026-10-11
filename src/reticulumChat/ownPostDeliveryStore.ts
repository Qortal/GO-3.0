import { useCallback, useSyncExternalStore } from 'react';

/**
 * Fetch proofs for the user's own group posts and Saved Messages that the
 * engine reported after their rows were read (GO only, 'ownPostDelivery'
 * manager event). The rows themselves are not updated in place: the chat
 * lists keep a row once shown (merge gates, the warm copy, thread state), so
 * the delivery glyph reads this store next to the row and shows the furthest
 * of the two. Only the glyphs of the affected posts re-render.
 *
 * Forward-only: a proof time, once set, is never cleared or replaced. One
 * engine listener, started when GO installs its chat API (passive: it does
 * not start the engine) or else by the first glyph that subscribes, and
 * kept for the page's life, so proofs that arrive while a chat is closed are
 * there when it opens again. Desktop never sends the event, so the store
 * stays empty there.
 */
export type OwnPostDeliveryEntry = {
  ownDeviceAt?: number;
  memberAt?: number;
};

export type OwnPostDeliveryUpdate = {
  eventId: string;
  scope: 'group' | 'self_dm';
  groupId?: number;
  channelId?: string;
  conversationId?: string;
  ownDeviceAt?: number;
  memberAt?: number;
};

/** About two proofs per own post; plenty for a session, bounded anyway. */
const MAX_ENTRIES = 5_000;

const entries = new Map<string, OwnPostDeliveryEntry>();
const subscribers = new Map<string, Set<() => void>>();
let stopListening: (() => void) | null = null;

const positiveMs = (value: unknown): number => {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
};

/** The entry for this post, or undefined. Same object until it changes. */
export const getOwnPostDelivery = (
  eventId: string | undefined
): OwnPostDeliveryEntry | undefined =>
  eventId ? entries.get(eventId) : undefined;

/**
 * Applies the engine's updates. Returns how many posts moved forward; only
 * their subscribers are notified.
 */
export const applyOwnPostDeliveryUpdates = (payload: unknown): number => {
  const updates = (payload as { updates?: unknown } | null)?.updates;
  if (!Array.isArray(updates)) return 0;
  const changed: string[] = [];
  for (const update of updates as OwnPostDeliveryUpdate[]) {
    const eventId =
      update && typeof update.eventId === 'string' ? update.eventId : '';
    if (!eventId) continue;
    const ownDeviceAt = positiveMs(update.ownDeviceAt);
    // A member's node never fetches a Saved Message.
    const memberAt = update.scope === 'group' ? positiveMs(update.memberAt) : 0;
    if (!ownDeviceAt && !memberAt) continue;
    const current = entries.get(eventId);
    const next: OwnPostDeliveryEntry = { ...current };
    if (ownDeviceAt && !current?.ownDeviceAt) next.ownDeviceAt = ownDeviceAt;
    if (memberAt && !current?.memberAt) next.memberAt = memberAt;
    if (
      next.ownDeviceAt === current?.ownDeviceAt &&
      next.memberAt === current?.memberAt
    ) {
      continue;
    }
    // Re-inserted, so the oldest entries are the ones dropped below.
    entries.delete(eventId);
    entries.set(eventId, next);
    changed.push(eventId);
  }
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  for (const eventId of changed) {
    const waiting = subscribers.get(eventId);
    if (!waiting) continue;
    for (const notify of [...waiting]) {
      try {
        notify();
      } catch (error) {
        console.warn('[ownPostDeliveryStore] subscriber failed', error);
      }
    }
  }
  return changed.length;
};

const ensureListening = () => {
  if (stopListening) return;
  // Optional: desktop and older hosts have no such event.
  const off = window.reticulumChat?.onOwnPostDelivery?.((payload) => {
    applyOwnPostDeliveryUpdates(payload);
  });
  if (typeof off === 'function') stopListening = off;
};

/**
 * Starts the engine listener before any glyph mounts (GO's mobile chat API
 * calls it at install; its onOwnPostDelivery does not start the engine). A
 * warm copy of a group shown again is not re-read row by row, so a proof
 * that came before the first glyph would otherwise only show after a fresh
 * read. A no-op on hosts without the event.
 */
export const startOwnPostDeliveryListener = () => {
  ensureListening();
};

/** Calls `notify` whenever this post's entry moves forward. */
export const subscribeOwnPostDelivery = (
  eventId: string,
  notify: () => void
): (() => void) => {
  if (!eventId) return () => {};
  ensureListening();
  let waiting = subscribers.get(eventId);
  if (!waiting) {
    waiting = new Set();
    subscribers.set(eventId, waiting);
  }
  waiting.add(notify);
  return () => {
    const current = subscribers.get(eventId);
    if (!current) return;
    current.delete(notify);
    if (current.size === 0) subscribers.delete(eventId);
  };
};

/** This post's entry; re-renders only when it moves forward. */
export const useOwnPostDelivery = (
  eventId: string | undefined
): OwnPostDeliveryEntry | undefined => {
  const id = eventId || '';
  const subscribe = useCallback(
    (notify: () => void) => subscribeOwnPostDelivery(id, notify),
    [id]
  );
  const getSnapshot = useCallback(() => getOwnPostDelivery(id), [id]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

/** Test hook: forgets every entry, subscriber and the engine listener. */
export const resetOwnPostDeliveryStoreForTests = () => {
  stopListening?.();
  stopListening = null;
  entries.clear();
  subscribers.clear();
};

/** Test hook: how many posts have a subscriber. */
export const ownPostDeliverySubscribedIdCount = () => subscribers.size;
