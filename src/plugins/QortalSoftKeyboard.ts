import { Capacitor, registerPlugin } from '@capacitor/core';

export interface QortalSoftKeyboardPlugin {
  show(): Promise<void>;
}

const QortalSoftKeyboard =
  registerPlugin<QortalSoftKeyboardPlugin>('QortalSoftKeyboard');

/**
 * Ask Android to raise the soft keyboard for whatever the WebView has focused.
 * Re-focusing an element that never lost focus does not do it; only the
 * platform can, and it is a no-op when nothing editable is focused.
 */
export async function showSoftKeyboard(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await QortalSoftKeyboard.show();
  } catch {
    /* older native shell without the plugin */
  }
}
