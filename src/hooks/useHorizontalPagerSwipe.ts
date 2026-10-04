import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import {
  PAGER_IGNORE_ATTR,
  PAGER_RELEASE_EASING,
  PAGER_SCROLLER_ATTR,
  PAGER_SCROLL_SLOP_PX,
  PAGER_SLIDE_EASING,
  PAGER_VELOCITY_WINDOW_MS,
  isInPagerEdgeZone,
  isPagerScrollSettling,
  pagerDragOffset,
  pagerLiftVelocity,
  pagerSettleDurationMs,
  pagerTrackTransform,
  pagerTranslateX,
  pagerTravelForOffset,
  resolvePagerAxis,
  resolvePagerRelease,
  type PagerAxis,
  type PagerSample,
} from './horizontalPagerSwipe';

export interface HorizontalPagerSwipeOptions {
  /** Pages side by side and the swipe on. Off: the track is left alone. */
  enabled: boolean;
  /** The page showing (index from the left). */
  page: number;
  pageCount: number;
  /** A swipe was let go past the threshold: switch to `page`. */
  onPageChange: (page: number) => void;
  /** A touch has just locked to a horizontal drag (once per gesture). */
  onDragStart?: () => void;
  /** Slide (rather than jump) when `page` changes from outside, such as a
   * tap on a switch. Only when the page being left is on screen. */
  animatePageChange?: boolean;
  /** prefers-reduced-motion: no follow-the-finger motion and no slides; a
   * swipe past the threshold just switches. */
  reducedMotion?: boolean;
}

/** Length of the slide when the page changes from a tap. */
export const PAGER_PAGE_CHANGE_SLIDE_MS = 260;
/** After a horizontal drag, a click this soon belongs to the drag (longer
 * than any glide that follows it). */
export const PAGER_CLICK_GUARD_MS = 400;

interface Gesture {
  axis: PagerAxis | null;
  /** Current offset (px) of the content from its resting spot. */
  offset: number;
  /** Finger x where the drag locked; the content follows from here. */
  originX: number;
  page: number;
  samples: PagerSample[];
  /** The list the finger is on, and its scroll position at the start (after
   * any fling the touch stopped has settled): if it moves, the browser is
   * scrolling and the gesture is not a swipe. */
  scroller: HTMLElement | null;
  scrollTop: number;
  startT: number;
  startX: number;
  startY: number;
  /** Finger travel since the lock (px). */
  travel: number;
  width: number;
}

interface PagerMotion {
  /** The page the track rests on, or is gliding to. */
  page: number;
  /** A glide in progress, towards `page`. */
  settle: { page: number; timer: number } | null;
}

const pxTransform = (x: number) =>
  `translate3d(${Math.round(x * 100) / 100}px, 0, 0)`;

const trackWidth = (track: HTMLElement) =>
  track.parentElement?.clientWidth || window.innerWidth || 1;

/** Commit a style change so a transition set next starts from it. */
const flushStyle = (element: HTMLElement) => {
  void element.getBoundingClientRect();
};

function stopSettle(motion: PagerMotion) {
  if (!motion.settle) return;
  window.clearTimeout(motion.settle.timer);
  motion.settle = null;
}

/**
 * Glide the track from wherever it is to `target`'s resting spot (or jump
 * there for a zero duration). Once still, it rests in percent so a rotation
 * keeps the page in place. `onSettled` runs when a glide ends.
 */
function settleTrack(
  track: HTMLElement,
  motion: PagerMotion,
  target: number,
  durationMs: number,
  easing = PAGER_SLIDE_EASING,
  onSettled?: () => void
) {
  stopSettle(motion);
  motion.page = target;
  if (durationMs <= 0) {
    track.style.transition = 'none';
    track.style.transform = pagerTrackTransform(target);
    return;
  }
  track.style.transition = `transform ${durationMs}ms ${easing}`;
  track.style.transform = pxTransform(-target * trackWidth(track));
  motion.settle = {
    page: target,
    timer: window.setTimeout(() => {
      motion.settle = null;
      track.style.transition = 'none';
      track.style.transform = pagerTrackTransform(target);
      onSettled?.();
    }, durationMs + 40),
  };
}

/**
 * Turns horizontal swipes on `viewportRef` into page changes, moving
 * `trackRef` (the row of pages, each one viewport wide) with the finger.
 *
 * Listeners are native and passive: React's synthetic touch events would
 * also bubble in from portals (menus, dialogs), and nothing here ever needs
 * to cancel a touch. Vertical scrolling is left to the browser: the pager
 * marks the viewport and its lists `touch-action: pan-y`, so a swipe that
 * starts sideways never scrolls a list, and one that starts vertically is
 * never taken over. Only the track's transform is written per frame.
 */
export function useHorizontalPagerSwipe(
  viewportRef: RefObject<HTMLElement | null>,
  trackRef: RefObject<HTMLElement | null>,
  options: HorizontalPagerSwipeOptions
): void {
  const { enabled, page } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const motionRef = useRef<PagerMotion>({ page, settle: null });
  const gestureRef = useRef<Gesture | null>(null);
  /** The page shown the last time the pager was laid out while enabled. */
  const shownPageRef = useRef<number | null>(null);

  // Resting position. Runs before paint, so turning the pager on never
  // shows the wrong page for a frame.
  useLayoutEffect(() => {
    const track = trackRef.current;
    const motion = motionRef.current;
    if (!track) return;
    if (!enabled) {
      stopSettle(motion);
      gestureRef.current = null;
      shownPageRef.current = null;
      motion.page = page;
      track.style.transition = '';
      track.style.transform = '';
      return;
    }
    const previous = shownPageRef.current;
    shownPageRef.current = page;
    // A swipe already let go towards this page: the track is there, or
    // gliding there.
    if (previous !== null && motion.page === page) return;
    // Changed from outside mid-drag: that drag no longer applies.
    gestureRef.current = null;
    const { animatePageChange, reducedMotion } = optionsRef.current;
    if (
      previous === null ||
      previous === page ||
      !animatePageChange ||
      reducedMotion
    ) {
      settleTrack(track, motion, page, 0);
      return;
    }
    if (!motion.settle) {
      // Slide in from the page being left (mid-glide, from where it is).
      track.style.transition = 'none';
      track.style.transform = pxTransform(-previous * trackWidth(track));
      flushStyle(track);
    }
    settleTrack(track, motion, page, PAGER_PAGE_CHANGE_SLIDE_MS);
  }, [enabled, page, trackRef]);

  useEffect(() => {
    if (!enabled) return;
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    const motion = motionRef.current;
    let frame: number | null = null;
    let clickGuardUntil = 0;

    const now = () =>
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    const writeFrame = () => {
      frame = null;
      const gesture = gestureRef.current;
      if (gesture?.axis !== 'horizontal') return;
      track.style.transform = pxTransform(
        -gesture.page * gesture.width + gesture.offset
      );
    };

    const cancelFrame = () => {
      if (frame === null) return;
      cancelAnimationFrame(frame);
      frame = null;
    };

    // Should the parent not take the page a swipe chose, the track goes
    // back to the page it does show.
    const followParent = () => {
      const latest = optionsRef.current;
      if (latest.enabled && latest.page !== motion.page) {
        settleTrack(track, motion, latest.page, PAGER_PAGE_CHANGE_SLIDE_MS);
      }
    };

    /** End a horizontal drag: glide to `target` from where the drag left
     * the content. */
    const release = (ended: Gesture, target: number, velocity: number) => {
      cancelFrame();
      clickGuardUntil = now() + PAGER_CLICK_GUARD_MS;
      if (optionsRef.current.reducedMotion) {
        settleTrack(track, motion, target, 0);
        return;
      }
      const from = -ended.page * ended.width + ended.offset;
      const to = -target * ended.width;
      // The glide starts at the last finger position even if that frame
      // was not painted yet.
      track.style.transition = 'none';
      track.style.transform = pxTransform(from);
      flushStyle(track);
      settleTrack(
        track,
        motion,
        target,
        pagerSettleDurationMs(to - from, velocity, ended.width),
        PAGER_RELEASE_EASING,
        followParent
      );
    };

    /** Abandon the gesture; a horizontal drag springs back. */
    const cancelGesture = () => {
      const ended = gestureRef.current;
      gestureRef.current = null;
      if (ended?.axis === 'horizontal') release(ended, ended.page, 0);
    };

    /** Has the list under the finger scrolled since the gesture began? */
    const hasScrolled = (gesture: Gesture) =>
      gesture.scroller !== null &&
      Math.abs(gesture.scroller.scrollTop - gesture.scrollTop) >
        PAGER_SCROLL_SLOP_PX;

    /** The finger is at `x`: where the content goes. */
    const follow = (gesture: Gesture, x: number) => {
      gesture.travel = x - gesture.originX;
      const { pageCount, reducedMotion } = optionsRef.current;
      if (reducedMotion) return;
      gesture.offset = pagerDragOffset(
        gesture.page,
        gesture.travel,
        pageCount,
        gesture.width
      );
    };

    /**
     * The drag locks at `x`. Should the pages still be gliding (just after a
     * swipe, or a tap on the switch), the finger catches them where they
     * are and drags on from there, towards or back from the page they were
     * heading to.
     */
    const lockDrag = (gesture: Gesture, x: number) => {
      let caught = 0;
      if (motion.settle) {
        const translateX = pagerTranslateX(
          window.getComputedStyle(track).transform,
          gesture.width
        );
        stopSettle(motion);
        if (translateX !== null) {
          caught = pagerTravelForOffset(
            gesture.page,
            translateX + gesture.page * gesture.width,
            optionsRef.current.pageCount
          );
        }
      }
      gesture.originX = x - caught;
      track.style.transition = 'none';
      if (caught !== 0) {
        follow(gesture, x);
        track.style.transform = pxTransform(
          -gesture.page * gesture.width + gesture.offset
        );
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        // A second finger: neither a swipe nor a tap of ours.
        cancelGesture();
        return;
      }
      gestureRef.current = null;
      // A touch on still content is a tap again, whatever came before. One
      // on pages still gliding from a drag keeps that drag's click guard:
      // its tap would land on a moving row. After a tap on the switch there
      // is no guard, so a row tapped straight after it opens.
      if (!motion.settle) clickGuardUntil = 0;
      const touch = event.touches[0];
      if (isInPagerEdgeZone(touch.clientX, window.innerWidth)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`[${PAGER_IGNORE_ATTR}]`)) return;
      const scroller =
        target?.closest<HTMLElement>(`[${PAGER_SCROLLER_ATTR}]`) ?? null;
      gestureRef.current = {
        axis: null,
        offset: 0,
        originX: touch.clientX,
        page: motion.page,
        samples: [],
        scroller,
        scrollTop: scroller?.scrollTop ?? 0,
        startT: event.timeStamp,
        startX: touch.clientX,
        startY: touch.clientY,
        travel: 0,
        width: viewport.clientWidth || window.innerWidth || 1,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (
        !gesture ||
        (gesture.axis !== null && gesture.axis !== 'horizontal')
      ) {
        return;
      }
      if (event.touches.length !== 1) {
        cancelGesture();
        return;
      }
      const touch = event.touches[0];
      if (gesture.axis === null) {
        const dx = touch.clientX - gesture.startX;
        const dy = touch.clientY - gesture.startY;
        const elapsed = event.timeStamp - gesture.startT;
        if (hasScrolled(gesture)) {
          if (!isPagerScrollSettling(dx, dy, elapsed)) {
            gesture.axis = 'vertical';
            return;
          }
          // The last frames of a fling this touch stopped, not a scroll
          // it started: measure from here.
          gesture.scrollTop = gesture.scroller?.scrollTop ?? 0;
        }
        const axis = resolvePagerAxis(dx, dy, elapsed);
        if (axis === null) return;
        gesture.axis = axis;
        if (axis !== 'horizontal') return;
        lockDrag(gesture, touch.clientX);
        optionsRef.current.onDragStart?.();
      } else if (hasScrolled(gesture)) {
        // The browser scrolled the list after all: the gesture is its.
        cancelGesture();
        return;
      }
      follow(gesture, touch.clientX);
      gesture.samples.push({ t: event.timeStamp, x: touch.clientX });
      while (
        gesture.samples.length > 2 &&
        event.timeStamp - gesture.samples[0].t > PAGER_VELOCITY_WINDOW_MS * 2
      ) {
        gesture.samples.shift();
      }
      if (optionsRef.current.reducedMotion) return;
      if (frame === null) frame = requestAnimationFrame(writeFrame);
    };

    const onTouchEnd = (event: TouchEvent) => {
      const ended = gestureRef.current;
      if (!ended) return;
      gestureRef.current = null;
      if (ended.axis !== 'horizontal') return;
      if (event.type === 'touchcancel') {
        release(ended, ended.page, 0);
        return;
      }
      const { onPageChange, pageCount } = optionsRef.current;
      // The lift is a sample too: a finger that rested before it sent no
      // moves, and its last moves would otherwise still read as a flick.
      const lifted = event.changedTouches?.[0];
      const last = ended.samples[ended.samples.length - 1];
      const lift: PagerSample = {
        t: event.timeStamp,
        x: lifted?.clientX ?? last?.x ?? ended.originX + ended.travel,
      };
      follow(ended, lift.x);
      const velocity = pagerLiftVelocity(ended.samples, lift);
      const target = resolvePagerRelease({
        dx: ended.travel,
        page: ended.page,
        pageCount,
        velocity,
        width: ended.width,
      });
      release(ended, target, velocity);
      if (target !== ended.page) onPageChange(target);
    };

    // A drag never also opens the row under the finger, nor one on the
    // pages still gliding after it.
    const onClickCapture = (event: MouseEvent) => {
      if (now() >= clickGuardUntil) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const passive = { passive: true } as const;
    viewport.addEventListener('touchstart', onTouchStart, passive);
    viewport.addEventListener('touchmove', onTouchMove, passive);
    viewport.addEventListener('touchend', onTouchEnd, passive);
    viewport.addEventListener('touchcancel', onTouchEnd, passive);
    viewport.addEventListener('click', onClickCapture, true);
    return () => {
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onTouchEnd);
      viewport.removeEventListener('touchcancel', onTouchEnd);
      viewport.removeEventListener('click', onClickCapture, true);
      cancelFrame();
      gestureRef.current = null;
    };
  }, [enabled, trackRef, viewportRef]);

  useEffect(() => {
    const motion = motionRef.current;
    return () => stopSettle(motion);
  }, []);
}
