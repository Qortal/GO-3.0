import { Box, ButtonBase, Typography, useTheme, alpha } from '@mui/material';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import ChatRoundedIcon from '@mui/icons-material/ChatRounded';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { mobileTabBarElementAtom } from './mobileTabBarElement';
import {
  directChatHasUnreadAtom,
  groupChatHasUnreadExcludingMutedAtom,
} from '../../atoms/global';
import {
  useMobileTabNavigation,
  type MobileTabKey,
} from './useMobileTabNavigation';
import { SAFE_AREA_BOTTOM } from '../../utils/mobileSafeArea';
import { MOBILE_TAB_BAR_HEIGHT_PX } from './mobileBarHeights';
import { useGoLayout } from '../../layout/goLayout';

// Defined in mobileBarHeights.ts so mobileLayout.ts needn't import this
// component; re-exported for existing importers.
export { MOBILE_TAB_BAR_HEIGHT_PX };

type TabKey = MobileTabKey;

/** Width of the centred Home/Apps/Chat cluster on wide GO screens. */
export const GO_TAB_CLUSTER_WIDTH_PX = 440;

type MobileTabBarProps = {
  desktopViewMode: string;
  setDesktopViewMode: (mode: string) => void;
  /**
   * 'bottom' (default): the fixed bottom navigation bar.
   * 'inline': a compact icon-only row meant to be embedded in the top bar
   * (used in landscape where the bottom bar is hidden to save vertical space).
   */
  variant?: 'bottom' | 'inline';
  /**
   * Immersive mode: slide the bar off the bottom edge (it stays mounted so
   * it can glide back). Timings come from useImmersiveBars.
   */
  immersive?: {
    hidden: boolean;
    showMs: number;
    hideMs: number;
    easing: string;
    barRef?: (node: HTMLElement | null) => void;
  };
  /**
   * See-through bar: Home, Apps and Chat as floating round glass buttons,
   * with the screen's content showing between and behind them.
   */
  floating?: boolean;
  /**
   * Nothing scrolls on behind the floating bar (a Q-App, or immersive mode
   * off): the whole strip takes touches, for the sideways swipe between
   * Home, Apps and Chat, not only the round buttons.
   */
  stripTakesTouches?: boolean;
};

const chatUnreadDot = (dotColor: string, ringColor: string) => ({
  width: 9,
  height: 9,
  borderRadius: '50%',
  backgroundColor: dotColor,
  border: `2px solid ${ringColor}`,
  flexShrink: 0,
});

/**
 * Only direct messages pulse. Group traffic is constant enough that an
 * animated dot for it just reads as noise.
 */
const chatUnreadDotPulse = (dotColor: string, ringColor: string) => ({
  ...chatUnreadDot(dotColor, ringColor),
  animation: 'mobile-chat-unread-pulse 1.5s ease-in-out infinite',
  '@keyframes mobile-chat-unread-pulse': {
    '0%, 100%': {
      boxShadow: `0 0 0 0 ${dotColor}99`,
      transform: 'scale(1)',
    },
    '50%': {
      boxShadow: `0 0 0 5px ${dotColor}33`,
      transform: 'scale(1.12)',
    },
  },
});

/**
 * Bottom navigation for the mobilized Hub (Home / Apps / Chat).
 * Wallet remains available from the account menu in the top bar.
 */
export const MobileTabBar = ({
  desktopViewMode,
  setDesktopViewMode,
  variant = 'bottom',
  immersive,
  floating = false,
  stripTakesTouches = false,
}: MobileTabBarProps) => {
  const theme = useTheme();
  // GO landscape and tablets: three buttons spread over a wide screen are a
  // reach apart, so they sit in a centred cluster instead.
  const centredCluster = useGoLayout((l) => l.go && l.widthClass !== 'compact');
  // The swipe between sections listens on the bar too (useSectionSwipe).
  const setTabBarElement = useSetAtom(mobileTabBarElementAtom);
  const immersiveBarRef = immersive?.barRef;
  const barRef = useCallback(
    (node: HTMLElement | null) => {
      immersiveBarRef?.(node);
      setTabBarElement(node);
    },
    [immersiveBarRef, setTabBarElement]
  );
  const hasPmUnread = useAtomValue(directChatHasUnreadAtom);
  const hasGroupUnread = useAtomValue(groupChatHasUnreadExcludingMutedAtom);
  const { active, go } = useMobileTabNavigation(
    desktopViewMode,
    setDesktopViewMode
  );

  const items: Array<{
    key: TabKey;
    label: string;
    Icon: typeof HomeRoundedIcon;
  }> = [
    { key: 'home', label: 'Home', Icon: HomeRoundedIcon },
    { key: 'apps', label: 'Apps', Icon: AppsRoundedIcon },
    { key: 'chat', label: 'Chat', Icon: ChatRoundedIcon },
  ];

  const dotRingColor =
    theme.palette.mode === 'dark'
      ? 'rgb(28, 30, 36)'
      : theme.palette.background.paper;

  if (variant === 'inline') {
    return (
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexShrink: 0,
          gap: 0.25,
        }}
      >
        {items.map(({ key, label, Icon }) => {
          const isActive = active === key;
          const color = isActive
            ? theme.palette.primary.main
            : theme.palette.text.secondary;
          const showGroupDot = key === 'chat' && hasGroupUnread;
          const showPmDot = key === 'chat' && hasPmUnread;
          return (
            <ButtonBase
              key={key}
              focusRipple
              onClick={() => go(key)}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
              sx={{
                borderRadius: 999,
                p: 0.25,
                transition: 'transform 120ms ease',
                '&:active': { transform: 'scale(0.92)' },
              }}
            >
              <Box
                sx={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 30,
                  borderRadius: 999,
                  transition: 'background-color 160ms ease',
                  backgroundColor: isActive
                    ? alpha(theme.palette.primary.main, 0.16)
                    : 'transparent',
                }}
              >
                <Icon sx={{ fontSize: 21, color }} />
                {showGroupDot && (
                  <Box
                    aria-hidden
                    sx={{
                      position: 'absolute',
                      top: 1,
                      left: 5,
                      ...chatUnreadDotPulse(
                        theme.palette.primary.main,
                        dotRingColor
                      ),
                    }}
                  />
                )}
                {showPmDot && (
                  <Box
                    aria-hidden
                    sx={{
                      position: 'absolute',
                      top: 1,
                      right: 5,
                      ...chatUnreadDotPulse(
                        theme.palette.success.main,
                        dotRingColor
                      ),
                    }}
                  />
                )}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
    );
  }

  const immersiveSx = immersive
    ? immersive.hidden
      ? {
          // Past the edge by the shadow's reach too, so no glow is left.
          transform: 'translateY(calc(100% + 28px))',
          visibility: 'hidden' as const,
          pointerEvents: 'none' as const,
          transition: `transform ${immersive.hideMs}ms ${immersive.easing}, visibility 0s linear ${immersive.hideMs}ms`,
        }
      : {
          transform: 'none',
          visibility: 'visible' as const,
          transition: `transform ${immersive.showMs}ms ${immersive.easing}`,
        }
    : {};

  const isDark = theme.palette.mode === 'dark';
  const glass = isDark
    ? alpha(theme.palette.background.paper, 0.72)
    : alpha(theme.palette.background.paper, 0.86);

  return (
    <Box
      ref={barRef}
      sx={{
        ...immersiveSx,
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: floating ? 'center' : 'stretch',
        justifyContent: floating ? 'space-around' : undefined,
        height: `calc(${MOBILE_TAB_BAR_HEIGHT_PX}px + ${SAFE_AREA_BOTTOM})`,
        paddingBottom: SAFE_AREA_BOTTOM,
        ...(centredCluster
          ? {
              paddingInline: `max(0px, calc((100% - ${GO_TAB_CLUSTER_WIDTH_PX}px) / 2))`,
            }
          : {}),
        ...(floating
          ? // Taps between the buttons reach the content behind them; with
            // nothing behind, the strip itself takes swipes.
            {
              pointerEvents: stripTakesTouches
                ? ('auto' as const)
                : ('none' as const),
            }
          : {
              backgroundColor: isDark
                ? 'rgb(28, 30, 36)'
                : theme.palette.background.paper,
              borderTop: `1px solid ${theme.palette.border?.subtle ?? alpha(theme.palette.text.primary, 0.12)}`,
              boxShadow: isDark
                ? '0 -6px 18px rgba(0,0,0,0.35)'
                : '0 -4px 14px rgba(15,20,30,0.12)',
            }),
      }}
    >
      {items.map(({ key, label, Icon }) => {
        const isActive = active === key;
        const color = isActive
          ? theme.palette.primary.main
          : theme.palette.text.secondary;
        const showGroupDot = key === 'chat' && hasGroupUnread;
        const showPmDot = key === 'chat' && hasPmUnread;
        return (
          <ButtonBase
            key={key}
            focusRipple
            onClick={() => go(key)}
            aria-label={
              key === 'chat' && (showPmDot || showGroupDot)
                ? `${label}${showPmDot ? ', unread direct messages' : ''}${showGroupDot ? ', unread group messages' : ''}`
                : label
            }
            aria-current={isActive ? 'page' : undefined}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color,
              transition:
                'color 160ms ease, transform 120ms ease, background-color 200ms ease, border-color 200ms ease',
              '&:active': { transform: 'scale(0.92)' },
              ...(floating
                ? {
                    // A round glass button per section; the bar itself is
                    // see-through.
                    flex: '0 0 auto',
                    pointerEvents: 'auto',
                    width: 54,
                    height: 54,
                    gap: '2px',
                    borderRadius: '50%',
                    backdropFilter: 'blur(14px) saturate(140%)',
                    WebkitBackdropFilter: 'blur(14px) saturate(140%)',
                    backgroundColor: isActive
                      ? alpha(theme.palette.primary.main, isDark ? 0.24 : 0.16)
                      : glass,
                    border: `1px solid ${
                      isActive
                        ? alpha(theme.palette.primary.main, 0.55)
                        : alpha(theme.palette.text.primary, isDark ? 0.12 : 0.1)
                    }`,
                    boxShadow: isDark
                      ? '0 6px 16px rgba(0,0,0,0.45)'
                      : '0 6px 16px rgba(15,20,30,0.16)',
                  }
                : {
                    flex: 1,
                    gap: '3px',
                    pt: '6px',
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      top: 0,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: isActive ? 26 : 0,
                      height: 3,
                      borderRadius: '0 0 3px 3px',
                      backgroundColor: theme.palette.primary.main,
                      transition: 'width 180ms ease',
                    },
                  }),
            }}
          >
            <Box
              sx={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: floating ? 32 : 40,
                height: floating ? 28 : 26,
                borderRadius: 999,
                transition: 'background-color 160ms ease',
                backgroundColor:
                  isActive && !floating
                    ? alpha(theme.palette.primary.main, 0.14)
                    : 'transparent',
              }}
            >
              <Icon sx={{ fontSize: floating ? 26 : 23, color }} />
              {showGroupDot && (
                <Box
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    top: floating ? -2 : 0,
                    left: floating ? -3 : 4,
                    ...chatUnreadDot(theme.palette.primary.main, dotRingColor),
                  }}
                />
              )}
              {showPmDot && (
                <Box
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    top: floating ? -2 : 0,
                    right: floating ? -3 : 4,
                    ...chatUnreadDotPulse(
                      theme.palette.success.main,
                      dotRingColor
                    ),
                  }}
                />
              )}
            </Box>
            {/* The round buttons show the icon alone; the name stays as the
                button's accessible label. */}
            {floating ? null : (
              <Typography
                sx={{
                  fontSize: '10.5px',
                  fontWeight: isActive ? 700 : 500,
                  lineHeight: 1,
                  color,
                }}
              >
                {label}
              </Typography>
            )}
          </ButtonBase>
        );
      })}
    </Box>
  );
};

export default MobileTabBar;
