import { describe, expect, it } from 'vitest';
import {
  isSignedHeartbeatHandover,
  planSignedHeartbeats,
  SIGNED_HEARTBEAT_BATCH,
  SIGNED_HEARTBEAT_COVER_MS,
  SIGNED_HEARTBEAT_FIRST_BATCH,
  SIGNED_HEARTBEAT_INTERVAL_MS,
} from './presenceHeartbeatPlan';

const MIN = 60_000;

describe('planSignedHeartbeats', () => {
  it('covers two hours at the live heartbeat spacing, starting one interval ahead', () => {
    const now = 1_000_000;
    const plan = planSignedHeartbeats({
      now,
      lastActivityAt: now,
      status: 'online',
      idleAfterMs: 30 * MIN,
    });
    expect(plan).toHaveLength(
      Math.floor(SIGNED_HEARTBEAT_COVER_MS / SIGNED_HEARTBEAT_INTERVAL_MS)
    );
    expect(plan[0].timestamp).toBe(now + SIGNED_HEARTBEAT_INTERVAL_MS);
    expect(plan[1].timestamp - plan[0].timestamp).toBe(
      SIGNED_HEARTBEAT_INTERVAL_MS
    );
    expect(plan[plan.length - 1].timestamp).toBeLessThanOrEqual(
      now + SIGNED_HEARTBEAT_COVER_MS
    );
  });

  it('turns idle once the user has been away as long as the page would wait', () => {
    const now = 1_000_000;
    const plan = planSignedHeartbeats({
      now,
      lastActivityAt: now - 10 * MIN,
      status: 'online',
      idleAfterMs: 30 * MIN,
      intervalMs: 5 * MIN,
      coverMs: 40 * MIN,
    });
    expect(plan.map((p) => p.status)).toEqual([
      'online', // 15 min since activity
      'online', // 20
      'online', // 25
      'idle', // 30
      'idle',
      'idle',
      'idle',
      'idle',
    ]);
  });

  it('keeps busy and idle as chosen, and plans nothing while invisible', () => {
    const base = {
      now: 0,
      lastActivityAt: -100 * MIN,
      idleAfterMs: 30 * MIN,
      intervalMs: MIN,
      coverMs: 3 * MIN,
    };
    expect(
      planSignedHeartbeats({ ...base, status: 'busy' }).map((p) => p.status)
    ).toEqual(['busy', 'busy', 'busy']);
    expect(
      planSignedHeartbeats({
        ...base,
        lastActivityAt: 0,
        status: 'idle',
      }).map((p) => p.status)
    ).toEqual(['idle', 'idle', 'idle']);
    expect(planSignedHeartbeats({ ...base, status: 'offline' })).toEqual([]);
  });
});

describe('isSignedHeartbeatHandover', () => {
  it('hands over the first batch early, then every batch, and the end', () => {
    const total = 288;
    const points = [];
    for (let n = 1; n <= total; n++) {
      if (isSignedHeartbeatHandover(n, total)) points.push(n);
    }
    expect(points[0]).toBe(SIGNED_HEARTBEAT_FIRST_BATCH);
    expect(points[1]).toBe(
      SIGNED_HEARTBEAT_FIRST_BATCH + SIGNED_HEARTBEAT_BATCH
    );
    expect(points[points.length - 1]).toBe(total);
    expect(isSignedHeartbeatHandover(0, total)).toBe(false);
    expect(isSignedHeartbeatHandover(3, 3)).toBe(true);
  });
});
