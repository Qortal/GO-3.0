/**
 * Node `crypto` stand-in for the mobile engine worker.
 *
 * Implements exactly the surface the chat engine, resource store and their
 * worker modules consume: createHash (sha1/256/512), randomBytes, randomUUID,
 * randomInt, timingSafeEqual, and Ed25519 via generateKeyPairSync / sign /
 * verify / createPublicKey with the DER-SPKI framing ed25519-verify-common
 * expects. Backed by @noble (audited, pure JS, synchronous).
 */
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import * as ed from '@noble/ed25519';
import { Buffer } from 'buffer';

// @noble/ed25519 v2 requires an explicit synchronous SHA-512 for sync APIs.
ed.etc.sha512Sync = (...msgs: Uint8Array[]) =>
  sha512(ed.etc.concatBytes(...msgs));

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex'
);

type HashAlgo = 'sha1' | 'sha256' | 'sha512';

const HASHERS: Record<HashAlgo, (data: Uint8Array) => Uint8Array> = {
  sha1: (d) => sha1(d),
  sha256: (d) => sha256(d),
  sha512: (d) => sha512(d),
};

class Hash {
  private chunks: Uint8Array[] = [];

  constructor(private readonly algo: HashAlgo) {}

  update(data: string | Uint8Array | Buffer): this {
    if (typeof data === 'string') {
      this.chunks.push(new TextEncoder().encode(data));
    } else {
      this.chunks.push(
        data instanceof Uint8Array ? data : new Uint8Array(data)
      );
    }
    return this;
  }

  digest(): Buffer;
  digest(encoding: 'hex' | 'base64'): string;
  digest(encoding?: 'hex' | 'base64'): Buffer | string {
    let total = 0;
    for (const c of this.chunks) total += c.length;
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      merged.set(c, off);
      off += c.length;
    }
    const out = Buffer.from(HASHERS[this.algo](merged));
    if (encoding === 'hex') return out.toString('hex');
    if (encoding === 'base64') return out.toString('base64');
    return out;
  }
}

export function createHash(algorithm: string): Hash {
  const algo = algorithm.toLowerCase().replace('-', '') as HashAlgo;
  if (!HASHERS[algo]) {
    throw new Error(`Unsupported hash algorithm on mobile: ${algorithm}`);
  }
  return new Hash(algo);
}

export function randomBytes(size: number): Buffer {
  const out = new Uint8Array(size);
  crypto.getRandomValues(out);
  return Buffer.from(out);
}

export function randomUUID(): string {
  return crypto.randomUUID();
}

export function randomInt(maxOrMin: number, maybeMax?: number): number {
  const min = maybeMax === undefined ? 0 : maxOrMin;
  const max = maybeMax === undefined ? maxOrMin : maybeMax;
  const range = max - min;
  if (range <= 0) throw new Error('randomInt range must be positive');
  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  return min + (rand[0] % range);
}

export function timingSafeEqual(
  a: Uint8Array | Buffer,
  b: Uint8Array | Buffer
): boolean {
  if (a.byteLength !== b.byteLength) {
    throw new Error('Input buffers must have the same byte length');
  }
  let diff = 0;
  const ua = a instanceof Uint8Array ? a : new Uint8Array(a);
  const ub = b instanceof Uint8Array ? b : new Uint8Array(b);
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

/** Duck-typed KeyObject carrying the raw Ed25519 key material. */
export class KeyObject {
  constructor(
    public readonly type: 'public' | 'private',
    public readonly asymmetricKeyType: 'ed25519',
    private readonly raw: Uint8Array
  ) {}

  export(options?: { format?: string; type?: string }): Buffer {
    const format = options?.format ?? 'der';
    if (format !== 'der') {
      throw new Error('Only DER export is supported on mobile');
    }
    if (this.type === 'public') {
      return Buffer.concat([SPKI_PREFIX, Buffer.from(this.raw)]);
    }
    return Buffer.concat([PKCS8_PREFIX, Buffer.from(this.raw)]);
  }

  /** Internal accessor for sign/verify below. */
  get rawBytes(): Uint8Array {
    return this.raw;
  }
}

export function createPublicKey(input: {
  key: Buffer | Uint8Array;
  format?: string;
  type?: string;
}): KeyObject {
  const key = Buffer.isBuffer(input.key)
    ? input.key
    : Buffer.from(input.key);
  if (
    key.byteLength === SPKI_PREFIX.byteLength + 32 &&
    key.subarray(0, SPKI_PREFIX.byteLength).equals(SPKI_PREFIX)
  ) {
    return new KeyObject(
      'public',
      'ed25519',
      new Uint8Array(key.subarray(SPKI_PREFIX.byteLength))
    );
  }
  if (key.byteLength === 32) {
    return new KeyObject('public', 'ed25519', new Uint8Array(key));
  }
  throw new Error('Unsupported public key format on mobile');
}

export function generateKeyPairSync(type: string): {
  privateKey: KeyObject;
  publicKey: KeyObject;
} {
  if (type !== 'ed25519') {
    throw new Error(`Unsupported key type on mobile: ${type}`);
  }
  const priv = ed.utils.randomPrivateKey();
  const pub = ed.getPublicKey(priv);
  return {
    privateKey: new KeyObject('private', 'ed25519', priv),
    publicKey: new KeyObject('public', 'ed25519', pub),
  };
}

export function sign(
  _algorithm: null | undefined,
  message: Buffer | Uint8Array,
  key: KeyObject
): Buffer {
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
    throw new Error('sign() requires an Ed25519 private KeyObject');
  }
  const msg = message instanceof Uint8Array ? message : new Uint8Array(message);
  return Buffer.from(ed.sign(msg, key.rawBytes));
}

export function verify(
  _algorithm: null | undefined,
  message: Buffer | Uint8Array,
  key: KeyObject,
  signature: Buffer | Uint8Array
): boolean {
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    return false;
  }
  try {
    const msg =
      message instanceof Uint8Array ? message : new Uint8Array(message);
    const sig =
      signature instanceof Uint8Array ? signature : new Uint8Array(signature);
    return ed.verify(sig, msg, key.rawBytes);
  } catch {
    return false;
  }
}

export default {
  createHash,
  randomBytes,
  randomUUID,
  randomInt,
  timingSafeEqual,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  KeyObject,
};
