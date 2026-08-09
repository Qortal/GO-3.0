/**
 * Mobile ReticulumBridge: the chat engine's transport, living in the engine
 * worker. Faithful port of the desktop `reticulum-bridge.ts` wire contract —
 * same python command actions, same result mapping — but frames travel
 * worker ⇄ main thread ⇄ ReticulumPlugin (Kotlin) ⇄ presence_bridge.py
 * instead of over a child-process stdio pump.
 */
import { EventEmitter } from 'events';
import type { ReticulumResourceStaging } from './resourceStaging';

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

export class MobileReticulumBridge extends EventEmitter {
  private state: 'idle' | 'ready' = 'idle';
  private localDestinationHash: string | undefined;
  private localIdentityPublicKeyBase64: string | null = null;
  private readonly resourceSessionPreparations = new Map<
    string,
    Promise<ReticulumSendResult>
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
        typeof frame.peerPresenceHash === 'string' ? frame.peerPresenceHash : '',
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

  getState(): string {
    return this.state;
  }

  async start(): Promise<void> {
    // Lifecycle is owned by the native side; nothing to spawn here.
  }

  private async sendDetailed(
    action: string,
    payload: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    return (await this.sendDetailedWithPayload(action, payload)).result;
  }

  /** Same as {@link sendDetailed} but keeps python's response payload. */
  private async sendDetailedWithPayload(
    action: string,
    payload: Record<string, unknown>
  ): Promise<{ result: ReticulumSendResult; payload?: any }> {
    if (this.state !== 'ready') {
      return { result: { ok: false, reason: 'bridge-not-ready' } };
    }
    try {
      const resp = await this.sendCommand(action, payload);
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
    return this.sendDetailed('send_reticulum_chat', {
      peerPresenceHash,
      message,
    });
  }

  async fanoutReticulumChatDetailed(
    messages: Record<string, unknown>[],
    excludePeerPresenceHashes: string[] = []
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
    const filePath = typeof payload.filePath === 'string' ? payload.filePath : '';
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
    const savePath = typeof payload.savePath === 'string' ? payload.savePath : '';
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
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('authorize_reticulum_chat_resource', payload);
  }

  async rejectReticulumChatResourceDetailed(payload: {
    linkId: string;
    transferId: string;
    reason: string;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('reject_reticulum_chat_resource', payload);
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
    return this.sendDetailed('authorize_reticulum_resource', payload);
  }

  async rejectReticulumResourceDetailed(payload: {
    linkId: string;
    transferId: string;
    reason: string;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('reject_reticulum_resource', payload);
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
    const lane =
      logicalResourceType === 'reticulum_chat_dm_page' ||
      (![
        'reticulum_chat_history_page',
        'reticulum_chat_metadata_snapshot',
        'reticulum_chat_event_page',
        'reticulum_chat_calendar',
      ].includes(logicalResourceType) &&
        payload.resourceType === 'reticulum_chat_event')
        ? 'fast'
        : 'bulk';
    if (!peerPresenceHash) {
      return {
        ok: false,
        reason: 'unknown-peer-presence-hash',
        error: 'Missing peer presence hash',
      };
    }
    const key = `${peerPresenceHash}:${lane}`;
    const existing = this.resourceSessionPreparations.get(key);
    if (existing) return existing;
    const preparation = this.prepareResourceSession(
      { ...payload, peerPresenceHash },
      lane
    );
    this.resourceSessionPreparations.set(key, preparation);
    void preparation.finally(() => {
      if (this.resourceSessionPreparations.get(key) === preparation) {
        this.resourceSessionPreparations.delete(key);
      }
    });
    return preparation;
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
    lane: 'fast' | 'bulk'
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
      const finish = (result: ReticulumSendResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.off('reticulum-resource-session', onSessionState);
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
      const timer = setTimeout(() => {
        finish({
          ok: false,
          reason: 'bridge-timeout',
          error: 'Reticulum resource session preparation timed out',
        });
      }, 32_000);
      this.on('reticulum-resource-session', onSessionState);
      void this.sendDetailedWithPayload('prepare_reticulum_resource_session', {
        ...payload,
        lane,
      })
        .then((resp) => {
          if (!resp.result.ok) {
            finish(resp.result);
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
          finish({
            ok: false,
            reason: message.includes('timed out')
              ? 'bridge-timeout'
              : 'bridge-exception',
            error: message,
          });
        });
    });
  }

  async ensurePeerIdentityKnown(peerPresenceHash: string): Promise<boolean> {
    const peer = peerPresenceHash.trim().toLowerCase();
    if (!peer || this.state !== 'ready') return false;
    try {
      const resp = await this.sendCommand('ensure_peer_identity', {
        peerPresenceHash: peer,
      });
      return resp.ok === true;
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
}
