import { act, fireEvent, render, screen } from '@testing-library/react';
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
import { MessageItem } from './MessageItem';

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

// jsdom does no layout, so a test gives the row the width a host would.
const setRowWidth = (element: HTMLElement, width: number) =>
  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    value: width,
  });

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

    it('opens a 44px toolbar for other people’s messages', () => {
      const { container } = renderItem(post());
      fireEvent.click(row(container));
      const toolbar = container.querySelector('.message-item-toolbar');
      expect(toolbar).not.toBeNull();
      const buttons = toolbar.querySelectorAll('button');
      // 4 quick reactions + reply.
      expect(buttons).toHaveLength(5);
      for (const button of buttons) {
        expect(getComputedStyle(button).height).toBe('44px');
        expect(getComputedStyle(button).width).toBe('44px');
      }
      const picker = screen.getByTestId('reaction-picker');
      expect(picker.dataset.buttonSize).toBe('44');
      expect(picker.dataset.iconSize).toBe('22');
    });

    it('keeps the full own-message toolbar at 40px on a 360px phone', () => {
      const { container } = renderItem(post({ sender: ME, senderAddress: ME }));
      fireEvent.click(row(container));
      const buttons = container.querySelectorAll(
        '.message-item-toolbar button'
      );
      // 4 quick reactions + edit + reply + delete (picker is the stub).
      expect(buttons).toHaveLength(7);
      for (const button of buttons) {
        expect(getComputedStyle(button).width).toBe('40px');
      }
      expect(screen.getByTestId('reaction-picker').dataset.buttonSize).toBe(
        '40'
      );
    });

    it('gives the full own-message toolbar 44px buttons on a 412px phone', () => {
      setViewport(true, 412);
      const { container } = renderItem(post({ sender: ME, senderAddress: ME }));
      fireEvent.click(row(container));
      expect(screen.getByTestId('reaction-picker').dataset.buttonSize).toBe(
        '44'
      );
    });

    it('sizes the toolbar from the row it opens in', () => {
      // A 412px screen, but a host (sidebar layout, mini thread) leaves the
      // row 330px wide: the full bar must drop to 40px to stay on one line.
      setViewport(true, 412);
      const { container } = renderItem(post({ sender: ME, senderAddress: ME }));
      setRowWidth(row(container), 330);
      fireEvent.click(row(container));
      expect(screen.getByTestId('reaction-picker').dataset.buttonSize).toBe(
        '40'
      );
    });

    it('re-measures the open toolbar when the phone rotates', () => {
      const { container } = renderItem(post({ sender: ME, senderAddress: ME }));
      setRowWidth(row(container), 360);
      fireEvent.click(row(container));
      expect(screen.getByTestId('reaction-picker').dataset.buttonSize).toBe(
        '40'
      );
      setRowWidth(row(container), 800);
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(screen.getByTestId('reaction-picker').dataset.buttonSize).toBe(
        '44'
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

    it('opens the thread from the replies pill without the toolbar', () => {
      const onOpenReticulumDiscussion = vi.fn();
      const message = post();
      const { container } = renderItem(message, { onOpenReticulumDiscussion });
      fireEvent.click(screen.getByRole('button', { name: 'View 3 replies' }));
      expect(onOpenReticulumDiscussion).toHaveBeenCalledTimes(1);
      expect(onOpenReticulumDiscussion).toHaveBeenCalledWith(message);
      expect(container.querySelector('.message-item-toolbar')).toBeNull();
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

    it('makes long-press menu rows 44px tall', () => {
      const { container } = renderItem(post({ sender: ME, senderAddress: ME }));
      fireEvent.contextMenu(row(container), { clientX: 20, clientY: 20 });
      const items = screen.getAllByRole('menuitem');
      expect(items.map((item) => item.textContent)).toEqual([
        'Copy message',
        'Select text',
        'Reply message',
        'Edit message',
        'Delete message',
      ]);
      expect(cssRulesFor(items[0].parentElement)).toMatch(
        /\.MuiMenuItem-root\s*\{[^}]*min-height:\s*44px/
      );
      const quickReactions = screen
        .getByRole('group', { name: 'Quick reactions' })
        .querySelectorAll('button');
      expect(quickReactions).toHaveLength(4);
      for (const button of quickReactions) {
        expect(getComputedStyle(button).height).toBe('44px');
      }
      expect(quickReactions[0]).toHaveAccessibleName('React with 👍');
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
