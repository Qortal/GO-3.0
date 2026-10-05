import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Under Vitest `better-sqlite3` resolves to a statement-shape mock that, among
// other things, ignores the DM delivery_status UPDATE. These tests run the real
// ReticulumChatDatabase SQL against Node's built-in SQLite (node:sqlite)
// through a minimal better-sqlite3 adapter, so DM rows really move between
// 'pending' and 'sent'.
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
  buildReticulumChatSignedFields,
  buildReticulumDmRequestSignedFields,
  buildReticulumDmSignedFields,
  hashReticulumChatPayload,
  ReticulumChatManager,
  RETICULUM_CHAT_PROVIDER_AUTH_WINDOW_MS,
  type ReticulumChatEvent,
  type ReticulumChatManagerOptions,
  type ReticulumChatWire,
  type ReticulumDmEvent,
  verifyReticulumDmNotify,
} from './reticulum-chat';
import { reticulumDmConversationId } from './reticulum-chat-db';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

type Identity = { address: string; publicKey: string; secretKey: Uint8Array };

const SIMON_HUB_PEER = '7d4e35a0cd43f6fd'.padEnd(32, '0');
const SAYBIN_GO_PEER = 'a83d90afdae8d783'.padEnd(32, '0');
const SAYBIN_HUB_PEER = 'd844a0c4aa32242b'.padEnd(32, '0');
const BOB_PEER = 'b0b0b0b0b0b0b0b0'.padEnd(32, '0');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const LOOKBACK_WINDOW_MS = 7 * DAY;
const LOOKBACK_MARK_MARGIN_MS = 60 * MINUTE;

const managers: ReticulumChatManager[] = [];
const tempRoots: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function tempDir(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
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

function dmEvent(
  sender: Identity,
  recipient: Identity,
  eventId: string,
  senderSeq: number,
  timestamp: number
): ReticulumDmEvent {
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
    senderSeq,
    timestamp,
    eventType: 'message',
    payload,
    payloadHash: hashReticulumChatPayload(payload),
    signature: '',
  };
  event.signature = sign(buildReticulumDmSignedFields(event), sender);
  return event;
}

/** Signs this account's DM page requests (RCHAT_DM_REQ) like the app does. */
function dmRequestSigner(
  who: Identity
): NonNullable<ReticulumChatManagerOptions['signLocalFields']> {
  return async (fields) => {
    const f = fields as Record<string, any>;
    const signedFields =
      f.type === 'RCHAT_DM_REQ'
        ? buildReticulumDmRequestSignedFields({
            peerAddress: f.peerAddress,
            after: f.after,
            limit: f.limit,
            requesterPeerHash: f.requesterPeerHash,
            requestId: f.requestId,
            authorAddress: who.address,
            authorPublicKey: who.publicKey,
            timestamp: f.timestamp,
          })
        : { ...f, authorAddress: who.address, authorPublicKey: who.publicKey };
    return {
      authorAddress: who.address,
      authorPublicKey: who.publicKey,
      signature: sign(signedFields, who),
    };
  };
}

async function flush(ticks = 6): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

const clock = { now: Date.now() };

type DmNotifyWire = Extract<ReticulumChatWire, { k: 'dm_notify' }>;

/**
 * A DM page provider (Saybin's GO): scriptable authorize, captured pages and
 * control wires. `signer` lets it sign its own notifies (the outbox sweep).
 */
function makeProvider(
  owner: Identity,
  peerHash = SAYBIN_GO_PEER,
  options: { signer?: boolean } = {}
) {
  const pages: Array<Record<string, any>> = [];
  const authorizeCalls: Array<Record<string, any>> = [];
  const rejected: Array<Record<string, any>> = [];
  const wires: ReticulumChatWire[] = [];
  let authorizeResult: { ok: true } | { ok: false; reason: string } = {
    ok: true,
  };
  const bridge = Object.assign(new EventEmitter(), {
    getLocalDestinationHash: () => peerHash,
    sendReticulumChatDetailed: async (
      _peer: string,
      wire: ReticulumChatWire
    ) => {
      wires.push(wire);
      return { ok: true as const };
    },
    fanoutReticulumChatDetailed: async (messages: ReticulumChatWire[]) => {
      wires.push(...messages);
      return { ok: true as const };
    },
    sendReticulumChatResourceDetailed: async (payload: Record<string, any>) => {
      pages.push(payload);
      return { ok: true as const };
    },
    authorizeReticulumChatResourceDetailed: async (
      payload: Record<string, any>
    ) => {
      authorizeCalls.push(payload);
      return authorizeResult;
    },
    rejectReticulumChatResourceDetailed: async (
      payload: Record<string, any>
    ) => {
      rejected.push(payload);
      return { ok: true as const };
    },
  });
  const manager = new ReticulumChatManager({
    dbPath: path.join(tempDir('rchat-dm-provider-'), 'reticulum-chat.db'),
    now: () => clock.now,
    bridge: bridge as any,
    ...(options.signer
      ? {
          signLocalFields: dmRequestSigner(owner),
          hasGoodOverlayHealth: () => true,
        }
      : {}),
  });
  managers.push(manager);
  manager.setLocalDmAddresses([owner.address]);
  const db = (manager as any).db;
  return {
    manager,
    db,
    pages,
    authorizeCalls,
    rejected,
    notifies: () =>
      wires.filter((wire): wire is DmNotifyWire => wire.k === 'dm_notify'),
    setAuthorize: (result: typeof authorizeResult) => {
      authorizeResult = result;
    },
    /** This device wrote it: own_event=1, pending (as publishDirectEvent). */
    authored: (event: ReticulumDmEvent) =>
      expect(
        (manager as any).acceptDirectEvent(event, true, {
          deliveryStatus: 'pending',
        })
      ).toBe(true),
    /** A stored copy (own_event=0, 'received'). */
    copy: (event: ReticulumDmEvent) =>
      expect((manager as any).acceptDirectEvent(event, false)).toBe(true),
    status: (eventId: string) =>
      db.getDirectEvent(eventId)?.localDeliveryStatus as string | undefined,
    pageEventIds: (page: Record<string, any>) =>
      (
        JSON.parse(fs.readFileSync(String(page.filePath), 'utf8')).events as [
          string,
          string,
        ][]
      ).map((tuple) => tuple[1]),
    pageMore: (page: Record<string, any>) =>
      JSON.parse(fs.readFileSync(String(page.filePath), 'utf8')).more === true,
    delivered: (transferId: string) =>
      manager.handleResourceEvent({ status: 'sent', transferId } as any),
    failed: (transferId: string, reason = 'resource_session_closed') =>
      manager.handleResourceEvent({
        status: 'failed',
        transferId,
        reason,
      } as any),
  };
}

/** The provider's view of a signed page request from `requester`. */
async function requestPage(
  provider: ReturnType<typeof makeProvider>,
  requester: Identity,
  peerAddress: string,
  requesterPeerHash: string,
  after: number,
  transferId: string,
  limit = 50
): Promise<void> {
  const timestamp = clock.now;
  const signedFields = buildReticulumDmRequestSignedFields({
    peerAddress,
    after,
    limit,
    requesterPeerHash,
    requestId: transferId,
    authorAddress: requester.address,
    authorPublicKey: requester.publicKey,
    timestamp,
  });
  await (provider.manager as any).authorizeDirectDmPageResource(
    {
      status: 'auth',
      linkId: `link-${transferId}`,
      transferId,
      peerPresenceHash: requesterPeerHash,
    },
    {
      transferId,
      b: peerAddress,
      a: after,
      l: limit,
      q: transferId,
      rp: requesterPeerHash,
      p: requester.publicKey,
      n: timestamp,
      z: sign(signedFields, requester),
    }
  );
}

/** A DM page requester (Simon's device): captured page requests. */
function makeRequester(
  owner: Identity,
  peerHash = SIMON_HUB_PEER,
  dbPath = path.join(tempDir('rchat-dm-requester-'), 'reticulum-chat.db')
) {
  const accepted: Array<Record<string, any>> = [];
  /** Called as the bridge receives each page request. */
  const hooks: { onAccept?: (payload: Record<string, any>) => void } = {};
  const bridge = Object.assign(new EventEmitter(), {
    getLocalDestinationHash: () => peerHash,
    sendReticulumChatDetailed: async () => ({ ok: true as const }),
    fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
    acceptReticulumChatResourceDetailed: async (
      payload: Record<string, any>
    ) => {
      accepted.push(payload);
      hooks.onAccept?.(payload);
      return { ok: true as const };
    },
  });
  const manager = new ReticulumChatManager({
    dbPath,
    now: () => clock.now,
    signLocalFields: dmRequestSigner(owner),
    bridge: bridge as any,
  });
  managers.push(manager);
  manager.setLocalDmAddresses([owner.address]);
  const db = (manager as any).db;
  let requestCounter = 0;
  return {
    manager,
    db,
    accepted,
    hooks,
    copy: (event: ReticulumDmEvent) =>
      expect((manager as any).acceptDirectEvent(event, false)).toBe(true),
    cursorOf: (event: ReticulumDmEvent) =>
      (manager as any).dmNotifyLatestCursor(event) as string,
    /** Pulls open to `sourcePeerHash` (in flight or waiting on a retry). */
    openPullKeys: (sourcePeerHash: string) =>
      [...((manager as any).directDmPulls as Map<string, any>).values()]
        .filter((pull) => pull.sourcePeerHash === sourcePeerHash)
        .map((pull) => String(pull.key)),
    /** A pull that runs anyway: what a dm_notify (or probe answer) queues. */
    pull: async (
      sender: Identity,
      sourcePeerHash: string,
      latestCursor: string
    ) => {
      requestCounter += 1;
      (manager as any).queueDirectMissingEvents({
        conversationId: reticulumDmConversationId(
          sender.address,
          owner.address
        ),
        addressA: sender.address,
        addressB: owner.address,
        sourcePeerHash,
        remoteEventId: latestCursor ? `cursor:${latestCursor}` : '',
        remoteTimestamp: Number.MAX_SAFE_INTEGER,
        requestId: `${String(requestCounter).padStart(4, '0')}${'f'.repeat(12)}`,
      });
      await flush();
    },
    pullState: (sender: Identity, sourcePeerHash: string) =>
      (manager as any).directDmPulls.get(
        `${sourcePeerHash}:${reticulumDmConversationId(sender.address, owner.address)}`
      ),
    lookbackState: (sender: Identity, sourcePeerHash: string) =>
      (manager as any).directDmLookbacks.get(
        `${sourcePeerHash}|${reticulumDmConversationId(sender.address, owner.address)}`
      ),
    /** The look-back's own pull entry, beside the cursor pull. */
    lookbackPullState: (sender: Identity, sourcePeerHash: string) =>
      (manager as any).directDmPulls.get(
        `${sourcePeerHash}:${reticulumDmConversationId(sender.address, owner.address)}:lookback`
      ),
  };
}

/**
 * Hand the requester's captured request to the provider, then the page the
 * provider built back to the requester, as the two bridges would.
 */
async function servePage(
  requester: ReturnType<typeof makeRequester>,
  provider: ReturnType<typeof makeProvider>,
  request: Record<string, any>,
  requesterPeerHash = SIMON_HUB_PEER
): Promise<Record<string, any> | null> {
  const before = provider.pages.length;
  await (provider.manager as any).authorizeDirectDmPageResource(
    {
      status: 'auth',
      linkId: `link-${request.transferId}`,
      transferId: request.transferId,
      peerPresenceHash: requesterPeerHash,
    },
    request.authMessage
  );
  const page = provider.pages[before];
  if (!page) {
    const reason = provider.rejected.at(-1)?.reason ?? 'no_page';
    requester.manager.handleResourceEvent({
      status: 'failed',
      transferId: request.transferId,
      reason,
    } as any);
    await flush();
    return null;
  }
  const receivedPath = path.join(
    tempDir('rchat-dm-received-'),
    `${request.transferId}.json`
  );
  fs.copyFileSync(String(page.filePath), receivedPath);
  requester.manager.handleResourceEvent({
    status: 'received',
    transferId: request.transferId,
    path: receivedPath,
  } as any);
  await flush();
  return page;
}

describe('DM page delivery is proven by the transfer, not the authorize', () => {
  it('keeps served own events pending until the bridge reports the page delivered', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const go = makeProvider(saybin);
    await flush();
    const g1 = dmEvent(saybin, simon, 'go-dm-0434', 1, clock.now - 30 * MINUTE);
    const g2 = dmEvent(saybin, simon, 'go-dm-0435', 2, clock.now - 29 * MINUTE);
    // Saybin's message written on his Hub, stored on the phone as a copy.
    const hub = dmEvent(
      saybin,
      simon,
      'hub-dm-0459',
      3,
      clock.now - 5 * MINUTE
    );
    go.authored(g1);
    go.authored(g2);
    go.copy(hub);
    expect(go.status(hub.eventId)).toBe('received');
    const directEvents: ReticulumDmEvent[] = [];
    go.manager.on('directEvent', ({ event }) => directEvents.push(event));

    // Authorize OK: the bridge only handed the page to its link.
    await requestPage(
      go,
      simon,
      saybin.address,
      SIMON_HUB_PEER,
      0,
      'a1'.repeat(8)
    );
    expect(go.rejected).toEqual([]);
    expect(go.pageEventIds(go.pages[0])).toEqual([
      g1.eventId,
      g2.eventId,
      hub.eventId,
    ]);
    expect(go.authorizeCalls[0]).toMatchObject({
      transferId: 'a1'.repeat(8),
      logicalResourceType: 'reticulum_chat_dm_page',
    });
    expect(go.status(g1.eventId)).toBe('pending');
    expect(go.status(g2.eventId)).toBe('pending');
    expect(go.manager.getDeliveryCounters()).toMatchObject({
      dmPageServedToRecipient: 1,
    });

    // The requester was already gone: the transfer fails. Nothing changes,
    // and a late 'sent' for the same transfer no longer counts.
    go.failed('a1'.repeat(8));
    go.delivered('a1'.repeat(8));
    // Neither does a terminal for a transfer this device never authorized.
    go.delivered('ff'.repeat(8));
    expect(go.status(g1.eventId)).toBe('pending');
    expect(go.status(g2.eventId)).toBe('pending');
    expect(directEvents).toEqual([]);
    expect(go.manager.getDeliveryCounters()).toMatchObject({
      dmPageDeliveryFailed: 1,
    });

    // The recipient's cursor has meanwhile passed them (it holds the Hub
    // message). Still pending, they are served to it again...
    await requestPage(
      go,
      simon,
      saybin.address,
      SIMON_HUB_PEER,
      hub.timestamp - 1,
      'a2'.repeat(8)
    );
    expect(go.pageEventIds(go.pages[1])).toEqual([
      g1.eventId,
      g2.eventId,
      hub.eventId,
    ]);
    expect(go.status(g1.eventId)).toBe('pending');
    // ...and only the delivered page marks them. The stored copy of the Hub
    // message is not this device's to mark.
    go.delivered('a2'.repeat(8));
    expect(go.status(g1.eventId)).toBe('sent');
    expect(go.status(g2.eventId)).toBe('sent');
    expect(go.status(hub.eventId)).toBe('received');
    expect(directEvents.map((event) => event.eventId).sort()).toEqual(
      [g1.eventId, g2.eventId].sort()
    );
    expect(go.manager.getDeliveryCounters()).toMatchObject({
      dmPageDelivered: 1,
    });
    // Settled once.
    go.delivered('a2'.repeat(8));
    expect(directEvents).toHaveLength(2);
  });

  it('settles a delivered page whose authorize reply was lost', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const go = makeProvider(saybin);
    await flush();
    const g1 = dmEvent(saybin, simon, 'go-dm-timeout', 1, clock.now - MINUTE);
    go.authored(g1);
    // The bridge handed the page on, but its reply to the authorize timed
    // out on the way back: the page may still reach the requester.
    go.setAuthorize({ ok: false, reason: 'timeout' });
    await requestPage(
      go,
      simon,
      saybin.address,
      SIMON_HUB_PEER,
      0,
      'a7'.repeat(8)
    );
    expect(go.authorizeCalls).toHaveLength(1);
    expect(go.status(g1.eventId)).toBe('pending');
    go.delivered('a7'.repeat(8));
    expect(go.status(g1.eventId)).toBe('sent');
    expect(go.manager.getDeliveryCounters()).toMatchObject({
      dmPageDelivered: 1,
    });
  });

  it('confirms the notify a page answers at the authorize, whatever the transfer does', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const go = makeProvider(saybin);
    await flush();
    const g1 = dmEvent(saybin, simon, 'go-dm-notify', 1, clock.now - MINUTE);
    go.authored(g1);
    // The live notify for g1 is tracked (direct retry, gossip, full-network
    // fallback) until the recipient answers it; the page request carries
    // its id.
    const notifyId = 'a8'.repeat(8);
    (go.manager as any).trackPendingDmNotifyDelivery(
      g1,
      { t: 'RCHAT', k: 'dm_notify', d: { q: notifyId } },
      [SIMON_HUB_PEER],
      []
    );
    expect((go.manager as any).pendingDmNotifyDeliveries.size).toBe(1);
    await requestPage(go, simon, saybin.address, SIMON_HUB_PEER, 0, notifyId);
    expect(go.rejected).toEqual([]);
    // The signed request proves the notify arrived: no more retries, while
    // the event itself waits for the page's outcome.
    expect((go.manager as any).pendingDmNotifyDeliveries.size).toBe(0);
    expect(go.status(g1.eventId)).toBe('pending');
    go.failed(notifyId);
    expect(go.status(g1.eventId)).toBe('pending');
  });

  it('records an own device copy only once its page is delivered', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const go = makeProvider(saybin);
    await flush();
    (go.manager as any).isVerifiedSelfDmPeer = (
      address: string,
      peer: string
    ) => address === saybin.address && peer === SAYBIN_HUB_PEER;
    const g1 = dmEvent(saybin, simon, 'go-dm-own-copy', 1, clock.now - MINUTE);
    go.authored(g1);

    // Saybin's Hub pulls the Saybin <-> Simon conversation as Saybin.
    await requestPage(
      go,
      saybin,
      simon.address,
      SAYBIN_HUB_PEER,
      0,
      'b1'.repeat(8)
    );
    expect(go.rejected).toEqual([]);
    expect(go.db.getDirectEvent(g1.eventId).localOwnDeviceCopiedAt).toBeFalsy();
    go.delivered('b1'.repeat(8));
    const row = go.db.getDirectEvent(g1.eventId);
    expect(row.localOwnDeviceCopiedAt).toBeGreaterThan(0);
    // A copy on the own Hub is not a delivery to the recipient.
    expect(row.localDeliveryStatus).toBe('pending');
    expect(go.manager.getDeliveryCounters()).toMatchObject({
      dmPageServedToOwnDevice: 1,
      ownDeviceCopied: 1,
    });
  });

  it('names the requesting device and the auth latency in the authorize log lines', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const go = makeProvider(saybin);
    await flush();
    go.authored(dmEvent(saybin, simon, 'go-dm-log', 1, clock.now - MINUTE));
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    const auth = (transferId: string) => {
      const timestamp = clock.now;
      const signedFields = buildReticulumDmRequestSignedFields({
        peerAddress: saybin.address,
        after: 0,
        limit: 50,
        requesterPeerHash: SIMON_HUB_PEER,
        requestId: transferId,
        authorAddress: simon.address,
        authorPublicKey: simon.publicKey,
        timestamp,
      });
      return {
        status: 'auth',
        linkId: `link-${transferId}`,
        transferId,
        peerPresenceHash: SIMON_HUB_PEER,
        resourceType: 'reticulum_chat_event',
        auth: {
          type: 'RETICULUM_CHAT_DM_PAGE_REQUEST',
          transferId,
          b: saybin.address,
          a: 0,
          l: 50,
          q: transferId,
          rp: SIMON_HUB_PEER,
          p: simon.publicKey,
          n: timestamp,
          z: sign(signedFields, simon),
        },
      } as any;
    };
    // The auth event reached the engine 1.2 s before it answered.
    go.manager.handleResourceEvent(auth('c1'.repeat(8)), {
      receivedAt: clock.now - 1_200,
    });
    await flush();
    go.setAuthorize({ ok: false, reason: 'unknown-link-id' });
    go.manager.handleResourceEvent(auth('c2'.repeat(8)), {
      receivedAt: clock.now - 14_700,
    });
    await flush();
    const authorized = logs.find((line) =>
      line.includes('dm_page_link_authorized')
    );
    const failed = logs.find((line) =>
      line.includes('dm_page_link_authorize_failed')
    );
    expect(authorized).toContain(`peer=${SIMON_HUB_PEER.slice(0, 16)}`);
    expect(authorized).toContain('auth_ms=1200');
    expect(failed).toContain(`peer=${SIMON_HUB_PEER.slice(0, 16)}`);
    expect(failed).toContain('auth_ms=14700');
  });
});

describe('passed pending events in a DM page', () => {
  it('always leaves room for an event newer than the cursor', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const go = makeProvider(saybin);
    await flush();
    const start = clock.now - 3 * 60 * MINUTE;
    const passed: ReticulumDmEvent[] = [];
    for (let i = 0; i < 55; i += 1) {
      const event = dmEvent(saybin, simon, `go-passed-${i}`, i + 1, start + i);
      passed.push(event);
      go.authored(event);
    }
    // Two newer messages written on Saybin's Hub, copied to the phone; the
    // recipient's cursor sits just before them.
    const newer1 = dmEvent(
      saybin,
      simon,
      'hub-newer-1',
      100,
      clock.now - 2 * MINUTE
    );
    const newer2 = dmEvent(
      saybin,
      simon,
      'hub-newer-2',
      101,
      clock.now - MINUTE
    );
    go.copy(newer1);
    go.copy(newer2);
    const after = newer1.timestamp - 1;

    await requestPage(
      go,
      simon,
      saybin.address,
      SIMON_HUB_PEER,
      after,
      'd1'.repeat(8)
    );
    const ids = go.pageEventIds(go.pages[0]);
    expect(ids).toHaveLength(50);
    expect(ids.slice(0, 49)).toEqual(passed.slice(0, 49).map((e) => e.eventId));
    // The page's newest event moves a continuing requester past `after`.
    expect(ids[49]).toBe(newer1.eventId);
    expect(go.pageMore(go.pages[0])).toBe(true);
    expect(go.manager.getDeliveryCounters()).toMatchObject({
      dmPagePassedPendingServed: 49,
      dmPagePassedPendingDeferred: 1,
    });

    // Nothing newer than the cursor: passed events alone, and a final page.
    await requestPage(
      go,
      simon,
      saybin.address,
      SIMON_HUB_PEER,
      newer2.timestamp,
      'd2'.repeat(8)
    );
    const onlyPassed = go.pageEventIds(go.pages[1]);
    expect(onlyPassed).toEqual(passed.slice(0, 50).map((e) => e.eventId));
    expect(go.pageMore(go.pages[1])).toBe(false);
  });
});

describe('non-self DM look-back behind the sender cursor', () => {
  it('asks once from a stable point behind the cursor and recovers what the cursor skipped', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    const go = makeProvider(saybin);
    await flush();
    // Saybin wrote two messages on his phone that never reached Simon, then
    // one on his Hub that did; Simon's cursor for Saybin is the Hub message.
    const g1 = dmEvent(
      saybin,
      simon,
      'go-missed-1',
      1,
      clock.now - 30 * MINUTE
    );
    const g2 = dmEvent(
      saybin,
      simon,
      'go-missed-2',
      2,
      clock.now - 29 * MINUTE
    );
    const fromHub = dmEvent(
      saybin,
      simon,
      'hub-arrived',
      3,
      clock.now - 5 * MINUTE
    );
    go.authored(g1);
    go.authored(g2);
    go.copy(fromHub);
    hub.copy(fromHub);

    // The phone announces its newest event, which Simon already holds: the
    // cursor shortcut would end this pull without a request. Its look-back
    // asks once from 7 days behind the cursor.
    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fromHub));
    expect(hub.accepted).toHaveLength(1);
    expect(hub.accepted[0]).toMatchObject({
      peerPresenceHash: SAYBIN_GO_PEER,
      authMessage: {
        type: 'RETICULUM_CHAT_DM_PAGE_REQUEST',
        a: fromHub.timestamp - LOOKBACK_WINDOW_MS,
      },
    });

    const page = await servePage(hub, go, hub.accepted[0]);
    expect(page).not.toBeNull();
    expect(hub.db.getDirectEvent(g1.eventId)).toMatchObject({
      eventId: g1.eventId,
      localDeliveryStatus: 'received',
      localOwnEvent: false,
    });
    expect(hub.db.getDirectEvent(g2.eventId)).not.toBeNull();
    expect(hub.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
      done: true,
      pulls: 1,
    });
    expect(hub.pullState(saybin, SAYBIN_GO_PEER)).toBeUndefined();
    // The phone marks them delivered once its bridge reports the transfer.
    expect(go.status(g1.eventId)).toBe('pending');
    go.delivered(String(hub.accepted[0].transferId));
    expect(go.status(g1.eventId)).toBe('sent');
    expect(go.status(g2.eventId)).toBe('sent');

    // Done for this source and conversation: later pulls keep the shortcut.
    clock.now += 10 * MINUTE;
    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fromHub));
    expect(hub.accepted).toHaveLength(1);
  });

  it('runs a cursor pull first and chains its look-back after it', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    const go = makeProvider(saybin);
    await flush();
    const g1 = dmEvent(
      saybin,
      simon,
      'go-chain-missed',
      1,
      clock.now - 30 * MINUTE
    );
    const fromHub = dmEvent(
      saybin,
      simon,
      'hub-chain-arrived',
      2,
      clock.now - 5 * MINUTE
    );
    const g3 = dmEvent(saybin, simon, 'go-chain-new', 3, clock.now - MINUTE);
    go.authored(g1);
    go.copy(fromHub);
    go.authored(g3);
    hub.copy(fromHub);
    // An older build marked it 'sent' when it authorized a page that never
    // arrived, so the phone no longer serves it as a passed pending event
    // (neither does a provider without that path, such as Hub 3.0.3).
    go.db.markDirectDeliveryStatus(g1.eventId, 'sent');

    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(g3));
    // The new message first, from the cursor.
    expect(hub.accepted).toHaveLength(1);
    expect(hub.accepted[0].authMessage.a).toBe(fromHub.timestamp - 1);
    await servePage(hub, go, hub.accepted[0]);
    expect(hub.db.getDirectEvent(g3.eventId)).not.toBeNull();
    expect(hub.db.getDirectEvent(g1.eventId)).toBeNull();
    // Then the same pull looks back.
    expect(hub.accepted).toHaveLength(2);
    expect(hub.accepted[1].authMessage.a).toBe(
      g3.timestamp - LOOKBACK_WINDOW_MS
    );
    await servePage(hub, go, hub.accepted[1]);
    expect(hub.db.getDirectEvent(g1.eventId)).not.toBeNull();
    expect(hub.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
      done: true,
    });
    expect(hub.pullState(saybin, SAYBIN_GO_PEER)).toBeUndefined();
    expect(hub.accepted).toHaveLength(2);
  });

  it('starts at most one look-back per interval across conversations', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const bob = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    await flush();
    const fromSaybin = dmEvent(
      saybin,
      simon,
      'saybin-cursor',
      1,
      clock.now - 5 * MINUTE
    );
    const fromBob = dmEvent(
      bob,
      simon,
      'bob-cursor',
      1,
      clock.now - 4 * MINUTE
    );
    hub.copy(fromSaybin);
    hub.copy(fromBob);

    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fromSaybin));
    await hub.pull(bob, BOB_PEER, hub.cursorOf(fromBob));
    // Bob's pull ends on its shortcut: no request, no look-back state.
    expect(hub.accepted.map((entry) => entry.peerPresenceHash)).toEqual([
      SAYBIN_GO_PEER,
    ]);
    expect(hub.lookbackState(bob, BOB_PEER)).toBeUndefined();
    expect(hub.pullState(bob, BOB_PEER)).toBeUndefined();

    clock.now += 30_000;
    await hub.pull(bob, BOB_PEER, hub.cursorOf(fromBob));
    expect(hub.accepted.map((entry) => entry.peerPresenceHash)).toEqual([
      SAYBIN_GO_PEER,
      BOB_PEER,
    ]);
    expect(hub.accepted[1].authMessage.a).toBe(
      fromBob.timestamp - LOOKBACK_WINDOW_MS
    );
  });

  it('never retries a failed look-back, keeps its cursor, and gives a failing source up after three pulls', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    await flush();
    const fromHub = dmEvent(
      saybin,
      simon,
      'hub-retry-cursor',
      1,
      clock.now - 5 * MINUTE
    );
    hub.copy(fromHub);
    const lookbackAfter = fromHub.timestamp - LOOKBACK_WINDOW_MS;
    const reasons = [
      'resource_session_live_dm_no_response',
      'resource_provider_busy',
      'resource_authorization_timeout',
    ];

    for (let pullNumber = 1; pullNumber <= 3; pullNumber += 1) {
      const before = hub.accepted.length;
      await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fromHub));
      expect(hub.accepted).toHaveLength(before + 1);
      expect(hub.accepted.at(-1)!.authMessage.a).toBe(lookbackAfter);
      // The cursor pull ended on its shortcut; the look-back is its own pull.
      expect(hub.pullState(saybin, SAYBIN_GO_PEER)).toBeUndefined();
      expect(hub.lookbackPullState(saybin, SAYBIN_GO_PEER)).toBeDefined();
      // The slow device misses its deadline (or refuses): the look-back
      // ends at once, with no retry, and stays owed.
      hub.manager.handleResourceEvent({
        status: 'failed',
        transferId: hub.accepted.at(-1)!.transferId,
        reason: reasons[pullNumber - 1],
      } as any);
      await flush();
      expect(hub.lookbackPullState(saybin, SAYBIN_GO_PEER)).toBeUndefined();
      expect(hub.openPullKeys(SAYBIN_GO_PEER)).toEqual([]);
      expect(hub.accepted).toHaveLength(before + 1);
      expect(hub.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
        done: false,
        pulls: pullNumber,
      });
      // The next one waits for the interval and for a pull that ends.
      clock.now += 10_000;
      await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fromHub));
      expect(hub.accepted).toHaveLength(before + 1);
      clock.now += 20_000;
    }
    // Three look-back requests failed: the source is given up for the process.
    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fromHub));
    expect(hub.accepted).toHaveLength(3);
    expect(hub.accepted.map((request) => request.authMessage.a)).toEqual([
      lookbackAfter,
      lookbackAfter,
      lookbackAfter,
    ]);
    expect(new Set(hub.accepted.map((r) => r.transferId)).size).toBe(3);
    expect(hub.openPullKeys(SAYBIN_GO_PEER)).toEqual([]);
  });

  it('treats no events behind the cursor as a completed look-back', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    await flush();
    const fromHub = dmEvent(
      saybin,
      simon,
      'hub-empty-cursor',
      1,
      clock.now - 5 * MINUTE
    );
    hub.copy(fromHub);

    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fromHub));
    expect(hub.accepted).toHaveLength(1);
    hub.manager.handleResourceEvent({
      status: 'failed',
      transferId: hub.accepted[0].transferId,
      reason: 'no_dm_events',
    } as any);
    await flush();
    expect(hub.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
      done: true,
    });
    expect(hub.pullState(saybin, SAYBIN_GO_PEER)).toBeUndefined();
    clock.now += 10 * MINUTE;
    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fromHub));
    expect(hub.accepted).toHaveLength(1);
  });

  it('fetches a live message at once while a look-back page is in flight', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    const go = makeProvider(saybin);
    await flush();
    // 120 messages from Saybin in the last 3 hours, held on both sides.
    const older: ReticulumDmEvent[] = [];
    for (let i = 0; i < 120; i += 1) {
      const event = dmEvent(
        saybin,
        simon,
        `older-${String(i).padStart(3, '0')}`,
        i + 1,
        clock.now - 3 * 60 * MINUTE + i * MINUTE
      );
      older.push(event);
      go.copy(event);
      hub.copy(event);
    }
    const latest = older[older.length - 1];
    const lookbackAfter = latest.timestamp - LOOKBACK_WINDOW_MS;
    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(latest));
    expect(hub.accepted).toHaveLength(1);
    expect(hub.accepted[0].authMessage.a).toBe(lookbackAfter);

    // A new message's notify arrives while the first look-back page is in
    // flight: its cursor pull asks at once.
    clock.now += 1_000;
    const fresh = dmEvent(saybin, simon, 'fresh-live', 500, clock.now);
    go.authored(fresh);
    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fresh));
    expect(hub.accepted).toHaveLength(2);
    expect(hub.accepted[1].authMessage.a).toBe(latest.timestamp - 1);
    await servePage(hub, go, hub.accepted[1]);
    expect(hub.db.getDirectEvent(fresh.eventId)).not.toBeNull();
    expect(hub.pullState(saybin, SAYBIN_GO_PEER)).toBeUndefined();
    // The look-back (still in flight) was not started twice.
    expect(hub.accepted).toHaveLength(2);

    // The look-back goes on page by page, and finishes.
    await servePage(hub, go, hub.accepted[0]);
    expect(hub.accepted).toHaveLength(3);
    expect(hub.accepted[2].authMessage.a).toBe(older[49].timestamp);
    await servePage(hub, go, hub.accepted[2]);
    expect(hub.accepted).toHaveLength(4);
    expect(hub.accepted[3].authMessage.a).toBe(older[99].timestamp);
    await servePage(hub, go, hub.accepted[3]);
    expect(hub.accepted).toHaveLength(4);
    expect(hub.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
      done: true,
      pulls: 1,
    });
    expect(hub.lookbackPullState(saybin, SAYBIN_GO_PEER)).toBeUndefined();
    expect(hub.manager.getDeliveryCounters()).toMatchObject({
      dmLookbackStarted: 1,
      dmLookbackCompleted: 1,
    });
  });

  it('shares the one link to a device with live pulls: a live request waits for at most the one look-back request already on it', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    const go = makeProvider(saybin);
    await flush();
    const fromHub = dmEvent(
      saybin,
      simon,
      'hub-busy-cursor',
      1,
      clock.now - 5 * MINUTE
    );
    go.copy(fromHub);
    hub.copy(fromHub);
    const lookbackAfter = fromHub.timestamp - LOOKBACK_WINDOW_MS;
    const isLookback = (request: Record<string, any>) =>
      request.authMessage.a === lookbackAfter;
    const lookbackPullKey = `${SAYBIN_GO_PEER}:${fromHub.conversationId}:lookback`;

    // Both bridges send DM page requests to one device on one link, one at
    // a time, in order (the fast lane, concurrency 1): `link` is that queue.
    const link: Array<Record<string, any>> = [];
    let liveBehindLookback = 0;
    hub.hooks.onAccept = (request) => {
      if (isLookback(request)) {
        // Never sent while any other pull to that device is open.
        expect(hub.openPullKeys(SAYBIN_GO_PEER)).toEqual([lookbackPullKey]);
      } else if (link.some(isLookback)) {
        liveBehindLookback += 1;
      }
      link.push(request);
    };
    // The link works through what it holds when the next notify arrives:
    // the slow phone misses the 10 s deadline on every look-back request (the
    // worst case: one is still on the link then); live pages go through.
    const work = async () => {
      for (const request of link.splice(0)) {
        if (isLookback(request)) {
          hub.manager.handleResourceEvent({
            status: 'failed',
            transferId: request.transferId,
            reason: 'resource_session_live_dm_no_response',
          } as any);
          await flush();
        } else {
          await servePage(hub, go, request);
        }
      }
    };

    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fromHub));
    expect(link.filter(isLookback)).toHaveLength(1);
    for (let round = 0; round < 40; round += 1) {
      // A live message every 20 s.
      clock.now += 20_000;
      const fresh = dmEvent(
        saybin,
        simon,
        `fresh-busy-${round}`,
        2 + round,
        clock.now
      );
      go.authored(fresh);
      const before = hub.accepted.length;
      await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fresh));
      // Sent at once, whatever the look-back is doing.
      expect(
        hub.accepted.slice(before).filter((r) => !isLookback(r))
      ).toHaveLength(1);
      await work();
      expect(hub.db.getDirectEvent(fresh.eventId)).not.toBeNull();
    }
    // Three look-back requests in all (never retried), then given up; one
    // request per live message (none had to retry).
    expect(hub.accepted.filter(isLookback)).toHaveLength(3);
    expect(hub.accepted).toHaveLength(40 + 3);
    // Each look-back request held up at most the one live request that
    // arrived while it was on the link (here, each of them did).
    expect(liveBehindLookback).toBe(3);
    expect(hub.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
      pulls: 3,
      done: false,
    });
    expect(hub.openPullKeys(SAYBIN_GO_PEER)).toEqual([]);
  });

  it('gives way at its next page while a live pull to the device is open, and resumes after that page later', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    const go = makeProvider(saybin);
    await flush();
    // 120 messages from Saybin in the last 3 hours, held on both sides.
    const older: ReticulumDmEvent[] = [];
    for (let i = 0; i < 120; i += 1) {
      const event = dmEvent(
        saybin,
        simon,
        `yield-${String(i).padStart(3, '0')}`,
        i + 1,
        clock.now - 3 * 60 * MINUTE + i * MINUTE
      );
      older.push(event);
      go.copy(event);
      hub.copy(event);
    }
    const latest = older[older.length - 1];
    const lookbackAfter = latest.timestamp - LOOKBACK_WINDOW_MS;
    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(latest));
    expect(hub.accepted).toHaveLength(1);
    expect(hub.accepted[0].authMessage.a).toBe(lookbackAfter);

    // A notify while the first look-back page is on the link: the live
    // request is sent at once (behind it on the link).
    clock.now += 1_000;
    const fresh = dmEvent(saybin, simon, 'yield-live', 500, clock.now);
    go.authored(fresh);
    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fresh));
    expect(hub.accepted).toHaveLength(2);
    expect(hub.accepted[1].authMessage.a).toBe(latest.timestamp - 1);

    // The look-back page comes first (more to come): with the live pull
    // still open it asks for no next page and ends, still owed. It keeps
    // what it imported (the next try resumes after that page), and a try
    // that made progress is not counted.
    await servePage(hub, go, hub.accepted[0]);
    expect(hub.accepted).toHaveLength(2);
    expect(hub.lookbackPullState(saybin, SAYBIN_GO_PEER)).toBeUndefined();
    expect(hub.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
      after: older[49].timestamp,
      cursor: latest.timestamp,
      pulls: 0,
      done: false,
    });
    await servePage(hub, go, hub.accepted[1]);
    expect(hub.db.getDirectEvent(fresh.eventId)).not.toBeNull();
    // The live pull's end does not restart it inside the interval.
    expect(hub.accepted).toHaveLength(2);
    expect(hub.openPullKeys(SAYBIN_GO_PEER)).toEqual([]);

    // A later pull that ends starts it again after the page it has.
    clock.now += 30_000;
    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fresh));
    expect(hub.accepted).toHaveLength(3);
    expect(hub.accepted[2].authMessage.a).toBe(older[49].timestamp);
    await servePage(hub, go, hub.accepted[2]);
    expect(hub.accepted[3].authMessage.a).toBe(older[99].timestamp);
    await servePage(hub, go, hub.accepted[3]);
    expect(hub.accepted).toHaveLength(4);
    expect(hub.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
      pulls: 1,
      done: true,
    });
    // The mark is the sender cursor the look-back started from.
    expect(
      hub.db.getDirectDmLookbackMark(SAYBIN_GO_PEER, latest.conversationId)
    ).toBe(latest.timestamp);
  });

  it('never sends a look-back request once a live pull to the device opened while it was prepared', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    const go = makeProvider(saybin);
    await flush();
    const fromHub = dmEvent(
      saybin,
      simon,
      'hub-prepare-cursor',
      1,
      clock.now - 5 * MINUTE
    );
    go.copy(fromHub);
    hub.copy(fromHub);
    const lookbackAfter = fromHub.timestamp - LOOKBACK_WINDOW_MS;
    // Hold the look-back request while it is being signed.
    const manager = hub.manager as any;
    const buildRequest = manager.buildSignedDirectRequestWire.bind(manager);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    manager.buildSignedDirectRequestWire = async (...args: any[]) => {
      if (args[3] === lookbackAfter) await held;
      return buildRequest(...args);
    };

    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fromHub));
    expect(hub.lookbackPullState(saybin, SAYBIN_GO_PEER)).toBeDefined();
    expect(hub.accepted).toHaveLength(0);
    // A notify meanwhile: its live request goes out at once.
    clock.now += 1_000;
    const fresh = dmEvent(saybin, simon, 'prepare-live', 2, clock.now);
    go.authored(fresh);
    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fresh));
    expect(hub.accepted).toHaveLength(1);
    expect(hub.accepted[0].authMessage.a).toBe(fromHub.timestamp - 1);
    // The look-back request is ready now, but the live pull is open: it is
    // not sent, and the look-back ends (still owed). Nothing was asked of
    // the device, so no try is spent.
    release();
    await flush();
    expect(hub.accepted).toHaveLength(1);
    expect(hub.lookbackPullState(saybin, SAYBIN_GO_PEER)).toBeUndefined();
    expect(hub.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
      pulls: 0,
      done: false,
    });
    await servePage(hub, go, hub.accepted[0]);
    expect(hub.db.getDirectEvent(fresh.eventId)).not.toBeNull();
    expect(hub.accepted).toHaveLength(1);
  });

  it('spends nothing when another pull to the device is open as a pull ends', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const bob = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    await flush();
    // One device (an own Hub, say) serves Simon's conversations with Saybin
    // and with Bob.
    const fromSaybin = dmEvent(
      saybin,
      simon,
      'shared-saybin-cursor',
      1,
      clock.now - 5 * MINUTE
    );
    hub.copy(fromSaybin);
    const fromBob = dmEvent(bob, simon, 'shared-bob-new', 1, clock.now);

    // Bob's pull to that device is in flight.
    await hub.pull(bob, SAYBIN_HUB_PEER, hub.cursorOf(fromBob));
    expect(hub.accepted).toHaveLength(1);
    const bobPullKey = hub.pullState(bob, SAYBIN_HUB_PEER).key;
    // Saybin's pull ends on its shortcut: no look-back while Bob's is open,
    // and no try or interval spent on it.
    await hub.pull(saybin, SAYBIN_HUB_PEER, hub.cursorOf(fromSaybin));
    expect(hub.accepted).toHaveLength(1);
    expect(hub.lookbackState(saybin, SAYBIN_HUB_PEER)).toBeUndefined();
    expect(hub.openPullKeys(SAYBIN_HUB_PEER)).toEqual([bobPullKey]);

    // Bob's pull ends (here: given up); the next pull of Saybin's that ends
    // starts the look-back at once.
    (hub.manager as any).completeDirectDmPull(bobPullKey);
    clock.now += 1_000;
    await hub.pull(saybin, SAYBIN_HUB_PEER, hub.cursorOf(fromSaybin));
    expect(hub.accepted).toHaveLength(2);
    expect(hub.accepted[1].authMessage.a).toBe(
      fromSaybin.timestamp - LOOKBACK_WINDOW_MS
    );
    expect(hub.lookbackState(saybin, SAYBIN_HUB_PEER)).toMatchObject({
      pulls: 1,
    });
  });

  it('sends the look-back a cursor pull owes when the device has nothing after the cursor', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    const go = makeProvider(saybin);
    await flush();
    // Saybin wrote one on GO that Hub missed; Hub's cursor is a newer one
    // from Saybin's Hub, which GO does not hold.
    const missed = dmEvent(
      saybin,
      simon,
      'empty-cursor-missed',
      1,
      clock.now - 30 * MINUTE
    );
    go.authored(missed);
    go.db.markDirectDeliveryStatus(missed.eventId, 'sent');
    const fromHub = dmEvent(
      saybin,
      simon,
      'empty-cursor-hub',
      2,
      clock.now - 5 * MINUTE
    );
    hub.copy(fromHub);
    // A cursor-less re-announce: no shortcut, asked from the cursor.
    await hub.pull(saybin, SAYBIN_GO_PEER, '');
    expect(hub.accepted).toHaveLength(1);
    expect(hub.accepted[0].authMessage.a).toBe(fromHub.timestamp - 1);
    // GO has nothing after it: the cursor pull ends there, and its
    // look-back is sent at once (it does not give way to the pull it ends).
    await servePage(hub, go, hub.accepted[0]);
    expect(go.rejected.map((rejection) => rejection.reason)).toEqual([
      'no_dm_events',
    ]);
    expect(hub.pullState(saybin, SAYBIN_GO_PEER)).toBeUndefined();
    expect(hub.accepted).toHaveLength(2);
    expect(hub.accepted[1].authMessage.a).toBe(
      fromHub.timestamp - LOOKBACK_WINDOW_MS
    );
    await servePage(hub, go, hub.accepted[1]);
    expect(hub.db.getDirectEvent(missed.eventId)).not.toBeNull();
    expect(hub.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
      pulls: 1,
      done: true,
    });
  });

  it('resumes a many-page look-back after each page a live message interrupted, and completes it', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    const go = makeProvider(saybin);
    await flush();
    // 220 messages from Saybin in the last two days (five pages), held on
    // both sides but one that Hub missed, on the last page.
    const older: ReticulumDmEvent[] = [];
    for (let i = 0; i < 220; i += 1) {
      const event = dmEvent(
        saybin,
        simon,
        `pages-${String(i).padStart(3, '0')}`,
        i + 1,
        clock.now - 2 * DAY + i * 10 * MINUTE
      );
      older.push(event);
      go.copy(event);
      if (i !== 210) hub.copy(event);
    }
    const stranded = older[210];
    const cursor = older[219];
    let latest = cursor;
    // Every page request signed is sent: a look-back that gives way at its
    // next page signs nothing.
    const manager = hub.manager as any;
    const buildRequest = manager.buildSignedDirectRequestWire.bind(manager);
    let signed = 0;
    manager.buildSignedDirectRequestWire = async (...args: any[]) => {
      signed += 1;
      return buildRequest(...args);
    };

    const lookbackAfters: number[] = [];
    for (let round = 0; round < 5; round += 1) {
      const before = hub.accepted.length;
      await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(latest));
      expect(hub.accepted).toHaveLength(before + 1);
      const lookbackRequest = hub.accepted[before];
      lookbackAfters.push(lookbackRequest.authMessage.a);
      // A live message while each look-back page is on the link.
      clock.now += 1_000;
      const fresh = dmEvent(
        saybin,
        simon,
        `pages-live-${round}`,
        1_000 + round,
        clock.now
      );
      go.authored(fresh);
      await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fresh));
      expect(hub.accepted).toHaveLength(before + 2);
      // The page comes first: it gives way at its next page, keeping what
      // it imported, and is not counted as a try.
      await servePage(hub, go, lookbackRequest);
      await servePage(hub, go, hub.accepted[before + 1]);
      expect(hub.db.getDirectEvent(fresh.eventId)).not.toBeNull();
      expect(hub.accepted).toHaveLength(before + 2);
      if (round < 4) {
        expect(hub.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
          after: older[50 * round + 49].timestamp,
          pulls: 0,
          done: false,
        });
      }
      latest = fresh;
      clock.now += 30_000;
    }
    // Each try resumed after the last page the one before imported.
    expect(lookbackAfters).toEqual([
      cursor.timestamp - LOOKBACK_WINDOW_MS,
      older[49].timestamp,
      older[99].timestamp,
      older[149].timestamp,
      older[199].timestamp,
    ]);
    expect(hub.db.getDirectEvent(stranded.eventId)).not.toBeNull();
    expect(hub.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
      cursor: cursor.timestamp,
      pulls: 1,
      done: true,
    });
    // The mark is the sender cursor the look-back started from.
    expect(
      hub.db.getDirectDmLookbackMark(SAYBIN_GO_PEER, cursor.conversationId)
    ).toBe(cursor.timestamp);
    expect(signed).toBe(hub.accepted.length);
    // Done for the process: a later pull asks nothing more.
    const sent = hub.accepted.length;
    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(latest));
    expect(hub.accepted).toHaveLength(sent);
  });

  it('spends no try when it gave way before its request left', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    const go = makeProvider(saybin);
    await flush();
    const missed = dmEvent(
      saybin,
      simon,
      'signing-missed',
      1,
      clock.now - 30 * MINUTE
    );
    go.authored(missed);
    go.db.markDirectDeliveryStatus(missed.eventId, 'sent');
    let latest = dmEvent(
      saybin,
      simon,
      'signing-cursor',
      2,
      clock.now - 5 * MINUTE
    );
    go.copy(latest);
    hub.copy(latest);
    const lookbackAfter = latest.timestamp - LOOKBACK_WINDOW_MS;
    // Each look-back request is held while it is being signed.
    const manager = hub.manager as any;
    const buildRequest = manager.buildSignedDirectRequestWire.bind(manager);
    const releases: Array<() => void> = [];
    manager.buildSignedDirectRequestWire = async (...args: any[]) => {
      if (args[3] === lookbackAfter) {
        await new Promise<void>((resolve) => releases.push(resolve));
      }
      return buildRequest(...args);
    };

    // Three times, a live notify opens a pull while it is signed: it gives
    // way before anything was asked of GO.
    for (let round = 0; round < 3; round += 1) {
      await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(latest));
      expect(releases).toHaveLength(1);
      clock.now += 1_000;
      const fresh = dmEvent(
        saybin,
        simon,
        `signing-live-${round}`,
        10 + round,
        clock.now
      );
      go.authored(fresh);
      await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fresh));
      releases.shift()!();
      await flush();
      expect(hub.lookbackPullState(saybin, SAYBIN_GO_PEER)).toBeUndefined();
      expect(hub.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
        pulls: 0,
        done: false,
      });
      await servePage(hub, go, hub.accepted.at(-1)!);
      expect(hub.db.getDirectEvent(fresh.eventId)).not.toBeNull();
      latest = fresh;
      clock.now += 30_000;
    }
    expect(
      hub.accepted.filter((request) => request.authMessage.a === lookbackAfter)
    ).toEqual([]);

    // A quiet moment: the source is not given up, and the look-back runs.
    manager.buildSignedDirectRequestWire = buildRequest;
    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(latest));
    expect(hub.accepted.at(-1)!.authMessage.a).toBe(lookbackAfter);
    await servePage(hub, go, hub.accepted.at(-1)!);
    expect(hub.db.getDirectEvent(missed.eventId)).not.toBeNull();
    expect(hub.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
      pulls: 1,
      done: true,
    });
  });

  it('never looks back for Saved Messages or our own cursor', async () => {
    clock.now = Date.now();
    const simon = identity();
    const saybin = identity();
    const hub = makeRequester(simon);
    await flush();
    const own = dmEvent(
      simon,
      saybin,
      'simon-own-cursor',
      1,
      clock.now - MINUTE
    );
    expect(
      (hub.manager as any).acceptDirectEvent(own, true, {
        deliveryStatus: 'pending',
      })
    ).toBe(true);
    // A notify about the conversation authored by our own account (an own
    // device): its cursor is ours, not a remote sender's.
    (hub.manager as any).queueDirectMissingEvents({
      conversationId: own.conversationId,
      addressA: simon.address,
      addressB: saybin.address,
      sourcePeerHash: SAYBIN_HUB_PEER,
      remoteEventId: `cursor:${hub.cursorOf(own)}`,
      remoteTimestamp: Number.MAX_SAFE_INTEGER,
      requestId: 'e'.repeat(16),
    });
    await flush();
    expect(hub.accepted).toHaveLength(0);
    expect((hub.manager as any).directDmLookbacks.size).toBe(0);
  });
});

describe('a DM page request whose pull or account went away while it was signed', () => {
  /** Holds every page request after it is signed, until the returned call. */
  const holdSignedRequests = (hub: ReturnType<typeof makeRequester>) => {
    const manager = hub.manager as any;
    const buildRequest = manager.buildSignedDirectRequestWire.bind(manager);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    manager.buildSignedDirectRequestWire = async (...args: any[]) => {
      const request = await buildRequest(...args);
      await held;
      return request;
    };
    return () => release();
  };

  const setup = async (kind: 'look-back' | 'cursor') => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    await flush();
    const fromHub = dmEvent(
      saybin,
      simon,
      `held-${kind}-cursor`,
      1,
      clock.now - 5 * MINUTE
    );
    hub.copy(fromHub);
    const release = holdSignedRequests(hub);
    // A pull that ends on its shortcut starts the look-back; a cursor-less
    // re-announce pulls from the cursor.
    await hub.pull(
      saybin,
      SAYBIN_GO_PEER,
      kind === 'look-back' ? hub.cursorOf(fromHub) : ''
    );
    expect(hub.openPullKeys(SAYBIN_GO_PEER)).toHaveLength(1);
    expect(hub.accepted).toHaveLength(0);
    return { saybin, simon, hub, fromHub, release };
  };

  for (const kind of ['look-back', 'cursor'] as const) {
    it(`sends no ${kind} request signed for an account switched away meanwhile`, async () => {
      const { hub, release } = await setup(kind);
      hub.manager.setLocalDmAddresses([identity().address]);
      expect(hub.openPullKeys(SAYBIN_GO_PEER)).toEqual([]);
      release();
      await flush();
      expect(hub.accepted).toHaveLength(0);
      expect((hub.manager as any).directDmPageRequests.size).toBe(0);
    });

    it(`sends no ${kind} request once Reticulum chat was turned off meanwhile`, async () => {
      const { hub, release } = await setup(kind);
      // No account boundary: the pull stays, the local address is gone.
      hub.manager.setLocalDmAddresses([]);
      release();
      await flush();
      expect(hub.accepted).toHaveLength(0);
      expect((hub.manager as any).directDmPageRequests.size).toBe(0);
    });

    it(`sends no ${kind} request for a pull dropped meanwhile`, async () => {
      const { hub, release } = await setup(kind);
      const [key] = hub.openPullKeys(SAYBIN_GO_PEER);
      (hub.manager as any).completeDirectDmPull(key);
      release();
      await flush();
      expect(hub.accepted).toHaveLength(0);
      expect((hub.manager as any).directDmPageRequests.size).toBe(0);
    });
  }

  it("sends only the new account's request after switching away and back", async () => {
    const { saybin, hub, fromHub, release } = await setup('look-back');
    const [key] = hub.openPullKeys(SAYBIN_GO_PEER);
    const simonAddress = hub.manager.getLocalDmAddresses()[0];
    hub.manager.setLocalDmAddresses([identity().address]);
    hub.manager.setLocalDmAddresses([simonAddress]);
    // The same look-back starts again under the new session, same pull key.
    await hub.pull(saybin, SAYBIN_GO_PEER, hub.cursorOf(fromHub));
    expect(hub.openPullKeys(SAYBIN_GO_PEER)).toEqual([key]);
    release();
    await flush();
    expect(hub.accepted).toHaveLength(1);
    expect(hub.accepted[0].authMessage.a).toBe(
      fromHub.timestamp - LOOKBACK_WINDOW_MS
    );
    expect((hub.manager as any).directDmPageRequests.size).toBe(1);
  });
});

describe('a delivered page whose outcome never reached the provider', () => {
  it('re-announces a pending head without its cursor now and then, so a requester that holds it pulls it again', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    // Simon on a build without the look-back (Hub 3.0.3, GO v0.0.14).
    const hub = makeRequester(simon);
    (hub.manager as any).startDirectDmLookback = () => false;
    const go = makeProvider(saybin, SAYBIN_GO_PEER, { signer: true });
    await flush();
    const g1 = dmEvent(
      saybin,
      simon,
      'go-lost-proof',
      1,
      clock.now - 30 * MINUTE
    );
    go.authored(g1);
    const sweep = async (): Promise<DmNotifyWire> => {
      const before = go.notifies().length;
      await (go.manager as any).runDmPendingDeliverySweep();
      const notify = go
        .notifies()
        .slice(before)
        .filter((wire) => wire.d.b === simon.address)
        .at(-1);
      expect(notify).toBeDefined();
      expect(verifyReticulumDmNotify(notify!.d, clock.now)).toBe(true);
      return notify!;
    };

    // Simon pulls and imports g1, but GO's bridge reports the transfer
    // failed (the RNS proof was lost): g1 stays pending on the phone.
    await hub.pull(saybin, SAYBIN_GO_PEER, '');
    expect(hub.accepted).toHaveLength(1);
    await servePage(hub, go, hub.accepted[0]);
    expect(hub.db.getDirectEvent(g1.eventId)).not.toBeNull();
    go.failed(String(hub.accepted[0].transferId), 'resource_failed');
    expect(go.status(g1.eventId)).toBe('pending');

    // Re-announces 1-3 name the head as `lc`: Simon (and any other device
    // that holds it, such as Saybin's own Hub) ends its pull on "I hold it".
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const notify = await sweep();
      expect(notify.d.lc).toBe(hub.cursorOf(g1));
      await (hub.manager as any).handleDirectNotify(notify, SAYBIN_GO_PEER);
      await flush();
      expect(hub.accepted).toHaveLength(1);
      clock.now += 7 * MINUTE;
    }

    // Re-announce 4 leaves `lc` out: Simon pulls from his cursor, the phone
    // serves g1 again and its delivery settles it.
    const notify = await sweep();
    expect(notify.d.lc).toBeUndefined();
    await (hub.manager as any).handleDirectNotify(notify, SAYBIN_GO_PEER);
    await flush();
    expect(hub.accepted).toHaveLength(2);
    expect(hub.accepted[1].authMessage.a).toBe(g1.timestamp - 1);
    const page = await servePage(hub, go, hub.accepted[1]);
    expect(go.pageEventIds(page!)).toEqual([g1.eventId]);
    go.delivered(String(hub.accepted[1].transferId));
    expect(go.status(g1.eventId)).toBe('sent');
  });

  it('leaves the cursor out of re-announces 4, 8 and 16 only', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const go = makeProvider(saybin, SAYBIN_GO_PEER, { signer: true });
    await flush();
    const g1 = dmEvent(
      saybin,
      simon,
      'go-cursor-pattern',
      1,
      clock.now - 20 * MINUTE
    );
    go.authored(g1);
    const cursorLess: number[] = [];
    for (let attempt = 1; attempt <= 16; attempt += 1) {
      const before = go.notifies().length;
      await (go.manager as any).runDmPendingDeliverySweep();
      const notify = go
        .notifies()
        .slice(before)
        .filter((wire) => wire.d.b === simon.address)
        .at(-1);
      expect(notify).toBeDefined();
      if (notify!.d.lc === undefined) cursorLess.push(attempt);
      clock.now += 6.5 * MINUTE;
    }
    expect(cursorLess).toEqual([4, 8, 16]);
  });

  it("marks a pending head delivered when the recipient's own notify names it as its newest", async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    const go = makeProvider(saybin);
    await flush();
    const g1 = dmEvent(
      saybin,
      simon,
      'go-held-head',
      1,
      clock.now - 30 * MINUTE
    );
    go.authored(g1);
    hub.copy(g1);
    const answer = async (latest: ReticulumDmEvent) => {
      const wire = (await (hub.manager as any).buildSignedDirectNotifyWire(
        saybin.address,
        simon.address,
        latest
      )) as DmNotifyWire;
      expect(wire).not.toBeNull();
      await (go.manager as any).handleDirectNotify(wire, SIMON_HUB_PEER);
      await flush();
    };

    // Simon's newest is another event: says nothing about g1.
    const s1 = dmEvent(simon, saybin, 'simon-newer', 1, clock.now - MINUTE);
    hub.copy(s1);
    await answer(s1);
    expect(go.status(g1.eventId)).toBe('pending');

    // Simon (signed) names g1 as his newest: he holds it.
    await answer(g1);
    expect(go.status(g1.eventId)).toBe('sent');
    expect(go.manager.getDeliveryCounters()).toMatchObject({
      dmPendingHeldByRecipient: 1,
    });
  });

  it('marks only the head the recipient names: an older pending own event stays pending until a page carries it', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    (hub.manager as any).startDirectDmLookback = () => false;
    const go = makeProvider(saybin, SAYBIN_GO_PEER, { signer: true });
    await flush();
    // h0 written on the phone never reached Simon; m, written on Saybin's
    // Hub, moved Simon's cursor past it; h, written on the phone, reached
    // Simon through Saybin's Hub.
    const h0 = dmEvent(
      saybin,
      simon,
      'go-stranded',
      1,
      clock.now - 30 * MINUTE
    );
    const m = dmEvent(saybin, simon, 'hub-cursor', 2, clock.now - 20 * MINUTE);
    const h = dmEvent(saybin, simon, 'go-newest', 3, clock.now - 10 * MINUTE);
    go.authored(h0);
    go.copy(m);
    go.authored(h);
    hub.copy(m);
    hub.copy(h);

    // Simon's signed notify names h as his newest: h is delivered. It says
    // nothing about h0, which stays pending (and shows as such).
    const wire = (await (hub.manager as any).buildSignedDirectNotifyWire(
      saybin.address,
      simon.address,
      h
    )) as DmNotifyWire;
    expect(wire.d.lc).toBe(hub.cursorOf(h));
    await (go.manager as any).handleDirectNotify(wire, SIMON_HUB_PEER);
    await flush();
    expect(go.status(h.eventId)).toBe('sent');
    expect(go.status(h0.eventId)).toBe('pending');
    expect(go.manager.getDeliveryCounters()).toMatchObject({
      dmPendingHeldByRecipient: 1,
    });

    // h0 is the pending head now. Its re-announce names it, which Simon
    // lacks: he pulls from his cursor, the page carries h0 (passed, pending)
    // and its delivery settles it.
    const before = go.notifies().length;
    await (go.manager as any).runDmPendingDeliverySweep();
    const notify = go
      .notifies()
      .slice(before)
      .filter((entry) => entry.d.b === simon.address)
      .at(-1);
    expect(notify).toBeDefined();
    expect(notify!.d.lc).toBe(hub.cursorOf(h0));
    await (hub.manager as any).handleDirectNotify(notify, SAYBIN_GO_PEER);
    await flush();
    expect(hub.accepted).toHaveLength(1);
    const page = await servePage(hub, go, hub.accepted[0]);
    expect(go.pageEventIds(page!)).toEqual([h0.eventId, h.eventId]);
    expect(hub.db.getDirectEvent(h0.eventId)).not.toBeNull();
    expect(go.status(h0.eventId)).toBe('pending');
    go.delivered(String(hub.accepted[0].transferId));
    expect(go.status(h0.eventId)).toBe('sent');
  });

  it('never settles an own event older than the page window through a newer one', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const hub = makeRequester(simon);
    (hub.manager as any).startDirectDmLookback = () => false;
    const go = makeProvider(saybin);
    await flush();
    // r, written on the phone 8 days ago, never reached Simon; h did.
    const r = dmEvent(saybin, simon, 'go-stranded-8d', 1, clock.now - 8 * DAY);
    const h = dmEvent(saybin, simon, 'go-recent', 2, clock.now - 30 * MINUTE);
    go.authored(r);
    go.authored(h);
    hub.copy(h);

    // Simon's notify proves h only.
    const wire = (await (hub.manager as any).buildSignedDirectNotifyWire(
      saybin.address,
      simon.address,
      h
    )) as DmNotifyWire;
    await (go.manager as any).handleDirectNotify(wire, SIMON_HUB_PEER);
    await flush();
    expect(go.status(h.eventId)).toBe('sent');
    expect(go.status(r.eventId)).toBe('pending');

    // A delivered page from Simon's cursor does not carry r (past the
    // window a page re-serves passed pending events from): r stays pending.
    await hub.pull(saybin, SAYBIN_GO_PEER, '');
    expect(hub.accepted).toHaveLength(1);
    const page = await servePage(hub, go, hub.accepted[0]);
    expect(go.pageEventIds(page!)).toEqual([h.eventId]);
    go.delivered(String(hub.accepted[0].transferId));
    expect(go.status(r.eventId)).toBe('pending');
    expect(hub.db.getDirectEvent(r.eventId)).toBeNull();
  });
});

describe('a completed look-back is remembered across processes', () => {
  const endProcess = (manager: ReticulumChatManager) => {
    managers.splice(managers.indexOf(manager), 1);
    manager.close();
  };

  it('skips the look-back while the cursor has not moved, then asks only from the last one', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const dbPath = path.join(
      tempDir('rchat-dm-requester-'),
      'reticulum-chat.db'
    );
    const go = makeProvider(saybin);
    await flush();
    const fromHub = dmEvent(
      saybin,
      simon,
      'hub-mark-cursor',
      1,
      clock.now - 3 * DAY
    );
    go.copy(fromHub);

    // First process: the look-back runs and completes.
    const first = makeRequester(simon, SIMON_HUB_PEER, dbPath);
    first.copy(fromHub);
    await first.pull(saybin, SAYBIN_GO_PEER, first.cursorOf(fromHub));
    expect(first.accepted).toHaveLength(1);
    expect(first.accepted[0].authMessage.a).toBe(
      fromHub.timestamp - LOOKBACK_WINDOW_MS
    );
    await servePage(first, go, first.accepted[0]);
    expect(first.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
      done: true,
    });
    endProcess(first.manager);

    // Second process, cursor unchanged: nothing to look back for.
    clock.now += MINUTE;
    const second = makeRequester(simon, SIMON_HUB_PEER, dbPath);
    await second.pull(saybin, SAYBIN_GO_PEER, second.cursorOf(fromHub));
    expect(second.accepted).toHaveLength(0);
    expect(second.lookbackState(saybin, SAYBIN_GO_PEER)).toMatchObject({
      done: true,
      pulls: 0,
    });
    expect(second.manager.getDeliveryCounters()).toMatchObject({
      dmLookbackSkipped: 1,
    });
    // A newer message from Saybin's Hub moves the cursor.
    const later = dmEvent(saybin, simon, 'hub-mark-later', 2, clock.now);
    go.copy(later);
    second.copy(later);
    endProcess(second.manager);

    // Third process: it looks back only from the first look-back's cursor
    // (minus the margin), not a full window behind the new cursor.
    clock.now += MINUTE;
    const third = makeRequester(simon, SIMON_HUB_PEER, dbPath);
    await third.pull(saybin, SAYBIN_GO_PEER, third.cursorOf(later));
    expect(third.accepted).toHaveLength(1);
    expect(third.accepted[0].authMessage.a).toBe(
      fromHub.timestamp - LOOKBACK_MARK_MARGIN_MS
    );
  });
});

describe('DM page provider latency: stage timings, ended and stale requests', () => {
  const captureLogs = (): string[] => {
    const logs: string[] = [];
    const push = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    vi.spyOn(console, 'log').mockImplementation(push);
    vi.spyOn(console, 'warn').mockImplementation(push);
    return logs;
  };

  /** The Android bridge's 'auth' event for a signed DM page request. */
  const dmAuth = (
    owner: Identity,
    requester: Identity,
    transferId: string,
    extra: Record<string, unknown> = {}
  ) => {
    const timestamp = clock.now;
    const signedFields = buildReticulumDmRequestSignedFields({
      peerAddress: owner.address,
      after: 0,
      limit: 50,
      requesterPeerHash: SIMON_HUB_PEER,
      requestId: transferId,
      authorAddress: requester.address,
      authorPublicKey: requester.publicKey,
      timestamp,
    });
    return {
      status: 'auth',
      linkId: `link-${transferId}`,
      transferId,
      peerPresenceHash: SIMON_HUB_PEER,
      resourceType: 'reticulum_chat_event',
      metadata: {
        resourceType: 'reticulum_chat_event',
        logicalResourceType: 'reticulum_chat_dm_page',
      },
      auth: {
        type: 'RETICULUM_CHAT_DM_PAGE_REQUEST',
        transferId,
        b: owner.address,
        a: 0,
        l: 50,
        q: transferId,
        rp: SIMON_HUB_PEER,
        p: requester.publicKey,
        n: timestamp,
        z: sign(signedFields, requester),
      },
      ...extra,
    } as any;
  };

  /** The Android bridge's 'auth_ended' for the same request. */
  const authEnded = (
    transferId: string,
    reason = 'resource_session_link_closed'
  ) =>
    ({
      status: 'auth_ended',
      linkId: `link-${transferId}`,
      transferId,
      peerPresenceHash: SIMON_HUB_PEER,
      resourceType: 'reticulum_chat_event',
      reason,
      metadata: { logicalResourceType: 'reticulum_chat_dm_page' },
      arrivedAtMs: clock.now - 100,
      authStartedAtMs: clock.now - 90,
    }) as any;

  /** What the bridge emits reaches the engine's resource queue. */
  const emitResource = (
    provider: ReturnType<typeof makeProvider>,
    payload: Record<string, unknown>
  ) =>
    ((provider.manager as any).bridge as EventEmitter).emit(
      'reticulum-chat-resource',
      payload
    );

  /** Run `before` inside the page build (the engine's busy part). */
  const duringBuild = (
    provider: ReturnType<typeof makeProvider>,
    before: () => void
  ) => {
    const manager = provider.manager as any;
    const build = manager.buildDirectDmPageResourceBlob.bind(manager);
    manager.buildDirectDmPageResourceBlob = (...args: unknown[]) => {
      before();
      return build(...args);
    };
  };

  it('breaks the authorize down by stage in its log lines, n/a where the bridge sent no stamps', async () => {
    clock.now = Date.now();
    const T = clock.now;
    const saybin = identity();
    const simon = identity();
    const go = makeProvider(saybin);
    await flush();
    go.authored(dmEvent(saybin, simon, 'go-dm-timing', 1, T - MINUTE));
    const logs = captureLogs();
    duringBuild(go, () => {
      clock.now += 7;
    });
    const bridge = (go.manager as any).bridge;
    const register = bridge.sendReticulumChatResourceDetailed;
    bridge.sendReticulumChatResourceDetailed = async (payload: any) => {
      clock.now += 30;
      return register(payload);
    };
    const authorize = bridge.authorizeReticulumChatResourceDetailed;
    bridge.authorizeReticulumChatResourceDetailed = async (payload: any) => {
      clock.now += 20;
      return authorize(payload);
    };

    // The Android bridge and the GO worker stamped the request on its way.
    go.manager.handleResourceEvent(
      dmAuth(saybin, simon, 'd1'.repeat(8), {
        requestedAtMs: T - 2_000,
        arrivedAtMs: T - 1_500,
        authStartedAtMs: T - 1_400,
        _pyQueuedAtMs: T - 1_390,
        _pyWriteAtMs: T - 1_300,
        _workerRecvAtMs: T - 1_250,
        linkRttMs: 412.6,
        slotWaitMs: 3,
        pendingAuthTotal: 2,
        pendingAuthPeer: 1,
      }),
      { receivedAt: T - 1_200 }
    );
    await flush();
    const authorized = logs.find((line) =>
      line.includes('dm_page_link_authorized')
    );
    expect(authorized).toBeDefined();
    // The existing fields keep their meaning.
    expect(authorized).toContain(`peer=${SIMON_HUB_PEER.slice(0, 16)}`);
    expect(authorized).toContain(`transfer=${'d1'.repeat(8)}`);
    expect(authorized).toContain(' auth_ms=1257 ');
    expect(authorized).toContain(' events=1 more=false ');
    for (const field of [
      'total_ms=1557',
      'py_pre_ms=100',
      'py_q_ms=90',
      'xport_ms=50',
      'eq_ms=1200',
      'build_ms=7',
      'reg_ms=30',
      'authz_ms=20',
      'req_lag_ms=500',
      'rtt_ms=413',
    ]) {
      expect(authorized).toMatch(new RegExp(` ${field}( |$)`));
    }

    // A desktop bridge stamps nothing: those fields say n/a.
    clock.now = T + 10_000;
    go.setAuthorize({ ok: false, reason: 'unknown-link-id' });
    go.manager.handleResourceEvent(dmAuth(saybin, simon, 'd2'.repeat(8)), {
      receivedAt: clock.now - 300,
    });
    await flush();
    const failed = logs.find((line) =>
      line.includes('dm_page_link_authorize_failed')
    );
    expect(failed).toBeDefined();
    expect(failed).toContain(`peer=${SIMON_HUB_PEER.slice(0, 16)}`);
    expect(failed).toContain(' auth_ms=357 ');
    expect(failed).toContain(' reason=unknown-link-id ');
    for (const field of [
      'total_ms=n/a',
      'py_pre_ms=n/a',
      'py_q_ms=n/a',
      'xport_ms=n/a',
      'eq_ms=300',
      'build_ms=7',
      'reg_ms=30',
      'authz_ms=20',
      'req_lag_ms=n/a',
      'rtt_ms=n/a',
    ]) {
      expect(failed).toMatch(new RegExp(` ${field}( |$)`));
    }
  });

  it('drops a queued DM page auth the bridge already ended: no bridge call at all', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const go = makeProvider(saybin);
    await flush();
    go.authored(dmEvent(saybin, simon, 'go-dm-ended', 1, clock.now - MINUTE));
    const logs = captureLogs();
    const ended = 'e1'.repeat(8);
    const live = 'e2'.repeat(8);

    // Both auths are still queued when the link to the first one closes.
    emitResource(go, dmAuth(saybin, simon, ended));
    emitResource(go, dmAuth(saybin, simon, live));
    emitResource(go, authEnded(ended));
    await flush();
    expect(go.pages.map((page) => page.transferId)).toEqual([live]);
    expect(go.authorizeCalls.map((call) => call.transferId)).toEqual([live]);
    expect(go.rejected).toEqual([]);
    const counters = go.manager.getDeliveryCounters();
    expect(counters).toMatchObject({
      providerAuthEnded: 1,
      providerAuthEnded_resource_session_link_closed: 1,
      providerAuthEndedQueuedDropped: 1,
    });
    expect(counters.dmPageAuthSkipped).toBeUndefined();

    // The same auth seen again afterwards is skipped before any work.
    go.manager.handleResourceEvent(dmAuth(saybin, simon, ended), {
      receivedAt: clock.now,
    });
    await flush();
    expect(go.pages).toHaveLength(1);
    expect(go.authorizeCalls).toHaveLength(1);
    expect(go.rejected).toEqual([]);
    expect(
      logs.find((line) => line.includes('dm_page_link_skipped'))
    ).toContain(
      `transfer=${ended} peer=${SIMON_HUB_PEER.slice(0, 16)} reason=auth_ended stage=entry age_ms=n/a`
    );
    expect(go.manager.getDeliveryCounters()).toMatchObject({
      dmPageAuthSkipped: 1,
      dmPageAuthSkipped_auth_ended: 1,
    });
  });

  it('stages nothing for a DM page whose request ended while the page was built', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const go = makeProvider(saybin);
    await flush();
    go.authored(
      dmEvent(saybin, simon, 'go-dm-midserve', 1, clock.now - MINUTE)
    );
    const logs = captureLogs();
    const transferId = 'f1'.repeat(8);
    duringBuild(go, () => emitResource(go, authEnded(transferId)));
    const staged = vi.spyOn(go.manager as any, 'tryWriteTempEventBlob');
    go.manager.handleResourceEvent(
      dmAuth(saybin, simon, transferId, {
        arrivedAtMs: clock.now - 60,
        authStartedAtMs: clock.now - 50,
      }),
      { receivedAt: clock.now }
    );
    await flush();
    expect(staged).not.toHaveBeenCalled();
    expect(go.pages).toEqual([]);
    expect(go.authorizeCalls).toEqual([]);
    expect(go.rejected).toEqual([]);
    expect(
      logs.find((line) => line.includes('dm_page_link_skipped'))
    ).toContain(`transfer=${transferId}`);
    expect(
      logs.find((line) => line.includes('dm_page_link_skipped'))
    ).toContain('reason=auth_ended stage=pre_stage age_ms=50');
    expect(go.manager.getDeliveryCounters()).toMatchObject({
      dmPageAuthSkipped_auth_ended: 1,
    });
  });

  it('skips a DM page whose bridge waiter is about to give up, and serves one well inside its window', async () => {
    clock.now = Date.now();
    const T = clock.now;
    const saybin = identity();
    const simon = identity();
    const go = makeProvider(saybin);
    await flush();
    go.authored(dmEvent(saybin, simon, 'go-dm-stale', 1, T - MINUTE));
    const logs = captureLogs();
    const ask = async (
      transferId: string,
      stamps: Record<string, unknown>,
      receivedAt = T
    ) => {
      go.manager.handleResourceEvent(
        dmAuth(saybin, simon, transferId, stamps),
        {
          receivedAt,
        }
      );
      await flush();
    };
    const served = () => go.authorizeCalls.map((call) => call.transferId);
    const window = RETICULUM_CHAT_PROVIDER_AUTH_WINDOW_MS;
    expect(window).toBe(15_000);

    // 15 s after the bridge emitted it: its waiter has given up.
    await ask('a0'.repeat(8), {
      arrivedAtMs: T - 15_100,
      authStartedAtMs: T - 15_000,
    });
    // 250 ms before the end of the window is too late as well.
    await ask('a1'.repeat(8), { authStartedAtMs: T - (window - 250) });
    // Without the emit stamp, the arrival stamp counts.
    await ask('a2'.repeat(8), { arrivedAtMs: T - 15_000 });
    expect(go.pages).toEqual([]);
    expect(go.authorizeCalls).toEqual([]);
    expect(go.rejected).toEqual([]);
    expect(go.manager.getDeliveryCounters()).toMatchObject({
      dmPageAuthSkipped: 3,
      dmPageAuthSkipped_auth_stale: 3,
    });
    expect(
      logs.filter((line) => line.includes('dm_page_link_skipped'))
    ).toEqual([
      expect.stringContaining(
        `transfer=${'a0'.repeat(8)} peer=${SIMON_HUB_PEER.slice(0, 16)} reason=auth_stale stage=entry age_ms=15000`
      ),
      expect.stringContaining('reason=auth_stale stage=entry age_ms=14750'),
      expect.stringContaining('reason=auth_stale stage=entry age_ms=15000'),
    ]);

    // Inside the window it is served. The emit stamp wins over an early
    // arrival (the waiter starts at the emit).
    await ask('b0'.repeat(8), { authStartedAtMs: T - (window - 251) });
    await ask('b1'.repeat(8), {
      arrivedAtMs: T - 20_000,
      authStartedAtMs: T - 5_000,
    });
    // A desktop bridge stamps nothing: never stale here, however late.
    await ask('b2'.repeat(8), {}, T - 20_000);
    expect(served()).toEqual(['b0'.repeat(8), 'b1'.repeat(8), 'b2'.repeat(8)]);

    // A page that took the rest of the window to build is not staged.
    duringBuild(go, () => {
      clock.now += 1_000;
    });
    await ask('c0'.repeat(8), { authStartedAtMs: T - 14_000 });
    expect(served()).toHaveLength(3);
    expect(go.pages).toHaveLength(3);
    expect(
      logs.filter((line) => line.includes('dm_page_link_skipped')).at(-1)
    ).toContain(
      `transfer=${'c0'.repeat(8)} peer=${SIMON_HUB_PEER.slice(0, 16)} reason=auth_stale stage=pre_stage age_ms=15000`
    );
  });

  it('purges a queued history page serve the bridge ended, without a reject', async () => {
    const start = Date.now();
    let now = start;
    let resolveMembership: ((value: boolean) => void) | undefined;
    const membership = new Promise<boolean>((resolve) => {
      resolveMembership = resolve;
    });
    const authorized: Array<Record<string, any>> = [];
    const registered: Array<Record<string, any>> = [];
    const rejected: Array<Record<string, any>> = [];
    const bridge = Object.assign(new EventEmitter(), {
      getLocalDestinationHash: () => SAYBIN_GO_PEER,
      sendReticulumChatResourceDetailed: async (payload: any) => {
        registered.push(payload);
        return { ok: true as const };
      },
      authorizeReticulumChatResourceDetailed: async (payload: any) => {
        authorized.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (payload: any) => {
        rejected.push(payload);
        return { ok: true as const };
      },
    });
    const manager = new ReticulumChatManager({
      dbPath: path.join(tempDir('rchat-history-ended-'), 'reticulum-chat.db'),
      bridge: bridge as any,
      now: () => now,
      validateGroupMember: async () => membership,
    });
    managers.push(manager);
    const groupId = 69;
    const author = identity();
    const event: ReticulumChatEvent = {
      eventId: 'history-ended-event',
      groupId,
      channelId: 'general',
      authorAddress: author.address,
      authorPublicKey: author.publicKey,
      authorStreamId: 'f'.repeat(32),
      authorSeq: 1,
      timestamp: start - 20_000,
      eventType: 'message',
      encryptedPayload: 'ciphertext',
      payloadHash: hashReticulumChatPayload('ciphertext'),
      mentionAddressHashes: [],
      signature: '',
    };
    event.signature = sign(buildReticulumChatSignedFields(event), author);
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    const historyAuth = (transferId: string) => {
      const requester = identity();
      const cursor = { id: event.eventId, ts: event.timestamp };
      const fields = buildReticulumChatHistoryPageRequestSignedFields({
        groupId,
        channelId: '*',
        direction: 'before',
        before: cursor,
        includeCursor: true,
        limit: 100,
        authorAddress: requester.address,
        authorPublicKey: requester.publicKey,
        timestamp: start,
      });
      return {
        type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
        transferId,
        groupId,
        c: '*',
        d: 'before',
        before: cursor,
        inc: 1,
        limit: 100,
        a: requester.address,
        pk: requester.publicKey,
        ts: start,
        sig: sign(fields, requester),
      };
    };
    // Four serves wait on a slow membership check; the fifth is queued.
    for (let index = 0; index < 5; index += 1) {
      const transferId = `history-ended-${index}`;
      bridge.emit('reticulum-chat-resource', {
        status: 'auth',
        linkId: `link-${index}`,
        transferId,
        peerPresenceHash: String(index + 1).repeat(32),
        resourceType: 'reticulum_chat_event',
        auth: historyAuth(transferId),
      });
    }
    await vi.waitUntil(() => (manager as any).historyPageServeActive === 4, {
      timeout: 1_000,
    });
    expect((manager as any).historyPageServeQueue).toHaveLength(1);
    expect(
      [
        ...(
          (manager as any).historyPageServePendingBySemanticKey as Map<
            string,
            string
          >
        ).values(),
      ].sort()
    ).toContain('history-ended-4');

    // The bridge's waiter for the queued one timed out (it answered the
    // requester itself): the serve leaves the queue, nothing is rejected.
    bridge.emit('reticulum-chat-resource', {
      status: 'auth_ended',
      linkId: 'link-4',
      transferId: 'history-ended-4',
      peerPresenceHash: '5'.repeat(32),
      resourceType: 'reticulum_chat_event',
      reason: 'resource_authorization_timeout',
      metadata: { logicalResourceType: 'reticulum_chat_history_page' },
    });
    expect((manager as any).historyPageServeQueue).toHaveLength(0);
    expect([
      ...(
        (manager as any).historyPageServePendingBySemanticKey as Map<
          string,
          string
        >
      ).values(),
    ]).not.toContain('history-ended-4');
    expect(manager.getDeliveryCounters()).toMatchObject({
      providerAuthEnded: 1,
      providerAuthEnded_resource_authorization_timeout: 1,
      providerAuthEndedHistoryDropped: 1,
    });
    // Its window passing later sheds nothing either.
    now = start + RETICULUM_CHAT_PROVIDER_AUTH_WINDOW_MS + 1;
    (manager as any).processHistoryPageServeQueue();
    await flush();
    expect(rejected).toEqual([]);

    // The four active serves are unaffected.
    now = start;
    resolveMembership?.(true);
    await vi.waitUntil(() => authorized.length === 4, { timeout: 1_000 });
    expect(authorized.map((item) => item.transferId).sort()).toEqual([
      'history-ended-0',
      'history-ended-1',
      'history-ended-2',
      'history-ended-3',
    ]);
    expect(registered.map((item) => item.transferId)).not.toContain(
      'history-ended-4'
    );
    expect(rejected).toEqual([]);
  });

  it('answers a DM page whose authorize threw with the bridge default refusal at once', async () => {
    clock.now = Date.now();
    const saybin = identity();
    const simon = identity();
    const go = makeProvider(saybin);
    await flush();
    go.authored(dmEvent(saybin, simon, 'go-dm-throws', 1, clock.now - MINUTE));
    const logs = captureLogs();
    const db = (go.manager as any).db;
    db.getDirectEventsAfter = () => {
      throw new Error('database is locked');
    };
    const transferId = 'ab'.repeat(8);
    go.manager.handleResourceEvent(dmAuth(saybin, simon, transferId), {
      receivedAt: clock.now,
    });
    await flush();
    expect(go.rejected).toEqual([
      {
        linkId: `link-${transferId}`,
        transferId,
        reason: 'resource_request_rejected',
        logicalResourceType: 'reticulum_chat_dm_page',
      },
    ]);
    expect(go.authorizeCalls).toEqual([]);
    const line = logs.find((entry) =>
      entry.includes('provider_authorize_exception')
    );
    expect(line).toContain(`transfer=${transferId}`);
    expect(line).toContain(`peer=${SIMON_HUB_PEER.slice(0, 16)}`);
    expect(line).toContain('type=dm_page');
    expect(line).toContain('reason=database is locked');
    expect(go.manager.getDeliveryCounters()).toMatchObject({
      providerAuthorizeException: 1,
    });

    // Another resource whose authorize throws is only logged.
    (go.manager as any).authorizeLinkedEventResource = async () => {
      throw new Error('boom');
    };
    go.manager.handleResourceEvent({
      status: 'auth',
      linkId: 'link-linked',
      transferId: 'cd'.repeat(8),
      peerPresenceHash: SIMON_HUB_PEER,
      auth: { type: 'RETICULUM_CHAT_LINKED_EVENT_REQUEST' },
    } as any);
    await flush();
    expect(go.rejected).toHaveLength(1);
    expect(go.manager.getDeliveryCounters()).toMatchObject({
      providerAuthorizeException: 2,
    });
  });

  it("adds the transfer's timeline to the delivered and failed lines", async () => {
    clock.now = Date.now();
    const T = clock.now;
    const saybin = identity();
    const simon = identity();
    const go = makeProvider(saybin);
    await flush();
    go.authored(dmEvent(saybin, simon, 'go-dm-e2e', 1, T - MINUTE));
    const logs = captureLogs();
    const stamps = {
      requestedAtMs: T - 2_000,
      arrivedAtMs: T - 1_500,
      authStartedAtMs: T - 1_400,
    };
    const serve = async (transferId: string, withStamps = true) => {
      go.manager.handleResourceEvent(
        dmAuth(saybin, simon, transferId, withStamps ? stamps : {}),
        { receivedAt: T - 1_000 }
      );
      await flush();
    };
    const lineFor = (transferId: string) =>
      logs.find(
        (line) =>
          line.includes(`transfer=${transferId}`) &&
          (line.includes('dm_page_link_delivered') ||
            line.includes('dm_page_link_delivery_failed'))
      );

    await serve('e0'.repeat(8));
    go.manager.handleResourceEvent({
      status: 'sent',
      transferId: 'e0'.repeat(8),
      providerTiming: {
        ...stamps,
        authorizedAtMs: T - 1_100,
        capAcquiredAtMs: T - 1_080,
        resourceFoundAtMs: T - 1_000,
        firstProgressAtMs: T + 2_500,
        endedAtMs: T + 3_000,
      },
    } as any);
    const delivered = lineFor('e0'.repeat(8));
    expect(delivered).toContain('dm_page_link_delivered');
    expect(delivered).toContain(' events=1 marked=1 ');
    for (const field of [
      'first_progress_ms=4000',
      'e2e_raw_ms=4500',
      'cap_ms=20',
      'adv_ms=80',
    ]) {
      expect(delivered).toMatch(new RegExp(` ${field}( |$)`));
    }

    // Failed before the requester asked for a part: no progress stamp.
    await serve('e1'.repeat(8));
    go.manager.handleResourceEvent({
      status: 'failed',
      transferId: 'e1'.repeat(8),
      reason: 'resource_session_closed',
      providerTiming: {
        ...stamps,
        authorizedAtMs: T - 1_100,
        capAcquiredAtMs: T - 1_090,
        endedAtMs: T + 9_000,
      },
    } as any);
    const failed = lineFor('e1'.repeat(8));
    expect(failed).toContain('dm_page_link_delivery_failed');
    expect(failed).toContain(' reason=resource_session_closed ');
    for (const field of [
      'first_progress_ms=n/a',
      'e2e_raw_ms=n/a',
      'cap_ms=10',
      'adv_ms=n/a',
    ]) {
      expect(failed).toMatch(new RegExp(` ${field}( |$)`));
    }

    // Timing without the request stamps: the auth's own stamps are used.
    await serve('e2'.repeat(8));
    go.manager.handleResourceEvent({
      status: 'sent',
      transferId: 'e2'.repeat(8),
      providerTiming: { firstProgressAtMs: T + 1_000 },
    } as any);
    expect(lineFor('e2'.repeat(8))).toMatch(
      / first_progress_ms=2500 e2e_raw_ms=3000 cap_ms=n\/a adv_ms=n\/a$/
    );

    // A desktop bridge: no stamps and no timeline.
    await serve('e3'.repeat(8), false);
    go.manager.handleResourceEvent({
      status: 'sent',
      transferId: 'e3'.repeat(8),
    } as any);
    expect(lineFor('e3'.repeat(8))).toMatch(
      / first_progress_ms=n\/a e2e_raw_ms=n\/a cap_ms=n\/a adv_ms=n\/a$/
    );
  });
});
