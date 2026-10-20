import { memo } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import MicOffRoundedIcon from '@mui/icons-material/MicOffRounded';
import { groupGridLayout, type MobileCallParticipant } from './callUiModel';
import { CallAvatar } from './CallAvatar';

export type MobileGroupCallGridProps = {
  participants: MobileCallParticipant[];
  /** Landscape / tablet: more columns. */
  wide?: boolean;
  avatarSrcFor?: (address: string) => string | undefined;
};

/**
 * Adaptive participant grid for the phone stage: one big face when alone,
 * two stacked for two, 2x2 for up to four, then three columns that scroll.
 * Speaking people get a green ring; this device shows its mute state.
 */
export const MobileGroupCallGrid = memo(function MobileGroupCallGrid({
  participants,
  wide = false,
  avatarSrcFor,
}: MobileGroupCallGridProps) {
  const theme = useTheme();
  const { columns, avatarPx } = groupGridLayout(participants.length, { wide });
  const sparse = participants.length <= 2;

  return (
    <Box
      data-testid="call-participant-grid"
      data-columns={columns}
      sx={{
        // Centred when it fits; `safe` keeps the top reachable when it
        // scrolls (many people, landscape).
        alignContent: 'safe center',
        display: 'grid',
        gap: sparse ? 3 : 2,
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        minHeight: '100%',
        pb: 2,
      }}
    >
      {participants.map((p) => (
        <Box
          key={p.address}
          data-testid="call-participant-tile"
          data-speaking={p.speaking ? 'true' : 'false'}
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            minWidth: 0,
            py: 0.5,
          }}
        >
          <Box sx={{ position: 'relative' }}>
            <CallAvatar
              address={p.address}
              label={p.avatarName || p.label}
              avatarName={p.avatarName}
              srcOverride={avatarSrcFor?.(p.address)}
              size={avatarPx}
              speaking={p.speaking && !p.muted}
            />
            {p.muted ? (
              <Box
                aria-hidden
                sx={{
                  alignItems: 'center',
                  backgroundColor: theme.palette.error.main,
                  border: `2px solid ${theme.palette.background.default}`,
                  borderRadius: '50%',
                  bottom: 0,
                  color: theme.palette.error.contrastText,
                  display: 'flex',
                  height: 26,
                  justifyContent: 'center',
                  position: 'absolute',
                  right: 0,
                  width: 26,
                }}
              >
                <MicOffRoundedIcon sx={{ fontSize: 15 }} />
              </Box>
            ) : null}
          </Box>
          <Typography
            sx={{
              color: p.speaking
                ? theme.palette.success.main
                : alpha(theme.palette.text.primary, 0.86),
              fontSize: avatarPx >= 100 ? 16 : 13.5,
              fontWeight: p.isSelf ? 700 : 600,
              maxWidth: '100%',
              overflow: 'hidden',
              textAlign: 'center',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {p.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
});
