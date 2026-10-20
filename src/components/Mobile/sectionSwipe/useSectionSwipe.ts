import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import {
  PAGER_RELEASE_EASING,
  PAGER_SCROLL_SLOP_PX,
  PAGER_VELOCITY_WINDOW_MS,
  isInPagerEdgeZone,
  isPagerScrollSettling,
  pagerDragOffset,
  pagerLiftVelocity,
  pagerSettleDurationMs,
  resolvePagerAxis,
  resolvePagerRelease,
  type PagerAxis,
  type PagerSample,
} from '../../../hooks/horizontalPagerSwipe';
import { isHorizontalGestureClaimed } from '../../../hooks/horizontalGestureClaim';
import {
  MOBILE_TAB_ORDER,
  type MobileSectionKey,
} from '../useMobileTabNavigation';
import type { ExternalTouchSource } from '../widgets/widgetSwipeZone';
import {
  SECTION_ATTR,
  findHorizontalOwner,
  sectionTranslateX,
} from './sectionSwipe';

/** After a section swipe, a click this soon belongs to the swipe. */
export const SECTION_CLICK_GUARD_MS = 400;
/** If the switch never shows up, the sections are put back after this. */
const COMMIT_FALLBACK_MS = 1200;

type StyleEntry = { value: string; priority: string };

/** A section this swipe has restyled, with what it had before. */
interface Styled {
  el: HTMLElement;
  before: Map<string, StyleEntry>;
  mine: Map<string, StyleEntry>;
  /** Attributes set, with what they were before (null: absent). */
  attrsBefore: Map<string, string | null>;
  attrsMine: Map<string, string>;
  /** Shown beside the current section (over React hiding it). */
  peeking?: boolean;
  /** Laid out and painted ahead of a swipe, off screen (see park). */
  parked?: boolean;
}

/** After a switch, the sections beside the new one are laid out this long
 * later (and once the phone is idle), never on the frames of the switch. */
const PARK_DELAY_MS = 450;

const newStyled = (el: HTMLElement): Styled => ({
  el,
  before: new Map(),
  mine: new Map(),
  attrsBefore: new Map(),
  attrsMine: new Map(),
});

interface Gesture {
  axis: PagerAxis | null;
  /** Handed over by Android (externalTouches): the page's own events for
   * that touch (its cancel, say) never touch it. */
  external: boolean;
  index: number;
  offset: number;
  /** The offset last written to the sections (what is on screen). */
  painted: number;
  originX: number;
  samples: PagerSample[];
  /** The list under the finger, found on the first move (not on touch
   * down, which every tap and scroll pays for). */
  scroller: HTMLElement | null | undefined;
  scrollTop: number;
  startT: number;
  /** What the finger landed on. */
  target: Element | null;
  startX: number;
  startY: number;
  travel: number;
  width: number;
}

export interface SectionSwipeOptions {
  /** Phones, on Home, Apps (without a Q-App on screen) or Chat. */
  enabled: boolean;
  /** The section showing. */
  current: MobileSectionKey | null;
  /**
   * A swipe was let go past the threshold: go there. Runs in a transition;
   * should a tap land on the new section before that has rendered, it runs
   * again for the same tab, synchronously, so it must be safe to repeat.
   */
  onNavigate: (tab: MobileSectionKey) => void;
  /** No follow-the-finger motion; a swipe past the threshold just switches. */
  reducedMotion?: boolean;
  /**
   * The bottom bar (the round Home, Apps and Chat buttons): swipes along it
   * switch sections too, also while a Q-App or website owns the screen's
   * own swipes (`barEnabled`, which may be on with `enabled` off).
   */
  bar?: HTMLElement | null;
  barEnabled?: boolean;
  /**
   * Bottom room a section gets once it is current, when that differs from
   * the room it has while another one is (a Q-App's frame ends above the
   * round buttons; Home and Chat scroll on behind them). Given to it while
   * it waits beside the current one and slides in, so it arrives laid out
   * as it stays (a Q-App's own bottom menu never jumps up on landing).
   */
  peekPaddingBottom?: Partial<Record<MobileSectionKey, string>>;
  /**
   * The sections left to right, as the round buttons sit (the user can
   * rearrange them); MOBILE_TAB_ORDER when not given. A change puts every
   * section back and parks the new neighbours on their new sides.
   */
  order?: readonly MobileSectionKey[];
  /**
   * Swipes Android took from frames on their way to the page (GO widgets,
   * widgetSwipeZone): they drive the swipe like the page's own touches.
   */
  externalTouches?: ExternalTouchSource;
  /**
   * Where Android watches for those (the widgets screen): the page's own
   * touches starting in it are left to the native swipe, so none is taken
   * twice.
   */
  nativeZone?: HTMLElement | null;
}

const pxTransform = (x: number) =>
  `translate3d(${Math.round(x * 100) / 100}px, 0, 0)`;

const setStyle = (
  styled: Styled,
  property: string,
  value: string,
  priority = ''
) => {
  const style = styled.el.style;
  if (!styled.before.has(property)) {
    styled.before.set(property, {
      value: style.getPropertyValue(property),
      priority: style.getPropertyPriority(property),
    });
  }
  style.setProperty(property, value, priority);
  styled.mine.set(property, {
    value: style.getPropertyValue(property),
    priority: style.getPropertyPriority(property),
  });
};

const setAttr = (styled: Styled, name: string, value: string) => {
  if (!styled.attrsBefore.has(name)) {
    styled.attrsBefore.set(name, styled.el.getAttribute(name));
  }
  styled.el.setAttribute(name, value);
  styled.attrsMine.set(name, value);
};

/**
 * Put back what the swipe changed, except where React has written since
 * (the section it switched to is shown, the one left is hidden): those
 * values are React's now. Transitions go first, so nothing animates back.
 */
const restoreStyles = (styled: Styled) => {
  for (const [name, before] of styled.attrsBefore) {
    if (styled.el.getAttribute(name) !== styled.attrsMine.get(name)) continue;
    if (before === null) styled.el.removeAttribute(name);
    else styled.el.setAttribute(name, before);
  }
  const style = styled.el.style;
  const properties = [...styled.before.keys()].sort((a, b) =>
    a === 'transition' ? -1 : b === 'transition' ? 1 : 0
  );
  for (const property of properties) {
    const mine = styled.mine.get(property);
    const before = styled.before.get(property);
    if (!mine || !before) continue;
    if (
      style.getPropertyValue(property) !== mine.value ||
      style.getPropertyPriority(property) !== mine.priority
    ) {
      continue;
    }
    if (before.value === '') style.removeProperty(property);
    else style.setProperty(property, before.value, before.priority);
  }
};

/** Shows a hidden section beside the current one, out of view. */
const PEEK_STYLES: Array<[string, string, string?]> = [
  // Over React's display:none !important for a hidden <Activity>.
  ['display', 'flex', 'important'],
  ['visibility', 'visible', 'important'],
  ['opacity', '1', 'important'],
  ['position', 'absolute'],
  ['top', '0px'],
  ['left', '0px'],
  ['right', '0px'],
  ['bottom', '0px'],
  ['z-index', '1'],
  ['pointer-events', 'none'],
];

const verticalScrollerOf = (
  target: Element | null,
  root: Element
): HTMLElement | null => {
  let element = target;
  while (element && element !== root) {
    if (
      element instanceof HTMLElement &&
      element.scrollHeight > element.clientHeight + 1
    ) {
      const overflowY = window.getComputedStyle(element).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return element;
    }
    element = element.parentElement;
  }
  return null;
};

/**
 * Sideways swipes on `rootRef` (the box holding Home, Apps and Chat) move
 * between the sections like pages: the current one follows the finger and
 * the next slides in beside it, live (hidden sections keep their last
 * screen), then the switch happens the way the tab buttons do it.
 *
 * Listeners are native and passive, like the chat list pager's, whose
 * thresholds and glide this shares. Only transforms change per frame; the
 * sections' own styles are restored once React has switched them.
 */
export function useSectionSwipe(
  rootRef: RefObject<HTMLElement | null>,
  options: SectionSwipeOptions
): void {
  const {
    enabled,
    current,
    bar = null,
    barEnabled = false,
    externalTouches,
  } = options;
  const barActive = Boolean(barEnabled && bar);
  const anyActive = enabled || barActive;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const orderKey = (options.order ?? MOBILE_TAB_ORDER).join(',');
  /** The tab at `index` in the order as it is now (and back). */
  const tabAt = (index: number): MobileSectionKey | undefined =>
    (optionsRef.current.order ?? MOBILE_TAB_ORDER)[index];
  /** How many sections there are now (the widgets screen makes four). */
  const sectionCount = (): number =>
    (optionsRef.current.order ?? MOBILE_TAB_ORDER).length;
  const indexOfTab = (tab: MobileSectionKey | null | undefined): number =>
    (optionsRef.current.order ?? MOBILE_TAB_ORDER).indexOf(
      tab as MobileSectionKey
    );
  const gestureRef = useRef<Gesture | null>(null);
  const styledRef = useRef<Map<number, Styled>>(new Map());
  const pendingRef = useRef<{ target: MobileSectionKey; timer: number } | null>(
    null
  );
  const settleTimerRef = useRef<number | null>(null);
  /** The glide under way: where to, and how it ends (see fastForward). */
  const glideRef = useRef<{
    target: number;
    width: number;
    finish: () => void;
  } | null>(null);
  const frameRef = useRef<number | null>(null);
  /** Puts a drag's sections back under the finger (see the layout effect
   * below). */
  const resumeDragRef = useRef<(() => void) | null>(null);
  /** Lays out the current section's neighbours ahead of a swipe. */
  const parkRef = useRef<(() => void) | null>(null);
  const parkTimerRef = useRef<{ timer: number; idle: number | null } | null>(
    null
  );

  const cancelPark = () => {
    const pending = parkTimerRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    if (pending.idle !== null) window.cancelIdleCallback?.(pending.idle);
    parkTimerRef.current = null;
  };

  const schedulePark = () => {
    cancelPark();
    const entry: { timer: number; idle: number | null } = {
      timer: 0,
      idle: null,
    };
    entry.timer = window.setTimeout(() => {
      const run = () => {
        parkTimerRef.current = null;
        parkRef.current?.();
      };
      if (typeof window.requestIdleCallback === 'function') {
        entry.idle = window.requestIdleCallback(run, { timeout: 1500 });
      } else {
        run();
      }
    }, PARK_DELAY_MS);
    parkTimerRef.current = entry;
  };

  /**
   * Shown beside the current section, over React hiding it, with the bottom
   * room it will have once current (`peekPaddingBottom`, which may change
   * while it waits).
   */
  const applyPeek = (styled: Styled, index: number) => {
    if (!styled.peeking) {
      styled.peeking = true;
      for (const [property, value, priority] of PEEK_STYLES) {
        setStyle(styled, property, value, priority);
      }
    }
    const padBottom =
      optionsRef.current.peekPaddingBottom?.[
        tabAt(index) as MobileSectionKey
      ] ?? '';
    const padded = styled.mine.get('padding-bottom')?.value ?? '';
    const before = styled.before.get('padding-bottom');
    if (padBottom && padded !== padBottom) {
      setStyle(styled, 'box-sizing', 'border-box');
      setStyle(styled, 'padding-bottom', padBottom);
    } else if (!padBottom && before && padded !== before.value) {
      setStyle(styled, 'padding-bottom', before.value, before.priority);
    }
  };

  /**
   * Parked: laid out and painted beside the section showing, just off
   * screen, so a swipe only has to move it. (Showing a hidden section cost
   * the swipe's first frames its style and paint, ~40 ms on a phone.) Out
   * of screen readers' way until it is current.
   */
  const parkSection = (styled: Styled, index: number, showing: number) => {
    applyPeek(styled, index);
    styled.parked = true;
    // (Again, should it have been landed on since it was first peeked.)
    setStyle(styled, 'pointer-events', 'none');
    setAttr(styled, 'aria-hidden', 'true');
    setStyle(styled, 'will-change', 'transform');
    setStyle(styled, 'transition', 'none');
    setStyle(
      styled,
      'transform',
      `translate3d(${(index - showing) * 100}%, 0, 0)`
    );
  };

  /** Ends a swipe's frames, glide and switch fallback. `keepGesture`: a
   * swipe started while the last one was landing goes on. */
  const stopMotion = (keepGesture: boolean) => {
    cancelPark();
    if (!keepGesture && frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    glideRef.current = null;
    if (pendingRef.current) {
      window.clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
    }
    if (!keepGesture) gestureRef.current = null;
  };

  /** Hands every section back to React. */
  const cleanup = (keepGesture = false) => {
    stopMotion(keepGesture);
    for (const styled of styledRef.current.values()) restoreStyles(styled);
    styledRef.current.clear();
  };
  const cleanupRef = useRef(cleanup);
  cleanupRef.current = cleanup;

  /**
   * The sections come to rest with `index` showing: it goes back to React,
   * and so do all others but the ones parked beside it, which stay as they
   * are (laid out and painted already). `leaving`, the section React hides
   * in this commit, goes back too: by now something has measured the page
   * with it hidden, so keeping it would lay it out again on this very
   * frame; it is parked later, in idle time, like any other.
   */
  const settle = (index: number, keepGesture = false, leaving = -1) => {
    stopMotion(keepGesture);
    for (const [other, styled] of [...styledRef.current]) {
      if (Math.abs(other - index) === 1 && other !== leaving) {
        parkSection(styled, other, index);
      } else {
        restoreStyles(styled);
        styledRef.current.delete(other);
      }
    }
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;

  // Once React shows the section a swipe went to, hand its styles back. A
  // change from elsewhere mid-swipe (a notification tap) ends the swipe.
  const shownRef = useRef(current);
  useLayoutEffect(() => {
    const previous = shownRef.current;
    shownRef.current = current;
    const index = indexOfTab(current);
    const pending = pendingRef.current;
    if (pending && pending.target === current) {
      // A next swipe may already be under way from here: it goes on, from
      // where the finger has it in this very frame (not a frame of the
      // sections back where React put them).
      settleRef.current(index, true, indexOfTab(previous));
      resumeDragRef.current?.();
      return;
    }
    if (pending || previous === current) return;
    if (index < 0 || gestureRef.current || settleTimerRef.current !== null) {
      cleanupRef.current();
      return;
    }
    settleRef.current(index, false, indexOfTab(previous));
  }, [current]);

  // Rearranged buttons: the sections beside the current one are others now,
  // on other sides. Everything goes back to React before the next paint
  // (parked sections are keyed by their place), and the new neighbours are
  // parked again below.
  const orderKeyRef = useRef(orderKey);
  useLayoutEffect(() => {
    if (orderKeyRef.current === orderKey) return;
    orderKeyRef.current = orderKey;
    cleanupRef.current();
  }, [orderKey]);

  // The new section's neighbours, laid out ahead of the next swipe.
  const scheduleParkRef = useRef(schedulePark);
  scheduleParkRef.current = schedulePark;
  const peekKey = JSON.stringify(options.peekPaddingBottom ?? {});
  useEffect(() => {
    if (!anyActive) return;
    scheduleParkRef.current();
  }, [anyActive, current, peekKey, orderKey]);

  useEffect(() => {
    if (!anyActive) {
      parkRef.current = null;
      cleanupRef.current();
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    let clickGuardUntil = 0;

    const now = () =>
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    const sectionElement = (index: number) =>
      root.querySelector<HTMLElement>(`[${SECTION_ATTR}="${tabAt(index)}"]`);

    const styledSection = (index: number, peek: boolean): Styled | null => {
      const existing = styledRef.current.get(index);
      if (existing) {
        // The section a swipe started on, joining a next one as its
        // neighbour.
        if (peek && !existing.peeking) applyPeek(existing, index);
        return existing;
      }
      const el = sectionElement(index);
      if (!el) return null;
      const styled = newStyled(el);
      if (peek) applyPeek(styled, index);
      setStyle(styled, 'will-change', 'transform');
      setStyle(styled, 'transition', 'none');
      // Placed in the same step that shows it: a frame drawn before the
      // next animation frame would otherwise show it at 0, over everything.
      // Beside the others where they are on screen now (not where the finger
      // already is), so the two stay glued until the next frame moves both.
      const gesture = gestureRef.current;
      if (gesture) {
        setStyle(
          styled,
          'transform',
          pxTransform(
            sectionTranslateX(
              index,
              gesture.index,
              gesture.painted,
              gesture.width
            )
          )
        );
      }
      styledRef.current.set(index, styled);
      return styled;
    };

    /** Parks the current section's neighbours (see parkSection), in idle
     * time after a switch. */
    const park = () => {
      if (
        gestureRef.current ||
        settleTimerRef.current !== null ||
        pendingRef.current
      ) {
        return;
      }
      const index = indexOfTab(optionsRef.current.current);
      if (index < 0) return;
      for (const neighbour of [index - 1, index + 1]) {
        if (neighbour < 0 || neighbour >= sectionCount()) continue;
        const existing = styledRef.current.get(neighbour);
        if (existing) {
          // Keeps up with a change in the room it will have.
          if (existing.parked) applyPeek(existing, neighbour);
          continue;
        }
        const styled = styledSection(neighbour, true);
        if (styled) parkSection(styled, neighbour, index);
      }
    };
    parkRef.current = park;

    /** A section joining the swipe, beside the others. */
    const reveal = (index: number) => {
      const styled = styledSection(index, true);
      if (!styled?.parked) return;
      styled.parked = false;
      const gesture = gestureRef.current;
      if (gesture) {
        setStyle(
          styled,
          'transform',
          pxTransform(
            sectionTranslateX(
              index,
              gesture.index,
              gesture.painted,
              gesture.width
            )
          )
        );
      }
    };

    const writeFrame = () => {
      frameRef.current = null;
      const gesture = gestureRef.current;
      if (gesture?.axis !== 'horizontal') return;
      // (Again, should the last swipe's landing have handed it back.)
      if (!optionsRef.current.reducedMotion) {
        styledSection(gesture.index, false);
      }
      gesture.painted = gesture.offset;
      for (const [index, styled] of styledRef.current) {
        setStyle(
          styled,
          'transform',
          pxTransform(
            sectionTranslateX(
              index,
              gesture.index,
              gesture.offset,
              gesture.width
            )
          )
        );
      }
    };

    const follow = (gesture: Gesture, x: number) => {
      gesture.travel = x - gesture.originX;
      if (optionsRef.current.reducedMotion) return;
      gesture.offset = pagerDragOffset(
        gesture.index,
        gesture.travel,
        sectionCount(),
        gesture.width
      );
      // Bring in the neighbour on the side the content is moving away from.
      const neighbour =
        gesture.offset < 0
          ? gesture.index + 1
          : gesture.offset > 0
            ? gesture.index - 1
            : null;
      if (neighbour !== null && neighbour >= 0 && neighbour < sectionCount()) {
        reveal(neighbour);
      }
    };

    /** The sections went back to React mid-drag (the last switch landed):
     * the dragged ones go back under the finger in the same frame. */
    const resumeDrag = () => {
      const gesture = gestureRef.current;
      if (gesture?.axis !== 'horizontal') return;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (optionsRef.current.reducedMotion) return;
      follow(gesture, gesture.originX + gesture.travel);
      writeFrame();
    };
    resumeDragRef.current = resumeDrag;

    /** Glide every moved section to where `target` rests, then switch. */
    const release = (gesture: Gesture, target: number, velocity: number) => {
      gestureRef.current = null;
      clickGuardUntil = now() + SECTION_CLICK_GUARD_MS;
      const { onNavigate, reducedMotion } = optionsRef.current;
      const finish = () => {
        settleTimerRef.current = null;
        if (target === gesture.index) {
          settleRef.current(target);
          scheduleParkRef.current();
          return;
        }
        const tab = tabAt(target) as MobileSectionKey;
        // The section landed on takes touches from now on, not only once
        // React has switched to it: a list there scrolls, and a tap on it
        // brings the switch forward (see onTouchEnd).
        const arriving = styledRef.current.get(target);
        if (arriving?.peeking) {
          const before = arriving.before.get('pointer-events');
          setStyle(
            arriving,
            'pointer-events',
            before?.value ?? '',
            before?.priority ?? ''
          );
        }
        if (pendingRef.current) window.clearTimeout(pendingRef.current.timer);
        pendingRef.current = {
          target: tab,
          timer: window.setTimeout(() => {
            cleanupRef.current();
            scheduleParkRef.current();
          }, COMMIT_FALLBACK_MS),
        };
        // A transition: the switch's render (the new section's effects
        // starting, its lists catching up) yields to touches, so a quick
        // next swipe never waits for it. Nothing on screen waits either:
        // the sections are already where the swipe left them.
        startTransition(() => onNavigate(tab));
      };
      if (reducedMotion || styledRef.current.size === 0) {
        finish();
        return;
      }
      if (target !== gesture.index) {
        gestureRef.current = gesture;
        reveal(target);
        gestureRef.current = null;
      }
      // Start the glide from the finger's last spot, painted or not.
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      gestureRef.current = gesture;
      writeFrame();
      gestureRef.current = null;
      for (const styled of styledRef.current.values()) {
        void styled.el.getBoundingClientRect();
      }
      const finalOffset = (gesture.index - target) * gesture.width;
      const duration = pagerSettleDurationMs(
        finalOffset - gesture.offset,
        velocity,
        gesture.width
      );
      for (const [index, styled] of styledRef.current) {
        setStyle(
          styled,
          'transition',
          `transform ${duration}ms ${PAGER_RELEASE_EASING}`
        );
        setStyle(
          styled,
          'transform',
          pxTransform(sectionTranslateX(index, target, 0, gesture.width))
        );
      }
      glideRef.current = { target, width: gesture.width, finish };
      settleTimerRef.current = window.setTimeout(() => {
        glideRef.current = null;
        finish();
      }, duration + 40);
    };

    /**
     * A finger down while the sections still glide: they land at once (the
     * switch goes ahead), so the new touch starts from there instead of
     * being ignored (a quick second swipe used to need a third).
     */
    const fastForward = () => {
      const glide = glideRef.current;
      if (!glide || settleTimerRef.current === null) return;
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
      glideRef.current = null;
      for (const [index, styled] of styledRef.current) {
        if (styled.parked) continue;
        setStyle(styled, 'transition', 'none');
        setStyle(
          styled,
          'transform',
          pxTransform(sectionTranslateX(index, glide.target, 0, glide.width))
        );
      }
      glide.finish();
    };

    const cancelGesture = () => {
      const gesture = gestureRef.current;
      if (gesture?.axis === 'horizontal') {
        release(gesture, gesture.index, 0);
      } else {
        gestureRef.current = null;
      }
    };

    const hasScrolled = (gesture: Gesture) => {
      if (gesture.scroller === undefined) {
        gesture.scroller = verticalScrollerOf(gesture.target, root);
        gesture.scrollTop = gesture.scroller?.scrollTop ?? 0;
        return false;
      }
      return (
        gesture.scroller !== null &&
        Math.abs(gesture.scroller.scrollTop - gesture.scrollTop) >
          PAGER_SCROLL_SLOP_PX
      );
    };

    const onTouchStart = (event: TouchEvent, external = false) => {
      if (!external && gestureRef.current?.external) return;
      if (event.touches.length !== 1) {
        cancelGesture();
        return;
      }
      // Mid-glide: land now. Mid-switch (React not there yet): go on from
      // the section on its way in.
      fastForward();
      gestureRef.current = null;
      clickGuardUntil = 0;
      // Android takes swipes starting here (over GO widgets) and hands them
      // over through externalTouches; the page's own copy is left alone.
      const zone = optionsRef.current.nativeZone;
      if (
        !external &&
        zone &&
        event.target instanceof Node &&
        zone.contains(event.target)
      ) {
        return;
      }
      const touch = event.touches[0];
      if (isInPagerEdgeZone(touch.clientX, window.innerWidth)) return;
      const index = indexOfTab(
        pendingRef.current?.target ?? optionsRef.current.current
      );
      if (index < 0 || !sectionElement(index)) return;
      gestureRef.current = {
        axis: null,
        external,
        index,
        offset: 0,
        painted: 0,
        originX: touch.clientX,
        samples: [],
        scroller: undefined,
        scrollTop: 0,
        startT: event.timeStamp,
        startX: touch.clientX,
        startY: touch.clientY,
        target: event.target instanceof Element ? event.target : null,
        travel: 0,
        width: root.clientWidth || window.innerWidth || 1,
      };
    };

    const onTouchMove = (event: TouchEvent, external = false) => {
      const gesture = gestureRef.current;
      if (gesture && gesture.external !== external) return;
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
          gesture.scrollTop = gesture.scroller?.scrollTop ?? 0;
        }
        const axis = resolvePagerAxis(dx, dy, elapsed);
        if (axis === null) return;
        if (
          axis !== 'horizontal' ||
          // The chat list pager took it (Groups / DMs).
          isHorizontalGestureClaimed(gesture.startT) ||
          // Something under the finger owns sideways drags (a carousel, a
          // slider). Checked only now: most touches never get here.
          findHorizontalOwner(gesture.target, root) !== null
        ) {
          gesture.axis = axis === 'horizontal' ? 'vertical' : axis;
          return;
        }
        gesture.axis = 'horizontal';
        gesture.originX = touch.clientX;
        if (!optionsRef.current.reducedMotion) {
          styledSection(gesture.index, false);
        }
      } else if (hasScrolled(gesture)) {
        // The browser scrolled after all: the gesture is its.
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
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(writeFrame);
      }
    };

    /**
     * A tap on the section a swipe has just landed on, before React has
     * switched to it (the switch renders in a transition, which on a phone
     * can take a second): the switch happens now, before the tap's click,
     * so the click opens what it landed on in the section as it is now.
     * Not for the round buttons, whose own taps go somewhere themselves.
     */
    const switchNowForTap = (target: Element | null) => {
      const pending = pendingRef.current;
      if (!pending) return;
      if (target && bar?.contains(target)) return;
      // Already there (two swipes React took as one): going there again
      // would be a second press of that section's button (Chat's flips an
      // open chat to its list).
      if (optionsRef.current.current === pending.target) return;
      flushSync(() => optionsRef.current.onNavigate(pending.target));
    };

    const onTouchEnd = (event: TouchEvent, external = false) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      // Android's cancel to the page, for the swipe it handed over: not ours.
      if (gesture.external !== external) return;
      if (gesture.axis !== 'horizontal') {
        gestureRef.current = null;
        // Neither a swipe nor a scroll: a tap, or a press and hold.
        if (gesture.axis !== 'vertical' && event.type === 'touchend') {
          switchNowForTap(gesture.target);
        }
        return;
      }
      if (event.type === 'touchcancel') {
        release(gesture, gesture.index, 0);
        return;
      }
      const lifted = event.changedTouches?.[0];
      const last = gesture.samples[gesture.samples.length - 1];
      const lift: PagerSample = {
        t: event.timeStamp,
        x: lifted?.clientX ?? last?.x ?? gesture.originX + gesture.travel,
      };
      follow(gesture, lift.x);
      const velocity = pagerLiftVelocity(gesture.samples, lift);
      const target = resolvePagerRelease({
        dx: gesture.travel,
        page: gesture.index,
        pageCount: sectionCount(),
        velocity,
        width: gesture.width,
      });
      release(gesture, target, velocity);
    };

    // A swipe never also taps what was under the finger.
    const onClickCapture = (event: MouseEvent) => {
      if (now() >= clickGuardUntil) return;
      event.preventDefault();
      event.stopPropagation();
    };

    // Swipes Android took from widget frames: the same handlers, fed by hand.
    const unsubscribeExternal = enabled
      ? externalTouches?.subscribe((touch) => {
          const point = {
            clientX: touch.x,
            clientY: touch.y,
            target: touch.target,
          };
          const ended =
            touch.type === 'touchend' || touch.type === 'touchcancel';
          const event = {
            type: touch.type,
            timeStamp: touch.timeStamp,
            target: touch.target,
            touches: ended ? [] : [point],
            changedTouches: [point],
          } as unknown as TouchEvent;
          if (touch.type === 'touchstart') onTouchStart(event, true);
          else if (touch.type === 'touchmove') onTouchMove(event, true);
          else onTouchEnd(event, true);
        })
      : undefined;

    const passive = { passive: true } as const;
    const surfaces = [
      ...(enabled ? [root] : []),
      ...(barActive && bar ? [bar] : []),
    ];
    for (const surface of surfaces) {
      surface.addEventListener('touchstart', onTouchStart, passive);
      surface.addEventListener('touchmove', onTouchMove, passive);
      surface.addEventListener('touchend', onTouchEnd, passive);
      surface.addEventListener('touchcancel', onTouchEnd, passive);
      surface.addEventListener('click', onClickCapture, true);
    }
    return () => {
      unsubscribeExternal?.();
      for (const surface of surfaces) {
        surface.removeEventListener('touchstart', onTouchStart);
        surface.removeEventListener('touchmove', onTouchMove);
        surface.removeEventListener('touchend', onTouchEnd);
        surface.removeEventListener('touchcancel', onTouchEnd);
        surface.removeEventListener('click', onClickCapture, true);
      }
      parkRef.current = null;
      // A switch already on its way finishes; anything else is put back.
      if (!pendingRef.current) cleanupRef.current();
    };
  }, [anyActive, enabled, barActive, bar, rootRef, externalTouches]);

  useEffect(() => () => cleanupRef.current(), []);
}
