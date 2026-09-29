import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ReticulumChatDatabase,
  type ReticulumChatDeviceStateRecord,
} from './reticulum-chat-db';

// Under Vitest `better-sqlite3` resolves to the in-memory mock in
// src/test/mocks/betterSqlite3.ts (see vite.config.ts). The mock has no SQL
// engine: every statement shape issued by the device-state DB methods has a
// hand-written handler there, so these tests exercise both the DB layer's
// argument handling and the mock's emulation of LWW, prefix, expiry, replay
// and prune semantics.

const OWNER = 'QownerAddress1111111111111111111111';
const OTHER_OWNER = 'QotherAddress222222222222222222222';
const PEER_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PEER_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const DAY_MS = 24 * 60 * 60 * 1000;

function tempDbPath(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rchat-device-state-db-test-')
  );
  return path.join(root, 'reticulum-chat.db');
}

function record(
  overrides: Partial<ReticulumChatDeviceStateRecord> = {}
): ReticulumChatDeviceStateRecord {
  return {
    ownerAddress: OWNER,
    key: 'notif.mentions',
    value: '1',
    signedAt: 1_000,
    expiresAt: null,
    authorPublicKey: 'pubkey',
    signature: 'sig',
    ...overrides,
  };
}

describe('reticulum chat device state DB layer', () => {
  const open: ReticulumChatDatabase[] = [];

  function openDb(): ReticulumChatDatabase {
    const db = new ReticulumChatDatabase(tempDbPath());
    open.push(db);
    return db;
  }

  afterEach(() => {
    while (open.length) open.pop()?.close();
  });

  it('registers the three device-state tables in the schema self-check', () => {
    const db = openDb();
    const raw = (db as any).db;
    const columns = (table: string) =>
      (raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
        .map((row) => row.name)
        .sort();
    expect(columns('rchat_device_state')).toEqual(
      [
        'owner_address',
        'key',
        'value',
        'signed_at',
        'expires_at',
        'author_public_key',
        'signature',
      ].sort()
    );
    expect(columns('rchat_pending_device_state')).toEqual(
      ['owner_address', 'key', 'value', 'expires_at', 'updated_at'].sort()
    );
    expect(columns('rchat_device_state_ack')).toEqual(
      ['owner_address', 'peer_hash', 'key', 'signed_at'].sort()
    );
  });

  it('upserts and reads a record, applying strict last-writer-wins', () => {
    const db = openDb();
    expect(db.upsertDeviceState(record())).toBe(true);
    expect(db.getDeviceState(OWNER, 'notif.mentions')).toEqual(record());
    expect(db.countDeviceStates(OWNER)).toBe(1);

    // Equal signedAt: ignored.
    expect(db.upsertDeviceState(record({ value: '0' }))).toBe(false);
    expect(db.getDeviceState(OWNER, 'notif.mentions')?.value).toBe('1');
    // Older: ignored.
    expect(db.upsertDeviceState(record({ value: '0', signedAt: 999 }))).toBe(
      false
    );
    expect(db.getDeviceState(OWNER, 'notif.mentions')?.value).toBe('1');
    // Newer: wins, including a tombstone and an expiry.
    expect(
      db.upsertDeviceState(
        record({ value: null, signedAt: 1_001, expiresAt: 5_000 })
      )
    ).toBe(true);
    expect(db.getDeviceState(OWNER, 'notif.mentions')).toEqual(
      record({ value: null, signedAt: 1_001, expiresAt: 5_000 })
    );
    expect(db.countDeviceStates(OWNER)).toBe(1);
    expect(db.countDeviceStates(OTHER_OWNER)).toBe(0);
    expect(db.getNewestDeviceStateSignedAt(OWNER)).toBe(
      db.getDeviceState(OWNER, 'notif.mentions')!.signedAt
    );
    expect(db.getNewestDeviceStateSignedAt(OTHER_OWNER)).toBe(0);
    expect(db.getNewestDeviceStateSignedAt('')).toBe(0);
  });

  it('rejects malformed records without touching the table', () => {
    const db = openDb();
    expect(db.upsertDeviceState(record({ ownerAddress: '' }))).toBe(false);
    expect(db.upsertDeviceState(record({ key: '' }))).toBe(false);
    expect(db.upsertDeviceState(record({ signedAt: 0 }))).toBe(false);
    expect(db.upsertDeviceState(record({ signedAt: Number.NaN }))).toBe(false);
    expect(db.upsertDeviceState(record({ expiresAt: -1 }))).toBe(false);
    expect(db.upsertDeviceState(record({ authorPublicKey: '' }))).toBe(false);
    expect(db.upsertDeviceState(record({ signature: '' }))).toBe(false);
    expect(db.countDeviceStates(OWNER)).toBe(0);
    expect(db.getDeviceState(OWNER, '')).toBeNull();
    expect(db.getDeviceState('', 'notif.mentions')).toBeNull();
  });

  it('lists states per owner in signed_at order with an escaped prefix filter', () => {
    const db = openDb();
    db.upsertDeviceState(record({ key: 'notif.seenall', signedAt: 30 }));
    db.upsertDeviceState(record({ key: 'notif.mentions', signedAt: 10 }));
    db.upsertDeviceState(record({ key: 'notif_x', signedAt: 20 }));
    db.upsertDeviceState(record({ key: 'other.key', signedAt: 5 }));
    db.upsertDeviceState(
      record({ ownerAddress: OTHER_OWNER, key: 'notif.mentions', signedAt: 1 })
    );

    expect(db.getDeviceStates(OWNER).map((row) => row.key)).toEqual([
      'other.key',
      'notif.mentions',
      'notif_x',
      'notif.seenall',
    ]);
    // `.` is not a LIKE wildcard, `_` is: the prefix must be escaped so that
    // `notif.` does not match `notif_x`.
    expect(db.getDeviceStates(OWNER, 'notif.').map((row) => row.key)).toEqual([
      'notif.mentions',
      'notif.seenall',
    ]);
    expect(db.getDeviceStates(OWNER, 'notif_').map((row) => row.key)).toEqual([
      'notif_x',
    ]);
    expect(db.getDeviceStates(OWNER, 'nope.')).toEqual([]);
    // Keys are exact-case: a prefix filter must not fold ASCII case the way
    // SQLite's LIKE does by default.
    db.upsertDeviceState(record({ key: 'Notif.upper', signedAt: 40 }));
    expect(db.getDeviceStates(OWNER, 'notif.').map((row) => row.key)).toEqual([
      'notif.mentions',
      'notif.seenall',
    ]);
    expect(db.getDeviceStates(OWNER, 'Notif.').map((row) => row.key)).toEqual([
      'Notif.upper',
    ]);
    expect(db.getDeviceStates(OWNER, undefined, 2).map((r) => r.key)).toEqual([
      'other.key',
      'notif.mentions',
    ]);
    expect(db.getDeviceStates('')).toEqual([]);
  });

  it('includes tombstones but excludes expired rows from listings', () => {
    const db = openDb();
    const now = Date.now();
    db.upsertDeviceState(record({ key: 'live', signedAt: 1 }));
    db.upsertDeviceState(
      record({ key: 'tomb', value: null, signedAt: 2, expiresAt: null })
    );
    db.upsertDeviceState(
      record({ key: 'future', signedAt: 3, expiresAt: now + DAY_MS })
    );
    db.upsertDeviceState(
      record({ key: 'expired', signedAt: 4, expiresAt: now - 1 })
    );

    expect(db.getDeviceStates(OWNER).map((row) => row.key)).toEqual([
      'live',
      'tomb',
      'future',
    ]);
    expect(db.getDeviceStatesSince(OWNER, 0).map((row) => row.key)).toEqual([
      'live',
      'tomb',
      'future',
    ]);
    // getDeviceState is the raw row lookup used for ack/LWW checks; it does
    // not hide expired rows.
    expect(db.getDeviceState(OWNER, 'expired')?.signedAt).toBe(4);
    expect(db.countDeviceStates(OWNER)).toBe(4);
  });

  it('returns only rows signed after the given watermark', () => {
    const db = openDb();
    db.upsertDeviceState(record({ key: 'a', signedAt: 10 }));
    db.upsertDeviceState(record({ key: 'b', signedAt: 20 }));
    db.upsertDeviceState(record({ key: 'c', signedAt: 30 }));
    db.upsertDeviceState(
      record({ ownerAddress: OTHER_OWNER, key: 'd', signedAt: 40 })
    );

    expect(db.getDeviceStatesSince(OWNER, 20).map((row) => row.key)).toEqual([
      'c',
    ]);
    expect(db.getDeviceStatesSince(OWNER, 0).map((row) => row.key)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(db.getDeviceStatesSince(OWNER, 30)).toEqual([]);
    expect(db.getDeviceStatesSince(OWNER, 0, 2).map((row) => row.key)).toEqual([
      'a',
      'b',
    ]);
  });

  it('stores acks per peer and replays only rows the peer has not acked', () => {
    const db = openDb();
    const now = Date.now();
    db.upsertDeviceState(record({ key: 'a', signedAt: 10 }));
    db.upsertDeviceState(record({ key: 'b', signedAt: 20 }));
    db.upsertDeviceState(
      record({ key: 'expired', signedAt: 30, expiresAt: now - 1 })
    );

    expect(db.getDeviceStateAck(OWNER, PEER_A, 'a')).toBe(0);
    expect(
      db.getDeviceStatesForReplay(OWNER, PEER_A).map((r) => r.key)
    ).toEqual(['a', 'b']);

    db.upsertDeviceStateAck(OWNER, PEER_A, 'a', 10);
    expect(db.getDeviceStateAck(OWNER, PEER_A, 'a')).toBe(10);
    expect(db.getDeviceStateAck(OWNER, PEER_B, 'a')).toBe(0);
    expect(
      db.getDeviceStatesForReplay(OWNER, PEER_A).map((r) => r.key)
    ).toEqual(['b']);
    // Acks are per peer: PEER_B still needs everything.
    expect(
      db.getDeviceStatesForReplay(OWNER, PEER_B).map((r) => r.key)
    ).toEqual(['a', 'b']);

    // A stale ack (older signed_at than the row) does not suppress replay.
    db.upsertDeviceState(record({ key: 'a', value: '2', signedAt: 11 }));
    expect(
      db.getDeviceStatesForReplay(OWNER, PEER_A).map((r) => r.key)
    ).toEqual(['a', 'b']);
    // Re-acking the newer signed_at updates the ack in place.
    db.upsertDeviceStateAck(OWNER, PEER_A, 'a', 11);
    expect(db.getDeviceStateAck(OWNER, PEER_A, 'a')).toBe(11);
    db.upsertDeviceStateAck(OWNER, PEER_A, 'b', 20);
    expect(db.getDeviceStatesForReplay(OWNER, PEER_A)).toEqual([]);

    // Invalid acks are ignored rather than stored.
    db.upsertDeviceStateAck(OWNER, PEER_A, 'b', 0);
    expect(db.getDeviceStateAck(OWNER, PEER_A, 'b')).toBe(20);
    expect(db.getDeviceStatesForReplay('', PEER_A)).toEqual([]);
    expect(db.getDeviceStatesForReplay(OWNER, '')).toEqual([]);
  });

  it('keeps the newest pending write per key and deletes up to a watermark', () => {
    const db = openDb();
    db.upsertPendingDeviceState({
      ownerAddress: OWNER,
      key: 'notif.mentions',
      value: '1',
      expiresAt: null,
      updatedAt: 100,
    });
    db.upsertPendingDeviceState({
      ownerAddress: OWNER,
      key: 'notif.seenall',
      value: '123',
      expiresAt: 9_999,
      updatedAt: 50,
    });
    db.upsertPendingDeviceState({
      ownerAddress: OTHER_OWNER,
      key: 'notif.mentions',
      value: '0',
      expiresAt: null,
      updatedAt: 1,
    });

    expect(db.getPendingDeviceStates(OWNER)).toEqual([
      {
        ownerAddress: OWNER,
        key: 'notif.seenall',
        value: '123',
        expiresAt: 9_999,
        updatedAt: 50,
      },
      {
        ownerAddress: OWNER,
        key: 'notif.mentions',
        value: '1',
        expiresAt: null,
        updatedAt: 100,
      },
    ]);

    // An older write never regresses the pending row.
    db.upsertPendingDeviceState({
      ownerAddress: OWNER,
      key: 'notif.mentions',
      value: 'stale',
      expiresAt: null,
      updatedAt: 90,
    });
    expect(
      db.getPendingDeviceStates(OWNER).find((r) => r.key === 'notif.mentions')
        ?.value
    ).toBe('1');
    // A newer write (or a tombstone) replaces it.
    db.upsertPendingDeviceState({
      ownerAddress: OWNER,
      key: 'notif.mentions',
      value: null,
      expiresAt: null,
      updatedAt: 110,
    });
    expect(
      db.getPendingDeviceStates(OWNER).find((r) => r.key === 'notif.mentions')
    ).toEqual({
      ownerAddress: OWNER,
      key: 'notif.mentions',
      value: null,
      expiresAt: null,
      updatedAt: 110,
    });

    // Deleting up to an older watermark keeps a pending row that was updated
    // again after signing started.
    db.deletePendingDeviceState(OWNER, 'notif.mentions', 100);
    expect(db.getPendingDeviceStates(OWNER).map((r) => r.key)).toEqual([
      'notif.seenall',
      'notif.mentions',
    ]);
    db.deletePendingDeviceState(OWNER, 'notif.mentions', 110);
    expect(db.getPendingDeviceStates(OWNER).map((r) => r.key)).toEqual([
      'notif.seenall',
    ]);
    expect(db.getPendingDeviceStates(OTHER_OWNER)).toHaveLength(1);
    expect(db.getPendingDeviceStates('')).toEqual([]);
  });

  it('prunes expired rows and old tombstones together with their acks', () => {
    const db = openDb();
    // Listings filter expiry against the wall clock, so anchor on Date.now().
    const now = Date.now();
    db.upsertDeviceState(record({ key: 'live', signedAt: now - DAY_MS }));
    db.upsertDeviceState(
      record({ key: 'expired', signedAt: now - DAY_MS, expiresAt: now - 1 })
    );
    db.upsertDeviceState(
      record({ key: 'boundary', signedAt: now - DAY_MS, expiresAt: now })
    );
    db.upsertDeviceState(
      record({
        key: 'unexpired',
        signedAt: now - DAY_MS,
        expiresAt: now + DAY_MS,
      })
    );
    db.upsertDeviceState(
      record({ key: 'old-tomb', value: null, signedAt: now - 31 * DAY_MS })
    );
    db.upsertDeviceState(
      record({ key: 'fresh-tomb', value: null, signedAt: now - 29 * DAY_MS })
    );
    db.upsertDeviceState(
      record({ key: 'old-live', value: 'v', signedAt: now - 31 * DAY_MS })
    );
    for (const key of [
      'live',
      'expired',
      'boundary',
      'unexpired',
      'old-tomb',
      'fresh-tomb',
      'old-live',
    ]) {
      db.upsertDeviceStateAck(OWNER, PEER_A, key, 1);
      db.upsertDeviceStateAck(OWNER, PEER_B, key, 1);
    }
    // Same key under another owner must survive the prune untouched.
    db.upsertDeviceState(
      record({ ownerAddress: OTHER_OWNER, key: 'expired', signedAt: 1 })
    );
    db.upsertDeviceStateAck(OTHER_OWNER, PEER_A, 'expired', 1);

    expect(db.pruneDeviceStates(now)).toEqual({ expired: 2, tombstones: 1 });

    expect(db.countDeviceStates(OWNER)).toBe(4);
    expect(
      db
        .getDeviceStates(OWNER)
        .map((r) => r.key)
        .sort()
    ).toEqual(['fresh-tomb', 'live', 'old-live', 'unexpired']);
    expect(db.getDeviceState(OWNER, 'expired')).toBeNull();
    expect(db.getDeviceState(OWNER, 'boundary')).toBeNull();
    expect(db.getDeviceState(OWNER, 'old-tomb')).toBeNull();

    for (const peer of [PEER_A, PEER_B]) {
      expect(db.getDeviceStateAck(OWNER, peer, 'expired')).toBe(0);
      expect(db.getDeviceStateAck(OWNER, peer, 'boundary')).toBe(0);
      expect(db.getDeviceStateAck(OWNER, peer, 'old-tomb')).toBe(0);
      expect(db.getDeviceStateAck(OWNER, peer, 'live')).toBe(1);
      expect(db.getDeviceStateAck(OWNER, peer, 'unexpired')).toBe(1);
      expect(db.getDeviceStateAck(OWNER, peer, 'fresh-tomb')).toBe(1);
      expect(db.getDeviceStateAck(OWNER, peer, 'old-live')).toBe(1);
    }
    expect(db.getDeviceState(OTHER_OWNER, 'expired')?.signedAt).toBe(1);
    expect(db.getDeviceStateAck(OTHER_OWNER, PEER_A, 'expired')).toBe(1);

    // Idempotent on a second pass.
    expect(db.pruneDeviceStates(now)).toEqual({ expired: 0, tombstones: 0 });
  });

  it('keeps device-state tables separate from the device read-state tables', () => {
    const db = openDb();
    db.upsertDeviceReadState({
      ownerAddress: OWNER,
      scopeType: 'dm',
      scopeId: 'peer',
      upToTimestamp: 500,
      signedAt: 500,
      authorPublicKey: 'pubkey',
      signature: 'sig',
    });
    db.upsertPendingDeviceReadState({
      ownerAddress: OWNER,
      scopeType: 'group',
      scopeId: '1:general',
      upToTimestamp: 600,
      updatedAt: 600,
    });
    db.upsertDeviceState(record({ key: 'a', signedAt: 10 }));
    db.upsertPendingDeviceState({
      ownerAddress: OWNER,
      key: 'a',
      value: '1',
      expiresAt: null,
      updatedAt: 10,
    });

    expect(db.getDeviceStates(OWNER)).toHaveLength(1);
    expect(db.getPendingDeviceStates(OWNER)).toHaveLength(1);
    expect(db.getDeviceReadStates(OWNER)).toHaveLength(1);
    expect(db.getDeviceReadState(OWNER, 'dm', 'peer')?.upToTimestamp).toBe(500);
    expect(db.getPendingDeviceReadStates(OWNER)).toHaveLength(1);

    db.deletePendingDeviceState(OWNER, 'a', 10);
    expect(db.getPendingDeviceStates(OWNER)).toHaveLength(0);
    expect(db.getPendingDeviceReadStates(OWNER)).toHaveLength(1);
    db.pruneDeviceStates(Date.now());
    expect(db.getDeviceReadStates(OWNER)).toHaveLength(1);
  });
});
