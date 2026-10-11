/**
 * Pinch / double-tap / wheel zoom for arbitrary content (PDF canvas, etc.).
 * Same gesture model as QortinoZoomableImage, applied to a wrapper Box.
 */
import {
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
  type Ref,
} from 'react';
import { Box } from '@mui/material';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const DOUBLE_TAP_SCALE = 2.5;
/** The zoom limits when the owner does not set its own. */
export const ZOOMABLE_BOX_LIMITS = {
  maxZoom: MAX_ZOOM,
  doubleTapScale: DOUBLE_TAP_SCALE,
} as const;
const ZOOM_EASING = 'transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1)';
/** A second tap within this long is a double tap. */
const DOUBLE_TAP_MS = 300;
/** A press that moves further than this is a pan, not a tap. */
const TAP_MOVE_PX = 10;
/** A press held longer than this is not a tap. */
const TAP_MAX_MS = 500;
/**
 * After a touch the browser also sends its own click and dblclick. Those
 * are ignored for this long, or a double tap zooms in and straight back out.
 */
const SYNTHETIC_MOUSE_MS = 800;
/** A swipe this long, or this share of the width, turns the page. */
const SWIPE_MIN_PX = 60;
const SWIPE_WIDTH_SHARE = 0.22;
/** A shorter swipe still turns it when flicked at least this fast (px/ms). */
const FLICK_MIN_PX = 30;
const FLICK_SPEED = 0.45;
/** Past the first or last page the page only gives a little. */
const EDGE_RESISTANCE = 0.3;
/** The old page leaves, then the new one arrives from the other side. */
const TURN_OUT_MS = 170;
const TURN_IN_MS = 260;
const TURN_OUT_EASING = 'cubic-bezier(0.4, 0, 1, 1)';
const TURN_IN_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
/** How far each page travels, as a share of the width. */
const TURN_OUT_SHARE = 0.6;
const TURN_IN_SHARE = 0.35;
/** If the next page takes longer than this to draw, it slides in anyway. */
const TURN_WAIT_MAX_MS = 2000;
const SPRING_BACK =
  'transform 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.12), opacity 0.3s ease';

type SwipeDirection = 'next' | 'prev';

export type QortinoZoomableBoxControl = {
  /**
   * The owner just resized the content by `ratio` (new / old size). While
   * zoomed in, the zoom shrinks by the same ratio, so what is on screen
   * keeps its size; at fit nothing changes.
   */
  contentResized: (ratio: number) => void;
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

type Props = {
  children: ReactNode;
  /** Bump to reset zoom (e.g. when changing PDF page). */
  resetKey?: string | number;
  /** A single tap: runs once it is clear the tap is not a double tap. */
  onSingleTap?: () => void;
  /** False when there is no page that way: the swipe only stretches. */
  canSwipe?: (direction: SwipeDirection) => boolean;
  /**
   * A sideways swipe at fit zoom (zoomed in, a drag pans instead) that
   * turns the page. `slidOut` settles once the old page is off screen; the
   * caller shows the new page no earlier, and settles the returned promise
   * once it is drawn, when the new page slides in.
   */
  onSwipe?: (
    direction: SwipeDirection,
    slidOut: Promise<void>
  ) => Promise<void> | void;
  /** Pinch limit and double-tap zoom, relative to the content at fit. */
  maxZoom?: number;
  doubleTapScale?: number;
  /**
   * Pans stop where the content's edge meets the box's edge. For content
   * much smaller than the box, which the default limit lets leave the view.
   */
  clampToContent?: boolean;
  controlRef?: Ref<QortinoZoomableBoxControl>;
};

export function QortinoZoomableBox({
  children,
  resetKey,
  onSingleTap,
  onSwipe,
  canSwipe,
  maxZoom = MAX_ZOOM,
  doubleTapScale = DOUBLE_TAP_SCALE,
  clampToContent = false,
  controlRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const tf = useRef({ scale: 1, x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const gesture = useRef({
    startDist: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
    focalX: 0,
    focalY: 0,
    panStartX: 0,
    panStartY: 0,
    isPanning: false,
    lastTapTime: 0,
    tapStartX: 0,
    tapStartY: 0,
    tapStartTime: 0,
    /** This press can still be a tap: one finger, no pan, no double tap. */
    tapCandidate: false,
    lastTouchTime: 0,
    /** A one-finger press at fit zoom that may become a page swipe. */
    swipeCandidate: false,
    /** It moved sideways first: the page follows the finger. */
    swiping: false,
    /** The last two finger positions, for the flick speed. */
    prevMoveX: 0,
    prevMoveTime: 0,
    lastMoveX: 0,
    lastMoveTime: 0,
  });
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const canSwipeRef = useRef(canSwipe);
  canSwipeRef.current = canSwipe;
  /** A page turn is animating: the page is the turn's to move. */
  const turningRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSingleTapRef = useRef(onSingleTap);
  onSingleTapRef.current = onSingleTap;

  const cancelSingleTap = () => {
    if (singleTapTimer.current != null) {
      clearTimeout(singleTapTimer.current);
      singleTapTimer.current = null;
    }
  };

  const scheduleSingleTap = () => {
    cancelSingleTap();
    if (!onSingleTapRef.current) return;
    singleTapTimer.current = setTimeout(() => {
      singleTapTimer.current = null;
      onSingleTapRef.current?.();
    }, DOUBLE_TAP_MS);
  };

  useEffect(() => cancelSingleTap, []);

  const paint = (animate: boolean) => {
    const el = contentRef.current;
    if (!el) return;
    el.style.transition = animate ? ZOOM_EASING : 'none';
    el.style.transform = `translate3d(${tf.current.x}px, ${tf.current.y}px, 0) scale(${tf.current.scale})`;
  };

  const schedulePaint = () => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      paint(false);
    });
  };

  const getRect = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { cx: 0, cy: 0, width: 0, height: 0 };
    return {
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
    };
  };

  const clampTranslate = (nextScale: number, x: number, y: number) => {
    const { width, height } = getRect();
    let maxX = (width * (nextScale - 1)) / 2;
    let maxY = (height * (nextScale - 1)) / 2;
    const content = contentRef.current;
    if (clampToContent && content) {
      // Layout size, without the transform; a side that still fits stays
      // centred.
      maxX = Math.max(0, (content.offsetWidth * nextScale - width) / 2);
      maxY = Math.max(0, (content.offsetHeight * nextScale - height) / 2);
    }
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  };

  const reset = (animate = true) => {
    tf.current = { scale: 1, x: 0, y: 0 };
    paint(animate);
    if (contentRef.current) contentRef.current.style.opacity = '1';
  };

  /** The page sits `x` px aside, fading as it goes, with `transition`. */
  const placeAside = (x: number, transition: string, opacity?: number) => {
    const el = contentRef.current;
    if (!el) return;
    const width = getRect().width || 1;
    tf.current = { scale: 1, x, y: 0 };
    el.style.transition = transition;
    el.style.transform = `translate3d(${x}px, 0, 0) scale(1)`;
    el.style.opacity = String(
      opacity ?? clamp(1 - (Math.abs(x) / width) * 0.5, 0.4, 1)
    );
  };

  const springBack = () => placeAside(0, SPRING_BACK, 1);

  const turnPage = async (direction: SwipeDirection) => {
    const el = contentRef.current;
    if (!el) return;
    turningRef.current = true;
    const width = getRect().width;
    const away = direction === 'next' ? -1 : 1;
    placeAside(
      away * width * TURN_OUT_SHARE,
      `transform ${TURN_OUT_MS}ms ${TURN_OUT_EASING}, opacity ${TURN_OUT_MS}ms ${TURN_OUT_EASING}`,
      0
    );
    const slidOut = wait(TURN_OUT_MS);
    let drawn: Promise<void> | void;
    try {
      drawn = onSwipeRef.current?.(direction, slidOut);
    } catch {
      drawn = undefined;
    }
    await Promise.race([
      Promise.all([slidOut, Promise.resolve(drawn).catch(() => {})]),
      wait(TURN_WAIT_MAX_MS),
    ]);
    if (!mountedRef.current || !contentRef.current) return;
    // Start the new page on the far side, then let it glide in.
    placeAside(-away * width * TURN_IN_SHARE, 'none', 0);
    void contentRef.current.offsetWidth;
    placeAside(
      0,
      `transform ${TURN_IN_MS}ms ${TURN_IN_EASING}, opacity ${TURN_IN_MS}ms ${TURN_IN_EASING}`,
      1
    );
    turningRef.current = false;
  };

  useEffect(() => {
    // A page turn places the new page itself.
    if (turningRef.current) {
      tf.current = { scale: 1, x: tf.current.x, y: 0 };
      return;
    }
    reset(false);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const zoomTo = (nextScale: number, focalX: number, focalY: number) => {
    const { cx, cy } = getRect();
    const fx = focalX - cx;
    const fy = focalY - cy;
    const ratio = nextScale / tf.current.scale;
    const nextX = fx - (fx - tf.current.x) * ratio;
    const nextY = fy - (fy - tf.current.y) * ratio;
    const clamped = clampTranslate(nextScale, nextX, nextY);
    tf.current = { scale: nextScale, x: clamped.x, y: clamped.y };
    paint(true);
  };

  const doubleTapZoom = (focalX: number, focalY: number) => {
    if (tf.current.scale > 1.01) reset(true);
    else zoomTo(doubleTapScale, focalX, focalY);
  };

  useImperativeHandle(controlRef, () => ({
    contentResized: (ratio: number) => {
      if (!(ratio > 0) || !Number.isFinite(ratio) || turningRef.current) {
        return;
      }
      const { scale, x, y } = tf.current;
      if (scale <= 1.01) return;
      const nextScale = scale / ratio;
      if (nextScale <= 1.01) {
        reset(false);
        return;
      }
      // The content stays centred in the box, so the same translate keeps
      // the same spot under the finger.
      const clamped = clampTranslate(nextScale, x, y);
      tf.current = { scale: nextScale, x: clamped.x, y: clamped.y };
      paint(false);
    },
  }));

  const handleTouchStart = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      g.startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      g.startScale = tf.current.scale;
      g.startX = tf.current.x;
      g.startY = tf.current.y;
      g.focalX = (a.clientX + b.clientX) / 2;
      g.focalY = (a.clientY + b.clientY) / 2;
      g.isPanning = false;
      g.tapCandidate = false;
      g.swipeCandidate = false;
      if (g.swiping) {
        g.swiping = false;
        springBack();
      }
      cancelSingleTap();
      paint(false);
    } else if (e.touches.length === 1) {
      const now = Date.now();
      const t = e.touches[0]!;
      g.lastTouchTime = now;
      if (now - g.lastTapTime < DOUBLE_TAP_MS) {
        cancelSingleTap();
        doubleTapZoom(t.clientX, t.clientY);
        g.lastTapTime = 0;
        g.isPanning = false;
        g.tapCandidate = false;
      } else {
        g.lastTapTime = now;
        g.tapCandidate = true;
        g.tapStartX = t.clientX;
        g.tapStartY = t.clientY;
        g.tapStartTime = now;
        g.swipeCandidate =
          !!onSwipeRef.current &&
          !turningRef.current &&
          tf.current.scale <= 1.01;
        g.swiping = false;
        g.prevMoveX = g.lastMoveX = t.clientX;
        g.prevMoveTime = g.lastMoveTime = now;
        if (tf.current.scale > 1) {
          g.isPanning = true;
          g.panStartX = t.clientX - tf.current.x;
          g.panStartY = t.clientY - tf.current.y;
          paint(false);
        }
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (g.tapCandidate && e.touches.length === 1) {
      const t = e.touches[0]!;
      if (
        Math.hypot(t.clientX - g.tapStartX, t.clientY - g.tapStartY) >
        TAP_MOVE_PX
      ) {
        g.tapCandidate = false;
        g.lastTapTime = 0;
      }
    }
    if (g.swipeCandidate && e.touches.length === 1) {
      const t = e.touches[0]!;
      const dx = t.clientX - g.tapStartX;
      const dy = t.clientY - g.tapStartY;
      if (!g.swiping) {
        if (Math.abs(dx) > TAP_MOVE_PX && Math.abs(dx) > Math.abs(dy)) {
          g.swiping = true;
        } else if (Math.abs(dy) > TAP_MOVE_PX) {
          g.swipeCandidate = false;
        }
      }
      if (g.swiping) {
        e.preventDefault();
        const now = Date.now();
        g.prevMoveX = g.lastMoveX;
        g.prevMoveTime = g.lastMoveTime;
        g.lastMoveX = t.clientX;
        g.lastMoveTime = now;
        const direction: SwipeDirection = dx < 0 ? 'next' : 'prev';
        const open = canSwipeRef.current?.(direction) ?? true;
        // 1:1 with the finger; only a little past the first or last page.
        placeAside(open ? dx : dx * EDGE_RESISTANCE, 'none');
        return;
      }
    }
    if (e.touches.length === 2 && g.startDist > 0) {
      e.preventDefault();
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const nextScale = clamp(
        g.startScale * (dist / g.startDist),
        MIN_ZOOM,
        maxZoom
      );
      const { cx, cy } = getRect();
      const fx = g.focalX - cx;
      const fy = g.focalY - cy;
      const ratio = nextScale / g.startScale;
      const nextX = fx - (fx - g.startX) * ratio;
      const nextY = fy - (fy - g.startY) * ratio;
      const clamped = clampTranslate(nextScale, nextX, nextY);
      tf.current = { scale: nextScale, x: clamped.x, y: clamped.y };
      schedulePaint();
    } else if (e.touches.length === 1 && g.isPanning && tf.current.scale > 1) {
      e.preventDefault();
      const t = e.touches[0]!;
      const clamped = clampTranslate(
        tf.current.scale,
        t.clientX - g.panStartX,
        t.clientY - g.panStartY
      );
      tf.current = { ...tf.current, x: clamped.x, y: clamped.y };
      schedulePaint();
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const g = gesture.current;
    g.startDist = 0;
    if (e.touches.length === 0) {
      const now = Date.now();
      g.lastTouchTime = now;
      g.isPanning = false;
      if (g.swiping) {
        g.swipeCandidate = false;
        g.swiping = false;
        g.tapCandidate = false;
        const t = e.changedTouches[0];
        const dx = t ? t.clientX - g.tapStartX : 0;
        const direction: SwipeDirection = dx < 0 ? 'next' : 'prev';
        const elapsed = g.lastMoveTime - g.prevMoveTime;
        const speed =
          elapsed > 0 && now - g.lastMoveTime < 100
            ? (g.lastMoveX - g.prevMoveX) / elapsed
            : 0;
        const far =
          Math.abs(dx) >=
          Math.max(SWIPE_MIN_PX, getRect().width * SWIPE_WIDTH_SHARE);
        const flicked =
          Math.abs(dx) >= FLICK_MIN_PX &&
          Math.abs(speed) >= FLICK_SPEED &&
          Math.sign(speed) === Math.sign(dx);
        if (
          (far || flicked) &&
          (canSwipeRef.current?.(direction) ?? true)
        ) {
          void turnPage(direction);
        } else {
          springBack();
        }
        return;
      }
      g.swipeCandidate = false;
      g.swiping = false;
      if (g.tapCandidate && now - g.tapStartTime <= TAP_MAX_MS) {
        scheduleSingleTap();
      } else {
        g.lastTapTime = 0;
      }
      g.tapCandidate = false;
      if (tf.current.scale <= 1.01) reset(true);
    }
  };

  /** True for the click / dblclick the browser sends after a touch. */
  const fromTouch = () =>
    Date.now() - gesture.current.lastTouchTime < SYNTHETIC_MOUSE_MS;

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0018;
    const nextScale = clamp(tf.current.scale * (1 + delta), MIN_ZOOM, maxZoom);
    if (nextScale <= 1.01) reset(true);
    else zoomTo(nextScale, e.clientX, e.clientY);
  };

  return (
    <Box
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
      onClick={() => {
        if (!fromTouch()) scheduleSingleTap();
      }}
      onDoubleClick={(e) => {
        if (fromTouch()) return;
        cancelSingleTap();
        doubleTapZoom(e.clientX, e.clientY);
      }}
      sx={{
        alignItems: 'center',
        display: 'flex',
        height: '100%',
        justifyContent: 'center',
        overflow: 'hidden',
        touchAction: 'none',
        width: '100%',
      }}
    >
      <Box
        ref={contentRef}
        sx={{
          display: 'flex',
          justifyContent: 'center',
          transform: 'translate3d(0,0,0) scale(1)',
          transformOrigin: 'center center',
          willChange: 'transform',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

export default QortinoZoomableBox;
