import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { QortalMedia } from '../../../plugins/QortalMedia';
import { closeGoWindows } from '../../../utils/closeGoWindows';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../../utils/events';
import type { OpenTab } from '../useOpenTabs';
import {
  applyBackgroundPlayerState,
  backgroundPlayerAvailable,
  findTabIdForMediaFrame,
  openBackgroundPlayerWindow,
  pushNativeMediaStrings,
  refreshBackgroundPlayer,
  rememberMediaFrame,
} from './backgroundPlayer';

/**
 * The notification was tapped: show the tab the media plays in. GO's own
 * page (a chat voice message, a Home video) needs nothing: GO is open.
 */
export function openMediaSource(
  frameId: string,
  goPage: boolean,
  tabs: OpenTab[]
): boolean {
  if (goPage || !frameId) return false;
  const tabId = findTabIdForMediaFrame(frameId);
  if (!tabId) return false;
  const tab = tabs.find((candidate) => candidate?.tabId === tabId);
  if (!tab) return false;
  closeGoWindows();
  executeEvent('setSelectedTab', { data: tab });
  executeEvent('open-apps-mode', {});
  return true;
}

/**
 * Mounted once (App): listens to GO's background player on Android.
 * Notification gear → the settings window; notification tap → the tab that
 * plays; "Now playing" kept current; the notification's button texts in
 * GO's language.
 */
export function useBackgroundPlayerBridge(): void {
  const { t, i18n } = useTranslation(['core']);
  const tabsRef = useRef<OpenTab[]>([]);

  useEffect(() => {
    if (!backgroundPlayerAvailable()) return undefined;
    window.addEventListener('message', rememberMediaFrame);
    return () => window.removeEventListener('message', rememberMediaFrame);
  }, []);

  useEffect(() => {
    const onTabs = (event: CustomEvent) => {
      const tabs = event.detail?.data?.tabs;
      if (Array.isArray(tabs)) tabsRef.current = tabs;
    };
    subscribeToEvent('setTabsToNav', onTabs);
    return () => unsubscribeFromEvent('setTabsToNav', onTabs);
  }, []);

  useEffect(() => {
    if (!backgroundPlayerAvailable()) return undefined;
    let cancelled = false;
    let handles: { remove: () => Promise<void> }[] = [];
    Promise.all([
      QortalMedia.addListener('playerChanged', applyBackgroundPlayerState),
      QortalMedia.addListener('openSettings', () => {
        closeGoWindows();
        openBackgroundPlayerWindow();
      }),
      QortalMedia.addListener('openSource', ({ frameId, goPage }) => {
        openMediaSource(frameId, goPage, tabsRef.current);
      }),
    ])
      .then((added) => {
        if (cancelled) added.forEach((handle) => void handle.remove());
        else handles = added;
      })
      .catch((error) =>
        console.warn('[backgroundPlayer] listeners failed', error)
      );
    void refreshBackgroundPlayer();
    return () => {
      cancelled = true;
      handles.forEach((handle) => void handle.remove());
    };
  }, []);

  useEffect(() => {
    pushNativeMediaStrings(t);
  }, [i18n.language, t]);
}
