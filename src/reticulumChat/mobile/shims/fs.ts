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
const SPARE_MIN = 64;
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
    console.warn('[mobile-fs] failed to persist index', err);
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

/** Opens handles in parallel batches; one-at-a-time is far too slow at boot. */
async function openSlots(slots: number[]): Promise<number[]> {
  const opened: number[] = [];
  for (let i = 0; i < slots.length; i += SLOT_BATCH) {
    const batch = slots.slice(i, i + SLOT_BATCH);
    const handles = await Promise.all(
      batch.map((slot) =>
        openSlotHandle(slot).then(
          (handle) => ({ slot, handle }),
          (err) => {
            console.warn(`[mobile-fs] could not open slot ${slot}`, err);
            return null;
          }
        )
      )
    );
    for (const entry of handles) {
      if (!entry) continue;
      slotHandles.set(entry.slot, entry.handle);
      opened.push(entry.slot);
    }
  }
  return opened;
}

/**
 * How hard a file fights to keep its handle. Staging temp files are recreated
 * on the next import, and a resource's range map or half-finished download can
 * be re-derived by downloading again — but an assembled blob may be the only
 * copy of something this device published, so it is evicted last.
 */
function keepRank(path: string): number {
  if (path.startsWith('/tmp/')) return 0;
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

function scheduleTopUp(): void {
  if (topUpInFlight || spareSlots.length >= SPARE_MIN) return;
  topUpInFlight = true;
  void (async () => {
    try {
      while (spareSlots.length < SPARE_TARGET) {
        const wanted = SPARE_TARGET - spareSlots.length;
        const opened = await openSlots(nextFreeSlots(wanted));
        if (opened.length === 0) break;
        spareSlots.push(...opened);
      }
      persistIndex();
    } catch (err) {
      console.warn('[mobile-fs] handle top-up failed', err);
    } finally {
      topUpInFlight = false;
    }
  })();
}

function takeSpareSlot(): number {
  const slot = spareSlots.pop();
  scheduleTopUp();
  if (slot === undefined) {
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
      console.warn('[mobile-fs] index corrupt; starting fresh', err);
    }
  }

  const evicted = evictOldestBeyondCap();
  if (evicted > 0) {
    console.warn(
      `[mobile-fs] dropped ${evicted} stale blobs to stay under ${MAX_INDEXED_FILES} open handles`
    );
  }

  // Open handles for every indexed file up-front (sync APIs cannot await).
  const referenced = new Map<number, string>();
  for (const [p, entry] of files) referenced.set(entry.slot, p);
  const opened = new Set(await openSlots([...referenced.keys()]));
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
    console.warn('[mobile-fs] could not enumerate slot files', err);
  }

  // Pre-provision spares with init so the first burst of writes never fails.
  spareSlots.push(...(await openSlots(nextFreeSlots(SPARE_TARGET))));
  writeIndexNow();
  refreshQuotaSnapshot();
  scheduleOrphanSlotCleanup();
}

// ── sync API ─────────────────────────────────────────────────────────────────

export function existsSync(p: string): boolean {
  const n = normalize(p);
  return files.has(n) || dirs.has(n);
}

export function mkdirSync(
  p: string,
  _opts?: { recursive?: boolean }
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
  isFile: () => boolean;
  isDirectory: () => boolean;
};

function statsFor(n: string): Stats {
  const entry = files.get(n);
  if (entry) {
    return {
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      mtime: new Date(entry.mtimeMs),
      isFile: () => true,
      isDirectory: () => false,
    };
  }
  if (dirs.has(n)) {
    return {
      size: 0,
      mtimeMs: 0,
      mtime: new Date(0),
      isFile: () => false,
      isDirectory: () => true,
    };
  }
  throw enoent(n);
}

export function statSync(p: string): Stats {
  return statsFor(normalize(p));
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
