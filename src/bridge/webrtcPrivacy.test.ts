import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __uninstallWebRtcPrivacyGuardForTests,
  classifyIceAddress,
  filterLocalIceCandidate,
  filterRemoteIceCandidate,
  getWebRtcPrivacyMode,
  getWebRtcPrivacyStats,
  installWebRtcPrivacyGuard,
  isBlockedIceAddress,
  listGuardedPeerConnections,
  isWebRtcPrivacyGuardInstalled,
  parseIceCandidateLine,
  sanitizeLocalSdp,
  sanitizeRemoteSdp,
  type WebRtcPrivacyMode,
} from './webrtcPrivacy';
import {
  __resetCallTransportPreferenceForTests,
  setCallTransportPreference,
} from './callTransportPreference';
import {
  DirectVoiceWebRtcTransport,
  type DirectVoiceRtcSignal,
} from '../lib/call/directVoiceWebRtcTransport';

const FINGERPRINT =
  'a=fingerprint:sha-256 4B:1C:7A:2D:9F:30:11:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22';

const HOST_LAN =
  'candidate:1467250027 1 udp 2122260223 192.168.1.23 54321 typ host generation 0 ufrag Ab12 network-id 1 network-cost 10';
const HOST_V6_GLOBAL =
  'candidate:2 1 udp 2122197247 2a02:1810:4d07:5a00:1234:5678:9abc:def0 54322 typ host generation 0 ufrag Ab12 network-id 2';
const HOST_MDNS =
  'candidate:3 1 udp 2122260223 1f4712db-ea17-4bcf-a596-105139dfd8bf.local 54323 typ host generation 0 ufrag Ab12';
const HOST_TCP =
  'candidate:4 1 tcp 1518280447 192.168.1.23 9 typ host tcptype active generation 0 ufrag Ab12';
const SRFLX =
  'candidate:842163049 1 udp 1686052607 203.0.113.7 61000 typ srflx raddr 192.168.1.23 rport 54321 generation 0 ufrag Ab12 network-id 1 network-cost 10';
const SRFLX_SANITIZED =
  'candidate:842163049 1 udp 1686052607 203.0.113.7 61000 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag Ab12 network-id 1 network-cost 10';
const SRFLX_CGNAT =
  'candidate:5 1 udp 1686052607 100.72.10.4 61001 typ srflx raddr 10.0.0.5 rport 5000 generation 0 ufrag Ab12';
const RELAY =
  'candidate:6 1 udp 41885439 198.51.100.20 3478 typ relay raddr 203.0.113.7 rport 61000 generation 0 ufrag Ab12';
const RELAY_PRIVATE =
  'candidate:7 1 udp 41885439 10.1.2.3 3478 typ relay raddr 203.0.113.7 rport 61000 generation 0 ufrag Ab12';

function chromiumSdp(candidates: string[], connection: string, port: number) {
  return [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS stream',
    `m=audio ${port} UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126`,
    `c=${connection}`,
    'a=rtcp:9 IN IP4 0.0.0.0',
    ...candidates.map((c) => `a=${c}`),
    'a=ice-ufrag:Ab12',
    'a=ice-pwd:cdefghijklmnopqrstuvwx12',
    'a=ice-options:trickle',
    FINGERPRINT,
    'a=setup:actpass',
    'a=mid:0',
    'a=sendrecv',
    'a=rtcp-mux',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=end-of-candidates',
    '',
  ].join('\r\n');
}

describe('classifyIceAddress', () => {
  it.each([
    ['10.0.0.1', 'private'],
    ['10.255.255.255', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.254', 'private'],
    ['192.168.0.1', 'private'],
    ['169.254.10.20', 'link-local'],
    ['100.64.0.1', 'cgnat'],
    ['100.127.255.254', 'cgnat'],
    ['127.0.0.1', 'loopback'],
    ['0.0.0.0', 'unspecified'],
    ['192.0.0.4', 'reserved'],
    ['224.0.0.251', 'multicast'],
    ['255.255.255.255', 'reserved'],
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['fe80::1', 'link-local'],
    ['FE80::abcd:1%wlan0', 'link-local'],
    ['febf::1', 'link-local'],
    ['fc00::1', 'ula'],
    ['fd12:3456:789a::1', 'ula'],
    ['ff02::1', 'multicast'],
    ['::ffff:192.168.1.1', 'private'],
    ['::ffff:c0a8:0101', 'private'],
    ['::ffff:8.8.8.8', 'public'],
    ['64:ff9b::10.0.0.1', 'private'],
    ['64:ff9b::8.8.4.4', 'public'],
    ['64:ff9b:1::1', 'private'],
    ['[fe80::1]', 'link-local'],
    ['1f4712db-ea17-4bcf-a596-105139dfd8bf.local', 'mdns'],
    ['host.example', 'hostname'],
    ['', 'invalid'],
    ['999.1.1.1', 'hostname'],
    ['1::2::3', 'invalid'],
  ])('%s → %s', (address, expected) => {
    expect(classifyIceAddress(address)).toBe(expected);
  });

  it.each([
    '8.8.8.8',
    '203.0.113.7',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '169.253.1.1',
    '11.0.0.1',
    '2a02:1810:4d07:5a00::1',
    '2001:db8::1',
    'fec0::1'.replace('fec0', '2600'),
  ])('%s is public', (address) => {
    expect(classifyIceAddress(address)).toBe('public');
    expect(isBlockedIceAddress(address)).toBe(false);
  });

  it('treats fec0::/10 site-local as private', () => {
    expect(classifyIceAddress('fec0::1')).toBe('private');
  });
});

describe('parseIceCandidateLine', () => {
  it('parses a srflx candidate with raddr/rport', () => {
    const parsed = parseIceCandidateLine(SRFLX);
    expect(parsed).toMatchObject({
      prefix: '',
      foundation: '842163049',
      component: '1',
      protocol: 'udp',
      address: '203.0.113.7',
      port: '61000',
      type: 'srflx',
      relatedAddress: '192.168.1.23',
      relatedPort: '54321',
    });
  });

  it('accepts the SDP a= prefix', () => {
    expect(parseIceCandidateLine(`a=${HOST_LAN}`)?.prefix).toBe('a=');
  });

  it.each(['', 'candidate:', 'candidate:1 1 udp 1 1.2.3.4 5 host', 'foo'])(
    'rejects malformed %j',
    (line) => {
      expect(parseIceCandidateLine(line)).toBeNull();
    }
  );
});

describe('filterLocalIceCandidate', () => {
  const hide: WebRtcPrivacyMode = 'hide-local';

  it.each([HOST_LAN, HOST_V6_GLOBAL, HOST_MDNS, HOST_TCP])(
    'drops every host candidate: %s',
    (line) => {
      expect(filterLocalIceCandidate(line, hide)).toMatchObject({
        action: 'drop',
        reason: 'host',
      });
    }
  );

  it('drops srflx/relay candidates that carry a non-public address', () => {
    expect(filterLocalIceCandidate(SRFLX_CGNAT, hide)).toMatchObject({
      action: 'drop',
      reason: 'cgnat',
    });
    expect(filterLocalIceCandidate(RELAY_PRIVATE, hide)).toMatchObject({
      action: 'drop',
      reason: 'private',
    });
  });

  it('keeps public srflx but zeroes the LAN address in raddr/rport', () => {
    expect(filterLocalIceCandidate(SRFLX, hide)).toEqual({
      action: 'rewrite',
      candidate: SRFLX_SANITIZED,
    });
    expect(filterLocalIceCandidate(SRFLX_SANITIZED, hide)).toEqual({
      action: 'keep',
    });
  });

  it('zeroes a relay raddr too and uses :: for IPv6', () => {
    const relay = filterLocalIceCandidate(RELAY, hide);
    expect(relay.action).toBe('rewrite');
    expect(relay.action === 'rewrite' && relay.candidate).toContain(
      'typ relay raddr 0.0.0.0 rport 0'
    );
    // A relay address belongs to the TURN server, so IPv6 is fine there.
    const v6 =
      'candidate:9 1 udp 41885439 2a02:1810::7 61000 typ relay raddr fe80::1 rport 1 generation 0';
    const out = filterLocalIceCandidate(v6, hide);
    expect(out.action === 'rewrite' && out.candidate).toBe(
      'candidate:9 1 udp 41885439 2a02:1810::7 61000 typ relay raddr :: rport 0 generation 0'
    );
  });

  it('drops reflexive IPv6 candidates (the phone own address without NAT)', () => {
    for (const type of ['srflx', 'prflx']) {
      const line = `candidate:9 1 udp 1686052607 2a02:1810:4d07:5a00:1234:5678:9abc:def0 61000 typ ${type} raddr :: rport 0 generation 0`;
      expect(filterLocalIceCandidate(line, hide)).toEqual({
        action: 'drop',
        reason: 'ipv6',
      });
    }
  });

  it('keeps a public srflx without related address untouched', () => {
    const line =
      'candidate:1 1 udp 1686052607 203.0.113.9 61000 typ srflx generation 0';
    expect(filterLocalIceCandidate(line, hide)).toEqual({ action: 'keep' });
  });

  it('keeps the empty end-of-candidates marker in every mode', () => {
    expect(filterLocalIceCandidate('', hide)).toEqual({ action: 'keep' });
    expect(filterLocalIceCandidate('', 'block-all')).toEqual({
      action: 'keep',
    });
  });

  it('drops everything in block-all (Reticulum only) mode', () => {
    for (const line of [SRFLX, SRFLX_SANITIZED, RELAY, HOST_LAN]) {
      expect(filterLocalIceCandidate(line, 'block-all').action).toBe('drop');
    }
  });

  it('fails closed on garbage', () => {
    expect(filterLocalIceCandidate('candidate:x', hide)).toMatchObject({
      action: 'drop',
      reason: 'unparseable',
    });
  });

  it('preserves the a= prefix when rewriting an SDP line', () => {
    const out = filterLocalIceCandidate(`a=${SRFLX}`, hide);
    expect(out.action === 'rewrite' && out.candidate).toBe(
      `a=${SRFLX_SANITIZED}`
    );
  });
});

describe('sanitizeLocalSdp', () => {
  it('returns the very same string when nothing needs to change', () => {
    const sdp = chromiumSdp([], 'IN IP4 0.0.0.0', 9);
    expect(sanitizeLocalSdp(sdp, 'hide-local')).toBe(sdp);
    const withPublic = chromiumSdp(
      [SRFLX_SANITIZED],
      'IN IP4 203.0.113.7',
      61000
    );
    expect(sanitizeLocalSdp(withPublic, 'hide-local')).toBe(withPublic);
  });

  it('removes host/private candidate lines and keeps everything else', () => {
    const sdp = chromiumSdp(
      [HOST_LAN, HOST_V6_GLOBAL, HOST_MDNS, HOST_TCP, SRFLX, SRFLX_CGNAT],
      'IN IP4 203.0.113.7',
      61000
    );
    const out = sanitizeLocalSdp(sdp, 'hide-local');
    expect(out).not.toContain('192.168.1.23');
    expect(out).not.toContain('2a02:1810:4d07');
    expect(out).not.toContain('.local');
    expect(out).not.toContain('100.72.10.4');
    expect(out).not.toContain('10.0.0.5');
    expect(out).toContain(`a=${SRFLX_SANITIZED}\r\n`);
    // Default address is a kept (public srflx) candidate: left alone.
    expect(out).toContain('c=IN IP4 203.0.113.7\r\n');
    expect(out).toContain(
      'm=audio 61000 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126\r\n'
    );
    // Everything that is not a candidate stays byte-identical.
    for (const keep of [
      FINGERPRINT,
      'a=ice-ufrag:Ab12',
      'a=ice-pwd:cdefghijklmnopqrstuvwx12',
      'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
      'a=rtcp:9 IN IP4 0.0.0.0',
      'a=end-of-candidates',
      'a=fmtp:111 minptime=10;useinbandfec=1',
    ]) {
      expect(out).toContain(`${keep}\r\n`);
    }
    expect(out.endsWith('\r\n')).toBe(true);
    expect(out.split('\r\n').length).toBe(sdp.split('\r\n').length - 5);
  });

  it('hides a host default address in c= and the m= port', () => {
    const sdp = chromiumSdp([HOST_LAN], 'IN IP4 192.168.1.23', 54321);
    const out = sanitizeLocalSdp(sdp, 'hide-local');
    expect(out).toContain('c=IN IP4 0.0.0.0\r\n');
    expect(out).toContain('m=audio 9 UDP/TLS/RTP/SAVPF 111');
    expect(out).not.toContain('192.168.1.23');
    expect(out).not.toContain('54321');
  });

  it('hides a global IPv6 host address used as the default address', () => {
    const sdp = chromiumSdp(
      [HOST_V6_GLOBAL],
      'IN IP6 2a02:1810:4d07:5a00:1234:5678:9abc:def0',
      54322
    );
    const out = sanitizeLocalSdp(sdp, 'hide-local');
    expect(out).toContain('c=IN IP4 0.0.0.0\r\n');
    expect(out).toContain('m=audio 9 ');
    expect(out).not.toContain('2a02:1810');
  });

  it('rewrites an a=rtcp line that names a hidden address', () => {
    const sdp = chromiumSdp([HOST_LAN], 'IN IP4 0.0.0.0', 9).replace(
      'a=rtcp:9 IN IP4 0.0.0.0',
      'a=rtcp:54321 IN IP4 192.168.1.23'
    );
    const out = sanitizeLocalSdp(sdp, 'hide-local');
    expect(out).toContain('a=rtcp:9 IN IP4 0.0.0.0\r\n');
    expect(out).not.toContain('192.168.1.23');
  });

  it('never resets a rejected m= line (port 0)', () => {
    const sdp = chromiumSdp([HOST_LAN], 'IN IP4 192.168.1.23', 0);
    const out = sanitizeLocalSdp(sdp, 'hide-local');
    expect(out).toContain('m=audio 0 UDP');
  });

  it('handles several m= sections independently', () => {
    const sdp = [
      'v=0',
      'o=- 1 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=audio 61000 UDP/TLS/RTP/SAVPF 111',
      'c=IN IP4 203.0.113.7',
      `a=${SRFLX}`,
      'a=mid:0',
      'm=application 50000 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 192.168.1.23',
      `a=${HOST_LAN}`,
      'a=mid:1',
      '',
    ].join('\r\n');
    const out = sanitizeLocalSdp(sdp, 'hide-local');
    expect(out).toContain('m=audio 61000 ');
    expect(out).toContain('c=IN IP4 203.0.113.7');
    expect(out).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
    expect(out).not.toContain('192.168.1.23');
  });

  it('strips every candidate in block-all mode', () => {
    const sdp = chromiumSdp(
      [SRFLX, RELAY, HOST_LAN],
      'IN IP4 198.51.100.20',
      3478
    );
    const out = sanitizeLocalSdp(sdp, 'block-all');
    expect(out).not.toMatch(/a=candidate:/);
    expect(out).toContain('c=IN IP4 0.0.0.0');
    expect(out).toContain('m=audio 9 ');
    expect(out).toContain(FINGERPRINT);
    expect(out).toContain('a=end-of-candidates');
  });

  it('keeps LF-only SDP in LF form', () => {
    const sdp = chromiumSdp([HOST_LAN], 'IN IP4 0.0.0.0', 9).replace(
      /\r\n/g,
      '\n'
    );
    const out = sanitizeLocalSdp(sdp, 'hide-local');
    expect(out).not.toContain('\r');
    expect(out).not.toContain('192.168.1.23');
  });

  it('tolerates empty or non-string input', () => {
    expect(sanitizeLocalSdp('', 'hide-local')).toBe('');
    expect(sanitizeLocalSdp(undefined as unknown as string, 'hide-local')).toBe(
      undefined
    );
  });
});

// What an unmodified Hub signals (it filters nothing).
const HUB_HOST_LAN =
  'candidate:11 1 udp 2122260223 192.168.1.50 50000 typ host generation 0 ufrag Hub1 network-id 1';
const HUB_HOST_V6 =
  'candidate:12 1 udp 2122197247 2001:db8:7:1::50 50001 typ host generation 0 ufrag Hub1 network-id 2';
const HUB_HOST_MDNS =
  'candidate:13 1 udp 2122260223 7f9c2ba4-1111-4bcf-a596-105139dfd8bf.local 50002 typ host generation 0 ufrag Hub1';
const HUB_SRFLX_CGNAT =
  'candidate:14 1 udp 1686052607 100.80.1.2 50003 typ srflx raddr 10.0.0.9 rport 50003 generation 0 ufrag Hub1';
const HUB_SRFLX =
  'candidate:15 1 udp 1686052607 198.51.100.77 50004 typ srflx raddr 192.168.1.50 rport 50000 generation 0 ufrag Hub1';
const HUB_SRFLX_V6 =
  'candidate:16 1 udp 1686052607 2001:db8:7:1::50 50005 typ srflx raddr 2001:db8:7:1::50 rport 50001 generation 0 ufrag Hub1';
const HUB_RELAY =
  'candidate:17 1 udp 41885439 198.51.100.200 3478 typ relay raddr 198.51.100.77 rport 50004 generation 0 ufrag Hub1';
const HUB_HOST_PUBLIC =
  'candidate:18 1 tcp 1518280447 203.0.113.90 443 typ host tcptype passive generation 0 ufrag Hub1';

describe('filterRemoteIceCandidate', () => {
  const hide: WebRtcPrivacyMode = 'hide-local';

  it('keeps only public IPv4 peer candidates (any type)', () => {
    for (const line of [
      HUB_SRFLX,
      HUB_RELAY,
      HUB_HOST_PUBLIC,
      `a=${HUB_SRFLX}`,
    ]) {
      expect(filterRemoteIceCandidate(line, hide)).toEqual({ action: 'keep' });
    }
  });

  it.each([
    [HUB_HOST_LAN, 'private'],
    [HUB_HOST_V6, 'ipv6'],
    [HUB_SRFLX_V6, 'ipv6'],
    [HUB_HOST_MDNS, 'mdns'],
    [HUB_SRFLX_CGNAT, 'cgnat'],
    ['candidate:19 1 udp 1 192.0.0.4 1 typ host generation 0', 'reserved'],
    ['candidate:20 1 udp 1 turn.example 1 typ relay generation 0', 'hostname'],
    ['candidate:x', 'unparseable'],
  ])('drops %s (%s)', (line, reason) => {
    expect(filterRemoteIceCandidate(line, hide)).toEqual({
      action: 'drop',
      reason,
    });
  });

  it('keeps end-of-candidates in every mode and drops all else in block-all', () => {
    expect(filterRemoteIceCandidate('', hide)).toEqual({ action: 'keep' });
    expect(filterRemoteIceCandidate('', 'block-all')).toEqual({
      action: 'keep',
    });
    expect(filterRemoteIceCandidate(HUB_SRFLX, 'block-all').action).toBe(
      'drop'
    );
  });
});

describe('sanitizeRemoteSdp', () => {
  const hubOffer = chromiumSdp(
    [HUB_HOST_LAN, HUB_HOST_V6, HUB_HOST_MDNS, HUB_SRFLX_CGNAT, HUB_SRFLX],
    'IN IP4 198.51.100.77',
    50004
  );

  it('removes the peer candidates GO must not check, keeps the rest', () => {
    const out = sanitizeRemoteSdp(hubOffer, 'hide-local');
    // A kept srflx may still name it as raddr, which ICE never uses.
    expect(out).not.toContain('192.168.1.50 50000');
    expect(out).not.toContain('2001:db8');
    expect(out).not.toContain('.local');
    expect(out).not.toContain('100.80.1.2');
    expect(out).toContain(`a=${HUB_SRFLX}\r\n`);
    for (const keep of [
      FINGERPRINT,
      'a=ice-ufrag:Ab12',
      'a=end-of-candidates',
      'c=IN IP4 198.51.100.77',
      'm=audio 50004 ',
    ]) {
      expect(out).toContain(keep);
    }
    expect(out.split('\r\n').length).toBe(hubOffer.split('\r\n').length - 4);
  });

  it('returns the very same string when nothing needs to change', () => {
    const clean = chromiumSdp([HUB_SRFLX], 'IN IP4 198.51.100.77', 50004);
    expect(sanitizeRemoteSdp(clean, 'hide-local')).toBe(clean);
  });

  it('strips every peer candidate in block-all mode', () => {
    expect(sanitizeRemoteSdp(hubOffer, 'block-all')).not.toMatch(
      /a=candidate:/
    );
  });
});

// ── Wrapper over a fake RTCPeerConnection ──────────────────────────────────

type FakeCandidate = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
  type?: string;
  toJSON: () => RTCIceCandidateInit;
};

function fakeCandidate(line: string): FakeCandidate {
  return {
    candidate: line,
    sdpMid: '0',
    sdpMLineIndex: 0,
    usernameFragment: 'Ab12',
    type: parseIceCandidateLine(line)?.type,
    toJSON() {
      return {
        candidate: line,
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'Ab12',
      };
    },
  };
}

class FakeRTCPeerConnection extends EventTarget {
  static instances: FakeRTCPeerConnection[] = [];
  static generateCertificate = vi.fn(async () => 'cert');
  config: RTCConfiguration | undefined;
  configs: Array<RTCConfiguration | undefined> = [];
  local: { type: RTCSdpType; sdp: string } | null = null;
  nextSdp = '';
  private handler: ((e: Event) => void) | null = null;
  private handlerWrapper = (e: Event) => this.handler?.call(this, e);
  private handlerRegistered = false;

  constructor(config?: RTCConfiguration) {
    super();
    this.config = config;
    FakeRTCPeerConnection.instances.push(this);
  }

  // Event handler attribute semantics: registered at first non-null set.
  get onicecandidate() {
    return this.handler;
  }

  set onicecandidate(handler: ((e: Event) => void) | null) {
    this.handler = handler;
    if (handler && !this.handlerRegistered) {
      this.handlerRegistered = true;
      this.addEventListener('icecandidate', this.handlerWrapper);
    }
  }

  get localDescription() {
    return this.local;
  }

  get currentLocalDescription() {
    return this.local;
  }

  get pendingLocalDescription() {
    return null;
  }

  async createOffer() {
    return { type: 'offer' as const, sdp: this.nextSdp };
  }

  async createAnswer() {
    return { type: 'answer' as const, sdp: this.nextSdp };
  }

  async setLocalDescription(d: { type: RTCSdpType; sdp: string }) {
    this.local = { type: d.type, sdp: d.sdp };
  }

  setConfiguration(config: RTCConfiguration) {
    this.configs.push(config);
  }

  added: unknown[] = [];
  addIceCandidate(candidate?: unknown, success?: () => void) {
    this.added.push(candidate);
    if (typeof success === 'function') success();
    return Promise.resolve();
  }

  remote: unknown[] = [];
  setRemoteDescription(description: unknown) {
    this.remote.push(description);
    return Promise.resolve();
  }

  fire(line: string | null) {
    const event = new Event('icecandidate');
    Object.defineProperty(event, 'candidate', {
      value: line === null ? null : fakeCandidate(line),
    });
    this.dispatchEvent(event);
  }
}

describe('installWebRtcPrivacyGuard', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let target: Record<string, any>;
  let mode: WebRtcPrivacyMode;

  beforeEach(() => {
    FakeRTCPeerConnection.instances = [];
    mode = 'hide-local';
    target = {
      RTCPeerConnection: FakeRTCPeerConnection,
      webkitRTCPeerConnection: FakeRTCPeerConnection,
    };
  });

  afterEach(() => {
    __uninstallWebRtcPrivacyGuardForTests();
  });

  const install = () =>
    installWebRtcPrivacyGuard({ force: true, target, getMode: () => mode });

  it('is a no-op outside GO unless forced', () => {
    expect(installWebRtcPrivacyGuard({ target })).toBe(false);
    expect(target.RTCPeerConnection).toBe(FakeRTCPeerConnection);
  });

  it('wraps once (idempotent) and aliases webkitRTCPeerConnection', () => {
    expect(install()).toBe(true);
    const wrapped = target.RTCPeerConnection;
    expect(wrapped).not.toBe(FakeRTCPeerConnection);
    expect(install()).toBe(true);
    expect(target.RTCPeerConnection).toBe(wrapped);
    expect(target.webkitRTCPeerConnection).toBe(wrapped);
    expect(isWebRtcPrivacyGuardInstalled(target as never)).toBe(true);
    const Ctor = wrapped as typeof FakeRTCPeerConnection;
    const pc = new Ctor({ iceServers: [] });
    expect(pc).toBeInstanceOf(FakeRTCPeerConnection);
    expect((Ctor as unknown as { name: string }).name).toBe(
      'RTCPeerConnection'
    );
    expect(
      (Ctor as unknown as typeof FakeRTCPeerConnection).generateCertificate
    ).toBe(FakeRTCPeerConnection.generateCertificate);
  });

  it('suppresses blocked candidates for onicecandidate and listeners, passes null', () => {
    install();
    const Ctor = target.RTCPeerConnection as typeof FakeRTCPeerConnection;
    const pc = new Ctor({ iceServers: [] });
    const viaAttribute: Array<RTCIceCandidateInit | null> = [];
    const viaListener: Array<RTCIceCandidateInit | null> = [];
    pc.onicecandidate = (e: Event) => {
      const c = (e as Event & { candidate: FakeCandidate | null }).candidate;
      viaAttribute.push(c ? c.toJSON() : null);
    };
    pc.addEventListener('icecandidate', (e) => {
      const c = (e as Event & { candidate: FakeCandidate | null }).candidate;
      viaListener.push(c ? c.toJSON() : null);
    });

    pc.fire(HOST_LAN);
    pc.fire(HOST_MDNS);
    pc.fire(SRFLX_CGNAT);
    pc.fire(SRFLX);
    pc.fire(SRFLX_SANITIZED);
    pc.fire(null);

    for (const seen of [viaAttribute, viaListener]) {
      expect(seen).toEqual([
        {
          candidate: SRFLX_SANITIZED,
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: 'Ab12',
        },
        {
          candidate: SRFLX_SANITIZED,
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: 'Ab12',
        },
        null,
      ]);
    }
    expect(getWebRtcPrivacyStats()).toMatchObject({
      suppressedCandidates: 3,
      rewrittenCandidates: 1,
    });
  });

  it('gives a rewritten candidate the fields the transports read', () => {
    install();
    const Ctor = target.RTCPeerConnection as typeof FakeRTCPeerConnection;
    const pc = new Ctor();
    let seen: Record<string, unknown> | null = null;
    pc.onicecandidate = (e: Event) => {
      seen = (e as Event & { candidate: Record<string, unknown> }).candidate;
    };
    pc.fire(SRFLX);
    expect(seen).toMatchObject({
      type: 'srflx',
      protocol: 'udp',
      address: '203.0.113.7',
      relatedAddress: '0.0.0.0',
      candidate: SRFLX_SANITIZED,
    });
  });

  it('filters local descriptions and createOffer/createAnswer results', async () => {
    install();
    const Ctor = target.RTCPeerConnection as typeof FakeRTCPeerConnection;
    const pc = new Ctor();
    const leaky = chromiumSdp([HOST_LAN, SRFLX], 'IN IP4 203.0.113.7', 61000);
    pc.nextSdp = leaky;
    const offer = (await pc.createOffer()) as RTCSessionDescriptionInit;
    expect(offer.type).toBe('offer');
    expect(offer.sdp).not.toContain('192.168.1.23');
    expect(offer.sdp).toContain(FINGERPRINT);
    const answer = (await pc.createAnswer()) as RTCSessionDescriptionInit;
    expect(answer.sdp).not.toContain('192.168.1.23');

    // Chromium adds gathered candidates to localDescription afterwards.
    pc.local = { type: 'offer', sdp: leaky };
    const local = pc.localDescription as RTCSessionDescriptionInit & {
      toJSON: () => RTCSessionDescriptionInit;
    };
    expect(local.sdp).not.toContain('192.168.1.23');
    expect(local.toJSON()).toEqual({ type: 'offer', sdp: local.sdp });
    expect(
      (pc.currentLocalDescription as RTCSessionDescriptionInit).sdp
    ).not.toContain('192.168.1.23');
    expect(pc.pendingLocalDescription).toBeNull();

    // Clean descriptions come back as the very same object.
    const clean = {
      type: 'offer' as const,
      sdp: chromiumSdp([], 'IN IP4 0.0.0.0', 9),
    };
    pc.local = clean;
    expect(pc.localDescription).toBe(clean);
  });

  it('supports the legacy callback createOffer form', async () => {
    install();
    const Ctor = target.RTCPeerConnection as typeof FakeRTCPeerConnection;
    const pc = new Ctor();
    pc.nextSdp = chromiumSdp([HOST_LAN], 'IN IP4 192.168.1.23', 54321);
    // The fake ignores callbacks, so make it call them like old Chromium.
    const native = FakeRTCPeerConnection.prototype.createOffer;
    FakeRTCPeerConnection.prototype.createOffer = function (
      this: FakeRTCPeerConnection,
      success?: unknown
    ) {
      if (typeof success === 'function') {
        success({ type: 'offer', sdp: this.nextSdp });
        return Promise.resolve(undefined);
      }
      return native.call(this);
    } as typeof native;
    try {
      const got = await new Promise<RTCSessionDescriptionInit>((resolve) => {
        (pc.createOffer as unknown as (s: (d: unknown) => void) => void)((d) =>
          resolve(d as RTCSessionDescriptionInit)
        );
      });
      expect(got.sdp).not.toContain('192.168.1.23');
    } finally {
      FakeRTCPeerConnection.prototype.createOffer = native;
    }
  });

  it('Reticulum-only: no ICE servers, relay policy, no candidates at all', () => {
    install();
    mode = 'block-all';
    const Ctor = target.RTCPeerConnection as typeof FakeRTCPeerConnection;
    const pc = new Ctor({
      iceServers: [{ urls: 'stun:stun.example:3478' }],
      bundlePolicy: 'max-bundle',
    });
    expect(pc.config).toEqual({
      iceServers: [],
      iceTransportPolicy: 'relay',
      bundlePolicy: 'max-bundle',
    });
    pc.setConfiguration({ iceServers: [{ urls: 'stun:x' }] });
    expect(pc.configs[0]).toEqual({
      iceServers: [],
      iceTransportPolicy: 'relay',
    });
    const seen: unknown[] = [];
    pc.onicecandidate = (e: Event) =>
      seen.push((e as Event & { candidate: unknown }).candidate);
    pc.fire(SRFLX_SANITIZED);
    pc.fire(RELAY);
    pc.fire(null);
    expect(seen).toEqual([null]);
  });

  it('passes configuration through untouched in hide-local mode', () => {
    install();
    const Ctor = target.RTCPeerConnection as typeof FakeRTCPeerConnection;
    const config = { iceServers: [{ urls: 'stun:stun.example:3478' }] };
    const pc = new Ctor(config);
    expect(pc.config).toBe(config);
  });

  it('follows the GO call transport preference by default', () => {
    __resetCallTransportPreferenceForTests();
    localStorage.removeItem('go.calls.transport');
    expect(getWebRtcPrivacyMode()).toBe('hide-local');
    setCallTransportPreference('reticulum');
    expect(getWebRtcPrivacyMode()).toBe('block-all');
    setCallTransportPreference('webrtc');
    expect(getWebRtcPrivacyMode()).toBe('hide-local');
    localStorage.removeItem('go.calls.transport');
    __resetCallTransportPreferenceForTests();
  });

  it('applies only public IPv4 peer candidates; end-of-candidates passes', async () => {
    install();
    const Ctor = target.RTCPeerConnection as typeof FakeRTCPeerConnection;
    const pc = new Ctor();
    const add = (line: string | null) =>
      pc.addIceCandidate(
        line === null
          ? null
          : { candidate: line, sdpMid: '0', sdpMLineIndex: 0 }
      );
    for (const line of [
      HUB_HOST_LAN,
      HUB_HOST_V6,
      HUB_HOST_MDNS,
      HUB_SRFLX_CGNAT,
      HUB_SRFLX_V6,
      HUB_SRFLX,
      HUB_RELAY,
      '',
      null,
    ]) {
      await expect(add(line)).resolves.toBeUndefined();
    }
    expect(pc.added).toEqual([
      { candidate: HUB_SRFLX, sdpMid: '0', sdpMLineIndex: 0 },
      { candidate: HUB_RELAY, sdpMid: '0', sdpMLineIndex: 0 },
      { candidate: '', sdpMid: '0', sdpMLineIndex: 0 },
      null,
    ]);
    expect(getWebRtcPrivacyStats().droppedRemoteCandidates).toBe(5);

    // Legacy callback form: a dropped candidate still reports success.
    const ok = vi.fn();
    await (
      pc.addIceCandidate as unknown as (
        c: RTCIceCandidateInit,
        s: () => void,
        f: () => void
      ) => Promise<void>
    )({ candidate: HUB_HOST_LAN }, ok, vi.fn());
    await Promise.resolve();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(pc.added).toHaveLength(4);
  });

  it('removes peer candidates GO must not check from remote descriptions', async () => {
    install();
    const Ctor = target.RTCPeerConnection as typeof FakeRTCPeerConnection;
    const pc = new Ctor();
    const leaky = chromiumSdp(
      [HUB_HOST_LAN, HUB_HOST_V6, HUB_SRFLX],
      'IN IP4 198.51.100.77',
      50004
    );
    await pc.setRemoteDescription({ type: 'offer', sdp: leaky });
    const applied = pc.remote[0] as RTCSessionDescriptionInit;
    expect(applied.type).toBe('offer');
    expect(applied.sdp).not.toContain('192.168.1.50 50000');
    expect(applied.sdp).not.toContain('2001:db8');
    expect(applied.sdp).toContain(HUB_SRFLX);
    expect(applied.sdp).toContain(FINGERPRINT);
    // Clean descriptions (and rollbacks) are passed through as given.
    const clean = {
      type: 'answer' as const,
      sdp: chromiumSdp([], 'IN IP4 0.0.0.0', 9),
    };
    await pc.setRemoteDescription(clean);
    expect(pc.remote[1]).toBe(clean);
    const rollback = { type: 'rollback' as const };
    await pc.setRemoteDescription(rollback);
    expect(pc.remote[2]).toBe(rollback);
  });

  it('fixes the mode per connection when it is created', () => {
    install();
    const Ctor = target.RTCPeerConnection as typeof FakeRTCPeerConnection;
    const config = { iceServers: [{ urls: 'stun:stun.example:3478' }] };
    const live = new Ctor(config);
    const seen: unknown[] = [];
    live.onicecandidate = (e: Event) =>
      seen.push(
        (e as Event & { candidate: FakeCandidate | null }).candidate?.toJSON()
          .candidate
      );

    mode = 'block-all'; // "Private calls" chosen during the call
    live.fire(SRFLX);
    expect(seen).toEqual([SRFLX_SANITIZED]); // the live leg keeps working
    live.setConfiguration(config);
    expect(live.configs[0]).toBe(config); // ICE-server refresh not broken

    const next = new Ctor(config);
    expect(next.config).toEqual({
      iceServers: [],
      iceTransportPolicy: 'relay',
    });
  });
});

// ── End to end: the real (shared, unmodified) DM transport over the guard ──

const GO_HOST_LAN =
  'candidate:1 1 udp 2122260223 192.168.1.23 41234 typ host generation 0 ufrag abcd network-id 1';
const GO_HOST_V6 =
  'candidate:2 1 udp 2122194687 2a02:1810:abcd::5 41235 typ host generation 0 ufrag abcd network-id 2';
const GO_HOST_CGNAT =
  'candidate:3 1 udp 2122129151 100.72.10.4 41236 typ host generation 0 ufrag abcd network-id 3';
const GO_SRFLX =
  'candidate:4 1 udp 1686052607 203.0.113.7 41234 typ srflx raddr 192.168.1.23 rport 41234 generation 0 ufrag abcd network-id 1';
const GO_SRFLX_V6 =
  'candidate:5 1 udp 1686052607 2a02:1810:abcd::5 41235 typ srflx raddr 2a02:1810:abcd::5 rport 41235 generation 0 ufrag abcd network-id 2';
const GO_LOCAL_LINES = [
  GO_HOST_LAN,
  GO_HOST_V6,
  GO_HOST_CGNAT,
  GO_SRFLX,
  GO_SRFLX_V6,
];
const GO_PRIVATE_FRAGMENTS = [
  '192.168.1.23',
  '2a02:1810',
  '100.72.10.4',
  'typ host',
];

/** Enough of Chromium's RTCPeerConnection for DirectVoiceWebRtcTransport. */
class ChromiumLikePC extends EventTarget {
  static instances: ChromiumLikePC[] = [];
  connectionState = 'new';
  iceConnectionState = 'new';
  iceGatheringState = 'new';
  signalingState = 'stable';
  ontrack: unknown = null;
  oniceconnectionstatechange: unknown = null;
  onconnectionstatechange: unknown = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  appliedRemoteSdp: string[] = [];
  addedRemoteCandidates: Array<RTCIceCandidateInit | null | undefined> = [];
  private local: { type: RTCSdpType; sdp: string } | null = null;
  private handler: ((e: Event) => void) | null = null;
  private registered = false;

  constructor(public config?: RTCConfiguration) {
    super();
    ChromiumLikePC.instances.push(this);
  }

  get onicecandidate() {
    return this.handler;
  }

  set onicecandidate(handler: ((e: Event) => void) | null) {
    this.handler = handler;
    if (handler && !this.registered) {
      this.registered = true;
      this.addEventListener('icecandidate', (e) => this.handler?.call(this, e));
    }
  }

  addTrack() {
    return {};
  }

  getSenders() {
    return [];
  }

  getConfiguration() {
    return this.config ?? {};
  }

  async getStats() {
    return new Map();
  }

  close() {
    this.signalingState = 'closed';
  }

  async createOffer() {
    return {
      type: 'offer' as const,
      sdp: chromiumSdp([], 'IN IP4 0.0.0.0', 9),
    };
  }

  async createAnswer() {
    return {
      type: 'answer' as const,
      sdp: chromiumSdp([], 'IN IP4 0.0.0.0', 9),
    };
  }

  async setLocalDescription(d: { type: RTCSdpType; sdp: string }) {
    // Chromium with mic permission: raw host addresses, the LAN address in
    // srflx raddr, a host default address, all also in localDescription.
    this.local = {
      type: d.type,
      sdp: chromiumSdp(GO_LOCAL_LINES, 'IN IP4 192.168.1.23', 41234),
    };
    for (const line of GO_LOCAL_LINES) this.fire(line);
    this.fire(null);
  }

  get localDescription() {
    const local = this.local;
    return local ? { ...local, toJSON: () => ({ ...local }) } : null;
  }

  get currentLocalDescription() {
    return this.localDescription;
  }

  get pendingLocalDescription() {
    return null;
  }

  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.appliedRemoteSdp.push(d.sdp ?? '');
    this.remoteDescription = d;
  }

  async addIceCandidate(candidate?: RTCIceCandidateInit | null) {
    this.addedRemoteCandidates.push(candidate);
  }

  fire(line: string | null) {
    const event = new Event('icecandidate');
    Object.defineProperty(event, 'candidate', {
      value: line === null ? null : fakeCandidate(line),
    });
    this.dispatchEvent(event);
  }
}

describe('guard + real DirectVoiceWebRtcTransport (end to end)', () => {
  beforeEach(() => {
    ChromiumLikePC.instances = [];
    vi.stubGlobal('RTCPeerConnection', ChromiumLikePC);
    expect(
      installWebRtcPrivacyGuard({ force: true, getMode: () => 'hide-local' })
    ).toBe(true);
  });

  afterEach(() => {
    __uninstallWebRtcPrivacyGuardForTests();
    vi.unstubAllGlobals();
  });

  const makeTransport = (offerer: boolean, signals: DirectVoiceRtcSignal[]) =>
    new DirectVoiceWebRtcTransport({
      offerer,
      getIceServers: async () => [{ urls: 'stun:stun.example:3478' }],
      localStream: {
        getAudioTracks: () => [{ kind: 'audio' }],
        getTracks: () => [],
      } as unknown as MediaStream,
      onSignal: (signal) => signals.push(signal),
      onRemoteStream: () => {},
    });

  const expectNothingPrivate = (signals: DirectVoiceRtcSignal[]) => {
    const blob = JSON.stringify(signals);
    for (const fragment of GO_PRIVATE_FRAGMENTS) {
      expect(blob).not.toContain(fragment);
    }
    expect(blob).toContain('203.0.113.7');
    expect(blob).toContain('raddr 0.0.0.0 rport 0');
  };

  it('offerer: GO signals only its public IPv4 srflx, raddr zeroed', async () => {
    const signals: DirectVoiceRtcSignal[] = [];
    const transport = makeTransport(true, signals);
    await transport.start();
    expect(ChromiumLikePC.instances).toHaveLength(1);
    expect(signals.map((s) => s.kind)).toEqual([
      'description',
      'ice-candidates',
    ]);
    expectNothingPrivate(signals);
    const description = signals[0] as Extract<
      DirectVoiceRtcSignal,
      { kind: 'description' }
    >;
    expect(description.description.sdp).toContain('c=IN IP4 0.0.0.0');
    transport.close();
  });

  it('answerer: GO applies only the Hub public IPv4 candidates', async () => {
    const signals: DirectVoiceRtcSignal[] = [];
    const transport = makeTransport(false, signals);
    await transport.start();
    const generation = 'hub-generation-1';
    await transport.handleSignal({
      kind: 'description',
      generation,
      description: {
        type: 'offer',
        sdp: chromiumSdp(
          [HUB_HOST_LAN, HUB_HOST_V6, HUB_HOST_MDNS, HUB_SRFLX],
          'IN IP4 192.168.1.50',
          50000
        ),
      },
    });
    const hubCandidates = [
      HUB_HOST_LAN,
      HUB_HOST_V6,
      HUB_HOST_MDNS,
      HUB_SRFLX_CGNAT,
      HUB_SRFLX_V6,
      HUB_SRFLX,
      HUB_RELAY,
    ].map((candidate) => ({ candidate, sdpMid: '0', sdpMLineIndex: 0 }));
    await transport.handleSignal({
      kind: 'ice-candidates',
      generation,
      candidates: [...hubCandidates, { candidate: '', sdpMid: '0' }],
    });

    const pc = ChromiumLikePC.instances[0];
    const remoteSdp = pc.appliedRemoteSdp.join('\n');
    for (const fragment of ['192.168.1.50 50000', '2001:db8', '.local']) {
      expect(remoteSdp).not.toContain(fragment);
    }
    expect(remoteSdp).toContain(HUB_SRFLX);
    expect(pc.addedRemoteCandidates.map((c) => c?.candidate)).toEqual([
      HUB_SRFLX,
      HUB_RELAY,
      '',
    ]);
    // And GO's answer side leaks nothing either.
    expectNothingPrivate(signals);
    transport.close();
  });
});

describe('registry of live guarded peer connections', () => {
  class LifecyclePC extends EventTarget {
    static instances: LifecyclePC[] = [];
    signalingState = 'stable';
    channels: string[] = [];
    closeCalls = 0;
    senders: Array<{ track: unknown }> = [];
    constructor(public config?: RTCConfiguration) {
      super();
      LifecyclePC.instances.push(this);
    }
    createDataChannel(label: string, init?: unknown) {
      this.channels.push(label);
      return { label, init };
    }
    getSenders() {
      return this.senders;
    }
    close() {
      this.closeCalls += 1;
      this.signalingState = 'closed';
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let target: Record<string, any>;
  let mode: WebRtcPrivacyMode;

  beforeEach(() => {
    LifecyclePC.instances = [];
    mode = 'hide-local';
    target = { RTCPeerConnection: LifecyclePC };
    installWebRtcPrivacyGuard({ force: true, target, getMode: () => mode });
  });

  afterEach(() => {
    __uninstallWebRtcPrivacyGuardForTests();
  });

  const create = () =>
    new (target.RTCPeerConnection as typeof LifecyclePC)({ iceServers: [] });

  it('lists every connection the guard built, oldest first, until it closes', () => {
    const a = create();
    mode = 'block-all';
    const b = create();
    const listed = listGuardedPeerConnections();
    expect(listed.map((info) => info.pc)).toEqual([a, b]);
    expect(listed.map((info) => info.mode)).toEqual([
      'hide-local',
      'block-all',
    ]);
    expect(listed.map((info) => info.serial)).toEqual([1, 2]);
    expect(listed.every((info) => info.stunProbe === false)).toBe(true);
    expect(typeof listed[0].createdAt).toBe('number');

    a.close();
    expect(a.closeCalls).toBe(1); // the native close still runs
    expect(listGuardedPeerConnections().map((info) => info.pc)).toEqual([b]);
    // A connection the engine closed by itself (signalingState) is dropped too.
    b.signalingState = 'closed';
    expect(listGuardedPeerConnections()).toEqual([]);
  });

  it('marks community STUN probe connections and passes data channels through', () => {
    const call = create();
    const probe = create();
    expect(call.createDataChannel('gcall-audio', { ordered: false })).toEqual({
      label: 'gcall-audio',
      init: { ordered: false },
    });
    probe.createDataChannel('stun-probe');
    expect(call.channels).toEqual(['gcall-audio']);
    expect(probe.channels).toEqual(['stun-probe']);
    const byPc = new Map<unknown, boolean>(
      listGuardedPeerConnections().map((info) => [info.pc, info.stunProbe])
    );
    expect(byPc.get(call)).toBe(false);
    expect(byPc.get(probe)).toBe(true);
  });

  it('is empty without the guard and after it is removed', () => {
    create();
    expect(listGuardedPeerConnections()).toHaveLength(1);
    __uninstallWebRtcPrivacyGuardForTests();
    expect(listGuardedPeerConnections()).toEqual([]);
    // The stock constructor (guard gone) registers nothing.
    new LifecyclePC();
    expect(listGuardedPeerConnections()).toEqual([]);
  });

  it('keeps the guard rules for a listed connection (block-all stays relay-only)', () => {
    mode = 'block-all';
    const pc = create();
    expect(pc.config).toMatchObject({
      iceServers: [],
      iceTransportPolicy: 'relay',
    });
    expect(listGuardedPeerConnections()[0]).toMatchObject({
      mode: 'block-all',
    });
  });

  it('finds the real transport connection and forgets it on close', async () => {
    __uninstallWebRtcPrivacyGuardForTests();
    ChromiumLikePC.instances = [];
    vi.stubGlobal('RTCPeerConnection', ChromiumLikePC);
    try {
      installWebRtcPrivacyGuard({ force: true, getMode: () => 'hide-local' });
      const transport = new DirectVoiceWebRtcTransport({
        offerer: true,
        getIceServers: async () => [],
        localStream: {
          getAudioTracks: () => [{ kind: 'audio' }],
        } as unknown as MediaStream,
        onSignal: () => {},
        onRemoteStream: () => {},
      });
      await transport.start();
      expect(listGuardedPeerConnections().map((info) => info.pc)).toEqual([
        ChromiumLikePC.instances[0],
      ]);
      transport.close();
      expect(listGuardedPeerConnections()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
