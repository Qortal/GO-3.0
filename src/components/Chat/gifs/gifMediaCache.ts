import { libraryGifKey, libraryGifResourceUrl } from './libraryGifs';

const CONCURRENCY = 2;
const MAX_MEMORY = 40;
const MAX_IDB_ITEMS = 20;
const MAX_IDB_BYTES = 16 * 1024 * 1024;
const DOWNLOAD_ATTEMPTS = 10;
const DB_NAME = 'qortal-library-gifs';
const STORE = 'blobs';

type GifRef = { identifier: string; name: string };

type MemoryEntry = {
  blob: Blob;
  lastAccess: number;
  url: string;
};

type StoredBlob = {
  blob: Blob;
  identifier: string;
  key: string;
  name: string;
  savedAt: number;
};

type QueueItem = {
  gif: GifRef;
  key: string;
  priority: number;
  reject: (error: Error) => void;
  resolve: (url: string) => void;
};

const memory = new Map<string, MemoryEntry>();
const inflight = new Map<string, Promise<string>>();
const waiters = new Map<string, number>();
const queue: QueueItem[] = [];
let active = 0;
let dbPromise: Promise<IDBDatabase> | null = null;

const sleep = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('No IndexedDB'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('Could not open GIF cache'));
    };
  });
  return dbPromise;
};

const idbGet = async (key: string): Promise<Blob | null> => {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => {
        const row = request.result as StoredBlob | undefined;
        resolve(row?.blob instanceof Blob ? row.blob : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
};

const idbPut = async (key: string, blob: Blob, gif: GifRef) => {
  try {
    const db = await openDb();
    const rows = await new Promise<StoredBlob[]>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () =>
        resolve(Array.isArray(request.result) ? (request.result as StoredBlob[]) : []);
      request.onerror = () => reject(request.error);
    });
    const next: StoredBlob[] = [
      ...rows.filter((row) => row.key !== key),
      {
        blob,
        identifier: gif.identifier,
        key,
        name: gif.name,
        savedAt: Date.now(),
      },
    ].sort((a, b) => b.savedAt - a.savedAt);

    let bytes = 0;
    const keep: StoredBlob[] = [];
    for (const row of next) {
      const size = row.blob?.size || 0;
      if (keep.length >= MAX_IDB_ITEMS || bytes + size > MAX_IDB_BYTES) continue;
      keep.push(row);
      bytes += size;
    }
    const keepKeys = new Set(keep.map((row) => row.key));

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      rows.forEach((row) => {
        if (!keepKeys.has(row.key)) store.delete(row.key);
      });
      const saved = keep.find((row) => row.key === key);
      if (saved) store.put(saved);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* cache is optional */
  }
};

const putMemory = (key: string, blob: Blob) => {
  const existing = memory.get(key);
  if (existing) {
    existing.blob = blob;
    existing.lastAccess = Date.now();
    return existing.url;
  }
  if (memory.size >= MAX_MEMORY) {
    const oldest = [...memory.entries()].sort(
      (a, b) => a[1].lastAccess - b[1].lastAccess
    )[0];
    if (oldest) memory.delete(oldest[0]);
  }
  const url = URL.createObjectURL(blob);
  memory.set(key, { blob, lastAccess: Date.now(), url });
  cachedListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* a listener must never fail the GIF load */
    }
  });
  return url;
};

const cachedListeners = new Set<() => void>();

/** The GIF's object URL if it is already in memory. Never downloads, never touches IndexedDB. */
export const peekLibraryGifUrl = (gif: GifRef): string | null =>
  memory.get(libraryGifKey(gif))?.url ?? null;

/** Called whenever a GIF's object URL enters memory. */
export const subscribeLibraryGifCached = (cb: () => void) => {
  cachedListeners.add(cb);
  return () => {
    cachedListeners.delete(cb);
  };
};

const downloadGifBlob = async (gif: GifRef): Promise<Blob> => {
  const gatherUrl = libraryGifResourceUrl(gif, true);
  const fileUrl = libraryGifResourceUrl(gif, false);
  void fetch(gatherUrl).catch(() => {
    /* image retries below are what matter */
  });

  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(
        attempt === 0 ? fileUrl : `${fileUrl}?r=${attempt}`
      );
      if (response.ok) {
        const blob = await response.blob();
        if (blob.size > 80) {
          const type = blob.type.startsWith('image/') ? blob.type : 'image/gif';
          return type === blob.type ? blob : new Blob([blob], { type });
        }
      }
    } catch {
      /* retry */
    }
    await sleep(700 + attempt * 250);
  }
  throw new Error('Could not load GIF');
};

const pump = () => {
  while (active < CONCURRENCY && queue.length) {
    const item = queue.shift();
    if (!item) return;
    active += 1;
    void runItem(item).finally(() => {
      active -= 1;
      pump();
    });
  }
};

const runItem = async (item: QueueItem) => {
  try {
    const cached = await idbGet(item.key);
    if (cached) {
      item.resolve(putMemory(item.key, cached));
      return;
    }
    const blob = await downloadGifBlob(item.gif);
    const url = putMemory(item.key, blob);
    void idbPut(item.key, blob, item.gif);
    item.resolve(url);
  } catch (error) {
    item.reject(
      error instanceof Error ? error : new Error('Could not load GIF')
    );
  }
};

export const requestLibraryGifUrl = (
  gif: GifRef,
  priority = 0
): Promise<string> => {
  const key = libraryGifKey(gif);
  const mem = memory.get(key);
  if (mem) {
    mem.lastAccess = Date.now();
    return Promise.resolve(mem.url);
  }
  waiters.set(key, (waiters.get(key) || 0) + 1);
  const existing = inflight.get(key);
  if (existing) {
    const queued = queue.find((item) => item.key === key);
    if (queued && priority > queued.priority) {
      queued.priority = priority;
      queue.sort((a, b) => b.priority - a.priority);
    }
    return existing;
  }

  const promise = new Promise<string>((resolve, reject) => {
    queue.push({ gif, key, priority, reject, resolve });
    queue.sort((a, b) => b.priority - a.priority);
    pump();
  });
  inflight.set(key, promise);
  void promise
    .finally(() => {
      inflight.delete(key);
      waiters.delete(key);
    })
    .catch(() => {
      /* callers attach their own handlers; this only prevents a second unhandled rejection */
    });
  return promise;
};

export const cancelLibraryGifRequest = (key: string) => {
  const remaining = (waiters.get(key) || 1) - 1;
  if (remaining > 0) {
    waiters.set(key, remaining);
    return;
  }
  waiters.delete(key);
  const index = queue.findIndex((item) => item.key === key);
  if (index < 0) return;
  const [item] = queue.splice(index, 1);
  inflight.delete(key);
  item.resolve('');
};

export const getLibraryGifBlob = async (
  gif: GifRef,
  priority = 0
): Promise<Blob> => {
  const key = libraryGifKey(gif);
  const mem = memory.get(key);
  if (mem) {
    mem.lastAccess = Date.now();
    return mem.blob;
  }
  await requestLibraryGifUrl(gif, priority);
  const next = memory.get(key);
  if (!next) throw new Error('Could not load GIF');
  return next.blob;
};

export const prefetchLibraryGifs = (gifs: GifRef[], priority = 8) => {
  gifs.forEach((gif) => {
    void requestLibraryGifUrl(gif, priority).catch(() => {
      /* prefetch is best-effort */
    });
  });
};

export const persistLibraryGif = (gif: GifRef) => {
  const entry = memory.get(libraryGifKey(gif));
  if (entry) void idbPut(libraryGifKey(gif), entry.blob, gif);
};

const aspects = new Map<string, number>();

export const rememberGifAspect = (
  gif: GifRef | string,
  width: number,
  height: number
) => {
  if (!(width > 0 && height > 0)) return;
  const key = typeof gif === 'string' ? gif : libraryGifKey(gif);
  aspects.set(key, width / height);
};

export const peekGifAspect = (gif: GifRef | string) =>
  aspects.get(typeof gif === 'string' ? gif : libraryGifKey(gif));
