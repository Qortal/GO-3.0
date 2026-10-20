/**
 * Dev-only preview of the "public node unavailable" window over a mock phone
 * screen. The real window and watch run; only the public node is faked: while
 * "node down" is on, every request to ext-node.qortal.link fails.
 * Run `npm run dev` and open /tools/preview/public-node-down.html. Not a
 * build input, so it never ships.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { alpha, Box, CssBaseline, Typography, useTheme } from '@mui/material';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { PublicNodeDownWindow } from '../../src/components/Mobile/PublicNodeDownWindow';
import { MOBILE_TAB_BAR_HEIGHT_PX } from '../../src/components/Mobile/mobileBarHeights';
import {
  afterPublicNodeOpen,
  beforePublicNodeOpen,
  checkPublicNodeNow,
  reportPublicNodeTrouble,
  setPublicNodeQdnNoticeHidden,
} from '../../src/publicNode/publicNodeWatch';

const PUBLIC_ORIGIN = 'https://ext-node.qortal.link';
let nodeDown = false;
const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === 'string' ? input : String((input as any).url ?? input);
  if (url.startsWith(PUBLIC_ORIGIN)) {
    if (nodeDown) return Promise.reject(new TypeError('Failed to fetch'));
    if (url.endsWith('/admin/status')) {
      return Promise.resolve(new Response('{"height":1}', { status: 200 }));
    }
  }
  return realFetch(input, init);
};

function Preview() {
  const theme = useTheme();
  const { themeMode, toggleTheme } = useThemeContext();
  const [down, setDown] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const note = (line: string) =>
    setLog((lines) => [line, ...lines].slice(0, 4));

  const setNode = (next: boolean) => {
    nodeDown = next;
    setDown(next);
    void checkPublicNodeNow();
  };

  return (
    <Box
      sx={{
        bgcolor: 'background.default',
        minHeight: '100vh',
        pb: `${MOBILE_TAB_BAR_HEIGHT_PX + 16}px`,
      }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, p: 1 }}>
        <button onClick={() => setNode(!down)}>
          {down ? 'node down ✓' : 'node up ✓'}
        </button>
        <button
          onClick={() => {
            const opened = beforePublicNodeOpen({
              service: 'APP',
              name: 'Torq',
              retry: () => note('Torq opens'),
            });
            if (opened) note('Torq opened at once');
          }}
        >
          open Torq
        </button>
        <button
          onClick={() =>
            afterPublicNodeOpen({
              service: 'APP',
              name: 'Q-Tube',
              reload: () => note('Q-Tube reloads'),
            })
          }
        >
          Q-Tube opened, check behind
        </button>
        <button
          onClick={() => {
            setPublicNodeQdnNoticeHidden(false);
            reportPublicNodeTrouble();
          }}
        >
          QDN loads fail
        </button>
        <button onClick={toggleTheme}>{themeMode}</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{log.join(' · ')}</span>
      </Box>

      {/* Something like Home under the window. */}
      <Box sx={{ display: 'grid', gap: 1.5, px: 2 }}>
        {['Torq', 'Featured Q-Apps', 'Q-Chat'].map((title) => (
          <Box
            key={title}
            sx={{
              bgcolor: 'background.paper',
              border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
              borderRadius: '18px',
              height: 150,
              p: 2,
            }}
          >
            <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
          </Box>
        ))}
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          bgcolor: 'background.paper',
          borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
          bottom: 0,
          display: 'flex',
          height: MOBILE_TAB_BAR_HEIGHT_PX,
          justifyContent: 'space-around',
          left: 0,
          position: 'fixed',
          right: 0,
        }}
      >
        {['Home', 'Apps', 'Chat'].map((tab) => (
          <Typography key={tab} sx={{ fontSize: 13, opacity: 0.7 }}>
            {tab}
          </Typography>
        ))}
      </Box>

      <PublicNodeDownWindow enabled />
    </Box>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
