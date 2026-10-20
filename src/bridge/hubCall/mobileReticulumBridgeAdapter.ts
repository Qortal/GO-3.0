/**
 * GO's stand-in for the desktop `ReticulumBridge` (electron/src/reticulum-bridge.ts),
 * implementing exactly the subset the unmodified Hub `CallManager`
 * (electron/src/call.ts) and `GroupCallManager` (electron/src/group-call.ts)
 * use, on top of GO's Python bridge via an injected HubCallPythonTransport.
 *
 * Semantics copied from reticulum-bridge.ts (method → Python command):
 *   getState / getLocalDestinationHash
 *   sendCallDetailed                → send_call            (sendDetailed)
 *   fanoutCallDetailed              → fanout_call
 *   sendGroupCallDetailed           → send_group_call
 *   fanoutGroupCallDetailed         → fanout_group_call
 *   sendGroupAudioLinkControlDetailed → send_group_audio_link_control
 *   sendGroupAudioLinkHeartbeatDetailed → send_group_audio_link_heartbeat
 *   openGroupAudioLink              → open_group_audio_link {linkId, established}
 *   closeGroupAudioLink             → close_group_audio_link
 *   resetGroupAudioPeerState        → reset_group_audio_peer_state
 *   warmGroupAudioPath              → warm_group_audio_path {pathState, ready}
 *   registerPeerIdentityFromGroupJoin → register_peer_identity (boolean)
 *   clearGroupAudioDiagnostics      → clear_group_audio_diagnostics
 *   getGroupAudioDataPlaneSession   → get_group_audio_data_plane_session +
 *                                     configure_group_audio_data_plane_routes
 *   configureGroupAudioForwarding   → configure_group_audio_forwarding
 *   enqueueGroupAudio / enqueuePacketGroupAudio (synchronous {ok}) →
 *                                     send_group_audio (contract §1.4; GO-only
 *                                     command restored in qortal_presence_host.py)
 *   getAudioQueueSnapshot           (local counters)
 * Events (Python event → emitted, same argument shapes as desktop):
 *   call_message → 'call-message' (wire, senderDestinationHash, peerPresenceHash)
 *   group_call_message → 'group-call-message' (wire, sender, peer, linkId)
 *   group_audio_packet → 'group-audio-packet' (ReticulumGroupAudioPacketPayload)
 *   group_audio_link_established / _closed / group_audio_send_failed /
 *   group_audio_fast_path_activity → 'group-audio-link-established' / ...
 *
 * GO-only behaviour (all wire-compatible, all switchable):
 *   - relayOverlayFrames=false (default): call.ts/group-call.ts re-flood other
 *     people's overlay frames (L>0). A phone is an overlay leaf; those relays
 *     are dropped here (a relay is a frame carrying a foreign `r`, or a fanout
 *     with an exclusion list).
 *   - pinnedCallRequestEndpoints: a local CALL_REQUEST flood is also sent with
 *     `send_call` (same X and L) to each known endpoint of the callee. The Hub
 *     dedupes by X/callId; `send_call` also leases the peer in GO's Python so
 *     the Hub's pinned CA/CX dial-back is admitted (notes 01 §4, 05 §6).
 */
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import type {
  ReticulumAudioDataPlaneRoute,
  ReticulumAudioDataPlaneSessionResult,
  ReticulumAudioForwardingPlan,
  ReticulumAudioLinkHeartbeatCommand,
  ReticulumAudioQueueSnapshot,
  ReticulumEnqueueGroupAudioResult,
  ReticulumGroupAudioPacketPayload,
  ReticulumOpenAudioLinkResult,
  ReticulumSendFailureReason,
  ReticulumSendResult,
  ReticulumWarmPathResult,
} from '../../../electron/src/reticulum-bridge';
import type {
  HubCallPythonTransport,
  OutboundAudioFrame,
  PythonEventFrame,
  PythonRespFrame,
} from './pythonTransport';

/** desktop reticulum-bridge.ts REQUEST_TIMEOUT_MS */
const COMMAND_TIMEOUT_MS = 10_000;
/**
 * group-call.ts stamps every frame it hands the bridge with the time the
 * frame entered the manager's pending queue (withReticulumAudioQueuedAt);
 * desktop reticulum-bridge.ts sends that as `receivedAtWallMs`, so Python's
 * media deadline also covers the manager queue dwell.
 */
const RETICULUM_AUDIO_QUEUED_AT_MS = Symbol.for(
  'qortal.reticulumAudioQueuedAtMs'
);
const LINK_CONTROL_MAGIC = Buffer.from('QGCCTL1\0', 'utf8');
const DEST_HASH_RE = /^[0-9a-f]{32}$/;

type BridgeState = 'stopped' | 'starting' | 'ready' | 'degraded';

export type MobileReticulumBridgeAdapterOptions = {
  /** Re-flood other people's overlay frames (desktop behaviour). Default false. */
  relayOverlayFrames?: boolean;
  /**
   * Endpoints (presence destination hashes) to receive a pinned copy of a
   * local CALL_REQUEST. Return [] to disable for a target.
   */
  pinnedCallRequestEndpoints?: (targetAddress: string) => string[];
  /** Allow the loopback WebSocket audio data plane. Default false. */
  audioDataPlane?: boolean;
  /** Command timeout override (tests). */
  commandTimeoutMs?: number;
  log?: (message: string) => void;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Desktop snapshot shape, all counters zero (GO has no fd3 queue). */
const SNAPSHOT_NUMBER_FIELDS = [
  'bridgeQueuedFrames',
  'bridgeQueuedOldestAgeMs',
  'bridgeQueuedBytes',
  'bridgeBinaryWritesQueued',
  'perLinkQueuedFrames',
  'queuePressureDrops',
  'queuePressureDropsLast5s',
  'staleDrops',
  'staleDropsLast5s',
  'decodedQueueDepth',
  'decodedQueueOldestAgeMs',
  'decodedQueueMax',
  'decodedQueueDrops',
  'binaryOutQueueDepth',
  'binaryOutQueueOldestAgeMs',
  'binaryOutQueueMax',
  'binaryOutQueueDrops',
  'jsonOutQueueDrops',
  'packetSendFailures',
  'packetPathRequests',
  'packetPathResolutions',
  'packetPathTimeouts',
  'packetFreshSends',
  'packetStaleSends',
  'packetUnknownSends',
  'deadlineDropCount',
  'decodedQueueEvictOldestCount',
  'decodedQueueDropNewestCount',
  'fd3DecodedAgeMsMax',
  'decodedQueueDwellMsMax',
  'rnsSendDurationMsMax',
  'packetPathCheckMsMax',
  'executorLoopGapMsMax',
  'executorGapWhileQueuedMsMax',
  'executorAudioPassMsMax',
  'processBatchMsMax',
  'processBatchFramesMax',
  'rnsSendSlowCount',
  'executorStallCount',
  'executorCommandMsMax',
  'executorCommandWhileQueuedMsMax',
  'executorCommandSlowCount',
  'rnsCallbackSchedulerGapMsMax',
  'rnsCallbackSchedulerGapOver100Count',
  'rnsCallbackSchedulerGapOver250Count',
  'rnsCallbackSchedulerGapOver500Count',
  'rnsCallbackSchedulerGapOver1000Count',
  'rnsRawInboundGapMsMax',
  'rnsRawInboundGapOver80Count',
  'rnsRawInboundGapOver160Count',
  'rnsRawInboundGapOver320Count',
  'rnsRawInboundGapOver640Count',
  'rnsRawInboundGapOver1000Count',
  'rnsRawInboundToLinkReceiveMsMax',
  'rnsRawInboundToLinkReceiveOver80Count',
  'rnsRawInboundToLinkReceiveOver160Count',
  'rnsRawInboundToLinkReceiveOver320Count',
  'rnsRawInboundToLinkReceiveOver640Count',
  'rnsRawInboundToLinkReceiveOver1000Count',
  'rnsRawInboundToLinkReceiveSamples',
  'rnsSharedFrameGapMsMax',
  'rnsSharedFrameGapOver80Count',
  'rnsSharedFrameGapOver160Count',
  'rnsSharedFrameGapOver320Count',
  'rnsSharedFrameGapOver640Count',
  'rnsSharedFrameGapOver1000Count',
  'rnsSharedFrameToTransportInboundMsMax',
  'rnsSharedFrameToTransportInboundOver80Count',
  'rnsSharedFrameToTransportInboundOver160Count',
  'rnsSharedFrameToTransportInboundOver320Count',
  'rnsSharedFrameToTransportInboundOver640Count',
  'rnsSharedFrameToTransportInboundOver1000Count',
  'rnsSharedFrameToTransportInboundSamples',
  'rendererToBridgeEnqueueMsMax',
  'managerFlushToBridgeEnqueueMsMax',
  'bridgeEnqueueToFd3WriteMsMax',
  'bridgeEnqueueToFd3WriteQueueDwellMsMax',
  'rendererToFd3WriteMsMax',
] as const;

function emptySnapshot(): ReticulumAudioQueueSnapshot {
  const snapshot: Record<string, unknown> = {
    bridgeWaitingForDrain: false,
    rnsRawInboundInterfaceLast: '',
    rnsRawInboundInterfaceWorst: '',
    rnsSharedFrameInterfaceLast: '',
    rnsSharedFrameInterfaceWorst: '',
  };
  for (const field of SNAPSHOT_NUMBER_FIELDS) snapshot[field] = 0;
  return snapshot as ReticulumAudioQueueSnapshot;
}

/** desktop ReticulumBridge.mapSendFailureReason, verbatim. */
export function mapPythonSendFailureReason(
  frame: PythonRespFrame
): ReticulumSendFailureReason {
  const code = asObject(frame.payload)?.code;
  if (
    code === 'bridge_overloaded' ||
    code === 'bridge_command_queue_full' ||
    code === 'scheduler_queue_full' ||
    code === 'resource_open_queue_full' ||
    code === 'resource_session_capacity' ||
    code === 'resource_session_queue_full'
  )
    return 'bridge-overloaded';
  if (code === 'bridge_not_started') return 'bridge-not-started';
  if (code === 'unknown_peer_presence_hash')
    return 'unknown-peer-presence-hash';
  if (code === 'wire_too_large') return 'wire-too-large';
  if (code === 'packet_send_false') return 'packet-send-false';
  if (
    code === 'no_route' ||
    code === 'no_established_route' ||
    code === 'resource_session_backoff'
  )
    return 'no-route';
  if (code === 'unknown_link_id') return 'unknown-link-id';
  if (code === 'audio_link_not_ready') return 'audio-link-not-ready';
  if (code === 'audio_payload_too_large') return 'audio-payload-too-large';
  if (frame.error === 'Reticulum bridge is not running') {
    return 'bridge-unavailable';
  }
  return 'send-command-failed';
}

/** reticulum-bridge.ts readNumberSymbol: finite and > 0, else undefined. */
function readQueuedAtMs(data: unknown): number | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const value = Reflect.get(data, RETICULUM_AUDIO_QUEUED_AT_MS);
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function isLinkControlFrame(data: Uint8Array): boolean {
  if (data.length <= LINK_CONTROL_MAGIC.length) return false;
  for (let i = 0; i < LINK_CONTROL_MAGIC.length; i++) {
    if (data[i] !== LINK_CONTROL_MAGIC[i]) return false;
  }
  return true;
}

/**
 * The Buffer class the managers test with `Buffer.isBuffer` is the global one
 * (call.ts/group-call.ts never import it). On GO that is the `buffer` package
 * (installed by nodeGlobals.ts); under Node tests it is Node's own. Inbound
 * frames must be built with that class or group-call.ts drops them.
 */
function hostBuffer(): typeof Buffer {
  const candidate = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  return candidate && typeof candidate.from === 'function' ? candidate : Buffer;
}

function toBufferData(data: unknown): Buffer | null {
  const HostBuffer = hostBuffer();
  if (typeof data === 'string') {
    try {
      return HostBuffer.from(data, 'base64');
    } catch {
      return null;
    }
  }
  if (isBufferLike(data)) {
    return HostBuffer.from(data);
  }
  return null;
}

/**
 * Byte arrays from any realm (Node Buffer under tests, the `buffer` package
 * on GO): ArrayBuffer.isView works across realms, instanceof does not.
 */
function isBufferLike(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    (value as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT === 1
  );
}

export class MobileReticulumBridgeAdapter extends EventEmitter {
  private readonly transport: HubCallPythonTransport;
  private readonly options: MobileReticulumBridgeAdapterOptions;
  private unsubscribeEvents: (() => void) | null = null;
  private unsubscribeReady: (() => void) | null = null;
  private relayOverlayFrames: boolean;
  private pinnedCallRequestEndpoints:
    | ((targetAddress: string) => string[])
    | null;
  private snapshot: ReticulumAudioQueueSnapshot = emptySnapshot();
  private pendingAudioFrames: OutboundAudioFrame[] = [];
  private audioFlushScheduled = false;
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  /** Diagnostics: frames handed to Python and received from it. */
  readonly stats = {
    audioFramesSent: 0,
    controlFramesSent: 0,
    audioFramesReceived: 0,
    audioSendCommandFailures: 0,
    relaysSuppressed: 0,
    pinnedCallRequestCopies: 0,
  };

  constructor(
    transport: HubCallPythonTransport,
    options: MobileReticulumBridgeAdapterOptions = {}
  ) {
    super();
    // Several managers subscribe to the same events (desktop has the same).
    this.setMaxListeners(64);
    this.transport = transport;
    this.options = options;
    this.relayOverlayFrames = options.relayOverlayFrames === true;
    this.pinnedCallRequestEndpoints =
      options.pinnedCallRequestEndpoints ?? null;
  }

  /** Starts consuming Python events. Idempotent. */
  attach(): void {
    if (!this.unsubscribeEvents) {
      this.unsubscribeEvents = this.transport.onEvent((frame) =>
        this.handlePythonEvent(frame)
      );
    }
    if (!this.unsubscribeReady && this.transport.onReadyChange) {
      this.unsubscribeReady = this.transport.onReadyChange((ready) => {
        for (const listener of [...this.readyListeners]) {
          try {
            listener(ready);
          } catch {
            /* ignore */
          }
        }
      });
    }
  }

  detach(): void {
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    this.unsubscribeReady?.();
    this.unsubscribeReady = null;
    this.pendingAudioFrames = [];
  }

  /** GO-only: readiness callbacks (used to re-attach the managers on `ready`). */
  onReadyChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  setRelayOverlayFrames(enabled: boolean): void {
    this.relayOverlayFrames = enabled;
  }

  /** See MobileReticulumBridgeAdapterOptions.pinnedCallRequestEndpoints. */
  setPinnedCallRequestEndpoints(
    resolve: ((targetAddress: string) => string[]) | null
  ): void {
    this.pinnedCallRequestEndpoints = resolve;
  }

  // ── ReticulumBridge surface ────────────────────────────────────────────

  getState(): BridgeState {
    return this.transport.isReady() ? 'ready' : 'starting';
  }

  getLocalDestinationHash(): string | undefined {
    const hash = this.transport.getLocalDestinationHash()?.trim().toLowerCase();
    return hash && DEST_HASH_RE.test(hash) ? hash : undefined;
  }

  async sendCall(
    peerPresenceHash: string,
    message: Record<string, unknown>
  ): Promise<boolean> {
    return (await this.sendCallDetailed(peerPresenceHash, message)).ok;
  }

  async sendCallDetailed(
    peerPresenceHash: string,
    message: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    return this.sendDetailed('send_call', { peerPresenceHash, message });
  }

  async fanoutCallDetailed(
    messages: Record<string, unknown>[],
    excludePeerPresenceHashes: string[] = []
  ): Promise<ReticulumSendResult> {
    if (messages.length === 0) {
      return {
        ok: false,
        reason: 'wire-too-large',
        error: 'No Reticulum frames fit encrypted wire limit',
      };
    }
    if (this.isRelay(messages, excludePeerPresenceHashes)) {
      if (!this.relayOverlayFrames) {
        this.stats.relaysSuppressed += messages.length;
        return { ok: true };
      }
    } else {
      this.sendPinnedCallRequestCopies(messages);
    }
    return this.sendDetailed('fanout_call', {
      messages,
      excludePeerPresenceHashes,
    });
  }

  async sendGroupCall(
    peerPresenceHash: string,
    message: Record<string, unknown>
  ): Promise<boolean> {
    return (await this.sendGroupCallDetailed(peerPresenceHash, message)).ok;
  }

  async sendGroupCallDetailed(
    peerPresenceHash: string,
    message: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    return this.sendDetailed('send_group_call', { peerPresenceHash, message });
  }

  async fanoutGroupCallDetailed(
    messages: Record<string, unknown>[],
    excludePeerPresenceHashes: string[] = []
  ): Promise<ReticulumSendResult> {
    if (messages.length === 0) {
      return {
        ok: false,
        reason: 'wire-too-large',
        error: 'No Reticulum frames fit encrypted wire limit',
      };
    }
    if (
      this.isRelay(messages, excludePeerPresenceHashes) &&
      !this.relayOverlayFrames
    ) {
      this.stats.relaysSuppressed += messages.length;
      return { ok: true };
    }
    return this.sendDetailed('fanout_group_call', {
      messages,
      excludePeerPresenceHashes,
    });
  }

  async sendGroupAudioLinkHeartbeatDetailed(opts: {
    roomId: string;
    command: ReticulumAudioLinkHeartbeatCommand;
    seq?: number;
    peerPresenceHash?: string;
    linkId?: string;
    packetRxAgeMs?: number;
    packetRxRecent?: boolean;
  }): Promise<ReticulumSendResult> {
    const linkId = typeof opts.linkId === 'string' ? opts.linkId.trim() : '';
    const peerPresenceHash =
      typeof opts.peerPresenceHash === 'string'
        ? opts.peerPresenceHash.trim().toLowerCase()
        : '';
    if (!linkId && !peerPresenceHash) {
      return {
        ok: false,
        reason: 'send-command-failed',
        error: 'Missing linkId or peerPresenceHash',
      };
    }
    return this.sendDetailed('send_group_audio_link_heartbeat', {
      roomId: opts.roomId,
      command: opts.command,
      ...(typeof opts.seq === 'number' ? { seq: opts.seq } : {}),
      ...(linkId ? { linkId } : {}),
      ...(peerPresenceHash ? { peerPresenceHash } : {}),
      ...(typeof opts.packetRxAgeMs === 'number'
        ? { packetRxAgeMs: opts.packetRxAgeMs }
        : {}),
      ...(typeof opts.packetRxRecent === 'boolean'
        ? { packetRxRecent: opts.packetRxRecent }
        : {}),
    });
  }

  async sendGroupAudioLinkControlDetailed(opts: {
    roomId: string;
    payload: Buffer;
    signalType: string;
    signalId: string;
    callSessionId: string;
    peerPresenceHash?: string;
    linkId?: string;
  }): Promise<ReticulumSendResult> {
    const linkId = typeof opts.linkId === 'string' ? opts.linkId.trim() : '';
    const peerPresenceHash =
      typeof opts.peerPresenceHash === 'string'
        ? opts.peerPresenceHash.trim().toLowerCase()
        : '';
    if (!linkId && !peerPresenceHash) {
      return {
        ok: false,
        reason: 'send-command-failed',
        error: 'Missing linkId or peerPresenceHash',
      };
    }
    // Desktop checks Buffer.isBuffer; any byte array is fine here (the
    // managers hand over Node-API Buffers from whichever Buffer is global).
    if (!isBufferLike(opts.payload) || opts.payload.length === 0) {
      return {
        ok: false,
        reason: 'send-command-failed',
        error: 'Missing control payload',
      };
    }
    return this.sendDetailed('send_group_audio_link_control', {
      roomId: opts.roomId,
      payload: Buffer.from(
        opts.payload.buffer,
        opts.payload.byteOffset,
        opts.payload.byteLength
      ).toString('base64'),
      signalType: opts.signalType,
      signalId: opts.signalId,
      callSessionId: opts.callSessionId,
      ...(linkId ? { linkId } : {}),
      ...(peerPresenceHash ? { peerPresenceHash } : {}),
    });
  }

  async openGroupAudioLink(
    peerPresenceHash: string,
    opts?: { activeCall?: boolean }
  ): Promise<ReticulumOpenAudioLinkResult> {
    if (!this.transport.isReady()) {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const resp = await this.transport.commandWithResult(
        'open_group_audio_link',
        {
          peerPresenceHash,
          ...(opts?.activeCall === true ? { activeCall: true } : {}),
        },
        this.timeoutMs
      );
      if (resp.ok !== true) {
        return {
          ok: false,
          reason: mapPythonSendFailureReason(resp),
          ...(resp.error ? { error: String(resp.error) } : {}),
        };
      }
      const linkId = asObject(resp.payload)?.linkId;
      if (typeof linkId !== 'string' || linkId.length === 0) {
        return {
          ok: false,
          reason: 'send-command-failed',
          error: 'Bridge open_group_audio_link response missing linkId',
        };
      }
      return {
        ok: true,
        linkId,
        established: asObject(resp.payload)?.established === true,
      };
    } catch (err) {
      return this.exceptionResult(err);
    }
  }

  async closeGroupAudioLink(
    linkId: string,
    reason?: string
  ): Promise<ReticulumSendResult> {
    return this.sendDetailed('close_group_audio_link', {
      linkId,
      ...(reason ? { reason } : {}),
    });
  }

  async resetGroupAudioPeerState(
    peerPresenceHash: string,
    reason: string
  ): Promise<ReticulumSendResult> {
    const peerHash = peerPresenceHash.trim().toLowerCase();
    if (!peerHash) {
      return {
        ok: false,
        reason: 'send-command-failed',
        error: 'Missing peerPresenceHash',
      };
    }
    this.pendingAudioFrames = this.pendingAudioFrames.filter(
      (frame) => frame.peerPresenceHash !== peerHash
    );
    return this.sendDetailed('reset_group_audio_peer_state', {
      peerPresenceHash: peerHash,
      reason,
    });
  }

  async clearGroupAudioDiagnostics(
    roomId?: string
  ): Promise<ReticulumSendResult> {
    this.pendingAudioFrames = [];
    this.snapshot = emptySnapshot();
    if (!this.transport.isReady()) {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const resp = await this.transport.commandWithResult(
        'clear_group_audio_diagnostics',
        { ...(roomId ? { roomId } : {}) },
        this.timeoutMs
      );
      if (resp.ok === true) return { ok: true };
      return {
        ok: false,
        reason: mapPythonSendFailureReason(resp),
        ...(resp.error ? { error: String(resp.error) } : {}),
      };
    } catch (err) {
      return this.exceptionResult(err);
    }
  }

  async getGroupAudioDataPlaneSession(
    routes: ReticulumAudioDataPlaneRoute[]
  ): Promise<ReticulumAudioDataPlaneSessionResult> {
    if (this.options.audioDataPlane !== true) {
      return { ok: false, reason: 'audio-data-plane-disabled' };
    }
    if (!this.transport.isReady()) {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const session = await this.transport.commandWithResult(
        'get_group_audio_data_plane_session',
        {},
        this.timeoutMs
      );
      if (session.ok !== true) {
        return {
          ok: false,
          reason: mapPythonSendFailureReason(session),
          ...(session.error ? { error: String(session.error) } : {}),
        };
      }
      const endpoint = str(asObject(session.payload)?.endpoint);
      const token = str(asObject(session.payload)?.token);
      if (!endpoint || !token) {
        return {
          ok: false,
          reason: 'send-command-failed',
          error: 'Bridge data-plane response missing endpoint/token',
        };
      }
      const configured = await this.transport.commandWithResult(
        'configure_group_audio_data_plane_routes',
        { routes },
        this.timeoutMs
      );
      if (configured.ok !== true) {
        return {
          ok: false,
          reason: mapPythonSendFailureReason(configured),
          ...(configured.error ? { error: String(configured.error) } : {}),
        };
      }
      const routeCount = asObject(configured.payload)?.routeCount;
      return {
        ok: true,
        endpoint,
        token,
        version: 2,
        routeCount: typeof routeCount === 'number' ? routeCount : routes.length,
        routes,
      };
    } catch (err) {
      return this.exceptionResult(err);
    }
  }

  async configureGroupAudioForwarding(
    plans: ReticulumAudioForwardingPlan[],
    _opts?: { startIfNeeded?: boolean }
  ): Promise<ReticulumSendResult> {
    if (!this.transport.isReady()) {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const resp = await this.transport.commandWithResult(
        'configure_group_audio_forwarding',
        { plans },
        this.timeoutMs
      );
      if (resp.ok === true) return { ok: true };
      return {
        ok: false,
        reason: mapPythonSendFailureReason(resp),
        ...(resp.error ? { error: String(resp.error) } : {}),
      };
    } catch (err) {
      return this.exceptionResult(err);
    }
  }

  async warmGroupAudioPath(
    peerPresenceHash: string
  ): Promise<ReticulumWarmPathResult> {
    if (!this.transport.isReady()) {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const resp = await this.transport.commandWithResult(
        'warm_group_audio_path',
        { peerPresenceHash },
        this.timeoutMs
      );
      if (resp.ok === true) {
        const payload = asObject(resp.payload);
        return {
          ok: true,
          ...(typeof payload?.pathState === 'string'
            ? { pathState: payload.pathState }
            : {}),
          ...(typeof payload?.ready === 'boolean'
            ? { ready: payload.ready }
            : {}),
        };
      }
      return {
        ok: false,
        reason: mapPythonSendFailureReason(resp),
        ...(resp.error ? { error: String(resp.error) } : {}),
      };
    } catch (err) {
      return this.exceptionResult(err);
    }
  }

  async registerPeerIdentityFromGroupJoin(
    peerPresenceHash: string,
    reticulumIdentityPublicKeyBase64: string
  ): Promise<boolean> {
    if (!this.transport.isReady()) return false;
    try {
      const resp = await this.transport.commandWithResult(
        'register_peer_identity',
        { peerPresenceHash, reticulumIdentityPublicKeyBase64 },
        this.timeoutMs
      );
      return resp.ok === true;
    } catch {
      return false;
    }
  }

  /**
   * Hands one link frame to Python. Synchronous like desktop (which queues
   * for fd3); delivery failures arrive later as `group-audio-send-failed`.
   */
  enqueueGroupAudio(
    linkId: string,
    roomId: string,
    data: Buffer,
    peerPresenceHash = '',
    peerDestinationHash = ''
  ): ReticulumEnqueueGroupAudioResult {
    return this.enqueueAudioFrame(
      linkId,
      roomId,
      data,
      peerPresenceHash.trim().toLowerCase(),
      peerDestinationHash.trim().toLowerCase()
    );
  }

  enqueuePacketGroupAudio(
    peerPresenceHash: string,
    roomId: string,
    data: Buffer,
    peerDestinationHash = ''
  ): ReticulumEnqueueGroupAudioResult {
    const normalized = peerPresenceHash.trim().toLowerCase();
    if (!normalized) {
      return { ok: false, reason: 'unknown-peer-presence-hash' };
    }
    return this.enqueueAudioFrame(
      '',
      roomId,
      data,
      normalized,
      peerDestinationHash.trim().toLowerCase()
    );
  }

  getAudioQueueSnapshot(_routeKey?: string): ReticulumAudioQueueSnapshot {
    this.snapshot.bridgeQueuedFrames = this.pendingAudioFrames.length;
    return { ...this.snapshot };
  }

  // ── internals ────────────────────────────────────────────────────────

  private get timeoutMs(): number {
    return this.options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS;
  }

  private exceptionResult(err: unknown): {
    ok: false;
    reason: ReticulumSendFailureReason;
    error: string;
  } {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: message.includes('timed out')
        ? 'bridge-timeout'
        : 'bridge-exception',
      error: message,
    };
  }

  private async sendDetailed(
    action: string,
    payload: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    if (!this.transport.isReady()) {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const resp = await this.transport.commandWithResult(
        action,
        payload,
        this.timeoutMs
      );
      if (resp.ok === true) return { ok: true };
      return {
        ok: false,
        reason: mapPythonSendFailureReason(resp),
        ...(resp.error ? { error: String(resp.error) } : {}),
      };
    } catch (err) {
      return this.exceptionResult(err);
    }
  }

  /** A fanout that re-floods someone else's frame rather than our own. */
  private isRelay(
    messages: Record<string, unknown>[],
    excludePeerPresenceHashes: string[]
  ): boolean {
    if (excludePeerPresenceHashes.some((hash) => Boolean(hash))) return true;
    const local = this.getLocalDestinationHash();
    return messages.some((message) => {
      const origin = str(message.r).trim().toLowerCase();
      return Boolean(origin) && origin !== local;
    });
  }

  private sendPinnedCallRequestCopies(
    messages: Record<string, unknown>[]
  ): void {
    const resolve = this.pinnedCallRequestEndpoints;
    if (!resolve) return;
    for (const message of messages) {
      if (message.t !== 'CR' || typeof message.U !== 'string') continue;
      let endpoints: string[] = [];
      try {
        endpoints = resolve(message.U);
      } catch {
        endpoints = [];
      }
      const local = this.getLocalDestinationHash();
      for (const raw of new Set(endpoints)) {
        const hash = String(raw || '')
          .trim()
          .toLowerCase();
        if (!DEST_HASH_RE.test(hash) || hash === local) continue;
        this.stats.pinnedCallRequestCopies += 1;
        // Same X and same hop count as the flood: whichever copy reaches
        // the callee device first is the one it remembers and re-floods
        // (call.ts relays L-1), exactly like a pure flood from a direct
        // neighbour, so its other devices are still reached. X dedupe stops
        // double processing.
        void this.sendDetailed('send_call', {
          peerPresenceHash: hash,
          message: { ...message },
        });
      }
    }
  }

  private enqueueAudioFrame(
    linkId: string,
    roomId: string,
    data: Buffer,
    peerPresenceHash: string,
    peerDestinationHash: string
  ): ReticulumEnqueueGroupAudioResult {
    if (!isBufferLike(data)) {
      return { ok: false, reason: 'audio-enqueue-failed' };
    }
    if (!this.transport.isReady()) {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const control = isLinkControlFrame(bytes);
    const frame: OutboundAudioFrame = {
      linkId,
      roomId,
      peerPresenceHash,
      peerDestinationHash,
      // Control frames (link-auth GJ, GK, GQ, GT, ...) must not hit Python's
      // 320 ms media deadline; media keeps it so stale audio is dropped.
      // Media: the manager's queued-at stamp like desktop
      // (reticulum-bridge.ts `queuedAtMs ?? bridgeEnqueuedAtMs`).
      receivedAtWallMs: control ? 0 : (readQueuedAtMs(data) ?? Date.now()),
      data: bytes.toString('base64'),
    };
    if (control) this.stats.controlFramesSent += 1;
    else this.stats.audioFramesSent += 1;
    if (this.transport.sendAudioFrames) {
      this.pendingAudioFrames.push(frame);
      this.scheduleAudioFlush();
    } else {
      this.sendAudioFrameCommand(frame);
    }
    return {
      ok: true,
      dropped: false,
      queuePressureDrops: 0,
      staleDrops: 0,
      snapshot: this.getAudioQueueSnapshot(
        linkId || `packet:${peerPresenceHash}`
      ),
    };
  }

  private sendAudioFrameCommand(frame: OutboundAudioFrame): void {
    this.transport
      .command('send_group_audio', frame as unknown as Record<string, unknown>)
      .catch(() => {
        this.stats.audioSendCommandFailures += 1;
      });
  }

  private scheduleAudioFlush(): void {
    if (this.audioFlushScheduled) return;
    this.audioFlushScheduled = true;
    queueMicrotask(() => {
      this.audioFlushScheduled = false;
      const frames = this.pendingAudioFrames;
      this.pendingAudioFrames = [];
      if (frames.length === 0) return;
      let handled = false;
      try {
        handled = this.transport.sendAudioFrames?.(frames) === true;
      } catch {
        handled = false;
      }
      if (!handled) {
        for (const frame of frames) this.sendAudioFrameCommand(frame);
      }
    });
  }

  private handlePythonEvent(frame: PythonEventFrame): void {
    if (!frame || typeof frame.event !== 'string') return;
    const payload = asObject(frame.payload);
    switch (frame.event) {
      case 'call_message': {
        const wire = asObject(payload?.wire);
        if (!wire) return;
        this.emit(
          'call-message',
          wire,
          str(payload?.senderDestinationHash),
          str(payload?.peerPresenceHash)
        );
        return;
      }
      case 'group_call_message': {
        const wire = asObject(payload?.wire);
        if (!wire) return;
        this.emit(
          'group-call-message',
          wire,
          str(payload?.senderDestinationHash),
          str(payload?.peerPresenceHash),
          str(payload?.linkId)
        );
        return;
      }
      case 'group_audio_packet': {
        const frames = Array.isArray(payload?.frames)
          ? (payload!.frames as unknown[])
          : [payload];
        for (const raw of frames) this.emitInboundAudio(asObject(raw));
        return;
      }
      case 'group_audio_link_established': {
        const linkId = str(payload?.linkId);
        if (!linkId) return;
        this.emit('group-audio-link-established', {
          linkId,
          peerPresenceHash: str(payload?.peerPresenceHash),
          peerDestinationHash: str(payload?.peerDestinationHash),
          incoming: payload?.incoming === true,
        });
        return;
      }
      case 'group_audio_link_closed': {
        const linkId = str(payload?.linkId);
        if (!linkId) return;
        this.emit('group-audio-link-closed', {
          linkId,
          peerPresenceHash: str(payload?.peerPresenceHash),
          peerDestinationHash: str(payload?.peerDestinationHash),
          incoming: payload?.incoming === true,
          reason: str(payload?.reason),
        });
        return;
      }
      case 'group_audio_send_failed': {
        const linkId = str(payload?.linkId);
        const peerPresenceHash = str(payload?.peerPresenceHash);
        if (!linkId && !peerPresenceHash) return;
        this.snapshot.packetSendFailures += 1;
        this.emit('group-audio-send-failed', {
          linkId,
          peerPresenceHash,
          transport: payload?.transport === 'packet' ? 'packet' : 'link',
          reason: str(payload?.reason),
          code: str(payload?.code),
          error: str(payload?.error),
          pathState: str(payload?.pathState),
        });
        return;
      }
      case 'group_audio_fast_path_activity': {
        const roomId = str(payload?.roomId);
        const sourceAddress = str(payload?.sourceAddress);
        if (!roomId || !sourceAddress) return;
        this.emit('group-audio-fast-path-activity', {
          roomId,
          sourceAddress,
          linkId: str(payload?.linkId),
          peerPresenceHash: str(payload?.peerPresenceHash),
          peerDestinationHash: str(payload?.peerDestinationHash),
          forwardedTargets:
            typeof payload?.forwardedTargets === 'number'
              ? payload.forwardedTargets
              : 0,
          receivedAtWallMs:
            typeof payload?.receivedAtWallMs === 'number'
              ? payload.receivedAtWallMs
              : Date.now(),
        });
        return;
      }
      case 'group_audio_queue_state': {
        const num = (key: string, fallback: number): number =>
          typeof payload?.[key] === 'number'
            ? (payload[key] as number)
            : fallback;
        this.snapshot.decodedQueueDepth = num(
          'decodedQueueDepth',
          this.snapshot.decodedQueueDepth
        );
        this.snapshot.decodedQueueMax = num(
          'decodedQueueMax',
          this.snapshot.decodedQueueMax
        );
        this.snapshot.decodedQueueDrops = num(
          'decodedQueueDrops',
          this.snapshot.decodedQueueDrops
        );
        this.snapshot.packetSendFailures = Math.max(
          this.snapshot.packetSendFailures,
          num('packetSendFailures', 0)
        );
        this.snapshot.deadlineDropCount = num(
          'deadlineDropCount',
          this.snapshot.deadlineDropCount
        );
        return;
      }
      default:
        return;
    }
  }

  private emitInboundAudio(payload: Record<string, unknown> | null): void {
    if (!payload) return;
    const data = toBufferData(payload.data);
    if (!data || data.length === 0) return;
    const linkId = str(payload.linkId);
    const peerPresenceHash = str(payload.peerPresenceHash);
    const peerDestinationHash = str(payload.peerDestinationHash);
    const transport: 'link' | 'packet' = linkId ? 'link' : 'packet';
    const routeKey =
      transport === 'link'
        ? linkId
        : `packet:${(peerPresenceHash || peerDestinationHash || 'unknown')
            .trim()
            .toLowerCase()}`;
    const receivedAtWallMs =
      typeof payload.receivedAtWallMs === 'number'
        ? payload.receivedAtWallMs
        : 0;
    this.stats.audioFramesReceived += 1;
    const packet: ReticulumGroupAudioPacketPayload = {
      linkId,
      routeKey,
      transport,
      roomId: str(payload.roomId),
      data,
      peerPresenceHash,
      peerDestinationHash,
      ...(receivedAtWallMs > 0 ? { receivedAtWallMs } : {}),
      incoming: true,
    };
    this.emit('group-audio-packet', packet);
  }
}
