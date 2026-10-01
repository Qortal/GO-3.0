import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';

const storage = vi.hoisted(() => new Map<string, unknown>());

vi.mock('../../utils/chromeStorage', () => ({
  getData: vi.fn(async (key: string) =>
    storage.has(key) ? structuredClone(storage.get(key)) : null
  ),
  storeData: vi.fn(async (key: string, value: unknown) => {
    storage.set(key, structuredClone(value));
    return 'Data saved successfully';
  }),
}));

import { libraryAppToOpenTab } from './mobileTabOrganization';
import {
  ensureMobileTabOrganizationLoaded,
  mobileTabOrganizationStateAtom,
  tabKeyFolderNameAtomFamily,
  toggleLibraryFolderPin,
  updateMobileTabOrganization,
} from './mobileTabOrganizationStore';

const WALLET = 'QWallet1';
const STORAGE_KEY = `hub_mobile_tab_org_${WALLET}`;
const blog = libraryAppToOpenTab({ name: 'Q-Blog', service: 'APP' })!;
const site = libraryAppToOpenTab({ name: 'MySite', service: 'WEBSITE' })!;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('toggleLibraryFolderPin', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('creates the Library folder next to stored folders and saves it', async () => {
    storage.set(STORAGE_KEY, {
      folders: [{ id: 'f1', name: 'Games', order: 0, row: 0, tabKeys: [] }],
      tabOverrides: {},
      tabFolderMap: {},
      savedTabs: {},
      folderRowCount: 1,
    });
    const store = createStore();

    const result = await toggleLibraryFolderPin(store, WALLET, blog);
    await flush();

    expect(result).toEqual({ pinned: true, folderName: 'Library' });
    const saved = storage.get(STORAGE_KEY) as any;
    expect(saved.folders.map((f: any) => f.name)).toEqual(['Games', 'Library']);
    expect(saved.folders[1].tabKeys).toEqual(['APP|Q-Blog']);
    expect(store.get(tabKeyFolderNameAtomFamily('APP|Q-Blog'))).toBe('Library');
  });

  it('adds later pins to the same folder and unpins on a second tap', async () => {
    const store = createStore();
    await toggleLibraryFolderPin(store, WALLET, blog);
    await toggleLibraryFolderPin(store, WALLET, site);

    let { organization } = store.get(mobileTabOrganizationStateAtom);
    expect(organization.folders).toHaveLength(1);
    expect(organization.folders[0].tabKeys).toEqual([
      'APP|Q-Blog',
      'WEBSITE|MySite',
    ]);

    const result = await toggleLibraryFolderPin(store, WALLET, blog);
    expect(result).toEqual({ pinned: false, folderName: 'Library' });
    ({ organization } = store.get(mobileTabOrganizationStateAtom));
    expect(organization.folders[0].tabKeys).toEqual(['WEBSITE|MySite']);
    expect(store.get(tabKeyFolderNameAtomFamily('APP|Q-Blog'))).toBeNull();
  });

  it('unpins an app from the user folder it already lives in', async () => {
    storage.set(STORAGE_KEY, {
      folders: [
        { id: 'f1', name: 'Games', order: 0, row: 0, tabKeys: ['APP|Q-Blog'] },
      ],
      tabOverrides: {},
      tabFolderMap: { 'APP|Q-Blog': 'f1' },
      savedTabs: { 'APP|Q-Blog': { name: 'Q-Blog', service: 'APP' } },
      folderRowCount: 1,
    });
    const store = createStore();
    await ensureMobileTabOrganizationLoaded(store, WALLET);
    expect(store.get(tabKeyFolderNameAtomFamily('APP|Q-Blog'))).toBe('Games');

    const result = await toggleLibraryFolderPin(store, WALLET, blog);
    expect(result).toEqual({ pinned: false, folderName: 'Games' });
    const { organization } = store.get(mobileTabOrganizationStateAtom);
    expect(organization.folders.map((f) => f.name)).toEqual(['Games']);
    expect(organization.folders[0].tabKeys).toEqual([]);
  });

  it('waits for the stored folders before pinning', async () => {
    storage.set(STORAGE_KEY, {
      folders: [{ id: 'f1', name: 'Games', order: 0, row: 0, tabKeys: [] }],
      tabOverrides: {},
      tabFolderMap: {},
      savedTabs: {},
      folderRowCount: 1,
    });
    const store = createStore();
    // The overlay starts its load; the pin arrives before it resolves.
    const load = ensureMobileTabOrganizationLoaded(store, WALLET);
    const pin = toggleLibraryFolderPin(store, WALLET, blog);
    await Promise.all([load, pin]);

    const { organization, ready } = store.get(mobileTabOrganizationStateAtom);
    expect(ready).toBe(true);
    expect(organization.folders.map((f) => f.name)).toEqual([
      'Games',
      'Library',
    ]);
  });

  it('keeps edits made through the overlay path', async () => {
    const store = createStore();
    await ensureMobileTabOrganizationLoaded(store, WALLET);
    updateMobileTabOrganization(store, WALLET, (prev) => ({
      ...prev,
      folders: [{ id: 'f1', name: 'Games', order: 0, row: 0, tabKeys: [] }],
    }));
    await toggleLibraryFolderPin(store, WALLET, blog);

    const { organization } = store.get(mobileTabOrganizationStateAtom);
    expect(organization.folders.map((f) => f.name)).toEqual([
      'Games',
      'Library',
    ]);
  });
});
