/**
 * FLIP animations on the Web Animations API. Only transform and opacity are
 * animated, so Chrome runs them on the compositor: they stay smooth while a
 * busy Q-App keeps the shared main thread loaded.
 */

/** A launcher-like ease: quick start, long soft landing. */
export const FLIP_EASE = 'cubic-bezier(0.2, 0.9, 0.25, 1)';
export const FLIP_ID = 'go-flip';

type Box = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

const canAnimate = (element: Element): element is HTMLElement =>
  typeof (element as HTMLElement).animate === 'function';

/**
 * The transform that draws an element laid out at `to` exactly over `from`,
 * for the default centre transform-origin.
 */
export function transformBetween(from: Box, to: Box): string {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const sx = to.width > 0 ? from.width / to.width : 1;
  const sy = to.height > 0 ? from.height / to.height : 1;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return `translate(${round(dx)}px, ${round(dy)}px) scale(${round(sx)}, ${round(sy)})`;
}

/** True when two boxes differ by less than half a pixel everywhere. */
export function sameBox(a: Box, b: Box): boolean {
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

export function cancelFlip(element: Element): void {
  if (typeof (element as HTMLElement).getAnimations !== 'function') return;
  (element as HTMLElement).getAnimations().forEach((animation) => {
    if (animation.id === FLIP_ID) animation.cancel();
  });
}

/** Where every `[attr]` element is drawn right now (running animations included). */
export function measureBoxes(
  root: ParentNode | null | undefined,
  attr: string
): Map<string, DOMRect> {
  const boxes = new Map<string, DOMRect>();
  if (!root) return boxes;
  root.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((element) => {
    const id = element.getAttribute(attr);
    if (id) boxes.set(id, element.getBoundingClientRect());
  });
  return boxes;
}

/**
 * Animates an element from the box `from` to where it is laid out now.
 * Returns the animation, or null when there is nothing to do.
 */
export function animateFromBox(
  element: Element,
  from: Box,
  options: {
    duration?: number;
    easing?: string;
    delay?: number;
    fromOpacity?: number;
    toOpacity?: number;
    fill?: FillMode;
  } = {}
): Animation | null {
  if (!canAnimate(element) || prefersReducedMotion()) return null;
  cancelFlip(element);
  const to = element.getBoundingClientRect();
  if (sameBox(from, to) && options.fromOpacity == null) return null;
  const first: Keyframe = { transform: transformBetween(from, to) };
  const last: Keyframe = { transform: 'none' };
  if (options.fromOpacity != null) {
    first.opacity = options.fromOpacity;
    last.opacity = options.toOpacity ?? 1;
  }
  const animation = element.animate([first, last], {
    duration: options.duration ?? 300,
    easing: options.easing ?? FLIP_EASE,
    delay: options.delay ?? 0,
    fill: options.fill ?? 'backwards',
  });
  animation.id = FLIP_ID;
  return animation;
}

/** Animates an element from where it is laid out now into the box `to`. */
export function animateToBox(
  element: Element,
  to: Box,
  options: {
    duration?: number;
    easing?: string;
    toOpacity?: number;
  } = {}
): Animation | null {
  if (!canAnimate(element) || prefersReducedMotion()) return null;
  const from = element.getBoundingClientRect();
  const first: Keyframe = { transform: 'none' };
  const last: Keyframe = { transform: transformBetween(to, from) };
  if (options.toOpacity != null) {
    first.opacity = 1;
    last.opacity = options.toOpacity;
  }
  const animation = element.animate([first, last], {
    duration: options.duration ?? 260,
    easing: options.easing ?? FLIP_EASE,
    fill: 'forwards',
  });
  animation.id = FLIP_ID;
  return animation;
}

/**
 * The second half of a FLIP over a list: every `[attr]` element under `root`
 * that moved since `before` was measured glides from its old box to its new
 * one. Elements that are new fade and scale in when `enterNew` is set.
 */
export function playFlip(
  root: ParentNode | null | undefined,
  attr: string,
  before: Map<string, DOMRect>,
  options: {
    duration?: number;
    easing?: string;
    skip?: (id: string) => boolean;
    enterNew?: boolean;
  } = {}
): void {
  if (!root || prefersReducedMotion()) return;
  root.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((element) => {
    const id = element.getAttribute(attr);
    if (!id || options.skip?.(id)) return;
    const from = before.get(id);
    if (!from) {
      if (!options.enterNew || !canAnimate(element)) return;
      cancelFlip(element);
      const animation = element.animate(
        [
          { opacity: 0, transform: 'scale(0.86)' },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: options.duration ?? 280,
          easing: options.easing ?? FLIP_EASE,
        }
      );
      animation.id = FLIP_ID;
      return;
    }
    // Measured without the old animation, so the new one starts from where
    // the element was drawn and ends where it is laid out now.
    cancelFlip(element);
    const to = element.getBoundingClientRect();
    if (sameBox(from, to)) return;
    const animation = element.animate(
      [{ transform: transformBetween(from, to) }, { transform: 'none' }],
      { duration: options.duration ?? 300, easing: options.easing ?? FLIP_EASE }
    );
    animation.id = FLIP_ID;
  });
}
