import { useEffect, useState } from 'react';
import {
  buildPrivateAppOnDevice,
  canBuildPrivateAppsOnDevice,
  keepWidgetAppOnDevice,
} from '../../../plugins/PrivateQappHost';
import { getBaseApiReact } from '../../../utils/globalApi';
import { goWidgetKey } from './goWidgets';
import { buildStoredZip, type ZipEntry } from './storedZip';

/**
 * GO widgets kept on the phone (Android).
 *
 * A widget is a Q-App, and a frame on /render/APP/<name> needs the node to
 * have that app built. The public node drops apps within hours
 * (ext-node.qortal.link, Nov 2026: Q-Shop, Q-Manager and Q-Mail+ gone again
 * the same evening), so widgets sat on the node's loading page. GO keeps each
 * widget's own files (what the app published: its page, scripts, styles,
 * pictures) on the phone and serves them itself, the way it serves private
 * apps (PrivateQappHost): at an address on the node, so whatever the widget
 * asks the node for, its data, still comes from QDN as it is now.
 *
 * - The files: the node's metadata for the app lists them, and each comes
 *   unchanged from /arbitrary/APP/<name>/<identifier>?filepath=... . GO packs
 *   them into one zip (storedZip) and keeps it in IndexedDB.
 * - Once kept, the widget opens from the phone, even when the node has
 *   dropped the app.
 * - Updates: at most once an hour per widget GO asks the node for the app's
 *   latest publish time; a newer one is fetched in the background and shows
 *   from the widget's next load. The kept copy stays until a whole new one
 *   is in.
 * - An app whose metadata lists no files (some older ones) loads from the
 *   node, as before.
 */

const DB_NAME = 'go-widget-apps';
const STORE = 'apps';
export const WIDGET_APP_MAX_FILES = 400;
export const WIDGET_APP_MAX_BYTES = 20 * 1024 * 1024;
export const WIDGET_APP_CHECK_EVERY_MS = 60 * 60_000;
/** Not kept yet and the node could not give it: asked again this soon. */
export const WIDGET_APP_RETRY_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const FETCH_CONCURRENCY = 4;

type WidgetRef = { name: string; identifier: string | null };
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type StoredWidgetApp = {
  key: string;
  name: string;
  identifier: string | null;
  /** The app's publish time these files are from (updated, else created). */
  version: number;
  savedAt: number;
  files: number;
  bytes: number;
  zip: Uint8Array;
};

const defaultFetcher: Fetcher = (url, init) => fetch(url, init);

const trimBase = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

const identifierSegment = (widget: WidgetRef) =>
  encodeURIComponent(widget.identifier ?? 'default');

const sameIdentifier = (value: unknown, identifier: string | null) => {
  const normalized =
    typeof value === 'string' && value.trim() !== '' && value !== 'default'
      ? value
      : null;
  return normalized === identifier;
};

/**
 * The app's files from its metadata, as paths for the zip: "\" counts as "/"
 * (apps published from Windows list them so), Core's own .qortal folder is
 * left out. Null when it lists none, too many, or any path that would leave
 * the app.
 */
export function widgetAppFilePaths(metadata: unknown): string[] | null {
  const list =
    metadata && typeof metadata === 'object'
      ? (metadata as { files?: unknown }).files
      : null;
  if (!Array.isArray(list) || list.length === 0) return null;
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== 'string') return null;
    const path = raw
      .replace(/\\/g, '/')
      .replace(/^(\.\/)+/, '')
      .replace(/^\/+/, '');
    const parts = path.split('/');
    if (
      !path ||
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f]/.test(path) ||
      parts.some((part) => part === '' || part === '.' || part === '..')
    ) {
      return null;
    }
    if (parts[0] === '.qortal' || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  if (paths.length === 0 || paths.length > WIDGET_APP_MAX_FILES) return null;
  return paths;
}

const fetchWithTimeout = async (fetcher: Fetcher, url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetcher(url, { cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

/** The app's latest publish time on the node, or null when it cannot tell. */
export async function latestWidgetAppVersion(
  widget: WidgetRef,
  baseUrl: string,
  fetcher: Fetcher = defaultFetcher
): Promise<number | null> {
  const response = await fetchWithTimeout(
    fetcher,
    `${trimBase(baseUrl)}/arbitrary/resources/search?service=APP&name=${encodeURIComponent(
      widget.name
    )}&exactmatchnames=true&limit=0&includemetadata=false&excludeblocked=true`
  );
  if (!response.ok) return null;
  const list = await response.json();
  if (!Array.isArray(list)) return null;
  const match = list.find(
    (resource) =>
      resource &&
      resource.service === 'APP' &&
      String(resource.name).toLowerCase() === widget.name.toLowerCase() &&
      sameIdentifier(resource.identifier, widget.identifier)
  );
  const version = Number(match?.updated ?? match?.created);
  return Number.isFinite(version) && version > 0 ? version : null;
}

/** Every file the app published, from the node, packed into one zip. */
export async function downloadWidgetApp(
  widget: WidgetRef,
  baseUrl: string,
  fetcher: Fetcher = defaultFetcher
): Promise<{ zip: Uint8Array; files: number; bytes: number }> {
  const base = trimBase(baseUrl);
  const name = encodeURIComponent(widget.name);
  const metadata = await fetchWithTimeout(
    fetcher,
    `${base}/arbitrary/metadata/APP/${name}/${identifierSegment(widget)}`
  );
  if (!metadata.ok) throw new Error(`metadata ${metadata.status}`);
  const paths = widgetAppFilePaths(await metadata.json());
  if (!paths) throw new Error('no file list');

  const entries: ZipEntry[] = new Array(paths.length);
  let bytes = 0;
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < paths.length) {
      const index = next;
      next += 1;
      const path = paths[index];
      const response = await fetchWithTimeout(
        fetcher,
        `${base}/arbitrary/APP/${name}/${identifierSegment(
          widget
        )}?filepath=${encodeURIComponent(path)}`
      );
      if (!response.ok) throw new Error(`file ${response.status}`);
      const data = new Uint8Array(await response.arrayBuffer());
      bytes += data.length;
      if (bytes > WIDGET_APP_MAX_BYTES) throw new Error('too large');
      entries[index] = { path, data };
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(FETCH_CONCURRENCY, paths.length) }, () =>
        worker()
      )
    );
  } catch (error) {
    failed = true;
    throw error;
  }
  return { zip: buildStoredZip(entries), files: paths.length, bytes };
}

let dbPromise: Promise<IDBDatabase> | null = null;

const openDbAt = (version?: number): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request =
      version === undefined
        ? indexedDB.open(DB_NAME)
        : indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB');
    const db = await openDbAt();
    if (db.objectStoreNames.contains(STORE)) return db;
    // Opened before by something that made no store: one version up adds it.
    const version = db.version + 1;
    db.close();
    return openDbAt(version);
  })().catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
};

const inStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest
): Promise<T> => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
};

export const readStoredWidgetApp = (
  key: string
): Promise<StoredWidgetApp | null> =>
  inStore<StoredWidgetApp | undefined>('readonly', (store) => store.get(key))
    .then((record) => record ?? null)
    .catch(() => null);

const writeStoredWidgetApp = (record: StoredWidgetApp) =>
  inStore('readwrite', (store) => store.put(record));

const lastCheck = new Map<string, number>();
const running = new Map<string, Promise<boolean>>();

/**
 * Fetches the widget's app from the node onto the phone when there is no
 * copy yet or the node has a newer publish. True when a new copy was kept.
 * Never throws: the widget keeps what it shows.
 */
export function refreshWidgetAppOnDevice(
  widget: WidgetRef,
  {
    baseUrl = getBaseApiReact(),
    fetcher = defaultFetcher,
    now = Date.now(),
  }: { baseUrl?: string; fetcher?: Fetcher; now?: number } = {}
): Promise<boolean> {
  if (!canBuildPrivateAppsOnDevice()) return Promise.resolve(false);
  const key = goWidgetKey(widget);
  const current = running.get(key);
  if (current) return current;
  if (now - (lastCheck.get(key) ?? -Infinity) < WIDGET_APP_CHECK_EVERY_MS) {
    return Promise.resolve(false);
  }
  lastCheck.set(key, now);
  const job = (async () => {
    const stored = await readStoredWidgetApp(key);
    const latest = await latestWidgetAppVersion(widget, baseUrl, fetcher).catch(
      () => null
    );
    if (stored && (latest === null || stored.version >= latest)) return false;
    try {
      const { zip, files, bytes } = await downloadWidgetApp(
        widget,
        baseUrl,
        fetcher
      );
      await writeStoredWidgetApp({
        key,
        name: widget.name,
        identifier: widget.identifier ?? null,
        version: latest ?? now,
        savedAt: Date.now(),
        files,
        bytes,
        zip,
      });
      return true;
    } catch {
      // Nothing kept yet: ask again soon rather than in an hour.
      if (!stored) {
        lastCheck.set(
          key,
          now - WIDGET_APP_CHECK_EVERY_MS + WIDGET_APP_RETRY_MS
        );
      }
      return false;
    }
  })()
    .catch(() => false)
    .finally(() => running.delete(key));
  running.set(key, job);
  return job;
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
};

type Built = { id: string; url: string; version: number; baseUrl: string };
/** This page's apps built from kept copies (the native side keeps them). */
const built = new Map<string, Built>();

/**
 * The address of the widget's app served from the phone, or null when no
 * copy is kept (it loads from the node).
 */
export async function openWidgetAppOnDevice(
  widget: WidgetRef,
  baseUrl: string = getBaseApiReact()
): Promise<string | null> {
  if (!canBuildPrivateAppsOnDevice()) return null;
  const key = goWidgetKey(widget);
  const stored = await readStoredWidgetApp(key);
  if (!stored) return null;
  const have = built.get(key);
  if (have && have.version === stored.version && have.baseUrl === baseUrl) {
    return have.url;
  }
  const { id, url } = await buildPrivateAppOnDevice(
    baseUrl,
    bytesToBase64(stored.zip)
  );
  if (have) keepWidgetAppOnDevice(have.id, false);
  keepWidgetAppOnDevice(id, true);
  built.set(key, { id, url, version: stored.version, baseUrl });
  return url;
}

/** Drops what the phone keeps for widgets no longer on the screen. */
export async function pruneWidgetAppsOnDevice(
  keys: Iterable<string>
): Promise<void> {
  if (!canBuildPrivateAppsOnDevice()) return;
  const keep = new Set(keys);
  for (const [key, entry] of built) {
    if (keep.has(key)) continue;
    built.delete(key);
    keepWidgetAppOnDevice(entry.id, false);
  }
  try {
    const stored = await inStore<IDBValidKey[]>('readonly', (store) =>
      store.getAllKeys()
    );
    for (const key of stored) {
      if (!keep.has(String(key))) {
        await inStore('readwrite', (store) => store.delete(key));
      }
    }
  } catch {
    // No IndexedDB: nothing was kept either.
  }
}

export type WidgetAppSource =
  | { kind: 'checking' }
  | { kind: 'device'; url: string }
  | { kind: 'node' };

/**
 * Where a widget loads from: its kept copy on the phone when there is one,
 * else the node. Checked again on each reload, so a copy fetched in the
 * background shows from then on.
 */
export function useWidgetAppSource(
  widget: WidgetRef,
  reloadKey: number
): WidgetAppSource {
  const [source, setSource] = useState<WidgetAppSource>(() =>
    canBuildPrivateAppsOnDevice() ? { kind: 'checking' } : { kind: 'node' }
  );
  useEffect(() => {
    if (!canBuildPrivateAppsOnDevice()) return undefined;
    let alive = true;
    openWidgetAppOnDevice(widget).then(
      (url) => {
        if (alive) setSource(url ? { kind: 'device', url } : { kind: 'node' });
      },
      () => {
        if (alive) setSource({ kind: 'node' });
      }
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.name, widget.identifier, reloadKey]);
  return source;
}

/** Test hook: forget this page's state between cases. */
export function resetWidgetAppsOnDeviceForTests(): void {
  lastCheck.clear();
  running.clear();
  built.clear();
  dbPromise = null;
}
