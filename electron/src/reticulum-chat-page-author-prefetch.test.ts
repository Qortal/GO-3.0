import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as nodeCrypto from 'crypto';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildReticulumChatSignedFields,
  hashReticulumChatPayload,
  ReticulumChatManager,
  type ReticulumChatEvent,
  type ReticulumChatManagerOptions,
} from './reticulum-chat';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

// mobileProfile.prefetchPageAuthorMemberships (GO): the authors of an
// incoming page or batch are asked about together, before the import loop
// awaits them one event at a time, so the mobile host can send one Core
// request per group instead of one per author in a row.

const TEST_AUTHOR_STREAM_ID = 'f'.repeat(32);
const GROUP_ID = 59;
const NOW = 10_000_000;

const managers: ReticulumChatManager[] = [];
const tempPaths: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-author-prefetch-'));
  tempPaths.push(root);
  return path.join(root, 'reticulum-chat.db');
}

type Author = { address: string; publicKey: string; secretKey: Uint8Array };

function newAuthor(): Author {
  const kp = nacl.sign.keyPair();
  const publicKey = base58Encode(kp.publicKey);
  return {
    address: deriveAddressFromPublicKey(publicKey),
    publicKey,
    secretKey: kp.secretKey,
  };
}

let nextTimestamp = NOW - 1_000_000;

function signedEvent(
  author: Author,
  authorSeq: number,
  overrides: Partial<ReticulumChatEvent> = {}
): ReticulumChatEvent {
  const encryptedPayload = 'ciphertext';
  const event: ReticulumChatEvent = {
    eventId: `event-${Math.random().toString(16).slice(2)}`,
    groupId: GROUP_ID,
    channelId: 'general',
    authorAddress: author.address,
    authorPublicKey: author.publicKey,
    authorStreamId: TEST_AUTHOR_STREAM_ID,
    authorSeq,
    timestamp: (nextTimestamp += 10),
    eventType: 'message',
    encryptedPayload,
    payloadHash: hashReticulumChatPayload(encryptedPayload),
    mentionAddressHashes: [],
    signature: '',
    ...overrides,
  };
  const sig = nacl.sign.detached(
    new Uint8Array(
      canonicalizeForSigning(buildReticulumChatSignedFields(event))
    ),
    author.secretKey
  );
  event.signature = base58Encode(sig);
  return event;
}

/** 100 events from 30 authors: 10 authors with 4 events, 20 with 3. */
function pageFromThirtyAuthors(): {
  authors: Author[];
  events: ReticulumChatEvent[];
} {
  const authors = Array.from({ length: 30 }, () => newAuthor());
  const events: ReticulumChatEvent[] = [];
  authors.forEach((author, i) => {
    const count = i < 10 ? 4 : 3;
    for (let seq = 1; seq <= count; seq += 1) {
      events.push(signedEvent(author, seq));
    }
  });
  expect(events).toHaveLength(100);
  return { authors, events };
}

/**
 * The host's validator, held until release(): a call only counts as part of
 * one batch if it was made while the earlier ones were still unanswered.
 */
function heldValidator(answer: boolean | null = true) {
  const calls: string[] = [];
  const waiting: Array<() => void> = [];
  let open = false;
  return {
    calls,
    outstanding: () => waiting.length,
    release(): void {
      open = true;
      for (const resolve of waiting.splice(0)) resolve();
    },
    validateGroupMember: async (
      _groupId: number,
      address: string
    ): Promise<boolean | null> => {
      calls.push(address);
      if (!open) await new Promise<void>((resolve) => waiting.push(resolve));
      return answer;
    },
  };
}

function setup(options: Partial<ReticulumChatManagerOptions>) {
  const dbPath = tempDbPath();
  const manager = new ReticulumChatManager({
    dbPath,
    bridge: {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
      acceptReticulumChatResourceDetailed: async () => ({
        ok: true as const,
      }),
    } as any,
    now: () => NOW,
    ...options,
  });
  managers.push(manager);
  const m = manager as any;
  vi.spyOn(m, 'requestMetadataSnapshotFromPeer').mockImplementation(
    () => undefined
  );
  vi.spyOn(m, 'requestStateHeadsFromPeer').mockImplementation(() => undefined);
  vi.spyOn(m, 'requestLinkedHistoryPage').mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return { manager, m, dbPath };
}

let transferSeq = 0;

/** A received history page for GROUP_ID, tracked as our own request. */
function writePage(
  dbPath: string,
  m: any,
  events: unknown[],
  channelId = '*'
): { path: string; transferId: string } {
  const transferId = `t-prefetch-${(transferSeq += 1)}`;
  const page = {
    v: 1,
    g: GROUP_ID,
    c: channelId,
    d: 'before',
    more: false,
    wh: 'x',
    events,
  };
  const blob = JSON.stringify(page);
  const filePath = path.join(path.dirname(dbPath), `${transferId}.json`);
  fs.writeFileSync(filePath, blob, 'utf8');
  m.trackDirectHistoryPageRequest(`rk-${transferId}`, `sk-${transferId}`, {
    transferId,
    groupId: GROUP_ID,
    channelId,
    direction: 'before',
    pageHash: nodeCrypto
      .createHash('sha256')
      .update(blob, 'utf8')
      .digest('hex'),
    sizeBytes: Buffer.byteLength(blob, 'utf8'),
    eventCount: events.length,
    sourcePeerHash: 'peer-a',
    requestedAt: NOW,
  });
  return { path: filePath, transferId };
}

async function importPage(
  m: any,
  page: { path: string; transferId: string }
): Promise<void> {
  await m.importReceivedEventPageResource({
    status: 'received',
    path: page.path,
    transferId: page.transferId,
    peerPresenceHash: 'peer-a',
  });
}

/** Wait until the validator has `count` calls, then a little longer. */
async function settleCalls(
  validator: ReturnType<typeof heldValidator>,
  count: number
): Promise<void> {
  await vi.waitFor(() => expect(validator.calls.length).toBe(count), {
    timeout: 5_000,
    interval: 5,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
}

describe('page author membership prefetch', () => {
  it('asks about a 100-event page from 30 authors in one batch and never per event', async () => {
    const validator = heldValidator(true);
    const { m, dbPath } = setup({
      validateGroupMember: validator.validateGroupMember,
      mobileProfile: { prefetchPageAuthorMemberships: true },
    });
    m.setLocalGroupMemberships([GROUP_ID]);
    m.subscribeGroup(GROUP_ID);
    validator.calls.length = 0;
    const { authors, events } = pageFromThirtyAuthors();

    const done = importPage(m, writePage(dbPath, m, events));
    await settleCalls(validator, 30);
    // All 30 are out together: the host can send them as one request.
    expect(validator.outstanding()).toBe(30);
    expect(new Set(validator.calls)).toEqual(
      new Set(authors.map((author) => author.address))
    );
    validator.release();
    await done;

    // The loop read the cache: no later per-event validator call.
    expect(validator.calls).toHaveLength(30);
    expect(events.every((event) => m.db.hasEvent(event.eventId))).toBe(true);
    expect(m.getDeliveryCounters()).toMatchObject({
      membershipPrefetchPages: 1,
      membershipPrefetchAuthors: 30,
    });
  });

  it('asks a failing validator once per author, not once per event', async () => {
    const validator = heldValidator(null);
    const { m, dbPath } = setup({
      validateGroupMember: validator.validateGroupMember,
      mobileProfile: { prefetchPageAuthorMemberships: true },
    });
    m.setLocalGroupMemberships([GROUP_ID]);
    m.subscribeGroup(GROUP_ID);
    validator.calls.length = 0;
    const { events } = pageFromThirtyAuthors();
    vi.spyOn(m, 'scheduleEventPullQueue').mockImplementation(() => undefined);

    const done = importPage(m, writePage(dbPath, m, events));
    await settleCalls(validator, 30);
    expect(validator.outstanding()).toBe(30);
    validator.release();
    await done;

    // Unknown answers arm the retry window: the loop defers without asking.
    expect(validator.calls).toHaveLength(30);
    expect(events.some((event) => m.db.hasEvent(event.eventId))).toBe(false);
  });

  it('keeps the one-at-a-time loop with the option off', async () => {
    const validator = heldValidator(true);
    const { m, dbPath } = setup({
      validateGroupMember: validator.validateGroupMember,
    });
    m.setLocalGroupMemberships([GROUP_ID]);
    m.subscribeGroup(GROUP_ID);
    validator.calls.length = 0;
    const { events } = pageFromThirtyAuthors();

    const done = importPage(m, writePage(dbPath, m, events));
    await settleCalls(validator, 1);
    expect(validator.outstanding()).toBe(1);
    validator.release();
    await done;

    expect(validator.calls).toHaveLength(30);
    expect(events.every((event) => m.db.hasEvent(event.eventId))).toBe(true);
    expect(m.getDeliveryCounters().membershipPrefetchPages).toBeUndefined();
  });

  it('leaves out the local signer, known events, bad signatures and out-of-bounds events', async () => {
    const validator = heldValidator(true);
    const own = newAuthor();
    const { m, dbPath } = setup({
      validateGroupMember: validator.validateGroupMember,
      ownMembershipLocalFirst: true,
      mobileProfile: { prefetchPageAuthorMemberships: true },
    });
    m.setLocalGroupMemberships([
      { groupId: GROUP_ID, localAddress: own.address },
    ]);
    m.subscribeGroup(GROUP_ID);
    const member = newAuthor();
    const known = newAuthor();
    const forger = newAuthor();
    const elsewhere = newAuthor();
    const knownEvent = signedEvent(known, 1);
    expect(m.db.insertEvent(knownEvent, true)).toBe(true);
    const forged = signedEvent(forger, 1);
    forged.signature = signedEvent(forger, 2).signature;
    const page = writePage(
      dbPath,
      m,
      [
        signedEvent(own, 1),
        signedEvent(member, 1),
        knownEvent,
        forged,
        signedEvent(elsewhere, 1, { channelId: 'random' }),
        signedEvent(member, 2),
      ],
      'general'
    );
    validator.calls.length = 0;

    const done = importPage(m, page);
    await settleCalls(validator, 1);
    expect(validator.calls).toEqual([member.address]);
    validator.release();
    await done;

    expect(m.db.hasEvent(forged.eventId)).toBe(false);
    // Only the own address may be asked later: the background refresh that
    // ownMembershipLocalFirst fires when the pushed list answers for it.
    expect(
      validator.calls.filter((address) => address !== own.address)
    ).toEqual([member.address]);
  });

  it('asks about the authors of a wire event batch in one go', async () => {
    const validator = heldValidator(true);
    const { m } = setup({
      validateGroupMember: validator.validateGroupMember,
      mobileProfile: { prefetchPageAuthorMemberships: true },
    });
    m.setLocalGroupMemberships([GROUP_ID]);
    m.subscribeGroup(GROUP_ID);
    validator.calls.length = 0;
    const authors = Array.from({ length: 5 }, () => newAuthor());
    const events = authors.flatMap((author) => [
      signedEvent(author, 1),
      signedEvent(author, 2),
    ]);
    const wire = { c: '*', batch: { dir: 'after', more: false, events } };

    const done = m.handleEventBatch(GROUP_ID, wire, 'peer-b');
    await settleCalls(validator, 5);
    expect(validator.outstanding()).toBe(5);
    validator.release();
    await done;

    expect(validator.calls).toHaveLength(5);
    expect(events.every((event) => m.db.hasEvent(event.eventId))).toBe(true);
  });
});
