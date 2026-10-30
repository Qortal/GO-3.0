/**
 * QDN avatar cache: keeps avatars of users, Q-Apps, websites and groups on the
 * device so lists do not fall back to letters when the node is slow.
 *
 * - Storage: IndexedDB (`go-qdn-avatars`) with an in-memory fallback (also
 *   when IndexedDB does not answer within `initTimeoutMs`). Images are shrunk
 *   to fit 128x128. Renders read synchronously from an in-memory map of
 *   object URLs; nothing blocks first paint. Init loads the most used images
 *   (and the ones already asked for) in one read, so they show at once.
 * - Fetching: `?async=true` first (short timeout). When the node does not have
 *   the file yet, the resource status endpoint tells "never published" apart
 *   from "still fetching"; only the latter queues a blocking request (long
 *   timeout). At most `maxConcurrent` requests run at once (`maxBlocking` of
 *   them blocking), one per key, with backoff per key after failures. An
 *   overloaded node (429/5xx) or a non-image answer only backs off.
 * - Order: higher priority first; avatars on screen before others; among
 *   those the latest batch of requests first (rows that just came on screen)
 *   and, within one batch (one render), the order they were asked for (top
 *   rows of a list first). Off-screen work: newest first.
 * - Freshness: a cached image shows at once and is refreshed in the
 *   background after `staleAfterMs` (a failed refresh tries again after
 *   `staleRetryMs`, without the backoff ladder); a confirmed missing avatar is
 *   re-checked after `missingRecheckMs`, or at once on another node. Both
 *   periods are stretched per avatar by up to `refreshSpread`, so avatars
 *   fetched together (the login prewarm) are not all re-checked together.
 * - refresh() and putImage() win over fetches already queued or running:
 *   those results are discarded (per-key epoch).
 * - Size: about `maxImages` images / `maxImageBytes`; the lowest score (use
 *   count decayed by time since last use) is evicted first. Avatars on screen
 *   are never evicted.
 *
 * Object URLs (`src`) belong to this document: never pass them to Q-App
 * iframes, native notifications, IPC or share sheets (use getDataUrl). React
 * callers must not keep a src after the hook gives a new one (it is revoked
 * shortly after); non-React callers use retainUrl() (index.ts does).
 *
 * Nothing in here throws into callers: every public method catches.
 */
import {
  buildQdnAvatarStatusUrl,
  buildQdnAvatarUrl,
  cleanQdnName,
  parseQdnAvatarKey,
  qdnAvatarKey,
  type QdnAvatarKey,
  type QdnAvatarRef,
} from './keys';
import {
  bytesToDataUrl,
  dataUrlToBytes,
  downscaleAvatarImage,
  toArrayBuffer,
  QDN_AVATAR_MAX_DOWNLOAD_BYTES,
  sniffImageType,
  type AvatarImageBytes,
} from './imageBytes';
import {
  fetchAvatarAttempt,
  fetchAvatarPublishStatus,
  type FetchLike,
} from './avatarFetch';
import {
  createMemoryAvatarStore,
  openQdnAvatarStore,
  type QdnAvatarMeta,
  type QdnAvatarStore,
  type QdnAvatarStoredImage,
} from './avatarStore';

export type QdnAvatarStatus =
  /** No name, or the hook is disabled. */
  | 'idle'
  /** No cached image yet; a fetch is queued or running. */
  | 'loading'
  /** `src` is a cached image from the node. */
  | 'ready'
  /** The node confirmed this name has no avatar. */
  | 'missing'
  /** The last fetch failed; it is retried later (backoff). */
  | 'failed';

export type QdnAvatarSource = 'cache' | 'seed' | null;

export type QdnAvatarSnapshot = {
  /**
   * Cached object URL, bundled seed URL, or undefined (use your fallback).
   * Object URLs only work in this document and must not be stored.
   */
  readonly src: string | undefined;
  readonly status: QdnAvatarStatus;
  readonly source: QdnAvatarSource;
};

export type QdnAvatarPriority = 'high' | 'normal' | 'low';

type QdnAvatarRequest = {
  /** Name as the caller spells it; used in node URLs. */
  name?: string | null;
  identifier?: string | null;
  priority?: QdnAvatarPriority;
};

export type QdnAvatarLimits = {
  maxConcurrent: number;
  maxBlocking: number;
  /** Queued fetches kept at most (the oldest unwatched ones are dropped). */
  maxQueue: number;
  asyncTimeoutMs: number;
  statusTimeoutMs: number;
  blockingTimeoutMs: number;
  maxDownloadBytes: number;
  staleAfterMs: number;
  /** A failed refresh of a cached image is tried again after this. */
  staleRetryMs: number;
  /** After refresh()/putImage() the node copy is checked again after this. */
  publishRecheckMs: number;
  missingRecheckMs: number;
  /**
   * `staleAfterMs` and `missingRecheckMs` are stretched by up to this
   * fraction, a fixed amount per avatar key (0 = no spread).
   */
  refreshSpread: number;
  backoffMs: number[];
  maxImages: number;
  maxImageBytes: number;
  maxMissing: number;
  useThrottleMs: number;
  useHalfLifeMs: number;
  persistDelayMs: number;
  evictDelayMs: number;
  revokeDelayMs: number;
  /** Opening storage and reading its records; memory only after that. */
  initTimeoutMs: number;
  /** Reading stored image bytes. */
  imageLoadTimeoutMs: number;
  /** First retry delay after reading stored bytes failed (then doubled). */
  imageLoadRetryMs: number;
  /** Most used images loaded together with the records at start. */
  preloadCount: number;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A fixed value in [0, 1) per key (FNV-1a), for spreading re-checks. */
export const qdnAvatarRefreshSpread = (key: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x100000000;
};

const DEFAULT_QDN_AVATAR_LIMITS: QdnAvatarLimits = {
  maxConcurrent: 3,
  maxBlocking: 2,
  maxQueue: 300,
  asyncTimeoutMs: 6_000,
  statusTimeoutMs: 6_000,
  blockingTimeoutMs: 25_000,
  maxDownloadBytes: QDN_AVATAR_MAX_DOWNLOAD_BYTES,
  staleAfterMs: 24 * HOUR,
  staleRetryMs: HOUR,
  publishRecheckMs: 10 * MINUTE,
  missingRecheckMs: 6 * HOUR,
  // 24 h becomes 24-30 h, 6 h becomes 6-7.5 h.
  refreshSpread: 0.25,
  backoffMs: [30_000, 2 * MINUTE, 10 * MINUTE, HOUR],
  maxImages: 500,
  maxImageBytes: 20 * 1024 * 1024,
  maxMissing: 500,
  useThrottleMs: 30 * MINUTE,
  useHalfLifeMs: 7 * 24 * HOUR,
  persistDelayMs: 4_000,
  evictDelayMs: 2_000,
  revokeDelayMs: 30_000,
  initTimeoutMs: 3_000,
  imageLoadTimeoutMs: 5_000,
  imageLoadRetryMs: 5_000,
  preloadCount: 60,
};

type TimerHandle = unknown;

export type QdnAvatarCacheDeps = {
  /** Node base URL, read at fetch time (the user may switch nodes). */
  getApiBase: () => string;
  fetch?: FetchLike;
  openStore?: () => Promise<QdnAvatarStore>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  /** Return null when object URLs are unavailable (a data URL is used). */
  createObjectUrl?: (blob: Blob) => string | null;
  revokeObjectUrl?: (url: string) => void;
  /** Shrinks an image; null = undecodable (treated like "no avatar"). */
  downscale?: (image: AvatarImageBytes) => Promise<AvatarImageBytes | null>;
  seedUrlFor?: (key: QdnAvatarKey) => string | undefined;
  limits?: Partial<QdnAvatarLimits>;
};

export type QdnAvatarPrewarmEntry =
  | string
  | { name: string; identifier?: string | null };

export type QdnAvatarPrewarmResult = {
  fetched: number;
  failed: number;
  skipped: number;
  /** True when prewarming gave up after repeated failures. */
  stopped: boolean;
};

export type QdnAvatarCache = ReturnType<typeof createQdnAvatarCache>;

const PRIORITY_RANK: Record<QdnAvatarPriority | 'prewarm', number> = {
  high: 3,
  normal: 2,
  low: 1,
  prewarm: 0,
};

type Job = {
  key: QdnAvatarKey;
  rank: number;
  /** Bumped on every request for the key (newest first, for unwatched). */
  seq: number;
  /** Request batch of the latest request (one render commit, one tick). */
  batch: number;
  /** Set once when first queued (order within a batch, for watched). */
  order: number;
  stage: 'async' | 'blocking';
  prewarm: boolean;
  generation: number;
  /** Key epoch when the job started; older results are discarded. */
  epoch: number;
};

type Usage = { useCount: number; lastUsedAt: number };

type SaveResult = 'saved' | 'undecodable' | 'stale';

/** Failed reads of stored bytes before the node copy is fetched instead. */
const MAX_IMAGE_LOAD_RETRIES = 2;

const TIMED_OUT: unique symbol = Symbol('timed out');

const IDLE_SNAPSHOT: QdnAvatarSnapshot = Object.freeze({
  src: undefined,
  status: 'idle',
  source: null,
});

function defaultCreateObjectUrl(blob: Blob): string | null {
  try {
    if (
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      return URL.createObjectURL(blob);
    }
  } catch {
    // fall back to a data URL
  }
  return null;
}

function defaultRevokeObjectUrl(url: string): void {
  try {
    if (
      typeof URL !== 'undefined' &&
      typeof URL.revokeObjectURL === 'function'
    ) {
      URL.revokeObjectURL(url);
    }
  } catch {
    // ignore
  }
}

/** 90% of a limit (the limit itself for small limits). */
const belowLimit = (limit: number) =>
  Math.max(0, limit - Math.floor(limit * 0.1));

/** Short, non-reversible tag of a node URL (FNV-1a), stored with "missing". */
function qdnAvatarNodeTag(apiBase: string): string {
  const text = (apiBase || '').trim().replace(/\/+$/, '').toLowerCase();
  if (!text) return '';
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** 429 and 5xx: the node is overloaded or broken; asking more does not help. */
const isOverloadStatus = (status: number | undefined) =>
  status === 429 || (typeof status === 'number' && status >= 500);

function isValidMeta(row: unknown): row is QdnAvatarMeta {
  const meta = row as QdnAvatarMeta;
  return (
    !!meta &&
    typeof meta.key === 'string' &&
    !!parseQdnAvatarKey(meta.key) &&
    typeof meta.fetchedAt === 'number' &&
    typeof meta.size === 'number'
  );
}

export function createQdnAvatarCache(deps: QdnAvatarCacheDeps) {
  const limits: QdnAvatarLimits = {
    ...DEFAULT_QDN_AVATAR_LIMITS,
    ...(deps.limits ?? {}),
  };
  const fetchImpl: FetchLike =
    deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const openStore = deps.openStore ?? (() => openQdnAvatarStore());
  const now = deps.now ?? (() => Date.now());
  const setTimer =
    deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ??
    ((handle: TimerHandle) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>));
  const createObjectUrl = deps.createObjectUrl ?? defaultCreateObjectUrl;
  const revokeObjectUrl = deps.revokeObjectUrl ?? defaultRevokeObjectUrl;
  const downscale = deps.downscale ?? ((image) => downscaleAvatarImage(image));
  const seedUrlFor = deps.seedUrlFor ?? (() => undefined);
  const fetchTimers = { setTimer, clearTimer };

  let store: QdnAvatarStore | null = null;
  /** Storage was too slow at start: its old data may still be on disk. */
  let storeSkipped = false;
  let initPromise: Promise<void> | null = null;
  let ready = false;
  let generation = 0;
  let seq = 0;
  let batch = 0;
  let batchOpen = false;

  const metas = new Map<QdnAvatarKey, QdnAvatarMeta>();
  const urls = new Map<QdnAvatarKey, string>();
  const snapshots = new Map<QdnAvatarKey, QdnAvatarSnapshot>();
  const listeners = new Map<QdnAvatarKey, Set<() => void>>();
  const names = new Map<QdnAvatarKey, string>();
  const failures = new Map<QdnAvatarKey, { count: number; nextAt: number }>();
  const retryTimers = new Map<QdnAvatarKey, TimerHandle>();
  const usage = new Map<QdnAvatarKey, Usage>();
  const lastUseNoted = new Map<QdnAvatarKey, number>();
  const dirty = new Set<QdnAvatarKey>();
  const waiters = new Map<QdnAvatarKey, Set<() => void>>();
  const pendingRequests = new Map<QdnAvatarKey, number>();
  const pendingRefreshes = new Set<QdnAvatarKey>();
  const pendingImageLoads = new Set<QdnAvatarKey>();
  const loadingImages = new Set<QdnAvatarKey>();
  const imageLoadFailures = new Map<QdnAvatarKey, number>();
  const imageLoadTimers = new Map<QdnAvatarKey, TimerHandle>();
  const revokeTimers = new Set<TimerHandle>();
  /** Per-key epoch, bumped by refresh()/putImage(): older results lose. */
  const epochs = new Map<QdnAvatarKey, number>();
  /** Keys refreshed while their fetch was running: fetch again after it. */
  const rerun = new Set<QdnAvatarKey>();
  /** Keys whose next answer comes from refresh(): re-checked soon. */
  const shortFresh = new Set<QdnAvatarKey>();
  /** "Missing" kept in memory only (undecodable image), never stored. */
  const volatileMissing = new Set<QdnAvatarKey>();
  /** Object URLs handed to non-React code: revoked only by clear(). */
  const retainedUrls = new Set<string>();

  let queue: Job[] = [];
  const activeKeys = new Map<QdnAvatarKey, Job>();
  let activeCount = 0;
  let activeBlocking = 0;

  let persistTimer: TimerHandle | null = null;
  let evictTimer: TimerHandle | null = null;
  let imageLoadScheduled = false;

  let nodeBase: string | null = null;
  let nodeTag = '';

  // ---------------------------------------------------------------- helpers

  /**
   * Resolves with the promise's value, or TIMED_OUT after `ms`. A value that
   * arrives later goes to `onLate` (e.g. to close a late database handle).
   */
  const withTimeout = <T>(
    promise: Promise<T>,
    ms: number,
    onLate?: (value: T) => void
  ): Promise<T | typeof TIMED_OUT> =>
    new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimer(() => {
        if (done) return;
        done = true;
        resolve(TIMED_OUT);
      }, ms);
      promise.then(
        (value) => {
          if (done) {
            try {
              onLate?.(value);
            } catch {
              // ignore
            }
            return;
          }
          done = true;
          clearTimer(timer);
          resolve(value);
        },
        (error) => {
          if (done) return;
          done = true;
          clearTimer(timer);
          reject(error);
        }
      );
    });

  const readApiBase = (): string => {
    try {
      return deps.getApiBase() || '';
    } catch {
      return '';
    }
  };

  /**
   * Tag of the node in use. After a switch to another node, failures and
   * backoff from the old node are forgotten.
   */
  const currentNode = (): string => {
    const base = readApiBase();
    if (!base || base === nodeBase) return nodeTag;
    if (nodeBase !== null) failures.clear();
    nodeBase = base;
    nodeTag = qdnAvatarNodeTag(base);
    return nodeTag;
  };

  const epochOf = (key: QdnAvatarKey) => epochs.get(key) ?? 0;

  const bumpEpoch = (key: QdnAvatarKey) => {
    epochs.set(key, epochOf(key) + 1);
  };

  const refFor = (key: QdnAvatarKey): QdnAvatarRef | null => {
    const parsed = parseQdnAvatarKey(key);
    if (!parsed) return null;
    // Names are case-insensitive on the node; prefer the caller's spelling.
    const name = names.get(key) || parsed.name;
    return { name, identifier: parsed.identifier };
  };

  const hasListeners = (key: QdnAvatarKey) =>
    (listeners.get(key)?.size ?? 0) > 0;

  const isQueued = (key: QdnAvatarKey) => queue.some((job) => job.key === key);

  const isBusy = (key: QdnAvatarKey) => activeKeys.has(key) || isQueued(key);

  const hasImage = (meta: QdnAvatarMeta | undefined) =>
    !!meta && meta.size > 0 && !meta.missing;

  const inBackoff = (key: QdnAvatarKey) => {
    const failure = failures.get(key);
    return !!failure && failure.nextAt > now();
  };

  const spreadPeriod = (key: QdnAvatarKey, period: number) =>
    Math.round(
      period * (1 + limits.refreshSpread * qdnAvatarRefreshSpread(key))
    );
  const staleAfterFor = (key: QdnAvatarKey) =>
    spreadPeriod(key, limits.staleAfterMs);
  const missingRecheckFor = (key: QdnAvatarKey) =>
    spreadPeriod(key, limits.missingRecheckMs);

  const missingIsFresh = (meta: QdnAvatarMeta | undefined) => {
    if (!meta?.missing) return false;
    // Another node may be better synced: ask it.
    if (meta.missingNode && meta.missingNode !== currentNode()) return false;
    return (
      now() - (meta.missingCheckedAt ?? meta.fetchedAt ?? 0) <
      missingRecheckFor(meta.key)
    );
  };

  const scoreOf = (meta: QdnAvatarMeta) => {
    const age = Math.max(0, now() - (meta.lastUsedAt || 0));
    return (
      ((meta.useCount || 0) + 1) * Math.pow(0.5, age / limits.useHalfLifeMs)
    );
  };

  const buildSnapshot = (key: QdnAvatarKey): QdnAvatarSnapshot => {
    const url = urls.get(key);
    if (url) return { src: url, status: 'ready', source: 'cache' };
    const seed = seedUrlFor(key);
    const meta = metas.get(key);
    let status: QdnAvatarStatus = 'loading';
    if (ready) {
      if (meta?.missing) status = 'missing';
      else if (!hasImage(meta) && failures.has(key) && !isBusy(key)) {
        status = 'failed';
      }
    }
    return { src: seed, status, source: seed ? 'seed' : null };
  };

  const sameSnapshot = (a: QdnAvatarSnapshot, b: QdnAvatarSnapshot) =>
    a.src === b.src && a.status === b.status && a.source === b.source;

  const emit = (key: QdnAvatarKey) => {
    const previous = snapshots.get(key);
    const next = buildSnapshot(key);
    if (previous && sameSnapshot(previous, next)) return;
    if (!previous && !hasListeners(key)) return;
    snapshots.set(key, next);
    const set = listeners.get(key);
    if (!set) return;
    for (const listener of Array.from(set)) {
      try {
        listener();
      } catch {
        // a broken subscriber must not stop the others
      }
    }
  };

  const emitAll = () => {
    for (const key of Array.from(snapshots.keys())) emit(key);
    for (const key of Array.from(listeners.keys())) emit(key);
  };

  const settle = (key: QdnAvatarKey) => {
    const set = waiters.get(key);
    if (!set) return;
    waiters.delete(key);
    for (const resolve of set) resolve();
  };

  const whenSettled = (key: QdnAvatarKey, timeoutMs: number) =>
    new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimer(timer);
        waiters.get(key)?.delete(finish);
        resolve();
      };
      const timer = setTimer(finish, timeoutMs);
      let set = waiters.get(key);
      if (!set) {
        set = new Set();
        waiters.set(key, set);
      }
      set.add(finish);
    });

  const makeUrl = (image: AvatarImageBytes): string => {
    let url: string | null = null;
    try {
      url = createObjectUrl(new Blob([image.bytes], { type: image.type }));
    } catch {
      url = null;
    }
    return url || bytesToDataUrl(image.bytes, image.type);
  };

  const releaseUrl = (url: string | undefined, immediately = false) => {
    if (!url || !url.startsWith('blob:')) return;
    if (immediately) {
      retainedUrls.delete(url);
      revokeObjectUrl(url);
      return;
    }
    // Non-React code may still hold it: it lives until clear().
    if (retainedUrls.has(url)) return;
    // An <img> may still be switching away from it; revoke a little later.
    const handle = setTimer(() => {
      revokeTimers.delete(handle);
      if (!retainedUrls.has(url)) revokeObjectUrl(url);
    }, limits.revokeDelayMs);
    revokeTimers.add(handle);
  };

  const setUrl = (key: QdnAvatarKey, url: string | undefined) => {
    const previous = urls.get(key);
    if (url) urls.set(key, url);
    else urls.delete(key);
    if (previous && previous !== url) releaseUrl(previous);
  };

  const safeStore = (action: (s: QdnAvatarStore) => Promise<unknown>) => {
    if (!store) return;
    const current = store;
    try {
      void action(current).catch(() => {
        // storage is best effort; the in-memory copy still works
      });
    } catch {
      // a store method that throws synchronously
    }
  };

  // ---------------------------------------------------------------- persist

  const schedulePersist = () => {
    if (persistTimer != null) return;
    persistTimer = setTimer(() => {
      persistTimer = null;
      const list: QdnAvatarMeta[] = [];
      for (const key of dirty) {
        const meta = metas.get(key);
        // Memory-only "missing" records never reach storage.
        if (meta && !volatileMissing.has(key)) list.push({ ...meta });
      }
      dirty.clear();
      if (list.length) safeStore((s) => s.putMetas(list));
    }, limits.persistDelayMs);
  };

  const scheduleEvict = () => {
    if (evictTimer != null) return;
    evictTimer = setTimer(() => {
      evictTimer = null;
      evictNow();
    }, limits.evictDelayMs);
  };

  const evictNow = () => {
    try {
      const protectedKey = (key: QdnAvatarKey) =>
        hasListeners(key) || activeKeys.has(key);
      const removed: QdnAvatarKey[] = [];

      const images = Array.from(metas.values()).filter(hasImage);
      let count = images.length;
      let bytes = images.reduce((sum, meta) => sum + (meta.size || 0), 0);
      if (count > limits.maxImages || bytes > limits.maxImageBytes) {
        // Evict a little below the limit so it does not run on every fetch.
        const targetCount = belowLimit(limits.maxImages);
        const targetBytes = belowLimit(limits.maxImageBytes);
        const candidates = images
          .filter((meta) => !protectedKey(meta.key))
          .sort((a, b) => scoreOf(a) - scoreOf(b));
        for (const meta of candidates) {
          if (count <= targetCount && bytes <= targetBytes) break;
          removed.push(meta.key);
          count -= 1;
          bytes -= meta.size || 0;
        }
      }

      const missing = Array.from(metas.values()).filter((m) => m.missing);
      if (missing.length > limits.maxMissing) {
        const target = belowLimit(limits.maxMissing);
        const candidates = missing
          .filter((meta) => !protectedKey(meta.key))
          .sort(
            (a, b) =>
              (a.missingCheckedAt ?? a.fetchedAt) -
              (b.missingCheckedAt ?? b.fetchedAt)
          );
        let left = missing.length;
        for (const meta of candidates) {
          if (left <= target) break;
          removed.push(meta.key);
          left -= 1;
        }
      }

      if (!removed.length) return;
      for (const key of removed) {
        metas.delete(key);
        dirty.delete(key);
        volatileMissing.delete(key);
        snapshots.delete(key);
        const url = urls.get(key);
        urls.delete(key);
        releaseUrl(url);
      }
      safeStore((s) => s.deleteEntries(removed));
    } catch {
      // eviction is best effort
    }
  };

  // ------------------------------------------------------------- image load

  const clearImageLoadTimer = (key: QdnAvatarKey) => {
    const handle = imageLoadTimers.get(key);
    if (handle != null) clearTimer(handle);
    imageLoadTimers.delete(key);
  };

  /**
   * Reading stored bytes failed (storage error or timeout), which says
   * nothing about the record: keep it, read again a little later, and after
   * a few failures show the node's copy instead.
   */
  const imageLoadFailed = (key: QdnAvatarKey) => {
    const count = (imageLoadFailures.get(key) ?? 0) + 1;
    imageLoadFailures.set(key, count);
    if (count > MAX_IMAGE_LOAD_RETRIES) {
      if (!isBusy(key) && !inBackoff(key)) enqueue(key, PRIORITY_RANK.normal);
      return;
    }
    if (!hasListeners(key) || imageLoadTimers.has(key)) return;
    const handle = setTimer(
      () => {
        imageLoadTimers.delete(key);
        if (hasListeners(key) && !urls.has(key)) scheduleImageLoad(key);
      },
      limits.imageLoadRetryMs * 2 ** (count - 1)
    );
    imageLoadTimers.set(key, handle);
  };

  /**
   * Turns stored bytes for `keys` into object URLs (one storage read).
   * `quiet`: a failed read is not retried (start-up preload).
   */
  const loadStoredImages = async (
    keys: QdnAvatarKey[],
    options: { quiet?: boolean; timeoutMs?: number } = {}
  ) => {
    const current = store;
    if (!keys.length || !current) return;
    const loadGeneration = generation;
    keys.forEach((key) => loadingImages.add(key));
    let found: Map<QdnAvatarKey, QdnAvatarStoredImage> | null = null;
    try {
      const result = await withTimeout(
        current.loadImages(keys),
        options.timeoutMs ?? limits.imageLoadTimeoutMs
      );
      found = result === TIMED_OUT || !(result instanceof Map) ? null : result;
    } catch {
      found = null;
    }
    keys.forEach((key) => loadingImages.delete(key));
    if (loadGeneration !== generation) return;
    for (const key of keys) {
      if (urls.has(key)) continue;
      const meta = metas.get(key);
      if (!hasImage(meta)) continue;
      if (!found) {
        if (!options.quiet) imageLoadFailed(key);
        continue;
      }
      const image = found.get(key);
      if (image) {
        imageLoadFailures.delete(key);
        clearImageLoadTimer(key);
        setUrl(key, makeUrl({ bytes: image.bytes, type: image.type }));
        emit(key);
      } else if (!options.quiet) {
        // Storage answered without the bytes (cleared under us): fetch again.
        metas.set(key, { ...meta, size: 0, fetchedAt: 0 });
        decide(key, PRIORITY_RANK.normal, false);
      }
    }
  };

  const flushImageLoads = async () => {
    imageLoadScheduled = false;
    const keys = Array.from(pendingImageLoads).filter(
      (key) => !urls.has(key) && !loadingImages.has(key)
    );
    pendingImageLoads.clear();
    await loadStoredImages(keys);
  };

  const scheduleImageLoad = (key: QdnAvatarKey) => {
    if (urls.has(key) || loadingImages.has(key)) return;
    pendingImageLoads.add(key);
    if (imageLoadScheduled) return;
    imageLoadScheduled = true;
    // Batch every avatar a render pass asks for into one IDB transaction.
    void Promise.resolve()
      .then(flushImageLoads)
      .catch(() => {
        imageLoadScheduled = false;
      });
  };

  // ------------------------------------------------------------------ queue

  const pickJob = (): Job | null => {
    let best: Job | null = null;
    let bestRank = -Infinity;
    let bestWatched = false;
    for (const job of queue) {
      if (job.stage === 'blocking' && activeBlocking >= limits.maxBlocking) {
        continue;
      }
      // A background prewarm waits for a free node: it never takes a
      // blocking slot while another blocking request runs.
      if (job.prewarm && job.stage === 'blocking' && activeBlocking > 0) {
        continue;
      }
      const watched = hasListeners(job.key);
      // Work nobody shows any more drops one level (prewarm is already last).
      const rank = job.prewarm || watched ? job.rank : job.rank - 1;
      let better = !best || rank > bestRank;
      if (best && rank === bestRank) {
        if (watched !== bestWatched) better = watched;
        // On screen: the latest batch first (rows that just came on screen,
        // new messages), and within one batch (one render, one observer
        // callback) the order they were first asked for: top rows first.
        else if (watched) {
          better =
            job.batch > best.batch ||
            (job.batch === best.batch && job.order < best.order);
        }
        // Not on screen: newest first.
        else better = job.seq > best.seq;
      }
      if (better) {
        best = job;
        bestRank = rank;
        bestWatched = watched;
      }
    }
    return best;
  };

  const pump = () => {
    while (activeCount < limits.maxConcurrent) {
      const job = pickJob();
      if (!job) return;
      queue = queue.filter((item) => item !== job);
      job.epoch = epochOf(job.key);
      activeKeys.set(job.key, job);
      activeCount += 1;
      if (job.stage === 'blocking') activeBlocking += 1;
      void runJob(job);
    }
  };

  /** Requests made in the same synchronous turn share a batch number. */
  const currentBatch = () => {
    if (!batchOpen) {
      batchOpen = true;
      batch += 1;
      void Promise.resolve().then(() => {
        batchOpen = false;
      });
    }
    return batch;
  };

  const enqueue = (
    key: QdnAvatarKey,
    rank: number,
    options: { prewarm?: boolean; stage?: 'async' | 'blocking' } = {}
  ) => {
    if (activeKeys.has(key)) return;
    const existing = queue.find((job) => job.key === key);
    seq += 1;
    if (existing) {
      if (rank > existing.rank) existing.rank = rank;
      if (!options.prewarm) existing.prewarm = false;
      existing.seq = seq;
      existing.batch = currentBatch();
    } else {
      if (queue.length >= limits.maxQueue) {
        // Long lists scrolled past: drop the oldest work nobody waits for.
        const drop = queue
          .filter((job) => !hasListeners(job.key) && !waiters.has(job.key))
          .sort((a, b) => a.seq - b.seq)
          .slice(0, queue.length - limits.maxQueue + 1);
        if (drop.length) {
          const dropped = new Set(drop);
          queue = queue.filter((job) => !dropped.has(job));
        }
      }
      queue.push({
        key,
        rank,
        seq,
        batch: currentBatch(),
        order: seq,
        stage: options.stage ?? 'async',
        prewarm: !!options.prewarm,
        generation,
        epoch: epochOf(key),
      });
    }
    emit(key);
    pump();
  };

  const scheduleRetry = (key: QdnAvatarKey, delay: number) => {
    const existing = retryTimers.get(key);
    if (existing != null) clearTimer(existing);
    const handle = setTimer(
      () => {
        retryTimers.delete(key);
        if (hasListeners(key)) decide(key, PRIORITY_RANK.normal, false);
      },
      Math.max(0, delay)
    );
    retryTimers.set(key, handle);
  };

  const clearRetry = (key: QdnAvatarKey) => {
    const handle = retryTimers.get(key);
    if (handle != null) clearTimer(handle);
    retryTimers.delete(key);
  };

  /** Decides whether `key` needs network work and queues it. */
  const decide = (
    key: QdnAvatarKey,
    rank: number,
    prewarm: boolean
  ): boolean => {
    currentNode();
    const meta = metas.get(key);
    if (hasImage(meta)) {
      // A prewarm only checks freshness: nothing shows the image yet.
      if (!urls.has(key) && (!prewarm || hasListeners(key))) {
        scheduleImageLoad(key);
      }
      const stale = now() - (meta.fetchedAt || 0) > staleAfterFor(key);
      if (!stale || isBusy(key)) return isBusy(key);
      if (inBackoff(key)) return false;
      // Stale-while-revalidate: keep showing it, refresh quietly.
      enqueue(key, prewarm ? PRIORITY_RANK.prewarm : PRIORITY_RANK.low, {
        prewarm,
      });
      return true;
    }
    if (missingIsFresh(meta)) return false;
    if (isBusy(key)) {
      if (!prewarm) enqueue(key, rank);
      return true;
    }
    if (inBackoff(key)) {
      const failure = failures.get(key);
      if (failure && hasListeners(key) && !retryTimers.has(key)) {
        scheduleRetry(key, failure.nextAt - now());
      }
      return false;
    }
    enqueue(key, rank, { prewarm });
    return true;
  };

  // ---------------------------------------------------------------- results

  const takeUsage = (key: QdnAvatarKey, previous?: QdnAvatarMeta): Usage => {
    const pending = usage.get(key);
    usage.delete(key);
    const base: Usage = previous
      ? { useCount: previous.useCount || 0, lastUsedAt: previous.lastUsedAt }
      : { useCount: 0, lastUsedAt: now() };
    if (!pending) return base;
    return {
      useCount: base.useCount + pending.useCount,
      lastUsedAt: Math.max(base.lastUsedAt || 0, pending.lastUsedAt),
    };
  };

  /**
   * When the answer was checked: now, or a time that makes it due again soon
   * when it answers a refresh() (the node may still serve the old file).
   */
  const checkedAt = (key: QdnAvatarKey, freshFor: number): number => {
    const t = now();
    if (!shortFresh.delete(key)) return t;
    return t - freshFor + Math.min(limits.publishRecheckMs, freshFor);
  };

  const saveImage = async (
    key: QdnAvatarKey,
    image: AvatarImageBytes,
    owner: { generation: number; epoch: number },
    options: { fetchedAt?: number } = {}
  ): Promise<SaveResult> => {
    let scaled: AvatarImageBytes | null = image;
    try {
      scaled = await downscale(image);
    } catch {
      scaled = image;
    }
    // refresh(), putImage() or clear() came after this fetch started.
    if (owner.generation !== generation || owner.epoch !== epochOf(key)) {
      return 'stale';
    }
    if (!scaled?.bytes?.byteLength) return 'undecodable';
    const previous = metas.get(key);
    const counters = takeUsage(key, previous);
    const meta: QdnAvatarMeta = {
      key,
      size: scaled.bytes.byteLength,
      fetchedAt: options.fetchedAt ?? checkedAt(key, staleAfterFor(key)),
      lastUsedAt: counters.lastUsedAt,
      useCount: counters.useCount,
    };
    metas.set(key, meta);
    dirty.delete(key);
    volatileMissing.delete(key);
    failures.delete(key);
    imageLoadFailures.delete(key);
    clearImageLoadTimer(key);
    clearRetry(key);
    setUrl(key, makeUrl(scaled));
    const stored = { key, bytes: scaled.bytes, type: scaled.type };
    safeStore((s) => s.putEntry(meta, stored));
    scheduleEvict();
    return 'saved';
  };

  /**
   * The node says there is no avatar. `persist: false` keeps the answer in
   * memory only (an image the browser cannot decode).
   */
  const saveMissing = (
    key: QdnAvatarKey,
    options: { node?: string; persist?: boolean } = {}
  ) => {
    const previous = metas.get(key);
    failures.delete(key);
    clearRetry(key);
    if (hasImage(previous)) {
      // Keep a cached image rather than trust one "missing" answer (a node
      // that is not synced says the same); check again tomorrow.
      metas.set(key, {
        ...previous,
        fetchedAt: checkedAt(key, staleAfterFor(key)),
      });
      dirty.add(key);
      schedulePersist();
      return;
    }
    const counters = takeUsage(key, previous);
    const t = checkedAt(key, missingRecheckFor(key));
    const meta: QdnAvatarMeta = {
      key,
      size: 0,
      fetchedAt: t,
      lastUsedAt: counters.lastUsedAt,
      useCount: counters.useCount,
      missing: true,
      missingCheckedAt: t,
    };
    if (options.node) meta.missingNode = options.node;
    metas.set(key, meta);
    dirty.delete(key);
    if (options.persist === false) {
      volatileMissing.add(key);
    } else {
      volatileMissing.delete(key);
      safeStore((s) => s.putEntry(meta, null));
    }
    scheduleEvict();
  };

  const recordFailure = (key: QdnAvatarKey) => {
    const previous = failures.get(key);
    const count = (previous?.count ?? 0) + 1;
    const delays = limits.backoffMs.length ? limits.backoffMs : [30_000];
    const delay = delays[Math.min(count - 1, delays.length - 1)];
    failures.set(key, { count, nextAt: now() + delay });
    shortFresh.delete(key);
    const meta = metas.get(key);
    if (hasImage(meta)) {
      // A good image is shown: no retry ladder, just check again later.
      clearRetry(key);
      const due = now() - staleAfterFor(key) + limits.staleRetryMs;
      if ((meta.fetchedAt || 0) < due) {
        metas.set(key, { ...meta, fetchedAt: due });
        dirty.add(key);
        schedulePersist();
      }
      return;
    }
    if (hasListeners(key)) scheduleRetry(key, delay);
  };

  /** True when a refresh() asked for this key again (the job is re-queued). */
  const finishJob = (job: Job): boolean => {
    if (activeKeys.get(job.key) === job) activeKeys.delete(job.key);
    activeCount = Math.max(0, activeCount - 1);
    if (job.stage === 'blocking') {
      activeBlocking = Math.max(0, activeBlocking - 1);
    }
    if (job.generation !== generation || !rerun.delete(job.key)) return false;
    enqueue(job.key, PRIORITY_RANK.high);
    return true;
  };

  const runJob = async (job: Job) => {
    const { key } = job;
    let settled = true;
    const current = () =>
      job.generation === generation && job.epoch === epochOf(key);
    try {
      const ref = refFor(key);
      const apiBase = readApiBase();
      if (!ref || !apiBase) {
        if (current()) recordFailure(key);
        return;
      }
      const node = qdnAvatarNodeTag(apiBase);
      const storeFetched = async (image: AvatarImageBytes) => {
        const result = await saveImage(key, image, job);
        // The browser cannot show it: no avatar, but do not store that.
        if (result === 'undecodable' && current()) {
          saveMissing(key, { node, persist: false });
        }
      };

      if (job.stage === 'async') {
        const outcome = await fetchAvatarAttempt(
          fetchImpl,
          buildQdnAvatarUrl(apiBase, ref),
          {
            timeoutMs: limits.asyncTimeoutMs,
            maxBytes: limits.maxDownloadBytes,
            ...fetchTimers,
          }
        );
        if (!current()) return;
        if (outcome.kind === 'image') {
          await storeFetched(outcome.image);
          return;
        }
        if (outcome.kind === 'missing') {
          saveMissing(key, { node });
          return;
        }
        if (
          outcome.kind === 'invalid' ||
          (outcome.kind === 'error' &&
            (outcome.reason === 'network' ||
              outcome.reason === 'too_large' ||
              (outcome.reason === 'http' && isOverloadStatus(outcome.status))))
        ) {
          // Offline, a captive portal, or an overloaded node: back off.
          recordFailure(key);
          return;
        }
        // Not on the node yet (or slow): was it ever published?
        const published = await fetchAvatarPublishStatus(
          fetchImpl,
          buildQdnAvatarStatusUrl(apiBase, ref),
          { timeoutMs: limits.statusTimeoutMs, ...fetchTimers }
        );
        if (!current()) return;
        if (published === 'not_published') {
          saveMissing(key, { node });
          return;
        }
        // The async request asked the node to fetch it; wait for it in the
        // background with a blocking request.
        settled = false;
        seq += 1;
        queue.push({ ...job, stage: 'blocking', seq });
        finishJob(job);
        return;
      }

      const outcome = await fetchAvatarAttempt(
        fetchImpl,
        buildQdnAvatarUrl(apiBase, ref, { blocking: true }),
        {
          timeoutMs: limits.blockingTimeoutMs,
          maxBytes: limits.maxDownloadBytes,
          ...fetchTimers,
        }
      );
      if (!current()) return;
      if (outcome.kind === 'image') await storeFetched(outcome.image);
      else if (outcome.kind === 'missing') saveMissing(key, { node });
      else recordFailure(key);
    } catch {
      if (current()) recordFailure(key);
    } finally {
      const requeued = settled ? finishJob(job) : false;
      if (job.generation === generation) {
        emit(key);
        if (settled && !requeued) settle(key);
      }
      pump();
    }
  };

  // ------------------------------------------------------------------- init

  /** Keys whose stored image is worth loading together with the records. */
  const preloadKeys = (): QdnAvatarKey[] => {
    const wanted = new Set<QdnAvatarKey>();
    for (const key of pendingRequests.keys()) {
      if (hasImage(metas.get(key))) wanted.add(key);
    }
    const top = Array.from(metas.values())
      .filter(hasImage)
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, Math.max(0, limits.preloadCount));
    for (const meta of top) wanted.add(meta.key);
    return Array.from(wanted).filter((key) => !urls.has(key));
  };

  const ensureInit = (): Promise<void> => {
    if (initPromise) return initPromise;
    const initGeneration = generation;
    initPromise = (async () => {
      // A storage that never answers must not stop avatars: memory only.
      let opened: QdnAvatarStore | null = null;
      try {
        const result = await withTimeout(
          openStore(),
          limits.initTimeoutMs,
          (late) => late?.close?.()
        );
        opened = result === TIMED_OUT ? null : result;
        if (result === TIMED_OUT) storeSkipped = true;
      } catch {
        opened = null;
      }
      let rows: QdnAvatarMeta[] = [];
      if (opened) {
        try {
          const result = await withTimeout(
            opened.loadAllMeta(),
            limits.initTimeoutMs
          );
          if (result === TIMED_OUT) {
            try {
              opened.close?.();
            } catch {
              // ignore
            }
            opened = null;
            storeSkipped = true;
          } else {
            rows = Array.isArray(result) ? result : [];
          }
        } catch {
          rows = [];
        }
      }
      store = opened ?? createMemoryAvatarStore();
      if (initGeneration === generation) {
        for (const row of rows) {
          if (isValidMeta(row) && !metas.has(row.key)) {
            metas.set(row.key, row);
          }
        }
        // Uses counted before storage was read.
        for (const [key, counted] of Array.from(usage.entries())) {
          const meta = metas.get(key);
          if (!meta) continue;
          usage.delete(key);
          metas.set(key, {
            ...meta,
            useCount: (meta.useCount || 0) + counted.useCount,
            lastUsedAt: Math.max(meta.lastUsedAt || 0, counted.lastUsedAt),
          });
          dirty.add(key);
        }
        if (dirty.size) schedulePersist();
        // The images on the first screen come with the records.
        try {
          await loadStoredImages(preloadKeys(), {
            quiet: true,
            timeoutMs: limits.initTimeoutMs,
          });
        } catch {
          // loaded on demand instead
        }
      }
      ready = true;
      const refreshes = Array.from(pendingRefreshes);
      pendingRefreshes.clear();
      for (const key of refreshes) {
        try {
          applyRefresh(key);
        } catch {
          // ignore
        }
      }
      const pending = Array.from(pendingRequests.entries());
      pendingRequests.clear();
      for (const [key, rank] of pending) {
        try {
          decide(key, rank, false);
        } catch {
          // ignore
        }
      }
      emitAll();
      scheduleEvict();
    })();
    return initPromise;
  };

  // ------------------------------------------------------------- public API

  /** Remember how the caller spells the name, for node URLs. */
  const rememberName = (key: QdnAvatarKey, name?: string | null) => {
    const cleaned = cleanQdnName(name);
    if (cleaned) names.set(key, cleaned);
  };

  const keyFor = (
    name: string | null | undefined,
    identifier?: string | null
  ): QdnAvatarKey | null => {
    try {
      return qdnAvatarKey(name, identifier);
    } catch {
      return null;
    }
  };

  /**
   * Asks for an avatar: loads it from storage, or queues a fetch. Cheap to
   * call on every mount. Returns true while network work is queued/running.
   */
  const request = (
    key: QdnAvatarKey | null,
    options: QdnAvatarRequest = {}
  ) => {
    try {
      if (!key) return false;
      rememberName(key, options.name);
      const rank = PRIORITY_RANK[options.priority ?? 'normal'] ?? 2;
      if (!ready) {
        pendingRequests.set(key, Math.max(rank, pendingRequests.get(key) ?? 0));
        void ensureInit();
        return true;
      }
      return decide(key, rank, false);
    } catch {
      return false;
    }
  };

  const subscribe = (key: QdnAvatarKey, listener: () => void) => {
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(listener);
    void ensureInit();
    return () => {
      const current = listeners.get(key);
      if (!current) return;
      current.delete(listener);
      if (!current.size) {
        listeners.delete(key);
        clearRetry(key);
        clearImageLoadTimer(key);
      }
    };
  };

  const getSnapshot = (key: QdnAvatarKey | null): QdnAvatarSnapshot => {
    if (!key) return IDLE_SNAPSHOT;
    const existing = snapshots.get(key);
    if (existing) return existing;
    const created = buildSnapshot(key);
    snapshots.set(key, created);
    return created;
  };

  /**
   * Keeps an object URL handed to non-React code valid until clear(): it is
   * no longer revoked when the image is refreshed or evicted.
   */
  const retainUrl = (url: string | null | undefined) => {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      retainedUrls.add(url);
    }
  };

  /** Counts one use (throttled per key) for the eviction score. */
  const noteUse = (key: QdnAvatarKey | null) => {
    try {
      if (!key) return;
      const t = now();
      const last = lastUseNoted.get(key);
      if (last != null && t - last < limits.useThrottleMs) return;
      lastUseNoted.set(key, t);
      const meta = metas.get(key);
      if (ready && meta) {
        metas.set(key, {
          ...meta,
          useCount: (meta.useCount || 0) + 1,
          lastUsedAt: t,
        });
        dirty.add(key);
        schedulePersist();
        return;
      }
      // No record yet (or storage not read yet): merged in when the record is
      // loaded or saved.
      const pending = usage.get(key);
      usage.set(key, {
        useCount: (pending?.useCount ?? 0) + 1,
        lastUsedAt: t,
      });
    } catch {
      // counters are best effort
    }
  };

  const readImageBytes = async (
    key: QdnAvatarKey
  ): Promise<AvatarImageBytes | null> => {
    if (!hasImage(metas.get(key))) return null;
    if (store) {
      try {
        const found = await withTimeout(
          store.loadImages([key]),
          limits.imageLoadTimeoutMs
        );
        const image = found === TIMED_OUT ? undefined : found?.get(key);
        if (image) return { bytes: image.bytes, type: image.type };
      } catch {
        // try the in-memory copy
      }
    }
    const url = urls.get(key);
    if (!url) return null;
    if (url.startsWith('data:')) return dataUrlToBytes(url);
    try {
      const response = await fetchImpl(url);
      const bytes = await response.arrayBuffer();
      const type = sniffImageType(bytes);
      return type ? { bytes, type } : null;
    } catch {
      return null;
    }
  };

  /**
   * The avatar as a `data:` URL (for native notifications). Uses the cache,
   * fetches when needed (waiting up to `timeoutMs`), then the bundled seed.
   */
  const getDataUrl = async (
    name: string | null | undefined,
    options: {
      identifier?: string | null;
      timeoutMs?: number;
      allowSeed?: boolean;
    } = {}
  ): Promise<string | null> => {
    try {
      const key = keyFor(name, options.identifier);
      if (!key) return null;
      await ensureInit();
      let image = await readImageBytes(key);
      if (!image) {
        const working = request(key, { name, priority: 'high' });
        if (working || isBusy(key)) {
          await whenSettled(key, options.timeoutMs ?? 10_000);
          image = await readImageBytes(key);
        }
      }
      if (image) return bytesToDataUrl(image.bytes, image.type);
      if (options.allowSeed === false) return null;
      const seed = seedUrlFor(key);
      if (!seed) return null;
      const response = await fetchImpl(seed);
      if (!response.ok) return null;
      const bytes = await response.arrayBuffer();
      const type = sniffImageType(bytes);
      return type ? bytesToDataUrl(bytes, type) : null;
    } catch {
      return null;
    }
  };

  /**
   * Fetches avatars GO is about to show (low priority, one at a time). Stops
   * after `maxConsecutiveFailures` failures in a row, e.g. on a dead node.
   */
  const prewarm = async (
    entries: QdnAvatarPrewarmEntry[],
    options: { limit?: number; maxConsecutiveFailures?: number } = {}
  ): Promise<QdnAvatarPrewarmResult> => {
    const result: QdnAvatarPrewarmResult = {
      fetched: 0,
      failed: 0,
      skipped: 0,
      stopped: false,
    };
    try {
      await ensureInit();
      const limit = Math.max(0, options.limit ?? 40);
      const maxFailures = Math.max(1, options.maxConsecutiveFailures ?? 3);
      const seen = new Set<QdnAvatarKey>();
      const keys: QdnAvatarKey[] = [];
      for (const entry of Array.isArray(entries) ? entries : []) {
        const name = typeof entry === 'string' ? entry : entry?.name;
        const identifier =
          typeof entry === 'string' ? undefined : entry?.identifier;
        const key = keyFor(name, identifier);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rememberName(key, name);
        keys.push(key);
        if (keys.length >= limit) break;
      }
      const startGeneration = generation;
      let consecutive = 0;
      const perKeyTimeout =
        limits.asyncTimeoutMs +
        limits.statusTimeoutMs +
        limits.blockingTimeoutMs +
        5_000;
      for (const key of keys) {
        if (result.stopped || generation !== startGeneration) {
          result.skipped += 1;
          continue;
        }
        const queued = decide(key, PRIORITY_RANK.prewarm, true);
        if (!queued) {
          result.skipped += 1;
          continue;
        }
        await whenSettled(key, perKeyTimeout);
        const meta = metas.get(key);
        const fresh =
          !!meta &&
          now() - (meta.fetchedAt || 0) < staleAfterFor(key) &&
          !failures.has(key);
        if (fresh) {
          if (hasImage(meta)) result.fetched += 1;
          consecutive = 0;
        } else {
          result.failed += 1;
          consecutive += 1;
          if (consecutive >= maxFailures) result.stopped = true;
        }
      }
    } catch {
      // best effort
    }
    return result;
  };

  /**
   * Drops the queued prewarm job for `key` (lock, logout, account switch):
   * only a job still waiting to start, that nothing but the prewarm asked
   * for (no getDataUrl, no request) and whose avatar nobody shows. prewarm()
   * stops waiting for it at once. True when a job was dropped.
   */
  const cancelPrewarm = (key: QdnAvatarKey | null | undefined): boolean => {
    if (!key) return false;
    const job = queue.find((item) => item.key === key);
    if (!job || !job.prewarm || hasListeners(key)) return false;
    queue = queue.filter((item) => item !== job);
    settle(key);
    emit(key);
    return true;
  };

  /**
   * Forgets backoff, staleness and "missing" for `key` and fetches it at
   * high priority. A fetch already running is discarded and asked again.
   */
  const applyRefresh = (key: QdnAvatarKey) => {
    failures.delete(key);
    clearRetry(key);
    volatileMissing.delete(key);
    const meta = metas.get(key);
    if (meta) {
      metas.set(key, {
        ...meta,
        fetchedAt: 0,
        missing: false,
        missingCheckedAt: undefined,
        missingNode: undefined,
        size: meta.missing ? 0 : meta.size,
      });
    }
    bumpEpoch(key);
    // The node may still serve the old file: check its answer again soon.
    shortFresh.add(key);
    if (activeKeys.has(key)) {
      rerun.add(key);
      emit(key);
      return;
    }
    enqueue(key, PRIORITY_RANK.high);
  };

  /**
   * Re-fetch now, e.g. when the avatar may have changed elsewhere. After the
   * user published a new avatar, prefer putImage(): the node may still serve
   * the old file for a while.
   */
  const refresh = (
    name: string | null | undefined,
    options: { identifier?: string | null } = {}
  ) => {
    try {
      const key = keyFor(name, options.identifier);
      if (!key) return;
      rememberName(key, name);
      if (!ready) {
        // Applied once the stored record is loaded (it may be fresh).
        pendingRefreshes.add(key);
        void ensureInit();
        return;
      }
      applyRefresh(key);
    } catch {
      // ignore
    }
  };

  /**
   * Stores an image the app already has (e.g. the avatar it just published).
   * It wins over fetches already queued or running, and the node copy is
   * checked again after `publishRecheckMs`.
   */
  const putImage = async (
    name: string | null | undefined,
    data: Blob | ArrayBuffer | ArrayBufferView | string,
    options: { identifier?: string | null } = {}
  ): Promise<boolean> => {
    try {
      const key = keyFor(name, options.identifier);
      if (!key || !data) return false;
      await ensureInit();
      const bytes =
        typeof data === 'string'
          ? dataUrlToBytes(data)?.bytes
          : await toArrayBuffer(data);
      if (!bytes) return false;
      const type = sniffImageType(bytes);
      if (!type || bytes.byteLength > limits.maxDownloadBytes) return false;
      rememberName(key, name);
      const supersede = () => {
        bumpEpoch(key);
        queue = queue.filter((job) => job.key !== key);
        rerun.delete(key);
        shortFresh.delete(key);
        failures.delete(key);
        clearRetry(key);
      };
      supersede();
      const result = await saveImage(
        key,
        { bytes, type },
        { generation, epoch: epochOf(key) },
        {
          fetchedAt: now() - staleAfterFor(key) + limits.publishRecheckMs,
        }
      );
      // Fetches that started while the image was being shrunk lose too.
      if (result === 'saved') supersede();
      // Undecodable: the fetches dropped above are needed again. ('stale': a
      // newer putImage(), refresh() or clear() took over and asks itself.)
      else if (result === 'undecodable' && hasListeners(key)) {
        decide(key, PRIORITY_RANK.normal, false);
      }
      emit(key);
      settle(key);
      return result === 'saved';
    } catch {
      return false;
    }
  };

  /** Clears the storage that was skipped at start (too slow), if it opens. */
  const clearSkippedStore = async () => {
    const wipe = async (target: QdnAvatarStore | null | undefined) => {
      if (!target) return;
      try {
        await withTimeout(target.clear(), limits.initTimeoutMs);
      } finally {
        target.close?.();
      }
    };
    try {
      const opened = await withTimeout(
        openStore(),
        limits.initTimeoutMs,
        (late) => void wipe(late).catch(() => undefined)
      );
      if (opened !== TIMED_OUT) await wipe(opened);
    } catch {
      // nothing more we can do
    }
  };

  /**
   * Forgets every cached avatar, in memory and on disk (account removal).
   * Fetches still running are discarded when they finish; avatars on screen
   * are asked for again.
   */
  const clear = async (): Promise<void> => {
    generation += 1;
    queue = [];
    activeKeys.clear();
    for (const handle of retryTimers.values()) clearTimer(handle);
    retryTimers.clear();
    for (const handle of imageLoadTimers.values()) clearTimer(handle);
    imageLoadTimers.clear();
    for (const handle of revokeTimers) clearTimer(handle);
    revokeTimers.clear();
    if (persistTimer != null) clearTimer(persistTimer);
    persistTimer = null;
    if (evictTimer != null) clearTimer(evictTimer);
    evictTimer = null;
    for (const url of urls.values()) releaseUrl(url, true);
    for (const url of Array.from(retainedUrls)) releaseUrl(url, true);
    retainedUrls.clear();
    urls.clear();
    metas.clear();
    names.clear();
    failures.clear();
    usage.clear();
    lastUseNoted.clear();
    dirty.clear();
    pendingRequests.clear();
    pendingRefreshes.clear();
    pendingImageLoads.clear();
    imageLoadFailures.clear();
    epochs.clear();
    rerun.clear();
    shortFresh.clear();
    volatileMissing.clear();
    for (const key of Array.from(waiters.keys())) settle(key);
    snapshots.clear();
    try {
      if (initPromise) await initPromise;
      if (store) await withTimeout(store.clear(), limits.initTimeoutMs);
      if (storeSkipped) await clearSkippedStore();
    } catch {
      // nothing more we can do
    }
    for (const key of Array.from(listeners.keys())) {
      emit(key);
      try {
        if (ready) decide(key, PRIORITY_RANK.normal, false);
      } catch {
        // ignore
      }
    }
  };

  return {
    keyFor,
    request,
    subscribe,
    getSnapshot,
    retainUrl,
    noteUse,
    getDataUrl,
    prewarm,
    cancelPrewarm,
    refresh,
    putImage,
    clear,
    /**
     * Opens storage, reads the records and loads the most used images (also
     * done lazily on first use). Await it before the first screen so cached
     * avatars show on the first frame. Never rejects.
     */
    init: ensureInit,
    /** Test/diagnostic view of the internal state. */
    debugState: () => ({
      ready,
      initStarted: !!initPromise,
      storeKind: store?.kind ?? null,
      queued: queue.map((job) => ({ key: job.key, stage: job.stage })),
      active: Array.from(activeKeys.keys()),
      activeCount,
      loadingImages: loadingImages.size + pendingImageLoads.size,
      metas: Array.from(metas.values(), (meta) => ({ ...meta })),
      failures: Array.from(failures.entries()),
      urls: Array.from(urls.entries()),
      retainedUrls: Array.from(retainedUrls),
    }),
  };
}
