import { useRef, type ReactNode } from 'react';
import { Box, Typography, keyframes, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import CallRoundedIcon from '@mui/icons-material/CallRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import NotificationsOffRoundedIcon from '@mui/icons-material/NotificationsOffRounded';
import PhoneInTalkRoundedIcon from '@mui/icons-material/PhoneInTalkRounded';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  SAFE_AREA_BOTTOM,
  SAFE_AREA_LEFT,
  SAFE_AREA_RIGHT,
  SAFE_AREA_TOP,
} from '../../../utils/mobileSafeArea';
import { shortCallAddress } from './callUiModel';
import { CallAvatar, callAddressHue } from './CallAvatar';
import { CallControlButton } from './CallControlButton';

const acceptBob = keyframes`
  0%, 70%, 100% { transform: translateY(0); }
  80% { transform: translateY(-6px); }
  90% { transform: translateY(0); }
`;

/** Drag a button up this far to answer / decline without tapping. */
const SWIPE_ACTION_PX = 70;

export type IncomingSwitchFrom = 'group' | 'direct' | null;

export type MobileIncomingCallScreenProps = {
  callerName: string;
  callerAddress: string;
  avatarName?: string;
  avatarSrcOverride?: string;
  zIndex: number;
  /** Shown over GO's lock (or the phone's). */
  locked: boolean;
  /** Answering ends this other call first. */
  switchFrom: IncomingSwitchFrom;
  ringerSilenced: boolean;
  /** Accepting (dropping the other call can take a moment). */
  busy?: boolean;
  landscape?: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

/**
 * Full-screen ring for an incoming 1:1 GO call: caller face and name, big
 * Decline (red) and Accept (green) far apart. Tap either, or drag it up.
 * When another call is running, Accept says so and ends that call first.
 */
export function MobileIncomingCallScreen({
  callerName,
  callerAddress,
  avatarName,
  avatarSrcOverride,
  zIndex,
  locked,
  switchFrom,
  ringerSilenced,
  busy = false,
  landscape = false,
  onAccept,
  onDecline,
}: MobileIncomingCallScreenProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const reduce = useReducedMotion();
  const dark = theme.palette.mode === 'dark';
  const hue = callAddressHue(callerAddress || callerName);

  // A drag that moved must not also count as a tap on the button.
  const draggedRef = useRef(false);
  const swipeable = (child: ReactNode, onSwipe: () => void) => (
    <motion.div
      drag={busy ? false : 'y'}
      dragConstraints={{ top: -140, bottom: 0 }}
      dragElastic={{ top: 0.35, bottom: 0 }}
      dragSnapToOrigin
      onPointerDownCapture={() => {
        draggedRef.current = false;
      }}
      onDrag={(_e, info) => {
        if (Math.abs(info.offset.y) > 6) draggedRef.current = true;
      }}
      onDragEnd={(_e, info) => {
        if (info.offset.y < -SWIPE_ACTION_PX) onSwipe();
      }}
      onClickCapture={(event) => {
        if (!draggedRef.current) return;
        draggedRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      style={{ touchAction: 'none' }}
    >
      {child}
    </motion.div>
  );

  const declineButton = swipeable(
    <CallControlButton
      icon={<CallEndRoundedIcon />}
      label={t('core:go_call.decline')}
      variant="danger"
      size={72}
      disabled={busy}
      onClick={onDecline}
      testId="incoming-decline-button"
    />,
    onDecline
  );

  const acceptButton = swipeable(
    <Box
      data-hub-keep-animating=""
      sx={{
        animation:
          reduce || busy ? 'none' : `${acceptBob} 1.8s ease-in-out infinite`,
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    >
      <CallControlButton
        icon={<CallRoundedIcon />}
        label={
          switchFrom
            ? t('core:go_call.end_and_accept')
            : t('core:go_call.accept')
        }
        variant="accept"
        size={72}
        disabled={busy}
        onClick={onAccept}
        testId="incoming-accept-button"
      />
    </Box>,
    onAccept
  );

  const identity = (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        px: 3,
      }}
    >
      <CallAvatar
        address={callerAddress}
        label={callerName}
        avatarName={avatarName}
        srcOverride={avatarSrcOverride}
        size={landscape ? 104 : 128}
        pulsing={!reduce}
      />
      <Typography
        component="h2"
        data-testid="incoming-caller-name"
        sx={{
          fontSize: 28,
          fontWeight: 800,
          lineHeight: 1.2,
          maxWidth: '100%',
          mt: 2.5,
          overflow: 'hidden',
          textAlign: 'center',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {callerName}
      </Typography>
      {callerAddress && callerName !== shortCallAddress(callerAddress) ? (
        <Typography
          sx={{
            color: alpha(theme.palette.text.primary, 0.55),
            fontFamily:
              'ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace',
            fontSize: 12.5,
            mt: 0.5,
          }}
        >
          {shortCallAddress(callerAddress)}
        </Typography>
      ) : null}
      {switchFrom ? (
        <Typography
          data-testid="incoming-switch-hint"
          sx={{
            backgroundColor: alpha(
              theme.palette.warning.main,
              dark ? 0.16 : 0.12
            ),
            borderRadius: 2,
            color: dark
              ? theme.palette.warning.light
              : theme.palette.warning.dark,
            fontSize: 13.5,
            fontWeight: 600,
            mt: 2,
            px: 1.5,
            py: 0.75,
            textAlign: 'center',
          }}
        >
          {switchFrom === 'group'
            ? t('core:go_call.answering_ends_group')
            : t('core:go_call.answering_ends_call')}
        </Typography>
      ) : null}
    </Box>
  );

  const buttons = (
    <Box
      sx={{
        alignItems: 'flex-start',
        display: 'flex',
        // Decline and Accept stay at least 96 px apart.
        gap: landscape ? 12 : 0,
        justifyContent: landscape ? 'center' : 'space-between',
        mx: 'auto',
        maxWidth: 420,
        px: landscape ? 2 : 5,
        width: '100%',
      }}
    >
      {declineButton}
      {acceptButton}
    </Box>
  );

  return (
    <motion.div
      role="alertdialog"
      aria-modal="true"
      aria-label={t('core:go_call.incoming_from', { name: callerName })}
      data-testid="mobile-incoming-call-screen"
      initial={{ opacity: 0, scale: reduce ? 1 : 1.03 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0.12 : 0.24 }}
      style={{
        background: `radial-gradient(130% 70% at 50% 8%, ${alpha(
          hue,
          dark ? 0.42 : 0.24
        )} 0%, ${alpha(hue, 0)} 74%), ${theme.palette.background.default}`,
        color: theme.palette.text.primary,
        display: 'flex',
        flexDirection: 'column',
        inset: 0,
        paddingTop: SAFE_AREA_TOP,
        paddingBottom: SAFE_AREA_BOTTOM,
        paddingLeft: SAFE_AREA_LEFT,
        paddingRight: SAFE_AREA_RIGHT,
        position: 'fixed',
        zIndex,
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          pt: landscape ? 1.5 : 4,
        }}
      >
        <Typography
          sx={{
            alignItems: 'center',
            color: alpha(theme.palette.text.primary, 0.75),
            display: 'flex',
            fontSize: 14,
            fontWeight: 700,
            gap: 0.75,
            letterSpacing: '0.02em',
          }}
        >
          <PhoneInTalkRoundedIcon sx={{ fontSize: 18 }} />
          {t('core:go_call.incoming_title')}
        </Typography>
        {ringerSilenced ? (
          <Typography
            data-testid="incoming-ringer-silenced"
            sx={{
              alignItems: 'center',
              color: alpha(theme.palette.text.primary, 0.6),
              display: 'flex',
              fontSize: 12.5,
              gap: 0.5,
            }}
          >
            <NotificationsOffRoundedIcon sx={{ fontSize: 15 }} />
            {t('core:go_call.ringer_silenced')}
          </Typography>
        ) : null}
        {locked ? (
          <Typography
            sx={{
              alignItems: 'center',
              color: alpha(theme.palette.text.primary, 0.6),
              display: 'flex',
              fontSize: 12.5,
              gap: 0.5,
              px: 3,
              textAlign: 'center',
            }}
          >
            <LockRoundedIcon sx={{ fontSize: 14 }} />
            {t('core:go_call.locked_note')}
          </Typography>
        ) : null}
      </Box>
      {landscape ? (
        <Box
          sx={{
            alignItems: 'center',
            display: 'grid',
            flex: 1,
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          }}
        >
          {identity}
          {buttons}
        </Box>
      ) : (
        <>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flex: 1,
              justifyContent: 'center',
              minHeight: 0,
            }}
          >
            {identity}
          </Box>
          <Box sx={{ pb: 6 }}>{buttons}</Box>
        </>
      )}
    </motion.div>
  );
}
