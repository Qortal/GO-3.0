/**
 * One caller, one callee signed in on two devices, everything on the
 * UNMODIFIED Hub CallManager behind GO's adapters (fake python, real wallet
 * signatures; same shims as hostedCallManagers.integration.test.ts). The
 * callee answers on one device; the other must stop ringing.
 */
import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WAIT,
  disposeScenarioStacks,
  eventsOf,
  makePeer,
  placeCall,
  registerLocal,
  type Peer,
} from './testing/callScenarios';
import { FakePythonNetwork } from './testing/fakePythonNetwork';
import { TestWallet } from './testing/testWallet';
import { installFreshRingingCancel } from './freshRingingCancel';
import type { CallManager } from '../../../electron/src/call';

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
  const verbose = process.env.GO_CALL_TEST_LOGS === '1';
  const out = (...args: unknown[]) => {
    if (verbose) console.log(...args);
  };
  return { log: out, warn: out, error: out, debug: out, info: out };
});

afterEach(() => {
  disposeScenarioStacks();
  vi.restoreAllMocks();
});

/** Moves Date.now (signatures, skew checks) without touching timers. */
function shiftableClock(): { advance(ms: number): void } {
  const realNow = Date.now.bind(Date);
  let offset = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
  return {
    advance: (ms) => {
      offset += ms;
    },
  };
}

function knows(peer: Peer, address: string, devices: Peer[]): void {
  peer.endpoints.set(
    address,
    devices.map((device) => ({
      destinationHash: device.dest,
      lastSeen: Date.now(),
    }))
  );
}

async function twoDeviceCall(options: {
  freshCancel: boolean;
  callerKnowsSecondDeviceAtStart: boolean;
}) {
  const network = new FakePythonNetwork();
  const alice = makePeer(network, 'alice', 0x31, 0xa1, {
    signCallFieldsWithWallet: options.freshCancel,
  });
  // Same account (wallet seed) on two devices.
  const bobPhone = makePeer(network, 'bob-phone', 0x32, 0xb1);
  const bobHub = makePeer(network, 'bob-hub', 0x32, 0xb2);
  const bob = bobPhone.wallet.address;
  knows(
    alice,
    bob,
    options.callerKnowsSecondDeviceAtStart ? [bobPhone, bobHub] : [bobPhone]
  );
  knows(bobPhone, alice.wallet.address, [alice]);
  knows(bobHub, alice.wallet.address, [alice]);
  for (const peer of [alice, bobPhone, bobHub]) await registerLocal(peer);

  const { callId } = await placeCall(alice, bobPhone);
  // The flood reaches both devices, also one the caller had no route to.
  await vi.waitFor(() => {
    expect(eventsOf(bobPhone.callEvents, 'call:incoming')).toHaveLength(1);
    expect(eventsOf(bobHub.callEvents, 'call:incoming')).toHaveLength(1);
  }, WAIT);
  return { alice, bobPhone, bobHub, callId };
}

async function answer(device: Peer, callId: string): Promise<void> {
  const ts = Date.now();
  expect(
    await device.stack.call.accept(
      callId,
      device.wallet.sign({ type: 'CALL_ACCEPT', callId, timestamp: ts }),
      device.wallet.publicKey,
      ts
    )
  ).toEqual({ success: true });
}

function cancelsSentTo(caller: Peer, dest: string) {
  return caller.node
    .commandsOf('send_call')
    .filter(
      (c) =>
        c.payload.peerPresenceHash === dest &&
        (c.payload.message as { t?: string }).t === 'CH'
    )
    .map((c) => c.payload.message as Record<string, unknown>);
}

/** Lets in-flight signing, sends and verifies settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

describe('fresh ringing cancel (callee on two devices)', () => {
  it('answer after 45 s: the other device stops ringing', async () => {
    const clock = shiftableClock();
    const { alice, bobPhone, bobHub, callId } = await twoDeviceCall({
      freshCancel: true,
      callerKnowsSecondDeviceAtStart: true,
    });
    clock.advance(45_000);
    await answer(bobPhone, callId);

    await vi.waitFor(
      () =>
        expect(eventsOf(bobHub.callEvents, 'call:hangup')).toEqual([
          { callId },
        ]),
      WAIT
    );
    expect(eventsOf(alice.callEvents, 'call:accepted')).toEqual([{ callId }]);
    await settle();
    // The answering device is never cancelled.
    expect(eventsOf(bobPhone.callEvents, 'call:hangup')).toEqual([]);
    expect(cancelsSentTo(alice, bobPhone.dest)).toEqual([]);
    // Hub's own pre-signed copy + GO's fresh one, same wire shape.
    const cancels = cancelsSentTo(alice, bobHub.dest);
    expect(cancels).toHaveLength(2);
    expect(Object.keys(cancels[1]).sort()).toEqual(
      Object.keys(cancels[0]).sort()
    );
    expect(cancels[1].m as number).toBeGreaterThanOrEqual(
      (cancels[0].m as number) + 45_000
    );
  }, 30_000);

  it('without it (Hub as is), a 45 s answer leaves the other device ringing', async () => {
    const clock = shiftableClock();
    const { alice, bobPhone, bobHub, callId } = await twoDeviceCall({
      freshCancel: false,
      callerKnowsSecondDeviceAtStart: true,
    });
    clock.advance(45_000);
    await answer(bobPhone, callId);
    await vi.waitFor(
      () =>
        expect(eventsOf(alice.callEvents, 'call:accepted')).toEqual([
          { callId },
        ]),
      WAIT
    );
    // Hub sent its pre-signed cancel; the device dropped it as too old.
    await vi.waitFor(
      () => expect(cancelsSentTo(alice, bobHub.dest)).toHaveLength(1),
      WAIT
    );
    await settle();
    expect(eventsOf(bobHub.callEvents, 'call:hangup')).toEqual([]);
  }, 30_000);

  it('a device the caller only learned about while ringing is cancelled too', async () => {
    const { alice, bobPhone, bobHub, callId } = await twoDeviceCall({
      freshCancel: true,
      callerKnowsSecondDeviceAtStart: false,
    });
    // Presence for the second device shows up while the call rings.
    knows(alice, bobPhone.wallet.address, [bobPhone, bobHub]);
    await answer(bobPhone, callId);

    await vi.waitFor(
      () =>
        expect(eventsOf(bobHub.callEvents, 'call:hangup')).toEqual([
          { callId },
        ]),
      WAIT
    );
    await settle();
    expect(eventsOf(bobPhone.callEvents, 'call:hangup')).toEqual([]);
    expect(cancelsSentTo(alice, bobHub.dest)).toHaveLength(1);
  }, 30_000);

  it('a quick answer with one device known sends nothing extra', async () => {
    const network = new FakePythonNetwork();
    const alice = makePeer(network, 'alice', 0x33, 0xa3, {
      signCallFieldsWithWallet: true,
    });
    const bobPhone = makePeer(network, 'bob-phone', 0x34, 0xb3);
    knows(alice, bobPhone.wallet.address, [bobPhone]);
    knows(bobPhone, alice.wallet.address, [alice]);
    await registerLocal(alice);
    await registerLocal(bobPhone);
    const { callId } = await placeCall(alice, bobPhone);
    await vi.waitFor(
      () =>
        expect(eventsOf(bobPhone.callEvents, 'call:incoming')).toHaveLength(1),
      WAIT
    );
    const signedBefore = alice.wallet.signed.length;
    await answer(bobPhone, callId);
    await vi.waitFor(
      () =>
        expect(eventsOf(alice.callEvents, 'call:accepted')).toEqual([
          { callId },
        ]),
      WAIT
    );
    await settle();
    expect(alice.wallet.signed.length).toBe(signedBefore);
    expect(eventsOf(bobPhone.callEvents, 'call:hangup')).toEqual([]);
  }, 30_000);
});

describe('installFreshRingingCancel guards', () => {
  type FakeRecord = Record<string, unknown>;

  function fakeManager(record: FakeRecord | null) {
    const sent: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const manager = Object.assign(new EventEmitter(), {
      activeCalls: new Map<string, FakeRecord>(
        record ? [['call-1', record]] : []
      ),
      sendPinnedCallWireWhenReady(peer: string, wire: Record<string, unknown>) {
        sent.push({ peer, wire });
      },
    });
    return { manager: manager as unknown as CallManager, sent };
  }

  const caller = new TestWallet(0x41);
  const other = new TestWallet(0x42);
  const acceptedRecord = (): FakeRecord => ({
    localAddress: caller.address,
    remoteAddress: 'QCallee',
    direction: 'outbound',
    state: 'active',
    acceptedReticulumPeerHash: 'AA'.repeat(16),
    invitedReticulumPeerHashes: new Set(['aa'.repeat(16), 'bb'.repeat(16)]),
    cancellationSignature: 'presigned',
    cancellationPublicKey: caller.publicKey,
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('is off when the manager internals are not there', () => {
    const result = installFreshRingingCancel(
      new EventEmitter() as unknown as CallManager,
      { sign: async () => 'x', getEndpoints: () => [] }
    );
    expect(result.installed).toBe(false);
  });

  it('never sends a signature that does not verify for the caller', async () => {
    const { manager, sent } = fakeManager(acceptedRecord());
    installFreshRingingCancel(manager, {
      sign: async (fields) => other.sign(fields),
      getEndpoints: () => [],
    });
    manager.emit('call:accepted', { callId: 'call-1' });
    await flush();
    expect(sent).toEqual([]);
  });

  it('skips calls without a pre-signed cancellation, inbound and pending ones', async () => {
    for (const patch of [
      { cancellationSignature: '' },
      { direction: 'inbound' },
      { state: 'pending' },
    ]) {
      const { manager, sent } = fakeManager({ ...acceptedRecord(), ...patch });
      const sign = vi.fn(async (fields) => caller.sign(fields));
      installFreshRingingCancel(manager, { sign, getEndpoints: () => [] });
      manager.emit('call:accepted', { callId: 'call-1' });
      await flush();
      expect(sign).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    }
  });

  it('pins one fresh CH to every other endpoint, case-insensitively', async () => {
    const { manager, sent } = fakeManager(acceptedRecord());
    installFreshRingingCancel(manager, {
      sign: async (fields) => caller.sign(fields),
      getEndpoints: () => ['BB'.repeat(16), 'cc'.repeat(16), 'aa'.repeat(16)],
      now: () => Date.now(),
    });
    manager.emit('call:accepted', { callId: 'call-1' });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((s) => s.peer).sort()).toEqual([
      'bb'.repeat(16),
      'cc'.repeat(16),
    ]);
    expect(sent[0].wire).toEqual({
      t: 'CH',
      c: 'call-1',
      k: caller.publicKey,
      g: expect.any(String),
      m: expect.any(Number),
    });
    expect(sent[1].wire).toBe(sent[0].wire);
  });

  it('stops after dispose', async () => {
    const { manager, sent } = fakeManager(acceptedRecord());
    const handle = installFreshRingingCancel(manager, {
      sign: async (fields) => caller.sign(fields),
      getEndpoints: () => [],
    });
    manager.emit('call:accepted', { callId: 'call-1' });
    handle.dispose();
    await flush();
    manager.emit('call:accepted', { callId: 'call-1' });
    await flush();
    expect(sent).toEqual([]);
  });
});
