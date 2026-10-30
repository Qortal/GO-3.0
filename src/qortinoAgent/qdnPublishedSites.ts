/**
 * MA-Helper–style published APP / WEBSITE roots for a Qortal account.
 * Status-probe per owned name (fast; avoids heavy resource search).
 */
import { apiGetJson } from './qdnApi';
import { qAppAvatarUrl } from './qAppCatalog';

export type QdnPublishedSite = {
  service: 'APP' | 'WEBSITE';
  name: string;
  title: string;
  avatarUrl: string;
};

type NameRow = { name?: string };

const NAMES_PAGE = 100;

/** All registered names on an address (paginate — not capped at 50). */
export async function fetchAllOwnedNames(
  address: string,
  signal?: AbortSignal
): Promise<string[]> {
  const unlimited = await apiGetJson<NameRow[]>(
    `/names/address/${encodeURIComponent(address)}?limit=0`,
    signal
  );
  if (Array.isArray(unlimited) && unlimited.length > 0) {
    return dedupeNames(unlimited.map((r) => r.name || ''));
  }

  const names: string[] = [];
  const seen = new Set<string>();
  for (let offset = 0; ; offset += NAMES_PAGE) {
    if (signal?.aborted) break;
    const page = await apiGetJson<NameRow[]>(
      `/names/address/${encodeURIComponent(address)}?limit=${NAMES_PAGE}&offset=${offset}`,
      signal
    );
    if (!Array.isArray(page) || !page.length) break;
    for (const row of page) {
      const nm = (row.name || '').trim();
      const key = nm.toLowerCase();
      if (!nm || seen.has(key)) continue;
      seen.add(key);
      names.push(nm);
    }
    if (page.length < NAMES_PAGE) break;
  }
  return names;
}

function dedupeNames(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of raw) {
    const nm = n.trim();
    const key = nm.toLowerCase();
    if (!nm || seen.has(key)) continue;
    seen.add(key);
    out.push(nm);
  }
  return out;
}

/**
 * Qortal `/arbitrary/resource/status/{SERVICE}/{name}` often returns:
 * `{ status: "READY", localChunkCount, totalChunkCount, percentLoaded }`
 * — not created/updated/size. Treat READY/DOWNLOADED as published.
 */
function looksPublished(st: unknown): boolean {
  if (!st || typeof st !== 'object' || Array.isArray(st)) return false;
  const o = st as Record<string, unknown>;
  if (typeof o.error === 'number' && o.error !== 0) return false;
  if (
    typeof o.message === 'string' &&
    o.message.toLowerCase().includes('not found')
  ) {
    return false;
  }
  const status = typeof o.status === 'string' ? o.status.toUpperCase() : '';
  if (/NOT[_ ]?PUBLISHED|MISSING|ABSENT|DOES NOT EXIST|UNAVAILABLE/.test(status)) {
    return false;
  }
  if (/^(READY|DOWNLOADED|PUBLISHED|EXISTS|BUILDING)/.test(status)) {
    return true;
  }
  if (typeof o.localChunkCount === 'number' && o.localChunkCount > 0) {
    return true;
  }
  if (typeof o.percentLoaded === 'number' && o.percentLoaded > 0) {
    return true;
  }
  return (
    typeof o.created === 'number' ||
    typeof o.updated === 'number' ||
    typeof o.size === 'number' ||
    typeof o.identifier === 'string'
  );
}

/** Status payloads sometimes echo READY/DOWNLOADED into a "title" field — never show those. */
function isStatusLikeLabel(raw: string): boolean {
  return /^(READY|DOWNLOADED|PUBLISHED|EXISTS|BUILDING|MISSING|ABSENT|UNSUPPORTED|BLOCKED|NOT[_ ]?PUBLISHED|FAILED.*)$/i.test(
    raw.trim()
  );
}

function displayTitleForPublish(
  name: string,
  st: unknown,
  service: 'APP' | 'WEBSITE'
): string {
  // On Qortal the registered name *is* the APP/WEBSITE identity.
  if (!st || typeof st !== 'object') return name;
  const o = st as Record<string, unknown>;
  const candidates = [o.title, o.name, o.filename].filter(
    (v): v is string => typeof v === 'string' && !!v.trim()
  );
  for (const c of candidates) {
    if (isStatusLikeLabel(c)) continue;
    // Don't use the service word alone.
    if (/^(APP|WEBSITE)$/i.test(c.trim())) continue;
    return c.trim();
  }
  void service;
  return name;
}

async function probeRoot(
  name: string,
  service: 'APP' | 'WEBSITE',
  signal?: AbortSignal
): Promise<QdnPublishedSite | null> {
  const enc = encodeURIComponent;
  // Default root (no identifier) then explicit empty / default identifier.
  const paths = [
    `/arbitrary/resource/status/${enc(service)}/${enc(name)}`,
    `/arbitrary/resource/status/${enc(service)}/${enc(name)}/default`,
  ];
  for (const path of paths) {
    const st = await apiGetJson<unknown>(path, signal);
    if (!looksPublished(st)) continue;
    return {
      service,
      name,
      title: displayTitleForPublish(name, st, service),
      avatarUrl: qAppAvatarUrl(name),
    };
  }

  // Fallback: default=true search for this name + service.
  const search = await apiGetJson<Array<{ name?: string; service?: string }>>(
    `/arbitrary/resources/search?service=${enc(service)}&name=${enc(name)}&exactmatchnames=true&default=true&limit=3&includestatus=false`,
    signal
  );
  if (Array.isArray(search) && search.some((r) => (r.name || '').toLowerCase() === name.toLowerCase())) {
    return {
      service,
      name,
      title: name,
      avatarUrl: qAppAvatarUrl(name),
    };
  }
  return null;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * Probe default APP + WEBSITE publishes for each owned name (MA-Helper style).
 */
export async function fetchPublishedSitesForNames(
  names: string[],
  signal?: AbortSignal
): Promise<QdnPublishedSite[]> {
  const unique = dedupeNames(names);
  if (!unique.length) return [];

  const hits = await mapPool(unique, 8, async (name) => {
    if (signal?.aborted) return [] as QdnPublishedSite[];
    const [app, site] = await Promise.all([
      probeRoot(name, 'APP', signal),
      probeRoot(name, 'WEBSITE', signal),
    ]);
    return [app, site].filter((x): x is QdnPublishedSite => !!x);
  });

  const out: QdnPublishedSite[] = [];
  const seen = new Set<string>();
  for (const batch of hits) {
    for (const item of batch) {
      const key = `${item.service}:${item.name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  out.sort((a, b) => {
    if (a.service !== b.service) return a.service === 'APP' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}
