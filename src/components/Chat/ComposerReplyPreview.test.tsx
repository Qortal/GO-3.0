import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { ComposerReplyPreview } from './ComposerReplyPreview';
import { COMPOSER_DISMISS_BUTTON_PX } from './composerCornerLayout';
import { __resetReplyThumbnailCacheForTests } from './ReplyImageThumbnail';

const originalMatchMedia = window.matchMedia;

const emulatePhone = () => {
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

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('ComposerReplyPreview', () => {
  it('cancels the reply from a thumb-sized button on phones', async () => {
    emulatePhone();
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ComposerReplyPreview
        message={{ senderName: 'alice', messageText: '<p>hello</p>' }}
        onCancel={onCancel}
        rounded
      />
    );

    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: 'Cancel reply' });
    expect(cancel).toHaveStyle({
      height: `${COMPOSER_DISMISS_BUTTON_PX}px`,
      width: `${COMPOSER_DISMISS_BUTTON_PX}px`,
    });
    await user.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('names an attachment-only message and an unknown sender', () => {
    render(
      <ComposerReplyPreview
        message={{ images: [{}], attachments: [] }}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Attachment')).toBeInTheDocument();
  });
});

describe('ComposerReplyPreview thumbnail', () => {
  const picture = (extra: Record<string, unknown> = {}) => ({
    reticulumResource: true,
    fileHash: 'h1',
    fileName: 'photo.webp',
    mimeType: 'image/webp',
    sizeBytes: 20_000,
    ...extra,
  });

  const installResources = () => {
    const requestResource = vi.fn();
    (window as any).reticulumChat = {
      requestResource,
      requestDirectResource: requestResource,
      onResource: vi.fn(() => () => {}),
    };
    (window as any).reticulumResources = {
      getStatus: vi.fn(async () => ({
        success: true,
        complete: true,
        totalBytes: 20_000,
        manifest: { mimeType: 'image/webp' },
      })),
      getUrl: vi.fn(async () => ({ success: true, url: 'blob:h1' })),
    };
    return { requestResource };
  };

  afterEach(() => {
    __resetReplyThumbnailCacheForTests();
    delete (window as any).reticulumChat;
    delete (window as any).reticulumResources;
  });

  const thumbnailImg = () =>
    screen.getByTestId('reply-thumbnail').querySelector('img');

  it('shows the picture and "Photo" for a picture-only message', async () => {
    const { requestResource } = installResources();
    render(
      <ComposerReplyPreview
        message={{
          senderName: 'alice',
          reticulumChat: true,
          messageText: '<p></p>',
          images: [picture()],
        }}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Photo')).toBeInTheDocument();
    await waitFor(() =>
      expect(thumbnailImg()).toHaveAttribute('src', 'blob:h1')
    );
    // "Photo" already says what it is.
    expect(thumbnailImg()).toHaveAttribute('alt', '');
    expect(requestResource).not.toHaveBeenCalled();
  });

  it('keeps the text and names the picture for screen readers', async () => {
    installResources();
    render(
      <ComposerReplyPreview
        message={{
          senderName: 'alice',
          messageText: '<p>look at this</p>',
          images: [picture()],
        }}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('look at this')).toBeInTheDocument();
    expect(
      await screen.findByAltText('Picture in the quoted message')
    ).toHaveAttribute('src', 'blob:h1');
    expect(screen.queryByText('Photo')).toBeNull();
  });

  it('names GIFs and videos', () => {
    installResources();
    const { rerender } = render(
      <ComposerReplyPreview
        message={{
          senderName: 'alice',
          images: [
            {
              name: 'bob',
              identifier: 'gif-cat',
              service: 'IMAGE',
              libraryGif: true,
              mimeType: 'image/gif',
            },
          ],
        }}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('GIF')).toBeInTheDocument();

    rerender(
      <ComposerReplyPreview
        message={{
          senderName: 'alice',
          attachments: [
            {
              reticulumResource: true,
              fileHash: 'v1',
              fileName: 'clip.mp4',
              mimeType: 'video/mp4',
            },
          ],
        }}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('Video')).toBeInTheDocument();
    expect(screen.getByTestId('VideocamRoundedIcon')).toBeInTheDocument();
  });

  it('jumps to the message from the picture too', async () => {
    installResources();
    const onJump = vi.fn();
    render(
      <ComposerReplyPreview
        message={{ senderName: 'alice', images: [picture()] }}
        onCancel={vi.fn()}
        onJumpToMessage={onJump}
      />
    );
    await userEvent.click(screen.getByTestId('reply-thumbnail'));
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('has no thumbnail for a text reply', () => {
    render(
      <ComposerReplyPreview
        message={{ senderName: 'alice', messageText: '<p>hello</p>' }}
        onCancel={vi.fn()}
      />
    );
    expect(screen.queryByTestId('reply-thumbnail')).toBeNull();
  });
});
