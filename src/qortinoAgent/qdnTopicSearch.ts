/**
 * Topical QDN search for Qortino QDN mode — how-to / what-is style questions
 * that are not about a specific registered name.
 *
 * Uses the node's index API (`/arbitrary/indices`) plus metadata-bearing
 * resource searches across blogs, docs, and videos.
 */
import { apiGetJson } from './qdnApi';
import type { QdnMediaItem } from './qdnMedia';

type QdnTopicHit = {
  name: string;
  service: string;
  identifier: string;
  title: string;
  description?: string;
  score?: number;
  size?: number;
  created?: number;
  kind: 'video' | 'blog' | 'document' | 'file' | 'other';
};

type IndexScorecard = {
  score?: number;
  name?: string;
  category?: number;
  link?: string;
};

type ResourceHit = {
  name?: string;
  service?: string;
  identifier?: string;
  size?: number;
  created?: number;
  updated?: number;
  metadata?: {
    title?: string;
    description?: string;
  };
};

const TOPIC_STOP = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'in',
  'on',
  'for',
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'do',
  'does',
  'did',
  'how',
  'what',
  'why',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'can',
  'could',
  'should',
  'would',
  'will',
  'please',
  'help',
  'me',
  'my',
  'i',
  'you',
  'your',
  'with',
  'from',
  'into',
  'about',
  'tell',
  'show',
  'find',
  'get',
  'make',
  'need',
  'want',
  'know',
  'explain',
  'guide',
  'tutorial',
  'steps',
  'step',
  'qortal',
  'qdn',
]);

/** True for how-to / informational questions that should search QDN content. */
export function detectTopicIntent(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  // Person / nomination flows win.
  if (/\bnominat(e|ion|ing)\b/.test(q)) return false;
  if (
    /\b(who(?:'s|\s+is|\s+are)|whobis|tell\s+me\s+about|look\s*up|lookup|profile\s+of|info\s+on)\b/.test(
      q
    )
  ) {
    return false;
  }
  if (/\b(videos?|music|songs?|images?|photos?|pdfs?|files?)\s+(by|from|of)\b/.test(q)) {
    return false;
  }
  // Bare multi-word name only (e.g. "Simon James") — not a topic question.
  if (
    /^[A-Za-z0-9][A-Za-z0-9_. -]{1,58}[A-Za-z0-9_.-]$/.test(query.trim()) &&
    !/[?]/.test(q) &&
    !/\b(how|what|why|when|where|explain|fix|change|replace|install)\b/.test(q)
  ) {
    return false;
  }

  return (
    /\b(how|what|why|when|where|which|explain|guide|tutorial|steps?|fix|help|teach|learn|best|way)\b/.test(
      q
    ) ||
    /\b(change|replace|install|build|grow|treat|survive|purify|filter|repair|cook|store)\b/.test(
      q
    )
  );
}

function extractTopicTerms(query: string): string[] {
  const raw = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !TOPIC_STOP.has(t));
  const uniq: string[] = [];
  for (const t of raw) {
    if (!uniq.includes(t)) uniq.push(t);
  }
  // Prefer rarer/longer terms first for the index API.
  return uniq.sort((a, b) => b.length - a.length).slice(0, 6);
}

function kindFromService(service: string, identifier: string): QdnTopicHit['kind'] {
  const svc = service.toUpperCase();
  const id = identifier.toLowerCase();
  if (svc === 'VIDEO' || id.includes('qtube_vid_')) return 'video';
  if (svc === 'BLOG_POST' || id.includes('q-blog')) return 'blog';
  if (svc === 'FILE' || id.startsWith('qshare_file_')) return 'file';
  if (svc === 'DOCUMENT') return 'document';
  return 'other';
}

function tidyTitle(raw: string | undefined, fallback: string): string {
  const t = (raw || '').replace(/\s+/g, ' ').trim();
  return (t || fallback).slice(0, 140);
}

function stripCategory(desc?: string): string {
  if (!desc) return '';
  return desc
    .replace(/^\*\*category:[^*]+\*\*/i, '')
    .replace(/^\*\*cat:[^*]+\*\*/i, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

/** Parse `qortal://APP/Q-Tube/video/Name/id` or `qortal://VIDEO/Name/id`. */
function parseQortalLink(
  link: string
): { service: string; name: string; identifier: string } | null {
  try {
    const raw = decodeURIComponent(link.trim());
    const mApp = raw.match(
      /^qortal:\/\/APP\/Q-Tube\/(video|playlist)\/([^/]+)\/([^/?#]+)/i
    );
    if (mApp) {
      const kind = mApp[1].toLowerCase();
      return {
        service: kind === 'playlist' ? 'PLAYLIST' : 'VIDEO',
        name: mApp[2],
        identifier: mApp[3],
      };
    }
    const mSvc = raw.match(/^qortal:\/\/([A-Z0-9_]+)\/([^/]+)\/([^/?#]+)/i);
    if (mSvc) {
      return {
        service: mSvc[1].toUpperCase(),
        name: mSvc[2],
        identifier: mSvc[3],
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function searchIndices(
  terms: string[],
  signal?: AbortSignal
): Promise<IndexScorecard[]> {
  if (!terms.length) return [];
  const qs = terms.map((t) => `terms=${encodeURIComponent(t)}`).join('&');
  const data = await apiGetJson<IndexScorecard[]>(
    `/arbitrary/indices?${qs}`,
    signal
  );
  return Array.isArray(data) ? data : [];
}

async function searchResourcesByQuery(
  query: string,
  service: string,
  limit: number,
  signal?: AbortSignal
): Promise<ResourceHit[]> {
  const qs = new URLSearchParams({
    mode: 'ALL',
    reverse: 'true',
    includemetadata: 'true',
    includestatus: 'true',
    prefix: 'false',
    query,
    service,
    limit: String(limit),
  });
  const data = await apiGetJson<ResourceHit[]>(
    `/arbitrary/resources/search?${qs.toString()}`,
    signal
  );
  return Array.isArray(data) ? data : [];
}

async function enrichFromStatus(
  hit: Pick<QdnTopicHit, 'name' | 'service' | 'identifier'>,
  signal?: AbortSignal
): Promise<Partial<QdnTopicHit>> {
  // Prefer DOCUMENT metadata siblings for Q-Tube.
  const metaId = hit.identifier.endsWith('_metadata')
    ? hit.identifier
    : hit.service === 'VIDEO'
      ? `${hit.identifier}_metadata`
      : hit.identifier;
  const service = hit.service === 'VIDEO' ? 'DOCUMENT' : hit.service;
  const qs = new URLSearchParams({
    mode: 'ALL',
    service,
    name: hit.name,
    identifier: metaId,
    exactmatchnames: 'true',
    limit: '1',
    includemetadata: 'true',
    includestatus: 'true',
  });
  const rows = await apiGetJson<ResourceHit[]>(
    `/arbitrary/resources/search?${qs.toString()}`,
    signal
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return {};
  return {
    title: tidyTitle(row.metadata?.title, hit.identifier),
    description: stripCategory(row.metadata?.description),
    size: row.size,
    created: row.created || row.updated,
  };
}

function resourceToHit(row: ResourceHit, score?: number): QdnTopicHit | null {
  const name = row.name?.trim();
  const service = (row.service || '').toUpperCase();
  const identifier = row.identifier || '';
  if (!name || !service || !identifier) return null;
  // Skip tiny metadata shells unless they're the only pointer.
  return {
    name,
    service: service === 'DOCUMENT' && identifier.includes('qtube_vid_')
      ? 'VIDEO'
      : service,
    identifier: identifier.replace(/_metadata$/, ''),
    title: tidyTitle(row.metadata?.title, identifier),
    description: stripCategory(row.metadata?.description),
    score,
    size: row.size,
    created: row.created || row.updated,
    kind: kindFromService(service, identifier),
  };
}

export async function searchQdnTopic(
  query: string,
  options?: { signal?: AbortSignal; limit?: number }
): Promise<{
  hits: QdnTopicHit[];
  media: QdnMediaItem[];
  detail: string;
  context: string;
}> {
  const signal = options?.signal;
  const limit = options?.limit ?? 8;
  const terms = extractTopicTerms(query);
  if (!terms.length) {
    return {
      hits: [],
      media: [],
      detail: 'QDN topic scan: no useful search terms',
      context: '',
    };
  }

  const primaryTerm = terms[0];
  // Minting / nomination how-tos: skip VIDEO search — "mint" matches unrelated noise.
  const skipVideos =
    /\bmint(ing|er|ership)?\b|\bnominat(e|ion|ing)\b|\bsponsorship\b/i.test(
      query
    );
  const [indexHits, blogs, docs, videos] = await Promise.all([
    searchIndices(terms.slice(0, 4), signal),
    searchResourcesByQuery(primaryTerm, 'BLOG_POST', 6, signal),
    searchResourcesByQuery(primaryTerm, 'DOCUMENT', 6, signal),
    skipVideos
      ? Promise.resolve([] as ResourceHit[])
      : searchResourcesByQuery(primaryTerm, 'VIDEO', 6, signal),
  ]);

  const merged = new Map<string, QdnTopicHit>();
  const push = (hit: QdnTopicHit | null) => {
    if (!hit) return;
    // Minting how-tos: drop VIDEO / Q-Tube index noise even if score looks high.
    if (skipVideos && hit.kind === 'video') return;
    const key = `${hit.service}:${hit.name}:${hit.identifier}`.toLowerCase();
    const prev = merged.get(key);
    if (!prev || (hit.score ?? 0) > (prev.score ?? 0)) merged.set(key, hit);
  };

  for (const card of indexHits.slice(0, 16)) {
    if (!card.link) continue;
    // Weak fuzzy matches (0.5 with unrelated content) — keep only stronger scores
    // unless the link/identifier itself contains a term.
    const linkLower = card.link.toLowerCase();
    const termHit = terms.some((t) => linkLower.includes(t));
    if ((card.score ?? 0) < 0.85 && !termHit) continue;
    const parsed = parseQortalLink(card.link);
    if (!parsed) continue;
    push({
      name: parsed.name,
      service: parsed.service,
      identifier: parsed.identifier.replace(/_metadata$/, ''),
      title: tidyTitle(undefined, parsed.identifier),
      score: card.score,
      kind: kindFromService(parsed.service, parsed.identifier),
    });
  }

  for (const row of [...blogs, ...docs, ...videos]) {
    const titleBag = `${row.metadata?.title || ''} ${row.metadata?.description || ''} ${row.identifier || ''}`.toLowerCase();
    const relevance = terms.filter((t) => titleBag.includes(t)).length;
    if (relevance === 0 && terms.length > 1) continue;
    push(resourceToHit(row, relevance || 0.4));
  }

  let hits = [...merged.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);

  // Enrich top index-only hits that lack titles.
  await Promise.all(
    hits.slice(0, 5).map(async (hit, i) => {
      if (hit.title && hit.title !== hit.identifier && hit.description) return;
      const extra = await enrichFromStatus(hit, signal).catch(() => ({}));
      hits[i] = { ...hit, ...extra };
    })
  );

  hits = hits.filter((h) => h.title || h.description);

  const media: QdnMediaItem[] = skipVideos
    ? []
    : hits
        .filter((h) => h.kind === 'video')
        .slice(0, 4)
        .map((h) => ({
          kind: 'video' as const,
          name: h.name,
          service: 'VIDEO',
          identifier: h.identifier.replace(/_metadata$/, ''),
          title: h.title,
          description: h.description,
          size: h.size,
          created: h.created,
        }));

  const lines = hits.map((h, i) => {
    const meta = [
      h.kind,
      h.name,
      typeof h.score === 'number' ? `score ${h.score.toFixed(2)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      `${i + 1}. ${h.title} (${meta})` +
      (h.description ? `\n   ${h.description}` : '') +
      `\n   QDN: ${h.service}/${h.name}/${h.identifier}`
    );
  });

  const context = hits.length
    ? `[QDN topic search for “${query.trim()}” · terms: ${terms.join(', ')}]\n` +
      `Use these QDN publishes to answer. Prefer practical steps grounded in the titles/descriptions. ` +
      `Cite publishers by name when helpful. If results are weak, say so and give careful general guidance.\n\n` +
      lines.join('\n\n')
    : `[QDN topic search for “${query.trim()}”]\nNo strong QDN matches for terms: ${terms.join(', ')}. ` +
      `Say you could not find matching QDN content yet, then answer carefully from general knowledge / Qortino’s on-device notes.`;

  return {
    hits,
    media,
    detail: hits.length
      ? `QDN topic scan · ${hits.length} hits for “${terms.slice(0, 3).join(' ')}”`
      : `QDN topic scan · no strong hits for “${terms.slice(0, 3).join(' ')}”`,
    context,
  };
}
