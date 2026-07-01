import { useEffect, useRef, useState } from 'react';
import {
  Box,
  ButtonBase,
  CircularProgress,
  Portal,
  Typography,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import jsQR from 'jsqr';
import { SAFE_AREA_TOP } from '../utils/mobileSafeArea';

type QrScannerOverlayProps = {
  open: boolean;
  onClose: () => void;
  onResult: (text: string) => void;
};

/**
 * Fully offline QR scanner: opens the device camera via the WebView's
 * getUserMedia and decodes frames with jsQR (pure JavaScript). No Google Play
 * Services / ML Kit — works on de-Googled Android too.
 *
 * Capacitor's WebChromeClient grants the WebView camera access at runtime as
 * long as the app declares the CAMERA permission (see AndroidManifest.xml).
 */
export function QrScannerOverlay({
  open,
  onClose,
  onResult,
}: QrScannerOverlayProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const resolvedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'starting' | 'ready'>('starting');

  useEffect(() => {
    if (!open) return;
    resolvedRef.current = false;
    setError(null);
    setStatus('starting');

    let cancelled = false;

    const stop = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };

    const tick = () => {
      const video = videoRef.current;
      if (cancelled || !video || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const canvas = canvasRef.current ?? document.createElement('canvas');
      canvasRef.current = canvas;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      ctx.drawImage(video, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      const code = jsQR(imageData.data, width, height, {
        inversionAttempts: 'dontInvert',
      });
      if (code && code.data && !resolvedRef.current) {
        resolvedRef.current = true;
        stop();
        onResult(code.data.trim());
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('camera-unavailable');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.setAttribute('playsinline', 'true');
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        if (!cancelled) setStatus('ready');
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        console.error('[QR] camera start failed:', err);
        if (!cancelled) {
          setError(
            t('core:message.error.camera_access', {
              defaultValue:
                'Could not access the camera. Please allow camera access and try again.',
              postProcess: 'capitalizeFirstChar',
            })
          );
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, onResult, t]);

  if (!open) return null;

  return (
    <Portal>
      <Box
        sx={{
          position: 'fixed',
          inset: 0,
          zIndex: 2000,
          backgroundColor: '#000',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          controls={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            // Hide the native <video> placeholder / play-button poster that the
            // WebView shows before the camera stream produces its first frame.
            opacity: status === 'ready' ? 1 : 0,
            pointerEvents: 'none',
          }}
        />

        {/* Scan reticle — only once the camera preview is live */}
        {!error && status === 'ready' && (
          <Box
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'min(68vw, 300px)',
              height: 'min(68vw, 300px)',
              border: `2px solid ${theme.palette.common.white}`,
              borderRadius: '18px',
              boxShadow: '0 0 0 100vmax rgba(0,0,0,0.45)',
            }}
          />
        )}

        {/* Starting / permission-pending state */}
        {!error && status === 'starting' && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              px: 4,
              textAlign: 'center',
            }}
          >
            <CircularProgress sx={{ color: theme.palette.common.white }} />
            <Typography
              sx={{
                color: theme.palette.common.white,
                fontSize: '0.95rem',
                lineHeight: 1.5,
              }}
            >
              {t('core:message.generic.starting_camera', {
                defaultValue: 'Starting camera… allow camera access if prompted.',
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
        )}

        <Box
          sx={{
            position: 'absolute',
            top: `calc(${SAFE_AREA_TOP} + 12px)`,
            left: 0,
            right: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
          }}
        >
          <Typography
            sx={{
              color: theme.palette.common.white,
              fontSize: '0.95rem',
              fontWeight: 600,
              textShadow: '0 1px 4px rgba(0,0,0,0.6)',
            }}
          >
            {t('core:action.scan_qr_code', {
              defaultValue: 'Scan QR code',
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
          <ButtonBase
            onClick={onClose}
            aria-label={t('core:action.close', {
              defaultValue: 'Close',
              postProcess: 'capitalizeFirstChar',
            })}
            sx={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              color: theme.palette.common.white,
              backgroundColor: 'rgba(0,0,0,0.4)',
            }}
          >
            <CloseIcon />
          </ButtonBase>
        </Box>

        {error && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              px: 4,
              textAlign: 'center',
            }}
          >
            <Typography
              sx={{
                color: theme.palette.common.white,
                fontSize: '0.95rem',
                lineHeight: 1.5,
              }}
            >
              {error}
            </Typography>
          </Box>
        )}
      </Box>
    </Portal>
  );
}
