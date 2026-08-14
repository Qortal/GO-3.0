import { createContext, useContext, useEffect, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { Box, CircularProgress } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import {
  cancelLibraryGifRequest,
  rememberGifAspect,
  requestLibraryGifUrl,
} from './gifMediaCache';
import { libraryGifKey } from './libraryGifs';

export const GifViewportContext = createContext<Element | null>(null);

type GifImageProps = {
  alt?: string;
  /** Load immediately instead of waiting until the tile is on screen. */
  eager?: boolean;
  fit?: 'contain' | 'cover';
  /** Stretch to fill the parent instead of sizing to the GIF. */
  fill?: boolean;
  gif: { identifier: string; name: string };
  /** Width 100% and height from the GIF's own ratio — no crop. */
  natural?: boolean;
  onAspect?: (ratio: number) => void;
  spinnerSize?: number;
  sx?: SxProps<Theme>;
};

/**
 * Loads a QDN library GIF through a shared queue and cache so a search grid
 * cannot stampede the node. Hidden tiles wait until they scroll into view.
 */
export const GifImage = ({
  alt = '',
  eager = false,
  fit = 'cover',
  fill = false,
  gif,
  natural = false,
  onAspect,
  spinnerSize = 18,
  sx,
}: GifImageProps) => {
  const viewportRoot = useContext(GifViewportContext);
  const key = libraryGifKey(gif);
  const [src, setSrc] = useState('');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const { ref, inView } = useInView({
    root: viewportRoot ?? undefined,
    rootMargin: '180px 0px',
    skip: eager,
    threshold: 0,
  });
  const shouldLoad = eager || inView;

  useEffect(() => {
    setSrc('');
    setReady(false);
    setFailed(false);
  }, [key]);

  useEffect(() => {
    if (!shouldLoad) {
      cancelLibraryGifRequest(key);
      return;
    }
    let cancelled = false;
    requestLibraryGifUrl(gif, eager ? 12 : 4)
      .then((url) => {
        if (!cancelled && url) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      cancelLibraryGifRequest(key);
    };
  }, [eager, gif.identifier, gif.name, key, shouldLoad]);

  return (
    <Box
      ref={ref}
      sx={{
        alignItems: 'center',
        backgroundColor: 'action.hover',
        display: 'flex',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative',
        ...(natural
          ? { minHeight: ready ? 0 : 72, width: '100%' }
          : fill
            ? { height: '100%', width: '100%' }
            : {
                minHeight: ready ? 0 : 72,
                minWidth: ready ? 0 : 72,
              }),
        ...sx,
      }}
    >
      {!ready && (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            inset: 0,
            justifyContent: 'center',
            position: 'absolute',
            zIndex: 1,
          }}
        >
          {failed ? (
            <Box
              sx={{
                backgroundColor: 'action.selected',
                borderRadius: '6px',
                height: 18,
                opacity: 0.45,
                width: 28,
              }}
            />
          ) : (
            <CircularProgress size={spinnerSize} thickness={4} />
          )}
        </Box>
      )}
      {src ? (
        <Box
          alt={alt}
          component="img"
          decoding="async"
          onError={() => setFailed(true)}
          onLoad={(event) => {
            const img = event.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              rememberGifAspect(gif, img.naturalWidth, img.naturalHeight);
              onAspect?.(img.naturalWidth / img.naturalHeight);
            }
            setReady(true);
          }}
          src={src}
          sx={{
            display: 'block',
            ...(natural
              ? {
                  height: 'auto',
                  maxWidth: '100%',
                  objectFit: 'contain',
                  position: 'relative',
                  width: '100%',
                }
              : {
                  height: fill ? '100%' : 'auto',
                  maxHeight: fill ? '100%' : 'inherit',
                  maxWidth: '100%',
                  objectFit: fit,
                  position: fill ? 'absolute' : 'relative',
                  width: fill ? '100%' : 'auto',
                }),
            opacity: ready ? 1 : 0,
            transition: 'opacity 200ms ease',
            zIndex: 2,
          }}
        />
      ) : null}
    </Box>
  );
};
