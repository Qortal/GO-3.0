/**
 * Dev-only preview of the floating Home/Apps/Chat buttons stepping aside for
 * a panel that reaches the bottom of the phone screen: a stand-in chat with
 * the real channel list rows in a drawer (as ChatGroup draws it on phones)
 * and the real MobileTabBar, with the screen scrolling on behind the buttons
 * as with immersive mode on. "Channels" opens the drawer; the buttons slide
 * off the bottom edge while it is open (useCoverMobileTabBar) and come back
 * when it closes, and nothing behind it moves. Run `npm run dev` and open
 * /tools/preview/tab-bar-cover.html (?open=1 starts with the drawer open,
 * ?theme=light). Best at a phone size. Not a build input, so it never ships.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { alpha, Box, ButtonBase, CssBaseline, Typography } from '@mui/material';
import { useAtomValue } from 'jotai';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { ReticulumSortableChannelButton } from '../../src/components/Chat/ChatGroup';
import { MobileTabBar } from '../../src/components/Mobile/MobileTabBar';
import {
  mobileTabBarCoveredAtom,
  useCoverMobileTabBar,
} from '../../src/components/Mobile/mobileTabBarCover';
import { MOBILE_TAB_BAR_HEIGHT_PX } from '../../src/components/Mobile/mobileBarHeights';
import {
  RETICULUM_CHANNEL_DRAWER_PHONE_MAX_WIDTH,
  RETICULUM_CHANNEL_DRAWER_PHONE_WIDTH_PX,
} from '../../src/components/Chat/reticulumChannelListLayout';
import { SAFE_AREA_BOTTOM } from '../../src/utils/mobileSafeArea';

const params = new URLSearchParams(window.location.search);

type Channel = Parameters<typeof ReticulumSortableChannelButton>[0]['channel'];

const CHANNEL_NAMES = [
  'general',
  '⚡ Qortal Marketing',
  '📈 QORT Trading',
  '💡 Tasks & Ideas',
  '🤖 Bug Reports',
  '🧑‍💻 Technical Support',
  '🔗 Official Links',
  '💊 Medicine',
  '🌍 Politics',
  '😇 Religion',
  '💬 Off-Topic',
  '🤖 Core',
  '📺 Hub',
  '📱 Go',
  '💻 Q-Apps',
  '📡 Reticulum',
];

const CHANNELS: Channel[] = CHANNEL_NAMES.map((name, position) => ({
  archived: false,
  channelId: position === 0 ? 'general' : `ch-${position}`,
  createdAt: 1,
  createdBy: 'preview',
  groupId: 9001,
  name,
  position,
  updatedAt: 1,
}));

const Preview = () => {
  const { toggleTheme, themeMode } = useThemeContext();
  const [open, setOpen] = useState(params.get('open') === '1');
  const [selected, setSelected] = useState('general');
  const [view, setView] = useState('chat');
  // As ChatGroup does for its drawer.
  useCoverMobileTabBar(open);
  const covered = useAtomValue(mobileTabBarCoveredAtom);

  useEffect(() => {
    if (params.get('theme') === 'light' && themeMode !== 'light') toggleTheme();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box
      sx={{
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          flexShrink: 0,
          gap: 1,
          height: 52,
          px: 1.5,
        }}
      >
        <ButtonBase
          data-testid="channels"
          onClick={() => setOpen((value) => !value)}
          sx={{ borderRadius: 2, fontWeight: 700, px: 1.2, py: 0.6 }}
        >
          # {CHANNELS.find((c) => c.channelId === selected)?.name} ▾
        </ButtonBase>
        <Typography
          data-testid="covered"
          sx={{ color: 'text.secondary', fontSize: 12, ml: 'auto' }}
        >
          covered: {String(covered)}
        </Typography>
        <ButtonBase onClick={toggleTheme} sx={{ fontSize: 12, px: 1 }}>
          {themeMode}
        </ButtonBase>
      </Box>

      {/* The chat: runs on behind the buttons (immersive mode on). */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <Box
          sx={{
            height: '100%',
            overflowY: 'auto',
            pb: `calc(${MOBILE_TAB_BAR_HEIGHT_PX}px + ${SAFE_AREA_BOTTOM})`,
            px: 2,
          }}
        >
          {Array.from({ length: 30 }, (_, i) => (
            <Typography key={i} sx={{ py: 1.2 }}>
              Message {i + 1} in #{selected}
            </Typography>
          ))}
        </Box>

        {open && (
          <Box
            data-testid="scrim"
            onClick={() => setOpen(false)}
            sx={(theme) => ({
              backgroundColor: alpha(theme.palette.common.black, 0.45),
              inset: 0,
              position: 'absolute',
              zIndex: 8,
            })}
          />
        )}
        <Box
          data-testid="drawer"
          sx={(theme) => ({
            backgroundColor: theme.palette.background.surface,
            borderRight: `1px solid ${theme.palette.divider}`,
            boxShadow: open
              ? `0 0 30px ${alpha(theme.palette.common.black, 0.5)}`
              : 'none',
            height: '100%',
            left: 0,
            maxWidth: RETICULUM_CHANNEL_DRAWER_PHONE_MAX_WIDTH,
            overflowY: 'auto',
            position: 'absolute',
            top: 0,
            transform: open ? 'translateX(0)' : 'translateX(-100%)',
            transition:
              'transform 240ms cubic-bezier(0.2, 0, 0, 1), box-shadow 240ms ease',
            width: RETICULUM_CHANNEL_DRAWER_PHONE_WIDTH_PX,
            zIndex: 9,
          })}
        >
          <Box sx={{ px: 1, py: 1 }}>
            {CHANNELS.map((channel) => (
              <ReticulumSortableChannelButton
                key={channel.channelId}
                channel={channel}
                hasUnreadMention={false}
                isAdmin={false}
                mentionCount={0}
                onContextMenu={() => undefined}
                onSelect={(channelId) => {
                  setSelected(channelId);
                  setOpen(false);
                }}
                phone
                replyCount={0}
                selected={selected === channel.channelId}
                textScale="default"
                unreadCount={channel.channelId === 'ch-14' ? 1 : 0}
              />
            ))}
          </Box>
        </Box>
      </Box>

      <MobileTabBar
        desktopViewMode={view}
        setDesktopViewMode={setView}
        floating
        covered={covered}
      />
    </Box>
  );
};

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
