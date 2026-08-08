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
import '../src/styles/index.css';
import './messaging/MessagesToBackground.tsx';
import { MessageQueueProvider } from './messaging/MessageQueueContext.tsx';
import { ThemeProvider } from './components/Theme/ThemeContext.tsx';
import { CssBaseline } from '@mui/material';
import './i18n/i18n.js';
import ReticulumStatusChip from './components/Reticulum/ReticulumStatusChip.tsx';

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

createRoot(document.getElementById('root')!).render(
  <>
    <ThemeProvider>
      <CssBaseline />
      <MessageQueueProvider>
        <App />
        <ReticulumStatusChip />
      </MessageQueueProvider>
    </ThemeProvider>
  </>
);

// Reveal the app once React has painted, keeping a short minimum so the
// branded intro doesn't flash. The native splash hides on its own timer.
requestAnimationFrame(() => {
  window.setTimeout(hideAppSplash, 650);
});
