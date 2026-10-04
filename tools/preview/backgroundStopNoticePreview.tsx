/**
 * Dev-only preview of the "GO was stopped in the background" notice, in the
 * bell panel and in Background sync settings, at phone widths. The store is
 * replaced by a local snapshot; the actions only change that snapshot.
 * Run `npm run dev` and open /tools/preview/background-stop-notice.html. Not
 * a build input, so it never ships.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, CssBaseline, useTheme } from '@mui/material';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import {
  BackgroundStopNoticeView,
  type BackgroundStopNoticeActions,
} from '../../src/components/Mobile/BackgroundStopNotice';
import type { VendorFreezeHintSnapshot } from '../../src/components/Mobile/vendorFreezeHintStore';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const NOW = Date.now();

const base: VendorFreezeHintSnapshot = {
  ready: true,
  manufacturer: 'vivo',
  brand: 'vivo',
  mode: 'charging',
  ignoringBatteryOptimizations: false,
  freezeCount: 5,
  bell: {
    episodes: 3,
    lastAt: NOW - 3 * HOUR,
    since: NOW - 7 * DAY,
    variant: 'fixable',
    shownAt: NOW - HOUR,
    badge: true,
    isNew: false,
  },
  settings: { episodes7d: 3, lastAt: NOW - 3 * HOUR, variant: 'fixable' },
  dontShowAgain: false,
};

const SCENARIOS: Record<string, Partial<VendorFreezeHintSnapshot>> = {
  vivo: {},
  'vivo, exempt now': { ignoringBatteryOptimizations: true },
  'vivo, exempt and still stopped': {
    ignoringBatteryOptimizations: true,
    bell: { ...base.bell!, variant: 'exempt_still_frozen', badge: false },
    settings: { ...base.settings, variant: 'exempt_still_frozen' },
  },
  'Xiaomi, 1 time': {
    manufacturer: 'Xiaomi',
    settings: { ...base.settings, episodes7d: 1 },
  },
  samsung: { manufacturer: 'samsung' },
  OnePlus: { manufacturer: 'OnePlus' },
  HONOR: { manufacturer: 'HONOR' },
  Google: { manufacturer: 'Google' },
  'unknown brand': { manufacturer: '' },
  'card older than 7 days': {
    settings: { episodes7d: 0, lastAt: null, variant: 'none' },
  },
  ticked: { dontShowAgain: true, bell: { ...base.bell!, badge: false } },
  'ticked, quiet week': {
    dontShowAgain: true,
    bell: null,
    settings: { episodes7d: 0, lastAt: null, variant: 'none' },
  },
};

const WIDTHS = [320, 360, 412];

function Frame({
  children,
  label,
  width,
}: {
  children: React.ReactNode;
  label: string;
  width: number;
}) {
  const theme = useTheme();
  return (
    <div>
      <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.7 }}>{label}</div>
      <Box
        sx={{
          backgroundColor: theme.palette.background.paper,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          p: 1,
          width,
        }}
      >
        {children}
      </Box>
    </div>
  );
}

function Preview() {
  const { themeMode, toggleTheme } = useThemeContext();
  const [scenario, setScenario] = useState('vivo');
  const [width, setWidth] = useState(360);
  const [snapshot, setSnapshot] = useState<VendorFreezeHintSnapshot>(base);
  const [log, setLog] = useState<string[]>([]);

  const pick = (name: string) => {
    setScenario(name);
    setSnapshot({ ...base, ...SCENARIOS[name] });
    setLog([]);
  };
  const note = (line: string) =>
    setLog((lines) => [line, ...lines].slice(0, 6));
  const acknowledge = () =>
    setSnapshot((s) =>
      s.bell ? { ...s, bell: { ...s.bell, badge: false } } : s
    );

  const actions: BackgroundStopNoticeActions = {
    allowInBackground: async () => {
      note('allowInBackground()');
      acknowledge();
      setSnapshot((s) => ({ ...s, ignoringBatteryOptimizations: true }));
      return true;
    },
    openBatterySettings: async () => {
      note('openBatterySettings()');
      acknowledge();
      return scenario === 'unknown brand' ? null : 'vendor';
    },
    expandSteps: async () => {
      note('expandSteps()');
      acknowledge();
    },
    closeCard: async () => {
      note('closeCard()');
      setSnapshot((s) => ({ ...s, bell: null }));
    },
    setDontShowAgain: async (value: boolean) => {
      note(`setDontShowAgain(${value})`);
      if (value) acknowledge();
      setSnapshot((s) => ({ ...s, dontShowAgain: value }));
    },
  };

  return (
    <div style={{ padding: 8 }}>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}
      >
        {Object.keys(SCENARIOS).map((name) => (
          <button
            key={name}
            onClick={() => pick(name)}
            style={{ fontWeight: name === scenario ? 700 : 400 }}
          >
            {name}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {WIDTHS.map((w) => (
          <button
            key={w}
            onClick={() => setWidth(w)}
            style={{ fontWeight: w === width ? 700 : 400 }}
          >
            {w}px
          </button>
        ))}
        <button onClick={toggleTheme}>{themeMode}</button>
        <button onClick={() => pick(scenario)}>reset</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{log.join('  ·  ')}</span>
      </div>
      <div
        style={{
          alignItems: 'flex-start',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <Frame label="Bell panel" width={width}>
          <BackgroundStopNoticeView
            actions={actions}
            snapshot={snapshot}
            variant="bell"
          />
        </Frame>
        <Frame label="Background sync settings" width={width}>
          <BackgroundStopNoticeView
            actions={actions}
            snapshot={snapshot}
            variant="settings"
          />
        </Frame>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
