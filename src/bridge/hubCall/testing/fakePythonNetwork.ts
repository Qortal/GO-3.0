/**
 * In-memory stand-in for GO's Python Reticulum bridge, for tests of the
 * hosted Hub call managers. Each FakePythonNode is one device (one presence
 * destination hash) and implements HubCallPythonTransport; the network
 * delivers what presence_bridge.py would deliver:
 *
 *   fanout_call / fanout_group_call → every other node, `r` stamped with the
 *     origin (kept if a valid origin `r` is already present), emitted as
 *     call_message / group_call_message by wire type (_emit_call_bridge_message)
 *   send_call / send_group_call     → the addressed node only
 *   open_group_audio_link           → resp {linkId, established:false}, then
 *     group_audio_link_established at both ends (same link id, like RNS)
 *   send_group_audio                → group_audio_packet at the other end of
 *     the link (raw bytes base64, QGAU sender = origin destination)
 *   send_group_audio_link_control   → GO0 + GO1 fragments (base64url of the
 *     payload, z = sha256(payload), compact JSON, `QGCCTL1\0` prefix) as
 *     group_audio_packet frames at the other end (_send_group_audio_control_bundle)
 *   send_group_audio_link_heartbeat → GAC JSON packet → group_call_message
 *     with linkId at the other end
 *   close_group_audio_link          → group_audio_link_closed at both ends
 *
 * Simplifications: no canonical-link dedupe, no GCC1 probe (channel always
 * ready), no relays (every node is a direct neighbour), no packet loss.
 * Delivery is asynchronous (macrotask) and in order.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import type {
  HubCallPythonTransport,
  PythonEventFrame,
  PythonRespFrame,
} from '../pythonTransport';

const GROUP_CALL_WIRE_TYPES = new Set([
  'GA',
  'GAC',
  'GJ',
  'GL',
  'GH',
  'GK',
  'GK0',
  'GK1',
  'GQ',
  'GQ0',
  'GQ1',
  'GT',
  'GT0',
  'GT1',
  'GR',
  'GR0',
  'GR1',
  'GO',
  'GO0',
  'GO1',
  'GE',
  'GE0',
  'GE1',
  'GF',
  'GI',
  'GX',
]);

const LINK_CONTROL_MAGIC = 'QGCCTL1\0';
const CONTROL_FRAGMENT_CHARS = 300;

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function utf8Base64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

export type FakeLink = {
  linkId: string;
  opener: FakePythonNode;
  acceptor: FakePythonNode;
  open: boolean;
};

export type FakeCommandRecord = {
  action: string;
  payload: Record<string, unknown>;
  at: number;
};

export class FakePythonNetwork {
  readonly nodes = new Map<string, FakePythonNode>();
  readonly links = new Map<string, FakeLink>();
  private nextLinkId = 1;
  /** Drop rule for tests: return true to drop a delivery. */
  dropFilter:
    | ((info: {
        from: string;
        to: string;
        event: string;
        payload: Record<string, unknown>;
      }) => boolean)
    | null = null;

  addNode(destinationHash: string): FakePythonNode {
    const node = new FakePythonNode(this, destinationHash.toLowerCase());
    this.nodes.set(node.destinationHash, node);
    return node;
  }

  createLink(opener: FakePythonNode, acceptor: FakePythonNode): FakeLink {
    const linkId = `link${String(this.nextLinkId++).padStart(28, '0')}`;
    const link: FakeLink = { linkId, opener, acceptor, open: true };
    this.links.set(linkId, link);
    return link;
  }

  /** Asynchronous, ordered delivery of one Python event to a node. */
  deliver(
    from: FakePythonNode,
    to: FakePythonNode,
    event: string,
    payload: Record<string, unknown>
  ): void {
    if (
      this.dropFilter?.({
        from: from.destinationHash,
        to: to.destinationHash,
        event,
        payload,
      })
    ) {
      return;
    }
    setTimeout(() => to.emitEvent({ type: 'event', event, payload }), 0);
  }

  otherEnd(link: FakeLink, self: FakePythonNode): FakePythonNode {
    return link.opener === self ? link.acceptor : link.opener;
  }
}

export class FakePythonNode implements HubCallPythonTransport {
  ready = true;
  readonly commands: FakeCommandRecord[] = [];
  private readonly listeners = new Set<(frame: PythonEventFrame) => void>();
  private readonly readyListeners = new Set<(ready: boolean) => void>();

  constructor(
    readonly network: FakePythonNetwork,
    readonly destinationHash: string
  ) {}

  // ── HubCallPythonTransport ─────────────────────────────────────────────
  async commandWithResult(
    action: string,
    payload: Record<string, unknown>,
    _timeoutMs: number
  ): Promise<PythonRespFrame> {
    return this.handle(action, payload);
  }

  async command(
    action: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    this.handle(action, payload);
  }

  onEvent(cb: (frame: PythonEventFrame) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  isReady(): boolean {
    return this.ready;
  }

  onReadyChange(cb: (ready: boolean) => void): () => void {
    this.readyListeners.add(cb);
    return () => this.readyListeners.delete(cb);
  }

  getLocalDestinationHash(): string | undefined {
    return this.destinationHash;
  }

  // ── test helpers ───────────────────────────────────────────────────────
  setReady(ready: boolean): void {
    this.ready = ready;
    for (const cb of [...this.readyListeners]) cb(ready);
  }

  emitEvent(frame: PythonEventFrame): void {
    for (const cb of [...this.listeners]) cb(frame);
  }

  commandsOf(action: string): FakeCommandRecord[] {
    return this.commands.filter((c) => c.action === action);
  }

  // ── python behaviour ───────────────────────────────────────────────────
  private ok(payload?: Record<string, unknown>): PythonRespFrame {
    return { type: 'resp', ok: true, ...(payload ? { payload } : {}) };
  }

  private fail(code: string, error: string): PythonRespFrame {
    return { type: 'resp', ok: false, payload: { code }, error };
  }

  private stamp(message: Record<string, unknown>): Record<string, unknown> {
    const origin = typeof message.r === 'string' ? message.r : '';
    return /^[0-9a-f]{32}$/.test(origin)
      ? { ...message }
      : { ...message, r: this.destinationHash };
  }

  private deliverWire(
    to: FakePythonNode,
    message: Record<string, unknown>,
    linkId?: string
  ): void {
    const wire = this.stamp(message);
    const t = typeof wire.t === 'string' ? wire.t : '';
    this.network.deliver(
      this,
      to,
      GROUP_CALL_WIRE_TYPES.has(t) ? 'group_call_message' : 'call_message',
      {
        wire,
        senderDestinationHash: wire.r,
        peerPresenceHash: this.destinationHash,
        ...(linkId ? { linkId } : {}),
      }
    );
  }

  private findLink(payload: Record<string, unknown>): FakeLink | null {
    const linkId = typeof payload.linkId === 'string' ? payload.linkId : '';
    if (linkId) {
      const link = this.network.links.get(linkId);
      if (
        link &&
        link.open &&
        (link.opener === this || link.acceptor === this)
      ) {
        return link;
      }
    }
    const peer =
      typeof payload.peerPresenceHash === 'string'
        ? payload.peerPresenceHash.toLowerCase()
        : '';
    if (!peer) return null;
    for (const link of this.network.links.values()) {
      if (!link.open) continue;
      if (
        (link.opener === this && link.acceptor.destinationHash === peer) ||
        (link.acceptor === this && link.opener.destinationHash === peer)
      ) {
        return link;
      }
    }
    return null;
  }

  private deliverAudioFrame(
    link: FakeLink | null,
    to: FakePythonNode,
    roomId: string,
    rawBase64: string
  ): void {
    this.network.deliver(this, to, 'group_audio_packet', {
      linkId: link ? link.linkId : '',
      roomId,
      peerPresenceHash: this.destinationHash,
      peerDestinationHash: this.destinationHash,
      receivedAtWallMs: Date.now(),
      data: rawBase64,
    });
  }

  private handle(
    action: string,
    payload: Record<string, unknown>
  ): PythonRespFrame {
    this.commands.push({ action, payload, at: Date.now() });
    if (!this.ready) {
      return this.fail('bridge_not_started', 'Bridge not started');
    }
    switch (action) {
      case 'fanout_call':
      case 'fanout_group_call': {
        const messages = Array.isArray(payload.messages)
          ? (payload.messages as Record<string, unknown>[])
          : [];
        const exclude = new Set(
          (Array.isArray(payload.excludePeerPresenceHashes)
            ? (payload.excludePeerPresenceHashes as string[])
            : []
          ).map((h) => String(h).toLowerCase())
        );
        for (const node of this.network.nodes.values()) {
          if (node === this || exclude.has(node.destinationHash)) continue;
          for (const message of messages) this.deliverWire(node, message);
        }
        return this.ok();
      }
      case 'send_call':
      case 'send_group_call': {
        const peer = String(payload.peerPresenceHash || '').toLowerCase();
        const node = this.network.nodes.get(peer);
        if (!node || node === this) {
          return this.fail('no_route', 'No route');
        }
        this.deliverWire(node, payload.message as Record<string, unknown>);
        return this.ok();
      }
      case 'open_group_audio_link': {
        const peer = String(payload.peerPresenceHash || '').toLowerCase();
        const node = this.network.nodes.get(peer);
        if (!node || node === this) {
          return this.fail('unknown_peer_presence_hash', 'Unknown peer');
        }
        for (const existing of this.network.links.values()) {
          if (
            existing.open &&
            existing.opener === this &&
            existing.acceptor === node
          ) {
            return this.ok({ linkId: existing.linkId, established: true });
          }
        }
        const link = this.network.createLink(this, node);
        // Outgoing establish, then the acceptor identifies the opener.
        this.network.deliver(this, this, 'group_audio_link_established', {
          linkId: link.linkId,
          peerPresenceHash: node.destinationHash,
          peerDestinationHash: node.destinationHash,
          incoming: false,
          managerState: 'established',
          generation: 1,
        });
        this.network.deliver(this, node, 'group_audio_link_established', {
          linkId: link.linkId,
          peerPresenceHash: this.destinationHash,
          peerDestinationHash: this.destinationHash,
          incoming: true,
          managerState: 'established',
          generation: 1,
        });
        return this.ok({ linkId: link.linkId, established: false });
      }
      case 'close_group_audio_link': {
        const linkId = String(payload.linkId || '');
        const link = this.network.links.get(linkId);
        if (!link) return this.fail('unknown_link_id', 'Unknown audio link id');
        if (link.open) {
          link.open = false;
          const reason = String(payload.reason || 'local_close');
          for (const [end, peer] of [
            [link.opener, link.acceptor],
            [link.acceptor, link.opener],
          ] as const) {
            this.network.deliver(this, end, 'group_audio_link_closed', {
              linkId,
              peerPresenceHash: peer.destinationHash,
              peerDestinationHash: peer.destinationHash,
              incoming: end === link.acceptor,
              reason,
            });
          }
        }
        return this.ok();
      }
      case 'send_group_audio': {
        const data = typeof payload.data === 'string' ? payload.data : '';
        const roomId = String(payload.roomId || '');
        const linkId = String(payload.linkId || '');
        if (!linkId) {
          const peer = String(payload.peerPresenceHash || '').toLowerCase();
          const node = this.network.nodes.get(peer);
          if (node && node !== this)
            this.deliverAudioFrame(null, node, roomId, data);
          return this.ok();
        }
        const link = this.findLink({ linkId });
        if (!link) {
          this.network.deliver(this, this, 'group_audio_send_failed', {
            linkId,
            peerPresenceHash: String(payload.peerPresenceHash || ''),
            transport: 'link',
            reason: 'unknown_link_id',
            code: 'unknown_link_id',
          });
          return this.ok();
        }
        this.deliverAudioFrame(
          link,
          this.network.otherEnd(link, this),
          roomId,
          data
        );
        return this.ok();
      }
      case 'send_group_audio_link_control': {
        const link = this.findLink(payload);
        if (!link) {
          return this.fail('audio_link_not_ready', 'Audio link not ready');
        }
        const roomId = String(payload.roomId || '');
        let compressed: Uint8Array;
        try {
          compressed = bytesFromBase64(String(payload.payload || ''));
        } catch {
          return this.fail('invalid_control_payload', 'Invalid payload');
        }
        if (compressed.length === 0) {
          return this.fail('invalid_control_payload', 'Invalid payload');
        }
        const encoded = bytesToBase64(compressed)
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        const z = hex(sha256(compressed));
        const n = Math.ceil(encoded.length / CONTROL_FRAGMENT_CHARS);
        const to = this.network.otherEnd(link, this);
        const frames: Record<string, unknown>[] = [
          { t: 'GO0', R: roomId, z, n },
        ];
        for (let x = 0; x < n; x++) {
          frames.push({
            t: 'GO1',
            R: roomId,
            z,
            n,
            x,
            p: encoded.slice(
              x * CONTROL_FRAGMENT_CHARS,
              (x + 1) * CONTROL_FRAGMENT_CHARS
            ),
          });
        }
        for (const frame of frames) {
          this.deliverAudioFrame(
            link,
            to,
            roomId,
            utf8Base64(LINK_CONTROL_MAGIC + JSON.stringify(frame))
          );
        }
        return this.ok();
      }
      case 'send_group_audio_link_heartbeat': {
        const link = this.findLink(payload);
        if (!link) {
          return this.fail('audio_link_not_ready', 'Audio link not ready');
        }
        const wire: Record<string, unknown> = {
          t: 'GAC',
          R: String(payload.roomId || ''),
          c: String(payload.command || ''),
          m: Date.now(),
        };
        if (typeof payload.seq === 'number') wire.p = payload.seq;
        if (typeof payload.packetRxAgeMs === 'number') {
          wire.pa = Math.max(
            -1,
            Math.min(60_000, Math.trunc(payload.packetRxAgeMs))
          );
        }
        if (typeof payload.packetRxRecent === 'boolean') {
          wire.pr = payload.packetRxRecent ? 1 : 0;
        }
        this.deliverWire(this.network.otherEnd(link, this), wire, link.linkId);
        return this.ok();
      }
      case 'warm_group_audio_path':
        return this.ok({ pathState: 'known', ready: true });
      case 'register_peer_identity':
      case 'reset_group_audio_peer_state':
      case 'clear_group_audio_diagnostics':
      case 'configure_group_audio_forwarding':
      case 'configure_group_audio_data_plane_routes':
        return this.ok();
      default:
        return { type: 'resp', ok: false, error: `Unknown action: ${action}` };
    }
  }
}
