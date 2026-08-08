#!/usr/bin/env node
/**
 * High-impact Qortino answer audit (no LLM).
 * Scores golden FAQ + app-catalog + QDN-nudge behaviour for paraphrases
 * users actually type.
 *
 * Usage: node tools/qortino-knowledge/audit-answers.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load bundled goldenAnswers (post-import)
const goldenPath = path.resolve(
  __dirname,
  '../../src/qortinoAgent/goldenAnswers.json'
);
const { entries: ENTRIES } = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));

const STOP = new Set(
  'a an the is are was were be to of in on for and or how do does did can could would should i me my you your we our please tell about with from what which when where who why'.split(
    ' '
  )
);

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokens(text) {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t));
}
function jaccard(a, b) {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}
function phraseBonus(query, candidate) {
  const q = normalize(query);
  const c = normalize(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (q.includes(c) || c.includes(q)) return 0.55;
  if (q.length >= 12 && c.includes(q.slice(0, Math.min(24, q.length))))
    return 0.25;
  return 0;
}

function categoryRank(category, queryHasQortalCue) {
  if (queryHasQortalCue && category === 'qortal') return 3;
  if (category === 'qortal') return 2;
  if (category === 'survival' || category === 'health') return 1;
  if (category === 'programming') return -1;
  return 0;
}

function rankGolden(query, topN = 3) {
  const qNorm = normalize(query);
  const qTokens = tokens(query);
  const qortalCue =
    /\b(qortal|qort|qdn|q-?app|q-?chat|q-?tube|hub|minter)\b/.test(qNorm) ||
    /\b(trade\s+portal|seed\s*phrase|seedphrase|minting|nomination)\b/.test(
      qNorm
    );
  const scored = [];
  for (const entry of ENTRIES) {
    const candidates = [entry.q, ...(entry.aliases || [])];
    let local = 0;
    for (const cand of candidates) {
      const byPhrase = phraseBonus(qNorm, cand);
      const byTok = jaccard(qTokens, tokens(cand));
      const score = Math.max(byPhrase, byTok * 0.85 + byPhrase * 0.15);
      const boosted = score + (entry.priority === 1 ? 0.03 : 0);
      if (boosted > local) local = boosted;
    }
    scored.push({ entry, score: local });
  }
  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.02) return b.score - a.score;
    return (
      categoryRank(b.entry.category, qortalCue) -
      categoryRank(a.entry.category, qortalCue)
    );
  });
  return scored.slice(0, topN);
}

/** High-impact paraphrase probes: expected category / id substring / must-not */
const PROBES = [
  // Network / onboarding (highest traffic)
  { q: 'explain qortal simply', wantCat: 'qortal', wantId: /^qortal-001/, mustNot: /\bgame\b/i },
  { q: 'why should I use qortal', wantCat: 'qortal' },
  { q: 'is qortal decentralized', wantCat: 'qortal' },
  { q: 'how do I get started with qortal', wantCat: 'qortal', wantId: /^qortal-059/ },
  { q: 'what do I need to use qortal', wantCat: 'qortal' },
  { q: 'how do I create a wallet', wantCat: 'qortal' },
  { q: 'how do I backup my seed phrase', wantCat: 'qortal' },
  { q: 'what is a node', wantCat: 'qortal' },
  { q: 'do I need to run a node', wantCat: 'qortal' },
  { q: 'how do I sync my node', wantCat: 'qortal' },
  { q: 'what is level on qortal', wantCat: 'qortal' },
  { q: 'how do levels work', wantCat: 'qortal' },
  { q: 'how long to reach level 5', wantCat: 'qortal' },
  { q: 'what is proof of contribution', wantCat: 'qortal', wantId: /^qortal-005/ },
  { q: 'can I mint without a nomination', wantCat: 'qortal' },
  { q: 'how much qort do I need to start', wantCat: 'qortal' },
  { q: 'how do I get my first qort', wantCat: 'qortal' },
  { q: 'is qortal free', wantCat: 'qortal' },
  { q: 'who created qortal', wantCat: 'qortal' },
  { q: 'who founded qortal', wantCat: 'qortal' },
  { q: 'what is the difference between hub and go', wantCat: 'qortal' },
  { q: 'what is qortal go', wantCat: 'qortal' },
  { q: 'how do I publish a website', wantCat: 'qortal' },
  { q: 'how do I make a q-app', wantCat: 'qortal' },
  { q: 'what is an avatar on qortal', wantCat: 'qortal' },
  { q: 'how do groups work', wantCat: 'qortal' },
  { q: 'what is private messaging on qortal', wantCat: 'qortal' },

  // Dangerous confusions
  { q: 'who is simon james', wantCat: /philosophy|qortal/, mustNot: /dishwasher|water filter/i },
  { q: 'what is playing qortal', wantCat: 'philosophy', mustNot: /^Qortal is a fully decentralized blockchain/ },
  { q: 'is qortal a crypto scam', wantCat: 'qortal' },
  { q: 'can I buy qort on binance', wantCat: 'qortal' },

  // Survival / health (life-critical)
  { q: 'how do I make water safe to drink', wantCat: 'survival' },
  { q: 'can I drink rainwater', wantCat: 'survival' },
  { q: 'how do I filter river water', wantCat: 'survival' },
  { q: 'what if I have no fire to boil water', wantCat: 'survival' },
  { q: 'how do I start a fire without matches', wantCat: 'survival' },
  { q: 'how do I build a shelter outside', wantCat: 'survival' },
  { q: 'someone is not breathing what do I do', wantCat: /survival|health/ },
  { q: 'how do I do cpr', wantCat: /survival|health/ },
  { q: 'how do I treat a broken bone', wantCat: /survival|health/ },
  { q: 'snake bite what to do', wantCat: /survival|health/ },
  { q: 'how do I treat heat stroke', wantCat: /survival|health/ },
  { q: 'how do I treat frostbite', wantCat: /survival|health/ },
  { q: 'what foods store the longest', wantCat: /survival|gardening|life-skills/ },
  { q: 'how do I purify air in a smoke emergency', wantCat: /survival|health|earth-changes/ },

  // Health
  { q: 'how much water should I drink a day', wantCat: 'health' },
  { q: 'how do I lower blood pressure naturally', wantCat: 'health' },
  { q: 'what helps with sleep', wantCat: 'health' },
  { q: 'how do I stop a panic attack', wantCat: /health|philosophy/ },
  { q: 'is intermittent fasting safe', wantCat: 'health' },

  // Near-miss / soft-talk that should NOT steal FAQs
  { q: 'what is love', wantCat: /philosophy|life-skills/, forbidId: /^qortal-/ },
  { q: 'how do I grow mint', forbidId: /^qortal-00[5-8]/ }, // not minting

  // Deep pass — common paraphrases / traps
  { q: 'how do I register a name on qortal', wantCat: 'qortal' },
  { q: 'how do I send qort to someone', wantCat: 'qortal' },
  { q: 'how do I join a group on qortal', wantCat: 'qortal' },
  { q: 'what is qdn', wantCat: 'qortal' },
  { q: 'what is a reward share', wantCat: 'qortal' },
  { q: 'how do I get nominated for minting', wantCat: 'qortal' },
  { q: 'can I use qortal without a computer', wantCat: 'qortal' },
  { q: 'is my seed phrase public', wantCat: 'qortal' },
  { q: 'how do I recover my wallet', wantCat: 'qortal' },
  { q: 'what is trade portal', wantCat: 'qortal' },
  { q: 'how do I stay cool in a heatwave', wantCat: /survival|health|earth-changes/ },
  { q: 'how do I purify water with bleach', wantCat: 'survival' },
  { q: 'what should I pack in a go bag', wantCat: /survival|life-skills/ },
  { q: 'how do I stop a nosebleed', wantCat: /survival|health/ },
  { q: 'how do I treat a burn', wantCat: /survival|health/ },
  { q: 'signs of a heart attack', wantCat: /survival|health/ },
  { q: 'how do I grow tomatoes', wantCat: 'gardening', forbidId: /^qortal-/ },
  { q: 'how do I save seeds', wantCat: 'gardening' },
  { q: 'what is composting', wantCat: 'gardening' },
  { q: 'how do I meditate', wantCat: /philosophy|health|life-skills/ },
];

const FAST = 0.58;
const MAX = 0.64;

const missFast = [];
const missMax = [];
const wrongCat = [];
const badContent = [];
const nearMiss = []; // has a decent #2 that might be better

for (const p of PROBES) {
  const top = rankGolden(p.q, 3);
  const best = top[0];
  const hitFast = best && best.score >= FAST;
  const hitMax = best && best.score >= MAX;

  if (!hitFast) {
    missFast.push({
      q: p.q,
      best: best
        ? { id: best.entry.id, cat: best.entry.category, score: +best.score.toFixed(3), q: best.entry.q }
        : null,
      top2: top[1]
        ? { id: top[1].entry.id, score: +top[1].score.toFixed(3) }
        : null,
    });
  } else if (!hitMax) {
    missMax.push({
      q: p.q,
      id: best.entry.id,
      score: +best.score.toFixed(3),
      note: 'works in Fast, fails Max threshold 0.64',
    });
  }

  if (hitFast && p.wantCat) {
    const catOk =
      typeof p.wantCat === 'string'
        ? best.entry.category === p.wantCat
        : p.wantCat.test(best.entry.category);
    if (!catOk) {
      wrongCat.push({
        q: p.q,
        got: `${best.entry.category}/${best.entry.id}`,
        score: +best.score.toFixed(3),
        wantCat: String(p.wantCat),
        a: best.entry.a.slice(0, 100),
      });
    }
  }

  if (hitFast && p.wantId && !p.wantId.test(best.entry.id)) {
    wrongCat.push({
      q: p.q,
      got: best.entry.id,
      score: +best.score.toFixed(3),
      wantId: String(p.wantId),
      a: best.entry.a.slice(0, 100),
    });
  }

  if (hitFast && p.forbidId && p.forbidId.test(best.entry.id)) {
    badContent.push({
      q: p.q,
      problem: `hit forbidden id ${best.entry.id}`,
      a: best.entry.a.slice(0, 120),
    });
  }

  if (hitFast && p.mustNot && p.mustNot.test(best.entry.a)) {
    badContent.push({
      q: p.q,
      problem: `answer matches mustNot ${p.mustNot}`,
      id: best.entry.id,
      a: best.entry.a.slice(0, 120),
    });
  }

  // Close runners: #2 within 0.08 of #1 and different category
  if (
    top[0] &&
    top[1] &&
    top[0].score - top[1].score < 0.08 &&
    top[0].entry.category !== top[1].entry.category &&
    top[0].score >= 0.5
  ) {
    nearMiss.push({
      q: p.q,
      a: { id: top[0].entry.id, cat: top[0].entry.category, score: +top[0].score.toFixed(3) },
      b: { id: top[1].entry.id, cat: top[1].entry.category, score: +top[1].score.toFixed(3) },
    });
  }
}

// Cross-check: duplicate aliases that point to different answers
const aliasMap = new Map();
const dupAliases = [];
for (const e of ENTRIES) {
  for (const a of [e.q, ...(e.aliases || [])]) {
    const key = normalize(a);
    if (!key) continue;
    if (aliasMap.has(key) && aliasMap.get(key).id !== e.id) {
      dupAliases.push({
        alias: key,
        a: aliasMap.get(key).id,
        b: e.id,
      });
    } else {
      aliasMap.set(key, e);
    }
  }
}

const report = {
  summary: {
    probes: PROBES.length,
    missFast: missFast.length,
    missMaxOnly: missMax.length,
    wrongCatOrId: wrongCat.length,
    badContent: badContent.length,
    ambiguousNearMiss: nearMiss.length,
    duplicateAliases: dupAliases.length,
  },
  missFast,
  missMax,
  wrongCat,
  badContent,
  nearMiss: nearMiss.slice(0, 25),
  duplicateAliases: dupAliases.slice(0, 30),
};

console.log(JSON.stringify(report, null, 2));
