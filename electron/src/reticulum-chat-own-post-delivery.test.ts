import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Under Vitest `better-sqlite3` resolves to a statement-shape mock. These
// tests run the real ReticulumChatDatabase SQL against Node's built-in SQLite
// (node:sqlite) through a minimal better-sqlite3 adapter, so tracked posts
// really survive a new manager on the same database.
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
  buildReticulumChatHistoryPageRequestSignedFields,
  buildReticulumChatLinkedAuthorRangeRequestSignedFields,
  buildReticulumChatLinkedEventRequestSignedFields,
  buildReticulumChatSignedFields,
  buildReticulumDmRequestSignedFields,
  buildReticulumDmSignedFields,
  hashReticulumChatPayload,
  ReticulumChatManager,
  type ReticulumChatEvent,
  type ReticulumChatEventType,
  type ReticulumDmEvent,
  type ReticulumOwnPostDeliveryUpdate,
} from './reticulum-chat';
import { reticulumDmConversationId } from './reticulum-chat-db';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

type Identity = { address: string; publicKey: string; secretKey: Uint8Array };

const GROUP_ID = 77;
// This phone, the account's home Hub, another member's node.
const GO_PEER = 'a1'.repeat(16);
const HUB_PEER = 'b2'.repeat(16);
const MEMBER_PEER = 'c3'.repeat(16);
const MY_GROUP_STREAM = 'd'.repeat(32);
const HUB_DM_STREAM = 'f'.repeat(32);
const MINUTE = 60_000;
const FLUSH_WAIT_MS = 600;

const managers: ReticulumChatManager[] = [];
const tempRoots: string[] = [];
const clock = { now: Date.now() };

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  clock.now = Date.now();
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-own-post-'));
  tempRoots.push(root);
  return path.join(root, 'reticulum-chat.db');
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

function sign(fields: unknown, who: Identity): string {
  return base58Encode(
    nacl.sign.detached(
      new Uint8Array(canonicalizeForSigning(fields as any)),
      who.secretKey
    )
  );
}

const me = identity();
const member = identity();
const bob = identity();

const lastOf = <T>(items: T[]): T | undefined => items[items.length - 1];

const waitForFlush = () =>
  new Promise<void>((resolve) => setTimeout(resolve, FLUSH_WAIT_MS));

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(16).padStart(8, '0')}`;
}

/** Transfer and request ids are 16 hex characters on the wire. */
function nextTransferId(): string {
  idCounter += 1;
  return idCounter.toString(16).padStart(16, '0');
}

function groupPost(
  author: Identity,
  seq: number,
  options: {
    eventType?: ReticulumChatEventType;
    replyToEventId?: string;
    targetEventId?: string;
    streamId?: string;
    timestamp?: number;
  } = {}
): ReticulumChatEvent {
  const eventId = nextId('post');
  const encryptedPayload =
    options.eventType === 'reaction_add'
      ? JSON.stringify({ type: 'reaction', content: '+1', contentState: true })
      : `ciphertext-${eventId}`;
  const event: ReticulumChatEvent = {
    eventId,
    groupId: GROUP_ID,
    channelId: 'general',
    authorAddress: author.address,
    authorPublicKey: author.publicKey,
    authorStreamId: options.streamId ?? MY_GROUP_STREAM,
    authorSeq: seq,
    timestamp: options.timestamp ?? clock.now - 1_000,
    eventType: options.eventType ?? 'message',
    ...(options.replyToEventId
      ? { replyToEventId: options.replyToEventId }
      : {}),
    ...(options.targetEventId ? { targetEventId: options.targetEventId } : {}),
    encryptedPayload,
    payloadHash: hashReticulumChatPayload(encryptedPayload),
    mentionAddressHashes: [],
    signature: '',
  };
  event.signature = sign(buildReticulumChatSignedFields(event), author);
  return event;
}

function dmEvent(
  sender: Identity,
  recipient: Identity,
  seq: number,
  options: { streamId?: string; timestamp?: number } = {}
): ReticulumDmEvent {
  const eventId = nextId('dm');
  const payload = `message-${eventId}`;
  const event: ReticulumDmEvent = {
    eventId,
    conversationId: reticulumDmConversationId(
      sender.address,
      recipient.address
    ),
    senderAddress: sender.address,
    recipientAddress: recipient.address,
    senderPublicKey: sender.publicKey,
    ...(options.streamId ? { senderStreamId: options.streamId } : {}),
    senderSeq: seq,
    timestamp: options.timestamp ?? clock.now - 1_000,
    eventType: 'message',
    payload,
    payloadHash: hashReticulumChatPayload(payload),
    signature: '',
  };
  // A stream event also carries the signature over the legacy fields.
  if (options.streamId) {
    event.legacySignature = sign(
      buildReticulumDmSignedFields({ ...event, senderStreamId: undefined }),
      sender
    );
  }
  event.signature = sign(buildReticulumDmSignedFields(event), sender);
  return event;
}

/** The phone: this account's GO, with optional own-device leases. */
function makePhone(
  options: {
    track?: boolean;
    dbPath?: string;
    /** An own device (the home Hub) holds a current endpoint lease. */
    hubLease?: boolean;
    /** The other member's node holds a current endpoint lease. */
    memberLease?: boolean;
  } = {}
) {
  // Mutable, so a test can let a lease lapse.
  const leases = {
    hub: options.hubLease === true,
    member: options.memberLease === true,
  };
  const served: Array<Record<string, any>> = [];
  const rejected: string[] = [];
  const bridge = Object.assign(new EventEmitter(), {
    getLocalDestinationHash: () => GO_PEER,
    sendReticulumChatDetailed: async () => ({ ok: true as const }),
    fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
    sendReticulumChatResourceDetailed: async (payload: Record<string, any>) => {
      served.push(payload);
      return { ok: true as const };
    },
    authorizeReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    rejectReticulumChatResourceDetailed: async (
      payload: Record<string, any>
    ) => {
      rejected.push(String(payload.reason));
      return { ok: true as const };
    },
  });
  const manager = new ReticulumChatManager({
    dbPath: options.dbPath ?? tempDbPath(),
    now: () => clock.now,
    bridge: bridge as any,
    validateGroupMember: async () => true,
    getAccountEndpointLeases: () => [
      ...(leases.hub
        ? [
            {
              destinationHash: HUB_PEER,
              address: me.address,
              sessionId: 'home-hub',
              lastSeen: clock.now,
              expiresAt: clock.now + 30 * MINUTE,
              verification: 'direct-bound' as const,
            },
          ]
        : []),
      ...(leases.member
        ? [
            {
              destinationHash: MEMBER_PEER,
              address: member.address,
              sessionId: 'member-node',
              lastSeen: clock.now,
              expiresAt: clock.now + 30 * MINUTE,
              verification: 'direct-bound' as const,
            },
          ]
        : []),
    ],
    ...(options.track === false ? {} : { trackOwnPostDelivery: true }),
  });
  managers.push(manager);
  manager.setLocalGroupMemberships([
    { groupId: GROUP_ID, localAddress: me.address },
  ]);
  manager.setLocalDmAddresses([me.address]);
  const db = (manager as any).db;
  const emits: Array<{ updates: ReticulumOwnPostDeliveryUpdate[] }> = [];
  manager.on('ownPostDelivery', (payload) => emits.push(payload));
  const directEvents: ReticulumDmEvent[] = [];
  manager.on('directEvent', (payload) => directEvents.push(payload.event));
  const m = manager as any;
  return {
    manager,
    bridge,
    leases,
    db,
    served,
    rejected,
    emits,
    directEvents,
    /** This device wrote it (publishEvent's acceptEvent(event, true)). */
    publish: async (event: ReticulumChatEvent) =>
      expect(await m.acceptEvent(event, true)).toBe(true),
    /** A stored copy (own_event=0), also of our own post from elsewhere. */
    copy: async (event: ReticulumChatEvent) =>
      expect(await m.acceptEvent(event, false)).toBe(true),
    /** This device wrote a DM (publishDirectEvent's acceptDirectEvent). */
    publishDm: (event: ReticulumDmEvent) =>
      expect(
        m.acceptDirectEvent(event, true, {
          deliveryStatus:
            event.senderAddress === event.recipientAddress ? 'sent' : 'pending',
        })
      ).toBe(true),
    copyDm: (event: ReticulumDmEvent) =>
      expect(m.acceptDirectEvent(event, false)).toBe(true),
    renderer: (eventId: string) => m.eventForRenderer(db.getEvent(eventId)),
    entry: (eventId: string) => m.ownPostDeliveries.get(eventId),
    rows: () =>
      new Map(
        db
          .listOwnPostDelivery(0)
          .map((row: Record<string, any>) => [row.eventId, row])
      ),
    /** The bridge's 'sent', naming the peer it went to when given. */
    sent: (transferId: string, peerPresenceHash?: string) =>
      manager.handleResourceEvent({
        status: 'sent',
        transferId,
        ...(peerPresenceHash ? { peerPresenceHash } : {}),
      } as any),
    failed: (transferId: string) =>
      manager.handleResourceEvent({
        status: 'failed',
        transferId,
        reason: 'resource_session_closed',
      } as any),
    /** A signed linked live-event request (Hub 3.0.3's pull of a notice). */
    liveFetch: async (
      requester: Identity,
      requesterPeer: string,
      eventId: string,
      transferId = nextTransferId()
    ) => {
      const request = {
        transferId,
        eventId,
        groupId: GROUP_ID,
        requesterPeerHash: requesterPeer,
        providerPeerHash: GO_PEER,
        authorAddress: requester.address,
        authorPublicKey: requester.publicKey,
        timestamp: clock.now,
      };
      await m.authorizeLinkedEventResource(
        {
          linkId: `link-${transferId}`,
          transferId,
          peerPresenceHash: requesterPeer,
        },
        {
          type: 'RETICULUM_CHAT_LINKED_EVENT_REQUEST',
          ...request,
          signature: sign(
            buildReticulumChatLinkedEventRequestSignedFields(request),
            requester
          ),
        }
      );
      return transferId;
    },
    /** A signed history page request: the newest page, cursor included. */
    pageFetch: async (
      requester: Identity,
      requesterPeer: string,
      cursor: ReticulumChatEvent,
      transferId = nextTransferId()
    ) => {
      const at = { id: cursor.eventId, ts: cursor.timestamp };
      const fields = buildReticulumChatHistoryPageRequestSignedFields({
        groupId: GROUP_ID,
        channelId: '*',
        direction: 'before',
        before: at,
        includeCursor: true,
        limit: 100,
        authorAddress: requester.address,
        authorPublicKey: requester.publicKey,
        timestamp: clock.now,
      });
      await m.serveLinkedHistoryPageResource(
        {
          linkId: `link-${transferId}`,
          transferId,
          peerPresenceHash: requesterPeer,
        },
        {
          type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
          transferId,
          groupId: GROUP_ID,
          c: '*',
          d: 'before',
          before: at,
          inc: 1,
          limit: 100,
          a: requester.address,
          pk: requester.publicKey,
          ts: clock.now,
          sig: sign(fields, requester),
        },
        m.historyPageServeGeneration
      );
      return transferId;
    },
    /** A signed linked author-range request over our group stream. */
    rangeFetch: async (
      requester: Identity,
      requesterPeer: string,
      from: number,
      to: number,
      transferId = nextTransferId()
    ) => {
      const range = { a: me.address, s: MY_GROUP_STREAM, from, to };
      const fields = buildReticulumChatLinkedAuthorRangeRequestSignedFields({
        transferId,
        groupId: GROUP_ID,
        range,
        limit: 100,
        requesterPeerHash: requesterPeer,
        providerPeerHash: GO_PEER,
        authorAddress: requester.address,
        authorPublicKey: requester.publicKey,
        timestamp: clock.now,
      });
      await m.authorizeLinkedAuthorRangeResource(
        {
          linkId: `link-${transferId}`,
          transferId,
          peerPresenceHash: requesterPeer,
        },
        {
          type: 'RETICULUM_CHAT_LINKED_AUTHOR_RANGE_REQUEST',
          transferId,
          groupId: GROUP_ID,
          range,
          limit: 100,
          requesterPeerHash: requesterPeer,
          providerPeerHash: GO_PEER,
          authorAddress: requester.address,
          authorPublicKey: requester.publicKey,
          timestamp: clock.now,
          signature: sign(fields, requester),
        }
      );
      return transferId;
    },
    /** The home Hub's signed linked DM page request for Saved Messages. */
    savedMessagesFetch: async (
      after: number,
      transferId = nextTransferId()
    ) => {
      const timestamp = clock.now;
      const signedFields = buildReticulumDmRequestSignedFields({
        peerAddress: me.address,
        after,
        limit: 50,
        requesterPeerHash: HUB_PEER,
        requestId: transferId,
        authorAddress: me.address,
        authorPublicKey: me.publicKey,
        timestamp,
      });
      await m.authorizeDirectDmPageResource(
        {
          status: 'auth',
          linkId: `link-${transferId}`,
          transferId,
          peerPresenceHash: HUB_PEER,
        },
        {
          transferId,
          b: me.address,
          a: after,
          l: 50,
          q: transferId,
          rp: HUB_PEER,
          p: me.publicKey,
          n: timestamp,
          z: sign(signedFields, me),
        }
      );
      return transferId;
    },
  };
}

describe('own group post delivery', () => {
  it('tracks own posts written here, thread replies included, and nothing else', async () => {
    const phone = makePhone();
    const post = groupPost(me, 1);
    const reply = groupPost(me, 2, { replyToEventId: post.eventId });
    const file = groupPost(me, 3, { eventType: 'attachment_manifest' });
    const reaction = groupPost(me, 4, {
      eventType: 'reaction_add',
      targetEventId: post.eventId,
    });
    // Our own post written on another device, and another member's post.
    const elsewhere = groupPost(me, 1, { streamId: 'e'.repeat(32) });
    const theirs = groupPost(member, 1, { streamId: 'c'.repeat(32) });
    const publishedAt = clock.now;
    for (const event of [post, reply, file, reaction]) {
      await phone.publish(event);
    }
    await phone.copy(elsewhere);
    await phone.copy(theirs);

    expect([...phone.rows().keys()].sort()).toEqual(
      [post.eventId, reply.eventId, file.eventId].sort()
    );
    expect(phone.rows().get(post.eventId)).toMatchObject({
      scope: 'group',
      groupId: GROUP_ID,
      channelId: 'general',
      authorAddress: me.address,
      createdAt: publishedAt,
      ownDeviceAt: null,
      memberAt: null,
    });
    expect(phone.renderer(post.eventId)).toMatchObject({
      localPostDeliverySince: publishedAt,
    });
    expect(phone.renderer(post.eventId).localPostOwnDeviceAt).toBeUndefined();
    expect(phone.renderer(post.eventId).localPostMemberAt).toBeUndefined();
    expect(phone.renderer(reply.eventId).localPostDeliverySince).toBe(
      publishedAt
    );
    for (const event of [reaction, elsewhere, theirs]) {
      expect(phone.renderer(event.eventId).localPostDeliverySince).toBe(
        undefined
      );
    }
  });

  it("proves a post once a member's fetch of it is sent, never at the authorize", async () => {
    const phone = makePhone();
    const post = groupPost(me, 1);
    await phone.publish(post);

    const transferId = await phone.liveFetch(member, MEMBER_PEER, post.eventId);
    expect(phone.rejected).toEqual([]);
    expect(phone.served).toHaveLength(1);
    await waitForFlush();
    expect(phone.entry(post.eventId).memberAt).toBeUndefined();
    expect(phone.emits).toEqual([]);

    const sentAt = clock.now;
    phone.sent(transferId);
    expect(phone.entry(post.eventId).memberAt).toBe(sentAt);
    // Written and emitted in the next batch, not on the hot path.
    expect(phone.rows().get(post.eventId).memberAt).toBeNull();
    await waitForFlush();
    expect(phone.emits).toEqual([
      {
        updates: [
          {
            eventId: post.eventId,
            scope: 'group',
            groupId: GROUP_ID,
            channelId: 'general',
            memberAt: sentAt,
          },
        ],
      },
    ]);
    expect(phone.rows().get(post.eventId)).toMatchObject({
      memberAt: sentAt,
      memberPeerHash: MEMBER_PEER,
      proofKind: 'live',
      ownDeviceAt: null,
    });
    expect(phone.renderer(post.eventId)).toMatchObject({
      localPostMemberAt: sentAt,
    });
    expect(phone.manager.getDeliveryCounters()).toMatchObject({
      ownPostDeliveredMember: 1,
    });

    // Nothing left to prove: a second member's fetch is not tracked.
    const again = await phone.liveFetch(member, MEMBER_PEER, post.eventId);
    phone.sent(again);
    await waitForFlush();
    expect(phone.emits).toHaveLength(1);
  });

  it("counts our own address's fetch as an own device, then still a member's", async () => {
    const phone = makePhone();
    const post = groupPost(me, 1);
    await phone.publish(post);

    clock.now += 2_000;
    const ownAt = clock.now;
    phone.sent(await phone.liveFetch(me, HUB_PEER, post.eventId));
    await waitForFlush();
    expect(phone.emits).toEqual([
      {
        updates: [
          {
            eventId: post.eventId,
            scope: 'group',
            groupId: GROUP_ID,
            channelId: 'general',
            ownDeviceAt: ownAt,
          },
        ],
      },
    ]);
    expect(phone.rows().get(post.eventId)).toMatchObject({
      ownDeviceAt: ownAt,
      memberAt: null,
      proofKind: 'live',
    });
    expect(phone.renderer(post.eventId)).toMatchObject({
      localPostOwnDeviceAt: ownAt,
    });
    expect(phone.renderer(post.eventId).localPostMemberAt).toBeUndefined();

    // A second fetch by an own device adds nothing.
    phone.sent(await phone.liveFetch(me, HUB_PEER, post.eventId));
    await waitForFlush();
    expect(phone.emits).toHaveLength(1);

    clock.now += 3_000;
    const memberAt = clock.now;
    phone.sent(await phone.liveFetch(member, MEMBER_PEER, post.eventId));
    await waitForFlush();
    expect(phone.emits).toHaveLength(2);
    expect(phone.emits[1].updates).toEqual([
      {
        eventId: post.eventId,
        scope: 'group',
        groupId: GROUP_ID,
        channelId: 'general',
        ownDeviceAt: ownAt,
        memberAt,
      },
    ]);
  });

  it('changes nothing on a failed transfer or none at all', async () => {
    const phone = makePhone();
    const post = groupPost(me, 1);
    await phone.publish(post);

    phone.failed(await phone.liveFetch(member, MEMBER_PEER, post.eventId));
    await phone.liveFetch(member, MEMBER_PEER, post.eventId);
    await waitForFlush();
    expect(phone.entry(post.eventId).memberAt).toBeUndefined();
    expect(phone.rows().get(post.eventId).memberAt).toBeNull();
    expect(phone.emits).toEqual([]);
  });

  it('marks only the tracked own posts of a delivered history page', async () => {
    const phone = makePhone({ memberLease: true });
    const first = groupPost(me, 1);
    const reply = groupPost(me, 2, { replyToEventId: first.eventId });
    // Written here by an older build: stored as our own, but no row.
    const preBuild = groupPost(me, 3);
    const elsewhere = groupPost(me, 1, { streamId: 'e'.repeat(32) });
    const theirs = groupPost(member, 1, { streamId: 'c'.repeat(32) });
    await phone.publish(first);
    await phone.publish(reply);
    expect(phone.db.insertEvent(preBuild, true)).toBe(true);
    await phone.copy(elsewhere);
    await phone.copy(theirs);

    const transferId = await phone.pageFetch(member, MEMBER_PEER, theirs);
    expect(phone.rejected).toEqual([]);
    const page = JSON.parse(
      fs.readFileSync(String(phone.served[0].filePath), 'utf8')
    );
    expect(page.events).toHaveLength(5);
    phone.sent(transferId);
    await waitForFlush();

    expect(phone.emits).toHaveLength(1);
    expect(
      phone.emits[0].updates.map((update) => update.eventId).sort()
    ).toEqual([first.eventId, reply.eventId].sort());
    expect([...phone.rows().keys()].sort()).toEqual(
      [first.eventId, reply.eventId].sort()
    );
    expect(phone.rows().get(first.eventId)).toMatchObject({
      memberPeerHash: MEMBER_PEER,
      proofKind: 'page',
    });
    for (const event of [preBuild, elsewhere, theirs]) {
      expect(phone.renderer(event.eventId).localPostMemberAt).toBeUndefined();
    }
  });

  it('credits a history page only to a requester whose device got it', async () => {
    const phone = makePhone({ hubLease: true, memberLease: true });
    const post = groupPost(me, 1);
    await phone.publish(post);
    const strangerPeer = 'e5'.repeat(16);

    // A page request's signature does not cover the link: the Hub's request
    // replayed over the member's link, and the member's over a stranger's.
    phone.sent(await phone.pageFetch(me, MEMBER_PEER, post));
    phone.sent(await phone.pageFetch(member, strangerPeer, post));
    await waitForFlush();
    expect(phone.served).toHaveLength(2);
    expect(phone.entry(post.eventId).ownDeviceAt).toBeUndefined();
    expect(phone.entry(post.eventId).memberAt).toBeUndefined();
    expect(phone.emits).toEqual([]);

    // Over their own devices' links they count.
    const ownAt = clock.now;
    phone.sent(await phone.pageFetch(me, HUB_PEER, post));
    clock.now += 1_000;
    const memberAt = clock.now;
    phone.sent(await phone.pageFetch(member, MEMBER_PEER, post));
    await waitForFlush();
    expect(phone.entry(post.eventId)).toMatchObject({
      ownDeviceAt: ownAt,
      memberAt,
    });
    expect(phone.rows().get(post.eventId)).toMatchObject({
      ownDeviceAt: ownAt,
      memberAt,
      memberPeerHash: MEMBER_PEER,
      proofKind: 'page',
    });
  });

  it('marks only the tracked own posts of a delivered author range', async () => {
    const phone = makePhone();
    const file = groupPost(me, 1, { eventType: 'attachment_manifest' });
    const reaction = groupPost(me, 2, {
      eventType: 'reaction_add',
      targetEventId: file.eventId,
    });
    const post = groupPost(me, 3);
    const preBuild = groupPost(me, 4);
    await phone.publish(file);
    await phone.publish(reaction);
    await phone.publish(post);
    expect(phone.db.insertEvent(preBuild, true)).toBe(true);

    // The home Hub (our own address) repairs a gap in our stream.
    const transferId = await phone.rangeFetch(me, HUB_PEER, 1, 4);
    expect(phone.rejected).toEqual([]);
    expect(phone.served).toHaveLength(1);
    const ownAt = clock.now;
    phone.sent(transferId);
    await waitForFlush();

    expect(phone.emits).toHaveLength(1);
    expect(
      phone.emits[0].updates.map((update) => update.eventId).sort()
    ).toEqual([file.eventId, post.eventId].sort());
    expect(phone.rows().get(file.eventId)).toMatchObject({
      ownDeviceAt: ownAt,
      memberAt: null,
      proofKind: 'range',
    });
    expect(phone.rows().has(reaction.eventId)).toBe(false);
    expect(phone.rows().has(preBuild.eventId)).toBe(false);
  });

  it('never marks our own post copied here from another device', async () => {
    const phone = makePhone();
    const elsewhere = groupPost(me, 1, { streamId: 'e'.repeat(32) });
    await phone.copy(elsewhere);

    phone.sent(await phone.liveFetch(member, MEMBER_PEER, elsewhere.eventId));
    await waitForFlush();
    expect(phone.served).toHaveLength(1);
    expect(phone.emits).toEqual([]);
    expect(phone.rows().size).toBe(0);
    expect(phone.renderer(elsewhere.eventId).localPostMemberAt).toBe(undefined);
  });

  it('writes and emits a burst of proofs once', async () => {
    const phone = makePhone();
    const posts: ReticulumChatEvent[] = [];
    for (let seq = 1; seq <= 20; seq += 1) {
      const post = groupPost(me, seq);
      posts.push(post);
      await phone.publish(post);
    }
    const writes = vi.spyOn(phone.db, 'markOwnPostDelivery');
    const transfers: string[] = [];
    for (const post of posts) {
      transfers.push(await phone.liveFetch(member, MEMBER_PEER, post.eventId));
    }
    for (const transferId of transfers) phone.sent(transferId);
    await waitForFlush();

    expect(writes).toHaveBeenCalledTimes(1);
    expect(phone.emits).toHaveLength(1);
    expect(phone.emits[0].updates).toHaveLength(20);
    expect(
      [...phone.rows().values()].filter((row: any) => row.memberAt !== null)
    ).toHaveLength(20);
  });

  it('returns the proofs from a new manager on the same database', async () => {
    const dbPath = tempDbPath();
    const first = makePhone({ dbPath });
    const post = groupPost(me, 1);
    const publishedAt = clock.now;
    await first.publish(post);
    clock.now += 1_000;
    const memberAt = clock.now;
    first.sent(await first.liveFetch(member, MEMBER_PEER, post.eventId));
    // Closing writes the queued proof.
    managers.splice(managers.indexOf(first.manager), 1);
    first.manager.close();

    const second = makePhone({ dbPath });
    expect(second.entry(post.eventId)).toMatchObject({
      scope: 'group',
      since: publishedAt,
      memberAt,
    });
    expect(second.renderer(post.eventId)).toMatchObject({
      localPostDeliverySince: publishedAt,
      localPostMemberAt: memberAt,
    });
  });

  it('does nothing with the option off', async () => {
    const phone = makePhone({ track: false });
    const post = groupPost(me, 1);
    await phone.publish(post);
    phone.sent(await phone.liveFetch(member, MEMBER_PEER, post.eventId));
    await waitForFlush();

    expect(phone.served).toHaveLength(1);
    expect(phone.rows().size).toBe(0);
    expect(phone.emits).toEqual([]);
    expect(phone.renderer(post.eventId).localPostDeliverySince).toBe(undefined);
    expect((phone.manager as any).ownPostServeDeliveries.size).toBe(0);
    expect((phone.manager as any).ownPostDeliveries.size).toBe(0);
  });

  it('never settles a serve track on another transfer that reused its id', async () => {
    const phone = makePhone({ hubLease: true });
    const post = groupPost(me, 1);
    const theirs = groupPost(member, 1, { streamId: 'c'.repeat(32) });
    await phone.publish(post);
    await phone.copy(theirs);
    // Something for the Saved Messages page below to carry.
    phone.publishDm(dmEvent(me, me, 1));
    const tracks = (phone.manager as any).ownPostServeDeliveries as Map<
      string,
      unknown
    >;
    const authorize = phone.bridge.authorizeReticulumChatResourceDetailed;
    const authorizeFails = (reason: string) => {
      phone.bridge.authorizeReticulumChatResourceDetailed = async () =>
        ({ ok: false, reason }) as any;
    };

    // A refused authorize can never send, so its track goes at once.
    authorizeFails('resource-not-found');
    expect(
      tracks.has(await phone.liveFetch(member, MEMBER_PEER, post.eventId))
    ).toBe(false);

    // A timed-out one may have gone out anyway, so it stays ...
    authorizeFails('bridge-timeout');
    const reused = await phone.liveFetch(member, MEMBER_PEER, post.eventId);
    expect(tracks.has(reused)).toBe(true);
    // ... until the id serves another (untracked) post,
    phone.bridge.authorizeReticulumChatResourceDetailed = authorize;
    await phone.liveFetch(member, MEMBER_PEER, theirs.eventId, reused);
    expect(tracks.has(reused)).toBe(false);
    phone.sent(reused, MEMBER_PEER);

    // or a Saved Messages page.
    authorizeFails('bridge-exception');
    const toDmPage = await phone.liveFetch(me, HUB_PEER, post.eventId);
    expect(tracks.has(toDmPage)).toBe(true);
    phone.bridge.authorizeReticulumChatResourceDetailed = authorize;
    await phone.savedMessagesFetch(0, toDmPage);
    expect(phone.rejected).toEqual([]);
    expect(tracks.has(toDmPage)).toBe(false);
    phone.sent(toDmPage, HUB_PEER);

    // A terminal naming another peer than the serve's settles nothing.
    phone.sent(
      await phone.liveFetch(member, MEMBER_PEER, post.eventId),
      'e5'.repeat(16)
    );
    await waitForFlush();
    expect(phone.entry(post.eventId).ownDeviceAt).toBeUndefined();
    expect(phone.entry(post.eventId).memberAt).toBeUndefined();
    expect(
      phone.emits.flatMap((emit) => emit.updates).map((u) => u.eventId)
    ).not.toContain(post.eventId);

    // The peer it was bound to does, in any case.
    const memberAt = clock.now;
    phone.sent(
      await phone.liveFetch(member, MEMBER_PEER, post.eventId),
      MEMBER_PEER.toUpperCase()
    );
    expect(phone.entry(post.eventId).memberAt).toBe(memberAt);
  });

  it('forgets a serve whose terminal never came', async () => {
    const phone = makePhone();
    const stale = groupPost(me, 1);
    await phone.publish(stale);
    const staleTransfer = await phone.liveFetch(
      member,
      MEMBER_PEER,
      stale.eventId
    );
    const tracks = (phone.manager as any).ownPostServeDeliveries as Map<
      string,
      unknown
    >;
    expect(tracks.has(staleTransfer)).toBe(true);

    // Past the registration's lifetime plus margin; the next serve prunes.
    clock.now += 13 * MINUTE;
    const fresh = groupPost(me, 2);
    await phone.publish(fresh);
    const freshTransfer = await phone.liveFetch(
      member,
      MEMBER_PEER,
      fresh.eventId
    );
    expect(tracks.has(staleTransfer)).toBe(false);
    expect(tracks.has(freshTransfer)).toBe(true);

    phone.sent(staleTransfer);
    await waitForFlush();
    expect(phone.entry(stale.eventId).memberAt).toBeUndefined();
    expect(phone.emits).toEqual([]);
  });
});

describe('own Saved Messages delivery', () => {
  it('tracks a Saved Messages post only while an own device holds a lease', () => {
    const phone = makePhone({ hubLease: true });
    const note = dmEvent(me, me, 1);
    const publishedAt = clock.now;
    phone.publishDm(note);

    expect(phone.rows().get(note.eventId)).toMatchObject({
      scope: 'self_dm',
      groupId: null,
      channelId: null,
      conversationId: note.conversationId,
      authorAddress: me.address,
      createdAt: publishedAt,
    });
    expect(lastOf(phone.directEvents)).toMatchObject({
      eventId: note.eventId,
      localPostDeliverySince: publishedAt,
    });
    expect(
      phone.manager
        .getDirectHistory(me.address, me.address)
        .find((event) => event.eventId === note.eventId)
    ).toMatchObject({ localPostDeliverySince: publishedAt });

    // A DM to someone else, and our own note written on another device.
    const toBob = dmEvent(me, bob, 2);
    phone.publishDm(toBob);
    const fromHub = dmEvent(me, me, 1, { streamId: HUB_DM_STREAM });
    phone.copyDm(fromHub);
    expect([...phone.rows().keys()]).toEqual([note.eventId]);
    expect(lastOf(phone.directEvents)?.localPostDeliverySince).toBeUndefined();
    expect(
      phone.manager
        .getDirectHistory(me.address, bob.address)
        .every((event) => event.localPostDeliverySince === undefined)
    ).toBe(true);
    expect(
      phone.manager
        .getDirectHistory(me.address, me.address)
        .find((event) => event.eventId === fromHub.eventId)
        ?.localPostDeliverySince
    ).toBeUndefined();

    // A phone on its own: nobody could fetch it, so no row and no field.
    const alone = makePhone();
    const lonely = dmEvent(me, me, 1);
    alone.publishDm(lonely);
    expect(alone.rows().size).toBe(0);
    expect(lastOf(alone.directEvents)?.localPostDeliverySince).toBeUndefined();
  });

  it('keeps tracking for an account whose own device pulled from here, lease or not', async () => {
    const dbPath = tempDbPath();
    const phone = makePhone({ dbPath, hubLease: true });
    phone.publishDm(dmEvent(me, me, 1));
    phone.sent(await phone.savedMessagesFetch(0));

    // The Hub sleeps and its lease lapses; it is known to pull from here.
    phone.leases.hub = false;
    const whileAsleep = dmEvent(me, me, 2);
    phone.publishDm(whileAsleep);
    expect(phone.rows().has(whileAsleep.eventId)).toBe(true);

    // After a restart (before presence is up), from the stored proof.
    managers.splice(managers.indexOf(phone.manager), 1);
    phone.manager.close();
    const restarted = makePhone({ dbPath });
    const coldStart = dmEvent(me, me, 3);
    restarted.publishDm(coldStart);
    expect(restarted.rows().has(coldStart.eventId)).toBe(true);
    expect(lastOf(restarted.directEvents)?.localPostDeliverySince).toBe(
      clock.now
    );

    // A pull older than the 30 day history limit no longer counts.
    clock.now += 31 * 24 * 60 * MINUTE;
    const later = dmEvent(me, me, 4);
    restarted.publishDm(later);
    expect(restarted.rows().has(later.eventId)).toBe(false);
  });

  it("proves it once the home Hub's page is sent, never at the authorize", async () => {
    const phone = makePhone({ hubLease: true });
    const note = dmEvent(me, me, 1);
    phone.publishDm(note);

    const failedTransfer = await phone.savedMessagesFetch(0);
    expect(phone.rejected).toEqual([]);
    expect(phone.served).toHaveLength(1);
    phone.failed(failedTransfer);
    await waitForFlush();
    expect(phone.entry(note.eventId).ownDeviceAt).toBeUndefined();
    expect(phone.emits).toEqual([]);

    const transferId = await phone.savedMessagesFetch(0);
    await waitForFlush();
    expect(phone.emits).toEqual([]);
    clock.now += 1_500;
    const ownAt = clock.now;
    phone.sent(transferId);
    await waitForFlush();

    expect(phone.emits).toEqual([
      {
        updates: [
          {
            eventId: note.eventId,
            scope: 'self_dm',
            conversationId: note.conversationId,
            ownDeviceAt: ownAt,
          },
        ],
      },
    ]);
    expect(phone.rows().get(note.eventId)).toMatchObject({
      ownDeviceAt: ownAt,
      memberAt: null,
      proofKind: 'dm_page',
    });
    expect(
      phone.manager
        .getDirectHistory(me.address, me.address)
        .find((event) => event.eventId === note.eventId)
    ).toMatchObject({ localPostOwnDeviceAt: ownAt });
    expect(phone.manager.getDeliveryCounters()).toMatchObject({
      ownPostDeliveredOwnDevice: 1,
    });
  });

  it("marks an older own post served behind the own device's cursor", async () => {
    const phone = makePhone({ hubLease: true });
    const ownStream = phone.db.getOrCreateDirectAuthorStreamId(me.address);
    const older = dmEvent(me, me, 1, {
      streamId: ownStream,
      timestamp: clock.now - 10 * MINUTE,
    });
    phone.publishDm(older);
    const hubNote = dmEvent(me, me, 1, {
      streamId: HUB_DM_STREAM,
      timestamp: clock.now - MINUTE,
    });
    phone.copyDm(hubNote);

    // The Hub asks for everything after its own newest note.
    const transferId = await phone.savedMessagesFetch(hubNote.timestamp);
    expect(phone.rejected).toEqual([]);
    phone.sent(transferId);
    await waitForFlush();

    expect(phone.emits).toHaveLength(1);
    expect(phone.emits[0].updates.map((update) => update.eventId)).toEqual([
      older.eventId,
    ]);
    expect(phone.entry(older.eventId).ownDeviceAt).toBe(clock.now);
  });

  it('is not proven by a cursor the own device only named in its notify', async () => {
    const phone = makePhone({ hubLease: true });
    const note = dmEvent(me, me, 1);
    phone.publishDm(note);
    const m = phone.manager as any;

    m.confirmSelfDmCursorFromNotify(
      me.address,
      HUB_PEER,
      m.dmNotifyLatestCursor(note)
    );
    await waitForFlush();
    expect(phone.entry(note.eventId).ownDeviceAt).toBeUndefined();
    expect(phone.rows().get(note.eventId).ownDeviceAt).toBeNull();
    expect(phone.emits).toEqual([]);
  });

  it('returns the proof from a new manager on the same database', async () => {
    const dbPath = tempDbPath();
    const first = makePhone({ dbPath, hubLease: true });
    const note = dmEvent(me, me, 1);
    const publishedAt = clock.now;
    first.publishDm(note);
    first.sent(await first.savedMessagesFetch(0));
    const ownAt = clock.now;
    managers.splice(managers.indexOf(first.manager), 1);
    first.manager.close();

    const second = makePhone({ dbPath, hubLease: true });
    expect(
      second.manager
        .getDirectHistory(me.address, me.address)
        .find((event) => event.eventId === note.eventId)
    ).toMatchObject({
      localPostDeliverySince: publishedAt,
      localPostOwnDeviceAt: ownAt,
    });
  });

  it('does nothing with the option off', async () => {
    const phone = makePhone({ track: false, hubLease: true });
    const note = dmEvent(me, me, 1);
    phone.publishDm(note);
    phone.sent(await phone.savedMessagesFetch(0));
    await waitForFlush();

    expect(phone.rows().size).toBe(0);
    expect(phone.emits).toEqual([]);
    expect(lastOf(phone.directEvents)?.localPostDeliverySince).toBeUndefined();
    expect(
      phone.manager
        .getDirectHistory(me.address, me.address)
        .every((event) => event.localPostDeliverySince === undefined)
    ).toBe(true);
  });
});
