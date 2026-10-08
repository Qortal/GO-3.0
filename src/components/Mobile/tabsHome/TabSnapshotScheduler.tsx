import { useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { rawWalletAtom, userInfoAtom } from '../../../atoms/global';
import { appLockedAtom } from '../../../atoms/presence';
import { isQChatOpenTab } from '../../../utils/openQChatTab';
import { mobileQappFrameShowingAtom } from '../mobileQappFrame';
import { useOpenTabs } from '../useOpenTabs';
import {
  captureTabSnapshot,
  captureTabSnapshotSoon,
  clearTabSnapshots,
  pruneTabSnapshots,
} from './tabSnapshots';

const FIRST_PICTURE_MS = 1800;
const REFRESH_MS = 12000;

/** The open tab whose frame is on screen now, if any. */
let visibleTabId: string | null = null;

/**
 * Takes a fresh picture of the tab on screen before something covers it (the
 * Tabs panel). Waits at most `maxWaitMs`.
 */
export function captureVisibleTabSnapshot(maxWaitMs = 160): Promise<void> {
  return captureTabSnapshotSoon(visibleTabId, maxWaitMs);
}

/**
 * Phones: keeps a recent picture of the Q-App or website on screen for the
 * tab cards: one shortly after it shows, then every few seconds while it
 * stays (each is a small in-memory JPEG). Pictures of closed tabs are
 * dropped, and all of them on lock and on account change.
 */
export function TabSnapshotScheduler({ paused }: { paused: boolean }) {
  const { tabs, selectedTab } = useOpenTabs();
  const frameShowing = useAtomValue(mobileQappFrameShowingAtom);
  const locked = useAtomValue(appLockedAtom);
  const userInfo = useAtomValue(userInfoAtom);
  const rawWallet = useAtomValue(rawWalletAtom);
  const walletAddress = userInfo?.address || rawWallet?.address0 || '';
  const tabId =
    selectedTab && !isQChatOpenTab(selectedTab) && selectedTab.tabId
      ? String(selectedTab.tabId)
      : null;

  const openIds = tabs.map((tab) => String(tab.tabId || '')).join('|');
  useEffect(() => {
    pruneTabSnapshots(openIds.split('|').filter(Boolean));
  }, [openIds]);

  useEffect(() => {
    clearTabSnapshots();
  }, [walletAddress]);

  useEffect(() => {
    if (locked) clearTabSnapshots();
  }, [locked]);

  useEffect(() => {
    const active = frameShowing && !locked ? tabId : null;
    visibleTabId = active;
    if (!active || paused) return;
    const capture = () => void captureTabSnapshot(active);
    const first = window.setTimeout(capture, FIRST_PICTURE_MS);
    const refresh = window.setInterval(capture, REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(refresh);
    };
  }, [frameShowing, locked, paused, tabId]);

  useEffect(
    () => () => {
      visibleTabId = null;
    },
    []
  );

  return null;
}
