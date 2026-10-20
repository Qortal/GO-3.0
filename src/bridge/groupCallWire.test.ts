import { describe, expect, it } from 'vitest';
import {
  GROUP_CALL_RETICULUM_WIRE_TYPES as HUB_WIRE_TYPES,
  decodeJoinWire as hubDecodeJoinWire,
  encodeJoinWire as hubEncodeJoinWire,
} from '../../electron/src/group-call-wire-reticulum';
import {
  GROUP_CALL_RETICULUM_WIRE_TYPES,
  RT_RETICULUM_MAX_WIRE_JSON_BYTES,
  byteLengthUtf8JsonWithBridgeSender,
  decodeJoinWire,
  encodeJoinWire,
  isGroupCallLinkControlFragmentType,
  isGroupCallReticulumWireType,
  isIgnoredGroupCallWireType,
  rnsDestinationHashFromWire,
} from './groupCallWire';

const DEST = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('group-call wire types', () => {
  it('match the Hub set, including the GO0/GO1 link-control fragments', () => {
    expect([...GROUP_CALL_RETICULUM_WIRE_TYPES].sort()).toEqual(
      [...HUB_WIRE_TYPES].sort()
    );
    expect(isGroupCallReticulumWireType('GO0')).toBe(true);
    expect(isGroupCallReticulumWireType('GO1')).toBe(true);
    expect(isGroupCallLinkControlFragmentType('GO0')).toBe(true);
    expect(isGroupCallLinkControlFragmentType('GK0')).toBe(false);
  });

  it('knows the types no Hub handles', () => {
    for (const t of ['GX', 'GO', 'GE', 'GE0', 'GE1', 'GF']) {
      expect(isIgnoredGroupCallWireType(t)).toBe(true);
      expect(isGroupCallReticulumWireType(t)).toBe(false);
    }
    expect(isIgnoredGroupCallWireType('GJ')).toBe(false);
  });
});

describe('GJ destination', () => {
  const join = (chatId: string) => ({
    roomId: 'gcall-qortal-12345',
    chatId,
    fromAddress: 'QhAddressXXXXXXXXXXXXXXXXXXXXXXXXX',
    fromPublicKey: 'B'.repeat(44),
    signature: 'S'.repeat(88),
    timestamp: 1_760_000_000_000,
    reticulumDestinationHash: DEST,
    joinGeneration: 4_000_000_000,
  });

  it('stays hex while the frame fits', () => {
    const wire = encodeJoinWire(join('short'));
    expect(wire.d).toBe(DEST);
    expect(byteLengthUtf8JsonWithBridgeSender(wire)).toBeLessThanOrEqual(
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );
  });

  it('uses the Hub base64url form when the hex frame would not fit', () => {
    const env = join('c'.repeat(60));
    const wire = encodeJoinWire(env);
    expect(wire.d).toBe(hubEncodeJoinWire(env).d);
    expect(wire.d).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(decodeJoinWire(wire)?.reticulumDestinationHash).toBe(DEST);
    expect(hubDecodeJoinWire(wire)?.reticulumDestinationHash).toBe(DEST);
  });

  it('decodes a Hub GJ that carries the compact form', () => {
    const hubWire = hubEncodeJoinWire(join('c'.repeat(60)));
    expect(decodeJoinWire(hubWire)).toMatchObject({
      reticulumDestinationHash: DEST,
      joinGeneration: 4_000_000_000,
    });
    expect(rnsDestinationHashFromWire(hubWire.d)).toBe(DEST);
    expect(rnsDestinationHashFromWire(DEST.toUpperCase())).toBe(DEST);
    expect(rnsDestinationHashFromWire('not-a-hash')).toBeNull();
  });
});
