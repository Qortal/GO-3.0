import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Under Vitest `better-sqlite3` resolves to a statement-shape mock. These
// tests run the real rchat_own_post_delivery SQL of ReticulumChatDatabase
// against Node's built-in SQLite (node:sqlite) through a minimal
// better-sqlite3 adapter, so INSERT OR IGNORE, COALESCE and the prunes really
// run.
vi.mock('better-sqlite3', async () => {
  const { createRequire } = await import('node:module');
  const load = createRequire(import.meta.url);
  const { DatabaseSync } = load('node:sqlite') as {
    DatabaseSync: new (file: string) => any;
  };
  class Statement {
    constructor(private readonly statement: any) {}
    run(...args: unknown[]) {
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
      return new Statement(this.db.prepare(sql));
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
  ReticulumChatDatabase,
  reticulumDmConversationId,
} from './reticulum-chat-db';
import type { ReticulumChatEvent, ReticulumDmEvent } from './reticulum-chat';

const ME = 'QmeAddress11111111111111111111111';
const PEER = 'b'.repeat(32);
const GROUP_ID = 42;
const STREAM_ID = 'e'.repeat(32);
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60_000;

const open: ReticulumChatDatabase[] = [];
const roots: string[] = [];

afterEach(() => {
  for (const db of open.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-own-post-db-'));
  roots.push(root);
  return path.join(root, 'reticulum-chat.db');
}

function openDb(dbPath = tempDbPath()): ReticulumChatDatabase {
  const db = new ReticulumChatDatabase(dbPath);
  open.push(db);
  return db;
}

function closeDb(db: ReticulumChatDatabase): void {
  open.splice(open.indexOf(db), 1);
  db.close();
}

const raw = (db: ReticulumChatDatabase) => (db as any).db;

const startGroupPost = (
  db: ReticulumChatDatabase,
  eventId: string,
  createdAt = NOW
) =>
  db.startOwnPostDelivery({
    eventId,
    scope: 'group',
    groupId: GROUP_ID,
    channelId: 'general',
    authorAddress: ME,
    createdAt,
  });

function groupEvent(eventId: string, seq: number): ReticulumChatEvent {
  return {
    eventId,
    groupId: GROUP_ID,
    channelId: 'general',
    authorAddress: ME,
    authorPublicKey: 'pk',
    authorStreamId: STREAM_ID,
    authorSeq: seq,
    timestamp: NOW - 60_000,
    eventType: 'message',
    encryptedPayload: `ciphertext-${eventId}`,
    payloadHash: `hash-${eventId}`,
    mentionAddressHashes: [],
    signature: `sig-${eventId}`,
  };
}

function selfDmEvent(eventId: string, seq: number): ReticulumDmEvent {
  return {
    eventId,
    conversationId: reticulumDmConversationId(ME, ME),
    senderAddress: ME,
    recipientAddress: ME,
    senderPublicKey: 'pk',
    senderStreamId: STREAM_ID,
    senderSeq: seq,
    timestamp: NOW - 60_000,
    eventType: 'message',
    payload: `note-${eventId}`,
    payloadHash: `hash-${eventId}`,
    signature: `sig-${eventId}`,
  };
}

describe('own post delivery table (real SQL)', () => {
  it('starts a post once and keeps the first start', () => {
    const db = openDb();
    expect(startGroupPost(db, 'post-1', NOW)).toBe(true);
    expect(startGroupPost(db, 'post-1', NOW + 5_000)).toBe(false);
    expect(
      db.startOwnPostDelivery({
        eventId: 'saved-1',
        scope: 'self_dm',
        conversationId: 'conv-self',
        authorAddress: ME,
        createdAt: NOW + 1,
      })
    ).toBe(true);
    // Not a row: no author, no time, or an unknown scope.
    expect(
      db.startOwnPostDelivery({
        eventId: 'bad-1',
        scope: 'group',
        authorAddress: '',
        createdAt: NOW,
      })
    ).toBe(false);
    expect(
      db.startOwnPostDelivery({
        eventId: 'bad-2',
        scope: 'dm' as any,
        authorAddress: ME,
        createdAt: NOW,
      })
    ).toBe(false);

    expect(db.listOwnPostDelivery(0)).toEqual([
      {
        eventId: 'post-1',
        scope: 'group',
        groupId: GROUP_ID,
        channelId: 'general',
        conversationId: null,
        authorAddress: ME,
        createdAt: NOW,
        ownDeviceAt: null,
        memberAt: null,
        memberPeerHash: null,
        proofKind: null,
      },
      {
        eventId: 'saved-1',
        scope: 'self_dm',
        groupId: null,
        channelId: null,
        conversationId: 'conv-self',
        authorAddress: ME,
        createdAt: NOW + 1,
        ownDeviceAt: null,
        memberAt: null,
        memberPeerHash: null,
        proofKind: null,
      },
    ]);
  });

  it('marks forward-only and returns only the rows that changed', () => {
    const db = openDb();
    startGroupPost(db, 'post-1');
    startGroupPost(db, 'post-2');

    expect(
      db.markOwnPostDelivery([
        { eventId: 'post-1', ownDeviceAt: NOW + 1_000, proofKind: 'live' },
        // Not tracked, and a mark with no time: nothing to change.
        { eventId: 'unknown', memberAt: NOW + 1_000, proofKind: 'live' },
        { eventId: 'post-2', proofKind: 'live' },
      ])
    ).toEqual(['post-1']);
    // A later own-device proof never replaces the first one.
    expect(
      db.markOwnPostDelivery([
        { eventId: 'post-1', ownDeviceAt: NOW + 9_000, proofKind: 'page' },
      ])
    ).toEqual([]);
    expect(
      db
        .markOwnPostDelivery([
          {
            eventId: 'post-1',
            memberAt: NOW + 2_000,
            memberPeerHash: PEER,
            proofKind: 'page',
          },
          {
            eventId: 'post-2',
            ownDeviceAt: NOW + 2_000,
            memberAt: NOW + 2_000,
            memberPeerHash: PEER,
            proofKind: 'range',
          },
        ])
        .sort()
    ).toEqual(['post-1', 'post-2']);
    // The first member's proof stays, peer included.
    expect(
      db.markOwnPostDelivery([
        {
          eventId: 'post-1',
          memberAt: NOW + 3_000,
          memberPeerHash: 'c'.repeat(32),
          proofKind: 'live',
        },
      ])
    ).toEqual([]);

    const rows = new Map(
      db.listOwnPostDelivery(0).map((row) => [row.eventId, row])
    );
    expect(rows.get('post-1')).toMatchObject({
      ownDeviceAt: NOW + 1_000,
      memberAt: NOW + 2_000,
      memberPeerHash: PEER,
      proofKind: 'page',
    });
    expect(rows.get('post-2')).toMatchObject({
      ownDeviceAt: NOW + 2_000,
      memberAt: NOW + 2_000,
      memberPeerHash: PEER,
      proofKind: 'range',
    });
    expect(db.markOwnPostDelivery([])).toEqual([]);
  });

  it('lists from a time and prunes before it', () => {
    const db = openDb();
    startGroupPost(db, 'old', NOW - 31 * DAY);
    startGroupPost(db, 'edge', NOW - 30 * DAY);
    startGroupPost(db, 'new', NOW - DAY);

    expect(
      db.listOwnPostDelivery(NOW - 30 * DAY).map((row) => row.eventId)
    ).toEqual(['edge', 'new']);
    expect(db.pruneOwnPostDelivery(NOW - 30 * DAY)).toBe(1);
    expect(db.listOwnPostDelivery(0).map((row) => row.eventId)).toEqual([
      'edge',
      'new',
    ]);
    expect(db.pruneOwnPostDelivery(NOW - 30 * DAY)).toBe(0);
  });

  it('drops the row of a group post when the post expires', () => {
    const db = openDb();
    const expiring = groupEvent('expiring-post', 1);
    const kept = groupEvent('kept-post', 2);
    expect(db.insertEvent(expiring, true)).toBe(true);
    expect(db.insertEvent(kept, true)).toBe(true);
    startGroupPost(db, expiring.eventId);
    startGroupPost(db, kept.eventId);
    raw(db)
      .prepare(
        `UPDATE rchat_message_projection SET expires_at = ? WHERE root_event_id = ?`
      )
      .run(NOW - 1, expiring.eventId);
    raw(db)
      .prepare(
        `UPDATE rchat_message_projection SET expires_at = ? WHERE root_event_id = ?`
      )
      .run(NOW + DAY, kept.eventId);

    expect(db.pruneExpiredMessages(NOW)).toBe(1);
    expect(db.getEvent(expiring.eventId)).toBeFalsy();
    expect(db.listOwnPostDelivery(0).map((row) => row.eventId)).toEqual([
      kept.eventId,
    ]);
  });

  it('drops the row of a Saved Messages post when it expires', () => {
    const db = openDb();
    const expiring = selfDmEvent('saved-expiring', 1);
    const kept = selfDmEvent('saved-kept', 2);
    expect(db.insertDirectEvent(expiring, true, 'sent')).toBe(true);
    expect(db.insertDirectEvent(kept, true, 'sent')).toBe(true);
    for (const event of [expiring, kept]) {
      db.startOwnPostDelivery({
        eventId: event.eventId,
        scope: 'self_dm',
        conversationId: event.conversationId,
        authorAddress: ME,
        createdAt: NOW,
      });
    }
    raw(db)
      .prepare(`UPDATE rchat_dm_events SET expires_at = ? WHERE event_id = ?`)
      .run(NOW - 1, expiring.eventId);
    raw(db)
      .prepare(`UPDATE rchat_dm_events SET expires_at = ? WHERE event_id = ?`)
      .run(NOW + DAY, kept.eventId);

    expect(db.pruneExpiredDirectMessages(NOW).eventIds).toEqual([
      expiring.eventId,
    ]);
    expect(db.listOwnPostDelivery(0).map((row) => row.eventId)).toEqual([
      kept.eventId,
    ]);
  });

  it('costs an expiring untracked post no delete on the table', () => {
    const db = openDb();
    // A tracked post of each scope that stays, and an untracked one of each
    // that expires: the table is not empty, but nothing on it is deleted.
    const keptPost = groupEvent('kept-post', 1);
    const keptNote = selfDmEvent('kept-note', 1);
    const expiringPost = groupEvent('untracked-post', 2);
    const expiringNote = selfDmEvent('untracked-note', 2);
    expect(db.insertEvent(keptPost, true)).toBe(true);
    expect(db.insertEvent(expiringPost, true)).toBe(true);
    expect(db.insertDirectEvent(keptNote, true, 'sent')).toBe(true);
    expect(db.insertDirectEvent(expiringNote, true, 'sent')).toBe(true);
    startGroupPost(db, keptPost.eventId);
    db.startOwnPostDelivery({
      eventId: keptNote.eventId,
      scope: 'self_dm',
      conversationId: keptNote.conversationId,
      authorAddress: ME,
      createdAt: NOW,
    });
    raw(db)
      .prepare(
        `UPDATE rchat_message_projection SET expires_at = ? WHERE root_event_id = ?`
      )
      .run(NOW - 1, expiringPost.eventId);
    raw(db)
      .prepare(`UPDATE rchat_dm_events SET expires_at = ? WHERE event_id = ?`)
      .run(NOW - 1, expiringNote.eventId);
    const prepare = vi.spyOn(raw(db), 'prepare');

    expect(db.pruneExpiredMessages(NOW)).toBe(1);
    expect(db.pruneExpiredDirectMessages(NOW).eventIds).toEqual([
      expiringNote.eventId,
    ]);
    expect(
      prepare.mock.calls.filter(([sql]) =>
        /DELETE FROM rchat_own_post_delivery/.test(String(sql))
      )
    ).toEqual([]);
    expect(
      db
        .listOwnPostDelivery(0)
        .map((row) => row.eventId)
        .sort()
    ).toEqual([keptNote.eventId, keptPost.eventId].sort());
  });

  it('adds the table to an existing database and keeps its rows on reopen', () => {
    const dbPath = tempDbPath();
    const first = openDb(dbPath);
    // A database from before the table existed.
    raw(first).exec('DROP TABLE rchat_own_post_delivery');
    closeDb(first);

    const second = openDb(dbPath);
    const columns = (
      raw(second)
        .prepare('PRAGMA table_info(rchat_own_post_delivery)')
        .all() as Array<{ name: string }>
    )
      .map((column) => column.name)
      .sort();
    expect(columns).toEqual(
      [
        'event_id',
        'scope',
        'group_id',
        'channel_id',
        'conversation_id',
        'author_address',
        'created_at',
        'own_device_at',
        'member_at',
        'member_peer_hash',
        'proof_kind',
      ].sort()
    );
    startGroupPost(second, 'post-1');
    second.markOwnPostDelivery([
      { eventId: 'post-1', memberAt: NOW + 1, memberPeerHash: PEER },
    ]);
    closeDb(second);

    const third = openDb(dbPath);
    expect(third.listOwnPostDelivery(0)).toEqual([
      expect.objectContaining({
        eventId: 'post-1',
        memberAt: NOW + 1,
        memberPeerHash: PEER,
      }),
    ]);
  });
});
