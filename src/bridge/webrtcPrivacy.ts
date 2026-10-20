/**
 * GO WebRTC privacy guard.
 *
 * The shared Hub transports (DirectVoiceWebRtcTransport, the screen-share
 * transport and the group DataChannel transport) create plain
 * `new RTCPeerConnection({ iceServers })`, forward every local ICE candidate
 * and the full local SDP to the peer, and apply every candidate the peer
 * sends. Once a page holds microphone permission, Chromium stops
 * mDNS-obfuscating host candidates, so a phone would hand its Wi-Fi/LAN
 * address, its carrier (CGNAT) address and its global IPv6 address to the
 * other side of a call.
 *
 * Hiding what GO signals is not enough on its own: GO's ICE agent still sends
 * connectivity checks from its own (unsignalled) host sockets to every
 * candidate the peer signals, and the peer learns the source address of those
 * checks as a peer-reflexive candidate (RFC 8445 §7.3.1.3). An unmodified Hub
 * signals all its candidates, so a check to its LAN, CGNAT or IPv6 address
 * would show GO's LAN, CGNAT or IPv6 address anyway.
 *
 * GO wraps `window.RTCPeerConnection` once, in GO's own window only. In the
 * default 'hide-local' mode:
 *  - local `icecandidate` events for host candidates, for srflx/prflx
 *    candidates on IPv6 (without NAT that is the phone's own address), and for
 *    any candidate whose address is not public (private / loopback /
 *    link-local / CGNAT / ULA / mDNS / hostname) never reach page listeners.
 *    Kept candidates (public IPv4 srflx, public relay) get
 *    `raddr 0.0.0.0 rport 0`, the same thing Chromium does when it hides
 *    local addresses. The end-of-candidates event (`candidate === null`)
 *    always passes.
 *  - `localDescription`, `currentLocalDescription`, `pendingLocalDescription`
 *    and `createOffer()` / `createAnswer()` results drop the same `a=candidate`
 *    lines, and a `c=` / `a=rtcp:` default address that is not one of the kept
 *    candidates is replaced with `0.0.0.0` (port 9), which is the standard
 *    "no default candidate" form Chromium already uses before gathering.
 *    Nothing else in the SDP is touched (fingerprints, ICE credentials, codecs).
 *  - remote candidates (`addIceCandidate`, and `a=candidate` lines given to
 *    `setRemoteDescription`) are applied only when their address is a public
 *    IPv4 address. GO's checks then only go to public IPv4 addresses, through
 *    the phone's NAT, so the peer sees GO's public NAT address (the one the
 *    srflx candidate already shows) or a TURN relay address, and never a LAN,
 *    carrier (CGNAT) or IPv6 address.
 *    Cost: no WebRTC over IPv6, and none inside one LAN unless the router
 *    hairpins; those calls use the Reticulum fallback.
 *  - when the user chose "Private calls" (Reticulum only, 'block-all'), new
 *    connections are created with `iceTransportPolicy: 'relay'` and no ICE
 *    servers, so nothing is gathered and no STUN traffic leaves the phone, and
 *    every candidate is suppressed in both directions.
 *
 * The mode is read once per peer connection, when it is created. A changed
 * preference applies to connections created afterwards; a live connection
 * keeps the rules it started with (the peer already knows its addresses, and
 * changing them mid-call would only break ICE restarts).
 *
 * Filtering happens before useVoiceCall signs anything: the hook signs the JSON
 * that the transport hands it, which is built from these events/descriptions.
 * Q-App iframes run in their own realm and are not affected.
 *
 * The guard also lists the connections it built until they close
 * (listGuardedPeerConnections), for diagnostics such as the 1:1 call's RTP
 * counters. Listing changes nothing about a connection.
 */

import { isCapacitor } from '../utils/platform';
import { getCallTransportPreference } from './callTransportPreference';

/** 'hide-local': WebRTC allowed, local network addresses hidden.
 *  'block-all': no candidates at all (Reticulum-only preference). */
export type WebRtcPrivacyMode = 'hide-local' | 'block-all';

export type IceAddressClass =
  | 'public'
  | 'private'
  | 'loopback'
  | 'link-local'
  | 'cgnat'
  | 'ula'
  | 'unspecified'
  | 'multicast'
  | 'reserved'
  | 'mdns'
  | 'hostname'
  | 'invalid';

export type ParsedIceCandidate = {
  /** 'a=' when the line came from SDP, '' for a bare `candidate:` string. */
  prefix: string;
  foundation: string;
  component: string;
  protocol: string;
  priority: string;
  address: string;
  port: string;
  type: string;
  relatedAddress: string | null;
  relatedPort: string | null;
  /** All tokens after `candidate:`, foundation first. */
  tokens: string[];
};

export type IceCandidateDecision =
  | { action: 'keep' }
  | { action: 'drop'; reason: string }
  | { action: 'rewrite'; candidate: string };

// ── Address classification ───────────────────────────────────────────────

function parseIpv4(input: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(input);
  if (!m) return null;
  const parts = m.slice(1).map((p) => Number(p));
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

/** Expand an IPv6 literal (zone id / brackets already removed) to 8 hextets. */
function parseIpv6(input: string): number[] | null {
  let text = input;
  if (!text.includes(':')) return null;
  const tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const v4 = parseIpv4(maybeV4);
    if (!v4) return null;
    tail.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
    // Stand in for the dotted quad with one placeholder hextet (dropped
    // below) so the '::' arithmetic stays the same as for pure hex forms.
    text = text.slice(0, lastColon + 1) + '0';
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const toHextets = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const h of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };
  const head = toHextets(halves[0]);
  const rest = halves.length === 2 ? toHextets(halves[1]) : [];
  if (!head || !rest) return null;
  // Drop the placeholder hextet that stood in for the dotted quad.
  if (tail.length) {
    if (halves.length === 2) {
      if (rest.length) rest.pop();
      else head.pop();
    } else {
      head.pop();
    }
  }
  const wanted = 8 - tail.length;
  let hextets: number[];
  if (halves.length === 2) {
    const fill = wanted - head.length - rest.length;
    if (fill < 1) return null;
    hextets = [...head, ...new Array(fill).fill(0), ...rest];
  } else {
    if (head.length !== wanted) return null;
    hextets = head;
  }
  return [...hextets, ...tail];
}

function classifyIpv4(p: number[]): IceAddressClass {
  const [a, b, c] = p;
  if (a === 0) return 'unspecified';
  if (a === 10) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  // 192.0.0.0/24 (IETF protocol assignments; Android's 464XLAT clat uses
  // 192.0.0.4) is never a reachable public address.
  if (a === 192 && b === 0 && c === 0) return 'reserved';
  if (a === 192 && b === 168) return 'private';
  if (a === 198 && (b === 18 || b === 19)) return 'reserved';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'reserved';
  return 'public';
}

function classifyIpv6(h: number[]): IceAddressClass {
  const zeroUpTo = (n: number) => h.slice(0, n).every((x) => x === 0);
  if (h.every((x) => x === 0)) return 'unspecified';
  if (zeroUpTo(7) && h[7] === 1) return 'loopback';
  const embeddedV4 = (): number[] => [
    h[6] >> 8,
    h[6] & 0xff,
    h[7] >> 8,
    h[7] & 0xff,
  ];
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (deprecated IPv4-compatible).
  if (zeroUpTo(5) && h[5] === 0xffff) return classifyIpv4(embeddedV4());
  if (zeroUpTo(6)) return classifyIpv4(embeddedV4());
  if ((h[0] & 0xffc0) === 0xfe80) return 'link-local';
  if ((h[0] & 0xffc0) === 0xfec0) return 'private';
  if ((h[0] & 0xfe00) === 0xfc00) return 'ula';
  if ((h[0] & 0xff00) === 0xff00) return 'multicast';
  // NAT64 well-known prefix carries an IPv4 address in its low 32 bits.
  if (
    h[0] === 0x64 &&
    h[1] === 0xff9b &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0
  ) {
    return classifyIpv4(embeddedV4());
  }
  // 64:ff9b:1::/48 is the local-use NAT64 prefix.
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 1) return 'private';
  // 100::/64 discard-only.
  if (h[0] === 0x100 && h[1] === 0 && h[2] === 0 && h[3] === 0) {
    return 'reserved';
  }
  return 'public';
}

function stripAddressDecoration(address: string): string {
  let a = address.trim();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  return a;
}

/** Classify an ICE / SDP connection address. Anything not 'public' is blocked. */
export function classifyIceAddress(address: string): IceAddressClass {
  if (typeof address !== 'string') return 'invalid';
  const a = stripAddressDecoration(address);
  if (!a) return 'invalid';
  const v4 = parseIpv4(a);
  if (v4) return classifyIpv4(v4);
  const v6 = parseIpv6(a);
  if (v6) return classifyIpv6(v6);
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.local\.?$/i.test(a)) return 'mdns';
  if (/^[a-z0-9.-]+$/i.test(a)) return 'hostname';
  return 'invalid';
}

/** True for every address GO must not reveal to a call peer. */
export function isBlockedIceAddress(address: string): boolean {
  return classifyIceAddress(address) !== 'public';
}

function isUnspecifiedAddress(address: string): boolean {
  return classifyIceAddress(address) === 'unspecified';
}

function normalizeAddressKey(address: string): string {
  return stripAddressDecoration(address).toLowerCase();
}

function isIpv4Literal(address: string): boolean {
  return parseIpv4(stripAddressDecoration(address)) !== null;
}

/**
 * Why GO must not run ICE checks to (or announce) this address, or null when
 * it is a public IPv4 address. IPv6 is refused even when global: without NAT
 * a check over IPv6 carries the phone's own interface address.
 */
function peerAddressRejection(address: string): string | null {
  const addressClass = classifyIceAddress(address);
  if (addressClass !== 'public') return addressClass;
  return isIpv4Literal(address) ? null : 'ipv6';
}

// ── Candidates ───────────────────────────────────────────────────────────

/**
 * Parse `candidate:<foundation> <component> <transport> <priority> <address>
 * <port> typ <type> [raddr <a>] [rport <p>] *(<name> <value>)` (RFC 8839), with
 * or without the SDP `a=` prefix. Returns null for anything malformed.
 */
export function parseIceCandidateLine(line: string): ParsedIceCandidate | null {
  if (typeof line !== 'string') return null;
  let text = line.trim();
  let prefix = '';
  if (text.startsWith('a=')) {
    prefix = 'a=';
    text = text.slice(2);
  }
  if (!/^candidate:/i.test(text)) return null;
  const tokens = text.slice('candidate:'.length).split(/\s+/).filter(Boolean);
  if (tokens.length < 8) return null;
  if (tokens[6].toLowerCase() !== 'typ') return null;
  const [foundation, component, protocol, priority, address, port, , type] =
    tokens;
  if (!/^\d+$/.test(component) || !/^\d+$/.test(port)) return null;
  let relatedAddress: string | null = null;
  let relatedPort: string | null = null;
  for (let i = 8; i + 1 < tokens.length; i += 2) {
    const name = tokens[i].toLowerCase();
    if (name === 'raddr') relatedAddress = tokens[i + 1];
    else if (name === 'rport') relatedPort = tokens[i + 1];
  }
  return {
    prefix,
    foundation,
    component,
    protocol: protocol.toLowerCase(),
    priority,
    address,
    port,
    type: type.toLowerCase(),
    relatedAddress,
    relatedPort,
    tokens,
  };
}

/**
 * Decide what GO may tell a peer about one of its own ICE candidates.
 * An empty string (end-of-candidates marker) is always kept.
 */
export function filterLocalIceCandidate(
  line: string,
  mode: WebRtcPrivacyMode
): IceCandidateDecision {
  if (typeof line !== 'string' || line.trim() === '') return { action: 'keep' };
  if (mode === 'block-all') return { action: 'drop', reason: 'reticulum-only' };
  const parsed = parseIceCandidateLine(line);
  if (!parsed) return { action: 'drop', reason: 'unparseable' };
  if (parsed.type === 'host') return { action: 'drop', reason: 'host' };
  const addressClass = classifyIceAddress(parsed.address);
  if (addressClass !== 'public')
    return { action: 'drop', reason: addressClass };
  // A reflexive address on IPv6 is normally the phone's own global address
  // (no NAT on IPv6; Chromium even emits it as srflx when it hides the host
  // candidate). Only a relay candidate (the TURN server's address) may be
  // IPv6.
  if (parsed.type !== 'relay' && !isIpv4Literal(parsed.address)) {
    return { action: 'drop', reason: 'ipv6' };
  }
  // raddr/rport are informational only (never used for connectivity checks)
  // and on srflx candidates they carry the phone's LAN address.
  if (parsed.relatedAddress === null && parsed.relatedPort === null) {
    return { action: 'keep' };
  }
  const unspecified =
    parsed.relatedAddress && parsed.relatedAddress.includes(':')
      ? '::'
      : '0.0.0.0';
  const tokens = [...parsed.tokens];
  let changed = false;
  for (let i = 8; i + 1 < tokens.length; i += 2) {
    const name = tokens[i].toLowerCase();
    if (name === 'raddr' && tokens[i + 1] !== unspecified) {
      tokens[i + 1] = unspecified;
      changed = true;
    } else if (name === 'rport' && tokens[i + 1] !== '0') {
      tokens[i + 1] = '0';
      changed = true;
    }
  }
  if (!changed) return { action: 'keep' };
  return {
    action: 'rewrite',
    candidate: `${parsed.prefix}candidate:${tokens.join(' ')}`,
  };
}

/**
 * Decide whether GO may use one of the PEER's candidates. GO's ICE agent sends
 * connectivity checks from its own host sockets to every remote candidate, and
 * the peer learns the source of a check as a peer-reflexive candidate. Only a
 * public IPv4 address is reached through the phone's NAT (the peer then sees
 * the NAT address GO's srflx candidate already shows); a check to a LAN,
 * CGNAT, mDNS or IPv6 address would carry GO's LAN, CGNAT or IPv6 address.
 * An empty string (end-of-candidates marker) is always kept.
 */
export function filterRemoteIceCandidate(
  line: string,
  mode: WebRtcPrivacyMode
): { action: 'keep' } | { action: 'drop'; reason: string } {
  if (typeof line !== 'string' || line.trim() === '') return { action: 'keep' };
  if (mode === 'block-all') return { action: 'drop', reason: 'reticulum-only' };
  const parsed = parseIceCandidateLine(line);
  if (!parsed) return { action: 'drop', reason: 'unparseable' };
  const reason = peerAddressRejection(parsed.address);
  return reason ? { action: 'drop', reason } : { action: 'keep' };
}

// ── SDP ──────────────────────────────────────────────────────────────────

/**
 * Remove blocked `a=candidate` lines from a LOCAL description and replace a
 * default address (`c=`, `a=rtcp:`) that would reveal one of them. Returns the
 * input string itself when nothing had to change.
 */
export function sanitizeLocalSdp(sdp: string, mode: WebRtcPrivacyMode): string {
  if (typeof sdp !== 'string' || sdp.length === 0) return sdp;
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(/\r?\n/);
  const out: Array<string | null> = [];
  const sectionOf: number[] = [];
  const keptBySection: Array<Set<string>> = [new Set()];
  const keptAll = new Set<string>();
  let section = 0;
  let changed = false;

  for (const line of lines) {
    if (line.startsWith('m=')) {
      section += 1;
      keptBySection[section] = new Set();
    }
    sectionOf.push(section);
    if (!line.startsWith('a=candidate:')) {
      out.push(line);
      continue;
    }
    const decision = filterLocalIceCandidate(line, mode);
    if (decision.action === 'drop') {
      out.push(null);
      changed = true;
      continue;
    }
    const finalLine = decision.action === 'rewrite' ? decision.candidate : line;
    if (decision.action === 'rewrite') changed = true;
    const parsed = parseIceCandidateLine(finalLine);
    if (parsed) {
      const key = normalizeAddressKey(parsed.address);
      keptBySection[section].add(key);
      keptAll.add(key);
    }
    out.push(finalLine);
  }

  const isRevealing = (address: string, sec: number): boolean => {
    if (isUnspecifiedAddress(address)) return false;
    const allowed = sec === 0 ? keptAll : keptBySection[sec];
    return !allowed?.has(normalizeAddressKey(address));
  };
  const resetPortSections = new Set<number>();
  for (let i = 0; i < out.length; i += 1) {
    const line = out[i];
    if (line == null) continue;
    const sec = sectionOf[i];
    if (line.startsWith('c=')) {
      const m = /^c=IN\s+IP[46]\s+([^\s/]+)/.exec(line);
      if (!m || !isRevealing(m[1], sec)) continue;
      out[i] = 'c=IN IP4 0.0.0.0';
      if (sec > 0) resetPortSections.add(sec);
      changed = true;
    } else if (line.startsWith('a=rtcp:')) {
      const m = /^a=rtcp:\d+\s+IN\s+IP[46]\s+(\S+)/.exec(line);
      if (!m || !isRevealing(m[1], sec)) continue;
      out[i] = 'a=rtcp:9 IN IP4 0.0.0.0';
      changed = true;
    }
  }
  if (resetPortSections.size > 0) {
    for (let i = 0; i < out.length; i += 1) {
      const line = out[i];
      if (line == null || !line.startsWith('m=')) continue;
      if (!resetPortSections.has(sectionOf[i])) continue;
      const m = /^(m=\S+\s+)(\d+)(\/\d+)?(\s.*)?$/.exec(line);
      if (!m || m[2] === '0' || m[2] === '9') continue;
      out[i] = `${m[1]}9${m[3] ?? ''}${m[4] ?? ''}`;
    }
  }
  if (!changed) return sdp;
  return out.filter((line): line is string => line !== null).join(eol);
}

/**
 * Remove the peer's `a=candidate` lines that GO must not check (see
 * filterRemoteIceCandidate) from a REMOTE description. Everything else,
 * including `a=end-of-candidates` and `c=` (ICE ignores it), stays as is.
 * Returns the input string itself when nothing had to change.
 */
export function sanitizeRemoteSdp(
  sdp: string,
  mode: WebRtcPrivacyMode
): string {
  if (typeof sdp !== 'string' || sdp.length === 0) return sdp;
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(/\r?\n/);
  const kept = lines.filter(
    (line) =>
      !line.startsWith('a=candidate:') ||
      filterRemoteIceCandidate(line, mode).action === 'keep'
  );
  if (kept.length === lines.length) return sdp;
  return kept.join(eol);
}

// ── RTCPeerConnection wrapper ────────────────────────────────────────────

const GUARD_MARK = Symbol.for('qortal.go.webrtcPrivacyGuard');

type AnyCtor = new (...args: any[]) => any;

type GuardTarget = {
  RTCPeerConnection?: AnyCtor;
  webkitRTCPeerConnection?: AnyCtor;
  RTCSessionDescription?: AnyCtor;
  RTCIceCandidate?: AnyCtor;
  RTCPeerConnectionIceEvent?: AnyCtor;
  Event?: AnyCtor;
};

export type WebRtcPrivacyGuardOptions = {
  /** Install even outside GO (tests). Default: only when isCapacitor(). */
  force?: boolean;
  /** Realm whose RTCPeerConnection is wrapped. Default: globalThis. */
  target?: GuardTarget;
  /** Mode source. Default: the GO call transport preference. */
  getMode?: () => WebRtcPrivacyMode;
};

/** 'block-all' when the user chose Reticulum-only calls, else 'hide-local'. */
export function getWebRtcPrivacyMode(): WebRtcPrivacyMode {
  return getCallTransportPreference() === 'reticulum'
    ? 'block-all'
    : 'hide-local';
}

const stats = {
  suppressedCandidates: 0,
  rewrittenCandidates: 0,
  sanitizedDescriptions: 0,
  droppedRemoteCandidates: 0,
  sanitizedRemoteDescriptions: 0,
  peerConnections: 0,
};

/** Counters for diagnostics (no addresses). */
export function getWebRtcPrivacyStats(): typeof stats {
  return { ...stats };
}

// ── Registry of live guarded peer connections ────────────────────────────
//
// Every RTCPeerConnection built through the guard is listed (nothing is left
// out) until it is closed, so GO code can find one it did not create itself,
// e.g. the audio surface reads the 1:1 call's RTP counters from the
// connection whose sender carries its microphone track. Held weakly where the
// engine has WeakRef, so a page that drops an unclosed connection does not
// keep it alive through this list. Read-only for callers: the registry never
// changes what a connection does.

/** The data channel label of communityStunCache's STUN probe connections. */
const STUN_PROBE_DATA_CHANNEL_LABEL = 'stun-probe';

export type GuardedPeerConnectionInfo = {
  pc: RTCPeerConnection;
  /** Creation order within this page (1, 2, …). */
  serial: number;
  createdAt: number;
  /** The privacy mode fixed when the connection was created. */
  mode: WebRtcPrivacyMode;
  /** A community STUN probe (communityStunCache), not a call. */
  stunProbe: boolean;
};

type WeakRefLike<T extends object> = { deref(): T | undefined };
type WeakRefCtor = new <T extends object>(target: T) => WeakRefLike<T>;

type RegistryEntry = {
  ref: WeakRefLike<object>;
  serial: number;
  createdAt: number;
  mode: WebRtcPrivacyMode;
  stunProbe: boolean;
};

const registry = new Set<RegistryEntry>();
const registryByPc = new WeakMap<object, RegistryEntry>();
let registrySerial = 0;

function makeRef<T extends object>(target: T): WeakRefLike<T> {
  const Ctor = (globalThis as { WeakRef?: WeakRefCtor }).WeakRef;
  if (typeof Ctor === 'function') {
    try {
      return new Ctor(target);
    } catch {
      /* fall back to a strong reference */
    }
  }
  return { deref: () => target };
}

function registerPeerConnection(pc: object, mode: WebRtcPrivacyMode): void {
  registrySerial += 1;
  const entry: RegistryEntry = {
    ref: makeRef(pc),
    serial: registrySerial,
    createdAt: Date.now(),
    mode,
    stunProbe: false,
  };
  registry.add(entry);
  registryByPc.set(pc, entry);
}

function unregisterPeerConnection(pc: object): void {
  const entry = registryByPc.get(pc);
  if (!entry) return;
  registryByPc.delete(pc);
  registry.delete(entry);
}

function markStunProbe(pc: object, label: unknown): void {
  if (label !== STUN_PROBE_DATA_CHANNEL_LABEL) return;
  const entry = registryByPc.get(pc);
  if (entry) entry.stunProbe = true;
}

/**
 * Live peer connections built through the guard, oldest first. A connection
 * leaves the list when it is closed (or collected). Empty when the guard is
 * not installed (outside GO).
 */
export function listGuardedPeerConnections(): GuardedPeerConnectionInfo[] {
  const out: GuardedPeerConnectionInfo[] = [];
  for (const entry of [...registry]) {
    const pc = entry.ref.deref() as RTCPeerConnection | undefined;
    let closed = !pc;
    if (pc) {
      try {
        closed = pc.signalingState === 'closed';
      } catch {
        closed = false;
      }
    }
    if (closed) {
      registry.delete(entry);
      if (pc) registryByPc.delete(pc);
      continue;
    }
    out.push({
      pc: pc as RTCPeerConnection,
      serial: entry.serial,
      createdAt: entry.createdAt,
      mode: entry.mode,
      stunProbe: entry.stunProbe,
    });
  }
  return out;
}

let installed: {
  target: GuardTarget;
  native: AnyCtor;
  webkitWasNative: boolean;
} | null = null;

function applyConfigurationPolicy(
  configuration: RTCConfiguration | undefined,
  mode: WebRtcPrivacyMode
): RTCConfiguration | undefined {
  if (mode !== 'block-all') return configuration;
  return {
    ...(configuration ?? {}),
    iceServers: [],
    iceTransportPolicy: 'relay',
  };
}

function makeDescription(
  target: GuardTarget,
  type: RTCSdpType,
  sdp: string
): RTCSessionDescriptionInit & { toJSON?: () => RTCSessionDescriptionInit } {
  const Ctor =
    target.RTCSessionDescription ??
    (globalThis as GuardTarget).RTCSessionDescription;
  if (typeof Ctor === 'function') {
    try {
      return new Ctor({ type, sdp });
    } catch {
      /* fall through to a plain description */
    }
  }
  return {
    type,
    sdp,
    toJSON: () => ({ type, sdp }),
  };
}

function makeCandidateLike(init: RTCIceCandidateInit): Record<string, unknown> {
  const parsed = parseIceCandidateLine(init.candidate ?? '');
  const json = {
    candidate: init.candidate ?? '',
    sdpMid: init.sdpMid ?? null,
    sdpMLineIndex: init.sdpMLineIndex ?? null,
    usernameFragment: init.usernameFragment ?? null,
  };
  return {
    ...json,
    foundation: parsed?.foundation ?? null,
    component:
      parsed?.component === '1'
        ? 'rtp'
        : parsed?.component === '2'
          ? 'rtcp'
          : null,
    priority: parsed ? Number(parsed.priority) : null,
    address: parsed?.address ?? null,
    protocol: parsed?.protocol ?? null,
    port: parsed ? Number(parsed.port) : null,
    type: parsed?.type ?? null,
    relatedAddress: parsed?.relatedAddress ?? null,
    relatedPort: parsed?.relatedPort ? Number(parsed.relatedPort) : null,
    toJSON: () => ({ ...json }),
  };
}

function buildReplacementIceEvent(
  target: GuardTarget,
  original: {
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
  },
  candidateLine: string,
  originalEvent: Event & { url?: string | null }
): Event | null {
  const init: RTCIceCandidateInit = {
    candidate: candidateLine,
    sdpMid: original.sdpMid ?? null,
    sdpMLineIndex: original.sdpMLineIndex ?? null,
    usernameFragment: original.usernameFragment ?? null,
  };
  const g = globalThis as GuardTarget;
  const IceCandidate = target.RTCIceCandidate ?? g.RTCIceCandidate;
  const IceEvent =
    target.RTCPeerConnectionIceEvent ?? g.RTCPeerConnectionIceEvent;
  if (typeof IceCandidate === 'function') {
    try {
      const candidate = new IceCandidate(init);
      if (typeof IceEvent === 'function') {
        try {
          return new IceEvent('icecandidate', {
            candidate,
            url: originalEvent.url ?? null,
          });
        } catch {
          /* fall back to a plain event below */
        }
      }
      return plainIceEvent(target, candidate, originalEvent);
    } catch {
      /* fall back to a candidate-like object */
    }
  }
  return plainIceEvent(target, makeCandidateLike(init), originalEvent);
}

function plainIceEvent(
  target: GuardTarget,
  candidate: unknown,
  originalEvent: Event & { url?: string | null }
): Event | null {
  const EventCtor = target.Event ?? (globalThis as GuardTarget).Event;
  if (typeof EventCtor !== 'function') return null;
  const event = new EventCtor('icecandidate') as Event;
  Object.defineProperty(event, 'candidate', {
    value: candidate,
    enumerable: true,
  });
  Object.defineProperty(event, 'url', {
    value: originalEvent.url ?? null,
    enumerable: true,
  });
  return event;
}

function createGuardedPeerConnectionClass(
  Native: AnyCtor,
  target: GuardTarget,
  getMode: () => WebRtcPrivacyMode
): AnyCtor {
  const replacementEvents = new WeakSet<Event>();
  // Mode per peer connection, fixed when it is created (see module header).
  const modes = new WeakMap<object, WebRtcPrivacyMode>();
  const modeOf = (pc: object): WebRtcPrivacyMode => modes.get(pc) ?? getMode();

  const sanitizeDescription = <T>(
    description: T,
    mode: WebRtcPrivacyMode
  ): T => {
    const d = description as unknown as { type?: RTCSdpType; sdp?: unknown };
    if (!d || typeof d.sdp !== 'string' || !d.type) return description;
    const sdp = sanitizeLocalSdp(d.sdp, mode);
    if (sdp === d.sdp) return description;
    stats.sanitizedDescriptions += 1;
    return makeDescription(target, d.type, sdp) as unknown as T;
  };

  const onLocalIceCandidate = (pc: EventTarget, event: Event): void => {
    if (replacementEvents.has(event)) return;
    const candidate = (event as Event & { candidate?: RTCIceCandidate | null })
      .candidate;
    if (!candidate) return; // end-of-candidates always passes
    const line =
      typeof candidate.candidate === 'string' ? candidate.candidate : '';
    if (!line.trim()) return;
    const decision = filterLocalIceCandidate(line, modeOf(pc));
    if (decision.action === 'keep') return;
    event.stopImmediatePropagation();
    if (decision.action === 'drop') {
      stats.suppressedCandidates += 1;
      return;
    }
    const replacement = buildReplacementIceEvent(
      target,
      candidate,
      decision.candidate,
      event as Event & { url?: string | null }
    );
    if (!replacement) {
      stats.suppressedCandidates += 1;
      return;
    }
    stats.rewrittenCandidates += 1;
    replacementEvents.add(replacement);
    pc.dispatchEvent(replacement);
  };

  const wrapCreate = (
    pc: any,
    create: (...args: any[]) => any,
    args: any[]
  ): any => {
    const mode = modeOf(pc);
    if (typeof args[0] === 'function') {
      // Legacy callback form: (success, failure, options).
      const [success, failure, options] = args;
      return create.call(
        pc,
        (description: RTCSessionDescriptionInit) =>
          success(sanitizeDescription(description, mode)),
        failure,
        options
      );
    }
    return Promise.resolve(create.apply(pc, args)).then(
      (description: RTCSessionDescriptionInit) =>
        sanitizeDescription(description, mode)
    );
  };

  class GuardedRTCPeerConnection extends Native {
    constructor(configuration?: RTCConfiguration, ...rest: unknown[]) {
      const mode = getMode();
      super(applyConfigurationPolicy(configuration, mode), ...rest);
      modes.set(this, mode);
      stats.peerConnections += 1;
      registerPeerConnection(this, mode);
      // Registered before any page code can set `onicecandidate` or add its
      // own listener, and as a capture listener, so it always runs first and
      // can stop a blocked candidate from reaching anyone else.
      this.addEventListener(
        'icecandidate',
        (event: Event) =>
          onLocalIceCandidate(this as unknown as EventTarget, event),
        true
      );
    }

    get localDescription() {
      return sanitizeDescription(super.localDescription, modeOf(this));
    }

    get currentLocalDescription() {
      return sanitizeDescription(super.currentLocalDescription, modeOf(this));
    }

    get pendingLocalDescription() {
      return sanitizeDescription(super.pendingLocalDescription, modeOf(this));
    }

    createOffer(...args: any[]) {
      return wrapCreate(this, super.createOffer, args);
    }

    createAnswer(...args: any[]) {
      return wrapCreate(this, super.createAnswer, args);
    }

    setConfiguration(configuration?: RTCConfiguration) {
      return super.setConfiguration(
        applyConfigurationPolicy(configuration, modeOf(this))
      );
    }

    // Registry bookkeeping only (see listGuardedPeerConnections); both call
    // the native method unchanged.
    createDataChannel(...args: any[]) {
      markStunProbe(this, args[0]);
      return super.createDataChannel(...args);
    }

    close(...args: any[]) {
      unregisterPeerConnection(this);
      return super.close(...args);
    }

    // (candidate) or legacy (candidate, success, failure).
    addIceCandidate(...args: any[]) {
      const candidate = args[0];
      const line =
        candidate &&
        typeof candidate === 'object' &&
        typeof candidate.candidate === 'string'
          ? candidate.candidate
          : '';
      // null / {candidate: ''} is end-of-candidates: always passes.
      if (
        line.trim() &&
        filterRemoteIceCandidate(line, modeOf(this)).action === 'drop'
      ) {
        stats.droppedRemoteCandidates += 1;
        const success = args[1];
        if (typeof success === 'function') {
          void Promise.resolve().then(() => success());
        }
        // Resolve like an applied candidate: the transports treat a rejection
        // as a stale candidate and only log it.
        return Promise.resolve();
      }
      return super.addIceCandidate(...args);
    }

    // (description) or legacy (description, success, failure).
    setRemoteDescription(...args: any[]) {
      const d = args[0];
      if (d && typeof d === 'object' && typeof d.sdp === 'string' && d.type) {
        const sdp = sanitizeRemoteSdp(d.sdp, modeOf(this));
        if (sdp !== d.sdp) {
          stats.sanitizedRemoteDescriptions += 1;
          return super.setRemoteDescription(
            { type: d.type, sdp },
            ...args.slice(1)
          );
        }
      }
      return super.setRemoteDescription(...args);
    }
  }

  try {
    Object.defineProperty(GuardedRTCPeerConnection, 'name', {
      value: 'RTCPeerConnection',
    });
  } catch {
    /* cosmetic only */
  }
  (GuardedRTCPeerConnection as unknown as Record<symbol, unknown>)[GUARD_MARK] =
    true;
  return GuardedRTCPeerConnection;
}

function defineGlobal(target: GuardTarget, name: string, value: unknown): void {
  try {
    Object.defineProperty(target, name, {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  } catch {
    (target as Record<string, unknown>)[name] = value;
  }
}

/**
 * Wrap `RTCPeerConnection` in GO's window. Idempotent. A no-op outside GO
 * (desktop Electron and the browser keep the stock constructor) unless
 * `force` is set. Returns true when the guard is active afterwards.
 */
export function installWebRtcPrivacyGuard(
  options: WebRtcPrivacyGuardOptions = {}
): boolean {
  if (!options.force && !isCapacitor()) return false;
  const target = options.target ?? (globalThis as GuardTarget);
  const Native = target.RTCPeerConnection;
  if (typeof Native !== 'function') return false;
  if ((Native as unknown as Record<symbol, unknown>)[GUARD_MARK]) return true;
  const Guarded = createGuardedPeerConnectionClass(
    Native,
    target,
    options.getMode ?? getWebRtcPrivacyMode
  );
  const webkitWasNative = target.webkitRTCPeerConnection === Native;
  defineGlobal(target, 'RTCPeerConnection', Guarded);
  if (webkitWasNative) defineGlobal(target, 'webkitRTCPeerConnection', Guarded);
  installed = { target, native: Native, webkitWasNative };
  return true;
}

export function isWebRtcPrivacyGuardInstalled(
  target: GuardTarget = globalThis as GuardTarget
): boolean {
  const ctor = target.RTCPeerConnection as unknown as
    | Record<symbol, unknown>
    | undefined;
  return Boolean(ctor && ctor[GUARD_MARK]);
}

/** Test-only: restore the stock constructor and reset counters. */
export function __uninstallWebRtcPrivacyGuardForTests(): void {
  if (installed) {
    defineGlobal(installed.target, 'RTCPeerConnection', installed.native);
    if (installed.webkitWasNative) {
      defineGlobal(
        installed.target,
        'webkitRTCPeerConnection',
        installed.native
      );
    }
  }
  installed = null;
  registry.clear();
  registrySerial = 0;
  stats.suppressedCandidates = 0;
  stats.rewrittenCandidates = 0;
  stats.sanitizedDescriptions = 0;
  stats.droppedRemoteCandidates = 0;
  stats.sanitizedRemoteDescriptions = 0;
  stats.peerConnections = 0;
}
