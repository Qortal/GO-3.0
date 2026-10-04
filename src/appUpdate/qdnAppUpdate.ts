/**
 * Finds the newest Qortal GO build published to QDN with Q-Share+ (or the
 * original Q-Share: both write the same share data).
 *
 * Q-Share mints a random identifier per file (`qshare_file_<name>_aB12Cd`) and
 * writes one DOCUMENT per share (`…_metadata`) listing what that share
 * contains. So the newest builds are found by reading the newest share
 * documents rather than by guessing identifiers, and the release notes are the
 * description the publisher typed into Q-Share, which rides along on the QDN
 * transaction metadata.
 */
import { createEndpoint } from '../background/background';
import {
  createNativeNodeRequest,
  type NativeNodeRequest,
} from '../utils/nativeNodeRequest';

/** The registered name that publishes official builds. */
export const APP_UPDATE_QDN_NAME = 'GO 3.0';

/**
 * The Q-App that opens a build's share page. Builds are published with
 * Q-Share+, which reads the same share data as Q-Share and serves the same
 * `share/<name>/<id>` route. The literal `+` is the app's QDN name.
 */
export const APP_UPDATE_SHARE_APP = 'Q-Share+';

const QSHARE_PREFIX = 'qshare_file_';
const METADATA_SUFFIX = '_metadata';

/** Index lookups are cheap; share documents may need chunks from peers. */
const LIST_TIMEOUT_MS = 20_000;
const CONTENT_TIMEOUT_MS = 60_000;

/** A build older than the last handful of shares is not an update. */
const MAX_SHARES_SCANNED = 8;
/** Share documents fetched at once when listing every version. */
const LIST_CONCURRENCY = 4;

export type AppRelease = {
  filename: string;
  identifier: string;
  /** Plain-text release notes; empty when only the rich version exists. */
  notes: string;
  /** Q-Share's rich description, sanitised before it is rendered. */
  notesHtml: string;
  publishedAt: number;
  service: string;
  /** The Q-Share share (`…_metadata`) this build belongs to. */
  shareIdentifier: string;
  size: number;
  title: string;
  version: string;
};

type QdnResourceRow = {
  created: number;
  identifier: string;
  metadata?: { description?: string; title?: string };
  service: string;
  size: number;
};

type QshareShareDoc = {
  description?: string;
  files?: Array<{
    filename?: string;
    identifier?: string;
    mimetype?: string;
    service?: string;
    size?: number;
  }>;
  /** Q-Share's rich text: the only copy that is not cut short. */
  htmlDescription?: string;
  fullDescription?: string;
  title?: string;
};

const encodedName = () => encodeURIComponent(APP_UPDATE_QDN_NAME);

async function fetchJson<T>(
  path: string,
  timeoutMs: number
): Promise<T | null> {
  try {
    const url = await createEndpoint(path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * Everything published under the name for one service. `/arbitrary/resources`
 * rather than the search index, which collapses to one row per name+service.
 * Null when the node did not answer, which is not the same as "nothing".
 */
async function listResources(
  service: 'DOCUMENT' | 'FILE'
): Promise<QdnResourceRow[] | null> {
  const rows = await fetchJson<Partial<QdnResourceRow>[]>(
    `/arbitrary/resources?service=${service}&name=${encodedName()}&limit=100&includemetadata=true`,
    LIST_TIMEOUT_MS
  );
  if (!Array.isArray(rows)) return null;
  return rows
    .filter((row) => typeof row?.identifier === 'string')
    .map((row) => ({
      created: typeof row.created === 'number' ? row.created : 0,
      identifier: String(row.identifier),
      metadata: row.metadata,
      service: String(row.service || service),
      size: typeof row.size === 'number' ? row.size : 0,
    }));
}

/**
 * `qortal-go-3.0.5.apk` -> `3.0.5`. The last dotted number in the name wins, so
 * a build tag in front of it (`go2-3.0.5.apk`) does not become the version.
 */
export function versionFromFilename(filename: string): string | null {
  const base = String(filename || '').replace(/\.apk$/i, '');
  const matches = base.match(/\d+(?:\.\d+){1,3}/g);
  return matches?.length ? matches[matches.length - 1] : null;
}

/** Positive when `a` is newer, 0 when the two name the same build. */
export function compareVersions(a: string, b: string): number {
  const left = String(a || '').split('.');
  const right = String(b || '').split('.');
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const delta = (Number(left[i]) || 0) - (Number(right[i]) || 0);
    if (delta) return delta;
  }
  return 0;
}

/**
 * Q-Share writes its category as a marker on the front of the description
 * (`**cat:1;sub:104**`), which is for Q-Share's own browser, not for reading.
 */
const stripCategoryMarker = (text: string): string =>
  String(text || '')
    .replace(/^\*\*cat:[^*]*\*\*/, '')
    .trim();

/**
 * What the publisher typed into Q-Share. The copy on the QDN transaction is cut
 * short by the chain's metadata limit, so the share document's rich description
 * is the one worth showing and the transaction's is only a fallback.
 */
async function readTransactionNotes(
  service: string,
  identifier: string
): Promise<{ notes: string; title: string } | null> {
  const meta = await fetchJson<{ description?: string; title?: string }>(
    `/arbitrary/metadata/${service}/${encodedName()}/${encodeURIComponent(identifier)}`,
    LIST_TIMEOUT_MS
  );
  const notes = stripCategoryMarker(meta?.description || '');
  const title = String(meta?.title || '').trim();
  if (!notes && !title) return null;
  return { notes, title };
}

/** Q-Share shares under the name, newest first; null when the node is silent. */
async function listShares(): Promise<QdnResourceRow[] | null> {
  const rows = await listResources('DOCUMENT');
  if (!rows) return null;
  return rows
    .filter(
      (row) =>
        row.identifier.startsWith(QSHARE_PREFIX) &&
        row.identifier.endsWith(METADATA_SUFFIX)
    )
    .sort((a, b) => b.created - a.created);
}

/**
 * The build in one share: null when the share holds no .apk, 'unavailable'
 * when the node could not deliver its document this time.
 */
async function readShareRelease(
  share: QdnResourceRow
): Promise<AppRelease | null | 'unavailable'> {
  const doc = await fetchJson<QshareShareDoc>(
    `/arbitrary/DOCUMENT/${encodedName()}/${encodeURIComponent(share.identifier)}`,
    CONTENT_TIMEOUT_MS
  );
  if (!doc) return 'unavailable';
  if (!doc.files?.length) return null;

  // A share can hold several files; the newest .apk in it is the build.
  let best: {
    entry: NonNullable<QshareShareDoc['files']>[number];
    version: string;
  } | null = null;
  for (const entry of doc.files) {
    const filename = String(entry?.filename || '').trim();
    if (!filename.toLowerCase().endsWith('.apk')) continue;
    if (!entry?.identifier) continue;
    const version = versionFromFilename(filename);
    if (!version) continue;
    if (!best || compareVersions(version, best.version) > 0) {
      best = { entry, version };
    }
  }
  if (!best) return null;

  const identifier = String(best.entry.identifier);
  const service = String(best.entry.service || 'FILE');
  const notesHtml = String(doc.htmlDescription || '').trim();
  const described = notesHtml
    ? null
    : await readTransactionNotes('DOCUMENT', share.identifier);

  return {
    filename: String(best.entry.filename),
    identifier,
    notes: notesHtml
      ? ''
      : described?.notes ||
        stripCategoryMarker(doc.fullDescription || doc.description || ''),
    notesHtml,
    publishedAt: share.created,
    service,
    shareIdentifier: share.identifier,
    size: typeof best.entry.size === 'number' ? best.entry.size : 0,
    title: String(doc.title || described?.title || '').trim(),
    version: best.version,
  };
}

export type LatestBuildLookup = {
  /** False when the node could not list the name's shares at all. */
  reachable: boolean;
  release: AppRelease | null;
};

/** Newest published .apk, and whether the node could be asked at all. */
export async function lookUpLatestPublishedBuild(): Promise<LatestBuildLookup> {
  const shares = await listShares();
  if (!shares) return { reachable: false, release: null };
  for (const share of shares.slice(0, MAX_SHARES_SCANNED)) {
    const release = await readShareRelease(share);
    if (release && release !== 'unavailable') {
      return { reachable: true, release };
    }
  }
  return { reachable: true, release: null };
}

/**
 * Newest published .apk, or null when the name has never published one (or the
 * node cannot reach the data yet — a cold node is a "not now", never a "no").
 */
export async function findLatestPublishedBuild(): Promise<AppRelease | null> {
  return (await lookUpLatestPublishedBuild()).release;
}

/** Newest version first; the later publish wins between equal versions. */
export const compareReleasesNewestFirst = (
  a: AppRelease,
  b: AppRelease
): number =>
  compareVersions(b.version, a.version) || b.publishedAt - a.publishedAt;

export type PublishedBuildList = {
  reachable: boolean;
  /** One per version, newest first. */
  releases: AppRelease[];
  /** Shares whose document the node could not deliver this time. */
  missing: number;
};

/**
 * Every build the name has published, for the version history. Documents are
 * fetched a few at a time and each one is reported as it lands, so the list
 * fills in on a cold node instead of waiting for the slowest share.
 */
export async function listPublishedBuilds(
  onRelease?: (releases: AppRelease[]) => void
): Promise<PublishedBuildList> {
  const shares = await listShares();
  if (!shares) return { missing: 0, reachable: false, releases: [] };

  const byVersion = new Map<string, AppRelease>();
  let missing = 0;
  let next = 0;
  const snapshot = () =>
    Array.from(byVersion.values()).sort(compareReleasesNewestFirst);

  const worker = async () => {
    while (next < shares.length) {
      const share = shares[next];
      next += 1;
      const release = await readShareRelease(share);
      if (release === 'unavailable') {
        missing += 1;
        continue;
      }
      if (!release) continue;
      const known = byVersion.get(release.version);
      if (known && known.publishedAt >= release.publishedAt) continue;
      byVersion.set(release.version, release);
      onRelease?.(snapshot());
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(LIST_CONCURRENCY, shares.length) }, worker)
  );

  return { missing, reachable: true, releases: snapshot() };
}

/**
 * The `qortal://` path that opens a build's share page in Q-Share, where the
 * file can be saved to the phone like any other download.
 */
export function qShareSharePath(release: {
  shareIdentifier?: string;
}): string | null {
  const id = String(release?.shareIdentifier || '').trim();
  if (!id) return null;
  return `share/${encodeURIComponent(APP_UPDATE_QDN_NAME)}/${encodeURIComponent(id)}`;
}

/**
 * Ask the node to assemble the resource and report how far along it is.
 * `percentLoaded` covers fetching the chunks from peers; the bytes only reach
 * the device afterwards, over plain HTTP from the node.
 */
export async function requestResourceBuild(
  service: string,
  identifier: string
): Promise<void> {
  await fetchJson(
    `/arbitrary/${service}/${encodedName()}/${encodeURIComponent(identifier)}?async=true`,
    LIST_TIMEOUT_MS
  );
}

export type ResourceProgress = {
  percentLoaded: number;
  status: string;
};

export async function readResourceStatus(
  service: string,
  identifier: string,
  options?: { build?: boolean }
): Promise<ResourceProgress | null> {
  const status = await fetchJson<{
    percentLoaded?: number;
    status?: string;
  }>(
    `/arbitrary/resource/status/${service}/${encodedName()}/${encodeURIComponent(
      identifier
    )}${options?.build ? '?build=true' : ''}`,
    LIST_TIMEOUT_MS
  );
  if (!status?.status) return null;
  return {
    percentLoaded:
      typeof status.percentLoaded === 'number' ? status.percentLoaded : 0,
    status: status.status,
  };
}

/**
 * Where the native downloader streams the finished file from. The node API
 * key is returned on its own, for the plugin to send as an X-API-KEY header,
 * so it never sits in a URL that can reach logs or error text.
 */
export async function buildDownloadRequest(
  service: string,
  identifier: string,
  filename: string
): Promise<NativeNodeRequest> {
  return createNativeNodeRequest(
    `/arbitrary/${encodeURIComponent(service)}/${encodedName()}/${encodeURIComponent(
      identifier
    )}?attachment=true&attachmentFilename=${encodeURIComponent(filename)}`
  );
}
