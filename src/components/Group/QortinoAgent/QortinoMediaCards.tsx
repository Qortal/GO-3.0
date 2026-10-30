import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../../../utils/mobileSafeArea';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { QORTAL_APP_CONTEXT } from '../../../App';
import { executeEvent } from '../../../utils/events';
import {
  blobLooksLikePdf,
  buildMediaThumbUrl,
  fetchQdnImageObjectUrl,
  fetchQtubePosterDataUrl,
  formatMediaBytes,
  formatMediaDate,
  isSafeQortinoImageSrc,
  waitForQdnResourceReady,
  type QdnMediaItem,
} from '../../../qortinoAgent/qdnMedia';
import { saveQdnMediaToDevice } from '../../../qortinoAgent/qortinoMediaActions';
import {
  formatShelfShareText,
  saveMediaShelf,
} from '../../../qortinoAgent/qdnMediaShelf';
import { stopSharedEarbumpPlayback } from '../earbumpSharedAudio';
import { QortinoVideoPlayer } from './QortinoVideoPlayer';
import { QortinoAudioPlayer } from './QortinoAudioPlayer';
import { QortinoNameAction } from './QortinoNameAction';
import { QortinoZoomableImage } from './QortinoZoomableImage';

type Props = {
  items: QdnMediaItem[];
  /** Image-heavy topic browse uses a 2-column grid */
  layout?: 'grid' | 'list';
  onSearchUser?: (name: string) => void;
};

function kindLabel(kind: QdnMediaItem['kind']): string {
  switch (kind) {
    case 'video':
      return 'Video';
    case 'audio':
      return 'Music';
    case 'image':
      return 'Image';
    case 'pdf':
      return 'PDF';
    default:
      return 'File';
  }
}

function kindColor(kind: QdnMediaItem['kind']): string {
  switch (kind) {
    case 'video':
      return '#EF4444';
    case 'audio':
      return '#F97316';
    case 'image':
      return '#22D3EE';
    case 'pdf':
      return '#EAB308';
    default:
      return '#84CC16';
  }
}

export function QortinoMediaCards({ items, layout, onSearchUser }: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const useGrid =
    layout === 'grid' ||
    (layout !== 'list' &&
      items.length >= 4 &&
      items.filter((i) => i.kind === 'image').length >=
        Math.ceil(items.length * 0.6));
  const { downloadResource } = useContext(QORTAL_APP_CONTEXT);
  const [playingVideo, setPlayingVideo] = useState<QdnMediaItem | null>(null);
  const [playingAudio, setPlayingAudio] = useState<QdnMediaItem | null>(null);
  const [lightbox, setLightbox] = useState<QdnMediaItem | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxProgress, setLightboxProgress] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [imageActionBusy, setImageActionBusy] = useState<string | null>(null);
  const [imageToast, setImageToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enriched, setEnriched] = useState<QdnMediaItem[]>(items);
  const [shelfHint, setShelfHint] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const thumbQueued = useRef<Set<string>>(new Set());
  const thumbInflight = useRef(0);
  const blobUrlsRef = useRef<Set<string>>(new Set());

  const trackBlobUrl = (url: string | undefined) => {
    if (url?.startsWith('blob:')) blobUrlsRef.current.add(url);
  };

  const revokeBlobUrl = (url: string | undefined) => {
    if (url?.startsWith('blob:') && blobUrlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      blobUrlsRef.current.delete(url);
    }
  };

  useEffect(() => {
    setEnriched(items);
    thumbQueued.current.clear();
  }, [items]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      for (const url of blobUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      blobUrlsRef.current.clear();
      stopSharedEarbumpPlayback();
    };
  }, []);

  const keyOf = (item: QdnMediaItem) =>
    `${item.service}:${item.name}:${item.identifier}`;

  // Lazy thumbs: load posters/images as cards enter the viewport (concurrency 2).
  // Documents get no automatic thumbnail: rendering page 1 meant downloading
  // and parsing an untrusted PDF from a search result with no tap. A tap
  // still opens it in the PDF viewer.
  useEffect(() => {
    let cancelled = false;
    const queue: QdnMediaItem[] = [];

    const setThumb = (key: string, thumbnailUrl: string | undefined) => {
      if (cancelled) return;
      setEnriched((prev) =>
        prev.map((row) => {
          if (keyOf(row) !== key) return row;
          if (row.thumbnailUrl && row.thumbnailUrl !== thumbnailUrl) {
            revokeBlobUrl(row.thumbnailUrl);
          }
          if (thumbnailUrl?.startsWith('blob:')) trackBlobUrl(thumbnailUrl);
          return { ...row, thumbnailUrl };
        })
      );
    };

    const loadOne = async (item: QdnMediaItem) => {
      const key = keyOf(item);
      if (thumbQueued.current.has(key)) return;
      thumbQueued.current.add(key);
      thumbInflight.current += 1;
      try {
        if (item.kind === 'image') {
          // Blob object URL — direct node <img> src is unreliable for IMAGE on mobile.
          try {
            const objectUrl = await fetchQdnImageObjectUrl(item, {
              downloadResource,
              timeoutMs: 45_000,
            });
            if (cancelled) {
              URL.revokeObjectURL(objectUrl);
              return;
            }
            setThumb(key, objectUrl);
          } catch {
            // Soft fallback: async URL (may still work for small images).
            if (!cancelled) setThumb(key, buildMediaThumbUrl(item, true));
          }
        } else if (item.kind === 'video') {
          const poster = await fetchQtubePosterDataUrl(
            item.name,
            item.identifier,
            {
              downloadResource,
              timeoutMs: 20_000,
            }
          );
          if (poster) {
            setThumb(key, poster);
          } else {
            // Soft fallback: try IMAGE sibling / async video poster if node serves one
            setThumb(key, buildMediaThumbUrl(item, true));
          }
        }
      } finally {
        thumbInflight.current -= 1;
        pump();
      }
    };

    const pump = () => {
      while (thumbInflight.current < 2 && queue.length) {
        const next = queue.shift();
        if (next) void loadOne(next);
      }
    };

    const enqueue = (item: QdnMediaItem) => {
      if (item.thumbnailUrl) return;
      if (item.kind !== 'image' && item.kind !== 'video') return;
      const key = keyOf(item);
      if (thumbQueued.current.has(key)) return;
      if (queue.some((q) => keyOf(q) === key)) return;
      queue.push(item);
      pump();
    };

    // Eagerly warm the first few visible cards.
    items.slice(0, useGrid ? 6 : 4).forEach(enqueue);

    if (typeof IntersectionObserver === 'undefined') {
      items.forEach(enqueue);
      return () => {
        cancelled = true;
      };
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const key = (entry.target as HTMLElement).dataset.mediaKey;
          if (!key) continue;
          const item = items.find((i) => keyOf(i) === key);
          if (item) enqueue(item);
        }
      },
      { rootMargin: '160px', threshold: 0.01 }
    );

    // Refs attach after paint — observe on the next tick.
    const timer = window.setTimeout(() => {
      cardRefs.current.forEach((el) => io.observe(el));
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      io.disconnect();
    };
  }, [downloadResource, items, useGrid]);

  const list = useMemo(() => enriched.filter(Boolean), [enriched]);
  if (!list.length) return null;

  const handleSaveShelf = () => {
    const shelf = saveMediaShelf(list);
    if (!shelf) return;
    setShelfHint('Shelf saved — ask “show my saved shelves” anytime');
    window.setTimeout(() => setShelfHint(null), 2200);
  };

  const handleCopyLinks = async () => {
    const text = formatShelfShareText({
      title: `QDN media · ${list.length} item${list.length === 1 ? '' : 's'}`,
      items: list,
    });
    try {
      await navigator.clipboard.writeText(text);
      setShelfHint('qortal:// links copied');
    } catch {
      setShelfHint('Copy failed');
    }
    window.setTimeout(() => setShelfHint(null), 1800);
  };

  const beginWork = (item: QdnMediaItem) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setBusyKey(keyOf(item));
    setProgressLabel('Fetching from QDN…');
    return controller;
  };

  const endWork = () => {
    setBusyKey(null);
    setProgressLabel(null);
  };

  const openImage = async (item: QdnMediaItem) => {
    const controller = beginWork(item);
    setLightbox(item);
    // Prefer an already-fetched blob thumb while the full image loads.
    setLightboxUrl(
      item.thumbnailUrl?.startsWith('blob:') ||
        item.thumbnailUrl?.startsWith('data:')
        ? item.thumbnailUrl
        : null
    );
    setLightboxProgress(0);
    setImageToast(null);
    try {
      const objectUrl = await fetchQdnImageObjectUrl(item, {
        downloadResource,
        timeoutMs: 90_000,
        signal: controller.signal,
        onProgress: (percent, status) => {
          setLightboxProgress(percent);
          setProgressLabel(
            percent > 0
              ? `Downloading image… ${percent}%`
              : status
                ? `Preparing image… (${status})`
                : 'Preparing image…'
          );
        },
      });
      if (controller.signal.aborted) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      trackBlobUrl(objectUrl);
      setLightboxUrl(objectUrl);
      setEnriched((prev) =>
        prev.map((row) => {
          if (row.identifier !== item.identifier || row.name !== item.name) {
            return row;
          }
          if (row.thumbnailUrl && row.thumbnailUrl !== objectUrl) {
            revokeBlobUrl(row.thumbnailUrl);
          }
          return { ...row, thumbnailUrl: objectUrl };
        })
      );
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'Could not load image');
      setLightbox(null);
      setLightboxUrl(null);
    } finally {
      if (!controller.signal.aborted) endWork();
    }
  };

  const closeAudio = () => {
    stopSharedEarbumpPlayback();
    setPlayingAudio(null);
  };

  const openPdfOrFile = async (item: QdnMediaItem) => {
    const controller = beginWork(item);
    try {
      const { url } = await waitForQdnResourceReady(item, {
        downloadResource,
        timeoutMs: 120_000,
        signal: controller.signal,
        onProgress: (percent, status) => {
          setProgressLabel(
            percent > 0
              ? `Downloading file… ${percent}%`
              : status
                ? `Preparing file… (${status})`
                : 'Preparing file…'
          );
        },
      });
      if (controller.signal.aborted) return;

      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const namedPdf =
        item.kind === 'pdf' ||
        blob.type.includes('pdf') ||
        /\.pdf(\b|$)/i.test(item.title) ||
        /\.pdf$/i.test(item.identifier);
      // Most DOCUMENT PDFs have no .pdf cue and come back as a generic type:
      // their first bytes say so (no extra download).
      const looksPdf = namedPdf || (await blobLooksLikePdf(blob));
      if (controller.signal.aborted) return;
      if (looksPdf && item.kind === 'file') {
        const key = keyOf(item);
        setEnriched((prev) =>
          prev.map((row) =>
            keyOf(row) === key && row.kind === 'file'
              ? { ...row, kind: 'pdf' }
              : row
          )
        );
      }
      if (looksPdf) {
        const pdfBlob =
          blob.type === 'application/pdf'
            ? blob
            : new Blob([blob], { type: 'application/pdf' });
        executeEvent('openPdf', {
          blob: pdfBlob,
          title: item.title || item.identifier || 'Document',
          saveItem: {
            name: item.name,
            service: item.service,
            identifier: item.identifier,
            kind: 'pdf',
            title: item.title || item.identifier || 'Document',
          },
        });
      } else {
        window.open(url, '_blank', 'noopener');
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'Could not open file');
    } finally {
      if (!controller.signal.aborted) endWork();
    }
  };

  const saveLightbox = async () => {
    if (!lightbox) return;
    setImageToast(null);
    setImageActionBusy('Saving…');
    try {
      const result = await saveQdnMediaToDevice(lightbox, {
        downloadResource,
        onProgress: setImageActionBusy,
      });
      setImageToast(result.message);
    } catch (e) {
      setImageToast(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setImageActionBusy(null);
    }
  };

  const onCardActivate = (item: QdnMediaItem) => {
    if (item.kind === 'video') {
      setPlayingVideo(item);
      return;
    }
    if (item.kind === 'audio') {
      setPlayingAudio(item);
      return;
    }
    if (item.kind === 'image') {
      void openImage(item);
      return;
    }
    void openPdfOrFile(item);
  };

  const matchedVideo =
    playingVideo &&
    (enriched.find(
      (i) =>
        i.identifier === playingVideo.identifier && i.name === playingVideo.name
    ) ||
      playingVideo);
  // The player shows `thumbnailUrl` as its poster: the same rule as the cards.
  const resolvedVideo =
    matchedVideo?.thumbnailUrl &&
    !isSafeQortinoImageSrc(matchedVideo.thumbnailUrl)
      ? { ...matchedVideo, thumbnailUrl: undefined }
      : matchedVideo;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.85, mt: 1.1 }}>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.55,
          justifyContent: 'space-between',
        }}
      >
        <Typography
          sx={{
            color: alpha(theme.palette.text.primary, 0.55),
            fontSize: '0.72rem',
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          QDN media · tap to {useGrid ? 'open' : 'play'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.45 }}>
          <Box
            component="button"
            type="button"
            onClick={handleSaveShelf}
            sx={{
              appearance: 'none',
              background: alpha('#7EB6FF', isDark ? 0.18 : 0.12),
              border: `1px solid ${alpha('#7EB6FF', 0.4)}`,
              borderRadius: '8px',
              color: isDark ? '#D6E8FF' : '#1A4A8A',
              cursor: 'pointer',
              fontSize: '0.66rem',
              fontWeight: 700,
              px: 0.75,
              py: 0.3,
            }}
          >
            Save shelf
          </Box>
          <Box
            component="button"
            type="button"
            onClick={() => void handleCopyLinks()}
            sx={{
              appearance: 'none',
              background: alpha('#7EB6FF', isDark ? 0.18 : 0.12),
              border: `1px solid ${alpha('#7EB6FF', 0.4)}`,
              borderRadius: '8px',
              color: isDark ? '#D6E8FF' : '#1A4A8A',
              cursor: 'pointer',
              fontSize: '0.66rem',
              fontWeight: 700,
              px: 0.75,
              py: 0.3,
            }}
          >
            Copy links
          </Box>
        </Box>
      </Box>
      {shelfHint ? (
        <Typography sx={{ color: alpha('#7EB6FF', 0.95), fontSize: '0.7rem' }}>
          {shelfHint}
        </Typography>
      ) : null}
      <Box
        sx={{
          display: 'grid',
          gap: useGrid ? 0.7 : 0.75,
          gridTemplateColumns: useGrid ? '1fr 1fr' : '1fr',
        }}
      >
        {list.map((item) => {
          const accent = kindColor(item.kind);
          // Only GO, data:/blob: and Qortal node images: never a third party.
          const thumbSrc = isSafeQortinoImageSrc(item.thumbnailUrl)
            ? item.thumbnailUrl
            : undefined;
          const busy = busyKey === keyOf(item);
          const when = formatMediaDate(item.updated || item.created);
          const size = formatMediaBytes(item.size);
          if (useGrid) {
            return (
              <Box
                key={keyOf(item)}
                data-media-key={keyOf(item)}
                ref={(el: HTMLElement | null) => {
                  if (el) cardRefs.current.set(keyOf(item), el);
                  else cardRefs.current.delete(keyOf(item));
                }}
                sx={{
                  background: alpha(
                    theme.palette.common.black,
                    isDark ? 0.28 : 0.04
                  ),
                  border: `1px solid ${alpha(accent, 0.35)}`,
                  borderRadius: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  width: '100%',
                }}
              >
                <Box
                  component="button"
                  type="button"
                  onClick={() => onCardActivate(item)}
                  sx={{
                    alignItems: 'center',
                    appearance: 'none',
                    aspectRatio: '1 / 1',
                    background: `linear-gradient(145deg, ${alpha(accent, 0.45)}, ${alpha(accent, 0.12)})`,
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    p: 0,
                    position: 'relative',
                    width: '100%',
                  }}
                >
                  {thumbSrc &&
                  (item.kind === 'video' ||
                    item.kind === 'image' ||
                    item.kind === 'pdf' ||
                    item.kind === 'file') ? (
                    <Box
                      component="img"
                      alt=""
                      src={thumbSrc}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      decoding="async"
                      onError={() => {
                        setEnriched((prev) =>
                          prev.map((row) =>
                            keyOf(row) === keyOf(item)
                              ? { ...row, thumbnailUrl: undefined }
                              : row
                          )
                        );
                        thumbQueued.current.delete(keyOf(item));
                      }}
                      sx={{
                        height: '100%',
                        left: 0,
                        objectFit: 'cover',
                        position: 'absolute',
                        top: 0,
                        width: '100%',
                      }}
                    />
                  ) : null}
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      justifyContent: 'center',
                      position: 'relative',
                      zIndex: 1,
                    }}
                  >
                    {busy ? (
                      <CircularProgress size={22} sx={{ color: '#fff' }} />
                    ) : item.kind === 'video' || item.kind === 'audio' ? (
                      <PlayArrowRoundedIcon
                        sx={{ color: '#fff', fontSize: 34 }}
                      />
                    ) : (item.kind === 'pdf' || item.kind === 'file') &&
                      !thumbSrc ? (
                      item.kind === 'pdf' ? (
                        <PictureAsPdfRoundedIcon
                          sx={{ color: '#fff', fontSize: 30 }}
                        />
                      ) : (
                        <InsertDriveFileRoundedIcon
                          sx={{ color: '#fff', fontSize: 30 }}
                        />
                      )
                    ) : item.kind === 'image' && !thumbSrc ? (
                      <CircularProgress
                        size={18}
                        sx={{ color: '#fff', opacity: 0.85 }}
                      />
                    ) : null}
                  </Box>
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.2,
                    p: 0.65,
                  }}
                >
                  <Box
                    component="button"
                    type="button"
                    onClick={() => onCardActivate(item)}
                    sx={{
                      appearance: 'none',
                      background: 'transparent',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                      p: 0,
                      textAlign: 'left',
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        lineHeight: 1.25,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {item.title}
                    </Typography>
                  </Box>
                  {onSearchUser ? (
                    <QortinoNameAction
                      name={item.name}
                      fontSize="0.66rem"
                      fontWeight={700}
                      onSearchUser={onSearchUser}
                    />
                  ) : (
                    <Typography
                      sx={{
                        color: alpha(theme.palette.text.primary, 0.5),
                        fontSize: '0.66rem',
                      }}
                    >
                      by {item.name}
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          }
          return (
            <Box
              key={keyOf(item)}
              data-media-key={keyOf(item)}
              ref={(el: HTMLElement | null) => {
                if (el) cardRefs.current.set(keyOf(item), el);
                else cardRefs.current.delete(keyOf(item));
              }}
              sx={{
                background: alpha(
                  theme.palette.common.black,
                  isDark ? 0.28 : 0.04
                ),
                border: `1px solid ${alpha(accent, 0.35)}`,
                borderRadius: '12px',
                display: 'flex',
                gap: 0.9,
                overflow: 'hidden',
                p: 0.7,
                width: '100%',
              }}
            >
              <Box
                component="button"
                type="button"
                onClick={() => onCardActivate(item)}
                sx={{
                  alignItems: 'center',
                  appearance: 'none',
                  background: `linear-gradient(145deg, ${alpha(accent, 0.45)}, ${alpha(accent, 0.12)})`,
                  border: 'none',
                  borderRadius: '9px',
                  color: 'inherit',
                  cursor: 'pointer',
                  display: 'flex',
                  flexShrink: 0,
                  height: 64,
                  justifyContent: 'center',
                  overflow: 'hidden',
                  p: 0,
                  position: 'relative',
                  width: 96,
                }}
              >
                {thumbSrc &&
                (item.kind === 'video' ||
                  item.kind === 'image' ||
                  item.kind === 'pdf' ||
                  item.kind === 'file') ? (
                  <Box
                    component="img"
                    alt=""
                    src={thumbSrc}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                    onError={() => {
                      setEnriched((prev) =>
                        prev.map((row) =>
                          keyOf(row) === keyOf(item)
                            ? { ...row, thumbnailUrl: undefined }
                            : row
                        )
                      );
                      thumbQueued.current.delete(keyOf(item));
                    }}
                    sx={{
                      height: '100%',
                      left: 0,
                      objectFit: 'cover',
                      position: 'absolute',
                      top: 0,
                      width: '100%',
                    }}
                  />
                ) : null}
                <Box sx={{ position: 'relative', zIndex: 1 }}>
                  {busy ? (
                    <CircularProgress size={22} sx={{ color: '#fff' }} />
                  ) : item.kind === 'video' || item.kind === 'audio' ? (
                    <PlayArrowRoundedIcon
                      sx={{ color: '#fff', fontSize: 30 }}
                    />
                  ) : (item.kind === 'pdf' || item.kind === 'file') &&
                    !thumbSrc ? (
                    item.kind === 'pdf' ? (
                      <PictureAsPdfRoundedIcon
                        sx={{ color: '#fff', fontSize: 28 }}
                      />
                    ) : (
                      <InsertDriveFileRoundedIcon
                        sx={{ color: '#fff', fontSize: 28 }}
                      />
                    )
                  ) : item.kind === 'image' && !thumbSrc ? (
                    <CircularProgress
                      size={16}
                      sx={{ color: '#fff', opacity: 0.85 }}
                    />
                  ) : null}
                </Box>
              </Box>
              <Box sx={{ minWidth: 0, py: 0.2 }}>
                <Box
                  component="button"
                  type="button"
                  onClick={() => onCardActivate(item)}
                  sx={{
                    appearance: 'none',
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    display: 'block',
                    p: 0,
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      background: alpha(accent, isDark ? 0.22 : 0.16),
                      borderRadius: '999px',
                      color: isDark ? '#fff' : '#222',
                      display: 'inline-block',
                      fontSize: '0.62rem',
                      fontWeight: 800,
                      letterSpacing: '0.04em',
                      px: 0.65,
                      py: 0.1,
                      textTransform: 'uppercase',
                    }}
                  >
                    {kindLabel(item.kind)}
                  </Box>
                  <Typography
                    sx={{
                      fontSize: '0.86rem',
                      fontWeight: 700,
                      lineHeight: 1.3,
                      mt: 0.35,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {item.title}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    alignItems: 'center',
                    color: alpha(theme.palette.text.primary, 0.55),
                    display: 'flex',
                    flexWrap: 'wrap',
                    fontSize: '0.7rem',
                    gap: 0.35,
                    mt: 0.2,
                  }}
                >
                  {busy && progressLabel && busyKey === keyOf(item) ? (
                    <Typography sx={{ fontSize: '0.7rem' }}>
                      {progressLabel}
                    </Typography>
                  ) : (
                    <>
                      <Box component="span">by</Box>
                      {onSearchUser ? (
                        <QortinoNameAction
                          name={item.name}
                          fontSize="0.7rem"
                          fontWeight={700}
                          onSearchUser={onSearchUser}
                        />
                      ) : (
                        <Box component="span">{item.name}</Box>
                      )}
                      {when ? <Box component="span">· {when}</Box> : null}
                      {size ? <Box component="span">· {size}</Box> : null}
                    </>
                  )}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
      {error ? (
        <Typography
          sx={{ color: theme.palette.error.main, fontSize: '0.75rem' }}
        >
          {error}
        </Typography>
      ) : null}

      <Dialog
        fullScreen
        open={!!playingVideo}
        onClose={() => setPlayingVideo(null)}
        PaperProps={{ sx: { background: '#07090d' } }}
      >
        {resolvedVideo ? (
          <QortinoVideoPlayer
            item={resolvedVideo}
            onClose={() => setPlayingVideo(null)}
          />
        ) : null}
      </Dialog>

      <Dialog
        fullScreen
        open={!!playingAudio}
        onClose={closeAudio}
        PaperProps={{ sx: { background: '#0b0c10' } }}
      >
        {playingAudio ? (
          <QortinoAudioPlayer item={playingAudio} onClose={closeAudio} />
        ) : null}
      </Dialog>

      <Dialog
        fullScreen
        open={!!lightbox}
        onClose={() => {
          abortRef.current?.abort();
          setLightbox(null);
          setLightboxUrl(null);
          endWork();
        }}
        PaperProps={{
          sx: {
            background:
              'radial-gradient(120% 80% at 50% 0%, #12303a 0%, #0c1116 50%, #080a0d 100%)',
          },
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: 1,
            justifyContent: 'space-between',
            px: 1.25,
            pt: `calc(${SAFE_AREA_TOP} + 8px)`,
            pb: 1.25,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              sx={{
                color: '#fff',
                fontWeight: 800,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {lightbox?.title}
            </Typography>
            {lightbox ? (
              <Typography
                sx={{ color: alpha('#fff', 0.55), fontSize: '0.72rem' }}
              >
                {[
                  `by ${lightbox.name}`,
                  formatMediaDate(lightbox.updated || lightbox.created),
                  formatMediaBytes(lightbox.size),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography>
            ) : null}
          </Box>
          <IconButton
            aria-label="Close image"
            onClick={() => {
              abortRef.current?.abort();
              setLightbox(null);
              setLightboxUrl(null);
              endWork();
            }}
            sx={{ color: '#fff' }}
          >
            <CloseRoundedIcon />
          </IconButton>
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            justifyContent: 'center',
            minHeight: 0,
            px: 1.5,
          }}
        >
          {lightboxUrl ? (
            <>
              <Box
                sx={{
                  border: `1px solid ${alpha('#22D3EE', 0.28)}`,
                  borderRadius: '16px',
                  boxShadow: `0 18px 48px ${alpha('#000', 0.45)}`,
                  flex: 1,
                  maxHeight: 'min(78vh, 820px)',
                  minHeight: 220,
                  overflow: 'hidden',
                  width: '100%',
                }}
              >
                <QortinoZoomableImage
                  src={lightboxUrl}
                  alt={lightbox?.title || 'image'}
                />
              </Box>
              <Typography
                sx={{
                  color: alpha('#fff', 0.45),
                  fontSize: '0.68rem',
                  mt: 0.75,
                  textAlign: 'center',
                }}
              >
                Pinch or double-tap to zoom · drag to pan
              </Typography>
            </>
          ) : (
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                minHeight: 180,
                justifyContent: 'center',
              }}
            >
              <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                <CircularProgress
                  variant={
                    lightboxProgress > 0 ? 'determinate' : 'indeterminate'
                  }
                  value={lightboxProgress}
                  size={64}
                  sx={{ color: '#22D3EE' }}
                />
                {lightboxProgress > 0 ? (
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      inset: 0,
                      justifyContent: 'center',
                      position: 'absolute',
                    }}
                  >
                    <Typography
                      sx={{
                        color: '#fff',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                      }}
                    >
                      {lightboxProgress}%
                    </Typography>
                  </Box>
                ) : null}
              </Box>
              <Typography
                sx={{ color: alpha('#fff', 0.65), fontSize: '0.8rem' }}
              >
                {progressLabel || 'Fetching image from QDN…'}
              </Typography>
            </Box>
          )}
        </Box>

        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
            px: 1.5,
            pt: 1.5,
            pb: `max(16px, ${SAFE_AREA_BOTTOM})`,
          }}
        >
          <Button
            variant="contained"
            startIcon={
              imageActionBusy ? (
                <CircularProgress size={16} sx={{ color: '#062026' }} />
              ) : (
                <DownloadRoundedIcon />
              )
            }
            disabled={!lightboxUrl || !!imageActionBusy}
            onClick={() => void saveLightbox()}
            sx={{
              background: '#22D3EE',
              borderRadius: '12px',
              color: '#062026',
              fontWeight: 800,
              textTransform: 'none',
              '&:hover': { background: '#67e8f9' },
            }}
          >
            Save to device
          </Button>
          {imageActionBusy ? (
            <Typography
              sx={{
                color: alpha('#fff', 0.65),
                fontSize: '0.75rem',
                textAlign: 'center',
              }}
            >
              {imageActionBusy}
            </Typography>
          ) : null}
          {imageToast ? (
            <Typography
              sx={{
                color: '#C9E8D4',
                fontSize: '0.75rem',
                textAlign: 'center',
              }}
            >
              {imageToast}
            </Typography>
          ) : null}
        </Box>
      </Dialog>
    </Box>
  );
}
