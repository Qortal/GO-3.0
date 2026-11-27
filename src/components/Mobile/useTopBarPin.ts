import { useCallback, useMemo } from 'react';
import { extractComponents } from '../Chat/MessageDisplay';
import {
  isPinnedApp,
  pinnedAppOfTab,
  usePinnedAppsList,
  useTogglePinnedApp,
} from '../../hooks/usePinnedApps';
import { isPrivateAppTab } from './privateAppTabIdentity';
import type { OpenTab } from './useOpenTabs';

export type TopBarPin = {
  pinned: boolean;
  toggle: () => void;
};

/**
 * The search bar's pin, as on the desktop Hub: it pins the Q-App or website
 * on screen to the pinned apps and bookmarks (GO's Home), or unpins it. A
 * private app pins as its tab says; any other app as the address on screen
 * names it, so a link followed inside a tab pins the app it went to. Null
 * when there is nothing to pin (no tab, a GO page of its own).
 */
export function useTopBarPin(
  tab: OpenTab | null,
  url: string
): TopBarPin | null {
  const pinnedApps = usePinnedAppsList();
  const togglePinnedApp = useTogglePinnedApp();
  const candidate = useMemo(() => {
    if (!tab) return null;
    if (isPrivateAppTab(tab)) return pinnedAppOfTab(tab);
    const shown = url ? extractComponents(url) : null;
    return pinnedAppOfTab(
      shown ? { ...tab, service: shown.service, name: shown.name } : tab
    );
  }, [tab, url]);
  const pinned = isPinnedApp(pinnedApps, candidate);
  const toggle = useCallback(
    () => togglePinnedApp(candidate),
    [candidate, togglePinnedApp]
  );
  return useMemo(
    () => (candidate ? { pinned, toggle } : null),
    [candidate, pinned, toggle]
  );
}
