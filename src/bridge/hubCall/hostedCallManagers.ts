/**
 * Hosts the UNMODIFIED Hub 3.0.3 call managers inside GO's WebView:
 *   electron/src/call.ts       — CallManager (CALL_* signaling, endpoint pinning)
 *   electron/src/group-call.ts — GroupCallManager (DM media rooms + group calls,
 *                                link-auth, keys, heartbeats, WebRTC signals)
 * behind GO-owned adapters (Python transport, presence), and wires them like
 * the desktop main process does (electron/src/setup.ts attachCallListeners
 * ~6467 / attachGroupCallListeners ~6686):
 *   - CallManager → GroupCallManager: DM hang-up over the media link
 *     (setDmCallLinkControlSender → sendDmCallLinkControl)
 *   - GroupCallManager 'gcall:dm-call-control' → CallManager hang-up / ack
 *   - 'call:history' → injected onCallHistory (desktop: ReticulumChatManager
 *     .recordDirectCallHistory; wave 2 wires GO's shared chat engine)
 *   - renderer channels call:* / gcall:* re-emitted on `events`
 *     (`gcall:audio` data as a plain Uint8Array + audioStageTimestamps, like
 *     the desktop IPC fan-out)
 * GO-only additions (wire-neutral):
 *   - a pending call that expires (Hub's silent 60 s timeout) emits
 *     `call:hangup` so the hook never stays "ringing"/"calling" (contract a.5);
 *   - Hub bug H1 neutralised per instance (gcSignatureCacheHardening.ts);
 *   - overlay relays dropped, pinned CALL_REQUEST copies (adapter options);
 *   - on accept of a call GO placed, a freshly signed cancel to the callee's
 *     other devices (freshRingingCancel.ts: Hub's pre-signed one expires
 *     after 30 s).
 *
 * `./nodeGlobals` must stay the first import (Buffer/setImmediate/base64url
 * before the managers' module bodies run).
 */
import './nodeGlobals';
import { EventEmitter } from 'events';
import {
  CallManager,
  type DirectCallHistoryUpdate,
  type DmCallLinkControlPayload,
} from '../../../electron/src/call';
import {
  GroupCallManager,
  type DmCallLinkControlInput,
} from '../../../electron/src/group-call';
import type { PresenceManager } from '../../../electron/src/presence';
import type { ReticulumBridge } from '../../../electron/src/reticulum-bridge';
import {
  MobileReticulumBridgeAdapter,
  type MobileReticulumBridgeAdapterOptions,
} from './mobileReticulumBridgeAdapter';
import {
  MobilePresenceAdapter,
  type MobilePresenceSource,
} from './mobilePresenceAdapter';
import type { HubCallPythonTransport } from './pythonTransport';
import { hardenGroupCallSignatureCache } from './gcSignatureCacheHardening';
import {
  installFreshRingingCancel,
  type CancelSigningFields,
} from './freshRingingCancel';
import {
  CALL_EVENT_CHANNELS,
  createWindowCallApi,
  type WindowCallApi,
} from './callIpc';
import {
  GROUP_CALL_ACTIVITY_CHANNEL,
  GROUP_CALL_EVENT_CHANNELS,
  createWindowGroupCallApi,
  type WindowGroupCallApi,
} from './groupCallIpc';

export type { DirectCallHistoryUpdate } from '../../../electron/src/call';

/** See HostedCallManagersDeps.callRouteMaxAgeMs. */
export const DEFAULT_CALL_ROUTE_MAX_AGE_MS = 60 * 60 * 1_000;

export type HostedCallManagersDeps = {
  transport: HubCallPythonTransport;
  presenceSource: MobilePresenceSource;
  /** Desktop: ReticulumChatManager.recordDirectCallHistory (setup.ts:6495). */
  onCallHistory?: (update: DirectCallHistoryUpdate) => void | Promise<void>;
  /**
   * QortalLand active call endpoint (desktop setup.ts:6817-6823:
   * ReticulumChatManager.getActiveLandCallMediaPeerDestinationHash). When
   * omitted, GO's chat engine RPC
   * `window.reticulumChat.getActiveLandCallMediaPeerDestinationHash` is used
   * if it exists (feature-detected; without it Land DM voice joins are
   * refused 'unverified_dm_voice_peer_destination', like desktop with no
   * record). Pass `null` to disable the lookup.
   */
  getActiveLandCallMediaPeerDestinationHash?:
    | null
    | ((
        chatId: string,
        localAddress: string,
        callId: string
      ) => string | null | undefined | Promise<string | null | undefined>);
  /**
   * Signs CALL_* field sets with the account key (Base58 signature), like the
   * hook's signer. Default: the renderer wallet (`window.sendMessage
   * ('signPresenceMessage')`). `null` turns the fresh ringing cancel off.
   */
  signCallFields?:
    | null
    | ((fields: CancelSigningFields) => Promise<string | null>);
  /** Optional periodic member-allowlist refresh for group rooms (plan 5.5). */
  fetchQortalGroupMemberAddresses?: (
    groupId: number
  ) => Promise<string[] | null | undefined>;
  /** Re-flood other people's overlay frames (default false: GO is a leaf). */
  relayOverlayFrames?: boolean;
  /** Pinned copies of our CALL_REQUEST to the callee's endpoints (default true). */
  pinnedCallRequests?: boolean;
  /** Loopback WebSocket audio data plane (default false, plan 5.2). */
  audioDataPlane?: boolean;
  /** Presence endpoint freshness for routes (default 90 s). */
  presenceMaxAgeMs?: number;
  /**
   * How old an endpoint may be for CallManager's call routes (who a call
   * request goes to). Default 1 h: a phone off screen on battery stops
   * heartbeating but still receives a call request and rings natively
   * (lib/call/recentCallEndpoint). The group/media side keeps
   * presenceMaxAgeMs. 0 = same as presenceMaxAgeMs.
   */
  callRouteMaxAgeMs?: number;
  /** Adapter command timeout (tests). */
  commandTimeoutMs?: number;
};

export type HostedCallStack = {
  callManager: CallManager;
  groupCallManager: GroupCallManager;
  bridge: MobileReticulumBridgeAdapter;
  presence: MobilePresenceAdapter;
  /** Renderer-facing channels: call:*, gcall:*, gcall:qortal-group-call-activity. */
  events: EventEmitter;
  /** Drop-in `window.call`. */
  call: WindowCallApi;
  /** Drop-in `window.groupCall`. */
  groupCall: WindowGroupCallApi;
  /** Logout boundary (setup.ts reticulumChat:clearLocalAccountState). */
  clearLocalAccountState(): void;
  /** Python bridge (re)reported `ready`: re-attach like setReticulumBridge. */
  notifyBridgeReady(): void;
  /** Stop managers, timers and listeners. */
  dispose(): void;
  /**
   * True while this device forwards third-party audio in a joined group
   * room: some other participant's audio goes from here to yet another
   * participant (Hub's computeReticulumAudioForwardRecipients rule). The
   * root of a two-person room relays nothing. For the "You're relaying
   * audio" note. Without roomId: any room. Re-check on `gcall:topology`
   * and `gcall:participant-joined/-left` events.
   */
  isRelayingAudio(roomId?: string): boolean;
  /**
   * True while the local account is in a DM media room (`dmv:`), i.e. a 1:1
   * call's media/RTC session is live.
   */
  hasActiveDirectVoiceRoom(): boolean;
  readonly hardenedGcSignatureCache: boolean;
  /** Answer on one callee device cancels the others with a fresh signature. */
  readonly freshRingingCancel: boolean;
};

export type RelayTopologyView = {
  rootForwarder?: string;
  clusters?: Array<{ members?: string[]; forwarder?: string }>;
};

type RoomTopologyView = {
  participants?: Map<string, unknown>;
  lastTopology?: RelayTopologyView;
};

/**
 * Mirror of Hub 3.0.3 GroupCallManager.computeReticulumAudioForwardRecipients
 * (group-call.ts ~6181): who this device forwards `sourceAddress`'s audio to.
 */
export function relayRecipientsFor(
  topology: RelayTopologyView,
  participants: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  localAddresses: ReadonlySet<string>,
  sourceAddress: string
): Set<string> {
  const recipients = new Set<string>();
  if (!sourceAddress) return recipients;
  const clusters = topology.clusters ?? [];
  for (const localAddress of localAddresses) {
    if (!localAddress || !participants.has(localAddress)) continue;
    if (localAddress === topology.rootForwarder) {
      for (const cluster of clusters) {
        if (cluster.forwarder === localAddress) {
          for (const member of cluster.members ?? []) {
            if (
              member &&
              member !== localAddress &&
              member !== sourceAddress &&
              !localAddresses.has(member)
            ) {
              recipients.add(member);
            }
          }
        } else if (
          cluster.forwarder &&
          cluster.forwarder !== sourceAddress &&
          !localAddresses.has(cluster.forwarder)
        ) {
          recipients.add(cluster.forwarder);
        }
      }
      continue;
    }
    const myCluster = clusters.find(
      (cluster) => cluster.forwarder === localAddress
    );
    if (!myCluster) continue;
    if (
      topology.rootForwarder &&
      topology.rootForwarder !== localAddress &&
      topology.rootForwarder !== sourceAddress &&
      !localAddresses.has(topology.rootForwarder)
    ) {
      recipients.add(topology.rootForwarder);
    }
    for (const member of myCluster.members ?? []) {
      if (
        member &&
        member !== localAddress &&
        member !== sourceAddress &&
        !localAddresses.has(member)
      ) {
        recipients.add(member);
      }
    }
  }
  return recipients;
}

/**
 * Some non-local participant's audio is forwarded by this device to another
 * participant. Recipients that are not (or no longer) participants are
 * ignored: the Hub drops a forwarding rule whose target has no route
 * (buildReticulumAudioForwardingPlans, "incomplete rule"), and a member that
 * left stays in the old topology until the next GT.
 */
export function forwardsThirdPartyAudio(
  topology: RelayTopologyView,
  participants: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  localAddresses: ReadonlySet<string>
): boolean {
  for (const source of participants.keys()) {
    if (!source || localAddresses.has(source)) continue;
    const recipients = relayRecipientsFor(
      topology,
      participants,
      localAddresses,
      source
    );
    for (const recipient of recipients) {
      if (participants.has(recipient)) return true;
    }
  }
  return false;
}

type ManagerRoomInternals = {
  rooms?: Map<string, RoomTopologyView>;
  localAddresses?: Set<string>;
};

/** Reads the manager's room topology (no public getter on Hub 3.0.3). */
function isRelayingAudioIn(
  manager: GroupCallManager,
  roomId?: string
): boolean {
  const internals = manager as unknown as ManagerRoomInternals;
  if (!(internals.rooms instanceof Map)) return false;
  const local =
    internals.localAddresses instanceof Set ? internals.localAddresses : null;
  if (!local || local.size === 0) return false;
  for (const [id, room] of internals.rooms) {
    if (roomId && id !== roomId) continue;
    if (id.startsWith('dmv:')) continue;
    const topology = room?.lastTopology;
    const participants = room?.participants;
    if (!topology || !(participants instanceof Map)) continue;
    if (forwardsThirdPartyAudio(topology, participants, local)) return true;
  }
  return false;
}

function hasActiveDirectVoiceRoomIn(manager: GroupCallManager): boolean {
  const internals = manager as unknown as ManagerRoomInternals;
  if (!(internals.rooms instanceof Map)) return false;
  const local =
    internals.localAddresses instanceof Set ? internals.localAddresses : null;
  for (const [id, room] of internals.rooms) {
    if (!id.startsWith('dmv:')) continue;
    const participants = room?.participants;
    if (!(participants instanceof Map)) continue;
    // Without registered local addresses any dmv: room still counts (the
    // manager keeps a room only while it is joined).
    if (!local || local.size === 0) return true;
    for (const address of local) {
      if (participants.has(address)) return true;
    }
  }
  return false;
}

const DEST_HASH_RE = /^[0-9a-f]{32}$/;

type EngineLandLookupApi = {
  getActiveLandCallMediaPeerDestinationHash?: (
    chatId: string,
    localAddress: string,
    callId: string
  ) => unknown;
};

/**
 * GO's chat engine (worker) holds the Land call records; its RPC surface is
 * `window.reticulumChat`. Returns a lowercase destination hash or null.
 */
export async function lookupLandCallPeerViaEngine(
  chatId: string,
  localAddress: string,
  callId: string
): Promise<string | null> {
  const api = (globalThis as { reticulumChat?: EngineLandLookupApi })
    .reticulumChat;
  const fn = api?.getActiveLandCallMediaPeerDestinationHash;
  if (typeof fn !== 'function') return null;
  const value = await fn.call(api, chatId, localAddress, callId);
  const raw =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object'
        ? ((value as { peerDestinationHash?: unknown }).peerDestinationHash ??
          (value as { destinationHash?: unknown }).destinationHash)
        : null;
  const hash = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return DEST_HASH_RE.test(hash) ? hash : null;
}

type RendererSendMessage = (
  action: string,
  payload: unknown,
  timeoutMs?: number
) => Promise<unknown>;

/** The renderer wallet signer the hook uses for call signals. */
async function signWithRendererWallet(
  fields: CancelSigningFields
): Promise<string | null> {
  const send = (globalThis as { sendMessage?: RendererSendMessage })
    .sendMessage;
  if (typeof send !== 'function') return null;
  const result = await send('signPresenceMessage', fields, 10_000);
  const signature = (result as { signature?: unknown } | null)?.signature;
  return typeof signature === 'string' && signature ? signature : null;
}

/** Desktop IPC delivers `gcall:audio` data as a fresh Uint8Array. */
function toRendererAudioPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  const data = record.data;
  const existingStage =
    record.audioStageTimestamps &&
    typeof record.audioStageTimestamps === 'object' &&
    !Array.isArray(record.audioStageTimestamps)
      ? (record.audioStageTimestamps as Record<string, unknown>)
      : {};
  return {
    ...record,
    ...(ArrayBuffer.isView(data)
      ? {
          data: new Uint8Array(
            (data as Uint8Array).buffer.slice(
              (data as Uint8Array).byteOffset,
              (data as Uint8Array).byteOffset + (data as Uint8Array).byteLength
            )
          ),
        }
      : {}),
    audioStageTimestamps: {
      ...existingStage,
      bridgeReceivedAtWallMs:
        typeof record.bridgeReceivedAtWallMs === 'number' &&
        record.bridgeReceivedAtWallMs > 0
          ? record.bridgeReceivedAtWallMs
          : existingStage.bridgeReceivedAtWallMs,
      mainFanoutAtWallMs: Date.now(),
    },
  };
}

export function createHostedCallManagers(
  deps: HostedCallManagersDeps
): HostedCallStack {
  const bridgeOptions: MobileReticulumBridgeAdapterOptions = {
    relayOverlayFrames: deps.relayOverlayFrames === true,
    audioDataPlane: deps.audioDataPlane === true,
    ...(deps.commandTimeoutMs
      ? { commandTimeoutMs: deps.commandTimeoutMs }
      : {}),
  };
  const bridge = new MobileReticulumBridgeAdapter(
    deps.transport,
    bridgeOptions
  );
  const presence = new MobilePresenceAdapter(deps.presenceSource, {
    ...(deps.presenceMaxAgeMs ? { maxAgeMs: deps.presenceMaxAgeMs } : {}),
    getLocalDestinationHash: () => bridge.getLocalDestinationHash(),
  });
  const callRouteMaxAgeMs =
    deps.callRouteMaxAgeMs === undefined
      ? DEFAULT_CALL_ROUTE_MAX_AGE_MS
      : deps.callRouteMaxAgeMs;
  // Fresh routes when there are any (a decline from the live device then
  // ends the call: CallManager waits for every invited endpoint); the older
  // ones only when nothing fresh exists (a phone asleep off screen).
  const recentPresence =
    callRouteMaxAgeMs > 0
      ? new MobilePresenceAdapter(deps.presenceSource, {
          maxAgeMs: callRouteMaxAgeMs,
          getLocalDestinationHash: () => bridge.getLocalDestinationHash(),
        })
      : null;
  const callPresence = recentPresence
    ? {
        getRoutesForAddress: (address: string) => {
          const fresh = presence.getRoutesForAddress(address);
          return fresh.length > 0
            ? fresh
            : recentPresence.getRoutesForAddress(address);
        },
        getRouteForAddress(address: string) {
          return this.getRoutesForAddress(address)[0] ?? null;
        },
      }
    : presence;
  const reticulumEndpointsOf = (address: string): string[] =>
    callPresence
      .getRoutesForAddress(address)
      .filter(
        (route): route is Extract<typeof route, { kind: 'reticulum' }> =>
          route.kind === 'reticulum'
      )
      .map((route) => route.destinationHash);
  if (deps.pinnedCallRequests !== false) {
    // Set after construction: the resolver needs the presence adapter.
    bridge.setPinnedCallRequestEndpoints(reticulumEndpointsOf);
  }

  const presenceForManagers = presence as unknown as PresenceManager;
  const bridgeForManagers = bridge as unknown as ReticulumBridge;
  const callManager = new CallManager(
    callPresence as unknown as PresenceManager,
    bridgeForManagers
  );
  const groupCallManager = new GroupCallManager(
    presenceForManagers,
    bridgeForManagers
  );
  const hardenedGcSignatureCache =
    hardenGroupCallSignatureCache(groupCallManager);
  if (!hardenedGcSignatureCache) {
    console.warn(
      '[GO call] GroupCallManager internals changed; H1 signature-cache fix is OFF'
    );
  }

  const signCallFields =
    deps.signCallFields === undefined
      ? signWithRendererWallet
      : deps.signCallFields;
  const ringingCancel = signCallFields
    ? installFreshRingingCancel(callManager, {
        sign: signCallFields,
        getEndpoints: reticulumEndpointsOf,
      })
    : null;
  if (ringingCancel && !ringingCancel.installed) {
    console.warn(
      '[GO call] CallManager internals changed; fresh ringing cancel is OFF'
    );
  }

  const events = new EventEmitter();
  events.setMaxListeners(64);

  // ── CallManager wiring (setup.ts attachCallListeners) ─────────────────
  callManager.setDmCallLinkControlSender((input) =>
    groupCallManager.sendDmCallLinkControl(input)
  );

  /** callIds whose end the renderer already learned or caused. */
  const endedCallIds = new Map<string, number>();
  const rememberEnded = (callId: string): void => {
    const now = Date.now();
    endedCallIds.set(callId, now);
    if (endedCallIds.size > 256) {
      for (const [id, at] of endedCallIds) {
        if (now - at > 10 * 60_000) endedCallIds.delete(id);
      }
    }
  };
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  for (const channel of CALL_EVENT_CHANNELS) {
    callManager.on(channel, (payload: unknown) => {
      const callId = (payload as { callId?: unknown })?.callId;
      if (
        typeof callId === 'string' &&
        (channel === 'call:hangup' || channel === 'call:rejected')
      ) {
        rememberEnded(callId);
      }
      events.emit(channel, payload);
    });
  }
  callManager.on('call:history', (update: DirectCallHistoryUpdate) => {
    if (deps.onCallHistory) {
      try {
        void Promise.resolve(deps.onCallHistory(update)).catch((err) =>
          console.warn('[GO call] recordDirectCallHistory failed', err)
        );
      } catch (err) {
        console.warn('[GO call] recordDirectCallHistory failed', err);
      }
    }
    // Hub deletes pending calls after 60 s and tells no renderer
    // (call.ts:1520-1527 'no_answer', :1823-1830 'missed'). 'missed' is also
    // used when either side hangs up a ringing call; those paths emit
    // call:hangup themselves or were started by this renderer, so decide on
    // the next task once their events are out.
    if (update.outcome !== 'no_answer' && update.outcome !== 'missed') return;
    const callId = update.callId;
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      if (endedCallIds.has(callId)) return;
      rememberEnded(callId);
      events.emit('call:hangup', { callId, reason: 'timeout' });
    }, 0);
    pendingTimers.add(timer);
  });

  // ── GroupCallManager wiring (setup.ts attachGroupCallListeners) ───────
  for (const channel of GROUP_CALL_EVENT_CHANNELS) {
    if (channel === 'gcall:audio') {
      groupCallManager.on(channel, (payload: unknown) =>
        events.emit(channel, toRendererAudioPayload(payload))
      );
    } else {
      groupCallManager.on(channel, (payload: unknown) =>
        events.emit(channel, payload)
      );
    }
  }
  groupCallManager.on(GROUP_CALL_ACTIVITY_CHANNEL, (payload: unknown) =>
    events.emit(GROUP_CALL_ACTIVITY_CHANNEL, payload)
  );
  groupCallManager.on('gcall:dm-call-control', (payload: unknown) => {
    const control = payload as DmCallLinkControlInput & {
      verifiedPeerDestinationHash: string;
    };
    const callPayload: DmCallLinkControlPayload = {
      kind: control.kind,
      callId: control.callId,
      chatId: control.chatId,
      controlId: control.controlId,
      fromAddress: control.fromAddress,
      toAddress: control.toAddress,
      timestamp: control.timestamp,
      publicKey: control.publicKey,
      signature: control.signature,
      verifiedPeerDestinationHash: control.verifiedPeerDestinationHash,
    };
    if (control.kind === 'hangup-ack') {
      callManager.acknowledgeDmCallLinkHangup(callPayload);
      return;
    }
    void callManager.handleDmCallLinkHangup(callPayload, (ack) =>
      groupCallManager.sendDmCallLinkControl(ack)
    );
  });

  const callContext = {
    callManager,
    events,
    noteLocalCallEnd: (callId: string) => rememberEnded(callId),
  };
  const groupCallContext = {
    groupCallManager,
    callManager,
    events,
    getActiveLandCallMediaPeerDestinationHash:
      deps.getActiveLandCallMediaPeerDestinationHash === null
        ? undefined
        : (deps.getActiveLandCallMediaPeerDestinationHash ??
          lookupLandCallPeerViaEngine),
    fetchQortalGroupMemberAddresses: deps.fetchQortalGroupMemberAddresses,
    getLocalAddresses: () => {
      const local = (
        groupCallManager as unknown as { localAddresses?: unknown }
      ).localAddresses;
      return local instanceof Set ? [...local].map(String) : [];
    },
  };
  let disposed = false;
  const call = createWindowCallApi(() => (disposed ? null : callContext));
  const groupCall = createWindowGroupCallApi(() =>
    disposed ? null : groupCallContext
  );

  bridge.attach();
  callManager.start();
  groupCallManager.start();

  const notifyBridgeReady = (): void => {
    if (disposed) return;
    // Same object → desktop "reattach" path: re-subscribe if needed, refresh
    // group activity and re-push forwarding plans to the (restarted) bridge.
    callManager.setReticulumBridge(bridgeForManagers);
    groupCallManager.setReticulumBridge(bridgeForManagers);
  };
  const unsubscribeReady = bridge.onReadyChange((ready) => {
    if (ready) notifyBridgeReady();
  });

  return {
    callManager,
    groupCallManager,
    bridge,
    presence,
    events,
    call,
    groupCall,
    hardenedGcSignatureCache,
    freshRingingCancel: ringingCancel?.installed === true,
    clearLocalAccountState: () => {
      callManager.clearLocalAccountState();
      groupCallManager.clearLocalAccountState();
      // The manager left its rooms internally: stop the member refresh too.
      groupCall.resetAccountState();
    },
    notifyBridgeReady,
    isRelayingAudio: (roomId?: string) =>
      !disposed && isRelayingAudioIn(groupCallManager, roomId),
    hasActiveDirectVoiceRoom: () =>
      !disposed && hasActiveDirectVoiceRoomIn(groupCallManager),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeReady();
      ringingCancel?.dispose();
      for (const timer of pendingTimers) clearTimeout(timer);
      pendingTimers.clear();
      groupCall.dispose();
      callManager.stop();
      groupCallManager.stop();
      bridge.detach();
      callManager.removeAllListeners();
      groupCallManager.removeAllListeners();
      events.removeAllListeners();
    },
  };
}
