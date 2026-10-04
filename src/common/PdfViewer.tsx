import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Snackbar,
  Typography,
} from '@mui/material';
import { Capacitor } from '@capacitor/core';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
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
import { QortinoZoomableBox } from '../components/Group/QortinoAgent/QortinoZoomableBox';

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
   * Set for files that live only in memory (chat attachments): enables Share
   * and "Open with" on Android. Identifies the file so both reuse one copy.
   */
  shareKey?: string;
};

/**
 * In-app PDF book reader (page-by-page). Uses bundled pdf.js so Android
 * WebView does not need iframe + blob URL (unreliable on Capacitor).
 * Supports pinch/double-tap zoom and save-to-device.
 */
export const PdfViewer = () => {
  const { t } = useTranslation(['reticulum']);
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
    blobRef.current = null;
    saveItemRef.current = null;
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

  const renderPage = useCallback((pageNum: number) => {
    const gen = ++renderGen.current;
    const run = async () => {
      const doc = docRef.current;
      const canvas = canvasRef.current;
      if (!doc || !canvas || gen !== renderGen.current) return;
      try {
        const pdfPage = await doc.getPage(pageNum);
        if (gen !== renderGen.current) return;
        const containerWidth = Math.min(
          canvas.parentElement?.parentElement?.clientWidth ||
            canvas.parentElement?.clientWidth ||
            window.innerWidth,
          window.innerWidth
        );
        const unscaled = pdfPage.getViewport({ scale: 1 });
        const fit = Math.max(0.75, (containerWidth - 24) / unscaled.width);
        // Render sharper than fit so pinch zoom stays crisp up to ~2.5×.
        const scale = fit * 1.75;
        const viewport = pdfPage.getViewport({ scale });
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        // Display at fit width; CSS zoom handles pinch.
        const displayW = unscaled.width * fit;
        const displayH = unscaled.height * fit;
        canvas.style.width = `${displayW}px`;
        canvas.style.height = `${displayH}px`;
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
      } catch (e) {
        if (gen !== renderGen.current) return;
        setError(e instanceof Error ? e.message : 'Could not render page');
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
      setShareKey(detail?.shareKey || null);
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
          aria-label="Save to device"
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

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flex: 1,
          justifyContent: 'center',
          minHeight: 0,
          overflow: 'hidden',
          px: 0.5,
          py: 0.75,
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
          <QortinoZoomableBox resetKey={`${page}-${zoomTick}`}>
            <canvas
              ref={canvasRef}
              style={{
                background: '#fff',
                borderRadius: 8,
                boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
                display: 'block',
                maxWidth: '100%',
              }}
            />
          </QortinoZoomableBox>
        )}
      </Box>

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
          Pinch or double-tap to zoom · drag to pan
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

      {!loading && !error ? (
        <Box sx={{ px: 1.25, pb: 1.1 }}>
          <Button
            fullWidth
            variant="contained"
            disabled={saving}
            startIcon={
              saving ? (
                <CircularProgress size={16} sx={{ color: 'inherit' }} />
              ) : (
                <DownloadRoundedIcon />
              )
            }
            onClick={() => void handleSave()}
            sx={{
              background: '#3B82F6',
              fontWeight: 800,
              textTransform: 'none',
              '&:hover': { background: '#2563EB' },
            }}
          >
            {saving ? 'Saving…' : 'Save to device'}
          </Button>
        </Box>
      ) : null}

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
