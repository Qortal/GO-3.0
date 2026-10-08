/**
 * Dev-only preview of the tappable "Saved to …" popup, the Open/Share sheet
 * behind it and the PDF reader's top bar. The page claims to be native after
 * load so the reader shows Share and "Open with". Run `npm run dev` and open
 * /tools/preview/saved-file-actions.html. Not a build input, so it never ships.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Button, CssBaseline, Stack } from '@mui/material';
import i18n from '../../src/i18n/i18n';
import '../../src/styles/index.css';
import { ThemeProvider } from '../../src/components/Theme/ThemeContext';
import { QortinoNotificationHost } from '../../src/components/Snackbar/QortinoNotificationHost';
import {
  openSavedFileActions,
  SavedFileActionsSheet,
} from '../../src/components/Mobile/SavedFileActionsSheet';
import { PdfViewer } from '../../src/common/PdfViewer';
import { executeEvent } from '../../src/utils/events';

// A small PDF with three pages, so swiping between pages can be tried.
const PDF = (() => {
  const pages = [1, 2, 3];
  const objs: string[] = [
    '<</Type/Catalog/Pages 2 0 R>>',
    `<</Type/Pages/Kids[${pages.map((n) => `${2 + n} 0 R`).join(' ')}]/Count 3>>`,
    ...pages.map(
      (n) =>
        `<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 420]/Contents ${6 + n} 0 R/Resources<</Font<</F1 6 0 R>>>>>>`
    ),
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    ...pages.map((n) => {
      const text = `BT /F1 24 Tf 60 300 Td (Receipt page ${n}) Tj ET`;
      return `<</Length ${text.length}>>\nstream\n${text}\nendstream`;
    }),
  ];
  return `%PDF-1.4\n${objs.map((o, i) => `${i + 1} 0 obj${o} endobj`).join('\n')}\ntrailer<</Root 1 0 R>>`;
})();
const pdf = () => new Blob([PDF], { type: 'application/pdf' });

const Preview = () => {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<any>(null);
  const showSaved = () => {
    setInfo({
      type: 'success',
      message: i18n.t('core:file_transfer.saved_to', {
        location: 'Documents/Qortal Go/Documents',
      }),
      duration: 7000,
      tapHint: i18n.t('core:file_transfer.tap_to_open_or_share'),
      onTap: () =>
        openSavedFileActions({
          fileName: 'receipt-2026-10-06.pdf',
          folder: 'Documents/Qortal Go/Documents',
          uri: 'content://media/external_primary/file/42',
          mimeType: 'application/pdf',
          blob: pdf(),
        }),
    });
    setOpen(true);
  };
  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
      <Stack direction="row" spacing={1} sx={{ p: 2, pt: 40 }}>
        <Button variant="contained" onClick={showSaved}>
          Saved popup
        </Button>
        <Button
          variant="outlined"
          onClick={() =>
            executeEvent('openPdf', { blob: pdf(), title: 'receipt.pdf' })
          }
        >
          Open PDF
        </Button>
      </Stack>
      <QortinoNotificationHost
        open={open}
        setOpen={setOpen}
        info={info}
        setInfo={setInfo}
      />
      <SavedFileActionsSheet />
      <PdfViewer />
    </Box>
  );
};

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
}, 300);
