import { useEffect } from 'react';
import { useAtomValue } from 'jotai';
import type { AppBookmarksForAddress } from '../../Apps/AppBookmarks/bookmarkTypes';
import {
  launcherEditsAtom,
  useCountLauncherEdit,
} from '../../Apps/AppsLauncher/launcherQdnSync';
import { useHasUnsavedSavedApps } from '../../Apps/AppsLauncher/savedAppsSync';

/**
 * Offers again to save what was left unsaved when GO last closed.
 *
 * The Pinned page's offer to save to QDN follows the changes made on the
 * launcher, and those are counted from zero each time GO starts. A phone has
 * no other Save, so pins, folders or bookmarks changed before GO was closed
 * (or crashed) stayed on the phone until the next change. Once the account's
 * settings on QDN are read, a launcher that still differs from them counts
 * as one change, the first of this run, as the desktop Hub's Save button
 * shows them unsaved at every start.
 */
export function useOfferUnsavedLauncher(
  address: string | null | undefined,
  bookmarks: AppBookmarksForAddress | null
) {
  const hasUnsaved = useHasUnsavedSavedApps(address, bookmarks);
  const edits = useAtomValue(launcherEditsAtom);
  const countEdit = useCountLauncherEdit(address || null);
  const account = address || null;
  const editCount = edits.address === account ? edits.count : 0;

  useEffect(() => {
    if (account && hasUnsaved && editCount === 0) countEdit();
  }, [account, countEdit, editCount, hasUnsaved]);
}
