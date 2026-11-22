/**
 * Torq is the app Home posts to and shows: the feed window and the composer
 * at its top, the Featured Q-Apps tile and the Android share-sheet entry.
 * Home once offered Quitter too, through a Torq | Quitter switch; it is Torq
 * only now, as on Hub. A phone that had chosen Quitter moves to Torq at its
 * next start (syncComposerShareTarget).
 */
import { ShareReceiver } from '../../../plugins/ShareReceiver';

export const HOME_POST_APP = 'Torq';

/** Where the old switch kept its choice. Nothing reads it any more. */
const LEGACY_TARGET_STORAGE_KEY = 'go-home-composer-target';

/**
 * Show "Torq" and "Torq Rev" in the Android share sheet (once per boot):
 * a phone that had chosen Quitter still shows "Quitter" there until told.
 */
export function syncComposerShareTarget(): void {
  try {
    localStorage.removeItem(LEGACY_TARGET_STORAGE_KEY);
  } catch {
    // private mode / blocked storage: nothing was kept there either
  }
  void ShareReceiver.setShareTarget('torq');
}
