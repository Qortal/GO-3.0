import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBaseApiReact } from '../../App';
import {
  useQdnGroupAvatar,
  type QdnAvatarPriority,
} from '../../lib/qdnAvatars';
import { buildGroupAvatarPreviewUrl } from './avatarPreviewUrls';
import { useFullSizeAvatarSrc } from './useFullSizeAvatarSrc';

/**
 * Lists that mount every row at once (not virtualized) pass the row index:
 * the first rows (on screen first) ask the cache at 'normal', the rest at
 * 'low'. Inside one level the cache serves the newest request first, so
 * without this the rows at the bottom would load before the ones on screen.
 */
export const EAGER_ROW_AVATARS = 15;

export function rowAvatarPriority(
  index: number,
  eagerRows = EAGER_ROW_AVATARS
): QdnAvatarPriority {
  return index >= 0 && index < eagerRows ? 'normal' : 'low';
}

/**
 * Group avatar for a group list row: the cached image, whether it really
 * rendered (an <img> error turns the clickable look off), and the
 * tap-to-enlarge preview (cached copy at once, full size once loaded).
 */
export function useGroupRowAvatar(
  ownerName: string | null | undefined,
  groupId: string | number | null | undefined,
  options: { priority?: QdnAvatarPriority } = {}
) {
  const { src } = useQdnGroupAvatar(ownerName, groupId, {
    priority: options.priority,
  });
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const isLoaded = Boolean(src) && failedSrc !== src;
  const imgProps = useMemo(
    () => ({
      onError: () => setFailedSrc(src ?? null),
    }),
    [src]
  );

  const [previewOpen, setPreviewOpen] = useState(false);
  // Read the node address when the preview opens (the user can switch nodes).
  const previewFullUrl = useMemo(
    () =>
      previewOpen
        ? buildGroupAvatarPreviewUrl(getBaseApiReact(), ownerName, groupId)
        : null,
    [previewOpen, ownerName, groupId]
  );
  const previewSrc = useFullSizeAvatarSrc(
    previewOpen && isLoaded ? src : undefined,
    previewFullUrl,
    previewOpen
  );

  /** Opens the preview when an image is shown; false otherwise. */
  const openPreview = useCallback(() => {
    if (!isLoaded) return false;
    setPreviewOpen(true);
    return true;
  }, [isLoaded]);
  const closePreview = useCallback(() => setPreviewOpen(false), []);

  // The image went away (render error, cache cleared): close the preview so
  // it does not pop up again when a new image arrives.
  useEffect(() => {
    if (previewOpen && !isLoaded) setPreviewOpen(false);
  }, [previewOpen, isLoaded]);

  return {
    src,
    isLoaded,
    imgProps,
    previewOpen: previewOpen && isLoaded && Boolean(previewSrc),
    previewSrc,
    openPreview,
    closePreview,
  };
}
