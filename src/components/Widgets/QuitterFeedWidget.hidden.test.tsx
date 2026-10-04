import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

const api = vi.hoisted(() => ({
  fetchQuitterFeedPage: vi.fn(),
  fetchQuitterFollowedNames: vi.fn(),
  fetchTorqHiddenUsers: vi.fn(),
}));

vi.mock('./quitter/quitterFeedApi', () => ({
  fetchQuitterFeedPage: api.fetchQuitterFeedPage,
  fetchQuitterFollowedNames: api.fetchQuitterFollowedNames,
}));
vi.mock('./quitter/torqHiddenUsers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./quitter/torqHiddenUsers')>()),
  fetchTorqHiddenUsers: api.fetchTorqHiddenUsers,
}));
vi.mock('../../plugins/ShareReceiver', () => ({
  ShareReceiver: { setShareTarget: vi.fn(async () => undefined) },
}));

i18n.init({ lng: 'en', resources: { en: { core: {} } } });

import { getDefaultStore } from 'jotai';
import {
  quitterDashboardFeedCacheAtom,
  userInfoAtom,
} from '../../atoms/global';
import { composerTargetAtom } from './quitter/composerTarget';
import { QuitterFeedWidget } from './QuitterFeedWidget';
import type { QuitterFeedItem } from './quitter/quitterFeedTypes';

const item = (author: string): QuitterFeedItem => ({
  author,
  avatarUrl: '',
  hasVideo: false,
  id: `${author}:p`,
  identifier: 'p',
  images: [],
  latestSignature: 's',
  publishedAt: 1,
  searchCreatedAt: 1,
  service: 'DOCUMENT',
  text: `post by ${author}`,
});

const renderWidget = () =>
  render(
    <ThemeProvider
      theme={createTheme({ palette: { border: { main: '#888' } } as any })}
    >
      <I18nextProvider i18n={i18n}>
        <QuitterFeedWidget />
      </I18nextProvider>
    </ThemeProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  const store = getDefaultStore();
  store.set(userInfoAtom, { name: 'Alice', address: 'QAlice' } as any);
  store.set(quitterDashboardFeedCacheAtom, null as any);
  api.fetchQuitterFollowedNames.mockResolvedValue(['Bob', 'Dan']);
  api.fetchQuitterFeedPage.mockResolvedValue({
    hasMore: false,
    items: [item('Dan')],
    nextOffset: 1,
  });
  api.fetchTorqHiddenUsers.mockResolvedValue(['Bob']);
});

describe('QuitterFeedWidget and Torq hidden users', () => {
  it('leaves Torq hidden users out of the Torq feed', async () => {
    getDefaultStore().set(composerTargetAtom, 'torq');
    renderWidget();
    await waitFor(() => expect(api.fetchQuitterFeedPage).toHaveBeenCalled());
    expect(api.fetchTorqHiddenUsers).toHaveBeenCalledWith(
      'Alice',
      expect.any(Object)
    );
    expect(api.fetchQuitterFeedPage.mock.calls[0][0]).toMatchObject({
      allowedAuthors: ['Bob', 'Dan'],
      hiddenAuthors: ['Bob'],
    });
  });

  it('keeps the Quitter feed as it was', async () => {
    getDefaultStore().set(composerTargetAtom, 'quitter');
    renderWidget();
    await waitFor(() => expect(api.fetchQuitterFeedPage).toHaveBeenCalled());
    expect(api.fetchTorqHiddenUsers).not.toHaveBeenCalled();
    expect(api.fetchQuitterFeedPage.mock.calls[0][0].hiddenAuthors).toEqual([]);
  });

  it('drops a hidden account from a feed shown from cache', async () => {
    getDefaultStore().set(composerTargetAtom, 'torq');
    getDefaultStore().set(quitterDashboardFeedCacheAtom, {
      error: null,
      feedKey: 'following:Torq:Alice',
      followingEmptyReason: null,
      initialFeedState: 'success',
      items: [item('Bob'), item('Dan')],
      lastFullFetchAt: Date.now(),
      lastPollAt: null,
      pendingItems: [item('Bob')],
    });
    renderWidget();
    await waitFor(() => {
      const cache = getDefaultStore().get(quitterDashboardFeedCacheAtom);
      expect(cache?.items.map((entry) => entry.author)).toEqual(['Dan']);
      expect(cache?.pendingItems).toEqual([]);
    });
    expect(api.fetchQuitterFeedPage).not.toHaveBeenCalled();
  });
});
