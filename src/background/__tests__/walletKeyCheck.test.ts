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
// test) with storage, the password KDF and the altcoin worker replaced, so
// the unlock and send paths run the real key derivation and key check on a
// known decrypted seed.

const storage = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  writes: [] as string[],
}));
const decrypted = vi.hoisted(() => ({ seed: new Uint8Array(0) as Uint8Array }));
const altcoinVersions = vi.hoisted(() => [] as unknown[]);

vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
vi.mock('../../utils/chromeStorage', () => ({
  getData: vi.fn(async (key: string) => {
    if (key in storage.values) return storage.values[key];
    throw new Error(`No ${key} in storage`);
  }),
  storeData: vi.fn(async (key: string, value: unknown) => {
    storage.writes.push(key);
    storage.values[key] = value;
  }),
  removeKeysAndLogout: vi.fn(async () => undefined),
}));
vi.mock('../../qortal/qortal-requests.ts', () => ({
  getNotificationOsPushDisabled: vi.fn(() => false),
}));
vi.mock('../../qortal/qortal-requests', () => ({
  getNotificationOsPushDisabled: vi.fn(() => false),
}));
vi.mock('../background-cases', () => ({}));
vi.mock('../../chatComputePow.worker.js?worker', () => ({
  default: class {},
}));
// The password check and KDF are not under test: "decrypting" gives the seed
// the test chose.
vi.mock('../../utils/decryptWallet', () => ({
  decryptStoredWallet: vi.fn(async () => decrypted.seed.slice()),
}));
vi.mock('../../utils/generateWallet/deriveAltcoinFields', () => ({
  deriveAltcoinFieldsInWorker: vi.fn(
    async (_seed: Uint8Array, version: unknown) => {
      altcoinVersions.push(version);
      return { ltcAddress: 'LtestAddress' };
    }
  ),
}));

import { publicKeyBelongsToAddress } from '../../encryption/addressKeyCheck';
import PhraseWalletUntyped from '../../utils/generateWallet/phrase-wallet';
import {
  getUnlockTimingSnapshot,
  resetUnlockTimingsForTests,
} from '../../utils/unlockTimings';

/* eslint-disable @typescript-eslint/no-explicit-any */
const PhraseWallet = PhraseWalletUntyped as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

type Background = typeof import('../background');
let bg: Background;

function seedBytes(length: number, fill: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (fill * 41 + i * 13) & 0xff;
  return bytes;
}

function addressFor(seed: Uint8Array, version: number): string {
  return new PhraseWallet(seed.slice(), version, { qortOnly: true })
    ._addresses[0].address;
}

const seed32 = seedBytes(32, 1);
const seed64 = seedBytes(64, 2);
const v1Account = addressFor(seed32, 1);
const v2Account = addressFor(seed64, 2);
const otherAccount = addressFor(seedBytes(64, 3), 2);
const short = (address: string) =>
  `${address.slice(0, 7)}…${address.slice(-5)}`;

function entry(fields: Record<string, unknown>) {
  return {
    encryptedSeed: 'encryptedSeedOf' + String(fields.address0),
    iv: 'iv',
    salt: 'salt',
    mac: 'mac',
    kdfThreads: 16,
    ...fields,
  };
}

const unlock = (wallet: Record<string, unknown>) =>
  bg.decryptWallet({
    password: 'pw',
    wallet,
    // As decryptWalletCase passes it.
    walletVersion: (wallet.version as number) || 2,
  });

beforeAll(async () => {
  bg = await vi.importActual<Background>('../background');
});

beforeEach(() => {
  storage.values = {};
  storage.writes = [];
  altcoinVersions.length = 0;
  resetUnlockTimingsForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decryptWallet key check', () => {
  it('stores the key of a consistent entry as before', async () => {
    const wallet = entry({ address0: v2Account, version: 2 });
    storage.values.wallets = [wallet];
    decrypted.seed = seed64;

    await expect(unlock(wallet)).resolves.toBe(true);

    const keyPair = storage.values.keyPair as { publicKey: string };
    expect(publicKeyBelongsToAddress(keyPair.publicKey, v2Account)).toBe(true);
    // (The altcoin merge may already have added ltcAddress.)
    expect(storage.values.walletInfo).toMatchObject({
      ...wallet,
      publicKey: keyPair.publicKey,
    });
    expect(storage.writes).not.toContain('wallets');
    await bg.ensureAltcoinKeyPair();
    expect(altcoinVersions).toEqual([2]);
    expect(
      getUnlockTimingSnapshot().events.some((e) => e.step === 'wallet-check')
    ).toBe(false);
  });

  it('heals an entry that lost its version 1 and saves the fix', async () => {
    const wallet = entry({ address0: v1Account, name: 'saybin' });
    const someoneElse = entry({ address0: otherAccount, version: 2 });
    const otherCopy = {
      ...entry({ address0: v1Account }),
      encryptedSeed: 'anotherCopy',
    };
    storage.values.wallets = [someoneElse, wallet, otherCopy];
    decrypted.seed = seed32;

    await expect(unlock(wallet)).resolves.toBe(true);

    const keyPair = storage.values.keyPair as { publicKey: string };
    expect(publicKeyBelongsToAddress(keyPair.publicKey, v1Account)).toBe(true);
    expect(storage.values.walletInfo).toMatchObject({
      address0: v1Account,
      name: 'saybin',
      version: 1,
      publicKey: keyPair.publicKey,
    });
    expect(storage.values.wallets).toEqual([
      someoneElse,
      { ...wallet, version: 1 },
      otherCopy,
    ]);
    const note = getUnlockTimingSnapshot().events.find(
      (e) => e.step === 'wallet-check'
    );
    expect(note?.detail).toBe('version fixed 2→1');
    // Never an address or key in the ring.
    expect(JSON.stringify(getUnlockTimingSnapshot())).not.toContain(v1Account);

    // The altcoin keys come from the same, corrected derivation.
    await bg.ensureAltcoinKeyPair();
    expect(altcoinVersions).toEqual([1]);
  });

  it('stores nothing and names both accounts when the key is another account', async () => {
    const wallet = entry({ address0: otherAccount, version: 2 });
    storage.values.wallets = [wallet];
    decrypted.seed = seed64;

    const failure = unlock(wallet);
    await expect(failure).rejects.toThrow(short(otherAccount));
    await expect(failure).rejects.toThrow(short(v2Account));
    await expect(failure).rejects.toThrow(/Remove the account from GO/);

    expect(storage.writes).toEqual([]);
    expect(storage.values.keyPair).toBeUndefined();
    expect(storage.values.walletInfo).toBeUndefined();
    expect(altcoinVersions).toEqual([]);
  });
});

describe('sendCoin password path', () => {
  it('refuses to sign with a key that is not the account', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    storage.values.apiKey = { url: 'http://127.0.0.1:12391', apikey: '' };
    storage.values.walletInfo = entry({ address0: otherAccount, version: 2 });
    decrypted.seed = seed64;

    const failure = bg.sendCoin(
      {
        password: 'pw',
        amount: 1,
        receiver: v1Account,
        approvedFee: '0.01000000',
      },
      false
    );
    await expect(failure).rejects.toThrow(short(otherAccount));
    await expect(failure).rejects.toThrow(short(v2Account));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
