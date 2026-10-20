import { createRoot } from 'react-dom/client';
import { PerfProfiler } from './utils/perfProfiler';
import {
  installCapacitorBridge,
  installReticulumBridges,
} from './bridge/capacitorBridge';
import { installMobileReticulumChat } from './reticulumChat/mobile';
import './utils/configureDomPurify';
import { installIdleAnimationPause } from './utils/idleAnimationPause';
import { installGoLayout, isGoLayout } from './layout/goLayout';
import { isGoApp } from './utils/platform';

// Install the Capacitor mobile-shell bridge before any feature module reads
// window.* (splash, hardware back; web-mode degradation otherwise).
installCapacitorBridge();
// Wire window.presence to the native Reticulum presence bridge so the account
// is visible online to Qortal peers (Phase 3a). No-op off-Capacitor.
installReticulumBridges();
// Install window.reticulumChat backed by the in-app chat engine worker so the
// mobile app runs the new Reticulum chat (no legacy). No-op off-Capacitor.
installMobileReticulumChat();
// Freeze decorative CSS loops after 10 s without input; on-device they cost
// ~half a CPU core for as long as the screen is on. No-op off-Capacitor.
installIdleAnimationPause();
// Keyboard-proof layout signals and the <html data-go-*> attributes, written
// before the first paint so CSS sees them from the start. No-op off GO.
installGoLayout();
import App from './App.tsx';
import ErrorBoundary from './common/ErrorBoundary';
import RootCrashFallback from './common/RootCrashFallback';
import {
  installFatalErrorRecorder,
  recordFatalError,
} from './common/fatalErrorLog';
import { rootErrorHooks } from './common/rootErrorHooks';
import '../src/styles/index.css';
import './styles/goLayout.css';
import './messaging/MessagesToBackground.tsx';
import { MessageQueueProvider } from './messaging/MessageQueueContext.tsx';
import { ThemeProvider } from './components/Theme/ThemeContext.tsx';
import { CssBaseline } from '@mui/material';
import './i18n/i18n.js';
import ReticulumStatusChip from './components/Reticulum/ReticulumStatusChip.tsx';
import { SystemBarAppearanceSync } from './components/Mobile/SystemBarAppearanceSync';
import { prefetchAuthenticatedShell } from './components/App/LazyAuthenticatedShell.tsx';
import { preloadQdnAvatars } from './lib/qdnAvatars';

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

// The themes read isGoLayout() at import time, before the Capacitor bridge is
// installed. If that early answer ever disagrees with isGoApp(), GO would run
// with Hub breakpoints (or the reverse), so leave a trace for diagnostics.
if (!import.meta.env.DEV && isGoLayout() !== isGoApp()) {
  recordFatalError('error', new Error('GO layout detection mismatch'));
}

// Open the avatar cache now, so the most used avatars are in memory by the
// first frame that shows them (instead of a letter, then the picture).
void preloadQdnAvatars();

// React 18 unmounts the entire tree when a render error reaches the root, so
// without a boundary here any uncaught fault anywhere above the authenticated
// shell leaves the user staring at a blank page with no way back.
// rootErrorHooks keep a scrubbed record of every render error for Copy
// diagnostics (caught, uncaught, and the ones React redrew past).
createRoot(document.getElementById('root')!, rootErrorHooks).render(
  <ErrorBoundary
    name="root"
    fallback={({ error }) => <RootCrashFallback error={error} />}
    onCatch={(error, componentStack) =>
      recordFatalError('render', error, componentStack)
    }
  >
    <ThemeProvider>
      <CssBaseline />
      <SystemBarAppearanceSync />
      <MessageQueueProvider>
        <PerfProfiler id="root">
          <App />
        </PerfProfiler>
        <ReticulumStatusChip />
      </MessageQueueProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

// The whole bundle loaded and ran: public/boot-guard.js can stand down.
(window as Window & { __goBootDone?: () => void }).__goBootDone?.();

// Reveal the app once React has painted, keeping a short minimum so the
// branded intro doesn't flash. The native splash hides on its own timer.
requestAnimationFrame(() => {
  window.setTimeout(hideAppSplash, 650);
  prefetchAuthenticatedShell();
});
