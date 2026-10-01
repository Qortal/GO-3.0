import { describe, expect, it } from 'vitest';
import {
  FEATURED_COUNT,
  compareByWeightedRating,
  pickTopRated,
  weightedRatingScore,
} from './appRatingScore';

describe('weightedRatingScore', () => {
  it('has no score without votes', () => {
    expect(weightedRatingScore(5, 0)).toBeNull();
    expect(weightedRatingScore(undefined, undefined)).toBeNull();
  });

  it('pulls a lone self-rating towards the middle', () => {
    expect(weightedRatingScore(5, 1)).toBeCloseTo(3.5);
  });

  it('ranks many good votes above a few perfect ones', () => {
    const many = weightedRatingScore(4.8, 10)!;
    const few = weightedRatingScore(5, 2)!;
    expect(many).toBeGreaterThan(few);
  });
});

describe('compareByWeightedRating', () => {
  it('puts unrated last and breaks ties on votes', () => {
    const ranked = [
      { score: null, votes: 0 },
      { score: 4.5, votes: 3 },
      { score: 4.5, votes: 9 },
    ].sort(compareByWeightedRating);
    expect(ranked).toEqual([
      { score: 4.5, votes: 9 },
      { score: 4.5, votes: 3 },
      { score: null, votes: 0 },
    ]);
  });
});

describe('pickTopRated', () => {
  const ratings: Record<string, { averageRating: number; totalVotes: number }> =
    {
      lone: { averageRating: 5, totalVotes: 1 },
      many: { averageRating: 4.8, totalVotes: 10 },
      few: { averageRating: 5, totalVotes: 3 },
    };

  it('orders by weighted score and skips single votes', () => {
    expect(
      pickTopRated(['lone', 'few', 'many', 'unrated'], (key) => ratings[key])
    ).toEqual(['many', 'few']);
  });

  it(`keeps at most ${FEATURED_COUNT}`, () => {
    const keys = Array.from({ length: 15 }, (_, i) => `app${i}`);
    const top = pickTopRated(keys, (key) => ({
      averageRating: 4,
      totalVotes: 2 + Number(key.slice(3)),
    }));
    expect(top).toHaveLength(FEATURED_COUNT);
    expect(top[0]).toBe('app14');
  });
});
