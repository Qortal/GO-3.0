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

// Batch 1 item 1.6: a retried publish of an event this device already stored
// (same id AND same signature) is a success, with at most one detached
// re-fanout; true failures stay 'Invalid event' and log why.

const STREAM_ID = 'e'.repeat(32);
const GROUP_ID = 950;

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-publish-retry-'));
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

function makeEventFor(
  signer: Signer,
  input: { id: string; seq: number; payload?: string; groupId?: number }
): ReticulumChatEvent {
  const encryptedPayload = input.payload ?? `ciphertext-${input.id}`;
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

function captureWarns(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return lines;
}

function setup(
  options: Partial<ReticulumChatManagerOptions> & {
    fanout?: (...args: any[]) => Promise<any>;
  } = {}
) {
  const { fanout: fanoutImpl, ...managerOptions } = options;
  const signer = (options as any).signer ?? newSigner();
  const dbPath = managerOptions.dbPath ?? tempDbPath();
  const manager = new ReticulumChatManager({
    validateGroupMember: async () => true,
    ...managerOptions,
    dbPath,
  });
  managers.push(manager);
  manager.setLocalGroupMemberships([
    { groupId: GROUP_ID, localAddress: signer.address },
  ]);
  const fanout = vi.fn(fanoutImpl ?? (async () => ({ ok: true as const })));
  (manager as any).fanoutPublishedEvent = fanout;
  const makeEvent = (input: { id: string; seq: number; payload?: string }) =>
    makeEventFor(signer, input);
  const history = () =>
    manager.getHistory(GROUP_ID, 10).map((event) => event.eventId);
  return {
    manager,
    m: manager as any,
    signer,
    dbPath,
    fanout,
    makeEvent,
    history,
  };
}

describe('idempotent publishEvent', () => {
  it('a retry of a stored event returns ok duplicate and does not re-fan an event that already reached someone', async () => {
    const { manager, m, fanout, makeEvent, history } = setup();
    const warns = captureWarns();
    const e = makeEvent({ id: 'publish-retry-event-1', seq: 1 });

    await expect(manager.publishEvent(e)).resolves.toEqual({ ok: true });
    const store = vi.spyOn(m, 'storeValidatedEvent');
    const relay = vi.spyOn(m, 'replicateEventToRelayCache');
    await expect(manager.publishEvent(e)).resolves.toEqual({
      ok: true,
      duplicate: true,
    });
    await flushAsyncWork();

    expect(fanout).toHaveBeenCalledTimes(1);
    expect(store).not.toHaveBeenCalled();
    expect(relay).not.toHaveBeenCalled();
    expect(history().filter((id) => id === e.eventId)).toHaveLength(1);
    const line = warns.find((entry) =>
      entry.includes('publish_retry_after_page_failure')
    );
    expect(line).toContain('phase=retry');
    expect(line).toContain('refanout=0');
    expect(line).toContain(`event=${e.eventId.slice(0, 12)} `);
    expect(manager.getDeliveryCounters().groupEventPublishDuplicate).toBe(1);
    expect(
      manager.getDeliveryCounters().groupEventPublishRefanout
    ).toBeUndefined();
  });

  it('re-sends once when the first fanout failed', async () => {
    const results = [
      { ok: false as const, reason: 'bridge-timeout' },
      { ok: true as const },
    ];
    const { manager, fanout, makeEvent } = setup({
      fanout: async () => results.shift() ?? { ok: true as const },
    });
    captureWarns();
    const e = makeEvent({ id: 'publish-retry-event-2', seq: 1 });

    await expect(manager.publishEvent(e)).resolves.toEqual({ ok: true });
    await expect(manager.publishEvent(e)).resolves.toEqual({
      ok: true,
      duplicate: true,
    });
    await flushAsyncWork();
    expect(fanout).toHaveBeenCalledTimes(2);
    expect(fanout.mock.calls[1][0]).toMatchObject({ eventId: e.eventId });
    expect(manager.getDeliveryCounters().groupEventPublishRefanout).toBe(1);

    await expect(manager.publishEvent(e)).resolves.toEqual({
      ok: true,
      duplicate: true,
    });
    await flushAsyncWork();
    expect(fanout).toHaveBeenCalledTimes(2);
  });

  it('logs a failed re-fanout and never retries it', async () => {
    const { manager, fanout, makeEvent } = setup({
      fanout: async () => ({ ok: false as const, reason: 'bridge-timeout' }),
    });
    const warns = captureWarns();
    const e = makeEvent({ id: 'publish-retry-event-3', seq: 1 });

    await manager.publishEvent(e);
    await manager.publishEvent(e);
    await flushAsyncWork();
    await manager.publishEvent(e);
    await flushAsyncWork();

    expect(fanout).toHaveBeenCalledTimes(2);
    expect(
      warns.filter((line) =>
        line.includes(
          `publish_refanout_failed group=${GROUP_ID} event=${e.eventId.slice(0, 12)} reason=bridge-timeout`
        )
      )
    ).toHaveLength(1);
  });

  it('no re-fanout while the first fanout is running', async () => {
    const first = deferred<{ ok: false; reason: string } | { ok: true }>();
    let calls = 0;
    const { manager, fanout, makeEvent, history } = setup({
      fanout: () => {
        calls += 1;
        return calls === 1 ? first.promise : Promise.resolve({ ok: true });
      },
    });
    captureWarns();
    const e = makeEvent({ id: 'publish-retry-event-4', seq: 1 });

    const p1 = manager.publishEvent(e);
    for (let i = 0; i < 20 && !history().includes(e.eventId); i += 1) {
      await flushAsyncWork();
    }
    expect(history()).toContain(e.eventId);
    await expect(manager.publishEvent(e)).resolves.toEqual({
      ok: true,
      duplicate: true,
    });
    expect(fanout).toHaveBeenCalledTimes(1);

    first.resolve({ ok: false, reason: 'bridge-timeout' });
    await expect(p1).resolves.toEqual({ ok: true });
    await expect(manager.publishEvent(e)).resolves.toEqual({
      ok: true,
      duplicate: true,
    });
    expect(fanout).toHaveBeenCalledTimes(2);
  });

  it('concurrent attempts on one in-flight validation both succeed', async () => {
    const { manager, fanout, makeEvent } = setup({
      validateGroupMember: async () => {
        await sleep(100);
        return null; // the local-signer fallback answers true
      },
    });
    const warns = captureWarns();
    const e = makeEvent({ id: 'publish-retry-event-5', seq: 1 });

    const results = await Promise.all([
      manager.publishEvent(e),
      manager.publishEvent(e),
    ]);

    expect(results).toContainEqual({ ok: true });
    expect(results).toContainEqual({ ok: true, duplicate: true });
    await flushAsyncWork();
    expect(fanout).toHaveBeenCalledTimes(1);
    const line = warns.find((entry) =>
      entry.includes('publish_retry_after_page_failure')
    );
    expect(line).toContain('phase=concurrent refanout=0');
  });

  it('same id, different signature stays Invalid event', async () => {
    const { manager, fanout, makeEvent } = setup();
    const warns = captureWarns();
    const e1 = makeEvent({ id: 'publish-retry-X', seq: 1, payload: 'one' });
    const e2 = makeEvent({ id: 'publish-retry-X', seq: 1, payload: 'two' });
    expect(e1.signature).not.toBe(e2.signature);

    await expect(manager.publishEvent(e1)).resolves.toEqual({ ok: true });
    await expect(manager.publishEvent(e2)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid event',
    });

    expect(fanout).toHaveBeenCalledTimes(1);
    expect(
      warns.some(
        (line) =>
          line.includes('Refusing publish') &&
          line.includes('reason=event_id_taken')
      )
    ).toBe(true);
    expect(
      manager.getDeliveryCounters().groupEventPublishDuplicate
    ).toBeUndefined();
  });

  it('seq reuse stays a true failure', async () => {
    const { manager, fanout, makeEvent } = setup();
    const warns = captureWarns();
    const e1 = makeEvent({ id: 'publish-retry-A', seq: 1 });
    const e2 = makeEvent({ id: 'publish-retry-B', seq: 1 });

    await expect(manager.publishEvent(e1)).resolves.toEqual({ ok: true });
    await expect(manager.publishEvent(e2)).resolves.toEqual({
      ok: false,
      reason: 'send-command-failed',
      error: 'Invalid event',
    });
    await expect(manager.publishEvent(e2)).resolves.toEqual({
      ok: false,
      reason: 'send-command-failed',
      error: 'Invalid event',
    });

    expect(fanout).toHaveBeenCalledTimes(1);
    expect(
      warns.filter(
        (line) =>
          line.includes(
            `Refusing publish group=${GROUP_ID} event=${e2.eventId.slice(0, 12)} seq=1`
          ) && line.includes('reason=seq_already_used')
      )
    ).toHaveLength(2);
  });

  it('after a restart a duplicate gets one re-fanout', async () => {
    const signer = newSigner();
    const dbPath = tempDbPath();
    const first = setup({ dbPath, signer } as any);
    const e = first.makeEvent({ id: 'publish-retry-restart', seq: 1 });
    await expect(first.manager.publishEvent(e)).resolves.toEqual({ ok: true });
    first.manager.close();
    managers.splice(managers.indexOf(first.manager), 1);
    captureWarns();

    const second = setup({ dbPath, signer } as any);
    await expect(second.manager.publishEvent(e)).resolves.toEqual({
      ok: true,
      duplicate: true,
    });
    await flushAsyncWork();
    expect(second.fanout).toHaveBeenCalledTimes(1);
    expect(second.fanout.mock.calls[0][0]).toMatchObject({
      eventId: e.eventId,
      signature: e.signature,
    });
  });

  it('slow publish logs its stages', async () => {
    let offset = 0;
    const { manager, makeEvent } = setup({
      now: () => Date.now() + offset,
      fanout: async () => {
        offset += 11_000;
        return { ok: true as const };
      },
    });
    const warns = captureWarns();
    const e = makeEvent({ id: 'publish-retry-slow', seq: 1 });

    await expect(manager.publishEvent(e)).resolves.toEqual({ ok: true });

    const line = warns.find((entry) => entry.includes('slow_publish'));
    expect(line).toBeDefined();
    expect(line).toContain(`group=${GROUP_ID}`);
    expect(line).toMatch(
      /duration_ms=\d+ validate_ms=\d+ store_ms=\d+ fanout_ms=\d+ fanout_ok=1/
    );
    expect(Number(/fanout_ms=(\d+)/.exec(line!)?.[1])).toBeGreaterThanOrEqual(
      11_000
    );
  });

  it('a fast publish logs no slow_publish line', async () => {
    const { manager, makeEvent } = setup();
    const warns = captureWarns();
    await manager.publishEvent(makeEvent({ id: 'publish-retry-fast', seq: 1 }));
    expect(warns.some((line) => line.includes('slow_publish'))).toBe(false);
  });

  it('close clears the publish bookkeeping', async () => {
    const { manager, m, makeEvent } = setup();
    await manager.publishEvent(
      makeEvent({ id: 'publish-retry-close', seq: 1 })
    );
    expect(m.publishFanoutDelivered.size).toBe(1);
    manager.close();
    managers.splice(managers.indexOf(manager), 1);
    expect(m.publishFanoutDelivered.size).toBe(0);
    expect(m.publishFanoutInFlight.size).toBe(0);
    expect(m.publishRefanoutDone.size).toBe(0);
  });

  it('never re-fans a stored event that another account wrote', async () => {
    const { manager, m, fanout } = setup();
    captureWarns();
    const other = newSigner();
    const foreign = makeEventFor(other, {
      id: 'publish-retry-foreign',
      seq: 1,
    });
    expect(m.db.insertEvent(foreign, false)).toBe(true);

    await expect(manager.publishEvent(foreign)).resolves.toEqual({
      ok: true,
      duplicate: true,
    });
    await flushAsyncWork();
    expect(fanout).not.toHaveBeenCalled();
    expect(
      manager.getDeliveryCounters().groupEventPublishRefanout
    ).toBeUndefined();
  });

  it('bounds the remembered ids', () => {
    const { m } = setup();
    const set = new Set<string>();
    for (let i = 0; i < 300; i += 1) m.addBoundedId(set, `id-${i}`);
    expect(set.size).toBe(256);
    expect(set.has('id-0')).toBe(false);
    expect(set.has('id-299')).toBe(true);
  });
});
