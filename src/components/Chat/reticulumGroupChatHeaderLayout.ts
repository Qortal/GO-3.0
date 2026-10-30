/**
 * The phone group-chat header: the back arrow, the group/channel opener
 * (group name over "# channel"), then the call, search and overflow buttons.
 *
 * Every button is a 44px touch target. The back arrow and the trailing
 * buttons reach into the header's side padding: their hit areas stay whole
 * and only empty edge space is shared, so the channel name keeps about the
 * width it had next to the old, smaller buttons.
 */
export const RETICULUM_PHONE_CHAT_HEADER = {
  actionSize: 44,
  /** How far the trailing buttons reach into the right padding. */
  actionsBleed: 8,
  /** Space between the trailing buttons (their icons have room around them). */
  actionsGap: 0,
  avatarSize: 36,
  /** How far the back button reaches into the left padding. */
  backBleed: 12,
  channelChevronSize: 16,
  channelFontSize: 14,
  channelIconSize: 16,
  channelLineGap: 2,
  groupNameFontSize: 15,
  iconSize: 23,
  /** The header's gap between its items (MUI gap 0.75). */
  itemGap: 6,
  openerGap: 6,
  openerPaddingX: 2,
  /** The opener pulls left into the gap after the back button. */
  openerPullLeft: 4,
  /** The header's side padding (MUI px 1.5). */
  paddingX: 12,
} as const;

/** Buttons right of the opener on phones: call, search and "more". */
const RETICULUM_PHONE_CHAT_HEADER_TRAILING_ACTIONS = 3;

/**
 * Widths inside the opener on a phone `viewportWidth` wide, for checking that
 * the group and channel names stay readable.
 */
export function reticulumPhoneChatHeaderWidths(
  viewportWidth: number,
  trailingActions = RETICULUM_PHONE_CHAT_HEADER_TRAILING_ACTIONS
) {
  const h = RETICULUM_PHONE_CHAT_HEADER;
  const back = h.actionSize - h.backBleed;
  const actions =
    trailingActions * h.actionSize +
    Math.max(0, trailingActions - 1) * h.actionsGap -
    h.actionsBleed;
  const opener =
    viewportWidth -
    2 * h.paddingX -
    back -
    h.itemGap +
    h.openerPullLeft -
    h.itemGap -
    actions;
  const groupName = opener - 2 * h.openerPaddingX - h.avatarSize - h.openerGap;
  const channelName =
    groupName - h.channelIconSize - h.channelChevronSize - 2 * h.channelLineGap;
  return { channelName, groupName, opener };
}
