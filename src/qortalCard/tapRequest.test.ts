import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import type { ApduTransport } from './cardProtocol';
import {
  decodeTapRequest,
  encodeTapRequest,
  isQortalAddress,
  readTapRequest,
} from './tapRequest';

// The RFC 8032 test key's address (Qortal core /addresses/convert).
const ADDRESS = 'QaQXDVEEpn7ZPJXsGJS1aYKY7zEPmG2CoA';

/** A GO phone as QortalHceService answers (TapRequestPolicy). */
const phone = (payload: Uint8Array | null): ApduTransport => ({
  transceive: async (apdu) => {
    if (bytesToHex(apdu.slice(0, 13)) !== '00a4040008f0514f5254414c50') {
      return new Uint8Array([0x6d, 0x00]);
    }
    return payload
      ? concatBytes(payload, new Uint8Array([0x90, 0x00]))
      : new Uint8Array([0x69, 0x85]);
  },
});

describe('addresses', () => {
  it('checks the version byte and checksum', () => {
    expect(isQortalAddress(ADDRESS)).toBe(true);
    expect(isQortalAddress('QaQXDVEEpn7ZPJXsGJS1aYKY7zEPmG2CoB')).toBe(false);
    expect(isQortalAddress('1BoatSLRHtKNngkdXEeobR76b53LETtpyT')).toBe(false);
    expect(isQortalAddress('')).toBe(false);
    expect(isQortalAddress(42)).toBe(false);
    expect(isQortalAddress('Q0OIl')).toBe(false);
  });
});

describe('payment requests', () => {
  it('round-trips an address with and without an amount', () => {
    const withAmount = encodeTapRequest({
      address: ADDRESS,
      amount: 150000000n,
    });
    expect(new TextDecoder().decode(withAmount)).toBe(
      `{"v":1,"a":"${ADDRESS}","q":"1.5"}`
    );
    expect(decodeTapRequest(withAmount)).toEqual({
      address: ADDRESS,
      amount: 150000000n,
    });
    expect(
      decodeTapRequest(encodeTapRequest({ address: ADDRESS, amount: null }))
    ).toEqual({ address: ADDRESS, amount: null });
  });

  it('refuses anything that is not a clean v1 request', () => {
    const bad = [
      '',
      'not json',
      '[]',
      `{"v":2,"a":"${ADDRESS}"}`,
      '{"v":1,"a":"QaQXDVEEpn7ZPJXsGJS1aYKY7zEPmG2CoB"}',
      `{"v":1,"a":"${ADDRESS}","q":"-1"}`,
      `{"v":1,"a":"${ADDRESS}","q":1.5}`,
      `{"v":1,"a":"${ADDRESS}","q":"0"}`,
      `{"v":1,"a":"${ADDRESS}","q":"1.123456789"}`,
    ];
    for (const text of bad) {
      expect(() => decodeTapRequest(utf8ToBytes(text))).toThrow();
    }
    expect(() => decodeTapRequest(new Uint8Array([0xff, 0xfe]))).toThrow();
    expect(() => decodeTapRequest(new Uint8Array(241).fill(0x20))).toThrow();
    expect(() =>
      encodeTapRequest({ address: 'Qnope', amount: null })
    ).toThrow();
  });

  it('reads a request off a GO phone', async () => {
    const request = encodeTapRequest({ address: ADDRESS, amount: 5n });
    await expect(readTapRequest(phone(request))).resolves.toEqual({
      address: ADDRESS,
      amount: 5n,
    });
  });

  it('tells a phone with no request out from a card', async () => {
    await expect(readTapRequest(phone(null))).rejects.toMatchObject({
      code: 'REQUEST_NOT_READY',
    });
    const card: ApduTransport = {
      transceive: async () => new Uint8Array([0x6a, 0x82]),
    };
    await expect(readTapRequest(card)).rejects.toMatchObject({
      code: 'NO_REQUEST',
    });
  });
});
