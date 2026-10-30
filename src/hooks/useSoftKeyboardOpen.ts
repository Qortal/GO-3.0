import { useEffect, useState, useSyncExternalStore } from 'react';
import { isGoLayout } from '../layout/goLayout';
import {
  getSoftKeyboardGatedInset,
  subscribeSoftKeyboard,
} from './useSoftKeyboardInset';

const noopSubscribe = () => () => {};

/**
 * Detects whether the on-screen (soft) keyboard is currently open.
 *
 * Uses the VisualViewport API: when the keyboard appears, the visual viewport
 * height shrinks well below the largest height we've observed while the
 * keyboard was closed. We track that maximum and treat a sustained shrink as
 * "keyboard open". This works regardless of the `interactive-widget` viewport
 * mode (resizes-content vs overlays-content).
 *
 * Falls back to `false` on platforms without VisualViewport (older browsers).
 *
 * On GO it reads the shared keyboard store instead, whose baseline survives
 * rotation, folds and split-screen resizes. Both paths' hooks always run.
 */
export function useSoftKeyboardOpen(thresholdPx = 160): boolean {
  const go = isGoLayout();
  const [open, setOpen] = useState(false);
  const goOpen = useSyncExternalStore(
    go ? subscribeSoftKeyboard : noopSubscribe,
    () => go && getSoftKeyboardGatedInset() > thresholdPx,
    () => false
  );

  useEffect(() => {
    if (go) return;
    const vv =
      typeof window !== 'undefined' ? window.visualViewport : undefined;
    if (!vv) return;

    let maxHeight = vv.height;

    const update = () => {
      // Grow the baseline whenever the viewport is at/near full height so an
      // initially-open keyboard or rotation doesn't poison the reference.
      if (vv.height > maxHeight) maxHeight = vv.height;
      setOpen(maxHeight - vv.height > thresholdPx);
    };

    update();
    vv.addEventListener('resize', update);
    return () => {
      vv.removeEventListener('resize', update);
    };
  }, [thresholdPx, go]);

  return go ? goOpen : open;
}
