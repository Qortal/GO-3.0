import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ReticulumChatManager,
  type ReticulumChatManagerOptions,
  type ReticulumChatWire,
} from './reticulum-chat';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

const DEVICE_A_HASH = '4'.repeat(32);
const DEVICE_B_HASH = '5'.repeat(32);
const KEPT_GROUP = 1144;
const LEFT_GROUP = 1152;

type ReadSyncWire = Extract<ReticulumChatWire, { k: 'read_sync' }>;

const managers: ReticulumChatManager[] = [];
const tempPaths: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-read-replay-'));
  tempPaths.push(root);
  return path.join(root, 'reticulum-chat.db');
}

function createOwner() {
  const kp = nacl.sign.keyPair();
  const publicKey = base58Encode(kp.publicKey);
  const address = deriveAddressFromPublicKey(publicKey);
  const signer: NonNullable<
    ReticulumChatManagerOptions['signLocalFields']
  > = async (fields) => {
    const signature = nacl.sign.detached(
      new Uint8Array(
        canonicalizeForSigning({
          ...fields,
          authorAddress: address,
          authorPublicKey: publicKey,
        })
      ),
      kp.secretKey
    );
    return {
      authorAddress: address,
      authorPublicKey: publicKey,
      signature: base58Encode(signature),
    };
  };
  return { address, signer };
}

function membership(groupId: number, localAddress: string) {
  return { groupId, isPrivate: false, localAddress };
}

async function flushQueuedWork(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('read-sync replay to own devices', () => {
  it('stops replaying read state for a group the account no longer follows', async () => {
    const owner = createOwner();
    const sent: ReadSyncWire[] = [];
    const deviceA = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: owner.signer,
      hasGoodOverlayHealth: () => false,
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: DEVICE_B_HASH,
          address: owner.address,
          lastSeen: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => DEVICE_A_HASH,
        sendReticulumChatDetailed: async (
          _target: string,
          wire: ReticulumChatWire
        ) => {
          if (wire.k === 'read_sync') sent.push(wire);
          return { ok: true as const };
        },
      } as any,
    });
    managers.push(deviceA);
    const sentGroups = () => sent.map((wire) => wire.w.g).sort();

    deviceA.setLocalGroupMemberships([
      membership(KEPT_GROUP, owner.address),
      membership(LEFT_GROUP, owner.address),
    ]);
    const readAt = Date.now() - 1_000;
    deviceA.markRead(KEPT_GROUP, 'general', readAt, owner.address);
    deviceA.markRead(LEFT_GROUP, 'general', readAt, owner.address);
    await vi.waitUntil(() => sent.length >= 2, { timeout: 1_000 });
    expect(new Set(sentGroups())).toEqual(new Set([KEPT_GROUP, LEFT_GROUP]));
    // The other device would ACK; it has not, so both stay owed.
    expect((deviceA as any).db.getDeviceReadStates(owner.address)).toHaveLength(
      2
    );

    // The account leaves LEFT_GROUP. Its signed row stays in the database.
    deviceA.setLocalGroupMemberships([membership(KEPT_GROUP, owner.address)]);
    await flushQueuedWork();
    sent.length = 0;

    await (deviceA as any).replayReadStatesToOwnDevices();
    expect(sentGroups()).toEqual([KEPT_GROUP]);
    await (deviceA as any).replayReadStatesToOwnDevices();
    expect(sentGroups()).toEqual([KEPT_GROUP, KEPT_GROUP]);

    // Joining again replays the kept row; nothing was lost.
    sent.length = 0;
    deviceA.setLocalGroupMemberships([
      membership(KEPT_GROUP, owner.address),
      membership(LEFT_GROUP, owner.address),
    ]);
    await vi.waitUntil(() => sentGroups().includes(LEFT_GROUP), {
      timeout: 1_000,
    });
  });

  it('own devices drop and never ACK read state for a group they do not follow', async () => {
    const owner = createOwner();
    let captured: ReadSyncWire | null = null;
    const deviceA = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: owner.signer,
      hasGoodOverlayHealth: () => false,
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: DEVICE_B_HASH,
          address: owner.address,
          lastSeen: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => DEVICE_A_HASH,
        sendReticulumChatDetailed: async (
          _target: string,
          wire: ReticulumChatWire
        ) => {
          if (wire.k === 'read_sync') captured = wire;
          return { ok: true as const };
        },
      } as any,
    });
    const acks: ReticulumChatWire[] = [];
    const deviceB = new ReticulumChatManager({
      dbPath: tempDbPath(),
      hasGoodOverlayHealth: () => false,
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: DEVICE_A_HASH,
          address: owner.address,
          lastSeen: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => DEVICE_B_HASH,
        sendReticulumChatDetailed: async (
          _target: string,
          wire: ReticulumChatWire
        ) => {
          if (wire.k === 'read_sync_ack') acks.push(wire);
          return { ok: true as const };
        },
      } as any,
    });
    managers.push(deviceA, deviceB);
    deviceA.setLocalGroupMemberships([membership(LEFT_GROUP, owner.address)]);
    deviceB.setLocalGroupMemberships([membership(KEPT_GROUP, owner.address)]);
    const dropped = vi.spyOn(deviceB as any, 'noteReadSyncDropped');

    deviceA.markRead(LEFT_GROUP, 'general', Date.now() - 1_000, owner.address);
    await vi.waitUntil(() => captured != null, { timeout: 1_000 });
    deviceB.handleWire(captured as any, DEVICE_A_HASH);
    await flushQueuedWork();

    // This is why the sender must not keep replaying such rows: no ACK ever
    // comes back for them.
    expect(dropped).toHaveBeenCalledWith('unknown-group', DEVICE_A_HASH);
    expect(acks).toEqual([]);
  });
});
