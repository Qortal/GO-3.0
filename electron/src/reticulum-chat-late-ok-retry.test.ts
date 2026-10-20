import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReticulumChatManager } from './reticulum-chat';

// lateOkCancelsRetry (GO): a chat send that timed out in the worker but got
// a late ok is not sent a second time, and local timeouts are not bridge
// pressure. With the flag off nothing changes.

const managers: ReticulumChatManager[] = [];
const tempPaths: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

const PEER = 'b'.repeat(32);
const OTHER = 'c'.repeat(32);

function makeManager(
  lateOkCancelsRetry: boolean,
  reasons: Array<string | null>
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-late-ok-'));
  tempPaths.push(root);
  const clock = { now: 1_000_000 };
  const listeners = new Map<string, (info: unknown) => void>();
  // Each send takes the next scripted outcome; null = delivered.
  const outcome = async () => {
    const reason = reasons.length > 1 ? reasons.shift() : reasons[0];
    return reason ? { ok: false as const, reason } : { ok: true as const };
  };
  const send = vi.fn(outcome);
  const fanout = vi.fn(outcome);
  const manager = new ReticulumChatManager({
    dbPath: path.join(root, 'reticulum-chat.db'),
    bridge: {
      on: (name: string, fn: (info: unknown) => void) =>
        listeners.set(name, fn),
      off: (name: string) => listeners.delete(name),
      sendReticulumChatDetailed: send,
      fanoutReticulumChatDetailed: fanout,
    } as any,
    now: () => clock.now,
    ...(lateOkCancelsRetry ? { mobileProfile: { lateOkCancelsRetry } } : {}),
  });
  managers.push(manager);
  const lateOk = (info: unknown) =>
    listeners.get('reticulum-late-send-ok')?.(info);
  const drain = () => (manager as any).drainControlRetryQueue();
  const queue = () => (manager as any).controlRetryQueue as Map<string, any>;
  return { manager, clock, send, fanout, lateOk, drain, queue, listeners };
}

const wire = (id: string) => ({
  t: 'RCHAT',
  k: 'relay_query',
  g: 7,
  q: { ids: [id] },
});

describe('late ok after a local timeout', () => {
  it('drops the queued retry, so the wire is sent once', async () => {
    const { manager, clock, send, lateOk, drain, queue } = makeManager(true, [
      'bridge-timeout',
      null,
    ]);
    const sent = wire('e1');
    const result = await (manager as any).sendToPeer(PEER, sent);
    expect(result).toMatchObject({ ok: false, reason: 'bridge-timeout' });
    expect(queue().size).toBe(1);
    lateOk({
      action: 'send_reticulum_chat',
      payload: { peerPresenceHash: PEER, message: sent },
    });
    expect(queue().size).toBe(0);
    clock.now += 3_000;
    await drain();
    expect(send).toHaveBeenCalledTimes(1);
    expect(manager.getDeliveryCounters()).toMatchObject({
      controlRetryLateOkCancelled: 1,
      bridgeLocalTimeout: 1,
    });
  });

  it('drops a fanout retry for the same wire and excludes only', async () => {
    const { manager, clock, fanout, lateOk, drain, queue } = makeManager(true, [
      'bridge-timeout',
      null,
    ]);
    const sent = wire('e2');
    await (manager as any).fanout(sent, [OTHER]);
    expect(queue().size).toBe(1);
    // Another wire, or the same wire with other excludes: kept.
    lateOk({
      action: 'fanout_reticulum_chat',
      payload: { messages: [wire('e3')], excludePeerPresenceHashes: [OTHER] },
    });
    lateOk({
      action: 'fanout_reticulum_chat',
      payload: { messages: [sent], excludePeerPresenceHashes: [] },
    });
    lateOk({
      action: 'send_reticulum_chat',
      payload: { peerPresenceHash: OTHER, message: sent },
    });
    expect(queue().size).toBe(1);
    lateOk({
      action: 'fanout_reticulum_chat',
      payload: { messages: [sent], excludePeerPresenceHashes: [OTHER] },
    });
    expect(queue().size).toBe(0);
    clock.now += 3_000;
    await drain();
    expect(fanout).toHaveBeenCalledTimes(1);
  });

  it('cannot call back a retry that already went out, but stops the next one', async () => {
    const { manager, clock, send, lateOk, drain, queue } = makeManager(true, [
      'bridge-timeout',
    ]);
    const sent = wire('e4');
    await (manager as any).sendToPeer(PEER, sent);
    clock.now += 3_000;
    await drain();
    expect(send).toHaveBeenCalledTimes(2);
    expect(queue().size).toBe(1);
    lateOk({
      action: 'send_reticulum_chat',
      payload: { peerPresenceHash: PEER, message: sent },
    });
    clock.now += 3_000;
    await drain();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('changes nothing with the flag off', async () => {
    const { manager, clock, send, lateOk, drain, queue } = makeManager(false, [
      'bridge-timeout',
      null,
    ]);
    const sent = wire('e5');
    await (manager as any).sendToPeer(PEER, sent);
    lateOk({
      action: 'send_reticulum_chat',
      payload: { peerPresenceHash: PEER, message: sent },
    });
    expect(queue().size).toBe(1);
    clock.now += 3_000;
    await drain();
    expect(send).toHaveBeenCalledTimes(2);
    const counters = manager.getDeliveryCounters();
    expect(counters.controlRetryLateOkCancelled ?? 0).toBe(0);
    expect(counters.bridgeLocalTimeout ?? 0).toBe(0);
    expect(counters.bridgePressureFailure).toBe(1);
  });

  it('ignores odd payloads', () => {
    const { lateOk, manager, queue } = makeManager(true, ['bridge-timeout']);
    for (const info of [
      null,
      {},
      { action: 'send_reticulum_chat' },
      { action: 'send_reticulum_chat', payload: { message: wire('x') } },
      { action: 'fanout_reticulum_chat', payload: { messages: 'x' } },
      { action: 'other', payload: { messages: [wire('x')] } },
      { action: 'fanout_reticulum_chat', payload: { messages: [null, 5] } },
    ]) {
      expect(() => lateOk(info)).not.toThrow();
    }
    expect(queue().size).toBe(0);
    expect(manager.getDeliveryCounters().controlRetryLateOkCancelled ?? 0).toBe(
      0
    );
  });

  it('drops the retry of each routed next hop the late reply delivered to, and only those', async () => {
    const { manager, clock, send, lateOk, drain, queue } = makeManager(true, [
      null,
    ]);
    // Routed group control with two next hops goes out as one multi-target
    // send; its timeout queues a retry per next hop.
    const targets = vi.fn(async () => ({
      ok: false as const,
      reason: 'bridge-timeout',
    }));
    (manager as any).bridge.sendReticulumChatTargetsDetailed = targets;
    (manager as any).getGroupInterestNextHops = () => [PEER, OTHER];
    const notice = { t: 'RCHAT', k: 'event_notice_v3', g: 7, e: 'e6' };
    const result = await (manager as any).sendGroupRoutedControl(7, notice, {
      useRetryQueue: true,
      fallbackFanout: false,
    });
    expect(result).toMatchObject({ ok: false, reason: 'bridge-timeout' });
    expect(targets).toHaveBeenCalledTimes(1);
    expect(queue().size).toBe(2);
    // Another wire for the same peer: kept.
    lateOk({
      action: 'send_reticulum_chat_targets',
      payload: { message: { ...notice, e: 'e7' }, peerPresenceHashes: [PEER] },
    });
    expect(queue().size).toBe(2);
    // Python delivered to PEER only; OTHER failed and keeps its retry.
    lateOk({
      action: 'send_reticulum_chat_targets',
      payload: { message: notice, peerPresenceHashes: [PEER] },
    });
    expect(queue().size).toBe(1);
    clock.now += 3_000;
    await drain();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(OTHER);
    expect(manager.getDeliveryCounters().controlRetryLateOkCancelled).toBe(1);
  });

  it('stops listening when the bridge is replaced', () => {
    const { manager, listeners } = makeManager(true, [null]);
    expect(listeners.has('reticulum-late-send-ok')).toBe(true);
    (manager as any).detachBridge();
    expect(listeners.has('reticulum-late-send-ok')).toBe(false);
  });
});

describe('local timeouts and bridge pressure', () => {
  it('does not pause relaying for a local timeout with the flag on', () => {
    const { manager, clock } = makeManager(true, [null]);
    (manager as any).noteBridgeSendResult({
      ok: false,
      reason: 'bridge-timeout',
    });
    expect((manager as any).relayPausedUntil).toBe(0);
    expect(manager.getDeliveryCounters()).toMatchObject({
      bridgeLocalTimeout: 1,
    });
    expect(manager.getDeliveryCounters().bridgePressureFailure ?? 0).toBe(0);
    // An overloaded bridge still pauses relaying.
    (manager as any).noteBridgeSendResult({
      ok: false,
      reason: 'bridge-overloaded',
    });
    expect((manager as any).relayPausedUntil).toBe(clock.now + 10_000);
  });

  it('keeps counting it as pressure with the flag off', () => {
    const { manager, clock } = makeManager(false, [null]);
    (manager as any).noteBridgeSendResult({
      ok: false,
      reason: 'bridge-timeout',
    });
    expect((manager as any).relayPausedUntil).toBe(clock.now + 10_000);
    expect(manager.getDeliveryCounters()).toMatchObject({
      bridgePressureFailure: 1,
    });
  });
});
