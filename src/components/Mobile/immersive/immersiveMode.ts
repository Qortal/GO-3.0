import { atom } from 'jotai';
import { atomWithReset, atomWithStorage, createJSONStorage } from 'jotai/utils';

/**
 * Immersive mode (GO phones): the top bar, the bottom tab bar and the Android
 * status bar step aside so Q-Apps and websites get the whole screen.
 *
 * - off: bars always shown (the old layout).
 * - auto (the default): bars hide when You scroll down and come back on
 *   scroll up, at the top or on a new screen (in Q-Apps any downward swipe
 *   counts).
 * - manual: bars stay hidden; the floating button brings them back for a few
 *   seconds.
 *
 * Home, Chat and the Q-Apps library keep their bars in every mode.
 */
export type ImmersiveMode = 'off' | 'auto' | 'manual';

export const IMMERSIVE_MODES: readonly ImmersiveMode[] = [
  'off',
  'auto',
  'manual',
] as const;

/** Until the user picks one (a saved Off stays Off). */
const DEFAULT_IMMERSIVE_MODE: ImmersiveMode = 'auto';

export const normalizeImmersiveMode = (value: unknown): ImmersiveMode =>
  value === 'off' || value === 'auto' || value === 'manual'
    ? value
    : DEFAULT_IMMERSIVE_MODE;

/** Device-wide, not per account: it is about the screen, not the wallet. */
export const IMMERSIVE_MODE_STORAGE_KEY = 'go_immersive_mode';
const IMMERSIVE_PILL_POSITION_STORAGE_KEY = 'go_immersive_pill_position';
export const IMMERSIVE_HINT_SEEN_STORAGE_KEY = 'go_immersive_hint_seen';

const localJsonStorage = <T>() =>
  createJSONStorage<T>(() => {
    try {
      return window.localStorage;
    } catch {
      return {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      } as unknown as Storage;
    }
  });

// Read on init so the first frame after login already has the right layout.
const immersiveModeStoredAtom = atomWithStorage<string>(
  IMMERSIVE_MODE_STORAGE_KEY,
  DEFAULT_IMMERSIVE_MODE,
  localJsonStorage<string>(),
  { getOnInit: true }
);

export const immersiveModeAtom = atom(
  (get): ImmersiveMode => normalizeImmersiveMode(get(immersiveModeStoredAtom)),
  (_get, set, next: ImmersiveMode) => {
    set(immersiveModeStoredAtom, normalizeImmersiveMode(next));
  }
);

/** Where the floating button rests: a screen side and a height fraction. */
export type ImmersivePillPosition = { side: 'left' | 'right'; y: number };

export const DEFAULT_IMMERSIVE_PILL_POSITION: ImmersivePillPosition = {
  side: 'right',
  y: 0.78,
};

export const immersivePillPositionAtom = atomWithStorage<ImmersivePillPosition>(
  IMMERSIVE_PILL_POSITION_STORAGE_KEY,
  DEFAULT_IMMERSIVE_PILL_POSITION,
  localJsonStorage<ImmersivePillPosition>(),
  { getOnInit: true }
);

export const immersiveHintSeenAtom = atomWithStorage<boolean>(
  IMMERSIVE_HINT_SEEN_STORAGE_KEY,
  false,
  localJsonStorage<boolean>(),
  { getOnInit: true }
);

/**
 * Sections that can go full screen: Apps (and dev). Within it, only an open
 * Q-App or website does (App.tsx checks the frame); the library, Home and
 * Chat keep their bars.
 */
export const isImmersiveSurface = (desktopViewMode: string): boolean =>
  desktopViewMode === 'apps' || desktopViewMode === 'dev';

/**
 * The page background behind the immersive edges (read natively), or null
 * before the first reading. Decides whether the top bar can go transparent.
 */
// atomWithReset: with strictNullChecks off, atom(null) would type as read-only.
export const immersiveEdgeColorAtom = atomWithReset<string | null>(null);
