/**
 * Swiping between pictures and videos in the full-screen viewer. Pure rules
 * (when a swipe counts, how a side with nothing on it resists), so they can
 * be tested without touch events.
 *
 * Swiping right (the finger moving right) shows older pictures and videos,
 * and swiping left goes toward the newest: the older one waits on the left
 * of the one shown, the newer one on its right, as in a photo gallery.
 */

/** Space between two slides while they slide past each other. */
export const SLIDE_GAP_PX = 24;
/** A swipe past this share of the screen width moves on... */
export const SWIPE_COMMIT_FRACTION = 0.22;
/** ...and so does a quick flick, however short (px per ms). */
export const SWIPE_COMMIT_VELOCITY = 0.45;
/** On a side with nothing more, the slide follows the finger this much. */
export const EDGE_RESISTANCE = 0.28;
/** Finger travel before the gesture picks an axis. */
export const AXIS_LOCK_PX = 8;
export const SLIDE_MS = 300;
export const SLIDE_EASE = 'cubic-bezier(0.22, 0.9, 0.3, 1)';

export type SwipeSide = 'left' | 'right';

/** The side a drag of `dx` brings in: dragging left reveals the right. */
export const sideRevealedBy = (dx: number): SwipeSide =>
  dx < 0 ? 'right' : 'left';

/** How far the slides move for a finger `dx` away from where it started. */
export const dragOffset = (dx: number, canReveal: boolean): number =>
  canReveal ? dx : dx * EDGE_RESISTANCE;

/**
 * Where a released swipe goes: the side whose slide comes in, or null to
 * spring back. `velocity` is px per ms, negative to the left.
 */
export const decideSwipe = ({
  dx,
  velocity,
  width,
  hasLeft,
  hasRight,
}: {
  dx: number;
  velocity: number;
  width: number;
  hasLeft: boolean;
  hasRight: boolean;
}): SwipeSide | null => {
  if (dx === 0) return null;
  const side = sideRevealedBy(dx);
  if (side === 'right' ? !hasRight : !hasLeft) return null;
  const quick = Math.abs(velocity) > SWIPE_COMMIT_VELOCITY;
  const backward =
    Math.sign(velocity) !== 0 && Math.sign(velocity) !== Math.sign(dx);
  // A flick back the other way cancels however far it went.
  if (backward && quick) return null;
  const far = Math.abs(dx) > width * SWIPE_COMMIT_FRACTION;
  return far || (quick && !backward) ? side : null;
};

/** Index steps per side: older (lower index) on the left. */
export const stepFor = (side: SwipeSide): number => (side === 'left' ? -1 : 1);
