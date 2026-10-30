import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppBar,
  Box,
  Button,
  Dialog,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Slide,
  TextField,
  Toolbar,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { TransitionProps } from '@mui/material/transitions';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { forwardRef } from 'react';
import {
  SAFE_AREA_BOTTOM,
  SAFE_AREA_TOP,
} from '../../../utils/mobileSafeArea';
import {
  compressThumbnailFileToBase64,
  extractVideoHoverFrames,
  extractVideoThumbnailBase64,
  QUITTER_VIDEO_CATEGORIES,
  quitterThumbSrc,
} from './quitterPublish';
import {
  canUseNativeVideoCompress,
  formatBytes,
  listCompressPresets,
  planVideoCompression,
  type CompressLevel,
} from './quitterVideoCompress';

const Transition = forwardRef(function Transition(
  props: TransitionProps & { children: React.ReactElement },
  ref: React.Ref<unknown>
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

export type QuitterVideoEditorValue = {
  title: string;
  description: string;
  category: number;
  duration: number;
  videoImage?: string;
  extracts?: string[];
  compressLevel: CompressLevel;
};

type QuitterVideoEditorDialogProps = {
  open: boolean;
  previewUrl: string;
  size: number;
  fileName: string;
  mimeType?: string;
  initial: QuitterVideoEditorValue;
  onCancel: () => void;
  onConfirm: (value: QuitterVideoEditorValue) => void;
};

export const QuitterVideoEditorDialog = ({
  open,
  previewUrl,
  size,
  fileName,
  mimeType,
  initial,
  onCancel,
  onConfirm,
}: QuitterVideoEditorDialogProps) => {
  const theme = useTheme();
  const videoRef = useRef<HTMLVideoElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [category, setCategory] = useState(initial.category);
  const [duration, setDuration] = useState(initial.duration);
  const [videoImage, setVideoImage] = useState(initial.videoImage);
  const [extracts, setExtracts] = useState<string[]>(initial.extracts || []);
  const [selectedExtract, setSelectedExtract] = useState(0);
  const [compressLevel, setCompressLevel] = useState<CompressLevel>(
    initial.compressLevel || 'high'
  );
  const [thumbBusy, setThumbBusy] = useState(false);
  const [error, setError] = useState('');
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false);

  const presets = useMemo(
    () => listCompressPresets(size, duration || undefined),
    [size, duration]
  );
  const plan = useMemo(
    () =>
      planVideoCompression(
        size,
        mimeType,
        fileName,
        compressLevel,
        duration || undefined
      ),
    [size, mimeType, fileName, compressLevel, duration]
  );
  const nativeCompress = canUseNativeVideoCompress();

  // Only hydrate from props when the dialog opens. Parent rebuilds `initial` on
  // every render (keyboard/safe-area/etc.), and depending on that object was
  // wiping the extracted thumbnail → black poster when focusing the title field.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;
    setTitle(initial.title);
    setDescription(initial.description);
    setCategory(initial.category);
    setDuration(initial.duration);
    setVideoImage(initial.videoImage);
    setExtracts(initial.extracts || []);
    setSelectedExtract(0);
    setCompressLevel(initial.compressLevel || 'high');
    setHasStartedPlayback(false);
    setError('');
  }, [open, initial]);

  // Extract first frame ASAP for the cover, then fill remaining hover frames.
  useEffect(() => {
    if (!open || !previewUrl) return;
    if (extracts.length >= 4 && videoImage) return;
    let cancelled = false;
    let gotFirstFrame = Boolean(videoImage);
    setThumbBusy(true);
    void (async () => {
      try {
        // 1) Instant cover from the first readable frame (don't wait for all 4).
        if (!gotFirstFrame) {
          try {
            const first = await extractVideoThumbnailBase64(previewUrl, 0.08);
            if (cancelled) return;
            if (first.duration) setDuration(first.duration);
            if (first.videoImage) {
              gotFirstFrame = true;
              setVideoImage(first.videoImage);
              setExtracts([first.videoImage]);
              setSelectedExtract(0);
            }
          } catch {
            // continue to hover extraction
          }
        }

        // 2) Remaining hover snapshots (progressive).
        const frames = await extractVideoHoverFrames(previewUrl, {
          onFrame: (frame, index) => {
            if (cancelled) return;
            setExtracts((prev) => {
              const next = prev.slice();
              next[index] = frame;
              return next;
            });
            if (index === 0) {
              setVideoImage((current) => current || frame);
              setSelectedExtract((sel) => (sel < 0 ? sel : 0));
            }
          },
        });
        if (cancelled) return;
        if (frames.length > 0) {
          setExtracts(frames);
          setVideoImage((current) => current || frames[0]);
          setSelectedExtract((sel) => (sel < 0 ? sel : 0));
        } else if (!gotFirstFrame) {
          const meta = await extractVideoThumbnailBase64(previewUrl);
          if (cancelled) return;
          if (meta.duration) setDuration(meta.duration);
          if (meta.videoImage) setVideoImage(meta.videoImage);
        }
      } catch {
        if (cancelled || gotFirstFrame) return;
        try {
          const meta = await extractVideoThumbnailBase64(previewUrl);
          if (cancelled) return;
          if (meta.duration) setDuration(meta.duration);
          if (meta.videoImage) setVideoImage(meta.videoImage);
        } catch {
          // ignore
        }
      } finally {
        if (!cancelled) setThumbBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, previewUrl]);

  const thumbPreview = quitterThumbSrc(videoImage);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !open) return;
    // Avoid thrashing poster on unrelated re-renders; only set when we have a thumb.
    if (thumbPreview) {
      if (el.getAttribute('poster') !== thumbPreview) {
        el.setAttribute('poster', thumbPreview);
      }
    }
  }, [thumbPreview, open]);

  const captureFrame = async () => {
    const el = videoRef.current;
    if (!el) return;
    setThumbBusy(true);
    setError('');
    try {
      const meta = await extractVideoThumbnailBase64(
        previewUrl,
        el.currentTime || 0
      );
      if (meta.videoImage) {
        setVideoImage(meta.videoImage);
        setSelectedExtract(-1);
      }
      if (meta.duration) setDuration(meta.duration);
    } catch {
      setError('Could not capture thumbnail from this frame');
    } finally {
      setThumbBusy(false);
    }
  };

  const handleCustomThumb = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') || file.type === 'image/gif') {
      setError('Choose a JPEG or PNG thumbnail');
      return;
    }
    setThumbBusy(true);
    setError('');
    try {
      const base64 = await compressThumbnailFileToBase64(file);
      setVideoImage(base64);
      setSelectedExtract(-1);
    } catch {
      setError('Failed to process thumbnail image');
    } finally {
      setThumbBusy(false);
    }
  };

  const canSave = title.trim().length > 0 && category > 0;

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onCancel}
      TransitionComponent={Transition}
      PaperProps={{
        sx: {
          backgroundColor:
            theme.palette.mode === 'dark'
              ? 'rgb(22, 24, 28)'
              : theme.palette.background.default,
        },
      }}
    >
      <AppBar
        elevation={0}
        position="sticky"
        sx={{
          backgroundColor:
            theme.palette.mode === 'dark'
              ? 'rgb(28, 30, 36)'
              : theme.palette.background.paper,
          borderBottom: `1px solid ${theme.palette.divider}`,
          color: theme.palette.text.primary,
          paddingTop: SAFE_AREA_TOP,
        }}
      >
        <Toolbar
          sx={{
            alignItems: 'center',
            gap: 1,
            minHeight: 56,
            px: 1.5,
          }}
        >
          <IconButton edge="start" onClick={onCancel} aria-label="Close">
            <CloseRoundedIcon />
          </IconButton>
          <Box sx={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
            <Typography
              sx={{
                fontWeight: 700,
                fontSize: 17,
                lineHeight: 1.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              Edit video
            </Typography>
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: 12,
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              Quitter & Q-Tube · {formatBytes(size)}
            </Typography>
          </Box>
          <Button
            variant="contained"
            disabled={!canSave}
            startIcon={<CheckRoundedIcon />}
            onClick={() =>
              onConfirm({
                title: title.trim().slice(0, 50),
                description,
                category,
                duration,
                videoImage,
                extracts:
                  extracts.length > 0
                    ? extracts
                    : videoImage
                      ? [videoImage, videoImage, videoImage, videoImage]
                      : [],
                compressLevel,
              })
            }
            sx={{
              borderRadius: '999px',
              flexShrink: 0,
              fontWeight: 650,
              minWidth: 0,
              px: 2,
              textTransform: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Done
          </Button>
        </Toolbar>
      </AppBar>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          pb: `calc(${SAFE_AREA_BOTTOM} + 24px)`,
          px: 2,
          pt: 2,
        }}
      >
        <Box
          sx={{
            aspectRatio: '16 / 9',
            backgroundColor: '#000',
            borderRadius: '14px',
            maxHeight: '42vh',
            overflow: 'hidden',
            position: 'relative',
            width: '100%',
          }}
        >
          <Box
            component="video"
            ref={videoRef}
            key={previewUrl}
            src={previewUrl}
            poster={thumbPreview || undefined}
            controls={hasStartedPlayback}
            playsInline
            preload="metadata"
            onPlay={() => setHasStartedPlayback(true)}
            sx={{
              display: 'block',
              height: '100%',
              objectFit: 'contain',
              width: '100%',
            }}
          />
          {!hasStartedPlayback ? (
            <Box
              onClick={() => {
                const el = videoRef.current;
                if (!el) return;
                setHasStartedPlayback(true);
                void el.play().catch(() => undefined);
              }}
              sx={{
                alignItems: 'center',
                backgroundColor: '#000',
                backgroundImage: thumbPreview
                  ? `url(${thumbPreview})`
                  : undefined,
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                backgroundSize: 'contain',
                cursor: 'pointer',
                display: 'flex',
                height: '100%',
                justifyContent: 'center',
                left: 0,
                position: 'absolute',
                top: 0,
                width: '100%',
                zIndex: 1,
              }}
              aria-label="Play video"
            >
              <Box
                sx={{
                  alignItems: 'center',
                  aspectRatio: '1 / 1',
                  backgroundColor: 'rgba(0,0,0,0.45)',
                  borderRadius: '50%',
                  display: 'flex',
                  flexShrink: 0,
                  height: 56,
                  justifyContent: 'center',
                  width: 56,
                }}
              >
                <Box
                  sx={{
                    borderBottom: '10px solid transparent',
                    borderLeft: `16px solid ${theme.palette.common.white}`,
                    borderTop: '10px solid transparent',
                    height: 0,
                    ml: '3px',
                    width: 0,
                  }}
                />
              </Box>
            </Box>
          ) : null}
        </Box>

        <Box
          sx={{
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.25,
            p: 1.5,
          }}
        >
          <Typography sx={{ fontSize: 14, fontWeight: 650 }}>
            Q-Tube thumbnail & hover frames
          </Typography>
          <Typography
            sx={{ color: theme.palette.text.secondary, fontSize: 12, mt: -0.5 }}
          >
            {thumbBusy
              ? 'Extracting hover snapshots…'
              : 'These 4 frames cycle on hover in Q-Tube. Tap one for the cover.'}
          </Typography>
          {extracts.length > 0 ? (
            <Box
              sx={{
                display: 'grid',
                gap: 1,
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              }}
            >
              {extracts.slice(0, 4).map((frame, index) => {
                const selected = selectedExtract === index;
                return (
                  <Box
                    key={`extract-${index}`}
                    onClick={() => {
                      setSelectedExtract(index);
                      setVideoImage(frame);
                    }}
                    sx={{
                      aspectRatio: '4 / 3',
                      backgroundColor: alpha(theme.palette.text.primary, 0.06),
                      backgroundImage: `url(${quitterThumbSrc(frame)})`,
                      backgroundPosition: 'center',
                      backgroundSize: 'cover',
                      border: selected
                        ? `2px solid ${theme.palette.primary.main}`
                        : `1px solid ${theme.palette.divider}`,
                      borderRadius: '10px',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    {selected ? (
                      <Box
                        sx={{
                          alignItems: 'center',
                          backgroundColor: theme.palette.primary.main,
                          borderRadius: '999px',
                          color: theme.palette.primary.contrastText,
                          display: 'flex',
                          fontSize: 11,
                          fontWeight: 700,
                          height: 18,
                          justifyContent: 'center',
                          position: 'absolute',
                          right: 4,
                          top: 4,
                          width: 18,
                        }}
                      >
                        ✓
                      </Box>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          ) : (
            <Box
              sx={{
                backgroundColor: alpha(theme.palette.text.primary, 0.06),
                backgroundImage: thumbPreview
                  ? `url(${thumbPreview})`
                  : undefined,
                backgroundPosition: 'center',
                backgroundSize: 'cover',
                borderRadius: '12px',
                height: 96,
                width: 160,
              }}
            />
          )}
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="outlined"
              disabled={thumbBusy}
              startIcon={<PhotoCameraOutlinedIcon />}
              onClick={() => void captureFrame()}
              sx={{ textTransform: 'none' }}
            >
              Capture current frame
            </Button>
            <input
              ref={thumbInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => {
                void handleCustomThumb(event.target.files);
                event.target.value = '';
              }}
            />
            <Button
              size="small"
              variant="outlined"
              disabled={thumbBusy}
              startIcon={<ImageOutlinedIcon />}
              onClick={() => thumbInputRef.current?.click()}
              sx={{ textTransform: 'none' }}
            >
              Custom cover
            </Button>
          </Box>
        </Box>

        <TextField
          label="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value.slice(0, 50))}
          fullWidth
          required
          helperText={`${title.length}/50`}
        />

        <TextField
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          fullWidth
          multiline
          minRows={4}
          maxRows={10}
          placeholder="Describe this video for Q-Tube viewers…"
        />

        <FormControl fullWidth>
          <InputLabel id="quitter-video-editor-category">Category</InputLabel>
          <Select
            labelId="quitter-video-editor-category"
            label="Category"
            value={category}
            onChange={(event) => setCategory(Number(event.target.value))}
          >
            {QUITTER_VIDEO_CATEGORIES.map((cat) => (
              <MenuItem key={cat.id} value={cat.id}>
                {cat.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Box
          sx={{
            backgroundColor: alpha(theme.palette.primary.main, 0.06),
            border: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            p: 1.5,
          }}
        >
          <Typography sx={{ fontSize: 13, fontWeight: 650 }}>
            {plan.label}
          </Typography>
          <Typography
            sx={{ color: theme.palette.text.secondary, fontSize: 12.5 }}
          >
            {compressLevel === 'none'
              ? 'Original file will be published as-is. Large or non-MP4 files may publish slowly or fail on Quitter.'
              : 'Compresses in the background after Done so you can keep writing your post.'}
          </Typography>
          {nativeCompress ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
              }}
            >
              {presets.map((preset) => (
                <Button
                  key={preset.level}
                  size="small"
                  variant={
                    compressLevel === preset.level ? 'contained' : 'outlined'
                  }
                  onClick={() => setCompressLevel(preset.level)}
                  sx={{
                    justifyContent: 'flex-start',
                    textTransform: 'none',
                  }}
                >
                  {preset.label} · ~{formatBytes(preset.estimatedBytes)}
                  <Box
                    component="span"
                    sx={{
                      color:
                        compressLevel === preset.level
                          ? 'inherit'
                          : theme.palette.text.secondary,
                      fontSize: 12,
                      ml: 1,
                      opacity: 0.9,
                    }}
                  >
                    {preset.detail}
                  </Box>
                </Button>
              ))}
              <Button
                size="small"
                variant={compressLevel === 'none' ? 'contained' : 'outlined'}
                color={compressLevel === 'none' ? 'warning' : 'inherit'}
                onClick={() => setCompressLevel('none')}
                sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
              >
                Skip compression · {formatBytes(size)}
              </Button>
            </Box>
          ) : null}
        </Box>

        {error ? (
          <Typography sx={{ color: theme.palette.error.main, fontSize: 13 }}>
            {error}
          </Typography>
        ) : null}
      </Box>
    </Dialog>
  );
};
