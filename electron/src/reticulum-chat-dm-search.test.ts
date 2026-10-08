import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ReticulumChatDatabase,
  reticulumDmConversationId,
} from './reticulum-chat-db';
import type { ReticulumDmEvent } from './reticulum-chat';

const roots: string[] = [];
const ME = 'Qme';
const PEER = 'Qpeer';
const OTHER = 'Qother';

const openDb = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-dm-search-'));
  roots.push(root);
  return new ReticulumChatDatabase(path.join(root, 'reticulum-chat.db'));
};

let seq = 0;
const event = (
  overrides: Partial<ReticulumDmEvent> & Pick<ReticulumDmEvent, 'eventId'>
): ReticulumDmEvent => {
  seq += 1;
  const senderAddress = overrides.senderAddress || PEER;
  const recipientAddress = overrides.recipientAddress || ME;
  return {
    conversationId: reticulumDmConversationId(senderAddress, recipientAddress),
    senderAddress,
    recipientAddress,
    senderPublicKey: 'public-key',
    senderStreamId: 'a'.repeat(32),
    senderSeq: seq,
    timestamp: Date.now() - 10_000 + seq,
    eventType: 'message',
    payload: JSON.stringify({ messageText: 'hello' }),
    payloadHash: `hash-${seq}`,
    signature: `signature-${seq}`,
    ...overrides,
  };
};

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('searchDirectMessages', () => {
  it("finds the account's messages by text, newest first", () => {
    const db = openDb();
    db.insertDirectEvent(
      event({
        eventId: 'm1',
        payload: JSON.stringify({ messageText: 'Lunch at noon?' }),
      })
    );
    db.insertDirectEvent(
      event({
        eventId: 'm2',
        senderAddress: ME,
        recipientAddress: PEER,
        payload: JSON.stringify({ messageText: 'yes, lunch sounds good' }),
      })
    );
    db.insertDirectEvent(
      event({
        eventId: 'other',
        senderAddress: PEER,
        recipientAddress: OTHER,
        payload: JSON.stringify({ messageText: 'lunch elsewhere' }),
      })
    );
    const found = db.searchDirectMessages(ME, 'LUNCH');
    expect(found.map((e) => e.eventId)).toEqual(['m2', 'm1']);
  });

  it('leaves out deleted messages and old texts of edited ones', () => {
    const db = openDb();
    db.insertDirectEvent(
      event({
        eventId: 'edited',
        payload: JSON.stringify({ messageText: 'meet at the old cafe' }),
      })
    );
    db.insertDirectEvent(
      event({
        eventId: 'edit-1',
        eventType: 'edit',
        targetEventId: 'edited',
        payload: JSON.stringify({ messageText: 'meet at the new cafe' }),
      })
    );
    db.insertDirectEvent(
      event({
        eventId: 'gone',
        payload: JSON.stringify({ messageText: 'cafe secret' }),
      })
    );
    db.insertDirectEvent(
      event({
        eventId: 'delete-1',
        eventType: 'delete',
        targetEventId: 'gone',
        payload: JSON.stringify({}),
      })
    );
    expect(db.searchDirectMessages(ME, 'old cafe')).toEqual([]);
    expect(db.searchDirectMessages(ME, 'cafe').map((e) => e.eventId)).toEqual([
      'edit-1',
    ]);
  });

  it('treats % and _ in the query as plain text, and needs 2 letters', () => {
    const db = openDb();
    db.insertDirectEvent(
      event({
        eventId: 'pct',
        payload: JSON.stringify({ messageText: 'up 50% today' }),
      })
    );
    db.insertDirectEvent(
      event({
        eventId: 'plain',
        payload: JSON.stringify({ messageText: 'up 500 today' }),
      })
    );
    expect(db.searchDirectMessages(ME, '50%').map((e) => e.eventId)).toEqual([
      'pct',
    ]);
    expect(db.searchDirectMessages(ME, 'u')).toEqual([]);
  });
});

describe('getDirectHistoryFrom', () => {
  it('loads a conversation from one message on, with a little before it', () => {
    const db = openDb();
    const base = Date.now() - 100_000;
    for (let index = 0; index < 30; index += 1) {
      db.insertDirectEvent(
        event({ eventId: `m${index}`, timestamp: base + index * 10 })
      );
    }
    db.insertDirectEvent(
      event({
        eventId: 'elsewhere',
        senderAddress: PEER,
        recipientAddress: OTHER,
        timestamp: base + 105,
      })
    );
    const conversationId = reticulumDmConversationId(ME, PEER);
    const ids = db
      .getDirectHistoryFrom(conversationId, 'm10', 5, 3)
      .map((e) => e.eventId);
    expect(ids).toEqual(['m7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14']);
    expect(db.getDirectHistoryFrom(conversationId, 'missing')).toEqual([]);
    // An event of another conversation is no anchor here.
    expect(db.getDirectHistoryFrom(conversationId, 'elsewhere')).toEqual([]);
  });
});

describe('searchDirectMessages text only', () => {
  it('matches the message text, not the payload around it', () => {
    const db = openDb();
    db.insertDirectEvent(
      event({
        eventId: 'keys',
        payload: JSON.stringify({
          messageText: '<p>see you soon</p>',
          otherData: { type: 'reply' },
          expiryDurationMs: 0,
        }),
      })
    );
    db.insertDirectEvent(
      event({ eventId: 'plain-html', payload: '<p>expiry is fine</p>' })
    );
    expect(db.searchDirectMessages(ME, 'expiry').map((e) => e.eventId)).toEqual(
      ['plain-html']
    );
    expect(db.searchDirectMessages(ME, 'reply')).toEqual([]);
    expect(db.searchDirectMessages(ME, 'soon').map((e) => e.eventId)).toEqual([
      'keys',
    ]);
  });
});
