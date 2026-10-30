import { createEndpoint, getApiKeyFromStorage } from '../background/background.ts';
import { isCapacitor } from './platform';
import { qdnResourcePath } from './qdnPath';

/**
 * A QDN download happens in two stages, and only the second one looks like a
 * download: first the node collects the file's chunks from peers, then the
 * file is handed over to the app. The first stage is the slow one for anything
 * large, and it is the one that makes a download look frozen — hence this,
 * which watches it so the wait can be shown.
 */

type QdnGatherProgress = {
  /** SEARCHING, DOWNLOADING, BUILDING, READY … as reported by the node. */
  status: string;
  /** 0-100, or -1 while the node has not said anything useful yet. */
  percent: number;
  localChunkCount: number;
  totalChunkCount: number;
};

type QdnResourceLocation = {
  service: string;
  name: string;
  identifier?: string;
};

const POLL_INTERVAL_MS = 1500;
/**
 * Past this the wait is reported as over and the caller downloads anyway: the
 * plain endpoint blocks until the node is ready, so a slow gather still
 * finishes, just without a percentage.
 */
const MAX_WAIT_MS = 15 * 60 * 1000;
const MAX_CONSECUTIVE_ERRORS = 5;

const resourcePath = (location: QdnResourceLocation) =>
  qdnResourcePath(location);

const nativeApiKey = async (): Promise<string | undefined> => {
  try {
    const stored = await getApiKeyFromStorage();
    const key =
      stored && typeof stored === 'object'
        ? String((stored as { apikey?: string }).apikey || '').trim()
        : '';
    return key || undefined;
  } catch {
    return undefined;
  }
};

/** Kick the node to start gathering even when WebView CORS blocks fetch. */
const kickResourceFetch = async (endpoint: string): Promise<void> => {
  const fetchKick = fetch(endpoint).catch(() => null);
  if (isCapacitor()) {
    try {
      const { probeNativeUrl } = await import('../plugins/FileWriter');
      await probeNativeUrl(endpoint, await nativeApiKey());
    } catch {
      /* fetch below is the fallback */
    }
  }
  await fetchKick;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readStatus = async (
  location: QdnResourceLocation,
  build = false
): Promise<Record<string, any> | null> => {
  const endpoint = await createEndpoint(
    `/arbitrary/resource/status/${resourcePath(location)}${build ? '?build=true' : ''}`
  );
  const response = await fetch(endpoint);
  if (!response.ok) return null;
  return await response.json();
};

const toProgress = (status: Record<string, any> | null): QdnGatherProgress => ({
  status: String(status?.status || 'SEARCHING'),
  percent:
    typeof status?.percentLoaded === 'number'
      ? Math.max(0, Math.min(100, status.percentLoaded))
      : -1,
  localChunkCount: Number(status?.localChunkCount) || 0,
  totalChunkCount: Number(status?.totalChunkCount) || 0,
});

/**
 * Waits for the node to have the whole resource, reporting how far along it is.
 *
 * Returns once the resource is ready, or gives up quietly — a caller should
 * always go on to download either way, since giving up here only means the
 * progress is unknown, not that the file is unavailable.
 */
export async function waitForQdnResource(
  location: QdnResourceLocation,
  onProgress?: (progress: QdnGatherProgress) => void,
  isCancelled?: () => boolean
): Promise<boolean> {
  const deadline = Date.now() + MAX_WAIT_MS;
  let errors = 0;
  let askedToBuild = false;
  let requestedFetch = false;

  while (Date.now() < deadline) {
    if (isCancelled?.()) return false;

    let status: Record<string, any> | null = null;
    try {
      status = await readStatus(location);
      errors = 0;
    } catch {
      if (++errors >= MAX_CONSECUTIVE_ERRORS) return false;
    }

    const state = String(status?.status || '');
    if (state === 'READY') return true;

    if (status) onProgress?.(toProgress(status));

    // Asking for the resource is what makes the node go and find it; without
    // this the status would sit at SEARCHING forever. `async` returns straight
    // away instead of blocking until every chunk has arrived.
    if (!requestedFetch) {
      requestedFetch = true;
      void createEndpoint(`/arbitrary/${resourcePath(location)}?async=true`)
        .then((endpoint) => kickResourceFetch(endpoint))
        .catch(() => {
          /* the poll below is what decides whether this worked */
        });
    }

    // All chunks are here but the node has not assembled them yet.
    if (state === 'DOWNLOADED' && !askedToBuild) {
      askedToBuild = true;
      try {
        const built = await readStatus(location, true);
        if (String(built?.status || '') === 'READY') return true;
        if (built) onProgress?.(toProgress(built));
      } catch {
        /* fall through to the next poll */
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return false;
}
