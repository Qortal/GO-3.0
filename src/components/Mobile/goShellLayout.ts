import { useEffect, useState } from 'react';
import { MOBILE_TAB_BAR_HEIGHT_PX } from './mobileBarHeights';
import { SECTION_ATTR } from './sectionSwipe/sectionSwipe';

/**
 * Shell-chrome decisions for GO in landscape and on tablets (top bar, search
 * dropdown). Pure helpers plus one focus hook; the layout signals themselves
 * live in layout/goLayout.ts.
 */

/** A chat composer inside the Chat section (not one in a sheet or Q-App). */
const CHAT_COMPOSER_SELECTOR = `[${SECTION_ATTR}="chat"] .tiptap-chat-composer`;

const composerHasFocus = (): boolean => {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement as HTMLElement | null;
  return Boolean(active?.closest?.(CHAT_COMPOSER_SELECTOR));
};

/**
 * True while a chat composer has focus. Only listens while `enabled`, so the
 * Hub and tall screens pay nothing for it.
 */
export function useChatComposerFocus(enabled = true): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const sync = () => setFocused(composerHasFocus());
    // Focus moving between two controls blurs to <body> first; wait a frame
    // so the bar does not flick open and shut in between.
    let frame = 0;
    const onFocusOut = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(sync);
    };
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', onFocusOut);
    sync();
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('focusin', sync);
      document.removeEventListener('focusout', onFocusOut);
      // Nothing tracks focus while disabled; a stale true would collapse the
      // bars for a frame when it is enabled again (rotating back).
      setFocused(false);
    };
  }, [enabled]);
  return enabled && focused;
}

export type CollapseForTypingInput = {
  /** GO on a short screen (phone landscape, a 1280x400 split). */
  goShort: boolean;
  desktopViewMode: string;
  keyboardInset: number;
  composerFocused: boolean;
  emojiPanelOpen: boolean;
  /**
   * The lock screen or the runtime-fault screen is up. They keep the status
   * bar, even with the emoji panel still open underneath.
   */
  appCovered: boolean;
};

/**
 * Short screens give the top bar's strip to the conversation while typing,
 * the way portrait drops the tab bar for the keyboard.
 */
export function shouldCollapseForTyping({
  goShort,
  desktopViewMode,
  keyboardInset,
  composerFocused,
  emojiPanelOpen,
  appCovered,
}: CollapseForTypingInput): boolean {
  if (!goShort || appCovered || desktopViewMode !== 'chat') return false;
  return (keyboardInset > 0 && composerFocused) || emojiPanelOpen;
}

/** Space left between the results and the keyboard (or the tab buttons). */
const SEARCH_RESULTS_GAP_PX = 10;
/** Hub floor: results never get shorter than this. */
export const SEARCH_RESULTS_MIN_HEIGHT_PX = 160;
/** GO floor: low enough that a landscape keyboard never covers the results. */
export const GO_SEARCH_RESULTS_MIN_HEIGHT_PX = 96;

export type SearchResultsHeightInput = {
  /** Bottom of the visible viewport (above the keyboard), CSS px. */
  visibleBottom: number;
  /** Top of the results box, CSS px. */
  top: number;
  keyboardInset: number;
  /** GO with Home/Apps/Chat in the top bar: there is no bottom bar. */
  navInTopBar: boolean;
  safeBottom: number;
  go: boolean;
};

/**
 * Max height of the top-bar search results: down to just above the keyboard,
 * or above the tab buttons while it is closed. Off GO this is the old rule.
 */
export function computeSearchResultsMaxHeight({
  visibleBottom,
  top,
  keyboardInset,
  navInTopBar,
  safeBottom,
  go,
}: SearchResultsHeightInput): number {
  const tabBarReserve =
    MOBILE_TAB_BAR_HEIGHT_PX + safeBottom + SEARCH_RESULTS_GAP_PX;
  if (!go) {
    const reserve = keyboardInset > 0 ? SEARCH_RESULTS_GAP_PX : tabBarReserve;
    return Math.max(
      SEARCH_RESULTS_MIN_HEIGHT_PX,
      Math.floor(visibleBottom - top - reserve)
    );
  }
  // Only reserve the tab bar while it is really there. With the keyboard
  // closed the page still reaches under the nav bar (safeBottom); with it up
  // the WebView already ends above the keyboard.
  const reserve =
    keyboardInset > 0
      ? SEARCH_RESULTS_GAP_PX
      : navInTopBar
        ? safeBottom + SEARCH_RESULTS_GAP_PX
        : tabBarReserve;
  return Math.max(
    GO_SEARCH_RESULTS_MIN_HEIGHT_PX,
    Math.floor(visibleBottom - top - reserve)
  );
}
