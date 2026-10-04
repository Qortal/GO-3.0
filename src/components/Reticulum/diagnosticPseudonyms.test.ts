import { describe, expect, it, vi } from 'vitest';

vi.mock('../../reticulumChat/mobile', () => ({
  getMobileReticulumChatDiagnostics: async () => null,
}));
vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://127.0.0.1:12391',
}));
vi.mock('../../utils/nativeBcrypt', () => ({
  getNativeBcryptRuntimeInfo: vi.fn(async () => null),
}));

import {
  createDiagnosticPseudonymizer,
  splitDiagnosticHost,
} from './diagnosticPseudonyms';
import {
  buildReticulumDiagnosticsReport,
  type ReticulumDiagnosticsInput,
} from './reticulumDiagnostics';

const KEY_A = new Uint8Array(16).fill(7);
const KEY_B = new Uint8Array(16).fill(9);
const PARTNER = 'QRj9ttCJoCmV4kb9GxSHP75ZQWWi7LqPQG';
const OTHER = 'QM8eUjZLNTQS9wosWJbcvPEtAUeMkcEraS';

const tokenIn = (text: string, prefix: string): string[] =>
  text.match(new RegExp(`<${prefix}-[0-9a-f]{6,10}>`, 'g')) ?? [];

describe('createDiagnosticPseudonymizer', () => {
  it('gives an address the same pseudonym bare and as a key=value', () => {
    const p = createDiagnosticPseudonymizer(KEY_A);
    const a = p.line(
      `dm_resource_serve_allowed conversation=4f1c2a9be0d34c11 requester=${PARTNER}`
    );
    const b = p.line(`send to ${PARTNER} failed`);
    expect(a).not.toContain(PARTNER);
    expect(b).not.toContain(PARTNER);
    const [addr] = tokenIn(a, 'addr');
    expect(addr).toBeTruthy();
    expect(b).toBe(`send to ${addr} failed`);
    expect(a).toMatch(/conversation=<id-[0-9a-f]{6}> requester=<addr-/);
  });

  it('keeps distinct values apart and is stable within one report only', () => {
    const p = createDiagnosticPseudonymizer(KEY_A);
    const first = p.line(`author=${PARTNER} author=${OTHER}`);
    const [x, y] = tokenIn(first, 'addr');
    expect(x).not.toBe(y);
    expect(p.line(`author=${PARTNER}`)).toBe(`author=${x}`);

    const sameKey = createDiagnosticPseudonymizer(KEY_A);
    expect(sameKey.line(`author=${PARTNER}`)).toBe(`author=${x}`);
    const otherKey = createDiagnosticPseudonymizer(KEY_B);
    expect(otherKey.line(`author=${PARTNER}`)).not.toBe(`author=${x}`);
    // The default key is random per report.
    expect(createDiagnosticPseudonymizer().line(`author=${PARTNER}`)).not.toBe(
      createDiagnosticPseudonymizer().line(`author=${PARTNER}`)
    );
  });

  it('pseudonymises group ids in every form the report uses', () => {
    const p = createDiagnosticPseudonymizer(KEY_A);
    const pair = p.line('Refusing history page group=694: reason=x');
    const [g694] = tokenIn(pair, 'id');
    expect(pair).toBe(`Refusing history page group=${g694}: reason=x`);
    expect(p.line('via localhost:52391, group 694')).toBe(
      `via localhost:52391, group ${g694}`
    );
    const collapsed = p.line(
      'paused group=694 [x3 until 03:49:02.000; groups 694,581]'
    );
    expect(collapsed).not.toMatch(/\b(694|581)\b/);
    expect(collapsed).toContain(`groups ${g694},<id-`);
    // Send-failure targets are group queue ids: same pseudonym as group=694.
    expect(p.line('target=694:general attempts=3: failed')).toBe(
      `target=${g694}:general attempts=3: failed`
    );
    expect(p.line('target=group-694 attempts=3: failed')).toBe(
      `target=${g694} attempts=3: failed`
    );
    const custom = p.line('target=694:7f3e9a attempts=1: failed');
    expect(custom).toMatch(
      new RegExp(`^target=${g694}:<id-[0-9a-f]{6}> attempts=1: failed$`)
    );
    expect(custom).not.toContain('7f3e9a');
    // A DM target is the partner's address pseudonym.
    expect(p.line(`target=${PARTNER} attempts=3: failed`)).toBe(
      `target=${p.line(PARTNER)} attempts=3: failed`
    );
  });

  it('pseudonymises identifiers inside JSON objects', () => {
    const p = createDiagnosticPseudonymizer(KEY_A);
    const g694 = tokenIn(p.line('group=694'), 'id')[0];
    const partner = p.line(PARTNER);
    const out = p.line(
      `warn [ReticulumChat] sync_failed {"groupId":694,"name":"Alice Smith","peerAddress":"${PARTNER}","count":12,"ok":false,"channel":"general","target":"694:general","error":{"name":"AbortError"}}`
    );
    expect(out).not.toContain('Alice');
    expect(out).not.toMatch(/\b694\b/);
    expect(out).not.toContain(PARTNER);
    expect(out).toContain(`"groupId":"${g694}"`);
    expect(out).toMatch(/"name":"<id-[0-9a-f]{6}>"/);
    expect(out).toContain(`"peerAddress":"${partner}"`);
    expect(out).toContain(`"target":"${g694}:general"`);
    // Counters, flags, plain channel names and error classes stay readable.
    expect(out).toContain('"count":12,"ok":false,"channel":"general"');
    expect(out).toContain('"error":{"name":"AbortError"}');
    // The same name gets the same pseudonym bare-keyed and in JSON.
    expect(p.line('{"sender_name": "Alice Smith"}')).toBe(
      `{"sender_name": "${tokenIn(out, 'id').find((t) => t !== g694)}"}`
    );
  });

  it('pseudonymises peer, transfer, file, request and event ids', () => {
    const p = createDiagnosticPseudonymizer(KEY_A);
    const line = p.line(
      'author_gap_link_unavailable group=1144 peer=492207ed7012af1e transfer=406acdd75930a913 file=a1b2c3d4e5f6 rid=0f9e8d7c6b5a to=cbddd49f9a4cda31 event=1ed2d76c-1d92-45d7-9dcb-f35b34a67039'
    );
    for (const raw of [
      '1144',
      '492207ed7012af1e',
      '406acdd75930a913',
      'a1b2c3d4e5f6',
      '0f9e8d7c6b5a',
      'cbddd49f9a4cda31',
      '1ed2d76c',
    ]) {
      expect(line).not.toContain(raw);
    }
    expect(p.line('peer 492207ed7012af1e is slow')).toBe(
      `peer ${tokenIn(line, 'id')[1]} is slow`
    );
  });

  it('leaves counters, timings, status codes, versions and plain values alone', () => {
    const p = createDiagnosticPseudonymizer(KEY_A);
    const lines = [
      '2026-09-30T11:03:44.130Z warn [ReticulumChat] digest_send_slow duration_ms=714 queued_ms=160 queue_size=5 mode=subscription peer= coalesced=0 processed=46',
      'event_page_imported channel=general events=20 inserted=20 cursor=none membership_deferred=0 more=false at=1727654321000',
      'Core answered HTTP 404, groups=3 peers=7 ids=2',
      'User agent: Mozilla/5.0 (Linux; Android 16) Chrome/147.0.7727.49',
      'Membership API host: localhost:52391 (https, node above uses http)',
      'Node: ext-node.qortal.link, /admin/status: ok (200) in 16 ms',
      'fetch <url> failed with apiKey=<redacted>',
    ];
    for (const line of lines) expect(p.line(line)).toBe(line);
  });

  it('drops secrets outright', () => {
    const p = createDiagnosticPseudonymizer(KEY_A);
    expect(p.line('socket token=abc123secret ready')).toBe(
      'socket token=<redacted> ready'
    );
  });

  it('replaces the user’s own node host but keeps loopback and public nodes', () => {
    const p = createDiagnosticPseudonymizer(KEY_A);
    expect(p.host('localhost:52391')).toBe('localhost:52391');
    expect(p.host('127.0.0.1:12391')).toBe('127.0.0.1:12391');
    expect(p.host('[::1]:12391')).toBe('[::1]:12391');
    expect(p.host('ext-node.qortal.link')).toBe('ext-node.qortal.link');
    expect(p.host('apinode2.qortalnodes.live')).toBe(
      'apinode2.qortalnodes.live'
    );

    const custom = p.host('my-node.example.org:12391');
    expect(custom).toMatch(/^<node-[0-9a-f]{6}>:12391$/);
    expect(p.host('my-node.example.org:12392')).toBe(
      custom.replace(':12391', ':12392')
    );
    expect(p.line('getaddrinfo ENOTFOUND my-node.example.org')).toBe(
      `getaddrinfo ENOTFOUND ${custom.replace(':12391', '')}`
    );

    expect(p.host('192.168.1.20:12391')).toMatch(
      /^<lan-node-[0-9a-f]{6}>:12391$/
    );
    expect(p.line('connect to 192.168.1.20 refused')).toMatch(
      /^connect to <lan-node-[0-9a-f]{6}> refused$/
    );
    expect(p.host('[fd00::5]:12391')).toMatch(/^<lan-node-[0-9a-f]{6}>:12391$/);
  });

  it('does not let a one-word LAN host name eat ordinary words', () => {
    const p = createDiagnosticPseudonymizer(KEY_A);
    expect(p.host('qortal:12391')).toMatch(/^<lan-node-[0-9a-f]{6}>:12391$/);
    expect(p.line('Qortal GO diagnostics')).toBe('Qortal GO diagnostics');
  });

  it('pseudonymises other IPv4 addresses, private ones as LAN', () => {
    const p = createDiagnosticPseudonymizer(KEY_A);
    expect(p.line('hub 203.0.113.5:4242 down')).toMatch(
      /^hub <ip-[0-9a-f]{6}>:4242 down$/
    );
    expect(p.line('peer at 10.0.0.7 left')).toMatch(
      /^peer at <lan-ip-[0-9a-f]{6}> left$/
    );
    expect(p.line('loopback 127.0.0.1 ok')).toBe('loopback 127.0.0.1 ok');
  });

  it('pseudonymises IPv4 addresses printed after a slash, as Java does', () => {
    const p = createDiagnosticPseudonymizer(KEY_A);
    const out = p.line(
      'Transport error: connect failed: hub.example/203.0.113.9:4242 (/192.168.1.20 refused)'
    );
    expect(out).not.toContain('203.0.113.9');
    expect(out).not.toContain('192.168.1.20');
    expect(out).toMatch(
      /hub\.example\/<ip-[0-9a-f]{6}>:4242 \(\/<lan-ip-[0-9a-f]{6}> refused\)$/
    );
    // The same address bare and after a slash: one pseudonym.
    expect(p.line('peer 203.0.113.9 left')).toBe(
      `peer ${tokenIn(out, 'ip')[0]} left`
    );
    // Version strings on the user agent line are not addresses.
    const ua =
      'User agent: Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/120.0.200.12 Mobile';
    expect(p.line(ua)).toBe(ua);
  });

  it('pseudonymises IPv6 addresses but keeps loopback and clock times', () => {
    const p = createDiagnosticPseudonymizer(KEY_A);
    const linkLocal = p.line('bound fe80::1ff:fe23:4567:890a%wlan0 ok');
    expect(linkLocal).toMatch(/^bound <lan-ip-[0-9a-f]{6}> ok$/);
    const global = p.line('hub [2001:db8:85a3::8a2e:370:7334]:4242 down');
    expect(global).toMatch(/^hub \[<ip-[0-9a-f]{6}>\]:4242 down$/);
    const full = p.line('from 2001:0db8:85a3:0000:0000:8a2e:0370:7334 x');
    expect(full).toMatch(/^from <ip-[0-9a-f]{6}> x$/);
    const mapped = p.line('peer ::ffff:192.168.1.20 joined');
    expect(mapped).toMatch(/^peer <lan-ip-[0-9a-f]{6}> joined$/);
    for (const keep of [
      'loopback ::1 ok',
      '2026-09-30T11:13:54.489Z log at 03:49:01 [x2 until 03:49:01.000]',
      'reason=session_prepare_failed:bridge-overloaded ab:cd:ef',
      'Membership API host: localhost:52391',
    ]) {
      expect(p.line(keep)).toBe(keep);
    }
  });

  it('splits hosts with and without ports', () => {
    expect(splitDiagnosticHost('node.example:12391')).toEqual({
      hostname: 'node.example',
      port: ':12391',
    });
    expect(splitDiagnosticHost('[fd00::5]:80')).toEqual({
      hostname: '[fd00::5]',
      port: ':80',
    });
    expect(splitDiagnosticHost('https://node.example:8443/x')).toEqual({
      hostname: 'node.example',
      port: ':8443',
    });
    expect(splitDiagnosticHost('fd00::5')).toEqual({
      hostname: 'fd00::5',
      port: '',
    });
  });
});

describe('buildReticulumDiagnosticsReport pseudonyms', () => {
  const baseInput = (
    overrides: Partial<ReticulumDiagnosticsInput> = {}
  ): ReticulumDiagnosticsInput => ({
    now: 401_000,
    version: '0.0.14',
    state: {
      phase: 'online',
      status: null,
      error: null,
      bridgeError: null,
      bridgeWarning: null,
      chatEngineState: 'ready',
      chatEngineSince: 0,
      chatEngineBootMs: 1_700,
    },
    onlineCount: 3,
    deviceOnline: true,
    webView: {
      userAgent: 'Mozilla/5.0 (Linux; Android 16) Chrome/147.0.7727.49',
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      webAssembly: true,
      opfs: true,
      crossOriginIsolated: false,
      jsLoopMs: 30,
    },
    engine: {
      readiness: { state: 'ready', revision: 4, since: 0 },
      stateAgeSec: 401,
      bootMs: 1_700,
      sqliteInitMs: 164,
      workerAlive: true,
      workerHasDirectBridge: true,
      pendingRpcCount: 0,
      apiHost: 'my-node.example.org:12391',
      apiScheme: 'https',
      apiKeyConfigured: true,
      engineLogs: [
        `2026-09-30T03:49:01.000Z log [ReticulumChat] dm_resource_serve_allowed conversation=4f1c2a9be0d34c11 requester=${PARTNER}`,
        `2026-09-30T03:49:02.000Z warn [ReticulumChat] cached_resource_serve_allowed group=694 requester=${OTHER} peer=492207ed7012af1e`,
      ],
      engineBootFaults: [],
      validator: {
        okCount: 2,
        unavailableCount: 1,
        lastStatus: 200,
        lastMs: 40,
        lastAt: 395_000,
        lastError: 'getaddrinfo ENOTFOUND my-node.example.org',
        lastErrorAt: 390_000,
        host: 'my-node.example.org:12391',
      },
      resourceSessions: null,
      membershipProbe: {
        host: 'my-node.example.org:12391',
        groupId: 694,
        status: 200,
        ok: true,
        isMember: true,
        error: null,
        ms: 84,
      },
    },
    coreApi: {
      host: 'my-node.example.org:12391',
      scheme: 'https',
      ok: true,
      httpStatus: 200,
      ms: 151,
    },
    sendFailures: [
      {
        at: 390_000,
        target: PARTNER,
        attempts: 3,
        error: `Recipient ${PARTNER} has no public key`,
      },
    ],
    pseudonymKey: KEY_A,
    ...overrides,
  });

  it('names no DM partner, group, peer or private node host', () => {
    const report = buildReticulumDiagnosticsReport(baseInput());
    for (const raw of [
      PARTNER,
      OTHER,
      '694',
      '4f1c2a9be0d34c11',
      '492207ed7012af1e',
      'my-node.example.org',
    ]) {
      expect(report).not.toContain(raw);
    }
    // One partner, one pseudonym across send failures and the engine log.
    const partner = tokenIn(
      report.split('\n').find((l) => l.startsWith('1970-')) ?? '',
      'addr'
    )[0];
    expect(partner).toBeTruthy();
    expect(report.split(partner).length - 1).toBe(3);
    // The node pseudonym is the same in every host field.
    const node = tokenIn(report, 'node')[0];
    expect(report).toContain(`Node: ${node}:12391, /admin/status: ok (200)`);
    expect(report).toContain(`via ${node}:12391, group <id-`);
    expect(report).toContain(`last error getaddrinfo ENOTFOUND ${node}`);
    expect(report).not.toContain('Membership API host');
    expect(report).toContain(
      'Ids: addresses, names, group/peer/file ids, IP addresses'
    );
  });

  it('gives a group the same pseudonym in send failures and the engine log', () => {
    const report = buildReticulumDiagnosticsReport(
      baseInput({
        sendFailures: [
          {
            at: 390_000,
            target: '694:general',
            attempts: 3,
            error: 'Local user is not a member of this group',
          },
        ],
      })
    );
    expect(report).not.toMatch(/\b694\b/);
    const failure =
      report.split('\n').find((l) => l.includes(' target=')) ?? '';
    const [group] = tokenIn(failure, 'id');
    expect(failure).toContain(`target=${group}:general attempts=3`);
    expect(report).toContain(`cached_resource_serve_allowed group=${group} `);
    expect(report).toContain(
      `via ${tokenIn(report, 'node')[0]}:12391, group ${group}`
    );
  });

  it('is repeatable with the same key and unlinkable with another', () => {
    const a = buildReticulumDiagnosticsReport(baseInput());
    expect(buildReticulumDiagnosticsReport(baseInput())).toBe(a);
    const b = buildReticulumDiagnosticsReport(
      baseInput({ pseudonymKey: KEY_B })
    );
    expect(b).not.toBe(a);
    expect(tokenIn(b, 'addr')).not.toEqual(tokenIn(a, 'addr'));
  });

  it('still says when membership checks use a different host', () => {
    const input = baseInput();
    const report = buildReticulumDiagnosticsReport({
      ...input,
      coreApi: { ...input.coreApi!, host: 'localhost:12391' },
    });
    expect(report).toMatch(
      /Membership API host: <node-[0-9a-f]{6}>:12391 \(differs from the node above\)/
    );
  });
});
