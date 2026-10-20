import type { ReactElement } from 'react';
import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import BluetoothAudioRoundedIcon from '@mui/icons-material/BluetoothAudioRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import HeadsetMicRoundedIcon from '@mui/icons-material/HeadsetMicRounded';
import PhoneInTalkRoundedIcon from '@mui/icons-material/PhoneInTalkRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import { useTranslation } from 'react-i18next';
import type { CallAudioRoute, CallAudioRouteType } from './callBridgeAdapters';
import { MobileCallSheet } from './MobileCallSheet';

export const ROUTE_ICONS: Record<CallAudioRouteType, ReactElement> = {
  earpiece: <PhoneInTalkRoundedIcon />,
  speaker: <VolumeUpRoundedIcon />,
  bluetooth: <BluetoothAudioRoundedIcon />,
  wired: <HeadsetMicRoundedIcon />,
};

const ROUTE_LABEL_KEYS: Record<CallAudioRouteType, string> = {
  earpiece: 'core:go_call.earpiece',
  speaker: 'core:go_call.speaker',
  bluetooth: 'core:go_call.bluetooth',
  wired: 'core:go_call.wired',
};

export function routeLabel(
  t: (key: string) => string,
  route: CallAudioRoute
): string {
  const base = t(ROUTE_LABEL_KEYS[route.type]);
  return route.type === 'bluetooth' && route.name ? route.name : base;
}

export type MobileAudioRouteSheetProps = {
  open: boolean;
  routes: CallAudioRoute[];
  current: CallAudioRouteType;
  onSelect: (type: CallAudioRouteType) => void;
  onClose: () => void;
};

/** Phone / Speaker / Bluetooth / Headset picker for the call audio. */
export function MobileAudioRouteSheet({
  open,
  routes,
  current,
  onSelect,
  onClose,
}: MobileAudioRouteSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  return (
    <MobileCallSheet
      open={open}
      onClose={onClose}
      title={t('core:go_call.audio_route_title')}
      testId="call-audio-route-sheet"
    >
      <Box role="radiogroup" sx={{ px: 1 }}>
        {routes.map((route) => {
          const selected = route.type === current;
          const label = routeLabel(t, route);
          return (
            <ButtonBase
              key={route.type}
              role="radio"
              aria-checked={selected}
              onClick={() => {
                onSelect(route.type);
                onClose();
              }}
              sx={{
                alignItems: 'center',
                borderRadius: '14px',
                color: selected
                  ? theme.palette.primary.main
                  : theme.palette.text.primary,
                display: 'flex',
                gap: 2,
                justifyContent: 'flex-start',
                minHeight: 56,
                px: 1.5,
                width: '100%',
                backgroundColor: selected
                  ? alpha(theme.palette.primary.main, 0.1)
                  : 'transparent',
              }}
            >
              <Box sx={{ display: 'flex', '& svg': { fontSize: 24 } }}>
                {ROUTE_ICONS[route.type]}
              </Box>
              <Typography
                sx={{
                  flex: 1,
                  fontSize: 16,
                  fontWeight: selected ? 700 : 500,
                  minWidth: 0,
                  overflow: 'hidden',
                  textAlign: 'start',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </Typography>
              {selected ? <CheckRoundedIcon fontSize="small" /> : null}
            </ButtonBase>
          );
        })}
      </Box>
    </MobileCallSheet>
  );
}
