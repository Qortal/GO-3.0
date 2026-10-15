import { useCallback, useEffect } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { arrayMove } from '@dnd-kit/sortable';
import { userInfoAtom, rawWalletAtom } from '../../atoms/global';
import {
  createFolderId,
  getFolderRow,
  getOpenTabDisplayTitle,
  getOpenTabKey,
  emptyOrganization,
  HUB_DASHBOARD_FOLDER_NAME,
  pinnedAppToOpenTab,
  renameTabKeyInOrganization,
  resolveFolderRowCount,
  snapshotFromTab,
  sortFolders,
  type FolderSize,
  type MobileTabOrganization,
  type TabFolder,
} from './mobileTabOrganization';
import {
  ensureMobileTabOrganizationLoaded,
  mobileTabOrganizationStateAtom,
  updateMobileTabOrganization,
} from './mobileTabOrganizationStore';
import type { SerializedPinnedApp } from '../../hooks/qdnSavedSettings';
import type { OpenTab } from './useOpenTabs';
import { updateOpenTab } from './useOpenTabs';
import { isDevZipTab } from './devMode/devModeApp';

const EMPTY_ORGANIZATION = emptyOrganization();

export function useMobileTabOrganization() {
  const userInfo = useAtomValue(userInfoAtom);
  const rawWallet = useAtomValue(rawWalletAtom);
  const walletAddress = userInfo?.address || rawWallet?.address0 || '';
  const store = useStore();
  const state = useAtomValue(mobileTabOrganizationStateAtom);
  const isCurrentWallet = state.walletAddress === walletAddress;
  const organization: MobileTabOrganization = isCurrentWallet
    ? state.organization
    : EMPTY_ORGANIZATION;
  const ready = isCurrentWallet && state.ready;

  useEffect(() => {
    void ensureMobileTabOrganizationLoaded(store, walletAddress).catch(
      (error) => {
        console.error('Failed to load Tabs folders', error);
      }
    );
  }, [store, walletAddress]);

  const persist = useCallback(
    (updater: (prev: MobileTabOrganization) => MobileTabOrganization) => {
      updateMobileTabOrganization(store, walletAddress, updater);
    },
    [store, walletAddress]
  );

  const upsertSavedTab = useCallback(
    (tab: OpenTab, savedTabs: Record<string, MobileTabOrganization['savedTabs'][string]>) => {
      const tabKey = getOpenTabKey(tab);
      return {
        ...savedTabs,
        [tabKey]: snapshotFromTab(tab),
      };
    },
    []
  );

  const createFolder = useCallback(
    async (name: string, initialTab?: OpenTab, row = 0) => {
      let folderId = '';
      // A Dev Mode app lives in memory only, so it never goes in a folder.
      const folderTab =
        initialTab && !isDevZipTab(initialTab) ? initialTab : undefined;
      await persist((prev) => {
        folderId = createFolderId();
        const tabKey = folderTab ? getOpenTabKey(folderTab) : null;
        const foldersInRow = prev.folders.filter(
          (folder) => getFolderRow(folder) === row
        );
        const folder: TabFolder = {
          id: folderId,
          name: name.trim() || 'New folder',
          tabKeys: tabKey ? [tabKey] : [],
          order: foldersInRow.length,
          row,
        };
        const tabFolderMap = { ...prev.tabFolderMap };
        const savedTabs = { ...prev.savedTabs };
        if (folderTab && tabKey) {
          tabFolderMap[tabKey] = folderId;
          savedTabs[tabKey] = snapshotFromTab(folderTab);
        }
        const folders = [...prev.folders, folder];
        return {
          ...prev,
          folders,
          tabFolderMap,
          savedTabs,
          folderRowCount: resolveFolderRowCount(folders, prev.folderRowCount),
        };
      });
      return folderId;
    },
    [persist]
  );

  const renameFolder = useCallback(
    async (folderId: string, name: string) => {
      await persist((prev) => {
        const folder = prev.folders.find((item) => item.id === folderId);
        if (!folder) return prev;
        const nextName = name.trim() || folder.name;
        if (nextName === folder.name) return prev;
        return {
          ...prev,
          folders: prev.folders.map((item) =>
            item.id === folderId ? { ...item, name: nextName } : item
          ),
        };
      });
    },
    [persist]
  );

  const setFolderSize = useCallback(
    (folderId: string, size: FolderSize) => {
      persist((prev) => {
        const folder = prev.folders.find((item) => item.id === folderId);
        if (!folder || (folder.size === 'small' ? 'small' : 'large') === size) {
          return prev;
        }
        return {
          ...prev,
          folders: prev.folders.map((item) =>
            item.id === folderId
              ? { ...item, size: size === 'small' ? 'small' : undefined }
              : item
          ),
        };
      });
    },
    [persist]
  );

  /** Puts a folder's apps in exactly this order (keys not in it are kept last). */
  const setFolderTabOrder = useCallback(
    (folderId: string, tabKeys: string[]) => {
      persist((prev) => {
        const folder = prev.folders.find((item) => item.id === folderId);
        if (!folder) return prev;
        const known = new Set(folder.tabKeys);
        const ordered = tabKeys.filter((key) => known.has(key));
        const rest = folder.tabKeys.filter((key) => !ordered.includes(key));
        const next = [...ordered, ...rest];
        if (next.every((key, index) => key === folder.tabKeys[index])) {
          return prev;
        }
        return {
          ...prev,
          folders: prev.folders.map((item) =>
            item.id === folderId ? { ...item, tabKeys: next } : item
          ),
        };
      });
    },
    [persist]
  );

  const reorderFoldersInRow = useCallback(
    async (row: number, folderIdsInOrder: string[]) => {
      const orderMap = new Map(folderIdsInOrder.map((id, index) => [id, index]));
      await persist((prev) => ({
        ...prev,
        folders: prev.folders.map((folder) =>
          getFolderRow(folder) === row && orderMap.has(folder.id)
            ? { ...folder, order: orderMap.get(folder.id) ?? folder.order }
            : folder
        ),
      }));
    },
    [persist]
  );

  const insertFolderRowAfter = useCallback(
    async (afterRow: number) => {
      await persist((prev) => {
        const nextRowCount = (prev.folderRowCount ?? 1) + 1;
        const folders = prev.folders.map((folder) => {
          const row = getFolderRow(folder);
          if (row > afterRow) {
            return { ...folder, row: row + 1 };
          }
          return folder;
        });
        return {
          ...prev,
          folders,
          folderRowCount: resolveFolderRowCount(folders, nextRowCount),
        };
      });
    },
    [persist]
  );

  const moveFolderToRow = useCallback(
    async (
      folderId: string,
      targetRow: number,
      beforeFolderId?: string | null
    ) => {
      await persist((prev) => {
        const moving = prev.folders.find((folder) => folder.id === folderId);
        if (!moving) return prev;

        const sourceRow = getFolderRow(moving);
        const targetRowClamped = Math.max(0, targetRow);

        let targetFolders = prev.folders
          .filter(
            (folder) =>
              getFolderRow(folder) === targetRowClamped && folder.id !== folderId
          )
          .sort((a, b) => a.order - b.order);

        if (beforeFolderId) {
          const insertAt = targetFolders.findIndex(
            (folder) => folder.id === beforeFolderId
          );
          targetFolders = [
            ...targetFolders.slice(0, insertAt === -1 ? targetFolders.length : insertAt),
            moving,
            ...targetFolders.slice(insertAt === -1 ? targetFolders.length : insertAt),
          ];
        } else {
          targetFolders = [...targetFolders, moving];
        }

        const targetUpdates = new Map(
          targetFolders.map((folder, index) => [
            folder.id,
            { row: targetRowClamped, order: index },
          ])
        );

        let folders = prev.folders.map((folder) => {
          const update = targetUpdates.get(folder.id);
          return update ? { ...folder, row: update.row, order: update.order } : folder;
        });

        if (sourceRow !== targetRowClamped) {
          const sourceUpdates = new Map(
            folders
              .filter(
                (folder) =>
                  getFolderRow(folder) === sourceRow && folder.id !== folderId
              )
              .sort((a, b) => a.order - b.order)
              .map((folder, index) => [folder.id, index])
          );
          folders = folders.map((folder) => {
            const order = sourceUpdates.get(folder.id);
            return order !== undefined ? { ...folder, order } : folder;
          });
        }

        return {
          ...prev,
          folders,
          folderRowCount: resolveFolderRowCount(folders, prev.folderRowCount),
        };
      });
    },
    [persist]
  );

  const removeFolderRow = useCallback(
    async (rowIndex: number) => {
      await persist((prev) => {
        const rowCount = prev.folderRowCount ?? 1;
        if (rowCount <= 1) return prev;
        const hasFolders = prev.folders.some(
          (folder) => getFolderRow(folder) === rowIndex
        );
        if (hasFolders) return prev;

        const folders = prev.folders.map((folder) => {
          const row = getFolderRow(folder);
          return row > rowIndex ? { ...folder, row: row - 1 } : folder;
        });

        return {
          ...prev,
          folders,
          folderRowCount: rowCount - 1,
        };
      });
    },
    [persist]
  );

  const addTabToFolder = useCallback(
    async (tab: OpenTab, folderId: string) => {
      if (isDevZipTab(tab)) return;
      const tabKey = getOpenTabKey(tab);
      await persist((prev) => {
        const tabFolderMap = { ...prev.tabFolderMap, [tabKey]: folderId };
        const savedTabs = upsertSavedTab(tab, prev.savedTabs);
        const folders = prev.folders.map((folder) => {
          if (folder.id !== folderId) {
            return {
              ...folder,
              tabKeys: folder.tabKeys.filter((key) => key !== tabKey),
            };
          }
          if (folder.tabKeys.includes(tabKey)) {
            return folder;
          }
          return { ...folder, tabKeys: [...folder.tabKeys, tabKey] };
        });
        return { ...prev, folders, tabFolderMap, savedTabs };
      });
    },
    [persist, upsertSavedTab]
  );

  const removeTabFromFolder = useCallback(
    async (tab: OpenTab) => {
      const tabKey = getOpenTabKey(tab);
      await persist((prev) => {
        const folderId = prev.tabFolderMap[tabKey];
        if (!folderId) return prev;
        const tabFolderMap = { ...prev.tabFolderMap };
        delete tabFolderMap[tabKey];
        const folders = prev.folders.map((folder) =>
          folder.id === folderId
            ? {
                ...folder,
                tabKeys: folder.tabKeys.filter((key) => key !== tabKey),
              }
            : folder
        );
        const savedTabs = { ...prev.savedTabs };
        delete savedTabs[tabKey];
        return { ...prev, folders, tabFolderMap, savedTabs };
      });
    },
    [persist]
  );

  const reorderTabsInFolder = useCallback(
    async (folderId: string, activeTabKey: string, overTabKey: string) => {
      await persist((prev) => {
        const folder = prev.folders.find((item) => item.id === folderId);
        if (!folder) return prev;
        const oldIndex = folder.tabKeys.indexOf(activeTabKey);
        const newIndex = folder.tabKeys.indexOf(overTabKey);
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
          return prev;
        }
        return {
          ...prev,
          folders: prev.folders.map((item) =>
            item.id === folderId
              ? { ...item, tabKeys: arrayMove(item.tabKeys, oldIndex, newIndex) }
              : item
          ),
        };
      });
    },
    [persist]
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      await persist((prev) => {
        const folder = prev.folders.find((item) => item.id === folderId);
        if (!folder) return prev;
        const tabFolderMap = { ...prev.tabFolderMap };
        const savedTabs = { ...prev.savedTabs };
        folder.tabKeys.forEach((key) => {
          delete tabFolderMap[key];
          delete savedTabs[key];
        });
        return {
          ...prev,
          folders: prev.folders.filter((item) => item.id !== folderId),
          tabFolderMap,
          savedTabs,
        };
      });
    },
    [persist]
  );

  const syncOpenTabSnapshots = useCallback(
    (openTabs: OpenTab[]) => {
      persist((prev) => {
        let savedTabs = prev.savedTabs;
        let changed = false;
        openTabs.forEach((tab) => {
          const tabKey = getOpenTabKey(tab);
          if (!prev.tabFolderMap[tabKey]) return;
          const nextSnapshot = snapshotFromTab(tab);
          const current = savedTabs[tabKey];
          if (
            !current ||
            current.label !== nextSnapshot.label ||
            current.name !== nextSnapshot.name ||
            current.service !== nextSnapshot.service ||
            current.internal !== nextSnapshot.internal
          ) {
            if (!changed) {
              savedTabs = { ...savedTabs };
              changed = true;
            }
            savedTabs[tabKey] = nextSnapshot;
          }
        });
        if (!changed) return prev;
        return { ...prev, savedTabs };
      });
    },
    [persist]
  );

  const renameTab = useCallback(
    async (tab: OpenTab, customLabel: string) => {
      const tabKey = getOpenTabKey(tab);
      await persist((prev) => {
        const originalLabel =
          prev.tabOverrides[tabKey]?.originalLabel ||
          getOpenTabDisplayTitle(tab, prev.tabOverrides);
        const tabOverrides = {
          ...prev.tabOverrides,
          [tabKey]: {
            ...prev.tabOverrides[tabKey],
            customLabel: customLabel.trim(),
            originalLabel,
          },
        };
        const savedTabs = prev.tabFolderMap[tabKey]
          ? upsertSavedTab({ ...tab, label: customLabel.trim() }, prev.savedTabs)
          : prev.savedTabs;
        return { ...prev, tabOverrides, savedTabs };
      });
      updateOpenTab(tab.tabId, { label: customLabel.trim() });
    },
    [persist, upsertSavedTab]
  );

  const restoreTabName = useCallback(
    async (tab: OpenTab) => {
      const tabKey = getOpenTabKey(tab);
      await persist((prev) => {
        const tabOverrides = { ...prev.tabOverrides };
        delete tabOverrides[tabKey];
        const savedTabs = prev.tabFolderMap[tabKey]
          ? upsertSavedTab({ ...tab, label: undefined }, prev.savedTabs)
          : prev.savedTabs;
        return { ...prev, tabOverrides, savedTabs };
      });
      updateOpenTab(tab.tabId, { label: undefined });
    },
    [persist, upsertSavedTab]
  );

  const updateTabAddress = useCallback(
    async (
      tab: OpenTab,
      patch: Pick<OpenTab, 'service' | 'name' | 'identifier' | 'path'>
    ) => {
      const oldKey = getOpenTabKey(tab);
      const nextTab = { ...tab, ...patch };
      const newKey = getOpenTabKey(nextTab);
      await persist((prev) => {
        let nextOrg =
          oldKey !== newKey
            ? renameTabKeyInOrganization(prev, oldKey, newKey)
            : prev;
        if (nextOrg.tabFolderMap[newKey] || nextOrg.tabFolderMap[oldKey]) {
          nextOrg = {
            ...nextOrg,
            savedTabs: upsertSavedTab(nextTab, nextOrg.savedTabs),
          };
        }
        return nextOrg;
      });
      updateOpenTab(tab.tabId, patch);
    },
    [persist, upsertSavedTab]
  );

  const importPinnedAppsToHubFolder = useCallback(
    (pins: SerializedPinnedApp[]) => {
      let folderId = '';
      let imported = 0;
      let skipped = 0;

      persist((prev) => {
        const existing = prev.folders.find(
          (folder) =>
            folder.name.trim().toLowerCase() ===
            HUB_DASHBOARD_FOLDER_NAME.toLowerCase()
        );
        folderId = existing?.id ?? createFolderId();

        const uniqueTabs: OpenTab[] = [];
        const seen = new Set<string>();
        for (const pin of pins) {
          const tab = pinnedAppToOpenTab(pin);
          if (!tab) continue;
          const tabKey = getOpenTabKey(tab);
          if (!tab.name || seen.has(tabKey)) continue;
          seen.add(tabKey);
          uniqueTabs.push(tab);
        }

        const hubTabKeys: string[] = [];
        const tabFolderMap = { ...prev.tabFolderMap };
        const savedTabs = { ...prev.savedTabs };

        for (const tab of uniqueTabs) {
          const tabKey = getOpenTabKey(tab);
          const currentFolder = tabFolderMap[tabKey];
          if (currentFolder && currentFolder !== folderId) {
            skipped += 1;
            continue;
          }
          hubTabKeys.push(tabKey);
          tabFolderMap[tabKey] = folderId;
          savedTabs[tabKey] = snapshotFromTab(tab);
          imported += 1;
        }

        if (existing) {
          for (const oldKey of existing.tabKeys) {
            if (!hubTabKeys.includes(oldKey) && tabFolderMap[oldKey] === folderId) {
              delete tabFolderMap[oldKey];
              delete savedTabs[oldKey];
            }
          }
        }

        if (!existing && hubTabKeys.length === 0) {
          folderId = '';
          return prev;
        }

        const folders = existing
          ? prev.folders.map((folder) =>
              folder.id === folderId ? { ...folder, tabKeys: hubTabKeys } : folder
            )
          : [
              ...prev.folders,
              {
                id: folderId,
                name: HUB_DASHBOARD_FOLDER_NAME,
                tabKeys: hubTabKeys,
                order: prev.folders.filter((folder) => getFolderRow(folder) === 0)
                  .length,
                row: 0,
              } satisfies TabFolder,
            ];

        return {
          ...prev,
          folders,
          tabFolderMap,
          savedTabs,
          folderRowCount: resolveFolderRowCount(folders, prev.folderRowCount),
        };
      });

      return { folderId, imported, skipped };
    },
    [persist]
  );

  const getTabTitle = useCallback(
    (tab: OpenTab) => getOpenTabDisplayTitle(tab, organization.tabOverrides),
    [organization.tabOverrides]
  );

  const getFolderForTab = useCallback(
    (tab: OpenTab) => {
      const folderId = organization.tabFolderMap[getOpenTabKey(tab)];
      return organization.folders.find((folder) => folder.id === folderId) || null;
    },
    [organization]
  );

  const folders = sortFolders(organization.folders);

  return {
    ready,
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
    importPinnedAppsToHubFolder,
    getTabTitle,
    getFolderForTab,
  };
}
