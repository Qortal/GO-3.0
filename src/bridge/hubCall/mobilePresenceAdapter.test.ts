import { describe, expect, it } from 'vitest';
import { MobilePresenceAdapter } from './mobilePresenceAdapter';

const NOW = 1_700_000_000_000;
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);
const LOCAL = 'f'.repeat(32);

describe('MobilePresenceAdapter (PresenceManager subset for the call managers)', () => {
  const source = {
    getEndpoints: (address: string) =>
      address === 'Qpeer'
        ? [
            { destinationHash: A, lastSeen: NOW - 5_000 },
            { destinationHash: B.toUpperCase(), lastSeen: NOW - 1_000 },
            { destinationHash: C, lastSeen: NOW - 30_000, verified: true },
            { destinationHash: LOCAL, lastSeen: NOW },
            { destinationHash: 'not-hex', lastSeen: NOW },
            { destinationHash: 'd'.repeat(32), lastSeen: NOW - 200_000 },
            { destinationHash: A, lastSeen: NOW - 2_000 },
          ]
        : address === 'Qthrows'
          ? (() => {
              throw new Error('boom');
            })()
          : [],
  };
  const presence = new MobilePresenceAdapter(source, {
    now: () => NOW,
    getLocalDestinationHash: () => LOCAL,
  });

  it('returns live reticulum routes: verified first, then freshest; no own/stale/invalid', () => {
    expect(presence.getRoutesForAddress('Qpeer')).toEqual([
      { kind: 'reticulum', destinationHash: C },
      { kind: 'reticulum', destinationHash: B },
      { kind: 'reticulum', destinationHash: A },
    ]);
    expect(presence.getRouteForAddress('Qpeer')).toEqual({
      kind: 'reticulum',
      destinationHash: C,
    });
  });

  it('is empty (not throwing) for unknown accounts and failing sources', () => {
    expect(presence.getRoutesForAddress('Qnobody')).toEqual([]);
    expect(presence.getRouteForAddress('Qnobody')).toBeNull();
    expect(presence.getRoutesForAddress('Qthrows')).toEqual([]);
    expect(presence.getRoutesForAddress('')).toEqual([]);
  });

  it('honours a custom freshness window', () => {
    const strict = new MobilePresenceAdapter(source, {
      now: () => NOW,
      maxAgeMs: 3_000,
    });
    expect(
      strict
        .getRoutesForAddress('Qpeer')
        .map((r) => (r as { destinationHash: string }).destinationHash)
    ).toEqual([LOCAL, B, A]);
  });
});
