import { describe, expect, it, vi } from 'vitest';

// Off Android by default, as jsdom is; the native-bridge probe tests switch it.
const nativeProbe = vi.hoisted(() => ({
  platform: 'web',
  getStatus: vi.fn(async (_options?: unknown): Promise<unknown> => ({})),
}));
vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: Object.create(actual.Capacitor, {
      isNativePlatform: { value: () => nativeProbe.platform !== 'web' },
      getPlatform: { value: () => nativeProbe.platform },
    }),
  };
});
vi.mock('../../plugins/Reticulum', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../plugins/Reticulum')>();
  return {
    ...actual,
    Reticulum: {
      getStatus: (options?: unknown) => nativeProbe.getStatus(options),
    },
  };
});
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
import type { EngineSyncHealthSnapshot } from '../../reticulumChat/mobile/engineHost';
import type { AppErrorDiagnostics } from '../../utils/appErrorRing';
import {
  buildReticulumDiagnosticsReport,
  collapseEngineLogLines,
  diagnosticsFileName,
  diagnosticsReportToMarkdown,
  formatAuthorGapScannerLines,
  formatBackgroundSyncLines,
  formatDeviceLines,
  formatDigestQueueLines,
  formatEngineCounterLines,
  formatEngineLoopLines,
  formatEngineQueueLines,
  formatMembershipProbeLine,
  formatNativeRequestLines,
  formatPythonBridgeLines,
  formatResourceSessionsLine,
  formatSendAttempts,
  formatSendTimesLine,
  formatServingLines,
  formatSyncHealthLines,
  formatUnlockLines,
  formatValidatorLine,
  formatValidatorTimingLine,
  formatWebViewProvider,
  isEngineFaultLine,
  jitProbeRatio,
  jitVerdict,
  probeNativeBridge,
  probeWebView,
  probeUnlockRuntime,
  selectEngineLogLines,
  type BackgroundSyncDiagnostics,
  type NativeBridgeDiagnostics,
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
    // An engine without the sync-health answer, bridge traffic or old RPCs.
    syncHealth: null,
    bridgeTraffic: [],
    oldestRpc: null,
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

/** The readyReport input, for tests that change one part of it. */
function readyReportInput(): ReticulumDiagnosticsInput {
  return {
    now: 401_000,
    version: '0.0.13',
    state: ONLINE_STATE,
    onlineCount: 51,
    deviceOnline: true,
    webView: WEBVIEW,
    engine: readyEngine(),
    coreApi: { host: 'localhost:52391', ok: true, httpStatus: 200, ms: 151 },
    sendFailures: [],
  };
}

const ts = (s: number) =>
  `2026-09-30T03:${String(49 + Math.floor(s / 60)).padStart(2, '0')}:${String(
    s % 60
  ).padStart(2, '0')}.000Z`;

describe('reticulumDiagnostics', () => {
  it.each([
    // GrapheneOS's own flag decides, whatever else is seen.
    [
      { webViewJitRestricted: true, webAssembly: true, probeRatio: 1.0 },
      'off',
      'GrapheneOS: WebView JIT is off for GO',
    ],
    [
      { webViewJitRestricted: true, webAssembly: false },
      'off',
      'GrapheneOS: WebView JIT is off for GO',
    ],
    [
      { webViewJitRestricted: false, webAssembly: true, probeRatio: 3.1 },
      'on',
      'GrapheneOS: WebView JIT is allowed for GO',
    ],
    [
      { webViewJitRestricted: false, webAssembly: false },
      'on',
      'GrapheneOS: WebView JIT is allowed for GO',
    ],
    // No flag (stock Android, older GrapheneOS, desktop).
    [
      { webViewJitRestricted: null, webAssembly: false, probeRatio: 1.0 },
      'likely off',
      'WebAssembly missing',
    ],
    [{ webAssembly: false }, 'likely off', 'WebAssembly missing'],
    [
      { webViewJitRestricted: null, webAssembly: true, probeRatio: 2.834 },
      'unclear',
      'no GrapheneOS flag; same-thread JS loop / builtin ratio 2.83, not calibrated yet',
    ],
    [
      { webAssembly: true, probeRatio: 0.97 },
      'unclear',
      'no GrapheneOS flag; same-thread JS loop / builtin ratio 0.97, not calibrated yet',
    ],
    [
      { webAssembly: true },
      'unclear',
      'no GrapheneOS flag; same-thread probe ratio not measured',
    ],
    [
      { webAssembly: true, probeRatio: Number.NaN },
      'unclear',
      'no GrapheneOS flag; same-thread probe ratio not measured',
    ],
  ] as const)('JIT verdict %#: %o is %s', (evidence, verdict, basis) => {
    expect(jitVerdict(evidence)).toEqual({ verdict, basis });
  });

  it('no longer reads fast sqlite init and boot as JIT on', () => {
    // Vanadium keeps WebAssembly with JIT off; these were a GrapheneOS
    // tester's JIT-off numbers. They are printed but decide nothing.
    const report = buildReticulumDiagnosticsReport({
      ...readyReportInput(),
      webView: { ...WEBVIEW, jsLoopMs: 403, builtinRefMs: 130 },
      engine: readyEngine({ sqliteInitMs: 100, bootMs: 3_000 }),
    });
    expect(report).toContain(
      'JIT: unclear (no GrapheneOS flag; same-thread JS loop / builtin ratio 3.10, not calibrated yet)'
    );
    expect(report).toContain(
      'JS loop probe: 403 ms, builtin reference: 130 ms, ratio 3.10 (same thread;'
    );
    expect(report).toContain('Last boot: 3.0 s, sqlite-wasm init: 100 ms\n');
    expect(report).not.toContain('several seconds usually mean no JIT');
    expect(report).not.toContain('JIT: likely on');
    expect(report).toContain('WebView: unknown');
  });

  it('takes the JIT line and the WebView provider from the native runtime info', () => {
    const report = buildReticulumDiagnosticsReport({
      ...readyReportInput(),
      webView: { ...WEBVIEW, jsLoopMs: 135, builtinRefMs: 45 },
      unlock: {
        events: [],
        runtime: {
          debuggable: false,
          poolSize: 7,
          cores: 8,
          probeMs: 10,
          webViewJitRestricted: true,
          webViewPackage: 'app.vanadium.webview',
          webViewVersion: '141.0.7390.43',
        },
      },
    });
    const lines = report.split('\n');
    const start = lines.indexOf('--- WebView ---');
    expect(lines.slice(start + 1, start + 7)).toEqual([
      `User agent: ${WEBVIEW.userAgent}`,
      'WebView: app.vanadium.webview 141.0.7390.43',
      'CPU cores: 8, device memory: 8 GB',
      'WebAssembly: yes, OPFS storage: yes, cross-origin isolated: no',
      'JIT: off (GrapheneOS: WebView JIT is off for GO)',
      'JS loop probe: 135 ms, builtin reference: 45 ms, ratio 3.00 (same thread; node: ~1 with JIT, ~3 without; not calibrated on phones yet)',
    ]);
    const allowed = buildReticulumDiagnosticsReport({
      ...readyReportInput(),
      unlock: {
        events: [],
        runtime: {
          debuggable: false,
          poolSize: 7,
          cores: 8,
          probeMs: 10,
          webViewJitRestricted: false,
          webViewPackage: 'com.google.android.webview',
        },
      },
    });
    expect(allowed).toContain('WebView: com.google.android.webview\n');
    expect(allowed).toContain(
      'JIT: on (GrapheneOS: WebView JIT is allowed for GO)'
    );
  });

  it('measures the builtin reference right after the loop', () => {
    const probe = probeWebView();
    expect(probe.jsLoopMs).toBeGreaterThanOrEqual(0);
    expect(probe.builtinRefMs).toBeGreaterThan(0);
    expect(jitProbeRatio(probe.jsLoopMs, probe.builtinRefMs)).not.toBeNull();
    expect(jitProbeRatio(30, 0)).toBeNull();
    expect(jitProbeRatio(30, null)).toBeNull();
    expect(jitProbeRatio(30, 10)).toBe(3);
    expect(formatWebViewProvider(null)).toBe('unknown');
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
        syncHealth: null,
        bridgeTraffic: [],
        oldestRpc: null,
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
    // A slow sqlite init is printed but is no JIT evidence any more.
    expect(report).toContain(
      'JIT: unclear (no GrapheneOS flag; same-thread probe ratio not measured)'
    );
    expect(report).toContain('JS loop probe: 410 ms (no builtin reference)');
    expect(report).not.toContain('a few ms');
    expect(report).toContain(
      'Network: qortal-hub, IFAC: 16 B, hubs: 2, known paths: 144'
    );
    expect(report).toContain('/admin/status: unreachable (aborted)');
    expect(report).toContain('Node API key: not set');
    expect(report).toContain('Membership check: not run (engine not ready)');
    expect(report).not.toContain('Membership API host');
    // The target (a DM partner's address or a group) is a pseudonym.
    expect(report).toMatch(
      /target=<id-[0-9a-f]{6}> attempts=3: Local user is not a member of this group/
    );
    expect(report).not.toContain('group-1169');
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
      'JIT: unclear (no GrapheneOS flag; same-thread probe ratio not measured)'
    );
    expect(report).toContain('Node API key: set');
    expect(report).toMatch(
      /Membership check: FAILED TypeError: Failed to fetch <url> in 3 ms via localhost:52391, group <id-[0-9a-f]{6}>/
    );
    expect(report).not.toContain('1144');
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
    // After the WebView and Device sections.
    expect(lines.slice(start - 5, start)).toEqual([
      expect.stringMatching(/^JS loop probe:/),
      '',
      '--- Device ---',
      'Not reported (not native Android, or an older app)',
      '',
    ]);
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

  it('reports background sync: mode, exemption, freeze count and the last 5 freezes', () => {
    const now = Date.UTC(2026, 9, 2, 9, 0, 0);
    const freeze = (hoursAgo: number, gapMs: number, extra = {}) => ({
      at: now - hoursAgo * 3_600_000,
      gapMs,
      ignoring: false,
      charging: true,
      ...extra,
    });
    const sync = {
      mode: 'charging' as const,
      ignoringBatteryOptimizations: false,
      vendorFreezeCount: 14,
      vendorFreezeRecent: [
        freeze(60, 600_000),
        freeze(30, 3_000),
        freeze(20, 125_000),
        freeze(8, 21_900_000),
        freeze(6, 600_000, { charging: false }),
        freeze(2, 7_200_000, { ignoring: true }),
      ],
    };
    expect(formatBackgroundSyncLines(sync, now)).toEqual([
      'Mode: charging, battery optimisation exempt: no',
      'Vendor freezes recorded: 14, last 5:',
      '2026-10-01 03:00:00 frozen 3 s, charging',
      '2026-10-01 13:00:00 frozen 2 min, charging',
      '01:00:00 frozen 6 h 05 min, charging',
      '03:00:00 frozen 10 min, on battery',
      '07:00:00 frozen 2 h 00 min, charging, exempt',
    ]);
    expect(
      formatBackgroundSyncLines(
        {
          mode: 'off',
          ignoringBatteryOptimizations: null,
          vendorFreezeCount: 0,
          vendorFreezeRecent: [],
        },
        now
      )
    ).toEqual([
      'Mode: off, battery optimisation exempt: unknown',
      'Vendor freezes recorded: 0',
    ]);
    expect(formatBackgroundSyncLines(null, now)).toEqual([
      'Not reported (not native Android, or an older app)',
    ]);

    const report = buildReticulumDiagnosticsReport({
      now,
      version: '0.0.15',
      state: ONLINE_STATE,
      onlineCount: 3,
      deviceOnline: true,
      webView: WEBVIEW,
      engine: null,
      coreApi: null,
      sendFailures: [],
      backgroundSync: sync,
    });
    const lines = report.split('\n');
    const start = lines.indexOf('--- Background sync ---');
    expect(start).toBeGreaterThan(lines.indexOf('--- Chat engine ---'));
    expect(lines.slice(start + 1, start + 3)).toEqual([
      'Mode: charging, battery optimisation exempt: no',
      'Vendor freezes recorded: 14, last 5:',
    ]);
    expect(lines.slice(start + 8, start + 10)).toEqual([
      '',
      '--- Core API ---',
    ]);
    // Older callers without the input still get the section.
    expect(readyReport(readyEngine())).toContain(
      '--- Background sync ---\nNot reported'
    );
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

// ── Batch 1 diagnostics (validator, send log, sync health, device, bridge) ──

const NOW = Date.UTC(2026, 9, 11, 23, 40, 0);
const AT = (h: number, m: number, s: number) => Date.UTC(2026, 9, 11, h, m, s);

const SCANNER = {
  runsSinceBoot: 412,
  runsLastMinute: 11,
  slowRuns: 0,
  failedRuns: 0,
  lastRunAgoMs: 4_000,
  lastDurationMs: 6,
  maxDurationMs: 48,
  lastWrites: 2,
  totalWrites: 310,
  lastSent: 1,
  totalSent: 57,
  lastTried: 3,
  lastScanned: 12,
  lastEligibleGroups: 5,
  nextWakeInMs: 4_200,
  rows: {
    source: 'sql' as const,
    total: 812,
    notEligible: 52,
    parked: 400,
    due: 40,
    backoff: 300,
    quarantined: 20,
    fromSeqOne: 52,
    noPeer: 30,
    olderThanServeAge: 210,
    topGroups: [
      { groupId: 694, rows: 500, due: 30, eligible: true },
      { groupId: 581, rows: 52, due: 0, eligible: false },
    ],
  },
};

const DIGEST = {
  repair: {
    queued: 3,
    oldestQueuedMs: 1_311_000,
    processed: 1234,
    coalesced: 5000,
    dropped: 29,
    byRelation: { ahead: 40, equal: 900, behind: 200, none: 94 },
    equalHeadSkips: 456,
    budgetSpent: 12,
    budgetOpenChat: 1,
    budgetHeld: 786,
    budgetSlotBusy: 3,
    budgetResets: 1,
    groupsWaiting: 7,
    maxStreak: 3,
  },
  send: {
    queued: 0,
    oldestQueuedMs: null,
    processed: 300,
    coalesced: 4,
    dropped: 0,
  },
  recent: {
    minutes: 10,
    repairProcessed: 120,
    repairCoalesced: 301,
    repairDropped: 0,
    equalHeadSkips: 21,
    budgetHeld: 50,
    budgetSpent: 2,
    sendProcessed: 32,
    sendCoalesced: 4,
    sendDropped: 0,
  },
};

const DIGEST_LINES = [
  'Digest repair queue: 3 queued (oldest 22 min); per min (last 10 min): processed 12.0, coalesced 30.1, dropped 0.0',
  'Digest repair totals: processed 1234 (ahead 40, equal 900, behind 200, no head 94), coalesced 5000, dropped 29',
  'Digest page repairs: equal-head skips 456 (2.1/min), spent 12 (open chat 1), held 789 (slot busy 3), resets 1; groups waiting 7, longest streak 3',
  'Digest send queue: 0 queued; per min (last 10 min): processed 3.2, coalesced 0.4, dropped 0.0',
];

const QUEUES = {
  chatResource: {
    queued: 4,
    items: 4,
    oldestQueuedMs: 12_300,
    active: true,
    processed: 900,
    coalesced: 30,
    dropped: 2,
    protectedOverflow: 1,
  },
  eventPulls: { pending: 3, requested: 7 },
  historyServeQueue: 2,
  relayGroupControl: false,
};

const COUNTERS = {
  ownMembershipLocalAnswer: 85,
  dmPageDelivered: 40,
  providerAuthEnded: 12,
  groupEventPublished: 9,
  ownDeviceCopied: 5,
  resumeHook: 4,
  dmNotifySent: 3,
  backgroundFlush: 2,
  selfDmNotifySent: 1,
  dmLookbackSkipped: 0,
};

const summary = (n: number, p50: number, p95: number, max: number) => ({
  n,
  p50,
  p95,
  max,
  maxAt: AT(23, 38, 36),
});

const LOOP = {
  installed: true,
  since: AT(22, 0, 0),
  lag: summary(52_000, 3, 800, 9_400),
  lagRecent: summary(4210, 3, 1_200, 9_400),
  lagPerMinute: [12, null, 9_400, 30],
  longestTaskMs: 7_500,
  longestTaskKind: 'timer' as const,
  longestTaskAt: AT(23, 38, 29),
  tasksOver50Ms: 412,
  tasksOver1s: 37,
  suspendedCount: 0,
  suspendedMaxMs: 0,
};

const NATIVE_REQUESTS = {
  pending: 7,
  oldestPending: [
    { label: 'prepare_reticulum_resource_session', count: 3, oldestMs: 24_100 },
    { label: 'nativefs:path', count: 1, oldestMs: 12_000 },
  ],
  rtt: summary(5_000, 100, 8_000, 25_000),
  rttRecent: summary(812, 120, 20_000, 25_000),
  byLabel: [
    {
      label: 'prepare_reticulum_resource_session',
      n: 88,
      p50: 120,
      p95: 20_000,
      max: 25_000,
      timeouts: 40,
      late: 33,
    },
    { label: 'sign', n: 0, p50: 0, p95: 0, max: 0, timeouts: 1, late: 0 },
  ],
  timeouts: 73,
  lateReplies: 61,
  lateByMaxMs: 14_000,
  unmatchedReplies: 0,
  lostOnClose: 0,
};

const SERVING = {
  byType: {
    reticulum_chat_linked_event: {
      received: 4,
      authorized: 4,
      rejected: 0,
      lateRejected: 0,
      rejectedReasons: {},
      failed: 0,
      late: 0,
      ended: 0,
    },
    reticulum_chat_history_page: {
      received: 40,
      authorized: 22,
      rejected: 3,
      lateRejected: 0,
      rejectedReasons: {},
      failed: 6,
      late: 5,
      ended: 9,
    },
  },
  endedReasons: { resource_authorization_timeout: 31 },
  failedReasons: { unknown_resource_request: 6 },
  totalMs: summary(26, 3_000, 20_000, 26_000),
  engineMs: summary(26, 2_000, 12_000, 14_000),
  pythonMs: summary(44, 5, 20, 40),
  toWorkerMs: summary(44, 500, 5_000, 8_000),
  waiting: 3,
  oldestWaitingMs: 9_100,
};

const HEALTH = {
  at: NOW,
  rpcQueueMs: 50,
  workerStartedAt: AT(22, 0, 0),
  loop: LOOP,
  bridgeEvents: {
    toWorker: summary(20_000, 40, 3_000, 11_000),
    toWorkerRecent: summary(8123, 40, 5_000, 11_000),
    pythonQueue: summary(8123, 3, 30, 2_000),
  },
  native: NATIVE_REQUESTS,
  serving: SERVING,
  engine: {
    scanner: SCANNER,
    digestQueues: DIGEST,
    queues: QUEUES,
    counters: COUNTERS,
  },
  log: {
    bootFaultOverflow: 230,
    keyCounts: [
      {
        key: 'log:background_author_gap_repair',
        n: 812,
        firstAt: AT(22, 57, 41),
        lastAt: AT(23, 38, 36),
      },
    ],
  },
} as unknown as EngineSyncHealthSnapshot;

const PYTHON_BRIDGE: NativeBridgeDiagnostics = {
  bridge: {
    transportStartedAtMs: AT(22, 0, 0),
    lanes: [
      {
        lane: 'presence',
        queueDepth: 0,
        queueDepthHighWater: 3,
        queueMax: 64,
        dwellMsMax: 12,
        busyMsMax: 30,
        droppedTasks: 0,
        slowTaskCount: 0,
        completedTasks: 50,
      },
      {
        lane: 'control-send',
        queueDepth: 12,
        queueDepthHighWater: 256,
        queueMax: 256,
        dwellMsMax: 31_000,
        busyMsMax: 1_200,
        droppedTasks: 0,
        slowTaskCount: 3,
        completedTasks: 900,
        currentTask: 'cmd:send_reticulum_chat',
        runningMs: 4_100,
      },
    ],
    cmdQueue: 2,
    cmdQueueMax: 256,
    eventQueue: 0,
    priorityEventQueue: 0,
    respQueue: 1,
    executorIdleMs: 20,
    gilLagMsMax: 35,
    providerPendingAuth: 1,
    providerRefused: { history: 12 },
    jsonOutDrops: 0,
  },
  processStartedAtMs: AT(21, 58, 0),
  socket: {
    clients: 1,
    dropped: 0,
    queued: 0,
    queuedMax: 0,
    queueCapacity: 8192,
    handoverFrames: 0,
  },
};

const DEVICE_SYNC: BackgroundSyncDiagnostics = {
  mode: 'charging',
  ignoringBatteryOptimizations: true,
  vendorFreezeCount: 0,
  vendorFreezeRecent: [],
  charging: true,
  unmetered: true,
  relayProfile: 'leaf',
  keepAliveActive: true,
  thermalStatus: 2,
  powerSave: false,
  batteryTempC: 31.2,
  plugType: 'usb',
  batteryPct: 64,
};

const PARTNER_ADDRESS = 'QRj9ttCJoCmV4kb9GxSHP75ZQWWi7LqPQG';

const APP_ERRORS: AppErrorDiagnostics = {
  recent: [
    {
      firstAt: AT(23, 30, 0),
      lastAt: AT(23, 31, 0),
      count: 3,
      healed: 1,
      kind: 'caught',
      boundary: 'chat-row',
      name: 'TypeError',
      message: `Cannot read properties of undefined (reading 'length') for ${PARTNER_ADDRESS}`,
      frames: ['MessageItemComponent@MessageItem-Bx12abCD.js:345:24'],
      components: ['MessageItem', 'ChatList'],
      shape: 'surface:group reactions:object last:yes fromEnd:0',
    },
  ],
  fatal: [
    {
      at: '2026-10-10T10:00:00.000Z',
      kind: 'unhandledrejection',
      message: 'boom "secret text" https://node.example.com/x',
    },
  ],
};

function fullInput(
  overrides: Partial<ReticulumDiagnosticsInput> = {}
): ReticulumDiagnosticsInput {
  return {
    now: NOW,
    version: '0.0.17',
    state: ONLINE_STATE,
    onlineCount: 51,
    deviceOnline: true,
    webView: WEBVIEW,
    engine: readyEngine({
      pendingRpcCount: 2,
      validator: {
        okCount: 40,
        unavailableCount: 64,
        timedOutCount: 50,
        gracedCount: 12,
        gracedKeptCount: 9,
        ownCount: 30,
        ownUnavailableCount: 12,
        ownListAnswers: 85,
        ownCoreDenied: 0,
        lastStatus: 200,
        lastMs: 18_300,
        lastAt: NOW - 8_000,
        lastError: null,
        lastErrorAt: null,
        host: 'localhost:52391',
        recentNetworkMs: [100, 200, 300],
        recentWorkerWaitMs: [0, 6_000, 9_000],
        maxTimerLateMs: 9_000,
        maxInFlight: 7,
      },
      engineLogs: [
        `${ts(1)} warn [ReticulumChat] Refusing history page group=694: reason=requester_membership_unavailable`,
      ],
      syncHealth: HEALTH,
      bridgeTraffic: [
        'bridge_traffic 60s out{ send_reticulum_chat=3 } in{ reticulum_chat_message=12 }',
      ],
      oldestRpc: { method: 'getDirectHistory', ageMs: 4_100 },
    } as Partial<EngineDiagnostics>),
    coreApi: { host: 'localhost:52391', ok: true, httpStatus: 200, ms: 151 },
    sendFailures: [
      {
        at: NOW - 60_000,
        target: 'group-1',
        attempts: 2,
        error: 'x',
        outcome: 'recovered',
        attemptLog: [
          { ms: 45_000, error: 'reticulumChat:publishEvent timed out' },
          { ms: 120, error: null, duplicate: true },
        ],
      },
    ],
    sendTimings: [300, 500, 46_000],
    backgroundSync: DEVICE_SYNC,
    nativeBridge: PYTHON_BRIDGE,
    relayProfileSince: NOW - 12 * 60_000,
    pageStartedAt: AT(22, 0, 0),
    appErrors: APP_ERRORS,
    ...overrides,
  };
}

/** The lines of one `--- Name ---` section, without its heading. */
function sectionLines(report: string, name: string): string[] {
  const lines = report.split('\n');
  const start = lines.indexOf(`--- ${name} ---`);
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && l.startsWith('--- '));
  return lines.slice(start + 1, end < 0 ? undefined : end).filter(Boolean);
}

describe('reticulumDiagnostics validator and send log', () => {
  it('extends the validator line with timeouts, graces and the own-address share', () => {
    expect(
      formatValidatorLine(
        {
          okCount: 40,
          unavailableCount: 64,
          timedOutCount: 50,
          gracedCount: 12,
          gracedKeptCount: 9,
          ownCount: 30,
          ownUnavailableCount: 12,
          ownListAnswers: 85,
          ownCoreDenied: 0,
          lastStatus: 200,
          lastMs: 18_300,
          lastAt: 92_000,
          lastError: null,
          lastErrorAt: null,
          host: 'h',
        },
        100_000
      )
    ).toBe(
      'Membership validator: 40 ok, 64 unavailable (50 timed out), 12 graced (9 kept); own address 30 of 104 requests (12 unavailable), 85 answered from the group list; last HTTP 200 in 18.3 s, 8 s ago via h'
    );
    const base = {
      okCount: 1,
      unavailableCount: 0,
      lastStatus: 200,
      lastMs: 10,
      lastAt: 90_000,
      lastError: null,
      lastErrorAt: null,
      host: '',
    };
    expect(
      formatValidatorLine(
        {
          ...base,
          ownCount: 1,
          ownBootWaits: 2,
          ownBootWaitTimeouts: 1,
          ownCoreDenied: 3,
        },
        100_000
      )
    ).toBe(
      'Membership validator: 1 ok, 0 unavailable; own address 1 of 1 requests, boot waits 2 ok, 1 timed out, Core said not a member 3x; last HTTP 200 in 10 ms, 10 s ago'
    );
    expect(
      formatValidatorLine(
        { ...base, okCount: 0, ownListAnswers: 4, gracedCount: 0 },
        100_000
      )
    ).toBe(
      'Membership validator: no checks yet; own address 4 answered from the group list'
    );
  });

  it('formats membership timing only when there is something to say', () => {
    const stats = {
      okCount: 3,
      unavailableCount: 0,
      lastStatus: 200,
      lastMs: 10,
      lastAt: 0,
      lastError: null,
      lastErrorAt: null,
      host: 'h',
    };
    expect(
      formatValidatorTimingLine({
        ...stats,
        recentNetworkMs: [100, 200, 300],
        recentWorkerWaitMs: [0, 6_000, 9_000],
        maxTimerLateMs: 9_000,
        maxInFlight: 7,
      })
    ).toBe(
      'Membership timing (last 3 answers): network median 200 ms, max 300 ms; waiting on the engine median 6.0 s, max 9.0 s; worst late timer 9.0 s; up to 7 in flight'
    );
    expect(formatValidatorTimingLine(null)).toBeNull();
    expect(formatValidatorTimingLine(stats)).toBeNull();
    expect(
      formatValidatorTimingLine({
        ...stats,
        recentNetworkMs: [],
        recentWorkerWaitMs: [],
        maxTimerLateMs: 0,
        maxInFlight: 1,
      })
    ).toBeNull();
    // Right after the validator line in the report.
    const lines = buildReticulumDiagnosticsReport(fullInput()).split('\n');
    const at = lines.findIndex((l) => l.startsWith('Membership validator:'));
    expect(lines[at]).toContain('(50 timed out), 12 graced (9 kept)');
    expect(lines[at + 1]).toBe(
      'Membership timing (last 3 answers): network median 200 ms, max 300 ms; waiting on the engine median 6.0 s, max 9.0 s; worst late timer 9.0 s; up to 7 in flight'
    );
  });

  it('prints every send attempt, recovered sends and the send times', () => {
    expect(formatSendAttempts(undefined)).toBe('');
    expect(formatSendAttempts([])).toBe('');
    expect(
      formatSendAttempts([
        { ms: 45_000, error: 'reticulumChat:publishEvent timed out' },
        { ms: 120, error: null, duplicate: true },
        { ms: 80, error: null },
      ])
    ).toBe(
      ' [1: 45.0 s reticulumChat:publishEvent timed out; 2: 120 ms ok (already stored); 3: 80 ms ok]'
    );
    expect(formatSendTimesLine(undefined)).toBeNull();
    expect(formatSendTimesLine([Number.NaN])).toBeNull();
    expect(formatSendTimesLine([300, 500, 46_000])).toBe(
      'Send times (last 3): median 500 ms, max 46.0 s'
    );
    const report = buildReticulumDiagnosticsReport(fullInput());
    expect(report).toContain(
      '--- Recent send failures ---\nSend times (last 3): median 500 ms, max 46.0 s\n'
    );
    expect(report).toMatch(
      /target=<id-[0-9a-f]{6}> attempts=2 recovered \[1: 45\.0 s reticulumChat:publishEvent timed out; 2: 120 ms ok \(already stored\)\]/
    );
    // A plain failure keeps today's line, plus its attempts when it has them.
    const failed = buildReticulumDiagnosticsReport(
      fullInput({
        sendTimings: [],
        sendFailures: [
          { at: NOW, target: 'group-1', attempts: 3, error: 'Invalid event' },
          {
            at: NOW,
            target: 'group-1',
            attempts: 2,
            error: 'Invalid event',
            attemptLog: [
              { ms: 10, error: 'Invalid event' },
              { ms: 20, error: 'Invalid event' },
            ],
          },
        ],
      })
    );
    expect(failed).not.toContain('Send times');
    expect(failed).toMatch(
      /target=<id-[0-9a-f]{6}> attempts=3: Invalid event\n/
    );
    expect(failed).toMatch(
      /target=<id-[0-9a-f]{6}> attempts=2: Invalid event \[1: 10 ms Invalid event; 2: 20 ms Invalid event\]/
    );
  });
});

describe('reticulumDiagnostics sync health', () => {
  it('formats the gap scanner, its rows and the top groups', () => {
    expect(formatAuthorGapScannerLines(SCANNER)).toEqual([
      'Gap scanner: 11 runs/min (412 since boot), last 6 ms, max 48 ms, slow 0, failed 0; writes last 2 total 310; sent last 1 total 57; next in 4.2 s',
      'Gap scanner last run: 4.0 s ago, scanned 12 rows, tried 3 of 5 eligible groups',
      'Gap rows: 812 (due 40, backoff 300, quarantined 20, parked 400, not subscribed 52); from=1 52, no peer 30, older than 29 d 210',
      'Gap rows top groups: group=694 rows=500 due=30, group=581 rows=52 due=0 not subscribed',
    ]);
    expect(formatAuthorGapScannerLines(null)).toEqual([
      'Gap scanner: not reported',
    ]);
    expect(
      formatAuthorGapScannerLines({
        ...SCANNER,
        runsSinceBoot: 0,
        runsLastMinute: 0,
        nextWakeInMs: null,
        rows: null,
      })
    ).toEqual([
      'Gap scanner: 0 runs/min (0 since boot), last 6 ms, max 48 ms, slow 0, failed 0; writes last 2 total 310; sent last 1 total 57; not scheduled',
      'Gap rows: not reported',
    ]);
    expect(
      formatAuthorGapScannerLines({
        ...SCANNER,
        rows: { ...SCANNER.rows, source: 'memory', topGroups: [] },
      })[2]
    ).toMatch(/older than 29 d 210 \(memory mirror\)$/);
  });

  it('formats the digest queues with the D13-5 strings', () => {
    expect(formatDigestQueueLines(null)).toEqual([
      'Digest queues: not reported',
    ]);
    expect(formatDigestQueueLines(DIGEST)).toEqual(DIGEST_LINES);
    expect(formatDigestQueueLines({ ...DIGEST, send: undefined })[3]).toBe(
      'Digest send queue: not reported'
    );
  });

  it('formats engine queues and counters', () => {
    expect(formatEngineQueueLines(QUEUES)).toEqual([
      'Resource event queue: 4 waiting (oldest 12.3 s), running; processed 900, coalesced 30, dropped 2, protected overflow 1',
      'Event pulls: 3 pending, 7 requested; history serve queue: 2; group control relaying: off',
    ]);
    expect(
      formatEngineQueueLines({
        ...QUEUES,
        chatResource: {
          ...QUEUES.chatResource,
          queued: 0,
          oldestQueuedMs: null,
          active: false,
        },
        relayGroupControl: true,
      })
    ).toEqual([
      'Resource event queue: 0 waiting, idle; processed 900, coalesced 30, dropped 2, protected overflow 1',
      'Event pulls: 3 pending, 7 requested; history serve queue: 2; group control relaying: on',
    ]);
    expect(formatEngineQueueLines(null)).toEqual([
      'Engine queues: not reported',
    ]);
    expect(formatEngineCounterLines(COUNTERS)).toEqual([
      'Engine counters since start: ownMembershipLocalAnswer=85 dmPageDelivered=40 providerAuthEnded=12 groupEventPublished=9 ownDeviceCopied=5 resumeHook=4 dmNotifySent=3 backgroundFlush=2',
      '  selfDmNotifySent=1',
    ]);
    expect(formatEngineCounterLines({})).toEqual([
      'Engine counters since start: none',
    ]);
    expect(formatEngineCounterLines(undefined)).toEqual([
      'Engine counters since start: none',
    ]);
  });

  it('composes the section and keeps a broken part to its own line', () => {
    expect(formatSyncHealthLines(HEALTH)).toEqual([
      ...formatAuthorGapScannerLines(SCANNER),
      ...DIGEST_LINES,
      ...formatEngineQueueLines(QUEUES),
      ...formatEngineCounterLines(COUNTERS),
    ]);
    const broken = {
      ...HEALTH,
      engineError: 'scanner: fetch https://node.example.com/x failed',
      engine: {
        ...HEALTH.engine,
        scanner: Object.defineProperty({}, 'runsSinceBoot', {
          get() {
            throw new Error('boom');
          },
        }),
      },
    } as unknown as EngineSyncHealthSnapshot;
    const lines = formatSyncHealthLines(broken);
    expect(lines[0]).toBe('Engine getter failed: scanner: fetch <url> failed');
    expect(lines[1]).toBe('Gap scanner: format error');
    expect(lines.slice(2, 6)).toEqual(DIGEST_LINES);
    expect(
      formatSyncHealthLines({
        ...HEALTH,
        engine: null,
      } as unknown as EngineSyncHealthSnapshot)
    ).toEqual(['Chat manager: not running']);
  });

  it('reports only the digest lines a manager gives (D13-5 fixture)', () => {
    const report = readyReport(
      readyEngine({
        syncHealth: {
          ...HEALTH,
          engine: {
            digestQueues: DIGEST,
            scanner: null,
            queues: null,
            counters: {},
          },
        },
      } as Partial<EngineDiagnostics>)
    );
    const sync = sectionLines(report, 'Sync health');
    expect(sync).toEqual([
      'Gap scanner: not reported',
      ...DIGEST_LINES,
      'Engine queues: not reported',
      'Engine counters since start: none',
    ]);
    expect(report).toContain('Digest page repairs: equal-head skips 456');
  });
});

describe('reticulumDiagnostics engine loop, worker->native and serving', () => {
  it('formats the engine loop, longest task, RPC wait and bridge events', () => {
    expect(formatEngineLoopLines(HEALTH, NOW)).toEqual([
      'Engine loop: lag p50 ~3 ms, p95 ~1.2 s, max 9.4 s at 23:38:36 (last 10 min, 4210 timers); since start p95 ~800 ms, max 9.4 s',
      'Engine loop per minute (max lag, oldest first): 12 ms, -, 9.4 s, 30 ms',
      'Longest task: 7.5 s (timer) at 23:38:29; tasks over 1 s: 37, over 50 ms: 412',
      'Diagnostics request waited 50 ms in the engine queue',
      'Bridge events: Python queue p95 ~30 ms, max 2.0 s; Python to engine p95 ~5.0 s, max 11.0 s (last 10 min, 8123 events)',
    ]);
    const quiet = {
      ...HEALTH,
      rpcQueueMs: null,
      loop: {
        ...LOOP,
        lagRecent: null,
        lagPerMinute: [null, null],
        longestTaskMs: 0,
        longestTaskKind: null,
        longestTaskAt: null,
        suspendedCount: 2,
        suspendedMaxMs: 300_000,
      },
      bridgeEvents: {
        toWorker: summary(20_000, 40, 3_000, 11_000),
        toWorkerRecent: null,
        pythonQueue: null,
      },
    } as unknown as EngineSyncHealthSnapshot;
    expect(formatEngineLoopLines(quiet, NOW)).toEqual([
      'Engine loop: no timers in the last 10 min; since start p95 ~800 ms, max 9.4 s at 23:38:36; frozen 2x (a timer 60 s or more late, longest 300.0 s)',
      'Longest task: none over 50 ms',
      'Bridge events: Python to engine p95 ~3.0 s, max 11.0 s (since start, 20000 events)',
    ]);
    expect(
      formatEngineLoopLines(
        {
          ...HEALTH,
          loop: { ...LOOP, installed: false },
          bridgeEvents: {
            toWorker: null,
            toWorkerRecent: null,
            pythonQueue: null,
          },
        } as unknown as EngineSyncHealthSnapshot,
        NOW
      )
    ).toEqual([
      'Engine loop: not measured (probe not installed)',
      'Engine loop per minute (max lag, oldest first): 12 ms, -, 9.4 s, 30 ms',
      'Longest task: 7.5 s (timer) at 23:38:29; tasks over 1 s: 37, over 50 ms: 412',
      'Diagnostics request waited 50 ms in the engine queue',
      'Bridge events: no samples',
    ]);
  });

  it('formats worker->native pending, round trips, timeouts and late replies', () => {
    expect(formatNativeRequestLines(NATIVE_REQUESTS)).toEqual([
      'Worker->native: 7 pending (oldest prepare_reticulum_resource_session x3 24.1 s, nativefs:path 12.0 s); round trip p50 ~120 ms, p95 ~20.0 s, max 25.0 s (last 10 min, 812)',
      'Worker->native since start: timeouts 73, late replies 61 (up to 14.0 s after the timeout), unmatched 0, lost on socket close 0',
      'Worker->native by command: prepare_reticulum_resource_session n=88 p95 ~20.0 s max 25.0 s timeouts=40 late=33; sign n=0 timeouts=1',
    ]);
    expect(
      formatNativeRequestLines({
        pending: 0,
        oldestPending: [],
        rtt: null,
        rttRecent: null,
        byLabel: [],
        timeouts: 0,
        lateReplies: 0,
        lateByMaxMs: 0,
        unmatchedReplies: 2,
        lostOnClose: 1,
      })
    ).toEqual([
      'Worker->native: 0 pending; round trip no replies yet',
      'Worker->native since start: timeouts 0, late replies 0, unmatched 2, lost on socket close 1',
      'Worker->native by command: none',
    ]);
    expect(formatNativeRequestLines(null)).toEqual([
      'Worker->native: not reported',
    ]);
  });

  it('formats serving per type, reasons, step timing and waiting answers', () => {
    expect(formatServingLines(SERVING)).toEqual([
      'history_page: received 40, authorized 22, rejected 3, failed 6 (late 5), ended by Python 9',
      'linked_event: received 4, authorized 4, rejected 0, failed 0, ended by Python 0',
      'Ended by Python: resource_authorization_timeout=31',
      'Authorize failures: unknown_resource_request=6',
      'Timing: arrival to answer p50 ~3.0 s, p95 ~20.0 s, max 26.0 s; Python admission p95 ~20 ms, max 40 ms; Python to engine p95 ~5.0 s, max 8.0 s; in the engine p95 ~12.0 s, max 14.0 s',
      'Waiting for an answer now: 3 (oldest 9.1 s)',
    ]);
    expect(
      formatServingLines({
        byType: {},
        endedReasons: {},
        failedReasons: {},
        totalMs: null,
        engineMs: null,
        pythonMs: null,
        toWorkerMs: null,
        waiting: 0,
        oldestWaitingMs: null,
      })
    ).toEqual([
      'Requests served: none yet',
      'Ended by Python: none',
      'Authorize failures: none',
      'Timing: no samples',
      'Waiting for an answer now: 0',
    ]);
    expect(formatServingLines(null)).toEqual(['Serving: not reported']);
  });
});

describe('reticulumDiagnostics device and native bridge', () => {
  it('formats the device facts (D8)', () => {
    expect(
      formatDeviceLines(
        DEVICE_SYNC,
        { since: NOW - 12 * 60_000, pageStartedAt: 0, engineRelaying: false },
        NOW
      )
    ).toEqual([
      'Power: charging via usb, battery 64%, 31.2 °C, power save off, thermal moderate',
      'Network: unmetered yes; relay profile leaf since 12 min ago (engine relays group control: no)',
      'Keep-alive: active',
    ]);
    expect(
      formatDeviceLines(
        {
          mode: 'off',
          ignoringBatteryOptimizations: null,
          vendorFreezeCount: 0,
          vendorFreezeRecent: [],
          charging: false,
        },
        { since: null, pageStartedAt: NOW - 300_000, engineRelaying: null },
        NOW
      )
    ).toEqual([
      'Power: on battery, power save unknown, thermal unknown',
      'Network: unmetered unknown; relay profile unknown since page start, 5 min ago',
      'Keep-alive: unknown',
    ]);
    expect(
      formatDeviceLines(
        null,
        { since: null, pageStartedAt: 0, engineRelaying: null },
        NOW
      )
    ).toEqual(['Not reported (not native Android, or an older app)']);
  });

  it('formats the Python bridge lanes, queues and Kotlin socket (D9)', () => {
    expect(formatPythonBridgeLines(PYTHON_BRIDGE, NOW)).toEqual([
      'Transport started 22:00:00 (100 min ago); app process started 21:58:00 (102 min ago)',
      'Queues now: commands 2 of 256, events 0, priority events 0, replies 1; executor idle 20 ms; provider auths waiting 1; GIL lag (recent) 35 ms; event drops 0',
      'Lanes (max since bridge start, worst dwell first):',
      '  control-send now 12, high 256 of 256, dwell max 31.0 s, busy max 1.2 s, slow 3, dropped 0, running cmd:send_reticulum_chat 4.1 s',
      '  (+1 quiet lanes)',
      'Provider refused: history=12',
      'Kotlin socket: 1 client(s), queued 0 (largest 0 of 8192), dropped 0, kept for handover 0',
    ]);
    expect(
      formatPythonBridgeLines(
        {
          bridge: {
            lanes: [{ lane: 'presence', dwellMsMax: 3, queueDepth: 0 }],
          },
          processStartedAtMs: null,
          socket: null,
        },
        NOW
      )
    ).toEqual([
      'Transport started unknown; app process started unknown',
      'Queues now: commands n/a of n/a, events n/a, priority events n/a, replies n/a; executor idle n/a; provider auths waiting n/a; GIL lag (recent) n/a; event drops n/a',
      'Lanes: all quiet (max dwell under 50 ms)',
      'Kotlin socket: not reported',
    ]);
    expect(
      formatPythonBridgeLines(
        {
          bridge: null,
          processStartedAtMs: AT(21, 58, 0),
          socket: PYTHON_BRIDGE.socket,
        },
        NOW
      )
    ).toEqual([
      'Transport started unknown; app process started 21:58:00 (102 min ago)',
      'Python bridge: not reported (bridge not started)',
      'Kotlin socket: 1 client(s), queued 0 (largest 0 of 8192), dropped 0, kept for handover 0',
    ]);
    expect(
      formatPythonBridgeLines(
        {
          bridge: { error: 'boom' },
          processStartedAtMs: null,
          socket: null,
        },
        NOW
      ).slice(1, 3)
    ).toEqual([
      'Python bridge detail failed: boom',
      'Queues now: commands n/a of n/a, events n/a, priority events n/a, replies n/a; executor idle n/a; provider auths waiting n/a; GIL lag (recent) n/a; event drops n/a',
    ]);
    expect(formatPythonBridgeLines(null, NOW)).toEqual([
      'Not reported (bridge not started, or an older app)',
    ]);
  });

  it('asks the native bridge once with detail on Android, bounded by a timeout', async () => {
    nativeProbe.getStatus.mockClear();
    nativeProbe.platform = 'web';
    try {
      await expect(probeNativeBridge()).resolves.toBeNull();
      expect(nativeProbe.getStatus).not.toHaveBeenCalled();

      nativeProbe.platform = 'android';
      nativeProbe.getStatus.mockResolvedValueOnce({
        started: true,
        online: true,
        bridge: {
          cmdQueue: 2,
          cmdQueueMax: 256,
          gilLagMsMax: 'slow',
          lanes: [
            { lane: 'control-send', queueDepth: 12, dwellMsMax: 31_000 },
            null,
          ],
          providerRefused: { history: 12, dm: 'x' },
        },
        native: {
          processStartedAtMs: 1_700_000_000_000,
          socket: {
            clients: 1,
            dropped: 2,
            queued: 3,
            queuedMax: 3,
            queueCapacity: 8192,
            handoverFrames: 0,
          },
        },
      });
      await expect(probeNativeBridge()).resolves.toEqual({
        bridge: {
          cmdQueue: 2,
          cmdQueueMax: 256,
          lanes: [{ lane: 'control-send', queueDepth: 12, dwellMsMax: 31_000 }],
          providerRefused: { history: 12 },
        },
        processStartedAtMs: 1_700_000_000_000,
        socket: {
          clients: 1,
          dropped: 2,
          queued: 3,
          queuedMax: 3,
          queueCapacity: 8192,
          handoverFrames: 0,
        },
      });
      expect(nativeProbe.getStatus).toHaveBeenLastCalledWith({ detail: true });

      // An older app: the plain status, without either part.
      nativeProbe.getStatus.mockResolvedValueOnce({ started: true });
      await expect(probeNativeBridge()).resolves.toBeNull();
      nativeProbe.getStatus.mockRejectedValueOnce(new Error('not implemented'));
      await expect(probeNativeBridge()).resolves.toBeNull();

      vi.useFakeTimers();
      try {
        nativeProbe.getStatus.mockReturnValueOnce(new Promise(() => {}));
        const pending = probeNativeBridge(3_000);
        await vi.advanceTimersByTimeAsync(3_000);
        await expect(pending).resolves.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    } finally {
      nativeProbe.platform = 'web';
    }
  });
});

describe('reticulumDiagnostics engine log extras', () => {
  it('counts the stall watchdog lines as faults, not install lines', () => {
    expect(
      isEngineFaultLine(
        'warn [MobileChat] bridge_stall_diagnostic executor_stalled=true executor_idle_s=21.3 cmd_q=40/256 threads=63 stuck=none'
      )
    ).toBe(true);
    expect(
      isEngineFaultLine(
        'warn [MobileChat] bridge_thread_population threads=63 cpu_total=100 cpu_top= groups_top='
      )
    ).toBe(true);
    expect(isEngineFaultLine('warn [MobileChat] engine install ok')).toBe(
      false
    );
  });

  it('says what the caps elided, the boot overflow and the line counts', () => {
    const boot = Array.from(
      { length: 45 },
      (_, i) => `${ts(i)} warn [ReticulumChat] boot_fault_${i} failed`
    );
    const bootOnly = selectEngineLogLines([], boot);
    expect(bootOnly[0]).toBe('-- first warnings since boot --');
    expect(bootOnly).toHaveLength(42);
    expect(bootOnly[40]).toBe(boot[39]);
    expect(bootOnly[41]).toBe('… 5 more elided');

    const ringFaults = Array.from(
      { length: 45 },
      (_, i) => `${ts(i)} warn [ReticulumChat] ring_fault_${i} failed`
    );
    const ring = [
      ...ringFaults,
      ...Array.from(
        { length: 60 },
        () => `${ts(100)} log [ReticulumChat] presence_seen hops=2`
      ),
    ];
    const withFaults = selectEngineLogLines(ring);
    expect(withFaults.slice(0, 3)).toEqual([
      '-- recent faults --',
      '… 5 earlier elided',
      ringFaults[5],
    ]);
    // Header, marker, then the last 40 faults.
    expect(withFaults[41]).toBe(ringFaults[44]);
    expect(withFaults[42]).toBe('-- last 60 lines --');

    expect(selectEngineLogLines([], [], { bootOverflow: 230 })).toEqual([
      '-- first warnings since boot --',
      'Boot buffer full: 230 later warnings not kept',
    ]);
    const counted = selectEngineLogLines(ring.slice(-60), [], {
      keyCounts: [
        {
          key: 'log:background_author_gap_repair',
          n: 812,
          firstAt: AT(22, 57, 41),
          lastAt: AT(23, 38, 36),
        },
        { key: 'other', n: 44, firstAt: 0, lastAt: 0 },
      ],
    });
    expect(counted.slice(0, 4)).toEqual([
      '-- line counts since boot --',
      'x812 log:background_author_gap_repair (first 22:57:41.000, last 23:38:36.000)',
      'x44 other',
      '-- last 60 lines --',
    ]);
    // Without extras or elisions the output is what it was.
    expect(selectEngineLogLines(ring.slice(-60), [], {})).toEqual(
      selectEngineLogLines(ring.slice(-60))
    );
  });
});

describe('reticulumDiagnostics report layout', () => {
  it('prints the sections in the Batch 1 order', () => {
    const report = buildReticulumDiagnosticsReport(fullInput());
    expect(report.split('\n').filter((l) => l.startsWith('--- '))).toEqual([
      '--- WebView ---',
      '--- Device ---',
      '--- Unlock ---',
      '--- Reticulum radio ---',
      '--- Chat engine ---',
      '--- Sync health ---',
      '--- Serving ---',
      '--- Python bridge ---',
      '--- Background sync ---',
      '--- Core API ---',
      '--- Recent send failures ---',
      '--- Recent app errors ---',
      '--- Engine log (faults, then tail) ---',
    ]);
    expect(sectionLines(report, 'Device')).toEqual([
      'Power: charging via usb, battery 64%, 31.2 °C, power save off, thermal moderate',
      'Network: unmetered yes; relay profile leaf since 12 min ago (engine relays group control: no)',
      'Keep-alive: active',
    ]);
    const chat = sectionLines(report, 'Chat engine');
    expect(chat[2]).toBe(
      'Worker alive: yes, direct bridge socket: yes, RPCs in flight: 2 (oldest getDirectHistory 4.1 s)'
    );
    expect(chat.slice(3, 11)).toEqual([
      ...formatEngineLoopLines(HEALTH, NOW),
      ...formatNativeRequestLines(NATIVE_REQUESTS),
    ]);
    expect(chat[11]).toMatch(/^Resource sessions:/);
    expect(chat[12]).toBe(
      'Bridge traffic: bridge_traffic 60s out{ send_reticulum_chat=3 } in{ reticulum_chat_message=12 }'
    );
    const sync = sectionLines(report, 'Sync health');
    expect(sync[0]).toMatch(/^Gap scanner: 11 runs\/min/);
    expect(sync[3]).toMatch(
      /^Gap rows top groups: group=<id-[0-9a-f]{6}> rows=500 due=30, group=<id-[0-9a-f]{6}> rows=52 due=0 not subscribed$/
    );
    expect(sync.slice(4, 8)).toEqual(DIGEST_LINES);
    expect(sectionLines(report, 'Serving')[0]).toBe(
      'history_page: received 40, authorized 22, rejected 3, failed 6 (late 5), ended by Python 9'
    );
    expect(sectionLines(report, 'Serving')).toContain(
      'Authorize failures: unknown_resource_request=6'
    );
    expect(sectionLines(report, 'Python bridge')).toEqual(
      formatPythonBridgeLines(PYTHON_BRIDGE, NOW)
    );
    const log = sectionLines(report, 'Engine log (faults, then tail)');
    expect(log).toContain('Boot buffer full: 230 later warnings not kept');
    expect(log).toContain(
      'x812 log:background_author_gap_repair (first 22:57:41.000, last 23:38:36.000)'
    );
    expect(log.indexOf('-- line counts since boot --')).toBeLessThan(
      log.indexOf('-- last 1 lines --')
    );
  });

  it('keeps ids, addresses, URLs and quoted text out of the new sections', () => {
    const report = buildReticulumDiagnosticsReport(
      fullInput({
        engine: readyEngine({
          syncHealth: {
            ...HEALTH,
            engineError:
              'scanner: fetch https://node.example.com/x?apiKey=SECRET failed',
          },
        } as Partial<EngineDiagnostics>),
      })
    );
    expect(report).not.toMatch(/\b694\b/);
    expect(report).not.toMatch(/\b581\b/);
    expect(report).toContain('group=<id-');
    expect(report).not.toContain(PARTNER_ADDRESS);
    expect(report).toContain('<addr-');
    expect(report).not.toContain('https://');
    expect(report).not.toContain('SECRET');
    expect(report).not.toContain('secret text');
    expect(report).toContain(
      'Engine getter failed: scanner: fetch <url> failed'
    );
  });

  it('lists recent app errors and the saved crash log, scrubbed (1.7-G)', () => {
    const report = buildReticulumDiagnosticsReport(fullInput());
    expect(report).toContain('--- Recent app errors ---');
    expect(report).toContain('caught in chat-row, 3x until');
    expect(report).toContain('healed 1x');
    expect(report).toContain('  row: surface:group');
    expect(report).toContain('MessageItem-Bx12abCD.js:345:24');
    expect(report).toContain(
      'Saved crash log (kept across restarts), newest first:'
    );
    expect(report).toContain('<addr-');
    expect(report).not.toContain(PARTNER_ADDRESS);
    expect(report).not.toContain('secret text');
    expect(report).not.toContain('https://');
    expect(readyReport(readyEngine())).toContain(
      '--- Recent app errors ---\nThis session: none\nSaved crash log: none'
    );
  });

  it('says "not reported" for every new part an older engine or caller leaves out', () => {
    const report = readyReport(readyEngine());
    for (const [name, line] of [
      ['Device', 'Not reported (not native Android, or an older app)'],
      ['Sync health', 'Not reported (no sync-health answer from this engine)'],
      ['Serving', 'Not reported (no sync-health answer from this engine)'],
      ['Python bridge', 'Not reported (bridge not started, or an older app)'],
    ]) {
      expect(sectionLines(report, name)).toEqual([line]);
    }
    expect(report).toContain(
      'Worker alive: yes, direct bridge socket: yes, RPCs in flight: 0\n'
    );
    expect(report).not.toContain('Engine loop');
    expect(report).not.toContain('Membership timing');
    expect(report).not.toContain('Bridge traffic');
    expect(report).not.toContain('Send times');
    expect(report).not.toContain('-- line counts since boot --');
    // The RPC failed: both sections say why.
    const failed = readyReport(
      readyEngine({
        syncHealth: null,
        syncHealthError: 'reticulumChat:debug:sync-health timed out',
      } as Partial<EngineDiagnostics>)
    );
    expect(sectionLines(failed, 'Sync health')).toEqual([
      'Not reported (reticulumChat:debug:sync-health timed out)',
    ]);
    expect(sectionLines(failed, 'Serving')).toEqual([
      'Not reported (reticulumChat:debug:sync-health timed out)',
    ]);
    // Engine not ready: no RPC was sent.
    const starting = buildReticulumDiagnosticsReport({
      ...fullInput(),
      engine: readyEngine({
        readiness: { state: 'starting', revision: 3, since: 0 },
        syncHealth: HEALTH,
      } as Partial<EngineDiagnostics>),
    });
    expect(sectionLines(starting, 'Sync health')).toEqual([
      'Not reported (engine not ready)',
    ]);
    expect(sectionLines(starting, 'Serving')).toEqual([
      'Not reported (engine not ready)',
    ]);
    expect(starting).not.toContain('Digest');
    expect(starting).not.toContain('Engine loop');
    // Without the engine RPC the device line has no relaying part.
    expect(sectionLines(starting, 'Device')[1]).toBe(
      'Network: unmetered yes; relay profile leaf since 12 min ago'
    );
  });

  it('prints only the last 3 bridge traffic lines', () => {
    const report = readyReport(
      readyEngine({
        bridgeTraffic: [1, 2, 3, 4].map(
          (i) => `[MobileChat] bridge_traffic ${i}0s out{ } in{ }`
        ),
      } as Partial<EngineDiagnostics>)
    );
    expect(
      report.split('\n').filter((l) => l.startsWith('Bridge traffic:'))
    ).toEqual([
      'Bridge traffic: bridge_traffic 20s out{ } in{ }',
      'Bridge traffic: bridge_traffic 30s out{ } in{ }',
      'Bridge traffic: bridge_traffic 40s out{ } in{ }',
    ]);
  });

  it('turns the new sections and subsections into Markdown headings', () => {
    const markdown = diagnosticsReportToMarkdown(
      buildReticulumDiagnosticsReport(fullInput())
    );
    for (const heading of [
      '## Device',
      '## Sync health',
      '## Serving',
      '## Python bridge',
      '## Recent app errors',
      '### line counts since boot',
    ]) {
      expect(markdown).toContain(`\n${heading}\n`);
    }
    // Continuation lines keep their indent inside the text block.
    expect(markdown).toContain('\n  selfDmNotifySent=1\n');
  });
});
