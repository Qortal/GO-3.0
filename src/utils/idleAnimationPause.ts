import { isCapacitor } from './platform';

/**
 * Pause looping CSS animations while the user is not touching the phone.
 *
 * Measured on-device: the Home screen's decorative loops (mascot bob/blink,
 * logo floats, status pulses, edge-light sweeps) keep the WebView producing a
 * frame every 16 ms. A *single* small `transform` loop already costs ~55 % of
 * a CPU core on the Chromium + HWUI pipeline, and with all loops off the UI
 * threads idle at ~5 %. That is the second-largest battery cost of the app
 * after the Reticulum stack, and it runs whenever the screen is on.
 *
 * After 10 s without pointer, touch, key, wheel or scroll input the
 * document gets `data-hub-ui-idle="on"`, and a global rule freezes animations
 * (`animation-play-state: paused`). Any input resumes them instantly; a
 * paused animation costs nothing, so the user only pays while actually
 * looking at and using the screen. Progress indicators and skeletons are
 * excluded so a pending action never looks stuck. Transitions are untouched.
 *
 * One-shot animations must never be frozen, though. An entrance such as the
 * dashboard's post-login fade starts at opacity 0 and, when the document is
 * already idle by the time it begins (a biometric unlock is not DOM input, so
 * the timer set on the lock screen simply runs out), the global rule would
 * hold it on its first frame and the content would never appear: that was the
 * "Home is black until touched" bug. So every finite CSS animation is allowed
 * to run to its end: when the document goes idle, and whenever one starts
 * while idle, it is resumed through the Web Animations API (`play()` takes
 * precedence over the `animation-play-state` property). Only infinite loops
 * stay frozen, and they are the only ones that cost anything.
 */
const IDLE_AFTER_MS = 10_000;
const IDLE_ATTR = 'data-hub-ui-idle';
const STYLE_ID = 'hub-ui-idle-animations';

const RESUME_EVENTS: (keyof WindowEventMap)[] = [
  'pointerdown',
  'pointermove',
  'touchstart',
  'keydown',
  'wheel',
  'scroll',
  'focus',
];

const IDLE_CSS = `
html[${IDLE_ATTR}="on"] *:not(
  .MuiCircularProgress-root, .MuiCircularProgress-root *,
  .MuiLinearProgress-root, .MuiLinearProgress-root *,
  .MuiSkeleton-root, .MuiSkeleton-root *,
  [data-hub-keep-animating], [data-hub-keep-animating] *
) {
  animation-play-state: paused !important;
}
`;

const isCssAnimation = (animation: Animation): animation is CSSAnimation =>
  'animationName' in animation;

/** A CSS animation that ends by itself, as opposed to an infinite loop. */
const isFiniteCssAnimation = (animation: Animation): boolean => {
  if (!isCssAnimation(animation)) return false;
  const iterations = animation.effect?.getTiming().iterations;
  return typeof iterations === 'number' && Number.isFinite(iterations);
};

/**
 * Let every finite CSS animation the idle rule froze run to its end. Only
 * `paused` ones are touched: `play()` on a finished animation would replay it.
 */
export function resumeFiniteAnimations(): void {
  if (typeof document.getAnimations !== 'function') return;
  for (const animation of document.getAnimations()) {
    if (animation.playState !== 'paused') continue;
    if (!isFiniteCssAnimation(animation)) continue;
    animation.play();
  }
}

let installed = false;
let noteActivity: (() => void) | null = null;

/**
 * Count something that is not DOM input as user activity, e.g. a completed
 * biometric unlock. No-op when the pause is not installed.
 */
export function noteIdlePauseActivity(): void {
  noteActivity?.();
}

export function installIdleAnimationPause(): void {
  if (installed || typeof window === 'undefined' || !isCapacitor()) return;
  installed = true;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = IDLE_CSS;
  document.head.appendChild(style);

  const root = document.documentElement;
  let timer: number | null = null;
  let idle = false;

  const setIdle = (next: boolean) => {
    if (idle === next) return;
    idle = next;
    if (next) {
      root.setAttribute(IDLE_ATTR, 'on');
      // getAnimations() flushes style, so the rule above has already paused
      // everything by the time the play states are read.
      resumeFiniteAnimations();
    } else {
      root.removeAttribute(IDLE_ATTR);
    }
  };

  // One pass per frame no matter how many entrances start together.
  let resumeQueued = false;
  const queueResume = () => {
    if (resumeQueued) return;
    resumeQueued = true;
    const run = () => {
      resumeQueued = false;
      if (idle) resumeFiniteAnimations();
    };
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(run);
    } else {
      window.setTimeout(run, 0);
    }
  };
  // Fires for an animation that begins paused too, so entrances mounted while
  // idle (post-login dashboard, toasts, network-driven UI) still play.
  document.addEventListener(
    'animationstart',
    () => {
      if (idle) queueResume();
    },
    { passive: true, capture: true }
  );

  const arm = () => {
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      // A hidden page is already frame-throttled by Chromium; only mark idle
      // when the screen is on and nobody is touching it.
      if (!document.hidden) setIdle(true);
    }, IDLE_AFTER_MS);
  };

  // pointermove/scroll fire at input rate while the user is active; re-arming
  // the timer once a second is plenty.
  let lastArmedAt = 0;
  const onActivity = () => {
    setIdle(false);
    const now = Date.now();
    if (timer != null && now - lastArmedAt < 1_000) return;
    lastArmedAt = now;
    arm();
  };
  noteActivity = onActivity;

  for (const name of RESUME_EVENTS) {
    window.addEventListener(name, onActivity, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (timer != null) window.clearTimeout(timer);
      timer = null;
    } else {
      onActivity();
    }
  });

  arm();
}
