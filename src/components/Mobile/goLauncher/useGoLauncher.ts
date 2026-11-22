import { useCallback, useEffect, useMemo } from 'react';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import { availableQappsAtom } from '../../../atoms/appsAtoms';
import {
  isUsingImportExportSettingsAtom,
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
  userInfoAtom,
} from '../../../atoms/global';
import { subscribeToEvent, unsubscribeFromEvent } from '../../../utils/events';
import type { PinnedApp } from '../../../utils/pinnedAppsSettings';
import {
  APP_BOOKMARKS_CHANGED_EVENT,
  buildBookmarkLink,
  getBookmarkKey,
  normalizeBookmarkPath,
} from '../../Apps/AppBookmarks/bookmarkStorage';
import type {
  AppBookmark,
  AppBookmarksForAddress,
} from '../../Apps/AppBookmarks/bookmarkTypes';
import {
  applyLauncherDrop,
  bookmarkItemKey,
  buildLauncherItems,
  createFolderWithItem,
  folderItemKey,
  type LauncherArrangement,
  type LauncherChangeContext,
  type LauncherDrop,
  moveItemToFolder,
  removeFolderItem,
  removeItem,
  removeItemFromFolder,
  renameFolder as renameFolderIn,
  sameBookmarkLayout,
} from '../../Apps/AppsLauncher/launcherItems';
import {
  buildLauncherPins,
  type LauncherPin,
  launcherPinLabel,
  toStoredPin,
} from '../../Apps/AppsLauncher/launcherPins';
import { useCountLauncherEdit } from '../../Apps/AppsLauncher/launcherQdnSync';
import {
  useLauncherView,
  useSetLauncherViewOf,
} from '../../Apps/AppsLauncher/useLauncherView';
import { saveToLocalStorage } from '../../Apps/AppsNavBarDesktop';
import {
  mobileTabOrganizationStateAtom,
  updateMobileTabOrganization,
} from '../mobileTabOrganizationStore';
import type { OpenTab } from '../useOpenTabs';
import { getOpenTabKey } from '../mobileTabOrganization';
import {
  bookmarkOfTab,
  type FolderLook,
  type FolderLooks,
  goFoldersOf,
  goKeyOfBookmark,
  orderWithFolderMoved,
  orderWithFolders,
  withFolderOrder,
} from './goLauncherOps';
import {
  applyPendingPins,
  ensureGoLauncherReady,
  goBookmarksStateAtom,
  isPinListSettled,
  newBookmarkId,
  reloadGoBookmarks,
  saveGoBookmarks,
} from './goLauncherStore';

const EMPTY_LOOKS: FolderLooks = {};

const sameKeys = (a: string[], b: string[]) =>
  a.length === b.length && a.every((key, index) => key === b[index]);

/** A pinned app's key, as the launcher keys it, for a tab of the app. */
const appKeyOfTab = (tab: OpenTab) =>
  `${String(tab.service || 'APP').toUpperCase()}-${String(tab.name || '')}`.toLowerCase();

/**
 * GO's saved apps, as the desktop Hub's launcher keeps them: the pinned
 * apps, the bookmarks and the bookmark folders, in the launcher's order.
 * Every change goes through the launcher's own rules (an app put into a
 * folder stays pinned and gets a bookmark of its start page there, and so
 * on) and counts as a change to offer to save to QDN.
 */
export function useGoLauncher() {
  const { t } = useTranslation(['core']);
  const store = useStore();
  const userInfo = useAtomValue(userInfoAtom);
  const address: string = userInfo?.address || '';
  const myName: string = userInfo?.name || '';
  const isUsingImportExport = useAtomValue(isUsingImportExportSettingsAtom);
  const availableQapps = useAtomValue(availableQappsAtom) as PinnedApp[];
  const [pinnedApps, setPinnedApps] = useAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);
  const bookmarksState = useAtomValue(goBookmarksStateAtom);
  const orgState = useAtomValue(mobileTabOrganizationStateAtom);
  const [view, setView] = useLauncherView(address || null);
  const setViewOf = useSetLauncherViewOf();
  const countEdit = useCountLauncherEdit(address || null);

  // Accounts without a name have no settings on QDN: nothing to wait for.
  const pinListSettled =
    !myName || isUsingImportExport === true || isPinListSettled(address);
  useEffect(() => {
    if (!address) return;
    void ensureGoLauncherReady(store, address, {
      setView: setViewOf,
      pinListSettled,
    }).then(() => {
      if (pinListSettled) void applyPendingPins(store, address);
    });
  }, [address, pinListSettled, setViewOf, store]);

  // Changed somewhere else, as by the arrangement taken in from QDN.
  useEffect(() => {
    if (!address) return;
    const onChanged = (event: CustomEvent<{ address?: string }>) => {
      if (event.detail?.address === address) {
        void reloadGoBookmarks(store, address);
      }
    };
    subscribeToEvent(APP_BOOKMARKS_CHANGED_EVENT, onChanged);
    return () => unsubscribeFromEvent(APP_BOOKMARKS_CHANGED_EVENT, onChanged);
  }, [address, store]);

  const isOwnBookmarks = !!address && bookmarksState.address === address;
  const bookmarks = isOwnBookmarks ? bookmarksState.data : null;
  const isOwnOrganization = !!address && orgState.walletAddress === address;
  const looks =
    (isOwnOrganization && orgState.organization.folderLooks) || EMPTY_LOOKS;
  const ready =
    isOwnBookmarks &&
    bookmarksState.ready &&
    isOwnOrganization &&
    orgState.ready &&
    (orgState.organization.movedToBookmarks === true || !bookmarks);

  const myApp = useMemo(
    () =>
      availableQapps.find(
        (app) => app?.name === myName && app?.service === 'APP'
      ) ?? null,
    [availableQapps, myName]
  );
  const myWebsite = useMemo(
    () =>
      availableQapps.find(
        (app) => app?.name === myName && app?.service === 'WEBSITE'
      ) ?? null,
    [availableQapps, myName]
  );
  const pins = useMemo(
    () =>
      buildLauncherPins(
        pinnedApps as PinnedApp[],
        availableQapps,
        myApp,
        myWebsite
      ),
    [availableQapps, myApp, myWebsite, pinnedApps]
  );
  const pinsByKey = useMemo(
    () => new Map(pins.map((pin) => [pin.key, pin])),
    [pins]
  );
  const items = useMemo(
    () => buildLauncherItems(pins, bookmarks, view),
    [bookmarks, pins, view]
  );
  const goFolders = useMemo(() => goFoldersOf(items, looks), [items, looks]);

  const pinLabelFallback = t('core:app_private', {
    postProcess: 'capitalizeFirstChar',
  });
  const newFolderName = t('core:bookmarks.new_folder');

  const saveBookmarks = useCallback(
    (next: AppBookmarksForAddress) => {
      if (!address || !bookmarks) return false;
      void saveGoBookmarks(store, address, next);
      return true;
    },
    [address, bookmarks, store]
  );

  /** What a change works from: the stores as they are, and new ids. */
  const changeContext = useCallback(
    (folderName?: string): LauncherChangeContext => {
      const now = Date.now();
      return {
        data: bookmarks,
        view,
        newFolder: { id: newBookmarkId(), name: folderName || newFolderName },
        // An app in a folder is a bookmark of the app's start page.
        makeBookmark: (pin: LauncherPin): AppBookmark => {
          const target = {
            service: String(pin.app.service),
            appName: String(pin.app.name),
            path: '',
          };
          return {
            ...target,
            id: newBookmarkId(),
            name: launcherPinLabel(pin.app, pinLabelFallback),
            link: buildBookmarkLink(target),
            folderId: null,
            createdAt: now,
            updatedAt: now,
          };
        },
        now,
      };
    },
    [bookmarks, newFolderName, pinLabelFallback, view]
  );

  /** Saves what a change left behind; false when nothing could be done. */
  const applyArrangement = useCallback(
    (arrangement: LauncherArrangement | null) => {
      if (!arrangement || !address) return false;
      const storeChanged = !sameBookmarkLayout(arrangement.data, bookmarks);
      // The bookmarks could not be read: nothing is written over them.
      if (storeChanged && !bookmarks) return false;

      const pinsChanged = !sameKeys(
        arrangement.pinOrder,
        pins.map((pin) => pin.key)
      );
      if (pinsChanged) {
        // The pin list keeps every app, a folder's apps where the folder
        // stands, so the list saved on QDN has them all.
        const stored = arrangement.pinOrder.flatMap((key) => {
          const pin = pinsByKey.get(key);
          return pin ? [toStoredPin(pin.app)] : [];
        });
        setPinnedApps(stored as typeof pinnedApps);
        saveToLocalStorage('ext_saved_settings', 'sortablePinnedApps', stored);
        setSettingsLocalLastUpdated(Date.now());
      }
      if (storeChanged) void saveGoBookmarks(store, address, arrangement.data);
      const orderChanged = !sameKeys(arrangement.view.order, view.order);
      setView(arrangement.view);
      // Something to save to QDN: the window that offers it shows.
      if (pinsChanged || storeChanged || orderChanged) countEdit();
      return true;
    },
    [
      address,
      bookmarks,
      countEdit,
      pins,
      pinsByKey,
      setPinnedApps,
      setSettingsLocalLastUpdated,
      setView,
      store,
      view.order,
    ]
  );

  /**
   * Applies a change made with the launcher's rules. Returns the folder it
   * made, if any, or null when nothing changed.
   */
  const applyChange = useCallback(
    (
      change: (context: LauncherChangeContext) => LauncherArrangement | null,
      folderName?: string
    ): { madeFolderId: string | null } | null => {
      const context = changeContext(folderName);
      const arrangement = change(context);
      if (!applyArrangement(arrangement)) return null;
      const madeFolder = arrangement!.data.folders.some(
        (folder) => folder.id === context.newFolder.id
      );
      return { madeFolderId: madeFolder ? context.newFolder.id : null };
    },
    [applyArrangement, changeContext]
  );

  const drop = useCallback(
    (activeKey: string, target: LauncherDrop) =>
      applyChange((context) =>
        applyLauncherDrop(items, activeKey, target, context)
      ),
    [applyChange, items]
  );

  const moveToFolder = useCallback(
    (key: string, folderId: string) =>
      applyChange((context) => moveItemToFolder(items, key, folderId, context)),
    [applyChange, items]
  );

  const newFolderWith = useCallback(
    (key: string, folderName?: string) =>
      applyChange(
        (context) => createFolderWithItem(items, key, context),
        folderName
      ),
    [applyChange, items]
  );

  const takeOutOfFolder = useCallback(
    (key: string) =>
      applyChange((context) => removeItemFromFolder(items, key, context)),
    [applyChange, items]
  );

  /** Unpins an app, or removes a bookmark. */
  const remove = useCallback(
    (key: string) => applyChange((context) => removeItem(items, key, context)),
    [applyChange, items]
  );

  /** Removes a folder; what was in it stays, in the row where it stood. */
  const deleteFolder = useCallback(
    (folderId: string) =>
      applyChange((context) => removeFolderItem(items, folderId, context)),
    [applyChange, items]
  );

  const renameFolder = useCallback(
    (folderId: string, name: string) => {
      if (!bookmarks) return;
      const renamed = renameFolderIn(bookmarks, folderId, name, Date.now());
      if (renamed === bookmarks) return;
      if (saveBookmarks(renamed)) countEdit();
    },
    [bookmarks, countEdit, saveBookmarks]
  );

  const renameBookmark = useCallback(
    (bookmarkId: string, name: string) => {
      const trimmed = name.trim();
      if (!bookmarks || !trimmed) return;
      const current = bookmarks.bookmarks.find(
        (bookmark) => bookmark.id === bookmarkId
      );
      if (!current || current.name === trimmed) return;
      const now = Date.now();
      const next = {
        ...bookmarks,
        bookmarks: bookmarks.bookmarks.map((bookmark) =>
          bookmark.id === bookmarkId
            ? { ...bookmark, name: trimmed, updatedAt: now }
            : bookmark
        ),
        updatedAt: now,
      };
      if (saveBookmarks(next)) countEdit();
    },
    [bookmarks, countEdit, saveBookmarks]
  );

  /** Points a bookmark at another page (its qortal:// address changed). */
  const moveBookmarkTo = useCallback(
    (
      bookmarkId: string,
      place: {
        service: string;
        appName: string;
        identifier?: string;
        path?: string;
      }
    ) => {
      if (!bookmarks || !place.service || !place.appName) return;
      const now = Date.now();
      const target = {
        service: place.service.toUpperCase(),
        appName: place.appName,
        identifier: place.identifier || undefined,
        path: normalizeBookmarkPath(place.path),
      };
      const next: AppBookmarksForAddress = {
        ...bookmarks,
        bookmarks: bookmarks.bookmarks.map((bookmark) => {
          if (bookmark.id !== bookmarkId) return bookmark;
          const { identifier: _identifier, ...rest } = bookmark;
          return {
            ...rest,
            service: target.service,
            appName: target.appName,
            ...(target.identifier ? { identifier: target.identifier } : {}),
            path: target.path,
            link: buildBookmarkLink(target),
            updatedAt: now,
          };
        }),
        updatedAt: now,
      };
      if (saveBookmarks(next)) countEdit();
    },
    [bookmarks, countEdit, saveBookmarks]
  );

  /** A new empty folder, at the end of the row. Returns its id. */
  const createFolder = useCallback(
    (name: string): string | null => {
      if (!bookmarks) return null;
      const now = Date.now();
      const id = newBookmarkId();
      const next: AppBookmarksForAddress = {
        ...bookmarks,
        folders: [
          ...bookmarks.folders,
          {
            id,
            name: name.trim() || newFolderName,
            createdAt: now,
            updatedAt: now,
          },
        ],
        updatedAt: now,
      };
      if (!saveBookmarks(next)) return null;
      setView({
        ...view,
        order: [...items.map((item) => item.key), folderItemKey(id)],
      });
      countEdit();
      return id;
    },
    [bookmarks, countEdit, items, newFolderName, saveBookmarks, setView, view]
  );

  /** The launcher's key of what holds the page a tab shows, if it is saved. */
  const savedKeyOfTab = useCallback(
    (tab: OpenTab): string | null => {
      const key = getOpenTabKey(tab);
      const isSaved = String(tab.tabId || '').startsWith('saved:');
      const path = normalizeBookmarkPath(
        typeof tab.path === 'string' ? tab.path : ''
      );
      // An open window on a page inside an app: that page's bookmark, not
      // the app's (its key leaves the page out).
      if (path && !isSaved) {
        const place = getBookmarkKey({
          service: String(tab.service || 'APP'),
          appName: String(tab.name || ''),
          identifier:
            typeof tab.identifier === 'string' ? tab.identifier : undefined,
          path,
        });
        const page = bookmarks?.bookmarks.find(
          (bookmark) => getBookmarkKey(bookmark) === place
        );
        return page ? bookmarkItemKey(page.id) : null;
      }
      const child = goFolders.children.get(key);
      if (child) return child.item.key;
      const rowItem = items.find((item) => {
        if (item.type === 'bookmark') {
          return goKeyOfBookmark(item.bookmark) === key;
        }
        if (item.type === 'app') {
          return (
            !item.pin.app.isPrivate &&
            !tab.identifier &&
            !tab.path &&
            item.key.toLowerCase() === appKeyOfTab(tab)
          );
        }
        return false;
      });
      return rowItem?.key ?? null;
    },
    [bookmarks, goFolders.children, items]
  );

  /**
   * Puts the page a tab shows into a folder. What is saved already (a pinned
   * app, a bookmark) moves there with the launcher's rules; another page is
   * bookmarked there. A private app cannot be: false.
   */
  const addTabToFolder = useCallback(
    (tab: OpenTab, folderId: string): boolean => {
      const saved = savedKeyOfTab(tab);
      const child = saved
        ? [...goFolders.children.values()].find(
            (entry) => entry.item.key === saved
          )
        : null;
      if (child?.folderId === folderId) return true;
      if (saved) return !!moveToFolder(saved, folderId);
      if (!bookmarks) return false;
      const now = Date.now();
      const bookmark = bookmarkOfTab(tab, folderId, {
        id: newBookmarkId(),
        now,
      });
      if (!bookmark) return false;
      const next: AppBookmarksForAddress = {
        ...bookmarks,
        bookmarks: [...bookmarks.bookmarks, bookmark],
        updatedAt: now,
      };
      if (!saveBookmarks(next)) return false;
      countEdit();
      return true;
    },
    [
      bookmarks,
      countEdit,
      goFolders.children,
      moveToFolder,
      saveBookmarks,
      savedKeyOfTab,
    ]
  );

  /**
   * A new folder, at the end of the row, holding the page a tab shows when
   * it can (not a private app). Returns the folder's id.
   */
  const createFolderWithTab = useCallback(
    (tab: OpenTab, name: string): string | null => {
      const saved = savedKeyOfTab(tab);
      if (saved) return newFolderWith(saved, name)?.madeFolderId ?? null;
      if (!bookmarks) return null;
      const now = Date.now();
      const id = newBookmarkId();
      const bookmark = bookmarkOfTab(tab, id, { id: newBookmarkId(), now });
      const next: AppBookmarksForAddress = {
        folders: [
          ...bookmarks.folders,
          {
            id,
            name: name.trim() || newFolderName,
            createdAt: now,
            updatedAt: now,
          },
        ],
        bookmarks: bookmark
          ? [...bookmarks.bookmarks, bookmark]
          : bookmarks.bookmarks,
        updatedAt: now,
      };
      if (!saveBookmarks(next)) return null;
      setView({
        ...view,
        order: [...items.map((item) => item.key), folderItemKey(id)],
      });
      countEdit();
      return id;
    },
    [
      bookmarks,
      countEdit,
      items,
      newFolderName,
      newFolderWith,
      saveBookmarks,
      savedKeyOfTab,
      setView,
      view,
    ]
  );

  const reorderFolderChildren = useCallback(
    (folderId: string, keysInOrder: string[]) => {
      if (!bookmarks) return;
      const next = withFolderOrder(
        bookmarks,
        folderId,
        keysInOrder,
        Date.now()
      );
      if (next === bookmarks) return;
      if (saveBookmarks(next)) countEdit();
    },
    [bookmarks, countEdit, saveBookmarks]
  );

  /** The folders in this order, in the places they take in the row. */
  const reorderFolders = useCallback(
    (folderIdsInOrder: string[]) => {
      const order = orderWithFolders(items, folderIdsInOrder);
      if (
        sameKeys(
          order,
          items.map((item) => item.key)
        )
      )
        return;
      setView({ ...view, order });
      countEdit();
    },
    [countEdit, items, setView, view]
  );

  const moveFolder = useCallback(
    (
      folderId: string,
      place: { beforeFolderId?: string | null; afterFolderId?: string | null }
    ) => {
      const order = orderWithFolderMoved(items, folderId, place);
      if (
        sameKeys(
          order,
          items.map((item) => item.key)
        )
      )
        return;
      setView({ ...view, order });
      countEdit();
    },
    [countEdit, items, setView, view]
  );

  /** How a folder looks on this phone (not saved to QDN). */
  const setFolderLook = useCallback(
    (folderId: string, look: FolderLook) => {
      if (!address) return;
      updateMobileTabOrganization(store, address, (prev) => {
        const current = prev.folderLooks?.[folderId] ?? {};
        const next = { ...current, ...look };
        if (look.size === undefined && 'size' in look) delete next.size;
        if (
          next.size === current.size &&
          (next.row ?? 0) === (current.row ?? 0)
        ) {
          return prev;
        }
        return {
          ...prev,
          folderLooks: { ...(prev.folderLooks ?? {}), [folderId]: next },
        };
      });
    },
    [address, store]
  );

  return {
    address,
    ready,
    items,
    pins,
    bookmarks,
    looks,
    goFolders,
    applyChange,
    drop,
    moveToFolder,
    newFolderWith,
    takeOutOfFolder,
    remove,
    deleteFolder,
    renameFolder,
    renameBookmark,
    moveBookmarkTo,
    createFolder,
    savedKeyOfTab,
    addTabToFolder,
    createFolderWithTab,
    reorderFolderChildren,
    reorderFolders,
    moveFolder,
    setFolderLook,
  };
}

export type GoLauncher = ReturnType<typeof useGoLauncher>;
