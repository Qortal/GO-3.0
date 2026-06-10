import { useState } from 'react';
import { alpha, Box, Popover, Typography, useTheme } from '@mui/material';
import { reticulumPhaseColor, useReticulumStatus } from './reticulumStatus';
import { useOnlineAddresses } from '../../hooks/usePresence';

/**
 * Compact Reticulum status indicator for the mobile top bar. Sits to the right
 * of the Qortal name. Shows the live count of online Qortal accounts (the same
 * number surfaced on the Home dashboard) and, on tap, reveals Reticulum
 * transport details.
 */
export const ReticulumTopBadge = () => {
  const theme = useTheme();
  const { phase, status, error } = useReticulumStatus();
  const onlineCount = useOnlineAddresses().size;
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  // Hide when the native plugin isn't present at all.
  if (phase === 'error' && !status) return null;

  const color = reticulumPhaseColor(phase);
  const isOnline = phase === 'online';
  const label =
    phase === 'online'
      ? 'online'
      : phase === 'connecting'
        ? 'connecting'
        : phase === 'starting'
          ? 'starting'
          : phase === 'error'
            ? 'offline'
            : 'idle';

  return (
    <>
      <Box
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.75,
          py: 0.25,
          borderRadius: 999,
          cursor: 'pointer',
          backgroundColor: isOnline
            ? alpha(theme.palette.success.main, 0.16)
            : 'rgba(255,255,255,0.06)',
          border: isOnline
            ? `1px solid ${alpha(theme.palette.success.main, 0.28)}`
            : '1px solid transparent',
          userSelect: 'none',
        }}
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: color,
            boxShadow:
              phase === 'online' ? `0 0 6px ${color}` : 'none',
            flexShrink: 0,
          }}
        />
        <Typography
          sx={{
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: 0.2,
            color: theme.palette.text.primary,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {onlineCount}
        </Typography>
        <Typography
          sx={{
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: 0.3,
            color: theme.palette.text.secondary,
            textTransform: 'uppercase',
          }}
        >
          online
        </Typography>
      </Box>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 1.5, minWidth: 180 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: color,
              }}
            />
            <Typography sx={{ fontWeight: 700, fontSize: 13 }}>
              Reticulum
            </Typography>
            <Typography sx={{ fontSize: 12, opacity: 0.7 }}>{label}</Typography>
          </Box>
          <Typography sx={{ fontSize: 11.5, fontWeight: 600, mb: 0.5 }}>
            {onlineCount} online
          </Typography>
          {status && (
            <Box sx={{ fontSize: 11, opacity: 0.85, lineHeight: 1.5 }}>
              <div>net: {status.networkName}</div>
              <div>
                IFAC: {status.ifacSize}B · ifaces: {status.interfaces}
              </div>
              <div>announces: {status.announces}</div>
              <div>
                rx: {status.rxBytes}B · tx: {status.txBytes}B
              </div>
            </Box>
          )}
          {error && (
            <Typography sx={{ fontSize: 11, color: 'error.main', mt: 0.5 }}>
              {error}
            </Typography>
          )}
        </Box>
      </Popover>
    </>
  );
};

export default ReticulumTopBadge;
