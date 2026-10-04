import { useEffect, useRef, useState } from 'react';
import { fullSizeAvatarRequestUrl } from './avatarPreviewUrls';

/** Same as the avatar cache's blocking fetch: give up on a silent node. */
export const FULL_SIZE_AVATAR_TIMEOUT_MS = 25_000;

type LoadedFullSize = {
  /** The node URL the caller asked for. */
  fullUrl: string;
  /** The cached copy shown when the full-size image was loaded. */
  forSrc: string;
  /** What was loaded (fullUrl, maybe with a version parameter). */
  src: string;
};

/**
 * For the tap-to-enlarge preview only (list and header avatars show the
 * cached copy). Shows the cached copy (at most 128 px, there at once) and
 * loads the full-size node image in the background. Returns the full-size
 * image once it has loaded, but only while the cached copy is still the one
 * it was loaded for: when the cache gets a new image (a new avatar published
 * here, or the daily refresh found one), the new cached copy shows and the
 * full size is loaded again past the HTTP cache. Right after a publish from
 * this device the full size is not loaded at all (fullSizeAvatarRequestUrl).
 * Nothing is loaded without a cached image or while `enabled` is false. A
 * load that fails, takes over 25 s or is no longer needed is dropped and its
 * download cancelled; the cached copy stays.
 */
export function useFullSizeAvatarSrc(
  cachedSrc: string | null | undefined,
  fullUrl: string | null | undefined,
  enabled = true
): string | undefined {
  const [loaded, setLoaded] = useState<LoadedFullSize | null>(null);
  const reloadsRef = useRef(0);

  const active = Boolean(enabled && cachedSrc && fullUrl);
  const sameUrl = Boolean(loaded && fullUrl && loaded.fullUrl === fullUrl);
  const isCurrent = active && sameUrl && loaded?.forSrc === cachedSrc;
  // The cached copy changed since the full-size image was loaded.
  const cachedCopyChanged = active && sameUrl && !isCurrent;

  useEffect(() => {
    if (!active || isCurrent || !cachedSrc || !fullUrl) return;
    if (typeof Image === 'undefined') return;
    const reload = cachedCopyChanged ? (reloadsRef.current += 1) : 0;
    const requestUrl = fullSizeAvatarRequestUrl(fullUrl, { reload });
    if (!requestUrl) return;

    let done = false;
    const image = new Image();
    const finish = () => {
      done = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
    };
    const cancel = () => {
      if (done) return;
      finish();
      // Chromium drops the download when the src is cleared.
      image.src = '';
    };
    const timer = setTimeout(cancel, FULL_SIZE_AVATAR_TIMEOUT_MS);
    image.decoding = 'async';
    image.onload = () => {
      if (done) return;
      finish();
      setLoaded({ fullUrl, forSrc: cachedSrc, src: requestUrl });
    };
    // On error keep the cached copy.
    image.onerror = () => {
      if (!done) finish();
    };
    image.src = requestUrl;
    return cancel;
  }, [active, isCurrent, cachedCopyChanged, cachedSrc, fullUrl]);

  if (!cachedSrc) return undefined;
  if (isCurrent && loaded) return loaded.src;
  return cachedSrc;
}
