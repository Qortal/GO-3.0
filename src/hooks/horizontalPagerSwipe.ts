/**
 * Pure decisions behind the swipe between side-by-side pages (the phone
 * Q-Chat Groups / DMs lists). Kept apart from the DOM wiring in
 * useHorizontalPagerSwipe so every threshold is unit-testable.
 *
 * Pages sit left to right in index order. A finger moving right-to-left
 * (negative dx) drags the content left and brings in the next page from the
 * right; left-to-right brings back the previous one.
 */

/** Touches that start this close to either screen edge are never a page
 * swipe: the Android back gesture and the chat list's edge swipe own them. */
export const PAGER_EDGE_ZONE_PX = 24;
/** Finger travel before the gesture commits to one axis. */
export const PAGER_AXIS_LOCK_PX = 10;
/** A finger that stays put this long is a press-and-hold (a row's long-press
 * menu, a pin's hold to reorder), never a swipe, even if it moves later. */
export const PAGER_HOLD_MS = 400;
/** A slow drag past this share of the page width turns the page. */
export const PAGER_COMMIT_RATIO = 0.28;
/** A flick at least this fast (px/ms, about 400 px/s) turns the page... */
export const PAGER_FLING_VELOCITY = 0.4;
/** ...once it has travelled at least this far. */
export const PAGER_FLING_MIN_PX = 24;
/** How far the content can be pulled past the first or last page. */
export const PAGER_RUBBER_BAND_MAX_PX = 48;
/** Only finger movement this recent counts towards the release velocity. */
export const PAGER_VELOCITY_WINDOW_MS = 100;
/** A finger that rested this long before lifting had stopped: no flick
 * (Android's own velocity tracker makes the same call). Browsers send no
 * touchmove while a finger rests, so this is read off the lift. */
export const PAGER_POINTER_STOPPED_MS = 40;
/** List scroll changes this soon after touchdown, or before the finger has
 * moved PAGER_SCROLL_SETTLE_PX, are a fling the touch just stopped (or the
 * list settling), not a scroll this gesture started. */
export const PAGER_SCROLL_SETTLE_MS = 50;
export const PAGER_SCROLL_SETTLE_PX = 4;
/** A list scroll smaller than this (px) is rounding, not scrolling. */
export const PAGER_SCROLL_SLOP_PX = 2;
/** Settle animation bounds (ms). */
export const PAGER_SETTLE_MIN_MS = 140;
export const PAGER_SETTLE_MAX_MS = 320;
/** Ease-out (cubic) for the glide after the finger lets go: it starts at the
 * speed the finger had and slows to a stop. */
export const PAGER_RELEASE_EASING = 'cubic-bezier(0.33, 1, 0.68, 1)';
/** The chat list panel's curve, for a slide started by a tap. */
export const PAGER_SLIDE_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

/** Marks a list's scrolling element inside a pager page. */
export const PAGER_SCROLLER_ATTR = 'data-pager-scroller';
/** Touches starting inside an element with this attribute never swipe pages
 * (for example rows being dragged to reorder). */
export const PAGER_IGNORE_ATTR = 'data-pager-swipe-ignore';

/** What a touch turned out to be: a sideways swipe (the pager's), a
 * vertical scroll or a press-and-hold (neither is). */
export type PagerAxis = 'horizontal' | 'vertical' | 'hold';

export interface PagerSample {
  /** Event time stamp, ms. */
  t: number;
  /** Finger x, px. */
  x: number;
}

/** Whether a touch starting at `x` is inside the left or right edge zone. */
export function isInPagerEdgeZone(
  x: number,
  viewportWidth: number,
  zone = PAGER_EDGE_ZONE_PX
): boolean {
  return x < zone || x > viewportWidth - zone;
}

/**
 * The axis a gesture locks to once the finger has moved `lockPx` on either
 * axis, or null while it is still undecided. Ties go to vertical, so list
 * scrolling always wins an ambiguous gesture. A touch still undecided after
 * PAGER_HOLD_MS (`elapsedMs` since it started) is a hold.
 */
export function resolvePagerAxis(
  dx: number,
  dy: number,
  elapsedMs = 0,
  lockPx = PAGER_AXIS_LOCK_PX
): PagerAxis | null {
  if (elapsedMs >= PAGER_HOLD_MS) return 'hold';
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < lockPx && ay < lockPx) return null;
  return ax > ay ? 'horizontal' : 'vertical';
}

/**
 * The page a drag of `dx` px heads for: next for right-to-left, previous for
 * left-to-right, or null past either end (or for no movement).
 */
export function pagerTargetForDrag(
  page: number,
  dx: number,
  pageCount: number
): number | null {
  if (dx === 0) return null;
  const target = dx < 0 ? page + 1 : page - 1;
  return target >= 0 && target < pageCount ? target : null;
}

/**
 * Resistance for a pull past the first or last page: half speed at first,
 * never further than `max` px.
 */
export function pagerRubberBand(
  distance: number,
  max = PAGER_RUBBER_BAND_MAX_PX
): number {
  if (distance === 0 || max <= 0) return 0;
  const magnitude = max * (1 - 1 / (Math.abs(distance) / (2 * max) + 1));
  return Math.sign(distance) * magnitude;
}

/**
 * Where the content sits (px, relative to the current page's resting spot)
 * for a drag of `dx`: with the finger towards a neighbouring page, at most a
 * whole page; past either end, rubber-banded.
 */
export function pagerDragOffset(
  page: number,
  dx: number,
  pageCount: number,
  width: number
): number {
  if (pagerTargetForDrag(page, dx, pageCount) === null) {
    return pagerRubberBand(dx);
  }
  return Math.max(-width, Math.min(width, dx));
}

/**
 * The finger travel that pagerDragOffset turns into `offset`: what a touch
 * that catches the content `offset` px from `page`'s resting spot has, in
 * effect, already dragged it (past either end, undoing the rubber band).
 */
export function pagerTravelForOffset(
  page: number,
  offset: number,
  pageCount: number,
  max = PAGER_RUBBER_BAND_MAX_PX
): number {
  if (pagerTargetForDrag(page, offset, pageCount) !== null) return offset;
  if (offset === 0 || max <= 0) return 0;
  const magnitude = Math.min(Math.abs(offset), max * 0.95);
  return (Math.sign(offset) * (2 * magnitude * max)) / (max - magnitude);
}

/** Finger velocity (px/ms) over the last `windowMs` of samples. */
export function pagerReleaseVelocity(
  samples: PagerSample[],
  windowMs = PAGER_VELOCITY_WINDOW_MS
): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = last;
  for (let i = samples.length - 2; i >= 0; i -= 1) {
    if (last.t - samples[i].t > windowMs) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

/**
 * Finger velocity (px/ms) at `lift`, the touchend, given the drag's moves.
 * A finger that rested before lifting has no flick left in it, however fast
 * its last moves were.
 */
export function pagerLiftVelocity(
  samples: PagerSample[],
  lift: PagerSample,
  windowMs = PAGER_VELOCITY_WINDOW_MS,
  stoppedMs = PAGER_POINTER_STOPPED_MS
): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const rested = lift.t - last.t >= stoppedMs && Math.abs(lift.x - last.x) < 1;
  if (rested) return 0;
  return pagerReleaseVelocity([...samples, lift], windowMs);
}

/**
 * Whether a change in the list's scroll offset at this point of a touch
 * (`dx`, `dy` from touchdown, `elapsedMs` since) is left over from before
 * it, such as the last frames of a fling the touch stopped.
 */
export function isPagerScrollSettling(
  dx: number,
  dy: number,
  elapsedMs: number
): boolean {
  return (
    elapsedMs < PAGER_SCROLL_SETTLE_MS ||
    (Math.abs(dx) < PAGER_SCROLL_SETTLE_PX &&
      Math.abs(dy) < PAGER_SCROLL_SETTLE_PX)
  );
}

/**
 * The x translation (px) in a computed or inline CSS `transform`, such as
 * the track's mid-glide position; `%` is of `width`. Null when unreadable.
 */
export function pagerTranslateX(
  transform: string | null | undefined,
  width: number
): number | null {
  const value = (transform ?? '').trim();
  if (value === '' || value === 'none') return 0;
  const matrix = /^matrix(3d)?\(([^)]*)\)$/.exec(value);
  if (matrix) {
    const parts = matrix[2].split(',').map((part) => Number(part.trim()));
    const x = parts[matrix[1] ? 12 : 4];
    return Number.isFinite(x) ? x : null;
  }
  const translate = /^translate(?:3d|X)?\(\s*(-?[\d.]+(?:e-?\d+)?)(px|%)?/.exec(
    value
  );
  if (!translate) return null;
  const amount = Number(translate[1]);
  if (!Number.isFinite(amount)) return null;
  return translate[2] === '%' ? (amount / 100) * width : amount;
}

/**
 * The page to settle on when the finger lets go after a drag of `dx` px at
 * `velocity` px/ms. A flick decides by its direction (a flick back cancels a
 * long drag); otherwise the drag must cover PAGER_COMMIT_RATIO of the width.
 */
export function resolvePagerRelease({
  dx,
  page,
  pageCount,
  velocity,
  width,
}: {
  dx: number;
  page: number;
  pageCount: number;
  velocity: number;
  width: number;
}): number {
  const target = pagerTargetForDrag(page, dx, pageCount);
  if (target === null) return page;
  const isFling =
    Math.abs(velocity) >= PAGER_FLING_VELOCITY &&
    Math.abs(dx) >= PAGER_FLING_MIN_PX;
  if (isFling) {
    return Math.sign(velocity) === Math.sign(dx) ? target : page;
  }
  return Math.abs(dx) >= width * PAGER_COMMIT_RATIO ? target : page;
}

/**
 * How long the content takes to glide the `remaining` px to its resting
 * spot: shorter for short distances and fast flicks, within fixed bounds.
 */
export function pagerSettleDurationMs(
  remaining: number,
  velocity: number,
  width: number
): number {
  const distance = Math.abs(remaining);
  const byDistance =
    PAGER_SETTLE_MIN_MS +
    (PAGER_SETTLE_MAX_MS - PAGER_SETTLE_MIN_MS) *
      Math.min(1, width > 0 ? distance / width : 1);
  // The glide's ease-out curve (PAGER_RELEASE_EASING) starts at three times
  // its average speed, so this keeps the content moving as fast as the
  // finger left it.
  const speed = Math.abs(velocity);
  const byVelocity = speed > 0 ? (distance / speed) * 3 : Infinity;
  return Math.round(
    Math.max(
      PAGER_SETTLE_MIN_MS,
      Math.min(PAGER_SETTLE_MAX_MS, byDistance, byVelocity)
    )
  );
}

/** CSS transform for the track resting on `page`. */
export function pagerTrackTransform(page: number): string {
  return `translate3d(${-page * 100}%, 0, 0)`;
}
