import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';

// Same stubs as MessageItem.receivedFile.test.tsx: the reply card lives in
// MessageItem, its heavy children are reduced to stubs.
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
  MessageDisplay: ({ trailingContent }: { trailingContent?: ReactNode }) => (
    <div data-testid="message-display">{trailingContent}</div>
  ),
}));
vi.mock('../Embeds/Embed', () => ({ Embed: () => null }));
vi.mock('../ReactionPicker', () => ({ ReactionPicker: () => null }));
vi.mock('./ReticulumImageViewer', () => ({ ReticulumImageViewer: () => null }));
vi.mock('./AvatarPreviewModal', () => ({ AvatarPreviewModal: () => null }));

import { MessageItem } from './MessageItem';
import { __resetReplyThumbnailCacheForTests } from './ReplyImageThumbnail';

const ME = 'QMeAddress';
const PEER = 'QPeerAddress';

const post = (overrides: Record<string, unknown> = {}) => ({
  id: 'm2',
  signature: 'm2',
  repliedTo: 'm1',
  timestamp: Date.now(),
  sender: ME,
  senderAddress: ME,
  senderName: 'me',
  messageText: '<p>nice</p>',
  text: '<p>nice</p>',
  reticulumChat: true,
  ...overrides,
});

const pictureReply = (overrides: Record<string, unknown> = {}) => ({
  signature: 'm1',
  reticulumChat: true,
  sender: PEER,
  senderAddress: PEER,
  senderName: 'alice',
  messageText: '',
  images: [
    {
      reticulumResource: true,
      fileHash: 'h1',
      mimeType: 'image/webp',
      sizeBytes: 20_000,
    },
  ],
  ...overrides,
});

const renderItem = (props: Record<string, unknown>) =>
  render(
    <MessageItem
      {...({
        handleReaction: vi.fn(),
        isLast: false,
        isPrivate: false,
        message: post(),
        myAddress: ME,
        onReply: vi.fn(),
        onSeen: vi.fn(),
        reactions: {},
        reticulumChatEnabled: true,
        replyIndex: 3,
        scrollToItem: vi.fn(),
        ...props,
      } as any)}
    />
  );

const thumbnail = () => screen.getByTestId('reply-thumbnail');
const thumbnailImg = () => thumbnail().querySelector('img');

let requestResource: ReturnType<typeof vi.fn>;
let requestDirectResource: ReturnType<typeof vi.fn>;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  requestResource = vi.fn(async () => ({ success: true }));
  requestDirectResource = vi.fn(async () => ({ success: true }));
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  (window as any).reticulumChat = {
    requestResource,
    requestDirectResource,
    onResource: vi.fn(() => () => {}),
  };
  (window as any).reticulumResources = {
    getStatus: vi.fn(async () => ({
      success: true,
      complete: true,
      totalBytes: 20_000,
      manifest: { mimeType: 'image/webp', sizeBytes: 20_000 },
    })),
    getUrl: vi.fn(async () => ({ success: true, url: 'blob:h1' })),
  };
});

afterEach(() => {
  cleanup();
  const fetched = fetchSpy.mock.calls.map((call) => String(call[0]));
  fetchSpy.mockRestore();
  __resetReplyThumbnailCacheForTests();
  delete (window as any).reticulumChat;
  delete (window as any).reticulumResources;
  // The quote only shows what the device has; it never downloads. (The row
  // itself looks up the sender's group roles; that is not the quote's.)
  expect(requestResource).not.toHaveBeenCalled();
  expect(requestDirectResource).not.toHaveBeenCalled();
  expect(fetched.filter((url) => !url.startsWith('/groups/member/'))).toEqual(
    []
  );
});

describe('MessageItem reply thumbnail', () => {
  it('shows the quoted picture and "Photo" when the original has no text', async () => {
    const scrollToItem = vi.fn();
    renderItem({ reply: pictureReply(), scrollToItem });

    expect(screen.getByText('Replying to alice')).toBeInTheDocument();
    expect(screen.getByText('Photo')).toBeInTheDocument();
    await waitFor(() =>
      expect(thumbnailImg()).toHaveAttribute('src', 'blob:h1')
    );
    expect(thumbnailImg()).toHaveAttribute('alt', '');

    // A tap on the picture still jumps to the original.
    fireEvent.click(thumbnail());
    expect(scrollToItem).toHaveBeenCalledWith(3);
  });

  it('keeps the text and drops "Photo" when the original has text', async () => {
    renderItem({
      reply: pictureReply({ messageText: '<p>look at this</p>' }),
    });

    expect(
      await screen.findByAltText('Picture in the quoted message')
    ).toHaveAttribute('src', 'blob:h1');
    expect(screen.queryByText('Photo')).toBeNull();
  });

  it('says "Replying to you" for a reply to my own picture', () => {
    renderItem({
      reply: pictureReply({ sender: ME, senderAddress: ME, senderName: 'me' }),
    });
    expect(screen.getByText('Replying to you')).toBeInTheDocument();
  });

  it('shows an inline picture in the legacy chat too', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo';
    renderItem({
      reticulumChatEnabled: false,
      message: post({ reticulumChat: undefined }),
      reply: {
        signature: 'm1',
        sender: PEER,
        senderName: 'alice',
        images: [{ dataUrl: src }],
      },
    });
    expect(thumbnailImg()).toHaveAttribute('src', src);
    expect(screen.getByText('Photo')).toBeInTheDocument();
  });

  it('has no thumbnail when the original is gone', () => {
    renderItem({ reply: null, replyExpiredMeta: { missing: true } });
    expect(screen.queryByTestId('reply-thumbnail')).toBeNull();
  });

  it('has no thumbnail for a text-only original', () => {
    renderItem({
      reply: pictureReply({ images: [], messageText: '<p>hi</p>' }),
    });
    expect(screen.queryByTestId('reply-thumbnail')).toBeNull();
    expect(screen.queryByText('Photo')).toBeNull();
  });

  it('gives the text the width the picture takes, on one header line', () => {
    const { unmount } = renderItem({ reply: pictureReply() });
    // The card is the thumbnail's parent; 52 px still clears the quote icon.
    expect(thumbnail().parentElement).toHaveStyle({
      padding: '10px 52px 10px 14px',
    });
    const header = screen.getByText('Replying to alice');
    expect(header).toHaveStyle({
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
    unmount();

    renderItem({
      reply: pictureReply({ images: [], messageText: '<p>hi</p>' }),
    });
    expect(
      screen.getByText('Replying to alice').closest('.MuiButtonBase-root')
    ).toHaveStyle({ padding: '10px 100px 10px 14px' });
  });
});
