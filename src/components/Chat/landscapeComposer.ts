/**
 * The phone landscape composer of the Hub's mobile layout: a pen FAB in
 * front of the composer and extra room under the newest message. Both were
 * built for short phones. GO keeps the composer in flow at every size, so a
 * tablet in landscape (or a portrait window the keyboard made "landscape")
 * never gets them; the Hub below 900 px keeps them as they are.
 */
export type LandscapeComposerInput = {
  /** isGoLayout(): the GO app, where the composer always stays in flow. */
  go: boolean;
  /** Below the `md` breakpoint. */
  isMobile: boolean;
  /** useMediaQuery('(orientation: landscape)'). */
  isLandscape: boolean;
};

/** Scroll room under the newest message, clear of the floating composer. */
export const LANDSCAPE_LIST_PAD_PX = 96;

/** The composer hides behind a pen FAB and floats as a card when opened. */
export const composerFabModeFor = ({
  go,
  isMobile,
  isLandscape,
}: LandscapeComposerInput): boolean => !go && isMobile && isLandscape;

/** The extra list padding goes with the floating composer it makes room for. */
export const landscapeListPadFor = (input: LandscapeComposerInput): number =>
  composerFabModeFor(input) ? LANDSCAPE_LIST_PAD_PX : 0;

export type LegacyComposerCompactInput = {
  isMobile: boolean;
  /** useShortLandscape(): what TipTap keeps its expanded layout for. */
  shortLandscape: boolean;
  isFocusedParent: boolean;
  keyboardOpen: boolean;
};

/**
 * The legacy DM row's compact state (focused, keyboard down): its buttons
 * have to agree with TipTap, which stays in the expanded compose layout in a
 * short landscape window. On the Hub this equals the old
 * `isMobile && !composerFabMode && …`, because the FAB took landscape.
 */
export const legacyComposerCompactFor = ({
  isMobile,
  shortLandscape,
  isFocusedParent,
  keyboardOpen,
}: LegacyComposerCompactInput): boolean =>
  isMobile && !shortLandscape && isFocusedParent && !keyboardOpen;

/**
 * GO: after the window changes shape (rotation, fold, split resize) the
 * keyboard store re-baselines and can report a keyboard that is still up as
 * closed for ~0.7 s. A close inside this window is not the user's.
 */
export const LAYOUT_SETTLE_MS = 900;

/** How long to wait before a keyboard close may count as the user's. */
export const layoutSettleWaitMs = (now: number, changedAt: number): number =>
  Math.max(0, changedAt + LAYOUT_SETTLE_MS - now);
