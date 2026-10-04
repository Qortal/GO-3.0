/**
 * Dev-only preview of the Q-Chat phone lists (Groups and DMs) with mock data,
 * side by side at phone widths. Run `npm run dev` and open
 * /tools/preview/qchat-lists.html. Not a build input, so it never ships.
 *
 * The page forces the phone layout at any window width (md breakpoint moved
 * out of reach), so the lists render as on a phone.
 *
 * The third frame is the Groups / DMs pager of the phone's Q-Chat home: swipe
 * it sideways in DevTools' device mode, or run `await __pagerSwipe(-200)` in
 * the console. The "pager" button turns the swipe off, as for the list swiped
 * in over an open chat.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import {
  ThemeProvider as MuiThemeProvider,
  unstable_createBreakpoints as createBreakpoints,
  type Theme,
} from '@mui/material/styles';
import { Provider, createStore } from 'jotai';
import i18n from '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import {
  memberGroupsAtom,
  reticulumChatSummariesAtom,
} from '../../src/atoms/global';
import {
  getPinnedGroupIdsSync,
  loadPinnedGroupIds,
  setPinnedGroupIds,
} from '../../src/utils/pinnedGroups';
import { GroupList } from '../../src/components/Group/GroupList';
import { DirectsSidebar } from '../../src/components/Group/DirectsSidebar';
import { MobileChatListPager } from '../../src/components/Group/MobileChatListPager';
import type { ChatScope } from '../../src/components/Group/ChatScopeSwitch';

// English for the keys this change adds, until they are in the locale files
// (an existing value always wins; other languages fall back to English).
const NEW_KEYS = {
  chat_scope: {
    direct_messages: 'DMs',
    groups: 'Groups',
    label: 'Show groups or direct messages',
  },
  dm_list: {
    empty: 'No current private messages.',
    subtitle: 'Private Reticulum chats',
  },
  group_list: {
    empty: 'You have not joined any Q-Chat communities yet.',
    pin_hold_hint: 'Hold to rearrange pinned groups',
    pinned: 'Pinned',
    reorder_hint: 'Drag pinned groups to reorder',
  },
};
i18n.addResourceBundle('en', 'reticulum', NEW_KEYS, true, false);

const ME = 'QMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMe1';
const now = Date.now();

// Row clicks report the visit to the background; nothing to report to here.
const w = window as unknown as { sendMessage?: unknown };
if (typeof w.sendMessage !== 'function') {
  w.sendMessage = async () => null;
}

const groups = [
  { groupId: '0', groupName: 'General', timestamp: now - 90_000 },
  { groupId: '9001', groupName: 'Hiking Club', timestamp: now - 60_000 },
  { groupId: '9002', groupName: 'Qortal Devs', timestamp: now - 120_000 },
  {
    groupId: '9003',
    groupName: 'A group with a very long name that has to shorten',
    timestamp: now - 3_600_000,
  },
  { groupId: '9004', groupName: 'Painters', timestamp: now - 86_400_000 },
  { groupId: '9005', groupName: 'Readers' },
];

const summaries = {
  '9001': { groupId: 9001, unreadCount: 3 },
  '9002': { groupId: 9002, unreadCount: 1, mentionCount: 1 },
};

const directs = [
  {
    address: ME,
    name: 'Saved messages',
    savedMessages: true,
    timestamp: now - 30_000,
  },
  {
    address: 'QAliceAliceAliceAliceAliceAlice01',
    name: 'Alice',
    timestamp: now - 45_000,
    unreadCount: 2,
  },
  {
    address: 'QBobBobBobBobBobBobBobBobBobBob01',
    name: 'Bob',
    timestamp: now - 600_000,
    lastCall: { outcome: 'missed', endedAt: now - 600_000 },
    lastMessageTimestamp: now - 900_000,
    unreadCount: 1,
    unreadMissedCallCount: 1,
  },
  {
    address: 'QCarolCarolCarolCarolCarolCarol1',
    name: 'Carol with a rather long registered name',
    timestamp: now - 7_200_000,
  },
  { address: 'QDaveDaveDaveDaveDaveDaveDave01' },
];

const friends = {
  QAliceAliceAliceAliceAliceAlice01: {
    publicKey: 'preview',
    name: 'Alice',
    addedAt: now,
  },
};

const store = createStore();
store.set(memberGroupsAtom, groups as never);
store.set(reticulumChatSummariesAtom, summaries as never);

// Full-width lists on 340/360/412px phones, plus the list swiped in over an
// open chat (86% of the screen) on 340px and 360px phones.
const WIDTHS = [
  { value: 292, label: '292px (swiped in, 340 phone)' },
  { value: 310, label: '310px (swiped in, 360 phone)' },
  { value: 340, label: '340px' },
  { value: 360, label: '360px' },
  { value: 412, label: '412px' },
];
const DEMO_PINS = ['9001', '9002'];

/**
 * Drives a one-finger swipe on the pager with synthetic touch events, for
 * checking it without a touch screen (in the console:
 * `await __pagerSwipe(-200)`; negative is right-to-left, towards DMs;
 * `{ restMs: 800 }` rests the finger before it lifts). The
 * moves are stamped 16ms apart over `durationMs`, so the outcome does not
 * depend on how often a hidden tab gets frames; the glide after letting go
 * plays as usual. Real swipes work in Chrome DevTools' device mode.
 * Untrusted events never scroll, so this exercises only the pager's own
 * handling.
 */
const pagerSwipe = async (
  dx: number,
  {
    durationMs = 240,
    dy = 0,
    restMs = 0,
    startX,
  }: {
    durationMs?: number;
    dy?: number;
    /** The finger rests this long (no moves, as on a phone) before lifting. */
    restMs?: number;
    startX?: number;
  } = {}
) => {
  const viewport = document.querySelector('[data-chat-list-pager]');
  if (!viewport) throw new Error('no pager on the page');
  const rect = viewport.getBoundingClientRect();
  const x0 = startX ?? rect.left + rect.width / 2;
  const y0 = rect.top + rect.height / 2;
  const target = document.elementFromPoint(x0, y0) ?? viewport;
  const touchAt = (x: number, y: number) =>
    new Touch({ clientX: x, clientY: y, identifier: 1, target });
  const fire = (type: string, touches: Touch[], timeStamp: number) => {
    const event = new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      changedTouches: touches.length ? touches : [touchAt(x0 + dx, y0 + dy)],
      touches,
    });
    Object.defineProperty(event, 'timeStamp', { value: timeStamp });
    target.dispatchEvent(event);
  };
  const steps = Math.max(2, Math.round(durationMs / 16));
  const t0 = performance.now();
  fire('touchstart', [touchAt(x0, y0)], t0);
  for (let i = 1; i <= steps; i += 1) {
    fire(
      'touchmove',
      [touchAt(x0 + (dx * i) / steps, y0 + (dy * i) / steps)],
      t0 + i * 16
    );
  }
  fire('touchend', [], t0 + steps * 16 + restMs);
  // Let the glide finish before the next swipe.
  await new Promise((resolve) => window.setTimeout(resolve, 450));
};
(window as unknown as { __pagerSwipe: typeof pagerSwipe }).__pagerSwipe =
  pagerSwipe;

/** Phone layout at any window width: `md` is never reached. */
const phoneTheme = (outer: Theme): Theme => ({
  ...outer,
  breakpoints: createBreakpoints({
    values: { xs: 0, sm: 600, md: 100_000, lg: 100_001, xl: 100_002 },
  }),
});

function Frame({ children, width }: { children: ReactNode; width: number }) {
  return (
    <div
      style={{
        border: '1px solid rgba(128,128,128,0.4)',
        borderRadius: 12,
        display: 'flex',
        flexShrink: 0,
        height: 640,
        overflow: 'hidden',
        width,
      }}
    >
      {children}
    </div>
  );
}

function Preview() {
  const { themeMode, toggleTheme } = useThemeContext();
  const [width, setWidth] = useState(360);
  const [selectedGroup, setSelectedGroup] = useState<any>(null);
  const [selectedDirect, setSelectedDirect] = useState<any>(null);
  const [pinsOn, setPinsOn] = useState(false);
  const [pinsBefore, setPinsBefore] = useState<string[] | null>(null);
  const [pagerScope, setPagerScope] = useState<ChatScope>('groups');
  // Off: as when the list is swiped in over an open chat.
  const [pagerSwipeOn, setPagerSwipeOn] = useState(true);

  useEffect(() => {
    void loadPinnedGroupIds().then((ids) => {
      setPinsOn(DEMO_PINS.every((id) => ids.includes(id)));
    });
  }, []);

  // Pins live in the app's own storage, so they are only written on request
  // and the earlier pins come back when the demo pins are turned off.
  const togglePins = async () => {
    if (pinsOn) {
      await setPinnedGroupIds(
        pinsBefore ??
          getPinnedGroupIdsSync().filter((id) => !DEMO_PINS.includes(id))
      );
      setPinsOn(false);
      return;
    }
    const current = getPinnedGroupIdsSync();
    setPinsBefore(current);
    await setPinnedGroupIds([...DEMO_PINS, ...current]);
    setPinsOn(true);
  };

  const directsProps = {
    desktopSideView: 'directs',
    directChatHasUnread: true,
    directs,
    dmFriendsByAddress: friends as never,
    setSelectedDirect,
    setNewChat: () => {},
    setIsOpenDrawer: () => {},
    getTimestampEnterChat: async () => null,
    selectedDirect,
    timestampEnterData: {},
    timeDifferenceForNotificationChats: 0,
    myAddress: ME,
    isRunningPublicNode: false,
    setIsOpenBlockedUserModal: () => {},
    reticulumChatEnabled: true,
    setDesktopSideView: () => {},
  };

  return (
    <div style={{ padding: 8 }}>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}
      >
        {WIDTHS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setWidth(value)}
            style={{ fontWeight: value === width ? 700 : 400 }}
          >
            {label}
          </button>
        ))}
        <button onClick={toggleTheme}>{themeMode}</button>
        <button onClick={() => void togglePins()}>
          demo pins: {pinsOn ? 'on' : 'off'}
        </button>
        <button onClick={() => setPagerSwipeOn((on) => !on)}>
          pager: {pagerSwipeOn ? 'home (swipe on)' : 'over a chat (swipe off)'}
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <Frame width={width}>
          <GroupList
            selectGroupFunc={setSelectedGroup}
            setDesktopSideView={() => {}}
            desktopSideView="groups"
            directChatHasUnread
            directChatUnreadCount={3}
            chatMode="groups"
            selectedGroup={selectedGroup}
            getUserSettings={async () => null}
            setOpenAddGroup={() => {}}
            setOpenFindGroup={() => {}}
            setIsOpenBlockedUserModal={() => {}}
            myAddress={ME}
            reticulumChatEnabled
          />
        </Frame>
        <Frame width={width}>
          <DirectsSidebar {...directsProps} />
        </Frame>
        {/* The Groups / DMs pager as on the phone's Q-Chat home: swipe
            sideways (DevTools device mode) or run __pagerSwipe(-200). */}
        <Frame width={width}>
          <MobileChatListPager
            swipeEnabled={pagerSwipeOn}
            scope={pagerScope}
            onScopeChange={setPagerScope}
            renderGroups={(keepPhoneList) => (
              <GroupList
                selectGroupFunc={setSelectedGroup}
                setDesktopSideView={setPagerScope}
                desktopSideView={pagerScope}
                directChatHasUnread
                directChatUnreadCount={3}
                chatMode="groups"
                selectedGroup={selectedGroup}
                getUserSettings={async () => null}
                setOpenAddGroup={() => {}}
                setOpenFindGroup={() => {}}
                setIsOpenBlockedUserModal={() => {}}
                myAddress={ME}
                reticulumChatEnabled
                keepPhoneList={keepPhoneList}
              />
            )}
            renderDirects={(mounted) =>
              mounted ? (
                <DirectsSidebar
                  {...directsProps}
                  desktopSideView={pagerScope}
                  setDesktopSideView={setPagerScope}
                />
              ) : null
            }
          />
        </Frame>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <MuiThemeProvider theme={phoneTheme}>
      <CssBaseline />
      <Provider store={store}>
        <Preview />
      </Provider>
    </MuiThemeProvider>
  </ThemeProvider>
);
