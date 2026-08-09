import { useCallback, useEffect, useRef } from 'react';

type LongPressPoint = { clientX: number; clientY: number };

type UseLongPressOptions = {
  /** Hold duration before the press counts as "long". */
  delay?: number;
  /** Finger travel in px that cancels the press (so scrolling stays scrolling). */
  moveTolerance?: number;
  enabled?: boolean;
  /** Set on nested targets so an outer long-press doesn't arm at the same time. */
  stopPropagation?: boolean;
};

type LongPressHandlers = {
  onTouchStart: (event: React.TouchEvent) => void;
  onTouchMove: (event: React.TouchEvent) => void;
  onTouchEnd: (event: React.TouchEvent) => void;
  onTouchCancel: (event: React.TouchEvent) => void;
  onClickCapture: (event: React.MouseEvent) => void;
};

/**
 * Touch equivalent of right-click. Desktop keeps its `onContextMenu`; phones
 * get the same menu by holding, with the follow-up synthetic click swallowed
 * so the row underneath doesn't also activate.
 */
export function useLongPress(
  onLongPress: (point: LongPressPoint) => void,
  {
    delay = 450,
    moveTolerance = 10,
    enabled = true,
    stopPropagation = false,
  }: UseLongPressOptions = {}
): LongPressHandlers {
  const timer = useRef<number | null>(null);
  const origin = useRef<LongPressPoint | null>(null);
  const fired = useRef(false);
  const callbackRef = useRef(onLongPress);
  callbackRef.current = onLongPress;

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const onTouchStart = useCallback(
    (event: React.TouchEvent) => {
      if (!enabled) return;
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1) return;
      if (stopPropagation) event.stopPropagation();
      origin.current = { clientX: touch.clientX, clientY: touch.clientY };
      fired.current = false;
      clear();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        if (origin.current) callbackRef.current(origin.current);
      }, delay);
    },
    [clear, delay, enabled, stopPropagation]
  );

  const onTouchMove = useCallback(
    (event: React.TouchEvent) => {
      if (timer.current === null) return;
      const touch = event.touches[0];
      const start = origin.current;
      if (!touch || !start) return;
      if (
        Math.abs(touch.clientX - start.clientX) > moveTolerance ||
        Math.abs(touch.clientY - start.clientY) > moveTolerance
      ) {
        clear();
      }
    },
    [clear, moveTolerance]
  );

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      clear();
      origin.current = null;
      if (fired.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [clear]
  );

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (!fired.current) return;
    fired.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: onTouchEnd,
    onClickCapture,
  };
}
