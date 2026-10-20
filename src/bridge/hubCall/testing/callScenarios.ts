/**
 * Shared scenarios for the hosted-call-manager tests: two GO devices, each
 * running the UNMODIFIED Hub CallManager + GroupCallManager behind GO's
 * adapters, connected through FakePythonNetwork. Real wallet-style Ed25519
 * signatures over the real field sets (TestWallet, checked by GO's signing
 * policy). Test files mock the Node modules exactly like the GO build
 * (zlib/crypto/verify-worker-pool/presence shims) and then call these.
 */
import { expect, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { createRouteBoundId } from '../../../lib/reticulum/routeBoundId';
import { FakePythonNetwork, type FakePythonNode } from './fakePythonNetwork';
import { TestWallet } from './testWallet';
import type { MobilePresenceEndpoint } from '../mobilePresenceAdapter';
import {
  createHostedCallManagers,
  type DirectCallHistoryUpdate,
  type HostedCallStack,
} from '../hostedCallManagers';

export type Peer = {
  name: string;
  wallet: TestWallet;
  node: FakePythonNode;
  dest: string;
  stack: HostedCallStack;
  endpoints: Map<string, MobilePresenceEndpoint[]>;
  history: DirectCallHistoryUpdate[];
  callEvents: Array<{ event: string; payload: any }>;
  gcallEvents: Array<{ event: string; payload: any }>;
};

const stacks: HostedCallStack[] = [];

/** Call from afterEach: stops every stack a scenario created. */
export function disposeScenarioStacks(): void {
  for (const stack of stacks.splice(0)) stack.dispose();
}

function hexDest(byte: number): string {
  return byte.toString(16).padStart(2, '0').repeat(16);
}

export function makePeer(
  network: FakePythonNetwork,
  name: string,
  seed: number,
  destByte: number
): Peer {
  const wallet = new TestWallet(seed);
  const dest = hexDest(destByte);
  const node = network.addNode(dest);
  const endpoints = new Map<string, MobilePresenceEndpoint[]>();
  const history: DirectCallHistoryUpdate[] = [];
  const stack = createHostedCallManagers({
    transport: node,
    presenceSource: { getEndpoints: (address) => endpoints.get(address) ?? [] },
    onCallHistory: (update) => {
      history.push(update);
    },
  });
  stacks.push(stack);
  const callEvents: Peer['callEvents'] = [];
  const gcallEvents: Peer['gcallEvents'] = [];
  stack.call.onEvent((event, payload) => callEvents.push({ event, payload }));
  stack.groupCall.onEvent((event, payload) =>
    gcallEvents.push({ event, payload })
  );
  return {
    name,
    wallet,
    node,
    dest,
    stack,
    endpoints,
    history,
    callEvents,
    gcallEvents,
  };
}

export function knowEachOther(a: Peer, b: Peer): void {
  a.endpoints.set(b.wallet.address, [
    { destinationHash: b.dest, lastSeen: Date.now() },
  ]);
  b.endpoints.set(a.wallet.address, [
    { destinationHash: a.dest, lastSeen: Date.now() },
  ]);
}

export async function registerLocal(peer: Peer): Promise<void> {
  await peer.stack.call.setLocalAddresses([peer.wallet.address]);
  await peer.stack.groupCall.setLocalAddresses([peer.wallet.address], 'dm');
}

function dmRoomId(chatId: string): string {
  const digest = Array.from(sha256(new TextEncoder().encode(chatId)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
  return `dmv:${digest.slice(0, 18)}`;
}

function fakeRk(seed: number): string {
  const bytes = new Uint8Array(64).fill(seed);
  return Buffer.from(bytes).toString('base64');
}

function sha256Hex(text: string): string {
  return Array.from(sha256(new TextEncoder().encode(text)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

export function eventsOf(
  list: Array<{ event: string; payload: any }>,
  event: string
) {
  return list.filter((e) => e.event === event).map((e) => e.payload);
}

/** useVoiceCall.initiateCall → window.call.initiate */
export async function placeCall(
  a: Peer,
  b: Peer
): Promise<{ callId: string; chatId: string }> {
  const chatId = `direct:${[a.wallet.address, b.wallet.address].sort().join(':')}`;
  const callId = createRouteBoundId('call', a.dest)!;
  const timestamp = Date.now();
  const signature = a.wallet.sign({
    type: 'CALL_REQUEST',
    callId,
    chatId,
    fromAddress: a.wallet.address,
    fromPublicKey: a.wallet.publicKey,
    timestamp,
  });
  const cancellationSignature = a.wallet.sign({
    type: 'CALL_HANGUP',
    callId,
    timestamp,
  });
  const result = await a.stack.call.initiate(
    b.wallet.address,
    chatId,
    a.wallet.address,
    signature,
    a.wallet.publicKey,
    callId,
    timestamp,
    cancellationSignature,
    a.wallet.publicKey,
    timestamp
  );
  expect(result).toEqual({ success: true, callId });
  return { callId, chatId };
}

/** directVoiceReticulumMedia.joinDirectVoiceReticulumRoom (GC_JOIN without rk + GI). */
async function joinDmRoom(
  peer: Peer,
  roomId: string,
  chatId: string,
  role: 'opener' | 'waiter',
  callId: string,
  rkSeed: number
) {
  const timestamp = Date.now();
  const wireChatId = `d:${roomId.slice('dmv:'.length)}`;
  const rk = fakeRk(rkSeed);
  const joinSig = peer.wallet.sign({
    type: 'GC_JOIN',
    roomId,
    chatId: wireChatId,
    fromAddress: peer.wallet.address,
    fromPublicKey: peer.wallet.publicKey,
    timestamp,
    reticulumDestinationHash: peer.dest,
  });
  const joinRkSig = peer.wallet.sign({
    type: 'GC_JOIN_RK',
    roomId,
    chatId: wireChatId,
    fromAddress: peer.wallet.address,
    fromPublicKey: peer.wallet.publicKey,
    timestamp,
    reticulumDestinationHash: peer.dest,
    reticulumIdentityPublicKeyBase64: rk.replace(/=+$/u, ''),
  });
  return peer.stack.groupCall.join(
    roomId,
    chatId,
    peer.wallet.address,
    joinSig,
    peer.wallet.publicKey,
    timestamp,
    peer.dest,
    undefined,
    0,
    rk,
    joinRkSig,
    role,
    undefined,
    undefined,
    callId
  );
}

async function sendRoomKey(
  from: Peer,
  to: Peer,
  roomId: string,
  callSessionId: string,
  mediaSessionGeneration: number
) {
  const encryptedKey = Buffer.from(new Uint8Array(88).fill(9)).toString(
    'base64'
  );
  const encryptedKeyDigest = sha256Hex(
    JSON.stringify({ encryptedKey, toAddress: to.wallet.address })
  );
  const keyCommitment = 'c'.repeat(64);
  const timestamp = Date.now();
  const meta = {
    keyMessageVersion: 3,
    callSessionId,
    mediaSessionGeneration,
    keyCommitment,
    encryptedKeyDigest,
  };
  const signature = from.wallet.sign({
    type: 'GC_KEY',
    roomId,
    toAddress: to.wallet.address,
    fromAddress: from.wallet.address,
    fromPublicKey: from.wallet.publicKey,
    timestamp,
    ...meta,
  });
  return from.stack.groupCall.sendKey(
    roomId,
    to.wallet.address,
    encryptedKey,
    from.wallet.address,
    signature,
    from.wallet.publicKey,
    timestamp,
    meta
  );
}

function buildRtcSignal(
  from: Peer,
  to: Peer,
  roomId: string,
  callSessionId: string,
  mediaSessionGeneration: number,
  signalType: 'capability' | 'offer',
  payloadObject: Record<string, unknown>
) {
  const payload = JSON.stringify(payloadObject);
  const payloadHash = sha256Hex(payload);
  const connectionId = `${callSessionId}:${mediaSessionGeneration}:${[
    from.wallet.address,
    to.wallet.address,
  ]
    .sort()
    .join(':')}`;
  const signalId = crypto.randomUUID();
  const timestamp = Date.now();
  const signature = from.wallet.sign({
    type: 'GC_RTC_SIGNAL',
    roomId,
    callSessionId,
    mediaSessionGeneration,
    fromAddress: from.wallet.address,
    toAddress: to.wallet.address,
    connectionId,
    signalId,
    signalType,
    payloadHash,
    fromPublicKey: from.wallet.publicKey,
    timestamp,
  });
  return {
    roomId,
    callSessionId,
    mediaSessionGeneration,
    fromAddress: from.wallet.address,
    toAddress: to.wallet.address,
    connectionId,
    signalId,
    signalType,
    payload,
    payloadHash,
    timestamp,
    signature,
    publicKey: from.wallet.publicKey,
  };
}

export const WAIT = { timeout: 15_000, interval: 20 };

/** DM call: CR → CA → media room → link-auth → GC_KEY adopted → audio → RTC offer → hangup over link */
export async function runDmCallScenario(): Promise<void> {
  const network = new FakePythonNetwork();
  const alice = makePeer(network, 'alice', 1, 0xa1);
  const bob = makePeer(network, 'bob', 2, 0xb2);
  knowEachOther(alice, bob);
  await registerLocal(alice);
  await registerLocal(bob);
  await runDmCallScenarioBetween(alice, bob);
}

/**
 * The DM scenario for two peers that already know each other's presence
 * route and registered their local addresses. `alice` calls, `bob` answers.
 * Either side may be GO's capacitorBridge wiring
 * (capacitorBridgeWiring.integration.test.ts).
 */
export type DmCallConnectedContext = {
  roomId: string;
  chatId: string;
  callId: string;
  /** Audio has been seen both ways when this runs. */
  aliceSession: { callSessionId?: string; mediaSessionGeneration?: number };
};

export async function runDmCallScenarioBetween(
  alice: Peer,
  bob: Peer,
  options: {
    /** Runs once audio flows both ways, before RTC signalling and hangup. */
    whileConnected?: (ctx: DmCallConnectedContext) => Promise<void>;
  } = {}
): Promise<void> {
  // ── signaling ─────────────────────────────────────────────────────
  const { callId, chatId } = await placeCall(alice, bob);
  await vi.waitFor(
    () =>
      expect(eventsOf(bob.callEvents, 'call:incoming')).toEqual([
        { callId, fromAddress: alice.wallet.address, chatId },
      ]),
    WAIT
  );
  // Flood + pinned copy (same X, same L): the CR is applied once, and the
  // copy that arrives first is re-flooded by the callee like a flood copy.
  expect(alice.node.commandsOf('fanout_call')).toHaveLength(1);
  const floodCr = (
    alice.node.commandsOf('fanout_call')[0].payload.messages as Array<
      Record<string, unknown>
    >
  ).find((m) => m.t === 'CR');
  expect(typeof floodCr?.L).toBe('number');
  expect(floodCr?.L as number).toBeGreaterThan(0);
  expect(
    alice.node
      .commandsOf('send_call')
      .filter(
        (c) =>
          c.payload.peerPresenceHash === bob.dest &&
          (c.payload.message as { t?: string }).t === 'CR'
      )
      .map((c) => c.payload.message)
  ).toEqual([floodCr]);

  const acceptTs = Date.now();
  expect(
    await bob.stack.call.accept(
      callId,
      bob.wallet.sign({ type: 'CALL_ACCEPT', callId, timestamp: acceptTs }),
      bob.wallet.publicKey,
      acceptTs
    )
  ).toEqual({ success: true });
  await vi.waitFor(
    () =>
      expect(eventsOf(alice.callEvents, 'call:accepted')).toEqual([{ callId }]),
    WAIT
  );
  // Desktop parity: CA pinned to the caller's route-bound device.
  expect(
    bob.node
      .commandsOf('send_call')
      .filter((c) => (c.payload.message as { t?: string }).t === 'CA')
      .every((c) => c.payload.peerPresenceHash === alice.dest)
  ).toBe(true);

  // ── DM media room ─────────────────────────────────────────────────
  const roomId = dmRoomId(chatId);
  expect(alice.stack.hasActiveDirectVoiceRoom()).toBe(false);
  const aliceJoin = await joinDmRoom(
    alice,
    roomId,
    chatId,
    'waiter',
    callId,
    0x11
  );
  const bobJoin = await joinDmRoom(bob, roomId, chatId, 'opener', callId, 0x22);
  expect(aliceJoin.success).toBe(true);
  expect(bobJoin.success).toBe(true);
  expect(bobJoin.callSessionId).not.toBe(aliceJoin.callSessionId);
  expect(alice.stack.hasActiveDirectVoiceRoom()).toBe(true);
  expect(bob.stack.hasActiveDirectVoiceRoom()).toBe(true);
  // A DM media room never shows the relaying note.
  expect(alice.stack.isRelayingAudio()).toBe(false);

  // Callee is the opener: exactly its link to the pinned caller device.
  await vi.waitFor(
    () =>
      expect(
        bob.node
          .commandsOf('open_group_audio_link')
          .map((c) => c.payload.peerPresenceHash)
      ).toContain(alice.dest),
    WAIT
  );
  expect(alice.node.commandsOf('open_group_audio_link')).toHaveLength(0);

  // Link-auth both ways → participant rows on both sides.
  await vi.waitFor(async () => {
    const aParts = await alice.stack.groupCall.getRoomParticipants(roomId);
    const bParts = await bob.stack.groupCall.getRoomParticipants(roomId);
    expect(aParts.map((p) => p.address)).toContain(bob.wallet.address);
    expect(bParts.map((p) => p.address)).toContain(alice.wallet.address);
  }, WAIT);
  await vi.waitFor(async () => {
    const stats = await alice.stack.groupCall.getLinkStats!(roomId);
    expect(stats.stats?.establishedLinks).toBe(1);
  }, WAIT);

  // ── room key (caller → callee), session adoption ─────────────────
  await vi.waitFor(async () => {
    const sent = await sendRoomKey(
      alice,
      bob,
      roomId,
      aliceJoin.callSessionId!,
      aliceJoin.mediaSessionGeneration!
    );
    expect(sent.success).toBe(true);
  }, WAIT);
  await vi.waitFor(
    () =>
      expect(eventsOf(bob.gcallEvents, 'gcall:key')).toContainEqual(
        expect.objectContaining({
          roomId,
          fromAddress: alice.wallet.address,
          verified: true,
          callSessionId: aliceJoin.callSessionId,
        })
      ),
    WAIT
  );
  await vi.waitFor(
    () =>
      expect(eventsOf(bob.gcallEvents, 'gcall:session-updated')).toContainEqual(
        expect.objectContaining({
          roomId,
          callSessionId: aliceJoin.callSessionId,
        })
      ),
    WAIT
  );
  // (getRoomBootstrapState is null on Hub 3.0.3: bootstrap cache disabled;
  // the adopted session is proven by Bob's RTC signal below.)

  // ── audio both ways, attributed to the verified sender ───────────
  const frameAB = new Uint8Array(120).map((_, i) => (i * 7) & 0xff);
  const frameBA = new Uint8Array(96).map((_, i) => (i * 3 + 1) & 0xff);
  await vi.waitFor(async () => {
    const res = await alice.stack.groupCall.sendAudio(
      roomId,
      bob.wallet.address,
      frameAB,
      { rendererSendAtWallMs: Date.now() }
    );
    expect(res.success).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(
      eventsOf(bob.gcallEvents, 'gcall:audio').some(
        (p) =>
          p.fromAddress === alice.wallet.address &&
          p.resolvedFromAddress === alice.wallet.address &&
          p.data instanceof Uint8Array &&
          Buffer.from(p.data).equals(Buffer.from(frameAB))
      )
    ).toBe(true);
  }, WAIT);
  await vi.waitFor(async () => {
    const res = await bob.stack.groupCall.sendAudio(
      roomId,
      alice.wallet.address,
      frameBA
    );
    expect(res.success).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(
      eventsOf(alice.gcallEvents, 'gcall:audio').some(
        (p) =>
          p.fromAddress === bob.wallet.address &&
          Buffer.from(p.data).equals(Buffer.from(frameBA))
      )
    ).toBe(true);
  }, WAIT);
  // Media frames keep Python's deadline, control frames bypass it.
  const audioCommands = alice.node.commandsOf('send_group_audio');
  expect(audioCommands.some((c) => c.payload.receivedAtWallMs === 0)).toBe(
    true
  );
  expect(
    audioCommands.some((c) => (c.payload.receivedAtWallMs as number) > 0)
  ).toBe(true);

  await options.whileConnected?.({
    roomId,
    chatId,
    callId,
    aliceSession: aliceJoin,
  });

  // ── WebRTC signal over the reliable link channel (GO0/GO1) ───────
  const capability = buildRtcSignal(
    alice,
    bob,
    roomId,
    aliceJoin.callSessionId!,
    aliceJoin.mediaSessionGeneration!,
    'capability',
    {
      kind: 'capability',
      audio: 'native-track',
      screen: 'video-track',
      screenVersion: 1,
      version: 1,
      capabilityId: crypto.randomUUID(),
    }
  );
  expect(await alice.stack.groupCall.sendRtcSignal(capability)).toEqual({
    success: true,
  });
  const sdp = `v=0\r\n${'a=candidate:1 1 udp 2122260223 203.0.113.7 54400 typ srflx\r\n'.repeat(60)}`;
  const offer = buildRtcSignal(
    alice,
    bob,
    roomId,
    aliceJoin.callSessionId!,
    aliceJoin.mediaSessionGeneration!,
    'offer',
    {
      kind: 'description',
      generation: 'native_audio_v1',
      description: { type: 'offer', sdp },
    }
  );
  expect(await alice.stack.groupCall.sendRtcSignal(offer)).toEqual({
    success: true,
  });
  await vi.waitFor(() => {
    const signals = eventsOf(bob.gcallEvents, 'gcall:rtc-signal');
    expect(signals).toContainEqual({ ...capability, verified: true });
    expect(signals).toContainEqual({ ...offer, verified: true });
  }, WAIT);
  // Bob answers on the ADOPTED session (his own join session would be
  // refused by his manager as media-session-mismatch).
  const bobCapability = buildRtcSignal(
    bob,
    alice,
    roomId,
    aliceJoin.callSessionId!,
    aliceJoin.mediaSessionGeneration!,
    'capability',
    {
      kind: 'capability',
      audio: 'native-track',
      screen: 'video-track',
      screenVersion: 1,
      version: 1,
      capabilityId: crypto.randomUUID(),
    }
  );
  expect(await bob.stack.groupCall.sendRtcSignal(bobCapability)).toEqual({
    success: true,
  });
  await vi.waitFor(
    () =>
      expect(eventsOf(alice.gcallEvents, 'gcall:rtc-signal')).toContainEqual({
        ...bobCapability,
        verified: true,
      }),
    WAIT
  );
  const controlCommands = alice.node.commandsOf(
    'send_group_audio_link_control'
  );
  expect(controlCommands.map((c) => c.payload.signalType)).toEqual([
    'capability',
    'offer',
  ]);
  // A signal for another session is refused before it leaves the phone.
  const stale = buildRtcSignal(
    alice,
    bob,
    roomId,
    'not-the-room-session',
    1,
    'offer',
    { kind: 'description', generation: 'native_audio_v1' }
  );
  expect((await alice.stack.groupCall.sendRtcSignal(stale)).success).toBe(
    false
  );

  // ── hang-up: link call-control first, acked, both sides end ──────
  const hangupTs = Date.now();
  expect(
    await alice.stack.call.hangup(
      callId,
      alice.wallet.sign({ type: 'CALL_HANGUP', callId, timestamp: hangupTs }),
      alice.wallet.publicKey,
      hangupTs
    )
  ).toEqual({ success: true });
  await vi.waitFor(
    () => expect(eventsOf(bob.callEvents, 'call:hangup')).toEqual([{ callId }]),
    WAIT
  );
  expect(
    alice.node
      .commandsOf('send_group_audio_link_control')
      .some((c) => c.payload.signalType === 'call-control')
  ).toBe(true);
  expect(
    bob.node
      .commandsOf('send_group_audio_link_control')
      .some((c) => c.payload.signalType === 'call-control')
  ).toBe(true); // hangup-ack
  // Acked over the link → no pinned/flooded CH fallback from Alice.
  expect(
    alice.node
      .commandsOf('fanout_call')
      .some((c) =>
        (c.payload.messages as Array<{ t?: string }>).some((m) => m.t === 'CH')
      )
  ).toBe(false);
  // Nothing synthesised for a call that ended normally.
  expect(eventsOf(alice.callEvents, 'call:hangup')).toEqual([]);

  // History → shared chat engine hook, on both devices.
  await vi.waitFor(() => {
    expect(alice.history.map((h) => h.outcome)).toEqual([
      'answered',
      'answered',
    ]);
    expect(bob.history.map((h) => h.outcome)).toEqual(['answered', 'answered']);
  }, WAIT);

  // Leave the room (GL); reject/hangup of unknown calls still succeed.
  const leaveTs = Date.now();
  expect(
    await alice.stack.groupCall.leave(
      roomId,
      alice.wallet.address,
      alice.wallet.sign({
        type: 'GC_LEAVE',
        roomId,
        fromAddress: alice.wallet.address,
        fromPublicKey: alice.wallet.publicKey,
        timestamp: leaveTs,
      }),
      alice.wallet.publicKey,
      leaveTs
    )
  ).toEqual({ success: true });
  expect(alice.stack.hasActiveDirectVoiceRoom()).toBe(false);
  expect(await alice.stack.call.reject('unknown-call')).toEqual({
    success: true,
  });
  expect(
    await alice.stack.call.hangup('unknown-call', 'sig', 'pk', Date.now())
  ).toEqual({ success: true });

  // No wire carried an rk inside GJ (contract B-1). The managers wanted
  // to re-flood the peer's L>0 frames (desktop relays); GO is a leaf, so
  // those were dropped and every flood GO sent is its own (no foreign r).
  let suppressed = 0;
  for (const peer of [alice, bob]) {
    for (const action of ['fanout_call', 'fanout_group_call']) {
      for (const c of peer.node.commandsOf(action)) {
        expect(c.payload.excludePeerPresenceHashes).toEqual([]);
        for (const m of c.payload.messages as Array<Record<string, unknown>>) {
          // call.ts stamps its own route-bound `r` on CR; never a foreign one.
          if ('r' in m) expect(m.r).toBe(peer.dest);
          if (m.t === 'GJ') expect(m).not.toHaveProperty('rk');
        }
      }
    }
    suppressed += peer.stack.bridge.stats.relaysSuppressed;
  }
  expect(suppressed).toBeGreaterThan(0);
}

/** decline: reason-signed and legacy CX pinned to the caller, caller sees the reason */
export async function runDeclineScenario(): Promise<void> {
  const network = new FakePythonNetwork();
  const alice = makePeer(network, 'alice', 3, 0xa3);
  const bob = makePeer(network, 'bob', 4, 0xb4);
  knowEachOther(alice, bob);
  await registerLocal(alice);
  await registerLocal(bob);
  const { callId } = await placeCall(alice, bob);
  await vi.waitFor(
    () => expect(eventsOf(bob.callEvents, 'call:incoming')).toHaveLength(1),
    WAIT
  );
  const ts = Date.now();
  const legacy = bob.wallet.sign({
    type: 'CALL_REJECT',
    callId,
    timestamp: ts,
  });
  const reasoned = bob.wallet.sign({
    type: 'CALL_REJECT',
    callId,
    timestamp: ts,
    reason: 'not_friend',
  });
  expect(
    await bob.stack.call.reject(
      callId,
      'not_friend',
      legacy,
      bob.wallet.publicKey,
      ts,
      reasoned
    )
  ).toEqual({ success: true });
  await vi.waitFor(
    () =>
      expect(eventsOf(alice.callEvents, 'call:rejected')).toEqual([
        { callId, reason: 'not_friend' },
      ]),
    WAIT
  );
  const cx = bob.node
    .commandsOf('send_call')
    .filter((c) => (c.payload.message as { t?: string }).t === 'CX');
  expect(cx).toHaveLength(2);
  expect(cx.every((c) => c.payload.peerPresenceHash === alice.dest)).toBe(true);
}

/** a target without any presence route is "Target offline" (desktop IPC result) */
export async function runTargetOfflineScenario(): Promise<void> {
  const network = new FakePythonNetwork();
  const alice = makePeer(network, 'alice', 5, 0xa5);
  const bob = new TestWallet(6);
  await registerLocal(alice);
  const chatId = `direct:${[alice.wallet.address, bob.address].sort().join(':')}`;
  const callId = createRouteBoundId('call', alice.dest)!;
  const ts = Date.now();
  const res = await alice.stack.call.initiate(
    bob.address,
    chatId,
    alice.wallet.address,
    alice.wallet.sign({
      type: 'CALL_REQUEST',
      callId,
      chatId,
      fromAddress: alice.wallet.address,
      fromPublicKey: alice.wallet.publicKey,
      timestamp: ts,
    }),
    alice.wallet.publicKey,
    callId,
    ts
  );
  expect(res).toEqual({ success: false, error: 'Target offline' });
}

/** group room: two members join, verify each other, link up and exchange topology */
export async function runGroupRoomScenario(): Promise<void> {
  const network = new FakePythonNetwork();
  const alice = makePeer(network, 'alice', 7, 0xa7);
  const bob = makePeer(network, 'bob', 8, 0xb8);
  knowEachOther(alice, bob);
  await registerLocal(alice);
  await registerLocal(bob);
  const roomId = 'gcall-qortal-4242';
  const chatId = 'group-4242';
  const members = [alice.wallet.address, bob.wallet.address];
  for (const peer of [alice, bob]) {
    expect(
      await peer.stack.groupCall.setQortalGroupReticulumTargets!(
        roomId,
        members
      )
    ).toEqual({ success: true });
    await peer.stack.groupCall.setLocalAddresses(
      [peer.wallet.address],
      'group'
    );
  }
  const joinGroup = async (peer: Peer) => {
    const timestamp = Date.now();
    const joinGeneration = 1 + Math.floor(Math.random() * 1_000_000);
    const signature = peer.wallet.sign({
      type: 'GC_JOIN',
      roomId,
      chatId,
      fromAddress: peer.wallet.address,
      fromPublicKey: peer.wallet.publicKey,
      timestamp,
      reticulumDestinationHash: peer.dest,
      joinGeneration,
    });
    return peer.stack.groupCall.join(
      roomId,
      chatId,
      peer.wallet.address,
      signature,
      peer.wallet.publicKey,
      timestamp,
      peer.dest,
      joinGeneration,
      0
    );
  };
  const aliceJoin = await joinGroup(alice);
  const bobJoin = await joinGroup(bob);
  expect(aliceJoin.success).toBe(true);
  expect(bobJoin.success).toBe(true);

  await vi.waitFor(() => {
    expect(
      eventsOf(alice.gcallEvents, 'gcall:participant-joined')
    ).toContainEqual(
      expect.objectContaining({ roomId, address: bob.wallet.address })
    );
    expect(
      eventsOf(bob.gcallEvents, 'gcall:participant-joined')
    ).toContainEqual(
      expect.objectContaining({ roomId, address: alice.wallet.address })
    );
  }, WAIT);
  // GJ carries the signed join generation `j` (contract order: arg 8).
  const gj = alice.node
    .commandsOf('fanout_group_call')
    .flatMap((c) => c.payload.messages as Array<Record<string, unknown>>)
    .find((m) => m.t === 'GJ');
  expect(typeof gj?.j).toBe('number');

  // The elected root (first by sha256(address:roomId)) broadcasts GT.
  const [root, other] = [alice, bob].sort((x, y) =>
    sha256Hex(`${x.wallet.address}:${roomId}`).localeCompare(
      sha256Hex(`${y.wallet.address}:${roomId}`)
    )
  );
  const topology = {
    topologyEpoch: 1,
    rootForwarder: root.wallet.address,
    standbyForwarder: other.wallet.address,
    clusters: [
      {
        members: [root.wallet.address, other.wallet.address],
        forwarder: root.wallet.address,
        standby: other.wallet.address,
        standby2: '',
      },
    ],
    lastSeen: Date.now(),
    fromAddress: root.wallet.address,
  };
  await vi.waitFor(async () => {
    const timestamp = Date.now();
    const signature = root.wallet.sign({
      type: 'GC_TOPOLOGY',
      roomId,
      topologyEpoch: topology.topologyEpoch,
      rootForwarder: topology.rootForwarder,
      standbyForwarder: topology.standbyForwarder,
      fromAddress: root.wallet.address,
      fromPublicKey: root.wallet.publicKey,
      timestamp,
    });
    await root.stack.groupCall.broadcastTopology(
      roomId,
      { ...topology, lastSeen: Date.now() },
      signature,
      root.wallet.publicKey,
      timestamp
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(eventsOf(other.gcallEvents, 'gcall:topology')).toContainEqual(
      expect.objectContaining({
        roomId,
        rootForwarder: root.wallet.address,
        topologyEpoch: 1,
      })
    );
  }, WAIT);

  // Two people: the root's only member is the audio's own source, so
  // nothing is relayed and no "You're relaying audio" note shows
  // (3+ member topologies: hostedCallManagers.test.ts).
  expect(root.stack.isRelayingAudio(roomId)).toBe(false);
  expect(root.stack.isRelayingAudio()).toBe(false);
  expect(other.stack.isRelayingAudio(roomId)).toBe(false);

  // Links only along topology edges (root ↔ member), both ends verified.
  await vi.waitFor(async () => {
    for (const peer of [alice, bob]) {
      const stats = await peer.stack.groupCall.getLinkStats!(roomId);
      expect(stats.stats?.establishedLinks).toBeGreaterThanOrEqual(1);
      expect(stats.stats?.participants).toBe(2);
    }
  }, WAIT);

  // Group audio from the root reaches the member with its address.
  const frame = new Uint8Array(80).fill(5);
  await vi.waitFor(async () => {
    await root.stack.groupCall.sendAudioBatch!(
      roomId,
      [other.wallet.address],
      frame
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(
      eventsOf(other.gcallEvents, 'gcall:audio').some(
        (p) => p.fromAddress === root.wallet.address
      )
    ).toBe(true);
  }, WAIT);
}
