/**
 * The app-wide avatar cache instance, created on first use (nothing runs at
 * import time). The node URL comes from utils/globalApi.ts, which registers
 * itself with setQdnAvatarApiBaseResolver: importing it here would pull
 * background/background.ts into every avatar component.
 */
import { createQdnAvatarCache, type QdnAvatarCache } from './avatarCache';
import { qdnAvatarSeedUrlForKey } from './seeds';

let instance: QdnAvatarCache | null = null;
let apiBaseResolver: (() => string) | null = null;

/**
 * Tells the cache how to read the current node URL (read at each fetch).
 * Meant for utils/globalApi.ts, like setCurrentNodeBaseResolver.
 */
export function setQdnAvatarApiBaseResolver(
  resolver: (() => string) | null
): void {
  apiBaseResolver = typeof resolver === 'function' ? resolver : null;
}

// '' until globalApi.ts has loaded: the cache then backs off, no request.
const readApiBase = (): string => (apiBaseResolver ? apiBaseResolver() : '');

export function getQdnAvatarCache(): QdnAvatarCache {
  if (!instance) {
    instance = createQdnAvatarCache({
      getApiBase: readApiBase,
      seedUrlFor: qdnAvatarSeedUrlForKey,
    });
  }
  return instance;
}

/** Tests only: swap the app-wide instance (null resets it). */
export function setQdnAvatarCacheForTests(cache: QdnAvatarCache | null): void {
  instance = cache;
}
