/**
 * Themed Qortino video stage: progress/time, playback speed, fullscreen with
 * orientation lock (landscape for wide videos, portrait for vertical).
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Slider,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import AudioFileRoundedIcon from '@mui/icons-material/AudioFileRounded';
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded';
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { useAtomValue } from 'jotai';
import { QORTAL_APP_CONTEXT } from '../../../App';
import { resourceKeySelector } from '../../../atoms/global';
import type { QdnMediaItem } from '../../../qortinoAgent/qdnMedia';
import {
  buildMediaStreamUrl,
  fetchQtubePosterDataUrl,
  formatMediaBytes,
  formatMediaDate,
  isSafeQortinoImageSrc,
} from '../../../qortinoAgent/qdnMedia';
import {
  extractAudioFromQdnVideo,
  saveQdnMediaToDevice,
} from '../../../qortinoAgent/qortinoMediaActions';
import {
  SAFE_AREA_BOTTOM,
  SAFE_AREA_TOP,
} from '../../../utils/mobileSafeArea';
import { getGoLayout, isGoLayout } from '../../../layout/goLayout';

type Props = {
  item: QdnMediaItem;
  onClose: () => void;
};

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

const ACCENT = '#7EB6FF';
const WARM = '#C9E8D4';
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

async function lockOrientationForVideo(video: HTMLVideoElement | null) {
  if (!video || !Capacitor.isNativePlatform()) return;
  // GO tablets show video well either way up; turning one would only
  // reflow the whole app behind the player.
  if (isGoLayout() && getGoLayout().largeScreen) return;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;
  try {
    await ScreenOrientation.lock({
      orientation: w >= h ? 'landscape' : 'portrait',
    });
  } catch {
    /* WebView / OS may refuse lock */
  }
}

async function unlockOrientation() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await ScreenOrientation.unlock();
  } catch {
    /* ignore */
  }
}

export function QortinoVideoPlayer({ item, onClose }: Props) {
  const { downloadResource } = useContext(QORTAL_APP_CONTEXT);
  const key = `${item.service}-${item.name}-${item.identifier}`;
  const download = useAtomValue(resourceKeySelector(key));
  const status = download?.status || {};
  const statusName = String(status.status || '');
  const local = Number(status.localChunkCount || 0);
  const total = Number(status.totalChunkCount || 0);
  const percent =
    total > 0 ? Math.min(100, Math.round((local / total) * 100)) : statusName ? 5 : 0;

  // N-43: a poster URL from QDN metadata may point at any server; only one
  // that cannot reach a third party is shown.
  const safeThumbnail = isSafeQortinoImageSrc(item.thumbnailUrl)
    ? item.thumbnailUrl
    : undefined;
  const [poster, setPoster] = useState<string | undefined>(safeThumbnail);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [speedAnchor, setSpeedAnchor] = useState<null | HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [aspect, setAspect] = useState<'landscape' | 'portrait' | 'square'>('landscape');
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const src = useMemo(
    () => buildMediaStreamUrl(item, false),
    [item.identifier, item.name, item.service]
  );

  const metaLine = [
    `by ${item.name}`,
    formatMediaDate(item.updated || item.created),
    formatMediaBytes(item.size),
  ]
    .filter(Boolean)
    .join(' · ');

  useEffect(() => {
    downloadResource?.({
      name: item.name,
      service: item.service,
      identifier: item.identifier,
    });
    let cancelled = false;
    (async () => {
      if (safeThumbnail) {
        setPoster(safeThumbnail);
        return;
      }
      const dataUrl = await fetchQtubePosterDataUrl(item.name, item.identifier, {
        downloadResource,
        timeoutMs: 14_000,
      });
      if (!cancelled && dataUrl) setPoster(dataUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    downloadResource,
    item.identifier,
    item.name,
    item.service,
    safeThumbnail,
  ]);

  useEffect(() => {
    if (statusName === 'READY') setReady(true);
  }, [statusName]);

  useEffect(() => {
    if (!ready || !videoRef.current) return;
    videoRef.current.src = src;
    videoRef.current.playbackRate = playbackRate;
    void videoRef.current
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }, [ready, src]); // eslint-disable-line react-hooks/exhaustive-deps -- rate applied separately

  useEffect(() => {
    const el = videoRef.current;
    if (el) el.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const onFs = () => {
      const active = !!(
        document.fullscreenElement ||
        (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement
      );
      setIsFullscreen(active);
      if (!active) void unlockOrientation();
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
      void unlockOrientation();
    };
  }, []);

  const enterFullscreen = useCallback(async () => {
    const el = stageRef.current || videoRef.current;
    if (!el) return;
    const anyEl = el as HTMLElement & {
      webkitRequestFullscreen?: () => void;
    };
    try {
      if (anyEl.requestFullscreen) await anyEl.requestFullscreen();
      else if (anyEl.webkitRequestFullscreen) anyEl.webkitRequestFullscreen();
    } catch {
      /* ignore */
    }
    await lockOrientationForVideo(videoRef.current);
  }, []);

  const exitFullscreen = useCallback(async () => {
    const doc = document as Document & { webkitExitFullscreen?: () => void };
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      }
    } catch {
      /* ignore */
    }
    await unlockOrientation();
  }, []);

  const toggleFullscreen = () => {
    if (isFullscreen) void exitFullscreen();
    else void enterFullscreen();
  };

  const toggle = () => {
    const el = videoRef.current;
    if (!el || !ready) return;
    if (el.paused) {
      void el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  const onSeek = (_: Event, value: number | number[]) => {
    const el = videoRef.current;
    const next = Array.isArray(value) ? value[0] : value;
    if (!el || !Number.isFinite(next)) return;
    el.currentTime = next;
    setProgress(next);
  };

  const onLoadedMeta = () => {
    const el = videoRef.current;
    if (!el) return;
    setDuration(el.duration || 0);
    const w = el.videoWidth;
    const h = el.videoHeight;
    if (w && h) {
      if (w > h * 1.05) setAspect('landscape');
      else if (h > w * 1.05) setAspect('portrait');
      else setAspect('square');
    }
  };

  const runAction = async (kind: 'save' | 'extract') => {
    setToast(null);
    setActionBusy(kind === 'save' ? 'Saving…' : 'Extracting audio…');
    try {
      const result =
        kind === 'save'
          ? await saveQdnMediaToDevice(item, {
              downloadResource,
              onProgress: setActionBusy,
            })
          : await extractAudioFromQdnVideo(item, {
              downloadResource,
              onProgress: setActionBusy,
            });
      setToast(result.message);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActionBusy(null);
    }
  };

  const handleClose = () => {
    void exitFullscreen();
    const el = videoRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    onClose();
  };

  const downloading = !ready && statusName !== 'FAILED_TO_DOWNLOAD';
  const stageAspect =
    aspect === 'portrait' ? '9 / 16' : aspect === 'square' ? '1 / 1' : '16 / 9';

  return (
    <Box
      sx={{
        background:
          'radial-gradient(120% 80% at 50% 0%, #1a2740 0%, #0b0e14 48%, #07090d 100%)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        position: 'relative',
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1,
          px: 1.25,
          pt: `calc(${SAFE_AREA_TOP} + 8px)`,
          pb: 0.75,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              color: '#fff',
              fontSize: '1rem',
              fontWeight: 800,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.title}
          </Typography>
          <Typography sx={{ color: alpha('#fff', 0.55), fontSize: '0.72rem', mt: 0.15 }}>
            {metaLine}
          </Typography>
        </Box>
        <IconButton aria-label="Close" onClick={handleClose} sx={{ color: '#fff' }}>
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
          px: isFullscreen ? 0 : 1.5,
          py: isFullscreen ? 0 : 1,
        }}
      >
        <Box
          ref={stageRef}
          sx={{
            background: '#050608',
            border: isFullscreen ? 'none' : `1px solid ${alpha(ACCENT, 0.28)}`,
            borderRadius: isFullscreen ? 0 : '18px',
            boxShadow: isFullscreen
              ? 'none'
              : `0 18px 50px ${alpha('#000', 0.55)}, 0 0 0 1px ${alpha(WARM, 0.06)}`,
            height: isFullscreen ? '100%' : undefined,
            maxHeight: '100%',
            maxWidth: isFullscreen ? '100%' : 720,
            overflow: 'hidden',
            position: 'relative',
            width: '100%',
            aspectRatio: isFullscreen ? undefined : stageAspect,
          }}
        >
          {poster ? (
            <Box
              component="img"
              alt=""
              src={poster}
              sx={{
                height: '100%',
                left: 0,
                objectFit: 'cover',
                opacity: ready && playing ? 0 : 0.85,
                position: 'absolute',
                top: 0,
                transition: 'opacity 0.25s ease',
                width: '100%',
              }}
            />
          ) : (
            <Box
              sx={{
                background: `radial-gradient(circle at 30% 20%, ${alpha(ACCENT, 0.35)} 0%, #121212 55%, #0a0a0a 100%)`,
                inset: 0,
                position: 'absolute',
              }}
            />
          )}

          <Box
            component="video"
            ref={videoRef}
            controls={false}
            playsInline
            preload="metadata"
            poster={poster}
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={() => setProgress(videoRef.current?.currentTime || 0)}
            onLoadedMetadata={onLoadedMeta}
            onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
            sx={{
              display: ready ? 'block' : 'none',
              height: '100%',
              objectFit: 'contain',
              position: 'relative',
              width: '100%',
              zIndex: 1,
              background: '#000',
            }}
          />

          {downloading ? (
            <Box
              sx={{
                alignItems: 'center',
                background: alpha('#000', 0.5),
                display: 'flex',
                flexDirection: 'column',
                gap: 1.25,
                inset: 0,
                justifyContent: 'center',
                position: 'absolute',
                zIndex: 2,
              }}
            >
              <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                <CircularProgress
                  variant={percent > 0 ? 'determinate' : 'indeterminate'}
                  value={percent}
                  size={76}
                  thickness={3.4}
                  sx={{ color: ACCENT }}
                />
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    inset: 0,
                    justifyContent: 'center',
                    position: 'absolute',
                  }}
                >
                  <Typography sx={{ color: '#fff', fontSize: '0.95rem', fontWeight: 800 }}>
                    {percent > 0 ? `${percent}%` : '…'}
                  </Typography>
                </Box>
              </Box>
              <Typography sx={{ color: alpha('#fff', 0.9), fontSize: '0.85rem', fontWeight: 600 }}>
                {statusName === 'DOWNLOADED'
                  ? 'Building video…'
                  : statusName === 'REFETCHING'
                    ? 'Refetching chunks…'
                    : 'Downloading from QDN…'}
              </Typography>
            </Box>
          ) : null}

          {statusName === 'FAILED_TO_DOWNLOAD' ? (
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                inset: 0,
                justifyContent: 'center',
                position: 'absolute',
                zIndex: 2,
              }}
            >
              <Typography sx={{ color: '#fff' }}>Download failed</Typography>
              <IconButton
                onClick={() =>
                  downloadResource?.({
                    name: item.name,
                    service: item.service,
                    identifier: item.identifier,
                  })
                }
                sx={{ color: ACCENT }}
              >
                <PlayArrowRoundedIcon />
              </IconButton>
            </Box>
          ) : null}

          {ready ? (
            <IconButton
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
              sx={{
                background: alpha('#000', playing ? 0.28 : 0.5),
                border: `1px solid ${alpha(ACCENT, playing ? 0.25 : 0.45)}`,
                color: '#fff',
                left: '50%',
                opacity: playing ? 0 : 1,
                pointerEvents: playing ? 'none' : 'auto',
                position: 'absolute',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                transition: 'opacity 0.2s ease',
                zIndex: 3,
                '&:hover': { background: alpha('#000', 0.65), opacity: 1 },
              }}
            >
              {playing ? (
                <PauseRoundedIcon sx={{ fontSize: 44 }} />
              ) : (
                <PlayArrowRoundedIcon sx={{ fontSize: 44 }} />
              )}
            </IconButton>
          ) : null}
        </Box>
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          px: 1.5,
          pb: `max(16px, ${SAFE_AREA_BOTTOM})`,
          pt: 0.5,
        }}
      >
        {ready ? (
          <Box sx={{ width: '100%' }}>
            <Slider
              size="small"
              min={0}
              max={duration > 0 ? duration : 1}
              value={progress}
              disabled={!duration}
              onChange={onSeek}
              sx={{
                color: ACCENT,
                py: 0.5,
                '& .MuiSlider-thumb': { width: 14, height: 14 },
              }}
            />
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: 0.5,
                justifyContent: 'space-between',
              }}
            >
              <Typography sx={{ color: alpha('#fff', 0.65), fontSize: '0.72rem', minWidth: 72 }}>
                {fmtTime(progress)} / {fmtTime(duration)}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                <IconButton
                  size="small"
                  onClick={toggle}
                  sx={{ color: '#fff' }}
                  aria-label={playing ? 'Pause' : 'Play'}
                >
                  {playing ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
                </IconButton>
                <Button
                  size="small"
                  onClick={(e) => setSpeedAnchor(e.currentTarget)}
                  sx={{
                    color: '#fff',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    minWidth: 44,
                    textTransform: 'none',
                  }}
                >
                  {playbackRate}x
                </Button>
                <Menu
                  anchorEl={speedAnchor}
                  open={Boolean(speedAnchor)}
                  onClose={() => setSpeedAnchor(null)}
                  anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                  transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                >
                  {SPEED_OPTIONS.map((rate) => (
                    <MenuItem
                      key={rate}
                      selected={rate === playbackRate}
                      onClick={() => {
                        setPlaybackRate(rate);
                        setSpeedAnchor(null);
                      }}
                    >
                      {rate}x
                    </MenuItem>
                  ))}
                </Menu>
                <IconButton
                  size="small"
                  onClick={toggleFullscreen}
                  sx={{ color: '#fff' }}
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                >
                  {isFullscreen ? (
                    <FullscreenExitRoundedIcon />
                  ) : (
                    <FullscreenRoundedIcon />
                  )}
                </IconButton>
              </Box>
            </Box>
          </Box>
        ) : null}

        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            startIcon={
              actionBusy?.toLowerCase().includes('sav') ||
              actionBusy?.toLowerCase().includes('fetch') ||
              actionBusy?.toLowerCase().includes('prepar') ? (
                <CircularProgress size={16} sx={{ color: '#fff' }} />
              ) : (
                <DownloadRoundedIcon />
              )
            }
            disabled={!!actionBusy}
            onClick={() => void runAction('save')}
            sx={{
              background: alpha(ACCENT, 0.9),
              borderRadius: '12px',
              flex: 1,
              fontWeight: 700,
              minWidth: 140,
              textTransform: 'none',
              '&:hover': { background: ACCENT },
            }}
          >
            Save to device
          </Button>
          <Button
            variant="outlined"
            startIcon={
              actionBusy?.toLowerCase().includes('extract') ||
              actionBusy?.toLowerCase().includes('audio') ||
              actionBusy?.toLowerCase().includes('cach') ? (
                <CircularProgress size={16} sx={{ color: WARM }} />
              ) : (
                <AudioFileRoundedIcon />
              )
            }
            disabled={!!actionBusy}
            onClick={() => void runAction('extract')}
            sx={{
              borderColor: alpha(WARM, 0.55),
              borderRadius: '12px',
              color: WARM,
              flex: 1,
              fontWeight: 700,
              minWidth: 140,
              textTransform: 'none',
              '&:hover': {
                borderColor: WARM,
                background: alpha(WARM, 0.08),
              },
            }}
          >
            Extract audio
          </Button>
        </Box>
        {actionBusy ? (
          <Typography sx={{ color: alpha('#fff', 0.7), fontSize: '0.78rem', textAlign: 'center' }}>
            {actionBusy}
          </Typography>
        ) : null}
        {toast ? (
          <Typography
            sx={{
              color: toast.toLowerCase().includes('fail') ? '#ff8f8f' : WARM,
              fontSize: '0.78rem',
              textAlign: 'center',
            }}
          >
            {toast}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
