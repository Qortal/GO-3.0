import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/qdnAvatars/useQdnAvatar', () => ({
  useQdnAvatar: () => ({ src: undefined, status: 'missing' }),
}));

import '../../../i18n/i18n';
import { ANDROID_BACK_EVENT } from '../../../bridge/capacitorBridge';
import type { MobileCallParticipant, MobileCallView } from './callUiModel';
import { audioButtonKind, MobileCallScreen } from './MobileCallScreen';
import { MobileIncomingCallScreen } from './MobileIncomingCallScreen';
import { MobileCallStrip } from './MobileCallStrip';

const direct = (over: Partial<MobileCallView> = {}): MobileCallView => ({
  kind: 'direct',
  phase: 'active',
  callKey: 'direct:QAlice:QMe',
  title: 'alice',
  address: 'QAliceAddressXYZ123',
  avatarName: 'alice',
  durationSec: 201,
  muted: false,
  transport: 'direct',
  delayed: false,
  participants: [],
  maxParticipants: 2,
  relaying: false,
  ...over,
});

const people = (n: number): MobileCallParticipant[] =>
  Array.from({ length: n }, (_, i) => ({
    address: i === 0 ? 'QMe' : `QPeer${i}`,
    label: i === 0 ? 'You' : `peer ${i}`,
    isSelf: i === 0,
    speaking: i === 1,
    muted: false,
  }));

const group = (over: Partial<MobileCallView> = {}): MobileCallView => ({
  kind: 'group',
  phase: 'active',
  callKey: 'gcall-qortal-7',
  title: 'Qortal devs',
  durationSec: 42,
  muted: false,
  transport: 'relayed',
  delayed: false,
  participants: people(4),
  maxParticipants: 15,
  relaying: false,
  ...over,
});

const audio = {
  routes: [{ type: 'earpiece' as const }, { type: 'speaker' as const }],
  current: 'earpiece' as const,
  onSelect: vi.fn(),
};

const pressBack = () => {
  const event = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('MobileCallScreen (1:1)', () => {
  const handlers = () => ({
    onMinimize: vi.fn(),
    onToggleMute: vi.fn(),
    onHangUp: vi.fn(),
    onMessage: vi.fn(),
  });

  it('shows name, timer and the direct transport chip', () => {
    const h = handlers();
    render(
      <MobileCallScreen
        view={direct()}
        locked={false}
        zIndex={2050}
        audio={audio}
        {...h}
      />
    );
    expect(screen.getByRole('heading', { name: 'alice' })).toBeTruthy();
    expect(screen.getByTestId('call-status').textContent).toBe('03:21');
    expect(screen.getByTestId('call-transport-chip').textContent).toContain(
      'Encrypted · Direct'
    );
    fireEvent.click(screen.getByTestId('call-transport-chip'));
    expect(screen.getByTestId('call-transport-help').textContent).toContain(
      'IP address'
    );
  });

  it('wires mute, speaker, message, hang up and minimize', () => {
    const h = handlers();
    render(
      <MobileCallScreen
        view={direct()}
        locked={false}
        zIndex={2050}
        audio={audio}
        {...h}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(h.onToggleMute).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Speaker' }));
    expect(audio.onSelect).toHaveBeenCalledWith('speaker');
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    expect(h.onMessage).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Hang up' }));
    expect(h.onHangUp).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize call' }));
    expect(h.onMinimize).toHaveBeenCalledTimes(1);
  });

  it('labels each phase', () => {
    const h = handlers();
    const { rerender } = render(
      <MobileCallScreen
        view={direct({ phase: 'calling', durationSec: 0 })}
        locked={false}
        zIndex={2050}
        audio={audio}
        {...h}
      />
    );
    expect(screen.getByTestId('call-status').textContent).toBe('Calling…');
    expect(screen.queryByTestId('call-transport-chip')).toBeNull();
    rerender(
      <MobileCallScreen
        view={direct({ phase: 'connecting', delayed: true })}
        locked={false}
        zIndex={2050}
        audio={audio}
        {...h}
      />
    );
    expect(screen.getByTestId('call-status').textContent).toBe('Connecting…');
    expect(
      screen.getByText('Still setting up the secure audio link…')
    ).toBeTruthy();
    rerender(
      <MobileCallScreen
        view={direct({ phase: 'reconnecting', transport: 'relayed' })}
        locked={false}
        zIndex={2050}
        audio={audio}
        {...h}
      />
    );
    expect(screen.getByTestId('call-status').textContent).toBe('Reconnecting…');
    expect(screen.getByTestId('call-transport-chip').textContent).toContain(
      'Relayed'
    );
    rerender(
      <MobileCallScreen
        view={direct({ phase: 'ended' })}
        locked={false}
        zIndex={2050}
        audio={audio}
        {...h}
      />
    );
    expect(screen.getByTestId('call-status').textContent).toBe(
      'Call ended · 03:21'
    );
    expect(
      (screen.getByTestId('call-hangup-button') as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('over the lock: no minimize, no Message, a lock note', () => {
    const h = handlers();
    render(
      <MobileCallScreen
        view={direct()}
        locked
        zIndex={2050}
        audio={audio}
        {...h}
      />
    );
    expect(screen.queryByTestId('call-minimize-button')).toBeNull();
    expect(screen.queryByTestId('call-message-button')).toBeNull();
    expect(screen.getByTestId('call-locked-note')).toBeTruthy();
  });

  it('opens the route sheet when Bluetooth is available', () => {
    const h = handlers();
    const onSelect = vi.fn();
    render(
      <MobileCallScreen
        view={direct()}
        locked={false}
        zIndex={2050}
        audio={{
          routes: [
            { type: 'earpiece' },
            { type: 'speaker' },
            { type: 'bluetooth', name: 'Pixel Buds' },
          ],
          current: 'bluetooth',
          onSelect,
        }}
        {...h}
      />
    );
    fireEvent.click(screen.getByTestId('call-audio-button'));
    expect(screen.getByTestId('call-audio-route-sheet')).toBeTruthy();
    expect(screen.getAllByText('Pixel Buds').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('radio', { name: /Speaker/ }));
    expect(onSelect).toHaveBeenCalledWith('speaker');
  });

  it('two routes that are not earpiece + speaker open the sheet (tablet + Bluetooth)', () => {
    const h = handlers();
    const onSelect = vi.fn();
    render(
      <MobileCallScreen
        view={direct()}
        locked={false}
        zIndex={2050}
        audio={{
          routes: [{ type: 'speaker' }, { type: 'bluetooth', name: 'Buds' }],
          current: 'speaker',
          onSelect,
        }}
        {...h}
      />
    );
    fireEvent.click(screen.getByTestId('call-audio-button'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId('call-audio-route-sheet')).toBeTruthy();
  });

  it('picks the audio button by which routes there are', () => {
    expect(audioButtonKind([{ type: 'earpiece' }, { type: 'speaker' }])).toBe(
      'toggle'
    );
    expect(audioButtonKind([{ type: 'speaker' }, { type: 'bluetooth' }])).toBe(
      'sheet'
    );
    expect(audioButtonKind([{ type: 'earpiece' }, { type: 'wired' }])).toBe(
      'sheet'
    );
    expect(
      audioButtonKind([
        { type: 'earpiece' },
        { type: 'speaker' },
        { type: 'bluetooth' },
      ])
    ).toBe('sheet');
    expect(audioButtonKind([{ type: 'speaker' }])).toBe('single');
  });

  it('a phone with only a loudspeaker (tablet, emulator) never looks switched off', () => {
    const h = handlers();
    const onSelect = vi.fn();
    render(
      <MobileCallScreen
        view={direct({ phase: 'connecting' })}
        locked={false}
        zIndex={2050}
        audio={{ routes: [{ type: 'speaker' }], current: 'speaker', onSelect }}
        {...h}
      />
    );
    const button = screen.getByTestId('call-audio-button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Speaker');
    fireEvent.click(button);
    expect(screen.getByTestId('call-audio-route-sheet')).toBeTruthy();
    expect(
      screen
        .getByRole('radio', { name: /Speaker/ })
        .getAttribute('aria-checked')
    ).toBe('true');
  });

  it('the sheet closes on Android back before anything else', () => {
    const h = handlers();
    render(
      <MobileCallScreen
        view={group()}
        locked={false}
        zIndex={2050}
        audio={audio}
        {...h}
        initialSheet="participants"
      />
    );
    expect(screen.getByTestId('call-participants-sheet')).toBeTruthy();
    expect(pressBack()).toBe(true);
    expect(h.onMinimize).not.toHaveBeenCalled();
  });
});

describe('MobileCallScreen (group stage)', () => {
  const h = () => ({
    onMinimize: vi.fn(),
    onToggleMute: vi.fn(),
    onHangUp: vi.fn(),
  });

  it.each([1, 4, 9])('lays out %i participants', (n) => {
    render(
      <MobileCallScreen
        view={group({ participants: people(n) })}
        locked={false}
        zIndex={2050}
        audio={audio}
        {...h()}
      />
    );
    expect(screen.getAllByTestId('call-participant-tile')).toHaveLength(n);
    const grid = screen.getByTestId('call-participant-grid');
    expect(grid.getAttribute('data-columns')).toBe(
      n === 1 ? '1' : n === 4 ? '2' : '3'
    );
  });

  it('shows the relaying note with its explanation', () => {
    render(
      <MobileCallScreen
        view={group({ relaying: true })}
        locked={false}
        zIndex={2050}
        audio={audio}
        {...h()}
      />
    );
    fireEvent.click(screen.getByTestId('call-relaying-note'));
    expect(screen.getByTestId('call-relaying-help').textContent).toContain(
      'Hub'
    );
  });

  it('marks speakers and says Leave', () => {
    render(
      <MobileCallScreen
        view={group()}
        locked={false}
        zIndex={2050}
        audio={audio}
        {...h()}
      />
    );
    const speaking = screen
      .getAllByTestId('call-participant-tile')
      .filter((tile) => tile.getAttribute('data-speaking') === 'true');
    expect(speaking).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Leave' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '4 in call' })).toBeTruthy();
  });
});

describe('MobileIncomingCallScreen', () => {
  it('accepts and declines', () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(
      <MobileIncomingCallScreen
        callerName="bob"
        callerAddress="QBobAddress1234567"
        zIndex={50010}
        locked={false}
        switchFrom={null}
        ringerSilenced={false}
        onAccept={onAccept}
        onDecline={onDecline}
      />
    );
    expect(screen.getByTestId('incoming-caller-name').textContent).toBe('bob');
    expect(screen.getByText('GO voice call')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('says that answering ends the group call', () => {
    render(
      <MobileIncomingCallScreen
        callerName="bob"
        callerAddress="QBobAddress1234567"
        zIndex={50010}
        locked
        switchFrom="group"
        ringerSilenced
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />
    );
    expect(screen.getByTestId('incoming-switch-hint').textContent).toBe(
      'Answering ends Your group call'
    );
    expect(screen.getByRole('button', { name: 'End & accept' })).toBeTruthy();
    expect(screen.getByTestId('incoming-ringer-silenced')).toBeTruthy();
    expect(
      screen.getByText('GO stays locked. Only this call is shown.')
    ).toBeTruthy();
  });
});

describe('MobileCallStrip', () => {
  it('opens, mutes and hangs up', () => {
    const onOpen = vi.fn();
    const onToggleMute = vi.fn();
    const onHangUp = vi.fn();
    render(
      <MobileCallStrip
        view={direct({ muted: true })}
        variant="bar"
        onOpen={onOpen}
        onToggleMute={onToggleMute}
        onHangUp={onHangUp}
      />
    );
    expect(screen.getByTestId('call-strip-status').textContent).toBe('03:21');
    fireEvent.click(screen.getByRole('button', { name: 'Return to the call' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hang up' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onToggleMute).toHaveBeenCalledTimes(1);
    expect(onHangUp).toHaveBeenCalledTimes(1);
  });

  it('floating pill for a group call', () => {
    render(
      <MobileCallStrip
        view={group({ phase: 'joining' })}
        variant="floating"
        onOpen={vi.fn()}
        onToggleMute={vi.fn()}
        onHangUp={vi.fn()}
      />
    );
    expect(screen.getByTestId('call-strip-floating')).toBeTruthy();
    expect(screen.getByTestId('call-strip-status').textContent).toBe(
      'Joining…'
    );
    expect(screen.getByRole('button', { name: 'Leave' })).toBeTruthy();
  });
});
