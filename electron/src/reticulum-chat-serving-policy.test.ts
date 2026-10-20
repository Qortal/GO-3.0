import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

// GO's serving policy (round 2): stale-member serves while Core is down
// (staleMemberServeTtlMs), request freshness judged at arrival
// (verifyServeAtArrival, with the bridge's authDeadlineAtMs) and shedding
// history-class serves under load (shedHistoryServesUnderLoad). The serve
// paths read real rows, so ReticulumChatDatabase runs on Node's built-in
// SQLite (node:sqlite) through a minimal better-sqlite3 adapter, as in
// reticulum-chat-serving.test.ts.
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
  buildReticulumChatResourceAuthSignedFields,
  buildReticulumChatSignedFields,
  hashReticulumChatPayload,
  ReticulumChatManager,
  type ReticulumChatEvent,
  type ReticulumChatMobileProfile,
} from './reticulum-chat';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

type Identity = { address: string; publicKey: string; secretKey: Uint8Array };
type Answer = boolean | null | Promise<boolean | null>;

const GROUP_ID = 77;
const GO_PEER = 'a1'.repeat(16);
const HUB_PEER = 'c3'.repeat(16);
const MY_STREAM = 'd'.repeat(32);
const OTHER_STREAM = 'e'.repeat(32);
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-serve-policy-'));
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

/** This phone's account, a Hub user pulling from it, and another author. */
const me = identity();
const member = identity();
const other = identity();

let idCounter = 0;
function nextTransferId(): string {
  idCounter += 1;
  return idCounter.toString(16).padStart(16, '0');
}

/** A distinct 32-hex peer hash per Hub (one active history serve each). */
function hubPeer(n: number): string {
  return n.toString(16).padStart(2, '0').repeat(16);
}

function groupPost(
  author: Identity,
  seq: number,
  channelId = 'general'
): ReticulumChatEvent {
  idCounter += 1;
  const eventId = `post-${idCounter.toString(16).padStart(8, '0')}`;
  const encryptedPayload = `ciphertext-${eventId}`;
  const event: ReticulumChatEvent = {
    eventId,
    groupId: GROUP_ID,
    channelId,
    authorAddress: author.address,
    authorPublicKey: author.publicKey,
    authorStreamId: author === me ? MY_STREAM : OTHER_STREAM,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type PhoneOptions = {
  /** Core's member answer per requester address (default: member). */
  member?: (address: string) => Answer;
  /** Core's admin answer per address (default: cannot answer). */
  admin?: (address: string) => Answer;
};

/** A GO phone serving its stored group history to Hubs. */
function makePhone(
  profile: ReticulumChatMobileProfile = {},
  options: PhoneOptions = {}
) {
  const calls: Array<{ kind: string; payload: Record<string, any> }> = [];
  const memberChecks: string[] = [];
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
    validateGroupMember: async (_groupId: number, address: string) => {
      memberChecks.push(address);
      return options.member ? options.member(address) : true;
    },
    validateGroupAdmin: async (_groupId: number, address: string) =>
      options.admin ? options.admin(address) : null,
    mobileProfile: profile,
  });
  managers.push(manager);
  manager.setLocalGroupMemberships([
    { groupId: GROUP_ID, localAddress: me.address },
  ]);
  const m = manager as any;
  const answerFor = (transferId: string) =>
    calls.filter(
      (call) =>
        call.kind !== 'register' && call.payload.transferId === transferId
    );
  return {
    manager,
    m,
    calls,
    memberChecks,
    counters: () => manager.getDeliveryCounters(),
    store: async (event: ReticulumChatEvent) =>
      expect(await m.acceptEvent(event, false)).toBe(true),
    deliver: (payload: Record<string, unknown>) =>
      bridge.emit('reticulum-chat-resource', payload),
    /** 'authorize', 'reject:<reason>' or 'none' for one transfer. */
    outcome: (transferId: string) => {
      const answer = answerFor(transferId)[0];
      if (!answer) return 'none';
      return answer.kind === 'reject'
        ? `reject:${answer.payload.reason}`
        : answer.kind;
    },
    authorizedOrder: () =>
      calls
        .filter((call) => call.kind === 'authorize')
        .map((call) => call.payload.transferId as string),
  };
}

type Stamps = {
  authStartedAtMs?: number;
  arrivedAtMs?: number;
  authDeadlineAtMs?: number;
};
type AuthOptions = {
  stamps?: Stamps;
  requester?: Identity;
  peer?: string;
  /** The requester's signature time (default: now). */
  signedAt?: number;
};

/** Fresh bridge stamps as GO's Android bridge sends them. */
const freshStamps = (): Stamps => ({
  arrivedAtMs: clock.now,
  authStartedAtMs: clock.now,
});

/** A Hub's signed pull of one event (linked live event). */
function liveAuth(event: ReticulumChatEvent, options: AuthOptions = {}) {
  const requester = options.requester ?? member;
  const peer = options.peer ?? HUB_PEER;
  const transferId = nextTransferId();
  const request = {
    transferId,
    eventId: event.eventId,
    groupId: GROUP_ID,
    requesterPeerHash: peer,
    providerPeerHash: GO_PEER,
    authorAddress: requester.address,
    authorPublicKey: requester.publicKey,
    timestamp: options.signedAt ?? clock.now,
  };
  return {
    status: 'auth',
    linkId: `link-${transferId}`,
    transferId,
    peerPresenceHash: peer,
    resourceType: 'reticulum_chat_event',
    metadata: { logicalResourceType: 'reticulum_chat_live_event' },
    auth: {
      type: 'RETICULUM_CHAT_LINKED_EVENT_REQUEST',
      ...request,
      signature: sign(
        buildReticulumChatLinkedEventRequestSignedFields(request),
        requester
      ),
    },
    ...(options.stamps ?? {}),
  };
}

/** A Hub's signed author-range pull over `author`'s stream. */
function rangeAuth(
  author: Identity,
  from: number,
  to: number,
  options: AuthOptions = {}
) {
  const requester = options.requester ?? member;
  const peer = options.peer ?? HUB_PEER;
  const transferId = nextTransferId();
  const range = {
    a: author.address,
    s: author === me ? MY_STREAM : OTHER_STREAM,
    from,
    to,
  };
  const signed = {
    transferId,
    groupId: GROUP_ID,
    range,
    limit: 100,
    requesterPeerHash: peer,
    providerPeerHash: GO_PEER,
    authorAddress: requester.address,
    authorPublicKey: requester.publicKey,
    timestamp: options.signedAt ?? clock.now,
  };
  return {
    status: 'auth',
    linkId: `link-${transferId}`,
    transferId,
    peerPresenceHash: peer,
    resourceType: 'reticulum_chat_event',
    metadata: { logicalResourceType: 'reticulum_chat_author_range' },
    auth: {
      type: 'RETICULUM_CHAT_LINKED_AUTHOR_RANGE_REQUEST',
      ...signed,
      signature: sign(
        buildReticulumChatLinkedAuthorRangeRequestSignedFields(signed),
        requester
      ),
    },
    ...(options.stamps ?? {}),
  };
}

/** A Hub's signed history page pull (newest page at or before `cursor`). */
function pageAuth(
  cursor: ReticulumChatEvent,
  options: AuthOptions & { channelId?: string } = {}
) {
  const requester = options.requester ?? member;
  const peer = options.peer ?? HUB_PEER;
  const channelId = options.channelId ?? '*';
  const transferId = nextTransferId();
  const at = { id: cursor.eventId, ts: cursor.timestamp };
  const ts = options.signedAt ?? clock.now;
  const fields = buildReticulumChatHistoryPageRequestSignedFields({
    groupId: GROUP_ID,
    channelId,
    direction: 'before',
    before: at,
    includeCursor: true,
    limit: 100,
    authorAddress: requester.address,
    authorPublicKey: requester.publicKey,
    timestamp: ts,
  });
  return {
    status: 'auth',
    linkId: `link-${transferId}`,
    transferId,
    peerPresenceHash: peer,
    resourceType: 'reticulum_chat_event',
    metadata: { logicalResourceType: 'reticulum_chat_history_page' },
    auth: {
      type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
      transferId,
      groupId: GROUP_ID,
      c: channelId,
      d: 'before',
      before: at,
      inc: 1,
      limit: 100,
      a: requester.address,
      pk: requester.publicKey,
      ts,
      sig: sign(fields, requester),
    },
    ...(options.stamps ?? {}),
  };
}

/** An author manifest pull; shedding refuses it before any parsing. */
function manifestAuth(options: AuthOptions = {}) {
  const requester = options.requester ?? member;
  const peer = options.peer ?? HUB_PEER;
  const transferId = nextTransferId();
  return {
    status: 'auth',
    linkId: `link-${transferId}`,
    transferId,
    peerPresenceHash: peer,
    resourceType: 'reticulum_chat_event',
    metadata: { logicalResourceType: 'reticulum_chat_author_manifest' },
    auth: {
      type: 'RETICULUM_CHAT_AUTHOR_MANIFEST_REQUEST',
      transferId,
      groupId: GROUP_ID,
      root: 'a'.repeat(64),
      baseRoot: 'b'.repeat(64),
      requesterPeerHash: peer,
      providerPeerHash: GO_PEER,
      authorAddress: requester.address,
      authorPublicKey: requester.publicKey,
      timestamp: options.signedAt ?? clock.now,
      signature: 'unsigned',
    },
    ...(options.stamps ?? {}),
  };
}

const waitForAnswers = async (
  phone: ReturnType<typeof makePhone>,
  transferIds: string[]
) =>
  vi.waitFor(
    () => {
      for (const id of transferIds) {
        expect(phone.outcome(id)).not.toBe('none');
      }
    },
    { timeout: 5_000, interval: 10 }
  );

// ---------------------------------------------------------------------------
// D4: serving while Core is down (staleMemberServeTtlMs = 1 h)
// ---------------------------------------------------------------------------

const STALE_PROFILE: ReticulumChatMobileProfile = {
  immediateProviderAuth: true,
  rotatableServeBusy: true,
  staleMemberServeTtlMs: HOUR,
};

describe('serving policy: a recent Core "member" answer while Core is down', () => {
  it('serves within 1 h of the last member answer, and refuses after it', async () => {
    let core: boolean | null = true;
    const phone = makePhone(STALE_PROFILE, { member: () => core });
    const event = groupPost(me, 1);
    await phone.store(event);

    const first = liveAuth(event, { stamps: freshStamps() });
    phone.deliver(first);
    await waitForAnswers(phone, [first.transferId]);
    expect(phone.outcome(first.transferId)).toBe('authorize');

    // 10 minutes later the member cache has expired and Core is down.
    clock.now += 10 * MINUTE;
    core = null;
    const live = liveAuth(event, { stamps: freshStamps() });
    const range = rangeAuth(me, 1, 1, { stamps: freshStamps() });
    const page = pageAuth(event, { stamps: freshStamps() });
    phone.deliver(live);
    phone.deliver(range);
    phone.deliver(page);
    await waitForAnswers(phone, [
      live.transferId,
      range.transferId,
      page.transferId,
    ]);
    expect(phone.outcome(live.transferId)).toBe('authorize');
    expect(phone.outcome(range.transferId)).toBe('authorize');
    expect(phone.outcome(page.transferId)).toBe('authorize');
    expect(phone.counters().requesterMembershipStaleAllowed).toBe(3);

    // 61 minutes after the last member answer: no longer.
    clock.now += 51 * MINUTE;
    const late = liveAuth(event, { stamps: freshStamps() });
    phone.deliver(late);
    await waitForAnswers(phone, [late.transferId]);
    expect(phone.outcome(late.transferId)).toBe(
      'reject:requester_membership_unavailable'
    );
    expect(phone.counters().requesterMembershipStaleAllowed).toBe(3);
  });

  it('a member Core now says is kicked is refused at once, and stays refused while Core is down', async () => {
    let core: boolean | null = true;
    const phone = makePhone(STALE_PROFILE, { member: () => core });
    const event = groupPost(me, 1);
    await phone.store(event);
    const first = liveAuth(event, { stamps: freshStamps() });
    phone.deliver(first);
    await waitForAnswers(phone, [first.transferId]);
    expect(phone.outcome(first.transferId)).toBe('authorize');

    clock.now += 6 * MINUTE;
    core = false;
    const kicked = liveAuth(event, { stamps: freshStamps() });
    phone.deliver(kicked);
    await waitForAnswers(phone, [kicked.transferId]);
    expect(phone.outcome(kicked.transferId)).toBe(
      'reject:requester_not_group_member'
    );

    // Still inside 1 h of the old member answer, Core down: the kick wins.
    clock.now += 6 * MINUTE;
    core = null;
    const later = liveAuth(event, { stamps: freshStamps() });
    phone.deliver(later);
    await waitForAnswers(phone, [later.transferId]);
    expect(phone.outcome(later.transferId)).toBe(
      'reject:requester_membership_unavailable'
    );
    expect(phone.counters().requesterMembershipStaleAllowed).toBeUndefined();
  });

  it('a requester Core never confirmed is refused while Core is down', async () => {
    const phone = makePhone(STALE_PROFILE, { member: () => null });
    const event = groupPost(me, 1);
    await phone.store(event);
    const auth = liveAuth(event, { stamps: freshStamps() });
    phone.deliver(auth);
    await waitForAnswers(phone, [auth.transferId]);
    expect(phone.outcome(auth.transferId)).toBe(
      'reject:requester_membership_unavailable'
    );
    expect(phone.counters().requesterMembershipStaleAllowed).toBeUndefined();
  });

  it('a calendar authorize still needs a live Core answer', async () => {
    let core: boolean | null = true;
    const phone = makePhone(STALE_PROFILE, { member: () => core });
    const event = groupPost(me, 1);
    await phone.store(event);
    const first = liveAuth(event, { stamps: freshStamps() });
    phone.deliver(first);
    await waitForAnswers(phone, [first.transferId]);

    clock.now += 10 * MINUTE;
    core = null;
    const transferId = nextTransferId();
    phone.m.outboundCalendarResources.set(transferId, {
      groupId: GROUP_ID,
      peerHash: HUB_PEER,
      fileHash: 'f'.repeat(64),
      filePath: '',
      expiresAt: clock.now + MINUTE,
    });
    const ts = clock.now;
    phone.deliver({
      status: 'auth',
      linkId: `link-${transferId}`,
      transferId,
      peerPresenceHash: HUB_PEER,
      resourceType: 'reticulum_chat_calendar',
      auth: {
        t: 'RCP',
        x: transferId,
        g: GROUP_ID,
        a: member.address,
        p: member.publicKey,
        ts,
        z: sign(
          buildReticulumChatResourceAuthSignedFields({
            groupId: GROUP_ID,
            transferId,
            authorAddress: member.address,
            authorPublicKey: member.publicKey,
            timestamp: ts,
          }),
          member
        ),
      },
      ...freshStamps(),
    });
    await waitForAnswers(phone, [transferId]);
    expect(phone.outcome(transferId)).toBe(
      'reject:requester_membership_unavailable'
    );
    // The same requester's history serve at the same moment is allowed.
    const live = liveAuth(event, { stamps: freshStamps() });
    phone.deliver(live);
    await waitForAnswers(phone, [live.transferId]);
    expect(phone.outcome(live.transferId)).toBe('authorize');
    // Accepting events, calendar membership and admin checks never use it.
    expect(
      await phone.m.isValidatedCalendarMember(GROUP_ID, member.address)
    ).toBe(false);
    expect(
      await phone.m.isValidatedRequesterGroupMember(
        GROUP_ID,
        member.address,
        'calendar_resource'
      )
    ).toBeNull();
    expect(
      await phone.m.isValidatedGroupMember(GROUP_ID, member.address)
    ).toBeNull();
  });

  it('an admin-private channel page still needs a real admin answer', async () => {
    let core: boolean | null = true;
    let admin: boolean | null = null;
    const phone = makePhone(STALE_PROFILE, {
      member: () => core,
      admin: () => admin,
    });
    phone.m.db.upsertChannel({
      groupId: GROUP_ID,
      channelId: 'staff',
      name: 'staff',
      position: 1,
      archived: false,
      writeMode: 'admins',
      readMode: 'admins',
      createdBy: me.address,
      createdAt: 10_000,
      updatedAt: 10_000,
    });
    const general = groupPost(me, 1);
    const staff = groupPost(me, 2, 'staff');
    await phone.store(general);
    await phone.store(staff);
    const first = liveAuth(general, { stamps: freshStamps() });
    phone.deliver(first);
    await waitForAnswers(phone, [first.transferId]);

    clock.now += 10 * MINUTE;
    core = null;
    const staffPage = pageAuth(staff, {
      channelId: 'staff',
      stamps: freshStamps(),
    });
    const generalPage = pageAuth(general, {
      channelId: 'general',
      stamps: freshStamps(),
    });
    phone.deliver(staffPage);
    phone.deliver(generalPage);
    await waitForAnswers(phone, [staffPage.transferId, generalPage.transferId]);
    expect(phone.outcome(staffPage.transferId)).toBe(
      'reject:channel_read_forbidden'
    );
    expect(phone.outcome(generalPage.transferId)).toBe('authorize');

    // Core confirms the admin: the same channel is served (member still
    // from the recent answer).
    clock.now += 31 * SECOND;
    admin = true;
    const adminPage = pageAuth(staff, {
      channelId: 'staff',
      stamps: freshStamps(),
    });
    phone.deliver(adminPage);
    await waitForAnswers(phone, [adminPage.transferId]);
    expect(phone.outcome(adminPage.transferId)).toBe('authorize');
  });

  it('with the option unset, a Core outage refuses the member as before', async () => {
    let core: boolean | null = true;
    const phone = makePhone(
      { immediateProviderAuth: true, rotatableServeBusy: true },
      { member: () => core }
    );
    const event = groupPost(me, 1);
    await phone.store(event);
    const first = liveAuth(event, { stamps: freshStamps() });
    phone.deliver(first);
    await waitForAnswers(phone, [first.transferId]);
    clock.now += 10 * MINUTE;
    core = null;
    const auth = liveAuth(event, { stamps: freshStamps() });
    phone.deliver(auth);
    await waitForAnswers(phone, [auth.transferId]);
    expect(phone.outcome(auth.transferId)).toBe(
      'reject:requester_membership_unavailable'
    );
    expect(phone.m.requesterMemberConfirmedAt.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// D6 (engine): freshness judged at arrival, the bridge's stated deadline
// ---------------------------------------------------------------------------

const ARRIVAL_PROFILE: ReticulumChatMobileProfile = {
  immediateProviderAuth: true,
  rotatableServeBusy: true,
  verifyServeAtArrival: true,
};

describe('serving policy: request freshness judged at arrival', () => {
  it('a live pull signed 100 s before arrival, answered 25 s after it (30 s window), still verifies', async () => {
    const phone = makePhone(ARRIVAL_PROFILE);
    const event = groupPost(me, 1);
    await phone.store(event);
    const arrival = clock.now;
    const auth = liveAuth(event, {
      signedAt: arrival - 100 * SECOND,
      stamps: {
        arrivedAtMs: arrival,
        authStartedAtMs: arrival,
        authDeadlineAtMs: arrival + 30 * SECOND,
      },
    });
    clock.now = arrival + 25 * SECOND;
    phone.deliver(auth);
    await waitForAnswers(phone, [auth.transferId]);

    expect(phone.outcome(auth.transferId)).toBe('authorize');
    expect(phone.counters().serveFreshOnlyAtArrival).toBe(1);
    // The stated 30 s deadline, not 15 s, decides when it is gone.
    expect(phone.counters().providerAuthSkipped).toBeUndefined();
  });

  it('without the option the same pull is too old (desktop behaviour)', async () => {
    const phone = makePhone({
      immediateProviderAuth: true,
      rotatableServeBusy: true,
    });
    const event = groupPost(me, 1);
    await phone.store(event);
    const arrival = clock.now;
    const auth = liveAuth(event, {
      signedAt: arrival - 100 * SECOND,
      stamps: {
        arrivedAtMs: arrival,
        authStartedAtMs: arrival,
        authDeadlineAtMs: arrival + 30 * SECOND,
      },
    });
    clock.now = arrival + 25 * SECOND;
    phone.deliver(auth);
    await waitForAnswers(phone, [auth.transferId]);
    expect(phone.outcome(auth.transferId)).toBe(
      'reject:signed_request_required'
    );
  });

  it('never accepts a request whose arrival stamp is older than the bridge window', async () => {
    // The stale gate is off here so the verify itself is what refuses.
    const phone = makePhone({ verifyServeAtArrival: true });
    const event = groupPost(me, 1);
    await phone.store(event);
    const cases: Array<{ stamps: Stamps; signedAgo: number; label: string }> =
      [];
    // 35 s after arrival with a 30 s window; signed 100 s before arrival.
    let arrival = clock.now - 35 * SECOND;
    cases.push({
      label: 'past the stated window',
      signedAgo: 135 * SECOND,
      stamps: {
        arrivedAtMs: arrival,
        authStartedAtMs: arrival,
        authDeadlineAtMs: arrival + 30 * SECOND,
      },
    });
    // No stated deadline: the 15 s window; 20 s after arrival.
    arrival = clock.now - 20 * SECOND;
    cases.push({
      label: 'past the default window',
      signedAgo: 125 * SECOND,
      stamps: { arrivedAtMs: arrival, authStartedAtMs: arrival },
    });
    // A stated 60 s window counts as 30 s; 40 s after arrival.
    arrival = clock.now - 40 * SECOND;
    cases.push({
      label: 'stated window cut to 30 s',
      signedAgo: 130 * SECOND,
      stamps: {
        arrivedAtMs: arrival,
        authStartedAtMs: arrival,
        authDeadlineAtMs: arrival + 60 * SECOND,
      },
    });
    const auths = cases.map((c) =>
      liveAuth(event, { signedAt: clock.now - c.signedAgo, stamps: c.stamps })
    );
    for (const auth of auths) phone.deliver(auth);
    await waitForAnswers(
      phone,
      auths.map((a) => a.transferId)
    );
    for (const auth of auths) {
      expect(phone.outcome(auth.transferId)).toBe(
        'reject:signed_request_required'
      );
    }
    expect(phone.counters().serveFreshOnlyAtArrival).toBeUndefined();
  });

  it('only freshness moves: a bad signature is refused at arrival too', async () => {
    const phone = makePhone(ARRIVAL_PROFILE);
    const event = groupPost(me, 1);
    await phone.store(event);
    const arrival = clock.now;
    const auth = liveAuth(event, {
      signedAt: arrival - 100 * SECOND,
      stamps: {
        arrivedAtMs: arrival,
        authStartedAtMs: arrival,
        authDeadlineAtMs: arrival + 30 * SECOND,
      },
    });
    (auth.auth as Record<string, unknown>).eventId = groupPost(me, 2).eventId;
    clock.now = arrival + 25 * SECOND;
    phone.deliver(auth);
    await waitForAnswers(phone, [auth.transferId]);
    expect(phone.outcome(auth.transferId)).toBe(
      'reject:signed_request_required'
    );
  });

  it('history pages and author ranges are judged at arrival as well', async () => {
    const phone = makePhone(ARRIVAL_PROFILE);
    const event = groupPost(me, 1);
    await phone.store(event);
    const arrival = clock.now;
    const stamps = { arrivedAtMs: arrival, authStartedAtMs: arrival };
    const page = pageAuth(event, { signedAt: arrival - 110 * SECOND, stamps });
    const range = rangeAuth(me, 1, 1, {
      signedAt: arrival - 110 * SECOND,
      stamps,
    });
    clock.now = arrival + 12 * SECOND;
    phone.deliver(page);
    phone.deliver(range);
    await waitForAnswers(phone, [page.transferId, range.transferId]);
    expect(phone.outcome(page.transferId)).toBe('authorize');
    expect(phone.outcome(range.transferId)).toBe('authorize');
  });

  it('a request stamped as signed after it arrived is judged at now, as before', async () => {
    const phone = makePhone(ARRIVAL_PROFILE);
    const event = groupPost(me, 1);
    await phone.store(event);
    const arrival = clock.now;
    // Requester clock 40 s ahead: 40 s past arrival but only 30 s past now.
    const auth = liveAuth(event, {
      signedAt: arrival + 40 * SECOND,
      stamps: {
        arrivedAtMs: arrival,
        authStartedAtMs: arrival,
        authDeadlineAtMs: arrival + 30 * SECOND,
      },
    });
    clock.now = arrival + 10 * SECOND;
    phone.deliver(auth);
    await waitForAnswers(phone, [auth.transferId]);
    expect(phone.outcome(auth.transferId)).toBe('authorize');
  });

  it('the stale gate uses the stated deadline, and 15 s without one', async () => {
    const phone = makePhone(ARRIVAL_PROFILE);
    const event = groupPost(me, 1);
    await phone.store(event);
    const started = clock.now - 20 * SECOND;
    const withDeadline = liveAuth(event, {
      stamps: {
        arrivedAtMs: started,
        authStartedAtMs: started,
        authDeadlineAtMs: started + 30 * SECOND,
      },
    });
    const withoutDeadline = liveAuth(event, {
      stamps: { arrivedAtMs: started, authStartedAtMs: started },
    });
    phone.deliver(withDeadline);
    phone.deliver(withoutDeadline);
    await waitForAnswers(phone, [withDeadline.transferId]);
    await flush();
    expect(phone.outcome(withDeadline.transferId)).toBe('authorize');
    expect(phone.outcome(withoutDeadline.transferId)).toBe('none');
    expect(phone.counters().providerAuthSkipped_live_event_entry).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B7: shedding history-class serves under load
// ---------------------------------------------------------------------------

const SHED_PROFILE: ReticulumChatMobileProfile = {
  immediateProviderAuth: true,
  rotatableServeBusy: true,
  shedHistoryServesUnderLoad: true,
};

describe('serving policy: history serves shed under load', () => {
  /** Requesters whose Core answer waits until released. */
  const gatedPhone = async (profile = SHED_PROFILE) => {
    const gates = new Map<string, ReturnType<typeof deferred<boolean>>>();
    const phone = makePhone(profile, {
      member: (address) => gates.get(address)?.promise ?? true,
    });
    const hold = (who: Identity) => {
      const gate = deferred<boolean>();
      gates.set(who.address, gate);
      return () => {
        gates.delete(who.address);
        gate.resolve(true);
      };
    };
    for (let seq = 1; seq <= 3; seq += 1)
      await phone.store(groupPost(other, seq));
    const mine = groupPost(me, 1);
    await phone.store(mine);
    return { phone, hold, mine };
  };

  it('with a live serve running and 2 history serves building, a third author range is refused busy with no membership check', async () => {
    const { phone, hold, mine } = await gatedPhone();
    const liveRequester = identity();
    const a = identity();
    const b = identity();
    const c = identity();
    const releases = [hold(liveRequester), hold(a), hold(b), hold(c)];

    const live = liveAuth(mine, {
      requester: liveRequester,
      peer: hubPeer(1),
      stamps: freshStamps(),
    });
    const rangeA = rangeAuth(other, 1, 3, {
      requester: a,
      peer: hubPeer(2),
      stamps: freshStamps(),
    });
    const rangeB = rangeAuth(other, 1, 3, {
      requester: b,
      peer: hubPeer(3),
      stamps: freshStamps(),
    });
    phone.deliver(live);
    phone.deliver(rangeA);
    phone.deliver(rangeB);
    await flush();
    expect(phone.m.liveServesInFlight).toBe(1);
    expect(phone.m.historyPageServeActive).toBe(2);

    const rangeC = rangeAuth(other, 1, 3, {
      requester: c,
      peer: hubPeer(4),
      stamps: freshStamps(),
    });
    phone.deliver(rangeC);
    await waitForAnswers(phone, [rangeC.transferId]);
    expect(phone.outcome(rangeC.transferId)).toBe(
      'reject:resource_provider_busy'
    );
    expect(phone.memberChecks).not.toContain(c.address);
    expect(phone.counters()).toMatchObject({
      providerServeShed: 1,
      providerServeShed_author_range_load: 1,
    });

    for (const release of releases) release();
    await waitForAnswers(phone, [
      live.transferId,
      rangeA.transferId,
      rangeB.transferId,
    ]);
    expect(phone.outcome(live.transferId)).toBe('authorize');
    expect(phone.outcome(rangeA.transferId)).toBe('authorize');
    expect(phone.outcome(rangeB.transferId)).toBe('authorize');
    expect(phone.m.liveServesInFlight).toBe(0);
  });

  it('a live event is authorized while history serves wait in the queue', async () => {
    const { phone, hold, mine } = await gatedPhone();
    const a = identity();
    const b = identity();
    const c = identity();
    const releases = [hold(a), hold(b), hold(c)];
    const ranges = [a, b, c].map((requester, i) =>
      rangeAuth(other, 1, 3, {
        requester,
        peer: hubPeer(10 + i),
        stamps: freshStamps(),
      })
    );
    for (const range of ranges) phone.deliver(range);
    await flush();
    // Two build, the third waits (max 2 while shedding is on).
    expect(phone.m.historyPageServeActive).toBe(2);
    expect(phone.m.historyPageServeQueue).toHaveLength(1);
    expect(phone.memberChecks).not.toContain(c.address);

    const live = liveAuth(mine, { peer: hubPeer(20), stamps: freshStamps() });
    phone.deliver(live);
    await waitForAnswers(phone, [live.transferId]);
    expect(phone.authorizedOrder()).toEqual([live.transferId]);

    for (const release of releases) release();
    await waitForAnswers(
      phone,
      ranges.map((r) => r.transferId)
    );
    expect(phone.authorizedOrder()[0]).toBe(live.transferId);
    for (const range of ranges) {
      expect(phone.outcome(range.transferId)).toBe('authorize');
    }
  });

  it('a history-class auth that took 4 s or more to reach the engine is refused busy before any work; a live event is not', async () => {
    const { phone, mine } = await gatedPhone();
    const late = (): Stamps => ({
      arrivedAtMs: clock.now - 5 * SECOND,
      authStartedAtMs: clock.now - 5 * SECOND,
    });
    const range = rangeAuth(other, 1, 3, { stamps: late() });
    const page = pageAuth(mine, { stamps: late() });
    const manifest = manifestAuth({ stamps: late() });
    const live = liveAuth(mine, { peer: hubPeer(30), stamps: late() });
    for (const auth of [range, page, manifest, live]) phone.deliver(auth);
    await waitForAnswers(phone, [
      range.transferId,
      page.transferId,
      manifest.transferId,
      live.transferId,
    ]);
    expect(phone.outcome(range.transferId)).toBe(
      'reject:resource_provider_busy'
    );
    expect(phone.outcome(page.transferId)).toBe(
      'reject:resource_provider_busy'
    );
    expect(phone.outcome(manifest.transferId)).toBe(
      'reject:resource_provider_busy'
    );
    expect(phone.outcome(live.transferId)).toBe('authorize');
    expect(phone.counters()).toMatchObject({
      providerServeShed: 3,
      providerServeShed_author_range_late: 1,
      providerServeShed_history_page_late: 1,
      providerServeShed_author_manifest_late: 1,
    });
    // Only the live event's requester was checked.
    expect(phone.memberChecks.filter((a) => a === member.address)).toHaveLength(
      1
    );
  });

  it('never sheds this account own author range, even late and under load', async () => {
    const { phone, hold, mine } = await gatedPhone();
    const liveRequester = identity();
    const a = identity();
    const b = identity();
    const releases = [hold(liveRequester), hold(a), hold(b)];
    const live = liveAuth(mine, {
      requester: liveRequester,
      peer: hubPeer(40),
      stamps: freshStamps(),
    });
    phone.deliver(live);
    const ranges = [
      [a, 41],
      [b, 42],
    ].map(([requester, n]) =>
      rangeAuth(other, 1, 3, {
        requester: requester as Identity,
        peer: hubPeer(n as number),
        stamps: freshStamps(),
      })
    );
    for (const range of ranges) phone.deliver(range);
    await flush();
    expect(phone.m.historyPageServeActive).toBe(2);

    const own = rangeAuth(me, 1, 1, {
      peer: hubPeer(43),
      stamps: {
        arrivedAtMs: clock.now - 5 * SECOND,
        authStartedAtMs: clock.now - 5 * SECOND,
      },
    });
    phone.deliver(own);
    await waitForAnswers(phone, [own.transferId]);
    expect(phone.outcome(own.transferId)).toBe('authorize');
    expect(phone.counters().providerServeShed).toBeUndefined();
    for (const release of releases) release();
    await waitForAnswers(phone, [
      live.transferId,
      ...ranges.map((r) => r.transferId),
    ]);
  });

  it('never sheds an auth without the bridge stamps (desktop bridges)', async () => {
    const { phone, hold, mine } = await gatedPhone();
    const liveRequester = identity();
    const a = identity();
    const b = identity();
    const c = identity();
    const releases = [hold(liveRequester), hold(a), hold(b)];
    phone.deliver(
      liveAuth(mine, { requester: liveRequester, peer: hubPeer(50) })
    );
    const ranges = [a, b, c].map((requester, i) =>
      rangeAuth(other, 1, 3, { requester, peer: hubPeer(51 + i) })
    );
    for (const range of ranges) phone.deliver(range);
    await flush();
    // The third waits in the queue instead of being refused.
    expect(phone.outcome(ranges[2].transferId)).toBe('none');
    expect(phone.m.historyPageServeQueue).toHaveLength(1);
    for (const release of releases) release();
    await waitForAnswers(
      phone,
      ranges.map((r) => r.transferId)
    );
    for (const range of ranges) {
      expect(phone.outcome(range.transferId)).toBe('authorize');
    }
    expect(phone.counters().providerServeShed).toBeUndefined();
  });

  it('with the option off, author ranges run unqueued and are never shed (desktop behaviour)', async () => {
    const { phone, hold, mine } = await gatedPhone({
      immediateProviderAuth: true,
      rotatableServeBusy: true,
    });
    const liveRequester = identity();
    const requesters = [identity(), identity(), identity()];
    const releases = [hold(liveRequester), ...requesters.map(hold)];
    phone.deliver(
      liveAuth(mine, {
        requester: liveRequester,
        peer: hubPeer(60),
        stamps: freshStamps(),
      })
    );
    const late = {
      arrivedAtMs: clock.now - 5 * SECOND,
      authStartedAtMs: clock.now - 5 * SECOND,
    };
    const ranges = requesters.map((requester, i) =>
      rangeAuth(other, 1, 3, { requester, peer: hubPeer(61 + i), stamps: late })
    );
    for (const range of ranges) phone.deliver(range);
    await flush();
    // All three ask Core at once: nothing queued, nothing refused.
    for (const requester of requesters) {
      expect(phone.memberChecks).toContain(requester.address);
    }
    expect(phone.m.historyPageServeQueue).toHaveLength(0);
    for (const release of releases) release();
    await waitForAnswers(
      phone,
      ranges.map((r) => r.transferId)
    );
    for (const range of ranges) {
      expect(phone.outcome(range.transferId)).toBe('authorize');
    }
    expect(phone.counters().providerServeShed).toBeUndefined();
  });
});
