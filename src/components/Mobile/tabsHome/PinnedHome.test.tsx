import React from 'react';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { Provider, createStore } from 'jotai';

const prefs = vi.hoisted(() => new Map<string, unknown>());

vi.mock('../../../utils/chromeStorage', () => ({
  getData: vi.fn(async (key: string) =>
    prefs.has(key) ? structuredClone(prefs.get(key)) : null
  ),
  storeData: vi.fn(async (key: string, value: unknown) => {
    prefs.set(key, structuredClone(value));
    return 'Data saved successfully';
  }),
}));
vi.mock('../../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  isUsingImportExportSettingsAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
  userInfoAtom,
} from '../../../atoms/global';
import { subscribeToEvent, unsubscribeFromEvent } from '../../../utils/events';
import { setPinnedAppsAccount } from '../../../utils/pinnedAppsStorage';
import { APP_BOOKMARKS_STORAGE_KEY } from '../../Apps/AppBookmarks/bookmarkStorage';
import { saveLauncherView } from '../../Apps/AppsLauncher/launcherItems';
import { savedAppsStateAtom } from '../../Apps/AppsLauncher/savedAppsSync';
import { PinnedHome } from './PinnedHome';

const ADDRESS = 'QPhone';
const bookmarkStore = new Map<string, unknown>();

const tileKeys = () =>
  Array.from(document.querySelectorAll('[data-home-tile]')).map((tile) =>
    tile.getAttribute('data-home-tile')
  );

const renderPinned = async () => {
  bookmarkStore.set(APP_BOOKMARKS_STORAGE_KEY, {
    [ADDRESS]: {
      folders: [{ id: 'f1', name: 'Media', createdAt: 1, updatedAt: 1 }],
      bookmarks: [
        {
          id: 'b1',
          name: 'Q-Tube',
          service: 'APP',
          appName: 'Q-Tube',
          path: '',
          link: 'qortal://APP/Q-Tube',
          folderId: 'f1',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'b2',
          name: 'Posts',
          service: 'APP',
          appName: 'Q-Blog',
          path: 'posts',
          link: 'qortal://APP/Q-Blog/posts',
          folderId: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      updatedAt: 1,
    },
  });
  // As Hub left it: the folder first, the bookmark after Q-Mail.
  saveLauncherView(ADDRESS, {
    order: ['folder:f1', 'APP-Q-Mail', 'bookmark:b2'],
    openFolders: [],
  });
  const store = createStore();
  store.set(userInfoAtom, { address: ADDRESS, name: 'alice' });
  store.set(isUsingImportExportSettingsAtom, false as never);
  store.set(settingsQDNLastUpdatedAtom, 10 as never);
  // QDN's settings were read and hold no saved apps yet.
  store.set(savedAppsStateAtom, {
    address: ADDRESS,
    status: 'read',
    saved: { pins: [], data: { folders: [], bookmarks: [] }, order: [] },
    hasCopy: false,
  });
  store.set(sortablePinnedAppsAtom, [
    { name: 'Q-Tube', service: 'APP' },
    { name: 'Q-Mail', service: 'APP' },
    { name: 'Q-Wallets', service: 'APP' },
  ]);
  render(
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <PinnedHome isVisible onBrowseApps={vi.fn()} scrollParent={null} />
      </ThemeProvider>
    </Provider>
  );
  await waitFor(() => expect(tileKeys().length).toBeGreaterThan(0));
  // Ready once the phone's own store was read too: long presses work then.
  await waitFor(() =>
    expect(
      (prefs.get(`hub_mobile_tab_org_${ADDRESS}`) as any)?.movedToBookmarks
    ).toBe(true)
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return store;
};

/** A long press that is let go without moving: the tile's menu. */
const longPress = async (element: Element) => {
  fireEvent.mouseDown(element, { button: 0, clientX: 10, clientY: 10 });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 430));
  });
  fireEvent.mouseUp(window, { clientX: 10, clientY: 10 });
};

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  prefs.clear();
  bookmarkStore.clear();
  localStorage.clear();
  setPinnedAppsAccount(ADDRESS);
  vi.stubGlobal('appStorage', {
    get: async (key: string) => structuredClone(bookmarkStore.get(key)),
    set: async (key: string, value: unknown) => {
      bookmarkStore.set(key, structuredClone(value));
    },
    delete: async () => undefined,
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360);
});
afterEach(() => {
  setPinnedAppsAccount(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PinnedHome', () => {
  it("shows the desktop Hub's launcher: apps, bookmarks and folders in its order", async () => {
    await renderPinned();

    // Q-Tube is in the folder, so it shows there, not in the row.
    expect(tileKeys()).toEqual([
      'folder:f1',
      'APP-Q-Mail',
      'bookmark:b2',
      'APP-Q-Wallets',
    ]);
    const bookmarkTile = document.querySelector(
      '[data-home-tile="bookmark:b2"]'
    )!;
    expect(bookmarkTile.textContent).toContain('Posts');
    expect(
      bookmarkTile.querySelector('[data-testid="BookmarkIcon"]')
    ).not.toBeNull();
  });

  it('opens a bookmark at its page', async () => {
    await renderPinned();
    const opened: unknown[] = [];
    const listen = (event: CustomEvent) => opened.push(event.detail?.data);
    subscribeToEvent('addTab', listen);

    fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
    unsubscribeFromEvent('addTab', listen);

    expect(opened).toEqual([
      expect.objectContaining({ name: 'Q-Blog', path: 'posts' }),
    ]);
  });

  it('unpins an app from its long-press menu and offers to save that', async () => {
    const store = await renderPinned();

    await longPress(
      document.querySelector('[data-home-tile="APP-Q-Wallets"] .go-lift')!
    );
    fireEvent.click(await screen.findByText('core:action.unpin_app'));

    await waitFor(() => expect(tileKeys()).not.toContain('APP-Q-Wallets'));
    expect(store.get(sortablePinnedAppsAtom)).toEqual([
      { name: 'Q-Tube', service: 'APP' },
      { name: 'Q-Mail', service: 'APP' },
    ]);
    expect(await screen.findByText('core:launcher.save_title')).toBeVisible();
  });

  it('moves a bookmark into a folder from its menu', async () => {
    await renderPinned();

    await longPress(
      document.querySelector('[data-home-tile="bookmark:b2"] .go-lift')!
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Media' }));

    await waitFor(() => expect(tileKeys()).not.toContain('bookmark:b2'));
    await waitFor(() => {
      const stored = (
        bookmarkStore.get(APP_BOOKMARKS_STORAGE_KEY) as Record<string, any>
      )[ADDRESS];
      expect(
        stored.bookmarks.find((entry: { id: string }) => entry.id === 'b2')
          .folderId
      ).toBe('f1');
    });
  });
});
