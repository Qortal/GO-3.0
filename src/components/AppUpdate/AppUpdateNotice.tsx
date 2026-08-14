import SystemUpdateAltRoundedIcon from '@mui/icons-material/SystemUpdateAltRounded';
import {
  Box,
  Button,
  LinearProgress,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useAtomValue } from 'jotai';
import {
  appUpdateProgressAtom,
  appUpdateReleaseAtom,
} from '../../appUpdate/appUpdateAtoms';
import {
  continueInstall,
  dismissAppUpdate,
  openAppUpdateWindow,
  startAppUpdateDownload,
} from '../../appUpdate/appUpdateController';
import { formatUpdateSize, updateHeadline } from './appUpdateFormat';

/**
 * The update as it appears in the notifications panel: a headline while it is
 * waiting to be installed, a live progress bar once it is running. This is
 * what the window minimises into, so it has to be able to say everything the
 * window says in one line.
 */
export const AppUpdateNotice = ({ onOpen }: { onOpen?: () => void }) => {
  const theme = useTheme();
  const release = useAtomValue(appUpdateReleaseAtom);
  const progress = useAtomValue(appUpdateProgressAtom);

  if (!release) return null;

  const busy =
    progress.phase === 'preparing' || progress.phase === 'downloading';
  const accent = theme.palette.primary.main;

  const open = () => {
    openAppUpdateWindow();
    onOpen?.();
  };

  return (
    <Box
      onClick={open}
      sx={{
        backgroundColor: alpha(
          accent,
          theme.palette.mode === 'dark' ? 0.1 : 0.07
        ),
        border: `1px solid ${alpha(accent, 0.34)}`,
        borderRadius: '14px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        px: 1.35,
        py: 1.15,
        width: '100%',
      }}
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.15 }}>
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: alpha(accent, 0.16),
            borderRadius: '10px',
            color: accent,
            display: 'flex',
            flexShrink: 0,
            height: 34,
            justifyContent: 'center',
            width: 34,
          }}
        >
          <SystemUpdateAltRoundedIcon sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: '0.9rem',
              fontWeight: 700,
              lineHeight: 1.3,
            }}
          >
            {updateHeadline(progress.phase)}
          </Typography>
          <Typography
            noWrap
            sx={{
              color: alpha(theme.palette.text.secondary, 0.9),
              fontSize: '0.76rem',
              lineHeight: 1.4,
            }}
          >
            {`Qortal GO ${release.version}`}
            {release.size ? ` · ${formatUpdateSize(release.size)}` : ''}
          </Typography>
        </Box>
      </Box>

      {(busy || progress.phase === 'installing') && (
        <Box sx={{ display: 'grid', gap: 0.6 }}>
          <LinearProgress
            variant={progress.percent >= 0 ? 'determinate' : 'indeterminate'}
            value={Math.max(0, Math.min(100, progress.percent))}
            sx={{
              backgroundColor: alpha(accent, 0.18),
              borderRadius: 999,
              height: 5,
              '& .MuiLinearProgress-bar': { borderRadius: 999 },
            }}
          />
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.86),
              fontSize: '0.72rem',
            }}
          >
            {progress.detail || 'Working…'}
          </Typography>
        </Box>
      )}

      {progress.phase === 'error' && (
        <Typography
          sx={{ color: theme.palette.error.light, fontSize: '0.74rem' }}
        >
          {progress.error}
        </Typography>
      )}

      {!busy && progress.phase !== 'installing' && (
        <Box sx={{ display: 'flex', gap: 0.75, justifyContent: 'flex-end' }}>
          <Button
            onClick={(event) => {
              event.stopPropagation();
              dismissAppUpdate();
            }}
            size="small"
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.78rem',
              fontWeight: 600,
              minWidth: 0,
              px: 1.1,
              textTransform: 'none',
            }}
          >
            Later
          </Button>
          <Button
            onClick={(event) => {
              event.stopPropagation();
              if (progress.phase === 'needs-permission') {
                void continueInstall();
                return;
              }
              openAppUpdateWindow();
              onOpen?.();
              void startAppUpdateDownload();
            }}
            size="small"
            variant="contained"
            sx={{
              borderRadius: '9px',
              boxShadow: 'none',
              fontSize: '0.78rem',
              fontWeight: 700,
              px: 1.5,
              textTransform: 'none',
            }}
          >
            {progress.phase === 'needs-permission'
              ? 'Allow installs'
              : progress.phase === 'error'
                ? 'Try again'
                : 'Install now'}
          </Button>
        </Box>
      )}
    </Box>
  );
};
