import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import {
  Box,
  ButtonBase,
  IconButton,
  Typography,
  keyframes,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import MicOffRoundedIcon from '@mui/icons-material/MicOffRounded';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  MOBILE_TAB_BAR_HEIGHT_PX,
  MOBILE_TOP_BAR_HEIGHT_PX,
} from '../mobileBarHeights';
import {
  SAFE_AREA_BOTTOM,
  SAFE_AREA_LEFT,
  SAFE_AREA_RIGHT,
  SAFE_AREA_TOP,
} from '../../../utils/mobileSafeArea';
import {
  callStatusText,
  callTone,
  controlsLive,
  type MobileCallView,
} from './callUiModel';
import { CallAvatar } from './CallAvatar';
import {
  CALL_FLOATING_STRIP_Z,
  registerCallStripSlot,
  setCallStripSlotVisible,
  useCallStripState,
} from './goCallUi';

/** Room left for a chat / panel header under the top bar. */
const FLOATING_HEADER_CLEARANCE_PX = 66;

const dotPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
`;

export type MobileCallStripProps = {
  view: MobileCallView;
  /** 'bar': in the top bar's flow. 'floating': a draggable pill. */
  variant: 'bar' | 'floating';
  onOpen: () => void;
  onToggleMute: () => void;
  onHangUp: () => void;
  avatarSrcFor?: (address: string) => string | undefined;
  /** Floating only: its layer (default: over the top bar, under dialogs). */
  zIndex?: number;
};

/**
 * The minimized call: who, how long, mute and hang up. Tap it to go back to
 * the call screen. Green while the call is live, amber while it connects or
 * reconnects.
 */
export function MobileCallStrip({
  view,
  variant,
  onOpen,
  onToggleMute,
  onHangUp,
  avatarSrcFor,
  zIndex = CALL_FLOATING_STRIP_Z,
}: MobileCallStripProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const reduce = useReducedMotion();
  const tone = callTone(view.phase);
  const live = controlsLive(view.phase);
  const status = callStatusText(t, view);
  const floating = variant === 'floating';
  const draggedRef = useRef(false);

  const background =
    tone === 'good'
      ? theme.palette.success.main
      : tone === 'warning'
        ? theme.palette.warning.main
        : tone === 'ended'
          ? alpha(theme.palette.text.primary, 0.14)
          : theme.palette.mode === 'dark'
            ? alpha(theme.palette.success.main, 0.3)
            : alpha(theme.palette.success.main, 0.2);
  const color =
    tone === 'good'
      ? theme.palette.success.contrastText
      : tone === 'warning'
        ? theme.palette.warning.contrastText
        : theme.palette.text.primary;

  const leading =
    view.kind === 'group' ? (
      <Box
        sx={{
          alignItems: 'center',
          backgroundColor: alpha(color, 0.18),
          borderRadius: '50%',
          display: 'flex',
          flexShrink: 0,
          height: 28,
          justifyContent: 'center',
          width: 28,
        }}
      >
        <GroupsRoundedIcon sx={{ fontSize: 18 }} />
      </Box>
    ) : (
      <CallAvatar
        address={view.address ?? ''}
        label={view.title}
        avatarName={view.avatarName}
        srcOverride={avatarSrcFor?.(view.address ?? '')}
        size={28}
      />
    );

  const pendingDot =
    tone === 'pending' || tone === 'warning' ? (
      <Box
        aria-hidden
        data-hub-keep-animating=""
        sx={{
          animation: reduce ? 'none' : `${dotPulse} 1.4s ease-in-out infinite`,
          backgroundColor: color,
          borderRadius: '50%',
          flexShrink: 0,
          height: 7,
          width: 7,
        }}
      />
    ) : null;

  const content = (
    <Box
      role="group"
      aria-label={t('core:go_call.ongoing_call')}
      data-testid={floating ? 'call-strip-floating' : 'call-strip-bar'}
      data-call-phase={view.phase}
      sx={{
        alignItems: 'center',
        backgroundColor: background,
        borderRadius: floating ? 999 : '14px',
        boxShadow: floating
          ? `0 10px 26px ${alpha(theme.palette.common.black, 0.32)}`
          : 'none',
        color,
        display: 'flex',
        gap: 0.5,
        height: floating ? 52 : 44,
        pl: floating ? 0.75 : 0.5,
        pr: 0.5,
        transition: 'background-color 240ms ease',
      }}
    >
      <ButtonBase
        aria-label={t('core:go_call.return_to_call')}
        data-testid="call-strip-open"
        onClick={onOpen}
        sx={{
          alignItems: 'center',
          alignSelf: 'stretch',
          borderRadius: floating ? 999 : '12px',
          display: 'flex',
          flex: floating ? '0 1 auto' : 1,
          gap: 1,
          justifyContent: 'flex-start',
          minWidth: 0,
          pl: 0.5,
          pr: 1,
        }}
      >
        {leading}
        {pendingDot}
        {floating ? null : (
          <Typography
            sx={{
              flexShrink: 1,
              fontSize: 13.5,
              fontWeight: 700,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {view.title}
          </Typography>
        )}
        <Typography
          data-testid="call-strip-status"
          sx={{
            flexShrink: 0,
            fontSize: 13,
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 600,
            opacity: 0.92,
            whiteSpace: 'nowrap',
          }}
        >
          {status}
        </Typography>
      </ButtonBase>
      <IconButton
        aria-label={
          view.muted ? t('core:go_call.unmute') : t('core:go_call.mute')
        }
        aria-pressed={view.muted}
        data-testid="call-strip-mute"
        disabled={!live}
        onClick={onToggleMute}
        sx={{
          color: 'inherit',
          flexShrink: 0,
          height: 44,
          width: 44,
          '&.Mui-disabled': { color: alpha(color, 0.45) },
        }}
      >
        {view.muted ? (
          <MicOffRoundedIcon sx={{ fontSize: 22 }} />
        ) : (
          <MicRoundedIcon sx={{ fontSize: 22 }} />
        )}
      </IconButton>
      <IconButton
        aria-label={
          view.kind === 'group'
            ? t('core:go_call.leave')
            : t('core:go_call.hang_up')
        }
        data-testid="call-strip-hangup"
        disabled={view.phase === 'ended'}
        onClick={onHangUp}
        sx={{ flexShrink: 0, height: 44, p: 0.5, width: 44 }}
      >
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: theme.palette.error.main,
            borderRadius: '50%',
            color: theme.palette.error.contrastText,
            display: 'flex',
            height: 34,
            justifyContent: 'center',
            width: 34,
          }}
        >
          <CallEndRoundedIcon sx={{ fontSize: 19 }} />
        </Box>
      </IconButton>
    </Box>
  );

  if (!floating) {
    return (
      <motion.div
        initial={reduce ? false : { height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={reduce ? undefined : { height: 0, opacity: 0 }}
        transition={{ duration: 0.2 }}
        style={{ overflow: 'hidden' }}
      >
        {/* Clear of a landscape camera cutout, as the top bar above is. */}
        <Box
          sx={{
            pb: 0.75,
            pl: `max(8px, ${SAFE_AREA_LEFT})`,
            pr: `max(8px, ${SAFE_AREA_RIGHT})`,
            pt: 0.25,
          }}
        >
          {content}
        </Box>
      </motion.div>
    );
  }

  return (
    <FloatingStripFrame draggedRef={draggedRef} zIndex={zIndex}>
      {content}
    </FloatingStripFrame>
  );
}

/**
 * The pill when there is no room for it in the top bar: starts at the right,
 * just under the top bar, and can be dragged anywhere between the bars.
 */
function FloatingStripFrame({
  children,
  draggedRef,
  zIndex,
}: {
  children: ReactNode;
  draggedRef: MutableRefObject<boolean>;
  zIndex: number;
}) {
  const reduce = useReducedMotion();
  const areaRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <Box
        ref={areaRef}
        aria-hidden
        sx={{
          bottom: `calc(${SAFE_AREA_BOTTOM} + ${MOBILE_TAB_BAR_HEIGHT_PX + 8}px)`,
          left: `calc(${SAFE_AREA_LEFT} + 8px)`,
          pointerEvents: 'none',
          position: 'fixed',
          right: `calc(${SAFE_AREA_RIGHT} + 8px)`,
          top: `calc(${SAFE_AREA_TOP} + ${MOBILE_TOP_BAR_HEIGHT_PX + 8}px)`,
        }}
      />
      <motion.div
        drag
        dragConstraints={areaRef}
        dragElastic={0.12}
        dragMomentum={!reduce}
        onPointerDownCapture={() => {
          draggedRef.current = false;
        }}
        onDrag={(_e, info) => {
          if (Math.hypot(info.offset.x, info.offset.y) > 6) {
            draggedRef.current = true;
          }
        }}
        // Letting go after a drag is not a tap on whatever is under the finger.
        onClickCapture={(event) => {
          if (!draggedRef.current) return;
          draggedRef.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        initial={reduce ? false : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={reduce ? undefined : { opacity: 0, scale: 0.9 }}
        style={{
          position: 'fixed',
          right: `calc(${SAFE_AREA_RIGHT} + 8px)`,
          // Below the top bar and a chat header, so it starts clear of the
          // header's own buttons (call, friend, back).
          top: `calc(${SAFE_AREA_TOP} + ${MOBILE_TOP_BAR_HEIGHT_PX + FLOATING_HEADER_CLEARANCE_PX}px)`,
          touchAction: 'none',
          zIndex,
        }}
      >
        {children}
      </motion.div>
    </>
  );
}

/**
 * Mount inside the top bar's wrapper in App.tsx (right after <MobileTopBar>)
 * to draw the minimized call in the bar's flow, where it pushes content down
 * instead of covering chat headers. Without it the call floats as a pill.
 */
export function MobileCallStripSlot() {
  const { view, actions, show } = useCallStripState();
  const ref = useRef<HTMLDivElement>(null);
  const [mountedEl, setMountedEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => registerCallStripSlot(), []);

  useEffect(() => {
    setMountedEl(ref.current);
  }, []);

  // Immersive mode slides the bar (and this slot) off screen: the root then
  // floats the pill instead, so the call never loses its controls.
  useEffect(() => {
    const el = mountedEl;
    if (!el || typeof IntersectionObserver !== 'function') {
      setCallStripSlotVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        setCallStripSlotVisible(Boolean(entry?.isIntersecting));
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      setCallStripSlotVisible(true);
    };
  }, [mountedEl]);

  return (
    <Box ref={ref} data-testid="call-strip-slot">
      {show && view && actions ? (
        <MobileCallStrip
          view={view}
          variant="bar"
          onOpen={actions.open}
          onToggleMute={actions.toggleMute}
          onHangUp={actions.hangUp}
        />
      ) : null}
    </Box>
  );
}
