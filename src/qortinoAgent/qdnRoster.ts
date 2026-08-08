/**
 * QDN rosters: Minter/Dev admins, group owners, owned names with registration dates.
 */
import { getBaseApiReact, getBaseApiReactForAvatar } from '../utils/globalApi';
import type { QdnProfileCard } from './qdnLookup';

export type RosterKind = 'minter-admins' | 'dev-admins' | 'qm-admins' | 'forum-admins';

export type OwnedNameRow = {
  name: string;
  address: string;
  registered?: number;
  isPrimary?: boolean;
  avatarUrl: string;
};

export type GroupOwnerResult = {
  groupId: number;
  groupName: string;
  ownerAddress: string;
  ownerName: string;
  memberCount?: number;
  description?: string;
  created?: number;
  profile: QdnProfileCard;
};

/** Minter Admins = admins of Minter Group 694 (onlyAdmins=true). */
const GROUP_MINTERS = 694;
const GROUP_DEV = 1;
const GROUP_QM_ADMIN = 721;
const GROUP_FORUM_ADMINS = 673;

async function apiGetJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  const base = getBaseApiReact().replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function avatarUrlFor(name: string, address?: string): string {
  const base = getBaseApiReactForAvatar().replace(/\/$/, '');
  let url = `${base}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/qortal_avatar?async=true`;
  if (address) url += `&_=${encodeURIComponent(address)}`;
  return url;
}

function formatRegistered(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return 'date unknown';
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'date unknown';
  }
}

export function detectRosterIntent(query: string): RosterKind | null {
  const t = query.trim().toLowerCase();
  if (!t) return null;
  if (
    /\b(minter\s*admins?|admins?\s+of\s+mint|who\s+are\s+the\s+minter\s+admins?)\b/.test(
      t
    ) ||
    (/\bminter\b/.test(t) && /\badmins?\b/.test(t))
  ) {
    return 'minter-admins';
  }
  if (
    /\b(dev\s*admins?|developer\s+admins?|who\s+are\s+the\s+dev\s+admins?)\b/.test(t) ||
    (/\bdev(eloper)?\b/.test(t) && /\badmins?\b/.test(t))
  ) {
    return 'dev-admins';
  }
  if (
    /\b(q-?mintership\s*admins?|qm\s*admins?)\b/.test(t) ||
    (/\bmintership\b/.test(t) && /\badmins?\b/.test(t))
  ) {
    return 'qm-admins';
  }
  if (/\bforum\s*admins?\b/.test(t)) return 'forum-admins';
  return null;
}

/** “who owns/is the owner of the X group” */
export function extractGroupOwnerQuery(query: string): string | null {
  const t = query.trim();
  const patterns = [
    /(?:who\s+(?:is|are)\s+(?:the\s+)?owner(?:s)?\s+of(?:\s+the)?\s+)(.+?)(?:\s+group)?\s*\??$/i,
    /(?:owner\s+of(?:\s+the)?\s+)(.+?)(?:\s+group)?\s*\??$/i,
    /(?:who\s+owns(?:\s+the)?\s+)(.+?)(?:\s+group)?\s*\??$/i,
    /(?:group\s+owner\s+(?:of|for)\s+)(.+?)\s*\??$/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      return m[1]
        .replace(/\bgroup\b/gi, '')
        .replace(/[?!.]+$/g, '')
        .trim();
    }
  }
  return null;
}

/** “list / what are the (primary) names of X” */
export function extractOwnedNamesQuery(query: string): string | null {
  const t = query.trim();
  const patterns = [
    /(?:(?:list|show|what\s+are|get)\s+(?:the\s+)?(?:primary\s+)?names?\s+(?:of|for|owned\s+by)\s+)(.+?)\s*\??$/i,
    /(?:(?:primary\s+)?names?\s+(?:of|for|owned\s+by)\s+)(.+?)\s*\??$/i,
    /(?:what\s+names?\s+does\s+)(.+?)(?:\s+own|\s+have)\s*\??$/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      return m[1].replace(/[?!.]+$/g, '').trim();
    }
  }
  return null;
}

/**
 * Questions that need live QDN (rosters, group owners, name lists, who-is).
 * Used to nudge Offline users toward QDN mode.
 */
export function isObviouslyQdnQuestion(query: string): boolean {
  const t = query.trim().toLowerCase();
  if (!t) return false;
  if (detectRosterIntent(t)) return true;
  if (extractGroupOwnerQuery(query)) return true;
  if (extractOwnedNamesQuery(query)) return true;
  // Publish / day-activity questions — need live QDN search.
  // Year optional ("24th of July"); also bare "what did X publish".
  if (
    /\b(what\s+did|what\s+has)\b/.test(t) &&
    /\b(post|posted|publish|published|publishes|upload|uploaded)\b/.test(t)
  ) {
    return true;
  }
  if (
    /\b(20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december|yesterday|last\s+week|this\s+week)\b/i.test(
      t
    ) &&
    /\b(post|posted|publish|published|publishes|upload|uploaded|qdn|activity)\b/.test(
      t
    )
  ) {
    return true;
  }
  // Bare "who is X" is NOT QDN-only — Offline should try FAQ / general knowledge
  // (Crowetic, Elon Musk, etc.). Live Level/publishes still belong in QDN mode.
  if (/\b(show|play|watch|find|list|browse)\b/.test(t) && /\b(video|music|audio|photo|image|pdf|file)\b/.test(t)) {
    return true;
  }
  if (
    /\b(images?|photos?|pictures?|pics?|videos?|music|songs?|audio|pdfs?|files?)\s+(of|about|on|for)\b/.test(
      t
    )
  ) {
    return true;
  }
  if (/\b(level|minter\s+admin|dev\s+admin|on-?chain|qdn\s+scan)\b/.test(t) && /\bwho\b/.test(t)) {
    return true;
  }
  if (/\b(owner of|owns the|group owner|primary names?)\b/.test(t)) return true;
  if (/\b(compare|vs\.?|versus|difference\s+between)\b/.test(t)) return true;
  if (
    /\b(my\s+level|am\s+i\s+minting|my\s+blocks|level\s*up)\b/.test(t) ||
    (/\b(mint|minting)\b/.test(t) && /\b(my|me|i)\b/.test(t))
  ) {
    return true;
  }
  if (
    /\b(what'?s\s+new|whats\s+new|group\s+activity|digest)\b/.test(t) ||
    (/\bgroup\b/.test(t) && /\b(this|last)\s+week\b/.test(t))
  ) {
    return true;
  }
  if (/\b(saved|pinned)\s+(shelves?|media)\b/.test(t) || /\bmy\s+shelves?\b/.test(t)) {
    return true;
  }
  if (/\b(last|past|this)\s+(week|month)\b/.test(t) && /\b(post|publish|activity|what)\b/.test(t)) {
    return true;
  }
  return false;
}

function groupIdForRoster(kind: RosterKind): number {
  switch (kind) {
    case 'minter-admins':
      return GROUP_MINTERS;
    case 'dev-admins':
      return GROUP_DEV;
    case 'qm-admins':
      return GROUP_QM_ADMIN;
    case 'forum-admins':
      return GROUP_FORUM_ADMINS;
  }
}

function labelForRoster(kind: RosterKind): string {
  switch (kind) {
    case 'minter-admins':
      return 'Minter Admins';
    case 'dev-admins':
      return 'Dev Admins';
    case 'qm-admins':
      return 'Q-Mintership Admins';
    case 'forum-admins':
      return 'Forum Admins';
  }
}

export async function fetchAdminRoster(
  kind: RosterKind,
  signal?: AbortSignal
): Promise<{ label: string; profiles: QdnProfileCard[]; text: string }> {
  const groupId = groupIdForRoster(kind);
  const label = labelForRoster(kind);
  const data = await apiGetJson<{
    members?: Array<{ member?: string; primaryName?: string; isAdmin?: boolean }>;
    adminCount?: number;
  }>(`/groups/members/${groupId}?limit=0&onlyAdmins=true`, signal);

  const members = Array.isArray(data?.members) ? data!.members! : [];
  const profiles: QdnProfileCard[] = [];
  for (const m of members) {
    if (!m.member) continue;
    const name = (m.primaryName || '').trim() || m.member.slice(0, 8) + '…';
    profiles.push({
      name: m.primaryName || name,
      address: m.member,
      level: 0,
      tags: [label.replace(/s$/, '')],
      avatarUrl: m.primaryName
        ? avatarUrlFor(m.primaryName, m.member)
        : avatarUrlFor(m.member, m.member),
    });
  }

  // Enrich levels (best-effort, capped)
  await Promise.all(
    profiles.slice(0, 40).map(async (p) => {
      const info = await apiGetJson<{ level?: number }>(
        `/addresses/${encodeURIComponent(p.address)}`,
        signal
      );
      if (typeof info?.level === 'number') p.level = info.level;
    })
  );

  const lines = profiles.map(
    (p, i) =>
      `${i + 1}. ${p.name}${p.level ? ` (Level ${p.level})` : ''} — ${p.address}`
  );
  const text = `[QDN roster · ${label} · group ${groupId}]\n${profiles.length} admin(s):\n${lines.join('\n')}\nREQUIRED: list these people with their avatars shown in the UI. Do not invent extra admins.`;

  return { label, profiles, text };
}

type GroupRow = {
  groupId?: number;
  groupName?: string;
  owner?: string;
  ownerPrimaryName?: string;
  memberCount?: number;
  description?: string;
  created?: number;
};

export async function findGroupByName(
  groupName: string,
  signal?: AbortSignal
): Promise<GroupRow | null> {
  const target = groupName.trim().toLowerCase();
  if (!target) return null;

  // Fast path: if a registered name matches, check that owner's groups first.
  const nameRec = await apiGetJson<{ owner?: string; name?: string }>(
    `/names/${encodeURIComponent(groupName.trim())}`,
    signal
  );
  if (nameRec?.owner) {
    const owned = await apiGetJson<GroupRow[]>(
      `/groups/owner/${encodeURIComponent(nameRec.owner)}`,
      signal
    );
    const hit = (owned || []).find(
      (g) => (g.groupName || '').trim().toLowerCase() === target
    );
    if (hit) return hit;
    // fuzzy contains
    const soft = (owned || []).find((g) =>
      (g.groupName || '').toLowerCase().includes(target)
    );
    if (soft) return soft;
  }

  // Scan recent groups pages (newest first) for a name match.
  for (let offset = 0; offset < 1500; offset += 100) {
    if (signal?.aborted) return null;
    const page = await apiGetJson<GroupRow[]>(
      `/groups?limit=100&offset=${offset}&reverse=true`,
      signal
    );
    if (!page?.length) break;
    const exact = page.find((g) => (g.groupName || '').trim().toLowerCase() === target);
    if (exact) return exact;
    const soft = page.find((g) => (g.groupName || '').toLowerCase().includes(target));
    if (soft) return soft;
    if (page.length < 100) break;
  }
  return null;
}

export async function fetchGroupOwnerInfo(
  groupNameQuery: string,
  signal?: AbortSignal
): Promise<GroupOwnerResult | null> {
  const group = await findGroupByName(groupNameQuery, signal);
  if (!group?.groupId || !group.owner) return null;

  let ownerName = (group.ownerPrimaryName || '').trim();
  if (!ownerName) {
    const primary = await apiGetJson<{ name?: string }>(
      `/names/primary/${encodeURIComponent(group.owner)}`,
      signal
    );
    ownerName = primary?.name || '';
  }
  const addr = await apiGetJson<{ level?: number; flags?: number }>(
    `/addresses/${encodeURIComponent(group.owner)}`,
    signal
  );
  const display = ownerName || group.owner.slice(0, 10) + '…';
  const profile: QdnProfileCard = {
    name: display,
    address: group.owner,
    level: typeof addr?.level === 'number' ? addr.level : 0,
    tags: ['Group owner'],
    avatarUrl: ownerName
      ? avatarUrlFor(ownerName, group.owner)
      : avatarUrlFor(group.owner, group.owner),
  };

  return {
    groupId: group.groupId,
    groupName: group.groupName || groupNameQuery,
    ownerAddress: group.owner,
    ownerName: display,
    memberCount: group.memberCount,
    description: group.description,
    created: group.created,
    profile,
  };
}

export function formatGroupOwnerAnswer(info: GroupOwnerResult): string {
  const when = info.created ? ` Created ${formatRegistered(info.created)}.` : '';
  const members =
    typeof info.memberCount === 'number' ? ` Members: ${info.memberCount}.` : '';
  return `The owner of the “${info.groupName}” group (id ${info.groupId}) is ${info.ownerName} (${info.ownerAddress}).${members}${when}`;
}

export async function fetchOwnedNamesDetailed(
  nameOrAddress: string,
  signal?: AbortSignal
): Promise<{ address: string; primaryName: string; names: OwnedNameRow[]; text: string } | null> {
  let address = nameOrAddress.trim();
  let primaryName = '';

  if (!/^Q[A-Za-z0-9]{30,}$/.test(address)) {
    const rec = await apiGetJson<{ owner?: string; name?: string }>(
      `/names/${encodeURIComponent(address)}`,
      signal
    );
    if (!rec?.owner) {
      const search = await apiGetJson<Array<{ name?: string; owner?: string }>>(
        `/names/search?query=${encodeURIComponent(address)}&prefix=true&limit=8`,
        signal
      );
      const hit = search?.find(
        (n) => (n.name || '').toLowerCase() === address.toLowerCase()
      ) || search?.[0];
      if (!hit?.owner) return null;
      address = hit.owner;
      primaryName = hit.name || address;
    } else {
      address = rec.owner;
      primaryName = rec.name || nameOrAddress;
    }
  }

  const primary = await apiGetJson<{ name?: string }>(
    `/names/primary/${encodeURIComponent(address)}`,
    signal
  );
  if (primary?.name) primaryName = primary.name;

  // Paginate / unlimited — accounts can own well over 50 names.
  let list: Array<{ name?: string; owner?: string }> = [];
  const unlimited = await apiGetJson<Array<{ name?: string; owner?: string }>>(
    `/names/address/${encodeURIComponent(address)}?limit=0`,
    signal
  );
  if (Array.isArray(unlimited) && unlimited.length) {
    list = unlimited;
  } else {
    const PAGE = 100;
    for (let offset = 0; ; offset += PAGE) {
      const page = await apiGetJson<Array<{ name?: string; owner?: string }>>(
        `/names/address/${encodeURIComponent(address)}?limit=${PAGE}&offset=${offset}`,
        signal
      );
      if (!Array.isArray(page) || !page.length) break;
      list = list.concat(page);
      if (page.length < PAGE) break;
    }
  }

  const names: OwnedNameRow[] = [];
  for (const row of list) {
    if (!row.name) continue;
    const detail = await apiGetJson<{
      name?: string;
      registered?: number;
      owner?: string;
    }>(`/names/${encodeURIComponent(row.name)}`, signal);
    const isPrimary =
      !!primaryName && row.name.toLowerCase() === primaryName.toLowerCase();
    names.push({
      name: row.name,
      address,
      registered: detail?.registered,
      isPrimary,
      avatarUrl: avatarUrlFor(row.name, address),
    });
  }

  names.sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    return (a.registered || 0) - (b.registered || 0);
  });

  const lines = names.map(
    (n, i) =>
      `${i + 1}. ${n.name}${n.isPrimary ? ' (primary)' : ''} — registered ${formatRegistered(n.registered)}`
  );
  const text = `[QDN names · ${primaryName || address}]\n${names.length} registered name(s):\n${lines.join('\n')}\nREQUIRED: show each name with its avatar and registration date. Primary name first.`;

  return { address, primaryName: primaryName || address, names, text };
}

export { formatRegistered, avatarUrlFor };
