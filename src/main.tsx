import { createRoot } from 'react-dom/client';
import {
  installCapacitorBridge,
  installReticulumBridges,
} from './bridge/capacitorBridge';
import { installMobileReticulumChat } from './reticulumChat/mobile';
import './utils/configureDomPurify';

// Install the Capacitor mobile-shell bridge before any feature module reads
// window.* (splash, hardware back; web-mode degradation otherwise).
installCapacitorBridge();
// Wire window.presence to the native Reticulum presence bridge so the account
// is visible online to Qortal peers (Phase 3a). No-op off-Capacitor.
installReticulumBridges();
// Install window.reticulumChat backed by the in-app chat engine worker so the
// mobile app runs the new Reticulum chat (no legacy). No-op off-Capacitor.
installMobileReticulumChat();
import App from './App.tsx';
import ErrorBoundary from './common/ErrorBoundary';
import RootCrashFallback from './common/RootCrashFallback';
import {
  installFatalErrorRecorder,
  recordFatalError,
} from './common/fatalErrorLog';
import '../src/styles/index.css';
import './messaging/MessagesToBackground.tsx';
import { MessageQueueProvider } from './messaging/MessageQueueContext.tsx';
import { ThemeProvider } from './components/Theme/ThemeContext.tsx';
import { CssBaseline } from '@mui/material';
import './i18n/i18n.js';
import ReticulumStatusChip from './components/Reticulum/ReticulumStatusChip.tsx';
import { prefetchAuthenticatedShell } from './components/App/LazyAuthenticatedShell.tsx';

function hideAppSplash() {
  const el = document.getElementById('app-splash');
  if (!el) return;
  el.classList.add('app-splash--hide');
  window.setTimeout(() => el.remove(), 420);
}

// Safety-net watchdog scheduled at module load (independent of React render):
// if anything stalls the normal reveal path, never leave the user staring at
// the branded splash. Cold boot on mid-range devices can be slow, so the
// timeout is generous; the normal requestAnimationFrame path below hides it
// much sooner on a healthy launch.
window.setTimeout(hideAppSplash, 8000);

installFatalErrorRecorder();

// React 18 unmounts the entire tree when a render error reaches the root, so
// without a boundary here any uncaught fault anywhere above the authenticated
// shell leaves the user staring at a blank page with no way back.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary
    fallback={({ error }) => <RootCrashFallback error={error} />}
    onCatch={(error, componentStack) =>
      recordFatalError('render', error, componentStack)
    }
  >
    <ThemeProvider>
      <CssBaseline />
      <MessageQueueProvider>
        <App />
        <ReticulumStatusChip />
      </MessageQueueProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

// Reveal the app once React has painted, keeping a short minimum so the
// branded intro doesn't flash. The native splash hides on its own timer.
requestAnimationFrame(() => {
  window.setTimeout(hideAppSplash, 650);
  prefetchAuthenticatedShell();
});
