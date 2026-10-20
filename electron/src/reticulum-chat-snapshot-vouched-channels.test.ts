import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

// snapshotVouchedChannelRows (GO phone profile). A channel whose creator is no
// longer a Qortal group admin reaches a fresh GO only through a current
// admin's signed metadata snapshot. Upstream, later edits by current admins
// to such a channel never apply from events: the rebuild skips the ex-admin's
// channel_create and finds no base (verifier V3). With the switch on, the
// signed snapshot's copy is that base. Each case runs the real engine and the
// real ReticulumChatDatabase SQL against Node's built-in SQLite (node:sqlite)
// through a minimal better-sqlite3 adapter, and checks the switch-off
// behaviour is still upstream.
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
import type { ReticulumGroupChannel } from './reticulum-chat-db';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

type Identity = { address: string; publicKey: string; secretKey: Uint8Array };

// The round-1 channel switches GO already runs with; the cases compare them
// with and without snapshotVouchedChannelRows.
const ROUND1: ReticulumChatMobileProfile = {
  reprojectSkippedChannelMetadata: true,
  metadataSnapshotRecovery: true,
  lenientStaleSnapshotSigner: true,
  adminPublicSnapshotFallback: true,
};
const PROFILE_ON: ReticulumChatMobileProfile = {
  ...ROUND1,
  snapshotVouchedChannelRows: true,
};
const MINUTE = 60_000;
const PEER = 'a1'.repeat(16);

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-vouched-'));
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
    eventId: `vouched-${eventType}-${seq}`,
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
  now?: () => number;
}): ReticulumChatManager {
  const manager = new ReticulumChatManager({
    dbPath: tempDbPath(),
    bridge: {
      on: () => undefined,
      off: () => undefined,
      sendReticulumChatDetailed: async (
        _peer: string,
        _wire: ReticulumChatWire
      ) => ({ ok: true as const }),
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
  isAdmin: boolean
): void {
  manager.setLocalGroupMemberships([
    {
      groupId,
      isAdmin,
      adminStatusAuthoritative: true,
      localAddress: local.address,
    },
  ]);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const channelIds = (manager: ReticulumChatManager, groupId: number) =>
  manager.getChannels(groupId, true).map((channel) => channel.channelId);
const channelRow = (
  manager: ReticulumChatManager,
  groupId: number,
  channelId: string
): ReticulumGroupChannel | null =>
  (manager as any).db.getChannel(groupId, channelId);
const retryTimers = (manager: ReticulumChatManager): number =>
  (manager as any).channelMetadataProjectionRetryTimers.size;
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
const snapshotBaseRebuilds = () =>
  logLines().filter(
    (line) =>
      line.includes('channel_metadata_projection_rebuilt') &&
      line.includes('base=snapshot')
  ).length;

/** Stores events the way a page import does and queues their projection. */
async function deliver(
  manager: ReticulumChatManager,
  ...events: ReticulumChatEvent[]
): Promise<void> {
  for (const event of events) {
    (manager as any).db.insertEvent(event, true);
    (manager as any).queueChannelMetadataProjection(event);
  }
  await sleep(250);
}

/**
 * A long-running admin Hub of `signer`: it projected each create while its
 * author was still an admin, then signs its snapshot after those authors
 * lost admin (the "Minter Admin" case).
 */
async function hubSnapshot(options: {
  groupId: number;
  signer: Identity;
  creates: ReticulumChatEvent[];
  formerAdmins?: Identity[];
}) {
  const formerAdmins = new Set(
    (options.formerAdmins ?? []).map((who) => who.address)
  );
  let demoted = false;
  const hub = makeManager({
    sign: options.signer,
    admin: (_g, address) =>
      address === options.signer.address ||
      (!demoted && formerAdmins.has(address)),
  });
  asMember(hub, options.groupId, options.signer, true);
  for (const create of options.creates) {
    (hub as any).db.insertEvent(create, true);
    await hub.applyChannelMetadataEvent(
      create.eventId,
      JSON.parse(create.encryptedPayload)
    );
  }
  demoted = true;
  const selected = await (hub as any).getPublicMetadataSnapshotForSend(
    options.groupId
  );
  return {
    publicWire: snapshotToWire(selected.snapshot),
    fullWire: snapshotToWire(selected.fullSnapshot),
    publicHash: selected.snapshot.snapshotHash as string,
  };
}

/**
 * A fresh, non-admin GO that got the 'minters' channel (created by an
 * ex-admin) only through current admin Y's signed public snapshot, then the
 * ex-admin's own channel_create from a Hub page (skipped: not an admin).
 */
async function goWithVouchedChannel(
  profile: ReticulumChatMobileProfile | undefined,
  groupId: number
) {
  const creator = identity();
  const admin = identity();
  const member = identity();
  const local = identity();
  const t0 = Date.now() - 10 * MINUTE;
  const create = metaEvent(
    creator,
    groupId,
    'channel_create',
    { channelId: 'minters', name: 'minters', position: 3 },
    t0
  );
  const snapshot = await hubSnapshot({
    groupId,
    signer: admin,
    creates: [create],
    formerAdmins: [creator],
  });
  // Core's current admin set as GO's validator sees it; addresses in
  // unknownAdmins get no answer from Core.
  const currentAdmins = new Set([admin.address]);
  const unknownAdmins = new Set<string>();
  const go = makeManager({
    profile,
    admin: (_g, address) =>
      unknownAdmins.has(address) ? null : currentAdmins.has(address),
  });
  asMember(go, groupId, local, false);
  (go as any).subscribedGroups.add(groupId);
  await (go as any).handleMetadataSnapshotOffer(
    groupId,
    { s: snapshot.publicWire },
    PEER
  );
  const visibleAfterSnapshot = channelIds(go, groupId).includes('minters');
  await deliver(go, create);
  return {
    go,
    groupId,
    creator,
    admin,
    member,
    local,
    t0,
    create,
    snapshot,
    currentAdmins,
    unknownAdmins,
    visibleAfterSnapshot,
  };
}

describe('snapshotVouchedChannelRows', () => {
  async function adminArchivesVouchedChannel(
    profile: ReticulumChatMobileProfile | undefined,
    groupId: number
  ) {
    const v = await goWithVouchedChannel(profile, groupId);
    const archive = metaEvent(
      v.admin,
      groupId,
      'channel_archive',
      { channelId: 'minters' },
      v.t0 + MINUTE
    );
    await deliver(v.go, archive);
    return {
      ...v,
      archive,
      archived: channelRow(v.go, groupId, 'minters')?.archived,
      timers: retryTimers(v.go),
    };
  }

  it("applies a current admin's archive on top of the snapshot's copy (V3)", async () => {
    const on = await adminArchivesVouchedChannel(PROFILE_ON, 811);
    expect(on.visibleAfterSnapshot).toBe(true);
    expect(on.archived).toBe(true);
    expect(on.timers).toBe(0);
    const record = (on.go as any).db.getMetadataEntityRevisionRecord(
      811,
      'channel',
      'minters'
    );
    expect(record.revision.eventId).toBe(on.archive.eventId);
    expect(snapshotBaseRebuilds()).toBe(1);
    // The ex-admin's create is inside the signed state: it is no longer a
    // skipped event, so its author is not re-checked through Core every
    // 30 min, and nothing waits on a retry.
    const state = on.go.getChannelMetadataRecoveryState(811);
    expect(state.skippedCreatesByOthers).toBe(0);
    expect(state.skippedEvents).toBe(0);
    expect(state.deferredProjections).toBe(0);
  });

  it('keeps the archive waiting for a base with the switch off (upstream)', async () => {
    for (const [index, profile] of [ROUND1, undefined].entries()) {
      const off = await adminArchivesVouchedChannel(profile, 821 + index);
      expect(off.visibleAfterSnapshot).toBe(true);
      expect(off.archived).toBe(false);
      expect(off.timers).toBe(1);
    }
    expect(snapshotBaseRebuilds()).toBe(0);
  });

  it('keeps folding later admin edits in event order, also one that arrives late', async () => {
    const on = await adminArchivesVouchedChannel(PROFILE_ON, 812);
    const restore = metaEvent(
      on.admin,
      812,
      'channel_restore',
      { channelId: 'minters' },
      on.t0 + 3 * MINUTE
    );
    await deliver(on.go, restore);
    // The first applied edit rewrote the revision row as an event revision;
    // the base still comes from the stored snapshot.
    expect(channelRow(on.go, 812, 'minters')?.archived).toBe(false);
    const reorder = metaEvent(
      on.admin,
      812,
      'channel_reorder',
      { channelId: 'minters', categoryId: '', position: 7 },
      on.t0 + 2 * MINUTE
    );
    await deliver(on.go, reorder);
    const row = channelRow(on.go, 812, 'minters');
    expect(row?.name).toBe('minters');
    expect(row?.archived).toBe(false);
    expect(row?.position).toBe(7);
    expect(retryTimers(on.go)).toBe(0);
  });

  it('applies an edit that waited for its base as soon as the snapshot arrives', async () => {
    const creator = identity();
    const admin = identity();
    const local = identity();
    const g = 813;
    const t0 = Date.now() - 10 * MINUTE;
    const create = metaEvent(
      creator,
      g,
      'channel_create',
      { channelId: 'minters', name: 'minters', position: 3 },
      t0
    );
    const snapshot = await hubSnapshot({
      groupId: g,
      signer: admin,
      creates: [create],
      formerAdmins: [creator],
    });
    const go = makeManager({
      profile: PROFILE_ON,
      admin: (_g, address) => address === admin.address,
    });
    asMember(go, g, local, false);
    (go as any).subscribedGroups.add(g);
    const archive = metaEvent(
      admin,
      g,
      'channel_archive',
      { channelId: 'minters' },
      t0 + MINUTE
    );
    await deliver(go, create, archive);
    expect(channelRow(go, g, 'minters')).toBeNull();
    expect(retryTimers(go)).toBe(1);
    await (go as any).handleMetadataSnapshotOffer(
      g,
      { s: snapshot.publicWire },
      PEER
    );
    await sleep(250);
    expect(channelRow(go, g, 'minters')?.archived).toBe(true);
    expect(retryTimers(go)).toBe(0);
  });

  it('never applies an edit by a member or by the ex-admin creator', async () => {
    const v = await goWithVouchedChannel(PROFILE_ON, 814);
    const memberArchive = metaEvent(
      v.member,
      814,
      'channel_archive',
      { channelId: 'minters' },
      v.t0 + MINUTE
    );
    const memberRename = metaEvent(
      v.member,
      814,
      'channel_update',
      {
        channelId: 'minters',
        categoryId: '',
        name: 'hijacked',
        position: 0,
        writeMode: 'members',
        readMode: 'members',
      },
      v.t0 + 2 * MINUTE
    );
    const creatorRename = metaEvent(
      v.creator,
      814,
      'channel_update',
      { channelId: 'minters', categoryId: '', name: 'mine again', position: 0 },
      v.t0 + 3 * MINUTE
    );
    await deliver(v.go, memberArchive, memberRename, creatorRename);
    let row = channelRow(v.go, 814, 'minters');
    expect(row?.name).toBe('minters');
    expect(row?.archived).toBe(false);
    expect(row?.position).toBe(3);
    // A current admin's later edit lands on the snapshot's copy and still
    // carries none of the non-admin changes written before it.
    const adminReorder = metaEvent(
      v.admin,
      814,
      'channel_reorder',
      { channelId: 'minters', categoryId: '', position: 9 },
      v.t0 + 4 * MINUTE
    );
    await deliver(v.go, adminReorder);
    row = channelRow(v.go, 814, 'minters');
    expect(row?.name).toBe('minters');
    expect(row?.archived).toBe(false);
    expect(row?.position).toBe(9);
    // The three non-admin edits stay skipped (re-checked if their authors
    // become admins); only the create inside the snapshot is settled.
    expect(v.go.getChannelMetadataRecoveryState(814).skippedEvents).toBe(3);
    expect(retryTimers(v.go)).toBe(0);
  });

  it("still never projects an ex-admin's channel from events alone (V1)", async () => {
    const creator = identity();
    const admin = identity();
    const local = identity();
    const g = 815;
    const t0 = Date.now() - 10 * MINUTE;
    // Fresh GO: the create from a Hub page, a current admin's reorder live.
    const fresh = makeManager({
      profile: PROFILE_ON,
      admin: (_g, address) => address === admin.address,
    });
    asMember(fresh, g, local, false);
    const create = metaEvent(
      creator,
      g,
      'channel_create',
      { channelId: 'minters', name: 'minters', position: 3 },
      t0
    );
    const reorder = metaEvent(
      admin,
      g,
      'channel_reorder',
      { channelId: 'minters', categoryId: '', position: 5 },
      t0 + MINUTE
    );
    await deliver(fresh, create, reorder);
    expect(channelIds(fresh, g)).not.toContain('minters');
    expect(channelRow(fresh, g, 'minters')).toBeNull();
    expect(retryTimers(fresh)).toBe(1);

    // A GO that projected the create while its author was an admin keeps the
    // row, but a row without a snapshot vouching for it is not a base.
    const clock = { now: Date.now() };
    let creatorIsAdmin = true;
    const longRunning = makeManager({
      profile: PROFILE_ON,
      now: () => clock.now,
      admin: (_g, address) =>
        address === admin.address ||
        (address === creator.address && creatorIsAdmin),
    });
    asMember(longRunning, g, local, false);
    await deliver(longRunning, create);
    expect(channelRow(longRunning, g, 'minters')?.position).toBe(3);
    // Demoted on chain; past the 30 s admin cache Core's answer is seen.
    creatorIsAdmin = false;
    clock.now += 31_000;
    const laterReorder = metaEvent(
      admin,
      g,
      'channel_reorder',
      { channelId: 'minters', categoryId: '', position: 6 },
      t0 + 2 * MINUTE
    );
    await deliver(longRunning, laterReorder);
    expect(channelRow(longRunning, g, 'minters')?.position).toBe(3);
    expect(retryTimers(longRunning)).toBe(1);
    expect(snapshotBaseRebuilds()).toBe(0);
  });

  it('stops using the row as a base once a newer current-admin snapshot omits it', async () => {
    const v = await goWithVouchedChannel(PROFILE_ON, 816);
    expect(
      (v.go as any).snapshotVouchedChannelBase(816, 'minters')?.snapshotHash
    ).toBe(v.snapshot.publicHash);
    // Another current admin's Hub never had 'minters' and signs a newer
    // snapshot of the group.
    const otherAdmin = identity();
    v.currentAdmins.add(otherAdmin.address);
    await sleep(5);
    const board = metaEvent(
      otherAdmin,
      816,
      'channel_create',
      { channelId: 'board', name: 'board', position: 1 },
      Date.now() - MINUTE
    );
    const newer = await hubSnapshot({
      groupId: 816,
      signer: otherAdmin,
      creates: [board],
    });
    await (v.go as any).handleMetadataSnapshotOffer(
      816,
      { s: newer.publicWire },
      PEER
    );
    expect(
      (v.go as any).db.getLatestMetadataSnapshot(816, 'public')?.snapshotHash
    ).toBe(newer.publicHash);
    expect((v.go as any).snapshotVouchedChannelBase(816, 'minters')).toBeNull();
    const archive = metaEvent(
      v.admin,
      816,
      'channel_archive',
      { channelId: 'minters' },
      v.t0 + MINUTE
    );
    await deliver(v.go, archive);
    // The row keeps its content; the edit waits like upstream.
    const row = channelRow(v.go, 816, 'minters');
    expect(row?.name).toBe('minters');
    expect(row?.archived).toBe(false);
    expect(retryTimers(v.go)).toBe(1);
    expect(snapshotBaseRebuilds()).toBe(0);
  });

  it('stops vouching once the signer loses admin, until a current admin signs again', async () => {
    const v = await goWithVouchedChannel(PROFILE_ON, 817);
    // Y is demoted on chain; W is a current admin now. Y's snapshot is still
    // the latest one and still lists the channel, but only a CURRENT admin's
    // snapshot vouches. Past the 30 s admin cache Core's answer is seen.
    const newAdmin = identity();
    v.currentAdmins.delete(v.admin.address);
    v.currentAdmins.add(newAdmin.address);
    (v.go as any).groupAdminValidationCache.clear();
    const archive = metaEvent(
      newAdmin,
      817,
      'channel_archive',
      { channelId: 'minters' },
      v.t0 + MINUTE
    );
    await deliver(v.go, archive);
    let row = channelRow(v.go, 817, 'minters');
    expect(row?.name).toBe('minters');
    expect(row?.archived).toBe(false);
    expect(retryTimers(v.go)).toBe(1);
    expect(snapshotBaseRebuilds()).toBe(0);
    // W's own Hub signs a newer snapshot that still lists the channel: that
    // one vouches, and the waiting archive applies on top of it.
    await sleep(5);
    const newer = await hubSnapshot({
      groupId: 817,
      signer: newAdmin,
      creates: [v.create],
      formerAdmins: [v.creator],
    });
    await (v.go as any).handleMetadataSnapshotOffer(
      817,
      { s: newer.publicWire },
      PEER
    );
    await sleep(250);
    expect(
      (v.go as any).snapshotVouchedChannelBase(817, 'minters')?.snapshotHash
    ).toBe(newer.publicHash);
    row = channelRow(v.go, 817, 'minters');
    expect(row?.archived).toBe(true);
    expect(retryTimers(v.go)).toBe(0);
    expect(snapshotBaseRebuilds()).toBe(1);
  });

  it('waits for Core when the signer of the vouching snapshot is unknown', async () => {
    const v = await goWithVouchedChannel(PROFILE_ON, 819);
    // Core has no answer for the signer Y right now (past the 30 s admin
    // cache); W, the archive's author, is a known current admin.
    const otherAdmin = identity();
    v.currentAdmins.add(otherAdmin.address);
    v.unknownAdmins.add(v.admin.address);
    (v.go as any).groupAdminValidationCache.clear();
    const archive = metaEvent(
      otherAdmin,
      819,
      'channel_archive',
      { channelId: 'minters' },
      v.t0 + MINUTE
    );
    await deliver(v.go, archive);
    // No provisional base: nothing applies while the signer is unknown.
    expect(channelRow(v.go, 819, 'minters')?.archived).toBe(false);
    expect(snapshotBaseRebuilds()).toBe(0);
    expect(
      (v.go as any).channelMetadataUnknownAdminAuthors
        .get(819)
        ?.has(v.admin.address)
    ).toBe(true);
  });

  it("uses an admin's full snapshot for an admin-only channel", async () => {
    const creator = identity();
    const admin = identity();
    const local = identity();
    const g = 818;
    const t0 = Date.now() - 10 * MINUTE;
    const create = metaEvent(
      creator,
      g,
      'channel_create',
      {
        channelId: 'council',
        name: 'council',
        position: 2,
        writeMode: 'admins',
        readMode: 'admins',
      },
      t0
    );
    const snapshot = await hubSnapshot({
      groupId: g,
      signer: admin,
      creates: [create],
      formerAdmins: [creator],
    });
    const go = makeManager({
      profile: PROFILE_ON,
      admin: (_g, address) =>
        address === admin.address || address === local.address,
    });
    asMember(go, g, local, true);
    (go as any).subscribedGroups.add(g);
    await (go as any).handleMetadataSnapshotOffer(
      g,
      { s: snapshot.fullWire },
      PEER
    );
    expect(channelIds(go, g)).toContain('council');
    const archive = metaEvent(
      admin,
      g,
      'channel_archive',
      { channelId: 'council' },
      t0 + MINUTE
    );
    await deliver(go, create, archive);
    const row = channelRow(go, g, 'council');
    expect(row?.archived).toBe(true);
    expect(row?.readMode).toBe('admins');
    expect(retryTimers(go)).toBe(0);
  });
});
