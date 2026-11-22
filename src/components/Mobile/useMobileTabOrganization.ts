import { useCallback, useMemo } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import { arrayMove } from '@dnd-kit/sortable';
import { executeEvent } from '../../utils/events';
import {
  getOpenTabDisplayTitle,
  getOpenTabKey,
  emptyOrganization,
  renameTabKeyInOrganization,
  resolveFolderRowCount,
  sortFolders,
  type FolderSize,
  type MobileTabOrganization,
} from './mobileTabOrganization';
import {
  mobileTabOrganizationStateAtom,
  updateMobileTabOrganization,
} from './mobileTabOrganizationStore';
import type { OpenTab } from './useOpenTabs';
import { updateOpenTab } from './useOpenTabs';
import { isDevZipTab } from './devMode/devModeApp';
import { isPrivateAppTab } from './privateAppTabIdentity';
import { goKeyOfBookmark } from './goLauncher/goLauncherOps';
import { useGoLauncher } from './goLauncher/useGoLauncher';

const EMPTY_ORGANIZATION = emptyOrganization();

/**
 * GO's Tabs folders. They are the bookmark folders of the desktop Hub's
 * launcher (see goLauncher/), which the QDN settings carry between devices:
 * each app or page in a folder is a bookmark there. The Tabs panel and the
 * Pinned tab's open folder work with them as saved tabs, keyed like open
 * tabs. Rows, folder sizes and renamed open tabs are this phone's own.
 */
export function useMobileTabOrganization() {
  const { t } = useTranslation(['core']);
  const store = useStore();
  const launcher = useGoLauncher();
  const { address, goFolders, bookmarks } = launcher;
  const state = useAtomValue(mobileTabOrganizationStateAtom);
  const local: MobileTabOrganization =
    address && state.walletAddress === address
      ? state.organization
      : EMPTY_ORGANIZATION;

  const organization = useMemo<MobileTabOrganization>(
    () => ({
      folders: goFolders.folders,
      tabOverrides: local.tabOverrides,
      tabFolderMap: goFolders.tabFolderMap,
      savedTabs: goFolders.savedTabs,
      folderRowCount: resolveFolderRowCount(
        goFolders.folders,
        local.folderRowCount
      ),
    }),
    [goFolders, local.folderRowCount, local.tabOverrides]
  );
  const folders = useMemo(
    () => sortFolders(goFolders.folders),
    [goFolders.folders]
  );

  const persistLocal = useCallback(
    (updater: (prev: MobileTabOrganization) => MobileTabOrganization) => {
      if (address) updateMobileTabOrganization(store, address, updater);
    },
    [address, store]
  );

  /** The bookmark that holds the page a tab shows, if one does. */
  const bookmarkOfTab = useCallback(
    (tab: OpenTab) => {
      const key = getOpenTabKey(tab);
      const child = goFolders.children.get(key);
      if (child) return child.item.bookmark;
      return (
        bookmarks?.bookmarks.find(
          (bookmark) => !bookmark.folderId && goKeyOfBookmark(bookmark) === key
        ) ?? null
      );
    },
    [bookmarks, goFolders.children]
  );

  const tellPrivateCannot = useCallback(() => {
    executeEvent('openGlobalSnackBar', {
      message: t('core:tabs_home.private_no_folder', {
        postProcess: 'capitalizeFirstChar',
      }),
      type: 'info',
      duration: 3200,
    });
  }, [t]);

  const createFolder = useCallback(
    async (name: string, initialTab?: OpenTab, row = 0) => {
      // A Dev Mode app lives in memory only, so it never goes in a folder.
      const folderTab =
        initialTab && !isDevZipTab(initialTab) ? initialTab : undefined;
      const folderId = folderTab
        ? launcher.createFolderWithTab(folderTab, name)
        : launcher.createFolder(name);
      if (!folderId) return '';
      if (row > 0) launcher.setFolderLook(folderId, { row });
      if (folderTab && isPrivateAppTab(folderTab)) tellPrivateCannot();
      return folderId;
    },
    [launcher, tellPrivateCannot]
  );

  const renameFolder = useCallback(
    async (folderId: string, name: string) => {
      launcher.renameFolder(folderId, name);
    },
    [launcher]
  );

  const setFolderSize = useCallback(
    (folderId: string, size: FolderSize) => {
      launcher.setFolderLook(folderId, {
        size: size === 'small' ? 'small' : undefined,
      });
    },
    [launcher]
  );

  /** Puts a folder's apps in exactly this order (keys not in it are kept last). */
  const setFolderTabOrder = useCallback(
    (folderId: string, tabKeys: string[]) => {
      launcher.reorderFolderChildren(folderId, tabKeys);
    },
    [launcher]
  );

  const reorderFoldersInRow = useCallback(
    async (_row: number, folderIdsInOrder: string[]) => {
      launcher.reorderFolders(folderIdsInOrder);
    },
    [launcher]
  );

  const insertFolderRowAfter = useCallback(
    async (afterRow: number) => {
      persistLocal((prev) => {
        const looks = { ...(prev.folderLooks ?? {}) };
        for (const [id, look] of Object.entries(looks)) {
          if ((look.row ?? 0) > afterRow) {
            looks[id] = { ...look, row: (look.row ?? 0) + 1 };
          }
        }
        return {
          ...prev,
          folderLooks: looks,
          folderRowCount:
            resolveFolderRowCount(folders, prev.folderRowCount) + 1,
        };
      });
    },
    [folders, persistLocal]
  );

  const moveFolderToRow = useCallback(
    async (
      folderId: string,
      targetRow: number,
      beforeFolderId?: string | null
    ) => {
      const row = Math.max(0, targetRow);
      launcher.setFolderLook(folderId, { row });
      if (beforeFolderId) {
        launcher.moveFolder(folderId, { beforeFolderId });
        return;
      }
      const lastInRow = folders
        .filter((folder) => (folder.row ?? 0) === row && folder.id !== folderId)
        .pop();
      if (lastInRow) {
        launcher.moveFolder(folderId, { afterFolderId: lastInRow.id });
      }
    },
    [folders, launcher]
  );

  const removeFolderRow = useCallback(
    async (rowIndex: number) => {
      if (folders.some((folder) => (folder.row ?? 0) === rowIndex)) return;
      persistLocal((prev) => {
        const rowCount = resolveFolderRowCount(folders, prev.folderRowCount);
        if (rowCount <= 1) return prev;
        const looks = { ...(prev.folderLooks ?? {}) };
        for (const [id, look] of Object.entries(looks)) {
          if ((look.row ?? 0) > rowIndex) {
            looks[id] = { ...look, row: (look.row ?? 0) - 1 };
          }
        }
        return { ...prev, folderLooks: looks, folderRowCount: rowCount - 1 };
      });
    },
    [folders, persistLocal]
  );

  const addTabToFolder = useCallback(
    async (tab: OpenTab, folderId: string) => {
      if (isDevZipTab(tab)) return;
      if (!launcher.addTabToFolder(tab, folderId) && isPrivateAppTab(tab)) {
        tellPrivateCannot();
      }
    },
    [launcher, tellPrivateCannot]
  );

  /** Takes a saved app out of its folder, into the row after the folder. */
  const removeTabFromFolder = useCallback(
    async (tab: OpenTab) => {
      const child = goFolders.children.get(getOpenTabKey(tab));
      if (child) launcher.takeOutOfFolder(child.item.key);
    },
    [goFolders.children, launcher]
  );

  const reorderTabsInFolder = useCallback(
    async (folderId: string, activeTabKey: string, overTabKey: string) => {
      const folder = goFolders.folders.find((item) => item.id === folderId);
      if (!folder) return;
      const oldIndex = folder.tabKeys.indexOf(activeTabKey);
      const newIndex = folder.tabKeys.indexOf(overTabKey);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      launcher.reorderFolderChildren(
        folderId,
        arrayMove(folder.tabKeys, oldIndex, newIndex)
      );
    },
    [goFolders.folders, launcher]
  );

  /** Removes a folder; what was in it stays, in the row where it stood. */
  const deleteFolder = useCallback(
    async (folderId: string) => {
      launcher.deleteFolder(folderId);
    },
    [launcher]
  );

  // Saved apps are bookmarks now, with names of their own.
  const syncOpenTabSnapshots = useCallback((_openTabs: OpenTab[]) => {}, []);

  const renameTab = useCallback(
    async (tab: OpenTab, customLabel: string) => {
      const label = customLabel.trim();
      const bookmark = bookmarkOfTab(tab);
      if (bookmark) launcher.renameBookmark(bookmark.id, label);
      const tabKey = getOpenTabKey(tab);
      persistLocal((prev) => {
        const originalLabel =
          prev.tabOverrides[tabKey]?.originalLabel ||
          getOpenTabDisplayTitle(tab, prev.tabOverrides);
        return {
          ...prev,
          tabOverrides: {
            ...prev.tabOverrides,
            [tabKey]: {
              ...prev.tabOverrides[tabKey],
              customLabel: label,
              originalLabel,
            },
          },
        };
      });
      updateOpenTab(tab.tabId, { label });
    },
    [bookmarkOfTab, launcher, persistLocal]
  );

  const restoreTabName = useCallback(
    async (tab: OpenTab) => {
      const tabKey = getOpenTabKey(tab);
      const bookmark = bookmarkOfTab(tab);
      if (bookmark) {
        launcher.renameBookmark(
          bookmark.id,
          local.tabOverrides[tabKey]?.originalLabel || bookmark.appName
        );
      }
      persistLocal((prev) => {
        if (!prev.tabOverrides[tabKey]) return prev;
        const tabOverrides = { ...prev.tabOverrides };
        delete tabOverrides[tabKey];
        return { ...prev, tabOverrides };
      });
      updateOpenTab(tab.tabId, { label: undefined });
    },
    [bookmarkOfTab, launcher, local.tabOverrides, persistLocal]
  );

  const updateTabAddress = useCallback(
    async (
      tab: OpenTab,
      patch: Pick<OpenTab, 'service' | 'name' | 'identifier' | 'path'>
    ) => {
      const oldKey = getOpenTabKey(tab);
      const nextTab = { ...tab, ...patch };
      const newKey = getOpenTabKey({ ...nextTab, tabId: undefined });
      const bookmark = bookmarkOfTab(tab);
      if (bookmark) {
        launcher.moveBookmarkTo(bookmark.id, {
          service: String(nextTab.service || bookmark.service),
          appName: String(nextTab.name || bookmark.appName),
          identifier:
            typeof nextTab.identifier === 'string'
              ? nextTab.identifier
              : undefined,
          path: typeof nextTab.path === 'string' ? nextTab.path : '',
        });
      }
      if (oldKey !== newKey) {
        persistLocal((prev) =>
          renameTabKeyInOrganization(prev, oldKey, newKey)
        );
      }
      updateOpenTab(tab.tabId, patch);
    },
    [bookmarkOfTab, launcher, persistLocal]
  );

  const getTabTitle = useCallback(
    (tab: OpenTab) => {
      const key = getOpenTabKey(tab);
      const custom = local.tabOverrides[key]?.customLabel?.trim();
      if (custom) return custom;
      const child = goFolders.children.get(key);
      if (child?.item.bookmark.name) return child.item.bookmark.name;
      return getOpenTabDisplayTitle(tab, local.tabOverrides);
    },
    [goFolders.children, local.tabOverrides]
  );

  const getFolderForTab = useCallback(
    (tab: OpenTab) => {
      const folderId = organization.tabFolderMap[getOpenTabKey(tab)];
      return folders.find((folder) => folder.id === folderId) || null;
    },
    [folders, organization.tabFolderMap]
  );

  return {
    /** The saved apps as the launcher keeps them, for the Pinned tab. */
    launcher,
    ready: launcher.ready,
    folders,
    organization,
    createFolder,
    renameFolder,
    reorderFoldersInRow,
    setFolderSize,
    setFolderTabOrder,
    insertFolderRowAfter,
    moveFolderToRow,
    removeFolderRow,
    addTabToFolder,
    removeTabFromFolder,
    reorderTabsInFolder,
    deleteFolder,
    syncOpenTabSnapshots,
    renameTab,
    restoreTabName,
    updateTabAddress,
    getTabTitle,
    getFolderForTab,
  };
}
