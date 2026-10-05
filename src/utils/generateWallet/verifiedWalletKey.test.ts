import { beforeEach, describe, expect, it, vi } from 'vitest';

// src/test/setup.ts stubs asmcrypto out; key derivation needs the real hashes.
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);

// Records every derivation (its version) and keeps the instances, so a test
// can see which derivations ran and what happened to the ones thrown away.
const made = vi.hoisted(() => ({
  versions: [] as unknown[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wallets: [] as any[],
}));
vi.mock('./phrase-wallet', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = await importOriginal<{ default: any }>();
  class RecordingPhraseWallet extends actual.default {
    constructor(seed: unknown, version: unknown, options: unknown) {
      made.versions.push(version);
      super(seed, version, options);
      made.wallets.push(this);
    }
  }
  return { default: RecordingPhraseWallet };
});

import Base58Untyped from '../../encryption/Base58';
import naclUntyped from '../../encryption/nacl-fast';
import PhraseWalletUntyped from './phrase-wallet';
import publicKeyToAddressUntyped from './publicKeyToAddress';
import {
  deriveVerifiedWalletKey,
  shortWalletAddress,
  storedKeyPairMatchesAccount,
  WalletKeyMismatchError,
  withCorrectedWalletVersion,
} from './verifiedWalletKey';

/* eslint-disable @typescript-eslint/no-explicit-any */
const Base58 = Base58Untyped as any;
const nacl = naclUntyped as any;
const PhraseWallet = PhraseWalletUntyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function seedBytes(length: number, fill: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (fill * 37 + i * 11) & 0xff;
  return bytes;
}

function addressFor(seed: Uint8Array, version: number): string {
  return new PhraseWallet(seed.slice(), version, { qortOnly: true })
    ._addresses[0].address;
}

const seed32 = seedBytes(32, 1);
const seed64 = seedBytes(64, 2);
const v1Of32 = addressFor(seed32, 1);
const v2Of32 = addressFor(seed32, 2);
const v2Of64 = addressFor(seed64, 2);
const otherAccount = addressFor(seedBytes(64, 3), 2);

beforeEach(() => {
  made.versions = [];
  made.wallets = [];
});

describe('deriveVerifiedWalletKey', () => {
  it('returns the entry version when it derives address0', () => {
    const result = deriveVerifiedWalletKey(
      seed64.slice(),
      { address0: v2Of64, version: 2 },
      { qortOnly: true }
    );
    expect(result.wallet._addresses[0].address).toBe(v2Of64);
    expect(result).toMatchObject({
      version: 2,
      entryVersion: 2,
      versionFixed: false,
      checked: true,
    });
    expect(made.versions).toEqual([2]);
  });

  it('keeps a consistent version 1 entry as it is', () => {
    const result = deriveVerifiedWalletKey(
      seed32.slice(),
      { address0: v1Of32, version: 1 },
      { qortOnly: true }
    );
    expect(result.wallet._addresses[0].address).toBe(v1Of32);
    expect(result.versionFixed).toBe(false);
    expect(result.version).toBe(1);
  });

  it('treats a missing version as 2 first, as before', () => {
    const result = deriveVerifiedWalletKey(
      seed32.slice(),
      { address0: v2Of32 },
      { qortOnly: true }
    );
    expect(result.versionFixed).toBe(false);
    expect(result.version).toBe(2);
    expect(made.versions).toEqual([2]);
  });

  it.each([undefined, 0, null, 2, '2'])(
    'fixes a 32-byte version 1 account saved with version %s',
    (version) => {
      const result = deriveVerifiedWalletKey(
        seed32.slice(),
        { address0: v1Of32, version },
        { qortOnly: true }
      );
      expect(result.wallet._addresses[0].address).toBe(v1Of32);
      expect(result).toMatchObject({
        version: 1,
        entryVersion: 2,
        versionFixed: true,
        checked: true,
      });
    }
  );

  it('fixes an entry marked version 1 whose seed is a version 2 seed', () => {
    // A 64-byte seed cannot be version 1 (nacl refuses it): version 2 is tried.
    const result = deriveVerifiedWalletKey(
      seed64.slice(),
      { address0: v2Of64, version: 1 },
      { qortOnly: true }
    );
    expect(result.wallet._addresses[0].address).toBe(v2Of64);
    expect(result).toMatchObject({
      version: 2,
      entryVersion: 1,
      versionFixed: true,
    });
  });

  it('fixes a 32-byte entry marked version 1 that derives with version 2', () => {
    const result = deriveVerifiedWalletKey(
      seed32.slice(),
      { address0: v2Of32, version: '1' },
      { qortOnly: true }
    );
    expect(result.wallet._addresses[0].address).toBe(v2Of32);
    expect(result.version).toBe(2);
    expect(result.versionFixed).toBe(true);
  });

  it('refuses an entry whose key belongs to another account', () => {
    const derivedPrivateKey = Base58.encode(
      new PhraseWallet(seed64.slice(), 2, { qortOnly: true })._addresses[0]
        .keyPair.privateKey
    );
    let error: unknown;
    try {
      deriveVerifiedWalletKey(
        seed64.slice(),
        { address0: otherAccount, version: 2 },
        { qortOnly: true }
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(WalletKeyMismatchError);
    const mismatch = error as WalletKeyMismatchError;
    expect(mismatch.accountAddress).toBe(otherAccount);
    expect(mismatch.keyAddress).toBe(v2Of64);
    expect(mismatch.message).toContain(shortWalletAddress(otherAccount));
    expect(mismatch.message).toContain(shortWalletAddress(v2Of64));
    expect(mismatch.message).toMatch(/Remove the account from GO/);
    expect(mismatch.message).toMatch(/seed phrase or a fresh backup from Hub/);
    // Only public addresses: never the seed or a private key.
    expect(mismatch.message).not.toContain(Base58.encode(seed64));
    expect(mismatch.message).not.toContain(derivedPrivateKey);
    expect(JSON.stringify(mismatch)).not.toContain(derivedPrivateKey);
  });

  it('tries version 1 only for a 32-byte seed', () => {
    expect(() =>
      deriveVerifiedWalletKey(
        seed64.slice(),
        { address0: otherAccount },
        { qortOnly: true }
      )
    ).toThrow(WalletKeyMismatchError);
    expect(made.versions).toEqual([2]);

    made.versions = [];
    expect(() =>
      deriveVerifiedWalletKey(
        seed32.slice(),
        { address0: otherAccount },
        { qortOnly: true }
      )
    ).toThrow(WalletKeyMismatchError);
    expect(made.versions).toEqual([2, 1]);
  });

  it('keeps the derivation error when the entry version cannot derive', () => {
    // 64-byte seed marked version 1, label of another account: as before,
    // the bad seed size error, not a mismatch.
    expect(() =>
      deriveVerifiedWalletKey(
        seed64.slice(),
        { address0: otherAccount, version: 1 },
        { qortOnly: true }
      )
    ).toThrow(/bad seed size/);
  });

  it('wipes the private keys it throws away, never the decrypted seed', () => {
    const seed = seed32.slice();
    const result = deriveVerifiedWalletKey(
      seed,
      { address0: v1Of32 },
      { qortOnly: true }
    );
    expect(made.wallets).toHaveLength(2);
    const [discarded, kept] = made.wallets;
    expect(kept).toBe(result.wallet);
    expect(
      Array.from(discarded._addresses[0].keyPair.privateKey).every(
        (byte) => byte === 0
      )
    ).toBe(true);
    expect(
      Array.from(kept._addresses[0].keyPair.privateKey).some(
        (byte) => byte !== 0
      )
    ).toBe(true);
    expect(Array.from(seed)).toEqual(Array.from(seed32));
  });

  it('wipes both derivations when nothing matches', () => {
    const seed = seed32.slice();
    expect(() =>
      deriveVerifiedWalletKey(
        seed,
        { address0: otherAccount },
        { qortOnly: true }
      )
    ).toThrow(WalletKeyMismatchError);
    expect(made.wallets).toHaveLength(2);
    for (const wallet of made.wallets) {
      expect(
        Array.from(wallet._addresses[0].keyPair.privateKey).every(
          (byte) => byte === 0
        )
      ).toBe(true);
    }
    expect(Array.from(seed)).toEqual(Array.from(seed32));
  });

  it.each([undefined, '', '   '])(
    'derives without a check when address0 is %j',
    (address0) => {
      const result = deriveVerifiedWalletKey(
        seed32.slice(),
        { address0, version: 2 },
        { qortOnly: true }
      );
      expect(result.wallet._addresses[0].address).toBe(v2Of32);
      expect(result.checked).toBe(false);
      expect(result.versionFixed).toBe(false);
      expect(made.versions).toEqual([2]);
    }
  );

  it('ignores spaces around address0', () => {
    const result = deriveVerifiedWalletKey(
      seed64.slice(),
      { address0: ` ${v2Of64}\n` },
      { qortOnly: true }
    );
    expect(result.versionFixed).toBe(false);
    expect(result.checked).toBe(true);
  });

  it('adds the altcoin wallets unless only the QORT key is asked for', () => {
    const qortOnly = deriveVerifiedWalletKey(
      seed64.slice(),
      { address0: v2Of64 },
      { qortOnly: true }
    );
    expect(qortOnly.wallet._addresses[0].btcWallet).toBeNull();

    const full = deriveVerifiedWalletKey(seed64.slice(), {
      address0: v2Of64,
    });
    expect(full.wallet._addresses[0].btcWallet).toBeTruthy();
    expect(full.wallet._addresses[0].ltcWallet?.address).toMatch(/^L/);
  });
});

describe('storedKeyPairMatchesAccount', () => {
  const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(5));
  const address = String(publicKeyToAddress(pair.publicKey));
  const keyPair = {
    publicKey: Base58.encode(pair.publicKey),
    privateKey: Base58.encode(pair.secretKey),
  };

  it('accepts the account own key', () => {
    expect(storedKeyPairMatchesAccount(keyPair, address)).toBe(true);
    expect(storedKeyPairMatchesAccount(keyPair, ` ${address} `)).toBe(true);
  });

  it("refuses another account's key or a missing one", () => {
    expect(storedKeyPairMatchesAccount(keyPair, otherAccount)).toBe(false);
    expect(storedKeyPairMatchesAccount(null, address)).toBe(false);
    expect(storedKeyPairMatchesAccount({}, address)).toBe(false);
    expect(storedKeyPairMatchesAccount(keyPair, '')).toBe(false);
    expect(storedKeyPairMatchesAccount(keyPair, undefined)).toBe(false);
  });
});

describe('withCorrectedWalletVersion', () => {
  const unlocked = { address0: v1Of32, encryptedSeed: 'seedA', name: 'me' };
  const otherCopy = { address0: v1Of32, encryptedSeed: 'seedB', version: 2 };
  const someoneElse = { address0: otherAccount, encryptedSeed: 'seedC' };

  it('writes the version into the unlocked entry only', () => {
    const next = withCorrectedWalletVersion(
      [someoneElse, unlocked, otherCopy],
      unlocked,
      1
    );
    expect(next).toEqual([someoneElse, { ...unlocked, version: 1 }, otherCopy]);
  });

  it('returns null when nothing needs saving', () => {
    expect(
      withCorrectedWalletVersion([{ ...unlocked, version: 1 }], unlocked, 1)
    ).toBeNull();
    expect(withCorrectedWalletVersion([someoneElse], unlocked, 1)).toBeNull();
    expect(withCorrectedWalletVersion(null, unlocked, 1)).toBeNull();
    expect(
      withCorrectedWalletVersion([unlocked], { address0: v1Of32 }, 1)
    ).toBeNull();
  });
});

describe('shortWalletAddress', () => {
  it('keeps the first 7 and last 5 characters', () => {
    expect(shortWalletAddress('QbcSNSoNPkdn2MU1Zjp9rsC2y2mEfW24nS')).toBe(
      'QbcSNSo…W24nS'
    );
    expect(shortWalletAddress('Qshort')).toBe('Qshort');
  });
});
