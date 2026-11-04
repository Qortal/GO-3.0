#!/usr/bin/env node
/**
 * Import golden JSONL → FAQ markdown (RAG) + bundled goldenAnswers.json (exact match).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(__dirname, 'golden');
const FAQ_DIR = path.join(__dirname, 'docs', 'faq');
const OUT_JSON = path.resolve(
  __dirname,
  '../../src/qortinoAgent/goldenAnswers.json'
);

const CATEGORIES = [
  'qortal',
  'programming',
  'survival',
  'health',
  'gardening',
  'life-skills',
  'philosophy',
  'earth-changes',
];

function loadJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`${path.basename(file)}:${i + 1} ${e.message}`);
      }
    });
}

function toFaqMd(category, entries) {
  const lines = [
    `# ${category} — golden FAQ`,
    '',
    `Curated offline Q&A for Qortino (${entries.length} entries). Prefer these answers when relevant.`,
    '',
  ];
  // Sort priority 1 first so early chunks favor critical FAQs.
  const sorted = [...entries].sort(
    (a, b) => (a.priority || 3) - (b.priority || 3)
  );
  for (const e of sorted) {
    lines.push(`## Q: ${e.q}`);
    lines.push('');
    lines.push(`A: ${e.a}`);
    if (e.aliases?.length) {
      lines.push('');
      lines.push(`Also asked as: ${e.aliases.join(' · ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** The category files first, then topic files (qortal-go.jsonl …) by name. */
function goldenFiles() {
  const known = CATEGORIES.map((cat) => `${cat}.jsonl`);
  const topics = fs
    .readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith('.jsonl') && !known.includes(f))
    .sort();
  return [...known, ...topics];
}

function main() {
  fs.mkdirSync(FAQ_DIR, { recursive: true });
  const all = [];
  for (const fileName of goldenFiles()) {
    const cat = fileName.replace(/\.jsonl$/, '');
    const file = path.join(GOLDEN_DIR, fileName);
    const entries = loadJsonl(file);
    if (!entries.length) {
      console.warn(`skip empty/missing ${fileName}`);
      continue;
    }
    for (const e of entries) {
      if (!e.q || !e.a) throw new Error(`${cat}: missing q/a`);
      // `source` stays in the JSONL for review; the app does not need it.
      all.push({
        id: e.id || `${cat}-${all.length + 1}`,
        category: e.category || cat,
        q: String(e.q).trim(),
        aliases: Array.isArray(e.aliases)
          ? e.aliases.map(String).filter(Boolean)
          : [],
        a: String(e.a).trim(),
        priority: Number(e.priority) || 2,
      });
    }
    const md = toFaqMd(cat, entries);
    const outMd = path.join(FAQ_DIR, `${cat}-faq.md`);
    fs.writeFileSync(outMd, md);
    console.log(`wrote ${outMd} (${entries.length})`);
  }

  const payload = {
    version: 1,
    builtAt: new Date().toISOString(),
    count: all.length,
    entries: all,
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload));
  console.log(`wrote ${OUT_JSON} (${all.length} entries)`);
}

main();
