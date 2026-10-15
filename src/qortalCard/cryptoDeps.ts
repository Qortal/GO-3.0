import Base58Untyped from '../encryption/Base58';
import naclUntyped from '../encryption/nacl-fast';

/**
 * GO's own Base58 and TweetNaCl copies (src/encryption), typed for the parts
 * Qortal Card uses. Same objects as the rest of GO signs with.
 */

interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

interface NaclSign {
  sign: {
    detached: ((message: Uint8Array, secretKey: Uint8Array) => Uint8Array) & {
      verify(
        message: Uint8Array,
        signature: Uint8Array,
        publicKey: Uint8Array
      ): boolean;
    };
    keyPair: (() => KeyPair) & {
      fromSeed(seed: Uint8Array): KeyPair;
      fromSecretKey(secretKey: Uint8Array): KeyPair;
    };
  };
}

export const Base58 = Base58Untyped as unknown as {
  encode(bytes: Uint8Array): string;
  decode(text: string): Uint8Array;
};

export const nacl = naclUntyped as unknown as NaclSign;
