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

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** A field that raises the OS keyboard of its own when tapped. */
const isTextEntry = (el: HTMLElement) => {
  const field = el.closest(
    'input, textarea, [contenteditable=""], [contenteditable="true"]'
  );
  if (!field) return false;
  if (field instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(field.type);
  }
  return true;
};

/**
 * Menus, popovers and dialogs opened from the composer's own controls. The
 * keyboard is put back after those (restoreComposerTyping), so the panel
 * standing in for it survives them too.
 */
const OVERLAY_SELECTOR =
  '.MuiModal-root, .MuiPopper-root, [role="dialog"], [role="menu"], [role="listbox"]';

/**
 * Close the panel on the taps that would have closed the OS keyboard.
 *
 * The keyboard goes away when a tap takes focus off the editor — the message
 * list, the header, any other button — and stays for the composer's own
 * controls, which cancel that focus change. A scroll is not a tap and fires no
 * mousedown, so the message list can still be scrolled with the panel up, as
 * it can with the keyboard. Returns the cleanup.
 */
export function closePanelOnOutsideTap(
  isComposerTarget: (target: HTMLElement) => boolean,
  close: () => void
): () => void {
  const timers = new Set<number>();
  const onMouseDown = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest) return;
    if (isPanelField(target) || isComposerTarget(target)) return;
    if (target.closest(OVERLAY_SELECTOR)) return;
    // Another text field takes the keyboard over; the composer's slot handoff
    // closes the panel once that keyboard has covered it.
    if (isTextEntry(target)) return;
    // Decide once the tap has been handled: a control that cancels the focus
    // change keeps the keyboard, so it keeps the panel as well.
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (!event.defaultPrevented) close();
    }, 0);
    timers.add(timer);
  };
  document.addEventListener('mousedown', onMouseDown, true);
  return () => {
    document.removeEventListener('mousedown', onMouseDown, true);
    timers.forEach((timer) => window.clearTimeout(timer));
  };
}
