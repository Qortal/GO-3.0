/**
 * Dev-only preview of rearranging Home's windows on a phone: stand-in
 * windows as tall as the real ones, the real HomeWindowStack and the real
 * saved order (homeLayout). With a mouse, hold the button on a window's
 * background, then drag (mouse drags become touches here). For checks,
 * window.__drag(id, toY) runs a scripted long press + drag, and
 * window.__order() reads the saved order. Run `npm run dev` and open
 * /tools/preview/home-reorder.html. Not a build input.
 */
import { createRoot } from 'react-dom/client';
import { useState, type ReactElement } from 'react';
import { Box, Button, CssBaseline, Typography, useTheme } from '@mui/material';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import DynamicFeedRoundedIcon from '@mui/icons-material/DynamicFeedRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import MonitorHeartRoundedIcon from '@mui/icons-material/MonitorHeartRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import { ThemeProvider } from '../../src/components/Theme/ThemeContext';
import {
  HomeWindowStack,
  type HomeWindow,
} from '../../src/components/Group/HomeDesktop/HomeWindowStack';
import {
  type HomeWindowId,
  mergeVisibleWindowOrder,
  readHomeWindowOrder,
  useHomeWindowOrder,
  writeHomeWindowOrder,
} from '../../src/components/Group/HomeDesktop/homeLayout';
import { dashboardPanelSx } from '../../src/components/Group/dashboardPanelEffects';
import { HOME_WINDOW_ATTR } from '../../src/components/Group/HomeDesktop/HomeWindowStack';

const META: Record<HomeWindowId, { label: string; icon: ReactElement; height: number }> = {
  workspace: { label: 'Hotkeys and Qortino', icon: <AppsRoundedIcon />, height: 485 },
  account: { label: 'Account Overview', icon: <PersonRoundedIcon />, height: 282 },
  composer: { label: 'Post to Torq', icon: <EditRoundedIcon />, height: 91 },
  tools: { label: 'Quick tools', icon: <WidgetsRoundedIcon />, height: 164 },
  featured: { label: 'Featured Q-Apps', icon: <StarRoundedIcon />, height: 445 },
  status: { label: 'Status', icon: <MonitorHeartRoundedIcon />, height: 615 },
  wallet: { label: 'Wallet Activity', icon: <AccountBalanceWalletRoundedIcon />, height: 269 },
  groupActivity: { label: 'Group Activity', icon: <ForumRoundedIcon />, height: 612 },
  feed: { label: 'Torq Feed', icon: <DynamicFeedRoundedIcon />, height: 612 },
};

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
}, true);
window.addEventListener('mousemove', (e) => {
  if (dragging) touchFrom('touchmove', dragging, e.clientX, e.clientY);
});
window.addEventListener('mouseup', (e) => {
  if (dragging) touchFrom('touchend', dragging, e.clientX, e.clientY);
  dragging = null;
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
(window as any).__order = () => readHomeWindowOrder();
(window as any).__reset = () => writeHomeWindowOrder(null);
/** Long press the window `id` at its title, then drag to `toY`. */
(window as any).__drag = async (id: HomeWindowId, toY: number, pauseAt?: number) => {
  const target = document.querySelector(`[${HOME_WINDOW_ATTR}="${id}"] [data-title]`)!;
  const box = target.getBoundingClientRect();
  const x = box.left + 40;
  let y = box.top + box.height / 2;
  touchFrom('touchstart', target, x, y);
  await wait(500);
  const step = toY > y ? 24 : -24;
  while ((toY - y) * Math.sign(step) > 0) {
    y = step > 0 ? Math.min(toY, y + step) : Math.max(toY, y + step);
    touchFrom('touchmove', target, x, y);
    await wait(16);
    if (pauseAt != null && Math.abs(y - pauseAt) < 13) return 'paused';
  }
  await wait(120);
  touchFrom('touchend', target, x, y);
  return 'dropped';
};
(window as any).__release = (id: HomeWindowId) => {
  const target = document.querySelector(`[${HOME_WINDOW_ATTR}="${id}"] [data-title]`)!;
  touchFrom('touchend', target, 0, 0);
};

function StandIn({ id }: { id: HomeWindowId }) {
  const theme = useTheme();
  const meta = META[id];
  return (
    <Box sx={{ ...dashboardPanelSx(theme, 'base'), borderRadius: '18px', height: meta.height, p: 2 }}>
      <Typography data-title sx={{ fontWeight: 800, mb: 1 }}>
        {meta.label}
      </Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
        Long press here (not on the button), then drag.
      </Typography>
      <Button size="small" sx={{ mt: 1 }} variant="outlined">
        A button
      </Button>
    </Box>
  );
}

function Preview() {
  const order = useHomeWindowOrder();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const windows: HomeWindow[] = order.map((id) => ({
    id,
    icon: META[id].icon,
    label: META[id].label,
    node: <StandIn id={id} />,
  }));
  return (
    <Box sx={{ bgcolor: 'background.default', height: '100dvh' }}>
      <Box sx={{ alignItems: 'center', bgcolor: 'background.paper', display: 'flex', height: 52, px: 2 }}>
        <Typography sx={{ fontWeight: 800 }}>Top bar</Typography>
      </Box>
      <Box ref={setScroller} sx={{ height: 'calc(100dvh - 52px)', overflowY: 'auto', px: '12px', py: '20px' }}>
        <HomeWindowStack
          gap={20}
          onReorder={(visible) =>
            writeHomeWindowOrder(mergeVisibleWindowOrder(readHomeWindowOrder(), visible))
          }
          scroller={scroller}
          windows={windows}
        />
        <Box sx={{ height: 120 }} />
      </Box>
    </Box>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
