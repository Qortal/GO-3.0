import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import FileSaver from 'file-saver';
import {
  alpha,
  Box,
  Button,
  Popover,
  Typography,
  useTheme,
} from '@mui/material';
import {
  chatEngineLabel,
  reticulumDisplayLabel,
  reticulumDisplayPhase,
  reticulumPhaseColor,
  useDeviceOnline,
  useReticulumStatus,
} from './reticulumStatus';
import {
  collectReticulumDiagnostics,
  diagnosticsFileName,
  diagnosticsReportToMarkdown,
} from './reticulumDiagnostics';
import {
  mobileSaveLocationLabelFor,
  saveTextToMobileDocuments,
} from '../../utils/mobileFileSave';
import { useOnlineAddresses } from '../../hooks/usePresence';
import { useTranslation } from 'react-i18next';

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

// i18n keys (reticulum namespace) for the help shown under a tapped row.
const STAT_HELP: Record<StatKey, { title: string; body: string }> = {
  online: {
    title: 'reticulum:status_badge.help.online_accounts.title',
    body: 'reticulum:status_badge.help.online_accounts.body',
  },
  network: {
    title: 'reticulum:status_badge.help.network_name.title',
    body: 'reticulum:status_badge.help.network_name.body',
  },
  ifac: {
    title: 'reticulum:status_badge.help.ifac.title',
    body: 'reticulum:status_badge.help.ifac.body',
  },
  ifaces: {
    title: 'reticulum:status_badge.help.hubs.title',
    body: 'reticulum:status_badge.help.hubs.body',
  },
  paths: {
    title: 'reticulum:status_badge.help.known_paths.title',
    body: 'reticulum:status_badge.help.known_paths.body',
  },
  rx: {
    title: 'reticulum:status_badge.help.received.title',
    body: 'reticulum:status_badge.help.received.body',
  },
  tx: {
    title: 'reticulum:status_badge.help.sent.title',
    body: 'reticulum:status_badge.help.sent.body',
  },
  engine: {
    title: 'reticulum:status_badge.help.chat_engine.title',
    body: 'reticulum:status_badge.help.chat_engine.body',
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
  const { t } = useTranslation(['reticulum']);
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
            {t(help.title)}
          </Typography>
          <Typography
            sx={{
              fontSize: 13,
              lineHeight: 1.45,
              color: theme.palette.text.secondary,
            }}
          >
            {/* The chat engine help names the diagnostics button below. */}
            {t(help.body, {
              action: t('reticulum:status_badge.copy_diagnostics'),
            })}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
};

export const ReticulumTopBadge = () => {
  const theme = useTheme();
  const { t } = useTranslation(['reticulum']);
  const reticulumState = useReticulumStatus();
  const { phase, status, error, bridgeError, bridgeWarning, chatEngineState } =
    reticulumState;
  const onlineCount = useOnlineAddresses().size;
  const deviceOnline = useDeviceOnline();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [openStat, setOpenStat] = useState<StatKey | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [diagState, setDiagState] = useState<
    'idle' | 'collecting' | 'copied' | 'failed'
  >('idle');
  const [diagText, setDiagText] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    'idle' | 'collecting' | 'saved' | 'failed'
  >('idle');
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const popoverOpen = Boolean(anchorEl);

  // Tick once a second while the popover shows a booting engine, so the
  // "starting · N s" label counts up.
  useEffect(() => {
    if (!popoverOpen || chatEngineState !== 'starting') return undefined;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [popoverOpen, chatEngineState]);

  useEffect(() => {
    if (diagState !== 'copied') return undefined;
    const timer = window.setTimeout(() => setDiagState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [diagState]);
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
  const engineLabel = chatEngineLabel(reticulumState, clock);

  const collectReport = async (): Promise<string> => {
    try {
      return await collectReticulumDiagnostics(
        reticulumState,
        onlineCount,
        deviceOnline
      );
    } catch (err) {
      return `Diagnostics could not be collected: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  };

  const copyDiagnostics = async () => {
    setDiagState('collecting');
    setDiagText(null);
    const report = await collectReport();
    try {
      await navigator.clipboard.writeText(report);
      setDiagState('copied');
    } catch {
      // No clipboard permission (or no secure context): show the text so it
      // can be selected and copied by hand.
      setDiagText(report);
      setDiagState('failed');
    }
  };

  // A file survives chat apps that split a long paste into several messages.
  const saveDiagnostics = async () => {
    setSaveState('collecting');
    setSaveNote(null);
    const markdown = diagnosticsReportToMarkdown(await collectReport());
    const filename = diagnosticsFileName(Date.now());
    try {
      if (Capacitor.isNativePlatform()) {
        await saveTextToMobileDocuments(filename, markdown);
        setSaveNote(
          t('reticulum:status_badge.save_diagnostics_saved_to', {
            location: `${mobileSaveLocationLabelFor(filename)}/${filename}`,
          })
        );
      } else {
        FileSaver.saveAs(
          new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
          filename
        );
      }
      setSaveState('saved');
    } catch (err) {
      setSaveNote(
        t('reticulum:status_badge.save_diagnostics_failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      );
      setSaveState('failed');
    }
  };

  const toggleStat = (key: StatKey) => {
    setOpenStat((current) => (current === key ? null : key));
  };

  return (
    <>
      <Box
        onClick={(e) => {
          setOpenStat(null);
          if (saveState !== 'collecting') {
            setSaveState('idle');
            setSaveNote(null);
          }
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
            boxShadow: displayPhase === 'online' ? `0 0 6px ${color}` : 'none',
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
          setDiagText(null);
          setDiagState('idle');
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
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.5 }}
          >
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

          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1,
              mt: 1.5,
            }}
          >
            <Button
              size="small"
              variant="outlined"
              disabled={
                diagState === 'collecting' || saveState === 'collecting'
              }
              onClick={(event) => {
                event.stopPropagation();
                void copyDiagnostics();
              }}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
            >
              {diagState === 'collecting'
                ? t('reticulum:status_badge.copy_diagnostics_collecting')
                : diagState === 'copied'
                  ? t('reticulum:status_badge.copy_diagnostics_copied')
                  : t('reticulum:status_badge.copy_diagnostics')}
            </Button>
            <Button
              size="small"
              variant="outlined"
              disabled={
                diagState === 'collecting' || saveState === 'collecting'
              }
              onClick={(event) => {
                event.stopPropagation();
                void saveDiagnostics();
              }}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
            >
              {saveState === 'collecting'
                ? t('reticulum:status_badge.copy_diagnostics_collecting')
                : saveState === 'saved'
                  ? t('reticulum:status_badge.save_diagnostics_saved')
                  : t('reticulum:status_badge.save_diagnostics')}
            </Button>
          </Box>
          <Typography
            sx={{
              fontSize: 11,
              mt: 0.75,
              lineHeight: 1.4,
              userSelect: saveNote ? 'text' : undefined,
              overflowWrap: 'anywhere',
              color:
                saveState === 'failed'
                  ? theme.palette.error.main
                  : theme.palette.text.secondary,
            }}
          >
            {saveNote ?? t('reticulum:status_badge.copy_diagnostics_hint')}
          </Typography>
          {diagText ? (
            <Box
              component="pre"
              sx={{
                mt: 1,
                p: 1,
                maxHeight: 220,
                overflow: 'auto',
                fontSize: 10,
                lineHeight: 1.35,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                userSelect: 'text',
                borderRadius: 2,
                backgroundColor: alpha(theme.palette.common.black, 0.25),
                color: theme.palette.text.secondary,
              }}
            >
              {diagText}
            </Box>
          ) : null}
        </Box>
      </Popover>
    </>
  );
};

export default ReticulumTopBadge;
