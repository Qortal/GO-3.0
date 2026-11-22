import { getData, storeData } from '../../utils/chromeStorage';
import { getTabAppIdentity } from './privateAppTabIdentity';
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
type SavedTabSnapshot = {
  service?: string;
  name?: string;
  internal?: string;
  identifier?: string;
  path?: string;
  label?: string;
  isPrivate?: boolean;
  privateAppProperties?: Record<string, unknown>;
};

type TabOverride = {
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
  /**
   * The folders are bookmark folders now, the desktop Hub's, carried by the
   * QDN settings: `folders`, `tabFolderMap` and `savedTabs` are what they
   * were before the move, kept and no longer read.
   */
  movedToBookmarks?: boolean;
  /** How each bookmark folder looks on this phone: size and Tabs row. */
  folderLooks?: Record<string, { size?: 'small'; row?: number }>;
  /**
   * Apps the move pinned, waiting until the pin list saved on QDN was
   * read, so they join it instead of standing in for it.
   */
  pendingPins?: Record<string, unknown>[];
};

const STORAGE_PREFIX = 'hub_mobile_tab_org_';

const SAVED_TAB_ID_PREFIX = 'saved:';
/** The id of a tab made from a saved entry that has no key yet. */
const PENDING_SAVED_TAB_ID = 'saved:pending';

export const getOpenTabKey = (tab: OpenTab): string => {
  // A saved entry keeps the key it is saved under: a bookmark of a page
  // inside an app has a key of its own, which its fields would not give.
  const tabId = tab.tabId;
  if (
    typeof tabId === 'string' &&
    tabId.startsWith(SAVED_TAB_ID_PREFIX) &&
    tabId !== PENDING_SAVED_TAB_ID &&
    tabId.length > SAVED_TAB_ID_PREFIX.length
  ) {
    return tabId.slice(SAVED_TAB_ID_PREFIX.length);
  }
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

export function pinnedAppToOpenTab(
  item:
    | {
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
      }
    | null
    | undefined
): OpenTab | null {
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

function savedTabToOpenTab(
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
      typeof stored.folderRowCount === 'number'
        ? stored.folderRowCount
        : undefined
    ),
    ...(stored.movedToBookmarks === true ? { movedToBookmarks: true } : {}),
    ...(stored.folderLooks && typeof stored.folderLooks === 'object'
      ? { folderLooks: stored.folderLooks }
      : {}),
    ...(Array.isArray(stored.pendingPins) && stored.pendingPins.length
      ? { pendingPins: stored.pendingPins }
      : {}),
  };
}

export async function saveMobileTabOrganization(
  walletAddress: string | undefined | null,
  organization: MobileTabOrganization
): Promise<void> {
  if (!walletAddress) return;
  await storeData(`${STORAGE_PREFIX}${walletAddress}`, organization);
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
