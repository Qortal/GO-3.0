import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
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
  pagerTargetForDrag,
  pagerTrackTransform,
  pagerTranslateX,
  pagerTravelForOffset,
  resolvePagerAxis,
  resolvePagerRelease,
  type PagerAxis,
  type PagerSample,
} from './horizontalPagerSwipe';
import { claimHorizontalGesture } from './horizontalGestureClaim';

export type TrackPositionListener = (
  position: number,
  durationMs: number,
  easing: string
) => void;

interface HorizontalPagerSwipeOptions {
  /** Pages side by side and the swipe on. Off: the track is left alone. */
  enabled: boolean;
  /** The page showing (index from the left). */
  page: number;
  pageCount: number;
  /**
   * A swipe was let go past the threshold: switch to `page`. Should a tap
   * land on that page before the switch has rendered, it is called again
   * for the same page, so it must set the page, not toggle it.
   */
  onPageChange: (page: number) => void;
  /** A touch has just locked to a horizontal drag (once per gesture). */
  onDragStart?: () => void;
  /** Slide (rather than jump) when `page` changes from outside, such as a
   * tap on a switch. Only when the page being left is on screen. */
  animatePageChange?: boolean;
  /** prefers-reduced-motion: no follow-the-finger motion and no slides; a
   * swipe past the threshold just switches. */
  reducedMotion?: boolean;
  /**
   * A swipe towards no page (past the first or last) is left to whatever
   * holds the pager, here the swipe between Home, Apps and Chat, instead of
   * rubber-banding. Swipes the pager does take are claimed
   * (horizontalGestureClaim) so that outer swipe leaves them alone.
   */
  releaseEdges?: boolean;
  /**
   * Where the pages are, as a fractional page index (0 = first page), each
   * time the track moves: per frame while dragging (`durationMs` 0), and at
   * the start of each glide with that glide's length and easing. Lets
   * something outside the track (the header's switch) move with it. With
   * the swipe off, a page change reports a glide too, though only that
   * something moves.
   */
  onTrackPosition?: TrackPositionListener;
}

/** Length of the slide when the page changes from a tap. */
const PAGER_PAGE_CHANGE_SLIDE_MS = 260;
/** How long a glide waits, at most, for the parent to take the page it
 * asked for before going back to the page the parent shows. */
const PARENT_CATCH_UP_MS = 1500;

interface HorizontalPagerSwipeControls {
  /**
   * Glide to `page` now, as a released swipe does, and tell the parent once
   * the glide is on screen (a tap on the Groups / DMs switch).
   */
  slideTo: (page: number) => void;
}
/** After a horizontal drag, a click this soon belongs to the drag (longer
 * than any glide that follows it). */
const PAGER_CLICK_GUARD_MS = 400;

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
  onSettled?: () => void,
  onPosition?: TrackPositionListener
) {
  stopSettle(motion);
  motion.page = target;
  if (durationMs <= 0) {
    track.style.transition = 'none';
    track.style.transform = pagerTrackTransform(target);
    onPosition?.(target, 0, easing);
    return;
  }
  onPosition?.(target, durationMs, easing);
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
 * marks the viewport and its lists (SECTION_SURFACE_TOUCH_ACTION) so a
 * swipe that starts sideways never scrolls a list, and one that starts
 * vertically is never taken over. Only the track's transform is written per frame.
 */
export function useHorizontalPagerSwipe(
  viewportRef: RefObject<HTMLElement | null>,
  trackRef: RefObject<HTMLElement | null>,
  options: HorizontalPagerSwipeOptions
): HorizontalPagerSwipeControls {
  const { enabled, page } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const motionRef = useRef<PagerMotion>({ page, settle: null });
  /**
   * A page this pager asked the parent for, until the parent shows it.
   * Asked only once the glide is on screen: the parent's re-render (the
   * whole chat on a phone) would otherwise hold the first frame back, and
   * the pages would sit still under the lifted finger, then jump.
   */
  const pendingPageRef = useRef<{ page: number; since: number } | null>(null);
  const requestPageChange = (target: number) => {
    const asked = { page: target, since: performance.now() };
    pendingPageRef.current = asked;
    const ask = () => {
      if (pendingPageRef.current !== asked) return;
      if (optionsRef.current.page === target) {
        pendingPageRef.current = null;
        return;
      }
      optionsRef.current.onPageChange(target);
    };
    // After the next frame (the glide's first, sent to the compositor,
    // which runs it on its own from there).
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => window.setTimeout(ask, 0));
    } else {
      window.setTimeout(ask, 0);
    }
  };
  const reportPosition: TrackPositionListener = (
    position,
    durationMs,
    easing
  ) => optionsRef.current.onTrackPosition?.(position, durationMs, easing);
  const gestureRef = useRef<Gesture | null>(null);

  /**
   * When a glide ends: should the parent not show the page it went to, the
   * track goes back to the page the parent does show, once the parent had
   * time to take the one asked for. Never under a finger or another glide
   * (those end here again).
   */
  const followParent = () => {
    const track = trackRef.current;
    const motion = motionRef.current;
    const latest = optionsRef.current;
    if (!track || !latest.enabled || latest.page === motion.page) return;
    if (motion.settle || gestureRef.current?.axis === 'horizontal') return;
    const pending = pendingPageRef.current;
    if (
      pending?.page === motion.page &&
      performance.now() - pending.since < PARENT_CATCH_UP_MS
    ) {
      window.setTimeout(followParent, 120);
      return;
    }
    pendingPageRef.current = null;
    settleTrack(
      track,
      motion,
      latest.page,
      PAGER_PAGE_CHANGE_SLIDE_MS,
      undefined,
      undefined,
      reportPosition
    );
  };
  /** The page shown the last time the pager was laid out while enabled. */
  const shownPageRef = useRef<number | null>(null);

  // Resting position. Runs before paint, so turning the pager on never
  // shows the wrong page for a frame.
  useLayoutEffect(() => {
    const track = trackRef.current;
    const motion = motionRef.current;
    if (!track) return;
    if (!enabled) {
      const changed = motion.page !== page;
      stopSettle(motion);
      gestureRef.current = null;
      shownPageRef.current = null;
      motion.page = page;
      track.style.transition = '';
      track.style.transform = '';
      reportPosition(
        page,
        changed && !optionsRef.current.reducedMotion
          ? PAGER_PAGE_CHANGE_SLIDE_MS
          : 0,
        PAGER_SLIDE_EASING
      );
      return;
    }
    if (pendingPageRef.current?.page === page) pendingPageRef.current = null;
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
      settleTrack(track, motion, page, 0, undefined, undefined, reportPosition);
      return;
    }
    if (!motion.settle) {
      // Slide in from the page being left (mid-glide, from where it is).
      track.style.transition = 'none';
      track.style.transform = pxTransform(-previous * trackWidth(track));
      reportPosition(previous, 0, PAGER_SLIDE_EASING);
      flushStyle(track);
    }
    settleTrack(
      track,
      motion,
      page,
      PAGER_PAGE_CHANGE_SLIDE_MS,
      undefined,
      undefined,
      reportPosition
    );
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
      reportPosition(
        gesture.page - gesture.offset / gesture.width,
        0,
        PAGER_SLIDE_EASING
      );
    };

    const cancelFrame = () => {
      if (frame === null) return;
      cancelAnimationFrame(frame);
      frame = null;
    };

    /** End a horizontal drag: glide to `target` from where the drag left
     * the content. */
    const release = (ended: Gesture, target: number, velocity: number) => {
      cancelFrame();
      clickGuardUntil = now() + PAGER_CLICK_GUARD_MS;
      if (optionsRef.current.reducedMotion) {
        settleTrack(
          track,
          motion,
          target,
          0,
          undefined,
          undefined,
          reportPosition
        );
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
        followParent,
        reportPosition
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
        reportPosition(
          gesture.page - gesture.offset / gesture.width,
          0,
          PAGER_SLIDE_EASING
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
      // on pages still gliding from a drag keeps that drag's click guard
      // until it turns out to be a tap: then the pages land first (see
      // landForTap). After a tap on the switch there is no guard, so a row
      // tapped straight after it opens.
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
        const { pageCount, releaseEdges } = optionsRef.current;
        if (
          releaseEdges &&
          !motion.settle &&
          pagerTargetForDrag(gesture.page, dx, pageCount) === null
        ) {
          // No page that way: the section swipe's gesture, not ours.
          gesture.axis = 'vertical';
          return;
        }
        if (releaseEdges) claimHorizontalGesture(gesture.startT);
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

    /**
     * A tap while the pages still glide, or before the parent has switched
     * to the page a swipe went to (until then that page is inert): the
     * pages land and the parent switches now, before the tap's click, so
     * the click opens the row it landed on instead of being lost.
     */
    const landForTap = () => {
      if (motion.settle) {
        settleTrack(
          track,
          motion,
          motion.page,
          0,
          undefined,
          undefined,
          reportPosition
        );
        clickGuardUntil = 0;
      }
      const pending = pendingPageRef.current;
      if (
        pending?.page === motion.page &&
        optionsRef.current.page !== pending.page
      ) {
        flushSync(() => optionsRef.current.onPageChange(pending.page));
      }
      // (Should the parent have kept its page after all.)
      followParent();
    };

    const onTouchEnd = (event: TouchEvent) => {
      const ended = gestureRef.current;
      if (!ended) return;
      gestureRef.current = null;
      if (ended.axis !== 'horizontal') {
        // Neither a swipe nor a scroll: a tap, or a press and hold.
        if (ended.axis !== 'vertical' && event.type === 'touchend') {
          landForTap();
        }
        return;
      }
      if (event.type === 'touchcancel') {
        release(ended, ended.page, 0);
        return;
      }
      const { pageCount } = optionsRef.current;
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
      if (target !== ended.page) requestPageChange(target);
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

  const slideTo = useCallback(
    (target: number) => {
      const track = trackRef.current;
      const motion = motionRef.current;
      const latest = optionsRef.current;
      if (
        !track ||
        !latest.enabled ||
        !latest.animatePageChange ||
        latest.reducedMotion
      ) {
        // Nothing glides (only one list shows, the other page is not built
        // yet, or reduced motion): the parent just switches.
        if (target !== latest.page) latest.onPageChange(target);
        return;
      }
      if (target === motion.page) {
        // Already there or gliding there (a swipe the parent has not taken
        // yet, say).
        if (target !== latest.page) requestPageChange(target);
        return;
      }
      // A drag under way no longer applies.
      gestureRef.current = null;
      if (!motion.settle) {
        // From the page showing (mid-glide, the transition carries on from
        // wherever it has the track).
        track.style.transition = 'none';
        track.style.transform = pxTransform(-motion.page * trackWidth(track));
        reportPosition(motion.page, 0, PAGER_SLIDE_EASING);
        flushStyle(track);
      }
      settleTrack(
        track,
        motion,
        target,
        PAGER_PAGE_CHANGE_SLIDE_MS,
        undefined,
        followParent,
        reportPosition
      );
      requestPageChange(target);
    },
    // Reads everything through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackRef]
  );

  return { slideTo };
}
