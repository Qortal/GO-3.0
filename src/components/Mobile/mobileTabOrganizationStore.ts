import { atom, type useStore } from 'jotai';
import { atomFamily } from 'jotai/utils';
import {
  addTabToNamedFolder,
  createFolderId,
  emptyOrganization,
  findFolderForTabKey,
  getOpenTabKey,
  LIBRARY_FOLDER_NAME,
  loadMobileTabOrganization,
  removeTabKeyFromFolders,
  saveMobileTabOrganization,
  type MobileTabOrganization,
} from './mobileTabOrganization';
import type { OpenTab } from './useOpenTabs';

type JotaiStore = ReturnType<typeof useStore>;

export type MobileTabOrganizationState = {
  walletAddress: string;
  organization: MobileTabOrganization;
  ready: boolean;
};

/**
 * The Tabs overlay folders for the signed-in wallet. Shared so screens outside
 * the overlay (the Q-Apps library pin) edit the same copy the overlay shows.
 */
export const mobileTabOrganizationStateAtom = atom<MobileTabOrganizationState>({
  walletAddress: '',
  organization: emptyOrganization(),
  ready: false,
});

/** Name of the folder holding this tab key, or null. Each row subscribes only to its own key. */
export const tabKeyFolderNameAtomFamily = atomFamily((tabKey: string) =>
  atom((get) => {
    const { organization, ready } = get(mobileTabOrganizationStateAtom);
    if (!ready || !tabKey) return null;
    return findFolderForTabKey(organization, tabKey)?.name ?? null;
  })
);

const pendingLoads = new WeakMap<
  JotaiStore,
  { walletAddress: string; promise: Promise<void> }
>();

export function ensureMobileTabOrganizationLoaded(
  store: JotaiStore,
  walletAddress: string
): Promise<void> {
  const state = store.get(mobileTabOrganizationStateAtom);
  if (state.walletAddress === walletAddress && state.ready) {
    return Promise.resolve();
  }
  const pending = pendingLoads.get(store);
  if (pending?.walletAddress === walletAddress) return pending.promise;

  if (state.walletAddress !== walletAddress) {
    store.set(mobileTabOrganizationStateAtom, {
      walletAddress,
      organization: emptyOrganization(),
      ready: false,
    });
  }
  const promise = loadMobileTabOrganization(walletAddress)
    .then((organization) => {
      // The account may have switched while storage was being read.
      if (
        store.get(mobileTabOrganizationStateAtom).walletAddress !==
        walletAddress
      ) {
        return;
      }
      store.set(mobileTabOrganizationStateAtom, {
        walletAddress,
        organization,
        ready: true,
      });
    })
    .finally(() => {
      if (pendingLoads.get(store)?.promise === promise) {
        pendingLoads.delete(store);
      }
    });
  pendingLoads.set(store, { walletAddress, promise });
  return promise;
}

/** Applies an update for this wallet and saves it. Returns the new organization. */
export function updateMobileTabOrganization(
  store: JotaiStore,
  walletAddress: string,
  updater: (prev: MobileTabOrganization) => MobileTabOrganization
): MobileTabOrganization {
  const state = store.get(mobileTabOrganizationStateAtom);
  const prev =
    state.walletAddress === walletAddress
      ? state.organization
      : emptyOrganization();
  const next = updater(prev);
  if (next === prev) return prev;
  store.set(mobileTabOrganizationStateAtom, {
    walletAddress,
    organization: next,
    ready: state.walletAddress === walletAddress ? state.ready : false,
  });
  if (walletAddress) {
    void saveMobileTabOrganization(walletAddress, next);
  }
  return next;
}

/**
 * The Q-Apps library pin on phones. An app already in any Tabs folder is
 * removed from it; otherwise it goes into the Library folder, which is
 * created on first use.
 */
export async function toggleLibraryFolderPin(
  store: JotaiStore,
  walletAddress: string,
  tab: OpenTab
): Promise<{ pinned: boolean; folderName: string }> {
  await ensureMobileTabOrganizationLoaded(store, walletAddress);
  const tabKey = getOpenTabKey(tab);
  let result = { pinned: false, folderName: LIBRARY_FOLDER_NAME };
  updateMobileTabOrganization(store, walletAddress, (prev) => {
    const current = findFolderForTabKey(prev, tabKey);
    if (current) {
      result = { pinned: false, folderName: current.name };
      return removeTabKeyFromFolders(prev, tabKey);
    }
    const added = addTabToNamedFolder(
      prev,
      tab,
      LIBRARY_FOLDER_NAME,
      createFolderId()
    );
    result = { pinned: true, folderName: added.folder.name };
    return added.organization;
  });
  return result;
}
