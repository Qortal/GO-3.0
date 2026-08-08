import { useEffect, useRef, useState } from 'react';
import { Box, ButtonBase, Typography, useTheme, alpha } from '@mui/material';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import ChatRoundedIcon from '@mui/icons-material/ChatRounded';
import { useAtomValue } from 'jotai';
import { executeEvent } from '../../utils/events';
import {
  filterAppTabsForMobile,
  isQChatOpenTab,
  openMobileChatPanel,
} from '../../utils/openQChatTab';
import { useOpenTabs, OpenTab } from './useOpenTabs';
import {
  directChatHasUnreadAtom,
  groupChatHasUnreadExcludingMutedAtom,
  isNewTabWindowAtom,
  qortinoAgentOpenAtom,
  qortinoAgentParkedAtom,
} from '../../atoms/global';
import {
  closeQortinoAgentSheet,
  restoreQortinoAgentSheet,
} from '../../qortinoAgent/qortinoSheetNav';
import { SAFE_AREA_BOTTOM } from '../../utils/mobileSafeArea';

export const MOBILE_TAB_BAR_HEIGHT_PX = 60;

type TabKey = 'home' | 'apps' | 'chat';

type MobileTabBarProps = {
  desktopViewMode: string;
  setDesktopViewMode: (mode: string) => void;
  /**
   * 'bottom' (default): the fixed bottom navigation bar.
   * 'inline': a compact icon-only row meant to be embedded in the top bar
   * (used in landscape where the bottom bar is hidden to save vertical space).
   */
  variant?: 'bottom' | 'inline';
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
  variant = 'bottom',
}: MobileTabBarProps) => {
  const theme = useTheme();
  const [active, setActive] = useState<TabKey>('home');
  const hasPmUnread = useAtomValue(directChatHasUnreadAtom);
  const hasGroupUnread = useAtomValue(groupChatHasUnreadExcludingMutedAtom);
  const isNewTabWindow = useAtomValue(isNewTabWindowAtom);
  const qortinoOpen = useAtomValue(qortinoAgentOpenAtom);
  const qortinoParked = useAtomValue(qortinoAgentParkedAtom);
  const { tabs, selectedTab } = useOpenTabs();
  // Remember the last real app the user viewed so a later Apps tap can return
  // to it after the Explore/library window has been shown.
  const lastAppTabRef = useRef<OpenTab | null>(null);

  useEffect(() => {
    if (selectedTab && !isQChatOpenTab(selectedTab)) {
      lastAppTabRef.current = selectedTab;
    }
  }, [selectedTab]);

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
        // Qortino loop: parked after Q-App → restore sheet; sheet open on home → dismiss.
        if (qortinoParked) {
          restoreQortinoAgentSheet();
          setDesktopViewMode('home');
          executeEvent('open-home-mode', {});
          break;
        }
        if (qortinoOpen) {
          closeQortinoAgentSheet();
          setDesktopViewMode('home');
          executeEvent('open-home-mode', {});
          break;
        }
        setDesktopViewMode('home');
        executeEvent('open-home-mode', {});
        break;
      case 'apps': {
        // Cycle behaviour:
        //  - arriving from another section: show the last-used app (or the
        //    Explore/library window if nothing is open yet);
        //  - already on an app: tap opens the Explore/library window;
        //  - already on the library: tap returns to the most-recent app.
        const appTabs = filterAppTabsForMobile(tabs);
        const hasOpenApp =
          appTabs.length > 0 ||
          Boolean(selectedTab && !isQChatOpenTab(selectedTab));
        const alreadyOnApps =
          active === 'apps' ||
          desktopViewMode === 'apps' ||
          desktopViewMode === 'dev';

        if (!alreadyOnApps) {
          // Restore the last-used app (AppsDesktop keeps its selected tab),
          // falling back to the library when there's nothing open.
          setDesktopViewMode('apps');
          if (!hasOpenApp) {
            executeEvent('newTabWindow', {});
          }
          break;
        }

        if (isNewTabWindow) {
          // Showing the library → go back to the most-recently opened app.
          const recentApp =
            (lastAppTabRef.current &&
              appTabs.find(
                (tab) => tab.tabId === lastAppTabRef.current?.tabId
              )) ||
            appTabs[appTabs.length - 1] ||
            null;
          if (recentApp) {
            executeEvent('setSelectedTab', { data: recentApp });
          } else {
            executeEvent('newTabWindow', {});
          }
        } else {
          // Showing an app → open the Explore/library window.
          executeEvent('newTabWindow', {});
        }
        setDesktopViewMode('apps');
        break;
      }
      case 'chat': {
        // Cycle behaviour (handled in Group.tsx via 'mobile-chat-tab'):
        //  - arriving from another section: resume the most-recently opened
        //    conversation (or show the last-used Groups/PM list if none);
        //  - already on a conversation: tap returns to its list (Groups or PM).
        const reEntry =
          active === 'chat' || desktopViewMode === 'chat';
        setDesktopViewMode('chat');
        openMobileChatPanel();
        executeEvent('mobile-chat-tab', { data: { reEntry } });
        break;
      }
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
