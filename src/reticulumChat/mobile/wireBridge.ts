/**
 * Mobile ReticulumBridge: the chat engine's transport, living in the engine
 * worker. Faithful port of the desktop `reticulum-bridge.ts` wire contract —
 * same python command actions, same result mapping — but frames travel
 * worker ⇄ main thread ⇄ ReticulumPlugin (Kotlin) ⇄ presence_bridge.py
 * instead of over a child-process stdio pump.
 */
import { EventEmitter } from 'events';
import type { ReticulumResourceStaging } from './resourceStaging';
import {
  createLatencyStats,
  noteLatency,
  summarizeLatency,
  type LatencySummary,
} from './latencyStats';

export type ReticulumSendFailureReason =
  | 'bridge-not-started'
  | 'bridge-not-ready'
  | 'bridge-unavailable'
  | 'bridge-overloaded'
  | 'bridge-timeout'
  | 'bridge-exception'
  | 'unknown-peer-presence-hash'
  | 'wire-too-large'
  | 'packet-send-false'
  | 'no-route'
  | 'unknown-link-id'
  | 'audio-link-not-ready'
  | 'audio-payload-too-large'
  | 'send-command-failed';

export type ReticulumSendResult =
  | { ok: true }
  | { ok: false; reason: ReticulumSendFailureReason; error?: string };

type RespFrame = {
  ok: boolean;
  error?: string;
  payload?: Record<string, any>;
};

type SendCommandFn = (
  action: string,
  payload: Record<string, unknown>,
  timeoutMs?: number
) => Promise<RespFrame>;

function mapSendFailureReason(frame: RespFrame): ReticulumSendFailureReason {
  const code = frame.payload?.code;
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

const DESTINATION_HASH_RE = /^[0-9a-f]{32}$/;

/**
 * Resource-session counters for Copy diagnostics. Types are the caller's
 * `logicalResourceType`, or its `resourceType` when it has none. Every caller
 * counts, including ones that joined another caller's pending preparation.
 */
export type ResourceSessionStats = {
  /** Callers still waiting for a session, by type. */
  inFlight: Record<string, number>;
  /** Age of the longest-waiting caller, or null when none is waiting. */
  oldestInFlightMs: number | null;
  oldestInFlightType: string | null;
  /**
   * Outcomes since the worker started, keyed `<type>:<ok|reason>`. Once the
   * key cap is reached, new keys are counted under `other`.
   */
  results: Record<string, number>;
};

const RESOURCE_SESSION_RESULT_KEYS_MAX = 64;

/** What this phone did with resource requests from peers, per logical type. */
export type ServingTypeStats = {
  /** `auth` events (a peer asked for a resource). */
  received: number;
  authorized: number;
  rejected: number;
  /** Authorize commands that failed. */
  failed: number;
  /** Failed because Python had already given up on the request. */
  late: number;
  /** `auth_ended` events (Python ended the request, e.g. its 15 s timeout). */
  ended: number;
};

/** Serving counters and step timing for Copy diagnostics (since the worker started). */
export type ServingStats = {
  byType: Record<string, ServingTypeStats>;
  endedReasons: Record<string, number>;
  failedReasons: Record<string, number>;
  /** Request arrival in Python to the authorize command. */
  totalMs: LatencySummary | null;
  /** Worker receive to the authorize command. */
  engineMs: LatencySummary | null;
  /** Python's own admission (arrival to the auth event). */
  pythonMs: LatencySummary | null;
  /** Python's auth event to the worker receiving it. */
  toWorkerMs: LatencySummary | null;
  /** Requests still waiting for an answer. */
  waiting: number;
  oldestWaitingMs: number | null;
};

const SERVING_TYPES_MAX = 24;
const SERVING_AUTHS_MAX = 256;
const SERVING_AUTH_TTL_MS = 120_000;
const SERVING_REASONS_MAX = 32;

/** Count `key`, folding new keys into `other` once the map is full. */
function bumpCapped(map: Map<string, number>, key: string): void {
  const k =
    !map.has(key) && map.size >= SERVING_REASONS_MAX - 1 ? 'other' : key;
  map.set(k, (map.get(k) ?? 0) + 1);
}

function resourceSessionStatsType(payload: {
  resourceType?: string;
  logicalResourceType?: string;
}): string {
  return String(
    payload.logicalResourceType || payload.resourceType || 'unknown'
  ).slice(0, 64);
}

export class MobileReticulumBridge extends EventEmitter {
  private state: 'idle' | 'ready' = 'idle';
  private localDestinationHash: string | undefined;
  private localIdentityPublicKeyBase64: string | null = null;
  private readonly resourceSessionPreparations = new Map<
    string,
    Promise<ReticulumSendResult>
  >();
  private resourceSessionWaiterSeq = 0;
  private readonly resourceSessionWaiters = new Map<
    number,
    { type: string; startedAt: number }
  >();
  private readonly resourceSessionResults = new Map<string, number>();
  /**
   * Stats-only refinement of a result's reason (`ready-timeout` /
   * `ack-timeout` for a `bridge-timeout`); the result itself never changes.
   */
  private readonly resourceSessionStatsReasons = new WeakMap<object, string>();
  /** Peer resource requests waiting for this phone's answer, by transfer id. */
  private readonly servingAuths = new Map<
    string,
    {
      type: string;
      arrivedAt: number | null;
      emittedAt: number | null;
      recvAt: number;
      ended: boolean;
    }
  >();
  private readonly servingByType = new Map<string, ServingTypeStats>();
  private readonly servingEndedReasons = new Map<string, number>();
  private readonly servingFailedReasons = new Map<string, number>();
  private readonly servingTotalMs = createLatencyStats();
  private readonly servingEngineMs = createLatencyStats();
  private readonly servingPythonMs = createLatencyStats();
  private readonly servingToWorkerMs = createLatencyStats();
  /** Established overlay links by link id (desktop: `overlayLinkSnapshots`). */
  private readonly overlayLinkSnapshots = new Map<
    string,
    {
      linkId: string;
      peerPresenceHash: string;
      incoming: boolean;
      overlayTransportAdmitted: boolean;
      connectedAt: number;
      lastRxAt: number;
      lastActivityAt: number;
    }
  >();

  constructor(
    private readonly sendCommand: SendCommandFn,
    private readonly staging?: ReticulumResourceStaging
  ) {
    super();
    this.setMaxListeners(64);
  }

  /** Python `ready` event (relayed from main) flips the bridge live. */
  markReady(payload: Record<string, unknown>): void {
    this.state = 'ready';
    this.setLocalIdentity(
      payload.destinationHash,
      payload.identityPublicKeyBase64
    );
    this.emit('ready', payload);
  }

  markStopped(): void {
    this.state = 'idle';
    const hadAdmittedLink = this.hasAdmittedOverlayLink();
    this.overlayLinkSnapshots.clear();
    // A restarted Python bridge starts with an empty identity cache.
    this.peerIdentityKnownUntil.clear();
    this.emitOverlayAvailabilityChange(hadAdmittedLink);
  }

  getOverlayLinkSnapshots(): Array<{
    linkId: string;
    peerPresenceHash: string;
    incoming: boolean;
    overlayTransportAdmitted: boolean;
    connectedAt: number;
    lastRxAt: number;
    lastActivityAt: number;
  }> {
    return [...this.overlayLinkSnapshots.values()];
  }

  /**
   * Python sends chat frames only on admitted overlay links
   * (`_send_wire_to_overlay_peer`), so without one nothing the engine sends
   * can leave the phone.
   */
  hasAdmittedOverlayLink(): boolean {
    for (const snap of this.overlayLinkSnapshots.values()) {
      if (snap.overlayTransportAdmitted) return true;
    }
    return false;
  }

  /**
   * Raises `overlay-availability` when the first admitted link appears or
   * the last one goes, so the host can resume deferred DM work exactly when
   * the overlay becomes usable.
   */
  private emitOverlayAvailabilityChange(hadAdmittedLink: boolean): void {
    const available = this.hasAdmittedOverlayLink();
    if (available !== hadAdmittedLink) {
      this.emit('overlay-availability', { available });
    }
  }

  private hasAdmittedOverlaySnapshotForPeer(peerPresenceHash: string): boolean {
    for (const snap of this.overlayLinkSnapshots.values()) {
      if (
        snap.overlayTransportAdmitted &&
        snap.peerPresenceHash === peerPresenceHash
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Mirror of the desktop bridge's `overlay_link_state` handling: keep the
   * established-link table the engine consults for relay ordering, and raise
   * `overlay-peer-admitted` exactly once per peer admission so the host can
   * introduce itself (hello_v3 + subscriptions) to the newly authenticated
   * neighbour — the step that lets a Hub learn this device's features.
   */
  private handleOverlayLinkState(payload: unknown): void {
    const frame = (payload ?? {}) as Record<string, unknown>;
    const linkId = String(frame.linkId || '');
    if (!linkId) return;
    const peerPresenceHash = String(frame.peerPresenceHash || '')
      .trim()
      .toLowerCase();
    const established = frame.established === true;
    const hadAdmittedLink = this.hasAdmittedOverlayLink();
    if (!established) {
      this.overlayLinkSnapshots.delete(linkId);
      this.emitOverlayAvailabilityChange(hadAdmittedLink);
      return;
    }
    const admittedNow = frame.overlayTransportAdmitted === true;
    const peerWasAlreadyAdmitted = peerPresenceHash
      ? this.hasAdmittedOverlaySnapshotForPeer(peerPresenceHash)
      : false;
    const existing = this.overlayLinkSnapshots.get(linkId);
    const now = Date.now();
    this.overlayLinkSnapshots.set(linkId, {
      linkId,
      peerPresenceHash: peerPresenceHash || existing?.peerPresenceHash || '',
      incoming: frame.incoming === true,
      overlayTransportAdmitted:
        admittedNow || existing?.overlayTransportAdmitted === true,
      connectedAt: existing?.connectedAt ?? now,
      lastRxAt: now,
      lastActivityAt: now,
    });
    if (admittedNow && peerPresenceHash && !peerWasAlreadyAdmitted) {
      this.emit('overlay-peer-admitted', {
        peerHash: peerPresenceHash,
        source: String(frame.reason || 'overlay-link-state'),
      });
    }
    this.emitOverlayAvailabilityChange(hadAdmittedLink);
  }

  /**
   * The engine refuses to build signed control frames (history page requests,
   * DM discovery, resource offers) without a local peer hash, so this is fed
   * from both the python `ready` payload and the main thread's cached identity.
   */
  setLocalIdentity(destinationHash: unknown, identityPublicKey: unknown): void {
    const hash =
      typeof destinationHash === 'string'
        ? destinationHash.trim().toLowerCase()
        : '';
    if (DESTINATION_HASH_RE.test(hash)) this.localDestinationHash = hash;
    if (typeof identityPublicKey === 'string' && identityPublicKey) {
      this.localIdentityPublicKeyBase64 = identityPublicKey;
    }
  }

  getLocalDestinationHash(): string | undefined {
    return this.localDestinationHash;
  }

  async getLocalIdentityPublicKeyBase64(): Promise<string | null> {
    if (this.localIdentityPublicKeyBase64) {
      return this.localIdentityPublicKeyBase64;
    }
    if (this.state !== 'ready') return null;
    try {
      const resp = await this.sendCommand('get_local_identity_public_key', {});
      const publicKey = resp.ok ? resp.payload?.publicKeyBase64 : null;
      // The reply also carries our RNS destination hash. After an app restart
      // the worker may attach after Python's `ready` frame was consumed, so
      // this is the reliable way to learn the local peer hash the engine
      // needs before it can sign a `dm_notify`.
      const destinationHash = resp.ok
        ? String(resp.payload?.destinationHash || '')
            .trim()
            .toLowerCase()
        : '';
      if (DESTINATION_HASH_RE.test(destinationHash)) {
        this.localDestinationHash = destinationHash;
      }
      if (typeof publicKey === 'string' && publicKey) {
        this.localIdentityPublicKeyBase64 = publicKey;
        return publicKey;
      }
    } catch {
      /* fall through to null */
    }
    return null;
  }

  /**
   * Python chat/resource events relayed from the main thread.
   *
   * `reticulum-chat-message` listeners take the wire and its routing metadata
   * as separate positional arguments (matching the desktop bridge), so the
   * python envelope has to be unwrapped here — passing it through whole makes
   * the engine drop every inbound frame.
   */
  dispatchPythonEvent(event: string, payload: unknown): void {
    if (event === 'reticulum_chat_message') {
      const frame = (payload ?? {}) as Record<string, unknown>;
      const wire = frame.wire;
      if (!wire || typeof wire !== 'object') return;
      this.emit(
        'reticulum-chat-message',
        wire as Record<string, unknown>,
        typeof frame.senderDestinationHash === 'string'
          ? frame.senderDestinationHash
          : '',
        typeof frame.peerPresenceHash === 'string'
          ? frame.peerPresenceHash
          : '',
        typeof frame.linkId === 'string' ? frame.linkId : '',
        frame.landStateFastForwarded === true,
        typeof frame.landStateForwardingRevision === 'number'
          ? frame.landStateForwardingRevision
          : -1
      );
    } else if (event === 'reticulum_chat_resource') {
      this.emitResourceEvent('reticulum-chat-resource', payload);
    } else if (event === 'reticulum_resource') {
      this.emitResourceEvent('reticulum-resource', payload);
    } else if (event === 'reticulum_resource_session') {
      this.emit('reticulum-resource-session', payload ?? {});
    } else if (event === 'overlay_link_state') {
      this.handleOverlayLinkState(payload);
    } else if (event === 'qchat_file_transfer') {
      // Python reports chat resource progress under the legacy file-transfer
      // event; desktop re-routes it by resourceType.
      const resourceType = String(
        (payload as Record<string, unknown>)?.resourceType ?? ''
      );
      if (resourceType.startsWith('reticulum_resource')) {
        this.emitResourceEvent('reticulum-resource', payload);
      } else if (resourceType.startsWith('reticulum_chat')) {
        this.emitResourceEvent('reticulum-chat-resource', payload);
      }
    }
  }

  /**
   * A completed transfer's `path` is a native staging file. Copy it into OPFS
   * and rewrite the path before the engine sees the event, otherwise its
   * `readFileSync` looks for a file that only exists on the Android side.
   *
   * Staging is async while python events are not, so completions are chained to
   * preserve the order the engine receives them in.
   */
  private resourceEventChain: Promise<void> = Promise.resolve();

  private emitResourceEvent(channel: string, payload: unknown): void {
    const frame = (payload ?? {}) as Record<string, unknown>;
    this.noteServingEvent(frame);
    const nativePath = typeof frame.path === 'string' ? frame.path : '';
    const status = String(frame.status ?? '');
    if (!this.staging || !nativePath) {
      this.emit(channel, frame);
      return;
    }
    if (status === 'failed' || status === 'cancelled') {
      void this.staging.discard(nativePath);
      this.emit(channel, frame);
      return;
    }
    if (status !== 'received') {
      this.emit(channel, frame);
      return;
    }
    this.resourceEventChain = this.resourceEventChain
      .then(async () => {
        const opfsPath = await this.staging?.completeInbound(nativePath);
        this.emit(channel, opfsPath ? { ...frame, path: opfsPath } : frame);
      })
      .catch((err) => {
        console.warn('[MobileChat] resource event staging failed', err);
      });
  }

  // ── serving stats (Copy diagnostics; bookkeeping only) ────────────────────

  private servingType(raw: string): ServingTypeStats {
    let type = raw;
    if (
      !this.servingByType.has(type) &&
      this.servingByType.size >= SERVING_TYPES_MAX
    ) {
      type = 'other';
    }
    let stats = this.servingByType.get(type);
    if (!stats) {
      stats = {
        received: 0,
        authorized: 0,
        rejected: 0,
        failed: 0,
        late: 0,
        ended: 0,
      };
      this.servingByType.set(type, stats);
    }
    return stats;
  }

  private pruneServingAuths(now: number): void {
    for (const [transferId, entry] of this.servingAuths) {
      if (now - entry.recvAt > SERVING_AUTH_TTL_MS) {
        this.servingAuths.delete(transferId);
      }
    }
    while (this.servingAuths.size >= SERVING_AUTHS_MAX) {
      this.servingAuths.delete(this.servingAuths.keys().next().value as string);
    }
  }

  /** A peer's resource request (`auth`) or Python ending it (`auth_ended`). Read-only. */
  private noteServingEvent(frame: Record<string, unknown>): void {
    try {
      const status = frame.status;
      const transferId =
        typeof frame.transferId === 'string' ? frame.transferId : '';
      if (!transferId || (status !== 'auth' && status !== 'auth_ended')) {
        return;
      }
      const meta = (
        frame.metadata && typeof frame.metadata === 'object'
          ? frame.metadata
          : {}
      ) as Record<string, unknown>;
      const type = resourceSessionStatsType({
        resourceType: String(frame.resourceType ?? ''),
        logicalResourceType: String(
          meta.logicalResourceType ?? frame.logicalResourceType ?? ''
        ),
      });
      const now = Date.now();
      const num = (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v) ? v : null;
      if (status === 'auth') {
        this.servingType(type).received += 1;
        const arrivedAt = num(frame.arrivedAtMs);
        const emittedAt = num(frame.authStartedAtMs);
        const recvAt = num(frame._workerRecvAtMs) ?? now;
        if (arrivedAt !== null && emittedAt !== null) {
          noteLatency(this.servingPythonMs, emittedAt - arrivedAt, now);
        }
        if (emittedAt !== null) {
          noteLatency(this.servingToWorkerMs, recvAt - emittedAt, now);
        }
        this.pruneServingAuths(now);
        // The latest auth for a transfer replaces an earlier one.
        this.servingAuths.delete(transferId);
        this.servingAuths.set(transferId, {
          type,
          arrivedAt,
          emittedAt,
          recvAt,
          ended: false,
        });
        return;
      }
      const entry = this.servingAuths.get(transferId);
      this.servingType(entry?.type ?? type).ended += 1;
      bumpCapped(
        this.servingEndedReasons,
        /^[a-z0-9_]{1,64}$/.test(String(frame.reason))
          ? String(frame.reason)
          : 'unknown'
      );
      if (entry) entry.ended = true;
    } catch {
      /* diagnostics must never disturb event routing */
    }
  }

  /** This phone's answer to a request it saw (`auth`); unseen ones are not counted. */
  private noteServingAnswer(
    transferId: string,
    kind: 'authorize' | 'reject',
    sentAt: number,
    result: ReticulumSendResult,
    code: unknown
  ): void {
    try {
      const entry = this.servingAuths.get(String(transferId ?? ''));
      if (!entry) return;
      this.servingAuths.delete(String(transferId));
      const stats = this.servingType(entry.type);
      if (kind === 'reject') {
        stats.rejected += 1;
        return;
      }
      if (entry.arrivedAt !== null) {
        noteLatency(this.servingTotalMs, sentAt - entry.arrivedAt, sentAt);
      }
      noteLatency(this.servingEngineMs, sentAt - entry.recvAt, sentAt);
      if (result.ok) {
        stats.authorized += 1;
        return;
      }
      stats.failed += 1;
      if (entry.ended || code === 'unknown_resource_request') stats.late += 1;
      bumpCapped(
        this.servingFailedReasons,
        typeof code === 'string' && /^[a-z0-9_]{1,48}$/.test(code)
          ? code
          : result.ok === false
            ? result.reason
            : 'unknown'
      );
    } catch {
      /* diagnostics only */
    }
  }

  getServingStats(now = Date.now()): ServingStats {
    let waiting = 0;
    let oldestRecvAt: number | null = null;
    for (const entry of this.servingAuths.values()) {
      if (entry.ended || now - entry.recvAt > SERVING_AUTH_TTL_MS) continue;
      waiting += 1;
      if (oldestRecvAt === null || entry.recvAt < oldestRecvAt) {
        oldestRecvAt = entry.recvAt;
      }
    }
    return {
      byType: Object.fromEntries(
        [...this.servingByType].map(([type, stats]) => [type, { ...stats }])
      ),
      endedReasons: Object.fromEntries(this.servingEndedReasons),
      failedReasons: Object.fromEntries(this.servingFailedReasons),
      totalMs: summarizeLatency(this.servingTotalMs, now),
      engineMs: summarizeLatency(this.servingEngineMs, now),
      pythonMs: summarizeLatency(this.servingPythonMs, now),
      toWorkerMs: summarizeLatency(this.servingToWorkerMs, now),
      waiting,
      oldestWaitingMs:
        oldestRecvAt === null ? null : Math.max(0, now - oldestRecvAt),
    };
  }

  getState(): string {
    return this.state;
  }

  async start(): Promise<void> {
    // Lifecycle is owned by the native side; nothing to spawn here.
  }

  private async sendDetailed(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<ReticulumSendResult> {
    return (await this.sendDetailedWithPayload(action, payload, timeoutMs))
      .result;
  }

  /** Same as {@link sendDetailed} but keeps python's response payload. */
  private async sendDetailedWithPayload(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<{ result: ReticulumSendResult; payload?: any }> {
    if (this.state !== 'ready') {
      return { result: { ok: false, reason: 'bridge-not-ready' } };
    }
    try {
      const resp = await this.sendCommand(action, payload, timeoutMs);
      if (resp.ok) return { result: { ok: true }, payload: resp.payload };
      return {
        result: {
          ok: false,
          reason: mapSendFailureReason(resp),
          ...(resp.error ? { error: resp.error } : {}),
        },
        payload: resp.payload,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        result: {
          ok: false,
          reason: message.includes('timed out')
            ? 'bridge-timeout'
            : 'bridge-exception',
          error: message,
        },
      };
    }
  }

  async sendReticulumChatDetailed(
    peerPresenceHash: string,
    message: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    // DM control wires carry a 30 s signed TTL. Waiting the default 20 s for
    // Python only to learn the send failed leaves no time for the engine's
    // retry, so fail these fast and let the retry queue re-sign.
    const kind = String(message?.k || '');
    const destControl =
      kind === 'dm_notify' || kind === 'dm_probe' || kind === 'hello_v3';
    return this.sendDetailed(
      'send_reticulum_chat',
      {
        peerPresenceHash,
        message,
      },
      destControl ? 8_000 : undefined
    );
  }

  async fanoutReticulumChatDetailed(
    messages: Record<string, unknown>[],
    excludePeerPresenceHashes: string[] = [],
    // Bounded gossip (dm_probe / dm_notify / group_sub at width 4). Python
    // picks that many neighbours by rendezvous order; dropping the options
    // here sent every "width 4" round to all 12-20 overlay links. Same
    // forwarding as electron/src/reticulum-bridge.ts.
    options: { maxPeerCount?: number; selectionKey?: string } = {}
  ): Promise<ReticulumSendResult> {
    if (messages.length === 0) {
      return {
        ok: false,
        reason: 'wire-too-large',
        error: 'No Reticulum chat frames fit encrypted wire limit',
      };
    }
    return this.sendDetailed('fanout_reticulum_chat', {
      messages,
      excludePeerPresenceHashes,
      ...(Number.isInteger(options.maxPeerCount) &&
      Number(options.maxPeerCount) > 0
        ? { maxPeerCount: Number(options.maxPeerCount) }
        : {}),
      ...(typeof options.selectionKey === 'string' && options.selectionKey
        ? { selectionKey: options.selectionKey }
        : {}),
    });
  }

  async sendReticulumChatTargetsDetailed(
    peerPresenceHashes: string[],
    message: Record<string, unknown>
  ): Promise<
    ReticulumSendResult & {
      deliveredPeerHashes?: string[];
      failures?: Array<{
        peerPresenceHash: string;
        reason: ReticulumSendFailureReason;
        error?: string;
      }>;
    }
  > {
    const peers = [
      ...new Set(
        peerPresenceHashes.map((p) => p.trim().toLowerCase()).filter(Boolean)
      ),
    ];
    if (peers.length === 0) {
      return { ok: false, reason: 'unknown-peer-presence-hash' };
    }
    if (this.state !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const resp = await this.sendCommand('send_reticulum_chat_targets', {
        peerPresenceHashes: peers,
        message,
      });
      if (!resp.ok) {
        return {
          ok: false,
          reason: mapSendFailureReason(resp),
          ...(resp.error ? { error: resp.error } : {}),
        };
      }
      const deliveredPeerHashes = Array.isArray(
        resp.payload?.deliveredPeerHashes
      )
        ? resp.payload.deliveredPeerHashes
            .filter((p: unknown): p is string => typeof p === 'string' && !!p)
            .map((p: string) => p.trim().toLowerCase())
        : [];
      const failures = Array.isArray(resp.payload?.failures)
        ? resp.payload.failures.flatMap((failure: unknown) => {
            if (!failure || typeof failure !== 'object') return [];
            const record = failure as Record<string, unknown>;
            const peerPresenceHash =
              typeof record.peerPresenceHash === 'string'
                ? record.peerPresenceHash.trim().toLowerCase()
                : '';
            if (!peerPresenceHash) return [];
            const code =
              typeof record.code === 'string'
                ? record.code
                : 'packet_send_false';
            const error =
              typeof record.error === 'string' ? record.error : undefined;
            const reason = mapSendFailureReason({
              ok: false,
              payload: { code },
              ...(error ? { error } : {}),
            });
            return [{ peerPresenceHash, reason, ...(error ? { error } : {}) }];
          })
        : [];
      return { ok: true, deliveredPeerHashes, failures };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: message.includes('timed out')
          ? 'bridge-timeout'
          : 'bridge-exception',
        error: message,
      };
    }
  }

  /**
   * `filePath` points at an OPFS blob the engine just wrote, which python
   * cannot open — copy it into native staging and send the real path instead.
   */
  async sendReticulumChatResourceDetailed(
    payload: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    let staged = payload;
    const filePath =
      typeof payload.filePath === 'string' ? payload.filePath : '';
    if (this.staging && filePath) {
      try {
        staged = {
          ...payload,
          filePath: await this.staging.stageOutbound(filePath),
        };
      } catch (err) {
        return {
          ok: false,
          reason: 'bridge-exception',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    return this.sendDetailed('send_reticulum_chat_resource', staged);
  }

  /**
   * `savePath` is where the engine will later read the payload from, but python
   * does the writing — give it a native path and remember the mapping so the
   * bytes can be moved into OPFS when the transfer completes.
   */
  async acceptReticulumChatResourceDetailed(
    payload: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    let staged = payload;
    const savePath =
      typeof payload.savePath === 'string' ? payload.savePath : '';
    if (this.staging && savePath) {
      try {
        staged = {
          ...payload,
          savePath: await this.staging.reserveInbound(savePath),
        };
      } catch (err) {
        return {
          ok: false,
          reason: 'bridge-exception',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    return this.sendDetailed('accept_reticulum_chat_resource', staged);
  }

  async authorizeReticulumChatResourceDetailed(payload: {
    linkId: string;
    transferId: string;
    /** Routes the command on the bridge's DM-page lane where it has one. */
    logicalResourceType?: string;
  }): Promise<ReticulumSendResult> {
    const sentAt = Date.now();
    // With the payload, so a late answer ('unknown_resource_request') counts.
    const { result, payload: reply } = await this.sendDetailedWithPayload(
      'authorize_reticulum_chat_resource',
      payload
    );
    this.noteServingAnswer(
      payload.transferId,
      'authorize',
      sentAt,
      result,
      reply?.code
    );
    return result;
  }

  async rejectReticulumChatResourceDetailed(payload: {
    linkId: string;
    transferId: string;
    reason: string;
    /** Routes the command on the bridge's DM-page lane where it has one. */
    logicalResourceType?: string;
  }): Promise<ReticulumSendResult> {
    const sentAt = Date.now();
    const result = await this.sendDetailed(
      'reject_reticulum_chat_resource',
      payload
    );
    this.noteServingAnswer(
      payload.transferId,
      'reject',
      sentAt,
      result,
      undefined
    );
    return result;
  }

  async cancelReticulumResourceDetailed(payload: {
    transferId: string;
    peerPresenceHash?: string;
    reason?: string;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('cancel_reticulum_resource', payload);
  }

  /**
   * Generic (non-chat-event) resource transfers — user file and image
   * attachments take this lane rather than the `*_chat_resource` one. Paths
   * need the same OPFS ↔ native staging as their chat counterparts.
   */
  async sendReticulumResourceDetailed(
    payload: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    const staged = await this.stagePathField(payload, 'filePath', 'outbound');
    if ('error' in staged) return staged.error;
    return this.sendDetailed('send_reticulum_resource', staged.payload);
  }

  async acceptReticulumResourceDetailed(
    payload: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    const staged = await this.stagePathField(payload, 'savePath', 'inbound');
    if ('error' in staged) return staged.error;
    return this.sendDetailed('accept_reticulum_resource', staged.payload);
  }

  async authorizeReticulumResourceDetailed(payload: {
    linkId: string;
    transferId: string;
  }): Promise<ReticulumSendResult> {
    const sentAt = Date.now();
    const { result, payload: reply } = await this.sendDetailedWithPayload(
      'authorize_reticulum_resource',
      payload
    );
    this.noteServingAnswer(
      payload.transferId,
      'authorize',
      sentAt,
      result,
      reply?.code
    );
    return result;
  }

  async rejectReticulumResourceDetailed(payload: {
    linkId: string;
    transferId: string;
    reason: string;
  }): Promise<ReticulumSendResult> {
    const sentAt = Date.now();
    const result = await this.sendDetailed(
      'reject_reticulum_resource',
      payload
    );
    this.noteServingAnswer(
      payload.transferId,
      'reject',
      sentAt,
      result,
      undefined
    );
    return result;
  }

  private async stagePathField(
    payload: Record<string, unknown>,
    field: 'filePath' | 'savePath',
    direction: 'outbound' | 'inbound'
  ): Promise<
    { payload: Record<string, unknown> } | { error: ReticulumSendResult }
  > {
    const value = typeof payload[field] === 'string' ? payload[field] : '';
    if (!this.staging || !value) return { payload };
    try {
      const nativePath =
        direction === 'outbound'
          ? await this.staging.stageOutbound(value as string)
          : await this.staging.reserveInbound(value as string);
      return { payload: { ...payload, [field]: nativePath } };
    } catch (err) {
      return {
        error: {
          ok: false,
          reason: 'bridge-exception',
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async ensureReticulumResourceSessionDetailed(payload: {
    peerPresenceHash: string;
    reticulumIdentityPublicKeyBase64: string;
    resourceType: string;
    logicalResourceType?: string;
  }): Promise<ReticulumSendResult> {
    const peerPresenceHash = payload.peerPresenceHash.trim().toLowerCase();
    const logicalResourceType = payload.logicalResourceType ?? '';
    // Same lane table as the desktop bridge (reticulum-bridge.ts).
    const lane =
      ['reticulum_chat_dm_page', 'reticulum_chat_live_event'].includes(
        logicalResourceType
      ) ||
      (![
        'reticulum_chat_author_range',
        'reticulum_chat_history_page',
        'reticulum_chat_metadata_snapshot',
        'reticulum_chat_event_page',
        'reticulum_chat_calendar',
      ].includes(logicalResourceType) &&
        payload.resourceType === 'reticulum_chat_event')
        ? 'fast'
        : 'bulk';
    const statsType = resourceSessionStatsType(payload);
    if (!peerPresenceHash) {
      const result: ReticulumSendResult = {
        ok: false,
        reason: 'unknown-peer-presence-hash',
        error: 'Missing peer presence hash',
      };
      this.noteResourceSessionResult(statsType, result);
      return result;
    }
    // Deduped by peer and lane only, like the desktop bridge. Python gives DM
    // pages their own scheduler lane, so a slow DM-page link must not hold up
    // group sessions here.
    const waiterId = ++this.resourceSessionWaiterSeq;
    this.resourceSessionWaiters.set(waiterId, {
      type: statsType,
      startedAt: Date.now(),
    });
    try {
      const key = `${peerPresenceHash}:${lane}`;
      const existing = this.resourceSessionPreparations.get(key);
      const preparation =
        existing ??
        this.prepareResourceSession({ ...payload, peerPresenceHash }, lane);
      if (!existing) {
        this.resourceSessionPreparations.set(key, preparation);
        void preparation.finally(() => {
          if (this.resourceSessionPreparations.get(key) === preparation) {
            this.resourceSessionPreparations.delete(key);
          }
        });
      }
      const result = await preparation;
      this.noteResourceSessionResult(statsType, result);
      return result;
    } finally {
      this.resourceSessionWaiters.delete(waiterId);
    }
  }

  getResourceSessionStats(): ResourceSessionStats {
    const inFlight: Record<string, number> = {};
    let oldest: { type: string; startedAt: number } | null = null;
    for (const waiter of this.resourceSessionWaiters.values()) {
      inFlight[waiter.type] = (inFlight[waiter.type] ?? 0) + 1;
      if (!oldest || waiter.startedAt < oldest.startedAt) oldest = waiter;
    }
    return {
      inFlight,
      oldestInFlightMs: oldest
        ? Math.max(0, Date.now() - oldest.startedAt)
        : null,
      oldestInFlightType: oldest?.type ?? null,
      results: Object.fromEntries(this.resourceSessionResults),
    };
  }

  private noteResourceSessionResult(
    type: string,
    result: ReticulumSendResult
  ): void {
    const outcome =
      result.ok === false
        ? (this.resourceSessionStatsReasons.get(result) ?? result.reason)
        : 'ok';
    let key = `${type}:${outcome}`;
    // Leave one slot for the overflow bucket so the map never exceeds the cap.
    if (
      !this.resourceSessionResults.has(key) &&
      this.resourceSessionResults.size >= RESOURCE_SESSION_RESULT_KEYS_MAX - 1
    ) {
      key = 'other';
    }
    this.resourceSessionResults.set(
      key,
      (this.resourceSessionResults.get(key) ?? 0) + 1
    );
  }

  /**
   * The command ack only means python accepted the request; the link is not
   * usable until a `reticulum-resource-session` event reports `ready`.
   * Resolving early makes the first range request race an unopened link, which
   * looks to the far side like this device has no data to serve.
   */
  private prepareResourceSession(
    payload: {
      peerPresenceHash: string;
      reticulumIdentityPublicKeyBase64: string;
      resourceType: string;
      logicalResourceType?: string;
    },
    lane: 'fast' | 'bulk',
    timeoutMs = 32_000
  ): Promise<ReticulumSendResult> {
    return new Promise<ReticulumSendResult>((resolve) => {
      type SessionState = {
        status?: string;
        peerPresenceHash?: string;
        lane?: string;
        linkId?: string;
        reason?: string;
      };
      let settled = false;
      let expectedLinkId = '';
      let expectedLane = lane;
      const pending: SessionState[] = [];
      const finish = (result: ReticulumSendResult, statsReason?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.off('reticulum-resource-session', onSessionState);
        if (statsReason) {
          this.resourceSessionStatsReasons.set(result, statsReason);
        }
        resolve(result);
      };
      const onSessionState = (state: SessionState) => {
        if (
          state?.peerPresenceHash?.trim().toLowerCase() !==
          payload.peerPresenceHash
        ) {
          return;
        }
        if (!expectedLinkId) {
          pending.push(state);
          return;
        }
        if (state.lane !== expectedLane) return;
        if (state.linkId && state.linkId !== expectedLinkId) return;
        if (state.status === 'ready') {
          finish({ ok: true });
        } else if (state.status === 'failed') {
          finish({
            ok: false,
            reason:
              state.reason === 'resource_session_backoff'
                ? 'no-route'
                : 'send-command-failed',
            ...(state.reason ? { error: state.reason } : {}),
          });
        }
      };
      // A `bridge-timeout` is counted apart in the stats only: `ready-timeout`
      // when the link never became ready, `ack-timeout` when the command itself
      // got no answer (the local bridge or engine, not the peer).
      const timer = setTimeout(() => {
        finish(
          {
            ok: false,
            reason: 'bridge-timeout',
            error: 'Reticulum resource session preparation timed out',
          },
          'ready-timeout'
        );
      }, timeoutMs);
      this.on('reticulum-resource-session', onSessionState);
      void this.sendDetailedWithPayload('prepare_reticulum_resource_session', {
        ...payload,
        lane,
      })
        .then((resp) => {
          if (!resp.result.ok) {
            finish(
              resp.result,
              resp.result.ok === false &&
                resp.result.reason === 'bridge-timeout'
                ? 'ack-timeout'
                : undefined
            );
            return;
          }
          expectedLinkId = String(resp.payload?.linkId ?? '');
          if (resp.payload?.lane === 'fast' || resp.payload?.lane === 'bulk') {
            expectedLane = resp.payload.lane;
          }
          if (resp.payload?.status === 'ready') {
            finish({ ok: true });
            return;
          }
          for (const state of pending) {
            if (!state.linkId || state.linkId === expectedLinkId) {
              onSessionState(state);
              if (settled) break;
            }
          }
          pending.length = 0;
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          finish(
            {
              ok: false,
              reason: message.includes('timed out')
                ? 'bridge-timeout'
                : 'bridge-exception',
              error: message,
            },
            message.includes('timed out') ? 'ack-timeout' : undefined
          );
        });
    });
  }

  // A positive answer stays true for the life of the bridge's identity cache;
  // the engine asked ~40 times a minute for the same handful of peers.
  private static readonly PEER_IDENTITY_KNOWN_TTL_MS = 10 * 60_000;
  private readonly peerIdentityKnownUntil = new Map<string, number>();

  async ensurePeerIdentityKnown(peerPresenceHash: string): Promise<boolean> {
    const peer = peerPresenceHash.trim().toLowerCase();
    if (!peer || this.state !== 'ready') return false;
    const now = Date.now();
    const knownUntil = this.peerIdentityKnownUntil.get(peer);
    if (knownUntil !== undefined) {
      if (knownUntil > now) return true;
      this.peerIdentityKnownUntil.delete(peer);
    }
    try {
      const resp = await this.sendCommand('ensure_peer_identity', {
        peerPresenceHash: peer,
      });
      if (resp.ok === true) {
        if (this.peerIdentityKnownUntil.size >= 512) {
          for (const [key, until] of this.peerIdentityKnownUntil) {
            if (until <= now) this.peerIdentityKnownUntil.delete(key);
          }
          if (this.peerIdentityKnownUntil.size >= 512) {
            this.peerIdentityKnownUntil.delete(
              this.peerIdentityKnownUntil.keys().next().value as string
            );
          }
        }
        this.peerIdentityKnownUntil.set(
          peer,
          now + MobileReticulumBridge.PEER_IDENTITY_KNOWN_TTL_MS
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async registerPeerIdentityFromGroupJoin(
    peerPresenceHash: string,
    reticulumIdentityPublicKeyBase64: string
  ): Promise<boolean> {
    if (this.state !== 'ready') return false;
    try {
      const resp = await this.sendCommand('register_peer_identity', {
        peerPresenceHash,
        reticulumIdentityPublicKeyBase64,
      });
      return resp.ok === true;
    } catch {
      return false;
    }
  }

  async configureReticulumChatPinnedPeers(
    peers: Array<{
      accountAddress: string;
      destinationHash: string;
      expiresAt: number;
    }>
  ): Promise<boolean> {
    if (this.state !== 'ready') return false;
    const resp = await this.sendCommand(
      'configure_reticulum_chat_pinned_peers',
      { peers }
    );
    if (!resp.ok && resp.payload?.code === 'bridge_command_queue_full') {
      throw new Error(
        resp.error ??
          'Reticulum bridge command backlog: configure_reticulum_chat_pinned_peers'
      );
    }
    return resp.ok;
  }

  async configureLandStateForwarding(
    plans: unknown[],
    sessions: unknown[],
    revision: number,
    _opts?: { startIfNeeded?: boolean }
  ): Promise<ReticulumSendResult> {
    if (this.state !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    return this.sendDetailed('configure_land_state_forwarding', {
      plans,
      sessions,
      revision,
    });
  }

  async configureCommunityStun(
    endpoint: { host: string; port: number; expiresAt: number } | null
  ): Promise<boolean> {
    if (this.state !== 'ready') return false;
    const resp = await this.sendCommand('configure_community_stun', {
      enabled: endpoint !== null,
      ...(endpoint ?? {}),
    });
    return resp.ok;
  }

  async getCommunityStunEndpoints(): Promise<
    Array<{ host: string; port: number; expiresAt: number }>
  > {
    if (this.state !== 'ready') return [];
    const resp = await this.sendCommand('get_community_stun_endpoints', {});
    if (!resp.ok || !Array.isArray(resp.payload?.endpoints)) return [];
    return resp.payload.endpoints.filter(
      (value): value is { host: string; port: number; expiresAt: number } =>
        value != null &&
        typeof value === 'object' &&
        typeof (value as { host?: unknown }).host === 'string' &&
        typeof (value as { port?: unknown }).port === 'number' &&
        typeof (value as { expiresAt?: unknown }).expiresAt === 'number'
    );
  }
}
