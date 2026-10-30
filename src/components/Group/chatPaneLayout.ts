/**
 * How the phone Q-Chat section lays out its list and conversation.
 *
 * Phones (and narrow GO windows) run one column: the list fills the section,
 * a chat replaces it, and the list can slide back over the chat. GO tablets
 * and wide windows run two panes: the same list, pinned on the left, beside
 * the same detail pane. Only sx and props change between the two, so rotating
 * never remounts the list or the open chat.
 *
 * With `twoPane` false every field is exactly the expression Group.tsx used
 * before two-pane existed.
 */

type ChatSideView = 'groups' | 'directs';

/** List column width while pinned beside the conversation. */
export const CHAT_LIST_PANE_WIDTH = 'clamp(320px, 36%, 420px)';

export interface ChatPaneLayoutInput {
  /** GO two-pane signal, already limited to the phone Chat section. */
  twoPane: boolean;
  isMobile: boolean;
  /** A group, DM or new chat is selected. */
  inChatDetail: boolean;
  /** A DM or new chat is selected. */
  directOpen: boolean;
  /** Which list page shows (the Groups / DMs switch). */
  desktopSideView: string;
  /** The list slid over the conversation (single column only). */
  mobileListPanelOpen: boolean;
  /** Threads, Land, Members, Calendar, Files or Admin keys fill the section. */
  mobileGroupPanelOpen: boolean;
}

interface ChatPaneLayout {
  /** The list sits beside the conversation instead of sliding over it. */
  listPinned: boolean;
  /** The detail pane is laid out (else display: none). */
  showDetail: boolean;
  /** Stands in for desktopSideView when deciding whether a DM shows. In two
   * panes the selection decides, so swiping the list to Groups keeps it. */
  dmSideView: string;
  /** The Groups list highlights no group while a DM fills the right pane. */
  suppressGroupHighlight: boolean;
  /** Section swipes stop at the whole Q-Chat box (an open chat, one column). */
  ignoreSectionSwipeOnRoot: boolean;
  /** Section swipes stop at the conversation only (the pinned list keeps its
   * Groups / DMs swipes and the section swipe beyond them). */
  ignoreSectionSwipeOnDetail: boolean;
  /** The left-edge swipe may slide the list over the chat. Group.tsx also
   * needs the swipe back to be off (it replaces the edge swipe). */
  edgeSwipeEnabled: boolean;
  /** The list is slid over the chat: scrim plus the list's swipe to close. */
  listOverlayOpen: boolean;
  /** Chat headers show a back arrow to the list. */
  phoneBackArrows: boolean;
}

export function getChatPaneLayout({
  twoPane,
  isMobile,
  inChatDetail,
  directOpen,
  desktopSideView,
  mobileListPanelOpen,
  mobileGroupPanelOpen,
}: ChatPaneLayoutInput): ChatPaneLayout {
  const two = isMobile && twoPane;
  // A full-section group panel takes the list's place too; its X pins it again.
  const listPinned = two && !mobileGroupPanelOpen;
  return {
    listPinned,
    showDetail: !isMobile || inChatDetail || listPinned,
    dmSideView: two && directOpen ? 'directs' : desktopSideView,
    suppressGroupHighlight: two && directOpen,
    ignoreSectionSwipeOnRoot: isMobile && inChatDetail && !listPinned,
    ignoreSectionSwipeOnDetail: listPinned && inChatDetail,
    edgeSwipeEnabled: isMobile && !two && inChatDetail && !mobileListPanelOpen,
    listOverlayOpen: isMobile && !two && inChatDetail && mobileListPanelOpen,
    phoneBackArrows: isMobile && !two,
  };
}

/**
 * Leaving two-pane (rotation, split screen) with a DM or new chat open while
 * the list sits on Groups: the single column shows a DM only on the DMs page,
 * so the page has to turn with it or the open DM would vanish. Returns the
 * page to switch to, or null to leave it.
 */
export function sideViewOnTwoPaneExit({
  wasTwoPane,
  twoPane,
  directOpen,
  desktopSideView,
}: {
  wasTwoPane: boolean;
  twoPane: boolean;
  directOpen: boolean;
  desktopSideView: string;
}): ChatSideView | null {
  return wasTwoPane && !twoPane && directOpen && desktopSideView !== 'directs'
    ? 'directs'
    : null;
}

/**
 * Closing a conversation (Android back, swipe back). The single column turns
 * the list to the page of the chat being left, so a group never drops the
 * user on the DMs. A pinned list is already on screen at the page the user
 * chose, so it stays put. Returns the page to switch to, or null to leave it.
 */
export function sideViewOnCloseDetail({
  twoPane,
  groupOpen,
  directOpen,
}: {
  twoPane: boolean;
  groupOpen: boolean;
  /** A DM or new chat is selected. */
  directOpen: boolean;
}): ChatSideView | null {
  if (twoPane) return null;
  if (groupOpen) return 'groups';
  if (directOpen) return 'directs';
  return null;
}
