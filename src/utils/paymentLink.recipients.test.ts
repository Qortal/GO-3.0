import { describe, expect, it, vi } from 'vitest';

// src/test/setup.ts stubs asmcrypto out; address checks need the real SHA-256.
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);

import { Sha256 } from 'asmcrypto.js';
import Base58Untyped from '../encryption/Base58';
import { parsePaymentTarget } from './paymentLink';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Base58 = Base58Untyped as any;

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

const account = addressWithVersion(58);
const at = addressWithVersion(23);

// A scanned or tapped payment link only pre-fills the Send screen, but what
// it pre-fills must be a real recipient and a plain amount (E2b / GO-20).
describe('parsePaymentTarget recipients and amounts', () => {
  it('accepts account and AT addresses and registered-name text', () => {
    expect(parsePaymentTarget(`qortal://pay?recipient=${account}`)).toEqual({
      kind: 'payment',
      recipient: account,
    });
    expect(parsePaymentTarget(`qort:${at}?amount=2`)).toEqual({
      kind: 'payment',
      recipient: at,
      amount: 2,
    });
    expect(parsePaymentTarget('qortal://send?to=Simon James')).toEqual({
      kind: 'payment',
      recipient: 'Simon James',
    });
  });

  it.each([
    'qortal://pay?recipient=..',
    'qortal://pay?recipient=a%2Fb',
    'qortal://pay?recipient=a%5Cb',
    'qortal://pay?recipient=%E2%80%AEevil',
    `qortal://pay?recipient=${'x'.repeat(41)}`,
    'qort:../../admin?amount=1',
  ])('refuses %s', (link) => {
    expect(parsePaymentTarget(link)).toEqual({ kind: 'none' });
  });

  it.each([
    ['1.5', 1.5],
    ['1,5', 1.5],
    ['0.00000001', 0.00000001],
  ])('reads amount %s as %s', (amount, value) => {
    expect(
      parsePaymentTarget(`qortal://pay?recipient=Alice&amount=${amount}`)
    ).toEqual({ kind: 'payment', recipient: 'Alice', amount: value });
  });

  it.each(['1e3', '0x10', 'Infinity', '-5', '0', '1.123456789'])(
    'drops amount %s and keeps the recipient',
    (amount) => {
      expect(
        parsePaymentTarget(`qortal://pay?recipient=Alice&amount=${amount}`)
      ).toEqual({ kind: 'payment', recipient: 'Alice' });
    }
  );
});
