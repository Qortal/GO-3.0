import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';

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

import {
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../../atoms/global';
import { setPinnedAppsAccount } from '../../../utils/pinnedAppsStorage';
import { APP_BOOKMARKS_STORAGE_KEY } from '../../Apps/AppBookmarks/bookmarkStorage';
import type { LauncherView } from '../../Apps/AppsLauncher/launcherItems';
import { launcherEditsAtom } from '../../Apps/AppsLauncher/launcherQdnSync';
import { mobileTabOrganizationStateAtom } from '../mobileTabOrganizationStore';
import {
  ensureGoBookmarksLoaded,
  ensureGoLauncherReady,
  goBookmarksStateAtom,
  readGoBookmarksSettled,
  reloadGoBookmarks,
  saveGoBookmarks,
  settlePinList,
  writeGoBookmarksInOrder,
} from './goLauncherStore';

const ADDRESS = 'QPhone';
const ORG_KEY = `hub_mobile_tab_org_${ADDRESS}`;

const bookmarkStore = new Map<string, unknown>();
let failReads = false;

const legacyFolders = () => ({
  folders: [
    {
      id: 'folder_1',
      name: 'Library',
      order: 0,
      row: 1,
      size: 'small',
      tabKeys: ['APP|Q-Tube', 'APP|alice|pinnic'],
    },
  ],
  tabOverrides: {},
  tabFolderMap: { 'APP|Q-Tube': 'folder_1', 'APP|alice|pinnic': 'folder_1' },
  savedTabs: {
    'APP|Q-Tube': { service: 'APP', name: 'Q-Tube', label: 'Q-Tube' },
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
  folderRowCount: 2,
});

const storedBookmarks = () =>
  (bookmarkStore.get(APP_BOOKMARKS_STORAGE_KEY) as Record<string, any>)?.[
    ADDRESS
  ];

const setUp = () => {
  const store = createStore();
  store.set(sortablePinnedAppsAtom, [{ name: 'Q-Mail', service: 'APP' }]);
  const views: LauncherView[] = [];
  const setView = (_address: string, view: LauncherView) => views.push(view);
  return { store, views, setView };
};

beforeEach(() => {
  prefs.clear();
  bookmarkStore.clear();
  localStorage.clear();
  failReads = false;
  setPinnedAppsAccount(ADDRESS);
  vi.stubGlobal('appStorage', {
    get: async (key: string) => {
      if (failReads) throw new Error('no storage');
      return structuredClone(bookmarkStore.get(key));
    },
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

describe('ensureGoLauncherReady', () => {
  it("moves GO's Tabs folders into bookmark folders, once", async () => {
    prefs.set(ORG_KEY, legacyFolders());
    const { store, views, setView } = setUp();

    await ensureGoLauncherReady(store, ADDRESS, {
      setView,
      pinListSettled: true,
      now: () => 50,
    });

    const saved = storedBookmarks();
    expect(saved.folders).toEqual([
      { id: 'folder_1', name: 'Library', createdAt: 50, updatedAt: 50 },
    ]);
    expect(saved.bookmarks).toEqual([
      expect.objectContaining({
        appName: 'Q-Tube',
        folderId: 'folder_1',
        path: '',
      }),
    ]);
    expect(views).toEqual([{ order: ['folder:folder_1'], openFolders: [] }]);
    // Q-Tube's start page is pinned too; the private app is pinned instead.
    expect(store.get(sortablePinnedAppsAtom)).toEqual([
      { name: 'Q-Mail', service: 'APP' },
      { name: 'Q-Tube', service: 'APP' },
      expect.objectContaining({ isPrivate: true }),
    ]);
    expect(
      JSON.parse(localStorage.getItem(`ext_saved_settings:${ADDRESS}`)!)
        .sortablePinnedApps
    ).toHaveLength(3);
    expect(store.get(settingsLocalLastUpdatedAtom)).toBeGreaterThan(0);

    const organization = store.get(mobileTabOrganizationStateAtom).organization;
    expect(organization.movedToBookmarks).toBe(true);
    expect(organization.folderLooks).toEqual({
      folder_1: { size: 'small', row: 1 },
    });
    // The old folders stay as they were, kept and no longer read.
    expect(organization.folders).toHaveLength(1);
    // The move is offered to be saved to QDN.
    expect(store.get(launcherEditsAtom)).toEqual({
      address: ADDRESS,
      count: 1,
    });

    // A second start does not move them again.
    const again = setUp();
    await ensureGoLauncherReady(again.store, ADDRESS, {
      setView: again.setView,
      pinListSettled: true,
    });
    expect(again.views).toEqual([]);
    expect(storedBookmarks().bookmarks).toHaveLength(1);
  });

  it('holds the pins back until the pin list on QDN was read', async () => {
    prefs.set(ORG_KEY, legacyFolders());
    const { store, setView } = setUp();

    await ensureGoLauncherReady(store, ADDRESS, {
      setView,
      pinListSettled: false,
    });

    expect(store.get(sortablePinnedAppsAtom)).toEqual([
      { name: 'Q-Mail', service: 'APP' },
    ]);
    expect(
      store.get(mobileTabOrganizationStateAtom).organization.pendingPins
    ).toHaveLength(2);

    // The sign-in read replaced the list with the one saved on QDN.
    store.set(sortablePinnedAppsAtom, [{ name: 'Q-Blog', service: 'APP' }]);
    await settlePinList(store, ADDRESS);

    expect(store.get(sortablePinnedAppsAtom)).toEqual([
      { name: 'Q-Blog', service: 'APP' },
      { name: 'Q-Tube', service: 'APP' },
      expect.objectContaining({ isPrivate: true }),
    ]);
    expect(
      store.get(mobileTabOrganizationStateAtom).organization.pendingPins
    ).toBeUndefined();
  });

  it('only marks an account without Tabs folders as moved', async () => {
    const { store, views, setView } = setUp();

    await ensureGoLauncherReady(store, ADDRESS, {
      setView,
      pinListSettled: true,
    });

    expect(
      store.get(mobileTabOrganizationStateAtom).organization.movedToBookmarks
    ).toBe(true);
    expect(views).toEqual([]);
    expect(storedBookmarks()).toBeUndefined();
    expect(store.get(launcherEditsAtom).count).toBe(0);
  });

  it('moves nothing while the bookmarks cannot be read, and tries again', async () => {
    prefs.set(ORG_KEY, legacyFolders());
    failReads = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, setView } = setUp();

    await ensureGoLauncherReady(store, ADDRESS, {
      setView,
      pinListSettled: true,
    });
    expect(
      store.get(mobileTabOrganizationStateAtom).organization.movedToBookmarks
    ).toBeUndefined();

    failReads = false;
    await ensureGoLauncherReady(store, ADDRESS, {
      setView,
      pinListSettled: true,
    });
    expect(
      store.get(mobileTabOrganizationStateAtom).organization.movedToBookmarks
    ).toBe(true);
    expect(storedBookmarks().folders).toHaveLength(1);
  });
});

describe('saveGoBookmarks', () => {
  it('shows a change at once and writes changes in the order they were made', async () => {
    const store = createStore();
    const first = { folders: [], bookmarks: [], updatedAt: 1 };
    const second = {
      folders: [{ id: 'f', name: 'F', createdAt: 1, updatedAt: 1 }],
      bookmarks: [],
      updatedAt: 2,
    };

    const writes = [
      saveGoBookmarks(store, ADDRESS, first),
      saveGoBookmarks(store, ADDRESS, second),
    ];
    expect(store.get(goBookmarksStateAtom)).toEqual({
      address: ADDRESS,
      data: second,
      ready: true,
    });
    // A read while the writes are on their way would bring an old state back.
    await reloadGoBookmarks(store, ADDRESS);
    expect(store.get(goBookmarksStateAtom).data).toBe(second);

    await Promise.all(writes);
    expect(storedBookmarks().folders).toEqual(second.folders);
  });
});

describe("the saved apps' reads and writes of the bookmarks", () => {
  const folderNamed = (id: string) => ({
    folders: [{ id, name: id, createdAt: 1, updatedAt: 1 }],
    bookmarks: [],
    updatedAt: 1,
  });

  it('reads the bookmarks once the writes made here have landed', async () => {
    const store = createStore();
    const writing = saveGoBookmarks(store, ADDRESS, folderNamed('mine'));

    const read = await readGoBookmarksSettled(store, ADDRESS);

    expect(read.folders.map((folder) => folder.id)).toEqual(['mine']);
    await writing;
  });

  it("writes after this phone's own writes, and shows what it wrote", async () => {
    const store = createStore();
    store.set(goBookmarksStateAtom, {
      address: ADDRESS,
      data: folderNamed('before'),
      ready: true,
    });
    const own = saveGoBookmarks(store, ADDRESS, folderNamed('mine'));

    const stored = await writeGoBookmarksInOrder(
      store,
      ADDRESS,
      folderNamed('merged')
    );
    await own;

    expect(stored.folders.map((folder) => folder.id)).toEqual(['merged']);
    expect(storedBookmarks().folders.map((f: any) => f.id)).toEqual(['merged']);
    expect(
      store.get(goBookmarksStateAtom).data?.folders.map((folder) => folder.id)
    ).toEqual(['merged']);
  });

  it("doesn't show another account's bookmarks", async () => {
    const store = createStore();
    store.set(goBookmarksStateAtom, {
      address: 'QOther',
      data: folderNamed('other'),
      ready: true,
    });

    await writeGoBookmarksInOrder(store, ADDRESS, folderNamed('merged'));

    expect(store.get(goBookmarksStateAtom).address).toBe('QOther');
    expect(storedBookmarks().folders.map((f: any) => f.id)).toEqual(['merged']);
  });

  it('fails when it could not write, and shows what is stored', async () => {
    const store = createStore();
    bookmarkStore.set(APP_BOOKMARKS_STORAGE_KEY, {
      [ADDRESS]: folderNamed('stored'),
    });
    store.set(goBookmarksStateAtom, {
      address: ADDRESS,
      data: folderNamed('stored'),
      ready: true,
    });
    vi.stubGlobal('appStorage', {
      get: async (key: string) => structuredClone(bookmarkStore.get(key)),
      set: async () => {
        throw new Error('storage full');
      },
      delete: async () => undefined,
    });

    await expect(
      writeGoBookmarksInOrder(store, ADDRESS, folderNamed('merged'))
    ).rejects.toThrow('storage full');

    await waitForState(() =>
      store
        .get(goBookmarksStateAtom)
        .data?.folders.map((folder) => folder.id)
        .join()
    ).toBe('stored');
  });

  it("doesn't put back what a read found before a write landed", async () => {
    const store = createStore();
    bookmarkStore.set(APP_BOOKMARKS_STORAGE_KEY, {
      [ADDRESS]: folderNamed('old'),
    });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstRead = true;
    vi.stubGlobal('appStorage', {
      get: async (key: string) => {
        const value = structuredClone(bookmarkStore.get(key));
        if (firstRead) {
          firstRead = false;
          await gate;
        }
        return value;
      },
      set: async (key: string, value: unknown) => {
        bookmarkStore.set(key, structuredClone(value));
      },
      delete: async () => undefined,
    });

    const loading = ensureGoBookmarksLoaded(store, ADDRESS);
    await writeGoBookmarksInOrder(store, ADDRESS, folderNamed('merged'));
    release();
    await loading;

    expect(
      store.get(goBookmarksStateAtom).data?.folders.map((folder) => folder.id)
    ).toEqual(['merged']);
  });
});

/** Waits until `read` answers what `toBe` expects, or fails like expect. */
const waitForState = (read: () => unknown) => ({
  toBe: async (expected: unknown) => {
    for (let tries = 0; tries < 50 && read() !== expected; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(read()).toBe(expected);
  },
});
