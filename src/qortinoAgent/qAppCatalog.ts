/**
 * Curated Q-App / WEBSITE directory for Qortino.
 * Sources: Qortal GitHub/Gitea repos, QDN publish metadata, crowetic Gitea apps.
 * Offline answers use this catalog; QDN mode adds live avatars + open-in-tab.
 */
import { executeEvent } from '../utils/events';
import {
  getBaseApiReact,
  getBaseApiReactForAvatar,
} from '../utils/globalApi';
import { parkQortinoAgentSheet } from './qortinoSheetNav';
import {
  isGenericConceptNeedle,
  isQortalNetworkDefinitionQuery,
} from './queryIntent';

export type QAppService = 'APP' | 'WEBSITE';

export type QAppCatalogEntry = {
  id: string;
  /** Canonical QDN name */
  name: string;
  service: QAppService;
  /** Alternate QDN names / spellings */
  aliases?: string[];
  title: string;
  summary: string;
  /** Short tags for matching */
  tags?: string[];
  repo?: string;
};

/** Live publisher identity for a QDN APP/WEBSITE name. */
export type QAppPublisherInfo = {
  /** Name the APP/WEBSITE is published under */
  publishName: string;
  ownerAddress: string;
  /** Account primary name (may match publishName) */
  primaryName: string;
  avatarUrl: string;
  level: number;
};

export type MatchedQApp = {
  entry: QAppCatalogEntry;
  score: number;
  publisher?: QAppPublisherInfo | null;
};

export const Q_APP_CATALOG: QAppCatalogEntry[] = [
  {
    id: 'q-assets',
    name: 'Q-Assets',
    service: 'APP',
    aliases: ['qassets', 'assets app', 'asset manager'],
    title: 'Q-Assets',
    summary:
      'Issue, manage, trade, and document native Qortal assets (not EVM tokens). QORT itself is asset ID 0 and is created by minting/consensus; other assets are issued with a full max supply by an issuer and are best thought of as ownership/stock-like instruments on-chain. Browse portfolios, community details, and asset info inside the app.',
    tags: ['assets', 'trade', 'portfolio'],
    repo: 'https://github.com/Qortal/Q-Assets',
  },
  {
    id: 'q-tube',
    name: 'Q-Tube',
    service: 'APP',
    aliases: ['qtube', 'video app'],
    title: 'Q-Tube',
    summary:
      'Decentralized video publishing and playback on QDN — upload, browse, and watch community videos without a corporate host.',
    tags: ['video', 'media', 'watch'],
    repo: 'https://github.com/Qortal/Q-Tube',
  },
  {
    id: 'ear-bump',
    name: 'Ear-Bump',
    service: 'APP',
    aliases: ['earbump', 'ear bump', 'music app'],
    title: 'Ear-Bump',
    summary:
      'Decentralized audio / music publishing and listening on Qortal.',
    tags: ['music', 'audio', 'listen'],
    repo: 'https://github.com/Qortal/Ear-Bump',
  },
  {
    id: 'q-mail',
    name: 'Q-Mail',
    service: 'APP',
    aliases: ['qmail', 'mail'],
    title: 'Q-Mail',
    summary: 'Encrypted mail-style messaging between Qortal names.',
    tags: ['mail', 'message'],
    repo: 'https://github.com/Qortal/Q-Mail',
  },
  {
    id: 'q-blog',
    name: 'Q-Blog',
    service: 'APP',
    aliases: ['qblog', 'blog app'],
    title: 'Q-Blog',
    summary: 'Long-form blogging / articles published on QDN.',
    tags: ['blog', 'articles', 'website'],
    repo: 'https://github.com/Qortal/Q-Blog',
  },
  {
    id: 'q-share',
    name: 'Q-Share',
    service: 'APP',
    aliases: ['qshare', 'file share'],
    title: 'Q-Share',
    summary: 'Share files and folders over QDN.',
    tags: ['files', 'share'],
    repo: 'https://github.com/Qortal/Q-Share',
  },
  {
    id: 'q-search',
    name: 'Q-Search',
    service: 'APP',
    aliases: ['qsearch', 'search app'],
    title: 'Q-Search',
    summary: 'Search published QDN resources from inside Qortal.',
    tags: ['search'],
    repo: 'https://github.com/Qortal/Q-Search',
  },
  {
    id: 'q-support',
    name: 'Q-Support',
    service: 'APP',
    aliases: ['qsupport', 'support app'],
    title: 'Q-Support',
    summary: 'Community support / helpdesk-style Q-App.',
    tags: ['support', 'help'],
  },
  {
    id: 'q-node',
    name: 'Q-Node',
    service: 'APP',
    aliases: ['qnode', 'node app', 'qortal node app'],
    title: 'Q-Node',
    summary:
      'Node status and minting-account helpers for people running a Qortal core.',
    tags: ['node', 'minting', 'status'],
  },
  {
    id: 'names',
    name: 'Names',
    service: 'APP',
    aliases: ['names app', 'name manager', 'q-names'],
    title: 'Names',
    summary: 'Browse and manage registered Qortal names.',
    tags: ['names', 'identity'],
  },
  {
    id: 'q-trade',
    name: 'Q-Trade',
    service: 'APP',
    aliases: ['qtrade', 'trade portal app'],
    title: 'Q-Trade',
    summary: 'Trade-related Q-App surface around QORT cross-chain trading.',
    tags: ['trade', 'exchange'],
  },
  {
    id: 'q-mintership',
    name: 'Q-Mintership',
    service: 'APP',
    aliases: ['qmintership', 'mintership app', 'nomination board'],
    title: 'Q-Mintership',
    summary:
      'Live nomination board for minting rights — cards, admin votes, and MINTER group invites.',
    tags: ['minting', 'nomination', 'admin'],
    repo: 'https://gitea.qortal.org/crowetic/Q-Mintership-Alpha',
  },
  {
    id: 'q-minter-guide',
    name: 'Q-Minter',
    service: 'WEBSITE',
    aliases: ['q-minter guide', 'minter guide', 'qminter'],
    title: 'Q-Minter Guide',
    summary:
      'Detailed on-QDN website guide to minting on Qortal — concepts, levels, and practical setup. Pair with Q-Mintership for the live nomination board.',
    tags: ['minting', 'guide', 'docs'],
  },
  {
    id: 'welcome',
    name: 'Welcome to Qortal',
    service: 'APP',
    aliases: ['welcome app', 'welcome to qortal app'],
    title: 'Welcome to Qortal',
    summary:
      'Newcomer orientation Q-App — first steps, core ideas, and where to go next on the network.',
    tags: ['onboarding', 'beginner', 'start'],
  },
  {
    id: 'quitter',
    name: 'Quitter',
    service: 'APP',
    aliases: ['q-twitter', 'microblog'],
    title: 'Quitter',
    summary:
      'Decentralized microblogging / short-post social Q-App on Qortal.',
    tags: ['social', 'posts', 'feed'],
    repo: 'https://github.com/Qortal/Quitter',
  },
  {
    id: 'subwire',
    name: 'SubWire',
    service: 'APP',
    aliases: ['sub wire', 'subwire'],
    title: 'SubWire',
    summary:
      'Decentralized publishing for articles, episodes, audio/video, author profiles, and private subscriber content.',
    tags: ['publish', 'articles', 'subscribe'],
    repo: 'https://github.com/Qortal/Subwire',
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    service: 'APP',
    aliases: ['q-subscriptions'],
    title: 'Subscriptions',
    summary:
      'Create and manage QORT-based subscriptions for private Qortal groups — billing, join requests, and subscriber status.',
    tags: ['subscribe', 'groups', 'billing'],
  },
  {
    id: 'qwb',
    name: 'QWB',
    service: 'APP',
    aliases: ['qortal web builder', 'web builder', 'q-web-builder'],
    title: 'Qortal Web Builder',
    summary:
      'Interactive website builder for Qortal — create personal pages, sites, or community fronts published on QDN.',
    tags: ['website', 'builder', 'no-code'],
  },
  {
    id: 'q-charts',
    name: 'Q-Charts',
    service: 'APP',
    aliases: ['qcharts', 'trade charts'],
    title: 'Q-Charts',
    summary: 'Charts Q-App for reviewing QORT trade chart data on Qortal.',
    tags: ['charts', 'trade', 'price'],
    repo: 'https://gitea.qortal.org/crowetic/Q-Charts',
  },
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\s+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Network nouns — never treat these as a specific Q-App name. */
const GENERIC_NETWORK_NEEDLES = new Set([
  'qortal',
  'qdn',
  'qort',
  'blockchain',
  'network',
  'crypto',
  'coin',
  'app',
  'apps',
  'q app',
  'q apps',
  'q-app',
  'q-apps',
]);

function isGenericNetworkNeedle(s: string): boolean {
  const n = normalize(s);
  return !n || GENERIC_NETWORK_NEEDLES.has(n);
}

function isInterrogativeQuery(t: string): boolean {
  return /^(what|who|how|why|where|when|is|are|can|do|does|did|should|could|would|tell|explain|define|describe|list|show|find|look)\b/.test(
    t
  );
}

/** True when a catalog string looks like a real product id/title, not a tag. */
function isStrongAppLabel(c: string): boolean {
  const n = normalize(c);
  if (!n || n.length < 2) return false;
  if (n.startsWith('q-') || n.startsWith('q ')) return true;
  if (n.includes('-')) return true;
  if (n.split(/\s+/).length >= 2) return true; // Welcome to Qortal, Ear Bump…
  // Single-token product names that are distinctive (not generic concepts).
  if (/^(quitter|subwire|subscriptions|qwb)$/.test(n)) return true;
  return false;
}

/** Extract a likely app name from questions like "what is q-assets". */
export function extractQAppQueryName(query: string): string | null {
  const t = normalize(query);
  const patterns = [
    /^(?:what is|what's|whats|explain|tell me about|open|launch)\s+(.+?)(?:\s+q-?app)?\??$/,
    /^(?:how (?:do i|to) (?:use|open))\s+(.+?)(?:\s+q-?app)?\??$/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const name = m[1]
        .replace(/\bq-?app\b/g, '')
        .replace(/^\s*the\s+/i, '')
        .trim();
      if (isGenericNetworkNeedle(name)) return null;
      // Generic concepts ("minting", "names", "trade") only when user said "… app".
      if (isGenericConceptNeedle(name) && !/\bapp\b/.test(t) && !isStrongAppLabel(name)) {
        return null;
      }
      return name;
    }
  }
  // Bare product name only — never whole interrogative sentences.
  if (isInterrogativeQuery(t)) return null;
  if (/^[a-z0-9][a-z0-9 +.-]{1,40}$/.test(t) && !/\s{2,}/.test(t)) {
    if (isGenericNetworkNeedle(t)) return null;
    if (isGenericConceptNeedle(t) && !isStrongAppLabel(t)) return null;
    return t;
  }
  return null;
}

export function matchQAppCatalog(query: string): MatchedQApp | null {
  const t = normalize(query);
  if (!t || t.length < 2) return null;
  if (isQortalNetworkDefinitionQuery(query)) return null;

  // Group / roster phrasing — never an app card.
  if (
    /\b(owner|admins?|members?|digest|this week|last week)\b/.test(t) &&
    /\b(group|welcome to qortal)\b/.test(t)
  ) {
    return null;
  }

  const extracted = extractQAppQueryName(query);
  // Without a clear product needle, do not fuzzy the whole sentence against
  // tags — that caused "what is minting" → Q-Node.
  if (!extracted) return null;

  const needle = normalize(extracted);
  if (!needle) return null;
  if (isGenericNetworkNeedle(needle)) return null;
  if (
    isGenericConceptNeedle(needle) &&
    !/\bapp\b/.test(t) &&
    !isStrongAppLabel(needle) &&
    !needle.startsWith('q-')
  ) {
    return null;
  }

  let best: MatchedQApp | null = null;
  for (const entry of Q_APP_CATALOG) {
    // Strong labels only for high-confidence short-circuit (≥0.8).
    const strong = [
      entry.name,
      entry.title,
      entry.id,
      ...(entry.aliases || []),
    ].map(normalize);
    // Tags are soft-only (never ≥0.8 by themselves).
    const tagLabels = (entry.tags || []).map((tag) => normalize(`${tag} app`));

    let local = 0;
    for (const c of strong) {
      if (!c) continue;
      if (needle === c || t === c) {
        local = Math.max(local, 1);
        continue;
      }
      const compactN = needle.replace(/[\s_-]+/g, '');
      const compactC = c.replace(/[\s_-]+/g, '');
      if (compactN && compactN === compactC) {
        local = Math.max(local, 1);
        continue;
      }

      // Query contains full strong label ("open Welcome to Qortal")
      if (t.includes(c) && isStrongAppLabel(c)) {
        local = Math.max(local, 0.9);
        continue;
      }

      // Needle is a clear product chunk inside a longer title, or vice versa
      if (
        isStrongAppLabel(c) &&
        !isGenericConceptNeedle(needle) &&
        needle.length >= 4 &&
        (needle.includes(c) ||
          (c.includes(needle) &&
            (c.split(/\s+/).includes(needle) ||
              needle.length / c.length >= 0.5)))
      ) {
        local = Math.max(local, 0.85);
        continue;
      }

      if (
        compactN.length >= 5 &&
        isStrongAppLabel(c) &&
        !isGenericConceptNeedle(needle) &&
        (compactN === compactC ||
          (compactC.includes(compactN) &&
            compactN.length / Math.max(compactC.length, 1) >= 0.5) ||
          (compactN.includes(compactC) && compactC.length >= 5))
      ) {
        local = Math.max(local, 0.85);
      }
    }

    // Soft tag hint only when user said "app"
    if (/\bapp\b/.test(t)) {
      for (const c of tagLabels) {
        if (c && (needle === c || t.includes(c))) {
          local = Math.max(local, 0.55);
        }
      }
      if (
        entry.tags?.some(
          (tag) => t.includes(normalize(tag)) && t.includes('app')
        )
      ) {
        local = Math.max(local, 0.55);
      }
    }

    if (local >= 0.75 && (!best || local > best.score)) {
      best = { entry, score: local };
    }
  }
  return best;
}

/** Resolve who published a QDN APP/WEBSITE name (owner address + primary name). */
export function fetchQAppPublisher(
  publishName: string,
  signal?: AbortSignal
): Promise<QAppPublisherInfo | null> {
  const name = publishName.trim();
  if (!name) return Promise.resolve(null);
  const base = getBaseApiReact().replace(/\/$/, '');
  return (async () => {
    try {
      const nameRes = await fetch(`${base}/names/${encodeURIComponent(name)}`, {
        signal,
      });
      if (!nameRes.ok) return null;
      const nameData = (await nameRes.json()) as { name?: string; owner?: string };
      const ownerAddress = (nameData.owner || '').trim();
      if (!ownerAddress) return null;

      let primaryName = '';
      try {
        const primaryRes = await fetch(
          `${base}/names/primary/${encodeURIComponent(ownerAddress)}`,
          { signal }
        );
        if (primaryRes.ok) {
          const primary = (await primaryRes.json()) as { name?: string };
          primaryName = (primary.name || '').trim();
        }
      } catch {
        // optional
      }

      let level = 0;
      try {
        const addrRes = await fetch(
          `${base}/addresses/${encodeURIComponent(ownerAddress)}`,
          { signal }
        );
        if (addrRes.ok) {
          const addr = (await addrRes.json()) as { level?: number };
          level = typeof addr.level === 'number' ? addr.level : 0;
        }
      } catch {
        // optional
      }

      const displayName = primaryName || nameData.name || name;
      return {
        publishName: nameData.name || name,
        ownerAddress,
        primaryName: primaryName || displayName,
        avatarUrl: qAppAvatarUrl(displayName),
        level,
      };
    } catch {
      return null;
    }
  })();
}

export function formatQAppAnswer(
  entry: QAppCatalogEntry,
  publisher?: QAppPublisherInfo | null
): string {
  const where =
    entry.service === 'WEBSITE'
      ? `Open it as WEBSITE “${entry.name}” (qortal://${entry.service}/${entry.name}).`
      : `Open it as APP “${entry.name}” (qortal://${entry.service}/${entry.name}).`;
  let pub = '';
  if (publisher) {
    const same =
      publisher.primaryName.toLowerCase() ===
      publisher.publishName.toLowerCase();
    pub = same
      ? ` Published by ${publisher.primaryName} (Level ${publisher.level}).`
      : ` Published under “${publisher.publishName}” by ${publisher.primaryName} (Level ${publisher.level}).`;
  }
  return `${entry.title}: ${entry.summary} ${where}${pub}`;
}

export function qAppAvatarUrl(name: string): string {
  const base = getBaseApiReactForAvatar().replace(/\/$/, '');
  return `${base}/arbitrary/AVATAR/${encodeURIComponent(name)}?async=true`;
}

export function openQAppInNewTab(opts: {
  service: QAppService;
  name: string;
}): void {
  parkQortinoAgentSheet();
  executeEvent('addTab', {
    data: {
      service: opts.service,
      name: opts.name,
      path: '',
      navigateIfAlreadyOpen: true,
    },
  });
  executeEvent('open-apps-mode', {});
}
