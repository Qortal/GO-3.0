import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReticulumChatDatabase } from './reticulum-chat-db';

// Under Vitest `better-sqlite3` resolves to the statement-shape mock in
// src/test/mocks/betterSqlite3.ts. Engine tests that run on it with
// trackOwnPostDelivery need its rchat_own_post_delivery handlers to behave
// like the real SQL (reticulum-chat-own-post-delivery-db.test.ts).

const ME = 'QmeAddress11111111111111111111111';
const PEER = 'b'.repeat(32);
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60_000;

const open: ReticulumChatDatabase[] = [];

afterEach(() => {
  while (open.length) open.pop()?.close();
});

function openDb(): ReticulumChatDatabase {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-own-post-mock-'));
  const db = new ReticulumChatDatabase(path.join(root, 'reticulum-chat.db'));
  open.push(db);
  return db;
}

describe('own post delivery table (statement mock)', () => {
  it('starts once, marks forward-only, lists and prunes', () => {
    const db = openDb();
    const start = (eventId: string, createdAt: number) =>
      db.startOwnPostDelivery({
        eventId,
        scope: 'group',
        groupId: 7,
        channelId: 'general',
        authorAddress: ME,
        createdAt,
      });
    expect(start('old', NOW - 31 * DAY)).toBe(true);
    expect(start('post', NOW)).toBe(true);
    expect(start('post', NOW + 1)).toBe(false);

    expect(
      db.markOwnPostDelivery([
        { eventId: 'post', ownDeviceAt: NOW + 1, proofKind: 'live' },
      ])
    ).toEqual(['post']);
    expect(
      db.markOwnPostDelivery([
        { eventId: 'post', ownDeviceAt: NOW + 2, proofKind: 'live' },
        {
          eventId: 'post',
          memberAt: NOW + 3,
          memberPeerHash: PEER,
          proofKind: 'page',
        },
      ])
    ).toEqual(['post']);
    expect(
      db.markOwnPostDelivery([
        { eventId: 'post', memberAt: NOW + 4, memberPeerHash: 'c'.repeat(32) },
      ])
    ).toEqual([]);

    expect(db.listOwnPostDelivery(NOW - 30 * DAY)).toEqual([
      expect.objectContaining({
        eventId: 'post',
        createdAt: NOW,
        ownDeviceAt: NOW + 1,
        memberAt: NOW + 3,
        memberPeerHash: PEER,
        proofKind: 'page',
      }),
    ]);
    expect(db.pruneOwnPostDelivery(NOW - 30 * DAY)).toBe(1);
    expect(db.listOwnPostDelivery(0).map((row) => row.eventId)).toEqual([
      'post',
    ]);
  });
});
