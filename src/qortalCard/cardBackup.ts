import { crypto as walletCrypto } from '../constants/decryptWallet';
import PhraseWalletUntyped from '../utils/generateWallet/phrase-wallet';
import { deriveCardSeed } from './cardKeys';

interface CardWallet {
  _addresses: Array<{ address: string }>;
  generateSaveWalletData(
    password: string,
    kdfThreads: number,
    onProgress: () => void
  ): Promise<Record<string, unknown>>;
}

const PhraseWallet = PhraseWalletUntyped as unknown as new (
  seed: Uint8Array,
  version: number,
  options?: { qortOnly?: boolean }
) => CardWallet;

/**
 * A wallet card key as a Qortal wallet. Version 1 wallets use their seed as
 * the account key itself (phrase-wallet.ts), which is exactly what a wallet
 * card key is, so the card's account is that wallet's address0.
 */
export function cardWallet(seed: Uint8Array): CardWallet {
  return new PhraseWallet(seed, 1, { qortOnly: true });
}

/**
 * A standard, password-encrypted Qortal backup file for a wallet-key card.
 * It opens the card's account in GO or Hub like any other backup file.
 * Refuses if the key would not open `expectedAddress`.
 */
export async function buildCardBackup(
  mainPrivateKey: Uint8Array,
  index: number,
  password: string,
  expectedAddress: string
): Promise<Record<string, unknown>> {
  if (!password) throw new Error('A password is needed');
  const seed = deriveCardSeed(mainPrivateKey, index);
  try {
    const wallet = cardWallet(seed);
    if (wallet._addresses[0]?.address !== expectedAddress) {
      throw new Error('This key does not open the card');
    }
    return await wallet.generateSaveWalletData(
      password,
      walletCrypto.kdfThreads,
      () => undefined
    );
  } finally {
    seed.fill(0);
  }
}
