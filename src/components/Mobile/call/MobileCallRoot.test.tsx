import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- engines and platform, mocked ------------------------------------------
const engines = vi.hoisted(() => ({
  dm: {} as Record<string, any>,
  gc: {} as Record<string, any>,
  native: {} as Record<string, any>,
  nativeOptions: null as any,
  nativeStates: [] as string[],
  sideRing: null as any,
  sideSilence: vi.fn(),
  minimize: vi.fn(async () => undefined),
  ringStop: vi.fn(),
  ringStart: vi.fn(),
  lockContainer: null as HTMLDivElement | null,
}));

vi.mock('../../../context/VoiceCallContext', () => ({
  useVoiceCallContext: () => engines.dm,
}));
vi.mock('../../../contexts/GroupCallContext', () => ({
  useGroupCallContext: () => engines.gc,
}));
vi.mock('../../Group/groupApi', () => ({
  getPrimaryNameForAvatar: vi.fn(async (address: string) =>
    address === 'QAlice' ? 'alice' : address === 'QBob' ? 'bob' : ''
  ),
}));
vi.mock('../../App/AppLockLayer', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../App/AppLockLayer')>();
  return {
    ...actual,
    getAppLockLayerContainer: () => engines.lockContainer,
  };
});
vi.mock('@capacitor/app', () => ({
  App: { minimizeApp: () => engines.minimize() },
}));
vi.mock('../../../lib/call/directIncomingRingtone', () => ({
  startDirectIncomingRingtone: () => {
    engines.ringStart();
    return engines.ringStop;
  },
}));
vi.mock('../../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://127.0.0.1:12391',
}));
vi.mock('../../../lib/qdnAvatars/useQdnAvatar', () => ({
  useQdnAvatar: () => ({ src: undefined, status: 'missing' }),
}));
vi.mock('./callBridgeAdapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./callBridgeAdapters')>();
  return {
    ...actual,
    useNativeCallSessionAdapter: (options: any) => {
      engines.nativeOptions = options;
      engines.nativeStates.push(options.callState);
      return engines.native;
    },
    useNativeSideRing: (options: unknown) => {
      engines.sideRing = options;
      return { silence: engines.sideSilence };
    },
    useCallAudioRoutes: () => ({
      routes: [{ type: 'earpiece' }, { type: 'speaker' }],
      current: 'earpiece',
      native: false,
      select: vi.fn(),
    }),
  };
});

import '../../../i18n/i18n';
import { userInfoAtom } from '../../../atoms/global';
import { ANDROID_BACK_EVENT } from '../../../bridge/capacitorBridge';
import {
  BACK_PRIORITY,
  registerAndroidBackHandler,
} from '../../../utils/androidBack';
import { MobileCallRoot } from './MobileCallRoot';
import { MobileCallStripSlot } from './MobileCallStrip';
import {
  CALL_INCOMING_Z,
  CALL_SCREEN_KEYGUARD_Z,
  goCallRingOverAppLock,
  KEYGUARD_COVER_GRACE_MS,
  resetCallStripStoreForTests,
} from './goCallUi';

const DM_ID = 'direct:QAlice:QMe';

/** A back handler at any priority (e.g. the Q-App approval's call + 10). */
const registerBackAt = registerAndroidBackHandler as (
  handler: () => boolean,
  priority: number
) => () => void;

const idleDm = () => ({
  callState: 'idle',
  audioMode: null,
  startupStatus: { stage: 'idle', delayed: false },
  callMediaReady: false,
  isMuted: false,
  hearCall: true,
  callDuration: 0,
  incomingCall: null,
  activeCallChatId: null,
  acceptCall: vi.fn(async () => undefined),
  rejectCall: vi.fn(async () => undefined),
  hangUp: vi.fn(async () => undefined),
  toggleMute: vi.fn(),
});

const idleGc = () => ({
  roomState: 'idle',
  roomId: '',
  participants: [],
  myRole: 'participant',
  activeSpeakers: [],
  topologyLabel: 'Reticulum',
  muted: false,
  memberPrimaryNames: {},
  memberGateGroupName: '',
  startupStatus: { stage: 'idle', delayed: false },
  leaveGroupCall: vi.fn(async () => undefined),
  setMuted: vi.fn(),
});

let store: ReturnType<typeof createStore>;

function Harness({
  locked = false,
  slot = false,
}: {
  locked?: boolean;
  slot?: boolean;
}) {
  return (
    <Provider store={store}>
      {slot ? <MobileCallStripSlot /> : null}
      <MobileCallRoot isAppLocked={locked} />
    </Provider>
  );
}

const pressBack = () => {
  const event = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
};

beforeEach(() => {
  engines.dm = idleDm();
  engines.gc = idleGc();
  engines.native = {};
  engines.nativeOptions = null;
  engines.nativeStates = [];
  engines.sideRing = null;
  engines.sideSilence.mockClear();
  engines.minimize.mockClear();
  engines.ringStart.mockClear();
  engines.ringStop.mockClear();
  engines.lockContainer = document.createElement('div');
  engines.lockContainer.setAttribute('data-app-lock-layer', '');
  document.body.appendChild(engines.lockContainer);
  store = createStore();
  store.set(userInfoAtom, { address: 'QMe', name: 'me' } as any);
  resetCallStripStoreForTests();
});

afterEach(() => {
  engines.lockContainer?.remove();
  vi.useRealTimers();
});

describe('MobileCallRoot', () => {
  it('opens the call screen for an outgoing call, back minimizes to the strip', async () => {
    const view = render(<Harness />);
    expect(screen.queryByTestId('mobile-call-screen')).toBeNull();

    engines.dm = {
      ...engines.dm,
      callState: 'calling',
      activeCallChatId: DM_ID,
    };
    view.rerender(<Harness />);
    expect(await screen.findByTestId('mobile-call-screen')).toBeTruthy();
    expect(screen.getByTestId('call-status').textContent).toBe('Calling…');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'alice' })).toBeTruthy()
    );

    expect(pressBack()).toBe(true);
    await waitFor(() =>
      expect(screen.queryByTestId('mobile-call-screen')).toBeNull()
    );
    expect(screen.getByTestId('call-strip-floating')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Return to the call' }));
    expect(await screen.findByTestId('mobile-call-screen')).toBeTruthy();
    fireEvent.click(screen.getByTestId('call-hangup-button'));
    expect(engines.dm.hangUp).toHaveBeenCalledTimes(1);
  });

  it('uses the top bar slot when one is mounted', async () => {
    engines.dm = {
      ...engines.dm,
      callState: 'connected',
      callMediaReady: true,
      callDuration: 12,
      activeCallChatId: DM_ID,
    };
    render(<Harness slot />);
    expect(await screen.findByTestId('mobile-call-screen')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize call' }));
    await waitFor(() =>
      expect(screen.getByTestId('call-strip-bar')).toBeTruthy()
    );
    expect(screen.queryByTestId('call-strip-floating')).toBeNull();
    expect(screen.getByTestId('call-strip-status').textContent).toBe('00:12');
  });

  it('rings, silences on back, accepts', async () => {
    engines.dm = {
      ...engines.dm,
      callState: 'ringing',
      incomingCall: {
        callId: 'c1',
        fromAddress: 'QBob',
        chatId: 'direct:QBob:QMe',
      },
    };
    render(<Harness />);
    expect(
      await screen.findByTestId('mobile-incoming-call-screen')
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('incoming-caller-name').textContent).toBe('bob')
    );
    expect(engines.ringStart).toHaveBeenCalledTimes(1);
    expect(engines.nativeOptions.callState).toBe('ringing');
    expect(engines.nativeOptions.peerName).toBe('bob');

    expect(pressBack()).toBe(true);
    expect(engines.ringStop).toHaveBeenCalled();
    expect(screen.getByTestId('incoming-ringer-silenced')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(engines.dm.acceptCall).toHaveBeenCalledTimes(1));
  });

  it('skips the in-page ring when Android rings', async () => {
    engines.native = { nativeRinging: true };
    engines.dm = {
      ...engines.dm,
      callState: 'ringing',
      incomingCall: {
        callId: 'c1',
        fromAddress: 'QBob',
        chatId: 'direct:QBob:QMe',
      },
    };
    render(<Harness />);
    await screen.findByTestId('mobile-incoming-call-screen');
    expect(engines.ringStart).not.toHaveBeenCalled();
  });

  it('answering during a group call leaves the group first', async () => {
    engines.gc = {
      ...engines.gc,
      roomState: 'connected',
      roomId: 'gcall-qortal-5',
      startupStatus: { stage: 'connected', delayed: false },
    };
    engines.gc.leaveGroupCall = vi.fn(async () => {
      engines.gc = { ...engines.gc, roomState: 'idle', roomId: '' };
    });
    engines.dm = {
      ...engines.dm,
      callState: 'ringing',
      incomingCall: {
        callId: 'c2',
        fromAddress: 'QBob',
        chatId: 'direct:QBob:QMe',
      },
    };
    const view = render(<Harness />);
    await screen.findByTestId('mobile-incoming-call-screen');
    expect(screen.getByTestId('incoming-switch-hint')).toBeTruthy();
    // Android's session stays on the group call; the ring is posted beside it.
    expect(engines.nativeOptions.callState).toBe('connected');
    expect(engines.nativeOptions.isGroup).toBe(true);
    expect(engines.nativeOptions.callId).toBe('gcall-qortal-5');
    expect(engines.sideRing.enabled).toBe(true);
    expect(engines.sideRing.callId).toBe('c2');
    fireEvent.click(screen.getByRole('button', { name: 'End & accept' }));
    view.rerender(<Harness />);
    await waitFor(() => expect(engines.gc.leaveGroupCall ?? null).toBeTruthy());
    await waitFor(() => expect(engines.dm.acceptCall).toHaveBeenCalledTimes(1));
    // Still the side ring after the group left (not torn down and re-posted).
    expect(engines.sideRing.enabled).toBe(true);
    expect(engines.nativeStates).not.toContain('ringing');
  });

  it('a ring during a group call: back silences the side ring, notification Accept answers', async () => {
    engines.gc = {
      ...engines.gc,
      roomState: 'connected',
      roomId: 'gcall-qortal-6',
      startupStatus: { stage: 'connected', delayed: false },
    };
    engines.gc.leaveGroupCall = vi.fn(async () => {
      engines.gc = { ...engines.gc, roomState: 'idle', roomId: '' };
    });
    engines.dm = {
      ...engines.dm,
      callState: 'ringing',
      incomingCall: {
        callId: 'c4',
        fromAddress: 'QBob',
        chatId: 'direct:QBob:QMe',
      },
    };
    const view = render(<Harness />);
    await screen.findByTestId('mobile-incoming-call-screen');
    expect(pressBack()).toBe(true);
    expect(engines.sideSilence).toHaveBeenCalledTimes(1);
    act(() => engines.sideRing.onAccept());
    view.rerender(<Harness />);
    await waitFor(() => expect(engines.dm.acceptCall).toHaveBeenCalledTimes(1));
  });

  it('a ring with no other call uses the session (no side ring)', async () => {
    engines.dm = {
      ...engines.dm,
      callState: 'ringing',
      incomingCall: {
        callId: 'c5',
        fromAddress: 'QBob',
        chatId: 'direct:QBob:QMe',
      },
    };
    render(<Harness />);
    await screen.findByTestId('mobile-incoming-call-screen');
    expect(engines.nativeOptions.callState).toBe('ringing');
    expect(engines.nativeOptions.callId).toBe('c5');
    expect(engines.sideRing.enabled).toBe(false);
  });

  it('back on the ring goes before a Q-App approval under it', async () => {
    const approval = vi.fn(() => true);
    const off = registerBackAt(approval, BACK_PRIORITY.call + 10);
    try {
      engines.dm = {
        ...engines.dm,
        callState: 'ringing',
        incomingCall: {
          callId: 'c6',
          fromAddress: 'QBob',
          chatId: 'direct:QBob:QMe',
        },
      };
      render(<Harness />);
      await screen.findByTestId('mobile-incoming-call-screen');
      expect(pressBack()).toBe(true);
      expect(approval).not.toHaveBeenCalled();
      expect(screen.getByTestId('incoming-ringer-silenced')).toBeTruthy();
    } finally {
      off();
    }
  });

  it('the ring over GO lock tells the back gate to let back through', async () => {
    engines.dm = {
      ...engines.dm,
      callState: 'ringing',
      incomingCall: {
        callId: 'c7',
        fromAddress: 'QBob',
        chatId: 'direct:QBob:QMe',
      },
    };
    const view = render(<Harness locked />);
    await screen.findByTestId('mobile-incoming-call-screen');
    expect(goCallRingOverAppLock()).toBe(true);
    view.unmount();
    expect(goCallRingOverAppLock()).toBe(false);
  });

  it('over GO lock: drawn in the lock layer, cannot be minimized', async () => {
    engines.dm = {
      ...engines.dm,
      callState: 'connected',
      callMediaReady: true,
      callDuration: 5,
      activeCallChatId: DM_ID,
    };
    render(<Harness locked />);
    const callScreen = await screen.findByTestId('mobile-call-screen');
    expect(engines.lockContainer?.contains(callScreen)).toBe(true);
    expect(screen.queryByTestId('call-minimize-button')).toBeNull();
    expect(screen.getByTestId('call-locked-note')).toBeTruthy();
    expect(pressBack()).toBe(false);
    expect(screen.queryByTestId('call-strip-floating')).toBeNull();
  });

  it('incoming over GO lock goes in the lock layer too', async () => {
    engines.dm = {
      ...engines.dm,
      callState: 'ringing',
      incomingCall: {
        callId: 'c3',
        fromAddress: 'QBob',
        chatId: 'direct:QBob:QMe',
      },
    };
    render(<Harness locked />);
    const ring = await screen.findByTestId('mobile-incoming-call-screen');
    expect(engines.lockContainer?.contains(ring)).toBe(true);
  });

  it('nothing goes into the lock layer when there is no call', () => {
    render(<Harness locked />);
    expect(engines.lockContainer?.childElementCount).toBe(0);
  });

  it('shows "Call ended" briefly, then nothing', async () => {
    engines.dm = {
      ...engines.dm,
      callState: 'connected',
      callMediaReady: true,
      callDuration: 65,
      activeCallChatId: DM_ID,
    };
    const view = render(<Harness />);
    await screen.findByTestId('mobile-call-screen');
    engines.dm = {
      ...engines.dm,
      callState: 'ended',
      callMediaReady: false,
      callDuration: 0,
      activeCallChatId: null,
    };
    view.rerender(<Harness />);
    expect(screen.getByTestId('call-status').textContent).toBe(
      'Call ended · 01:05'
    );
    expect(screen.queryByTestId('call-strip-floating')).toBeNull();
    await waitFor(
      () => expect(screen.queryByTestId('mobile-call-screen')).toBeNull(),
      { timeout: 4_000 }
    );
    expect(screen.queryByTestId('call-strip-floating')).toBeNull();
  });

  it('opens the phone stage when a Qortal group call starts, with relaying note', async () => {
    const view = render(<Harness />);
    engines.gc = {
      ...engines.gc,
      roomState: 'joining',
      roomId: 'gcall-qortal-9',
      memberGateGroupName: 'Qortal devs',
      startupStatus: { stage: 'joining-call', delayed: false },
    };
    view.rerender(<Harness />);
    expect(await screen.findByTestId('mobile-call-screen')).toBeTruthy();
    expect(screen.getByTestId('call-status').textContent).toBe('Joining…');

    engines.gc = {
      ...engines.gc,
      roomState: 'connected',
      myRole: 'root-forwarder',
      topologyLabel: 'Reticulum',
      startupStatus: { stage: 'connected', delayed: false },
      participants: [
        {
          address: 'QMe',
          publicKey: 'a',
          speaking: false,
          role: 'root-forwarder',
        },
        {
          address: 'QAlice',
          publicKey: 'b',
          speaking: true,
          role: 'participant',
        },
        {
          address: 'QBob',
          publicKey: 'c',
          speaking: false,
          role: 'participant',
        },
      ],
      memberPrimaryNames: { QAlice: 'alice', QBob: 'bob' },
    };
    view.rerender(<Harness />);
    expect(screen.getByTestId('call-relaying-note')).toBeTruthy();
    expect(screen.getAllByTestId('call-participant-tile')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(engines.gc.setMuted).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(engines.gc.leaveGroupCall).toHaveBeenCalledTimes(1);
  });

  it('phone lock reported by Android keeps the call full screen', async () => {
    engines.native = { keyguardLocked: true };
    engines.dm = {
      ...engines.dm,
      callState: 'connected',
      callMediaReady: true,
      activeCallChatId: DM_ID,
    };
    render(<Harness />);
    await screen.findByTestId('mobile-call-screen');
    expect(screen.queryByTestId('call-minimize-button')).toBeNull();
    expect(screen.queryByTestId('call-message-button')).toBeNull();
  });

  it('covers GO over the phone lock right after a call, then lets go', async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
      ],
    });
    engines.native = { keyguardLocked: true, requestUnlock: vi.fn() };
    engines.dm = {
      ...engines.dm,
      callState: 'connected',
      callMediaReady: true,
      activeCallChatId: DM_ID,
    };
    const view = render(<Harness />);
    await screen.findByTestId('mobile-call-screen');
    // Under the call screen: only a backdrop.
    expect(screen.getByTestId('call-lock-backdrop')).toBeTruthy();
    engines.dm = {
      ...engines.dm,
      callState: 'idle',
      callMediaReady: false,
      activeCallChatId: null,
    };
    view.rerender(<Harness />);
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });
    await waitFor(() =>
      expect(screen.queryByTestId('mobile-call-screen')).toBeNull()
    );
    expect(screen.getByTestId('call-lock-cover')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(engines.native.requestUnlock).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(KEYGUARD_COVER_GRACE_MS + 500);
    });
    expect(screen.queryByTestId('call-lock-cover')).toBeNull();
  });

  it('no cover when the phone locks with GO open and no call', async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
      ],
    });
    const view = render(<Harness />);
    await act(async () => {
      vi.advanceTimersByTime(KEYGUARD_COVER_GRACE_MS + 1_000);
    });
    engines.native = { keyguardLocked: true };
    view.rerender(<Harness />);
    expect(screen.queryByTestId('call-lock-cover')).toBeNull();
    expect(screen.queryByTestId('call-lock-backdrop')).toBeNull();
  });

  it('GO opened over the phone lock (from a ring) is covered at first', () => {
    engines.native = { keyguardLocked: true };
    render(<Harness />);
    expect(screen.getByTestId('call-lock-cover')).toBeTruthy();
  });

  it('over the phone lock the call is above dialogs and the rest is inert; back leaves GO', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.style.zIndex = '50000';
    document.body.appendChild(dialog);
    const approval = vi.fn(() => true);
    const off = registerBackAt(approval, BACK_PRIORITY.call + 10);
    try {
      engines.native = { keyguardLocked: true };
      engines.dm = {
        ...engines.dm,
        callState: 'connected',
        callMediaReady: true,
        activeCallChatId: DM_ID,
      };
      const view = render(<Harness />);
      const callScreen = await screen.findByTestId('mobile-call-screen');
      expect(Number(callScreen.style.zIndex)).toBe(CALL_SCREEN_KEYGUARD_Z);
      expect(CALL_SCREEN_KEYGUARD_Z).toBeGreaterThan(990000001);
      await waitFor(() => expect(dialog.hasAttribute('inert')).toBe(true));
      expect(dialog.getAttribute('aria-hidden')).toBe('true');
      expect(callScreen.closest('[inert]')).toBeNull();

      expect(pressBack()).toBe(true);
      expect(engines.minimize).toHaveBeenCalledTimes(1);
      expect(approval).not.toHaveBeenCalled();

      // Unlocked: the page is usable again, back minimizes the call screen.
      engines.native = {};
      view.rerender(<Harness />);
      await waitFor(() => expect(dialog.hasAttribute('inert')).toBe(false));
      expect(
        Number(screen.getByTestId('mobile-call-screen').style.zIndex)
      ).toBe(2050);
    } finally {
      off();
      dialog.remove();
    }
  });

  it('the ring screen is above the media viewers', () => {
    expect(CALL_INCOMING_Z).toBeGreaterThan(2147483000);
  });

  it('no lock cover over a ringing call', async () => {
    engines.native = { keyguardLocked: true };
    engines.dm = {
      ...engines.dm,
      callState: 'ringing',
      incomingCall: {
        callId: 'c9',
        fromAddress: 'QBob',
        chatId: 'direct:QBob:QMe',
      },
    };
    render(<Harness />);
    await screen.findByTestId('mobile-incoming-call-screen');
    expect(screen.queryByTestId('call-lock-cover')).toBeNull();
  });

  it('notification Mute / Unmute only flips when needed; open shows the screen', async () => {
    engines.dm = {
      ...engines.dm,
      callState: 'connected',
      callMediaReady: true,
      isMuted: true,
      activeCallChatId: DM_ID,
    };
    render(<Harness />);
    await screen.findByTestId('mobile-call-screen');
    act(() => engines.nativeOptions.onToggleMute(true));
    expect(engines.dm.toggleMute).not.toHaveBeenCalled();
    act(() => engines.nativeOptions.onToggleMute(false));
    expect(engines.dm.toggleMute).toHaveBeenCalledTimes(1);
    expect(engines.nativeOptions.callState).toBe('connected');

    fireEvent.click(screen.getByRole('button', { name: 'Minimize call' }));
    await waitFor(() =>
      expect(screen.queryByTestId('mobile-call-screen')).toBeNull()
    );
    act(() => engines.nativeOptions.onOpen());
    expect(await screen.findByTestId('mobile-call-screen')).toBeTruthy();
  });

  it('over GO lock, Unlock steps the call aside as a pill above the lock', async () => {
    engines.dm = {
      ...engines.dm,
      callState: 'connected',
      callMediaReady: true,
      callDuration: 30,
      activeCallChatId: DM_ID,
    };
    render(<Harness locked />);
    await screen.findByTestId('mobile-call-screen');
    fireEvent.click(screen.getByTestId('call-unlock-button'));
    await waitFor(() =>
      expect(screen.queryByTestId('mobile-call-screen')).toBeNull()
    );
    const pill = screen.getByTestId('call-strip-floating');
    expect(engines.lockContainer?.contains(pill)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Return to the call' }));
    const back = await screen.findByTestId('mobile-call-screen');
    expect(engines.lockContainer?.contains(back)).toBe(true);
  });

  it('gives Android the signed-in address for the native ring', async () => {
    render(<Harness />);
    expect(engines.nativeOptions.localAddress).toBe('QMe');
    expect(engines.nativeOptions.activeCall).toBeUndefined();
  });

  it('Mute and Speaker work as soon as the call connects (before audio arrives)', async () => {
    engines.dm = {
      ...engines.dm,
      callState: 'connected',
      callMediaReady: false,
      activeCallChatId: DM_ID,
    };
    render(<Harness />);
    await screen.findByTestId('mobile-call-screen');
    expect(screen.getByTestId('call-status').textContent).toBe('Connecting…');
    const mute = screen.getByTestId('call-mute-button') as HTMLButtonElement;
    const speaker = screen.getByTestId(
      'call-audio-button'
    ) as HTMLButtonElement;
    expect(mute.disabled).toBe(false);
    expect(speaker.disabled).toBe(false);
    fireEvent.click(mute);
    expect(engines.dm.toggleMute).toHaveBeenCalledTimes(1);
  });

  it('the transport chip turns Direct when WebRTC takes over', async () => {
    engines.dm = {
      ...engines.dm,
      callState: 'connected',
      callMediaReady: true,
      audioMode: 'reticulum',
      activeCallChatId: DM_ID,
    };
    const view = render(<Harness />);
    await screen.findByTestId('mobile-call-screen');
    expect(screen.getByTestId('call-transport-chip').textContent).toContain(
      'Encrypted · Relayed'
    );
    engines.dm = { ...engines.dm, audioMode: 'webrtc' };
    view.rerender(<Harness />);
    expect(screen.getByTestId('call-transport-chip').textContent).toContain(
      'Encrypted · Direct'
    );
    // WebRTC dropped (ICE lost): back on Reticulum.
    engines.dm = { ...engines.dm, audioMode: 'reticulum' };
    view.rerender(<Harness />);
    expect(screen.getByTestId('call-transport-chip').textContent).toContain(
      'Encrypted · Relayed'
    );
  });

  describe('group relaying note', () => {
    const connectedGroup = (count: number, role: string) => ({
      ...engines.gc,
      roomState: 'connected',
      roomId: 'gcall-qortal-11',
      myRole: role,
      startupStatus: { stage: 'connected', delayed: false },
      participants: Array.from({ length: count }, (_, i) => ({
        address: i === 0 ? 'QMe' : `QPeer${i}`,
        publicKey: `k${i}`,
        speaking: false,
        role: i === 0 ? role : 'participant',
      })),
    });

    afterEach(() => {
      delete (window as any).groupCall;
    });

    it('a root forwarder alone with one other person relays nothing', async () => {
      engines.gc = connectedGroup(2, 'root-forwarder');
      render(<Harness />);
      await screen.findByTestId('mobile-call-screen');
      expect(screen.queryByTestId('call-relaying-note')).toBeNull();
    });

    it("the hosted Hub manager's answer wins over the role", async () => {
      const isRelayingAudio = vi.fn((roomId: string) => {
        expect(roomId).toBe('gcall-qortal-11');
        return true;
      });
      (window as any).groupCall = { isRelayingAudio };
      engines.gc = connectedGroup(2, 'participant');
      const view = render(<Harness />);
      await screen.findByTestId('mobile-call-screen');
      expect(screen.getByTestId('call-relaying-note')).toBeTruthy();
      expect(isRelayingAudio).toHaveBeenCalled();

      // The manager says no: a forwarder role in a big room is not enough.
      (window as any).groupCall = { isRelayingAudio: () => false };
      engines.gc = connectedGroup(5, 'root-forwarder');
      view.rerender(<Harness />);
      expect(screen.queryByTestId('call-relaying-note')).toBeNull();
    });

    it('an async or broken probe falls back to the role rule', async () => {
      (window as any).groupCall = {
        isRelayingAudio: async () => true,
      };
      engines.gc = connectedGroup(3, 'cluster-forwarder');
      render(<Harness />);
      await screen.findByTestId('mobile-call-screen');
      expect(screen.getByTestId('call-relaying-note')).toBeTruthy();
    });
  });

  it('names participants the member list did not name', async () => {
    engines.gc = {
      ...engines.gc,
      roomState: 'connected',
      roomId: 'gcall-qortal-12',
      startupStatus: { stage: 'connected', delayed: false },
      participants: [
        { address: 'QMe', publicKey: 'a', speaking: false },
        { address: 'QAlice', publicKey: 'b', speaking: false },
        { address: 'QNobody', publicKey: 'c', speaking: false },
      ],
      memberPrimaryNames: {},
    };
    render(<Harness />);
    await screen.findByTestId('mobile-call-screen');
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());
    // No registered name: the short address stays.
    expect(screen.getByText('QNobody')).toBeTruthy();
  });

  it('over the phone lock, Unlock asks Android', async () => {
    engines.native = { keyguardLocked: true, requestUnlock: vi.fn() };
    engines.dm = {
      ...engines.dm,
      callState: 'connected',
      callMediaReady: true,
      activeCallChatId: DM_ID,
    };
    render(<Harness />);
    await screen.findByTestId('mobile-call-screen');
    fireEvent.click(screen.getByTestId('call-unlock-button'));
    expect(engines.native.requestUnlock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('mobile-call-screen')).toBeTruthy();
  });
});
