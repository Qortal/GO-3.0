/**
 * Dev-only preview of immersive mode: the real hook, tab bar, floating button
 * and settings row around a stand-in top bar. Apps is a frame (scrolls inside
 * it, like a Q-App); Home and Chat keep their bars. Run `npm run dev` and
 * open /tools/preview/immersive.html (?mode=auto|manual,
 * ?view=apps|home|chat). Not a build input.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Box,
  ButtonBase,
  CssBaseline,
  Dialog,
  Typography,
  useTheme,
} from '@mui/material';
import { useAtom } from 'jotai';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import { ThemeProvider } from '../../src/components/Theme/ThemeContext';
import { MobileTabBar } from '../../src/components/Mobile/MobileTabBar';
import { MOBILE_TAB_BAR_HEIGHT_PX } from '../../src/components/Mobile/mobileBarHeights';
import { ImmersivePill } from '../../src/components/Mobile/immersive/ImmersivePill';
import { ImmersiveEdges } from '../../src/components/Mobile/immersive/ImmersiveEdges';
import { ImmersiveModeSetting } from '../../src/components/Mobile/immersive/ImmersiveModeSetting';
import {
  immersiveModeAtom,
  isImmersiveSurface,
  normalizeImmersiveMode,
} from '../../src/components/Mobile/immersive/immersiveMode';
import { useImmersiveBars } from '../../src/components/Mobile/immersive/useImmersiveBars';
import {
  immersiveContentTop,
  immersiveTabBarProps,
  immersiveTopBarSx,
} from '../../src/components/Mobile/immersive/immersiveStyles';
import {
  SAFE_AREA_BOTTOM,
  SAFE_AREA_TOP,
} from '../../src/utils/mobileSafeArea';

const params = new URLSearchParams(window.location.search);

const FRAME_DOC = `<!doctype html><html><head><style>
  html,body{margin:0;height:100%;font:15px system-ui;background:#141820;color:#e8eaf0}
  .app{display:flex;flex-direction:column;height:100%}
  header,footer{flex:none;padding:12px 16px;background:#2a5bd7;color:#fff;font-weight:700}
  footer{background:#1f8a5b}
  main{flex:1;overflow:auto;padding:8px 16px}
  .row{padding:14px 0;border-bottom:1px solid #ffffff14}
</style></head><body><div class="app">
  <header>Q-App header (stays on screen)</header>
  <main>${Array.from({ length: 60 }, (_, i) => `<div class="row">Q-App row ${i + 1}</div>`).join('')}</main>
  <footer>Q-App footer (stays on screen)</footer>
</div></body></html>`;

const Preview = () => {
  const theme = useTheme();
  const [view, setView] = useState(params.get('view') ?? 'apps');
  const [mode, setMode] = useAtom(immersiveModeAtom);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const fromUrl = params.get('mode');
    if (fromUrl) setMode(normalizeImmersiveMode(fromUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const immersive = useImmersiveBars({
    mode,
    eligible: isImmersiveSurface(view),
    surfaceKey: view,
    holdOpen: settingsOpen,
  });

  useEffect(() => {
    (window as any).__immersive = immersive;
  });

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
      <Box ref={immersive.topBarRef} sx={immersiveTopBarSx(immersive)}>
        <Box
          data-testid="top-bar"
          sx={{
            alignItems: 'center',
            bgcolor:
              theme.palette.mode === 'dark'
                ? 'rgb(28, 30, 36)'
                : 'background.paper',
            borderBottom: 1,
            borderColor: 'divider',
            boxSizing: 'content-box',
            display: 'flex',
            flexShrink: 0,
            gap: 1,
            height: 52,
            pt: SAFE_AREA_TOP,
            px: 1.5,
          }}
        >
          <Typography sx={{ flex: 1, fontWeight: 800 }}>GO top bar</Typography>
          <ButtonBase
            onClick={() => setSettingsOpen(true)}
            sx={{ borderRadius: 2, px: 1.2, py: 0.6, fontWeight: 700 }}
          >
            Settings
          </ButtonBase>
        </Box>
      </Box>

      <Box
        ref={immersive.contentRef}
        sx={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
          pb:
            immersive.active && !immersive.layoutShown
              ? SAFE_AREA_BOTTOM
              : `calc(${MOBILE_TAB_BAR_HEIGHT_PX}px + ${SAFE_AREA_BOTTOM})`,
          ...(immersive.active && { pt: immersiveContentTop(immersive) }),
        }}
      >
        {view === 'apps' ? (
          <iframe
            title="Q-App"
            srcDoc={FRAME_DOC}
            style={{ border: 0, flex: 1, width: '100%' }}
          />
        ) : view === 'home' ? (
          <Box data-testid="home-scroller" sx={{ flex: 1, overflow: 'auto' }}>
            {Array.from({ length: 50 }, (_, i) => (
              <Box
                key={i}
                sx={{
                  bgcolor: 'background.paper',
                  borderRadius: 3,
                  m: 1.5,
                  p: 2,
                }}
              >
                <Typography sx={{ fontWeight: 700 }}>
                  Home post {i + 1}
                </Typography>
                <Typography sx={{ color: 'text.secondary', fontSize: 14 }}>
                  Scroll down to tuck the bars away, up to bring them back.
                </Typography>
              </Box>
            ))}
          </Box>
        ) : (
          <Box sx={{ p: 2 }}>
            <Typography>Chat keeps its bars in every mode.</Typography>
          </Box>
        )}
      </Box>

      <MobileTabBar
        desktopViewMode={view}
        setDesktopViewMode={setView}
        immersive={immersiveTabBarProps(immersive)}
      />
      {immersive.active && (
        <ImmersiveEdges
          barsShown={immersive.barsShown}
          topBarHeight={immersive.topBarHeight}
          tabBarSlot
          showMs={immersive.showMs}
          hideMs={immersive.hideMs}
        />
      )}
      {immersive.active && (
        <ImmersivePill
          visible={!immersive.barsShown}
          onReveal={immersive.reveal}
          pillRef={immersive.pillRef}
        />
      )}

      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        fullWidth
      >
        <ImmersiveModeSetting />
      </Dialog>
    </Box>
  );
};

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
