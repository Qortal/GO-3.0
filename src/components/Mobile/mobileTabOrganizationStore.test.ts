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

import {
  ensureMobileTabOrganizationLoaded,
  mobileTabOrganizationStateAtom,
  updateMobileTabOrganization,
} from './mobileTabOrganizationStore';

const WALLET = 'QWallet1';
const STORAGE_KEY = `hub_mobile_tab_org_${WALLET}`;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const stored = (patch: Record<string, unknown> = {}) => ({
  folders: [{ id: 'f1', name: 'Games', order: 0, row: 0, tabKeys: [] }],
  tabOverrides: {},
  tabFolderMap: {},
  savedTabs: {},
  folderRowCount: 1,
  ...patch,
});

describe('mobileTabOrganizationStore', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('loads an account once and keeps what this phone saved', async () => {
    storage.set(
      STORAGE_KEY,
      stored({
        movedToBookmarks: true,
        folderLooks: { f1: { size: 'small', row: 1 } },
        pendingPins: [{ name: 'Q-Tube', service: 'APP' }],
      })
    );
    const store = createStore();

    await Promise.all([
      ensureMobileTabOrganizationLoaded(store, WALLET),
      ensureMobileTabOrganizationLoaded(store, WALLET),
    ]);

    const { organization, ready, walletAddress } = store.get(
      mobileTabOrganizationStateAtom
    );
    expect(ready).toBe(true);
    expect(walletAddress).toBe(WALLET);
    expect(organization.movedToBookmarks).toBe(true);
    expect(organization.folderLooks).toEqual({
      f1: { size: 'small', row: 1 },
    });
    expect(organization.pendingPins).toEqual([
      { name: 'Q-Tube', service: 'APP' },
    ]);
  });

  it('saves an edit and keeps it in the shared copy', async () => {
    const store = createStore();
    await ensureMobileTabOrganizationLoaded(store, WALLET);

    updateMobileTabOrganization(store, WALLET, (prev) => ({
      ...prev,
      tabOverrides: { 'APP|Q-Tube': { customLabel: 'Videos' } },
    }));
    await flush();

    expect(
      store.get(mobileTabOrganizationStateAtom).organization.tabOverrides
    ).toEqual({ 'APP|Q-Tube': { customLabel: 'Videos' } });
    expect((storage.get(STORAGE_KEY) as any).tabOverrides).toEqual({
      'APP|Q-Tube': { customLabel: 'Videos' },
    });
  });

  it('does not save when the edit changes nothing', async () => {
    const store = createStore();
    await ensureMobileTabOrganizationLoaded(store, WALLET);

    updateMobileTabOrganization(store, WALLET, (prev) => prev);
    await flush();

    expect(storage.has(STORAGE_KEY)).toBe(false);
  });

  it('starts empty for another account', async () => {
    storage.set(STORAGE_KEY, stored());
    const store = createStore();
    await ensureMobileTabOrganizationLoaded(store, WALLET);
    await ensureMobileTabOrganizationLoaded(store, 'QOther');

    const state = store.get(mobileTabOrganizationStateAtom);
    expect(state.walletAddress).toBe('QOther');
    expect(state.organization.folders).toEqual([]);
  });
});
