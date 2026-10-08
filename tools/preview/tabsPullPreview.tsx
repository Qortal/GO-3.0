/**
 * Dev-only preview of pulling the Tabs window down from the top of a list:
 * a stand-in Home section (a list), the real Tabs overlay with made-up open
 * tabs, and the real pull (tabsPull). With a mouse, drag down from the top
 * of the list (mouse drags are turned into touches here); window.__pull(y)
 * runs a scripted pull to `y` px for checks. Run `npm run dev` and open
 * /tools/preview/tabs-pull.html. Not a build input.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, CssBaseline, Typography } from '@mui/material';
import { getDefaultStore } from 'jotai';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import { ThemeProvider } from '../../src/components/Theme/ThemeContext';
import { userInfoAtom } from '../../src/atoms/global';
import { mobileTabOrganizationStateAtom } from '../../src/components/Mobile/mobileTabOrganizationStore';
import { emptyOrganization } from '../../src/components/Mobile/mobileTabOrganization';
import { MobileTabsOverlay } from '../../src/components/Mobile/MobileTabsOverlay';
import { useTabsPullDown } from '../../src/components/Mobile/tabsPull';
import { SECTION_ATTR } from '../../src/components/Mobile/sectionSwipe/sectionSwipe';
import { executeEvent } from '../../src/utils/events';

const WALLET = 'QpreviewWallet';
const store = getDefaultStore();
store.set(userInfoAtom, { address: WALLET, name: 'preview' } as never);
store.set(mobileTabOrganizationStateAtom, {
  walletAddress: WALLET,
  organization: emptyOrganization(),
  ready: true,
});
const openTabs = ['Q-Tube', 'Torq', 'Q-Mail', 'Q-Wallets', 'Quitter'].map(
  (name, index) => ({ tabId: `t${index}`, service: 'APP', name, label: name })
);
const broadcast = () =>
  executeEvent('setTabsToNav', {
    data: { tabs: openTabs, selectedTab: openTabs[1] },
  });

const log: string[] = [];
(window as any).__pullLog = log;

/** Mouse drags as touches, for a desktop browser. */
const touchFrom = (type: string, target: EventTarget, x: number, y: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y, target };
  Object.defineProperty(event, 'touches', {
    value: type === 'touchend' ? [] : [point],
  });
  Object.defineProperty(event, 'changedTouches', { value: [point] });
  target.dispatchEvent(event);
};
let dragging: EventTarget | null = null;
window.addEventListener('mousedown', (e) => {
  dragging = e.target;
  touchFrom('touchstart', e.target!, e.clientX, e.clientY);
});
window.addEventListener('mousemove', (e) => {
  if (dragging) touchFrom('touchmove', dragging, e.clientX, e.clientY);
});
window.addEventListener('mouseup', (e) => {
  if (dragging) touchFrom('touchend', dragging, e.clientX, e.clientY);
  dragging = null;
});

/** A scripted pull from the top of the list to `y`, 30px per frame. */
(window as any).__pull = async (toY: number, restMs = 150) => {
  const row = document.querySelector('[data-testid="row-0"]')!;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  touchFrom('touchstart', row, 200, 120);
  for (let y = 120; y <= toY; y += 30) {
    await frame();
    touchFrom('touchmove', row, 201, y);
  }
  await new Promise((r) => setTimeout(r, restMs));
  touchFrom('touchend', row, 201, toY);
};

function Preview() {
  const [open, setOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  useEffect(() => {
    const timer = setTimeout(broadcast, 50);
    return () => clearTimeout(timer);
  }, []);
  useTabsPullDown({
    enabled: true,
    canStart: !open,
    sections: ['home'],
    onPullStart: () => {
      log.push('start');
      setPulling(true);
      setOpen(true);
    },
    onPullEnd: (stays) => {
      log.push(stays ? 'open' : 'closed');
      setPulling(false);
      if (!stays) setOpen(false);
    },
  });
  return (
    <Box sx={{ bgcolor: 'background.default', height: '100dvh' }}>
      <Box
        sx={{
          alignItems: 'center',
          bgcolor: 'background.paper',
          display: 'flex',
          height: 52,
          position: 'relative',
          px: 2,
          zIndex: open ? 2001 : 1,
        }}
      >
        <Typography sx={{ fontWeight: 800 }}>Top bar (Tabs {open ? 'open' : 'closed'})</Typography>
      </Box>
      <Box
        {...{ [SECTION_ATTR]: 'home' }}
        sx={{ height: 'calc(100dvh - 52px)', overflowY: 'auto' }}
      >
        {Array.from({ length: 40 }, (_, i) => (
          <Box
            key={i}
            data-testid={`row-${i}`}
            sx={{ borderBottom: 1, borderColor: 'divider', p: 2 }}
          >
            Home row {i + 1}
          </Box>
        ))}
      </Box>
      <MobileTabsOverlay
        open={open}
        pulling={pulling}
        onClose={() => setOpen(false)}
      />
    </Box>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
