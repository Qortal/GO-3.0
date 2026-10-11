import { describe, expect, it } from 'vitest';
import {
  isReactorItem,
  NO_REACTORS,
  normalizeReactionsMap,
} from './normalizeReactions';

describe('normalizeReactionsMap', () => {
  it('returns a clean map by identity', () => {
    const clean = {
      '👍': [{ sender: 'Q1' }],
      '❤️': [{ sender: 'Q2', senderName: 'b' }, { sender: 'Q3' }],
    };
    expect(normalizeReactionsMap(clean)).toBe(clean);
  });

  it('gives null for anything that is not a map', () => {
    expect(normalizeReactionsMap(null)).toBeNull();
    expect(normalizeReactionsMap(undefined)).toBeNull();
    expect(normalizeReactionsMap([1])).toBeNull();
    expect(normalizeReactionsMap('x')).toBeNull();
    expect(normalizeReactionsMap(5)).toBeNull();
  });

  it('keeps only non-empty lists of reactor objects, without mutating', () => {
    const raw = {
      a: undefined,
      b: [],
      c: { sender: 'x' },
      d: [null, { sender: 'y' }],
      e: 'str',
    };
    const copy = JSON.parse(JSON.stringify(raw));
    expect(normalizeReactionsMap(raw)).toEqual({ d: [{ sender: 'y' }] });
    expect(raw).toEqual({ ...copy, a: undefined });
    expect(raw.d).toEqual([null, { sender: 'y' }]);
  });

  it('gives null when nothing is left, and keeps an empty map', () => {
    expect(normalizeReactionsMap({ a: [] })).toBeNull();
    expect(normalizeReactionsMap({ a: [null, 3] })).toBeNull();
    const empty = {};
    expect(normalizeReactionsMap(empty)).toBe(empty);
  });
});

describe('isReactorItem and NO_REACTORS', () => {
  it('accepts objects only', () => {
    expect(isReactorItem({ sender: 'Q' })).toBe(true);
    expect(isReactorItem({})).toBe(true);
    expect(isReactorItem(null)).toBe(false);
    expect(isReactorItem(undefined)).toBe(false);
    expect(isReactorItem('Q')).toBe(false);
  });

  it('is a frozen empty list', () => {
    expect(NO_REACTORS).toEqual([]);
    expect(Object.isFrozen(NO_REACTORS)).toBe(true);
  });
});
