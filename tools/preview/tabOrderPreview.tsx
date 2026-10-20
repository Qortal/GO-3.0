/**
 * Dev-only preview of Settings → System → Bottom buttons, with the real
 * floating Home / Apps / Chat bar under it, at phone width: drag a button in
 * the row and the bar takes the order when the drag ends. ?theme=light for
 * the light theme. Run `npm run dev` and open /tools/preview/tab-order.html.
 * Not a build input, so it never ships.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, CssBaseline, Typography, useTheme } from '@mui/material';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { MobileTabOrderSetting } from '../../src/components/Mobile/MobileTabOrderSetting';
import { MobileTabBar } from '../../src/components/Mobile/MobileTabBar';

const wantLight =
  new URLSearchParams(window.location.search).get('theme') === 'light';

const Page = () => {
  const theme = useTheme();
  const { themeMode, toggleTheme } = useThemeContext();
  const [mode, setMode] = useState('home');
  useEffect(() => {
    if ((themeMode === 'light') !== wantLight) toggleTheme();
    // Once, to the asked theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Box
      sx={{
        backgroundColor: theme.palette.background.default,
        minHeight: '100vh',
        pb: 12,
        pt: 2,
        px: 2,
      }}
    >
      <Box
        sx={{
          backgroundColor: theme.palette.background.paper,
          borderRadius: '16px',
          maxWidth: 420,
          mx: 'auto',
        }}
      >
        <MobileTabOrderSetting />
      </Box>
      <Typography
        data-testid="current-section"
        sx={{ color: 'text.secondary', mt: 2, textAlign: 'center' }}
      >
        section: {mode}
      </Typography>
      <MobileTabBar
        desktopViewMode={mode}
        setDesktopViewMode={setMode}
        floating
      />
    </Box>
  );
};

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Page />
  </ThemeProvider>
);
