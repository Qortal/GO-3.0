import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AnimatePresence,
  motion,
  type TargetAndTransition,
} from 'framer-motion';
import {
  Box,
  Button,
  IconButton,
  LinearProgress,
  Paper,
  Typography,
} from '@mui/material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import { useTranslation } from 'react-i18next';
import { MOBILE_TOP_BAR_HEIGHT_PX } from '../Mobile/MobileTopBar';
import { SAFE_AREA_TOP } from '../../utils/mobileSafeArea';
import { isCapacitor } from '../../utils/platform';
import { openSavedMobileFile } from '../../utils/mobileFileSave';
import { installQappFetchReporter } from '../../utils/qappFetchReporter';
import { startQappFetchProgressListener } from '../../utils/qappFetchProgress';
import {
  dismissQdnTransfer,
  getQdnTransfers,
  minimizeQdnTransfer,
  retryQdnSave,
  subscribeQdnTransfers,
  type QdnTransfer,
} from '../../utils/qdnDownloadNotifications';
import {
  ACTIVE_TRANSFER_STAGES,
  isPackageFile,
  transferStatusText,
} from './transferText';

/** More than this and the cards would cover the app they report on. */
const MAX_VISIBLE_CARDS = 3;

/**
 * A hidden card shrinks into the notifications bell on the account avatar
 * (MobileTopBar marks it), so it is plain where the download went.
 */
function flyIntoBell(card: HTMLElement | null): TargetAndTransition {
  const bell = document.querySelector('[data-go-notifications-anchor]');
  if (!card || !bell) {
    return { opacity: 0, scale: 0.3, transition: { duration: 0.25 } };
  }
  const from = card.getBoundingClientRect();
  const to = bell.getBoundingClientRect();
  return {
    x: to.left + to.width / 2 - (from.left + from.width / 2),
    y: to.top + to.height / 2 - (from.top + from.height / 2),
    scale: 0.06,
    opacity: 0,
    transition: {
      duration: 0.5,
      ease: [0.55, 0, 0.3, 1],
      // Stays solid for the flight, gone as it reaches the bell.
      opacity: { duration: 0.5, ease: [0.8, 0, 1, 1] },
    },
  };
}

function TransferCard({
  transfer,
  hiddenIds,
}: {
  transfer: QdnTransfer;
  hiddenIds: ReadonlySet<string>;
}) {
  const { t } = useTranslation(['core']);
  const cardRef = useRef<HTMLDivElement>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const active = ACTIVE_TRANSFER_STAGES.has(transfer.stage);

  const onOpen = async () => {
    if (!transfer.uri) return;
    const opened = await openSavedMobileFile(
      transfer.uri,
      transfer.filename,
      transfer.mimeType
    );
    if (opened) {
      dismissQdnTransfer(transfer.id);
    } else {
      setOpenFailed(true);
    }
  };

  const icon =
    transfer.stage === 'saved' ? (
      <CheckCircleRoundedIcon sx={{ color: 'success.main' }} />
    ) : transfer.stage === 'failed' ? (
      <ErrorOutlineRoundedIcon sx={{ color: 'error.main' }} />
    ) : (
      <DownloadRoundedIcon
        sx={{
          color:
            transfer.stage === 'declined' ? 'warning.main' : 'primary.main',
        }}
      />
    );

  return (
    <motion.div
      ref={cardRef}
      custom={hiddenIds}
      initial={{ opacity: 0, y: -28, scale: 0.97 }}
      animate={{
        opacity: 1,
        y: 0,
        x: 0,
        scale: 1,
        transition: { type: 'spring', stiffness: 420, damping: 32 },
      }}
      // AnimatePresence hands an exiting card the latest set: hidden cards
      // fly into the bell, finished ones just fade.
      variants={{
        exit: (hidden: ReadonlySet<string> | undefined) =>
          hidden?.has(transfer.id)
            ? flyIntoBell(cardRef.current)
            : { opacity: 0, y: -12, transition: { duration: 0.18 } },
      }}
      exit="exit"
      style={{ pointerEvents: 'auto', transformOrigin: 'center' }}
    >
      <Paper
        elevation={8}
        role="status"
        aria-live="polite"
        sx={{
          pointerEvents: 'auto',
          borderRadius: 3,
          px: 1.5,
          py: 1.25,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          {icon}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {transfer.filename}
            </Typography>
            <Typography
              variant="caption"
              color={openFailed ? 'error' : 'text.secondary'}
              noWrap
              sx={{ display: 'block' }}
            >
              {openFailed
                ? t('core:file_transfer.open_failed')
                : transferStatusText(transfer, t)}
            </Typography>
          </Box>
          {transfer.stage === 'declined' && (
            <Button
              size="small"
              variant="contained"
              onClick={() => void retryQdnSave(transfer.id)}
              sx={{ flexShrink: 0 }}
            >
              {t('core:file_transfer.save')}
            </Button>
          )}
          {transfer.stage === 'saved' && transfer.uri && (
            <Button
              size="small"
              variant="contained"
              onClick={onOpen}
              sx={{ flexShrink: 0 }}
            >
              {isPackageFile(transfer.filename, transfer.mimeType)
                ? t('core:file_transfer.install')
                : t('core:file_transfer.open')}
            </Button>
          )}
          {active ? (
            <IconButton
              size="small"
              aria-label={t('core:file_transfer.hide')}
              title={t('core:file_transfer.hide')}
              onClick={() => minimizeQdnTransfer(transfer.id)}
            >
              <KeyboardArrowDownRoundedIcon />
            </IconButton>
          ) : (
            <IconButton
              size="small"
              aria-label={t('core:file_transfer.dismiss')}
              onClick={() => dismissQdnTransfer(transfer.id)}
            >
              <CloseRoundedIcon />
            </IconButton>
          )}
        </Box>
        {active && (
          <LinearProgress
            variant={transfer.percent >= 0 ? 'determinate' : 'indeterminate'}
            value={Math.max(0, transfer.percent)}
            aria-label={transfer.filename}
            sx={{ mt: 1, borderRadius: 1 }}
          />
        )}
      </Paper>
    </motion.div>
  );
}

/**
 * Progress cards for files on their way to the phone: QDN saves, and big
 * downloads a Q-App makes before asking GO to save them. A hidden card carries
 * on in GO's notifications panel (QdnDownloadsNotice).
 */
export function QdnTransfersOverlay() {
  const transfers = useSyncExternalStore(
    subscribeQdnTransfers,
    getQdnTransfers,
    getQdnTransfers
  );

  useEffect(() => {
    if (!isCapacitor()) return undefined;
    void installQappFetchReporter();
    return startQappFetchProgressListener();
  }, []);

  const visible = transfers
    .filter((transfer) => !transfer.minimized)
    .slice(-MAX_VISIBLE_CARDS);
  // A new set only when a card is hidden or shown: handing AnimatePresence a
  // fresh one on every progress update restarted the fly-out, so it never
  // finished and the shrunken card was left sitting by the bell.
  const hiddenKey = transfers
    .filter((transfer) => transfer.minimized)
    .map((transfer) => transfer.id)
    .sort()
    .join('\n');
  const hiddenIds = useMemo(
    () => new Set(hiddenKey ? hiddenKey.split('\n') : []),
    [hiddenKey]
  );

  // Always mounted, so a card leaving the last slot still gets its exit.
  return (
    <Box
      sx={{
        position: 'fixed',
        left: 12,
        right: 12,
        top: `calc(${MOBILE_TOP_BAR_HEIGHT_PX}px + ${SAFE_AREA_TOP} + 8px)`,
        maxWidth: 520,
        mx: 'auto',
        zIndex: (theme) => theme.zIndex.snackbar,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence custom={hiddenIds}>
        {visible.map((transfer) => (
          <TransferCard
            hiddenIds={hiddenIds}
            key={transfer.id}
            transfer={transfer}
          />
        ))}
      </AnimatePresence>
    </Box>
  );
}
