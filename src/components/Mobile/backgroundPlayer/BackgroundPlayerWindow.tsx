import { useEffect, useState, type ReactNode } from 'react';
import {
  Box,
  ButtonBase,
  Dialog,
  DialogContent,
  IconButton,
  LinearProgress,
  Switch,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import HeadphonesRoundedIcon from '@mui/icons-material/HeadphonesRounded';
import MusicNoteRoundedIcon from '@mui/icons-material/MusicNoteRounded';
import MovieRoundedIcon from '@mui/icons-material/MovieRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import SkipPreviousRoundedIcon from '@mui/icons-material/SkipPreviousRounded';
import Replay5RoundedIcon from '@mui/icons-material/Replay5Rounded';
import Replay10RoundedIcon from '@mui/icons-material/Replay10Rounded';
import Replay30RoundedIcon from '@mui/icons-material/Replay30Rounded';
import Forward5RoundedIcon from '@mui/icons-material/Forward5Rounded';
import Forward10RoundedIcon from '@mui/icons-material/Forward10Rounded';
import Forward30RoundedIcon from '@mui/icons-material/Forward30Rounded';
import BedtimeRoundedIcon from '@mui/icons-material/BedtimeRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import { motion, useReducedMotion } from 'framer-motion';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import qortalLogo from '../../../assets/qortal-hex-logo.png';
import type {
  BackgroundPlayerSettings,
  BackgroundPlayerState,
  SleepTimerMinutes,
} from '../../../plugins/QortalMedia';
import { BACK_PRIORITY, useAndroidBack } from '../../../utils/androidBack';
import { useCloseWithGoWindows } from '../../../utils/closeGoWindows';
import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../../../utils/mobileSafeArea';
import { useSheetFullScreen } from '../../../layout/goLayout';
import { getDialogPaperSx } from '../../App/dialogSurface';
import { MobilePanelHeader } from '../MobilePanelHeader';
import {
  CLOSE_PAUSED_OPTIONS,
  SEEK_STEP_OPTIONS,
  SLEEP_TIMER_OPTIONS,
  backgroundPlayerSettingsAtom,
  backgroundPlayerStateAtom,
  backgroundPlayerWindowOpenAtom,
  closeBackgroundPlayerWindow,
  controlBackgroundPlayer,
  refreshBackgroundPlayer,
  setBackgroundPlayerSleepTimer,
  updateBackgroundPlayerSettings,
} from './backgroundPlayer';

const cardSx = (theme: Theme) => ({
  backgroundColor:
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.common.white, 0.025)
      : theme.palette.action.hover,
  border: `1px solid ${alpha(theme.palette.divider, 0.9)}`,
  borderRadius: '14px',
  overflow: 'hidden',
});

const sectionLabelSx = (theme: Theme) => ({
  color: alpha(theme.palette.text.secondary, 0.8),
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  px: 0.5,
  textTransform: 'uppercase' as const,
});

const switchSx = (theme: Theme) => ({
  flexShrink: 0,
  '& .MuiSwitch-switchBase.Mui-checked': {
    color: theme.palette.common.white,
    '& + .MuiSwitch-track': {
      backgroundColor: alpha(
        theme.palette.primary.main,
        theme.palette.mode === 'dark' ? 0.72 : 0.82
      ),
      opacity: 1,
    },
  },
  '& .MuiSwitch-thumb': { boxShadow: 'none', height: 16, width: 16 },
  '& .MuiSwitch-track': {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? alpha(theme.palette.common.white, 0.16)
        : alpha(theme.palette.common.black, 0.18),
    borderRadius: 999,
    opacity: 1,
  },
});

function formatTime(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const BACK_ICONS = {
  5: Replay5RoundedIcon,
  10: Replay10RoundedIcon,
  30: Replay30RoundedIcon,
} as const;
const FORWARD_ICONS = {
  5: Forward5RoundedIcon,
  10: Forward10RoundedIcon,
  30: Forward30RoundedIcon,
} as const;

function Divider() {
  const theme = useTheme();
  return (
    <Box
      sx={{
        borderTop: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
        mx: 1.5,
      }}
    />
  );
}

function SettingText({
  title,
  description,
}: {
  title: ReactNode;
  description?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: '0.86rem',
          fontWeight: 700,
          letterSpacing: '0.01em',
        }}
      >
        {title}
      </Typography>
      {description ? (
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '0.76rem',
            lineHeight: 1.45,
            mt: 0.35,
          }}
        >
          {description}
        </Typography>
      ) : null}
    </Box>
  );
}

function SwitchRow({
  title,
  description,
  checked,
  disabled,
  onChange,
  testId,
}: {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  testId: string;
}) {
  const theme = useTheme();
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: 1.2,
        justifyContent: 'space-between',
        opacity: disabled ? 0.5 : 1,
        px: 1.5,
        py: 1.25,
      }}
    >
      <SettingText title={title} description={description} />
      <Switch
        checked={checked}
        disabled={disabled}
        inputProps={{ 'aria-label': title }}
        data-testid={testId}
        onChange={(event) => onChange(event.target.checked)}
        sx={switchSx(theme)}
      />
    </Box>
  );
}

function Segmented<T extends number>({
  label,
  options,
  value,
  onChange,
  layoutId,
  testId,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  layoutId: string;
  testId: string;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const isDark = theme.palette.mode === 'dark';
  return (
    <Box
      role="radiogroup"
      aria-label={label}
      sx={{
        backgroundColor: isDark
          ? alpha(theme.palette.common.white, 0.05)
          : alpha(theme.palette.common.black, 0.05),
        border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
        borderRadius: '12px',
        display: 'grid',
        gap: 0.4,
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        mt: 1,
        p: 0.4,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <ButtonBase
            key={option.value}
            role="radio"
            aria-checked={selected}
            data-testid={`${testId}-${option.value}`}
            onClick={() => {
              if (!selected) onChange(option.value);
            }}
            sx={{
              borderRadius: '9px',
              color: selected
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              fontSize: '0.78rem',
              fontWeight: selected ? 700 : 600,
              minHeight: 38,
              position: 'relative',
              transition: 'color 180ms ease',
              whiteSpace: 'nowrap',
            }}
          >
            {selected ? (
              <motion.span
                layoutId={layoutId}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 520, damping: 38 }
                }
                style={{
                  background: isDark
                    ? alpha(theme.palette.primary.main, 0.22)
                    : theme.palette.background.paper,
                  borderRadius: 9,
                  boxShadow: isDark
                    ? `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.45)}`
                    : '0 1px 4px rgba(15,20,30,0.14)',
                  inset: 0,
                  position: 'absolute',
                }}
              />
            ) : null}
            <Box component="span" sx={{ position: 'relative' }}>
              {option.label}
            </Box>
          </ButtonBase>
        );
      })}
    </Box>
  );
}

/** The cover tile: what plays (audio / video) with the Qortal logo bottom right, like the notification. */
function CoverTile({ kind }: { kind?: 'audio' | 'video' }) {
  const theme = useTheme();
  const Icon = kind === 'video' ? MovieRoundedIcon : MusicNoteRoundedIcon;
  return (
    <Box
      aria-hidden
      sx={{
        alignItems: 'center',
        background: `linear-gradient(140deg, ${alpha(
          theme.palette.primary.main,
          0.55
        )} 0%, #101a33 58%, #0a0d16 100%)`,
        borderRadius: '16px',
        boxShadow: `0 6px 18px ${alpha(theme.palette.common.black, 0.28)}`,
        color: alpha(theme.palette.common.white, 0.92),
        display: 'flex',
        flexShrink: 0,
        height: 72,
        justifyContent: 'center',
        position: 'relative',
        width: 72,
      }}
    >
      <Icon sx={{ fontSize: 34 }} />
      <Box
        component="img"
        src={qortalLogo}
        alt=""
        sx={{
          bottom: 4,
          filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.55))',
          height: 20,
          position: 'absolute',
          right: 4,
          width: 20,
        }}
      />
    </Box>
  );
}

function NowPlaying({
  state,
  settings,
}: {
  state: BackgroundPlayerState;
  settings: BackgroundPlayerSettings;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [now, setNow] = useState(() => Date.now());
  const [stateAt, setStateAt] = useState(() => Date.now());

  useEffect(() => {
    setStateAt(Date.now());
  }, [state]);
  useEffect(() => {
    if (!state.active || !state.playing) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state.active, state.playing]);

  if (!state.active) {
    return (
      <Box
        sx={{
          ...cardSx(theme),
          alignItems: 'center',
          display: 'flex',
          gap: 1.5,
          px: 1.5,
          py: 1.5,
        }}
        data-testid="background-player-idle"
      >
        <CoverTile />
        <SettingText
          title={t('core:go_player.nothing_playing')}
          description={t('core:go_player.nothing_playing_desc')}
        />
      </Box>
    );
  }

  const duration = state.durationSec ?? -1;
  const elapsed = state.playing ? Math.max(0, (now - stateAt) / 1000) : 0;
  const position =
    duration > 0
      ? Math.min(duration, (state.positionSec ?? 0) + elapsed)
      : (state.positionSec ?? 0) + elapsed;
  const step = settings.seekStepSec as 5 | 10 | 30;
  const BackIcon = BACK_ICONS[step] ?? Replay10RoundedIcon;
  const ForwardIcon = FORWARD_ICONS[step] ?? Forward10RoundedIcon;
  const source = state.source || t('core:go_player.from_go');
  const kindLabel =
    state.kind === 'video'
      ? t('core:go_player.kind_video')
      : t('core:go_player.kind_audio');

  return (
    <Box
      sx={{ ...cardSx(theme), px: 1.5, pb: 1.25, pt: 1.5 }}
      data-testid="background-player-now-playing"
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.5 }}>
        <CoverTile kind={state.kind} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={sectionLabelSx(theme)} component="p">
            {t('core:go_player.now_playing')}
          </Typography>
          <Typography
            sx={{
              color: theme.palette.text.primary,
              display: '-webkit-box',
              fontSize: '0.98rem',
              fontWeight: 750,
              lineHeight: 1.3,
              mt: 0.3,
              overflow: 'hidden',
              px: 0.5,
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              wordBreak: 'break-word',
            }}
          >
            {state.title}
          </Typography>
          <Typography
            noWrap
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.78rem',
              mt: 0.2,
              px: 0.5,
            }}
          >
            {state.artist && state.artist !== source
              ? `${state.artist} · ${source}`
              : `${source} · ${kindLabel}`}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ mt: 1.4, px: 0.25 }}>
        {duration > 0 ? (
          <>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, (position / duration) * 100)}
              aria-label={t('core:go_player.progress')}
              sx={{
                backgroundColor: alpha(theme.palette.text.primary, 0.1),
                borderRadius: 999,
                height: 4,
                '& .MuiLinearProgress-bar': { borderRadius: 999 },
              }}
            />
            <Box
              sx={{
                color: theme.palette.text.secondary,
                display: 'flex',
                fontSize: '0.7rem',
                fontVariantNumeric: 'tabular-nums',
                justifyContent: 'space-between',
                mt: 0.5,
              }}
            >
              <span>{formatTime(position)}</span>
              <span>{formatTime(duration)}</span>
            </Box>
          </>
        ) : (
          <Typography
            sx={{
              color: theme.palette.error.light,
              fontSize: '0.7rem',
              fontWeight: 800,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {t('core:go_player.live')}
          </Typography>
        )}
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1.5,
          justifyContent: 'center',
          mt: 0.5,
        }}
      >
        {state.canPrevious ? (
          <IconButton
            aria-label={t('core:go_player.notification.previous')}
            onClick={() => controlBackgroundPlayer('previous')}
          >
            <SkipPreviousRoundedIcon />
          </IconButton>
        ) : state.seekable ? (
          <IconButton
            aria-label={t('core:go_player.notification.back', { n: step })}
            onClick={() => controlBackgroundPlayer('back')}
          >
            <BackIcon />
          </IconButton>
        ) : null}
        <IconButton
          aria-label={
            state.playing
              ? t('core:go_player.notification.pause')
              : t('core:go_player.notification.play')
          }
          data-testid="background-player-toggle"
          onClick={() => controlBackgroundPlayer('toggle')}
          sx={{
            backgroundColor: theme.palette.primary.main,
            color: theme.palette.primary.contrastText,
            height: 52,
            width: 52,
            '&:hover': { backgroundColor: theme.palette.primary.dark },
          }}
        >
          {state.playing ? (
            <PauseRoundedIcon sx={{ fontSize: 30 }} />
          ) : (
            <PlayArrowRoundedIcon sx={{ fontSize: 30 }} />
          )}
        </IconButton>
        {state.canNext ? (
          <IconButton
            aria-label={t('core:go_player.notification.next')}
            onClick={() => controlBackgroundPlayer('next')}
          >
            <SkipNextRoundedIcon />
          </IconButton>
        ) : state.seekable ? (
          <IconButton
            aria-label={t('core:go_player.notification.forward', { n: step })}
            onClick={() => controlBackgroundPlayer('forward')}
          >
            <ForwardIcon />
          </IconButton>
        ) : null}
      </Box>
    </Box>
  );
}

function SleepTimer({ state }: { state: BackgroundPlayerState }) {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const mode = (state.sleepMode ?? 0) as SleepTimerMinutes;
  const labelOf = (minutes: SleepTimerMinutes) => {
    if (minutes === 0) return t('core:go_player.sleep_off');
    if (minutes === -1) return t('core:go_player.sleep_end_of_track');
    if (minutes === 60) return t('core:go_player.hour_short');
    return t('core:go_player.minutes_short', { n: minutes });
  };
  let status = t('core:go_player.sleep_desc');
  if (mode === -1) status = t('core:go_player.sleep_until_track_end');
  else if (mode > 0 && state.sleepEndsAt > 0) {
    const time = new Date(state.sleepEndsAt).toLocaleTimeString(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
    });
    status = t('core:go_player.sleep_until', { time });
  }

  return (
    <Box sx={{ ...cardSx(theme), px: 1.5, py: 1.3 }}>
      <Box sx={{ alignItems: 'flex-start', display: 'flex', gap: 1.1 }}>
        <BedtimeRoundedIcon
          sx={{
            color:
              mode !== 0
                ? theme.palette.primary.light
                : theme.palette.text.secondary,
            fontSize: 22,
            mt: 0.15,
          }}
        />
        <SettingText
          title={t('core:go_player.section_sleep')}
          description={status}
        />
      </Box>
      <Box
        role="radiogroup"
        aria-label={t('core:go_player.section_sleep')}
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.2 }}
      >
        {SLEEP_TIMER_OPTIONS.map((minutes) => {
          const selected = minutes === mode;
          return (
            <ButtonBase
              key={minutes}
              role="radio"
              aria-checked={selected}
              data-testid={`background-player-sleep-${minutes}`}
              onClick={() => setBackgroundPlayerSleepTimer(minutes)}
              sx={{
                backgroundColor: selected
                  ? alpha(theme.palette.primary.main, 0.22)
                  : alpha(theme.palette.text.primary, 0.05),
                border: `1px solid ${
                  selected
                    ? alpha(theme.palette.primary.main, 0.55)
                    : alpha(theme.palette.text.primary, 0.1)
                }`,
                borderRadius: 999,
                color: selected
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary,
                fontSize: '0.78rem',
                fontWeight: selected ? 700 : 600,
                minHeight: 34,
                px: 1.4,
                transition:
                  'background-color 160ms ease, border-color 160ms ease',
              }}
            >
              {labelOf(minutes)}
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * GO's background player settings: opened from Settings → System and from
 * the gear in the player notification. "Now playing" with Play / Pause on
 * top, then what happens when GO leaves the screen, the notification and
 * lock screen, interruptions, and the sleep timer. Android owns the
 * settings (GoMediaHub); every change is saved there right away.
 */
export function BackgroundPlayerWindow({
  ready = true,
}: {
  /** False while GO is signed out or locked: the window waits. */
  ready?: boolean;
} = {}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const fullScreen = useSheetFullScreen();
  const open = useAtomValue(backgroundPlayerWindowOpenAtom) && ready;
  const settings = useAtomValue(backgroundPlayerSettingsAtom);
  const state = useAtomValue(backgroundPlayerStateAtom);

  useEffect(() => {
    if (open) void refreshBackgroundPlayer();
  }, [open]);

  useAndroidBack(
    () => {
      closeBackgroundPlayerWindow();
      return true;
    },
    { enabled: open, priority: BACK_PRIORITY.dialog }
  );
  useCloseWithGoWindows(open, closeBackgroundPlayerWindow);

  const save = (patch: Partial<BackgroundPlayerSettings>) => {
    void updateBackgroundPlayerSettings(patch);
  };

  return (
    <Dialog
      fullScreen={fullScreen}
      fullWidth
      maxWidth="sm"
      onClose={closeBackgroundPlayerWindow}
      open={open}
      PaperProps={{
        sx: {
          ...getDialogPaperSx(theme, { maxWidth: 560 }),
          display: 'flex',
          flexDirection: 'column',
          ...(fullScreen
            ? {
                border: 'none',
                borderRadius: 0,
                boxShadow: 'none',
                maxWidth: 'none',
                paddingBottom: SAFE_AREA_BOTTOM,
                paddingTop: SAFE_AREA_TOP,
                width: '100%',
              }
            : { maxHeight: '86vh' }),
        },
      }}
    >
      <MobilePanelHeader
        icon={<HeadphonesRoundedIcon />}
        onClose={closeBackgroundPlayerWindow}
        title={t('core:go_player.title')}
      />
      <DialogContent
        data-testid="background-player-window"
        sx={{
          alignContent: 'start',
          display: 'grid',
          gap: 1.1,
          // Rows keep their content's height; the content scrolls instead.
          gridAutoRows: 'max-content',
          gridTemplateColumns: 'minmax(0, 1fr)',
          px: 1.75,
          py: 1.75,
        }}
      >
        <NowPlaying state={state} settings={settings} />

        <Typography sx={{ ...sectionLabelSx(theme), mt: 1.2 }} component="h3">
          {t('core:go_player.section_leave')}
        </Typography>
        <Box sx={cardSx(theme)}>
          <SwitchRow
            testId="background-player-audio"
            title={t('core:go_player.background_audio')}
            description={t('core:go_player.background_audio_desc')}
            checked={settings.backgroundAudio}
            onChange={(backgroundAudio) => save({ backgroundAudio })}
          />
          <Divider />
          <SwitchRow
            testId="background-player-video"
            title={t('core:go_player.background_video')}
            description={t('core:go_player.background_video_desc')}
            checked={settings.backgroundVideo}
            onChange={(backgroundVideo) => save({ backgroundVideo })}
          />
          <Divider />
          <SwitchRow
            testId="background-player-pause-on-lock"
            title={t('core:go_player.pause_on_lock')}
            description={t('core:go_player.pause_on_lock_desc')}
            checked={settings.pauseOnScreenLock}
            onChange={(pauseOnScreenLock) => save({ pauseOnScreenLock })}
          />
          <Divider />
          <SwitchRow
            testId="background-player-resume"
            title={t('core:go_player.resume_on_return')}
            description={t('core:go_player.resume_on_return_desc')}
            checked={settings.resumeOnReturn}
            onChange={(resumeOnReturn) => save({ resumeOnReturn })}
          />
        </Box>

        <Typography sx={{ ...sectionLabelSx(theme), mt: 1.2 }} component="h3">
          {t('core:go_player.section_notification')}
        </Typography>
        <Box sx={cardSx(theme)}>
          <SwitchRow
            testId="background-player-lock-screen"
            title={t('core:go_player.lock_screen')}
            description={t('core:go_player.lock_screen_desc')}
            checked={settings.lockScreen}
            onChange={(lockScreen) => save({ lockScreen })}
          />
          <Divider />
          <SwitchRow
            testId="background-player-logo"
            title={t('core:go_player.logo_on_cover')}
            description={t('core:go_player.logo_on_cover_desc')}
            checked={settings.logoOnCover}
            onChange={(logoOnCover) => save({ logoOnCover })}
          />
          <Divider />
          <Box sx={{ px: 1.5, py: 1.25 }}>
            <SettingText
              title={t('core:go_player.seek_step')}
              description={t('core:go_player.seek_step_desc')}
            />
            <Segmented
              label={t('core:go_player.seek_step')}
              layoutId="background-player-seek-step"
              testId="background-player-seek"
              value={settings.seekStepSec}
              onChange={(seekStepSec) => save({ seekStepSec })}
              options={SEEK_STEP_OPTIONS.map((n) => ({
                value: n,
                label: t('core:go_player.seconds_short', { n }),
              }))}
            />
          </Box>
          <Divider />
          <Box sx={{ px: 1.5, py: 1.25 }}>
            <SettingText
              title={t('core:go_player.close_paused')}
              description={t('core:go_player.close_paused_desc')}
            />
            <Segmented
              label={t('core:go_player.close_paused')}
              layoutId="background-player-close-paused"
              testId="background-player-close"
              value={settings.closePausedAfterMin}
              onChange={(closePausedAfterMin) => save({ closePausedAfterMin })}
              options={CLOSE_PAUSED_OPTIONS.map((n) => ({
                value: n,
                label:
                  n === 0
                    ? t('core:go_player.never')
                    : n === 60
                      ? t('core:go_player.hour_short')
                      : t('core:go_player.minutes_short', { n }),
              }))}
            />
          </Box>
        </Box>

        <Typography sx={{ ...sectionLabelSx(theme), mt: 1.2 }} component="h3">
          {t('core:go_player.section_interruptions')}
        </Typography>
        <Box sx={cardSx(theme)}>
          <SwitchRow
            testId="background-player-noisy"
            title={t('core:go_player.pause_on_noisy')}
            description={t('core:go_player.pause_on_noisy_desc')}
            checked={settings.pauseOnNoisy}
            onChange={(pauseOnNoisy) => save({ pauseOnNoisy })}
          />
          <Divider />
          {/* Chromium does this for every WebView player; nothing to switch. */}
          <Box
            data-testid="background-player-other-apps"
            sx={{
              alignItems: 'flex-start',
              display: 'flex',
              gap: 1.2,
              justifyContent: 'space-between',
              px: 1.5,
              py: 1.25,
            }}
          >
            <SettingText
              title={t('core:go_player.other_apps')}
              description={t('core:go_player.other_apps_desc')}
            />
            <CheckCircleRoundedIcon
              aria-hidden
              sx={{
                color: alpha(theme.palette.success.main, 0.85),
                flexShrink: 0,
                fontSize: 22,
                mr: 1,
                mt: 0.2,
              }}
            />
          </Box>
        </Box>

        <Box sx={{ mt: 1.2 }}>
          <SleepTimer state={state} />
        </Box>

        <Typography
          sx={{
            color: alpha(theme.palette.text.secondary, 0.75),
            fontSize: '0.74rem',
            lineHeight: 1.5,
            mt: 0.5,
            px: 0.5,
            textAlign: 'center',
          }}
        >
          {t('core:go_player.works_everywhere')}
        </Typography>
      </DialogContent>
    </Dialog>
  );
}
