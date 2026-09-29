/**
 * Engine host: runs inside the dedicated mobile chat worker AFTER the shims
 * (fs, sqlite, Buffer, process) are initialised by engine.worker.ts.
 *
 * Mirrors the desktop wiring in electron/src/setup.ts:
 *  - constructs the ReticulumResourceStore and ReticulumChatManager,
 *  - implements the 67 `reticulumChat:*` invoke handlers over the manager,
 *  - forwards the manager's events to the main thread (which fans them out to
 *    the preload-twin subscribers exactly like sendToRenderer did),
 *  - implements signing via RPC to the renderer's existing
 *    `signReticulumChatEvent` background case, and Qortal group member/admin
 *    validation via direct core API calls.
 */
import { getRecentLogs } from './shims/logger';
import {
  startReticulumChatManager,
  stopReticulumChatManager,
  getReticulumChatManager,
} from '../../../electron/src/reticulum-chat';
import * as fs from 'fs';
import { ReticulumResourceStore } from '../../../electron/src/reticulum-resource-store';
import { MobileReticulumBridge } from './wireBridge';
import { ReticulumResourceStaging } from './resourceStaging';
import type { NativeFsFn } from './resourceStaging';

type WorkerOut =
  | { t: 'evt'; channel: string; payload: unknown }
  | { t: 'rpcres'; id: number; ok: boolean; value?: unknown; error?: string }
  | {
      t: 'cmd';
      id: number;
      action: string;
      payload: Record<string, unknown>;
      timeoutMs?: number;
    }
  | { t: 'sign'; id: number; fields: Record<string, unknown> }
  | { t: 'nativefs'; id: number; op: string; args: Record<string, unknown> }
  | { t: 'engine-ready' }
  | { t: 'engine-failed'; error: string }
  | {
      t: 'identity-ack';
      destinationHash: string;
      identityPublicKeyBase64?: string | null;
    }
  | { t: 'direct-bridge'; connected: boolean }
  | {
      t: 'bridge-traffic';
      seconds: number;
      commands: Array<[string, number]>;
      events: Array<[string, number]>;
      resourceBytes: Array<[string, number]>;
    };

const post = (msg: WorkerOut) => {
  (self as unknown as Worker).postMessage(msg);
};

// ── bridge traffic accounting ────────────────────────────────────────────────
// One summary a minute of what crosses the bridge, so a battery or sync
// report from the field can be matched to actual command/event volume.

const BRIDGE_TRAFFIC_REPORT_MS = 60_000;
const bridgeCommandCounts = new Map<string, number>();
const bridgeEventCounts = new Map<string, number>();
const bridgeResourceBytes = new Map<string, number>();
let bridgeTrafficWindowStart = Date.now();

const countBridge = (map: Map<string, number>, key: string): void => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

let localCompactRouteHash = '';
const compactRouteHash = (hexHash: string): string => {
  if (!/^[0-9a-f]{32}$/i.test(hexHash)) return '';
  let binary = '';
  for (let i = 0; i < hexHash.length; i += 2) {
    binary += String.fromCharCode(parseInt(hexHash.slice(i, i + 2), 16));
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

/** `action:kind` for chat wires so the summary shows which protocol messages dominate. */
const bridgeTrafficKey = (name: string, payload: unknown): string => {
  const p = (payload ?? {}) as Record<string, any>;
  const wire =
    p.message ?? p.wire ?? (Array.isArray(p.messages) ? p.messages[0] : null);
  const kind =
    wire && typeof wire === 'object'
      ? (wire.k ?? wire.t ?? wire.type)
      : undefined;
  if (!kind) {
    // Resource lifecycle events carry a status (advertised/progress/complete/...).
    if (typeof p.status === 'string' && p.status) {
      const meta = (p.metadata ?? {}) as Record<string, unknown>;
      const logical =
        meta.logicalResourceType ?? meta.resourceType ?? p.resourceType;
      const size = Number(p.size ?? meta.size ?? 0);
      if (
        (p.status === 'received' || p.status === 'sent') &&
        Number.isFinite(size) &&
        size > 0
      ) {
        const dir = p.status === 'received' ? 'rx' : 'tx';
        bridgeResourceBytes.set(
          dir,
          (bridgeResourceBytes.get(dir) ?? 0) + size
        );
      }
      return typeof logical === 'string' && logical
        ? `${name}:${p.status}:${logical.replace(/^reticulum_chat_/, '')}`
        : `${name}:${p.status}`;
    }
    return name;
  }
  if (kind === 'group_state_digest_v3' && typeof wire.o === 'string') {
    // Distinguish our own digests from ones we relay for other peers.
    if (!localCompactRouteHash) {
      localCompactRouteHash = compactRouteHash(
        bridge?.getLocalDestinationHash() ?? ''
      );
    }
    const origin =
      localCompactRouteHash && wire.o === localCompactRouteHash ? 'own' : 'fwd';
    return `${name}:${String(kind)}:${origin}`;
  }
  return `${name}:${String(kind)}`;
};

const flushBridgeTraffic = (): void => {
  const now = Date.now();
  const seconds = Math.round((now - bridgeTrafficWindowStart) / 1000);
  bridgeTrafficWindowStart = now;
  if (bridgeCommandCounts.size === 0 && bridgeEventCounts.size === 0) return;
  const top = (map: Map<string, number>): Array<[string, number]> =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  post({
    t: 'bridge-traffic',
    seconds,
    commands: top(bridgeCommandCounts),
    events: top(bridgeEventCounts),
    resourceBytes: [...bridgeResourceBytes.entries()],
  });
  bridgeCommandCounts.clear();
  bridgeEventCounts.clear();
  bridgeResourceBytes.clear();
};
setInterval(flushBridgeTraffic, BRIDGE_TRAFFIC_REPORT_MS);

// ── main-thread RPC plumbing (commands + signing) ────────────────────────────

let nextOutId = 1;
const pendingOut = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();

function requestMain<T>(
  msg:
    | Omit<Extract<WorkerOut, { t: 'cmd' }>, 'id'>
    | Omit<Extract<WorkerOut, { t: 'sign' }>, 'id'>
    | Omit<Extract<WorkerOut, { t: 'nativefs' }>, 'id'>,
  timeoutMs = 30_000
): Promise<T> {
  const id = nextOutId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingOut.delete(id);
      reject(
        new Error(
          `worker->main request timed out: ${(msg as any).action ?? msg.t}`
        )
      );
    }, timeoutMs);
    pendingOut.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    post({ ...(msg as any), id });
  });
}

// ── direct native bridge socket ──────────────────────────────────────────────
//
// Plugin calls and `notifyListeners` events both cross the WebView main thread,
// which Q-App iframes share. A busy app (or a long GC) stalls that thread for
// seconds, so a DM page authorization or a digest send waits long enough for
// the remote side to time out. The native plugin exposes a loopback WebSocket
// (BridgeSocketServer.kt) that this worker talks to directly; commands, Python
// events and resource staging all take that path when it is up, and fall back
// to the main-thread relay when it is not.

type BridgeSocketInfo = { url: string; token: string };

const PY_EVENTS_FOR_ENGINE = new Set([
  'ready',
  'reticulum_chat_message',
  'reticulum_chat_resource',
  'reticulum_resource',
  'reticulum_resource_session',
  'qchat_file_transfer',
  'overlay_link_state',
]);

const SOCKET_RECONNECT_MIN_MS = 1_000;
const SOCKET_RECONNECT_MAX_MS = 30_000;
// Loopback socket to the native bridge: no NAT or proxy to keep alive, the
// ping only detects a dead server. 60 s is plenty and 4x fewer wakeups.
const SOCKET_KEEPALIVE_MS = 60_000;

let socketInfo: BridgeSocketInfo | null = null;
let socket: WebSocket | null = null;
let socketOpen = false;
let socketReconnectDelay = SOCKET_RECONNECT_MIN_MS;
let socketReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let socketKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
let socketClosedByUs = false;
let nextSocketId = 1;
const pendingSocket = new Map<
  string,
  {
    resolve: (v: any) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

function bridgeSocketAvailable(): boolean {
  return socketOpen && socket !== null && socket.readyState === WebSocket.OPEN;
}

function failPendingSocketRequests(reason: string): void {
  for (const [id, pending] of pendingSocket) {
    clearTimeout(pending.timer);
    pendingSocket.delete(id);
    pending.reject(new Error(reason));
  }
}

function socketRequest<T>(
  frame: Record<string, unknown>,
  id: string,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingSocket.delete(id);
      reject(new Error(`worker->native request timed out: ${label}`));
    }, timeoutMs);
    pendingSocket.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
      timer,
    });
    try {
      socket!.send(JSON.stringify(frame));
    } catch (err) {
      clearTimeout(timer);
      pendingSocket.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function handleSocketFrame(raw: string): void {
  let frame: any;
  try {
    frame = JSON.parse(raw);
  } catch {
    return;
  }
  if (!frame || typeof frame !== 'object') return;
  const type = frame.type;
  if (type === 'resp') {
    const pending = pendingSocket.get(String(frame.id ?? ''));
    if (pending) {
      pendingSocket.delete(String(frame.id));
      pending.resolve(frame);
    }
    // Responses to the main thread's own commands are not ours; ignore.
    return;
  }
  if (type === 'fsres') {
    const pending = pendingSocket.get(String(frame.id ?? ''));
    if (!pending) return;
    pendingSocket.delete(String(frame.id));
    if (frame.error) pending.reject(new Error(String(frame.error)));
    else pending.resolve(frame.result ?? {});
    return;
  }
  if (type === 'event') {
    const eventName = String(frame.event || '');
    if (!PY_EVENTS_FOR_ENGINE.has(eventName)) return;
    handlePythonEvent(eventName, frame.payload ?? {});
  }
}

function connectBridgeSocket(): void {
  if (!socketInfo || socket) return;
  socketClosedByUs = false;
  const url = `${socketInfo.url}?token=${encodeURIComponent(socketInfo.token)}`;
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.warn('[MobileChat] bridge socket connect failed', err);
    scheduleBridgeSocketReconnect();
    return;
  }
  socket = ws;
  ws.onopen = () => {
    if (socket !== ws) return;
    socketOpen = true;
    socketReconnectDelay = SOCKET_RECONNECT_MIN_MS;
    console.log('[MobileChat] bridge_socket_connected');
    post({ t: 'direct-bridge', connected: true });
    if (socketKeepaliveTimer) clearInterval(socketKeepaliveTimer);
    socketKeepaliveTimer = setInterval(() => {
      if (bridgeSocketAvailable()) {
        try {
          ws.send('{"type":"ping"}');
        } catch {
          /* close handler will follow */
        }
      }
    }, SOCKET_KEEPALIVE_MS);
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') handleSocketFrame(ev.data);
  };
  ws.onerror = () => {
    /* onclose follows */
  };
  ws.onclose = (ev) => {
    if (socket !== ws) return;
    const wasOpen = socketOpen;
    socket = null;
    socketOpen = false;
    if (socketKeepaliveTimer) {
      clearInterval(socketKeepaliveTimer);
      socketKeepaliveTimer = null;
    }
    failPendingSocketRequests('bridge socket closed');
    if (wasOpen) {
      console.warn(
        `[MobileChat] bridge_socket_closed code=${ev.code} reason=${ev.reason || 'none'}`
      );
      post({ t: 'direct-bridge', connected: false });
    }
    if (!socketClosedByUs) scheduleBridgeSocketReconnect();
  };
}

function scheduleBridgeSocketReconnect(): void {
  if (socketReconnectTimer || socketClosedByUs || !socketInfo) return;
  const delay = socketReconnectDelay;
  socketReconnectDelay = Math.min(
    SOCKET_RECONNECT_MAX_MS,
    socketReconnectDelay * 2
  );
  socketReconnectTimer = setTimeout(() => {
    socketReconnectTimer = null;
    connectBridgeSocket();
  }, delay);
}

function setBridgeSocketInfo(info: BridgeSocketInfo): void {
  if (
    socketInfo &&
    socketInfo.url === info.url &&
    socketInfo.token === info.token
  ) {
    if (!socket) connectBridgeSocket();
    return;
  }
  socketInfo = info;
  if (socket) {
    // Endpoint changed (native side restarted): drop the stale connection;
    // onclose reconnects to the new endpoint.
    const stale = socket;
    socket = null;
    socketOpen = false;
    try {
      stale.close();
    } catch {
      /* ignore */
    }
  }
  connectBridgeSocket();
}

function closeBridgeSocket(): void {
  socketClosedByUs = true;
  if (socketReconnectTimer) {
    clearTimeout(socketReconnectTimer);
    socketReconnectTimer = null;
  }
  if (socketKeepaliveTimer) {
    clearInterval(socketKeepaliveTimer);
    socketKeepaliveTimer = null;
  }
  const current = socket;
  socket = null;
  socketOpen = false;
  failPendingSocketRequests('bridge socket closed');
  try {
    current?.close();
  } catch {
    /* ignore */
  }
}

const sendPythonCommand = (
  action: string,
  payload: Record<string, unknown>,
  timeoutMs = 20_000
): Promise<{ ok: boolean; error?: string; payload?: Record<string, any> }> => {
  countBridge(bridgeCommandCounts, bridgeTrafficKey(action, payload));
  if (bridgeSocketAvailable()) {
    const id = `w-${nextSocketId++}`;
    return socketRequest(
      { type: 'cmd', id, action, payload },
      id,
      timeoutMs + 5_000,
      action
    );
  }
  return requestMain<{
    ok: boolean;
    error?: string;
    payload?: Record<string, any>;
  }>({ t: 'cmd', action, payload, timeoutMs }, timeoutMs + 5_000);
};

const nativeFs = (
  op: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  if (bridgeSocketAvailable()) {
    const id = `fs-${nextSocketId++}`;
    return socketRequest(
      { type: 'fs', id, op, args },
      id,
      30_000,
      `nativefs:${op}`
    );
  }
  return requestMain<Record<string, unknown>>(
    { t: 'nativefs', op, args },
    30_000
  );
};

// ── environment fed from the main thread ─────────────────────────────────────

type EngineConfig = {
  apiBase: string;
  apiKey?: string;
};

let config: EngineConfig = { apiBase: '' };
let presencePeers: Array<Record<string, unknown>> = [];
let presenceLeases: Array<Record<string, unknown>> = [];
let overlayHealthy = false;

// ── Qortal group validation (port of setup.ts validateQortalGroupMember) ────

const GROUP_VALIDATION_TTL_MS = 5 * 60_000;
const GROUP_VALIDATION_NEGATIVE_TTL_MS = 30_000;

type GroupValidationRow = { isMember: boolean; isAdmin: boolean };

const groupValidationCache = new Map<
  string,
  { row: GroupValidationRow; expiresAt: number }
>();
const groupValidationInFlight = new Map<
  string,
  Promise<GroupValidationRow | null>
>();

/**
 * Core's bulk endpoint answers a single address directly. Walking the whole
 * member list instead (the obvious `/groups/members/{id}?limit=0`) downloads
 * megabytes for large groups and routinely times out, which reads as
 * "membership unavailable" and silently stops this device from advertising
 * the attachments it already holds.
 */
async function fetchGroupValidationRow(
  groupId: number,
  address: string
): Promise<GroupValidationRow | null> {
  if (!config.apiBase) return null;
  const base = config.apiBase.replace(/\/$/, '');
  const key = String(config.apiKey || '').trim();
  const url = key
    ? `${base}/groups/members/${groupId}/validate?apiKey=${encodeURIComponent(key)}`
    : `${base}/groups/members/${groupId}/validate`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (key) headers['X-API-KEY'] = key;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify([address]),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;
    const row = rows.find(
      (item: any) => String(item?.address || '').trim() === address
    );
    return {
      isAdmin: row?.isAdmin === true,
      isMember: row?.isMember === true,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function validateGroupRole(
  groupId: number,
  address: string,
  role: 'member' | 'admin'
): Promise<boolean | null> {
  const normalized = address.trim();
  if (!Number.isInteger(groupId) || groupId <= 0 || !normalized) return false;
  const key = `${groupId}:${normalized}`;
  const read = (row: GroupValidationRow) =>
    role === 'admin' ? row.isAdmin : row.isMember;
  const cached = groupValidationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return read(cached.row);
  let request = groupValidationInFlight.get(key);
  if (!request) {
    request = fetchGroupValidationRow(groupId, normalized)
      .then((row) => {
        if (row) {
          groupValidationCache.set(key, {
            row,
            expiresAt:
              Date.now() +
              (row.isMember
                ? GROUP_VALIDATION_TTL_MS
                : GROUP_VALIDATION_NEGATIVE_TTL_MS),
          });
        }
        return row;
      })
      .finally(() => {
        groupValidationInFlight.delete(key);
      });
    groupValidationInFlight.set(key, request);
  }
  const row = await request;
  return row ? read(row) : null;
}

async function validateGroupMember(
  groupId: number,
  address: string
): Promise<boolean | null> {
  return validateGroupRole(groupId, address, 'member');
}

async function validateGroupAdmin(
  groupId: number,
  address: string
): Promise<boolean | null> {
  return validateGroupRole(groupId, address, 'admin');
}

async function signLocalFields(fields: Record<string, unknown>): Promise<{
  authorAddress: string;
  authorPublicKey: string;
  signature: string;
} | null> {
  try {
    // Signing hops worker -> WebView main thread -> background signer. A busy
    // main thread or a JIT-less WebView (nacl in the interpreter) can push it
    // past 15 s; a timeout here silently drops the control message.
    const result = await requestMain<any>({ t: 'sign', fields }, 45_000);
    if (
      result &&
      typeof result.authorAddress === 'string' &&
      typeof result.authorPublicKey === 'string' &&
      typeof result.signature === 'string'
    ) {
      return result;
    }
    if (result && typeof result.error === 'string' && result.error) {
      console.warn('[MobileChat] control signing rejected', result.error);
    }
  } catch (err) {
    console.warn('[MobileChat] control signing failed', err);
  }
  return null;
}

// ── engine lifecycle ─────────────────────────────────────────────────────────

let bridge: MobileReticulumBridge | null = null;
let resourceStore: ReticulumResourceStore | null = null;

const RETICULUM_CHAT_ONLINE_SINCE_MS = 5 * 60_000;

/**
 * Desktop defaults to a 10 GB attachment cache. A phone cannot carry that: the
 * blobs live in OPFS, and the worker's sync-fs shim must hold an open handle
 * per file, so an unbounded cache turns directly into renderer memory.
 */
const MOBILE_RESOURCE_LIMIT_BYTES = 512 * 1024 * 1024;

function readGroupState<T>(fallback: T, read: () => T): T {
  try {
    return read();
  } catch (err) {
    console.warn('[MobileChat] group state read failed', err);
    return fallback;
  }
}

const OVERLAY_RECOVERY_REPLAY_DEBOUNCE_MS = 1_500;
/** Overlay health can flap; never replay subscriptions faster than this. */
const OVERLAY_RECOVERY_REPLAY_MIN_INTERVAL_MS = 30_000;
const MEMBERSHIP_REANNOUNCE_DEBOUNCE_MS = 1_500;
let overlayRecoveryReplayTimer: ReturnType<typeof setTimeout> | null = null;
let lastOverlayRecoveryReplayAt = 0;
let membershipReannounceTimer: ReturnType<typeof setTimeout> | null = null;

function subscribedGroupCount(): number {
  const m = getReticulumChatManager() as any;
  const subs = m?.getSubscriptions?.();
  return Array.isArray(subs) ? subs.length : 0;
}

/**
 * First-session attach often marks the overlay healthy before Group.tsx has
 * called subscribeGroup. A replay then no-ops on an empty set and never runs
 * again until process death. Debounce until memberships exist, then announce.
 */
function scheduleMembershipReannounce(reason: string): void {
  if (membershipReannounceTimer) clearTimeout(membershipReannounceTimer);
  membershipReannounceTimer = setTimeout(() => {
    membershipReannounceTimer = null;
    const m = getReticulumChatManager() as any;
    if (!m || !overlayHealthy) return;
    const count = subscribedGroupCount();
    if (count === 0) return;
    try {
      m.reannounceSubscriptions();
      console.log(
        `[MobileChat] membership_reannounce reason=${reason} groups=${count}`
      );
    } catch (err) {
      console.warn('[MobileChat] membership reannounce failed', err);
    }
  }, MEMBERSHIP_REANNOUNCE_DEBOUNCE_MS);
}

/**
 * The engine worker can attach after python already admitted our own Hub's
 * overlay link, in which case no `overlay_link_state` transition will arrive
 * for it. Same-account leases from the presence snapshot are the other way we
 * learn about own devices; introduce ourselves to each one once, so the Hub
 * records this device's features and can serve it DM pages.
 */
const OWN_DEVICE_INTRODUCTION_MIN_INTERVAL_MS = 10 * 60_000;
const introducedOwnDevicePeersAt = new Map<string, number>();

function introduceNewOwnDevicePeers(): void {
  const m = getReticulumChatManager() as
    | {
        announceSubscriptionsToPeer?: (peer: string) => void;
        notifyOwnDevicePeerAdmitted?: (peer: string) => void;
        getLocalDmAddresses?: () => string[];
      }
    | undefined;
  if (!m) return;
  const localAddresses = new Set(m.getLocalDmAddresses?.() ?? []);
  if (localAddresses.size === 0) return;
  const localHash = String(
    bridge?.getLocalDestinationHash?.() || ''
  ).toLowerCase();
  const now = Date.now();
  for (const lease of presenceLeases) {
    const address = String(lease?.address || '');
    const hash = String(lease?.destinationHash || '').toLowerCase();
    if (!hash || hash === localHash || !localAddresses.has(address)) continue;
    const lastAt = introducedOwnDevicePeersAt.get(hash) ?? 0;
    if (now - lastAt < OWN_DEVICE_INTRODUCTION_MIN_INTERVAL_MS) continue;
    introducedOwnDevicePeersAt.set(hash, now);
    try {
      m.announceSubscriptionsToPeer?.(hash);
      m.notifyOwnDevicePeerAdmitted?.(hash);
    } catch (err) {
      console.warn('[MobileChat] own device introduction failed', err);
    }
  }
  if (introducedOwnDevicePeersAt.size > 64) {
    for (const [hash, at] of introducedOwnDevicePeersAt) {
      if (now - at > OWN_DEVICE_INTRODUCTION_MIN_INTERVAL_MS) {
        introducedOwnDevicePeersAt.delete(hash);
      }
    }
  }
}

/**
 * Group subscription and digest fanouts hard-fail with `no_route` whenever the
 * overlay has no reachable neighbors, which happens every time the phone sleeps
 * or loses its hub links. Desktop replays subscriptions as soon as topology
 * becomes usable again; without the same trigger here the device can sit
 * unsubscribed indefinitely and simply stops receiving other clients' messages.
 */
function onOverlayHealthRecovered(): void {
  const recovered = getReticulumChatManager() as any;
  if (!recovered) return;
  try {
    recovered.notifyOverlayHealthChanged(true);
  } catch (err) {
    console.warn('[MobileChat] overlay health notify failed', err);
  }
  if (subscribedGroupCount() === 0) {
    scheduleMembershipReannounce('overlay_recovered_waiting_memberships');
    return;
  }
  const now = Date.now();
  if (
    now - lastOverlayRecoveryReplayAt <
    OVERLAY_RECOVERY_REPLAY_MIN_INTERVAL_MS
  ) {
    return;
  }
  if (overlayRecoveryReplayTimer) clearTimeout(overlayRecoveryReplayTimer);
  overlayRecoveryReplayTimer = setTimeout(() => {
    overlayRecoveryReplayTimer = null;
    lastOverlayRecoveryReplayAt = Date.now();
    try {
      (getReticulumChatManager() as any)?.reannounceSubscriptions();
      console.log('[MobileChat] overlay_recovered_subscriptions_replayed');
    } catch (err) {
      console.warn('[MobileChat] subscription replay failed', err);
    }
  }, OVERLAY_RECOVERY_REPLAY_DEBOUNCE_MS);
}

export function startEngine(initial: EngineConfig): void {
  config = initial;
  bridge = new MobileReticulumBridge(
    sendPythonCommand,
    new ReticulumResourceStaging(nativeFs as NativeFsFn)
  );
  // Desktop wires this through PresenceManager's `reticulum-peer-verified`:
  // every newly admitted overlay neighbour gets a targeted hello_v3 plus our
  // group subscriptions, so it learns our protocol features (self_dm_v1 is
  // what lets a same-account Hub serve DM pages to this device). If the
  // neighbour is one of our own devices, also pull the open conversations.
  bridge.on('overlay-peer-admitted', ({ peerHash }: { peerHash: string }) => {
    const m = getReticulumChatManager() as
      | {
          announceSubscriptionsToPeer?: (peer: string) => void;
          notifyOwnDevicePeerAdmitted?: (peer: string) => void;
        }
      | undefined;
    if (!m || !peerHash) return;
    try {
      m.announceSubscriptionsToPeer?.(peerHash);
      m.notifyOwnDevicePeerAdmitted?.(peerHash);
    } catch (err) {
      console.warn('[MobileChat] overlay admitted introduction failed', err);
    }
  });
  resourceStore = new ReticulumResourceStore({
    policy: { limitBytes: MOBILE_RESOURCE_LIMIT_BYTES },
  });
  const manager = startReticulumChatManager(bridge as any, undefined, {
    signLocalFields,
    validateGroupMember,
    validateGroupAdmin,
    getVerifiedReticulumPeers: () => presencePeers as any,
    getAccountEndpointLeases: () => presenceLeases as any,
    hasGoodOverlayHealth: () => overlayHealthy,
    resourceStore,
    // A phone is a leaf: it consumes group digests/notices but does not relay
    // them along interest routes (that was ~6-10 bridge sends a second).
    relayGroupControl: false,
  });
  attachManagerListeners(manager);
  post({ t: 'engine-ready' });
}

const MANAGER_EVENTS = [
  'event',
  'typing',
  'landState',
  'landChat',
  'landAction',
  'landCall',
  'summaryChanged',
  'directEvent',
  'directCallHistory',
  'directTyping',
  'directSummaryChanged',
  'deviceStateChanged',
  'resource',
  'silenceChanged',
  'calendarChanged',
  'calendarReminderDue',
] as const;

function attachManagerListeners(manager: any): void {
  for (const eventName of MANAGER_EVENTS) {
    manager.on(eventName, (payload: unknown) => {
      post({ t: 'evt', channel: `reticulumChat:${eventName}`, payload });
    });
  }
}

// ── invoke dispatcher (port of the 67 setup.ts ipc handlers) ─────────────────

type Handler = (...args: any[]) => unknown | Promise<unknown>;

const manager = () => getReticulumChatManager() as any;

const notRunning = {
  success: false,
  error: 'Reticulum chat manager is not running',
};

/**
 * Device-state calls arrive from the renderer before `setLocalDmAddresses`
 * on a cold start; register the owner the same way `getDirectSummaries` does
 * so the manager accepts it as a local DM address.
 */
function ensureDeviceStateOwner(m: any, ownerAddress: unknown): string {
  const owner = typeof ownerAddress === 'string' ? ownerAddress.trim() : '';
  if (!owner) return owner;
  const registered: string[] = m.getLocalDmAddresses?.() ?? [];
  if (!registered.includes(owner)) m.setLocalDmAddresses([owner]);
  return owner;
}

const handlers: Record<string, Handler> = {
  isEnabled: () => true,
  setLocalGroupMemberships: (groupIds) => {
    const m = manager();
    if (!m) return notRunning;
    m.setLocalGroupMemberships(Array.isArray(groupIds) ? groupIds : []);
    if (overlayHealthy) scheduleMembershipReannounce('memberships_applied');
    return { success: true };
  },
  setPublicGroupDirectory: (groupIds) => {
    const m = manager();
    if (!m) return notRunning;
    m.setPublicGroupDirectory(Array.isArray(groupIds) ? groupIds : []);
    return { success: true };
  },
  getPublicGroupActivity: () =>
    manager()?.getPublicGroupActivitySummaries() ?? [],
  getPublicGroupActivitySnapshot: () =>
    manager()?.getPublicGroupActivitySnapshot() ?? {
      availableGroupIds: [],
      observedAt: Date.now(),
      summaries: [],
    },
  setLocalDmAddresses: (addresses) => {
    const m = manager();
    if (!m) return notRunning;
    m.setLocalDmAddresses(Array.isArray(addresses) ? addresses : []);
    return { success: true };
  },
  clearLocalAccountState: async () => {
    const m = manager();
    if (m) await m.clearLocalAccountState();
    return { success: true };
  },
  getSilence: (ownerAddress, targetAddress, scopeType, groupId) =>
    manager()?.getSilence(ownerAddress, targetAddress, scopeType, groupId) ??
    null,
  listSilences: (ownerAddress, scopeType, groupId) =>
    manager()?.listSilences(ownerAddress, scopeType, groupId) ?? [],
  setSilence: (ownerAddress, targetAddress, scopeType, durationMs, groupId) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const silence = m.setSilence(
        ownerAddress,
        targetAddress,
        scopeType,
        durationMs,
        groupId
      );
      return { success: true, silence };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  clearSilence: (ownerAddress, targetAddress, scopeType, groupId) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const silence = m.clearSilence(
        ownerAddress,
        targetAddress,
        scopeType,
        groupId
      );
      return { success: true, silence };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  setActiveDirectChat: (localAddress, peerAddress, active) => {
    const m = manager();
    if (!m) return notRunning;
    m.setActiveDirectChat(localAddress, peerAddress, active === true);
    return { success: true };
  },
  publishDirectEvent: async (event) => {
    const m = manager();
    if (!m) return notRunning;
    const result = await m.publishDirectEvent(event);
    if (result.ok) return { success: true };
    return { success: false, error: result.error ?? result.reason };
  },
  getDirectAuthorStreamId: (authorAddress) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.getDirectAuthorStreamId(authorAddress);
  },
  getDirectExpiryPreference: (ownerAddress, peerAddress) => {
    const m = manager();
    if (!m) return notRunning;
    return {
      success: true,
      preference: m.getDirectExpiryPreference(
        String(ownerAddress || '').trim(),
        String(peerAddress || '').trim()
      ),
    };
  },
  setDirectExpiryPreference: (ownerAddress, peerAddress, durationMs) => {
    const m = manager();
    if (!m) return notRunning;
    const preference = m.setDirectExpiryPreference(
      String(ownerAddress || '').trim(),
      String(peerAddress || '').trim(),
      durationMs == null ? null : Number(durationMs)
    );
    return preference
      ? { success: true, preference }
      : { success: false, error: 'Invalid DM expiry preference' };
  },
  getCalendarEvents: (groupId, rangeStart, rangeEnd) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.getCalendarEvents(
      Number(groupId),
      Number(rangeStart),
      Number(rangeEnd)
    );
  },
  getCalendarEvent: (groupId, eventId, preferredOccurrenceStart) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.getCalendarEvent(
      Number(groupId),
      String(eventId || ''),
      preferredOccurrenceStart == null
        ? undefined
        : Number(preferredOccurrenceStart)
    );
  },
  createCalendarEvent: (groupId, input, eventId) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.createCalendarEvent(Number(groupId), input, eventId);
  },
  updateCalendarEvent: (groupId, eventId, input) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.updateCalendarEvent(Number(groupId), String(eventId), input);
  },
  deleteCalendarEvent: (groupId, eventId) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.deleteCalendarEvent(Number(groupId), String(eventId));
  },
  getCalendarReminder: (ownerAddress, groupId, eventId) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.getCalendarReminder(
      String(ownerAddress || '').trim(),
      Number(groupId),
      String(eventId || '')
    );
  },
  setCalendarReminder: (ownerAddress, groupId, eventId, offsetMs) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.setCalendarReminder(
      String(ownerAddress || '').trim(),
      Number(groupId),
      String(eventId || ''),
      offsetMs == null ? null : Number(offsetMs)
    );
  },
  sendDirectTyping: async (localAddress, peerAddress, active) => {
    const m = manager();
    if (!m) return notRunning;
    const result = await m.sendDirectTyping(
      localAddress,
      peerAddress,
      active === true
    );
    if (result.ok) return { success: true };
    return { success: false, error: result.error ?? result.reason };
  },
  getDirectHistory: (myAddress, peerAddress, limit) =>
    manager()?.getDirectHistory(myAddress, peerAddress, limit) ?? [],
  getDirectSummaries: (myAddress, peerAddress) => {
    const m = manager();
    if (!m) return [];
    const address = typeof myAddress === 'string' ? myAddress.trim() : '';
    if (address) m.setLocalDmAddresses([address]);
    return m.getDirectSummaries(
      address,
      typeof peerAddress === 'string' ? peerAddress.trim() : undefined
    );
  },
  getDirectCallHistory: (ownerAddress, peerAddress, limit, unreadOnly) =>
    manager()?.getDirectCallHistory(
      String(ownerAddress || '').trim(),
      typeof peerAddress === 'string' ? peerAddress.trim() : undefined,
      Number(limit) || 100,
      unreadOnly === true
    ) ?? [],
  markDirectRead: (myAddress, peerAddress, upToTimestamp) => {
    const m = manager();
    if (!m) return notRunning;
    m.markDirectRead(myAddress, peerAddress, Number(upToTimestamp));
    return { success: true };
  },
  setDeviceState: (ownerAddress, key, value, options) => {
    const m = manager();
    if (!m) return notRunning;
    const owner = ensureDeviceStateOwner(m, ownerAddress);
    try {
      return m.setDeviceState(
        owner,
        String(key ?? ''),
        value === null || value === undefined ? null : String(value),
        options && typeof options === 'object' ? options : undefined
      );
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
  getDeviceStates: (ownerAddress, keyPrefix) => {
    const m = manager();
    if (!m) return [];
    const owner = ensureDeviceStateOwner(m, ownerAddress);
    if (!owner) return [];
    return m.getDeviceStates(
      owner,
      typeof keyPrefix === 'string' ? keyPrefix : undefined
    );
  },
  getDeviceStateSyncPeers: (ownerAddress) => {
    const m = manager();
    if (!m) return [];
    const owner = typeof ownerAddress === 'string' ? ownerAddress.trim() : '';
    if (!owner) return [];
    return m.getDeviceStateSyncPeers(owner);
  },
  subscribeGroup: (groupId) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      m.subscribeGroup(groupId);
      if (overlayHealthy) scheduleMembershipReannounce('subscribe_group');
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum chat subscribe failed',
      };
    }
  },
  subscribeChannel: (groupId, channelId) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      m.subscribeChannel(groupId, channelId);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum channel subscribe failed',
      };
    }
  },
  unsubscribeChannel: (groupId, channelId) => {
    const m = manager();
    if (!m) return notRunning;
    m.unsubscribeChannel(groupId, channelId);
    return { success: true };
  },
  unsubscribeGroup: (groupId) => {
    const m = manager();
    if (!m) return notRunning;
    m.unsubscribeGroup(groupId);
    return { success: true };
  },
  publishEvent: async (event) => {
    const m = manager();
    if (!m) return notRunning;
    const result = await m.publishEvent(event);
    if (result.ok) {
      return { success: true, duplicate: result.duplicate === true };
    }
    return {
      success: false,
      error: result.error ?? result.reason,
      stored: result.stored === true,
    };
  },
  reserveAuthorSequence: async (groupId, authorAddress) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.reserveAuthorSequence(groupId, authorAddress);
  },
  releaseAuthorSequence: (
    groupId,
    authorAddress,
    authorStreamId,
    authorSeq
  ) => {
    const m = manager();
    if (!m) return false;
    return m.releaseAuthorSequence(
      groupId,
      authorAddress,
      authorStreamId,
      authorSeq
    );
  },
  sendTyping: (
    groupId,
    channelIdOrAuthorAddress,
    authorAddressOrActive,
    activeMaybe
  ) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const channelId =
        typeof activeMaybe === 'boolean' ? channelIdOrAuthorAddress : 'general';
      const authorAddress =
        typeof activeMaybe === 'boolean'
          ? String(authorAddressOrActive || '')
          : channelIdOrAuthorAddress;
      const active =
        typeof activeMaybe === 'boolean'
          ? activeMaybe
          : authorAddressOrActive === true;
      m.sendTyping(groupId, channelId, authorAddress, active);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum chat typing send failed',
      };
    }
  },
  sendLandState: async (groupId, authorAddress, state) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      await m.sendLandState(groupId, authorAddress, state);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error ? err.message : 'QortalLand state send failed',
      };
    }
  },
  sendLandChat: async (message) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const result = await m.sendLandChat(message);
      if (!result.ok) {
        return { success: false, error: result.error ?? result.reason };
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error ? err.message : 'QortalLand chat send failed',
      };
    }
  },
  sendLandAction: async (groupId, action) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const result = await m.sendLandAction(groupId, action);
      if (!result.ok) {
        return { success: false, error: result.error ?? result.reason };
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error ? err.message : 'QortalLand action send failed',
      };
    }
  },
  sendLandCall: async (groupId, call) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const result = await m.sendLandCall(groupId, call);
      if (!result.ok) {
        return { success: false, error: result.error ?? result.reason };
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error ? err.message : 'QortalLand call send failed',
      };
    }
  },
  requestResource: async (groupId, manifest, eventId) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const result = await m.requestResource(
        groupId,
        manifest,
        typeof eventId === 'string' && eventId ? eventId : undefined
      );
      if (result.ok) return { success: true };
      return { success: false, error: result.error ?? result.reason };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum resource request failed',
      };
    }
  },
  requestDirectResource: async (myAddress, peerAddress, manifest, eventId) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const result = await m.requestDirectResource(
        myAddress,
        peerAddress,
        manifest,
        typeof eventId === 'string' && eventId ? eventId : undefined
      );
      if (result.ok) return { success: true };
      return { success: false, error: result.error ?? result.reason };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum direct resource request failed',
      };
    }
  },
  cancelResource: async (fileHash) => {
    const hash = typeof fileHash === 'string' ? fileHash.trim() : '';
    if (!hash) return { success: false, error: 'Invalid file hash' };
    const m = manager();
    if (!m) return notRunning;
    try {
      return { success: true, canceled: await m.cancelResource(hash) };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum resource cancel failed',
      };
    }
  },
  getHistory: (groupId, channelIdOrLimit, limitMaybe, optionsMaybe) => {
    const m = manager();
    const channelId =
      typeof channelIdOrLimit === 'string' && channelIdOrLimit
        ? channelIdOrLimit
        : 'general';
    const limit =
      typeof channelIdOrLimit === 'number' ? channelIdOrLimit : limitMaybe;
    return m
      ? readGroupState([], () =>
          m.getHistory(groupId, channelId, limit, optionsMaybe)
        )
      : [];
  },
  getMessageHistory: (groupId, channelIdOrLimit, limitMaybe, optionsMaybe) => {
    const m = manager();
    const channelId =
      typeof channelIdOrLimit === 'string' && channelIdOrLimit
        ? channelIdOrLimit
        : 'general';
    const limit =
      typeof channelIdOrLimit === 'number' ? channelIdOrLimit : limitMaybe;
    return m
      ? readGroupState([], () =>
          m.getMessageHistory(groupId, channelId, limit, optionsMaybe)
        )
      : [];
  },
  getMessageHistoryPage: (groupId, channelId, limit, options) => {
    const m = manager();
    const fallback = {
      events: [],
      oldestCursor: null,
      newestCursor: null,
      hasMore: false,
    };
    return m
      ? readGroupState(fallback, () =>
          m.getMessageHistoryPage(
            groupId,
            channelId || 'general',
            limit,
            options
          )
        )
      : fallback;
  },
  getDiscussionIndex: (groupId, channelId) => {
    const m = manager();
    const fallback = { replyCounts: {}, rootByEventId: {} };
    return m
      ? readGroupState(fallback, () =>
          m.getDiscussionIndex(groupId, channelId || 'general')
        )
      : fallback;
  },
  getDiscussionMessages: (groupId, channelId, eventId) => {
    const m = manager();
    return m
      ? readGroupState([], () =>
          m.getDiscussionMessages(groupId, channelId, eventId)
        )
      : [];
  },
  getChannelMetadataHistory: (groupId, limit) => {
    const m = manager();
    return m
      ? readGroupState([], () => m.getChannelMetadataHistory(groupId, limit))
      : [];
  },
  getChannels: (groupId, includeArchived) => {
    const m = manager();
    return m
      ? readGroupState([], () =>
          m.getChannels(groupId, includeArchived === true)
        )
      : [];
  },
  getCategories: (groupId) => {
    const m = manager();
    return m ? readGroupState([], () => m.getCategories(groupId)) : [];
  },
  getChannelMetadataBundle: (groupId, includeArchived) => {
    const m = manager();
    const fallback = {
      channels: [],
      categories: [],
      ready: false,
      snapshotVersion: 0,
    };
    return m
      ? readGroupState(fallback, () =>
          m.getChannelMetadataBundle(groupId, includeArchived === true)
        )
      : fallback;
  },
  applyChannelMetadata: async (eventId, payload) => {
    if (typeof eventId !== 'string' || !eventId) return { success: false };
    const m = manager();
    if (!m) return { success: false };
    const applied = await m.applyChannelMetadataEvent(eventId, payload);
    return { success: applied };
  },
  getSyncState: (groupId) => {
    const m = manager();
    return m ? readGroupState({}, () => m.getSyncState(groupId)) : {};
  },
  getSummaries: (myAddress) => {
    const m = manager();
    const address = typeof myAddress === 'string' ? myAddress : '';
    return m ? m.getChatSummaries(address, RETICULUM_CHAT_ONLINE_SINCE_MS) : [];
  },
  search: (query, options) => {
    const safeQuery = typeof query === 'string' ? query : '';
    const safeOptions = options && typeof options === 'object' ? options : {};
    return manager()?.searchEvents(safeQuery, safeOptions) ?? [];
  },
  getMessageWindowAroundEvent: (groupId, channelId, eventId, options) => {
    const m = manager();
    const safeOptions = options && typeof options === 'object' ? options : {};
    return m
      ? readGroupState([], () =>
          m.getMessageWindowAroundEvent(
            groupId,
            channelId,
            eventId,
            safeOptions
          )
        )
      : [];
  },
  getMessageWindowPageAroundEvent: (groupId, channelId, eventId, options) => {
    const m = manager();
    const safeOptions = options && typeof options === 'object' ? options : {};
    const fallback = {
      events: [],
      oldestCursor: null,
      newestCursor: null,
      hasOlder: false,
      hasNewer: false,
    };
    return m
      ? readGroupState(fallback, () =>
          m.getMessageWindowPageAroundEvent(
            groupId,
            channelId,
            eventId,
            safeOptions
          )
        )
      : fallback;
  },
  indexSearchText: (eventId, text) => {
    if (typeof eventId !== 'string' || typeof text !== 'string') {
      return { success: false };
    }
    const m = manager();
    return { success: m ? m.indexSearchText(eventId, text) : false };
  },
  deleteSearchText: (eventId) => {
    if (typeof eventId !== 'string') return { success: false };
    const m = manager();
    return { success: m ? m.deleteSearchText(eventId) : false };
  },
  replaceMentions: (eventId, mentionedAddresses) => {
    if (typeof eventId !== 'string' || !Array.isArray(mentionedAddresses)) {
      return { success: false };
    }
    const m = manager();
    return {
      success: m
        ? m.replaceMentionsForEvent(eventId, mentionedAddresses)
        : false,
    };
  },
  deleteMentions: (eventId) => {
    if (typeof eventId !== 'string') return { success: false };
    const m = manager();
    return { success: m ? m.deleteMentionsForEvent(eventId) : false };
  },
  markRead: (groupId, channelIdOrTimestamp, upToTimestamp, myAddress) => {
    const channelId =
      typeof channelIdOrTimestamp === 'string'
        ? channelIdOrTimestamp
        : 'general';
    const timestamp =
      typeof channelIdOrTimestamp === 'number'
        ? channelIdOrTimestamp
        : Number(upToTimestamp);
    const address =
      typeof channelIdOrTimestamp === 'number'
        ? typeof upToTimestamp === 'string'
          ? upToTimestamp
          : myAddress
        : myAddress;
    const normalizedAddress = typeof address === 'string' ? address : '';
    manager()?.markRead(groupId, channelId, timestamp, normalizedAddress);
    return { success: true };
  },
  markGroupsRead: (groupIds, myAddress) => {
    const m = manager();
    if (!m) {
      return {
        success: false,
        error: 'Reticulum chat is unavailable',
        groupsMarked: 0,
        channelsMarked: 0,
      };
    }
    const normalizedGroupIds = Array.isArray(groupIds)
      ? groupIds
          .map((groupId: unknown) => Number(groupId))
          .filter((groupId: number) => Number.isInteger(groupId) && groupId > 0)
      : [];
    const address = typeof myAddress === 'string' ? myAddress.trim() : '';
    const result = m.markGroupsRead(normalizedGroupIds, address);
    return { success: true, ...result };
  },
  getSubscriptions: () => manager()?.getSubscriptions() ?? [],
  updateMentionBadge: () => ({ success: true }),
};

// ── reticulumResource:* handlers ─────────────────────────────────────────────
// Desktop serves these from setup.ts over a custom protocol. Mobile has no
// custom protocol, so `resource:bytes` hands the raw bytes to the main thread
// and the twin turns them into a blob: URL.

// Must match the desktop allowlist in electron/src/setup.ts exactly; DMs send
// `reticulum-dm-resource`.
const RESOURCE_NAMESPACES = new Set([
  'reticulum-group-resource',
  'reticulum-dm-resource',
]);

function decodeBase64(base64: string): Uint8Array {
  const clean = base64.includes(',')
    ? base64.slice(base64.indexOf(',') + 1)
    : base64;
  const bin = atob(clean.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const resourceHandlers: Record<string, Handler> = {
  // Lab/diagnostics: the self-DM (Saved Messages) view of the engine for the
  // signed-in addresses. Read-only; used from the page as
  // window.reticulumChat.debugSelfDm().
  'debug:logs': (filter?: string) => getRecentLogs(filter),
  'debug:selfDm': () => {
    const m = getReticulumChatManager() as any;
    if (!m) return { ready: false };
    const owners: string[] = [...(m.localDmAddresses ?? [])];
    const local = String(m.localPeerHash?.() ?? '');
    const leases = (m.getAccountEndpointLeasesForRouting?.() ?? [])
      .filter((l: any) => owners.includes(String(l.address)))
      .map((l: any) => ({
        address: String(l.address).slice(0, 8),
        hash: String(l.destinationHash),
        verification: l.verification,
        lastSeen: l.lastSeen,
        expiresAt: l.expiresAt,
        features: [
          ...(m.peerProtocolFeatures?.get?.(String(l.destinationHash)) ?? []),
        ],
        supportsSelfDm:
          m.peerSupportsSelfDm?.(String(l.destinationHash)) ?? null,
        verifiedSelfDmPeer: owners.length
          ? (m.isVerifiedSelfDmPeer?.(owners[0], String(l.destinationHash)) ??
            null)
          : null,
      }));
    return {
      ready: true,
      localPeerHash: local,
      owners: owners.map((o) => o.slice(0, 8)),
      leases,
      selfDmPeerHashes: owners.length
        ? (m.selfDmPeerHashes?.(owners[0]) ?? [])
        : [],
      warmLinkPeers: m.selfDmWarmLinkPeers?.() ?? [],
      pinnedAppliedKey: m.selfDmWarmLinkAppliedKey ?? null,
      knownFeaturePeers: m.peerProtocolFeatures?.size ?? null,
      directDmPulls: [...(m.directDmPulls?.keys?.() ?? [])],
      presenceLeases: presenceLeases.length,
    };
  },
  'resource:importBase64': async (payload: any) => {
    const store = resourceStore;
    if (!store) return { success: false, error: 'Resource store not running' };
    const namespace = String(payload?.namespace ?? '');
    if (!RESOURCE_NAMESPACES.has(namespace)) {
      return { success: false, error: 'Invalid chat resource namespace' };
    }
    const fileName = String(payload?.fileName || 'resource.bin').trim();
    const mimeType =
      String(payload?.mimeType || '').trim() || 'application/octet-stream';
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(String(payload?.base64 ?? ''));
    } catch {
      return { success: false, error: 'Invalid base64 resource data' };
    }
    if (bytes.byteLength === 0) {
      return { success: false, error: 'Invalid base64 resource data' };
    }
    // importLocalFileAsync wants a path, so stage the bytes in the shim fs.
    const tempDir = '/tmp/reticulum-resource-imports';
    const tempPath = `${tempDir}/${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(tempPath, bytes);
      const manifest = await store.importLocalFileAsync({
        sourcePath: tempPath,
        namespace,
        ownerId: String(payload?.ownerId || '').trim() || undefined,
        fileName,
        mimeType,
        encrypted: payload?.encrypted === true,
        metadata:
          payload?.metadata && typeof payload.metadata === 'object'
            ? payload.metadata
            : undefined,
      });
      return { success: true, manifest };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Resource import failed',
      };
    } finally {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* already gone */
      }
    }
  },
  'resource:bytes': async (fileHash: string) => {
    const store = resourceStore;
    if (!store) return { success: false, error: 'Resource store not running' };
    const hash = String(fileHash ?? '').trim();
    if (!hash) return { success: false, error: 'Invalid file hash' };
    try {
      const manifest = store.getManifest(hash);
      if (!manifest) return { success: false, error: 'Unknown resource' };
      // Do not assemble here: finalize hashes the whole file on this worker
      // and will miss the 45s RPC window (and starve chat) right after login.
      // Callers already poll getStatus / requestResource until a verified
      // assembled path exists.
      const assembled = store.getVerifiedAssembledPath(hash);
      if (!assembled)
        return { success: false, error: 'Resource not assembled' };
      const buf = fs.readFileSync(assembled);
      const bytes = new Uint8Array(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      );
      return { success: true, bytes, manifest };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Resource read failed',
      };
    }
  },
  'resource:getStatus': (fileHash: string) => {
    const store = resourceStore;
    if (!store) return { success: false, error: 'Resource store not running' };
    const hash = String(fileHash ?? '').trim();
    if (!hash) return { success: false, error: 'Invalid file hash' };
    try {
      const manifest = store.getManifest(hash);
      if (!manifest) return { success: false, error: 'Unknown resource' };
      const complete = Boolean(store.getVerifiedAssembledPath(hash));
      const completedBytes = complete
        ? manifest.sizeBytes
        : store.getCompletedBytes(hash);
      const totalBytes = Math.max(0, Number(manifest.sizeBytes || 0));
      const runtime = manager()?.getResourceDownloadStatus?.(hash) ?? null;
      const runtimeProgress =
        runtime && typeof runtime.progress === 'number'
          ? Math.max(0, Math.min(1, runtime.progress))
          : null;
      const runtimeBytes =
        runtime && typeof runtime.bytesTransferred === 'number'
          ? Math.max(0, Math.min(totalBytes, runtime.bytesTransferred))
          : null;
      return {
        success: true,
        manifest,
        bytesTransferred: runtimeBytes ?? completedBytes,
        totalBytes,
        progress: Math.max(
          totalBytes > 0 ? Math.min(1, completedBytes / totalBytes) : 0,
          runtimeProgress ?? 0
        ),
        complete,
        latestRangeUpdatedAt: store.getLatestRangeUpdatedAt(hash) || null,
        checkedAt: Date.now(),
        runtime,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Resource status failed',
      };
    }
  },
  'resource:getStorageStatus': () => {
    const store = resourceStore;
    if (!store) return { success: false, error: 'Resource store not running' };
    try {
      return { success: true, status: store.getStorageStatus() };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Storage status failed',
      };
    }
  },
  'resource:cleanupStorage': async () => {
    const store = resourceStore;
    if (!store) return { success: false, error: 'Resource store not running' };
    try {
      const result = await store.cleanupStorage('manual');
      return { success: true, result, status: store.getStorageStatus() };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Storage cleanup failed',
      };
    }
  },
};

Object.assign(handlers, resourceHandlers);

// ── worker message pump ──────────────────────────────────────────────────────

export function handleMainMessage(data: any): void {
  if (!data || typeof data !== 'object') return;
  if (data.t === 'rpc') {
    const { id, method, args } = data;
    void (async () => {
      try {
        const handler = handlers[method];
        if (!handler)
          throw new Error(`Unknown reticulumChat method: ${method}`);
        const value = await handler(...(Array.isArray(args) ? args : []));
        post({ t: 'rpcres', id, ok: true, value });
      } catch (err) {
        post({
          t: 'rpcres',
          id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return;
  }
  if (data.t === 'cmdres' || data.t === 'signres') {
    const pending = pendingOut.get(data.id);
    if (pending) {
      pendingOut.delete(data.id);
      if (data.t === 'cmdres') pending.resolve(data.frame);
      else if (data.t === 'signres' && data.error && !data.result) {
        pending.reject(new Error(String(data.error)));
      } else {
        pending.resolve(data.result);
      }
    }
    return;
  }
  if (data.t === 'nativefsres') {
    const pending = pendingOut.get(data.id);
    if (pending) {
      pendingOut.delete(data.id);
      if (data.error) pending.reject(new Error(String(data.error)));
      else pending.resolve(data.result ?? {});
    }
    return;
  }
  if (data.t === 'pyevent') {
    handlePythonEvent(String(data.event || ''), data.payload);
    return;
  }
  if (data.t === 'bridge-socket') {
    if (typeof data.url === 'string' && typeof data.token === 'string') {
      setBridgeSocketInfo({ url: data.url, token: data.token });
    }
    return;
  }
  if (data.t === 'presence-state') {
    presencePeers = Array.isArray(data.peers) ? data.peers : [];
    presenceLeases = Array.isArray(data.leases) ? data.leases : [];
    const wasHealthy = overlayHealthy;
    overlayHealthy = data.healthy === true;
    if (overlayHealthy && !wasHealthy) {
      setTimeout(() => onOverlayHealthRecovered(), 0);
    }
    if (overlayHealthy) introduceNewOwnDevicePeers();
    // Leases are what make an own device pinnable and pullable; the engine
    // throttles the resulting reconcile/catch-up itself.
    try {
      (
        getReticulumChatManager() as
          | { notifyOwnDeviceLeasesChanged?: () => void }
          | undefined
      )?.notifyOwnDeviceLeasesChanged?.();
    } catch (err) {
      console.warn('[MobileChat] own device lease refresh failed', err);
    }
    return;
  }
  if (data.t === 'config') {
    config = { ...config, ...data.config };
    return;
  }
  if (data.t === 'local-identity') {
    bridge?.setLocalIdentity(
      data.destinationHash,
      data.identityPublicKeyBase64
    );
    const appliedHash = bridge?.getLocalDestinationHash() ?? '';
    console.log(
      `[MobileChat] local_identity_applied hash=${appliedHash || 'none'} identityKey=${Boolean(data.identityPublicKeyBase64)}`
    );
    if (appliedHash) {
      post({
        t: 'identity-ack',
        destinationHash: appliedHash,
        identityPublicKeyBase64:
          typeof data.identityPublicKeyBase64 === 'string'
            ? data.identityPublicKeyBase64
            : null,
      });
    }
    return;
  }
  if (data.t === 'stop') {
    closeBridgeSocket();
    try {
      stopReticulumChatManager();
      resourceStore?.close?.();
    } catch (err) {
      console.warn('[MobileChat] stop failed', err);
    }
    bridge?.markStopped();
    return;
  }
}

/** A Python bridge event, whether relayed by the main thread or received directly. */
function handlePythonEvent(event: string, payload: unknown): void {
  countBridge(bridgeEventCounts, bridgeTrafficKey(event, payload));
  if (event === 'ready') {
    bridge?.markReady((payload ?? {}) as Record<string, unknown>);
    const readyHash = bridge?.getLocalDestinationHash() ?? '';
    if (readyHash) {
      const ready = (payload ?? {}) as Record<string, unknown>;
      post({
        t: 'identity-ack',
        destinationHash: readyHash,
        identityPublicKeyBase64:
          typeof ready.identityPublicKeyBase64 === 'string'
            ? ready.identityPublicKeyBase64
            : null,
      });
    }
    return;
  }
  if (
    event === 'bridge_stall_diagnostic' ||
    event === 'bridge_executor_recovered' ||
    event === 'bridge_thread_population'
  ) {
    // Python's stall watchdog. Logcat is muted on some vendor builds, so the
    // stacks are surfaced here where remote devtools can see them.
    const detail = (payload ?? {}) as Record<string, unknown>;
    const stacks = detail.stacks;
    const { stacks: _omit, ...summary } = detail;
    console.warn(`[MobileChat] ${event}`, JSON.stringify(summary));
    if (stacks && typeof stacks === 'object') {
      for (const [thread, stack] of Object.entries(
        stacks as Record<string, string>
      )) {
        console.warn(`[MobileChat] ${event} thread=${thread}\n${stack}`);
      }
    }
    return;
  }
  bridge?.dispatchPythonEvent(event, payload);
}
