#!/usr/bin/env node
/**
 * Evaluate hash-RAG hit rate against golden questions (no LLM required).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Replicate hash embed + cosine from rag.ts (keep eval dependency-free).
const HASH_DIM = 384;
function hashEmbed(text, dim = HASH_DIM) {
  const vec = new Array(dim).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (const token of tokens) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dim;
    const sign = h & 1 ? 1 : -1;
    vec[idx] += sign;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}
function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

function loadGolden() {
  const dir = path.join(__dirname, 'golden');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const rows = [];
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      rows.push(JSON.parse(line));
    }
  }
  return rows;
}

function main() {
  // The app no longer bundles the chunk pack (Qortino answers from the model
  // plus the golden FAQ); evaluate the pack build-pack.mjs writes to dist/.
  const packPath = path.resolve(__dirname, 'dist/qortino-knowledge-v2.json');
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  const chunks = pack.chunks || [];
  const golden = loadGolden();
  if (!golden.length) {
    console.error('No golden JSONL found');
    process.exit(1);
  }

  let hits = 0;
  const misses = [];
  for (const g of golden) {
    const qv = hashEmbed(g.q);
    let best = { score: -1, source: '' };
    for (const c of chunks) {
      const cv = c.embedding?.length ? c.embedding : hashEmbed(c.text);
      const score = cosine(qv, cv);
      if (score > best.score) best = { score, source: c.source || '' };
    }
    const ok =
      best.source.includes('/faq/') ||
      best.source.includes(g.category) ||
      (g.category === 'life-skills' && best.source.includes('life-skills'));
    if (ok && best.score >= 0.12) hits += 1;
    else misses.push({ id: g.id, q: g.q, best: best.source, score: best.score });
  }

  console.log(
    JSON.stringify(
      {
        golden: golden.length,
        chunks: chunks.length,
        categoryHitRate: Number((hits / golden.length).toFixed(3)),
        missSample: misses.slice(0, 25),
      },
      null,
      2
    )
  );
}

main();
