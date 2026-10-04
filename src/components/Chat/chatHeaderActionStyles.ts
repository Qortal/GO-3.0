import type { Theme } from '@mui/material/styles';

/**
 * Square icon actions of the chat headers (group chat and DM). Phones (below
 * the `md` breakpoint) get finger-sized targets; desktop keeps its compact
 * size. The phone values are never below the desktop ones.
 */
export const CHAT_HEADER_ACTION_PHONE_PX = 44;
export const CHAT_HEADER_ACTION_DESKTOP_PX = 36;
export const CHAT_HEADER_ICON_PHONE_PX = 23;
export const CHAT_HEADER_ICON_DESKTOP_PX = 19;
/** Height and side gutters of a chat header bar on phones. */
export const CHAT_HEADER_PHONE_HEIGHT_PX = 50;
export const CHAT_HEADER_PHONE_GUTTER_PX = 12;

/**
 * Hover styles go under this query. Touch WebViews keep `:hover` on the last
 * tapped element, so an unconditional hover fill would stay on a button after
 * a tap; devices with a real pointer still get it.
 */
export const HOVER_CAPABLE_MEDIA = '@media (hover: hover)';

export type ChatHeaderActionMetrics = {
  /** Width and height of an icon-only action. */
  sizePx: number;
  /** Glyph size of the icon inside it. */
  iconPx: number;
};

export function getChatHeaderActionMetrics(
  isMobile: boolean
): ChatHeaderActionMetrics {
  return isMobile
    ? { sizePx: CHAT_HEADER_ACTION_PHONE_PX, iconPx: CHAT_HEADER_ICON_PHONE_PX }
    : {
        sizePx: CHAT_HEADER_ACTION_DESKTOP_PX,
        iconPx: CHAT_HEADER_ICON_DESKTOP_PX,
      };
}

export type ChatHeaderActionSxOptions = {
  isMobile: boolean;
  /** Toggled on (an open panel): filled, white glyph. */
  active?: boolean;
  /** An icon with a text label beside it: the width follows the content. */
  showLabel?: boolean;
  /** Fill of an active action. Default: the theme's primary colour. */
  activeBackground?: string;
};

/**
 * Style of a chat header action: a rounded square, secondary-coloured glyph,
 * hover fill. The same look as the group chat header, so a DM header and a
 * group header read as one design. Use on a ButtonBase or an IconButton.
 */
export function getChatHeaderActionSx(
  theme: Theme,
  {
    isMobile,
    active = false,
    showLabel = false,
    activeBackground,
  }: ChatHeaderActionSxOptions
) {
  const { sizePx, iconPx } = getChatHeaderActionMetrics(isMobile);
  const activeFill = activeBackground || theme.palette.primary.main;
  return {
    alignItems: 'center',
    borderRadius: '8px',
    backgroundColor: active ? activeFill : 'transparent',
    color: active ? theme.palette.common.white : theme.palette.text.secondary,
    display: 'inline-flex',
    flexShrink: 0,
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: 600,
    gap: showLabel ? 0.6 : 0,
    height: sizePx,
    justifyContent: 'center',
    minWidth: showLabel ? 0 : sizePx,
    overflow: 'hidden',
    px: showLabel ? 1 : 0,
    textAlign: 'center',
    transition: 'background-color 140ms ease, color 140ms ease',
    width: showLabel ? 'auto' : sizePx,
    '& .MuiSvgIcon-root': { fontSize: iconPx },
    [HOVER_CAPABLE_MEDIA]: {
      '&:hover': {
        backgroundColor: active ? activeFill : theme.palette.action.hover,
        color: active ? theme.palette.common.white : theme.palette.text.primary,
      },
    },
  } as const;
}

/**
 * The round back button at the start of a chat header (use on an
 * IconButton, with an ArrowBackRounded icon of the metrics' `iconPx`). Its
 * size matches the actions on the right; the negative margin lines the arrow
 * up with the header's gutter.
 */
export function getChatHeaderBackSx(isMobile: boolean) {
  const { sizePx } = getChatHeaderActionMetrics(isMobile);
  return {
    color: 'text.secondary',
    flexShrink: 0,
    height: sizePx,
    ml: '-8px',
    width: sizePx,
  } as const;
}
