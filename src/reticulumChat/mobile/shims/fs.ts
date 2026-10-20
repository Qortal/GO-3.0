/**
 * Synchronous `fs` stand-in for the mobile engine worker, backed by OPFS
 * SyncAccessHandles (available in dedicated workers on Chromium WebViews).
 *
 * Why this shape: the chat engine and resource store were written for Node's
 * sync fs (positioned readSync/writeSync for serving attachment byte ranges).
 * `createSyncAccessHandle()` is itself async, so handles cannot be opened
 * inside a sync call — instead a pool of pre-opened handles is kept and
 * assigned to logical paths on demand (the same trick sqlite-wasm's
 * opfs-sahpool VFS uses). A background task keeps spare handles topped up.
 *
 * The directory tree is virtual: an in-memory index (path -> slot/size/mtime)
 * persisted into a dedicated metadata handle so files survive restarts.
 */
// The logger shim, not console: console output only reaches logcat, while
// Copy diagnostics reads the logger's ring, boot-fault buffer and line counts.
import { log, warn } from './logger';

type IndexEntry = {
  slot: number;
  size: number;
  mtimeMs: number;
};

type Watcher = {
  dir: string;
  cb: () => void;
};

const POOL_DIR = 'qgo-chat-fs';
const META_FILE = '__index__.json';
/**
 * The engine allocates temp blobs in synchronous bursts — one file per
 * recipient peer when broadcasting an event — and handles can only be opened
 * asynchronously, so the pool has to be deep enough to absorb a whole burst
 * before the background top-up gets a turn. A group with a hundred subscribed
 * peers is normal, and running dry surfaces as EMFILE to the engine.
 */
const SPARE_TARGET = 256;
/** Slots kept open beyond the target are closed and returned to disk reuse. */
const SPARE_CEILING = SPARE_TARGET * 2;
const INDEX_FLUSH_DEBOUNCE_MS = 200;
/**
 * A sync access handle can only be opened asynchronously, so every indexed
 * file has to hold one open for the whole session — and Chromium charges
 * roughly 16 KB of renderer memory per handle. Left unbounded, an attachment
 * cache that had grown to ~32k blobs cost half a gigabyte of native memory
 * and a boot-time handle storm that stalled the UI thread for hundreds of
 * milliseconds at a time. Keep the most recently touched blobs; the resource
 * store reconciles anything missing on startup and re-fetches on demand.
 */
const MAX_INDEXED_FILES = 2048;
/** Orphan slot files kept for reuse; the surplus is deleted in the background. */
const MAX_RECLAIMABLE_SLOTS = 512;
/** Slot deletions and handle opens run in batches so neither blocks a frame. */
const SLOT_BATCH = 32;
const QUOTA_REFRESH_MS = 30_000;
/**
 * Top-up starts as soon as one batch is missing, not at a quarter of the
 * target: one history page stores up to 100 events, and on a busy worker the
 * refill trails the writes by seconds. Starting at 64 left the pool empty for
 * minutes during a catch-up (EMFILE on every write).
 */
const SPARE_REFILL_BELOW = SPARE_TARGET - SLOT_BATCH;
/** A top-up that opened nothing tries again on its own: 1 s, doubling to 30 s. */
const TOP_UP_RETRY_MIN_MS = 1_000;
const TOP_UP_RETRY_MAX_MS = 30_000;
/**
 * A batch of opens still unsettled after this long counts as hung, so one
 * createSyncAccessHandle that never answers cannot stop refills for the rest
 * of the session.
 */
const TOP_UP_WATCHDOG_MS = 30_000;
/**
 * Files that belong to the page that wrote them: the engine's wake-up notes
 * (it never replays a note older than its own start) and transfer temp files
 * (their transfers died with the page). Dropped at boot, evicted first.
 */
const DISPOSABLE_DIR_PARTS = [
  '/reticulum-chat-notify/',
  '/reticulum-chat-temp/',
];

/**
 * OPFS synchronous access handles. Declared here because the TypeScript DOM lib
 * this project builds against predates them; the runtime (Android WebView in a
 * worker) provides them.
 */
declare global {
  interface FileSystemSyncAccessHandle {
    close(): void;
    flush(): void;
    getSize(): number;
    read(
      buffer: ArrayBufferView | ArrayBuffer,
      options?: { at?: number }
    ): number;
    truncate(newSize: number): void;
    write(
      buffer: ArrayBufferView | ArrayBuffer,
      options?: { at?: number }
    ): number;
  }

  interface FileSystemFileHandle {
    createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
  }
}

let rootDir: FileSystemDirectoryHandle | null = null;
let metaHandle: FileSystemSyncAccessHandle | null = null;

const files = new Map<string, IndexEntry>();
const dirs = new Set<string>(['/']);
const slotHandles = new Map<number, FileSystemSyncAccessHandle>();
const spareSlots: number[] = [];
/** Slot files that exist on disk with no open handle — reused before minting. */
const reclaimableSlots: number[] = [];
let nextSlot = 1;
let topUpInFlight = false;
/** Bumped per top-up run; a run the watchdog replaced stops at its next batch. */
let topUpGeneration = 0;
let topUpStartedAt = 0;
/** When the batch now being opened started (the watchdog reads it). */
let topUpBatchStartedAt = 0;
let topUpRetryTimer: ReturnType<typeof setTimeout> | null = null;
let topUpRetryDelayMs = TOP_UP_RETRY_MIN_MS;

/** Since this worker booted; read through getMobileFsStats(). */
const counters = {
  emfileCount: 0,
  emfileFirstAt: 0,
  emfileLastAt: 0,
  topUpRuns: 0,
  topUpOpened: 0,
  topUpFailed: 0,
  topUpMaxMs: 0,
  topUpLastErrorName: '',
  topUpWatchdogRestarts: 0,
  bootDropped: 0,
  bootEvicted: 0,
  bootOpenFailed: 0,
};

const fds = new Map<number, { path: string; slot: number; pos: number }>();
let nextFd = 11;

const watchers = new Set<Watcher>();

function normalize(p: string): string {
  const parts = String(p).replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return '/' + out.join('/');
}

function dirname(p: string): string {
  const n = normalize(p);
  const i = n.lastIndexOf('/');
  return i <= 0 ? '/' : n.slice(0, i);
}

function slotName(slot: number): string {
  return `slot-${slot}.bin`;
}

/**
 * Short name of a failure for logs and stats. OPFS failures are DOMExceptions
 * (`TooManyOpenHandles`, `NoModificationAllowedError`), which JSON.stringify
 * turns into `{}`.
 */
function errorName(err: unknown): string {
  if (err && typeof err === 'object') {
    const { code, name, message } = err as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
    };
    if (typeof code === 'string' && code) return code;
    if (typeof name === 'string' && name && name !== 'Error') return name;
    if (typeof message === 'string' && message) return message.slice(0, 80);
  }
  return String(err).slice(0, 80) || 'unknown';
}

function writeIndexNow(): void {
  if (!metaHandle) return;
  indexDirty = false;
  const payload = new TextEncoder().encode(
    JSON.stringify({
      nextSlot,
      dirs: [...dirs],
      files: [...files.entries()],
    })
  );
  try {
    metaHandle.truncate(0);
    metaHandle.write(payload, { at: 0 });
    metaHandle.flush();
  } catch (err) {
    warn(`[mobile-fs] index_persist_failed error=${errorName(err)}`);
  }
}

let indexDirty = false;
let indexFlushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Serializing the whole index costs O(files) per call, and the engine writes
 * hundreds of small blobs in a burst — doing it inline made writes quadratic.
 * Coalesce instead; the worst case on an abrupt kill is losing the last few
 * hundred milliseconds of metadata.
 */
function persistIndex(): void {
  if (!metaHandle) return;
  indexDirty = true;
  if (indexFlushTimer) return;
  indexFlushTimer = setTimeout(() => {
    indexFlushTimer = null;
    if (indexDirty) writeIndexNow();
  }, INDEX_FLUSH_DEBOUNCE_MS);
}

function notifyWatchers(path: string): void {
  const dir = dirname(path);
  for (const w of watchers) {
    if (w.dir === dir) {
      try {
        w.cb();
      } catch {
        /* watcher callback errors are the caller's problem */
      }
    }
  }
}

async function openSlotHandle(
  slot: number
): Promise<FileSystemSyncAccessHandle> {
  if (!rootDir) throw new Error('mobile-fs not initialised');
  const fh = await rootDir.getFileHandle(slotName(slot), { create: true });
  return fh.createSyncAccessHandle();
}

type OpenSlotsResult = {
  opened: number[];
  failed: number;
  /** errorName of the last failed open, '' when none failed. */
  lastErrorName: string;
};

/** Best effort: an orphan left behind is collected by the next boot's scan. */
function removeSlotFile(slot: number): void {
  const dir = rootDir;
  if (!dir) return;
  void dir.removeEntry(slotName(slot)).catch(() => {
    /* never created, or already gone */
  });
}

/**
 * Opens handles in parallel batches; one-at-a-time is far too slow at boot.
 * Slots numbered `freshFrom` or higher were minted for this call, so their
 * files exist only because of it: one whose open fails is removed again
 * rather than left on disk (a failing top-up used to leave thousands).
 */
async function openSlots(
  slots: number[],
  freshFrom = Number.POSITIVE_INFINITY
): Promise<OpenSlotsResult> {
  const result: OpenSlotsResult = { opened: [], failed: 0, lastErrorName: '' };
  for (let i = 0; i < slots.length; i += SLOT_BATCH) {
    const batch = slots.slice(i, i + SLOT_BATCH);
    const handles = await Promise.all(
      batch.map((slot) =>
        openSlotHandle(slot).then(
          (handle) => ({ slot, handle }),
          (err) => {
            result.failed += 1;
            result.lastErrorName = errorName(err);
            if (slot >= freshFrom) removeSlotFile(slot);
            return null;
          }
        )
      )
    );
    for (const entry of handles) {
      if (!entry) continue;
      slotHandles.set(entry.slot, entry.handle);
      result.opened.push(entry.slot);
    }
  }
  // One line per call, not per slot: a failing OPFS fails every slot.
  if (result.failed > 0) {
    warn(
      `[mobile-fs] slot_open_failed failed=${result.failed} of=${slots.length} error=${result.lastErrorName}`
    );
  }
  return result;
}

/** A file only the page that wrote it could use (see DISPOSABLE_DIR_PARTS). */
function isDisposablePath(path: string): boolean {
  if (path.startsWith('/tmp/')) return true;
  return DISPOSABLE_DIR_PARTS.some((part) => path.includes(part));
}

/**
 * How hard a file fights to keep its handle. Staging temp files and the
 * engine's wake-up notes and transfer temp files are worthless to a new page,
 * and a resource's range map or half-finished download can be re-derived by
 * downloading again — but an assembled blob may be the only copy of something
 * this device published, so it is evicted last. Wake-up notes used to rank
 * with blobs: being the newest files, they filled the cap after a busy
 * session and pushed every attachment out of the index.
 */
function keepRank(path: string): number {
  if (isDisposablePath(path)) return 0;
  if (path.endsWith('/ranges.json') || path.endsWith('/download.partial')) {
    return 1;
  }
  return 2;
}

/**
 * Drops the most disposable blobs from the index so the pool of open handles
 * stays bounded. Runs before any handle is opened, so nothing has to be
 * closed. The orphaned slot files are deliberately left for the disk scan
 * below to collect — pushing them onto the reuse list here as well would let
 * the same slot back two different paths.
 */
function evictOldestBeyondCap(): number {
  if (files.size <= MAX_INDEXED_FILES) return 0;
  const keepFirst = [...files.entries()].sort((a, b) => {
    const rank = keepRank(b[0]) - keepRank(a[0]);
    return rank !== 0 ? rank : b[1].mtimeMs - a[1].mtimeMs;
  });
  const surplus = keepFirst.slice(MAX_INDEXED_FILES);
  for (const [path] of surplus) files.delete(path);
  return surplus.length;
}

/**
 * Slot files past the reuse pool are dead weight: they inflate origin storage
 * and make every OPFS directory enumeration slower. Removing them is pure I/O,
 * so it happens after boot in small batches. The surplus is spliced out of the
 * reuse list first, so a slot can never be handed out and deleted at once.
 */
function scheduleOrphanSlotCleanup(): void {
  if (reclaimableSlots.length <= MAX_RECLAIMABLE_SLOTS) return;
  const surplus = reclaimableSlots.splice(MAX_RECLAIMABLE_SLOTS);
  void (async () => {
    for (let i = 0; i < surplus.length; i += SLOT_BATCH) {
      const dir = rootDir;
      if (!dir) return;
      await Promise.all(
        surplus.slice(i, i + SLOT_BATCH).map((slot) =>
          dir.removeEntry(slotName(slot)).catch(() => {
            /* already gone, or still held by a previous run */
          })
        )
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  })();
}

let quotaSnapshot = { usage: 0, quota: 0, at: 0 };
let quotaRefreshInFlight = false;

function refreshQuotaSnapshot(): void {
  if (quotaRefreshInFlight || !navigator.storage?.estimate) return;
  quotaRefreshInFlight = true;
  void navigator.storage
    .estimate()
    .then(({ usage, quota }) => {
      quotaSnapshot = {
        usage: Number(usage) || 0,
        quota: Number(quota) || 0,
        at: Date.now(),
      };
    })
    .catch(() => {
      /* keep the previous snapshot */
    })
    .finally(() => {
      quotaRefreshInFlight = false;
    });
}

/** Prefers slot files already on disk so the pool does not grow unbounded. */
function nextFreeSlots(count: number): number[] {
  const slots: number[] = [];
  while (slots.length < count) {
    const reclaimed = reclaimableSlots.pop();
    slots.push(reclaimed ?? nextSlot++);
  }
  return slots;
}

/**
 * Refills the spare pool. Called on every take (cheap when nothing is
 * needed), by the retry timer, and never more than one run at a time unless
 * the running one is hung (TOP_UP_WATCHDOG_MS).
 */
function scheduleTopUp(): void {
  if (spareSlots.length >= SPARE_REFILL_BELOW) return;
  // After a run that opened nothing the retry timer owns the next attempt;
  // starting a run per write would hammer an OPFS that is failing.
  if (topUpRetryTimer) return;
  if (topUpInFlight) {
    const batchMs = Date.now() - topUpBatchStartedAt;
    if (batchMs < TOP_UP_WATCHDOG_MS) return;
    counters.topUpWatchdogRestarts += 1;
    warn(
      `[mobile-fs] handle_top_up_stuck batch_ms=${batchMs} spares=${spareSlots.length}; starting another`
    );
  }
  topUpGeneration += 1;
  void runTopUp(topUpGeneration);
}

/**
 * Opens one batch at a time and publishes each batch as soon as it is open.
 * Publishing only after the whole run (up to eight sequential batches) is
 * what kept the pool empty on a congested worker even when refill could
 * keep up on average.
 */
async function runTopUp(generation: number): Promise<void> {
  topUpInFlight = true;
  const startedAt = Date.now();
  topUpStartedAt = startedAt;
  topUpBatchStartedAt = startedAt;
  counters.topUpRuns += 1;
  let openedNothing = false;
  try {
    while (generation === topUpGeneration && spareSlots.length < SPARE_TARGET) {
      const wanted = Math.min(SLOT_BATCH, SPARE_TARGET - spareSlots.length);
      const freshFrom = nextSlot;
      topUpBatchStartedAt = Date.now();
      const batch = await openSlots(nextFreeSlots(wanted), freshFrom);
      // Opened handles are good even when the watchdog replaced this run.
      spareSlots.push(...batch.opened);
      counters.topUpOpened += batch.opened.length;
      counters.topUpFailed += batch.failed;
      if (batch.lastErrorName) {
        counters.topUpLastErrorName = batch.lastErrorName;
      }
      if (batch.opened.length === 0) {
        openedNothing = true;
        break;
      }
    }
    persistIndex();
  } catch (err) {
    openedNothing = true;
    counters.topUpLastErrorName = errorName(err);
    warn(
      `[mobile-fs] handle_top_up_failed error=${counters.topUpLastErrorName}`
    );
  } finally {
    counters.topUpMaxMs = Math.max(counters.topUpMaxMs, Date.now() - startedAt);
    // A run the watchdog replaced leaves the flag and any retry to the run
    // that replaced it.
    if (generation === topUpGeneration) {
      topUpInFlight = false;
      if (openedNothing) armTopUpRetry();
      else topUpRetryDelayMs = TOP_UP_RETRY_MIN_MS;
    }
  }
}

/**
 * Before this timer existed a failed run waited for the next write, which
 * then failed with EMFILE itself; now the pool refills once OPFS recovers
 * even if nothing is written in between.
 */
function armTopUpRetry(): void {
  if (topUpRetryTimer) return;
  const delayMs = topUpRetryDelayMs;
  topUpRetryDelayMs = Math.min(TOP_UP_RETRY_MAX_MS, delayMs * 2);
  topUpRetryTimer = setTimeout(() => {
    topUpRetryTimer = null;
    scheduleTopUp();
  }, delayMs);
}

function takeSpareSlot(): number {
  const slot = spareSlots.pop();
  scheduleTopUp();
  if (slot === undefined) {
    const now = Date.now();
    counters.emfileCount += 1;
    if (!counters.emfileFirstAt) counters.emfileFirstAt = now;
    counters.emfileLastAt = now;
    throw Object.assign(new Error('EMFILE: no spare OPFS handles'), {
      code: 'EMFILE',
    });
  }
  return slot;
}

function handleFor(slot: number): FileSystemSyncAccessHandle {
  const h = slotHandles.get(slot);
  if (!h) {
    throw Object.assign(new Error(`EBADF: no handle for slot ${slot}`), {
      code: 'EBADF',
    });
  }
  return h;
}

function enoent(path: string): Error {
  return Object.assign(
    new Error(`ENOENT: no such file or directory, '${path}'`),
    { code: 'ENOENT' }
  );
}

function ensureFileEntry(path: string, create: boolean): IndexEntry {
  const n = normalize(path);
  let entry = files.get(n);
  if (!entry) {
    if (!create) throw enoent(n);
    entry = { slot: takeSpareSlot(), size: 0, mtimeMs: Date.now() };
    const h = handleFor(entry.slot);
    h.truncate(0);
    files.set(n, entry);
    // Parent directories materialise implicitly (Node would ENOENT, but every
    // engine call site mkdirSync's first; being lenient here is safe).
    let d = dirname(n);
    while (!dirs.has(d)) {
      dirs.add(d);
      d = dirname(d);
    }
    persistIndex();
  }
  return entry;
}

/** Must complete before any module touches `fs`. */
export async function initMobileFs(): Promise<void> {
  const opfsRoot = await navigator.storage.getDirectory();
  rootDir = await opfsRoot.getDirectoryHandle(POOL_DIR, { create: true });
  const metaFh = await rootDir.getFileHandle(META_FILE, { create: true });
  metaHandle = await metaFh.createSyncAccessHandle();

  const size = metaHandle.getSize();
  if (size > 0) {
    const buf = new Uint8Array(size);
    metaHandle.read(buf, { at: 0 });
    try {
      const parsed = JSON.parse(new TextDecoder().decode(buf)) as {
        nextSlot: number;
        dirs: string[];
        files: Array<[string, IndexEntry]>;
      };
      nextSlot = parsed.nextSlot || 1;
      for (const d of parsed.dirs || []) dirs.add(d);
      for (const [p, e] of parsed.files || []) files.set(p, e);
    } catch (err) {
      warn(`[mobile-fs] index_corrupt error=${errorName(err)}; starting fresh`);
    }
  }

  // Wake-up notes and transfer temp files of the previous page are useless
  // to this one, yet each would hold an open handle and a place under the
  // cap. Forget them before the cap is applied; their slot files are not
  // referenced any more, so the disk scan below collects them for reuse
  // (pushing them onto the spare list here as well would hand one slot to
  // two paths).
  let dropped = 0;
  for (const p of [...files.keys()]) {
    if (!isDisposablePath(p)) continue;
    files.delete(p);
    dropped += 1;
  }
  counters.bootDropped = dropped;
  if (dropped > 0) {
    log(`[mobile-fs] boot_dropped_disposable files=${dropped}`);
  }

  const evicted = evictOldestBeyondCap();
  counters.bootEvicted = evicted;
  if (evicted > 0) {
    warn(
      `[mobile-fs] dropped ${evicted} stale blobs to stay under ${MAX_INDEXED_FILES} open handles`
    );
  }

  // Open handles for every indexed file up-front (sync APIs cannot await).
  const referenced = new Map<number, string>();
  for (const [p, entry] of files) referenced.set(entry.slot, p);
  const bootOpen = await openSlots([...referenced.keys()]);
  counters.bootOpenFailed = bootOpen.failed;
  const opened = new Set(bootOpen.opened);
  for (const [slot, p] of referenced) {
    if (!opened.has(slot)) files.delete(p);
  }

  // Slot files left behind by a previous run (their owning path was deleted
  // before the in-memory spare list could be persisted) are reused rather than
  // leaked — otherwise the pool grows by a whole spare set on every launch.
  try {
    for await (const name of (
      rootDir as unknown as { keys(): AsyncIterable<string> }
    ).keys()) {
      const match = /^slot-(\d+)\.bin$/.exec(name);
      if (!match) continue;
      const slot = Number(match[1]);
      if (referenced.has(slot)) continue;
      reclaimableSlots.push(slot);
      if (slot >= nextSlot) nextSlot = slot + 1;
    }
  } catch (err) {
    warn(`[mobile-fs] slot_scan_failed error=${errorName(err)}`);
  }

  // Pre-provision spares with init so the first burst of writes never fails.
  const freshFrom = nextSlot;
  spareSlots.push(
    ...(await openSlots(nextFreeSlots(SPARE_TARGET), freshFrom)).opened
  );
  writeIndexNow();
  refreshQuotaSnapshot();
  scheduleOrphanSlotCleanup();
}

/** Handle-pool state for Copy diagnostics ("Chat storage"). */
export type MobileFsStats = {
  files: number;
  byArea: { notify: number; temp: number; resources: number; other: number };
  /** Every open sync access handle: indexed files, spares, the index file. */
  openHandles: number;
  spares: number;
  spareTarget: number;
  /** Slot files on disk with no open handle, reused before minting. */
  reclaimable: number;
  /** Writes that found no spare handle; ms timestamps, 0 when none. */
  emfile: { count: number; firstAt: number; lastAt: number };
  topUp: {
    inFlight: boolean;
    /** How long the current run has been going, 0 when idle. */
    inFlightMs: number;
    /** Longest run since boot. Slow refills vs failing opens is the question. */
    maxMs: number;
    runs: number;
    opened: number;
    failed: number;
    lastErrorName: string;
    /** A run opened nothing and the retry timer is waiting. */
    retryPending: boolean;
    watchdogRestarts: number;
  };
  /** At this worker's boot. */
  boot: {
    /** Previous page's wake-up notes and temp files that were forgotten. */
    dropped: number;
    /** Files dropped from the index to stay under MAX_INDEXED_FILES. */
    evicted: number;
    /** Indexed files whose handle could not be opened (dropped too). */
    openFailed: number;
  };
};

/** Cheap enough for a diagnostics call: one pass over the index. */
export function getMobileFsStats(now = Date.now()): MobileFsStats {
  const byArea = { notify: 0, temp: 0, resources: 0, other: 0 };
  for (const p of files.keys()) {
    if (p.includes('/reticulum-chat-notify/')) byArea.notify += 1;
    else if (isDisposablePath(p)) byArea.temp += 1;
    else if (p.includes('/reticulum-resources/')) byArea.resources += 1;
    else byArea.other += 1;
  }
  return {
    files: files.size,
    byArea,
    openHandles: slotHandles.size + (metaHandle ? 1 : 0),
    spares: spareSlots.length,
    spareTarget: SPARE_TARGET,
    reclaimable: reclaimableSlots.length,
    emfile: {
      count: counters.emfileCount,
      firstAt: counters.emfileFirstAt,
      lastAt: counters.emfileLastAt,
    },
    topUp: {
      inFlight: topUpInFlight,
      inFlightMs: topUpInFlight ? Math.max(0, now - topUpStartedAt) : 0,
      maxMs: counters.topUpMaxMs,
      runs: counters.topUpRuns,
      opened: counters.topUpOpened,
      failed: counters.topUpFailed,
      lastErrorName: counters.topUpLastErrorName,
      retryPending: topUpRetryTimer !== null,
      watchdogRestarts: counters.topUpWatchdogRestarts,
    },
    boot: {
      dropped: counters.bootDropped,
      evicted: counters.bootEvicted,
      openFailed: counters.bootOpenFailed,
    },
  };
}

// ── sync API ─────────────────────────────────────────────────────────────────

export function existsSync(p: string): boolean {
  const n = normalize(p);
  return files.has(n) || dirs.has(n);
}

export function mkdirSync(
  p: string,
  _opts?: { recursive?: boolean; mode?: number | string }
): string | undefined {
  let n = normalize(p);
  const created = !dirs.has(n);
  while (!dirs.has(n)) {
    dirs.add(n);
    n = dirname(n);
  }
  if (created) persistIndex();
  return undefined;
}

export function readdirSync(p: string): string[] {
  const n = normalize(p);
  if (!dirs.has(n) && !files.has(n)) throw enoent(n);
  const prefix = n === '/' ? '/' : n + '/';
  const names = new Set<string>();
  for (const f of files.keys()) {
    if (f.startsWith(prefix)) {
      names.add(f.slice(prefix.length).split('/')[0]);
    }
  }
  for (const d of dirs) {
    if (d !== n && d.startsWith(prefix)) {
      names.add(d.slice(prefix.length).split('/')[0]);
    }
  }
  return [...names];
}

export function readFileSync(p: string): Buffer;
export function readFileSync(p: string, encoding: string): string;
export function readFileSync(p: string, encoding?: string): Buffer | string {
  const entry = files.get(normalize(p));
  if (!entry) throw enoent(p);
  const h = handleFor(entry.slot);
  const out = new Uint8Array(entry.size);
  h.read(out, { at: 0 });
  if (encoding) return new TextDecoder().decode(out);
  return globalThis.Buffer.from(out);
}

export function writeFileSync(p: string, data: string | Uint8Array): void {
  const entry = ensureFileEntry(p, true);
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const h = handleFor(entry.slot);
  h.truncate(0);
  h.write(bytes, { at: 0 });
  h.flush();
  entry.size = bytes.byteLength;
  entry.mtimeMs = Date.now();
  persistIndex();
  notifyWatchers(normalize(p));
}

function removePath(n: string): void {
  const entry = files.get(n);
  if (entry) {
    try {
      const h = handleFor(entry.slot);
      h.truncate(0);
      h.flush();
      if (spareSlots.length < SPARE_CEILING) {
        spareSlots.push(entry.slot);
      } else {
        // Deep idle pool: hand the slot back to disk reuse instead of holding
        // an open handle for it indefinitely.
        h.close();
        slotHandles.delete(entry.slot);
        reclaimableSlots.push(entry.slot);
      }
    } catch {
      /* handle already unusable — drop the slot */
    }
    files.delete(n);
  }
}

export function unlinkSync(p: string): void {
  const n = normalize(p);
  if (!files.has(n)) throw enoent(n);
  removePath(n);
  persistIndex();
  notifyWatchers(n);
}

export function rmSync(
  p: string,
  opts?: { recursive?: boolean; force?: boolean }
): void {
  const n = normalize(p);
  if (files.has(n)) {
    removePath(n);
  } else if (dirs.has(n)) {
    const prefix = n + '/';
    for (const f of [...files.keys()]) {
      if (f.startsWith(prefix)) removePath(f);
    }
    for (const d of [...dirs]) {
      if (d === n || d.startsWith(prefix)) dirs.delete(d);
    }
  } else if (!opts?.force) {
    throw enoent(n);
  }
  persistIndex();
}

export function renameSync(from: string, to: string): void {
  const nf = normalize(from);
  const nt = normalize(to);
  const entry = files.get(nf);
  if (!entry) throw enoent(nf);
  removePathIfExists(nt);
  files.delete(nf);
  files.set(nt, entry);
  entry.mtimeMs = Date.now();
  persistIndex();
  notifyWatchers(nf);
  notifyWatchers(nt);
}

function removePathIfExists(n: string): void {
  if (files.has(n)) removePath(n);
}

export function copyFileSync(from: string, to: string): void {
  const src = files.get(normalize(from));
  if (!src) throw enoent(from);
  const data = new Uint8Array(src.size);
  handleFor(src.slot).read(data, { at: 0 });
  writeFileSync(to, data);
}

type Stats = {
  size: number;
  mtimeMs: number;
  mtime: Date;
  mode: number;
  uid: number;
  gid: number;
  isFile: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
};

function statsFor(n: string): Stats {
  const entry = files.get(n);
  if (entry) {
    return {
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      mtime: new Date(entry.mtimeMs),
      mode: 0o100600,
      uid: 0,
      gid: 0,
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    };
  }
  if (dirs.has(n)) {
    return {
      size: 0,
      mtimeMs: 0,
      mtime: new Date(0),
      mode: 0o040700,
      uid: 0,
      gid: 0,
      isFile: () => false,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    };
  }
  throw enoent(n);
}

export function statSync(p: string): Stats {
  return statsFor(normalize(p));
}

// OPFS has no symlinks, so lstat and stat are the same view.
export function lstatSync(p: string): Stats {
  return statsFor(normalize(p));
}

// OPFS is private to the origin; POSIX modes have no meaning here. Accept
// the call so the engine's private-temp hardening path stays a no-op.
export function chmodSync(p: string, _mode: number | string): void {
  const n = normalize(p);
  if (!files.has(n) && !dirs.has(n)) throw enoent(n);
}

export function statfsSync(_p: string): {
  bavail: number;
  bsize: number;
  bfree: number;
  blocks: number;
} {
  // navigator.storage.estimate() is async, so serve the last snapshot and
  // refresh in the background. Reporting a fixed "plenty free" here used to
  // disable the resource store's free-space guard entirely, which is how the
  // attachment cache reached gigabytes on a phone.
  if (Date.now() - quotaSnapshot.at > QUOTA_REFRESH_MS) refreshQuotaSnapshot();
  const bsize = 4096;
  const quota = quotaSnapshot.quota;
  if (quota <= 0) {
    // No estimate yet — stay permissive rather than blocking the first write.
    return {
      bavail: 8 * 1024 * 1024,
      bsize,
      bfree: 8 * 1024 * 1024,
      blocks: 16 * 1024 * 1024,
    };
  }
  const free = Math.max(0, quota - quotaSnapshot.usage);
  const freeBlocks = Math.floor(free / bsize);
  return {
    bavail: freeBlocks,
    bsize,
    bfree: freeBlocks,
    blocks: Math.floor(quota / bsize),
  };
}

export function openSync(p: string, flags: string): number {
  const n = normalize(p);
  const writing = /[wa+]/.test(flags);
  if (!files.has(n) && !writing) throw enoent(n);
  const entry = ensureFileEntry(n, true);
  if (flags.startsWith('w')) {
    handleFor(entry.slot).truncate(0);
    entry.size = 0;
  }
  const fd = nextFd++;
  fds.set(fd, {
    path: n,
    slot: entry.slot,
    pos: flags.startsWith('a') ? entry.size : 0,
  });
  return fd;
}

export function closeSync(fd: number): void {
  const state = fds.get(fd);
  if (!state) return;
  try {
    handleFor(state.slot).flush();
  } catch {
    /* flushing a released slot is fine to ignore */
  }
  fds.delete(fd);
  const entry = files.get(state.path);
  if (entry) {
    persistIndex();
    notifyWatchers(state.path);
  }
}

export function readSync(
  fd: number,
  buffer: Uint8Array,
  offset: number,
  length: number,
  position: number | null
): number {
  const state = fds.get(fd);
  if (!state) throw Object.assign(new Error('EBADF'), { code: 'EBADF' });
  const entry = files.get(state.path);
  if (!entry) throw enoent(state.path);
  const at = position ?? state.pos;
  const avail = Math.max(0, entry.size - at);
  const want = Math.min(length, avail);
  if (want === 0) return 0;
  const tmp = new Uint8Array(want);
  const got = handleFor(state.slot).read(tmp, { at });
  buffer.set(tmp.subarray(0, got), offset);
  if (position == null) state.pos = at + got;
  return got;
}

export function writeSync(
  fd: number,
  buffer: Uint8Array,
  offset = 0,
  length = buffer.byteLength - offset,
  position: number | null = null
): number {
  const state = fds.get(fd);
  if (!state) throw Object.assign(new Error('EBADF'), { code: 'EBADF' });
  const entry = files.get(state.path);
  if (!entry) throw enoent(state.path);
  const at = position ?? state.pos;
  const chunk = buffer.subarray(offset, offset + length);
  const wrote = handleFor(state.slot).write(chunk, { at });
  if (position == null) state.pos = at + wrote;
  entry.size = Math.max(entry.size, at + wrote);
  entry.mtimeMs = Date.now();
  return wrote;
}

export function ftruncateSync(fd: number, len = 0): void {
  const state = fds.get(fd);
  if (!state) throw Object.assign(new Error('EBADF'), { code: 'EBADF' });
  const entry = files.get(state.path);
  if (!entry) throw enoent(state.path);
  handleFor(state.slot).truncate(len);
  entry.size = len;
  entry.mtimeMs = Date.now();
}

export function fstatSync(fd: number): Stats {
  const state = fds.get(fd);
  if (!state) throw Object.assign(new Error('EBADF'), { code: 'EBADF' });
  return statsFor(state.path);
}

export type FSWatcher = { close: () => void };

export function watch(dir: string, cb: () => void): FSWatcher {
  const w: Watcher = { dir: normalize(dir), cb };
  watchers.add(w);
  return {
    close: () => {
      watchers.delete(w);
    },
  };
}

// ── promises API (thin wrappers over the sync core) ─────────────────────────

class FileHandle {
  constructor(private readonly fd: number) {}

  async read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null
  ): Promise<{ bytesRead: number; buffer: Uint8Array }> {
    const bytesRead = readSync(this.fd, buffer, offset, length, position);
    return { bytesRead, buffer };
  }

  async write(
    buffer: Uint8Array,
    offset?: number,
    length?: number,
    position?: number | null
  ): Promise<{ bytesWritten: number; buffer: Uint8Array }> {
    const bytesWritten = writeSync(
      this.fd,
      buffer,
      offset ?? 0,
      length ?? buffer.byteLength - (offset ?? 0),
      position ?? null
    );
    return { bytesWritten, buffer };
  }

  async close(): Promise<void> {
    closeSync(this.fd);
  }
}

export const promises = {
  async appendFile(p: string, data: string | Uint8Array): Promise<void> {
    const bytes =
      typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const entry = ensureFileEntry(p, true);
    handleFor(entry.slot).write(bytes, { at: entry.size });
    entry.size += bytes.byteLength;
    entry.mtimeMs = Date.now();
  },
  async open(p: string, flags = 'r'): Promise<FileHandle> {
    return new FileHandle(openSync(p, flags));
  },
  async rm(
    p: string,
    opts?: { recursive?: boolean; force?: boolean }
  ): Promise<void> {
    rmSync(p, opts);
  },
  async stat(p: string): Promise<Stats> {
    return statSync(p);
  },
  async lstat(p: string): Promise<Stats> {
    return lstatSync(p);
  },
  async chmod(p: string, mode: number | string): Promise<void> {
    chmodSync(p, mode);
  },
  async mkdir(
    p: string,
    opts?: { recursive?: boolean; mode?: number | string }
  ): Promise<string | undefined> {
    return mkdirSync(p, opts);
  },
  async readdir(p: string): Promise<string[]> {
    return readdirSync(p);
  },
  async readFile(
    p: string,
    encoding?: string | { encoding?: string }
  ): Promise<Buffer | string> {
    const enc = typeof encoding === 'string' ? encoding : encoding?.encoding;
    return enc ? readFileSync(p, enc) : readFileSync(p);
  },
  async writeFile(
    p: string,
    data: string | Uint8Array,
    _opts?: unknown
  ): Promise<void> {
    writeFileSync(p, data);
  },
  async unlink(p: string): Promise<void> {
    unlinkSync(p);
  },
};

export default {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmSync,
  renameSync,
  copyFileSync,
  statSync,
  lstatSync,
  chmodSync,
  statfsSync,
  openSync,
  closeSync,
  readSync,
  writeSync,
  ftruncateSync,
  fstatSync,
  watch,
  promises,
};
