import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  AnimatePresence,
  motion,
  useDragControls,
  type PanInfo,
} from 'framer-motion';
import {
  alpha,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  keyframes,
  Typography,
  useTheme,
} from '@mui/material';
import CloudDoneRoundedIcon from '@mui/icons-material/CloudDoneRounded';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import DnsRoundedIcon from '@mui/icons-material/DnsRounded';
import HourglassTopRoundedIcon from '@mui/icons-material/HourglassTopRounded';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  isPublicNodeUnavailableAtom,
  selectedNodeInfoAtom,
} from '../../atoms/global';
import { EXT_NODE_QORTAL_LINK } from '../../constants/constants';
import {
  checkPublicNodeNow,
  configurePublicNodeWatch,
  getPublicNodeSnapshot,
  isPublicNodeQdnNoticeHidden,
  publicNodeUrlChanged,
  setPublicNodeQdnNoticeHidden,
  setPublicNodeWatchEnabled,
  subscribePublicNodeWatch,
  waitForPublicNode,
  type PublicNodeWindow,
} from '../../publicNode/publicNodeWatch';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { executeEvent } from '../../utils/events';
import { getBaseApiReact } from '../../utils/globalApi';
import {
  SAFE_AREA_BOTTOM,
  SAFE_AREA_LEFT,
  SAFE_AREA_RIGHT,
  SAFE_AREA_TOP,
} from '../../utils/mobileSafeArea';
import { QappIcon } from '../App/QappIcon';
import { getDeviceOnline } from '../Reticulum/reticulumStatus';
import { immersiveMotionReduced } from './immersive/useImmersiveBars';
import { MOBILE_TAB_BAR_HEIGHT_PX } from './mobileBarHeights';

/** Over the publish window (1284/1285), under Settings and approvals. */
const BACKDROP_Z = 1286;
const CARD_Z = 1287;
const CARD_RADIUS_PX = 28;
/** A pull down on the card this far (or flung) means "Wait". */
const PULL_TO_CLOSE_PX = 80;
const PULL_TO_CLOSE_SPEED = 600;

const ring = keyframes`
  from { transform: scale(1); opacity: 0.55; }
  to { transform: scale(1.7); opacity: 0; }
`;
const blink = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
`;

const buttonSx = {
  borderRadius: '14px',
  fontWeight: 700,
  py: 1.1,
  textTransform: 'none',
} as const;

/** Re-renders every second while `active`, for the next-check countdown. */
function useSecondTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * "Public node unavailable": GO is on the public node, it stopped answering,
 * and the user opened a Q-App or website (or GO's own QDN loads failed). The
 * user can wait (GO keeps checking and opens or reloads the app when the
 * node is back) or move to a private node. See publicNode/publicNodeWatch.ts.
 */
export function PublicNodeDownWindow({ enabled }: { enabled: boolean }) {
  const snapshot = useSyncExternalStore(
    subscribePublicNodeWatch,
    getPublicNodeSnapshot,
    getPublicNodeSnapshot
  );
  const nodeUrl = useAtomValue(selectedNodeInfoAtom)?.url ?? null;
  const setPublicNodeUnavailable = useSetAtom(isPublicNodeUnavailableAtom);

  useEffect(() => {
    configurePublicNodeWatch({
      nodeUrl: () => getBaseApiReact(),
      deviceOnline: getDeviceOnline,
    });
    setPublicNodeWatchEnabled(enabled);
  }, [enabled]);

  useEffect(() => () => setPublicNodeWatchEnabled(false), []);

  useEffect(() => {
    publicNodeUrlChanged();
  }, [nodeUrl]);

  // The avatar prewarm skips its rounds while this is set.
  const down = snapshot.health === 'down';
  useEffect(() => {
    setPublicNodeUnavailable(down);
  }, [down, setPublicNodeUnavailable]);

  const view = enabled ? snapshot.window : null;
  useAndroidBack(
    () => {
      waitForPublicNode();
      return true;
    },
    { priority: BACK_PRIORITY.dialog, enabled: Boolean(view) }
  );

  const reducedMotion = immersiveMotionReduced();

  return (
    <AnimatePresence>
      {view ? (
        <motion.div
          key="public-node-backdrop"
          aria-hidden
          data-testid="public-node-backdrop"
          onClick={() => waitForPublicNode()}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            backdropFilter: 'blur(4px)',
            background: 'rgba(0, 0, 0, 0.42)',
            inset: 0,
            position: 'fixed',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: BACKDROP_Z,
          }}
        />
      ) : null}
      {view ? (
        <PublicNodeCard
          key={`public-node-card-${view.key}`}
          view={view}
          checking={snapshot.checking}
          nextCheckAt={snapshot.nextCheckAt}
          reducedMotion={reducedMotion}
        />
      ) : null}
    </AnimatePresence>
  );
}

function PublicNodeCard({
  view,
  checking,
  nextCheckAt,
  reducedMotion,
}: {
  view: PublicNodeWindow;
  checking: boolean;
  nextCheckAt: number | null;
  reducedMotion: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const back = view.phase === 'back';
  const app = view.app;
  const accent = back ? theme.palette.success.main : theme.palette.warning.main;
  const now = useSecondTicker(!back && nextCheckAt !== null);
  const secondsLeft =
    nextCheckAt !== null
      ? Math.max(1, Math.ceil((nextCheckAt - now) / 1_000))
      : null;
  const [qdnHidden, setQdnHidden] = useState(isPublicNodeQdnNoticeHidden);
  // Pulled down by its top; the rest scrolls when a short (landscape)
  // screen leaves less room than the card needs.
  const dragControls = useDragControls();

  const body = back
    ? t('core:public_node_down.back_body')
    : app
      ? t(
          app.kind === 'open'
            ? 'core:public_node_down.body_open'
            : 'core:public_node_down.body_reload',
          { app: app.name }
        )
      : t('core:public_node_down.body_qdn');

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (
      info.offset.y > PULL_TO_CLOSE_PX ||
      info.velocity.y > PULL_TO_CLOSE_SPEED
    ) {
      waitForPublicNode();
    }
  };

  const titleId = 'public-node-down-title';
  const bodyId = 'public-node-down-body';
  return (
    <Box
      sx={{
        bottom: `calc(${MOBILE_TAB_BAR_HEIGHT_PX}px + ${SAFE_AREA_BOTTOM} + 12px)`,
        display: 'flex',
        justifyContent: 'center',
        left: `max(12px, ${SAFE_AREA_LEFT})`,
        pointerEvents: 'none',
        position: 'fixed',
        right: `max(12px, ${SAFE_AREA_RIGHT})`,
        zIndex: CARD_Z,
      }}
    >
      <motion.div
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid="public-node-down-window"
        data-phase={view.phase}
        layout={!reducedMotion}
        drag={back ? false : 'y'}
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        dragSnapToOrigin
        onDragEnd={onDragEnd}
        initial={
          reducedMotion ? { opacity: 0 } : { opacity: 0, y: 48, scale: 0.97 }
        }
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 36 }}
        transition={
          reducedMotion
            ? { duration: 0.15 }
            : { type: 'spring', stiffness: 420, damping: 34 }
        }
        style={{
          background: theme.palette.background.paper,
          border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
          borderRadius: CARD_RADIUS_PX,
          display: 'flex',
          flexDirection: 'column',
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0 24px 60px rgba(0,0,0,0.6), 0 4px 14px rgba(0,0,0,0.4)'
              : '0 24px 60px rgba(15,20,30,0.24), 0 4px 14px rgba(15,20,30,0.12)',
          maxHeight: `calc(100dvh - ${MOBILE_TAB_BAR_HEIGHT_PX}px - ${SAFE_AREA_BOTTOM} - ${SAFE_AREA_TOP} - 24px)`,
          maxWidth: 460,
          overflow: 'hidden',
          pointerEvents: 'auto',
          position: 'relative',
          width: '100%',
        }}
      >
        {/* A soft wash of the state colour behind the header. */}
        <Box
          aria-hidden
          sx={{
            background: `radial-gradient(120% 100% at 0% 0%, ${alpha(accent, 0.16)}, transparent 60%)`,
            height: 150,
            inset: '0 0 auto 0',
            pointerEvents: 'none',
            position: 'absolute',
            transition: 'background 400ms ease',
          }}
        />
        <Box
          onPointerDown={(event) => {
            if (!back) dragControls.start(event);
          }}
          sx={{
            flexShrink: 0,
            position: 'relative',
            pt: '10px',
            px: 2.25,
            touchAction: 'none',
          }}
        >
          <Box
            aria-hidden
            sx={{
              bgcolor: alpha(theme.palette.text.primary, 0.18),
              borderRadius: 2,
              height: 4,
              mb: 1.75,
              mx: 'auto',
              visibility: back ? 'hidden' : 'visible',
              width: 38,
            }}
          />
          <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.75 }}>
            <NodeStateIcon
              back={back}
              accent={accent}
              reducedMotion={reducedMotion}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography
                id={titleId}
                sx={{ fontSize: '1.08rem', fontWeight: 800, lineHeight: 1.25 }}
              >
                {back
                  ? t('core:public_node_down.title_back')
                  : t('core:public_node_down.title')}
              </Typography>
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: '0.74rem',
                  mt: 0.35,
                  opacity: 0.85,
                }}
              >
                {EXT_NODE_QORTAL_LINK}
              </Typography>
            </Box>
          </Box>
        </Box>

        <Box
          sx={{
            minHeight: 0,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            pb: 2,
            position: 'relative',
            px: 2.25,
            touchAction: 'pan-y',
          }}
        >
          <Typography
            id={bodyId}
            sx={{
              color: 'text.secondary',
              fontSize: '0.9rem',
              lineHeight: 1.55,
              mt: 1.75,
            }}
          >
            {body}
          </Typography>

          {app ? (
            <WaitingAppRow
              app={app}
              back={back}
              accent={accent}
              reducedMotion={reducedMotion}
            />
          ) : null}

          {back ? null : (
            <>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: 1,
                  justifyContent: 'space-between',
                  minHeight: 36,
                  mt: 1.25,
                }}
              >
                <Box
                  aria-live="polite"
                  sx={{
                    alignItems: 'center',
                    color: 'text.secondary',
                    display: 'flex',
                    fontSize: '0.8rem',
                    gap: 0.9,
                    minWidth: 0,
                  }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      animation:
                        checking && !reducedMotion
                          ? `${blink} 1s ease-in-out infinite`
                          : 'none',
                      bgcolor: checking ? theme.palette.primary.main : accent,
                      borderRadius: '50%',
                      flexShrink: 0,
                      height: 8,
                      width: 8,
                    }}
                  />
                  <span data-testid="public-node-check-status">
                    {checking
                      ? t('core:public_node_down.checking')
                      : secondsLeft !== null
                        ? t('core:public_node_down.next_check', {
                            seconds: secondsLeft,
                          })
                        : t('core:public_node_down.waiting')}
                  </span>
                </Box>
                <Button
                  size="small"
                  variant="text"
                  disabled={checking}
                  onClick={() => void checkPublicNodeNow()}
                  sx={{
                    borderRadius: '10px',
                    flexShrink: 0,
                    fontWeight: 700,
                    textTransform: 'none',
                  }}
                >
                  {t('core:public_node_down.check_now')}
                </Button>
              </Box>

              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  mt: 1.25,
                }}
              >
                <Button
                  variant="contained"
                  disableElevation
                  startIcon={<DnsRoundedIcon />}
                  onClick={() => {
                    executeEvent('openNodeSettings', null);
                    waitForPublicNode();
                  }}
                  sx={buttonSx}
                >
                  {t('core:public_node_down.use_private_node')}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={app ? <HourglassTopRoundedIcon /> : undefined}
                  onClick={() => waitForPublicNode()}
                  sx={buttonSx}
                >
                  {app
                    ? t('core:public_node_down.wait')
                    : t('core:action.close', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                </Button>
              </Box>

              {view.reason === 'qdn' ? (
                <FormControlLabel
                  sx={{
                    mt: 0.75,
                    mx: 0,
                    '& .MuiFormControlLabel-label': {
                      color: 'text.secondary',
                      fontSize: '0.8rem',
                    },
                  }}
                  control={
                    <Checkbox
                      size="small"
                      checked={qdnHidden}
                      onChange={(event) => {
                        setQdnHidden(event.target.checked);
                        setPublicNodeQdnNoticeHidden(event.target.checked);
                      }}
                    />
                  }
                  label={t('core:public_node_down.dont_show_again')}
                />
              ) : null}
            </>
          )}
        </Box>
      </motion.div>
    </Box>
  );
}

function NodeStateIcon({
  back,
  accent,
  reducedMotion,
}: {
  back: boolean;
  accent: string;
  reducedMotion: boolean;
}) {
  return (
    <Box sx={{ flexShrink: 0, height: 56, position: 'relative', width: 56 }}>
      {!back && !reducedMotion
        ? [0, 1].map((ringIndex) => (
            <Box
              key={ringIndex}
              aria-hidden
              sx={{
                animation: `${ring} 2.4s ease-out ${ringIndex * 1.2}s infinite`,
                border: `2px solid ${alpha(accent, 0.55)}`,
                borderRadius: '18px',
                inset: 0,
                position: 'absolute',
              }}
            />
          ))
        : null}
      <Box
        sx={{
          alignItems: 'center',
          bgcolor: alpha(accent, 0.16),
          borderRadius: '18px',
          color: accent,
          display: 'flex',
          height: 56,
          justifyContent: 'center',
          position: 'relative',
          transition: 'background-color 300ms ease, color 300ms ease',
          width: 56,
        }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={back ? 'back' : 'down'}
            initial={
              reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.4 }
            }
            animate={{ opacity: 1, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
            transition={
              reducedMotion
                ? { duration: 0.15 }
                : { type: 'spring', stiffness: 520, damping: 22 }
            }
            style={{ display: 'flex' }}
          >
            {back ? (
              <CloudDoneRoundedIcon sx={{ fontSize: 30 }} />
            ) : (
              <CloudOffRoundedIcon sx={{ fontSize: 30 }} />
            )}
          </motion.span>
        </AnimatePresence>
      </Box>
    </Box>
  );
}

function WaitingAppRow({
  app,
  back,
  accent,
  reducedMotion,
}: {
  app: NonNullable<PublicNodeWindow['app']>;
  back: boolean;
  accent: string;
  reducedMotion: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const caption = back
    ? t(
        app.kind === 'open'
          ? 'core:public_node_down.opening'
          : 'core:public_node_down.reloading'
      )
    : t(
        app.kind === 'open'
          ? 'core:public_node_down.opens_when_back'
          : 'core:public_node_down.reloads_when_back'
      );
  return (
    <Box
      data-testid="public-node-waiting-app"
      sx={{
        alignItems: 'center',
        bgcolor: alpha(theme.palette.text.primary, 0.04),
        border: `1px solid ${alpha(theme.palette.text.primary, 0.07)}`,
        borderRadius: '18px',
        display: 'flex',
        gap: 1.4,
        mt: 1.75,
        p: 1.1,
      }}
    >
      <QappIcon
        name={app.name}
        logoWidth={20}
        sx={{
          bgcolor: alpha(theme.palette.primary.main, 0.12),
          borderRadius: '13px',
          flexShrink: 0,
          height: 44,
          width: 44,
        }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          noWrap
          sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.3 }}
        >
          {app.name}
        </Typography>
        <Typography
          noWrap
          sx={{
            color: back ? accent : 'text.secondary',
            fontSize: '0.78rem',
            fontWeight: back ? 700 : 400,
            transition: 'color 300ms ease',
          }}
        >
          {caption}
        </Typography>
      </Box>
      {back ? null : (
        <Box
          aria-hidden
          sx={{
            animation: reducedMotion
              ? 'none'
              : `${blink} 1.6s ease-in-out infinite`,
            bgcolor: accent,
            borderRadius: '50%',
            flexShrink: 0,
            height: 10,
            mr: 0.75,
            width: 10,
          }}
        />
      )}
    </Box>
  );
}
