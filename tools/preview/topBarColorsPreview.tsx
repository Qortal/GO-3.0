/**
 * Dev-only preview of the phone top bar in immersive mode: the real
 * MobileTopBar, see-through, over pages of different colours, with its
 * controls drawn in the theme that reads on each (useImmersiveBarTheme).
 * GO itself in its saved theme (dark by default). Run `npm run dev` and open
 * /tools/preview/top-bar-colors.html. Not a build input.
 */
import { createRoot } from 'react-dom/client';
import { Box, CssBaseline, Typography, useTheme } from '@mui/material';
import { Provider, createStore } from 'jotai';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import { ThemeProvider } from '../../src/components/Theme/ThemeContext';
import { MobileTopBar } from '../../src/components/Mobile/MobileTopBar';
import { useImmersiveBarTheme } from '../../src/components/Mobile/immersive/useImmersiveBarTheme';

const store = createStore();
const PAGES = ['#ffffff', '#f4f5f7', '#5b8def', '#101114', '#1c1e24'];
const noop = () => {};

const Strip = ({ color }: { color: string }) => {
  const theme = useTheme();
  const barTheme = useImmersiveBarTheme(color, theme.palette.mode, true);
  return (
    <Box sx={{ background: color, mb: 2 }}>
      <Box
        data-color={color}
        sx={{
          '& > *': {
            background: 'transparent !important',
            borderBottomColor: 'transparent !important',
          },
        }}
      >
        <MobileTopBar
          barTheme={barTheme}
          floating
          userInfo={{ name: 'Simon', address: 'QdemoAddress123' }}
          onOpenWalletsApp={noop}
          onOpenSendQort={noop}
          onOpenDrawerLookup={noop}
          onOpenMinting={noop}
          onOpenSettings={noop}
          onLogout={noop}
          onOpenTabs={noop}
          desktopViewMode="apps"
        />
      </Box>
      <Typography sx={{ color: barTheme?.palette.text.primary, p: 2 }}>
        Page {color}: bar drawn{' '}
        {barTheme ? barTheme.palette.mode : 'in GO’s own theme'}
      </Typography>
    </Box>
  );
};

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <ThemeProvider>
      <CssBaseline />
      <Box sx={{ bgcolor: 'background.default', minHeight: '100vh', py: 1 }}>
        {PAGES.map((color) => (
          <Strip key={color} color={color} />
        ))}
      </Box>
    </ThemeProvider>
  </Provider>
);
