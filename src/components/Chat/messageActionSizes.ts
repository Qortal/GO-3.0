/**
 * Sizes for the per-message action surfaces: the tap toolbar, the long-press
 * menu, reaction chips and the replies chip. Phones (below the `md`
 * breakpoint) get finger-sized targets; desktop keeps its compact hover sizes.
 * Every phone value is at least the desktop one, so nothing ever shrinks.
 */
export type MessageActionSizes = {
  /** Glyph size of the edit / reply / delete / emoji-picker icons. */
  toolbarIconPx: number;
  /** Quick-reaction emoji in the toolbar. */
  toolbarEmojiPx: number;
  /** Long-press menu row height. */
  menuItemMinHeightPx: number;
  menuIconPx: number;
  /** Width reserved for the icon in front of each menu label. */
  menuIconColumnPx: number;
  menuLabelPx: number;
  /** Width of the menu, shared by its quick-reaction bar and its item list. */
  menuMinWidthPx: number;
  /** Quick-reaction emoji in the long-press menu. */
  menuQuickReactionEmojiPx: number;
  reactionChipHeightPx: number;
  reactionChipMinWidthPx: number;
  reactionChipPaddingXPx: number;
  reactionChipEmojiPx: number;
  reactionChipCountPx: number;
  /** Gap between chips in the reactions row (both axes, the row wraps). */
  reactionRowGapPx: number;
  /** Height of the "N replies" discussion chip. */
  discussionChipHeightPx: number;
  discussionChipFontPx: number;
};

export const DESKTOP_MESSAGE_ACTION_SIZES: MessageActionSizes = {
  toolbarIconPx: 18,
  toolbarEmojiPx: 18,
  menuItemMinHeightPx: 36,
  menuIconPx: 20,
  menuIconColumnPx: 36,
  menuLabelPx: 14,
  menuMinWidthPx: 212,
  menuQuickReactionEmojiPx: 20,
  reactionChipHeightPx: 28,
  reactionChipMinWidthPx: 44,
  reactionChipPaddingXPx: 10,
  reactionChipEmojiPx: 14,
  reactionChipCountPx: 12,
  reactionRowGapPx: 4,
  discussionChipHeightPx: 24,
  discussionChipFontPx: 10,
};

export const PHONE_MESSAGE_ACTION_SIZES: MessageActionSizes = {
  toolbarIconPx: 22,
  toolbarEmojiPx: 22,
  menuItemMinHeightPx: 44,
  menuIconPx: 22,
  menuIconColumnPx: 38,
  menuLabelPx: 15,
  menuMinWidthPx: 232,
  menuQuickReactionEmojiPx: 24,
  reactionChipHeightPx: 36,
  reactionChipMinWidthPx: 48,
  reactionChipPaddingXPx: 12,
  reactionChipEmojiPx: 18,
  reactionChipCountPx: 13,
  reactionRowGapPx: 6,
  discussionChipHeightPx: 36,
  discussionChipFontPx: 13,
};

export const getMessageActionSizes = (isPhone: boolean): MessageActionSizes =>
  isPhone ? PHONE_MESSAGE_ACTION_SIZES : DESKTOP_MESSAGE_ACTION_SIZES;

/** Square size of each quick reaction in the phone long-press menu. */
export const PHONE_MENU_QUICK_REACTION_PX = 44;

/** Preferred and minimum square size of a phone toolbar button. */
export const PHONE_TOOLBAR_BUTTON_MAX_PX = 44;
export const PHONE_TOOLBAR_BUTTON_MIN_PX = 40;

/** Phone toolbar chrome: 2px padding and 1px border per side. */
export const PHONE_TOOLBAR_PADDING_PX = 2;
export const PHONE_TOOLBAR_BORDER_PX = 1;
/** Gap between the reactions group and the edit / reply / delete group. */
export const PHONE_TOOLBAR_GROUP_GAP_PX = 4;
const PHONE_TOOLBAR_CHROME_PX =
  2 * (PHONE_TOOLBAR_PADDING_PX + PHONE_TOOLBAR_BORDER_PX) +
  PHONE_TOOLBAR_GROUP_GAP_PX;

/** Side padding of a Q-Chat message row (MessageItem). */
export const MESSAGE_ROW_PADDING_X_PX = 14;

/**
 * The message column on the narrowest phone we design for: a 360px screen
 * minus the message row's side padding.
 */
export const PHONE_MESSAGE_COLUMN_PX = 360 - 2 * MESSAGE_ROW_PADDING_X_PX;

/** Width of the message column on a full-width phone chat. */
export const getPhoneMessageColumnWidth = (viewportWidthPx: number): number =>
  Number.isFinite(viewportWidthPx) && viewportWidthPx > 0
    ? viewportWidthPx - 2 * MESSAGE_ROW_PADDING_X_PX
    : PHONE_MESSAGE_COLUMN_PX;

/**
 * Width of the message column inside a measured message row. The row is the
 * real host (full-screen chat, a sidebar layout, a mini thread), so it beats
 * the viewport guess; an unmeasured row (0, e.g. before layout) falls back to
 * the full-width phone column.
 */
export const getMessageColumnWidthFromRow = (
  rowClientWidthPx: number | null | undefined,
  viewportWidthPx: number
): number => {
  const fromRow =
    typeof rowClientWidthPx === 'number' && Number.isFinite(rowClientWidthPx)
      ? rowClientWidthPx - 2 * MESSAGE_ROW_PADDING_X_PX
      : 0;
  return fromRow > 0 ? fromRow : getPhoneMessageColumnWidth(viewportWidthPx);
};

/**
 * Largest button size (44px down to 40px) that keeps the whole tap toolbar on
 * one line of the message column. Four quick reactions, the emoji picker and
 * reply are always there; edit and delete only on your own messages, so on a
 * 360px phone only the full eight-button bar drops to 40px. Narrower than
 * that, the bar wraps between its two groups instead of shrinking further.
 */
export const getPhoneToolbarButtonSize = (
  buttonCount: number,
  columnWidthPx: number = PHONE_MESSAGE_COLUMN_PX
): number => {
  if (!Number.isFinite(buttonCount) || buttonCount <= 0) {
    return PHONE_TOOLBAR_BUTTON_MAX_PX;
  }
  const fit = Math.floor(
    (columnWidthPx - PHONE_TOOLBAR_CHROME_PX) / buttonCount
  );
  return Math.max(
    PHONE_TOOLBAR_BUTTON_MIN_PX,
    Math.min(PHONE_TOOLBAR_BUTTON_MAX_PX, fit)
  );
};

/** Outer width of the phone toolbar when it sits on one line. */
export const getPhoneToolbarWidth = (
  buttonCount: number,
  buttonSizePx: number
): number => buttonCount * buttonSizePx + PHONE_TOOLBAR_CHROME_PX;

/**
 * Emoji glyph size in the phone emoji picker (emoji-picker-react's
 * `--epr-emoji-size`): 26px glyphs make 36px cells instead of the
 * stylesheet's 28px. Shared so every phone picker uses the same cells.
 */
export const PHONE_EMOJI_PICKER_EMOJI_PX = 26;

/** Minimum height of the buttons inside a message on phones (file offers). */
export const PHONE_MESSAGE_BUTTON_MIN_HEIGHT_PX = 44;

/**
 * Minimum height of the image download "Try again" pill on phones. 40px, not
 * 44px: the pill sits in a placeholder that can be as short as 96px.
 */
export const PHONE_RETRY_PILL_MIN_HEIGHT_PX = 40;

/** Drawn size of the sender avatar in the phone message header. */
export const PHONE_MESSAGE_AVATAR_PX = 30;

/**
 * Invisible slop around the phone sender avatar that makes it a 44px target:
 * 7px each side, 9px up into the row's top padding, only 5px down so the
 * message text under the header keeps its taps.
 */
export const PHONE_AVATAR_HIT_SLOP_X_PX = 7;
export const PHONE_AVATAR_HIT_SLOP_TOP_PX = 9;
export const PHONE_AVATAR_HIT_SLOP_BOTTOM_PX = 5;
