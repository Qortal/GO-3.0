import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Under Vitest `better-sqlite3` resolves to a statement-shape mock that does
// not model rchat_missing_stream_ranges. These tests run the background
// author-gap scanner and its SQL against Node's built-in SQLite (node:sqlite)
// through a minimal better-sqlite3 adapter (the one in
// reticulum-chat-dm-page-delivery.test.ts), extended to count transactions
// and the modifying statements that really changed missing-range rows.
const sqlStats = vi.hoisted(() => ({ begins: 0, rangeWrites: 0 }));

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
  const RANGE_WRITE =
    /^\s*(?:UPDATE|INSERT(?:\s+OR\s+\w+)?\s+INTO|DELETE\s+FROM)\s+rchat_missing_stream_ranges\b/i;
  class Statement {
    constructor(
      private readonly statement: any,
      private readonly sql: string
    ) {}
    run(...args: unknown[]) {
      const result = this.statement.run(...args);
      const changes = Number(result.changes);
      if (changes > 0 && RANGE_WRITE.test(this.sql)) sqlStats.rangeWrites += 1;
      return {
        changes,
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
      return new Statement(this.db.prepare(sql), sql);
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

const PROVIDER = 'a'.repeat(32);
const LOCAL = 'b'.repeat(32);
const STREAM = 'c'.repeat(32);
const OWN = 'QownAccountAddress';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-gap-scanner-sql-'));
  roots.push(root);
  return path.join(root, 'reticulum-chat.db');
}

function openDb(): ReticulumChatDatabase {
  const db = new ReticulumChatDatabase(tempDbPath());
  databases.push(db);
  return db;
}

const raw = (db: ReticulumChatDatabase) => (db as any).db;

type RawRange = {
  group_id: number;
  author_address: string;
  author_stream_id: string;
  from_seq: number;
  to_seq: number;
  preferred_peer: string | null;
  attempts: number;
  next_attempt_at: number;
};

function insertRanges(db: ReticulumChatDatabase, rows: RawRange[]): void {
  const insert = raw(db).prepare(
    'INSERT INTO rchat_missing_stream_ranges (group_id, author_address, author_stream_id, from_seq, to_seq, preferred_peer, attempts, next_attempt_at) VALUES (?,?,?,?,?,?,?,?)'
  );
  raw(db).exec('BEGIN');
  for (const row of rows) {
    insert.run(
      row.group_id,
      row.author_address,
      row.author_stream_id,
      row.from_seq,
      row.to_seq,
      row.preferred_peer,
      row.attempts,
      row.next_attempt_at
    );
  }
  raw(db).exec('COMMIT');
}

const range = (
  groupId: number,
  author: string,
  from: number,
  next: number,
  peer: string | null = PROVIDER,
  to = from
): RawRange => ({
  group_id: groupId,
  author_address: author,
  author_stream_id: STREAM,
  from_seq: from,
  to_seq: to,
  preferred_peer: peer,
  attempts: 0,
  next_attempt_at: next,
});

const rangeKey = (row: {
  group_id: number;
  author_address: string;
  author_stream_id: string;
  from_seq: number;
  to_seq: number;
}) =>
  `${row.group_id}:${row.author_address}:${row.author_stream_id}:${row.from_seq}:${row.to_seq}`;

function allRows(db: ReticulumChatDatabase): Map<string, RawRange> {
  const rows = raw(db)
    .prepare(
      'SELECT group_id, author_address, author_stream_id, from_seq, to_seq, preferred_peer, attempts, next_attempt_at FROM rchat_missing_stream_ranges'
    )
    .all() as RawRange[];
  return new Map(rows.map((row) => [rangeKey(row), { ...row }]));
}

function changed(
  before: Map<string, RawRange>,
  after: Map<string, RawRange>
): RawRange[] {
  return [...after.entries()]
    .filter(
      ([key, row]) => JSON.stringify(before.get(key)) !== JSON.stringify(row)
    )
    .map(([, row]) => row);
}

function insertHeader(
  db: ReticulumChatDatabase,
  groupId: number,
  author: string,
  seq: number,
  timestamp: number
): void {
  raw(db)
    .prepare(
      `INSERT INTO rchat_event_headers
        (event_id, group_id, channel_id, author_address, author_public_key,
         author_stream_id, author_seq, timestamp, feed_timestamp, event_type,
         payload_hash, signature, last_served_at, stored_at, accepted_at,
         wire_bytes)
       VALUES (?, ?, 'general', ?, 'pk', ?, ?, ?, ?, 'message', 'hash', 'sig', 0, 0, 0, 1)`
    )
    .run(
      `header-${groupId}-${seq}`,
      groupId,
      author,
      STREAM,
      seq,
      timestamp,
      timestamp
    );
}

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

function makeManager(clock: { now: number }): ReticulumChatManager {
  const manager = new ReticulumChatManager({
    dbPath: tempDbPath(),
    bridge: {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => LOCAL,
    } as any,
    now: () => clock.now,
    getVerifiedReticulumPeers: () => [
      { destinationHash: PROVIDER, address: 'Qprovider', lastSeen: clock.now },
    ],
  });
  managers.push(manager);
  return manager;
}

const managerDb = (manager: ReticulumChatManager): ReticulumChatDatabase =>
  (manager as any).db;

// Locally an older Node skips these; CI must not skip them silently.
it.runIf(!DatabaseSync && !!process.env.CI)(
  'has node:sqlite for the real-SQL author-gap scanner tests',
  () => {
    expect(DatabaseSync).not.toBeNull();
  }
);

describe.skipIf(!DatabaseSync)('author-gap scanner (real SQL)', () => {
  it('returns the oldest due row and the oldest own row per requested group', () => {
    const db = openDb();
    const now = 100;
    insertRanges(db, [
      range(1, 'Qb', 1, 5), // A
      range(1, 'Qa', 3, 5), // B: ties A on next, Qa < Qb
      range(1, 'Qa', 1, 9), // C
      range(1, OWN, 1, 50), // D
      range(2, 'Qa', 1, 500),
      range(2, OWN, 2, 600),
      range(3, 'Qa', 1, 1),
    ]);

    const pick = db.getBackgroundMissingRangeCandidates(now, [1, 2], [OWN]);

    expect([...pick.candidates.keys()]).toEqual([1]);
    expect(pick.candidates.get(1)?.oldest).toMatchObject({
      authorAddress: 'Qa',
      fromSeq: 3,
      nextAttemptAt: 5,
    });
    expect(pick.candidates.get(1)?.ownOldest).toMatchObject({
      authorAddress: OWN,
      fromSeq: 1,
      nextAttemptAt: 50,
    });
    expect(pick.scanned).toBe(2);
    expect(pick.staleGroupIds).toEqual([]);
    expect(
      db.getBackgroundMissingRangeCandidates(now, [], [OWN]).candidates.size
    ).toBe(0);
  });

  it('SQL wins over a drifted mirror copy, in both directions', () => {
    const db = openDb();
    const now = 100;
    insertRanges(db, [
      range(1, 'Qb', 1, 5),
      range(1, 'Qa', 3, 5),
      range(1, OWN, 1, 50),
      range(1, 'Qc', 1, now + 1_000),
    ]);
    const mirror = (db as any).memoryMissingRanges as Map<string, any>;
    const state = (author: string, from: number, next: number) => ({
      groupId: 1,
      authorAddress: author,
      authorStreamId: STREAM,
      fromSeq: from,
      toSeq: from,
      preferredPeer: PROVIDER,
      attempts: 1,
      nextAttemptAt: next,
    });
    // Mirror not due, SQL due: the SQL row is picked and the mirror resynced.
    mirror.set(`1:Qa:${STREAM}:3:3`, state('Qa', 3, now + 1_000));
    // Mirror due, SQL not due: one exact read, then it drops out.
    mirror.set(`1:Qc:${STREAM}:1:1`, state('Qc', 1, 0));

    const pick = db.getBackgroundMissingRangeCandidates(now, [1], [OWN]);
    expect(pick.candidates.get(1)?.oldest).toMatchObject({
      authorAddress: 'Qa',
      fromSeq: 3,
      nextAttemptAt: 5,
      attempts: 0,
    });
    expect(pick.candidates.get(1)?.ownOldest).toMatchObject({
      authorAddress: OWN,
      fromSeq: 1,
    });
    expect(pick.scanned).toBe(2);
    expect(pick.staleGroupIds).toEqual([]);
    expect(mirror.get(`1:Qa:${STREAM}:3:3`)).toMatchObject({
      nextAttemptAt: 5,
      attempts: 0,
    });
    expect(mirror.get(`1:Qc:${STREAM}:1:1`)).toMatchObject({
      nextAttemptAt: now + 1_000,
      attempts: 0,
    });
  });

  it('a due mirror-only row still wins; drifted rows past the read budget hold the group', () => {
    const db = openDb();
    const now = 100;
    insertRanges(db, [range(1, 'Qb', 1, 50)]);
    const mirror = (db as any).memoryMissingRanges as Map<string, any>;
    const state = (groupId: number, author: string, from: number) => ({
      groupId,
      authorAddress: author,
      authorStreamId: STREAM,
      fromSeq: from,
      toSeq: from,
      preferredPeer: PROVIDER,
      attempts: 0,
      nextAttemptAt: 1,
    });
    // No SQL row (a rolled-back insert): the mirror copy is a candidate, as
    // claimMissingRangeAttempt re-creates the row.
    mirror.set(`1:Qz:${STREAM}:9:9`, state(1, 'Qz', 9));
    expect(
      db.getBackgroundMissingRangeCandidates(now, [1], []).candidates.get(1)
        ?.oldest
    ).toMatchObject({ authorAddress: 'Qz', fromSeq: 9 });

    // Group 2: ten due mirror copies of rows SQL holds for an hour.
    insertRanges(
      db,
      Array.from({ length: 10 }, (_, k) => range(2, 'Qd', k + 1, now + HOUR))
    );
    for (let k = 1; k <= 10; k += 1) {
      mirror.set(`2:Qd:${STREAM}:${k}:${k}`, state(2, 'Qd', k));
    }
    const first = db.getBackgroundMissingRangeCandidates(now, [2], []);
    expect(first.candidates.has(2)).toBe(false);
    expect(first.staleGroupIds).toEqual([2]);
    const resynced = () =>
      [...mirror.values()].filter(
        (r) => r.groupId === 2 && r.nextAttemptAt === now + HOUR
      ).length;
    expect(resynced()).toBe(8);
    const second = db.getBackgroundMissingRangeCandidates(now, [2], []);
    expect(second.candidates.has(2)).toBe(false);
    expect(second.staleGroupIds).toEqual([]);
    expect(resynced()).toBe(10);
  });

  it('grouped wake equals the per-group minimum of rows with a peer', () => {
    const db = openDb();
    insertRanges(db, [
      range(11, 'Qa', 1, 31_000),
      range(11, 'Qa', 2, 40_000),
      range(12, 'Qa', 1, 12_000),
      range(13, 'Qa', 1, 1_000, ''),
      range(14, 'Qa', 1, 2_000, null),
    ]);

    expect([
      ...db.getNextMissingRangeAttemptsByGroup([11, 12, 13, 14]),
    ]).toEqual(
      expect.arrayContaining([
        [11, 31_000],
        [12, 12_000],
      ])
    );
    expect(db.getNextMissingRangeAttemptsByGroup([11, 12, 13, 14]).size).toBe(
      2
    );
    expect(db.getNextMissingRangeAttemptAt([11, 12])).toBe(12_000);
    expect(db.getNextMissingRangeAttemptAt([13])).toBeNull();
    expect(db.getNextMissingRangeAttemptAt([14])).toBeNull();
    expect(db.getNextMissingRangeAttemptAt([])).toBeNull();

    // A mirror-only row lowers its group.
    (db as any).memoryMissingRanges.set(`11:Qmirror:${STREAM}:1:1`, {
      groupId: 11,
      authorAddress: 'Qmirror',
      authorStreamId: STREAM,
      fromSeq: 1,
      toSeq: 1,
      preferredPeer: PROVIDER,
      attempts: 0,
      nextAttemptAt: 20_000,
    });
    expect(db.getNextMissingRangeAttemptsByGroup([11]).get(11)).toBe(20_000);
    expect(db.getNextMissingRangeAttemptAt([11, 12])).toBe(12_000);
  });

  it('runWriteBatch nests', () => {
    const db = openDb();
    const begins = sqlStats.begins;

    const result = db.runWriteBatch(() =>
      // ensure, then pruneSatisfiedMissingRange opens its own transaction.
      db.scheduleMissingRange(21, 'Qa', STREAM, 4, 6, PROVIDER, 7_000)
    );

    expect(sqlStats.begins - begins).toBe(1);
    expect(result).toMatchObject({
      preferredPeer: PROVIDER,
      nextAttemptAt: 7_000,
    });
    expect(allRows(db).get(`21:Qa:${STREAM}:4:6`)).toMatchObject({
      preferred_peer: PROVIDER,
      next_attempt_at: 7_000,
    });

    // A throw rolls the whole batch back.
    expect(() =>
      db.runWriteBatch(() => {
        db.scheduleMissingRange(21, 'Qa', STREAM, 10, 10, PROVIDER, 8_000);
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(allRows(db).has(`21:Qa:${STREAM}:10:10`)).toBe(false);
  });

  it('scheduleMissingRange skips an UPDATE that changes nothing', () => {
    const db = openDb();
    const peer = 'd'.repeat(32);
    const other = 'e'.repeat(32);
    db.ensureMissingRange(41, 'Qa', STREAM, 1, 1, '');
    const schedule = (p: string, next: number) =>
      db.scheduleMissingRange(41, 'Qa', STREAM, 1, 1, p, next);
    const delta = (fn: () => unknown) => {
      const sql = sqlStats.rangeWrites;
      const counted = db.getMissingRangeWriteCount();
      const value = fn();
      return {
        sql: sqlStats.rangeWrites - sql,
        counted: db.getMissingRangeWriteCount() - counted,
        value,
      };
    };

    const first = delta(() => schedule(peer, 200_000));
    expect(first).toMatchObject({ sql: 1, counted: 1 });
    const again = delta(() => schedule(peer, 200_000));
    expect(again).toMatchObject({ sql: 0, counted: 0 });
    expect(again.value).toEqual(first.value);
    expect(delta(() => schedule(peer, 300_000))).toMatchObject({
      sql: 1,
      counted: 1,
    });
    // MAX keeps the later attempt: nothing to write.
    expect(delta(() => schedule(peer, 250_000))).toMatchObject({
      sql: 0,
      counted: 0,
    });
    expect(delta(() => schedule(other, 250_000))).toMatchObject({
      sql: 1,
      counted: 1,
    });
    expect(allRows(db).get(`41:Qa:${STREAM}:1:1`)).toMatchObject({
      preferred_peer: other,
      next_attempt_at: 300_000,
    });
  });

  it('counts missing-range rows by state with one query', () => {
    const db = openDb();
    const now = 1_800_000_000_000;
    insertRanges(db, [
      range(1, 'Qa', 10, now - 1), // due
      range(1, 'Qa', 20, now + 10 * MINUTE), // backoff
      range(1, 'Qa', 30, now + 6 * HOUR), // quarantined
      range(1, 'Qa', 40, now + 7 * DAY), // parked (marker below)
      range(1, 'Qa', 1, now - 1, PROVIDER, 2), // due, from=1
      range(1, 'Qa', 50, now - 1, ''), // due, no peer
      range(1, 'Qa', 60, now + 10 * MINUTE), // backoff, old neighbour
      range(2, 'Qa', 1, now - 1), // not eligible, from=1
      range(2, 'Qa', 5, now + 6 * HOUR), // not eligible
    ]);
    raw(db)
      .prepare(
        `INSERT INTO rchat_known_unavailable_ranges
          (group_id, author_address, author_stream_id, from_seq, to_seq,
           confirmed_at, recheck_at, peer_hashes_json)
         VALUES (1, 'Qa', ?, 40, 40, ?, ?, '[]')`
      )
      .run(STREAM, now, now + 7 * DAY);
    insertHeader(db, 1, 'Qa', 61, now - 40 * DAY);
    insertHeader(db, 1, 'Qa', 11, now - DAY); // recent neighbour: not counted

    expect(
      db.getMissingRangeStateCounts({
        now,
        eligibleGroupIds: [1],
        backoffUntil: now + 2 * HOUR + MINUTE,
        oldBefore: now - 29 * DAY,
      })
    ).toEqual({
      source: 'sql',
      total: 9,
      notEligible: 2,
      parked: 1,
      due: 3,
      backoff: 2,
      quarantined: 1,
      fromSeqOne: 2,
      noPeer: 1,
      olderThanServeAge: 1,
      topGroups: [
        { groupId: 1, rows: 7, due: 3, eligible: true },
        { groupId: 2, rows: 2, due: 1, eligible: false },
      ],
    });
  });

  it('caps the top groups at five, most rows first', () => {
    const db = openDb();
    const rows: RawRange[] = [];
    for (let groupId = 1; groupId <= 7; groupId += 1) {
      for (let k = 0; k < (groupId === 3 ? 9 : groupId); k += 1) {
        rows.push(range(groupId, 'Qa', k * 2 + 1, 50));
      }
    }
    insertRanges(db, rows);

    const counts = db.getMissingRangeStateCounts({
      now: 100,
      eligibleGroupIds: [6, 7],
      backoffUntil: 1_000,
      oldBefore: 0,
    });

    expect(counts.topGroups).toEqual([
      { groupId: 3, rows: 9, due: 9, eligible: false },
      { groupId: 7, rows: 7, due: 7, eligible: true },
      { groupId: 6, rows: 6, due: 6, eligible: true },
      { groupId: 5, rows: 5, due: 5, eligible: false },
      { groupId: 4, rows: 4, due: 4, eligible: false },
    ]);
  });

  it('reads a stored signature for an event no longer in memory', () => {
    const db = openDb();
    const event: ReticulumChatEvent = {
      eventId: 'sig-event-1',
      groupId: 42,
      channelId: 'general',
      authorAddress: 'QsigAuthor',
      authorPublicKey: 'pk',
      authorStreamId: 'e'.repeat(32),
      authorSeq: 1,
      timestamp: Date.now() - 60_000,
      eventType: 'message',
      encryptedPayload: 'ciphertext',
      payloadHash: 'hash',
      mentionAddressHashes: [],
      signature: 'signature-1',
    } as ReticulumChatEvent;
    expect(db.insertEvent(event, true)).toBe(true);
    expect(db.getEventSignature('sig-event-1')).toBe('signature-1');
    (db as any).memoryEvents.clear();
    expect(db.hasEvent('sig-event-1')).toBe(true);
    expect(db.getEventSignature('sig-event-1')).toBe('signature-1');
    expect(db.getEventSignature('missing-event')).toBeNull();
    expect(db.getEventSignature('')).toBeNull();
  });

  it('a digest item with 20 known gaps writes in one batch, then nothing', () => {
    const clock = { now: 100_000 };
    const manager = makeManager(clock);
    manager.setLocalGroupMemberships([59]);
    manager.subscribeGroup(59);
    (manager as any).notePeerSubscription(PROVIDER, 59, true);
    const ranges = Array.from({ length: 20 }, (_, k) => ({
      a: 'QgapAuthor',
      s: STREAM,
      from: 2 * k + 2,
      to: 2 * k + 2,
    }));

    let begins = sqlStats.begins;
    let writes = sqlStats.rangeWrites;
    expect(
      (manager as any).recordAuthorGapRanges(
        59,
        PROVIDER,
        ranges,
        'group_state_digest_v3'
      )
    ).toBe(20);
    expect(sqlStats.begins - begins).toBe(1);
    expect(sqlStats.rangeWrites - writes).toBeGreaterThan(0);

    clock.now += 1_000;
    begins = sqlStats.begins;
    writes = sqlStats.rangeWrites;
    const before = allRows(managerDb(manager));
    expect(
      (manager as any).recordAuthorGapRanges(
        59,
        PROVIDER,
        ranges,
        'group_state_digest_v3'
      )
    ).toBe(20);
    expect(sqlStats.rangeWrites - writes).toBe(0);
    expect(sqlStats.begins - begins).toBe(1);
    const after = allRows(managerDb(manager));
    expect(changed(before, after)).toEqual([]);
    for (const row of after.values()) {
      expect(row).toMatchObject({
        preferred_peer: PROVIDER,
        next_attempt_at: 100_000 + 60_000,
      });
    }
  });

  it('3,000 rows over 12 groups: claims only, every group gets a turn', () => {
    const now = 1_800_000_000_000;
    const clock = { now };
    const manager = makeManager(clock);
    const groups = Array.from({ length: 12 }, (_, index) => 101 + index);
    manager.setLocalGroupMemberships(groups);
    for (const groupId of groups) {
      manager.subscribeGroup(groupId);
      (manager as any).notePeerSubscription(PROVIDER, groupId, true);
    }
    const db = managerDb(manager);
    const rows: RawRange[] = [];
    for (const groupId of groups) {
      for (let a = 0; a < 25; a += 1) {
        for (let k = 0; k < 10; k += 1) {
          rows.push(
            range(
              groupId,
              `Qauthor${String(a).padStart(2, '0')}`,
              k * 10 + 1,
              now - 1_000 - ((groupId * 7 + a * 3 + k) % 997),
              PROVIDER,
              k * 10 + 5
            )
          );
        }
      }
    }
    for (let k = 0; k < 100; k += 1) {
      rows.push(range(999, 'QnotLocal', k * 2 + 1, now - 5_000));
    }
    insertRanges(db, rows);
    expect(allRows(db).size).toBe(3_100);
    const requests = vi
      .spyOn(manager as any, 'sendAuthorRangeRequest')
      .mockResolvedValue({ ok: true });
    const requestGroups = () =>
      requests.mock.calls.map((call) => Number((call[1] as { g: number }).g));
    const dueAt = () => (manager as any).backgroundAuthorGapRepairDueAt;
    const run = () => {
      const before = allRows(db);
      const begins = sqlStats.begins;
      const writes = sqlStats.rangeWrites;
      const sends = requests.mock.calls.length;
      fireScanner(manager);
      return {
        changed: changed(before, allRows(db)),
        begins: sqlStats.begins - begins,
        writes: sqlStats.rangeWrites - writes,
        groups: requestGroups().slice(sends),
      };
    };

    // Run 1: 4 sends to 4 groups, 4 claimed rows, one batch.
    const run1 = run();
    expect(run1.groups).toHaveLength(4);
    expect(new Set(run1.groups).size).toBe(4);
    expect(run1.changed).toHaveLength(4);
    for (const row of run1.changed) {
      expect(row.attempts).toBe(1);
      expect(row.next_attempt_at).toBe(now + 30_000);
      expect(row.group_id).not.toBe(999);
    }
    expect(run1.writes).toBe(4);
    expect(run1.begins).toBe(1);
    expect(dueAt()).toBe(now + 250);

    // Runs 2-3 at the same now: the other 8 groups.
    const run2 = run();
    const run3 = run();
    expect(run2.groups).toHaveLength(4);
    expect(run3.groups).toHaveLength(4);
    expect(new Set([...run1.groups, ...run2.groups, ...run3.groups])).toEqual(
      new Set(groups)
    );
    const claimedPerGroup = new Map<number, number>();
    for (const row of allRows(db).values()) {
      if (row.attempts > 0) {
        claimedPerGroup.set(
          row.group_id,
          (claimedPerGroup.get(row.group_id) ?? 0) + 1
        );
      }
    }
    expect([...claimedPerGroup.keys()].sort((a, b) => a - b)).toEqual(groups);
    expect([...claimedPerGroup.values()].every((n) => n === 1)).toBe(true);
    expect(dueAt()).toBe(now + 5_000);

    // Run 4 at the same now: nothing eligible.
    const run4 = run();
    expect(run4).toMatchObject({ changed: [], writes: 0, groups: [] });

    // Runs 5-7 after the gates: each group claims its oldest due row.
    clock.now += 5_000;
    const oldest = new Map<number, string>();
    for (const groupId of groups) {
      const pick = raw(db)
        .prepare(
          `SELECT group_id, author_address, author_stream_id, from_seq, to_seq
           FROM rchat_missing_stream_ranges
           WHERE group_id = ? AND next_attempt_at <= ?
           ORDER BY next_attempt_at, author_address, author_stream_id, from_seq, to_seq
           LIMIT 1`
        )
        .get(groupId, clock.now);
      oldest.set(groupId, rangeKey(pick));
    }
    const later = [run(), run(), run()];
    const newlyClaimed = later.flatMap((r) => r.changed);
    expect(newlyClaimed).toHaveLength(12);
    for (const row of newlyClaimed) {
      expect(rangeKey(row)).toBe(oldest.get(row.group_id));
      expect(row.attempts).toBe(1);
    }
    expect(later.map((r) => r.writes)).toEqual([4, 4, 4]);
    expect(later.map((r) => r.begins)).toEqual([1, 1, 1]);
    // Group 999 (not local) was never read or written.
    for (const row of allRows(db).values()) {
      if (row.group_id === 999) {
        expect(row).toMatchObject({
          attempts: 0,
          next_attempt_at: now - 5_000,
        });
      }
    }
  });

  describe('mirror/SQL drift', () => {
    const groupEvent = (seq: number, timestamp: number): ReticulumChatEvent =>
      ({
        eventId: `drift-QA-${seq}`,
        groupId: 7,
        channelId: 'general',
        authorAddress: 'QA',
        authorPublicKey: 'pk',
        authorStreamId: STREAM,
        authorSeq: seq,
        timestamp,
        eventType: 'message',
        encryptedPayload: 'ciphertext',
        payloadHash: 'hash',
        mentionAddressHashes: [],
        signature: `drift-sig-${seq}`,
      }) as ReticulumChatEvent;

    function setup() {
      const now = 1_800_000_000_000;
      const clock = { now };
      const manager = makeManager(clock);
      manager.setLocalGroupMemberships([7]);
      manager.subscribeGroup(7);
      (manager as any).notePeerSubscription(PROVIDER, 7, true);
      const db = managerDb(manager);
      const requests = vi
        .spyOn(manager as any, 'sendAuthorRangeRequest')
        .mockResolvedValue({ ok: true });
      const requested = () =>
        new Set(
          requests.mock.calls.map((call) => {
            const r = call[2] as { a: string; from: number; to: number };
            return `${r.a}:${r.from}-${r.to}`;
          })
        );
      const mirror = (db as any).memoryMissingRanges as Map<string, any>;
      return { clock, manager, db, requested, mirror, now };
    }

    it('an alias collision on event insert keeps the mirror on the SQL row and the group repairing', () => {
      const { clock, manager, db, requested, mirror, now } = setup();
      // QA has [5-10] waiting 2 h and an alias [5-7] that is due; QB has a
      // due row stored by an earlier session (SQL only).
      db.scheduleMissingRange(7, 'QA', STREAM, 5, 10, PROVIDER, now + 2 * HOUR);
      db.ensureMissingRange(7, 'QA', STREAM, 5, 7, PROVIDER);
      db.scheduleMissingRange(7, 'QB', STREAM, 20, 25, PROVIDER, now - 1_000);
      mirror.delete(`7:QB:${STREAM}:20:25`);
      // Storing seq 8 splits [5-10]; its [5-7] INSERT OR IGNORE collides.
      expect(db.insertEvent(groupEvent(8, now - MINUTE), true)).toBe(true);
      expect(mirror.get(`7:QA:${STREAM}:5:7`)).toMatchObject({
        nextAttemptAt: 0,
        attempts: 0,
      });
      expect(mirror.get(`7:QA:${STREAM}:9:10`)).toMatchObject({
        nextAttemptAt: now + 2 * HOUR,
      });

      for (let i = 0; i < 24 && requested().size < 2; i += 1) {
        fireScanner(manager);
        clock.now += 5_000;
      }
      expect(requested()).toEqual(new Set(['QA:5-7', 'QB:20-25']));
    });

    it('a due mirror copy of a waiting SQL row does not stall the group', () => {
      const { manager, db, requested, mirror, now } = setup();
      db.scheduleMissingRange(7, 'QA', STREAM, 5, 7, PROVIDER, now + 2 * HOUR);
      db.scheduleMissingRange(7, 'QB', STREAM, 20, 25, PROVIDER, now - 1_000);
      // A rolled-back batch left the mirror copy due.
      mirror.set(`7:QA:${STREAM}:5:7`, {
        ...mirror.get(`7:QA:${STREAM}:5:7`),
        nextAttemptAt: 0,
      });
      const log = vi.spyOn(console, 'log');

      fireScanner(manager);

      expect(requested()).toEqual(new Set(['QB:20-25']));
      expect(
        log.mock.calls.filter((c) =>
          String(c[0]).includes('author_gap_repair_skipped_backoff')
        )
      ).toHaveLength(0);
      expect(mirror.get(`7:QA:${STREAM}:5:7`)?.nextAttemptAt).toBe(
        now + 2 * HOUR
      );
    });

    it('SQL wins when the mirror copy of the oldest due row is waiting', () => {
      const { manager, db, requested, mirror, now } = setup();
      db.scheduleMissingRange(7, 'QA', STREAM, 5, 7, PROVIDER, now - 2_000);
      // A rolled-back batch left the mirror copy waiting 7 days.
      mirror.set(`7:QA:${STREAM}:5:7`, {
        ...mirror.get(`7:QA:${STREAM}:5:7`),
        nextAttemptAt: now + 7 * DAY,
      });

      fireScanner(manager);

      expect(requested()).toEqual(new Set(['QA:5-7']));
      expect((manager as any).backgroundAuthorGapRunStats.totalSent).toBe(1);
    });
  });
});
