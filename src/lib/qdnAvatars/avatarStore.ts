/**
 * Persistent storage for the QDN avatar cache: IndexedDB when available, an
 * in-memory map otherwise (tests, private mode, a blocked or broken IDB).
 *
 * Two object stores keep startup cheap: `meta` (small records, all read once
 * at start) and `images` (the bytes, read one key at a time when an avatar is
 * first shown). Nothing else is stored: no addresses, no node URLs.
 */
import type { QdnAvatarKey } from './keys';

const QDN_AVATAR_DB_NAME = 'go-qdn-avatars';
const DB_VERSION = 1;
const META_STORE = 'meta';
const IMAGE_STORE = 'images';

/**
 * One cached avatar. The key holds the (lower-cased) name and identifier;
 * nothing else about the user is stored.
 */
export type QdnAvatarMeta = {
  key: QdnAvatarKey;
  /** Image size in bytes; 0 when there is no image. */
  size: number;
  /** Last time the node confirmed this image (or that it is missing). */
  fetchedAt: number;
  lastUsedAt: number;
  useCount: number;
  /** The node confirmed this name has no avatar. */
  missing?: boolean;
  missingCheckedAt?: number;
  /**
   * Short hash of the node that said "missing" (not the URL): the answer is
   * not trusted on another node, which may be better synced.
   */
  missingNode?: string;
};

export type QdnAvatarStoredImage = {
  key: QdnAvatarKey;
  bytes: ArrayBuffer;
  type: string;
};

export interface QdnAvatarStore {
  readonly kind: 'indexeddb' | 'memory';
  loadAllMeta(): Promise<QdnAvatarMeta[]>;
  loadImages(
    keys: QdnAvatarKey[]
  ): Promise<Map<QdnAvatarKey, QdnAvatarStoredImage>>;
  /** Writes a record; `image` replaces the bytes, `null` deletes them. */
  putEntry(
    meta: QdnAvatarMeta,
    image?: QdnAvatarStoredImage | null
  ): Promise<void>;
  putMetas(metas: QdnAvatarMeta[]): Promise<void>;
  deleteEntries(keys: QdnAvatarKey[]): Promise<void>;
  clear(): Promise<void>;
  /** Releases the database handle (a store opened too late is dropped). */
  close?(): void;
}

/** Store that lives only as long as the page. */
export function createMemoryAvatarStore(): QdnAvatarStore {
  const metas = new Map<QdnAvatarKey, QdnAvatarMeta>();
  const images = new Map<QdnAvatarKey, QdnAvatarStoredImage>();
  return {
    kind: 'memory',
    async loadAllMeta() {
      return Array.from(metas.values(), (meta) => ({ ...meta }));
    },
    async loadImages(keys) {
      const found = new Map<QdnAvatarKey, QdnAvatarStoredImage>();
      for (const key of keys) {
        const image = images.get(key);
        if (image) found.set(key, image);
      }
      return found;
    },
    async putEntry(meta, image) {
      metas.set(meta.key, { ...meta });
      if (image) images.set(meta.key, image);
      else if (image === null) images.delete(meta.key);
    },
    async putMetas(list) {
      for (const meta of list) metas.set(meta.key, { ...meta });
    },
    async deleteEntries(keys) {
      for (const key of keys) {
        metas.delete(key);
        images.delete(key);
      }
    },
    async clear() {
      metas.clear();
      images.clear();
    },
    close() {},
  };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        db.createObjectStore(IMAGE_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

/**
 * Opens the IndexedDB store, or resolves null when IndexedDB is missing or
 * refuses to open (callers then use the memory store).
 */
export async function openIndexedDbAvatarStore(
  options: { factory?: IDBFactory | null; name?: string } = {}
): Promise<QdnAvatarStore | null> {
  const factory =
    options.factory !== undefined
      ? options.factory
      : typeof indexedDB !== 'undefined'
        ? indexedDB
        : null;
  if (!factory) return null;
  let db: IDBDatabase;
  try {
    db = await openDatabase(factory, options.name ?? QDN_AVATAR_DB_NAME);
  } catch {
    return null;
  }
  // Another context upgrading the schema: let it, and stop using this handle.
  db.onversionchange = () => db.close();

  const tx = (stores: string[], mode: IDBTransactionMode) =>
    db.transaction(stores, mode);

  return {
    kind: 'indexeddb',
    async loadAllMeta() {
      const store = tx([META_STORE], 'readonly').objectStore(META_STORE);
      const rows = await requestToPromise(store.getAll());
      return Array.isArray(rows) ? (rows as QdnAvatarMeta[]) : [];
    },
    async loadImages(keys) {
      const found = new Map<QdnAvatarKey, QdnAvatarStoredImage>();
      if (!keys.length) return found;
      const store = tx([IMAGE_STORE], 'readonly').objectStore(IMAGE_STORE);
      const rows = await Promise.all(
        keys.map((key) =>
          requestToPromise(store.get(key)).catch(() => undefined)
        )
      );
      rows.forEach((row, index) => {
        const image = row as QdnAvatarStoredImage | undefined;
        if (image && image.bytes && typeof image.type === 'string') {
          found.set(keys[index], image);
        }
      });
      return found;
    },
    async putEntry(meta, image) {
      const transaction = tx([META_STORE, IMAGE_STORE], 'readwrite');
      transaction.objectStore(META_STORE).put(meta);
      if (image) transaction.objectStore(IMAGE_STORE).put(image);
      else if (image === null) {
        transaction.objectStore(IMAGE_STORE).delete(meta.key);
      }
      await transactionDone(transaction);
    },
    async putMetas(metas) {
      if (!metas.length) return;
      const transaction = tx([META_STORE], 'readwrite');
      const store = transaction.objectStore(META_STORE);
      for (const meta of metas) store.put(meta);
      await transactionDone(transaction);
    },
    async deleteEntries(keys) {
      if (!keys.length) return;
      const transaction = tx([META_STORE, IMAGE_STORE], 'readwrite');
      for (const key of keys) {
        transaction.objectStore(META_STORE).delete(key);
        transaction.objectStore(IMAGE_STORE).delete(key);
      }
      await transactionDone(transaction);
    },
    async clear() {
      const transaction = tx([META_STORE, IMAGE_STORE], 'readwrite');
      transaction.objectStore(META_STORE).clear();
      transaction.objectStore(IMAGE_STORE).clear();
      await transactionDone(transaction);
    },
    close() {
      try {
        db.close();
      } catch {
        // already closed
      }
    },
  };
}

/** IndexedDB store when it opens, otherwise the memory store. */
export async function openQdnAvatarStore(
  options: { factory?: IDBFactory | null; name?: string } = {}
): Promise<QdnAvatarStore> {
  return (await openIndexedDbAvatarStore(options)) ?? createMemoryAvatarStore();
}
