import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReticulumChatManager } from './reticulum-chat';

const managers: ReticulumChatManager[] = [];
const tempPaths: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

function makeManager(reasons: Array<string | null>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-control-retry-'));
  tempPaths.push(root);
  const clock = { now: 1_000_000 };
  // Each send takes the next scripted outcome; null = delivered.
  const fanout = vi.fn(async () => {
    const reason = reasons.length > 1 ? reasons.shift() : reasons[0];
    return reason ? { ok: false as const, reason } : { ok: true as const };
  });
  const manager = new ReticulumChatManager({
    dbPath: path.join(root, 'reticulum-chat.db'),
    bridge: {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: fanout,
    } as any,
    now: () => clock.now,
  });
  managers.push(manager);
  for (let i = 0; i < 5; i += 1) {
    (manager as any).enqueueControlRetry({
      wire: { t: 'RCHAT', k: 'relay_query', g: 7, q: { ids: [`event-${i}`] } },
    });
  }
  const drain = () => (manager as any).drainControlRetryQueue();
  return { manager, clock, fanout, drain };
}

describe('control retries under bridge pressure', () => {
  it('stops the pass and pauses while the bridge is overloaded', async () => {
    const { manager, clock, fanout, drain } = makeManager([
      'bridge-overloaded',
      'bridge-overloaded',
      null,
    ]);
    clock.now += 3_000;
    await drain();
    // Before, all five due retries went to the jammed bridge at once.
    expect(fanout).toHaveBeenCalledTimes(1);
    expect((manager as any).controlRetryPressureUntil).toBe(clock.now + 3_000);

    clock.now += 1_000;
    await drain();
    expect(fanout).toHaveBeenCalledTimes(1);

    clock.now += 2_000;
    await drain();
    expect(fanout).toHaveBeenCalledTimes(2);
    // Longer each time it stays jammed.
    expect((manager as any).controlRetryPressureUntil).toBe(clock.now + 6_000);

    clock.now += 6_000;
    await drain();
    expect(fanout).toHaveBeenCalledTimes(7);
    expect((manager as any).controlRetryQueue.size).toBe(0);
    expect((manager as any).controlRetryPressureStreak).toBe(0);
  });

  it('keeps the normal timing for failures that are not an overload', async () => {
    // A single slow command (bridge-timeout: the 8 s fast-fail of DM
    // control wires) is no reason to hold every other retry back.
    for (const reason of ['packet-send-false', 'bridge-timeout']) {
      const { manager, clock, fanout, drain } = makeManager([reason]);
      clock.now += 3_000;
      await drain();
      expect(fanout).toHaveBeenCalledTimes(5);
      expect((manager as any).controlRetryPressureUntil).toBe(0);
      expect((manager as any).controlRetryQueue.size).toBe(5);
    }
  });

  it('starts the pause over once an earlier jam is long gone', async () => {
    const { manager, clock, drain } = makeManager(['bridge-overloaded']);
    clock.now += 3_000;
    await drain();
    clock.now += 3_000;
    await drain();
    expect((manager as any).controlRetryPressureUntil).toBe(clock.now + 6_000);

    clock.now += 60_000;
    await drain();
    expect((manager as any).controlRetryPressureUntil).toBe(clock.now + 3_000);
  });

  it('never pauses longer than a queued DM notice lives', async () => {
    const { manager, clock, drain } = makeManager(['bridge-overloaded']);
    for (let i = 0; i < 6; i += 1) {
      clock.now = Math.max(
        clock.now + 3_000,
        (manager as any).controlRetryPressureUntil
      );
      await drain();
    }
    expect(
      (manager as any).controlRetryPressureUntil - clock.now
    ).toBeLessThanOrEqual(20_000);
  });

  it('pauses too when the overloaded retry was its last attempt', async () => {
    const { manager, clock, fanout, drain } = makeManager([
      'bridge-overloaded',
    ]);
    for (const item of (manager as any).controlRetryQueue.values()) {
      item.attempts = 9;
    }
    clock.now += 3_000;
    await drain();
    expect(fanout).toHaveBeenCalledTimes(1);
    expect((manager as any).controlRetryQueue.size).toBe(4);
    expect((manager as any).controlRetryPressureUntil).toBe(clock.now + 3_000);
  });

  it('pauses relaying for other peers while the bridge is under pressure', async () => {
    const { manager, clock, fanout } = makeManager([null]);
    const forward = (leaseId: number) =>
      (manager as any).forwardGroupSub(
        [{ groupId: 7, leaseId }],
        'summary',
        'b'.repeat(32),
        'c'.repeat(32),
        0,
        'f'.repeat(16),
        4
      );
    const releases = vi.spyOn(manager as any, 'releaseGroupSubForward');

    (manager as any).noteBridgeSendResult({
      ok: false,
      reason: 'bridge-overloaded',
    });
    await forward(1);
    expect(fanout).not.toHaveBeenCalled();
    // Released, so the origin's next refresh can be relayed again.
    expect(releases).toHaveBeenCalledTimes(1);
    expect(manager.getDeliveryCounters()).toMatchObject({
      bridgePressureFailure: 1,
      relaySkippedBridgePressure: 1,
    });

    clock.now += 10_000;
    await forward(2);
    expect(fanout).toHaveBeenCalledTimes(1);
    expect(fanout.mock.calls[0][0][0]).toMatchObject({
      k: 'group_sub',
      groups: [7],
      h: 1,
    });
  });
});
