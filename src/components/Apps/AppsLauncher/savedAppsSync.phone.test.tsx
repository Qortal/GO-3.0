import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';

/** GO's encrypted storage on the phone. */
const prefs = vi.hoisted(() => new Map<string, unknown>());

vi.mock('../../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isGoApp: () => true,
}));
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

import { sortablePinnedAppsAtom } from '../../../atoms/global';
import {
  savePinnedAppsFor,
  setPinnedAppsAccount,
} from '../../../utils/pinnedAppsStorage';
import { APP_BOOKMARKS_STORAGE_KEY } from '../AppBookmarks/bookmarkStorage';
import type {
  AppBookmark,
  AppBookmarkFolder,
  AppBookmarksForAddress,
} from '../AppBookmarks/bookmarkTypes';
import {
  goSavedAppsWritesDone,
  resetGoSavedAppsStorage,
} from '../../Mobile/goLauncher/goSavedAppsStorage';
import { loadLauncherView, saveLauncherView } from './launcherItems';
import { launcherSyncMarkKey, saveLauncherSyncMark } from './launcherQdn';
import {
  emptySavedApps,
  isRemoved,
  olderFieldsOf,
  readSavedApps,
  recordStores,
  type SavedApps,
  toSavedAppsField,
} from './savedApps';
import {
  savedAppsBaseKey,
  savedAppsReplicaKey,
  savedAppsStateAtom,
  useHasUnsavedSavedApps,
  useSavedAppsSync,
} from './savedAppsSync';

const ADDRESS = 'QPhone';
const HOUR_AGO = Date.now() - 3_600_000;

const pin = (name: string) => ({ name, service: 'APP' });

const folder = (id: string, name: string): AppBookmarkFolder => ({
  id,
  name,
  createdAt: 1,
  updatedAt: 1,
});

const bookmark = (
  id: string,
  appName: string,
  folderId: string | null
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
});

const data = (
  folders: AppBookmarkFolder[],
  bookmarks: AppBookmark[]
): AppBookmarksForAddress => ({ folders, bookmarks, updatedAt: 1 });

/** What a desktop Hub saved: Q-Tube pinned, and Q-Blog in a folder. */
const onQdn = (): SavedApps =>
  recordStores(
    emptySavedApps(),
    {
      pins: [pin('Q-Tube')],
      data: data([folder('f1', 'Media')], [bookmark('b1', 'Q-Blog', 'f1')]),
      order: ['APP-Q-Tube', 'folder:f1'],
    },
    () => HOUR_AGO
  ).apps;

const copyOf = (apps: SavedApps) => ({
  ...olderFieldsOf(apps),
  savedApps: toSavedAppsField(apps),
});

/** The phone's bookmarks as GO keeps them. */
const storedBookmarks = () =>
  (prefs.get(APP_BOOKMARKS_STORAGE_KEY) as Record<string, any> | undefined)?.[
    ADDRESS
  ];

const render = () => {
  const store = createStore();
  store.set(sortablePinnedAppsAtom, [pin('Q-Tube')] as never);
  const { result } = renderHook(() => useSavedAppsSync(), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
  return { store, sync: result.current };
};

beforeEach(() => {
  localStorage.clear();
  prefs.clear();
  resetGoSavedAppsStorage();
  setPinnedAppsAccount(ADDRESS);
  savePinnedAppsFor(ADDRESS, [pin('Q-Tube')]);
});
afterEach(() => {
  setPinnedAppsAccount(null);
});

describe('saved apps on a phone', () => {
  it("keeps what it records in GO's encrypted storage, and reads it back in a new run", async () => {
    const { sync } = render();

    await act(async () => {
      await sync.takeIn(ADDRESS, {
        settings: copyOf(onQdn()),
        updated: HOUR_AGO,
      });
    });
    await goSavedAppsWritesDone();

    expect(localStorage.getItem(savedAppsReplicaKey(ADDRESS))).toBeNull();
    expect(localStorage.getItem(savedAppsBaseKey(ADDRESS))).toBeNull();
    const replica = readSavedApps(
      JSON.parse(prefs.get(savedAppsReplicaKey(ADDRESS)) as string)
    );
    expect([...replica!.bookmarks.keys()]).toEqual(['APP|q-blog||']);
    expect(storedBookmarks().folders.map((entry: any) => entry.name)).toEqual([
      'Media',
    ]);

    // A new run reads the records back: QDN's copy isn't taken in again.
    resetGoSavedAppsStorage();
    const next = render();
    let base: unknown;
    await act(async () => {
      base = await next.sync.readBase(ADDRESS);
    });
    expect(base).toMatchObject({ updated: HOUR_AGO, hasCopy: true });
  });

  it('counts the folders and bookmarks as unsaved, as the desktop app does', async () => {
    const { store, sync } = render();
    await act(async () => {
      await sync.takeIn(ADDRESS, {
        settings: copyOf(onQdn()),
        updated: HOUR_AGO,
      });
    });

    const shown = (bookmarks: AppBookmarksForAddress) =>
      renderHook(() => useHasUnsavedSavedApps(ADDRESS, bookmarks), {
        wrapper: ({ children }) => (
          <Provider store={store}>{children}</Provider>
        ),
      }).result.current;

    expect(store.get(savedAppsStateAtom).status).toBe('read');
    expect(shown(storedBookmarks())).toBe(false);
    // The folder renamed on the phone.
    expect(
      shown({
        ...storedBookmarks(),
        folders: [folder('f1', 'Videos')],
      })
    ).toBe(true);
  });

  it('starts again from QDN when its bookmarks were lost, instead of removing them everywhere', async () => {
    // This phone took QDN's copy in before.
    const { sync } = render();
    await act(async () => {
      await sync.takeIn(ADDRESS, {
        settings: copyOf(onQdn()),
        updated: HOUR_AGO,
      });
    });
    await goSavedAppsWritesDone();
    saveLauncherSyncMark(ADDRESS, { savedAt: HOUR_AGO, localAt: 1 });
    expect(loadLauncherView(ADDRESS).order).toContain('folder:f1');

    // GO's encrypted storage can't be read any more: the bookmarks and the
    // records are gone; the launcher's order in localStorage is not.
    prefs.clear();
    resetGoSavedAppsStorage();
    const next = render();
    await act(async () => {
      await next.sync.takeIn(ADDRESS, {
        settings: copyOf(onQdn()),
        updated: HOUR_AGO,
      });
    });
    await goSavedAppsWritesDone();

    expect(storedBookmarks().folders.map((entry: any) => entry.name)).toEqual([
      'Media',
    ]);
    expect(
      storedBookmarks().bookmarks.map((entry: any) => entry.appName)
    ).toEqual(['Q-Blog']);
    const replica = readSavedApps(
      JSON.parse(prefs.get(savedAppsReplicaKey(ADDRESS)) as string)
    );
    const removals = [
      ...replica!.folders.values(),
      ...replica!.bookmarks.values(),
    ].filter(isRemoved);
    expect(removals).toEqual([]);
    expect(localStorage.getItem(launcherSyncMarkKey(ADDRESS))).toBeTruthy();
  });

  it('starts again from QDN when only the bookmarks were lost', async () => {
    const { sync } = render();
    await act(async () => {
      await sync.takeIn(ADDRESS, {
        settings: copyOf(onQdn()),
        updated: HOUR_AGO,
      });
    });
    await goSavedAppsWritesDone();

    // The bookmarks' key alone can't be read; the records still can.
    prefs.delete(APP_BOOKMARKS_STORAGE_KEY);
    resetGoSavedAppsStorage();
    const next = render();
    let prepared: Awaited<ReturnType<typeof next.sync.forSave>> = null;
    await act(async () => {
      prepared = await next.sync.forSave(ADDRESS);
    });

    // Nothing of the folder or its bookmark is saved as removed.
    const removals = [
      ...prepared!.apps.folders.values(),
      ...prepared!.apps.bookmarks.values(),
    ].filter(isRemoved);
    expect(removals).toEqual([]);
  });

  it('leaves an emptied store alone: removing everything is a change', async () => {
    const { sync } = render();
    await act(async () => {
      await sync.takeIn(ADDRESS, {
        settings: copyOf(onQdn()),
        updated: HOUR_AGO,
      });
    });
    await goSavedAppsWritesDone();
    // Everything removed here, by hand: the account's entry stays.
    prefs.set(APP_BOOKMARKS_STORAGE_KEY, {
      [ADDRESS]: data([], []),
    });
    saveLauncherView(ADDRESS, { order: ['APP-Q-Tube'], openFolders: [] });

    resetGoSavedAppsStorage();
    const next = render();
    let prepared: Awaited<ReturnType<typeof next.sync.forSave>> = null;
    await act(async () => {
      prepared = await next.sync.forSave(ADDRESS);
    });

    expect(prepared!.apps.folders.get('f1')).toMatchObject({ removed: true });
    expect(prepared!.apps.bookmarks.get('APP|q-blog||')).toMatchObject({
      removed: true,
    });
  });
});
