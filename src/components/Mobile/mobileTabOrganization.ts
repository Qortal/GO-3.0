import { getData, storeData } from '../../utils/chromeStorage';
import {
  getTabAppIdentity,
  isPrivateAppTab,
  serializePrivateAppProperties,
} from './privateAppTabIdentity';
import type { OpenTab } from './useOpenTabs';

export type TabFolder = {
  id: string;
  name: string;
  tabKeys: string[];
  order: number;
  /** Row index for multi-row folder layout (0-based). */
  row?: number;
};

/** Persisted app/website metadata so folder members survive app restarts. */
export type SavedTabSnapshot = {
  service?: string;
  name?: string;
  internal?: string;
  identifier?: string;
  path?: string;
  label?: string;
  isPrivate?: boolean;
  privateAppProperties?: Record<string, unknown>;
};

export type TabOverride = {
  customLabel?: string;
  originalLabel?: string;
  customQortalUrl?: string;
};

export type MobileTabOrganization = {
  folders: TabFolder[];
  tabOverrides: Record<string, TabOverride>;
  tabFolderMap: Record<string, string>;
  savedTabs: Record<string, SavedTabSnapshot>;
  /** Number of folder rows shown in the tabs overlay. */
  folderRowCount?: number;
};

const STORAGE_PREFIX = 'hub_mobile_tab_org_';

export const getOpenTabKey = (tab: OpenTab): string => {
  if (tab.internal) {
    return `internal:${String(tab.internal)}`;
  }
  const { service, name, identifier } = getTabAppIdentity(tab);
  const serviceKey = service.toUpperCase();
  if (identifier) {
    return `${serviceKey}|${name}|${identifier}`;
  }
  return `${serviceKey}|${name}`;
};

export const getOpenTabDisplayTitle = (
  tab: OpenTab,
  overrides?: Record<string, TabOverride>
): string => {
  const key = getOpenTabKey(tab);
  const override = overrides?.[key];
  if (override?.customLabel?.trim()) {
    return override.customLabel.trim();
  }
  const { label, name, service } = getTabAppIdentity(tab);
  return label || name || service || 'Tab';
};

const emptyOrganization = (): MobileTabOrganization => ({
  folders: [],
  tabOverrides: {},
  tabFolderMap: {},
  savedTabs: {},
  folderRowCount: 1,
});

export const getFolderRow = (folder: TabFolder): number => folder.row ?? 0;

export function resolveFolderRowCount(
  folders: TabFolder[],
  storedCount?: number
): number {
  const maxRow = folders.reduce(
    (max, folder) => Math.max(max, getFolderRow(folder) + 1),
    0
  );
  return Math.max(storedCount ?? 1, maxRow, 1);
}

export function groupFoldersByRow(
  folders: TabFolder[],
  rowCount: number
): TabFolder[][] {
  const sorted = sortFolders(folders);
  return Array.from({ length: rowCount }, (_, row) =>
    sorted.filter((folder) => getFolderRow(folder) === row)
  );
}

export function snapshotFromTab(tab: OpenTab): SavedTabSnapshot {
  const identity = getTabAppIdentity(tab);
  const privateAppProperties = serializePrivateAppProperties(tab);
  return {
    service: identity.service || undefined,
    name: identity.name || undefined,
    internal: tab.internal != null ? String(tab.internal) : undefined,
    identifier: identity.identifier,
    path: identity.path,
    label: identity.label || undefined,
    isPrivate:
      isPrivateAppTab(tab) || privateAppProperties != null ? true : undefined,
    ...(privateAppProperties ? { privateAppProperties } : {}),
  };
}

export function savedTabToOpenTab(
  tabKey: string,
  snapshot: SavedTabSnapshot
): OpenTab {
  return {
    ...snapshot,
    tabId: `saved:${tabKey}`,
  };
}

export function resolveFolderTab(
  tabKey: string,
  openTab: OpenTab | undefined,
  savedTabs: Record<string, SavedTabSnapshot>
): OpenTab | null {
  if (openTab) return openTab;
  const snapshot = savedTabs[tabKey];
  if (!snapshot) return null;
  return savedTabToOpenTab(tabKey, snapshot);
}

export async function loadMobileTabOrganization(
  walletAddress: string | undefined | null
): Promise<MobileTabOrganization> {
  if (!walletAddress) return emptyOrganization();
  const stored = await getData<MobileTabOrganization>(
    `${STORAGE_PREFIX}${walletAddress}`
  );
  if (!stored || typeof stored !== 'object') {
    return emptyOrganization();
  }
  return {
    folders: Array.isArray(stored.folders)
      ? stored.folders.map((folder) => ({
          ...folder,
          row: typeof folder.row === 'number' ? folder.row : 0,
        }))
      : [],
    tabOverrides:
      stored.tabOverrides && typeof stored.tabOverrides === 'object'
        ? stored.tabOverrides
        : {},
    tabFolderMap:
      stored.tabFolderMap && typeof stored.tabFolderMap === 'object'
        ? stored.tabFolderMap
        : {},
    savedTabs:
      stored.savedTabs && typeof stored.savedTabs === 'object'
        ? stored.savedTabs
        : {},
    folderRowCount: resolveFolderRowCount(
      Array.isArray(stored.folders) ? stored.folders : [],
      typeof stored.folderRowCount === 'number' ? stored.folderRowCount : undefined
    ),
  };
}

export async function saveMobileTabOrganization(
  walletAddress: string | undefined | null,
  organization: MobileTabOrganization
): Promise<void> {
  if (!walletAddress) return;
  await storeData(`${STORAGE_PREFIX}${walletAddress}`, organization);
}

export function createFolderId(): string {
  return `folder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sortFolders(folders: TabFolder[]): TabFolder[] {
  return [...folders].sort((a, b) => {
    const rowDiff = getFolderRow(a) - getFolderRow(b);
    if (rowDiff !== 0) return rowDiff;
    return a.order - b.order;
  });
}

export function renameTabKeyInOrganization(
  organization: MobileTabOrganization,
  oldKey: string,
  newKey: string
): MobileTabOrganization {
  if (oldKey === newKey) return organization;

  const tabOverrides = { ...organization.tabOverrides };
  if (tabOverrides[oldKey]) {
    tabOverrides[newKey] = tabOverrides[oldKey];
    delete tabOverrides[oldKey];
  }

  const tabFolderMap = { ...organization.tabFolderMap };
  if (tabFolderMap[oldKey]) {
    tabFolderMap[newKey] = tabFolderMap[oldKey];
    delete tabFolderMap[oldKey];
  }

  const savedTabs = { ...organization.savedTabs };
  if (savedTabs[oldKey]) {
    savedTabs[newKey] = savedTabs[oldKey];
    delete savedTabs[oldKey];
  }

  const folders = organization.folders.map((folder) => ({
    ...folder,
    tabKeys: folder.tabKeys.map((key) => (key === oldKey ? newKey : key)),
  }));

  return { folders, tabOverrides, tabFolderMap, savedTabs };
}
