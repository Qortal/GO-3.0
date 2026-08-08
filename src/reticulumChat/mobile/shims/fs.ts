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
const SPARE_TARGET = 24;
const SPARE_MIN = 6;

let rootDir: FileSystemDirectoryHandle | null = null;
let metaHandle: FileSystemSyncAccessHandle | null = null;

const files = new Map<string, IndexEntry>();
const dirs = new Set<string>(['/']);
const slotHandles = new Map<number, FileSystemSyncAccessHandle>();
const spareSlots: number[] = [];
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

function persistIndex(): void {
  if (!metaHandle) return;
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

function scheduleTopUp(): void {
  if (topUpInFlight || spareSlots.length >= SPARE_MIN) return;
  topUpInFlight = true;
  void (async () => {
    try {
      while (spareSlots.length < SPARE_TARGET) {
        const slot = nextSlot++;
        const handle = await openSlotHandle(slot);
        slotHandles.set(slot, handle);
        spareSlots.push(slot);
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

  // Open handles for every indexed file up-front (sync APIs cannot await).
  for (const [p, entry] of files) {
    try {
      slotHandles.set(entry.slot, await openSlotHandle(entry.slot));
    } catch (err) {
      console.warn(`[mobile-fs] dropping unopenable file ${p}`, err);
      files.delete(p);
    }
  }
  // Pre-provision spares synchronously with init so first writes never fail.
  while (spareSlots.length < SPARE_TARGET) {
    const slot = nextSlot++;
    slotHandles.set(slot, await openSlotHandle(slot));
    spareSlots.push(slot);
  }
  persistIndex();
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

export function writeFileSync(
  p: string,
  data: string | Uint8Array
): void {
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
      spareSlots.push(entry.slot);
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
  // OPFS quota is opaque synchronously; report ample space and let the
  // resource store's own byte-budget policy be the real limiter.
  return { bavail: 8 * 1024 * 1024, bsize: 4096, bfree: 8 * 1024 * 1024, blocks: 16 * 1024 * 1024 };
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
