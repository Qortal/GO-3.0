/**
 * Geometry of the phone message popup (MessageActionsPopup): a reaction pill
 * above a menu card, opened where the message was touched, the way Telegram
 * does it. Pure functions so the placement rules are testable without layout.
 */

/** Space kept between the popup and the screen edges. */
export const POPUP_EDGE_MARGIN_PX = 8;
/** Gap between the pill, the menu card and the details card. */
export const POPUP_GAP_PX = 8;

/** Square tap target of each quick reaction in the pill. */
export const PILL_CELL_PX = 44;
/** The expand (chevron) button's slot at the end of the pill. */
export const PILL_EXPAND_SLOT_PX = 44;
export const PILL_PADDING_X_PX = 4;
export const PILL_HEIGHT_PX = 52;
const MIN_QUICK_REACTIONS = 3;

export const MENU_CARD_WIDTH_PX = 236;

/** The emoji grid the pill grows into. */
export const EXPANDED_MAX_HEIGHT_PX = 400;
export const EXPANDED_GRID_PADDING_X_PX = 6;
const EXPANDED_MIN_CELL_PX = 40;
const EXPANDED_MAX_COLUMNS = 9;

/**
 * How far the pill and the menu reach past the finger toward the message's
 * side, so the corner nearest the touch sits just beyond it.
 */
const ANCHOR_OVERHANG_PX = 28;
/** The pill floats this far above the finger, clear of the thumb. */
const PILL_LIFT_PX = 14;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/** Quick reactions that fit beside the expand button on this screen. */
export const getQuickReactionCount = (
  viewportWidthPx: number,
  available: number
): number => {
  const width = Number.isFinite(viewportWidthPx) ? viewportWidthPx : 360;
  const room =
    width -
    2 * POPUP_EDGE_MARGIN_PX -
    2 * PILL_PADDING_X_PX -
    PILL_EXPAND_SLOT_PX;
  const fit = Math.floor(room / PILL_CELL_PX);
  return Math.max(0, Math.min(available, Math.max(MIN_QUICK_REACTIONS, fit)));
};

export const getPillWidth = (quickReactionCount: number): number =>
  2 * PILL_PADDING_X_PX +
  quickReactionCount * PILL_CELL_PX +
  PILL_EXPAND_SLOT_PX;

/** Columns of the expanded grid inside a panel `widthPx` wide. */
export const getExpandedGridColumns = (widthPx: number): number =>
  Math.max(
    5,
    Math.min(
      EXPANDED_MAX_COLUMNS,
      Math.floor(
        (widthPx - 2 * EXPANDED_GRID_PADDING_X_PX) / EXPANDED_MIN_CELL_PX
      )
    )
  );

type MessageActionsPopupLayoutInput = {
  anchorX: number;
  anchorY: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Status bar and gesture bar the popup must stay clear of. */
  topInset?: number;
  bottomInset?: number;
  /** 0 when the popup has no pill (no reactions here). */
  pillWidth: number;
  /** Menu card plus details card, as measured. */
  bodyWidth: number;
  bodyHeight: number;
  /** Own messages sit on the right, so the popup grows leftward. */
  alignEnd?: boolean;
};

type MessageActionsPopupLayout = {
  pill: { left: number; top: number; width: number; height: number };
  body: { left: number; top: number; maxHeight: number };
  expanded: { left: number; top: number; width: number; height: number };
};

export const layoutMessageActionsPopup = ({
  anchorX,
  anchorY,
  viewportWidth,
  viewportHeight,
  topInset = 0,
  bottomInset = 0,
  pillWidth,
  bodyWidth,
  bodyHeight,
  alignEnd = false,
}: MessageActionsPopupLayoutInput): MessageActionsPopupLayout => {
  const minTop = topInset + POPUP_EDGE_MARGIN_PX;
  const maxBottom = viewportHeight - bottomInset - POPUP_EDGE_MARGIN_PX;
  const hasPill = pillWidth > 0;
  const pillBlock = hasPill ? PILL_HEIGHT_PX + POPUP_GAP_PX : 0;

  const placeX = (width: number) => {
    const preferred = alignEnd
      ? anchorX + ANCHOR_OVERHANG_PX - width
      : anchorX - ANCHOR_OVERHANG_PX;
    return clamp(
      preferred,
      POPUP_EDGE_MARGIN_PX,
      viewportWidth - POPUP_EDGE_MARGIN_PX - width
    );
  };

  // The pill sits just above the finger and the menu hangs below it; the
  // whole column slides up or down to stay on screen, and a menu taller
  // than the screen scrolls.
  const total = pillBlock + bodyHeight;
  const preferredTop = hasPill
    ? anchorY - PILL_HEIGHT_PX - PILL_LIFT_PX
    : anchorY - PILL_LIFT_PX;
  const top = clamp(preferredTop, minTop, maxBottom - total);
  const bodyTop = top + pillBlock;

  const pill = {
    left: hasPill ? placeX(pillWidth) : 0,
    top,
    width: pillWidth,
    height: PILL_HEIGHT_PX,
  };

  // The grid keeps the pill's width and grows down from it, moving up when
  // the screen below runs out.
  const expandedHeight = Math.max(
    PILL_HEIGHT_PX,
    Math.min(EXPANDED_MAX_HEIGHT_PX, maxBottom - minTop)
  );
  const expanded = {
    left: pill.left,
    top: clamp(top, minTop, maxBottom - expandedHeight),
    width: pillWidth,
    height: expandedHeight,
  };

  return {
    pill,
    body: {
      left: placeX(bodyWidth),
      top: bodyTop,
      maxHeight: Math.max(PILL_HEIGHT_PX, maxBottom - bodyTop),
    },
    expanded,
  };
};
