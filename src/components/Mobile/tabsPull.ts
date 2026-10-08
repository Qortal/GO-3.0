import { useEffect, useRef } from 'react';
import {
  PAGER_RELEASE_EASING,
  pagerLiftVelocity,
  pagerSettleDurationMs,
  resolvePagerAxis,
  type PagerSample,
} from '../../hooks/horizontalPagerSwipe';
import { isHorizontalGestureClaimed } from '../../hooks/horizontalGestureClaim';
import { SECTION_ATTR } from './sectionSwipe/sectionSwipe';
import type { MobileTabKey } from './useMobileTabNavigation';

/**
 * Pulling down from the top of Home, the Q-Apps library or the chat lists
 * brings the Tabs window down with the finger, like a sheet: let go past
 * about a third of it (or with a flick down) and it stays open, otherwise it
 * slides back up.
 *
 * The Tabs window opens at once for the pull (no slide of its own) and hands
 * its panel over here (setTabsPanelElement); the panel's transform is the
 * only thing written per frame.
 */

/** Touches starting inside an element with this attribute never pull. */
export const TABS_PULL_IGNORE_ATTR = 'data-tabs-pull-ignore';
/** Finger travel (px) before a downward drag counts as a pull. */
export const TABS_PULL_SLOP_PX = 12;
/** Let go past this share of the panel, it stays open. */
export const TABS_PULL_OPEN_RATIO = 0.3;
/** A flick this fast (px/ms) opens or closes it whatever the distance. */
export const TABS_PULL_FLING_VELOCITY = 0.45;
/** After a pull that closed it, when the panel is handed back to the Tabs
 * window as it was (by then it has slid away or unmounted). */
const CLOSED_HANDBACK_MS = 450;

let panelElement: HTMLElement | null = null;
/** Whether a pull is moving the panel now (it starts hidden above). */
let pullActive = false;

/**
 * The Tabs window's panel (a callback ref). Mounted for a pull, it starts
 * hidden above its place, so its first frame never flashes it open.
 */
export const setTabsPanelElement = (element: HTMLElement | null) => {
  panelElement = element;
  if (element && pullActive) {
    element.style.transition = 'none';
    element.style.transform = 'translate3d(0, -100%, 0)';
  }
};

export const getTabsPanelElement = () => panelElement;

const clearPanel = (panel: HTMLElement | null) => {
  if (!panel) return;
  panel.style.transition = '';
  panel.style.transform = '';
  panel.style.willChange = '';
};

/**
 * The lists under `target` that scroll vertically, nearest first, up to and
 * including `root`. The section itself can be the scroller (Home is): a pull
 * must see it too, or a page scrolled far down pulled from any inner list
 * that sat at its own top (the Home feeds).
 */
const verticalScrollersOf = (
  target: Element | null,
  root: Element | null
): HTMLElement[] => {
  const scrollers: HTMLElement[] = [];
  let element = target;
  while (element && element !== document.body) {
    if (
      element instanceof HTMLElement &&
      element.scrollHeight > element.clientHeight + 1
    ) {
      const overflowY = window.getComputedStyle(element).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        scrollers.push(element);
      }
    }
    if (element === root) break;
    element = element.parentElement;
  }
  return scrollers;
};

/** Every list a pull would start from is at its very top. */
const allAtTop = (scrollers: readonly HTMLElement[]) =>
  scrollers.every((scroller) => scroller.scrollTop <= 0);

interface Pull {
  phase: 'undecided' | 'pulling';
  startT: number;
  startX: number;
  startY: number;
  /** Finger y where the pull began; the panel follows from there. */
  originY: number;
  travel: number;
  samples: PagerSample[];
  /** The lists under the finger, nearest first (the page last). */
  scrollers: HTMLElement[];
  /** Their own overflow while the pull holds them still. */
  lockedOverflow: Array<{ value: string; priority: string }> | null;
}

export interface TabsPullDownOptions {
  /** Listening at all (a phone, signed in). Stays on through a pull. */
  enabled: boolean;
  /** A pull may start now: the Tabs window closed, nothing over the
   * sections. Read when a finger comes down. */
  canStart: boolean;
  /** The sections a pull may start in (where they show their lists). */
  sections: readonly MobileTabKey[];
  /** Open the Tabs window for a pull: shown at once, no slide of its own. */
  onPullStart: () => void;
  /** The pull was let go: the window stays open (true) or closes. */
  onPullEnd: (open: boolean) => void;
  /** No following the finger: a pull past the slop just opens it. */
  reducedMotion?: boolean;
}

/**
 * Pull-down-for-Tabs on the sections' lists. Listeners are passive and on
 * the document (capture), so they see touches whatever handles them; only a
 * downward drag that starts with its list at the very top (or on something
 * that does not scroll) becomes a pull. Sideways swipes, scrolls and
 * press-and-holds are left alone.
 */
export function useTabsPullDown(options: TabsPullDownOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { enabled } = options;

  useEffect(() => {
    if (!enabled) return;
    let pull: Pull | null = null;
    let frame: number | null = null;
    let settleTimer: number | null = null;

    const panelHeight = () => panelElement?.offsetHeight ?? 0;

    const writeFrame = () => {
      frame = null;
      const panel = panelElement;
      if (!pull || pull.phase !== 'pulling' || !panel) return;
      const height = panel.offsetHeight;
      if (height <= 0) return;
      const position = Math.max(0, Math.min(height, pull.travel));
      panel.style.transition = 'none';
      panel.style.willChange = 'transform';
      panel.style.transform = `translate3d(0, ${Math.round(position - height)}px, 0)`;
    };

    const lockScrollers = (current: Pull) => {
      current.lockedOverflow = current.scrollers.map((scroller) => {
        const locked = {
          value: scroller.style.getPropertyValue('overflow-y'),
          priority: scroller.style.getPropertyPriority('overflow-y'),
        };
        // Held still: a finger going back up moves the panel, not the list.
        scroller.style.setProperty('overflow-y', 'hidden', 'important');
        return locked;
      });
    };

    const unlockScrollers = (current: Pull) => {
      const locked = current.lockedOverflow;
      if (!locked) return;
      current.lockedOverflow = null;
      current.scrollers.forEach((scroller, index) => {
        const { value, priority } = locked[index];
        if (value) {
          scroller.style.setProperty('overflow-y', value, priority);
        } else {
          scroller.style.removeProperty('overflow-y');
        }
      });
    };

    const startPull = (current: Pull, y: number) => {
      current.phase = 'pulling';
      current.originY = y;
      current.travel = 0;
      lockScrollers(current);
      pullActive = true;
      if (panelElement) setTabsPanelElement(panelElement);
      optionsRef.current.onPullStart();
    };

    const endPull = (current: Pull, open: boolean, velocity: number) => {
      unlockScrollers(current);
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      const panel = panelElement;
      const height = panelHeight();
      const done = () => {
        settleTimer = null;
        pullActive = false;
        if (open) clearPanel(panelElement);
        optionsRef.current.onPullEnd(open);
        if (!open) {
          // Slid away (or gone): hand it back as it was for the next open.
          const closed = panelElement;
          window.setTimeout(() => {
            if (!pullActive && panelElement === closed) clearPanel(closed);
          }, CLOSED_HANDBACK_MS);
        }
      };
      if (!panel || height <= 0 || optionsRef.current.reducedMotion) {
        done();
        return;
      }
      const from = Math.max(0, Math.min(height, current.travel)) - height;
      const to = open ? 0 : -height;
      const duration = pagerSettleDurationMs(to - from, velocity, height);
      panel.style.transition = `transform ${duration}ms ${PAGER_RELEASE_EASING}`;
      panel.style.transform = `translate3d(0, ${to}px, 0)`;
      settleTimer = window.setTimeout(done, duration + 40);
    };

    const sectionAllows = (target: Element | null) => {
      const section = target
        ?.closest(`[${SECTION_ATTR}]`)
        ?.getAttribute(SECTION_ATTR) as MobileTabKey | undefined;
      return Boolean(section && optionsRef.current.sections.includes(section));
    };

    const onTouchStart = (event: TouchEvent) => {
      if (pull?.phase === 'pulling') return;
      pull = null;
      if (settleTimer !== null || event.touches.length !== 1) return;
      if (!optionsRef.current.canStart) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !sectionAllows(target)) return;
      if (target.closest(`[${TABS_PULL_IGNORE_ATTR}]`)) return;
      // Open chats and full-screen panels keep their own gestures.
      if (target.closest('[data-section-swipe-ignore]')) return;
      const scrollers = verticalScrollersOf(
        target,
        target.closest(`[${SECTION_ATTR}]`)
      );
      // Only from the very top of the list and of the page around it (or
      // of a page that does not scroll): anywhere else, a drag down scrolls
      // back up.
      if (!allAtTop(scrollers)) return;
      const touch = event.touches[0];
      pull = {
        phase: 'undecided',
        startT: event.timeStamp,
        startX: touch.clientX,
        startY: touch.clientY,
        originY: touch.clientY,
        travel: 0,
        samples: [],
        scrollers,
        lockedOverflow: null,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const current = pull;
      if (!current) return;
      if (event.touches.length !== 1) {
        if (current.phase === 'pulling') endPull(current, false, 0);
        pull = null;
        return;
      }
      const touch = event.touches[0];
      if (current.phase === 'undecided') {
        const dx = touch.clientX - current.startX;
        const dy = touch.clientY - current.startY;
        const axis = resolvePagerAxis(
          dx,
          dy,
          event.timeStamp - current.startT,
          TABS_PULL_SLOP_PX
        );
        if (axis === null) return;
        if (
          axis !== 'vertical' ||
          dy <= 0 ||
          !allAtTop(current.scrollers) ||
          isHorizontalGestureClaimed(current.startT)
        ) {
          pull = null;
          return;
        }
        startPull(current, touch.clientY);
        if (optionsRef.current.reducedMotion) return;
      }
      current.travel = touch.clientY - current.originY;
      current.samples.push({ t: event.timeStamp, x: touch.clientY });
      if (current.samples.length > 6) current.samples.shift();
      if (optionsRef.current.reducedMotion) return;
      if (frame === null) frame = requestAnimationFrame(writeFrame);
    };

    const onTouchEnd = (event: TouchEvent) => {
      const current = pull;
      pull = null;
      if (current?.phase !== 'pulling') return;
      if (optionsRef.current.reducedMotion) {
        endPull(current, event.type !== 'touchcancel', 0);
        return;
      }
      if (event.type === 'touchcancel') {
        endPull(current, false, 0);
        return;
      }
      const lifted = event.changedTouches?.[0];
      const lift: PagerSample = {
        t: event.timeStamp,
        x: lifted?.clientY ?? current.originY + current.travel,
      };
      current.travel = lift.x - current.originY;
      const velocity = pagerLiftVelocity(current.samples, lift);
      const height = panelHeight();
      const open =
        velocity > TABS_PULL_FLING_VELOCITY ||
        (velocity > -TABS_PULL_FLING_VELOCITY &&
          current.travel > (height > 0 ? height : 300) * TABS_PULL_OPEN_RATIO);
      endPull(current, open, velocity);
    };

    const options = { capture: true, passive: true } as const;
    document.addEventListener('touchstart', onTouchStart, options);
    document.addEventListener('touchmove', onTouchMove, options);
    document.addEventListener('touchend', onTouchEnd, options);
    document.addEventListener('touchcancel', onTouchEnd, options);
    return () => {
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchmove', onTouchMove, true);
      document.removeEventListener('touchend', onTouchEnd, true);
      document.removeEventListener('touchcancel', onTouchEnd, true);
      if (frame !== null) cancelAnimationFrame(frame);
      if (pull?.phase === 'pulling') unlockScrollers(pull);
      if (settleTimer !== null) {
        // Turned off mid-glide: land where it was heading.
        window.clearTimeout(settleTimer);
        pullActive = false;
        clearPanel(panelElement);
      }
      pull = null;
    };
  }, [enabled]);
}
