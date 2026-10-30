import {
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isRunningPublicNodeAtom } from '../../../atoms/global';
import {
  decidePackForDevice,
  readDeviceTier,
} from '../../../qortinoAgent/deviceTier';
import {
  fetchQortinoManifest,
  filesForPack,
  installQortinoPack,
  type DownloadProgress,
} from '../../../qortinoAgent/download';
import {
  formatBytes,
  QORTINO_SAFETY_DISCLAIMER,
  type QortinoAgentManifest,
  type QortinoPackId,
} from '../../../qortinoAgent/manifest';
import type { QortinoInstallState } from '../../../qortinoAgent/store';
import { executeEvent } from '../../../utils/events';

type Props = {
  onInstalled: (install: QortinoInstallState, manifest: QortinoAgentManifest) => void;
  onCancel: () => void;
};

export function QortinoAgentGate({ onInstalled, onCancel }: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const isPublicNode = useAtomValue(isRunningPublicNodeAtom);
  const [manifest, setManifest] = useState<QortinoAgentManifest | null>(null);
  const [selectedPack, setSelectedPack] = useState<QortinoPackId>('small');
  const [reason, setReason] = useState('');
  const [allowed, setAllowed] = useState<QortinoPackId[]>(['small']);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Assemble pulls multi-GB QDN resources — only a private node can serve them.
  const blockPublicNode = isPublicNode;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [m, tier] = await Promise.all([
          fetchQortinoManifest({ timeoutMs: 4000 }),
          readDeviceTier(),
        ]);
        if (cancelled) return;
        setManifest(m);
        const decision = decidePackForDevice(tier, m);
        setSelectedPack(decision.recommendedPack);
        setAllowed(decision.allowedPacks);
        setReason(decision.reason);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to prepare assemble');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }

      // The fast path may have returned the bundled manifest; adopt the QDN
      // one as soon as it lands so pack sizes and labels stay current.
      try {
        const full = await fetchQortinoManifest({ timeoutMs: 0 });
        if (!cancelled) setManifest(full);
      } catch {
        // Bundled manifest already on screen.
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  const packMeta = useMemo(
    () => manifest?.packs.find((p) => p.id === selectedPack),
    [manifest, selectedPack]
  );

  const downloadEstimate = useMemo(() => {
    if (!manifest || !packMeta) return 0;
    return filesForPack(manifest, selectedPack).reduce((sum, f) => sum + (f.sizeBytes || 0), 0);
  }, [manifest, packMeta, selectedPack]);

  const notifyPublicNodeBlocked = useCallback(() => {
    executeEvent('openGlobalSnackBar', {
      actionEvent: 'openCustomNodeGuideWebsite',
      actionLabel: 'View guide',
      dismissible: true,
      duration: 14000,
      message:
        'Qortino can only be assembled from a private node. Connect your own node, then try again.',
      type: 'warning',
    });
  }, []);

  const startInstall = useCallback(async () => {
    if (!manifest) return;
    if (blockPublicNode) {
      notifyPublicNodeBlocked();
      setError(
        'Assemble needs a private node — public gateway nodes cannot fetch the Qortino pack.'
      );
      return;
    }
    setInstalling(true);
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const install = await installQortinoPack({
        manifest,
        packId: selectedPack,
        signal: controller.signal,
        onProgress: setProgress,
      });
      onInstalled(install, manifest);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : e && typeof e === 'object' && 'errorMessage' in e
            ? String((e as { errorMessage?: string }).errorMessage)
            : 'Assemble failed';
      setError(msg);
      setProgress(null);
    } finally {
      setInstalling(false);
    }
  }, [blockPublicNode, manifest, notifyPublicNodeBlocked, onInstalled, selectedPack]);

  const progressRatio =
    progress && progress.bytesTotal > 0
      ? Math.min(1, progress.bytesReceived / progress.bytesTotal)
      : progress?.phase === 'done'
        ? 1
        : 0;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        px: 2,
        py: 1.5,
      }}
    >
      <Typography sx={{ fontWeight: 800, fontSize: '1.15rem' }}>
        Qortino Offline Agent
      </Typography>
      <Typography
        sx={{
          color: alpha(theme.palette.text.primary, 0.82),
          fontSize: '0.92rem',
          lineHeight: 1.5,
        }}
      >
        Your off-grid co-conspirator. Qortal tricks, Q-App hacking patterns,
        bushcraft, water, power, and grid-down survival — assembled from QDN onto
        this device, then it stays awake when the rest of the world goes quiet.
        No cloud. No leash. Apocalypse-ready companion mode.
      </Typography>

      {blockPublicNode && (
        <Box
          sx={{
            background: alpha(theme.palette.warning.main, isDark ? 0.16 : 0.12),
            border: `1px solid ${alpha(theme.palette.warning.main, 0.45)}`,
            borderRadius: '12px',
            px: 1.25,
            py: 1.1,
          }}
        >
          <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, mb: 0.35 }}>
            Private node required
          </Typography>
          <Typography
            sx={{
              color: alpha(theme.palette.text.primary, 0.85),
              fontSize: '0.82rem',
              lineHeight: 1.45,
            }}
          >
            Qortino can only be assembled from a private node. Public gateway
            nodes cannot pull the pack. Connect your own node, then assemble.
          </Typography>
          <Button
            size="small"
            sx={{ mt: 0.75, textTransform: 'none' }}
            onClick={notifyPublicNodeBlocked}
          >
            View private node guide
          </Button>
        </Box>
      )}

      {loading && (
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
          <CircularProgress size={18} />
          <Typography sx={{ fontSize: '0.85rem' }}>Scanning device & kit list…</Typography>
        </Box>
      )}

      {!loading && manifest && (
        <>
          <Typography sx={{ fontSize: '0.82rem', color: alpha(theme.palette.text.primary, 0.7) }}>
            {reason}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {manifest.packs.map((pack) => {
              const disabled = !allowed.includes(pack.id) || installing;
              const selected = selectedPack === pack.id;
              return (
                <Box
                  key={pack.id}
                  component="button"
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedPack(pack.id)}
                  sx={{
                    background: selected
                      ? alpha('#4A7FD4', isDark ? 0.28 : 0.14)
                      : alpha(theme.palette.background.paper, isDark ? 0.35 : 0.7),
                    border: `1px solid ${
                      selected
                        ? alpha('#4A7FD4', 0.7)
                        : alpha(theme.palette.divider, 0.6)
                    }`,
                    borderRadius: '12px',
                    color: 'inherit',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.45 : 1,
                    p: 1.25,
                    textAlign: 'left',
                  }}
                >
                  <Typography sx={{ fontWeight: 700 }}>{pack.label}</Typography>
                  <Typography sx={{ fontSize: '0.8rem', mt: 0.35, opacity: 0.8 }}>
                    {pack.description}
                  </Typography>
                  <Typography sx={{ fontSize: '0.75rem', mt: 0.5, opacity: 0.7 }}>
                    ~{formatBytes(pack.approxDownloadBytes)} to assemble
                  </Typography>
                </Box>
              );
            })}
          </Box>

          {packMeta && (
            <Typography sx={{ fontSize: '0.8rem', opacity: 0.75 }}>
              Selected kit ≈ {formatBytes(downloadEstimate || packMeta.approxDownloadBytes)}
              {manifest.licenses?.llm ? ` · ${manifest.licenses.llm}` : ''}
            </Typography>
          )}

          <Typography sx={{ fontSize: '0.75rem', opacity: 0.65, lineHeight: 1.4 }}>
            {QORTINO_SAFETY_DISCLAIMER}
          </Typography>
        </>
      )}

      {installing && progress && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
          <Typography sx={{ fontSize: '0.85rem' }}>
            {progress.label}
            {progress.fileCount > 0
              ? ` (${progress.fileIndex}/${progress.fileCount})`
              : ''}
          </Typography>
          <LinearProgress
            variant={progress.bytesTotal > 0 ? 'determinate' : 'indeterminate'}
            value={progressRatio * 100}
          />
          {progress.bytesTotal > 0 && (
            <Typography sx={{ fontSize: '0.75rem', opacity: 0.7 }}>
              {formatBytes(progress.bytesReceived)} / {formatBytes(progress.bytesTotal)}
            </Typography>
          )}
        </Box>
      )}

      {error && (
        <Typography sx={{ color: theme.palette.error.main, fontSize: '0.85rem' }}>
          {error}
        </Typography>
      )}

      <Box sx={{ display: 'flex', gap: 1, mt: 'auto', pt: 1 }}>
        <Button
          variant="outlined"
          onClick={() => {
            abortRef.current?.abort();
            onCancel();
          }}
          disabled={installing && progress?.phase === 'finalizing'}
        >
          {installing ? 'Cancel' : 'Not now'}
        </Button>
        <Button
          variant="contained"
          disabled={loading || installing || !manifest || blockPublicNode}
          onClick={() => {
            if (blockPublicNode) {
              notifyPublicNodeBlocked();
              return;
            }
            void startInstall();
          }}
          sx={{ flex: 1 }}
        >
          {installing
            ? 'Assembling…'
            : blockPublicNode
              ? 'Needs private node'
              : 'Assemble Qortino Agent'}
        </Button>
      </Box>
    </Box>
  );
}

export default QortinoAgentGate;
