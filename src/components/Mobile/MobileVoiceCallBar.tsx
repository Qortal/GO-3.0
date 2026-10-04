import { useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha, keyframes } from '@mui/material/styles';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import MicOffRoundedIcon from '@mui/icons-material/MicOffRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import SpeakerPhoneRoundedIcon from '@mui/icons-material/SpeakerPhoneRounded';
import PhoneInTalkRoundedIcon from '@mui/icons-material/PhoneInTalkRounded';
import { Capacitor } from '@capacitor/core';
import { useAtomValue } from 'jotai';
import { userInfoAtom } from '../../atoms/global';
import { useVoiceCallContext } from '../../context/VoiceCallContext';
import {
  isDirectVoiceCallChatId,
  peerAddressFromDirectVoiceChatId,
} from '../../lib/call/directVoiceCallChatId';
import { CallAudioSettingsButton } from '../Chat/CallAudioDeviceSelectors';
import {
  setCallSpeaker,
  isCallSpeakerOn,
} from '../../bridge/mobileAudioSurface';
import { getPrimaryNameForAvatar } from '../Group/groupApi';
import {
  addrHue,
  initialsFromDisplayLabel,
  shortAddr,
  useQortalAvatarThumbnailSrc,
} from '../Group/qortalGroupCallParticipantUi';
import { MOBILE_TOP_BAR_HEIGHT_PX } from './MobileTopBar';
import { SAFE_AREA_TOP } from '../../utils/mobileSafeArea';

const DANGER = '#f23f42';
const VOICE_CONNECTED = '#3d9142';

const callBarIn = keyframes`
  from { opacity: 0; transform: translateY(-12px); }
  to { opacity: 1; transform: translateY(0); }
`;

const callingPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
`;

/**
 * Persistent in-call bar pinned under the mobile top bar.
 *
 * The desktop nav call pill portals into GlobalQortalNavBar, which never
 * renders on mobile — so without this the call controls only existed inside
 * the PM window. Shows the peer avatar/name, live duration, mic mute,
 * loudspeaker/earpiece toggle, audio-device settings, and hang-up for any
 * active or outgoing direct voice call, on every screen.
 */
export function MobileVoiceCallBar() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const userInfo = useAtomValue(userInfoAtom);
  const myAddress = userInfo?.address ?? '';
  const {
    activeCallChatId,
    startupStatus,
    callMediaReady,
    callDuration,
    callState,
    hangUp,
    isMuted,
    toggleMute,
  } = useVoiceCallContext();
  const isNative = Capacitor.isNativePlatform();
  const [speakerOn, setSpeakerOn] = useState(isCallSpeakerOn());

  const activeDirect =
    isDirectVoiceCallChatId(activeCallChatId) &&
    (callState === 'connected' || callState === 'calling');

  const peerAddress = useMemo(() => {
    if (!activeCallChatId || !myAddress) return '';
    return peerAddressFromDirectVoiceChatId(activeCallChatId, myAddress) ?? '';
  }, [activeCallChatId, myAddress]);

  const [peerPrimaryName, setPeerPrimaryName] = useState('');
  useEffect(() => {
    if (!peerAddress) {
      setPeerPrimaryName('');
      return;
    }
    let cancelled = false;
    getPrimaryNameForAvatar(peerAddress)
      .then((name) => {
        if (!cancelled) setPeerPrimaryName(name?.trim() ?? '');
      })
      .catch(() => {
        if (!cancelled) setPeerPrimaryName('');
      });
    return () => {
      cancelled = true;
    };
  }, [peerAddress]);

  // Re-sync the speaker indicator whenever a call becomes active (the native
  // route may have been reset between calls).
  useEffect(() => {
    if (activeDirect) setSpeakerOn(isCallSpeakerOn());
  }, [activeDirect]);

  const title = peerPrimaryName || (peerAddress ? shortAddr(peerAddress) : '');
  const avatarSrc = useQortalAvatarThumbnailSrc(peerPrimaryName || undefined);
  const initials = initialsFromDisplayLabel(title, peerAddress || myAddress);

  const durationLabel = useMemo(() => {
    const minutes = Math.floor(callDuration / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (callDuration % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }, [callDuration]);

  if (!isMobile || !activeDirect) return null;

  const connected = callState === 'connected';
  const statusLabel = !connected
    ? 'Calling…'
    : callMediaReady
      ? durationLabel
      : startupStatus.headline || 'Connecting…';

  const controlsEnabled = connected && callMediaReady;

  return (
    <Box
      sx={{
        alignItems: 'center',
        animation: `${callBarIn} 220ms cubic-bezier(0.2, 0.8, 0.3, 1)`,
        backgroundColor:
          theme.palette.mode === 'dark'
            ? 'rgba(23, 27, 34, 0.98)'
            : 'rgba(236, 240, 246, 0.98)',
        border: `1px solid ${
          connected
            ? alpha(VOICE_CONNECTED, 0.55)
            : theme.palette.border.subtle
        }`,
        borderRadius: '14px',
        boxShadow:
          theme.palette.mode === 'dark'
            ? '0 10px 24px rgba(0, 0, 0, 0.45)'
            : '0 8px 20px rgba(15, 23, 42, 0.18)',
        display: 'flex',
        gap: 0.5,
        height: 52,
        left: 8,
        position: 'fixed',
        px: 1,
        right: 8,
        top: `calc(${SAFE_AREA_TOP} + ${MOBILE_TOP_BAR_HEIGHT_PX + 6}px)`,
        zIndex: theme.zIndex.modal + 5,
      }}
    >
      <Avatar
        alt={title}
        src={avatarSrc || undefined}
        sx={{
          bgcolor: addrHue(peerAddress || myAddress),
          color: '#fff',
          flexShrink: 0,
          fontSize: 13,
          fontWeight: 800,
          height: 34,
          width: 34,
        }}
      >
        {!avatarSrc ? initials : null}
      </Avatar>

      <Box sx={{ flex: 1, minWidth: 0, mx: 0.5 }}>
        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontSize: 13,
            fontWeight: 700,
            lineHeight: '17px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </Typography>
        <Typography
          sx={{
            animation: connected
              ? 'none'
              : `${callingPulse} 1.6s ease-in-out infinite`,
            color:
              connected && callMediaReady
                ? VOICE_CONNECTED
                : theme.palette.text.secondary,
            fontSize: 11.5,
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 700,
            lineHeight: '15px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {statusLabel}
        </Typography>
      </Box>

      {controlsEnabled ? (
        <Box
          sx={{
            flexShrink: 0,
            '& .MuiIconButton-root': {
              color: theme.palette.text.secondary,
              height: 36,
              width: 36,
            },
          }}
        >
          <CallAudioSettingsButton
            IconComponent={SettingsRoundedIcon}
            tooltipPlacement="bottom"
          />
        </Box>
      ) : null}

      <IconButton
        disabled={!controlsEnabled}
        size="small"
        onClick={toggleMute}
        sx={{
          color: isMuted ? DANGER : VOICE_CONNECTED,
          flexShrink: 0,
          height: 36,
          width: 36,
        }}
      >
        {isMuted ? (
          <MicOffRoundedIcon sx={{ fontSize: 20 }} />
        ) : (
          <MicRoundedIcon sx={{ fontSize: 20 }} />
        )}
      </IconButton>

      {isNative ? (
        <IconButton
          disabled={!controlsEnabled}
          size="small"
          onClick={() => {
            const next = !speakerOn;
            setSpeakerOn(next);
            void setCallSpeaker(next).then((applied) => setSpeakerOn(applied));
          }}
          sx={{
            color: speakerOn
              ? theme.palette.primary.main
              : theme.palette.text.secondary,
            flexShrink: 0,
            height: 36,
            width: 36,
          }}
        >
          {speakerOn ? (
            <SpeakerPhoneRoundedIcon sx={{ fontSize: 20 }} />
          ) : (
            <PhoneInTalkRoundedIcon sx={{ fontSize: 20 }} />
          )}
        </IconButton>
      ) : null}

      <IconButton
        size="small"
        onClick={hangUp}
        sx={{
          backgroundColor: DANGER,
          color: '#fff',
          flexShrink: 0,
          height: 36,
          ml: 0.25,
          width: 36,
          '&:hover': { backgroundColor: '#d63437' },
          '&:active': { backgroundColor: '#bf2d30' },
        }}
      >
        <CallEndRoundedIcon sx={{ fontSize: 20 }} />
      </IconButton>
    </Box>
  );
}
