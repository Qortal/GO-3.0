import { describe, expect, it, vi } from 'vitest';
import { Buffer as PolyBuffer } from 'buffer';
import {
  MobileReticulumBridgeAdapter,
  mapPythonSendFailureReason,
} from './mobileReticulumBridgeAdapter';
import type {
  HubCallPythonTransport,
  OutboundAudioFrame,
  PythonEventFrame,
  PythonRespFrame,
} from './pythonTransport';

const LOCAL = 'a'.repeat(32);
const PEER = 'b'.repeat(32);
const OTHER = 'c'.repeat(32);

class ScriptedTransport implements HubCallPythonTransport {
  ready = true;
  readonly results: Array<{
    action: string;
    payload: Record<string, unknown>;
  }> = [];
  readonly fireAndForget: Array<{
    action: string;
    payload: Record<string, unknown>;
  }> = [];
  respond: (
    action: string,
    payload: Record<string, unknown>
  ) => PythonRespFrame | Promise<PythonRespFrame> = () => ({ ok: true });
  private listeners = new Set<(frame: PythonEventFrame) => void>();
  private readyListeners = new Set<(ready: boolean) => void>();
  sendAudioFrames?: (frames: OutboundAudioFrame[]) => boolean;

  async commandWithResult(action: string, payload: Record<string, unknown>) {
    this.results.push({ action, payload });
    return this.respond(action, payload);
  }
  async command(action: string, payload: Record<string, unknown>) {
    this.fireAndForget.push({ action, payload });
  }
  onEvent(cb: (frame: PythonEventFrame) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  isReady() {
    return this.ready;
  }
  onReadyChange(cb: (ready: boolean) => void) {
    this.readyListeners.add(cb);
    return () => this.readyListeners.delete(cb);
  }
  getLocalDestinationHash() {
    return LOCAL;
  }
  emit(event: string, payload: unknown) {
    for (const cb of this.listeners) cb({ type: 'event', event, payload });
  }
  setReady(ready: boolean) {
    this.ready = ready;
    for (const cb of this.readyListeners) cb(ready);
  }
}

function make(options = {}) {
  const transport = new ScriptedTransport();
  const adapter = new MobileReticulumBridgeAdapter(transport, options);
  adapter.attach();
  return { transport, adapter };
}

describe('MobileReticulumBridgeAdapter (ReticulumBridge subset on GO python)', () => {
  it('maps Python resp codes exactly like reticulum-bridge.ts', () => {
    const cases: Array<[string | undefined, string | undefined, string]> = [
      ['bridge_overloaded', undefined, 'bridge-overloaded'],
      ['scheduler_queue_full', undefined, 'bridge-overloaded'],
      ['bridge_not_started', undefined, 'bridge-not-started'],
      ['unknown_peer_presence_hash', undefined, 'unknown-peer-presence-hash'],
      ['wire_too_large', undefined, 'wire-too-large'],
      ['packet_send_false', undefined, 'packet-send-false'],
      ['no_route', undefined, 'no-route'],
      ['no_established_route', undefined, 'no-route'],
      ['unknown_link_id', undefined, 'unknown-link-id'],
      ['audio_link_not_ready', undefined, 'audio-link-not-ready'],
      ['audio_payload_too_large', undefined, 'audio-payload-too-large'],
      [undefined, 'Reticulum bridge is not running', 'bridge-unavailable'],
      ['control_channel_not_ready', undefined, 'send-command-failed'],
      [undefined, 'Unknown action: x', 'send-command-failed'],
    ];
    for (const [code, error, expected] of cases) {
      expect(
        mapPythonSendFailureReason({
          ok: false,
          ...(code ? { payload: { code } } : {}),
          ...(error ? { error } : {}),
        })
      ).toBe(expected);
    }
  });

  it('sends call / group-call wires with the desktop command names and payloads', async () => {
    const { transport, adapter } = make();
    const wire = { t: 'CA', c: 'call', k: 'pk', g: 'sig', m: 1 };
    expect(await adapter.sendCallDetailed(PEER, wire)).toEqual({ ok: true });
    expect(await adapter.sendGroupCallDetailed(PEER, { t: 'GJ' })).toEqual({
      ok: true,
    });
    expect(await adapter.fanoutCallDetailed([{ t: 'CH' }])).toEqual({
      ok: true,
    });
    expect(await adapter.fanoutGroupCallDetailed([{ t: 'GJ' }])).toEqual({
      ok: true,
    });
    expect(transport.results.map((r) => [r.action, r.payload])).toEqual([
      ['send_call', { peerPresenceHash: PEER, message: wire }],
      ['send_group_call', { peerPresenceHash: PEER, message: { t: 'GJ' } }],
      [
        'fanout_call',
        { messages: [{ t: 'CH' }], excludePeerPresenceHashes: [] },
      ],
      [
        'fanout_group_call',
        { messages: [{ t: 'GJ' }], excludePeerPresenceHashes: [] },
      ],
    ]);
    expect(await adapter.fanoutCallDetailed([])).toMatchObject({
      ok: false,
      reason: 'wire-too-large',
    });
  });

  it('returns failures, not-ready and timeouts as ReticulumSendResult', async () => {
    const { transport, adapter } = make();
    transport.respond = () => ({
      ok: false,
      payload: { code: 'no_route' },
      error: 'x',
    });
    expect(await adapter.sendCallDetailed(PEER, {})).toEqual({
      ok: false,
      reason: 'no-route',
      error: 'x',
    });
    transport.respond = () => {
      throw new Error('Reticulum command timed out: send_call');
    };
    expect(await adapter.sendCallDetailed(PEER, {})).toMatchObject({
      ok: false,
      reason: 'bridge-timeout',
    });
    transport.respond = () => {
      throw new Error('boom');
    };
    expect(await adapter.sendCallDetailed(PEER, {})).toMatchObject({
      ok: false,
      reason: 'bridge-exception',
    });
    transport.ready = false;
    expect(adapter.getState()).toBe('starting');
    expect(await adapter.sendCallDetailed(PEER, {})).toEqual({
      ok: false,
      reason: 'bridge-not-ready',
    });
    expect(
      adapter.enqueueGroupAudio('l', 'r', PolyBuffer.from([1, 2, 3]), PEER)
    ).toEqual({ ok: false, reason: 'bridge-not-ready' });
    expect(await adapter.openGroupAudioLink(PEER)).toEqual({
      ok: false,
      reason: 'bridge-not-ready',
    });
    expect(await adapter.registerPeerIdentityFromGroupJoin(PEER, 'rk')).toBe(
      false
    );
  });

  it('drops relays of other people’s overlay frames unless enabled', async () => {
    const { transport, adapter } = make();
    // call.ts relay: exclusion list = transport peer.
    expect(
      await adapter.fanoutCallDetailed([{ t: 'CR', r: PEER, L: 3 }], [PEER])
    ).toEqual({
      ok: true,
    });
    // group-call.ts relay without transport hash: foreign `r` only.
    expect(
      await adapter.fanoutGroupCallDetailed([{ t: 'GJ', r: OTHER }])
    ).toEqual({
      ok: true,
    });
    expect(transport.results).toHaveLength(0);
    expect(adapter.stats.relaysSuppressed).toBe(2);
    // Our own route-bound `r` (call.ts puts it on CR) is not a relay.
    await adapter.fanoutCallDetailed([{ t: 'CH', r: LOCAL }]);
    expect(transport.results.map((r) => r.action)).toEqual(['fanout_call']);
    adapter.setRelayOverlayFrames(true);
    await adapter.fanoutCallDetailed([{ t: 'CR', r: PEER, L: 3 }], [PEER]);
    expect(transport.results[transport.results.length - 1]).toEqual({
      action: 'fanout_call',
      payload: {
        messages: [{ t: 'CR', r: PEER, L: 3 }],
        excludePeerPresenceHashes: [PEER],
      },
    });
  });

  it('sends a pinned copy of a local CALL_REQUEST to each known endpoint (same X and L as the flood)', async () => {
    const { transport, adapter } = make();
    adapter.setPinnedCallRequestEndpoints((address) =>
      address === 'Qcallee' ? [PEER, OTHER, LOCAL, 'not-a-hash'] : []
    );
    const cr = { t: 'CR', c: 'id', U: 'Qcallee', L: 4, X: 'abcd' };
    await adapter.fanoutCallDetailed([cr]);
    await Promise.resolve();
    const pinned = transport.results.filter((r) => r.action === 'send_call');
    expect(pinned.map((r) => r.payload)).toEqual([
      { peerPresenceHash: PEER, message: cr },
      { peerPresenceHash: OTHER, message: cr },
    ]);
    // The callee device that sees the pinned copy first re-floods it like a
    // flood copy (call.ts relays when L > 0); X still dedupes the second copy.
    expect(
      pinned.every((r) => (r.payload.message as { L?: number }).L === 4)
    ).toBe(true);
    expect(
      transport.results.find((r) => r.action === 'fanout_call')?.payload
    ).toEqual({ messages: [cr], excludePeerPresenceHashes: [] });
    // Not for other frame types.
    transport.results.length = 0;
    await adapter.fanoutCallDetailed([{ t: 'CH', U: 'Qcallee', X: 'x', L: 4 }]);
    expect(transport.results.map((r) => r.action)).toEqual(['fanout_call']);
  });

  it('enqueues audio-link frames synchronously; control frames bypass the 320 ms deadline', () => {
    const { transport, adapter } = make();
    const media = PolyBuffer.from([9, 8, 7, 6]);
    const control = PolyBuffer.concat([
      PolyBuffer.from('QGCCTL1\0', 'utf8'),
      PolyBuffer.from('{"t":"GJ"}', 'utf8'),
    ]);
    const before = Date.now();
    const r1 = adapter.enqueueGroupAudio(
      'link1',
      'dmv:x',
      media,
      PEER.toUpperCase(),
      PEER
    );
    const r2 = adapter.enqueueGroupAudio('link1', 'dmv:x', control, PEER, PEER);
    const r3 = adapter.enqueuePacketGroupAudio(PEER, 'room', media);
    expect(r1).toMatchObject({
      ok: true,
      dropped: false,
      queuePressureDrops: 0,
    });
    expect(r2.ok && r3.ok).toBe(true);
    expect(adapter.enqueuePacketGroupAudio('', 'room', media)).toEqual({
      ok: false,
      reason: 'unknown-peer-presence-hash',
    });
    expect(adapter.enqueueGroupAudio('l', 'r', 'nope' as never)).toEqual({
      ok: false,
      reason: 'audio-enqueue-failed',
    });
    const sent = transport.fireAndForget.map((c) => c.payload);
    expect(
      transport.fireAndForget.every((c) => c.action === 'send_group_audio')
    ).toBe(true);
    expect(sent[0]).toMatchObject({
      linkId: 'link1',
      roomId: 'dmv:x',
      peerPresenceHash: PEER,
      peerDestinationHash: PEER,
      data: media.toString('base64'),
    });
    expect(sent[0].receivedAtWallMs as number).toBeGreaterThanOrEqual(before);
    expect(sent[1]).toMatchObject({
      receivedAtWallMs: 0,
      data: control.toString('base64'),
    });
    expect(sent[2]).toMatchObject({ linkId: '', peerPresenceHash: PEER });
    expect(adapter.stats).toMatchObject({
      audioFramesSent: 2,
      controlFramesSent: 1,
    });
  });

  it("media frames carry the manager's queued-at stamp as receivedAtWallMs (desktop parity)", () => {
    const { transport, adapter } = make();
    const QUEUED_AT = Symbol.for('qortal.reticulumAudioQueuedAtMs');
    const queuedAt = Date.now() - 250;
    const stamped = PolyBuffer.from([1, 2, 3]);
    Object.defineProperty(stamped, QUEUED_AT, {
      value: queuedAt,
      enumerable: false,
    });
    const bogus = PolyBuffer.from([4, 5, 6]);
    Object.defineProperty(bogus, QUEUED_AT, { value: -1, enumerable: false });
    const control = PolyBuffer.concat([
      PolyBuffer.from('QGCCTL1\0', 'utf8'),
      PolyBuffer.from('{"t":"GK"}', 'utf8'),
    ]);
    Object.defineProperty(control, QUEUED_AT, {
      value: queuedAt,
      enumerable: false,
    });
    const before = Date.now();
    adapter.enqueueGroupAudio('link1', 'gcall-qortal-1', stamped, PEER, PEER);
    adapter.enqueuePacketGroupAudio(PEER, 'gcall-qortal-1', stamped);
    adapter.enqueueGroupAudio('link1', 'gcall-qortal-1', bogus, PEER, PEER);
    adapter.enqueueGroupAudio('link1', 'gcall-qortal-1', control, PEER, PEER);
    const sent = transport.fireAndForget.map((c) => c.payload);
    expect(sent[0].receivedAtWallMs).toBe(queuedAt);
    expect(sent[1].receivedAtWallMs).toBe(queuedAt);
    // Invalid stamp → bridge enqueue time (reticulum-bridge.ts fallback).
    expect(sent[2].receivedAtWallMs as number).toBeGreaterThanOrEqual(before);
    // Control frames stay exempt from the media deadline.
    expect(sent[3].receivedAtWallMs).toBe(0);
  });

  it('batches audio frames through sendAudioFrames when the transport offers it', async () => {
    const { transport, adapter } = make();
    const batches: OutboundAudioFrame[][] = [];
    transport.sendAudioFrames = (frames) => {
      batches.push(frames);
      return true;
    };
    for (let i = 0; i < 3; i++) {
      adapter.enqueueGroupAudio('link', 'room', PolyBuffer.from([i]), PEER);
    }
    expect(batches).toHaveLength(0);
    await Promise.resolve();
    expect(batches).toHaveLength(1);
    expect(batches[0].map((f) => f.data)).toEqual(['AA==', 'AQ==', 'Ag==']);
    // Fast path refuses → per-frame commands.
    transport.sendAudioFrames = () => false;
    adapter.enqueueGroupAudio('link', 'room', PolyBuffer.from([5]), PEER);
    await Promise.resolve();
    expect(transport.fireAndForget.map((c) => c.action)).toEqual([
      'send_group_audio',
    ]);
  });

  it('link control, heartbeat, open/close/reset/warm/register/forwarding commands', async () => {
    const { transport, adapter } = make();
    transport.respond = (action) =>
      action === 'open_group_audio_link'
        ? { ok: true, payload: { linkId: 'L1', established: true } }
        : action === 'warm_group_audio_path'
          ? { ok: true, payload: { pathState: 'known', ready: true } }
          : { ok: true };
    expect(
      await adapter.sendGroupAudioLinkControlDetailed({
        roomId: 'dmv:x',
        payload: PolyBuffer.from([1, 2, 3]),
        signalType: 'offer',
        signalId: 'sid',
        callSessionId: 'sess',
        linkId: ' L1 ',
        peerPresenceHash: PEER.toUpperCase(),
      })
    ).toEqual({ ok: true });
    expect(
      await adapter.sendGroupAudioLinkControlDetailed({
        roomId: 'dmv:x',
        payload: PolyBuffer.alloc(0),
        signalType: 'offer',
        signalId: 'sid',
        callSessionId: 'sess',
        linkId: 'L1',
      })
    ).toMatchObject({ ok: false, error: 'Missing control payload' });
    expect(
      await adapter.sendGroupAudioLinkHeartbeatDetailed({
        roomId: 'dmv:x',
        command: 'PONG',
        seq: 4,
        linkId: 'L1',
        peerPresenceHash: PEER,
        packetRxAgeMs: 12,
        packetRxRecent: true,
      })
    ).toEqual({ ok: true });
    expect(
      await adapter.sendGroupAudioLinkHeartbeatDetailed({
        roomId: 'r',
        command: 'PING',
      })
    ).toMatchObject({ ok: false, error: 'Missing linkId or peerPresenceHash' });
    expect(
      await adapter.openGroupAudioLink(PEER, { activeCall: true })
    ).toEqual({
      ok: true,
      linkId: 'L1',
      established: true,
    });
    expect(await adapter.closeGroupAudioLink('L1', 'duplicate-audio')).toEqual({
      ok: true,
    });
    expect(
      await adapter.resetGroupAudioPeerState(` ${PEER.toUpperCase()} `, 'why')
    ).toEqual({
      ok: true,
    });
    expect(await adapter.warmGroupAudioPath(PEER)).toEqual({
      ok: true,
      pathState: 'known',
      ready: true,
    });
    expect(await adapter.registerPeerIdentityFromGroupJoin(PEER, 'rk')).toBe(
      true
    );
    expect(await adapter.configureGroupAudioForwarding([])).toEqual({
      ok: true,
    });
    expect(await adapter.clearGroupAudioDiagnostics('room')).toEqual({
      ok: true,
    });
    expect(transport.results.map((r) => [r.action, r.payload])).toEqual([
      [
        'send_group_audio_link_control',
        {
          roomId: 'dmv:x',
          payload: 'AQID',
          signalType: 'offer',
          signalId: 'sid',
          callSessionId: 'sess',
          linkId: 'L1',
          peerPresenceHash: PEER,
        },
      ],
      [
        'send_group_audio_link_heartbeat',
        {
          roomId: 'dmv:x',
          command: 'PONG',
          seq: 4,
          linkId: 'L1',
          peerPresenceHash: PEER,
          packetRxAgeMs: 12,
          packetRxRecent: true,
        },
      ],
      ['open_group_audio_link', { peerPresenceHash: PEER, activeCall: true }],
      ['close_group_audio_link', { linkId: 'L1', reason: 'duplicate-audio' }],
      [
        'reset_group_audio_peer_state',
        { peerPresenceHash: PEER, reason: 'why' },
      ],
      ['warm_group_audio_path', { peerPresenceHash: PEER }],
      [
        'register_peer_identity',
        { peerPresenceHash: PEER, reticulumIdentityPublicKeyBase64: 'rk' },
      ],
      ['configure_group_audio_forwarding', { plans: [] }],
      ['clear_group_audio_diagnostics', { roomId: 'room' }],
    ]);
    transport.respond = () => ({ ok: true, payload: {} });
    expect(await adapter.openGroupAudioLink(PEER)).toMatchObject({
      ok: false,
      reason: 'send-command-failed',
    });
  });

  it('keeps the audio data plane off unless enabled', async () => {
    const off = make();
    expect(await off.adapter.getGroupAudioDataPlaneSession([])).toEqual({
      ok: false,
      reason: 'audio-data-plane-disabled',
    });
    const on = make({ audioDataPlane: true });
    on.transport.respond = (action) =>
      action === 'get_group_audio_data_plane_session'
        ? {
            ok: true,
            payload: { endpoint: 'ws://127.0.0.1:1/gcall-audio', token: 't' },
          }
        : { ok: true, payload: { routeCount: 1 } };
    const routes = [{ address: 'Q', transport: 'link' as const, linkId: 'L' }];
    expect(await on.adapter.getGroupAudioDataPlaneSession(routes)).toEqual({
      ok: true,
      endpoint: 'ws://127.0.0.1:1/gcall-audio',
      token: 't',
      version: 2,
      routeCount: 1,
      routes,
    });
  });

  it('re-emits Python events with the desktop bridge argument shapes', () => {
    const { transport, adapter } = make();
    const seen: unknown[][] = [];
    for (const event of [
      'call-message',
      'group-call-message',
      'group-audio-packet',
      'group-audio-link-established',
      'group-audio-link-closed',
      'group-audio-send-failed',
      'group-audio-fast-path-activity',
    ]) {
      adapter.on(event, (...args: unknown[]) => seen.push([event, ...args]));
    }
    transport.emit('call_message', {
      wire: { t: 'CR' },
      senderDestinationHash: PEER,
      peerPresenceHash: OTHER,
    });
    transport.emit('group_call_message', {
      wire: { t: 'GAC' },
      senderDestinationHash: PEER,
      peerPresenceHash: PEER,
      linkId: 'L1',
    });
    transport.emit('group_audio_packet', {
      linkId: 'L1',
      roomId: 'dmv:x',
      peerPresenceHash: PEER,
      peerDestinationHash: PEER,
      receivedAtWallMs: 123,
      data: 'AQID',
    });
    transport.emit('group_audio_packet', {
      frames: [
        { linkId: '', roomId: 'g', peerPresenceHash: PEER, data: 'BA==' },
        { linkId: 'L2', roomId: 'g', peerPresenceHash: PEER, data: '' },
      ],
    });
    transport.emit('group_audio_link_established', {
      linkId: 'L1',
      peerPresenceHash: PEER,
      peerDestinationHash: PEER,
      incoming: true,
      managerState: 'x',
    });
    transport.emit('group_audio_link_closed', { linkId: 'L1', reason: 'gone' });
    transport.emit('group_audio_send_failed', {
      linkId: 'L1',
      code: 'unknown_link_id',
    });
    transport.emit('group_audio_fast_path_activity', {
      roomId: 'g',
      sourceAddress: 'Q',
      forwardedTargets: 2,
      receivedAtWallMs: 5,
    });
    transport.emit('call_message', { wire: 'not-an-object' });
    transport.emit('group_audio_link_closed', {});

    const [call, group, audio1, audio2, established, closed, failed, fast] =
      seen;
    expect(call).toEqual(['call-message', { t: 'CR' }, PEER, OTHER]);
    expect(group).toEqual([
      'group-call-message',
      { t: 'GAC' },
      PEER,
      PEER,
      'L1',
    ]);
    expect(audio1[0]).toBe('group-audio-packet');
    expect(audio1[1]).toMatchObject({
      linkId: 'L1',
      routeKey: 'L1',
      transport: 'link',
      roomId: 'dmv:x',
      peerPresenceHash: PEER,
      peerDestinationHash: PEER,
      receivedAtWallMs: 123,
      incoming: true,
    });
    const data = (audio1[1] as { data: Uint8Array }).data;
    expect(Array.from(data)).toEqual([1, 2, 3]);
    // Built with the global Buffer, which is what group-call.ts tests with.
    expect(
      (globalThis as { Buffer: typeof Buffer }).Buffer.isBuffer(data)
    ).toBe(true);
    expect(audio2[1]).toMatchObject({
      linkId: '',
      routeKey: `packet:${PEER}`,
      transport: 'packet',
    });
    expect(audio2[1]).not.toHaveProperty('receivedAtWallMs');
    expect(established).toEqual([
      'group-audio-link-established',
      {
        linkId: 'L1',
        peerPresenceHash: PEER,
        peerDestinationHash: PEER,
        incoming: true,
      },
    ]);
    expect(closed).toEqual([
      'group-audio-link-closed',
      {
        linkId: 'L1',
        peerPresenceHash: '',
        peerDestinationHash: '',
        incoming: false,
        reason: 'gone',
      },
    ]);
    expect(failed).toEqual([
      'group-audio-send-failed',
      {
        linkId: 'L1',
        peerPresenceHash: '',
        transport: 'link',
        reason: '',
        code: 'unknown_link_id',
        error: '',
        pathState: '',
      },
    ]);
    expect(fast).toEqual([
      'group-audio-fast-path-activity',
      {
        roomId: 'g',
        sourceAddress: 'Q',
        linkId: '',
        peerPresenceHash: '',
        peerDestinationHash: '',
        forwardedTargets: 2,
        receivedAtWallMs: 5,
      },
    ]);
    expect(seen).toHaveLength(8);
    expect(adapter.getAudioQueueSnapshot().packetSendFailures).toBe(1);
  });

  it('forwards readiness changes and stops listening on detach', () => {
    const { transport, adapter } = make();
    const ready = vi.fn();
    adapter.onReadyChange(ready);
    transport.setReady(false);
    transport.setReady(true);
    expect(ready.mock.calls).toEqual([[false], [true]]);
    const onCall = vi.fn();
    adapter.on('call-message', onCall);
    adapter.detach();
    transport.emit('call_message', { wire: { t: 'CR' } });
    expect(onCall).not.toHaveBeenCalled();
    expect(adapter.getLocalDestinationHash()).toBe(LOCAL);
  });
});
