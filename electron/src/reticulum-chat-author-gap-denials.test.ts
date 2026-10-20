import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { afterEach, describe, expect, it, vi } from 'vitest';

// GO author-gap repair (mobileProfile): failure bookkeeping in one batch,
// peers without the group's history left out, recent rows before old rows,
// the persisted denial-streak backoff, and the attempt give-back for range
// pages that wait on the membership check. Runs the real engine and its SQL
// on Node's built-in SQLite (node:sqlite) through the better-sqlite3 adapter
// of reticulum-chat-author-gap-scanner-sql.test.ts, extended to tell
// autocommit writes from writes inside a transaction.
const sqlStats = vi.hoisted(() => ({
  begins: 0,
  autocommitWrites: 0,
  txWrites: 0,
  byStmt: {} as Record<string, number>,
}));

vi.mock('better-sqlite3', async () => {
  const { createRequire } = await import('node:module');
  const load = createRequire(import.meta.url);
  let DatabaseSync: (new (file: string) => any) | null = null;
  try {
    ({ DatabaseSync } = load('node:sqlite') as {
      DatabaseSync: new (file: string) => any;
    });
  } catch {
    DatabaseSync = null; // The tests below are skipped.
  }
  const WRITE =
    /^\s*(UPDATE|INSERT(?:\s+OR\s+\w+)?\s+INTO|DELETE\s+FROM|REPLACE\s+INTO)\s+(\w+)/i;
  class Statement {
    constructor(
      private readonly statement: any,
      private readonly sql: string,
      private readonly owner: Database
    ) {}
    run(...args: unknown[]) {
      const result = this.statement.run(...args);
      const match = WRITE.exec(this.sql);
      if (match) {
        const key = `${match[1].split(/\s+/)[0].toUpperCase()} ${match[2]}`;
        sqlStats.byStmt[key] = (sqlStats.byStmt[key] ?? 0) + 1;
        if (this.owner.inTransaction) sqlStats.txWrites += 1;
        else sqlStats.autocommitWrites += 1;
      }
      return {
        changes: Number(result.changes),
        lastInsertRowid: result.lastInsertRowid,
      };
    }
    get(...args: unknown[]) {
      return this.statement.get(...args);
    }
    all(...args: unknown[]) {
      return this.statement.all(...args);
    }
  }
  class Database {
    private readonly db: any;
    private depth = 0;
    constructor(file: string) {
      if (!DatabaseSync) throw new Error('node:sqlite is not available');
      this.db = new DatabaseSync(file);
    }
    prepare(sql: string) {
      const statement = this.db.prepare(sql);
      // better-sqlite3 and the GO shim ignore object keys a statement does
      // not use (the known-unavailable park passes the marker's fields).
      statement.setAllowUnknownNamedParameters?.(true);
      return new Statement(statement, sql, this);
    }
    exec(sql: string) {
      this.db.exec(sql);
      return this;
    }
    pragma(source: string, options?: { simple?: boolean }) {
      const rows = this.db.prepare(`PRAGMA ${source}`).all();
      if (options?.simple) {
        return rows[0] ? Object.values(rows[0])[0] : undefined;
      }
      return rows;
    }
    get inTransaction() {
      return this.db.isTransaction;
    }
    transaction(fn: (...args: any[]) => any) {
      const wrapped = (...args: any[]) => {
        const nested = this.db.isTransaction;
        const savepoint = `sp_${++this.depth}`;
        if (!nested) sqlStats.begins += 1;
        this.db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN');
        try {
          const result = fn(...args);
          this.db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
          return result;
        } catch (err) {
          this.db.exec(
            nested
              ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`
              : 'ROLLBACK'
          );
          throw err;
        } finally {
          this.depth -= 1;
        }
      };
      (wrapped as any).immediate = wrapped;
      (wrapped as any).deferred = wrapped;
      (wrapped as any).exclusive = wrapped;
      return wrapped;
    }
    close() {
      if (this.db.isOpen) this.db.close();
    }
    get open() {
      return this.db.isOpen;
    }
  }
  return { default: Database };
});

import {
  ReticulumChatManager,
  type ReticulumChatEvent,
  type ReticulumChatMobileProfile,
} from './reticulum-chat';
import { ReticulumChatDatabase } from './reticulum-chat-db';

const DatabaseSync = (() => {
  try {
    return (
      createRequire(import.meta.url)('node:sqlite') as {
        DatabaseSync: unknown;
      }
    ).DatabaseSync;
  } catch {
    return null;
  }
})();

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const LOCAL = 'f'.repeat(32);
const STREAM = 'c'.repeat(32);
const G = 716;
const START = Date.UTC(2026, 9, 16, 20, 11, 32);
const P = (c: string) => c.repeat(32);

/** What engineHost sets for these lanes (the rest do not matter here). */
const GO_GAPS: ReticulumChatMobileProfile = {
  keepMembershipDeferredPulls: true,
  authorGapNoHistoryExclusion: true,
  recentGapsFirst: true,
  gapDenialBackoff: true,
};

const managers: ReticulumChatManager[] = [];
const databases: ReticulumChatDatabase[] = [];
const roots: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-gap-denials-'));
  roots.push(root);
  return path.join(root, 'reticulum-chat.db');
}

function quiet(): void {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
}

function resetSqlStats(): void {
  sqlStats.begins = 0;
  sqlStats.autocommitWrites = 0;
  sqlStats.txWrites = 0;
  sqlStats.byStmt = {};
}

const rawDb = (manager: ReticulumChatManager) => (manager as any).db.db;

type SqlSnapshot = {
  begins: number;
  autocommitWrites: number;
  txWrites: number;
};

/** SQL work of each handleEventPageResourceFailure call, measured alone. */
function measureFailures(manager: any): SqlSnapshot[] {
  const measured: SqlSnapshot[] = [];
  const original = (ReticulumChatManager.prototype as any)
    .handleEventPageResourceFailure;
  vi.spyOn(manager, 'handleEventPageResourceFailure').mockImplementation(
    (...args: unknown[]) => {
      resetSqlStats();
      const result = original.apply(manager, args);
      measured.push({
        begins: sqlStats.begins,
        autocommitWrites: sqlStats.autocommitWrites,
        txWrites: sqlStats.txWrites,
      });
      return result;
    }
  );
  return measured;
}

type RawRow = {
  attempts: number;
  next_attempt_at: number;
  preferred_peer: string | null;
  denial_streak: number;
};

function rowOf(
  manager: ReticulumChatManager,
  author: string,
  from: number,
  to = from
): RawRow | undefined {
  return rawDb(manager)
    .prepare(
      `SELECT attempts, next_attempt_at, preferred_peer, denial_streak
       FROM rchat_missing_stream_ranges
       WHERE group_id = ? AND author_address = ? AND from_seq = ? AND to_seq = ?`
    )
    .get(G, author, from, to) as RawRow | undefined;
}

function seedHeader(
  db: any,
  author: string,
  seq: number,
  timestamp: number,
  groupId = G
): void {
  db.prepare(
    `INSERT INTO rchat_event_headers
       (event_id, group_id, channel_id, author_address, author_public_key,
        author_stream_id, author_seq, timestamp, feed_timestamp, event_type,
        payload_hash, signature, last_served_at, stored_at, accepted_at,
        wire_bytes)
     VALUES (?, ?, 'general', ?, 'pk', ?, ?, ?, ?, 'message', 'hash', 'sig', 0, 0, 0, 1)`
  ).run(
    `h-${groupId}-${author}-${seq}`,
    groupId,
    author,
    STREAM,
    seq,
    timestamp,
    timestamp
  );
}

function fakeEvent(
  author: string,
  seq: number,
  timestamp: number
): ReticulumChatEvent {
  return {
    eventId: `ev-${author}-${seq}`,
    groupId: G,
    channelId: 'general',
    authorAddress: author,
    authorPublicKey: 'pk',
    authorStreamId: STREAM,
    authorSeq: seq,
    timestamp,
    eventType: 'message',
    encryptedPayload: 'ciphertext',
    payloadHash: 'hash',
    mentionAddressHashes: [],
    signature: `sig-${author}-${seq}`,
  } as ReticulumChatEvent;
}

type Behaviour = 'deny' | 'no_history' | 'link_closed' | 'serve';

type Sim = {
  clock: { now: number };
  manager: any;
  peers: string[];
  stats: {
    links: number;
    asked: Array<{ peer: string; at: number; author: string }>;
    byReason: Record<string, number>;
  };
  repairedAt: Map<string, number>;
  run: (
    untilMs: number,
    hooks?: { everyMs?: number; onTick?: (now: number) => void }
  ) => Promise<void>;
  dbPath: string;
};

/**
 * Simulated time around the real scanner and failure handlers. Sends stop at
 * sendAuthorRangeRequest, which tracks the request as the real one does; the
 * peer's answer comes back rttMs later through handleEventPageResourceFailure
 * or, for 'serve', as the range's events being stored.
 */
function makeSim(opts: {
  peers: Array<[string, Behaviour]>;
  profile?: ReticulumChatMobileProfile;
  start?: number;
  dbPath?: string;
  rttMs?: number;
  decide?: (peer: string, range: any) => Behaviour | undefined;
}): Sim {
  const clock = { now: opts.start ?? START };
  const peers = opts.peers.map(([p]) => p);
  const behaviour = new Map(opts.peers);
  const dbPath = opts.dbPath ?? tempDbPath();
  const manager = new ReticulumChatManager({
    dbPath,
    bridge: {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => LOCAL,
    } as any,
    now: () => clock.now,
    getVerifiedReticulumPeers: () =>
      peers.map((destinationHash, i) => ({
        destinationHash,
        address: `QProvider${i}`,
        lastSeen: clock.now - i,
      })),
    getAccountEndpointLeases: () => [],
    mobileProfile: opts.profile,
  } as any) as any;
  managers.push(manager);
  manager.setLocalGroupMemberships([G]);
  manager.subscribeGroup(G);
  const stats: Sim['stats'] = { links: 0, asked: [], byReason: {} };
  const repairedAt = new Map<string, number>();
  let scannerDueAt = Number.POSITIVE_INFINITY;
  manager.scheduleBackgroundAuthorGapRepair = (delayMs = 60_000) => {
    const due = clock.now + Math.max(1, Math.floor(delayMs));
    if (due < scannerDueAt) scannerDueAt = due;
  };
  const responses: Array<{
    at: number;
    transferId: string;
    reason: string;
    range: any;
  }> = [];
  const rtt = opts.rttMs ?? 1_500;
  let nextTransfer = 1;
  manager.sendAuthorRangeRequest = async (
    peerHash: string,
    wire: any,
    persistedRange: any
  ) => {
    const peer = peerHash.trim().toLowerCase();
    const requestKey = manager.directAuthorRangeRequestKey(peer, wire.g, {
      ...persistedRange,
    });
    const existingTransferId =
      manager.directHistoryPageRequestKeys.get(requestKey);
    if (existingTransferId) {
      const existing =
        manager.directHistoryPageRequests.get(existingTransferId);
      if (existing && clock.now - Number(existing.requestedAt || 0) < 20_000) {
        return { ok: true };
      }
      manager.removeDirectHistoryPageRequest(existingTransferId);
    }
    const transferId = (nextTransfer++).toString(16).padStart(16, '0');
    manager.trackDirectHistoryPageRequest(requestKey, requestKey, {
      transferId,
      groupId: wire.g,
      channelId: '*',
      direction: 'range',
      pageHash: '',
      sizeBytes: 1,
      eventCount: 100,
      sourcePeerHash: peer,
      senderReticulumDestinationHash: peer,
      repairRange: persistedRange,
      requesterAddress: 'QLocal',
      requestedAt: clock.now,
    });
    stats.links += 1;
    stats.asked.push({ peer, at: clock.now, author: persistedRange.a });
    const b =
      opts.decide?.(peer, persistedRange) ?? behaviour.get(peer) ?? 'deny';
    const reason =
      b === 'deny'
        ? 'no_history_events'
        : b === 'no_history'
          ? 'history_unavailable'
          : b === 'link_closed'
            ? 'resource_session_link_closed'
            : 'serve';
    stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
    responses.push({
      at: clock.now + rtt,
      transferId,
      reason,
      range: persistedRange,
    });
    return { ok: true };
  };
  const flush = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    await new Promise((r) => setImmediate(r));
  };
  const run: Sim['run'] = async (untilMs, hooks) => {
    const end = clock.now + untilMs;
    // Peers keep their group subscription fresh (group_sub about once a
    // minute); refresh first, as the clock may have been moved on.
    for (const p of peers) manager.notePeerSubscription(p, G, true);
    let nextSub = clock.now + MIN;
    let nextHook = hooks?.everyMs
      ? clock.now + hooks.everyMs
      : Number.POSITIVE_INFINITY;
    while (clock.now < end) {
      responses.sort((a, b) => a.at - b.at);
      const nextResp = responses.length
        ? responses[0].at
        : Number.POSITIVE_INFINITY;
      const next = Math.min(scannerDueAt, nextResp, nextSub, nextHook, end);
      clock.now = Math.max(clock.now, next);
      if (next === nextSub) {
        for (const p of peers) manager.notePeerSubscription(p, G, true);
        nextSub = clock.now + MIN;
        continue;
      }
      if (next === nextHook) {
        hooks?.onTick?.(clock.now);
        nextHook = clock.now + (hooks?.everyMs ?? 0);
        await flush();
        continue;
      }
      if (next === nextResp) {
        const r = responses.shift()!;
        if (r.reason === 'serve') {
          manager.removeDirectHistoryPageRequest(r.transferId);
          for (let seq = r.range.from; seq <= r.range.to; seq += 1) {
            manager.db.insertEvent(
              fakeEvent(r.range.a, seq, clock.now - HOUR),
              false
            );
          }
          if (!repairedAt.has(r.range.a)) repairedAt.set(r.range.a, clock.now);
        } else {
          manager.handleEventPageResourceFailure(r.transferId, r.reason);
        }
        await flush();
        continue;
      }
      if (next === scannerDueAt) {
        scannerDueAt = Number.POSITIVE_INFINITY;
        manager.processBackgroundAuthorGapRepair();
        await flush();
        continue;
      }
    }
  };
  return { clock, manager, peers, stats, repairedAt, run, dbPath };
}

// Locally an older Node skips these; CI must not skip them silently.
it.runIf(!DatabaseSync && !!process.env.CI)(
  'has node:sqlite for the real-SQL author-gap denial tests',
  () => {
    expect(DatabaseSync).not.toBeNull();
  }
);

describe.skipIf(!DatabaseSync)('author-gap denials (real SQL)', () => {
  describe('A16: failure bookkeeping in one transaction', () => {
    it('one denial is one transaction and no autocommit write; quorum, quarantine and park as before', async () => {
      quiet();
      const sim = makeSim({
        peers: [
          [P('a'), 'deny'],
          [P('b'), 'deny'],
          [P('d'), 'deny'],
        ],
      });
      const db = sim.manager.db as ReticulumChatDatabase;
      db.ensureMissingRange(G, 'QHole', STREAM, 34, 34, P('a'));
      // Well tried already: the third denial also parks it (known unavailable).
      rawDb(sim.manager)
        .prepare(
          'UPDATE rchat_missing_stream_ranges SET attempts = 20 WHERE author_address = ?'
        )
        .run('QHole');
      sim.manager.scheduleBackgroundAuthorGapRepair(1);

      // First denial (peer a): measured on its own.
      const measured = measureFailures(sim.manager);
      await sim.run(3 * SEC);
      expect(sim.stats.asked.map((a) => a.peer)).toEqual([P('a')]);
      expect(measured).toHaveLength(1);
      expect(measured[0]).toMatchObject({ begins: 1, autocommitWrites: 0 });
      expect(measured[0].txWrites).toBeGreaterThanOrEqual(3);
      // Not quarantined after one of three: rotated to the next peer at once.
      expect(rowOf(sim.manager, 'QHole', 34)).toMatchObject({
        preferred_peer: P('b'),
      });
      expect(
        rowOf(sim.manager, 'QHole', 34)!.next_attempt_at
      ).toBeLessThanOrEqual(sim.clock.now);

      await sim.run(20 * SEC);
      expect(sim.stats.asked.map((a) => a.peer)).toEqual([
        P('a'),
        P('b'),
        P('d'),
      ]);
      const parked = rowOf(sim.manager, 'QHole', 34)!;
      expect(parked.next_attempt_at).toBeGreaterThanOrEqual(
        sim.clock.now + 7 * DAY - 30 * SEC
      );
      expect(
        db.getMissingRangeKnownUnavailable(G, 'QHole', STREAM, 34, 34)
          ?.peerHashes
      ).toEqual([P('a'), P('b'), P('d')]);
    });

    it('a route failure is one transaction too', async () => {
      quiet();
      const sim = makeSim({
        peers: [
          [P('a'), 'link_closed'],
          [P('b'), 'deny'],
        ],
      });
      sim.manager.db.ensureMissingRange(G, 'QHole', STREAM, 34, 34, P('a'));
      const measured = measureFailures(sim.manager);
      sim.manager.scheduleBackgroundAuthorGapRepair(1);
      await sim.run(3 * SEC);
      expect(sim.stats.byReason).toEqual({ resource_session_link_closed: 1 });
      expect(measured).toHaveLength(1);
      expect(measured[0]).toMatchObject({ begins: 1, autocommitWrites: 0 });
      expect(rowOf(sim.manager, 'QHole', 34)).toMatchObject({
        preferred_peer: P('b'),
        denial_streak: 0,
      });
    });

    it('prunes old peer observations at most once a minute; counts still use the cutoff', () => {
      const db = new ReticulumChatDatabase(tempDbPath());
      databases.push(db);
      const record = (peer: string, at: number) =>
        db.recordMissingRangePeerUnavailable(
          G,
          'QHole',
          STREAM,
          7,
          9,
          peer,
          at,
          5_000
        );
      resetSqlStats();
      expect(record(P('a'), 100_000)).toBe(1);
      expect(record(P('b'), 110_000)).toBe(1); // a is older than 5 s
      expect(record(P('d'), 130_000)).toBe(1);
      expect(
        sqlStats.byStmt['DELETE rchat_missing_range_peer_observations']
      ).toBe(1);
      expect(record(P('e'), 161_000)).toBe(1);
      expect(
        sqlStats.byStmt['DELETE rchat_missing_range_peer_observations']
      ).toBe(2);
    });
  });

  describe('A17: peers without the group history, recent rows first', () => {
    it('a peer that answered history_unavailable is skipped for an hour and leaves the quorum', async () => {
      quiet();
      // Order of candidates: a, c, b (lastSeen). c holds nothing for G.
      const sim = makeSim({
        profile: GO_GAPS,
        peers: [
          [P('a'), 'deny'],
          [P('c'), 'no_history'],
          [P('b'), 'deny'],
        ],
      });
      sim.manager.db.ensureMissingRange(G, 'QHole', STREAM, 34, 34, P('a'));
      sim.manager.scheduleBackgroundAuthorGapRepair(1);
      await sim.run(55 * MIN);
      // a denies, c has no history, b denies: 2 of the 2 peers that can hold
      // it said no, so the row is quarantined for 6 h; c is not asked again.
      expect(sim.stats.asked.map((a) => a.peer)).toEqual([
        P('a'),
        P('c'),
        P('b'),
      ]);
      const row = rowOf(sim.manager, 'QHole', 34)!;
      expect(row.next_attempt_at).toBeGreaterThanOrEqual(
        sim.stats.asked[2].at + 6 * HOUR - MIN
      );
      // c is still a candidate in another group.
      sim.manager.setLocalGroupMemberships([G, G + 1]);
      sim.manager.subscribeGroup(G + 1);
      sim.manager.notePeerSubscription(P('c'), G + 1, true);
      sim.manager.notePeerSubscription(P('c'), G, true);
      const range = { a: 'QOther', s: STREAM, from: 1, to: 1 };
      expect(sim.manager.getAuthorGapRepairCandidates(G + 1, range)).toContain(
        P('c')
      );
      expect(sim.manager.getAuthorGapRepairCandidates(G, range)).not.toContain(
        P('c')
      );
      // After the hour c counts again.
      sim.clock.now += HOUR;
      sim.manager.notePeerSubscription(P('c'), G, true);
      expect(sim.manager.getAuthorGapRepairCandidates(G, range)).toContain(
        P('c')
      );
    });

    it('without the option the no-history peer stays in the quorum (legacy)', async () => {
      quiet();
      const sim = makeSim({
        peers: [
          [P('a'), 'deny'],
          [P('c'), 'no_history'],
          [P('b'), 'deny'],
        ],
      });
      sim.manager.db.ensureMissingRange(G, 'QHole', STREAM, 34, 34, P('a'));
      sim.manager.scheduleBackgroundAuthorGapRepair(1);
      await sim.run(55 * MIN);
      // c keeps being asked and the 2 denials never reach the threshold of 3.
      expect(
        sim.stats.asked.filter((a) => a.peer === P('c')).length
      ).toBeGreaterThan(1);
      const row = rowOf(sim.manager, 'QHole', 34)!;
      expect(row.next_attempt_at).toBeLessThan(sim.clock.now + 6 * HOUR - MIN);
    });

    it('800 old due rows and one recent row: the recent row is the group pick once due', () => {
      const db = new ReticulumChatDatabase(tempDbPath());
      databases.push(db);
      const raw = (db as any).db;
      const now = START;
      const insert = raw.prepare(
        'INSERT INTO rchat_missing_stream_ranges (group_id, author_address, author_stream_id, from_seq, to_seq, preferred_peer, attempts, next_attempt_at) VALUES (?,?,?,?,?,?,?,?)'
      );
      raw.exec('BEGIN');
      for (let k = 0; k < 800; k += 1) {
        const seq = 2 * k + 1;
        insert.run(G, 'QOld', STREAM, seq, seq, P('a'), 3, now - 1_000 - k);
        seedHeader(raw, 'QOld', seq + 1, now - 40 * DAY);
      }
      // Recent: its next event is an hour old; due in 60 s.
      insert.run(G, 'QNew', STREAM, 34, 34, P('a'), 0, now + MIN);
      seedHeader(raw, 'QNew', 35, now - HOUR);
      // Undated (no stored neighbour) own tail row: counts as recent.
      insert.run(G, 'QOwn', STREAM, 1, 3, P('a'), 0, now + 2 * MIN);
      raw.exec('COMMIT');

      const pick = (at: number, oldBefore: number) =>
        db
          .getBackgroundMissingRangeCandidates(at, [G], ['QOwn'], oldBefore)
          .candidates.get(G);
      const oldBefore = (at: number) => at - 29 * DAY;

      // Before it is due the old rows are all there is.
      expect(pick(now, oldBefore(now))?.oldest.authorAddress).toBe('QOld');
      // Once due it wins at once (upstream: after the 800 old rows).
      const at = now + MIN;
      expect(pick(at, oldBefore(at))?.oldest).toMatchObject({
        authorAddress: 'QNew',
        fromSeq: 34,
      });
      expect(pick(at, 0)?.oldest).toMatchObject({
        authorAddress: 'QOld',
        fromSeq: 1599,
      });
      // The own pick ranks the same way: an undated row is recent.
      const later = now + 2 * MIN;
      const both = pick(later, oldBefore(later));
      expect(both?.oldest.authorAddress).toBe('QNew');
      expect(both?.ownOldest).toMatchObject({ authorAddress: 'QOwn' });
    });

    it('due mirror copies of old rows cost no exact reads against a recent pick', () => {
      const db = new ReticulumChatDatabase(tempDbPath());
      databases.push(db);
      const raw = (db as any).db;
      const now = START;
      for (let k = 0; k < 20; k += 1) {
        const seq = 2 * k + 1;
        db.scheduleMissingRange(G, 'QOld', STREAM, seq, seq, P('a'), 0);
        seedHeader(raw, 'QOld', seq + 1, now - 40 * DAY);
      }
      db.scheduleMissingRange(G, 'QNew', STREAM, 34, 34, P('a'), now - 1);
      seedHeader(raw, 'QNew', 35, now - HOUR);
      const exact = vi.spyOn((db as any).stmtGetMissingRangeExact, 'get');
      const result = db.getBackgroundMissingRangeCandidates(
        now,
        [G],
        [],
        now - 29 * DAY
      );
      expect(result.candidates.get(G)?.oldest.authorAddress).toBe('QNew');
      expect(result.staleGroupIds).toEqual([]);
      expect(exact).not.toHaveBeenCalled();
    });

    it('the scanner asks for the recent row first (manager, option on)', async () => {
      quiet();
      const sim = makeSim({ profile: GO_GAPS, peers: [[P('a'), 'deny']] });
      const raw = rawDb(sim.manager);
      const now = sim.clock.now;
      for (let k = 0; k < 50; k += 1) {
        const seq = 2 * k + 1;
        sim.manager.db.scheduleMissingRange(
          G,
          'QOld',
          STREAM,
          seq,
          seq,
          P('a'),
          now - 1_000 - k
        );
        seedHeader(raw, 'QOld', seq + 1, now - 40 * DAY);
      }
      sim.manager.db.scheduleMissingRange(
        G,
        'QNew',
        STREAM,
        34,
        34,
        P('a'),
        now - 1
      );
      seedHeader(raw, 'QNew', 35, now - HOUR);
      sim.manager.scheduleBackgroundAuthorGapRepair(1);
      await sim.run(1 * SEC);
      expect(sim.stats.asked.map((a) => a.author)).toEqual(['QNew']);
    });
  });

  describe('A18: persisted denial-streak backoff', () => {
    it('backs off 5 min from the third denial in a row, doubling to a 6 h cap', () => {
      const sim = makeSim({ profile: GO_GAPS, peers: [] });
      const backoff = (streak: number) =>
        sim.manager.authorGapDenialBackoffMs(streak);
      expect([0, 1, 2].map(backoff)).toEqual([0, 0, 0]);
      expect([3, 4, 5, 9, 10, 50].map(backoff)).toEqual([
        5 * MIN,
        10 * MIN,
        20 * MIN,
        320 * MIN,
        6 * HOUR,
        6 * HOUR,
      ]);
    });

    for (const priorAttempts of [0, 6, 12]) {
      it(`a recent row with ${priorAttempts} earlier attempts is still repaired as fast as before (a denies, b serves)`, async () => {
        quiet();
        const sim = makeSim({
          profile: GO_GAPS,
          peers: [
            [P('a'), 'deny'],
            [P('b'), 'serve'],
          ],
        });
        sim.manager.db.ensureMissingRange(G, 'QNew', STREAM, 34, 34, P('a'));
        rawDb(sim.manager)
          .prepare(
            'UPDATE rchat_missing_stream_ranges SET attempts = ? WHERE author_address = ?'
          )
          .run(priorAttempts, 'QNew');
        seedHeader(rawDb(sim.manager), 'QNew', 35, START - 2 * HOUR);
        sim.manager.scheduleBackgroundAuthorGapRepair(1);
        await sim.run(HOUR);
        // Legacy: b is asked 5 s after the start and the row is gone.
        expect(sim.stats.asked.map((a) => a.peer)).toEqual([P('a'), P('b')]);
        expect(sim.stats.asked[1].at - START).toBeLessThan(6 * SEC);
        expect(sim.repairedAt.get('QNew')! - START).toBeLessThanOrEqual(
          10 * SEC
        );
        expect(rowOf(sim.manager, 'QNew', 34)).toBeUndefined();
      });
    }

    it('three denials in a row hold the row 5 min even with a free peer, across a restart', async () => {
      quiet();
      const dbPath = tempDbPath();
      const peers: Array<[string, Behaviour]> = [
        [P('a'), 'deny'],
        [P('b'), 'deny'],
        [P('d'), 'deny'],
        [P('e'), 'deny'],
      ];
      const sim = makeSim({ profile: GO_GAPS, peers, dbPath });
      const db = sim.manager.db as ReticulumChatDatabase;
      db.ensureMissingRange(G, 'QHole', STREAM, 34, 34, P('a'));
      // Denials 7 h apart: each older one has left the 6 h quorum window, so
      // no quarantine; only the streak can hold the row.
      for (const peer of [P('a'), P('b'), P('d')]) {
        db.rescheduleMissingRange(G, 'QHole', STREAM, 34, 34, peer, 0);
        sim.manager.scheduleBackgroundAuthorGapRepair(1);
        await sim.run(3 * SEC);
        sim.clock.now += 7 * HOUR;
      }
      sim.clock.now -= 7 * HOUR;
      expect(sim.stats.asked.map((a) => a.peer)).toEqual([
        P('a'),
        P('b'),
        P('d'),
      ]);
      const deniedAt = sim.stats.asked[2].at + 1_500;
      const held = rowOf(sim.manager, 'QHole', 34)!;
      expect(held.denial_streak).toBe(3);
      // a (its denial is 14 h old) is free again, but the row waits
      // (upstream: next = now with a).
      expect(held.preferred_peer).toBe(P('a'));
      expect(held.next_attempt_at).toBe(deniedAt + 5 * MIN);

      // Restart on the same database: the hold is in next_attempt_at.
      sim.manager.close();
      managers.splice(managers.indexOf(sim.manager), 1);
      const reopened = makeSim({
        profile: GO_GAPS,
        peers,
        dbPath,
        start: sim.clock.now,
      });
      expect(rowOf(reopened.manager, 'QHole', 34)).toMatchObject({
        denial_streak: 3,
        next_attempt_at: held.next_attempt_at,
      });
      reopened.manager.scheduleBackgroundAuthorGapRepair(1);
      await reopened.run(4 * MIN);
      expect(reopened.stats.links).toBe(0);
      await reopened.run(2 * MIN);
      expect(reopened.stats.asked.map((a) => a.peer)).toEqual([P('a')]);
      expect(rowOf(reopened.manager, 'QHole', 34)?.denial_streak).toBe(4);
    });

    it('only explicit denials count; storing an event in the row starts the streak again', async () => {
      quiet();
      const sim = makeSim({
        profile: GO_GAPS,
        peers: [
          [P('a'), 'link_closed'],
          [P('b'), 'no_history'],
          [P('d'), 'deny'],
        ],
      });
      const db = sim.manager.db as ReticulumChatDatabase;
      db.ensureMissingRange(G, 'QHole', STREAM, 5, 10, P('a'));
      sim.manager.scheduleBackgroundAuthorGapRepair(1);
      await sim.run(3 * MIN);
      expect(
        sim.stats.byReason.resource_session_link_closed
      ).toBeGreaterThanOrEqual(1);
      expect(sim.stats.byReason.history_unavailable).toBeGreaterThanOrEqual(1);
      expect(sim.stats.byReason.no_history_events).toBeGreaterThanOrEqual(1);
      expect(rowOf(sim.manager, 'QHole', 5, 10)?.denial_streak).toBe(
        sim.stats.byReason.no_history_events
      );
      rawDb(sim.manager)
        .prepare(
          'UPDATE rchat_missing_stream_ranges SET denial_streak = 7 WHERE author_address = ?'
        )
        .run('QHole');
      db.insertEvent(fakeEvent('QHole', 8, sim.clock.now - HOUR), false);
      expect(rowOf(sim.manager, 'QHole', 5, 10)).toBeUndefined();
      expect(rowOf(sim.manager, 'QHole', 5, 7)?.denial_streak).toBe(0);
      expect(rowOf(sim.manager, 'QHole', 9, 10)?.denial_streak).toBe(0);
    });

    /**
     * The verifier's churn case: a row no reachable peer can fill and the age
     * test cannot date (a tail 1..3 or a deleted message with a 2-day-old
     * neighbour), 12 of 40 peers subscribed at a time, rotating every 15 min,
     * a manifest or digest naming the row every 10 min. Upstream wakes the
     * row for every new provider (91/78/81 links a day).
     */
    async function churn(
      profile: ReticulumChatMobileProfile | undefined,
      row: { from: number; to: number; neighbourAgeMs: number | null },
      reason: string
    ): Promise<number[]> {
      let seed = 12345;
      const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      const pool = Array.from({ length: 40 }, (_, i) =>
        (0x1000 + i).toString(16).padStart(32, '0')
      );
      const pick = () => {
        const left = [...pool];
        const out: string[] = [];
        while (out.length < 12) {
          out.push(left.splice(Math.floor(rnd() * left.length), 1)[0]);
        }
        return out;
      };
      const initial = pick();
      const sim = makeSim({
        profile,
        peers: initial.map((p) => [p, 'deny'] as [string, Behaviour]),
      });
      const db = sim.manager.db as ReticulumChatDatabase;
      db.ensureMissingRange(G, 'QTail', STREAM, row.from, row.to, initial[0]);
      rawDb(sim.manager)
        .prepare(
          'UPDATE rchat_missing_stream_ranges SET attempts = 20 WHERE author_address = ?'
        )
        .run('QTail');
      if (row.from > 1) {
        seedHeader(rawDb(sim.manager), 'QTail', row.from - 1, START - 90 * DAY);
      }
      if (row.neighbourAgeMs != null) {
        seedHeader(
          rawDb(sim.manager),
          'QTail',
          row.to + 1,
          START - row.neighbourAgeMs
        );
      }
      sim.manager.scheduleBackgroundAuthorGapRepair(1);
      const range = { a: 'QTail', s: STREAM, from: row.from, to: row.to };
      let tick = 0;
      const perDay: number[] = [];
      let before = 0;
      for (let d = 0; d < 3; d += 1) {
        await sim.run(DAY, {
          everyMs: 5 * MIN,
          onTick: () => {
            tick += 1;
            if (tick % 3 === 0) {
              sim.peers.length = 0;
              sim.peers.push(...pick());
            }
            if (tick % 2 === 0) {
              const peer = sim.peers[Math.floor(rnd() * sim.peers.length)];
              sim.manager.recordAuthorGapRanges(G, peer, [range], reason);
              sim.manager.scheduleBackgroundAuthorGapRepair(60_000);
            }
          },
        });
        perDay.push(sim.stats.links - before);
        before = sim.stats.links;
      }
      return perDay;
    }

    it('an undated tail row under rotating manifests costs about 10 links a day or fewer (upstream ~80)', async () => {
      quiet();
      const legacy = await churn(
        undefined,
        { from: 1, to: 3, neighbourAgeMs: null },
        'author_manifest_v1'
      );
      const go = await churn(
        GO_GAPS,
        { from: 1, to: 3, neighbourAgeMs: null },
        'author_manifest_v1'
      );
      expect(Math.min(...legacy)).toBeGreaterThan(50);
      expect(go[0]).toBeLessThanOrEqual(13);
      expect(go[1]).toBeLessThanOrEqual(10);
      expect(go[2]).toBeLessThanOrEqual(10);
    });

    it('a deleted message with a recent neighbour under rotating digests: same', async () => {
      quiet();
      const go = await churn(
        GO_GAPS,
        { from: 34, to: 34, neighbourAgeMs: 2 * DAY },
        'group_state_digest_v3'
      );
      expect(go[0]).toBeLessThanOrEqual(13);
      expect(go[1]).toBeLessThanOrEqual(10);
      expect(go[2]).toBeLessThanOrEqual(10);
    });
  });

  describe('A13: a range page that only waits on the membership check', () => {
    function setupDeferredPage(
      profile: ReticulumChatMobileProfile | undefined
    ) {
      const clock = { now: START };
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: {
          on: () => undefined,
          off: () => undefined,
          getLocalDestinationHash: () => LOCAL,
        } as any,
        now: () => clock.now,
        getVerifiedReticulumPeers: () => [
          {
            destinationHash: P('a'),
            address: 'QProvider',
            lastSeen: clock.now,
          },
        ],
        getAccountEndpointLeases: () => [],
        validateGroupMember: async () => null,
        mobileProfile: profile,
      } as any) as any;
      managers.push(manager);
      manager.setLocalGroupMemberships([G]);
      manager.subscribeGroup(G);
      manager.notePeerSubscription(P('a'), G, true);
      vi.spyOn(manager, 'scheduleEventPullQueue').mockImplementation(
        () => undefined
      );
      vi.spyOn(manager, 'acceptableInboundEventResource').mockImplementation(
        async (candidate: unknown) => candidate
      );
      const transfers: string[] = [];
      vi.spyOn(manager, 'sendAuthorRangeRequest').mockImplementation(
        async (peerHash: any, wire: any, persistedRange: any) => {
          const peer = String(peerHash).toLowerCase();
          const transferId = `t${transfers.length + 1}`.padEnd(16, '0');
          const key = manager.directAuthorRangeRequestKey(
            peer,
            wire.g,
            persistedRange
          );
          manager.trackDirectHistoryPageRequest(key, key, {
            transferId,
            groupId: wire.g,
            channelId: '*',
            direction: 'range',
            pageHash: '',
            sizeBytes: 1_000_000,
            eventCount: 100,
            sourcePeerHash: peer,
            senderReticulumDestinationHash: peer,
            repairRange: persistedRange,
            requesterAddress: 'QLocal',
            requestedAt: clock.now,
          });
          transfers.push(transferId);
          return { ok: true };
        }
      );
      manager.db.ensureMissingRange(G, 'QAuthor', STREAM, 5, 9, P('a'));
      rawDb(manager)
        .prepare(
          'UPDATE rchat_missing_stream_ranges SET attempts = 4 WHERE author_address = ?'
        )
        .run('QAuthor');
      const claimAndDefer = async () => {
        manager.backgroundAuthorGapGroupNextAttemptAt.clear();
        manager.processBackgroundAuthorGapRepair();
        await Promise.resolve();
        await Promise.resolve();
        const transferId = transfers[transfers.length - 1];
        const events = [5, 6, 7, 8, 9].map((seq) =>
          fakeEvent('QAuthor', seq, clock.now - HOUR)
        );
        const page = {
          v: 1,
          g: G,
          c: '*',
          d: 'range',
          more: false,
          wh: '',
          events,
        };
        const file = path.join(
          path.dirname((manager as any).db.relayCacheKey),
          `${transferId}.json`
        );
        fs.writeFileSync(file, JSON.stringify(page), 'utf8');
        await manager.importReceivedEventPageResource({
          status: 'received',
          path: file,
          transferId,
          peerPresenceHash: P('a'),
        });
      };
      return { clock, manager, transfers, claimAndDefer };
    }

    it('gives the claimed attempt back and retries in 10 s, then 20 s', async () => {
      quiet();
      const { clock, manager, transfers, claimAndDefer } =
        setupDeferredPage(GO_GAPS);
      await claimAndDefer();
      expect(transfers).toHaveLength(1);
      expect(rowOf(manager, 'QAuthor', 5, 9)).toMatchObject({
        attempts: 4,
        next_attempt_at: clock.now + 10 * SEC,
      });
      // The peer's own backoff step was given back too: due again in 10 s.
      clock.now += 10 * SEC;
      await claimAndDefer();
      expect(transfers).toHaveLength(2);
      expect(rowOf(manager, 'QAuthor', 5, 9)).toMatchObject({
        attempts: 4,
        next_attempt_at: clock.now + 20 * SEC,
      });
      // The deferred events wait in the pull queue for the Core answer.
      expect(manager.pendingEventPulls.size).toBe(5);
      expect(manager.getDeliveryCounters().authorGapMembershipRefund).toBe(2);
    });

    it('without the option the claim keeps its attempt and backoff (upstream)', async () => {
      quiet();
      const { clock, manager, claimAndDefer } = setupDeferredPage(undefined);
      await claimAndDefer();
      expect(rowOf(manager, 'QAuthor', 5, 9)).toMatchObject({
        attempts: 5,
        next_attempt_at: clock.now + 30 * SEC,
      });
    });
  });
});
