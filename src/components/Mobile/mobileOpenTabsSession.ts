import { getData, storeData } from '../../utils/chromeStorage';
import {
  getTabAppIdentity,
  isPrivateAppTab,
  serializePrivateAppProperties,
} from './privateAppTabIdentity';
import { isDevZipTab } from './devMode/devModeApp';

export type PersistedOpenTab = {
  tabId: string;
  service?: string;
  name?: string;
  internal?: string;
  identifier?: string;
  path?: string;
  label?: string;
  isPrivate?: boolean;
  /** Private-app logo as data URL (for tab avatar after restore). */
  logo?: string;
  privateAppProperties?: Record<string, unknown>;
};

export type MobileOpenTabsSession = {
  tabs: PersistedOpenTab[];
  selectedTabId: string | null;
  viewerTabOrder: string[];
  desktopViewMode?: 'home' | 'apps';
  appsMode?: string;
};

const STORAGE_PREFIX = 'hub_mobile_open_tabs_';

const emptySession = (): MobileOpenTabsSession => ({
  tabs: [],
  selectedTabId: null,
  viewerTabOrder: [],
});

export function serializeTabForSession(tab: Record<string, unknown>): PersistedOpenTab | null {
  const tabId = typeof tab.tabId === 'string' ? tab.tabId : '';
  if (!tabId) return null;
  // A Dev Mode app lives in memory only; restored, its name would open as a
  // published app.
  if (isDevZipTab(tab)) return null;

  const identity = getTabAppIdentity(tab);
  const privateAppProperties = serializePrivateAppProperties(tab);
  const isPrivate = isPrivateAppTab(tab) || privateAppProperties != null;
  const logo =
    typeof privateAppProperties?.logo === 'string'
      ? privateAppProperties.logo
      : undefined;

  return {
    tabId,
    service: identity.service || undefined,
    name: identity.name || undefined,
    internal: tab.internal != null ? String(tab.internal) : undefined,
    identifier: identity.identifier,
    path: identity.path,
    label: identity.label || undefined,
    isPrivate: isPrivate ? true : undefined,
    logo,
    ...(privateAppProperties ? { privateAppProperties } : {}),
  };
}

export async function loadMobileOpenTabsSession(
  walletAddress: string | undefined | null
): Promise<MobileOpenTabsSession | null> {
  if (!walletAddress) return null;
  const stored = await getData<MobileOpenTabsSession>(
    `${STORAGE_PREFIX}${walletAddress}`
  );
  if (!stored || typeof stored !== 'object') return null;

  const tabs = Array.isArray(stored.tabs)
    ? stored.tabs
        .map((tab) =>
          tab && typeof tab === 'object' ? serializeTabForSession(tab) : null
        )
        .filter(Boolean) as PersistedOpenTab[]
    : [];

  if (tabs.length === 0) return null;

  const tabIds = new Set(tabs.map((tab) => tab.tabId));
  const viewerTabOrder = Array.isArray(stored.viewerTabOrder)
    ? stored.viewerTabOrder.filter(
        (tabId): tabId is string =>
          typeof tabId === 'string' && tabIds.has(tabId)
      )
    : tabs.map((tab) => tab.tabId);

  const selectedTabId =
    typeof stored.selectedTabId === 'string' && tabIds.has(stored.selectedTabId)
      ? stored.selectedTabId
      : tabs[0]?.tabId ?? null;

  return {
    tabs,
    selectedTabId,
    viewerTabOrder,
    desktopViewMode:
      stored.desktopViewMode === 'apps' ? 'apps' : 'home',
    appsMode: typeof stored.appsMode === 'string' ? stored.appsMode : 'viewer',
  };
}

export async function saveMobileOpenTabsSession(
  walletAddress: string | undefined | null,
  session: MobileOpenTabsSession
): Promise<void> {
  if (!walletAddress) return;
  if (!session.tabs.length) {
    await storeData(`${STORAGE_PREFIX}${walletAddress}`, emptySession());
    return;
  }
  await storeData(`${STORAGE_PREFIX}${walletAddress}`, session);
}
