import { useEffect, type RefObject } from 'react';

/**
 * Plays a decorative `<video>` only while it is actually on screen.
 *
 * A muted, looping `autoPlay` video keeps the whole media pipeline alive
 * (demuxer, hardware decoder, compositor uploads) even when it is rendered at
 * 0x0 behind another view, faded to `opacity: 0` or the app is in the
 * background. On a phone that was measured at ~15 % of a CPU core plus the
 * decoder's own power budget, around the clock, for three tile previews
 * nobody was looking at.
 *
 * `enabled` covers states the IntersectionObserver cannot see (an element
 * faded out with `opacity`/`visibility` still intersects the viewport).
 */
export function useVideoPlaybackWhenVisible(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled = true,
  /** Change this when the element behind `videoRef` is remounted (e.g. a `key`). */
  resetKey: unknown = undefined
): void {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let intersecting = false;
    let disposed = false;

    const apply = () => {
      if (disposed) return;
      const shouldPlay =
        enabled &&
        intersecting &&
        (typeof document === 'undefined' || !document.hidden);
      if (shouldPlay) {
        if (video.paused) {
          const attempt = video.play();
          if (attempt && typeof attempt.catch === 'function') {
            attempt.catch(() => {
              /* autoplay policy or detached element; stays paused */
            });
          }
        }
      } else if (!video.paused) {
        video.pause();
      }
    };

    const onVisibility = () => apply();
    document.addEventListener('visibilitychange', onVisibility);

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.target === video) {
              intersecting = entry.isIntersecting && entry.intersectionRatio > 0;
            }
          }
          apply();
        },
        { threshold: [0, 0.01] }
      );
      observer.observe(video);
    } else {
      // No observer support: fall back to page visibility only.
      intersecting = true;
      apply();
    }

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
      if (!video.paused) video.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetKey re-arms on remount
  }, [videoRef, enabled, resetKey]);
}
