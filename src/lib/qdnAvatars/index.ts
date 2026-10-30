/**
 * QDN avatar cache: avatars of users, Q-Apps, QDN websites and groups kept on
 * the device, with bundled icons for the most used Q-Apps.
 *
 * import { useQdnAvatar } from '../lib/qdnAvatars';
 *
 * A cached `src` is a `blob:` URL that only works in this document: never
 * send it to a Q-App iframe, a native notification, IPC or a share sheet
 * (use getQdnAvatarDataUrl). The hook's src is replaced (and the old one
 * revoked shortly after) when the image is refreshed, so do not keep it in
 * state; the non-React reads below stay valid until clearQdnAvatarCache().
 *
 * See avatarCache.ts for how fetching, freshness and eviction work.
 */
import type {
  QdnAvatarPrewarmEntry,
  QdnAvatarPrewarmResult,
  QdnAvatarPriority,
  QdnAvatarSnapshot,
} from './avatarCache';
import { getQdnAvatarCache } from './defaultCache';

export type {
  QdnAvatarPriority,
  QdnAvatarSnapshot,
  QdnAvatarStatus,
} from './avatarCache';
export {
  buildQdnAvatarUrl,
  qdnAvatarKey,
  qdnGroupAvatarIdentifier,
  QDN_AVATAR_DEFAULT_IDENTIFIER,
  type QdnAvatarKey,
} from './keys';
export { getQdnAvatarSeedUrl } from './seeds';
export {
  useQdnAvatar,
  useQdnGroupAvatar,
  type UseQdnAvatarOptions,
} from './useQdnAvatar';

type AvatarOptions = { identifier?: string | null };

type Cache = ReturnType<typeof getQdnAvatarCache>;

/** Non-React callers may keep the src: it stays valid until clear. */
function retained(cache: Cache, snapshot: QdnAvatarSnapshot) {
  if (typeof cache.retainUrl === 'function') cache.retainUrl(snapshot?.src);
  return snapshot;
}

/**
 * Current avatar src for non-React code (cached object URL, bundled seed, or
 * undefined) and a fetch in the background when needed. Synchronous. The
 * object URL stays valid until clearQdnAvatarCache(), in this document only.
 */
export function peekQdnAvatarSrc(
  name: string | null | undefined,
  options: AvatarOptions & { priority?: QdnAvatarPriority } = {}
): string | undefined {
  try {
    const cache = getQdnAvatarCache();
    const key = cache.keyFor(name, options.identifier);
    if (!key) return undefined;
    cache.request(key, { name, priority: options.priority ?? 'normal' });
    return retained(cache, cache.getSnapshot(key)).src;
  } catch {
    return undefined;
  }
}

/**
 * Asks for the avatar in the background and returns nothing, so no object URL
 * is kept alive: e.g. to move a list row that came on screen up the queue.
 * Never throws.
 */
export function requestQdnAvatar(
  name: string | null | undefined,
  options: AvatarOptions & { priority?: QdnAvatarPriority } = {}
): void {
  try {
    const cache = getQdnAvatarCache();
    const key = cache.keyFor(name, options.identifier);
    if (!key) return;
    cache.request(key, { name, priority: options.priority ?? 'normal' });
  } catch {
    // a hook showing this avatar still asks for it
  }
}

/**
 * Snapshot ({ src, status, source }) for non-React code. Synchronous, no
 * fetch. Like peekQdnAvatarSrc, its object URL stays valid until
 * clearQdnAvatarCache().
 */
export function getQdnAvatarSnapshot(
  name: string | null | undefined,
  options: AvatarOptions = {}
): QdnAvatarSnapshot {
  const cache = getQdnAvatarCache();
  return retained(
    cache,
    cache.getSnapshot(cache.keyFor(name, options.identifier))
  );
}

/**
 * Opens the device cache and loads the most used avatars into memory, so
 * they show on the first frame instead of a letter. Call it early at start-up
 * (it is also done on first use); never rejects, and gives up on storage
 * after a few seconds.
 */
export function preloadQdnAvatars(): Promise<void> {
  try {
    return getQdnAvatarCache()
      .init()
      .catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

/**
 * The avatar as a `data:` URL, e.g. for an Android notification icon. Uses
 * the cache, otherwise fetches (waiting up to `timeoutMs`, default 10 s),
 * otherwise the bundled seed (`allowSeed: false` to skip). null when none.
 */
export function getQdnAvatarDataUrl(
  name: string | null | undefined,
  options: AvatarOptions & { timeoutMs?: number; allowSeed?: boolean } = {}
): Promise<string | null> {
  return getQdnAvatarCache().getDataUrl(name, options);
}

/**
 * Low-priority background fetch of avatars GO is about to show (only names
 * already on screen or in the user's own lists). One at a time, at most
 * `limit` (default 40); stops after `maxConsecutiveFailures` (default 3).
 */
export function prewarmQdnAvatars(
  entries: QdnAvatarPrewarmEntry[],
  options: { limit?: number; maxConsecutiveFailures?: number } = {}
): Promise<QdnAvatarPrewarmResult> {
  return getQdnAvatarCache().prewarm(entries, options);
}

/**
 * Counts one use of an avatar for the eviction score. `useQdnAvatar` already
 * does this on mount; call it only where an avatar is shown without the hook.
 */
export function noteQdnAvatarUse(
  name: string | null | undefined,
  options: AvatarOptions = {}
): void {
  const cache = getQdnAvatarCache();
  cache.noteUse(cache.keyFor(name, options.identifier));
}

/**
 * Fetches the avatar again now (a fetch already running is discarded and
 * repeated), e.g. when it may have changed on another device. After the user
 * published a new avatar use putQdnAvatarImage instead: the node may still
 * serve the old file for a while.
 */
export function refreshQdnAvatar(
  name: string | null | undefined,
  options: AvatarOptions = {}
): void {
  getQdnAvatarCache().refresh(name, options);
}

/**
 * Puts an image the app already has into the cache (e.g. the avatar the user
 * just published, or a wallet avatar data URL), so it shows at once. Accepts
 * a Blob, bytes or a base64 `data:` URL. Resolves false if it is not an image
 * or over 1 MB. It wins over fetches already queued or running (which could
 * bring the old file); the node copy is checked again after about 10 min.
 */
export function putQdnAvatarImage(
  name: string | null | undefined,
  data: Blob | ArrayBuffer | ArrayBufferView | string,
  options: AvatarOptions = {}
): Promise<boolean> {
  return getQdnAvatarCache().putImage(name, data, options);
}

/**
 * Deletes every cached avatar from memory and IndexedDB (the list of names
 * shows who the user talks to). For account removal / "clear data".
 */
export function clearQdnAvatarCache(): Promise<void> {
  return getQdnAvatarCache().clear();
}
