import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Box,
  CircularProgress,
  IconButton,
  Portal,
  Tooltip,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation, type TFunction } from 'react-i18next';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import PlayCircleOutlineRoundedIcon from '@mui/icons-material/PlayCircleOutlineRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import ShareRoundedIcon from '@mui/icons-material/ShareRounded';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded';
import { Capacitor } from '@capacitor/core';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../../utils/mobileSafeArea';
import { isGoLayout, useGoLayout, type GoLayout } from '../../layout/goLayout';
import {
  hasNativeClipboardImages,
  noteClipboardIssue,
  writeClipboardImage,
} from '../../utils/nativeClipboardImage';
import {
  cleanPastedImage,
  describeLastCleanFailure,
} from '../../utils/cleanPastedImage';
import { createNamedFile } from '../../utils/namedFile';
import {
  resolveChatMediaItem,
  type ChatMediaItem,
  type ResolvedChatMedia,
} from './chatMediaGallery';
import {
  AXIS_LOCK_PX,
  decideSwipe,
  dragOffset,
  sideRevealedBy,
  SLIDE_EASE,
  SLIDE_GAP_PX,
  SLIDE_MS,
  stepFor,
  type SwipeSide,
} from './mediaSwipe';

type ReticulumImageViewerProps = {
  alt?: string;
  containerElement: HTMLElement | null;
  fileName?: string;
  mimeType?: string;
  onClose: () => void;
  open: boolean;
  src: string;
  /**
   * The chat's pictures and videos, oldest first, and which one `src` is:
   * swiping moves through them. Without it only `src` is shown.
   */
  gallery?: { items: ChatMediaItem[]; index: number } | null;
};

type SlidePosition = SwipeSide | 'current';
type Resolution = ResolvedChatMedia | 'pending';
/** How many items past an unavailable one the viewer looks for the next. */
const NEIGHBOUR_SEARCH_LIMIT = 40;

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const ZOOM_STEP = 0.5;
const DOUBLE_TAP_MS = 300;
/** The fade out before the viewer goes, so closing doesn't snap. */
const CLOSE_MS = 170;
/** Height kept clear of the close button and the action bar on a phone. */
const CHROME_RESERVE_PX = 168;
/** GO on a short screen: a slimmer margin, since height is what it lacks. */
const SHORT_CHROME_RESERVE_PX = 96;

const selectShort = (layout: GoLayout) => layout.short;

/**
 * Height the full-screen viewer keeps clear of its buttons. On a short GO
 * window (phone landscape) the picture takes the whole height while the
 * buttons are hidden.
 */
export const fullScreenChromeReservePx = (
  goShort: boolean,
  controlsHidden: boolean
) =>
  goShort ? (controlsHidden ? 0 : SHORT_CHROME_RESERVE_PX) : CHROME_RESERVE_PX;
/**
 * Behind the picture the chat is blurred and dimmed, so the eye goes to the
 * picture; the extra darkening is the contrast that keeps a light photo from
 * melting into a light chat.
 */
const BACKDROP_FILTER = 'blur(22px) saturate(1.15) brightness(0.62)';

const prefersReducedMotion = () => {
  try {
    return Boolean(
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    );
  } catch {
    return false;
  }
};

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

const toClipboardPng = async (blob: Blob, t: TFunction) => {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error(
        t('reticulum:image_viewer.prepare_failed', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    context.drawImage(bitmap, 0, 0);
    const pngBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    if (!pngBlob)
      throw new Error(
        t('reticulum:image_viewer.prepare_failed', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    return pngBlob;
  } finally {
    bitmap.close();
  }
};

export const ReticulumImageViewer = ({
  alt,
  containerElement,
  fileName,
  mimeType,
  onClose,
  open,
  src,
  gallery = null,
}: ReticulumImageViewerProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'reticulum']);
  // Phones get the whole screen; the desktop keeps it inside the chat panel.
  const fullScreen = useMediaQuery(theme.breakpoints.down('md'));
  // Always false on the Hub.
  const goShort = useGoLayout(selectShort) && isGoLayout();
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const items = gallery && gallery.items.length > 0 ? gallery.items : null;
  const initialResolved = useCallback(
    (): Record<string, Resolution> =>
      items?.[gallery!.index]
        ? { [items[gallery!.index].key]: { status: 'ready', src } }
        : {},
    [gallery, src]
  );
  const [galleryIndex, setGalleryIndex] = useState(gallery?.index ?? 0);
  const [resolved, setResolved] =
    useState<Record<string, Resolution>>(initialResolved);
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;
  const currentItem = items?.[galleryIndex] ?? null;
  const currentResolution: Resolution | undefined = currentItem
    ? resolved[currentItem.key]
    : { status: 'ready', src };
  const currentSrc =
    currentResolution &&
    currentResolution !== 'pending' &&
    currentResolution.status === 'ready'
      ? currentResolution.src
      : '';
  const currentKind = currentItem?.kind ?? 'image';
  const currentFileName = currentItem ? currentItem.fileName : fileName;
  const currentMimeType = currentItem ? currentItem.mimeType : mimeType;
  const altText =
    alt ??
    t('reticulum:image_viewer.chat_image', {
      postProcess: 'capitalizeFirstChar',
    });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [actionStatus, setActionStatus] = useState('');
  const [bounds, setBounds] = useState<DOMRect | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const dragRef = useRef({
    startX: 0,
    startY: 0,
    panX: 0,
    panY: 0,
    moved: false,
  });
  const suppressClickRef = useRef(false);
  const pinchRef = useRef({ active: false, startDistance: 0, startZoom: 1 });
  const lastTapRef = useRef(0);
  // On a phone one tap shows or hides the buttons around the picture, so
  // only the picture is left; a double tap still zooms, so a tap waits that
  // long to be sure it is single.
  const [controlsHidden, setControlsHidden] = useState(false);
  const singleTapTimerRef = useRef<number | null>(null);
  const clearSingleTap = useCallback(() => {
    if (singleTapTimerRef.current !== null) {
      window.clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = null;
    }
  }, []);
  const toggleControls = useCallback(() => {
    clearSingleTap();
    setControlsHidden((hidden) => !hidden);
  }, [clearSingleTap]);
  useEffect(() => clearSingleTap, [clearSingleTap]);
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
      setClosing(false);
      setControlsHidden(false);
      setGalleryIndex(gallery?.index ?? 0);
      setResolved(initialResolved());
    }
  }, [gallery, initialResolved, open, resetView, src]);

  // Checks and loads in flight, so one is never asked for twice. A check
  // (is it on this device?) and a load (read it into a URL) are separate:
  // something being loaded is already known to be there, and can be swiped
  // to while it loads.
  const checksRef = useRef(new Map<string, Promise<ResolvedChatMedia>>());
  const loadsRef = useRef(new Map<string, Promise<ResolvedChatMedia>>());
  useEffect(() => {
    checksRef.current = new Map();
    loadsRef.current = new Map();
  }, [gallery]);

  // Finds out, around the one shown, which pictures and videos are on this
  // device: pictures next to it are loaded so a swipe shows them at once, a
  // video only once it is the one shown.
  useEffect(() => {
    if (!open || !items) return;
    let cancelled = false;
    const store = (key: string, value: Resolution) => {
      resolvedRef.current = { ...resolvedRef.current, [key]: value };
      setResolved((current) => ({ ...current, [key]: value }));
    };
    const check = (item: ChatMediaItem): Promise<ResolvedChatMedia> => {
      const known = resolvedRef.current[item.key];
      if (known && known !== 'pending') return Promise.resolve(known);
      let pending = checksRef.current.get(item.key);
      if (!pending) {
        store(item.key, 'pending');
        pending = resolveChatMediaItem(item, false).then((result) => {
          checksRef.current.delete(item.key);
          store(item.key, result);
          return result;
        });
        checksRef.current.set(item.key, pending);
      }
      return pending;
    };
    const load = (item: ChatMediaItem): Promise<ResolvedChatMedia> => {
      let pending = loadsRef.current.get(item.key);
      if (!pending) {
        pending = resolveChatMediaItem(item, true).then((result) => {
          loadsRef.current.delete(item.key);
          store(item.key, result);
          return result;
        });
        loadsRef.current.set(item.key, pending);
      }
      return pending;
    };
    const ensure = async (index: number, wantLoaded: boolean) => {
      const item = items[index];
      const known = await check(item);
      return wantLoaded && known.status === 'available' ? load(item) : known;
    };
    // The one shown loads alongside: a big video takes a while to read in,
    // and finding the next ones must not wait for that.
    void ensure(galleryIndex, true);
    void (async () => {
      for (const step of [1, -1]) {
        for (
          let index = galleryIndex + step, checked = 0;
          !cancelled &&
          index >= 0 &&
          index < items.length &&
          checked < NEIGHBOUR_SEARCH_LIMIT;
          index += step, checked += 1
        ) {
          const result = await ensure(index, items[index].kind === 'image');
          if (result.status !== 'missing') break;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [galleryIndex, items, open]);

  // The nearest one on this device in a direction (null: none, or not known
  // yet, which the effect above is finding out).
  const neighbourIndex = (step: number): number | null => {
    if (!items) return null;
    for (
      let index = galleryIndex + step;
      index >= 0 && index < items.length;
      index += step
    ) {
      const known = resolved[items[index].key];
      if (!known || known === 'pending') return null;
      if (known.status === 'missing') continue;
      return index;
    }
    return null;
  };
  const leftIndex = neighbourIndex(stepFor('left'));
  const rightIndex = neighbourIndex(stepFor('right'));
  const neighboursRef = useRef({ left: leftIndex, right: rightIndex });
  neighboursRef.current = { left: leftIndex, right: rightIndex };

  // Swiping. While the finger is down the slides are moved straight in the
  // DOM, not through React state, so nothing re-renders on every move.
  const trackRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<Record<SlidePosition, HTMLDivElement | null>>({
    left: null,
    current: null,
    right: null,
  });
  const swipeRef = useRef({
    tracking: false,
    axis: null as 'x' | 'y' | null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastT: 0,
    velocity: 0,
    moved: false,
  });
  const slidingRef = useRef(false);
  const slideTimerRef = useRef<number | null>(null);

  const slideSpan = () =>
    (trackRef.current?.clientWidth || window.innerWidth) + SLIDE_GAP_PX;

  // The track follows the finger; the slide going away shrinks and fades a
  // little while the one coming in grows to full size.
  const paintSlides = useCallback((dx: number, animate: boolean) => {
    const track = trackRef.current;
    if (!track) return;
    const transition = animate
      ? `transform ${SLIDE_MS}ms ${SLIDE_EASE}, opacity ${SLIDE_MS}ms ${SLIDE_EASE}`
      : 'none';
    track.style.transition = transition;
    track.style.transform = `translate3d(${dx}px, 0, 0)`;
    const progress = Math.min(1, Math.abs(dx) / slideSpan());
    const style = (position: SlidePosition, scale: number, opacity: number) => {
      const node = slideRefs.current[position];
      if (!node) return;
      node.style.transition = transition;
      node.style.transform = `scale(${scale})`;
      node.style.opacity = String(opacity);
    };
    style('current', 1 - 0.08 * progress, 1 - 0.4 * progress);
    const incoming = sideRevealedBy(dx);
    const other: SwipeSide = incoming === 'left' ? 'right' : 'left';
    style(incoming, 0.9 + 0.1 * progress, 0.45 + 0.55 * progress);
    style(other, 0.9, 0.45);
  }, []);

  // A new one shown: everything back in place before the screen updates, so
  // the slide that came in simply stays where it is.
  useLayoutEffect(() => {
    paintSlides(0, false);
    resetView();
  }, [galleryIndex, paintSlides, resetView]);

  useEffect(
    () => () => {
      if (slideTimerRef.current !== null) {
        window.clearTimeout(slideTimerRef.current);
      }
    },
    []
  );

  const slideTo = useCallback(
    (side: SwipeSide) => {
      const target =
        side === 'left'
          ? neighboursRef.current.left
          : neighboursRef.current.right;
      if (target === null || slidingRef.current) {
        paintSlides(0, true);
        return;
      }
      setContextMenuPosition(null);
      setActionStatus('');
      if (prefersReducedMotion()) {
        setGalleryIndex(target);
        return;
      }
      slidingRef.current = true;
      paintSlides(side === 'right' ? -slideSpan() : slideSpan(), true);
      slideTimerRef.current = window.setTimeout(() => {
        slideTimerRef.current = null;
        slidingRef.current = false;
        setGalleryIndex(target);
      }, SLIDE_MS);
    },
    [paintSlides]
  );

  const handleSwipeStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    swipe.tracking = false;
    swipe.moved = false;
    if (!items || slidingRef.current || zoom > MIN_ZOOM) return;
    if (event.touches.length !== 1 || pinchRef.current.active) return;
    const touch = event.touches[0];
    // A video's own controls (the seek bar) keep their drags.
    const video = (event.target as HTMLElement).closest?.('video');
    if (video && touch.clientY > video.getBoundingClientRect().bottom - 72) {
      return;
    }
    Object.assign(swipe, {
      tracking: true,
      axis: null,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastT: event.timeStamp,
      velocity: 0,
    });
  };

  const handleSwipeMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    if (!swipe.tracking) return;
    if (event.touches.length !== 1) {
      // A second finger: that is a pinch, not a swipe.
      swipe.tracking = false;
      if (swipe.axis === 'x') paintSlides(0, true);
      return;
    }
    const touch = event.touches[0];
    const dx = touch.clientX - swipe.startX;
    const dy = touch.clientY - swipe.startY;
    if (!swipe.axis) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      swipe.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (swipe.axis !== 'x') return;
    swipe.moved = true;
    const elapsed = event.timeStamp - swipe.lastT;
    if (elapsed > 0) {
      const instant = (touch.clientX - swipe.lastX) / elapsed;
      swipe.velocity = 0.75 * instant + 0.25 * swipe.velocity;
    }
    swipe.lastX = touch.clientX;
    swipe.lastT = event.timeStamp;
    const side = sideRevealedBy(dx);
    paintSlides(dragOffset(dx, neighboursRef.current[side] !== null), false);
  };

  const handleSwipeEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    if (!swipe.tracking) return;
    swipe.tracking = false;
    if (swipe.axis !== 'x') return;
    // A finger that stopped before lifting was not a flick.
    const velocity = event.timeStamp - swipe.lastT > 90 ? 0 : swipe.velocity;
    const side = decideSwipe({
      dx: swipe.lastX - swipe.startX,
      velocity,
      width: slideSpan(),
      hasLeft: neighboursRef.current.left !== null,
      hasRight: neighboursRef.current.right !== null,
    });
    if (side) slideTo(side);
    else paintSlides(0, true);
  };

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    []
  );

  // Fades out first, then tells the host.
  const requestClose = useCallback(() => {
    if (closeTimerRef.current !== null) return;
    setContextMenuPosition(null);
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, CLOSE_MS);
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open || !containerElement || fullScreen) {
      setBounds(null);
      return;
    }

    const updateBounds = () =>
      setBounds(containerElement.getBoundingClientRect());
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
  }, [containerElement, fullScreen, open]);

  useAndroidBack(
    () => {
      requestClose();
      return true;
    },
    { priority: BACK_PRIORITY.call, enabled: open }
  );

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
      // Left and right go to whichever one waits on that side.
      if (event.key === 'ArrowLeft') slideTo('left');
      if (event.key === 'ArrowRight') slideTo('right');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, requestClose, slideTo]);

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
      // The end of a swipe to the next one is not a tap.
      if (swipeRef.current.moved) {
        lastTapRef.current = 0;
        return;
      }
      const now = Date.now();
      if (now - lastTapRef.current < DOUBLE_TAP_MS) {
        lastTapRef.current = 0;
        clearSingleTap();
        if (zoom === MIN_ZOOM) updateZoom(2.5);
        else resetView();
      } else {
        lastTapRef.current = now;
        if (fullScreen) {
          clearSingleTap();
          singleTapTimerRef.current = window.setTimeout(() => {
            singleTapTimerRef.current = null;
            setControlsHidden((hidden) => !hidden);
          }, DOUBLE_TAP_MS);
        }
      }
    },
    [clearSingleTap, fullScreen, resetView, updateZoom, zoom]
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
    const response = await fetch(currentSrc);
    if (!response.ok)
      throw new Error(
        t('reticulum:image_viewer.read_failed', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    return response.blob();
  }, [currentSrc, t]);

  const handleCopy = useCallback(async () => {
    const copied = () =>
      setActionStatus(
        t('reticulum:image_viewer.copied', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    try {
      // The Android WebView can't put a picture on the clipboard: the app
      // does, so it pastes into the composer and into other apps alike.
      if (hasNativeClipboardImages()) {
        const blob = await getImageBlob();
        const originalType = blob.type || currentMimeType || 'image/png';
        // PNG is what keyboards (Gboard's clipboard bar) and other apps take
        // from the clipboard; chat pictures are mostly WebP. Drawing it anew
        // also leaves all metadata behind. A GIF stays a GIF, moving.
        let picture: Blob = blob;
        let type = originalType;
        if (originalType !== 'image/gif' && originalType !== 'image/png') {
          try {
            picture = await toClipboardPng(blob, t);
            type = 'image/png';
          } catch {
            /* the original, cleaned below, will do */
          }
        }
        // What goes on the clipboard carries no location or device data,
        // whoever's picture it is.
        const clean = await cleanPastedImage(
          // Not `new File`: cordova-plugin-file replaces it (namedFile.ts).
          createNamedFile(
            [picture],
            getDownloadFileName(currentFileName, type),
            {
              type,
            }
          )
        );
        if (!clean) {
          noteClipboardIssue(`copy refused: ${describeLastCleanFailure()}`);
          throw new Error('copy');
        }
        if (!(await writeClipboardImage(clean, clean.name))) {
          throw new Error('copy');
        }
        copied();
        return;
      }
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error(
          t('reticulum:image_viewer.clipboard_unavailable', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      const blob = await getImageBlob();
      const imageBlob = await toClipboardPng(blob, t);
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': imageBlob,
        }),
      ]);
      copied();
    } catch {
      setActionStatus(
        t('reticulum:image_viewer.copy_failed', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  }, [currentFileName, currentMimeType, getImageBlob, t]);

  const handleDownload = useCallback(async () => {
    try {
      const blob = await getImageBlob();
      // Anchor downloads are a no-op inside the Capacitor WebView, so on
      // Android the bytes go straight into the shared Documents folder.
      if (Capacitor.isNativePlatform()) {
        const name = getDownloadFileName(
          currentFileName,
          blob.type || currentMimeType
        );
        const { saveBlobToMobileDocuments, mobileSaveLocationLabelFor } =
          await import('../../utils/mobileFileSave');
        await saveBlobToMobileDocuments(name, blob);
        setActionStatus(
          t('reticulum:file_viewer.saved_to', {
            location: mobileSaveLocationLabelFor(
              name,
              blob.type || currentMimeType
            ),
            postProcess: 'capitalizeFirstChar',
          })
        );
        return;
      }
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = getDownloadFileName(
        currentFileName,
        blob.type || currentMimeType
      );
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    } catch {
      setActionStatus(
        t('reticulum:image_viewer.download_failed', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  }, [currentFileName, currentMimeType, getImageBlob, t]);

  const handleShare = useCallback(async () => {
    try {
      const blob = await getImageBlob();
      const name = getDownloadFileName(
        currentFileName,
        blob.type || currentMimeType
      );
      const { shareStagedMobileFile, stageMobileFileForSharing } =
        await import('../../utils/mobileFileShare');
      const uri = await stageMobileFileForSharing(currentSrc, name, blob);
      await shareStagedMobileFile(uri, name);
    } catch (error) {
      console.error('[ReticulumImageViewer] share failed:', error);
      setActionStatus(
        t('reticulum:image_viewer.share_failed', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  }, [currentFileName, currentMimeType, currentSrc, getImageBlob, t]);

  const white = theme.palette.common.white;
  const black = theme.palette.common.black;
  // Light icons on dark glass: readable over any picture and in both themes.
  const glassSx = {
    backdropFilter: 'blur(14px)',
    backgroundColor: alpha(black, 0.5),
    border: '1px solid',
    borderColor: alpha(white, 0.18),
    boxShadow: `0 6px 18px ${alpha(black, 0.4)}`,
    WebkitBackdropFilter: 'blur(14px)',
  };
  const controlSx = {
    ...glassSx,
    borderRadius: '12px',
    color: white,
    height: 40,
    transition: 'background-color 120ms ease, transform 120ms ease',
    width: 40,
    '& svg': {
      filter: `drop-shadow(0 1px 1px ${alpha(black, 0.5)})`,
      fontSize: 21,
    },
    '&:hover': {
      backgroundColor: alpha(black, 0.68),
      borderColor: alpha(white, 0.3),
    },
    '&:active': { transform: 'scale(0.92)' },
    '&.Mui-disabled': {
      backgroundColor: alpha(black, 0.32),
      color: alpha(white, 0.35),
    },
  };
  // On a phone: one glass bar of plain, finger-sized buttons.
  const barButtonSx = {
    borderRadius: '50%',
    color: white,
    height: 48,
    transition: 'background-color 120ms ease, transform 120ms ease',
    width: 48,
    '& svg': {
      filter: `drop-shadow(0 1px 1px ${alpha(black, 0.5)})`,
      fontSize: 25,
    },
    '&:active': {
      backgroundColor: alpha(white, 0.14),
      transform: 'scale(0.9)',
    },
    '&.Mui-disabled': { color: alpha(white, 0.32) },
  };
  const buttonSx = fullScreen ? barButtonSx : controlSx;
  const label = (key: string, defaultValue?: string) =>
    t(`reticulum:image_viewer.${key}`, {
      ...(defaultValue ? { defaultValue } : {}),
      postProcess: 'capitalizeFirstChar',
    });
  const saveLabel = Capacitor.isNativePlatform()
    ? label('save', 'Save Image')
    : label('download');

  if (!open || (!fullScreen && !bounds)) return null;

  const actionButton = (
    key: string,
    title: string,
    icon: ReactNode,
    onClick: () => void,
    disabled = false
  ) => (
    <Tooltip disableFocusListener key={key} title={title}>
      <span>
        <IconButton
          aria-label={title}
          disabled={disabled}
          onClick={onClick}
          sx={buttonSx}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );

  const isPicture = currentKind === 'image';
  const notLoaded = !currentSrc;
  const actions = [
    Capacitor.isNativePlatform() &&
      actionButton(
        'share',
        label('share'),
        <ShareRoundedIcon />,
        () => {
          void handleShare();
        },
        notLoaded
      ),
    actionButton(
      'save',
      saveLabel,
      <DownloadRoundedIcon />,
      () => {
        void handleDownload();
      },
      notLoaded
    ),
    // Copying, and the zoom buttons, are for pictures.
    isPicture &&
      actionButton(
        'copy',
        label('copy'),
        <ContentCopyRoundedIcon />,
        () => {
          void handleCopy();
        },
        notLoaded
      ),
    isPicture &&
      actionButton(
        'zoom_out',
        label('zoom_out'),
        <ZoomOutRoundedIcon />,
        () => updateZoom(zoom - ZOOM_STEP),
        zoom <= MIN_ZOOM
      ),
    isPicture &&
      actionButton(
        'zoom_in',
        label('zoom_in'),
        <ZoomInRoundedIcon />,
        () => updateZoom(zoom + ZOOM_STEP),
        zoom >= MAX_ZOOM || notLoaded
      ),
  ];

  // Sized to stay clear of the close button and the action bar on a phone.
  const mediaSizeSx = {
    maxHeight: fullScreen
      ? `calc(100% - ${SAFE_AREA_TOP} - ${SAFE_AREA_BOTTOM} - ${fullScreenChromeReservePx(
          goShort,
          controlsHidden
        )}px)`
      : 'calc(100% - 64px)',
    maxWidth: fullScreen ? 'calc(100% - 24px)' : 'calc(100% - 64px)',
    // Short GO screens: the picture eases into the room the buttons leave.
    ...(goShort && { transition: 'max-height 200ms ease' }),
  };
  const mediaSurfaceSx = {
    borderRadius: '6px',
    // Lifts the picture off the blurred chat.
    boxShadow: `0 20px 60px ${alpha(black, 0.6)}, 0 0 0 1px ${alpha(
      white,
      0.08
    )}`,
  };

  const slideContent = (index: number | null, position: SlidePosition) => {
    const item = items && index !== null ? items[index] : null;
    const known: Resolution | undefined = item
      ? resolved[item.key]
      : { status: 'ready', src };
    const slideSrc =
      known && known !== 'pending' && known.status === 'ready' ? known.src : '';
    const kind = item?.kind ?? 'image';
    const isCurrent = position === 'current';
    if (kind === 'video') {
      if (isCurrent && slideSrc) {
        return (
          <Box
            component="video"
            controls
            key={slideSrc}
            onClick={(event) => event.stopPropagation()}
            playsInline
            preload="metadata"
            src={slideSrc}
            sx={{
              ...mediaSizeSx,
              ...mediaSurfaceSx,
              backgroundColor: black,
            }}
          />
        );
      }
      // A video waiting at the side is only a card until it is shown.
      return (
        <Box
          onClick={(event) => event.stopPropagation()}
          sx={{
            ...glassSx,
            alignItems: 'center',
            borderRadius: '18px',
            color: white,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            maxWidth: 'calc(100% - 48px)',
            px: '28px',
            py: '26px',
          }}
        >
          {isCurrent && !slideSrc ? (
            <CircularProgress size={40} sx={{ color: white }} />
          ) : (
            <PlayCircleOutlineRoundedIcon sx={{ fontSize: 64 }} />
          )}
          <Box
            sx={{
              fontSize: '14px',
              maxWidth: '100%',
              opacity: 0.85,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item?.fileName || label('video')}
          </Box>
        </Box>
      );
    }
    if (!slideSrc) {
      return <CircularProgress size={40} sx={{ color: white }} />;
    }
    if (!isCurrent) {
      return (
        <Box
          alt={altText}
          component="img"
          draggable={false}
          src={slideSrc}
          sx={{
            ...mediaSizeSx,
            ...mediaSurfaceSx,
            objectFit: 'contain',
            userSelect: 'none',
          }}
        />
      );
    }
    return (
      <Box
        component="img"
        alt={altText}
        draggable={false}
        src={slideSrc}
        onClick={(event) => {
          event.stopPropagation();
          setContextMenuPosition(null);
          // Touch uses double-tap so a stray tap doesn't zoom the image.
          if (!isTouchDevice.current) handleToggleZoom();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const origin = fullScreen ? { left: 0, top: 0 } : bounds!;
          setContextMenuPosition({
            x: event.clientX - origin.left,
            y: event.clientY - origin.top,
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
          ...mediaSizeSx,
          ...mediaSurfaceSx,
          cursor:
            zoom > MIN_ZOOM ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
          objectFit: 'contain',
          touchAction: 'none',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center',
          transition: isDragging
            ? 'none'
            : goShort
              ? 'transform 150ms ease, max-height 200ms ease'
              : 'transform 150ms ease',
          userSelect: 'none',
        }}
      />
    );
  };

  const slide = (index: number | null, position: SlidePosition) => {
    if (position !== 'current' && index === null) return null;
    const offset =
      position === 'left'
        ? `calc(-100% - ${SLIDE_GAP_PX}px)`
        : position === 'right'
          ? `calc(100% + ${SLIDE_GAP_PX}px)`
          : '0px';
    return (
      <Box
        data-slide={position}
        key={items && index !== null ? items[index].key : 'single'}
        sx={{
          inset: 0,
          position: 'absolute',
          transform: `translateX(${offset})`,
        }}
      >
        <Box
          ref={(node: HTMLDivElement | null) => {
            slideRefs.current[position] = node;
          }}
          sx={{
            alignItems: 'center',
            display: 'flex',
            height: '100%',
            justifyContent: 'center',
            width: '100%',
          }}
        >
          {slideContent(index, position)}
        </Box>
      </Box>
    );
  };

  const arrowButton = (side: SwipeSide) => {
    const index = side === 'left' ? leftIndex : rightIndex;
    if (fullScreen || index === null) return null;
    const title = label(side === 'left' ? 'older' : 'newer');
    return (
      <IconButton
        aria-label={title}
        onClick={(event) => {
          event.stopPropagation();
          slideTo(side);
        }}
        sx={{
          ...controlSx,
          borderRadius: '50%',
          height: 46,
          [side]: 16,
          position: 'absolute',
          top: '50%',
          transform: 'translateY(-50%)',
          width: 46,
          zIndex: 1,
          '&:active': { transform: 'translateY(-50%) scale(0.92)' },
        }}
      >
        {side === 'left' ? (
          <ChevronLeftRoundedIcon />
        ) : (
          <ChevronRightRoundedIcon />
        )}
      </IconButton>
    );
  };

  const closeButton = (
    <Tooltip
      disableFocusListener
      title={t('core:action.close', {
        postProcess: 'capitalizeFirstChar',
      })}
    >
      <IconButton
        aria-label={label('close')}
        onClick={requestClose}
        sx={
          fullScreen
            ? {
                ...controlSx,
                borderRadius: '50%',
                height: 46,
                width: 46,
                '& svg': { ...controlSx['& svg'], fontSize: 26 },
              }
            : controlSx
        }
      >
        <CloseRoundedIcon />
      </IconButton>
    </Tooltip>
  );

  const reducedMotion = '@media (prefers-reduced-motion: reduce)';
  // The buttons and labels around the picture, faded out while hidden.
  const chromeSx = (shift: string) => ({
    opacity: controlsHidden ? 0 : 1,
    pointerEvents: controlsHidden ? ('none' as const) : ('auto' as const),
    transition: 'opacity 200ms ease, translate 200ms ease',
    translate: controlsHidden ? shift : '0 0',
    [reducedMotion]: { transition: 'none' },
  });

  return (
    <Portal>
      <Box
        data-controls-hidden={controlsHidden ? 'true' : undefined}
        data-reticulum-image-viewer="true"
        // A phone taps around the picture to show or hide the buttons (the
        // X and Android back close it); the desktop closes on a click there.
        onClick={fullScreen ? toggleControls : requestClose}
        sx={{
          alignItems: 'center',
          // Darker at the edges, so the picture in the middle stands out.
          backgroundColor: alpha(black, 0.5),
          backgroundImage: `radial-gradient(ellipse at center, ${alpha(
            black,
            0.05
          )} 0%, ${alpha(black, 0.45)} 100%)`,
          backdropFilter: BACKDROP_FILTER,
          display: 'flex',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'fixed',
          WebkitBackdropFilter: BACKDROP_FILTER,
          ...(fullScreen
            ? { inset: 0, zIndex: theme.zIndex.snackbar + 40 }
            : {
                height: bounds!.height,
                left: bounds!.left,
                top: bounds!.top,
                width: bounds!.width,
                zIndex: theme.zIndex.modal,
              }),
          // Without blur support the dimming alone has to carry it.
          '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))':
            { backgroundColor: alpha(black, 0.86) },
          '@keyframes reticulumViewerIn': {
            from: { opacity: 0 },
            to: { opacity: 1 },
          },
          '@keyframes reticulumViewerOut': {
            from: { opacity: 1 },
            to: { opacity: 0 },
          },
          animation: closing
            ? `reticulumViewerOut ${CLOSE_MS}ms ease-in forwards`
            : 'reticulumViewerIn 200ms ease-out both',
          [reducedMotion]: { animation: 'none' },
        }}
      >
        {fullScreen ? (
          <>
            <Box
              onClick={(event) => event.stopPropagation()}
              sx={{
                ...chromeSx('0 -12px'),
                left: 12,
                position: 'absolute',
                top: `calc(${SAFE_AREA_TOP} + 12px)`,
                zIndex: 1,
              }}
            >
              {closeButton}
            </Box>
            <Box
              aria-label={label('actions')}
              onClick={(event) => event.stopPropagation()}
              role="toolbar"
              sx={{
                ...glassSx,
                ...chromeSx('0 16px'),
                alignItems: 'center',
                borderRadius: '30px',
                bottom: `calc(${SAFE_AREA_BOTTOM} + 18px)`,
                display: 'flex',
                gap: '2px',
                left: '50%',
                maxWidth: 'calc(100% - 24px)',
                p: '5px',
                position: 'absolute',
                transform: 'translateX(-50%)',
                zIndex: 1,
                '@keyframes reticulumViewerBarIn': {
                  from: { opacity: 0, transform: 'translate(-50%, 14px)' },
                  to: { opacity: 1, transform: 'translate(-50%, 0)' },
                },
                animation:
                  // Backwards only: once in, opacity is the hide toggle's.
                  'reticulumViewerBarIn 260ms cubic-bezier(0.2, 0.8, 0.2, 1) 60ms backwards',
                [reducedMotion]: { animation: 'none' },
              }}
            >
              {actions}
            </Box>
          </>
        ) : (
          <Box
            aria-label={label('actions')}
            onClick={(event) => event.stopPropagation()}
            role="toolbar"
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: '8px',
              position: 'absolute',
              right: 18,
              top: 18,
              zIndex: 1,
            }}
          >
            {actions}
            {closeButton}
          </Box>
        )}

        {actionStatus && (
          <Box
            aria-live="polite"
            onClick={(event) => event.stopPropagation()}
            sx={{
              ...glassSx,
              ...chromeSx('0 12px'),
              borderRadius: '14px',
              color: white,
              fontSize: '13.5px',
              fontWeight: 500,
              maxWidth: 'calc(100% - 32px)',
              position: 'absolute',
              px: '14px',
              py: '8px',
              textAlign: 'center',
              zIndex: 1,
              ...(fullScreen
                ? {
                    bottom: `calc(${SAFE_AREA_BOTTOM} + 88px)`,
                    left: '50%',
                    transform: 'translateX(-50%)',
                  }
                : { bottom: 18, left: 18 }),
            }}
          >
            {actionStatus}
          </Box>
        )}

        {items && items.length > 1 && (
          <Box
            aria-hidden="true"
            sx={{
              ...glassSx,
              ...chromeSx('0 -12px'),
              borderRadius: '14px',
              color: white,
              fontSize: '13.5px',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 600,
              left: fullScreen ? '50%' : 18,
              position: 'absolute',
              px: '12px',
              py: '6px',
              top: fullScreen ? `calc(${SAFE_AREA_TOP} + 20px)` : 18,
              transform: fullScreen ? 'translateX(-50%)' : 'none',
              zIndex: 1,
            }}
          >
            {galleryIndex + 1} / {items.length}
          </Box>
        )}
        {arrowButton('left')}
        {arrowButton('right')}

        <Box
          sx={{
            height: '100%',
            overflow: 'hidden',
            position: 'relative',
            width: '100%',
            '@keyframes reticulumViewerImageIn': {
              from: { opacity: 0, transform: 'scale(0.92)' },
              to: { opacity: 1, transform: 'scale(1)' },
            },
            '@keyframes reticulumViewerImageOut': {
              from: { opacity: 1, transform: 'scale(1)' },
              to: { opacity: 0, transform: 'scale(0.95)' },
            },
            animation: closing
              ? `reticulumViewerImageOut ${CLOSE_MS}ms ease-in forwards`
              : 'reticulumViewerImageIn 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
            [reducedMotion]: { animation: 'none' },
          }}
        >
          <Box
            data-viewer-track="true"
            onTouchCancel={handleSwipeEnd}
            onTouchEnd={handleSwipeEnd}
            onTouchMove={handleSwipeMove}
            onTouchStart={handleSwipeStart}
            ref={trackRef}
            sx={{
              height: '100%',
              position: 'relative',
              touchAction: items ? 'none' : 'auto',
              width: '100%',
              willChange: 'transform',
            }}
          >
            {slide(leftIndex, 'left')}
            {slide(items ? galleryIndex : null, 'current')}
            {slide(rightIndex, 'right')}
          </Box>
        </Box>
        {contextMenuPosition && (
          <Box
            onClick={(event) => event.stopPropagation()}
            sx={{
              ...glassSx,
              backgroundColor: alpha(black, 0.78),
              borderRadius: '10px',
              left: contextMenuPosition.x,
              minWidth: 150,
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
                borderRadius: '6px',
                color: white,
                cursor: 'pointer',
                display: 'flex',
                font: 'inherit',
                fontSize: '13.5px',
                gap: 1,
                px: 1,
                py: 0.8,
                width: '100%',
                '&:hover': { backgroundColor: alpha(white, 0.1) },
              }}
            >
              <ContentCopyRoundedIcon sx={{ fontSize: 17 }} />
              {label('copy')}
            </Box>
          </Box>
        )}
      </Box>
    </Portal>
  );
};
