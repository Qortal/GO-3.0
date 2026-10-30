/**
 * Efficient publish + public chat snippets for Qortino "who is X" summaries.
 * Inspired by MA-Helper portfolio / portfolioChat — mobile-sized, public-safe.
 */
import { getBaseApiReact } from '../utils/globalApi';
import { apiGetJson } from './qdnApi';
import {
  extractContentThemes,
  formatThemeHintLine,
} from './qdnCharacterPortrait';
import { isQuitterPostId, stripHtml } from './qdnQuitterPosts';

type PersonPublishSnippet = {
  source: string;
  title: string;
  excerpt?: string;
};

type PersonChatSnippet = {
  channel: string;
  kind: 'group' | 'dm';
  text: string;
  at?: number;
};

type SearchHit = {
  name?: string;
  service?: string;
  identifier?: string;
  size?: number;
  metadata?: {
    title?: string;
    description?: string;
    author?: string;
  };
};

type ChatActive = {
  groups?: Array<{
    groupId?: number;
    groupName?: string;
    timestamp?: number;
  }>;
  direct?: Array<{
    address?: string;
    name?: string;
    timestamp?: number;
  }>;
};

type ChatRow = {
  sender?: string;
  recipient?: string;
  timestamp?: number;
  data?: string;
  isEncrypted?: boolean;
  isText?: boolean;
  txGroupId?: number;
  groupId?: number;
};

function walkTipTap(node: unknown): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(walkTipTap).join('');
  if (typeof node !== 'object') return '';
  const n = node as Record<string, unknown>;
  if (n.type === 'text' && typeof n.text === 'string') return n.text;
  return walkTipTap(n.content);
}

function decodeChatData(data?: string): string | null {
  if (!data) return null;
  try {
    const decoded = atob(data.replace(/\s/g, ''));
    try {
      const json = JSON.parse(decoded) as { messageText?: unknown; message?: unknown };
      const fromDoc = walkTipTap(json.messageText).replace(/\s+/g, ' ').trim();
      if (fromDoc) return fromDoc;
      if (typeof json.message === 'string' && json.message.trim()) {
        return stripHtml(json.message).slice(0, 220);
      }
    } catch {
      /* plain */
    }
    const plain = decoded.replace(/\s+/g, ' ').trim();
    if (plain && !plain.startsWith('{')) return plain.slice(0, 220);
  } catch {
    /* opaque */
  }
  return null;
}

/** Priority role line for the LLM opening sentence. */
export function buildRoleStatement(displayName: string, tags: string[]): string {
  const name = displayName.trim() || 'This user';
  if (tags.includes('Founder')) return `${name} is a Founder of Qortal`;
  if (tags.includes('Minter Admin')) return `${name} is a Minter Admin on Qortal`;
  if (tags.includes('Dev Admin')) return `${name} is a Dev Admin on Qortal`;
  if (tags.includes('Admin')) return `${name} is an Admin on Qortal`;
  if (tags.includes('Forum Admin')) return `${name} is a Forum Admin on Qortal`;
  if (tags.includes('Q-Mintership Admin'))
    return `${name} is a Q-Mintership Admin on Qortal`;
  if (tags.includes('Minter')) return `${name} is a Minter on Qortal`;
  return `${name} is a non-minter on Qortal`;
}

async function search(
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<SearchHit[]> {
  const qs = new URLSearchParams({
    mode: 'ALL',
    reverse: 'true',
    includemetadata: 'true',
    exactmatchnames: 'true',
    ...params,
  });
  const data = await apiGetJson<SearchHit[]>(
    `/arbitrary/resources/search?${qs.toString()}`,
    signal
  );
  return Array.isArray(data) ? data : [];
}

async function fetchQuitterExcerpt(
  name: string,
  identifier: string,
  signal?: AbortSignal
): Promise<string | undefined> {
  const base = getBaseApiReact().replace(/\/$/, '');
  const path = `/arbitrary/DOCUMENT/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`;
  void fetch(`${base}${path}?async=true`, { signal }).catch(() => undefined);
  const data = await apiGetJson<Record<string, unknown>>(path, signal);
  if (!data || typeof data !== 'object' || 'error' in data) return undefined;
  const text =
    (typeof data.text === 'string' && data.text) ||
    (typeof data.content === 'string' && data.content) ||
    '';
  const clean = stripHtml(text).slice(0, 180);
  return clean || undefined;
}

/** Titles + short excerpts from public publishes (no encrypted mail). */
export async function fetchPublishSnippets(
  name: string,
  signal?: AbortSignal
): Promise<PersonPublishSnippet[]> {
  // Keep publish scans lean — media shelf already covers Q-Tube titles separately.
  const [blogs, qtube, docs] = await Promise.all([
    search(
      { service: 'BLOG_POST', name, limit: '6' },
      signal
    ),
    search(
      {
        service: 'DOCUMENT',
        name,
        identifier: 'qtube_vid_',
        prefix: 'true',
        limit: '4',
      },
      signal
    ),
    search({ service: 'DOCUMENT', name, limit: '12' }, signal),
  ]);

  const out: PersonPublishSnippet[] = [];
  const seen = new Set<string>();

  for (const hit of blogs) {
    const id = hit.identifier || '';
    if (!id || id.startsWith('comment-')) continue;
    const title =
      hit.metadata?.title?.trim() ||
      id.replace(/^q-blog-[^-]+-post-/, '').replace(/-/g, ' ');
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push({
      source: 'Q-Blog',
      title: title.slice(0, 120),
      excerpt: stripHtml(hit.metadata?.description || '').slice(0, 140) || undefined,
    });
    if (out.length >= 8) break;
  }

  for (const hit of qtube) {
    const id = hit.identifier || '';
    if (!id.endsWith('_metadata')) continue;
    const title = hit.metadata?.title?.trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push({
      source: 'Q-Tube',
      title: title.slice(0, 120),
      excerpt: stripHtml(
        (hit.metadata?.description || '').replace(/^\*\*category:[^*]+\*\*/, '')
      ).slice(0, 140) || undefined,
    });
    if (out.length >= 12) break;
  }

  const quitterIds = docs
    .map((d) => d.identifier || '')
    .filter(isQuitterPostId)
    .slice(0, 4);

  await Promise.all(
    quitterIds.map(async (id) => {
      try {
        const excerpt = await Promise.race([
          fetchQuitterExcerpt(name, id, signal),
          new Promise<undefined>((resolve) =>
            window.setTimeout(() => resolve(undefined), 2200)
          ),
        ]);
        const title = excerpt
          ? excerpt.slice(0, 80)
          : `Quitter post (${id.slice(-12)})`;
        if (seen.has(title)) return;
        seen.add(title);
        out.push({
          source: 'Quitter',
          title,
          excerpt,
        });
      } catch {
        /* skip */
      }
    })
  );

  return out.slice(0, 14);
}

async function isOpenGroup(groupId: number, signal?: AbortSignal): Promise<boolean> {
  const info = await apiGetJson<{ isOpen?: boolean }>(
    `/groups/${groupId}`,
    signal
  );
  return info?.isOpen === true;
}

/** Latest readable group messages from this address + DMs with the viewer (if any). */
export async function fetchChatSnippets(
  address: string,
  options?: { viewerAddress?: string | null; signal?: AbortSignal }
): Promise<PersonChatSnippet[]> {
  const signal = options?.signal;
  const viewer = options?.viewerAddress?.trim() || '';
  const active = await apiGetJson<ChatActive>(
    `/chat/active/${encodeURIComponent(address)}?encoding=BASE64&haschatreference=false`,
    signal
  );
  if (!active) return [];

  const out: PersonChatSnippet[] = [];
  const groups = (active.groups || []).slice(0, 6);

  await Promise.all(
    groups.map(async (g) => {
      const gid = Number(g.groupId);
      if (!gid) return;
      const open = await isOpenGroup(gid, signal);
      if (!open) return;
      const rows = await apiGetJson<ChatRow[]>(
        `/chat/messages?txGroupId=${gid}&sender=${encodeURIComponent(address)}&encoding=BASE64&limit=8&reverse=true`,
        signal
      );
      if (!Array.isArray(rows)) return;
      for (const row of rows) {
        if (row.isEncrypted === true) continue;
        const text = decodeChatData(row.data);
        if (!text) continue;
        out.push({
          channel: g.groupName || `Group ${gid}`,
          kind: 'group',
          text: text.slice(0, 180),
          at: row.timestamp,
        });
        if (out.filter((x) => x.kind === 'group').length >= 8) break;
      }
    })
  );

  if (viewer && viewer !== address) {
    const rows = await apiGetJson<ChatRow[]>(
      `/chat/messages?involving=${encodeURIComponent(viewer)}&involving=${encodeURIComponent(address)}&encoding=BASE64&limit=8&reverse=true`,
      signal
    );
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row.sender !== address) continue;
        if (row.isEncrypted === true) {
          out.push({
            channel: 'Direct message with you',
            kind: 'dm',
            text: '(encrypted — content not shown)',
            at: row.timestamp,
          });
          continue;
        }
        const text = decodeChatData(row.data);
        if (!text) continue;
        out.push({
          channel: 'Direct message with you',
          kind: 'dm',
          text: text.slice(0, 180),
          at: row.timestamp,
        });
        if (out.filter((x) => x.kind === 'dm').length >= 4) break;
      }
    }
  }

  out.sort((a, b) => (b.at || 0) - (a.at || 0));
  return out.slice(0, 12);
}

/** Local theme hints from titles/excerpts (feeds the LLM; not a replacement for it). */
function deriveThemeHints(publishes: PersonPublishSnippet[]): string {
  if (!publishes.length) {
    return 'No clear public-publish themes in the sample.';
  }
  return formatThemeHintLine(extractContentThemes(publishes));
}

export function formatPersonVoiceBlock(options: {
  displayName: string;
  tags: string[];
  level: number;
  publishes: PersonPublishSnippet[];
  chats: PersonChatSnippet[];
}): string {
  const role = buildRoleStatement(options.displayName, options.tags);
  const lines: string[] = [
    `REQUIRED OPENING LINE (use almost verbatim): "${role}."`,
    `Also state: Level ${options.level}.`,
    options.tags.length
      ? `All role tags: ${options.tags.join(', ')}`
      : 'All role tags: none (non-minter)',
    deriveThemeHints(options.publishes),
  ];

  if (options.publishes.length) {
    lines.push('Public publishes / titles (use these for sentiment & interests):');
    for (const p of options.publishes.slice(0, 12)) {
      lines.push(
        `- [${p.source}] ${p.title}${p.excerpt ? ` — ${p.excerpt}` : ''}`
      );
    }
  } else {
    lines.push('Public publish titles: none found in the quick scan.');
  }

  if (options.chats.length) {
    lines.push('Recent readable chat from this person:');
    for (const c of options.chats.slice(0, 10)) {
      lines.push(`- (${c.kind}/${c.channel}) ${c.text}`);
    }
  } else {
    lines.push(
      'Recent readable chat: none available (private groups/DMs skipped, or node has no public history yet).'
    );
  }

  lines.push(
    'Instruction: After the role opening line, summarize who they seem to be from publishes + chat themes/sentiment. Do NOT say you lack information if titles or chat snippets are listed above. Never invent topics not supported by those lines.'
  );
  return lines.join('\n');
}
