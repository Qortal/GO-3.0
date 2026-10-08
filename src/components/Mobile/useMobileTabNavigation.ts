import { useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { executeEvent } from '../../utils/events';
import {
  filterAppTabsForMobile,
  isQChatOpenTab,
  openMobileChatPanel,
} from '../../utils/openQChatTab';
import { useOpenTabs, type OpenTab } from './useOpenTabs';
import {
  isNewTabWindowAtom,
  qortinoAgentOpenAtom,
  qortinoAgentParkedAtom,
} from '../../atoms/global';
import {
  closeQortinoAgentSheet,
  restoreQortinoAgentSheet,
} from '../../qortinoAgent/qortinoSheetNav';

export type MobileTabKey = 'home' | 'apps' | 'chat';

/** Left to right, as the round buttons sit. */
export const MOBILE_TAB_ORDER: readonly MobileTabKey[] = [
  'home',
  'apps',
  'chat',
] as const;

/** The phone section a desktopViewMode belongs to, if any. */
export const mobileTabForViewMode = (
  desktopViewMode: string
): MobileTabKey | null =>
  desktopViewMode === 'home'
    ? 'home'
    : desktopViewMode === 'chat'
      ? 'chat'
      : desktopViewMode === 'apps' || desktopViewMode === 'dev'
        ? 'apps'
        : null;

/**
 * Going to Home, Apps or Chat on a phone, as the round tab buttons do it
 * (Apps brings back the last app or the library, Chat resumes the open
 * conversation, Home settles the Qortino sheet). Shared by the buttons and
 * the sideways swipe between sections, so both land in the same place.
 */
export function useMobileTabNavigation(
  desktopViewMode: string,
  setDesktopViewMode: (mode: string) => void
): { active: MobileTabKey; go: (tab: MobileTabKey) => void } {
  const [active, setActive] = useState<MobileTabKey>('home');
  const isNewTabWindow = useAtomValue(isNewTabWindowAtom);
  const qortinoOpen = useAtomValue(qortinoAgentOpenAtom);
  const qortinoParked = useAtomValue(qortinoAgentParkedAtom);
  const { tabs, selectedTab } = useOpenTabs();
  // Remember the last real app the user viewed so a later Apps tap can return
  // to it after the Explore/library window has been shown.
  const lastAppTabRef = useRef<OpenTab | null>(null);

  useEffect(() => {
    if (selectedTab && !isQChatOpenTab(selectedTab)) {
      lastAppTabRef.current = selectedTab;
    }
  }, [selectedTab]);

  useEffect(() => {
    if (desktopViewMode === 'home') setActive('home');
    else if (desktopViewMode === 'chat') setActive('chat');
    else if (desktopViewMode === 'apps' || desktopViewMode === 'dev')
      setActive('apps');
  }, [desktopViewMode]);

  const go = (tab: MobileTabKey) => {
    setActive(tab);
    switch (tab) {
      case 'home':
        // Qortino loop: parked after Q-App → restore sheet; sheet open on home → dismiss.
        if (qortinoParked) {
          restoreQortinoAgentSheet();
          setDesktopViewMode('home');
          executeEvent('open-home-mode', {});
          break;
        }
        if (qortinoOpen) {
          closeQortinoAgentSheet();
          setDesktopViewMode('home');
          executeEvent('open-home-mode', {});
          break;
        }
        setDesktopViewMode('home');
        executeEvent('open-home-mode', {});
        break;
      case 'apps': {
        // Cycle behaviour:
        //  - arriving from another section: show the last-used app (or the
        //    Explore/library window if nothing is open yet);
        //  - already on an app: tap opens the Explore/library window;
        //  - already on the library: tap returns to the most-recent app.
        const appTabs = filterAppTabsForMobile(tabs);
        const hasOpenApp =
          appTabs.length > 0 ||
          Boolean(selectedTab && !isQChatOpenTab(selectedTab));
        const alreadyOnApps =
          active === 'apps' ||
          desktopViewMode === 'apps' ||
          desktopViewMode === 'dev';

        if (!alreadyOnApps) {
          // Restore the last-used app (AppsDesktop keeps its selected tab),
          // falling back to the library when there's nothing open.
          setDesktopViewMode('apps');
          if (!hasOpenApp) {
            executeEvent('newTabWindow', {});
          }
          break;
        }

        if (isNewTabWindow) {
          // Showing the library → go back to the most-recently opened app.
          const recentApp =
            (lastAppTabRef.current &&
              appTabs.find(
                (tab) => tab.tabId === lastAppTabRef.current?.tabId
              )) ||
            appTabs[appTabs.length - 1] ||
            null;
          if (recentApp) {
            executeEvent('setSelectedTab', { data: recentApp });
          } else {
            executeEvent('newTabWindow', {});
          }
        } else {
          // Showing an app → open the Explore/library window.
          executeEvent('newTabWindow', {});
        }
        setDesktopViewMode('apps');
        break;
      }
      case 'chat': {
        // Cycle behaviour (handled in Group.tsx via 'mobile-chat-tab'):
        //  - first entry after launch: the Groups/PM list, never a conversation;
        //  - arriving from another section: resume the conversation left open;
        //  - already on Chat: toggle between that conversation and its list.
        const reEntry = active === 'chat' || desktopViewMode === 'chat';
        setDesktopViewMode('chat');
        openMobileChatPanel();
        executeEvent('mobile-chat-tab', { data: { reEntry } });
        break;
      }
    }
  };

  return { active, go };
}
