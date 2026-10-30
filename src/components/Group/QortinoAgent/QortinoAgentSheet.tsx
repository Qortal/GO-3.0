import { Box, Dialog, IconButton, useTheme } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useAtomValue } from 'jotai';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { qortinoAgentParkedAtom } from '../../../atoms/global';
import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../../../utils/mobileSafeArea';
import {
  loadInstallState,
  saveInstallState,
  type QortinoInstallState,
} from '../../../qortinoAgent/store';
import { QortinoAgentGate } from './QortinoAgentGate';

const loadQortinoAgentChat = () => import('./QortinoAgentChat');
const QortinoAgentChat = lazy(loadQortinoAgentChat);

type Props = {
  open: boolean;
  onClose: () => void;
};

export function QortinoAgentSheet({ open, onClose }: Props) {
  const theme = useTheme();
  const parked = useAtomValue(qortinoAgentParkedAtom);
  const [ready, setReady] = useState(false);
  const [install, setInstall] = useState<QortinoInstallState>({ installed: false });
  /** Once the chat session has been assembled, keep it across park/restore. */
  const sessionReadyRef = useRef(false);
  const refreshGenRef = useRef(0);

  const refresh = useCallback(async () => {
    const gen = ++refreshGenRef.current;
    const state = await loadInstallState();
    if (gen !== refreshGenRef.current) return;

    setInstall(state);
    if (state.installed && state.llmPath) {
      void loadQortinoAgentChat().catch(() => undefined);
    }
    setReady(true);
    if (state.installed && state.llmPath) {
      sessionReadyRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // Park/restore: keep assembled chat + model without reloading.
    if (
      sessionReadyRef.current &&
      install.installed &&
      install.llmPath &&
      ready
    ) {
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

  const handleInstalled = useCallback((next: QortinoInstallState) => {
    setInstall(next);
    if (next.installed && next.llmPath) {
      void loadQortinoAgentChat().catch(() => undefined);
      sessionReadyRef.current = true;
    }
  }, []);

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

  const closeButton = (
    <IconButton
      aria-label="Close"
      onClick={() => void handleClose()}
      sx={{ position: 'absolute', right: 8, top: 8, zIndex: 2 }}
    >
      <CloseRoundedIcon />
    </IconButton>
  );

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
        {!ready ? (
          closeButton
        ) : install.installed && install.llmPath ? (
          <Suspense fallback={closeButton}>
            <QortinoAgentChat
              install={install}
              onClose={() => void handleClose()}
            />
          </Suspense>
        ) : (
          <QortinoAgentGate
            onInstalled={(next) => handleInstalled(next)}
            onCancel={() => void handleClose()}
          />
        )}
      </Box>
    </Dialog>
  );
}
