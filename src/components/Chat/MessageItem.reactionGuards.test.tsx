import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
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
import ErrorBoundary from '../../common/ErrorBoundary';
import { MessageItem } from './MessageItem';
import { resetReactionPrefsCache } from './reactionPreferences';

// Reaction data that is not a clean map of reactor lists must never break the
// row ("Invalid Data"). Heavy children are stubs.
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
vi.mock('../ReactionPicker', () => ({ ReactionPicker: () => null }));
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

// One message object across rerenders, as ChatList hands it.
const MESSAGE = post();
const handlers = {
  handleReaction: vi.fn(),
  onDelete: vi.fn(),
  onEdit: vi.fn(),
  onOpenReticulumDiscussion: vi.fn(),
  onReply: vi.fn(),
  onSeen: vi.fn(),
};

const tree = (reactions: unknown) => (
  <ErrorBoundary fallback={<span>ROW FAILED</span>}>
    <MessageItem
      {...({
        ...handlers,
        isLast: false,
        isPrivate: false,
        message: MESSAGE,
        myAddress: ME,
        reactions,
        reticulumChatEnabled: true,
      } as any)}
    />
  </ErrorBoundary>
);

const renderRow = (reactions: unknown) =>
  render(tree(reactions), { onRecoverableError: () => {} });

const setViewport = (phone: boolean, width: number) => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
    writable: true,
  });
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

const chip = (emoji: string) =>
  screen.getByText(emoji, { selector: 'span' }).closest('button');

const listed = (name: string) =>
  screen.queryByText(name, { selector: '.MuiListItemText-primary' });

describe('MessageItem reaction guards', () => {
  const originalMatchMedia = window.matchMedia;
  const originalInnerWidth = window.innerWidth;
  const PEER_LIST = [{ sender: PEER, senderName: 'peer' }];

  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    resetReactionPrefsCache();
    setViewport(true, 360);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
      writable: true,
    });
  });

  it('closes the who-reacted list when its last reaction goes, without breaking the row', async () => {
    const view = renderRow({ '👍': PEER_LIST });
    fireEvent.contextMenu(chip('👍'));
    expect(listed('peer')).toBeInTheDocument();
    view.rerender(tree(null));
    expect(screen.queryByText('ROW FAILED')).not.toBeInTheDocument();
    await waitFor(() => expect(listed('peer')).not.toBeInTheDocument());
    expect(screen.getByTestId('message-display')).toBeInTheDocument();
  });

  it('closes the list when only other reactions are left', async () => {
    const view = renderRow({ '👍': PEER_LIST });
    fireEvent.contextMenu(chip('👍'));
    expect(listed('peer')).toBeInTheDocument();
    view.rerender(tree({ '❤️': [{ sender: ME }] }));
    await waitFor(() => expect(listed('peer')).not.toBeInTheDocument());
    expect(screen.queryByText('ROW FAILED')).not.toBeInTheDocument();
    expect(chip('❤️')).toBeInTheDocument();
  });

  it('draws chips from list entries only', () => {
    renderRow({
      '👍': undefined,
      '😀': { sender: PEER },
      '❤️': [{ sender: PEER }],
      '🔥': [null, { sender: ME }],
    });
    expect(screen.queryByText('ROW FAILED')).not.toBeInTheDocument();
    expect(chip('❤️')).toBeInTheDocument();
    expect(chip('🔥')).toBeInTheDocument();
    expect(screen.queryByText('👍', { selector: 'span' })).toBeNull();
    expect(screen.queryByText('😀', { selector: 'span' })).toBeNull();
  });

  it('skips empty reactors in an open list', () => {
    const view = renderRow({ '👍': PEER_LIST });
    fireEvent.contextMenu(chip('👍'));
    view.rerender(tree({ '👍': [null, { sender: PEER, senderName: 'peer' }] }));
    expect(screen.queryByText('ROW FAILED')).not.toBeInTheDocument();
    expect(listed('peer')).toBeInTheDocument();
  });

  it('keeps the list open while its reaction stays', () => {
    const view = renderRow({ '👍': PEER_LIST });
    fireEvent.contextMenu(chip('👍'));
    view.rerender(tree({ '👍': PEER_LIST, '❤️': [{ sender: ME }] }));
    expect(listed('peer')).toBeInTheDocument();
    expect(screen.queryByText('ROW FAILED')).not.toBeInTheDocument();
  });

  it('lists a reactor without a name by address, and ignores odd names', () => {
    const view = renderRow({ '👍': PEER_LIST });
    fireEvent.contextMenu(chip('👍'));
    view.rerender(
      tree({
        '👍': [
          { sender: PEER, senderName: { odd: true } },
          { sender: 42, senderName: 'second' },
        ],
      })
    );
    expect(screen.queryByText('ROW FAILED')).not.toBeInTheDocument();
    expect(listed(PEER)).toBeInTheDocument();
    expect(listed('second')).toBeInTheDocument();
  });

  it('draws nothing for a reactions value that is not a map', () => {
    renderRow(['👍']);
    expect(screen.queryByText('ROW FAILED')).not.toBeInTheDocument();
    expect(screen.getByTestId('message-display')).toBeInTheDocument();
  });
});
