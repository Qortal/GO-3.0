/**
 * Dev-only preview of GO's phone call UI with mocked call states: incoming,
 * calling, connecting, connected (direct / relayed), muted, reconnecting,
 * ended, the strip (in the top bar and floating), the audio route sheet, the
 * group stage with 1 / 4 / 9 people (relaying note), landscape, over the
 * lock, the Calls settings row (also changed during a call, and with the
 * Android 14+ full-screen ring switch off), a phone with only a loudspeaker
 * (emulator / tablet), and the full-screen ring notice card.
 *
 * Run `npx vite --port 5181 --strictPort` and open
 * /tools/preview/call-screen.html?state=connected-direct (state list in the
 * picker; `&theme=light` for the light theme, `&bare=1` hides the picker
 * for screenshots). Not a build input.
 */
import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import { MotionGlobalConfig } from 'framer-motion';
import { alpha, Box, CssBaseline, Typography, useTheme } from '@mui/material';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import {
  MOBILE_TAB_BAR_HEIGHT_PX,
  MOBILE_TOP_BAR_HEIGHT_PX,
} from '../../src/components/Mobile/mobileBarHeights';
import type {
  MobileCallParticipant,
  MobileCallView,
} from '../../src/components/Mobile/call/callUiModel';
import type {
  CallAudioRoute,
  CallAudioRouteType,
} from '../../src/components/Mobile/call/callBridgeAdapters';
import { MobileCallScreen } from '../../src/components/Mobile/call/MobileCallScreen';
import { MobileIncomingCallScreen } from '../../src/components/Mobile/call/MobileIncomingCallScreen';
import { MobileCallStrip } from '../../src/components/Mobile/call/MobileCallStrip';
import { GoCallPrivacySetting } from '../../src/components/Mobile/call/GoCallPrivacySetting';
import { MobileCallLockCover } from '../../src/components/Mobile/call/MobileCallLockCover';
import { FullScreenRingNoticeCard } from '../../src/components/Mobile/call/MobileFullScreenRingNotice';
import {
  CALL_FLOATING_STRIP_Z,
  CALL_INCOMING_Z,
  CALL_SCREEN_Z,
  publishCallStrip,
} from '../../src/components/Mobile/call/goCallUi';

const STATES = [
  'incoming',
  'incoming-switch-locked',
  'calling',
  'connecting-delayed',
  'connected-direct',
  'connected-relayed',
  'muted',
  'reconnecting',
  'ended',
  'strip-bar',
  'strip-floating',
  'strip-connecting',
  'route-sheet',
  'group-1',
  'group-4',
  'group-9-relaying',
  'group-participants',
  'group-unstable',
  'landscape',
  'landscape-group',
  'landscape-incoming',
  'locked-call',
  'locked-peek',
  'phone-lock-cover',
  'tablet-group',
  'settings',
  'settings-in-call',
  'speaker-only',
  'full-screen-notice',
] as const;
type PreviewState = (typeof STATES)[number];

const NAMES = [
  'alice',
  'bob.q',
  'crowetic',
  'Simon',
  'Mia Tester',
  'qortal-dev',
  'Nadia',
  'oak',
  'Xen',
  'Phil',
  'Ruth',
  'lumen',
  'tara',
  'zed',
  'Kai',
];

const addressFor = (i: number) =>
  `Q${String.fromCharCode(65 + (i % 26))}x${(i * 7919).toString(36)}Ab9Kq3RzLm8T${i}`;

const people = (n: number, speaking: number[] = [1]): MobileCallParticipant[] =>
  Array.from({ length: n }, (_, i) => ({
    address: addressFor(i),
    label: i === 0 ? 'You' : NAMES[i % NAMES.length],
    isSelf: i === 0,
    speaking: speaking.includes(i),
    muted: false,
  }));

const directView = (over: Partial<MobileCallView> = {}): MobileCallView => ({
  kind: 'direct',
  phase: 'active',
  callKey: 'direct:preview',
  title: 'alice',
  address: addressFor(1),
  durationSec: 201,
  muted: false,
  transport: 'direct',
  delayed: false,
  participants: [],
  maxParticipants: 2,
  relaying: false,
  ...over,
});

const groupView = (over: Partial<MobileCallView> = {}): MobileCallView => ({
  kind: 'group',
  phase: 'active',
  callKey: 'gcall-qortal-42',
  title: 'Qortal Devs',
  durationSec: 754,
  muted: false,
  transport: 'relayed',
  delayed: false,
  participants: people(4),
  maxParticipants: 15,
  relaying: false,
  ...over,
});

const TWO_ROUTES: CallAudioRoute[] = [
  { type: 'earpiece' },
  { type: 'speaker' },
];
const SPEAKER_ONLY: CallAudioRoute[] = [{ type: 'speaker' }];
const FOUR_ROUTES: CallAudioRoute[] = [
  { type: 'earpiece' },
  { type: 'speaker' },
  { type: 'bluetooth', name: 'Pixel Buds Pro' },
  { type: 'wired' },
];

function readParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

/** A plain GO-like page behind the strip / lock states. */
function FakeApp({ withStripSlot }: { withStripSlot?: ReactNode }) {
  const theme = useTheme();
  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
      <Box
        sx={{
          alignItems: 'center',
          borderBottom: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
          display: 'flex',
          height: MOBILE_TOP_BAR_HEIGHT_PX,
          px: 2,
        }}
      >
        <Typography sx={{ fontWeight: 800 }}>Qortal GO</Typography>
      </Box>
      {withStripSlot}
      <Box
        sx={{
          alignItems: 'center',
          borderBottom: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
          display: 'flex',
          gap: 1.5,
          height: 56,
          px: 2,
        }}
      >
        <Box
          sx={{
            bgcolor: 'primary.main',
            borderRadius: '50%',
            height: 36,
            width: 36,
          }}
        />
        <Typography sx={{ fontWeight: 700 }}>alice — chat header</Typography>
      </Box>
      <Box sx={{ display: 'grid', gap: 1.5, p: 2 }}>
        {[
          'hey!',
          'calling you now',
          'can you hear me?',
          'yes, loud and clear',
        ].map((line, i) => (
          <Box
            key={line}
            sx={{
              alignSelf: 'start',
              bgcolor: alpha(theme.palette.primary.main, i % 2 ? 0.25 : 0.1),
              borderRadius: 3,
              justifySelf: i % 2 ? 'end' : 'start',
              px: 1.5,
              py: 1,
            }}
          >
            {line}
          </Box>
        ))}
      </Box>
      <Box
        sx={{
          alignItems: 'center',
          bgcolor: 'background.paper',
          borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
          bottom: 0,
          display: 'flex',
          height: MOBILE_TAB_BAR_HEIGHT_PX,
          justifyContent: 'space-around',
          left: 0,
          position: 'fixed',
          right: 0,
        }}
      >
        {['Home', 'Apps', 'Chat'].map((tab) => (
          <Typography key={tab} sx={{ fontSize: 13, opacity: 0.7 }}>
            {tab}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

function Preview() {
  const { themeMode, toggleTheme } = useThemeContext();
  const initial = (readParam('state') as PreviewState) || 'connected-direct';
  const [state, setState] = useState<PreviewState>(
    STATES.includes(initial) ? initial : 'connected-direct'
  );
  const [muted, setMuted] = useState(false);
  const [route, setRoute] = useState<CallAudioRouteType>('earpiece');
  const [log, setLog] = useState('');

  useEffect(() => {
    const want = readParam('theme');
    if ((want === 'light' || want === 'dark') && want !== themeMode) {
      toggleTheme();
    }
    // Only on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMuted(state === 'muted');
    setRoute(
      state === 'route-sheet'
        ? 'bluetooth'
        : state === 'speaker-only'
          ? 'speaker'
          : 'earpiece'
    );
    // "Calls" settings opened during a call: the root publishes the call.
    publishCallStrip(
      state === 'settings-in-call'
        ? {
            view: directView(),
            actions: { open: () => {}, toggleMute: () => {}, hangUp: () => {} },
            show: false,
          }
        : { view: null, actions: null, show: false }
    );
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('state', state);
      window.history.replaceState(null, '', url.toString());
    } catch {
      /* preview only */
    }
  }, [state]);

  const note = (text: string) => setLog(text);
  const handlers = {
    onMinimize: () => note('minimize'),
    onToggleMute: () => setMuted((m) => !m),
    onHangUp: () => note('hang up'),
    onMessage: () => note('message'),
  };
  const audio = (routes: CallAudioRoute[]) => ({
    routes,
    current: route,
    onSelect: (type: CallAudioRouteType) => setRoute(type),
  });

  const content = useMemo(() => {
    const screenFor = (
      view: MobileCallView,
      extra: Partial<ComponentProps<typeof MobileCallScreen>> = {}
    ) => (
      <MobileCallScreen
        key={`${state}`}
        view={{ ...view, muted: muted || view.muted }}
        locked={false}
        zIndex={CALL_SCREEN_Z}
        audio={audio(TWO_ROUTES)}
        {...handlers}
        {...extra}
      />
    );
    switch (state) {
      case 'incoming':
      case 'incoming-switch-locked':
      case 'landscape-incoming':
        return (
          <MobileIncomingCallScreen
            callerName="bob.q"
            callerAddress={addressFor(2)}
            zIndex={CALL_INCOMING_Z}
            locked={state === 'incoming-switch-locked'}
            switchFrom={state === 'incoming-switch-locked' ? 'group' : null}
            ringerSilenced={state === 'incoming-switch-locked'}
            landscape={state === 'landscape-incoming'}
            onAccept={() => note('accept')}
            onDecline={() => note('decline')}
          />
        );
      case 'calling':
        return screenFor(directView({ phase: 'calling', durationSec: 0 }));
      case 'connecting-delayed':
        return screenFor(
          directView({ phase: 'connecting', durationSec: 3, delayed: true })
        );
      case 'connected-direct':
        return screenFor(directView());
      case 'connected-relayed':
        return screenFor(directView({ transport: 'relayed' }));
      case 'muted':
        return screenFor(directView({ muted: true }));
      case 'reconnecting':
        return screenFor(
          directView({ phase: 'reconnecting', transport: 'relayed' })
        );
      case 'ended':
        return screenFor(directView({ phase: 'ended' }));
      case 'route-sheet':
        return screenFor(directView(), {
          audio: audio(FOUR_ROUTES),
          initialSheet: 'audio',
        });
      case 'speaker-only':
        // Emulator / tablet with no earpiece, before the first audio.
        return screenFor(
          directView({ phase: 'connecting', transport: 'relayed' }),
          { audio: audio(SPEAKER_ONLY) }
        );
      case 'group-1':
        return screenFor(
          groupView({ phase: 'waiting', participants: people(1, []) })
        );
      case 'group-4':
        return screenFor(groupView());
      case 'group-9-relaying':
        return screenFor(
          groupView({
            participants: people(9, [2, 5]),
            relaying: true,
            transport: 'relayed',
          })
        );
      case 'group-participants':
        return screenFor(groupView({ participants: people(6, [3]) }), {
          initialSheet: 'participants',
        });
      case 'group-unstable':
        return screenFor(groupView({ phase: 'unstable' }));
      case 'landscape':
        return screenFor(directView(), { landscape: true });
      case 'landscape-group':
        return screenFor(
          groupView({ participants: people(6, [1]), relaying: true }),
          { landscape: true }
        );
      case 'tablet-group':
        return screenFor(
          groupView({ participants: people(9, [4]), relaying: true }),
          { wide: true }
        );
      case 'locked-call':
        return (
          <>
            <Box
              sx={{
                alignItems: 'center',
                bgcolor: '#101418',
                color: '#fff',
                display: 'flex',
                inset: 0,
                justifyContent: 'center',
                position: 'fixed',
                zIndex: 2000,
              }}
            >
              GO lock screen
            </Box>
            {screenFor(directView(), {
              locked: true,
              onUnlock: () => note('unlock: show the lock screen'),
            })}
          </>
        );
      case 'locked-peek':
        return (
          <>
            <Box
              sx={{
                alignItems: 'center',
                bgcolor: '#101418',
                color: '#fff',
                display: 'flex',
                inset: 0,
                justifyContent: 'center',
                position: 'fixed',
                zIndex: 2000,
              }}
            >
              GO lock screen
            </Box>
            <MobileCallStrip
              view={directView({ muted })}
              variant="floating"
              zIndex={2100}
              onOpen={() => note('back to the call')}
              onToggleMute={() => setMuted((m) => !m)}
              onHangUp={() => note('hang up')}
            />
          </>
        );
      case 'phone-lock-cover':
        return (
          <MobileCallLockCover
            zIndex={CALL_INCOMING_Z}
            onUnlock={() => note('Android unlock prompt')}
          />
        );
      default:
        return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, muted, route]);

  const strip =
    state === 'strip-bar' ||
    state === 'strip-floating' ||
    state === 'strip-connecting' ? (
      <MobileCallStrip
        view={directView({
          muted,
          phase: state === 'strip-connecting' ? 'connecting' : 'active',
        })}
        variant={state === 'strip-floating' ? 'floating' : 'bar'}
        onOpen={() => note('open call screen')}
        onToggleMute={() => setMuted((m) => !m)}
        onHangUp={() => note('hang up')}
      />
    ) : null;

  return (
    <>
      <FakeApp withStripSlot={state === 'strip-floating' ? null : strip} />
      {state === 'strip-floating' ? strip : null}
      {state === 'settings' || state === 'settings-in-call' ? (
        <Box
          sx={{
            bgcolor: 'background.paper',
            borderRadius: 3,
            left: 12,
            maxWidth: 420,
            position: 'fixed',
            right: 12,
            top: 140,
          }}
        >
          <GoCallPrivacySetting
            fullScreenRingAllowed={state === 'settings-in-call' ? false : null}
          />
        </Box>
      ) : null}
      {state === 'full-screen-notice' ? (
        <Box
          sx={{
            bottom: `${MOBILE_TAB_BAR_HEIGHT_PX + 12}px`,
            left: 12,
            position: 'fixed',
            right: 12,
            zIndex: CALL_FLOATING_STRIP_Z,
          }}
        >
          <FullScreenRingNoticeCard
            onAllow={() => note("allow: Android's full-screen switch")}
            onNever={() => note("don't show again")}
            onClose={() => note('close for this app start')}
          />
        </Box>
      ) : null}
      {content}
      <Box
        sx={{
          bgcolor: 'rgba(0,0,0,0.72)',
          borderRadius: 2,
          bottom: 8,
          color: '#fff',
          display: readParam('bare') === '1' ? 'none' : 'flex',
          fontSize: 12,
          gap: 1,
          left: 8,
          p: 0.75,
          position: 'fixed',
          // Above the ring screen (which goes over every GO layer).
          zIndex: 2147483647,
        }}
      >
        <select
          aria-label="Preview state"
          value={state}
          onChange={(e) => setState(e.target.value as PreviewState)}
        >
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button onClick={toggleTheme}>{themeMode}</button>
        <span>{log}</span>
      </Box>
    </>
  );
}

// Screenshots: `&bare=1` also skips framer entrances, so a capture never
// lands mid-fade.
if (readParam('bare') === '1') MotionGlobalConfig.skipAnimations = true;

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
