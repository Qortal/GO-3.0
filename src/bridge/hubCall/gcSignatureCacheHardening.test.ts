/**
 * Hub bug H1 (note 02 §7): GroupCallManager trusts a cached `type:signature`
 * for a DIFFERENT envelope. Reproduced against the unmodified manager, then
 * shown fixed by hardenGroupCallSignatureCache (GO-side, per instance).
 */
import { describe, expect, it, vi } from 'vitest';
import { GroupCallManager } from '../../../electron/src/group-call';
import { encodeJoinWire } from '../../../electron/src/group-call-wire-reticulum';
import { verifyGcDetached } from '../../../electron/src/ed25519-verify-common';
import { hardenGroupCallSignatureCache } from './gcSignatureCacheHardening';
import { TestWallet } from './testing/testWallet';

vi.mock(
  'crypto',
  async () => await import('../../reticulumChat/mobile/shims/crypto')
);
vi.mock(
  '../../../electron/src/presence',
  async () => await import('../../reticulumChat/mobile/shims/presence-slim')
);
vi.mock('../../../electron/src/logger', () => {
  const out = () => {};
  return { log: out, warn: out, error: out, debug: out, info: out };
});

const ROOM = 'gcall-dm-test-room';
const CHAT = 'c';

function setup(harden: boolean) {
  const presence = {
    getRouteForAddress: () => null,
    getRoutesForAddress: () => [],
  };
  const mgr = new GroupCallManager(presence as never, null);
  let verifyCalls = 0;
  (mgr as unknown as { verifyPool: unknown }).verifyPool = {
    start() {},
    stop() {},
    verify: async (p: {
      fields: Record<string, unknown>;
      signature: string;
      fromPublicKey: string;
      fromAddress: string;
    }) => {
      verifyCalls++;
      return verifyGcDetached(
        p.fields,
        p.signature,
        p.fromPublicKey,
        p.fromAddress
      );
    },
  };
  if (harden) expect(hardenGroupCallSignatureCache(mgr)).toBe(true);
  const local = new TestWallet(50);
  mgr.setLocalAddresses([local.address]);
  const ts = Date.now();
  const localDest = 'aa'.repeat(16);
  mgr.joinRoom(
    ROOM,
    CHAT,
    local.address,
    local.sign({
      type: 'GC_JOIN',
      roomId: ROOM,
      chatId: CHAT,
      fromAddress: local.address,
      fromPublicKey: local.publicKey,
      timestamp: ts,
      reticulumDestinationHash: localDest,
    }),
    local.publicKey,
    ts,
    localDest
  );
  return { mgr, verifyCalls: () => verifyCalls };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

async function scenario(harden: boolean) {
  const { mgr, verifyCalls } = setup(harden);
  const alice = new TestWallet(51);
  const mallory = new TestWallet(52);
  const ts = Date.now();
  const aliceSig = alice.sign({
    type: 'GC_JOIN',
    roomId: ROOM,
    chatId: CHAT,
    fromAddress: alice.address,
    fromPublicKey: alice.publicKey,
    timestamp: ts,
    reticulumDestinationHash: 'bb'.repeat(16),
  });
  const handle = (wire: Record<string, unknown>, hash: string) =>
    (
      mgr as unknown as {
        handleReticulumGroupCallWire(
          w: Record<string, unknown>,
          s: string,
          p: string,
          l: string
        ): void;
      }
    ).handleReticulumGroupCallWire(wire, hash, hash, '');
  const legit = encodeJoinWire({
    roomId: ROOM,
    chatId: CHAT,
    fromAddress: alice.address,
    fromPublicKey: alice.publicKey,
    signature: aliceSig,
    timestamp: ts,
    reticulumDestinationHash: 'bb'.repeat(16),
  } as never);
  handle({ ...legit, X: 'x1', L: 0 }, 'bb'.repeat(16));
  await flush();
  const afterLegit = verifyCalls();
  // A second copy of the genuine frame (new overlay id) still hits the cache.
  handle({ ...legit, X: 'x2', L: 0 }, 'bb'.repeat(16));
  await flush();
  const afterDuplicate = verifyCalls();
  // Forged: Alice's signature, Mallory's identity/destination/timestamp.
  const forged = encodeJoinWire({
    roomId: ROOM,
    chatId: CHAT,
    fromAddress: mallory.address,
    fromPublicKey: mallory.publicKey,
    signature: aliceSig,
    timestamp: Date.now() + 5,
    reticulumDestinationHash: 'cc'.repeat(16),
  } as never);
  handle({ ...forged }, 'cc'.repeat(16));
  await flush();
  const participants = mgr.getRoomParticipants(ROOM).map((p) => p.address);
  mgr.stop();
  return {
    afterLegit,
    duplicateVerifies: afterDuplicate - afterLegit,
    forgedVerifies: verifyCalls() - afterDuplicate,
    aliceJoined: participants.includes(alice.address),
    malloryJoined: participants.includes(mallory.address),
  };
}

describe('GroupCallManager signature cache (Hub H1) on GO', () => {
  it('unmodified manager applies a forged GJ without verifying it (the bug)', async () => {
    const result = await scenario(false);
    expect(result.aliceJoined).toBe(true);
    expect(result.forgedVerifies).toBe(0);
    expect(result.malloryJoined).toBe(true);
  });

  it('hardened manager re-verifies and rejects it, genuine duplicates still cached', async () => {
    const result = await scenario(true);
    expect(result.afterLegit).toBe(1);
    expect(result.aliceJoined).toBe(true);
    expect(result.duplicateVerifies).toBe(0);
    expect(result.forgedVerifies).toBe(1);
    expect(result.malloryJoined).toBe(false);
  });

  it('refuses to patch a manager whose internals changed', () => {
    expect(hardenGroupCallSignatureCache({})).toBe(false);
  });
});
