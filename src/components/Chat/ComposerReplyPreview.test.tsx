import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { ComposerReplyPreview } from './ComposerReplyPreview';
import { COMPOSER_DISMISS_BUTTON_PX } from './composerCornerLayout';

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
