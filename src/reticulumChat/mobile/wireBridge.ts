/**
 * Mobile ReticulumBridge: the chat engine's transport, living in the engine
 * worker. Faithful port of the desktop `reticulum-bridge.ts` wire contract —
 * same python command actions, same result mapping — but frames travel
 * worker ⇄ main thread ⇄ ReticulumPlugin (Kotlin) ⇄ presence_bridge.py
 * instead of over a child-process stdio pump.
 */
import { EventEmitter } from 'events';

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

export class MobileReticulumBridge extends EventEmitter {
  private state: 'idle' | 'ready' = 'idle';
  private readonly resourceSessionPreparations = new Map<
    string,
    Promise<ReticulumSendResult>
  >();

  constructor(private readonly sendCommand: SendCommandFn) {
    super();
    this.setMaxListeners(64);
  }

  /** Python `ready` event (relayed from main) flips the bridge live. */
  markReady(payload: Record<string, unknown>): void {
    this.state = 'ready';
    this.emit('ready', payload);
  }

  markStopped(): void {
    this.state = 'idle';
  }

  /** Python chat/resource events relayed from the main thread. */
  dispatchPythonEvent(event: string, payload: unknown): void {
    if (event === 'reticulum_chat_message') {
      this.emit('reticulum-chat-message', payload);
    } else if (event === 'reticulum_chat_resource') {
      this.emit('reticulum-chat-resource', payload);
    } else if (event === 'reticulum_resource') {
      this.emit('reticulum-resource', payload);
    } else if (event === 'reticulum_resource_session') {
      this.emit('reticulum-resource-session', payload);
    }
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
    if (this.state !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const resp = await this.sendCommand(action, payload);
      if (resp.ok) return { ok: true };
      return {
        ok: false,
        reason: mapSendFailureReason(resp),
        ...(resp.error ? { error: resp.error } : {}),
      };
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

  async sendReticulumChatResourceDetailed(
    payload: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    return this.sendDetailed('send_reticulum_chat_resource', payload);
  }

  async acceptReticulumChatResourceDetailed(
    payload: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    return this.sendDetailed('accept_reticulum_chat_resource', payload);
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
    const preparation = this.sendDetailed('prepare_reticulum_resource_session', {
      ...payload,
      peerPresenceHash,
      lane,
    });
    this.resourceSessionPreparations.set(key, preparation);
    void preparation.finally(() => {
      if (this.resourceSessionPreparations.get(key) === preparation) {
        this.resourceSessionPreparations.delete(key);
      }
    });
    return preparation;
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
