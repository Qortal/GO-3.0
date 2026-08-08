/**
 * Recent Quitter posts for a Qortal name (QDN who-is shelf).
 */
import { executeEvent } from '../utils/events';
import { getBaseApiReact } from '../utils/globalApi';
import { parkQortinoAgentSheet } from './qortinoSheetNav';

export type QuitterPostCard = {
  name: string;
  identifier: string;
  text: string;
  created?: number;
};

/** Open a Quitter post in a new Hub/Go tab (same path shape as the home composer). */
export function openQuitterPostInNewTab(post: Pick<QuitterPostCard, 'name' | 'identifier'>): void {
  parkQortinoAgentSheet();
  executeEvent('addTab', {
    data: {
      identifier: '',
      name: 'Quitter',
      path: `post/${encodeURIComponent(post.name)}/${encodeURIComponent(post.identifier)}`,
      service: 'APP',
      navigateIfAlreadyOpen: true,
    },
  });
  executeEvent('open-apps-mode', {});
}

const QUITTER_APP_HASH = 'MhNiRYdzkaP9dz';
const QUITTER_POST = 'kX47dT';
const QUITTER_PUBLIC_POST_PREFIX = 'MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-';

/** Prefer text posts; skip like-stubs (~32B) and huge media attachments. */
const TEXT_SIZE_MIN = 100;
const TEXT_SIZE_MAX = 24_000;

type SearchHit = {
  name?: string;
  identifier?: string;
  size?: number;
  created?: number;
  updated?: number;
  timestamp?: number;
};

async function apiGetJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  const base = getBaseApiReact().replace(/\/$/, '');
  try {
    const res = await fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
      signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isQuitterPostId(identifier: string): boolean {
  const id = identifier.trim();
  if (!id.endsWith('-v1') || id.includes('_metadata')) return false;
  const parts = id.split('-');
  return parts[0] === QUITTER_APP_HASH && parts[1] === QUITTER_POST;
}

function textQualityScore(size: number | undefined): number {
  const s = typeof size === 'number' ? size : 0;
  if (s >= TEXT_SIZE_MIN && s <= TEXT_SIZE_MAX) return 3;
  if (s > TEXT_SIZE_MAX && s <= 200_000) return 1;
  if (s > 0 && s < TEXT_SIZE_MIN) return 0;
  return 0.5;
}

async function fetchPostText(
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
    (typeof data.message === 'string' && data.message) ||
    '';
  const clean = stripHtml(text).slice(0, 280);
  // Skip like/reaction stubs ("D", "this post has been liked", etc.)
  if (!clean || clean.length < 12) return undefined;
  if (/^this (post|article) has been liked$/i.test(clean)) return undefined;
  return clean;
}

async function fetchPostTextTimed(
  name: string,
  identifier: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string | undefined> {
  return Promise.race([
    fetchPostText(name, identifier, signal),
    new Promise<undefined>((resolve) =>
      window.setTimeout(() => resolve(undefined), timeoutMs)
    ),
  ]);
}

/** Most recent Quitter posts for a name (default 3). */
export async function fetchRecentQuitterPosts(
  name: string,
  limit = 3,
  signal?: AbortSignal
): Promise<QuitterPostCard[]> {
  const qs = new URLSearchParams({
    mode: 'ALL',
    service: 'DOCUMENT',
    name,
    exactmatchnames: 'true',
    identifier: QUITTER_PUBLIC_POST_PREFIX,
    prefix: 'true',
    reverse: 'true',
    // Pull a wider window — many recent ids are media/stub resources.
    limit: String(Math.max(limit * 10, 30)),
    excludeblocked: 'true',
  });
  const hits = await apiGetJson<SearchHit[]>(
    `/arbitrary/resources/search?${qs.toString()}`,
    signal
  );
  const rows = (Array.isArray(hits) ? hits : [])
    .filter((h) => h.identifier && isQuitterPostId(h.identifier))
    .sort((a, b) => {
      const q = textQualityScore(b.size) - textQualityScore(a.size);
      if (q !== 0) return q;
      return (
        (b.created || b.updated || b.timestamp || 0) -
        (a.created || a.updated || a.timestamp || 0)
      );
    });

  const out: QuitterPostCard[] = [];
  const seen = new Set<string>();

  // Pass 1: likely text posts (fast timeout).
  for (const row of rows) {
    if (out.length >= limit) break;
    if (textQualityScore(row.size) < 3) continue;
    const id = row.identifier!;
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      const text = await fetchPostTextTimed(name, id, 3500, signal);
      if (!text) continue;
      out.push({
        name: row.name || name,
        identifier: id,
        text,
        created: row.created || row.updated || row.timestamp,
      });
    } catch {
      /* skip */
    }
  }

  // Pass 2: remaining recent ids (skip tiny stubs) until we have `limit`.
  if (out.length < limit) {
    const byRecency = [...rows].sort(
      (a, b) =>
        (b.created || b.updated || b.timestamp || 0) -
        (a.created || a.updated || a.timestamp || 0)
    );
    for (const row of byRecency) {
      if (out.length >= limit) break;
      const id = row.identifier!;
      if (seen.has(id)) continue;
      if ((row.size ?? 0) > 0 && (row.size ?? 0) < TEXT_SIZE_MIN) continue;
      seen.add(id);
      try {
        const text = await fetchPostTextTimed(name, id, 4500, signal);
        if (!text) continue;
        out.push({
          name: row.name || name,
          identifier: id,
          text,
          created: row.created || row.updated || row.timestamp,
        });
      } catch {
        /* skip */
      }
    }
  }

  out.sort((a, b) => (b.created || 0) - (a.created || 0));
  return out.slice(0, limit);
}

/** Merge posts from several dossiers; keep newest unique ids up to `limit`. */
export function mergeQuitterPosts(
  posts: QuitterPostCard[],
  limit = 3
): QuitterPostCard[] {
  const seen = new Set<string>();
  const out: QuitterPostCard[] = [];
  const sorted = [...posts].sort((a, b) => (b.created || 0) - (a.created || 0));
  for (const p of sorted) {
    if (!p.identifier || seen.has(p.identifier)) continue;
    seen.add(p.identifier);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}
