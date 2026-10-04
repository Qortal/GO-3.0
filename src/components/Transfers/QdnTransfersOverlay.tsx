import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AnimatePresence,
  animate,
  motion,
  useIsPresent,
  useMotionValue,
  useTransform,
  type PanInfo,
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
import { isAndroidPackageFile } from '../../utils/androidPackageFiles';
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
import { isSwipeDismissal } from '../common/SwipeToDismiss';
import { ACTIVE_TRANSFER_STAGES, transferStatusText } from './transferText';

/** More than this and the cards would cover the app they report on. */
const MAX_VISIBLE_CARDS = 3;
/** A card goes into the notifications bell by itself after this long. */
const AUTO_HIDE_MS = 5_000;
/** How far each card behind the front one shows below it. */
const STACK_PEEK_PX = 10;
/** How much smaller each card behind the front one is drawn. */
const STACK_SCALE_STEP = 0.05;
/** Sideways travel that makes the gesture a swipe, not a tap on Open. */
const SWIPE_SUPPRESSES_CLICK_PX = 8;
const FALLBACK_CARD_WIDTH_PX = 360;

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

/**
 * Where a card sits in the stack: the front one (depth 0) full size, each one
 * behind it a little smaller and showing a strip below it. Cards behind are
 * drawn at the front card's height, so the strips line up whatever they hold.
 * Scaling is about the centre, so the shrink is added back to the drop.
 */
function stackPose(depth: number, frontHeight: number) {
  const scale = 1 - depth * STACK_SCALE_STEP;
  return {
    scale,
    y: depth * STACK_PEEK_PX + (frontHeight * (1 - scale)) / 2,
  };
}

function TransferCard({
  transfer,
  hiddenIds,
  depth,
  frontHeight,
  onFrontHeight,
}: {
  transfer: QdnTransfer;
  hiddenIds: ReadonlySet<string>;
  /** 0 for the card in front, then 1, 2 for the ones behind it. */
  depth: number;
  frontHeight: number;
  onFrontHeight: (height: number) => void;
}) {
  const { t } = useTranslation(['core']);
  const cardRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [openFailed, setOpenFailed] = useState(false);
  // A leaving card is only a picture: AnimatePresence keeps every leaving card
  // until all of them have finished, and one that never finished left the
  // others at opacity 0 over the top bar, where a tap on the account menu hit
  // an invisible Open.
  const isPresent = useIsPresent();
  // framer re-resolves the exit on every render of a leaving card, and other
  // downloads' progress re-renders it all the time. The flight into the bell
  // is aimed from where the card is now, so mid-flight each render gave a new
  // target: the flight restarted, its first run never reported done, and the
  // card (and every card leaving with it) stayed in the page for good. So the
  // way out is decided once, as the card starts to leave.
  const exitRef = useRef<TargetAndTransition | null>(null);
  if (isPresent) exitRef.current = null;
  const front = depth === 0;
  // Only the front card takes taps; the ones behind are only its edge.
  const interactive = isPresent && front ? 'auto' : 'none';
  // Swiped sideways, the card leaves the screen that way and carries on in
  // GO's notifications: a running download is hidden (it keeps going in the
  // panel), a saved one is cleared (the panel lists the file).
  const x = useMotionValue(0);
  const swipeOpacity = useTransform(x, (value) => {
    const width = cardRef.current?.offsetWidth || FALLBACK_CARD_WIDTH_PX;
    return Math.max(0.2, 1 - Math.abs(value) / width);
  });
  const swipedRef = useRef(false);
  const swipeDirectionRef = useRef<1 | -1 | null>(null);
  const active = ACTIVE_TRANSFER_STAGES.has(transfer.stage);

  // Over the app only for a moment: then it carries on in the bell, from where
  // it can be brought back (and goes again after the same while).
  useEffect(() => {
    const timer = setTimeout(
      () => minimizeQdnTransfer(transfer.id),
      AUTO_HIDE_MS
    );
    return () => clearTimeout(timer);
  }, [transfer.id]);

  // The front card's height sets the height of the ones behind it.
  useEffect(() => {
    const paper = paperRef.current;
    if (!front || !paper) return undefined;
    onFrontHeight(paper.offsetHeight);
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(() =>
      onFrontHeight(paper.offsetHeight)
    );
    observer.observe(paper);
    return () => observer.disconnect();
  }, [front, onFrontHeight]);
  // An app package (.apk) a Q-App saved is listed with where it went, but GO
  // does not open it: that would put GO's name on installing it.
  const canOpen =
    transfer.stage === 'saved' &&
    !!transfer.uri &&
    !isAndroidPackageFile(transfer.filename, transfer.mimeType);

  const onOpen = async () => {
    if (!canOpen || !transfer.uri) return;
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

  const onSwipeEnd = (_event: PointerEvent, info: PanInfo) => {
    const width = cardRef.current?.offsetWidth || FALLBACK_CARD_WIDTH_PX;
    if (!isSwipeDismissal(info.offset.x, info.velocity.x, width)) {
      void animate(x, 0, { type: 'spring', stiffness: 520, damping: 38 });
      return;
    }
    swipeDirectionRef.current = info.offset.x < 0 ? -1 : 1;
    if (transfer.stage === 'saved') {
      dismissQdnTransfer(transfer.id);
    } else {
      minimizeQdnTransfer(transfer.id);
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
        ...stackPose(depth, frontHeight),
        transition: { type: 'spring', stiffness: 420, damping: 32 },
      }}
      // AnimatePresence hands an exiting card the latest set: hidden cards
      // fly into the bell, finished ones just fade, swiped ones slide on out.
      variants={{
        exit: (hidden: ReadonlySet<string> | undefined) => {
          if (exitRef.current) return exitRef.current;
          const target: TargetAndTransition = swipeDirectionRef.current
            ? {
                x:
                  swipeDirectionRef.current *
                  ((cardRef.current?.offsetWidth || FALLBACK_CARD_WIDTH_PX) +
                    24),
                opacity: 0,
                transition: { duration: 0.16, ease: 'easeOut' },
              }
            : hidden?.has(transfer.id)
              ? flyIntoBell(cardRef.current)
              : { opacity: 0, y: -12, transition: { duration: 0.18 } };
          // Asked while still on screen, it is only a preview: not kept.
          if (!isPresent) exitRef.current = target;
          return target;
        },
      }}
      exit="exit"
      drag={isPresent && front ? 'x' : false}
      dragDirectionLock
      dragMomentum={false}
      onDrag={(_event, info) => {
        if (Math.abs(info.offset.x) > SWIPE_SUPPRESSES_CLICK_PX) {
          swipedRef.current = true;
        }
      }}
      onDragEnd={onSwipeEnd}
      onPointerDownCapture={() => {
        swipedRef.current = false;
      }}
      onClickCapture={(event) => {
        // Letting go of a swipe over Open must not open the file too.
        if (!swipedRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        swipedRef.current = false;
      }}
      aria-hidden={!isPresent || !front || undefined}
      style={{
        left: 0,
        pointerEvents: interactive,
        position: 'absolute',
        right: 0,
        top: 0,
        transformOrigin: 'center',
        x,
        zIndex: MAX_VISIBLE_CARDS - depth,
      }}
    >
      <motion.div style={{ opacity: swipeOpacity }}>
        <Paper
          ref={paperRef}
          elevation={8}
          role="status"
          aria-live={front ? 'polite' : 'off'}
          sx={{
            pointerEvents: interactive,
            borderRadius: 3,
            px: 1.5,
            py: 1.25,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            ...(!front && frontHeight > 0
              ? { height: frontHeight, overflow: 'hidden' }
              : {}),
          }}
        >
          <Box
            sx={{
              opacity: front ? 1 : 0,
              transition: 'opacity 160ms ease',
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
              {canOpen && (
                <Button
                  size="small"
                  variant="contained"
                  onClick={onOpen}
                  sx={{ flexShrink: 0 }}
                >
                  {t('core:file_transfer.open')}
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
                variant={
                  transfer.percent >= 0 ? 'determinate' : 'indeterminate'
                }
                value={Math.max(0, transfer.percent)}
                aria-label={transfer.filename}
                sx={{ mt: 1, borderRadius: 1 }}
              />
            )}
          </Box>
        </Paper>
      </motion.div>
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
  const [frontHeight, setFrontHeight] = useState(0);

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
        pointerEvents: 'none',
      }}
    >
      {/* One stack, newest in front. The cards are positioned over each
          other, so one that leaves (or whose exit stalls) holds no place. */}
      <AnimatePresence custom={hiddenIds}>
        {visible.map((transfer, index) => (
          <TransferCard
            depth={visible.length - 1 - index}
            frontHeight={frontHeight}
            hiddenIds={hiddenIds}
            key={transfer.id}
            onFrontHeight={setFrontHeight}
            transfer={transfer}
          />
        ))}
      </AnimatePresence>
    </Box>
  );
}
