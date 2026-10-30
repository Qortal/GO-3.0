import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  PAGER_VELOCITY_WINDOW_MS,
  isInPagerEdgeZone,
  pagerDragOffset,
  pagerLiftVelocity,
  resolvePagerAxis,
  resolvePagerRelease,
  type PagerAxis,
  type PagerSample,
} from './horizontalPagerSwipe';
import { findHorizontalOwner } from '../components/Mobile/sectionSwipe/sectionSwipe';

/** How far (share of the width) a page travels while sliding out or in. */
const SLIDE_SHARE = 0.32;
const SLIDE_OUT_MS = 140;
const SLIDE_IN_MS = 230;
const SPRING_BACK_MS = 220;
/** A tap on another tab slides its page in by this much (px). */
const TAP_SLIDE_PX = 28;
const CLICK_GUARD_MS = 400;
const EASE_OUT = 'cubic-bezier(0.33, 1, 0.68, 1)';
const EASE_IN = 'cubic-bezier(0.32, 0, 0.67, 0)';

interface SwipeBetweenTabsOptions {
  enabled: boolean;
  /** The tab showing, by position in the strip. */
  index: number;
  count: number;
  onChange: (index: number) => void;
  /** No motion: a swipe past the threshold just switches. */
  reducedMotion?: boolean;
  /** The page puts each tab's scroll position back itself: do not reset it
   * to the top on a tab change. */
  keepScroll?: boolean;
}

interface Gesture {
  axis: PagerAxis | null;
  offset: number;
  originX: number;
  samples: PagerSample[];
  startT: number;
  startX: number;
  startY: number;
  target: Element | null;
  travel: number;
  width: number;
}

const transformFor = (x: number) =>
  `translate3d(${Math.round(x * 100) / 100}px, 0, 0)`;

/**
 * Sideways swipes on `page` (a tabbed page such as Settings on a phone)
 * move to the next or previous tab: the page follows the finger, then slides
 * out and the new tab's page slides in from that side. Only one tab is ever
 * built, so the neighbour is not shown during the drag. Thresholds and the
 * axis lock come from the chat list pager. Text fields, sliders and anything
 * that scrolls sideways keep their own drags.
 */
export function useSwipeBetweenTabs(
  /** The element, not a ref: a dialog builds it only once it opens. */
  page: HTMLElement | null,
  options: SwipeBetweenTabsOptions
): void {
  const { enabled, index } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const gestureRef = useRef<Gesture | null>(null);
  const timerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  /** The side the next page should come in from (+1 right, -1 left). */
  const incomingFromRef = useRef<{ side: number; byPx: number } | null>(null);
  const shownIndexRef = useRef(index);
  const pageRef = useRef(page);
  pageRef.current = page;

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const setPage = (transform: string, opacity: string, transition = 'none') => {
    const page = pageRef.current;
    if (!page) return;
    page.style.transition = transition;
    page.style.transform = transform;
    page.style.opacity = opacity;
  };

  const resetPage = () => {
    const page = pageRef.current;
    if (!page) return;
    page.style.transition = '';
    page.style.transform = '';
    page.style.opacity = '';
    page.style.willChange = '';
  };

  // A new tab: start its page at the top and slide it in from the side it
  // came from (a swipe's side, or the tab strip's direction for a tap).
  useLayoutEffect(() => {
    const previous = shownIndexRef.current;
    shownIndexRef.current = index;
    if (previous === index) return;
    const page = pageRef.current;
    if (!page) return;
    const { keepScroll, reducedMotion } = optionsRef.current;
    if (!keepScroll) page.scrollTop = 0;
    clearTimer();
    const incoming = incomingFromRef.current ?? {
      side: Math.sign(index - previous),
      byPx: TAP_SLIDE_PX,
    };
    incomingFromRef.current = null;
    if (reducedMotion || !enabled) {
      resetPage();
      return;
    }
    page.style.willChange = 'transform, opacity';
    setPage(transformFor(incoming.side * incoming.byPx), '0');
    void page.getBoundingClientRect();
    setPage(
      'translate3d(0px, 0, 0)',
      '1',
      `transform ${SLIDE_IN_MS}ms ${EASE_OUT}, opacity ${SLIDE_IN_MS}ms ${EASE_OUT}`
    );
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      resetPage();
    }, SLIDE_IN_MS + 40);
  }, [enabled, index]);

  useEffect(() => {
    if (!enabled || !page) return;
    let clickGuardUntil = 0;
    const now = () => performance.now();

    const write = () => {
      frameRef.current = null;
      const gesture = gestureRef.current;
      if (gesture?.axis !== 'horizontal') return;
      const fade = Math.min(
        0.4,
        (Math.abs(gesture.offset) / gesture.width) * 0.6
      );
      setPage(transformFor(gesture.offset), String(1 - fade));
    };

    const springBack = () => {
      setPage(
        'translate3d(0px, 0, 0)',
        '1',
        `transform ${SPRING_BACK_MS}ms ${EASE_OUT}, opacity ${SPRING_BACK_MS}ms ${EASE_OUT}`
      );
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        resetPage();
      }, SPRING_BACK_MS + 40);
    };

    const onTouchStart = (event: TouchEvent) => {
      gestureRef.current = null;
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (isInPagerEdgeZone(touch.clientX, window.innerWidth)) return;
      clickGuardUntil = 0;
      gestureRef.current = {
        axis: null,
        offset: 0,
        originX: touch.clientX,
        samples: [],
        startT: event.timeStamp,
        startX: touch.clientX,
        startY: touch.clientY,
        target: event.target instanceof Element ? event.target : null,
        travel: 0,
        width: page.clientWidth || window.innerWidth || 1,
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
        gestureRef.current = null;
        if (gesture.axis === 'horizontal') springBack();
        return;
      }
      const touch = event.touches[0];
      if (gesture.axis === null) {
        const axis = resolvePagerAxis(
          touch.clientX - gesture.startX,
          touch.clientY - gesture.startY,
          event.timeStamp - gesture.startT
        );
        if (axis === null) return;
        if (
          axis !== 'horizontal' ||
          findHorizontalOwner(gesture.target, page) !== null
        ) {
          gesture.axis = 'vertical';
          return;
        }
        gesture.axis = 'horizontal';
        gesture.originX = touch.clientX;
        clearTimer();
        page.style.willChange = 'transform, opacity';
      }
      const { reducedMotion } = optionsRef.current;
      const { count } = optionsRef.current;
      gesture.travel = touch.clientX - gesture.originX;
      gesture.offset = reducedMotion
        ? 0
        : pagerDragOffset(
            shownIndexRef.current,
            gesture.travel,
            count,
            gesture.width
          );
      gesture.samples.push({ t: event.timeStamp, x: touch.clientX });
      while (
        gesture.samples.length > 2 &&
        event.timeStamp - gesture.samples[0].t > PAGER_VELOCITY_WINDOW_MS * 2
      ) {
        gesture.samples.shift();
      }
      if (!reducedMotion && frameRef.current === null) {
        frameRef.current = requestAnimationFrame(write);
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (gesture?.axis !== 'horizontal') return;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      clickGuardUntil = now() + CLICK_GUARD_MS;
      if (event.type === 'touchcancel') {
        springBack();
        return;
      }
      const { count, onChange, reducedMotion } = optionsRef.current;
      const current = shownIndexRef.current;
      const lifted = event.changedTouches?.[0];
      const last = gesture.samples[gesture.samples.length - 1];
      const lift: PagerSample = {
        t: event.timeStamp,
        x: lifted?.clientX ?? last?.x ?? gesture.originX + gesture.travel,
      };
      const travel = lift.x - gesture.originX;
      const target = resolvePagerRelease({
        dx: travel,
        page: current,
        pageCount: count,
        velocity: pagerLiftVelocity(gesture.samples, lift),
        width: gesture.width,
      });
      if (target === current) {
        if (reducedMotion) resetPage();
        else springBack();
        return;
      }
      // Finger left (to the next tab): the page leaves to the left and the
      // next one comes in from the right.
      const side = target > current ? 1 : -1;
      incomingFromRef.current = {
        side,
        byPx: gesture.width * SLIDE_SHARE,
      };
      if (reducedMotion) {
        resetPage();
        onChange(target);
        return;
      }
      setPage(
        transformFor(-side * gesture.width * SLIDE_SHARE),
        '0',
        `transform ${SLIDE_OUT_MS}ms ${EASE_IN}, opacity ${SLIDE_OUT_MS}ms ${EASE_IN}`
      );
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        onChange(target);
      }, SLIDE_OUT_MS);
    };

    // A swipe never also taps what was under the finger.
    const onClickCapture = (event: MouseEvent) => {
      if (now() >= clickGuardUntil) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const passive = { passive: true } as const;
    page.addEventListener('touchstart', onTouchStart, passive);
    page.addEventListener('touchmove', onTouchMove, passive);
    page.addEventListener('touchend', onTouchEnd, passive);
    page.addEventListener('touchcancel', onTouchEnd, passive);
    page.addEventListener('click', onClickCapture, true);
    return () => {
      page.removeEventListener('touchstart', onTouchStart);
      page.removeEventListener('touchmove', onTouchMove);
      page.removeEventListener('touchend', onTouchEnd);
      page.removeEventListener('touchcancel', onTouchEnd);
      page.removeEventListener('click', onClickCapture, true);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      gestureRef.current = null;
    };
  }, [enabled, page]);

  useEffect(
    () => () => {
      clearTimer();
      resetPage();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
}
