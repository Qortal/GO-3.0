/**
 * Slim stand-in for `electron/src/presence.ts` inside the mobile engine
 * worker. The chat engine, calendar and ed25519-verify-common import exactly
 * four pure utilities from that (otherwise main-process-heavy) module; they
 * are reproduced here byte-compatible, using the renderer's RIPEMD-160 and
 * the worker crypto shim's SHA-256.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { RIPEMD160 } from '../../../encryption/ripemd160';

function ripemd160(data: Uint8Array): Uint8Array {
  return new RIPEMD160().update(data).digest();
}

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ADDRESS_VERSION = 58;

export function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

export function base58Decode(str: string): Uint8Array {
  const alphabetMap: Record<string, number> = {};
  for (let i = 0; i < BASE58_ALPHABET.length; i++) {
    alphabetMap[BASE58_ALPHABET[i]] = i;
  }
  const bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (!(c in alphabetMap)) {
      throw new Error(`Invalid Base58 character: ${c}`);
    }
    let carry = alphabetMap[c];
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < str.length && str[i] === '1'; i++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

export function canonicalizeForSigning(
  data: Record<string, unknown>
): Uint8Array {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(data).sort()) {
    sorted[key] = data[key];
  }
  return new TextEncoder().encode(JSON.stringify(sorted));
}

export function deriveAddressFromPublicKey(publicKeyBase58: string): string {
  const publicKeyBytes = base58Decode(publicKeyBase58);
  const firstSha = sha256(publicKeyBytes);
  const hash = ripemd160(firstSha);

  const versioned = new Uint8Array(1 + hash.length);
  versioned[0] = ADDRESS_VERSION;
  versioned.set(hash, 1);

  const check1 = sha256(versioned);
  const check2 = sha256(check1);

  const full = new Uint8Array(versioned.length + 4);
  full.set(versioned);
  full.set(check2.slice(0, 4), versioned.length);

  return base58Encode(full);
}
