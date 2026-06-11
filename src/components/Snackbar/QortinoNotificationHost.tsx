import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { Box, Button, IconButton, Typography, useMediaQuery, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { MOBILE_TOP_BAR_HEIGHT_PX } from '../Mobile/MobileTopBar';
import { DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS } from '../Group/qortinoLookDebug';
import {
  DEFAULT_QORTINO_INLET_DEBUG_SETTINGS,
  type QortinoInletDebugSettings,
} from './qortinoInletDebug';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { openCustomNodeGuideWebsite } from '../../utils/openCustomNodeGuideWebsite';
import {
  SAFE_AREA_LEFT,
  SAFE_AREA_RIGHT,
  SAFE_AREA_TOP,
} from '../../utils/mobileSafeArea';

type NotificationType = 'error' | 'info' | 'success' | 'warning';

type NotificationInfo = {
  compact?: boolean;
  dismissible?: boolean;
  duration?: number | null;
  message?: string;
  sourceId?: string;
  type?: string;
  actionLabel?: string;
  actionEvent?: string;
} | null;

type QortinoNotificationHostProps = {
  info: NotificationInfo;
  open: boolean;
  setInfo: (nextInfo: NotificationInfo) => void;
  setOpen: (nextOpen: boolean) => void;
};

type NotificationPayload = {
  compact?: boolean;
  dismissible?: boolean;
  duration?: number | null;
  message?: string;
  sourceId?: string;
  type?: string;
  actionLabel?: string;
  actionEvent?: string;
};

const runNotificationAction = (actionEvent?: string) => {
  if (actionEvent === 'openCustomNodeGuideWebsite') {
    openCustomNodeGuideWebsite();
  }
};

const DEFAULT_NOTIFICATION_DURATION_MS = 5200;
const ERROR_NOTIFICATION_DURATION_MS = 7200;

const resolveNotificationDurationMs = (
  duration: number | null | undefined,
  type?: string
): number | null => {
  if (duration === null) return null;
  if (typeof duration === 'number') return duration;
  return normalizeNotificationType(type) === 'error'
    ? ERROR_NOTIFICATION_DURATION_MS
    : DEFAULT_NOTIFICATION_DURATION_MS;
};

const useNotificationDismissCountdown = (
  open: boolean,
  durationMs: number | null
) => {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!open || durationMs === null) {
      setRemainingSeconds(null);
      return;
    }

    const endAt = Date.now() + durationMs;
    const tick = () => {
      const leftMs = endAt - Date.now();
      setRemainingSeconds(
        leftMs <= 0 ? 0 : Math.max(1, Math.ceil(leftMs / 1000))
      );
    };

    tick();
    const intervalId = window.setInterval(tick, 200);
    return () => window.clearInterval(intervalId);
  }, [durationMs, open]);

  return remainingSeconds;
};

const DISMISS_BUTTON_SIZE_PX = 34;
const DISMISS_BUTTON_RIGHT_PX = 4;
const COUNTDOWN_HEIGHT_PX = 22;
const COUNTDOWN_MIN_WIDTH_PX = 32;
const CONTROLS_GAP_PX = 6;
const STACKED_GAP_PX = 4;

type DismissLayoutMode = 'inline' | 'stacked';

const useNotificationDismissLayout = ({
  bannerRef,
  hasAction,
  isDismissible,
  message,
  messageRef,
  remainingSeconds,
}: {
  bannerRef: RefObject<HTMLElement | null>;
  hasAction: boolean;
  isDismissible: boolean;
  message: string;
  messageRef: RefObject<HTMLElement | null>;
  remainingSeconds: number | null;
}) => {
  const [layoutMode, setLayoutMode] = useState<DismissLayoutMode>('inline');

  useLayoutEffect(() => {
    const banner = bannerRef.current;
    if (!banner || !remainingSeconds || !isDismissible) {
      setLayoutMode('inline');
      return;
    }

    const measure = () => {
      const bannerHeight = banner.clientHeight;
      const dismissTop = hasAction
        ? 8
        : Math.max(0, bannerHeight / 2 - DISMISS_BUTTON_SIZE_PX / 2);
      const stackedBottom =
        dismissTop +
        DISMISS_BUTTON_SIZE_PX +
        STACKED_GAP_PX +
        COUNTDOWN_HEIGHT_PX;
      const stackedFits = stackedBottom <= bannerHeight - 5;

      const messageEl = messageRef.current;
      let inlineClear = true;
      if (messageEl) {
        const bannerRect = banner.getBoundingClientRect();
        const messageRect = messageEl.getBoundingClientRect();
        const inlineControlsWidth =
          DISMISS_BUTTON_SIZE_PX + CONTROLS_GAP_PX + COUNTDOWN_MIN_WIDTH_PX + 8;
        const inlineControlsLeft =
          bannerRect.right - DISMISS_BUTTON_RIGHT_PX - inlineControlsWidth;
        const firstLineOverlap =
          messageRect.height <= DISMISS_BUTTON_SIZE_PX + 8 &&
          messageRect.right > inlineControlsLeft;
        inlineClear = !firstLineOverlap;
      }

      if (inlineClear || !stackedFits) {
        setLayoutMode('inline');
        return;
      }

      setLayoutMode('stacked');
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(banner);
    return () => observer.disconnect();
  }, [bannerRef, hasAction, isDismissible, message, messageRef, remainingSeconds]);

  const paddingRight = useMemo(() => {
    if (!isDismissible && remainingSeconds) return 42;
    if (!isDismissible) return 11;
    if (!remainingSeconds) return DISMISS_BUTTON_RIGHT_PX + DISMISS_BUTTON_SIZE_PX + 8;
    if (layoutMode === 'inline') {
      return (
        DISMISS_BUTTON_RIGHT_PX +
        DISMISS_BUTTON_SIZE_PX +
        CONTROLS_GAP_PX +
        COUNTDOWN_MIN_WIDTH_PX +
        8
      );
    }
    return DISMISS_BUTTON_RIGHT_PX + DISMISS_BUTTON_SIZE_PX + 8;
  }, [isDismissible, layoutMode, remainingSeconds]);

  const paddingBottomExtra = useMemo(() => {
    if (!remainingSeconds || !isDismissible || layoutMode !== 'stacked') return 0;
    return COUNTDOWN_HEIGHT_PX + STACKED_GAP_PX + 8;
  }, [isDismissible, layoutMode, remainingSeconds]);

  return { layoutMode, paddingBottomExtra, paddingRight };
};

const NotificationCountdownPill = ({
  accent,
  isDarkMode,
  remainingSeconds,
}: {
  accent: string;
  isDarkMode: boolean;
  remainingSeconds: number;
}) => (
  <Box
    aria-hidden
    component="span"
    sx={{
      alignItems: 'center',
      backgroundColor: isDarkMode ? alpha(accent, 0.16) : alpha(accent, 0.1),
      border: `1px solid ${alpha(accent, isDarkMode ? 0.34 : 0.4)}`,
      borderRadius: '999px',
      boxShadow: isDarkMode
        ? `inset 0 1px 0 ${alpha('#FFFFFF', 0.06)}`
        : `inset 0 1px 0 ${alpha('#FFFFFF', 0.65)}`,
      color: isDarkMode ? alpha('#EAF1FF', 0.9) : alpha(accent, 0.95),
      display: 'inline-flex',
      flexShrink: 0,
      fontFamily: 'Inter, system-ui, sans-serif',
      fontFeatureSettings: '"tnum"',
      fontSize: '0.6875rem',
      fontWeight: 700,
      height: COUNTDOWN_HEIGHT_PX,
      justifyContent: 'center',
      letterSpacing: '0.03em',
      lineHeight: 1,
      minWidth: COUNTDOWN_MIN_WIDTH_PX,
      paddingX: '7px',
      pointerEvents: 'none',
    }}
  >
    {remainingSeconds}s
  </Box>
);

const NotificationDismissControls = ({
  accent,
  closeNotification,
  hasAction,
  isDarkMode,
  isDismissible,
  layoutMode,
  remainingSeconds,
  theme,
}: {
  accent: string;
  closeNotification: () => void;
  hasAction?: boolean;
  isDarkMode: boolean;
  isDismissible: boolean;
  layoutMode: DismissLayoutMode;
  remainingSeconds: number | null;
  theme: ReturnType<typeof useTheme>;
}) => {
  const hasCountdown = remainingSeconds !== null && remainingSeconds > 0;
  if (!isDismissible && !hasCountdown) return null;

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: layoutMode === 'stacked' ? 'column' : 'row-reverse',
        gap:
          layoutMode === 'stacked'
            ? `${STACKED_GAP_PX}px`
            : `${CONTROLS_GAP_PX}px`,
        pointerEvents: 'auto',
        position: 'absolute',
        right: DISMISS_BUTTON_RIGHT_PX,
        top: hasAction ? 8 : '50%',
        transform: hasAction ? 'none' : 'translateY(-50%)',
        zIndex: 6,
      }}
    >
      {isDismissible ? (
        <IconButton
          aria-label="Dismiss notification"
          onClick={closeNotification}
          size="small"
          sx={{
            backgroundColor: isDarkMode
              ? alpha('#FFFFFF', 0.06)
              : alpha('#000000', 0.04),
            color: isDarkMode
              ? alpha('#F1F5FF', 0.92)
              : alpha(theme.palette.text.secondary, 0.95),
            height: DISMISS_BUTTON_SIZE_PX,
            minWidth: DISMISS_BUTTON_SIZE_PX,
            '&:hover': {
              backgroundColor: isDarkMode
                ? alpha('#FFFFFF', 0.12)
                : alpha(theme.palette.primary.main, 0.1),
              color: isDarkMode
                ? alpha('#FFFFFF', 0.98)
                : theme.palette.text.primary,
            },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      ) : null}
      {hasCountdown ? (
        <NotificationCountdownPill
          accent={accent}
          isDarkMode={isDarkMode}
          remainingSeconds={remainingSeconds}
        />
      ) : null}
    </Box>
  );
};

const QORTINO_INLET_LOOK = DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS;
const QORTINO_INLET_BAR_START_PX = 12;

type QortinoInletHeadGeometry = {
  faceHeight: number;
  faceLeft: number;
  faceTop: number;
  faceWidth: number;
  headHeight: number;
  headOffsetX: number;
  headOffsetY: number;
  headWidth: number;
  shellBorderRadius: string;
  stageHeight: number;
  stageWidth: number;
};

const getQortinoInletShellBorderRadius = (roundness: number) => {
  const clampPercent = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.round(value)));

  const topX = clampPercent(46 * roundness, 34, 56);
  const topY = clampPercent(48 * roundness, 36, 58);
  const bottomX = clampPercent(42 * roundness, 30, 52);
  const bottomY = clampPercent(40 * roundness, 28, 50);

  return `${topX}% ${topX}% ${bottomX}% ${bottomX}% / ${topY}% ${topY}% ${bottomY}% ${bottomY}%`;
};

const getQortinoInletHeadGeometry = (
  debugSettings: QortinoInletDebugSettings
): QortinoInletHeadGeometry => {
  const headScale = 0.92 + (QORTINO_INLET_LOOK.bodyScale - 0.95) * 0.08;
  const headWidth = Math.round(64 * headScale * debugSettings.headWidthScale);
  const headHeight = Math.round(61 * headScale * debugSettings.headHeightScale);
  const faceWidth = Math.round(45 * headScale * debugSettings.faceWidthScale);
  const faceHeight = Math.round(31 * headScale * debugSettings.faceHeightScale);
  const faceLeft = Math.round((headWidth - faceWidth) / 2);
  const faceTop = Math.round((headHeight - faceHeight) / 2 + 2);

  return {
    faceHeight,
    faceLeft,
    faceTop,
    faceWidth,
    headHeight,
    headOffsetX: debugSettings.offsetX,
    headOffsetY: debugSettings.offsetY,
    headWidth,
    shellBorderRadius: getQortinoInletShellBorderRadius(
      debugSettings.shellRoundness
    ),
    stageHeight: headHeight + 5,
    stageWidth: headWidth + 8,
  };
};

const normalizeNotificationType = (value?: string): NotificationType => {
  if (value === 'success' || value === 'warning' || value === 'error') {
    return value;
  }

  return 'info';
};

const normalizeNotificationMessage = (value?: string) => {
  const trimmed = value?.trim();

  if (!trimmed) return '';

  if (/^saving file success!?$/i.test(trimmed)) return 'File saved';
  if (/^successfully sent notification\.?$/i.test(trimmed)) {
    return 'Notification sent';
  }
  if (/^successfully requested to join group\./i.test(trimmed)) {
    return 'Join request sent';
  }
  if (/^failed to join the group$/i.test(trimmed))
    return 'Unable to join group';
  if (/^opened$/i.test(trimmed)) return 'App opened';
  if (/^loading announcements$/i.test(trimmed))
    return 'Loading announcements...';
  if (/^loading chat\.\.\. please wait\.?$/i.test(trimmed)) {
    return 'Loading chat...';
  }
  if (/^setting up group\.\.\. please wait\.?$/i.test(trimmed)) {
    return 'Setting up group...';
  }

  return trimmed;
};

const getNotificationPalette = (type: NotificationType) => {
  switch (type) {
    case 'success':
      return {
        accent: '#8EBFA3',
        tint: 'rgba(98, 145, 118, 0.22)',
      };
    case 'warning':
      return {
        accent: '#D4A574',
        tint: 'rgba(140, 106, 62, 0.22)',
      };
    case 'error':
      return {
        accent: '#E8A8AD',
        tint: 'rgba(132, 74, 78, 0.26)',
      };
    default:
      return {
        accent: '#8EB0E8',
        tint: 'rgba(81, 111, 156, 0.22)',
      };
  }
};

/** Visible frame + outer ring — especially for success/error in dark and light UI */
const getNotificationTextMaxWidthCh = (
  message: string,
  compact?: boolean,
  hasAction?: boolean
) => {
  const ceiling = compact ? 28 : 44;
  const floor = compact ? 14 : 18;
  const dynamic = Math.ceil(message.length * 0.74);
  const actionBoost = hasAction ? 6 : 0;
  return `${Math.min(ceiling, Math.max(floor + actionBoost, dynamic))}ch`;
};

const getNotificationFrameChrome = (
  type: NotificationType,
  isDarkMode: boolean
) => {
  switch (type) {
    case 'success':
      return {
        borderAlpha: isDarkMode ? 0.52 : 0.5,
        glowAlpha: isDarkMode ? 0.2 : 0.22,
        leftBarPx: 5,
        outerRingAlpha: isDarkMode ? 0.38 : 0.42,
        outerRingWidth: 1,
      };
    case 'error':
      return {
        borderAlpha: isDarkMode ? 0.55 : 0.52,
        glowAlpha: isDarkMode ? 0.22 : 0.24,
        leftBarPx: 5,
        outerRingAlpha: isDarkMode ? 0.42 : 0.46,
        outerRingWidth: 1,
      };
    case 'warning':
      return {
        borderAlpha: isDarkMode ? 0.46 : 0.48,
        glowAlpha: isDarkMode ? 0.16 : 0.18,
        leftBarPx: 4,
        outerRingAlpha: isDarkMode ? 0.3 : 0.34,
        outerRingWidth: 1,
      };
    default:
      return {
        borderAlpha: isDarkMode ? 0.22 : 0.42,
        glowAlpha: isDarkMode ? 0.14 : 0.2,
        leftBarPx: 4,
        outerRingAlpha: isDarkMode ? 0.18 : 0.22,
        outerRingWidth: 1,
      };
  }
};

const QortinoNotificationHead = ({
  accent,
  geometry,
  isDarkMode,
}: {
  accent: string;
  geometry: QortinoInletHeadGeometry;
  isDarkMode: boolean;
}) => {
  const eyeSize = 5;
  const eyeOffset = 9;
  const eyeGlow = alpha(accent, isDarkMode ? 0.42 : 0.38);
  const mouthColor = alpha(accent, isDarkMode ? 0.82 : 0.9);

  return (
    <Box
      sx={{
        height: `${geometry.stageHeight}px`,
        left: `${geometry.headOffsetX}px`,
        pointerEvents: 'none',
        position: 'absolute',
        top: `${-4 + geometry.headOffsetY}px`,
        width: `${geometry.stageWidth}px`,
        zIndex: 3,
      }}
    >
      <motion.div
        animate={{ y: [0, -1.5, 0] }}
        transition={{
          duration: 4.9,
          ease: 'easeInOut',
          repeat: Infinity,
          repeatType: 'mirror',
        }}
        style={{ height: '100%', position: 'relative', width: '100%' }}
      >
        <Box
          sx={{
            background: isDarkMode
              ? `radial-gradient(ellipse at center, ${alpha('#02050A', 0.52)} 0%, ${alpha('#02050A', 0)} 72%)`
              : `radial-gradient(ellipse at center, ${alpha('#3A5370', 0.35)} 0%, ${alpha('#3A5370', 0)} 72%)`,
            bottom: 2,
            filter: 'blur(7px)',
            height: '9px',
            left: '11px',
            position: 'absolute',
            width: `${Math.round(geometry.headWidth * 0.6)}px`,
            zIndex: 0,
          }}
        />
        <Box
          sx={{
            background: isDarkMode
              ? `radial-gradient(circle at 28% 18%, ${alpha('#D6E5FF', 0.11)} 0%, ${alpha('#D6E5FF', 0)} 34%), linear-gradient(180deg, ${alpha('#262E3D', 0.98)} 0%, ${alpha('#151A24', 0.99)} 60%, ${alpha('#0E131B', 1)} 100%)`
              : `radial-gradient(circle at 28% 18%, ${alpha('#E8F0FF', 0.65)} 0%, ${alpha('#B9CDE8', 0.2)} 28%, ${alpha('#6B7F9E', 0)} 42%), linear-gradient(180deg, ${alpha('#5F7390', 0.98)} 0%, ${alpha('#4D617A', 0.99)} 55%, ${alpha('#415368', 1)} 100%)`,
            border: isDarkMode
              ? `1px solid ${alpha('#CDDCFF', 0.08)}`
              : `1px solid ${alpha('#8FA9CC', 0.42)}`,
            borderRadius: geometry.shellBorderRadius,
            boxShadow: isDarkMode
              ? `0 16px 24px ${alpha('#000000', 0.34)}, inset 0 1px 0 ${alpha('#FFFFFF', 0.03)}, inset 0 -1px 0 ${alpha('#000000', 0.26)}`
              : `0 12px 22px ${alpha('#1E3248', 0.2)}, inset 0 1px 0 ${alpha('#FFFFFF', 0.22)}, inset 0 -1px 0 ${alpha('#1A2433', 0.12)}`,
            height: `${geometry.headHeight}px`,
            left: '2px',
            position: 'absolute',
            top: '1px',
            width: `${geometry.headWidth}px`,
            zIndex: 2,
            '&::before': {
              background: `linear-gradient(180deg, ${alpha('#F3F7FF', 0.11)} 0%, transparent 100%)`,
              borderRadius: 'inherit',
              content: '""',
              inset: '1px 1px auto 1px',
              height: '43%',
              pointerEvents: 'none',
              position: 'absolute',
            },
            '&::after': {
              background: `linear-gradient(180deg, transparent 0%, ${alpha(
                '#E9F1FF',
                isDarkMode ? 0.025 : 0.06
              )} 100%)`,
              borderRadius: '0 0 16px 16px',
              bottom: '4px',
              content: '""',
              height: '10px',
              left: '13px',
              pointerEvents: 'none',
              position: 'absolute',
              right: '13px',
            },
          }}
        />
        <Box
          sx={{
            backdropFilter: 'blur(10px)',
            background: isDarkMode
              ? `linear-gradient(180deg, ${alpha('#101824', 0.76)} 0%, ${alpha('#090D13', 0.9)} 100%)`
              : `linear-gradient(180deg, ${alpha('#2F3F56', 0.9)} 0%, ${alpha('#1E2B3F', 0.94)} 100%)`,
            border: isDarkMode
              ? `1px solid ${alpha(accent, 0.34)}`
              : `1px solid ${alpha(accent, 0.48)}`,
            borderRadius: '17px',
            boxShadow: isDarkMode
              ? `inset 0 1px 0 ${alpha('#FFFFFF', 0.04)}, inset 0 -8px 14px ${alpha('#000000', 0.18)}`
              : `inset 0 1px 0 ${alpha('#FFFFFF', 0.12)}`,
            height: `${geometry.faceHeight}px`,
            left: `${geometry.faceLeft + 2}px`,
            position: 'absolute',
            top: `${geometry.faceTop + 1}px`,
            width: `${geometry.faceWidth}px`,
            zIndex: 3,
          }}
        />
        <Box
          sx={{
            backgroundColor: '#EAF4FF',
            borderRadius: '999px',
            boxShadow: `0 0 8px ${eyeGlow}`,
            height: `${eyeSize}px`,
            left: `${geometry.faceLeft + 2 + Math.round(geometry.faceWidth / 2) - eyeOffset - Math.round(eyeSize / 2)}px`,
            position: 'absolute',
            top: `${geometry.faceTop + 10}px`,
            width: `${eyeSize}px`,
            zIndex: 4,
          }}
        />
        <Box
          sx={{
            backgroundColor: '#EAF4FF',
            borderRadius: '999px',
            boxShadow: `0 0 8px ${eyeGlow}`,
            height: `${eyeSize}px`,
            left: `${geometry.faceLeft + 2 + Math.round(geometry.faceWidth / 2) + eyeOffset - Math.round(eyeSize / 2)}px`,
            position: 'absolute',
            top: `${geometry.faceTop + 10}px`,
            width: `${eyeSize}px`,
            zIndex: 4,
          }}
        />
        <Box
          sx={{
            borderBottom: `2px solid ${mouthColor}`,
            borderRadius: '0 0 999px 999px',
            height: '6px',
            left: `${geometry.faceLeft + 2 + Math.round(geometry.faceWidth / 2) - 11}px`,
            position: 'absolute',
            top: `${geometry.faceTop + 21}px`,
            width: '22px',
            zIndex: 4,
          }}
        />
      </motion.div>
    </Box>
  );
};

const MobileNotificationBanner = ({
  actionLabel,
  closeNotification,
  dismissCountdownSeconds,
  frameChrome,
  inletGeometry,
  isDarkMode,
  isDismissible,
  maxTextWidthCh,
  message,
  notificationType,
  onAction,
  palette,
  theme,
}: {
  actionLabel?: string;
  closeNotification: () => void;
  dismissCountdownSeconds: number | null;
  frameChrome: ReturnType<typeof getNotificationFrameChrome>;
  inletGeometry: QortinoInletHeadGeometry;
  isDarkMode: boolean;
  isDismissible: boolean;
  maxTextWidthCh: string;
  message: string;
  notificationType: NotificationType;
  onAction?: () => void;
  palette: ReturnType<typeof getNotificationPalette>;
  theme: ReturnType<typeof useTheme>;
}) => {
  const bannerRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLElement>(null);
  const hasAction = Boolean(actionLabel);
  const { layoutMode, paddingBottomExtra, paddingRight } =
    useNotificationDismissLayout({
      bannerRef,
      hasAction,
      isDismissible,
      message,
      messageRef,
      remainingSeconds: dismissCountdownSeconds,
    });

  return (
  <Box
    sx={{
      maxWidth: '100%',
      minHeight: Math.max(56, inletGeometry.stageHeight + 8),
      overflow: 'visible',
      position: 'relative',
      width: 'fit-content',
    }}
  >
    <Box
      sx={{
        background: isDarkMode
          ? `radial-gradient(ellipse at center, ${alpha('#05070C', 0.28)} 0%, ${alpha('#05070C', 0)} 72%)`
          : `radial-gradient(ellipse at center, ${alpha('#3A5370', 0.14)} 0%, ${alpha('#3A5370', 0)} 72%)`,
        bottom: -7,
        filter: 'blur(14px)',
        height: '13px',
        left: '50%',
        position: 'absolute',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 20px)',
        zIndex: 0,
      }}
    />
    <Box
      sx={{
        background: isDarkMode
          ? `linear-gradient(90deg, ${alpha('#F3F8FF', 0.7)} 0%, ${alpha('#D9E7FF', 0.28)} 36%, ${alpha('#FFFFFF', 0.12)} 74%, ${alpha('#FFFFFF', 0)} 100%)`
          : `linear-gradient(90deg, ${alpha('#FFFFFF', 0.92)} 0%, ${alpha('#C5D5EB', 0.42)} 38%, ${alpha('#FFFFFF', 0.2)} 72%, ${alpha('#FFFFFF', 0)} 100%)`,
        borderRadius: '999px',
        height: '1px',
        left: `${QORTINO_INLET_BAR_START_PX + 10}px`,
        pointerEvents: 'none',
        position: 'absolute',
        right: '12px',
        top: '1px',
        zIndex: 2,
      }}
    />
    <Box
      sx={{
        background: isDarkMode
          ? `radial-gradient(ellipse at center, ${alpha('#05070C', 0.34)} 0%, ${alpha('#05070C', 0)} 74%)`
          : `radial-gradient(ellipse at center, ${alpha('#5A7394', 0.2)} 0%, ${alpha('#5A7394', 0)} 74%)`,
        filter: 'blur(6px)',
        height: '12px',
        left: `${QORTINO_INLET_BAR_START_PX + 7 + inletGeometry.headOffsetX}px`,
        position: 'absolute',
        top: `${28 + inletGeometry.headOffsetY}px`,
        width: '36px',
        zIndex: 1,
      }}
    />
    <Box
      sx={{
        background: isDarkMode
          ? `linear-gradient(90deg, ${alpha('#05070C', 0.34)} 0%, ${alpha('#05070C', 0.08)} 72%, transparent 100%)`
          : `linear-gradient(90deg, ${alpha('#8FA9CC', 0.28)} 0%, ${alpha('#8FA9CC', 0.06)} 72%, transparent 100%)`,
        borderRadius: '9px',
        boxShadow: isDarkMode
          ? `inset 12px 0 18px ${alpha('#000000', 0.22)}`
          : `inset 10px 0 14px ${alpha('#2A405C', 0.07)}`,
        height: '25px',
        left: `${QORTINO_INLET_BAR_START_PX + 6 + inletGeometry.headOffsetX}px`,
        pointerEvents: 'none',
        position: 'absolute',
        top: `${13 + inletGeometry.headOffsetY}px`,
        width: `${Math.round(inletGeometry.headWidth * 0.56)}px`,
        zIndex: 2,
      }}
    />
    <Box
      sx={{
        background: isDarkMode
          ? `linear-gradient(180deg, ${alpha('#252D3C', 0.66)} 0%, ${alpha('#171C26', 0.86)} 100%)`
          : `linear-gradient(180deg, ${alpha('#D8E3F2', 0.88)} 0%, ${alpha('#C4D3E8', 0.94)} 100%)`,
        border: isDarkMode
          ? `1px solid ${alpha('#D6E5FF', 0.05)}`
          : `1px solid ${alpha('#9DB2D4', 0.45)}`,
        borderRadius: '10px',
        boxShadow: isDarkMode
          ? `0 8px 16px ${alpha('#000000', 0.18)}`
          : `0 6px 14px ${alpha('#2A405C', 0.12)}`,
        height: '29px',
        left: `${QORTINO_INLET_BAR_START_PX + 6 + inletGeometry.headOffsetX}px`,
        pointerEvents: 'none',
        position: 'absolute',
        top: `${9 + inletGeometry.headOffsetY}px`,
        width: `${Math.round(inletGeometry.headWidth * 0.46)}px`,
        zIndex: 1,
      }}
    />
    <Box
      ref={bannerRef}
      role={notificationType === 'error' ? 'alert' : 'status'}
      aria-live={notificationType === 'error' ? 'assertive' : 'polite'}
      sx={{
        backdropFilter: 'blur(16px)',
        background: isDarkMode
          ? `linear-gradient(180deg, ${alpha('#262E3D', 0.82)} 0%, ${alpha('#171C26', 0.94)} 58%, ${alpha('#121823', 0.96)} 100%)`
          : `linear-gradient(180deg, ${alpha('#FBFCFE', 0.98)} 0%, ${alpha('#EEF3FA', 0.99)} 48%, ${alpha('#E3EBF5', 1)} 100%)`,
        border: `${
          notificationType === 'success' || notificationType === 'error'
            ? '1.5px'
            : '1px'
        } solid ${alpha(palette.accent, frameChrome.borderAlpha)}`,
        borderLeft: `${frameChrome.leftBarPx}px solid ${palette.accent}`,
        borderRadius: '13px',
        boxShadow: isDarkMode
          ? `0 14px 26px ${alpha('#000000', 0.24)}, inset 0 1px 0 ${alpha('#FFFFFF', 0.03)}, 0 0 32px ${alpha(palette.accent, frameChrome.glowAlpha)}, 0 0 0 ${frameChrome.outerRingWidth}px ${alpha(palette.accent, frameChrome.outerRingAlpha)}`
          : `0 14px 28px ${alpha('#2A405C', 0.11)}, inset 0 1px 0 ${alpha('#FFFFFF', 0.92)}, 0 0 28px ${alpha(palette.accent, frameChrome.glowAlpha + 0.04)}, 0 0 0 ${frameChrome.outerRingWidth}px ${alpha(palette.accent, frameChrome.outerRingAlpha)}`,
        display: 'flex',
        flexDirection: 'column',
        gap: actionLabel ? 0.75 : 0,
        marginLeft: `${QORTINO_INLET_BAR_START_PX}px`,
        maxWidth: '100%',
        minHeight: actionLabel ? 'auto' : '43px',
        minWidth: `min(168px, 100%)`,
        overflow: 'hidden',
        paddingBottom: `${(actionLabel ? 9 : 7) + paddingBottomExtra}px`,
        paddingLeft: `${inletGeometry.stageWidth - QORTINO_INLET_BAR_START_PX + 10 + Math.max(0, inletGeometry.headOffsetX)}px`,
        paddingRight: `${paddingRight}px`,
        paddingTop: actionLabel ? '9px' : '7px',
        position: 'relative',
        width: 'fit-content',
        '&::before': {
          background: isDarkMode
            ? `linear-gradient(180deg, ${alpha('#FFFFFF', 0.02)} 0%, transparent 100%)`
            : `linear-gradient(180deg, ${alpha('#FFFFFF', 0.72)} 0%, transparent 55%)`,
          content: '""',
          inset: 0,
          pointerEvents: 'none',
          position: 'absolute',
        },
        '&::after': {
          background: isDarkMode
            ? `radial-gradient(circle at 0% 50%, ${alpha(palette.accent, 0.34)} 0%, ${palette.tint} 38%, transparent 72%)`
            : `radial-gradient(circle at 0% 50%, ${alpha(palette.accent, 0.28)} 0%, ${alpha(palette.accent, 0.12)} 36%, transparent 68%)`,
          content: '""',
          inset: 0,
          pointerEvents: 'none',
          position: 'absolute',
        },
      }}
    >
      <Typography
        ref={messageRef}
        sx={{
          color:
            notificationType === 'error'
              ? isDarkMode
                ? alpha('#FFE8EA', 0.98)
                : alpha('#5C2128', 0.94)
              : notificationType === 'success'
                ? isDarkMode
                  ? alpha('#EAF6EE', 0.98)
                  : alpha('#1E3D2C', 0.92)
                : notificationType === 'warning'
                  ? isDarkMode
                    ? alpha('#FFF2E0', 0.98)
                    : alpha('#4D3514', 0.92)
                  : isDarkMode
                    ? alpha('#E8F0FF', 0.98)
                    : alpha(theme.palette.text.primary, 0.94),
          fontFamily: 'Inter',
          fontSize: '0.875rem',
          fontWeight: 600,
          letterSpacing: '-0.01em',
          lineHeight: 1.4,
          maxWidth: maxTextWidthCh,
          minHeight: '21px',
          position: 'relative',
          // Balance wraps multi-line messages into even lines so the bubble
          // hugs the text instead of leaving a long first line + orphan word.
          textWrap: 'balance',
          zIndex: 0,
        }}
      >
        {message}
      </Typography>
      {actionLabel && onAction ? (
        <Button
          onClick={onAction}
          size="small"
          sx={{
            alignSelf: 'flex-start',
            borderRadius: '10px',
            fontSize: '0.78rem',
            fontWeight: 700,
            minHeight: 36,
            px: 1.5,
            position: 'relative',
            textTransform: 'none',
            zIndex: 1,
          }}
          variant="contained"
        >
          {actionLabel}
        </Button>
      ) : null}
      <NotificationDismissControls
        accent={palette.accent}
        closeNotification={closeNotification}
        hasAction={hasAction}
        isDarkMode={isDarkMode}
        isDismissible={isDismissible}
        layoutMode={layoutMode}
        remainingSeconds={dismissCountdownSeconds}
        theme={theme}
      />
    </Box>
    <QortinoNotificationHead
      accent={palette.accent}
      geometry={inletGeometry}
      isDarkMode={isDarkMode}
    />
  </Box>
  );
};

export const QortinoNotificationHost = ({
  info,
  open,
  setInfo,
  setOpen,
}: QortinoNotificationHostProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const infoRef = useRef<NotificationInfo>(info);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inletDebugSettings: QortinoInletDebugSettings =
    DEFAULT_QORTINO_INLET_DEBUG_SETTINGS;

  useEffect(() => {
    infoRef.current = info;
  }, [info]);

  const closeNotification = useCallback(() => {
    setOpen(false);
    setInfo(null);
  }, [setInfo, setOpen]);

  useEffect(() => {
    if (!open) {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    const duration = info?.duration;
    if (duration === null) return;

    const resolvedDuration = resolveNotificationDurationMs(duration, info?.type);
    if (resolvedDuration === null) return;

    timeoutRef.current = window.setTimeout(() => {
      closeNotification();
    }, resolvedDuration);

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [closeNotification, info?.duration, info?.type, open]);

  useEffect(() => {
    const handleOpen = (
      event: CustomEvent<{
        compact?: boolean;
        data?: NotificationPayload;
        dismissible?: boolean;
        duration?: number | null;
        message?: string;
        sourceId?: string;
        type?: string;
      }>
    ) => {
      const payload = event.detail?.data ?? event.detail ?? {};
      const message = normalizeNotificationMessage(payload.message);

      if (!message) return;

      setInfo({
        compact: payload.compact === true,
        dismissible: payload.dismissible !== false,
        duration: payload.duration === undefined ? undefined : payload.duration,
        message,
        sourceId: payload.sourceId,
        type: normalizeNotificationType(payload.type),
        actionLabel: payload.actionLabel,
        actionEvent: payload.actionEvent,
      });
      setOpen(true);
    };

    const handleClose = (
      event: CustomEvent<{
        data?: { sourceId?: string };
        sourceId?: string;
      }>
    ) => {
      const payload = event.detail?.data ?? event.detail ?? {};
      const sourceId = payload.sourceId;

      if (
        sourceId &&
        (infoRef.current?.sourceId == null ||
          infoRef.current?.sourceId !== sourceId)
      ) {
        return;
      }

      closeNotification();
    };

    subscribeToEvent('openGlobalSnackBar', handleOpen);
    subscribeToEvent('closeGlobalSnackBar', handleClose);

    return () => {
      unsubscribeFromEvent('openGlobalSnackBar', handleOpen);
      unsubscribeFromEvent('closeGlobalSnackBar', handleClose);
    };
  }, [closeNotification, setInfo, setOpen]);

  const message = useMemo(
    () => normalizeNotificationMessage(info?.message),
    [info?.message]
  );
  const notificationType = normalizeNotificationType(info?.type);
  const palette = getNotificationPalette(notificationType);
  const isDismissible = info?.dismissible !== false;
  const actionLabel = info?.actionLabel?.trim();
  const handleNotificationAction = useCallback(() => {
    const actionEvent = info?.actionEvent;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      active.blur();
    }
    closeNotification();
    if (!actionEvent) return;
    window.requestAnimationFrame(() => {
      runNotificationAction(actionEvent);
    });
  }, [closeNotification, info?.actionEvent]);
  const isDarkMode = theme.palette.mode === 'dark';
  const frameChrome = useMemo(
    () => getNotificationFrameChrome(notificationType, isDarkMode),
    [notificationType, isDarkMode]
  );
  const inletGeometry = useMemo(
    () => getQortinoInletHeadGeometry(inletDebugSettings),
    [inletDebugSettings]
  );
  const maxTextWidthCh = useMemo(() => {
    const chWidth = getNotificationTextMaxWidthCh(
      message,
      info?.compact === true,
      Boolean(actionLabel)
    );
    return isMobile ? `min(100%, ${chWidth})` : chWidth;
  }, [actionLabel, info?.compact, isMobile, message]);
  const notificationDurationMs = useMemo(
    () => resolveNotificationDurationMs(info?.duration, info?.type),
    [info?.duration, info?.type]
  );
  const dismissCountdownSeconds = useNotificationDismissCountdown(
    open,
    notificationDurationMs
  );
  const dragAreaRef = useRef<HTMLDivElement>(null);
  const desktopBannerRef = useRef<HTMLDivElement>(null);
  const desktopMessageRef = useRef<HTMLElement>(null);
  const {
    layoutMode: desktopLayoutMode,
    paddingBottomExtra: desktopPaddingBottomExtra,
    paddingRight: desktopPaddingRight,
  } = useNotificationDismissLayout({
    bannerRef: desktopBannerRef,
    hasAction: false,
    isDismissible,
    message,
    messageRef: desktopMessageRef,
    remainingSeconds: dismissCountdownSeconds,
  });

  const notificationTop = isMobile
    ? `calc(${MOBILE_TOP_BAR_HEIGHT_PX}px + ${SAFE_AREA_TOP} + 8px)`
    : `calc(var(--electron-title-bar-height, 0px) + 12px)`;

  if (!open || !message) return null;

  return (
    <Box
      ref={dragAreaRef}
      sx={{
        // Full-screen layer: the banner starts top-center and can be dragged
        // anywhere within it (the layer itself never blocks taps).
        alignItems: 'flex-start',
        display: 'flex',
        inset: 0,
        justifyContent: 'center',
        paddingBottom: '16px',
        paddingLeft: `max(12px, ${SAFE_AREA_LEFT})`,
        paddingRight: `max(12px, ${SAFE_AREA_RIGHT})`,
        paddingTop: notificationTop,
        pointerEvents: 'none',
        position: 'fixed',
        zIndex: 2500,
      }}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={`${notificationType}:${message}`}
          drag
          dragConstraints={dragAreaRef}
          dragElastic={0.06}
          dragMomentum={false}
          whileDrag={{ scale: 1.02 }}
          initial={{ opacity: 0, y: isMobile ? -12 : -14, scale: 0.988 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: isMobile ? -10 : -12, scale: 0.99 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          style={{
            cursor: 'grab',
            maxWidth: '100%',
            pointerEvents: 'auto',
            position: 'relative',
            // Without this, mobile browsers treat a vertical drag as a page
            // scroll gesture and the banner never moves.
            touchAction: 'none',
            width: 'fit-content',
          }}
        >
          {isMobile ? (
            <MobileNotificationBanner
              actionLabel={actionLabel}
              closeNotification={closeNotification}
              dismissCountdownSeconds={dismissCountdownSeconds}
              frameChrome={frameChrome}
              inletGeometry={inletGeometry}
              isDarkMode={isDarkMode}
              isDismissible={isDismissible}
              maxTextWidthCh={maxTextWidthCh}
              message={message}
              notificationType={notificationType}
              onAction={actionLabel ? handleNotificationAction : undefined}
              palette={palette}
              theme={theme}
            />
          ) : (
          <Box
            role={notificationType === 'error' ? 'alert' : 'status'}
            aria-live={notificationType === 'error' ? 'assertive' : 'polite'}
            sx={{
              minHeight: 56,
              position: 'relative',
              width: 'fit-content',
            }}
          >
            <Box
              sx={{
                background: isDarkMode
                  ? `radial-gradient(ellipse at center, ${alpha('#05070C', 0.28)} 0%, ${alpha('#05070C', 0)} 72%)`
                  : `radial-gradient(ellipse at center, ${alpha('#3A5370', 0.14)} 0%, ${alpha('#3A5370', 0)} 72%)`,
                bottom: -7,
                filter: 'blur(14px)',
                height: '13px',
                left: '50%',
                position: 'absolute',
                transform: 'translateX(-50%)',
                width: 'calc(100% - 20px)',
                zIndex: 0,
              }}
            />
            <Box
              sx={{
                background: isDarkMode
                  ? `linear-gradient(90deg, ${alpha('#F3F8FF', 0.7)} 0%, ${alpha('#D9E7FF', 0.28)} 36%, ${alpha('#FFFFFF', 0.12)} 74%, ${alpha('#FFFFFF', 0)} 100%)`
                  : `linear-gradient(90deg, ${alpha('#FFFFFF', 0.92)} 0%, ${alpha('#C5D5EB', 0.42)} 38%, ${alpha('#FFFFFF', 0.2)} 72%, ${alpha('#FFFFFF', 0)} 100%)`,
                borderRadius: '999px',
                height: '1px',
                left: `${QORTINO_INLET_BAR_START_PX + 10}px`,
                pointerEvents: 'none',
                position: 'absolute',
                right: '12px',
                top: '1px',
                zIndex: 2,
              }}
            />
            <Box
              sx={{
                background: isDarkMode
                  ? `radial-gradient(ellipse at center, ${alpha('#05070C', 0.34)} 0%, ${alpha('#05070C', 0)} 74%)`
                  : `radial-gradient(ellipse at center, ${alpha('#5A7394', 0.2)} 0%, ${alpha('#5A7394', 0)} 74%)`,
                filter: 'blur(6px)',
                height: '12px',
                left: `${QORTINO_INLET_BAR_START_PX + 7 + inletGeometry.headOffsetX}px`,
                position: 'absolute',
                top: `${28 + inletGeometry.headOffsetY}px`,
                width: '36px',
                zIndex: 1,
              }}
            />
            <Box
              sx={{
                background: isDarkMode
                  ? `linear-gradient(90deg, ${alpha('#05070C', 0.34)} 0%, ${alpha('#05070C', 0.08)} 72%, transparent 100%)`
                  : `linear-gradient(90deg, ${alpha('#8FA9CC', 0.28)} 0%, ${alpha('#8FA9CC', 0.06)} 72%, transparent 100%)`,
                borderRadius: '9px',
                boxShadow: isDarkMode
                  ? `inset 12px 0 18px ${alpha('#000000', 0.22)}`
                  : `inset 10px 0 14px ${alpha('#2A405C', 0.07)}`,
                height: '25px',
                left: `${QORTINO_INLET_BAR_START_PX + 6 + inletGeometry.headOffsetX}px`,
                pointerEvents: 'none',
                position: 'absolute',
                top: `${13 + inletGeometry.headOffsetY}px`,
                width: `${Math.round(inletGeometry.headWidth * 0.56)}px`,
                zIndex: 2,
              }}
            />
            <Box
              sx={{
                background: isDarkMode
                  ? `linear-gradient(180deg, ${alpha('#252D3C', 0.66)} 0%, ${alpha('#171C26', 0.86)} 100%)`
                  : `linear-gradient(180deg, ${alpha('#D8E3F2', 0.88)} 0%, ${alpha('#C4D3E8', 0.94)} 100%)`,
                border: isDarkMode
                  ? `1px solid ${alpha('#D6E5FF', 0.05)}`
                  : `1px solid ${alpha('#9DB2D4', 0.45)}`,
                borderRadius: '10px',
                boxShadow: isDarkMode
                  ? `0 8px 16px ${alpha('#000000', 0.18)}`
                  : `0 6px 14px ${alpha('#2A405C', 0.12)}`,
                height: '29px',
                left: `${QORTINO_INLET_BAR_START_PX + 6 + inletGeometry.headOffsetX}px`,
                pointerEvents: 'none',
                position: 'absolute',
                top: `${9 + inletGeometry.headOffsetY}px`,
                width: `${Math.round(inletGeometry.headWidth * 0.46)}px`,
                zIndex: 1,
              }}
            />
            <Box
              ref={desktopBannerRef}
              sx={{
                background: isDarkMode
                  ? `linear-gradient(180deg, ${alpha('#262E3D', 0.82)} 0%, ${alpha('#171C26', 0.94)} 58%, ${alpha('#121823', 0.96)} 100%)`
                  : `linear-gradient(180deg, ${alpha('#FBFCFE', 0.98)} 0%, ${alpha('#EEF3FA', 0.99)} 48%, ${alpha('#E3EBF5', 1)} 100%)`,
                backdropFilter: 'blur(16px)',
                border: `${
                  notificationType === 'success' || notificationType === 'error'
                    ? '1.5px'
                    : '1px'
                } solid ${alpha(palette.accent, frameChrome.borderAlpha)}`,
                borderLeft: `${frameChrome.leftBarPx}px solid ${palette.accent}`,
                borderRadius: '13px',
                boxShadow: isDarkMode
                  ? `0 14px 26px ${alpha('#000000', 0.24)}, inset 0 1px 0 ${alpha('#FFFFFF', 0.03)}, 0 0 32px ${alpha(palette.accent, frameChrome.glowAlpha)}, 0 0 0 ${frameChrome.outerRingWidth}px ${alpha(palette.accent, frameChrome.outerRingAlpha)}`
                  : `0 14px 28px ${alpha('#2A405C', 0.11)}, inset 0 1px 0 ${alpha('#FFFFFF', 0.92)}, 0 0 28px ${alpha(palette.accent, frameChrome.glowAlpha + 0.04)}, 0 0 0 ${frameChrome.outerRingWidth}px ${alpha(palette.accent, frameChrome.outerRingAlpha)}`,
                display: 'flex',
                marginLeft: `${QORTINO_INLET_BAR_START_PX}px`,
                maxWidth: 'min(500px, calc(100vw - 20px))',
                minHeight: '43px',
                minWidth: `min(168px, calc(100vw - 20px))`,
                overflow: 'hidden',
                paddingBottom: `${7 + desktopPaddingBottomExtra}px`,
                paddingLeft: `${inletGeometry.stageWidth - QORTINO_INLET_BAR_START_PX + 10 + Math.max(0, inletGeometry.headOffsetX)}px`,
                paddingRight: `${desktopPaddingRight}px`,
                paddingTop: '7px',
                position: 'relative',
                width: 'fit-content',
                '&::before': {
                  background: isDarkMode
                    ? `linear-gradient(180deg, ${alpha('#FFFFFF', 0.02)} 0%, transparent 100%)`
                    : `linear-gradient(180deg, ${alpha('#FFFFFF', 0.72)} 0%, transparent 55%)`,
                  content: '""',
                  inset: 0,
                  pointerEvents: 'none',
                  position: 'absolute',
                },
                '&::after': {
                  background: isDarkMode
                    ? `radial-gradient(circle at 0% 50%, ${alpha(palette.accent, 0.34)} 0%, ${palette.tint} 38%, transparent 72%)`
                    : `radial-gradient(circle at 0% 50%, ${alpha(palette.accent, 0.28)} 0%, ${alpha(palette.accent, 0.12)} 36%, transparent 68%)`,
                  content: '""',
                  inset: 0,
                  pointerEvents: 'none',
                  position: 'absolute',
                },
              }}
            >
              <Typography
                ref={desktopMessageRef}
                sx={{
                  alignItems: 'center',
                  color:
                    notificationType === 'error'
                      ? isDarkMode
                        ? alpha('#FFE8EA', 0.98)
                        : alpha('#5C2128', 0.94)
                      : notificationType === 'success'
                        ? isDarkMode
                          ? alpha('#EAF6EE', 0.98)
                          : alpha('#1E3D2C', 0.92)
                        : notificationType === 'warning'
                          ? isDarkMode
                            ? alpha('#FFF2E0', 0.98)
                            : alpha('#4D3514', 0.92)
                          : isDarkMode
                            ? alpha('#E8F0FF', 0.98)
                            : alpha(theme.palette.text.primary, 0.94),
                  display: 'flex',
                  fontFamily: 'Inter',
                  fontSize: '0.9375rem',
                  fontWeight: 600,
                  letterSpacing: '-0.012em',
                  lineHeight: 1.36,
                  maxWidth: maxTextWidthCh,
                  minHeight: '21px',
                  position: 'relative',
                  textWrap: 'balance',
                  zIndex: 0,
                }}
              >
                {message}
              </Typography>
              <NotificationDismissControls
                accent={palette.accent}
                closeNotification={closeNotification}
                isDarkMode={isDarkMode}
                isDismissible={isDismissible}
                layoutMode={desktopLayoutMode}
                remainingSeconds={dismissCountdownSeconds}
                theme={theme}
              />
            </Box>
            <QortinoNotificationHead
              accent={palette.accent}
              geometry={inletGeometry}
              isDarkMode={isDarkMode}
            />
          </Box>
          )}
        </motion.div>
      </AnimatePresence>
    </Box>
  );
};
