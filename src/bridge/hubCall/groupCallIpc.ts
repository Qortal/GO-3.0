/**
 * `window.groupCall` for GO on top of a hosted Hub `GroupCallManager`.
 *
 * The full desktop preload API (electron/src/preload.ts ~3954-4318) with the
 * logic of its main-process handlers (electron/src/setup.ts ~6785-7680):
 *   - join: the 15 positional IPC arguments (electron/src/group-call-ipc-contract.ts).
 *     DM media rooms (`dmv:` + `direct:`) pin the peer device to the one the
 *     CallManager authenticated for this call (getActiveMediaPeerDestinationHash,
 *     or an injected QortalLand lookup) and refuse with
 *     'unverified_dm_voice_peer_destination' otherwise — exactly setup.ts.
 *   - every other method returns what the desktop handler returns.
 *   - onEvent: the 11 gcall:* channels; each subscribe replays retained
 *     verified keys to the subscribers (setup.ts `gcall:subscribe`).
 * On GO the "audio surface" lives in the same page, so the desktop
 * sender-window checks (main shell vs audio surface) do not apply.
 *
 * GO-only (optional, wire-neutral): when `fetchQortalGroupMemberAddresses` is
 * given, member allowlists of joined `gcall-qortal-*` rooms are refreshed
 * every minute from the node (Hub freezes them at join, note 02 B2/plan 5.5);
 * a refresh that would drop the local account is ignored, nothing is
 * refreshed without a local account, rooms the manager left on its own
 * (takeover, failed join) are dropped after a grace period, and
 * `resetAccountState()` (logout) stops it all.
 * The QortalLand lookup is async on GO (chat engine worker RPC) and bounded
 * by LAND_CALL_LOOKUP_TIMEOUT_MS; a timeout counts as "not authenticated".
 */
import type { EventEmitter } from 'events';
import type { CallManager } from '../../../electron/src/call';
import type {
  GroupCallManager,
  GroupCallRtcSignalInput,
} from '../../../electron/src/group-call';
import type { GroupCallJoinIpcArguments } from '../../../electron/src/group-call-ipc-contract';

export type WindowGroupCallApi = NonNullable<Window['groupCall']>;

export const GROUP_CALL_EVENT_CHANNELS = [
  'gcall:participant-joined',
  'gcall:participant-left',
  'gcall:local-session-taken-over',
  'gcall:topology',
  'gcall:cluster-heartbeat',
  'gcall:heartbeat',
  'gcall:audio',
  'gcall:key',
  'gcall:key-request',
  'gcall:session-updated',
  'gcall:rtc-signal',
] as const;

export const GROUP_CALL_ACTIVITY_CHANNEL = 'gcall:qortal-group-call-activity';

const GCALL_IPC_SEND_AUDIO_MAX_BYTES = 12_288;
const GCALL_AUDIO_RENDERER_SEND_AT_MS = Symbol.for(
  'qortal.gcallAudioRendererSendAtMs'
);
const GCALL_AUDIO_MAIN_IPC_AT_MS = Symbol.for('qortal.gcallAudioMainIpcAtMs');
const MEMBER_REFRESH_INTERVAL_MS = 60_000;
/**
 * A renderer push of member targets normally precedes joinRoom by
 * milliseconds; a gated room the local account is still not in after this
 * long was left by the manager itself (takeover, logout, failed join).
 */
const MEMBER_GATE_JOIN_GRACE_MS = 90_000;
/** Upper bound for the async QortalLand endpoint lookup during a DM join. */
export const LAND_CALL_LOOKUP_TIMEOUT_MS = 5_000;

export type GroupCallIpcContext = {
  groupCallManager: GroupCallManager;
  callManager: CallManager;
  /** Renderer-facing gcall:* channels (+ the activity channel). */
  events: EventEmitter;
  /** QortalLand calls (shared chat engine) — desktop setup.ts parity. */
  getActiveLandCallMediaPeerDestinationHash?: (
    chatId: string,
    localAddress: string,
    callId: string
  ) => string | null | undefined | Promise<string | null | undefined>;
  fetchQortalGroupMemberAddresses?: (
    groupId: number
  ) => Promise<string[] | null | undefined>;
  /** Local account addresses (for the member-refresh safety check). */
  getLocalAddresses?: () => string[];
};

const MANAGER_NOT_RUNNING = {
  success: false,
  error: 'GroupCall manager not running',
} as const;

type HostBufferCtor = {
  from(data: Uint8Array): Uint8Array;
  isBuffer(value: unknown): boolean;
};

function hostBuffer(): HostBufferCtor | null {
  const candidate = (globalThis as { Buffer?: HostBufferCtor }).Buffer;
  return candidate && typeof candidate.from === 'function' ? candidate : null;
}

/** setup.ts: `Buffer.isBuffer(data) ? data : Buffer.from(data)` + timing. */
function toManagerBuffer(
  data: Uint8Array | ArrayBuffer | null | undefined,
  timing?: { rendererSendAtWallMs?: number }
): Uint8Array | null {
  const HostBuffer = hostBuffer();
  if (!HostBuffer || !data) return null;
  let buf: Uint8Array;
  if (HostBuffer.isBuffer(data)) {
    buf = data as Uint8Array;
  } else if (ArrayBuffer.isView(data)) {
    buf = HostBuffer.from(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    );
  } else if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') {
    buf = HostBuffer.from(new Uint8Array(data as ArrayBuffer));
  } else {
    return null;
  }
  const rendererSendAtMs = timing?.rendererSendAtWallMs;
  if (
    typeof rendererSendAtMs === 'number' &&
    Number.isFinite(rendererSendAtMs) &&
    rendererSendAtMs > 0
  ) {
    Object.defineProperty(buf, GCALL_AUDIO_RENDERER_SEND_AT_MS, {
      value: rendererSendAtMs,
      enumerable: false,
      configurable: true,
    });
  }
  Object.defineProperty(buf, GCALL_AUDIO_MAIN_IPC_AT_MS, {
    value: Date.now(),
    enumerable: false,
    configurable: true,
  });
  return buf;
}

function qortalGroupIdFromRoomId(roomId: string): number | null {
  const match = /^gcall-qortal-(\d+)$/.exec(roomId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
}

/** Resolves the lookup, or null on throw / after `timeoutMs`. */
async function lookupWithTimeout(
  lookup: () => string | null | undefined | Promise<string | null | undefined>,
  timeoutMs: number
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      Promise.resolve().then(lookup),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    return typeof result === 'string' && result ? result : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type HostedWindowGroupCallApi = WindowGroupCallApi & {
  dispose(): void;
  /**
   * Logout boundary: forget member-gated rooms and stop the member refresh
   * (GroupCallManager.clearLocalAccountState leaves the rooms internally,
   * not through this API's leave).
   */
  resetAccountState(): void;
};

export function createWindowGroupCallApi(
  getContext: () => GroupCallIpcContext | null
): HostedWindowGroupCallApi {
  const fullStreamSubscribers = new Set<
    (event: string, payload: unknown) => void
  >();
  let fullStreamHandlers: Array<
    readonly [string, (payload: unknown) => void]
  > | null = null;
  let fullStreamContext: GroupCallIpcContext | null = null;
  /**
   * Rooms whose member allowlist the renderer pushed (member refresh), with
   * the time of that push.
   */
  const memberGatedRooms = new Map<string, number>();
  let memberRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let memberRefreshInFlight = false;
  /** Bumped at logout/dispose; an in-flight refresh stops when it changes. */
  let accountGeneration = 0;

  const broadcast = (channel: string, payload: unknown): void => {
    for (const cb of [...fullStreamSubscribers]) {
      try {
        cb(channel, payload);
      } catch (err) {
        console.warn('[GO gcall] subscriber failed', err);
      }
    }
  };

  const attachFullStream = (ctx: GroupCallIpcContext): void => {
    if (fullStreamContext === ctx && fullStreamHandlers) return;
    detachFullStream();
    fullStreamContext = ctx;
    fullStreamHandlers = GROUP_CALL_EVENT_CHANNELS.map((channel) => {
      const handler = (payload: unknown) => broadcast(channel, payload);
      ctx.events.on(channel, handler);
      return [channel, handler] as const;
    });
  };

  const detachFullStream = (): void => {
    if (fullStreamContext && fullStreamHandlers) {
      for (const [channel, handler] of fullStreamHandlers) {
        fullStreamContext.events.off(channel, handler);
      }
    }
    fullStreamHandlers = null;
    fullStreamContext = null;
  };

  const replayRetainedKeys = (ctx: GroupCallIpcContext): void => {
    ctx.groupCallManager.replayRetainedVerifiedKeyStatesTo({
      id: 1,
      send: (channel, payload) => broadcast(channel, payload),
    });
  };

  const stopMemberRefresh = (): void => {
    if (memberRefreshTimer) clearInterval(memberRefreshTimer);
    memberRefreshTimer = null;
  };

  const localAddressesOf = (ctx: GroupCallIpcContext): Set<string> =>
    new Set(
      (ctx.getLocalAddresses?.() ?? [])
        .map((address) => String(address || '').trim())
        .filter(Boolean)
    );

  /** The local account is a participant of the manager's room right now. */
  const isLocallyJoined = (
    ctx: GroupCallIpcContext,
    roomId: string,
    local: Set<string>
  ): boolean => {
    try {
      return ctx.groupCallManager
        .getRoomParticipants(roomId)
        .some((participant) => local.has(participant.address));
    } catch {
      return false;
    }
  };

  const refreshMemberAllowlists = async (): Promise<void> => {
    if (memberRefreshInFlight) return;
    const ctx = getContext();
    const fetchMembers = ctx?.fetchQortalGroupMemberAddresses;
    if (!ctx || !fetchMembers) return;
    const generation = accountGeneration;
    memberRefreshInFlight = true;
    try {
      for (const roomId of [...memberGatedRooms.keys()]) {
        if (generation !== accountGeneration) return;
        const pushedAtMs = memberGatedRooms.get(roomId);
        if (pushedAtMs === undefined) continue;
        // No local account (logged out / not registered yet): nothing to
        // protect and nobody to refresh for.
        const local = localAddressesOf(ctx);
        if (local.size === 0) return;
        if (!isLocallyJoined(ctx, roomId, local)) {
          if (Date.now() - pushedAtMs >= MEMBER_GATE_JOIN_GRACE_MS) {
            memberGatedRooms.delete(roomId);
          }
          continue;
        }
        const groupId = qortalGroupIdFromRoomId(roomId);
        if (groupId === null) continue;
        let members: string[] | null | undefined = null;
        try {
          members = await fetchMembers(groupId);
        } catch {
          members = null;
        }
        if (generation !== accountGeneration) return;
        if (getContext() !== ctx) return;
        if (!Array.isArray(members) || members.length === 0) continue;
        const cleaned = [
          ...new Set(
            members
              .map((address) =>
                typeof address === 'string' ? address.trim() : ''
              )
              .filter(Boolean)
          ),
        ];
        // Re-read after the await: the account may have changed meanwhile.
        const localNow = localAddressesOf(ctx);
        if (localNow.size === 0) return;
        // Never let a refresh remove ourselves: the renderer owns that decision.
        if (![...localNow].some((a) => cleaned.includes(a))) continue;
        if (!memberGatedRooms.has(roomId)) continue;
        ctx.groupCallManager.setQortalGroupReticulumTargets(roomId, cleaned);
      }
    } finally {
      memberRefreshInFlight = false;
      if (generation === accountGeneration) ensureMemberRefresh();
    }
  };

  const ensureMemberRefresh = (): void => {
    const ctx = getContext();
    if (!ctx?.fetchQortalGroupMemberAddresses) return;
    if (memberGatedRooms.size === 0) {
      stopMemberRefresh();
      return;
    }
    if (memberRefreshTimer) return;
    memberRefreshTimer = setInterval(() => {
      void refreshMemberAllowlists();
    }, MEMBER_REFRESH_INTERVAL_MS);
  };

  const resetAccountState = (): void => {
    accountGeneration += 1;
    memberGatedRooms.clear();
    stopMemberRefresh();
  };

  const api: HostedWindowGroupCallApi = {
    join: async (...args: GroupCallJoinIpcArguments) => {
      const [
        roomId,
        chatId,
        localAddress,
        signature,
        publicKey,
        timestamp,
        reticulumDestinationHash,
        joinGeneration,
        topologyEpochFloor,
        reticulumIdentityPublicKeyBase64,
        joinRkSignature,
        dmVoiceAudioLinkRole,
        takeover,
        dmVoicePeerDestinationHash,
        dmVoiceCallId,
      ] = args;
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      try {
        const isDirectVoiceRoom =
          typeof roomId === 'string' &&
          typeof chatId === 'string' &&
          roomId.startsWith('dmv:') &&
          chatId.startsWith('direct:');
        const authenticatedCallDestination = isDirectVoiceRoom
          ? (ctx.callManager.getActiveMediaPeerDestinationHash(
              chatId,
              localAddress,
              dmVoiceCallId
            ) ?? null)
          : null;
        let authenticatedLandCallDestination: string | null = null;
        const landLookup = ctx.getActiveLandCallMediaPeerDestinationHash;
        if (
          isDirectVoiceRoom &&
          dmVoiceCallId &&
          !authenticatedCallDestination &&
          landLookup
        ) {
          // GO: the Land call record lives in the chat engine worker (RPC).
          authenticatedLandCallDestination = await lookupWithTimeout(
            () => landLookup(chatId, localAddress, dmVoiceCallId),
            LAND_CALL_LOOKUP_TIMEOUT_MS
          );
          if (getContext() !== ctx) return { ...MANAGER_NOT_RUNNING };
        }
        const authenticatedMediaDestination =
          authenticatedCallDestination ?? authenticatedLandCallDestination;
        if (
          isDirectVoiceRoom &&
          dmVoiceCallId &&
          !authenticatedMediaDestination
        ) {
          throw new Error('unverified_dm_voice_peer_destination');
        }
        const selectedDmVoicePeerDestinationHash =
          authenticatedMediaDestination ?? dmVoicePeerDestinationHash;
        const session = ctx.groupCallManager.joinRoom(
          roomId,
          chatId,
          localAddress,
          signature,
          publicKey,
          timestamp,
          reticulumDestinationHash,
          joinGeneration,
          topologyEpochFloor,
          reticulumIdentityPublicKeyBase64,
          joinRkSignature,
          dmVoiceAudioLinkRole,
          takeover,
          selectedDmVoicePeerDestinationHash,
          Boolean(authenticatedMediaDestination),
          authenticatedMediaDestination ? dmVoiceCallId : undefined
        );
        return {
          success: true,
          callSessionId: session.callSessionId,
          mediaSessionGeneration: session.mediaSessionGeneration,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    leave: async (
      roomId,
      localAddress,
      signature,
      publicKey,
      timestamp,
      joinGeneration
    ) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      ctx.groupCallManager.leaveRoom(
        roomId,
        localAddress,
        signature,
        publicKey,
        timestamp,
        joinGeneration
      );
      memberGatedRooms.delete(roomId);
      ensureMemberRefresh();
      return { success: true };
    },

    leaveSync: (
      roomId,
      localAddress,
      signature,
      publicKey,
      timestamp,
      joinGeneration
    ) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      ctx.groupCallManager.leaveRoom(
        roomId,
        localAddress,
        signature,
        publicKey,
        timestamp,
        joinGeneration
      );
      memberGatedRooms.delete(roomId);
      ensureMemberRefresh();
      return { success: true };
    },

    reportTransportHealth: async (roomId, healthyPeerAddresses) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      ctx.groupCallManager.reportTransportHealth(
        roomId,
        Array.isArray(healthyPeerAddresses) ? healthyPeerAddresses : []
      );
      return { success: true };
    },

    broadcastTopology: async (
      roomId,
      topology,
      signature,
      publicKey,
      timestamp,
      localAuthorityProvisional = false
    ) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      ctx.groupCallManager.broadcastTopology(
        roomId,
        topology as Parameters<GroupCallManager['broadcastTopology']>[1],
        signature,
        publicKey,
        timestamp,
        localAuthorityProvisional
      );
      return { success: true };
    },

    sendClusterHeartbeat: async (roomId, payload, signature) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      ctx.groupCallManager.sendClusterHeartbeat(roomId, payload, signature);
      return { success: true };
    },

    sendAudio: async (roomId, toAddress, data, timing) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      const buf = toManagerBuffer(data, timing);
      if (!buf) return { success: false, error: 'invalid-or-oversize-payload' };
      if (buf.length > GCALL_IPC_SEND_AUDIO_MAX_BYTES) {
        return { success: false, error: 'payload-too-large' };
      }
      const result = ctx.groupCallManager.sendAudio(
        roomId,
        toAddress,
        buf as Parameters<GroupCallManager['sendAudio']>[2]
      );
      if (result.success) {
        return { success: true, diagnostics: result.diagnostics };
      }
      return {
        success: false,
        error:
          ('error' in result ? result.error : undefined) ?? 'relay-rejected',
        diagnostics: result.diagnostics,
      };
    },

    sendAudioBatch: async (roomId, toAddresses, data, timing) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      const buf = toManagerBuffer(data, timing);
      if (!buf) return { success: false, error: 'invalid-or-oversize-payload' };
      if (buf.length > GCALL_IPC_SEND_AUDIO_MAX_BYTES) {
        return { success: false, error: 'payload-too-large' };
      }
      if (!Array.isArray(toAddresses) || toAddresses.length === 0) {
        return { success: true, diagnostics: undefined };
      }
      const result = ctx.groupCallManager.sendAudioBatch(
        roomId,
        toAddresses,
        buf as Parameters<GroupCallManager['sendAudioBatch']>[2]
      );
      if (result.success) {
        return { success: true, diagnostics: result.diagnostics };
      }
      return {
        success: false,
        error:
          ('error' in result ? result.error : undefined) ?? 'relay-rejected',
        diagnostics: result.diagnostics,
      };
    },

    sendRtcSignal: async (input) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      return ctx.groupCallManager.sendRtcSignal(
        input as GroupCallRtcSignalInput
      );
    },

    requestPeerMediaRecovery: async (roomId, address, reason) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      ctx.groupCallManager.requestPeerMediaRecovery(roomId, address, reason);
      return { success: true };
    },

    reportGcallAudioEscalation: async (opts) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      ctx.groupCallManager.reportGcallAudioEscalation(opts ?? {});
      return { success: true };
    },

    getLinkStats: async (roomId) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      return {
        success: true,
        stats: ctx.groupCallManager.getReticulumAudioLinkStats(roomId),
      };
    },

    getAudioDataPlaneSession: async (roomId, toAddresses) => {
      const ctx = getContext();
      if (!ctx) return { ok: false, reason: 'manager-unavailable' };
      if (!Array.isArray(toAddresses) || toAddresses.length === 0) {
        return { ok: false, reason: 'no-targets' };
      }
      return ctx.groupCallManager.getAudioDataPlaneSession(roomId, toAddresses);
    },

    sendKey: async (
      roomId,
      toAddress,
      encryptedKey,
      fromAddress,
      signature,
      publicKey,
      timestamp,
      meta
    ) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      return ctx.groupCallManager.sendKey(
        roomId,
        toAddress,
        encryptedKey,
        fromAddress,
        signature,
        publicKey,
        timestamp,
        meta
      );
    },

    sendKeyRequest: async (
      roomId,
      toAddress,
      fromAddress,
      signature,
      publicKey,
      timestamp,
      callSessionId,
      mediaSessionGeneration
    ) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      ctx.groupCallManager.sendKeyRequest(
        roomId,
        toAddress,
        fromAddress,
        signature,
        publicKey,
        timestamp,
        callSessionId,
        mediaSessionGeneration
      );
      return { success: true };
    },

    requestSessionBreak: async (roomId) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      const result = ctx.groupCallManager.requestSessionBreak(roomId);
      return result.ok
        ? { success: true }
        : { success: false, error: result.error ?? 'rejected' };
    },

    setLocalAddresses: async (addresses, source) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      ctx.groupCallManager.setLocalAddresses(
        Array.isArray(addresses) ? addresses : [],
        typeof source === 'string' ? source : undefined
      );
      return { success: true };
    },

    setQortalGroupReticulumTargets: async (roomId, addresses) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      const normalizedRoomId = typeof roomId === 'string' ? roomId : '';
      ctx.groupCallManager.setQortalGroupReticulumTargets(
        normalizedRoomId,
        Array.isArray(addresses) ? addresses : []
      );
      if (
        qortalGroupIdFromRoomId(normalizedRoomId) !== null &&
        Array.isArray(addresses) &&
        addresses.length > 0
      ) {
        memberGatedRooms.set(normalizedRoomId, Date.now());
      } else {
        memberGatedRooms.delete(normalizedRoomId);
      }
      ensureMemberRefresh();
      return { success: true };
    },

    getRoomParticipants: async (roomId) => {
      const ctx = getContext();
      if (!ctx) return [];
      return ctx.groupCallManager.getRoomParticipants(roomId);
    },

    getRoomBootstrapState: async (roomId) => {
      const ctx = getContext();
      if (!ctx) return null;
      return ctx.groupCallManager.getRoomBootstrapState(roomId);
    },

    setWatchedQortalGroupIds: async (ids) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      const list = Array.isArray(ids) ? (ids as number[]) : [];
      const activity = ctx.groupCallManager.setWatchedQortalGroupIds(list);
      return { success: true, ...activity };
    },

    onQortalGroupCallActivity: (cb) => {
      const ctx = getContext();
      if (!ctx) return () => {};
      const handler = (payload: unknown) => {
        const p = payload as {
          activeByGroupId?: Record<string, boolean>;
          participantCountByGroupId?: Record<string, number>;
          maxParticipantsByGroupId?: Record<string, number>;
        };
        if (p?.activeByGroupId && typeof p.activeByGroupId === 'object') {
          try {
            cb({
              activeByGroupId: p.activeByGroupId,
              participantCountByGroupId:
                p.participantCountByGroupId &&
                typeof p.participantCountByGroupId === 'object'
                  ? p.participantCountByGroupId
                  : undefined,
              maxParticipantsByGroupId:
                p.maxParticipantsByGroupId &&
                typeof p.maxParticipantsByGroupId === 'object'
                  ? p.maxParticipantsByGroupId
                  : undefined,
            });
          } catch (err) {
            console.warn('[GO gcall] activity subscriber failed', err);
          }
        }
      };
      ctx.events.on(GROUP_CALL_ACTIVITY_CHANNEL, handler);
      let active = true;
      // setup.ts `gcall:subscribe-activity`: snapshot to the new subscriber.
      setTimeout(() => {
        if (!active) return;
        handler(
          ctx.groupCallManager.getQortalGroupCallActivitySnapshotForSidebar()
        );
      }, 0);
      return () => {
        active = false;
        ctx.events.off(GROUP_CALL_ACTIVITY_CHANNEL, handler);
      };
    },

    getPendingKeyMetrics: async () => {
      const ctx = getContext();
      if (!ctx) {
        return {
          pending_key_flush_success: 0,
          pending_key_expired: 0,
          pendingRooms: 0,
        };
      }
      return ctx.groupCallManager.getPendingKeyMetrics();
    },

    requestRetainedKeyReplay: () => {
      const ctx = getContext();
      if (!ctx) return;
      setTimeout(() => replayRetainedKeys(ctx), 0);
    },

    onEvent: (cb) => {
      const ctx = getContext();
      if (!ctx) return () => {};
      attachFullStream(ctx);
      fullStreamSubscribers.add(cb);
      // setup.ts `gcall:subscribe` replays retained verified keys on every
      // subscribe, to the whole renderer (all current subscribers).
      setTimeout(() => {
        if (fullStreamSubscribers.has(cb)) replayRetainedKeys(ctx);
      }, 0);
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        fullStreamSubscribers.delete(cb);
        if (fullStreamSubscribers.size === 0) detachFullStream();
      };
    },

    dispose: () => {
      fullStreamSubscribers.clear();
      detachFullStream();
      resetAccountState();
    },

    resetAccountState,
  };
  return api;
}
