import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import i18n from '../../i18n/i18n';
import { DOUBLE_TAP_WINDOW_MS, MessageItem } from './MessageItem';
import {
  resetReactionPrefsCache,
  setDoubleTapReaction,
} from './reactionPreferences';

// Phone vs desktop sizing of the message action surfaces. Heavy children are
// stubs; the emoji picker stub exposes the size MessageItem asks it for.
vi.mock('../../App', async () => {
  const { createContext: create } = await import('react');
  return {
    QORTAL_APP_CONTEXT: create({
      getIndividualUserInfo: async () => null,
    }),
    getBaseApiReact: () => '',
  };
});
vi.mock('../../hooks/usePresence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/usePresence')>()),
  useStatus: () => 'offline',
}));
vi.mock('./MessageDisplay', () => ({
  MessageDisplay: () => <div data-testid="message-display">hello</div>,
}));
vi.mock('../Embeds/Embed', () => ({ Embed: () => null }));
vi.mock('../ReactionPicker', () => ({
  ReactionPicker: ({
    buttonSize,
    iconSize,
  }: {
    buttonSize?: number;
    iconSize?: number;
  }) => (
    <span
      data-testid="reaction-picker"
      data-button-size={buttonSize ?? ''}
      data-icon-size={iconSize ?? ''}
    />
  ),
}));
vi.mock('./ReticulumImageViewer', () => ({ ReticulumImageViewer: () => null }));
vi.mock('./AvatarPreviewModal', () => ({ AvatarPreviewModal: () => null }));

const ME = 'QMeAddress';
const PEER = 'QPeerAddress';

const post = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1',
  eventId: 'event-1',
  signature: 'event-1',
  timestamp: Date.now(),
  sender: PEER,
  senderAddress: PEER,
  senderName: 'peer',
  text: '<p>hello</p>',
  message: '<p>hello</p>',
  messageText: 'hello',
  reticulumChat: true,
  ...overrides,
});

const renderItem = (
  message: Record<string, unknown>,
  props: Record<string, unknown> = {}
) =>
  render(
    <MessageItem
      {...({
        handleReaction: vi.fn(),
        isLast: false,
        isPrivate: false,
        message,
        myAddress: ME,
        onDelete: vi.fn(),
        onEdit: vi.fn(),
        onOpenReticulumDiscussion: vi.fn(),
        onReply: vi.fn(),
        onSeen: vi.fn(),
        reactions: { '👍': [{ sender: PEER, senderName: 'peer' }] },
        reticulumChatEnabled: true,
        reticulumDiscussionReplyCount: 3,
        ...props,
      } as any)}
    />
  );

const setViewport = (phone: boolean, width: number) => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
    writable: true,
  });
  // useMediaQuery(theme.breakpoints.down('md')) is a max-width query.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: phone && query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

// The English strings this surface adds (seeded into the locales separately).
const MESSAGE_ITEM_STRINGS = {
  message_item: {
    copy_message: 'copy message',
    delete_message: 'delete message',
    downloading_image: 'Downloading image…',
    edit_message: 'edit message',
    image_download_failed: "Couldn't download image",
    react_with: 'react with {{emoji}}',
    reply_count_one: '{{count}} reply',
    reply_count_other: '{{count}} replies',
    reply_message: 'reply message',
    select_text: 'select text',
    view_replies_one: 'view {{count}} reply',
    view_replies_other: 'view {{count}} replies',
  },
};
const FILE_TRANSFER_STRINGS = {
  file_transfer: { downloaded: 'Downloaded', offer_expired: 'Expired' },
};

// The CSS emotion generated for an element's own classes. jsdom ignores
// selector specificity in getComputedStyle, so rules that win on specificity
// (the menu row height) are checked in the stylesheet instead.
const cssRulesFor = (element: Element) => {
  const classes = [...element.classList].filter((name) =>
    name.startsWith('css-')
  );
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (classes.some((name) => rule.cssText.includes(name))) {
        rules.push(rule.cssText);
      }
    }
  }
  return rules.join('\n');
};

const reactionChip = () =>
  screen.getByText('👍', { selector: 'span' }).closest('button');

const row = (container: HTMLElement) =>
  container.querySelector('.message-item-row') as HTMLElement;

// A single tap waits to see whether a second (double) tap follows.
const waitOutDoubleTap = () =>
  act(
    () =>
      new Promise<void>((resolve) =>
        setTimeout(resolve, DOUBLE_TAP_WINDOW_MS + 30)
      )
  );

const tapRow = async (container: HTMLElement, clientX = 120, clientY = 300) => {
  fireEvent.click(row(container), { clientX, clientY });
  await waitOutDoubleTap();
};

const fileOffer = () =>
  post({
    reticulumChat: undefined,
    recipientAddress: ME,
    decryptedData: {
      type: 'qchat-dm-file-transfer',
      data: {
        status: 'offer',
        transferId: 'qft-1',
        fileName: 'notes.txt',
        size: 2048,
        expiresAt: Date.now() + 60_000,
      },
    },
  });

const renderFileOffer = () =>
  renderItem(fileOffer(), {
    isPrivate: true,
    onAcceptQchatFileTransfer: vi.fn(),
    qchatCompletedTransfers: {},
    qchatFileTransferStates: {},
    reactions: {},
  });

// The emotion rules of the avatar column, which holds the tap-area ring.
const avatarColumnRules = (container: HTMLElement) => {
  let node = container.querySelector('.MuiAvatar-root')?.parentElement;
  const rules: string[] = [];
  while (node && !node.classList.contains('message-item-row')) {
    rules.push(cssRulesFor(node));
    node = node.parentElement;
  }
  return rules.join('\n');
};

describe('MessageItem touch targets', () => {
  const originalMatchMedia = window.matchMedia;
  const originalInnerWidth = window.innerWidth;

  beforeAll(async () => {
    await i18n.changeLanguage('en');
    i18n.addResourceBundle('en', 'group', MESSAGE_ITEM_STRINGS, true, false);
    i18n.addResourceBundle('en', 'core', FILE_TRANSFER_STRINGS, true, false);
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    resetReactionPrefsCache();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
      writable: true,
    });
  });

  describe('on a phone', () => {
    beforeEach(() => setViewport(true, 360));

    it('makes reaction chips 36px tall', () => {
      renderItem(post());
      expect(getComputedStyle(reactionChip()).height).toBe('36px');
    });

    it('shows the replies chip as a 36px pill beside the reactions', () => {
      renderItem(post());
      const chip = screen.getByRole('button', { name: 'View 3 replies' });
      expect(chip).toHaveTextContent('3 replies');
      expect(chip).not.toHaveTextContent('+3');
      expect(chip.parentElement).toBe(reactionChip().parentElement);
      expect(getComputedStyle(chip).height).toBe('36px');
    });

    it('opens the Telegram-style popup on a tap, not a bar under it', async () => {
      const { container } = renderItem(post());
      await tapRow(container, 120, 300);
      expect(container.querySelector('.message-item-toolbar')).toBeNull();
      const pill = screen.getByRole('group', { name: 'Quick reactions' });
      const pillButtons = within(pill).getAllByRole('button');
      // Six quick reactions fit a 360px phone, then the expand chevron.
      expect(pillButtons).toHaveLength(7);
      expect(pillButtons[6]).toHaveAccessibleName('More reactions');
      for (const button of pillButtons) {
        expect(getComputedStyle(button).height).toBe('44px');
      }
      expect(
        screen.getAllByRole('menuitem').map((item) => item.textContent)
      ).toEqual(['Reply', 'View 3 replies', 'Copy']);
      // The details are for the long press.
      expect(screen.queryByText('Sent')).not.toBeInTheDocument();
    });

    it('adds edit and delete to the tap popup of your own message', async () => {
      const { container } = renderItem(post({ sender: ME, senderAddress: ME }));
      await tapRow(container, 300, 300);
      expect(
        screen.getAllByRole('menuitem').map((item) => item.textContent)
      ).toEqual(['Reply', 'View 3 replies', 'Copy', 'Edit', 'Delete']);
    });

    it('offers to start a discussion when there are no replies yet', async () => {
      const onOpenReticulumDiscussion = vi.fn();
      const message = post();
      const { container } = renderItem(message, {
        onOpenReticulumDiscussion,
        reticulumDiscussionReplyCount: 0,
      });
      await tapRow(container, 120, 300);
      fireEvent.click(
        screen.getByRole('menuitem', { name: 'Reply in discussion' })
      );
      expect(onOpenReticulumDiscussion).toHaveBeenCalledWith(message);
    });

    it('reacts from the pill and closes', async () => {
      const handleReaction = vi.fn();
      const message = post();
      const { container } = renderItem(message, { handleReaction });
      await tapRow(container, 120, 300);
      fireEvent.click(screen.getByRole('button', { name: 'React with 🔥' }));
      expect(handleReaction).toHaveBeenCalledWith('🔥', message, true);
      await waitFor(() =>
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      );
    });

    it('takes your reaction back from the pill', async () => {
      const handleReaction = vi.fn();
      const message = post();
      const { container } = renderItem(message, {
        handleReaction,
        reactions: { '👍': [{ sender: ME, senderName: 'me' }] },
      });
      await tapRow(container, 120, 300);
      const thumbs = screen.getByRole('button', { name: 'React with 👍' });
      expect(thumbs).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(thumbs);
      expect(handleReaction).toHaveBeenCalledWith('👍', message, false);
    });

    it('shows every action and the details on a long press', () => {
      vi.useFakeTimers();
      try {
        const { container } = renderItem(
          post({
            expiresAt: Date.now() + 3 * 24 * 60 * 60_000,
            sender: ME,
            senderAddress: ME,
          })
        );
        fireEvent.touchStart(row(container), {
          touches: [{ clientX: 200, clientY: 300 }],
        });
        act(() => {
          vi.advanceTimersByTime(450);
        });
        fireEvent.touchEnd(row(container));
        expect(
          screen.getAllByRole('menuitem').map((item) => item.textContent)
        ).toEqual([
          'Reply',
          'View 3 replies',
          'Copy',
          'Select text',
          'Edit',
          'Delete',
        ]);
        expect(screen.getByText('Sent')).toBeInTheDocument();
        expect(screen.getByText('Message expires')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('opens the long-press version for Android’s context menu too', () => {
      const { container } = renderItem(post());
      fireEvent.contextMenu(row(container), { clientX: 20, clientY: 20 });
      expect(
        screen.getByRole('menuitem', { name: 'Select text' })
      ).toBeInTheDocument();
      expect(screen.getByText('No expiry')).toBeInTheDocument();
    });

    it('keeps a thread read-only: no tap popup, a long press only copies', async () => {
      const { container } = renderItem(
        post({ sender: ME, senderAddress: ME }),
        {
          reticulumDiscussionView: true,
        }
      );
      await tapRow(container, 120, 300);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      fireEvent.contextMenu(row(container), { clientX: 120, clientY: 300 });
      expect(
        screen.getAllByRole('menuitem').map((item) => item.textContent)
      ).toEqual(['Copy', 'Select text']);
      expect(
        screen.queryByRole('group', { name: 'Quick reactions' })
      ).not.toBeInTheDocument();
    });

    it('lets a tap on a picture open the picture, not the popup', async () => {
      const { container } = renderItem(post());
      const picture = document.createElement('img');
      row(container).appendChild(picture);
      fireEvent.click(picture, { clientX: 120, clientY: 300 });
      await waitOutDoubleTap();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('does not open the popup when a tap closes the user card', async () => {
      const { container } = renderItem(post());
      fireEvent.click(container.querySelector('.MuiAvatar-root') as Element);
      const backdrop = await waitFor(() => {
        const element = document.querySelector(
          '.MuiPopover-root .MuiBackdrop-root'
        );
        expect(element).not.toBeNull();
        return element as Element;
      });
      // The card is drawn in a portal, but React still hands the tap on its
      // backdrop to the message row it belongs to.
      fireEvent.click(backdrop, { clientX: 120, clientY: 600 });
      await waitOutDoubleTap();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('only closes the who-reacted list when You tap back in the chat', async () => {
      const { container } = renderItem(post());
      fireEvent.contextMenu(reactionChip());
      const list = screen.getByText('peer', {
        selector: '.MuiListItemText-primary',
      });
      // A tap inside the list leaves it open.
      fireEvent.click(list);
      expect(list).toBeInTheDocument();
      await tapRow(container, 120, 300);
      expect(
        screen.queryByText('peer', { selector: '.MuiListItemText-primary' })
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      // The next tap is an ordinary one again.
      await tapRow(container, 120, 300);
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('reacts with thumbs up on a double tap, without the popup', async () => {
      const handleReaction = vi.fn();
      const message = post();
      const { container } = renderItem(message, {
        handleReaction,
        reactions: {},
      });
      fireEvent.click(row(container), { clientX: 120, clientY: 300 });
      fireEvent.click(row(container), { clientX: 124, clientY: 302 });
      expect(handleReaction).toHaveBeenCalledWith('👍', message, true);
      await waitOutDoubleTap();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('double taps with the emoji chosen for this chat', async () => {
      setDoubleTapReaction('group:7', '🔥');
      const handleReaction = vi.fn();
      const message = post();
      const { container } = renderItem(message, {
        handleReaction,
        reactionChatKey: 'group:7',
      });
      fireEvent.click(row(container), { clientX: 120, clientY: 300 });
      fireEvent.click(row(container), { clientX: 120, clientY: 300 });
      expect(handleReaction).toHaveBeenCalledWith('🔥', message, true);
      // Other chats keep thumbs up.
      handleReaction.mockClear();
      const other = renderItem(message, {
        handleReaction,
        reactionChatKey: 'direct:QSomeone',
      });
      fireEvent.click(row(other.container), { clientX: 120, clientY: 300 });
      fireEvent.click(row(other.container), { clientX: 120, clientY: 300 });
      expect(handleReaction).toHaveBeenCalledWith('👍', message, true);
    });

    it('takes the double-tap reaction back when it is already yours', () => {
      const handleReaction = vi.fn();
      const message = post();
      const { container } = renderItem(message, {
        handleReaction,
        reactions: { '👍': [{ sender: ME, senderName: 'me' }] },
      });
      fireEvent.click(row(container), { clientX: 120, clientY: 300 });
      fireEvent.click(row(container), { clientX: 120, clientY: 300 });
      expect(handleReaction).toHaveBeenCalledWith('👍', message, false);
    });

    it('treats two taps far apart as a tap, not a double tap', async () => {
      const handleReaction = vi.fn();
      const { container } = renderItem(post(), { handleReaction });
      fireEvent.click(row(container), { clientX: 60, clientY: 200 });
      await tapRow(container, 260, 420);
      expect(handleReaction).not.toHaveBeenCalled();
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('makes the popup menu rows at least 48px tall', async () => {
      const { container } = renderItem(post());
      await tapRow(container, 120, 300);
      expect(cssRulesFor(screen.getAllByRole('menuitem')[0])).toMatch(
        /min-height:\s*48px/
      );
    });

    it('keeps reply previews compact', () => {
      renderItem(post(), { isShowingAsReply: true });
      expect(getComputedStyle(reactionChip()).height).toBe('28px');
      const chip = screen.getByRole('button', { name: 'View 3 replies' });
      expect(chip).toHaveTextContent('+3');
      expect(chip).not.toHaveTextContent('3 replies');
      expect(chip.parentElement).not.toBe(reactionChip().parentElement);
    });

    it('opens the thread from the replies pill without the popup', () => {
      const onOpenReticulumDiscussion = vi.fn();
      const message = post();
      renderItem(message, { onOpenReticulumDiscussion });
      fireEvent.click(screen.getByRole('button', { name: 'View 3 replies' }));
      expect(onOpenReticulumDiscussion).toHaveBeenCalledTimes(1);
      expect(onOpenReticulumDiscussion).toHaveBeenCalledWith(message);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('makes the file-offer Accept button 44px tall', () => {
      renderFileOffer();
      const accept = screen.getByRole('button', { name: 'Accept' });
      expect(getComputedStyle(accept).minHeight).toBe('44px');
    });

    it('rings the 30px sender avatar with a 44px tap area', () => {
      const { container } = renderItem(post());
      expect(avatarColumnRules(container)).toMatch(
        /::after\s*\{[^}]*inset:\s*-9px -7px -5px/
      );
    });
  });

  describe('on desktop', () => {
    beforeEach(() => setViewport(false, 1280));

    it('keeps 28px reaction chips', () => {
      renderItem(post());
      expect(getComputedStyle(reactionChip()).height).toBe('28px');
    });

    it('keeps the +N replies badge in the header', () => {
      renderItem(post());
      const chip = screen.getByRole('button', { name: 'View 3 replies' });
      expect(chip).toHaveTextContent('+3');
      expect(chip.parentElement).not.toBe(reactionChip().parentElement);
      expect(getComputedStyle(chip).height).toBe('24px');
    });

    it('keeps the file-offer Accept button and the avatar as they were', () => {
      const { container } = renderFileOffer();
      const accept = screen.getByRole('button', { name: 'Accept' });
      expect(getComputedStyle(accept).minHeight).not.toBe('44px');
      expect(avatarColumnRules(container)).not.toMatch(/::after/);
    });

    it('keeps the hover toolbar compact and the menu rows at 36px', () => {
      const { container } = renderItem(post({ sender: ME, senderAddress: ME }));
      const toolbar = container.querySelector('.message-item-toolbar');
      expect(toolbar).not.toBeNull();
      for (const button of toolbar.querySelectorAll('button')) {
        expect(getComputedStyle(button).padding).toBe('4px');
      }
      expect(screen.getByTestId('reaction-picker').dataset.buttonSize).toBe('');
      fireEvent.contextMenu(row(container), { clientX: 20, clientY: 20 });
      const items = screen.getAllByRole('menuitem');
      expect(items).toHaveLength(5);
      expect(cssRulesFor(items[0].parentElement)).not.toMatch(
        /min-height:\s*44px/
      );
    });
  });
});
