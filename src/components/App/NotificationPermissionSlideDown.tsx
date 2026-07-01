import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import {
  Box,
  Button,
  Paper,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { SAFE_AREA_TOP } from '../../utils/mobileSafeArea';
import { MOBILE_TOP_BAR_HEIGHT_PX } from '../Mobile/MobileTopBar';

const TIMEOUT_MS = 60_000;
const TIMEOUT_S = TIMEOUT_MS / 1000;

type PendingRequest = {
  requestId: string;
  appInfo: { name?: string };
  payload?: { text1?: string };
  expiresAt: number;
};

function sendResponse(requestId: string, accepted: boolean) {
  window.postMessage(
    {
      action: 'NOTIFICATION_PERMISSION_RESPONSE',
      requestId,
      result: { accepted },
    },
    window.location.origin
  );
}

export function NotificationPermissionSlideDown() {
  const { t } = useTranslation('question');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [queue, setQueue] = useState<PendingRequest[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(TIMEOUT_S);
  const autoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const listener = (
      event: CustomEvent<Omit<PendingRequest, 'expiresAt'>>
    ) => {
      const { requestId, appInfo, payload } = event.detail || {};
      if (!requestId || !appInfo) return;
      setQueue((prev) => [
        ...prev,
        {
          requestId,
          appInfo,
          payload,
          expiresAt: Date.now() + TIMEOUT_MS,
        },
      ]);
    };
    subscribeToEvent('show-notification-permission', listener as any);
    return () =>
      unsubscribeFromEvent('show-notification-permission', listener as any);
  }, []);

  useEffect(() => {
    if (autoTimeoutRef.current) clearTimeout(autoTimeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);

    const current = queue[0];
    if (!current) return;

    const remaining = Math.max(0, current.expiresAt - Date.now());
    setSecondsLeft(Math.ceil(remaining / 1000));
    autoTimeoutRef.current = setTimeout(() => {
      sendResponse(current.requestId, false);
      setQueue((prev) => prev.slice(1));
    }, remaining);
    intervalRef.current = setInterval(() => {
      setSecondsLeft(
        Math.max(0, Math.ceil((current.expiresAt - Date.now()) / 1000))
      );
    }, 500);

    return () => {
      if (autoTimeoutRef.current) clearTimeout(autoTimeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [queue]);

  const current = queue[0];
  if (!current) return null;

  const dismissCurrent = (accepted: boolean) => {
    sendResponse(current.requestId, accepted);
    setQueue((prev) => prev.slice(1));
  };

  const progress = secondsLeft / TIMEOUT_S;

  return (
    <Paper
      elevation={0}
      sx={{
        bgcolor: '#111820',
        border: `1px solid ${alpha('#A9BCD8', 0.18)}`,
        borderBottomLeftRadius: 16,
        borderBottomRightRadius: 16,
        borderRadius: 0,
        boxShadow: `0 18px 44px ${alpha('#000', 0.42)}`,
        left: '50%',
        maxWidth: 400,
        overflow: 'hidden',
        position: 'fixed',
        // On the mobile shell the app's top bar sits above the status-bar
        // inset, so clear both — otherwise the banner hides behind the top bar.
        top: isMobile
          ? `calc(${MOBILE_TOP_BAR_HEIGHT_PX}px + ${SAFE_AREA_TOP} + 8px)`
          : SAFE_AREA_TOP,
        transform: 'translateX(-50%)',
        width: 'min(calc(100vw - 24px), 400px)',
        zIndex: theme.zIndex.modal + 10,
      }}
    >
      <Box
        sx={{
          bgcolor: theme.palette.primary.main,
          bottom: 0,
          height: 2,
          left: 0,
          opacity: 0.72,
          position: 'absolute',
          transition: 'width 0.5s linear',
          width: `${Math.max(0, Math.min(1, progress)) * 100}%`,
        }}
      />
      <Box sx={{ display: 'flex', gap: 1.25, p: 1.25 }}>
        <Box
          sx={{
            alignItems: 'center',
            bgcolor: alpha(theme.palette.primary.main, 0.16),
            borderRadius: '10px',
            color: theme.palette.primary.light,
            display: 'flex',
            flexShrink: 0,
            height: 30,
            justifyContent: 'center',
            width: 30,
          }}
        >
          <NotificationsActiveIcon sx={{ fontSize: 17 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box
            sx={{
              alignItems: 'baseline',
              display: 'flex',
              gap: 1,
              justifyContent: 'space-between',
            }}
          >
            <Typography
              sx={{
                fontSize: '0.82rem',
                fontWeight: 650,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {t('permission.notification_title', {
                appName: current.appInfo?.name || 'App',
                defaultValue: '{{appName}} notifications',
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.62),
                flexShrink: 0,
                fontSize: '0.68rem',
                fontWeight: 600,
              }}
            >
              {secondsLeft}s
            </Typography>
          </Box>
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.9),
              fontSize: '0.74rem',
              lineHeight: 1.35,
              mt: 0.25,
            }}
          >
            {current.payload?.text1 ||
              t('permission.notification', {
                defaultValue: 'Allow this app to send you GO notifications?',
                postProcess: 'capitalizeFirstChar',
              })}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              gap: 0.5,
              justifyContent: 'flex-end',
              mt: 0.75,
            }}
          >
            <Button
              size="small"
              onClick={() => dismissCurrent(false)}
              sx={{
                color: 'text.secondary',
                fontWeight: 600,
                fontSize: '0.72rem',
                minWidth: 0,
                px: 1,
              }}
            >
              {t('permission.notification_dont_allow', {
                defaultValue: "Don't allow",
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
            <Button
              size="small"
              onClick={() => dismissCurrent(true)}
              sx={{ fontWeight: 600, fontSize: '0.72rem', minWidth: 0, px: 1.5 }}
              variant="contained"
            >
              {t('permission.notification_allow', {
                defaultValue: 'Allow',
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}
