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

let installed = false;

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
    if (next) root.setAttribute(IDLE_ATTR, 'on');
    else root.removeAttribute(IDLE_ATTR);
  };

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
