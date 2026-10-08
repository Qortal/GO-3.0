/**
 * Turns scroll deltas into "hide the bars" / "show the bars", the way browsers
 * do it: a run of scrolling one way has to add up to a few finger-widths
 * before anything happens, and turning round starts the count again, so
 * jitter and tiny corrections never flap the bars.
 */
export type ImmersiveScrollSignal = 'hide' | 'show';

export type ScrollDirectionOptions = {
  /** Content moved up (You scrolled down) by this much: hide. */
  hideAfterPx?: number;
  /** Content moved down (You scrolled up) by this much: show. */
  showAfterPx?: number;
};

export const IMMERSIVE_HIDE_AFTER_PX = 32;
export const IMMERSIVE_SHOW_AFTER_PX = 24;

export type ScrollDirectionTracker = {
  /** delta > 0 = scrolled down (content moved up). */
  push: (delta: number) => ImmersiveScrollSignal | null;
  reset: () => void;
};

export const createScrollDirectionTracker = ({
  hideAfterPx = IMMERSIVE_HIDE_AFTER_PX,
  showAfterPx = IMMERSIVE_SHOW_AFTER_PX,
}: ScrollDirectionOptions = {}): ScrollDirectionTracker => {
  let run = 0;
  let fired: ImmersiveScrollSignal | null = null;

  return {
    push(delta) {
      if (!Number.isFinite(delta) || delta === 0) return null;
      // A turn starts a new run (and allows a new signal).
      if ((run > 0 && delta < 0) || (run < 0 && delta > 0)) {
        run = 0;
        fired = null;
      }
      run += delta;
      if (run >= hideAfterPx && fired !== 'hide') {
        fired = 'hide';
        return 'hide';
      }
      if (run <= -showAfterPx && fired !== 'show') {
        fired = 'show';
        return 'show';
      }
      return null;
    },
    reset() {
      run = 0;
      fired = null;
    },
  };
};

/**
 * Native finger direction (Q-Apps and websites run in frames GO cannot see
 * scroll in): finger up = content scrolls down = hide.
 */
export const signalForFingerDirection = (
  direction: unknown
): ImmersiveScrollSignal | null =>
  direction === 'up' ? 'hide' : direction === 'down' ? 'show' : null;
