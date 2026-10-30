import i18n from 'i18next';
import {
  AT_ADDRESS_VERSION,
  isValidAddressWithVersion,
  isValidQortalAddress,
} from '../encryption/addressKeyCheck';
import { ADDRESS_VERSION } from '../constants/constants';

/**
 * Checks used between "the user approved a payment" and "GO signs it".
 *
 * - Amounts are parsed as plain decimals with at most 8 places. "1e3", "0x10",
 *   "Infinity" and negative values are refused, and the dialog shows the value
 *   that will be signed, not the text a Q-App sent.
 * - The fee is fetched again just before signing. It may not be higher than
 *   the fee the user approved, and never above a fixed ceiling.
 * - A recipient name is checked before it is put in a node path, and the
 *   owner address the node returns must be a real Qortal address.
 */

/**
 * True for an address QORT or an asset can be sent to: an account address
 * ("Q…") or an AT address ("A…", e.g. a crowdfund), with a valid checksum.
 * Core accepts both as PAYMENT and TRANSFER_ASSET recipients.
 */
export function isValidPaymentAddress(address: unknown): address is string {
  return isValidAddressWithVersion(address, [
    ADDRESS_VERSION,
    AT_ADDRESS_VERSION,
  ]);
}

const DECIMALS = 8;
const ATOMIC_PER_UNIT = BigInt(100000000);
const DECIMAL_TEXT = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * The highest fee GO signs for a PAYMENT or TRANSFER_ASSET, in QORT. Core's
 * fee for these is 0.01 QORT; the ceiling leaves room for a fee change but
 * stops a node from taking most of a balance as the fee.
 */
export const MAX_VALUE_TRANSFER_FEE_QORT = '1';

type ParsedAmount = {
  /** Amount in 1e-8 units. */
  atomic: bigint;
  /** Normalised decimal text, without trailing zeros ("1.5", "0.00000001"). */
  text: string;
  /** Number to hand to the transaction builder. */
  value: number;
};

export class InvalidAmountError extends Error {
  constructor() {
    super(
      i18n.t('core:message.error.invalid_amount', {
        postProcess: 'capitalizeFirstChar',
      })
    );
    this.name = 'InvalidAmountError';
  }
}

/** "150000000" (atomic) -> "1.5". */
export function formatAtomicAmount(atomic: bigint): string {
  const negative = atomic < BigInt(0);
  const abs = negative ? -atomic : atomic;
  const whole = (abs / ATOMIC_PER_UNIT).toString();
  const fraction = (abs % ATOMIC_PER_UNIT)
    .toString()
    .padStart(DECIMALS, '0')
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Parses an amount strictly. Strings must be plain decimals with at most 8
 * places (surrounding spaces are ignored). Numbers must be finite and are
 * rounded to 8 places, as the transaction builders round them. Zero is refused
 * unless `allowZero` is set. Throws InvalidAmountError.
 */
export function parseDecimalAmount(
  value: unknown,
  { allowZero = false }: { allowZero?: boolean } = {}
): ParsedAmount {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new InvalidAmountError();
    text = value.toFixed(DECIMALS);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    throw new InvalidAmountError();
  }

  if (!DECIMAL_TEXT.test(text)) throw new InvalidAmountError();
  const [wholeText, fractionText = ''] = text.split('.');
  if (fractionText.length > DECIMALS) throw new InvalidAmountError();

  const atomic =
    BigInt(wholeText || '0') * ATOMIC_PER_UNIT +
    BigInt(fractionText.padEnd(DECIMALS, '0') || '0');
  if (atomic === BigInt(0) && !allowZero) throw new InvalidAmountError();
  if (atomic > BigInt(Number.MAX_SAFE_INTEGER)) throw new InvalidAmountError();

  const normalised = formatAtomicAmount(atomic);
  const numeric = Number(normalised);
  // The builders sign Math.round(value * 1e8); refuse anything that would not
  // come out as exactly this amount.
  if (BigInt(Math.round(numeric * 1e8)) !== atomic) {
    throw new InvalidAmountError();
  }
  return { atomic, text: normalised, value: numeric };
}

export class FeeNotApprovedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeeNotApprovedError';
  }
}

function hasApprovedFee(approvedFee: unknown): boolean {
  return (
    approvedFee !== undefined && approvedFee !== null && approvedFee !== ''
  );
}

/**
 * Checks the fee the node gave just before signing. Returns `nodeFee`
 * unchanged when it is no higher than `approvedFee` (when one is given) and no
 * higher than MAX_VALUE_TRANSFER_FEE_QORT; throws FeeNotApprovedError
 * otherwise. Nothing is signed after a throw.
 */
export function checkValueTransferFee<T>(nodeFee: T, approvedFee?: unknown): T {
  let fee: ParsedAmount;
  try {
    fee = parseDecimalAmount(nodeFee, { allowZero: true });
  } catch {
    throw new FeeNotApprovedError(
      i18n.t('question:message.error.fee_invalid', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  const ceiling = parseDecimalAmount(MAX_VALUE_TRANSFER_FEE_QORT);
  if (fee.atomic > ceiling.atomic) {
    throw new FeeNotApprovedError(
      i18n.t('question:message.error.fee_above_limit', {
        fee: fee.text,
        limit: ceiling.text,
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  if (hasApprovedFee(approvedFee)) {
    let approved: ParsedAmount;
    try {
      approved = parseDecimalAmount(approvedFee, { allowZero: true });
    } catch {
      throw new FeeNotApprovedError(
        i18n.t('question:message.error.fee_invalid', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
    if (fee.atomic > approved.atomic) {
      throw new FeeNotApprovedError(
        i18n.t('question:message.error.fee_above_approved', {
          fee: fee.text,
          approved: approved.text,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  }
  return nodeFee;
}

/** Core's limit for a registered name, in UTF-8 bytes. */
const MAX_NAME_BYTES = 40;

function isControlOrInvisible(code: number): boolean {
  return (
    code <= 0x1f || // C0 controls
    (code >= 0x7f && code <= 0x9f) || // DEL, C1 controls
    code === 0xad || // soft hyphen
    (code >= 0x200b && code <= 0x200f) || // zero-width, LRM/RLM
    (code >= 0x202a && code <= 0x202e) || // bidi embedding/override
    (code >= 0x2060 && code <= 0x206f) || // word joiner, bidi isolates
    code === 0xfeff // BOM
  );
}

function hasControlOrInvisibleCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (isControlOrInvisible(value.charCodeAt(i))) return true;
  }
  return false;
}

/**
 * True for text that can be a registered Qortal name and is safe to put in a
 * /names/<name> path: 1-40 UTF-8 bytes, no surrounding or repeated
 * whitespace, no control or invisible characters, no "/" or "\" (Core cannot
 * serve those in a path anyway), and not "." or "..".
 */
export function isLookupSafeName(name: unknown): name is string {
  if (typeof name !== 'string' || !name) return false;
  if (name !== name.trim()) return false;
  if (/\s{2,}/.test(name) || /[^\S ]/.test(name)) return false;
  if (hasControlOrInvisibleCharacter(name)) return false;
  if (/[/\\]/.test(name)) return false;
  if (name === '.' || name === '..') return false;
  return new TextEncoder().encode(name).length <= MAX_NAME_BYTES;
}

export class InvalidRecipientError extends Error {
  constructor() {
    super(
      i18n.t('question:message.error.invalid_receiver', {
        postProcess: 'capitalizeFirstChar',
      })
    );
    this.name = 'InvalidRecipientError';
  }
}

export class RecipientNameNotFoundError extends Error {
  constructor() {
    super(
      i18n.t('auth:message.error.name_not_existing', {
        postProcess: 'capitalizeFirstChar',
      })
    );
    this.name = 'RecipientNameNotFoundError';
  }
}

export type ResolvedRecipient = {
  /** The address the payment goes to. */
  address: string;
  /** The registered name the user or Q-App gave, as Core spells it; '' for an address. */
  name: string;
};

/**
 * Builds the recipient from the node's /names/<name> answer. The owner must be
 * a valid Qortal address; otherwise InvalidRecipientError.
 */
export function recipientFromNameRecord(
  requestedName: string,
  record: unknown
): ResolvedRecipient {
  const data = (record && typeof record === 'object' ? record : {}) as {
    owner?: unknown;
    name?: unknown;
  };
  if (!isValidQortalAddress(data.owner)) throw new InvalidRecipientError();
  const name =
    typeof data.name === 'string' && isLookupSafeName(data.name)
      ? data.name
      : requestedName;
  return { address: data.owner, name };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "name (address)" for a named recipient, the address otherwise. */
export function recipientDisplayLabel(
  recipient: ResolvedRecipient,
  t: Translate = (key, options) => i18n.t(key, options) as string
): string {
  if (!recipient.name) return recipient.address;
  return t('question:recipient_name_address', {
    name: recipient.name,
    address: recipient.address,
  });
}
