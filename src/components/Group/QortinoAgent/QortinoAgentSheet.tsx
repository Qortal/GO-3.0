import { Box, Dialog, IconButton, useTheme } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { qortinoAgentParkedAtom } from '../../../atoms/global';
import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../../../utils/mobileSafeArea';
import {
  BUILTIN_SAMPLE_KNOWLEDGE,
  fetchQortinoManifest,
  loadKnowledgeFromInstall,
} from '../../../qortinoAgent/download';
import type { QortinoAgentManifest } from '../../../qortinoAgent/manifest';
import {
  defaultRuntimeCache,
  loadInstallState,
  saveInstallState,
  setRuntimeCache,
  type QortinoInstallState,
} from '../../../qortinoAgent/store';
import { QortinoAgentChat } from './QortinoAgentChat';
import { QortinoAgentGate } from './QortinoAgentGate';

type Props = {
  open: boolean;
  onClose: () => void;
};

export function QortinoAgentSheet({ open, onClose }: Props) {
  const theme = useTheme();
  const parked = useAtomValue(qortinoAgentParkedAtom);
  const [ready, setReady] = useState(false);
  const [install, setInstall] = useState<QortinoInstallState>({ installed: false });
  const [manifest, setManifest] = useState<QortinoAgentManifest | null>(null);
  /** Once the chat session has been assembled, keep it across park/restore. */
  const sessionReadyRef = useRef(false);
  const refreshGenRef = useRef(0);

  const refresh = useCallback(async () => {
    const gen = ++refreshGenRef.current;
    const [state, m] = await Promise.all([
      loadInstallState(),
      // Opening the sheet must not wait on QDN — identifier resolution keeps
      // running in the background and the gate picks up the result.
      fetchQortinoManifest({ timeoutMs: 2500 }),
    ]);
    if (gen !== refreshGenRef.current) return;

    setInstall(state);
    setManifest(m);
    const knowledge =
      (state.installed ? await loadKnowledgeFromInstall(state) : null) ||
      BUILTIN_SAMPLE_KNOWLEDGE;
    if (gen !== refreshGenRef.current) return;

    setRuntimeCache({
      ...defaultRuntimeCache(state),
      manifest: m,
      knowledge,
    });
    setReady(true);
    if (state.installed && state.llmPath) {
      sessionReadyRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // Park/restore: keep assembled chat + model without reloading.
    if (sessionReadyRef.current && install.installed && install.llmPath && ready && manifest) {
      return;
    }
    let cancelled = false;
    setReady(false);
    void refresh().finally(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
    // Intentionally only react to `open` — including ready/install here caused an
    // infinite remount loop (Gate ↔ loading) and AUTHENTICATE spam from Chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [open, refresh]);

  const handleInstalled = useCallback(
    async (next: QortinoInstallState, m: QortinoAgentManifest) => {
      setInstall(next);
      setManifest(m);
      const knowledge =
        (await loadKnowledgeFromInstall(next)) || BUILTIN_SAMPLE_KNOWLEDGE;
      setRuntimeCache({
        ...defaultRuntimeCache(next),
        manifest: m,
        knowledge,
      });
      if (next.installed && next.llmPath) {
        sessionReadyRef.current = true;
      }
    },
    []
  );

  const handleClose = useCallback(async () => {
    if (install.installed) {
      const next = { ...install, lastOpenedAt: Date.now() };
      await saveInstallState(next);
      setInstall(next);
    }
    onClose();
  }, [install, onClose]);

  // keepMounted while open OR parked so chat history + loaded model survive Q-App hops.
  const keepAlive = open || parked;

  return (
    <Dialog
      fullScreen
      open={open}
      keepMounted={keepAlive}
      onClose={() => void handleClose()}
      PaperProps={{
        sx: {
          background: theme.palette.mode === 'dark' ? '#0c0e13' : '#f4f7fb',
          // Keep the sheet below the status bar / notch.
          pt: SAFE_AREA_TOP,
          pb: SAFE_AREA_BOTTOM,
          boxSizing: 'border-box',
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          position: 'relative',
        }}
      >
        {!ready || !manifest ? (
          <IconButton
            aria-label="Close"
            onClick={() => void handleClose()}
            sx={{ position: 'absolute', right: 8, top: 8, zIndex: 2 }}
          >
            <CloseRoundedIcon />
          </IconButton>
        ) : install.installed && install.llmPath ? (
          <QortinoAgentChat
            install={install}
            onClose={() => void handleClose()}
          />
        ) : (
          <QortinoAgentGate
            onInstalled={(next, m) => void handleInstalled(next, m)}
            onCancel={() => void handleClose()}
          />
        )}
      </Box>
    </Dialog>
  );
}

export default QortinoAgentSheet;
