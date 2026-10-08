import { getData, storeData } from '../../utils/chromeStorage';
import {
  getTabAppIdentity,
  isPrivateAppTab,
  serializePrivateAppProperties,
} from './privateAppTabIdentity';
import type { OpenTab } from './useOpenTabs';

/** How a folder looks on the Pinned home: one cell, or two by two. */
export type FolderSize = 'small' | 'large';

export type TabFolder = {
  id: string;
  name: string;
  tabKeys: string[];
  order: number;
  /** Row index for multi-row folder layout (0-based). */
  row?: number;
  /** Pinned home tile size; folders without one are large. */
  size?: FolderSize;
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

export const HUB_DASHBOARD_FOLDER_NAME = 'Hub';

/** Folder that the Q-Apps library pin button fills on phones. */
export const LIBRARY_FOLDER_NAME = 'Library';

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

export const emptyOrganization = (): MobileTabOrganization => ({
  folders: [],
  tabOverrides: {},
  tabFolderMap: {},
  savedTabs: {},
  folderRowCount: 1,
});

export const getFolderRow = (folder: TabFolder): number => folder.row ?? 0;

export const getFolderSize = (folder: TabFolder): FolderSize =>
  folder.size === 'small' ? 'small' : 'large';

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

export function pinnedAppToOpenTab(item: {
  name?: string;
  service?: string;
  label?: string;
  identifier?: string;
  isPrivate?: boolean;
  privateAppProperties?: {
    service?: string;
    name?: string;
    identifier?: string;
    groupId?: string | number;
    appName?: string;
  };
} | null | undefined): OpenTab | null {
  if (!item || typeof item !== 'object') return null;

  if (item.isPrivate || item.privateAppProperties) {
    const props = item.privateAppProperties || {};
    const name = String(props.name || item.name || '').trim();
    if (!name) return null;
    const service = String(props.service || item.service || 'APP');
    const identifierRaw = props.identifier ?? item.identifier;
    const identifier =
      identifierRaw != null && String(identifierRaw) !== ''
        ? String(identifierRaw)
        : undefined;
    const label = String(props.appName || item.label || name);
    return {
      tabId: 'saved:pending',
      isPrivate: true,
      name,
      service,
      identifier,
      label,
      privateAppProperties: {
        service,
        name,
        identifier,
        groupId: props.groupId,
        appName: label,
      },
    };
  }

  const name = String(item.name || '').trim();
  if (!name) return null;
  return {
    tabId: 'saved:pending',
    name,
    service: String(item.service || 'APP'),
    label: String(item.label || name),
    identifier:
      item.identifier != null && String(item.identifier) !== ''
        ? String(item.identifier)
        : undefined,
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
          size: folder.size === 'small' ? 'small' : undefined,
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

  return { ...organization, folders, tabOverrides, tabFolderMap, savedTabs };
}

export function findFolderByName(
  folders: TabFolder[],
  name: string
): TabFolder | undefined {
  const wanted = name.trim().toLowerCase();
  return folders.find((folder) => folder.name.trim().toLowerCase() === wanted);
}

export function findFolderForTabKey(
  organization: MobileTabOrganization,
  tabKey: string
): TabFolder | null {
  const folderId = organization.tabFolderMap[tabKey];
  if (!folderId) return null;
  return organization.folders.find((folder) => folder.id === folderId) ?? null;
}

/** Tab for a Q-Apps library entry, keyed like the tab that opening it creates. */
export function libraryAppToOpenTab(
  app:
    | {
        name?: string;
        service?: string;
        identifier?: string;
        metadata?: { title?: string };
      }
    | null
    | undefined
): OpenTab | null {
  if (!app?.name) return null;
  return pinnedAppToOpenTab({
    name: app.name,
    service: app.service,
    identifier: app.identifier,
    label: app.metadata?.title || app.name,
  });
}

/**
 * Puts a tab into the folder with this name, creating the folder at the end
 * of the first row when there is none. A tab lives in one folder at a time,
 * so it leaves any other folder.
 */
export function addTabToNamedFolder(
  organization: MobileTabOrganization,
  tab: OpenTab,
  folderName: string,
  newFolderId: string
): { organization: MobileTabOrganization; folder: TabFolder } {
  const tabKey = getOpenTabKey(tab);
  const existing = findFolderByName(organization.folders, folderName);
  const folderId = existing?.id ?? newFolderId;

  let folders = organization.folders.map((folder) => {
    if (folder.id === folderId) {
      return folder.tabKeys.includes(tabKey)
        ? folder
        : { ...folder, tabKeys: [...folder.tabKeys, tabKey] };
    }
    return folder.tabKeys.includes(tabKey)
      ? { ...folder, tabKeys: folder.tabKeys.filter((key) => key !== tabKey) }
      : folder;
  });
  if (!existing) {
    folders = [
      ...folders,
      {
        id: folderId,
        name: folderName,
        tabKeys: [tabKey],
        order: folders.filter((folder) => getFolderRow(folder) === 0).length,
        row: 0,
      },
    ];
  }

  return {
    organization: {
      ...organization,
      folders,
      tabFolderMap: { ...organization.tabFolderMap, [tabKey]: folderId },
      savedTabs: { ...organization.savedTabs, [tabKey]: snapshotFromTab(tab) },
      folderRowCount: resolveFolderRowCount(
        folders,
        organization.folderRowCount
      ),
    },
    folder: folders.find((folder) => folder.id === folderId)!,
  };
}

/** Removes a tab from whichever folder holds it. Open tabs stay open. */
export function removeTabKeyFromFolders(
  organization: MobileTabOrganization,
  tabKey: string
): MobileTabOrganization {
  const inFolder =
    Boolean(organization.tabFolderMap[tabKey]) ||
    organization.folders.some((folder) => folder.tabKeys.includes(tabKey));
  if (!inFolder) return organization;

  const tabFolderMap = { ...organization.tabFolderMap };
  delete tabFolderMap[tabKey];
  const savedTabs = { ...organization.savedTabs };
  delete savedTabs[tabKey];
  const folders = organization.folders.map((folder) =>
    folder.tabKeys.includes(tabKey)
      ? { ...folder, tabKeys: folder.tabKeys.filter((key) => key !== tabKey) }
      : folder
  );
  return { ...organization, folders, tabFolderMap, savedTabs };
}
