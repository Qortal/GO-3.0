import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

// Batch 1 item 1.4: the local signer's own membership answered from the
// pushed group list (ownMembershipLocalFirst), Core refreshed in the
// background, a Core "not a member" still wins, a short boot wait.

const STREAM_ID = 'e'.repeat(32);
const GROUP_ID = 801;
const MIN = 60_000;

const managers: ReticulumChatManager[] = [];
const tempPaths: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const manager of managers.splice(0)) manager.close();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-own-member-'));
  tempPaths.push(root);
  return path.join(root, 'reticulum-chat.db');
}

type Signer = { publicKey: string; address: string; secretKey: Uint8Array };

function newSigner(): Signer {
  const kp = nacl.sign.keyPair();
  const publicKey = base58Encode(kp.publicKey);
  return {
    publicKey,
    address: deriveAddressFromPublicKey(publicKey),
    secretKey: kp.secretKey,
  };
}

function sign(signer: Signer, fields: Record<string, unknown>): string {
  return base58Encode(
    nacl.sign.detached(
      new Uint8Array(canonicalizeForSigning(fields)),
      signer.secretKey
    )
  );
}

function makeEvent(
  signer: Signer,
  input: { id: string; seq: number; groupId?: number }
): ReticulumChatEvent {
  const encryptedPayload = `ciphertext-${input.id}`;
  const event: ReticulumChatEvent = {
    eventId: input.id,
    groupId: input.groupId ?? GROUP_ID,
    channelId: 'general',
    authorAddress: signer.address,
    authorPublicKey: signer.publicKey,
    authorStreamId: STREAM_ID,
    authorSeq: input.seq,
    timestamp: Date.now(),
    eventType: 'message',
    encryptedPayload,
    payloadHash: hashReticulumChatPayload(encryptedPayload),
    mentionAddressHashes: [],
    signature: '',
  };
  event.signature = sign(signer, buildReticulumChatSignedFields(event));
  return event;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flushAsyncWork(ticks = 8): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await Promise.resolve();
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves to 'pending' if `promise` has not settled after a few ticks. */
async function settledOrPending<T>(
  promise: Promise<T>
): Promise<T | 'pending'> {
  let settled = false;
  let value: T | undefined;
  void promise.then((v) => {
    settled = true;
    value = v;
  });
  await flushAsyncWork(16);
  return settled ? (value as T) : 'pending';
}

function createManager(options: Partial<ReticulumChatManagerOptions> = {}) {
  const manager = new ReticulumChatManager({
    dbPath: tempDbPath(),
    ...options,
  });
  managers.push(manager);
  const m = manager as any;
  m.fanoutPublishedEvent = vi.fn(async () => ({ ok: true as const }));
  return { manager, m };
}

function captureWarns(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return lines;
}

describe('own membership from the pushed group list (ownMembershipLocalFirst)', () => {
  it('publish returns at once while Core is slow, and a later Core false still overrides', async () => {
    const signer = newSigner();
    let now = Date.now();
    let core = deferred<boolean | null>();
    const validate = vi.fn(() => core.promise);
    const { manager, m } = createManager({
      ownMembershipLocalFirst: true,
      validateGroupMember: validate,
      now: () => now,
    });
    manager.setLocalGroupMemberships([
      { groupId: GROUP_ID, localAddress: signer.address },
    ]);
    const e1 = makeEvent(signer, { id: 'own-member-event-1', seq: 1 });

    // Case 1: no wait on the validator.
    const result = await Promise.race([
      manager.publishEvent(e1),
      sleep(500).then(() => 'hung' as const),
    ]);
    expect(result).toEqual({ ok: true });
    expect(validate).toHaveBeenCalledTimes(1); // the background refresh
    expect(manager.getHistory(GROUP_ID, 10).map((e) => e.eventId)).toContain(
      e1.eventId
    );
    expect(
      manager.getDeliveryCounters().ownMembershipLocalAnswer
    ).toBeGreaterThanOrEqual(1);

    // Case 2: the background refresh says "not a member".
    const warns = captureWarns();
    core.resolve(false);
    await flushAsyncWork();
    expect(m.ownMembershipCoreDenied.size).toBe(1);
    expect(manager.getDeliveryCounters().ownMembershipCoreDenied).toBe(1);
    expect(
      warns.filter((line) => line.includes('own_membership_core_denied'))
    ).toHaveLength(1);
    expect(warns.join('\n')).not.toContain(signer.address);
    await expect(
      m.isValidatedGroupMember(GROUP_ID, signer.address)
    ).resolves.toBe(false);
    const e2 = makeEvent(signer, { id: 'own-member-event-2', seq: 2 });
    await expect(manager.publishEvent(e2)).resolves.toEqual({
      ok: false,
      reason: 'send-command-failed',
      error:
        'Cannot publish Reticulum chat event: author is not a current group member',
    });

    // Cache expired while denied: Core decides, with no list fallback on null.
    now += 5 * MIN + 1;
    core = deferred<boolean | null>();
    const denied = m.isValidatedGroupMember(GROUP_ID, signer.address);
    expect(await settledOrPending(denied)).toBe('pending');
    core.resolve(null);
    await expect(denied).resolves.toBeNull();

    // Core says member again: the denial is lifted.
    now += 10_000;
    core = deferred<boolean | null>();
    const member = m.isValidatedGroupMember(GROUP_ID, signer.address);
    core.resolve(true);
    await expect(member).resolves.toBe(true);
    expect(m.ownMembershipCoreDenied.size).toBe(0);

    // After the next expiry the list answers again without awaiting Core.
    now += 5 * MIN + 1;
    core = deferred<boolean | null>();
    const callsBefore = validate.mock.calls.length;
    await expect(
      settledOrPending(m.isValidatedGroupMember(GROUP_ID, signer.address))
    ).resolves.toBe(true);
    expect(validate.mock.calls.length).toBe(callsBefore + 1);
  });

  it('marks a background refresh that Core could not answer with background=1', async () => {
    const signer = newSigner();
    const core = deferred<boolean | null>();
    const { manager, m } = createManager({
      ownMembershipLocalFirst: true,
      validateGroupMember: vi.fn(() => core.promise),
    });
    manager.setLocalGroupMemberships([
      { groupId: GROUP_ID, localAddress: signer.address },
    ]);
    const warns = captureWarns();

    await expect(
      m.isValidatedGroupMember(GROUP_ID, signer.address)
    ).resolves.toBe(true);
    core.resolve(null);
    await flushAsyncWork();

    expect(
      warns.some(
        (line) =>
          line.includes('Group membership validation unavailable') &&
          line.endsWith(' background=1')
      )
    ).toBe(true);
    // Unavailable is not a denial: the list keeps answering.
    expect(m.ownMembershipCoreDenied.size).toBe(0);
    await expect(
      m.isValidatedGroupMember(GROUP_ID, signer.address)
    ).resolves.toBe(true);
  });

  it('only the local signer in its own groups answers from the list', async () => {
    const signer = newSigner();
    const remote = newSigner();
    const core = deferred<boolean | null>();
    const validate = vi.fn(() => core.promise);
    const { manager, m } = createManager({
      ownMembershipLocalFirst: true,
      validateGroupMember: validate,
    });
    manager.setLocalGroupMemberships([
      { groupId: GROUP_ID, localAddress: signer.address },
    ]);

    const remoteCheck = m.isValidatedGroupMember(GROUP_ID, remote.address);
    const otherGroupCheck = m.isValidatedGroupMember(802, signer.address);
    expect(await settledOrPending(remoteCheck)).toBe('pending');
    expect(await settledOrPending(otherGroupCheck)).toBe('pending');
    expect(validate).toHaveBeenCalledTimes(2);

    core.resolve(true);
    await expect(remoteCheck).resolves.toBe(true);
    await expect(otherGroupCheck).resolves.toBe(true);
    expect(
      manager.getDeliveryCounters().ownMembershipLocalAnswer
    ).toBeUndefined();
  });

  it('calendar membership stays Core-only', async () => {
    const signer = newSigner();
    const core = deferred<boolean | null>();
    const { manager, m } = createManager({
      ownMembershipLocalFirst: true,
      validateGroupMember: vi.fn(() => core.promise),
    });
    manager.setLocalGroupMemberships([
      { groupId: GROUP_ID, localAddress: signer.address },
    ]);

    const calendar = m.isValidatedCalendarMember(GROUP_ID, signer.address);
    expect(await settledOrPending(calendar)).toBe('pending');
    core.resolve(null);
    await expect(calendar).resolves.toBe(false);
  });

  it('boot waits for the pushed list', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const signer = newSigner();
    const core = deferred<boolean | null>();
    const validate = vi.fn(() => core.promise);
    const { manager, m } = createManager({
      ownMembershipLocalFirst: true,
      validateGroupMember: validate,
    });
    manager.setLocalDmAddresses([signer.address]);

    const p = m.isValidatedRequesterGroupMember(
      GROUP_ID,
      signer.address,
      'history_page'
    );
    await vi.advanceTimersByTimeAsync(100);
    manager.setLocalGroupMemberships([
      { groupId: GROUP_ID, localAddress: signer.address },
    ]);

    await expect(p).resolves.toBe(true);
    // The boot prewarm is the only Core request; the list answer joins it.
    expect(validate).toHaveBeenCalledTimes(1);
    expect(manager.getDeliveryCounters().ownMembershipBootWaitReady).toBe(1);
    expect(
      manager.getDeliveryCounters().ownMembershipBootWaitTimeout
    ).toBeUndefined();
    expect(m.localGroupMembershipWaiters.size).toBe(0);
  });

  it('boot wait times out into the Core path', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const signer = newSigner();
    const core = deferred<boolean | null>();
    const validate = vi.fn(() => core.promise);
    const { manager, m } = createManager({
      ownMembershipLocalFirst: true,
      validateGroupMember: validate,
    });
    manager.setLocalDmAddresses([signer.address]);
    const warns = captureWarns();

    let settled = false;
    const q = m.isValidatedGroupMember(GROUP_ID, signer.address);
    void q.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(settled).toBe(false);

    core.resolve(null);
    await expect(q).resolves.toBeNull();
    // The timed-out check joined the prewarmed request.
    expect(validate).toHaveBeenCalledTimes(1);
    expect(manager.getDeliveryCounters().ownMembershipBootWaitTimeout).toBe(1);
    expect(
      warns.filter((line) => line.includes('own_membership_boot_wait_timeout'))
    ).toHaveLength(1);

    // Logged once only.
    const again = m.isValidatedGroupMember(GROUP_ID, signer.address);
    await vi.advanceTimersByTimeAsync(10_000);
    await again;
    expect(
      warns.filter((line) => line.includes('own_membership_boot_wait_timeout'))
    ).toHaveLength(1);
    expect(manager.getDeliveryCounters().ownMembershipBootWaitTimeout).toBe(2);
  });

  it('a Core answer during the boot wait ends it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const signer = newSigner();
    const validate = vi.fn(
      () =>
        new Promise<boolean | null>((resolve) =>
          setTimeout(() => resolve(false), 50)
        )
    );
    const { manager, m } = createManager({
      ownMembershipLocalFirst: true,
      validateGroupMember: validate,
    });
    manager.setLocalDmAddresses([signer.address]);

    let result: unknown = 'pending';
    void m
      .isValidatedGroupMember(GROUP_ID, signer.address)
      .then((v: unknown) => {
        result = v;
      });
    await vi.advanceTimersByTimeAsync(100);

    expect(result).toBe(false);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(m.localGroupMembershipWaiters.size).toBe(0);
    const counters = manager.getDeliveryCounters();
    expect(counters.ownMembershipBootWaitReady).toBeUndefined();
    expect(counters.ownMembershipBootWaitTimeout).toBeUndefined();
  });

  it('a Core null during the boot wait keeps waiting for the list', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const signer = newSigner();
    const validate = vi.fn(() => Promise.resolve(null));
    const { manager, m } = createManager({
      ownMembershipLocalFirst: true,
      validateGroupMember: validate,
    });
    manager.setLocalDmAddresses([signer.address]);

    let result: unknown = 'pending';
    void m
      .isValidatedGroupMember(GROUP_ID, signer.address)
      .then((v: unknown) => {
        result = v;
      });
    await vi.advanceTimersByTimeAsync(100);
    expect(result).toBe('pending');
    manager.setLocalGroupMemberships([
      { groupId: GROUP_ID, localAddress: signer.address },
    ]);
    await vi.advanceTimersByTimeAsync(0);

    expect(result).toBe(true);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(manager.getDeliveryCounters().ownMembershipBootWaitReady).toBe(1);
    expect(m.localGroupMembershipWaiters.size).toBe(0);
  });

  it('no boot wait when Core already answered for the address', async () => {
    const signer = newSigner();
    const validate = vi.fn(async () => true);
    const { manager, m } = createManager({
      ownMembershipLocalFirst: true,
      validateGroupMember: validate,
    });
    manager.setLocalDmAddresses([signer.address]);
    await expect(
      m.getCoreValidatedGroupMembership(GROUP_ID, signer.address)
    ).resolves.toBe(true);

    await expect(
      settledOrPending(m.isValidatedGroupMember(GROUP_ID, signer.address))
    ).resolves.toBe(true);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(m.localGroupMembershipWaiters.size).toBe(0);
    expect(
      manager.getDeliveryCounters().ownMembershipBootWaitReady
    ).toBeUndefined();
  });

  it('no boot wait for an address that is not registered here', async () => {
    const signer = newSigner();
    const core = deferred<boolean | null>();
    const { m } = createManager({
      ownMembershipLocalFirst: true,
      validateGroupMember: vi.fn(() => core.promise),
    });

    const q = m.isValidatedGroupMember(GROUP_ID, signer.address);
    core.resolve(null);
    await expect(q).resolves.toBeNull();
    expect(m.localGroupMembershipWaiters.size).toBe(0);
  });

  it('close releases a boot waiter into the Core path', async () => {
    const signer = newSigner();
    const core = deferred<boolean | null>();
    const { manager, m } = createManager({
      ownMembershipLocalFirst: true,
      validateGroupMember: vi.fn(() => core.promise),
    });
    manager.setLocalDmAddresses([signer.address]);
    const q = m.isValidatedGroupMember(GROUP_ID, signer.address);
    await flushAsyncWork();
    expect(m.localGroupMembershipWaiters.size).toBe(1);

    manager.close();
    managers.splice(managers.indexOf(manager), 1);

    expect(m.localGroupMembershipWaiters.size).toBe(0);
    core.resolve(null);
    await expect(q).resolves.toBeNull();
    expect(
      manager.getDeliveryCounters().ownMembershipBootWaitReady
    ).toBeUndefined();
  });

  it("option off keeps today's order", async () => {
    const signer = newSigner();
    const core = deferred<boolean | null>();
    const { manager, m } = createManager({
      validateGroupMember: vi.fn(() => core.promise),
    });
    manager.setLocalGroupMemberships([
      { groupId: GROUP_ID, localAddress: signer.address },
    ]);
    const e = makeEvent(signer, { id: 'own-member-option-off', seq: 1 });

    const publish = manager.publishEvent(e);
    expect(await settledOrPending(publish)).toBe('pending');
    core.resolve(null);
    await expect(publish).resolves.toEqual({ ok: true });
    expect(
      manager.getDeliveryCounters().ownMembershipLocalAnswer
    ).toBeUndefined();
    expect(m.ownMembershipCoreDenied.size).toBe(0);
  });

  it('option off never records a denial', async () => {
    const signer = newSigner();
    const { manager, m } = createManager({
      validateGroupMember: vi.fn(async () => false),
    });
    manager.setLocalGroupMemberships([
      { groupId: GROUP_ID, localAddress: signer.address },
    ]);

    await expect(
      m.isValidatedGroupMember(GROUP_ID, signer.address)
    ).resolves.toBe(false);
    expect(m.ownMembershipCoreDenied.size).toBe(0);
  });

  it('denial pruned when the list drops the group, and cleared on validator change', async () => {
    const signer = newSigner();
    const validate = vi.fn(async () => false);
    const { manager, m } = createManager({
      ownMembershipLocalFirst: true,
      validateGroupMember: validate,
    });
    const push = () =>
      manager.setLocalGroupMemberships([
        { groupId: GROUP_ID, localAddress: signer.address },
      ]);
    push();
    captureWarns();

    // The list answers, the background refresh records the denial.
    await expect(
      m.isValidatedGroupMember(GROUP_ID, signer.address)
    ).resolves.toBe(true);
    await flushAsyncWork();
    expect(m.ownMembershipCoreDenied.size).toBe(1);
    push(); // same list: the denial stays
    expect(m.ownMembershipCoreDenied.size).toBe(1);

    manager.setLocalGroupMemberships([]);
    expect(m.ownMembershipCoreDenied.size).toBe(0);

    push();
    m.groupMemberValidationCache.clear();
    await m.isValidatedGroupMember(GROUP_ID, signer.address);
    await flushAsyncWork();
    expect(m.ownMembershipCoreDenied.size).toBe(1);
    manager.setRuntimeCallbacks({
      validateGroupMember: vi.fn(async () => true),
    });
    expect(m.ownMembershipCoreDenied.size).toBe(0);
  });
});
