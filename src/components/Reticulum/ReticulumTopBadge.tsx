import { useState } from 'react';
import { alpha, Box, Popover, Typography, useTheme } from '@mui/material';
import {
  reticulumDisplayLabel,
  reticulumDisplayPhase,
  reticulumPhaseColor,
  useDeviceOnline,
  useReticulumStatus,
} from './reticulumStatus';
import { useOnlineAddresses } from '../../hooks/usePresence';

/**
 * Compact Reticulum status indicator for the mobile top bar. Sits to the right
 * of the Qortal name. Shows the live count of online Qortal accounts (the same
 * number surfaced on the Home dashboard) and, on tap, reveals Reticulum
 * transport details.
 */

function formatMegaBytes(bytes: number): string {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  const mb = value / (1024 * 1024);
  if (mb >= 10) return `${mb.toFixed(1)} MB`;
  return `${mb.toFixed(2)} MB`;
}

type StatKey =
  | 'online'
  | 'network'
  | 'ifac'
  | 'ifaces'
  | 'paths'
  | 'rx'
  | 'tx'
  | 'engine';

const STAT_HELP: Record<StatKey, { title: string; body: string }> = {
  online: {
    title: 'Online accounts',
    body: 'How many Qortal accounts this phone currently sees as present on the mesh. Same number as Home. It is not the number of hubs or Reticulum nodes.',
  },
  network: {
    title: 'Network name',
    body: 'The Reticulum mesh this phone joined. Qortal’s public mesh is qortal-hub. A different name means you are on a different network and cannot see those peers.',
  },
  ifac: {
    title: 'IFAC',
    body: 'Interface Access Code size. This is the shared network filter derived from the mesh name. 16 B means you are on the named Qortal network. 0 B means the interface is open / unfiltered.',
  },
  ifaces: {
    title: 'Hubs',
    body: 'How many hub links are up right now. These are the TCP connections to community hubs. 0 means you are not on the mesh yet. 2 is typical and healthy.',
  },
  paths: {
    title: 'Known paths',
    body: 'How many destinations Reticulum currently has a route to. Each announce teaches the phone a way to reach an identity. A few hundred is normal on a busy mesh. This is not live chat.',
  },
  rx: {
    title: 'Received',
    body: 'Total data this phone has received from the hubs since Reticulum started this session. It resets when the stack restarts, not when you close a chat.',
  },
  tx: {
    title: 'Sent',
    body: 'Total data this phone has sent to the hubs since Reticulum started this session. It resets when the stack restarts, not when you close a chat.',
  },
  engine: {
    title: 'Chat engine',
    body: 'Whether the local chat database and worker are ready. The green badge is the radio. Chat fetch and send need this engine to be ready. starting = still booting. failed = tap for the error, or allow WebView JIT for Qortal GO on GrapheneOS.',
  },
};

const StatRow = ({
  statKey,
  label,
  value,
  expanded,
  onToggle,
}: {
  statKey: StatKey;
  label: string;
  value: string;
  expanded: boolean;
  onToggle: (key: StatKey) => void;
}) => {
  const theme = useTheme();
  const help = STAT_HELP[statKey];
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(statKey);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle(statKey);
        }
      }}
      sx={{
        px: 1.25,
        py: 1,
        borderRadius: 2,
        cursor: 'pointer',
        backgroundColor: expanded
          ? alpha(theme.palette.primary.main, 0.12)
          : 'transparent',
        '&:active': {
          backgroundColor: alpha(theme.palette.primary.main, 0.16),
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 1.5,
        }}
      >
        <Typography
          sx={{
            fontSize: 13,
            fontWeight: 600,
            color: theme.palette.text.secondary,
          }}
        >
          {label}
        </Typography>
        <Typography
          sx={{
            fontSize: 15,
            fontWeight: 700,
            color: theme.palette.text.primary,
            fontVariantNumeric: 'tabular-nums',
            textAlign: 'right',
          }}
        >
          {value}
        </Typography>
      </Box>
      {expanded ? (
        <Box sx={{ mt: 0.75 }}>
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 700,
              color: theme.palette.text.primary,
              mb: 0.25,
            }}
          >
            {help.title}
          </Typography>
          <Typography
            sx={{
              fontSize: 13,
              lineHeight: 1.45,
              color: theme.palette.text.secondary,
            }}
          >
            {help.body}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
};

export const ReticulumTopBadge = () => {
  const theme = useTheme();
  const { phase, status, error, bridgeError, bridgeWarning, chatEngineState } =
    useReticulumStatus();
  const onlineCount = useOnlineAddresses().size;
  const deviceOnline = useDeviceOnline();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [openStat, setOpenStat] = useState<StatKey | null>(null);
  // A dead chat bridge is an error for the user even while the transport
  // layer reports peers: nothing they type can leave the phone.
  const displayPhase = bridgeError
    ? 'error'
    : reticulumDisplayPhase(phase, onlineCount, deviceOnline);
  const label = reticulumDisplayLabel(displayPhase);

  // Hide when the native plugin isn't present at all.
  if (phase === 'error' && !status) return null;

  const color = reticulumPhaseColor(displayPhase);
  const isOnline = displayPhase === 'online';
  const engineLabel = chatEngineState || 'idle';

  const toggleStat = (key: StatKey) => {
    setOpenStat((current) => (current === key ? null : key));
  };

  return (
    <>
      <Box
        onClick={(e) => {
          setOpenStat(null);
          setAnchorEl(e.currentTarget);
        }}
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
            : displayPhase === 'connecting' || displayPhase === 'starting'
              ? alpha('#f5a623', 0.16)
              : displayPhase === 'offline' || displayPhase === 'error'
                ? alpha('#e53935', 0.16)
                : 'rgba(255,255,255,0.06)',
          border: isOnline
            ? `1px solid ${alpha(theme.palette.success.main, 0.28)}`
            : displayPhase === 'connecting' || displayPhase === 'starting'
              ? `1px solid ${alpha('#f5a623', 0.28)}`
              : displayPhase === 'offline' || displayPhase === 'error'
                ? `1px solid ${alpha('#e53935', 0.28)}`
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
              displayPhase === 'online' ? `0 0 6px ${color}` : 'none',
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
          {label}
        </Typography>
      </Box>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => {
          setAnchorEl(null);
          setOpenStat(null);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.75,
              ml: -0.5,
              width: 'min(360px, calc(100vw - 24px))',
              maxWidth: 'calc(100vw - 24px)',
              borderRadius: 3,
              backgroundImage: 'none',
              backgroundColor:
                theme.palette.mode === 'dark'
                  ? 'rgb(28, 30, 36)'
                  : theme.palette.background.paper,
              boxShadow:
                theme.palette.mode === 'dark'
                  ? '0 16px 40px rgba(0,0,0,0.45)'
                  : '0 16px 40px rgba(0,0,0,0.18)',
              border: `1px solid ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.08 : 0.2)}`,
            },
          },
        }}
      >
        <Box sx={{ p: 2, pb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.5 }}>
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: color,
                boxShadow: isOnline ? `0 0 8px ${color}` : 'none',
                flexShrink: 0,
              }}
            />
            <Typography sx={{ fontWeight: 800, fontSize: 18, lineHeight: 1.2 }}>
              Reticulum
            </Typography>
            <Typography
              sx={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                color: color,
              }}
            >
              {label}
            </Typography>
          </Box>
          <Typography
            sx={{
              fontSize: 12,
              color: theme.palette.text.secondary,
              mb: 1.25,
            }}
          >
            Tap a row to see what it means.
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            <StatRow
              statKey="online"
              label="Online"
              value={`${onlineCount}`}
              expanded={openStat === 'online'}
              onToggle={toggleStat}
            />
            {status ? (
              <>
                <StatRow
                  statKey="network"
                  label="Network"
                  value={status.networkName}
                  expanded={openStat === 'network'}
                  onToggle={toggleStat}
                />
                <StatRow
                  statKey="ifac"
                  label="IFAC"
                  value={`${status.ifacSize} B`}
                  expanded={openStat === 'ifac'}
                  onToggle={toggleStat}
                />
                <StatRow
                  statKey="ifaces"
                  label="Hubs"
                  value={`${status.interfaces}`}
                  expanded={openStat === 'ifaces'}
                  onToggle={toggleStat}
                />
                <StatRow
                  statKey="paths"
                  label="Known paths"
                  value={`${status.announces}`}
                  expanded={openStat === 'paths'}
                  onToggle={toggleStat}
                />
                <StatRow
                  statKey="rx"
                  label="Received"
                  value={formatMegaBytes(status.rxBytes)}
                  expanded={openStat === 'rx'}
                  onToggle={toggleStat}
                />
                <StatRow
                  statKey="tx"
                  label="Sent"
                  value={formatMegaBytes(status.txBytes)}
                  expanded={openStat === 'tx'}
                  onToggle={toggleStat}
                />
              </>
            ) : null}
            <StatRow
              statKey="engine"
              label="Chat engine"
              value={engineLabel}
              expanded={openStat === 'engine'}
              onToggle={toggleStat}
            />
          </Box>

          {error && (
            <Typography sx={{ fontSize: 13, color: 'error.main', mt: 1.25 }}>
              {error}
            </Typography>
          )}
          {bridgeError && (
            <Typography
              sx={{
                fontSize: 13,
                color: 'error.main',
                mt: 1.25,
                lineHeight: 1.45,
                userSelect: 'text',
              }}
            >
              {bridgeError}
            </Typography>
          )}
          {bridgeWarning && (
            <Typography
              sx={{
                fontSize: 13,
                color: 'warning.main',
                mt: 1.25,
                lineHeight: 1.45,
                userSelect: 'text',
              }}
            >
              {bridgeWarning}
            </Typography>
          )}
        </Box>
      </Popover>
    </>
  );
};

export default ReticulumTopBadge;
