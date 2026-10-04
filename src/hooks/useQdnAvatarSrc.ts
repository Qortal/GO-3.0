import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { UseQdnAvatarOptions } from '../lib/qdnAvatars';
import { getQdnAvatarCache } from '../lib/qdnAvatars/defaultCache';

const noopUnsubscribe = () => {};

/**
 * Like useQdnAvatar, but returns only the image src (cached object URL,
 * bundled seed or undefined). The component re-renders only when the src
 * changes, not on status-only changes (a retry on a slow node flips
 * failed -> loading -> failed), which matters for heavy rows such as chat
 * messages. Never throws.
 */
export function useQdnAvatarSrc(
  name: string | null | undefined,
  options: UseQdnAvatarOptions = {}
): string | undefined {
  const {
    identifier,
    priority = 'normal',
    enabled = true,
    countUse = true,
  } = options;
  const cache = getQdnAvatarCache();
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const key = useMemo(() => {
    if (!enabled) return null;
    try {
      return cache.keyFor(trimmedName, identifier);
    } catch {
      return null;
    }
  }, [cache, enabled, trimmedName, identifier]);

  const subscribe = useCallback(
    (listener: () => void) =>
      key ? cache.subscribe(key, listener) : noopUnsubscribe,
    [cache, key]
  );
  const getSrc = useCallback(() => {
    try {
      return cache.getSnapshot(key).src;
    } catch {
      return undefined;
    }
  }, [cache, key]);
  const src = useSyncExternalStore(subscribe, getSrc, getSrc);

  useEffect(() => {
    if (!key) return;
    try {
      cache.request(key, { name: trimmedName, priority });
      if (countUse) cache.noteUse(key);
    } catch {
      // never break the row over an avatar
    }
  }, [cache, key, trimmedName, priority, countUse]);

  return src;
}
