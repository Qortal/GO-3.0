#!/usr/bin/env node
/**
 * How well Qortino's FAQ matcher (src/qortinoAgent/goldenMatch.ts) finds the
 * right entry for a phrasing the set does not contain.
 *
 * Holds out the last alias of every entry that has four or more, builds the
 * real matcher without them, and asks each held-out phrasing. Also asks small
 * talk and general questions, which must not get an instant curated answer.
 *
 *   node tools/qortino-knowledge/import-golden.mjs   # refresh goldenAnswers.json first
 *   node tools/qortino-knowledge/eval-faq.mjs [--show 25] [--matcher other.ts] [--margin 0.05]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const INSTANT = 0.6; // GOLDEN_INSTANT_SCORE in QortinoAgentChat.tsx
const HINT = 0.45; // GOLDEN_HINT_SCORE
const argAfter = (flag) =>
  process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined;
const show = Number(argAfter('--show')) || 15;
// Treat an instant answer as a hint when another entry scores within this much.
const MARGIN = Number(argAfter('--margin')) || 0;
// Another matcher file to compare (it must import ./goldenAnswers.json too).
const MATCHER = path.resolve(argAfter('--matcher') || path.join(ROOT, 'src/qortinoAgent/goldenMatch.ts'));

/** Must never come back as an instant curated answer. */
const SMALL_TALK = [
  'hi',
  'hello there',
  'thanks a lot',
  'how are you today',
  'who are you',
  'tell me a joke',
  'what is the weather like today',
  'write me a poem about the sea',
  'what is 2 plus 2',
  'translate good morning into polish',
  'what is the capital of france',
  'what should I cook for dinner tonight',
  'I feel sad today',
  'can you help me with my homework',
  'what time is it',
  'recommend a good book',
  'how old is the universe',
  'what is love',
  'summarize this text for me',
  'make my message sound better',
];

const golden = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src/qortinoAgent/goldenAnswers.json'), 'utf8')
);
const heldOut = [];
const entries = golden.entries.map((e) => {
  if ((e.aliases || []).length < 4) return e;
  const aliases = [...e.aliases];
  heldOut.push({ q: aliases.pop(), id: e.id, category: e.category });
  return { ...e, aliases };
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qortino-faq-eval-'));
fs.writeFileSync(path.join(tmp, 'golden.json'), JSON.stringify({ entries }));
await esbuild.build({
  entryPoints: [MATCHER],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: path.join(tmp, 'match.mjs'),
  logLevel: 'error',
  plugins: [
    {
      name: 'held-out-golden',
      setup(build) {
        build.onResolve({ filter: /goldenAnswers\.json$/ }, () => ({
          path: path.join(tmp, 'golden.json'),
        }));
      },
    },
  ],
});
const { lookupGoldenAnswer, rankGoldenAnswers } = await import(
  pathToFileURL(path.join(tmp, 'match.mjs')).href
);

const groups = new Map();
const confusions = [];
const misses = [];
const t0 = performance.now();
for (const h of heldOut) {
  const ranked = rankGoldenAnswers(h.q, 3);
  const look = lookupGoldenAnswer(h.q);
  const m = look.instant ?? look.hints[0] ?? null;
  const instant = Boolean(look.instant);
  const key = h.category === 'qortal' ? `qortal (${h.id.replace(/-\d+$/, '')})` : h.category;
  for (const k of [key, h.category === 'qortal' ? 'ALL QORTAL' : 'ALL OTHER']) {
    if (!groups.has(k)) groups.set(k, { n: 0, top1: 0, top3: 0, instant: 0, instantRight: 0, hint: 0, hintRight: 0 });
    const g = groups.get(k);
    g.n += 1;
    if (ranked[0]?.entry.id === h.id) g.top1 += 1;
    if (ranked.some((r) => r.entry.id === h.id)) g.top3 += 1;
    if (instant) {
      g.instant += 1;
      if (m.entry.id === h.id) g.instantRight += 1;
    } else if (look.hints.length) {
      g.hint += 1;
      if (look.hints.some((x) => x.entry.id === h.id)) g.hintRight += 1;
    }
  }
  if (instant && m.entry.id !== h.id) confusions.push({ ...h, got: `${m.entry.id}: ${m.entry.q}`, score: m.score });
  if (!m) misses.push({ ...h, best: m?.entry.q, bestId: m?.entry.id, score: m?.score });
}
const ms = performance.now() - t0;

const pct = (a, n) => `${((100 * a) / Math.max(1, n)).toFixed(0)}%`.padStart(5);
console.log(`${heldOut.length} held-out phrasings, ${entries.length} entries, ${(ms / heldOut.length).toFixed(1)} ms per question on this PC${MARGIN ? `, margin ${MARGIN}` : ''}\n`);
console.log('group                     n   top1  top3 | instant  right-of-instant | hint  right-of-hint');
for (const [key, g] of [...groups].sort()) {
  console.log(
    `${key.padEnd(22)} ${String(g.n).padStart(4)} ${pct(g.top1, g.n)} ${pct(g.top3, g.n)} | ${pct(g.instant, g.n)}    ${pct(g.instantRight, g.instant)}         | ${pct(g.hint, g.n)}  ${pct(g.hintRight, g.hint)}`
  );
}

const talk = SMALL_TALK.map((q) => ({ q, m: lookupGoldenAnswer(q).instant })).filter((r) => r.m);
console.log(`\nsmall talk with an instant curated answer: ${talk.length} of ${SMALL_TALK.length}`);
for (const r of talk) console.log(`  "${r.q}" -> ${r.m.entry.id} (${r.m.score.toFixed(2)})`);

console.log(`\nwrong instant answers (first ${show}):`);
for (const c of confusions.slice(0, show)) {
  console.log(`  "${c.q}" [${c.id}] -> ${c.got} (${c.score.toFixed(2)})`);
}
console.log(`\nmisses (first ${show}):`);
for (const m of misses.slice(0, show)) {
  console.log(`  "${m.q}" [${m.id}] best${m.bestId === m.id ? ' (right)' : ''}: ${m.best ?? '-'} (${(m.score ?? 0).toFixed(2)})`);
}
fs.rmSync(tmp, { recursive: true, force: true });
