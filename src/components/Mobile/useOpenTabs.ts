import { useEffect, useState } from 'react';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { getPrivateAppIdentity } from './privateAppTabIdentity';

export type OpenTab = {
  tabId?: string;
  name?: string;
  service?: string;
  internal?: string;
  label?: string;
  [key: string]: unknown;
};

type OpenTabsState = {
  tabs: OpenTab[];
  selectedTab: OpenTab | null;
};

/**
 * Mirrors the live tab list that AppsDesktop broadcasts via the `setTabsToNav`
 * event. Used by the mobile top bar (active-tab indicator) and the mobile tab
 * grid overlay so they share the same source of truth as the desktop nav.
 */
export function useOpenTabs(): OpenTabsState {
  const [state, setState] = useState<OpenTabsState>({
    tabs: [],
    selectedTab: null,
  });

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const data = e.detail?.data;
      if (!data) return;
      setState({
        tabs: Array.isArray(data.tabs) ? data.tabs : [],
        selectedTab: data.selectedTab ?? null,
      });
    };
    subscribeToEvent('setTabsToNav', handler);
    return () => unsubscribeFromEvent('setTabsToNav', handler);
  }, []);

  return state;
}

export function selectOpenTab(tab: OpenTab) {
  executeEvent('setSelectedTab', { data: tab });
}

export function closeOpenTab(tabId?: string) {
  if (!tabId) return;
  executeEvent('removeTab', { data: { tabId } });
}

/** Close every open tab (mirrors desktop AppsDesktop closeAllTabs). */
export function closeAllOpenTabs() {
  executeEvent('closeAllTabs', {});
}

/**
 * Select a live tab, or reopen a saved/restored private app with Name+Identifier
 * via the private decrypt/preview path (never public qortal://APP/).
 */
export function openOrSelectTab(tab: OpenTab) {
  const privateIdentity = getPrivateAppIdentity(tab);
  const isSavedShell = String(tab.tabId || '').startsWith('saved:');
  const hasLivePreview =
    tab.isPreview === true && typeof tab.url === 'string' && Boolean(tab.url);

  if (privateIdentity) {
    // Restored session tabs keep identity but lose the preview URL / decrypt
    // binding — re-open through useHandlePrivateApps instead of selecting a dead shell.
    if (!hasLivePreview || isSavedShell) {
      if (tab.tabId && !isSavedShell) {
        closeOpenTab(tab.tabId);
      }
      executeEvent('openPrivateApp', {
        data: privateIdentity,
      });
      return;
    }
    selectOpenTab(tab);
    return;
  }

  if (tab.tabId && !isSavedShell) {
    selectOpenTab(tab);
    return;
  }

  executeEvent('addTab', {
    data: {
      service: tab.service,
      name: tab.name,
      internal: tab.internal,
      identifier: tab.identifier,
      path: tab.path,
      label: tab.label,
      navigateIfAlreadyOpen: true,
    },
  });
}

/**
 * An app icon tapped (a Pinned folder, a Tabs folder): like a launcher, it
 * opens the app, and opens it again in another window when one is already
 * open. Open windows are switched to from their tab cards instead. Private
 * apps keep their single window (they reopen through their decrypt path).
 */
export function launchAppWindow(tab: OpenTab) {
  const isLive =
    Boolean(tab.tabId) && !String(tab.tabId).startsWith('saved:');
  if (!isLive || tab.internal || getPrivateAppIdentity(tab)) {
    openOrSelectTab(tab);
    return;
  }
  executeEvent('addTab', {
    data: {
      service: tab.service,
      name: tab.name,
      identifier: tab.identifier,
      label: tab.label,
    },
  });
}

export function updateOpenTab(
  tabId: string | undefined,
  patch: Partial<OpenTab>
) {
  if (!tabId) return;
  executeEvent('updateOpenTab', { data: { tabId, ...patch } });
}
