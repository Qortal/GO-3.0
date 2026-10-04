import { useCallback, useEffect, useRef, useState } from 'react';
import {
  requestQdnAvatar,
  useQdnAvatar,
  type QdnAvatarPriority,
  type QdnAvatarSnapshot,
} from '../../lib/qdnAvatars';

/** Rows this close to the screen count as on screen. */
const VIEWPORT_MARGIN = '200px';

type Watcher = (visible: boolean) => void;

// One observer for every avatar on screen: a long list watches hundreds.
const watchers = new Map<Element, Watcher>();
let observer: IntersectionObserver | null = null;

export const canWatchViewport = () =>
  typeof window !== 'undefined' &&
  typeof window.IntersectionObserver === 'function';

function onEntries(entries: IntersectionObserverEntry[]) {
  // The last entry per element is its current state.
  const latest = new Map<Element, IntersectionObserverEntry>();
  for (const entry of entries) latest.set(entry.target, entry);
  const shown: { watcher: Watcher; top: number; left: number }[] = [];
  for (const [target, entry] of latest) {
    const watcher = watchers.get(target);
    if (!watcher) continue;
    if (entry.isIntersecting) {
      shown.push({
        watcher,
        top: entry.boundingClientRect?.top ?? 0,
        left: entry.boundingClientRect?.left ?? 0,
      });
    } else {
      watcher(false);
    }
  }
  // The avatar cache serves the rows that came on screen last first, and the
  // rows of one batch in the order they were asked for: ask top to bottom.
  shown.sort((a, b) => a.top - b.top || a.left - b.left);
  for (const { watcher } of shown) watcher(true);
}

/** Calls `watcher` when the element comes on or goes off screen. */
function watchViewport(element: Element, watcher: Watcher): () => void {
  try {
    if (!observer) {
      observer = new IntersectionObserver(onEntries, {
        rootMargin: VIEWPORT_MARGIN,
      });
    }
    watchers.set(element, watcher);
    observer.observe(element);
  } catch {
    // Cannot tell: treat it as on screen.
    watchers.delete(element);
    watcher(true);
    return () => {};
  }
  return () => {
    watchers.delete(element);
    try {
      observer?.unobserve(element);
    } catch {
      // ignore
    }
    if (!watchers.size && observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

/**
 * useQdnAvatar for avatars in lists: the cached or bundled icon shows at once
 * wherever the row is, but the node is asked for the rows on screen first
 * (top to bottom) and for rows off screen only after them. Put `ref` on the
 * element that shows the avatar. Without IntersectionObserver every row
 * counts as on screen.
 */
export function useViewportQdnAvatar(
  name: string | null | undefined,
  options: { enabled?: boolean; priority?: QdnAvatarPriority } = {}
): { snapshot: QdnAvatarSnapshot; ref: (element: Element | null) => void } {
  const { enabled = true, priority = 'normal' } = options;
  const [watchable] = useState(canWatchViewport);
  const snapshot = useQdnAvatar(name, {
    enabled,
    priority: watchable ? 'low' : priority,
  });
  const wanted = useRef({ name, enabled, priority });
  const visible = useRef(false);
  const detach = useRef<(() => void) | null>(null);

  // requestQdnAvatar, not peekQdnAvatarSrc: that keeps the object URL alive
  // until the cache is cleared (for non-React callers), and a long list would
  // then hold every icon it ever showed.
  const promote = useCallback(() => {
    const current = wanted.current;
    const trimmed = typeof current.name === 'string' ? current.name.trim() : '';
    if (!current.enabled || !trimmed) return;
    // If it fails, the low-priority request from useQdnAvatar still stands.
    requestQdnAvatar(trimmed, { priority: current.priority });
  }, []);

  useEffect(() => {
    wanted.current = { name, enabled, priority };
    // A row that stays on screen while it shows another app (recycled rows).
    if (visible.current) promote();
  }, [name, enabled, priority, promote]);

  const ref = useCallback(
    (element: Element | null) => {
      detach.current?.();
      detach.current = null;
      visible.current = false;
      if (!element || !watchable) return;
      detach.current = watchViewport(element, (isVisible) => {
        visible.current = isVisible;
        if (isVisible) promote();
      });
    },
    [promote, watchable]
  );

  return { snapshot, ref };
}
