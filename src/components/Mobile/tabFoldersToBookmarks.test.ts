import { describe, expect, it, vi } from 'vitest';

vi.mock('../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

import type { AppBookmarksForAddress } from '../Apps/AppBookmarks/bookmarkTypes';
import {
  emptyOrganization,
  type MobileTabOrganization,
} from './mobileTabOrganization';
import {
  moveTabFoldersToBookmarks,
  tabFolderItemOf,
} from './tabFoldersToBookmarks';

const NOW = 1_000;

const organization = (
  patch: Partial<MobileTabOrganization>
): MobileTabOrganization => ({ ...emptyOrganization(), ...patch });

const noBookmarks = (): AppBookmarksForAddress => ({
  folders: [],
  bookmarks: [],
  updatedAt: 1,
});

const ids = () => {
  let next = 0;
  return () => `b${++next}`;
};

const move = (
  org: MobileTabOrganization,
  bookmarks = noBookmarks(),
  order: string[] = [],
  pins: any[] = []
) =>
  moveTabFoldersToBookmarks(org, bookmarks, order, pins, {
    now: NOW,
    newId: ids(),
  });

describe('tabFolderItemOf', () => {
  it("bookmarks an app's start page and pins the app", () => {
    expect(
      tabFolderItemOf(
        'APP|Q-Tube',
        { service: 'APP', name: 'Q-Tube', label: 'Videos' },
        undefined,
        NOW
      )
    ).toEqual({
      kind: 'bookmark',
      bookmark: {
        name: 'Videos',
        service: 'APP',
        appName: 'Q-Tube',
        path: '',
        link: 'qortal://APP/Q-Tube',
        updatedAt: NOW,
      },
      pin: { name: 'Q-Tube', service: 'APP' },
    });
  });

  it('bookmarks a page inside an app without pinning the app', () => {
    const item = tabFolderItemOf(
      'WEBSITE|blog|post-1',
      {
        service: 'WEBSITE',
        name: 'blog',
        identifier: 'post-1',
        path: '/archive/',
      },
      'My post',
      NOW
    );
    expect(item).toMatchObject({
      kind: 'bookmark',
      bookmark: {
        name: 'My post',
        identifier: 'post-1',
        path: 'archive',
      },
      pin: null,
    });
  });

  it('reads the app from the key when nothing else was saved', () => {
    expect(
      tabFolderItemOf('APP|Q-Mail', undefined, undefined, NOW)
    ).toMatchObject({
      kind: 'bookmark',
      bookmark: { name: 'Q-Mail', service: 'APP', appName: 'Q-Mail' },
    });
  });

  it('pins a private app, which cannot be bookmarked', () => {
    expect(
      tabFolderItemOf(
        'APP|alice|pinnic',
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
        undefined,
        NOW
      )
    ).toEqual({
      kind: 'private',
      pin: {
        isPrivate: true,
        isPreview: true,
        privateAppProperties: {
          name: 'alice',
          service: 'APP',
          identifier: 'pinnic',
          groupId: 7,
          appName: 'Pinnic',
        },
      },
    });
  });

  it("leaves GO's own pages out", () => {
    expect(tabFolderItemOf('internal:q-chat', undefined, undefined, NOW)).toBe(
      null
    );
  });
});

describe('moveTabFoldersToBookmarks', () => {
  const games = {
    id: 'folder_1',
    name: 'Games',
    order: 1,
    row: 0,
    tabKeys: ['APP|Q-Tube', 'WEBSITE|site'],
  };
  const library = {
    id: 'folder_2',
    name: 'Library',
    order: 0,
    row: 0,
    tabKeys: ['APP|Q-Mail'],
  };

  it('makes each folder a bookmark folder, in the order GO showed them', () => {
    const result = move(organization({ folders: [games, library] }));

    expect(result.data.folders).toEqual([
      { id: 'folder_2', name: 'Library', createdAt: NOW, updatedAt: NOW },
      { id: 'folder_1', name: 'Games', createdAt: NOW, updatedAt: NOW },
    ]);
    expect(
      result.data.bookmarks.map((bookmark) => [
        bookmark.appName,
        bookmark.folderId,
      ])
    ).toEqual([
      ['Q-Mail', 'folder_2'],
      ['Q-Tube', 'folder_1'],
      ['site', 'folder_1'],
    ]);
    expect(result.order).toEqual(['folder:folder_2', 'folder:folder_1']);
    expect(result.pins).toEqual([
      { name: 'Q-Mail', service: 'APP' },
      { name: 'Q-Tube', service: 'APP' },
      { name: 'site', service: 'WEBSITE' },
    ]);
    expect(result.moved).toBe(3);
    expect(result.folderIdOf).toEqual({
      folder_1: 'folder_1',
      folder_2: 'folder_2',
    });
  });

  it('keeps what is there and adds after it', () => {
    const bookmarks: AppBookmarksForAddress = {
      folders: [{ id: 'hub1', name: 'games ', createdAt: 5, updatedAt: 5 }],
      bookmarks: [
        {
          id: 'x1',
          name: 'Tube',
          service: 'APP',
          appName: 'q-tube',
          path: '',
          link: 'qortal://APP/q-tube',
          folderId: null,
          createdAt: 5,
          updatedAt: 5,
        },
      ],
      updatedAt: 5,
    };
    const result = move(
      organization({ folders: [games] }),
      bookmarks,
      ['APP-Q-Tube', 'folder:hub1'],
      [{ name: 'Q-Tube', service: 'APP' }]
    );

    // A folder of the same name takes the Tabs folder in.
    expect(result.data.folders.map((folder) => folder.id)).toEqual(['hub1']);
    expect(result.folderIdOf).toEqual({ folder_1: 'hub1' });
    // One bookmark per page: Q-Tube keeps its bookmark where it was.
    expect(
      result.data.bookmarks.map((bookmark) => [bookmark.id, bookmark.folderId])
    ).toEqual([
      ['x1', null],
      ['b1', 'hub1'],
    ]);
    expect(result.order).toEqual(['APP-Q-Tube', 'folder:hub1']);
    expect(result.pins).toEqual([
      { name: 'Q-Tube', service: 'APP' },
      { name: 'site', service: 'WEBSITE' },
    ]);
  });

  it('takes a folder that was moved before as it is', () => {
    const first = move(organization({ folders: [library] }));
    const again = moveTabFoldersToBookmarks(
      organization({ folders: [library] }),
      first.data,
      first.order,
      first.pins,
      { now: NOW, newId: ids() }
    );

    expect(again.data).toEqual(first.data);
    expect(again.order).toEqual(first.order);
    expect(again.pins).toEqual(first.pins);
  });

  it('never gives two bookmarks the same id', () => {
    const bookmarks: AppBookmarksForAddress = {
      folders: [],
      bookmarks: [
        {
          id: 'b1',
          name: 'Old',
          service: 'APP',
          appName: 'Old',
          path: '',
          link: 'qortal://APP/Old',
          folderId: null,
          createdAt: 5,
          updatedAt: 5,
        },
      ],
      updatedAt: 5,
    };
    const result = move(organization({ folders: [library] }), bookmarks);

    expect(result.data.bookmarks.map((bookmark) => bookmark.id)).toEqual([
      'b1',
      'b2',
    ]);
  });

  it('pins private apps and moves nothing else for them', () => {
    const result = move(
      organization({
        folders: [
          {
            id: 'folder_3',
            name: 'Private',
            order: 0,
            row: 0,
            tabKeys: ['APP|alice|pinnic', 'internal:q-chat'],
          },
        ],
        savedTabs: {
          'APP|alice|pinnic': {
            isPrivate: true,
            privateAppProperties: {
              name: 'alice',
              service: 'APP',
              identifier: 'pinnic',
              appName: 'Pinnic',
            },
          },
        },
      })
    );

    expect(result.data.bookmarks).toEqual([]);
    expect(result.data.folders.map((folder) => folder.name)).toEqual([
      'Private',
    ]);
    expect(result.pins).toEqual([
      expect.objectContaining({
        isPrivate: true,
        privateAppProperties: expect.objectContaining({ appName: 'Pinnic' }),
      }),
    ]);
    expect(result.moved).toBe(1);
  });
});
