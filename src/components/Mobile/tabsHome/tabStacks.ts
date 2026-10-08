import { getOpenTabKey } from '../mobileTabOrganization';
import { getTabAppIdentity, isPrivateAppTab } from '../privateAppTabIdentity';
import type { OpenTab } from '../useOpenTabs';

/**
 * Open tabs of the same Q-App or website, shown as one stacked card. A
 * public app or site is one stack whatever page or identifier each tab is
 * on. A private app's name is its publisher, so private tabs stack only with
 * the same app (name and identifier).
 */
export type TabStack = {
  key: string;
  /** In open order. */
  tabs: OpenTab[];
  /** The tab the card shows: the active one, else the newest. */
  lead: OpenTab;
};

export function stackKeyFor(tab: OpenTab): string {
  if (tab.internal || isPrivateAppTab(tab)) return getOpenTabKey(tab);
  const { service, name } = getTabAppIdentity(tab);
  return `${String(service || 'APP').toUpperCase()}|${String(name || '').toLowerCase()}`;
}

/** Groups open tabs into stacks, in the order each app was first opened. */
export function groupTabsIntoStacks(
  tabs: OpenTab[],
  activeTabId: string | null | undefined
): TabStack[] {
  const byKey = new Map<string, OpenTab[]>();
  tabs.forEach((tab) => {
    const key = stackKeyFor(tab);
    const list = byKey.get(key);
    if (list) list.push(tab);
    else byKey.set(key, [tab]);
  });
  return Array.from(byKey, ([key, list]) => ({
    key,
    tabs: list,
    lead:
      list.find((tab) => activeTabId != null && tab.tabId === activeTabId) ??
      list[list.length - 1],
  }));
}

/** A page label for one tab of a stack: its path, or the app's start page. */
export function tabPageLabel(tab: OpenTab): string {
  const { path, identifier } = getTabAppIdentity(tab);
  const page = String(path || '').replace(/^\/+/, '');
  if (page) return `/${page}`;
  return identifier ? String(identifier) : '/';
}
