import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Source for AvatarPreviewModal: opens at once with the small image already
 * on screen (the cached avatar, at most 128 px) and swaps in the full-size
 * node image once it has loaded, so a slow node never leaves an empty black
 * overlay. When the full image fails, the small one stays.
 */
export function useAvatarPreviewSrc() {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const pendingRef = useRef<HTMLImageElement | null>(null);

  const cancelPending = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) {
      pending.onload = null;
      pending.onerror = null;
      try {
        // Stops a download the closed preview no longer needs.
        pending.src = '';
      } catch {
        // ignore
      }
    }
  }, []);

  /** False when there is nothing to show. */
  const showPreview = useCallback(
    (fullSrc?: string | null, placeholderSrc?: string | null): boolean => {
      cancelPending();
      const full = fullSrc || undefined;
      const first = placeholderSrc || full;
      if (!first) return false;
      setPreviewSrc(first);
      if (!full || full === first || typeof Image === 'undefined') return true;
      try {
        const loader = new Image();
        pendingRef.current = loader;
        loader.onload = () => {
          if (pendingRef.current !== loader) return;
          pendingRef.current = null;
          setPreviewSrc(full);
        };
        loader.onerror = () => {
          if (pendingRef.current === loader) pendingRef.current = null;
        };
        loader.src = full;
      } catch {
        pendingRef.current = null;
      }
      return true;
    },
    [cancelPending]
  );

  const clearPreview = useCallback(() => {
    cancelPending();
    setPreviewSrc(null);
  }, [cancelPending]);

  useEffect(() => cancelPending, [cancelPending]);

  return { previewSrc, showPreview, clearPreview, cancelPending };
}
