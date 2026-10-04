import { useCallback, useState } from 'react';
import type { QdnAvatarPriority } from '../lib/qdnAvatars';
import { useQdnAvatarSrc } from './useQdnAvatarSrc';

export type ShownQdnAvatarOptions = {
  /** The user's own "saved messages" chat: no lookup, nothing shown. */
  savedMessages?: boolean;
  priority?: QdnAvatarPriority;
};

export type ShownQdnAvatar = {
  /** The cached picture to show, or undefined for the surface's fallback. */
  shownSrc: string | undefined;
  /** Pass to the <img> onError: a picture the WebView cannot decode. */
  onImgError: () => void;
};

/**
 * The cached avatar of a user, minus a picture the WebView failed to show
 * (that one counts as none, so the surface shows its fallback and nothing
 * opens a preview of a broken image). A new picture for the name is tried
 * again. Saved messages never asks the cache.
 */
export function useShownQdnAvatarSrc(
  name: string | null | undefined,
  { savedMessages = false, priority }: ShownQdnAvatarOptions = {}
): ShownQdnAvatar {
  const src = useQdnAvatarSrc(savedMessages ? null : name, {
    enabled: !savedMessages,
    priority,
  });
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const onImgError = useCallback(() => setFailedSrc(src ?? null), [src]);
  return {
    shownSrc: src && src !== failedSrc ? src : undefined,
    onImgError,
  };
}
