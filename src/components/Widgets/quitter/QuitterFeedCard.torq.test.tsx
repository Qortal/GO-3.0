import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

vi.mock('../../Chat/gifs/GifImage', () => ({
  GifImage: ({ gif }: { gif: { identifier: string } }) => (
    <div data-testid={`gif-${gif.identifier}`} />
  ),
}));

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { group: { home_composer: { poll_title: 'poll' } } } },
  interpolation: { escapeValue: false },
});

import { QuitterFeedCard } from './QuitterFeedCard';
import type { QuitterFeedItem } from './quitterFeedTypes';

const ownLink = 'qortal://APP/Torq/post/Alice/post-1';
const item: QuitterFeedItem = {
  author: 'Alice',
  avatarUrl: '',
  hasVideo: false,
  id: 'Alice:post-1',
  identifier: 'post-1',
  images: Array.from({ length: 6 }, (_, i) => ({
    alt: `image ${i}`,
    src: `data:image/webp;base64,${i}`,
  })),
  latestSignature: 'sig',
  publishedAt: Date.now(),
  searchCreatedAt: Date.now(),
  service: 'DOCUMENT',
  text: `Pick one\n\n${ownLink}\n\nqortal://use-embed/IMAGE?name=Carol&identifier=gif-cat`,
  gifs: [{ identifier: 'gif-cat', name: 'Carol' }],
  attachments: [{ title: 'My song', isAudio: true }],
  pollOptions: ['Yes', 'No'],
};

const wrap = (ui: React.ReactElement) =>
  render(
    <ThemeProvider
      theme={createTheme({ palette: { border: { main: '#888' } } as any })}
    >
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </ThemeProvider>
  );

describe('QuitterFeedCard as Torq', () => {
  it('shows the post as Torq does: no compat links, with its extras', () => {
    wrap(<QuitterFeedCard app="Torq" item={item} />);
    expect(screen.getByText('Pick one')).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(ownLink))).not.toBeInTheDocument();
    expect(screen.getByTestId('gif-gif-cat')).toBeInTheDocument();
    expect(screen.getByText('My song')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    // Four pictures, the last one marked with the two that do not fit.
    expect(screen.getAllByRole('img')).toHaveLength(4);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('keeps the Quitter card unchanged', () => {
    wrap(<QuitterFeedCard item={item} />);
    expect(screen.getByText(new RegExp(ownLink))).toBeInTheDocument();
    expect(screen.queryByText('My song')).not.toBeInTheDocument();
    expect(screen.queryByText('Yes')).not.toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(6);
  });
});
