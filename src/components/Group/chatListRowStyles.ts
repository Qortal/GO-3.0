import type { Theme } from '@mui/material/styles';
import { getFallbackAvatarOutlineSx } from '../Chat/clickableAvatarStyles';

/**
 * One look for the Q-Chat lists: the Groups list and the DM list use these
 * styles, so the two cannot drift apart again. The phone Groups list is the
 * reference; the narrow desktop Reticulum DM column keeps its own compact
 * rows.
 */

/** Smallest comfortable touch target for a list control on phones. */
export const CHAT_LIST_TOUCH_TARGET = 44;
/** Icon size inside a CHAT_LIST_TOUCH_TARGET button. */
export const CHAT_LIST_ICON_SIZE = 22;
/**
 * Height of a Groups / DMs switch segment: the whole segment is the touch
 * target, and its pill is drawn 2px inside it.
 */
export const CHAT_SCOPE_SEGMENT_HEIGHT = CHAT_LIST_TOUCH_TARGET;
/** Inset of the switch's active pill inside its segment. */
export const CHAT_SCOPE_PILL_INSET = 2;
export const CHAT_LIST_AVATAR_SIZE = 40;
/** Width of the avatar column: a little wider than the avatar for badges. */
export const CHAT_LIST_AVATAR_SLOT = 44;
/** Horizontal padding of a row; row actions reach into it (see below). */
export const CHAT_LIST_ROW_PADDING_X = 14;
/** Space between the avatar, the text and the trailing column of a row. */
export const CHAT_LIST_ROW_GAP = 20;

export const getChatListPanelSx = (theme: Theme) => ({
  background: theme.palette.background.default,
});

/** Container name of the list header, for width-dependent header parts. */
export const CHAT_LIST_HEADER_CONTAINER = 'chat-list-header';
/**
 * Below this header content width (the header minus its 12px side padding)
 * the Groups / DMs switch segments tighten their side padding, so both labels
 * and three 44px buttons still fit: the switch needs about 135px, plus the
 * 8px gap and 132px of buttons. Only the list swiped in over an open chat
 * (86% of the screen) on a phone narrower than about 350px gets there.
 */
export const CHAT_LIST_HEADER_NARROW_PX = 280;

/** The bar holding the Groups / DMs switch and the list's own buttons. */
export const chatListHeaderSx = {
  alignItems: 'center',
  borderBottom: '1px solid',
  borderColor: 'divider',
  containerName: CHAT_LIST_HEADER_CONTAINER,
  containerType: 'inline-size',
  display: 'flex',
  flexShrink: 0,
  gap: 1,
  justifyContent: 'space-between',
  minHeight: 62,
  px: '12px',
  py: '10px',
  width: '100%',
} as const;

export const chatListHeaderActionsSx = {
  alignItems: 'center',
  display: 'flex',
  flexShrink: 0,
  // The buttons' own padding already separates the icons.
  gap: 0,
} as const;

export const chatListHeaderButtonSx = {
  color: 'text.secondary',
  flexShrink: 0,
  height: CHAT_LIST_TOUCH_TARGET,
  width: CHAT_LIST_TOUCH_TARGET,
} as const;

export const chatListHeaderIconSx = { fontSize: CHAT_LIST_ICON_SIZE } as const;

/** The scrolling area under the header. */
export const chatListScrollPadding = '10px 8px';

export const getChatListRowSx = (
  theme: Theme,
  { selected }: { selected: boolean }
) => ({
  backgroundColor: selected ? theme.palette.action.selected : 'transparent',
  borderLeft: `3px solid ${
    selected ? theme.palette.primary.main : 'transparent'
  }`,
  borderRadius: '10px',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column' as const,
  marginBottom: '6px',
  padding: `12px ${CHAT_LIST_ROW_PADDING_X}px`,
  transition: 'background-color 0.15s ease, border-color 0.15s ease',
  width: '100%',
  '&:hover': {
    backgroundColor: selected
      ? theme.palette.action.selected
      : theme.palette.action.hover,
  },
});

export const chatListRowContentSx = {
  alignItems: 'center',
  display: 'flex',
  gap: `${CHAT_LIST_ROW_GAP}px`,
  width: '100%',
} as const;

export const chatListAvatarSlotSx = {
  marginRight: 0,
  minWidth: CHAT_LIST_AVATAR_SLOT,
} as const;

/** Unread rows show their title in the accent colour (plus the row badge). */
export const getChatListTitleSx = (theme: Theme, unread: boolean) => ({
  color: unread ? theme.palette.primary.main : theme.palette.text.primary,
  fontFamily: 'Inter',
  fontSize: '15px',
  fontWeight: 600,
  lineHeight: 1.3,
});

export const getChatListSubtitleSx = (theme: Theme) => ({
  color: theme.palette.text.secondary,
  fontFamily: 'Inter',
  fontSize: '12px',
  lineHeight: 1.4,
  marginTop: '3px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
});

/** The ListItemText around the title and subtitle. */
export const chatListTextSx = {
  flex: 1,
  margin: 0,
  minWidth: 0,
  overflow: 'hidden',
} as const;

/**
 * Avatar without a picture: the first letter on the panel surface with a
 * faint outline (as the DM rows draw it in DirectRowAvatar).
 */
export const getChatListAvatarFallbackSx = (theme: Theme) => ({
  background: theme.palette.background.surface,
  color: theme.palette.text.primary,
  ...(getFallbackAvatarOutlineSx(theme) as Record<string, string>),
});

/**
 * The slot at the trailing edge of a row (group pin, DM Friend badge): a full
 * touch target whose spare room reaches into the row padding, so the icon
 * stays where the small control used to be and the name keeps its width. The
 * negative vertical margin keeps the row height of a 40px avatar.
 */
export const chatListRowEdgeActionSx = {
  alignItems: 'center',
  display: 'inline-flex',
  flexShrink: 0,
  height: CHAT_LIST_TOUCH_TARGET,
  justifyContent: 'center',
  marginBottom: `${(CHAT_LIST_AVATAR_SIZE - CHAT_LIST_TOUCH_TARGET) / 2}px`,
  marginRight: `-${CHAT_LIST_ROW_PADDING_X}px`,
  marginTop: `${(CHAT_LIST_AVATAR_SIZE - CHAT_LIST_TOUCH_TARGET) / 2}px`,
  // Pulls the target back over the trailing gap, so the visible gap to the
  // icon stays about the row gap.
  marginLeft: '-6px',
  width: CHAT_LIST_TOUCH_TARGET,
} as const;
