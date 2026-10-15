/**
 * Dev-only preview of the Q-Apps library's Pinned home (phone-style folders,
 * open folder animation, tab cards) and the Tabs overlay, with made-up
 * folders and open tabs. Opening an app only logs. Run `npm run dev` and open
 * /tools/preview/pinned-home.html (add ?overlay=1 for the Tabs overlay,
 * ?devmode=1 for the Dev Mode button: the page then passes for the Android
 * app, without its native side, so a picked zip ends in the build error).
 * Not a build input, so it never ships.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Button, CssBaseline, Stack } from '@mui/material';
import { getDefaultStore } from 'jotai';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { userInfoAtom } from '../../src/atoms/global';
import { mobileTabOrganizationStateAtom } from '../../src/components/Mobile/mobileTabOrganizationStore';
import {
  emptyOrganization,
  type MobileTabOrganization,
} from '../../src/components/Mobile/mobileTabOrganization';
import { PinnedHome } from '../../src/components/Mobile/tabsHome/PinnedHome';
import {
  AppsTabs,
  type AppsLibraryTabValue,
} from '../../src/components/Apps/AppsLibrary';
import { MobileTabsOverlay } from '../../src/components/Mobile/MobileTabsOverlay';
import { executeEvent, subscribeToEvent } from '../../src/utils/events';
import { goDevModeEnabledAtom } from '../../src/components/Mobile/devMode/devModeApp';

const WALLET = 'QpreviewWallet';
const store = getDefaultStore();
if (new URLSearchParams(location.search).has('devmode')) {
  (window as unknown as { androidBridge?: unknown }).androidBridge = {
    postMessage: () => undefined,
  };
  store.set(goDevModeEnabledAtom, true);
}
store.set(userInfoAtom, { address: WALLET, name: 'preview' } as never);

const apps = (names: string[]) =>
  names.map((name) => ({ key: `APP|${name}`, name }));

const folderSpec: {
  id: string;
  name: string;
  size?: 'small';
  apps: string[];
}[] = [
  {
    id: 'f-ai',
    name: 'AI',
    size: 'small',
    apps: ['Qortino', 'Q-Assist', 'Brain', 'Chip'],
  },
  {
    id: 'f-money',
    name: 'Money',
    size: 'small',
    apps: [
      'Q-Wallets',
      'Q-Trade',
      'Q-Fund',
      'Q-Bank',
      'Q-Pay',
      'Q-Coin',
      'Q-Shop',
      'Q-Mint',
      'Q-Stats',
    ],
  },
  {
    id: 'f-tools',
    name: 'Tools',
    apps: [
      'Q-Files',
      'Q-Notes',
      'Q-Store',
      'Q-Droid',
      'Q-Play',
      'Q-Folder',
      'Q-VPN',
      'Q-Calc',
      'Q-Music',
      'Q-Keys',
      'Q-Compass',
    ],
  },
  {
    id: 'f-travel',
    name: 'Travel',
    apps: [
      'Q-Map',
      'Q-Pin',
      'Q-Ride',
      'Q-Route',
      'Q-Train',
      'Q-Grab',
      'Q-Bolt',
      'Q-Fly',
      'Q-Sale',
      'Q-Air',
      'Q-Kiwi',
    ],
  },
  {
    id: 'f-social',
    name: 'Social',
    apps: ['Q-Mail', 'Q-Tube', 'Q-Chat', 'Q-Blog', 'Quitter', 'Q-Video'],
  },
  {
    id: 'f-utility',
    name: 'Utility',
    apps: ['Q-Brave', 'Q-Spark', 'Qortal Hub', 'Q-Mush', 'Q-Up'],
  },
  {
    id: 'f-devices',
    name: 'Devices',
    size: 'small',
    apps: [
      'Q-Router',
      'Q-Home',
      'Q-Node',
      'Q-Cloud',
      'Q-Term',
      'Q-Pad',
      'Q-Shell',
    ],
  },
];

const organization: MobileTabOrganization = {
  ...emptyOrganization(),
  folders: folderSpec.map((spec, index) => ({
    id: spec.id,
    name: spec.name,
    tabKeys: apps(spec.apps).map((app) => app.key),
    order: index,
    row: 0,
    size: spec.size,
  })),
  tabFolderMap: Object.fromEntries(
    folderSpec.flatMap((spec) =>
      apps(spec.apps).map((app) => [app.key, spec.id])
    )
  ),
  savedTabs: Object.fromEntries(
    folderSpec.flatMap((spec) =>
      apps(spec.apps).map((app) => [
        app.key,
        { service: 'APP', name: app.name, label: app.name },
      ])
    )
  ),
};
store.set(mobileTabOrganizationStateAtom, {
  walletAddress: WALLET,
  organization,
  ready: true,
});

let openTabs = [
  { tabId: 't1', service: 'APP', name: 'Q-Tube', label: 'Q-Tube' },
  { tabId: 't2', service: 'WEBSITE', name: 'Torq', label: 'Torq' },
  { tabId: 't3', service: 'APP', name: 'Q-Mail', label: 'Q-Mail' },
  { tabId: 't4', service: 'APP', name: 'Q-Wallets', label: 'Q-Wallets' },
  { tabId: 't5', service: 'APP', name: 'Quitter', label: 'Quitter' },
  {
    tabId: 't6',
    service: 'APP',
    name: 'Q-Tube',
    label: 'Q-Tube',
    path: '/video/qortal-intro',
  },
  {
    tabId: 't7',
    service: 'APP',
    name: 'Q-Tube',
    label: 'Q-Tube',
    path: '/channel/crowetic',
  },
];
let selected = openTabs[1];
const broadcast = () =>
  executeEvent('setTabsToNav', {
    data: { tabs: openTabs, selectedTab: selected },
  });

subscribeToEvent('removeTab', (event: CustomEvent) => {
  openTabs = openTabs.filter((tab) => tab.tabId !== event.detail?.data?.tabId);
  broadcast();
});
subscribeToEvent('closeAllTabs', () => {
  openTabs = [];
  broadcast();
});
subscribeToEvent('setSelectedTab', (event: CustomEvent) => {
  selected = event.detail?.data;
  console.log('[preview] select tab', selected?.name);
  broadcast();
});
subscribeToEvent('addTab', (event: CustomEvent) => {
  console.log('[preview] open app', event.detail?.data?.name);
});

function Preview() {
  const { toggleTheme } = useThemeContext();
  const overlay = new URLSearchParams(location.search).has('overlay');
  const [overlayOpen, setOverlayOpen] = useState(overlay);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [libraryTab, setLibraryTab] = useState<AppsLibraryTabValue>('pinned');
  useEffect(() => {
    const timer = setTimeout(broadcast, 50);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Box
      sx={{
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ flexShrink: 0, height: 52, p: 1 }}
      >
        <Button size="small" variant="outlined" onClick={toggleTheme}>
          theme
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={() => setOverlayOpen((v) => !v)}
        >
          tabs overlay
        </Button>
        <Button size="small" variant="outlined" onClick={broadcast}>
          refresh tabs
        </Button>
      </Stack>
      <Box
        ref={setScroller}
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, pb: 4 }}
      >
        <Box sx={{ mb: 2, mt: 1 }}>
          <AppsTabs
            currentTab={libraryTab}
            isMobile
            onTabChange={setLibraryTab}
          />
        </Box>
        <PinnedHome
          isVisible
          onBrowseApps={() => console.log('[preview] browse apps')}
          scrollParent={scroller}
        />
      </Box>
      <MobileTabsOverlay
        open={overlayOpen}
        onClose={() => setOverlayOpen(false)}
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
