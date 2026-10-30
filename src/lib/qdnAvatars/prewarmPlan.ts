/**
 * Which avatars to fetch ahead of time: the ones GO is about to show the user.
 * Pure functions (no I/O); prewarmSources.ts reads the inputs from the app
 * state and prewarmScheduler.ts fetches the result in the background.
 *
 * Order matters: a run stops after a few failures in a row or after its
 * budget, so what is most likely on screen next comes first. Names GO ships a
 * bundled icon for (Home featured Q-Apps, default pins) go last: they never
 * show a grey letter, and the visible screens fetch them anyway.
 */
import type { QdnAvatarPrewarmEntry } from './avatarCache';
import { cleanQdnName, qdnAvatarKey, qdnGroupAvatarIdentifier } from './keys';

/**
 * The Q-Apps tiles of the Home "Featured Q-Apps" panel that have a QDN icon
 * (a copy of FEATURED_APP_GRID in Group/HomeFeaturedApps.tsx without the
 * built-in Q-Chat tile).
 */
export const QDN_AVATAR_PREWARM_FEATURED_APPS: readonly string[] = [
  'Q-Tube',
  'Quitter',
  'Q-Mail',
  'SubWire',
  'Q-Trade',
];

/** How many candidates each source may add to one run. */
type QdnAvatarPrewarmPlanLimits = {
  openTabs: number;
  folderTabs: number;
  pinnedApps: number;
  recentApps: number;
  people: number;
  groups: number;
  total: number;
};

const DEFAULT_QDN_AVATAR_PREWARM_PLAN_LIMITS: QdnAvatarPrewarmPlanLimits = {
  openTabs: 12,
  folderTabs: 24,
  pinnedApps: 12,
  recentApps: 12,
  people: 30,
  groups: 15,
  total: 100,
};

/** An open tab, a saved Tabs folder entry or a pinned app. */
export type QdnAvatarPrewarmAppLike = {
  name?: unknown;
  service?: unknown;
  internal?: unknown;
  isPrivate?: unknown;
  privateAppProperties?: unknown;
  [key: string]: unknown;
};

type QdnAvatarPrewarmTabFolders = {
  folders?: Array<{
    tabKeys?: unknown;
    order?: unknown;
    row?: unknown;
  }> | null;
  savedTabs?: Record<string, QdnAvatarPrewarmAppLike | undefined> | null;
} | null;

export type QdnAvatarPrewarmInput = {
  /** Signed-in account; its own DM row ("Saved Messages") is skipped. */
  ownAddress?: string | null;
  /** The signed-in account's registered name. */
  ownNames?: Array<string | null | undefined>;
  featuredApps?: readonly string[];
  openTabs?: QdnAvatarPrewarmAppLike[] | null;
  tabFolders?: QdnAvatarPrewarmTabFolders;
  pinnedApps?: QdnAvatarPrewarmAppLike[] | null;
  /** Open counts per tab key (`APP|Q-Tube`, `WEBSITE|name|id`, `internal:x`). */
  appOpenCounts?: Record<string, unknown> | null;
  /** Node chat list: `{ address, name, timestamp }`. */
  directs?: Array<Record<string, any>> | null;
  /**
   * Reticulum DM summaries keyed by peer address. These partners are known
   * only to this device (Reticulum DMs do not go through the node), so they
   * are prewarmed only when `isCachedAvatar` says GO showed their avatar here
   * before (then the prewarm only refreshes it): a background run must not
   * tell a remote node about contacts it has not already seen.
   */
  directSummaries?: Record<string, Record<string, any> | undefined> | null;
  /** Names already known for peer addresses (DM friends, earlier lookups). */
  knownNamesByAddress?: Record<string, string | undefined> | null;
  /** The user's groups: `{ groupId, timestamp }`. */
  groups?: Array<Record<string, any>> | null;
  /** Reticulum group chat summaries keyed by group id. */
  groupSummaries?: Record<string, Record<string, any> | undefined> | null;
  /** Group owner names keyed by group id. */
  groupOwnerNames?: Record<string, string | undefined> | null;
  /** Group details keyed by group id (`ownerPrimaryName`). */
  groupProperties?: Record<string, Record<string, any> | undefined> | null;
  /** True when GO ships a bundled icon for this Q-App / website name. */
  hasSeed?: ((name: string) => boolean) | null;
  /** True when the device cache already has a record of this avatar. */
  isCachedAvatar?: ((name: string) => boolean) | null;
};

const QORTAL_ADDRESS_RE = /^Q[1-9A-HJ-NP-Za-km-z]{33}$/;

/** A registered name worth asking the node about ('' otherwise). */
export function prewarmableName(value: unknown): string {
  const name = cleanQdnName(value);
  if (!name || name.length > 40 || QORTAL_ADDRESS_RE.test(name)) return '';
  return name;
}

/** The app or website name behind a tab-like record ('' for private/internal). */
export function appNameForPrewarm(
  app: QdnAvatarPrewarmAppLike | null | undefined
): string {
  if (!app || typeof app !== 'object') return '';
  if (app.internal != null && app.internal !== '') return '';
  // Private Q-Apps carry their own logo and must not be looked up by name.
  if (app.isPrivate === true || app.privateAppProperties != null) return '';
  return prewarmableName(app.name);
}

/**
 * App name in a Tabs key (`APP|Q-Tube` or `WEBSITE|name|identifier`). Any
 * other key with an identifier (`APP|publisher|identifier`) is a private
 * Q-App published under someone's name: its icon is not that name's avatar.
 */
export function appNameFromTabKey(tabKey: unknown): string {
  if (typeof tabKey !== 'string' || tabKey.startsWith('internal:')) return '';
  const parts = tabKey.split('|');
  if (parts.length < 2) return '';
  const service = parts[0].trim().toUpperCase();
  if (service !== 'APP' && service !== 'WEBSITE') return '';
  if (parts.length > 2 && service !== 'WEBSITE') return '';
  return prewarmableName(parts[1]);
}

/** App name for a Tabs key, from its saved record when there is one. */
function appNameForTabKey(
  tabKey: unknown,
  savedTabs: Record<string, QdnAvatarPrewarmAppLike | undefined>
): string {
  const saved =
    typeof tabKey === 'string' &&
    Object.prototype.hasOwnProperty.call(savedTabs, tabKey)
      ? savedTabs[tabKey]
      : undefined;
  return saved ? appNameForPrewarm(saved) : appNameFromTabKey(tabKey);
}

const savedTabsOf = (
  tabFolders: QdnAvatarPrewarmTabFolders | undefined
): Record<string, QdnAvatarPrewarmAppLike | undefined> =>
  tabFolders?.savedTabs && typeof tabFolders.savedTabs === 'object'
    ? tabFolders.savedTabs
    : {};

const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function folderTabNames(
  tabFolders: QdnAvatarPrewarmTabFolders | undefined
): string[] {
  if (!tabFolders || !Array.isArray(tabFolders.folders)) return [];
  const savedTabs = savedTabsOf(tabFolders);
  const folders = tabFolders.folders
    .filter((folder) => folder && Array.isArray(folder.tabKeys))
    .map((folder, index) => ({ folder, index }))
    .sort(
      (a, b) =>
        toNumber(a.folder.row) - toNumber(b.folder.row) ||
        toNumber(a.folder.order) - toNumber(b.folder.order) ||
        a.index - b.index
    );
  const names: string[] = [];
  for (const { folder } of folders) {
    for (const tabKey of folder.tabKeys as unknown[]) {
      const name = appNameForTabKey(tabKey, savedTabs);
      if (name) names.push(name);
    }
  }
  return names;
}

function recentAppNames(
  counts: Record<string, unknown> | null | undefined,
  savedTabs: Record<string, QdnAvatarPrewarmAppLike | undefined>
) {
  if (!counts || typeof counts !== 'object') return [];
  return Object.entries(counts)
    .map(([key, count]) => ({ name: appNameForTabKey(key, savedTabs), count }))
    .filter(
      (item) => item.name && typeof item.count === 'number' && item.count > 0
    )
    .sort((a, b) => (b.count as number) - (a.count as number))
    .map((item) => item.name);
}

const safePredicate = (
  predicate: ((name: string) => boolean) | null | undefined,
  name: string
): boolean => {
  try {
    return typeof predicate === 'function' && predicate(name) === true;
  } catch {
    return false;
  }
};

/** DM partners' names, most recent conversation first. */
function recentPeopleNames(input: QdnAvatarPrewarmInput): string[] {
  const ownAddress = cleanQdnName(input.ownAddress);
  const known = input.knownNamesByAddress || {};
  const byAddress = new Map<
    string,
    { name: string; at: number; viaNode: boolean }
  >();
  const note = (address: string, name: string, at: number, viaNode = false) => {
    if (!address || address === ownAddress) return;
    const previous = byAddress.get(address);
    byAddress.set(address, {
      name: name || previous?.name || '',
      at: Math.max(at, previous?.at ?? 0),
      viaNode: viaNode || !!previous?.viaNode,
    });
  };

  for (const direct of Array.isArray(input.directs) ? input.directs : []) {
    const address = cleanQdnName(direct?.address);
    note(
      address,
      prewarmableName(direct?.name),
      toNumber(direct?.timestamp),
      true
    );
  }
  const summaries =
    input.directSummaries && typeof input.directSummaries === 'object'
      ? input.directSummaries
      : {};
  for (const [key, summary] of Object.entries(summaries)) {
    const address = cleanQdnName(summary?.peerAddress) || cleanQdnName(key);
    const at = Math.max(
      toNumber(summary?.updatedAt),
      toNumber(summary?.lastEvent?.timestamp)
    );
    note(address, '', at);
  }

  const people: Array<{ name: string; at: number }> = [];
  for (const [address, entry] of byAddress) {
    const name = entry.name || prewarmableName(known[address]);
    if (!name) continue;
    // Reticulum-only partner: only refresh an avatar GO already showed here.
    if (!entry.viaNode && !safePredicate(input.isCachedAvatar, name)) continue;
    people.push({ name, at: entry.at });
  }
  // Stable sort: equal timestamps keep list order.
  return people.sort((a, b) => b.at - a.at).map((person) => person.name);
}

/** Group avatars (by owner name), most recently active group first. */
function recentGroupEntries(
  input: QdnAvatarPrewarmInput
): Array<{ name: string; identifier: string }> {
  const owners = input.groupOwnerNames || {};
  const properties = input.groupProperties || {};
  const summaries = input.groupSummaries || {};
  const seen = new Set<string>();
  const groups: Array<{ name: string; identifier: string; at: number }> = [];
  for (const group of Array.isArray(input.groups) ? input.groups : []) {
    const groupId = String(group?.groupId ?? '').trim();
    if (!groupId || groupId === '0' || seen.has(groupId)) continue;
    seen.add(groupId);
    const owner =
      prewarmableName(owners[groupId]) ||
      prewarmableName(properties[groupId]?.ownerPrimaryName);
    if (!owner) continue;
    const summary = summaries[groupId];
    const at = Math.max(
      toNumber(group?.timestamp),
      toNumber(summary?.updatedAt),
      toNumber(summary?.lastEvent?.timestamp)
    );
    groups.push({
      name: owner,
      identifier: qdnGroupAvatarIdentifier(groupId),
      at,
    });
  }
  return groups
    .sort((a, b) => b.at - a.at)
    .map(({ name, identifier }) => ({ name, identifier }));
}

/**
 * The avatars to prewarm, deduplicated, in order: own account, open tabs,
 * Tabs folders, most opened apps, recent DM partners, recent groups, Home
 * featured Q-Apps, pinned apps; then every name with a bundled icon moves to
 * the end (keeping its order). Each source is capped by `limits`.
 *
 * Seeded and featured names last matters on a slow node: they are also what
 * the visible screens fetch right after login, and a run stops after a few
 * failures in a row, before reaching people and groups (no bundled icon).
 */
export function buildQdnAvatarPrewarmPlan(
  input: QdnAvatarPrewarmInput,
  limits: Partial<QdnAvatarPrewarmPlanLimits> = {}
): QdnAvatarPrewarmEntry[] {
  const cap = { ...DEFAULT_QDN_AVATAR_PREWARM_PLAN_LIMITS, ...limits };
  const plan: QdnAvatarPrewarmEntry[] = [];
  const keys = new Set<string>();

  const add = (name: string, identifier?: string): boolean => {
    if (plan.length >= cap.total) return false;
    const key = qdnAvatarKey(name, identifier);
    if (!key || keys.has(key)) return false;
    keys.add(key);
    plan.push(identifier ? { name, identifier } : name);
    return true;
  };
  const addNames = (names: string[], max: number) => {
    let added = 0;
    for (const name of names) {
      if (added >= max) break;
      if (add(name)) added += 1;
    }
  };

  addNames(
    (input.ownNames ?? []).map(prewarmableName).filter(Boolean),
    Number.POSITIVE_INFINITY
  );
  addNames(
    (Array.isArray(input.openTabs) ? input.openTabs : [])
      .map(appNameForPrewarm)
      .filter(Boolean),
    cap.openTabs
  );
  addNames(folderTabNames(input.tabFolders), cap.folderTabs);
  addNames(
    recentAppNames(input.appOpenCounts, savedTabsOf(input.tabFolders)),
    cap.recentApps
  );
  addNames(recentPeopleNames(input), cap.people);

  let groupsAdded = 0;
  for (const group of recentGroupEntries(input)) {
    if (groupsAdded >= cap.groups) break;
    if (add(group.name, group.identifier)) groupsAdded += 1;
  }

  // Shown right after login (Home), and mostly bundled: last.
  addNames(
    (input.featuredApps ?? QDN_AVATAR_PREWARM_FEATURED_APPS)
      .map(prewarmableName)
      .filter(Boolean),
    Number.POSITIVE_INFINITY
  );
  // Dashboard pins default to the official Q-Apps, most of which ship a
  // bundled icon.
  addNames(
    (Array.isArray(input.pinnedApps) ? input.pinnedApps : [])
      .map(appNameForPrewarm)
      .filter(Boolean),
    cap.pinnedApps
  );

  // Anything with a bundled icon (also an open tab or a folder app) after
  // the avatars that would otherwise show a letter.
  const seeded = (entry: QdnAvatarPrewarmEntry) =>
    typeof entry === 'string' && safePredicate(input.hasSeed, entry);
  return [...plan.filter((entry) => !seeded(entry)), ...plan.filter(seeded)];
}
