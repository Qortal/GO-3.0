import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildReticulumChatEventRequestSignedFields,
  buildReticulumChatHistoryPageRequestSignedFields,
  buildReticulumChatLinkedAuthorRangeRequestSignedFields,
  buildReticulumChatLinkedEventRequestSignedFields,
  buildReticulumChatSignedFields,
  hashReticulumChatPayload,
  ReticulumChatManager,
  RETICULUM_CHAT_SERVE_MAX_AGE_MS,
  validateReticulumChatEventShape,
  verifyReticulumChatEvent,
  type ReticulumChatEvent,
} from './reticulum-chat';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

// Hub 3.0.x refuses, on every import path, any event older than this
// (RETICULUM_CHAT_MAX_AGE_MS in v3.0.3), and counts each one on a history
// page as a protocol violation against the provider.
const HUB_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const GROUP_ID = 69;
const STREAM_ID = 'e'.repeat(32);
const PROVIDER_PEER = 'b'.repeat(32);
const REQUESTER_PEER = 'c'.repeat(32);

const managers: ReticulumChatManager[] = [];
const tempPaths: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-serve-floor-'));
  tempPaths.push(root);
  return path.join(root, 'reticulum-chat.db');
}

type Signer = { publicKey: string; address: string; secretKey: Uint8Array };

function newSigner(): Signer {
  const kp = nacl.sign.keyPair();
  const publicKey = base58Encode(kp.publicKey);
  return {
    publicKey,
    address: deriveAddressFromPublicKey(publicKey),
    secretKey: kp.secretKey,
  };
}

function sign(signer: Signer, fields: Record<string, unknown>): string {
  return base58Encode(
    nacl.sign.detached(
      new Uint8Array(canonicalizeForSigning(fields)),
      signer.secretKey
    )
  );
}

const author = newSigner();
const requester = newSigner();

/**
 * Old events in the shape GO really serves: reactions on long-expired
 * messages (they never expire themselves). Fresh ones are plain messages.
 */
function signedEvent(
  id: string,
  seq: number,
  timestamp: number,
  old = false
): ReticulumChatEvent {
  const encryptedPayload = old
    ? JSON.stringify({ type: 'reaction', content: '+1', contentState: true })
    : `ciphertext-${id}`;
  const event: ReticulumChatEvent = {
    eventId: id,
    groupId: GROUP_ID,
    channelId: 'general',
    authorAddress: author.address,
    authorPublicKey: author.publicKey,
    authorStreamId: STREAM_ID,
    authorSeq: seq,
    timestamp,
    eventType: old ? 'reaction_add' : 'message',
    ...(old ? { targetEventId: `expired-root-${id}` } : {}),
    encryptedPayload,
    payloadHash: hashReticulumChatPayload(encryptedPayload),
    mentionAddressHashes: [],
    signature: '',
  };
  event.signature = sign(author, buildReticulumChatSignedFields(event));
  return event;
}

type ServedPage = {
  meta: Record<string, any>;
  page: {
    d: string;
    more?: boolean;
    start?: { id: string; ts: number };
    end?: { id: string; ts: number };
    wh: string;
    events: ReticulumChatEvent[];
  };
};

function createProvider(now: number) {
  const served: ServedPage[] = [];
  const rejected: string[] = [];
  const manager = new ReticulumChatManager({
    dbPath: tempDbPath(),
    bridge: {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => PROVIDER_PEER,
      sendReticulumChatResourceDetailed: async (
        payload: Record<string, any>
      ) => {
        served.push({
          meta: payload.metadata,
          page: JSON.parse(fs.readFileSync(payload.filePath, 'utf8')),
        });
        return { ok: true as const };
      },
      authorizeReticulumChatResourceDetailed: async () => ({
        ok: true as const,
      }),
      rejectReticulumChatResourceDetailed: async (
        payload: Record<string, any>
      ) => {
        rejected.push(String(payload.reason));
        return { ok: true as const };
      },
    } as any,
    now: () => now,
    validateGroupMember: async () => true,
  });
  managers.push(manager);
  manager.setLocalGroupMemberships([GROUP_ID]);
  const db = (manager as any).db;
  const insert = (events: ReticulumChatEvent[]) => {
    for (const event of events) expect(db.insertEvent(event, false)).toBe(true);
  };
  return { manager, db, served, rejected, insert };
}

function historyPageAuth(
  transferId: string,
  now: number,
  request: {
    direction: 'after' | 'before';
    cursor: ReticulumChatEvent;
    includeCursor?: boolean;
    limit: number;
  }
): Record<string, unknown> {
  const cursor = { id: request.cursor.eventId, ts: request.cursor.timestamp };
  const fields = buildReticulumChatHistoryPageRequestSignedFields({
    groupId: GROUP_ID,
    channelId: '*',
    direction: request.direction,
    ...(request.direction === 'before'
      ? { before: cursor, includeCursor: request.includeCursor === true }
      : { after: cursor }),
    limit: request.limit,
    authorAddress: requester.address,
    authorPublicKey: requester.publicKey,
    timestamp: now,
  });
  return {
    type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
    transferId,
    groupId: GROUP_ID,
    c: '*',
    d: request.direction,
    ...(request.direction === 'before'
      ? { before: cursor, ...(request.includeCursor ? { inc: 1 } : {}) }
      : { after: cursor }),
    limit: request.limit,
    a: requester.address,
    pk: requester.publicKey,
    ts: now,
    sig: sign(requester, fields),
  };
}

async function serveHistoryPage(
  manager: ReticulumChatManager,
  now: number,
  request: Parameters<typeof historyPageAuth>[2]
): Promise<void> {
  const transferId = nodeTransferId();
  await (manager as any).serveLinkedHistoryPageResource(
    { linkId: 'link-1', transferId, peerPresenceHash: REQUESTER_PEER },
    historyPageAuth(transferId, now, request),
    (manager as any).historyPageServeGeneration
  );
}

let transferCounter = 0;
function nodeTransferId(): string {
  transferCounter += 1;
  return transferCounter.toString(16).padStart(16, '0');
}

/** What a 3.0.3 requester does with each served event, at its own clock. */
function hubAccepts(event: ReticulumChatEvent, hubNow: number): boolean {
  return (
    validateReticulumChatEventShape(event, hubNow, HUB_MAX_AGE_MS) &&
    verifyReticulumChatEvent(event)
  );
}

describe('serve age floor', () => {
  it('stays inside the 30 day limit of Hub 3.0.x by a one day margin', () => {
    expect(RETICULUM_CHAT_SERVE_MAX_AGE_MS).toBe(HUB_MAX_AGE_MS - DAY_MS);
  });

  it('serves none of the old events at the head of a history page', async () => {
    const now = Date.now();
    const { manager, db, served, rejected, insert } = createProvider(now);
    const old = [
      signedEvent('old-reaction-45d', 1, now - 45 * DAY_MS, true),
      signedEvent('old-reaction-40d', 2, now - 40 * DAY_MS, true),
      signedEvent('old-reaction-35d', 3, now - 35 * DAY_MS, true),
      signedEvent('old-reaction-31d', 4, now - 31 * DAY_MS, true),
    ];
    const fresh = [
      signedEvent('fresh-message-20d', 5, now - 20 * DAY_MS),
      signedEvent('fresh-message-10d', 6, now - 10 * DAY_MS),
      signedEvent('fresh-message-1d', 7, now - DAY_MS),
      signedEvent('fresh-message-1h', 8, now - 60 * 60_000),
    ];
    insert([...old, ...fresh]);
    // The old ones are what a 3.0.3 Hub counted against GO.
    for (const event of old) expect(hubAccepts(event, now)).toBe(false);

    // A Hub's newest-group repair: the newest page, cursor included.
    await serveHistoryPage(manager, now, {
      direction: 'before',
      cursor: fresh[fresh.length - 1],
      includeCursor: true,
      limit: 100,
    });

    expect(rejected).toEqual([]);
    expect(served).toHaveLength(1);
    const { meta, page } = served[0];
    expect(page.events.map((event) => event.eventId)).toEqual(
      fresh.map((event) => event.eventId)
    );
    for (const event of page.events) expect(hubAccepts(event, now)).toBe(true);
    expect(page.more).toBeUndefined();
    expect(meta.eventCount).toBe(fresh.length);
    // start, end and the window hash describe the page as served.
    expect(page.start).toEqual({
      id: fresh[0].eventId,
      ts: fresh[0].timestamp,
    });
    expect(page.end).toEqual({
      id: fresh[fresh.length - 1].eventId,
      ts: fresh[fresh.length - 1].timestamp,
    });
    expect(page.wh).toBe(db.computeWindowHash(page.events));
    expect(page.wh).not.toBe(db.computeWindowHash([...old, ...fresh]));
  });

  it('starts an after page at the floor instead of filling it with old events', async () => {
    const now = Date.now();
    const { manager, served, rejected, insert } = createProvider(now);
    const old = Array.from({ length: 5 }, (_, index) =>
      signedEvent(
        `after-old-${index}`,
        index + 1,
        now - (40 - index) * DAY_MS,
        true
      )
    );
    const fresh = Array.from({ length: 4 }, (_, index) =>
      signedEvent(
        `after-fresh-${index}`,
        index + 6,
        now - (10 - index) * DAY_MS
      )
    );
    insert([...old, ...fresh]);

    // A page of 2 after the oldest event: without the floor in the query its
    // fetch would hold only old events.
    await serveHistoryPage(manager, now, {
      direction: 'after',
      cursor: old[0],
      limit: 2,
    });

    expect(rejected).toEqual([]);
    expect(served).toHaveLength(1);
    expect(served[0].page.events.map((event) => event.eventId)).toEqual([
      'after-fresh-0',
      'after-fresh-1',
    ]);
    expect(served[0].page.more).toBe(true);
  });

  it('answers no_history_events when nothing on the page is new enough', async () => {
    const now = Date.now();
    const { manager, served, rejected, insert } = createProvider(now);
    const old = [
      signedEvent('none-old-a', 1, now - 50 * DAY_MS, true),
      signedEvent('none-old-b', 2, now - 31 * DAY_MS, true),
    ];
    const fresh = signedEvent('none-fresh-a', 3, now - DAY_MS);
    insert([...old, fresh]);

    // Older than everything new enough: the page before old-b.
    await serveHistoryPage(manager, now, {
      direction: 'before',
      cursor: old[1],
      includeCursor: true,
      limit: 100,
    });

    expect(served).toEqual([]);
    expect(rejected).toEqual(['no_history_events']);
  });

  it('serves an event exactly at the floor and none just past it', async () => {
    const now = Date.now();
    const { manager, served, insert } = createProvider(now);
    const floor = now - RETICULUM_CHAT_SERVE_MAX_AGE_MS;
    const pastFloor = signedEvent('floor-past', 1, floor - 1, true);
    const atFloor = signedEvent('floor-at', 2, floor, true);
    const fresh = signedEvent('floor-fresh', 3, now - 1_000);
    insert([pastFloor, atFloor, fresh]);

    await serveHistoryPage(manager, now, {
      direction: 'before',
      cursor: fresh,
      includeCursor: true,
      limit: 100,
    });

    expect(served).toHaveLength(1);
    expect(served[0].page.events.map((event) => event.eventId)).toEqual([
      'floor-at',
      'floor-fresh',
    ]);
    // A requester whose clock runs up to the margin ahead still accepts it.
    expect(hubAccepts(atFloor, now + DAY_MS - 1)).toBe(true);
  });

  it('reports no more when only events past the floor are left', async () => {
    const now = Date.now();
    const { manager, served, insert } = createProvider(now);
    const events = [
      signedEvent('probe-old-1', 1, now - 31 * DAY_MS, true),
      signedEvent('probe-fresh-2', 2, now - 2 * DAY_MS),
      signedEvent('probe-fresh-3', 3, now - DAY_MS),
    ];
    insert(events);

    // limit 2: the probe (third newest) is the old reaction.
    await serveHistoryPage(manager, now, {
      direction: 'before',
      cursor: events[2],
      includeCursor: true,
      limit: 2,
    });

    expect(served).toHaveLength(1);
    expect(served[0].page.events.map((event) => event.eventId)).toEqual([
      'probe-fresh-2',
      'probe-fresh-3',
    ]);
    expect(served[0].page.more).toBeUndefined();
  });

  it('builds every served page without old events, hashed as served', () => {
    const now = Date.now();
    const { manager, db } = createProvider(now);
    const old = signedEvent('builder-old', 1, now - 40 * DAY_MS, true);
    const fresh = [
      signedEvent('builder-fresh-2', 2, now - 3 * DAY_MS),
      signedEvent('builder-fresh-3', 3, now - DAY_MS),
    ];

    const page = (manager as any).buildEventPageResourceBlob(
      GROUP_ID,
      '*',
      [old, ...fresh],
      false,
      'after'
    );
    const parsed = JSON.parse(page.blob);
    expect(
      parsed.events.map((event: ReticulumChatEvent) => event.eventId)
    ).toEqual(['builder-fresh-2', 'builder-fresh-3']);
    expect(parsed.start).toEqual({
      id: fresh[0].eventId,
      ts: fresh[0].timestamp,
    });
    expect(parsed.wh).toBe(db.computeWindowHash(fresh));
    expect(page.eventCount).toBe(2);
    expect(
      (manager as any).buildEventPageResourceBlob(
        GROUP_ID,
        '*',
        [old],
        false,
        'after'
      )
    ).toBeNull();
  });

  it('trims an author range to its events that are new enough', async () => {
    const now = Date.now();
    const { manager, served, rejected, insert } = createProvider(now);
    const events = [
      signedEvent('range-old-1', 1, now - 40 * DAY_MS, true),
      signedEvent('range-old-2', 2, now - 35 * DAY_MS, true),
      signedEvent('range-fresh-3', 3, now - 5 * DAY_MS),
      signedEvent('range-fresh-4', 4, now - DAY_MS),
    ];
    insert(events);
    const authorizeRange = async (from: number, to: number) => {
      const transferId = nodeTransferId();
      const range = { a: author.address, s: STREAM_ID, from, to };
      const fields = buildReticulumChatLinkedAuthorRangeRequestSignedFields({
        transferId,
        groupId: GROUP_ID,
        range,
        limit: 100,
        requesterPeerHash: REQUESTER_PEER,
        providerPeerHash: PROVIDER_PEER,
        authorAddress: requester.address,
        authorPublicKey: requester.publicKey,
        timestamp: now,
      });
      await (manager as any).authorizeLinkedAuthorRangeResource(
        { linkId: 'link-1', transferId, peerPresenceHash: REQUESTER_PEER },
        {
          type: 'RETICULUM_CHAT_LINKED_AUTHOR_RANGE_REQUEST',
          transferId,
          groupId: GROUP_ID,
          range,
          limit: 100,
          requesterPeerHash: REQUESTER_PEER,
          providerPeerHash: PROVIDER_PEER,
          authorAddress: requester.address,
          authorPublicKey: requester.publicKey,
          timestamp: now,
          signature: sign(requester, fields),
        }
      );
    };

    await authorizeRange(1, 4);
    expect(rejected).toEqual([]);
    expect(served).toHaveLength(1);
    expect(served[0].page.events.map((event) => event.eventId).sort()).toEqual([
      'range-fresh-3',
      'range-fresh-4',
    ]);
    expect(served[0].page.more).toBeUndefined();

    // Only old seqs left: unavailable here, which 3.0.x does not count.
    await authorizeRange(1, 2);
    expect(served).toHaveLength(1);
    expect(rejected).toEqual(['no_history_events']);
  });

  it('reports an old single linked event as unknown', async () => {
    const now = Date.now();
    const { manager, served, rejected, insert } = createProvider(now);
    const old = signedEvent('single-old', 1, now - 31 * DAY_MS, true);
    const fresh = signedEvent('single-fresh', 2, now - DAY_MS);
    insert([old, fresh]);
    const authorizeEvent = async (eventId: string) => {
      const transferId = nodeTransferId();
      const request = {
        transferId,
        eventId,
        groupId: GROUP_ID,
        requesterPeerHash: REQUESTER_PEER,
        providerPeerHash: PROVIDER_PEER,
        authorAddress: requester.address,
        authorPublicKey: requester.publicKey,
        timestamp: now,
      };
      await (manager as any).authorizeLinkedEventResource(
        { linkId: 'link-1', transferId, peerPresenceHash: REQUESTER_PEER },
        {
          type: 'RETICULUM_CHAT_LINKED_EVENT_REQUEST',
          ...request,
          signature: sign(
            requester,
            buildReticulumChatLinkedEventRequestSignedFields(request)
          ),
        }
      );
    };

    await authorizeEvent(old.eventId);
    expect(served).toEqual([]);
    expect(rejected).toEqual(['unknown_event']);

    await authorizeEvent(fresh.eventId);
    expect(served).toHaveLength(1);
    expect(served[0].meta.eventId).toBe(fresh.eventId);
  });

  it('neither serves nor relays an event_req for an old event', async () => {
    const now = Date.now();
    const { manager, insert } = createProvider(now);
    const old = signedEvent('event-req-old', 1, now - 31 * DAY_MS, true);
    const fresh = signedEvent('event-req-fresh', 2, now - DAY_MS);
    insert([old, fresh]);
    const offer = vi
      .spyOn(manager as any, 'offerEventResource')
      .mockResolvedValue({ ok: true });
    const relay = vi.spyOn(manager as any, 'relayGroupControlRequest');
    const request = (eventId: string) => ({
      id: eventId,
      a: requester.address,
      pk: requester.publicKey,
      ts: now,
      sig: sign(
        requester,
        buildReticulumChatEventRequestSignedFields({
          groupId: GROUP_ID,
          eventId,
          authorAddress: requester.address,
          authorPublicKey: requester.publicKey,
          timestamp: now,
        })
      ),
    });

    await (manager as any).handleEventResourceRequest(
      GROUP_ID,
      { t: 'RCHAT', k: 'event_req', g: GROUP_ID, q: request(old.eventId) },
      REQUESTER_PEER
    );
    expect(offer).not.toHaveBeenCalled();
    expect(relay).not.toHaveBeenCalled();

    await (manager as any).handleEventResourceRequest(
      GROUP_ID,
      { t: 'RCHAT', k: 'event_req', g: GROUP_ID, q: request(fresh.eventId) },
      REQUESTER_PEER
    );
    expect(offer).toHaveBeenCalledTimes(1);
    expect(offer.mock.calls[0][2]).toBe(fresh.eventId);
  });

  it('keeps old events in local history', async () => {
    const now = Date.now();
    const { db, insert } = createProvider(now);
    const old = signedEvent('local-old', 1, now - 45 * DAY_MS, true);
    const fresh = signedEvent('local-fresh', 2, now - DAY_MS);
    insert([old, fresh]);

    expect(db.getEvent(old.eventId)?.eventId).toBe(old.eventId);
    expect(
      db
        .getGroupFeedPageAfter(GROUP_ID, null, 10)
        .map((event: ReticulumChatEvent) => event.eventId)
    ).toEqual(['local-old', 'local-fresh']);
  });
});
