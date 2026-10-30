import {
  buildUserAvatarPreviewUrl,
  fullSizeAvatarRequestUrl,
} from '../components/Group/avatarPreviewUrls';
import { useFullSizeAvatarSrc } from '../components/Group/useFullSizeAvatarSrc';
import type { QdnAvatarSnapshot } from '../lib/qdnAvatars';
import { getBaseApiReact } from '../utils/globalApi';

/**
 * Below this many CSS pixels the cached copy (at most 128 px) is sharp
 * enough, even on a 2-3x phone screen.
 */
export const FULL_SIZE_AVATAR_MIN_PX = 64;

type FullSizeQdnAvatar = {
  /** Full-size node image once loaded, else the cached copy or seed. */
  src: string | undefined;
  /** True once the full-size image has loaded and is returned. */
  isFullSize: boolean;
  /**
   * The user published this avatar from this device moments ago: the node
   * may still serve the old file, so only the cached copy (the new image)
   * is current.
   */
  justPublished: boolean;
};

const fullUrlFor = (name: string): string | null => {
  try {
    return buildUserAvatarPreviewUrl(getBaseApiReact(), name);
  } catch {
    return null;
  }
};

/**
 * For big user avatars (profile card, profile lookup, user card, unlock
 * screen): shows the cached copy at once (sharp up to 128 px) and switches
 * to the full-size node image once it has loaded, so a slow node never
 * leaves the avatar empty. Only loads when the cache has a node image for
 * the name.
 */
export function useFullSizeQdnAvatarSrc(
  name: string | null | undefined,
  snapshot: QdnAvatarSnapshot,
  enabled = true
): FullSizeQdnAvatar {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const cachedSrc =
    snapshot.source === 'cache' && snapshot.src ? snapshot.src : undefined;
  const fullUrl = enabled && trimmed && cachedSrc ? fullUrlFor(trimmed) : null;
  const loadedSrc = useFullSizeAvatarSrc(
    cachedSrc,
    fullUrl,
    Boolean(enabled && trimmed)
  );
  const isFullSize = Boolean(loadedSrc && cachedSrc && loadedSrc !== cachedSrc);
  let justPublished = false;
  if (fullUrl && !isFullSize) {
    try {
      justPublished = fullSizeAvatarRequestUrl(fullUrl) === null;
    } catch {
      justPublished = false;
    }
  }
  return {
    src: isFullSize ? loadedSrc : snapshot.src,
    isFullSize,
    justPublished,
  };
}
