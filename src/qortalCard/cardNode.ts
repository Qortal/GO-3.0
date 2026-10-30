import {
  createEndpoint,
  processTransactionVersion2,
} from '../background/background';
import { qdnResourcePath } from '../utils/qdnPath';
import { nodeAmountToUnits, type CardTxKind } from './cardTx';

/**
 * The node calls Qortal Card needs, through GO's own node connection (the
 * node chosen in GO, with its API key if it has one).
 */

/** The node turned something down; `message` is its own words. */
export class NodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeError';
  }
}

async function nodeText(path: string): Promise<string> {
  const url = await createEndpoint(path);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Node answered ${response.status}`);
  return (await response.text()).trim();
}

/** A POST the way Hub's publish makes it: the body as plain text. */
async function nodePost(path: string, body: string): Promise<string> {
  const url = await createEndpoint(path);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const text = (await response.text()).trim();
  if (!response.ok)
    throw new NodeError(nodeMessage(text) || `${response.status}`);
  return text;
}

/** The message in a node error answer, or the text itself. */
function nodeMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (parsed && typeof parsed === 'object') {
      return String(parsed.message ?? parsed.error ?? text);
    }
  } catch {
    // Not JSON.
  }
  return text;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** The node answers raw transaction bytes as Base58, sometimes quoted. */
function base58Answer(text: string): string {
  const value = text.replace(/^"|"$/g, '');
  if (!BASE58.test(value))
    throw new NodeError(nodeMessage(text) || 'No answer');
  return value;
}

/** QORT balance in 1e-8 units. */
export async function fetchQortBalance(address: string): Promise<bigint> {
  return nodeAmountToUnits(
    await nodeText(`/addresses/balance/${encodeURIComponent(address)}`)
  );
}

const FEE_TX_TYPES = {
  payment: 'PAYMENT',
  asset: 'TRANSFER_ASSET',
  'register-name': 'REGISTER_NAME',
  publish: 'ARBITRARY',
} as const;

type FeeKind = CardTxKind | 'register-name' | 'publish';

/** The node's fee for one transaction of this kind, in 1e-8 QORT. */
export async function fetchUnitFee(kind: FeeKind): Promise<bigint> {
  const type = FEE_TX_TYPES[kind];
  const text = await nodeText(`/transactions/unitfee?txType=${type}`);
  if (!/^\d+$/.test(text)) throw new Error(`Unexpected fee: ${text}`);
  return BigInt(text);
}

export type BroadcastResult =
  | { ok: true; signature: string }
  | { ok: false; message: string };

/** Sends a signed transaction (Base58) to the node. */
export async function broadcastSignedTx(
  signedBase58: string
): Promise<BroadcastResult> {
  let answer: unknown;
  try {
    answer = await processTransactionVersion2(signedBase58);
  } catch (error) {
    return { ok: false, message: (error as Error)?.message || String(error) };
  }
  if (answer && typeof answer === 'object') {
    const record = answer as Record<string, unknown>;
    if ('error' in record) {
      return {
        ok: false,
        message: String(record.message ?? record.error),
      };
    }
    if (typeof record.signature === 'string') {
      return { ok: true, signature: record.signature };
    }
  }
  if (answer === true || answer === 'true') return { ok: true, signature: '' };
  return {
    ok: false,
    message: typeof answer === 'string' && answer ? answer : 'No answer',
  };
}

/**
 * Whether an address has history on chain: the node knows a last reference
 * for every address that ever received or sent a transaction. An address the
 * node has never seen answers 404 with error 124 ("account address unknown").
 */
export async function isAddressUsed(address: string): Promise<boolean> {
  const url = await createEndpoint(
    `/addresses/lastreference/${encodeURIComponent(address)}`
  );
  const response = await fetch(url);
  const text = (await response.text()).trim();
  if (response.ok) return text !== '' && text !== 'false';
  let code: unknown;
  try {
    code = (JSON.parse(text) as { error?: unknown })?.error;
  } catch {
    code = undefined;
  }
  if (response.status === 404 || code === 124) return false;
  throw new Error(`Node answered ${response.status}`);
}

export interface IncomingPayment {
  signature: string;
  from: string;
  /** In 1e-8 QORT. */
  amount: bigint;
  timestamp: number;
}

/**
 * The latest QORT payments to `address`, unconfirmed ones included, so a
 * payment shows the moment the paying phone sends it.
 */
export async function listIncomingPayments(
  address: string
): Promise<IncomingPayment[]> {
  const text = await nodeText(
    `/transactions/search?txType=PAYMENT&address=${encodeURIComponent(address)}` +
      '&confirmationStatus=BOTH&limit=20&reverse=true'
  );
  const list: unknown = JSON.parse(text);
  if (!Array.isArray(list)) return [];
  const payments: IncomingPayment[] = [];
  for (const item of list) {
    const tx = item as Record<string, unknown>;
    if (tx?.recipient !== address || typeof tx.signature !== 'string') continue;
    try {
      payments.push({
        signature: tx.signature,
        from: String(tx.creatorAddress ?? ''),
        amount: nodeAmountToUnits(String(tx.amount)),
        timestamp: Number(tx.timestamp) || 0,
      });
    } catch {
      // Not a readable amount: skip it.
    }
  }
  return payments;
}

/** The account's name on chain (its primary name), or null for none. */
export async function fetchPrimaryName(
  address: string
): Promise<string | null> {
  const url = await createEndpoint(
    `/names/primary/${encodeURIComponent(address)}`
  );
  const response = await fetch(url);
  const text = (await response.text()).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const name = (parsed as { name?: unknown } | null)?.name;
  if (typeof name === 'string' && name.trim()) return name;
  if (response.ok || response.status === 404) return null;
  throw new Error(`Node answered ${response.status}`);
}

/** Whether nobody holds this name yet (the node does not know it). */
export async function isNameFree(name: string): Promise<boolean> {
  const url = await createEndpoint(`/names/${encodeURIComponent(name)}`);
  const response = await fetch(url);
  const text = (await response.text()).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const record = parsed as { name?: unknown; error?: unknown } | null;
  if (typeof record?.name === 'string') return false;
  if (response.status === 404 || record?.error !== undefined) return true;
  throw new Error(`Node answered ${response.status}`);
}

const CARD_AVATAR_SERVICE = 'THUMBNAIL';
const CARD_AVATAR_IDENTIFIER = 'qortal_avatar';

/**
 * Hands a picture (Base64) to the node as `name`'s avatar. The node stores
 * it and answers the unsigned ARBITRARY transaction, made out to the name's
 * owner, for that owner to sign.
 */
export async function uploadAvatarForSigning(
  name: string,
  base64: string,
  fee: bigint
): Promise<string> {
  const path = qdnResourcePath({
    service: CARD_AVATAR_SERVICE,
    name,
    identifier: CARD_AVATAR_IDENTIFIER,
  });
  return base58Answer(
    await nodePost(`/arbitrary/${path}/base64?fee=${fee.toString()}`, base64)
  );
}

/** The bytes an ARBITRARY transaction is signed over (Base58 in and out). */
export async function convertForSigning(
  unsignedBase58: string
): Promise<string> {
  return base58Answer(await nodePost('/transactions/convert', unsignedBase58));
}
