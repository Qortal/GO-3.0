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
  const acks: Array<Ack | Error> = [];
  let nextLink = 0;
  const sendCommand = vi.fn(
    async (action: string, payload: Record<string, unknown>): Promise<Ack> => {
      calls.push({ action, payload });
      if (action !== 'prepare_reticulum_resource_session') return { ok: true };
      const queued = acks.shift();
      // A queued Error is the worker's own command timeout (no ack at all).
      if (queued instanceof Error) throw queued;
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
        'reticulum_chat_metadata_snapshot:ready-timeout'
      ]
    ).toBe(1);
  });

  it('counts a command-ack timeout apart from a ready timeout', async () => {
    const { bridge, acks } = makeBridge();
    acks.push(
      new Error(
        'worker->native request timed out: prepare_reticulum_resource_session'
      )
    );
    await expect(
      ensure(bridge, PEER_C, 'reticulum_chat_author_range')
    ).resolves.toEqual({
      ok: false,
      reason: 'bridge-timeout',
      error:
        'worker->native request timed out: prepare_reticulum_resource_session',
    });
    const { results } = bridge.getResourceSessionStats();
    expect(results).toEqual({ 'reticulum_chat_author_range:ack-timeout': 1 });
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

describe('MobileReticulumBridge overlay availability', () => {
  const linkState = (
    bridge: MobileReticulumBridge,
    linkId: string,
    peerPresenceHash: string,
    state: { established: boolean; overlayTransportAdmitted?: boolean }
  ) =>
    bridge.dispatchPythonEvent('overlay_link_state', {
      linkId,
      peerPresenceHash,
      ...state,
    });

  it('fires once when the first link is admitted and once when the last one goes', () => {
    const { bridge } = makeBridge();
    const changes: boolean[] = [];
    bridge.on('overlay-availability', ({ available }) => {
      changes.push(available);
    });

    // Established but not yet admitted: python would refuse to send on it.
    linkState(bridge, 'l1', PEER_B, { established: true });
    expect(bridge.hasAdmittedOverlayLink()).toBe(false);
    linkState(bridge, 'l1', PEER_B, {
      established: true,
      overlayTransportAdmitted: true,
    });
    linkState(bridge, 'l2', PEER_C, {
      established: true,
      overlayTransportAdmitted: true,
    });
    // Later ping/pong snapshots of a live link change nothing.
    linkState(bridge, 'l1', PEER_B, {
      established: true,
      overlayTransportAdmitted: true,
    });
    expect(changes).toEqual([true]);

    linkState(bridge, 'l1', PEER_B, { established: false });
    expect(bridge.hasAdmittedOverlayLink()).toBe(true);
    linkState(bridge, 'l2', PEER_C, { established: false });
    expect(bridge.hasAdmittedOverlayLink()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('reports the loss when python stops with links up', () => {
    const { bridge } = makeBridge();
    const changes: boolean[] = [];
    bridge.on('overlay-availability', ({ available }) => {
      changes.push(available);
    });
    bridge.markStopped();
    expect(changes).toEqual([]);
    linkState(bridge, 'l1', PEER_B, {
      established: true,
      overlayTransportAdmitted: true,
    });
    bridge.markStopped();
    expect(changes).toEqual([true, false]);
    expect(bridge.hasAdmittedOverlayLink()).toBe(false);
  });
});

describe('MobileReticulumBridge chat fanout', () => {
  const wire = { t: 'RCHAT', k: 'dm_probe' };

  it('passes the bounded gossip width and selection key to python', async () => {
    const { bridge, sendCommand } = makeBridge();
    await expect(
      bridge.fanoutReticulumChatDetailed([wire], [PEER_B], {
        maxPeerCount: 4,
        selectionKey: 'group-sub:abc:1',
      })
    ).resolves.toEqual({ ok: true });
    expect(sendCommand).toHaveBeenCalledWith(
      'fanout_reticulum_chat',
      {
        messages: [wire],
        excludePeerPresenceHashes: [PEER_B],
        maxPeerCount: 4,
        selectionKey: 'group-sub:abc:1',
      },
      undefined
    );
  });

  it('keeps a full fanout when no usable width is given', async () => {
    const { bridge, sendCommand } = makeBridge();
    await bridge.fanoutReticulumChatDetailed([wire]);
    await bridge.fanoutReticulumChatDetailed([wire], [], {
      maxPeerCount: 0,
      selectionKey: '',
    });
    await bridge.fanoutReticulumChatDetailed([wire], [], {
      maxPeerCount: 2.5,
    });
    for (const [, payload] of sendCommand.mock.calls) {
      expect(payload).toEqual({
        messages: [wire],
        excludePeerPresenceHashes: [],
      });
    }
    expect(sendCommand).toHaveBeenCalledTimes(3);
  });
});

describe('MobileReticulumBridge serving stats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const META = { logicalResourceType: 'reticulum_chat_history_page' };

  function makeServingBridge() {
    const replies = new Map<string, Ack[]>();
    const sendCommand = vi.fn(async (action: string): Promise<Ack> => {
      return replies.get(action)?.shift() ?? { ok: true };
    });
    const bridge = new MobileReticulumBridge(sendCommand);
    bridge.markReady({});
    const reply = (action: string, ack: Ack) =>
      replies.set(action, [...(replies.get(action) ?? []), ack]);
    const auth = (transferId: string, extra: Record<string, unknown> = {}) =>
      bridge.dispatchPythonEvent('reticulum_chat_resource', {
        status: 'auth',
        transferId,
        resourceType: 'reticulum_chat_event',
        metadata: META,
        ...extra,
      });
    const authorize = (transferId: string) =>
      bridge.authorizeReticulumChatResourceDetailed({
        linkId: 'link-1',
        transferId,
      });
    return { bridge, reply, auth, authorize, sendCommand };
  }

  it('counts requests, answers, late answers and step times per type', async () => {
    const { bridge, reply, auth, authorize } = makeServingBridge();
    vi.setSystemTime(1_500);
    auth('t1', {
      arrivedAtMs: 1_000,
      authStartedAtMs: 1_020,
      _workerRecvAtMs: 1_500,
    });
    vi.setSystemTime(4_000);
    reply('authorize_reticulum_chat_resource', { ok: true });
    await expect(authorize('t1')).resolves.toEqual({ ok: true });

    // Python gave up before the answer: the authorize fails and is late.
    auth('t2');
    bridge.dispatchPythonEvent('reticulum_chat_resource', {
      status: 'auth_ended',
      transferId: 't2',
      reason: 'resource_authorization_timeout',
      metadata: META,
    });
    reply('authorize_reticulum_chat_resource', {
      ok: false,
      payload: { code: 'unknown_resource_request' },
    });
    await expect(authorize('t2')).resolves.toEqual({
      ok: false,
      reason: 'send-command-failed',
    });

    // An answer for a request this bridge never saw changes nothing.
    await expect(authorize('t9')).resolves.toEqual({ ok: true });

    auth('t3');
    await expect(
      bridge.rejectReticulumChatResourceDetailed({
        linkId: 'link-1',
        transferId: 't3',
        reason: 'no_history_events',
      })
    ).resolves.toEqual({ ok: true });

    const stats = bridge.getServingStats();
    expect(stats.byType).toEqual({
      reticulum_chat_history_page: {
        received: 3,
        authorized: 1,
        rejected: 1,
        failed: 1,
        late: 1,
        ended: 1,
      },
    });
    expect(stats.endedReasons).toEqual({ resource_authorization_timeout: 1 });
    expect(stats.failedReasons).toEqual({ unknown_resource_request: 1 });
    expect(stats.totalMs?.max).toBe(3_000);
    expect(stats.engineMs?.max).toBe(2_500);
    expect(stats.pythonMs?.max).toBe(20);
    expect(stats.toWorkerMs?.max).toBe(480);
    expect(stats.waiting).toBe(0);
    expect(stats.oldestWaitingMs).toBeNull();
  });

  it('reports requests still waiting for an answer', () => {
    const { bridge, auth } = makeServingBridge();
    vi.setSystemTime(10_000);
    auth('t1');
    vi.setSystemTime(12_500);
    auth('t2');
    // Re-sent auth for the same transfer replaces the earlier one.
    auth('t2');
    expect(bridge.getServingStats(13_000)).toMatchObject({
      waiting: 2,
      oldestWaitingMs: 3_000,
      byType: { reticulum_chat_history_page: { received: 3 } },
    });
    // Ignored past the two-minute bookkeeping window.
    expect(bridge.getServingStats(10_000 + 130_000).waiting).toBe(0);
  });

  it('counts an answer that failed in the bridge by its reason', async () => {
    const { bridge, auth } = makeServingBridge();
    auth('t1');
    bridge.markStopped();
    await expect(
      bridge.authorizeReticulumChatResourceDetailed({
        linkId: 'l',
        transferId: 't1',
      })
    ).resolves.toEqual({ ok: false, reason: 'bridge-not-ready' });
    expect(bridge.getServingStats()).toMatchObject({
      byType: { reticulum_chat_history_page: { failed: 1, late: 0 } },
      failedReasons: { 'bridge-not-ready': 1 },
    });
  });

  it('still hands every resource event to the engine unchanged', () => {
    const { bridge } = makeServingBridge();
    const seen: unknown[] = [];
    bridge.on('reticulum-chat-resource', (p) => seen.push(p));
    const odd = { status: 'auth', transferId: 7, metadata: 'x' };
    bridge.dispatchPythonEvent('reticulum_chat_resource', odd);
    expect(seen).toEqual([odd]);
    expect(bridge.getServingStats().byType).toEqual({});
  });
});
