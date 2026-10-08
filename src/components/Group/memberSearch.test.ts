import { describe, expect, it } from 'vitest';
import {
  buildMemberSearchIndex,
  foldForSearch,
  searchMembers,
  segmentsForMatch,
  shortAddressSegments,
} from './memberSearch';

const members = [
  { member: 'QaliceAddress111111111111111111111', primaryName: 'Alice' },
  { member: 'QmalAddress22222222222222222222222', primaryName: 'Big Al' },
  { member: 'QsalAddress33333333333333333333333', primaryName: 'Salvador' },
  { member: 'QalphaNoName44444444444444444444444' },
  { member: 'QzzzAddress5555555555555555555555al', primaryName: 'Zed' },
  {
    member: 'QaliAddress666666666666666666666666',
    primaryName: 'Al',
    isAdmin: true,
  },
];

const index = buildMemberSearchIndex(
  members,
  'QaliAddress666666666666666666666666'
);

const addresses = (query: string, limit?: number) =>
  searchMembers(index, query, limit).results.map((result) => result.address);

describe('searchMembers', () => {
  it('ranks name starts, then word starts, then contains, then addresses', () => {
    expect(addresses('al')).toEqual([
      // Name starts with "al" — the exact name first.
      'QaliAddress666666666666666666666666',
      'QaliceAddress111111111111111111111',
      // A word in the name starts with it.
      'QmalAddress22222222222222222222222',
      // The name contains it.
      'QsalAddress33333333333333333333333',
      // Only the address contains it.
      'QalphaNoName44444444444444444444444',
      'QzzzAddress5555555555555555555555al',
    ]);
  });

  it('ranks an address that starts with the query above one containing it', () => {
    expect(addresses('qz')[0]).toBe('QzzzAddress5555555555555555555555al');
    expect(addresses('qalpha')).toEqual([
      'QalphaNoName44444444444444444444444',
    ]);
  });

  it('ignores case, accents and surrounding spaces', () => {
    const accented = buildMemberSearchIndex([
      { member: 'Qzoe', primaryName: 'Zoë Ångström' },
    ]);
    expect(searchMembers(accented, '  ZOE ').results[0]?.nameMatch).toEqual({
      start: 0,
      end: 3,
    });
    expect(searchMembers(accented, 'angs').results[0]?.nameMatch).toEqual({
      start: 4,
      end: 8,
    });
  });

  it('caps the rows but counts every match', () => {
    const many = buildMemberSearchIndex(
      Array.from({ length: 12 }, (_, i) => ({
        member: `Qm${i}`,
        primaryName: `Sam ${String(i).padStart(2, '0')}`,
      }))
    );
    const { results, total } = searchMembers(many, 'sam', 8);
    expect(results).toHaveLength(8);
    expect(total).toBe(12);
    expect(results[0].name).toBe('Sam 00');
  });

  it('marks the owner and admins and finds nothing for an empty query', () => {
    const [al] = searchMembers(index, 'al').results;
    expect(al).toMatchObject({ isOwner: true, isAdmin: true, name: 'Al' });
    expect(searchMembers(index, '   ')).toEqual({ results: [], total: 0 });
    expect(searchMembers(index, 'nobody-here')).toEqual({
      results: [],
      total: 0,
    });
  });

  it('lists each address once', () => {
    const doubled = buildMemberSearchIndex([
      { member: 'Qsame', primaryName: 'Twin' },
      { member: 'Qsame', primaryName: 'Twin' },
    ]);
    expect(searchMembers(doubled, 'twin').total).toBe(1);
  });
});

describe('foldForSearch', () => {
  it('maps folded letters back to the original text', () => {
    const { folded, map } = foldForSearch('Ée');
    expect(folded).toBe('ee');
    expect(map).toEqual([0, 1, 2]);
  });
});

describe('segmentsForMatch', () => {
  it('splits around the match', () => {
    expect(segmentsForMatch('Big Al', { start: 4, end: 6 })).toEqual([
      { text: 'Big ', match: false },
      { text: 'Al', match: true },
    ]);
    expect(segmentsForMatch('Zed', null)).toEqual([
      { text: 'Zed', match: false },
    ]);
  });
});

describe('shortAddressSegments', () => {
  const address = 'QabcdefghijklmnopqrstuvwxyzABCDEF';
  const flat = (segments) => segments.map((s) => s.text).join('');

  it('keeps the start and the end', () => {
    expect(flat(shortAddressSegments(address))).toBe('Qabcde…CDEF');
  });

  it('keeps a match from the middle visible', () => {
    const segments = shortAddressSegments(address, { start: 12, end: 15 });
    expect(flat(segments)).toBe('Qabcde…lmn…CDEF');
    expect(segments.find((s) => s.match)?.text).toBe('lmn');
  });

  it('joins a match that runs on from the start', () => {
    const segments = shortAddressSegments(address, { start: 3, end: 9 });
    expect(flat(segments)).toBe('Qabcdefgh…CDEF');
    expect(segments.find((s) => s.match)?.text).toBe('cdefgh');
  });

  it('leaves short addresses whole', () => {
    expect(flat(shortAddressSegments('Qshort'))).toBe('Qshort');
  });
});
