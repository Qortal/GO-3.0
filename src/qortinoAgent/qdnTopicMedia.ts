/**
 * Topical media browse for QDN mode — e.g. "show me images of the dogs".
 * Finds recent IMAGE/VIDEO/AUDIO/FILE resources whose titles match the subject.
 */
import { getBaseApiReact } from '../utils/globalApi';
import { parseTimeRange, type TimeRange } from './qdnDayPublishes';
import {
  preferSubstantialVideos,
  type QdnMediaItem,
  type QdnMediaKind,
} from './qdnMedia';

export type TopicMediaIntent = {
  kinds: QdnMediaKind[];
  /** Stem used for title matching (e.g. "dog") */
  subject: string;
  /** Display phrase (e.g. "dogs") */
  subjectLabel: string;
  /** Optional publish window (e.g. March 2025 / last week) */
  range?: TimeRange | null;
  /** Explicit QDN services (chip-forced DOCUMENT/BLOG_POST/FILE, etc.) */
  services?: string[];
  /** Chip-forced browse — empty subject means recent of that kind */
  forced?: boolean;
};

type SearchHit = {
  name?: string;
  service?: string;
  identifier?: string;
  size?: number;
  created?: number;
  updated?: number;
  timestamp?: number;
  metadata?: { title?: string; description?: string };
};

const MEDIA_STOP = new Set([
  'a',
  'an',
  'the',
  'me',
  'my',
  'some',
  'any',
  'all',
  'recent',
  'latest',
  'new',
  'please',
  'show',
  'find',
  'get',
  'list',
  'browse',
  'search',
  'look',
  'looking',
  'want',
  'need',
  'qdn',
  // Keep "qortal" — it is part of registered names like "Qortal Justin".
  'images',
  'image',
  'photos',
  'photo',
  'pictures',
  'picture',
  'pics',
  'pic',
  'videos',
  'video',
  'music',
  'songs',
  'song',
  'audio',
  'tracks',
  'track',
  'pdfs',
  'pdf',
  'documents',
  'document',
  'files',
  'file',
  'resources',
  'resource',
  'of',
  'about',
  'on',
  'for',
  'with',
  'titled',
  'named',
  'called',
  'that',
  'have',
  'has',
  'in',
  'title',
  'titles',
  'from',
  'during',
  'since',
  'yesterday',
  'week',
  'month',
  'last',
  'past',
  'this',
]);

function servicesForKind(kind: QdnMediaKind): string[] {
  switch (kind) {
    case 'video':
      return ['VIDEO'];
    case 'audio':
      return ['AUDIO'];
    case 'image':
      return ['IMAGE'];
    case 'pdf':
    case 'file':
      return ['FILE'];
    default:
      return [];
  }
}

function detectKinds(q: string): QdnMediaKind[] {
  const kinds: QdnMediaKind[] = [];
  if (/\b(images?|photos?|pictures?|pics?)\b/.test(q)) kinds.push('image');
  if (/\b(videos?|clips?|qtube)\b/.test(q)) kinds.push('video');
  if (/\b(music|songs?|audio|tracks?|earbump)\b/.test(q)) kinds.push('audio');
  if (/\b(pdfs?|documents?)\b/.test(q)) kinds.push('pdf');
  if (/\b(files?|q-?share|downloads?|resources?)\b/.test(q) && !kinds.includes('pdf')) {
    kinds.push('file');
  }
  return kinds;
}

/**
 * "show me images of the dogs", "videos about cats", "PDFs on gardening".
 * Not "videos by Crowetic" / "images from Simon James" (person shelves).
 */
export function detectTopicMediaIntent(query: string): TopicMediaIntent | null {
  const raw = query.trim();
  if (!raw) return null;
  const q = raw.toLowerCase();
  const range = parseTimeRange(raw);

  // Person shelves: "videos by Crowetic" — but allow "images of dogs from March"
  if (
    /\b(videos?|music|songs?|audio|images?|photos?|pdfs?|files?)\s+by\s+/i.test(q)
  ) {
    return null;
  }
  if (
    /\b(videos?|music|songs?|audio|images?|photos?|pdfs?|files?)\s+from\s+[A-Za-z0-9_.-]{2,40}\s*$/i.test(
      raw
    ) &&
    !range
  ) {
    return null;
  }

  const kinds = detectKinds(q);
  if (!kinds.length) return null;

  // Must look like a topical browse, not a who-is / bare name.
  const topicalVerb =
    /\b(show|find|get|list|browse|search|look(?:ing)?\s+for)\b/.test(q) ||
    /\b(images?|photos?|pictures?|pics?|videos?|music|songs?|audio|pdfs?|files?|resources?)\s+(of|about|on|for|with|titled|named|called)\b/.test(
      q
    ) ||
    /\b(of|about|on|for)\s+(the\s+)?[\p{L}\p{N}_-]{2,}/u.test(q);

  if (!topicalVerb) return null;

  // Pull subject after of/about/on/for/with/titled…
  let subjectRaw = '';
  const after = raw.match(
    /\b(?:images?|photos?|pictures?|pics?|videos?|music|songs?|audio|pdfs?|documents?|files?|resources?)\s+(?:of|about|on|for|with|titled|named|called)\s+(.+?)(?:\?|$)/i
  );
  if (after?.[1]) subjectRaw = after[1].trim();
  if (!subjectRaw) {
    const alt = raw.match(
      /\b(?:show|find|get|list|browse|search|look(?:ing)?\s+for)\s+(?:me\s+)?(?:(?:some|any|recent|latest|new)\s+)?(?:images?|photos?|pictures?|pics?|videos?|music|songs?|audio|pdfs?|documents?|files?|resources?)\s+(?:of|about|on|for|with)\s+(.+?)(?:\?|$)/i
    );
    if (alt?.[1]) subjectRaw = alt[1].trim();
  }
  if (!subjectRaw) return null;

  // Strip date / relative window from the subject phrase
  subjectRaw = subjectRaw
    .replace(/\b(from|during|in|since)\s+.+$/i, ' ')
    .replace(/\b(please|thanks|thank you)\b/gi, ' ')
    .replace(/[?!.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = subjectRaw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !MEDIA_STOP.has(t));

  if (!tokens.length) return null;

  // Prefer the distinctive noun ("dogs" → dog); keep compound subjects joined.
  const subjectLabel = tokens.join(' ');
  const last = tokens[tokens.length - 1];
  // Simple plural stem for title prefix match (dogs → dog, cats → cat)
  const subject =
    last.length > 3 && last.endsWith('s') && !last.endsWith('ss')
      ? last.slice(0, -1)
      : last;

  return { kinds, subject, subjectLabel, range };
}

async function apiSearch(
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<SearchHit[]> {
  const base = getBaseApiReact().replace(/\/$/, '');
  const qs = new URLSearchParams({
    mode: 'ALL',
    reverse: 'true',
    includemetadata: 'true',
    includestatus: 'true',
    prefix: 'false',
    ...params,
  });
  try {
    const res = await fetch(`${base}/arbitrary/resources/search?${qs}`, {
      signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function titleOf(hit: SearchHit): string {
  const t = (hit.metadata?.title || '').replace(/\s+/g, ' ').trim();
  return t || (hit.identifier || '').replace(/[_-]+/g, ' ');
}

/** Title matches subject* (starts with) or contains subject as a word/prefix. */
export function titleMatchesSubject(title: string, subject: string): boolean {
  const t = title.toLowerCase();
  const s = subject.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s || !t) return false;
  if (t.startsWith(s) || t.includes(s)) return true;
  // Multi-word: all tokens present (e.g. "chris luno" → title has chris + luno).
  // Drop ultra-common "qortal" so "qortal justin" cannot match via justin alone
  // when "qortal" appears somewhere unrelated in the title bag.
  const parts = s
    .split(' ')
    .filter((p) => p.length >= 2 && p !== 'qortal' && p !== 'qdn');
  if (parts.length > 1 && parts.every((p) => t.includes(p))) {
    // Still require the full phrase OR every distinctive token as whole words.
    return true;
  }
  if (parts.length === 1 && s.split(' ').length > 1) {
    // Was "qortal X" — require the distinctive token as a whole word, not a
    // substring of "justin bieber" without the qortal name context.
    // For person-like "qortal X", insist the full subject appears, or the
    // distinctive token alone only when the title also mentions qortal.
    const distinctive = parts[0];
    const hasDistinctive = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${distinctive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}\\p{N}])`,
      'i'
    ).test(t);
    if (hasDistinctive && /\bqortal\b/i.test(t)) return true;
    return false;
  }
  // word boundary prefix: "my doggo" / "cute dogs playing"
  const re = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\p{L}\\p{N}]*`,
    'iu'
  );
  return re.test(title);
}

function kindForService(service: string, fallback: QdnMediaKind): QdnMediaKind {
  const svc = service.toUpperCase();
  if (svc === 'VIDEO') return 'video';
  if (svc === 'AUDIO') return 'audio';
  if (svc === 'IMAGE' || svc === 'THUMBNAIL') return 'image';
  if (svc === 'FILE' || svc === 'DOCUMENT' || svc === 'BLOG_POST') {
    return fallback === 'pdf' ? 'pdf' : 'file';
  }
  return fallback;
}

function hitToItem(hit: SearchHit, kind: QdnMediaKind): QdnMediaItem | null {
  const name = (hit.name || '').trim();
  const identifier = (hit.identifier || '').trim();
  const service = (hit.service || '').toUpperCase();
  if (!name || !identifier || !service) return null;
  // Avatars / tombstones / metadata side-files never belong in results.
  // IMAGE/THUMBNAIL often use *_thumb identifiers for real gallery publishes — keep them.
  if (/qortal_avatar|^tombstone$/i.test(identifier)) return null;
  if (/_metadata/i.test(identifier)) return null;
  if (
    /_thumb$/i.test(identifier) &&
    service !== 'IMAGE' &&
    service !== 'THUMBNAIL'
  ) {
    return null;
  }

  const title = titleOf(hit);
  if (/tombstone/i.test(title)) return null;

  let resolvedKind = kindForService(service, kind);
  if (kind === 'pdf' || kind === 'file' || service === 'FILE') {
    const blob = `${title} ${identifier}`.toLowerCase();
    const isPdf = blob.includes('.pdf') || blob.includes('pdf');
    if (kind === 'pdf' && service === 'FILE' && !isPdf) return null;
    if (service === 'FILE' || service === 'DOCUMENT' || service === 'BLOG_POST') {
      resolvedKind = isPdf ? 'pdf' : 'file';
    }
  }

  const created =
    typeof hit.created === 'number' && hit.created > 0
      ? hit.created
      : typeof hit.timestamp === 'number' && hit.timestamp > 0
        ? hit.timestamp
        : undefined;
  const updated =
    typeof hit.updated === 'number' && hit.updated > 0 ? hit.updated : undefined;

  return {
    kind: resolvedKind,
    name,
    service,
    identifier,
    title: title.slice(0, 120),
    description: hit.metadata?.description?.slice(0, 160),
    size: hit.size,
    created,
    updated,
  };
}

export async function searchTopicMedia(
  intent: TopicMediaIntent,
  options?: { signal?: AbortSignal; limit?: number }
): Promise<{
  items: QdnMediaItem[];
  answer: string;
  detail: string;
  context: string;
}> {
  const limit = options?.limit ?? 24;
  const signal = options?.signal;
  const queries = Array.from(
    new Set([intent.subject, intent.subjectLabel].filter(Boolean))
  );
  const recentBrowse = intent.forced === true && !intent.subject;
  // Recent browse still needs a query token for some node builds — use a short letter.
  const searchQueries = queries.length ? queries : recentBrowse ? [''] : [];

  const services = intent.services?.length
    ? intent.services
    : intent.kinds.flatMap((k) => servicesForKind(k));
  const fallbackKind = intent.kinds[0] || 'file';

  const fetched: QdnMediaItem[] = [];
  const seen = new Set<string>();

  for (const service of services) {
    for (const q of searchQueries) {
      const params: Record<string, string> = {
        service,
        limit: String(Math.min(40, limit + 16)),
      };
      if (q) params.query = q;
      if (intent.range) {
        params.after = String(intent.range.afterMs);
        params.before = String(intent.range.beforeMs);
      }
      const hits = await apiSearch(params, signal);
      for (const hit of hits) {
        const item = hitToItem(hit, fallbackKind);
        if (!item) continue;
        if (
          intent.subject &&
          !titleMatchesSubject(item.title, intent.subject) &&
          !titleMatchesSubject(item.title, intent.subjectLabel)
        ) {
          continue;
        }
        if (intent.range) {
          const ts = item.updated || item.created;
          if (
            typeof ts === 'number' &&
            (ts < intent.range.afterMs || ts > intent.range.beforeMs)
          ) {
            continue;
          }
        }
        const key = `${item.service}:${item.name}:${item.identifier}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        fetched.push(item);
      }
    }
  }

  // Most recent first
  fetched.sort(
    (a, b) =>
      (b.updated || b.created || 0) - (a.updated || a.created || 0)
  );
  // Hide sub-1MB videos when any larger video is present; if the whole
  // Videos search is only tiny stubs, keep them so the grid isn't empty.
  const items = preferSubstantialVideos(fetched).slice(0, limit);

  const kindLabel = intent.services?.includes('BLOG_POST')
    ? 'documents'
    : intent.kinds.length === 1
      ? intent.kinds[0] === 'image'
        ? 'images'
        : intent.kinds[0] === 'video'
          ? 'videos'
          : intent.kinds[0] === 'audio'
            ? 'audio'
            : intent.kinds[0] === 'pdf'
              ? 'PDFs'
              : 'files'
      : 'resources';

  const when = intent.range ? ` from ${intent.range.dayLabel}` : '';
  const subjectBit = intent.subject
    ? ` with “${intent.subject}*” in the title`
    : ' (recent on this node)';
  const answer = items.length
    ? `Here are QDN ${kindLabel}${subjectBit}${when} (${items.length} shown). Tap a card to open or play.`
    : `No QDN ${kindLabel}${subjectBit}${when} on this node yet. Try another word, a different search chip, or All.`;

  const lines = items
    .slice(0, 12)
    .map(
      (i, n) =>
        `${n + 1}. ${i.title} · ${i.kind} · by ${i.name}`
    );

  const context = items.length
    ? `[QDN topic media · ${kindLabel} · ${intent.subject ? `“${intent.subject}*”` : 'recent'}${when}]\n${lines.join('\n')}\nREQUIRED: summarize only these real titles; mention the grid below. Do not invent resources.`
    : `[QDN topic media · ${kindLabel} · ${intent.subject ? `“${intent.subject}*”` : 'recent'}${when}]\nNo matching titles.`;

  return {
    items,
    answer,
    detail: items.length
      ? `QDN ${kindLabel} · ${intent.subject ? `“${intent.subject}*”` : 'recent'}${when} · ${items.length}`
      : `QDN ${kindLabel} · no hits${when}`,
    context,
  };
}

export function isTopicMediaQuestion(query: string): boolean {
  return !!detectTopicMediaIntent(query);
}
