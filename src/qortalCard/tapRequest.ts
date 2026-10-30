import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  buildApdu,
  CardError,
  exchange,
  type ApduTransport,
} from './cardProtocol';
import { formatQortUnits, parseQortAmount } from './cardTx';
import { Base58 } from './cryptoDeps';

/**
 * Phone to phone: the GO phone that wants QORT puts out a request (android
 * QortalHceService answers one SELECT with it), and the paying GO phone reads
 * it by tapping, then pays from its own wallet through its own Send QORT
 * screen. The request carries nothing but an address and an optional amount:
 *
 *   {"v":1,"a":"Q…","q":"1.5"}
 */

/** F0 + "QORTALP": an unregistered proprietary AID, GO's own. */
const TAP_REQUEST_AID = hexToBytes('f0514f5254414c50');
const MAX_TAP_REQUEST_BYTES = 240;

interface TapRequest {
  address: string;
  /** In 1e-8 QORT, or null to let the payer type it. */
  amount: bigint | null;
}

/** A well-formed Qortal account address, checksum included. */
export function isQortalAddress(address: unknown): address is string {
  if (typeof address !== 'string' || address.length < 30 || address.length > 36)
    return false;
  let raw: Uint8Array;
  try {
    raw = Base58.decode(address);
  } catch {
    return false;
  }
  if (!raw || raw.length !== 25 || raw[0] !== 58) return false;
  const check = sha256(sha256(raw.subarray(0, 21)));
  for (let i = 0; i < 4; i++) if (check[i] !== raw[21 + i]) return false;
  return true;
}

export function encodeTapRequest(request: TapRequest): Uint8Array {
  if (!isQortalAddress(request.address)) {
    throw new Error('Not a Qortal address');
  }
  const body: { v: 1; a: string; q?: string } = { v: 1, a: request.address };
  if (request.amount !== null && request.amount > 0n) {
    body.q = formatQortUnits(request.amount);
  }
  const bytes = utf8ToBytes(JSON.stringify(body));
  if (bytes.length > MAX_TAP_REQUEST_BYTES) throw new Error('Request too long');
  return bytes;
}

/** Strict: anything but a valid v1 request is BAD_REQUEST. */
export function decodeTapRequest(bytes: Uint8Array): TapRequest {
  if (!bytes?.length || bytes.length > MAX_TAP_REQUEST_BYTES) {
    throw new CardError('BAD_REQUEST');
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new CardError('BAD_REQUEST');
  }
  const record = body as Record<string, unknown>;
  if (
    !record ||
    typeof record !== 'object' ||
    record.v !== 1 ||
    !isQortalAddress(record.a)
  ) {
    throw new CardError('BAD_REQUEST');
  }
  let amount: bigint | null = null;
  if (record.q !== undefined) {
    amount = typeof record.q === 'string' ? parseQortAmount(record.q) : null;
    if (amount === null) throw new CardError('BAD_REQUEST');
  }
  return { address: record.a, amount };
}

/** Reads the request of the GO phone held to this one. */
export async function readTapRequest(
  transport: ApduTransport
): Promise<TapRequest> {
  const { data, sw } = await exchange(
    transport,
    buildApdu(0x00, 0xa4, 0x04, TAP_REQUEST_AID, true)
  );
  if (sw === 0x6985) throw new CardError('REQUEST_NOT_READY');
  if (sw !== 0x9000) throw new CardError('NO_REQUEST');
  return decodeTapRequest(data);
}
