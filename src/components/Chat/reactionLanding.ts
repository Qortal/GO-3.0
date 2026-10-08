/**
 * The little show when a reaction lands under a message. The viewer's own
 * reaction takes off the moment it is picked: it lifts off the popup's pill
 * (or the emoji grid), or pops up under the finger after a double tap. Once
 * its chip is under the message it flies there in an arc, the chip bounces
 * as it lands with a ring and a few sparks, and the chat scrolls so the chip
 * is seen. Reactions from others just pop in.
 *
 * Everything moves through the Web Animations API on transform and opacity
 * only, with the whole path worked out up front, so the compositor runs it
 * at full frame rate even while the chat re-renders and the list re-measures.
 */

export type ReactionLandingSource = {
  /** Centre of the emoji the flight starts from, in client coordinates. */
  x: number;
  y: number;
  /** Its font size in px. */
  size: number;
  /** A double tap: the emoji first pops up under the finger. */
  pop?: boolean;
};

/** Above the phone message popup (snackbar layer + 50). */
export const LANDING_Z_INDEX = 1500;
/** An emoji whose chip never shows (the send failed) fades after this. */
const CLAIM_TTL_MS = 4_000;
const LAUNCH_POP_MS = 260;
const LAUNCH_LIFT_MS = 150;
const FLIGHT_MS = 540;
const FLIGHT_STEPS = 32;
/**
 * However the flight goes (the app sent to the background, a WebView that
 * stalls animations), the chip shows its emoji after this.
 */
const LANDING_SAFETY_MS = 2_500;

export const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
};

/** The source for a flight starting from an element on screen. */
export const landingSourceFromElement = (
  element: Element | null | undefined,
  fallbackSize = 28
): ReactionLandingSource | undefined => {
  const rect = element?.getBoundingClientRect?.();
  if (!rect || (rect.width === 0 && rect.height === 0)) return undefined;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    size: Math.max(16, Math.min(48, rect.height || fallbackSize)),
  };
};

const isScrollable = (element: HTMLElement) => {
  const style = window.getComputedStyle(element);
  return (
    /(auto|scroll|overlay)/.test(style.overflowY) &&
    element.scrollHeight > element.clientHeight + 1
  );
};

export const findScrollParent = (
  element: HTMLElement | null
): HTMLElement | null => {
  let node = element?.parentElement ?? null;
  while (node && node !== document.body) {
    if (isScrollable(node)) return node;
    node = node.parentElement;
  }
  return null;
};

/**
 * How far the chat must scroll for `element` to be in view, clear of the
 * soft keyboard: the scroller and the distance, kept within what it can
 * actually scroll.
 */
export const planReveal = (
  element: HTMLElement,
  margin = 14
): { parent: HTMLElement; delta: number } | null => {
  const parent = findScrollParent(element);
  if (!parent) return null;
  const rect = element.getBoundingClientRect();
  const box = parent.getBoundingClientRect();
  const visual = window.visualViewport;
  const visibleBottom = Math.min(
    box.bottom,
    visual ? visual.offsetTop + visual.height : window.innerHeight
  );
  let delta = 0;
  if (rect.bottom + margin > visibleBottom) {
    delta = rect.bottom + margin - visibleBottom;
  } else if (rect.top - margin < box.top) {
    delta = rect.top - margin - box.top;
  }
  const maxScroll = Math.max(0, parent.scrollHeight - parent.clientHeight);
  const target = Math.min(maxScroll, Math.max(0, parent.scrollTop + delta));
  delta = target - parent.scrollTop;
  return Math.abs(delta) < 1 ? null : { parent, delta };
};

const scrollChat = (plan: { parent: HTMLElement; delta: number }) => {
  const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
  if (typeof plan.parent.scrollBy === 'function') {
    plan.parent.scrollBy({ top: plan.delta, behavior });
  } else {
    plan.parent.scrollTop += plan.delta;
  }
};

/** Scrolls the chat just enough that `element` is in view. */
export const revealInScrollParent = (
  element: HTMLElement,
  margin = 14
): boolean => {
  const plan = planReveal(element, margin);
  if (!plan) return false;
  scrollChat(plan);
  return true;
};

const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

const canAnimate = (element: Element | null | undefined) =>
  Boolean(element) && typeof (element as HTMLElement).animate === 'function';

const supportsAnimations = () =>
  typeof HTMLElement !== 'undefined' &&
  typeof HTMLElement.prototype.animate === 'function';

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const nextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
    } else {
      window.setTimeout(resolve, 16);
    }
  });

const overlayLayer = (zIndex: number) => {
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.dataset.reactionLanding = 'true';
  Object.assign(layer.style, {
    contain: 'strict',
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    position: 'fixed',
    zIndex: String(zIndex),
  });
  document.body.appendChild(layer);
  return layer;
};

type LandingColors = { ring: string; sparks: string[] };

/** The chip's bounce, the ring and the sparks, once the emoji is in. */
const playImpact = (
  chip: HTMLElement,
  emojiNode: HTMLElement,
  colors: LandingColors,
  zIndex: number
) => {
  if (!canAnimate(emojiNode)) return;
  emojiNode.animate(
    [
      { transform: 'scale(1.6)' },
      { transform: 'scale(0.8)', offset: 0.42 },
      { transform: 'scale(1.14)', offset: 0.72 },
      { transform: 'scale(1)' },
    ],
    { duration: 520, easing: 'ease-out' }
  );
  chip.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.1, 0.9)', offset: 0.28 },
      { transform: 'scale(0.96, 1.05)', offset: 0.6 },
      { transform: 'scale(1)' },
    ],
    { duration: 440, easing: 'ease-out' }
  );
  const rect = emojiNode.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const layer = overlayLayer(zIndex);
  const ringSize = Math.max(28, rect.height * 1.7);
  const ring = document.createElement('div');
  Object.assign(ring.style, {
    border: `2px solid ${colors.ring}`,
    borderRadius: '50%',
    height: `${ringSize}px`,
    left: `${cx - ringSize / 2}px`,
    position: 'absolute',
    top: `${cy - ringSize / 2}px`,
    width: `${ringSize}px`,
  });
  layer.appendChild(ring);
  const animations: Animation[] = [
    ring.animate(
      [
        { opacity: 0.85, transform: 'scale(0.45)' },
        { opacity: 0, transform: 'scale(1.5)' },
      ],
      { duration: 480, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'both' }
    ),
  ];
  const count = 8;
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 + (index % 2 ? 0.25 : -0.1);
    const distance = ringSize * (index % 2 ? 0.62 : 0.8);
    const size = index % 2 ? 4 : 5;
    const spark = document.createElement('div');
    Object.assign(spark.style, {
      backgroundColor: colors.sparks[index % colors.sparks.length],
      borderRadius: '50%',
      height: `${size}px`,
      left: `${cx - size / 2}px`,
      position: 'absolute',
      top: `${cy - size / 2}px`,
      width: `${size}px`,
    });
    layer.appendChild(spark);
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    animations.push(
      spark.animate(
        [
          { opacity: 0, transform: 'translate(0, 0) scale(0.6)' },
          { opacity: 1, offset: 0.2 },
          {
            opacity: 0,
            transform: `translate(${dx}px, ${dy}px) scale(0.3)`,
          },
        ],
        {
          delay: 40,
          duration: 460,
          easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)',
          fill: 'both',
        }
      )
    );
  }
  Promise.all(animations.map((animation) => animation.finished))
    .catch(() => undefined)
    .finally(() => layer.remove());
};

/** Where the flying emoji is when the launch ends, relative to its start. */
type LaunchEnd = { dx: number; dy: number; scale: number };

/** An emoji in the air, waiting for its chip. */
export type ReactionFlight = {
  source: ReactionLandingSource;
  layer: HTMLElement | null;
  /** Sits on the source's centre; its transform is the whole motion. */
  flyer: HTMLElement | null;
  launch: Animation | null;
  launchEnd: LaunchEnd;
};

type PendingFlight = ReactionFlight & { expiry: number | null };

const pending = new Map<string, PendingFlight>();

const pendingKey = (messageKey: string, emoji: string) =>
  `${messageKey}\u0001${emoji}`;

const fadeAway = (flight: ReactionFlight) => {
  const { layer, flyer } = flight;
  if (!layer) return;
  if (!flyer || !canAnimate(flyer)) {
    layer.remove();
    return;
  }
  const { dx, dy, scale } = flight.launchEnd;
  flyer
    .animate(
      [
        {
          opacity: 1,
          transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
        },
        {
          opacity: 0,
          transform: `translate(${dx}px, ${dy}px) scale(${scale * 0.4})`,
        },
      ],
      { duration: 200, easing: 'ease-in', fill: 'forwards' }
    )
    .finished.catch(() => undefined)
    .finally(() => layer.remove());
};

const discard = (key: string) => {
  const flight = pending.get(key);
  if (!flight) return;
  pending.delete(key);
  if (flight.expiry !== null) window.clearTimeout(flight.expiry);
  fadeAway(flight);
};

/**
 * The viewer just picked `emoji` for this message: the emoji takes off from
 * `source` at once, and the chip that shows the reaction lands it.
 */
export const requestReactionLanding = (
  messageKey: string,
  emoji: string,
  source: ReactionLandingSource,
  zIndex: number = LANDING_Z_INDEX
) => {
  if (!messageKey || !emoji) return;
  const key = pendingKey(messageKey, emoji);
  discard(key);
  const flight: PendingFlight = {
    source,
    layer: null,
    flyer: null,
    launch: null,
    launchEnd: { dx: 0, dy: 0, scale: 1 },
    expiry: null,
  };
  if (supportsAnimations() && !prefersReducedMotion()) {
    const layer = overlayLayer(zIndex);
    const flyer = document.createElement('div');
    Object.assign(flyer.style, {
      backfaceVisibility: 'hidden',
      height: '0',
      left: `${source.x}px`,
      position: 'absolute',
      top: `${source.y}px`,
      transformOrigin: '0 0',
      width: '0',
      willChange: 'transform, opacity',
    });
    const glyph = document.createElement('span');
    glyph.textContent = emoji;
    Object.assign(glyph.style, {
      fontFamily: EMOJI_FONT,
      fontSize: `${source.size}px`,
      left: '0',
      lineHeight: '1',
      position: 'absolute',
      top: '0',
      transform: 'translate(-50%, -50%)',
      whiteSpace: 'nowrap',
    });
    flyer.appendChild(glyph);
    layer.appendChild(flyer);
    flight.layer = layer;
    flight.flyer = flyer;
    if (source.pop) {
      // Springs up under the finger, a little bigger than it will fly.
      flight.launchEnd = { dx: 0, dy: 0, scale: 1.12 };
      flight.launch = flyer.animate(
        [
          { transform: 'translate(0px, 0px) scale(0.2)', opacity: 0 },
          {
            transform: 'translate(0px, 0px) scale(1.34)',
            opacity: 1,
            offset: 0.55,
          },
          { transform: 'translate(0px, 0px) scale(1.12)', opacity: 1 },
        ],
        {
          duration: LAUNCH_POP_MS,
          easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)',
          fill: 'forwards',
        }
      );
    } else {
      // Lifts off the pill as the popup fades under it.
      flight.launchEnd = { dx: 0, dy: -8, scale: 1.18 };
      flight.launch = flyer.animate(
        [
          { transform: 'translate(0px, 0px) scale(1)' },
          { transform: 'translate(0px, -8px) scale(1.18)' },
        ],
        { duration: LAUNCH_LIFT_MS, easing: 'ease-out', fill: 'forwards' }
      );
    }
  }
  flight.expiry = window.setTimeout(() => {
    if (pending.get(key) === flight) discard(key);
  }, CLAIM_TTL_MS);
  pending.set(key, flight);
};

/** Hands the emoji in the air to the chip that just showed the reaction. */
export const takeReactionLanding = (
  messageKey: string,
  emoji: string
): ReactionFlight | null => {
  const key = pendingKey(messageKey, emoji);
  const flight = pending.get(key);
  if (!flight) return null;
  pending.delete(key);
  if (flight.expiry !== null) window.clearTimeout(flight.expiry);
  return flight;
};

/** Drops an emoji in the air (the reaction was taken back or failed). */
export const cancelReactionLanding = (messageKey: string, emoji: string) => {
  discard(pendingKey(messageKey, emoji));
};

/** The arc from the launch's end to the chip, as keyframes. */
const flightKeyframes = (
  from: LaunchEnd,
  to: { dx: number; dy: number; scale: number }
): Keyframe[] => {
  const distance = Math.hypot(to.dx - from.dx, to.dy - from.dy);
  const lift = Math.min(140, Math.max(40, distance * 0.36));
  const cx = (from.dx + to.dx) / 2;
  const cy = Math.min(from.dy, to.dy) - lift;
  const frames: Keyframe[] = [];
  for (let step = 0; step <= FLIGHT_STEPS; step += 1) {
    const t = step / FLIGHT_STEPS;
    const e = easeInOutCubic(t);
    const inv = 1 - e;
    const x = inv * inv * from.dx + 2 * inv * e * cx + e * e * to.dx;
    const y = inv * inv * from.dy + 2 * inv * e * cy + e * e * to.dy;
    // A touch bigger mid-air, then down to the chip's size.
    const scale =
      from.scale + (to.scale - from.scale) * e + 0.14 * Math.sin(Math.PI * t);
    const rotate = -14 * Math.sin(Math.PI * t);
    frames.push({
      offset: t,
      transform: `translate(${x.toFixed(2)}px, ${y.toFixed(
        2
      )}px) rotate(${rotate.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
    });
  }
  return frames;
};

export type ReactionLandingOptions = {
  chip: HTMLElement;
  /** The chip's emoji; hidden here until the flight lands. */
  emojiNode: HTMLElement;
  flight: ReactionFlight;
  colors: LandingColors;
  /** A chip that just appeared: it grows in as the emoji arrives. */
  appear?: boolean;
  zIndex?: number;
};

/**
 * Flies the emoji in the air into its chip and scrolls the chat to show it.
 * Returns a cancel function.
 */
export const playReactionLanding = ({
  chip,
  emojiNode,
  flight,
  colors,
  appear = false,
  zIndex = LANDING_Z_INDEX,
}: ReactionLandingOptions): (() => void) => {
  const { flyer, layer, source } = flight;
  if (!flyer || !layer) {
    const plan = planReveal(chip);
    if (plan) scrollChat(plan);
    return () => undefined;
  }
  emojiNode.style.visibility = 'hidden';
  if (appear) chip.style.opacity = '0';
  let cancelled = false;
  let flightAnimation: Animation | null = null;
  let safety: number | null = null;

  const restore = () => {
    if (safety !== null) window.clearTimeout(safety);
    safety = null;
    emojiNode.style.visibility = '';
    chip.style.opacity = '';
  };
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    flightAnimation?.cancel();
    flight.launch?.cancel();
    layer.remove();
    restore();
  };
  safety = window.setTimeout(cancel, LANDING_SAFETY_MS);

  // Let the launch finish and the list measure the taller row, so the chip's
  // place (and how far the chat must scroll) is final.
  Promise.all([
    flight.launch?.finished.catch(() => undefined),
    nextFrame().then(nextFrame),
  ]).then(() => {
    if (cancelled) return;
    if (!chip.isConnected) {
      cancel();
      return;
    }
    const target = emojiNode.getBoundingClientRect();
    if (target.width === 0 && target.height === 0) {
      cancel();
      return;
    }
    const plan = planReveal(chip);
    const end = {
      dx: target.left + target.width / 2 - source.x,
      dy: target.top + target.height / 2 - (plan?.delta ?? 0) - source.y,
      scale: Math.max(0.2, target.height / source.size),
    };
    flightAnimation = flyer.animate(flightKeyframes(flight.launchEnd, end), {
      duration: FLIGHT_MS,
      easing: 'linear',
      fill: 'forwards',
    });
    // The flight took over the same transform; the launch can go.
    flight.launch?.cancel();
    if (plan) scrollChat(plan);
    if (appear && canAnimate(chip)) {
      chip.animate(
        [
          { opacity: 0, transform: 'scale(0.4)' },
          { opacity: 1, transform: 'scale(1.06)', offset: 0.7 },
          { opacity: 1, transform: 'scale(1)' },
        ],
        {
          delay: FLIGHT_MS * 0.4,
          duration: FLIGHT_MS * 0.45,
          easing: 'ease-out',
          fill: 'backwards',
        }
      );
      chip.style.opacity = '';
    }
    flightAnimation.finished
      .then(() => {
        if (cancelled) return;
        cancelled = true;
        layer.remove();
        restore();
        if (chip.isConnected) playImpact(chip, emojiNode, colors, zIndex);
      })
      .catch(() => undefined);
  });

  return cancel;
};

/** A reaction someone else added (or one more of the same) pops in. */
export const playReactionPop = (chip: HTMLElement, emojiNode: HTMLElement) => {
  if (prefersReducedMotion() || !canAnimate(chip)) return;
  chip.animate(
    [
      { transform: 'scale(0.6)', opacity: 0.4 },
      { transform: 'scale(1.12)', opacity: 1, offset: 0.55 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: 380, easing: 'ease-out' }
  );
  emojiNode.animate(
    [
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(-14deg)', offset: 0.35 },
      { transform: 'rotate(10deg)', offset: 0.7 },
      { transform: 'rotate(0deg)' },
    ],
    { duration: 420, easing: 'ease-in-out' }
  );
};
