import { describe, expect, it } from 'vitest';
import {
  buildGroupParticipants,
  callDetailText,
  callStatusText,
  callTone,
  deriveDirectPhase,
  deriveGroupPhase,
  directTransport,
  formatCallDuration,
  groupGridLayout,
  groupTransport,
  incomingSwitchPlan,
  isQortalGroupRoom,
  groupRelaying,
  isRelayingRole,
  nativeCallStrings,
  nativeStateForView,
  type MobileCallView,
} from './callUiModel';
import { NATIVE_CALL_STRING_KEYS } from '../../../plugins/QortalCall';

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}${JSON.stringify(options)}` : key;

const view = (over: Partial<MobileCallView> = {}): MobileCallView => ({
  kind: 'direct',
  phase: 'active',
  callKey: 'direct:QA:QB',
  title: 'alice',
  address: 'QB',
  durationSec: 0,
  muted: false,
  transport: 'relayed',
  delayed: false,
  participants: [],
  maxParticipants: 2,
  relaying: false,
  ...over,
});

describe('deriveDirectPhase', () => {
  it('maps the 1:1 hook states', () => {
    const base = { callMediaReady: false, hadMediaReady: false };
    expect(deriveDirectPhase({ ...base, callState: 'idle' })).toBeNull();
    expect(deriveDirectPhase({ ...base, callState: 'calling' })).toBe(
      'calling'
    );
    expect(
      deriveDirectPhase({ ...base, callState: 'calling', remoteRinging: true })
    ).toBe('ringing');
    expect(deriveDirectPhase({ ...base, callState: 'ringing' })).toBe(
      'incoming'
    );
    expect(deriveDirectPhase({ ...base, callState: 'connected' })).toBe(
      'connecting'
    );
    expect(
      deriveDirectPhase({
        callState: 'connected',
        callMediaReady: true,
        hadMediaReady: true,
      })
    ).toBe('active');
    expect(
      deriveDirectPhase({
        callState: 'connected',
        callMediaReady: false,
        hadMediaReady: true,
      })
    ).toBe('reconnecting');
    expect(deriveDirectPhase({ ...base, callState: 'ended' })).toBe('ended');
  });
});

describe('deriveGroupPhase', () => {
  it('follows room state and startup stage', () => {
    expect(deriveGroupPhase({ roomState: 'idle', stage: 'idle' })).toBeNull();
    expect(
      deriveGroupPhase({ roomState: 'joining', stage: 'joining-call' })
    ).toBe('joining');
    expect(
      deriveGroupPhase({
        roomState: 'connected',
        stage: 'syncing-participants',
      })
    ).toBe('waiting');
    expect(
      deriveGroupPhase({ roomState: 'connected', stage: 'securing-audio' })
    ).toBe('connecting');
    expect(
      deriveGroupPhase({ roomState: 'connected', stage: 'degraded' })
    ).toBe('unstable');
    expect(
      deriveGroupPhase({ roomState: 'connected', stage: 'connected' })
    ).toBe('active');
    expect(deriveGroupPhase({ roomState: 'ended', stage: 'idle' })).toBe(
      'ended'
    );
  });
});

describe('small helpers', () => {
  it('formats durations', () => {
    expect(formatCallDuration(0)).toBe('00:00');
    expect(formatCallDuration(201)).toBe('03:21');
    expect(formatCallDuration(3_725)).toBe('1:02:05');
    expect(formatCallDuration(-4)).toBe('00:00');
  });

  it('maps transports', () => {
    expect(directTransport('webrtc')).toBe('direct');
    expect(directTransport('reticulum')).toBe('relayed');
    expect(directTransport(null)).toBe('relayed');
    expect(groupTransport('WebRTC')).toBe('direct');
    expect(groupTransport('Reticulum')).toBe('relayed');
  });

  it('knows relaying roles and Qortal rooms', () => {
    expect(isRelayingRole('root-forwarder')).toBe(true);
    expect(isRelayingRole('cluster-forwarder')).toBe(true);
    expect(isRelayingRole('standby-forwarder')).toBe(false);
    expect(isRelayingRole('participant')).toBe(false);
    expect(isQortalGroupRoom('gcall-qortal-12')).toBe(true);
    expect(isQortalGroupRoom('direct:QA:QB')).toBe(false);
  });

  it('tones', () => {
    expect(callTone('active')).toBe('good');
    expect(callTone('reconnecting')).toBe('warning');
    expect(callTone('unstable')).toBe('warning');
    expect(callTone('calling')).toBe('pending');
    expect(callTone('ended')).toBe('ended');
  });
});

describe('texts', () => {
  it('status line per phase', () => {
    expect(callStatusText(t, view({ phase: 'calling' }))).toBe(
      'core:go_call.calling'
    );
    expect(callStatusText(t, view({ phase: 'active', durationSec: 65 }))).toBe(
      '01:05'
    );
    expect(callStatusText(t, view({ phase: 'reconnecting' }))).toBe(
      'core:go_call.reconnecting'
    );
    expect(callStatusText(t, view({ phase: 'ended', durationSec: 0 }))).toBe(
      'core:go_call.ended'
    );
    expect(callStatusText(t, view({ phase: 'ended', durationSec: 201 }))).toBe(
      'core:go_call.ended_with_duration{"duration":"03:21"}'
    );
  });

  it('detail line only when delayed', () => {
    expect(callDetailText(t, view({ phase: 'calling' }))).toBeNull();
    expect(callDetailText(t, view({ phase: 'calling', delayed: true }))).toBe(
      'core:go_call.still_waiting_answer'
    );
    expect(
      callDetailText(t, view({ phase: 'connecting', delayed: true }))
    ).toBe('core:go_call.still_connecting');
    expect(callDetailText(t, view({ phase: 'active', delayed: true }))).toBe(
      null
    );
  });
});

describe('buildGroupParticipants', () => {
  it('puts this device first, resolves names, drops placeholders', () => {
    const list = buildGroupParticipants({
      participants: [
        {
          address: 'QZed',
          publicKey: 'pkz',
          speaking: false,
          role: 'participant',
        },
        {
          address: 'unknown',
          publicKey: '',
          speaking: false,
          role: 'participant',
        },
        {
          address: 'QMe',
          publicKey: 'pkme',
          speaking: false,
          role: 'root-forwarder',
        },
        {
          address: 'QAnn',
          publicKey: 'pka',
          speaking: false,
          role: 'participant',
        },
        {
          address: 'QAnn',
          publicKey: 'pka',
          speaking: false,
          role: 'participant',
        },
      ],
      activeSpeakers: ['QAnn'],
      myAddress: 'QMe',
      myName: 'me-name',
      muted: true,
      names: { QAnn: 'ann' },
      youLabel: 'You',
    });
    expect(list.map((p) => p.address)).toEqual(['QMe', 'QAnn', 'QZed']);
    expect(list[0]).toMatchObject({
      label: 'You',
      isSelf: true,
      muted: true,
      avatarName: 'me-name',
    });
    expect(list[1]).toMatchObject({ label: 'ann', speaking: true });
    expect(list[2]).toMatchObject({ label: 'QZed', avatarName: undefined });
  });
});

describe('groupGridLayout', () => {
  it('grows from one face to three columns', () => {
    expect(groupGridLayout(1)).toEqual({ columns: 1, avatarPx: 128 });
    expect(groupGridLayout(2).columns).toBe(1);
    expect(groupGridLayout(4).columns).toBe(2);
    expect(groupGridLayout(9).columns).toBe(3);
    expect(groupGridLayout(15).columns).toBe(3);
    expect(groupGridLayout(9, { wide: true }).columns).toBe(5);
  });
});

describe('incomingSwitchPlan / nativeStateForView', () => {
  it('drops a running group call when answering', () => {
    expect(
      incomingSwitchPlan({
        directState: 'ringing',
        groupRoomState: 'connected',
      })
    ).toEqual({ dropDirect: false, dropGroup: true });
    expect(
      incomingSwitchPlan({ directState: 'ringing', groupRoomState: 'idle' })
    ).toEqual({ dropDirect: false, dropGroup: false });
  });

  it('mirrors the call for Android', () => {
    expect(nativeStateForView(null, true)).toBe('ringing');
    expect(nativeStateForView(null, false)).toBe('idle');
    expect(nativeStateForView(view({ phase: 'calling' }), false)).toBe(
      'calling'
    );
    expect(nativeStateForView(view({ phase: 'connecting' }), false)).toBe(
      'connecting'
    );
    expect(nativeStateForView(view({ phase: 'joining' }), false)).toBe(
      'joining'
    );
    expect(nativeStateForView(view({ phase: 'reconnecting' }), false)).toBe(
      'connected'
    );
    expect(nativeStateForView(view({ phase: 'ended' }), false)).toBe('ended');
  });

  it('relaying: the hosted manager decides, else a forwarder in a 3+ room', () => {
    const base = { connected: true, hosted: null, participantCount: 3 };
    expect(groupRelaying({ ...base, role: 'root-forwarder' })).toBe(true);
    expect(groupRelaying({ ...base, role: 'cluster-forwarder' })).toBe(true);
    expect(groupRelaying({ ...base, role: 'participant' })).toBe(false);
    // A forwarder in a 2-person room passes nobody's audio on.
    expect(
      groupRelaying({ ...base, role: 'root-forwarder', participantCount: 2 })
    ).toBe(false);
    expect(groupRelaying({ ...base, hosted: true, role: 'participant' })).toBe(
      true
    );
    expect(
      groupRelaying({ ...base, hosted: false, role: 'root-forwarder' })
    ).toBe(false);
    expect(
      groupRelaying({ ...base, connected: false, hosted: true, role: null })
    ).toBe(false);
  });

  it('gives Android every call notification text', () => {
    const strings = nativeCallStrings(t);
    expect(Object.keys(strings).sort()).toEqual(
      [...NATIVE_CALL_STRING_KEYS].sort()
    );
    for (const value of Object.values(strings)) {
      expect(value.startsWith('core:go_call.')).toBe(true);
    }
  });
});
