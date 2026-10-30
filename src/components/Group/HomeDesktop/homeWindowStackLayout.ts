/**
 * The stack of strips Home's windows fold into while one is dragged (see
 * HomeWindowStack): where it sits and where the held strip would land.
 */

export const STRIP_HEIGHT_PX = 56;
const STRIP_MIN_HEIGHT_PX = 38;
export const STRIP_GAP_PX = 8;

export const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

type CompactStackLayout = {
  tileHeight: number;
  pitch: number;
  stackTop: number;
};

/**
 * Strips as tall as fit (up to STRIP_HEIGHT_PX), the stack placed so the
 * held window's strip is under the finger, as far as the room allows.
 */
export const compactStackLayout = ({
  count,
  heldIndex,
  fingerY,
  minTop,
  maxBottom,
}: {
  count: number;
  heldIndex: number;
  fingerY: number;
  minTop: number;
  maxBottom: number;
}): CompactStackLayout => {
  const room = Math.max(0, maxBottom - minTop);
  const gaps = Math.max(0, count - 1) * STRIP_GAP_PX;
  const tileHeight =
    count * STRIP_HEIGHT_PX + gaps <= room
      ? STRIP_HEIGHT_PX
      : Math.max(
          STRIP_MIN_HEIGHT_PX,
          Math.floor((room - gaps) / Math.max(1, count))
        );
  const pitch = tileHeight + STRIP_GAP_PX;
  const stackHeight = count * tileHeight + gaps;
  const ideal = fingerY - tileHeight / 2 - heldIndex * pitch;
  return {
    tileHeight,
    pitch,
    stackTop: clampNumber(ideal, minTop, maxBottom - stackHeight),
  };
};

/** The slot nearest the held strip's top. */
export const heldTargetIndex = (
  heldTop: number,
  stackTop: number,
  pitch: number,
  count: number
) =>
  clampNumber(
    Math.round((heldTop - stackTop) / Math.max(1, pitch)),
    0,
    count - 1
  );

/** The order with the held window moved to `target`. */
export const arrangeWithHeld = <T>(
  ids: readonly T[],
  held: T,
  target: number
) => {
  const others = ids.filter((id) => id !== held);
  others.splice(clampNumber(target, 0, others.length), 0, held);
  return others;
};
