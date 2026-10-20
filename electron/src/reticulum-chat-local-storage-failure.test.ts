import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The real ReticulumChatDatabase SQL (missing-range rows) on Node's built-in
// SQLite, through the same minimal better-sqlite3 adapter as
// reticulum-chat-dm-page-delivery.test.ts.
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
  ReticulumChatManager,
  type ReticulumChatEventOffer,
  type ReticulumChatEventPageOffer,
  type ReticulumChatMetadataSnapshotResourceOffer,
} from './reticulum-chat';

const GROUP_ID = 950;
const PEER = 'a83d90afdae8d783'.padEnd(32, '0');
const OTHER_PEER = 'b0b0b0b0b0b0b0b0'.padEnd(32, '0');
const AUTHOR = 'QAuthorAddressForLocalFailureTest1';
const STREAM = 'e'.repeat(32);
const LOCAL = 'local_storage_unavailable';
const MINUTE = 60_000;

const managers: ReticulumChatManager[] = [];
const tempRoots: string[] = [];
const clock = { now: 1_800_000_000_000 };

afterEach(() => {
  vi.useRealTimers();
  for (const manager of managers.splice(0)) manager.close();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function makeManager(localFailuresAreLocal: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-local-failure-'));
  tempRoots.push(root);
  const manager = new ReticulumChatManager({
    dbPath: path.join(root, 'reticulum-chat.db'),
    now: () => clock.now,
    localNotifyScanIntervalMs: 60_000,
    ...(localFailuresAreLocal
      ? { mobileProfile: { localFailuresAreLocal: true } }
      : {}),
  });
  managers.push(manager);
  // Private state is what these tests check: route strikes, provider
  // backoffs and pull items have no public view.
  return { manager, m: manager as any, root };
}

async function flush(ticks = 6): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/**
 * An author-gap range page requested from PEER, claimed the way the
 * background repair does (attempt counted, next try 30 s out).
 */
function seedRangePage(
  m: any,
  transferId: string
): ReticulumChatEventPageOffer {
  const range = { a: AUTHOR, s: STREAM, from: 10, to: 40 };
  m.db.ensureMissingRange(GROUP_ID, AUTHOR, STREAM, 10, 40, PEER);
  m.db.claimMissingRangeAttempt(
    GROUP_ID,
    AUTHOR,
    STREAM,
    10,
    40,
    PEER,
    clock.now,
    clock.now + 30_000
  );
  m.authorGapPeerAttempts.set(
    m.authorGapSuppressionKey(PEER, GROUP_ID, range),
    { attempts: 1, nextAttemptAt: clock.now + 30_000 }
  );
  const offer: ReticulumChatEventPageOffer = {
    transferId,
    groupId: GROUP_ID,
    channelId: 'general',
    direction: 'range',
    pageHash: '',
    sizeBytes: 100,
    eventCount: 30,
    sourcePeerHash: PEER,
    repairRange: range,
    alternateSourcePeerHashes: [OTHER_PEER],
  };
  m.eventPageOffers.set(transferId, offer);
  return offer;
}

describe('local storage failures (mobileProfile.localFailuresAreLocal)', () => {
  it('a range page lost to ENOENT on its staged copy stays with the same peer', async () => {
    const { manager, m, root } = makeManager(true);
    seedRangePage(m, 't-page-1');
    // The staged OPFS copy the engine was told to read does not exist (the
    // copy into storage failed).
    const stagedPath = path.join(
      root,
      'reticulum-chat-temp',
      't-page-1.page.recv'
    );
    manager.handleResourceEvent({
      status: 'received',
      transferId: 't-page-1',
      path: stagedPath,
    } as any);
    await flush();

    expect(m.authorGapRouteBackoffs.size).toBe(0);
    const row = m.db.getMissingRange(GROUP_ID, AUTHOR, STREAM, 10, 40);
    expect(row.preferredPeer).toBe(PEER);
    expect(row.nextAttemptAt).toBeGreaterThanOrEqual(clock.now + MINUTE);
    // The claim's try against PEER is given back.
    const attempt = m.authorGapPeerAttempts.get(
      m.authorGapSuppressionKey(PEER, GROUP_ID, {
        a: AUTHOR,
        s: STREAM,
        from: 10,
        to: 40,
      })
    );
    expect(attempt.attempts).toBe(0);
    expect(m.eventPageOffers.has('t-page-1')).toBe(false);
    expect(manager.getDeliveryCounters().localImportFailure).toBe(1);
  });

  it('the host reason local_storage_unavailable is handled the same way', async () => {
    const { manager, m } = makeManager(true);
    seedRangePage(m, 't-page-2');
    manager.handleResourceEvent({
      status: 'failed',
      transferId: 't-page-2',
      reason: LOCAL,
    } as any);
    await flush();
    expect(m.authorGapRouteBackoffs.size).toBe(0);
    const row = m.db.getMissingRange(GROUP_ID, AUTHOR, STREAM, 10, 40);
    expect(row.preferredPeer).toBe(PEER);
    expect(row.nextAttemptAt).toBeGreaterThanOrEqual(clock.now + MINUTE);
    expect(manager.getDeliveryCounters().localImportFailure).toBe(1);
  });

  it('with the option off, the same ENOENT is still charged to the peer', async () => {
    const { manager, m, root } = makeManager(false);
    seedRangePage(m, 't-page-3');
    manager.handleResourceEvent({
      status: 'received',
      transferId: 't-page-3',
      path: path.join(root, 'missing.page.recv'),
    } as any);
    await flush();
    expect(m.authorGapRouteBackoffs.size).toBe(1);
    expect(manager.getDeliveryCounters().localImportFailure).toBeUndefined();
    // And the host reason means nothing special without the option.
    seedRangePage(m, 't-page-4');
    m.authorGapRouteBackoffs.clear();
    manager.handleResourceEvent({
      status: 'failed',
      transferId: 't-page-4',
      reason: LOCAL,
    } as any);
    await flush();
    expect(m.authorGapRouteBackoffs.size).toBe(1);
  });

  it('an ENOENT on some other path is not a local storage failure', async () => {
    const { m } = makeManager(true);
    expect(
      m.resourceImportFailureReason(
        Object.assign(new Error("ENOENT: no such file or directory, '/x/a'"), {
          code: 'ENOENT',
          path: '/x/a',
        }),
        '/x/staged.recv',
        'page_import_failed'
      )
    ).toBe('page_import_failed');
    expect(
      m.resourceImportFailureReason(
        new Error('EMFILE: no spare OPFS handles'),
        '/x/staged.recv',
        'page_import_failed'
      )
    ).toBe(LOCAL);
    expect(
      m.resourceImportFailureReason(
        Object.assign(new Error('nope'), { code: 'ENOSPC' }),
        '',
        'resource_import_failed'
      )
    ).toBe(LOCAL);
    expect(
      m.resourceImportFailureReason(
        new SyntaxError('Unexpected token'),
        '/x/staged.recv',
        'page_import_failed'
      )
    ).toBe('page_import_failed');
  });

  describe('metadata snapshots', () => {
    function seedActiveSnapshot(m: any, transferId: string) {
      const offer: ReticulumChatMetadataSnapshotResourceOffer = {
        transferId,
        groupId: GROUP_ID,
        snapshotHash: 'ab'.repeat(32),
        snapshotVersion: 3,
        sizeBytes: 500,
        fileHash: 'cd'.repeat(32),
        sourcePeerHash: PEER,
      };
      const key = `${GROUP_ID}:${offer.snapshotHash}`;
      m.metadataSnapshotOffers.set(transferId, offer);
      m.metadataSnapshotDownloadItems.set(key, {
        key,
        groupId: GROUP_ID,
        snapshotHash: offer.snapshotHash,
        candidates: new Map(),
        enqueuedAt: clock.now,
        activeTransferId: transferId,
      });
      m.metadataSnapshotDownloadQueue.push(key);
      m.metadataSnapshotActiveDownloads.set(transferId, {
        key,
        peerHash: PEER,
        timeout: setTimeout(() => {}, 0),
      });
      m.metadataSnapshotActiveDownloadsByPeer.set(PEER, 1);
      return offer;
    }

    it('a local failure puts no provider into backoff and asks it again later', async () => {
      const { manager, m, root } = makeManager(true);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const request = vi
        .spyOn(m, 'requestMetadataSnapshotFromPeer')
        .mockImplementation(() => undefined);
      const offer = seedActiveSnapshot(m, 't-snap-1');
      manager.handleResourceEvent({
        status: 'received',
        transferId: 't-snap-1',
        path: path.join(root, 'reticulum-chat-temp', 't-snap-1.recv'),
      } as any);
      await vi.advanceTimersByTimeAsync(0);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();

      expect(m.metadataSnapshotPeerBackoffs.size).toBe(0);
      expect(m.metadataSnapshotActiveDownloads.size).toBe(0);
      expect(manager.getDeliveryCounters().localImportFailure).toBe(1);
      expect(request).not.toHaveBeenCalled();
      // A second local failure for the same snapshot does not stack another
      // re-request.
      seedActiveSnapshot(m, 't-snap-2');
      manager.handleResourceEvent({
        status: 'failed',
        transferId: 't-snap-2',
        reason: LOCAL,
      } as any);
      expect(m.metadataSnapshotPeerBackoffs.size).toBe(0);

      await vi.advanceTimersByTimeAsync(MINUTE);
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith(
        PEER,
        GROUP_ID,
        offer.snapshotHash,
        true
      );
    });

    it('with the option off, the provider is backed off as before', async () => {
      const { manager, m } = makeManager(false);
      seedActiveSnapshot(m, 't-snap-3');
      manager.handleResourceEvent({
        status: 'failed',
        transferId: 't-snap-3',
        reason: LOCAL,
      } as any);
      expect(m.metadataSnapshotPeerBackoffs.has(PEER)).toBe(true);
      expect(manager.getDeliveryCounters().localImportFailure).toBeUndefined();
    });
  });

  describe('DM page pulls', () => {
    function seedDmPull(m: any, transferId: string) {
      const pull = {
        key: 'dm-pull-1',
        conversationId: 'c'.repeat(64),
        sourcePeerHash: PEER,
        attempts: 2,
        inFlight: true,
        activeRequestId: 'req-1',
        retryTimer: null as null | ReturnType<typeof setTimeout>,
        createdAt: clock.now,
      };
      m.directDmPulls.set(pull.key, pull);
      m.directDmPageRequests.set(transferId, {
        transferId,
        conversationId: pull.conversationId,
        pageHash: '',
        sizeBytes: 100,
        eventCount: 1,
        sourcePeerHash: PEER,
        pullKey: pull.key,
        requestId: 'req-1',
      });
      return pull;
    }

    it('asks the same device again later without spending the try', async () => {
      const { manager, m } = makeManager(true);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const run = vi
        .spyOn(m, 'runDirectDmPull')
        .mockImplementation(async () => undefined);
      const pull = seedDmPull(m, 't-dm-1');
      manager.handleResourceEvent({
        status: 'failed',
        transferId: 't-dm-1',
        reason: LOCAL,
      } as any);
      expect(pull.attempts).toBe(1);
      expect(pull.inFlight).toBe(false);
      expect(pull.retryTimer).not.toBeNull();
      expect(manager.getDeliveryCounters().localImportFailure).toBe(1);
      await vi.advanceTimersByTimeAsync(MINUTE - 1_000);
      expect(run).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(run).toHaveBeenCalledWith('dm-pull-1');
    });
  });

  describe('single event pulls', () => {
    function seedEventPull(m: any, transferId: string) {
      const eventId = 'f'.repeat(64);
      const offer: ReticulumChatEventOffer = {
        transferId,
        eventId,
        groupId: GROUP_ID,
        payloadHash: '',
        wireHash: '',
        sizeBytes: 100,
        sourcePeerHash: PEER,
      };
      const item = {
        hint: { eventId, groupId: GROUP_ID, timestamp: clock.now },
        peerHashes: new Set([PEER, OTHER_PEER]),
        digestFingerprint: '',
        attempts: 2,
        nextAttemptAt: clock.now,
        inFlight: true,
      };
      m.resourceOffers.set(transferId, offer);
      m.pendingEventPulls.set(m.eventPullKey(GROUP_ID, eventId), item);
      return item;
    }

    it('keeps every peer and gives the try back', async () => {
      const { manager, m } = makeManager(true);
      const item = seedEventPull(m, 't-event-1');
      manager.handleResourceEvent({
        status: 'failed',
        transferId: 't-event-1',
        reason: LOCAL,
      } as any);
      expect([...item.peerHashes].sort()).toEqual([PEER, OTHER_PEER].sort());
      expect(item.attempts).toBe(1);
      expect(item.inFlight).toBe(false);
      expect(item.nextAttemptAt).toBeGreaterThanOrEqual(clock.now + MINUTE);
      expect(manager.getDeliveryCounters().localImportFailure).toBe(1);
    });

    it('with the option off, the failing peer is dropped as before', async () => {
      const { manager, m } = makeManager(false);
      const item = seedEventPull(m, 't-event-2');
      manager.handleResourceEvent({
        status: 'failed',
        transferId: 't-event-2',
        reason: LOCAL,
      } as any);
      expect([...item.peerHashes]).toEqual([OTHER_PEER]);
      expect(item.attempts).toBe(2);
    });
  });
});
