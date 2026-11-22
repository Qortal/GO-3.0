import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ComponentProps } from 'react';

vi.mock('./QuitterFeedWidget', () => ({
  QuitterFeedWidget: ({
    ownPost,
    refreshToken,
  }: {
    ownPost?: { id: string } | null;
    refreshToken?: number;
  }) => (
    <div
      data-testid="torq-feed"
      data-own-post={ownPost?.id ?? ''}
      data-refresh-token={String(refreshToken ?? 0)}
    />
  ),
}));

const published = {
  author: 'Alice',
  postIdentifier: 'qpost-1',
  post: { name: 'Alice', text: 'Hello Torq', timestamp: 1700 },
};
vi.mock('./quitter/HomeQuitterComposer', () => ({
  HomeQuitterComposer: ({
    onPublished,
  }: {
    onPublished: (value: typeof published) => void;
  }) => (
    <button type="button" onClick={() => onPublished(published)}>
      composer
    </button>
  ),
}));

vi.mock('./quitter/quitterFeedApi', () => ({
  feedItemFromPublishedPost: (
    author: string,
    identifier: string,
    post: { text: string }
  ) => ({ id: `${author}:${identifier}`, text: post.text }),
}));

import { TorqFeedWindow } from './TorqFeedWindow';

const theme = createTheme({ palette: { border: { main: '#888' } } as any });
const renderWindow = (
  props: Partial<ComponentProps<typeof TorqFeedWindow>> = {}
) => {
  const onRefresh = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <TorqFeedWindow
        feed={{ refreshToken: 3 }}
        height={612}
        onRefresh={onRefresh}
        title="Torq Feed"
        widgetId="quitter"
        {...props}
      />
    </ThemeProvider>
  );
  return { onRefresh };
};
const frame = () =>
  document.querySelector('[data-widget-id="quitter"]') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TorqFeedWindow', () => {
  it('has the composer at the top of the feed, in one window', () => {
    renderWindow();
    const inWindow = within(frame());
    const composer = inWindow.getByRole('button', { name: 'composer' });
    const feed = inWindow.getByTestId('torq-feed');
    expect(feed).toHaveAttribute('data-refresh-token', '3');
    expect(
      composer.compareDocumentPosition(feed) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(inWindow.getByText('Torq Feed')).toBeInTheDocument();
    expect(
      inWindow.getByRole('button', { name: 'Refresh widget' })
    ).toBeInTheDocument();
  });

  it('shows a post published here on top of the feed and refreshes it', () => {
    const { onRefresh } = renderWindow();
    expect(screen.getByTestId('torq-feed')).toHaveAttribute(
      'data-own-post',
      ''
    );

    fireEvent.click(screen.getByRole('button', { name: 'composer' }));

    expect(screen.getByTestId('torq-feed')).toHaveAttribute(
      'data-own-post',
      'Alice:qpost-1'
    );
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('is the composer alone while the feed is turned off', () => {
    renderWindow({ feed: null, title: 'Torq' });
    expect(screen.queryByTestId('torq-feed')).toBeNull();
    expect(screen.getByRole('button', { name: 'composer' })).toBeVisible();
    expect(screen.getByText('Torq')).toBeInTheDocument();
    // Nothing to refresh without the feed.
    expect(screen.queryByRole('button', { name: 'Refresh widget' })).toBeNull();
  });
});
