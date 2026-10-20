import { useState, type ReactNode } from 'react';
import {
  Box,
  ButtonBase,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import ChatBubbleRoundedIcon from '@mui/icons-material/ChatBubbleRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import MicOffRoundedIcon from '@mui/icons-material/MicOffRounded';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import CellTowerRoundedIcon from '@mui/icons-material/CellTowerRounded';
import {
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  SAFE_AREA_BOTTOM,
  SAFE_AREA_LEFT,
  SAFE_AREA_RIGHT,
  SAFE_AREA_TOP,
} from '../../../utils/mobileSafeArea';
import {
  callDetailText,
  callStatusText,
  callTone,
  controlsLive,
  transportText,
  type MobileCallView,
} from './callUiModel';
import type { CallAudioRoute, CallAudioRouteType } from './callBridgeAdapters';
import { CallAvatar, callAddressHue } from './CallAvatar';
import { CallControlButton } from './CallControlButton';
import {
  MobileAudioRouteSheet,
  ROUTE_ICONS,
  routeLabel,
} from './MobileAudioRouteSheet';
import { MobileGroupCallGrid } from './MobileGroupCallGrid';
import { MobileCallParticipantsSheet } from './MobileCallParticipantsSheet';
import { CallSheetBackPriorityContext } from './MobileCallSheet';
import {
  CALL_SHEET_BACK_PRIORITY,
  CALL_SHEET_LOCKED_BACK_PRIORITY,
} from './goCallUi';

/** Swipe this far (or fling) down to minimize. */
const MINIMIZE_DRAG_PX = 120;
const MINIMIZE_FLING = 700;

/**
 * What the audio button does: 'toggle' flips the loudspeaker in place (the
 * phone has exactly its earpiece and speaker); 'sheet' opens the route list
 * (a headset, Bluetooth, or a tablet without an earpiece); 'single' shows
 * the only route there is (a tablet or emulator with no earpiece): drawn as
 * a working button that opens the list with that one route ticked, so it
 * never looks switched off.
 */
export function audioButtonKind(
  routes: CallAudioRoute[]
): 'toggle' | 'sheet' | 'single' {
  if (routes.length < 2) return 'single';
  const types = new Set(routes.map((route) => route.type));
  if (routes.length === 2 && types.has('earpiece') && types.has('speaker')) {
    return 'toggle';
  }
  return 'sheet';
}

export type MobileCallAudioProps = {
  routes: CallAudioRoute[];
  current: CallAudioRouteType;
  onSelect: (type: CallAudioRouteType) => void;
};

export type MobileCallScreenProps = {
  view: MobileCallView;
  /** Drawn over GO's lock (or the phone's): no minimize, no chats. */
  locked: boolean;
  zIndex: number;
  /** Short landscape phone: identity left, controls right. */
  landscape?: boolean;
  /** Tablet-width window: content capped and centred. */
  wide?: boolean;
  audio: MobileCallAudioProps;
  onMinimize: () => void;
  onToggleMute: () => void;
  onHangUp: () => void;
  /** 1:1 only: open the chat with this person (minimizes the call). */
  onMessage?: () => void;
  /** Over a lock: get to the lock screen / Android's unlock prompt. */
  onUnlock?: () => void;
  /** Preview: pictures by address instead of the avatar cache. */
  avatarSrcFor?: (address: string) => string | undefined;
  /** Preview: start with a sheet open. */
  initialSheet?: 'audio' | 'participants' | null;
};

const toneColor = (theme: Theme, tone: ReturnType<typeof callTone>) => {
  switch (tone) {
    case 'good':
      return theme.palette.success.main;
    case 'warning':
      return theme.palette.warning.main;
    default:
      return alpha(theme.palette.text.primary, 0.72);
  }
};

/**
 * The full-screen GO call: a 1:1 call (big face, name, state) or the phone
 * stage of a Qortal group call (participant grid). Minimize with the chevron,
 * a swipe down or Android back (the root wires back). While shown over the
 * lock it cannot be minimized and has no Message button.
 */
export function MobileCallScreen({
  view,
  locked,
  zIndex,
  landscape = false,
  wide = false,
  audio,
  onMinimize,
  onToggleMute,
  onHangUp,
  onMessage,
  onUnlock,
  avatarSrcFor,
  initialSheet = null,
}: MobileCallScreenProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const reduce = useReducedMotion();
  const [sheet, setSheet] = useState<'audio' | 'participants' | null>(
    initialSheet
  );
  const [transportHelpOpen, setTransportHelpOpen] = useState(false);
  const [relayHelpOpen, setRelayHelpOpen] = useState(false);
  const dragControls = useDragControls();
  const dragY = useMotionValue(0);
  const fade = useTransform(dragY, [0, 320], [1, 0.4]);

  const isGroup = view.kind === 'group';
  const live = controlsLive(view.phase);
  const tone = callTone(view.phase);
  const status = callStatusText(t, view);
  const detail = callDetailText(t, view);
  const canMinimize = !locked;
  const pulsing =
    view.phase === 'calling' ||
    view.phase === 'ringing' ||
    view.phase === 'joining';
  const showTransport =
    view.phase === 'active' ||
    view.phase === 'reconnecting' ||
    view.phase === 'unstable' ||
    view.phase === 'waiting';
  const hue = callAddressHue(view.address || view.callKey);
  const dark = theme.palette.mode === 'dark';

  // Audio: earpiece + speaker toggle the speaker in place; any other set
  // (a headset, Bluetooth, no earpiece) opens the route list.
  const audioKind = audioButtonKind(audio.routes);
  const currentRoute = audio.routes.find((r) => r.type === audio.current) ?? {
    type: audio.current,
  };
  // Usable from "Calling…" on (also before the first audio arrives: media
  // ready waits for a decoded frame, which a muted peer never sends).
  const audioButton =
    audioKind !== 'toggle' ? (
      <CallControlButton
        icon={ROUTE_ICONS[audio.current]}
        label={routeLabel(t, currentRoute)}
        active={audioKind === 'single' && audio.current === 'speaker'}
        onClick={() => setSheet('audio')}
        disabled={!live}
        ariaHasPopup
        testId="call-audio-button"
      />
    ) : (
      <CallControlButton
        icon={ROUTE_ICONS.speaker}
        label={t('core:go_call.speaker')}
        active={audio.current === 'speaker'}
        ariaPressed={audio.current === 'speaker'}
        onClick={() =>
          audio.onSelect(audio.current === 'speaker' ? 'earpiece' : 'speaker')
        }
        disabled={!live}
        testId="call-audio-button"
      />
    );

  const muteButton = (
    <CallControlButton
      icon={view.muted ? <MicOffRoundedIcon /> : <MicRoundedIcon />}
      label={view.muted ? t('core:go_call.unmute') : t('core:go_call.mute')}
      active={view.muted}
      ariaPressed={view.muted}
      onClick={onToggleMute}
      disabled={!live}
      testId="call-mute-button"
    />
  );

  const thirdButton: ReactNode = isGroup ? (
    <CallControlButton
      icon={<GroupsRoundedIcon />}
      label={t('core:go_call.participants_count', {
        n: view.participants.length,
      })}
      onClick={() => setSheet('participants')}
      disabled={view.phase === 'ended'}
      ariaHasPopup
      testId="call-participants-button"
    />
  ) : onMessage && !locked ? (
    <CallControlButton
      icon={<ChatBubbleRoundedIcon />}
      label={t('core:go_call.message')}
      onClick={onMessage}
      disabled={view.phase === 'ended'}
      testId="call-message-button"
    />
  ) : null;

  const hangUpButton = (
    <CallControlButton
      icon={<CallEndRoundedIcon />}
      label={isGroup ? t('core:go_call.leave') : t('core:go_call.hang_up')}
      variant="danger"
      size={72}
      onClick={onHangUp}
      disabled={view.phase === 'ended'}
      testId="call-hangup-button"
    />
  );

  const transportChip = showTransport ? (
    <ButtonBase
      onClick={() => setTransportHelpOpen((open) => !open)}
      aria-expanded={transportHelpOpen}
      data-testid="call-transport-chip"
      sx={{
        alignItems: 'center',
        backgroundColor: alpha(theme.palette.text.primary, dark ? 0.1 : 0.06),
        borderRadius: 999,
        color: alpha(theme.palette.text.primary, 0.82),
        display: 'inline-flex',
        fontSize: 12.5,
        fontWeight: 600,
        gap: 0.6,
        minHeight: 32,
        px: 1.4,
      }}
    >
      <LockRoundedIcon sx={{ fontSize: 14 }} />
      {transportText(t, view.transport)}
    </ButtonBase>
  ) : (
    <Box
      sx={{
        alignItems: 'center',
        color: alpha(theme.palette.text.primary, 0.6),
        display: 'inline-flex',
        fontSize: 12.5,
        fontWeight: 600,
        gap: 0.6,
        minHeight: 32,
      }}
    >
      <LockRoundedIcon sx={{ fontSize: 14 }} />
      {t('core:go_call.encrypted')}
    </Box>
  );

  const header = (
    <Box
      sx={{
        alignItems: 'center',
        display: 'grid',
        gridTemplateColumns: '48px 1fr 48px',
        minHeight: 56,
        px: 1,
      }}
    >
      {canMinimize ? (
        <IconButton
          aria-label={t('core:go_call.minimize')}
          onClick={onMinimize}
          data-testid="call-minimize-button"
          sx={{ color: theme.palette.text.primary, height: 48, width: 48 }}
        >
          <ExpandMoreRoundedIcon sx={{ fontSize: 30 }} />
        </IconButton>
      ) : (
        <Box />
      )}
      <Box sx={{ display: 'flex', justifyContent: 'center', minWidth: 0 }}>
        {transportChip}
      </Box>
      <Box />
    </Box>
  );

  const helpLine = (text: string, testId: string) => (
    <Typography
      data-testid={testId}
      sx={{
        color: alpha(theme.palette.text.primary, 0.7),
        fontSize: 13,
        lineHeight: 1.45,
        mx: 'auto',
        maxWidth: 340,
        mt: 0.75,
        px: 3,
        textAlign: 'center',
      }}
    >
      {text}
    </Typography>
  );

  const statusLine = (
    <Typography
      data-testid="call-status"
      aria-live={view.phase === 'active' ? 'off' : 'polite'}
      sx={{
        color: toneColor(theme, tone),
        fontSize: 16,
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 600,
        mt: 0.75,
        textAlign: 'center',
      }}
    >
      {status}
    </Typography>
  );

  const detailLine = detail ? (
    <Typography
      sx={{
        color: alpha(theme.palette.text.primary, 0.6),
        fontSize: 13,
        mt: 0.5,
        px: 3,
        textAlign: 'center',
      }}
    >
      {detail}
    </Typography>
  ) : null;

  const lockedNote = locked ? (
    <Typography
      data-testid="call-locked-note"
      sx={{
        alignItems: 'center',
        color: alpha(theme.palette.text.primary, 0.62),
        display: 'flex',
        fontSize: 12.5,
        gap: 0.6,
        justifyContent: 'center',
        mt: 0.5,
        px: 3,
        textAlign: 'center',
      }}
    >
      <LockRoundedIcon sx={{ fontSize: 14 }} />
      {t('core:go_call.locked_note')}
      {onUnlock ? (
        <ButtonBase
          onClick={onUnlock}
          data-testid="call-unlock-button"
          sx={{
            borderRadius: 999,
            color: theme.palette.primary.main,
            fontSize: 12.5,
            fontWeight: 700,
            minHeight: 32,
            ml: 0.5,
            px: 1,
          }}
        >
          {t('core:go_call.unlock')}
        </ButtonBase>
      ) : null}
    </Typography>
  ) : null;

  const relayNote =
    isGroup && view.relaying ? (
      <Box sx={{ display: 'flex', flexDirection: 'column', mt: 1 }}>
        <ButtonBase
          onClick={() => setRelayHelpOpen((open) => !open)}
          aria-expanded={relayHelpOpen}
          data-testid="call-relaying-note"
          sx={{
            alignItems: 'center',
            alignSelf: 'center',
            backgroundColor: alpha(theme.palette.info.main, dark ? 0.2 : 0.12),
            borderRadius: 999,
            color: dark ? theme.palette.info.light : theme.palette.info.dark,
            display: 'inline-flex',
            fontSize: 12.5,
            fontWeight: 600,
            gap: 0.6,
            minHeight: 30,
            px: 1.3,
          }}
        >
          <CellTowerRoundedIcon sx={{ fontSize: 15 }} />
          {t('core:go_call.relaying_note')}
        </ButtonBase>
        {relayHelpOpen
          ? helpLine(t('core:go_call.relaying_help'), 'call-relaying-help')
          : null}
      </Box>
    ) : null;

  const identity = isGroup ? (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        minHeight: 0,
        width: '100%',
      }}
    >
      <Box sx={{ px: 2, textAlign: 'center' }}>
        <Typography
          component="h2"
          sx={{
            fontSize: 22,
            fontWeight: 800,
            lineHeight: 1.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {view.title || t('core:go_call.group_call')}
        </Typography>
        {statusLine}
        {detailLine}
        {relayNote}
      </Box>
      <Box
        // The grid scrolls; it does not start the minimize swipe.
        onPointerDown={(event) => event.stopPropagation()}
        sx={{
          flex: 1,
          minHeight: 0,
          mt: 1.5,
          overflowY: 'auto',
          px: 1.5,
          touchAction: 'pan-y',
        }}
      >
        <MobileGroupCallGrid
          participants={view.participants}
          wide={wide || landscape}
          avatarSrcFor={avatarSrcFor}
        />
      </Box>
    </Box>
  ) : (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: 0,
        px: 2,
      }}
    >
      <CallAvatar
        address={view.address ?? ''}
        label={view.title}
        avatarName={view.avatarName}
        srcOverride={avatarSrcFor?.(view.address ?? '')}
        size={landscape ? 104 : 128}
        pulsing={pulsing && !reduce}
        dimmed={view.phase === 'ended'}
      />
      <Typography
        component="h2"
        sx={{
          fontSize: 26,
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
        {view.title}
      </Typography>
      {statusLine}
      {detailLine}
    </Box>
  );

  const controls = landscape ? (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        justifyContent: 'center',
        px: 2,
      }}
    >
      <Box sx={{ display: 'flex', gap: 2.5 }}>
        {muteButton}
        {audioButton}
        {thirdButton}
      </Box>
      {hangUpButton}
    </Box>
  ) : (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        pb: 3,
        pt: 2,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          gap: 3,
          justifyContent: 'center',
        }}
      >
        {muteButton}
        {audioButton}
        {thirdButton}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        {hangUpButton}
      </Box>
    </Box>
  );

  const helpBelowHeader = transportHelpOpen
    ? helpLine(
        view.transport === 'direct'
          ? t('core:go_call.transport_direct_help')
          : t('core:go_call.transport_relayed_help'),
        'call-transport-help'
      )
    : null;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={
        isGroup
          ? view.title || t('core:go_call.group_call')
          : t('core:go_call.call_with', { name: view.title })
      }
      data-testid="mobile-call-screen"
      data-call-phase={view.phase}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 48 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 64 }}
      transition={{ duration: reduce ? 0.12 : 0.26, ease: [0.2, 0.8, 0.3, 1] }}
      style={{
        inset: 0,
        position: 'fixed',
        zIndex,
      }}
    >
      <motion.div
        drag={canMinimize ? 'y' : false}
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.55 }}
        onDragEnd={(_event, info) => {
          if (
            info.offset.y > MINIMIZE_DRAG_PX ||
            info.velocity.y > MINIMIZE_FLING
          ) {
            onMinimize();
          }
        }}
        onPointerDown={(event) => {
          if (canMinimize) dragControls.start(event);
        }}
        style={{
          y: dragY,
          opacity: fade,
          background: `radial-gradient(120% 65% at 50% 0%, ${alpha(
            hue,
            dark ? 0.34 : 0.2
          )} 0%, ${alpha(hue, 0)} 72%), ${theme.palette.background.default}`,
          color: theme.palette.text.primary,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          paddingTop: SAFE_AREA_TOP,
          paddingBottom: SAFE_AREA_BOTTOM,
          paddingLeft: SAFE_AREA_LEFT,
          paddingRight: SAFE_AREA_RIGHT,
          touchAction: canMinimize ? 'pan-x' : 'auto',
          width: '100%',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            maxWidth: wide && !landscape ? 560 : undefined,
            minHeight: 0,
            mx: 'auto',
            width: '100%',
          }}
        >
          {header}
          {helpBelowHeader}
          {lockedNote}
          {landscape ? (
            <Box
              sx={{
                display: 'grid',
                flex: 1,
                gap: 2,
                gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)',
                minHeight: 0,
              }}
            >
              <Box sx={{ display: 'flex', minHeight: 0 }}>{identity}</Box>
              {controls}
            </Box>
          ) : (
            <>
              <Box
                sx={{
                  display: 'flex',
                  flex: 1,
                  minHeight: 0,
                  pt: isGroup ? 1 : 0,
                }}
              >
                {identity}
              </Box>
              {controls}
            </>
          )}
        </Box>
        <CallSheetBackPriorityContext.Provider
          value={
            locked ? CALL_SHEET_LOCKED_BACK_PRIORITY : CALL_SHEET_BACK_PRIORITY
          }
        >
          <MobileAudioRouteSheet
            open={sheet === 'audio'}
            routes={audio.routes}
            current={audio.current}
            onSelect={audio.onSelect}
            onClose={() => setSheet(null)}
          />
          {isGroup ? (
            <MobileCallParticipantsSheet
              open={sheet === 'participants'}
              participants={view.participants}
              maxParticipants={view.maxParticipants}
              relaying={view.relaying}
              onClose={() => setSheet(null)}
              avatarSrcFor={avatarSrcFor}
            />
          ) : null}
        </CallSheetBackPriorityContext.Provider>
      </motion.div>
    </motion.div>
  );
}
