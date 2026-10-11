/**
 * Dev-only pretend Q-App for publish-window.html: a plain MUI app that covers
 * itself with a qapp-core style "Publishing Status" window while it
 * publishes, like Q-Share or Q-Tube do. It runs GO's frame helper the way GO
 * installs it natively (allowed on this page's own origin), so the preview
 * shows the app's window being taken off the screen and handed back.
 * Not a build input, so it never ships.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AppBar,
  Box,
  Button,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  ThemeProvider,
  Toolbar,
  Typography,
  createTheme,
} from '@mui/material';
import { buildQappPublishUiScript } from '../../src/utils/qappPublishUi';

new Function(
  buildQappPublishUiScript(window.parent.location.origin, {
    allowSameOrigin: true,
  })
)();

type Result = 'ok' | 'failed' | null;

const App = () => {
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [percent, setPercent] = useState(0);
  const [taps, setTaps] = useState(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { preview?: string; percent?: number };
      if (data?.preview === 'progress') setPercent(data.percent ?? 0);
      if (data?.preview === 'done') {
        // Like qapp-core: closes itself when everything went up, keeps the
        // window (with Retry) when something failed.
        setResult('ok');
        setPublishing(false);
      }
      if (data?.preview === 'failed') setResult('failed');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const publish = (kind: string) => {
    setResult(null);
    setPercent(0);
    setPublishing(true);
    window.parent.postMessage({ preview: 'publish', kind }, '*');
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6fb' }}>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: '#1e88e5' }}>
        <Toolbar variant="dense">
          <Typography sx={{ fontWeight: 800, flex: 1 }}>Q-Share</Typography>
          <Typography variant="caption">taps: {taps}</Typography>
        </Toolbar>
      </AppBar>
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <TextField size="small" label="Search shares" />
        <Button variant="contained" onClick={() => publish('video')}>
          Publish holiday.mp4 (180 MB)
        </Button>
        <Button variant="outlined" onClick={() => publish('fail')}>
          Publish (fails on the 2nd file)
        </Button>
        <Button variant="outlined" onClick={() => publish('small')}>
          Publish small and slow
        </Button>
        <List dense sx={{ bgcolor: 'white', borderRadius: 2 }}>
          {Array.from({ length: 30 }, (_, i) => (
            <ListItemButton key={i} onClick={() => setTaps((n) => n + 1)}>
              <ListItemText
                primary={`Shared file ${i + 1}`}
                secondary="Tap me while publishing"
              />
            </ListItemButton>
          ))}
        </List>
      </Box>
      <Dialog
        open={publishing}
        fullWidth
        maxWidth="sm"
        sx={{ zIndex: 999990 }}
        disableEnforceFocus
        disableAutoFocus
        disableRestoreFocus
      >
        <DialogTitle>Publishing Status</DialogTitle>
        <DialogContent>
          <Typography variant="subtitle1" fontWeight="bold">
            holiday.mp4
          </Typography>
          <Typography variant="body2" gutterBottom>
            File chunk ({percent}%)
          </Typography>
          <LinearProgress variant="determinate" value={percent} />
          {result === 'failed' ? (
            <Typography color="error" sx={{ mt: 2 }}>
              Publish failed - Not enough QORT
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button
            color="error"
            variant="contained"
            disabled={result !== 'failed'}
            onClick={() => setPublishing(false)}
          >
            Close
          </Button>
          {result === 'failed' ? (
            <Button color="success" variant="contained">
              Retry
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

createRoot(document.getElementById('root')!).render(
  <ThemeProvider theme={createTheme()}>
    <CssBaseline />
    <App />
  </ThemeProvider>
);
