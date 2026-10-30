import { describe, expect, it, vi } from 'vitest';

// src/test/setup.ts stubs asmcrypto out; address checks need the real SHA-256.
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
// Errors carry the i18n key, so a test can tell which refusal it got.
vi.mock('i18next', () => ({
  default: {
    t: (key: string, options?: Record<string, unknown>) => {
      const params = { ...(options || {}) };
      delete params.postProcess;
      return Object.keys(params).length
        ? `${key} ${JSON.stringify(params)}`
        : key;
    },
  },
}));

import { Sha256 } from 'asmcrypto.js';
import Base58Untyped from '../encryption/Base58';
import publicKeyToAddressUntyped from '../utils/generateWallet/publicKeyToAddress';
import {
  checkValueTransferFee,
  FeeNotApprovedError,
  formatAtomicAmount,
  InvalidAmountError,
  InvalidRecipientError,
  isLookupSafeName,
  isValidPaymentAddress,
  MAX_VALUE_TRANSFER_FEE_QORT,
  parseDecimalAmount,
  recipientDisplayLabel,
  recipientFromNameRecord,
} from './paymentSafety';

/* eslint-disable @typescript-eslint/no-explicit-any */
const Base58 = Base58Untyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const ownerAddress = String(publicKeyToAddress(new Uint8Array(32).fill(7)));

/** 25 address bytes with `version` and a correct checksum, in Base58. */
function addressWithVersion(version: number, fill = 5): string {
  const body = new Uint8Array(21).fill(fill);
  body[0] = version;
  const first = new Sha256().process(body).finish().result;
  const checksum = new Sha256().process(first).finish().result.slice(0, 4);
  const bytes = new Uint8Array(25);
  bytes.set(body);
  bytes.set(checksum, 21);
  return Base58.encode(bytes) as string;
}

describe('isValidPaymentAddress (GO-20)', () => {
  it('accepts account ("Q") and AT ("A") addresses, as Core does', () => {
    const at = addressWithVersion(23);
    expect(at.startsWith('A')).toBe(true);
    expect(isValidPaymentAddress(at)).toBe(true);
    expect(isValidPaymentAddress(ownerAddress)).toBe(true);
    expect(isValidPaymentAddress(addressWithVersion(58))).toBe(true);
  });

  it('refuses other version bytes, broken checksums and non-addresses', () => {
    expect(isValidPaymentAddress(addressWithVersion(0))).toBe(false);
    expect(isValidPaymentAddress(addressWithVersion(57))).toBe(false);
    const bytes = Base58.decode(addressWithVersion(23)) as Uint8Array;
    const broken = new Uint8Array(bytes);
    broken[24] ^= 0x01;
    expect(isValidPaymentAddress(Base58.encode(broken))).toBe(false);
    expect(isValidPaymentAddress('alice')).toBe(false);
    expect(isValidPaymentAddress('')).toBe(false);
    expect(isValidPaymentAddress(undefined)).toBe(false);
  });
});

describe('parseDecimalAmount', () => {
  it.each([
    ['1.5', '1.5', BigInt(150000000)],
    [' 2 ', '2', BigInt(200000000)],
    ['00012.50', '12.5', BigInt(1250000000)],
    ['.5', '0.5', BigInt(50000000)],
    ['3.', '3', BigInt(300000000)],
    ['0.00000001', '0.00000001', BigInt(1)],
    ['12345678.12345678', '12345678.12345678', BigInt('1234567812345678')],
  ])('parses the string %j as %s', (input, text, atomic) => {
    const parsed = parseDecimalAmount(input);
    expect(parsed.text).toBe(text);
    expect(parsed.atomic).toBe(atomic);
    expect(Math.round(parsed.value * 1e8)).toBe(Number(atomic));
  });

  it('rounds numbers to 8 places, as the transaction builders do', () => {
    expect(parseDecimalAmount(1.5).text).toBe('1.5');
    expect(parseDecimalAmount(0.1 + 0.2).text).toBe('0.3');
    expect(parseDecimalAmount(0.1 + 0.2).value).toBe(0.3);
    expect(parseDecimalAmount(0.00000001).text).toBe('0.00000001');
    expect(parseDecimalAmount(1000).text).toBe('1000');
  });

  it.each([
    '1e3',
    '0x10',
    '0b11',
    'Infinity',
    'NaN',
    '-1',
    '+1',
    '1,5',
    '1.2.3',
    '',
    '   ',
    '.',
    '1.123456789',
    '١٢', // Arabic-Indic digits
    '9999999999999999999',
  ])('refuses the string %j', (input) => {
    expect(() => parseDecimalAmount(input)).toThrow(InvalidAmountError);
  });

  it.each([
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [-1],
    [1e21],
    [null],
    [undefined],
    [{}],
    [[1]],
    [true],
  ])('refuses %j', (input) => {
    expect(() => parseDecimalAmount(input)).toThrow(InvalidAmountError);
  });

  it('refuses zero unless allowed', () => {
    expect(() => parseDecimalAmount('0')).toThrow(InvalidAmountError);
    expect(() => parseDecimalAmount(0)).toThrow(InvalidAmountError);
    expect(() => parseDecimalAmount(0.000000001)).toThrow(InvalidAmountError);
    expect(parseDecimalAmount('0', { allowZero: true }).atomic).toBe(BigInt(0));
  });

  it('formats atomic amounts without trailing zeros', () => {
    expect(formatAtomicAmount(BigInt(0))).toBe('0');
    expect(formatAtomicAmount(BigInt(100000000))).toBe('1');
    expect(formatAtomicAmount(BigInt(1000001))).toBe('0.01000001');
  });
});

describe('checkValueTransferFee (GO-19)', () => {
  it('returns the node fee unchanged when it matches or is below the approved fee', () => {
    expect(checkValueTransferFee('0.01000000', '0.01000000')).toBe(
      '0.01000000'
    );
    expect(checkValueTransferFee('0.00500000', '0.01')).toBe('0.00500000');
    expect(checkValueTransferFee(0.01, 0.01)).toBe(0.01);
  });

  it('refuses a fee above the approved one', () => {
    expect(() => checkValueTransferFee('0.02000000', '0.01000000')).toThrow(
      FeeNotApprovedError
    );
    expect(() => checkValueTransferFee('0.02000000', '0.01000000')).toThrow(
      /fee_above_approved.*"fee":"0.02".*"approved":"0.01"/
    );
  });

  it('refuses a fee above the ceiling, with or without an approved fee', () => {
    expect(() => checkValueTransferFee('950.00000000')).toThrow(
      /fee_above_limit/
    );
    expect(() => checkValueTransferFee('950', '1000')).toThrow(
      /fee_above_limit/
    );
    expect(checkValueTransferFee(MAX_VALUE_TRANSFER_FEE_QORT)).toBe(
      MAX_VALUE_TRANSFER_FEE_QORT
    );
  });

  it('applies only the ceiling when no fee was approved', () => {
    for (const approved of [undefined, null, '']) {
      expect(checkValueTransferFee('0.01000000', approved)).toBe('0.01000000');
    }
  });

  it.each([['NaN'], ['-0.01'], ['1e-2'], [undefined], [{}]])(
    'refuses an unreadable node fee %j',
    (nodeFee) => {
      expect(() => checkValueTransferFee(nodeFee, '0.01')).toThrow(
        /fee_invalid/
      );
    }
  );

  it('refuses an unreadable approved fee', () => {
    expect(() => checkValueTransferFee('0.01', 'abc')).toThrow(/fee_invalid/);
  });
});

describe('isLookupSafeName (GO-20)', () => {
  it.each([
    'alice',
    'Alice Smith',
    'Who?',
    'a#b',
    'Q-App 2',
    'ü'.repeat(20), // 40 UTF-8 bytes
    '...',
  ])('accepts %j', (name) => {
    expect(isLookupSafeName(name)).toBe(true);
  });

  it.each([
    '',
    ' alice',
    'alice ',
    'a  b',
    'a\tb',
    'a\nb',
    'a/b',
    '../admin/stop',
    'a\\b',
    '.',
    '..',
    'a\u200bb',
    'a\u202eb',
    'a\u0000b',
    'x'.repeat(41),
    'ü'.repeat(21),
  ])('refuses %j', (name) => {
    expect(isLookupSafeName(name)).toBe(false);
  });

  it('refuses non-strings', () => {
    expect(isLookupSafeName(undefined)).toBe(false);
    expect(isLookupSafeName(5)).toBe(false);
  });
});

describe('recipientFromNameRecord (GO-20)', () => {
  it('uses the owner address and the name as Core spells it', () => {
    expect(
      recipientFromNameRecord('alice', { name: 'Alice', owner: ownerAddress })
    ).toEqual({ address: ownerAddress, name: 'Alice' });
    expect(recipientFromNameRecord('alice', { owner: ownerAddress })).toEqual({
      address: ownerAddress,
      name: 'alice',
    });
  });

  it.each([
    [{}],
    [null],
    ['not json'],
    [{ owner: '' }],
    [{ owner: 'Qnotanaddress' }],
    [{ owner: '../admin' }],
    [{ owner: 12 }],
  ])('refuses a record without a valid owner: %j', (record) => {
    expect(() => recipientFromNameRecord('alice', record)).toThrow(
      InvalidRecipientError
    );
  });

  it('refuses an AT address as a name owner (only accounts own names)', () => {
    expect(() =>
      recipientFromNameRecord('alice', { owner: addressWithVersion(23) })
    ).toThrow(InvalidRecipientError);
  });

  it('refuses an owner with a broken checksum', () => {
    const bytes = Base58.decode(ownerAddress) as Uint8Array;
    const broken = new Uint8Array(bytes);
    broken[24] ^= 0xff;
    expect(() =>
      recipientFromNameRecord('alice', { owner: Base58.encode(broken) })
    ).toThrow(InvalidRecipientError);
  });
});

describe('recipientDisplayLabel', () => {
  it('shows name and full address for a name, the address otherwise', () => {
    const t = (_key: string, options?: Record<string, unknown>) =>
      `${options?.name} (${options?.address})`;
    expect(
      recipientDisplayLabel({ address: ownerAddress, name: 'Alice' }, t)
    ).toBe(`Alice (${ownerAddress})`);
    expect(recipientDisplayLabel({ address: ownerAddress, name: '' }, t)).toBe(
      ownerAddress
    );
  });
});
