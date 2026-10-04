/**
 * The Home composer's attachments, drawn the way the published post shows
 * them (Torq's PostMediaGrid, PostGifEmbeds, PostAttachments and audio
 * player), with remove / reorder / edit controls on top.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Slider,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import AudioFileOutlinedIcon from '@mui/icons-material/AudioFileOutlined';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { useTranslation } from 'react-i18next';
import { GifImage } from '../../Chat/gifs/GifImage';
import { libraryGifKey, type LibraryGif } from '../../Chat/gifs/libraryGifs';
import type { SessionFileDraft } from './quitterComposerSession';
import { formatBytes } from './quitterVideoCompress';
import { guessFileMime, prepareTorqThumbnail } from './torqPublish';

const useComposerT = () => {
  const { t } = useTranslation(['group', 'core']);
  return (key: string, options: Record<string, unknown> = {}) =>
    t(`group:home_composer.${key}`, {
      postProcess: 'capitalizeFirstChar',
      ...options,
    });
};

const overlayButtonSx = {
  backgroundColor: 'rgba(0,0,0,0.55)',
  color: '#fff',
  height: 28,
  padding: 0,
  position: 'absolute',
  width: 28,
  '&:hover': { backgroundColor: 'rgba(0,0,0,0.72)' },
  '&.Mui-disabled': { display: 'none' },
} as const;

/** Torq's post grid: 1, 2 or 3 columns by picture count (PostMediaGrid). */
export function composerMediaGridSx(count: number) {
  const columns = count === 1 ? 1 : count <= 4 ? 2 : 3;
  const compact = count > 4;
  return {
    display: 'grid',
    gap: '2px',
    gridAutoRows: count === 1 ? '100%' : compact ? '140px' : '200px',
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    maxHeight:
      count === 1
        ? '500px'
        : compact
          ? 'none'
          : count === 3
            ? '450px'
            : '300px',
    minHeight: count === 1 ? '300px' : compact ? '140px' : '200px',
    width: '100%',
    '@media (max-width: 1000px)': {
      gridAutoRows: count === 1 ? 'auto' : compact ? '140px' : '200px',
      gridTemplateColumns: `repeat(${count === 1 ? 1 : 2}, 1fr)`,
      maxHeight:
        count === 1
          ? 'none'
          : compact
            ? 'none'
            : count === 2
              ? '400px'
              : count === 3
                ? '450px'
                : '300px',
      minHeight: count === 1 ? 'auto' : compact ? '140px' : '180px',
    },
  } as const;
}

/** A cell may not be taller than its row (Torq's mediaCellMinHeight). */
export const composerMediaCellMinHeight = (count: number) =>
  count > 4 ? '140px' : '200px';

type PreviewImage = { id: string; previewUrl: string };

export const ComposerImageGrid = ({
  images,
  disabled,
  onRemove,
  onMove,
}: {
  images: PreviewImage[];
  disabled?: boolean;
  onRemove: (id: string) => void;
  onMove: (index: number, delta: number) => void;
}) => {
  const theme = useTheme();
  const tc = useComposerT();
  if (images.length === 0) return null;
  const count = images.length;
  return (
    <Box
      data-testid="composer-image-grid"
      sx={{
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '16px',
        boxShadow:
          theme.palette.mode === 'dark'
            ? '0 4px 12px rgba(0, 0, 0, 0.3)'
            : '0 4px 12px rgba(0, 0, 0, 0.08)',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <Box sx={composerMediaGridSx(count)}>
        {images.map((image, index) => (
          <Box
            key={image.id}
            sx={{
              backgroundColor: alpha(theme.palette.text.primary, 0.05),
              height: '100%',
              minHeight: composerMediaCellMinHeight(count),
              overflow: 'hidden',
              position: 'relative',
              width: '100%',
            }}
          >
            <Box
              component="img"
              src={image.previewUrl}
              alt=""
              sx={{
                display: 'block',
                height: '100%',
                objectFit: 'cover',
                width: '100%',
              }}
            />
            <IconButton
              size="small"
              aria-label={tc('remove_image')}
              disabled={disabled}
              onClick={() => onRemove(image.id)}
              sx={{ ...overlayButtonSx, right: 6, top: 6 }}
            >
              <CloseRoundedIcon sx={{ fontSize: 17 }} />
            </IconButton>
            {count > 1 ? (
              <>
                <IconButton
                  size="small"
                  aria-label={tc('move_image_earlier')}
                  disabled={disabled || index === 0}
                  onClick={() => onMove(index, -1)}
                  sx={{ ...overlayButtonSx, bottom: 6, left: 6 }}
                >
                  <ChevronLeftRoundedIcon sx={{ fontSize: 20 }} />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={tc('move_image_later')}
                  disabled={disabled || index === count - 1}
                  onClick={() => onMove(index, 1)}
                  sx={{ ...overlayButtonSx, bottom: 6, right: 6 }}
                >
                  <ChevronRightRoundedIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </>
            ) : null}
          </Box>
        ))}
      </Box>
    </Box>
  );
};

/** GIFs stack full width under the text, as in a Torq post. */
export const ComposerGifStack = ({
  gifs,
  disabled,
  onRemove,
}: {
  gifs: LibraryGif[];
  disabled?: boolean;
  onRemove: (gif: LibraryGif) => void;
}) => {
  const theme = useTheme();
  const tc = useComposerT();
  if (gifs.length === 0) return null;
  return (
    <Box
      data-testid="composer-gif-stack"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        maxWidth: 'min(100%, 360px)',
        width: '100%',
      }}
    >
      {gifs.map((gif) => (
        <Box
          key={libraryGifKey(gif)}
          sx={{
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '12px',
            overflow: 'hidden',
            position: 'relative',
            width: '100%',
          }}
        >
          <GifImage
            alt={gif.description || ''}
            eager
            fit="contain"
            gif={gif}
            natural
            sx={{ backgroundColor: 'action.hover', maxHeight: 320 }}
          />
          <IconButton
            size="small"
            aria-label={tc('remove_gif')}
            disabled={disabled}
            onClick={() => onRemove(gif)}
            sx={{ ...overlayButtonSx, right: 6, top: 6 }}
          >
            <CloseRoundedIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
};

type FileKind = 'audio' | 'pdf' | 'archive' | 'text' | 'file';

const ARCHIVE_EXT = /\.(zip|apk|rar|7z|gz|tar|tgz)$/i;
const TEXT_EXT =
  /\.(txt|md|markdown|json|csv|html?|xml|rtf|log|ya?ml|ini|toml)$/i;

export function composerFileKind(draft: SessionFileDraft): FileKind {
  const filename = draft.filename || draft.file.name;
  const mime = guessFileMime(draft.file, filename);
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.includes('pdf')) return 'pdf';
  if (ARCHIVE_EXT.test(filename) || mime.includes('zip')) return 'archive';
  if (mime.startsWith('text/') || TEXT_EXT.test(filename)) return 'text';
  return 'file';
}

const FileKindIcon = ({ kind }: { kind: FileKind }) => {
  if (kind === 'audio') return <AudioFileOutlinedIcon />;
  if (kind === 'pdf') return <PictureAsPdfOutlinedIcon />;
  if (kind === 'archive') return <ArchiveOutlinedIcon />;
  if (kind === 'text') return <DescriptionOutlinedIcon />;
  return <InsertDriveFileOutlinedIcon />;
};

/** Torq's default card title: the file name without its extension. */
export function draftTitle(draft: SessionFileDraft): string {
  const custom = draft.title?.trim();
  if (custom) return custom;
  const name = (draft.filename || draft.file.name || '').trim();
  if (ARCHIVE_EXT.test(name)) return name;
  return name.replace(/\.[^.]+$/, '') || name;
}

const draftFilename = (draft: SessionFileDraft) =>
  draft.filename?.trim() || draft.file.name;

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** Object URLs typed for playback, so .m4a plays before it is published. */
function useLocalAudioUrls(drafts: SessionFileDraft[]): Map<string, string> {
  const key = drafts.map((draft) => draft.id).join('|');
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    const next = new Map<string, string>();
    drafts.forEach((draft) => {
      if (!draft.file.size) return;
      const type = guessFileMime(draft.file, draftFilename(draft));
      next.set(draft.id, URL.createObjectURL(new Blob([draft.file], { type })));
    });
    setUrls(next);
    return () => next.forEach((url) => URL.revokeObjectURL(url));
    // Only a different set of files needs new URLs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}

type CoverProps = {
  draft: SessionFileDraft;
  kind: FileKind;
  size: number;
  preparing: boolean;
  disabled?: boolean;
  onPick: () => void;
  fallback?: ReactNode;
};

/** The cover square: tap it to add or change the thumbnail. */
const CoverButton = ({
  draft,
  kind,
  size,
  preparing,
  disabled,
  onPick,
  fallback,
}: CoverProps) => {
  const theme = useTheme();
  const tc = useComposerT();
  const hasCover = Boolean(draft.thumbnailPreview);
  return (
    <Box
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={hasCover ? tc('change_thumbnail') : tc('add_thumbnail')}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onPick();
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPick();
        }
      }}
      sx={{
        alignItems: 'center',
        backgroundColor: theme.palette.action.hover,
        borderRadius: size > 56 ? '14px' : '12px',
        color: theme.palette.primary.main,
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        flexShrink: 0,
        fontWeight: 800,
        height: size,
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative',
        width: size,
      }}
    >
      {preparing ? (
        <CircularProgress size={20} />
      ) : draft.thumbnailPreview ? (
        <Box
          component="img"
          src={draft.thumbnailPreview}
          alt=""
          sx={{ height: '100%', objectFit: 'cover', width: '100%' }}
        />
      ) : (
        (fallback ?? <FileKindIcon kind={kind} />)
      )}
      {!disabled ? (
        <Box
          aria-hidden
          sx={{
            alignItems: 'center',
            bgcolor: 'rgba(0, 0, 0, 0.6)',
            borderRadius: '50%',
            bottom: 2,
            color: '#fff',
            display: 'flex',
            height: 20,
            justifyContent: 'center',
            position: 'absolute',
            right: 2,
            width: 20,
          }}
        >
          <AddPhotoAlternateRoundedIcon sx={{ fontSize: 13 }} />
        </Box>
      ) : null}
    </Box>
  );
};

const cardSx = (theme: Theme) =>
  ({
    backgroundColor:
      theme.palette.mode === 'dark'
        ? 'rgba(255, 255, 255, 0.03)'
        : 'rgba(0, 0, 0, 0.02)',
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: '16px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    marginInline: 'auto',
    maxWidth: 560,
    p: { xs: 1, sm: 1.25 },
    width: '100%',
  }) as const;

type FileActionsProps = {
  draft: SessionFileDraft;
  position: number;
  group: SessionFileDraft[];
  disabled?: boolean;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (fromId: string, toId: string) => void;
};

const FileActions = ({
  draft,
  position,
  group,
  disabled,
  onEdit,
  onRemove,
  onMove,
}: FileActionsProps) => {
  const tc = useComposerT();
  const name = draftFilename(draft);
  const prev = group[position - 1];
  const next = group[position + 1];
  return (
    <>
      {group.length > 1 ? (
        <>
          <IconButton
            size="small"
            aria-label={tc('move_file_up', { name })}
            disabled={disabled || !prev}
            onClick={() => prev && onMove(draft.id, prev.id)}
          >
            <KeyboardArrowUpRoundedIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            aria-label={tc('move_file_down', { name })}
            disabled={disabled || !next}
            onClick={() => next && onMove(draft.id, next.id)}
          >
            <KeyboardArrowDownRoundedIcon fontSize="small" />
          </IconButton>
        </>
      ) : null}
      <IconButton
        size="small"
        aria-label={tc('edit_attachment', { name })}
        disabled={disabled}
        onClick={() => onEdit(draft.id)}
      >
        <EditOutlinedIcon fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        aria-label={tc('remove_file', { name })}
        disabled={disabled}
        onClick={() => onRemove(draft.id)}
      >
        <CloseRoundedIcon fontSize="small" />
      </IconButton>
    </>
  );
};

/** Torq's audio player, playing the picked files from the device. */
const ComposerAudioPlayer = ({
  tracks,
  userName,
  preparingId,
  actionProps,
  onPickCover,
}: {
  tracks: SessionFileDraft[];
  userName: string;
  preparingId: string | null;
  actionProps: Omit<FileActionsProps, 'draft' | 'position' | 'group'>;
  onPickCover: (id: string) => void;
}) => {
  const theme = useTheme();
  const tc = useComposerT();
  const urls = useLocalAudioUrls(tracks);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const safeIndex = Math.min(index, tracks.length - 1);
  const track = tracks[safeIndex];
  const src = track ? urls.get(track.id) : undefined;

  useEffect(() => {
    setCurrent(0);
    setDuration(0);
    setFailed(false);
  }, [src]);

  if (!track) return null;

  const play = () => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    setFailed(false);
    void audio.play().catch(() => {
      setPlaying(false);
      setFailed(true);
    });
  };

  const selectTrack = (next: number) => {
    audioRef.current?.pause();
    setPlaying(false);
    setIndex(next);
  };

  return (
    <Box sx={cardSx(theme)} data-testid="composer-audio-card">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => {
          const next = audioRef.current?.duration || 0;
          if (Number.isFinite(next)) setDuration(next);
        }}
        onDurationChange={() => {
          const next = audioRef.current?.duration || 0;
          if (Number.isFinite(next) && next > 0) setDuration(next);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          if (src) setFailed(true);
        }}
        onEnded={() => {
          setPlaying(false);
          if (safeIndex + 1 < tracks.length) selectTrack(safeIndex + 1);
        }}
      />
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1.25,
          minWidth: 0,
          width: '100%',
        }}
      >
        <CoverButton
          draft={track}
          kind="audio"
          size={56}
          preparing={preparingId === track.id}
          disabled={actionProps.disabled}
          onPick={() => onPickCover(track.id)}
          fallback="♪"
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 15, fontWeight: 700 }}>
            {draftTitle(track)}
          </Typography>
          {userName ? (
            <Typography variant="caption" color="text.secondary" noWrap>
              {userName}
            </Typography>
          ) : null}
        </Box>
      </Box>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 0.75,
          minWidth: 0,
          width: '100%',
        }}
      >
        <IconButton
          size="small"
          color="primary"
          aria-label={playing ? tc('audio_pause') : tc('audio_play')}
          disabled={!src}
          onClick={() => {
            if (playing) {
              audioRef.current?.pause();
              return;
            }
            play();
          }}
        >
          {playing ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
        </IconButton>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ minWidth: 32 }}
        >
          {formatTime(current)}
        </Typography>
        <Slider
          size="small"
          value={Math.min(current, duration || 0)}
          min={0}
          max={duration || 1}
          disabled={!duration}
          aria-label={tc('audio_seek')}
          onChange={(_event, value) => {
            const next = Array.isArray(value) ? value[0] : value;
            if (audioRef.current) audioRef.current.currentTime = next;
            setCurrent(next);
          }}
          sx={{
            flex: 1,
            minWidth: 0,
            '& .MuiSlider-thumb': { height: 14, width: 14 },
          }}
        />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ minWidth: 32, textAlign: 'right' }}
        >
          {formatTime(duration)}
        </Typography>
        {tracks.length === 1 ? (
          <Box sx={{ alignItems: 'center', display: 'flex', flexShrink: 0 }}>
            <FileActions
              draft={track}
              position={0}
              group={tracks}
              {...actionProps}
            />
          </Box>
        ) : null}
      </Box>
      {failed ? (
        <Typography variant="caption" color="error">
          {tc('audio_preview_failed')}
        </Typography>
      ) : null}
      {tracks.length > 1 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {tracks.map((item, position) => (
            <Box
              key={item.id}
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: 0.5,
                minWidth: 0,
                width: '100%',
              }}
            >
              <Box
                component="button"
                type="button"
                onClick={() => {
                  if (position === safeIndex) {
                    play();
                    return;
                  }
                  selectTrack(position);
                }}
                sx={{
                  alignItems: 'center',
                  background:
                    position === safeIndex
                      ? theme.palette.action.selected
                      : 'transparent',
                  border: 0,
                  borderRadius: '10px',
                  color: 'inherit',
                  cursor: 'pointer',
                  display: 'flex',
                  flex: 1,
                  font: 'inherit',
                  gap: 1,
                  minWidth: 0,
                  px: 1,
                  py: 0.75,
                  textAlign: 'left',
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ width: 18 }}
                >
                  {position + 1}
                </Typography>
                <Typography
                  noWrap
                  sx={{
                    flex: 1,
                    fontSize: 14,
                    fontWeight: position === safeIndex ? 700 : 500,
                    minWidth: 0,
                  }}
                >
                  {draftTitle(item)}
                </Typography>
              </Box>
              <FileActions
                draft={item}
                position={position}
                group={tracks}
                {...actionProps}
              />
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
};

/**
 * Files and audio as the Torq post shows them: one audio player, then a
 * card per file with its cover, title, file name, size and author.
 */
export const ComposerAttachmentCards = ({
  files,
  userName,
  disabled,
  onRemove,
  onMove,
  onEdit,
  onThumbnail,
  onError,
}: {
  files: SessionFileDraft[];
  userName: string;
  disabled?: boolean;
  onRemove: (id: string) => void;
  onMove: (fromId: string, toId: string) => void;
  onEdit: (id: string) => void;
  onThumbnail: (id: string, thumbnail: File) => void;
  onError: (message: string) => void;
}) => {
  const theme = useTheme();
  const tc = useComposerT();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pickFor = useRef<string | null>(null);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const audio = useMemo(
    () => files.filter((draft) => composerFileKind(draft) === 'audio'),
    [files]
  );
  const others = useMemo(
    () => files.filter((draft) => composerFileKind(draft) !== 'audio'),
    [files]
  );

  if (files.length === 0) return null;

  const pickCover = (id: string) => {
    pickFor.current = id;
    inputRef.current?.click();
  };
  const actionProps = { disabled, onEdit, onRemove, onMove };

  return (
    <Box
      data-testid="composer-attachments"
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        width: '100%',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/bmp,image/avif"
        hidden
        data-testid="composer-thumbnail-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const id = pickFor.current;
          event.target.value = '';
          pickFor.current = null;
          if (!file || !id) return;
          setPreparingId(id);
          void prepareTorqThumbnail(file)
            .then((prepared) => onThumbnail(id, prepared))
            .catch((err: any) => onError(err?.message || ''))
            .finally(() => setPreparingId(null));
        }}
      />
      {audio.length > 0 ? (
        <ComposerAudioPlayer
          tracks={audio}
          userName={userName}
          preparingId={preparingId}
          actionProps={actionProps}
          onPickCover={pickCover}
        />
      ) : null}
      {others.map((draft, position) => {
        const kind = composerFileKind(draft);
        const details = [
          draftFilename(draft),
          draft.file.size ? formatBytes(draft.file.size) : '',
          userName,
        ].filter(Boolean);
        return (
          <Box key={draft.id} sx={cardSx(theme)}>
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1.25,
                minWidth: 0,
                width: '100%',
              }}
            >
              <CoverButton
                draft={draft}
                kind={kind}
                size={56}
                preparing={preparingId === draft.id}
                disabled={disabled}
                onPick={() => pickCover(draft.id)}
              />
              <Box
                sx={{
                  cursor: disabled ? 'default' : 'pointer',
                  flex: '1 1 160px',
                  minWidth: 0,
                }}
                onClick={() => {
                  if (!disabled) onEdit(draft.id);
                }}
              >
                <Typography noWrap sx={{ fontSize: 15, fontWeight: 700 }}>
                  {draftTitle(draft)}
                </Typography>
                <Typography
                  color="text.secondary"
                  noWrap
                  sx={{ fontSize: 13, lineHeight: 1.45 }}
                >
                  {details.join(' · ')}
                </Typography>
              </Box>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexShrink: 0,
                  flexWrap: 'wrap',
                  gap: 0.5,
                  [theme.breakpoints.down('sm')]: {
                    justifyContent: 'flex-start',
                    pt: 0.25,
                    width: '100%',
                  },
                }}
              >
                <FileActions
                  draft={draft}
                  position={position}
                  group={others}
                  {...actionProps}
                />
              </Box>
            </Box>
          </Box>
        );
      })}
      {!disabled ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ alignSelf: 'flex-start' }}
        >
          {tc('cover_hint')}
        </Typography>
      ) : null}
    </Box>
  );
};

/** Title and file name of an attachment, as Torq's edit dialog sets them. */
export const ComposerAttachmentEditDialog = ({
  draft,
  onCancel,
  onSave,
}: {
  draft: SessionFileDraft | null;
  onCancel: () => void;
  onSave: (id: string, title: string, filename: string) => void;
}) => {
  const { t } = useTranslation(['group', 'core']);
  const tc = useComposerT();
  const [title, setTitle] = useState('');
  const [filename, setFilename] = useState('');

  useEffect(() => {
    if (!draft) return;
    setTitle(draftTitle(draft));
    setFilename(draftFilename(draft));
  }, [draft]);

  return (
    <Dialog
      open={Boolean(draft)}
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      PaperProps={{ sx: { borderRadius: '16px' } }}
    >
      <DialogTitle sx={{ fontSize: 16, fontWeight: 650, pb: 1 }}>
        {tc('attachment_dialog_title')}
      </DialogTitle>
      <DialogContent
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          pt: '8px !important',
        }}
      >
        <TextField
          label={tc('attachment_title')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          inputProps={{ maxLength: 120 }}
          fullWidth
        />
        <TextField
          label={tc('attachment_filename')}
          value={filename}
          onChange={(event) => setFilename(event.target.value)}
          inputProps={{ maxLength: 120 }}
          fullWidth
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} sx={{ textTransform: 'none' }}>
          {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
        </Button>
        <Button
          variant="contained"
          disabled={!draft || !filename.trim()}
          onClick={() => {
            if (draft) onSave(draft.id, title.trim(), filename.trim());
          }}
          sx={{ borderRadius: '999px', textTransform: 'none' }}
        >
          {t('core:action.save', { postProcess: 'capitalizeFirstChar' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
