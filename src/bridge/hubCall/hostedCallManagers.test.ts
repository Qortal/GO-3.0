/**
 * Wiring of the hosted managers that is GO-specific or easy to miss:
 * timeout hang-up, subscribe replay, join pinning, IPC result shapes,
 * readiness re-attach, logout and dispose.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  disposeScenarioStacks,
  eventsOf,
  knowEachOther,
  makePeer,
  placeCall,
  registerLocal,
  WAIT,
} from './testing/callScenarios';
import { FakePythonNetwork } from './testing/fakePythonNetwork';
import {
  createHostedCallManagers,
  forwardsThirdPartyAudio,
  lookupLandCallPeerViaEngine,
  type HostedCallStack,
  type RelayTopologyView,
} from './hostedCallManagers';
import { LAND_CALL_LOOKUP_TIMEOUT_MS } from './groupCallIpc';
import { createLazyHubCallApis, LOAD_RETRY_DELAYS_MS } from './lazyHubCallApis';

vi.mock(
  'zlib',
  async () => await import('../../reticulumChat/mobile/shims/zlib')
);
vi.mock(
  'crypto',
  async () => await import('../../reticulumChat/mobile/shims/crypto')
);
vi.mock(
  '../../../electron/src/verify-worker-pool',
  async () =>
    await import('../../reticulumChat/mobile/shims/verify-worker-pool')
);
vi.mock(
  '../../../electron/src/presence',
  async () => await import('../../reticulumChat/mobile/shims/presence-slim')
);
vi.mock('../../../electron/src/logger', () => {
  const out = () => {};
  return { log: out, warn: out, error: out, debug: out, info: out };
});

afterEach(() => {
  vi.useRealTimers();
  disposeScenarioStacks();
});

describe('hosted call managers: GO wiring', () => {
  it('a call nobody answers ends with call:hangup on both sides after 60 s (Hub stays silent)', async () => {
    vi.useFakeTimers();
    const network = new FakePythonNetwork();
    const alice = makePeer(network, 'alice', 11, 0x1a);
    const bob = makePeer(network, 'bob', 12, 0x1b);
    knowEachOther(alice, bob);
    await registerLocal(alice);
    await registerLocal(bob);
    const { callId } = await placeCall(alice, bob);
    await vi.advanceTimersByTimeAsync(100);
    expect(eventsOf(bob.callEvents, 'call:incoming')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(eventsOf(alice.callEvents, 'call:hangup')).toEqual([
      { callId, reason: 'timeout' },
    ]);
    expect(eventsOf(bob.callEvents, 'call:hangup')).toEqual([
      { callId, reason: 'timeout' },
    ]);
    expect(alice.history.map((h) => h.outcome)).toEqual(['no_answer']);
    expect(bob.history.map((h) => h.outcome)).toEqual(['missed']);
  });

  it('a friend heard 10 min ago (shown offline) still rings; one heard over an hour ago does not', async () => {
    const network = new FakePythonNetwork();
    const alice = makePeer(network, 'alice', 31, 0x7a);
    const bob = makePeer(network, 'bob', 32, 0x7b);
    knowEachOther(alice, bob);
    await registerLocal(alice);
    await registerLocal(bob);
    // Bob's phone stopped heartbeating 10 minutes ago (page frozen off
    // screen): presence calls him offline, but the call still goes out.
    alice.endpoints.set(bob.wallet.address, [
      { destinationHash: bob.dest, lastSeen: Date.now() - 10 * 60_000 },
    ]);
    expect(
      alice.stack.presence.getRoutesForAddress(bob.wallet.address)
    ).toEqual([]);
    const { callId } = await placeCall(alice, bob);
    await vi.waitFor(
      () =>
        expect(eventsOf(bob.callEvents, 'call:incoming')).toEqual([
          expect.objectContaining({ callId }),
        ]),
      WAIT
    );

    // An endpoint older than the call window is not a route.
    const carol = makePeer(network, 'carol', 33, 0x7c);
    await registerLocal(carol);
    alice.endpoints.set(carol.wallet.address, [
      { destinationHash: carol.dest, lastSeen: Date.now() - 61 * 60_000 },
    ]);
    await expect(placeCall(alice, carol)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 30));
    expect(eventsOf(carol.callEvents, 'call:incoming')).toEqual([]);
  });

  it('call routes: fresh endpoints only when there are any; the hour-old ones only as a fallback', async () => {
    const network = new FakePythonNetwork();
    const alice = makePeer(network, 'alice', 34, 0x7d);
    const bob = makePeer(network, 'bob', 35, 0x7e);
    await registerLocal(alice);
    await registerLocal(bob);
    const staleDest = 'ab'.repeat(16);
    alice.endpoints.set(bob.wallet.address, [
      { destinationHash: bob.dest, lastSeen: Date.now() },
      { destinationHash: staleDest, lastSeen: Date.now() - 20 * 60_000 },
    ]);
    const { callId } = await placeCall(alice, bob);
    const record = (
      alice.stack.callManager as unknown as {
        activeCalls: Map<string, { invitedReticulumPeerHashes?: Set<string> }>;
      }
    ).activeCalls.get(callId);
    expect([...(record?.invitedReticulumPeerHashes ?? [])]).toEqual([bob.dest]);
  });

  it('cancel before answer: callee gets one remote hang-up, caller none', async () => {
    const network = new FakePythonNetwork();
    const alice = makePeer(network, 'alice', 13, 0x2a);
    const bob = makePeer(network, 'bob', 14, 0x2b);
    knowEachOther(alice, bob);
    await registerLocal(alice);
    await registerLocal(bob);
    const { callId } = await placeCall(alice, bob);
    await vi.waitFor(
      () => expect(eventsOf(bob.callEvents, 'call:incoming')).toHaveLength(1),
      WAIT
    );
    const ts = Date.now();
    await alice.stack.call.hangup(
      callId,
      alice.wallet.sign({ type: 'CALL_HANGUP', callId, timestamp: ts }),
      alice.wallet.publicKey,
      ts
    );
    await vi.waitFor(
      () =>
        expect(eventsOf(bob.callEvents, 'call:hangup')).toEqual([{ callId }]),
      WAIT
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(eventsOf(alice.callEvents, 'call:hangup')).toEqual([]);
    expect(eventsOf(bob.callEvents, 'call:hangup')).toHaveLength(1);
    expect(alice.history.map((h) => h.outcome)).toEqual(['cancelled']);
    expect(bob.history.map((h) => h.outcome)).toEqual(['missed']);
  });

  it('first call subscriber gets ringing calls replayed; later ones do not', async () => {
    const network = new FakePythonNetwork();
    const alice = makePeer(network, 'alice', 15, 0x3a);
    const bobNode = network.addNode('3b'.repeat(16));
    const bobStack = createHostedCallManagers({
      transport: bobNode,
      presenceSource: { getEndpoints: () => [] },
    });
    try {
      const { TestWallet } = await import('./testing/testWallet');
      const bobWallet = new TestWallet(16);
      alice.endpoints.set(bobWallet.address, [
        { destinationHash: bobNode.destinationHash, lastSeen: Date.now() },
      ]);
      await registerLocal(alice);
      await bobStack.call.setLocalAddresses([bobWallet.address]);
      const fakeBob = {
        wallet: bobWallet,
        dest: bobNode.destinationHash,
      } as never;
      const { callId } = await placeCall(alice, fakeBob);
      await vi.waitFor(
        () =>
          expect(
            bobStack.callManager.getPendingInboundRingingPayloads()
          ).toHaveLength(1),
        WAIT
      );
      const first: unknown[] = [];
      const second: unknown[] = [];
      const unsubscribe = bobStack.call.onEvent((event, payload) =>
        first.push([event, payload])
      );
      bobStack.call.onEvent((event, payload) => second.push([event, payload]));
      await new Promise((r) => setTimeout(r, 10));
      expect(first).toEqual([
        [
          'call:incoming',
          expect.objectContaining({
            callId,
            fromAddress: alice.wallet.address,
          }),
        ],
      ]);
      expect(second).toEqual([]);
      unsubscribe();
    } finally {
      bobStack.dispose();
    }
  });

  it('window.groupCall: DM join without an authenticated call is refused like desktop', async () => {
    const network = new FakePythonNetwork();
    const alice = makePeer(network, 'alice', 17, 0x4a);
    await registerLocal(alice);
    const res = await alice.stack.groupCall.join(
      'dmv:0123456789abcdef01',
      `direct:${alice.wallet.address}:Qsomeone`,
      alice.wallet.address,
      'sig',
      alice.wallet.publicKey,
      Date.now(),
      alice.dest,
      undefined,
      0,
      undefined,
      undefined,
      'waiter',
      undefined,
      undefined,
      'C' + 'x'.repeat(35)
    );
    expect(res).toEqual({
      success: false,
      error: 'unverified_dm_voice_peer_destination',
    });
  });

  it('window.groupCall result shapes match the desktop IPC handlers', async () => {
    const network = new FakePythonNetwork();
    const alice = makePeer(network, 'alice', 18, 0x5a);
    await registerLocal(alice);
    const gc = alice.stack.groupCall;
    expect(
      await gc.sendAudio('gcall-qortal-1', 'Qx', new Uint8Array(12_289))
    ).toEqual({ success: false, error: 'payload-too-large' });
    expect(
      await gc.sendAudioBatch!('gcall-qortal-1', [], new Uint8Array(4))
    ).toEqual({
      success: true,
      diagnostics: undefined,
    });
    expect(await gc.getAudioDataPlaneSession!('room', [])).toEqual({
      ok: false,
      reason: 'no-targets',
    });
    expect(await gc.getLinkStats!('none')).toEqual({
      success: true,
      stats: { roomId: 'none', establishedLinks: 0, participants: 0 },
    });
    expect(await gc.getRoomParticipants('none')).toEqual([]);
    expect(await gc.getRoomBootstrapState!('none')).toBeNull();
    expect(
      gc.leaveSync!('none', alice.wallet.address, '', '', Date.now())
    ).toEqual({
      success: true,
    });
    expect(await gc.requestSessionBreak('none')).toMatchObject({
      success: false,
    });
    expect(await gc.reportTransportHealth!('none', [])).toEqual({
      success: true,
    });
    expect(await gc.getPendingKeyMetrics!()).toEqual({
      pending_key_flush_success: 0,
      pending_key_expired: 0,
      pendingRooms: 0,
    });
    const watched = await gc.setWatchedQortalGroupIds!([1, 2]);
    expect(watched.success).toBe(true);
    const activity = vi.fn();
    const stop = gc.onQortalGroupCallActivity!(activity);
    await vi.waitFor(() => expect(activity).toHaveBeenCalled(), WAIT);
    expect(activity.mock.calls[0][0]).toHaveProperty('activeByGroupId');
    stop();
    const replay = vi.spyOn(
      alice.stack.groupCallManager,
      'replayRetainedVerifiedKeyStatesTo'
    );
    gc.requestRetainedKeyReplay!();
    await vi.waitFor(() => expect(replay).toHaveBeenCalled(), WAIT);
  });

  it('member allowlists of joined group rooms are refreshed from the node (never dropping us)', async () => {
    vi.useFakeTimers();
    const network = new FakePythonNetwork();
    const node = network.addNode('6a'.repeat(16));
    const fetchMembers = vi.fn(async (groupId: number) =>
      groupId === 7 ? ['Qlocal', 'Qnew'] : ['Qsomeone-else']
    );
    const stack = createHostedCallManagers({
      transport: node,
      presenceSource: { getEndpoints: () => [] },
      fetchQortalGroupMemberAddresses: fetchMembers,
    });
    try {
      await stack.groupCall.setLocalAddresses(['Qlocal']);
      // Both rooms joined (the refresh only touches rooms we are in).
      vi.spyOn(
        stack.groupCallManager,
        'getRoomParticipants'
      ).mockImplementation((roomId: string) =>
        roomId === 'gcall-qortal-7' || roomId === 'gcall-qortal-8'
          ? [{ address: 'Qlocal', publicKey: '', reticulumDestinationHash: '' }]
          : []
      );
      const setTargets = vi.spyOn(
        stack.groupCallManager,
        'setQortalGroupReticulumTargets'
      );
      await stack.groupCall.setQortalGroupReticulumTargets!('gcall-qortal-7', [
        'Qlocal',
      ]);
      await stack.groupCall.setQortalGroupReticulumTargets!('gcall-qortal-8', [
        'Qlocal',
      ]);
      setTargets.mockClear();
      await vi.advanceTimersByTimeAsync(60_001);
      expect(fetchMembers).toHaveBeenCalledWith(7);
      expect(fetchMembers).toHaveBeenCalledWith(8);
      expect(setTargets.mock.calls).toEqual([
        ['gcall-qortal-7', ['Qlocal', 'Qnew']],
      ]);
      await stack.groupCall.leave(
        'gcall-qortal-7',
        'Qlocal',
        '',
        '',
        Date.now()
      );
      await stack.groupCall.leave(
        'gcall-qortal-8',
        'Qlocal',
        '',
        '',
        Date.now()
      );
      fetchMembers.mockClear();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(fetchMembers).not.toHaveBeenCalled();
    } finally {
      stack.dispose();
    }
  });

  it('member refresh: stops at logout, needs a local account, drops rooms the manager left', async () => {
    vi.useFakeTimers();
    const network = new FakePythonNetwork();
    const node = network.addNode('6b'.repeat(16));
    const fetchMembers = vi.fn(async () => ['Qlocal', 'Qnew']);
    const stack = createHostedCallManagers({
      transport: node,
      presenceSource: { getEndpoints: () => [] },
      fetchQortalGroupMemberAddresses: fetchMembers,
    });
    try {
      const joined = new Set(['gcall-qortal-7']);
      vi.spyOn(
        stack.groupCallManager,
        'getRoomParticipants'
      ).mockImplementation((roomId: string) =>
        joined.has(roomId)
          ? [{ address: 'Qlocal', publicKey: '', reticulumDestinationHash: '' }]
          : []
      );
      const setTargets = vi.spyOn(
        stack.groupCallManager,
        'setQortalGroupReticulumTargets'
      );
      await stack.groupCall.setLocalAddresses(['Qlocal']);
      await stack.groupCall.setQortalGroupReticulumTargets!('gcall-qortal-7', [
        'Qlocal',
      ]);
      // Pushed, then the manager left it on its own (e.g. takeover).
      await stack.groupCall.setQortalGroupReticulumTargets!('gcall-qortal-9', [
        'Qlocal',
      ]);
      setTargets.mockClear();
      await vi.advanceTimersByTimeAsync(60_001);
      expect(fetchMembers.mock.calls).toEqual([[7]]);
      expect(setTargets.mock.calls).toEqual([
        ['gcall-qortal-7', ['Qlocal', 'Qnew']],
      ]);
      // After the join grace the never-joined room is forgotten for good.
      fetchMembers.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);
      joined.add('gcall-qortal-9');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMembers.mock.calls).toEqual([[7], [7]]);

      // No local account → nothing is fetched or written.
      fetchMembers.mockClear();
      setTargets.mockClear();
      const internals = stack.groupCallManager as unknown as {
        localAddresses: Set<string>;
      };
      const savedLocal = internals.localAddresses;
      internals.localAddresses = new Set();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMembers).not.toHaveBeenCalled();
      expect(setTargets).not.toHaveBeenCalled();
      internals.localAddresses = savedLocal;

      // Logout: the manager wipes its rooms + allowlists; the refresh must
      // not resurrect them (or keep polling the old account's groups).
      stack.clearLocalAccountState();
      await stack.groupCall.setLocalAddresses(['Qnext']);
      joined.clear();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(fetchMembers).not.toHaveBeenCalled();
      expect(setTargets).not.toHaveBeenCalled();
    } finally {
      stack.dispose();
    }
  });

  it('logout during an in-flight refresh: the late answer is not applied', async () => {
    const network = new FakePythonNetwork();
    const node = network.addNode('6c'.repeat(16));
    let answer!: (members: string[]) => void;
    const fetchMembers = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          answer = resolve;
        })
    );
    vi.useFakeTimers();
    const stack = createHostedCallManagers({
      transport: node,
      presenceSource: { getEndpoints: () => [] },
      fetchQortalGroupMemberAddresses: fetchMembers,
    });
    try {
      vi.spyOn(stack.groupCallManager, 'getRoomParticipants').mockReturnValue([
        { address: 'Qlocal', publicKey: '', reticulumDestinationHash: '' },
      ]);
      await stack.groupCall.setLocalAddresses(['Qlocal']);
      await stack.groupCall.setQortalGroupReticulumTargets!('gcall-qortal-7', [
        'Qlocal',
      ]);
      const setTargets = vi.spyOn(
        stack.groupCallManager,
        'setQortalGroupReticulumTargets'
      );
      await vi.advanceTimersByTimeAsync(60_001);
      expect(fetchMembers).toHaveBeenCalledTimes(1);
      stack.clearLocalAccountState();
      answer(['Qlocal', 'Qnew']);
      await vi.advanceTimersByTimeAsync(0);
      expect(setTargets).not.toHaveBeenCalled();
    } finally {
      stack.dispose();
    }
  });

  it('QortalLand DM join: authenticated by the Land lookup, refused without it', async () => {
    const network = new FakePythonNetwork();
    const node = network.addNode('9a'.repeat(16));
    const landPeer = 'c3'.repeat(16);
    const lookup = vi.fn(
      async (_chatId: string, _local: string, callId: string) =>
        callId === 'land-call-ok' ? landPeer : null
    );
    const stack = createHostedCallManagers({
      transport: node,
      presenceSource: { getEndpoints: () => [] },
      getActiveLandCallMediaPeerDestinationHash: lookup,
    });
    try {
      const joinRoom = vi
        .spyOn(stack.groupCallManager, 'joinRoom')
        .mockReturnValue({
          callSessionId: 'session-1',
          mediaSessionGeneration: 3,
        } as never);
      const chatId = 'direct:Qa:Qb';
      const join = (callId: string, hint?: string) =>
        stack.groupCall.join(
          'dmv:0123456789abcdef01',
          chatId,
          'Qa',
          'sig',
          'pk',
          1,
          'aa'.repeat(16),
          undefined,
          0,
          undefined,
          undefined,
          'waiter',
          undefined,
          hint,
          callId
        );
      expect(await join('land-call-ok', 'ee'.repeat(16))).toEqual({
        success: true,
        callSessionId: 'session-1',
        mediaSessionGeneration: 3,
      });
      expect(lookup).toHaveBeenCalledWith(chatId, 'Qa', 'land-call-ok');
      // Pinned to the Land-authenticated device, not the renderer hint.
      const args = joinRoom.mock.calls[0];
      expect(args[13]).toBe(landPeer);
      expect(args[14]).toBe(true);
      expect(args[15]).toBe('land-call-ok');
      expect(await join('land-call-unknown')).toEqual({
        success: false,
        error: 'unverified_dm_voice_peer_destination',
      });
      expect(joinRoom).toHaveBeenCalledTimes(1);
    } finally {
      stack.dispose();
    }
  });

  it('QortalLand DM join: a lookup that never answers is refused after the bound', async () => {
    vi.useFakeTimers();
    const network = new FakePythonNetwork();
    const node = network.addNode('9b'.repeat(16));
    const stack = createHostedCallManagers({
      transport: node,
      presenceSource: { getEndpoints: () => [] },
      getActiveLandCallMediaPeerDestinationHash: () => new Promise(() => {}),
    });
    try {
      const pending = stack.groupCall.join(
        'dmv:0123456789abcdef01',
        'direct:Qa:Qb',
        'Qa',
        'sig',
        'pk',
        1,
        'aa'.repeat(16),
        undefined,
        0,
        undefined,
        undefined,
        'waiter',
        undefined,
        undefined,
        'land-call'
      );
      await vi.advanceTimersByTimeAsync(LAND_CALL_LOOKUP_TIMEOUT_MS + 1);
      expect(await pending).toEqual({
        success: false,
        error: 'unverified_dm_voice_peer_destination',
      });
    } finally {
      stack.dispose();
    }
  });

  it('QortalLand DM join: defaults to the chat engine RPC on window.reticulumChat', async () => {
    const network = new FakePythonNetwork();
    const landPeer = 'd4'.repeat(16);
    const g = globalThis as { reticulumChat?: unknown };
    const previous = g.reticulumChat;
    const rpc = vi.fn(async () => landPeer.toUpperCase());
    g.reticulumChat = { getActiveLandCallMediaPeerDestinationHash: rpc };
    const withDefault = createHostedCallManagers({
      transport: network.addNode('9c'.repeat(16)),
      presenceSource: { getEndpoints: () => [] },
    });
    const disabled = createHostedCallManagers({
      transport: network.addNode('9d'.repeat(16)),
      presenceSource: { getEndpoints: () => [] },
      getActiveLandCallMediaPeerDestinationHash: null,
    });
    try {
      const joinArgs = [
        'dmv:0123456789abcdef01',
        'direct:Qa:Qb',
        'Qa',
        'sig',
        'pk',
        1,
        'aa'.repeat(16),
        undefined,
        0,
        undefined,
        undefined,
        'waiter',
        undefined,
        undefined,
        'land-call',
      ] as const;
      const joinRoom = vi
        .spyOn(withDefault.groupCallManager, 'joinRoom')
        .mockReturnValue({
          callSessionId: 's',
          mediaSessionGeneration: 1,
        } as never);
      expect(await withDefault.groupCall.join(...joinArgs)).toMatchObject({
        success: true,
      });
      expect(rpc).toHaveBeenCalledWith('direct:Qa:Qb', 'Qa', 'land-call');
      expect(joinRoom.mock.calls[0][13]).toBe(landPeer);
      rpc.mockClear();
      expect(await disabled.groupCall.join(...joinArgs)).toEqual({
        success: false,
        error: 'unverified_dm_voice_peer_destination',
      });
      expect(rpc).not.toHaveBeenCalled();
      // No engine RPC (today's GO engine): refused like desktop with no record.
      g.reticulumChat = {};
      expect(
        await lookupLandCallPeerViaEngine('direct:Qa:Qb', 'Qa', 'x')
      ).toBeNull();
      g.reticulumChat = {
        getActiveLandCallMediaPeerDestinationHash: async () => 'not-a-hash',
      };
      expect(
        await lookupLandCallPeerViaEngine('direct:Qa:Qb', 'Qa', 'x')
      ).toBeNull();
    } finally {
      g.reticulumChat = previous;
      withDefault.dispose();
      disabled.dispose();
    }
  });

  it('python `ready` re-attaches the managers; logout clears; dispose stops the APIs', async () => {
    const network = new FakePythonNetwork();
    const node = network.addNode('7a'.repeat(16));
    const history = vi.fn();
    const stack = createHostedCallManagers({
      transport: node,
      presenceSource: { getEndpoints: () => [] },
      onCallHistory: history,
    });
    const reattachGroup = vi.spyOn(
      stack.groupCallManager,
      'setReticulumBridge'
    );
    const reattachCall = vi.spyOn(stack.callManager, 'setReticulumBridge');
    node.setReady(false);
    expect(stack.bridge.getState()).toBe('starting');
    node.setReady(true);
    expect(reattachGroup).toHaveBeenCalledTimes(1);
    expect(reattachCall).toHaveBeenCalledTimes(1);
    const clearCall = vi.spyOn(stack.callManager, 'clearLocalAccountState');
    const clearGroup = vi.spyOn(
      stack.groupCallManager,
      'clearLocalAccountState'
    );
    stack.clearLocalAccountState();
    expect(clearCall).toHaveBeenCalled();
    expect(clearGroup).toHaveBeenCalled();
    expect(stack.hardenedGcSignatureCache).toBe(true);
    stack.dispose();
    expect(await stack.call.accept('x', 's', 'p', 1)).toEqual({
      success: false,
      error: 'Call manager not running',
    });
    expect(await stack.groupCall.leave('r', 'a', 's', 'p', 1)).toEqual({
      success: false,
      error: 'GroupCall manager not running',
    });
  });
});

describe('"You\'re relaying audio": Hub forward-recipient rule', () => {
  const relays = (
    topology: RelayTopologyView,
    participants: string[],
    local: string
  ) =>
    forwardsThirdPartyAudio(topology, new Set(participants), new Set([local]));

  it('two people: neither side relays (the only member is the source)', () => {
    const topology = {
      rootForwarder: 'R',
      clusters: [{ members: ['R', 'A'], forwarder: 'R' }],
    };
    expect(relays(topology, ['R', 'A'], 'R')).toBe(false);
    expect(relays(topology, ['R', 'A'], 'A')).toBe(false);
    // Two single-member clusters: still nothing to forward.
    const split = {
      rootForwarder: 'R',
      clusters: [
        { members: ['R'], forwarder: 'R' },
        { members: ['B'], forwarder: 'B' },
      ],
    };
    expect(relays(split, ['R', 'B'], 'R')).toBe(false);
    expect(relays(split, ['R', 'B'], 'B')).toBe(false);
  });

  it('three or more: root and cluster forwarders relay, plain members do not', () => {
    const one = {
      rootForwarder: 'R',
      clusters: [{ members: ['R', 'A', 'B'], forwarder: 'R' }],
    };
    expect(relays(one, ['R', 'A', 'B'], 'R')).toBe(true);
    expect(relays(one, ['R', 'A', 'B'], 'A')).toBe(false);
    const two = {
      rootForwarder: 'R',
      clusters: [
        { members: ['R', 'A'], forwarder: 'R' },
        { members: ['F', 'C'], forwarder: 'F' },
      ],
    };
    const everyone = ['R', 'A', 'F', 'C'];
    expect(relays(two, everyone, 'R')).toBe(true);
    expect(relays(two, everyone, 'F')).toBe(true);
    expect(relays(two, everyone, 'A')).toBe(false);
    expect(relays(two, everyone, 'C')).toBe(false);
    // Not in the room → never relaying.
    expect(relays(two, ['R', 'A', 'C'], 'F')).toBe(false);
  });

  it('stack.isRelayingAudio reads the joined room topology (group rooms only)', async () => {
    const network = new FakePythonNetwork();
    const stack = createHostedCallManagers({
      transport: network.addNode('5c'.repeat(16)),
      presenceSource: { getEndpoints: () => [] },
    });
    const rooms = (
      stack.groupCallManager as unknown as { rooms: Map<string, unknown> }
    ).rooms;
    try {
      await stack.groupCall.setLocalAddresses(['R'], 'group');
      const participants = new Map(['R', 'A', 'B'].map((a) => [a, {}]));
      const lastTopology = {
        rootForwarder: 'R',
        clusters: [{ members: ['R', 'A', 'B'], forwarder: 'R' }],
      };
      rooms.set('gcall-qortal-5', { participants, lastTopology });
      expect(stack.isRelayingAudio('gcall-qortal-5')).toBe(true);
      expect(stack.isRelayingAudio()).toBe(true);
      expect(stack.isRelayingAudio('gcall-qortal-6')).toBe(false);
      participants.delete('B');
      expect(stack.isRelayingAudio('gcall-qortal-5')).toBe(false);
      rooms.delete('gcall-qortal-5');
      rooms.set('dmv:abc', {
        participants: new Map(['R', 'A', 'B'].map((a) => [a, {}])),
        lastTopology,
      });
      expect(stack.isRelayingAudio()).toBe(false);
      expect(stack.hasActiveDirectVoiceRoom()).toBe(true);
    } finally {
      rooms.clear();
      stack.dispose();
    }
  });
});

describe('lazy window.call / window.groupCall', () => {
  it('exist before the stack loads, subscribe early, forward once loaded', async () => {
    const network = new FakePythonNetwork();
    const node = network.addNode('8a'.repeat(16));
    let resolveLoad!: () => void;
    const gate = new Promise<void>((r) => {
      resolveLoad = r;
    });
    const load = vi.fn(async () => {
      await gate;
      return createHostedCallManagers({
        transport: node,
        presenceSource: { getEndpoints: () => [] },
      });
    });
    const lazy = createLazyHubCallApis(load);
    expect(lazy.groupCall.leaveSync!('r', 'a', 's', 'p', 1)).toEqual({
      success: false,
      error: 'GroupCall manager not running',
    });
    const events: string[] = [];
    lazy.call.onEvent((event) => events.push(event));
    const setLocal = lazy.call.setLocalAddresses(['Qme']);
    expect(lazy.getLoaded()).toBeNull();
    resolveLoad();
    expect(await setLocal).toEqual({ success: true });
    const stack = lazy.getLoaded()!;
    expect(load).toHaveBeenCalledTimes(1);
    stack.events.emit('call:hangup', { callId: 'x' });
    expect(events).toEqual(['call:hangup']);
    expect(lazy.groupCall.leaveSync!('r', 'a', 's', 'p', 1)).toEqual({
      success: true,
    });
    stack.dispose();
  });

  it('a failed load reports "not running" and is retried; RTC exposure toggles', async () => {
    let attempts = 0;
    const lazy = createLazyHubCallApis(
      async () => {
        attempts++;
        throw new Error('chunk load failed');
      },
      { exposeRtcSignal: false }
    );
    expect(await lazy.call.initiate('a', 'b', 'c', 'd', 'e', 'f', 1)).toEqual({
      success: false,
      error: 'Call manager not running',
    });
    expect(await lazy.groupCall.getRoomParticipants('r')).toEqual([]);
    expect(attempts).toBe(2);
    expect(lazy.groupCall.sendRtcSignal).toBeUndefined();
    expect(lazy.isRtcSignalExposed()).toBe(false);
    lazy.setRtcSignalExposed(true);
    expect(typeof lazy.groupCall.sendRtcSignal).toBe('function');
    expect(lazy.isRtcSignalExposed()).toBe(true);
    lazy.setRtcSignalExposed(false);
    expect(lazy.groupCall.sendRtcSignal).toBeUndefined();
  });

  it('sendRtcSignal is a live getter that also follows the support check', async () => {
    let supported = false;
    const lazy = createLazyHubCallApis(
      async () => {
        throw new Error('not needed');
      },
      { isRtcSignalSupported: () => supported }
    );
    // Wanted (default) but the audio surface cannot run WebRTC yet.
    expect(lazy.groupCall.sendRtcSignal).toBeUndefined();
    // A reference to the API object sees the change without re-reading
    // window.groupCall (useVoiceCall and the group runtime keep `api`).
    const api = lazy.groupCall;
    supported = true;
    expect(typeof api.sendRtcSignal).toBe('function');
    expect(Object.keys(api)).toContain('sendRtcSignal');
    lazy.setRtcSignalExposed(false);
    expect(api.sendRtcSignal).toBeUndefined();
    // Never throws into the reader.
    const throwing = createLazyHubCallApis(
      async () => {
        throw new Error('not needed');
      },
      {
        isRtcSignalSupported: () => {
          throw new Error('boom');
        },
      }
    );
    expect(throwing.groupCall.sendRtcSignal).toBeUndefined();
  });

  const loadableStack = (seed: string) => {
    const network = new FakePythonNetwork();
    return createHostedCallManagers({
      transport: network.addNode(seed.repeat(16)),
      presenceSource: { getEndpoints: () => [] },
    });
  };

  it('early subscribers survive a failed load and attach on the next successful one', async () => {
    let attempts = 0;
    const stacks: HostedCallStack[] = [];
    const lazy = createLazyHubCallApis(async () => {
      attempts++;
      if (attempts === 1) throw new Error('chunk load failed');
      const stack = loadableStack('8b');
      stacks.push(stack);
      return stack;
    });
    try {
      const callEvents: string[] = [];
      const gcallEvents: string[] = [];
      const activity: unknown[] = [];
      lazy.call.onEvent((event) => callEvents.push(event));
      lazy.groupCall.onEvent((event) => gcallEvents.push(event));
      lazy.groupCall.onQortalGroupCallActivity!((p) => activity.push(p));
      const cancelled: string[] = [];
      const stopCancelled = lazy.call.onEvent((event) => cancelled.push(event));
      expect(await lazy.ensureLoaded()).toBeNull();
      expect(attempts).toBe(1);
      stopCancelled();
      // A later method call (any caller) loads the stack.
      expect(await lazy.call.setLocalAddresses(['Qme'])).toEqual({
        success: true,
      });
      expect(attempts).toBe(2);
      const stack = lazy.getLoaded()!;
      stack.events.emit('call:incoming', {
        callId: 'c1',
        fromAddress: 'Qx',
        chatId: 'direct:Qme:Qx',
      });
      stack.events.emit('gcall:topology', { roomId: 'gcall-qortal-1' });
      expect(callEvents).toEqual(['call:incoming']);
      expect(gcallEvents).toEqual(['gcall:topology']);
      expect(cancelled).toEqual([]);
      await vi.waitFor(() => expect(activity.length).toBeGreaterThan(0), WAIT);
    } finally {
      for (const stack of stacks) stack.dispose();
    }
  });

  it('a failed load retries on its own while subscribers wait (bounded)', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const stacks: HostedCallStack[] = [];
    const lazy = createLazyHubCallApis(async () => {
      attempts++;
      if (attempts <= 2) throw new Error('chunk load failed');
      const stack = loadableStack('8c');
      stacks.push(stack);
      return stack;
    });
    try {
      const events: string[] = [];
      lazy.call.onEvent((event) => events.push(event));
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(LOAD_RETRY_DELAYS_MS[0]);
      expect(attempts).toBe(2);
      await vi.advanceTimersByTimeAsync(LOAD_RETRY_DELAYS_MS[1]);
      expect(attempts).toBe(3);
      lazy.getLoaded()!.events.emit('call:hangup', { callId: 'x' });
      expect(events).toEqual(['call:hangup']);
      // Loaded: no more retries.
      await vi.advanceTimersByTimeAsync(600_000);
      expect(attempts).toBe(3);
    } finally {
      for (const stack of stacks) stack.dispose();
    }
  });

  it('no self-retry without waiting subscribers, and it gives up after the last delay', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const lazy = createLazyHubCallApis(async () => {
      attempts++;
      throw new Error('chunk load failed');
    });
    expect(await lazy.ensureLoaded()).toBeNull();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(attempts).toBe(1);
    const stop = lazy.call.onEvent(() => {});
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(attempts).toBe(2 + LOAD_RETRY_DELAYS_MS.length - 1);
    stop();
  });

  it('turning RTC off mid-call keeps sendRtcSignal until the DM media room ends', async () => {
    vi.useFakeTimers();
    let stack!: HostedCallStack;
    const lazy = createLazyHubCallApis(async () => {
      stack = loadableStack('8d');
      return stack;
    });
    try {
      await lazy.ensureLoaded();
      let inDmRoom = true;
      vi.spyOn(stack, 'hasActiveDirectVoiceRoom').mockImplementation(
        () => inDmRoom
      );
      lazy.setRtcSignalExposed(false);
      // Live 1:1 call: the hook keeps signalling (ICE restart, reconnect).
      expect(typeof lazy.groupCall.sendRtcSignal).toBe('function');
      inDmRoom = false;
      await lazy.groupCall.leave('dmv:abc', 'Qa', 's', 'p', 1);
      expect(lazy.groupCall.sendRtcSignal).toBeUndefined();

      // Room left by the manager itself (logout, takeover): the re-check
      // removes it within a couple of seconds.
      lazy.setRtcSignalExposed(true);
      inDmRoom = true;
      lazy.setRtcSignalExposed(false);
      expect(typeof lazy.groupCall.sendRtcSignal).toBe('function');
      inDmRoom = false;
      await vi.advanceTimersByTimeAsync(2_001);
      expect(lazy.groupCall.sendRtcSignal).toBeUndefined();

      // Turning it back on is immediate, also mid-call.
      inDmRoom = true;
      lazy.setRtcSignalExposed(true);
      expect(typeof lazy.groupCall.sendRtcSignal).toBe('function');
      // leaveSync path.
      lazy.setRtcSignalExposed(false);
      inDmRoom = false;
      lazy.groupCall.leaveSync!('dmv:abc', 'Qa', 's', 'p', 1);
      expect(lazy.groupCall.sendRtcSignal).toBeUndefined();
    } finally {
      stack?.dispose();
    }
  });
});
