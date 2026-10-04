import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { Provider, createStore } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { darkTheme } from '../../styles/theme-dark';

const pinned = vi.hoisted(() => ({ ids: [] as string[] }));
const contextMenuTouchStart = vi.hoisted(() => vi.fn());

// The real menu pulls in the whole app; a wrapper with the same long-press
// entry point (touchstart) is enough to see what reaches it.
vi.mock('../ContextMenu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => (
    <div onTouchStart={contextMenuTouchStart}>{children}</div>
  ),
}));
vi.mock('./ReticulumGroupAbout', () => ({
  prefetchReticulumGroupAboutMetadata: vi.fn(),
}));
vi.mock('./QChatWhatsNewDialog', () => ({ QChatWhatsNewDialog: () => null }));
vi.mock('../../utils/pinnedGroups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/pinnedGroups')>()),
  movePinnedGroup: vi.fn(),
  usePinnedGroupIds: () => pinned.ids,
}));

import {
  memberGroupsAtom,
  reticulumChatSummariesAtom,
} from '../../atoms/global';
import { GroupList } from './GroupList';

const i18n = createInstance();
void i18n.init({
  lng: 'en',
  resources: {
    en: {
      core: {
        action: { close: 'close' },
        message: { generic: { no_messages: 'no messages' } },
        settings: 'settings',
      },
      group: {
        action: { create_group: 'create group' },
        chat_group: { done: 'Done' },
        last_message_date: 'last message: {{date}}',
      },
      reticulum: {
        chat_scope: { direct_messages: 'DMs', groups: 'Groups' },
        group_list: {
          pin_hold_hint: 'Hold to rearrange pinned groups',
          pinned: 'Pinned',
          reorder_hint: 'Drag pinned groups to reorder',
        },
        settings: { text_size: { title: 'Text size' } },
        rail: {
          find_groups: 'Find Groups',
          group_settings: 'Group Settings',
        },
      },
    },
  },
});

const mockPhone = () => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: !query.includes('orientation'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

const groups = [
  { groupId: '11', groupName: 'Hikers', timestamp: Date.now() - 60_000 },
  { groupId: '12', groupName: 'Painters', timestamp: Date.now() - 60_000 },
  { groupId: '13', groupName: 'Readers', timestamp: Date.now() - 60_000 },
];

const renderPanel = (overrides: Record<string, unknown> = {}) => {
  const store = createStore();
  store.set(memberGroupsAtom, groups as any);
  store.set(reticulumChatSummariesAtom, {
    '11': { groupId: 11, unreadCount: 2 },
  });
  const props = {
    selectGroupFunc: vi.fn(),
    setDesktopSideView: vi.fn(),
    desktopSideView: 'groups',
    directChatHasUnread: false,
    directChatUnreadCount: 0,
    chatMode: 'groups',
    selectedGroup: null,
    getUserSettings: vi.fn(async () => null),
    setOpenAddGroup: vi.fn(),
    setOpenFindGroup: vi.fn(),
    setIsOpenBlockedUserModal: vi.fn(),
    myAddress: 'QMe',
    reticulumChatEnabled: true,
    ...overrides,
  };
  render(
    <I18nextProvider i18n={i18n}>
      <Provider store={store}>
        <ThemeProvider theme={darkTheme}>
          <GroupList {...props} />
        </ThemeProvider>
      </Provider>
    </I18nextProvider>
  );
  return props;
};

// jsdom has no PointerEvent, so fireEvent.pointer* would drop the finger
// position; a MouseEvent carries it.
const usePointerEvents = () => {
  if (typeof window.PointerEvent === 'function') return;
  vi.stubGlobal('PointerEvent', class extends MouseEvent {});
};

const rowOf = (name: string) =>
  screen.getAllByText(name)[0].closest('li') as HTMLElement;

describe('GroupList phone panel', () => {
  const originalMatchMedia = window.matchMedia;
  const originalSendMessage = (window as any).sendMessage;

  beforeEach(() => {
    mockPhone();
    // The settings screen reads its saved mention setting on open.
    (window as any).sendMessage = vi.fn(async () => null);
    pinned.ids = [];
    contextMenuTouchStart.mockClear();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    (window as any).sendMessage = originalSendMessage;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('has 44px header buttons with translated names', () => {
    const props = renderPanel();

    for (const name of ['Find Groups', 'Create group', 'Group Settings']) {
      expect(screen.getByRole('button', { name })).toHaveStyle({
        height: '44px',
        width: '44px',
      });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Find Groups' }));
    expect(props.setOpenFindGroup).toHaveBeenCalledWith(true);
  });

  it('gives the Q-Chat settings screen a 44px translated close button', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Group Settings' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Settings')).toBeInTheDocument();
    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(close).toHaveStyle({ height: '44px', width: '44px' });
  });

  it('shows unread group names in the accent colour', () => {
    renderPanel();

    expect(screen.getAllByText('Hikers')[0].closest('div')).toHaveStyle({
      color: darkTheme.palette.primary.main,
    });
    expect(screen.getAllByText('Painters')[0].closest('div')).toHaveStyle({
      color: darkTheme.palette.text.primary,
    });
  });

  it('opens the group on a short tap on the pin', () => {
    pinned.ids = ['11', '12'];
    const props = renderPanel();

    const pin = within(rowOf('Hikers')).getByTestId('group-row-pin');
    expect(pin).toHaveStyle({ height: '44px', width: '44px' });
    fireEvent.pointerDown(pin);
    fireEvent.pointerUp(pin);
    fireEvent.click(pin);

    expect(props.selectGroupFunc).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: '11' })
    );
    expect(screen.queryByText('Drag pinned groups to reorder')).toBeNull();
  });

  it('switches to reordering on a hold, without opening the group or its menu', () => {
    vi.useFakeTimers();
    pinned.ids = ['11', '12'];
    const props = renderPanel();

    const pin = within(rowOf('Hikers')).getByTestId('group-row-pin');
    fireEvent.touchStart(pin, { touches: [{ clientX: 1, clientY: 1 }] });
    fireEvent.pointerDown(pin);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(pin);
    fireEvent.click(pin);

    expect(contextMenuTouchStart).not.toHaveBeenCalled();
    expect(props.selectGroupFunc).not.toHaveBeenCalled();
    expect(
      screen.getByText('Drag pinned groups to reorder')
    ).toBeInTheDocument();
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toHaveStyle({ minHeight: '44px' });

    fireEvent.click(done);
    expect(screen.queryByText('Drag pinned groups to reorder')).toBeNull();
  });

  it('swallows the click after a native contextmenu enters reordering', () => {
    pinned.ids = ['11', '12'];
    const props = renderPanel();

    const pin = within(rowOf('Hikers')).getByTestId('group-row-pin');
    // Android WebView can fire contextmenu before the 450ms hold timer.
    fireEvent.pointerDown(pin);
    fireEvent.contextMenu(pin);
    fireEvent.pointerUp(pin);
    // fireEvent returns false when the pin cancelled the click.
    expect(fireEvent.click(pin)).toBe(false);
    expect(props.selectGroupFunc).not.toHaveBeenCalled();
    expect(
      screen.getByText('Drag pinned groups to reorder')
    ).toBeInTheDocument();

    // Back out of reordering: the next short tap opens the group again.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.pointerDown(pin);
    fireEvent.pointerUp(pin);
    fireEvent.click(pin);
    expect(props.selectGroupFunc).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: '11' })
    );
  });

  it('keeps the named list beside the DM list for the phone pager', () => {
    renderPanel({ desktopSideView: 'directs', keepPhoneList: true });

    expect(screen.getAllByText('Hikers').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Groups' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    // The pager keeps sideways swipes off the list's scroller.
    expect(
      rowOf('Hikers').closest('[data-pager-scroller]')
    ).toBeInTheDocument();
  });

  it('shows only the rail while DMs are showing without the pager', () => {
    renderPanel({ desktopSideView: 'directs' });

    expect(document.querySelector('[data-pager-scroller]')).toBeNull();
  });

  it('does not reorder when the finger moves off the pin', () => {
    usePointerEvents();
    vi.useFakeTimers();
    pinned.ids = ['11', '12'];
    renderPanel();

    const pin = within(rowOf('Hikers')).getByTestId('group-row-pin');
    fireEvent.pointerDown(pin, { clientX: 300, clientY: 100 });
    // A swipe to the DM list that started on the pin.
    fireEvent.pointerMove(pin, { clientX: 260, clientY: 102 });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.queryByText('Drag pinned groups to reorder')).toBeNull();
  });

  it('keeps the hold through a little finger jitter', () => {
    usePointerEvents();
    vi.useFakeTimers();
    pinned.ids = ['11', '12'];
    renderPanel();

    const pin = within(rowOf('Hikers')).getByTestId('group-row-pin');
    fireEvent.pointerDown(pin, { clientX: 300, clientY: 100 });
    fireEvent.pointerMove(pin, { clientX: 304, clientY: 97 });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(
      screen.getByText('Drag pinned groups to reorder')
    ).toBeInTheDocument();
    // Rows being reordered never swipe to the DM list.
    expect(rowOf('Hikers')).toHaveAttribute('data-pager-swipe-ignore');
  });

  it('keeps pager swipes off the whole list while reordering', () => {
    vi.useFakeTimers();
    pinned.ids = ['11', '12'];
    renderPanel();
    const ignored = (element: HTMLElement) =>
      element.closest('[data-pager-swipe-ignore]');
    const groupsSwitch = screen.getByRole('button', { name: 'Groups' });

    expect(ignored(groupsSwitch)).toBeNull();
    expect(ignored(rowOf('Painters'))).toBeNull();

    const pin = within(rowOf('Hikers')).getByTestId('group-row-pin');
    fireEvent.touchStart(pin, { touches: [{ clientX: 1, clientY: 1 }] });
    fireEvent.pointerDown(pin);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(pin);

    // Header, banner and unpinned rows too, not just the pinned rows.
    expect(ignored(groupsSwitch)).not.toBeNull();
    expect(ignored(rowOf('Readers'))).not.toBeNull();
    expect(
      ignored(screen.getByText('Drag pinned groups to reorder'))
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(ignored(groupsSwitch)).toBeNull();
  });

  it('lets a long press on a lone pin open the group menu', () => {
    pinned.ids = ['11'];
    renderPanel();

    const pin = within(rowOf('Hikers')).getByTestId('group-row-pin');
    fireEvent.touchStart(pin, { touches: [{ clientX: 1, clientY: 1 }] });

    expect(contextMenuTouchStart).toHaveBeenCalled();
  });
});
