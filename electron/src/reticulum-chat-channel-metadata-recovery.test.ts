import * as nodeCrypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Channel metadata recovery on the GO phone profile (mobileProfile switches
// reprojectSkippedChannelMetadata, metadataSnapshotRecovery,
// lenientStaleSnapshotSigner and adminPublicSnapshotFallback). Each case runs
// the real engine and the real ReticulumChatDatabase SQL against Node's
// built-in SQLite (node:sqlite) through a minimal better-sqlite3 adapter, and
// checks that with the switch off the engine still behaves as upstream.
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
  type ReticulumChatWire,
} from './reticulum-chat';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

type Identity = { address: string; publicKey: string; secretKey: Uint8Array };

const PROFILE_ON: ReticulumChatMobileProfile = {
  reprojectSkippedChannelMetadata: true,
  metadataSnapshotRecovery: true,
  lenientStaleSnapshotSigner: true,
  adminPublicSnapshotFallback: true,
};
const MINUTE = 60_000;
const PEER = 'a1'.repeat(16);
const RELAY = 'b2'.repeat(16);
const OTHER = 'c3'.repeat(16);
const THIRD = 'd4'.repeat(16);

const managers: ReticulumChatManager[] = [];
const tempRoots: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) {
    try {
      manager.close();
    } catch {
      // already closed by the test
    }
  }
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(logger.log).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.info).mockClear();
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-channel-meta-'));
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

function signer(who: Identity) {
  return async (fields: Record<string, unknown>) => {
    const full = {
      ...fields,
      authorAddress: who.address,
      authorPublicKey: who.publicKey,
    };
    return {
      authorAddress: who.address,
      authorPublicKey: who.publicKey,
      signature: base58Encode(
        nacl.sign.detached(
          new Uint8Array(canonicalizeForSigning(full as any)),
          who.secretKey
        )
      ),
    };
  };
}

let seq = 1;
function metaEvent(
  author: Identity,
  groupId: number,
  eventType: ReticulumChatEventType,
  payload: Record<string, unknown>,
  timestamp: number
): ReticulumChatEvent {
  const encryptedPayload = JSON.stringify(payload);
  const event: ReticulumChatEvent = {
    eventId: `meta-${eventType}-${seq}`,
    groupId,
    channelId: String(payload.channelId ?? 'general'),
    authorAddress: author.address,
    authorPublicKey: author.publicKey,
    authorStreamId: 'f'.repeat(32),
    authorSeq: seq++,
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

// Same shape as the engine's (unexported) metadataSnapshotToWire.
function snapshotToWire(snapshot: any) {
  return {
    id: snapshot.snapshotId,
    sc: snapshot.scope,
    ...(snapshot.parentSnapshotHash ? { ph: snapshot.parentSnapshotHash } : {}),
    v: snapshot.version,
    ts: snapshot.createdAt,
    ...(snapshot.latestEventId
      ? {
          latest: {
            id: snapshot.latestEventId,
            ts: snapshot.latestFeedTimestamp,
          },
        }
      : {}),
    h: snapshot.snapshotHash,
    a: snapshot.adminAddress,
    p: snapshot.adminPublicKey,
    z: snapshot.signature,
    channels: snapshot.channels,
    categories: snapshot.categories,
    revisions: snapshot.revisions.map((r: any) => [
      r.entityType === 'channel' ? 'c' : 'g',
      r.entityId,
      r.eventId,
      r.eventType,
      r.timestamp,
      r.deleted ? 1 : 0,
      r.stateHash,
    ]),
  };
}

function makeManager(options: {
  profile?: ReticulumChatMobileProfile;
  admin: (groupId: number, address: string) => boolean | null;
  sign?: Identity;
  sent?: Array<{ peer: string; wire: ReticulumChatWire }>;
  now?: () => number;
}): ReticulumChatManager {
  const manager = new ReticulumChatManager({
    dbPath: tempDbPath(),
    bridge: {
      on: () => undefined,
      off: () => undefined,
      sendReticulumChatDetailed: async (
        peer: string,
        wire: ReticulumChatWire
      ) => {
        options.sent?.push({ peer, wire });
        return { ok: true as const };
      },
    } as any,
    ...(options.sign ? { signLocalFields: signer(options.sign) as any } : {}),
    ...(options.now ? { now: options.now } : {}),
    validateGroupMember: async () => true,
    validateGroupAdmin: async (groupId: number, address: string) =>
      options.admin(groupId, address) as boolean,
    mobileProfile: options.profile,
  });
  managers.push(manager);
  return manager;
}

function asMember(
  manager: ReticulumChatManager,
  groupId: number,
  local: Identity,
  isAdmin: boolean,
  adminStatusAuthoritative = true
): void {
  manager.setLocalGroupMemberships([
    { groupId, isAdmin, adminStatusAuthoritative, localAddress: local.address },
  ]);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const channelIds = (manager: ReticulumChatManager, groupId: number) =>
  manager.getChannels(groupId, true).map((channel) => channel.channelId);
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
const snapshotRequests = (sent: Array<{ wire: ReticulumChatWire }>) =>
  sent.filter((entry) => entry.wire.k === 'metadata_snapshot_req_v3');
const requestedHash = (entry: { wire: ReticulumChatWire }) =>
  String((entry.wire as any).q?.h ?? 'latest');

/** An admin's Hub that builds signed snapshots of its own channels. */
async function adminSnapshots(
  admin: Identity,
  groupIds: number[],
  channelFor: (groupId: number) => string,
  isAdmin: (groupId: number, address: string) => boolean = (_g, address) =>
    address === admin.address
) {
  const hub = makeManager({ admin: isAdmin, sign: admin });
  hub.setLocalGroupMemberships(
    groupIds.map((groupId) => ({
      groupId,
      isAdmin: true,
      adminStatusAuthoritative: true,
      localAddress: admin.address,
    }))
  );
  const out = new Map<
    number,
    { publicWire: any; fullWire: any; fullHash: string; publicHash: string }
  >();
  for (const groupId of groupIds) {
    const channelId = channelFor(groupId);
    const create = metaEvent(
      admin,
      groupId,
      'channel_create',
      { channelId, name: channelId, position: 1 },
      Date.now() - 1_000
    );
    (hub as any).db.insertEvent(create, true);
    await hub.applyChannelMetadataEvent(
      create.eventId,
      JSON.parse(create.encryptedPayload)
    );
    const selected = await (hub as any).getPublicMetadataSnapshotForSend(
      groupId
    );
    out.set(groupId, {
      publicWire: snapshotToWire(selected.snapshot),
      fullWire: snapshotToWire(selected.fullSnapshot),
      publicHash: selected.snapshot.snapshotHash,
      fullHash: selected.fullSnapshot.snapshotHash,
    });
  }
  return out;
}

function resourceOffer(
  groupId: number,
  snapshotHash: string,
  transferId: string,
  peer: string
) {
  return {
    transferId,
    groupId,
    snapshotHash,
    snapshotVersion: 1,
    sizeBytes: 512,
    fileHash: 'e'.repeat(64),
    sourcePeerHash: peer,
  };
}

describe('reprojectSkippedChannelMetadata', () => {
  async function ownUpdateAfterListFlip(profile?: ReticulumChatMobileProfile) {
    const local = identity();
    const m = makeManager({ profile, admin: () => true });
    const g = 502;
    asMember(m, g, local, true);
    const create = metaEvent(
      local,
      g,
      'channel_create',
      { channelId: 'news', name: 'news', position: 1 },
      Date.now() - 5_000
    );
    (m as any).db.insertEvent(create, true);
    await m.applyChannelMetadataEvent(
      create.eventId,
      JSON.parse(create.encryptedPayload)
    );
    expect(channelIds(m, g)).toContain('news');
    // A failed admin-list fetch pushes "not admin" for this account.
    asMember(m, g, local, false);
    const update = metaEvent(
      local,
      g,
      'channel_update',
      { channelId: 'news', name: 'announcements' },
      Date.now() - 1_000
    );
    (m as any).db.insertEvent(update, true);
    (m as any).queueChannelMetadataProjection(update);
    await sleep(150);
    const nameAfterSkip = m
      .getChannels(g, true)
      .find((channel) => channel.channelId === 'news')?.name;
    // The next good fetch says admin again.
    asMember(m, g, local, true);
    await sleep(300);
    const nameAfterFix = m
      .getChannels(g, true)
      .find((channel) => channel.channelId === 'news')?.name;
    return { nameAfterSkip, nameAfterFix };
  }

  it('re-projects an own edit skipped while the pushed admin list said "not admin" (H1b)', async () => {
    const on = await ownUpdateAfterListFlip(PROFILE_ON);
    expect(on.nameAfterSkip).toBe('news');
    expect(on.nameAfterFix).toBe('announcements');
  });

  it('keeps the skipped edit skipped with the switch off (upstream)', async () => {
    const off = await ownUpdateAfterListFlip(undefined);
    expect(off.nameAfterSkip).toBe('news');
    expect(off.nameAfterFix).toBe('news');
  });

  async function exAdminCreateAfterRecheck(
    profile?: ReticulumChatMobileProfile
  ) {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
      ],
    });
    const local = identity();
    const creator = identity();
    let creatorIsAdmin = false;
    const m = makeManager({
      profile,
      admin: (_g, address) => address === creator.address && creatorIsAdmin,
    });
    const g = 503;
    asMember(m, g, local, false);
    (m as any).subscribedGroups.add(g);
    const create = metaEvent(
      creator,
      g,
      'channel_create',
      { channelId: 'minutes', name: 'minutes', position: 2 },
      Date.now() - 1_000
    );
    (m as any).db.insertEvent(create, true);
    (m as any).queueChannelMetadataProjection(create);
    await vi.advanceTimersByTimeAsync(1_000);
    const beforeFlip = channelIds(m, g).includes('minutes');
    // Re-added as admin on chain; nobody opens the group again.
    creatorIsAdmin = true;
    await vi.advanceTimersByTimeAsync(31 * MINUTE);
    return { beforeFlip, afterRecheck: channelIds(m, g).includes('minutes') };
  }

  it('re-checks skipped metadata of subscribed groups every 30 min (H2)', async () => {
    const on = await exAdminCreateAfterRecheck(PROFILE_ON);
    expect(on.beforeFlip).toBe(false);
    expect(on.afterRecheck).toBe(true);
  });

  it('never re-checks a skip by time alone with the switch off (upstream)', async () => {
    const off = await exAdminCreateAfterRecheck(undefined);
    expect(off.beforeFlip).toBe(false);
    expect(off.afterRecheck).toBe(false);
  });

  it('applies a skipped category edit as soon as Core answers "admin" for its author', async () => {
    const clock = { now: Date.now() };
    const local = identity();
    const author = identity();
    let authorIsAdmin = false;
    const m = makeManager({
      profile: PROFILE_ON,
      now: () => clock.now,
      admin: (_g, address) => address === author.address && authorIsAdmin,
    });
    const g = 504;
    asMember(m, g, local, false);
    const category = metaEvent(
      author,
      g,
      'category_create',
      { categoryId: 'cat-team', name: 'team', position: 1 },
      clock.now - 1_000
    );
    (m as any).db.insertEvent(category, true);
    (m as any).queueChannelMetadataProjection(category);
    await sleep(150);
    // Members see a category only once a channel uses it: read the row.
    expect((m as any).db.getCategory(g, 'cat-team')).toBeFalsy();
    expect(m.getChannelMetadataRecoveryState(g).skippedEvents).toBe(1);
    // Any later check of this author (another event, a snapshot signer)
    // after the 30 s admin cache.
    authorIsAdmin = true;
    clock.now += 31_000;
    await expect(
      (m as any).getValidatedGroupAdminStatus(g, author.address)
    ).resolves.toBe('admin');
    await sleep(300);
    expect((m as any).db.getCategory(g, 'cat-team')?.name).toBe('team');
    expect(m.getChannelMetadataRecoveryState(g).skippedEvents).toBe(0);
  });

  async function orphanReorderTenMinutes(profile?: ReticulumChatMobileProfile) {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
      ],
    });
    const admin = identity();
    const local = identity();
    let adminCalls = 0;
    const m = makeManager({
      profile,
      admin: (_g, address) => {
        adminCalls += 1;
        return address === admin.address;
      },
    });
    const g = 505;
    asMember(m, g, local, false);
    // Its channel_create is older than any peer will serve: no base.
    const reorder = metaEvent(
      admin,
      g,
      'channel_reorder',
      { channelId: 'old', categoryId: '', position: 2 },
      Date.now() - 1_000
    );
    (m as any).db.insertEvent(reorder, true);
    (m as any).queueChannelMetadataProjection(reorder);
    for (let i = 0; i < 20; i += 1) await vi.advanceTimersByTimeAsync(30_000);
    const retries = logLines().filter((line) =>
      line.includes('channel_metadata_projection_retry event=')
    ).length;
    return { retries, adminCalls };
  }

  it('backs off a deferred projection whose base never arrives (V2)', async () => {
    const on = await orphanReorderTenMinutes(PROFILE_ON);
    // 30 s, 1 min, 2 min, 5 min: four retries in ten minutes.
    expect(on.retries).toBe(4);
    expect(on.adminCalls).toBeLessThanOrEqual(6);
  });

  it('retries a deferred projection every 30 s with the switch off (upstream)', async () => {
    const off = await orphanReorderTenMinutes(undefined);
    expect(off.retries).toBeGreaterThanOrEqual(19);
  });

  it('applies a waiting edit as soon as its channel_create is imported', async () => {
    const admin = identity();
    const local = identity();
    const m = makeManager({
      profile: PROFILE_ON,
      admin: (_g, address) => address === admin.address,
    });
    const g = 506;
    asMember(m, g, local, false);
    const reorder = metaEvent(
      admin,
      g,
      'channel_reorder',
      { channelId: 'old', categoryId: '', position: 7 },
      Date.now() - 1_000
    );
    (m as any).db.insertEvent(reorder, true);
    (m as any).queueChannelMetadataProjection(reorder);
    await sleep(100);
    expect((m as any).channelMetadataProjectionRetryTimers.size).toBe(1);
    const create = metaEvent(
      admin,
      g,
      'channel_create',
      { channelId: 'old', name: 'old', position: 1 },
      Date.now() - 60_000
    );
    (m as any).db.insertEvent(create, true);
    (m as any).queueChannelMetadataProjection(create);
    await sleep(150);
    const channel = m
      .getChannels(g, true)
      .find((candidate) => candidate.channelId === 'old');
    expect(channel?.position).toBe(7);
    expect((m as any).channelMetadataProjectionRetryTimers.size).toBe(0);
    expect(m.getChannelMetadataRecoveryState(g).deferredProjections).toBe(0);
  });

  async function unknownAuthorWake(profile?: ReticulumChatMobileProfile) {
    const clock = { now: Date.now() };
    const admin = identity();
    const member = identity();
    const local = identity();
    let memberAnswer: boolean | null = null;
    const m = makeManager({
      profile,
      now: () => clock.now,
      admin: (_g, address) =>
        address === admin.address
          ? true
          : address === member.address
            ? memberAnswer
            : false,
    });
    const g = 507;
    asMember(m, g, local, false);
    const create = metaEvent(
      admin,
      g,
      'channel_create',
      { channelId: 'ops', name: 'ops', position: 1 },
      clock.now - 5_000
    );
    const update = metaEvent(
      member,
      g,
      'channel_update',
      { channelId: 'ops', name: 'operations' },
      clock.now - 4_000
    );
    (m as any).db.insertEvent(create, true);
    (m as any).db.insertEvent(update, true);
    (m as any).queueChannelMetadataProjection(create);
    await sleep(150);
    const deferredBefore = !channelIds(m, g).includes('ops');
    // Core answers again; some other check asks about this author.
    memberAnswer = true;
    clock.now += 11_000;
    await (m as any).getValidatedGroupAdminStatus(g, member.address);
    await sleep(300);
    return {
      deferredBefore,
      nameAfterAnswer: m
        .getChannels(g, true)
        .find((channel) => channel.channelId === 'ops')?.name,
    };
  }

  it('wakes a projection deferred on an unknown author once Core answers', async () => {
    const on = await unknownAuthorWake(PROFILE_ON);
    expect(on.deferredBefore).toBe(true);
    expect(on.nameAfterAnswer).toBe('operations');
  });

  it('waits for the 30 s retry with the switch off (upstream)', async () => {
    const off = await unknownAuthorWake(undefined);
    expect(off.deferredBefore).toBe(true);
    expect(off.nameAfterAnswer).toBeUndefined();
  });
});

describe('metadataSnapshotRecovery', () => {
  async function adminAppliesFullThenWaits(
    profile?: ReticulumChatMobileProfile
  ) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const hubAdmin = identity();
    const local = identity();
    const g = 804;
    const snapshots = await adminSnapshots(
      hubAdmin,
      [g],
      () => 'board',
      (_g, address) => address === hubAdmin.address || address === local.address
    );
    const { publicWire, fullWire, fullHash } = snapshots.get(g)!;
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const go = makeManager({
      profile,
      sign: local,
      sent,
      admin: (_g, address) =>
        address === hubAdmin.address || address === local.address,
    });
    asMember(go, g, local, true);
    (go as any).subscribedGroups.add(g);
    // A 3.0.3 admin Hub pushes its public snapshot with fh.
    await (go as any).handleMetadataSnapshotOffer(
      g,
      { s: publicWire, fh: fullHash },
      PEER
    );
    await vi.advanceTimersByTimeAsync(100);
    const firstRequest = snapshotRequests(sent)[0];
    await (go as any).handleMetadataSnapshotOffer(g, { s: fullWire }, PEER);
    const readyAfterFull = go.getChannelMetadataBundle(g, true).ready;
    const requestsAtApply = snapshotRequests(sent).length;
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    return {
      firstRequestHash: firstRequest ? requestedHash(firstRequest) : '',
      fullHash,
      readyAfterFull,
      requestsAtApply,
      requestsAfter: snapshotRequests(sent).length,
      deferredLeft: (go as any).deferredMetadataSnapshots.size,
    };
  }

  it('stops asking for a full snapshot once it is applied (V4)', async () => {
    const on = await adminAppliesFullThenWaits({
      metadataSnapshotRecovery: true,
    });
    expect(on.firstRequestHash).toBe(on.fullHash);
    expect(on.readyAfterFull).toBe(true);
    expect(on.requestsAtApply).toBe(1);
    expect(on.requestsAfter).toBe(1);
    expect(on.deferredLeft).toBe(0);
  });

  it('keeps re-requesting the applied full snapshot with the switch off (upstream)', async () => {
    const off = await adminAppliesFullThenWaits(undefined);
    expect(off.readyAfterFull).toBe(true);
    expect(off.requestsAfter).toBeGreaterThan(5);
    expect(off.deferredLeft).toBe(1);
  });

  async function badResourceAuth(profile?: ReticulumChatMobileProfile) {
    const local = identity();
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const go = makeManager({ profile, sign: local, sent, admin: () => false });
    const g = 810;
    asMember(go, g, local, false);
    (go as any).subscribedGroups.add(g);
    const accept = vi
      .spyOn(go as any, 'acceptMetadataSnapshotResource')
      .mockResolvedValue(undefined);
    const hash = '1'.repeat(64);
    const first = resourceOffer(g, hash, '00000000000000a1', PEER);
    (go as any).enqueueMetadataSnapshotDownload(first);
    expect(accept).toHaveBeenCalledTimes(1);
    (go as any).failMetadataSnapshotDownload(
      first.transferId,
      'bad_resource_auth'
    );
    await sleep(100);
    const afterFirst = snapshotRequests(sent).map(requestedHash);
    // The fresh offer fails the same way: no second forced request.
    const second = resourceOffer(g, hash, '00000000000000a2', PEER);
    (go as any).metadataSnapshotPeerBackoffs.clear();
    (go as any).enqueueMetadataSnapshotDownload(second);
    (go as any).failMetadataSnapshotDownload(
      second.transferId,
      'bad_resource_auth'
    );
    await sleep(100);
    return { hash, afterFirst, afterSecond: snapshotRequests(sent).length };
  }

  it('asks the provider once for a fresh transfer after bad_resource_auth', async () => {
    const on = await badResourceAuth(PROFILE_ON);
    expect(on.afterFirst).toEqual([on.hash]);
    expect(on.afterSecond).toBe(1);
  });

  it('waits for the next digest after bad_resource_auth with the switch off (upstream)', async () => {
    const off = await badResourceAuth(undefined);
    expect(off.afterFirst).toEqual([]);
    expect(off.afterSecond).toBe(0);
  });

  it('drops an offer that waited 9 min and asks its peer for a fresh one', async () => {
    const clock = { now: Date.now() };
    const local = identity();
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const go = makeManager({
      profile: PROFILE_ON,
      sign: local,
      sent,
      now: () => clock.now,
      admin: () => false,
    });
    const g = 811;
    asMember(go, g, local, false);
    (go as any).subscribedGroups.add(g);
    const accept = vi
      .spyOn(go as any, 'acceptMetadataSnapshotResource')
      .mockResolvedValue(undefined);
    // The peer is backed off, so the offer waits in the queue.
    (go as any).metadataSnapshotPeerBackoffs.set(PEER, {
      attempts: 1,
      nextAttemptAt: clock.now + 60 * MINUTE,
      expiresAt: clock.now + 60 * MINUTE,
    });
    const hash = '2'.repeat(64);
    (go as any).enqueueMetadataSnapshotDownload(
      resourceOffer(g, hash, '00000000000000b1', PEER)
    );
    expect(accept).not.toHaveBeenCalled();
    clock.now += 9 * MINUTE;
    (go as any).metadataSnapshotPeerBackoffs.clear();
    (go as any).processMetadataSnapshotDownloadQueue();
    await sleep(100);
    expect(accept).not.toHaveBeenCalled();
    expect((go as any).metadataSnapshotDownloadItems.size).toBe(0);
    const requests = snapshotRequests(sent);
    expect(requests).toHaveLength(1);
    expect(requests[0].peer).toBe(PEER);
    expect(requestedHash(requests[0])).toBe(hash);
  });

  it('asks the last digest providers 10 s after a timeout with no other provider', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const local = identity();
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const go = makeManager({
      profile: PROFILE_ON,
      sign: local,
      sent,
      admin: () => false,
    });
    const g = 812;
    asMember(go, g, local, false);
    (go as any).subscribedGroups.add(g);
    vi.spyOn(go as any, 'acceptMetadataSnapshotResource').mockResolvedValue(
      undefined
    );
    const hash = '3'.repeat(64);
    (go as any).processGroupDigestStateHints({
      key: 'k',
      peerHash: OTHER,
      providerPeerHash: OTHER,
      candidatePeerHashes: [OTHER, THIRD],
      groupId: g,
      wire: { d: { metadataSnapshotHash: hash } },
      remoteGroupLatest: null,
      remoteDigestHash: '',
      enqueuedAt: Date.now(),
      coalescedCount: 0,
      localRevision: 0,
    });
    await vi.advanceTimersByTimeAsync(100);
    const digestRequests = snapshotRequests(sent).length;
    const offer = resourceOffer(g, hash, '00000000000000c1', PEER);
    (go as any).enqueueMetadataSnapshotDownload(offer);
    (go as any).failMetadataSnapshotDownload(
      offer.transferId,
      'coordinator_timeout',
      offer,
      true
    );
    await vi.advanceTimersByTimeAsync(9_000);
    expect(snapshotRequests(sent).length).toBe(digestRequests);
    await vi.advanceTimersByTimeAsync(2_000);
    const recovery = snapshotRequests(sent).slice(digestRequests);
    expect(recovery.map((entry) => entry.peer).sort()).toEqual(
      [OTHER, THIRD].sort()
    );
    expect(recovery.every((entry) => requestedHash(entry) === hash)).toBe(true);
  });

  async function deferralWhileCoreDown(profile?: ReticulumChatMobileProfile) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const hubAdmin = identity();
    const local = identity();
    const g = 813;
    const snapshots = await adminSnapshots(hubAdmin, [g], () => 'board');
    const go = makeManager({
      profile,
      // Core does not answer for this account (own address unknown).
      admin: (_g, address) => (address === local.address ? null : true),
    });
    asMember(go, g, local, false, false);
    (go as any).subscribedGroups.add(g);
    const handle = vi.spyOn(go as any, 'handleMetadataSnapshotOffer');
    await (go as any).handleMetadataSnapshotOffer(
      g,
      { s: snapshots.get(g)!.publicWire },
      PEER
    );
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    return {
      handled: handle.mock.calls.length,
      deferredLeft: (go as any).deferredMetadataSnapshots.size,
    };
  }

  it('drops a deferred snapshot after 4 retries (the next digest restarts it)', async () => {
    const on = await deferralWhileCoreDown(PROFILE_ON);
    expect(on.handled).toBe(5);
    expect(on.deferredLeft).toBe(0);
  });

  it('retries a deferred snapshot for as long as the app runs with the switch off (upstream)', async () => {
    const off = await deferralWhileCoreDown(undefined);
    expect(off.handled).toBeGreaterThan(10);
    expect(off.deferredLeft).toBe(1);
  });
});

describe('lenientStaleSnapshotSigner', () => {
  async function staleSnapshotsFromOneRelay(
    profile?: ReticulumChatMobileProfile
  ) {
    const formerAdmin = identity();
    const local = identity();
    const groups = [601, 602, 603, 604];
    const snapshots = await adminSnapshots(formerAdmin, groups, (g) => `c${g}`);
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const go = makeManager({
      profile,
      sign: local,
      sent,
      // Core: no longer admin in 601-603, still admin in 604.
      admin: (g, address) => address === formerAdmin.address && g === 604,
    });
    go.setLocalGroupMemberships(
      groups.map((groupId) => ({
        groupId,
        isAdmin: false,
        adminStatusAuthoritative: true,
        localAddress: local.address,
      }))
    );
    for (const g of groups) (go as any).subscribedGroups.add(g);
    for (const g of [601, 602, 603]) {
      await (go as any).handleMetadataSnapshotOffer(
        g,
        { s: snapshots.get(g)!.publicWire },
        RELAY
      );
    }
    const cooledDown = (go as any).isPeerProtocolCooledDown(
      RELAY,
      'metadata_snapshot_offer_v3'
    );
    go.handleWire(
      {
        t: 'RCHAT',
        v: 3,
        k: 'metadata_snapshot_offer_v3',
        g: 604,
        s: snapshots.get(604)!.publicWire,
      } as any,
      RELAY
    );
    await sleep(150);
    return { go, snapshots, sent, cooledDown };
  }

  it('does not cool the relay down and still applies its valid snapshot (H3)', async () => {
    const { go, snapshots, sent, cooledDown } =
      await staleSnapshotsFromOneRelay(PROFILE_ON);
    expect(cooledDown).toBe(false);
    expect(channelIds(go, 604)).toContain('c604');
    expect(
      logLines().filter((line) => line.includes('Peer protocol violation'))
    ).toEqual([]);
    expect(go.getChannelMetadataRecoveryState(601).staleSignerSnapshots).toBe(
      1
    );

    // A 4th offer of the same hash is neither checked nor fetched again.
    const scope = vi.spyOn(go as any, 'expectedMetadataSnapshotScope');
    const stale = snapshots.get(601)!;
    await (go as any).handleMetadataSnapshotOffer(
      601,
      { s: stale.publicWire },
      OTHER
    );
    expect(scope).not.toHaveBeenCalled();
    (go as any).enqueueMetadataSnapshotDownload(
      resourceOffer(601, stale.publicHash, '00000000000000d1', OTHER)
    );
    expect((go as any).metadataSnapshotDownloadItems.size).toBe(0);
    (go as any).processGroupDigestStateHints({
      key: 'k',
      peerHash: OTHER,
      providerPeerHash: OTHER,
      candidatePeerHashes: [OTHER],
      groupId: 601,
      wire: { d: { metadataSnapshotHash: stale.publicHash } },
      remoteGroupLatest: null,
      remoteDigestHash: '',
      enqueuedAt: Date.now(),
      coalescedCount: 0,
      localRevision: 0,
    });
    await sleep(100);
    expect(snapshotRequests(sent)).toEqual([]);
  });

  it('cools the relay down after 3 stale snapshots with the switch off (upstream)', async () => {
    const { go, cooledDown } = await staleSnapshotsFromOneRelay(undefined);
    expect(cooledDown).toBe(true);
    expect(channelIds(go, 604)).not.toContain('c604');
  });

  // The snapshot hash covers the body, not the signer: anyone can re-sign a
  // real admin's body with their own key. Such a copy must not hide the real
  // one from other peers (review finding engine-F1).
  async function forgedCopyOfAdminSnapshot(
    profile?: ReticulumChatMobileProfile
  ) {
    const admin = identity();
    const attacker = identity();
    const local = identity();
    const g = 610;
    const legit = (await adminSnapshots(admin, [g], () => 'board')).get(
      g
    )!.publicWire;
    const forged: any = {
      ...legit,
      a: attacker.address,
      p: attacker.publicKey,
    };
    forged.z = base58Encode(
      nacl.sign.detached(
        new Uint8Array(
          canonicalizeForSigning({
            authorAddress: attacker.address,
            authorPublicKey: attacker.publicKey,
            createdAt: legit.ts,
            groupId: g,
            scope: legit.sc,
            parentSnapshotHash: legit.ph ?? '',
            latestEventId: legit.latest?.id ?? '',
            latestFeedTimestamp: legit.latest?.ts ?? 0,
            snapshotHash: legit.h,
            snapshotId: legit.id,
            type: 'RCHAT_METADATA_SNAPSHOT',
            version: legit.v,
          } as any)
        ),
        attacker.secretKey
      )
    );
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const go = makeManager({
      profile,
      sign: local,
      sent,
      admin: (_g, address) => address === admin.address,
    });
    asMember(go, g, local, false);
    (go as any).subscribedGroups.add(g);
    return { go, g, legit, forged, sent };
  }

  const digestFrom = (
    go: ReticulumChatManager,
    g: number,
    peer: string,
    hash: string
  ) =>
    (go as any).processGroupDigestStateHints({
      key: `k-${peer}`,
      peerHash: peer,
      providerPeerHash: peer,
      candidatePeerHashes: [peer],
      groupId: g,
      wire: { d: { metadataSnapshotHash: hash } },
      remoteGroupLatest: null,
      remoteDigestHash: '',
      enqueuedAt: Date.now(),
      coalescedCount: 0,
      localRevision: 0,
    });

  it('a re-signed copy by a non-admin does not hide the real admin snapshot (inline offers)', async () => {
    const { go, g, legit, forged, sent } =
      await forgedCopyOfAdminSnapshot(PROFILE_ON);
    await (go as any).handleMetadataSnapshotOffer(g, { s: forged }, PEER);
    expect(channelIds(go, g)).not.toContain('board');

    // Only the peer that served the forged copy is skipped.
    digestFrom(go, g, PEER, legit.h);
    digestFrom(go, g, OTHER, legit.h);
    await sleep(100);
    expect(snapshotRequests(sent).map((entry) => entry.peer)).toEqual([OTHER]);

    await (go as any).handleMetadataSnapshotOffer(g, { s: legit }, RELAY);
    await sleep(150);
    expect(channelIds(go, g)).toContain('board');
    expect(
      logLines().filter((line) => line.includes('Peer protocol violation'))
    ).toEqual([]);
  });

  it('a re-signed copy by a non-admin settles only its own download candidate (resource path)', async () => {
    const { go, g, legit, forged } =
      await forgedCopyOfAdminSnapshot(PROFILE_ON);
    const accepted: string[] = [];
    vi.spyOn(go as any, 'acceptMetadataSnapshotResource').mockImplementation(
      async (_peer: unknown, offer: any) => {
        accepted.push(offer.transferId);
      }
    );
    const blobFor = (wire: unknown, transferId: string) => {
      const blob = JSON.stringify(wire);
      const file = path.join(path.dirname(tempDbPath()), `${transferId}.json`);
      fs.writeFileSync(file, blob);
      return {
        file,
        fileHash: nodeCrypto.createHash('sha256').update(blob).digest('hex'),
      };
    };
    const forgedBlob = blobFor(forged, '00000000000000f1');
    const legitBlob = blobFor(legit, '00000000000000f2');
    (go as any).enqueueMetadataSnapshotDownload({
      ...resourceOffer(g, legit.h, '00000000000000f1', PEER),
      snapshotVersion: legit.v,
      fileHash: forgedBlob.fileHash,
    });
    (go as any).enqueueMetadataSnapshotDownload({
      ...resourceOffer(g, legit.h, '00000000000000f2', RELAY),
      snapshotVersion: legit.v,
      fileHash: legitBlob.fileHash,
    });
    expect(accepted).toEqual(['00000000000000f1']);

    await (go as any).importReceivedMetadataSnapshotResource({
      transferId: '00000000000000f1',
      path: forgedBlob.file,
    });
    // RELAY's candidate for the same hash is still queued, and starts now.
    expect(accepted).toEqual(['00000000000000f1', '00000000000000f2']);
    expect(go.getChannelMetadataRecoveryState(g).staleSignerSnapshots).toBe(1);
    // A new offer from the forger is not fetched again.
    (go as any).enqueueMetadataSnapshotDownload({
      ...resourceOffer(g, legit.h, '00000000000000f3', PEER),
      snapshotVersion: legit.v,
      fileHash: forgedBlob.fileHash,
    });
    expect(accepted).toHaveLength(2);

    await (go as any).importReceivedMetadataSnapshotResource({
      transferId: '00000000000000f2',
      path: legitBlob.file,
    });
    expect(channelIds(go, g)).toContain('board');
    expect(
      logLines().filter((line) => line.includes('Peer protocol violation'))
    ).toEqual([]);
  });

  it('charges the forger and still applies the real snapshot with the switch off (upstream)', async () => {
    const { go, g, legit, forged } = await forgedCopyOfAdminSnapshot(undefined);
    await (go as any).handleMetadataSnapshotOffer(g, { s: forged }, PEER);
    await (go as any).handleMetadataSnapshotOffer(g, { s: legit }, RELAY);
    await sleep(150);
    expect(channelIds(go, g)).toContain('board');
    expect(
      logLines().filter((line) => line.includes('Peer protocol violation'))
    ).toHaveLength(1);
  });
});

describe('adminPublicSnapshotFallback', () => {
  async function adminGetsPublicSnapshot(
    profile: ReticulumChatMobileProfile | undefined,
    withFullHash: boolean
  ) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const hubAdmin = identity();
    const local = identity();
    const g = 701;
    const snapshots = await adminSnapshots(hubAdmin, [g], () => 'board');
    const { publicWire, fullHash } = snapshots.get(g)!;
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const go = makeManager({
      profile,
      sign: local,
      sent,
      admin: (_g, address) =>
        address === hubAdmin.address || address === local.address,
    });
    asMember(go, g, local, true);
    (go as any).subscribedGroups.add(g);
    await (go as any).handleMetadataSnapshotOffer(
      g,
      withFullHash ? { s: publicWire, fh: fullHash } : { s: publicWire },
      PEER
    );
    await vi.advanceTimersByTimeAsync(100);
    const bundle = go.getChannelMetadataBundle(g, true);
    const deferred = (go as any).deferredMetadataSnapshots.size;
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    return {
      go,
      g,
      fullHash,
      channels: bundle.channels.map((channel) => channel.channelId),
      ready: bundle.ready,
      deferred,
      requests: snapshotRequests(sent).map(requestedHash),
    };
  }

  it('shows the member-visible channels to an admin with no full snapshot (H4)', async () => {
    const on = await adminGetsPublicSnapshot(PROFILE_ON, false);
    expect(on.channels).toContain('board');
    expect(on.ready).toBe(false);
    expect(on.deferred).toBe(0);
    // H4b: no "latest" request loop without a known full hash.
    expect(on.requests.length).toBeLessThanOrEqual(2);
    expect(on.requests).not.toContain('latest');
    // A stored public snapshot never seeds this admin's own full chain.
    await expect(
      (on.go as any).buildLocalMetadataSnapshot(on.g)
    ).resolves.toBeNull();
    expect(
      (on.go as any).db.getLatestMetadataSnapshot(on.g, 'full')
    ).toBeNull();
  });

  it('asks for the full snapshot exactly once by its advertised hash', async () => {
    const on = await adminGetsPublicSnapshot(PROFILE_ON, true);
    expect(on.channels).toContain('board');
    expect(on.requests).toEqual([on.fullHash]);
  });

  it('defers the public snapshot and keeps asking for "latest" with the switch off (upstream)', async () => {
    const off = await adminGetsPublicSnapshot(undefined, false);
    expect(off.channels).not.toContain('board');
    expect(off.deferred).toBe(1);
    expect(off.requests.length).toBeGreaterThan(5);
  });
});
