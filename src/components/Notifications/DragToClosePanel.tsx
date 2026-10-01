import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useTransform,
  type PanInfo,
} from 'framer-motion';
import { Box, type SxProps, type Theme } from '@mui/material';
import { alpha } from '@mui/material/styles';

/** Dragged up this far, or flicked up this fast (px/s), the panel goes. */
const CLOSE_DISTANCE_PX = 70;
const CLOSE_VELOCITY = -500;
/** Finger travel before a touch counts as a swipe rather than a tap. */
const TOUCH_SLOP_PX = 8;

/** The element a touch would scroll, if it can scroll at all. */
function scrollableAncestor(
  target: EventTarget | null,
  stopAt: HTMLElement | null
): HTMLElement | null {
  let element = target instanceof HTMLElement ? target : null;
  while (element && element !== stopAt && element !== document.body) {
    const overflowY = getComputedStyle(element).overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      element.scrollHeight > element.clientHeight + 1
    ) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}

type DragToClosePanelProps = {
  /** Sits above the scrolling content; dragging it moves the panel. */
  header: ReactNode;
  children: ReactNode;
  onClose: () => void;
  sx?: SxProps<Theme>;
  handleLabel: string;
};

/**
 * A panel that drops down from the top bar and goes back up when dragged or
 * flicked upwards, following the finger and fading as it goes.
 *
 * On a touch screen the swipe can start anywhere while the panel is open, on
 * the panel or outside it. Inside a list that still has more to scroll the
 * finger scrolls it first; once the list is at its end, it moves the panel.
 * With a mouse, the header strip and the grab bar are the handles.
 */
export function DragToClosePanel({
  header,
  children,
  onClose,
  sx,
  handleLabel,
}: DragToClosePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const controls = useDragControls();
  const y = useMotionValue(0);
  const opacity = useTransform(y, [-260, 0], [0.15, 1]);
  const closingRef = useRef(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /** Let go at `offset` px moving at `velocity` px/s: close or settle back. */
  const release = (offset: number, velocity: number) => {
    if (closingRef.current) return;
    if (offset < -CLOSE_DISTANCE_PX || velocity < CLOSE_VELOCITY) {
      closingRef.current = true;
      const height = panelRef.current?.offsetHeight || 400;
      void animate(y, -(height + 48), {
        duration: 0.22,
        ease: [0.4, 0, 1, 1],
      }).then(() => onCloseRef.current());
      return;
    }
    void animate(y, 0, { type: 'spring', stiffness: 520, damping: 38 });
  };
  const releaseRef = useRef(release);
  releaseRef.current = release;

  // Touch: anywhere on screen while the panel is up.
  useEffect(() => {
    let start: { x: number; y: number; scroller: HTMLElement | null } | null =
      null;
    let mode: 'idle' | 'drag' | 'ignore' = 'idle';
    let baseDy = 0;
    let samples: Array<{ t: number; offset: number }> = [];

    const onStart = (event: TouchEvent) => {
      if (closingRef.current || event.touches.length !== 1) {
        start = null;
        return;
      }
      const touch = event.touches[0];
      const panel = panelRef.current;
      start = {
        x: touch.clientX,
        y: touch.clientY,
        scroller:
          panel && panel.contains(event.target as Node)
            ? scrollableAncestor(event.target, panel)
            : null,
      };
      mode = 'idle';
      samples = [];
    };

    const onMove = (event: TouchEvent) => {
      if (!start || mode === 'ignore' || closingRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (mode === 'idle') {
        if (Math.abs(dx) < TOUCH_SLOP_PX && Math.abs(dy) < TOUCH_SLOP_PX) {
          return;
        }
        // Sideways swipes dismiss rows; downward ones scroll the list back.
        if (Math.abs(dx) > Math.abs(dy) || dy > 0) {
          mode = 'ignore';
          return;
        }
        const scroller = start.scroller;
        if (
          scroller &&
          scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1
        ) {
          mode = 'ignore';
          return;
        }
        mode = 'drag';
        baseDy = dy;
      }
      if (event.cancelable) event.preventDefault();
      const offset = dy - baseDy;
      y.set(offset > 0 ? offset * 0.08 : offset);
      samples.push({ t: event.timeStamp, offset });
      if (samples.length > 5) samples.shift();
    };

    const onEnd = () => {
      if (mode === 'drag') {
        const first = samples[0];
        const last = samples[samples.length - 1];
        const velocity =
          first && last && last.t > first.t
            ? ((last.offset - first.offset) / (last.t - first.t)) * 1000
            : 0;
        releaseRef.current(y.get(), velocity);
      }
      start = null;
      mode = 'idle';
    };

    const options = { capture: true } as const;
    document.addEventListener('touchstart', onStart, {
      ...options,
      passive: true,
    });
    document.addEventListener('touchmove', onMove, {
      ...options,
      passive: false,
    });
    document.addEventListener('touchend', onEnd, options);
    document.addEventListener('touchcancel', onEnd, options);
    return () => {
      document.removeEventListener('touchstart', onStart, options);
      document.removeEventListener('touchmove', onMove, options);
      document.removeEventListener('touchend', onEnd, options);
      document.removeEventListener('touchcancel', onEnd, options);
    };
  }, [y]);

  // Mouse and pen: the header and the grab bar.
  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return;
    controls.start(event);
  };

  const handleDragEnd = (_event: unknown, info: PanInfo) => {
    release(info.offset.y, info.velocity.y);
  };

  const grabBar = (
    <Box
      aria-hidden
      sx={(theme) => ({
        backgroundColor: alpha(theme.palette.text.secondary, 0.35),
        borderRadius: 999,
        height: 4,
        width: 38,
      })}
    />
  );

  return (
    <motion.div
      ref={panelRef}
      drag="y"
      dragControls={controls}
      dragListener={false}
      // Free upwards (release decides: close or spring back); a downward
      // drag only gives a little and snaps back on its own.
      dragConstraints={{ top: -4000, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.08 }}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      style={{ y, opacity }}
    >
      <Box sx={sx}>
        <Box
          onPointerDown={startDrag}
          sx={{ cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
        >
          {header}
        </Box>
        {children}
        <Box
          aria-label={handleLabel}
          onPointerDown={startDrag}
          role="presentation"
          sx={{
            cursor: 'grab',
            display: 'flex',
            justifyContent: 'center',
            pb: 1,
            pt: 0.75,
            touchAction: 'none',
          }}
        >
          {grabBar}
        </Box>
      </Box>
    </motion.div>
  );
}
