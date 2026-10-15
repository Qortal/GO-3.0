import { getKeyPair } from '../background/background';
import { equalBytes } from './cardKeys';
import { Base58, nacl } from './cryptoDeps';

/** The wallet key is not available (locked, or not loaded yet). */
export class WalletKeyError extends Error {
  constructor() {
    super('Wallet key unavailable');
    this.name = 'WalletKeyError';
  }
}

/**
 * The unlocked wallet's NaCl secret key (64 bytes), only for making card
 * keys. Callers wipe it with fill(0) as soon as they are done.
 */
export async function loadMainPrivateKey(): Promise<Uint8Array> {
  let pair: { privateKey?: string; publicKey?: string } | null = null;
  try {
    pair = await getKeyPair();
  } catch {
    throw new WalletKeyError();
  }
  let secretKey: Uint8Array = new Uint8Array(0);
  let publicKey: Uint8Array = new Uint8Array(0);
  try {
    secretKey = Base58.decode(pair?.privateKey ?? '');
    publicKey = Base58.decode(pair?.publicKey ?? '');
  } catch {
    throw new WalletKeyError();
  }
  if (
    secretKey?.length !== 64 ||
    publicKey?.length !== 32 ||
    !equalBytes(nacl.sign.keyPair.fromSecretKey(secretKey).publicKey, publicKey)
  ) {
    secretKey?.fill?.(0);
    throw new WalletKeyError();
  }
  return secretKey;
}
