/**
 * Resolve the real QDN identifiers for the Qortino AI resources.
 *
 * The packs are published with Q-Share, which mints a random identifier per
 * file (e.g. `qshare_file_qortino-ai_hE3ZLM`) instead of the stable ids the
 * manifest declares (`qortino_pack_standard`). Three strategies are tried, so
 * a slow or cold node can still resolve the packs:
 *
 *  1. Q-Share metadata DOCUMENT (`…_metadata`) — authoritative filename ->
 *     identifier map, but requires downloading that resource's content.
 *  2. Resource listing + size match — index-only, no content fetch, so it
 *     works instantly on a node that has never seen the data.
 *  3. The manifest's own identifier, verified against the resource status.
 */
import { createEndpoint } from '../background/background';
import { PUBLISHED_QSHARE_FILES, QORTINO_QDN_NAME } from './manifest';

export type QshareFileEntry = {
  filename: string;
  identifier: string;
  service: string;
  size?: number;
  mimetype?: string;
};

export type QdnResourceRow = {
  identifier: string;
  service: string;
  size: number;
  created: number;
};

type QshareMetadataDoc = {
  files?: QshareFileEntry[];
};

const QSHARE_IDENTIFIER_PREFIX = 'qshare_file_';
const QSHARE_METADATA_SUFFIX = '_metadata';

/** Index lookups are cheap; fetching resource *content* can need peer chunks. */
const LIST_TIMEOUT_MS = 20_000;
const CONTENT_TIMEOUT_MS = 90_000;

/** A pack matches when its size is within this fraction of the expected size. */
const SIZE_MATCH_TOLERANCE = 0.25;

let cachedFiles: Map<string, QshareFileEntry> | null = null;
let cachedFileRows: QdnResourceRow[] | null = null;

export function clearQortinoQshareCache(): void {
  cachedFiles = null;
  cachedFileRows = null;
}

async function fetchJson<T>(path: string, timeoutMs: number): Promise<T | null> {
  try {
    const url = await createEndpoint(path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

function encodedName(): string {
  return encodeURIComponent(QORTINO_QDN_NAME);
}

/**
 * Every resource published under the Qortino AI name for a service.
 * `/arbitrary/resources` is used rather than `/resources/search` because the
 * search index only returns one row per name+service.
 */
export async function listQortinoResources(
  service: 'FILE' | 'DOCUMENT'
): Promise<QdnResourceRow[]> {
  if (service === 'FILE' && cachedFileRows) return cachedFileRows;
  const rows =
    (await fetchJson<Partial<QdnResourceRow>[]>(
      `/arbitrary/resources?service=${service}&name=${encodedName()}&limit=100`,
      LIST_TIMEOUT_MS
    )) || [];
  const parsed = rows
    .filter((row) => typeof row?.identifier === 'string')
    .map((row) => ({
      identifier: String(row.identifier),
      service: String(row.service || service),
      size: typeof row.size === 'number' ? row.size : 0,
      created: typeof row.created === 'number' ? row.created : 0,
    }));
  // Never cache an empty result — a node whose arbitrary-resource cache is
  // still building would otherwise stay "empty" for the whole session.
  if (service === 'FILE' && parsed.length) cachedFileRows = parsed;
  return parsed;
}

/**
 * Identifier for a manifest file from the publish baked into this build.
 * Last line of defence when the node can serve neither the Q-Share metadata
 * document nor a resource listing.
 */
export function knownPublishedEntry(opts: {
  relativePath?: string;
  id?: string;
}): QshareFileEntry | undefined {
  const keys = [basenameOf(opts.relativePath || ''), `${opts.id || ''}`.toLowerCase()];
  for (const key of keys) {
    const hit = key ? PUBLISHED_QSHARE_FILES[key] : undefined;
    if (hit) {
      return {
        filename: key,
        identifier: hit.identifier,
        service: hit.service,
        size: hit.sizeBytes,
      };
    }
  }
  return undefined;
}

/**
 * Cheap status probe. `unknown` means the node did not answer — the caller
 * should keep going rather than treat that as a missing resource.
 */
export async function resourcePublishState(
  service: string,
  identifier: string
): Promise<'published' | 'missing' | 'unknown'> {
  const status = await fetchJson<{ status?: string }>(
    `/arbitrary/resource/status/${service}/${encodedName()}/${encodeURIComponent(identifier)}`,
    LIST_TIMEOUT_MS
  );
  if (!status?.status) return 'unknown';
  return status.status === 'NOT_PUBLISHED' ? 'missing' : 'published';
}

/** Newest-first Q-Share metadata documents for the Qortino AI name. */
async function listQshareMetadataIdentifiers(): Promise<string[]> {
  const rows = await listQortinoResources('DOCUMENT');
  return rows
    .filter(
      (row) =>
        row.identifier.startsWith(QSHARE_IDENTIFIER_PREFIX) &&
        row.identifier.endsWith(QSHARE_METADATA_SUFFIX)
    )
    .sort((a, b) => b.created - a.created)
    .map((row) => row.identifier);
}

/**
 * Map of lowercased filename -> Q-Share file entry for the newest share
 * published under the Qortino AI name. Empty when the metadata document
 * cannot be read (cold node, offline peers) — callers fall back to size match.
 */
export async function discoverQortinoQshareFiles(options?: {
  force?: boolean;
}): Promise<Map<string, QshareFileEntry>> {
  if (cachedFiles && !options?.force) return cachedFiles;

  const result = new Map<string, QshareFileEntry>();
  const metadataIds = await listQshareMetadataIdentifiers();

  for (const metadataId of metadataIds) {
    const doc = await fetchJson<QshareMetadataDoc>(
      `/arbitrary/DOCUMENT/${encodedName()}/${encodeURIComponent(metadataId)}`,
      CONTENT_TIMEOUT_MS
    );
    if (!doc?.files?.length) continue;
    for (const file of doc.files) {
      const filename = String(file?.filename || '').trim();
      const identifier = String(file?.identifier || '').trim();
      if (!filename || !identifier) continue;
      const key = filename.toLowerCase();
      // Newest share wins — never overwrite with an older publish.
      if (result.has(key)) continue;
      result.set(key, {
        filename,
        identifier,
        service: String(file?.service || 'FILE'),
        size: typeof file?.size === 'number' ? file.size : undefined,
        mimetype: file?.mimetype,
      });
    }
    if (result.size) break;
  }

  // Only cache a useful result, so a cold-node miss can be retried.
  if (result.size) cachedFiles = result;
  return result;
}

/** `packs/qortino-lite.zip` -> `qortino-lite.zip` */
export function basenameOf(relativePath: string): string {
  const parts = String(relativePath || '').split('/');
  return (parts[parts.length - 1] || '').toLowerCase();
}

/**
 * Look up a Q-Share entry for a manifest file, matching on the relativePath
 * basename first (`qortino-lite.zip` == `Qortino-Lite.zip`) then the id.
 */
export function matchQshareEntry(
  files: Map<string, QshareFileEntry>,
  opts: { relativePath?: string; id?: string; identifier?: string }
): QshareFileEntry | undefined {
  if (!files.size) return undefined;
  const candidates = [
    basenameOf(opts.relativePath || ''),
    `${opts.id || ''}`.toLowerCase(),
    `${opts.identifier || ''}`.toLowerCase(),
  ].filter(Boolean);
  for (const key of candidates) {
    const hit = files.get(key);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Pick the published resource whose size is closest to `expectedBytes`.
 * The Lite and Standard packs differ ~2x, so the nearest match is unambiguous
 * even against the bundled manifest's rounded sizes. Chunked storage adds a
 * little overhead, hence the tolerance rather than an exact comparison.
 */
export function matchResourceBySize(
  rows: QdnResourceRow[],
  expectedBytes: number,
  options?: { exclude?: Set<string> }
): QdnResourceRow | undefined {
  if (!rows.length || !expectedBytes || expectedBytes <= 0) return undefined;
  let best: QdnResourceRow | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (!row.size) continue;
    if (options?.exclude?.has(row.identifier)) continue;
    const delta = Math.abs(row.size - expectedBytes) / expectedBytes;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = row;
    }
  }
  return bestDelta <= SIZE_MATCH_TOLERANCE ? best : undefined;
}
