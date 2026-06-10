import { executeEvent } from './events';
import { isCapacitor, isMobileViewport } from './platform';

export const QCHAT_INTERNAL_TAB_ID = 'q-chat';

export type QChatOpenTabLike = {
  internal?: string;
};

/** True when chat should use the bottom-panel surface instead of an Apps tab. */
export const shouldUseMobileChatPanel = () =>
  isCapacitor() || isMobileViewport();

export const isQChatOpenTab = (tab?: QChatOpenTabLike | null) =>
  tab?.internal === QCHAT_INTERNAL_TAB_ID;

/** Hide Q-Chat from the mobile tabs grid — it lives on the bottom Chat panel only. */
export const filterAppTabsForMobile = <T extends QChatOpenTabLike>(tabs: T[]) =>
  tabs.filter((tab) => !isQChatOpenTab(tab));

/** Open Q-Chat on mobile via the bottom navigation panel (not the Apps tab strip). */
export const openMobileChatPanel = () => {
  executeEvent('open-chat-mode', {});
};

// Q-Chat is backed by Hub's built-in chat state. On desktop it lives in the
// Q-App tab strip; on mobile it is only reachable from the bottom Chat panel.
export const openQChatTab = () => {
  if (shouldUseMobileChatPanel()) {
    openMobileChatPanel();
    return;
  }

  executeEvent('addTab', {
    data: {
      internal: QCHAT_INTERNAL_TAB_ID,
      name: 'Q-Chat',
      service: 'INTERNAL',
    },
  });
  executeEvent('open-apps-mode', {});
};
