import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, IconButton, Portal, Tooltip, useTheme } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded';
import { Capacitor } from '@capacitor/core';

type ReticulumImageViewerProps = {
  alt?: string;
  containerElement: HTMLElement | null;
  fileName?: string;
  mimeType?: string;
  onClose: () => void;
  open: boolean;
  src: string;
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const ZOOM_STEP = 0.5;
const DOUBLE_TAP_MS = 300;

const clampZoom = (value: number) =>
  Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));

const touchDistance = (touches: React.TouchList) => {
  const [a, b] = [touches[0], touches[1]];
  if (!a || !b) return 0;
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
};

const getDownloadFileName = (fileName?: string, mimeType?: string) => {
  if (fileName?.trim()) return fileName.trim();
  const extension =
    mimeType === 'image/jpeg'
      ? 'jpg'
      : mimeType === 'image/gif'
        ? 'gif'
        : mimeType === 'image/webp'
          ? 'webp'
          : 'png';
  return `image.${extension}`;
};

const toClipboardPng = async (blob: Blob) => {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to prepare image for clipboard');
    context.drawImage(bitmap, 0, 0);
    const pngBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    if (!pngBlob) throw new Error('Unable to prepare image for clipboard');
    return pngBlob;
  } finally {
    bitmap.close();
  }
};

export const ReticulumImageViewer = ({
  alt = 'Chat image',
  containerElement,
  fileName,
  mimeType,
  onClose,
  open,
  src,
}: ReticulumImageViewerProps) => {
  const theme = useTheme();
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [actionStatus, setActionStatus] = useState('');
  const [bounds, setBounds] = useState<DOMRect | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const dragRef = useRef({ startX: 0, startY: 0, panX: 0, panY: 0, moved: false });
  const suppressClickRef = useRef(false);
  const pinchRef = useRef({ active: false, startDistance: 0, startZoom: 1 });
  const lastTapRef = useRef(0);
  const isTouchDevice = useRef(
    typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(pointer: coarse)').matches)
  );

  const resetView = useCallback(() => {
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (open) {
      resetView();
      setActionStatus('');
      setContextMenuPosition(null);
    }
  }, [open, resetView, src]);

  useLayoutEffect(() => {
    if (!open || !containerElement) {
      setBounds(null);
      return;
    }

    const updateBounds = () => setBounds(containerElement.getBoundingClientRect());
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(containerElement);
    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateBounds);
      window.removeEventListener('scroll', updateBounds, true);
    };
  }, [containerElement, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  const updateZoom = useCallback((nextZoom: number) => {
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom)));
    if (nextZoom <= MIN_ZOOM) setPan({ x: 0, y: 0 });
  }, []);

  const handleToggleZoom = useCallback(() => {
    if (suppressClickRef.current) return;
    if (zoom === MIN_ZOOM) {
      updateZoom(2);
      return;
    }
    resetView();
  }, [resetView, updateZoom, zoom]);

  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLImageElement>) => {
      if (event.touches.length !== 2) return;
      pinchRef.current = {
        active: true,
        startDistance: touchDistance(event.touches),
        startZoom: zoom,
      };
      setIsDragging(false);
    },
    [zoom]
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLImageElement>) => {
      const pinch = pinchRef.current;
      if (!pinch.active || event.touches.length < 2 || !pinch.startDistance) {
        return;
      }
      const nextZoom = clampZoom(
        pinch.startZoom * (touchDistance(event.touches) / pinch.startDistance)
      );
      setZoom(nextZoom);
      if (nextZoom <= MIN_ZOOM) setPan({ x: 0, y: 0 });
    },
    []
  );

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLImageElement>) => {
      if (pinchRef.current.active) {
        if (event.touches.length < 2) {
          pinchRef.current.active = false;
          // The lifted fingers would otherwise land as a tap-to-zoom.
          suppressClickRef.current = true;
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 250);
          lastTapRef.current = 0;
        }
        return;
      }
      if (event.touches.length > 0 || dragRef.current.moved) return;
      const now = Date.now();
      if (now - lastTapRef.current < DOUBLE_TAP_MS) {
        lastTapRef.current = 0;
        if (zoom === MIN_ZOOM) updateZoom(2.5);
        else resetView();
      } else {
        lastTapRef.current = now;
      }
    },
    [resetView, updateZoom, zoom]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLImageElement>) => {
      if (pinchRef.current.active) return;
      if (zoom <= MIN_ZOOM) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        panX: pan.x,
        panY: pan.y,
        moved: false,
      };
      setIsDragging(true);
    },
    [pan.x, pan.y, zoom]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLImageElement>) => {
      if (!isDragging || pinchRef.current.active) return;
      const deltaX = event.clientX - dragRef.current.startX;
      const deltaY = event.clientY - dragRef.current.startY;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        dragRef.current.moved = true;
      }
      setPan({
        x: dragRef.current.panX + deltaX,
        y: dragRef.current.panY + deltaY,
      });
    },
    [isDragging]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLImageElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (dragRef.current.moved) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      setIsDragging(false);
    },
    []
  );

  const getImageBlob = useCallback(async () => {
    const response = await fetch(src);
    if (!response.ok) throw new Error('Unable to read image');
    return response.blob();
  }, [src]);

  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('Image clipboard is unavailable');
      }
      const blob = await getImageBlob();
      const imageBlob = await toClipboardPng(blob);
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': imageBlob,
        }),
      ]);
      setActionStatus('Image copied');
    } catch {
      setActionStatus('Unable to copy image');
    }
  }, [getImageBlob]);

  const handleDownload = useCallback(async () => {
    try {
      const blob = await getImageBlob();
      // Anchor downloads are a no-op inside the Capacitor WebView, so on
      // Android the bytes go straight into the shared Documents folder.
      if (Capacitor.isNativePlatform()) {
        const name = getDownloadFileName(fileName, blob.type || mimeType);
        const { saveBlobToMobileDocuments, mobileSaveLocationLabelFor } =
          await import('../../utils/mobileFileSave');
        await saveBlobToMobileDocuments(name, blob);
        setActionStatus(
          `Saved to ${mobileSaveLocationLabelFor(name, blob.type || mimeType)}`
        );
        return;
      }
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = getDownloadFileName(fileName, blob.type || mimeType);
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    } catch {
      setActionStatus('Unable to save image');
    }
  }, [fileName, getImageBlob, mimeType]);

  const controlSx = {
    backgroundColor: 'rgba(21, 24, 29, 0.92)',
    border: '1px solid',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: '7px',
    color: theme.palette.text.primary,
    height: 34,
    width: 34,
    '&:hover': {
      backgroundColor: 'rgba(42, 47, 57, 0.98)',
      borderColor: 'rgba(255, 255, 255, 0.2)',
    },
  };

  if (!open || !bounds) return null;

  return (
    <Portal>
      <Box
        onClick={() => {
          setContextMenuPosition(null);
          onClose();
        }}
        sx={{
          alignItems: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          height: bounds.height,
          justifyContent: 'center',
          left: bounds.left,
          overflow: 'hidden',
          position: 'fixed',
          top: bounds.top,
          width: bounds.width,
          zIndex: theme.zIndex.modal,
        }}
      >
        <Box
          aria-label="Image actions"
          onClick={(event) => event.stopPropagation()}
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '7px',
            position: 'absolute',
            right: 18,
            top: 18,
            zIndex: 1,
          }}
        >
          <Tooltip title="Copy Image" disableFocusListener>
            <IconButton aria-label="Copy image" onClick={() => void handleCopy()} sx={controlSx}>
              <ContentCopyRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Zoom Out" disableFocusListener>
            <span>
              <IconButton
                aria-label="Zoom out"
                disabled={zoom <= MIN_ZOOM}
                onClick={() => updateZoom(zoom - ZOOM_STEP)}
                sx={controlSx}
              >
                <ZoomOutRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Zoom In" disableFocusListener>
            <span>
              <IconButton
                aria-label="Zoom in"
                disabled={zoom >= MAX_ZOOM}
                onClick={() => updateZoom(zoom + ZOOM_STEP)}
                sx={controlSx}
              >
                <ZoomInRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip
            title={Capacitor.isNativePlatform() ? 'Save Image' : 'Download Image'}
            disableFocusListener
          >
            <IconButton
              aria-label="Save image"
              onClick={() => void handleDownload()}
              sx={controlSx}
            >
              <DownloadRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Close" disableFocusListener>
            <IconButton aria-label="Close image viewer" onClick={onClose} sx={controlSx}>
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        <Box
          aria-live="polite"
          sx={{
            bottom: 18,
            color: theme.palette.text.secondary,
            fontSize: '12px',
            left: 18,
            minHeight: '18px',
            position: 'absolute',
          }}
        >
          {actionStatus}
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            height: '100%',
            justifyContent: 'center',
            overflow: 'hidden',
            width: '100%',
          }}
        >
          <Box
            component="img"
            alt={alt}
            draggable={false}
            src={src}
            onClick={(event) => {
              event.stopPropagation();
              setContextMenuPosition(null);
              // Touch uses double-tap so a stray tap doesn't zoom the image.
              if (!isTouchDevice.current) handleToggleZoom();
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenuPosition({
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
              });
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            sx={{
              cursor: zoom > MIN_ZOOM ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
              maxHeight: 'calc(100% - 64px)',
              maxWidth: 'calc(100% - 64px)',
              objectFit: 'contain',
              touchAction: 'none',
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center',
              transition: isDragging ? 'none' : 'transform 150ms ease',
              userSelect: 'none',
            }}
          />
        </Box>
        {contextMenuPosition && (
          <Box
            onClick={(event) => event.stopPropagation()}
            sx={{
              backgroundColor: '#15181d',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '6px',
              boxShadow: '0 8px 22px rgba(0, 0, 0, 0.38)',
              left: contextMenuPosition.x,
              minWidth: 132,
              p: 0.5,
              position: 'absolute',
              top: contextMenuPosition.y,
              zIndex: 2,
            }}
          >
            <Box
              component="button"
              onClick={() => {
                void handleCopy();
                setContextMenuPosition(null);
              }}
              sx={{
                alignItems: 'center',
                background: 'transparent',
                border: 0,
                borderRadius: '4px',
                color: theme.palette.text.primary,
                cursor: 'pointer',
                display: 'flex',
                font: 'inherit',
                fontSize: '13px',
                gap: 1,
                px: 1,
                py: 0.7,
                width: '100%',
                '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.07)' },
              }}
            >
              <ContentCopyRoundedIcon sx={{ fontSize: 17 }} />
              Copy Image
            </Box>
          </Box>
        )}
      </Box>
    </Portal>
  );
};
