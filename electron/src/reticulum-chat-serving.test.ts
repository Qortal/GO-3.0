import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The serving paths read and write real rows (events, author heads), so these
// tests run ReticulumChatDatabase's SQL against Node's built-in SQLite
// (node:sqlite) through a minimal better-sqlite3 adapter, as the DM page and
// own-post delivery tests do.
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
  buildReticulumDmNotifySignedFields,
  hashReticulumChatPayload,
  ReticulumChatManager,
  RETICULUM_CHAT_PROVIDER_AUTH_WINDOW_MS,
  type ReticulumChatEvent,
  type ReticulumChatMobileProfile,
} from './reticulum-chat';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

type Identity = { address: string; publicKey: string; secretKey: Uint8Array };

const GROUP_ID = 77;
// This phone and the Hub that pulls from it.
const GO_PEER = 'a1'.repeat(16);
const HUB_PEER = 'c3'.repeat(16);
const MY_STREAM = 'd'.repeat(32);
const SECOND = 1_000;

const managers: ReticulumChatManager[] = [];
const tempRoots: string[] = [];
const clock = { now: Date.now() };

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  clock.now = Date.now();
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-serving-'));
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

let idCounter = 0;
/** Transfer and request ids are 16 hex characters on the wire. */
function nextTransferId(): string {
  idCounter += 1;
  return idCounter.toString(16).padStart(16, '0');
}

function groupPost(author: Identity, seq: number): ReticulumChatEvent {
  idCounter += 1;
  const eventId = `post-${idCounter.toString(16).padStart(8, '0')}`;
  const encryptedPayload = `ciphertext-${eventId}`;
  const event: ReticulumChatEvent = {
    eventId,
    groupId: GROUP_ID,
    channelId: 'general',
    authorAddress: author.address,
    authorPublicKey: author.publicKey,
    authorStreamId: MY_STREAM,
    authorSeq: seq,
    timestamp: clock.now - 60 * SECOND + seq,
    eventType: 'message',
    encryptedPayload,
    payloadHash: hashReticulumChatPayload(encryptedPayload),
    mentionAddressHashes: [],
    signature: '',
  };
  event.signature = sign(buildReticulumChatSignedFields(event), author);
  return event;
}

const flush = async (ticks = 8) => {
  for (let i = 0; i < ticks; i += 1) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

const captureLogs = (): string[] => {
  const logs: string[] = [];
  const push = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
  vi.spyOn(console, 'log').mockImplementation(push);
  vi.spyOn(console, 'warn').mockImplementation(push);
  return logs;
};

/** A GO phone serving its stored group history to a Hub. */
function makePhone(profile: ReticulumChatMobileProfile = {}) {
  const calls: Array<{ kind: string; payload: Record<string, any> }> = [];
  /** Runs inside each membership check, before it answers. */
  const hooks: { onValidate?: () => void } = {};
  const bridge = Object.assign(new EventEmitter(), {
    getLocalDestinationHash: () => GO_PEER,
    sendReticulumChatDetailed: async () => ({ ok: true as const }),
    fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
    sendReticulumChatResourceDetailed: async (payload: Record<string, any>) => {
      calls.push({ kind: 'register', payload });
      return { ok: true as const };
    },
    authorizeReticulumChatResourceDetailed: async (
      payload: Record<string, any>
    ) => {
      calls.push({ kind: 'authorize', payload });
      return { ok: true as const };
    },
    rejectReticulumChatResourceDetailed: async (
      payload: Record<string, any>
    ) => {
      calls.push({ kind: 'reject', payload });
      return { ok: true as const };
    },
  });
  const manager = new ReticulumChatManager({
    dbPath: tempDbPath(),
    now: () => clock.now,
    bridge: bridge as any,
    validateGroupMember: async () => {
      hooks.onValidate?.();
      return true;
    },
    mobileProfile: profile,
  });
  managers.push(manager);
  manager.setLocalGroupMemberships([
    { groupId: GROUP_ID, localAddress: me.address },
  ]);
  const m = manager as any;
  return {
    manager,
    m,
    bridge,
    calls,
    hooks,
    kinds: () => calls.map((call) => call.kind),
    rejects: () => calls.filter((c) => c.kind === 'reject'),
    counters: () => manager.getDeliveryCounters(),
    store: async (event: ReticulumChatEvent) =>
      expect(await m.acceptEvent(event, false)).toBe(true),
    /** The bridge's 'auth' as it reaches the engine's resource listener. */
    deliver: (payload: Record<string, unknown>) =>
      bridge.emit('reticulum-chat-resource', payload),
  };
}

type Stamps = { authStartedAtMs?: number; arrivedAtMs?: number };

/** A Hub's signed pull of one event (Hub 3.0.3 linked live event). */
function liveAuth(event: ReticulumChatEvent, stamps: Stamps = {}) {
  const transferId = nextTransferId();
  const request = {
    transferId,
    eventId: event.eventId,
    groupId: GROUP_ID,
    requesterPeerHash: HUB_PEER,
    providerPeerHash: GO_PEER,
    authorAddress: member.address,
    authorPublicKey: member.publicKey,
    timestamp: clock.now,
  };
  return {
    status: 'auth',
    linkId: `link-${transferId}`,
    transferId,
    peerPresenceHash: HUB_PEER,
    resourceType: 'reticulum_chat_event',
    metadata: { logicalResourceType: 'reticulum_chat_live_event' },
    auth: {
      type: 'RETICULUM_CHAT_LINKED_EVENT_REQUEST',
      ...request,
      signature: sign(
        buildReticulumChatLinkedEventRequestSignedFields(request),
        member
      ),
    },
    ...stamps,
  };
}

/** A Hub's signed author-range pull over this phone's stream. */
function rangeAuth(from: number, to: number, stamps: Stamps = {}) {
  const transferId = nextTransferId();
  const range = { a: me.address, s: MY_STREAM, from, to };
  const signed = {
    transferId,
    groupId: GROUP_ID,
    range,
    limit: 100,
    requesterPeerHash: HUB_PEER,
    providerPeerHash: GO_PEER,
    authorAddress: member.address,
    authorPublicKey: member.publicKey,
    timestamp: clock.now,
  };
  return {
    status: 'auth',
    linkId: `link-${transferId}`,
    transferId,
    peerPresenceHash: HUB_PEER,
    resourceType: 'reticulum_chat_event',
    metadata: { logicalResourceType: 'reticulum_chat_author_range' },
    auth: {
      type: 'RETICULUM_CHAT_LINKED_AUTHOR_RANGE_REQUEST',
      ...signed,
      signature: sign(
        buildReticulumChatLinkedAuthorRangeRequestSignedFields(signed),
        member
      ),
    },
    ...stamps,
  };
}

/** A Hub's signed history page pull (newest page before `cursor`). */
function pageAuth(
  cursor: ReticulumChatEvent,
  stamps: Stamps = {},
  limit = 100
) {
  const transferId = nextTransferId();
  const at = { id: cursor.eventId, ts: cursor.timestamp };
  const fields = buildReticulumChatHistoryPageRequestSignedFields({
    groupId: GROUP_ID,
    channelId: '*',
    direction: 'before',
    before: at,
    includeCursor: true,
    limit,
    authorAddress: member.address,
    authorPublicKey: member.publicKey,
    timestamp: clock.now,
  });
  return {
    status: 'auth',
    linkId: `link-${transferId}`,
    transferId,
    peerPresenceHash: HUB_PEER,
    resourceType: 'reticulum_chat_event',
    metadata: { logicalResourceType: 'reticulum_chat_history_page' },
    auth: {
      type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
      transferId,
      groupId: GROUP_ID,
      c: '*',
      d: 'before',
      before: at,
      inc: 1,
      limit,
      a: member.address,
      pk: member.publicKey,
      ts: clock.now,
      sig: sign(fields, member),
    },
    ...stamps,
  };
}

const GO_PROFILE: ReticulumChatMobileProfile = {
  immediateProviderAuth: true,
  rotatableServeBusy: true,
};

describe('serving: requests the bridge already gave up on (immediateProviderAuth)', () => {
  it('answers live_event, author_range and history_page auths 16 s old with no bridge call at all', async () => {
    const phone = makePhone(GO_PROFILE);
    const first = groupPost(me, 1);
    const second = groupPost(me, 2);
    await phone.store(first);
    await phone.store(second);
    const stale = { authStartedAtMs: clock.now - 16 * SECOND };

    phone.deliver(liveAuth(second, stale));
    phone.deliver(rangeAuth(1, 2, stale));
    phone.deliver(pageAuth(second, stale));
    await flush();

    expect(phone.calls).toEqual([]);
    expect(phone.counters()).toMatchObject({
      providerAuthSkipped: 3,
      providerAuthSkipped_live_event_entry: 1,
      providerAuthSkipped_author_range_entry: 1,
      providerAuthSkipped_history_page_entry: 1,
    });
  });

  it('serves the same requests while the bridge still waits for them', async () => {
    const phone = makePhone(GO_PROFILE);
    const first = groupPost(me, 1);
    const second = groupPost(me, 2);
    await phone.store(first);
    await phone.store(second);
    const fresh = { authStartedAtMs: clock.now - 2 * SECOND };

    phone.deliver(liveAuth(second, fresh));
    phone.deliver(rangeAuth(1, 2, fresh));
    phone.deliver(pageAuth(second, fresh));
    // History pages go through their own serve queue and a temp file write
    // first, so wait for the answers instead of a fixed number of ticks (the
    // file I/O takes longer when the whole engine suite runs at once).
    await vi.waitFor(
      () => {
        expect(phone.kinds().filter((k) => k === 'register')).toHaveLength(3);
        expect(phone.kinds().filter((k) => k === 'authorize')).toHaveLength(3);
      },
      { timeout: 5_000, interval: 10 }
    );
    expect(phone.rejects()).toEqual([]);
    expect(phone.counters().providerAuthSkipped).toBeUndefined();
  });

  it('a request that went stale while its membership was checked gets no register and no answer', async () => {
    for (const type of ['live_event', 'author_range'] as const) {
      const phone = makePhone(GO_PROFILE);
      const event = groupPost(me, 1);
      await phone.store(event);
      // Core answers only after the bridge's 15 s window ran out.
      phone.hooks.onValidate = () => {
        clock.now += RETICULUM_CHAT_PROVIDER_AUTH_WINDOW_MS;
      };
      const logs = captureLogs();
      const stamps = { authStartedAtMs: clock.now - SECOND };

      phone.deliver(
        type === 'live_event'
          ? liveAuth(event, stamps)
          : rangeAuth(1, 1, stamps)
      );
      await flush();

      expect(phone.calls).toEqual([]);
      expect(phone.counters()).toMatchObject({
        providerAuthSkipped: 1,
        [`providerAuthSkipped_${type}_membership`]: 1,
      });
      const skipLines = logs.filter((l) => l.includes('provider_auth_skipped'));
      expect(skipLines).toHaveLength(1);
      expect(skipLines[0]).toContain(`type=${type} stage=membership`);
      vi.restoreAllMocks();
    }
  });

  it('logs one skip line per 30 s, however many requests it drops', async () => {
    const phone = makePhone(GO_PROFILE);
    const event = groupPost(me, 1);
    await phone.store(event);
    const logs = captureLogs();
    const stale = () => ({ authStartedAtMs: clock.now - 16 * SECOND });

    for (let i = 0; i < 5; i += 1) phone.deliver(liveAuth(event, stale()));
    clock.now += 31 * SECOND;
    phone.deliver(liveAuth(event, stale()));
    await flush();

    const skipLines = logs.filter((l) => l.includes('provider_auth_skipped'));
    expect(phone.counters().providerAuthSkipped).toBe(6);
    expect(skipLines).toHaveLength(2);
    expect(skipLines[0]).toContain('skipped=1');
    expect(skipLines[1]).toContain('skipped=5');
  });

  it('an auth Python already ended is dropped without an answer', async () => {
    const phone = makePhone(GO_PROFILE);
    const event = groupPost(me, 1);
    await phone.store(event);
    const auth = liveAuth(event, { authStartedAtMs: clock.now - SECOND });
    phone.deliver({
      status: 'auth_ended',
      transferId: auth.transferId,
      reason: 'resource_session_link_closed',
    });
    phone.deliver(auth);
    await flush();

    expect(phone.calls).toEqual([]);
    expect(phone.counters().providerAuthSkipped_live_event_entry).toBe(1);
  });

  it('serves an unstamped auth (desktop bridges) exactly as before, even when late', async () => {
    const phone = makePhone(GO_PROFILE);
    const event = groupPost(me, 1);
    await phone.store(event);
    phone.hooks.onValidate = () => {
      clock.now += 2 * RETICULUM_CHAT_PROVIDER_AUTH_WINDOW_MS;
    };

    phone.deliver(liveAuth(event));
    await flush();

    expect(phone.kinds()).toEqual(['register', 'authorize']);
    expect(phone.counters().providerAuthSkipped).toBeUndefined();
  });

  it('with the option off, stamped late auths are still served (desktop behaviour)', async () => {
    const phone = makePhone();
    const event = groupPost(me, 1);
    await phone.store(event);

    phone.deliver(
      liveAuth(event, { authStartedAtMs: clock.now - 16 * SECOND })
    );
    await flush();

    expect(phone.kinds()).toEqual(['register', 'authorize']);
    expect(phone.counters().providerAuthSkipped).toBeUndefined();
  });

  it('handles an auth before 29 transfer statuses already queued', async () => {
    for (const profile of [GO_PROFILE, {}]) {
      const phone = makePhone(profile);
      const order: string[] = [];
      const processItem = phone.m.processChatResourceQueueItem.bind(phone.m);
      phone.m.processChatResourceQueueItem = (item: { status: string }) => {
        order.push(item.status);
        return processItem(item);
      };
      const authorize = phone.m.authorizeResource.bind(phone.m);
      phone.m.authorizeResource = (...args: unknown[]) => {
        order.push('AUTH');
        return authorize(...args);
      };
      for (let i = 0; i < 29; i += 1) {
        phone.deliver({ status: 'progress', transferId: nextTransferId() });
      }
      phone.deliver(rangeAuth(1, 1));
      await flush(20);

      // Transfer statuses handled before the auth started.
      const statusesFirst = order
        .slice(0, order.indexOf('AUTH'))
        .filter((status) => status === 'progress').length;
      expect(order.filter((status) => status === 'progress')).toHaveLength(29);
      expect(statusesFirst).toBe(profile === GO_PROFILE ? 0 : 29);
    }
  });
});

describe('serving: the history serve queue', () => {
  /** Keeps every admitted page in the queue (all serve slots taken). */
  const fillServeSlots = (phone: ReturnType<typeof makePhone>) => {
    phone.m.historyPageServeActive = 4;
  };
  const enqueue = (
    phone: ReturnType<typeof makePhone>,
    payload: ReturnType<typeof pageAuth>
  ) => phone.m.enqueueLinkedHistoryPageResource(payload, payload.auth);

  it('a full queue answers resource_provider_busy, which Hub 3.0.3 rotates on', async () => {
    for (const [profile, reason] of [
      [GO_PROFILE, 'resource_provider_busy'],
      [{}, 'history_provider_busy'],
    ] as const) {
      const phone = makePhone(profile);
      const event = groupPost(me, 1);
      await phone.store(event);
      fillServeSlots(phone);
      // Four queued per requester at most; the fifth is refused.
      for (const limit of [10, 20, 30, 40, 50]) {
        await enqueue(phone, pageAuth(event, {}, limit));
      }
      expect(phone.rejects().map((c) => c.payload.reason)).toEqual([reason]);
    }
  });

  it('drops a queued page the bridge gave up on without an answer; an unstamped one is refused busy', async () => {
    const phone = makePhone(GO_PROFILE);
    const event = groupPost(me, 1);
    await phone.store(event);
    fillServeSlots(phone);
    await enqueue(phone, pageAuth(event, { authStartedAtMs: clock.now }, 10));
    await enqueue(phone, pageAuth(event, {}, 20));

    clock.now += RETICULUM_CHAT_PROVIDER_AUTH_WINDOW_MS + SECOND;
    phone.m.processHistoryPageServeQueue();
    await flush();

    expect(phone.m.historyPageServeQueue).toHaveLength(0);
    expect(phone.rejects().map((c) => c.payload.reason)).toEqual([
      'resource_provider_busy',
    ]);
    expect(phone.counters().providerAuthSkipped_history_page_queued).toBe(1);
  });
});

describe('serving: local history check', () => {
  it('hasGroupEvents answers as getKnownGroupIds().includes does', async () => {
    const phone = makePhone();
    const db = phone.m.db;
    const check = (groupId: number) => {
      expect(db.hasGroupEvents(groupId)).toBe(
        db.getKnownGroupIds().includes(groupId)
      );
      return db.hasGroupEvents(groupId);
    };
    // Empty database.
    expect(check(GROUP_ID)).toBe(false);
    // Stored.
    await phone.store(groupPost(me, 1));
    expect(check(GROUP_ID)).toBe(true);
    // Memory only.
    const memoryOnly = {
      ...groupPost(me, 2),
      eventId: 'memory-1',
      groupId: 78,
    };
    db.memoryEvents.set(memoryOnly.eventId, memoryOnly);
    expect(check(78)).toBe(true);
    // Unknown and invalid ids.
    expect(check(79)).toBe(false);
    expect(check(0)).toBe(false);
    expect(check(-1)).toBe(false);
  });
});

describe('engine noise (inlineDigestBuilds, stale dm_notify)', () => {
  it('builds digest state and the author tree inline with the option, without a worker fallback warning', async () => {
    for (const inline of [true, false]) {
      const phone = makePhone(inline ? { inlineDigestBuilds: true } : {});
      await phone.store(groupPost(me, 1));
      // The shipped GO worker has no VITEST: the pool is the stub that
      // always answers null.
      vi.stubEnv('VITEST', '');
      const run = vi
        .spyOn(phone.m.authorTreeWorkerPool, 'run')
        .mockResolvedValue(null);
      const logs = captureLogs();

      await expect(
        phone.m.ensureGroupDigestState(GROUP_ID, 'test')
      ).resolves.toBe(true);
      const tree = await phone.m.ensureAuthorTreeSnapshot(GROUP_ID);
      vi.unstubAllEnvs();

      expect(tree?.groupId).toBe(GROUP_ID);
      const fallbacks = logs.filter((l) => l.includes('worker_fallback'));
      if (inline) {
        expect(run).not.toHaveBeenCalled();
        expect(fallbacks).toEqual([]);
      } else {
        expect(run).toHaveBeenCalled();
        expect(fallbacks.length).toBeGreaterThan(0);
      }
      vi.restoreAllMocks();
    }
  });

  const notifyWire = (timestamp: number, junkSignature = false) => {
    const requestId = nextTransferId();
    const fields = buildReticulumDmNotifySignedFields({
      peerAddress: me.address,
      sourcePeerHash: HUB_PEER,
      requestId,
      maxHops: 0,
      authorAddress: member.address,
      authorPublicKey: member.publicKey,
      timestamp,
    });
    return {
      t: 'RCHAT',
      k: 'dm_notify',
      d: {
        b: me.address,
        sp: HUB_PEER,
        q: requestId,
        m: 0,
        p: member.publicKey,
        n: timestamp,
        z: junkSignature
          ? base58Encode(nacl.randomBytes(64))
          : sign(fields, member),
      },
    };
  };

  it('reports a dm_notify past its window as stale (counted, one line per 30 s), and a bad signature as before', async () => {
    const phone = makePhone();
    const logs = captureLogs();
    const rejected = () => logs.filter((l) => l.includes('dm_notify_rejected'));

    await phone.m.handleDirectNotify(
      notifyWire(clock.now - 410 * SECOND),
      HUB_PEER
    );
    await phone.m.handleDirectNotify(
      notifyWire(clock.now - 300 * SECOND),
      HUB_PEER
    );
    expect(phone.counters().dmNotifyStale).toBe(2);
    expect(rejected()).toHaveLength(1);
    expect(rejected()[0]).toContain('reason=stale age_ms=410000');

    // A fresh wire with a well-formed but wrong signature.
    await phone.m.handleDirectNotify(notifyWire(clock.now, true), HUB_PEER);
    await flush();
    expect(rejected()).toHaveLength(2);
    expect(rejected()[1]).toContain('reason=bad_signature');
    expect(rejected()[1]).not.toContain('bad_signature_or_shape');
    expect(phone.counters().dmNotifyStale).toBe(2);

    // The next stale one after 30 s logs again, with the count since.
    clock.now += 31 * SECOND;
    await phone.m.handleDirectNotify(
      notifyWire(clock.now - 200 * SECOND),
      HUB_PEER
    );
    expect(rejected()).toHaveLength(3);
    expect(rejected()[2]).toContain('reason=stale age_ms=200000 stale=2');
  });
});
