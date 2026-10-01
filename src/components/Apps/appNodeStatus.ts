import { useEffect, useSyncExternalStore } from 'react';
import { createEndpoint } from '../../background/background';

/**
 * Whether a Q-App is on the node, for the library's Open / Download buttons.
 *
 * The `status` in `/arbitrary/resources/search?includestatus=true` is a value
 * Core stored when the resource last changed state; it is not refreshed when
 * the node later drops the built copy or deletes the chunks. Measured on
 * ext-node.qortal.link (Sep 2026): of 34 apps listed READY only 6 were, and
 * 19 listed BUILDING or DOWNLOADED were really on the node. The per-resource
 * `/arbitrary/resource/status` endpoint works it out on every call, so the
 * library asks it about the apps on screen, a few at a time.
 */

export type AppAvailability =
  /** On the node: opens straight away (at most a short build). */
  | 'ready'
  /** The node is fetching it now. */
  | 'downloading'
  /** Opening it makes the node download it first. */
  | 'not_on_node'
  /** No live answer yet, and the list's value cannot be trusted. */
  | 'checking';

export interface AppNodeStatus {
  availability: AppAvailability;
  /** 0-100 while downloading, when the node reports chunk counts. */
  percent: number | null;
}

interface Entry {
  status: string | null;
  percent: number | null;
  checkedAt: number;
  /** The node refused or failed; fall back to the list's value. */
  failed: boolean;
}

interface AppRef {
  service?: string;
  name?: string;
  status?: { status?: string } | null;
}

const FRESH_MS = 5 * 60_000;
const FAILED_RETRY_MS = 60_000;
/** Rows flung past during a fast scroll are never asked about. */
const SETTLE_MS = 300;
const MAX_CONCURRENT = 4;
const WATCH_INTERVALS_MS = [2_000, 3_000, 5_000];
const WATCH_MAX_MS = 3 * 60_000;

const ON_NODE = new Set(['READY', 'DOWNLOADED', 'BUILDING']);

export const classifyNodeStatus = (
  status: string | null | undefined
): AppAvailability => {
  if (!status) return 'checking';
  if (ON_NODE.has(status)) return 'ready';
  if (status === 'DOWNLOADING') return 'downloading';
  return 'not_on_node';
};

/**
 * Before the live answer arrives: a listed PUBLISHED is nearly always right
 * (the node never had the data), anything else is too often stale to show.
 */
const classifyListStatus = (
  status: string | null | undefined
): AppAvailability =>
  status === 'PUBLISHED' || status === 'NOT_PUBLISHED'
    ? 'not_on_node'
    : 'checking';

const keyOf = (service: string, name: string) => `${service}\u0000${name}`;

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const anyListeners = new Set<() => void>();
let version = 0;
const mounted = new Map<string, number>();
const inFlight = new Set<string>();
/** Newest last: what the user just scrolled to is asked about first. */
const queue: Array<{ key: string; service: string; name: string }> = [];
const watches = new Map<string, ReturnType<typeof setTimeout>>();
let running = 0;

const notify = (key: string) => {
  version++;
  listeners.get(key)?.forEach((listener) => listener());
  anyListeners.forEach((listener) => listener());
};

const setEntry = (key: string, entry: Entry) => {
  entries.set(key, entry);
  notify(key);
};

const toPercent = (json: any): number | null => {
  if (typeof json?.percentLoaded === 'number') {
    return Math.max(0, Math.min(100, Math.round(json.percentLoaded)));
  }
  const local = Number(json?.localChunkCount);
  const total = Number(json?.totalChunkCount);
  if (total > 0 && local >= 0) {
    return Math.max(0, Math.min(100, Math.round((local / total) * 100)));
  }
  return null;
};

const readNodeStatus = async (service: string, name: string) => {
  const endpoint = await createEndpoint(
    `/arbitrary/resource/status/${encodeURIComponent(service)}/${encodeURIComponent(name)}`
  );
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`status ${response.status}`);
  return response.json();
};

const fetchNow = async (key: string, service: string, name: string) => {
  inFlight.add(key);
  try {
    const json = await readNodeStatus(service, name);
    const status = typeof json?.status === 'string' ? json.status : null;
    setEntry(key, {
      checkedAt: Date.now(),
      failed: !status,
      percent: status === 'DOWNLOADING' ? toPercent(json) : null,
      status,
    });
  } catch {
    const previous = entries.get(key);
    setEntry(key, {
      checkedAt: Date.now(),
      failed: true,
      percent: previous?.percent ?? null,
      status: previous?.status ?? null,
    });
  } finally {
    inFlight.delete(key);
  }
};

const pump = () => {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.pop()!;
    // Scrolled away before its turn: not worth a request any more.
    if (!mounted.get(job.key) && !watches.has(job.key)) continue;
    if (inFlight.has(job.key)) continue;
    running++;
    void fetchNow(job.key, job.service, job.name).finally(() => {
      running--;
      pump();
    });
  }
};

const enqueue = (key: string, service: string, name: string) => {
  if (inFlight.has(key)) return;
  const index = queue.findIndex((job) => job.key === key);
  if (index !== -1) queue.splice(index, 1);
  queue.push({ key, name, service });
  pump();
};

const isStale = (entry: Entry | undefined) =>
  !entry ||
  Date.now() - entry.checkedAt > (entry.failed ? FAILED_RETRY_MS : FRESH_MS);

const subscribe = (key: string, listener: () => void) => {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(key);
  };
};

const NO_KEY_SUBSCRIBE = () => () => {};

/**
 * Re-checks one app until the node has it: started when the app is opened,
 * so its button turns into Open once the download finishes, even while the
 * library is not on screen. It stops at DOWNLOADED too: the build only runs
 * while the app's loading page is open, and Open is already the right label.
 */
export const watchAppNodeStatus = (service?: string, name?: string) => {
  if (!service || !name) return;
  const key = keyOf(service, name);
  const existing = watches.get(key);
  if (existing) clearTimeout(existing);
  const startedAt = Date.now();
  let attempt = 0;

  const tick = async () => {
    await fetchNow(key, service, name);
    const entry = entries.get(key);
    const done =
      classifyNodeStatus(entry?.status) === 'ready' ||
      Date.now() - startedAt > WATCH_MAX_MS;
    if (done) {
      watches.delete(key);
      return;
    }
    const delay =
      WATCH_INTERVALS_MS[Math.min(attempt++, WATCH_INTERVALS_MS.length - 1)];
    watches.set(key, setTimeout(tick, delay));
  };

  watches.set(key, setTimeout(tick, WATCH_INTERVALS_MS[0]));
};

/** After a manual refresh: everything on screen is asked again. */
export const invalidateAppNodeStatuses = () => {
  for (const [key, entry] of entries) {
    entries.set(key, { ...entry, checkedAt: 0 });
    notify(key);
  }
};

/**
 * For filtering: the live answer where there is one, otherwise the list's
 * value read generously (a filter cannot wait for a spinner).
 */
export const isAppProbablyOnNode = (app: AppRef | null | undefined) => {
  const availability = getAppAvailability(app);
  if (availability !== 'checking') return availability === 'ready';
  const listed = app?.status?.status;
  return !!listed && ON_NODE.has(listed);
};

const subscribeAny = (listener: () => void) => {
  anyListeners.add(listener);
  return () => anyListeners.delete(listener);
};
const NO_SUBSCRIBE = () => () => {};

/** Changes whenever any live status arrives; for lists filtered by it. */
export const useAppNodeStatusVersion = (enabled: boolean) =>
  useSyncExternalStore(enabled ? subscribeAny : NO_SUBSCRIBE, () =>
    enabled ? version : 0
  );

/** Whether the app is on the node, from the live status when there is one. */
export const getAppAvailability = (app: AppRef | null | undefined) => {
  if (!app?.service || !app?.name) return 'not_on_node' as AppAvailability;
  const entry = entries.get(keyOf(app.service, app.name));
  if (entry?.status && !entry.failed) return classifyNodeStatus(entry.status);
  if (entry?.failed) {
    // The node would not say; the list's value is the best there is.
    const listed = entry.status ?? app.status?.status;
    return listed && ON_NODE.has(listed) ? 'ready' : 'not_on_node';
  }
  return classifyListStatus(app.status?.status);
};

export const useAppNodeStatus = (
  app: AppRef | null | undefined
): AppNodeStatus => {
  const service = app?.service;
  const name = app?.name;
  const key = service && name ? keyOf(service, name) : null;

  const entry = useSyncExternalStore(
    key ? (listener) => subscribe(key, listener) : NO_KEY_SUBSCRIBE,
    () => (key ? entries.get(key) : undefined)
  );

  useEffect(() => {
    if (!key) return;
    mounted.set(key, (mounted.get(key) ?? 0) + 1);
    return () => {
      const count = (mounted.get(key) ?? 1) - 1;
      if (count > 0) mounted.set(key, count);
      else mounted.delete(key);
    };
  }, [key]);

  const stale = isStale(entry);
  useEffect(() => {
    if (!key || !stale) return;
    const timer = setTimeout(() => enqueue(key, service!, name!), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [key, name, service, stale]);

  return {
    availability: getAppAvailability(app),
    percent: entry?.status === 'DOWNLOADING' ? entry.percent : null,
  };
};

/** Test hook: forget everything between cases. */
export const resetAppNodeStatusForTests = () => {
  entries.clear();
  listeners.clear();
  anyListeners.clear();
  version = 0;
  mounted.clear();
  inFlight.clear();
  queue.length = 0;
  watches.forEach((timer) => clearTimeout(timer));
  watches.clear();
  running = 0;
};
