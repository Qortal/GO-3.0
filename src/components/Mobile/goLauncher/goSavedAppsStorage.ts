import { getData, storeData } from '../../../utils/chromeStorage';
import { findBookmarksForAddress } from '../../Apps/AppBookmarks/bookmarkStorage';
import {
  bookmarkItemKey,
  isFolderItemKey,
  loadLauncherView,
} from '../../Apps/AppsLauncher/launcherItems';
import { launcherSyncMarkKey } from '../../Apps/AppsLauncher/launcherQdn';

/**
 * Where a phone keeps what it records of the account's saved apps
 * (savedAppsSync.ts: `ext_saved_apps:<address>` and
 * `ext_saved_apps_qdn:<address>`): in GO's encrypted storage, next to the
 * bookmarks whose names and pages they hold. If that storage can't be read,
 * neither can the bookmarks, and the saved apps start again from QDN's copy
 * the way a new device does, instead of taking the missing bookmarks for
 * removals.
 *
 * Hub's code reads and writes them as it does localStorage, so each key is
 * read into memory first (`loadGoSavedAppsKeys`, before every read of the
 * saved apps) and written behind, one write after another.
 */
const memory = new Map<string, string | null>();
const loading = new Map<string, Promise<void>>();
let writing: Promise<unknown> = Promise.resolve();

export const goSavedAppsStorage: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => {
    memory.set(key, value);
    writing = writing
      .then(() => storeData(key, value))
      .catch((error) => {
        // Kept in memory for this run; a full storage never stops a sign-in.
        console.error('Error keeping the saved apps:', error);
      });
  },
};

const load = (key: string): Promise<void> => {
  if (memory.has(key)) return Promise.resolve();
  let pending = loading.get(key);
  if (!pending) {
    pending = getData<unknown>(key)
      .then((value) => {
        // Written meanwhile: that is newer than what was read.
        if (memory.has(key)) return;
        memory.set(key, typeof value === 'string' ? value : null);
      })
      .finally(() => loading.delete(key));
    loading.set(key, pending);
  }
  return pending;
};

/** Reads these keys into memory, once per run. */
export const loadGoSavedAppsKeys = async (keys: string[]): Promise<void> => {
  await Promise.all(keys.map(load));
};

const checked = new Set<string>();

/**
 * Whether the account's bookmarks were lost on this phone: the launcher's
 * order (kept in localStorage) still names folders or bookmarks, but GO's
 * encrypted storage holds none for the account, as when that storage can no
 * longer be read. A store emptied by hand keeps the account's entry.
 */
const bookmarksLost = async (address: string): Promise<boolean> => {
  const named = loadLauncherView(address).order.some(
    (key) => isFolderItemKey(key) || key.startsWith(bookmarkItemKey(''))
  );
  if (!named) return false;
  return !(await findBookmarksForAddress(address));
};

/**
 * Before the saved apps are read, once per account and run: when this
 * phone's bookmarks were lost, what it recorded of them is forgotten too (the
 * saved apps' records and #374's mark of what it took in), so the next
 * take-in starts again from QDN's copy as a new device does. Recorded from
 * the empty store, every bookmark and folder would count as removed and be
 * removed on every device by the next save.
 */
export const forgetLauncherIfBookmarksLost = async (
  address: string,
  recordKeys: string[]
): Promise<void> => {
  if (checked.has(address)) return;
  if (await bookmarksLost(address)) {
    console.warn(
      'The bookmarks on this phone were lost: they are taken from QDN again.'
    );
    for (const key of recordKeys) goSavedAppsStorage.setItem(key, 'null');
    try {
      localStorage.removeItem(launcherSyncMarkKey(address));
    } catch (error) {
      console.error(error);
    }
  }
  checked.add(address);
};

/** Every write handed over so far has landed (or failed). */
export const goSavedAppsWritesDone = (): Promise<unknown> => writing;

/** Forgets what was read, as a new run would. For tests. */
export const resetGoSavedAppsStorage = (): void => {
  memory.clear();
  loading.clear();
  checked.clear();
  writing = Promise.resolve();
};
