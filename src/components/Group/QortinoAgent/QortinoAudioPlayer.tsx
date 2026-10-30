/**
 * Themed Qortino music stage — shared EarBump audio + save to device.
 */
import { useContext, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Slider,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { SAFE_AREA_TOP } from '../../../utils/mobileSafeArea';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { QORTAL_APP_CONTEXT } from '../../../App';
import {
  emitSharedEarbumpActivity,
  getSharedEarbumpAudio,
  setSharedEarbumpTrackSnapshot,
  stopSharedEarbumpAudio,
  stopSharedEarbumpPlayback,
} from '../earbumpSharedAudio';
import {
  formatMediaBytes,
  formatMediaDate,
  waitForQdnResourceReady,
  type QdnMediaItem,
} from '../../../qortinoAgent/qdnMedia';
import { saveQdnMediaToDevice } from '../../../qortinoAgent/qortinoMediaActions';

type Props = {
  item: QdnMediaItem;
  onClose: () => void;
};

const ACCENT = '#F97316';
const COOL = '#7EB6FF';

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function QortinoAudioPlayer({ item, onClose }: Props) {
  const { downloadResource } = useContext(QORTAL_APP_CONTEXT);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadLabel, setLoadLabel] = useState('Preparing…');
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const metaLine = [
    `by ${item.name}`,
    formatMediaDate(item.updated || item.created),
    formatMediaBytes(item.size),
  ]
    .filter(Boolean)
    .join(' · ');

  useEffect(() => {
    let cancelled = false;
    const audio = getSharedEarbumpAudio();
    audioRef.current = audio;
    if (!audio) {
      setError('Audio unavailable');
      setLoading(false);
      return;
    }

    const onTime = () => setProgress(audio.currentTime || 0);
    const onMeta = () => setDuration(audio.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const { url } = await waitForQdnResourceReady(item, {
          downloadResource,
          timeoutMs: 90_000,
          onProgress: (p, status) => {
            if (cancelled) return;
            setLoadLabel(
              p > 0 ? `Downloading… ${p}%` : `Preparing… (${status || 'QDN'})`
            );
          },
        });
        if (cancelled) return;
        stopSharedEarbumpAudio(audio);
        audio.src = url;
        audio.load();
        setSharedEarbumpTrackSnapshot({
          artist: item.name,
          coverColors: ['#1a1a2e', '#16213e', '#0f3460'],
          created: Date.now(),
          id: item.identifier,
          length: '',
          name: item.name,
          status: null,
          streamUrl: url,
          title: item.title,
          updated: null,
          uploaded: '',
        });
        emitSharedEarbumpActivity(true);
        await audio.play();
        setPlaying(true);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not play');
          emitSharedEarbumpActivity(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      // Closing the player must stop the shared EarBump element.
      stopSharedEarbumpPlayback();
    };
  }, [downloadResource, item]);

  const handleClose = () => {
    stopSharedEarbumpPlayback();
    onClose();
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio || loading) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  };

  const onSeek = (_: Event, value: number | number[]) => {
    const audio = audioRef.current;
    const next = Array.isArray(value) ? value[0] : value;
    if (!audio || !Number.isFinite(next)) return;
    audio.currentTime = next;
    setProgress(next);
  };

  const save = async () => {
    setToast(null);
    setActionBusy('Saving…');
    try {
      const result = await saveQdnMediaToDevice(item, {
        downloadResource,
        onProgress: setActionBusy,
      });
      setToast(result.message);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <Box
      sx={{
        background:
          'radial-gradient(120% 90% at 20% 0%, #3a2210 0%, #141018 45%, #0b0c10 100%)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          px: 1,
          pt: `calc(${SAFE_AREA_TOP} + 8px)`,
          pb: 1,
        }}
      >
        <IconButton aria-label="Close" onClick={handleClose} sx={{ color: '#fff' }}>
          <CloseRoundedIcon />
        </IconButton>
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          gap: 2,
          justifyContent: 'center',
          px: 2.5,
          pb: 2,
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            background: `linear-gradient(145deg, ${alpha(ACCENT, 0.55)}, ${alpha(COOL, 0.25)})`,
            border: `1px solid ${alpha(ACCENT, 0.4)}`,
            borderRadius: '28px',
            boxShadow: `0 20px 50px ${alpha('#000', 0.45)}`,
            display: 'flex',
            height: 180,
            justifyContent: 'center',
            width: 180,
          }}
        >
          {loading ? (
            <CircularProgress sx={{ color: '#fff' }} />
          ) : (
            <IconButton
              onClick={toggle}
              sx={{
                background: alpha('#000', 0.28),
                color: '#fff',
                '&:hover': { background: alpha('#000', 0.4) },
              }}
            >
              {playing ? (
                <PauseRoundedIcon sx={{ fontSize: 54 }} />
              ) : (
                <PlayArrowRoundedIcon sx={{ fontSize: 54 }} />
              )}
            </IconButton>
          )}
        </Box>

        <Box sx={{ textAlign: 'center', width: '100%', maxWidth: 360 }}>
          <Typography sx={{ color: '#fff', fontSize: '1.15rem', fontWeight: 800 }}>
            {item.title}
          </Typography>
          <Typography sx={{ color: alpha('#fff', 0.55), fontSize: '0.78rem', mt: 0.4 }}>
            {loading ? loadLabel : metaLine}
          </Typography>
        </Box>

        <Box sx={{ width: '100%', maxWidth: 360, px: 0.5 }}>
          <Slider
            size="small"
            min={0}
            max={duration > 0 ? duration : 1}
            value={progress}
            disabled={loading || !duration}
            onChange={onSeek}
            sx={{
              color: ACCENT,
              '& .MuiSlider-thumb': { width: 14, height: 14 },
            }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ color: alpha('#fff', 0.5), fontSize: '0.7rem' }}>
              {fmtTime(progress)}
            </Typography>
            <Typography sx={{ color: alpha('#fff', 0.5), fontSize: '0.7rem' }}>
              {fmtTime(duration)}
            </Typography>
          </Box>
        </Box>

        {error ? (
          <Typography sx={{ color: '#ff8f8f', fontSize: '0.8rem' }}>{error}</Typography>
        ) : null}

        <Button
          variant="contained"
          startIcon={
            actionBusy ? (
              <CircularProgress size={16} sx={{ color: '#fff' }} />
            ) : (
              <DownloadRoundedIcon />
            )
          }
          disabled={!!actionBusy || loading}
          onClick={() => void save()}
          sx={{
            background: alpha(ACCENT, 0.92),
            borderRadius: '12px',
            fontWeight: 700,
            minWidth: 180,
            textTransform: 'none',
            '&:hover': { background: ACCENT },
          }}
        >
          Save to device
        </Button>
        {actionBusy ? (
          <Typography sx={{ color: alpha('#fff', 0.65), fontSize: '0.75rem' }}>
            {actionBusy}
          </Typography>
        ) : null}
        {toast ? (
          <Typography sx={{ color: '#C9E8D4', fontSize: '0.75rem', textAlign: 'center' }}>
            {toast}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
