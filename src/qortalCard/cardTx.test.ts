import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  buildCardTxBytes,
  buildRegisterNameTxBytes,
  DEFAULT_NAME_DATA,
  formatQortUnits,
  MAX_CARD_MESSAGE_BYTES,
  MAX_NAME_BYTES,
  nameByteLength,
  nodeAmountToUnits,
  parseQortAmount,
  signedTxBase58,
  txCreatorPublicKey,
  verifyCardSignature,
} from './cardTx';
import { Base58, nacl } from './cryptoDeps';

// RFC 8032 section 7.1 TEST 1.
const SEED = hexToBytes(
  '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'
);
const PUB = hexToBytes(
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
);
// Its address, from Qortal core's /addresses/convert.
const ADDRESS = 'QaQXDVEEpn7ZPJXsGJS1aYKY7zEPmG2CoA';
const REFERENCE = Uint8Array.from({ length: 64 }, (_, i) => i);

// Built by nfc-band/bandtest.py, whose signatures Qortal core accepted.
const PAYMENT_HEX =
  '00000002000001a1350fe6de00000000000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3fd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a3a9766bc6a50b376bd6fb25ecc5bd3288a663bbec99ad753990000000008f0d18000000000000f4240';
const ASSET_HEX =
  '0000000c000001a1350fe6de00000000000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3fd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a3a9766bc6a50b376bd6fb25ecc5bd3288a663bbec99ad7539900000000000000010000000008f0d18000000000000f4240';
const PAYMENT_SIGNATURE_HEX =
  'd58c15e308ce5cec40b33ab4b411f8326ca7dc7dded9b9a0613427c5ef3b0dd81f1ad65af55e2971f97decb8292d3a950e39a43f979031e987e3a554a67eb009';

const fields = {
  timestamp: 1791891597022,
  reference: REFERENCE,
  senderPublicKey: PUB,
  recipient: ADDRESS,
  amount: 150000000n,
  fee: 1000000n,
};

describe('buildCardTxBytes', () => {
  it('builds a PAYMENT exactly as Qortal core reads it', () => {
    const bytes = buildCardTxBytes({ kind: 'payment', ...fields });
    expect(bytes.length).toBe(153);
    expect(bytesToHex(bytes)).toBe(PAYMENT_HEX);
  });

  it('builds a TRANSFER_ASSET with the asset ID before the amount', () => {
    const bytes = buildCardTxBytes({ kind: 'asset', assetId: 1n, ...fields });
    expect(bytes.length).toBe(161);
    expect(bytesToHex(bytes)).toBe(ASSET_HEX);
  });

  it('refuses what the node would refuse anyway', () => {
    const payment = { kind: 'payment' as const, ...fields };
    expect(() => buildCardTxBytes({ ...payment, recipient: 'Qabc' })).toThrow();
    expect(() => buildCardTxBytes({ ...payment, amount: 0n })).toThrow();
    expect(() => buildCardTxBytes({ ...payment, fee: -1n })).toThrow();
    expect(() =>
      buildCardTxBytes({ ...payment, reference: new Uint8Array(32) })
    ).toThrow();
    expect(() =>
      buildCardTxBytes({ ...payment, senderPublicKey: new Uint8Array(33) })
    ).toThrow();
    expect(() => buildCardTxBytes({ ...fields, kind: 'asset' })).toThrow();
  });
});

describe('signatures', () => {
  const bytes = buildCardTxBytes({ kind: 'payment', ...fields });

  it('is pure Ed25519: the known signature verifies, a changed one does not', () => {
    const signature = hexToBytes(PAYMENT_SIGNATURE_HEX);
    expect(
      bytesToHex(
        nacl.sign.detached(bytes, nacl.sign.keyPair.fromSeed(SEED).secretKey)
      )
    ).toBe(PAYMENT_SIGNATURE_HEX);
    expect(verifyCardSignature(bytes, signature, PUB)).toBe(true);
    const changed = signature.slice();
    changed[40] ^= 1;
    expect(verifyCardSignature(bytes, changed, PUB)).toBe(false);
    expect(verifyCardSignature(bytes, signature.slice(0, 63), PUB)).toBe(false);
  });

  it('sends bytes and signature together, Base58', () => {
    const signature = hexToBytes(PAYMENT_SIGNATURE_HEX);
    const decoded = Base58.decode(signedTxBase58(bytes, signature));
    expect(bytesToHex(decoded)).toBe(PAYMENT_HEX + PAYMENT_SIGNATURE_HEX);
  });
});

describe('amounts', () => {
  it('parses what a shop types', () => {
    expect(parseQortAmount('1')).toBe(100000000n);
    expect(parseQortAmount('1.5')).toBe(150000000n);
    expect(parseQortAmount(' 1,5 ')).toBe(150000000n);
    expect(parseQortAmount('.5')).toBe(50000000n);
    expect(parseQortAmount('2.')).toBe(200000000n);
    expect(parseQortAmount('0.00000001')).toBe(1n);
  });

  it('refuses zero, negatives, too many decimals and words', () => {
    for (const bad of [
      '',
      '0',
      '0.0',
      '-1',
      '1e3',
      '0.000000001',
      'abc',
      '1.2.3',
    ])
      expect(parseQortAmount(bad)).toBeNull();
  });

  it('reads node numbers, exponent forms included', () => {
    expect(nodeAmountToUnits('12.34000000')).toBe(1234000000n);
    expect(nodeAmountToUnits('0')).toBe(0n);
    expect(nodeAmountToUnits('"5"')).toBe(500000000n);
    expect(nodeAmountToUnits('1.0E-4')).toBe(10000n);
    expect(() => nodeAmountToUnits('nope')).toThrow();
  });

  it('formats units without trailing zeros', () => {
    expect(formatQortUnits(150000000n)).toBe('1.5');
    expect(formatQortUnits(1n)).toBe('0.00000001');
    expect(formatQortUnits(0n)).toBe('0');
    expect(formatQortUnits(-250000000n)).toBe('-2.5');
  });
});

describe('REGISTER_NAME for a card', () => {
  it('is byte for byte what Hub builds for its own names', async () => {
    const { default: RegisterNameTransaction } =
      await import('../transactions/RegisterNameTransaction');
    const pair = nacl.sign.keyPair.fromSeed(SEED);
    const hub = new RegisterNameTransaction();
    hub.keyPair = { publicKey: pair.publicKey, privateKey: pair.secretKey };
    hub.fee = 1.25;
    hub.name = 'Simon Card';
    hub.value = '';
    hub.lastReference = REFERENCE;
    hub.timestamp = 1791891597022;

    const ours = buildRegisterNameTxBytes({
      timestamp: 1791891597022,
      reference: REFERENCE,
      senderPublicKey: PUB,
      name: 'Simon Card',
      fee: 125000000n,
    });
    expect(bytesToHex(ours)).toBe(bytesToHex(hub.generateBase()));
    expect(txCreatorPublicKey(ours)).toEqual(PUB);
  });

  it('keeps names within what core takes, and within one APDU', () => {
    const fields = {
      timestamp: 1,
      reference: REFERENCE,
      senderPublicKey: PUB,
      fee: 125000000n,
    };
    expect(() => buildRegisterNameTxBytes({ ...fields, name: 'ab' })).toThrow();
    expect(() =>
      buildRegisterNameTxBytes({ ...fields, name: 'x'.repeat(41) })
    ).toThrow();
    // Two bytes a letter: 21 letters are 42 bytes.
    expect(() =>
      buildRegisterNameTxBytes({ ...fields, name: 'ä'.repeat(21) })
    ).toThrow();
    expect(nameByteLength('ä'.repeat(20))).toBe(40);
    const longest = buildRegisterNameTxBytes({
      ...fields,
      name: 'x'.repeat(MAX_NAME_BYTES),
    });
    expect(longest.length).toBe(203);
    expect(longest.length).toBeLessThanOrEqual(MAX_CARD_MESSAGE_BYTES);
    expect(new TextDecoder().decode(longest.slice(160, 195))).toBe(
      DEFAULT_NAME_DATA
    );
  });
});
