/**
 * Phone-framed Qortino chat for PC debugging (open qortino-debug.html).
 * Uses the real chat UI; answers via web debug LLM / Ollama.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, TextField, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Provider as JotaiProvider } from 'jotai';
import { QORTAL_APP_CONTEXT } from '../../../context/AppContext';
import type { AppContextInterface } from '../../../context/AppContext';
import { handleSetGlobalApikey } from '../../../utils/globalApi';
import type { QortinoInstallState } from '../../../qortinoAgent/store';
import { QortinoAgentChat } from './QortinoAgentChat';

const DEBUG_INSTALL: QortinoInstallState = {
  installed: true,
  modelId: 'web-debug',
  llmPath: 'web-debug',
  installedAt: Date.now(),
  lastOpenedAt: Date.now(),
};

const DEFAULT_NODE =
  (typeof localStorage !== 'undefined' &&
    localStorage.getItem('qortino_debug_node')) ||
  'https://ext-node.qortal.link';

export function QortinoDebugPage() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [nodeUrl, setNodeUrl] = useState(DEFAULT_NODE);
  const [appliedNode, setAppliedNode] = useState(DEFAULT_NODE);
  const [chatKey, setChatKey] = useState(0);

  const applyNode = useCallback(() => {
    const cleaned = nodeUrl.trim().replace(/\/$/, '');
    localStorage.setItem('qortino_debug_node', cleaned);
    handleSetGlobalApikey({ url: cleaned, apikey: '' });
    setAppliedNode(cleaned);
    setChatKey((k) => k + 1);
  }, [nodeUrl]);

  useEffect(() => {
    handleSetGlobalApikey({ url: appliedNode, apikey: '' });
  }, [appliedNode]);

  const appContext = useMemo(
    () =>
      ({
        downloadResource: () => undefined,
        show: false,
        showInfo: false,
        onOk: () => undefined,
        onCancel: () => undefined,
        getIndividualUserInfo: async () => null,
      }) as unknown as AppContextInterface,
    []
  );

  return (
    <QORTAL_APP_CONTEXT.Provider value={appContext}>
      <JotaiProvider>
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            py: 2.5,
            px: 2,
            background: isDark
              ? 'radial-gradient(120% 80% at 50% 0%, #1a2438 0%, #0b0e14 55%)'
              : 'radial-gradient(120% 80% at 50% 0%, #dce7f5 0%, #eef2f7 55%)',
          }}
        >
          <Box sx={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.15rem' }}>
              Qortino PC debug
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.primary, 0.65),
                fontSize: '0.82rem',
                mt: 0.4,
              }}
            >
              Mobile-sized chat · answers via Ollama (if running) or a grounded
              debug brain
            </Typography>
          </Box>

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
              justifyContent: 'center',
              width: 'min(420px, 100%)',
            }}
          >
            <TextField
              size="small"
              label="QDN node"
              value={nodeUrl}
              onChange={(e) => setNodeUrl(e.target.value)}
              sx={{ flex: 1, minWidth: 220 }}
            />
            <Button variant="contained" onClick={applyNode}>
              Apply
            </Button>
          </Box>

          {/* Phone chrome */}
          <Box
            sx={{
              background: '#111',
              borderRadius: '36px',
              boxShadow: `0 24px 60px ${alpha('#000', 0.45)}`,
              p: '12px',
              width: 390,
              maxWidth: '100%',
            }}
          >
            <Box
              sx={{
                background: isDark ? '#0c0e13' : '#f4f7fb',
                borderRadius: '28px',
                height: 780,
                maxHeight: 'min(780px, calc(100vh - 180px))',
                overflow: 'hidden',
                position: 'relative',
                width: '100%',
              }}
            >
              {/* notch */}
              <Box
                sx={{
                  background: '#111',
                  borderRadius: '0 0 14px 14px',
                  height: 22,
                  left: '50%',
                  position: 'absolute',
                  top: 0,
                  transform: 'translateX(-50%)',
                  width: 120,
                  zIndex: 5,
                }}
              />
              <Box sx={{ height: '100%', pt: '10px' }}>
                <QortinoAgentChat
                  key={chatKey}
                  install={DEBUG_INSTALL}
                  onClose={() => {
                    window.location.href = './';
                  }}
                  // Nothing to delete on a PC: start the chat over.
                  onRemoved={() => setChatKey((key) => key + 1)}
                />
              </Box>
            </Box>
          </Box>

          <Typography
            sx={{
              color: alpha(theme.palette.text.primary, 0.5),
              fontSize: '0.75rem',
              maxWidth: 420,
              textAlign: 'center',
            }}
          >
            Console logs show the full prompts.
          </Typography>
        </Box>
      </JotaiProvider>
    </QORTAL_APP_CONTEXT.Provider>
  );
}
