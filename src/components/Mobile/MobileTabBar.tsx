import { useEffect, useState } from 'react';
import { Box, ButtonBase, Typography, useTheme, alpha } from '@mui/material';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import ChatRoundedIcon from '@mui/icons-material/ChatRounded';
import { useAtomValue } from 'jotai';
import { executeEvent } from '../../utils/events';
import { openMobileChatPanel } from '../../utils/openQChatTab';
import {
  directChatHasUnreadAtom,
  groupChatHasUnreadExcludingMutedAtom,
} from '../../atoms/global';
import { SAFE_AREA_BOTTOM } from '../../utils/mobileSafeArea';

export const MOBILE_TAB_BAR_HEIGHT_PX = 60;

type TabKey = 'home' | 'apps' | 'chat';

type MobileTabBarProps = {
  desktopViewMode: string;
  setDesktopViewMode: (mode: string) => void;
};

const chatUnreadDotPulse = (dotColor: string, ringColor: string) => ({
  width: 9,
  height: 9,
  borderRadius: '50%',
  backgroundColor: dotColor,
  border: `2px solid ${ringColor}`,
  flexShrink: 0,
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
}: MobileTabBarProps) => {
  const theme = useTheme();
  const [active, setActive] = useState<TabKey>('home');
  const hasPmUnread = useAtomValue(directChatHasUnreadAtom);
  const hasGroupUnread = useAtomValue(groupChatHasUnreadExcludingMutedAtom);

  useEffect(() => {
    if (desktopViewMode === 'home') setActive('home');
    else if (desktopViewMode === 'chat') setActive('chat');
    else if (desktopViewMode === 'apps' || desktopViewMode === 'dev')
      setActive('apps');
  }, [desktopViewMode]);

  const go = (tab: TabKey) => {
    setActive(tab);
    switch (tab) {
      case 'home':
        setDesktopViewMode('home');
        executeEvent('open-home-mode', {});
        break;
      case 'apps':
        executeEvent('newTabWindow', {});
        setDesktopViewMode('apps');
        break;
      case 'chat':
        setDesktopViewMode('chat');
        openMobileChatPanel();
        executeEvent('mobile-chat-side-view', { data: { view: 'directs' } });
        break;
    }
  };

  const items: Array<{ key: TabKey; label: string; Icon: typeof HomeRoundedIcon }> =
    [
      { key: 'home', label: 'Home', Icon: HomeRoundedIcon },
      { key: 'apps', label: 'Apps', Icon: AppsRoundedIcon },
      { key: 'chat', label: 'Chat', Icon: ChatRoundedIcon },
    ];

  const dotRingColor =
    theme.palette.mode === 'dark'
      ? 'rgb(28, 30, 36)'
      : theme.palette.background.paper;

  return (
    <Box
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'stretch',
        height: `calc(${MOBILE_TAB_BAR_HEIGHT_PX}px + ${SAFE_AREA_BOTTOM})`,
        paddingBottom: SAFE_AREA_BOTTOM,
        backgroundColor:
          theme.palette.mode === 'dark'
            ? 'rgb(28, 30, 36)'
            : theme.palette.background.paper,
        borderTop: `1px solid ${theme.palette.border?.subtle ?? alpha(theme.palette.text.primary, 0.12)}`,
        boxShadow:
          theme.palette.mode === 'dark'
            ? '0 -6px 18px rgba(0,0,0,0.35)'
            : '0 -4px 14px rgba(15,20,30,0.12)',
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
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              pt: '6px',
              color,
              transition: 'color 160ms ease, transform 120ms ease',
              '&:active': { transform: 'scale(0.92)' },
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
            }}
          >
            <Box
              sx={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 26,
                borderRadius: 999,
                transition: 'background-color 160ms ease',
                backgroundColor: isActive
                  ? alpha(theme.palette.primary.main, 0.14)
                  : 'transparent',
              }}
            >
              <Icon sx={{ fontSize: 23, color }} />
              {showGroupDot && (
                <Box
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 4,
                    ...chatUnreadDotPulse(theme.palette.primary.main, dotRingColor),
                  }}
                />
              )}
              {showPmDot && (
                <Box
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    top: 0,
                    right: 4,
                    ...chatUnreadDotPulse(theme.palette.success.main, dotRingColor),
                  }}
                />
              )}
            </Box>
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
          </ButtonBase>
        );
      })}
    </Box>
  );
};

export default MobileTabBar;
