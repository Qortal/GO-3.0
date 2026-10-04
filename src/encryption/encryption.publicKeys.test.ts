import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Group keys and Q-Mail are encrypted to public keys the node returns. These
// tests check that a key which does not derive the member's address stops the
// publish before anything is encrypted (GO-30).

const NODE = 'http://127.0.0.1:12391';

vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
vi.mock('../background/background.ts', () => ({
  getBaseApi: vi.fn(async () => 'http://127.0.0.1:12391'),
}));
vi.mock('../background/background', () => ({
  getBaseApi: vi.fn(async () => 'http://127.0.0.1:12391'),
}));
vi.mock('../qdn/publish/publish.ts', () => ({
  publishData: vi.fn(async () => ({ signature: 'PUBLISHED' })),
}));
vi.mock('../qdn/encryption/group-encryption.ts', () => ({
  createSymmetricKeyAndNonce: vi.fn(() => ({ messageKey: 'K', nonce: 'N' })),
  decryptGroupData: vi.fn(),
  encryptDataGroup: vi.fn(() => 'ENCRYPTED'),
  objectToBase64: vi.fn(async () => 'BASE64'),
}));
vi.mock('../utils/chromeStorage.ts', () => ({
  getData: vi.fn(async (key: string) => {
    if (key === 'keyPair') return { privateKey: 'PRIV', publicKey: 'PUB' };
    if (key === 'walletInfo') return { address0: 'QmyAddress' };
    throw new Error(`No ${key}`);
  }),
}));

import Base58Untyped from './Base58';
import publicKeyToAddressUntyped from '../utils/generateWallet/publicKeyToAddress';
import {
  encryptAndPublishSymmetricKeyGroupChat,
  encryptAndPublishSymmetricKeyGroupChatForAdmins,
  getPublicKeysByAddress,
  sendPrivateQmail,
} from './encryption';
import { encryptDataGroup } from '../qdn/encryption/group-encryption.ts';
import { publishData } from '../qdn/publish/publish.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const Base58 = Base58Untyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function account(fill: number) {
  const bytes = new Uint8Array(32).fill(fill);
  return {
    publicKey: Base58.encode(bytes) as string,
    address: String(publicKeyToAddress(bytes)),
  };
}

const alice = account(11);
const bob = account(12);
const mallory = account(13);

type Accounts = Record<string, { publicKey?: string }>;

/** A node with group 7 = [alice, bob] and the given account records. */
function stubNode(accounts: Accounts, extra: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    const path = url.slice(NODE.length);
    let body: unknown;
    if (path.startsWith('/groups/members/7')) {
      body = { members: [{ member: alice.address }, { member: bob.address }] };
    } else if (path.startsWith('/addresses/balance/')) {
      body = 100;
    } else if (path.startsWith('/transactions/unitfee')) {
      body = 1000000;
    } else if (path.startsWith('/names/primary/')) {
      body = { name: 'me' };
    } else if (path in extra) {
      body = extra[path];
    } else if (path.startsWith('/addresses/')) {
      const address = path.slice('/addresses/'.length);
      body = { address, ...(accounts[address] || {}) };
    } else {
      throw new Error(`unexpected request ${url}`);
    }
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
      ok: true,
      json: async () => body,
      text: async () => text,
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.mocked(encryptDataGroup).mockClear();
  vi.mocked(publishData).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('group key recipients (GO-30)', () => {
  it('returns the member keys when each derives its address', async () => {
    stubNode({
      [alice.address]: { publicKey: alice.publicKey },
      [bob.address]: { publicKey: bob.publicKey },
    });
    await expect(
      getPublicKeysByAddress([alice.address, bob.address])
    ).resolves.toEqual([alice.publicKey, bob.publicKey]);
  });

  it('refuses a member key the node substituted', async () => {
    stubNode({
      [alice.address]: { publicKey: alice.publicKey },
      [bob.address]: { publicKey: mallory.publicKey },
    });
    await expect(
      getPublicKeysByAddress([alice.address, bob.address])
    ).rejects.toThrow();
  });

  it('refuses a member list entry that is not an address', async () => {
    const fetchMock = stubNode({});
    await expect(getPublicKeysByAddress(['../admin/stop'])).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('publishes a new group key only to verified member keys', async () => {
    stubNode({
      [alice.address]: { publicKey: alice.publicKey },
      [bob.address]: { publicKey: bob.publicKey },
    });
    await encryptAndPublishSymmetricKeyGroupChat({
      groupId: 7,
      previousData: null,
    });
    expect(vi.mocked(encryptDataGroup).mock.calls[0][0].publicKeys).toEqual([
      alice.publicKey,
      bob.publicKey,
    ]);
    expect(publishData).toHaveBeenCalledTimes(1);
  });

  it('publishes nothing when one member key is substituted', async () => {
    stubNode({
      [alice.address]: { publicKey: alice.publicKey },
      [bob.address]: { publicKey: mallory.publicKey },
    });
    await expect(
      encryptAndPublishSymmetricKeyGroupChat({ groupId: 7, previousData: null })
    ).rejects.toThrow();
    expect(encryptDataGroup).not.toHaveBeenCalled();
    expect(publishData).not.toHaveBeenCalled();
  });

  it('publishes nothing for admins when an admin key is substituted', async () => {
    stubNode({ [alice.address]: { publicKey: mallory.publicKey } });
    await expect(
      encryptAndPublishSymmetricKeyGroupChatForAdmins({
        groupId: 7,
        previousData: {},
        admins: [{ address: alice.address }],
      } as any)
    ).rejects.toThrow();
    expect(publishData).not.toHaveBeenCalled();
  });
});

describe('sendPrivateQmail recipient key (GO-30)', () => {
  it('encrypts to the recipient key when it derives the owner address', async () => {
    stubNode(
      {},
      {
        '/names/alice': { name: 'alice', owner: alice.address },
        [`/addresses/publickey/${alice.address}`]: alice.publicKey,
      }
    );
    await sendPrivateQmail({
      recipientName: 'alice',
      subject: 's',
      htmlBody: '<p>b</p>',
    });
    expect(vi.mocked(encryptDataGroup).mock.calls[0][0].publicKeys).toEqual([
      alice.publicKey,
    ]);
    expect(publishData).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the node returns another key', async () => {
    stubNode(
      {},
      {
        '/names/alice': { name: 'alice', owner: alice.address },
        [`/addresses/publickey/${alice.address}`]: mallory.publicKey,
      }
    );
    await expect(
      sendPrivateQmail({
        recipientName: 'alice',
        subject: 's',
        htmlBody: '<p>b</p>',
      })
    ).rejects.toThrow();
    expect(encryptDataGroup).not.toHaveBeenCalled();
    expect(publishData).not.toHaveBeenCalled();
  });
});
