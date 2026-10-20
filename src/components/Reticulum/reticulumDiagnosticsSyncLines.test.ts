import { afterEach, describe, expect, it, vi } from 'vitest';

// The report module's environment, as in reticulumDiagnostics.test.ts.
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

import type { EngineSyncHealthSnapshot } from '../../reticulumChat/mobile/engineHost';
import type { EngineIoStats } from '../../reticulumChat/mobile/engineIoStats';
import type { MobileFsStats } from '../../reticulumChat/mobile/shims/fs';
import type { ReticulumChatChannelMetadataGroupDiagnostics } from '../../../electron/src/reticulum-chat';
import {
  buildReticulumDiagnosticsReport,
  formatAdminListLine,
  formatAuthorGapOutcomeLines,
  formatAuthorGapScannerLines,
  formatChannelMetadataLines,
  formatChatStorageLine,
  formatCoreNodeStatusLine,
  formatEngineIoLines,
  formatFocusCounterLines,
  formatPageActivityLines,
  formatPythonBridgeLines,
  formatPythonCpuStackLines,
  formatPythonProcessLines,
  formatRendererGoneLine,
  formatServingLines,
  formatSyncHealthLines,
  formatValidatorFailureLines,
  parseCoreAdminStatus,
  probeCoreApi,
  probeNativeBridge,
  type ReticulumDiagnosticsInput,
} from './reticulumDiagnostics';

const AT = (h: number, m: number, s: number) => Date.UTC(2026, 9, 19, h, m, s);
const NOW = AT(13, 20, 0);
const KEY = new Uint8Array(16).fill(5);

const STORAGE: MobileFsStats = {
  files: 2_317,
  byArea: { notify: 1_912, temp: 37, resources: 300, other: 68 },
  openHandles: 2_574,
  spares: 4,
  spareTarget: 256,
  reclaimable: 0,
  emfile: { count: 468, firstAt: AT(13, 0, 0), lastAt: AT(13, 18, 19) },
  topUp: {
    inFlight: true,
    inFlightMs: 12_000,
    maxMs: 14_000,
    runs: 40,
    opened: 1_024,
    failed: 0,
    lastErrorName: '',
    retryPending: false,
    watchdogRestarts: 0,
  },
  boot: { dropped: 0, evicted: 0, openFailed: 0 },
};

const group = (
  overrides: Partial<ReticulumChatChannelMetadataGroupDiagnostics>
): ReticulumChatChannelMetadataGroupDiagnostics => ({
  groupId: 1,
  localAdmin: false,
  authoritative: true,
  expectedScope: 'public',
  snapshotState: 'snapshot_current',
  publicVersion: 2,
  fullVersion: null,
  signer: 'other',
  signerAdmin: 'yes',
  customChannels: 0,
  unprojectedCreates: 0,
  skippedEvents: 0,
  skippedOwn: 0,
  skippedCreatesByOthers: 0,
  skippedOther: 0,
  deferredProjections: 0,
  deferredProjectionMaxAttempts: 0,
  unknownAdminAuthors: 0,
  deferredSnapshots: 0,
  deferredSnapshotMaxAttempts: 0,
  staleSignerSnapshots: 0,
  lastSnapshotFailure: null,
  ...overrides,
});

const CHANNELS = {
  subscribedGroups: 3,
  groups: [
    group({ groupId: 12 }),
    group({ groupId: 581, customChannels: 2 }),
    // Admin, no full snapshot yet (one deferred), creates not projected.
    group({
      groupId: 694,
      localAdmin: true,
      expectedScope: 'full',
      snapshotState: 'missing_snapshot',
      publicVersion: 3,
      fullVersion: null,
      signerAdmin: 'no',
      unprojectedCreates: 3,
      skippedEvents: 4,
      skippedOwn: 1,
      skippedCreatesByOthers: 2,
      skippedOther: 1,
      deferredSnapshots: 1,
      deferredSnapshotMaxAttempts: 2,
      lastSnapshotFailure: {
        reason: 'coordinator_timeout',
        at: NOW - 180_000,
      },
    }),
  ],
};

const IO: EngineIoStats = {
  rpc: {
    calls: 900,
    methods: [
      {
        method: 'getSummaries',
        n: 320,
        errors: 0,
        totalMs: 41_200,
        p95: 300,
        max: 1_200,
        syncMaxMs: 900,
      },
      {
        method: 'markRead',
        n: 40,
        errors: 1,
        totalMs: 2_000,
        p95: 80,
        max: 120,
        syncMaxMs: 10,
      },
    ],
  },
  flush: {
    installed: true,
    rate: { total: 9_000, recent: 615, minutes: 10 },
    recent: { n: 615, p50: 5, p95: 30, max: 120, maxAt: AT(13, 10, 0) },
  },
  commits: { total: 4_512, recent: 123, minutes: 10 },
  socketFrames: {
    rate: { total: 5_000, recent: 410, minutes: 10 },
    maxBackToBack: 37,
    maxBackToBackAt: AT(13, 1, 12),
    recentMaxBackToBack: 12,
  },
};

const DB = {
  sizeBytes: 50_541_363,
  freeBytes: 1_258_291,
  events: 120_345,
  searchRows: 98_765,
  countedAt: AT(13, 2, 11),
  indexWrites: {
    searchWritten: 1_203,
    searchUnchanged: 4_500,
    searchNoMirror: 3,
    mentionsWritten: 20,
    mentionsUnchanged: 900,
    ftsCheck: {
      state: 'trusted',
      mirrorRows: 98_765,
      ftsRows: 98_765,
      rebuilt: false,
    },
  },
};

const PYTHON_STACKS = {
  at: AT(13, 1, 11),
  totalCpuTicks: 340,
  cpuTicksByGroup: [
    { name: 'Thread (__job)', ticks: 210 },
    { name: 'presence-bridge-main', ticks: 50 },
  ],
  samples: [
    {
      group: 'presence-bridge-main',
      frames: ['loop (presence_bridge.py:20)', 'main (presence_bridge.py:10)'],
    },
    {
      group: 'Thread (__job)',
      frames: ['unpack (Packet.py:88)', 'inbound (Transport.py:1234)'],
    },
  ],
};

const BRIDGE = {
  transportStartedAtMs: AT(12, 0, 0),
  cmdQueue: 0,
  cmdQueueMax: 256,
  eventQueue: 0,
  priorityEventQueue: 0,
  respQueue: 0,
  executorIdleMs: 20,
  gilLagMsMax: 35,
  providerPendingAuth: 0,
  jsonOutDrops: 0,
  lanes: [
    {
      lane: 'rns-overlay-callback-2',
      queueDepth: 0,
      queueDepthHighWater: 1_024,
      queueMax: 1_024,
      dwellMsMax: 18_500,
      busyMsMax: 559,
      slowTaskCount: 2_038,
      droppedTasks: 11,
      busyMaxTask: 'overlay-open:announce',
    },
  ],
  providerRefused: { history: 12 },
  providerRefusedByBusyKind: {
    'history:history_budget': 7,
    'dm:pending_peer': 1,
  },
  threadCount: 63,
  openFds: 412,
  processCpuMs: 12_300,
  processCpuDeltaMs: 49_200,
  processCpuWindowMs: 120_000,
  outQueue: 0,
  outQueueHighWater: 812,
  outQueueDrops: 0,
  rejectedResourceWatchdogs: 0,
  links: {
    overlay: 12,
    audio: 0,
    inboundHandshakes: 3,
    resourceSessions: { 'in:fast': 2, 'out:bulk': 1 },
    fileLinks: 1,
    rnsActive: 18,
    rnsPending: 1,
  },
};

describe('diagnostics: storage, membership and counters (A26)', () => {
  it('prints the chat storage line', () => {
    expect(formatChatStorageLine(STORAGE, NOW)).toBe(
      'Chat storage: files 2,317 (notify 1,912, temp 37, resources 300, other 68), open handles 2,574, spares 4/256, EMFILE 468 (last 13:18:19), top-up running 12.0 s / max 14.0 s, opened 1,024, failed 0 (last error -), boot dropped 0, evicted 0, open failed 0'
    );
    expect(
      formatChatStorageLine(
        {
          ...STORAGE,
          reclaimable: 9,
          emfile: { count: 0, firstAt: 0, lastAt: 0 },
          topUp: {
            ...STORAGE.topUp,
            inFlight: false,
            inFlightMs: 0,
            failed: 32,
            lastErrorName: 'NoModificationAllowedError',
            retryPending: true,
            watchdogRestarts: 1,
          },
        },
        NOW
      )
    ).toBe(
      'Chat storage: files 2,317 (notify 1,912, temp 37, resources 300, other 68), open handles 2,574, spares 4/256 (reclaimable 9), EMFILE 0, top-up idle / max 14.0 s, retry waiting, watchdog restarts 1, opened 1,024, failed 32 (last error NoModificationAllowedError), boot dropped 0, evicted 0, open failed 0'
    );
    expect(formatChatStorageLine(null, NOW)).toBeNull();
  });

  it('prints membership failures by reason and the last failures', () => {
    const base = {
      okCount: 40,
      unavailableCount: 582,
      lastStatus: null,
      lastMs: 3,
      lastAt: NOW,
      lastError: 'TypeError: Failed to fetch',
      lastErrorAt: NOW,
      host: 'localhost:52391',
    };
    expect(
      formatValidatorFailureLines(
        {
          ...base,
          requestCount: 412,
          maxBatchSize: 30,
          failByReason: { network: 540, 'http:500': 40, stall_abort: 2 },
          firstFailAt: AT(13, 4, 23),
          lastOkAt: AT(13, 9, 2),
          recentFailures: [
            { at: AT(13, 9, 0), reason: 'network', addresses: 4 },
            { at: AT(13, 9, 30), reason: 'http:500', addresses: 1 },
          ],
        },
        NOW
      )
    ).toEqual([
      'Membership requests: 412 sent (largest batch 30); failed requests by reason: network=540 http:500=40 stall_abort=2; failing since 13:04:23; last answer 13:09:02',
      'Membership last failures: 13:09:00 network (4), 13:09:30 http:500 (1)',
    ]);
    expect(
      formatValidatorFailureLines(
        { ...base, requestCount: 12, maxBatchSize: 3, failByReason: {} },
        NOW
      )
    ).toEqual([
      'Membership requests: 12 sent (largest batch 3); no failed requests',
    ]);
    // An older worker without the counters: nothing.
    expect(formatValidatorFailureLines(base, NOW)).toEqual([]);
    expect(formatValidatorFailureLines(null, NOW)).toEqual([]);
  });

  it('prints the membership, storage and serving counters on their own lines', () => {
    expect(
      formatFocusCounterLines({
        membershipDeferred: 120,
        membershipDeferredEvicted: 3,
        membershipNullFromBackoff: 540,
        membershipPrefetchPages: 12,
        membershipPrefetchAuthors: 80,
        localImportFailure: 7,
        providerAuthSkipped: 9,
        providerAuthSkipped_live_event_entry: 5,
        providerAuthSkipped_history_page_pre_register: 3,
        providerAuthSkipped_author_range_read_check: 1,
        providerAuthEndedQueuedDropped: 2,
        dmNotifyStale: 1,
      })
    ).toEqual([
      'Membership deferrals: deferred 120, not queued 0, evicted 3, unknown from backoff 540, gap tries refunded 0',
      'Membership prefetch: pages 12, authors 80',
      'Local storage failures (not charged to peers): 7',
      'Provider auths skipped (request already gone): 9 (live_event:entry=5 history_page:pre_register=3 author_range:read_check=1)',
      'Provider auths ended while queued: 2; stale DM notifies: 1',
    ]);
    expect(formatFocusCounterLines({})).toEqual([]);
    expect(formatFocusCounterLines(undefined)).toEqual([]);
  });

  it('prints the serving policy counters (shed, stale member, arrival) on one line', () => {
    expect(
      formatFocusCounterLines({
        providerServeShed: 7,
        providerServeShed_author_range_load: 4,
        providerServeShed_history_page_late: 3,
        requesterMembershipStaleAllowed: 2,
        serveFreshOnlyAtArrival: 1,
      })
    ).toEqual([
      'Serving policy: shed as busy 7 (author_range:load=4 history_page:late=3); served on a recent member answer 2; fresh only at arrival 1',
    ]);
    expect(
      formatFocusCounterLines({ requesterMembershipStaleAllowed: 5 })
    ).toEqual([
      'Serving policy: shed as busy 0; served on a recent member answer 5; fresh only at arrival 0',
    ]);
  });

  it('prints gap repair outcomes per minute and since start', () => {
    const outcomes = {
      minutes: 10,
      recent: {
        requested: 39,
        unavailable_old: 20,
        unavailable_recent: 4,
        unavailable_undated: 7,
        'failed:resource_provider_busy': 2,
        'failed:timeout': 1,
        imported: 2,
        imported_events: 5,
      },
      total: {
        requested: 400,
        unavailable_old: 200,
        unavailable_recent: 40,
        unavailable_undated: 70,
        'failed:resource_provider_busy': 20,
        imported: 30,
        imported_events: 600,
      },
    };
    expect(formatAuthorGapOutcomeLines(outcomes)).toEqual([
      'Gap repairs per min (last 10 min): requested 3.9, unavailable 3.1 (old 2.0, recent 0.4, undated 0.7), link failed 0.3, imported 0.2 pages (0.5 events)',
      'Gap repairs since start: requested 400, unavailable 310 (old 200, recent 40, undated 70), link failed 20 (resource_provider_busy=20), imported 30 pages (600 events)',
    ]);
    // Denials not sorted by age (desktop): no split.
    expect(
      formatAuthorGapOutcomeLines({
        minutes: 0,
        recent: {},
        total: { requested: 3, unavailable: 2 },
      })
    ).toEqual([
      'Gap repairs since start: requested 3, unavailable 2, link failed 0, imported 0 pages (0 events)',
    ]);
    expect(
      formatAuthorGapOutcomeLines({ minutes: 0, recent: {}, total: {} })
    ).toEqual(['Gap repairs since start: none']);
    expect(formatAuthorGapOutcomeLines(undefined)).toEqual([]);
  });

  it('splits old gap rows into due and parked and names tails and holes', () => {
    const scanner = {
      runsSinceBoot: 0,
      runsLastMinute: 0,
      slowRuns: 0,
      failedRuns: 0,
      lastRunAgoMs: null,
      lastDurationMs: null,
      maxDurationMs: 0,
      lastWrites: 0,
      totalWrites: 0,
      lastSent: 0,
      totalSent: 0,
      lastTried: 0,
      lastScanned: 0,
      lastEligibleGroups: 0,
      nextWakeInMs: null,
      rows: {
        source: 'sql' as const,
        total: 812,
        notEligible: 0,
        parked: 400,
        due: 40,
        backoff: 300,
        quarantined: 72,
        fromSeqOne: 52,
        noPeer: 0,
        olderThanServeAge: 412,
        olderThanServeAgeDue: 12,
        olderThanServeAgeParked: 400,
        noStoredNeighbour: 30,
        singleSeqInterior: 50,
        topGroups: [],
      },
    };
    expect(formatAuthorGapScannerLines(scanner)).toEqual([
      'Gap scanner: 0 runs/min (0 since boot), last n/a, max 0 ms, slow 0, failed 0; writes last 0 total 0; sent last 0 total 0; not scheduled',
      'Gap rows: 812 (due 40, backoff 300, quarantined 72, parked 400, not subscribed 0); from=1 52, no peer 0, older than 29 d 412',
      'Gap row kinds: older than 29 d due 12 / parked 400, no stored neighbour 30, single-seq holes 50',
    ]);
  });

  it('prints serving reject reasons per type and late rejects', () => {
    const lines = formatServingLines({
      byType: {
        reticulum_chat_history_page: {
          received: 40,
          authorized: 22,
          rejected: 3,
          lateRejected: 1,
          rejectedReasons: {
            resource_provider_busy: 2,
            requester_membership_unavailable: 1,
          },
          failed: 0,
          late: 0,
          ended: 9,
        },
      },
      endedReasons: {},
      failedReasons: {},
      totalMs: null,
      engineMs: null,
      pythonMs: null,
      toWorkerMs: null,
      waiting: 0,
      oldestWaitingMs: null,
    });
    expect(lines.slice(0, 2)).toEqual([
      'history_page: received 40, authorized 22, rejected 3, failed 0, ended by Python 9',
      '  rejected by reason: resource_provider_busy=2 requester_membership_unavailable=1; 1 after Python gave up',
    ]);
  });

  it('prints the auth arrival lag per serving type when the worker sends it', () => {
    const lines = formatServingLines({
      byType: {
        reticulum_chat_live_event: {
          received: 12,
          authorized: 12,
          rejected: 0,
          lateRejected: 0,
          rejectedReasons: {},
          failed: 0,
          late: 0,
          ended: 0,
          authArrivalMs: { n: 12, p50: 30, p95: 12_000, max: 14_200, maxAt: 1 },
        },
        reticulum_chat_author_range: {
          received: 3,
          authorized: 3,
          rejected: 0,
          lateRejected: 0,
          rejectedReasons: {},
          failed: 0,
          late: 0,
          ended: 0,
        },
      },
      endedReasons: {},
      failedReasons: {},
      totalMs: null,
      engineMs: null,
      pythonMs: null,
      toWorkerMs: null,
      waiting: 0,
      oldestWaitingMs: null,
    });
    expect(lines.slice(0, 3)).toEqual([
      'live_event: received 12, authorized 12, rejected 0, failed 0, ended by Python 0',
      '  auth arrival p50 ~30 ms, p95 ~12.0 s, max 14.2 s',
      'author_range: received 3, authorized 3, rejected 0, failed 0, ended by Python 0',
    ]);
  });

  it('puts the storage line first and the counter lines last in Sync health', () => {
    const lines = formatSyncHealthLines({
      at: NOW,
      storage: STORAGE,
      engine: {
        scanner: null,
        digestQueues: null,
        queues: null,
        counters: { localImportFailure: 7 },
        focusCounters: { localImportFailure: 7 },
      },
    } as unknown as EngineSyncHealthSnapshot);
    expect(lines[0]).toMatch(/^Chat storage: files 2,317 /);
    expect(lines[lines.length - 1]).toBe(
      'Local storage failures (not charged to peers): 7'
    );
  });
});

describe('diagnostics: channel metadata, node and admin list (A27)', () => {
  it('lists problem groups first, then sums up the rest', () => {
    expect(formatChannelMetadataLines(CHANNELS, NOW)).toEqual([
      'Channel metadata: 3 subscribed groups, 1 with problems',
      'group=694: admin yes, scope full, snapshot missing (public v3, full -, signer other admin no), custom channels 0, unprojected creates 3, skipped 4 (own 1, creates by others 2, other 1), deferred snapshots 1 (max 2 tries), last snapshot failure coordinator_timeout 3 min ago',
      '(2 groups without problems: 1 with custom channels, admin in 0)',
    ]);
    expect(formatChannelMetadataLines(null, NOW)).toEqual(['Not reported']);
  });

  it('caps the problem groups at 8 lines and says how many were not checked', () => {
    const groups = Array.from({ length: 11 }, (_, i) =>
      group({ groupId: 100 + i, unprojectedCreates: i + 1 })
    );
    const lines = formatChannelMetadataLines(
      { subscribedGroups: 70, groups },
      NOW
    );
    expect(lines[0]).toBe(
      'Channel metadata: 70 subscribed groups (11 checked), 11 with problems'
    );
    // Worst first.
    expect(lines[1]).toMatch(/^group=110: .*unprojected creates 11$/);
    expect(lines).toHaveLength(10);
    expect(lines[9]).toBe('(+3 more groups with problems)');
  });

  it('reads the node sync state from /admin/status, missing fields included', () => {
    expect(
      parseCoreAdminStatus({
        height: 2_123_456,
        syncPercent: 99.5,
        isSynchronizing: true,
        numberOfConnections: 12,
        isMintingPossible: false,
      })
    ).toEqual({
      height: 2_123_456,
      syncPercent: 99.5,
      isSynchronizing: true,
      numberOfConnections: 12,
    });
    expect(parseCoreAdminStatus({ height: 5 })).toEqual({
      height: 5,
      syncPercent: null,
      isSynchronizing: null,
      numberOfConnections: null,
    });
    expect(parseCoreAdminStatus({})).toBeNull();
    expect(parseCoreAdminStatus({ height: '5', syncPercent: -1 })).toBeNull();
    expect(parseCoreAdminStatus('ok')).toBeNull();
    expect(parseCoreAdminStatus(null)).toBeNull();
    expect(
      formatCoreNodeStatusLine({
        height: 2_123_456,
        syncPercent: 99.5,
        isSynchronizing: true,
        numberOfConnections: 12,
      })
    ).toBe(
      'Node sync: height 2,123,456, 99.5% synced, synchronizing yes, 12 connections'
    );
    expect(
      formatCoreNodeStatusLine({
        height: 5,
        syncPercent: null,
        isSynchronizing: null,
        numberOfConnections: null,
      })
    ).toBe('Node sync: height 5');
    expect(formatCoreNodeStatusLine(null)).toBeNull();
  });

  describe('probeCoreApi', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('parses the body it already fetched', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                height: 9,
                syncPercent: 100,
                isSynchronizing: false,
              }),
              { status: 200 }
            )
        )
      );
      await expect(probeCoreApi()).resolves.toMatchObject({
        host: '127.0.0.1:12391',
        ok: true,
        httpStatus: 200,
        status: {
          height: 9,
          syncPercent: 100,
          isSynchronizing: false,
          numberOfConnections: null,
        },
      });
    });

    it('has no status for a body that is not JSON or an error answer', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('<html>', { status: 200 }))
      );
      const plain = await probeCoreApi();
      expect(plain.ok).toBe(true);
      expect(plain.status).toBeUndefined();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{"height":1}', { status: 401 }))
      );
      const refused = await probeCoreApi();
      expect(refused).toMatchObject({ ok: false, httpStatus: 401 });
      expect(refused.status).toBeUndefined();
    });
  });

  it('prints the admin-list fetch outcome', () => {
    expect(
      formatAdminListLine(
        {
          ok: 12,
          failed: 3,
          timedOut: 1,
          lastError: 'timeout after 15 s',
          lastErrorAt: NOW - 240_000,
          lastOkAt: NOW - 60_000,
          authoritative: true,
        },
        NOW
      )
    ).toBe(
      'Admin list: ok 12, failed 3 (1 timed out); last error timeout after 15 s, 4 min ago; last ok 60 s ago; trusted yes'
    );
    expect(
      formatAdminListLine(
        {
          ok: 0,
          failed: 0,
          timedOut: 0,
          lastError: '',
          lastErrorAt: 0,
          lastOkAt: 0,
          authoritative: false,
        },
        NOW
      )
    ).toBe('Admin list: ok 0, failed 0; last ok never; trusted no');
    expect(formatAdminListLine(undefined, NOW)).toBeNull();
  });
});

describe('diagnostics: engine time, page and native state (A28)', () => {
  it('prints RPC time, SQLite commits and flushes, socket backlog and the database', () => {
    expect(formatEngineIoLines(IO, DB, NOW)).toEqual([
      'Engine RPCs (900 since start; top by time): getSummaries n=320 total 41.2 s p95 ~300 ms max 1.2 s blocking max 900 ms; markRead n=40 total 2.0 s p95 ~80 ms max 120 ms errors 1',
      'SQLite: commits 12.3/min (last 10 min, 4,512 since start); OPFS flushes 61.5/min, flush p50 ~5 ms p95 ~30 ms max 120 ms',
      'Socket frames: 41.0/min (last 10 min); most handled back to back 37 at 13:01:12 (last 10 min 12)',
      'Chat database: 48.2 MB (free 1.2 MB), events 120,345, search rows 98,765 (counted 13:02:11); search writes 1,203 (unchanged 4,500), mention writes 20 (unchanged 900); search index check trusted',
    ]);
    expect(
      formatEngineIoLines(
        {
          ...IO,
          rpc: { calls: 0, methods: [] },
          flush: {
            installed: false,
            rate: { total: 0, recent: 0, minutes: 0 },
            recent: null,
          },
          commits: { total: 0, recent: 0, minutes: 0 },
          socketFrames: {
            rate: { total: 0, recent: 0, minutes: 0 },
            maxBackToBack: 0,
            maxBackToBackAt: null,
            recentMaxBackToBack: 0,
          },
        },
        null,
        NOW
      )
    ).toEqual([
      'Engine RPCs: none yet',
      'SQLite: commits none yet; OPFS flushes not measured',
    ]);
    expect(formatEngineIoLines(null, null, NOW)).toEqual([]);
  });

  it('prints page long tasks and summary refreshes', () => {
    expect(
      formatPageActivityLines(
        {
          installed: true,
          count: 340,
          totalMs: 41_000,
          maxMs: 7_600,
          maxAt: AT(13, 0, 1),
          over1s: 4,
          recent: { minutes: 10, count: 52, totalMs: 12_300, maxMs: 2_100 },
        },
        {
          runs: 120,
          unchanged: 40,
          coalesced: 12,
          lastMs: 120,
          maxMs: 1_200,
          totalMs: 27_600,
          lastAt: NOW - 10_000,
        },
        NOW
      )
    ).toEqual([
      'Page long tasks: 52 in the last 10 min (12.3 s in all, longest 2.1 s); since page start 340 (41.0 s, over 1 s 4, longest 7.6 s at 13:00:01)',
      'Summary refreshes: 120 (40 unchanged, 12 joined a queued one); time last 120 ms, average 230 ms, max 1.2 s; last 10 s ago',
    ]);
    expect(
      formatPageActivityLines(
        {
          installed: false,
          count: 0,
          totalMs: 0,
          maxMs: 0,
          maxAt: null,
          over1s: 0,
          recent: { minutes: 0, count: 0, totalMs: 0, maxMs: 0 },
        },
        {
          runs: 0,
          unchanged: 0,
          coalesced: 0,
          lastMs: 0,
          maxMs: 0,
          totalMs: 0,
          lastAt: 0,
        },
        NOW
      )
    ).toEqual(['Page long tasks: not measured in this WebView']);
    expect(formatPageActivityLines(undefined, undefined, NOW)).toEqual([]);
  });

  it('prints Python threads, fds, CPU, queue, links and slowest lane task', () => {
    expect(formatPythonProcessLines(BRIDGE)).toEqual([
      'Python process: threads 63, open fds 412, CPU 12.3 s since start, 41% of one core over the last 2 min, frames to Kotlin 0 (most 812, dropped 0), rejected resource watchdogs 0',
      'Python links: overlay 12, audio 0, inbound handshakes 3, resource sessions in:fast=2 out:bulk=1, file links 1; RNS active 18, pending 1',
    ]);
    expect(formatPythonProcessLines({})).toEqual([]);
    const lines = formatPythonBridgeLines(
      {
        bridge: BRIDGE,
        processStartedAtMs: AT(11, 58, 0),
        socket: null,
        cryptoBackend: 'internal',
        packetMix: [
          { key: 'rx:0/3/1', count: 120, bytes: 1_258_291 },
          { key: 'tx:0/3/4', count: 4_000, bytes: 300_000 },
        ],
      },
      NOW
    );
    expect(lines).toContain(
      '  rns-overlay-callback-2 now 0, high 1024 of 1024, dwell max 18.5 s, busy max 559 ms, slow 2038, dropped 11, slowest overlay-open:announce'
    );
    expect(lines).toContain(
      'Provider refused by busy kind (since 12:00:00): history:history_budget=7 dm:pending_peer=1'
    );
    expect(lines).toContain('Crypto backend: internal');
    expect(lines).toContain(
      'Packet mix (most bytes first; dir:type/destination/context): rx:0/3/1 120x 1.2 MB, tx:0/3/4 4,000x 293 KB'
    );
    expect(lines[lines.length - 1]).toBe('Kotlin socket: not reported');
  });

  it('prints what the resource staging folder holds, when the app reports it', () => {
    const base = {
      bridge: null,
      processStartedAtMs: AT(11, 58, 0),
      socket: null,
    };
    expect(
      formatPythonBridgeLines(
        {
          ...base,
          stagedResources: {
            files: 37,
            bytes: 4_404_019,
            oldestAgeMs: 1_500_000,
          },
        },
        NOW
      )
    ).toContain('Resource staging folder: 37 files, 4.2 MB, oldest 25 min');
    expect(
      formatPythonBridgeLines(
        { ...base, stagedResources: { files: 0, bytes: 0, oldestAgeMs: 0 } },
        NOW
      )
    ).toContain('Resource staging folder: 0 files, 0 B');
    expect(
      formatPythonBridgeLines(base, NOW).some((line) =>
        line.startsWith('Resource staging folder')
      )
    ).toBe(false);
  });

  it('prints the top frames of Python CPU samples, the packet thread first', () => {
    expect(formatPythonCpuStackLines(PYTHON_STACKS, NOW)).toEqual([
      'Python CPU samples (13:01:11; ticks of 10 ms: total 340, Thread (__job) 210, presence-bridge-main 50):',
      '  Thread (__job): unpack (Packet.py:88) < inbound (Transport.py:1234)',
      '  presence-bridge-main: loop (presence_bridge.py:20) < main (presence_bridge.py:10)',
    ]);
    expect(formatPythonCpuStackLines(null, NOW)).toEqual([]);
    expect(
      formatPythonCpuStackLines({ ...PYTHON_STACKS, samples: [] }, NOW)
    ).toEqual([]);
  });

  it('says when the previous page ended because the renderer died', () => {
    const gone = { at: AT(13, 0, 1), crashed: true, count: 2 };
    expect(formatRendererGoneLine(gone, AT(13, 0, 5), NOW)).toBe(
      'Previous page ended: renderer gone (crashed yes) at 13:00:01; 2 since install'
    );
    expect(formatRendererGoneLine(gone, AT(13, 10, 0), NOW)).toBe(
      'Last renderer death: 13:00:01 (20 min ago), crashed yes; 2 since install'
    );
    expect(formatRendererGoneLine(null, AT(13, 0, 5), NOW)).toBeNull();
  });

  it('reads crypto, packet mix and the renderer record from the native probe', async () => {
    nativeProbe.platform = 'android';
    try {
      nativeProbe.getStatus.mockResolvedValueOnce({
        started: true,
        cryptoBackend: 'PyCA <x>',
        packetMix: [
          { key: 'tx:0/3/4', count: 4_000, bytes: 300_000 },
          { key: 'rx:0/3/1', count: 120, bytes: 1_258_291 },
          null,
        ],
        bridge: {
          threadCount: 63,
          openFds: 'many',
          links: { overlay: 2, resourceSessions: { 'in:fast': 1 } },
          providerRefusedByBusyKind: { 'history:history_budget': 7 },
          lanes: [{ lane: 'x', busyMaxTask: 'cmd:send reticulum' }],
        },
        native: {
          processStartedAtMs: AT(11, 58, 0),
          rendererGone: { at: AT(13, 0, 1), crashed: true, count: 2 },
          stagedResources: { files: 3, bytes: 'x', oldestAgeMs: 61_000 },
        },
      });
      await expect(probeNativeBridge()).resolves.toEqual({
        bridge: {
          threadCount: 63,
          links: { overlay: 2, resourceSessions: { 'in:fast': 1 } },
          providerRefusedByBusyKind: { 'history:history_budget': 7 },
          lanes: [{ lane: 'x', busyMaxTask: 'cmd:send_reticulum' }],
        },
        processStartedAtMs: AT(11, 58, 0),
        socket: null,
        cryptoBackend: 'PyCA__x_',
        packetMix: [
          { key: 'rx:0/3/1', count: 120, bytes: 1_258_291 },
          { key: 'tx:0/3/4', count: 4_000, bytes: 300_000 },
        ],
        rendererGone: { at: AT(13, 0, 1), crashed: true, count: 2 },
        stagedResources: { files: 3, bytes: 0, oldestAgeMs: 61_000 },
      });
    } finally {
      nativeProbe.platform = 'web';
    }
  });
});

describe('diagnostics: the report with a newer engine', () => {
  const ONLINE_STATE: ReticulumDiagnosticsInput['state'] = {
    phase: 'online',
    status: null,
    error: null,
    bridgeError: null,
    bridgeWarning: null,
    chatEngineState: 'ready',
    chatEngineSince: 0,
    chatEngineBootMs: 1_700,
  };
  const HEALTH = {
    at: NOW,
    rpcQueueMs: 5,
    workerStartedAt: AT(12, 0, 0),
    loop: { installed: false },
    bridgeEvents: { toWorker: null, toWorkerRecent: null, pythonQueue: null },
    native: null,
    serving: null,
    engine: {
      scanner: null,
      digestQueues: null,
      queues: null,
      counters: {},
      channels: CHANNELS,
      db: DB,
      focusCounters: { membershipDeferred: 3 },
    },
    log: { bootFaultOverflow: 0, keyCounts: [], bootFaultRepeatsFolded: 197 },
    storage: STORAGE,
    io: IO,
    pythonCpuStacks: PYTHON_STACKS,
  } as unknown as EngineSyncHealthSnapshot;
  const input = (
    syncHealth: EngineSyncHealthSnapshot | null
  ): ReticulumDiagnosticsInput => ({
    now: NOW,
    version: '0.0.19',
    state: ONLINE_STATE,
    onlineCount: 3,
    deviceOnline: true,
    webView: {
      userAgent: 'test',
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      webAssembly: true,
      opfs: true,
      crossOriginIsolated: false,
      jsLoopMs: 30,
    },
    engine: {
      readiness: { state: 'ready', revision: 1, since: 0 },
      stateAgeSec: 10,
      workerAlive: true,
      workerHasDirectBridge: true,
      pendingRpcCount: 0,
      apiHost: 'node.example.com:12391',
      apiKeyConfigured: false,
      engineLogs: [
        `${new Date(NOW - 1_000).toISOString()} warn [MobileChat] membership_fetch_failed reason=network host=node.example.com:12391 addresses=4`,
      ],
      engineBootFaults: [],
      validator: {
        okCount: 1,
        unavailableCount: 4,
        lastStatus: null,
        lastMs: 3,
        lastAt: NOW,
        lastError: 'TypeError: Failed to fetch',
        lastErrorAt: NOW,
        host: 'node.example.com:12391',
        requestCount: 5,
        maxBatchSize: 4,
        failByReason: { network: 1 },
        firstFailAt: NOW - 1_000,
        lastOkAt: null,
        recentFailures: [{ at: NOW - 1_000, reason: 'network', addresses: 4 }],
      },
      resourceSessions: null,
      membershipProbe: null,
      syncHealth,
      bridgeTraffic: [
        'bridge_traffic 60s out{ accept=3 } in{ reticulum_chat_resource:receiving:event=145 }',
      ],
      oldestRpc: null,
    },
    coreApi: {
      host: 'node.example.com:12391',
      ok: true,
      httpStatus: 200,
      ms: 40,
      status: {
        height: 2_123_456,
        syncPercent: 100,
        isSynchronizing: false,
        numberOfConnections: 12,
      },
    },
    sendFailures: [],
    adminList: {
      ok: 2,
      failed: 1,
      timedOut: 1,
      lastError: 'timeout after 15 s',
      lastErrorAt: NOW - 240_000,
      lastOkAt: NOW - 60_000,
      authoritative: true,
    },
    pageLongTasks: {
      installed: true,
      count: 3,
      totalMs: 300,
      maxMs: 120,
      maxAt: NOW - 5_000,
      over1s: 0,
      recent: { minutes: 1, count: 3, totalMs: 300, maxMs: 120 },
    },
    pseudonymKey: KEY,
  });
  const section = (report: string, name: string): string[] => {
    const lines = report.split('\n');
    const start = lines.indexOf(`--- ${name} ---`);
    if (start < 0) return [];
    const end = lines.findIndex((l, i) => i > start && l.startsWith('--- '));
    return lines.slice(start + 1, end < 0 ? undefined : end).filter(Boolean);
  };

  it('adds the new sections and lines, pseudonymised', () => {
    const report = buildReticulumDiagnosticsReport(input(HEALTH));
    const sections = report.split('\n').filter((l) => l.startsWith('--- '));
    expect(sections.indexOf('--- Channel metadata ---')).toBe(
      sections.indexOf('--- Sync health ---') + 1
    );
    const channels = section(report, 'Channel metadata');
    expect(channels[0]).toBe(
      'Channel metadata: 3 subscribed groups, 1 with problems'
    );
    expect(channels[1]).toMatch(/^group=<id-[0-9a-f]{6}>: admin yes, /);
    expect(report).not.toMatch(/\b694\b/);
    const chat = section(report, 'Chat engine');
    expect(chat).toContain(
      'Bridge traffic: bridge_traffic 60s out{ accept=3 } in{ reticulum_chat_resource:receiving:event=145 }'
    );
    expect(chat.some((l) => l.startsWith('Engine RPCs (900 since start'))).toBe(
      true
    );
    expect(chat.some((l) => l.startsWith('Chat database: 48.2 MB'))).toBe(true);
    expect(
      chat.some((l) => l.startsWith('Page long tasks: 3 in the last 1 min'))
    ).toBe(true);
    const sync = section(report, 'Sync health');
    expect(sync[0]).toMatch(/^Chat storage: files 2,317 /);
    expect(sync).toContain(
      'Membership deferrals: deferred 3, not queued 0, evicted 0, unknown from backoff 0, gap tries refunded 0'
    );
    const python = section(report, 'Python bridge');
    expect(python).toContain(
      '  Thread (__job): unpack (Packet.py:88) < inbound (Transport.py:1234)'
    );
    const core = section(report, 'Core API');
    expect(core[0]).toMatch(
      /^Node: <node-[0-9a-f]{6}>:12391, \/admin\/status: ok/
    );
    expect(core).toContain(
      'Node sync: height 2,123,456, 100% synced, synchronizing no, 12 connections'
    );
    expect(core).toContain(
      'Membership requests: 5 sent (largest batch 4); failed requests by reason: network=1; failing since 13:19:59; last answer never'
    );
    expect(core).toContain(
      'Admin list: ok 2, failed 1 (1 timed out); last error timeout after 15 s, 4 min ago; last ok 60 s ago; trusted yes'
    );
    const log = section(report, 'Engine log (faults, then tail)');
    expect(
      log.some((l) =>
        /membership_fetch_failed reason=network host=<node-[0-9a-f]{6}>:12391 addresses=4$/.test(
          l
        )
      )
    ).toBe(true);
    expect(log).toContain(
      'Boot buffer: 197 more repeats of per-group channel metadata and slow statement warnings not kept (3 kept per kind and group)'
    );
    expect(report).not.toContain('node.example.com');
  });

  it('keeps an older engine snapshot to the old lines', () => {
    const old = {
      ...HEALTH,
      engine: { scanner: null, digestQueues: null, queues: null, counters: {} },
      log: { bootFaultOverflow: 0, keyCounts: [] },
      storage: undefined,
      io: undefined,
      pythonCpuStacks: undefined,
    } as unknown as EngineSyncHealthSnapshot;
    const report = buildReticulumDiagnosticsReport({
      ...input(old),
      adminList: undefined,
      pageLongTasks: undefined,
    });
    expect(report).not.toContain('--- Channel metadata ---');
    for (const absent of [
      'Chat storage',
      'Engine RPCs',
      'Chat database',
      'Page long tasks',
      'Python CPU samples',
      'Membership deferrals',
      'Admin list',
    ]) {
      expect(report).not.toContain(absent);
    }
    expect(section(report, 'Sync health')).toEqual([
      'Gap scanner: not reported',
      'Digest queues: not reported',
      'Engine queues: not reported',
      'Engine counters since start: none',
    ]);
  });
});
