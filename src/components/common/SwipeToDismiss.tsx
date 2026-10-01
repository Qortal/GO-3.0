import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from 'framer-motion';
import { useRef, type ReactNode } from 'react';

/** Past this share of the row width a slow drag still dismisses on release. */
const DISMISS_DISTANCE_RATIO = 0.35;
/** A flick this fast (px/s) dismisses even when the row moved only a little. */
const DISMISS_FLICK_VELOCITY = 600;
const DISMISS_FLICK_MIN_PX = 40;
/** Horizontal travel that turns the gesture into a swipe instead of a tap. */
const SWIPE_SUPPRESSES_CLICK_PX = 8;
const FALLBACK_ROW_WIDTH_PX = 320;

type SwipeToDismissProps = {
  children: ReactNode;
  /** Flex gap above the row, folded away together with the row. */
  gapPx?: number;
  onDismiss: () => void;
};

/**
 * Wraps a list row so a sideways swipe (touch or mouse) removes it, like a
 * notification in the Android tray. Vertical drags still scroll the list, and
 * Delete or Backspace dismisses the focused row from the keyboard. Render it
 * inside an AnimatePresence so the row folds shut once it is removed.
 */
export const SwipeToDismiss = ({
  children,
  gapPx = 0,
  onDismiss,
}: SwipeToDismissProps) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const swipedRef = useRef(false);
  const dismissingRef = useRef(false);
  const x = useMotionValue(0);
  const opacity = useTransform(x, (value) => {
    const width = rowRef.current?.offsetWidth || FALLBACK_ROW_WIDTH_PX;
    return Math.max(0.2, 1 - Math.abs(value) / width);
  });

  const dismiss = (direction: 1 | -1) => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    const width = rowRef.current?.offsetWidth || FALLBACK_ROW_WIDTH_PX;
    void animate(x, direction * (width + 24), {
      duration: 0.16,
      ease: 'easeOut',
    }).then(onDismiss);
  };

  const handleDragEnd = (_event: PointerEvent, info: PanInfo) => {
    const width = rowRef.current?.offsetWidth || FALLBACK_ROW_WIDTH_PX;
    const offsetX = info.offset.x;
    const velocityX = info.velocity.x;
    const draggedFarEnough = Math.abs(offsetX) > width * DISMISS_DISTANCE_RATIO;
    const flicked =
      Math.abs(velocityX) > DISMISS_FLICK_VELOCITY &&
      Math.abs(offsetX) > DISMISS_FLICK_MIN_PX &&
      Math.sign(velocityX) === Math.sign(offsetX);
    if (draggedFarEnough || flicked) {
      dismiss(offsetX < 0 ? -1 : 1);
      return;
    }
    void animate(x, 0, { type: 'spring', stiffness: 520, damping: 38 });
  };

  return (
    <motion.div
      exit={{ height: 0, marginTop: -gapPx, opacity: 0 }}
      style={{ flexShrink: 0, overflow: 'hidden' }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <motion.div
        ref={rowRef}
        drag="x"
        dragDirectionLock
        dragMomentum={false}
        onClickCapture={(event) => {
          // Releasing a swipe must not also open the row.
          if (!swipedRef.current && !dismissingRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          swipedRef.current = false;
        }}
        onDrag={(_event, info) => {
          if (Math.abs(info.offset.x) > SWIPE_SUPPRESSES_CLICK_PX) {
            swipedRef.current = true;
          }
        }}
        onDragEnd={handleDragEnd}
        onKeyDown={(event) => {
          if (event.key !== 'Delete' && event.key !== 'Backspace') return;
          event.preventDefault();
          dismiss(1);
        }}
        onPointerDownCapture={() => {
          swipedRef.current = false;
        }}
        style={{ opacity, x }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
};
