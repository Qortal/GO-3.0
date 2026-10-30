import { useEffect, useRef } from 'react';
import {
  PAGER_AXIS_LOCK_PX,
  PAGER_RELEASE_EASING,
  pagerLiftVelocity,
  pagerSettleDurationMs,
  resolvePagerAxis,
  type PagerSample,
} from '../../hooks/horizontalPagerSwipe';
import {
  TABS_PULL_FLING_VELOCITY,
  TABS_PULL_OPEN_RATIO,
  TABS_PULL_SLOP_PX,
} from './tabsPull';

/**
 * Sliding the open Tabs window up closes it, the way it was pulled down: the
 * panel follows the finger, and letting go past about a third of it (or with
 * a flick up) slides it away; otherwise it settles back.
 *
 * On the header, the folder row and the bottom handle the panel follows the
 * finger straight away. On the list of tabs (cards and the background
 * between them) and on the strip below the panel, a small swipe scrolls the
 * list and a big one closes: the finger scrolls the list first, and once it
 * has gone a big swipe's length (bigSwipePx) the rest of it moves the panel.
 * A list with nothing left to scroll moves the panel right away.
 *
 * Native scrolling can't hand over to the panel halfway through a swipe, so
 * while this is on the list scrolls here instead (it gets touch-action: none)
 * and glides on after a flick. Sideways drags are left alone, and so is the
 * list in edit mode (the hook is off). Listeners are passive.
 */

/** Rubber band for a drag the wrong way (down): the panel barely moves. */
const DOWN_RESISTANCE = 0.18;
/** A big swipe is this share of the panel's height... */
export const BIG_SWIPE_RATIO = 0.35;
/** ...within these bounds (px). */
const BIG_SWIPE_MIN_PX = 160;
const BIG_SWIPE_MAX_PX = 280;
/** Past the list's end, a swipe that isn't big yet only stretches the
 * panel this much: letting go there puts it back. */
const PAST_END_RESISTANCE = 0.35;
/** Once a swipe on the list is big, letting go slowly closes the window
 * after the panel has moved this share of its height (not the third a
 * slide from the header takes). */
export const BIG_SWIPE_CLOSE_RATIO = 0.12;
/** A flicked list glides on and slows to a stop with this time constant
 * (ms): it starts at the finger's speed and covers speed × this in all. */
export const LIST_FLING_TIME_MS = 450;
/** Slower than this (px/ms) a lift is not a flick. */
const LIST_FLING_MIN_VELOCITY = 0.05;
const LIST_FLING_MAX_VELOCITY = 8;
/** A touch that stops a glide moving faster than this (px/ms) only stops
 * it: it is not a tap on the card under it. */
const FLING_CATCH_VELOCITY = 0.1;

export interface TabsSwipeCloseOptions {
  panel: HTMLElement | null;
  /** The area below the panel (over the app behind it): with a long list
   * a swipe there is one on the list. */
  below?: HTMLElement | null;
  /** The panel's scrolling list of tabs. */
  getList: () => HTMLElement | null;
  enabled: boolean;
  onClose: () => void;
  reducedMotion?: boolean;
}

type Gesture = {
  /** The panel follows the finger, or the list scrolls first. */
  kind: 'panel' | 'list';
  phase: 'undecided' | 'moving';
  startT: number;
  startX: number;
  startY: number;
  originY: number;
  /** Finger travel since originY (px, negative is up). */
  travel: number;
  samples: PagerSample[];
  /** The touch stopped a glide: lifting it without a swipe is no tap. */
  caughtFling: boolean;
  // List swipes only, read when the swipe begins.
  list: HTMLElement | null;
  scrollStart: number;
  room: number;
  big: number;
  panelMoved: boolean;
};

const maxScrollOf = (list: HTMLElement): number =>
  Math.max(0, list.scrollHeight - list.clientHeight);

/** How far a swipe on the list goes before it closes the window. */
export const bigSwipePx = (height: number): number =>
  Math.round(
    Math.min(
      BIG_SWIPE_MAX_PX,
      Math.max(BIG_SWIPE_MIN_PX, height * BIG_SWIPE_RATIO)
    )
  );

/**
 * The panel's offset for a finger `travel` px from where the slide began:
 * up follows the finger (to the panel's height), down only stretches.
 */
export const swipeCloseOffset = (travel: number, height: number): number =>
  travel < 0
    ? Math.max(-height, travel)
    : Math.min(24, travel * DOWN_RESISTANCE);

/** Whether a slide let go here closes the window: on a flick up, or past
 * `ratio` of the panel unless flicked back down. */
export const swipeCloseShouldClose = (
  travel: number,
  velocity: number,
  height: number,
  ratio = TABS_PULL_OPEN_RATIO
): boolean =>
  velocity < -TABS_PULL_FLING_VELOCITY ||
  (velocity < TABS_PULL_FLING_VELOCITY &&
    -travel > (height > 0 ? height : 300) * ratio);

export interface ListSwipeSplit {
  /** px to scroll the list from where the swipe began (+ is further down). */
  scroll: number;
  /** px to move the panel up. */
  panel: number;
  /** Whether letting go now may close the window. */
  canClose: boolean;
}

/**
 * How a swipe on the list `up` px long (negative is down) splits between
 * scrolling the list and moving the panel. `room` is how far the list could
 * still scroll down and `scrolled` how far it was from its top when the
 * swipe began; `big` is a big swipe's length.
 *
 * Up to `big` the finger scrolls the list, past it the panel follows the
 * finger. A list that reaches its end sooner only stretches the panel until
 * the swipe is big. A list already at its end moves the panel at once.
 */
export const splitListSwipe = (
  up: number,
  room: number,
  scrolled: number,
  big: number
): ListSwipeSplit => {
  if (up <= 0) {
    return { scroll: Math.max(-scrolled, up), panel: 0, canClose: false };
  }
  if (room <= 0) return { scroll: 0, panel: up, canClose: true };
  return {
    scroll: Math.min(up, room, big),
    panel:
      PAST_END_RESISTANCE * Math.max(0, Math.min(up, big) - room) +
      Math.max(0, up - big),
    canClose: up >= big,
  };
};

/** How far a glide at `velocity` px/ms has gone after `elapsed` ms. */
export const listFlingDistance = (velocity: number, elapsed: number): number =>
  velocity * LIST_FLING_TIME_MS * (1 - Math.exp(-elapsed / LIST_FLING_TIME_MS));

/** A glide's speed (px/ms) after `elapsed` ms. */
export const listFlingSpeed = (velocity: number, elapsed: number): number =>
  velocity * Math.exp(-elapsed / LIST_FLING_TIME_MS);

export function useTabsSwipeClose(options: TabsSwipeCloseOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { panel, below, enabled } = options;

  useEffect(() => {
    if (!panel || !enabled) return;
    const list = optionsRef.current.getList();
    let gesture: Gesture | null = null;
    let frame: number | null = null;
    let settleTimer: number | null = null;
    let fling: {
      frame: number;
      from: number;
      startT: number;
      velocity: number;
    } | null = null;
    let swallowClicksUntil = 0;

    // The list scrolls here while this is on (see above).
    const listTouchAction = list?.style.touchAction ?? '';
    if (list) list.style.touchAction = 'none';

    const stopFling = (now: number): number => {
      if (!fling) return 0;
      const speed = Math.abs(
        listFlingSpeed(fling.velocity, now - fling.startT)
      );
      cancelAnimationFrame(fling.frame);
      fling = null;
      return speed;
    };

    const startFling = (velocity: number) => {
      if (!list || Math.abs(velocity) < LIST_FLING_MIN_VELOCITY) return;
      const clamped =
        Math.sign(velocity) *
        Math.min(LIST_FLING_MAX_VELOCITY, Math.abs(velocity));
      const step = (now: number) => {
        if (!fling) return;
        const elapsed = Math.max(0, now - fling.startT);
        const max = maxScrollOf(list);
        const target = fling.from + listFlingDistance(fling.velocity, elapsed);
        const next = Math.max(0, Math.min(max, target));
        list.scrollTop = next;
        const stopped =
          next !== target ||
          Math.abs(listFlingSpeed(fling.velocity, elapsed)) <
            LIST_FLING_MIN_VELOCITY / 5;
        if (stopped) {
          fling = null;
          return;
        }
        fling.frame = requestAnimationFrame(step);
      };
      fling = {
        frame: requestAnimationFrame(step),
        from: list.scrollTop,
        startT: performance.now(),
        velocity: clamped,
      };
    };

    const listSplit = (current: Gesture) =>
      splitListSwipe(
        -current.travel,
        current.room,
        current.scrollStart,
        current.big
      );

    /** The panel's offset now (px, negative is up). */
    const panelOffset = (current: Gesture): number => {
      const height = panel.offsetHeight;
      if (current.kind === 'panel')
        return swipeCloseOffset(current.travel, height);
      return swipeCloseOffset(-listSplit(current).panel, height);
    };

    const draw = (current: Gesture) => {
      if (current.kind === 'list' && current.list) {
        const split = listSplit(current);
        current.list.scrollTop = current.scrollStart + split.scroll;
        // Plain scrolling leaves the panel's style alone.
        if (split.panel <= 0 && !current.panelMoved) return;
        current.panelMoved = true;
      }
      if (optionsRef.current.reducedMotion) return;
      panel.style.transition = 'none';
      panel.style.willChange = 'transform';
      panel.style.transform = `translate3d(0, ${Math.round(panelOffset(current))}px, 0)`;
    };

    const write = () => {
      frame = null;
      if (gesture?.phase === 'moving') draw(gesture);
    };

    const settle = (from: number, close: boolean, velocity: number) => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      const height = panel.offsetHeight;
      const finish = () => {
        settleTimer = null;
        if (close) {
          // Already out of sight; the window's own exit runs on from there.
          optionsRef.current.onClose();
        } else {
          panel.style.transition = '';
          panel.style.transform = '';
          panel.style.willChange = '';
        }
      };
      if (optionsRef.current.reducedMotion || height <= 0) {
        finish();
        return;
      }
      const to = close ? -height : 0;
      const duration = pagerSettleDurationMs(to - from, velocity, height);
      panel.style.transition = `transform ${duration}ms ${PAGER_RELEASE_EASING}`;
      panel.style.transform = `translate3d(0, ${to}px, 0)`;
      settleTimer = window.setTimeout(finish, duration + 30);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (gesture?.phase === 'moving' || settleTimer !== null) return;
      gesture = null;
      const caughtFling = stopFling(performance.now()) > FLING_CATCH_VELOCITY;
      swallowClicksUntil = 0;
      if (event.touches.length !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      // Text fields keep their own drags (selecting, moving the caret).
      if (target.closest('input, textarea, [contenteditable="true"]')) return;
      let kind: Gesture['kind'] = 'panel';
      if (list && list.contains(target)) {
        kind = 'list';
      } else if (below && below.contains(target)) {
        // Below a short list a swipe is on the app behind (it closes).
        if (!list || maxScrollOf(list) <= 1) return;
        kind = 'list';
      } else if (!panel.contains(target)) {
        return;
      }
      const touch = event.touches[0];
      gesture = {
        kind,
        phase: 'undecided',
        startT: event.timeStamp,
        startX: touch.clientX,
        startY: touch.clientY,
        originY: touch.clientY,
        travel: 0,
        samples: [],
        caughtFling,
        list: kind === 'list' ? list : null,
        scrollStart: 0,
        room: 0,
        big: 0,
        panelMoved: false,
      };
    };

    /** Puts a panel the finger moved back where it was. */
    const putBack = (current: Gesture) => {
      if (current.kind === 'panel' || current.panelMoved) {
        settle(panelOffset(current), false, 0);
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      const current = gesture;
      if (!current) return;
      if (event.touches.length !== 1) {
        if (current.phase === 'moving') putBack(current);
        gesture = null;
        return;
      }
      const touch = event.touches[0];
      if (current.phase === 'undecided') {
        const dx = touch.clientX - current.startX;
        const dy = touch.clientY - current.startY;
        const isList = current.kind === 'list';
        const axis = resolvePagerAxis(
          dx,
          dy,
          // A finger that rests and then moves still scrolls a list.
          isList ? 0 : event.timeStamp - current.startT,
          isList ? PAGER_AXIS_LOCK_PX : TABS_PULL_SLOP_PX
        );
        if (axis === null) return;
        // A list scrolls both ways; elsewhere only a slide up counts.
        if (axis !== 'vertical' || (!isList && dy >= 0)) {
          gesture = null;
          return;
        }
        current.phase = 'moving';
        current.originY = touch.clientY;
        if (current.list) {
          current.scrollStart = current.list.scrollTop;
          current.room = maxScrollOf(current.list) - current.scrollStart;
          current.big = bigSwipePx(panel.offsetHeight);
        }
      }
      current.travel = touch.clientY - current.originY;
      current.samples.push({ t: event.timeStamp, x: touch.clientY });
      if (current.samples.length > 6) current.samples.shift();
      if (frame === null) frame = requestAnimationFrame(write);
    };

    const onTouchEnd = (event: TouchEvent) => {
      const current = gesture;
      gesture = null;
      if (!current) return;
      if (current.phase !== 'moving') {
        if (current.caughtFling && event.type === 'touchend') {
          swallowClicksUntil = event.timeStamp + 500;
        }
        return;
      }
      if (event.type === 'touchcancel') {
        putBack(current);
        return;
      }
      const lifted = event.changedTouches?.[0];
      const lift: PagerSample = {
        t: event.timeStamp,
        x: lifted?.clientY ?? current.originY + current.travel,
      };
      current.travel = lift.x - current.originY;
      const velocity = pagerLiftVelocity(current.samples, lift);
      const height = panel.offsetHeight;
      if (current.kind === 'panel') {
        settle(
          panelOffset(current),
          swipeCloseShouldClose(current.travel, velocity, height),
          velocity
        );
        return;
      }
      // Draw where the finger lifted (a frame may still be pending).
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      draw(current);
      const split = listSplit(current);
      if (split.panel > 0) {
        settle(
          panelOffset(current),
          split.canClose &&
            swipeCloseShouldClose(
              -split.panel,
              velocity,
              height,
              // A list at its end from the start slides like the header.
              current.room > 0 ? BIG_SWIPE_CLOSE_RATIO : undefined
            ),
          velocity
        );
        return;
      }
      putBack(current);
      // The finger going up scrolls further down the list.
      startFling(-velocity);
    };

    const onWheel = () => {
      stopFling(performance.now());
    };

    // A tap that only stopped a glide does not open the card under it.
    const onClickCapture = (event: MouseEvent) => {
      if (swallowClicksUntil === 0 || event.timeStamp > swallowClicksUntil) {
        return;
      }
      swallowClicksUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    };

    const areas = [panel, below].filter(
      (area): area is HTMLElement => area instanceof HTMLElement
    );
    const passive = { passive: true } as const;
    areas.forEach((area) => {
      area.addEventListener('touchstart', onTouchStart, passive);
      area.addEventListener('touchmove', onTouchMove, passive);
      area.addEventListener('touchend', onTouchEnd, passive);
      area.addEventListener('touchcancel', onTouchEnd, passive);
      area.addEventListener('click', onClickCapture, true);
    });
    list?.addEventListener('wheel', onWheel, passive);
    return () => {
      areas.forEach((area) => {
        area.removeEventListener('touchstart', onTouchStart);
        area.removeEventListener('touchmove', onTouchMove);
        area.removeEventListener('touchend', onTouchEnd);
        area.removeEventListener('touchcancel', onTouchEnd);
        area.removeEventListener('click', onClickCapture, true);
      });
      list?.removeEventListener('wheel', onWheel);
      if (list) list.style.touchAction = listTouchAction;
      if (frame !== null) cancelAnimationFrame(frame);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      stopFling(performance.now());
      gesture = null;
    };
  }, [panel, below, enabled]);
}
