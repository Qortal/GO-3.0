/**
 * Qortino looking around now and then: his eyes glance somewhere for a
 * moment and come back. Only while he is on screen and the phone is in use
 * (nothing moves once GO's idle pause sets in), so it costs nothing at rest.
 */
import { useEffect, useState } from 'react';

export type QortinoGaze = { x: number; y: number };

export const CENTER_GAZE: QortinoGaze = { x: 0, y: 0 };

const GLANCES: readonly QortinoGaze[] = [
  { x: -4, y: 0 },
  { x: 4, y: 0 },
  { x: -3, y: -2 },
  { x: 3, y: -2 },
  { x: 0, y: -3 },
  { x: 2, y: 1.5 },
];

const isUiIdle = () =>
  document.documentElement.getAttribute('data-hub-ui-idle') === 'on';

export function useQortinoGlances(active: boolean): QortinoGaze {
  const [gaze, setGaze] = useState<QortinoGaze>(CENTER_GAZE);

  useEffect(() => {
    if (!active) {
      setGaze(CENTER_GAZE);
      return;
    }
    let timer: number | null = null;
    const look = () => {
      if (isUiIdle()) {
        timer = window.setTimeout(look, 4_000);
        return;
      }
      setGaze(GLANCES[Math.floor(Math.random() * GLANCES.length)]);
      timer = window.setTimeout(
        () => {
          setGaze(CENTER_GAZE);
          timer = window.setTimeout(look, 5_000 + Math.random() * 8_000);
        },
        900 + Math.random() * 800
      );
    };
    timer = window.setTimeout(look, 3_000 + Math.random() * 5_000);
    return () => {
      if (timer != null) window.clearTimeout(timer);
    };
  }, [active]);

  return gaze;
}
