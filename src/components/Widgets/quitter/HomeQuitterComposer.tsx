import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
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
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import GifBoxOutlinedIcon from '@mui/icons-material/GifBoxOutlined';
import PollOutlinedIcon from '@mui/icons-material/PollOutlined';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import PlayCircleFilledRoundedIcon from '@mui/icons-material/PlayCircleFilledRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import { useAtomValue } from 'jotai';
import { Capacitor } from '@capacitor/core';
import { useTranslation } from 'react-i18next';
import { userInfoAtom } from '../../../atoms/global';
import { dashboardPanelSx } from '../../Group/dashboardPanelEffects';
import { AppThumbnailAvatar } from '../../Apps/AppThumbnailAvatar';
import { useQdnAvatar } from '../../../lib/qdnAvatars';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../../utils/events';
import { detachStreamedChunkUpload } from '../../../utils/streamedChunkUpload';
import { ChatGifPicker } from '../../Chat/gifs/ChatGifPicker';
import { libraryGifKey, type LibraryGif } from '../../Chat/gifs/libraryGifs';
import {
  buildQtubeVideoIdentifier,
  publishQuitterPost,
  QUITTER_MAX_IMAGES,
  QuitterPublishCancelledError,
  quitterThumbSrc,
} from './quitterPublish';
import {
  normalizeTorqPoll,
  publishTorqPost,
  torqFileRejection,
  TORQ_MAX_GIFS,
  TORQ_MAX_IMAGES,
  TORQ_MIN_POLL_OPTIONS,
} from './torqPublish';
import {
  plainTextToTorqDoc,
  torqDocToPostBody,
  type TorqDocNode,
} from './torqRichText';
import { TorqTextEditor } from './TorqTextEditor';
import { TorqPollEditor } from './TorqPollEditor';
import { startLiveVideoUpload } from './quitterStreamedVideo';
import {
  QuitterVideoEditorDialog,
  type QuitterVideoEditorValue,
} from './QuitterVideoEditorDialog';
import {
  composerAppName,
  composerTargetOrder,
  setComposerTarget,
  useComposerTarget,
  type ComposerTarget,
} from './composerTarget';
import {
  ComposerAttachmentCards,
  ComposerAttachmentEditDialog,
  ComposerGifStack,
  ComposerImageGrid,
} from './ComposerPostPreview';
import {
  clearQuitterComposerSession,
  getQuitterComposerSession,
  patchQuitterComposerSession,
  type SessionFileDraft,
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
  app: 'Quitter' | 'Torq';
  author: string;
  postIdentifier: string;
};

type LiveVideoUpload = NonNullable<ReturnType<typeof startLiveVideoUpload>>;

const isCancelError = (err: any) =>
  err instanceof QuitterPublishCancelledError ||
  err instanceof VideoPrepareCancelledError ||
  err?.name === 'QuitterPublishCancelledError' ||
  err?.name === 'VideoPrepareCancelledError' ||
  /cancel/i.test(String(err?.message || err));

const revokeBlobUrl = (url?: string) => {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
};

/** Open Quitter or Torq in a Q-Apps tab (optionally at one of its pages). */
const openComposerApp = (app: string, path?: string) => {
  executeEvent('addTab', {
    data: {
      identifier: '',
      name: app,
      ...(path ? { path } : {}),
      service: 'APP',
    },
  });
  executeEvent('open-apps-mode', {});
};

export const HomeQuitterComposer = ({
  onPublished,
}: HomeQuitterComposerProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['group', 'core']);
  const tc = useCallback(
    (key: string, options: Record<string, unknown> = {}) =>
      t(`group:home_composer.${key}`, {
        postProcess: 'capitalizeFirstChar',
        ...options,
      }),
    [t]
  );
  const userInfo = useAtomValue(userInfoAtom);
  const userName = String(
    userInfo?.name || userInfo?.primaryName || ''
  ).trim();
  const hasName = Boolean(userName);

  const session = getQuitterComposerSession();
  const target = useComposerTarget();
  const isTorq = target === 'torq';
  const appName = composerAppName(target);
  const [expanded, setExpanded] = useState(session.expanded);
  const [text, setText] = useState(session.text);
  const [torqDoc, setTorqDoc] = useState<TorqDocNode>(
    () => session.torqDoc || plainTextToTorqDoc(session.text)
  );
  // Bumped to remount the editor when its content is replaced from outside.
  const [editorKey, setEditorKey] = useState(0);
  const [images, setImages] = useState<ImageDraft[]>(session.images);
  const [video, setVideo] = useState<VideoDraft | null>(session.video);
  const [gifs, setGifs] = useState<LibraryGif[]>(session.gifs);
  const [pollChoices, setPollChoices] = useState<string[] | null>(
    session.pollChoices
  );
  const [pollAnonymous, setPollAnonymous] = useState(session.pollAnonymous);
  const [files, setFiles] = useState<SessionFileDraft[]>(session.files);
  const [gifDialogOpen, setGifDialogOpen] = useState(false);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
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
  const [liveSentBytes, setLiveSentBytes] = useState(0);
  const [lastPublished, setLastPublished] = useState<LastPublishedPost | null>(
    null
  );
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const compressJobRef = useRef<VideoPrepareJob | null>(session.compressJob);
  const publishAbortRef = useRef<AbortController | null>(null);
  const liveUploadRef = useRef<LiveVideoUpload | null>(null);
  // Prevent the persist effect from writing stale draft back after clear.
  const clearingDraftRef = useRef(false);

  const torqBody = useMemo(() => torqDocToPostBody(torqDoc), [torqDoc]);

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
      torqDoc,
      gifs,
      pollChoices,
      pollAnonymous,
      files,
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
    torqDoc,
    gifs,
    pollChoices,
    pollAnonymous,
    files,
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
            ? tc('status.ready_size', { size: formatBytes(result.file.size) })
            : tc('status.video_ready')
        );
        setStatus('');
      })
      .catch((err) => {
        // Failed while this composer was unmounted: show it, and let Publish
        // start a fresh compression instead of re-awaiting the failed job.
        if (!active || compressJobRef.current !== job) return;
        compressJobRef.current = null;
        const cancelled = isCancelError(err);
        setCompressPercent(null);
        setCompressLabel(cancelled ? tc('status.cancelled_retry') : '');
        setStatus(cancelled ? tc('status.cancelled') : '');
        if (!cancelled) {
          setError(err?.message || tc('error.compression_failed'));
        }
      });
    return () => {
      active = false;
    };
  }, [preparedVideo, tc]);

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
    files.forEach((item) => revokeBlobUrl(item.thumbnailPreview));
    publishAbortRef.current?.abort();
    publishAbortRef.current = null;
    liveUploadRef.current?.upload.cancel();
    liveUploadRef.current = null;
    compressJobRef.current?.cancel();
    compressJobRef.current = null;
    clearingDraftRef.current = true;
    setPendingVideo(null);
    setEditorOpen(false);
    setPublishing(false);
    setText('');
    setTorqDoc(plainTextToTorqDoc(''));
    setEditorKey((key) => key + 1);
    setImages([]);
    setVideo(null);
    setGifs([]);
    setPollChoices(null);
    setPollAnonymous(false);
    setFiles([]);
    setEditingFileId(null);
    setPreparedVideo(null);
    setCompressPercent(null);
    setCompressLabel('');
    setLiveSentBytes(0);
    setStatus('');
    setError('');
    setExpanded(false);
    clearQuitterComposerSession();
  }, [pendingVideo, video, images, files]);

  const openPublishedPost = useCallback((post: LastPublishedPost) => {
    openComposerApp(
      post.app,
      `post/${encodeURIComponent(post.author)}/${encodeURIComponent(post.postIdentifier)}`
    );
  }, []);

  const handleTargetChange = (next: ComposerTarget | null) => {
    if (!next || next === target || publishing) return;
    if (next === 'torq') {
      setTorqDoc(plainTextToTorqDoc(text));
      setEditorKey((key) => key + 1);
    } else {
      // Formatting has no Quitter equivalent; lists stay as "• " lines.
      setText(torqDocToPostBody(torqDoc).text);
    }
    // Home's feed, Featured Q-Apps and the share sheet follow this choice.
    setComposerTarget(next);
    setError('');
  };

  const maxImages = isTorq ? TORQ_MAX_IMAGES : QUITTER_MAX_IMAGES;

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
    const remaining = maxImages - currentCount;
    const next: ImageDraft[] = [];
    for (const entry of entries.slice(0, Math.max(0, remaining))) {
      const file = entry?.file;
      if (!file) continue;
      const mime = resolveImageMime(file, entry.mimeType);
      if (mime === 'image/gif') {
        setError(tc('error.gif_images_unsupported'));
        continue;
      }
      if (!mime) continue;
      next.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (entries.length > remaining) {
      setError(tc('error.too_many_images', { count: maxImages }));
    }
    if (next.length) {
      setImages((prev) => [...prev, ...next].slice(0, maxImages));
    }
  };

  const handlePickImages = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    addImageFiles(
      Array.from(fileList).map((file) => ({ file })),
      images.length
    );
  };

  const moveImage = (index: number, delta: number) => {
    setImages((prev) => {
      const swapWith = index + delta;
      if (swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next;
    });
  };

  const handlePickFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setError('');
    const accepted: SessionFileDraft[] = [];
    let rejection = '';
    for (const file of Array.from(fileList)) {
      const reason = torqFileRejection(file);
      if (reason) {
        rejection = reason;
        continue;
      }
      accepted.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
      });
    }
    if (accepted.length) setFiles((prev) => [...prev, ...accepted]);
    if (rejection) setError(rejection);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      revokeBlobUrl(prev.find((item) => item.id === id)?.thumbnailPreview);
      return prev.filter((item) => item.id !== id);
    });
  };

  const moveFile = (fromId: string, toId: string) => {
    setFiles((prev) => {
      const from = prev.findIndex((item) => item.id === fromId);
      const to = prev.findIndex((item) => item.id === toId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  };

  const setFileThumbnail = (id: string, thumbnail: File) => {
    setError('');
    setFiles((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        revokeBlobUrl(item.thumbnailPreview);
        return {
          ...item,
          thumbnail,
          thumbnailPreview: URL.createObjectURL(thumbnail),
        };
      })
    );
  };

  const saveFileDetails = (id: string, title: string, filename: string) => {
    setFiles((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, title, filename } : item
      )
    );
    setEditingFileId(null);
  };

  const handleSelectGif = (gif: LibraryGif) => {
    setGifDialogOpen(false);
    if (gifs.some((item) => libraryGifKey(item) === libraryGifKey(gif))) {
      return;
    }
    if (gifs.length >= TORQ_MAX_GIFS) {
      setError(tc('error.too_many_gifs', { count: TORQ_MAX_GIFS }));
      return;
    }
    setError('');
    setGifs((prev) => [...prev, gif]);
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
        setError(err?.message || tc('error.video_pick_failed'));
      }
    }
  };

  const handlePickVideo = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|mkv|3gp|m4v|avi)$/i.test(file.name)) {
      setError(tc('error.not_a_video'));
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
    liveUploadRef.current?.upload.cancel();
    compressJobRef.current?.cancel();
    compressJobRef.current = null;
    setError('');
    if (publishing) {
      // Keep publishing=true until the publish loop stops and cleans up
      // any partial Q-Tube VIDEO/metadata resources.
      setCompressLabel(tc('status.cancelling'));
      setStatus(tc('status.cancelling'));
      return;
    }
    setPreparedVideo(null);
    setCompressPercent(null);
    setCompressLabel(tc('status.cancelled_retry'));
    setStatus(tc('status.cancelled'));
  };

  const handleEditorCancel = () => {
    if (pendingVideo?.previewUrl?.startsWith('blob:') && !video) {
      URL.revokeObjectURL(pendingVideo.previewUrl);
    }
    setPendingVideo(null);
    setEditorOpen(false);
  };

  /** Start preparing the video in the background; returns the job. */
  const startVideoPrepareJob = (draft: VideoDraft): VideoPrepareJob => {
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
    if (needsWork) {
      setCompressPercent(0);
      setCompressLabel(tc('status.compressing'));
      setStatus(tc('status.compressing_background'));
    } else {
      setCompressPercent(100);
      setCompressLabel(tc('status.video_ready'));
    }
    const job = startBackgroundVideoPrepare({
      file: draft.file,
      size: draft.size,
      name: `${draft.title || 'video'}.mp4`,
      mimeType: draft.mimeType,
      nativePath: draft.nativePath,
      compressLevel: needsWork ? draft.compressLevel : 'none',
      durationSec: draft.duration || undefined,
      notificationTitle: draft.title || tc('status.compressing'),
      onProgress: needsWork
        ? (message, percent) => {
            setCompressLabel(message);
            if (typeof percent === 'number') {
              setCompressPercent(percent < 0 ? null : percent);
            }
            patchQuitterComposerSession({
              compressLabel: message,
              compressPercent:
                typeof percent === 'number' && percent >= 0 ? percent : null,
            });
          }
        : undefined,
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
            ? tc('status.ready_size', { size: formatBytes(result.file.size) })
            : tc('status.video_ready')
        );
        if (needsWork) setStatus('');
      })
      .catch((err: any) => {
        if (compressJobRef.current !== job) return;
        // Let the next Publish start over instead of re-awaiting this failure.
        compressJobRef.current = null;
        const cancelled = isCancelError(err);
        setCompressPercent(null);
        setCompressLabel(cancelled ? tc('status.cancelled_retry') : '');
        if (!cancelled) {
          setError(err?.message || tc('error.compression_failed'));
        }
        setStatus(cancelled ? tc('status.cancelled') : '');
      });
    return job;
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

  const normalizedPoll = useMemo(
    () => (pollChoices ? normalizeTorqPoll(pollChoices) : null),
    [pollChoices]
  );
  const torqOnlyContent =
    gifs.length > 0 || files.length > 0 || pollChoices != null;
  const quitterBlockedReason = isTorq
    ? ''
    : torqOnlyContent
      ? tc('torq_only_content')
      : images.length > QUITTER_MAX_IMAGES
        ? tc('quitter_image_limit', { count: QUITTER_MAX_IMAGES })
        : '';
  const pollInvalid = isTorq && pollChoices != null && !normalizedPoll;
  const hasBody = isTorq ? torqBody.text.length > 0 : text.trim().length > 0;
  const hasMedia =
    images.length > 0 ||
    video != null ||
    (isTorq && (gifs.length > 0 || files.length > 0 || normalizedPoll != null));

  const canPublish =
    hasName &&
    !publishing &&
    !quitterBlockedReason &&
    !pollInvalid &&
    (hasBody || hasMedia) &&
    (!video || (video.title.trim().length > 0 && video.category > 0));

  const handlePublish = async () => {
    if (!canPublish || !hasName) return;
    publishAbortRef.current?.abort();
    const abort = new AbortController();
    publishAbortRef.current = abort;
    const publishTarget = target;
    setPublishing(true);
    setError('');
    setLiveSentBytes(0);
    setStatus(
      videoCompressing || (video && !preparedVideo && compressJobRef.current)
        ? tc('status.waiting_compression')
        : tc('status.preparing')
    );
    let live: LiveVideoUpload | null = null;
    let videoFile: File | null = null;
    try {
      let videoIdentifier: string | undefined;
      if (video) {
        let prepared = preparedVideo;
        if (!prepared) {
          // Nothing running (never started, or it failed): start it now.
          const job = compressJobRef.current || startVideoPrepareJob(video);
          // Upload the finished part of the file while the rest compresses.
          videoIdentifier = buildQtubeVideoIdentifier(video.title);
          live = startLiveVideoUpload({
            job,
            userName,
            videoIdentifier,
            onLiveProgress: (sent) => {
              if (!abort.signal.aborted) setLiveSentBytes(sent);
            },
          });
          liveUploadRef.current = live;
          setStatus(
            live
              ? tc('status.uploading_while_compressing')
              : tc('status.waiting_compression')
          );
          prepared = await job.promise;
          if (abort.signal.aborted) {
            throw new QuitterPublishCancelledError();
          }
          setPreparedVideo(prepared);
          if (live) {
            // Stop before deciding: a chunk may still be on its way out.
            live.unfollow();
            await live.upload.stopLive();
          }
        }
        videoFile = prepared.file;
        // Drop source File so only the publish buffer stays in WebView memory.
        setVideo((prev) => (prev ? { ...prev, file: null } : prev));
        const publishingLabel = prepared.compressed
          ? tc('status.publishing_size', {
              size: formatBytes(prepared.file.size),
            })
          : tc('status.publishing_video');
        setCompressPercent(35);
        setCompressLabel(publishingLabel);
        setStatus(publishingLabel);
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
        const label = tc('status.publishing_chunks', { done, total });
        setCompressPercent(pct);
        setCompressLabel(label);
        setStatus(label);
      };
      subscribeToEvent('receiveChunks', onChunkProgress);

      const videoInput =
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
              // Live chunks went to this identifier, so the publish must too.
              identifier: live ? videoIdentifier : undefined,
              // Any live chunk on the node must be reconciled by the upload.
              streamedUpload: live?.upload.touchedNode() ? live.upload : null,
            }
          : null;
      const onProgress = (message: string, percent?: number) => {
        if (abort.signal.aborted) return;
        setStatus(message);
        setCompressLabel(message);
        if (typeof percent === 'number') {
          setCompressPercent(Math.max(0, Math.min(100, percent)));
        }
      };

      let published: { postIdentifier: string } | undefined;
      try {
        published =
          publishTarget === 'torq'
            ? await publishTorqPost({
                text: torqBody.text,
                richText: torqBody.richText,
                userName,
                images: images.map((item) => ({ file: item.file })),
                video: videoInput,
                gifs,
                poll: pollChoices
                  ? normalizeTorqPoll(pollChoices, {
                      anonymous: pollAnonymous,
                    })
                  : null,
                files: files.map((item) => ({
                  file: item.file,
                  title: item.title,
                  filename: item.filename,
                  thumbnail: item.thumbnail,
                })),
                onProgress,
                signal: abort.signal,
              })
            : await publishQuitterPost({
                // Quitter stores/renders plain text (pre-wrap) — never HTML tags.
                text,
                userName,
                images: images.map((item) => ({ file: item.file })),
                video: videoInput,
                onProgress,
                signal: abort.signal,
              });
      } finally {
        unsubscribeFromEvent('receiveChunks', onChunkProgress);
      }

      if (abort.signal.aborted) {
        throw new QuitterPublishCancelledError();
      }

      const nextPublished: LastPublishedPost | null = published?.postIdentifier
        ? {
            app: publishTarget === 'torq' ? 'Torq' : 'Quitter',
            author: userName,
            postIdentifier: published.postIdentifier,
          }
        : null;
      resetDraft();
      setLastPublished(nextPublished);
      setStatus(tc('status.published'));
      onPublished?.();
    } catch (err: any) {
      if (isCancelError(err)) {
        setStatus(tc('status.cancelled'));
        setError('');
        setCompressPercent(null);
        setCompressLabel(tc('status.cancelled_retry'));
      } else {
        setError(err?.message || tc('error.publish_failed'));
        setStatus('');
        setCompressPercent(null);
      }
    } finally {
      live?.unfollow();
      live?.upload.cancel();
      if (liveUploadRef.current === live) liveUploadRef.current = null;
      // A retry uses a new identifier; never reuse this attempt's chunks.
      detachStreamedChunkUpload(videoFile);
      setLiveSentBytes(0);
      if (publishAbortRef.current === abort) {
        publishAbortRef.current = null;
      }
      setPublishing(false);
    }
  };

  const isDark = theme.palette.mode === 'dark';
  const hazeAccent = '#7EB6FF';
  const hazeWarm = '#E8D5C4';
  // Quitter and Torq ship bundled icons, so this is set even on a slow node.
  const { src: appLogoUrl } = useQdnAvatar(appName, { countUse: false });

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
            src={appLogoUrl}
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
          <ButtonBase
            aria-label={tc('open_app', { app: appName })}
            onClick={() => openComposerApp(appName)}
            sx={{
              borderRadius: '50%',
              flexShrink: 0,
              transition: 'transform 140ms ease',
              '&:active': { transform: 'scale(0.94)' },
              '&:focus-visible': {
                outline: `2px solid ${alpha(theme.palette.primary.main, 0.6)}`,
                outlineOffset: 2,
              },
            }}
          >
            <AppThumbnailAvatar
              key={appName}
              appName={appName}
              fallbackSize={22}
              sx={{
                bgcolor: alpha(theme.palette.common.black, isDark ? 0.25 : 0.06),
                border: `1px solid ${alpha(theme.palette.common.white, isDark ? 0.12 : 0.5)}`,
                boxShadow: `0 4px 14px ${alpha(hazeAccent, 0.18)}`,
                height: 36,
                width: 36,
                '& img': { objectFit: 'cover' },
              }}
            />
          </ButtonBase>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontSize: '1rem',
                fontWeight: 650,
                letterSpacing: '0.01em',
              }}
            >
              {tc('post_to', { app: appName })}
            </Typography>
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.78rem',
                lineHeight: 1.45,
                mt: 0.15,
              }}
            >
              {isTorq ? tc('subtitle_torq') : tc('subtitle_quitter')}
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
          {expanded
            ? t('core:action.hide', { postProcess: 'capitalizeFirstChar' })
            : tc('action_compose')}
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
            {tc('published_to', { app: lastPublished.app })}
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
            {tc('open_latest_post')}
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
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
            }}
          >
            <ToggleButtonGroup
              exclusive
              size="small"
              value={target}
              disabled={publishing}
              aria-label={tc('target_label')}
              onChange={(_event, next) => handleTargetChange(next)}
              sx={{
                '& .MuiToggleButton-root': {
                  borderRadius: '999px',
                  fontSize: 12.5,
                  fontWeight: 650,
                  gap: 0.75,
                  lineHeight: 1.2,
                  px: 1.5,
                  py: 0.5,
                  textTransform: 'none',
                },
                '& .MuiToggleButtonGroup-grouped:not(:first-of-type)': {
                  ml: 0.5,
                  borderLeft: `1px solid ${theme.palette.divider}`,
                },
              }}
            >
              {composerTargetOrder(target).map((option) => {
                const optionApp = composerAppName(option);
                return (
                  <ToggleButton key={option} value={option}>
                    <AppThumbnailAvatar
                      appName={optionApp}
                      fallbackSize={12}
                      sx={{
                        height: 18,
                        width: 18,
                        '& img': { objectFit: 'cover' },
                      }}
                    />
                    {optionApp}
                  </ToggleButton>
                );
              })}
            </ToggleButtonGroup>
            {!isTorq ? (
              <Box
                sx={{
                  alignItems: 'center',
                  color: theme.palette.text.secondary,
                  display: 'flex',
                  flex: '1 1 180px',
                  gap: 0.5,
                  minWidth: 0,
                }}
              >
                <AutoAwesomeRoundedIcon
                  sx={{ color: theme.palette.primary.main, fontSize: 15 }}
                />
                <Typography sx={{ fontSize: 12, lineHeight: 1.35 }}>
                  {tc('try_torq')}{' '}
                  <Box
                    component="button"
                    type="button"
                    disabled={publishing}
                    onClick={() => handleTargetChange('torq')}
                    sx={{
                      background: 'none',
                      border: 0,
                      color: theme.palette.primary.main,
                      cursor: 'pointer',
                      font: 'inherit',
                      fontWeight: 650,
                      p: 0,
                      textDecoration: 'underline',
                    }}
                  >
                    {tc('switch_to_torq')}
                  </Box>
                </Typography>
              </Box>
            ) : null}
          </Box>

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
              {tc('register_name', { app: appName })}
            </Typography>
          ) : null}

          {isTorq ? (
            <TorqTextEditor
              key={editorKey}
              initialDoc={torqDoc}
              disabled={!hasName || publishing}
              onChange={setTorqDoc}
            />
          ) : (
            <TextField
              multiline
              minRows={4}
              maxRows={10}
              fullWidth
              disabled={!hasName || publishing}
              placeholder={tc('quitter_placeholder')}
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
          )}

          {/* Attachments in the order the post shows them. */}
          <ComposerGifStack
            gifs={gifs}
            disabled={publishing}
            onRemove={(gif) =>
              setGifs((prev) =>
                prev.filter(
                  (item) => libraryGifKey(item) !== libraryGifKey(gif)
                )
              )
            }
          />

          <ComposerAttachmentCards
            files={files}
            userName={userName}
            disabled={publishing}
            onRemove={removeFile}
            onMove={moveFile}
            onEdit={setEditingFileId}
            onThumbnail={setFileThumbnail}
            onError={(message) =>
              setError(message || tc('error.thumbnail_too_large'))
            }
          />

          {isTorq && pollChoices ? (
            <TorqPollEditor
              choices={pollChoices}
              anonymous={pollAnonymous}
              disabled={publishing}
              onChoicesChange={setPollChoices}
              onAnonymousChange={setPollAnonymous}
              onRemove={() => {
                setPollChoices(null);
                setPollAnonymous(false);
              }}
            />
          ) : null}

          <ComposerImageGrid
            images={images}
            disabled={publishing}
            onRemove={removeImage}
            onMove={moveImage}
          />

          {video ? (
            <Box
              sx={{
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: '16px',
                overflow: 'hidden',
                width: '100%',
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  aspectRatio: '16 / 9',
                  backgroundColor: '#000',
                  backgroundImage: video.videoImage
                    ? `url(${quitterThumbSrc(video.videoImage)})`
                    : undefined,
                  backgroundPosition: 'center',
                  backgroundSize: 'cover',
                  display: 'flex',
                  justifyContent: 'center',
                  width: '100%',
                }}
              >
                <PlayCircleFilledRoundedIcon
                  sx={{ color: 'rgba(255,255,255,0.85)', fontSize: 56 }}
                />
              </Box>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: 1,
                  minWidth: 0,
                  px: 1.25,
                  py: 1,
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontSize: 14,
                      fontWeight: 700,
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
                  {publishing && liveSentBytes > 0 ? (
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: 11.5,
                      }}
                    >
                      {tc('status.live_uploaded', {
                        size: formatBytes(liveSentBytes),
                      })}
                    </Typography>
                  ) : null}
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
                </Box>
                <IconButton
                  size="small"
                  aria-label={tc('edit_video')}
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
                  aria-label={tc('remove_video')}
                  disabled={publishing}
                  onClick={clearVideo}
                >
                  <CloseRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>
            </Box>
          ) : null}

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 0.75,
              justifyContent: 'space-between',
            }}
          >
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.25 }}>
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
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  handlePickFiles(event.target.files);
                  event.target.value = '';
                }}
              />
              <IconButton
                aria-label={tc('add_image')}
                disabled={!hasName || publishing || images.length >= maxImages}
                onClick={() => imageInputRef.current?.click()}
              >
                <ImageOutlinedIcon />
              </IconButton>
              {isTorq ? (
                <IconButton
                  aria-label={tc('add_gif')}
                  disabled={!hasName || publishing || gifs.length >= TORQ_MAX_GIFS}
                  onClick={() => setGifDialogOpen(true)}
                >
                  <GifBoxOutlinedIcon />
                </IconButton>
              ) : null}
              <IconButton
                aria-label={tc('add_video')}
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
              {isTorq ? (
                <>
                  <IconButton
                    aria-label={tc('add_files')}
                    disabled={!hasName || publishing}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <AttachFileRoundedIcon />
                  </IconButton>
                  <IconButton
                    aria-label={tc('add_poll')}
                    aria-pressed={pollChoices != null}
                    disabled={!hasName || publishing}
                    onClick={() => {
                      if (pollChoices) {
                        setPollChoices(null);
                        setPollAnonymous(false);
                      } else {
                        setPollChoices(
                          Array.from({ length: TORQ_MIN_POLL_OPTIONS }, () => '')
                        );
                      }
                    }}
                    sx={
                      pollChoices
                        ? {
                            backgroundColor: alpha(
                              theme.palette.primary.main,
                              0.12
                            ),
                            color: theme.palette.primary.main,
                          }
                        : undefined
                    }
                  >
                    <PollOutlinedIcon />
                  </IconButton>
                </>
              ) : null}
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
                  {t('core:action.cancel', {
                    postProcess: 'capitalizeFirstChar',
                  })}
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
                  ? tc('publishing')
                  : videoCompressing
                    ? tc('publish_when_ready')
                    : t('core:action.publish', {
                        postProcess: 'capitalizeFirstChar',
                      })}
              </Button>
            </Box>
          </Box>

          {quitterBlockedReason ? (
            <Typography
              sx={{ color: theme.palette.warning.main, fontSize: 12.5 }}
            >
              {quitterBlockedReason}
            </Typography>
          ) : null}
          {pollInvalid ? (
            <Typography
              sx={{ color: theme.palette.text.secondary, fontSize: 12 }}
            >
              {tc('poll_needs_choices', { count: TORQ_MIN_POLL_OPTIONS })}
            </Typography>
          ) : null}
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

      <ComposerAttachmentEditDialog
        draft={files.find((item) => item.id === editingFileId) || null}
        onCancel={() => setEditingFileId(null)}
        onSave={saveFileDetails}
      />

      <Dialog
        open={gifDialogOpen}
        onClose={() => setGifDialogOpen(false)}
        fullWidth
        maxWidth="xs"
        PaperProps={{ sx: { borderRadius: '16px' } }}
      >
        <DialogTitle
          sx={{
            alignItems: 'center',
            display: 'flex',
            fontSize: 16,
            fontWeight: 650,
            justifyContent: 'space-between',
            pb: 1,
          }}
        >
          {tc('gif_dialog_title')}
          <IconButton
            size="small"
            aria-label={t('core:action.close', {
              postProcess: 'capitalizeFirstChar',
            })}
            onClick={() => setGifDialogOpen(false)}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: 1.5, pb: 1.5 }}>
          {gifDialogOpen ? (
            <ChatGifPicker height={420} onSelect={handleSelectGif} />
          ) : null}
        </DialogContent>
      </Dialog>

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
