/**
 * Lightweight QDN / on-chain lookup for Qortino "QDN mode".
 * Inspired by MA-Helper portfolio + activity fetch — mobile-sized, not a full scan.
 */
import { getBaseApiReact, getBaseApiReactForAvatar } from '../utils/globalApi';
import {
  detectMediaIntent,
  fetchMediaForName,
  fetchMediaForOwnedNames,
  mediaItemsToContext,
  preferSubstantialVideos,
  type QdnMediaItem,
} from './qdnMedia';
import {
  buildRoleStatement,
  fetchChatSnippets,
  fetchPublishSnippets,
  formatPersonVoiceBlock,
} from './qdnPersonContent';
import {
  buildCharacterPortrait,
  extractContentThemes,
  type ContentTheme,
  type PublishSignal,
} from './qdnCharacterPortrait';
import { linkifyQdnReferences } from './qdnLinkify';
import {
  buildNominationWrittenSummary,
  buildProfileWrittenSummary,
  CREATIVE_FORM_WORDS,
  detectCreativeAboutPersonIntent,
  detectNominationIntent,
  writtenSummaryToLlmContext,
  type QdnSummaryStats,
} from './qdnWrittenSummary';
import { detectTopicIntent, searchQdnTopic } from './qdnTopicSearch';
import {
  detectTopicMediaIntent,
  searchTopicMedia,
  titleMatchesSubject,
} from './qdnTopicMedia';
import {
  buildForcedTopicMediaIntent,
  humanLabelForSearchKind,
  isMediaSearchKind,
  mediaKindsForSearchKind,
  type QdnSearchKind,
} from './qdnSearchKind';
import {
  fetchAllOwnedNames,
  fetchPublishedSitesForNames,
  type QdnPublishedSite,
} from './qdnPublishedSites';
import {
  fetchRecentQuitterPosts,
  mergeQuitterPosts,
  type QuitterPostCard,
} from './qdnQuitterPosts';
import { getProfileOverride } from './qdnProfileOverrides';
import {
  fetchQortalUserProfileForNames,
  formatProfileDescriptionBits,
  type QortalUserProfile,
} from './qdnUserProfile';
import type { OfficialResourceLink } from './officialResources';
import { formatQdnResourceLine } from './qdnAppLinks';

export type QdnProfileCard = {
  name: string;
  address: string;
  level: number;
  tags: string[];
  avatarUrl: string;
  /** On-chain / Hub bio (not the AI character portrait). */
  description?: string;
  /** Personalized character portrait from public content themes. */
  characterSummary?: string;
  /** Whether `name` is the account primary, or a secondary registered name. */
  nameRole?: 'primary' | 'secondary';
  /** Account primary name when `name` is secondary. */
  primaryName?: string;
};

export type { QdnPublishedSite };
export type { QuitterPostCard };

export type QdnDossier = {
  name: string;
  address: string;
  level: number;
  tags: string[];
  avatarUrl: string;
  /** On-chain name description from `/names/{name}`. */
  description?: string;
  /**
   * Personalized character portrait from public content themes
   * (seed for UI description + optional on-device LLM polish).
   */
  characterSummary?: string;
  /** Structured themes detected from publishes (for LLM polish). */
  contentThemes?: ContentTheme[];
  /** Publish signals used to build / polish the character portrait. */
  publishSignals?: PublishSignal[];
  text: string;
  stats: QdnSummaryStats;
  profileSummary: string;
  nominationSummary: string;
  /** Default APP / WEBSITE publishes across owned names (tappable in UI). */
  publishedSites: QdnPublishedSite[];
  /** Recent Quitter posts (shown as a compact shelf). */
  quitterPosts: QuitterPostCard[];
  /** Extra chips from curated override / Hub profile links. */
  extraLinks?: OfficialResourceLink[];
  nameRole: 'primary' | 'secondary';
  primaryName: string;
};

/**
 * Ready-made who-is bubble body (portfolio + activity + publishes).
 * Character portrait and Quitter posts are shown in the UI chips/shelf —
 * keep them out of this text so they are not duplicated.
 */
export function formatDirectWhoIsAnswer(
  d: QdnDossier,
  nomination = false
): string {
  const open = buildRoleStatement(d.name, d.tags);
  const body = nomination ? d.nominationSummary : d.profileSummary;
  const s = d.stats;
  const primaryLabel = d.primaryName || d.name;
  const nameRoleLine =
    d.nameRole === 'primary'
      ? `${d.name} is the **primary** registered name on this account.`
      : `${d.name} is a **secondary** registered name; primary name is **${primaryLabel}**.`;

  const dataLines = [
    nameRoleLine,
    `**Primary name:** ${primaryLabel}`,
    `**Address:** \`${d.address}\``,
    d.tags.length
      ? `**On-chain roles:** ${d.tags.join(', ')}` +
        (d.tags.includes('Minter Admin')
          ? ' _(admin of Minter Group 694)_'
          : d.tags.includes('Dev Admin')
            ? ' _(verified via Dev group admin list)_'
            : d.tags.includes('Minter')
              ? ' _(member of Minter Group 694)_'
              : '')
      : '**On-chain roles:** (none flagged — not a Minter / Dev Admin on this node)',
    s.ownedNames.length
      ? `**Registered names:** ${s.ownedNames.length} (see list below)`
      : null,
    s.ageDays != null
      ? `**First activity:** ~${s.ageDays.toLocaleString()} days on-chain`
      : null,
    s.lastActivityTs
      ? `**Last activity (sampled):** ${new Date(s.lastActivityTs).toISOString().slice(0, 10)}`
      : null,
    s.blocksMinted > 0
      ? `**Blocks minted:** ${s.blocksMinted.toLocaleString()}`
      : null,
    Number.isFinite(s.balance)
      ? `**Balance:** ~${s.balance.toFixed(3)} QORT`
      : null,
    `**Txs sampled:** ${s.txsSampled.toLocaleString()} · last 30 days: ${s.recent30.toLocaleString()}`,
    s.topTxTypes.length
      ? `**Top tx types:** ${s.topTxTypes.join(', ')}`
      : null,
    `**QDN resources (sampled):** ${s.qdnResourceCount.toLocaleString()}`,
    s.appCounts.length
      ? `**Content footprint:** ${s.appCounts.map((a) => `${a.app} (${a.count})`).join(', ')}`
      : null,
  ]
    .filter((x): x is string => !!x)
    .map((line) => `- ${line}`);

  const publishLines = s.publishTitles.length
    ? s.publishTitles.map((t) => `- ${t}`)
    : ['- _(none sampled)_'];

  const raw = [
    `**${open}.** Level **${d.level}**.`,
    '',
    '### Portfolio',
    body,
    '',
    '### Account activity',
    ...dataLines,
    '',
    '### Recent publishes',
    ...publishLines,
  ].join('\n');
  return linkifyQdnReferences(raw);
}

/** Insert a streaming Character section after the opening role line. */
export function withStreamingCharacterSection(
  answer: string,
  characterSummary: string
): string {
  const portrait = characterSummary.trim();
  const body = stripStreamingCharacterSection(answer);
  if (!portrait) return body;
  const lines = body.split('\n');
  let insertAt = 0;
  while (insertAt < lines.length && !(lines[insertAt] || '').trim()) insertAt += 1;
  insertAt += 1; // after opening role/level line
  while (insertAt < lines.length && !(lines[insertAt] || '').trim()) insertAt += 1;
  const before = lines.slice(0, insertAt).join('\n').trimEnd();
  const after = lines.slice(insertAt).join('\n').trimStart();
  return `${before}\n\n### Character\n${portrait}\n\n${after}`.replace(
    /\n{3,}/g,
    '\n\n'
  );
}

/** Remove a temporary Character section used while the portrait streams. */
export function stripStreamingCharacterSection(answer: string): string {
  const lines = answer.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = (lines[i] || '').trim();
    if (t === '### Character' || t === '——— Character ———') {
      i += 1;
      while (i < lines.length) {
        const u = (lines[i] || '').trim();
        if (u.startsWith('### ') || /^———/.test(u)) break;
        i += 1;
      }
      continue;
    }
    out.push(lines[i] || '');
    i += 1;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** @deprecated use withStreamingCharacterSection — kept for tests */
export function injectCharacterIntoWhoIsAnswer(
  answer: string,
  characterSummary: string
): string {
  return withStreamingCharacterSection(answer, characterSummary);
}

type NameRecord = {
  name?: string;
  owner?: string;
  isPrimary?: boolean;
  description?: string;
  data?: string;
};

function isPlaceholderNameData(s: string): boolean {
  const t = s.trim().toLowerCase();
  return (
    !t ||
    t === 'registered name on the qortal chain' ||
    t === 'registered name' ||
    t === 'n/a' ||
    t === 'none'
  );
}

function nameDescriptionOf(row: NameRecord | null | undefined): string {
  if (!row) return '';
  if (typeof row.description === 'string' && !isPlaceholderNameData(row.description)) {
    return row.description.trim();
  }
  if (typeof row.data === 'string' && !isPlaceholderNameData(row.data)) {
    return row.data.trim();
  }
  return '';
}

function composeWhoIsDescription(opts: {
  name: string;
  nameDescription: string;
  hubProfile: QortalUserProfile | null;
}): string {
  const override = getProfileOverride(opts.name);
  if (override?.description) return override.description;

  // Hub / on-chain bio only — character portrait is a separate UI field.
  const bits: string[] = [];
  if (opts.nameDescription) bits.push(opts.nameDescription);
  const hubBits = formatProfileDescriptionBits(opts.hubProfile);
  if (hubBits) bits.push(hubBits);
  return bits.join(' ').replace(/\s+/g, ' ').trim();
}

function rolePitchForPortrait(tags: string[]): string {
  if (tags.includes('Founder')) return 'a Founder of Qortal';
  if (tags.includes('Minter Admin')) return 'a Minter Admin';
  if (tags.includes('Dev Admin')) return 'a Dev Admin';
  if (tags.includes('Admin')) return 'a network Admin';
  if (tags.includes('Minter')) return 'an active Minter';
  return 'a non-minter on Qortal';
}

function profileLinksToOfficial(
  name: string,
  hubProfile: QortalUserProfile | null
): OfficialResourceLink[] {
  const out: OfficialResourceLink[] = [];
  const override = getProfileOverride(name);
  if (override?.links?.length) out.push(...override.links);
  if (hubProfile?.links?.length) {
    for (const l of hubProfile.links) {
      const id = `profile-link-${l.href.slice(0, 48)}`;
      if (out.some((x) => x.href === l.href || x.id === id)) continue;
      if (l.href.toLowerCase().startsWith('qortal://')) {
        const m = l.href.match(/^qortal:\/\/(APP|WEBSITE)\/(.+)$/i);
        if (m) {
          out.push({
            id,
            label: l.label,
            service: m[1].toUpperCase() as 'APP' | 'WEBSITE',
            name: decodeURIComponent(m[2]),
          });
          continue;
        }
      }
      out.push({ id, label: l.label, href: l.href });
    }
  }
  return out;
}

type AddressInfo = {
  level?: number;
  flags?: number;
  blocksMinted?: number;
  blocksMintedAdjustment?: number;
};

type TxRow = {
  type?: string;
  timestamp?: number;
};

type QdnResource = {
  service?: string;
  identifier?: string;
  name?: string;
};

type GroupMembership = {
  groupId?: number;
  groupName?: string;
  isAdmin?: boolean;
};

const MS_DAY = 86_400_000;
/** Minter Group — members are Minters; group admins are Minter Admins. */
const GROUP_MINTERS = 694;
const GROUP_DEV = 1;
const GROUP_ADMINS = 709;
const GROUP_FORUM_ADMINS = 673;
const GROUP_QM_ADMIN = 721;

const STOP_WORDS = new Set([
  'who',
  'whats',
  "what's",
  'what',
  'is',
  'are',
  'the',
  'a',
  'an',
  'about',
  'tell',
  'me',
  'info',
  'information',
  'details',
  'data',
  'something',
  'anything',
  'on',
  'look',
  'up',
  'lookup',
  'find',
  'get',
  'give',
  'show',
  'user',
  'named',
  'called',
  'name',
  'names',
  'account',
  'person',
  'someone',
  'qortal',
  'qdn',
  'please',
  'thanks',
  'thank',
  'can',
  'you',
  'their',
  'his',
  'her',
  'profile',
  'activity',
  'summary',
  'summarize',
  'whobis',
  'by',
  'from',
  'of',
  'for',
  'to',
  'and',
  'or',
  'write',
  'draft',
  'compose',
  'make',
  'create',
  'prepare',
  'generate',
  'nomination',
  'nominate',
  'nominating',
  'nominated',
  'minter',
  'minters',
  'mintership',
  'reason',
  'card',
  'pitch',
  'primary',
  'secondary',
  'registered',
  // Creative forms — "write a poem about Crowetic" must not resolve "Poem".
  ...CREATIVE_FORM_WORDS,
  // How-to / network phrasing — never person-name tokens
  'how',
  'does',
  'do',
  'did',
  'work',
  'works',
  'use',
  'using',
  'explain',
  'describe',
  'define',
  'open',
  'launch',
  'network',
  'blockchain',
  'game',
  'go',
  'hub',
  'level',
  'week',
  'app',
  'apps',
  'coin',
  'coins',
  'token',
  'tokens',
]);

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

async function apiGetText(path: string, signal?: AbortSignal): Promise<string | null> {
  const base = getBaseApiReact().replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

function avatarUrlFor(name: string, address?: string): string {
  // HTTP on local HTTPS so Capacitor WebView <img> avatars actually load.
  const base = getBaseApiReactForAvatar().replace(/\/$/, '');
  let url = `${base}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/qortal_avatar?async=true`;
  if (address) url += `&_=${encodeURIComponent(address)}`;
  return url;
}

function classifyApp(service: string, identifier: string): string {
  const svc = (service || '').toUpperCase();
  const id = (identifier || '').toLowerCase();
  if (id.startsWith('qtube') || id.includes('qtube_') || svc === 'VIDEO') return 'Q-Tube';
  if (id.startsWith('quitter') || id.includes('quitter')) return 'Quitter';
  if (id.startsWith('qblog') || id.includes('qblog') || svc === 'BLOG' || svc === 'BLOG_POST')
    return 'Q-Blog';
  if (id.startsWith('qshare') || id.startsWith('qfile')) return 'Q-Share';
  if (id.includes('qmail') || svc.includes('MAIL')) return 'Q-Mail';
  if (id.startsWith('earbump') || id.startsWith('enjoymusic') || svc === 'AUDIO') return 'Audio';
  if (svc === 'WEBSITE') return 'Website';
  if (svc === 'APP') return 'Q-App';
  if (svc === 'THUMBNAIL' || svc === 'IMAGE') return 'Images';
  if (svc === 'ARBITRARY' || svc === 'DOCUMENT') return 'QDN docs';
  return svc || 'Other';
}

function normalizeGroupMemberships(
  groups: GroupMembership[] | null | undefined
): GroupMembership[] {
  if (!Array.isArray(groups)) return [];
  return groups
    .map((g) => {
      const groupId = Number((g as { groupId?: unknown }).groupId);
      if (!Number.isFinite(groupId)) return null;
      const isAdmin =
        (g as { isAdmin?: unknown }).isAdmin === true ||
        (g as { admin?: unknown }).admin === true;
      return {
        groupId,
        groupName: g.groupName,
        isAdmin,
      } satisfies GroupMembership;
    })
    .filter((g): g is GroupMembership => !!g);
}

function buildTags(
  flags: number | undefined,
  groups: GroupMembership[],
  adminGroupIds?: Set<number>
): string[] {
  const tags: string[] = [];
  const byId = new Map<number, GroupMembership>();
  for (const g of normalizeGroupMemberships(groups)) {
    byId.set(g.groupId!, g);
  }
  const isAdminOf = (groupId: number) =>
    !!adminGroupIds?.has(groupId) || byId.get(groupId)?.isAdmin === true;

  // Founder accounts carry flags bit 0 (value 1) on-chain.
  if ((flags ?? 0) & 1) tags.push('Founder');

  // Minter Admins = admins of Minter Group 694 (not a separate 761 group).
  const inMinters = byId.has(GROUP_MINTERS);
  if (isAdminOf(GROUP_MINTERS)) {
    tags.push('Minter Admin');
  } else if (inMinters) {
    tags.push('Minter');
  }

  if (byId.has(GROUP_DEV) || isAdminOf(GROUP_DEV)) tags.push('Dev Admin');
  if (byId.has(GROUP_ADMINS) || isAdminOf(GROUP_ADMINS)) tags.push('Admin');
  if (byId.has(GROUP_FORUM_ADMINS) || isAdminOf(GROUP_FORUM_ADMINS)) {
    tags.push('Forum Admin');
  }
  if (byId.has(GROUP_QM_ADMIN) || isAdminOf(GROUP_QM_ADMIN)) {
    tags.push('Q-Mintership Admin');
  }

  return tags;
}

/** Confirm admin seats via adminOnly membership + onlyAdmins roster lists. */
async function fetchAdminGroupIds(
  address: string,
  signal?: AbortSignal
): Promise<Set<number>> {
  const out = new Set<number>();
  const adminOnly = await apiGetJson<GroupMembership[] | { groups?: GroupMembership[] }>(
    `/groups/member/${encodeURIComponent(address)}?adminOnly=true`,
    signal
  ).catch(() => null);
  const rows = Array.isArray(adminOnly)
    ? adminOnly
    : Array.isArray((adminOnly as { groups?: GroupMembership[] } | null)?.groups)
      ? (adminOnly as { groups: GroupMembership[] }).groups
      : [];
  for (const g of normalizeGroupMemberships(rows)) {
    if (typeof g.groupId === 'number') out.add(g.groupId);
  }

  // Cross-check key role groups — membership API sometimes omits isAdmin.
  // Minter Admin = onlyAdmins of group 694 (same list as "who are the minter admins").
  const roleGroups = [
    GROUP_MINTERS,
    GROUP_DEV,
    GROUP_ADMINS,
    GROUP_FORUM_ADMINS,
    GROUP_QM_ADMIN,
  ];
  await Promise.all(
    roleGroups.map(async (groupId) => {
      const data = await apiGetJson<{
        members?: Array<{ member?: string }>;
      }>(
        `/groups/members/${groupId}?limit=0&onlyAdmins=true`,
        signal
      ).catch(() => null);
      const members = Array.isArray(data?.members) ? data!.members! : [];
      if (members.some((m) => (m.member || '') === address)) {
        out.add(groupId);
      }
    })
  );
  return out;
}

/** Single Qortal name token (no spaces). */
const NAME_TOKEN = '[A-Za-z0-9][A-Za-z0-9_.-]{0,39}';
/** Multi-word Qortal name ("Simon James", "Qortal Hub"). */
const NAME_PHRASE = `${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){0,4}`;
/**
 * Name subject in compose/write sentences — stop before "and ask…", "asking…", etc.
 * So "message to Crowetic and ask him how…" → Crowetic (not the whole clause).
 */
const NAME_PHRASE_COMPOSE = `${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){0,3}?(?=\\s+(?:and\\b|asking\\b|ask\\b|please\\b|regarding\\b|about\\b|how\\b|what\\b|,)|$|[?!.])`;

const TRAILING_NOISE = new Set([
  'video',
  'videos',
  'music',
  'song',
  'songs',
  'audio',
  'image',
  'images',
  'photo',
  'photos',
  'picture',
  'pictures',
  'pic',
  'pics',
  'pdf',
  'pdfs',
  'file',
  'files',
  'profile',
  'activity',
  'please',
]);

function tidyNameCandidate(raw: string): string | null {
  let n = raw
    .trim()
    .replace(/^[@'"]+|[@'"]+$/g, '')
    .replace(/[?!.,:;]+$/g, '')
    .replace(/\s+/g, ' ');
  // Drop leading filler: "information about Qortal Justin" → "Qortal Justin"
  n = n
    .replace(
      /^(?:find|get|show|give|tell)\s+(?:me\s+)?(?:information|info|details|data)\s+(?:about|on|for)\s+/i,
      ''
    )
    .replace(/^(?:information|info|details|data)\s+(?:about|on|for)\s+/i, '')
    .replace(/^(?:find|search|look\s*up|lookup)\s+(?:me\s+)?/i, '')
    // "to Crowetic" / "about Crowetic" from compose mis-captures → person only
    .replace(/^(?:to|for|about|on)\s+/i, '')
    .trim();
  // "Simon James for minter" / "Jonny for mintership" → drop intent tails
  n = n
    .replace(
      /\s+for\s+(?:a\s+|the\s+)?minter(?:ship|\s+group|\s+card)?\b.*$/i,
      ''
    )
    .replace(/\s+to\s+the\s+minter(?:ship|\s+group)?\b.*$/i, '')
    .replace(/\s+(?:publish|published|publishes|post|posted|upload|uploaded)\b.*$/i, '')
    .trim();
  // Drop trailing media/intent words: "Simon James videos" → "Simon James"
  {
    const parts = n.split(/\s+/);
    while (parts.length > 1 && TRAILING_NOISE.has(parts[parts.length - 1].toLowerCase())) {
      parts.pop();
    }
    n = parts.join(' ');
  }
  if (n.length < 2 || n.length > 60) return null;
  // Bare "qortal" alone is the network — not a person. "Qortal Justin" is fine.
  if (n.toLowerCase() === 'qortal') return null;
  if (STOP_WORDS.has(n.toLowerCase()) && n.toLowerCase() !== 'qortal') return null;
  // Allow letters/numbers plus . _ - and internal spaces.
  if (!/^[A-Za-z0-9][A-Za-z0-9_. -]*[A-Za-z0-9_.-]$|^[A-Za-z0-9]$/.test(n)) {
    return null;
  }
  // Reject phrases made only of stop words ("tell me about"), but keep
  // multi-word names that start with Qortal / The ("Qortal Justin", "the cat").
  const parts = n.split(/\s+/);
  const keepDespiteStops =
    (parts.length >= 2 && parts[0].toLowerCase() === 'qortal') ||
    (parts.length >= 2 &&
      parts[0].toLowerCase() === 'the' &&
      !STOP_WORDS.has(parts[1].toLowerCase()));
  if (parts.every((p) => STOP_WORDS.has(p.toLowerCase())) && !keepDespiteStops) {
    return null;
  }
  return n;
}

/**
 * Pull likely Qortal name candidates from a natural-language question.
 * Multi-word names ("Simon James") are preferred as a single candidate;
 * individual tokens are only included as fallbacks after the full phrase.
 */
export function extractNameCandidates(query: string): string[] {
  const q = query.trim();
  if (!q) return [];

  const primary: string[] = [];
  const fallbacks: string[] = [];
  const push = (raw: string, into: string[]) => {
    const n = tidyNameCandidate(raw);
    if (!n) return;
    const key = n.toLowerCase();
    if (
      primary.some((x) => x.toLowerCase() === key) ||
      fallbacks.some((x) => x.toLowerCase() === key) ||
      into.some((x) => x.toLowerCase() === key)
    ) {
      return;
    }
    into.push(n);
  };

  // Quoted exact names win.
  for (const m of q.matchAll(/["']([^"']{2,60})["']/g)) {
    push(m[1], primary);
  }

  // Nomination / mintership phrasing — subject is AFTER the intent words.
  // Fixes: "Write nomination for Jonny" → Jonny (not "Nomination").
  const nominationPatterns = [
    new RegExp(
      `(?:write|draft|make|create|prepare|generate)\\s+(?:a\\s+|an\\s+|the\\s+)?(?:nomination|minter(?:ship)?\\s+card|reason)\\s+(?:for|about|on)\\s+[@]?(${NAME_PHRASE})`,
      'i'
    ),
    new RegExp(
      `(?:nomination|mintership|minter\\s+card|reason)\\s+(?:for|about|on)\\s+[@]?(${NAME_PHRASE})`,
      'i'
    ),
    new RegExp(
      `nominat(?:e|ing)\\s+[@]?(${NAME_PHRASE}?)(?=\\s+for\\s+(?:a\\s+|the\\s+)?minter|\\s*$|[?.!,])`,
      'i'
    ),
  ];
  for (const re of nominationPatterns) {
    const m = q.match(re);
    if (m?.[1]) push(m[1], primary);
  }

  const phrasePatterns = [
    // "write a poem about Crowetic" / "write a message to Crowetic" —
    // subject is the person, not Poem/Message.
    new RegExp(
      `(?:write|draft|compose|make|create|generate|craft|pen)\\s+(?:me\\s+)?(?:a\\s+|an\\s+|the\\s+)?(?:${CREATIVE_FORM_WORDS.join('|')})\\s+(?:about|to|for|on)\\s+[@]?(${NAME_PHRASE_COMPOSE})`,
      'i'
    ),
    new RegExp(
      `\\b(?:${CREATIVE_FORM_WORDS.join('|')})\\s+(?:about|to|for|on)\\s+[@]?(${NAME_PHRASE_COMPOSE})`,
      'i'
    ),
    // "write to Crowetic asking…" / "write something to Crowetic…"
    new RegExp(
      `(?:write|draft|compose|make|create|generate|craft|pen)\\s+(?:to|for)\\s+[@]?(${NAME_PHRASE_COMPOSE})`,
      'i'
    ),
    new RegExp(
      `(?:write|draft|compose|make|create)\\s+(?:me\\s+)?(?:a\\s+|an\\s+|the\\s+)?(?:something|text)\\s+(?:to|for)\\s+[@]?(${NAME_PHRASE_COMPOSE})`,
      'i'
    ),
    // "message Crowetic" / "email Crowetic about…" —
    // NOT "message to Crowetic" (that is handled above; else we capture "to Crowetic").
    new RegExp(
      `\\b(?:message|email|text|dm)\\s+(?!to\\b|for\\b|about\\b|on\\b)[@]?(${NAME_PHRASE_COMPOSE})`,
      'i'
    ),
    // "find information about Qortal Justin please" — must beat bare "find …"
    new RegExp(
      `(?:find|get|show|give|tell)\\s+(?:me\\s+)?(?:information|info|details|data)\\s+(?:about|on|for)\\s+[@]?(${NAME_PHRASE})`,
      'i'
    ),
    new RegExp(
      `(?:information|info|details|data)\\s+(?:about|on|for)\\s+[@]?(${NAME_PHRASE})`,
      'i'
    ),
    new RegExp(
      `(?:who(?:'s|\\s*is|\\s*are)|whobis|tell\\s+me\\s+about|what\\s+about|info\\s+on|look\\s*up|lookup)\\s+[@]?(${NAME_PHRASE})`,
      'i'
    ),
    // "what did PixelMage / Qortal Justin publish…"
    new RegExp(
      `(?:what\\s+(?:did|has)|show\\s+(?:me\\s+)?(?:publishes?|posts?)\\s+(?:from|by|for))\\s+[@]?(${NAME_PHRASE})(?=\\s+(?:publish|post|upload|on\\b|in\\b|across\\b|yesterday|last\\b|this\\b|the\\b|\\d)|$)`,
      'i'
    ),
    new RegExp(`(?:user|name|account|person)\\s+[@]?(${NAME_PHRASE})`, 'i'),
    // Person shelves: "videos by Crowetic" / "music from X" (not "images of dogs").
    new RegExp(
      `(?:videos?|music|songs?|audio|images?|photos?|pdfs?|files?)\\s+(?:by|from)\\s+[@]?(${NAME_PHRASE})`,
      'i'
    ),
  ];
  for (const re of phrasePatterns) {
    const m = q.match(re);
    if (m?.[1]) push(m[1], primary);
  }

  // Bare query that is itself a name / multi-word name (e.g. "Simon James").
  // Skip question-shaped / media-intent / nomination sentences.
  const looksLikeMediaIntent =
    /^(videos?|music|songs?|audio|images?|photos?|pdfs?|files?)\b/i.test(q) ||
    /\b(by|from|of)\b/i.test(q);
  const looksLikeNominationIntent =
    /\bnominat(e|ion|ing)\b/i.test(q) ||
    /\bmintership\b/i.test(q) ||
    /\bwrite\s+(a\s+)?(nomination|reason|minter)/i.test(q);
  const looksLikeComposeIntent = !!detectCreativeAboutPersonIntent(q);
  const bare = tidyNameCandidate(q);
  if (
    bare &&
    !/[?]/.test(q) &&
    !looksLikeMediaIntent &&
    !looksLikeNominationIntent &&
    !looksLikeComposeIntent
  ) {
    const parts = bare.split(/\s+/);
    // "qortal" / "the" are stop words, but "Qortal Justin" and "the cat" are
    // real registered names — never collapse them to a single token.
    const qortalPrefixedPerson =
      parts.length >= 2 && parts[0].toLowerCase() === 'qortal';
    const thePrefixedPerson =
      parts.length >= 2 &&
      parts[0].toLowerCase() === 'the' &&
      !STOP_WORDS.has(parts[1].toLowerCase());
    const allNonStop = parts.every((p) => !STOP_WORDS.has(p.toLowerCase()));
    if (allNonStop || qortalPrefixedPerson || thePrefixedPerson) {
      push(bare, primary);
    }
  }

  // Token fallbacks — only used if full-name resolve fails later.
  // When nomination/compose already found a subject, skip noisy tokens.
  if (!primary.length || !(looksLikeNominationIntent || looksLikeComposeIntent)) {
    const tokens = q.split(/[^A-Za-z0-9_.-]+/).filter(Boolean);
    for (const t of tokens) {
      if (STOP_WORDS.has(t.toLowerCase()) || TRAILING_NOISE.has(t.toLowerCase())) {
        continue;
      }
      push(t, fallbacks);
    }
  }

  // Prefer multi-word primaries, then single-token primaries, then fallbacks.
  const ordered = [
    ...primary.filter((n) => n.includes(' ')),
    ...primary.filter((n) => !n.includes(' ')),
    ...fallbacks.filter(
      (f) => !primary.some((p) => p.toLowerCase() === f.toLowerCase() || p.toLowerCase().includes(f.toLowerCase()))
    ),
  ];

  return ordered.slice(0, 5);
}

async function fetchAccountPrimaryName(
  address: string,
  signal?: AbortSignal
): Promise<string | null> {
  const primary = await apiGetJson<{ name?: string }>(
    `/names/primary/${encodeURIComponent(address)}`,
    signal
  );
  return primary?.name?.trim() || null;
}

type ResolvedName = {
  name: string;
  address: string;
  nameRole: 'primary' | 'secondary';
  primaryName: string;
  description: string;
};

async function resolveNameOnce(
  candidate: string,
  signal?: AbortSignal
): Promise<ResolvedName | null> {
  for (const keyed of nameCaseLookupVariants(candidate)) {
    const exact = await apiGetJson<NameRecord>(
      `/names/${encodeURIComponent(keyed)}`,
      signal
    );
    if (exact?.owner) {
      const name = exact.name || keyed;
      const primaryName =
        (await fetchAccountPrimaryName(exact.owner, signal)) || name;
      const nameRole =
        name.toLowerCase() === primaryName.toLowerCase()
          ? 'primary'
          : 'secondary';
      return {
        name,
        address: exact.owner,
        nameRole,
        primaryName,
        description: nameDescriptionOf(exact),
      };
    }
  }

  const search = await apiGetJson<NameRecord[]>(
    `/names/search?query=${encodeURIComponent(candidate)}&prefix=true&limit=12&offset=0`,
    signal
  );
  if (!Array.isArray(search) || !search.length) return null;

  const lower = candidate.toLowerCase();
  const scored: Array<ResolvedName & { score: number }> = [];

  for (const row of search) {
    if (!row?.owner || !row.name) continue;
    const nm = row.name;
    const primaryName =
      (await fetchAccountPrimaryName(row.owner, signal)) || nm;
    const isPrimary = nm.toLowerCase() === primaryName.toLowerCase();
    let score = 0;
    if (nm.toLowerCase() === lower) score += 100;
    else if (nm.toLowerCase().startsWith(lower)) score += 40;
    else if (nm.toLowerCase().includes(lower)) score += 20;
    else score += 10;
    // Prefer primary registered names over secondary aliases in fuzzy search.
    if (isPrimary) score += 25;
    else score += 5;
    if (typeof row.isPrimary === 'boolean') {
      score += row.isPrimary ? 15 : 0;
    }
    scored.push({
      name: nm,
      address: row.owner,
      nameRole: isPrimary ? 'primary' : 'secondary',
      primaryName,
      description: nameDescriptionOf(row),
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const best = scored[0];
  if (!best) return null;
  // Prefer a fresh `/names/{exact}` description when the search hit was fuzzy.
  let description = best.description;
  if (!description) {
    const fresh = await apiGetJson<NameRecord>(
      `/names/${encodeURIComponent(best.name)}`,
      signal
    );
    description = nameDescriptionOf(fresh);
  }
  return {
    name: best.name,
    address: best.address,
    nameRole: best.nameRole,
    primaryName: best.primaryName,
    description,
  };
}

async function resolveName(
  candidate: string,
  signal?: AbortSignal
): Promise<ResolvedName | null> {
  const primary = await resolveNameOnce(candidate, signal);
  if (primary) return primary;
  // Spoken "Qortal Justin" may be registered as "Justin" (or vice versa).
  const stripped = candidate.replace(/^qortal\s+/i, '').trim();
  if (stripped && stripped.toLowerCase() !== candidate.toLowerCase()) {
    return resolveNameOnce(stripped, signal);
  }
  return null;
}

/**
 * Name variants for person lookup. Many accounts register "Qortal Justin"
 * while people also type "Justin" — try both, never bare "Qortal".
 */
export function personNameQueryVariants(raw: string): string[] {
  const t = raw.trim().replace(/\s+/g, ' ');
  if (t.length < 2) return [];
  const out: string[] = [];
  const push = (s: string) => {
    const x = s.trim().replace(/\s+/g, ' ');
    if (x.length < 2 || x.toLowerCase() === 'qortal') return;
    if (out.some((o) => o.toLowerCase() === x.toLowerCase())) return;
    out.push(x);
  };
  push(t);
  const stripped = t.replace(/^qortal\s+/i, '').trim();
  if (stripped && stripped.toLowerCase() !== t.toLowerCase()) {
    push(stripped);
    push(`Qortal ${stripped}`);
  } else if (!/^qortal\s+/i.test(t)) {
    push(`Qortal ${t}`);
  }
  return out;
}

/**
 * Case spellings to try on `/names/{name}` (registry may be case-sensitive).
 * Typed form first, then lower / UPPER / Title Case.
 */
export function nameCaseLookupVariants(raw: string): string[] {
  const t = raw.trim().replace(/\s+/g, ' ');
  if (t.length < 2) return [];
  const out: string[] = [];
  const push = (s: string) => {
    const x = s.trim().replace(/\s+/g, ' ');
    if (x.length < 2) return;
    if (out.some((o) => o === x)) return;
    out.push(x);
  };
  push(t);
  push(t.toLowerCase());
  push(t.toUpperCase());
  push(
    t
      .split(/\s+/)
      .map((w) =>
        w.length <= 1
          ? w.toUpperCase()
          : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      )
      .join(' ')
  );
  return out;
}

/**
 * Exact `/names/{…}` lookup order for Users / who-is.
 * Always try what the user typed (all casings) before invented "Qortal X"
 * expansions — so "Kitty" resolves to Kitty, not Qortal Kitty, when both exist.
 */
export function orderedPersonExactLookupKeys(candidate: string): string[] {
  const typed = candidate.trim().replace(/\s+/g, ' ');
  if (typed.length < 2) return [];
  const keys: string[] = [];
  const push = (s: string) => {
    const x = s.trim().replace(/\s+/g, ' ');
    if (x.length < 2 || x.toLowerCase() === 'qortal') return;
    if (keys.some((k) => k === x)) return;
    keys.push(x);
  };
  for (const c of nameCaseLookupVariants(typed)) push(c);
  for (const v of personNameQueryVariants(typed)) {
    if (v.toLowerCase() === typed.toLowerCase()) continue;
    for (const c of nameCaseLookupVariants(v)) push(c);
  }
  return keys;
}

/** Levenshtein distance for short name typo tolerance. */
export function nameEditDistance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const prev = new Array(t.length + 1);
  const cur = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) prev[j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= t.length; j += 1) prev[j] = cur[j];
  }
  return prev[t.length];
}

/**
 * Score how well a registered name matches the user's query.
 * Rejects weak prefix hits like "Qortal Justin" → "Qortal News Network".
 * Allows small typos ("qoral justin" → "Qortal Justin").
 */
export function scoreRegisteredNameMatch(
  query: string,
  registered: string
): number {
  const q = query.toLowerCase().trim().replace(/\s+/g, ' ');
  const n = registered.toLowerCase().trim().replace(/\s+/g, ' ');
  if (!q || !n) return 0;
  if (q === n) return 1000;
  const qTok = q.split(' ').filter(Boolean);
  const nTok = n.split(' ').filter(Boolean);
  if (!qTok.length || !nTok.length) return 0;

  // Every query token appears as a whole word in the registered name.
  if (qTok.every((qt) => nTok.includes(qt))) {
    const extra = Math.max(0, nTok.length - qTok.length);
    return 800 - extra * 40;
  }

  // Registered name continues the full query phrase ("Qortal Justin Foo").
  if (n.startsWith(`${q} `)) return 600;

  // Typo tolerance: "qoral justin" ≈ "qortal justin" (1–2 edits).
  const dist = nameEditDistance(q, n);
  const maxLen = Math.max(q.length, n.length);
  if (maxLen >= 5 && dist > 0 && dist <= 2) {
    return 520 - dist * 40;
  }
  const compactDist = nameEditDistance(q.replace(/\s+/g, ''), n.replace(/\s+/g, ''));
  if (maxLen >= 5 && compactDist > 0 && compactDist <= 2) {
    return 500 - compactDist * 40;
  }

  // Multi-word queries must not match on the shared "Qortal" prefix alone.
  if (qTok.length >= 2) return 0;

  // Single-token: allow short close names only (not long prefix trees).
  if (nTok.includes(q) && nTok.length <= 2) return 180;
  if (n.startsWith(q) && nTok.length <= 2) return 160;
  // Single-token typo (e.g. "Crowetıc" / "Crowetic")
  if (q.length >= 4 && dist <= 2 && nTok.length <= 3) {
    return 200 - dist * 20;
  }
  return 0;
}

async function resolvedFromRecord(
  row: NameRecord,
  fallbackName: string,
  signal?: AbortSignal
): Promise<ResolvedName | null> {
  if (!row?.owner) return null;
  const name = row.name || fallbackName;
  const primaryName =
    (await fetchAccountPrimaryName(row.owner, signal)) || name;
  const nameRole =
    name.toLowerCase() === primaryName.toLowerCase() ? 'primary' : 'secondary';
  return {
    name,
    address: row.owner,
    nameRole,
    primaryName,
    description: nameDescriptionOf(row),
  };
}

/**
 * Strict person resolve for Users / who-is / nominations.
 * Exact match (typed + case) first, then Qortal-prefix variants;
 * never weak "Qortal …" prefix fuzz.
 */
async function resolvePersonNameStrict(
  candidate: string,
  signal?: AbortSignal
): Promise<ResolvedName | null> {
  const variants = personNameQueryVariants(candidate);
  if (!variants.length) return null;

  // Typed name (all casings) before invented "Qortal Kitty" — exact beats fuzzy.
  const exactKeys = orderedPersonExactLookupKeys(candidate);

  for (const v of exactKeys) {
    const exact = await apiGetJson<NameRecord>(
      `/names/${encodeURIComponent(v)}`,
      signal
    );
    if (exact?.owner) {
      // If the user typed a multi-word name, only accept bare-token exact hits
      // when score says the registered name still matches the full query.
      if (/\s/.test(candidate) && !/\s/.test(v)) {
        if (scoreRegisteredNameMatch(candidate, exact.name || v) < 180) {
          continue;
        }
      }
      return resolvedFromRecord(exact, v, signal);
    }
  }

  type Scored = ResolvedName & { score: number };
  let best: Scored | null = null;
  const considerRow = async (row: NameRecord) => {
    if (!row?.owner || !row.name) return;
    // Score against the typed candidate first — exact "Kitty" (1000) must beat
    // "Qortal Kitty" token-overlap (~760). Do not score invented Qortal-*
    // variants higher than the typed string for single-token queries.
    let score = scoreRegisteredNameMatch(candidate, row.name);
    for (const variant of variants) {
      if (/\s/.test(candidate) && !/\s/.test(variant)) continue;
      // Single-token typed query: only boost via case-equivalent variants,
      // never via "Qortal X" (that stole Kitty → Qortal Kitty).
      if (!/\s/.test(candidate) && variant.toLowerCase() !== candidate.trim().toLowerCase()) {
        continue;
      }
      score = Math.max(score, scoreRegisteredNameMatch(variant, row.name));
    }
    // Require a real match — blocks "Qortal Justin" → "Qortal News Network".
    if (score < 180) return;
    const resolved = await resolvedFromRecord(row, row.name, signal);
    if (!resolved) return;
    if (
      !best ||
      score > best.score ||
      (score === best.score &&
        resolved.name.length < best.name.length)
    ) {
      best = { ...resolved, score };
    }
  };

  const searchKeys = [
    // Prefer typed / shorter keys first in search too.
    candidate.trim(),
    ...exactKeys,
    // Distinctive last token so typos like "qoral justin" still find
    // "Qortal Justin" via /names/search?query=justin.
    ...candidate
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && t.toLowerCase() !== 'qortal'),
  ].filter(
    (k, i, arr) =>
      k && arr.findIndex((x) => x.toLowerCase() === k.toLowerCase()) === i
  );

  const seenNames = new Set<string>();
  for (const v of searchKeys.slice(0, 6)) {
    const [prefixHits, looseHits] = await Promise.all([
      apiGetJson<NameRecord[]>(
        `/names/search?query=${encodeURIComponent(v)}&prefix=true&limit=20&offset=0`,
        signal
      ),
      apiGetJson<NameRecord[]>(
        `/names/search?query=${encodeURIComponent(v)}&prefix=false&limit=20&offset=0`,
        signal
      ),
    ]);
    for (const row of [...(prefixHits || []), ...(looseHits || [])]) {
      const key = (row?.name || '').toLowerCase();
      if (!key || seenNames.has(key)) continue;
      seenNames.add(key);
      await considerRow(row);
    }
  }
  return best
    ? {
        name: best.name,
        address: best.address,
        nameRole: best.nameRole,
        primaryName: best.primaryName,
        description: best.description,
      }
    : null;
}

/** Media-chip helper: exact registered name only (no Qortal-prefix variants). */
async function resolveExactRegisteredName(
  candidate: string,
  signal?: AbortSignal
): Promise<ResolvedName | null> {
  const needle = candidate.trim();
  if (needle.length < 2) return null;
  for (const keyed of nameCaseLookupVariants(needle)) {
    const exact = await apiGetJson<NameRecord>(
      `/names/${encodeURIComponent(keyed)}`,
      signal
    );
    if (exact?.owner) {
      return resolvedFromRecord(exact, keyed, signal);
    }
  }

  const search = await apiGetJson<NameRecord[]>(
    `/names/search?query=${encodeURIComponent(needle)}&prefix=true&limit=12&offset=0`,
    signal
  );
  if (!Array.isArray(search) || !search.length) return null;
  const lower = needle.toLowerCase();
  const row = search.find(
    (r) => r?.owner && r.name && r.name.toLowerCase() === lower
  );
  if (!row) return null;
  return resolvedFromRecord(row, row.name || needle, signal);
}

function formatDate(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return 'unknown';
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return 'unknown';
  }
}

function activityLevel(count30d: number): string {
  if (count30d <= 0) return 'none';
  if (count30d > 50) return 'high';
  if (count30d > 20) return 'medium';
  return 'low';
}

export type QdnScanDepth = 'quick' | 'full';

export type QdnScanProgress = (detail: string) => void;

/** Who-is / person lookup shape (name present) — depth choice needs a tx-count check too. */
export function wantsQdnPersonDepthChoice(query: string): boolean {
  const t = query.trim();
  if (!t) return false;
  if (detectTopicIntent(t) && !detectNominationIntent(t)) return false;
  if (detectTopicMediaIntent(t)) return false;
  return extractNameCandidates(t).length > 0;
}

/**
 * True when the address has more than `threshold` txs (probe one row at that offset).
 * Used so we only ask quick vs full on heavy accounts.
 */
export async function addressHasMoreThanTxs(
  address: string,
  threshold = 1000,
  signal?: AbortSignal
): Promise<boolean> {
  const page = await apiGetJson<TxRow[]>(
    `/transactions/address/${encodeURIComponent(address)}?limit=1&offset=${threshold}&reverse=true`,
    signal
  );
  return Array.isArray(page) && page.length > 0;
}

/** Offer quick/full only for person lookups on accounts with >1000 txs. */
export async function shouldOfferQdnDepthChoice(
  query: string,
  signal?: AbortSignal
): Promise<boolean> {
  if (!wantsQdnPersonDepthChoice(query)) return false;
  const candidates = extractNameCandidates(query);
  if (!candidates.length) return false;
  const resolved = await resolveName(candidates[0], signal);
  if (!resolved?.address) return false;
  return addressHasMoreThanTxs(resolved.address, 1000, signal);
}

async function fetchTxSample(
  address: string,
  depth: QdnScanDepth,
  signal?: AbortSignal,
  onProgress?: QdnScanProgress
): Promise<TxRow[]> {
  // quick = light sample; full = deep page (also used auto when account ≤1000 txs).
  // Quick still single-request, but a bigger page sees further back in time.
  const pageSize = depth === 'full' ? 100 : 150;
  const maxTotal = depth === 'full' ? 1000 : 150;
  const out: TxRow[] = [];
  let offset = 0;
  while (out.length < maxTotal) {
    onProgress?.(
      depth === 'full'
        ? `Full scan · transactions ${out.length}/${maxTotal}…`
        : 'Quick scan · recent transactions…'
    );
    const page = await apiGetJson<TxRow[]>(
      `/transactions/address/${encodeURIComponent(address)}?limit=${pageSize}&offset=${offset}&reverse=true`,
      signal
    );
    if (!Array.isArray(page) || !page.length) break;
    out.push(...page);
    offset += page.length;
    if (page.length < pageSize) break;
    if (depth === 'quick') break;
  }
  return out.slice(0, maxTotal);
}

async function fetchResourceSample(
  name: string,
  depth: QdnScanDepth,
  signal?: AbortSignal,
  onProgress?: QdnScanProgress
): Promise<QdnResource[]> {
  // Quick stays one request; 25 resources still paints media/apps reliably.
  const pageSize = depth === 'full' ? 40 : 25;
  const maxTotal = depth === 'full' ? 120 : 25;
  const out: QdnResource[] = [];
  let offset = 0;
  while (out.length < maxTotal) {
    onProgress?.(
      depth === 'full'
        ? `Full scan · QDN resources ${out.length}/${maxTotal}…`
        : 'Quick scan · recent QDN resources…'
    );
    const page = await apiGetJson<QdnResource[]>(
      `/arbitrary/resources/search?name=${encodeURIComponent(name)}&exactmatchnames=true&mode=ALL&limit=${pageSize}&offset=${offset}&reverse=true`,
      signal
    );
    if (!Array.isArray(page) || !page.length) break;
    out.push(...page);
    offset += page.length;
    if (page.length < pageSize) break;
    if (depth === 'quick') break;
  }
  return out.slice(0, maxTotal);
}

export async function fetchUserQdnDossier(
  candidate: string,
  signal?: AbortSignal,
  options?: {
    viewerAddress?: string | null;
    depth?: QdnScanDepth;
    onProgress?: QdnScanProgress;
  }
): Promise<QdnDossier | null> {
  const depth: QdnScanDepth = options?.depth === 'full' ? 'full' : 'quick';
  const onProgress = options?.onProgress;
  // Strict person resolve — never fuzzy "Qortal Justin" → "Qortal News Network".
  const resolved = await resolvePersonNameStrict(candidate, signal);
  if (!resolved) return null;

  const { name, address, nameRole, primaryName, description } = resolved;
  onProgress?.(
    depth === 'full'
      ? `Full history for ${name} — this can take a while…`
      : `Quick look at ${name}…`
  );

  const [addrInfo, balanceRaw, ownedNameList, recentTx, firstTx, groups, adminGroupIds] =
    await Promise.all([
      apiGetJson<AddressInfo>(`/addresses/${encodeURIComponent(address)}`, signal),
      apiGetText(`/addresses/balance/${encodeURIComponent(address)}`, signal),
      fetchAllOwnedNames(address, signal),
      fetchTxSample(address, depth, signal, onProgress),
      apiGetJson<TxRow[]>(
        `/transactions/address/${encodeURIComponent(address)}?limit=1&reverse=false`,
        signal
      ),
      apiGetJson<GroupMembership[]>(
        `/groups/member/${encodeURIComponent(address)}`,
        signal
      ),
      fetchAdminGroupIds(address, signal),
    ]);

  const balance = balanceRaw != null ? Number(balanceRaw) : NaN;
  const names =
    ownedNameList.length > 0
      ? ownedNameList
      : [name];
  // Sample QDN resources under primary + looked-up name (and a few others when full).
  const resourceNameHints = [
    primaryName,
    name,
    ...(depth === 'full'
      ? names.filter(
          (n) =>
            n.toLowerCase() !== primaryName.toLowerCase() &&
            n.toLowerCase() !== name.toLowerCase()
        ).slice(0, 4)
      : []),
  ].filter(
    (n, i, arr) =>
      n && arr.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i
  );
  const resourceBatches = await Promise.all(
    resourceNameHints.map((n) =>
      fetchResourceSample(n, depth, signal, onProgress).catch(
        () => [] as QdnResource[]
      )
    )
  );
  const resourceSeen = new Set<string>();
  const resources: QdnResource[] = [];
  for (const batch of resourceBatches) {
    for (const r of batch) {
      const key = `${(r.service || '').toUpperCase()}:${(r.name || '').toLowerCase()}:${(r.identifier || '').toLowerCase()}`;
      if (resourceSeen.has(key)) continue;
      resourceSeen.add(key);
      resources.push(r);
    }
  }
  const txs = Array.isArray(recentTx) ? recentTx : [];
  const first = Array.isArray(firstTx) && firstTx[0] ? firstTx[0] : null;
  const memberships = normalizeGroupMemberships(groups);

  const now = Date.now();
  const recent30 = txs.filter(
    (t) => typeof t.timestamp === 'number' && now - t.timestamp < 30 * MS_DAY
  ).length;
  const typeCounts = new Map<string, number>();
  for (const t of txs) {
    const key = (t.type || 'OTHER').toUpperCase();
    typeCounts.set(key, (typeCounts.get(key) || 0) + 1);
  }
  const topTypes = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([type, count]) => `${type}:${count}`)
    .join(', ');

  const appCounts = new Map<string, number>();
  for (const r of resources) {
    const app = classifyApp(r.service || '', r.identifier || '');
    appCounts.set(app, (appCounts.get(app) || 0) + 1);
  }
  const topApps = [...appCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([app, count]) => `${app} (${count})`)
    .join(', ');

  // Prefer MA Helper–style activity labels + deep links over raw hashes
  const sampleLines = resources.slice(0, 10).map((r, i) =>
    formatQdnResourceLine({
      index: i + 1,
      name: r.name || name,
      service: r.service || '?',
      identifier: r.identifier || 'default',
    })
  );

  const firstTs = first?.timestamp;
  const lastTs = txs[0]?.timestamp;
  const ageDays =
    typeof firstTs === 'number' ? Math.max(0, Math.floor((now - firstTs) / MS_DAY)) : null;
  const level = typeof addrInfo?.level === 'number' ? addrInfo.level : 0;
  const tags = buildTags(addrInfo?.flags, memberships, adminGroupIds);
  const avatarUrl = avatarUrlFor(name, address);
  const minted =
    (addrInfo?.blocksMinted ?? 0) + (addrInfo?.blocksMintedAdjustment ?? 0);
  const roleLine = buildRoleStatement(name, tags);

  // Probe primary / looked-up name first so APP/WEBSITE cards still appear
  // if a large name list is slow.
  const probeNames = [
    primaryName,
    name,
    ...names.filter(
      (n) =>
        n.toLowerCase() !== primaryName.toLowerCase() &&
        n.toLowerCase() !== name.toLowerCase()
    ),
  ];

  const quitterNameHints = [name, primaryName].filter(
    (n, i, arr) => n && arr.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i
  );

  onProgress?.(
    depth === 'full'
      ? 'Full scan · publishes, sites, Quitter, profile…'
      : 'Quick scan · publishes, sites, Quitter…'
  );
  const siteProbeNames =
    depth === 'full' ? probeNames : [primaryName, name].filter(Boolean);
  const publishNameHints = [name, primaryName, ...names.slice(0, 3)].filter(
    (n, i, arr) =>
      n && arr.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i
  );
  const [publishes, chats, publishedSites, quitterRaw, hubProfile] =
    await Promise.all([
      Promise.all(
        publishNameHints.map((n) =>
          fetchPublishSnippets(n, signal).catch(() => [])
        )
      ).then((lists) => {
        const seen = new Set<string>();
        const out: Awaited<ReturnType<typeof fetchPublishSnippets>> = [];
        for (const list of lists) {
          for (const p of list) {
            const key = `${p.source}|${p.title}`.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(p);
          }
        }
        return out;
      }),
      fetchChatSnippets(address, {
        viewerAddress: options?.viewerAddress,
        signal,
      }).catch(() => []),
      // Probe APP/WEBSITE roots across owned names (full = every name).
      fetchPublishedSitesForNames(siteProbeNames, signal).catch(
        () => [] as QdnPublishedSite[]
      ),
      Promise.all(
        quitterNameHints.map((n) =>
          fetchRecentQuitterPosts(n, 3, signal).catch(() => [] as QuitterPostCard[])
        )
      ).then((lists) => mergeQuitterPosts(lists.flat(), 3)),
      fetchQortalUserProfileForNames([primaryName, name, ...names], signal).catch(
        () => null
      ),
    ]);

  const quitterPosts = quitterRaw;
  const publishSignals: PublishSignal[] = publishes.map((p) => ({
    source: p.source,
    title: p.title,
    excerpt: p.excerpt,
  }));
  // Also fold short Quitter text into theme detection when titles are thin.
  for (const qp of quitterPosts) {
    const text = (qp.text || '').trim();
    if (text.length < 12) continue;
    publishSignals.push({
      source: 'Quitter',
      title: text.slice(0, 120),
      excerpt: text.length > 120 ? text.slice(0, 180) : undefined,
    });
  }
  const contentThemes = extractContentThemes(publishSignals);
  const appCountList = [...appCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([app, count]) => ({ app, count }));
  const characterSummary = buildCharacterPortrait({
    name,
    rolePitch: rolePitchForPortrait(tags),
    level,
    themes: contentThemes,
    publishes: publishSignals,
    appCounts: appCountList,
  });
  const composedDescription = composeWhoIsDescription({
    name,
    nameDescription: description,
    hubProfile,
  });
  const extraLinks = profileLinksToOfficial(name, hubProfile);

  const voiceBlock = formatPersonVoiceBlock({
    displayName: name,
    tags,
    level,
    publishes,
    chats,
  });

  const stats: QdnSummaryStats = {
    name,
    address,
    level,
    tags,
    ownedNames: names,
    ageDays,
    firstActivityTs: typeof firstTs === 'number' ? firstTs : undefined,
    lastActivityTs: typeof lastTs === 'number' ? lastTs : undefined,
    txsSampled: txs.length,
    recent30,
    blocksMinted: minted,
    balance: Number.isFinite(balance) ? balance : 0,
    qdnResourceCount: resources.length,
    appCounts: appCountList,
    publishTitles: publishes
      .slice(0, 8)
      .map((p) => `[${p.source}] ${p.title}`)
      .filter((t) => !/described as|selling you|^\[Quitter\]\s*Quitter post/i.test(t)),
    chatHints: [],
    topTxTypes: topTypes ? topTypes.split(', ') : [],
  };
  const profileSummary = buildProfileWrittenSummary(stats);
  const nominationSummary = buildNominationWrittenSummary(stats, {
    characterSummary,
    themes: contentThemes.map((t) => t.label),
  });

  const ownedLabeled = names.map((n) =>
    n.toLowerCase() === primaryName.toLowerCase() ? `${n} (primary)` : n
  );

  const lines = [
    `QDN dossier for registered name "${name}" (${nameRole})`,
    nameRole === 'secondary'
      ? `Note: "${name}" is a secondary name; account primary name is "${primaryName}".`
      : `Note: "${name}" is the primary registered name on this account.`,
    composedDescription
      ? `User description (show first in answers): ${composedDescription}`
      : 'User description: (none set)',
    characterSummary
      ? `CHARACTER PORTRAIT (prefer for description / who-is personality):\n${characterSummary}`
      : null,
    contentThemes.length
      ? `Content themes: ${contentThemes.map((t) => t.label).join('; ')}`
      : null,
    voiceBlock,
    `Address: ${address}`,
    `Role statement: ${roleLine}`,
    `Account level: ${level}`,
    tags.length ? `Tags / roles: ${tags.join(', ')}` : 'Tags / roles: non-minter',
    `Avatar: published at THUMBNAIL/${name}/qortal_avatar (shown in the chat UI)`,
    ownedLabeled.length
      ? `Owned names (${ownedLabeled.length}): ${ownedLabeled.slice(0, 40).join(', ')}${
          ownedLabeled.length > 40 ? ` … +${ownedLabeled.length - 40} more` : ''
        }`
      : null,
    publishedSites.length
      ? `Published APP/WEBSITE roots (UI chips only): ${publishedSites
          .map((p) => `${p.service}/${p.name}`)
          .join(', ')}`
      : null,
    quitterPosts.length
      ? `Recent Quitter posts:\n${quitterPosts
          .map((p) => `• ${p.text}`)
          .join('\n')}`
      : null,
    ageDays != null
      ? `First on-chain activity: ${formatDate(firstTs)} (~${ageDays} days ago)`
      : null,
    lastTs ? `Last activity (sampled): ${formatDate(lastTs)}` : null,
    minted > 0 ? `Blocks minted (incl. adjustment): ${minted}` : null,
    Number.isFinite(balance) ? `Wallet balance: ~${balance.toFixed(3)} QORT` : null,
    `Recent txs sampled: ${txs.length}; last-30-day activity: ${recent30} (${activityLevel(recent30)})`,
    topTypes ? `Top tx types in sample: ${topTypes}` : null,
    `QDN resources sampled for "${name}": ${resources.length}`,
    topApps ? `Q-App / content footprint: ${topApps}` : null,
    sampleLines.length
      ? `Sample QDN activity (use markdown Open links; distinguish likes/replies from publishes; do not dump raw hashes):\n${sampleLines.join('\n')}`
      : null,
    '',
    'PORTFOLIO-STYLE PROFILE SUMMARY (prefer this voice for “who is / bare name” answers):',
    profileSummary,
  ].filter((x) => x != null);

  return {
    name,
    address,
    level,
    tags,
    avatarUrl,
    description: composedDescription || undefined,
    characterSummary,
    contentThemes,
    publishSignals,
    text: lines.join('\n'),
    stats,
    profileSummary,
    nominationSummary,
    publishedSites,
    quitterPosts,
    extraLinks: extraLinks.length ? extraLinks : undefined,
    nameRole,
    primaryName,
  };
}

/**
 * Scan QDN for the user question:
 * - person / nomination / media-by-name → name dossiers + media shelf
 * - how-to / topical questions → QDN index + content search across publishes
 */
export type QdnOwnedNameCard = {
  name: string;
  address: string;
  isPrimary?: boolean;
  avatarUrl: string;
  registered?: number;
};

type DocSearchHit = {
  name?: string;
  service?: string;
  identifier?: string;
  size?: number;
  created?: number;
  updated?: number;
  timestamp?: number;
  metadata?: { title?: string; description?: string };
};

function dedupeMediaItems(items: QdnMediaItem[]): QdnMediaItem[] {
  const seen = new Set<string>();
  const out: QdnMediaItem[] = [];
  for (const item of items) {
    const key = `${item.service}:${item.name}:${item.identifier}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** DOCUMENT / BLOG_POST publishes for a name (documents chip person shelf). */
async function fetchDocumentLikeForName(
  name: string,
  signal?: AbortSignal,
  perServiceLimit = 16
): Promise<QdnMediaItem[]> {
  const base = getBaseApiReact().replace(/\/$/, '');
  const out: QdnMediaItem[] = [];
  const seen = new Set<string>();
  for (const service of ['DOCUMENT', 'BLOG_POST'] as const) {
    try {
      const qs = new URLSearchParams({
        service,
        name,
        exactmatchnames: 'true',
        reverse: 'true',
        includemetadata: 'true',
        limit: String(perServiceLimit),
      });
      const res = await fetch(`${base}/arbitrary/resources/search?${qs}`, {
        signal,
      });
      if (!res.ok) continue;
      const data = (await res.json()) as DocSearchHit[];
      if (!Array.isArray(data)) continue;
      for (const hit of data) {
        const id = (hit.identifier || '').trim();
        const n = (hit.name || '').trim();
        // Nodes may ignore exactmatchnames — never keep another publisher's docs.
        if (!id || !n || n.toLowerCase() !== name.toLowerCase()) continue;
        if (/qortal_avatar|tombstone|_metadata|_thumb|qortal_profile/i.test(id)) {
          continue;
        }
        // Skip Q-Tube metadata shells — those belong to the Videos chip.
        if (/^qtube_vid_/i.test(id) && /_metadata$/i.test(id)) continue;
        const key = `${service}:${n}:${id}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const title = (
          hit.metadata?.title ||
          id.replace(/[_-]+/g, ' ')
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120);
        const looksPdf = /\.pdf(\b|$)/i.test(`${title} ${id}`);
        out.push({
          kind: looksPdf ? 'pdf' : 'file',
          name: n,
          service,
          identifier: id,
          title,
          description: hit.metadata?.description?.slice(0, 160),
          size: hit.size,
          created:
            typeof hit.created === 'number' && hit.created > 0
              ? hit.created
              : typeof hit.timestamp === 'number' && hit.timestamp > 0
                ? hit.timestamp
                : undefined,
          updated:
            typeof hit.updated === 'number' && hit.updated > 0
              ? hit.updated
              : undefined,
        });
        if (out.length >= 24) return out;
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Strip chip words so "audio chris luno" → "chris luno". */
function bareNameNeedleFromSearchQuery(query: string): string {
  return query
    .trim()
    .replace(/[?!.]+$/g, '')
    .replace(
      /\b(videos?|images?|photos?|pictures?|pics?|audio|music|songs?|tracks?|documents?|files?|pdfs?|blogs?|ear-?bump|q-?tube|qtube|show|find|search|list|browse|me|my|please|by|from)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export async function scanQdnForQuestion(
  query: string,
  options?: {
    timeoutMs?: number;
    viewerAddress?: string | null;
    depth?: QdnScanDepth;
    onProgress?: QdnScanProgress;
    /** UI search-engine chip (default: all). */
    searchKind?: QdnSearchKind;
  }
): Promise<{
  chunks: Array<{ text: string }>;
  detail: string;
  profiles: QdnProfileCard[];
  media: QdnMediaItem[];
  /** Skip LLM and show this answer (topic media grids). */
  directAnswer?: string;
  mediaLayout?: 'grid' | 'list';
  publishedSites?: QdnPublishedSite[];
  quitterPosts?: QuitterPostCard[];
  ownedNames?: QdnOwnedNameCard[];
  /** Curated / Hub profile chips for who-is. */
  extraLinks?: OfficialResourceLink[];
  /** Depth used for this person scan (for UI follow-up). */
  depth?: QdnScanDepth;
  /**
   * Seeds for on-device LLM character polish (who-is / Users).
   * Chat may rewrite these into warmer portraits without inventing facts.
   */
  characterDrafts?: Array<{
    name: string;
    roleLine: string;
    level: number;
    themes: ContentTheme[];
    publishes: PublishSignal[];
    seedPortrait: string;
  }>;
}> {
  const searchKind: QdnSearchKind = options?.searchKind || 'all';
  const nomination = detectNominationIntent(query);
  const creative = detectCreativeAboutPersonIntent(query);
  const topicMediaIntent =
    searchKind === 'all' && !creative
      ? detectTopicMediaIntent(query)
      : null;
  const topicIntent =
    searchKind === 'all' || searchKind === 'users'
      ? searchKind === 'users' || creative
        ? false
        : detectTopicIntent(query)
      : false;
  const mediaIntent = detectMediaIntent(query);
  // Depth comes from Fast (quick / recent) vs Max (full history).
  const depth: QdnScanDepth = options?.depth === 'full' ? 'full' : 'quick';
  const onProgress = options?.onProgress;
  // For how-to / topical-media questions, skip name extraction.
  // Users chip always extracts names; media chips may use names for shelves.
  // Creative "poem about X" always extracts the person subject.
  const candidates =
    searchKind === 'users' || creative
      ? extractNameCandidates(query)
      : (topicIntent || topicMediaIntent) && !nomination
        ? []
        : extractNameCandidates(query);

  const controller = new AbortController();
  const timer = window.setTimeout(
    () => controller.abort(),
    // Full history of heavy accounts needs more headroom.
    options?.timeoutMs ?? (depth === 'full' ? 120_000 : 45_000)
  );

  try {
    // —— Chip-forced Videos / Images / Audio / Documents ——
    // Scope: publishes under the *exact* registered name + titles matching that name.
    // Never pull sibling primary/secondary names. Never fuzzy “Qortino” → “Qortino AI”.
    if (isMediaSearchKind(searchKind)) {
      const label = humanLabelForSearchKind(searchKind);
      onProgress?.(`QDN search · ${label}…`);
      const forcedKinds = mediaKindsForSearchKind(searchKind) || ['file'];
      const rawQuery = query.trim().replace(/[?!.]+$/g, '');
      const bareNeedle = bareNameNeedleFromSearchQuery(query);
      const rawNeedles = [
        ...(rawQuery.length >= 2 ? [rawQuery] : []),
        ...(bareNeedle.length >= 2 ? [bareNeedle] : []),
        ...(candidates.length > 0 ? candidates : extractNameCandidates(query)),
      ].filter(
        (n, i, arr) =>
          n && arr.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i
      );
      // Multi-word queries ("Qortal Justin") must not fall through to token
      // "Justin" — that title-browse pulls Justin Bieber / unrelated hits.
      const multiWordNeedles = rawNeedles.filter((n) => /\s/.test(n));
      const multiTokens = new Set(
        multiWordNeedles.flatMap((m) =>
          m.toLowerCase().split(/\s+/).filter(Boolean)
        )
      );
      const nameNeedles = (
        multiWordNeedles.length
          ? rawNeedles.filter(
              (n) => !(!/\s/.test(n) && multiTokens.has(n.toLowerCase()))
            )
          : rawNeedles
      ).slice(0, 4);

      let emptyExactProfile: QdnProfileCard | null = null;
      let emptyExactName = '';

      for (const needle of nameNeedles) {
        const hit = await resolveExactRegisteredName(needle, controller.signal);
        // Even if the name registry lookup fails, try publisher search under the
        // typed string — IMAGE/VIDEO can exist under a name the node hasn't indexed yet.
        const publisherName = hit?.name || needle;
        onProgress?.(
          `QDN ${label} · under ${publisherName} + titles matching “${publisherName}”…`
        );

        const shelf = await fetchMediaForName(publisherName, {
          kinds:
            searchKind === 'documents' ? ['pdf', 'file'] : forcedKinds,
          explicit: true,
          publisherSearch: true,
          signal: controller.signal,
          limits: {
            video: 24,
            audio: 24,
            image: 24,
            pdf: 16,
            file: 16,
          },
        }).catch(() => [] as QdnMediaItem[]);

        // Keep only resources published under this exact name (API can be loose).
        const shelfExact = shelf.filter(
          (m) => m.name.toLowerCase() === publisherName.toLowerCase()
        );

        const docs =
          searchKind === 'documents'
            ? await fetchDocumentLikeForName(
                publisherName,
                controller.signal,
                20
              )
            : [];
        const docsExact = docs.filter(
          (m) => m.name.toLowerCase() === publisherName.toLowerCase()
        );

        // Title browse only with the full publisher phrase (never a shortened token).
        const titleIntent = {
          ...buildForcedTopicMediaIntent(publisherName, searchKind),
          subject: publisherName.toLowerCase(),
          subjectLabel: publisherName,
          forced: true as const,
        };
        const titled = await searchTopicMedia(titleIntent, {
          signal: controller.signal,
          limit: 24,
        }).catch(() => null);

        const byPublisher = dedupeMediaItems([...shelfExact, ...docsExact]);
        const byTitle = (titled?.items || []).filter((item) => {
          // Publisher-scoped title hits must still be under this exact name OR
          // contain the full multi-word phrase (not a single shared token).
          const underName =
            item.name.toLowerCase() === publisherName.toLowerCase();
          const titleOk =
            titleMatchesSubject(item.title, publisherName) ||
            titleMatchesSubject(item.title, publisherName.toLowerCase());
          if (!titleOk) return false;
          if (underName) return true;
          // Open-network title matches: require the full phrase in the title
          // when the publisher name is multi-word (blocks "Justin" → Bieber).
          if (/\s/.test(publisherName)) {
            return item.title
              .toLowerCase()
              .includes(publisherName.toLowerCase());
          }
          return true;
        });

        const media = preferSubstantialVideos(
          dedupeMediaItems([...byPublisher, ...byTitle])
        ).slice(0, 24);

        if (hit) {
          const profile: QdnProfileCard = {
            name: hit.name,
            address: hit.address,
            level: 0,
            tags:
              hit.nameRole === 'secondary'
                ? [`Secondary · primary ${hit.primaryName}`]
                : ['Registered name'],
            avatarUrl: avatarUrlFor(hit.name, hit.address),
            description: hit.description || undefined,
            nameRole: hit.nameRole,
            primaryName: hit.primaryName,
          };
          if (media.length) {
            const underName = media.filter(
              (m) => m.name.toLowerCase() === hit.name.toLowerCase()
            ).length;
            const titleOnly = media.length - underName;
            const bits = [
              underName
                ? `${underName} published under **${hit.name}**`
                : null,
              titleOnly
                ? `${titleOnly} with “${hit.name}” in the title`
                : null,
            ].filter(Boolean);
            const lines = media
              .slice(0, 12)
              .map(
                (i, n) => `${n + 1}. ${i.title} · ${i.kind} · ${i.name}`
              );
            const answer = `Here are ${label.toLowerCase()} for **${hit.name}** (${bits.join('; ') || media.length + ' shown'}). Tap a card to open or play.`;
            return {
              chunks: [
                {
                  text: `[QDN search · ${label} · ${hit.name}]\nScope: publishes under this name + titles matching the name. Not other names on the same account.\n${lines.join('\n')}\nREQUIRED: summarize only these real titles.`,
                },
              ],
              detail: `QDN ${label} · ${hit.name} · ${media.length}`,
              profiles: [profile],
              media,
              directAnswer: answer,
              mediaLayout: 'grid',
            };
          }
          // Exact name registered but empty shelf — stop here. Do not try
          // shorter needles / open "Justin" title browse.
          emptyExactProfile = profile;
          emptyExactName = hit.name;
          break;
        }

        // No registry hit, but publisher search found media under the typed name.
        if (media.length) {
          const lines = media
            .slice(0, 12)
            .map(
              (i, n) => `${n + 1}. ${i.title} · ${i.kind} · ${i.name}`
            );
          return {
            chunks: [
              {
                text: `[QDN search · ${label} · ${publisherName}]\nScope: publishes under this name + titles matching the name.\n${lines.join('\n')}\nREQUIRED: summarize only these real titles.`,
              },
            ],
            detail: `QDN ${label} · ${publisherName} · ${media.length}`,
            profiles: [],
            media,
            directAnswer: `Here are ${label.toLowerCase()} for **${publisherName}** (${media.length} shown). Tap a card to open or play.`,
            mediaLayout: 'grid',
          };
        }
      }

      if (emptyExactProfile && emptyExactName) {
        return {
          chunks: [
            {
              text: `[QDN search · ${label} · ${emptyExactName}]\nNo ${label.toLowerCase()} published under this name, and no titles matching “${emptyExactName}”.`,
            },
          ],
          detail: `QDN ${label} · ${emptyExactName} · none`,
          profiles: [emptyExactProfile],
          media: [],
          directAnswer: `No ${label.toLowerCase()} found under **${emptyExactName}**, and none with “${emptyExactName}” in the title on this node.`,
        };
      }

      // Open title browse only when no exact registered name was found.
      // Keep the full multi-word phrase — never last-token "justin".
      const forced = buildForcedTopicMediaIntent(query, searchKind);
      if (bareNeedle.length >= 2) {
        forced.subject = bareNeedle.toLowerCase();
        forced.subjectLabel = bareNeedle;
      } else if (rawQuery.length >= 2 && /\s/.test(rawQuery)) {
        forced.subject = rawQuery.toLowerCase();
        forced.subjectLabel = rawQuery;
      }
      const topicMedia = await searchTopicMedia(forced, {
        signal: controller.signal,
        limit: 24,
      });
      console.info('[Qortino QDN] forced kind search', {
        query,
        searchKind,
        subject: forced.subject,
        count: topicMedia.items.length,
      });
      return {
        chunks: topicMedia.context ? [{ text: topicMedia.context }] : [],
        detail: topicMedia.detail,
        profiles: [],
        media: topicMedia.items,
        directAnswer: topicMedia.answer,
        mediaLayout: 'grid',
      };
    }

    // —— Users chip: people / names ONLY (never topic / video keyword search) ——
    // Creative "poem about X" falls through so the LLM can write (not dump a dossier).
    if (searchKind === 'users' && !creative) {
      onProgress?.('QDN search · Users…');
      const typedRaw = query.trim().replace(/[?!.]+$/g, '');
      // Strip filler so "find information about qortal justin please" → name.
      const typed =
        tidyNameCandidate(typedRaw) ||
        typedRaw
          .replace(
            /\b(user|users|people|person|name|names|find|search|look\s*up|who\s+is|information|info|details|data|about|please|thanks|thank|you|me|get|show|give|tell)\b/gi,
            ' '
          )
          .replace(/\s+/g, ' ')
          .trim();
      // Prefer the extracted/cleaned name first ("Qortal Justin"), then extractors.
      const userCandidates = [
        ...(typed.length >= 2 ? [typed] : []),
        ...extractNameCandidates(query),
        ...candidates,
      ].filter(
        (n, i, arr) =>
          n &&
          n.length >= 2 &&
          arr.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i
      );
      if (!userCandidates.length) {
        return {
          chunks: [],
          detail: 'QDN Users · need a name',
          profiles: [],
          media: [],
          directAnswer:
            'Users search looks up registered Qortal names. Type a name (for example Crowetic or Qortal Justin), or switch to All for a general QDN search.',
        };
      }

      let hit: ResolvedName | null = null;
      for (const candidate of userCandidates.slice(0, 5)) {
        onProgress?.(`Looking up registered name “${candidate}”…`);
        hit = await resolvePersonNameStrict(candidate, controller.signal);
        if (hit) break;
      }

      if (!hit) {
        return {
          chunks: [],
          detail: `QDN Users · no match for ${userCandidates[0]}`,
          profiles: [],
          media: [],
          directAnswer: `No registered Qortal name matched “${typed || userCandidates[0]}”. Check the spelling (small typos are OK — try again), or switch to All for a general QDN search.`,
        };
      }

      onProgress?.(
        depth === 'full'
          ? `Full history scan for ${hit.name}…`
          : `Quick QDN look for ${hit.name}…`
      );
      const [dossier, mediaRaw] = await Promise.all([
        fetchUserQdnDossier(hit.name, controller.signal, {
          viewerAddress: options?.viewerAddress,
          depth,
          onProgress,
        }),
        fetchMediaForOwnedNames([hit.name], {
          kinds: ['video', 'audio', 'image', 'pdf', 'file'],
          explicit: true,
          signal: controller.signal,
          limit: 24,
          preferredName: hit.name,
        }).catch(() => [] as QdnMediaItem[]),
      ]);
      const media = mediaRaw.filter(
        (m) => m.name.toLowerCase() === hit!.name.toLowerCase()
      );

      if (!dossier) {
        const profile: QdnProfileCard = {
          name: hit.name,
          address: hit.address,
          level: 0,
          tags:
            hit.nameRole === 'secondary'
              ? [`Secondary · primary ${hit.primaryName}`]
              : ['Registered name'],
          avatarUrl: avatarUrlFor(hit.name, hit.address),
          description: hit.description || undefined,
          nameRole: hit.nameRole,
          primaryName: hit.primaryName,
        };
        return {
          chunks: [],
          detail: `QDN Users · ${hit.name} · registry only`,
          profiles: [profile],
          media,
          directAnswer: `Found registered name **${hit.name}**, but this node could not load a full account dossier yet. Address: \`${hit.address}\`. Try Max for a deeper scan, or ask again shortly.`,
          depth,
        };
      }

      const mediaContext = mediaItemsToContext(media);
      const directAnswer = formatDirectWhoIsAnswer(dossier, false);
      const characterDrafts = (dossier.characterSummary || '').trim()
        ? [
            {
              name: dossier.name,
              roleLine: buildRoleStatement(dossier.name, dossier.tags),
              level: dossier.level,
              themes: dossier.contentThemes || [],
              publishes: dossier.publishSignals || [],
              seedPortrait: dossier.characterSummary || '',
            },
          ]
        : undefined;
      console.info('[Qortino QDN] Users person ready', {
        name: dossier.name,
        media: media.length,
        directAnswerChars: directAnswer.length,
      });
      return {
        chunks: [
          {
            text: writtenSummaryToLlmContext(
              'profile',
              dossier.profileSummary,
              dossier.name
            ),
          },
          { text: `[QDN user scan · ${dossier.name}]\n${dossier.text}` },
          ...(mediaContext
            ? [{ text: `[QDN media shelf]\n${mediaContext}` }]
            : []),
        ],
        detail: media.length
          ? `QDN Users · ${dossier.name} · ${media.length} media`
          : `QDN Users · ${dossier.name}`,
        profiles: [
          {
            name: dossier.name,
            address: dossier.address,
            level: dossier.level,
            tags: dossier.tags,
            avatarUrl: dossier.avatarUrl,
            description: dossier.description,
            characterSummary: dossier.characterSummary,
            nameRole: dossier.nameRole,
            primaryName: dossier.primaryName,
          },
        ],
        media,
        publishedSites: dossier.publishedSites,
        quitterPosts: mergeQuitterPosts(dossier.quitterPosts || [], 3),
        ownedNames: dossier.stats.ownedNames.map((n) => ({
          name: n,
          address: dossier.address,
          isPrimary: n.toLowerCase() === dossier.primaryName.toLowerCase(),
          avatarUrl: avatarUrlFor(n, dossier.address),
        })),
        extraLinks: dossier.extraLinks,
        directAnswer,
        depth,
        characterDrafts,
      };
    }

    // —— Topical media browse ("show me images of the dogs") ——
    if (topicMediaIntent) {
      const topicMedia = await searchTopicMedia(topicMediaIntent, {
        signal: controller.signal,
        limit: 24,
      });
      console.info('[Qortino QDN] topic media', {
        query,
        subject: topicMediaIntent.subject,
        kinds: topicMediaIntent.kinds,
        count: topicMedia.items.length,
      });
      return {
        chunks: topicMedia.context ? [{ text: topicMedia.context }] : [],
        detail: topicMedia.detail,
        profiles: [],
        media: topicMedia.items,
        /** Prefer the ready-made answer + image grid over LLM paraphrase */
        directAnswer: topicMedia.answer,
        mediaLayout: 'grid' as const,
      };
    }

    // —— Topical QDN search (how to change a tire, purify water, …) ——
    if (topicIntent || (!candidates.length && !nomination)) {
      const topic = await searchQdnTopic(query, {
        signal: controller.signal,
        limit: 8,
      });
      console.info('[Qortino QDN] topic search', {
        query,
        terms: topic.detail,
        hits: topic.hits.length,
      });
      // If this was clearly topical, return topic results (even if empty context note).
      if (topicIntent || topic.hits.length) {
        return {
          chunks: topic.context ? [{ text: topic.context }] : [],
          detail: topic.detail,
          profiles: [],
          media: topic.media,
        };
      }
      // Fall through to name scan only when topic search found nothing and we
      // still have name candidates (e.g. ambiguous query).
      if (!candidates.length) {
        return {
          chunks: topic.context ? [{ text: topic.context }] : [],
          detail: topic.detail,
          profiles: [],
          media: [],
        };
      }
    }

    if (!candidates.length) {
      return {
        chunks: [],
        detail:
          'QDN mode: no Qortal name or topic match — answer from Qortino’s on-device knowledge only.',
        profiles: [],
        media: [],
      };
    }

    // Prefer full multi-word names first ("Qortal Justin" / "Simon James").
    // Never fall back to token "Justin" when the user typed a multi-word name —
    // that pulled Justin Bieber videos / wrong Qortal-* prefix accounts.
    const resolved: Array<{ candidate: string } & ResolvedName> = [];
    const tried: string[] = [];
    const multiWord = candidates.filter((c) => c.includes(' '));
    const singleWord = candidates.filter((c) => !c.includes(' '));
    const multiTokens = new Set(
      multiWord.flatMap((m) => m.toLowerCase().split(/\s+/).filter(Boolean))
    );
    // When a multi-word phrase was typed, ignore its split tokens as candidates.
    const singleWordSafe = multiWord.length
      ? singleWord.filter((s) => !multiTokens.has(s.toLowerCase()))
      : singleWord;

    const personStrict =
      searchKind === 'users' ||
      nomination ||
      !!creative ||
      /\bwho\s*is\b|\bwhobis\b/i.test(query) ||
      wantsQdnPersonDepthChoice(query);

    for (const candidate of multiWord.slice(0, 3)) {
      tried.push(candidate);
      const hit = personStrict
        ? await resolvePersonNameStrict(candidate, controller.signal)
        : (await resolveExactRegisteredName(candidate, controller.signal)) ||
          (await resolveName(candidate, controller.signal));
      if (hit) {
        resolved.push({ candidate, ...hit });
        break;
      }
    }

    if (!resolved.length) {
      for (const candidate of singleWordSafe.slice(0, 3)) {
        tried.push(candidate);
        const hit = personStrict
          ? await resolvePersonNameStrict(candidate, controller.signal)
          : (await resolveExactRegisteredName(candidate, controller.signal)) ||
            (await resolveName(candidate, controller.signal));
        if (!hit) continue;
        const alreadyCovered = resolved.some(
          (r) =>
            r.name.toLowerCase() === hit.name.toLowerCase() ||
            r.address === hit.address
        );
        if (!alreadyCovered) resolved.push({ candidate, ...hit });
        if (resolved.length >= 1) break;
      }
    }

    console.info('[Qortino QDN] name candidates', {
      query,
      candidates,
      tried,
      resolved: resolved.map((r) => `${r.name} (${r.nameRole})`),
    });

    if (!resolved.length) {
      if (searchKind === 'users') {
        return {
          chunks: [],
          detail: `QDN Users · no match for ${candidates[0] || 'query'}`,
          profiles: [],
          media: [],
          directAnswer: `No registered Qortal name matched “${candidates[0] || query.trim()}”. Try another spelling, or switch to All for a general QDN search.`,
        };
      }
      // Name-looking query failed — try a topic search before giving up.
      const topic = await searchQdnTopic(query, {
        signal: controller.signal,
        limit: 8,
      }).catch(() => null);
      if (topic?.hits.length) {
        return {
          chunks: topic.context ? [{ text: topic.context }] : [],
          detail: topic.detail,
          profiles: [],
          media: topic.media,
        };
      }
      return {
        chunks: [
          {
            text: `[QDN scan] No registered Qortal name matched for: ${candidates.join(', ')}. Say you could not find that name on QDN / the name registry.`,
          },
        ],
        detail: `No QDN match for ${candidates[0]}…`,
        profiles: [],
        media: [],
      };
    }

    const results = await Promise.all(
      resolved.map(async ({ name, address }) => {
        onProgress?.(
          depth === 'full'
            ? `Full history scan for ${name}…`
            : `Quick QDN look for ${name}…`
        );
        const [dossier, media] = await Promise.all([
          // Always resolve dossier by the registered hit name (not a fuzzy candidate).
          fetchUserQdnDossier(name, controller.signal, {
            viewerAddress: options?.viewerAddress,
            depth,
            onProgress,
          }),
          (async () => {
            // Users / who-is: shelf under the resolved name only — sibling names
            // on the same address were mixing in unrelated viral reuploads.
            const usersOrPerson = searchKind === 'users' || personStrict;
            onProgress?.(
              usersOrPerson
                ? `Checking live media under ${name}…`
                : depth === 'full'
                  ? `Full scan · media across owned names for ${name}…`
                  : `Checking live media for ${name}…`
            );
            const kinds =
              searchKind === 'users'
                ? (['video', 'audio', 'image', 'pdf', 'file'] as const)
                : mediaIntent.kinds;
            if (usersOrPerson) {
              const shelf = await fetchMediaForOwnedNames([name], {
                kinds: [...kinds],
                explicit: true,
                signal: controller.signal,
                limit: 24,
                preferredName: name,
              }).catch(() => [] as QdnMediaItem[]);
              // Final guard: Users/who-is never shows another publisher's media.
              return shelf.filter(
                (m) => m.name.toLowerCase() === name.toLowerCase()
              );
            }
            const owned = await fetchAllOwnedNames(
              address,
              controller.signal
            ).catch(() => [name]);
            const nameList = owned.length ? owned : [name];
            // Never title-browse the open network for person shelves.
            return fetchMediaForOwnedNames(nameList, {
              kinds: [...kinds],
              explicit: true,
              signal: controller.signal,
              limit: depth === 'full' ? 24 : 12,
              preferredName: name,
            }).catch(() => [] as QdnMediaItem[]);
          })(),
        ]);
        return { dossier, media, name, address };
      })
    );

    const dossiers = results
      .map((r) => r.dossier)
      .filter((d): d is QdnDossier => !!d);
    const media = results.flatMap((r) => r.media);
    const mediaContext = mediaItemsToContext(media);

    if (!dossiers.length) {
      // Never hand the LLM loose media without a person dossier — that caused
      // Justin Bieber / Qortal-News-Network hallucinations for name lookups.
      return {
        chunks: [
          {
            text: `[QDN scan] No registered Qortal name matched for: ${candidates.join(', ')}. Say you could not find that name on QDN / the name registry.`,
          },
        ],
        detail: `No QDN match for ${candidates[0]}…`,
        profiles: [],
        media: [],
        directAnswer: `No registered Qortal name matched “${candidates[0] || query.trim()}”. Try another spelling, or switch to All for a general QDN search.`,
      };
    }

    const readyChunks = dossiers.map((d) => ({
      text: writtenSummaryToLlmContext(
        nomination ? 'nomination' : 'profile',
        nomination ? d.nominationSummary : d.profileSummary,
        d.name
      ),
    }));

    const creativeChunks = creative
      ? dossiers.map((d) => {
          const rel =
            creative.relation === 'to'
              ? 'TO'
              : creative.relation === 'for'
                ? 'FOR'
                : 'ABOUT';
          return {
            text:
              `[QDN compose brief · ${creative.formLabel} ${creative.relation} ${d.name}]\n` +
              `USER REQUEST (fulfill this — this is the main job):\n` +
              `"""\n${query.trim()}\n"""\n\n` +
              `CRITICAL:\n` +
              `- Produce the requested ${creative.formLabel} ${rel.toLowerCase()} **${d.name}** (or addressed to them).\n` +
              `- "${creative.form}" / "${creative.formLabel}" is the deliverable type, NOT a Qortal account name.\n` +
              `- QDN notes below are BACKGROUND only — use them to personalize tone, greeting, or relevant detail.\n` +
              `- Do NOT replace the request with a who-is dossier dump or a biography essay.\n` +
              `- Do NOT invent biography, jobs, or facts not supported by the notes.\n` +
              `- If they asked to ask ${d.name} how to do something, write that message/question in a natural voice.\n\n` +
              `QDN background on ${d.name}:\n${d.profileSummary}\n\n${d.text}`,
          };
        })
      : [];

    const chunks = creative
      ? [
          ...creativeChunks,
          ...(mediaContext
            ? [{ text: `[QDN media shelf · optional colour]\n${mediaContext}` }]
            : []),
        ]
      : [
          ...readyChunks,
          ...dossiers.map((d) => ({
            text: `[QDN user scan · ${d.name}]\n${d.text}`,
          })),
          ...(mediaContext
            ? [{ text: `[QDN media shelf]\n${mediaContext}` }]
            : []),
        ];

    // Skip the on-device LLM for who-is / bare-name profiles — small models
    // invent fiction (and "game" / unrelated pack topics) when paraphrasing.
    // Creative requests ("poem about X") MUST use the LLM with the brief above.
    const directAnswer = creative
      ? undefined
      : dossiers
          .map((d) => formatDirectWhoIsAnswer(d, nomination))
          .join('\n\n———\n\n');

    console.info('[Qortino QDN] person dossier ready', {
      names: dossiers.map((d) => d.name),
      levels: dossiers.map((d) => d.level),
      tags: dossiers.map((d) => d.tags),
      media: media.length,
      creative: creative?.formLabel || null,
      directAnswerChars: directAnswer?.length || 0,
    });

    const publishedSites = dossiers.flatMap((d) => d.publishedSites || []);
    const quitterPosts = mergeQuitterPosts(
      dossiers.flatMap((d) => d.quitterPosts || []),
      3
    );
    const extraLinks: OfficialResourceLink[] = [];
    const seenExtra = new Set<string>();
    for (const d of dossiers) {
      for (const l of d.extraLinks || []) {
        if (seenExtra.has(l.id)) continue;
        seenExtra.add(l.id);
        extraLinks.push(l);
      }
    }
    const ownedNames: QdnOwnedNameCard[] = [];
    const seenOwned = new Set<string>();
    for (const d of dossiers) {
      for (const n of d.stats.ownedNames) {
        const key = n.toLowerCase();
        if (seenOwned.has(key)) continue;
        seenOwned.add(key);
        ownedNames.push({
          name: n,
          address: d.address,
          isPrimary: n.toLowerCase() === d.primaryName.toLowerCase(),
          avatarUrl: avatarUrlFor(n, d.address),
        });
      }
    }
    ownedNames.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const characterDrafts = dossiers
      .filter((d) => (d.characterSummary || '').trim())
      .map((d) => ({
        name: d.name,
        roleLine: buildRoleStatement(d.name, d.tags),
        level: d.level,
        themes: d.contentThemes || [],
        publishes: d.publishSignals || [],
        seedPortrait: d.characterSummary || '',
      }));

    return {
      chunks,
      detail: creative
        ? `Composing ${creative.formLabel} ${creative.relation} ${dossiers.map((d) => d.name).join(', ')} (QDN as background)…`
        : nomination
          ? `Nomination draft ready · ${dossiers.map((d) => d.name).join(', ')}`
          : media.length
            ? `QDN scan ready · ${dossiers.map((d) => d.name).join(', ')} · ${media.length} media`
            : `QDN scan ready · ${dossiers.map((d) => d.name).join(', ')}`,
      profiles: dossiers.map((d) => ({
        name: d.name,
        address: d.address,
        level: d.level,
        tags: d.tags,
        avatarUrl: d.avatarUrl,
        description: d.description,
        // Don't stream character polish over a poem request.
        characterSummary: creative ? undefined : d.characterSummary,
        nameRole: d.nameRole,
        primaryName: d.primaryName,
      })),
      media: creative ? [] : media,
      publishedSites: creative ? undefined : publishedSites,
      quitterPosts:
        creative || !quitterPosts.length ? undefined : quitterPosts,
      ownedNames: creative ? undefined : ownedNames,
      extraLinks: creative || !extraLinks.length ? undefined : extraLinks,
      directAnswer,
      depth,
      characterDrafts:
        creative || !characterDrafts.length ? undefined : characterDrafts,
    };
  } finally {
    window.clearTimeout(timer);
  }
}
