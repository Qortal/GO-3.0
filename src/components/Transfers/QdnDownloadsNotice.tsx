import { useState, useSyncExternalStore } from 'react';
import { AnimatePresence } from 'framer-motion';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import {
  Box,
  Button,
  IconButton,
  LinearProgress,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { openSavedMobileFile } from '../../utils/mobileFileSave';
import {
  countUnseenQdnDownloads,
  dismissQdnTransfer,
  getPanelSavedQdnFiles,
  getQdnTransfers,
  getSavedQdnFiles,
  hideSavedQdnFilesFromPanel,
  removeSavedQdnFile,
  restoreQdnTransfer,
  retryQdnSave,
  subscribeQdnTransfers,
  type QdnTransfer,
  type SavedQdnFile,
} from '../../utils/qdnDownloadNotifications';
import { formatDate } from '../../utils/time';
import { SwipeToDismiss } from '../common/SwipeToDismiss';
import { isAndroidPackageFile } from '../../utils/androidPackageFiles';
import { PANEL_TRANSFER_STAGES, transferStatusText } from './transferText';

const useTransfers = () =>
  useSyncExternalStore(subscribeQdnTransfers, getQdnTransfers, getQdnTransfers);
const useSavedFiles = () =>
  useSyncExternalStore(
    subscribeQdnTransfers,
    getSavedQdnFiles,
    getSavedQdnFiles
  );

/** What the downloads add to the bell: its badge count, and whether to list. */
export const useQdnDownloadsBadge = () => {
  const transfers = useTransfers();
  const saved = useSavedFiles();
  const listed = transfers.filter((transfer) =>
    PANEL_TRANSFER_STAGES.has(transfer.stage)
  );
  const panelSaved = getPanelSavedQdnFiles(saved).length;
  return {
    unseen: countUnseenQdnDownloads(transfers, saved),
    hasAny: listed.length > 0 || panelSaved > 0,
    /** Saved files the panel's Clear all would move to the history. */
    clearable: panelSaved,
  };
};

const rowSx = (accent: string, dark: boolean) => ({
  backgroundColor: alpha(accent, dark ? 0.1 : 0.07),
  border: `1px solid ${alpha(accent, 0.34)}`,
  borderRadius: '14px',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 0.9,
  px: 1.35,
  py: 1.1,
  width: '100%',
});

const IconTile = ({
  accent,
  children,
}: {
  accent: string;
  children: React.ReactNode;
}) => (
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
    {children}
  </Box>
);

function DownloadRow({
  transfer,
  onShowCard,
}: {
  transfer: QdnTransfer;
  onShowCard: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const failed = transfer.stage === 'failed';
  const declined = transfer.stage === 'declined';
  const finished = failed || declined;
  const accent = failed
    ? theme.palette.error.main
    : declined
      ? theme.palette.warning.main
      : theme.palette.primary.main;

  return (
    <Box
      onClick={() => {
        if (finished) return;
        restoreQdnTransfer(transfer.id);
        onShowCard();
      }}
      sx={{
        ...rowSx(accent, theme.palette.mode === 'dark'),
        cursor: finished ? 'default' : 'pointer',
      }}
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.15 }}>
        <IconTile accent={accent}>
          {failed ? (
            <ErrorOutlineRoundedIcon sx={{ fontSize: 20 }} />
          ) : (
            <DownloadRoundedIcon sx={{ fontSize: 20 }} />
          )}
        </IconTile>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            noWrap
            sx={{
              color: theme.palette.text.primary,
              fontSize: '0.9rem',
              fontWeight: 700,
              lineHeight: 1.3,
            }}
          >
            {transfer.filename}
          </Typography>
          <Typography
            noWrap
            sx={{
              color: failed
                ? theme.palette.error.light
                : alpha(theme.palette.text.secondary, 0.9),
              fontSize: '0.76rem',
              lineHeight: 1.4,
            }}
          >
            {transferStatusText(transfer, t)}
          </Typography>
        </Box>
        {finished && (
          <IconButton
            aria-label={t('core:file_transfer.dismiss')}
            onClick={(event) => {
              event.stopPropagation();
              dismissQdnTransfer(transfer.id);
            }}
            size="small"
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
      {declined && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            onClick={(event) => {
              event.stopPropagation();
              onShowCard();
              void retryQdnSave(transfer.id);
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
            {t('core:file_transfer.save')}
          </Button>
        </Box>
      )}
      {!finished && (
        <LinearProgress
          aria-label={transfer.filename}
          value={Math.max(0, transfer.percent)}
          variant={transfer.percent >= 0 ? 'determinate' : 'indeterminate'}
          sx={{
            backgroundColor: alpha(accent, 0.18),
            borderRadius: 999,
            height: 5,
            '& .MuiLinearProgress-bar': { borderRadius: 999 },
          }}
        />
      )}
    </Box>
  );
}

/** A saved file with its Open / Install button (also used by the history). */
export function SavedQdnFileRow({
  file,
  onOpened,
  onRemove = () => removeSavedQdnFile(file.id),
}: {
  file: SavedQdnFile;
  onOpened: () => void;
  /** The X. The history forgets the file; the panel only clears it. */
  onRemove?: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [openFailed, setOpenFailed] = useState(false);
  const accent = theme.palette.success.main;
  // Packages are saved without a uri: GO never opens them (only its own
  // updater installs), so there is no Open and no "ready to install".
  const packageFile = isAndroidPackageFile(file.filename, file.mimeType);

  const open = async () => {
    if (!file.uri) return;
    const opened = await openSavedMobileFile(
      file.uri,
      file.filename,
      file.mimeType
    );
    if (opened) {
      onOpened();
    } else {
      setOpenFailed(true);
    }
  };

  return (
    <Box
      onClick={() => void open()}
      sx={{
        ...rowSx(accent, theme.palette.mode === 'dark'),
        cursor: file.uri ? 'pointer' : 'default',
      }}
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.15 }}>
        <IconTile accent={accent}>
          <CheckCircleRoundedIcon sx={{ fontSize: 20 }} />
        </IconTile>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            noWrap
            sx={{
              color: theme.palette.text.primary,
              fontSize: '0.9rem',
              fontWeight: 700,
              lineHeight: 1.3,
            }}
          >
            {file.filename}
          </Typography>
          <Typography
            sx={{
              color: openFailed
                ? theme.palette.error.light
                : alpha(theme.palette.text.secondary, 0.9),
              fontSize: '0.76rem',
              lineHeight: 1.4,
            }}
          >
            {openFailed
              ? t('core:file_transfer.open_failed')
              : t(
                  file.uri
                    ? 'core:file_transfer.ready_to_open'
                    : packageFile
                      ? 'core:file_transfer.package_saved'
                      : 'core:file_transfer.saved_to',
                  { location: file.location }
                )}
          </Typography>
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.7),
              fontSize: '0.7rem',
              lineHeight: 1.4,
            }}
          >
            {formatDate(file.savedAt)}
          </Typography>
        </Box>
        <IconButton
          aria-label={t('core:file_transfer.remove')}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          size="small"
          sx={{ alignSelf: 'flex-start', mr: -0.5, mt: -0.5 }}
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Box>
      {file.uri && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            onClick={(event) => {
              event.stopPropagation();
              void open();
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
            {t('core:file_transfer.open')}
          </Button>
        </Box>
      )}
    </Box>
  );
}

/**
 * Downloads as they appear in GO's notifications panel: what is on its way
 * (a hidden progress card lands here), and what is saved and ready to open.
 * `onClose` closes the panel when an action takes the person elsewhere.
 */
export const QdnDownloadsNotice = ({ onClose }: { onClose?: () => void }) => {
  const transfers = useTransfers();
  // Files cleared from the panel stay in the notification history.
  const saved = getPanelSavedQdnFiles(useSavedFiles());
  const running = transfers.filter((transfer) =>
    PANEL_TRANSFER_STAGES.has(transfer.stage)
  );
  if (running.length === 0 && saved.length === 0) return null;

  return (
    <>
      {running.map((transfer) => (
        <DownloadRow
          key={transfer.id}
          onShowCard={() => onClose?.()}
          transfer={transfer}
        />
      ))}
      <AnimatePresence initial={false}>
        {saved.map((file) => (
          <SwipeToDismiss
            gapPx={8}
            key={file.id}
            onDismiss={() => hideSavedQdnFilesFromPanel(file.id)}
          >
            <SavedQdnFileRow
              file={file}
              onOpened={() => onClose?.()}
              onRemove={() => hideSavedQdnFilesFromPanel(file.id)}
            />
          </SwipeToDismiss>
        ))}
      </AnimatePresence>
    </>
  );
};
