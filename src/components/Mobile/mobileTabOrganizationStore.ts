import { atom, type useStore } from 'jotai';
import {
  emptyOrganization,
  loadMobileTabOrganization,
  saveMobileTabOrganization,
  type MobileTabOrganization,
} from './mobileTabOrganization';

type JotaiStore = ReturnType<typeof useStore>;

type MobileTabOrganizationState = {
  walletAddress: string;
  organization: MobileTabOrganization;
  ready: boolean;
};

/**
 * What GO keeps about its Tabs for the signed-in wallet, on the phone only:
 * renamed tabs, the folder rows and sizes, and the Tabs folders from before
 * they became bookmark folders. Shared, so every screen edits one copy.
 */
export const mobileTabOrganizationStateAtom = atom<MobileTabOrganizationState>({
  walletAddress: '',
  organization: emptyOrganization(),
  ready: false,
});

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
