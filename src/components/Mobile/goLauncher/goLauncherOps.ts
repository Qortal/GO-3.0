import {
  buildBookmarkLink,
  getBookmarkCandidateFromTab,
  normalizeBookmarkPath,
} from '../../Apps/AppBookmarks/bookmarkStorage';
import type {
  AppBookmark,
  AppBookmarksForAddress,
} from '../../Apps/AppBookmarks/bookmarkTypes';
import {
  bookmarkItemKey,
  folderItemKey,
  type LauncherBookmarkItem,
  type LauncherFolderItem,
  type LauncherItem,
} from '../../Apps/AppsLauncher/launcherItems';
import {
  launcherPinLabel,
  type LauncherPin,
} from '../../Apps/AppsLauncher/launcherPins';
import {
  getOpenTabKey,
  pinnedAppToOpenTab,
  type FolderSize,
  type MobileTabOrganization,
  type TabFolder,
} from '../mobileTabOrganization';
import { isPrivateAppTab } from '../privateAppTabIdentity';
import type { OpenTab } from '../useOpenTabs';

/**
 * GO's saved apps are the desktop Hub's launcher: the pinned apps, the
 * bookmarks and the bookmark folders, in the launcher's order. The Pinned
 * tab shows them as Hub's launcher does; the Tabs panel shows the folders.
 * These helpers turn the launcher's tiles into what GO's Tabs work with
 * (saved tabs, keyed like open tabs), and back.
 */

/** How a folder looks on this phone only: its size and its Tabs row. */
export type FolderLook = { size?: 'small'; row?: number };
export type FolderLooks = Record<string, FolderLook>;

type SavedTab = MobileTabOrganization['savedTabs'][string];

const SAVED_PREFIX = 'saved:';

/**
 * The key a bookmark has in GO's Tabs. A bookmark of an app or of a page by
 * its identifier has the key an open window of it has, so the window is
 * found; a page inside an app has a key of its own.
 */
export function goKeyOfBookmark(bookmark: AppBookmark): string {
  if (normalizeBookmarkPath(bookmark.path)) {
    return bookmarkItemKey(bookmark.id);
  }
  return getOpenTabKey({
    service: bookmark.service,
    name: bookmark.appName,
    identifier: bookmark.identifier || undefined,
  });
}

/** A bookmark as a saved tab: opening it goes to the bookmarked page. */
export function shellOfBookmark(bookmark: AppBookmark): OpenTab {
  const path = normalizeBookmarkPath(bookmark.path);
  return {
    tabId: `${SAVED_PREFIX}${goKeyOfBookmark(bookmark)}`,
    service: bookmark.service,
    name: bookmark.appName,
    ...(bookmark.identifier ? { identifier: bookmark.identifier } : {}),
    ...(path ? { path } : {}),
    label: bookmark.name || bookmark.appName,
  };
}

/** A pinned app as a saved tab; a private one opens through its decrypt. */
export function shellOfPin(
  pin: LauncherPin,
  privateFallback: string
): OpenTab | null {
  const tab = pinnedAppToOpenTab({
    ...pin.app,
    label: launcherPinLabel(pin.app, privateFallback),
  });
  if (!tab) return null;
  return { ...tab, tabId: `${SAVED_PREFIX}${getOpenTabKey(tab)}` };
}

/** What a saved tab holds, from a shell. */
const savedTabOf = (shell: OpenTab): SavedTab => ({
  service: shell.service,
  name: shell.name,
  identifier:
    typeof shell.identifier === 'string' ? shell.identifier : undefined,
  path: typeof shell.path === 'string' ? shell.path : undefined,
  label: shell.label,
});

export const folderSizeOf = (looks: FolderLooks, folderId: string) =>
  (looks[folderId]?.size === 'small' ? 'small' : 'large') as FolderSize;

const rowOf = (looks: FolderLooks, folderId: string) => {
  const row = looks[folderId]?.row;
  return typeof row === 'number' && row >= 0 ? Math.floor(row) : 0;
};

/** A folder child of the launcher, by the key it has in GO's Tabs. */
export type GoFolderChild = { folderId: string; item: LauncherBookmarkItem };

/** The launcher's folders as GO's Tabs folders. */
export type GoFolders = {
  folders: TabFolder[];
  savedTabs: Record<string, SavedTab>;
  tabFolderMap: Record<string, string>;
  /** Every folder child by its key; a key shows once. */
  children: Map<string, GoFolderChild>;
};

/**
 * The folders of the launcher, in its order, as GO's Tabs folders: each
 * bookmark in a folder is a saved tab of it. Rows and sizes are how this
 * phone shows them; the order within a row is the launcher's.
 */
export function goFoldersOf(
  items: LauncherItem[],
  looks: FolderLooks
): GoFolders {
  const folders: TabFolder[] = [];
  const savedTabs: Record<string, SavedTab> = {};
  const tabFolderMap: Record<string, string> = {};
  const children = new Map<string, GoFolderChild>();
  const countByRow = new Map<number, number>();

  for (const item of items) {
    if (item.type !== 'folder') continue;
    const folderId = item.folder.id;
    const tabKeys: string[] = [];
    for (const child of item.children) {
      const key = goKeyOfBookmark(child.bookmark);
      if (children.has(key)) continue;
      children.set(key, { folderId, item: child });
      tabKeys.push(key);
      tabFolderMap[key] = folderId;
      savedTabs[key] = savedTabOf(shellOfBookmark(child.bookmark));
    }
    const row = rowOf(looks, folderId);
    const order = countByRow.get(row) ?? 0;
    countByRow.set(row, order + 1);
    folders.push({
      id: folderId,
      name: item.folder.name,
      tabKeys,
      order,
      row,
      ...(looks[folderId]?.size === 'small' ? { size: 'small' } : {}),
    });
  }
  return { folders, savedTabs, tabFolderMap, children };
}

/** The folder items of the launcher, in its order. */
export const folderItemsOf = (items: LauncherItem[]) =>
  items.filter((item): item is LauncherFolderItem => item.type === 'folder');

/**
 * The launcher's order with these folders put in this order, in the places
 * the folders take now: the pinned apps and bookmarks around them stay.
 */
export function orderWithFolders(
  items: LauncherItem[],
  folderIdsInOrder: string[]
): string[] {
  const keys = items.map((item) => item.key);
  const wanted = folderIdsInOrder.map(folderItemKey);
  const wantedSet = new Set(wanted);
  const slots = keys
    .map((key, index) => (wantedSet.has(key) ? index : -1))
    .filter((index) => index !== -1);
  const placed = wanted.filter((key) => keys.includes(key));
  const next = [...keys];
  slots.forEach((slot, index) => {
    next[slot] = placed[index];
  });
  return next;
}

/**
 * The launcher's order with one folder moved: in front of another folder, or
 * right after `afterFolderId`, or to the end.
 */
export function orderWithFolderMoved(
  items: LauncherItem[],
  folderId: string,
  place: { beforeFolderId?: string | null; afterFolderId?: string | null }
): string[] {
  const key = folderItemKey(folderId);
  const keys = items.map((item) => item.key).filter((entry) => entry !== key);
  if (place.beforeFolderId) {
    const index = keys.indexOf(folderItemKey(place.beforeFolderId));
    if (index !== -1) {
      keys.splice(index, 0, key);
      return keys;
    }
  }
  if (place.afterFolderId) {
    const index = keys.indexOf(folderItemKey(place.afterFolderId));
    if (index !== -1) {
      keys.splice(index + 1, 0, key);
      return keys;
    }
  }
  keys.push(key);
  return keys;
}

/**
 * A bookmark of the page an open tab shows, for a folder: what the
 * bookmarks menu would save. Private apps and GO's own pages have none.
 */
export function bookmarkOfTab(
  tab: OpenTab,
  folderId: string | null,
  { id, now, name }: { id: string; now: number; name?: string }
): AppBookmark | null {
  if (isPrivateAppTab(tab)) return null;
  const candidate = getBookmarkCandidateFromTab({
    tabId: typeof tab.tabId === 'string' ? tab.tabId : undefined,
    name: tab.name,
    service: tab.service,
    identifier: typeof tab.identifier === 'string' ? tab.identifier : undefined,
    path: typeof tab.path === 'string' ? tab.path : undefined,
    internal: tab.internal,
  });
  if (!candidate) return null;
  const target = {
    service: candidate.service,
    appName: candidate.appName,
    identifier: candidate.identifier || undefined,
    path: candidate.path,
  };
  return {
    id,
    name: (name || tab.label || candidate.appName).trim() || candidate.appName,
    service: target.service,
    appName: target.appName,
    ...(target.identifier ? { identifier: target.identifier } : {}),
    path: target.path,
    link: buildBookmarkLink(target),
    folderId,
    createdAt: now,
    updatedAt: now,
  };
}

/** The bookmarks with a folder's bookmarks in this order (by their keys). */
export function withFolderOrder(
  data: AppBookmarksForAddress,
  folderId: string,
  keysInOrder: string[],
  now: number
): AppBookmarksForAddress {
  const inFolder = data.bookmarks.filter(
    (bookmark) => bookmark.folderId === folderId
  );
  const byKey = new Map(
    inFolder.map((bookmark) => [goKeyOfBookmark(bookmark), bookmark])
  );
  const ordered = keysInOrder
    .map((key) => byKey.get(key))
    .filter((bookmark): bookmark is AppBookmark => Boolean(bookmark));
  const rest = inFolder.filter((bookmark) => !ordered.includes(bookmark));
  const next = [...ordered, ...rest];
  if (next.every((bookmark, index) => bookmark === inFolder[index])) {
    return data;
  }
  let index = 0;
  return {
    ...data,
    bookmarks: data.bookmarks.map((bookmark) =>
      bookmark.folderId === folderId ? next[index++] : bookmark
    ),
    updatedAt: now,
  };
}

/**
 * Every bookmark as one list of saved tabs, for what only needs the apps
 * (the app pictures fetched ahead of time), not their folders.
 */
export function bookmarksAsSavedTabs(data: AppBookmarksForAddress): {
  tabKeys: string[];
  savedTabs: Record<string, SavedTab>;
} {
  const tabKeys: string[] = [];
  const savedTabs: Record<string, SavedTab> = {};
  for (const bookmark of data.bookmarks) {
    const key = goKeyOfBookmark(bookmark);
    if (savedTabs[key]) continue;
    tabKeys.push(key);
    savedTabs[key] = savedTabOf(shellOfBookmark(bookmark));
  }
  return { tabKeys, savedTabs };
}
