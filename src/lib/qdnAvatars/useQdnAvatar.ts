import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { QdnAvatarPriority, QdnAvatarSnapshot } from './avatarCache';
import { getQdnAvatarCache } from './defaultCache';
import { qdnGroupAvatarIdentifier } from './keys';

export type UseQdnAvatarOptions = {
  /** QDN identifier; defaults to `qortal_avatar`. */
  identifier?: string | null;
  /** Queue position for the fetch. Default 'normal'. */
  priority?: QdnAvatarPriority;
  /** false: no subscription, no fetch; returns the idle snapshot. */
  enabled?: boolean;
  /** Count this mount toward keeping the image cached. Default true. */
  countUse?: boolean;
};

const noopUnsubscribe = () => {};

/**
 * Avatar of a Qortal name (user, Q-App, QDN website) from the device cache.
 *
 * `src` is a cached image (object URL), a bundled seed for well-known Q-Apps,
 * or undefined: keep your own fallback (letter, person icon, Qortal logo) for
 * undefined. Subscribes to this one avatar only, so an image arriving for
 * another name does not re-render this component. Never throws.
 *
 * Render `src` directly; do not copy it into state, refs or caches. A cached
 * src is a `blob:` URL that is revoked shortly after the image is replaced,
 * and it only works in this document (not in Q-App iframes, native
 * notifications or share sheets: use getQdnAvatarDataUrl there).
 */
export function useQdnAvatar(
  name: string | null | undefined,
  options: UseQdnAvatarOptions = {}
): QdnAvatarSnapshot {
  const {
    identifier,
    priority = 'normal',
    enabled = true,
    countUse = true,
  } = options;
  const cache = getQdnAvatarCache();
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const key = useMemo(
    () => (enabled ? cache.keyFor(trimmedName, identifier) : null),
    [cache, enabled, trimmedName, identifier]
  );

  const subscribe = useCallback(
    (listener: () => void) =>
      key ? cache.subscribe(key, listener) : noopUnsubscribe,
    [cache, key]
  );
  const getSnapshot = useCallback(() => cache.getSnapshot(key), [cache, key]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!key) return;
    cache.request(key, { name: trimmedName, priority });
    if (countUse) cache.noteUse(key);
  }, [cache, key, trimmedName, priority, countUse]);

  return snapshot;
}

/** Group avatar (published by the group owner) from the device cache. */
export function useQdnGroupAvatar(
  ownerName: string | null | undefined,
  groupId: string | number | null | undefined,
  options: Omit<UseQdnAvatarOptions, 'identifier'> = {}
): QdnAvatarSnapshot {
  const hasGroup = groupId != null && String(groupId).trim() !== '';
  return useQdnAvatar(hasGroup ? ownerName : null, {
    ...options,
    identifier: hasGroup ? qdnGroupAvatarIdentifier(groupId) : null,
    enabled: hasGroup && options.enabled !== false,
  });
}
