/**
 * Dev-only preview of closing the open Tabs window with a swipe up: the real
 * Tabs overlay with a long list of made-up open tabs (add ?tabs=4 for a short
 * one). A small swipe on the list scrolls it, a big one closes the window.
 * Mouse drags are turned into touches here; window.__swipe(fromY, toY, opts)
 * runs a scripted swipe for checks and resolves with what happened. Run
 * `npm run dev` and open /tools/preview/tabs-swipe-close.html. Not a build
 * input.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Button, CssBaseline, Typography } from '@mui/material';
import { getDefaultStore } from 'jotai';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import { ThemeProvider } from '../../src/components/Theme/ThemeContext';
import { userInfoAtom } from '../../src/atoms/global';
import { mobileTabOrganizationStateAtom } from '../../src/components/Mobile/mobileTabOrganizationStore';
import { emptyOrganization } from '../../src/components/Mobile/mobileTabOrganization';
import { MobileTabsOverlay } from '../../src/components/Mobile/MobileTabsOverlay';
import { executeEvent } from '../../src/utils/events';

const WALLET = 'QpreviewWallet';
const store = getDefaultStore();
store.set(userInfoAtom, { address: WALLET, name: 'preview' } as never);
store.set(mobileTabOrganizationStateAtom, {
  walletAddress: WALLET,
  organization: emptyOrganization(),
  ready: true,
});
const tabCount = Number(new URLSearchParams(location.search).get('tabs')) || 16;
const names = [
  'Q-Tube', 'Torq', 'Q-Mail', 'Q-Wallets', 'Quitter', 'Q-Share', 'Q-Blog',
  'Q-Trade', 'Q-Fund', 'Q-Notes', 'Q-Music', 'Q-Store', 'Q-Files', 'Q-Play',
  'Q-Calc', 'Q-Keys', 'Q-Maps', 'Q-Shop', 'Q-Stats', 'Q-Pay',
];
const openTabs = names.slice(0, tabCount).map((name, index) => ({
  tabId: `t${index}`,
  service: 'APP',
  name,
  label: name,
}));
const broadcast = () =>
  executeEvent('setTabsToNav', {
    data: { tabs: openTabs, selectedTab: openTabs[1] },
  });

const log: string[] = [];
(window as any).__log = log;

/** Touch events from (x, y) on `target`; timeStamp is the real clock. */
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

// Fixed 16ms steps, not animation frames: a hidden preview pane runs those
// at one a second.
const frame = () => new Promise((r) => setTimeout(r, 16));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The Tabs list: the scroller around the cards. */
const list = (): HTMLElement | null => {
  let el = document.querySelector<HTMLElement>('[data-overlay-card]');
  while (el && getComputedStyle(el).overflowY !== 'auto') el = el.parentElement;
  return el;
};

/**
 * A scripted swipe at x=`x` from `fromY` to `toY`, `step` px per frame, a
 * `restMs` rest before the lift (0: lifts while still moving). Resolves once
 * things settle with the list's scroll before/at lift/after and whether the
 * window closed.
 */
(window as any).__swipe = async (
  fromY: number,
  toY: number,
  { step = 25, restMs = 0, x = 120 } = {}
) => {
  const target = document.elementFromPoint(x, fromY)!;
  const scroller = list();
  const before = scroller?.scrollTop ?? null;
  const closesBefore = log.filter((l) => l === 'closed').length;
  touchFrom('touchstart', target, x, fromY);
  const direction = Math.sign(toY - fromY);
  let y = fromY;
  while ((toY - y) * direction > 0) {
    await frame();
    y = direction > 0 ? Math.min(toY, y + step) : Math.max(toY, y - step);
    touchFrom('touchmove', target, x, y);
  }
  await frame();
  if (restMs) await wait(restMs);
  const atLift = scroller?.scrollTop ?? null;
  const panelTransform = (
    document.querySelector('[aria-label="Close tabs"]')
      ?.previousElementSibling as HTMLElement | null
  )?.style.transform;
  touchFrom('touchend', target, x, restMs ? toY : toY + (direction * step) / 3);
  await wait(1500);
  return {
    target: target.tagName + (target.getAttribute('data-overlay-card') !== null ? '[card]' : ''),
    before,
    atLift,
    after: scroller?.scrollTop ?? null,
    panelTransformAtLift: panelTransform,
    closed: log.filter((l) => l === 'closed').length > closesBefore,
  };
};

function Preview() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    // Again later: the overlay may not be listening yet at first.
    const timers = [50, 600].map((ms) => setTimeout(broadcast, ms));
    return () => timers.forEach(clearTimeout);
  }, []);
  (window as any).__open = () => setOpen(true);
  return (
    <Box sx={{ bgcolor: 'background.default', height: '100dvh' }}>
      <Box
        sx={{
          alignItems: 'center',
          bgcolor: 'background.paper',
          display: 'flex',
          gap: 1,
          height: 52,
          position: 'relative',
          px: 2,
          zIndex: 2001,
        }}
      >
        <Typography sx={{ flex: 1, fontWeight: 800 }}>
          Tabs {open ? 'open' : 'closed'}
        </Typography>
        <Button size="small" onClick={() => setOpen(true)}>
          Open
        </Button>
      </Box>
      <Box sx={{ p: 2 }}>
        {Array.from({ length: 30 }, (_, i) => (
          <Typography key={i}>App behind, row {i + 1}</Typography>
        ))}
      </Box>
      <MobileTabsOverlay
        open={open}
        onClose={() => {
          log.push('closed');
          setOpen(false);
        }}
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
