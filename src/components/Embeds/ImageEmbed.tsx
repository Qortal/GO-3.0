import { useContext, useEffect, useRef, useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  ButtonBase,
  Divider,
  Dialog,
  IconButton,
  Snackbar,
  Alert,
  CircularProgress,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import { CustomLoader } from '../../common/CustomLoader';
import ImageIcon from '@mui/icons-material/Image';
import CloseIcon from '@mui/icons-material/Close';
import FileSaver from 'file-saver';
import { decodeIfEncoded } from '../../utils/decode';
import { useTranslation } from 'react-i18next';
import { appHeighOffsetPx } from '../Desktop/CustomTitleBar';
import { isCapacitor } from '../../utils/platform';
import { ReticulumImageViewer } from '../Chat/ReticulumImageViewer';
import {
  ChatMediaGalleryContext,
  findChatMediaIndex,
  type ChatMediaItem,
} from '../Chat/chatMediaGallery';
import {
  mobileSaveLocationLabelFor,
  saveBlobToMobileDocuments,
} from '../../utils/mobileFileSave';

export const ImageCard = ({
  image,
  resource = null,
  fetchImage,
  owner,
  refresh,
  openExternal,
  external,
  isLoadingParent,
  errorMsg,
  encryptionType,
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);
  const [isOpen, setIsOpen] = useState(true);
  const [height, setHeight] = useState('400px');

  useEffect(() => {
    if (isOpen) {
      fetchImage();
    }
  }, [isOpen]);

  return (
    <Card
      sx={{
        backgroundColor: theme.palette.background.default,
        height: height,
        transition: 'height 0.6s ease-in-out',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 16px 0px 16px',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <ImageIcon
            sx={{
              color: theme.palette.text.primary,
            }}
          />
          <Typography>
            {t('core:image_embed', { postProcess: 'capitalizeFirstWord' })}
          </Typography>
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '10px',
          }}
        >
          <ButtonBase>
            <RefreshIcon
              onClick={refresh}
              sx={{
                fontSize: '24px',
                color: theme.palette.text.primary,
              }}
            />
          </ButtonBase>

          {external && (
            <ButtonBase>
              <OpenInNewIcon
                onClick={openExternal}
                sx={{
                  fontSize: '24px',
                  color: theme.palette.text.primary,
                }}
              />
            </ButtonBase>
          )}
        </Box>
      </Box>

      <Box
        sx={{
          padding: '8px 16px 8px 16px',
        }}
      >
        <Typography
          sx={{
            fontSize: '12px',
          }}
        >
          {t('core:message.generic.created_by', {
            owner: decodeIfEncoded(owner),
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>

        <Typography
          sx={{
            fontSize: '12px',
          }}
        >
          {encryptionType === 'private'
            ? t('core:message.generic.encrypted', {
                postProcess: 'capitalizeAll',
              })
            : encryptionType === 'group'
              ? t('group:message.generic.group_encrypted', {
                  postProcess: 'capitalizeAll',
                })
              : t('core:message.generic.encrypted_not', {
                  postProcess: 'capitalizeFirstChar',
                })}
        </Typography>
      </Box>

      <Divider sx={{ borderColor: 'rgb(255 255 255 / 10%)' }} />

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
        }}
      >
        {isLoadingParent && isOpen && (
          <Box
            sx={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <CustomLoader />
          </Box>
        )}

        {errorMsg && (
          <Box
            sx={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <Typography
              sx={{
                fontSize: '14px',
                color: theme.palette.other.danger,
              }}
            >
              {errorMsg}
            </Typography>
          </Box>
        )}
      </Box>

      <Box
        sx={{
          maxHeight: '100%',
          flexGrow: 1,
          overflow: 'hidden',
        }}
      >
        <CardContent
          sx={{
            height: '100%',
          }}
        >
          <ImageViewer resource={resource} src={image} />
        </CardContent>
      </Box>
    </Card>
  );
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const DOUBLE_TAP_SCALE = 2.5;
const ZOOM_EASING = 'transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1)';

/**
 * Fullscreen image with pinch-to-zoom, double-tap zoom, drag-to-pan (touch)
 * and wheel zoom (desktop). The live transform is written straight to the DOM
 * during gestures (no per-frame React re-render) so panning/pinching stay
 * smooth; an eased CSS transition is used for double-tap / wheel jumps.
 */
function ZoomableImage({ src, alt }: { src: string | null; alt: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Live (committed) transform; mutated in place to avoid re-renders.
  const tf = useRef({ scale: 1, x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);

  const gesture = useRef({
    startDist: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
    focalX: 0,
    focalY: 0,
    panStartX: 0,
    panStartY: 0,
    isPanning: false,
    lastTapTime: 0,
  });

  const paint = (animate: boolean) => {
    const el = imgRef.current;
    if (!el) return;
    el.style.transition = animate ? ZOOM_EASING : 'none';
    el.style.transform = `translate3d(${tf.current.x}px, ${tf.current.y}px, 0) scale(${tf.current.scale})`;
  };

  // Coalesce rapid gesture updates into one paint per animation frame.
  const schedulePaint = () => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      paint(false);
    });
  };

  const getRect = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { cx: 0, cy: 0, width: 0, height: 0 };
    return {
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
    };
  };

  const clampTranslate = (nextScale: number, x: number, y: number) => {
    const { width, height } = getRect();
    const maxX = (width * (nextScale - 1)) / 2;
    const maxY = (height * (nextScale - 1)) / 2;
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  };

  const reset = (animate = true) => {
    tf.current = { scale: 1, x: 0, y: 0 };
    paint(animate);
  };

  useEffect(() => {
    reset(false);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Zoom to a target scale while keeping the focal point fixed (animated).
  const zoomTo = (nextScale: number, focalX: number, focalY: number) => {
    const { cx, cy } = getRect();
    const fx = focalX - cx;
    const fy = focalY - cy;
    const ratio = nextScale / tf.current.scale;
    const nextX = fx - (fx - tf.current.x) * ratio;
    const nextY = fy - (fy - tf.current.y) * ratio;
    const clamped = clampTranslate(nextScale, nextX, nextY);
    tf.current = { scale: nextScale, x: clamped.x, y: clamped.y };
    paint(true);
  };

  const doubleTapZoom = (focalX: number, focalY: number) => {
    if (tf.current.scale > 1.01) {
      reset(true);
    } else {
      zoomTo(DOUBLE_TAP_SCALE, focalX, focalY);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      g.startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      g.startScale = tf.current.scale;
      g.startX = tf.current.x;
      g.startY = tf.current.y;
      g.focalX = (a.clientX + b.clientX) / 2;
      g.focalY = (a.clientY + b.clientY) / 2;
      g.isPanning = false;
      // Cancel any pending eased transition so the pinch tracks 1:1.
      paint(false);
    } else if (e.touches.length === 1) {
      const now = Date.now();
      const t = e.touches[0];
      if (now - g.lastTapTime < 300) {
        doubleTapZoom(t.clientX, t.clientY);
        g.lastTapTime = 0;
        g.isPanning = false;
      } else {
        g.lastTapTime = now;
        if (tf.current.scale > 1) {
          g.isPanning = true;
          g.panStartX = t.clientX - tf.current.x;
          g.panStartY = t.clientY - tf.current.y;
          paint(false);
        }
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (e.touches.length === 2 && g.startDist > 0) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const nextScale = clamp(
        g.startScale * (dist / g.startDist),
        MIN_ZOOM,
        MAX_ZOOM
      );
      const { cx, cy } = getRect();
      const fx = g.focalX - cx;
      const fy = g.focalY - cy;
      const ratio = nextScale / g.startScale;
      const nextX = fx - (fx - g.startX) * ratio;
      const nextY = fy - (fy - g.startY) * ratio;
      const clamped = clampTranslate(nextScale, nextX, nextY);
      tf.current = { scale: nextScale, x: clamped.x, y: clamped.y };
      schedulePaint();
    } else if (e.touches.length === 1 && g.isPanning && tf.current.scale > 1) {
      e.preventDefault();
      const t = e.touches[0];
      const clamped = clampTranslate(
        tf.current.scale,
        t.clientX - g.panStartX,
        t.clientY - g.panStartY
      );
      tf.current = { ...tf.current, x: clamped.x, y: clamped.y };
      schedulePaint();
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const g = gesture.current;
    g.startDist = 0;
    if (e.touches.length === 0) {
      g.isPanning = false;
      if (tf.current.scale <= 1.01) reset(true);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0018;
    const nextScale = clamp(tf.current.scale * (1 + delta), MIN_ZOOM, MAX_ZOOM);
    if (nextScale <= 1.01) reset(true);
    else zoomTo(nextScale, e.clientX, e.clientY);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    doubleTapZoom(e.clientX, e.clientY);
  };

  return (
    <Box
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      sx={{
        alignItems: 'center',
        display: 'flex',
        height: '100%',
        justifyContent: 'center',
        overflow: 'hidden',
        touchAction: 'none',
        width: '100%',
      }}
    >
      <img
        ref={imgRef}
        src={src ?? undefined}
        alt={alt}
        draggable={false}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          transform: 'translate3d(0,0,0) scale(1)',
          transformOrigin: 'center center',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          willChange: 'transform',
        }}
      />
    </Box>
  );
}

export function ImageViewer({
  src = null,
  alt = '',
  resource = null,
}: {
  src?: string | null;
  alt?: string;
  /** The QDN picture, to find it among the chat's for swiping. */
  resource?: { service?: string; name?: string; identifier?: string } | null;
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  // In a chat (and on any phone) the chat's own full-screen viewer opens:
  // copy, share, save, and swiping through the chat's pictures.
  const mediaGallery = useContext(ChatMediaGalleryContext);
  const viewerTheme = useTheme();
  const isPhone = useMediaQuery(viewerTheme.breakpoints.down('md'));
  const [chatViewer, setChatViewer] = useState<{
    container: HTMLElement | null;
    gallery: { items: ChatMediaItem[]; index: number } | null;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [snack, setSnack] = useState<{
    open: boolean;
    type: 'success' | 'error';
    message: string;
  }>({ open: false, type: 'success', message: '' });
  const handleOpenFullscreen = () => setIsFullscreen(true);
  const handleCloseFullscreen = () => setIsFullscreen(false);
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  const extFromMime = (mime: string) => {
    if (!mime) return 'png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('png')) return 'png';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('svg')) return 'svg';
    if (mime.includes('bmp')) return 'bmp';
    const parts = mime.split('/');
    return parts[1] || 'png';
  };

  const handleSaveImage = async () => {
    if (!src || isSaving) return;
    setIsSaving(true);
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const filename = `qortal-image-${Date.now()}.${extFromMime(blob.type)}`;
      if (isCapacitor()) {
        await saveBlobToMobileDocuments(filename, blob);
        setSnack({
          open: true,
          type: 'success',
          message: `Saved to ${mobileSaveLocationLabelFor(filename, blob.type)}`,
        });
      } else {
        FileSaver.saveAs(blob, filename);
        setSnack({ open: true, type: 'success', message: 'Image downloaded' });
      }
    } catch (error) {
      console.error('Error saving image:', error);
      setSnack({
        open: true,
        type: 'error',
        message: 'Could not save image',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {/* Image in container */}
      <Box
        sx={{
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'center',
          maxWidth: '100%', // Prevent horizontal overflow
          height: '100%',
        }}
        onClick={(event) => {
          const container = event.currentTarget.closest<HTMLElement>(
            '[data-reticulum-chat-root="true"]'
          );
          if (!src || (!isPhone && !container)) {
            handleOpenFullscreen();
            return;
          }
          const items = mediaGallery?.getItems() ?? [];
          const index = resource
            ? findChatMediaIndex(items, {
                messageKey:
                  event.currentTarget.closest('.message-item-row')?.id ||
                  undefined,
                qdn: resource,
              })
            : -1;
          setChatViewer({
            container,
            gallery: index >= 0 ? { items, index } : null,
          });
        }}
      >
        <img
          src={src}
          alt={alt}
          style={{
            maxWidth: '100%',
            maxHeight: '450px', // Adjust max height for small containers
            objectFit: 'contain', // Preserve aspect ratio
          }}
        />
      </Box>

      {chatViewer && src && (
        <ReticulumImageViewer
          alt={alt || undefined}
          containerElement={chatViewer.container}
          gallery={chatViewer.gallery}
          onClose={() => setChatViewer(null)}
          open
          src={src}
        />
      )}

      {/* Fullscreen Viewer */}
      <Dialog
        open={isFullscreen}
        onClose={handleCloseFullscreen}
        maxWidth="lg"
        fullWidth
        fullScreen
        sx={{
          '& .MuiDialog-paper': {
            margin: 0,
            maxWidth: '100%',
            width: '100%',
            height: `calc(100dvh - ${appHeighOffsetPx})`,
            overflow: 'hidden', // Prevent scrollbars
          },
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: theme.palette.background.paper, // Optional: dark background for fullscreen mode
            display: 'flex',
            height: '100%',
            justifyContent: 'center',
            position: 'relative',
            width: '100%',
          }}
        >
          {/* Action buttons */}
          <Box
            sx={{
              position: 'absolute',
              right: 8,
              top: `calc(8px + var(--safe-area-inset-top, 0px))`,
              zIndex: 10,
              display: 'flex',
              gap: '8px',
            }}
          >
            <IconButton
              onClick={handleSaveImage}
              disabled={isSaving}
              aria-label={t('core:action.save', {
                defaultValue: 'Save image',
                postProcess: 'capitalizeFirstChar',
              })}
              sx={{
                bgcolor: theme.palette.background.default,
                color: theme.palette.text.primary,
                '&:hover': { bgcolor: theme.palette.background.default },
              }}
            >
              {isSaving ? (
                <CircularProgress size={20} color="inherit" />
              ) : (
                <DownloadRoundedIcon />
              )}
            </IconButton>

            <IconButton
              onClick={handleCloseFullscreen}
              aria-label="close"
              sx={{
                bgcolor: theme.palette.background.default,
                color: theme.palette.text.primary,
                '&:hover': { bgcolor: theme.palette.background.default },
              }}
            >
              <CloseIcon />
            </IconButton>
          </Box>

          {/* Fullscreen, zoomable image */}
          <ZoomableImage src={src} alt={alt} />
        </Box>

        <Snackbar
          open={snack.open}
          autoHideDuration={3000}
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert
            severity={snack.type}
            variant="filled"
            onClose={() => setSnack((s) => ({ ...s, open: false }))}
          >
            {snack.message}
          </Alert>
        </Snackbar>
      </Dialog>
    </>
  );
}
