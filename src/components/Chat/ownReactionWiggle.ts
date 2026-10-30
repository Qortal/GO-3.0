/**
 * Now and then one of the viewer's own reactions on screen gives a little
 * wiggle, hop or pulse: it keeps the chat feeling alive and reminds the
 * viewer which reaction was theirs. One chip at a time, each at most every
 * few seconds, and only while someone is using the screen: GO's idle pause
 * (`data-hub-ui-idle`, utils/idleAnimationPause.ts) and a hidden page stop
 * it, as looping motion is what costs battery. Each move is a one-shot Web
 * Animation on transform, run by the compositor.
 */
import { prefersReducedMotion } from './reactionLanding';

const TICK_MIN_MS = 2_600;
const TICK_MAX_MS = 4_800;
/** The same chip moves again only after this. */
const CHIP_REST_MS = 8_000;
/** The soonest a chip that just showed up moves. */
const FIRST_TURN_MIN_MS = 2_000;
/** Chips this close to an edge of the screen count as off it. */
const EDGE_MARGIN_PX = 4;

type Move = { keyframes: Keyframe[]; duration: number; easing: string };

const MOVES: Move[] = [
  {
    // Wiggle.
    keyframes: [
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(-16deg)', offset: 0.18 },
      { transform: 'rotate(13deg)', offset: 0.4 },
      { transform: 'rotate(-8deg)', offset: 0.6 },
      { transform: 'rotate(4deg)', offset: 0.8 },
      { transform: 'rotate(0deg)' },
    ],
    duration: 760,
    easing: 'ease-in-out',
  },
  {
    // Hop.
    keyframes: [
      { transform: 'translateY(0px) scale(1, 1)' },
      { transform: 'translateY(1px) scale(1.12, 0.86)', offset: 0.14 },
      { transform: 'translateY(-7px) scale(0.94, 1.08)', offset: 0.42 },
      { transform: 'translateY(0px) scale(1.08, 0.92)', offset: 0.7 },
      { transform: 'translateY(-1.5px) scale(1, 1)', offset: 0.85 },
      { transform: 'translateY(0px) scale(1, 1)' },
    ],
    duration: 720,
    easing: 'ease-in-out',
  },
  {
    // Pulse.
    keyframes: [
      { transform: 'scale(1)' },
      { transform: 'scale(1.3)', offset: 0.35 },
      { transform: 'scale(0.92)', offset: 0.65 },
      { transform: 'scale(1.05)', offset: 0.85 },
      { transform: 'scale(1)' },
    ],
    duration: 640,
    easing: 'ease-in-out',
  },
];

const chips = new Set<HTMLElement>();
const lastMovedAt = new WeakMap<HTMLElement, number>();
let timer: number | null = null;

const isOnScreen = (node: HTMLElement) => {
  if (!node.isConnected) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const visual = window.visualViewport;
  const width = visual?.width ?? window.innerWidth;
  const height = visual ? visual.offsetTop + visual.height : window.innerHeight;
  return (
    rect.top >= EDGE_MARGIN_PX &&
    rect.left >= EDGE_MARGIN_PX &&
    rect.bottom <= height - EDGE_MARGIN_PX &&
    rect.right <= width - EDGE_MARGIN_PX &&
    // Not under a sheet, dialog or the popup: the chip itself is on top.
    isTopmostAt(node, rect)
  );
};

const isTopmostAt = (node: HTMLElement, rect: DOMRect) => {
  if (typeof document.elementFromPoint !== 'function') return true;
  const hit = document.elementFromPoint(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2
  );
  const chip = node.closest('button') ?? node;
  return Boolean(hit && (hit === node || chip.contains(hit)));
};

const isBusy = (node: HTMLElement) =>
  typeof node.getAnimations === 'function' && node.getAnimations().length > 0;

const canMoveNow = () =>
  !document.hidden &&
  document.documentElement.getAttribute('data-hub-ui-idle') !== 'on' &&
  !prefersReducedMotion();

/** One move, on the chip that has rested longest among those on screen. */
export const moveOneOwnReaction = (now: number = Date.now()): boolean => {
  if (!canMoveNow()) return false;
  let pick: HTMLElement | null = null;
  let pickRest = -1;
  for (const node of chips) {
    if (!node.isConnected) {
      chips.delete(node);
      continue;
    }
    const rested = now - (lastMovedAt.get(node) ?? 0);
    if (rested < CHIP_REST_MS || isBusy(node)) continue;
    // A little randomness so equal rests don't always go in DOM order.
    const score = rested + Math.random() * 2_000;
    if (score > pickRest && isOnScreen(node)) {
      pick = node;
      pickRest = score;
    }
  }
  if (!pick || typeof pick.animate !== 'function') return false;
  const move = MOVES[Math.floor(Math.random() * MOVES.length)];
  lastMovedAt.set(pick, now);
  pick.animate(move.keyframes, {
    duration: move.duration,
    easing: move.easing,
  });
  return true;
};

const schedule = () => {
  if (timer !== null || chips.size === 0) return;
  const wait = TICK_MIN_MS + Math.random() * (TICK_MAX_MS - TICK_MIN_MS);
  timer = window.setTimeout(() => {
    timer = null;
    moveOneOwnReaction();
    schedule();
  }, wait);
};

/**
 * Lets the viewer's own reaction emoji `node` join the occasional moves.
 * Returns the unregister function.
 */
export const registerOwnReaction = (node: HTMLElement): (() => void) => {
  chips.add(node);
  // A chip that just showed up (the chat opened, or it scrolled into the
  // list) gets its first turn a few seconds in.
  if (!lastMovedAt.has(node)) {
    lastMovedAt.set(
      node,
      Date.now() - CHIP_REST_MS + FIRST_TURN_MIN_MS + Math.random() * 3_000
    );
  }
  schedule();
  return () => {
    chips.delete(node);
    if (chips.size === 0 && timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
};
