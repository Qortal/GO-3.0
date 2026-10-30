/**
 * Fullscreen zoom + save for plain image URLs (avatars, etc.).
 */
import { useState } from 'react';
import {
  Box,
  CircularProgress,
  Dialog,
  IconButton,
  Snackbar,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import FileSaver from 'file-saver';
import { Capacitor } from '@capacitor/core';
import {
  mobileSaveLocationLabelFor,
  saveBlobToMobileDocuments,
} from '../../../utils/mobileFileSave';
import { SAFE_AREA_TOP } from '../../../utils/mobileSafeArea';
import { QortinoZoomableImage } from './QortinoZoomableImage';

type Props = {
  open: boolean;
  src: string | null;
  alt?: string;
  onClose: () => void;
};

function extFromMime(mime: string): string {
  if (!mime) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('webp')) return 'webp';
  return 'png';
}

export function QortinoImageLightbox({
  open,
  src,
  alt = '',
  onClose,
}: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState('');

  const handleSave = async () => {
    if (!src || saving) return;
    setSaving(true);
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const filename = `qortal-avatar-${Date.now()}.${extFromMime(blob.type)}`;
      if (Capacitor.isNativePlatform()) {
        await saveBlobToMobileDocuments(filename, blob);
        setSnack(`Saved to ${mobileSaveLocationLabelFor(filename, blob.type)}`);
      } else {
        FileSaver.saveAs(blob, filename);
        setSnack('Image downloaded');
      }
    } catch {
      setSnack('Could not save image');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog
        open={open && !!src}
        onClose={onClose}
        fullScreen
        PaperProps={{
          sx: {
            background: isDark ? '#0B0B10' : '#111118',
            m: 0,
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            position: 'relative',
            width: '100%',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              gap: 0.5,
              justifyContent: 'flex-end',
              pt: `calc(8px + ${SAFE_AREA_TOP})`,
              px: 1,
              position: 'absolute',
              right: 0,
              top: 0,
              zIndex: 2,
            }}
          >
            <IconButton
              aria-label="Save image"
              onClick={() => void handleSave()}
              disabled={!src || saving}
              sx={{
                background: alpha('#000', 0.45),
                color: '#fff',
                '&:hover': { background: alpha('#000', 0.65) },
              }}
            >
              {saving ? (
                <CircularProgress size={20} sx={{ color: '#fff' }} />
              ) : (
                <DownloadRoundedIcon />
              )}
            </IconButton>
            <IconButton
              aria-label="Close"
              onClick={onClose}
              sx={{
                background: alpha('#000', 0.45),
                color: '#fff',
                '&:hover': { background: alpha('#000', 0.65) },
              }}
            >
              <CloseRoundedIcon />
            </IconButton>
          </Box>
          {src ? (
            <Box sx={{ flex: 1, minHeight: 0, width: '100%' }}>
              <QortinoZoomableImage src={src} alt={alt} />
            </Box>
          ) : null}
          {alt ? (
            <Typography
              sx={{
                color: alpha('#fff', 0.75),
                fontSize: '0.8rem',
                fontWeight: 600,
                pb: 2,
                px: 2,
                textAlign: 'center',
              }}
            >
              {alt}
            </Typography>
          ) : null}
        </Box>
      </Dialog>
      <Snackbar
        open={!!snack}
        autoHideDuration={2400}
        onClose={() => setSnack('')}
        message={snack}
      />
    </>
  );
}
