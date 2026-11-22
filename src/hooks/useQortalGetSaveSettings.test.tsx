import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';

const qdn = vi.hoisted(() => ({ settings: null as unknown }));
/** Whether this runs as GO on a phone, with GO's encrypted storage. */
const phone = vi.hoisted(() => ({ on: false }));
const prefs = vi.hoisted(() => new Map<string, unknown>());

vi.mock('../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://127.0.0.1:12391',
  getArbitraryEndpointReact: () => '/arbitrary/resources/searchsimple',
}));
vi.mock('../components/Group/groupDataPublishes', () => ({
  decryptResource: async () => ({ data: '' }),
}));
vi.mock('../encryption/encryption', () => ({
  base64ToUint8Array: () => new Uint8Array(),
  uint8ArrayToObject: () => qdn.settings,
}));
vi.mock('../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isGoApp: () => phone.on,
}));
vi.mock('../utils/chromeStorage', () => ({
  getData: vi.fn(async (key: string) =>
    prefs.has(key) ? structuredClone(prefs.get(key)) : null
  ),
  storeData: vi.fn(async (key: string, value: unknown) => {
    prefs.set(key, structuredClone(value));
    return 'Data saved successfully';
  }),
}));
vi.mock('../components/Chat/MessageDisplay', () => ({
  extractComponents: vi.fn(),
}));

import { useQortalGetSaveSettings } from './useQortalGetSaveSettings';
import { useRetrieveDataLocalStorage } from './useRetrieveDataLocalStorage';
import {
  canSaveSettingToQdnAtom,
  sortablePinnedAppsAtom,
} from '../atoms/global';
import { saveToLocalStorage } from '../components/Apps/AppsNavBarDesktop';
import { setPinnedAppsAccount } from '../utils/pinnedAppsStorage';
import {
  emptySavedApps,
  olderFieldsOf,
  readSavedApps,
  recordStores,
  type SavedApps,
  toSavedAppsField,
} from '../components/Apps/AppsLauncher/savedApps';
import {
  savedAppsBaseKey,
  savedAppsReplicaKey,
  savedAppsStateAtom,
} from '../components/Apps/AppsLauncher/savedAppsSync';
import { loadLauncherView } from '../components/Apps/AppsLauncher/launcherItems';
import { APP_BOOKMARKS_STORAGE_KEY } from '../components/Apps/AppBookmarks/bookmarkStorage';
import {
  goSavedAppsWritesDone,
  resetGoSavedAppsStorage,
} from '../components/Mobile/goLauncher/goSavedAppsStorage';
import {
  forgetSettingsCopies,
  rememberedSettingsCopy,
} from './qdnSettingsCopy';

const pins = (...names: string[]) =>
  names.map((name) => ({ name, service: 'APP' }));

/** The account's settings on QDN, published `updated` ms since the epoch. */
const settingsOnQdn = (updated: number, settings: Record<string, unknown>) => {
  qdn.settings = settings;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('identifier=ext_saved_settings')
        ? ({ ok: true, json: async () => [{ updated }] } as Response)
        : ({ ok: true, text: async () => 'encrypted' } as Response)
    )
  );
};

const publishedOnQdn = (updated: number, sortablePinnedApps: unknown) =>
  settingsOnQdn(updated, { sortablePinnedApps });

/** A copy saved by a Hub that knows saved apps. */
const copyOf = (apps: SavedApps) => ({
  ...olderFieldsOf(apps),
  savedApps: toSavedAppsField(apps),
});

/** What this device saved locally for an account, through the real helper. */
const savedLocally = (address: string, sortablePinnedApps: unknown) => {
  setPinnedAppsAccount(address);
  saveToLocalStorage(
    'ext_saved_settings',
    'sortablePinnedApps',
    sortablePinnedApps
  );
  setPinnedAppsAccount(null);
};

/** The device's bookmarks store, as the desktop app keeps it. */
const bookmarkStore = new Map<string, unknown>();

/** Signs in and waits until the QDN answer has been handled. */
const signIn = async (address: string, name: string) => {
  const store = createStore();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  renderHook(
    () => {
      useRetrieveDataLocalStorage(address);
      useQortalGetSaveSettings(name, true, address);
    },
    { wrapper }
  );
  await waitFor(() => expect(store.get(canSaveSettingToQdnAtom)).toBe(true));
  return store;
};

const bookmarksOf = (address: string) =>
  (bookmarkStore.get(APP_BOOKMARKS_STORAGE_KEY) as Record<string, any>)?.[
    address
  ];

beforeEach(() => {
  localStorage.clear();
  bookmarkStore.clear();
  prefs.clear();
  phone.on = false;
  forgetSettingsCopies();
  resetGoSavedAppsStorage();
  vi.stubGlobal('appStorage', {
    get: async (key: string) => structuredClone(bookmarkStore.get(key)),
    set: async (key: string, value: unknown) => {
      bookmarkStore.set(key, structuredClone(value));
    },
    delete: async (key: string) => {
      bookmarkStore.delete(key);
    },
  });
});
afterEach(() => {
  setPinnedAppsAccount(null);
  vi.unstubAllGlobals();
});

describe('useQortalGetSaveSettings at sign-in', () => {
  it('restores the QDN pins after a Revert', async () => {
    publishedOnQdn(Date.now() - 60_000, pins('Saved on QDN'));
    // Revert, as Save does it: no list, and a timestamp newer than QDN's.
    savedLocally('QAlice', null);

    const store = await signIn('QAlice', 'Alice');
    await waitFor(() =>
      expect(store.get(sortablePinnedAppsAtom)).toEqual(pins('Saved on QDN'))
    );
  });

  it('keeps a local list emptied after the QDN publish', async () => {
    publishedOnQdn(Date.now() - 60_000, pins('Saved on QDN'));
    savedLocally('QAlice', []);

    const store = await signIn('QAlice', 'Alice');
    await waitFor(() =>
      expect(store.get(savedAppsStateAtom).status).toBe('read')
    );
    expect(store.get(sortablePinnedAppsAtom)).toEqual([]);
  });

  it('takes the QDN pins over an older local list', async () => {
    savedLocally('QAlice', pins('Older on this device'));
    publishedOnQdn(Date.now() + 60_000, pins('Saved on QDN'));

    const store = await signIn('QAlice', 'Alice');
    await waitFor(() =>
      expect(store.get(sortablePinnedAppsAtom)).toEqual(pins('Saved on QDN'))
    );
  });

  it('takes in the bookmarks, folders and order saved by the desktop Hub', async () => {
    settingsOnQdn(Date.now() - 60_000, {
      sortablePinnedApps: pins('Q-Tube'),
      appBookmarks: {
        version: 1,
        folders: [{ id: 'f1', name: 'Media', createdAt: 1, updatedAt: 1 }],
        bookmarks: [
          {
            id: 'b1',
            name: 'Q-Tube',
            service: 'APP',
            appName: 'Q-Tube',
            path: '',
            folderId: 'f1',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      launcherOrder: ['folder:f1'],
    });

    const store = await signIn('QAlice', 'Alice');

    await waitFor(() =>
      expect(store.get(savedAppsStateAtom)).toMatchObject({
        address: 'QAlice',
        status: 'read',
        hasCopy: true,
      })
    );
    const stored = bookmarksOf('QAlice');
    expect(stored.folders.map((folder: any) => folder.name)).toEqual(['Media']);
    expect(stored.bookmarks[0]).toMatchObject({
      id: 'b1',
      folderId: 'f1',
      link: 'qortal://APP/Q-Tube',
    });
    expect(loadLauncherView('QAlice').order).toEqual(['folder:f1']);
  });

  it('leaves the bookmarks alone when the settings have none', async () => {
    bookmarkStore.set(APP_BOOKMARKS_STORAGE_KEY, {
      QAlice: {
        folders: [{ id: 'f9', name: 'Mine', createdAt: 1, updatedAt: 1 }],
        bookmarks: [],
        updatedAt: 5,
      },
    });
    // Saved by an older Hub or GO: the pin list only.
    publishedOnQdn(Date.now() - 60_000, pins('Saved on QDN'));

    const store = await signIn('QAlice', 'Alice');

    await waitFor(() =>
      expect(store.get(savedAppsStateAtom).status).toBe('read')
    );
    expect(bookmarksOf('QAlice').folders.map((f: any) => f.id)).toEqual(['f9']);
  });

  it('takes in a newer copy item by item, with a removal made on another device', async () => {
    // Real times: removals older than 180 days aren't kept.
    const hourAgo = Date.now() - 3_600_000;
    const before = recordStores(
      emptySavedApps(),
      { pins: pins('Q-Tube', 'Q-Mail'), data: null, order: null },
      () => hourAgo
    ).apps;
    settingsOnQdn(hourAgo, copyOf(before));
    await signIn('QAlice', 'Alice');

    // Another device removed Q-Mail and pinned Q-Share, then saved.
    const after = recordStores(
      before,
      { pins: pins('Q-Tube', 'Q-Share'), data: null, order: null },
      () => hourAgo + 1000
    ).apps;
    settingsOnQdn(hourAgo + 2000, copyOf(after));
    const store = await signIn('QAlice', 'Alice');

    await waitFor(() =>
      expect(store.get(sortablePinnedAppsAtom)).toEqual(
        pins('Q-Tube', 'Q-Share')
      )
    );
  });

  it("keeps the copy it read, so a save keeps the fields GO doesn't write", async () => {
    const homeLayout = { v: 1, layout: { hidden: ['feed'] }, changedAt: 70 };
    const updated = Date.now() - 60_000;
    settingsOnQdn(updated, { sortablePinnedApps: pins('Q-Tube'), homeLayout });

    await signIn('QAlice', 'Alice');

    await waitFor(() =>
      expect(rememberedSettingsCopy('QAlice')).toEqual({
        settings: { sortablePinnedApps: pins('Q-Tube'), homeLayout },
        updated,
      })
    );
  });
});

describe('useQortalGetSaveSettings on a phone', () => {
  const ADDRESS = 'QPhone';

  beforeEach(() => {
    phone.on = true;
    // GO on a phone keeps the bookmarks in its own storage.
    vi.stubGlobal('appStorage', undefined);
  });

  it("moves GO's old Tabs folders first, merges QDN's saved apps, then adds the pins the move held back", async () => {
    savedLocally(ADDRESS, pins('Q-Mail'));
    prefs.set(`hub_mobile_tab_org_${ADDRESS}`, {
      folders: [
        {
          id: 'folder_1',
          name: 'Library',
          order: 0,
          tabKeys: ['APP|Q-Tube'],
        },
      ],
      tabOverrides: {},
      tabFolderMap: { 'APP|Q-Tube': 'folder_1' },
      savedTabs: {
        'APP|Q-Tube': { service: 'APP', name: 'Q-Tube', label: 'Q-Tube' },
      },
      folderRowCount: 1,
    });
    // A desktop Hub saved Q-Mail and Q-Share, and a folder with Q-Blog.
    const hourAgo = Date.now() - 3_600_000;
    const onHub = recordStores(
      emptySavedApps(),
      {
        pins: pins('Q-Mail', 'Q-Share'),
        data: {
          folders: [{ id: 'f1', name: 'Media', createdAt: 1, updatedAt: 1 }],
          bookmarks: [
            {
              id: 'b1',
              name: 'Q-Blog',
              service: 'APP',
              appName: 'Q-Blog',
              path: '',
              link: 'qortal://APP/Q-Blog',
              folderId: 'f1',
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
        order: ['APP-Q-Mail', 'APP-Q-Share', 'folder:f1'],
      },
      () => hourAgo
    ).apps;
    settingsOnQdn(Date.now() + 60_000, copyOf(onHub));

    const store = await signIn(ADDRESS, 'Phone');

    // QDN's newer pin list, then Q-Tube from the moved folder.
    await waitFor(() =>
      expect(store.get(sortablePinnedAppsAtom)).toEqual(
        pins('Q-Mail', 'Q-Share', 'Q-Tube')
      )
    );
    const bookmarks = (prefs.get(APP_BOOKMARKS_STORAGE_KEY) as any)[ADDRESS];
    expect(bookmarks.folders.map((folder: any) => folder.name).sort()).toEqual([
      'Library',
      'Media',
    ]);
    expect(
      bookmarks.bookmarks.map((bookmark: any) => bookmark.appName).sort()
    ).toEqual(['Q-Blog', 'Q-Tube']);

    // This phone's records are in GO's encrypted storage, not localStorage.
    await goSavedAppsWritesDone();
    expect(localStorage.getItem(savedAppsReplicaKey(ADDRESS))).toBeNull();
    expect(localStorage.getItem(savedAppsBaseKey(ADDRESS))).toBeNull();
    const replica = readSavedApps(
      JSON.parse(prefs.get(savedAppsReplicaKey(ADDRESS)) as string)
    );
    expect([...replica!.folders.keys()]).toEqual(
      expect.arrayContaining(['f1', 'folder_1'])
    );
    expect(prefs.get(savedAppsBaseKey(ADDRESS))).toEqual(expect.any(String));
  });
});
