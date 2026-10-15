import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import publicKeyToAddressUntyped from '../utils/generateWallet/publicKeyToAddress';
import { nacl } from './cryptoDeps';

const publicKeyToAddress = publicKeyToAddressUntyped as unknown as (
  publicKey: Uint8Array
) => string;

/**
 * Card keys made from the main wallet. The card holds only its own key; GO
 * can rebuild it from the wallet at any time, so funds on a lost card can be
 * moved back without the card, and GO can recompute every card signature.
 *
 *   card seed = first 32 bytes of HMAC-SHA512(main seed, LABEL | index BE32)
 *
 * One-way: a card key says nothing about the main key.
 */
export const CARD_KEY_LABEL = 'Qortal card key v1';

/** Card key indexes GO tries when it recognises a card. */
export const MAX_CARD_KEY_INDEX = 20;

export interface CardKeyPair {
  /** NaCl form: seed, then public key (64 bytes). */
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/**
 * @param mainPrivateKey the wallet's NaCl secret key (64 bytes) or its seed
 *     (32 bytes)
 */
export function deriveCardSeed(
  mainPrivateKey: Uint8Array,
  index: number
): Uint8Array {
  if (mainPrivateKey?.length !== 32 && mainPrivateKey?.length !== 64) {
    throw new Error('Main key must be 32 or 64 bytes');
  }
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
    throw new RangeError('Card key index out of range');
  }
  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, index);
  return hmac(
    sha512,
    mainPrivateKey.subarray(0, 32),
    concatBytes(utf8ToBytes(CARD_KEY_LABEL), indexBytes)
  ).slice(0, 32);
}

export function cardKeyPairFromSeed(seed: Uint8Array): CardKeyPair {
  const pair = nacl.sign.keyPair.fromSeed(seed);
  return { privateKey: pair.secretKey, publicKey: pair.publicKey };
}

export const cardAddress = (publicKey: Uint8Array): string =>
  String(publicKeyToAddress(publicKey));

/** The wallet card-key index that made `publicKey`, or null. */
export function findWalletKeyIndex(
  mainPrivateKey: Uint8Array,
  publicKey: Uint8Array,
  maxIndex = MAX_CARD_KEY_INDEX
): number | null {
  for (let index = 0; index <= maxIndex; index++) {
    const seed = deriveCardSeed(mainPrivateKey, index);
    const pair = cardKeyPairFromSeed(seed);
    const match = equalBytes(pair.publicKey, publicKey);
    seed.fill(0);
    pair.privateKey.fill(0);
    if (match) return index;
  }
  return null;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
