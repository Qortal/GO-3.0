import { useEffect, useState } from 'react';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';

export type OpenTab = {
  tabId?: string;
  name?: string;
  service?: string;
  internal?: string;
  label?: string;
  [key: string]: unknown;
};

export type OpenTabsState = {
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

export function openOrSelectTab(tab: OpenTab) {
  if (tab.tabId && !String(tab.tabId).startsWith('saved:')) {
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

export function updateOpenTab(
  tabId: string | undefined,
  patch: Partial<OpenTab>
) {
  if (!tabId) return;
  executeEvent('updateOpenTab', { data: { tabId, ...patch } });
}
