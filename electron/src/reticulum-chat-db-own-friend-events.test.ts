import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Under Vitest `better-sqlite3` resolves to a statement-shape mock. These
// tests run the real ReticulumChatDatabase SQL against Node's built-in SQLite
// (node:sqlite) through a minimal better-sqlite3 adapter, so the friend-event
// query really runs.
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
import type { ReticulumDmEvent } from './reticulum-chat';

const roots: string[] = [];
const ME = 'Qme';
const PEER = 'Qpeer';
const conversationId = reticulumDmConversationId(ME, PEER);

const openDb = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-own-friend-'));
  roots.push(root);
  return new ReticulumChatDatabase(path.join(root, 'reticulum-chat.db'));
};

let seq = 0;
const event = (
  overrides: Partial<ReticulumDmEvent> & Pick<ReticulumDmEvent, 'eventId'>
): ReticulumDmEvent => {
  const senderAddress = overrides.senderAddress || ME;
  return {
    conversationId,
    senderAddress,
    recipientAddress: senderAddress === ME ? PEER : ME,
    senderPublicKey: 'public-key',
    senderStreamId: (senderAddress === ME ? 'a' : 'b').repeat(32),
    senderSeq: ++seq,
    timestamp: 1_000 + seq,
    eventType: 'message',
    payload: JSON.stringify({ messageText: 'hi' }),
    payloadHash: 'hash',
    signature: `sig-${seq}`,
    ...overrides,
  };
};

const friendAdd = (eventId: string, senderAddress = ME) =>
  event({
    eventId,
    senderAddress,
    payload: JSON.stringify({
      messageText: 'added as a friend',
      otherData: {
        type: 'dm_friend_added',
        dmFriendEvent: { actorAddress: senderAddress, targetAddress: PEER },
      },
    }),
  });

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('getOwnDirectFriendEvents', () => {
  it('returns own friend adds and own deletes of them, past the 500-event history window', () => {
    const db = openDb();
    db.insertDirectEvent(friendAdd('own-add'), true);
    db.insertDirectEvent(friendAdd('their-add', PEER), false);
    for (let i = 0; i < 520; i++) {
      db.insertDirectEvent(event({ eventId: `chat-${i}` }), true);
    }
    db.insertDirectEvent(
      event({
        eventId: 'own-delete-of-add',
        eventType: 'delete',
        targetEventId: 'own-add',
        payload: '{}',
      }),
      true
    );
    db.insertDirectEvent(
      event({
        eventId: 'own-delete-of-chat',
        eventType: 'delete',
        targetEventId: 'chat-3',
        payload: '{}',
      }),
      true
    );

    const history = db.getDirectHistory(conversationId, 1000);
    expect(history.some((e) => e.eventId === 'own-add')).toBe(false);

    const own = db.getOwnDirectFriendEvents(conversationId, ME);
    expect(own.map((e) => e.eventId)).toEqual(['own-add', 'own-delete-of-add']);
    expect(db.getOwnDirectFriendEvents(conversationId, PEER)).toEqual([
      expect.objectContaining({ eventId: 'their-add' }),
    ]);
  });

  it('is empty without an own add', () => {
    const db = openDb();
    db.insertDirectEvent(event({ eventId: 'chat' }), true);
    expect(db.getOwnDirectFriendEvents(conversationId, ME)).toEqual([]);
    expect(db.getOwnDirectFriendEvents('', ME)).toEqual([]);
  });
});
