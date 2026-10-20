/**
 * Wallet-style signing for call tests, byte-identical to GO's real signer
 * (src/background/background-cases.ts signPresenceMessageCase): the payload
 * must pass the wallet signing policy, keys are sorted, JSON.stringify'd,
 * UTF-8 encoded and signed with nacl.sign.detached; signature in Base58.
 */
import naclModule from '../../../encryption/nacl-fast';
import Base58Module from '../../../encryption/Base58';
import { assertAllowedPresenceSigningPayload } from '../../../background/reticulum-signing-policy';
import { deriveAddressFromPublicKey } from '../../../reticulumChat/mobile/shims/presence-slim';

// Both are untyped JS-style modules in the app.
const nacl = naclModule as unknown as {
  sign: {
    keyPair: {
      fromSeed(seed: Uint8Array): {
        publicKey: Uint8Array;
        secretKey: Uint8Array;
      };
    };
    detached(message: Uint8Array, secretKey: Uint8Array): Uint8Array;
  };
};
const Base58 = Base58Module as unknown as {
  encode(bytes: Uint8Array): string;
};

export class TestWallet {
  readonly address: string;
  readonly publicKey: string;
  private readonly secretKey: Uint8Array;
  /** Every payload this wallet signed (assert field sets in tests). */
  readonly signed: Array<Record<string, unknown>> = [];

  constructor(seedByte: number) {
    const seed = new Uint8Array(32).fill(seedByte);
    const pair = nacl.sign.keyPair.fromSeed(seed);
    this.secretKey = pair.secretKey;
    this.publicKey = Base58.encode(pair.publicKey);
    this.address = deriveAddressFromPublicKey(this.publicKey);
  }

  /** window.sendMessage('signPresenceMessage', fields) equivalent. */
  sign(fields: Record<string, unknown>): string {
    assertAllowedPresenceSigningPayload(fields);
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(fields).sort()) sorted[key] = fields[key];
    const message = new TextEncoder().encode(JSON.stringify(sorted));
    this.signed.push({ ...fields });
    return Base58.encode(nacl.sign.detached(message, this.secretKey));
  }
}
