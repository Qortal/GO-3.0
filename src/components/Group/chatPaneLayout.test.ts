import { describe, expect, it } from 'vitest';
import {
  CHAT_LIST_PANE_WIDTH,
  getChatPaneLayout,
  sideViewOnCloseDetail,
  sideViewOnTwoPaneExit,
  type ChatPaneLayoutInput,
} from './chatPaneLayout';

const base: ChatPaneLayoutInput = {
  twoPane: false,
  isMobile: true,
  inChatDetail: false,
  directOpen: false,
  desktopSideView: 'groups',
  mobileListPanelOpen: false,
  mobileGroupPanelOpen: false,
};

const bools = [false, true];

describe('getChatPaneLayout', () => {
  it('without two-pane returns the old single-column expressions', () => {
    for (const isMobile of bools)
      for (const inChatDetail of bools)
        for (const directOpen of bools)
          for (const mobileListPanelOpen of bools)
            for (const mobileGroupPanelOpen of bools)
              for (const desktopSideView of ['groups', 'directs']) {
                const l = getChatPaneLayout({
                  twoPane: false,
                  isMobile,
                  inChatDetail,
                  directOpen,
                  desktopSideView,
                  mobileListPanelOpen,
                  mobileGroupPanelOpen,
                });
                expect(l).toEqual({
                  listPinned: false,
                  // display: isMobile && !inChatDetail ? 'none' : 'block'
                  showDetail: !(isMobile && !inChatDetail),
                  dmSideView: desktopSideView,
                  suppressGroupHighlight: false,
                  ignoreSectionSwipeOnRoot: isMobile && inChatDetail,
                  ignoreSectionSwipeOnDetail: false,
                  edgeSwipeEnabled:
                    isMobile && inChatDetail && !mobileListPanelOpen,
                  listOverlayOpen:
                    isMobile && inChatDetail && mobileListPanelOpen,
                  phoneBackArrows: isMobile,
                });
              }
  });

  it('two-pane pins the list and always shows the detail pane', () => {
    const empty = getChatPaneLayout({ ...base, twoPane: true });
    expect(empty.listPinned).toBe(true);
    // Nothing open: the empty states fill the right pane.
    expect(empty.showDetail).toBe(true);
    expect(empty.ignoreSectionSwipeOnRoot).toBe(false);
    expect(empty.ignoreSectionSwipeOnDetail).toBe(false);

    const open = getChatPaneLayout({
      ...base,
      twoPane: true,
      inChatDetail: true,
    });
    expect(open.listPinned).toBe(true);
    expect(open.showDetail).toBe(true);
    // Only the conversation stops section swipes; the list keeps its own.
    expect(open.ignoreSectionSwipeOnRoot).toBe(false);
    expect(open.ignoreSectionSwipeOnDetail).toBe(true);
    expect(open.phoneBackArrows).toBe(false);
  });

  it('two-pane shows a DM whatever page the list is on', () => {
    const l = getChatPaneLayout({
      ...base,
      twoPane: true,
      inChatDetail: true,
      directOpen: true,
      desktopSideView: 'groups',
    });
    expect(l.dmSideView).toBe('directs');
    expect(l.suppressGroupHighlight).toBe(true);

    // A group open: the list page is passed through and highlights it.
    const group = getChatPaneLayout({
      ...base,
      twoPane: true,
      inChatDetail: true,
      directOpen: false,
      desktopSideView: 'directs',
    });
    expect(group.dmSideView).toBe('directs');
    expect(group.suppressGroupHighlight).toBe(false);
    expect(
      getChatPaneLayout({
        ...base,
        twoPane: true,
        inChatDetail: true,
        desktopSideView: 'groups',
      }).dmSideView
    ).toBe('groups');
  });

  it('a full-section group panel unpins the list', () => {
    const l = getChatPaneLayout({
      ...base,
      twoPane: true,
      inChatDetail: true,
      mobileGroupPanelOpen: true,
    });
    expect(l.listPinned).toBe(false);
    expect(l.showDetail).toBe(true);
    // Back on the root like the single column (the panel owns its swipes).
    expect(l.ignoreSectionSwipeOnRoot).toBe(true);
    expect(l.ignoreSectionSwipeOnDetail).toBe(false);
    // Still two-pane: no slide-over list, no back arrows.
    expect(l.edgeSwipeEnabled).toBe(false);
    expect(l.phoneBackArrows).toBe(false);
  });

  it('turns the edge swipe, slide-over and back arrows off in two-pane', () => {
    for (const mobileListPanelOpen of bools) {
      const l = getChatPaneLayout({
        ...base,
        twoPane: true,
        inChatDetail: true,
        mobileListPanelOpen,
      });
      expect(l.edgeSwipeEnabled).toBe(false);
      expect(l.listOverlayOpen).toBe(false);
      expect(l.phoneBackArrows).toBe(false);
    }
  });

  it('ignores two-pane off the phone layout', () => {
    const l = getChatPaneLayout({
      ...base,
      twoPane: true,
      isMobile: false,
      inChatDetail: true,
      directOpen: true,
    });
    expect(l).toEqual(
      getChatPaneLayout({
        ...base,
        isMobile: false,
        inChatDetail: true,
        directOpen: true,
      })
    );
  });

  it('sizes the pinned list column', () => {
    expect(CHAT_LIST_PANE_WIDTH).toBe('clamp(320px, 36%, 420px)');
  });
});

describe('sideViewOnTwoPaneExit', () => {
  it('turns the list to DMs when two-pane ends with a DM beside Groups', () => {
    expect(
      sideViewOnTwoPaneExit({
        wasTwoPane: true,
        twoPane: false,
        directOpen: true,
        desktopSideView: 'groups',
      })
    ).toBe('directs');
  });

  it('leaves the list alone otherwise', () => {
    for (const wasTwoPane of bools)
      for (const twoPane of bools)
        for (const directOpen of bools)
          for (const desktopSideView of ['groups', 'directs']) {
            if (
              wasTwoPane &&
              !twoPane &&
              directOpen &&
              desktopSideView !== 'directs'
            )
              continue;
            expect(
              sideViewOnTwoPaneExit({
                wasTwoPane,
                twoPane,
                directOpen,
                desktopSideView,
              })
            ).toBeNull();
          }
  });
});

describe('sideViewOnCloseDetail', () => {
  it('single column: back lands on the page of the chat being left', () => {
    expect(
      sideViewOnCloseDetail({
        twoPane: false,
        groupOpen: true,
        directOpen: false,
      })
    ).toBe('groups');
    expect(
      sideViewOnCloseDetail({
        twoPane: false,
        groupOpen: false,
        directOpen: true,
      })
    ).toBe('directs');
    // A group left selected under a DM wins, as before two-pane.
    expect(
      sideViewOnCloseDetail({
        twoPane: false,
        groupOpen: true,
        directOpen: true,
      })
    ).toBe('groups');
    expect(
      sideViewOnCloseDetail({
        twoPane: false,
        groupOpen: false,
        directOpen: false,
      })
    ).toBeNull();
  });

  it('two-pane: the pinned list keeps the page the user chose', () => {
    for (const groupOpen of bools)
      for (const directOpen of bools)
        expect(
          sideViewOnCloseDetail({ twoPane: true, groupOpen, directOpen })
        ).toBeNull();
  });
});
