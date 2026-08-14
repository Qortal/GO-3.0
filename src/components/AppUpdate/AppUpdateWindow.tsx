import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import MinimizeRoundedIcon from '@mui/icons-material/MinimizeRounded';
import SystemUpdateAltRoundedIcon from '@mui/icons-material/SystemUpdateAltRounded';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  LinearProgress,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import DOMPurify from 'dompurify';
import { useAtomValue } from 'jotai';
import {
  appUpdateProgressAtom,
  appUpdateReleaseAtom,
  appUpdateWindowOpenAtom,
} from '../../appUpdate/appUpdateAtoms';
import {
  continueInstall,
  dismissAppUpdate,
  installDownloadedUpdate,
  minimizeAppUpdateWindow,
  resetAppUpdateProgress,
  startAppUpdateDownload,
} from '../../appUpdate/appUpdateController';
import {
  dialogModalBackdropSx,
  getDialogPaperSx,
  getDialogPrimaryButtonSx,
  getDialogSecondaryButtonSx,
} from '../App/dialogSurface';
import {
  formatUpdateDate,
  formatUpdateSize,
  updateHeadline,
} from './appUpdateFormat';

/**
 * The update itself, with room for what changed.
 *
 * Closing it minimises rather than cancels — a download that dies because the
 * user wanted to read something behind it would be its own bug — and the
 * notification card carries the same progress while it is away.
 */
export const AppUpdateWindow = () => {
  const theme = useTheme();
  const open = useAtomValue(appUpdateWindowOpenAtom);
  const release = useAtomValue(appUpdateReleaseAtom);
  const progress = useAtomValue(appUpdateProgressAtom);

  if (!release) return null;

  const busy =
    progress.phase === 'preparing' || progress.phase === 'downloading';
  const accent = theme.palette.primary.main;
  const notes = release.notes?.trim();

  return (
    <Dialog
      open={open}
      onClose={minimizeAppUpdateWindow}
      slotProps={{ backdrop: { sx: dialogModalBackdropSx } }}
      PaperProps={{ sx: getDialogPaperSx(theme, { maxWidth: 460 }) }}
    >
      <Box
        sx={{
          alignItems: 'center',
          borderBottom: `1px solid ${alpha('#A9BCD8', 0.12)}`,
          display: 'flex',
          gap: 1.4,
          px: 2.5,
          py: 2,
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: alpha(accent, 0.15),
            borderRadius: '12px',
            color: accent,
            display: 'flex',
            height: 42,
            justifyContent: 'center',
            width: 42,
          }}
        >
          <SystemUpdateAltRoundedIcon />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: '1.02rem',
              fontWeight: 700,
              lineHeight: 1.25,
            }}
          >
            {updateHeadline(progress.phase)}
          </Typography>
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.9),
              fontSize: '0.8rem',
              lineHeight: 1.45,
            }}
          >
            {`Qortal GO ${release.version}`}
            {release.size ? ` · ${formatUpdateSize(release.size)}` : ''}
            {release.publishedAt
              ? ` · ${formatUpdateDate(release.publishedAt)}`
              : ''}
          </Typography>
        </Box>
        <Tooltip title="Keep it in notifications">
          <IconButton
            aria-label="Minimise"
            onClick={minimizeAppUpdateWindow}
            size="small"
            sx={{
              alignSelf: 'flex-start',
              color: theme.palette.text.secondary,
            }}
          >
            <MinimizeRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <DialogContent sx={{ display: 'grid', gap: 1.6, px: 2.5, py: 2.25 }}>
        {release.title && release.title !== release.filename && (
          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: '0.92rem',
              fontWeight: 650,
            }}
          >
            {release.title}
          </Typography>
        )}

        <Box sx={{ display: 'grid', gap: 0.7 }}>
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.75),
              fontSize: '0.72rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            What's new
          </Typography>
          <Box
            sx={{
              backgroundColor: alpha(
                theme.palette.common.white,
                theme.palette.mode === 'dark' ? 0.04 : 0.6
              ),
              border: `1px solid ${alpha('#A9BCD8', 0.14)}`,
              borderRadius: '12px',
              maxHeight: '34vh',
              overflowY: 'auto',
              px: 1.5,
              py: 1.25,
            }}
          >
            {release.notesHtml ? (
              <Box
                // Q-Share stores the notes as rich text; sanitised because it
                // is a stranger's HTML until proven otherwise.
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(release.notesHtml, {
                    ALLOWED_TAGS: [
                      'a',
                      'b',
                      'br',
                      'code',
                      'em',
                      'h3',
                      'h4',
                      'i',
                      'li',
                      'ol',
                      'p',
                      'pre',
                      'strong',
                      'u',
                      'ul',
                    ],
                    ALLOWED_ATTR: ['href', 'rel', 'target'],
                  }),
                }}
                sx={{
                  color: alpha(theme.palette.text.primary, 0.88),
                  fontSize: '0.86rem',
                  lineHeight: 1.6,
                  wordBreak: 'break-word',
                  '& a': { color: theme.palette.primary.light },
                  '& li': { marginBottom: '2px' },
                  '& ol, & ul': { margin: '6px 0', paddingLeft: '20px' },
                  '& p': { margin: '0 0 8px' },
                  '& p:last-child': { marginBottom: 0 },
                }}
              />
            ) : (
              <Typography
                sx={{
                  color: alpha(theme.palette.text.primary, 0.88),
                  fontSize: '0.86rem',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {notes ||
                  'The publisher did not add release notes for this build. It was published to QDN under the name GO 3.0.'}
              </Typography>
            )}
          </Box>
        </Box>

        {(busy || progress.phase === 'installing') && (
          <Box sx={{ display: 'grid', gap: 0.75 }}>
            <LinearProgress
              variant={
                progress.percent >= 0 && busy ? 'determinate' : 'indeterminate'
              }
              value={Math.max(0, Math.min(100, progress.percent))}
              sx={{
                backgroundColor: alpha(accent, 0.16),
                borderRadius: 999,
                height: 7,
                '& .MuiLinearProgress-bar': { borderRadius: 999 },
              }}
            />
            <Box
              sx={{
                display: 'flex',
                gap: 1,
                justifyContent: 'space-between',
              }}
            >
              <Typography
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.88),
                  fontSize: '0.78rem',
                }}
              >
                {progress.detail || 'Working…'}
              </Typography>
              {busy && progress.percent >= 0 && (
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.88),
                    fontSize: '0.78rem',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {`${Math.round(progress.percent)}%`}
                </Typography>
              )}
            </Box>
          </Box>
        )}

        {progress.phase === 'needs-permission' && (
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.9),
              fontSize: '0.82rem',
              lineHeight: 1.55,
            }}
          >
            Android only installs apps from sources you have allowed. Turn on
            “Install unknown apps” for Qortal GO — the install carries on by
            itself as soon as you come back.
          </Typography>
        )}

        {progress.phase === 'error' && (
          <Typography
            sx={{ color: theme.palette.error.light, fontSize: '0.82rem' }}
          >
            {progress.error}
          </Typography>
        )}

        {progress.phase === 'installing' && (
          <Box
            sx={{
              alignItems: 'center',
              color: theme.palette.success.light,
              display: 'flex',
              gap: 0.8,
            }}
          >
            <CheckCircleRoundedIcon sx={{ fontSize: 18 }} />
            <Typography sx={{ fontSize: '0.82rem' }}>
              Downloaded. Android will ask you to confirm the install.
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions
        sx={{
          borderTop: `1px solid ${alpha('#A9BCD8', 0.12)}`,
          gap: 1.1,
          px: 2.5,
          py: 1.7,
        }}
      >
        {busy ? (
          <Button
            onClick={minimizeAppUpdateWindow}
            sx={getDialogSecondaryButtonSx(theme)}
          >
            Continue in background
          </Button>
        ) : (
          <>
            <Button
              onClick={dismissAppUpdate}
              sx={getDialogSecondaryButtonSx(theme)}
            >
              Later
            </Button>
            <Button
              onClick={() => {
                if (progress.phase === 'needs-permission') {
                  void continueInstall();
                  return;
                }
                if (progress.phase === 'installing') {
                  void installDownloadedUpdate();
                  return;
                }
                if (progress.phase === 'error') resetAppUpdateProgress();
                void startAppUpdateDownload();
              }}
              sx={getDialogPrimaryButtonSx(theme)}
              variant="contained"
            >
              {progress.phase === 'needs-permission'
                ? 'Allow & install'
                : progress.phase === 'installing'
                  ? 'Install'
                  : progress.phase === 'error'
                    ? 'Try again'
                    : 'Install now'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};
