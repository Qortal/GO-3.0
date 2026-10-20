/**
 * Pure helpers for GO's 1:1 and DM-voice call port in capacitorBridge.ts
 * (window.call / window.groupCall on Android). Each one mirrors a rule of an
 * unmodified Hub 3.0.3 (electron/src/call.ts, electron/src/group-call.ts) so
 * GO stays wire-compatible with desktop Hubs; the Hub file and lines are
 * named next to each helper. Nothing here touches the bridge or the DOM.
 */

import {
  GROUP_CALL_RETICULUM_WIRE_TYPES,
  encodeJoinIdentityWire,
  encodeJoinWire,
  isIgnoredGroupCallWireType,
  isRnsIdentityPublicKeyBase64,
} from './groupCallWire';

// ── Route-bound call ids ─────────────────────────────────────────────────────

const ROUTE_BOUND_ID_LENGTH = 36;
const ROUTE_HASH_BASE64URL_LENGTH = 22;
const ROUTE_BOUND_RANDOM_LENGTH = 13;

/**
 * The Reticulum destination committed inside a route-bound call id
 * (`C` + base64url(16-byte destination) + 13 random chars). Port of
 * getRouteBoundDestinationHash('call', id), electron/src/reticulum-route-bound-id.ts.
 * Returns 32 lowercase hex chars, or null for an ordinary id.
 */
export function getRouteBoundCallDestinationHash(id: unknown): string | null {
  if (
    typeof id !== 'string' ||
    id.length !== ROUTE_BOUND_ID_LENGTH ||
    id[0] !== 'C'
  ) {
    return null;
  }
  const encodedRoute = id.slice(1, 1 + ROUTE_HASH_BASE64URL_LENGTH);
  const entropy = id.slice(1 + ROUTE_HASH_BASE64URL_LENGTH);
  if (
    !/^[A-Za-z0-9_-]{22}$/.test(encodedRoute) ||
    !new RegExp(`^[A-Za-z0-9_-]{${ROUTE_BOUND_RANDOM_LENGTH}}$`).test(entropy)
  ) {
    return null;
  }
  try {
    const binary = atob(
      encodedRoute.replace(/-/g, '+').replace(/_/g, '/') + '=='
    );
    if (binary.length !== 16) return null;
    let hex = '';
    for (let i = 0; i < binary.length; i++) {
      hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex;
  } catch {
    return null;
  }
}

// ── 1:1 call signaling ───────────────────────────────────────────────────────

/** Hub pending-call lifetime (call.ts CALL_REQUEST_TTL_MS). */
export const CALL_PENDING_TTL_MS = 60_000;
/** Bound on CALL_REQUESTs held while no local address is registered. */
export const CALL_PENDING_INCOMING_MAX = 16;

/**
 * The CALL_REJECT envelopes to send, in order: the reason-signed one first,
 * then the legacy one (no reason) that older callers verify. Mirrors
 * CallManager.rejectCall (call.ts:1603-1620).
 */
export function buildCallRejectSignatures(input: {
  reason?: string;
  signature?: string;
  reasonSignature?: string;
}): Array<{ reason?: string; signature: string }> {
  const out: Array<{ reason?: string; signature: string }> = [];
  if (
    typeof input.reason === 'string' &&
    input.reason.length > 0 &&
    typeof input.reasonSignature === 'string' &&
    input.reasonSignature.length > 0
  ) {
    out.push({ reason: input.reason, signature: input.reasonSignature });
  }
  out.push({ signature: input.signature ?? '' });
  return out;
}

/**
 * Drop expired and duplicate CALL_REQUESTs and keep the newest `max`, so a
 * flood seen while logged out cannot grow the backlog without bound.
 */
export function prunePendingIncoming<
  T extends { env: { callId: string }; receivedAt: number },
>(
  list: readonly T[],
  nowMs: number,
  ttlMs = CALL_PENDING_TTL_MS,
  max = CALL_PENDING_INCOMING_MAX
): T[] {
  const byCallId = new Map<string, T>();
  for (const item of list) {
    if (nowMs - item.receivedAt > ttlMs) continue;
    byCallId.delete(item.env.callId);
    byCallId.set(item.env.callId, item);
  }
  const kept = [...byCallId.values()];
  return kept.length > max ? kept.slice(kept.length - max) : kept;
}

// ── Group-call join (IPC contract + wire) ────────────────────────────────────

/**
 * Positional `gcall:join` arguments, exactly electron/src/group-call-ipc-contract.ts.
 * Renderers (useVoiceCall via joinDirectVoiceReticulumRoom, the group runtime)
 * call window.groupCall.join with this order on every platform.
 */
export type GroupCallJoinArgs = {
  roomId: string;
  chatId: string;
  localAddress: string;
  signature: string;
  publicKey: string;
  timestamp: number;
  reticulumDestinationHash: string;
  joinGeneration?: number;
  topologyEpochFloor?: number;
  reticulumIdentityPublicKeyBase64?: string;
  joinRkSignature?: string;
  dmVoiceAudioLinkRole?: 'opener' | 'waiter';
  takeover?: boolean;
  dmVoicePeerDestinationHash?: string;
  dmVoiceCallId?: string;
};

const optionalNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const optionalString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

export function parseGroupCallJoinArgs(
  args: readonly unknown[]
): GroupCallJoinArgs {
  const role = args[11];
  const peer = optionalString(args[13])?.trim().toLowerCase();
  return {
    roomId: String(args[0] ?? ''),
    chatId: String(args[1] ?? ''),
    localAddress: String(args[2] ?? ''),
    signature: String(args[3] ?? ''),
    publicKey: String(args[4] ?? ''),
    timestamp: Number(args[5]),
    reticulumDestinationHash: String(args[6] ?? '')
      .trim()
      .toLowerCase(),
    joinGeneration: optionalNumber(args[7]),
    topologyEpochFloor: optionalNumber(args[8]),
    reticulumIdentityPublicKeyBase64: optionalString(args[9]),
    joinRkSignature: optionalString(args[10]),
    dmVoiceAudioLinkRole:
      role === 'opener' || role === 'waiter' ? role : undefined,
    takeover: args[12] === true,
    dmVoicePeerDestinationHash:
      peer && /^[0-9a-f]{32}$/.test(peer) ? peer : undefined,
    dmVoiceCallId: optionalString(args[14]),
  };
}

/** Port of decodeGroupCallLogicalJoinGeneration (group-call.ts:536-543). */
export function decodeLogicalJoinGeneration(
  generation: number | undefined
): number | undefined {
  if (typeof generation !== 'number' || !Number.isFinite(generation)) {
    return undefined;
  }
  return generation < 0 ? (-1 - generation) >>> 0 : generation >>> 0;
}

/**
 * The joinGeneration that goes on the wire as `j` (and that the renderer
 * signed). Port of resolveGroupCallSignedJoinGeneration (group-call.ts:545-562).
 */
export function resolveSignedJoinGeneration(
  generation: number | undefined,
  takeover: boolean
): number | undefined {
  if (
    typeof generation === 'number' &&
    Number.isFinite(generation) &&
    generation < 0
  ) {
    return generation;
  }
  const logical = decodeLogicalJoinGeneration(generation);
  if (logical === undefined) return undefined;
  return takeover ? -1 - logical : logical;
}

/**
 * GJ without `rk` plus, when an identity key and its GC_JOIN_RK signature
 * are present, the separate GI frame: what GroupCallManager.joinRoom floods
 * (group-call.ts:5487-5530). The GJ is also the link-auth frame
 * (getLocalReticulumLinkAuthJoinWire, group-call.ts:7877-7892).
 */
export function buildGroupCallJoinWires(input: {
  roomId: string;
  wireChatId: string;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  reticulumDestinationHash: string;
  signedJoinGeneration?: number;
  reticulumIdentityPublicKeyBase64?: string;
  joinRkSignature?: string;
}): {
  joinWire: Record<string, unknown>;
  identityWire: Record<string, unknown> | null;
} {
  const generation =
    input.signedJoinGeneration !== undefined
      ? { joinGeneration: input.signedJoinGeneration }
      : {};
  const joinWire = encodeJoinWire({
    roomId: input.roomId,
    chatId: input.wireChatId,
    fromAddress: input.fromAddress,
    fromPublicKey: input.fromPublicKey,
    signature: input.signature,
    timestamp: input.timestamp,
    reticulumDestinationHash: input.reticulumDestinationHash,
    reticulumIdentityPublicKeyBase64: undefined,
    ...generation,
  });
  const rk = input.reticulumIdentityPublicKeyBase64;
  const identityWire =
    typeof rk === 'string' &&
    isRnsIdentityPublicKeyBase64(rk) &&
    typeof input.joinRkSignature === 'string' &&
    input.joinRkSignature.length > 0
      ? encodeJoinIdentityWire({
          fromAddress: input.fromAddress,
          signature: input.joinRkSignature,
          timestamp: input.timestamp,
          reticulumDestinationHash: input.reticulumDestinationHash,
          reticulumIdentityPublicKeyBase64: rk,
          ...generation,
        })
      : null;
  return { joinWire, identityWire };
}

// ── Audio link roles ─────────────────────────────────────────────────────────

/** GC_RETICULUM_AUDIO_OWNER_OPEN_GRACE_MS (group-call.ts:372). */
export const DM_AUDIO_LINK_WAITER_GRACE_MS = 4_000;

/**
 * When this side may open the audio link of a DM voice room:
 * `0` = now, a positive number = after that many ms, `null` = never (the
 * peer owns the link). Mirrors resolveDmVoiceAudioLinkOpenDecision
 * (group-call.ts:382-399) and, without a role, the lexicographic owner rule
 * (isLocalAddressReticulumAudioLinkOwner, group-call.ts:8123-8131).
 */
export function dmAudioLinkOpenDelayMs(input: {
  role?: 'opener' | 'waiter';
  joinedAtMs: number;
  nowMs: number;
  localAddress?: string;
  peerAddress?: string;
  graceMs?: number;
}): number | null {
  if (input.role === 'opener') return 0;
  if (input.role === 'waiter') {
    const grace = Math.max(0, input.graceMs ?? DM_AUDIO_LINK_WAITER_GRACE_MS);
    return Math.max(0, input.joinedAtMs + grace - input.nowMs);
  }
  const left = (input.localAddress ?? '').trim();
  const right = (input.peerAddress ?? '').trim();
  if (!left || !right) return null;
  return left.localeCompare(right) <= 0 ? 0 : null;
}

// ── Audio-link frames ────────────────────────────────────────────────────────

const GC_LINK_CONTROL_MAGIC = new TextEncoder().encode('QGCCTL1\u0000');

export const isGcLinkControlFrame = (bytes: Uint8Array): boolean =>
  bytes.length > GC_LINK_CONTROL_MAGIC.length &&
  GC_LINK_CONTROL_MAGIC.every((b, i) => bytes[i] === b);

export function encodeGcLinkControlFrame(
  wire: Record<string, unknown>
): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(wire));
  const out = new Uint8Array(GC_LINK_CONTROL_MAGIC.length + body.length);
  out.set(GC_LINK_CONTROL_MAGIC, 0);
  out.set(body, GC_LINK_CONTROL_MAGIC.length);
  return out;
}

export type AudioLinkPayload =
  | { kind: 'media' }
  | { kind: 'control'; wire: Record<string, unknown> }
  | { kind: 'drop'; reason: string };

/**
 * What one inbound audio-link frame (group_audio_packet `data`) is.
 * `QGCCTL1\0`+JSON is always link control, never audio: GroupCallManager
 * decodes it with decodeGcLinkControlWire and drops what it cannot use
 * (group-call.ts:784-823, 4876-4885), so an unknown or broken control frame
 * is dropped here as well instead of reaching the audio decoder. Bare JSON
 * with a known group-call type is accepted too (older GO peers sent it).
 */
export function classifyAudioLinkPayload(bytes: Uint8Array): AudioLinkPayload {
  const isControl = isGcLinkControlFrame(bytes);
  if (!isControl && !((bytes.length > 1 && bytes[0] === 0x7b) /* '{' */)) {
    return { kind: 'media' };
  }
  const jsonBytes = isControl
    ? bytes.subarray(GC_LINK_CONTROL_MAGIC.length)
    : bytes;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    return isControl
      ? { kind: 'drop', reason: 'control-not-json' }
      : { kind: 'media' };
  }
  const wire =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const t = wire?.t;
  if (wire && typeof t === 'string' && GROUP_CALL_RETICULUM_WIRE_TYPES.has(t)) {
    return { kind: 'control', wire };
  }
  if (isControl || isIgnoredGroupCallWireType(t)) {
    return { kind: 'drop', reason: `control-type-${String(t ?? 'none')}` };
  }
  return { kind: 'media' };
}

/**
 * Reply to a Hub GAC heartbeat PING on its audio link
 * (Hub: group-call.ts:11814-11820; command send_group_audio_link_heartbeat).
 * Returns the command payload, or null when the wire is not a PING.
 */
export function buildGacPongPayload(
  wire: Record<string, unknown>,
  linkId: string | undefined,
  peerPresenceHash: string | undefined
): Record<string, unknown> | null {
  if (wire.t !== 'GAC' || wire.c !== 'PING') return null;
  const roomId = typeof wire.R === 'string' ? wire.R : '';
  if (!roomId || !linkId) return null;
  const payload: Record<string, unknown> = {
    roomId,
    command: 'PONG',
    linkId,
  };
  const seq = wire.p;
  if (typeof seq === 'number' && Number.isInteger(seq) && seq >= 0) {
    payload.seq = seq;
  }
  if (peerPresenceHash) payload.peerPresenceHash = peerPresenceHash;
  return payload;
}

/**
 * Link-auth must be resent until the Hub shows it verified the link: the Hub
 * drops link control from an unresolved link and closes it after ~10 s
 * (group-call.ts:12226-12242). A room key, a key request or media on the
 * link only flows after the Hub resolved our address on it.
 */
export function isLinkAuthAcceptedEvidence(payload: AudioLinkPayload): boolean {
  if (payload.kind === 'media') return true;
  if (payload.kind !== 'control') return false;
  const t = payload.wire.t;
  return (
    t === 'GK' ||
    t === 'GK0' ||
    t === 'GK1' ||
    t === 'GQ' ||
    t === 'GQ0' ||
    t === 'GQ1'
  );
}
