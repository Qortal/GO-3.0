import { useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import {
  PAGER_RELEASE_EASING,
  PAGER_VELOCITY_WINDOW_MS,
  pagerLiftVelocity,
  pagerSettleDurationMs,
  resolvePagerAxis,
  resolvePagerRelease,
  type PagerAxis,
  type PagerSample,
} from '../../hooks/horizontalPagerSwipe';
import {
  claimHorizontalGesture,
  isHorizontalGestureClaimed,
} from '../../hooks/horizontalGestureClaim';
import { findHorizontalOwner } from '../Mobile/sectionSwipe/sectionSwipe';

/** How far left (share of the width) the list waits under the chat. */
const SWIPE_BACK_PARALLAX = 0.3;
const SPRING_BACK_MS = 220;
const CLICK_GUARD_MS = 400;
const shadowFor = (direction: SwipeDirection) =>
  `${direction === 'back' ? -10 : 10}px 0 28px rgba(0, 0, 0, 0.35)`;

/** 'back': finger to the right (the list on the left). 'forward': to the
 * left, to the list on the right. */
type SwipeDirection = 'back' | 'forward';

interface SwipeBackToListOptions {
  enabled: boolean;
  /** Swiped right far enough: close the chat for its list. */
  onBack: () => void;
  /** Swiped left far enough (only when given): close it for the list on the
   * right (a group chat: the DMs). */
  onForward?: () => void;
  /**
   * A swipe has started that way: put the list it leads to in the list panel
   * (or `null`: it sprang back, show the usual one again).
   */
  onReveal?: (direction: SwipeDirection | null) => void;
  /** No motion: a swipe past the threshold just goes. */
  reducedMotion?: boolean;
}

interface Gesture {
  axis: PagerAxis | null;
  direction: SwipeDirection;
  offset: number;
  originX: number;
  samples: PagerSample[];
  startT: number;
  startX: number;
  startY: number;
  target: Element | null;
  width: number;
}

const px = (x: number) => `translate3d(${Math.round(x * 100) / 100}px, 0, 0)`;

/** The inline styles this hook writes, cleared when it is done. */
const CHAT_PROPS = [
  'transform',
  'transition',
  'box-shadow',
  'z-index',
  'will-change',
  'pointer-events',
] as const;
const LIST_PROPS = [
  'transform',
  'transition',
  'width',
  'max-width',
  'box-shadow',
  'will-change',
  'pointer-events',
] as const;

const clear = (element: HTMLElement | null, props: readonly string[]) => {
  if (!element) return;
  for (const prop of props) element.style.removeProperty(prop);
};

/**
 * Sideways swipes on an open chat on a phone lead back to the lists, the way
 * the system back does: to the right the chat follows the finger off and its
 * list comes out from under it (from a little to the left, as on iOS); to
 * the left, when `onForward` is given (a group chat), the same towards the
 * list on the right (the DMs). Let go past about a quarter of the width, or
 * with a flick, and the chat closes through `onBack` / `onForward`;
 * otherwise it springs back.
 *
 * `list` is the list panel, normally hidden off to the left (or swiped in
 * over the chat at 86% width); during the swipe it is laid out at full
 * width under the chat, showing what `onReveal` asked for. Text fields,
 * sliders, media and anything that scrolls sideways keep their own drags.
 */
export function useSwipeBackToList(
  chat: HTMLElement | null,
  list: HTMLElement | null,
  options: SwipeBackToListOptions
): void {
  const { enabled } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const elementsRef = useRef({ chat, list });
  elementsRef.current = { chat, list };
  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  /** The chat has slid away and `onBack` ran: tidy up once it has closed. */
  const leavingRef = useRef(false);
  /** While the chat glides off: closes it at once (a tap on the list). */
  const leaveNowRef = useRef<(() => void) | null>(null);

  const clearTimer = () => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  /** The chat `offset` px across (negative: to the left); the list waits a
   * little off to the side it comes from and follows. */
  const place = (
    offset: number,
    width: number,
    direction: SwipeDirection,
    transition = 'none'
  ) => {
    const { chat: chatEl, list: listEl } = elementsRef.current;
    const share =
      width > 0 ? Math.min(1, Math.max(0, Math.abs(offset) / width)) : 0;
    const side = direction === 'forward' ? 1 : -1;
    if (chatEl) {
      chatEl.style.transition = transition;
      chatEl.style.transform = px(offset);
    }
    if (listEl) {
      listEl.style.transition = transition;
      listEl.style.transform = px(
        side * SWIPE_BACK_PARALLAX * width * (1 - share)
      );
    }
  };

  const lift = (width: number, direction: SwipeDirection) => {
    const { chat: chatEl, list: listEl } = elementsRef.current;
    if (chatEl) {
      chatEl.style.willChange = 'transform';
      chatEl.style.zIndex = '41';
      chatEl.style.boxShadow = shadowFor(direction);
    }
    if (listEl) {
      listEl.style.willChange = 'transform';
      listEl.style.width = '100%';
      listEl.style.maxWidth = 'none';
      listEl.style.boxShadow = 'none';
    }
    place(0, width, direction);
  };

  /** Back to how the page lays them out, without the list sliding visibly. */
  const reset = () => {
    const { chat: chatEl, list: listEl } = elementsRef.current;
    if (listEl && !leavingRef.current) {
      // Under the chat it goes back off screen at once; its own transition
      // must not play it across the chat.
      listEl.style.transition = 'none';
      listEl.style.transform = 'translateX(-100%)';
      void listEl.getBoundingClientRect();
    }
    clear(listEl, LIST_PROPS);
    clear(chatEl, CHAT_PROPS);
  };

  // The chat closed after a swipe back (or the swipe was turned off mid-way):
  // the page's own layout takes over in the same frame.
  useLayoutEffect(() => {
    if (enabled) return;
    clearTimer();
    leaveNowRef.current = null;
    gestureRef.current = null;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    reset();
    leavingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !chat) return;
    let clickGuardUntil = 0;
    const now = () => performance.now();

    const write = () => {
      frameRef.current = null;
      const gesture = gestureRef.current;
      if (gesture?.axis !== 'horizontal') return;
      place(gesture.offset, gesture.width, gesture.direction);
    };

    const springBack = (gesture: Gesture) => {
      // Back to rest: the list slides back towards its own side.
      place(
        0,
        gesture.width,
        gesture.direction,
        `transform ${SPRING_BACK_MS}ms ${PAGER_RELEASE_EASING}`
      );
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        reset();
        optionsRef.current.onReveal?.(null);
      }, SPRING_BACK_MS + 30);
    };

    const go = (gesture: Gesture, velocity: number) => {
      const { reducedMotion } = optionsRef.current;
      const leave = () => {
        const { onBack, onForward } = optionsRef.current;
        if (gesture.direction === 'back') onBack();
        else onForward?.();
      };
      leavingRef.current = true;
      if (reducedMotion) {
        leave();
        return;
      }
      const towards = gesture.direction === 'back' ? 1 : -1;
      const ms = pagerSettleDurationMs(
        gesture.width - Math.abs(gesture.offset),
        velocity,
        gesture.width
      );
      place(
        towards * gesture.width,
        gesture.width,
        gesture.direction,
        `transform ${ms}ms ${PAGER_RELEASE_EASING}`
      );
      // The list it goes to takes the taps from now on, not the chat
      // leaving over it (see onListTouchEnd).
      const { chat: chatEl, list: listEl } = elementsRef.current;
      if (chatEl) chatEl.style.pointerEvents = 'none';
      if (listEl) listEl.style.pointerEvents = 'auto';
      const leaveNow = () => {
        leaveNowRef.current = null;
        clearTimer();
        leave();
        // Should the chat not close after all, it comes back rather than
        // staying off screen.
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          if (!leavingRef.current) return;
          leavingRef.current = false;
          place(0, gesture.width, gesture.direction);
          reset();
          optionsRef.current.onReveal?.(null);
        }, 600);
      };
      leaveNowRef.current = leaveNow;
      clearTimer();
      timerRef.current = window.setTimeout(leaveNow, ms + 20);
    };

    const onTouchStart = (event: TouchEvent) => {
      gestureRef.current = null;
      if (event.touches.length !== 1 || leavingRef.current) return;
      clickGuardUntil = 0;
      const touch = event.touches[0];
      gestureRef.current = {
        axis: null,
        direction: 'back',
        offset: 0,
        originX: touch.clientX,
        samples: [],
        startT: event.timeStamp,
        startX: touch.clientX,
        startY: touch.clientY,
        target: event.target instanceof Element ? event.target : null,
        width: chat.clientWidth || window.innerWidth || 1,
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
        if (gesture.axis === 'horizontal') springBack(gesture);
        return;
      }
      const touch = event.touches[0];
      if (gesture.axis === null) {
        const dx = touch.clientX - gesture.startX;
        const axis = resolvePagerAxis(
          dx,
          touch.clientY - gesture.startY,
          event.timeStamp - gesture.startT
        );
        if (axis === null) return;
        const direction: SwipeDirection = dx > 0 ? 'back' : 'forward';
        if (
          axis !== 'horizontal' ||
          (direction === 'forward' && !optionsRef.current.onForward) ||
          isHorizontalGestureClaimed(gesture.startT) ||
          findHorizontalOwner(gesture.target, chat) !== null
        ) {
          gesture.axis = 'vertical';
          return;
        }
        claimHorizontalGesture(gesture.startT);
        gesture.axis = 'horizontal';
        gesture.direction = direction;
        gesture.originX = touch.clientX;
        clearTimer();
        optionsRef.current.onReveal?.(direction);
        lift(gesture.width, direction);
      }
      const moved = touch.clientX - gesture.originX;
      gesture.offset = optionsRef.current.reducedMotion
        ? 0
        : gesture.direction === 'back'
          ? Math.max(0, moved)
          : Math.min(0, moved);
      gesture.samples.push({ t: event.timeStamp, x: touch.clientX });
      while (
        gesture.samples.length > 2 &&
        event.timeStamp - gesture.samples[0].t > PAGER_VELOCITY_WINDOW_MS * 2
      ) {
        gesture.samples.shift();
      }
      if (frameRef.current === null) {
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
        springBack(gesture);
        return;
      }
      const lifted = event.changedTouches?.[0];
      const last = gesture.samples[gesture.samples.length - 1];
      const at: PagerSample = {
        t: event.timeStamp,
        x: lifted?.clientX ?? last?.x ?? gesture.originX + gesture.offset,
      };
      const back = gesture.direction === 'back';
      const travel = back
        ? Math.max(0, at.x - gesture.originX)
        : Math.min(0, at.x - gesture.originX);
      const velocity = pagerLiftVelocity(gesture.samples, at);
      // The chat as a page between its two lists: going back it is page 1
      // of 2 (the list at 0), going forward page 0 (the list at 1).
      const page = back ? 1 : 0;
      const target = resolvePagerRelease({
        dx: travel,
        page,
        pageCount: 2,
        velocity,
        width: gesture.width,
      });
      if (!optionsRef.current.reducedMotion) gesture.offset = travel;
      if (target !== page) go(gesture, velocity);
      else springBack(gesture);
    };

    // A swipe never also taps what was under the finger.
    const onClickCapture = (event: MouseEvent) => {
      if (now() >= clickGuardUntil) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const passive = { passive: true } as const;
    chat.addEventListener('touchstart', onTouchStart, passive);
    chat.addEventListener('touchmove', onTouchMove, passive);
    chat.addEventListener('touchend', onTouchEnd, passive);
    chat.addEventListener('touchcancel', onTouchEnd, passive);
    chat.addEventListener('click', onClickCapture, true);
    return () => {
      chat.removeEventListener('touchstart', onTouchStart);
      chat.removeEventListener('touchmove', onTouchMove);
      chat.removeEventListener('touchend', onTouchEnd);
      chat.removeEventListener('touchcancel', onTouchEnd);
      chat.removeEventListener('click', onClickCapture, true);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      gestureRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, chat]);

  // A tap on the list while the chat still glides off it: the chat closes
  // now, before the tap's click, so the click opens the row it landed on
  // (until then the list takes no taps of its own).
  useEffect(() => {
    if (!enabled || !list) return;
    let start: { x: number; y: number } | null = null;
    const onListTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      start =
        leaveNowRef.current && event.touches.length === 1 && touch
          ? { x: touch.clientX, y: touch.clientY }
          : null;
    };
    const onListTouchEnd = (event: TouchEvent) => {
      const began = start;
      start = null;
      const leaveNow = leaveNowRef.current;
      const lifted = event.changedTouches?.[0];
      if (!began || !leaveNow || event.type !== 'touchend' || !lifted) return;
      // Moved: a scroll or a swipe, not a tap.
      if (
        resolvePagerAxis(lifted.clientX - began.x, lifted.clientY - began.y) !==
        null
      ) {
        return;
      }
      flushSync(leaveNow);
    };
    const passive = { passive: true } as const;
    list.addEventListener('touchstart', onListTouchStart, passive);
    list.addEventListener('touchend', onListTouchEnd, passive);
    list.addEventListener('touchcancel', onListTouchEnd, passive);
    return () => {
      list.removeEventListener('touchstart', onListTouchStart);
      list.removeEventListener('touchend', onListTouchEnd);
      list.removeEventListener('touchcancel', onListTouchEnd);
    };
  }, [enabled, list]);

  useEffect(
    () => () => {
      clearTimer();
      reset();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
}
