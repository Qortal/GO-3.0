import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Write cost of storing a group event (A5) and the per-group index of the
// session's memory events (A7). Both must leave exactly the stored state and
// the summaries the old code produced. Runs the real ReticulumChatDatabase SQL
// against Node's built-in SQLite through a minimal better-sqlite3 adapter that
// also counts commits: every write outside a transaction is one (an OPFS
// rollback-journal commit on GO costs about 5 flushes), and so is every
// outermost transaction.
const sqliteCounters = vi.hoisted(() => ({ commits: 0, writes: 0 }));

vi.mock('better-sqlite3', async () => {
  const { createRequire } = await import('node:module');
  const load = createRequire(import.meta.url);
  const { DatabaseSync } = load('node:sqlite') as {
    DatabaseSync: new (file: string) => any;
  };
  class Statement {
    constructor(
      private readonly owner: any,
      private readonly statement: any
    ) {}
    run(...args: unknown[]) {
      sqliteCounters.writes += 1;
      if (!this.owner.isTransaction) sqliteCounters.commits += 1;
      const result = this.statement.run(...args);
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
      this.db = new DatabaseSync(file);
    }
    prepare(sql: string) {
      return new Statement(this.db, this.db.prepare(sql));
    }
    exec(sql: string) {
      if (!this.db.isTransaction) sqliteCounters.commits += 1;
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
        this.db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN');
        try {
          const result = fn(...args);
          this.db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
          if (!nested) sqliteCounters.commits += 1;
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
  buildReticulumChatSignedFields,
  hashReticulumChatPayload,
  ReticulumChatManager,
  type ReticulumChatEvent,
  type ReticulumChatEventType,
} from './reticulum-chat';
import {
  hashReticulumChatMentionAddress,
  ReticulumChatDatabase,
} from './reticulum-chat-db';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

type Identity = { address: string; publicKey: string; secretKey: Uint8Array };

const STREAM_ID = 'c'.repeat(32);
const dbs: ReticulumChatDatabase[] = [];
const managers: ReticulumChatManager[] = [];
const tempRoots: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const db of dbs.splice(0)) {
    try {
      db.close();
    } catch {
      // already closed by the test
    }
  }
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-index-writes-'));
  tempRoots.push(root);
  return path.join(root, 'reticulum-chat.db');
}

function openDb(dbPath = tempDbPath()): ReticulumChatDatabase {
  const db = new ReticulumChatDatabase(dbPath);
  dbs.push(db);
  return db;
}

function identity(): Identity {
  const kp = nacl.sign.keyPair();
  const publicKey = base58Encode(kp.publicKey);
  return {
    address: deriveAddressFromPublicKey(publicKey),
    publicKey,
    secretKey: kp.secretKey,
  };
}

let idCounter = 0;
function groupEvent(
  author: Identity,
  seq: number,
  options: {
    groupId?: number;
    channelId?: string;
    eventType?: ReticulumChatEventType;
    payload?: Record<string, unknown> | string;
    targetEventId?: string;
    replyToEventId?: string;
    mentionAddressHashes?: string[];
    timestamp?: number;
  } = {}
): ReticulumChatEvent {
  idCounter += 1;
  const eventId = `ix-${idCounter.toString(16).padStart(10, '0')}`;
  const encryptedPayload =
    typeof options.payload === 'string'
      ? options.payload
      : JSON.stringify(options.payload ?? { messageText: `text ${eventId}` });
  const event: ReticulumChatEvent = {
    eventId,
    groupId: options.groupId ?? 71,
    channelId: options.channelId ?? 'general',
    authorAddress: author.address,
    authorPublicKey: author.publicKey,
    authorStreamId: STREAM_ID,
    authorSeq: seq,
    timestamp: options.timestamp ?? Date.now() - 600_000 + seq,
    eventType: options.eventType ?? 'message',
    ...(options.targetEventId ? { targetEventId: options.targetEventId } : {}),
    ...(options.replyToEventId
      ? { replyToEventId: options.replyToEventId }
      : {}),
    encryptedPayload,
    payloadHash: hashReticulumChatPayload(encryptedPayload),
    mentionAddressHashes: options.mentionAddressHashes ?? [],
    signature: '',
  };
  event.signature = base58Encode(
    nacl.sign.detached(
      new Uint8Array(
        canonicalizeForSigning(buildReticulumChatSignedFields(event))
      ),
      author.secretKey
    )
  );
  return event;
}

const raw = (db: ReticulumChatDatabase) => (db as any).db;

function ftsRowsFor(db: ReticulumChatDatabase, eventId: string): number {
  return Number(
    raw(db)
      .prepare(
        'SELECT COUNT(*) AS n FROM reticulum_chat_search_fts WHERE event_id = ?'
      )
      .get(eventId).n
  );
}

function ftsMatches(db: ReticulumChatDatabase, term: string): string[] {
  return raw(db)
    .prepare(
      'SELECT event_id FROM reticulum_chat_search_fts WHERE reticulum_chat_search_fts MATCH ?'
    )
    .all(term)
    .map((row: { event_id: string }) => row.event_id);
}

function maxFtsRowsPerEvent(db: ReticulumChatDatabase): number {
  const row = raw(db)
    .prepare(
      `SELECT MAX(n) AS n FROM (
         SELECT COUNT(*) AS n FROM reticulum_chat_search_fts GROUP BY event_id
       )`
    )
    .get();
  return Number(row?.n ?? 0);
}

describe('storing an event commits once (A5)', () => {
  it('50 stored messages take 50 commits, not ~5 each', () => {
    const db = openDb();
    const author = identity();
    // The first store also runs the throttled expiry prune.
    expect(db.insertEvent(groupEvent(author, 1), false)).toBe(true);
    const events = Array.from({ length: 50 }, (_, index) =>
      groupEvent(author, index + 2, {
        payload: {
          messageText: `hello number ${index}`,
          mentionedAddresses: [author.address],
        },
        mentionAddressHashes: [hashReticulumChatMentionAddress(author.address)],
      })
    );
    const before = sqliteCounters.commits;
    for (const event of events) {
      expect(db.insertEvent(event, false)).toBe(true);
    }
    const perEvent = (sqliteCounters.commits - before) / events.length;

    // The same stores with every write as its own commit, as before.
    const oldDb = openDb();
    vi.spyOn(oldDb, 'runWriteBatch').mockImplementation((fn) => fn());
    expect(oldDb.insertEvent(groupEvent(author, 1), false)).toBe(true);
    const oldEvents = events.map((event, index) =>
      groupEvent(author, index + 2, {
        payload: JSON.parse(event.encryptedPayload),
        mentionAddressHashes: event.mentionAddressHashes,
      })
    );
    const oldBefore = sqliteCounters.commits;
    for (const event of oldEvents) oldDb.insertEvent(event, false);
    const oldPerEvent = (sqliteCounters.commits - oldBefore) / events.length;
    console.log(
      `[A5] commits per stored message: ${perEvent} (each write its own: ${oldPerEvent})`
    );

    expect(perEvent).toBe(1);
    expect(oldPerEvent).toBeGreaterThanOrEqual(4);
    // Same rows either way.
    for (const [index, event] of events.entries()) {
      expect(ftsRowsFor(db, event.eventId)).toBe(1);
      expect(ftsRowsFor(oldDb, oldEvents[index].eventId)).toBe(1);
    }
  });

  it('a failing store rolls back and can be stored again', () => {
    const db = openDb();
    const author = identity();
    const event = groupEvent(author, 1);
    const failing = vi
      .spyOn(db as any, 'applyDeleteScrubForEvent')
      .mockImplementationOnce(() => {
        throw new Error('disk full');
      });
    expect(() => db.insertEvent(event, false)).toThrow('disk full');
    expect(db.hasEvent(event.eventId)).toBe(false);
    expect(ftsRowsFor(db, event.eventId)).toBe(0);
    failing.mockRestore();
    expect(db.insertEvent(event, false)).toBe(true);
    expect(db.hasEvent(event.eventId)).toBe(true);
    expect(ftsRowsFor(db, event.eventId)).toBe(1);
  });
});

describe('search and mention re-index shortcuts (A5)', () => {
  it('re-indexing the same text writes nothing; new text replaces the old', () => {
    const db = openDb();
    const author = identity();
    const event = groupEvent(author, 1, { payload: 'ciphertext' });
    expect(db.insertEvent(event, false)).toBe(true);
    expect(db.indexSearchText(event.eventId, 'first words')).toBe(true);
    expect(ftsMatches(db, 'first')).toEqual([event.eventId]);

    const writes = sqliteCounters.writes;
    const commits = sqliteCounters.commits;
    const invalidate = vi.spyOn(db, 'invalidateChatSummaryCache');
    expect(db.indexSearchText(event.eventId, 'first words')).toBe(true);
    expect(sqliteCounters.writes - writes).toBe(0);
    expect(sqliteCounters.commits - commits).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
    expect(db.getIndexWriteStats().searchUnchanged).toBe(1);

    expect(db.indexSearchText(event.eventId, 'second phrase')).toBe(true);
    expect(ftsMatches(db, 'first')).toEqual([]);
    expect(ftsMatches(db, 'second')).toEqual([event.eventId]);
    expect(ftsRowsFor(db, event.eventId)).toBe(1);
  });

  it('re-sending the same mentions writes nothing and asks for no summary refresh', () => {
    const dbPath = tempDbPath();
    const manager = new ReticulumChatManager({ dbPath });
    managers.push(manager);
    const db = (manager as any).db as ReticulumChatDatabase;
    const author = identity();
    const mentioned = identity();
    const event = groupEvent(author, 1, {
      payload: { messageText: 'hi @someone' },
      mentionAddressHashes: [
        hashReticulumChatMentionAddress(mentioned.address),
      ],
    });
    expect(db.insertEvent(event, false)).toBe(true);
    const summaries: unknown[] = [];
    manager.on('summaryChanged', (payload) => summaries.push(payload));

    expect(
      manager.replaceMentionsForEvent(event.eventId, [mentioned.address])
    ).toBe(true);
    expect(summaries).toHaveLength(1);

    const writes = sqliteCounters.writes;
    const invalidate = vi.spyOn(db, 'invalidateChatSummaryCache');
    expect(
      manager.replaceMentionsForEvent(event.eventId, [mentioned.address])
    ).toBe(true);
    expect(sqliteCounters.writes - writes).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
    expect(summaries).toHaveLength(1);
    expect(
      db.replaceMentionsForEventDetailed(event.eventId, [mentioned.address])
    ).toEqual({ applied: true, changed: false });

    // A different set is written and announced as before.
    expect(manager.replaceMentionsForEvent(event.eventId, [])).toBe(true);
    expect(summaries).toHaveLength(2);
    expect(
      raw(db).prepare('SELECT COUNT(*) AS n FROM reticulum_chat_mentions').get()
        .n
    ).toBe(0);
  });

  it('a mention marked read is rewritten unread, exactly as before', () => {
    const db = openDb();
    const author = identity();
    const reader = identity();
    const event = groupEvent(author, 1, {
      payload: { messageText: 'hello' },
      mentionAddressHashes: [hashReticulumChatMentionAddress(reader.address)],
    });
    expect(db.insertEvent(event, false)).toBe(true);
    db.replaceMentionsForEvent(event.eventId, [reader.address]);
    db.markRead(71, 'general', Date.now(), reader.address);
    const readAt = () =>
      Number(
        raw(db)
          .prepare(
            'SELECT read_at FROM reticulum_chat_mentions WHERE event_id = ?'
          )
          .get(event.eventId).read_at
      );
    expect(readAt()).toBeGreaterThan(0);
    expect(
      db.replaceMentionsForEventDetailed(event.eventId, [reader.address])
    ).toEqual({ applied: true, changed: true });
    expect(readAt()).toBe(0);
  });

  it('insert, edit, re-index, delete and expiry leave 0 or 1 FTS row per event', () => {
    const db = openDb();
    const author = identity();
    const root = groupEvent(author, 1, {
      payload: { messageText: 'alpha words' },
    });
    expect(db.insertEvent(root, false)).toBe(true);
    expect(ftsRowsFor(db, root.eventId)).toBe(1);

    const edit = groupEvent(author, 2, {
      eventType: 'edit',
      targetEventId: root.eventId,
      payload: { messageText: 'beta words' },
    });
    expect(db.insertEvent(edit, false)).toBe(true);
    expect(ftsRowsFor(db, root.eventId)).toBe(1);
    expect(ftsMatches(db, 'alpha')).toEqual([]);
    expect(ftsMatches(db, 'beta')).toEqual([root.eventId]);
    expect(db.indexSearchText(edit.eventId, 'beta words')).toBe(true);
    expect(db.indexSearchText(edit.eventId, 'beta words again')).toBe(true);
    expect(ftsRowsFor(db, root.eventId)).toBe(1);

    const remove = groupEvent(author, 3, {
      eventType: 'delete',
      targetEventId: root.eventId,
      payload: {},
    });
    expect(db.insertEvent(remove, false)).toBe(true);
    expect(ftsRowsFor(db, root.eventId)).toBe(0);

    const expiring = groupEvent(author, 4, {
      payload: { messageText: 'gamma words', expiryDurationMs: 60_000 },
      timestamp: Date.now() - 1_000,
    });
    expect(db.insertEvent(expiring, false)).toBe(true);
    expect(ftsRowsFor(db, expiring.eventId)).toBe(1);
    db.pruneExpiredMessages(Date.now() + 120_000);
    expect(ftsRowsFor(db, expiring.eventId)).toBe(0);
    expect(maxFtsRowsPerEvent(db)).toBeLessThanOrEqual(1);
  });

  /** A database whose FTS table holds a stray row the mirror does not. */
  function dbWithStrayFtsRow(author: Identity) {
    const dbPath = tempDbPath();
    const first = new ReticulumChatDatabase(dbPath);
    const kept = groupEvent(author, 1, {
      payload: { messageText: 'kept words' },
    });
    expect(first.insertEvent(kept, false)).toBe(true);
    // An older build's leftover: an FTS row with no mirror row.
    raw(first)
      .prepare(
        `INSERT INTO reticulum_chat_search_fts
           (event_id, group_id, channel_id, author_address, timestamp, event_type, search_text)
         VALUES ('stray-event', 71, 'general', 'Qstray', 1, 'message', 'stray words')`
      )
      .run();
    first.close();
    return { db: openDb(dbPath), kept };
  }
  const afterTransaction = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('rebuilds the FTS table from the mirror once when the row counts differ', async () => {
    const author = identity();
    const { db, kept } = dbWithStrayFtsRow(author);
    expect(db.getIndexWriteStats().ftsCheck.state).toBe('unchecked');
    const event = groupEvent(author, 2, {
      payload: { messageText: 'fresh words' },
    });
    expect(db.insertEvent(event, false)).toBe(true);
    // Never inside the store's own transaction: right after it.
    expect(db.getIndexWriteStats().ftsCheck.state).toBe('unchecked');
    await afterTransaction();
    const check = db.getIndexWriteStats().ftsCheck;
    // Counted after the fresh event was stored (the full write path).
    expect(check).toMatchObject({
      state: 'trusted',
      mirrorRows: 2,
      ftsRows: 3,
      rebuilt: true,
    });
    expect(ftsMatches(db, 'stray')).toEqual([]);
    expect(ftsMatches(db, 'kept')).toEqual([kept.eventId]);
    expect(ftsMatches(db, 'fresh')).toEqual([event.eventId]);
    expect(maxFtsRowsPerEvent(db)).toBe(1);
  });

  it('a first store that rolls back leaves the FTS check undone, not trusted', async () => {
    const author = identity();
    const { db } = dbWithStrayFtsRow(author);
    const event = groupEvent(author, 2, {
      payload: { messageText: 'fresh words' },
    });
    const failing = vi
      .spyOn(db as any, 'applyDeleteScrubForEvent')
      .mockImplementationOnce(() => {
        throw new Error('disk full');
      });
    expect(() => db.insertEvent(event, false)).toThrow('disk full');
    expect(db.getIndexWriteStats().ftsCheck.state).toBe('unchecked');
    await afterTransaction();
    expect(db.getIndexWriteStats().ftsCheck).toMatchObject({
      state: 'trusted',
      rebuilt: true,
    });
    failing.mockRestore();
    expect(db.insertEvent(event, false)).toBe(true);
    expect(ftsMatches(db, 'stray')).toEqual([]);
    expect(ftsMatches(db, 'fresh')).toEqual([event.eventId]);
    expect(maxFtsRowsPerEvent(db)).toBe(1);
  });

  it('leaves the same stored rows and answers as the old write path', () => {
    const t0 = Date.now();
    const me = identity();
    const alice = identity();
    const bob = identity();
    const meHash = hashReticulumChatMentionAddress(me.address);
    // One script of events, replayed on both databases.
    const root = groupEvent(alice, 1, {
      payload: { messageText: 'alpha first', mentionedAddresses: [me.address] },
      mentionAddressHashes: [meHash],
      timestamp: t0 - 50_000,
    });
    const reply = groupEvent(bob, 1, {
      payload: { messageText: 'bravo reply' },
      replyToEventId: root.eventId,
      timestamp: t0 - 40_000,
    });
    const edit = groupEvent(alice, 2, {
      eventType: 'edit',
      targetEventId: root.eventId,
      payload: { messageText: 'alpha edited', mentionedAddresses: [] },
      mentionAddressHashes: [meHash],
      timestamp: t0 - 30_000,
    });
    const doomed = groupEvent(bob, 2, {
      channelId: 'news',
      payload: { messageText: 'charlie doomed' },
      timestamp: t0 - 20_000,
    });
    const remove = groupEvent(bob, 3, {
      eventType: 'delete',
      targetEventId: doomed.eventId,
      channelId: 'news',
      payload: {},
      timestamp: t0 - 10_000,
    });
    const expiring = groupEvent(alice, 3, {
      payload: { messageText: 'delta expiring', expiryDurationMs: 60_000 },
      timestamp: t0 - 5_000,
    });
    const run = (oldPath: boolean) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(t0);
      const db = openDb();
      if (oldPath) {
        // Each write its own commit, no search or mention shortcuts.
        vi.spyOn(db, 'runWriteBatch').mockImplementation((fn) => fn());
        (db as any).indexWriteStats.ftsCheck.state = 'untrusted';
        vi.spyOn(db as any, 'storedMentionRowsMatch').mockReturnValue(false);
      }
      for (const event of [root, reply, edit, doomed]) {
        expect(db.insertEvent(event, false)).toBe(true);
      }
      db.indexSearchText(edit.eventId, 'alpha edited');
      db.indexSearchText(reply.eventId, 'bravo reply');
      db.indexSearchText(reply.eventId, 'bravo reply changed');
      db.replaceMentionsForEvent(edit.eventId, [me.address]);
      db.replaceMentionsForEvent(edit.eventId, [me.address]);
      db.replaceMentionsForEvent(reply.eventId, []);
      db.markRead(71, 'general', t0 - 35_000, me.address);
      db.replaceMentionsForEvent(edit.eventId, [me.address]);
      expect(db.insertEvent(remove, false)).toBe(true);
      expect(db.insertEvent(expiring, false)).toBe(true);
      const beforeExpiry = {
        summaries: db.getChatSummaries(me.address),
        search: db.searchEvents('alpha').map((hit) => hit.event.eventId),
      };
      vi.setSystemTime(t0 + 120_000);
      db.pruneExpiredMessages(t0 + 120_000);
      const dump = (sql: string) => raw(db).prepare(sql).all();
      const state = {
        beforeExpiry,
        summaries: db.getChatSummaries(me.address),
        search: ['alpha', 'bravo', 'charlie', 'delta'].map((term) =>
          db.searchEvents(term).map((hit) => hit.event.eventId)
        ),
        events: dump('SELECT * FROM reticulum_chat_events ORDER BY event_id'),
        headers: dump('SELECT * FROM rchat_event_headers ORDER BY event_id'),
        projection: dump(
          'SELECT * FROM rchat_message_projection ORDER BY root_event_id'
        ),
        mirror: dump(
          'SELECT * FROM reticulum_chat_search_index ORDER BY event_id'
        ),
        fts: dump(
          `SELECT event_id, group_id, channel_id, author_address, timestamp, event_type, search_text
           FROM reticulum_chat_search_fts ORDER BY event_id, search_text`
        ),
        mentions: dump(
          'SELECT * FROM reticulum_chat_mentions ORDER BY event_id, mentioned_address'
        ),
        expired: dump(
          'SELECT * FROM rchat_expired_event_markers ORDER BY event_id'
        ),
      };
      if (!oldPath) {
        // The shortcuts really ran in this replay.
        const stats = db.getIndexWriteStats();
        expect(stats.searchUnchanged).toBeGreaterThan(0);
        expect(stats.searchNoMirror).toBeGreaterThan(0);
        expect(stats.mentionsUnchanged).toBeGreaterThan(0);
        expect(stats.ftsCheck.state).toBe('trusted');
      }
      vi.restoreAllMocks();
      vi.useRealTimers();
      return state;
    };
    const current = run(false);
    const old = run(true);
    expect(current).toEqual(old);
    expect(current.mirror.length).toBeGreaterThan(0);
    expect(current.mentions.length).toBeGreaterThan(0);
    expect(current.expired.length).toBeGreaterThan(0);
  });
});

describe('memory events indexed by group (A7)', () => {
  const memoryOf = (db: ReticulumChatDatabase) => (db as any).memoryEvents;

  /** What the old code saw: every memory event, filtered by group. */
  const scanGroup = (db: ReticulumChatDatabase, groupId: number) =>
    [...Map.prototype.values.call(memoryOf(db))].filter(
      (event: ReticulumChatEvent) => event.groupId === groupId
    );

  function expectIndexMatchesScan(db: ReticulumChatDatabase): void {
    const memory = memoryOf(db);
    const groups = new Set<number>(
      [...Map.prototype.values.call(memory)].map(
        (event: ReticulumChatEvent) => event.groupId
      )
    );
    expect(new Set(memory.groupIds())).toEqual(groups);
    for (const groupId of groups) {
      expect(
        memory.eventsInGroup(groupId).map((e: ReticulumChatEvent) => e.eventId)
      ).toEqual(scanGroup(db, groupId).map((e) => e.eventId));
    }
  }

  /** Makes the instance answer like the old code: a full scan per group. */
  function useFullScans(db: ReticulumChatDatabase): void {
    const memory = memoryOf(db);
    vi.spyOn(memory, 'eventsInGroup').mockImplementation((groupId) =>
      scanGroup(db, groupId as number)
    );
    vi.spyOn(memory, 'groupIds').mockImplementation(() =>
      new Set(
        [...Map.prototype.values.call(memory)].map(
          (event: ReticulumChatEvent) => event.groupId
        )
      ).values()
    );
  }

  function buildFixtures(db: ReticulumChatDatabase) {
    const me = identity();
    const alice = identity();
    const bob = identity();
    const silenced = identity();
    let seq = 0;
    const store = (
      author: Identity,
      options: Parameters<typeof groupEvent>[2]
    ) => {
      seq += 1;
      const event = groupEvent(author, seq, options);
      expect(db.insertEvent(event, author === me)).toBe(true);
      return event;
    };
    const mine = store(me, { groupId: 71, payload: { messageText: 'mine' } });
    store(alice, { groupId: 71, replyToEventId: mine.eventId });
    const mention = store(bob, {
      groupId: 71,
      channelId: 'news',
      payload: { messageText: 'hey', mentionedAddresses: [me.address] },
      mentionAddressHashes: [hashReticulumChatMentionAddress(me.address)],
    });
    db.replaceMentionsForEvent(mention.eventId, [me.address]);
    store(silenced, { groupId: 71 });
    db.setSilence(me.address, silenced.address, 'group', '71', null);
    store(alice, {
      groupId: 72,
      payload: { messageText: 'soon gone', expiryDurationMs: 60_000 },
      timestamp: Date.now() - 1_000,
    });
    store(alice, { groupId: 72, channelId: 'random' });
    const edited = store(bob, { groupId: 72 });
    store(bob, {
      groupId: 72,
      eventType: 'edit',
      targetEventId: edited.eventId,
      payload: { messageText: 'edited' },
    });
    const deleted = store(alice, { groupId: 73 });
    store(alice, {
      groupId: 73,
      eventType: 'delete',
      targetEventId: deleted.eventId,
      payload: {},
    });
    store(bob, { groupId: 73 });
    // Memory-only events (never written to SQL), as a test elsewhere does.
    const memoryOnly = groupEvent(bob, 900, { groupId: 74, channelId: 'mem' });
    memoryOf(db).set(memoryOnly.eventId, memoryOnly);
    const memoryOnlyKnown = groupEvent(alice, 901, {
      groupId: 71,
      channelId: 'side',
      mentionAddressHashes: [hashReticulumChatMentionAddress(me.address)],
    });
    memoryOf(db).set(memoryOnlyKnown.eventId, memoryOnlyKnown);
    return { me };
  }

  it('keeps the index equal to a full scan through every mutation', () => {
    const db = openDb();
    buildFixtures(db);
    expectIndexMatchesScan(db);
    db.pruneExpiredMessages(Date.now() + 120_000);
    expectIndexMatchesScan(db);
    const anyEvent = [...Map.prototype.values.call(memoryOf(db))][0] as
      | ReticulumChatEvent
      | undefined;
    (db as any).deleteCachedEvent(anyEvent!.eventId);
    expectIndexMatchesScan(db);
    memoryOf(db).delete('missing-id');
    memoryOf(db).set(anyEvent!.eventId, anyEvent);
    expectIndexMatchesScan(db);
    memoryOf(db).clear();
    expectIndexMatchesScan(db);
    expect([...memoryOf(db).groupIds()]).toEqual([]);
  });

  it('gives the same chat summaries as scanning every memory event', () => {
    const db = openDb();
    const { me } = buildFixtures(db);
    const check = () => {
      db.invalidateChatSummaryCache();
      const indexed = db.getChatSummaries(me.address);
      const groups = db.getKnownGroupIds();
      const recent = groups.map((groupId) =>
        db.getRecentEvents(groupId, 500, 'general')
      );
      const recentAll = groups.map((groupId) =>
        db.getRecentEvents(groupId, 50)
      );
      vi.spyOn(db as any, 'pruneExpiredMessagesThrottled').mockReturnValue(0);
      db.invalidateChatSummaryCache();
      useFullScans(db);
      const scanned = db.getChatSummaries(me.address);
      expect(indexed).toEqual(scanned);
      expect(db.getKnownGroupIds()).toEqual(groups);
      expect(
        groups.map((groupId) => db.getRecentEvents(groupId, 500, 'general'))
      ).toEqual(recent);
      expect(groups.map((groupId) => db.getRecentEvents(groupId, 50))).toEqual(
        recentAll
      );
      vi.restoreAllMocks();
      return indexed;
    };
    const first = check();
    expect(first.map((summary) => summary.groupId).sort()).toEqual([
      71, 72, 73,
    ]);
    expect(first.find((summary) => summary.groupId === 71)).toMatchObject({
      replyCount: 1,
      hasUnreadMention: true,
    });
    db.pruneExpiredMessages(Date.now() + 120_000);
    check();
  });

  it('a summaries refresh no longer walks every memory event per group', () => {
    const db = openDb();
    const author = identity();
    const memory = memoryOf(db);
    // 30k session events over 62 groups, kept in memory only so the run
    // measures the per-group walk and not SQL. Stored events carry their
    // meta (expiry), so visibility needs no SQL either.
    for (let i = 0; i < 30_000; i += 1) {
      const groupId = 1_000 + (i % 62);
      (db as any).memoryMeta.set(`perf-${i}`, {
        ownEvent: false,
        lastServedAt: 0,
        storedAt: 0,
        wireBytes: 1,
        expiresAt: null,
      });
      memory.set(`perf-${i}`, {
        eventId: `perf-${i}`,
        groupId,
        channelId: 'general',
        authorAddress: author.address,
        authorPublicKey: author.publicKey,
        authorStreamId: STREAM_ID,
        authorSeq: i + 1,
        timestamp: Date.now() - 1_000_000 + i,
        eventType: 'message',
        encryptedPayload: 'x',
        payloadHash: 'x',
        mentionAddressHashes: [],
        signature: 'x',
      });
    }
    const time = () => {
      let best = Number.POSITIVE_INFINITY;
      let result: unknown = null;
      for (let run = 0; run < 3; run += 1) {
        db.invalidateChatSummaryCache();
        const started = performance.now();
        result = db.getChatSummaries(author.address);
        best = Math.min(best, performance.now() - started);
      }
      return { best, result };
    };
    const indexed = time();
    useFullScans(db);
    const scanned = time();
    console.log(
      `[A7] getChatSummaries, 30k memory events x 62 groups: ${indexed.best.toFixed(1)} ms indexed, ${scanned.best.toFixed(1)} ms scanning`
    );
    expect(indexed.result).toEqual(scanned.result);
    expect(indexed.best).toBeLessThan(scanned.best);
  });
});
