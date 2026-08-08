import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  LinearProgress,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import { useAtomValue } from 'jotai';
import { Capacitor } from '@capacitor/core';
import { userInfoAtom } from '../../../atoms/global';
import { dashboardPanelSx } from '../../Group/dashboardPanelEffects';
import { AppThumbnailAvatar } from '../../Apps/AppThumbnailAvatar';
import { buildAppThumbnailUrl } from '../../../utils/walletAvatarCache';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../../utils/events';
import {
  publishQuitterPost,
  QuitterPublishCancelledError,
  quitterThumbSrc,
} from './quitterPublish';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import {
  QuitterVideoEditorDialog,
  type QuitterVideoEditorValue,
} from './QuitterVideoEditorDialog';
import {
  clearQuitterComposerSession,
  getQuitterComposerSession,
  patchQuitterComposerSession,
  type SessionImageDraft,
  type SessionVideoDraft,
} from './quitterComposerSession';
import {
  formatBytes,
  isCapacitorAndroid,
  planVideoCompression,
  startBackgroundVideoPrepare,
  VideoPrepareCancelledError,
  type CompressLevel,
  type PrepareVideoResult,
  type VideoPrepareJob,
} from './quitterVideoCompress';
import {
  QUITTER_SHARED_MEDIA_EVENT,
  takePendingQuitterShare,
  type SharedComposerMedia,
} from './quitterShareIntake';

type HomeQuitterComposerProps = {
  onPublished?: () => void;
};

type ImageDraft = SessionImageDraft;
type VideoDraft = SessionVideoDraft;

type PendingVideoPick = {
  file: File | null;
  nativePath?: string;
  mimeType?: string;
  size: number;
  previewUrl: string;
  fileName: string;
};

type LastPublishedPost = {
  author: string;
  postIdentifier: string;
};

export const HomeQuitterComposer = ({
  onPublished,
}: HomeQuitterComposerProps) => {
  const theme = useTheme();
  const userInfo = useAtomValue(userInfoAtom);
  const userName = String(
    userInfo?.name || userInfo?.primaryName || ''
  ).trim();
  const hasName = Boolean(userName);

  const session = getQuitterComposerSession();
  const [expanded, setExpanded] = useState(session.expanded);
  const [text, setText] = useState(session.text);
  const [images, setImages] = useState<ImageDraft[]>(session.images);
  const [video, setVideo] = useState<VideoDraft | null>(session.video);
  const [pendingVideo, setPendingVideo] = useState<PendingVideoPick | null>(
    null
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [status, setStatus] = useState(session.status);
  const [error, setError] = useState(session.error);
  const [compressPercent, setCompressPercent] = useState<number | null>(
    session.compressPercent
  );
  const [compressLabel, setCompressLabel] = useState(session.compressLabel);
  const [preparedVideo, setPreparedVideo] = useState<PrepareVideoResult | null>(
    session.preparedVideo
  );
  const [lastPublished, setLastPublished] = useState<LastPublishedPost | null>(
    null
  );
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const compressJobRef = useRef<VideoPrepareJob | null>(session.compressJob);
  const publishAbortRef = useRef<AbortController | null>(null);
  // Prevent the persist effect from writing stale draft back after clear.
  const clearingDraftRef = useRef(false);

  // Persist draft + compress job across remounts (layout/node/network changes).
  useEffect(() => {
    if (clearingDraftRef.current) {
      clearingDraftRef.current = false;
      return;
    }
    patchQuitterComposerSession({
      text,
      images,
      video,
      preparedVideo,
      compressPercent,
      compressLabel,
      expanded,
      status,
      error,
      compressJob: compressJobRef.current,
    });
  }, [
    text,
    images,
    video,
    preparedVideo,
    compressPercent,
    compressLabel,
    expanded,
    status,
    error,
  ]);

  // Re-attach to an in-flight compress job after remount.
  useEffect(() => {
    const job = compressJobRef.current;
    if (!job || preparedVideo) return;
    let active = true;
    void job.promise
      .then((result) => {
        if (!active) return;
        setPreparedVideo(result);
        setCompressPercent(100);
        setCompressLabel(
          result.compressed
            ? `Ready · ${formatBytes(result.file.size)}`
            : 'Video ready'
        );
        setStatus('');
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [preparedVideo]);

  const videoPlan = useMemo(
    () =>
      video
        ? planVideoCompression(
            video.size,
            video.mimeType,
            video.fileName,
            video.compressLevel,
            video.duration || undefined
          )
        : null,
    [video]
  );

  const resetDraft = useCallback(() => {
    if (pendingVideo?.previewUrl?.startsWith('blob:') && !video) {
      URL.revokeObjectURL(pendingVideo.previewUrl);
    }
    if (video?.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(video.previewUrl);
    }
    images.forEach((img) => {
      if (img.previewUrl.startsWith('blob:')) URL.revokeObjectURL(img.previewUrl);
    });
    publishAbortRef.current?.abort();
    publishAbortRef.current = null;
    compressJobRef.current?.cancel();
    compressJobRef.current = null;
    clearingDraftRef.current = true;
    setPendingVideo(null);
    setEditorOpen(false);
    setPublishing(false);
    setText('');
    setImages([]);
    setVideo(null);
    setPreparedVideo(null);
    setCompressPercent(null);
    setCompressLabel('');
    setStatus('');
    setError('');
    setExpanded(false);
    clearQuitterComposerSession();
  }, [pendingVideo, video, images]);

  const openPublishedPost = useCallback((post: LastPublishedPost) => {
    executeEvent('addTab', {
      data: {
        identifier: '',
        name: 'Quitter',
        path: `post/${encodeURIComponent(post.author)}/${encodeURIComponent(post.postIdentifier)}`,
        service: 'APP',
      },
    });
    executeEvent('open-apps-mode', {});
  }, []);

  /**
   * Resolve an image mime type without trusting `file.type` — files handed over
   * by the Android share sheet can arrive with a non-string/absent type.
   */
  const resolveImageMime = (file: File, hint?: string): string => {
    const fromHint = typeof hint === 'string' ? hint : '';
    if (fromHint.startsWith('image/')) return fromHint;
    const fromFile = typeof file?.type === 'string' ? file.type : '';
    if (fromFile.startsWith('image/')) return fromFile;
    const ext = String(file?.name || '')
      .toLowerCase()
      .match(/\.(jpe?g|png|webp|gif)$/)?.[1];
    if (!ext) return '';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    return `image/${ext}`;
  };

  const addImageFiles = (
    entries: { file: File; mimeType?: string }[],
    currentCount: number
  ) => {
    setError('');
    const remaining = 2 - currentCount;
    const next: ImageDraft[] = [];
    for (const entry of entries.slice(0, Math.max(0, remaining))) {
      const file = entry?.file;
      if (!file) continue;
      const mime = resolveImageMime(file, entry.mimeType);
      if (mime === 'image/gif') {
        setError('GIF images are not supported');
        continue;
      }
      if (!mime) continue;
      next.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (next.length) {
      setImages((prev) => [...prev, ...next].slice(0, 2));
    }
  };

  const handlePickImages = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    addImageFiles(
      Array.from(fileList).map((file) => ({ file })),
      images.length
    );
  };

  const openVideoEditor = (pick: PendingVideoPick) => {
    setError('');
    if (pendingVideo?.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(pendingVideo.previewUrl);
    }
    setPendingVideo(pick);
    setEditorOpen(true);
  };

  // Media shared from other apps via the Android "Quitter" share target:
  // expand the composer and pre-attach the photo(s) / video.
  const applySharedMediaRef = useRef<(media: SharedComposerMedia | null) => void>(
    () => undefined
  );
  applySharedMediaRef.current = (media) => {
    if (!media) return;
    setExpanded(true);
    if (media.images.length) {
      addImageFiles(media.images, images.length);
    }

    if (media.video) {
      openVideoEditor({
        file: null,
        nativePath: media.video.nativePath,
        mimeType: media.video.mimeType,
        size: media.video.size,
        fileName: media.video.fileName,
        previewUrl: Capacitor.convertFileSrc(media.video.nativePath),
      });
    }
  };
  useEffect(() => {
    const handler = () =>
      applySharedMediaRef.current(takePendingQuitterShare());
    // Media may have arrived before this composer mounted (cold launch).
    handler();
    subscribeToEvent(QUITTER_SHARED_MEDIA_EVENT, handler);
    return () => {
      unsubscribeFromEvent(QUITTER_SHARED_MEDIA_EVENT, handler);
    };
  }, []);

  const handlePickVideoAndroid = async () => {
    try {
      const { pickVideoForQuitter } = await import('./quitterVideoCompress');
      const picked = await pickVideoForQuitter();
      if (!picked) return;
      openVideoEditor({
        file: picked.file,
        nativePath: picked.nativePath,
        mimeType: picked.mimeType,
        size: picked.size,
        fileName: picked.name,
        previewUrl: Capacitor.convertFileSrc(picked.nativePath),
      });
    } catch (err: any) {
      if (!/cancel/i.test(String(err?.message || err))) {
        setError(err?.message || 'Failed to pick video');
      }
    }
  };

  const handlePickVideo = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|mkv|3gp|m4v|avi)$/i.test(file.name)) {
      setError('Please choose a video file');
      return;
    }
    openVideoEditor({
      file,
      mimeType: file.type || 'video/*',
      size: file.size,
      fileName: file.name,
      previewUrl: URL.createObjectURL(file),
    });
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  };

  const clearVideo = () => {
    if (video?.previewUrl && video.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(video.previewUrl);
    }
    compressJobRef.current?.cancel();
    compressJobRef.current = null;
    setVideo(null);
    setPreparedVideo(null);
    setCompressPercent(null);
    setCompressLabel('');
  };

  const handleCancelPublish = () => {
    publishAbortRef.current?.abort();
    compressJobRef.current?.cancel();
    compressJobRef.current = null;
    setError('');
    if (publishing) {
      // Keep publishing=true until the publish loop stops and cleans up
      // any partial Q-Tube VIDEO/metadata resources.
      setCompressLabel('Cancelling…');
      setStatus('Cancelling…');
      return;
    }
    setPreparedVideo(null);
    setCompressPercent(null);
    setCompressLabel('Cancelled — publish again to retry');
    setStatus('Cancelled');
  };

  const handleEditorCancel = () => {
    if (pendingVideo?.previewUrl?.startsWith('blob:') && !video) {
      URL.revokeObjectURL(pendingVideo.previewUrl);
    }
    setPendingVideo(null);
    setEditorOpen(false);
  };

  const startVideoPrepareJob = (draft: VideoDraft) => {
    compressJobRef.current?.cancel();
    setPreparedVideo(null);
    const plan = planVideoCompression(
      draft.size,
      draft.mimeType,
      draft.fileName,
      draft.compressLevel,
      draft.duration || undefined
    );
    const needsWork = plan.shouldCompress || plan.forceTranscode;
    if (!needsWork) {
      setCompressPercent(100);
      setCompressLabel('Video ready');
      const job = startBackgroundVideoPrepare({
        file: draft.file,
        size: draft.size,
        name: `${draft.title || 'video'}.mp4`,
        mimeType: draft.mimeType,
        nativePath: draft.nativePath,
        compressLevel: 'none',
        notificationTitle: draft.title || 'Preparing video',
      });
      compressJobRef.current = job;
      patchQuitterComposerSession({ compressJob: job });
      void job.promise.then((result) => {
        setPreparedVideo(result);
        setCompressPercent(100);
        setCompressLabel('Video ready');
      });
      return;
    }

    setCompressPercent(0);
    setCompressLabel('Compressing Your Video');
    setStatus('Compressing in background — you can keep writing your post');
    const job = startBackgroundVideoPrepare({
      file: draft.file,
      size: draft.size,
      name: `${draft.title || 'video'}.mp4`,
      mimeType: draft.mimeType,
      nativePath: draft.nativePath,
      compressLevel: draft.compressLevel,
      notificationTitle: draft.title || 'Compressing video',
      onProgress: (message, percent) => {
        setCompressLabel(message);
        if (typeof percent === 'number') {
          setCompressPercent(percent < 0 ? null : percent);
        }
        patchQuitterComposerSession({
          compressLabel: message,
          compressPercent:
            typeof percent === 'number' && percent >= 0 ? percent : null,
        });
      },
    });
    compressJobRef.current = job;
    patchQuitterComposerSession({ compressJob: job });
    void job.promise
      .then((result) => {
        if (compressJobRef.current !== job) return;
        setPreparedVideo(result);
        setCompressPercent(100);
        setCompressLabel(
          result.compressed
            ? `Ready · ${formatBytes(result.file.size)}`
            : 'Video ready'
        );
        setStatus('');
      })
      .catch((err: any) => {
        if (compressJobRef.current !== job) return;
        const cancelled =
          err instanceof VideoPrepareCancelledError ||
          err?.name === 'VideoPrepareCancelledError' ||
          /cancel/i.test(String(err?.message || err));
        setCompressPercent(null);
        setCompressLabel(
          cancelled ? 'Cancelled — publish again to retry' : ''
        );
        if (!cancelled) {
          setError(err?.message || 'Video compression failed');
        }
        setStatus(cancelled ? 'Cancelled' : '');
      });
  };

  const handleEditorConfirm = (value: QuitterVideoEditorValue) => {
    if (!pendingVideo) return;
    // Replace any previous confirmed video.
    if (
      video?.previewUrl &&
      video.previewUrl.startsWith('blob:') &&
      video.previewUrl !== pendingVideo.previewUrl
    ) {
      URL.revokeObjectURL(video.previewUrl);
    }
    const nextVideo: VideoDraft = {
      file: pendingVideo.file,
      nativePath: pendingVideo.nativePath,
      mimeType: pendingVideo.mimeType,
      size: pendingVideo.size,
      previewUrl: pendingVideo.previewUrl,
      fileName: pendingVideo.fileName,
      title: value.title,
      description: value.description,
      category: value.category,
      duration: value.duration,
      videoImage: value.videoImage,
      extracts: value.extracts,
      compressLevel: value.compressLevel,
    };
    const sameSource =
      video != null &&
      video.nativePath === pendingVideo.nativePath &&
      video.size === pendingVideo.size &&
      video.previewUrl === pendingVideo.previewUrl;
    const needsNewJob =
      !sameSource ||
      video?.compressLevel !== value.compressLevel ||
      (!preparedVideo && !compressJobRef.current);
    setVideo(nextVideo);
    setPendingVideo(null);
    // Minimize editor immediately; compression continues with OS notification.
    setEditorOpen(false);
    setExpanded(true);
    if (needsNewJob) {
      startVideoPrepareJob(nextVideo);
    }
  };

  const editorSource = pendingVideo || video;
  const editingExisting =
    Boolean(pendingVideo) &&
    Boolean(video) &&
    video!.previewUrl === pendingVideo!.previewUrl;
  const editorInitial: QuitterVideoEditorValue = useMemo(() => {
    if (editingExisting && video) {
      return {
        title: video.title,
        description: video.description,
        category: video.category,
        duration: video.duration,
        videoImage: video.videoImage,
        extracts: video.extracts,
        compressLevel: video.compressLevel,
      };
    }
    if (pendingVideo) {
      return {
        title:
          pendingVideo.fileName.replace(/\.[^.]+$/, '').slice(0, 50) || 'Video',
        description: '',
        category: 26,
        duration: 0,
        videoImage: undefined,
        extracts: undefined,
        compressLevel: 'high' as CompressLevel,
      };
    }
    if (video) {
      return {
        title: video.title,
        description: video.description,
        category: video.category,
        duration: video.duration,
        videoImage: video.videoImage,
        extracts: video.extracts,
        compressLevel: video.compressLevel,
      };
    }
    return {
      title: 'Video',
      description: '',
      category: 26,
      duration: 0,
      compressLevel: 'high' as CompressLevel,
    };
  }, [editingExisting, pendingVideo, video]);

  const videoCompressing =
    Boolean(video) &&
    !publishing &&
    compressPercent != null &&
    compressPercent >= 0 &&
    compressPercent < 100;

  const canPublish =
    hasName &&
    !publishing &&
    (text.trim().length > 0 || images.length > 0 || video != null) &&
    (!video || (video.title.trim().length > 0 && video.category > 0));

  const handlePublish = async () => {
    if (!canPublish || !hasName) return;
    publishAbortRef.current?.abort();
    const abort = new AbortController();
    publishAbortRef.current = abort;
    setPublishing(true);
    setError('');
    setStatus(
      videoCompressing || (video && !preparedVideo && compressJobRef.current)
        ? 'Waiting for video compression…'
        : 'Preparing…'
    );
    try {
      let videoFile: File | null = null;
      if (video) {
        let prepared = preparedVideo;
        if (!prepared && compressJobRef.current) {
          setStatus('Waiting for background compression…');
          prepared = await compressJobRef.current.promise;
          if (abort.signal.aborted) {
            throw new QuitterPublishCancelledError();
          }
          setPreparedVideo(prepared);
        }
        if (!prepared) {
          // Fallback if job was never started (e.g. re-edit without recompress).
          const job = startBackgroundVideoPrepare({
            file: video.file,
            size: video.size,
            name: `${video.title || 'video'}.mp4`,
            mimeType: video.mimeType,
            nativePath: video.nativePath,
            compressLevel: video.compressLevel,
            notificationTitle: video.title || 'Compressing video',
            onProgress: (message, percent) => {
              if (abort.signal.aborted) return;
              setCompressLabel(message);
              if (typeof percent === 'number') {
                setCompressPercent(percent < 0 ? null : percent);
              }
              setStatus(message);
            },
          });
          compressJobRef.current = job;
          prepared = await job.promise;
          if (abort.signal.aborted) {
            throw new QuitterPublishCancelledError();
          }
          setPreparedVideo(prepared);
        }
        videoFile = prepared.file;
        // Drop source File so only the publish buffer stays in WebView memory.
        setVideo((prev) => (prev ? { ...prev, file: null } : prev));
        setCompressPercent(35);
        setCompressLabel(
          prepared.compressed
            ? `Publishing ${formatBytes(prepared.file.size)}…`
            : 'Publishing video…'
        );
        setStatus(
          prepared.compressed
            ? `Publishing ${formatBytes(prepared.file.size)}…`
            : 'Publishing video…'
        );
      }

      if (abort.signal.aborted) {
        throw new QuitterPublishCancelledError();
      }

      // Drive the progress bar from QDN chunk events during publish.
      const onChunkProgress = (event: Event) => {
        if (abort.signal.aborted) return;
        const payload = (event as CustomEvent).detail || {};
        const submitted = Number(payload?.chunksSubmitted);
        const total = Number(payload?.totalChunks);
        if (!Number.isFinite(total) || total <= 0) return;
        const done = Math.max(0, Math.min(total, submitted || 0));
        const pct = 35 + Math.round((done / total) * 55);
        setCompressPercent(pct);
        setCompressLabel(`Publishing… ${done}/${total}`);
        setStatus(`Publishing… ${done}/${total}`);
      };
      subscribeToEvent('receiveChunks', onChunkProgress);

      let published:
        | { postIdentifier: string }
        | undefined;
      try {
        published = await publishQuitterPost({
          // Quitter stores/renders plain text (pre-wrap) — never HTML tags.
          text,
          userName,
          images: images.map((item) => ({ file: item.file })),
          video:
            video && videoFile
              ? {
                  file: videoFile,
                  metadata: {
                    title: video.title.trim(),
                    description: video.description,
                    category: video.category,
                    duration: video.duration,
                    videoImage: video.videoImage,
                    extracts: video.extracts,
                  },
                }
              : null,
          onProgress: (message, percent) => {
            if (abort.signal.aborted) return;
            setStatus(message);
            setCompressLabel(message);
            if (typeof percent === 'number') {
              setCompressPercent(Math.max(0, Math.min(100, percent)));
            }
          },
          signal: abort.signal,
        });
      } finally {
        unsubscribeFromEvent('receiveChunks', onChunkProgress);
      }

      if (abort.signal.aborted) {
        throw new QuitterPublishCancelledError();
      }

      const nextPublished: LastPublishedPost | null = published?.postIdentifier
        ? { author: userName, postIdentifier: published.postIdentifier }
        : null;
      resetDraft();
      setLastPublished(nextPublished);
      setStatus('Published');
      onPublished?.();
    } catch (err: any) {
      const cancelled =
        err instanceof QuitterPublishCancelledError ||
        err instanceof VideoPrepareCancelledError ||
        err?.name === 'QuitterPublishCancelledError' ||
        err?.name === 'VideoPrepareCancelledError' ||
        /cancel/i.test(String(err?.message || err));
      if (cancelled) {
        setStatus('Cancelled');
        setError('');
        setCompressPercent(null);
        setCompressLabel('Cancelled — publish again to retry');
      } else {
        setError(err?.message || 'Failed to publish');
        setStatus('');
        setCompressPercent(null);
      }
    } finally {
      if (publishAbortRef.current === abort) {
        publishAbortRef.current = null;
      }
      setPublishing(false);
    }
  };

  const isDark = theme.palette.mode === 'dark';
  const hazeAccent = '#7EB6FF';
  const hazeWarm = '#E8D5C4';
  const quitterLogoUrl = buildAppThumbnailUrl('Quitter');

  return (
    <Box
      sx={{
        ...dashboardPanelSx(theme, 'base'),
        // Contain decoration — dashboardPanelSx sets overflow:visible by default.
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        isolation: 'isolate',
        minWidth: 0,
        overflow: 'hidden',
        padding: expanded ? '16px 18px 18px' : '14px 18px',
        position: 'relative',
        width: '100%',
        // Soft tint stays inside the card only.
        backgroundImage: isDark
          ? `radial-gradient(90% 120% at 12% 30%, ${alpha(hazeAccent, 0.12)} 0%, transparent 55%), radial-gradient(80% 100% at 88% 70%, ${alpha(hazeWarm, 0.08)} 0%, transparent 50%), linear-gradient(180deg, rgba(255,255,255,0.018) 0%, rgba(255,255,255,0.008) 22%, rgba(255,255,255,0) 100%)`
          : `radial-gradient(90% 120% at 12% 30%, ${alpha(hazeAccent, 0.1)} 0%, transparent 55%), radial-gradient(80% 100% at 88% 70%, ${alpha(hazeWarm, 0.14)} 0%, transparent 50%), linear-gradient(180deg, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.22) 22%, rgba(255,255,255,0) 100%)`,
        '@keyframes quitterLogoFloat0': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) rotate(-6deg)' },
          '50%': { transform: 'translate3d(10px, -8px, 0) rotate(4deg)' },
        },
        '@keyframes quitterLogoFloat1': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) rotate(8deg)' },
          '50%': { transform: 'translate3d(-12px, 10px, 0) rotate(-4deg)' },
        },
        '@keyframes quitterLogoFloat2': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1) rotate(-3deg)' },
          '50%': { transform: 'translate3d(8px, 12px, 0) scale(1.06) rotate(6deg)' },
        },
        '@keyframes quitterLogoFloat3': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) rotate(5deg)' },
          '50%': { transform: 'translate3d(-8px, -10px, 0) rotate(-8deg)' },
        },
        // Kill the panel's external top glow so it can't spill onto the page.
        '&::after': { display: 'none' },
      }}
    >
      {/* Floating faded logos — must use dashboard-panel-decoration so
          dashboardPanelSx does not force position:relative (which blew up the layout). */}
      <Box
        aria-hidden
        className="dashboard-panel-decoration"
        sx={{
          borderRadius: 'inherit',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          position: 'absolute',
          zIndex: 0,
        }}
      >
        {[
          { top: '8%', left: '72%', size: 56, anim: 0, dur: '11s', opacity: 0.14 },
          { top: '42%', left: '78%', size: 40, anim: 1, dur: '15s', opacity: 0.1 },
          { top: '18%', left: '58%', size: 34, anim: 2, dur: '13s', opacity: 0.08 },
          { top: '62%', left: '64%', size: 48, anim: 3, dur: '17s', opacity: 0.11 },
        ].map((logo) => (
          <Box
            key={logo.anim}
            component="img"
            alt=""
            src={quitterLogoUrl}
            sx={{
              animation: `quitterLogoFloat${logo.anim} ${logo.dur} ease-in-out infinite`,
              borderRadius: '14px',
              filter: isDark
                ? 'saturate(0.8) brightness(1.05)'
                : 'saturate(0.85)',
              height: logo.size,
              left: logo.left,
              objectFit: 'cover',
              opacity: logo.opacity,
              position: 'absolute',
              top: logo.top,
              width: logo.size,
              willChange: 'transform',
            }}
          />
        ))}
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1.1,
          justifyContent: 'space-between',
          minWidth: 0,
          position: 'relative',
          zIndex: 1,
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: 1.1,
            minWidth: 0,
          }}
        >
          <AppThumbnailAvatar
            appName="Quitter"
            fallbackSize={22}
            sx={{
              bgcolor: alpha(theme.palette.common.black, isDark ? 0.25 : 0.06),
              border: `1px solid ${alpha(theme.palette.common.white, isDark ? 0.12 : 0.5)}`,
              boxShadow: `0 4px 14px ${alpha(hazeAccent, 0.18)}`,
              flexShrink: 0,
              height: 36,
              width: 36,
              '& img': { objectFit: 'cover' },
            }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontSize: '1rem',
                fontWeight: 650,
                letterSpacing: '0.01em',
              }}
            >
              Post to Quitter
            </Typography>
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.78rem',
                lineHeight: 1.45,
                mt: 0.15,
              }}
            >
              Share a quick public update — text, photos, or a video.
            </Typography>
          </Box>
        </Box>
        <Button
          size="small"
          endIcon={
            <ExpandMoreRoundedIcon
              sx={{
                transform: expanded ? 'rotate(180deg)' : 'none',
                transition: 'transform 160ms ease',
              }}
            />
          }
          onClick={() => {
            setLastPublished(null);
            setStatus('');
            setExpanded((v) => !v);
          }}
          sx={{
            borderRadius: '10px',
            flexShrink: 0,
            fontWeight: 600,
            px: 1.25,
            textTransform: 'none',
          }}
        >
          {expanded ? 'Hide' : 'Compose'}
        </Button>
      </Box>

      {lastPublished ? (
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: alpha(theme.palette.success.main, 0.1),
            border: `1px solid ${alpha(theme.palette.success.main, 0.28)}`,
            borderRadius: '12px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1,
            justifyContent: 'space-between',
            position: 'relative',
            px: 1.25,
            py: 1,
            zIndex: 1,
          }}
        >
          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: 13,
              fontWeight: 600,
              minWidth: 0,
            }}
          >
            Published to Quitter
          </Typography>
          <Button
            size="small"
            variant="contained"
            startIcon={<OpenInNewRoundedIcon />}
            onClick={() => openPublishedPost(lastPublished)}
            sx={{
              borderRadius: '999px',
              flexShrink: 0,
              fontWeight: 650,
              textTransform: 'none',
            }}
          >
            Open latest post
          </Button>
        </Box>
      ) : null}

      {expanded ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1.25,
            position: 'relative',
            zIndex: 1,
          }}
        >
          {!hasName ? (
            <Typography
              sx={{
                backgroundColor: alpha(theme.palette.warning.main, 0.1),
                border: `1px solid ${alpha(theme.palette.warning.main, 0.28)}`,
                borderRadius: '10px',
                color: theme.palette.text.primary,
                fontSize: 13,
                px: 1.25,
                py: 1,
              }}
            >
              Register a Qortal name to publish on Quitter.
            </Typography>
          ) : null}

          <TextField
            multiline
            minRows={4}
            maxRows={10}
            fullWidth
            disabled={!hasName || publishing}
            placeholder={
              'What are you sharing?\n\nBlank lines create space between paragraphs.'
            }
            value={text}
            onChange={(event) => setText(event.target.value)}
            sx={{
              '& .MuiOutlinedInput-root': {
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? 'rgba(255,255,255,0.03)'
                    : alpha(theme.palette.common.black, 0.02),
                borderRadius: '12px',
                fontSize: 14,
                lineHeight: 1.55,
              },
            }}
          />

          {(images.length > 0 || video) && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {images.map((img) => (
                <Box
                  key={img.id}
                  sx={{
                    borderRadius: '10px',
                    height: 72,
                    overflow: 'hidden',
                    position: 'relative',
                    width: 72,
                  }}
                >
                  <Box
                    component="img"
                    src={img.previewUrl}
                    alt=""
                    sx={{ height: '100%', objectFit: 'cover', width: '100%' }}
                  />
                  <IconButton
                    size="small"
                    aria-label="Remove image"
                    disabled={publishing}
                    onClick={() => removeImage(img.id)}
                    sx={{
                      backgroundColor: 'rgba(0,0,0,0.55)',
                      color: '#fff',
                      position: 'absolute',
                      right: 2,
                      top: 2,
                      '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' },
                    }}
                  >
                    <CloseRoundedIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              ))}
              {video ? (
                <Box
                  sx={{
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: '12px',
                    display: 'flex',
                    flex: '1 1 240px',
                    gap: 1,
                    minWidth: 0,
                    p: 1,
                  }}
                >
                  <Box
                    sx={{
                      backgroundColor: '#000',
                      backgroundImage: video.videoImage
                        ? `url(${quitterThumbSrc(video.videoImage)})`
                        : undefined,
                      backgroundPosition: 'center',
                      backgroundSize: 'cover',
                      borderRadius: '8px',
                      flexShrink: 0,
                      height: 72,
                      width: 112,
                    }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontSize: 13,
                        fontWeight: 650,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {video.title}
                    </Typography>
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: 12,
                      }}
                    >
                      {compressLabel ||
                        `${formatBytes(preparedVideo?.file.size || video.size)}${
                          videoPlan ? ` · ${videoPlan.label}` : ''
                        }`}
                    </Typography>
                    {publishing ||
                    videoCompressing ||
                    (compressPercent != null && compressPercent < 100) ? (
                      <LinearProgress
                        variant={
                          compressPercent == null || compressPercent < 0
                            ? 'indeterminate'
                            : 'determinate'
                        }
                        value={Math.max(0, compressPercent ?? 0)}
                        sx={{
                          borderRadius: 999,
                          height: 4,
                          mt: 0.75,
                          mb: 0.25,
                        }}
                      />
                    ) : null}
                    <Box sx={{ display: 'flex', gap: 0.25, mt: 0.25 }}>
                      <IconButton
                        size="small"
                        aria-label="Edit video details"
                        disabled={publishing}
                        onClick={() => {
                          setPendingVideo({
                            file: video.file,
                            nativePath: video.nativePath,
                            mimeType: video.mimeType,
                            size: video.size,
                            previewUrl: video.previewUrl,
                            fileName: video.fileName,
                          });
                          setEditorOpen(true);
                        }}
                      >
                        <EditRoundedIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                      <IconButton
                        size="small"
                        aria-label="Remove video"
                        disabled={publishing}
                        onClick={clearVideo}
                      >
                        <CloseRoundedIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Box>
                  </Box>
                </Box>
              ) : null}
            </Box>
          )}

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 0.75,
              justifyContent: 'space-between',
            }}
          >
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                hidden
                onChange={(event) => {
                  void handlePickImages(event.target.files);
                  event.target.value = '';
                }}
              />
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*,.mp4,.mov,.webm,.mkv,.3gp,.m4v,.avi"
                hidden
                onChange={(event) => {
                  void handlePickVideo(event.target.files);
                  event.target.value = '';
                }}
              />
              <IconButton
                aria-label="Add image"
                disabled={!hasName || publishing || images.length >= 2}
                onClick={() => imageInputRef.current?.click()}
              >
                <ImageOutlinedIcon />
              </IconButton>
              <IconButton
                aria-label="Add video"
                disabled={!hasName || publishing || Boolean(video)}
                onClick={() => {
                  if (isCapacitorAndroid()) {
                    void handlePickVideoAndroid();
                    return;
                  }
                  videoInputRef.current?.click();
                }}
              >
                <VideocamOutlinedIcon />
              </IconButton>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75 }}>
              {publishing || videoCompressing ? (
                <Button
                  variant="outlined"
                  color="inherit"
                  onClick={handleCancelPublish}
                  sx={{
                    borderRadius: '999px',
                    fontWeight: 650,
                    px: 1.75,
                    textTransform: 'none',
                  }}
                >
                  Cancel
                </Button>
              ) : null}
              <Button
                variant="contained"
                disabled={!canPublish}
                onClick={() => void handlePublish()}
                startIcon={
                  publishing ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <SendRoundedIcon />
                  )
                }
                sx={{
                  borderRadius: '999px',
                  fontWeight: 650,
                  px: 2,
                  textTransform: 'none',
                }}
              >
                {publishing
                  ? 'Publishing…'
                  : videoCompressing
                    ? 'Publish when ready'
                    : 'Publish'}
              </Button>
            </Box>
          </Box>

          {status ? (
            <Typography
              sx={{ color: theme.palette.text.secondary, fontSize: 12 }}
            >
              {status}
            </Typography>
          ) : null}
          {error ? (
            <Typography
              sx={{ color: theme.palette.error.main, fontSize: 12.5 }}
            >
              {error}
            </Typography>
          ) : null}
        </Box>
      ) : null}

      {editorSource ? (
        <QuitterVideoEditorDialog
          open={editorOpen}
          previewUrl={editorSource.previewUrl}
          size={editorSource.size}
          fileName={editorSource.fileName}
          mimeType={editorSource.mimeType}
          initial={editorInitial}
          onCancel={handleEditorCancel}
          onConfirm={handleEditorConfirm}
        />
      ) : null}
    </Box>
  );
};
