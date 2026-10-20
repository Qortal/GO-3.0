import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as nodeCrypto from 'crypto';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

// mobileProfile.localNotifyInMemory (GO): wake-up notes for stored events
// stay in memory instead of one file each in reticulum-chat-notify, and a note
// for an event an import path already emitted skips the second 'event' and
// 'summaryChanged'. Runs the real ReticulumChatDatabase SQL against Node's
// built-in SQLite through a minimal better-sqlite3 adapter, as the other
// engine delivery tests do.
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
  buildReticulumChatSignedFields,
  hashReticulumChatPayload,
  ReticulumChatManager,
  type ReticulumChatEvent,
} from './reticulum-chat';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

type Identity = { address: string; publicKey: string; secretKey: Uint8Array };

const GROUP_ID = 61;
const OTHER_GROUP_ID = 62;
const STREAM_ID = 'e'.repeat(32);
const NOTE_WAIT_MS = 80;

const managers: ReticulumChatManager[] = [];
const tempRoots: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-notify-mem-'));
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

let idCounter = 0;
function signedEvent(
  author: Identity,
  seq: number,
  groupId = GROUP_ID
): ReticulumChatEvent {
  idCounter += 1;
  const eventId = `note-${idCounter.toString(16).padStart(10, '0')}`;
  const encryptedPayload = `ciphertext-${eventId}`;
  const event: ReticulumChatEvent = {
    eventId,
    groupId,
    channelId: 'general',
    authorAddress: author.address,
    authorPublicKey: author.publicKey,
    authorStreamId: STREAM_ID,
    authorSeq: seq,
    timestamp: Date.now() - 120_000 + seq,
    eventType: 'message',
    encryptedPayload,
    payloadHash: hashReticulumChatPayload(encryptedPayload),
    mentionAddressHashes: [],
    signature: '',
  };
  event.signature = base58Encode(
    nacl.sign.detached(
      new Uint8Array(
        canonicalizeForSigning(buildReticulumChatSignedFields(event))
      ),
      author.secretKey
    )
  );
  return event;
}

const me = identity();

function makeManager(
  options: {
    inMemory: boolean;
    dbPath?: string;
    groups?: number[];
    subscribe?: number[];
  } = { inMemory: true }
) {
  const dbPath = options.dbPath ?? tempDbPath();
  const bridge = Object.assign(new EventEmitter(), {
    getLocalDestinationHash: () => 'a1'.repeat(16),
    sendReticulumChatDetailed: async () => ({ ok: true as const }),
    fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
    acceptReticulumChatResourceDetailed: async () => ({ ok: true as const }),
  });
  const manager = new ReticulumChatManager({
    dbPath,
    bridge: bridge as any,
    validateGroupMember: async () => true,
    localNotifyDebounceMs: 10,
    localNotifyScanIntervalMs: 1_000,
    trackOwnPostDelivery: true,
    ...(options.inMemory
      ? { mobileProfile: { localNotifyInMemory: true } }
      : {}),
  });
  managers.push(manager);
  const groups = options.groups ?? [GROUP_ID];
  manager.setLocalGroupMemberships(
    groups.map((groupId) => ({ groupId, localAddress: me.address }))
  );
  const m = manager as any;
  vi.spyOn(m, 'requestMetadataSnapshotFromPeer').mockImplementation(
    () => undefined
  );
  vi.spyOn(m, 'requestStateHeadsFromPeer').mockImplementation(() => undefined);
  for (const groupId of options.subscribe ?? [GROUP_ID]) {
    manager.subscribeGroup(groupId);
  }
  const emitted: Array<ReticulumChatEvent & Record<string, unknown>> = [];
  const summaries: Array<{ groupId: number; eventId?: string }> = [];
  manager.on('event', (payload) => emitted.push(payload.event));
  manager.on('summaryChanged', (payload) => summaries.push(payload));
  const notifyDir = path.join(path.dirname(dbPath), 'reticulum-chat-notify');
  const notifyFiles = () =>
    fs.existsSync(notifyDir) ? fs.readdirSync(notifyDir).length : 0;
  const emitsOf = (eventId: string) =>
    emitted.filter((event) => event.eventId === eventId);
  return {
    manager,
    m,
    dbPath,
    notifyDir,
    notifyFiles,
    emitted,
    summaries,
    emitsOf,
  };
}

/** One history page as a peer serves it, imported through the real path. */
async function importPage(
  env: ReturnType<typeof makeManager>,
  author: Identity,
  firstSeq: number,
  count = 100
): Promise<ReticulumChatEvent[]> {
  const events = Array.from({ length: count }, (_, index) =>
    signedEvent(author, firstSeq + index)
  );
  idCounter += 1;
  const transferId = idCounter.toString(16).padStart(16, '0');
  const page = {
    v: 1,
    g: GROUP_ID,
    c: '*',
    d: 'before',
    more: false,
    start: { id: events[0].eventId, ts: events[0].timestamp },
    end: {
      id: events[events.length - 1].eventId,
      ts: events[events.length - 1].timestamp,
    },
    wh: env.m.db.computeWindowHash(events),
    events,
  };
  const blob = JSON.stringify(page);
  const filePath = path.join(path.dirname(env.dbPath), `${transferId}.json`);
  fs.writeFileSync(filePath, blob, 'utf8');
  env.m.trackDirectHistoryPageRequest(
    `rk-${transferId}`,
    `notify-test|${GROUP_ID}|${transferId}`,
    {
      transferId,
      groupId: GROUP_ID,
      channelId: '*',
      direction: 'before',
      pageHash: nodeCrypto
        .createHash('sha256')
        .update(blob, 'utf8')
        .digest('hex'),
      sizeBytes: Buffer.byteLength(blob, 'utf8'),
      eventCount: count,
      start: { eventId: 'x', feedTimestamp: Date.now() },
      sourcePeerHash: 'b2'.repeat(16),
      requestedAt: Date.now(),
    }
  );
  await env.m.importReceivedEventPageResource({
    status: 'received',
    path: filePath,
    transferId,
    peerPresenceHash: 'b2'.repeat(16),
  });
  for (const event of events) {
    expect(env.m.db.hasEvent(event.eventId)).toBe(true);
  }
  return events;
}

async function waitFor(check: () => boolean, timeoutMs = 4_000) {
  const started = Date.now();
  while (!check() && Date.now() - started < timeoutMs) await sleep(20);
}

describe('local notify notes in memory (mobileProfile.localNotifyInMemory)', () => {
  it('stores 300 paged events with no notify file and emits each one once', async () => {
    const dbPath = tempDbPath();
    // Files an older build left behind are removed once.
    const legacyDir = path.join(path.dirname(dbPath), 'reticulum-chat-notify');
    fs.mkdirSync(legacyDir, { recursive: true });
    for (let i = 0; i < 3; i += 1) {
      fs.writeFileSync(path.join(legacyDir, `61-${i}-legacy.json`), '{}');
    }
    const env = makeManager({ inMemory: true, dbPath });
    expect(fs.existsSync(env.notifyDir)).toBe(false);
    const cancel = vi.spyOn(env.m, 'cancelLinkedEventPull');
    const author = identity();

    const stored: ReticulumChatEvent[] = [];
    for (let page = 0; page < 3; page += 1) {
      stored.push(...(await importPage(env, author, 1 + page * 100)));
    }
    await sleep(NOTE_WAIT_MS);

    expect(stored).toHaveLength(300);
    expect(env.notifyFiles()).toBe(0);
    expect(fs.existsSync(env.notifyDir)).toBe(false);
    expect(env.m.localNotifyNotes).toHaveLength(0);
    for (const event of stored) {
      expect(env.emitsOf(event.eventId)).toHaveLength(1);
      // The note's bookkeeping still ran after the import path's own call.
      expect(
        cancel.mock.calls.filter((call) => call[1] === event.eventId).length
      ).toBeGreaterThanOrEqual(2);
    }
    expect(env.emitted).toHaveLength(300);
  });

  it('a 100-event page emits 100 events and one summaryChanged', async () => {
    const env = makeManager({ inMemory: true });
    await sleep(NOTE_WAIT_MS);
    env.emitted.length = 0;
    env.summaries.length = 0;

    const events = await importPage(env, identity(), 1);
    await sleep(NOTE_WAIT_MS);

    expect(env.emitted).toHaveLength(100);
    expect(new Set(env.emitted.map((event) => event.eventId)).size).toBe(100);
    expect(
      env.summaries.filter((summary) => summary.groupId === GROUP_ID)
    ).toHaveLength(1);
    expect(env.m.localNotifyEmittedEventIds.has(events[99].eventId)).toBe(true);
  });

  it('an own publish reaches the renderer exactly once, with its delivery fields', async () => {
    const env = makeManager({ inMemory: true });
    const cancel = vi.spyOn(env.m, 'cancelLinkedEventPull');
    const invalidate = vi.spyOn(env.m, 'invalidateGroupDigestSnapshot');
    const own = signedEvent(me, 1);

    expect(await env.manager.publishEvent(own)).toEqual({ ok: true });
    await sleep(NOTE_WAIT_MS);

    const emits = env.emitsOf(own.eventId);
    expect(emits).toHaveLength(1);
    expect(typeof emits[0].localPostDeliverySince).toBe('number');
    expect(env.notifyFiles()).toBe(0);
    // The note path's bookkeeping ran for the own post too.
    expect(cancel).toHaveBeenCalledWith(GROUP_ID, own.eventId);
    expect(invalidate.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps a note for an unsubscribed group until it is subscribed, then emits it once', async () => {
    const env = makeManager({
      inMemory: true,
      groups: [GROUP_ID, OTHER_GROUP_ID],
      subscribe: [GROUP_ID],
    });
    const own = signedEvent(me, 1, OTHER_GROUP_ID);
    expect(await env.manager.publishEvent(own)).toEqual({ ok: true });
    await sleep(NOTE_WAIT_MS);
    expect(env.emitsOf(own.eventId)).toHaveLength(0);
    expect(env.m.localNotifyNotes).toHaveLength(1);

    env.manager.subscribeGroup(OTHER_GROUP_ID);
    // The next scan (interval, or the next stored event) hands it over.
    await waitFor(() => env.emitsOf(own.eventId).length > 0, 3_000);
    expect(env.emitsOf(own.eventId)).toHaveLength(1);
    expect(env.m.localNotifyNotes).toHaveLength(0);
  });

  it('drops notes after 10 minutes and holds at most 5,000', () => {
    const env = makeManager({
      inMemory: true,
      groups: [GROUP_ID, OTHER_GROUP_ID],
      subscribe: [GROUP_ID],
    });
    // Only the note matters here, so the events need no signature.
    const template = signedEvent(identity(), 1, OTHER_GROUP_ID);
    for (let i = 0; i < 5_005; i += 1) {
      env.m.writeLocalEventNotification({
        ...template,
        eventId: `cap-${i}`,
        timestamp: template.timestamp + i,
      });
    }
    expect(env.m.localNotifyNotes).toHaveLength(5_000);
    // The oldest five went.
    expect(env.m.localNotifyNotes[0].eventId).toBe('cap-5');
    expect(env.m.localNotifyNotes[4_999].eventId).toBe('cap-5004');

    for (const note of env.m.localNotifyNotes.slice(0, 4_000)) {
      note.queuedAt -= 11 * 60_000;
    }
    env.m.scanLocalNotifications();
    expect(env.m.localNotifyNotes).toHaveLength(1_000);
  });

  it('writes no calendar file and forgets notes from before a watcher restart', () => {
    const env = makeManager({ inMemory: true });
    env.m.writeLocalCalendarNotification(GROUP_ID);
    expect(fs.existsSync(env.notifyDir)).toBe(false);

    env.manager.unsubscribeGroup(GROUP_ID);
    env.m.writeLocalEventNotification(signedEvent(identity(), 1));
    expect(env.m.localNotifyNotes).toHaveLength(1);
    env.manager.subscribeGroup(GROUP_ID);
    // As with files older than a restarted watcher: history, not alerts.
    expect(env.m.localNotifyNotes).toHaveLength(0);
    expect(fs.existsSync(env.notifyDir)).toBe(false);
  });
});

describe('local notify files (option off: desktop, unchanged)', () => {
  it('writes one file per stored event and emits each event twice', async () => {
    const env = makeManager({ inMemory: false });
    await sleep(NOTE_WAIT_MS);
    env.emitted.length = 0;
    env.summaries.length = 0;
    const author = identity();
    const stored: ReticulumChatEvent[] = [];
    for (let page = 0; page < 3; page += 1) {
      stored.push(...(await importPage(env, author, 1 + page * 100)));
    }
    await waitFor(() => env.emitted.length >= 600);

    expect(env.notifyFiles()).toBe(300);
    expect(env.emitted).toHaveLength(600);
    for (const event of stored) {
      expect(env.emitsOf(event.eventId)).toHaveLength(2);
    }
    // One summary per page plus one per note.
    expect(
      env.summaries.filter((summary) => summary.groupId === GROUP_ID)
    ).toHaveLength(303);
  });

  it('an own publish still reaches the renderer once through its file', async () => {
    const env = makeManager({ inMemory: false });
    const own = signedEvent(me, 1);
    expect(await env.manager.publishEvent(own)).toEqual({ ok: true });
    await waitFor(() => env.emitsOf(own.eventId).length > 0);

    expect(env.emitsOf(own.eventId)).toHaveLength(1);
    expect(typeof env.emitsOf(own.eventId)[0].localPostDeliverySince).toBe(
      'number'
    );
    expect(env.notifyFiles()).toBe(1);
  });
});
