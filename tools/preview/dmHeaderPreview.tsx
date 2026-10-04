/**
 * Dev-only preview of the DM chat header (DirectChatHeader) with mock data:
 * the phone header at 340/360/412px in several states, and the desktop header
 * below for comparison. Run `npm run dev` and open
 * /tools/preview/dm-header.html. Not a build input, so it never ships.
 *
 * Avatars come from an in-memory cache with drawn pictures: nothing is
 * written to the app's IndexedDB and no node is asked.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import i18n from '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { createQdnAvatarCache } from '../../src/lib/qdnAvatars/avatarCache';
import { createMemoryAvatarStore } from '../../src/lib/qdnAvatars/avatarStore';
import { setQdnAvatarCacheForTests } from '../../src/lib/qdnAvatars/defaultCache';
import {
  DirectChatHeader,
  type DirectChatHeaderCall,
  type DirectChatHeaderProps,
} from '../../src/components/Chat/DirectChatHeader';

// English for the keys this change adds, until they are in the locale files
// (an existing value always wins).
i18n.addResourceBundle(
  'en',
  'group',
  {
    dm: {
      end_call: 'End call',
      show_avatar: 'Show profile picture',
      start_voice_call: 'Start voice call',
      unhide_user: 'Unhide user',
    },
  },
  true,
  false
);

// No node (empty API base): only the pictures put below show.
const cache = createQdnAvatarCache({
  getApiBase: () => '',
  openStore: async () => createMemoryAvatarStore(),
});
setQdnAvatarCacheForTests(cache);

const drawAvatar = (hue: number, letter: string): Promise<Blob | null> => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  const gradient = context.createLinearGradient(0, 0, 128, 128);
  gradient.addColorStop(0, `hsl(${hue}, 70%, 60%)`);
  gradient.addColorStop(1, `hsl(${hue + 40}, 70%, 40%)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  context.fillStyle = 'rgba(255,255,255,0.9)';
  context.font = 'bold 64px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(letter, 64, 68);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
};

const putPictures = async () => {
  for (const [name, hue] of [
    ['Alice', 200],
    ['Carol with a rather long registered name', 320],
  ] as const) {
    const blob = await drawAvatar(hue, name.charAt(0));
    if (blob) await cache.putImage(name, blob);
  }
};

const noop = () => {};

const call = (
  overrides: Partial<DirectChatHeaderCall> = {}
): DirectChatHeaderCall => ({
  enabled: true,
  connected: false,
  ringing: false,
  blockedByFriend: false,
  blockedByP2p: false,
  p2pBlockedTooltip: 'Peer-to-peer connection is poor',
  onStart: noop,
  onHangUp: noop,
  ...overrides,
});

const base: Omit<DirectChatHeaderProps, 'isMobile'> = {
  reticulumDirectUiEnabled: true,
  isNewChat: false,
  isSelfDirect: false,
  partner: { name: 'Alice', address: 'QAliceAliceAliceAliceAliceAlice01' },
  onClose: noop,
  peerOnline: true,
  peerHidden: false,
  unhideBusy: false,
  onUnhide: noop,
  isFriend: true,
  friendActionBusy: false,
  onToggleFriend: noop,
  call: call(),
};

const SCENARIOS: { label: string; props: Partial<DirectChatHeaderProps> }[] = [
  { label: 'Friend with a picture, online', props: {} },
  {
    label: 'No picture (letter), offline, not a friend',
    props: {
      partner: { name: 'bob', address: 'QBobBobBobBobBobBobBobBobBobBob01' },
      peerOnline: false,
      isFriend: false,
      call: call({ blockedByFriend: true }),
    },
  },
  {
    label: 'Long name, hidden user, in a call',
    props: {
      partner: {
        name: 'Carol with a rather long registered name',
        address: 'QCarolCarolCarolCarolCarolCarol1',
      },
      peerHidden: true,
      call: call({ connected: true }),
    },
  },
  {
    label: 'Address only (no registered name)',
    props: {
      partner: { address: 'QDaveDaveDaveDaveDaveDaveDave01' },
      peerOnline: false,
    },
  },
  {
    label: 'Saved messages',
    props: {
      isSelfDirect: true,
      partner: {
        name: 'Saved Messages',
        address: 'QMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMe1',
        savedMessages: true,
      },
    },
  },
  { label: 'New chat', props: { isNewChat: true, partner: null } },
];

const WIDTHS = [340, 360, 412];

function Frame({ children, width }: { children: ReactNode; width: number }) {
  return (
    <div
      style={{
        border: '1px solid rgba(128,128,128,0.4)',
        borderRadius: 8,
        overflow: 'hidden',
        width,
      }}
    >
      {children}
    </div>
  );
}

function Preview() {
  const { themeMode, toggleTheme } = useThemeContext();
  const [width, setWidth] = useState(360);
  const [, setReady] = useState(false);

  useEffect(() => {
    void putPictures().then(() => setReady(true));
  }, []);

  return (
    <div style={{ padding: 8, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {WIDTHS.map((value) => (
          <button
            key={value}
            onClick={() => setWidth(value)}
            style={{ fontWeight: value === width ? 700 : 400 }}
          >
            {value}px
          </button>
        ))}
        <button onClick={toggleTheme}>{themeMode}</button>
      </div>
      <strong>Phone</strong>
      {SCENARIOS.map(({ label, props }) => (
        <div key={label} style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>{label}</span>
          <Frame width={width}>
            <DirectChatHeader {...base} {...props} isMobile />
          </Frame>
        </div>
      ))}
      <strong>Desktop (unchanged)</strong>
      {SCENARIOS.slice(0, 3).map(({ label, props }) => (
        <div key={label} style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>{label}</span>
          <Frame width={720}>
            <DirectChatHeader {...base} {...props} isMobile={false} />
          </Frame>
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
