import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { afterEach, describe, expect, it, vi } from 'vitest';

// GO author-gap repair, age-aware (mobileProfile.authorGapAgeAware): a gap
// row whose next stored message is older than the serve floor is asked only
// of Hub-class (non-'ds1') peers, each once, then parked for 30 days; only a
// Hub-class provider that has not answered wakes it, at most once a day. The
// asked list survives group-wide wakes and restarts. Recent and undated rows
// keep the usual rules. Runs the real engine and its SQL on Node's built-in
// SQLite (node:sqlite) through the better-sqlite3 adapter used by
// reticulum-chat-author-gap-denials.test.ts.
vi.mock('better-sqlite3', async () => {
  const { createRequire } = await import('node:module');
  const load = createRequire(import.meta.url);
  let DatabaseSync: (new (file: string) => any) | null = null;
  try {
    ({ DatabaseSync } = load('node:sqlite') as {
      DatabaseSync: new (file: string) => any;
    });
  } catch {
    DatabaseSync = null; // The tests below are skipped.
  }
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
      if (!DatabaseSync) throw new Error('node:sqlite is not available');
      this.db = new DatabaseSync(file);
    }
    prepare(sql: string) {
      const statement = this.db.prepare(sql);
      // better-sqlite3 and the GO shim ignore object keys a statement does
      // not use (the known-unavailable park passes the marker's fields).
      statement.setAllowUnknownNamedParameters?.(true);
      return new Statement(statement);
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
  ReticulumChatManager,
  type ReticulumChatEvent,
  type ReticulumChatMobileProfile,
} from './reticulum-chat';
import { ReticulumChatDatabase } from './reticulum-chat-db';

const DatabaseSync = (() => {
  try {
    return (
      createRequire(import.meta.url)('node:sqlite') as {
        DatabaseSync: unknown;
      }
    ).DatabaseSync;
  } catch {
    return null;
  }
})();

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const LOCAL = 'f'.repeat(32);
const STREAM = 'c'.repeat(32);
const G = 716;
const START = Date.UTC(2026, 9, 16, 20, 11, 32);
const P = (c: string) => c.repeat(32);

/** What engineHost sets for the gap lanes (round 1 + this option). */
const GO_ROUND1: ReticulumChatMobileProfile = {
  keepMembershipDeferredPulls: true,
  authorGapNoHistoryExclusion: true,
  recentGapsFirst: true,
  gapDenialBackoff: true,
};
const GO_AGE: ReticulumChatMobileProfile = {
  ...GO_ROUND1,
  authorGapAgeAware: true,
};

const managers: ReticulumChatManager[] = [];
const roots: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-gap-age-'));
  roots.push(root);
  return path.join(root, 'reticulum-chat.db');
}

function quiet(): void {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
}

const rawDb = (manager: ReticulumChatManager) => (manager as any).db.db;

type RawRow = {
  attempts: number;
  next_attempt_at: number;
  preferred_peer: string | null;
};

function rowOf(
  manager: ReticulumChatManager,
  author: string,
  from: number,
  to = from
): RawRow | undefined {
  return rawDb(manager)
    .prepare(
      `SELECT attempts, next_attempt_at, preferred_peer
       FROM rchat_missing_stream_ranges
       WHERE group_id = ? AND author_address = ? AND from_seq = ? AND to_seq = ?`
    )
    .get(G, author, from, to) as RawRow | undefined;
}

function markerOf(
  manager: ReticulumChatManager,
  author: string,
  from: number,
  to = from
): { recheck_at: number } | undefined {
  return rawDb(manager)
    .prepare(
      `SELECT recheck_at FROM rchat_known_unavailable_ranges
       WHERE group_id = ? AND author_address = ? AND from_seq = ? AND to_seq = ?`
    )
    .get(G, author, from, to) as { recheck_at: number } | undefined;
}

function hasOldGapAskTable(manager: ReticulumChatManager): boolean {
  return Boolean(
    rawDb(manager)
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rchat_old_gap_asks'`
      )
      .get()
  );
}

function seedHeader(
  db: any,
  author: string,
  seq: number,
  timestamp: number
): void {
  db.prepare(
    `INSERT INTO rchat_event_headers
       (event_id, group_id, channel_id, author_address, author_public_key,
        author_stream_id, author_seq, timestamp, feed_timestamp, event_type,
        payload_hash, signature, last_served_at, stored_at, accepted_at,
        wire_bytes)
     VALUES (?, ?, 'general', ?, 'pk', ?, ?, ?, ?, 'message', 'hash', 'sig', 0, 0, 0, 1)`
  ).run(
    `h-${G}-${author}-${seq}`,
    G,
    author,
    STREAM,
    seq,
    timestamp,
    timestamp
  );
}

function fakeEvent(
  author: string,
  seq: number,
  timestamp: number
): ReticulumChatEvent {
  return {
    eventId: `ev-${author}-${seq}`,
    groupId: G,
    channelId: 'general',
    authorAddress: author,
    authorPublicKey: 'pk',
    authorStreamId: STREAM,
    authorSeq: seq,
    timestamp,
    eventType: 'message',
    encryptedPayload: 'ciphertext',
    payloadHash: 'hash',
    mentionAddressHashes: [],
    signature: `sig-${author}-${seq}`,
  } as ReticulumChatEvent;
}

type Behaviour = 'deny' | 'no_history' | 'serve';
/** 'go' peers advertise 'ds1' in their hello; 'hub' peers do not. */
type Kind = 'go' | 'hub';

type Sim = {
  clock: { now: number };
  manager: any;
  peers: string[];
  stats: {
    links: number;
    asked: Array<{ peer: string; at: number; author: string }>;
  };
  repairedAt: Map<string, number>;
  addPeer: (peer: string, behaviour: Behaviour, kind: Kind) => void;
  run: (
    untilMs: number,
    hooks?: { everyMs?: number; onTick?: (now: number) => void }
  ) => Promise<void>;
  dbPath: string;
};

/**
 * Simulated time around the real scanner and failure handlers (the harness
 * of reticulum-chat-author-gap-denials.test.ts, plus each peer's hello kind).
 * Sends stop at sendAuthorRangeRequest; the peer's answer comes back 1.5 s
 * later through handleEventPageResourceFailure or, for 'serve', as the
 * range's events being stored.
 */
function makeSim(opts: {
  peers: Array<[string, Behaviour, Kind]>;
  profile?: ReticulumChatMobileProfile;
  start?: number;
  dbPath?: string;
}): Sim {
  const clock = { now: opts.start ?? START };
  const peers = opts.peers.map(([p]) => p);
  const behaviour = new Map<string, Behaviour>(
    opts.peers.map(([p, b]) => [p, b])
  );
  const dbPath = opts.dbPath ?? tempDbPath();
  const manager = new ReticulumChatManager({
    dbPath,
    bridge: {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => LOCAL,
    } as any,
    now: () => clock.now,
    getVerifiedReticulumPeers: () =>
      peers.map((destinationHash, i) => ({
        destinationHash,
        address: `QProvider${i}`,
        lastSeen: clock.now - i,
      })),
    getAccountEndpointLeases: () => [],
    mobileProfile: opts.profile,
  } as any) as any;
  managers.push(manager);
  manager.setLocalGroupMemberships([G]);
  manager.subscribeGroup(G);
  const setKind = (peer: string, kind: Kind) => {
    manager.peerProtocolFeatures.set(
      peer,
      new Set(kind === 'go' ? ['hello_v3', 'ds1'] : ['hello_v3'])
    );
  };
  for (const [peer, , kind] of opts.peers) setKind(peer, kind);
  const stats: Sim['stats'] = { links: 0, asked: [] };
  const repairedAt = new Map<string, number>();
  let scannerDueAt = Number.POSITIVE_INFINITY;
  manager.scheduleBackgroundAuthorGapRepair = (delayMs = 60_000) => {
    const due = clock.now + Math.max(1, Math.floor(delayMs));
    if (due < scannerDueAt) scannerDueAt = due;
  };
  const responses: Array<{
    at: number;
    transferId: string;
    reason: string;
    range: any;
  }> = [];
  let nextTransfer = 1;
  manager.sendAuthorRangeRequest = async (
    peerHash: string,
    wire: any,
    persistedRange: any
  ) => {
    const peer = peerHash.trim().toLowerCase();
    const requestKey = manager.directAuthorRangeRequestKey(peer, wire.g, {
      ...persistedRange,
    });
    const existingTransferId =
      manager.directHistoryPageRequestKeys.get(requestKey);
    if (existingTransferId) {
      const existing =
        manager.directHistoryPageRequests.get(existingTransferId);
      if (existing && clock.now - Number(existing.requestedAt || 0) < 20_000) {
        return { ok: true };
      }
      manager.removeDirectHistoryPageRequest(existingTransferId);
    }
    const transferId = (nextTransfer++).toString(16).padStart(16, '0');
    manager.trackDirectHistoryPageRequest(requestKey, requestKey, {
      transferId,
      groupId: wire.g,
      channelId: '*',
      direction: 'range',
      pageHash: '',
      sizeBytes: 1,
      eventCount: 100,
      sourcePeerHash: peer,
      senderReticulumDestinationHash: peer,
      repairRange: persistedRange,
      requesterAddress: 'QLocal',
      requestedAt: clock.now,
    });
    stats.links += 1;
    stats.asked.push({ peer, at: clock.now, author: persistedRange.a });
    const b = behaviour.get(peer) ?? 'deny';
    responses.push({
      at: clock.now + 1_500,
      transferId,
      reason:
        b === 'deny'
          ? 'no_history_events'
          : b === 'no_history'
            ? 'history_unavailable'
            : 'serve',
      range: persistedRange,
    });
    return { ok: true };
  };
  const flush = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    await new Promise((r) => setImmediate(r));
  };
  const run: Sim['run'] = async (untilMs, hooks) => {
    const end = clock.now + untilMs;
    for (const p of peers) manager.notePeerSubscription(p, G, true);
    let nextSub = clock.now + MIN;
    let nextHook = hooks?.everyMs
      ? clock.now + hooks.everyMs
      : Number.POSITIVE_INFINITY;
    while (clock.now < end) {
      responses.sort((a, b) => a.at - b.at);
      const nextResp = responses.length
        ? responses[0].at
        : Number.POSITIVE_INFINITY;
      const next = Math.min(scannerDueAt, nextResp, nextSub, nextHook, end);
      clock.now = Math.max(clock.now, next);
      if (next === nextSub) {
        for (const p of peers) manager.notePeerSubscription(p, G, true);
        nextSub = clock.now + MIN;
        continue;
      }
      if (next === nextHook) {
        hooks?.onTick?.(clock.now);
        nextHook = clock.now + (hooks?.everyMs ?? 0);
        await flush();
        continue;
      }
      if (next === nextResp) {
        const r = responses.shift()!;
        if (r.reason === 'serve') {
          manager.removeDirectHistoryPageRequest(r.transferId);
          for (let seq = r.range.from; seq <= r.range.to; seq += 1) {
            manager.db.insertEvent(
              fakeEvent(r.range.a, seq, clock.now - 40 * DAY),
              false
            );
          }
          if (!repairedAt.has(r.range.a)) repairedAt.set(r.range.a, clock.now);
        } else {
          manager.handleEventPageResourceFailure(r.transferId, r.reason);
        }
        await flush();
        continue;
      }
      if (next === scannerDueAt) {
        scannerDueAt = Number.POSITIVE_INFINITY;
        manager.processBackgroundAuthorGapRepair();
        await flush();
        continue;
      }
    }
  };
  const addPeer: Sim['addPeer'] = (peer, b, kind) => {
    if (!peers.includes(peer)) peers.push(peer);
    behaviour.set(peer, b);
    setKind(peer, kind);
    manager.notePeerSubscription(peer, G, true);
  };
  return { clock, manager, peers, stats, repairedAt, addPeer, run, dbPath };
}

/** A missing message (seq 34) whose stored neighbour (35) is `ageMs` old. */
function seedHole(sim: Sim, author: string, ageMs: number, firstPeer: string) {
  seedHeader(rawDb(sim.manager), author, 33, START - ageMs - HOUR);
  seedHeader(rawDb(sim.manager), author, 35, START - ageMs);
  (sim.manager.db as ReticulumChatDatabase).ensureMissingRange(
    G,
    author,
    STREAM,
    34,
    34,
    firstPeer
  );
  sim.manager.scheduleBackgroundAuthorGapRepair(1);
  return { a: author, s: STREAM, from: 34, to: 34 };
}

const askedPeers = (sim: Sim) => sim.stats.asked.map((a) => a.peer);

// Locally an older Node skips these; CI must not skip them silently.
it.runIf(!DatabaseSync && !!process.env.CI)(
  'has node:sqlite for the real-SQL age-aware author-gap tests',
  () => {
    expect(DatabaseSync).not.toBeNull();
  }
);

describe.skipIf(!DatabaseSync)(
  'author-gap age-aware parking (real SQL)',
  () => {
    it('an old row with only GO peers around: no request at all, parked 30 days', async () => {
      quiet();
      const sim = makeSim({
        profile: GO_AGE,
        peers: [
          [P('1'), 'deny', 'go'],
          [P('2'), 'serve', 'go'],
          [P('3'), 'deny', 'go'],
        ],
      });
      seedHole(sim, 'QOld', 40 * DAY, P('1'));
      await sim.run(10 * MIN);
      expect(sim.stats.links).toBe(0);
      const row = rowOf(sim.manager, 'QOld', 34)!;
      expect(row.next_attempt_at).toBeGreaterThanOrEqual(START + 30 * DAY);
      expect(markerOf(sim.manager, 'QOld', 34)?.recheck_at).toBe(
        row.next_attempt_at
      );
      expect(sim.manager.getDeliveryCounters().authorGapOldParked).toBe(1);
      // It stays parked: two more days, nothing.
      await sim.run(2 * DAY);
      expect(sim.stats.links).toBe(0);
      expect(sim.manager.getDeliveryCounters().authorGapOldParked).toBe(1);
    });

    it('without the option the same row is asked of the GO peers (upstream)', async () => {
      quiet();
      const sim = makeSim({
        profile: GO_ROUND1,
        peers: [
          [P('1'), 'deny', 'go'],
          [P('2'), 'deny', 'go'],
          [P('3'), 'deny', 'go'],
        ],
      });
      seedHole(sim, 'QOld', 40 * DAY, P('1'));
      await sim.run(10 * MIN);
      expect(sim.stats.links).toBeGreaterThanOrEqual(3);
      expect(hasOldGapAskTable(sim.manager)).toBe(false);
    });

    it('asks each Hub once; a group-wide wake, asked Hubs and GO peers never bring it back; a new Hub wakes it once a day; kept across a restart', async () => {
      quiet();
      const sim = makeSim({
        profile: GO_AGE,
        peers: [
          [P('1'), 'serve', 'go'],
          [P('a'), 'deny', 'hub'],
          [P('b'), 'deny', 'hub'],
        ],
      });
      const range = seedHole(sim, 'QOld', 40 * DAY, P('1'));
      const db = sim.manager.db as ReticulumChatDatabase;
      await sim.run(10 * MIN);
      // Hubs only, once each, a minute apart; the GO peer is never asked.
      expect(askedPeers(sim)).toEqual([P('a'), P('b')]);
      expect(
        sim.stats.asked[1].at - sim.stats.asked[0].at
      ).toBeGreaterThanOrEqual(MIN);
      expect(rowOf(sim.manager, 'QOld', 34)!.next_attempt_at).toBeGreaterThan(
        sim.clock.now + 29 * DAY
      );
      expect(
        db.getOldGapAskState(G, 'QOld', STREAM, 34, 34).askedPeers.sort()
      ).toEqual([P('a'), P('b')]);

      // An access change wakes every parked row of the group and clears the
      // markers; the asked list is kept, so nobody is asked again.
      expect(db.wakeKnownUnavailableRangesForGroup(G, sim.clock.now)).toBe(1);
      expect(markerOf(sim.manager, 'QOld', 34)).toBeUndefined();
      sim.manager.scheduleBackgroundAuthorGapRepair(1);
      await sim.run(10 * MIN);
      expect(sim.stats.links).toBe(2);
      expect(rowOf(sim.manager, 'QOld', 34)!.next_attempt_at).toBeGreaterThan(
        sim.clock.now + 29 * DAY
      );

      // Digests naming the row from an asked Hub or from a GO peer: no wake.
      sim.manager.recordAuthorGapRanges(
        G,
        P('a'),
        [range],
        'group_state_digest_v3'
      );
      sim.manager.recordAuthorGapRanges(
        G,
        P('1'),
        [range],
        'group_state_digest_v3'
      );
      sim.manager.scheduleBackgroundAuthorGapRepair(1);
      await sim.run(HOUR);
      expect(sim.stats.links).toBe(2);

      // A Hub that has not answered yet: one wake, one ask, parked again.
      sim.addPeer(P('c'), 'deny', 'hub');
      sim.manager.recordAuthorGapRanges(
        G,
        P('c'),
        [range],
        'group_state_digest_v3'
      );
      sim.manager.scheduleBackgroundAuthorGapRepair(1);
      await sim.run(10 * MIN);
      expect(askedPeers(sim)).toEqual([P('a'), P('b'), P('c')]);
      expect(sim.manager.getDeliveryCounters().authorGapOldWake).toBe(1);
      expect(rowOf(sim.manager, 'QOld', 34)!.next_attempt_at).toBeGreaterThan(
        sim.clock.now + 29 * DAY
      );

      // Another new Hub the same day: no wake (at most one a day).
      sim.addPeer(P('d'), 'deny', 'hub');
      sim.manager.recordAuthorGapRanges(
        G,
        P('d'),
        [range],
        'group_state_digest_v3'
      );
      sim.manager.scheduleBackgroundAuthorGapRepair(1);
      await sim.run(10 * MIN);
      expect(sim.stats.links).toBe(3);

      // The next day it may: one ask of d only (e is new too, but the wake is
      // for one ask).
      await sim.run(DAY);
      sim.addPeer(P('e'), 'deny', 'hub');
      sim.manager.recordAuthorGapRanges(
        G,
        P('d'),
        [range],
        'group_state_digest_v3'
      );
      sim.manager.scheduleBackgroundAuthorGapRepair(1);
      await sim.run(10 * MIN);
      expect(askedPeers(sim)).toEqual([P('a'), P('b'), P('c'), P('d')]);

      // Restart on the same database: the asked list and the park hold.
      const dbPath = sim.dbPath;
      const now = sim.clock.now;
      sim.manager.close();
      managers.splice(managers.indexOf(sim.manager), 1);
      const again = makeSim({
        profile: GO_AGE,
        dbPath,
        start: now,
        peers: [
          [P('1'), 'serve', 'go'],
          [P('a'), 'deny', 'hub'],
          [P('b'), 'deny', 'hub'],
          [P('c'), 'deny', 'hub'],
          [P('d'), 'deny', 'hub'],
        ],
      });
      again.manager.scheduleBackgroundAuthorGapRepair(1);
      for (const peer of [P('1'), P('a'), P('b'), P('c'), P('d')]) {
        again.manager.recordAuthorGapRanges(
          G,
          peer,
          [range],
          'group_state_digest_v3'
        );
      }
      await again.run(2 * DAY);
      expect(again.stats.links).toBe(0);
      expect(
        (again.manager.db as ReticulumChatDatabase)
          .getOldGapAskState(G, 'QOld', STREAM, 34, 34)
          .askedPeers.sort()
      ).toEqual([P('a'), P('b'), P('c'), P('d')]);
    });

    it('a Hub that holds the row fills it; GO peers are never asked', async () => {
      quiet();
      const sim = makeSim({
        profile: GO_AGE,
        peers: [
          [P('1'), 'serve', 'go'],
          [P('a'), 'deny', 'hub'],
          [P('b'), 'serve', 'hub'],
        ],
      });
      seedHole(sim, 'QOld', 40 * DAY, P('1'));
      await sim.run(10 * MIN);
      expect(askedPeers(sim)).toEqual([P('a'), P('b')]);
      expect(sim.repairedAt.has('QOld')).toBe(true);
      expect(rowOf(sim.manager, 'QOld', 34)).toBeUndefined();
    });

    it('history_unavailable from a Hub is final for an old row', async () => {
      quiet();
      const sim = makeSim({
        profile: GO_AGE,
        peers: [
          [P('1'), 'serve', 'go'],
          [P('a'), 'no_history', 'hub'],
        ],
      });
      seedHole(sim, 'QOld', 40 * DAY, P('a'));
      await sim.run(2 * HOUR);
      expect(askedPeers(sim)).toEqual([P('a')]);
      expect(rowOf(sim.manager, 'QOld', 34)!.next_attempt_at).toBeGreaterThan(
        sim.clock.now + 29 * DAY
      );
      expect(
        (sim.manager.db as ReticulumChatDatabase).getOldGapAskState(
          G,
          'QOld',
          STREAM,
          34,
          34
        ).askedPeers
      ).toEqual([P('a')]);
    });

    it('after this account becomes admin each Hub is asked once more', async () => {
      quiet();
      const sim = makeSim({
        profile: GO_AGE,
        peers: [
          [P('1'), 'serve', 'go'],
          [P('a'), 'deny', 'hub'],
          [P('b'), 'deny', 'hub'],
        ],
      });
      seedHole(sim, 'QOld', 40 * DAY, P('1'));
      const db = sim.manager.db as ReticulumChatDatabase;
      await sim.run(10 * MIN);
      expect(askedPeers(sim)).toEqual([P('a'), P('b')]);
      // A Hub's "none" may only have meant "not for you" (admin-only
      // channels are filtered by the requester's access): after the
      // promotion the asked list is forgotten, so each Hub gets one more ask
      // under the new access (after the usual 6 h per-peer quarantine), then
      // the row parks again. GO is never asked.
      sim.manager.setLocalGroupMemberships([
        {
          groupId: G,
          isAdmin: true,
          adminStatusAuthoritative: true,
          localAddress: 'QLocal',
        },
      ]);
      expect(
        db.getOldGapAskState(G, 'QOld', STREAM, 34, 34).askedPeers
      ).toEqual([]);
      await sim.run(7 * HOUR);
      expect(askedPeers(sim)).toEqual([P('a'), P('b'), P('a'), P('b')]);
      expect(rowOf(sim.manager, 'QOld', 34)!.next_attempt_at).toBeGreaterThan(
        sim.clock.now + 29 * DAY
      );
      // Nothing changes on a membership push without new access.
      sim.manager.setLocalGroupMemberships([
        {
          groupId: G,
          isAdmin: true,
          adminStatusAuthoritative: true,
          localAddress: 'QLocal',
        },
      ]);
      sim.manager.scheduleBackgroundAuthorGapRepair(1);
      await sim.run(HOUR);
      expect(sim.stats.links).toBe(4);
    });

    it('an asked-list schema created inside a rolled-back batch is created again', () => {
      quiet();
      const sim = makeSim({ profile: GO_AGE, peers: [] });
      const db = sim.manager.db as ReticulumChatDatabase;
      expect(() =>
        db.runWriteBatch(() => {
          db.getOldGapAskState(G, 'QOld', STREAM, 34, 34);
          throw new Error('a later write failed');
        })
      ).toThrow('a later write failed');
      expect(hasOldGapAskTable(sim.manager)).toBe(false);
      // The first use after the rollback creates the table again instead of
      // failing with "no such table" until the worker restarts.
      expect(
        db.getOldGapAskState(G, 'QOld', STREAM, 34, 34).askedPeers
      ).toEqual([]);
      expect(
        db.noteOldGapAnswer(G, 'QOld', STREAM, 34, 34, P('a'), START)
      ).toBe(1);
      expect(hasOldGapAskTable(sim.manager)).toBe(true);
    });

    it('asks at most 3 Hubs a round, then parks', async () => {
      quiet();
      const sim = makeSim({
        profile: GO_AGE,
        peers: [
          [P('a'), 'deny', 'hub'],
          [P('b'), 'deny', 'hub'],
          [P('d'), 'deny', 'hub'],
          [P('e'), 'deny', 'hub'],
          [P('8'), 'deny', 'hub'],
        ],
      });
      seedHole(sim, 'QOld', 40 * DAY, P('a'));
      await sim.run(DAY);
      expect(sim.stats.links).toBe(3);
      expect(new Set(askedPeers(sim)).size).toBe(3);
      // The next round, 30 days on, asks the Hubs left, and only those.
      await sim.run(31 * DAY);
      expect(sim.stats.links).toBe(5);
      expect(new Set(askedPeers(sim)).size).toBe(5);
    });

    it('a big old backlog is asked at most twice a minute per group; a recent row still goes first', async () => {
      quiet();
      const sim = makeSim({
        profile: GO_AGE,
        peers: [
          [P('1'), 'deny', 'go'],
          [P('a'), 'deny', 'hub'],
          [P('b'), 'deny', 'hub'],
          [P('3'), 'serve', 'go'],
        ],
      });
      const db = sim.manager.db as ReticulumChatDatabase;
      for (let i = 0; i < 60; i += 1) {
        const author = `QOld${String(i).padStart(2, '0')}`;
        seedHeader(rawDb(sim.manager), author, 35, START - 40 * DAY);
        db.ensureMissingRange(G, author, STREAM, 34, 34, P('a'));
      }
      sim.manager.scheduleBackgroundAuthorGapRepair(1);
      await sim.run(5 * MIN);
      // 5 min at one old ask per 30 s: about 10 (GO peers never asked).
      expect(sim.stats.links).toBeGreaterThanOrEqual(8);
      expect(sim.stats.links).toBeLessThanOrEqual(11);
      expect(askedPeers(sim).every((p) => p === P('a') || p === P('b'))).toBe(
        true
      );
      // A recent gap that becomes due now is asked within the 30 s gate.
      seedHeader(rawDb(sim.manager), 'QNew', 35, sim.clock.now - HOUR);
      db.ensureMissingRange(G, 'QNew', STREAM, 34, 34, P('1'));
      const dueAt = sim.clock.now;
      sim.manager.scheduleBackgroundAuthorGapRepair(1);
      await sim.run(MIN);
      const first = sim.stats.asked.find((a) => a.author === 'QNew');
      expect(first?.peer).toBe(P('1'));
      expect(first!.at - dueAt).toBeLessThanOrEqual(31 * SEC);
    });

    it('a recent row is unaffected: GO peers are asked as before', async () => {
      quiet();
      const runOnce = async (profile: ReticulumChatMobileProfile) => {
        const sim = makeSim({
          profile,
          peers: [
            [P('1'), 'deny', 'go'],
            [P('2'), 'deny', 'go'],
            [P('3'), 'serve', 'go'],
          ],
        });
        seedHole(sim, 'QNew', HOUR, P('1'));
        await sim.run(10 * MIN);
        return sim;
      };
      const aware = await runOnce(GO_AGE);
      const plain = await runOnce(GO_ROUND1);
      expect(askedPeers(aware)).toEqual([P('1'), P('2'), P('3')]);
      expect(aware.stats.asked).toEqual(plain.stats.asked);
      expect(aware.repairedAt.get('QNew')).toBe(plain.repairedAt.get('QNew'));
      expect(hasOldGapAskTable(aware.manager)).toBe(false);
    });

    it('an undated tail row is unaffected', async () => {
      quiet();
      const runOnce = async (profile: ReticulumChatMobileProfile) => {
        const sim = makeSim({
          profile,
          peers: [
            [P('1'), 'deny', 'go'],
            [P('2'), 'deny', 'go'],
            [P('a'), 'deny', 'hub'],
          ],
        });
        // Seqs 1..3 missing, nothing stored after them.
        (sim.manager.db as ReticulumChatDatabase).ensureMissingRange(
          G,
          'QTail',
          STREAM,
          1,
          3,
          P('1')
        );
        sim.manager.scheduleBackgroundAuthorGapRepair(1);
        await sim.run(3 * HOUR);
        return sim;
      };
      const aware = await runOnce(GO_AGE);
      const plain = await runOnce(GO_ROUND1);
      expect(aware.stats.links).toBeGreaterThanOrEqual(3);
      expect(askedPeers(aware)).toContain(P('1'));
      expect(aware.stats.asked).toEqual(plain.stats.asked);
      expect(hasOldGapAskTable(aware.manager)).toBe(false);
    });

    it('an old event: its gap is not asked of a GO sender, but of a Hub that has not answered', async () => {
      quiet();
      const sim = makeSim({
        profile: GO_AGE,
        peers: [
          [P('1'), 'deny', 'go'],
          [P('a'), 'deny', 'hub'],
        ],
      });
      const db = sim.manager.db as ReticulumChatDatabase;
      db.insertEvent(fakeEvent('QOld', 10, START - 41 * DAY), false);
      const old = fakeEvent('QOld', 20, START - 40 * DAY);
      sim.manager.requestMissingAuthorRangeBeforeAccept(old, P('1'));
      await sim.run(SEC);
      expect(sim.stats.links).toBe(0);
      // The gap is recorded for the scanner all the same.
      expect(rowOf(sim.manager, 'QOld', 11, 19)).toBeDefined();
      sim.manager.requestMissingAuthorRangeBeforeAccept(old, P('a'));
      expect(askedPeers(sim)).toEqual([P('a')]);
      // A recent event from a GO peer still asks it (not old).
      db.insertEvent(fakeEvent('QNew', 10, START - 2 * HOUR), false);
      sim.manager.requestMissingAuthorRangeBeforeAccept(
        fakeEvent('QNew', 20, START - HOUR),
        P('1')
      );
      expect(askedPeers(sim)).toEqual([P('a'), P('1')]);
    });

    it('an immediate gap request never sends an old row to a GO peer', async () => {
      quiet();
      const sim = makeSim({
        profile: GO_AGE,
        peers: [
          [P('1'), 'deny', 'go'],
          [P('a'), 'deny', 'hub'],
        ],
      });
      const range = seedHole(sim, 'QOld', 40 * DAY, P('1'));
      expect(
        sim.manager.sendAuthorRangeRepairRequests(
          G,
          P('1'),
          [range],
          'range_page_more'
        )
      ).toBe(0);
      expect(sim.stats.links).toBe(0);
      expect(sim.manager.getDeliveryCounters().authorGapOldAskSkipped).toBe(1);
      expect(
        sim.manager.sendAuthorRangeRepairRequests(
          G,
          P('a'),
          [range],
          'range_page_more'
        )
      ).toBe(1);
      expect(askedPeers(sim)).toEqual([P('a')]);
    });

    /**
     * The churn case of the gap-backlog track (CHURN): a pool of 30 GO and 10
     * Hub peers, 12 subscribed at a time, rotating every 15 min, a digest
     * naming the row every 10 min. Upstream cost 44-80 links a day for one old
     * row; round 1 (denial streak) about 12/4/4.
     */
    it('an old row under rotating GO and Hub peers: a few Hub asks on day 1, at most one a day after', async () => {
      quiet();
      let seed = 4242;
      const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      const goPool = Array.from({ length: 30 }, (_, i) =>
        (0x1000 + i).toString(16).padStart(32, '0')
      );
      const hubPool = Array.from({ length: 10 }, (_, i) =>
        (0x2000 + i).toString(16).padStart(32, '0')
      );
      const pool = [...goPool, ...hubPool];
      const pick = () => {
        const left = [...pool];
        const out: string[] = [];
        while (out.length < 12) {
          out.push(left.splice(Math.floor(rnd() * left.length), 1)[0]);
        }
        return out;
      };
      const kindOf = (peer: string): Kind =>
        goPool.includes(peer) ? 'go' : 'hub';
      const initial = pick();
      const sim = makeSim({
        profile: GO_AGE,
        peers: initial.map((p) => [p, 'deny', kindOf(p)]),
      });
      for (const peer of pool) {
        sim.manager.peerProtocolFeatures.set(
          peer,
          new Set(kindOf(peer) === 'go' ? ['hello_v3', 'ds1'] : ['hello_v3'])
        );
      }
      const range = seedHole(sim, 'QOld', 40 * DAY, initial[0]);
      let tick = 0;
      const perDay: number[] = [];
      let before = 0;
      for (let d = 0; d < 3; d += 1) {
        await sim.run(DAY, {
          everyMs: 5 * MIN,
          onTick: () => {
            tick += 1;
            if (tick % 3 === 0) {
              sim.peers.length = 0;
              sim.peers.push(...pick());
            }
            if (tick % 2 === 0) {
              const peer = sim.peers[Math.floor(rnd() * sim.peers.length)];
              sim.manager.recordAuthorGapRanges(
                G,
                peer,
                [range],
                'group_state_digest_v3'
              );
              sim.manager.scheduleBackgroundAuthorGapRepair(60_000);
            }
          },
        });
        perDay.push(sim.stats.links - before);
        before = sim.stats.links;
      }
      const asked = askedPeers(sim);
      expect(asked.every((peer) => hubPool.includes(peer))).toBe(true);
      expect(new Set(asked).size).toBe(asked.length);
      expect(perDay[0]).toBeLessThanOrEqual(4);
      expect(perDay[1]).toBeLessThanOrEqual(1);
      expect(perDay[2]).toBeLessThanOrEqual(1);
    });
  }
);
