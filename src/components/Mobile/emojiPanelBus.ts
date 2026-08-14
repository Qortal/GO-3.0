/**
 * The emoji keyboard is rendered by the app shell (it has to sit in the soft
 * keyboard's slot, outside the chat's layout) while the composer that receives
 * the emoji lives further down the tree. This is the one-slot handoff between
 * them: whichever composer opened the panel owns the handler.
 */

import type { LibraryGif } from '../Chat/gifs/libraryGifs';

type EmojiHandler = (emoji: string) => void;
type GifHandler = (gif: LibraryGif) => void;

let handler: EmojiHandler | null = null;
let gifHandler: GifHandler | null = null;

export function setEmojiPanelHandler(next: EmojiHandler | null): void {
  handler = next;
}

export function emitEmojiPanelSelection(emoji: string): void {
  handler?.(emoji);
}

export function setGifPanelHandler(next: GifHandler | null): void {
  gifHandler = next;
}

export function emitGifPanelSelection(gif: LibraryGif): void {
  gifHandler?.(gif);
}

let suppressComposerKeyboardUntil = 0;

const isComposerField = (el: HTMLElement | null) =>
  Boolean(
    el &&
      (el.closest('.ProseMirror') ||
        el.isContentEditable ||
        el.getAttribute('contenteditable') === 'true')
  );

const isPanelField = (el: HTMLElement | null) =>
  Boolean(
    el && (el.closest('[data-emoji-panel]') || el.closest('.emoji-picker'))
  );

/**
 * Mode switches must not summon the OS keyboard. Android restores focus to the
 * last input (composer or a search box) when a pane is hidden; blur that and
 * ignore composer focus for a short beat.
 */
export function keepPanelKeyboardDown(): void {
  suppressComposerKeyboardUntil = Date.now() + 400;
  const active = document.activeElement as HTMLElement | null;
  if (isPanelField(active) || isComposerField(active)) {
    active?.blur();
  }
  const blurStolenFocus = (includePanel: boolean) => {
    if (Date.now() > suppressComposerKeyboardUntil) return;
    const el = document.activeElement as HTMLElement | null;
    if (isComposerField(el) || (includePanel && isPanelField(el))) {
      el?.blur();
    }
  };
  window.requestAnimationFrame(() => blurStolenFocus(true));
  window.setTimeout(() => blurStolenFocus(false), 50);
  window.setTimeout(() => blurStolenFocus(false), 200);
}

export function isPanelKeyboardSuppressed(): boolean {
  return Date.now() < suppressComposerKeyboardUntil;
}
