/**
 * GO phone call UI: one view model for 1:1 (useVoiceCall) and Qortal group
 * calls (GroupCallContext). Pure functions only, so the screens, the strip,
 * the preview page and the tests all read the same states.
 *
 * Nothing here talks to the wire: it only reads what the two call engines
 * already expose (callState / audioMode / callMediaReady for DMs, roomState /
 * startupStatus / topologyLabel / myRole for groups).
 */
import type {
  AudioEngineParticipant,
  AudioEngineRole,
  AudioEngineRoomState,
  AudioEngineTopologyLabel,
  GroupCallStartupStage,
} from '../../../lib/group-call/audioEngineTypes';

export type MobileCallKind = 'direct' | 'group';

export type MobileCallPhase =
  /** A 1:1 call ringing on this phone. */
  | 'incoming'
  /** Outgoing 1:1, not answered yet. */
  | 'calling'
  /** Outgoing 1:1 and the other side is known to ring (no wire ack yet). */
  | 'ringing'
  /** Group: entering the room. */
  | 'joining'
  /** Answered / joined, audio not flowing yet. */
  | 'connecting'
  /** Group: in the room, nobody else there yet. */
  | 'waiting'
  | 'active'
  /** 1:1: audio was flowing and stopped. */
  | 'reconnecting'
  /** Group: audio flows but the engine reports an unstable link. */
  | 'unstable'
  /** Shown for a moment after the call is over. */
  | 'ended';

/** Direct = WebRTC (faster, the peer sees the IP); relayed = Reticulum. */
export type MobileCallTransport = 'direct' | 'relayed';

export type MobileCallTone = 'pending' | 'good' | 'warning' | 'ended';

export interface MobileCallParticipant {
  address: string;
  /** Shown name: registered name, "You", or a short address. */
  label: string;
  /** Registered name used to look up the avatar. */
  avatarName?: string;
  isSelf: boolean;
  speaking: boolean;
  /** Only known for this device (the engines do not share remote mute). */
  muted: boolean;
}

export interface MobileCallView {
  kind: MobileCallKind;
  phase: MobileCallPhase;
  /** Stable per call: the DM call chat id or the group room id. */
  callKey: string;
  /** Peer name (1:1) or group name. */
  title: string;
  /** 1:1 only: the peer's address. */
  address?: string;
  /** 1:1 only: registered name for the avatar. */
  avatarName?: string;
  /** Seconds since the call connected (0 before). */
  durationSec: number;
  muted: boolean;
  transport: MobileCallTransport;
  /** Startup is taking longer than usual: show the detail line. */
  delayed: boolean;
  /** Group only, this device first. */
  participants: MobileCallParticipant[];
  maxParticipants: number;
  /** Group only: this phone forwards audio for others (cluster/root). */
  relaying: boolean;
}

/** Hub's Qortal group call limit (QortalGroupVoiceCallStage). */
export const MAX_GROUP_CALL_PARTICIPANTS = 15;

/** How long "Call ended" stays on screen. */
export const CALL_ENDED_HOLD_MS = 1_600;

export type DirectCallStateInput =
  | 'idle'
  | 'calling'
  | 'ringing'
  | 'connected'
  | 'ended';

/**
 * Phase of a 1:1 call. `hadMediaReady`: audio flowed earlier in this call,
 * so losing it again reads as reconnecting rather than connecting.
 */
export function deriveDirectPhase(input: {
  callState: DirectCallStateInput;
  callMediaReady: boolean;
  hadMediaReady: boolean;
  remoteRinging?: boolean;
}): MobileCallPhase | null {
  switch (input.callState) {
    case 'calling':
      return input.remoteRinging ? 'ringing' : 'calling';
    case 'ringing':
      return 'incoming';
    case 'connected':
      if (input.callMediaReady) return 'active';
      return input.hadMediaReady ? 'reconnecting' : 'connecting';
    case 'ended':
      return 'ended';
    default:
      return null;
  }
}

/** Phase of a group call from the controller snapshot. */
export function deriveGroupPhase(input: {
  roomState: AudioEngineRoomState;
  stage: GroupCallStartupStage;
}): MobileCallPhase | null {
  if (input.roomState === 'joining') return 'joining';
  if (input.roomState === 'ended') return 'ended';
  if (input.roomState !== 'connected') return null;
  switch (input.stage) {
    case 'joining-call':
      return 'joining';
    case 'syncing-participants':
      return 'waiting';
    case 'securing-audio':
    case 'starting-audio':
      return 'connecting';
    case 'degraded':
      return 'unstable';
    default:
      return 'active';
  }
}

export const isQortalGroupRoom = (roomId: string | null | undefined) =>
  typeof roomId === 'string' && roomId.startsWith('gcall-qortal-');

/** Roles that forward other people's audio (Hub rules elect them). */
export function isRelayingRole(role: AudioEngineRole | null | undefined) {
  return role === 'cluster-forwarder' || role === 'root-forwarder';
}

/**
 * The "You're relaying audio" note. The hosted Hub manager's answer wins
 * (`hosted`, Hub's forward-recipient rule). Without it: a forwarder role
 * with at least three people in the room (a forwarder in a 2-person room
 * passes nobody's audio on).
 */
export function groupRelaying(input: {
  connected: boolean;
  hosted: boolean | null;
  role: AudioEngineRole | null | undefined;
  participantCount: number;
}): boolean {
  if (!input.connected) return false;
  if (typeof input.hosted === 'boolean') return input.hosted;
  return isRelayingRole(input.role) && input.participantCount >= 3;
}

export function directTransport(
  audioMode: 'reticulum' | 'webrtc' | null | undefined
): MobileCallTransport {
  return audioMode === 'webrtc' ? 'direct' : 'relayed';
}

export function groupTransport(
  label: AudioEngineTopologyLabel | null | undefined
): MobileCallTransport {
  return label === 'WebRTC' ? 'direct' : 'relayed';
}

export function shortCallAddress(address: string): string {
  if (!address || address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** mm:ss, or h:mm:ss from an hour on. */
export function formatCallDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function callTone(phase: MobileCallPhase): MobileCallTone {
  switch (phase) {
    case 'active':
      return 'good';
    case 'reconnecting':
    case 'unstable':
      return 'warning';
    case 'ended':
      return 'ended';
    default:
      return 'pending';
  }
}

/** Phases where the mic and audio route can be changed. */
export function controlsLive(phase: MobileCallPhase): boolean {
  return phase !== 'ended' && phase !== 'incoming';
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * GO's own language for Android's call notifications (QortalCall.setStrings,
 * keys = NATIVE_CALL_STRING_KEYS in src/plugins/QortalCall.ts).
 */
export function nativeCallStrings(t: Translate): Record<string, string> {
  return {
    call_incoming_title: t('core:go_call.incoming_call'),
    call_incoming_text: t('core:go_call.incoming_title'),
    call_action_accept: t('core:go_call.accept'),
    call_action_decline: t('core:go_call.decline'),
    call_action_hang_up: t('core:go_call.hang_up'),
    call_action_leave: t('core:go_call.leave'),
    call_action_mute: t('core:go_call.mute'),
    call_action_unmute: t('core:go_call.unmute'),
    call_status_calling: t('core:go_call.calling'),
    call_status_connecting: t('core:go_call.connecting'),
    call_status_ongoing: t('core:go_call.ongoing_call'),
    call_status_group: t('core:go_call.group_call'),
    call_status_muted: t('core:go_call.muted'),
    call_unknown_caller: t('core:go_call.unknown_caller'),
  };
}

/** The big state line under the name. */
export function callStatusText(t: Translate, view: MobileCallView): string {
  switch (view.phase) {
    case 'incoming':
      return t('core:go_call.incoming_title');
    case 'calling':
      return t('core:go_call.calling');
    case 'ringing':
      return t('core:go_call.ringing');
    case 'joining':
      return t('core:go_call.joining');
    case 'connecting':
      return t('core:go_call.connecting');
    case 'waiting':
      return t('core:go_call.waiting_for_others');
    case 'reconnecting':
      return t('core:go_call.reconnecting');
    case 'unstable':
      return t('core:go_call.weak_connection');
    case 'ended':
      return view.durationSec > 0
        ? t('core:go_call.ended_with_duration', {
            duration: formatCallDuration(view.durationSec),
          })
        : t('core:go_call.ended');
    case 'active':
    default:
      return formatCallDuration(view.durationSec);
  }
}

/** The smaller line shown when startup takes longer than usual. */
export function callDetailText(
  t: Translate,
  view: MobileCallView
): string | null {
  if (!view.delayed) return null;
  switch (view.phase) {
    case 'calling':
    case 'ringing':
      return t('core:go_call.still_waiting_answer');
    case 'joining':
    case 'connecting':
      return t('core:go_call.still_connecting');
    default:
      return null;
  }
}

export function transportText(
  t: Translate,
  transport: MobileCallTransport
): string {
  return transport === 'direct'
    ? t('core:go_call.encrypted_direct')
    : t('core:go_call.encrypted_relayed');
}

/** Participant tiles for the phone stage, this device first. */
export function buildGroupParticipants(input: {
  participants: AudioEngineParticipant[];
  activeSpeakers: string[];
  myAddress: string;
  myName?: string;
  muted: boolean;
  names: Record<string, string>;
  youLabel: string;
}): MobileCallParticipant[] {
  const speaking = new Set(input.activeSpeakers);
  const seen = new Set<string>();
  const list: MobileCallParticipant[] = [];
  for (const participant of input.participants) {
    const address = participant?.address?.trim?.() ?? '';
    // Unresolved placeholders stay off the grid, as on Hub's stage
    // (isResolvedGroupCallParticipantAddress).
    if (!address || address.toLowerCase() === 'unknown' || seen.has(address)) {
      continue;
    }
    seen.add(address);
    const isSelf = address === input.myAddress;
    const registered =
      input.names[address]?.trim() ||
      (isSelf ? input.myName?.trim() || '' : '');
    list.push({
      address,
      label: isSelf ? input.youLabel : registered || shortCallAddress(address),
      avatarName: registered || undefined,
      isSelf,
      speaking:
        Boolean(participant.speaking) ||
        speaking.has(address) ||
        (participant.publicKey ? speaking.has(participant.publicKey) : false),
      muted: isSelf ? input.muted : false,
    });
  }
  list.sort((a, b) => {
    if (a.isSelf) return -1;
    if (b.isSelf) return 1;
    return a.label.localeCompare(b.label);
  });
  return list;
}

/**
 * Columns and avatar size for the participant grid: a big face when alone,
 * two big tiles for two, then 2x2 and three columns; more columns when the
 * stage is wide (landscape, tablets).
 */
export function groupGridLayout(
  count: number,
  options: { wide?: boolean } = {}
): { columns: number; avatarPx: number } {
  const n = Math.max(1, count);
  if (options.wide) {
    if (n <= 1) return { columns: 1, avatarPx: 120 };
    if (n <= 2) return { columns: 2, avatarPx: 108 };
    if (n <= 4) return { columns: 4, avatarPx: 88 };
    if (n <= 8) return { columns: 4, avatarPx: 76 };
    return { columns: 5, avatarPx: 64 };
  }
  if (n <= 1) return { columns: 1, avatarPx: 128 };
  if (n <= 2) return { columns: 1, avatarPx: 104 };
  if (n <= 4) return { columns: 2, avatarPx: 88 };
  if (n <= 9) return { columns: 3, avatarPx: 72 };
  return { columns: 3, avatarPx: 64 };
}

/**
 * The state Android's call session mirrors (src/bridge/nativeCallSession.ts
 * nativeCallStep): ringing, or an active call's phase.
 */
export type NativeCallState =
  | 'idle'
  | 'ringing'
  | 'calling'
  | 'joining'
  | 'connecting'
  | 'connected'
  | 'ended';

export function nativeStateForView(
  view: MobileCallView | null,
  incoming: boolean
): NativeCallState {
  if (incoming) return 'ringing';
  if (!view) return 'idle';
  switch (view.phase) {
    case 'calling':
    case 'ringing':
      return 'calling';
    case 'joining':
      return 'joining';
    case 'connecting':
      return 'connecting';
    case 'ended':
      return 'ended';
    case 'incoming':
      return 'ringing';
    default:
      return 'connected';
  }
}

/**
 * Which running call answering a ringing 1:1 call has to end first (the same
 * rule as CallSwitchGuardContext's drop plan, without its dialog, so it also
 * works over the lock screen).
 */
export function incomingSwitchPlan(input: {
  directState: DirectCallStateInput;
  groupRoomState: AudioEngineRoomState;
}): { dropDirect: boolean; dropGroup: boolean } {
  return {
    dropDirect:
      input.directState === 'calling' || input.directState === 'connected',
    dropGroup:
      input.groupRoomState === 'joining' ||
      input.groupRoomState === 'connected',
  };
}
