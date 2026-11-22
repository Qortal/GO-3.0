import { atom, type ExtractAtomValue, type useStore } from 'jotai';
import ShortUniqueId from 'short-unique-id';
import {
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../../atoms/global';
import {
  getPinnedAppKey,
  type PinnedApp,
} from '../../../utils/pinnedAppsSettings';
import {
  loadBookmarksForAddress,
  saveBookmarksForAddress,
} from '../../Apps/AppBookmarks/bookmarkStorage';
import type { AppBookmarksForAddress } from '../../Apps/AppBookmarks/bookmarkTypes';
import {
  type LauncherView,
  loadLauncherView,
} from '../../Apps/AppsLauncher/launcherItems';
import { launcherEditsAtom } from '../../Apps/AppsLauncher/launcherQdnSync';
import { saveToLocalStorage } from '../../Apps/AppsNavBarDesktop';
import { getFolderRow, getFolderSize } from '../mobileTabOrganization';
import {
  ensureMobileTabOrganizationLoaded,
  mobileTabOrganizationStateAtom,
  updateMobileTabOrganization,
} from '../mobileTabOrganizationStore';
import { moveTabFoldersToBookmarks } from '../tabFoldersToBookmarks';
import type { FolderLooks } from './goLauncherOps';

type JotaiStore = ReturnType<typeof useStore>;
/** The pin list's type in the atom (its default is public apps only). */
type StoredPins = ExtractAtomValue<typeof sortablePinnedAppsAtom>;

/**
 * The signed-in account's bookmarks and bookmark folders, shared by the
 * Pinned tab and the Tabs panel. `data` is null until read, and stays null
 * when they could not be read: then nothing is written over them.
 */
export type GoBookmarksState = {
  address: string;
  data: AppBookmarksForAddress | null;
  ready: boolean;
};

export const goBookmarksStateAtom = atom<GoBookmarksState>({
  address: '',
  data: null,
  ready: false,
});

/** The same ids as the bookmarks menu makes. */
const uid = new ShortUniqueId({ length: 10 });
export const newBookmarkId = () => uid.rnd();

const loads = new WeakMap<
  JotaiStore,
  { address: string; promise: Promise<void> }
>();
const writes = new WeakMap<
  JotaiStore,
  { address: string; pending: number; chain: Promise<unknown> }
>();

/** How many writes were handed over, per store: a read older than one is stale. */
const writeCounts = new WeakMap<JotaiStore, number>();
const writeCountOf = (store: JotaiStore) => writeCounts.get(store) ?? 0;

const isWriting = (store: JotaiStore, address: string) => {
  const current = writes.get(store);
  return current?.address === address && current.pending > 0;
};

/** Reads the bookmarks; one read at a time per account. */
function readBookmarks(store: JotaiStore, address: string): Promise<void> {
  const pending = loads.get(store);
  if (pending?.address === address) return pending.promise;
  const promise = (async () => {
    const writesBefore = writeCountOf(store);
    let data: AppBookmarksForAddress | null = null;
    try {
      data = await loadBookmarksForAddress(address);
    } catch (error) {
      console.error('Failed to read the bookmarks', error);
    }
    // Another account since, or a change made here that is newer.
    if (store.get(goBookmarksStateAtom).address !== address) return;
    if (isWriting(store, address)) return;
    // Written since this read began (shown when it was handed over): what
    // was read may be older.
    if (writeCountOf(store) !== writesBefore) return;
    store.set(goBookmarksStateAtom, { address, data, ready: true });
  })().finally(() => {
    if (loads.get(store)?.promise === promise) loads.delete(store);
  });
  loads.set(store, { address, promise });
  return promise;
}

export function ensureGoBookmarksLoaded(
  store: JotaiStore,
  address: string
): Promise<void> {
  const state = store.get(goBookmarksStateAtom);
  // Read, unless the last read failed: then it is tried again.
  if (state.address === address && state.ready && state.data) {
    return Promise.resolve();
  }
  if (state.address !== address) {
    store.set(goBookmarksStateAtom, { address, data: null, ready: false });
  }
  return readBookmarks(store, address);
}

/**
 * Reads the bookmarks again after they changed somewhere else (the arrangement
 * saved on QDN taken in). A change made here and still being written wins.
 */
export function reloadGoBookmarks(
  store: JotaiStore,
  address: string
): Promise<void> {
  if (store.get(goBookmarksStateAtom).address !== address) {
    return Promise.resolve();
  }
  if (isWriting(store, address)) return Promise.resolve();
  return readBookmarks(store, address);
}

/**
 * Writes bookmarks after the writes already handed over, and shows them at
 * once when `show`. Answers what was stored; rejects when it couldn't be.
 */
function queueBookmarksWrite(
  store: JotaiStore,
  address: string,
  next: AppBookmarksForAddress,
  show: boolean
): Promise<AppBookmarksForAddress> {
  if (show) {
    store.set(goBookmarksStateAtom, { address, data: next, ready: true });
  }
  let current = writes.get(store);
  if (!current || current.address !== address) {
    current = {
      address,
      pending: 0,
      chain: current?.chain ?? Promise.resolve(),
    };
    writes.set(store, current);
  }
  const entry = current;
  entry.pending += 1;
  writeCounts.set(store, writeCountOf(store) + 1);
  const done = entry.chain
    .then(() => saveBookmarksForAddress(address, next))
    .then(
      (stored) => {
        entry.pending -= 1;
        return stored;
      },
      (error) => {
        entry.pending -= 1;
        throw error;
      }
    );
  // The next write waits for this one, whether it worked or not.
  entry.chain = done.catch(() => undefined);
  return done;
}

/**
 * Shows the new bookmarks at once and writes them behind, one write after
 * another in the order they were made.
 */
export function saveGoBookmarks(
  store: JotaiStore,
  address: string,
  next: AppBookmarksForAddress
): Promise<void> {
  if (!address) return Promise.resolve();
  return queueBookmarksWrite(store, address, next, true).then(
    () => undefined,
    (error) => {
      console.error('Failed to save the bookmarks', error);
      // Show what is really stored.
      void reloadGoBookmarks(store, address);
    }
  );
}

/**
 * The account's bookmarks as stored, read once the writes made here have
 * landed: what the account's saved apps record is what GO shows.
 */
export async function readGoBookmarksSettled(
  store: JotaiStore,
  address: string
): Promise<AppBookmarksForAddress> {
  const current = writes.get(store);
  if (current?.address === address) await current.chain;
  return loadBookmarksForAddress(address);
}

/**
 * Writes the bookmarks the account's saved apps decided (another device's
 * changes taken in), after the writes made here, and shows them at once on
 * the account shown. Answers what was stored; rejects when it couldn't be, so
 * nothing is kept as shown that isn't.
 */
export function writeGoBookmarksInOrder(
  store: JotaiStore,
  address: string,
  next: AppBookmarksForAddress
): Promise<AppBookmarksForAddress> {
  const shown = store.get(goBookmarksStateAtom).address === address;
  return queueBookmarksWrite(store, address, next, shown).catch((error) => {
    // Show what is really stored.
    void reloadGoBookmarks(store, address);
    throw error;
  });
}

/** Pins added to the account's list, saved like a pin made by hand. */
export function addPins(store: JotaiStore, apps: PinnedApp[]): number {
  if (!apps.length) return 0;
  const current = (store.get(sortablePinnedAppsAtom) ?? []) as PinnedApp[];
  const known = new Set(current.map((app) => getPinnedAppKey(app)));
  const added = apps.filter((app) => {
    const key = getPinnedAppKey(app);
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
  if (!added.length) return 0;
  const next = [...current, ...added];
  store.set(sortablePinnedAppsAtom, next as StoredPins);
  saveToLocalStorage('ext_saved_settings', 'sortablePinnedApps', next);
  store.set(settingsLocalLastUpdatedAtom, Date.now());
  return added.length;
}

/**
 * Accounts whose pin list from QDN was read this session: pins made by the
 * folder move can be added now without making the device's list look newer
 * than the one saved on QDN before it was read.
 */
const settledPinLists = new Set<string>();

export const isPinListSettled = (address: string) =>
  settledPinLists.has(address);

/** The pins the folder move held back, added now. */
export async function applyPendingPins(
  store: JotaiStore,
  address: string
): Promise<void> {
  await ensureMobileTabOrganizationLoaded(store, address);
  const state = store.get(mobileTabOrganizationStateAtom);
  if (state.walletAddress !== address) return;
  const pending = state.organization.pendingPins;
  if (!pending?.length) return;
  addPins(store, pending as PinnedApp[]);
  updateMobileTabOrganization(store, address, (prev) => {
    if (!prev.pendingPins) return prev;
    const { pendingPins: _done, ...rest } = prev;
    return rest;
  });
}

/** The sign-in read of the QDN settings decided the pin list. */
export async function settlePinList(
  store: JotaiStore,
  address: string
): Promise<void> {
  settledPinLists.add(address);
  await applyPendingPins(store, address);
}

const readies = new WeakMap<
  JotaiStore,
  { address: string; promise: Promise<void> }
>();

type ReadyOptions = {
  /** Sets the launcher's view (order), as `useSetLauncherViewOf` does. */
  setView: (address: string, view: LauncherView) => void;
  /** The pin list is decided: pins the move makes can be added now. */
  pinListSettled: boolean;
  now?: () => number;
};

/**
 * Loads GO's saved apps for an account and, once, moves the Tabs folders
 * GO had before into bookmark folders, where the desktop Hub sees them
 * after a save. The move offers to save, as a change on the launcher does.
 */
export function ensureGoLauncherReady(
  store: JotaiStore,
  address: string,
  options: ReadyOptions
): Promise<void> {
  const pending = readies.get(store);
  if (pending?.address === address) return pending.promise;
  const forget = () => {
    // Tried again on the next call.
    if (readies.get(store)?.promise === promise) readies.delete(store);
  };
  const promise: Promise<void> = prepare(store, address, options).then(
    (done) => {
      if (!done) forget();
    },
    (error) => {
      console.error('Failed to prepare the saved apps', error);
      forget();
    }
  );
  readies.set(store, { address, promise });
  return promise;
}

/** False when it could not finish: the stores were not read. */
async function prepare(
  store: JotaiStore,
  address: string,
  { setView, pinListSettled, now = Date.now }: ReadyOptions
): Promise<boolean> {
  await Promise.all([
    ensureMobileTabOrganizationLoaded(store, address),
    ensureGoBookmarksLoaded(store, address),
  ]);
  const orgState = store.get(mobileTabOrganizationStateAtom);
  const bookmarksState = store.get(goBookmarksStateAtom);
  if (orgState.walletAddress !== address || !orgState.ready) return false;
  if (bookmarksState.address !== address || !bookmarksState.data) {
    return false;
  }

  const organization = orgState.organization;
  if (organization.movedToBookmarks) {
    if (pinListSettled) await applyPendingPins(store, address);
    return true;
  }

  if (!organization.folders.length) {
    updateMobileTabOrganization(store, address, (prev) =>
      prev.movedToBookmarks ? prev : { ...prev, movedToBookmarks: true }
    );
    return true;
  }

  const view = loadLauncherView(address);
  const pins = (store.get(sortablePinnedAppsAtom) ?? []) as PinnedApp[];
  const moved = moveTabFoldersToBookmarks(
    organization,
    bookmarksState.data,
    view.order,
    pins,
    { now: now(), newId: newBookmarkId }
  );

  await saveGoBookmarks(store, address, moved.data);
  setView(address, { ...view, order: moved.order });

  const addedPins = moved.pins.slice(pins.length);
  if (pinListSettled) addPins(store, addedPins);

  const folderLooks: FolderLooks = { ...(organization.folderLooks ?? {}) };
  for (const folder of organization.folders) {
    const target = moved.folderIdOf[folder.id];
    if (!target || folderLooks[target]) continue;
    folderLooks[target] = {
      ...(getFolderSize(folder) === 'small' ? { size: 'small' } : {}),
      row: getFolderRow(folder),
    };
  }
  updateMobileTabOrganization(store, address, (prev) => ({
    ...prev,
    movedToBookmarks: true,
    folderLooks,
    ...(!pinListSettled && addedPins.length
      ? { pendingPins: [...(prev.pendingPins ?? []), ...addedPins] }
      : {}),
  }));

  // The folders are on this phone only until saved: offer to save them.
  store.set(launcherEditsAtom, (edits) => ({
    address,
    count: edits.address === address ? edits.count + 1 : 1,
  }));
  return true;
}
