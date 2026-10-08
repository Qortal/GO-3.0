/**
 * Dev-only preview of the phone top bar search and its results dropdown,
 * with a made-up Q-App catalog (thumbnails fall back to the Qortal logo).
 * Run `npm run dev` and open /tools/preview/top-bar-search.html, then type,
 * e.g. "test". Not a build input, so it never ships.
 */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { Box, CssBaseline } from '@mui/material';
import { Provider, createStore } from 'jotai';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import { ThemeProvider } from '../../src/components/Theme/ThemeContext';
import { availableQappsAtom } from '../../src/atoms/appsAtoms';
import { MobileTopBarSearch } from '../../src/components/Mobile/MobileTopBarSearch';

const store = createStore();
const app = (name: string, title: string, service = 'APP') => ({
  name,
  service,
  metadata: { title, description: `${title} by ${name}` },
});
store.set(availableQappsAtom, [
  app('a-test', 'test', 'WEBSITE'),
  app('qortal-phil', 'test'),
  app('a test', 'test', 'WEBSITE'),
  app('a+test new2', 'test'),
  app('a-test-2', 'test', 'WEBSITE'),
  app('asherah', 'test'),
  app('psi-lord.com', 'test', 'WEBSITE'),
  app('Q-Tube', 'Q-Tube'),
  app('Q-Mail', 'Q-Mail'),
  app('Q-Share', 'Q-Share'),
  app('Torq', 'Torq'),
  app('testnet-tools', 'Testnet tools'),
] as any);

const Preview = () => {
  const [expanded, setExpanded] = useState(true);
  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
      <Box
        sx={{
          alignItems: 'center',
          bgcolor: 'background.paper',
          display: 'flex',
          height: 52,
          px: 1,
        }}
      >
        <MobileTopBarSearch
          expanded={expanded}
          onExpandedChange={setExpanded}
        />
      </Box>
    </Box>
  );
};

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <ThemeProvider>
      <CssBaseline />
      <Preview />
    </ThemeProvider>
  </Provider>
);
