import { useEffect, useState } from 'react';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SystemUpdateAltRoundedIcon from '@mui/icons-material/SystemUpdateAltRounded';
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogContent,
  LinearProgress,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import DOMPurify from 'dompurify';
import '../../utils/configureDomPurify';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  appUpdateCheckAtom,
  appUpdateInstalledVersionAtom,
  appUpdateProgressAtom,
  appUpdateReleaseAtom,
  appUpdateReleaseListAtom,
  appUpdateTargetAtom,
  appUpdateWindowOpenAtom,
} from '../../appUpdate/appUpdateAtoms';
import {
  canInstallBuilds,
  checkForUpdatesNow,
  closeAppUpdateWindow,
  continueInstall,
  dismissAppUpdate,
  installDownloadedUpdate,
  loadPublishedReleases,
  markAppUpdateSeen,
  readInstalledVersion,
  resetAppUpdateProgress,
  startAppUpdateDownload,
} from '../../appUpdate/appUpdateController';
import {
  APP_UPDATE_QDN_NAME,
  APP_UPDATE_SHARE_APP,
  compareVersions,
  qShareSharePath,
  type AppRelease,
} from '../../appUpdate/qdnAppUpdate';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { executeEvent } from '../../utils/events';
import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../../utils/mobileSafeArea';
import { getDialogPaperSx } from '../App/dialogSurface';
import { MobilePanelHeader } from '../Mobile/MobilePanelHeader';
import {
  formatUpdateDate,
  formatUpdateSize,
  updateHeadline,
} from './appUpdateFormat';

/** Q-Share's rich release notes, cut down to text formatting. */
const NOTES_ALLOWED_TAGS = [
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
];

/** Collapsed notes show about this many lines before "Show changes". */
const COLLAPSED_NOTES_PX = 104;

const cardSx = (theme: Theme) => ({
  backgroundColor:
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.common.white, 0.025)
      : theme.palette.action.hover,
  border: `1px solid ${alpha(theme.palette.divider, 0.9)}`,
  borderRadius: '14px',
  px: 1.5,
  py: 1.35,
});

const sectionLabelSx = (theme: Theme) => ({
  color: alpha(theme.palette.text.secondary, 0.8),
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase' as const,
});

/** Opens the build's share page in Q-Share, in a tab like any Q-App link. */
const openInQShare = (release: AppRelease) => {
  const path = qShareSharePath(release);
  if (!path) return;
  closeAppUpdateWindow();
  executeEvent('addTab', {
    data: {
      name: APP_UPDATE_SHARE_APP,
      navigateIfAlreadyOpen: true,
      path,
      service: 'APP',
    },
  });
  executeEvent('open-apps-mode', {});
};

function ReleaseNotes({
  release,
  expanded,
}: {
  release: AppRelease;
  expanded: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const notes = release.notes?.trim();

  const body = release.notesHtml ? (
    <Box
      // Q-Share stores the notes as rich text; sanitised because it is a
      // stranger's HTML until proven otherwise.
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(release.notesHtml, {
          ALLOWED_ATTR: ['href', 'rel', 'target'],
          ALLOWED_TAGS: NOTES_ALLOWED_TAGS,
        }),
      }}
      sx={{
        color: alpha(theme.palette.text.primary, 0.88),
        fontSize: '0.84rem',
        lineHeight: 1.55,
        wordBreak: 'break-word',
        '& a': { color: theme.palette.primary.light },
        '& li': { marginBottom: '2px' },
        '& ol, & ul': { margin: '6px 0', paddingLeft: '20px' },
        '& p': { margin: '0 0 6px' },
        '& p:last-child': { marginBottom: 0 },
      }}
    />
  ) : (
    <Typography
      sx={{
        color: alpha(theme.palette.text.primary, notes ? 0.88 : 0.6),
        fontSize: '0.84rem',
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {notes || t('core:go_updates.no_notes')}
    </Typography>
  );

  return (
    <Box
      sx={{
        maxHeight: expanded ? 'none' : COLLAPSED_NOTES_PX,
        overflow: 'hidden',
        position: 'relative',
        ...(expanded
          ? {}
          : {
              maskImage: 'linear-gradient(180deg, #000 55%, transparent 100%)',
              WebkitMaskImage:
                'linear-gradient(180deg, #000 55%, transparent 100%)',
            }),
      }}
    >
      {body}
    </Box>
  );
}

function ReleaseCard({
  release,
  installed,
  defaultExpanded,
  busy,
  onInstall,
}: {
  release: AppRelease;
  installed: string;
  defaultExpanded: boolean;
  /** Another install is running; buttons wait for it. */
  busy: boolean;
  onInstall: (release: AppRelease) => void;
}) {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const order = installed ? compareVersions(release.version, installed) : 1;
  const isInstalled = Boolean(installed) && order === 0;
  const meta = [
    formatUpdateSize(release.size),
    formatUpdateDate(release.publishedAt, t, i18n.language),
  ]
    .filter(Boolean)
    .join(' · ');

  const chip = isInstalled
    ? {
        color: theme.palette.success.main,
        label: t('core:go_updates.badge.installed'),
      }
    : order > 0
      ? {
          color: theme.palette.primary.main,
          label: t('core:go_updates.badge.new'),
        }
      : {
          color: theme.palette.text.secondary,
          label: t('core:go_updates.badge.older'),
        };

  return (
    <Box
      component="li"
      sx={{
        ...cardSx(theme),
        borderColor: isInstalled
          ? alpha(theme.palette.success.main, 0.4)
          : order > 0
            ? alpha(theme.palette.primary.main, 0.4)
            : alpha(theme.palette.divider, 0.9),
        display: 'grid',
        gap: 1,
        listStyle: 'none',
      }}
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontSize: '0.98rem',
            fontWeight: 750,
          }}
        >
          {`v${release.version}`}
        </Typography>
        <Box
          component="span"
          sx={{
            border: `1px solid ${alpha(chip.color, 0.45)}`,
            borderRadius: 999,
            color: chip.color,
            fontSize: '0.68rem',
            fontWeight: 700,
            lineHeight: 1.6,
            px: 0.9,
          }}
        >
          {chip.label}
        </Box>
        <Typography
          noWrap
          sx={{
            color: alpha(theme.palette.text.secondary, 0.8),
            flex: 1,
            fontSize: '0.74rem',
            minWidth: 0,
            textAlign: 'right',
          }}
        >
          {meta}
        </Typography>
      </Box>

      <ReleaseNotes expanded={expanded} release={release} />

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.75,
          justifyContent: 'space-between',
        }}
      >
        <ButtonBase
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          sx={{
            borderRadius: 999,
            color: theme.palette.primary.light,
            fontSize: '0.78rem',
            fontWeight: 650,
            px: 0.75,
            py: 0.4,
          }}
        >
          {expanded
            ? t('core:go_updates.hide_changes')
            : t('core:go_updates.show_changes')}
        </ButtonBase>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {qShareSharePath(release) && (
            <Button
              endIcon={<OpenInNewRoundedIcon sx={{ fontSize: 16 }} />}
              onClick={() => openInQShare(release)}
              size="small"
              sx={{
                borderRadius: '9px',
                fontSize: '0.78rem',
                fontWeight: 650,
                textTransform: 'none',
              }}
            >
              {t('core:go_updates.open_in_qshare')}
            </Button>
          )}
          {/* Only newer builds install; Android refuses an older one. */}
          {canInstallBuilds() && order > 0 && (
            <Button
              disabled={busy}
              onClick={() => onInstall(release)}
              size="small"
              variant="contained"
              sx={{
                borderRadius: '9px',
                boxShadow: 'none',
                fontSize: '0.78rem',
                fontWeight: 700,
                textTransform: 'none',
              }}
            >
              {t('core:go_updates.install')}
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/** The build being installed: its progress, and what to do next. */
function InstallJobCard() {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const target = useAtomValue(appUpdateTargetAtom);
  const progress = useAtomValue(appUpdateProgressAtom);
  if (!target || progress.phase === 'idle') return null;

  const busy =
    progress.phase === 'preparing' || progress.phase === 'downloading';
  const accent = theme.palette.primary.main;

  return (
    <Box
      aria-live="polite"
      sx={{
        ...cardSx(theme),
        backgroundColor: alpha(
          accent,
          theme.palette.mode === 'dark' ? 0.1 : 0.07
        ),
        borderColor: alpha(accent, 0.4),
        display: 'grid',
        gap: 1,
      }}
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.1 }}>
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
            }}
          >
            {updateHeadline(progress.phase, t)}
          </Typography>
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.9),
              fontSize: '0.76rem',
            }}
          >
            {t('core:go_updates.job.updating_to', {
              version: target.version,
            })}
          </Typography>
        </Box>
      </Box>

      {busy && (
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          <LinearProgress
            value={Math.max(0, Math.min(100, progress.percent))}
            variant={progress.percent >= 0 ? 'determinate' : 'indeterminate'}
            sx={{
              backgroundColor: alpha(accent, 0.16),
              borderRadius: 999,
              height: 6,
              '& .MuiLinearProgress-bar': { borderRadius: 999 },
            }}
          />
          <Box
            sx={{ display: 'flex', gap: 1, justifyContent: 'space-between' }}
          >
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.88),
                fontSize: '0.74rem',
              }}
            >
              {progress.detail || ''}
            </Typography>
            {progress.percent >= 0 && (
              <Typography
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.88),
                  fontSize: '0.74rem',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {`${Math.round(progress.percent)}%`}
              </Typography>
            )}
          </Box>
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.7),
              fontSize: '0.72rem',
            }}
          >
            {t('core:go_updates.job.continue_background')}
          </Typography>
        </Box>
      )}

      {progress.phase === 'needs-permission' && (
        <Typography
          sx={{
            color: alpha(theme.palette.text.secondary, 0.9),
            fontSize: '0.8rem',
            lineHeight: 1.5,
          }}
        >
          {t('core:go_updates.job.permission_hint')}
        </Typography>
      )}

      {progress.phase === 'installing' && (
        <Box
          sx={{
            alignItems: 'flex-start',
            color: theme.palette.success.light,
            display: 'flex',
            gap: 0.8,
          }}
        >
          <CheckCircleRoundedIcon sx={{ fontSize: 18, mt: '1px' }} />
          <Typography sx={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
            {t('core:go_updates.job.confirm_hint')}
          </Typography>
        </Box>
      )}

      {progress.phase === 'error' && (
        <Typography
          sx={{ color: theme.palette.error.light, fontSize: '0.8rem' }}
        >
          {progress.error}
        </Typography>
      )}

      {!busy && (
        <Box sx={{ display: 'flex', gap: 0.75, justifyContent: 'flex-end' }}>
          <Button
            onClick={resetAppUpdateProgress}
            size="small"
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.78rem',
              fontWeight: 600,
              textTransform: 'none',
            }}
          >
            {t('core:go_updates.job.dismiss')}
          </Button>
          <Button
            onClick={() => {
              if (progress.phase === 'needs-permission') {
                void continueInstall();
              } else if (progress.phase === 'installing') {
                void installDownloadedUpdate();
              } else {
                void startAppUpdateDownload(target);
              }
            }}
            size="small"
            variant="contained"
            sx={{
              borderRadius: '9px',
              boxShadow: 'none',
              fontSize: '0.78rem',
              fontWeight: 700,
              textTransform: 'none',
            }}
          >
            {progress.phase === 'needs-permission'
              ? t('core:go_updates.job.allow_installs')
              : progress.phase === 'installing'
                ? t('core:go_updates.install')
                : t('core:go_updates.retry')}
          </Button>
        </Box>
      )}
    </Box>
  );
}

/**
 * GO 3.0 Updates: the check, the update on offer (with the bell), whatever is
 * being installed, and every build published under the name with its notes
 * and a link to it in Q-Share. Only newer builds can be installed from here.
 *
 * Closing it never stops a download; the progress is here when it reopens.
 */
export const AppUpdateWindow = () => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const open = useAtomValue(appUpdateWindowOpenAtom);
  const offered = useAtomValue(appUpdateReleaseAtom);
  const target = useAtomValue(appUpdateTargetAtom);
  const progress = useAtomValue(appUpdateProgressAtom);
  const check = useAtomValue(appUpdateCheckAtom);
  const list = useAtomValue(appUpdateReleaseListAtom);
  const installed = useAtomValue(appUpdateInstalledVersionAtom);

  useEffect(() => {
    if (open) void readInstalledVersion();
  }, [open]);
  // An update found while the screen is open counts as seen.
  useEffect(() => {
    if (open && offered) markAppUpdateSeen();
  }, [open, offered]);

  useAndroidBack(
    () => {
      closeAppUpdateWindow();
      return true;
    },
    { enabled: open, priority: BACK_PRIORITY.dialog }
  );

  const jobBusy =
    progress.phase === 'preparing' || progress.phase === 'downloading';
  const checking = check.status === 'checking' || list.status === 'loading';
  // The newest newer build, from the list or (before it loads) the check.
  const newest = list.releases[0] ?? offered;
  const update =
    newest && installed && compareVersions(newest.version, installed) > 0
      ? newest
      : null;
  const updateInstalling =
    update &&
    target?.identifier === update.identifier &&
    progress.phase !== 'idle';

  const install = (release: AppRelease) => {
    void startAppUpdateDownload(release);
  };

  const statusText = checking
    ? t('core:go_updates.checking')
    : check.status === 'unreachable'
      ? t('core:go_updates.status.unreachable')
      : check.status === 'available' || update
        ? t('core:go_updates.status.available')
        : check.status === 'up-to-date'
          ? t('core:go_updates.status.up_to_date')
          : t('core:go_updates.status.never');

  return (
    <Dialog
      fullScreen={fullScreen}
      fullWidth
      maxWidth="sm"
      onClose={closeAppUpdateWindow}
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
        icon={<SystemUpdateAltRoundedIcon />}
        onClose={closeAppUpdateWindow}
        title={t('core:go_updates.title')}
      />

      <DialogContent
        sx={{
          alignContent: 'start',
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: 'minmax(0, 1fr)',
          px: 1.75,
          py: 1.75,
        }}
      >
        <Box sx={{ ...cardSx(theme), display: 'grid', gap: 1 }}>
          <Typography sx={sectionLabelSx(theme)}>
            {t('core:go_updates.installed_label')}
          </Typography>
          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: '1.05rem',
              fontWeight: 750,
            }}
          >
            {installed
              ? `${APP_UPDATE_QDN_NAME} v${installed}`
              : APP_UPDATE_QDN_NAME}
          </Typography>
          <Typography
            aria-live="polite"
            sx={{
              color:
                check.status === 'unreachable' && !checking
                  ? theme.palette.error.light
                  : alpha(theme.palette.text.secondary, 0.9),
              fontSize: '0.8rem',
              lineHeight: 1.45,
            }}
          >
            {statusText}
            {check.checkedAt && !checking
              ? ` · ${t('core:go_updates.last_checked', {
                  time: new Date(check.checkedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}`
              : ''}
          </Typography>
          <Button
            disabled={checking}
            onClick={() => void checkForUpdatesNow()}
            startIcon={
              checking ? (
                <CircularProgress color="inherit" size={16} />
              ) : (
                <RefreshRoundedIcon />
              )
            }
            variant="outlined"
            sx={{
              borderRadius: '10px',
              fontWeight: 700,
              justifySelf: 'start',
              mt: 0.25,
              textTransform: 'none',
            }}
          >
            {checking
              ? t('core:go_updates.checking')
              : t('core:go_updates.check')}
          </Button>
        </Box>

        {update && !updateInstalling && (
          <Box
            sx={{
              ...cardSx(theme),
              backgroundColor: alpha(
                theme.palette.primary.main,
                theme.palette.mode === 'dark' ? 0.12 : 0.08
              ),
              borderColor: alpha(theme.palette.primary.main, 0.45),
              display: 'grid',
              gap: 1,
            }}
          >
            <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.1 }}>
              <Box
                sx={{
                  alignItems: 'center',
                  backgroundColor: alpha(theme.palette.primary.main, 0.18),
                  borderRadius: '10px',
                  color: theme.palette.primary.main,
                  display: 'flex',
                  flexShrink: 0,
                  height: 36,
                  justifyContent: 'center',
                  width: 36,
                }}
              >
                <NotificationsActiveRoundedIcon sx={{ fontSize: 21 }} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    color: theme.palette.text.primary,
                    fontSize: '0.92rem',
                    fontWeight: 750,
                  }}
                >
                  {t('core:go_updates.available_title')}
                </Typography>
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.9),
                    fontSize: '0.76rem',
                  }}
                >
                  {[
                    `v${update.version}`,
                    formatUpdateSize(update.size),
                    formatUpdateDate(update.publishedAt, t, i18n.language),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
              </Box>
            </Box>
            <Box
              sx={{ display: 'flex', gap: 0.75, justifyContent: 'flex-end' }}
            >
              {offered?.identifier === update.identifier && (
                <Button
                  onClick={dismissAppUpdate}
                  size="small"
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    textTransform: 'none',
                  }}
                >
                  {t('core:go_updates.later')}
                </Button>
              )}
              {canInstallBuilds() ? (
                <Button
                  disabled={jobBusy}
                  onClick={() => install(update)}
                  size="small"
                  variant="contained"
                  sx={{
                    borderRadius: '9px',
                    boxShadow: 'none',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    textTransform: 'none',
                  }}
                >
                  {t('core:go_updates.install_update')}
                </Button>
              ) : (
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.8),
                    fontSize: '0.76rem',
                  }}
                >
                  {t('core:go_updates.android_only')}
                </Typography>
              )}
            </Box>
          </Box>
        )}

        <InstallJobCard />

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: 1,
            justifyContent: 'space-between',
            mt: 0.5,
            px: 0.25,
          }}
        >
          <Typography sx={sectionLabelSx(theme)}>
            {t('core:go_updates.versions_title')}
          </Typography>
          {list.status === 'loading' && list.releases.length > 0 && (
            <CircularProgress size={14} />
          )}
        </Box>

        {list.releases.length === 0 && (
          <Box
            sx={{
              ...cardSx(theme),
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              py: 2.5,
              textAlign: 'center',
            }}
          >
            {list.status === 'loading' || list.status === 'idle' ? (
              <>
                <CircularProgress size={22} />
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.85),
                    fontSize: '0.82rem',
                  }}
                >
                  {t('core:go_updates.loading_versions')}
                </Typography>
              </>
            ) : (
              <>
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.85),
                    fontSize: '0.82rem',
                  }}
                >
                  {list.status === 'unreachable'
                    ? t('core:go_updates.versions_unreachable')
                    : t('core:go_updates.no_versions')}
                </Typography>
                <Button
                  onClick={() => void loadPublishedReleases({ force: true })}
                  size="small"
                  sx={{ fontWeight: 650, textTransform: 'none' }}
                >
                  {t('core:go_updates.retry')}
                </Button>
              </>
            )}
          </Box>
        )}

        {list.releases.length > 0 && (
          <Box component="ul" sx={{ display: 'grid', gap: 1.1, m: 0, p: 0 }}>
            {list.releases.map((release, index) => (
              <ReleaseCard
                busy={jobBusy}
                defaultExpanded={index === 0}
                installed={installed}
                key={release.identifier}
                onInstall={install}
                release={release}
              />
            ))}
          </Box>
        )}

        {list.missing > 0 && list.status !== 'loading' && (
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.75),
              fontSize: '0.76rem',
              px: 0.5,
              textAlign: 'center',
            }}
          >
            {t('core:go_updates.versions_missing', { count: list.missing })}
          </Typography>
        )}

        {!canInstallBuilds() && list.releases.length > 0 && (
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.75),
              fontSize: '0.76rem',
              px: 0.5,
              textAlign: 'center',
            }}
          >
            {t('core:go_updates.android_only')}
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
};
