import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/i18n';
import { ImageViewer } from './ImageEmbed';
import {
  ChatMediaGalleryContext,
  type ChatMediaItem,
} from '../Chat/chatMediaGallery';

const setPhone = (phone: boolean) => {
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

const items: ChatMediaItem[] = [
  {
    key: 'a:gif',
    messageKey: 'a',
    kind: 'image',
    gif: { name: 'x', identifier: 'gif-1' },
  },
  {
    key: 'b:embed',
    messageKey: 'b',
    kind: 'image',
    qdn: {
      service: 'IMAGE',
      name: 'bob',
      identifier: 'holiday',
      encrypted: false,
    },
  },
];

describe('image embed in a chat', () => {
  const originalMatchMedia = window.matchMedia;

  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('opens the chat viewer, with Copy, among the chat’s pictures', () => {
    setPhone(true);
    render(
      <ChatMediaGalleryContext.Provider value={{ getItems: () => items }}>
        <div className="message-item-row" id="b">
          <ImageViewer
            alt="holiday"
            resource={{ service: 'IMAGE', name: 'bob', identifier: 'holiday' }}
            src="http://node/arbitrary/IMAGE/bob/holiday"
          />
        </div>
      </ChatMediaGalleryContext.Provider>
    );
    fireEvent.click(screen.getByAltText('holiday'));
    const bar = screen.getByRole('toolbar', { name: 'Image actions' });
    expect(
      within(bar).getByRole('button', { name: 'Copy image' })
    ).toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
  });
});
