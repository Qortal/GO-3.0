import { sha512 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it, vi } from 'vitest';

// The real SHA-256 and AES (the global test setup mocks asmcrypto); only the
// slow bcrypt key stretching is stubbed, the same way for saving and opening.
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
vi.mock('../encryption/kdf', () => ({
  doInitWorkers: () => [],
  kdf: async (password: string, salt: Uint8Array) =>
    sha512(concatBytes(utf8ToBytes(password), salt)),
}));

import { decryptStoredWallet } from '../utils/decryptWallet';
import { deriveVerifiedWalletKey } from '../utils/generateWallet/verifiedWalletKey';
import { buildCardBackup, cardWallet } from './cardBackup';
import { cardAddress, cardKeyPairFromSeed, deriveCardSeed } from './cardKeys';
import { nacl } from './cryptoDeps';

const MAIN = nacl.sign.keyPair().secretKey;

describe('card backup file', () => {
  it('a version 1 wallet of the card seed opens the card account', () => {
    const seed = deriveCardSeed(MAIN, 3);
    expect(cardWallet(seed)._addresses[0].address).toBe(
      cardAddress(cardKeyPairFromSeed(seed).publicKey)
    );
  });

  it('round-trips through the same unlock checks GO uses at login', async () => {
    const address = cardAddress(
      cardKeyPairFromSeed(deriveCardSeed(MAIN, 0)).publicKey
    );
    const file = await buildCardBackup(MAIN, 0, 'card pass', address);
    expect(file).toMatchObject({ address0: address, version: 1 });
    expect(JSON.stringify(file)).not.toContain('card pass');

    const decrypted = await decryptStoredWallet('card pass', file);
    const { wallet } = deriveVerifiedWalletKey(decrypted, file, {
      qortOnly: true,
    }) as { wallet: { _addresses: Array<{ address: string }> } };
    expect(wallet._addresses[0].address).toBe(address);
    await expect(decryptStoredWallet('wrong pass', file)).rejects.toThrow();
  });

  it('refuses to write a file that would open another account', async () => {
    await expect(
      buildCardBackup(
        MAIN,
        0,
        'card pass',
        'QaQXDVEEpn7ZPJXsGJS1aYKY7zEPmG2CoA'
      )
    ).rejects.toThrow();
    await expect(buildCardBackup(MAIN, 0, '', 'Q')).rejects.toThrow();
  });
});
