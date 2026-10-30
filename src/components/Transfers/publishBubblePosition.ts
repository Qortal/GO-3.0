/**
 * Where the publish bubble floats: against the left or right edge, anywhere
 * between GO's top bar and the tab buttons. The person can drag it; let go,
 * it springs to the nearer edge (or the one it was flung towards). The spot
 * is remembered on this device as a side and a height within the free strip,
 * so it survives rotation and other screen sizes.
 */
import {
  MOBILE_TAB_BAR_HEIGHT_PX,
  MOBILE_TOP_BAR_HEIGHT_PX,
} from '../Mobile/mobileBarHeights';

export const BUBBLE_SIZE_PX = 60;
/** Gap between the bubble and the screen edge or the bars. */
export const BUBBLE_EDGE_GAP_PX = 10;
/** A fling faster than this (px/s) picks the side it points to. */
const FLING_SIDE_SPEED = 450;
/** How far a fling carries the bubble on, per px/s. */
const FLING_CARRY_S = 0.12;
const STORAGE_KEY = 'go-qdn-publish-bubble';

type BubbleSide = 'left' | 'right';
/** `ratio`: 0 at the top of the free strip, 1 at its bottom. */
export type BubblePlacement = { side: BubbleSide; ratio: number };
export type BubbleBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};
type ScreenInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export const DEFAULT_BUBBLE_PLACEMENT: BubblePlacement = {
  side: 'right',
  ratio: 0.62,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function bubbleBounds(
  viewport: { width: number; height: number },
  insets: ScreenInsets
): BubbleBounds {
  const minX = insets.left + BUBBLE_EDGE_GAP_PX;
  const maxX = Math.max(
    minX,
    viewport.width - insets.right - BUBBLE_EDGE_GAP_PX - BUBBLE_SIZE_PX
  );
  const minY = insets.top + MOBILE_TOP_BAR_HEIGHT_PX + BUBBLE_EDGE_GAP_PX;
  const maxY = Math.max(
    minY,
    viewport.height -
      insets.bottom -
      MOBILE_TAB_BAR_HEIGHT_PX -
      BUBBLE_EDGE_GAP_PX -
      BUBBLE_SIZE_PX
  );
  return { minX, maxX, minY, maxY };
}

export function placementPoint(
  placement: BubblePlacement,
  bounds: BubbleBounds
): { x: number; y: number } {
  return {
    x: placement.side === 'left' ? bounds.minX : bounds.maxX,
    y: bounds.minY + clamp(placement.ratio, 0, 1) * (bounds.maxY - bounds.minY),
  };
}

/** Where a drag let go at (x, y), moving at (vx, vy) px/s, comes to rest. */
export function settlePlacement(
  point: { x: number; y: number },
  velocity: { x: number; y: number },
  bounds: BubbleBounds
): BubblePlacement {
  const centre = point.x + BUBBLE_SIZE_PX / 2;
  const middle = (bounds.minX + bounds.maxX + BUBBLE_SIZE_PX) / 2;
  let side: BubbleSide = centre < middle ? 'left' : 'right';
  if (Math.abs(velocity.x) > FLING_SIDE_SPEED) {
    side = velocity.x < 0 ? 'left' : 'right';
  }
  const y = clamp(
    point.y + velocity.y * FLING_CARRY_S,
    bounds.minY,
    bounds.maxY
  );
  const span = bounds.maxY - bounds.minY;
  return { side, ratio: span > 0 ? (y - bounds.minY) / span : 0 };
}

export function loadBubblePlacement(): BubblePlacement {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (
      raw &&
      (raw.side === 'left' || raw.side === 'right') &&
      typeof raw.ratio === 'number' &&
      Number.isFinite(raw.ratio)
    ) {
      return { side: raw.side, ratio: clamp(raw.ratio, 0, 1) };
    }
  } catch {
    /* private window or blocked storage: the default spot */
  }
  return DEFAULT_BUBBLE_PLACEMENT;
}

export function saveBubblePlacement(placement: BubblePlacement): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(placement));
  } catch {
    /* only a convenience */
  }
}

/** The safe-area insets GO keeps on <html> (see utils/mobileSafeArea.ts). */
export function readScreenInsets(): ScreenInsets {
  const read = (name: string) => {
    try {
      const value = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(name)
      );
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  };
  return {
    top: read('--safe-area-inset-top'),
    bottom: read('--safe-area-inset-bottom'),
    left: read('--safe-area-inset-left'),
    right: read('--safe-area-inset-right'),
  };
}

/**
 * How fast (px/s) the finger was moving as it let go, from the moves of the
 * last `windowMs`: none when it had come to rest first.
 */
export function releaseVelocity(
  samples: { t: number; x?: number; y: number }[],
  now: number,
  windowMs = 100
): { x: number; y: number } {
  const recent = samples.filter((sample) => now - sample.t <= windowMs);
  if (recent.length < 2) return { x: 0, y: 0 };
  const first = recent[0];
  const last = recent[recent.length - 1];
  const seconds = Math.max(0.016, (last.t - first.t) / 1000);
  return {
    x: ((last.x ?? 0) - (first.x ?? 0)) / seconds,
    y: (last.y - first.y) / seconds,
  };
}
