/**
 * Dev-only preview of the widgets screen at phone width, with the real
 * floating bottom bar. ?seed=1 puts public Q-Apps on it as stand-in
 * widgets (none are published yet), ?fake=1 loads the example clock widget
 * (qapps/go-widget-clock) from a fake node under fake-node/, ?empty=1
 * clears it, ?theme=light.
 * Run `npm run dev` and open /tools/preview/widgets.html. Not a build input,
 * so it never ships.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, CssBaseline, useTheme } from '@mui/material';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { WidgetsScreen } from '../../src/components/Mobile/widgets/WidgetsScreen';
import { MobileTabBar } from '../../src/components/Mobile/MobileTabBar';
import { GO_WIDGETS_STORAGE_KEY } from '../../src/components/Mobile/widgets/goWidgets';
import { handleSetGlobalApikey } from '../../src/utils/globalApi';

const params = new URLSearchParams(window.location.search);
if (params.get('empty') === '1') {
  window.localStorage.removeItem(GO_WIDGETS_STORAGE_KEY);
}
if (params.get('seed') === '1') {
  window.localStorage.setItem(
    GO_WIDGETS_STORAGE_KEY,
    JSON.stringify([
      {
        name: 'Q-Blog',
        identifier: null,
        title: 'Q-Blog',
        x: 0,
        y: 0,
        w: 4,
        h: 5,
      },
      {
        name: 'Q-Tube',
        identifier: null,
        title: 'Q-Tube',
        x: 0,
        y: 5,
        w: 2,
        h: 4,
      },
      {
        name: 'Q-Mail',
        identifier: null,
        title: 'Q-Mail',
        x: 2,
        y: 5,
        w: 2,
        h: 4,
      },
    ])
  );
}
if (params.get('fake') === '1') {
  // fake-node/render/APP/GOClock.html stands in for a node's /render.
  handleSetGlobalApikey({
    url: `${window.location.origin}/tools/preview/fake-node`,
    apikey: '',
  } as never);
  window.localStorage.setItem(
    GO_WIDGETS_STORAGE_KEY,
    JSON.stringify([
      {
        name: 'GOClock',
        identifier: null,
        title: 'GO Clock',
        x: 0,
        y: 0,
        w: 4,
        h: 5,
      },
    ])
  );
}
const wantLight = params.get('theme') === 'light';

const Page = () => {
  const theme = useTheme();
  const { themeMode, toggleTheme } = useThemeContext();
  const [mode, setMode] = useState('widgets');
  useEffect(() => {
    if ((themeMode === 'light') !== wantLight) toggleTheme();
    // Once, to the asked theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Box
      sx={{
        backgroundColor: theme.palette.background.default,
        height: '100vh',
        ['--go-tab-bar-space' as string]: '76px',
      }}
    >
      <WidgetsScreen active={mode === 'widgets'} />
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
