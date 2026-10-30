import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { Base58, nacl } from './cryptoDeps';

/**
 * Transactions a Qortal Card signs, built byte for byte as Qortal core reads
 * them (PaymentTransactionTransformer, TransferAssetTransactionTransformer),
 * signature left off:
 *
 *   type 4 | timestamp 8 | group 4 | reference 64 | sender key 32 |
 *   recipient 25 | [asset ID 8] | amount 8 | fee 8
 *
 * A PAYMENT is 153 bytes, a TRANSFER_ASSET 161: both fit one short APDU.
 */

const QORT_UNITS = 100_000_000n;
const PAYMENT_TX_TYPE = 2;
const TRANSFER_ASSET_TX_TYPE = 12;
const PAYMENT_TX_BYTES = 153;
const TRANSFER_ASSET_TX_BYTES = 161;
const REGISTER_NAME_TX_TYPE = 3;

/** The longest message a card signs: one short APDU. */
export const MAX_CARD_MESSAGE_BYTES = 255;

/** Qortal core's Name.MIN_NAME_SIZE and MAX_NAME_SIZE, in UTF-8 bytes. */
export const MIN_NAME_BYTES = 3;
export const MAX_NAME_BYTES = 40;

/** The data Hub gives a name when none is typed; core needs some. */
export const DEFAULT_NAME_DATA = 'Registered Name on the Qortal Chain';

export type CardTxKind = 'payment' | 'asset';

interface CardTxFields {
  kind: CardTxKind;
  /** Milliseconds since 1970. */
  timestamp: number;
  /**
   * 64 bytes. Since block-time 1655222400000 (June 2022) core accepts any
   * value of the right length (disableReferenceTimestamp), so a card needs
   * no node lookup while it is held to the phone.
   */
  reference: Uint8Array;
  senderPublicKey: Uint8Array;
  recipient: string;
  /** In 1e-8 units. */
  amount: bigint;
  /** In 1e-8 QORT, always paid in QORT. */
  fee: bigint;
  /** TRANSFER_ASSET only. */
  assetId?: bigint;
  groupId?: number;
}

/**
 * "1.5" or "1,5" (a comma keyboard) to 150000000n. Plain decimals with up to
 * eight places only; null for anything else, zero included.
 */
export function parseQortAmount(text: string): bigint | null {
  const value = String(text ?? '')
    .trim()
    .replace(',', '.');
  const match = /^(\d{1,12})(?:\.(\d{0,8}))?$|^\.(\d{1,8})$/.exec(value);
  if (!match) return null;
  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? match[3] ?? '').padEnd(8, '0');
  const units = BigInt(whole) * QORT_UNITS + BigInt(fraction);
  return units > 0n ? units : null;
}

/**
 * A node amount ("12.34000000", "0", "1.0E-4") to units. Exponent forms go
 * through Number, which is exact enough at eight places.
 */
export function nodeAmountToUnits(text: string): bigint {
  const value = String(text ?? '')
    .trim()
    .replace(/^"|"$/g, '');
  const plain = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (plain) {
    const fraction = (plain[3] ?? '').slice(0, 8).padEnd(8, '0');
    const units = BigInt(plain[2]) * QORT_UNITS + BigInt(fraction);
    return plain[1] ? -units : units;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Not an amount: ${value}`);
  return BigInt(Math.round(number * 1e8));
}

/** 150000000n to "1.5". */
export function formatQortUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const fraction = (abs % QORT_UNITS)
    .toString()
    .padStart(8, '0')
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${abs / QORT_UNITS}${fraction ? `.${fraction}` : ''}`;
}

export function buildCardTxBytes(fields: CardTxFields): Uint8Array {
  const recipient = Base58.decode(fields.recipient);
  if (!recipient || recipient.length !== 25) {
    throw new Error('Recipient is not a Qortal address');
  }
  if (fields.reference?.length !== 64) throw new Error('Reference is 64 bytes');
  if (fields.senderPublicKey?.length !== 32) {
    throw new Error('Sender public key is 32 bytes');
  }
  if (fields.amount <= 0n) throw new Error('Amount must be above zero');
  if (fields.fee < 0n) throw new Error('Fee cannot be negative');
  const isAsset = fields.kind === 'asset';
  if (isAsset && (fields.assetId === undefined || fields.assetId < 0n)) {
    throw new Error('Asset ID missing');
  }

  const out = new Uint8Array(
    isAsset ? TRANSFER_ASSET_TX_BYTES : PAYMENT_TX_BYTES
  );
  const view = new DataView(out.buffer);
  let at = 0;
  view.setInt32(at, isAsset ? TRANSFER_ASSET_TX_TYPE : PAYMENT_TX_TYPE);
  at += 4;
  view.setBigInt64(at, BigInt(fields.timestamp));
  at += 8;
  view.setInt32(at, fields.groupId ?? 0);
  at += 4;
  out.set(fields.reference, at);
  at += 64;
  out.set(fields.senderPublicKey, at);
  at += 32;
  out.set(recipient, at);
  at += 25;
  if (isAsset) {
    view.setBigInt64(at, fields.assetId);
    at += 8;
  }
  view.setBigInt64(at, fields.amount);
  at += 8;
  view.setBigInt64(at, fields.fee);
  return out;
}

interface RegisterNameFields {
  timestamp: number;
  /** 64 bytes, any value (see CardTxFields.reference). */
  reference: Uint8Array;
  senderPublicKey: Uint8Array;
  name: string;
  data?: string;
  /** In 1e-8 QORT. */
  fee: bigint;
  groupId?: number;
}

/** UTF-8 length of a name, as core counts it. */
export const nameByteLength = (name: string): number =>
  utf8ToBytes(name).length;

/**
 * REGISTER_NAME as RegisterNameTransactionTransformer reads it, signature
 * left off:
 *
 *   type 4 | timestamp 8 | group 4 | reference 64 | registrant key 32 |
 *   name length 4 | name | data length 4 | data | fee 8
 *
 * With the default data a 40-byte name makes 203 bytes, so a card can sign
 * it in one APDU.
 */
export function buildRegisterNameTxBytes(
  fields: RegisterNameFields
): Uint8Array {
  if (fields.reference?.length !== 64) throw new Error('Reference is 64 bytes');
  if (fields.senderPublicKey?.length !== 32) {
    throw new Error('Sender public key is 32 bytes');
  }
  const name = utf8ToBytes(fields.name ?? '');
  if (name.length < MIN_NAME_BYTES || name.length > MAX_NAME_BYTES) {
    throw new Error('Name must be 3 to 40 bytes');
  }
  const data = utf8ToBytes(fields.data || DEFAULT_NAME_DATA);
  if (fields.fee < 0n) throw new Error('Fee cannot be negative');

  const out = new Uint8Array(112 + 4 + name.length + 4 + data.length + 8);
  const view = new DataView(out.buffer);
  let at = 0;
  view.setInt32(at, REGISTER_NAME_TX_TYPE);
  at += 4;
  view.setBigInt64(at, BigInt(fields.timestamp));
  at += 8;
  view.setInt32(at, fields.groupId ?? 0);
  at += 4;
  out.set(fields.reference, at);
  at += 64;
  out.set(fields.senderPublicKey, at);
  at += 32;
  view.setInt32(at, name.length);
  at += 4;
  out.set(name, at);
  at += name.length;
  view.setInt32(at, data.length);
  at += 4;
  out.set(data, at);
  at += data.length;
  view.setBigInt64(at, fields.fee);
  return out;
}

/** Offset of the creator's public key, the same in every transaction. */
export const TX_CREATOR_KEY_OFFSET = 80;

/** The creator public key of unsigned transaction bytes. */
export const txCreatorPublicKey = (txBytes: Uint8Array): Uint8Array =>
  txBytes.slice(TX_CREATOR_KEY_OFFSET, TX_CREATOR_KEY_OFFSET + 32);

/** Pure Ed25519 check, the same one Qortal core makes. */
export function verifyCardSignature(
  txBytes: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  if (signature?.length !== 64 || publicKey?.length !== 32) return false;
  try {
    return nacl.sign.detached.verify(txBytes, signature, publicKey);
  } catch {
    return false;
  }
}

/** What /transactions/process takes: bytes and signature, Base58. */
export const signedTxBase58 = (
  txBytes: Uint8Array,
  signature: Uint8Array
): string => Base58.encode(concatBytes(txBytes, signature));
