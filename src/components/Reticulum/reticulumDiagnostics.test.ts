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

import { getNativeBcryptRuntimeInfo } from '../../utils/nativeBcrypt';
import {
  buildReticulumDiagnosticsReport,
  collapseEngineLogLines,
  diagnosticsFileName,
  diagnosticsReportToMarkdown,
  formatMembershipProbeLine,
  formatResourceSessionsLine,
  formatUnlockLines,
  formatValidatorLine,
  isEngineFaultLine,
  jitVerdict,
  probeUnlockRuntime,
  selectEngineLogLines,
  type ReticulumDiagnosticsInput,
} from './reticulumDiagnostics';

type EngineDiagnostics = NonNullable<ReticulumDiagnosticsInput['engine']>;

const WEBVIEW: ReticulumDiagnosticsInput['webView'] = {
  userAgent: 'Mozilla/5.0 (Linux; Android 16) Chrome/147.0.7727.49',
  hardwareConcurrency: 8,
  deviceMemoryGb: 8,
  webAssembly: true,
  opfs: true,
  crossOriginIsolated: false,
  jsLoopMs: 34,
};

const ONLINE_STATE: ReticulumDiagnosticsInput['state'] = {
  phase: 'online',
  status: {
    started: true,
    online: true,
    networkName: 'qortal-hub',
    ifacSize: 16,
    interfaces: 2,
    announces: 343,
    rxBytes: 5_650_000,
    txBytes: 1_390_000,
  },
  error: null,
  bridgeError: null,
  bridgeWarning: null,
  chatEngineState: 'ready',
  chatEngineSince: 0,
  chatEngineBootMs: 1_700,
};

function readyEngine(
  overrides: Partial<EngineDiagnostics> = {}
): EngineDiagnostics {
  return {
    readiness: { state: 'ready', revision: 4, since: 0 },
    stateAgeSec: 401,
    bootMs: 1_700,
    sqliteInitMs: 164,
    workerAlive: true,
    workerHasDirectBridge: true,
    pendingRpcCount: 0,
    apiHost: 'localhost:52391',
    apiKeyConfigured: true,
    engineLogs: [],
    engineBootFaults: [],
    validator: {
      okCount: 0,
      unavailableCount: 17,
      lastStatus: null,
      lastMs: 3,
      lastAt: 395_000,
      lastError: 'TypeError: Failed to fetch',
      lastErrorAt: 395_000,
      host: 'localhost:52391',
    },
    resourceSessions: null,
    membershipProbe: {
      host: 'localhost:52391',
      groupId: 1144,
      status: null,
      ok: false,
      isMember: null,
      error: 'TypeError: Failed to fetch',
      ms: 3,
    },
    ...overrides,
  };
}

function readyReport(
  engine: EngineDiagnostics,
  coreHost = 'localhost:52391'
): string {
  return buildReticulumDiagnosticsReport({
    now: 401_000,
    version: '0.0.13',
    state: ONLINE_STATE,
    onlineCount: 51,
    deviceOnline: true,
    webView: WEBVIEW,
    engine,
    coreApi: { host: coreHost, ok: true, httpStatus: 200, ms: 151 },
    sendFailures: [],
  });
}

const ts = (s: number) =>
  `2026-09-30T03:${String(49 + Math.floor(s / 60)).padStart(2, '0')}:${String(
    s % 60
  ).padStart(2, '0')}.000Z`;

describe('reticulumDiagnostics', () => {
  it('bases the JIT verdict on WebAssembly and engine timings, not the loop probe', () => {
    expect(jitVerdict({ webAssembly: false, sqliteInitMs: 100 })).toEqual({
      verdict: 'likely off',
      basis: 'WebAssembly missing',
    });
    expect(jitVerdict({ webAssembly: true, sqliteInitMs: 164 }).verdict).toBe(
      'likely on'
    );
    expect(jitVerdict({ webAssembly: true, sqliteInitMs: 23_000 })).toEqual({
      verdict: 'likely off',
      basis: 'sqlite-wasm init 23.0 s',
    });
    expect(
      jitVerdict({ webAssembly: true, sqliteInitMs: null, bootMs: 1_700 })
    ).toEqual({
      verdict: 'likely on',
      basis: 'WebAssembly present, engine boot 1.7 s',
    });
    expect(jitVerdict({ webAssembly: true }).verdict).toBe('unclear');
    expect(jitVerdict({ webAssembly: true, sqliteInitMs: 2_500 }).verdict).toBe(
      'unclear'
    );
  });

  it('builds a report that names the engine state, timings, node and send failures', () => {
    const report = buildReticulumDiagnosticsReport({
      now: 100_000,
      version: '0.0.12',
      state: {
        phase: 'online',
        status: {
          started: true,
          online: true,
          networkName: 'qortal-hub',
          ifacSize: 16,
          interfaces: 2,
          announces: 144,
          rxBytes: 1_478_000,
          txBytes: 480_000,
        },
        error: null,
        bridgeError: null,
        bridgeWarning:
          'Chat storage started slowly (23.0 s): this WebView is running without JIT.',
        chatEngineState: 'starting',
        chatEngineSince: 40_000,
        chatEngineBootMs: null,
      },
      onlineCount: 50,
      deviceOnline: true,
      webView: { ...WEBVIEW, jsLoopMs: 410 },
      engine: {
        readiness: { state: 'starting', revision: 3, since: 40_000 },
        stateAgeSec: 60,
        bootMs: undefined,
        sqliteInitMs: 23_000,
        workerAlive: true,
        workerHasDirectBridge: false,
        pendingRpcCount: 2,
        apiHost: '127.0.0.1:12391',
        apiKeyConfigured: false,
        engineLogs: [],
        engineBootFaults: [],
        validator: null,
        resourceSessions: null,
        membershipProbe: null,
      },
      coreApi: {
        host: '127.0.0.1:12391',
        ok: false,
        httpStatus: null,
        ms: 6000,
        error: 'aborted',
      },
      sendFailures: [
        {
          at: 90_000,
          target: 'group-1169',
          attempts: 3,
          error: 'Local user is not a member of this group',
        },
      ],
    });
    expect(report).toContain('GO version: 0.0.12');
    expect(report).toContain('State: starting for 60 s');
    expect(report).toContain('sqlite-wasm init: 23.0 s');
    expect(report).toContain('JIT: likely off (sqlite-wasm init 23.0 s)');
    expect(report).toContain('JS loop probe: 410 ms (weak hint only');
    expect(report).not.toContain('a few ms');
    expect(report).toContain(
      'Network: qortal-hub, IFAC: 16 B, hubs: 2, known paths: 144'
    );
    expect(report).toContain('/admin/status: unreachable (aborted)');
    expect(report).toContain('Node API key: not set');
    expect(report).toContain('Membership check: not run (engine not ready)');
    expect(report).not.toContain('Membership API host');
    expect(report).toContain(
      'target=group-1169 attempts=3: Local user is not a member of this group'
    );
    expect(report).toContain('Warning: Chat storage started slowly');
    expect(report).toContain('engine not ready; log not available');
  });

  it('shows why membership checks fail, with key presence but never the key', () => {
    const report = readyReport(
      readyEngine({
        engineLogs: [
          `${ts(1)} warn [ReticulumChat] fetch http://localhost:52391/groups/members/1/validate?apiKey=SECRETKEY failed`,
        ],
        membershipProbe: {
          host: 'localhost:52391',
          groupId: 1144,
          status: null,
          ok: false,
          isMember: null,
          error:
            'TypeError: Failed to fetch http://localhost:52391/x?apiKey=SECRETKEY',
          ms: 3,
        },
      })
    );
    expect(report).toContain(
      'JIT: likely on (WebAssembly present, sqlite-wasm init 164 ms)'
    );
    expect(report).toContain('Node API key: set');
    expect(report).toContain(
      'Membership check: FAILED TypeError: Failed to fetch <url> in 3 ms via localhost:52391, group 1144'
    );
    expect(report).toContain(
      'Membership validator: 0 ok, 17 unavailable; last no response in 3 ms, 6 s ago via localhost:52391; last error TypeError: Failed to fetch, 6 s ago'
    );
    expect(report).not.toContain('SECRETKEY');
    expect(report).not.toMatch(/https?:\/\/[^\s]*validate/);
    // Same host for /admin/status and membership checks: no extra host line.
    expect(report).not.toContain('Membership API host');
  });

  it('names both hosts when membership checks go elsewhere than /admin/status', () => {
    const report = readyReport(
      readyEngine({ apiHost: 'localhost:52391' }),
      'ext-node.qortal.link'
    );
    expect(report).toContain('Node: ext-node.qortal.link, /admin/status: ok');
    expect(report).toContain(
      'Membership API host: localhost:52391 (differs from the node above)'
    );
  });

  it('names the scheme when membership checks use https and the node http', () => {
    const report = buildReticulumDiagnosticsReport({
      now: 401_000,
      version: '0.0.13',
      state: ONLINE_STATE,
      onlineCount: 51,
      deviceOnline: true,
      webView: WEBVIEW,
      engine: readyEngine({ apiScheme: 'https' }),
      coreApi: {
        host: 'localhost:52391',
        scheme: 'http',
        ok: true,
        httpStatus: 200,
        ms: 151,
      },
      sendFailures: [],
    });
    expect(report).toContain(
      'Membership API host: localhost:52391 (https, node above uses http)'
    );
    expect(report).not.toMatch(/https?:\/\//);
    // Same scheme and host: no extra line.
    expect(readyReport(readyEngine({ apiScheme: 'http' }))).not.toContain(
      'Membership API host'
    );
  });

  it('formats a successful membership probe', () => {
    expect(
      formatMembershipProbeLine(
        {
          host: 'localhost:52391',
          groupId: 694,
          status: 200,
          ok: true,
          isMember: true,
          error: null,
          ms: 84,
        },
        true
      )
    ).toBe(
      'Membership check: ok (member) in 84 ms via localhost:52391, group 694'
    );
    expect(
      formatMembershipProbeLine(
        {
          host: 'localhost:52391',
          groupId: 694,
          status: 404,
          ok: false,
          isMember: null,
          error: 'HTTP 404',
          ms: 20,
        },
        true
      )
    ).toBe(
      'Membership check: FAILED HTTP 404 in 20 ms via localhost:52391, group 694'
    );
  });

  it('says "not run", not FAILED, when the probe had no group to check', () => {
    const skipped = {
      host: 'localhost:52391',
      groupId: null,
      status: null,
      ok: false,
      isMember: null,
      error: 'no local group membership yet',
      ms: 0,
      skipped: true,
    };
    expect(formatMembershipProbeLine(skipped, true)).toBe(
      'Membership check: not run (no local group membership yet)'
    );
    const report = readyReport(readyEngine({ membershipProbe: skipped }));
    expect(report).toContain(
      'Membership check: not run (no local group membership yet)'
    );
    expect(report).not.toContain('Membership check: FAILED');
  });

  it('formats validator counters and resource session stats compactly', () => {
    expect(formatValidatorLine(null, 0)).toBe(
      'Membership validator: not reported'
    );
    expect(
      formatValidatorLine(
        {
          okCount: 42,
          unavailableCount: 0,
          lastStatus: 200,
          lastMs: 84,
          lastAt: 90_000,
          lastError: null,
          lastErrorAt: null,
          host: 'ext-node.qortal.link',
        },
        100_000
      )
    ).toBe(
      'Membership validator: 42 ok, 0 unavailable; last HTTP 200 in 84 ms, 10 s ago via ext-node.qortal.link'
    );
    expect(formatResourceSessionsLine(null)).toBe(
      'Resource sessions: not reported'
    );
    expect(
      formatResourceSessionsLine({
        inFlight: { dm_page: 1, history_page: 0, reticulum_chat_live_event: 2 },
        oldestInFlightMs: 12_300,
        oldestInFlightType: 'dm_page',
        results: {
          'history_page:bridge-overloaded': 10,
          'dm_page:ok': 402,
          'metadata_snapshot:ok': 0,
        },
      })
    ).toBe(
      'Resource sessions: in flight live_event=2 dm_page=1 (oldest dm_page 12.3 s); results dm_page:ok=402 history_page:bridge-overloaded=10'
    );
  });

  it('flags membership, overload, pause, violation, refusal and give-up lines as faults', () => {
    const faults = [
      'warn [ReticulumChat] Group membership validation unavailable for group=694 address=QRj9ttCJoCmV4kb9GxSHP75ZQWWi7LqPQG',
      'warn [ReticulumChat] Refusing history page group=694: reason=requester_membership_unavailable',
      'warn [ReticulumChat] history_page_link_backoff attempts=1 retryInMs=5000 reason=bridge-overloaded',
      'warn [ReticulumChat] Author gap repair paused group=36 reason=bridge-overloaded:dm page link preparation in flight',
      'warn [ReticulumChat] Peer protocol violation peer=abc reason=non_admin',
      'warn [ReticulumChat] Giving up event pull 1ed2d76c-1d92-45d7-9dcb-f35b34a67039 after 8 attempts',
      'warn [ReticulumChat] Refusing author range: local signer is not a group member',
      'log [ReticulumChat] event_page_imported group=1144 events=20 inserted=0 membership_deferred=3 more=false',
    ];
    for (const line of faults) expect(isEngineFaultLine(line)).toBe(true);
    const quiet = [
      'log [ReticulumChat] event_page_imported group=1144 channel=general events=20 inserted=20 skipped_known=0 rejected_invalid=0 rejected_bounds=0 rejected_non_member=0 membership_deferred=0 more=false',
      'log [ReticulumChat] author_gap_repair_ready group=36 peer=cbddd49f9a4cda31 from=1 to=5 attempts=179',
      'log [ReticulumChat] background_author_gap_repair sent=1 skipped=15 scanned=16',
      'log [ReticulumChat] some_counter deferred=0',
      // Routine peer answers and boot timing, from a healthy phone's report.
      '2026-09-30T11:13:54.489Z log [ReticulumChat] author_gap_quarantined group=1144 author=QeLB8NZBjQkWYkRdw3renvRgB63DWR9E5E from=1021 to=1021 unavailable_peers=7 retry_ms=21600000',
      '2026-09-30T11:13:54.489Z log [ReticulumChat] author_gap_link_unavailable group=1144 peer=492207ed7012af1e transfer=406acdd75930a913 reason=no_history_events',
      '2026-09-30T11:03:44.130Z warn [ReticulumChat] digest_send_slow duration_ms=714 queued_ms=160 queue_size=5 group=1152 mode=subscription peer= reason=announce-group-subscription coalesced=0 processed=46 dropped=0',
      '2026-09-30T11:03:43.177Z warn [ReticulumChat] digest_state_worker_fallback group=1152 reason=digest-send:announce-group-subscription attempt=1',
    ];
    for (const line of quiet) expect(isEngineFaultLine(line)).toBe(false);
    // Level-less lines (older exports) still go by the pattern.
    expect(
      isEngineFaultLine('[ReticulumChat] Giving up event pull after 8 attempts')
    ).toBe(true);
  });

  it('collapses repeated faults, folding interleaved pairs and normalising ids', () => {
    const lines: string[] = [];
    const addresses = [
      'QRj9ttCJoCmV4kb9GxSHP75ZQWWi7LqPQG',
      'QM8eUjZLNTQS9wosWJbcvPEtAUeMkcEraS',
      'Qc436qUreT8v42qUbxWh2U2QJD6SZzXTNg',
    ];
    addresses.forEach((address, i) => {
      const group = i === 2 ? 581 : 694;
      lines.push(
        `${ts(i)} warn [ReticulumChat] Group membership validation unavailable for group=${group} address=${address}`,
        `${ts(i)} warn [ReticulumChat] Refusing history page group=${group}: reason=requester_membership_unavailable`
      );
    });
    const collapsed = collapseEngineLogLines(lines, 3);
    expect(collapsed).toEqual([
      `${lines[0]} [x3 until 03:49:02.000; groups 694,581]`,
      `${lines[1]} [x3 until 03:49:02.000; groups 694,581]`,
    ]);
    // Strictly consecutive collapsing leaves the interleaved pair alone.
    expect(collapseEngineLogLines(lines, 1)).toHaveLength(6);
    expect(
      collapseEngineLogLines([
        `${ts(1)} warn [ReticulumChat] Author gap repair paused group=694 reason=bridge-overloaded`,
        `${ts(1)} warn [ReticulumChat] Author gap repair paused group=1144 reason=bridge-overloaded`,
        `${ts(2)} warn [ReticulumChat] Event resource failed for 7d184472-c335-42bb-9602-af6097d011b2, trying another peer`,
      ])
    ).toEqual([
      `${ts(1)} warn [ReticulumChat] Author gap repair paused group=694 reason=bridge-overloaded [x2 until 03:49:01.000; groups 694,1144]`,
      `${ts(2)} warn [ReticulumChat] Event resource failed for 7d184472-c335-42bb-9602-af6097d011b2, trying another peer`,
    ]);
  });

  it('keeps boot-time faults the ring has dropped, then ring faults, then the tail', () => {
    const ring = [
      `${ts(10)} warn [ReticulumChat] history_page_link_backoff attempts=1 retryInMs=5000 reason=bridge-overloaded`,
      `${ts(11)} log [ReticulumChat] event_page_imported group=1 membership_deferred=0 more=false`,
      ...Array.from(
        { length: 60 },
        (_, i) =>
          `${ts(12)} log [ReticulumChat] presence_seen peer=${(0xabc000 + i)
            .toString(16)
            .padStart(16, 'f')} group=${694 + (i % 2)} hops=2`
      ),
    ];
    const boot = [
      `${ts(1)} error [ReticulumChat] chat database open failed`,
      // Boot timing noise: dropped from the boot section.
      `${ts(1)} warn [ReticulumChat] digest_send_slow duration_ms=714 queued_ms=160 group=1152`,
      // Still in the ring: not repeated in the boot section.
      ring[0],
    ];
    const selected = selectEngineLogLines(ring, boot);
    expect(selected[0]).toBe('-- first warnings since boot --');
    expect(selected[1]).toBe(boot[0]);
    expect(selected[2]).toBe('-- recent faults --');
    expect(selected[3]).toBe(ring[0]);
    expect(selected[4]).toBe('-- last 60 lines --');
    expect(selected).not.toContain(ring[1]);
    // The 60 tail lines differ only in peer and group ids: one line.
    expect(selected.slice(5)).toEqual([
      `${ring[2]} [x60 until 03:49:12.000; groups 694,695]`,
    ]);
  });

  it('never merges lines whose counters or status codes differ', () => {
    // Deferred events draining after the fix must stay visible.
    const draining = [
      ...Array.from(
        { length: 10 },
        (_, i) =>
          `${ts(i)} log [ReticulumChat] event_page_imported group=1144 channel=general events=20 inserted=0 membership_deferred=20 more=false`
      ),
      `${ts(30)} log [ReticulumChat] event_page_imported group=1144 channel=general events=20 inserted=20 membership_deferred=0 more=false`,
    ];
    expect(collapseEngineLogLines(draining, 1)).toEqual([
      `${draining[0]} [x10 until 03:49:09.000]`,
      draining[10],
    ]);
    const statuses = [
      `${ts(1)} warn [ReticulumChat] Core answered HTTP 404 for group=694`,
      `${ts(2)} warn [ReticulumChat] Core answered HTTP 500 for group=694`,
    ];
    expect(collapseEngineLogLines(statuses, 3)).toEqual(statuses);
    const counters = Array.from(
      { length: 3 },
      (_, i) =>
        `${ts(12)} log [ReticulumChat] background_author_gap_repair sent=${i} skipped=1 scanned=2`
    );
    expect(collapseEngineLogLines(counters, 1)).toEqual(counters);
    // Ids still fold: addresses, UUIDs, hashes, group/peer/transfer values.
    expect(
      collapseEngineLogLines([
        `${ts(3)} warn [ReticulumChat] metadata_snapshot_resource_failed group=1144 peer=d844a0c4aa32242b transfer=18ce448c02182e1a reason=session_prepare_failed:bridge-overloaded alternate_providers=0`,
        `${ts(3)} warn [ReticulumChat] metadata_snapshot_resource_failed group=1144 peer=f45b5866c2d18d74 transfer=41ba552701a271e9 reason=session_prepare_failed:bridge-overloaded alternate_providers=0`,
        `${ts(5)} warn [ReticulumChat] Giving up event pull 1ed2d76c-1d92-45d7-9dcb-f35b34a67039 after 8 attempts`,
        `${ts(11)} warn [ReticulumChat] Giving up event pull 6337906a-a491-46c5-b81c-8b5411477ef5 after 8 attempts`,
      ])
    ).toEqual([
      `${ts(3)} warn [ReticulumChat] metadata_snapshot_resource_failed group=1144 peer=d844a0c4aa32242b transfer=18ce448c02182e1a reason=session_prepare_failed:bridge-overloaded alternate_providers=0 [x2 until 03:49:03.000]`,
      `${ts(5)} warn [ReticulumChat] Giving up event pull 1ed2d76c-1d92-45d7-9dcb-f35b34a67039 after 8 attempts [x2 until 03:49:11.000]`,
    ]);
  });

  it('shows the build type, Java speed, KDF pool and unlock steps', () => {
    const now = Date.UTC(2026, 9, 1, 8, 42, 0);
    const report = buildReticulumDiagnosticsReport({
      now,
      version: '0.0.14',
      state: ONLINE_STATE,
      onlineCount: 51,
      deviceOnline: true,
      webView: WEBVIEW,
      engine: readyEngine(),
      coreApi: { host: 'localhost:52391', ok: true, httpStatus: 200, ms: 151 },
      sendFailures: [],
      unlock: {
        runtime: { debuggable: true, poolSize: 7, cores: 8, probeMs: 83 },
        events: [
          {
            at: Date.UTC(2026, 8, 30, 22, 5, 9),
            step: 'kdf',
            ms: 21_480,
            detail:
              'native, batch 21470 ms, pool 7, debuggable, 16 jobs, decrypt',
          },
          {
            at: Date.UTC(2026, 9, 1, 8, 41, 3),
            step: 'kdf',
            ms: 9_812,
            detail: 'joined running KDF, 16 jobs, scan',
          },
          {
            at: Date.UTC(2026, 9, 1, 8, 41, 4),
            step: 'fingerprint',
            ms: 10_240,
            detail: 'scan 1180 ms, KDF wait 9812 ms',
          },
        ],
      },
    });
    const lines = report.split('\n');
    const start = lines.indexOf('--- Unlock ---');
    // Right after the WebView section.
    expect(lines[start - 2]).toMatch(/^JS loop probe:/);
    expect(lines.slice(start + 1, start + 8)).toEqual([
      'App build: DEBUG (debuggable): on GrapheneOS all Java runs interpreted',
      'Java speed probe: bcrypt cost 6 in 83 ms (compiled is a few ms; 50 ms or more means Java runs interpreted)',
      'KDF pool: 7 threads of 8 cores',
      '2026-09-30 22:05:09 kdf 21480 ms — native, batch 21470 ms, pool 7, debuggable, 16 jobs, decrypt',
      '08:41:03 kdf 9812 ms — joined running KDF, 16 jobs, scan',
      '08:41:04 fingerprint 10240 ms — scan 1180 ms, KDF wait 9812 ms',
      '',
    ]);
    expect(lines[start + 8]).toBe('--- Reticulum radio ---');
    expect(diagnosticsReportToMarkdown(report)).toContain(
      '## Unlock\n\n```text\nApp build: DEBUG (debuggable)'
    );
  });

  it('says what is unknown when there is no plugin and no unlock yet', () => {
    expect(formatUnlockLines(null, 0)).toEqual([
      'App build: unknown',
      'Java speed probe: not run',
      'KDF pool: unknown',
      'No unlock recorded yet',
    ]);
    expect(
      formatUnlockLines(
        {
          runtime: { debuggable: false, poolSize: 3, cores: 4, probeMs: 4 },
          events: [{ at: 0, step: 'kdf', ms: -1 }],
        },
        0
      )
    ).toEqual([
      'App build: release (not debuggable)',
      'Java speed probe: bcrypt cost 6 in 4 ms (compiled is a few ms; 50 ms or more means Java runs interpreted)',
      'KDF pool: 3 threads of 4 cores',
      '00:00:00 kdf n/a',
    ]);
    // Older reports built without the unlock input still get the section.
    expect(readyReport(readyEngine())).toContain(
      '--- Unlock ---\nApp build: unknown'
    );
  });

  it('gives up on the runtime probe after the timeout', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getNativeBcryptRuntimeInfo).mockReturnValueOnce(
        new Promise(() => {})
      );
      const pending = probeUnlockRuntime(3_000);
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(pending).resolves.toBeNull();

      const runtime = { debuggable: false, poolSize: 7, cores: 8, probeMs: 5 };
      vi.mocked(getNativeBcryptRuntimeInfo).mockResolvedValueOnce(runtime);
      await expect(probeUnlockRuntime(3_000)).resolves.toEqual(runtime);
    } finally {
      vi.useRealTimers();
    }
  });

  it('names the saved file after the report time, in UTC', () => {
    expect(diagnosticsFileName(Date.UTC(2026, 8, 30, 11, 15, 31, 209))).toBe(
      'qortal-go-diagnostics-2026-09-30-1115.md'
    );
  });

  it('turns the report into Markdown headings and verbatim text blocks', () => {
    const report = [
      'Qortal GO diagnostics',
      'GO version: 0.0.13',
      'Time: 2026-09-30T11:15:31.209Z',
      '',
      '--- Core API ---',
      'Node: localhost:12391, /admin/status: ok (200) in 16 ms',
      'Node API key: set',
      '',
      '--- Engine log (faults, then tail) ---',
      '-- recent faults --',
      '2026-09-30T11:14:03.840Z warn [ReticulumChat] Giving up event pull after 8 attempts',
      '-- last 60 lines --',
      '2026-09-30T11:15:31.028Z log [ReticulumChat] history_page_link_requested group=691 reason=<url> *not emphasis*',
    ].join('\n');
    expect(diagnosticsReportToMarkdown(report)).toBe(
      [
        '# Qortal GO diagnostics',
        '',
        '```text',
        'GO version: 0.0.13',
        'Time: 2026-09-30T11:15:31.209Z',
        '```',
        '',
        '## Core API',
        '',
        '```text',
        'Node: localhost:12391, /admin/status: ok (200) in 16 ms',
        'Node API key: set',
        '```',
        '',
        '## Engine log (faults, then tail)',
        '',
        '### recent faults',
        '',
        '```text',
        '2026-09-30T11:14:03.840Z warn [ReticulumChat] Giving up event pull after 8 attempts',
        '```',
        '',
        '### last 60 lines',
        '',
        '```text',
        '2026-09-30T11:15:31.028Z log [ReticulumChat] history_page_link_requested group=691 reason=<url> *not emphasis*',
        '```',
        '',
      ].join('\n')
    );
  });

  it('uses a fence no backtick run inside the report can close', () => {
    const markdown = diagnosticsReportToMarkdown(
      [
        'Qortal GO diagnostics',
        '--- Recent send failures ---',
        'error: ```x``` and ````y````',
      ].join('\n')
    );
    expect(markdown).toContain(
      '`````text\nerror: ```x``` and ````y````\n`````'
    );
  });
});
