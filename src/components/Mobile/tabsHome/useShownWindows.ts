import { useCallback, useEffect, useState } from 'react';
import type { OpenTab } from '../useOpenTabs';
import type { TabStack } from './tabStacks';

/**
 * Which window of each app a tab card shows. A card starts on the app's lead
 * window (the active one, else the newest); tapping one of its window
 * avatars shows that one instead, until `resetToken` changes (the Tabs panel
 * or the Pinned tab opening again).
 */
export function useShownWindows(resetToken: unknown) {
  const [picked, setPicked] = useState<Record<string, string>>({});

  useEffect(() => {
    setPicked({});
  }, [resetToken]);

  const shownFor = useCallback(
    (stack: TabStack): OpenTab =>
      stack.tabs.find((tab) => String(tab.tabId) === picked[stack.key]) ??
      stack.lead,
    [picked]
  );

  const pick = useCallback((stackKey: string, tab: OpenTab) => {
    setPicked((prev) => ({ ...prev, [stackKey]: String(tab.tabId) }));
  }, []);

  return { shownFor, pick };
}
