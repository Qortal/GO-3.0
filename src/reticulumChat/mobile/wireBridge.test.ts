import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileReticulumBridge } from './wireBridge';

const PEER_B = 'b'.repeat(32);
const PEER_C = 'c'.repeat(32);
const IDENTITY = 'aWRlbnRpdHk=';

type Call = { action: string; payload: Record<string, any> };
type Ack = { ok: boolean; error?: string; payload?: Record<string, any> };

/**
 * Fake python command channel: every `prepare_reticulum_resource_session`
 * is acknowledged with the next queued ack, or with a link that is still
 * being established (so the caller waits for a session event).
 */
function makeBridge() {
  const calls: Call[] = [];
  const acks: Ack[] = [];
  let nextLink = 0;
  const sendCommand = vi.fn(
    async (action: string, payload: Record<string, unknown>): Promise<Ack> => {
      calls.push({ action, payload });
      if (action !== 'prepare_reticulum_resource_session') return { ok: true };
      const queued = acks.shift();
      if (queued) return queued;
      nextLink += 1;
      return {
        ok: true,
        payload: {
          linkId: `link-${nextLink}`,
          lane: payload.lane,
          status: 'establishing',
        },
      };
    }
  );
  const bridge = new MobileReticulumBridge(sendCommand);
  bridge.markReady({});
  const prepares = () =>
    calls.filter((c) => c.action === 'prepare_reticulum_resource_session');
  const sessionEvent = (state: Record<string, unknown>) =>
    bridge.dispatchPythonEvent('reticulum_resource_session', state);
  return { bridge, sendCommand, acks, prepares, sessionEvent };
}

const ensure = (
  bridge: MobileReticulumBridge,
  peerPresenceHash: string,
  logicalResourceType?: string,
  resourceType = 'reticulum_chat_event'
) =>
  bridge.ensureReticulumResourceSessionDetailed({
    peerPresenceHash,
    reticulumIdentityPublicKeyBase64: IDENTITY,
    resourceType,
    ...(logicalResourceType ? { logicalResourceType } : {}),
  });

/** Lets the command acks settle so session events match their link. */
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('MobileReticulumBridge resource sessions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prepares a group history session while a DM-page prepare is pending', async () => {
    const { bridge, prepares, sessionEvent } = makeBridge();
    let dmSettled = false;
    const dm = ensure(bridge, PEER_B, 'reticulum_chat_dm_page').then((r) => {
      dmSettled = true;
      return r;
    });
    await flush();
    expect(prepares()).toHaveLength(1);

    const history = ensure(bridge, PEER_C, 'reticulum_chat_history_page');
    await flush();
    expect(prepares()).toHaveLength(2);
    expect(prepares()[1].payload).toMatchObject({
      peerPresenceHash: PEER_C,
      logicalResourceType: 'reticulum_chat_history_page',
      lane: 'bulk',
    });

    sessionEvent({
      peerPresenceHash: PEER_C,
      lane: 'bulk',
      linkId: 'link-2',
      status: 'ready',
    });
    await expect(history).resolves.toEqual({ ok: true });
    expect(dmSettled).toBe(false);

    sessionEvent({
      peerPresenceHash: PEER_B,
      lane: 'fast',
      linkId: 'link-1',
      status: 'ready',
    });
    await expect(dm).resolves.toEqual({ ok: true });
  });

  it('joins a live-event request to the pending DM-page prepare on the same fast lane', async () => {
    const { bridge, prepares, sessionEvent } = makeBridge();
    const dm = ensure(bridge, PEER_B, 'reticulum_chat_dm_page');
    await flush();
    const live = ensure(bridge, PEER_B, 'reticulum_chat_live_event');
    await flush();

    expect(prepares()).toHaveLength(1);
    expect(prepares()[0].payload).toMatchObject({
      peerPresenceHash: PEER_B,
      lane: 'fast',
    });

    sessionEvent({
      peerPresenceHash: PEER_B.toUpperCase(),
      lane: 'fast',
      linkId: 'link-1',
      status: 'ready',
    });
    await expect(dm).resolves.toEqual({ ok: true });
    await expect(live).resolves.toEqual({ ok: true });

    // The finished preparation is dropped, so the next request asks python again.
    const again = ensure(bridge, PEER_B, 'reticulum_chat_live_event');
    await flush();
    expect(prepares()).toHaveLength(2);
    sessionEvent({
      peerPresenceHash: PEER_B,
      lane: 'fast',
      linkId: 'link-2',
      status: 'ready',
    });
    await expect(again).resolves.toEqual({ ok: true });
  });

  it('reports sessions in flight and their outcomes', async () => {
    const { bridge, sessionEvent } = makeBridge();
    expect(bridge.getResourceSessionStats()).toEqual({
      inFlight: {},
      oldestInFlightMs: null,
      oldestInFlightType: null,
      results: {},
    });

    const dm = ensure(bridge, PEER_B, 'reticulum_chat_dm_page');
    await flush();
    vi.advanceTimersByTime(1_500);
    const live = ensure(bridge, PEER_B, 'reticulum_chat_live_event');
    const attachment = ensure(bridge, PEER_C, undefined, 'reticulum_resource');
    const history = ensure(bridge, PEER_C, 'reticulum_chat_history_page');
    await flush();
    vi.advanceTimersByTime(500);

    expect(bridge.getResourceSessionStats()).toEqual({
      inFlight: {
        reticulum_chat_dm_page: 1,
        reticulum_chat_live_event: 1,
        reticulum_resource: 1,
        reticulum_chat_history_page: 1,
      },
      oldestInFlightMs: 2_000,
      oldestInFlightType: 'reticulum_chat_dm_page',
      results: {},
    });

    sessionEvent({
      peerPresenceHash: PEER_B,
      lane: 'fast',
      linkId: 'link-1',
      status: 'ready',
    });
    sessionEvent({
      peerPresenceHash: PEER_C,
      lane: 'bulk',
      linkId: 'link-2',
      status: 'failed',
      reason: 'resource_session_backoff',
    });
    await Promise.all([dm, live, attachment, history]);

    expect(bridge.getResourceSessionStats()).toEqual({
      inFlight: {},
      oldestInFlightMs: null,
      oldestInFlightType: null,
      results: {
        'reticulum_chat_dm_page:ok': 1,
        'reticulum_chat_live_event:ok': 1,
        'reticulum_resource:no-route': 1,
        'reticulum_chat_history_page:no-route': 1,
      },
    });

    const slow = ensure(bridge, PEER_C, 'reticulum_chat_metadata_snapshot');
    await flush();
    vi.advanceTimersByTime(32_000);
    await expect(slow).resolves.toMatchObject({
      ok: false,
      reason: 'bridge-timeout',
    });
    expect(
      bridge.getResourceSessionStats().results[
        'reticulum_chat_metadata_snapshot:bridge-timeout'
      ]
    ).toBe(1);
  });

  it('caps the number of distinct outcome keys', async () => {
    const { bridge } = makeBridge();
    for (let i = 0; i < 100; i += 1) {
      await ensure(bridge, '', `type_${i}`);
    }
    const { results } = bridge.getResourceSessionStats();
    expect(Object.keys(results)).toHaveLength(64);
    expect(results['type_0:unknown-peer-presence-hash']).toBe(1);
    expect(results.other).toBe(100 - 63);
  });

  it('still maps a python queue-full reply to bridge-overloaded', async () => {
    const { bridge, acks } = makeBridge();
    acks.push({
      ok: false,
      error: 'scheduler queue full',
      payload: { code: 'scheduler_queue_full' },
    });
    await expect(
      ensure(bridge, PEER_C, 'reticulum_chat_history_page')
    ).resolves.toEqual({
      ok: false,
      reason: 'bridge-overloaded',
      error: 'scheduler queue full',
    });
    expect(bridge.getResourceSessionStats().results).toEqual({
      'reticulum_chat_history_page:bridge-overloaded': 1,
    });
  });
});
