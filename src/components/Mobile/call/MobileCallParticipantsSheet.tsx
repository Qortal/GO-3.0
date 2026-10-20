import { Box, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CellTowerRoundedIcon from '@mui/icons-material/CellTowerRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import MicOffRoundedIcon from '@mui/icons-material/MicOffRounded';
import { useTranslation } from 'react-i18next';
import { shortCallAddress, type MobileCallParticipant } from './callUiModel';
import { CallAvatar } from './CallAvatar';
import { MobileCallSheet } from './MobileCallSheet';

export type MobileCallParticipantsSheetProps = {
  open: boolean;
  participants: MobileCallParticipant[];
  maxParticipants: number;
  relaying: boolean;
  onClose: () => void;
  avatarSrcFor?: (address: string) => string | undefined;
};

/** Who is in the group call, this device first. No forwarder jargon. */
export function MobileCallParticipantsSheet({
  open,
  participants,
  maxParticipants,
  relaying,
  onClose,
  avatarSrcFor,
}: MobileCallParticipantsSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  return (
    <MobileCallSheet
      open={open}
      onClose={onClose}
      title={t('core:go_call.participants_title', {
        n: participants.length,
        max: maxParticipants,
      })}
      testId="call-participants-sheet"
    >
      <Box component="ul" sx={{ listStyle: 'none', m: 0, px: 1, py: 0 }}>
        {participants.map((p) => (
          <Box
            component="li"
            key={p.address}
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: 1.5,
              minHeight: 60,
              px: 1.5,
            }}
          >
            <CallAvatar
              address={p.address}
              label={p.avatarName || p.label}
              avatarName={p.avatarName}
              srcOverride={avatarSrcFor?.(p.address)}
              size={40}
              speaking={p.speaking && !p.muted}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: 15.5,
                  fontWeight: p.isSelf ? 700 : 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.label}
              </Typography>
              <Typography
                sx={{
                  color: alpha(theme.palette.text.primary, 0.55),
                  fontFamily:
                    'ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace',
                  fontSize: 11.5,
                }}
              >
                {shortCallAddress(p.address)}
              </Typography>
            </Box>
            {p.isSelf && relaying ? (
              <CellTowerRoundedIcon
                aria-label={t('core:go_call.relaying_note')}
                sx={{ color: theme.palette.info.main, fontSize: 20 }}
              />
            ) : null}
            {p.muted ? (
              <MicOffRoundedIcon
                aria-label={t('core:go_call.muted')}
                sx={{ color: theme.palette.error.main, fontSize: 20 }}
              />
            ) : p.speaking ? (
              <GraphicEqRoundedIcon
                aria-label={t('core:go_call.speaking')}
                sx={{ color: theme.palette.success.main, fontSize: 20 }}
              />
            ) : null}
          </Box>
        ))}
      </Box>
    </MobileCallSheet>
  );
}
