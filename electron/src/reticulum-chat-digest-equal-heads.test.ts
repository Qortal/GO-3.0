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

// Report item 1.3: page repairs at equal heads (gate A), the per-group
// page-repair budget, the open-chat attempt and the digest queue diagnostics.

const TEST_AUTHOR_STREAM_ID = 'f'.repeat(32);
const GROUP_ID = 59;
const MIN = 60_000;

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-digest-heads-'));
  tempPaths.push(root);
  return path.join(root, 'reticulum-chat.db');
}

function signedEvent(
  overrides: Partial<ReticulumChatEvent> = {}
): ReticulumChatEvent {
  const kp = nacl.sign.keyPair();
  const publicKey = base58Encode(kp.publicKey);
  const encryptedPayload = overrides.encryptedPayload ?? 'ciphertext';
  const event: ReticulumChatEvent = {
    eventId:
      overrides.eventId ?? `event-${Math.random().toString(16).slice(2)}`,
    groupId: overrides.groupId ?? 7,
    channelId: overrides.channelId ?? 'general',
    authorAddress:
      overrides.authorAddress ?? deriveAddressFromPublicKey(publicKey),
    authorPublicKey: overrides.authorPublicKey ?? publicKey,
    authorStreamId: overrides.authorStreamId ?? TEST_AUTHOR_STREAM_ID,
    authorSeq: overrides.authorSeq ?? 1,
    timestamp: overrides.timestamp ?? Date.now(),
    eventType: overrides.eventType ?? 'message',
    encryptedPayload,
    payloadHash:
      overrides.payloadHash ?? hashReticulumChatPayload(encryptedPayload),
    mentionAddressHashes: overrides.mentionAddressHashes ?? [],
    signature: '',
  };
  const sig = nacl.sign.detached(
    new Uint8Array(
      canonicalizeForSigning(buildReticulumChatSignedFields(event))
    ),
    kp.secretKey
  );
  event.signature = overrides.signature ?? base58Encode(sig);
  return event;
}

function signedAuthorEvents(
  events: Array<Partial<ReticulumChatEvent>>
): ReticulumChatEvent[] {
  const kp = nacl.sign.keyPair();
  const publicKey = base58Encode(kp.publicKey);
  const authorAddress = deriveAddressFromPublicKey(publicKey);
  return events.map((overrides) => {
    const encryptedPayload = overrides.encryptedPayload ?? 'ciphertext';
    const event: ReticulumChatEvent = {
      eventId:
        overrides.eventId ?? `event-${Math.random().toString(16).slice(2)}`,
      groupId: overrides.groupId ?? 7,
      channelId: overrides.channelId ?? 'general',
      authorAddress,
      authorPublicKey: publicKey,
      authorStreamId: overrides.authorStreamId ?? TEST_AUTHOR_STREAM_ID,
      authorSeq: overrides.authorSeq ?? 1,
      timestamp: overrides.timestamp ?? Date.now(),
      eventType: overrides.eventType ?? 'message',
      encryptedPayload,
      payloadHash:
        overrides.payloadHash ?? hashReticulumChatPayload(encryptedPayload),
      mentionAddressHashes: overrides.mentionAddressHashes ?? [],
      signature: '',
    };
    const sig = nacl.sign.detached(
      new Uint8Array(
        canonicalizeForSigning(buildReticulumChatSignedFields(event))
      ),
      kp.secretKey
    );
    event.signature = overrides.signature ?? base58Encode(sig);
    return event;
  });
}

async function flushQueuedWork(ticks = 8): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

type Cursor = { eventId: string; feedTimestamp: number };

const wireCursor = (cursor: Cursor) => ({
  id: cursor.eventId,
  ts: cursor.feedTimestamp,
});

function digestItem(
  groupId: number,
  peer: string,
  remoteLatest: Cursor | null,
  remoteHash: string,
  d?: Record<string, unknown>
) {
  return {
    key: `${peer}:${groupId}`,
    peerHash: peer,
    providerPeerHash: peer,
    candidatePeerHashes: [peer],
    groupId,
    wire: d
      ? { t: 'RCHAT', v: 3, k: 'group_state_digest_v3', g: groupId, d }
      : { channels: [] },
    remoteGroupLatest: remoteLatest,
    remoteDigestHash: remoteHash,
    enqueuedAt: 0,
    coalescedCount: 0,
    localRevision: 0,
  };
}

function setup(
  clock: { now: number },
  options: Partial<ReticulumChatManagerOptions> = {}
) {
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
    now: () => clock.now,
    ...options,
  });
  managers.push(manager);
  manager.setLocalGroupMemberships([GROUP_ID]);
  manager.subscribeGroup(GROUP_ID);
  const m = manager as any;
  vi.spyOn(m, 'requestMetadataSnapshotFromPeer').mockImplementation(
    () => undefined
  );
  const stateHeads = vi
    .spyOn(m, 'requestStateHeadsFromPeer')
    .mockImplementation(() => undefined);
  const request = vi
    .spyOn(m, 'requestLinkedHistoryPage')
    .mockResolvedValue(undefined);
  const calls = (reason: string): number =>
    request.mock.calls.filter((call) => call[6] === reason).length;
  return { manager, m, dbPath, request, stateHeads, calls };
}

function captureLogs(): string[] {
  const logs: string[] = [];
  const push = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
  vi.spyOn(console, 'log').mockImplementation(push);
  vi.spyOn(console, 'warn').mockImplementation(push);
  return logs;
}

/** One head event at ts 900_000 and the local digest state for it. */
function seedHead(m: any) {
  const head = signedEvent({
    eventId: 'event-local-head',
    groupId: GROUP_ID,
    timestamp: 900_000,
  });
  expect(m.db.insertEvent(head, true)).toBe(true);
  const local = m.buildGroupDigestSnapshot(GROUP_ID) as {
    latest: Cursor;
    digestHash: string;
  };
  const heads = m.getStateHeadsCache(GROUP_ID).channelHash as string;
  return { head, local, heads };
}

function writePage(
  dbPath: string,
  m: any,
  transferId: string,
  event: ReticulumChatEvent,
  sourcePeerHash: string,
  requestedAt: number
) {
  const page = {
    v: 1,
    g: GROUP_ID,
    c: '*',
    d: 'before',
    more: false,
    start: { id: event.eventId, ts: event.timestamp },
    end: { id: event.eventId, ts: event.timestamp },
    wh: m.db.computeWindowHash([event]),
    events: [event],
  };
  const blob = JSON.stringify(page);
  const filePath = path.join(path.dirname(dbPath), `${transferId}.json`);
  fs.writeFileSync(filePath, blob, 'utf8');
  m.trackDirectHistoryPageRequest(
    `rk-${transferId}`,
    `digest-repair|${GROUP_ID}`,
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
      eventCount: 1,
      start: { eventId: 'x', feedTimestamp: 900_000 },
      sourcePeerHash,
      requestedAt,
      digestRepairFingerprint: 'fp',
      digestRepairPageCount: 1,
    }
  );
  return filePath;
}

describe('digest repair at equal heads (gate A)', () => {
  it('skips every page repair at equal heads when channel heads match', () => {
    const clock = { now: 1_000_000 };
    const { m, request } = setup(clock);
    const logs = captureLogs();
    const { local, heads } = seedHead(m);
    const hints = vi.spyOn(m, 'processGroupDigestStateHints');
    const d = {
      latest: wireCursor(local.latest),
      eventHash: 'f'.repeat(64),
      // Upper case checks the normalisation of the remote value.
      channelHeadsHash: heads.toUpperCase(),
    };

    const stats = m.processGroupDigestRepair(
      digestItem(GROUP_ID, 'peer-a', local.latest, 'f'.repeat(64), d)
    );

    expect(request).not.toHaveBeenCalled();
    expect(stats.equalHeadsSkipped).toBe(true);
    expect(stats.headRelation).toBe('equal');
    expect(stats.pageRepairBudget).toBeUndefined();
    expect(hints).toHaveBeenCalledTimes(1);
    expect(m.getDigestQueueDiagnostics().repair.equalHeadSkips).toBe(1);
    expect(m.getDigestQueueDiagnostics().repair.byRelation.equal).toBe(1);
    expect(m.digestPageRepairBudgets.has(GROUP_ID)).toBe(false);

    clock.now += 6_000;
    const again = m.processGroupDigestRepair(
      digestItem(GROUP_ID, 'peer-b', local.latest, 'f'.repeat(64), d)
    );
    expect(again.equalHeadsSkipped).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(
      logs.filter((line) => line.includes('digest_repair_equal_heads_skipped'))
    ).toHaveLength(1);
    expect(m.digestEqualHeadSkipLog.get(GROUP_ID).skipped).toBe(1);
    expect(m.getDigestQueueDiagnostics().repair.equalHeadSkips).toBe(2);
    expect(m.getDigestQueueDiagnostics().recent.equalHeadSkips).toBe(2);
  });

  it('still finds a real gap at equal heads through author gaps and the author manifest', async () => {
    const clock = { now: 1_000_000 };
    const { m, request } = setup(clock);
    const [a1, a3] = signedAuthorEvents([
      { eventId: 'gap-a1', groupId: GROUP_ID, authorSeq: 1, timestamp: 10_001 },
      { eventId: 'gap-a3', groupId: GROUP_ID, authorSeq: 3, timestamp: 10_003 },
    ]);
    expect(m.db.insertEvent(a1, true)).toBe(true);
    expect(m.db.insertEvent(a3, true)).toBe(true);
    // 26 newer events in the same channel push the gap out of its newest 25.
    const others = signedAuthorEvents(
      Array.from({ length: 26 }, (_, i) => ({
        eventId: `other-${i}`,
        groupId: GROUP_ID,
        authorSeq: i + 1,
        timestamp: 20_000 + i,
      }))
    );
    for (const event of others)
      expect(m.db.insertEvent(event, true)).toBe(true);
    const local = m.buildGroupDigestSnapshot(GROUP_ID);
    const heads = m.getStateHeadsCache(GROUP_ID).channelHash;
    const manifest = vi
      .spyOn(m, 'enqueueAuthorManifestSync')
      .mockImplementation(() => undefined);

    const stats = m.processGroupDigestRepair(
      digestItem(GROUP_ID, 'peer-gap', local.latest, 'f'.repeat(64), {
        latest: wireCursor(local.latest),
        eventHash: 'f'.repeat(64),
        channelHeadsHash: heads,
        authorTreeRoot: 'a'.repeat(64),
        authorTreeCount: 2,
      })
    );
    await flushQueuedWork();

    expect(stats.equalHeadsSkipped).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(stats.authorGapRequested).toBe(true);
    expect(
      m.db.getMissingRange(
        GROUP_ID,
        a1.authorAddress,
        TEST_AUTHOR_STREAM_ID,
        2,
        2
      )
    ).not.toBeNull();
    expect(manifest).toHaveBeenCalledWith(
      'peer-gap',
      GROUP_ID,
      'a'.repeat(64),
      expect.anything()
    );
  });

  it('falls back to the budget when the remote omits channelHeadsHash', () => {
    const clock = { now: 1_000_000 };
    const { m, calls } = setup(clock);
    const { local } = seedHead(m);

    const stats = m.processGroupDigestRepair(
      digestItem(GROUP_ID, 'peer-a', local.latest, 'f'.repeat(64), {
        latest: wireCursor(local.latest),
        eventHash: 'f'.repeat(64),
      })
    );

    expect(stats.equalHeadsSkipped).toBeUndefined();
    expect(calls('newest-group-repair')).toBe(1);
    expect(stats.pageRepairBudget).toBe('spent');
    expect(stats.newestRepairRequested).toBe(true);
  });

  it('still repairs when the channel heads differ', () => {
    const clock = { now: 1_000_000 };
    const { m, calls } = setup(clock);
    const { local } = seedHead(m);

    const stats = m.processGroupDigestRepair(
      digestItem(GROUP_ID, 'peer-a', local.latest, 'f'.repeat(64), {
        latest: wireCursor(local.latest),
        eventHash: 'f'.repeat(64),
        channelHeadsHash: 'e'.repeat(64),
      })
    );

    expect(stats.equalHeadsSkipped).toBeUndefined();
    expect(calls('newest-group-repair')).toBe(1);
    expect(stats.pageRepairBudget).toBe('spent');
  });
});

describe('per-group page-repair budget', () => {
  it('rations equal-head page repairs per group: 10, 30, then 120 min', () => {
    const start = 1_000_000;
    const clock = { now: start };
    const { m, calls, stateHeads } = setup(clock);
    const logs = captureLogs();
    const { local } = seedHead(m);
    const run = (peer: string) =>
      m.processGroupDigestRepair(
        digestItem(GROUP_ID, peer, local.latest, 'f'.repeat(64), {
          latest: wireCursor(local.latest),
          eventHash: 'f'.repeat(64),
          channelHeadsHash: 'e'.repeat(64),
        })
      );
    const n = () => calls('newest-group-repair');

    expect(run('peer-a').pageRepairBudget).toBe('spent');
    expect(n()).toBe(1);
    clock.now += 6_000;
    expect(run('peer-b').pageRepairBudget).toBe('held');
    expect(n()).toBe(1);
    clock.now = start + 10 * MIN;
    run('peer-a');
    expect(n()).toBe(2);
    clock.now += 29 * MIN;
    expect(run('peer-a').pageRepairBudget).toBe('held');
    expect(n()).toBe(2);
    clock.now += MIN;
    run('peer-a');
    expect(n()).toBe(3);
    clock.now += 119 * MIN;
    run('peer-a');
    expect(n()).toBe(3);
    clock.now += MIN;
    run('peer-a');
    expect(n()).toBe(4);
    clock.now += 120 * MIN;
    run('peer-a');
    expect(n()).toBe(5);

    // The state-heads path is not rationed: asked on every one of the 8 runs.
    expect(stateHeads).toHaveBeenCalledTimes(8);
    const diagnostics = m.getDigestQueueDiagnostics();
    expect(diagnostics.repair.budgetSpent).toBe(5);
    expect(diagnostics.repair.budgetHeld).toBe(3);
    expect(diagnostics.repair.maxStreak).toBe(5);
    expect(diagnostics.repair.groupsWaiting).toBe(1);
    const spentLines = logs.filter((line) =>
      line.includes('digest_page_repair_budget_spent')
    );
    expect(spentLines).toHaveLength(5);
    expect(spentLines[0]).toContain(
      `group=${GROUP_ID} relation=equal via=time reason=newest-group-repair streak=1 next_in_ms=600000`
    );
    expect(spentLines[1]).toContain('streak=2 next_in_ms=1800000');
    expect(spentLines[4]).toContain('streak=5 next_in_ms=7200000');
  });

  it('one budget for a remote-behind peer: metadata-first plus group-window together, peer-behind digest always', () => {
    const clock = { now: 1_000_000 };
    const { m, request, calls } = setup(clock);
    seedHead(m);
    const remote = { eventId: 'remote-old', feedTimestamp: 800_000 };
    const run = (peer: string) =>
      m.processGroupDigestRepair(
        digestItem(GROUP_ID, peer, remote, 'e'.repeat(64), {
          latest: wireCursor(remote),
          eventHash: 'e'.repeat(64),
        })
      );

    const first = run('peer-a');
    expect(first.headRelation).toBe('behind');
    expect(calls('metadata-first-digest-repair')).toBe(1);
    expect(calls('group-window-mismatch')).toBe(1);
    expect(first.peerBehindDigestQueued).toBe(true);
    expect(first.pageRepairBudget).toBe('spent');
    expect(m.getDigestQueueDiagnostics().repair.budgetSpent).toBe(1);

    const before = request.mock.calls.length;
    clock.now += 6_000;
    const second = run('peer-b');
    expect(request.mock.calls.length).toBe(before);
    expect(second.peerBehindDigestQueued).toBe(true);
    expect(second.pageRepairBudget).toBe('held');
    expect(m.getDigestQueueDiagnostics().repair.byRelation.behind).toBe(2);
  });

  it('never rations remote-ahead repairs', () => {
    const clock = { now: 1_000_000 };
    const { m, calls } = setup(clock);
    const { local } = seedHead(m);
    m.processGroupDigestRepair(
      digestItem(GROUP_ID, 'peer-a', local.latest, 'f'.repeat(64), {
        latest: wireCursor(local.latest),
        eventHash: 'f'.repeat(64),
      })
    );
    expect(m.getDigestQueueDiagnostics().repair.budgetSpent).toBe(1);
    const gate = vi.spyOn(m, 'checkDigestPageRepairGate');
    const remote = { eventId: 'remote-new', feedTimestamp: 950_000 };

    clock.now += 6_000;
    const stats = m.processGroupDigestRepair(
      digestItem(GROUP_ID, 'peer-c', remote, 'd'.repeat(64), {
        latest: wireCursor(remote),
        eventHash: 'd'.repeat(64),
      })
    );

    expect(stats.headRelation).toBe('ahead');
    expect(stats.newestRepairRequested).toBe(true);
    expect(calls('newest-group-repair')).toBe(2);
    expect(stats.pageRepairBudget).toBeUndefined();
    expect(gate).not.toHaveBeenCalled();
    expect(m.getDigestQueueDiagnostics().repair.budgetSpent).toBe(1);
    expect(m.getDigestQueueDiagnostics().repair.byRelation.ahead).toBe(1);
  });

  it('keeps the remote-ahead latest-event pull early return untouched', () => {
    const clock = { now: 1_000_000 };
    const { m, request } = setup(clock);
    const { local } = seedHead(m);
    m.processGroupDigestRepair(
      digestItem(GROUP_ID, 'peer-a', local.latest, 'f'.repeat(64))
    );
    const spentBefore = m.getDigestQueueDiagnostics().repair.budgetSpent;
    const budgetBefore = { ...m.digestPageRepairBudgets.get(GROUP_ID) };
    const pull = vi
      .spyOn(m, 'enqueueDigestLatestEventPull')
      .mockReturnValue(true);
    const fallback = vi
      .spyOn(m, 'scheduleLatestEventPullFallback')
      .mockImplementation(() => undefined);
    const callsBefore = request.mock.calls.length;
    const remote = { eventId: 'remote-new', feedTimestamp: 950_000 };

    clock.now += 6_000;
    const stats = m.processGroupDigestRepair(
      digestItem(GROUP_ID, 'peer-c', remote, 'd'.repeat(64))
    );

    expect(pull).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.length).toBe(callsBefore);
    expect(stats.headRelation).toBe('ahead');
    expect(stats.pageRepairBudget).toBeUndefined();
    expect(m.getDigestQueueDiagnostics().repair.budgetSpent).toBe(spentBefore);
    expect(m.digestPageRepairBudgets.get(GROUP_ID)).toEqual(budgetBefore);
  });

  it('a digest page that inserts an event resets the budget', async () => {
    const clock = { now: 1_000_000 };
    const { m, dbPath, calls } = setup(clock, {
      validateGroupMember: async () => true,
    });
    const logs = captureLogs();
    const { local } = seedHead(m);
    const run = (peer: string) =>
      m.processGroupDigestRepair(
        digestItem(GROUP_ID, peer, local.latest, 'f'.repeat(64), {
          latest: wireCursor(local.latest),
          eventHash: 'f'.repeat(64),
        })
      );
    run('peer-a');
    expect(calls('newest-group-repair')).toBe(1);
    // An older event keeps the head equal.
    const event = signedEvent({ groupId: GROUP_ID, timestamp: 500_000 });
    const filePath = writePage(dbPath, m, 't1', event, 'peer-a', clock.now);

    await m.importReceivedEventPageResource({
      status: 'received',
      path: filePath,
      transferId: 't1',
      peerPresenceHash: 'peer-a',
    });

    expect(m.db.hasEvent(event.eventId)).toBe(true);
    expect(m.getDigestQueueDiagnostics().repair.budgetResets).toBe(1);
    expect(
      logs.some((line) =>
        line.includes(
          `digest_page_repair_budget_reset group=${GROUP_ID} inserted=1 streak_was=1`
        )
      )
    ).toBe(true);
    const stats = run('peer-b');
    expect(stats.pageRepairBudget).toBe('spent');
    expect(calls('newest-group-repair')).toBe(2);
  });

  it('a membership-deferred page counts as no progress', async () => {
    const clock = { now: 1_000_000 };
    const { m, dbPath, calls } = setup(clock, {
      validateGroupMember: async () => null,
    });
    const logs = captureLogs();
    const { local } = seedHead(m);
    const run = (peer: string) =>
      m.processGroupDigestRepair(
        digestItem(GROUP_ID, peer, local.latest, 'f'.repeat(64), {
          latest: wireCursor(local.latest),
          eventHash: 'f'.repeat(64),
        })
      );
    run('peer-a');
    const event = signedEvent({ groupId: GROUP_ID, timestamp: 500_000 });
    const filePath = writePage(dbPath, m, 't2', event, 'peer-a', clock.now);

    await m.importReceivedEventPageResource({
      status: 'received',
      path: filePath,
      transferId: 't2',
      peerPresenceHash: 'peer-a',
    });

    expect(
      logs.some(
        (line) =>
          line.includes('event_page_imported') &&
          line.includes('inserted=0') &&
          line.includes('membership_deferred=1')
      )
    ).toBe(true);
    expect(m.getDigestQueueDiagnostics().repair.budgetResets).toBe(0);
    expect(run('peer-b').pageRepairBudget).toBe('held');
    expect(calls('newest-group-repair')).toBe(1);
  });

  it('does not spend while the group digest slot is busy', () => {
    const clock = { now: 1_000_000 };
    const { m, calls } = setup(clock);
    const { local } = seedHead(m);
    m.trackDirectHistoryPageRequest('rk', `digest-repair|${GROUP_ID}`, {
      transferId: 'busy',
      groupId: GROUP_ID,
      channelId: '*',
      direction: 'before',
      pageHash: '',
      sizeBytes: 1,
      eventCount: 1,
      sourcePeerHash: 'peer-x',
      requestedAt: clock.now,
      digestRepairFingerprint: 'fp',
    });
    const run = () =>
      m.processGroupDigestRepair(
        digestItem(GROUP_ID, 'peer-a', local.latest, 'f'.repeat(64), {
          latest: wireCursor(local.latest),
          eventHash: 'f'.repeat(64),
        })
      );

    const busy = run();
    expect(busy.pageRepairBudget).toBe('slot-busy');
    expect(calls('newest-group-repair')).toBe(0);
    expect(m.digestPageRepairBudgets.has(GROUP_ID)).toBe(false);
    expect(m.getDigestQueueDiagnostics().repair.budgetSlotBusy).toBe(1);
    expect(m.getDigestQueueDiagnostics().repair.budgetHeld).toBe(0);

    m.directHistoryPageRequests.get('busy').requestedAt = clock.now - 121_000;
    expect(run().pageRepairBudget).toBe('spent');
    expect(calls('newest-group-repair')).toBe(1);
  });

  it('unsubscribing the group clears its budget', () => {
    const clock = { now: 1_000_000 };
    const { manager, m } = setup(clock);
    const { local } = seedHead(m);
    m.processGroupDigestRepair(
      digestItem(GROUP_ID, 'peer-a', local.latest, 'f'.repeat(64))
    );
    expect(m.digestPageRepairBudgets.has(GROUP_ID)).toBe(true);

    manager.unsubscribeGroup(GROUP_ID);

    expect(m.digestPageRepairBudgets.has(GROUP_ID)).toBe(false);
  });

  it('does not clear budgets when the digest queue is reset (bridge reset)', () => {
    const clock = { now: 1_000_000 };
    const { m } = setup(clock);
    const { local } = seedHead(m);
    m.processGroupDigestRepair(
      digestItem(GROUP_ID, 'peer-a', local.latest, 'f'.repeat(64))
    );

    m.clearDigestRepairQueue();

    expect(m.digestPageRepairBudgets.has(GROUP_ID)).toBe(true);
  });

  it('clamps a wait that a backwards clock jump made longer than the longest step', () => {
    const clock = { now: 500 * MIN };
    const { m, calls } = setup(clock);
    const { local } = seedHead(m);
    const run = (peer: string) =>
      m.processGroupDigestRepair(
        digestItem(GROUP_ID, peer, local.latest, 'f'.repeat(64))
      );
    run('peer-a');
    expect(calls('newest-group-repair')).toBe(1);

    clock.now = 100 * MIN; // the wall clock went back 400 min
    expect(run('peer-b').pageRepairBudget).toBe('spent');
    expect(calls('newest-group-repair')).toBe(2);
  });
});

describe('open-chat page-repair attempt', () => {
  it('opening the chat allows one immediate attempt', () => {
    const start = 1_000_000;
    const clock = { now: start };
    const { manager, m, calls } = setup(clock);
    const { local } = seedHead(m);
    const run = () =>
      m.processGroupDigestRepair(
        digestItem(GROUP_ID, 'peer-a', local.latest, 'f'.repeat(64), {
          latest: wireCursor(local.latest),
          eventHash: 'f'.repeat(64),
        })
      );
    expect(run().pageRepairBudget).toBe('spent');
    clock.now += MIN;
    expect(run().pageRepairBudget).toBe('held');
    expect(calls('newest-group-repair')).toBe(1);

    manager.subscribeChannel(GROUP_ID, 'general');
    const opened = run();
    expect(opened.pageRepairBudget).toBe('open-chat');
    expect(calls('newest-group-repair')).toBe(2);
    expect(m.getDigestQueueDiagnostics().repair.budgetOpenChat).toBe(1);

    clock.now += 6_000;
    expect(run().pageRepairBudget).toBe('held');

    // Closing revokes; re-opening within 60 s of the grant grants nothing.
    manager.unsubscribeChannel(GROUP_ID, 'general');
    manager.subscribeChannel(GROUP_ID, 'general');
    clock.now += 6_000;
    expect(run().pageRepairBudget).toBe('held');
    expect(calls('newest-group-repair')).toBe(2);

    clock.now += 61_000;
    manager.unsubscribeChannel(GROUP_ID, 'general');
    manager.subscribeChannel(GROUP_ID, 'general');
    expect(run().pageRepairBudget).toBe('open-chat');
    expect(calls('newest-group-repair')).toBe(3);
    expect(m.getDigestQueueDiagnostics().repair.budgetOpenChat).toBe(2);
  });

  it('closing the chat revokes an unused open-chat attempt', () => {
    const clock = { now: 1_000_000 };
    const { manager, m, calls } = setup(clock);
    const { local } = seedHead(m);
    const run = () =>
      m.processGroupDigestRepair(
        digestItem(GROUP_ID, 'peer-a', local.latest, 'f'.repeat(64))
      );
    run();
    clock.now += MIN;
    manager.subscribeChannel(GROUP_ID, 'general');
    manager.unsubscribeChannel(GROUP_ID, 'general');

    expect(run().pageRepairBudget).toBe('held');
    expect(calls('newest-group-repair')).toBe(1);
  });

  it('no grant when nothing was rationed', () => {
    const clock = { now: 1_000_000 };
    const { manager, m, calls } = setup(clock);
    const { local } = seedHead(m);

    manager.subscribeChannel(GROUP_ID, 'general');

    expect(m.digestPageRepairBudgets.has(GROUP_ID)).toBe(false);
    const stats = m.processGroupDigestRepair(
      digestItem(GROUP_ID, 'peer-a', local.latest, 'f'.repeat(64))
    );
    expect(stats.pageRepairBudget).toBe('spent');
    expect(calls('newest-group-repair')).toBe(1);
    expect(m.getDigestQueueDiagnostics().repair.budgetOpenChat).toBe(0);
  });

  it('grant re-opens a processed observation', () => {
    const clock = { now: 1_000_000 };
    const { manager, m, calls } = setup(clock);
    const { local } = seedHead(m);
    const queued = {
      peerHash: 'peer-a',
      providerPeerHash: 'peer-a',
      groupId: GROUP_ID,
      wire: { channels: [] },
      remoteGroupLatest: local.latest,
      remoteDigestHash: 'f'.repeat(64),
    };
    // Spend the budget once.
    m.processGroupDigestRepair(
      digestItem(GROUP_ID, 'peer-z', local.latest, 'f'.repeat(64))
    );
    expect(calls('newest-group-repair')).toBe(1);

    clock.now += MIN;
    m.enqueueDigestRepair(queued);
    m.processDigestRepairQueue();
    expect(calls('newest-group-repair')).toBe(1);
    const [observation] = [...m.digestRepairObservations.values()].filter(
      (entry: any) => entry.groupId === GROUP_ID
    );
    expect(observation.status).toBe('processed');
    expect(observation.repairFingerprint).not.toBe('');

    // Without the grant the same digest is only coalesced.
    m.enqueueDigestRepair(queued);
    expect(m.digestRepairItems.size).toBe(0);

    manager.subscribeChannel(GROUP_ID, 'general');
    m.enqueueDigestRepair(queued);
    expect(m.digestRepairItems.size).toBe(1);

    clock.now += 2_000; // past the 1/s/group queue rate window
    m.processDigestRepairQueue();
    expect(calls('newest-group-repair')).toBe(2);
    expect(m.getDigestQueueDiagnostics().repair.budgetOpenChat).toBe(1);
  });
});

describe('digest queue diagnostics', () => {
  it('getDigestQueueDiagnostics reports length, never-reset oldest age, per-minute counts and the class split', () => {
    const clock = { now: 600_000 };
    const { m } = setup(clock);
    const processSpy = vi
      .spyOn(m, 'processGroupDigestRepair')
      .mockImplementation(() => ({ headRelation: 'equal' }));
    const queued = (peer: string) => ({
      peerHash: peer,
      providerPeerHash: peer,
      groupId: GROUP_ID,
      wire: { channels: [] },
      remoteGroupLatest: { eventId: 'remote-head', feedTimestamp: 500_000 },
      remoteDigestHash: 'c'.repeat(64),
    });

    m.enqueueDigestRepair(queued('peer-a'));
    clock.now = 630_000;
    m.enqueueDigestRepair(queued('peer-b'));
    let diagnostics = m.getDigestQueueDiagnostics();
    expect(diagnostics.repair.queued).toBe(1);
    expect(diagnostics.repair.coalesced).toBe(1);
    expect(diagnostics.repair.oldestQueuedMs).toBe(30_000);

    clock.now = 660_000;
    m.enqueueDigestRepair(queued('peer-c'));
    diagnostics = m.getDigestQueueDiagnostics();
    // Coalescing resets enqueuedAt but never firstEnqueuedAt.
    expect(diagnostics.repair.oldestQueuedMs).toBe(60_000);
    expect([...m.digestRepairItems.values()][0].enqueuedAt).toBe(660_000);

    m.processDigestRepairQueue();
    expect(processSpy).toHaveBeenCalledTimes(1);
    diagnostics = m.getDigestQueueDiagnostics();
    expect(diagnostics.repair.processed).toBe(1);
    expect(diagnostics.repair.queued).toBe(0);
    expect(diagnostics.repair.oldestQueuedMs).toBeNull();
    expect(diagnostics.recent.repairProcessed).toBe(1);
    expect(diagnostics.recent.repairCoalesced).toBe(2);
    expect(diagnostics.recent.minutes).toBe(2);
  });

  it('counts the class split and equal-head skips from the real repair', () => {
    const clock = { now: 1_000_000 };
    const { m } = setup(clock);
    const { local, heads } = seedHead(m);
    const before = m.getDigestQueueDiagnostics();

    m.processGroupDigestRepair(
      digestItem(GROUP_ID, 'peer-a', local.latest, 'f'.repeat(64), {
        latest: wireCursor(local.latest),
        eventHash: 'f'.repeat(64),
        channelHeadsHash: heads,
      })
    );

    const after = m.getDigestQueueDiagnostics();
    expect(after.repair.byRelation.equal).toBe(
      before.repair.byRelation.equal + 1
    );
    expect(after.repair.equalHeadSkips).toBe(before.repair.equalHeadSkips + 1);
  });

  it('send queue counts', () => {
    const clock = { now: 600_000 };
    const { m } = setup(clock);
    m.clearDigestSendQueue();
    const before = m.getDigestQueueDiagnostics();

    m.enqueueDigestSend({
      mode: 'subscription',
      groupId: GROUP_ID,
      reason: 'diag-test',
    });
    clock.now = 615_000;
    m.enqueueDigestSend({
      mode: 'subscription',
      groupId: GROUP_ID,
      reason: 'diag-test',
    });

    const diagnostics = m.getDigestQueueDiagnostics();
    expect(diagnostics.send.coalesced).toBe(before.send.coalesced + 1);
    expect(diagnostics.recent.sendCoalesced).toBe(
      before.recent.sendCoalesced + 1
    );
    expect(diagnostics.send.queued).toBe(1);
    expect(diagnostics.send.oldestQueuedMs).toBe(15_000);
  });

  it('appends first_queued_ms, relation and gate to digest_repair_slow', () => {
    const clock = { now: 600_000 };
    const { m } = setup(clock);
    const logs = captureLogs();
    let wall = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => wall);
    vi.spyOn(m, 'processGroupDigestRepair').mockImplementation(() => {
      wall += 10_000;
      return { headRelation: 'equal', pageRepairBudget: 'held' };
    });
    const queued = (peer: string) => ({
      peerHash: peer,
      providerPeerHash: peer,
      groupId: GROUP_ID,
      wire: { channels: [] },
      remoteGroupLatest: { eventId: 'remote-head', feedTimestamp: 500_000 },
      remoteDigestHash: 'c'.repeat(64),
    });
    m.enqueueDigestRepair(queued('peer-a'));
    clock.now = 640_000;
    m.enqueueDigestRepair(queued('peer-b'));

    m.processDigestRepairQueue();

    const slow = logs.find((line) => line.includes('digest_repair_slow'));
    expect(slow).toBeDefined();
    expect(slow).toMatch(
      /actions=\{.*\} first_queued_ms=40000 relation=equal gate=held$/
    );
    expect(slow).toContain('queued_ms=');
    expect(slow).toContain('queue_size=');
  });

  it('prints n/a and none for mocked stats without the new fields', () => {
    const clock = { now: 600_000 };
    const { m } = setup(clock);
    const logs = captureLogs();
    let wall = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => wall);
    vi.spyOn(m, 'processGroupDigestRepair').mockImplementation(() => {
      wall += 10_000;
      return {};
    });
    m.enqueueDigestRepair({
      peerHash: 'peer-a',
      providerPeerHash: 'peer-a',
      groupId: GROUP_ID,
      wire: { channels: [] },
      remoteGroupLatest: { eventId: 'remote-head', feedTimestamp: 500_000 },
      remoteDigestHash: 'c'.repeat(64),
    });

    m.processDigestRepairQueue();

    const slow = logs.find((line) => line.includes('digest_repair_slow'));
    expect(slow).toMatch(/first_queued_ms=0 relation=n\/a gate=none$/);
  });
});
