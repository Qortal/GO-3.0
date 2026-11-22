import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';

const prefs = vi.hoisted(() => new Map<string, unknown>());

vi.mock('../../utils/chromeStorage', () => ({
  getData: vi.fn(async (key: string) =>
    prefs.has(key) ? structuredClone(prefs.get(key)) : null
  ),
  storeData: vi.fn(async (key: string, value: unknown) => {
    prefs.set(key, structuredClone(value));
    return 'Data saved successfully';
  }),
}));
vi.mock('../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  isUsingImportExportSettingsAtom,
  sortablePinnedAppsAtom,
  userInfoAtom,
} from '../../atoms/global';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { setPinnedAppsAccount } from '../../utils/pinnedAppsStorage';
import { APP_BOOKMARKS_STORAGE_KEY } from '../Apps/AppBookmarks/bookmarkStorage';
import type { AppBookmark } from '../Apps/AppBookmarks/bookmarkTypes';
import { saveLauncherView } from '../Apps/AppsLauncher/launcherItems';
import { launcherEditsAtom } from '../Apps/AppsLauncher/launcherQdnSync';
import { useMobileTabOrganization } from './useMobileTabOrganization';

const ADDRESS = 'QPhone';

const bookmarkStore = new Map<string, unknown>();

const bookmark = (
  id: string,
  appName: string,
  folderId: string | null,
  patch: Partial<AppBookmark> = {}
): AppBookmark => ({
  id,
  name: appName,
  service: 'APP',
  appName,
  path: '',
  link: `qortal://APP/${appName}`,
  folderId,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const stored = () =>
  (bookmarkStore.get(APP_BOOKMARKS_STORAGE_KEY) as Record<string, any>)[
    ADDRESS
  ];

/** Hub's arrangement on this phone: Q-Tube and Q-Mail pinned, two folders. */
const setUp = async () => {
  bookmarkStore.set(APP_BOOKMARKS_STORAGE_KEY, {
    [ADDRESS]: {
      folders: [
        { id: 'f1', name: 'Media', createdAt: 1, updatedAt: 1 },
        { id: 'f2', name: 'Work', createdAt: 1, updatedAt: 1 },
      ],
      bookmarks: [
        bookmark('b1', 'Q-Tube', 'f1', { name: 'Videos' }),
        bookmark('b2', 'Q-Blog', 'f1', { path: 'posts', name: 'Posts' }),
      ],
      updatedAt: 1,
    },
  });
  saveLauncherView(ADDRESS, {
    order: ['APP-Q-Mail', 'folder:f1', 'folder:f2'],
    openFolders: [],
  });
  const store = createStore();
  store.set(userInfoAtom, { address: ADDRESS, name: 'alice' });
  store.set(isUsingImportExportSettingsAtom, false as never);
  store.set(sortablePinnedAppsAtom, [
    { name: 'Q-Tube', service: 'APP' },
    { name: 'Q-Mail', service: 'APP' },
  ]);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(() => useMobileTabOrganization(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return { store, hook };
};

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
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
});
afterEach(() => {
  setPinnedAppsAccount(null);
  vi.unstubAllGlobals();
});

describe('useMobileTabOrganization on the launcher', () => {
  it('shows the bookmark folders as Tabs folders', async () => {
    const { hook } = await setUp();
    const org = hook.result.current;

    expect(org.folders.map((folder) => [folder.name, folder.tabKeys])).toEqual([
      ['Media', ['APP|Q-Tube', 'bookmark:b2']],
      ['Work', []],
    ]);
    expect(
      org.getTabTitle({ tabId: 'live', service: 'APP', name: 'Q-Tube' })
    ).toBe('Videos');
    expect(
      org.getFolderForTab({ tabId: 'live', service: 'APP', name: 'Q-Tube' })?.id
    ).toBe('f1');
  });

  it('bookmarks the page of an open tab into a folder', async () => {
    const { hook, store } = await setUp();

    await act(async () => {
      await hook.result.current.addTabToFolder(
        { tabId: 't1', service: 'APP', name: 'Q-Shop', path: '/cart' },
        'f2'
      );
    });
    await flush();

    expect(
      stored().bookmarks.find(
        (entry: AppBookmark) => entry.appName === 'Q-Shop'
      )
    ).toMatchObject({ folderId: 'f2', path: 'cart' });
    expect(store.get(launcherEditsAtom)).toEqual({
      address: ADDRESS,
      count: 1,
    });
  });

  it('puts a pinned app into a folder the way Hub does: it stays pinned', async () => {
    const { hook, store } = await setUp();

    await act(async () => {
      await hook.result.current.addTabToFolder(
        { tabId: 't1', service: 'APP', name: 'Q-Mail' },
        'f2'
      );
    });
    await flush();

    expect(
      stored().bookmarks.find(
        (entry: AppBookmark) => entry.appName === 'Q-Mail'
      )
    ).toMatchObject({ folderId: 'f2', path: '' });
    expect(store.get(sortablePinnedAppsAtom)).toEqual(
      expect.arrayContaining([{ name: 'Q-Mail', service: 'APP' }])
    );
    expect(
      hook.result.current.folders.find((folder) => folder.id === 'f2')?.tabKeys
    ).toEqual(['APP|Q-Mail']);
  });

  it('bookmarks the page an open window shows, not its app', async () => {
    const { hook } = await setUp();

    // Q-Tube's start page is in Media; the window shows one of its pages.
    await act(async () => {
      await hook.result.current.addTabToFolder(
        { tabId: 't1', service: 'APP', name: 'Q-Tube', path: '/channel/x' },
        'f2'
      );
    });
    await flush();

    const bookmarks = stored().bookmarks as AppBookmark[];
    expect(bookmarks.find((entry) => entry.id === 'b1')?.folderId).toBe('f1');
    expect(
      bookmarks.find(
        (entry) => entry.appName === 'Q-Tube' && entry.path === 'channel/x'
      )?.folderId
    ).toBe('f2');
  });

  it('says so when a private app is put into a folder', async () => {
    const { hook } = await setUp();
    const snacks: unknown[] = [];
    const listen = (event: CustomEvent) => snacks.push(event.detail);
    subscribeToEvent('openGlobalSnackBar', listen);

    await act(async () => {
      await hook.result.current.addTabToFolder(
        {
          tabId: 't9',
          isPrivate: true,
          name: 'alice',
          service: 'APP',
          privateAppProperties: { name: 'alice', identifier: 'x' },
        },
        'f2'
      );
    });
    unsubscribeFromEvent('openGlobalSnackBar', listen);

    expect(snacks).toEqual([
      expect.objectContaining({ message: 'core:tabs_home.private_no_folder' }),
    ]);
    expect(stored().bookmarks).toHaveLength(2);
  });

  it('takes an app out of its folder into the row, still pinned', async () => {
    const { hook, store } = await setUp();

    await act(async () => {
      await hook.result.current.removeTabFromFolder({
        tabId: 'saved:APP|Q-Tube',
        service: 'APP',
        name: 'Q-Tube',
      });
    });
    await flush();

    expect(stored().bookmarks.map((entry: AppBookmark) => entry.id)).toEqual([
      'b2',
    ]);
    expect(store.get(sortablePinnedAppsAtom)).toEqual(
      expect.arrayContaining([{ name: 'Q-Tube', service: 'APP' }])
    );
    expect(
      hook.result.current.launcher.items.some(
        (item) => item.key === 'APP-Q-Tube'
      )
    ).toBe(true);
  });

  it('makes a folder and its bookmark in one write', async () => {
    const { hook } = await setUp();

    let folderId = '';
    await act(async () => {
      folderId = await hook.result.current.createFolder('Shop', {
        tabId: 't1',
        service: 'APP',
        name: 'Q-Shop',
      });
    });
    await flush();

    expect(
      stored().folders.map((entry: { name: string }) => entry.name)
    ).toEqual(['Media', 'Work', 'Shop']);
    expect(
      stored().bookmarks.find(
        (entry: AppBookmark) => entry.appName === 'Q-Shop'
      )?.folderId
    ).toBe(folderId);
  });

  it('reorders the folders of a row and leaves the apps where they are', async () => {
    const { hook } = await setUp();

    await act(async () => {
      await hook.result.current.reorderFoldersInRow(0, ['f2', 'f1']);
    });

    expect(hook.result.current.launcher.items.map((item) => item.key)).toEqual([
      'APP-Q-Mail',
      'folder:f2',
      'folder:f1',
    ]);
  });

  it('keeps what a deleted folder held, in the row', async () => {
    const { hook } = await setUp();

    await act(async () => {
      await hook.result.current.deleteFolder('f1');
    });
    await flush();

    expect(stored().folders.map((entry: { id: string }) => entry.id)).toEqual([
      'f2',
    ]);
    const keys = hook.result.current.launcher.items.map((item) => item.key);
    expect(keys).toContain('APP-Q-Tube');
    expect(keys).toContain('bookmark:b2');
  });

  it('keeps a size and a row on this phone only', async () => {
    const { hook } = await setUp();

    act(() => {
      hook.result.current.setFolderSize('f1', 'small');
    });
    await act(async () => {
      await hook.result.current.moveFolderToRow('f2', 1, null);
    });

    const folders = hook.result.current.folders;
    expect(folders.find((folder) => folder.id === 'f1')?.size).toBe('small');
    expect(folders.find((folder) => folder.id === 'f2')?.row).toBe(1);
    expect(stored().folders).toHaveLength(2);
  });
});
