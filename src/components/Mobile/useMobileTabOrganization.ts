import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { arrayMove } from '@dnd-kit/sortable';
import { userInfoAtom, rawWalletAtom } from '../../atoms/global';
import {
  createFolderId,
  getFolderRow,
  getOpenTabDisplayTitle,
  getOpenTabKey,
  loadMobileTabOrganization,
  renameTabKeyInOrganization,
  resolveFolderRowCount,
  saveMobileTabOrganization,
  snapshotFromTab,
  sortFolders,
  type MobileTabOrganization,
  type TabFolder,
} from './mobileTabOrganization';
import type { OpenTab } from './useOpenTabs';
import { updateOpenTab } from './useOpenTabs';

export function useMobileTabOrganization() {
  const userInfo = useAtomValue(userInfoAtom);
  const rawWallet = useAtomValue(rawWalletAtom);
  const walletAddress = userInfo?.address || rawWallet?.address0 || '';
  const [organization, setOrganization] = useState<MobileTabOrganization>({
    folders: [],
    tabOverrides: {},
    tabFolderMap: {},
    savedTabs: {},
    folderRowCount: 1,
  });
  const [ready, setReady] = useState(false);
  const organizationRef = useRef(organization);

  useEffect(() => {
    organizationRef.current = organization;
  }, [organization]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void loadMobileTabOrganization(walletAddress).then((data) => {
      if (!cancelled) {
        organizationRef.current = data;
        setOrganization(data);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  const persist = useCallback(
    (updater: (prev: MobileTabOrganization) => MobileTabOrganization) => {
      const prev = organizationRef.current;
      const next = updater(prev);
      if (next === prev) return;
      organizationRef.current = next;
      setOrganization(next);
      if (walletAddress) {
        void saveMobileTabOrganization(walletAddress, next);
      }
    },
    [walletAddress]
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
      await persist((prev) => {
        folderId = createFolderId();
        const tabKey = initialTab ? getOpenTabKey(initialTab) : null;
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
        if (initialTab && tabKey) {
          tabFolderMap[tabKey] = folderId;
          savedTabs[tabKey] = snapshotFromTab(initialTab);
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
