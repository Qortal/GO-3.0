import i18n from '../../i18n/i18n';
import { walletVersion as DEFAULT_WALLET_VERSION } from '../../constants/decryptWallet';
import { publicKeyBelongsToAddress } from '../../encryption/addressKeyCheck';
import PhraseWallet from './phrase-wallet';

/**
 * Turns the decrypted seed of a SAVED wallet entry into its QORT key, and
 * checks that key against the entry's own `address0`.
 *
 * Nothing else ties the two together. The MAC covers only `encryptedSeed`, and
 * the derivation rule comes from the entry's `version` field (`version || 2`).
 * An entry whose version was lost, or whose seed belongs to another key,
 * decrypts fine and then signs as a different account than the one it is
 * listed as. A field report had every unlock signing as Qh452hd… while GO
 * showed account QbcSNSo…, and backups and the private key screen followed
 * the wrong key the same way.
 *
 * Seed-phrase import and account creation derive `address0` from the key
 * themselves, so they do not need this.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type PhraseWalletInstance = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

type WalletEntryForKeyCheck = {
  address0?: unknown;
  version?: unknown;
};

type PhraseWalletOptions = {
  /** Skip the BTC/LTC/… HD wallets; only the QORT key is derived. */
  qortOnly?: boolean;
};

type VerifiedWalletKey = {
  /** PhraseWallet whose address 0 is the entry's `address0`. */
  wallet: PhraseWalletInstance;
  /** The derivation that matched: 1 (raw seed) or 2 (SHA-512 chain). */
  version: 1 | 2;
  /** The derivation the entry's own `version` asked for. */
  entryVersion: 1 | 2;
  /**
   * True when the entry's version derived another account and the other
   * derivation gave `address0`: the saved `version` is wrong and `version`
   * is the one to save.
   */
  versionFixed: boolean;
  /** False when the entry has no `address0`, so nothing could be compared. */
  checked: boolean;
};

const ED25519_SEED_BYTES = 32;

/** `QbcSNSo…W24nS`: first 7 and last 5 characters. */
export function shortWalletAddress(address: string): string {
  const value = String(address || '');
  return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
}

/**
 * The saved entry's key belongs to another account than its `address0`, with
 * either derivation. Both addresses are public; no key material is kept.
 */
export class WalletKeyMismatchError extends Error {
  readonly accountAddress: string;
  readonly keyAddress: string;

  constructor(accountAddress: string, keyAddress: string) {
    super(
      i18n.t('auth:wallet_errors.saved_account_key_mismatch', {
        account: shortWalletAddress(accountAddress),
        key_account: shortWalletAddress(keyAddress),
        postProcess: 'capitalizeSentenceStarts',
      })
    );
    this.name = 'WalletKeyMismatchError';
    this.accountAddress = accountAddress;
    this.keyAddress = keyAddress;
  }
}

function isVersion1(version: unknown): boolean {
  // PhraseWallet compares with `== 1`, so "1" is version 1 as well.
  // eslint-disable-next-line eqeqeq
  return version == 1;
}

function deriveQortWallet(seed: unknown, version: unknown) {
  return new PhraseWallet(seed, version, { qortOnly: true });
}

function addressOf(wallet: PhraseWalletInstance): string {
  const address = wallet?._addresses?.[0]?.address;
  return typeof address === 'string' ? address : '';
}

function sharesBuffer(a: unknown, b: unknown): boolean {
  return (
    ArrayBuffer.isView(a) && ArrayBuffer.isView(b) && a.buffer === b.buffer
  );
}

/**
 * Zeroes the private key of a derivation that is thrown away. The decrypted
 * seed belongs to the caller and is left alone (a version 1 address seed is
 * the decrypted seed itself).
 */
function wipeDiscardedWallet(
  wallet: PhraseWalletInstance,
  decryptedSeed: unknown
) {
  const entry = wallet?._addresses?.[0];
  if (!entry) return;
  const privateKey = entry.keyPair?.privateKey;
  if (privateKey instanceof Uint8Array) privateKey.fill(0);
  if (
    entry.seed instanceof Uint8Array &&
    entry.seed !== decryptedSeed &&
    !sharesBuffer(entry.seed, decryptedSeed)
  ) {
    entry.seed.fill(0);
  }
  wallet._base58Seed = '';
}

function seedLength(seed: unknown): number {
  if (ArrayBuffer.isView(seed)) return seed.byteLength;
  if (seed instanceof ArrayBuffer) return seed.byteLength;
  return Array.isArray(seed) ? seed.length : -1;
}

/**
 * Derives the key of a saved wallet entry and returns it only when it is the
 * entry's account.
 *
 * 1. The entry's own rule first (`version || 2`), as before.
 * 2. When that gives another address, the other derivation: version 1 only
 *    for a 32-byte seed, version 2 when the entry said 1. A match is returned
 *    with `versionFixed` so the caller can save the right version.
 * 3. Nothing matches: WalletKeyMismatchError naming both short addresses.
 *
 * An entry without `address0` cannot be checked and gets its own rule.
 */
export function deriveVerifiedWalletKey(
  decryptedSeed: unknown,
  walletEntry: WalletEntryForKeyCheck | null | undefined,
  phraseWalletOptions?: PhraseWalletOptions
): VerifiedWalletKey {
  const expected =
    typeof walletEntry?.address0 === 'string'
      ? walletEntry.address0.trim()
      : '';
  const entryRule = walletEntry?.version || DEFAULT_WALLET_VERSION;
  const entryVersion: 1 | 2 = isVersion1(entryRule) ? 1 : 2;

  const finish = (
    wallet: PhraseWalletInstance,
    version: 1 | 2,
    versionFixed: boolean,
    checked: boolean
  ): VerifiedWalletKey => {
    // Derived QORT-only for the check; altcoins only for the one returned.
    if (!phraseWalletOptions?.qortOnly) wallet.ensureAltcoinWallets();
    return { wallet, version, entryVersion, versionFixed, checked };
  };

  if (!expected) {
    return finish(
      deriveQortWallet(decryptedSeed, entryRule),
      entryVersion,
      false,
      false
    );
  }

  let primary: PhraseWalletInstance = null;
  let primaryError: unknown = null;
  try {
    primary = deriveQortWallet(decryptedSeed, entryRule);
  } catch (error) {
    primaryError = error;
  }
  const primaryAddress = primary ? addressOf(primary) : '';
  if (primary && primaryAddress === expected) {
    return finish(primary, entryVersion, false, true);
  }

  const alternativeVersion: 1 | 2 = entryVersion === 1 ? 2 : 1;
  if (
    alternativeVersion === 2 ||
    seedLength(decryptedSeed) === ED25519_SEED_BYTES
  ) {
    let alternative: PhraseWalletInstance = null;
    try {
      alternative = deriveQortWallet(decryptedSeed, alternativeVersion);
    } catch {
      alternative = null;
    }
    if (alternative && addressOf(alternative) === expected) {
      if (primary) wipeDiscardedWallet(primary, decryptedSeed);
      return finish(alternative, alternativeVersion, true, true);
    }
    if (alternative) wipeDiscardedWallet(alternative, decryptedSeed);
  }

  // The entry's own derivation failed outright (e.g. a 64-byte seed marked
  // version 1): keep that error, as before.
  if (!primary) throw primaryError;
  wipeDiscardedWallet(primary, decryptedSeed);
  throw new WalletKeyMismatchError(expected, primaryAddress);
}

/**
 * True when a stored session keyPair (Base58 `publicKey`) is the key of
 * `address0`. A session whose key is another account's must not resume.
 */
export function storedKeyPairMatchesAccount(
  keyPair: unknown,
  address0: unknown
): boolean {
  const publicKey =
    keyPair && typeof keyPair === 'object'
      ? (keyPair as { publicKey?: unknown }).publicKey
      : null;
  const address = typeof address0 === 'string' ? address0.trim() : '';
  if (!address) return false;
  return publicKeyBelongsToAddress(publicKey, address);
}

/**
 * The saved wallets list with `version` corrected on the entry the key was
 * verified from (same `address0` and the same encrypted seed, so another
 * copy of the account is never changed). Null when nothing needs saving.
 */
export function withCorrectedWalletVersion<T>(
  wallets: T[] | null | undefined,
  walletEntry: { address0?: unknown; encryptedSeed?: unknown },
  version: 1 | 2
): T[] | null {
  if (!Array.isArray(wallets)) return null;
  const address =
    typeof walletEntry?.address0 === 'string'
      ? walletEntry.address0.trim()
      : '';
  const encryptedSeed = walletEntry?.encryptedSeed;
  if (!address || typeof encryptedSeed !== 'string' || !encryptedSeed) {
    return null;
  }
  let changed = false;
  const next = wallets.map((saved) => {
    const record = saved as { address0?: unknown; encryptedSeed?: unknown };
    if (
      !record ||
      typeof record !== 'object' ||
      typeof record.address0 !== 'string' ||
      record.address0.trim() !== address ||
      record.encryptedSeed !== encryptedSeed ||
      (saved as { version?: unknown }).version === version
    ) {
      return saved;
    }
    changed = true;
    return { ...saved, version };
  });
  return changed ? next : null;
}
