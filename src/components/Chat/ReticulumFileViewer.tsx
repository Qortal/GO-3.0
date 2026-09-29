import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Snackbar,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import MusicNoteRoundedIcon from '@mui/icons-material/MusicNoteRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import ShareRoundedIcon from '@mui/icons-material/ShareRounded';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import {
  OPEN_FILE_VIEWER_EVENT,
  type FileViewerRequest,
} from '../../utils/fileViewerEvents';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import {
  SAFE_AREA_BOTTOM,
  SAFE_AREA_LEFT,
  SAFE_AREA_RIGHT,
  SAFE_AREA_TOP,
} from '../../utils/mobileSafeArea';
import { openHttpUrlExternally } from '../../utils/openExternalHttp';
import { QortinoZoomableBox } from '../Group/QortinoAgent/QortinoZoomableBox';
import {
  classifyFilePreview,
  decodeTextPreview,
  fileExtension,
  isMarkupSourceFile,
  MARKDOWN_RENDER_MAX_BYTES,
  mimeTypeForExternalOpen,
  resolveFileMimeType,
  type FilePreviewKind,
} from './reticulumFilePreview';

type LoadedFile = {
  key: string;
  name: string;
  size: number;
  mimeType: string;
  blob: Blob;
  kind: FilePreviewKind;
  /** Object URL this viewer created for image/video/audio; revoked on close. */
  mediaUrl?: string;
  text?: string;
  truncated?: boolean;
  /** Sanitized markdown; absent when the file is too large to parse. */
  html?: string;
};

type Action = 'share' | 'save' | 'open';

const VIEWER_Z_INDEX = 990000000;
const SNIFF_HEAD_BYTES = 64 * 1024;

const formatFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 1024)
    return `${Math.max(0, bytes || 0)} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

/**
 * Full-screen in-app viewer for files received over Reticulum chat.
 *
 * Android's WebView cannot open a `blob:` URL in a new window: it replaces the
 * whole app with the raw file, with no way back. So files open here instead,
 * with close (button or hardware back), share, save and "open with" on every
 * type. Text and markdown render in place (markdown formatted and sanitized),
 * images/video/audio play in place, PDFs go to the book reader, and anything
 * else gets a card that hands it to another app.
 */
export const ReticulumFileViewer = () => {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'reticulum']);
  const isNative = Capacitor.isNativePlatform();
  const [request, setRequest] = useState<FileViewerRequest | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [busyAction, setBusyAction] = useState<Action | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const generationRef = useRef(0);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<LoadedFile | null>(null);
  fileRef.current = file;

  const close = useCallback(() => {
    generationRef.current += 1;
    const mediaUrl = fileRef.current?.mediaUrl;
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    setRequest(null);
    setFile(null);
    setStatus('loading');
    setMediaFailed(false);
    setShowSource(false);
    setBusyAction(null);
  }, []);

  const load = useCallback(
    async (next: FileViewerRequest, generation: number) => {
      let url = next.url || '';
      let manifest: { fileName?: string; mimeType?: string } | undefined;
      if (next.fileHash) {
        const resolved = await window.reticulumResources?.getUrl?.(
          next.fileHash
        );
        if (!resolved?.success || !resolved.url) {
          throw new Error(resolved?.error || 'Resource unavailable');
        }
        url = resolved.url;
        manifest = (resolved.manifest || undefined) as typeof manifest;
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Read failed (${response.status})`);
      const blob = await response.blob();
      if (generation !== generationRef.current) return;

      const name =
        next.fileName?.trim() ||
        manifest?.fileName?.trim() ||
        t('reticulum:file_viewer.file');
      // The WebView types every untyped blob as text/plain on fetch, so that
      // value says nothing; the extension or the bytes decide instead.
      const fetchedType = blob.type === 'text/plain' ? '' : blob.type;
      const declaredType = next.mimeType || manifest?.mimeType || fetchedType;
      const head = new Uint8Array(
        await blob.slice(0, SNIFF_HEAD_BYTES).arrayBuffer()
      );
      const kind = classifyFilePreview({
        fileName: name,
        mimeType: declaredType,
        head,
      });
      const mimeType = resolveFileMimeType(name, declaredType);
      const typedBlob =
        blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });

      if (kind === 'pdf') {
        executeEvent('openPdf', {
          blob: typedBlob,
          title: name,
          shareKey: next.fileHash || url,
        });
        close();
        return;
      }

      const loaded: LoadedFile = {
        key: next.fileHash || url,
        name,
        size: blob.size,
        mimeType,
        blob: typedBlob,
        kind,
      };
      if (kind === 'markdown' || kind === 'text') {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const { text, truncated } = decodeTextPreview(bytes);
        loaded.text = text;
        loaded.truncated = truncated;
        if (kind === 'markdown' && bytes.length <= MARKDOWN_RENDER_MAX_BYTES) {
          const { renderMarkdownToSafeHtml } =
            await import('./reticulumMarkdown');
          loaded.html = renderMarkdownToSafeHtml(text);
        }
      } else if (kind === 'image' || kind === 'video' || kind === 'audio') {
        loaded.mediaUrl = URL.createObjectURL(typedBlob);
      }
      if (generation !== generationRef.current) {
        if (loaded.mediaUrl) URL.revokeObjectURL(loaded.mediaUrl);
        return;
      }
      setFile(loaded);
      setStatus('ready');
    },
    [close, t]
  );

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const next = (event as CustomEvent<FileViewerRequest>).detail;
      if (!next?.fileHash && !next?.url) return;
      const previousMedia = fileRef.current?.mediaUrl;
      if (previousMedia) URL.revokeObjectURL(previousMedia);
      const generation = ++generationRef.current;
      setRequest(next);
      setFile(null);
      setStatus('loading');
      setMediaFailed(false);
      setShowSource(false);
      setBusyAction(null);
      setToast(null);
      load(next, generation).catch((error) => {
        if (generation !== generationRef.current) return;
        console.error('[FileViewer] could not load file:', error);
        setStatus('error');
      });
    };
    subscribeToEvent(OPEN_FILE_VIEWER_EVENT, handleOpen);
    return () => {
      unsubscribeFromEvent(OPEN_FILE_VIEWER_EVENT, handleOpen);
    };
  }, [load]);

  const isOpen = request !== null;

  useAndroidBack(
    () => {
      close();
      return true;
    },
    { priority: BACK_PRIORITY.call, enabled: isOpen }
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [close, isOpen]);

  useEffect(() => {
    contentRef.current?.scrollTo?.({ top: 0 });
  }, [file, showSource]);

  const runAction = useCallback(
    async (action: Action) => {
      const current = fileRef.current;
      if (!current || busyAction) return;
      setBusyAction(action);
      try {
        if (action === 'save') {
          if (isNative) {
            const { mobileSaveLocationLabelFor, saveBlobToMobileDocuments } =
              await import('../../utils/mobileFileSave');
            await saveBlobToMobileDocuments(current.name, current.blob);
            setToast(
              t('reticulum:file_viewer.saved_to', {
                location: `${mobileSaveLocationLabelFor(
                  current.name,
                  current.mimeType
                )}/${current.name}`,
                postProcess: 'capitalizeFirstChar',
              })
            );
          } else {
            const downloadUrl = URL.createObjectURL(current.blob);
            const anchor = document.createElement('a');
            anchor.href = downloadUrl;
            anchor.download = current.name;
            anchor.style.display = 'none';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
          }
          return;
        }
        const {
          openStagedMobileFileWith,
          shareStagedMobileFile,
          stageMobileFileForSharing,
        } = await import('../../utils/mobileFileShare');
        const uri = await stageMobileFileForSharing(
          current.key,
          current.name,
          current.blob
        );
        if (action === 'share') {
          await shareStagedMobileFile(uri, current.name);
        } else {
          await openStagedMobileFileWith(
            uri,
            current.name,
            mimeTypeForExternalOpen(current.name, current.mimeType)
          );
        }
      } catch (error) {
        console.error(`[FileViewer] ${action} failed:`, error);
        setToast(
          t(
            action === 'save'
              ? 'reticulum:file_viewer.save_failed'
              : action === 'share'
                ? 'reticulum:file_viewer.share_failed'
                : 'reticulum:file_viewer.open_with_failed',
            { postProcess: 'capitalizeFirstChar' }
          )
        );
      } finally {
        setBusyAction(null);
      }
    },
    [busyAction, isNative, t]
  );

  const handleMarkdownClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.('a');
      if (!anchor) return;
      // Never let a link navigate the app's own WebView.
      event.preventDefault();
      const href = anchor.getAttribute('href') || '';
      if (href.startsWith('#')) {
        let slug = href.slice(1);
        try {
          slug = decodeURIComponent(slug);
        } catch {
          /* keep the raw fragment */
        }
        const target = contentRef.current?.querySelector(
          `[data-anchor="${CSS.escape(slug.toLowerCase())}"]`
        );
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (!openHttpUrlExternally(href)) {
        setToast(
          t('reticulum:file_viewer.link_unsupported', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
    },
    [t]
  );

  if (!isOpen) return null;

  const displayName =
    file?.name || request?.fileName?.trim() || t('reticulum:file_viewer.file');
  const displaySize = file?.size ?? request?.fileSize ?? 0;
  const extension = fileExtension(displayName).toUpperCase();
  const metaLine = [
    displaySize > 0 ? formatFileSize(displaySize) : '',
    extension,
  ]
    .filter(Boolean)
    .join(' · ');
  const actionsDisabled = status !== 'ready' || !file || busyAction !== null;
  const showNoPreviewCard =
    file &&
    (file.kind === 'other' ||
      (mediaFailed && (file.kind === 'image' || file.kind === 'video')));

  const iconButtonSx = { color: theme.palette.text.primary };
  const busyIcon = <CircularProgress size={20} color="inherit" />;

  const shareLabel = t('reticulum:file_viewer.share', {
    postProcess: 'capitalizeFirstChar',
  });
  const saveLabel = t('reticulum:file_viewer.save', {
    postProcess: 'capitalizeFirstChar',
  });
  const openWithLabel = t('reticulum:file_viewer.open_with', {
    postProcess: 'capitalizeFirstChar',
  });

  const renderBody = () => {
    if (status === 'loading') {
      return (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            gap: 1.5,
            justifyContent: 'center',
          }}
        >
          <CircularProgress size={32} />
          <Typography sx={{ color: theme.palette.text.secondary }}>
            {t('reticulum:file_viewer.opening', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      );
    }
    if (status === 'error' || !file) {
      return (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            gap: 2,
            justifyContent: 'center',
            px: 3,
            textAlign: 'center',
          }}
        >
          <Typography>
            {t('reticulum:file_viewer.load_failed', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
          <Button variant="contained" onClick={close}>
            {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
          </Button>
        </Box>
      );
    }
    if (showNoPreviewCard) {
      return (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flex: 1,
            justifyContent: 'center',
            overflowY: 'auto',
            px: 3,
            py: 4,
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 1.25,
              maxWidth: 360,
              textAlign: 'center',
              width: '100%',
            }}
          >
            <InsertDriveFileRoundedIcon
              sx={{ color: theme.palette.text.secondary, fontSize: 64 }}
            />
            <Typography sx={{ fontWeight: 700, wordBreak: 'break-word' }}>
              {file.name}
            </Typography>
            <Typography
              sx={{ color: theme.palette.text.secondary, fontSize: '0.85rem' }}
            >
              {metaLine}
            </Typography>
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.9rem',
                mb: 1.5,
              }}
            >
              {mediaFailed
                ? t('reticulum:file_viewer.preview_failed', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('reticulum:file_viewer.no_preview', {
                    postProcess: 'capitalizeFirstChar',
                  })}
            </Typography>
            {isNative && (
              <Button
                fullWidth
                variant="contained"
                disabled={actionsDisabled}
                startIcon={
                  busyAction === 'open' ? busyIcon : <OpenInNewRoundedIcon />
                }
                onClick={() => void runAction('open')}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                {openWithLabel}
              </Button>
            )}
            {isNative && (
              <Button
                fullWidth
                variant="outlined"
                color="inherit"
                disabled={actionsDisabled}
                startIcon={
                  busyAction === 'share' ? busyIcon : <ShareRoundedIcon />
                }
                onClick={() => void runAction('share')}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                {shareLabel}
              </Button>
            )}
            <Button
              fullWidth
              variant="outlined"
              color="inherit"
              disabled={actionsDisabled}
              startIcon={
                busyAction === 'save' ? busyIcon : <DownloadRoundedIcon />
              }
              onClick={() => void runAction('save')}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              {saveLabel}
            </Button>
          </Box>
        </Box>
      );
    }
    if (file.kind === 'image' && file.mediaUrl) {
      return (
        <Box sx={{ flex: 1, minHeight: 0, p: 1 }}>
          <QortinoZoomableBox resetKey={file.mediaUrl}>
            <Box
              component="img"
              src={file.mediaUrl}
              alt={file.name}
              onError={() => setMediaFailed(true)}
              sx={{
                display: 'block',
                maxHeight: `calc(100vh - 72px - ${SAFE_AREA_TOP} - ${SAFE_AREA_BOTTOM})`,
                maxWidth: '100%',
                objectFit: 'contain',
              }}
            />
          </QortinoZoomableBox>
        </Box>
      );
    }
    if (file.kind === 'video' && file.mediaUrl) {
      return (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flex: 1,
            justifyContent: 'center',
            minHeight: 0,
            p: 1,
          }}
        >
          <Box
            component="video"
            src={file.mediaUrl}
            controls
            playsInline
            onError={() => setMediaFailed(true)}
            sx={{ maxHeight: '100%', maxWidth: '100%' }}
          />
        </Box>
      );
    }
    if (file.kind === 'audio' && file.mediaUrl) {
      return (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            gap: 2,
            justifyContent: 'center',
            px: 3,
          }}
        >
          <MusicNoteRoundedIcon
            sx={{ color: theme.palette.text.secondary, fontSize: 72 }}
          />
          <Box
            component="audio"
            src={file.mediaUrl}
            controls
            sx={{ maxWidth: 420, width: '100%' }}
          />
        </Box>
      );
    }

    const renderAsMarkdown =
      file.kind === 'markdown' && !!file.html && !showSource;
    return (
      <Box
        ref={contentRef}
        onClick={renderAsMarkdown ? handleMarkdownClick : undefined}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {(file.truncated || isMarkupSourceFile(file.name)) && (
          <Typography
            sx={{
              backgroundColor: alpha(theme.palette.warning.main, 0.1),
              borderBottom: '1px solid',
              borderColor: alpha(theme.palette.warning.main, 0.25),
              color: theme.palette.text.secondary,
              fontSize: '0.8rem',
              px: 2,
              py: 1,
            }}
          >
            {file.truncated
              ? t('reticulum:file_viewer.truncated', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('reticulum:file_viewer.markup_as_source', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </Typography>
        )}
        {renderAsMarkdown ? (
          <Box
            className="reticulum-file-viewer-markdown"
            dangerouslySetInnerHTML={{ __html: file.html }}
            sx={{
              color: theme.palette.text.primary,
              fontSize: '15px',
              lineHeight: 1.65,
              maxWidth: 820,
              mx: 'auto',
              px: 2,
              py: 2,
              wordBreak: 'break-word',
              '& h1, & h2, & h3, & h4, & h5, & h6': {
                fontWeight: 700,
                lineHeight: 1.3,
                mb: 1,
                mt: 2.5,
                scrollMarginTop: '12px',
              },
              '& h1': { fontSize: '1.6em' },
              '& h2': {
                borderBottom: '1px solid',
                borderColor: theme.palette.divider,
                fontSize: '1.35em',
                pb: 0.5,
              },
              '& h3': { fontSize: '1.15em' },
              '& h4, & h5, & h6': { fontSize: '1em' },
              '& > :first-of-type': { mt: 0 },
              '& p': { my: 1.25 },
              '& a': { color: theme.palette.primary.main },
              '& ul, & ol': { my: 1, pl: 3 },
              '& li': { my: 0.5 },
              '& li > p': { my: 0.5 },
              '& blockquote': {
                borderLeft: '3px solid',
                borderColor: theme.palette.divider,
                color: theme.palette.text.secondary,
                mx: 0,
                my: 1.5,
                pl: 1.75,
              },
              '& code': {
                backgroundColor: alpha(theme.palette.text.primary, 0.08),
                borderRadius: '4px',
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: '0.88em',
                px: 0.5,
                py: 0.125,
              },
              '& pre': {
                backgroundColor: alpha(theme.palette.text.primary, 0.06),
                borderRadius: '8px',
                my: 1.5,
                overflowX: 'auto',
                p: 1.5,
              },
              '& pre code': {
                backgroundColor: 'transparent',
                fontSize: '0.85em',
                p: 0,
              },
              '& hr': {
                border: 0,
                borderTop: '1px solid',
                borderColor: theme.palette.divider,
                my: 3,
              },
              '& table': {
                borderCollapse: 'collapse',
                display: 'block',
                fontSize: '0.9em',
                maxWidth: '100%',
                my: 1.5,
                overflowX: 'auto',
              },
              '& th, & td': {
                border: '1px solid',
                borderColor: theme.palette.divider,
                px: 1.25,
                py: 0.75,
                textAlign: 'left',
                verticalAlign: 'top',
              },
              '& th': {
                backgroundColor: alpha(theme.palette.text.primary, 0.05),
                fontWeight: 700,
              },
            }}
          />
        ) : (
          <Box
            component="pre"
            sx={{
              color: theme.palette.text.primary,
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: '13px',
              lineHeight: 1.55,
              m: 0,
              px: 2,
              py: 2,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {file.text}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label={displayName}
      sx={{
        backgroundColor: theme.palette.background.default,
        boxSizing: 'border-box',
        color: theme.palette.text.primary,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        left: 0,
        paddingBottom: SAFE_AREA_BOTTOM,
        paddingLeft: SAFE_AREA_LEFT,
        paddingRight: SAFE_AREA_RIGHT,
        paddingTop: SAFE_AREA_TOP,
        position: 'fixed',
        right: 0,
        top: 0,
        zIndex: VIEWER_Z_INDEX,
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          backgroundColor: theme.palette.background.paper,
          borderBottom: '1px solid',
          borderColor: theme.palette.divider,
          display: 'flex',
          flexShrink: 0,
          gap: 0.25,
          minHeight: 56,
          px: 0.5,
        }}
      >
        <Tooltip
          title={t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
        >
          <IconButton
            aria-label={t('reticulum:file_viewer.close', {
              postProcess: 'capitalizeFirstChar',
            })}
            onClick={close}
            sx={iconButtonSx}
          >
            <CloseRoundedIcon />
          </IconButton>
        </Tooltip>
        <Box sx={{ flex: 1, minWidth: 0, px: 0.5 }}>
          <Typography noWrap sx={{ fontSize: '0.95rem', fontWeight: 700 }}>
            {displayName}
          </Typography>
          {metaLine && (
            <Typography
              noWrap
              sx={{ color: theme.palette.text.secondary, fontSize: '0.75rem' }}
            >
              {metaLine}
            </Typography>
          )}
        </Box>
        {file?.kind === 'markdown' && file.html && (
          <Tooltip
            title={
              showSource
                ? t('reticulum:file_viewer.show_formatted', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('reticulum:file_viewer.show_source', {
                    postProcess: 'capitalizeFirstChar',
                  })
            }
          >
            <IconButton
              aria-label={
                showSource
                  ? t('reticulum:file_viewer.show_formatted', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('reticulum:file_viewer.show_source', {
                      postProcess: 'capitalizeFirstChar',
                    })
              }
              aria-pressed={showSource}
              onClick={() => setShowSource((value) => !value)}
              sx={iconButtonSx}
            >
              {showSource ? <ArticleRoundedIcon /> : <CodeRoundedIcon />}
            </IconButton>
          </Tooltip>
        )}
        {isNative && (
          <Tooltip title={shareLabel}>
            <span>
              <IconButton
                aria-label={shareLabel}
                disabled={actionsDisabled}
                onClick={() => void runAction('share')}
                sx={iconButtonSx}
              >
                {busyAction === 'share' ? busyIcon : <ShareRoundedIcon />}
              </IconButton>
            </span>
          </Tooltip>
        )}
        <Tooltip title={saveLabel}>
          <span>
            <IconButton
              aria-label={saveLabel}
              disabled={actionsDisabled}
              onClick={() => void runAction('save')}
              sx={iconButtonSx}
            >
              {busyAction === 'save' ? busyIcon : <DownloadRoundedIcon />}
            </IconButton>
          </span>
        </Tooltip>
        {isNative && (
          <Tooltip title={openWithLabel}>
            <span>
              <IconButton
                aria-label={openWithLabel}
                disabled={actionsDisabled}
                onClick={() => void runAction('open')}
                sx={iconButtonSx}
              >
                {busyAction === 'open' ? busyIcon : <OpenInNewRoundedIcon />}
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>

      {renderBody()}

      <Snackbar
        open={!!toast}
        autoHideDuration={4200}
        onClose={() => setToast(null)}
        message={toast}
        sx={{ zIndex: VIEWER_Z_INDEX + 1 }}
      />
    </Box>
  );
};
