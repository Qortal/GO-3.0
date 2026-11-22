/**
 * Reads what the avatar prewarm needs from the signed-in app state: the
 * account's name, the Tabs overlay (open tabs, folders, pins), the most
 * opened Q-Apps, recent DM partners and the user's groups. Only lists GO
 * already shows the user; nothing here asks the node anything.
 *
 * Other saved wallets are left out on purpose: fetching every wallet's
 * avatar from a remote node would tell its operator which wallets share
 * this phone (see utils/walletPrimaryNameCache.ts).
 *
 * Privacy trade-off for DM partners: every avatar request shows the node
 * (often a public one, e.g. ext-node.qortal.link) that this IP looks at that
 * name, in the same session as the signed-in account. The rule here is that
 * the prewarm never reveals a contact GO has not already revealed:
 * - Node chat partners (memberDirectsAtom) and groups come from the node
 *   itself (/chat/active, /groups/member), so it already knows them.
 * - Reticulum-only partners never touch the node; they are prewarmed only
 *   when the device cache already has a record of their avatar (GO showed it
 *   before, so this only keeps it fresh). Pass `isCachedAvatar: () => true`
 *   to prewarm them all (faster first show, weaker privacy).
 */
import type { Atom } from 'jotai';
import {
  dmFriendsByAddressAtom,
  groupsOwnerNamesAtom,
  groupsPropertiesAtom,
  memberDirectsAtom,
  memberGroupsAtom,
  reticulumChatSummariesAtom,
  reticulumDirectSummariesAtom,
  sortablePinnedAppsAtom,
  userInfoAtom,
} from '../../atoms/global';
import {
  loadAppOpenCounts,
  type AppOpenCounts,
} from '../../components/Mobile/mobileAppOpenCounts';
import {
  emptyOrganization,
  loadMobileTabOrganization,
  type MobileTabOrganization,
} from '../../components/Mobile/mobileTabOrganization';
import { mobileTabOrganizationStateAtom } from '../../components/Mobile/mobileTabOrganizationStore';
import { goBookmarksStateAtom } from '../../components/Mobile/goLauncher/goLauncherStore';
import { bookmarksAsSavedTabs } from '../../components/Mobile/goLauncher/goLauncherOps';
import type { QdnAvatarPrewarmEntry } from './avatarCache';
import {
  buildQdnAvatarPrewarmPlan,
  QDN_AVATAR_PREWARM_FEATURED_APPS,
  type QdnAvatarPrewarmAppLike,
  type QdnAvatarPrewarmInput,
} from './prewarmPlan';
import { getQdnAvatarSeedUrl } from './seeds';

/** The part of a jotai store the prewarm reads (no subscriptions). */
export type QdnAvatarPrewarmStore = {
  get: <Value>(atom: Atom<Value>) => Value;
};

type QdnAvatarPrewarmSourceDeps = {
  loadTabOrganization?: (address: string) => Promise<MobileTabOrganization>;
  loadAppOpenCounts?: (address: string) => Promise<AppOpenCounts>;
  /** The live open tabs (see useOpenTabs / `setTabsToNav`). */
  getOpenTabs?: () => QdnAvatarPrewarmAppLike[];
  /** Peer address → name hints (see rememberQdnAvatarPrewarmPeerNames). */
  getPeerNameHints?: () => Record<string, string>;
  /**
   * True when the device cache has a record of this name's avatar. Without
   * it, Reticulum-only DM partners are left out (see the note above).
   */
  isCachedAvatar?: (name: string) => boolean;
  /** Bundled icon check (default: the shipped seeds). */
  hasSeed?: (name: string) => boolean;
};

const hasBundledSeed = (name: string): boolean => !!getQdnAvatarSeedUrl(name);

const MAX_PEER_NAME_HINTS = 300;
const peerNameHints = new Map<string, string>();

/**
 * Lets the chat list share the names it resolved for DM partners (Reticulum
 * DMs only carry addresses), so their avatars can be prewarmed too. Memory
 * only, at most 300 entries; the newest win.
 */
export function rememberQdnAvatarPrewarmPeerNames(
  namesByAddress: Record<string, string | null | undefined> | null | undefined
): void {
  if (!namesByAddress || typeof namesByAddress !== 'object') return;
  for (const [address, name] of Object.entries(namesByAddress)) {
    const cleanAddress = typeof address === 'string' ? address.trim() : '';
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanAddress || !cleanName || cleanName === cleanAddress) continue;
    peerNameHints.delete(cleanAddress);
    peerNameHints.set(cleanAddress, cleanName);
  }
  while (peerNameHints.size > MAX_PEER_NAME_HINTS) {
    const oldest = peerNameHints.keys().next().value;
    if (oldest === undefined) break;
    peerNameHints.delete(oldest);
  }
}

/** Forgets the DM partner name hints (account switch). */
export function clearQdnAvatarPrewarmPeerNames(): void {
  peerNameHints.clear();
}

const readPeerNameHints = (): Record<string, string> =>
  Object.fromEntries(peerNameHints);

const safeGet = <Value>(
  store: QdnAvatarPrewarmStore,
  atom: Atom<Value>,
  fallback: Value
): Value => {
  try {
    const value = store.get(atom);
    return value ?? fallback;
  } catch {
    return fallback;
  }
};

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);

/**
 * Everything the plan needs, for the signed-in `address`. Returns null when
 * another account (or none) is signed in by now.
 */
export async function readQdnAvatarPrewarmInput(
  store: QdnAvatarPrewarmStore,
  address: string,
  deps: QdnAvatarPrewarmSourceDeps = {}
): Promise<QdnAvatarPrewarmInput | null> {
  const userInfo = safeGet<any>(store, userInfoAtom, null);
  if (!address || userInfo?.address !== address) return null;

  const tabState = safeGet<any>(store, mobileTabOrganizationStateAtom, null);
  let tabFolders: MobileTabOrganization | null = null;
  if (tabState?.ready && tabState.walletAddress === address) {
    tabFolders = tabState.organization ?? null;
  } else {
    try {
      tabFolders = await (
        deps.loadTabOrganization ?? loadMobileTabOrganization
      )(address);
    } catch {
      tabFolders = null;
    }
  }

  // The folders are bookmark folders now: their apps are the bookmarks.
  if (tabFolders?.movedToBookmarks) {
    const bookmarks = safeGet<any>(store, goBookmarksStateAtom, null);
    const saved =
      bookmarks?.address === address && bookmarks.data
        ? bookmarksAsSavedTabs(bookmarks.data)
        : null;
    tabFolders = saved
      ? {
          ...emptyOrganization(),
          folders: [
            { id: 'bookmarks', name: '', order: 0, tabKeys: saved.tabKeys },
          ],
          savedTabs: saved.savedTabs,
        }
      : null;
  }

  let appOpenCounts: AppOpenCounts = {};
  try {
    appOpenCounts = await (deps.loadAppOpenCounts ?? loadAppOpenCounts)(
      address
    );
  } catch {
    appOpenCounts = {};
  }

  let openTabs: QdnAvatarPrewarmAppLike[] = [];
  try {
    openTabs = asArray(deps.getOpenTabs?.());
  } catch {
    openTabs = [];
  }

  // Storage reads above are async: give up if the account changed meanwhile.
  if (safeGet<any>(store, userInfoAtom, null)?.address !== address) {
    return null;
  }

  const knownNamesByAddress: Record<string, string> = {
    ...(deps.getPeerNameHints ?? readPeerNameHints)(),
  };
  const friends = asRecord(safeGet(store, dmFriendsByAddressAtom, {}));
  for (const [peer, friend] of Object.entries(friends)) {
    const name = typeof friend?.name === 'string' ? friend.name.trim() : '';
    if (name) knownNamesByAddress[peer] = name;
  }

  return {
    ownAddress: address,
    ownNames: [typeof userInfo?.name === 'string' ? userInfo.name : ''],
    featuredApps: QDN_AVATAR_PREWARM_FEATURED_APPS,
    openTabs,
    tabFolders,
    pinnedApps: asArray(safeGet<any>(store, sortablePinnedAppsAtom, [])),
    appOpenCounts,
    directs: asArray(safeGet<any>(store, memberDirectsAtom, [])),
    directSummaries: asRecord(
      safeGet<any>(store, reticulumDirectSummariesAtom, {})
    ),
    knownNamesByAddress,
    groups: asArray(safeGet<any>(store, memberGroupsAtom, [])),
    groupSummaries: asRecord(
      safeGet<any>(store, reticulumChatSummariesAtom, {})
    ),
    groupOwnerNames: asRecord(safeGet<any>(store, groupsOwnerNamesAtom, {})),
    groupProperties: asRecord(safeGet<any>(store, groupsPropertiesAtom, {})),
    hasSeed: deps.hasSeed ?? hasBundledSeed,
    isCachedAvatar: deps.isCachedAvatar ?? null,
  };
}

/** The prewarm list for the signed-in `address` ([] when it changed). */
export async function collectQdnAvatarPrewarmEntries(
  store: QdnAvatarPrewarmStore,
  address: string,
  deps: QdnAvatarPrewarmSourceDeps = {}
): Promise<QdnAvatarPrewarmEntry[]> {
  const input = await readQdnAvatarPrewarmInput(store, address, deps);
  return input ? buildQdnAvatarPrewarmPlan(input) : [];
}
