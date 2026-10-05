import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Real ReticulumChatDatabase SQL on Node's built-in SQLite (node:sqlite), as
// in reticulum-chat-dm-page-delivery.test.ts: the default Vitest
// better-sqlite3 mock ignores the DM delivery-status UPDATEs.
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
  buildReticulumDmRequestSignedFields,
  buildReticulumDmSignedFields,
  hashReticulumChatPayload,
  ReticulumChatManager,
  type ReticulumChatManagerOptions,
  type ReticulumChatWire,
  type ReticulumDmEvent,
  startReticulumChatManager,
  stopReticulumChatManager,
} from './reticulum-chat';
import { reticulumDmConversationId } from './reticulum-chat-db';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

type Identity = { address: string; publicKey: string; secretKey: Uint8Array };

const SAYBIN_GO_PEER = 'a83d90afdae8d783'.padEnd(32, '0');
const SIMON_HUB_PEER = '7d4e35a0cd43f6fd'.padEnd(32, '0');
const SAYBIN_HUB_PEER = 'd844a0c4aa32242b'.padEnd(32, '0');
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const REPAIR_SCOPE = 'dm_premature_sent_repair';

const managers: ReticulumChatManager[] = [];
const tempRoots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  stopReticulumChatManager();
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

function dmSigner(
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

function makeBridge(peerHash: string) {
  const pages: Array<Record<string, any>> = [];
  const authorizeCalls: Array<Record<string, any>> = [];
  const rejected: Array<Record<string, any>> = [];
  const wires: ReticulumChatWire[] = [];
  const bridge = Object.assign(new EventEmitter(), {
    getLocalDestinationHash: () => peerHash,
    sendReticulumChatDetailed: async (_peer: string, wire: any) => {
      wires.push(wire);
      return { ok: true as const };
    },
    fanoutReticulumChatDetailed: async (messages: any[]) => {
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
      return { ok: true as const };
    },
    rejectReticulumChatResourceDetailed: async (
      payload: Record<string, any>
    ) => {
      rejected.push(payload);
      return { ok: true as const };
    },
  });
  return { bridge, pages, authorizeCalls, rejected, wires };
}

/**
 * Saybin's phone: a provider whose engine was opened on a database an older
 * build wrote. `repair` turns the option on; the address is signed in.
 */
function makePhone(
  owner: Identity,
  options: {
    repair?: boolean;
    signer?: boolean;
    dbPath?: string;
    signIn?: boolean;
  } = {}
) {
  const { bridge, pages, authorizeCalls, rejected, wires } =
    makeBridge(SAYBIN_GO_PEER);
  const manager = new ReticulumChatManager({
    dbPath:
      options.dbPath ??
      path.join(tempDir('rchat-dm-repend-'), 'reticulum-chat.db'),
    now: () => clock.now,
    bridge: bridge as any,
    ...(options.repair ? { repairPrematureDmSentOnce: true } : {}),
    ...(options.signer
      ? { signLocalFields: dmSigner(owner), hasGoodOverlayHealth: () => true }
      : {}),
  });
  managers.push(manager);
  if (options.signIn !== false) manager.setLocalDmAddresses([owner.address]);
  const db = (manager as any).db;
  const sql = (db as any).db as {
    prepare: (sql: string) => {
      run: (...args: unknown[]) => unknown;
      get: (...args: unknown[]) => any;
      all: (...args: unknown[]) => any[];
    };
  };
  const row = (eventId: string) =>
    sql
      .prepare(
        `SELECT delivery_status, delivery_updated_at, own_device_copied_at,
                delivery_attempts, next_delivery_attempt_at
         FROM rchat_dm_events WHERE event_id = ?`
      )
      .get(eventId) as
      | {
          delivery_status: string;
          delivery_updated_at: number;
          own_device_copied_at: number | null;
          delivery_attempts: number | null;
          next_delivery_attempt_at: number | null;
        }
      | undefined;
  return {
    manager,
    db,
    sql,
    bridge,
    pages,
    authorizeCalls,
    rejected,
    notifies: () =>
      wires.filter((wire): wire is DmNotifyWire => wire.k === 'dm_notify'),
    row,
    status: (eventId: string) => row(eventId)?.delivery_status,
    /**
     * An own event this device wrote, as an older build left it: 'sent'
     * (marked at the authorize) at `markedAt`, copied by the own Hub.
     */
    authoredSent: (event: ReticulumDmEvent, markedAt = clock.now - MINUTE) => {
      expect(
        (manager as any).acceptDirectEvent(event, true, {
          deliveryStatus: 'pending',
        })
      ).toBe(true);
      sql
        .prepare(
          `UPDATE rchat_dm_events
           SET delivery_status = 'sent', delivery_updated_at = ?,
               own_device_copied_at = ?
           WHERE event_id = ?`
        )
        .run(markedAt, markedAt, event.eventId);
    },
    authoredPending: (event: ReticulumDmEvent) =>
      expect(
        (manager as any).acceptDirectEvent(event, true, {
          deliveryStatus: 'pending',
        })
      ).toBe(true),
    copy: (event: ReticulumDmEvent) =>
      expect((manager as any).acceptDirectEvent(event, false)).toBe(true),
    guard: (address: string) => {
      const found = sql
        .prepare(
          `SELECT group_id, peer_hash, state_value, updated_at
           FROM rchat_sync_state WHERE scope = ? AND state_key = ?`
        )
        .get(REPAIR_SCOPE, address) as
        | {
            group_id: number;
            peer_hash: string;
            state_value: string;
            updated_at: number;
          }
        | undefined;
      return found
        ? {
            groupId: Number(found.group_id),
            peerHash: found.peer_hash,
            value: JSON.parse(found.state_value),
            updatedAt: Number(found.updated_at),
          }
        : null;
    },
    repair: (address = owner.address) =>
      (manager as any).runPrematureDmSentRepair(address),
  };
}

/**
 * Simon's signed page request, as the phone's bridge hands it over. With
 * `peerHash` SAYBIN_HUB_PEER and `requester` Saybin, `owner` Simon: Saybin's
 * own Hub pulling the conversation.
 */
async function requestPage(
  phone: ReturnType<typeof makePhone>,
  requester: Identity,
  owner: Identity,
  after: number,
  transferId: string,
  peerHash = SIMON_HUB_PEER
): Promise<void> {
  const timestamp = clock.now;
  const signedFields = buildReticulumDmRequestSignedFields({
    peerAddress: owner.address,
    after,
    limit: 50,
    requesterPeerHash: peerHash,
    requestId: transferId,
    authorAddress: requester.address,
    authorPublicKey: requester.publicKey,
    timestamp,
  });
  await (phone.manager as any).authorizeDirectDmPageResource(
    {
      status: 'auth',
      linkId: `link-${transferId}`,
      transferId,
      peerPresenceHash: peerHash,
    },
    {
      transferId,
      b: owner.address,
      a: after,
      l: 50,
      q: transferId,
      rp: peerHash,
      p: requester.publicKey,
      n: timestamp,
      z: sign(signedFields, requester),
    }
  );
}

function pageEventIds(page: Record<string, any>): string[] {
  return (
    JSON.parse(fs.readFileSync(String(page.filePath), 'utf8')).events as [
      string,
      string,
    ][]
  ).map((tuple) => tuple[1]);
}

describe('one-time re-pend of DMs an older build marked sent at the authorize', () => {
  it('re-pends only own, recent, unanswered sent DMs to someone else', async () => {
    clock.now = Date.now();
    const T = clock.now;
    const saybin = identity();
    const simon = identity();
    const phone = makePhone(saybin, { repair: true });
    await flush();

    // Re-pended: marked 'sent' at an authorize, no proof of anything.
    const s1 = dmEvent(saybin, simon, 'go-dm-0434', 1, T - 3 * DAY);
    const s2 = dmEvent(saybin, simon, 'go-dm-0435', 2, T - 6 * DAY - 23 * HOUR);
    const answeredBySelf = dmEvent(
      saybin,
      simon,
      'go-self-replied',
      3,
      T - DAY
    );
    phone.authoredSent(s1);
    phone.authoredSent(s2);
    phone.authoredSent(answeredBySelf);
    // Kept as they are.
    const old = dmEvent(saybin, simon, 'go-8-days', 4, T - 7 * DAY - MINUTE);
    const selfDm = dmEvent(saybin, saybin, 'go-saved-dm', 5, T - DAY);
    const expired = dmEvent(saybin, simon, 'go-expired', 6, T - DAY);
    const copied = dmEvent(saybin, simon, 'hub-copy-dm', 7, T - DAY);
    const pending = dmEvent(saybin, simon, 'go-pending', 8, T - DAY);
    const replied = dmEvent(saybin, simon, 'go-replied', 9, T - 2 * DAY);
    const reacted = dmEvent(saybin, simon, 'go-reacted', 10, T - 2 * DAY);
    const markedNow = dmEvent(saybin, simon, 'go-marked-now', 11, T - HOUR);
    phone.authoredSent(old);
    phone.authoredSent(selfDm);
    phone.authoredSent(expired);
    phone.sql
      .prepare('UPDATE rchat_dm_events SET expires_at = ? WHERE event_id = ?')
      .run(T - 1, expired.eventId);
    // Written on Saybin's Hub, stored here as a copy (not this device's).
    phone.copy(copied);
    phone.sql
      .prepare(
        `UPDATE rchat_dm_events SET delivery_status = 'sent', delivery_updated_at = ?
         WHERE event_id = ?`
      )
      .run(T - MINUTE, copied.eventId);
    phone.authoredPending(pending);
    phone.sql
      .prepare(
        `UPDATE rchat_dm_events SET delivery_attempts = 3,
           next_delivery_attempt_at = ? WHERE event_id = ?`
      )
      .run(T + HOUR, pending.eventId);
    phone.authoredSent(replied);
    phone.authoredSent(reacted);
    phone.authoredSent(markedNow, T);
    // Simon answered two of them: they did reach him.
    const reply = dmEvent(simon, saybin, 'simon-reply', 1, T - DAY);
    const reaction = dmEvent(simon, saybin, 'simon-reaction', 2, T - DAY);
    const fromSimon = dmEvent(simon, saybin, 'simon-plain', 3, T - DAY);
    phone.copy(reply);
    phone.copy(reaction);
    phone.copy(fromSimon);
    phone.sql
      .prepare(
        'UPDATE rchat_dm_events SET reply_to_event_id = ? WHERE event_id = ?'
      )
      .run(replied.eventId, reply.eventId);
    phone.sql
      .prepare(
        `UPDATE rchat_dm_events SET event_type = 'reaction', target_event_id = ?
         WHERE event_id = ?`
      )
      .run(reacted.eventId, reaction.eventId);
    // Saybin's own reply to one of his messages proves nothing.
    const ownReply = dmEvent(saybin, simon, 'go-own-reply', 12, T - DAY);
    phone.authoredSent(ownReply);
    phone.sql
      .prepare(
        'UPDATE rchat_dm_events SET reply_to_event_id = ? WHERE event_id = ?'
      )
      .run(answeredBySelf.eventId, ownReply.eventId);

    const summaries: Array<Record<string, unknown>> = [];
    phone.manager.on('directSummaryChanged', (payload) =>
      summaries.push(payload)
    );
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    phone.repair();

    const repended = [s1, s2, answeredBySelf, ownReply].map((e) => e.eventId);
    for (const eventId of repended) {
      // The own Hub's copy mark stays; three attempts counted, so the first
      // re-announce is the first one without `lc`.
      expect(phone.row(eventId), eventId).toMatchObject({
        delivery_status: 'pending',
        delivery_updated_at: T,
        own_device_copied_at: T - MINUTE,
        delivery_attempts: 3,
        next_delivery_attempt_at: T + 2 * MINUTE,
      });
    }
    for (const event of [old, selfDm, expired, replied, reacted, markedNow]) {
      expect(phone.status(event.eventId), event.eventId).toBe('sent');
    }
    expect(phone.row(old.eventId)?.own_device_copied_at).toBe(T - MINUTE);
    expect(phone.status(copied.eventId)).toBe('sent');
    expect(phone.row(pending.eventId)).toMatchObject({
      delivery_status: 'pending',
      delivery_attempts: 3,
      next_delivery_attempt_at: T + HOUR,
    });
    for (const event of [reply, reaction, fromSimon]) {
      expect(phone.status(event.eventId)).toBe('received');
    }
    expect(phone.guard(saybin.address)).toEqual({
      groupId: 0,
      peerHash: '',
      value: { v: 1, at: T, rows: 4, conversations: 1 },
      updatedAt: T,
    });
    expect(summaries).toEqual([
      {
        conversationId: s1.conversationId,
        peerAddress: simon.address,
      },
    ]);
    expect(phone.manager.getDeliveryCounters()).toMatchObject({
      dmPrematureSentRepaired: 4,
    });
    expect(
      logs.find((line) => line.includes('dm_premature_sent_repaired'))
    ).toContain(
      `address=${saybin.address} rows=4 conversations=1 first_due_ms=120000 spacing_ms=75000`
    );
  });

  it('staggers the conversations newest first, 75 s apart from 2 min on', async () => {
    clock.now = Date.now();
    const T = clock.now;
    const saybin = identity();
    const simon = identity();
    const bob = identity();
    const carol = identity();
    const phone = makePhone(saybin, { repair: true });
    await flush();
    // Carol's conversation has the newest such row, then Simon's, then Bob's.
    const toBob = [
      dmEvent(saybin, bob, 'go-to-bob-1', 1, T - 5 * DAY),
      dmEvent(saybin, bob, 'go-to-bob-2', 2, T - 4 * DAY),
    ];
    const toSimon = [
      dmEvent(saybin, simon, 'go-to-simon-1', 3, T - 6 * DAY),
      dmEvent(saybin, simon, 'go-to-simon-2', 4, T - 2 * DAY),
    ];
    const toCarol = [dmEvent(saybin, carol, 'go-to-carol-1', 5, T - HOUR)];
    for (const event of [...toBob, ...toSimon, ...toCarol]) {
      phone.authoredSent(event);
    }
    const summaries: Array<Record<string, any>> = [];
    phone.manager.on('directSummaryChanged', (payload) =>
      summaries.push(payload)
    );
    phone.repair();
    const dueOf = (events: ReticulumDmEvent[]) => [
      ...new Set(
        events.map(
          (event) => phone.row(event.eventId)?.next_delivery_attempt_at
        )
      ),
    ];
    expect(dueOf(toCarol)).toEqual([T + 120_000]);
    expect(dueOf(toSimon)).toEqual([T + 195_000]);
    expect(dueOf(toBob)).toEqual([T + 270_000]);
    expect(summaries.map((summary) => summary.peerAddress)).toEqual([
      carol.address,
      simon.address,
      bob.address,
    ]);
    expect(phone.guard(saybin.address)?.value).toEqual({
      v: 1,
      at: T,
      rows: 5,
      conversations: 3,
    });
  });

  it('runs once per address, and a failed run leaves no guard and changes nothing', async () => {
    clock.now = Date.now();
    const T = clock.now;
    const saybin = identity();
    const simon = identity();
    const phone = makePhone(saybin, { repair: true });
    await flush();
    const s1 = dmEvent(saybin, simon, 'go-once-1', 1, T - DAY);
    const s2 = dmEvent(saybin, simon, 'go-once-2', 2, T - HOUR);
    phone.authoredSent(s1);
    phone.authoredSent(s2);

    // The guard row cannot be written: the whole run rolls back.
    const prepare = phone.sql.prepare.bind(phone.sql);
    const failing = vi
      .spyOn(phone.sql, 'prepare')
      .mockImplementation((statement: string) => {
        if (/INSERT INTO rchat_sync_state/.test(statement)) {
          throw new Error('disk I/O error');
        }
        return prepare(statement);
      });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    phone.repair();
    expect(phone.status(s1.eventId)).toBe('sent');
    expect(phone.status(s2.eventId)).toBe('sent');
    expect(phone.row(s1.eventId)?.own_device_copied_at).toBe(T - MINUTE);
    expect(phone.guard(saybin.address)).toBeNull();
    expect(phone.manager.getDeliveryCounters()).toMatchObject({
      dmPrematureSentRepairFailed: 1,
    });
    expect(
      phone.manager.getDeliveryCounters().dmPrematureSentRepaired
    ).toBeUndefined();
    failing.mockRestore();

    // The next run does it.
    phone.repair();
    expect(phone.status(s1.eventId)).toBe('pending');
    expect(phone.status(s2.eventId)).toBe('pending');
    expect(phone.guard(saybin.address)?.value).toMatchObject({ rows: 2 });

    // Proven since (a delivered page): it stays 'sent' however often the
    // repair is asked to run again, in this process or a later one.
    phone.sql
      .prepare(
        `UPDATE rchat_dm_events SET delivery_status = 'sent', delivery_updated_at = ?
         WHERE event_id = ?`
      )
      .run(T - SECOND, s2.eventId);
    clock.now = T + MINUTE;
    phone.repair();
    expect(phone.status(s2.eventId)).toBe('sent');
    expect(phone.db.repairPrematureDmSent(saybin.address, clock.now)).toBe(
      null
    );
    expect(phone.status(s2.eventId)).toBe('sent');
    expect(phone.guard(saybin.address)?.value).toEqual({
      v: 1,
      at: T,
      rows: 2,
      conversations: 1,
    });
    expect(phone.manager.getDeliveryCounters()).toMatchObject({
      dmPrematureSentRepaired: 2,
    });
  });

  it('runs 30 s after sign-in only with the option on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    clock.now = Date.now();
    const T = clock.now;
    const saybin = identity();
    const simon = identity();
    const root = tempDir('rchat-dm-repend-option-');
    const s1 = dmEvent(saybin, simon, 'go-option', 1, T - DAY);

    // Desktop (option off): nothing, ever.
    const desktop = makePhone(saybin, {
      dbPath: path.join(root, 'desktop.db'),
    });
    desktop.authoredSent(s1);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(desktop.status(s1.eventId)).toBe('sent');
    expect(desktop.guard(saybin.address)).toBeNull();

    // GO: not before 30 s after sign-in, then once.
    const go = makePhone(saybin, {
      repair: true,
      dbPath: path.join(root, 'go.db'),
    });
    go.authoredSent(s1);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(go.status(s1.eventId)).toBe('sent');
    expect(go.guard(saybin.address)).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(go.status(s1.eventId)).toBe('pending');
    expect(go.guard(saybin.address)?.value).toMatchObject({ rows: 1 });

    // Signed out before it ran: nothing for that sign-in...
    const later = makePhone(saybin, {
      repair: true,
      dbPath: path.join(root, 'later.db'),
    });
    later.authoredSent(s1);
    await vi.advanceTimersByTimeAsync(10_000);
    // The account boundary comes first, the address list after it.
    await later.manager.clearLocalAccountState();
    await vi.advanceTimersByTimeAsync(25_000);
    later.manager.setLocalDmAddresses([]);
    expect(later.status(s1.eventId)).toBe('sent');
    expect(later.guard(saybin.address)).toBeNull();
    // ...and the next sign-in runs it, 30 s later.
    later.manager.setLocalDmAddresses([saybin.address]);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(later.status(s1.eventId)).toBe('sent');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(later.status(s1.eventId)).toBe('pending');

    // Signed out and back in quickly: it waits 30 s from the new sign-in.
    const quick = makePhone(saybin, {
      repair: true,
      dbPath: path.join(root, 'quick.db'),
    });
    quick.authoredSent(s1);
    await vi.advanceTimersByTimeAsync(10_000);
    await quick.manager.clearLocalAccountState();
    quick.manager.setLocalDmAddresses([]);
    quick.manager.setLocalDmAddresses([saybin.address]);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(quick.status(s1.eventId)).toBe('sent');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(quick.status(s1.eventId)).toBe('pending');
  });

  it('passes the option through startReticulumChatManager', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    clock.now = Date.now();
    const saybin = identity();
    const { bridge } = makeBridge(SAYBIN_GO_PEER);
    const manager = startReticulumChatManager(
      bridge as any,
      path.join(tempDir('rchat-dm-repend-start-'), 'reticulum-chat.db'),
      { repairPrematureDmSentOnce: true }
    );
    expect((manager as any).repairPrematureDmSentOnce).toBe(true);
    const runs = vi.spyOn(manager as any, 'runPrematureDmSentRepair');
    manager.setLocalDmAddresses([saybin.address]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runs).toHaveBeenCalledWith(saybin.address);
  });

  it('re-announces the first conversation no earlier than 2 min after the repair, the next 75 s later', async () => {
    clock.now = Date.now();
    const T = clock.now;
    const saybin = identity();
    const simon = identity();
    const bob = identity();
    const dbPath = path.join(tempDir('rchat-dm-repend-sweep-'), 'chat.db');
    const toSimon = dmEvent(saybin, simon, 'go-sweep-simon', 1, T - HOUR);
    const toBob = dmEvent(saybin, bob, 'go-sweep-bob', 2, T - 3 * HOUR);
    // An older build wrote them and marked them 'sent'.
    const older = makePhone(saybin, { dbPath });
    older.authoredSent(toSimon);
    older.authoredSent(toBob);
    managers.splice(managers.indexOf(older.manager), 1);
    older.manager.close();
    // This build opens the database: nothing pending, the sweep is idle.
    const phone = makePhone(saybin, { repair: true, signer: true, dbPath });
    await flush();
    expect((phone.manager as any).dmPendingDeliveryTimer).toBeNull();
    // Retry state held in memory is dropped with the repair.
    (phone.manager as any).dmPendingDeliveryAttempts.set('stale-entry', {
      attempts: 9,
      nextAttemptAt: 0,
    });
    phone.repair();
    expect(
      (phone.manager as any).dmPendingDeliveryAttempts.has('stale-entry')
    ).toBe(false);
    // The persisted due time and the armed timer: 2 min out at the earliest.
    expect(
      phone.db.nextPendingOwnDirectDeliveryDueAt(
        saybin.address,
        T - 7 * DAY,
        T - 2 * HOUR,
        T
      )
    ).toBe(T + 120_000);
    // The sweep wakes for it then, not before.
    expect((phone.manager as any).dmPendingDeliveryTimer).not.toBeNull();
    expect((phone.manager as any).dmPendingDeliveryTimerDueAt).toBe(
      T + 120_000
    );

    const sweepAt = async (at: number) => {
      clock.now = at;
      const before = phone.notifies().length;
      await (phone.manager as any).runDmPendingDeliverySweep();
      return phone.notifies().slice(before);
    };
    const announcedTo = async (at: number) =>
      (await sweepAt(at)).map((wire) => wire.d.b);
    expect(await announcedTo(T)).toEqual([]);
    expect(await announcedTo(T + 119_999)).toEqual([]);
    const first = await sweepAt(T + 120_000);
    expect(first.map((wire) => wire.d.b)).toContain(simon.address);
    expect(first.map((wire) => wire.d.b)).not.toContain(bob.address);
    // The first re-announce of a re-pended head leaves `lc` out: a recipient
    // that already holds the head (a real delivery) still pulls from its own
    // cursor, and the page proves the rows.
    for (const wire of first) expect(wire.d).not.toHaveProperty('lc');
    expect(phone.row(toSimon.eventId)?.delivery_attempts).toBe(4);
    expect(await announcedTo(T + 194_999)).not.toContain(bob.address);
    // Bob's head is 3 h old and the own Hub holds a copy: it still gets
    // this one re-announce, without `lc`...
    const second = await sweepAt(T + 195_000);
    expect(second.map((wire) => wire.d.b)).toContain(bob.address);
    for (const wire of second) expect(wire.d).not.toHaveProperty('lc');
    // ...and then leaves the slow tail (the Hub copy covers it), while
    // Simon's 1 h old head stays in the 2 h window.
    const heads = phone.db
      .listPendingOwnDirectConversationHeads(
        saybin.address,
        clock.now - 7 * DAY,
        clock.now - 2 * HOUR,
        16,
        clock.now
      )
      .map((head: { event: ReticulumDmEvent }) => head.event.eventId);
    expect(heads).toEqual([toSimon.eventId]);
  });

  it('serves a re-pended DM to a pull whose cursor passed it, and marks it sent only when the page is delivered', async () => {
    clock.now = Date.now();
    const T = clock.now;
    const saybin = identity();
    const simon = identity();
    const phone = makePhone(saybin, { repair: true });
    await flush();
    // Saybin's 04:34 message from the phone, falsely 'sent'; then his Hub
    // message that moved Simon's cursor past it.
    const g1 = dmEvent(saybin, simon, 'go-stranded', 1, T - 3 * DAY);
    const hub = dmEvent(
      saybin,
      simon,
      'hub-cursor',
      2,
      T - 3 * DAY + 25 * MINUTE
    );
    phone.authoredSent(g1);
    phone.copy(hub);

    // Before the repair a pull from Simon's cursor never carries it.
    await requestPage(phone, simon, saybin, hub.timestamp - 1, 'b0'.repeat(8));
    expect(pageEventIds(phone.pages[0])).toEqual([hub.eventId]);

    phone.repair();
    expect(phone.status(g1.eventId)).toBe('pending');
    await requestPage(phone, simon, saybin, hub.timestamp - 1, 'b1'.repeat(8));
    expect(pageEventIds(phone.pages[1])).toEqual([g1.eventId, hub.eventId]);
    expect(phone.status(g1.eventId)).toBe('pending');
    // The requester was gone: the transfer failed. Still pending.
    phone.manager.handleResourceEvent({
      status: 'failed',
      transferId: 'b1'.repeat(8),
      reason: 'resource_session_closed',
    } as any);
    expect(phone.status(g1.eventId)).toBe('pending');
    // The next page is delivered (RNS proof): now it is 'sent'.
    await requestPage(phone, simon, saybin, hub.timestamp - 1, 'b2'.repeat(8));
    expect(pageEventIds(phone.pages[2])).toEqual([g1.eventId, hub.eventId]);
    phone.manager.handleResourceEvent({
      status: 'sent',
      transferId: 'b2'.repeat(8),
    } as any);
    expect(phone.status(g1.eventId)).toBe('sent');
    expect(phone.status(hub.eventId)).toBe('received');
  });

  it('keeps a head the own Hub copies after the repair in the slow tail until its first re-announce without lc', async () => {
    clock.now = Date.now();
    const T = clock.now;
    const saybin = identity();
    const simon = identity();
    const phone = makePhone(saybin, { repair: true, signer: true });
    await flush();
    (phone.manager as any).isVerifiedSelfDmPeer = (
      address: string,
      peer: string
    ) => address === saybin.address && peer === SAYBIN_HUB_PEER;
    // Falsely 'sent' by an older build, 3 h ago; the own Hub never got it.
    const g1 = dmEvent(saybin, simon, 'go-tail-own-hub', 1, T - 3 * HOUR);
    phone.authoredSent(g1);
    phone.sql
      .prepare(
        'UPDATE rchat_dm_events SET own_device_copied_at = NULL WHERE event_id = ?'
      )
      .run(g1.eventId);
    phone.repair();
    expect(phone.row(g1.eventId)).toMatchObject({
      delivery_status: 'pending',
      own_device_copied_at: null,
      delivery_attempts: 3,
    });
    const tailHeads = () =>
      phone.db
        .listPendingOwnDirectConversationHeads(
          saybin.address,
          clock.now - 7 * DAY,
          clock.now - 2 * HOUR,
          16,
          clock.now
        )
        .map((head: { event: ReticulumDmEvent }) => head.event.eventId);
    expect(tailHeads()).toEqual([g1.eventId]);

    // Saybin's Hub pulls the conversation right away and gets the page.
    await requestPage(phone, saybin, simon, 0, 'c1'.repeat(8), SAYBIN_HUB_PEER);
    expect(pageEventIds(phone.pages[0])).toEqual([g1.eventId]);
    phone.manager.handleResourceEvent({
      status: 'sent',
      transferId: 'c1'.repeat(8),
    } as any);
    expect(phone.row(g1.eventId)?.own_device_copied_at).toBe(T);
    expect(phone.status(g1.eventId)).toBe('pending');
    // Copied, but the recipient was never asked without `lc`: still a tail
    // head, still due at its staggered slot, and not pushed to the Hub again.
    expect(tailHeads()).toEqual([g1.eventId]);
    expect(
      phone.db.nextPendingOwnDirectDeliveryDueAt(
        saybin.address,
        T - 7 * DAY,
        T - 2 * HOUR,
        T
      )
    ).toBe(T + 2 * MINUTE);
    expect(
      phone.db.listUncopiedPendingOwnDirectEvents(
        saybin.address,
        T - 7 * DAY,
        64,
        T
      )
    ).toEqual([]);

    clock.now = T + 2 * MINUTE;
    const before = phone.notifies().length;
    await (phone.manager as any).runDmPendingDeliverySweep();
    const sent = phone.notifies().slice(before);
    expect(sent.map((wire) => wire.d.b)).toContain(simon.address);
    for (const wire of sent) expect(wire.d).not.toHaveProperty('lc');
    expect(phone.row(g1.eventId)?.delivery_attempts).toBe(4);
    // That was its one cursorless try from the tail: the Hub copy covers it
    // from here, as for any copied tail head.
    expect(tailHeads()).toEqual([]);
    expect(
      phone.db.nextPendingOwnDirectDeliveryDueAt(
        saybin.address,
        clock.now - 7 * DAY,
        clock.now - 2 * HOUR,
        clock.now
      )
    ).toBeNull();
  });

  it('leaves re-pended rows out of the outbox counts until a delivered page settles them', async () => {
    clock.now = Date.now();
    const T = clock.now;
    const saybin = identity();
    const simon = identity();
    const bob = identity();
    const phone = makePhone(saybin, { repair: true });
    await flush();
    const s1 = dmEvent(saybin, simon, 'go-count-1', 1, T - DAY);
    const s2 = dmEvent(saybin, simon, 'go-count-2', 2, T - HOUR);
    const toBob = dmEvent(saybin, bob, 'go-count-bob', 3, T - 5 * MINUTE);
    phone.authoredSent(s1);
    phone.authoredSent(s2);
    phone.authoredPending(toBob);
    const counts = () =>
      phone.db.countPendingOwnDirectEvents(
        saybin.address,
        clock.now - 7 * DAY,
        clock.now - 2 * HOUR,
        clock.now
      );
    expect(counts()).toEqual({
      pending: 1,
      uncopied: 1,
      active: 1,
      repaired: 0,
    });

    phone.repair();
    await flush();
    expect(phone.status(s1.eventId)).toBe('pending');
    expect(phone.status(s2.eventId)).toBe('pending');
    // Neither 'waiting to send' (the status notification's count) nor
    // keeping the engine awake: older builds showed them as sent.
    expect(counts()).toEqual({
      pending: 1,
      uncopied: 1,
      active: 1,
      repaired: 2,
    });
    expect(phone.manager.getOwnOutboxState()).toMatchObject({
      pendingCount: 1,
      uncopiedCount: 1,
    });
    expect((phone.manager as any).ownOutboxRepairedCount).toBe(2);

    // A message written after the repair counts as usual.
    clock.now = T + MINUTE;
    const later = dmEvent(saybin, simon, 'go-count-later', 4, clock.now);
    phone.authoredPending(later);
    expect(counts()).toMatchObject({ pending: 2, repaired: 2 });

    // Simon's delivered page settles the re-pended rows.
    await requestPage(phone, simon, saybin, 0, 'c2'.repeat(8));
    phone.manager.handleResourceEvent({
      status: 'sent',
      transferId: 'c2'.repeat(8),
    } as any);
    await flush();
    expect(phone.status(s1.eventId)).toBe('sent');
    expect(phone.status(s2.eventId)).toBe('sent');
    expect(phone.status(later.eventId)).toBe('sent');
    expect(counts()).toMatchObject({ pending: 1, repaired: 0 });
    expect((phone.manager as any).ownOutboxRepairedCount).toBe(0);
  });

  it('answers a recipient who speaks with a re-announce without lc when only re-pended rows wait', async () => {
    clock.now = Date.now();
    const T = clock.now;
    const saybin = identity();
    const simon = identity();
    const phone = makePhone(saybin, { repair: true, signer: true });
    await flush();
    const s1 = dmEvent(saybin, simon, 'go-spoke-1', 1, T - DAY);
    phone.authoredSent(s1);
    phone.repair();
    await flush();
    expect(phone.manager.getOwnOutboxState().pendingCount).toBe(0);
    expect((phone.manager as any).ownOutboxRepairedCount).toBe(1);
    // Simon writes: he is reachable now.
    clock.now = T + 10 * SECOND;
    const before = phone.notifies().length;
    (phone.manager as any).noteDmPeerSpoke(
      dmEvent(simon, saybin, 'simon-spoke', 1, clock.now)
    );
    await flush();
    const sent = phone.notifies().slice(before);
    expect(sent.map((wire) => wire.d.b)).toContain(simon.address);
    for (const wire of sent) expect(wire.d).not.toHaveProperty('lc');
  });
});
