import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { darkTheme } from '../../styles/theme-dark';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  PNG_BYTES,
} from '../../lib/qdnAvatars/testHarness';
import { DirectsSidebar, type DirectsSidebarProps } from './DirectsSidebar';

vi.mock('../../utils/globalApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/globalApi')>()),
  getBaseApiReact: () => 'http://127.0.0.1:12391',
}));

const i18n = createInstance();
void i18n.init({
  lng: 'en',
  resources: {
    en: {
      core: {
        action: { new: { chat: 'new chat' } },
        dm_friends: { add_friend: 'Add friend', friend_badge_aria: 'Friend' },
        message: { generic: { no_messages: 'no messages' } },
      },
      group: {
        dm: { direct_messages: 'Direct Messages' },
        last_message_date: 'last message: {{date}}',
      },
      reticulum: {
        call_history: { missed: 'missed voice call' },
        chat_scope: { direct_messages: 'DMs', groups: 'Groups' },
        dm_list: { empty: 'No current private messages.' },
      },
    },
  },
});

const never = () => new Promise<Response>(() => {});

const mockViewport = (phone: boolean, landscape = false) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    // The "below md" query answers phone; orientation is portrait unless asked.
    matches: query.includes('orientation') ? landscape : phone,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

const alice = {
  address: 'QAlice',
  name: 'Alice',
  timestamp: Date.now() - 60_000,
};

const renderList = (overrides: Partial<DirectsSidebarProps> = {}) => {
  const props: DirectsSidebarProps = {
    setDesktopSideView: vi.fn(),
    desktopSideView: 'directs',
    directChatHasUnread: false,
    directs: [alice],
    dmFriendsByAddress: {},
    setSelectedDirect: vi.fn(),
    setNewChat: vi.fn(),
    setIsOpenDrawer: vi.fn(),
    getTimestampEnterChat: vi.fn(async () => null),
    selectedDirect: null,
    timestampEnterData: {},
    timeDifferenceForNotificationChats: 0,
    myAddress: 'QMe',
    isRunningPublicNode: false,
    setIsOpenBlockedUserModal: vi.fn(),
    reticulumChatEnabled: true,
    ...overrides,
  };
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={darkTheme}>
        <DirectsSidebar {...props} />
      </ThemeProvider>
    </I18nextProvider>
  );
  return props;
};

const settle = () =>
  act(async () => {
    await flushAsync();
  });

describe('DirectsSidebar', () => {
  const originalMatchMedia = window.matchMedia;
  const originalSendMessage = (window as any).sendMessage;

  beforeEach(() => {
    (window as any).sendMessage = vi.fn(async () => null);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    (window as any).sendMessage = originalSendMessage;
    setQdnAvatarCacheForTests(null);
  });

  it('gives phone rows the Groups look: 40px avatars and the left-border marker', async () => {
    mockViewport(true);
    renderList({ selectedDirect: alice });
    await settle();

    const avatar = document.querySelector('[data-qdn-avatar]') as HTMLElement;
    expect(avatar).toHaveStyle({ height: '40px', width: '40px' });

    // The selected row is marked with the Groups left border.
    const row = screen.getByText('Alice').closest('li') as HTMLElement;
    expect(row).toHaveStyle({
      borderLeftColor: darkTheme.palette.primary.main,
      borderLeftWidth: '3px',
      padding: '12px 14px',
    });
  });

  it('keeps the compact rows in the desktop Reticulum DM column', async () => {
    mockViewport(false);
    renderList();
    await settle();

    const avatar = document.querySelector('[data-qdn-avatar]') as HTMLElement;
    expect(avatar).toHaveStyle({ height: '34px', width: '34px' });
  });

  it('keeps the header above the rows on a landscape phone', async () => {
    mockViewport(true, true);
    renderList();
    await settle();

    const newChat = screen.getByRole('button', { name: 'New chat' });
    const header = newChat.parentElement as HTMLElement;
    expect(header.parentElement).toHaveStyle({ flexDirection: 'column' });
  });

  it('adds a friend from a desktop row without opening the chat', async () => {
    mockViewport(false);
    const onAddFriend = vi.fn();
    window.addEventListener('qchat:add-dm-friend', onAddFriend);
    try {
      const props = renderList();
      await settle();

      fireEvent.click(screen.getByRole('button', { name: 'Add friend' }));

      expect(onAddFriend).toHaveBeenCalledTimes(1);
      expect(onAddFriend.mock.calls[0][0].detail).toEqual({
        address: 'QAlice',
        name: 'Alice',
      });
      expect(props.setSelectedDirect).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('qchat:add-dm-friend', onAddFriend);
    }
  });

  it('has no add-friend button on phones, where no open chat could handle it', async () => {
    mockViewport(true);
    renderList();
    await settle();

    expect(screen.queryByRole('button', { name: 'Add friend' })).toBeNull();
  });

  it('shows the friend badge instead of the button for friends', async () => {
    mockViewport(false);
    renderList({
      dmFriendsByAddress: {
        QAlice: { publicKey: 'pk', name: 'Alice', addedAt: 1 },
      } as any,
    });
    await settle();

    expect(screen.queryByRole('button', { name: 'Add friend' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Friend' })).toBeInTheDocument();
  });

  it('keeps the friend badge at the row edge on phones', async () => {
    mockViewport(true);
    renderList({
      dmFriendsByAddress: {
        QAlice: { publicKey: 'pk', name: 'Alice', addedAt: 1 },
      } as any,
    });
    await settle();

    expect(screen.getByRole('img', { name: 'Friend' })).toHaveStyle({
      height: '44px',
      width: '44px',
    });
  });

  it('opens the picture on an avatar tap and the chat on a row tap', async () => {
    mockViewport(true);
    const h = createAvatarTestHarness({ handler: never });
    setQdnAvatarCacheForTests(h.cache);
    await h.cache.putImage('Alice', PNG_BYTES);
    const props = renderList();
    await settle();

    const picture = document.querySelector(
      '[data-qdn-avatar="shown"]'
    ) as HTMLElement;
    expect(picture).not.toBeNull();
    fireEvent.click(picture);
    expect(props.setSelectedDirect).not.toHaveBeenCalled();
    // The preview shows the cached picture at once.
    expect(
      document.querySelectorAll('img[src="blob:test/1"]').length
    ).toBeGreaterThan(1);

    fireEvent.click(screen.getByText('Alice'));
    expect(props.setSelectedDirect).toHaveBeenCalledWith(alice);
  });

  it('names the last call in the row subtitle', async () => {
    mockViewport(true);
    renderList({
      directs: [
        {
          ...alice,
          lastCall: { outcome: 'missed', endedAt: alice.timestamp },
          lastMessageTimestamp: alice.timestamp - 1000,
        },
      ],
    });
    await settle();

    expect(screen.getByText(/^Missed voice call • /)).toBeInTheDocument();
  });

  it('shows the translated empty state', async () => {
    mockViewport(true);
    renderList({ directs: [] });
    await settle();

    expect(
      screen.getByText('No current private messages.')
    ).toBeInTheDocument();
  });
});
