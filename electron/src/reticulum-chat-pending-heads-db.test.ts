import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';
import { ReticulumChatDatabase } from './reticulum-chat-db';

// Under Vitest `better-sqlite3` resolves to the statement-shape mock, which
// cannot evaluate the pending-heads SQL. These tests run the real queries of
// ReticulumChatDatabase against Node's built-in SQLite (node:sqlite, Node 22+)
// through a thin prepare/all/get/run adapter, and skip where it is missing.

type SqliteStatement = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => unknown;
  run: (...params: unknown[]) => unknown;
};
type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
};

const DatabaseSync = (() => {
  try {
    const load = createRequire(import.meta.url);
    return (
      load('node:sqlite') as {
        DatabaseSync: new (path: string) => SqliteDatabase;
      }
    ).DatabaseSync;
  } catch {
    return null;
  }
})();

// Columns of rchat_dm_events as created and migrated by the DB layer.
const DM_EVENTS_SCHEMA = `
  CREATE TABLE rchat_dm_events (
    event_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_address TEXT NOT NULL,
    recipient_address TEXT NOT NULL,
    sender_public_key TEXT NOT NULL,
    sender_stream_id TEXT NOT NULL DEFAULT '',
    sender_seq INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    target_event_id TEXT,
    reply_to_event_id TEXT,
    payload TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    signature TEXT NOT NULL,
    legacy_signature TEXT,
    own_event INTEGER NOT NULL DEFAULT 0,
    read_at INTEGER NOT NULL DEFAULT 0,
    stored_at INTEGER NOT NULL,
    wire_bytes INTEGER NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT 'received',
    delivery_updated_at INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    message_expiry_duration_ms INTEGER,
    own_device_copied_at INTEGER,
    delivery_attempts INTEGER,
    next_delivery_attempt_at INTEGER,
    UNIQUE (conversation_id, sender_address, sender_stream_id, sender_seq)
  );
  CREATE INDEX idx_rchat_dm_events_conversation_time
    ON rchat_dm_events (conversation_id, timestamp, event_id);
  CREATE INDEX idx_rchat_dm_events_pending_delivery
    ON rchat_dm_events (delivery_status, sender_address, timestamp);
`;
// rchat_dm_events before the own-device copy and retry migrations.
const PRE_MIGRATION_DM_EVENTS_SCHEMA = DM_EVENTS_SCHEMA.replace(
  /\n\s*(own_device_copied_at|delivery_attempts|next_delivery_attempt_at) INTEGER,/g,
  ''
);
const SYNC_STATE_SCHEMA = `
  CREATE TABLE rchat_sync_state (
    scope TEXT NOT NULL,
    group_id INTEGER NOT NULL,
    peer_hash TEXT NOT NULL DEFAULT '',
    state_key TEXT NOT NULL,
    state_value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (scope, group_id, peer_hash, state_key)
  );
`;

const ME = 'QmeAddress11111111111111111111111';
const PEER_A = 'QpeerA111111111111111111111111111';
const PEER_B = 'QpeerB222222222222222222222222222';
const HOUR = 60 * 60_000;
const NOW = 1_800_000_000_000;
const TAIL_SINCE = NOW - 7 * 24 * HOUR;
const COPIED_CUTOFF = NOW - 2 * HOUR;

type RowInput = {
  eventId: string;
  conversationId: string;
  sender?: string;
  recipient?: string;
  timestamp: number;
  status?: 'pending' | 'sent' | 'received';
  ownEvent?: boolean;
  expiresAt?: number | null;
  copiedAt?: number | null;
  attempts?: number | null;
  next?: number | null;
};

function openDb(schema = DM_EVENTS_SCHEMA) {
  const raw = new DatabaseSync!(':memory:');
  raw.exec(schema);
  raw.exec(SYNC_STATE_SCHEMA);
  const db = Object.create(
    ReticulumChatDatabase.prototype
  ) as ReticulumChatDatabase;
  (db as any).db = raw;
  let seq = 0;
  const insert = (row: RowInput) => {
    seq += 1;
    raw
      .prepare(
        `INSERT INTO rchat_dm_events (
           event_id, conversation_id, sender_address, recipient_address,
           sender_public_key, sender_seq, timestamp, event_type, payload,
           payload_hash, signature, own_event, stored_at, wire_bytes,
           delivery_status, expires_at, own_device_copied_at,
           delivery_attempts, next_delivery_attempt_at
         ) VALUES (?, ?, ?, ?, 'pk', ?, ?, 'message', 'p', 'h', 's', ?, ?, 1,
                   ?, ?, ?, ?, ?)`
      )
      .run(
        row.eventId,
        row.conversationId,
        row.sender ?? ME,
        row.recipient ?? PEER_A,
        seq,
        row.timestamp,
        row.ownEvent === false ? 0 : 1,
        row.timestamp,
        row.status ?? 'pending',
        row.expiresAt ?? null,
        row.copiedAt ?? null,
        row.attempts ?? null,
        row.next ?? null
      );
  };
  return { db, raw, insert };
}

// Locally an older Node skips these; CI must not skip them silently.
it.runIf(!DatabaseSync && !!process.env.CI)(
  'has node:sqlite for the real-SQL pending heads tests',
  () => {
    expect(DatabaseSync).not.toBeNull();
  }
);

describe.skipIf(!DatabaseSync)(
  'reticulum chat pending own DM heads (real SQL)',
  () => {
    const heads = (db: ReticulumChatDatabase, limit = 16) =>
      db.listPendingOwnDirectConversationHeads(
        ME,
        TAIL_SINCE,
        COPIED_CUTOFF,
        limit,
        NOW
      );

    it('returns the newest pending own event per conversation, due heads first', () => {
      const { db, raw, insert } = openDb();
      try {
        insert({
          eventId: 'a-old',
          conversationId: 'conv-a',
          timestamp: NOW - 50 * 60_000,
        });
        insert({
          eventId: 'a-new',
          conversationId: 'conv-a',
          timestamp: NOW - 40 * 60_000,
          attempts: 3,
          next: NOW + 60_000,
        });
        insert({
          eventId: 'b-new',
          conversationId: 'conv-b',
          recipient: PEER_B,
          timestamp: NOW - 30 * 60_000,
        });
        // Not candidates: a peer's event, an own sent event, an expired one,
        // a self-DM, and one older than the tail window.
        insert({
          eventId: 'c-peer',
          conversationId: 'conv-c',
          sender: PEER_A,
          recipient: ME,
          timestamp: NOW - 60_000,
          ownEvent: false,
        });
        insert({
          eventId: 'd-sent',
          conversationId: 'conv-d',
          timestamp: NOW - 60_000,
          status: 'sent',
        });
        insert({
          eventId: 'e-expired',
          conversationId: 'conv-e',
          timestamp: NOW - 60_000,
          expiresAt: NOW - 1,
        });
        insert({
          eventId: 'f-self',
          conversationId: 'conv-f',
          recipient: ME,
          timestamp: NOW - 60_000,
        });
        insert({
          eventId: 'g-ancient',
          conversationId: 'conv-g',
          timestamp: TAIL_SINCE - 1,
        });

        const list = heads(db);
        expect(list.map((head) => head.event.eventId)).toEqual([
          'b-new',
          'a-new',
        ]);
        expect(list[0]).toMatchObject({
          deliveryAttempts: 0,
          nextDeliveryAttemptAt: 0,
        });
        expect(list[1]).toMatchObject({
          deliveryAttempts: 3,
          nextDeliveryAttemptAt: NOW + 60_000,
        });
        expect(heads(db, 1).map((head) => head.event.eventId)).toEqual([
          'b-new',
        ]);

        // A newer sent event does not hide the pending head (it is still due).
        insert({
          eventId: 'a-sent-newer',
          conversationId: 'conv-a',
          timestamp: NOW - 10 * 60_000,
          status: 'sent',
        });
        expect(heads(db).map((head) => head.event.eventId)).toContain('a-new');
        expect(
          db.getPendingOwnDirectConversationHead(
            ME,
            'conv-a',
            TAIL_SINCE,
            COPIED_CUTOFF,
            NOW
          )?.event.eventId
        ).toBe('a-new');
        expect(
          db.getPendingOwnDirectConversationHead(
            ME,
            'conv-c',
            TAIL_SINCE,
            COPIED_CUTOFF,
            NOW
          )
        ).toBeNull();
      } finally {
        raw.close();
      }
    });

    it('drops a copied tail head without promoting an older uncopied event', () => {
      const { db, raw, insert } = openDb();
      try {
        insert({
          eventId: 'tail-older',
          conversationId: 'conv-a',
          timestamp: NOW - 5 * HOUR,
        });
        insert({
          eventId: 'tail-head',
          conversationId: 'conv-a',
          timestamp: NOW - 3 * HOUR,
          copiedAt: NOW - 2 * HOUR,
        });
        // Inside the 2 h window a copy does not matter.
        insert({
          eventId: 'young-copied',
          conversationId: 'conv-b',
          recipient: PEER_B,
          timestamp: NOW - HOUR,
          copiedAt: NOW - 30 * 60_000,
        });

        expect(heads(db).map((head) => head.event.eventId)).toEqual([
          'young-copied',
        ]);
        expect(
          db.getPendingOwnDirectConversationHead(
            ME,
            'conv-a',
            TAIL_SINCE,
            COPIED_CUTOFF,
            NOW
          )
        ).toBeNull();
        expect(
          db.nextPendingOwnDirectDeliveryDueAt(
            ME,
            TAIL_SINCE,
            COPIED_CUTOFF,
            NOW
          )
        ).toBe(0);

        raw
          .prepare(
            `UPDATE rchat_dm_events SET own_device_copied_at = NULL WHERE event_id = 'tail-head'`
          )
          .run();
        expect(
          heads(db)
            .map((head) => head.event.eventId)
            .sort()
        ).toEqual(['tail-head', 'young-copied']);
      } finally {
        raw.close();
      }
    });

    it('round-trips the retry state and reports the earliest due time', () => {
      const { db, raw, insert } = openDb();
      try {
        expect(
          db.nextPendingOwnDirectDeliveryDueAt(
            ME,
            TAIL_SINCE,
            COPIED_CUTOFF,
            NOW
          )
        ).toBeNull();

        insert({
          eventId: 'due-a',
          conversationId: 'conv-a',
          timestamp: NOW - 10 * 60_000,
        });
        insert({
          eventId: 'due-b',
          conversationId: 'conv-b',
          recipient: PEER_B,
          timestamp: NOW - 20 * 60_000,
        });
        // Never attempted: due now.
        expect(
          db.nextPendingOwnDirectDeliveryDueAt(
            ME,
            TAIL_SINCE,
            COPIED_CUTOFF,
            NOW
          )
        ).toBe(0);

        db.setDirectEventDeliveryRetry('due-a', 2, NOW + 5 * 60_000);
        db.setDirectEventDeliveryRetry('due-b', 1, NOW + 60_000);
        expect(
          db.nextPendingOwnDirectDeliveryDueAt(
            ME,
            TAIL_SINCE,
            COPIED_CUTOFF,
            NOW
          )
        ).toBe(NOW + 60_000);
        const byId = new Map(
          heads(db).map((head) => [head.event.eventId, head])
        );
        expect(byId.get('due-a')).toMatchObject({
          deliveryAttempts: 2,
          nextDeliveryAttemptAt: NOW + 5 * 60_000,
        });
        expect(byId.get('due-b')).toMatchObject({
          deliveryAttempts: 1,
          nextDeliveryAttemptAt: NOW + 60_000,
        });

        // Only own events carry retry state.
        insert({
          eventId: 'peer-event',
          conversationId: 'conv-c',
          sender: PEER_A,
          recipient: ME,
          timestamp: NOW,
          ownEvent: false,
        });
        db.setDirectEventDeliveryRetry('peer-event', 5, NOW);
        expect(
          raw
            .prepare(
              `SELECT delivery_attempts FROM rchat_dm_events WHERE event_id = 'peer-event'`
            )
            .get()
        ).toMatchObject({ delivery_attempts: null });

        // Delivered: no head, no due time.
        raw
          .prepare(`UPDATE rchat_dm_events SET delivery_status = 'sent'`)
          .run();
        expect(heads(db)).toEqual([]);
        expect(
          db.nextPendingOwnDirectDeliveryDueAt(
            ME,
            TAIL_SINCE,
            COPIED_CUTOFF,
            NOW
          )
        ).toBeNull();
      } finally {
        raw.close();
      }
    });

    it('lists one uncopied head per conversation, so a busy one cannot starve the others', () => {
      const { db, raw, insert } = openDb();
      try {
        // 70 uncopied events in conv-a, all newer than conv-b's head.
        for (let i = 0; i < 70; i += 1) {
          insert({
            eventId: `a-${String(i).padStart(2, '0')}`,
            conversationId: 'conv-a',
            timestamp: NOW - 60 * 60_000 + i * 1_000,
          });
        }
        insert({
          eventId: 'b-head',
          conversationId: 'conv-b',
          recipient: PEER_B,
          timestamp: NOW - 2 * HOUR,
        });
        insert({
          eventId: 'b-older',
          conversationId: 'conv-b',
          recipient: PEER_B,
          timestamp: NOW - 3 * HOUR,
        });
        // A copied head is skipped; the newest uncopied one of conv-c leads.
        insert({
          eventId: 'c-copied',
          conversationId: 'conv-c',
          timestamp: NOW - 10 * 60_000,
          copiedAt: NOW - 5 * 60_000,
        });
        insert({
          eventId: 'c-uncopied',
          conversationId: 'conv-c',
          timestamp: NOW - 20 * 60_000,
        });
        insert({
          eventId: 'd-sent',
          conversationId: 'conv-d',
          timestamp: NOW - 60_000,
          status: 'sent',
        });
        expect(
          db
            .listUncopiedPendingOwnDirectEvents(ME, TAIL_SINCE, 64, NOW)
            .map((event) => event.eventId)
        ).toEqual(['c-uncopied', 'a-69', 'b-head']);
        expect(
          db
            .listUncopiedPendingOwnDirectEvents(ME, TAIL_SINCE, 1, NOW)
            .map((event) => event.eventId)
        ).toEqual(['c-uncopied']);
      } finally {
        raw.close();
      }
    });

    it('lists pending own events a cursor passed, oldest first, inside the window', () => {
      // Real (normalized) conversation ids, as the page server passes them.
      const CONV_A = 'a'.repeat(64);
      const CONV_B = 'b'.repeat(64);
      const { db, raw, insert } = openDb();
      try {
        insert({
          eventId: 'too-old',
          conversationId: CONV_A,
          timestamp: TAIL_SINCE - 1,
        });
        insert({
          eventId: 'm1',
          conversationId: CONV_A,
          timestamp: NOW - 3 * HOUR,
        });
        insert({
          eventId: 'm1-copied',
          conversationId: CONV_A,
          timestamp: NOW - 2 * HOUR,
          copiedAt: NOW - HOUR,
        });
        insert({
          eventId: 'sent',
          conversationId: CONV_A,
          timestamp: NOW - 90 * 60_000,
          status: 'sent',
        });
        insert({
          eventId: 'peer',
          conversationId: CONV_A,
          sender: PEER_A,
          recipient: ME,
          timestamp: NOW - 80 * 60_000,
          ownEvent: false,
        });
        insert({
          eventId: 'after-cursor',
          conversationId: CONV_A,
          timestamp: NOW - 10 * 60_000,
        });
        insert({
          eventId: 'other-conversation',
          conversationId: CONV_B,
          recipient: PEER_B,
          timestamp: NOW - 3 * HOUR,
        });
        const cursor = NOW - HOUR;
        const ids = (uncopiedOnly: boolean, limit = 50) =>
          db
            .listPendingOwnDirectEventsBetween(ME, CONV_A, TAIL_SINCE, cursor, {
              uncopiedOnly,
              limit,
              now: NOW,
            })
            .map((event) => event.eventId);
        expect(ids(false)).toEqual(['m1', 'm1-copied']);
        expect(ids(true)).toEqual(['m1']);
        expect(ids(false, 1)).toEqual(['m1']);
        expect(
          db.listPendingOwnDirectEventsBetween(ME, CONV_A, cursor, 0, {
            now: NOW,
          })
        ).toEqual([]);
      } finally {
        raw.close();
      }
    });

    it('persists and prunes the Saved Messages confirmations per own device', () => {
      const { db, raw } = openDb();
      try {
        expect(db.getSelfDmConfirmedCursor(ME, 'dev-1')).toBeNull();
        db.setSelfDmConfirmedCursor(
          ME,
          'dev-1',
          { eventId: 'saved-1', timestamp: NOW - HOUR },
          NOW - HOUR,
          NOW - 49 * HOUR
        );
        db.setSelfDmConfirmedCursor(
          ME,
          'dev-2',
          { eventId: 'saved-0', timestamp: NOW - 2 * HOUR },
          NOW - 2 * HOUR,
          NOW - 50 * HOUR
        );
        expect(db.getSelfDmConfirmedCursor(ME, 'dev-1')).toEqual({
          eventId: 'saved-1',
          timestamp: NOW - HOUR,
        });
        expect(db.getSelfDmConfirmedCursor(PEER_A, 'dev-1')).toBeNull();
        db.setSelfDmConfirmedCursor(
          ME,
          'dev-1',
          { eventId: 'saved-2', timestamp: NOW },
          NOW,
          NOW - 90 * 60_000
        );
        expect(db.getSelfDmConfirmedCursor(ME, 'dev-1')).toEqual({
          eventId: 'saved-2',
          timestamp: NOW,
        });
        // dev-2's row was written before the prune cutoff.
        expect(db.getSelfDmConfirmedCursor(ME, 'dev-2')).toBeNull();
        expect(
          raw.prepare(`SELECT COUNT(*) AS n FROM rchat_sync_state`).get()
        ).toMatchObject({ n: 1 });
      } finally {
        raw.close();
      }
    });

    it('migrates a pre-existing rchat_dm_events table in place', () => {
      const { db, raw } = openDb(PRE_MIGRATION_DM_EVENTS_SCHEMA);
      try {
        raw
          .prepare(
            `INSERT INTO rchat_dm_events (
               event_id, conversation_id, sender_address, recipient_address,
               sender_public_key, sender_seq, timestamp, event_type, payload,
               payload_hash, signature, own_event, stored_at, wire_bytes,
               delivery_status
             ) VALUES ('legacy', 'conv-a', ?, ?, 'pk', 1, ?, 'message', 'p',
                       'h', 's', 1, ?, 1, 'pending')`
          )
          .run(ME, PEER_A, NOW - HOUR, NOW - HOUR);
        const columns = () => (db as any).tableColumns('rchat_dm_events');
        expect(columns().has('own_device_copied_at')).toBe(false);
        for (let pass = 0; pass < 2; pass += 1) {
          (db as any).migrateDirectOwnDeviceCopiedSchema();
          (db as any).migrateDirectDeliveryRetrySchema();
        }
        for (const column of [
          'own_device_copied_at',
          'delivery_attempts',
          'next_delivery_attempt_at',
        ]) {
          expect(columns().has(column)).toBe(true);
        }
        expect(
          raw
            .prepare(
              `SELECT own_device_copied_at, delivery_attempts,
                      next_delivery_attempt_at, payload
               FROM rchat_dm_events WHERE event_id = 'legacy'`
            )
            .get()
        ).toMatchObject({
          own_device_copied_at: null,
          delivery_attempts: null,
          next_delivery_attempt_at: null,
          payload: 'p',
        });
        expect(heads(db).map((head) => head.event.eventId)).toEqual(['legacy']);
        expect(
          db
            .listUncopiedPendingOwnDirectEvents(ME, TAIL_SINCE, 64, NOW)
            .map((event) => event.eventId)
        ).toEqual(['legacy']);
      } finally {
        raw.close();
      }
    });
  }
);
