/**
 * How an app ranks by rating, counting how many people voted as well as the
 * average (a Bayesian average). Every app starts as if RATING_PRIOR_VOTES
 * people had given it RATING_PRIOR_MEAN stars, so one self-rated 5-star vote
 * (60 of the 111 rated apps in Sep 2026) scores 3.5, while 10 votes averaging
 * 5.0 score 4.5.
 */
export const RATING_PRIOR_MEAN = 3;
export const RATING_PRIOR_VOTES = 3;

/** Fewest votes an app needs before it can be featured for its rating. */
export const FEATURED_MIN_VOTES = 2;
/** How many apps a Featured carousel shows (Community, each category). */
export const FEATURED_COUNT = 10;

export const weightedRatingScore = (
  averageRating: number | null | undefined,
  totalVotes: number | null | undefined
): number | null => {
  const votes = Number(totalVotes) || 0;
  if (votes <= 0) return null;
  const average = Number(averageRating) || 0;
  return (
    (average * votes + RATING_PRIOR_MEAN * RATING_PRIOR_VOTES) /
    (votes + RATING_PRIOR_VOTES)
  );
};

/**
 * Sort comparator input: higher score first, then more votes; unrated last.
 */
export const compareByWeightedRating = (
  a: { score: number | null; votes: number },
  b: { score: number | null; votes: number }
) => {
  if (a.score == null && b.score == null) return 0;
  if (a.score == null) return 1;
  if (b.score == null) return -1;
  return b.score - a.score || b.votes - a.votes;
};

/**
 * The best rated items for a Featured carousel: weighted score first, then
 * votes; items with fewer than FEATURED_MIN_VOTES votes are left out.
 */
export const pickTopRated = <T>(
  items: T[],
  getRating: (
    item: T
  ) =>
    | { averageRating?: number | null; totalVotes?: number | null }
    | null
    | undefined,
  count = FEATURED_COUNT
): T[] =>
  items
    .map((item) => {
      const rating = getRating(item);
      const votes = Number(rating?.totalVotes) || 0;
      return {
        item,
        score: weightedRatingScore(rating?.averageRating, votes),
        votes,
      };
    })
    .filter((entry) => entry.votes >= FEATURED_MIN_VOTES)
    .sort(compareByWeightedRating)
    .slice(0, count)
    .map((entry) => entry.item);
