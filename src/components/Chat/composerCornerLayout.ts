/**
 * Geometry of the phone chat composer's corner layout: the controls sit in the
 * corners of the typing box and close ranks as the message grows, over three
 * stages (chat.css, "Composer chrome rails"):
 *
 *   inline    1 line   + 😊 Aa along the row, expiry (and X) beside send
 *   squeezed  2 lines  + over 😊 with Aa beside them, expiry over send
 *   stacked   3+ lines single file down both edges
 *
 * Every size, offset, text indent and stage height the stylesheet and the
 * stage logic in TipTap.tsx share is derived here from the two button sizes.
 * TipTap hands them to the stylesheet as CSS custom properties
 * (COMPOSER_CORNER_CSS_VARS), so growing a button cannot leave an offset or a
 * floor behind. Only the container query in chat.css cannot read a custom
 * property: it repeats COMPOSER_FOUR_SLOT_PX as a literal, and a test keeps
 * the two equal.
 *
 * Positions are measured from the composer row's edges. Neighbouring buttons
 * touch: the glyphs sit well inside their boxes, so they still read as
 * separate, and every pixel between them would come out of the text.
 */

/** Attach, emoji/keyboard, Aa, expand, expiry and discard. */
export const COMPOSER_CORNER_BUTTON_PX = 40;
/** Send stays a touch bigger than the rest: it is the one to press. */
export const COMPOSER_SEND_BUTTON_PX = COMPOSER_CORNER_BUTTON_PX + 2;

export const COMPOSER_CORNER_ICON_PX = 24;
export const COMPOSER_SEND_ICON_PX = 22;
/** The X stays a little quieter than the controls around it. */
export const COMPOSER_DISCARD_ICON_PX = 22;
export const COMPOSER_EXPAND_ICON_PX = 20;
export const COMPOSER_FORMAT_LABEL_PX = 15;
export const COMPOSER_EXPIRY_LABEL_PX = 12;

/** Reply cancel, attachment remove, edit cancel and notice dismiss buttons
 *  on phones: the controls stacked above the typing box. */
export const COMPOSER_DISMISS_BUTTON_PX = 40;
export const COMPOSER_DISMISS_ICON_PX = 22;

/** Room between a column of buttons and the top or bottom of the box. */
const EDGE_INSET_PX = 1;
/** The editor box's own side padding. It never changes, so the focused
 *  contenteditable is never resized; only the paragraph indent moves. */
export const COMPOSER_EDITOR_SIDE_PAD_PX = 36;
/** ProseMirror's horizontal padding on phones (chat.css, max-width: 900px). */
const TEXT_SIDE_PAD_PX = 12;
/** Least room between a button's box and the text beside it. The glyph sits
 *  well inside the box, so the gap that shows is wider. */
const TEXT_CLEARANCE_PX = 6;

const B = COMPOSER_CORNER_BUTTON_PX;
const S = COMPOSER_SEND_BUTTON_PX;

/** Where unindented text starts, measured from the row's edge. */
export const COMPOSER_EDGE_GUTTER_PX =
  COMPOSER_EDITOR_SIDE_PAD_PX + TEXT_SIDE_PAD_PX;

/** Paragraph indent that keeps the text clear of buttons reaching
 *  `extentPx` in from the row's edge. */
export const composerTextIndent = (extentPx: number): number =>
  Math.max(0, extentPx + TEXT_CLEARANCE_PX - COMPOSER_EDGE_GUTTER_PX);

/** Paragraph indents per stage, on top of COMPOSER_EDGE_GUTTER_PX. */
export const COMPOSER_TEXT_INDENT = {
  /** + 😊 Aa in a row. */
  inlineStart: composerTextIndent(3 * B),
  /** Aa beside the + / 😊 column. */
  squeezedStart: composerTextIndent(2 * B),
  /** One column of buttons, nothing beside it. */
  stackedStart: composerTextIndent(B),
  /** Expiry, or the X in a direct message, beside send. */
  inlineEnd: composerTextIndent(S + B),
  /** A group's X and expiry, both beside send. */
  inlineEndDisplaced: composerTextIndent(S + 2 * B),
  /** Send's column on its own. */
  squeezedEnd: composerTextIndent(S),
  /** The X waiting one column in, beside send's column. */
  innerEnd: composerTextIndent(S + B),
} as const;

/** Width the text loses to the chrome on one line and on two. */
export const COMPOSER_INLINE_TEXT_GUTTERS =
  2 * COMPOSER_EDGE_GUTTER_PX +
  COMPOSER_TEXT_INDENT.inlineStart +
  COMPOSER_TEXT_INDENT.inlineEnd;
export const COMPOSER_SQUEEZED_TEXT_GUTTERS =
  2 * COMPOSER_EDGE_GUTTER_PX +
  COMPOSER_TEXT_INDENT.squeezedStart +
  COMPOSER_TEXT_INDENT.squeezedEnd;

/** Extra width a group's right edge takes while the discard button shows:
 *  on one line the expiry moves a slot inwards for the X, on two the X waits
 *  one column in. */
export const COMPOSER_DISPLACED_GUTTER = {
  inline:
    COMPOSER_TEXT_INDENT.inlineEndDisplaced - COMPOSER_TEXT_INDENT.inlineEnd,
  squeezed: COMPOSER_TEXT_INDENT.innerEnd - COMPOSER_TEXT_INDENT.squeezedEnd,
} as const;

/** Vertical centres of the slots, measured from the top or bottom edge. */
export const COMPOSER_SLOT = {
  /** A button in the slot against the top (or bottom) edge. */
  first: EDGE_INSET_PX + B / 2,
  /** Send against the bottom edge. */
  send: EDGE_INSET_PX + S / 2,
  /** A button sitting on top of send. */
  overSend: EDGE_INSET_PX + S + B / 2,
  /** A button on top of that one: four down the right edge. */
  fourth: EDGE_INSET_PX + S + B + B / 2,
  /** Puts a button on send's (wider) column. */
  columnInset: (S - B) / 2,
  /** Centres a button in the room between the top slot and send. */
  middleShift: (S - B) / 2,
} as const;

/** Shortest the typing box can be at each stage: one row of controls, then
 *  two and three down each edge. */
export const COMPOSER_STAGE_FLOOR = {
  inline: S + 2 * EDGE_INSET_PX,
  squeezed: Math.max(2 * B, B + S) + 2 * EDGE_INSET_PX,
  stacked: Math.max(3 * B, 2 * B + S) + 2 * EDGE_INSET_PX,
} as const;

/** Height stage 3 needs for four buttons down the right edge (expand,
 *  expiry, discard, send). Mirrored by the composer-rail container query. */
export const COMPOSER_FOUR_SLOT_PX = 3 * B + S + 2 * EDGE_INSET_PX;

/** Tallest the corner composer grows before the text scrolls: never less
 *  than it used to be (160px), and always tall enough for four buttons down
 *  the edge with a little to spare, so the container query is never decided
 *  by a rounding error. */
export const COMPOSER_STAGE_THREE_MAX_PX = Math.max(
  160,
  COMPOSER_FOUR_SLOT_PX + 4
);

const px = (value: number) => `${value}px`;

/** Custom properties chat.css reads for the corner layout. */
export const COMPOSER_CORNER_CSS_VARS = {
  '--composer-button': px(B),
  '--composer-send': px(S),
  '--composer-editor-pad': px(COMPOSER_EDITOR_SIDE_PAD_PX),
  '--composer-slot-first': px(COMPOSER_SLOT.first),
  '--composer-slot-send': px(COMPOSER_SLOT.send),
  '--composer-slot-over-send': px(COMPOSER_SLOT.overSend),
  '--composer-slot-fourth': px(COMPOSER_SLOT.fourth),
  '--composer-column-inset': px(COMPOSER_SLOT.columnInset),
  '--composer-slot-middle-shift': px(COMPOSER_SLOT.middleShift),
  '--composer-indent-inline-start': px(COMPOSER_TEXT_INDENT.inlineStart),
  '--composer-indent-squeezed-start': px(COMPOSER_TEXT_INDENT.squeezedStart),
  '--composer-indent-inline-end': px(COMPOSER_TEXT_INDENT.inlineEnd),
  '--composer-indent-inline-end-displaced': px(
    COMPOSER_TEXT_INDENT.inlineEndDisplaced
  ),
  '--composer-indent-inner-end': px(COMPOSER_TEXT_INDENT.innerEnd),
  '--composer-stage-1-floor': px(COMPOSER_STAGE_FLOOR.inline),
  '--composer-stage-2-floor': px(COMPOSER_STAGE_FLOOR.squeezed),
  '--composer-stage-3-floor': px(COMPOSER_STAGE_FLOOR.stacked),
  '--composer-stage-3-max': px(COMPOSER_STAGE_THREE_MAX_PX),
} as const;
