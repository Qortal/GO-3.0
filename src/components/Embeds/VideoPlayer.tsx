import {
  FC,
  KeyboardEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactDOM from 'react-dom';
import { Box, Button, IconButton, Slider, Menu, MenuItem } from '@mui/material';
import { CircularProgress, Typography } from '@mui/material';
import { Key } from 'ts-key-enum';
import {
  PlayArrow,
  Pause,
  VolumeUp,
  Fullscreen,
  FullscreenExit,
  Replay10,
  Forward10,
  VolumeOff,
} from '@mui/icons-material';
import { styled } from '@mui/system';
import { Refresh } from '@mui/icons-material';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import {
  resourceDownloadControllerAtom,
  resourceKeySelector,
} from '../../atoms/global';

import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { appHeighOffset } from '../Desktop/CustomTitleBar';

const VideoContainer = styled(Box)`
  align-items: center;
  display: flex;
  flex-direction: column;
  height: 100%;
  justify-content: center;
  margin: 0px;
  padding: 0px;
  position: relative;
  width: 100%;
`;

const VideoElement = styled('video')`
  background: rgb(33, 33, 33);
  height: auto;
  max-height: calc(100vh - ${150 + appHeighOffset}px);
  width: 100%;
`;

const ControlsContainer = styled(Box)`
  align-items: center;
  background-color: rgba(0, 0, 0, 0.6);
  bottom: 0;
  display: flex;
  justify-content: space-between;
  left: 0;
  padding: 8px;
  position: absolute;
  right: 0;
`;

const encodeQdnPathSegment = (value: string) => {
  try {
    return encodeURIComponent(decodeURIComponent(value));
  } catch {
    return encodeURIComponent(value);
  }
};

interface VideoPlayerProps {
  autoplay?: boolean;
  customStyle?: any;
  from?: string | null;
  identifier?: string;
  name?: string;
  poster?: string;
  service?: string;
  src?: string | null;
  user?: string;
}

// TODO translate and theme (optional)
export const VideoPlayer: FC<VideoPlayerProps> = ({
  autoplay = true,
  customStyle = {},
  from = null,
  identifier,
  name,
  node,
  poster,
  service,
}) => {
  const { t } = useTranslation(['core']);
  const keyIdentifier = useMemo(() => {
    if (name && identifier && service) {
      return `${service}-${name}-${identifier}`;
    } else {
      return undefined;
    }
  }, [service, name, identifier]);

  const download = useAtomValue(resourceKeySelector(keyIdentifier));
  const { downloadResource } = useContext(QORTAL_APP_CONTEXT);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [mutedVolume, setMutedVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [canPlay, setCanPlay] = useState(false);
  const [startPlay, setStartPlay] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [anchorEl, setAnchorEl] = useState(null);
  const reDownload = useRef<boolean>(false);
  const setResources = useSetAtom(resourceDownloadControllerAtom);

  const resetVideoState = () => {
    // Reset all states to their initial values
    setPlaying(false);
    setVolume(1);
    setMutedVolume(1);
    setIsMuted(false);
    setProgress(0);
    setIsLoading(false);
    setCanPlay(false);
    setStartPlay(false);
    setPlaybackRate(1);
    setAnchorEl(null);

    // Reset refs to their initial values
    if (videoRef.current) {
      videoRef.current.pause(); // Ensure the video is paused
      videoRef.current.currentTime = 0; // Reset video progress
    }
    reDownload.current = false;
  };

  const src = useMemo(() => {
    if (name && identifier && service) {
      return `${node || getBaseApiReact()}/arbitrary/${encodeQdnPathSegment(service)}/${encodeQdnPathSegment(name)}/${encodeQdnPathSegment(identifier)}`;
    }
    return null;
  }, [service, name, identifier]);

  useEffect(() => {
    resetVideoState();
  }, [keyIdentifier]);

  const resourceStatus = useMemo(() => {
    return download?.status || {};
  }, [download]);

  const minSpeed = 0.25;
  const maxSpeed = 4.0;
  const speedChange = 0.25;

  const updatePlaybackRate = (newSpeed: number) => {
    if (videoRef.current) {
      if (newSpeed > maxSpeed || newSpeed < minSpeed) newSpeed = minSpeed;
      videoRef.current.playbackRate = newSpeed;
      setPlaybackRate(newSpeed);
    }
  };

  const increaseSpeed = (wrapOverflow = true) => {
    const changedSpeed = playbackRate + speedChange;
    let newSpeed = wrapOverflow
      ? changedSpeed
      : Math.min(changedSpeed, maxSpeed);

    if (videoRef.current) {
      updatePlaybackRate(newSpeed);
    }
  };

  const decreaseSpeed = () => {
    if (videoRef.current) {
      updatePlaybackRate(playbackRate - speedChange);
    }
  };

  const togglePlay = async () => {
    if (!videoRef.current) return;
    setStartPlay(true);
    if (!src || resourceStatus?.status !== 'READY') {
      ReactDOM.flushSync(() => {
        setIsLoading(true);
      });
      getSrc();
    }
    if (playing) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setPlaying(!playing);
  };

  const onVolumeChange = (_: any, value: number | number[]) => {
    if (!videoRef.current) return;
    videoRef.current.volume = value as number;
    setVolume(value as number);
    setIsMuted(false);
  };

  const onProgressChange = (_: any, value: number | number[]) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = value as number;
    setProgress(value as number);
    if (!playing) {
      videoRef.current.play();
      setPlaying(true);
    }
  };

  const handleEnded = () => {
    setPlaying(false);
  };

  const updateProgress = () => {
    if (!videoRef.current) return;
    setProgress(videoRef.current.currentTime);
  };

  const [isFullscreen, setIsFullscreen] = useState(false);

  const enterFullscreen = () => {
    // Fullscreen the whole container (not the bare <video>) so our own
    // controls stay on top instead of the WebView's native fullscreen UI.
    const el: any = containerRef.current || videoRef.current;
    if (!el) return;
    if (el.requestFullscreen) {
      el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    } else if (videoRef.current?.requestFullscreen) {
      videoRef.current.requestFullscreen();
    }
  };

  const exitFullscreen = () => {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen();
    }
  };

  const toggleFullscreen = () => {
    isFullscreen ? exitFullscreen() : enterFullscreen();
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(
        !!(document.fullscreenElement || (document as any).webkitFullscreenElement)
      );
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener(
        'webkitfullscreenchange',
        handleFullscreenChange
      );
    };
  }, []);

  // Auto-hide the controls while playing in fullscreen; always show them when
  // paused or when not in fullscreen.
  const scheduleHideControls = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3200);
  }, []);

  useEffect(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (!isFullscreen) {
      setShowControls(true);
      return;
    }
    if (playing) {
      setShowControls(true);
      scheduleHideControls();
    } else {
      setShowControls(true);
    }
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [isFullscreen, playing, scheduleHideControls]);

  const revealControls = () => {
    setShowControls(true);
    if (isFullscreen && playing) scheduleHideControls();
  };

  // Double-tap (anywhere on the video) exits fullscreen. A single tap still
  // toggles the controls overlay, so we briefly defer the single-tap action
  // to see whether a second tap arrives.
  const lastTapRef = useRef(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DOUBLE_TAP_MS = 300;

  const handleVideoSurfaceClick = () => {
    if (!isFullscreen) {
      togglePlay();
      return;
    }

    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      // Second tap of a double-tap: cancel the pending single-tap and minimize.
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapRef.current = 0;
      exitFullscreen();
      return;
    }

    lastTapRef.current = now;
    if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    singleTapTimerRef.current = setTimeout(() => {
      singleTapTimerRef.current = null;
      // In fullscreen, a single tap toggles the controls overlay rather than
      // pausing, so users can scrub without losing their place.
      setShowControls((prev) => {
        if (prev) return false;
        if (playing) scheduleHideControls();
        return true;
      });
    }, DOUBLE_TAP_MS);
  };

  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    };
  }, []);

  const handleCanPlay = () => {
    setIsLoading(false);
    setCanPlay(true);
  };

  const getSrc = useCallback(async () => {
    if (!name || !identifier || !service) return;
    try {
      downloadResource({
        name,
        service,
        identifier,
      });
    } catch (error) {
      console.error(error);
    }
  }, [identifier, name, service]);

  function formatTime(seconds: number): string {
    seconds = Math.floor(seconds);
    let minutes: number | string = Math.floor(seconds / 60);
    let hours: number | string = Math.floor(minutes / 60);

    let remainingSeconds: number | string = seconds % 60;
    let remainingMinutes: number | string = minutes % 60;

    if (remainingSeconds < 10) {
      remainingSeconds = '0' + remainingSeconds;
    }

    if (remainingMinutes < 10) {
      remainingMinutes = '0' + remainingMinutes;
    }

    if (hours === 0) {
      hours = '';
    } else {
      hours = hours + ':';
    }

    return hours + remainingMinutes + ':' + remainingSeconds;
  }

  const reloadVideo = () => {
    if (!videoRef.current) return;
    const currentTime = videoRef.current.currentTime;
    videoRef.current.src = src;
    videoRef.current.load();
    videoRef.current.currentTime = currentTime;
    if (playing) {
      videoRef.current.play();
    }
  };

  useEffect(() => {
    if (
      resourceStatus?.status === 'DOWNLOADED' &&
      reDownload?.current === false
    ) {
      getSrc();
      reDownload.current = true;
    }
  }, [getSrc, resourceStatus]);

  const handleMenuOpen = (event: any) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  useEffect(() => {
    const videoWidth = videoRef?.current?.offsetWidth;
  }, [canPlay]);

  const getDownloadProgress = (current: number, total: number) => {
    const progress = (current / total) * 100;
    return Number.isNaN(progress) ? '' : progress.toFixed(0) + '%';
  };

  const mute = () => {
    setIsMuted(true);
    setMutedVolume(volume);
    setVolume(0);
    if (videoRef.current) videoRef.current.volume = 0;
  };

  const unMute = () => {
    setIsMuted(false);
    setVolume(mutedVolume);
    if (videoRef.current) videoRef.current.volume = mutedVolume;
  };

  const toggleMute = () => {
    isMuted ? unMute() : mute();
  };

  const changeVolume = (volumeChange: number) => {
    if (videoRef.current) {
      const minVolume = 0;
      const maxVolume = 1;

      let newVolume = volumeChange + volume;

      newVolume = Math.max(newVolume, minVolume);
      newVolume = Math.min(newVolume, maxVolume);

      setIsMuted(false);
      setMutedVolume(newVolume);
      videoRef.current.volume = newVolume;
      setVolume(newVolume);
    }
  };

  const setProgressRelative = (secondsChange: number) => {
    if (videoRef.current) {
      const currentTime = videoRef.current?.currentTime;
      const minTime = 0;
      const maxTime = videoRef.current?.duration || 100;

      let newTime = currentTime + secondsChange;
      newTime = Math.max(newTime, minTime);
      newTime = Math.min(newTime, maxTime);
      videoRef.current.currentTime = newTime;
      setProgress(newTime);
    }
  };

  const setProgressAbsolute = (videoPercent: number) => {
    if (videoRef.current) {
      videoPercent = Math.min(videoPercent, 100);
      videoPercent = Math.max(videoPercent, 0);
      const finalTime = (videoRef.current?.duration * videoPercent) / 100;
      videoRef.current.currentTime = finalTime;
      setProgress(finalTime);
    }
  };

  const keyboardShortcutsDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.preventDefault();

    switch (e.key) {
      case Key.Add:
        increaseSpeed(false);
        break;
      case '+':
        increaseSpeed(false);
        break;
      case '>':
        increaseSpeed(false);
        break;

      case Key.Subtract:
        decreaseSpeed();
        break;
      case '-':
        decreaseSpeed();
        break;
      case '<':
        decreaseSpeed();
        break;

      case Key.ArrowLeft:
        {
          if (e.shiftKey) setProgressRelative(-300);
          else if (e.ctrlKey) setProgressRelative(-60);
          else if (e.altKey) setProgressRelative(-10);
          else setProgressRelative(-5);
        }
        break;

      case Key.ArrowRight:
        {
          if (e.shiftKey) setProgressRelative(300);
          else if (e.ctrlKey) setProgressRelative(60);
          else if (e.altKey) setProgressRelative(10);
          else setProgressRelative(5);
        }
        break;

      case Key.ArrowDown:
        changeVolume(-0.05);
        break;
      case Key.ArrowUp:
        changeVolume(0.05);
        break;
    }
  };

  const keyboardShortcutsUp = (e: KeyboardEvent<HTMLDivElement>) => {
    e.preventDefault();

    switch (e.key) {
      case ' ':
        togglePlay();
        break;
      case 'm':
        toggleMute();
        break;

      case 'f':
        enterFullscreen();
        break;
      case Key.Escape:
        exitFullscreen();
        break;

      case '0':
        setProgressAbsolute(0);
        break;
      case '1':
        setProgressAbsolute(10);
        break;
      case '2':
        setProgressAbsolute(20);
        break;
      case '3':
        setProgressAbsolute(30);
        break;
      case '4':
        setProgressAbsolute(40);
        break;
      case '5':
        setProgressAbsolute(50);
        break;
      case '6':
        setProgressAbsolute(60);
        break;
      case '7':
        setProgressAbsolute(70);
        break;
      case '8':
        setProgressAbsolute(80);
        break;
      case '9':
        setProgressAbsolute(90);
        break;
    }
  };

  const retry = () => {
    downloadResource({
      name,
      service,
      identifier,
    });
  };

  const speedOptions = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  return (
    <VideoContainer
      ref={containerRef}
      tabIndex={0}
      onKeyUp={keyboardShortcutsUp}
      onKeyDown={keyboardShortcutsDown}
      style={{
        padding: from === 'create' ? '8px' : 0,
        width: '100%',
        height: '100%',
        background: isFullscreen ? '#000' : undefined,
        justifyContent: isFullscreen ? 'center' : undefined,
      }}
    >
      {isLoading && (
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={resourceStatus?.status === 'READY' ? '55px ' : 0}
          display="flex"
          justifyContent="center"
          alignItems="center"
          zIndex={25}
          bgcolor="rgba(0, 0, 0, 0.6)"
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {resourceStatus?.status !== 'FAILED_TO_DOWNLOAD' && (
            <CircularProgress color="secondary" />
          )}

          <Typography
            variant="subtitle2"
            component="div"
            sx={{
              color: 'white',
              fontSize: '15px',
              textAlign: 'center',
            }}
          >
            {resourceStatus?.status === 'FAILED_TO_DOWNLOAD' ? (
              <>
                <>
                  {t('core:video_failed', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </>

                <Button onClick={retry}>
                  {t('core:retry', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
              </>
            ) : resourceStatus?.status === 'REFETCHING' ? (
              <>
                <>
                  {getDownloadProgress(
                    resourceStatus?.localChunkCount,
                    resourceStatus?.totalChunkCount
                  )}
                </>

                <> Refetching data in 25 seconds</>
              </>
            ) : resourceStatus?.status === 'DOWNLOADED' ? (
              <>
                {t('core:video_building', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </>
            ) : resourceStatus?.status !== 'READY' ? (
              <>
                {getDownloadProgress(
                  resourceStatus?.localChunkCount || 0,
                  resourceStatus?.totalChunkCount || 100
                )}
              </>
            ) : (
              <>
                {t('core:video_fetching', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </>
            )}
          </Typography>
        </Box>
      )}
      {((!src && !isLoading) || !startPlay) && (
        <Box
          alignItems="center"
          bgcolor="rgba(0, 0, 0, 0.6)"
          bottom={0}
          display="flex"
          justifyContent="center"
          left={0}
          onClick={() => {
            togglePlay();
          }}
          position="absolute"
          right={0}
          sx={{
            cursor: 'pointer',
          }}
          top={0}
          zIndex={500}
        >
          <PlayArrow
            sx={{
              width: '50px',
              height: '50px',
              color: 'white',
            }}
          />
        </Box>
      )}

      <Box
        sx={{
          display: 'flex',
          flexGrow: 1,
          width: '100%',
          height: isFullscreen ? '100%' : 'calc(100% - 60px)',
          position: isFullscreen ? 'absolute' : 'relative',
          inset: isFullscreen ? 0 : 'auto',
          backgroundColor: isFullscreen ? '#000' : 'transparent',
        }}
      >
        <VideoElement
          id={identifier}
          ref={videoRef}
          src={
            !startPlay ? null : resourceStatus?.status === 'READY' ? src : null
          }
          poster={!startPlay ? poster : ''}
          onTimeUpdate={updateProgress}
          autoPlay={autoplay}
          onClick={handleVideoSurfaceClick}
          onEnded={handleEnded}
          onCanPlay={handleCanPlay}
          preload="metadata"
          style={{
            width: '100%',
            height: '100%',
            objectFit: isFullscreen ? 'cover' : 'contain',
            // The styled VideoElement caps max-height for the inline layout;
            // in fullscreen that cap leaves black bars, so lift it.
            maxHeight: isFullscreen ? '100%' : undefined,
            maxWidth: isFullscreen ? '100%' : undefined,
            ...customStyle,
          }}
        />
      </Box>

      {/* Fullscreen tap overlay: big play/pause + 10s skip controls. */}
      {isFullscreen && canPlay && showControls && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 15,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '36px',
            pointerEvents: 'none',
          }}
        >
          <IconButton
            onClick={() => {
              setProgressRelative(-10);
              revealControls();
            }}
            sx={{
              color: '#fff',
              backgroundColor: 'rgba(0,0,0,0.35)',
              pointerEvents: 'auto',
              '&:hover': { backgroundColor: 'rgba(0,0,0,0.5)' },
            }}
          >
            <Replay10 sx={{ fontSize: 34 }} />
          </IconButton>

          <IconButton
            onClick={() => {
              togglePlay();
              revealControls();
            }}
            sx={{
              color: '#fff',
              backgroundColor: 'rgba(0,0,0,0.45)',
              width: 72,
              height: 72,
              pointerEvents: 'auto',
              '&:hover': { backgroundColor: 'rgba(0,0,0,0.6)' },
            }}
          >
            {playing ? (
              <Pause sx={{ fontSize: 44 }} />
            ) : (
              <PlayArrow sx={{ fontSize: 44 }} />
            )}
          </IconButton>

          <IconButton
            onClick={() => {
              setProgressRelative(10);
              revealControls();
            }}
            sx={{
              color: '#fff',
              backgroundColor: 'rgba(0,0,0,0.35)',
              pointerEvents: 'auto',
              '&:hover': { backgroundColor: 'rgba(0,0,0,0.5)' },
            }}
          >
            <Forward10 sx={{ fontSize: 34 }} />
          </IconButton>
        </Box>
      )}

      <ControlsContainer
        onClick={revealControls}
        sx={{
          position: isFullscreen ? 'absolute' : 'relative',
          bottom: 0,
          left: 0,
          right: 0,
          background: isFullscreen
            ? 'linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0.0))'
            : 'var(--videoplayer-bg)',
          width: '100%',
          flexShrink: 0,
          flexWrap: isFullscreen ? 'wrap' : 'nowrap',
          zIndex: 20,
          paddingBottom: isFullscreen
            ? 'calc(10px + var(--safe-area-inset-bottom, 0px))'
            : undefined,
          paddingLeft: isFullscreen
            ? 'calc(8px + var(--safe-area-inset-left, 0px))'
            : undefined,
          paddingRight: isFullscreen
            ? 'calc(8px + var(--safe-area-inset-right, 0px))'
            : undefined,
          opacity: isFullscreen && !showControls ? 0 : 1,
          pointerEvents: isFullscreen && !showControls ? 'none' : 'auto',
          transition: 'opacity 0.25s ease',
        }}
      >
        {canPlay ? (
          <>
            <IconButton
              sx={{
                color: 'rgba(255, 255, 255, 0.85)',
              }}
              onClick={togglePlay}
            >
              {playing ? <Pause /> : <PlayArrow />}
            </IconButton>
            <IconButton
              sx={{
                color: 'rgba(255, 255, 255, 0.7)',
                marginLeft: '8px',
              }}
              onClick={reloadVideo}
            >
              <Refresh />
            </IconButton>

            <Slider
              value={progress}
              onChange={(e, v) => {
                onProgressChange(e, v);
                revealControls();
              }}
              min={0}
              max={videoRef.current?.duration || 100}
              sx={{
                flexGrow: 1,
                mx: 2,
                color: 'var(--Mail-Background)',
                '& .MuiSlider-thumb': {
                  width: isFullscreen ? 16 : 12,
                  height: isFullscreen ? 16 : 12,
                },
                '& .MuiSlider-rail': { opacity: 0.4 },
              }}
            />

            <Typography
              sx={{
                fontSize: '14px',
                marginRight: '5px',
                color: 'rgba(255, 255, 255, 0.85)',
                visibility:
                  !videoRef.current?.duration || !progress
                    ? 'hidden'
                    : 'visible',
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              {progress && videoRef.current?.duration && formatTime(progress)}/
              {progress &&
                videoRef.current?.duration &&
                formatTime(videoRef.current?.duration)}
            </Typography>

            <IconButton
              sx={{
                color: 'rgba(255, 255, 255, 0.7)',
                marginRight: '4px',
              }}
              onClick={toggleMute}
            >
              {isMuted ? <VolumeOff /> : <VolumeUp />}
            </IconButton>

            <Slider
              value={volume}
              onChange={onVolumeChange}
              min={0}
              max={1}
              step={0.01}
              sx={{
                maxWidth: '90px',
                color: 'var(--Mail-Background)',
              }}
            />
            <IconButton
              sx={{
                color: 'rgba(255, 255, 255, 0.85)',
                fontSize: '13px',
                marginLeft: '5px',
                borderRadius: '8px',
                padding: '6px 8px',
              }}
              onClick={handleMenuOpen}
            >
              {playbackRate}x
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleMenuClose}
              anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
              transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
              {speedOptions.map((speedOption) => (
                <MenuItem
                  key={speedOption}
                  selected={speedOption === playbackRate}
                  onClick={() => {
                    updatePlaybackRate(speedOption);
                    handleMenuClose();
                    revealControls();
                  }}
                >
                  {speedOption}x
                </MenuItem>
              ))}
            </Menu>

            <IconButton
              aria-label={
                isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'
              }
              sx={{
                color: 'rgba(255, 255, 255, 0.85)',
                // Generous, forgiving touch target so the (un)maximize button
                // doesn't need a pixel-precise tap in fullscreen.
                padding: isFullscreen ? '16px' : '12px',
                margin: isFullscreen ? '-4px' : 0,
                '& svg': {
                  fontSize: isFullscreen ? 30 : 24,
                },
                '&:hover': {
                  backgroundColor: 'rgba(255,255,255,0.12)',
                },
              }}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? <FullscreenExit /> : <Fullscreen />}
            </IconButton>
          </>
        ) : null}
      </ControlsContainer>
    </VideoContainer>
  );
};
