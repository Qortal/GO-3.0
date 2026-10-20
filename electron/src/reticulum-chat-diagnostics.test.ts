import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Copy diagnostics getters of the engine (A26-A28): channel metadata per
// group, author-range repair outcomes, the membership backoff counter, the
// database size and rows, and the log text of channel metadata skips. Real
// engine and real SQL on Node's built-in SQLite (node:sqlite) through a
// minimal better-sqlite3 adapter, as in the channel metadata recovery tests.
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

vi.mock('./logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./logger')>()),
  log: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import * as logger from './logger';
import {
  buildReticulumChatSignedFields,
  hashReticulumChatPayload,
  ReticulumChatManager,
  type ReticulumChatEvent,
  type ReticulumChatEventType,
  type ReticulumChatMobileProfile,
} from './reticulum-chat';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

type Identity = { address: string; publicKey: string; secretKey: Uint8Array };

const DAY = 24 * 60 * 60_000;
const PEER = 'a1'.repeat(16);
const STREAM = 'f'.repeat(32);
const GO_PROFILE: ReticulumChatMobileProfile = {
  reprojectSkippedChannelMetadata: true,
  gapOutcomeAges: true,
};

const managers: ReticulumChatManager[] = [];
const tempRoots: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) {
    try {
      manager.close();
    } catch {
      // already closed
    }
  }
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  vi.mocked(logger.log).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.info).mockClear();
});

function identity(): Identity {
  const kp = nacl.sign.keyPair();
  const publicKey = base58Encode(kp.publicKey);
  return {
    address: deriveAddressFromPublicKey(publicKey),
    publicKey,
    secretKey: kp.secretKey,
  };
}

let seq = 1;
function signedEvent(
  author: Identity,
  groupId: number,
  eventType: ReticulumChatEventType,
  payload: Record<string, unknown>,
  timestamp: number,
  authorSeq = seq++
): ReticulumChatEvent {
  const encryptedPayload = JSON.stringify(payload);
  const event: ReticulumChatEvent = {
    eventId: `diag-${eventType}-${authorSeq}-${seq++}`,
    groupId,
    channelId: String(payload.channelId ?? 'general'),
    authorAddress: author.address,
    authorPublicKey: author.publicKey,
    authorStreamId: STREAM,
    authorSeq,
    timestamp,
    eventType,
    encryptedPayload,
    payloadHash: hashReticulumChatPayload(encryptedPayload),
    mentionAddressHashes: [],
    signature: '',
  } as ReticulumChatEvent;
  event.signature = base58Encode(
    nacl.sign.detached(
      new Uint8Array(
        canonicalizeForSigning(buildReticulumChatSignedFields(event) as any)
      ),
      author.secretKey
    )
  );
  return event;
}

function makeManager(options: {
  profile?: ReticulumChatMobileProfile;
  admin?: (groupId: number, address: string) => boolean | null;
  member?: (groupId: number, address: string) => boolean | null;
}): ReticulumChatManager {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-diag-'));
  tempRoots.push(root);
  const manager = new ReticulumChatManager({
    dbPath: path.join(root, 'reticulum-chat.db'),
    bridge: {
      on: () => undefined,
      off: () => undefined,
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
    } as any,
    // null = Core gave no answer.
    validateGroupMember: async (groupId: number, address: string) =>
      (options.member ? options.member(groupId, address) : true) as boolean,
    validateGroupAdmin: async (groupId: number, address: string) =>
      (options.admin ? options.admin(groupId, address) : false) as boolean,
    mobileProfile: options.profile,
  });
  managers.push(manager);
  return manager;
}

const logLines = (): string[] =>
  [logger.log, logger.warn, logger.info].flatMap((fn) =>
    vi
      .mocked(fn)
      .mock.calls.map((args) =>
        args
          .map((arg) => (typeof arg === 'string' ? arg : String(arg)))
          .join(' ')
      )
  );

describe('getChannelMetadataDiagnostics', () => {
  it('reports admin flags, custom channels, unprojected creates and skips per subscribed group', async () => {
    const local = identity();
    const exAdmin = identity();
    const m = makeManager({
      profile: GO_PROFILE,
      admin: (_g, address) => address === local.address,
    });
    m.setLocalGroupMemberships([
      {
        groupId: 694,
        isAdmin: true,
        adminStatusAuthoritative: true,
        localAddress: local.address,
      },
      {
        groupId: 581,
        isAdmin: false,
        adminStatusAuthoritative: false,
        localAddress: local.address,
      },
    ]);
    // An own channel in 694, applied.
    const own = signedEvent(
      local,
      694,
      'channel_create',
      { channelId: 'news', name: 'news', position: 1 },
      Date.now() - 5_000
    );
    (m as any).db.insertEvent(own, true);
    await m.applyChannelMetadataEvent(
      own.eventId,
      JSON.parse(own.encryptedPayload)
    );
    // A channel created by someone who is not admin (any more): skipped,
    // so its create stays unprojected.
    const orphan = signedEvent(
      exAdmin,
      694,
      'channel_create',
      { channelId: 'old-room', name: 'old-room', position: 2 },
      Date.now() - 4_000
    );
    (m as any).db.insertEvent(orphan, false);
    expect(
      await m.applyChannelMetadataEvent(
        orphan.eventId,
        JSON.parse(orphan.encryptedPayload)
      )
    ).toBe(false);
    m.subscribeGroup(694);
    m.subscribeGroup(581);
    const diagnostics = m.getChannelMetadataDiagnostics();
    expect(diagnostics.subscribedGroups).toBe(2);
    expect(diagnostics.groups.map((g) => g.groupId)).toEqual([581, 694]);
    const g694 = diagnostics.groups.find((g) => g.groupId === 694)!;
    expect(g694).toMatchObject({
      localAdmin: true,
      authoritative: true,
      expectedScope: 'full',
      snapshotState: 'missing_snapshot',
      publicVersion: null,
      fullVersion: null,
      signer: null,
      signerAdmin: null,
      customChannels: 1,
      unprojectedCreates: 1,
      skippedEvents: 1,
      skippedOwn: 0,
      skippedCreatesByOthers: 1,
      skippedOther: 0,
    });
    const g581 = diagnostics.groups.find((g) => g.groupId === 581)!;
    // Not admin per the list, but the list is not trusted and Core was
    // never asked for this account here: the scope is unknown.
    expect(g581).toMatchObject({
      localAdmin: false,
      authoritative: false,
      expectedScope: null,
      customChannels: 0,
      unprojectedCreates: 0,
      skippedEvents: 0,
    });
  });

  it('lists groups with recovery state, then the open group, first when there are more than 64', async () => {
    const local = identity();
    const exAdmin = identity();
    const m = makeManager({
      profile: GO_PROFILE,
      admin: (_g, address) => address === local.address,
    });
    const ids = Array.from({ length: 70 }, (_, i) => 1001 + i);
    m.setLocalGroupMemberships(
      ids.map((groupId) => ({
        groupId,
        isAdmin: false,
        adminStatusAuthoritative: true,
        localAddress: local.address,
      }))
    );
    for (const groupId of ids) m.subscribeGroup(groupId);
    // Every layout current, so only real trouble ranks.
    for (const groupId of ids)
      (m as any).metadataSnapshotStates.set(groupId, 'snapshot_current');
    // A skipped create in the highest id, past the cap by id order.
    const orphan = signedEvent(
      exAdmin,
      1070,
      'channel_create',
      { channelId: 'old-room', name: 'old-room', position: 2 },
      Date.now() - 4_000
    );
    (m as any).db.insertEvent(orphan, false);
    expect(
      await m.applyChannelMetadataEvent(
        orphan.eventId,
        JSON.parse(orphan.encryptedPayload)
      )
    ).toBe(false);
    (m as any).activeChannelSubscriptions.set(1069, new Set(['general']));

    const diagnostics = m.getChannelMetadataDiagnostics();
    expect(diagnostics.subscribedGroups).toBe(70);
    expect(diagnostics.groups).toHaveLength(64);
    expect(diagnostics.groups.slice(0, 3).map((g) => g.groupId)).toEqual([
      1070, 1069, 1001,
    ]);
    expect(diagnostics.groups[0].skippedEvents).toBe(1);
  });

  it('names where the admin answer came from and whose event was skipped', async () => {
    const local = identity();
    const other = identity();
    const m = makeManager({
      profile: GO_PROFILE,
      admin: (_g, address) => address === local.address,
    });
    m.setLocalGroupMemberships([
      {
        groupId: 77,
        isAdmin: false,
        adminStatusAuthoritative: true,
        localAddress: local.address,
      },
    ]);
    const skip = async (author: Identity, channelId: string) => {
      const event = signedEvent(
        author,
        77,
        'channel_create',
        { channelId, name: channelId, position: 1 },
        Date.now() - 1_000
      );
      (m as any).db.insertEvent(event, author === local);
      await m.applyChannelMetadataEvent(
        event.eventId,
        JSON.parse(event.encryptedPayload)
      );
    };
    await skip(other, 'a');
    await skip(other, 'b');
    // The page's admin list says this account is not admin here.
    await skip(local, 'c');
    const skips = logLines().filter((line) =>
      line.includes('channel_metadata_projection_skipped')
    );
    expect(skips).toHaveLength(3);
    expect(skips[0]).toMatch(
      /reason=author_not_group_admin decision=core author_role=other$/
    );
    expect(skips[1]).toMatch(/decision=cache author_role=other$/);
    expect(skips[2]).toMatch(/decision=list author_role=own$/);
    expect(
      logLines().some((line) =>
        /group_admin_validation_resolved group=77 .* status=not_admin decision=core author_role=other$/.test(
          line
        )
      )
    ).toBe(true);
  });
});

describe('author-range repair outcomes', () => {
  const range = (from: number, to = from) => ({
    a: 'QAuthorDiag',
    s: STREAM,
    from,
    to,
  });
  const header = (m: ReticulumChatManager, seqNo: number, timestamp: number) =>
    (m as any).db.db
      .prepare(
        `INSERT INTO rchat_event_headers
          (event_id, group_id, channel_id, author_address, author_public_key,
           author_stream_id, author_seq, timestamp, feed_timestamp, event_type,
           payload_hash, signature, last_served_at, stored_at, accepted_at,
           wire_bytes)
         VALUES (?, 9, 'general', 'QAuthorDiag', 'pk', ?, ?, ?, ?, 'message', 'hash', 'sig', 0, 0, 0, 1)`
      )
      .run(`h-${seqNo}`, STREAM, seqNo, timestamp, timestamp);

  it('sorts denials by the age of the next stored message (gapOutcomeAges)', () => {
    const m = makeManager({ profile: GO_PROFILE });
    const now = Date.now();
    header(m, 11, now - 40 * DAY);
    header(m, 21, now - DAY);
    const deny = (r: ReturnType<typeof range>) =>
      (m as any).handleAuthorRangeUnavailable(
        9,
        PEER,
        r,
        'linked_peer_confirmed_range_unavailable'
      );
    deny(range(10));
    deny(range(20));
    deny(range(30));
    (m as any).noteAuthorGapOutcome('requested');
    (m as any).noteAuthorGapOutcome('failed:resource_provider_busy');
    (m as any).noteAuthorGapOutcome('imported');
    (m as any).noteAuthorGapOutcome('imported_events', 5);
    const outcomes = (m as any).getAuthorGapScannerDiagnostics().outcomes;
    expect(outcomes.total).toEqual({
      unavailable_old: 1,
      unavailable_recent: 1,
      unavailable_undated: 1,
      requested: 1,
      'failed:resource_provider_busy': 1,
      imported: 1,
      imported_events: 5,
    });
    expect(outcomes.recent).toEqual(outcomes.total);
    expect(outcomes.minutes).toBe(1);
  });

  it('counts denials unsorted without the switch (upstream reads nothing more)', () => {
    const m = makeManager({});
    header(m, 11, Date.now() - 40 * DAY);
    const read = vi.spyOn((m as any).db, 'getAuthorSeqTimestamp');
    (m as any).handleAuthorRangeUnavailable(
      9,
      PEER,
      range(10),
      'linked_peer_confirmed_range_unavailable'
    );
    expect(read).not.toHaveBeenCalled();
    expect((m as any).getAuthorGapScannerDiagnostics().outcomes.total).toEqual({
      unavailable: 1,
    });
  });

  it('folds unknown failure reasons past the key cap', () => {
    const m = makeManager({});
    for (let i = 0; i < 40; i++) {
      (m as any).noteAuthorGapOutcome(`failed:reason_${i}`);
    }
    const total = (m as any).getAuthorGapScannerDiagnostics().outcomes.total;
    expect(Object.keys(total)).toHaveLength(33);
    expect(total['failed:other']).toBe(8);
  });
});

describe('membership and storage diagnostics', () => {
  it('counts membership checks answered unknown from the backoff', async () => {
    let answer: boolean | null = null;
    const m = makeManager({ member: () => answer });
    const check = () =>
      (m as any).getCoreValidatedGroupMembership(5, 'QMemberDiag');
    expect(await check()).toBeNull();
    expect(await check()).toBeNull();
    expect(await check()).toBeNull();
    answer = true;
    expect(m.getDeliveryCounters().membershipNullFromBackoff).toBe(2);
  });

  it('reports database size and row counts, counted once per open', () => {
    const m = makeManager({});
    const author = identity();
    const now = Date.now();
    for (let i = 1; i <= 3; i++) {
      (m as any).db.insertEvent(
        signedEvent(
          author,
          4,
          'message',
          { text: `m${i}` },
          now - i * 1_000,
          i
        ),
        false
      );
    }
    const first = m.getStorageDiagnostics();
    expect(first.sizeBytes).toBeGreaterThan(0);
    expect(first.events).toBe(3);
    expect(first.searchRows).toBeGreaterThanOrEqual(0);
    expect(first.indexWrites).toMatchObject({
      ftsCheck: { state: expect.any(String) },
    });
    (m as any).db.insertEvent(
      signedEvent(author, 4, 'message', { text: 'm4' }, now, 4),
      false
    );
    const second = m.getStorageDiagnostics();
    expect(second.events).toBe(3);
    expect(second.countedAt).toBe(first.countedAt);
  });

  it('reads an author sequence time, null when nothing is stored there', () => {
    const m = makeManager({});
    const author = identity();
    const at = Date.now() - 5_000;
    const event = signedEvent(author, 4, 'message', { text: 'x' }, at, 7);
    (m as any).db.insertEvent(event, false);
    const db = (m as any).db;
    expect(db.getAuthorSeqTimestamp(4, author.address, STREAM, 7)).toBe(at);
    expect(db.getAuthorSeqTimestamp(4, author.address, STREAM, 8)).toBeNull();
    expect(db.getAuthorSeqTimestamp(4, author.address, STREAM, 0)).toBeNull();
  });
});
