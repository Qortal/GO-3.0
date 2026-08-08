/**
 * QDN media discovery for Qortino QDN mode.
 * Patterns mirror Q-Tube / EarBump / Q-Share (see Hub embeds + gitea Q-Apps).
 */
import {
  getBaseApiReact,
  getBaseApiReactForAvatar,
} from '../utils/globalApi';
import { formatQdnResourceLine } from './qdnAppLinks';

export type QdnMediaKind = 'video' | 'audio' | 'image' | 'pdf' | 'file';

export type QdnMediaItem = {
  kind: QdnMediaKind;
  /** Publisher registered name */
  name: string;
  service: string;
  identifier: string;
  title: string;
  description?: string;
  /** Poster / cover when known (data URL or QDN URL). */
  thumbnailUrl?: string;
  size?: number;
  /** Unix ms when published / created on QDN (if known). */
  created?: number;
  /** Unix ms when last updated on QDN (if known). */
  updated?: number;
};

type SearchHit = {
  name?: string;
  service?: string;
  identifier?: string;
  size?: number;
  created?: number;
  updated?: number;
  timestamp?: number;
  metadata?: {
    title?: string;
    description?: string;
    author?: string;
    tags?: string[];
  };
};

function hitTimestamps(hit: SearchHit): { created?: number; updated?: number } {
  const created =
    typeof hit.created === 'number' && hit.created > 0
      ? hit.created
      : typeof hit.timestamp === 'number' && hit.timestamp > 0
        ? hit.timestamp
        : undefined;
  const updated =
    typeof hit.updated === 'number' && hit.updated > 0 ? hit.updated : undefined;
  return { created, updated };
}

/**
 * Nodes often ignore `exactmatchnames` and return other publishers' hits
 * (e.g. recent Q-Tube globally when searching under "Qortal Justin").
 * Only keep resources whose publisher name equals the requested name.
 */
export function isExactPublisherName(
  hitName: string | undefined | null,
  requestedName: string
): boolean {
  const hit = (hitName || '').trim().toLowerCase();
  const want = (requestedName || '').trim().toLowerCase();
  if (!hit || !want) return false;
  return hit === want;
}

export function formatMediaBytes(size?: number): string {
  if (size == null || !Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

/** Videos smaller than this are usually stubs / broken uploads — hide by default. */
export const MIN_VIDEO_BYTES = 1024 * 1024;

/** Known size under 1 MB. Missing/unknown size is not treated as tiny. */
export function isTinyVideo(item: QdnMediaItem): boolean {
  return (
    item.kind === 'video' &&
    typeof item.size === 'number' &&
    Number.isFinite(item.size) &&
    item.size > 0 &&
    item.size < MIN_VIDEO_BYTES
  );
}

/**
 * Drop videos under 1 MB when any other (non-tiny) video exists.
 * If the publisher / result set has only tiny videos, keep them so the user
 * still sees something (same rule for Videos chip / topic video search).
 */
export function preferSubstantialVideos(items: QdnMediaItem[]): QdnMediaItem[] {
  if (!items.length) return items;
  const videos = items.filter((i) => i.kind === 'video');
  if (!videos.length) return items;
  const hasSubstantial = videos.some((v) => !isTinyVideo(v));
  if (!hasSubstantial) return items;
  return items.filter((i) => i.kind !== 'video' || !isTinyVideo(i));
}

export function formatMediaDate(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return '';
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

const QTUBE_META_PREFIX = 'qtube_vid_';
const QTUBE_SUPER_LIKE_QUERY_SUFFIX = 'qtube_sl';
const QTUBE_LIKE_QUERY_SUFFIX = 'qtube_like';
const EARBUMP_PREFIX = 'earbump_song_';
const ENJOYMUSIC_PREFIX = 'enjoymusic_song';
const QSHARE_PREFIX = 'qshare_file_';

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

function encodeSeg(value: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(value));
  } catch {
    return encodeURIComponent(value);
  }
}

function resourceUrl(service: string, name: string, identifier: string, async = false): string {
  const base = getBaseApiReact().replace(/\/$/, '');
  const path = `/arbitrary/${encodeSeg(service)}/${encodeSeg(name)}/${encodeSeg(identifier)}`;
  return async ? `${base}${path}?async=true` : `${base}${path}`;
}

type ResourceStatusPayload = {
  status?: string;
  localChunkCount?: number;
  totalChunkCount?: number;
};

/**
 * Kick a QDN download and wait until the node reports READY.
 * Needed before <audio>/<img> can use a non-async arbitrary URL.
 */
export async function waitForQdnResourceReady(
  item: Pick<QdnMediaItem, 'service' | 'name' | 'identifier'>,
  options?: {
    downloadResource?: (r: {
      name: string;
      service: string;
      identifier: string;
    }) => void;
    timeoutMs?: number;
    signal?: AbortSignal;
    onProgress?: (percent: number, status: string) => void;
  }
): Promise<{ url: string; status: string }> {
  const { service, name, identifier } = item;
  options?.downloadResource?.({ name, service, identifier });
  // Nudge the node to start fetching chunks.
  void fetch(resourceUrl(service, name, identifier, true), {
    signal: options?.signal,
  }).catch(() => undefined);

  const deadline = Date.now() + (options?.timeoutMs ?? 90_000);
  let delay = 300;
  while (Date.now() < deadline) {
    if (options?.signal?.aborted) {
      throw new Error('Download cancelled');
    }
    const status = await apiGetJson<ResourceStatusPayload>(
      `/arbitrary/resource/status/${encodeSeg(service)}/${encodeSeg(name)}/${encodeSeg(identifier)}`,
      options?.signal
    );
    const nameStatus = String(status?.status || '');
    const local = Number(status?.localChunkCount || 0);
    const total = Number(status?.totalChunkCount || 0);
    const percent =
      total > 0 ? Math.min(100, Math.round((local / total) * 100)) : nameStatus === 'READY' ? 100 : 0;
    options?.onProgress?.(percent, nameStatus);

    if (nameStatus === 'READY') {
      // Prefer avatar-friendly host so WebView <img> / fetch can load on local HTTPS.
      const base = getBaseApiReactForAvatar().replace(/\/$/, '');
      const path = `/arbitrary/${encodeSeg(service)}/${encodeSeg(name)}/${encodeSeg(identifier)}`;
      return { url: `${base}${path}`, status: nameStatus };
    }
    if (
      nameStatus === 'FAILED_TO_DOWNLOAD' ||
      nameStatus === 'BUILD_FAILED' ||
      nameStatus === 'NOT_PUBLISHED' ||
      nameStatus === 'BLOCKED' ||
      nameStatus === 'UNSUPPORTED'
    ) {
      throw new Error(`QDN download failed (${nameStatus || 'unknown'})`);
    }

    // Also try a build kick once we have all chunks.
    if (nameStatus === 'DOWNLOADED') {
      const base = getBaseApiReact().replace(/\/$/, '');
      void fetch(
        `${base}/arbitrary/resource/status/${encodeSeg(service)}/${encodeSeg(name)}/${encodeSeg(identifier)}?build=true`,
        { signal: options?.signal }
      ).catch(() => undefined);
    }

    await new Promise((r) => window.setTimeout(r, delay));
    delay = Math.min(1200, Math.round(delay * 1.25));
  }
  throw new Error('Timed out waiting for QDN media');
}

function tidyTitle(raw: string | undefined, fallback: string): string {
  const t = (raw || '').trim();
  if (!t) return fallback;
  return t.replace(/\s+/g, ' ').slice(0, 120);
}

function stripCategoryPrefix(desc?: string): string {
  if (!desc) return '';
  return desc.replace(/^\*\*category:[^*]+\*\*/, '').replace(/<[^>]+>/g, ' ').trim().slice(0, 160);
}

/** Which media kinds the user is asking for. */
export function detectMediaIntent(query: string): {
  kinds: QdnMediaKind[];
  explicit: boolean;
} {
  const q = query.toLowerCase();
  const kinds: QdnMediaKind[] = [];
  if (/\b(videos?|qtube|watch|clips?)\b/.test(q)) kinds.push('video');
  if (/\b(music|songs?|audio|earbump|tracks?)\b/.test(q)) kinds.push('audio');
  if (/\b(images?|photos?|pictures?|pics?)\b/.test(q)) kinds.push('image');
  if (/\b(pdfs?|documents?)\b/.test(q)) kinds.push('pdf');
  if (/\b(files?|q-?share|downloads?)\b/.test(q)) kinds.push('file');

  if (kinds.length) {
    return { kinds, explicit: true };
  }
  // Profile / bare-name questions: a small mixed shelf when the user has content.
  if (/\b(who|about|profile|activity|tell me|nominat)/.test(q)) {
    return { kinds: ['video', 'image', 'audio'], explicit: false };
  }
  // Bare name (no media keyword) — still show a few of each kind if present.
  return { kinds: ['video', 'image', 'audio'], explicit: false };
}

async function searchResources(
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<SearchHit[]> {
  const qs = new URLSearchParams({
    mode: 'ALL',
    reverse: 'true',
    includemetadata: 'true',
    // Status payload often carries created/updated/size for card meta.
    includestatus: 'true',
    ...params,
  });
  const data = await apiGetJson<SearchHit[]>(
    `/arbitrary/resources/search?${qs.toString()}`,
    signal
  );
  return Array.isArray(data) ? data : [];
}

function posterFromMetadataJson(data: Record<string, unknown> | null): string | undefined {
  if (!data || typeof data !== 'object' || 'error' in data) return undefined;
  const img =
    (typeof data.videoImage === 'string' && data.videoImage) ||
    (Array.isArray(data.extracts) && typeof data.extracts[0] === 'string'
      ? data.extracts[0]
      : '');
  if (!img) return undefined;
  if (img.startsWith('data:image/')) return img;
  if (img.startsWith('http')) return img;
  return `data:image/jpeg;base64,${img}`;
}

/** In-memory poster cache so cards + viewer don't re-download metadata. */
const posterCache = new Map<string, string>();
const posterInflight = new Map<string, Promise<string | undefined>>();

function posterCacheKey(name: string, videoIdentifier: string): string {
  const metaId = videoIdentifier.endsWith('_metadata')
    ? videoIdentifier
    : `${videoIdentifier}_metadata`;
  return `${name}::${metaId}`;
}

/**
 * Fetch Q-Tube poster from DOCUMENT metadata. Kicks node download and polls briefly.
 * Used by the video viewer / lazy card thumbs — not during the initial media search.
 */
export async function fetchQtubePosterDataUrl(
  name: string,
  videoIdentifier: string,
  options?: {
    downloadResource?: (r: {
      name: string;
      service: string;
      identifier: string;
    }) => void;
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<string | undefined> {
  const cacheKey = posterCacheKey(name, videoIdentifier);
  const cached = posterCache.get(cacheKey);
  if (cached) return cached;

  const existing = posterInflight.get(cacheKey);
  if (existing) return existing;

  const metaId = videoIdentifier.endsWith('_metadata')
    ? videoIdentifier
    : `${videoIdentifier}_metadata`;

  const work = (async (): Promise<string | undefined> => {
    options?.downloadResource?.({
      name,
      service: 'DOCUMENT',
      identifier: metaId,
    });
    // Kick the node download early (fire-and-forget).
    void fetch(resourceUrl('DOCUMENT', name, metaId, true), {
      signal: options?.signal,
    }).catch(() => undefined);

    const deadline = Date.now() + (options?.timeoutMs ?? 10_000);
    let delay = 250;
    while (Date.now() < deadline) {
      if (options?.signal?.aborted) return undefined;
      const data = await apiGetJson<Record<string, unknown>>(
        `/arbitrary/DOCUMENT/${encodeURIComponent(name)}/${encodeURIComponent(metaId)}`,
        options?.signal
      );
      const poster = posterFromMetadataJson(data);
      if (poster) {
        posterCache.set(cacheKey, poster);
        return poster;
      }
      await new Promise((r) => window.setTimeout(r, delay));
      delay = Math.min(800, Math.round(delay * 1.35));
    }
    return undefined;
  })();

  posterInflight.set(cacheKey, work);
  try {
    return await work;
  } finally {
    posterInflight.delete(cacheKey);
  }
}

/**
 * Count Q-Tube likes / superlikes aimed at this creator's videos.
 * Superlikes weigh more. Descriptions carry `id:<videoIdSuffix>`.
 */
async function fetchQtubeEngagementScores(
  creatorName: string,
  videoIds: string[],
  signal?: AbortSignal
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  if (!videoIds.length) return scores;

  const [supers, likes] = await Promise.all([
    searchResources(
      {
        service: 'BLOG_COMMENT',
        query: `${creatorName}_${QTUBE_SUPER_LIKE_QUERY_SUFFIX}`,
        limit: '80',
        reverse: 'true',
        includemetadata: 'true',
      },
      signal
    ).catch(() => [] as SearchHit[]),
    searchResources(
      {
        service: 'BLOG_COMMENT',
        query: `${creatorName}_${QTUBE_LIKE_QUERY_SUFFIX}`,
        limit: '80',
        reverse: 'true',
        includemetadata: 'true',
      },
      signal
    ).catch(() => [] as SearchHit[]),
  ]);

  const matchVideo = (desc: string): string | undefined => {
    const m = desc.match(/id:([^;*\s]+)/i);
    const suffix = (m?.[1] || '').trim();
    if (!suffix) return undefined;
    return videoIds.find(
      (id) =>
        id === suffix ||
        id.endsWith(suffix) ||
        suffix.endsWith(id.slice(-20)) ||
        id.includes(suffix)
    );
  };

  for (const hit of supers) {
    const vid = matchVideo(hit.metadata?.description || '');
    if (vid) scores.set(vid, (scores.get(vid) || 0) + 10);
  }
  for (const hit of likes) {
    const vid = matchVideo(hit.metadata?.description || '');
    if (vid) scores.set(vid, (scores.get(vid) || 0) + 1);
  }
  return scores;
}

/** Quick status probe — drop removed / unpublished VIDEO resources. */
async function isLiveVideoResource(
  name: string,
  videoId: string,
  signal?: AbortSignal
): Promise<boolean> {
  const st = await apiGetJson<ResourceStatusPayload>(
    `/arbitrary/resource/status/VIDEO/${encodeSeg(name)}/${encodeSeg(videoId)}`,
    signal
  );
  if (!st || typeof st !== 'object') return false;
  const status = String(st.status || '').toUpperCase();
  if (!status) {
    // Some nodes omit status but still report chunks for live data.
    return (
      Number(st.localChunkCount || 0) > 0 || Number(st.totalChunkCount || 0) > 0
    );
  }
  if (
    /NOT[_ ]?PUBLISHED|MISSING|ABSENT|DOES NOT EXIST|UNAVAILABLE|BLOCKED|UNSUPPORTED|FAILED/.test(
      status
    )
  ) {
    return false;
  }
  // READY / DOWNLOADED / BUILDING / PUBLISHED / EXISTS / etc.
  return true;
}

async function filterLiveVideos(
  items: QdnMediaItem[],
  limit: number,
  signal?: AbortSignal
): Promise<QdnMediaItem[]> {
  const live: QdnMediaItem[] = [];
  // Probe in small parallel batches; stop once we have enough.
  const batchSize = 4;
  for (let i = 0; i < items.length && live.length < limit; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const flags = await Promise.all(
      batch.map((item) =>
        Promise.race([
          isLiveVideoResource(item.name, item.identifier, signal),
          new Promise<boolean>((resolve) =>
            window.setTimeout(() => resolve(false), 2500)
          ),
        ]).catch(() => false)
      )
    );
    for (let j = 0; j < batch.length; j += 1) {
      if (!flags[j]) continue;
      live.push(batch[j]);
      if (live.length >= limit) break;
    }
  }
  return live;
}

async function fetchVideosForName(
  name: string,
  limit: number,
  signal?: AbortSignal
): Promise<QdnMediaItem[]> {
  // Wider pool so like-ranking + live-status filtering still yield enough cards.
  // Search both Q-Tube DOCUMENT metadata and raw VIDEO under this exact name —
  // secondary names often have VIDEO/DOCUMENT only on that name, not the primary.
  const poolSize = Math.max(limit * 6, 24);
  const [metaHits, videoHits] = await Promise.all([
    searchResources(
      {
        service: 'DOCUMENT',
        name,
        exactmatchnames: 'true',
        identifier: QTUBE_META_PREFIX,
        prefix: 'true',
        limit: String(poolSize),
      },
      signal
    ),
    searchResources(
      {
        service: 'VIDEO',
        name,
        exactmatchnames: 'true',
        limit: String(poolSize),
      },
      signal
    ),
  ]);

  const items: QdnMediaItem[] = [];
  const seenIds = new Set<string>();
  // DOCUMENT *_metadata size is the tiny JSON shell (or THUMBNAIL-scale) —
  // prefer the VIDEO blob size whenever the node reports one.
  const videoSizeById = new Map<string, number>();
  for (const hit of videoHits) {
    if (!isExactPublisherName(hit.name, name)) continue;
    const id = (hit.identifier || '').trim().toLowerCase();
    if (!id) continue;
    if (typeof hit.size === 'number' && hit.size > 0) {
      videoSizeById.set(id, hit.size);
    }
  }

  for (const hit of metaHits) {
    if (!isExactPublisherName(hit.name, name)) continue;
    const id = hit.identifier || '';
    if (!id.startsWith(QTUBE_META_PREFIX) || !id.endsWith('_metadata')) continue;
    const videoId = id.replace(/_metadata$/, '');
    if (seenIds.has(videoId.toLowerCase())) continue;
    seenIds.add(videoId.toLowerCase());
    const title = tidyTitle(hit.metadata?.title, videoId);
    const description = stripCategoryPrefix(hit.metadata?.description);
    const times = hitTimestamps(hit);
    const videoSize = videoSizeById.get(videoId.toLowerCase());
    items.push({
      kind: 'video',
      name, // canonical requested publisher (hit already name-checked)
      service: 'VIDEO',
      identifier: videoId,
      title,
      description,
      size: videoSize ?? undefined,
      ...times,
      // Poster loaded lazily in the UI — keeps who-is scans fast.
    });
  }

  for (const hit of videoHits) {
    if (!isExactPublisherName(hit.name, name)) continue;
    const id = (hit.identifier || '').trim();
    if (!id || seenIds.has(id.toLowerCase())) continue;
    if (/_metadata|_thumb|_poster|tombstone/i.test(id)) continue;
    seenIds.add(id.toLowerCase());
    items.push({
      kind: 'video',
      name,
      service: 'VIDEO',
      identifier: id,
      title: tidyTitle(hit.metadata?.title, id),
      description: stripCategoryPrefix(hit.metadata?.description),
      size: hit.size,
      ...hitTimestamps(hit),
    });
  }

  if (!items.length) return [];

  const scores = await fetchQtubeEngagementScores(
    name,
    items.map((i) => i.identifier),
    signal
  );
  const anyEngagement = [...scores.values()].some((n) => n > 0);

  if (anyEngagement) {
    items.sort((a, b) => {
      const sa = scores.get(a.identifier) || 0;
      const sb = scores.get(b.identifier) || 0;
      if (sb !== sa) return sb - sa;
      return (b.updated || b.created || 0) - (a.updated || a.created || 0);
    });
  } else {
    // No likes/superlikes found — keep most recent.
    items.sort(
      (a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0)
    );
  }

  // Metadata can outlive the VIDEO blob — only keep playable / still-published.
  // Prefer keeping enough from this name even if status probes are slow.
  const live = await filterLiveVideos(items, Math.max(limit, 12), signal);
  const pool = preferSubstantialVideos(live.length ? live : items);
  if (live.length) return pool.slice(0, limit);
  // Fall back to metadata/VIDEO search hits when status checks fail (common on
  // secondary names the node has not fully hydrated yet).
  return pool.slice(0, limit);
}

async function fetchAudioForName(
  name: string,
  limit: number,
  signal?: AbortSignal
): Promise<QdnMediaItem[]> {
  // Ear-Bump / EnjoyMusic first, plus a general AUDIO scan so secondary-name
  // publishers aren't missed when identifiers don't use those prefixes.
  const [ear, enjoy, general] = await Promise.all([
    searchResources(
      {
        service: 'AUDIO',
        name,
        exactmatchnames: 'true',
        identifier: EARBUMP_PREFIX,
        prefix: 'true',
        limit: String(Math.max(limit, 8)),
      },
      signal
    ),
    searchResources(
      {
        service: 'AUDIO',
        name,
        exactmatchnames: 'true',
        identifier: ENJOYMUSIC_PREFIX,
        prefix: 'true',
        limit: String(Math.max(limit, 8)),
      },
      signal
    ),
    searchResources(
      {
        service: 'AUDIO',
        name,
        exactmatchnames: 'true',
        limit: String(Math.max(limit + 8, 16)),
      },
      signal
    ),
  ]);

  const seen = new Set<string>();
  const out: QdnMediaItem[] = [];
  for (const hit of [...ear, ...enjoy, ...general]) {
    if (!isExactPublisherName(hit.name, name)) continue;
    const id = hit.identifier || '';
    if (!id || seen.has(id)) continue;
    // Skip metadata / cover side-resources if present.
    if (/_metadata|_cover|_thumb/i.test(id)) continue;
    seen.add(id);
    out.push({
      kind: 'audio',
      name,
      service: 'AUDIO',
      identifier: id,
      title: tidyTitle(hit.metadata?.title, id),
      description: hit.metadata?.author || hit.metadata?.description,
      size: hit.size,
      ...hitTimestamps(hit),
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchImagesForName(
  name: string,
  limit: number,
  signal?: AbortSignal,
  options?: { publisherSearch?: boolean }
): Promise<QdnMediaItem[]> {
  const publisher = options?.publisherSearch === true;
  // Publisher chip searches need a wider window — profiles often have dozens of IMAGEs.
  const fetchLimit = publisher
    ? Math.max(limit + 24, 48)
    : Math.max(limit + 4, 8);
  // Exact name first; if empty, retry without exactmatchnames (some nodes are picky).
  const searchImage = async (exact: boolean) =>
    searchResources(
      {
        service: 'IMAGE',
        name,
        ...(exact ? { exactmatchnames: 'true' } : {}),
        reverse: 'true',
        limit: String(fetchLimit),
      },
      signal
    );
  let hits = await searchImage(true);
  if (!hits.length && publisher) {
    hits = await searchImage(false);
  }
  // Publisher Images chip: also pick up THUMBNAIL publishes under this name
  // (common gallery / app pattern — still skip qortal_avatar).
  if (publisher) {
    const thumbs = await searchResources(
      {
        service: 'THUMBNAIL',
        name,
        exactmatchnames: 'true',
        reverse: 'true',
        limit: String(Math.max(limit + 8, 24)),
      },
      signal
    );
    hits = [...hits, ...thumbs];
  }

  const out: QdnMediaItem[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (!isExactPublisherName(hit.name, name)) continue;
    const id = hit.identifier || '';
    if (!id) continue;
    const service = (hit.service || 'IMAGE').toUpperCase();
    const key = `${service}:${id}`.toLowerCase();
    if (seen.has(key)) continue;
    // Always skip registry avatar / tombstones. Keep other *_thumb ids when the
    // user asked for this publisher's images explicitly (many real publishes use them).
    if (/qortal_avatar|^tombstone$/i.test(id)) continue;
    if (!publisher && /_thumb$/i.test(id)) continue;
    const title = tidyTitle(hit.metadata?.title, id);
    if (/tombstone/i.test(title)) continue;
    // Soft size filter only for casual shelves — publisher search keeps small images.
    if (!publisher && (hit.size ?? 0) > 0 && (hit.size ?? 0) < 4000) continue;
    seen.add(key);
    out.push({
      kind: 'image',
      name,
      service: service === 'THUMBNAIL' ? 'THUMBNAIL' : 'IMAGE',
      identifier: id,
      title,
      // No async thumbnail URL — WebView needs READY first (loaded on tap / lazy).
      size: hit.size,
      ...hitTimestamps(hit),
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchFilesForName(
  name: string,
  limit: number,
  pdfOnly: boolean,
  signal?: AbortSignal,
  options?: { publisherSearch?: boolean }
): Promise<QdnMediaItem[]> {
  const publisher = options?.publisherSearch === true;
  // Casual shelves: Q-Share prefix. Publisher/documents chip: all FILE under name.
  const hits = publisher
    ? await searchResources(
        {
          service: 'FILE',
          name,
          exactmatchnames: 'true',
          reverse: 'true',
          limit: String(Math.max(limit + 16, 32)),
        },
        signal
      )
    : await searchResources(
        {
          service: 'FILE',
          name,
          exactmatchnames: 'true',
          identifier: QSHARE_PREFIX,
          prefix: 'true',
          limit: String(Math.max(limit + 2, 6)),
        },
        signal
      );

  const out: QdnMediaItem[] = [];
  for (const hit of hits) {
    if (!isExactPublisherName(hit.name, name)) continue;
    const id = hit.identifier || '';
    if (!id) continue;
    if (!publisher && !id.startsWith(QSHARE_PREFIX)) continue;
    if (/tombstone|qortal_avatar|_metadata$/i.test(id)) continue;
    const title = tidyTitle(hit.metadata?.title, id);
    const blob = `${title} ${id}`.toLowerCase();
    const isPdf = blob.includes('.pdf') || blob.includes('pdf');
    if (pdfOnly && !isPdf) continue;
    if (
      !publisher &&
      (hit.size ?? 0) > 0 &&
      (hit.size ?? 0) < 10_000 &&
      !isPdf
    ) {
      continue;
    }
    out.push({
      kind: isPdf ? 'pdf' : 'file',
      name,
      service: 'FILE',
      identifier: id,
      title,
      description: hit.metadata?.description,
      size: hit.size,
      ...hitTimestamps(hit),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchMediaForName(
  name: string,
  options?: {
    kinds?: QdnMediaKind[];
    explicit?: boolean;
    signal?: AbortSignal;
    /** Per-kind caps (defaults depend on explicit). */
    limits?: Partial<Record<QdnMediaKind, number>>;
    /**
     * Chip-forced publisher search (Videos/Images/… + a registered name).
     * Uses wider limits and softer filters so real publishes are not dropped.
     */
    publisherSearch?: boolean;
  }
): Promise<QdnMediaItem[]> {
  const kinds = options?.kinds?.length
    ? options.kinds
    : (['video', 'audio', 'image', 'pdf', 'file'] as QdnMediaKind[]);
  const explicit = options?.explicit === true;
  const publisherSearch = options?.publisherSearch === true || explicit;
  const signal = options?.signal;

  // Modest shelves — show several when they exist, never dump the whole history.
  const limits = {
    video: options?.limits?.video ?? (publisherSearch ? 20 : explicit ? 8 : 4),
    audio: options?.limits?.audio ?? (publisherSearch ? 20 : explicit ? 4 : 3),
    image: options?.limits?.image ?? (publisherSearch ? 24 : explicit ? 4 : 3),
    pdf: options?.limits?.pdf ?? (publisherSearch ? 12 : explicit ? 3 : 0),
    file: options?.limits?.file ?? (publisherSearch ? 12 : explicit ? 3 : 0),
  };

  const tasks: Promise<QdnMediaItem[]>[] = [];
  if (kinds.includes('video') && limits.video > 0) {
    tasks.push(fetchVideosForName(name, limits.video, signal));
  }
  if (kinds.includes('audio') && limits.audio > 0) {
    tasks.push(fetchAudioForName(name, limits.audio, signal));
  }
  if (kinds.includes('image') && limits.image > 0) {
    tasks.push(
      fetchImagesForName(name, limits.image, signal, { publisherSearch })
    );
  }
  if ((kinds.includes('pdf') || kinds.includes('file')) && (limits.pdf > 0 || limits.file > 0)) {
    const pdfOnly = kinds.includes('pdf') && !kinds.includes('file');
    tasks.push(
      fetchFilesForName(
        name,
        Math.max(limits.pdf, limits.file),
        pdfOnly,
        signal,
        { publisherSearch }
      )
    );
  }
  if (!tasks.length) return [];

  const batches = await Promise.all(tasks);
  // Belt-and-suspenders: never surface another publisher's resources.
  const merged = batches
    .flat()
    .filter((item) => isExactPublisherName(item.name, name));
  // Stable-ish order: videos, audio, images, pdfs, files
  const order: Record<QdnMediaKind, number> = {
    video: 0,
    audio: 1,
    image: 2,
    pdf: 3,
    file: 4,
  };
  merged.sort((a, b) => order[a.kind] - order[b.kind]);
  return preferSubstantialVideos(merged);
}

/**
 * Fetch media across every registered name on an account.
 * When `preferredName` is set (the name the user typed — often a secondary),
 * results from that name lead and keep reserved slots so the primary cannot
 * drown them out.
 */
export async function fetchMediaForOwnedNames(
  names: string[],
  options?: {
    kinds?: QdnMediaKind[];
    explicit?: boolean;
    signal?: AbortSignal;
    /** Max total items after merge */
    limit?: number;
    /** Name the user searched — always prioritize its publishes */
    preferredName?: string;
  }
): Promise<QdnMediaItem[]> {
  const unique = [
    ...new Map(
      names
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => [n.toLowerCase(), n] as const)
    ).values(),
  ];
  if (!unique.length) return [];

  const limit = options?.limit ?? 24;
  const preferred = (options?.preferredName || '').trim();
  const preferredKey = preferred.toLowerCase();

  // Fetch the looked-up name first with a larger budget, then siblings.
  const ordered = preferred
    ? [
        preferred,
        ...unique.filter((n) => n.toLowerCase() !== preferredKey),
      ]
    : unique;

  const perNameLimit = options?.explicit ? 12 : 5;
  const preferredLimit = Math.max(perNameLimit, Math.min(20, limit));

  const batches = await Promise.all(
    ordered.map((name) =>
      fetchMediaForName(name, {
        kinds: options?.kinds,
        explicit: options?.explicit,
        signal: options?.signal,
        limits: {
          video:
            preferredKey && name.toLowerCase() === preferredKey
              ? preferredLimit
              : perNameLimit,
          audio:
            preferredKey && name.toLowerCase() === preferredKey
              ? preferredLimit
              : perNameLimit,
          image:
            preferredKey && name.toLowerCase() === preferredKey
              ? preferredLimit
              : perNameLimit,
          pdf: options?.explicit ? 4 : 0,
          file: options?.explicit ? 4 : 0,
        },
      }).catch(() => [] as QdnMediaItem[])
    )
  );

  const seen = new Set<string>();
  const fromPreferred: QdnMediaItem[] = [];
  const fromOthers: QdnMediaItem[] = [];
  for (const item of batches.flat()) {
    const key = `${item.service}:${item.name}:${item.identifier}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (preferredKey && item.name.toLowerCase() === preferredKey) {
      fromPreferred.push(item);
    } else {
      fromOthers.push(item);
    }
  }

  const kindOrder: Record<QdnMediaKind, number> = {
    video: 0,
    audio: 1,
    image: 2,
    pdf: 3,
    file: 4,
  };
  const byRecency = (a: QdnMediaItem, b: QdnMediaItem) => {
    const ko = kindOrder[a.kind] - kindOrder[b.kind];
    if (ko !== 0) return ko;
    return (b.updated || b.created || 0) - (a.updated || a.created || 0);
  };
  fromPreferred.sort(byRecency);
  fromOthers.sort(byRecency);

  // Prefer the searched name's publishes. Only fill remainder from other names
  // (e.g. primary) so secondary-name searches surface that name's content.
  if (fromPreferred.length) {
    const reserved = Math.min(fromPreferred.length, Math.max(12, Math.floor(limit * 0.75)));
    const head = fromPreferred.slice(0, reserved);
    const rest = [
      ...fromPreferred.slice(reserved),
      ...fromOthers,
    ];
    return preferSubstantialVideos([...head, ...rest]).slice(0, limit);
  }

  return preferSubstantialVideos(fromOthers).slice(0, limit);
}

/** Compact notes for the on-device LLM (titles + date/size). */
export function mediaItemsToContext(items: QdnMediaItem[]): string {
  if (!items.length) return '';
  const lines = items.slice(0, 12).map((m, i) => {
    const size = formatMediaBytes(m.size);
    const date = formatMediaDate(m.updated || m.created);
    const meta = [date, size].filter(Boolean).join(' · ');
    return formatQdnResourceLine({
      index: i + 1,
      name: m.name,
      service: m.service,
      identifier: m.identifier,
      title: m.title,
      when: meta || undefined,
    });
  });
  return (
    `Playable QDN media found (also shown as cards in the chat UI):\n` +
    lines.join('\n') +
    `\nMention highlights by title. Include the markdown [Open…](qortal://APP/…) links when present. Do NOT paste raw identifier hashes as the main answer.`
  );
}

export function buildMediaStreamUrl(item: QdnMediaItem, async = true): string {
  return resourceUrl(item.service, item.name, item.identifier, async);
}

/** Prefer avatar-friendly base (HTTP on local HTTPS) so WebView <img> thumbs load. */
export function buildMediaThumbUrl(item: QdnMediaItem, async = true): string {
  const base = getBaseApiReactForAvatar().replace(/\/$/, '');
  const path = `/arbitrary/${encodeSeg(item.service)}/${encodeSeg(item.name)}/${encodeSeg(item.identifier)}`;
  return async ? `${base}${path}?async=true` : `${base}${path}`;
}

/**
 * Wait for READY, then fetch the image bytes and return a blob: object URL.
 * More reliable in Capacitor WebView than pointing <img> at the node URL
 * (large IMAGEs often fail as direct src even when VIDEO posters work).
 */
export async function fetchQdnImageObjectUrl(
  item: Pick<QdnMediaItem, 'service' | 'name' | 'identifier'>,
  options?: {
    downloadResource?: (r: {
      name: string;
      service: string;
      identifier: string;
    }) => void;
    timeoutMs?: number;
    signal?: AbortSignal;
    onProgress?: (percent: number, status: string) => void;
  }
): Promise<string> {
  const { url } = await waitForQdnResourceReady(item, options);
  const res = await fetch(url, { signal: options?.signal });
  if (!res.ok) {
    throw new Error(`Image fetch failed (${res.status})`);
  }
  const blob = await res.blob();
  if (!blob.size) {
    throw new Error('Empty image from QDN');
  }
  return URL.createObjectURL(blob);
}
