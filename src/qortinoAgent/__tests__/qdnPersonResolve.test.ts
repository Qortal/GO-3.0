import { describe, expect, it } from 'vitest';
import {
  extractNameCandidates,
  nameCaseLookupVariants,
  orderedPersonExactLookupKeys,
  personNameQueryVariants,
  scoreRegisteredNameMatch,
} from '../qdnLookup';

describe('strict person name resolve helpers', () => {
  it('keeps Qortal Justin as the leading who-is candidate', () => {
    const c = extractNameCandidates('who is Qortal Justin');
    expect(c[0]?.toLowerCase()).toBe('qortal justin');
  });

  it('builds Qortal / bare variants', () => {
    expect(personNameQueryVariants('Qortal Justin').map((x) => x.toLowerCase())).toEqual(
      expect.arrayContaining(['qortal justin', 'justin'])
    );
    expect(personNameQueryVariants('Justin').map((x) => x.toLowerCase())).toEqual(
      expect.arrayContaining(['justin', 'qortal justin'])
    );
  });

  it('tries typed Kitty (all casings) before Qortal Kitty', () => {
    const keys = orderedPersonExactLookupKeys('Kitty');
    expect(keys[0]).toBe('Kitty');
    expect(keys.map((k) => k.toLowerCase())).toContain('kitty');
    const qortalIdx = keys.findIndex((k) => k.toLowerCase() === 'qortal kitty');
    const kittyIdx = keys.findIndex((k) => k.toLowerCase() === 'kitty');
    expect(kittyIdx).toBeGreaterThanOrEqual(0);
    expect(qortalIdx).toBeGreaterThan(kittyIdx);
  });

  it('includes lower / UPPER / Title case lookup spellings', () => {
    expect(nameCaseLookupVariants('Kitty')).toEqual(
      expect.arrayContaining(['Kitty', 'kitty', 'KITTY'])
    );
  });

  it('scores exact Kitty far above Qortal Kitty', () => {
    expect(scoreRegisteredNameMatch('Kitty', 'Kitty')).toBe(1000);
    expect(scoreRegisteredNameMatch('Kitty', 'kitty')).toBe(1000);
    expect(scoreRegisteredNameMatch('Kitty', 'Kitty')).toBeGreaterThan(
      scoreRegisteredNameMatch('Kitty', 'Qortal Kitty')
    );
  });

  it('rejects Qortal Justin → Qortal News Network style prefix fuzz', () => {
    expect(scoreRegisteredNameMatch('Qortal Justin', 'Qortal Justin')).toBe(1000);
    expect(scoreRegisteredNameMatch('Qortal Justin', 'Qortal News Network')).toBe(
      0
    );
    expect(scoreRegisteredNameMatch('Qortal Justin', 'Qortal Justin Extra')).toBeGreaterThan(
      500
    );
    expect(scoreRegisteredNameMatch('Justin', 'Qortal Justin')).toBeGreaterThan(0);
  });

  it('tolerates small typos like qoral justin → Qortal Justin', () => {
    expect(
      scoreRegisteredNameMatch('qoral justin', 'Qortal Justin')
    ).toBeGreaterThanOrEqual(180);
    expect(
      scoreRegisteredNameMatch('qoral justin', 'Qortal News Network')
    ).toBe(0);
  });
});
