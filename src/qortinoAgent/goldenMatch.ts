/**
 * Fuzzy match against curated golden Q&As so high-stakes offline questions
 * can return a strong answer without relying only on the tiny GGUF.
 */
import goldenAnswers from './goldenAnswers.json';
import { isQortPriceQuery } from './queryIntent';

export type GoldenEntry = {
  id: string;
  category: string;
  q: string;
  aliases?: string[];
  a: string;
  priority?: number;
};

export type GoldenMatch = {
  entry: GoldenEntry;
  score: number;
};

const ENTRIES = (goldenAnswers as { entries: GoldenEntry[] }).entries || [];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    // Drop punctuation so "nomination?" matches "nomination".
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t));
}

const STOP = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'to',
  'of',
  'in',
  'on',
  'for',
  'and',
  'or',
  'how',
  'do',
  'does',
  'did',
  'can',
  'could',
  'would',
  'should',
  'i',
  'me',
  'my',
  'you',
  'your',
  'we',
  'our',
  'please',
  'tell',
  'about',
  'with',
  'from',
  'what',
  'which',
  'when',
  'where',
  'who',
  'why',
  // Conversational filler — "I want to mint" must score like "mint".
  'want',
  'wants',
  'wanted',
  'wanna',
  'need',
  'needs',
  'needed',
  'like',
  'know',
  'just',
  'really',
  'hey',
  'hello',
  'hi',
  'im',
  "i'm",
]);

/**
 * Light suffix stemming so "mint" / "minting" / "minter" (and
 * publish/publishing, trade/trading…) count as the same concept.
 */
function stem(token: string): string {
  let s = token;
  if (s.length >= 6 && /ings?$/.test(s)) s = s.replace(/ings?$/, '');
  else if (s.length >= 6 && /ers?$/.test(s)) s = s.replace(/ers?$/, '');
  else if (s.length >= 5 && /ies$/.test(s)) s = s.replace(/ies$/, 'y');
  else if (s.length >= 5 && /(es|ed)$/.test(s)) s = s.replace(/(es|ed)$/, '');
  else if (s.length >= 4 && /s$/.test(s) && !/ss$/.test(s)) s = s.replace(/s$/, '');
  return s.length >= 3 ? s : token;
}

function stemsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  // "nominat(e)" vs "nomination" — shared long prefix counts.
  return (
    a.length >= 4 &&
    b.length >= 4 &&
    (a.startsWith(b) || b.startsWith(a))
  );
}

/** Jaccard over stemmed tokens with long-prefix equivalence. */
function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = [...new Set(a.map(stem))];
  const B = [...new Set(b.map(stem))];
  const usedB = new Set<number>();
  let inter = 0;
  for (const t of A) {
    for (let i = 0; i < B.length; i += 1) {
      if (usedB.has(i)) continue;
      if (stemsMatch(t, B[i])) {
        usedB.add(i);
        inter += 1;
        break;
      }
    }
  }
  const union = A.length + B.length - inter;
  return union === 0 ? 0 : inter / union;
}

function phraseBonus(query: string, candidate: string): number {
  const q = normalize(query);
  const c = normalize(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (q.includes(c) || c.includes(q)) return 0.55;
  // shared long substring (≥12 chars) helps paraphrases
  if (q.length >= 12 && c.includes(q.slice(0, Math.min(24, q.length)))) return 0.25;
  return 0;
}

/** "grow mint" / herb tea — must not steal Qortal minting FAQs. */
function looksLikeHerbMint(query: string): boolean {
  const t = normalize(query);
  if (!/\bmint\b/.test(t)) return false;
  return /\b(grow|plant|harvest|dry|tea|leaves?|herb|mojito|spearmint|peppermint|garden|cook|kitchen|compost|soil|pot)\b/.test(
    t
  );
}

function isQortalMintingFaq(entry: GoldenEntry): boolean {
  if (entry.category !== 'qortal') return false;
  const blob = `${entry.q} ${(entry.aliases || []).join(' ')}`.toLowerCase();
  return /\bmint(ing|er|ership)?\b/.test(blob);
}

/** Prefer network FAQs over duplicated programming FAQ clones on close scores. */
function categoryRank(category: string, queryHasQortalCue: boolean): number {
  if (queryHasQortalCue && category === 'qortal') return 3;
  if (category === 'qortal') return 2;
  if (category === 'survival' || category === 'health') return 1;
  if (category === 'programming') return -1;
  return 0;
}

/** Best golden match, or null if below threshold. */
export function matchGoldenAnswer(
  query: string,
  options?: { minScore?: number }
): GoldenMatch | null {
  const minScore = options?.minScore ?? 0.62;
  // If a retrieval helper folded a prior turn in, score the latest ask first.
  const followUp = query.match(/\nFollow-up:\s*(.+)\s*$/i);
  const primary = (followUp?.[1] || query).trim();
  const qNorm = normalize(primary);
  if (!qNorm || qNorm.length < 4) return null;
  const qTokens = tokens(primary);
  const herbMint = looksLikeHerbMint(primary);
  const priceAsk = isQortPriceQuery(primary);
  const qortalCue =
    /\b(qortal|qort|qdn|q-?app|q-?chat|q-?tube|hub|minter)\b/.test(qNorm) ||
    /\b(trade\s+portal|seed\s*phrase|seedphrase|minting|nomination)\b/.test(
      qNorm
    );
  let best: GoldenMatch | null = null;

  for (const entry of ENTRIES) {
    if (herbMint && isQortalMintingFaq(entry)) continue;
    // Market-price asks must not hit philosophy "QORT priceless" metaphors.
    if (
      priceAsk &&
      entry.category === 'philosophy' &&
      /\bpriceless\b|\bworthless\b/i.test(`${entry.q} ${entry.a}`)
    ) {
      continue;
    }
    const candidates = [entry.q, ...(entry.aliases || [])];
    let local = 0;
    for (const cand of candidates) {
      const byPhrase = phraseBonus(qNorm, cand);
      const byTok = jaccard(qTokens, tokens(cand));
      const score = Math.max(byPhrase, byTok * 0.85 + byPhrase * 0.15);
      // Priority 1 gets a tiny boost so critical FAQs win ties.
      const boosted = score + (entry.priority === 1 ? 0.03 : 0);
      if (boosted > local) local = boosted;
    }
    if (!best || local > best.score + 0.02) {
      best = { entry, score: local };
    } else if (best && Math.abs(local - best.score) <= 0.02) {
      const rankNew = categoryRank(entry.category, qortalCue);
      const rankBest = categoryRank(best.entry.category, qortalCue);
      if (rankNew > rankBest || (rankNew === rankBest && local > best.score)) {
        best = { entry, score: local };
      }
    }
  }

  if (!best || best.score < minScore) return null;
  return best;
}

export function goldenEntryCount(): number {
  return ENTRIES.length;
}
