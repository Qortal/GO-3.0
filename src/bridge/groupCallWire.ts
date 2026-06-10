/**
 * Mobile port of the Reticulum group-call control wire (electron/src/group-call-wire-reticulum.ts).
 *
 * Only the subset needed for 1:1 DM voice on mobile is implemented: join (GJ/GI),
 * leave (GL), key (GK + GK0/GK1 fragments) and key-request (GQ + GQ0/GQ1 fragments).
 * Topology/cluster wires are desktop-only (DM never needs them).
 *
 * Byte layouts and field names MUST stay identical to the desktop encoder so a
 * mobile peer interoperates with a desktop Hub peer. Fragmentation mirrors
 * `buildBinaryBlobFrames`; the per-packet budget is `RT_RETICULUM_MAX_WIRE_JSON_BYTES`.
 */

export const RT_RETICULUM_MAX_WIRE_JSON_BYTES = 383;
export const RT_GCALL_MAX_FRAGMENTS = 96;

const BRIDGE_SENDER_HASH_PLACEHOLDER = '0'.repeat(32);
const OVERLAY_MESSAGE_ID_PLACEHOLDER = 'overlay000000';

const te = new TextEncoder();

const utf8ByteLength = (s: string): number => te.encode(s).length;

export function byteLengthUtf8JsonWithBridgeSender(
  obj: Record<string, unknown>
): number {
  return utf8ByteLength(
    JSON.stringify({
      ...obj,
      r: BRIDGE_SENDER_HASH_PLACEHOLDER,
      X: OVERLAY_MESSAGE_ID_PLACEHOLDER,
      L: 0,
    })
  );
}

const HEX64_RE = /^[0-9a-f]{64}$/i;
const RNS_DEST_HASH_RE = /^[0-9a-f]{32}$/i;

export const isHex64 = (s: unknown): s is string =>
  typeof s === 'string' && HEX64_RE.test(s);
export const isRnsDestinationHashHex = (s: unknown): s is string =>
  typeof s === 'string' && RNS_DEST_HASH_RE.test(s);

export function isRnsIdentityPublicKeyBase64(s: unknown): s is string {
  if (typeof s !== 'string' || s.length < 86 || s.length > 88) return false;
  try {
    return base64ToUint8(s).length === 64;
  } catch {
    return false;
  }
}

export function normalizeRkBase64ForWire(rk: string): string {
  return rk.replace(/=+$/u, '');
}

function uint8ToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function base64ToUint8(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256HexUtf8(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', te.encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const GROUP_CALL_RETICULUM_WIRE_TYPES = new Set<string>([
  'GA', 'GAC', 'GJ', 'GI', 'GL', 'GH', 'GK', 'GK0', 'GK1', 'GQ', 'GQ0', 'GQ1',
  'GT', 'GT0', 'GT1', 'GR', 'GR0', 'GR1',
]);

export const isGroupCallReticulumWireType = (t: unknown): boolean =>
  typeof t === 'string' && GROUP_CALL_RETICULUM_WIRE_TYPES.has(t);

// ── Join / leave ────────────────────────────────────────────────────────────

export function encodeJoinWire(env: {
  roomId: string;
  chatId: string;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  reticulumDestinationHash: string;
  reticulumIdentityPublicKeyBase64?: string | null;
  joinGeneration?: number;
}): Record<string, unknown> {
  const o: Record<string, unknown> = {
    t: 'GJ',
    R: env.roomId,
    H: env.chatId,
    a: env.fromAddress,
    k: env.fromPublicKey,
    m: env.timestamp,
    g: env.signature,
    d: env.reticulumDestinationHash.trim().toLowerCase(),
  };
  if (
    typeof env.reticulumIdentityPublicKeyBase64 === 'string' &&
    isRnsIdentityPublicKeyBase64(env.reticulumIdentityPublicKeyBase64)
  ) {
    o.rk = env.reticulumIdentityPublicKeyBase64;
  }
  if (typeof env.joinGeneration === 'number' && Number.isFinite(env.joinGeneration)) {
    o.j = env.joinGeneration;
  }
  return o;
}

export function encodeJoinIdentityWire(env: {
  fromAddress: string;
  signature: string;
  timestamp: number;
  reticulumDestinationHash: string;
  reticulumIdentityPublicKeyBase64: string;
  joinGeneration?: number;
}): Record<string, unknown> | null {
  if (!isRnsIdentityPublicKeyBase64(env.reticulumIdentityPublicKeyBase64)) return null;
  const o: Record<string, unknown> = {
    t: 'GI',
    a: env.fromAddress,
    m: env.timestamp,
    g: env.signature,
    d: env.reticulumDestinationHash.trim().toLowerCase(),
    rk: normalizeRkBase64ForWire(env.reticulumIdentityPublicKeyBase64),
  };
  if (typeof env.joinGeneration === 'number' && Number.isFinite(env.joinGeneration)) {
    o.j = env.joinGeneration;
  }
  return o;
}

export function decodeJoinWire(raw: Record<string, unknown>): {
  type: 'GC_JOIN';
  roomId: string;
  chatId: string;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  reticulumDestinationHash: string;
  reticulumIdentityPublicKeyBase64?: string;
  joinGeneration?: number;
} | null {
  if (raw.t !== 'GJ') return null;
  const { R, H, a, k, m, g, d, rk, j } = raw;
  if (
    typeof R !== 'string' || typeof H !== 'string' || typeof a !== 'string' ||
    typeof k !== 'string' || typeof m !== 'number' || typeof g !== 'string' ||
    !isRnsDestinationHashHex(d)
  ) {
    return null;
  }
  if (rk !== undefined && rk !== null && !isRnsIdentityPublicKeyBase64(rk)) return null;
  return {
    type: 'GC_JOIN',
    roomId: R,
    chatId: H,
    fromAddress: a,
    fromPublicKey: k,
    signature: g,
    timestamp: m,
    reticulumDestinationHash: (d as string).trim().toLowerCase(),
    ...(typeof rk === 'string' && isRnsIdentityPublicKeyBase64(rk)
      ? { reticulumIdentityPublicKeyBase64: rk }
      : {}),
    ...(typeof j === 'number' && Number.isFinite(j) ? { joinGeneration: j } : {}),
  };
}

export function encodeLeaveWire(env: {
  roomId: string;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
}): Record<string, unknown> {
  return {
    t: 'GL',
    R: env.roomId,
    a: env.fromAddress,
    k: env.fromPublicKey,
    m: env.timestamp,
    g: env.signature,
  };
}

// ── Key / key-request (single + fragmented) ──────────────────────────────────

export type GcKeyDecoded = {
  type: 'GC_KEY';
  roomId: string;
  toAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  encryptedKey: string;
  keyMessageVersion: number;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyCommitment: string;
  encryptedKeyDigest: string;
  signature: string;
  timestamp: number;
};

export type GcKeyRequestDecoded = {
  type: 'GC_KEY_REQUEST';
  roomId: string;
  toAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyMessageVersion: number;
  signature: string;
  timestamp: number;
};

function keyFragmentBodyJson(b: GcKeyDecoded): string {
  return JSON.stringify({
    y: b.encryptedKey, T: b.toAddress, a: b.fromAddress, k: b.fromPublicKey,
    v: b.keyMessageVersion, S: b.callSessionId, G: b.mediaSessionGeneration,
    h: b.keyCommitment, d: b.encryptedKeyDigest, g: b.signature, m: b.timestamp,
  });
}

function keyRequestFragmentBodyJson(b: GcKeyRequestDecoded): string {
  return JSON.stringify({
    T: b.toAddress, a: b.fromAddress, k: b.fromPublicKey, S: b.callSessionId,
    G: b.mediaSessionGeneration, v: b.keyMessageVersion, m: b.timestamp, g: b.signature,
  });
}

async function buildBinaryBlobFrames(params: {
  kind0: string;
  kind1: string;
  roomId: string;
  bodyUtf8: Uint8Array;
  meta: Record<string, unknown>;
}): Promise<Record<string, unknown>[] | null> {
  const { kind0, kind1, roomId, bodyUtf8, meta } = params;
  const f = bodyUtf8.length;
  const z = (await sha256HexUtf8(new TextDecoder().decode(bodyUtf8))).toLowerCase();
  const base0: Record<string, unknown> = { t: kind0, R: roomId, z, n: 0, f, ...meta };
  let chunkSize = 96;
  for (let attempt = 0; attempt < 48; attempt++) {
    const parts: Record<string, unknown>[] = [];
    let n = 0;
    for (let off = 0; off < bodyUtf8.length; off += chunkSize) {
      parts.push({
        t: kind1,
        R: roomId,
        z,
        x: n,
        n: 0,
        p: uint8ToBase64(bodyUtf8.subarray(off, off + chunkSize)),
      });
      n++;
      if (n > RT_GCALL_MAX_FRAGMENTS) break;
    }
    if (n > RT_GCALL_MAX_FRAGMENTS) {
      chunkSize = Math.floor(chunkSize * 0.75);
      continue;
    }
    const metaFrame = { ...base0, n };
    for (const p of parts) (p as Record<string, unknown>).n = n;
    const maxLen = Math.max(
      byteLengthUtf8JsonWithBridgeSender(metaFrame),
      ...parts.map((o) => byteLengthUtf8JsonWithBridgeSender(o))
    );
    if (maxLen <= RT_RETICULUM_MAX_WIRE_JSON_BYTES) return [metaFrame, ...parts];
    chunkSize = Math.floor(chunkSize * 0.82);
    if (chunkSize < 28) return null;
  }
  return null;
}

export async function encodeKeyWire(env: GcKeyDecoded): Promise<Record<string, unknown>[]> {
  const single: Record<string, unknown> = {
    t: 'GK', R: env.roomId, T: env.toAddress, a: env.fromAddress, k: env.fromPublicKey,
    y: env.encryptedKey, v: env.keyMessageVersion, S: env.callSessionId,
    G: env.mediaSessionGeneration, h: env.keyCommitment, d: env.encryptedKeyDigest,
    m: env.timestamp, g: env.signature,
  };
  if (byteLengthUtf8JsonWithBridgeSender(single) <= RT_RETICULUM_MAX_WIRE_JSON_BYTES) {
    return [single];
  }
  const frames = await buildBinaryBlobFrames({
    kind0: 'GK0',
    kind1: 'GK1',
    roomId: env.roomId,
    bodyUtf8: te.encode(keyFragmentBodyJson(env)),
    meta: { f0: 1 },
  });
  return frames ?? [];
}

export async function encodeKeyRequestWire(
  env: GcKeyRequestDecoded
): Promise<Record<string, unknown>[]> {
  const single: Record<string, unknown> = {
    t: 'GQ', R: env.roomId, T: env.toAddress, a: env.fromAddress, k: env.fromPublicKey,
    S: env.callSessionId, G: env.mediaSessionGeneration, v: env.keyMessageVersion,
    m: env.timestamp, g: env.signature,
  };
  if (byteLengthUtf8JsonWithBridgeSender(single) <= RT_RETICULUM_MAX_WIRE_JSON_BYTES) {
    return [single];
  }
  const frames = await buildBinaryBlobFrames({
    kind0: 'GQ0',
    kind1: 'GQ1',
    roomId: env.roomId,
    bodyUtf8: te.encode(keyRequestFragmentBodyJson(env)),
    meta: {},
  });
  return frames ?? [];
}

export function decodeKeyWireSingle(raw: Record<string, unknown>): GcKeyDecoded | null {
  if (raw.t !== 'GK') return null;
  const { R, T, a, k, y, v, S, G, h, d, m, g } = raw;
  if (
    typeof R !== 'string' || typeof T !== 'string' || typeof a !== 'string' ||
    typeof k !== 'string' || typeof y !== 'string' || typeof v !== 'number' ||
    typeof S !== 'string' || typeof G !== 'number' || typeof h !== 'string' ||
    typeof d !== 'string' || typeof m !== 'number' || typeof g !== 'string'
  ) {
    return null;
  }
  return {
    type: 'GC_KEY', roomId: R, toAddress: T, fromAddress: a, fromPublicKey: k,
    encryptedKey: y, keyMessageVersion: v, callSessionId: S, mediaSessionGeneration: G,
    keyCommitment: h, encryptedKeyDigest: d, signature: g, timestamp: m,
  };
}

export function decodeKeyRequestWireSingle(
  raw: Record<string, unknown>
): GcKeyRequestDecoded | null {
  if (raw.t !== 'GQ') return null;
  const { R, T, a, k, S, G, v, m, g } = raw;
  if (
    typeof R !== 'string' || typeof T !== 'string' || typeof a !== 'string' ||
    typeof k !== 'string' || typeof S !== 'string' || typeof G !== 'number' ||
    typeof v !== 'number' || typeof m !== 'number' || typeof g !== 'string'
  ) {
    return null;
  }
  return {
    type: 'GC_KEY_REQUEST', roomId: R, toAddress: T, fromAddress: a, fromPublicKey: k,
    callSessionId: S, mediaSessionGeneration: G, keyMessageVersion: v, signature: g, timestamp: m,
  };
}

// ── Fragment reassembly (GK0/GK1, GQ0/GQ1) ───────────────────────────────────

export type FragmentMeta = { roomId: string; z: string; n: number; f: number };

export function parseFragmentMeta(
  raw: Record<string, unknown>,
  kind0: string
): FragmentMeta | null {
  if (raw.t !== kind0) return null;
  const { R, z, n, f } = raw;
  if (
    typeof R !== 'string' || !isHex64(z) || typeof n !== 'number' ||
    !Number.isInteger(n) || n < 1 || typeof f !== 'number' ||
    !Number.isInteger(f) || f < 0
  ) {
    return null;
  }
  return { roomId: R, z: (z as string).toLowerCase(), n, f };
}

export function parseFragmentPart(
  raw: Record<string, unknown>,
  kind1: string
): { R: string; z: string; x: number; n: number; p: string } | null {
  if (raw.t !== kind1) return null;
  const { R, z, x, n, p } = raw;
  if (
    typeof R !== 'string' || !isHex64(z) || typeof x !== 'number' ||
    !Number.isInteger(x) || typeof n !== 'number' || !Number.isInteger(n) ||
    typeof p !== 'string'
  ) {
    return null;
  }
  return { R, z: (z as string).toLowerCase(), x, n, p };
}

export async function reassembleBody(
  n: number,
  totalBytes: number,
  z: string,
  parts: Map<number, string>
): Promise<string | null> {
  const chunks: Uint8Array[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const b64 = parts.get(i);
    if (!b64) return null;
    try {
      const buf = base64ToUint8(b64);
      chunks.push(buf);
      sum += buf.length;
    } catch {
      return null;
    }
  }
  if (sum !== totalBytes) return null;
  const merged = new Uint8Array(sum);
  let o = 0;
  for (const c of chunks) {
    merged.set(c, o);
    o += c.length;
  }
  const json = new TextDecoder().decode(merged);
  if ((await sha256HexUtf8(json)).toLowerCase() !== z) return null;
  return json;
}

export function decodeKeyBody(roomId: string, json: string): GcKeyDecoded | null {
  try {
    const p = JSON.parse(json);
    if (
      typeof p?.y !== 'string' || typeof p?.T !== 'string' || typeof p?.a !== 'string' ||
      typeof p?.k !== 'string' || typeof p?.v !== 'number' || typeof p?.S !== 'string' ||
      typeof p?.G !== 'number' || typeof p?.h !== 'string' || typeof p?.d !== 'string' ||
      typeof p?.g !== 'string' || typeof p?.m !== 'number'
    ) {
      return null;
    }
    return {
      type: 'GC_KEY', roomId, toAddress: p.T, fromAddress: p.a, fromPublicKey: p.k,
      encryptedKey: p.y, keyMessageVersion: p.v, callSessionId: p.S,
      mediaSessionGeneration: p.G, keyCommitment: p.h, encryptedKeyDigest: p.d,
      signature: p.g, timestamp: p.m,
    };
  } catch {
    return null;
  }
}

export function decodeKeyRequestBody(
  roomId: string,
  json: string
): GcKeyRequestDecoded | null {
  try {
    const p = JSON.parse(json);
    if (
      typeof p?.T !== 'string' || typeof p?.a !== 'string' || typeof p?.k !== 'string' ||
      typeof p?.S !== 'string' || typeof p?.G !== 'number' || typeof p?.v !== 'number' ||
      typeof p?.m !== 'number' || typeof p?.g !== 'string'
    ) {
      return null;
    }
    return {
      type: 'GC_KEY_REQUEST', roomId, toAddress: p.T, fromAddress: p.a, fromPublicKey: p.k,
      callSessionId: p.S, mediaSessionGeneration: p.G, keyMessageVersion: p.v,
      signature: p.g, timestamp: p.m,
    };
  } catch {
    return null;
  }
}

export { uint8ToBase64, base64ToUint8 };
