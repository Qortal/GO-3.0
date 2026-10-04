import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// Loads the real background.ts (src/test/setup.ts mocks it for every other
// test) with storage and its heaviest imports replaced, so the payment and
// key checks run against a fake node end to end: what is signed, what is
// sent, and what is refused before signing.

const storage = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));
const NODE = 'http://127.0.0.1:12391';

vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
vi.mock('../../utils/chromeStorage', () => ({
  getData: vi.fn(async (key: string) => {
    if (key in storage.values) return storage.values[key];
    throw new Error(`No ${key} in storage`);
  }),
  storeData: vi.fn(async () => undefined),
  removeKeysAndLogout: vi.fn(async () => undefined),
}));
vi.mock('../../qortal/qortal-requests.ts', () => ({
  getNotificationOsPushDisabled: vi.fn(() => false),
}));
vi.mock('../../qortal/qortal-requests', () => ({
  getNotificationOsPushDisabled: vi.fn(() => false),
}));
vi.mock('../background-cases', () => ({}));
// Chat proof of work is skipped: the fake node accepts any nonce.
vi.mock('../../chatComputePow.worker.js?worker', () => ({
  default: class {
    onmessage: ((event: { data: unknown }) => void) | null = null;

    postMessage(task: { chatBytes: ArrayLike<number> }) {
      const chatBytesArray = Uint8Array.from(Object.values(task.chatBytes));
      void Promise.resolve().then(() =>
        this.onmessage?.({ data: { nonce: 1, chatBytesArray } })
      );
    }
  },
}));
// The real builder, wrapped so tests can see what was encrypted to whom.
vi.mock('../../transactions/transactions', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../transactions/transactions')>();
  return { ...actual, createTransaction: vi.fn(actual.createTransaction) };
});
// publish.ts reads the node from the (mocked) background module; answer its
// fee lookup from the same fake node.
const publishMock = vi.hoisted(() => () => ({
  reusableGet: async (endpoint: string) => {
    const response = await fetch(`http://127.0.0.1:12391${endpoint}`);
    return response.json();
  },
}));
vi.mock('../../qdn/publish/publish.ts', publishMock);
vi.mock('../../qdn/publish/publish', publishMock);

import { Sha256 } from 'asmcrypto.js';
import Base58Untyped from '../../encryption/Base58';
import naclUntyped from '../../encryption/nacl-fast';
import publicKeyToAddressUntyped from '../../utils/generateWallet/publicKeyToAddress';
import { PublicKeyMismatchError } from '../../encryption/addressKeyCheck';
import {
  FeeNotApprovedError,
  InvalidRecipientError,
  RecipientNameNotFoundError,
} from '../../transactions/paymentSafety';
import { TransactionRejectedError } from '../../transactions/submitSignedOnce';
import { createTransaction } from '../../transactions/transactions';

/* eslint-disable @typescript-eslint/no-explicit-any */
const Base58 = Base58Untyped as any;
const nacl = naclUntyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

type Background = typeof import('../background');
let bg: Background;

function keyPairFromSeed(fill: number) {
  const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(fill));
  return {
    privateKey: Base58.encode(pair.secretKey) as string,
    publicKey: Base58.encode(pair.publicKey) as string,
    publicKeyBytes: pair.publicKey as Uint8Array,
    address: String(publicKeyToAddress(pair.publicKey)),
  };
}

/** An AT (smart contract) address: version 23, so it starts with "A". */
function atAddress(fill: number): string {
  const body = new Uint8Array(21).fill(fill);
  body[0] = 23;
  const first = new Sha256().process(body).finish().result;
  const checksum = new Sha256().process(first).finish().result.slice(0, 4);
  const bytes = new Uint8Array(25);
  bytes.set(body);
  bytes.set(checksum, 21);
  return Base58.encode(bytes) as string;
}

/** `address` with its last character changed: same length, bad checksum. */
function withTypo(address: string): string {
  const last = address[address.length - 1];
  return address.slice(0, -1) + (last === 'z' ? 'y' : 'z');
}

const me = keyPairFromSeed(1);
const alice = keyPairFromSeed(2);
const mallory = keyPairFromSeed(3);
const crowdfund = atAddress(7);
const LAST_REFERENCE = Base58.encode(new Uint8Array(64).fill(9)) as string;
const NODE_FEE_ATOMIC = '1000000'; // 0.01 QORT

type Reply = unknown | Error | ((url: string, init?: RequestInit) => unknown);

type NodeScript = {
  fee?: string;
  process?: Reply[];
  lookup?: Reply;
  name?: Reply;
  publicKey?: Reply;
};

function response(body: unknown, ok = true) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const json = async () => {
    if (typeof body === 'string') return JSON.parse(body);
    return body;
  };
  return {
    ok,
    status: ok ? 200 : 404,
    json,
    text: async () => text,
    clone: () => ({ json, text: async () => text }),
  };
}

function resolveReply(reply: Reply, url: string, init?: RequestInit) {
  const value = typeof reply === 'function' ? reply(url, init) : reply;
  if (value instanceof Error) throw value;
  return value;
}

/** A fake node answering by path; records every request. */
function stubNode(script: NodeScript) {
  const processReplies = [...(script.process ?? [])];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.slice(url.indexOf('/', 'http://'.length));
    if (path.startsWith('/addresses/lastreference/')) {
      return response(LAST_REFERENCE);
    }
    if (path.startsWith('/transactions/unitfee')) {
      return response(script.fee ?? NODE_FEE_ATOMIC);
    }
    if (path.startsWith('/transactions/process')) {
      const reply =
        processReplies.length > 1 ? processReplies.shift() : processReplies[0];
      return response(resolveReply(reply, url, init));
    }
    if (path.startsWith('/transactions/signature/')) {
      const record = resolveReply(script.lookup ?? null, url, init);
      return record ? response(record) : response({ error: 311 }, false);
    }
    if (path.startsWith('/names/')) {
      return response(resolveReply(script.name ?? { error: 401 }, url, init));
    }
    if (path.startsWith('/addresses/publickey/')) {
      return response(resolveReply(script.publicKey ?? 'false', url, init));
    }
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const posts = (fetchMock: ReturnType<typeof stubNode>) =>
  fetchMock.mock.calls.filter(([url]) =>
    String(url).includes('/transactions/process')
  );

/** Field offsets in signed PAYMENT / TRANSFER_ASSET bytes. */
function readInt64(bytes: Uint8Array, offset: number): number {
  let value = 0;
  for (let i = 0; i < 8; i++) value = value * 256 + bytes[offset + i];
  return value;
}
const BASE_BYTES = 4 + 8 + 4 + 64 + 32; // type, timestamp, group, ref, key
const ADDRESS_BYTES = 25;

beforeAll(async () => {
  bg = await vi.importActual<Background>('../background');
});

beforeEach(() => {
  storage.values = {
    apiKey: { url: NODE, apikey: '' },
    walletInfo: { address0: me.address },
    keyPair: { privateKey: me.privateKey, publicKey: me.publicKey },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.mocked(createTransaction).mockClear();
});

/** The recipient address in signed PAYMENT / TRANSFER_ASSET bytes. */
function signedRecipient(fetchMock: ReturnType<typeof stubNode>): string {
  const sent = posts(fetchMock);
  const bytes = Base58.decode(String(sent[0][1]?.body)) as Uint8Array;
  return Base58.encode(bytes.slice(BASE_BYTES, BASE_BYTES + ADDRESS_BYTES));
}

describe('transferAsset (N-24, GO-19)', () => {
  it('signs once and resends the same bytes after a lost reply', async () => {
    vi.useFakeTimers();
    let signature = '';
    const fetchMock = stubNode({
      process: [
        new TypeError('Failed to fetch'),
        (_url, init) => {
          const bytes = Base58.decode(String(init?.body)) as Uint8Array;
          signature = Base58.encode(bytes.slice(bytes.length - 64));
          return { signature, type: 'TRANSFER_ASSET' };
        },
      ],
    });

    const result = bg.transferAsset({
      amount: '2.5',
      recipient: alice.address,
      assetId: 1,
      approvedFee: '0.01000000',
    });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ signature });

    const sent = posts(fetchMock);
    expect(sent).toHaveLength(2);
    expect(sent[0][1]?.body).toBe(sent[1][1]?.body);

    const bytes = Base58.decode(String(sent[0][1]?.body)) as Uint8Array;
    const unsigned = bytes.slice(0, bytes.length - 64);
    expect(
      nacl.sign.detached.verify(
        unsigned,
        bytes.slice(bytes.length - 64),
        me.publicKeyBytes
      )
    ).toBe(true);
    const recipient = Base58.encode(
      bytes.slice(BASE_BYTES, BASE_BYTES + ADDRESS_BYTES)
    );
    expect(recipient).toBe(alice.address);
    // recipient, asset id, amount, fee
    const amountOffset = BASE_BYTES + ADDRESS_BYTES + 8;
    expect(readInt64(bytes, amountOffset)).toBe(250000000);
    expect(readInt64(bytes, amountOffset + 8)).toBe(1000000);
  });

  it('accepts a transfer the node took but answered with an error', async () => {
    let signature = '';
    const fetchMock = stubNode({
      process: [
        (_url, init) => {
          const bytes = Base58.decode(String(init?.body)) as Uint8Array;
          signature = Base58.encode(bytes.slice(bytes.length - 64));
          return { error: 1000, message: 'timeout' };
        },
      ],
      lookup: () => ({ signature, type: 'TRANSFER_ASSET' }),
    });

    const result = await bg.transferAsset({
      amount: 1,
      recipient: alice.address,
      assetId: 0,
    });
    expect(signature).not.toBe('');
    expect(result).toMatchObject({ signature, type: 'TRANSFER_ASSET' });
    expect(posts(fetchMock)).toHaveLength(1);
  });

  it('stops at a Core rejection without signing or sending again', async () => {
    const fetchMock = stubNode({
      process: [{ error: 2, message: 'NO_BALANCE' }],
    });
    await expect(
      bg.transferAsset({ amount: 1, recipient: alice.address, assetId: 0 })
    ).rejects.toBeInstanceOf(TransactionRejectedError);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  it('refuses a node fee above the approved fee before signing', async () => {
    const fetchMock = stubNode({ fee: '5000000' }); // 0.05 QORT
    await expect(
      bg.transferAsset({
        amount: 1,
        recipient: alice.address,
        assetId: 0,
        approvedFee: '0.01000000',
      })
    ).rejects.toBeInstanceOf(FeeNotApprovedError);
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('refuses a fee above the ceiling even without an approved fee', async () => {
    const fetchMock = stubNode({ fee: String(500 * 1e8) });
    await expect(
      bg.transferAsset({ amount: 1, recipient: alice.address, assetId: 0 })
    ).rejects.toBeInstanceOf(FeeNotApprovedError);
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('transfers to an AT address ("A…")', async () => {
    const fetchMock = stubNode({
      process: [
        (_url, init) => {
          const bytes = Base58.decode(String(init?.body)) as Uint8Array;
          return { signature: Base58.encode(bytes.slice(bytes.length - 64)) };
        },
      ],
    });
    await expect(
      bg.transferAsset({ amount: 1, recipient: crowdfund, assetId: 0 })
    ).resolves.toHaveProperty('signature');
    expect(signedRecipient(fetchMock)).toBe(crowdfund);
  });

  it('refuses a recipient that is not an address, and a bad amount', async () => {
    const fetchMock = stubNode({});
    await expect(
      bg.transferAsset({ amount: 1, recipient: 'alice', assetId: 0 })
    ).rejects.toBeInstanceOf(InvalidRecipientError);
    await expect(
      bg.transferAsset({
        amount: 1,
        recipient: withTypo(alice.address),
        assetId: 0,
      })
    ).rejects.toBeInstanceOf(InvalidRecipientError);
    await expect(
      bg.transferAsset({ amount: '1e3', recipient: alice.address, assetId: 0 })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sendCoin fee cap (GO-19)', () => {
  it('signs the approved fee and amount for the given address', async () => {
    const fetchMock = stubNode({
      process: [(_url, init) => ({ signature: 'x', body: init?.body })],
    });
    const { res } = await bg.sendCoin(
      { amount: 1.5, receiver: alice.address, approvedFee: '0.01000000' },
      true
    );
    expect(res.success).toBe(true);
    const sent = posts(fetchMock);
    expect(sent).toHaveLength(1);
    const bytes = Base58.decode(String(sent[0][1]?.body)) as Uint8Array;
    const recipient = Base58.encode(
      bytes.slice(BASE_BYTES, BASE_BYTES + ADDRESS_BYTES)
    );
    expect(recipient).toBe(alice.address);
    const amountOffset = BASE_BYTES + ADDRESS_BYTES;
    expect(readInt64(bytes, amountOffset)).toBe(150000000);
    expect(readInt64(bytes, amountOffset + 8)).toBe(1000000);
  });

  it('refuses when the node raises the fee after approval', async () => {
    const fetchMock = stubNode({ fee: String(4e7) }); // 0.4 QORT
    await expect(
      bg.sendCoin(
        { amount: 1, receiver: alice.address, approvedFee: '0.01000000' },
        true
      )
    ).rejects.toThrow(/0\.4.*0\.01/);
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('pays an AT address ("A…") without looking it up as a name', async () => {
    const fetchMock = stubNode({
      process: [{ signature: 'x' }],
    });
    await bg.sendCoin(
      { amount: 2, receiver: crowdfund, approvedFee: '0.01000000' },
      true
    );
    expect(signedRecipient(fetchMock)).toBe(crowdfund);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/names/'))
    ).toBe(false);
  });

  it('refuses a fee above the ceiling when no fee was approved', async () => {
    const fetchMock = stubNode({ fee: String(90 * 1e8) });
    await expect(
      bg.sendCoin({ amount: 1, receiver: alice.address }, true)
    ).rejects.toThrow();
    expect(posts(fetchMock)).toHaveLength(0);
  });
});

describe('resolveRecipient (GO-20)', () => {
  it('returns an address as given, without asking the node', async () => {
    const fetchMock = stubNode({});
    await expect(bg.resolveRecipient(` ${alice.address} `)).resolves.toEqual({
      address: alice.address,
      name: '',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an AT address ("A…") as given, without asking the node', async () => {
    const fetchMock = stubNode({});
    await expect(bg.resolveRecipient(crowdfund)).resolves.toEqual({
      address: crowdfund,
      name: '',
    });
    await expect(bg.getNameOrAddress(crowdfund)).resolves.toBe(crowdfund);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a mistyped address without looking it up as a name', async () => {
    const fetchMock = stubNode({ name: { name: 'x', owner: alice.address } });
    for (const typo of [withTypo(alice.address), withTypo(crowdfund)]) {
      await expect(bg.resolveRecipient(typo)).rejects.toBeInstanceOf(
        InvalidRecipientError
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('encodes the name in the path and returns the owner and name', async () => {
    const fetchMock = stubNode({
      name: { name: 'Who?#1', owner: alice.address },
    });
    await expect(bg.resolveRecipient('Who?#1')).resolves.toEqual({
      address: alice.address,
      name: 'Who?#1',
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${NODE}/names/Who%3F%231`);
  });

  it.each(['../admin/stop', 'a/b', 'a\\b', '..', 'a  b', ''])(
    'refuses %j without asking the node',
    async (name) => {
      const fetchMock = stubNode({});
      await expect(bg.resolveRecipient(name)).rejects.toBeInstanceOf(
        InvalidRecipientError
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('refuses an owner that is not a valid address', async () => {
    stubNode({ name: { name: 'alice', owner: 'QnotAnAddress' } });
    await expect(bg.resolveRecipient('alice')).rejects.toBeInstanceOf(
      InvalidRecipientError
    );
  });

  it('reports an unknown name', async () => {
    stubNode({ name: { error: 401, message: 'name unknown' } });
    await expect(bg.resolveRecipient('nobody')).rejects.toBeInstanceOf(
      RecipientNameNotFoundError
    );
    await expect(bg.getNameOrAddress('nobody')).rejects.toThrow();
  });
});

describe('getPublicKey (GO-30)', () => {
  it('returns the key when it derives the address', async () => {
    stubNode({ publicKey: `${alice.publicKey}\n` });
    await expect(bg.getPublicKey(alice.address)).resolves.toBe(alice.publicKey);
  });

  it('refuses a key the node substituted', async () => {
    stubNode({ publicKey: mallory.publicKey });
    const expected = new PublicKeyMismatchError(alice.address).message;
    await expect(bg.getPublicKey(alice.address)).rejects.toThrow(expected);
  });

  it('refuses a non-address without asking the node', async () => {
    const fetchMock = stubNode({});
    await expect(bg.getPublicKey('../admin/stop')).rejects.toThrow();
    // An AT has no key of its own.
    await expect(bg.getPublicKey(crowdfund)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sendChatDirect recipient key (GO-30)', () => {
  const chatPosts = (fetchMock: ReturnType<typeof stubNode>) =>
    posts(fetchMock).filter(([url]) => String(url).includes('apiVersion=2'));
  const keyLookups = (fetchMock: ReturnType<typeof stubNode>) =>
    fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/addresses/publickey/')
    );
  const encryptedTo = () =>
    vi
      .mocked(createTransaction)
      .mock.calls.filter(([type]) => type === 18)
      .map(([, , params]) => params as { recipientPublicKey: string });

  it('uses a caller key that belongs to the recipient without asking the node', async () => {
    const fetchMock = stubNode({ process: [{ signature: 'CHAT_SIG' }] });
    await expect(
      bg.sendChatDirect({
        address: alice.address,
        directTo: alice.address,
        typeMessage: undefined,
        chatReference: undefined,
        messageText: 'hi',
        publicKeyOfRecipient: alice.publicKey,
        otherData: undefined,
      })
    ).resolves.toMatchObject({ signature: 'CHAT_SIG' });
    expect(keyLookups(fetchMock)).toHaveLength(0);
    expect(encryptedTo()).toEqual([
      expect.objectContaining({
        recipient: alice.address,
        recipientPublicKey: alice.publicKey,
      }),
    ]);
  });

  it("replaces a cached key that is not the recipient's with a checked one", async () => {
    const fetchMock = stubNode({
      publicKey: alice.publicKey,
      process: [{ signature: 'CHAT_SIG' }],
    });
    await expect(
      bg.sendChatDirect({
        address: alice.address,
        directTo: alice.address,
        typeMessage: undefined,
        chatReference: undefined,
        messageText: 'hi',
        publicKeyOfRecipient: mallory.publicKey,
        otherData: undefined,
      })
    ).resolves.toMatchObject({ signature: 'CHAT_SIG' });
    expect(String(keyLookups(fetchMock)[0]?.[0])).toBe(
      `${NODE}/addresses/publickey/${alice.address}`
    );
    expect(encryptedTo()).toEqual([
      expect.objectContaining({
        recipient: alice.address,
        recipientPublicKey: alice.publicKey,
      }),
    ]);
    expect(chatPosts(fetchMock)).toHaveLength(1);
  });

  it('encrypts and sends nothing when the node also returns a wrong key', async () => {
    const fetchMock = stubNode({
      publicKey: mallory.publicKey,
      process: [{ signature: 'CHAT_SIG' }],
    });
    await expect(
      bg.sendChatDirect({
        address: alice.address,
        directTo: alice.address,
        typeMessage: undefined,
        chatReference: undefined,
        messageText: 'hi',
        publicKeyOfRecipient: mallory.publicKey,
        otherData: undefined,
      })
    ).rejects.toThrow(new PublicKeyMismatchError(alice.address).message);
    expect(encryptedTo()).toHaveLength(0);
    expect(chatPosts(fetchMock)).toHaveLength(0);
  });
});

describe('lookupTransactionBySignature', () => {
  it('returns only a record for the same signature', async () => {
    stubNode({ lookup: { signature: 'SIG_B' } });
    await expect(bg.lookupTransactionBySignature('SIG_A')).resolves.toBe(null);
    stubNode({ lookup: { signature: 'SIG_A', type: 'PAYMENT' } });
    await expect(
      bg.lookupTransactionBySignature('SIG_A')
    ).resolves.toMatchObject({ type: 'PAYMENT' });
    stubNode({});
    await expect(bg.lookupTransactionBySignature('SIG_A')).resolves.toBe(null);
  });
});
