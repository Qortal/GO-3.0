import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
  Typography,
  useTheme,
} from '@mui/material';
import { Capacitor } from '@capacitor/core';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ContrastRoundedIcon from '@mui/icons-material/ContrastRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import ShareRoundedIcon from '@mui/icons-material/ShareRounded';
import { useTranslation } from 'react-i18next';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';
import { BACK_PRIORITY, useAndroidBack } from '../utils/androidBack';
import { appHeighOffsetPx } from '../components/Desktop/CustomTitleBar';
import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../utils/mobileSafeArea';
import {
  loadPdfJs,
  type PdfJsLib,
} from '../qortinoAgent/pdfJsLoader';
import { saveQdnMediaToDevice } from '../qortinoAgent/qortinoMediaActions';
import {
  mobileSaveLocationLabelFor,
  saveBlobToMobileDocuments,
} from '../utils/mobileFileSave';
import { saveFileToDiskGeneric } from '../utils/generateWallet/generateWallet';
import { normalizeFilename } from '../utils/downloadFromLocation';
import {
  QortinoZoomableBox,
  ZOOMABLE_BOX_LIMITS,
  type QortinoZoomableBoxControl,
} from '../components/Group/QortinoAgent/QortinoZoomableBox';
import {
  applySmartDark,
  pageImageRects,
  type PixelRect,
} from '../utils/pdfSmartDark';
import { getGoLayout, isGoLayout, subscribeGoLayout } from '../layout/goLayout';
import {
  computePdfFit,
  computePdfRenderScale,
  pdfFitBoost,
  pdfFitChanged,
  pdfWidthFit,
  pdfZoomLimits,
} from './pdfFit';

type OpenPdfDetail = {
  blob?: Blob;
  title?: string;
  /** Optional QDN location so Save can stream from the node. */
  saveItem?: {
    name: string;
    service: string;
    identifier: string;
    kind?: 'pdf' | 'file';
    title?: string;
  };
  /**
   * Identifies the file so Share and "Open with" reuse one cached copy.
   * Without one, each opened PDF gets its own.
   */
  shareKey?: string;
};

let pdfOpenSequence = 0;

/**
 * How a page is shown: as printed on a light frame, as printed on a dark
 * frame, or with text pages turned dark and photos kept (pdfSmartDark).
 */
type PageLook = 'light' | 'dim' | 'smart';
const PAGE_LOOKS: PageLook[] = ['light', 'dim', 'smart'];
const PAGE_LOOK_KEY = 'go-pdf-reader-page-look';

/** The look picked earlier, or null to follow the app theme. */
function readPageLook(): PageLook | null {
  try {
    const saved = localStorage.getItem(PAGE_LOOK_KEY);
    if (PAGE_LOOKS.includes(saved as PageLook)) return saved as PageLook;
  } catch {
    // Storage blocked: follow the theme.
  }
  return null;
}

function savePageLook(look: PageLook) {
  try {
    localStorage.setItem(PAGE_LOOK_KEY, look);
  } catch {
    // Only a convenience.
  }
}

/** GO re-fits the page once the page area has stopped resizing this long. */
const REFIT_DEBOUNCE_MS = 150;

/** Width of the box the page is centred in. */
const fitBoxWidth = (canvas: HTMLCanvasElement) =>
  Math.min(
    canvas.parentElement?.parentElement?.clientWidth ||
      canvas.parentElement?.clientWidth ||
      window.innerWidth,
    window.innerWidth
  );

/** A page's fit, measured from the page area as it is now. */
type MeasuredFit = {
  fit: number;
  /** Width of the box the page is centred in. */
  W: number;
  widthFit: number;
  renderScale: number;
  /** The whole page is fitted (GO landscape), not just its width. */
  contain: boolean;
};

const measureFit = (
  canvas: HTMLCanvasElement,
  area: HTMLElement | null,
  pageW: number,
  pageH: number
): MeasuredFit => {
  const go = isGoLayout();
  const input = {
    W: fitBoxWidth(canvas),
    H: area?.clientHeight ?? 0,
    pageW,
    pageH,
    go,
    landscape: go && getGoLayout().landscape,
  };
  return {
    fit: computePdfFit(input),
    W: input.W,
    widthFit: pdfWidthFit(input.W, pageW),
    renderScale: computePdfRenderScale(input),
    contain: input.landscape,
  };
};

/** The page on screen, its fit, and what that was measured from. */
type DrawnFit = {
  page: number;
  fit: number;
  W: number;
  pageW: number;
  pageH: number;
};

/** How the zoom box treats the shown page (see pdfZoomLimits). */
type ZoomFit = { boost: number; contain: boolean };
const WIDTH_ZOOM_FIT: ZoomFit = { boost: 1, contain: false };

/** The zoom box's view of `m`; the same object while nothing changes. */
const nextZoomFit =
  (m: MeasuredFit) =>
  (prev: ZoomFit): ZoomFit => {
    const boost = pdfFitBoost(m.fit, m.widthFit);
    return prev.boost === boost && prev.contain === m.contain
      ? prev
      : { boost, contain: m.contain };
  };

/**
 * Sizes the canvas for `m` and returns what it now shows. With `prevFit`
 * (the same page in the same window), a zoomed-in page keeps its size on
 * screen.
 */
const showFit = (
  canvas: HTMLCanvasElement,
  zoom: QortinoZoomableBoxControl | null,
  page: number,
  pageW: number,
  pageH: number,
  m: MeasuredFit,
  prevFit: number | null
): DrawnFit => {
  canvas.style.width = `${pageW * m.fit}px`;
  canvas.style.height = `${pageH * m.fit}px`;
  if (prevFit && pdfFitChanged(prevFit, m.fit, pageW, pageH)) {
    zoom?.contentResized(m.fit / prevFit);
  }
  return { page, fit: m.fit, W: m.W, pageW, pageH };
};

/**
 * In-app PDF book reader (page-by-page). Uses bundled pdf.js so Android
 * WebView does not need iframe + blob URL (unreliable on Capacitor).
 * Supports pinch/double-tap zoom and save-to-device.
 */
export const PdfViewer = () => {
  const { t } = useTranslation(['core', 'reticulum']);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('Document');
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [handingOff, setHandingOff] = useState(false);
  const [shareKey, setShareKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [zoomTick, setZoomTick] = useState(0);
  const [zoomFit, setZoomFit] = useState<ZoomFit>(WIDTH_ZOOM_FIT);
  const isDarkTheme = useTheme().palette.mode === 'dark';
  const [pickedLook, setPickedLook] = useState<PageLook | null>(readPageLook);
  // Until one is picked: Dim on the dark theme, Light on the light one.
  const pageLook: PageLook = pickedLook ?? (isDarkTheme ? 'dim' : 'light');
  const [lookMenu, setLookMenu] = useState<HTMLElement | null>(null);
  // Full screen: a tap on the page hides the bars, another brings them back.
  const [chromeHidden, setChromeHidden] = useState(false);
  const pageLookRef = useRef(pageLook);
  pageLookRef.current = pageLook;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageAreaRef = useRef<HTMLDivElement | null>(null);
  const drawnFitRef = useRef<DrawnFit | null>(null);
  /** The width the newest bitmap is drawn, or being drawn, for. */
  const renderWRef = useRef(0);
  const zoomControlRef = useRef<QortinoZoomableBoxControl | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const saveItemRef = useRef<OpenPdfDetail['saveItem']>(null);
  const docRef = useRef<Awaited<
    ReturnType<PdfJsLib['getDocument']>['promise']
  > | null>(null);
  const pdfjsRef = useRef<PdfJsLib | null>(null);
  const renderGen = useRef(0);

  const close = useCallback(() => {
    renderGen.current += 1;
    docRef.current = null;
    drawnFitRef.current = null;
    blobRef.current = null;
    saveItemRef.current = null;
    turnGateRef.current = null;
    turnDrawnRef.current?.();
    turnDrawnRef.current = null;
    setOpen(false);
    setTitle('Document');
    setPage(1);
    setPageCount(0);
    setError(null);
    setLoading(false);
    setSaving(false);
    setHandingOff(false);
    setShareKey(null);
    setToast(null);
    setZoomTick(0);
    setZoomFit(WIDTH_ZOOM_FIT);
    setLookMenu(null);
    setChromeHidden(false);
  }, []);

  useAndroidBack(
    () => {
      close();
      return true;
    },
    { priority: BACK_PRIORITY.call, enabled: open }
  );

  // pdf.js rejects a render() on a canvas that is still drawing, and opening
  // a document asks for page 1 twice (the load path and the page effect), so
  // renders run one after another and a superseded one is skipped.
  const renderChainRef = useRef<Promise<void>>(Promise.resolve());
  // A swipe turn: the new page waits for the old one to slide out
  // (turnGate), then says it is drawn so it can slide in (turnDrawn).
  const turnGateRef = useRef<Promise<void> | null>(null);
  const turnDrawnRef = useRef<(() => void) | null>(null);

  const renderPage = useCallback((pageNum: number) => {
    const gen = ++renderGen.current;
    const run = async () => {
      let redraw = false;
      const doc = docRef.current;
      const canvas = canvasRef.current;
      if (!doc || !canvas || gen !== renderGen.current) return;
      try {
        const pdfPage = await doc.getPage(pageNum);
        if (gen !== renderGen.current) return;
        const unscaled = pdfPage.getViewport({ scale: 1 });
        // A landscape GO window fits the whole page; otherwise the width.
        const measured = measureFit(
          canvas,
          pageAreaRef.current,
          unscaled.width,
          unscaled.height
        );
        renderWRef.current = measured.W;
        const scale = measured.renderScale;
        const viewport = pdfPage.getViewport({ scale });
        // Drawn off screen first, so a dark page never flashes white.
        const scratch = document.createElement('canvas');
        scratch.width = Math.floor(viewport.width);
        scratch.height = Math.floor(viewport.height);
        const scratchCtx = scratch.getContext('2d', {
          alpha: false,
          willReadFrequently: true,
        });
        if (!scratchCtx) return;
        await pdfPage.render({ canvasContext: scratchCtx, viewport }).promise;
        if (gen !== renderGen.current) return;
        if (pageLookRef.current === 'smart') {
          let pictures: PixelRect[] = [];
          const ops = pdfjsRef.current?.OPS;
          if (ops && pdfPage.getOperatorList) {
            try {
              pictures = pageImageRects(
                await pdfPage.getOperatorList(),
                ops,
                viewport.transform,
                scratch.width,
                scratch.height
              );
            } catch {
              // Without picture boxes the whole page is judged as paper.
            }
          }
          if (gen !== renderGen.current) return;
          const image = scratchCtx.getImageData(
            0,
            0,
            scratch.width,
            scratch.height
          );
          applySmartDark(image.data, scratch.width, scratch.height, pictures);
          scratchCtx.putImageData(image, 0, 0);
        }
        if (turnGateRef.current) {
          await turnGateRef.current;
          turnGateRef.current = null;
          if (gen !== renderGen.current) return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = scratch.width;
        canvas.height = scratch.height;
        // Display at fit; CSS zoom handles pinch. GO measures again: the
        // window may have turned, or the bars moved, while the page drew.
        const go = isGoLayout();
        const shown = go
          ? measureFit(
              canvas,
              pageAreaRef.current,
              unscaled.width,
              unscaled.height
            )
          : measured;
        const prev = drawnFitRef.current;
        drawnFitRef.current = showFit(
          canvas,
          zoomControlRef.current,
          pageNum,
          unscaled.width,
          unscaled.height,
          shown,
          prev?.page === pageNum && Math.abs(prev.W - shown.W) <= 1
            ? prev.fit
            : null
        );
        setZoomFit(nextZoomFit(shown));
        ctx.drawImage(scratch, 0, 0);
        scratch.width = 0;
        scratch.height = 0;
        // Drawn for another width: shown now, drawn again sharp after.
        redraw = go && Math.abs(shown.W - measured.W) > 1;
      } catch (e) {
        if (gen !== renderGen.current) return;
        setError(e instanceof Error ? e.message : 'Could not render page');
      } finally {
        if (gen === renderGen.current) {
          turnDrawnRef.current?.();
          turnDrawnRef.current = null;
          if (redraw) void renderPage(pageNum);
        }
      }
    };
    renderChainRef.current = renderChainRef.current.then(run, run);
    return renderChainRef.current;
  }, []);

  const openPdf = useCallback(
    async (e: Event) => {
      const detail = (e as CustomEvent<OpenPdfDetail>).detail;
      const blob = detail?.blob;
      if (!blob) return;
      blobRef.current = blob;
      saveItemRef.current = detail?.saveItem || null;
      setShareKey(detail?.shareKey || `pdf-viewer:${++pdfOpenSequence}`);
      setOpen(true);
      setLoading(true);
      setError(null);
      setToast(null);
      setTitle(
        (detail?.title || 'Document').replace(/\s+/g, ' ').trim() || 'Document'
      );
      setPage(1);
      setPageCount(0);
      setZoomTick((t) => t + 1);
      try {
        if (!pdfjsRef.current) {
          pdfjsRef.current = await loadPdfJs();
        }
        const data = await blob.arrayBuffer();
        // A received PDF is untrusted: no font code compiled from it.
        const doc = await pdfjsRef.current.getDocument({
          data,
          isEvalSupported: false,
        }).promise;
        docRef.current = doc;
        setPageCount(doc.numPages || 1);
        setLoading(false);
        window.requestAnimationFrame(() => {
          void renderPage(1);
        });
      } catch (err) {
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Could not open PDF');
      }
    },
    [renderPage]
  );

  useEffect(() => {
    subscribeToEvent('openPdf', openPdf);
    return () => {
      unsubscribeFromEvent('openPdf', openPdf);
    };
  }, [openPdf]);

  useEffect(() => {
    if (!open || !pageCount || loading) return;
    setZoomTick((t) => t + 1);
    void renderPage(page);
  }, [open, page, pageCount, loading, renderPage]);

  // A new look redraws the page in place, keeping the zoom.
  const lookRendered = useRef(pageLook);
  useEffect(() => {
    if (lookRendered.current === pageLook) return;
    lookRendered.current = pageLook;
    if (!open || !pageCount || loading) return;
    void renderPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageLook]);

  const pageRef = useRef(page);
  pageRef.current = page;
  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;

  // GO: rotation, split screen and the bars sliding away resize the page
  // area, and the window's orientation can settle a moment later (goLayout
  // holds it mid-rotation). Once both settle the page takes its new size at
  // once. A new width (the window changed) starts again at fit and draws a
  // sharp bitmap for it; a new height (the bars) only changes the shown
  // size, and a zoomed-in page keeps its size on screen. In portrait the
  // width decides, so nothing changes.
  useEffect(() => {
    if (!open || loading || error || !isGoLayout()) return;
    const area = pageAreaRef.current;
    if (!area || typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refit = () => {
      timer = null;
      const drawn = drawnFitRef.current;
      const canvas = canvasRef.current;
      // Nothing shown yet: the render in flight measures again as it draws.
      if (!drawn || !canvas) return;
      const next = measureFit(canvas, area, drawn.pageW, drawn.pageH);
      const resized = pdfFitChanged(
        drawn.fit,
        next.fit,
        drawn.pageW,
        drawn.pageH
      );
      // Against the newest render, so one already drawing for this width
      // is not started again.
      const redraw = Math.abs(next.W - renderWRef.current) > 1;
      if (!resized && !redraw) return;
      const newWindow = Math.abs(next.W - drawn.W) > 1;
      drawnFitRef.current = showFit(
        canvas,
        zoomControlRef.current,
        drawn.page,
        drawn.pageW,
        drawn.pageH,
        next,
        newWindow ? null : drawn.fit
      );
      setZoomFit(nextZoomFit(next));
      if (newWindow) setZoomTick((t) => t + 1);
      if (redraw) void renderPage(pageRef.current);
    };
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(refit, REFIT_DEBOUNCE_MS);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(area);
    const unsubscribe = subscribeGoLayout(schedule);
    return () => {
      observer.disconnect();
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [open, loading, error, renderPage]);

  const canTurn = (direction: 'next' | 'prev') =>
    direction === 'next'
      ? pageRef.current < pageCountRef.current
      : pageRef.current > 1;

  const turnBySwipe = (direction: 'next' | 'prev', slidOut: Promise<void>) => {
    if (!canTurn(direction)) return undefined;
    turnGateRef.current = slidOut;
    const drawn = new Promise<void>((resolve) => {
      turnDrawnRef.current = resolve;
    });
    setPage((p) =>
      direction === 'next'
        ? Math.min(pageCountRef.current || 1, p + 1)
        : Math.max(1, p - 1)
    );
    return drawn;
  };

  const chooseLook = (look: PageLook) => {
    setLookMenu(null);
    setPickedLook(look);
    savePageLook(look);
  };

  const pdfFileName = () =>
    normalizeFilename(
      title.toLowerCase().endsWith('.pdf') ? title : `${title}.pdf`
    );

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setToast(null);
    try {
      const saveItem = saveItemRef.current;
      if (saveItem?.name && saveItem.service && saveItem.identifier) {
        const result = await saveQdnMediaToDevice({
          kind: saveItem.kind || 'pdf',
          name: saveItem.name,
          service: saveItem.service,
          identifier: saveItem.identifier,
          title: saveItem.title || title,
        });
        setToast(result.message);
        return;
      }
      const blob = blobRef.current;
      if (!blob) throw new Error('Nothing to save');
      const filename = pdfFileName();
      if (Capacitor.isNativePlatform()) {
        await saveBlobToMobileDocuments(filename, blob);
        setToast(
          `Saved to ${mobileSaveLocationLabelFor(filename, blob.type)}/${filename}`
        );
      } else {
        await saveFileToDiskGeneric(blob, filename);
        setToast(`Downloaded ${filename}`);
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleHandOff = async (action: 'share' | 'open') => {
    const blob = blobRef.current;
    if (handingOff || !blob || !shareKey) return;
    setHandingOff(true);
    setToast(null);
    try {
      const {
        openStagedMobileFileWith,
        shareStagedMobileFile,
        stageMobileFileForSharing,
      } = await import('../utils/mobileFileShare');
      const filename = pdfFileName();
      const uri = await stageMobileFileForSharing(shareKey, filename, blob);
      if (action === 'share') {
        await shareStagedMobileFile(uri, filename);
      } else {
        await openStagedMobileFileWith(uri, filename, 'application/pdf');
      }
    } catch (err) {
      console.error(`[PdfViewer] ${action} failed:`, err);
      setToast(
        t(
          action === 'share'
            ? 'reticulum:file_viewer.share_failed'
            : 'reticulum:file_viewer.open_with_failed',
          { postProcess: 'capitalizeFirstChar' }
        )
      );
    } finally {
      setHandingOff(false);
    }
  };

  const canHandOff = !!shareKey && Capacitor.isNativePlatform();
  const zoomLimits = pdfZoomLimits(zoomFit.boost, ZOOMABLE_BOX_LIMITS);

  if (!open) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 990000000,
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        // The desktop title bar offset does not exist on phones, where it
        // left a strip for the tab bar to show through under the controls.
        ...(Capacitor.isNativePlatform()
          ? { bottom: 0 }
          : { height: `calc(100vh - ${appHeighOffsetPx})` }),
        boxSizing: 'border-box',
        backgroundColor: '#12141a',
        color: '#f2f4f8',
        paddingTop: SAFE_AREA_TOP,
        paddingBottom: SAFE_AREA_BOTTOM,
      }}
    >
      <Collapse in={!chromeHidden} sx={{ flexShrink: 0 }}>
      <Box
        sx={{
          alignItems: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
          display: 'flex',
          gap: 0.5,
          minHeight: 52,
          px: 1,
          py: 0.75,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: '0.72rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              opacity: 0.65,
              textTransform: 'uppercase',
            }}
          >
            Book reader
          </Typography>
          <Typography noWrap sx={{ fontSize: '0.95rem', fontWeight: 700 }}>
            {title}
          </Typography>
        </Box>
        <IconButton
          aria-label={t('core:pdf_reader.page_look')}
          aria-haspopup="menu"
          disabled={loading || !!error}
          onClick={(event) => setLookMenu(event.currentTarget)}
          sx={{ color: '#f2f4f8' }}
        >
          <ContrastRoundedIcon />
        </IconButton>
        {canHandOff ? (
          <>
            <IconButton
              aria-label={t('reticulum:file_viewer.share', {
                postProcess: 'capitalizeFirstChar',
              })}
              disabled={loading || handingOff || !!error}
              onClick={() => void handleHandOff('share')}
              sx={{ color: '#f2f4f8' }}
            >
              <ShareRoundedIcon />
            </IconButton>
            <IconButton
              aria-label={t('reticulum:file_viewer.open_with', {
                postProcess: 'capitalizeFirstChar',
              })}
              disabled={loading || handingOff || !!error}
              onClick={() => void handleHandOff('open')}
              sx={{ color: '#f2f4f8' }}
            >
              <OpenInNewRoundedIcon />
            </IconButton>
          </>
        ) : null}
        <IconButton
          aria-label={t('core:file_transfer.save_to_device')}
          disabled={loading || saving || !!error}
          onClick={() => void handleSave()}
          sx={{ color: '#f2f4f8' }}
        >
          {saving ? (
            <CircularProgress size={20} sx={{ color: '#f2f4f8' }} />
          ) : (
            <DownloadRoundedIcon />
          )}
        </IconButton>
        <IconButton
          aria-label="Close reader"
          onClick={close}
          sx={{ color: '#f2f4f8' }}
        >
          <CloseRoundedIcon />
        </IconButton>
      </Box>
      </Collapse>

      <Box
        ref={pageAreaRef}
        sx={{
          alignItems: 'center',
          display: 'flex',
          flex: 1,
          justifyContent: 'center',
          minHeight: 0,
          overflow: 'hidden',
          px: 0.5,
          py: 0.75,
          backgroundColor: pageLook === 'light' ? '#dfe3e8' : 'transparent',
          transition: 'background-color 0.2s ease',
        }}
      >
        {loading ? (
          <Typography sx={{ opacity: 0.75 }}>Opening book…</Typography>
        ) : error ? (
          <Box sx={{ maxWidth: 360, textAlign: 'center' }}>
            <Typography sx={{ mb: 1.5 }}>{error}</Typography>
            <Button variant="contained" onClick={close}>
              Close
            </Button>
          </Box>
        ) : (
          <QortinoZoomableBox
            controlRef={zoomControlRef}
            resetKey={`${page}-${zoomTick}`}
            maxZoom={zoomLimits.maxZoom}
            doubleTapScale={zoomLimits.doubleTapScale}
            clampToContent={zoomFit.contain}
            onSingleTap={() => {
              setLookMenu(null);
              setChromeHidden((hidden) => !hidden);
            }}
            canSwipe={canTurn}
            onSwipe={turnBySwipe}
          >
            <canvas
              ref={canvasRef}
              style={{
                // Smart pages are darkened to rgb(20, 20, 20) paper.
                background: pageLook === 'smart' ? '#141414' : '#fff',
                borderRadius: 8,
                boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
                display: 'block',
                maxWidth: '100%',
              }}
            />
          </QortinoZoomableBox>
        )}
      </Box>

      <Collapse in={!chromeHidden} sx={{ flexShrink: 0 }}>
      {!loading && !error ? (
        <Typography
          sx={{
            flexShrink: 0,
            fontSize: '0.68rem',
            opacity: 0.55,
            px: 1.5,
            pb: 0.35,
            textAlign: 'center',
          }}
        >
          {t(
            pageCount > 1
              ? 'core:pdf_reader.gesture_hint_pages'
              : 'core:pdf_reader.gesture_hint'
          )}
        </Typography>
      ) : null}

      <Box
        sx={{
          alignItems: 'center',
          borderTop: '1px solid rgba(255,255,255,0.12)',
          display: 'flex',
          gap: 0.5,
          justifyContent: 'space-between',
          px: 1,
          py: 1,
        }}
      >
        <Button
          disabled={loading || page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          startIcon={<ChevronLeftRoundedIcon />}
          sx={{ color: '#f2f4f8', minWidth: 0, px: 1, textTransform: 'none' }}
        >
          Prev
        </Button>
        <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, px: 0.5 }}>
          {pageCount ? `${page} / ${pageCount}` : '—'}
        </Typography>
        <Button
          disabled={loading || !pageCount || page >= pageCount}
          endIcon={<ChevronRightRoundedIcon />}
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          sx={{ color: '#f2f4f8', minWidth: 0, px: 1, textTransform: 'none' }}
        >
          Next
        </Button>
      </Box>
      </Collapse>

      <Menu
        anchorEl={lookMenu}
        open={!!lookMenu}
        onClose={() => setLookMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ zIndex: 990000001 }}
        slotProps={{
          paper: { sx: { maxWidth: 'min(280px, calc(100vw - 32px))' } },
        }}
      >
        {PAGE_LOOKS.map((look) => (
          <MenuItem
            key={look}
            role="menuitemradio"
            aria-checked={pageLook === look}
            dense
            selected={pageLook === look}
            sx={{ whiteSpace: 'normal' }}
            onClick={() => chooseLook(look)}
          >
            <ListItemIcon>
              {pageLook === look ? <CheckRoundedIcon fontSize="small" /> : null}
            </ListItemIcon>
            <ListItemText
              primary={t(`core:pdf_reader.look_${look}`)}
              secondary={t(`core:pdf_reader.look_${look}_hint`)}
              slotProps={{
                primary: { sx: { fontSize: '0.9rem', fontWeight: 600 } },
                secondary: { sx: { fontSize: '0.75rem', lineHeight: 1.3 } },
              }}
            />
          </MenuItem>
        ))}
      </Menu>

      <Snackbar
        open={!!toast}
        autoHideDuration={4200}
        onClose={() => setToast(null)}
        message={toast}
        sx={{ zIndex: 990000001 }}
      />
    </Box>
  );
};
