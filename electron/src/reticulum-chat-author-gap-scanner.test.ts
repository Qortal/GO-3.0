import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The background author-gap scanner and the author-gap bookkeeping on the
// default vitest statement mock. The mock does not model
// rchat_missing_stream_ranges, so every row here lives in the database's
// in-memory mirror (memoryMissingRanges): the no-SQL path must keep working.
// reticulum-chat-author-gap-scanner-sql.test.ts runs the same logic on real
// SQL.
vi.mock('./logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./logger')>()),
  log: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import * as logger from './logger';
import { ReticulumChatManager } from './reticulum-chat';
import { ReticulumChatDatabase } from './reticulum-chat-db';

const PROVIDER = 'a'.repeat(32);
const LOCAL = 'b'.repeat(32);
const STREAM = 'c'.repeat(32);
const AUTHOR = 'QscannerAuthor';
const OWN = 'QownAccountAddress';
const NOW = 100_000;

type Clock = { now: number };

const managers: ReticulumChatManager[] = [];
const databases: ReticulumChatDatabase[] = [];
const tempRoots: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const db of databases.splice(0)) db.close();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  vi.mocked(logger.log).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.info).mockClear();
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-gap-scanner-'));
  tempRoots.push(root);
  return path.join(root, 'reticulum-chat.db');
}

function makeManager(
  clock: Clock,
  getVerifiedReticulumPeers: () => Array<{
    destinationHash: string;
    address: string;
    lastSeen: number;
  }> = () => [
    { destinationHash: PROVIDER, address: 'Qprovider', lastSeen: clock.now },
  ],
  extra: Record<string, unknown> = {}
): ReticulumChatManager {
  const manager = new ReticulumChatManager({
    dbPath: tempDbPath(),
    bridge: {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => LOCAL,
    } as any,
    now: () => clock.now,
    getVerifiedReticulumPeers,
    ...extra,
  });
  managers.push(manager);
  return manager;
}

const db = (manager: ReticulumChatManager): ReticulumChatDatabase =>
  (manager as any).db;

/** Local + subscribed groups with PROVIDER as a subscribed peer. */
function joinGroups(
  manager: ReticulumChatManager,
  local: Array<number | { groupId: number; localAddress: string }>,
  subscribed: number[]
): void {
  manager.setLocalGroupMemberships(local as any);
  for (const groupId of subscribed) {
    manager.subscribeGroup(groupId);
    (manager as any).notePeerSubscription(PROVIDER, groupId, true);
  }
}

function seed(
  manager: ReticulumChatManager,
  groupId: number,
  from: number,
  to: number,
  next: number,
  author = AUTHOR,
  peer = PROVIDER
): void {
  db(manager).upsertMissingRange(groupId, author, STREAM, from, to, peer, next);
}

function row(
  manager: ReticulumChatManager,
  groupId: number,
  from: number,
  to = from,
  author = AUTHOR
) {
  return db(manager).getMissingRange(groupId, author, STREAM, from, to);
}

/** Rows of the mirror, keyed like the database does. */
function snapshot(manager: ReticulumChatManager): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of (db(manager) as any).memoryMissingRanges) {
    out.set(key, JSON.stringify(value));
  }
  return out;
}

function changedKeys(
  before: Map<string, string>,
  after: Map<string, string>
): string[] {
  return [...after.keys()].filter((key) => before.get(key) !== after.get(key));
}

const writes = (manager: ReticulumChatManager): number =>
  db(manager).getMissingRangeWriteCount();

const dueAt = (manager: ReticulumChatManager): number =>
  (manager as any).backgroundAuthorGapRepairDueAt;

const gate = (manager: ReticulumChatManager, groupId: number) =>
  (manager as any).backgroundAuthorGapGroupNextAttemptAt.get(groupId);

/** What the scanner timer does when it fires: clear itself, then run. */
function fireScanner(manager: ReticulumChatManager): void {
  const m = manager as any;
  if (m.backgroundAuthorGapRepairTimer) {
    clearTimeout(m.backgroundAuthorGapRepairTimer);
  }
  m.backgroundAuthorGapRepairTimer = null;
  m.backgroundAuthorGapRepairDueAt = 0;
  m.processBackgroundAuthorGapRepair();
}

function mockRangeRequests(manager: ReticulumChatManager) {
  return vi
    .spyOn(manager as any, 'sendAuthorRangeRequest')
    .mockResolvedValue({ ok: true });
}

const requestGroups = (spy: { mock: { calls: unknown[][] } }): number[] =>
  spy.mock.calls.map((call) => Number((call[1] as { g: number }).g));

const logLines = (): string[] =>
  vi.mocked(logger.log).mock.calls.map((call) => call.map(String).join(' '));

describe('background author-gap scanner (mirror path)', () => {
  it('one row per eligible group, writes only what it tried', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    joinGroups(manager, [11, 12, 13], [11, 12, 13]);
    for (const groupId of [11, 12, 13]) {
      for (let k = 0; k < 5; k += 1) {
        seed(manager, groupId, k * 10 + 1, k * 10 + 5, NOW - 1_000 + k);
      }
    }
    const requests = mockRangeRequests(manager);
    const before = snapshot(manager);
    const writesBefore = writes(manager);

    fireScanner(manager);

    expect(requests).toHaveBeenCalledTimes(3);
    expect(new Set(requestGroups(requests))).toEqual(new Set([11, 12, 13]));
    expect(writes(manager) - writesBefore).toBe(3);
    const after = snapshot(manager);
    expect(changedKeys(before, after)).toHaveLength(3);
    for (const groupId of [11, 12, 13]) {
      // The oldest due row is claimed, every other row is untouched.
      expect(row(manager, groupId, 1, 5)?.attempts).toBe(1);
      for (let k = 1; k < 5; k += 1) {
        expect(row(manager, groupId, k * 10 + 1, k * 10 + 5)).toMatchObject({
          attempts: 0,
          nextAttemptAt: NOW - 1_000 + k,
        });
      }
    }
  });

  it('skips non-local, unsubscribed, gated and active groups', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    joinGroups(manager, [5, 6, 7, 8], [5, 6, 7]);
    for (const groupId of [5, 6, 7, 8, 9]) {
      seed(manager, groupId, 1, 1, NOW - 500);
      seed(manager, groupId, 3, 3, NOW - 400);
    }
    (manager as any).backgroundAuthorGapGroupNextAttemptAt.set(7, NOW + 3_000);
    (manager as any).pendingAuthorRangeRequests.set('r6', {
      groupId: 6,
      peerHash: PROVIDER,
      expiresAt: NOW + 10_000,
      ranges: [],
      persistedRanges: [],
    });
    const pick = vi.spyOn(db(manager), 'getBackgroundMissingRangeCandidates');
    const requests = mockRangeRequests(manager);
    const before = snapshot(manager);

    fireScanner(manager);

    expect(pick).toHaveBeenCalledTimes(1);
    expect([...(pick.mock.calls[0][1] as Iterable<number>)]).toEqual([5]);
    expect(requestGroups(requests)).toEqual([5]);
    // Group 7's gate is the earliest wake.
    expect(dueAt(manager)).toBe(NOW + 3_000);
    // Non-local, unsubscribed, gated and active groups are never rewritten.
    const changed = changedKeys(before, snapshot(manager));
    expect(changed).toHaveLength(1);
    expect(changed[0].startsWith('5:')).toBe(true);
  });

  it('open chat first, at most 4 requests per run', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    const groups = [21, 22, 23, 24, 25, 26];
    joinGroups(manager, groups, groups);
    for (const groupId of groups) {
      // Group 26 has the newest rows, so it would go last by age.
      seed(manager, groupId, 1, 1, groupId === 26 ? NOW - 10 : NOW - 1_000);
    }
    (manager as any).activeChannelSubscriptions.set(26, new Set(['general']));
    const send = vi
      .spyOn(manager as any, 'sendAuthorRangeRepairRequests')
      .mockReturnValue(1);

    fireScanner(manager);

    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls[0][0]).toBe(26);
    // Due, untried groups remain: the 250 ms follow-up.
    expect(dueAt(manager)).toBe(NOW + 250);
    const firstRun = send.mock.calls.map((call) => Number(call[0]));

    fireScanner(manager);

    expect(send).toHaveBeenCalledTimes(6);
    const secondRun = send.mock.calls.slice(4).map((call) => Number(call[0]));
    expect(new Set([...firstRun, ...secondRun])).toEqual(new Set(groups));
    expect(dueAt(manager)).toBe(NOW + 5_000);
  });

  it('own-account rows first, alternating when they stall', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    joinGroups(manager, [{ groupId: 1, localAddress: OWN }], [1]);
    seed(manager, 1, 1, 1, NOW - 100, 'Qother');
    seed(manager, 1, 50, 50, NOW - 10, OWN);
    const select = vi
      .spyOn(manager as any, 'selectAuthorGapRepairPeer')
      .mockReturnValue('');
    const triedAuthors = (): string[] =>
      select.mock.calls.map((call) => String((call[1] as { a: string }).a));
    const stalled = (): Set<number> =>
      (manager as any).backgroundAuthorGapOwnRowStalledGroups;

    fireScanner(manager);
    expect(triedAuthors()).toEqual([OWN]);
    expect(stalled().has(1)).toBe(true);

    clock.now += 5_000;
    fireScanner(manager);
    expect(triedAuthors()).toEqual([OWN, 'Qother']);
    expect(stalled().has(1)).toBe(false);

    clock.now += 5_000;
    fireScanner(manager);
    expect(triedAuthors()).toEqual([OWN, 'Qother', OWN]);
    expect(stalled().has(1)).toBe(true);

    clock.now += 5_000;
    fireScanner(manager);
    expect(triedAuthors().slice(-1)).toEqual(['Qother']);

    select.mockReturnValue(PROVIDER);
    const send = vi
      .spyOn(manager as any, 'sendAuthorRangeRepairRequests')
      .mockReturnValue(1);
    clock.now += 5_000;
    fireScanner(manager);
    expect(triedAuthors().slice(-1)).toEqual([OWN]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(stalled().has(1)).toBe(false);

    // A pick that sent keeps the own row first.
    clock.now += 5_000;
    fireScanner(manager);
    expect(triedAuthors().slice(-1)).toEqual([OWN]);
    expect(stalled().has(1)).toBe(false);
  });

  it('drops the own-row stall flag of a group that was left', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    joinGroups(manager, [1, 2], [1, 2]);
    (manager as any).backgroundAuthorGapOwnRowStalledGroups.add(1);
    (manager as any).backgroundAuthorGapOwnRowStalledGroups.add(2);
    manager.setLocalGroupMemberships([2]);

    fireScanner(manager);

    expect([
      ...(manager as any).backgroundAuthorGapOwnRowStalledGroups,
    ]).toEqual([2]);
  });

  it('never re-arms at 250 ms when nothing is due', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    joinGroups(manager, [41, 42], [41, 42]);
    for (const groupId of [41, 42]) {
      for (let k = 0; k < 3; k += 1) {
        seed(manager, groupId, k * 10 + 1, k * 10 + 1, NOW - 100 + k);
      }
    }
    const requests = mockRangeRequests(manager);

    fireScanner(manager);

    expect(requests).toHaveBeenCalledTimes(2);
    expect(dueAt(manager)).toBe(NOW + 5_000);
    const writesBefore = writes(manager);

    fireScanner(manager);
    fireScanner(manager);

    expect(requests).toHaveBeenCalledTimes(2);
    expect(writes(manager) - writesBefore).toBe(0);
    expect(dueAt(manager)).toBe(NOW + 5_000);
  });

  it('gives every group of a 500-row backlog a turn and writes only claims', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    const groups = Array.from({ length: 10 }, (_, index) => 61 + index);
    joinGroups(manager, groups, groups);
    for (const groupId of groups) {
      for (let k = 0; k < 50; k += 1) {
        seed(
          manager,
          groupId,
          k * 10 + 1,
          k * 10 + 5,
          NOW - 1_000 - ((groupId * 7 + k * 3) % 97)
        );
      }
    }
    expect((db(manager) as any).memoryMissingRanges.size).toBe(500);
    const requests = mockRangeRequests(manager);
    const before = snapshot(manager);
    const writesBefore = writes(manager);

    // ceil(10 groups / 4 sends) = 3 runs at the same now.
    fireScanner(manager);
    expect(requests).toHaveBeenCalledTimes(4);
    expect(dueAt(manager)).toBe(NOW + 250);
    fireScanner(manager);
    expect(requests).toHaveBeenCalledTimes(8);
    expect(dueAt(manager)).toBe(NOW + 250);
    fireScanner(manager);
    expect(requests).toHaveBeenCalledTimes(10);
    expect(dueAt(manager)).toBe(NOW + 5_000);

    expect(new Set(requestGroups(requests))).toEqual(new Set(groups));
    expect(writes(manager) - writesBefore).toBe(10);
    const changed = changedKeys(before, snapshot(manager));
    expect(changed).toHaveLength(10);
    expect(new Set(changed.map((key) => Number(key.split(':')[0])))).toEqual(
      new Set(groups)
    );
    // One more run at the same now: nothing is due outside the gates.
    fireScanner(manager);
    expect(requests).toHaveBeenCalledTimes(10);
    expect(writes(manager) - writesBefore).toBe(10);
  });

  it('gates count from the end of the run', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    joinGroups(manager, [51], [51]);
    seed(manager, 51, 1, 1, NOW - 100);
    vi.spyOn(manager as any, 'selectAuthorGapRepairPeer').mockImplementation(
      () => {
        clock.now += 6_000;
        return '';
      }
    );

    fireScanner(manager);

    expect(gate(manager, 51)).toBe(clock.now + 5_000);
    expect(row(manager, 51, 1)?.nextAttemptAt).toBe(clock.now + 5_000);
    expect(dueAt(manager)).toBeGreaterThan(clock.now);
  });

  it('logs slow runs even with sent=0', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    joinGroups(manager, [52], [52]);
    seed(manager, 52, 1, 1, NOW - 100);
    const database = db(manager);
    const original =
      database.getBackgroundMissingRangeCandidates.bind(database);
    vi.spyOn(
      database,
      'getBackgroundMissingRangeCandidates'
    ).mockImplementation((...args) => {
      const end = Date.now() + 60;
      while (Date.now() < end) {
        // Busy-wait: a slow pick.
      }
      return original(...args);
    });
    vi.spyOn(manager as any, 'selectAuthorGapRepairPeer').mockReturnValue('');

    fireScanner(manager);

    const line = logLines().find((entry) =>
      entry.includes('background_author_gap_repair sent=0')
    );
    expect(line).toBeDefined();
    expect(line).toContain('tried=1');
    expect(line).toContain('groups=1');
    expect(line).toContain('writes=1');
    const duration = Number(/duration_ms=(\d+)/.exec(line!)?.[1]);
    expect(duration).toBeGreaterThanOrEqual(50);
    expect((manager as any).getAuthorGapScannerDiagnostics().slowRuns).toBe(1);
  });

  it('fast runs that sent nothing are not logged', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    joinGroups(manager, [53], [53]);
    seed(manager, 53, 1, 1, NOW - 100);
    vi.spyOn(manager as any, 'selectAuthorGapRepairPeer').mockReturnValue('');

    fireScanner(manager);

    expect(
      logLines().some((entry) => entry.includes('background_author_gap_repair'))
    ).toBe(false);
  });

  it('a failing run is logged and retried in a minute', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    joinGroups(manager, [54], [54]);
    seed(manager, 54, 1, 1, NOW - 100);
    vi.spyOn(
      db(manager),
      'getBackgroundMissingRangeCandidates'
    ).mockImplementation(() => {
      throw new Error('SQLITE_BUSY: database is locked');
    });

    expect(() => fireScanner(manager)).not.toThrow();

    const warned = vi
      .mocked(logger.warn)
      .mock.calls.map((call) => call.map(String).join(' '));
    expect(
      warned.some((entry) =>
        entry.includes('background_author_gap_repair_failed')
      )
    ).toBe(true);
    expect(dueAt(manager)).toBe(NOW + 60_000);
    const stats = (manager as any).getAuthorGapScannerDiagnostics();
    expect(stats.failedRuns).toBe(1);
    expect(stats.runsSinceBoot).toBe(1);
  });

  it('reports scanner stats', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    joinGroups(manager, [31, 32, 33], [31, 32]);
    for (const groupId of [31, 32]) {
      seed(manager, groupId, 1, 1, NOW - 200);
      seed(manager, groupId, 3, 3, NOW - 100);
    }
    seed(manager, 33, 1, 1, NOW - 200);
    mockRangeRequests(manager);

    fireScanner(manager); // 2 claims
    fireScanner(manager); // everything gated
    clock.now += 5_000;
    const writesBeforeLast = writes(manager);
    fireScanner(manager); // the second row of each group
    const lastWrites = writes(manager) - writesBeforeLast;

    const stats = (manager as any).getAuthorGapScannerDiagnostics();
    expect(stats).toMatchObject({
      runsSinceBoot: 3,
      runsLastMinute: 3,
      failedRuns: 0,
      lastRunAgoMs: 0,
      lastWrites,
      lastSent: 2,
      totalSent: 4,
      lastTried: 2,
      lastScanned: 2,
      lastEligibleGroups: 2,
    });
    expect(lastWrites).toBe(2);
    expect(stats.totalWrites).toBe(4);
    expect(stats.maxDurationMs).toBeGreaterThanOrEqual(0);
    expect(stats.nextWakeInMs).toBe(dueAt(manager) - clock.now);
    expect(stats.rows).toMatchObject({
      source: 'memory',
      total: 5,
      notEligible: 1,
      parked: 0,
      due: 0,
      backoff: 4,
      quarantined: 0,
      fromSeqOne: 3,
      noPeer: 0,
      olderThanServeAge: 0,
      topGroups: [
        { groupId: 31, rows: 2, due: 0, eligible: true },
        { groupId: 32, rows: 2, due: 0, eligible: true },
        { groupId: 33, rows: 1, due: 1, eligible: false },
      ],
    });

    clock.now += 61_000;
    expect(
      (manager as any).getAuthorGapScannerDiagnostics().runsLastMinute
    ).toBe(0);
  });

  it('reports engine queues without side effects', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    const m = manager as any;
    m.chatResourceQueue.push('k1', 'k2');
    m.chatResourceItems.set('k1', { key: 'k1', enqueuedAt: NOW - 5_000 });
    m.chatResourceItems.set('k2', { key: 'k2', enqueuedAt: NOW - 1_000 });
    m.chatResourceQueueStats.processed = 7;
    m.chatResourceQueueStats.protectedOverflow = 1;
    m.pendingEventPulls.set('p1', {});
    m.requestedEventPulls.set('q1', NOW);
    m.requestedEventPulls.set('q2', NOW);
    const timerBefore = m.backgroundAuthorGapRepairTimer;

    expect(manager.getEngineQueueDiagnostics()).toEqual({
      chatResource: {
        queued: 2,
        items: 2,
        oldestQueuedMs: 5_000,
        active: false,
        processed: 7,
        coalesced: 0,
        dropped: 0,
        protectedOverflow: 1,
      },
      eventPulls: { pending: 1, requested: 2 },
      historyServeQueue: 0,
      relayGroupControl: true,
    });
    expect(m.backgroundAuthorGapRepairTimer).toBe(timerBefore);

    m.chatResourceItems.clear();
    expect(
      manager.getEngineQueueDiagnostics().chatResource.oldestQueuedMs
    ).toBeNull();
  });
});

describe('author-gap bookkeeping (mirror path)', () => {
  it('scheduleMissingRange skips an UPDATE that changes nothing', () => {
    const database = new ReticulumChatDatabase(tempDbPath());
    databases.push(database);
    const peer = 'd'.repeat(32);
    const other = 'e'.repeat(32);
    database.ensureMissingRange(41, AUTHOR, STREAM, 1, 1, '');
    const schedule = (p: string, next: number) =>
      database.scheduleMissingRange(41, AUTHOR, STREAM, 1, 1, p, next);

    let before = database.getMissingRangeWriteCount();
    const first = schedule(peer, 200_000);
    expect(database.getMissingRangeWriteCount() - before).toBe(1);

    before = database.getMissingRangeWriteCount();
    const again = schedule(peer, 200_000);
    expect(database.getMissingRangeWriteCount() - before).toBe(0);
    expect(again).toEqual(first);

    before = database.getMissingRangeWriteCount();
    expect(schedule(peer, 300_000)?.nextAttemptAt).toBe(300_000);
    expect(database.getMissingRangeWriteCount() - before).toBe(1);

    // MAX keeps the later attempt: nothing to write.
    before = database.getMissingRangeWriteCount();
    expect(schedule(peer, 250_000)?.nextAttemptAt).toBe(300_000);
    expect(database.getMissingRangeWriteCount() - before).toBe(0);

    before = database.getMissingRangeWriteCount();
    expect(schedule(other, 250_000)?.preferredPeer).toBe(other);
    expect(database.getMissingRangeWriteCount() - before).toBe(1);
  });

  function gapRanges(count: number) {
    return Array.from({ length: count }, (_, k) => ({
      a: 'QgapAuthor',
      s: STREAM,
      from: 2 * k + 2,
      to: 2 * k + 2,
    }));
  }

  it('a digest item with 20 known gaps and nothing changed makes 0 writes', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    joinGroups(manager, [59], [59]);
    const ranges = gapRanges(20);

    let before = writes(manager);
    expect(
      (manager as any).recordAuthorGapRanges(
        59,
        PROVIDER,
        ranges,
        'group_state_digest_v3'
      )
    ).toBe(20);
    expect(writes(manager) - before).toBeGreaterThan(0);

    clock.now += 1_000;
    vi.mocked(logger.log).mockClear();
    before = writes(manager);
    expect(
      (manager as any).recordAuthorGapRanges(
        59,
        PROVIDER,
        ranges,
        'group_state_digest_v3'
      )
    ).toBe(20);
    expect(writes(manager) - before).toBe(0);
    for (const range of ranges) {
      expect(
        db(manager).getMissingRange(59, range.a, range.s, range.from, range.to)
      ).toMatchObject({ preferredPeer: PROVIDER, nextAttemptAt: NOW + 60_000 });
    }
    expect(
      logLines().some((entry) =>
        entry.includes('gaps=20 unchanged=20 writes=0')
      )
    ).toBe(true);
  });

  it('builds the candidate list once per call', () => {
    const clock = { now: NOW };
    const verified = vi.fn(() => [
      { destinationHash: PROVIDER, address: 'Qprovider', lastSeen: clock.now },
    ]);
    const leases = vi.fn(() => [
      {
        destinationHash: PROVIDER,
        address: 'QgapAuthor',
        sessionId: 'lease',
        lastSeen: clock.now,
        expiresAt: clock.now + 45_000,
      },
    ]);
    const manager = makeManager(clock, verified, {
      getAccountEndpointLeases: leases,
    });
    joinGroups(manager, [59], [59]);
    verified.mockClear();
    leases.mockClear();

    expect(
      (manager as any).recordAuthorGapRanges(
        59,
        PROVIDER,
        gapRanges(20),
        'group_state_digest_v3'
      )
    ).toBe(20);

    // Old code: once per gap (20 each).
    expect(verified).toHaveBeenCalledTimes(1);
    expect(leases).toHaveBeenCalledTimes(1);
  });

  it('ranks candidates exactly like the per-range lookup', () => {
    const clock = { now: NOW };
    const p1 = '1'.repeat(32);
    const p2 = '2'.repeat(32);
    const p3 = '3'.repeat(32);
    const manager = makeManager(
      clock,
      () => [
        { destinationHash: p2, address: 'Qp2', lastSeen: NOW - 50 },
        { destinationHash: p3, address: 'Qp3', lastSeen: NOW - 10 },
        { destinationHash: LOCAL, address: 'Qlocal', lastSeen: NOW },
      ],
      {
        getAccountEndpointLeases: () => [
          {
            destinationHash: p1,
            address: 'QauthorX',
            sessionId: 's1',
            lastSeen: NOW - 100,
            expiresAt: NOW + 45_000,
          },
          {
            destinationHash: p2,
            address: 'QauthorX',
            sessionId: 's2',
            lastSeen: NOW - 5,
            expiresAt: NOW + 45_000,
          },
          {
            destinationHash: p3,
            address: 'QauthorY',
            sessionId: 's3',
            lastSeen: NOW - 1,
            expiresAt: NOW + 45_000,
          },
        ],
      }
    );
    joinGroups(manager, [70], []);
    manager.subscribeGroup(70);
    (manager as any).notePeerSubscription(p2, 70, true);
    (manager as any).notePeerSubscription(p3, 70, true);
    (manager as any).notePeerSubscription(LOCAL, 70, true);
    const range = (a: string) => ({ a, s: STREAM, from: 1, to: 1 });

    // Author endpoints by lastSeen desc, then an attributable preferred
    // peer, then subscribed verified peers by lastSeen desc; never local.
    expect(
      (manager as any).getAuthorGapRepairCandidates(70, range('QauthorX'))
    ).toEqual([p2, p1, p3]);
    expect(
      (manager as any).getAuthorGapRepairCandidates(70, range('QauthorY'), p2)
    ).toEqual([p3, p2]);
    expect(
      (manager as any).getAuthorGapRepairCandidates(70, range('Qnobody'), p1)
    ).toEqual([p3, p2]);
  });

  it('writes changed gaps in one batch', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    joinGroups(manager, [59], [59]);
    const batch = vi.spyOn(db(manager), 'runWriteBatch');

    (manager as any).recordAuthorGapRanges(
      59,
      PROVIDER,
      gapRanges(20),
      'group_state_digest_v3'
    );
    expect(batch).toHaveBeenCalledTimes(1);

    clock.now += 1_000;
    (manager as any).recordAuthorGapRanges(
      59,
      PROVIDER,
      gapRanges(20),
      'group_sub'
    );
    expect(batch).toHaveBeenCalledTimes(2);
  });

  it('discovers author gaps at most once per group per minute even when the group changes', () => {
    const clock = { now: NOW };
    const manager = makeManager(clock);
    joinGroups(manager, [59], [59]);
    const gaps = vi
      .spyOn(db(manager), 'getAuthorSequenceGaps')
      .mockReturnValue([
        { authorAddress: 'Qa', authorStreamId: STREAM, fromSeq: 2, toSeq: 2 },
      ] as any);
    vi.spyOn(db(manager), 'getGroupDigestRevision')
      .mockReturnValueOnce(1 as any)
      .mockReturnValue(2 as any);
    const discover = (peer: string, force = false) =>
      (manager as any).requestKnownAuthorGaps(
        59,
        peer,
        'group_state_digest_v3',
        force,
        { immediate: false }
      );

    expect(discover('peer-a')).toBe(true);
    clock.now += 10_000;
    expect(discover('peer-b')).toBe(false);
    expect(gaps).toHaveBeenCalledTimes(1);

    // A forced call still runs (and restarts the window).
    expect(discover('peer-b', true)).toBe(true);
    expect(gaps).toHaveBeenCalledTimes(2);

    clock.now += 60_000;
    expect(discover('peer-c')).toBe(true);
    expect(gaps).toHaveBeenCalledTimes(3);
  });
});
