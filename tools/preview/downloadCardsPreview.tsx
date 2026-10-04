/**
 * Dev-only preview of the floating download cards (QdnTransfersOverlay): the
 * stack, the sideways swipe into the bell and the 5 s auto-hide. The store
 * only reports on the phone, so the page claims to be native once the overlay
 * is up (after it, so the Q-App fetch reporter is not installed). The tray
 * calls fail quietly. Run `npm run dev` and open
 * /tools/preview/download-cards.html. Not a build input, so it never ships.
 */
import { createRoot } from 'react-dom/client';
import { Box, Button, CssBaseline, Stack } from '@mui/material';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import { ThemeProvider } from '../../src/components/Theme/ThemeContext';
import { QdnTransfersOverlay } from '../../src/components/Transfers/QdnTransfersOverlay';
import {
  beginQappFetchNotification,
  beginQdnSaveNotification,
  finishQdnSaveNotification,
  reportQappFetchProgress,
} from '../../src/utils/qdnDownloadNotifications';

let next = 0;
const MB = 1024 * 1024;

const addDownload = () => {
  const id = `preview-fetch:${++next}`;
  const total = 40 * MB;
  beginQappFetchNotification(id, `Track ${next}.m4a`, total);
  let loaded = 0;
  const timer = setInterval(() => {
    loaded = Math.min(total, loaded + 2 * MB);
    reportQappFetchProgress(id, loaded, total);
    if (loaded >= total) clearInterval(timer);
  }, 250);
};

const addSaved = () => {
  const id = `preview-save:${++next}`;
  beginQdnSaveNotification(id, `Song ${next}.m4a`, { stage: 'saving' });
  finishQdnSaveNotification(id, 'Documents/Qortal Go/Audio', {
    uri: `content://media/external_primary/file/${next}`,
    mimeType: 'audio/mp4',
  });
};

const Preview = () => (
  <Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
    <Box
      data-go-notifications-anchor
      sx={{
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        height: 52,
      }}
    />
    <Stack direction="row" spacing={1} sx={{ p: 2, pt: 30 }}>
      <Button variant="contained" onClick={addDownload}>
        Add download
      </Button>
      <Button variant="outlined" onClick={addSaved}>
        Add saved
      </Button>
    </Stack>
    <QdnTransfersOverlay />
  </Box>
);

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);

setTimeout(() => {
  const cap = (window as unknown as { Capacitor?: Record<string, unknown> })
    .Capacitor;
  if (cap) cap.isNativePlatform = () => true;
  Object.assign(window, { previewDownloads: { addDownload, addSaved } });
}, 300);
