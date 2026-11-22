import { describe, expect, it, vi } from 'vitest';

vi.mock('../../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

import type {
  AppBookmark,
  AppBookmarksForAddress,
} from '../../Apps/AppBookmarks/bookmarkTypes';
import {
  buildLauncherItems,
  EMPTY_LAUNCHER_VIEW,
} from '../../Apps/AppsLauncher/launcherItems';
import { buildLauncherPins } from '../../Apps/AppsLauncher/launcherPins';
import { getOpenTabKey } from '../mobileTabOrganization';
import {
  bookmarkOfTab,
  bookmarksAsSavedTabs,
  goFoldersOf,
  goKeyOfBookmark,
  orderWithFolderMoved,
  orderWithFolders,
  shellOfBookmark,
  shellOfPin,
  withFolderOrder,
} from './goLauncherOps';

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

const folder = (id: string, name: string) => ({
  id,
  name,
  createdAt: 1,
  updatedAt: 1,
});

const data = (
  folders: ReturnType<typeof folder>[],
  bookmarks: AppBookmark[]
): AppBookmarksForAddress => ({ folders, bookmarks, updatedAt: 1 });

const pins = (...names: string[]) =>
  buildLauncherPins(
    names.map((name) => ({ name, service: 'APP' })),
    []
  );

describe('goKeyOfBookmark', () => {
  it('keys an app or an identifier page like its open window', () => {
    expect(goKeyOfBookmark(bookmark('b1', 'Q-Tube', null))).toBe('APP|Q-Tube');
    expect(
      goKeyOfBookmark(
        bookmark('b2', 'blog', null, { service: 'WEBSITE', identifier: 'p1' })
      )
    ).toBe('WEBSITE|blog|p1');
  });

  it('gives a page inside an app a key of its own', () => {
    expect(
      goKeyOfBookmark(bookmark('b3', 'Q-Tube', null, { path: '/playlists/' }))
    ).toBe('bookmark:b3');
  });
});

describe('shells', () => {
  it('opens a bookmark at its page, under its own name', () => {
    const shell = shellOfBookmark(
      bookmark('b3', 'Q-Tube', null, { name: 'Playlists', path: 'playlists' })
    );
    expect(shell).toEqual({
      tabId: 'saved:bookmark:b3',
      service: 'APP',
      name: 'Q-Tube',
      path: 'playlists',
      label: 'Playlists',
    });
    expect(getOpenTabKey(shell)).toBe('bookmark:b3');
  });

  it('opens a pinned app, a private one through its decrypt', () => {
    const [publicPin] = pins('Q-Mail');
    expect(shellOfPin(publicPin, 'Private')).toMatchObject({
      tabId: 'saved:APP|Q-Mail',
      name: 'Q-Mail',
      service: 'APP',
    });
    const [privatePin] = buildLauncherPins(
      [
        {
          isPrivate: true,
          privateAppProperties: {
            name: 'alice',
            service: 'APP',
            identifier: 'pinnic',
            groupId: 7,
            appName: 'Pinnic',
          },
        },
      ],
      []
    );
    expect(shellOfPin(privatePin, 'Private')).toMatchObject({
      isPrivate: true,
      label: 'Pinnic',
      tabId: 'saved:APP|alice|pinnic',
    });
  });
});

describe('goFoldersOf', () => {
  it("gives the launcher's folders as Tabs folders, with rows and sizes", () => {
    const items = buildLauncherItems(
      pins('Q-Tube', 'Q-Mail'),
      data(
        [folder('f1', 'Media'), folder('f2', 'Work')],
        [
          bookmark('b1', 'Q-Tube', 'f1'),
          bookmark('b2', 'Q-Tube', 'f1', { path: 'playlists', name: 'Lists' }),
          bookmark('b3', 'Q-Mail', 'f2'),
        ]
      ),
      { order: ['folder:f2', 'folder:f1'], openFolders: [] }
    );

    const result = goFoldersOf(items, {
      f1: { size: 'small', row: 1 },
    });

    expect(result.folders).toEqual([
      { id: 'f2', name: 'Work', tabKeys: ['APP|Q-Mail'], order: 0, row: 0 },
      {
        id: 'f1',
        name: 'Media',
        tabKeys: ['APP|Q-Tube', 'bookmark:b2'],
        order: 0,
        row: 1,
        size: 'small',
      },
    ]);
    expect(result.tabFolderMap).toEqual({
      'APP|Q-Mail': 'f2',
      'APP|Q-Tube': 'f1',
      'bookmark:b2': 'f1',
    });
    expect(result.savedTabs['bookmark:b2']).toEqual({
      service: 'APP',
      name: 'Q-Tube',
      identifier: undefined,
      path: 'playlists',
      label: 'Lists',
    });
    expect(result.children.get('bookmark:b2')).toMatchObject({
      folderId: 'f1',
      item: { key: 'bookmark:b2' },
    });
  });
});

describe('folder order', () => {
  const items = buildLauncherItems(
    pins('A', 'B'),
    data([folder('f1', 'One'), folder('f2', 'Two'), folder('f3', 'Three')], []),
    {
      order: ['folder:f1', 'APP-A', 'folder:f2', 'APP-B', 'folder:f3'],
      openFolders: [],
    }
  );

  it('puts folders in a new order in the places folders take', () => {
    expect(orderWithFolders(items, ['f3', 'f1'])).toEqual([
      'folder:f3',
      'APP-A',
      'folder:f2',
      'APP-B',
      'folder:f1',
    ]);
  });

  it('moves one folder in front of another, after one, or to the end', () => {
    expect(orderWithFolderMoved(items, 'f3', { beforeFolderId: 'f1' })).toEqual(
      ['folder:f3', 'folder:f1', 'APP-A', 'folder:f2', 'APP-B']
    );
    expect(orderWithFolderMoved(items, 'f1', { afterFolderId: 'f2' })).toEqual([
      'APP-A',
      'folder:f2',
      'folder:f1',
      'APP-B',
      'folder:f3',
    ]);
    expect(orderWithFolderMoved(items, 'f1', {})).toEqual([
      'APP-A',
      'folder:f2',
      'APP-B',
      'folder:f3',
      'folder:f1',
    ]);
  });
});

describe('bookmarkOfTab', () => {
  it('bookmarks the page an open tab shows, as the bookmarks menu would', () => {
    expect(
      bookmarkOfTab(
        {
          tabId: 't1',
          service: 'app',
          name: 'Q-Tube',
          path: '/channel/x?tab=1',
          label: 'Channel',
        },
        'f1',
        { id: 'n1', now: 5 }
      )
    ).toEqual({
      id: 'n1',
      name: 'Channel',
      service: 'APP',
      appName: 'Q-Tube',
      path: 'channel/x',
      link: 'qortal://APP/Q-Tube/channel/x',
      folderId: 'f1',
      createdAt: 5,
      updatedAt: 5,
    });
  });

  it('has none for a private app or a page of GO', () => {
    expect(
      bookmarkOfTab(
        {
          tabId: 't2',
          isPrivate: true,
          name: 'alice',
          service: 'APP',
          privateAppProperties: { identifier: 'x' },
        },
        null,
        { id: 'n2', now: 5 }
      )
    ).toBeNull();
    expect(
      bookmarkOfTab({ tabId: 't3', internal: 'q-chat' }, null, {
        id: 'n3',
        now: 5,
      })
    ).toBeNull();
  });
});

describe('withFolderOrder', () => {
  const store = data(
    [folder('f1', 'Media')],
    [
      bookmark('b1', 'A', 'f1'),
      bookmark('x', 'Loose', null),
      bookmark('b2', 'B', 'f1'),
      bookmark('b3', 'C', 'f1'),
    ]
  );

  it("puts a folder's bookmarks in the order of their keys", () => {
    const next = withFolderOrder(store, 'f1', ['APP|C', 'APP|A'], 9);
    expect(next.bookmarks.map((entry) => entry.id)).toEqual([
      'b3',
      'x',
      'b1',
      'b2',
    ]);
    expect(next.updatedAt).toBe(9);
  });

  it('gives the same store back when the order is the same', () => {
    expect(withFolderOrder(store, 'f1', ['APP|A', 'APP|B', 'APP|C'], 9)).toBe(
      store
    );
  });
});

describe('bookmarksAsSavedTabs', () => {
  it('lists every bookmark once, for the app pictures', () => {
    const result = bookmarksAsSavedTabs(
      data(
        [folder('f1', 'Media')],
        [
          bookmark('b1', 'Q-Tube', 'f1'),
          bookmark('b2', 'Q-Tube', null, { path: 'lists' }),
        ]
      )
    );
    expect(result.tabKeys).toEqual(['APP|Q-Tube', 'bookmark:b2']);
    expect(result.savedTabs['APP|Q-Tube']).toMatchObject({ name: 'Q-Tube' });
  });

  it('keeps the empty view of an account with nothing', () => {
    expect(
      goFoldersOf(buildLauncherItems([], null, EMPTY_LAUNCHER_VIEW), {}).folders
    ).toEqual([]);
  });
});
