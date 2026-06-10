import { useCallback, useEffect, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import {
  Box,
  Button,
  IconButton,
  Slider,
  Typography,
  useTheme,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import { useTranslation } from 'react-i18next';

/**
 * Crops the chosen region of `src` into a square `outputSize`×`outputSize` WEBP
 * File. Keeping a fixed, modest output guarantees the avatar stays well under
 * the QDN thumbnail size limit regardless of the source photo's resolution.
 */
async function getCroppedFile(
  src: string,
  croppedAreaPixels: Area,
  fileName: string,
  outputSize = 512
): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });

  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    image,
    Math.max(0, croppedAreaPixels.x),
    Math.max(0, croppedAreaPixels.y),
    Math.max(1, croppedAreaPixels.width),
    Math.max(1, croppedAreaPixels.height),
    0,
    0,
    outputSize,
    outputSize
  );

  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), type, quality);
    });

  // Prefer WEBP; fall back to JPEG on WebViews where WEBP encode returns null.
  let blob = await encode('image/webp', 0.85);
  let ext = 'webp';
  if (!blob || blob.size === 0) {
    blob = await encode('image/jpeg', 0.9);
    ext = 'jpg';
  }
  if (!blob || blob.size === 0) throw new Error('Could not process image');

  // NOTE: Do not use `new File(...)` here. On the Android WebView the Cordova
  // file plugin overrides the global File constructor with a non-spec version
  // (File(name, localURL, ...)), so `new File([blob], name)` stores the blob as
  // `.name` and is not even a real Blob. We return the native canvas Blob and
  // attach a plain `name` string property instead.
  const base = (fileName || 'avatar').replace(/\.[^.]+$/, '') || 'avatar';
  try {
    Object.defineProperty(blob, 'name', {
      value: `${base}.${ext}`,
      writable: true,
      configurable: true,
    });
  } catch {
    /* some engines disallow adding props to Blob; name is optional */
  }
  return blob;
}

interface AvatarCropperProps {
  open: boolean;
  imageSrc: string | null;
  fileName?: string;
  onCancel: () => void;
  onCropped: (file: Blob) => void;
}

export default function AvatarCropper({
  open,
  imageSrc,
  fileName = 'avatar',
  onCancel,
  onCropped,
}: AvatarCropperProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);

  // Reset transform whenever a new image is loaded for cropping.
  useEffect(() => {
    if (open && imageSrc) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
    }
  }, [open, imageSrc]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const handleApply = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    try {
      setProcessing(true);
      const file = await getCroppedFile(imageSrc, croppedAreaPixels, fileName);
      onCropped(file);
    } catch (err) {
      console.error('Avatar crop failed:', err);
    } finally {
      setProcessing(false);
    }
  }, [imageSrc, croppedAreaPixels, fileName, onCropped]);

  if (!open || !imageSrc) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483000,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'rgba(6, 8, 12, 0.96)',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'center',
          px: 2,
          py: 1.5,
        }}
      >
        <Typography
          sx={{ color: '#fff', fontSize: '1rem', fontWeight: 700 }}
        >
          {t('core:action.crop_image', {
            defaultValue: 'Crop avatar',
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      </Box>

      <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          minZoom={1}
          maxZoom={5}
          aspect={1}
          cropShape="round"
          showGrid={false}
          restrictPosition
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </Box>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2.5,
          py: 1.5,
        }}
      >
        <IconButton
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(1, +(z - 0.2).toFixed(2)))}
          sx={{ color: '#fff' }}
        >
          <RemoveRoundedIcon />
        </IconButton>
        <Slider
          value={zoom}
          min={1}
          max={5}
          step={0.01}
          onChange={(_e, value) => setZoom(value as number)}
          aria-label="Zoom"
          sx={{ color: theme.palette.primary.main }}
        />
        <IconButton
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(5, +(z + 0.2).toFixed(2)))}
          sx={{ color: '#fff' }}
        >
          <AddRoundedIcon />
        </IconButton>
      </Box>

      <Box
        sx={{
          display: 'flex',
          gap: 1.5,
          px: 2.5,
          pb: 2.5,
          pt: 0.5,
        }}
      >
        <Button
          fullWidth
          variant="outlined"
          onClick={onCancel}
          disabled={processing}
          sx={{
            borderColor: 'rgba(255,255,255,0.3)',
            color: '#fff',
            textTransform: 'none',
            '&:hover': { borderColor: 'rgba(255,255,255,0.5)' },
          }}
        >
          {t('core:action.cancel', {
            defaultValue: 'Cancel',
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
        <Button
          fullWidth
          variant="contained"
          onClick={handleApply}
          disabled={processing || !croppedAreaPixels}
          sx={{ textTransform: 'none', fontWeight: 700 }}
        >
          {t('core:action.apply', {
            defaultValue: 'Apply',
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
      </Box>
    </Box>
  );
}
