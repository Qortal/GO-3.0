/**
 * Emoji for the phone reaction picker (the grid MessageActionsPopup expands
 * into). The list is emoji-picker-react's own data, loaded the first time the
 * grid opens so it stays out of the main bundle. Emoji newer than the phone's
 * emoji font are left out, so the grid never shows empty boxes.
 */

export const REACTION_EMOJI_CATEGORIES = [
  'smileys_people',
  'animals_nature',
  'food_drink',
  'activities',
  'travel_places',
  'objects',
  'symbols',
  'flags',
] as const;

export type ReactionEmojiCategory = (typeof REACTION_EMOJI_CATEGORIES)[number];

export type ReactionEmojiSection = {
  id: ReactionEmojiCategory;
  emojis: string[];
};

/** One entry of emoji-picker-react's data: names, unified code, version. */
type RawEmoji = { n?: string[]; u?: string; a?: string };
type RawEmojiData = Partial<Record<string, RawEmoji[]>>;

/**
 * Quick reactions in the pill, in order. The first four are the ones the
 * old tap bar had, so they stay where thumbs expect them.
 */
export const QUICK_REACTIONS = [
  '👍',
  '💯',
  '😂',
  '❤️',
  '🔥',
  '🙏',
  '😮',
] as const;

/** What "Recently used" shows before the user has reacted with anything. */
export const DEFAULT_RECENT_REACTIONS = [
  ...QUICK_REACTIONS,
  '😢',
  '🎉',
  '👏',
  '😍',
  '🤔',
  '👀',
  '🚀',
  '😎',
  '🤝',
];

export const RECENT_REACTIONS_STORAGE_KEY = 'qortal-hub:recent-reactions';
export const RECENT_REACTIONS_LIMIT = 24;

export const unifiedToNative = (unified: string): string =>
  unified
    .split('-')
    .map((hex) => String.fromCodePoint(parseInt(hex, 16)))
    .join('');

/** Newest emoji version the data has, and one emoji per version to test. */
const EMOJI_VERSION_PROBES: ReadonlyArray<readonly [number, string]> = [
  [14, String.fromCodePoint(0x1fae0)], // melting face
  [13.1, String.fromCodePoint(0x2764, 0xfe0f, 0x200d, 0x1f525)], // heart on fire
  [13, String.fromCodePoint(0x1f972)], // smiling face with tear
  [12.1, String.fromCodePoint(0x1f9d1, 0x200d, 0x1f9b0)], // person: red hair
  [12, String.fromCodePoint(0x1f971)], // yawning face
  [11, String.fromCodePoint(0x1f970)], // smiling face with hearts
  [5, String.fromCodePoint(0x1f929)], // star-struck
];
/** Assumed when even the oldest probe fails: Android 7's emoji set. */
const OLDEST_EMOJI_VERSION = 4;

/**
 * Whether the system emoji font draws `emoji` as one coloured glyph. A font
 * without it draws a monochrome box (same pixels in any fill colour) or, for
 * a joined sequence, its parts side by side (wider than one glyph).
 */
const canvasDrawsEmoji = (
  context: CanvasRenderingContext2D,
  emoji: string
): boolean => {
  const size = 20;
  context.clearRect(0, 0, size * 2, size);
  context.fillStyle = '#ff0000';
  context.fillText(emoji, 0, 0);
  context.fillStyle = '#0000ff';
  context.fillText(emoji, size, 0);
  const left = context.getImageData(0, 0, size, size).data;
  let index = 0;
  while (index < left.length && left[index + 3] === 0) index += 4;
  if (index >= left.length) return false;
  const x = size + ((index / 4) % size);
  const y = Math.floor(index / 4 / size);
  const right = context.getImageData(x, y, 1, 1).data;
  if (left[index] !== right[0] || left[index + 2] !== right[2]) return false;
  return context.measureText(emoji).width < size * 1.5;
};

let cachedMaxEmojiVersion: number | null = null;

/**
 * Newest emoji version this device can draw. Probes from the newest down and
 * stops at the first hit, so a current phone pays for one probe. Without a
 * usable canvas (tests, odd WebViews) nothing is filtered.
 */
export const getMaxSupportedEmojiVersion = (): number => {
  if (cachedMaxEmojiVersion !== null) return cachedMaxEmojiVersion;
  let result = Number.POSITIVE_INFINITY;
  try {
    const jsdom =
      typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
    const canvas =
      !jsdom && typeof document !== 'undefined'
        ? document.createElement('canvas')
        : null;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (canvas && context) {
      canvas.width = 40;
      canvas.height = 20;
      context.font = '16px sans-serif';
      context.textBaseline = 'top';
      result = OLDEST_EMOJI_VERSION;
      for (const [version, probe] of EMOJI_VERSION_PROBES) {
        if (canvasDrawsEmoji(context, probe)) {
          result = version;
          break;
        }
      }
    }
  } catch {
    result = Number.POSITIVE_INFINITY;
  }
  cachedMaxEmojiVersion = result;
  return result;
};

/** Groups the raw data into the picker's sections, oldest-font safe. */
export const buildReactionEmojiSections = (
  data: RawEmojiData,
  maxVersion: number = Number.POSITIVE_INFINITY
): ReactionEmojiSection[] =>
  REACTION_EMOJI_CATEGORIES.map((id) => ({
    id,
    emojis: (Array.isArray(data?.[id]) ? data[id] : [])
      .filter((entry) => {
        if (typeof entry?.u !== 'string' || !entry.u) return false;
        const version = Number.parseFloat(String(entry.a ?? '0'));
        return !Number.isFinite(version) || version <= maxVersion;
      })
      .map((entry) => unifiedToNative(entry.u)),
  })).filter((section) => section.emojis.length > 0);

let sectionsPromise: Promise<ReactionEmojiSection[]> | null = null;

export const loadReactionEmojiSections = (): Promise<
  ReactionEmojiSection[]
> => {
  if (!sectionsPromise) {
    sectionsPromise = import('emoji-picker-react/src/data/emojis.json').then(
      (module) =>
        buildReactionEmojiSections(
          (module.default ?? module) as RawEmojiData,
          getMaxSupportedEmojiVersion()
        )
    );
    // A failed chunk load (offline dev server) may succeed on the next open.
    sectionsPromise.catch(() => {
      sectionsPromise = null;
    });
  }
  return sectionsPromise;
};

const isStoredEmoji = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 32;

/** Most recent first; never throws (storage can be off or full). */
export const readRecentReactions = (): string[] => {
  try {
    const raw = window.localStorage.getItem(RECENT_REACTIONS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(isStoredEmoji).slice(0, RECENT_REACTIONS_LIMIT)
      : [];
  } catch {
    return [];
  }
};

export const rememberRecentReaction = (emoji: string): void => {
  if (!isStoredEmoji(emoji)) return;
  try {
    const next = [
      emoji,
      ...readRecentReactions().filter((item) => item !== emoji),
    ].slice(0, RECENT_REACTIONS_LIMIT);
    window.localStorage.setItem(
      RECENT_REACTIONS_STORAGE_KEY,
      JSON.stringify(next)
    );
  } catch {
    // Recents are a convenience; a reaction must never fail over them.
  }
};

/** The "Recently used" row: the user's own, else a starter set. */
export const getRecentReactionsForPicker = (): string[] => {
  const recent = readRecentReactions();
  return recent.length > 0 ? recent : [...DEFAULT_RECENT_REACTIONS];
};
