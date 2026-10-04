/**
 * Test helpers for the QDN avatar cache (imported by *.test.ts only): a fake
 * node, a controllable clock and timers, and fake object URLs.
 */
import {
  createQdnAvatarCache,
  type QdnAvatarCacheDeps,
  type QdnAvatarLimits,
} from './avatarCache';
import { createMemoryAvatarStore, type QdnAvatarStore } from './avatarStore';
import type { QdnAvatarKey } from './keys';

export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

export const API_BASE = 'http://node:12391';

export const imageResponse = (bytes: Uint8Array = PNG_BYTES) =>
  new Response(bytes.slice(), {
    status: 200,
    headers: { 'content-type': 'application/octet-stream' },
  });

export const notFoundResponse = (message = 'File not found') =>
  new Response(JSON.stringify({ error: 1401, message }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });

export const notPublishedResponse = (name = 'x') =>
  notFoundResponse(
    `Couldn't find PUT transaction for name ${name}, service THUMBNAIL and identifier qortal_avatar`
  );

export const statusResponse = (status: string) =>
  new Response(JSON.stringify({ status }), { status: 200 });

export type RequestKind = 'async' | 'blocking' | 'status' | 'other';

export function classifyUrl(url: string): {
  kind: RequestKind;
  name: string;
} {
  const status = /\/arbitrary\/resource\/status\/THUMBNAIL\/([^/]+)\//.exec(
    url
  );
  if (status) return { kind: 'status', name: decodeURIComponent(status[1]) };
  const avatar = /\/arbitrary\/THUMBNAIL\/([^/]+)\/[^?]+(\?async=true)?$/.exec(
    url
  );
  if (avatar) {
    return {
      kind: avatar[2] ? 'async' : 'blocking',
      name: decodeURIComponent(avatar[1]),
    };
  }
  return { kind: 'other', name: '' };
}

export const flushAsync = async (rounds = 5) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

type IdleCheckable = {
  debugState: () => {
    initStarted: boolean;
    ready: boolean;
    queued: unknown[];
    active: unknown[];
    loadingImages: number;
  };
};

/**
 * Lets every chain of async work (init, async request, status, blocking
 * request, downscale, save, image loads) finish: flushes until the cache has
 * nothing queued, running or loading, then a few rounds more. Work waiting on
 * a (fake) timer never ends; the loop gives up after `maxRounds`.
 */
export const flushUntilIdle = async (cache: IdleCheckable, maxRounds = 50) => {
  let quiet = 0;
  for (let i = 0; i < maxRounds && quiet < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const state = cache.debugState();
    const idle =
      (!state.initStarted || state.ready) &&
      !state.queued.length &&
      !state.active.length &&
      !state.loadingImages;
    quiet = idle ? quiet + 1 : 0;
  }
};

type Handler = (
  url: string,
  info: { kind: RequestKind; name: string }
) => Response | Promise<Response>;

export function createAvatarTestHarness(
  options: {
    handler?: Handler;
    store?: QdnAvatarStore;
    openStore?: () => Promise<QdnAvatarStore>;
    seeds?: Record<string, string>;
    limits?: Partial<QdnAvatarLimits>;
    startAt?: number;
    downscale?: QdnAvatarCacheDeps['downscale'];
  } = {}
) {
  let time = options.startAt ?? 1_700_000_000_000;
  let apiBase = API_BASE;
  let handler: Handler =
    options.handler ?? (() => notFoundResponse('unexpected'));
  const timers: { fn: () => void; at: number; done: boolean }[] = [];
  const calls: { url: string; kind: RequestKind; name: string }[] = [];
  const created: string[] = [];
  const revoked: string[] = [];
  let urlCounter = 0;
  const store = options.store ?? createMemoryAvatarStore();

  const fetchImpl = async (url: string) => {
    const info = classifyUrl(url);
    calls.push({ url, ...info });
    return handler(url, info);
  };

  const cache = createQdnAvatarCache({
    getApiBase: () => apiBase,
    fetch: fetchImpl,
    openStore: options.openStore ?? (async () => store),
    now: () => time,
    setTimer: (fn, ms) => {
      const timer = { fn, at: time + ms, done: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      if (handle) (handle as { done: boolean }).done = true;
    },
    createObjectUrl: () => {
      urlCounter += 1;
      const url = `blob:test/${urlCounter}`;
      created.push(url);
      return url;
    },
    revokeObjectUrl: (url) => {
      revoked.push(url);
    },
    downscale: options.downscale ?? (async (image) => image),
    seedUrlFor: (key: QdnAvatarKey) => options.seeds?.[key],
    // Exact periods unless a test asks for the per-key spread.
    limits: { refreshSpread: 0, ...options.limits },
  });

  /** Moves the clock forward and fires due timers. */
  const advance = async (ms: number) => {
    time += ms;
    for (;;) {
      const due = timers.find((timer) => !timer.done && timer.at <= time);
      if (!due) break;
      due.done = true;
      due.fn();
    }
    await flushAsync();
  };

  return {
    cache,
    store,
    calls,
    created,
    revoked,
    advance,
    now: () => time,
    setHandler: (next: Handler) => {
      handler = next;
    },
    /** Switches the node the cache talks to. */
    setApiBase: (next: string) => {
      apiBase = next;
    },
    /** Timers not fired or cleared yet. */
    pendingTimers: () => timers.filter((timer) => !timer.done).length,
    kinds: () => calls.map((call) => call.kind),
    /** flushUntilIdle for this cache. */
    idle: (maxRounds?: number) => flushUntilIdle(cache, maxRounds),
  };
}
