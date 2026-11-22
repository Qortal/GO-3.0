import {
  buildBookmarkLink,
  getBookmarkKey,
  normalizeBookmarkPath,
} from '../Apps/AppBookmarks/bookmarkStorage';
import type {
  AppBookmark,
  AppBookmarkFolder,
  AppBookmarksForAddress,
} from '../Apps/AppBookmarks/bookmarkTypes';
import { folderItemKey } from '../Apps/AppsLauncher/launcherItems';
import {
  getPinnedAppKey,
  type PinnedApp,
} from '../../utils/pinnedAppsSettings';
import {
  sortFolders,
  type MobileTabOrganization,
} from './mobileTabOrganization';

/**
 * GO's Tabs folders, made into bookmark folders: the folders the desktop
 * Hub's launcher and bookmarks menu use, which the QDN settings carry from
 * one device to the other.
 *
 * - Each folder becomes a bookmark folder with the same id and name. A
 *   bookmark folder of the same name takes it in instead, as the merge of
 *   two saved arrangements does.
 * - Each app or website in it becomes a bookmark there. An app's start page
 *   is pinned as well, as the launcher does with an app put into a folder,
 *   so the pin list stays complete for Hubs that show pins only.
 * - A private app cannot be bookmarked: it is pinned, and shows with the
 *   other pinned apps. GO's own pages (Q-Chat) are left out.
 * - A page that already has a bookmark keeps that bookmark where it is: the
 *   bookmarks menu keeps one bookmark per page.
 */
export type TabFoldersMove = {
  data: AppBookmarksForAddress;
  /** The launcher's order, with the new folders after what it had. */
  order: string[];
  /** The pin list, with the apps that had to be pinned added at the end. */
  pins: PinnedApp[];
  /** How many apps and websites found a place. */
  moved: number;
  /** The bookmark folder each Tabs folder became, by the Tabs folder's id. */
  folderIdOf: Record<string, string>;
};

type SavedTab = MobileTabOrganization['savedTabs'][string];

type MovedItem =
  | {
      kind: 'bookmark';
      bookmark: Omit<AppBookmark, 'id' | 'folderId' | 'createdAt'>;
      /** The app's start page: the app is pinned too. */
      pin: PinnedApp | null;
    }
  | { kind: 'private'; pin: PinnedApp };

const folderNameKey = (name: string) => name.trim().toLocaleLowerCase();

const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

/** What a saved tab of a folder becomes, or null when it cannot move. */
export function tabFolderItemOf(
  tabKey: string,
  snapshot: SavedTab | undefined,
  customLabel: string | undefined,
  now: number
): MovedItem | null {
  if (tabKey.startsWith('internal:') || snapshot?.internal) return null;

  const [keyService = '', keyName = '', keyIdentifier = ''] = tabKey.split('|');
  const privateProperties = snapshot?.privateAppProperties as
    | Record<string, unknown>
    | undefined;

  if (snapshot?.isPrivate || privateProperties) {
    const name = text(privateProperties?.name) || text(snapshot?.name);
    const service =
      text(privateProperties?.service) || text(snapshot?.service) || 'APP';
    const identifier =
      text(privateProperties?.identifier) || text(snapshot?.identifier);
    if (!name || !identifier) return null;
    return {
      kind: 'private',
      pin: {
        isPrivate: true,
        isPreview: true,
        privateAppProperties: {
          name,
          service,
          identifier,
          groupId: privateProperties?.groupId as string | number | undefined,
          appName:
            text(privateProperties?.appName) ||
            customLabel ||
            text(snapshot?.label) ||
            name,
        },
      },
    };
  }

  const service = (text(snapshot?.service) || keyService).toUpperCase();
  const appName = (text(snapshot?.name) || keyName).trim();
  if (!service || !appName) return null;
  const identifier = text(snapshot?.identifier) || keyIdentifier || undefined;
  const path = normalizeBookmarkPath(text(snapshot?.path));
  const isStartPage = !identifier && !path;
  return {
    kind: 'bookmark',
    bookmark: {
      name: customLabel?.trim() || text(snapshot?.label).trim() || appName,
      service,
      appName,
      ...(identifier ? { identifier } : {}),
      path,
      link: buildBookmarkLink({ service, appName, identifier, path }),
      updatedAt: now,
    },
    pin: isStartPage ? { name: appName, service } : null,
  };
}

/**
 * Puts the Tabs folders into the bookmark folders. Nothing in `bookmarks`,
 * `order` or `pins` is taken away or moved; what the folders add comes after.
 */
export function moveTabFoldersToBookmarks(
  organization: MobileTabOrganization,
  bookmarks: AppBookmarksForAddress,
  order: string[],
  pins: PinnedApp[],
  { now, newId }: { now: number; newId: () => string }
): TabFoldersMove {
  const folders: AppBookmarkFolder[] = [...bookmarks.folders];
  const nextBookmarks: AppBookmark[] = [...bookmarks.bookmarks];
  const nextOrder = [...order];
  const nextPins = [...pins];

  const folderIds = new Set(folders.map((folder) => folder.id));
  const folderByName = new Map(
    folders.map((folder) => [folderNameKey(folder.name), folder.id])
  );
  const places = new Set(nextBookmarks.map((entry) => getBookmarkKey(entry)));
  const bookmarkIds = new Set(nextBookmarks.map((entry) => entry.id));
  const pinKeys = new Set(nextPins.map((pin) => getPinnedAppKey(pin)));
  const inOrder = new Set(nextOrder);
  const folderIdOf: Record<string, string> = {};
  let moved = 0;

  const pin = (app: PinnedApp) => {
    const key = getPinnedAppKey(app);
    if (pinKeys.has(key)) return;
    pinKeys.add(key);
    nextPins.push(app);
  };

  const uniqueId = () => {
    let id = newId();
    while (bookmarkIds.has(id)) id = newId();
    bookmarkIds.add(id);
    return id;
  };

  for (const tabFolder of sortFolders(organization.folders)) {
    const name = tabFolder.name.trim() || tabFolder.name;
    let folderId = folderIds.has(tabFolder.id)
      ? tabFolder.id
      : folderByName.get(folderNameKey(name));
    if (!folderId) {
      folderId = tabFolder.id;
      folders.push({ id: folderId, name, createdAt: now, updatedAt: now });
      folderIds.add(folderId);
      folderByName.set(folderNameKey(name), folderId);
    }
    folderIdOf[tabFolder.id] = folderId;
    const key = folderItemKey(folderId);
    if (!inOrder.has(key)) {
      nextOrder.push(key);
      inOrder.add(key);
    }

    for (const tabKey of tabFolder.tabKeys) {
      const item = tabFolderItemOf(
        tabKey,
        organization.savedTabs[tabKey],
        organization.tabOverrides[tabKey]?.customLabel,
        now
      );
      if (!item) continue;
      moved += 1;
      if (item.kind === 'private') {
        pin(item.pin);
        continue;
      }
      if (item.pin) pin(item.pin);
      const place = getBookmarkKey(item.bookmark);
      if (places.has(place)) continue;
      places.add(place);
      nextBookmarks.push({
        ...item.bookmark,
        id: uniqueId(),
        folderId,
        createdAt: now,
      });
    }
  }

  return {
    data: { folders, bookmarks: nextBookmarks, updatedAt: now },
    order: nextOrder,
    pins: nextPins,
    moved,
    folderIdOf,
  };
}
