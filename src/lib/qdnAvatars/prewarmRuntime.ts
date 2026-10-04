/**
 * The avatar prewarm itself, loaded on demand by useQdnAvatarPrewarm after
 * login, so none of this (nor the avatar cache) weighs on app startup.
 */
import { isPublicNodeUnavailableAtom, userInfoAtom } from '../../atoms/global';
import { getWalletAvatarCache } from '../../utils/walletAvatarCache';
import type { QdnAvatarPrewarmEntry } from './avatarCache';
import { getQdnAvatarCache } from './defaultCache';
import { prewarmQdnAvatars, putQdnAvatarImage } from './index';
import type { QdnAvatarPrewarmAppLike } from './prewarmPlan';
import {
  createQdnAvatarPrewarmScheduler,
  type QdnAvatarPrewarmTiming,
} from './prewarmScheduler';
import {
  collectQdnAvatarPrewarmEntries,
  type QdnAvatarPrewarmStore,
} from './prewarmSources';

type Cache = ReturnType<typeof getQdnAvatarCache>;

const keyOfEntry = (cache: Cache, entry: QdnAvatarPrewarmEntry) => {
  const name = typeof entry === 'string' ? entry : entry?.name;
  const identifier = typeof entry === 'string' ? undefined : entry?.identifier;
  return cache.keyFor(name, identifier);
};

/**
 * The cache's queue as the prewarm needs it. The cache has no public
 * accessors for this yet, so it reads the diagnostic view (debugState);
 * prewarmRuntime.test.ts fails if that view changes shape. null when it is
 * not available: callers then assume nothing is pending.
 */
function readQueue(
  cache: Cache
): { active: Set<string>; queued: Set<string> } | null {
  const debug =
    typeof cache.debugState === 'function' ? cache.debugState() : null;
  if (!debug || !Array.isArray(debug.queued) || !Array.isArray(debug.active)) {
    return null;
  }
  const queued = new Set<string>();
  for (const job of debug.queued) {
    if (typeof job?.key === 'string') queued.add(job.key);
  }
  return {
    active: new Set(debug.active.filter((key) => typeof key === 'string')),
    queued,
  };
}

/**
 * True while the cache still has `entry` queued or running: a visible screen
 * is fetching it, or prewarm() stopped waiting (after about 42 s) although
 * on a slow node with busy lists its job may simply not have had a slot yet.
 */
export function isQdnAvatarPrewarmEntryPending(
  entry: QdnAvatarPrewarmEntry
): boolean {
  try {
    const cache = getQdnAvatarCache();
    const key = keyOfEntry(cache, entry);
    if (!key) return false;
    const queue = readQueue(cache);
    return !!queue && (queue.active.has(key) || queue.queued.has(key));
  } catch {
    return false;
  }
}

/** True while the cache has any avatar queued or running. */
export function qdnAvatarCacheHasWork(): boolean {
  try {
    const queue = readQueue(getQdnAvatarCache());
    return !!queue && (queue.active.size > 0 || queue.queued.size > 0);
  } catch {
    return false;
  }
}

/**
 * Drops the queued prewarm job for `entry` (lock, logout, account switch),
 * when the cache offers `cancelPrewarm(key)`; a no-op otherwise.
 */
export function cancelQdnAvatarPrewarmEntry(
  entry: QdnAvatarPrewarmEntry
): void {
  try {
    const cache = getQdnAvatarCache();
    const key = keyOfEntry(cache, entry);
    const cancel = (cache as { cancelPrewarm?: (key: string) => unknown })
      .cancelPrewarm;
    if (key && typeof cancel === 'function') cancel.call(cache, key);
  } catch {
    // best effort
  }
}

/**
 * Which avatars the device cache has a record of (an image or a confirmed
 * "missing"): GO showed them here before. Read once per run.
 */
export async function readCachedQdnAvatarChecker(): Promise<
  (name: string) => boolean
> {
  try {
    const cache = getQdnAvatarCache();
    await cache.init();
    const debug =
      typeof cache.debugState === 'function' ? cache.debugState() : null;
    const keys = new Set<string>();
    for (const meta of Array.isArray(debug?.metas) ? debug.metas : []) {
      if (typeof meta?.key === 'string') keys.add(meta.key);
    }
    return (name) => {
      const key = cache.keyFor(name);
      return !!key && keys.has(key);
    };
  } catch {
    return () => false;
  }
}

/** Status only: getQdnAvatarSnapshot would retain the object URL. */
const ownStatus = (name: string) => {
  const cache = getQdnAvatarCache();
  return cache.getSnapshot(cache.keyFor(name)).status;
};

/**
 * When the own avatar could not be fetched (slow or unreachable node), use
 * the copy GO keeps for the account picker, so the user's own avatar shows
 * everywhere. A cached, loading or confirmed-missing avatar is left alone,
 * and so is a picker copy not saved for exactly this name (older copies
 * carry no name and may show a previous avatar).
 */
export async function seedOwnQdnAvatarFromWalletCache(
  store: QdnAvatarPrewarmStore,
  address: string
): Promise<boolean> {
  try {
    const userInfo = store.get(userInfoAtom) as any;
    const name = typeof userInfo?.name === 'string' ? userInfo.name.trim() : '';
    if (!name || userInfo?.address !== address) return false;
    if (ownStatus(name) !== 'failed') return false;
    const cached = await getWalletAvatarCache(address, name);
    const cachedName =
      typeof cached?.primaryName === 'string' ? cached.primaryName.trim() : '';
    if (!cached?.dataUrl || cachedName.toLowerCase() !== name.toLowerCase()) {
      return false;
    }
    // It may have arrived (or the account changed) while the copy was read.
    if ((store.get(userInfoAtom) as any)?.address !== address) return false;
    if (ownStatus(name) !== 'failed') return false;
    return await putQdnAvatarImage(name, cached.dataUrl);
  } catch {
    return false;
  }
}

export type StartQdnAvatarPrewarmOptions = {
  store: QdnAvatarPrewarmStore;
  /** Signed-in wallet address. */
  account: string;
  /** The live open tabs of this account. */
  getOpenTabs: () => QdnAvatarPrewarmAppLike[];
  timing?: Partial<QdnAvatarPrewarmTiming>;
};

/** Starts the background prewarm for `account`; returns its stop function. */
export function startQdnAvatarPrewarm({
  store,
  account,
  getOpenTabs,
  timing,
}: StartQdnAvatarPrewarmOptions): () => void {
  let stopped = false;
  let seeding: Promise<void> | null = null;
  // Not tied to a completed run: also while offline or the node is down
  // (no run at all), which is when the picker copy matters most.
  const seedOwn = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (!seeding) {
      seeding = seedOwnQdnAvatarFromWalletCache(store, account)
        .then(
          () => undefined,
          () => undefined
        )
        .finally(() => {
          seeding = null;
        });
    }
    return seeding;
  };

  const scheduler = createQdnAvatarPrewarmScheduler({
    account,
    collect: async () =>
      collectQdnAvatarPrewarmEntries(store, account, {
        getOpenTabs,
        isCachedAvatar: await readCachedQdnAvatarChecker(),
      }),
    prewarmOne: (entry) =>
      prewarmQdnAvatars([entry], { limit: 1, maxConsecutiveFailures: 1 }),
    isPending: isQdnAvatarPrewarmEntryPending,
    hasOtherWork: qdnAvatarCacheHasWork,
    cancelPending: cancelQdnAvatarPrewarmEntry,
    onWake: seedOwn,
    afterRun: seedOwn,
    isNodeUnavailable: () => {
      try {
        return store.get(isPublicNodeUnavailableAtom) === true;
      } catch {
        return false;
      }
    },
    timing,
  });
  scheduler.start();
  return () => {
    stopped = true;
    scheduler.stop();
  };
}
