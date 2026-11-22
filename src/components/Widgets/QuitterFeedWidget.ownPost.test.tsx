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
import { QuitterFeedWidget } from './QuitterFeedWidget';
import type {
  QuitterDashboardFeedCache,
  QuitterFeedItem,
} from './quitter/quitterFeedTypes';

const item = (author: string, identifier = 'p'): QuitterFeedItem => ({
  author,
  avatarUrl: '',
  hasVideo: false,
  id: `${author}:${identifier}`,
  identifier,
  images: [],
  latestSignature: 's',
  publishedAt: 1,
  searchCreatedAt: 1,
  service: 'DOCUMENT',
  text: `post by ${author}`,
});

const loaded = (
  items: QuitterFeedItem[],
  pendingItems: QuitterFeedItem[] = []
): QuitterDashboardFeedCache => ({
  error: null,
  feedKey: 'following:Torq:Alice',
  followingEmptyReason: null,
  initialFeedState: 'success',
  items,
  lastFullFetchAt: Date.now(),
  lastPollAt: null,
  pendingItems,
});

const theme = createTheme({ palette: { border: { main: '#888' } } as any });
const widget = (ownPost: QuitterFeedItem | null) => (
  <ThemeProvider theme={theme}>
    <I18nextProvider i18n={i18n}>
      <QuitterFeedWidget ownPost={ownPost} />
    </I18nextProvider>
  </ThemeProvider>
);
const cachedIds = () =>
  getDefaultStore()
    .get(quitterDashboardFeedCacheAtom)
    ?.items.map((entry) => entry.id);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  const store = getDefaultStore();
  store.set(userInfoAtom, { name: 'Alice', address: 'QAlice' } as any);
  store.set(quitterDashboardFeedCacheAtom, null as any);
  api.fetchQuitterFollowedNames.mockResolvedValue(['Dan']);
  api.fetchQuitterFeedPage.mockResolvedValue({
    hasMore: false,
    items: [item('Dan')],
    nextOffset: 1,
  });
  api.fetchTorqHiddenUsers.mockResolvedValue([]);
});

describe('QuitterFeedWidget and a post just published from Home', () => {
  it('puts it on top of Following at once, though Following leaves out your own posts', async () => {
    getDefaultStore().set(
      quitterDashboardFeedCacheAtom,
      loaded([item('Dan'), item('Erin')])
    );
    const view = render(widget(null));
    expect(cachedIds()).toEqual(['Dan:p', 'Erin:p']);

    view.rerender(widget(item('Alice', 'new')));
    await waitFor(() =>
      expect(cachedIds()).toEqual(['Alice:new', 'Dan:p', 'Erin:p'])
    );
    // Nothing is fetched for it: it is the post as it was published.
    expect(api.fetchQuitterFeedPage).not.toHaveBeenCalled();
  });

  it('waits for the feed to load, then adds it', async () => {
    const own = item('Alice', 'new');
    render(widget(own));
    await waitFor(() => expect(cachedIds()).toEqual(['Alice:new', 'Dan:p']));
  });

  it('never shows it twice, also once the node lists it', async () => {
    const own = item('Alice', 'new');
    getDefaultStore().set(
      quitterDashboardFeedCacheAtom,
      loaded([item('Dan')], [own])
    );
    const view = render(widget(own));
    await waitFor(() => expect(cachedIds()).toEqual(['Alice:new', 'Dan:p']));
    expect(
      getDefaultStore().get(quitterDashboardFeedCacheAtom)?.pendingItems
    ).toEqual([]);

    // A rerender with the same post (or a remount) adds nothing more.
    view.rerender(widget({ ...own }));
    view.unmount();
    render(widget(own));
    await waitFor(() => expect(cachedIds()).toEqual(['Alice:new', 'Dan:p']));
  });

  it('leaves a feed that failed to load as it is, with its Retry', async () => {
    api.fetchQuitterFeedPage.mockRejectedValue(new Error('node down'));
    render(widget(item('Alice', 'new')));
    await waitFor(() =>
      expect(
        getDefaultStore().get(quitterDashboardFeedCacheAtom)?.initialFeedState
      ).toBe('error')
    );
    expect(cachedIds()).toEqual([]);
  });
});
