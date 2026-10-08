/**
 * Pure decisions behind the sideways swipe between Home, Apps and Chat on
 * phones. Thresholds, velocity and the glide come from the chat list pager
 * (hooks/horizontalPagerSwipe), so both swipes feel the same; this file only
 * adds what is particular to whole sections.
 */

/** Each section's outermost element carries its key (home / apps / chat). */
export const SECTION_ATTR = 'data-go-section';
/** Touches starting inside this never switch sections (an open chat). */
export const SECTION_SWIPE_IGNORE_ATTR = 'data-section-swipe-ignore';
/**
 * A sideways swiper that coordinates through horizontalGestureClaim (the
 * chat list pager): the section swipe trusts it to claim what it handles,
 * instead of stepping aside for everything inside it.
 */
export const SECTION_SWIPE_COOPERATIVE_ATTR = 'data-section-swipe-cooperative';
/** A section's main scroller, marked SECTION_SURFACE_TOUCH_ACTION. */
export const SECTION_SWIPE_SURFACE_ATTR = 'data-section-swipe-surface';

/**
 * touch-action for a section's main scroller, and for anything else a
 * sideways swipe of ours runs on: native vertical scrolling, and a sideways
 * start never scrolls it (nothing there scrolls sideways, so the browser's
 * pan goes nowhere).
 *
 * Not plain pan-y: the browser then drops a sideways swipe's scroll but
 * still runs its fling, unseen, for about a second, and the next touch,
 * stopping that fling, loses its tap (Chromium; the first tap on a chat
 * right after a swipe did nothing).
 */
export const SECTION_SURFACE_TOUCH_ACTION = 'pan-x pan-y pinch-zoom';

type StyleReader = (element: Element) => {
  overflowX: string;
  touchAction: string;
};

const defaultStyleReader: StyleReader = (element) =>
  window.getComputedStyle(element);

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
/** Elements whose own sideways drag means something (seek bars, drawing). */
const OWN_DRAG_TAGS = new Set(['VIDEO', 'AUDIO', 'CANVAS', 'IFRAME']);

/** touch-action that leaves sideways panning to the page's own code. */
export const touchActionOwnsHorizontal = (touchAction: string): boolean => {
  const value = touchAction.trim().toLowerCase();
  if (value === '' || value === 'auto' || value === 'manipulation') {
    return false;
  }
  if (value === 'none') return true;
  // pan-y, pinch-zoom, pan-up... without any pan-x: something here handles
  // sideways drags itself (framer-motion drag, a slider, a custom pager).
  return !/\bpan-(x|left|right)\b/.test(value);
};

/**
 * The element between `target` and `root` that owns a sideways drag
 * starting at `target`, or null when the swipe may switch sections:
 *
 * - anything marked SECTION_SWIPE_IGNORE_ATTR;
 * - text fields (a sideways drag moves the cursor or selects);
 * - media, canvases and frames;
 * - anything that scrolls sideways (carousels such as Featured apps);
 * - anything that declared its own sideways handling through touch-action
 *   (framer-motion drags, sliders, zoomable boxes).
 *
 * Inside a SECTION_SWIPE_COOPERATIVE_ATTR container only the container
 * and what is above it count: it claims the gestures it takes.
 * Elements marked SECTION_SWIPE_SURFACE_ATTR, or carrying exactly
 * SECTION_SURFACE_TOUCH_ACTION, are the sections' own scrollers and never
 * block.
 */
export function findHorizontalOwner(
  target: Element | null,
  root: Element,
  readStyle: StyleReader = defaultStyleReader
): Element | null {
  if (!target || !root.contains(target)) return null;
  const ignored = target.closest(`[${SECTION_SWIPE_IGNORE_ATTR}]`);
  if (ignored && root.contains(ignored)) return ignored;

  const cooperative = target.closest(`[${SECTION_SWIPE_COOPERATIVE_ATTR}]`);
  let element: Element | null =
    cooperative && root.contains(cooperative)
      ? cooperative.parentElement
      : target;

  while (element && element !== root) {
    if (EDITABLE_TAGS.has(element.tagName)) return element;
    if (OWN_DRAG_TAGS.has(element.tagName)) return element;
    if (element instanceof HTMLElement && element.isContentEditable) {
      return element;
    }
    if (!element.hasAttribute(SECTION_SWIPE_SURFACE_ATTR)) {
      const style = readStyle(element);
      const scrollsSideways =
        (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
        element.scrollWidth > element.clientWidth + 1;
      if (scrollsSideways) return element;
      const touchAction = (style.touchAction ?? '').trim().toLowerCase();
      // A section's own scroller (marked by its touch-action) is the swipe's
      // surface, not an owner.
      if (
        touchAction !== SECTION_SURFACE_TOUCH_ACTION &&
        touchActionOwnsHorizontal(touchAction)
      ) {
        return element;
      }
    }
    element = element.parentElement;
  }
  return null;
}

/**
 * Where a section sits (px from the screen's left edge) during a drag whose
 * content offset is `offset`: the current one at the offset, its
 * neighbours a screen width to either side.
 */
export const sectionTranslateX = (
  sectionIndex: number,
  currentIndex: number,
  offset: number,
  width: number
): number => (sectionIndex - currentIndex) * width + offset;
