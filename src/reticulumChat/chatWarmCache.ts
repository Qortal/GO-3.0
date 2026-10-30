/**
 * Recent chats' messages, kept so a chat opens with its messages already on
 * screen; the chat then refreshes them from the phone's own database as
 * before, quietly.
 *
 * Private by design:
 * - memory only: never written to disk, storage or any file, gone when GO
 *   closes;
 * - emptied on lock, logout and account switch (see installClearing);
 * - messages only from what this phone already has (its chat database, or
 *   a chat the user had open); sender names also from the user's own Qortal
 *   node (see useChatHistoryWarmUp).
 *
 * Small: a few chats each, least recently used dropped first.
 */
import { getDefaultStore } from 'jotai';
import { appLockedAtom } from '../atoms/presence';
import {
  reticulumChatSummariesAtom,
  reticulumDirectSummariesAtom,
} from '../atoms/global';
import { subscribeToEvent } from '../utils/events';

/** Chats kept per kind. */
export const CHAT_WARM_CACHE_LIMIT = 12;
/** Bigger windows (a long scroll back) are not kept: the latest page is. */
export const CHAT_WARM_CACHE_MAX_EVENTS = 600;
/** Names kept (whole member lists go in; a name is a few bytes). */
const NAME_LIMIT = 3000;

export type WarmGroupHistory = {
  events: unknown[];
  hasOlder: boolean;
};

class Lru<T> {
  private readonly map = new Map<string, T>();
  constructor(private readonly limit: number) {}
  get(key: string): T | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Most recently used last.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  peek(key: string): T | undefined {
    return this.map.get(key);
  }
  set(key: string, value: T): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  delete(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}

const groups = new Lru<WarmGroupHistory>(CHAT_WARM_CACHE_LIMIT);
const directs = new Lru<unknown[]>(CHAT_WARM_CACHE_LIMIT);
const directCalls = new Lru<unknown[]>(CHAT_WARM_CACHE_LIMIT);
const names = new Lru<string>(NAME_LIMIT);
/** The account the cached chats belong to. */
let owner = '';
/** Whether Reticulum chat is on, once known (saves each chat a round trip
 * to the settings before it may show anything). */
let knownEnabled: boolean | null = null;
let clearingInstalled = false;

const isLocked = (): boolean => {
  try {
    return getDefaultStore().get(appLockedAtom) === true;
  } catch {
    return false;
  }
};

/** Empties everything (lock, logout, account switch). */
export function clearChatWarmCache(): void {
  groups.clear();
  directs.clear();
  directCalls.clear();
  names.clear();
}

function installClearing(): void {
  if (clearingInstalled) return;
  clearingInstalled = true;
  subscribeToEvent('logout-event', () => {
    clearChatWarmCache();
    owner = '';
    knownEnabled = null;
  });
  try {
    const store = getDefaultStore();
    store.sub(appLockedAtom, () => {
      if (store.get(appLockedAtom)) clearChatWarmCache();
    });
  } catch {
    // No store (tests without jotai): logout still clears.
  }
}

/** The signed-in account. A different one empties the cache first. */
export function setChatWarmCacheOwner(address: string): void {
  installClearing();
  const next = String(address || '').trim();
  if (next === owner) return;
  clearChatWarmCache();
  owner = next;
}

export function getKnownReticulumChatEnabled(): boolean | null {
  return knownEnabled;
}

export function setKnownReticulumChatEnabled(value: boolean): void {
  knownEnabled = value;
}

const groupKey = (groupId: number, channelId: string) =>
  `${groupId}:${channelId}`;

/** Never kept while locked, nor for another account than the cache's. The
 * first copy kept arms the clearing (lock, logout). */
const mayStore = (account?: string) => {
  installClearing();
  return !isLocked() && (!account || !owner || account === owner);
};

const newestTimestamp = (events: readonly unknown[]): number => {
  let newest = -1;
  for (const item of events) {
    const timestamp = Number((item as { timestamp?: unknown })?.timestamp);
    if (Number.isFinite(timestamp) && timestamp > newest) newest = timestamp;
  }
  return newest;
};

/**
 * Whether cached events still end at the chat's latest event (as the chat
 * list's summary has it). A chat with newer events than the copy opens the
 * usual way, so its unread marker and landing are right. No summary: the
 * copy is all there is to go on.
 */
export function isWarmCopyCurrent(
  events: readonly unknown[],
  latestTimestamp: number | null | undefined
): boolean {
  if (latestTimestamp == null || !Number.isFinite(latestTimestamp)) {
    return true;
  }
  return newestTimestamp(events) >= latestTimestamp;
}

/** The latest event time the chat list knows for a group channel. */
export function groupLatestTimestamp(
  groupId: number,
  channelId: string
): number | null {
  try {
    const summaries = getDefaultStore().get(reticulumChatSummariesAtom) || {};
    const entry = summaries[String(groupId)];
    if (!entry) return null;
    // Per channel (the group's own lastEvent is its busiest channel's).
    const channel = Array.isArray(entry.channels)
      ? entry.channels.find((item) => item?.channelId === channelId)
      : entry.channelId === channelId
        ? entry
        : null;
    const timestamp = Number(channel?.lastEvent?.timestamp);
    return Number.isFinite(timestamp) ? timestamp : null;
  } catch {
    return null;
  }
}

/** The latest event time the chat list knows for a DM. */
export function directLatestTimestamp(peerAddress: string): number | null {
  try {
    const summaries = getDefaultStore().get(reticulumDirectSummariesAtom) || {};
    const timestamp = Number(summaries[peerAddress]?.lastEvent?.timestamp);
    return Number.isFinite(timestamp) ? timestamp : null;
  } catch {
    return null;
  }
}

/**
 * Without the messages that expired (disappearing messages) since the copy
 * was taken: those never show again, not even for a moment.
 */
const withoutExpired = <T>(events: T[]): T[] => {
  const now = Date.now();
  const kept = events.filter((event) => {
    const expiresAt = (event as { expiresAt?: unknown })?.expiresAt;
    return (
      expiresAt == null ||
      !Number.isFinite(Number(expiresAt)) ||
      Number(expiresAt) > now
    );
  });
  return kept.length === events.length ? events : kept;
};

/**
 * With the names already known put on (the chat shows them at once instead
 * of an address until its own lookup is back). The same array when nothing
 * changes.
 */
export function withWarmNames<T>(
  events: T[],
  addressField: 'authorAddress' | 'senderAddress'
): T[] {
  let changed = false;
  const named = events.map((item) => {
    const event = item as Record<string, unknown>;
    const address =
      typeof event?.[addressField] === 'string'
        ? (event[addressField] as string)
        : '';
    const name = address ? names.peek(address) : undefined;
    if (!name || event.authorPrimaryName === name) return item;
    changed = true;
    return {
      ...event,
      authorPrimaryName: name,
      senderName:
        addressField === 'senderAddress' &&
        typeof event.senderName === 'string' &&
        event.senderName.trim()
          ? event.senderName
          : name,
    } as T;
  });
  return changed ? named : events;
}

/** A group channel's cached window, if it is still current. */
export function readWarmGroupHistory(
  groupId: number | null,
  channelId: string
): WarmGroupHistory | null {
  if (groupId == null || isLocked()) return null;
  const cached = groups.get(groupKey(groupId, channelId));
  if (!cached || cached.events.length === 0) return null;
  if (
    !isWarmCopyCurrent(cached.events, groupLatestTimestamp(groupId, channelId))
  ) {
    return null;
  }
  const events = withWarmNames(withoutExpired(cached.events), 'authorAddress');
  if (events === cached.events) return cached;
  if (events.length === 0) return null;
  const current = { events, hasOlder: cached.hasOlder };
  groups.set(groupKey(groupId, channelId), current);
  return current;
}

export function writeWarmGroupHistory(
  groupId: number,
  channelId: string,
  history: WarmGroupHistory,
  account?: string
): void {
  if (!mayStore(account)) return;
  if (
    history.events.length === 0 ||
    history.events.length > CHAT_WARM_CACHE_MAX_EVENTS
  ) {
    return;
  }
  groups.set(groupKey(groupId, channelId), {
    events: history.events.slice(),
    hasOlder: history.hasOlder,
  });
}

/** Whether a group channel has a copy (current or not). */
export function hasWarmGroupHistory(
  groupId: number,
  channelId: string
): boolean {
  return groups.peek(groupKey(groupId, channelId)) !== undefined;
}

/** The newest event time in a group channel's copy (-1: none). */
export function warmGroupNewestTimestamp(
  groupId: number,
  channelId: string
): number {
  const cached = groups.peek(groupKey(groupId, channelId));
  return cached ? newestTimestamp(cached.events) : -1;
}

/** A DM's cached events, if still current. */
export function readWarmDirectHistory<T = unknown>(
  account: string,
  peerAddress: string
): T[] | null {
  if (!account || !peerAddress || isLocked()) return null;
  if (owner && account !== owner) return null;
  const cached = directs.get(peerAddress);
  if (!cached || cached.length === 0) return null;
  if (!isWarmCopyCurrent(cached, directLatestTimestamp(peerAddress))) {
    return null;
  }
  const events = withWarmNames(withoutExpired(cached), 'senderAddress');
  if (events === cached) return cached as T[];
  if (events.length === 0) return null;
  directs.set(peerAddress, events);
  return events as T[];
}

export function writeWarmDirectHistory(
  account: string,
  peerAddress: string,
  events: readonly unknown[]
): void {
  if (!account || !peerAddress || !mayStore(account)) return;
  if (events.length === 0 || events.length > CHAT_WARM_CACHE_MAX_EVENTS) {
    return;
  }
  directs.set(peerAddress, events.slice());
}

/** The newest event time in a DM's copy (-1: none). */
export function warmDirectNewestTimestamp(peerAddress: string): number {
  const cached = directs.peek(peerAddress);
  return cached ? newestTimestamp(cached) : -1;
}

/** A DM's cached call history (calls show between its messages). */
export function readWarmDirectCalls<T = unknown>(
  account: string,
  peerAddress: string
): T[] | null {
  if (!account || !peerAddress || isLocked()) return null;
  if (owner && account !== owner) return null;
  return (directCalls.get(peerAddress) as T[] | undefined) ?? null;
}

export function writeWarmDirectCalls(
  account: string,
  peerAddress: string,
  records: readonly unknown[]
): void {
  if (!account || !peerAddress || !mayStore(account)) return;
  directCalls.set(peerAddress, records.slice());
}

/** Primary names seen for addresses (public, from the Qortal node). */
export function readWarmName(address: string): string | undefined {
  return names.get(address);
}

export function writeWarmName(address: string, name: string): void {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!address || !trimmed || !mayStore()) return;
  if (names.peek(address) === trimmed) return;
  names.set(address, trimmed);
}

/** Many at once (a group's member list, the DM list). */
export function writeWarmNames(
  entries: Iterable<{ address?: unknown; name?: unknown }>
): void {
  for (const entry of entries) {
    if (typeof entry?.address !== 'string') continue;
    if (typeof entry?.name !== 'string') continue;
    writeWarmName(entry.address.trim(), entry.name);
  }
}

/**
 * Chats open on screen. The warm-up waits while any is (the chat's own
 * reads and sends come first, and it keeps itself current), so reacting or
 * typing never queues behind a warm-up read.
 */
const openChats = new Map<string, number>();
const openChatListeners = new Set<() => void>();

/** A chat is on screen until the returned function runs. */
export function markWarmChatOpen(key: string): () => void {
  openChats.set(key, (openChats.get(key) ?? 0) + 1);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const count = (openChats.get(key) ?? 1) - 1;
    if (count > 0) openChats.set(key, count);
    else openChats.delete(key);
    if (openChats.size === 0) {
      for (const listener of openChatListeners) listener();
    }
  };
}

export function isAnyWarmChatOpen(): boolean {
  return openChats.size > 0;
}

/** Runs each time the last open chat closes. */
export function onAllWarmChatsClosed(listener: () => void): () => void {
  openChatListeners.add(listener);
  return () => openChatListeners.delete(listener);
}

export const warmGroupChatKey = (groupId: number) => `g:${groupId}`;
export const warmDirectChatKey = (peerAddress: string) => `d:${peerAddress}`;

/** Tests only. */
export function resetChatWarmCacheForTests(): void {
  clearChatWarmCache();
  owner = '';
  knownEnabled = null;
  openChats.clear();
}
