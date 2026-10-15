import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it, vi } from 'vitest';

// Addresses need the real SHA-256 (the global test setup mocks asmcrypto).
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
import {
  cardAddress,
  cardKeyPairFromSeed,
  deriveCardSeed,
  findWalletKeyIndex,
} from './cardKeys';
import { nacl } from './cryptoDeps';

// RFC 8032 TEST 1 seed as a stand-in main wallet key.
const MAIN_SEED = hexToBytes(
  '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'
);
const MAIN_SECRET = nacl.sign.keyPair.fromSeed(MAIN_SEED).secretKey;

// HMAC-SHA512(main seed, "Qortal card key v1" | index BE32), from Python.
const VECTORS = [
  {
    index: 0,
    seed: 'ad539e8a747ff3bde322d5d719a6ab906d33e6054c0fce6ae6b4a17d6bd75c5d',
    publicKey:
      'f3a5c02ad1bec60d43d4b97d1b22e6b325b98d97ad5c9a9af100f6a49b3ab41d',
    address: 'QYvw3WxPiofP9H1qvHtkvz4BHVdfAUNtWf',
  },
  {
    index: 1,
    seed: 'bba97317b8ef84277f9e4baa009442cbe49669b07d176cb96e6d97d249483200',
    publicKey:
      '13f8ccc7e5515de08b9ccf3ab829a96c16e81689698ffdcf7876ca97b3c1efdd',
    address: 'QXvhXVKbDtVH5kYK3K2C1QNLKcmqLV1DR1',
  },
  {
    index: 7,
    seed: '8480a1a189723d68cb71d0dc7c5b61b108d14cfa16d385b91a797a3820b93ac6',
    publicKey:
      'cba82612dc8dd88841addf49565c8df8d993097c5720b2e7fa8ebe06b1e05315',
    address: 'QWECbEexabUmjdCjoR3f7m7qQi8BxeeBwk',
  },
];

describe('wallet card keys', () => {
  it.each(VECTORS)('derives card key $index', (vector) => {
    const seed = deriveCardSeed(MAIN_SECRET, vector.index);
    expect(bytesToHex(seed)).toBe(vector.seed);
    const pair = cardKeyPairFromSeed(seed);
    expect(bytesToHex(pair.publicKey)).toBe(vector.publicKey);
    expect(pair.privateKey.length).toBe(64);
    expect(cardAddress(pair.publicKey)).toBe(vector.address);
  });

  it('takes the 32-byte seed or the 64-byte NaCl secret key alike', () => {
    expect(bytesToHex(deriveCardSeed(MAIN_SEED, 3))).toBe(
      bytesToHex(deriveCardSeed(MAIN_SECRET, 3))
    );
  });

  it('gives the RFC 8032 test key its Qortal address', () => {
    expect(
      cardAddress(
        hexToBytes(
          'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
        )
      )
    ).toBe('QaQXDVEEpn7ZPJXsGJS1aYKY7zEPmG2CoA');
  });

  it('recognises which wallet key a card holds', () => {
    expect(
      findWalletKeyIndex(MAIN_SECRET, hexToBytes(VECTORS[2].publicKey))
    ).toBe(7);
    const stranger = nacl.sign.keyPair().publicKey;
    expect(findWalletKeyIndex(MAIN_SECRET, stranger)).toBeNull();
  });

  it('refuses bad input', () => {
    expect(() => deriveCardSeed(new Uint8Array(31), 0)).toThrow();
    expect(() => deriveCardSeed(MAIN_SEED, -1)).toThrow();
    expect(() => deriveCardSeed(MAIN_SEED, 1.5)).toThrow();
    expect(() =>
      deriveCardSeed(concatBytes(MAIN_SEED, MAIN_SEED, MAIN_SEED), 0)
    ).toThrow();
  });
});
