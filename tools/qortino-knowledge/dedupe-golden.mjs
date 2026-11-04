#!/usr/bin/env node
/**
 * Find entries that answer the same question: asks every phrasing (q and
 * aliases) of every entry through the real matcher and lists pairs where
 * another entry scores as high or higher. Two such entries make the instant
 * answer a coin toss, so one should go or the two should be told apart.
 *
 *   node tools/qortino-knowledge/import-golden.mjs   # refresh goldenAnswers.json first
 *   node tools/qortino-knowledge/dedupe-golden.mjs [--min 0.9] [--json out.json]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const argAfter = (flag) =>
  process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined;
const MIN = Number(argAfter('--min')) || 0.9;
const OUT = argAfter('--json');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qortino-dedupe-'));
await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/qortinoAgent/goldenMatch.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: path.join(tmp, 'match.mjs'),
  logLevel: 'error',
});
const { rankGoldenAnswers } = await import(pathToFileURL(path.join(tmp, 'match.mjs')).href);
fs.rmSync(tmp, { recursive: true, force: true });

const golden = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src/qortinoAgent/goldenAnswers.json'), 'utf8')
);
const byId = new Map(golden.entries.map((e) => [e.id, e]));
const pairs = new Map();
for (const e of golden.entries) {
  for (const phrasing of [e.q, ...(e.aliases || [])]) {
    const ranked = rankGoldenAnswers(phrasing, 4);
    const own = ranked.find((m) => m.entry.id === e.id)?.score ?? 0;
    for (const m of ranked) {
      if (m.entry.id === e.id || m.score < MIN || m.score < own - 0.02) continue;
      const key = [e.id, m.entry.id].sort().join(' | ');
      const prev = pairs.get(key);
      if (!prev || m.score > prev.score) pairs.set(key, { a: e.id, b: m.entry.id, phrasing, score: m.score });
    }
  }
}

const rows = [...pairs.values()].sort((x, y) => y.score - x.score);
for (const p of rows) {
  const a = byId.get(p.a);
  const b = byId.get(p.b);
  console.log(`${p.score.toFixed(2)}  "${p.phrasing}"\n      ${p.a}: ${a.q}\n      ${p.b}: ${b.q}`);
}
console.log(`\n${rows.length} pair(s) at ≥ ${MIN} among ${golden.entries.length} entries`);
if (OUT) {
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      rows.map((p) => ({ ...p, aQ: byId.get(p.a).q, bQ: byId.get(p.b).q, aA: byId.get(p.a).a, bA: byId.get(p.b).a })),
      null,
      1
    )
  );
  console.log(`wrote ${OUT}`);
}
