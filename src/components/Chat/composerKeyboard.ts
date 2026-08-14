import type { Editor } from '@tiptap/react';
import { getSoftKeyboardInset } from '../../hooks/useSoftKeyboardInset';
import { showSoftKeyboard } from '../../plugins/QortalSoftKeyboard';

/**
 * Modal questions only — menus and popovers sit beside the composer and are
 * meant to be used with the keyboard still up, so they are not matched here.
 */
const DIALOG_SELECTOR = '.MuiDialog-root, [role="dialog"]';
const DIALOG_POLL_MS = 400;
/** Long enough for a decision, short enough not to outlive the intent. */
const DIALOG_WAIT_MS = 20_000;

/**
 * Carry on typing after using one of the composer's own controls.
 *
 * Android takes the keyboard away for reasons the page cannot always see or
 * prevent — a menu opening over the composer, a chip being removed, the file
 * picker coming and going. Preventing the blur is the first defence; this is
 * the repair for when it happens anyway: put the caret back and ask the
 * platform for the keyboard, twice, since the first ask can land while the
 * window is still settling.
 *
 * Only runs when the keyboard was actually up, so a control tapped by someone
 * who was not typing does not summon one. `force` is for the paths that
 * already know it was — the file picker, which closes it on the way out.
 */
export const restoreComposerTyping = (
  editor: Editor | null | undefined,
  { force = false }: { force?: boolean } = {}
): void => {
  if (!force && getSoftKeyboardInset() <= 0) return;
  const deadline = Date.now() + DIALOG_WAIT_MS;
  const ask = () => {
    if (!editor || editor.isDestroyed) return;
    if (!editor.isFocused) editor.commands.focus();
    void showSoftKeyboard();
  };
  const attempt = () => {
    if (!editor || editor.isDestroyed) return;
    // A dialog asking what to do with the file the user just picked owns the
    // screen: a keyboard raised over it would cover the very buttons it is
    // waiting on. Typing resumes once the question has been answered.
    if (document.querySelector(DIALOG_SELECTOR)) {
      if (Date.now() < deadline) window.setTimeout(attempt, DIALOG_POLL_MS);
      return;
    }
    ask();
    // Android can drop the first ask while the window is still settling.
    window.setTimeout(() => {
      if (!document.querySelector(DIALOG_SELECTOR)) ask();
    }, 250);
  };
  attempt();
};
