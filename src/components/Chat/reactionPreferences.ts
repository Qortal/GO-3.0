/**
 * The viewer's reaction choices on this device: which emoji a double tap on a
 * message sends (per DM and per group, thumbs up unless changed), and which
 * quick reactions the phone popup's pill shows (a fixed list, or the ones the
 * viewer uses most). Kept in localStorage next to the recent reactions and
 * shared by every open popup through a tiny external store.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { QUICK_REACTIONS } from './reactionEmojiData';

export const DEFAULT_DOUBLE_TAP_REACTION = '👍';
export const REACTION_PREFS_STORAGE_KEY = 'qortal-hub:reaction-prefs';
export const REACTION_USAGE_STORAGE_KEY = 'qortal-hub:reaction-usage';
/** Chats without their own double-tap emoji use this key's. */
export const OTHER_CHATS_KEY = '*';
/** As many as the widest pill can show. */
export const QUICK_REACTION_SLOTS = QUICK_REACTIONS.length;
const USAGE_LIMIT = 64;
const CHAT_LIMIT = 500;

export type QuickReactionMode = 'custom' | 'most_used';

export type ReactionPrefs = {
  /** Chat key (`group:<id>`, `direct:<address>`, or OTHER_CHATS_KEY) → emoji. */
  doubleTap: Record<string, string>;
  quickMode: QuickReactionMode;
  quickReactions: string[];
};

type ReactionUsage = Record<string, number>;

const isEmoji = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 32;

const defaultPrefs = (): ReactionPrefs => ({
  doubleTap: {},
  quickMode: 'custom',
  quickReactions: [...QUICK_REACTIONS],
});

const readJson = (key: string): unknown => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage off or full: the choice lasts until the app restarts.
  }
};

/** Fills up a stored list to every slot, without repeats. */
const normalizeQuickReactions = (value: unknown): string[] => {
  const picked = Array.isArray(value) ? value.filter(isEmoji) : [];
  const unique = Array.from(new Set(picked)).slice(0, QUICK_REACTION_SLOTS);
  for (const emoji of QUICK_REACTIONS) {
    if (unique.length >= QUICK_REACTION_SLOTS) break;
    if (!unique.includes(emoji)) unique.push(emoji);
  }
  return unique;
};

const parsePrefs = (value: unknown): ReactionPrefs => {
  if (!value || typeof value !== 'object') return defaultPrefs();
  const record = value as Partial<Record<keyof ReactionPrefs, unknown>>;
  const doubleTap: Record<string, string> = {};
  if (record.doubleTap && typeof record.doubleTap === 'object') {
    for (const [chat, emoji] of Object.entries(record.doubleTap)) {
      if (chat && isEmoji(emoji)) doubleTap[chat] = emoji;
    }
  }
  return {
    doubleTap,
    quickMode: record.quickMode === 'most_used' ? 'most_used' : 'custom',
    quickReactions: normalizeQuickReactions(record.quickReactions),
  };
};

const parseUsage = (value: unknown): ReactionUsage => {
  const usage: ReactionUsage = {};
  if (!value || typeof value !== 'object') return usage;
  for (const [emoji, count] of Object.entries(value)) {
    if (isEmoji(emoji) && typeof count === 'number' && count > 0) {
      usage[emoji] = Math.floor(count);
    }
  }
  return usage;
};

type Snapshot = { prefs: ReactionPrefs; usage: ReactionUsage };

let snapshot: Snapshot | null = null;
const listeners = new Set<() => void>();

const getSnapshot = (): Snapshot => {
  if (!snapshot) {
    snapshot = {
      prefs: parsePrefs(readJson(REACTION_PREFS_STORAGE_KEY)),
      usage: parseUsage(readJson(REACTION_USAGE_STORAGE_KEY)),
    };
  }
  return snapshot;
};

const emit = () => {
  for (const listener of Array.from(listeners)) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  // Another window of the app (the desktop has several) changed them.
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === REACTION_PREFS_STORAGE_KEY ||
      event.key === REACTION_USAGE_STORAGE_KEY
    ) {
      snapshot = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

const updatePrefs = (change: (prefs: ReactionPrefs) => ReactionPrefs) => {
  const current = getSnapshot();
  const prefs = change(current.prefs);
  snapshot = { ...current, prefs };
  writeJson(REACTION_PREFS_STORAGE_KEY, prefs);
  emit();
};

/** Drops the cached copy; tests and a storage reset use it. */
export const resetReactionPrefsCache = () => {
  snapshot = null;
  emit();
};

export const readReactionPrefs = (): ReactionPrefs => getSnapshot().prefs;

/** The emoji a double tap sends in `chatKey`. */
export const getDoubleTapReaction = (
  prefs: ReactionPrefs,
  chatKey?: string | null
): string =>
  (chatKey ? prefs.doubleTap[chatKey] : undefined) ??
  prefs.doubleTap[OTHER_CHATS_KEY] ??
  DEFAULT_DOUBLE_TAP_REACTION;

export const setDoubleTapReaction = (
  chatKey: string | null | undefined,
  emoji: string
) => {
  if (!isEmoji(emoji)) return;
  const key = chatKey || OTHER_CHATS_KEY;
  updatePrefs((prefs) => {
    const doubleTap = { ...prefs.doubleTap };
    delete doubleTap[key];
    doubleTap[key] = emoji;
    // The oldest chats' choices go first once there are very many.
    const keys = Object.keys(doubleTap).filter((k) => k !== OTHER_CHATS_KEY);
    for (const old of keys.slice(0, Math.max(0, keys.length - CHAT_LIMIT))) {
      delete doubleTap[old];
    }
    return { ...prefs, doubleTap };
  });
};

export const setQuickReactionMode = (quickMode: QuickReactionMode) =>
  updatePrefs((prefs) => ({ ...prefs, quickMode }));

/** Puts `emoji` in `slot`; if it already sat elsewhere, the two swap. */
export const setQuickReactionSlot = (slot: number, emoji: string) => {
  if (!isEmoji(emoji)) return;
  updatePrefs((prefs) => {
    const list = [...prefs.quickReactions];
    if (slot < 0 || slot >= list.length) return prefs;
    const existing = list.indexOf(emoji);
    if (existing >= 0) list[existing] = list[slot];
    list[slot] = emoji;
    return { ...prefs, quickReactions: list };
  });
};

export const resetQuickReactions = () =>
  updatePrefs((prefs) => ({
    ...prefs,
    quickMode: 'custom',
    quickReactions: [...QUICK_REACTIONS],
  }));

/** Counts a reaction the viewer added, for the "most used" pill. */
export const recordReactionUse = (emoji: string) => {
  if (!isEmoji(emoji)) return;
  const current = getSnapshot();
  const usage = { ...current.usage, [emoji]: (current.usage[emoji] ?? 0) + 1 };
  const kept = Object.entries(usage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, USAGE_LIMIT);
  snapshot = { ...current, usage: Object.fromEntries(kept) };
  writeJson(REACTION_USAGE_STORAGE_KEY, snapshot.usage);
  emit();
};

/**
 * What the pill shows, in order. "Most used" ranks by count (ties keep the
 * fixed list's order) and tops up from the fixed list while there are few.
 */
export const resolveQuickReactions = (
  prefs: ReactionPrefs,
  usage: ReactionUsage
): string[] => {
  if (prefs.quickMode !== 'most_used') return prefs.quickReactions;
  const order = new Map(prefs.quickReactions.map((emoji, i) => [emoji, i]));
  const ranked = Object.entries(usage)
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        (order.get(a[0]) ?? Infinity) - (order.get(b[0]) ?? Infinity)
    )
    .map(([emoji]) => emoji)
    .slice(0, QUICK_REACTION_SLOTS);
  return normalizeQuickReactions([...ranked, ...prefs.quickReactions]);
};

/**
 * The pill's emoji for a screen that fits `count`: the double-tap emoji is
 * always among them, taking the last place when it would not show.
 */
export const pickPillReactions = (
  quick: readonly string[],
  count: number,
  doubleTap: string
): string[] => {
  const visible = quick.slice(0, count);
  if (count <= 0 || visible.includes(doubleTap)) return visible;
  return [...visible.slice(0, count - 1), doubleTap];
};

export type ReactionPrefsView = {
  prefs: ReactionPrefs;
  quickReactions: string[];
};

export const useReactionPrefs = (): ReactionPrefsView => {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(
    () => ({
      prefs: current.prefs,
      quickReactions: resolveQuickReactions(current.prefs, current.usage),
    }),
    [current]
  );
};
