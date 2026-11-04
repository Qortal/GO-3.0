#!/usr/bin/env node
/**
 * Check golden JSONL files against golden/WRITING.md: shape, lengths, unique
 * ids across every golden file, duplicate questions, and banned content.
 *
 *   node tools/qortino-knowledge/validate-golden.mjs [file.jsonl ...]
 *
 * With no arguments every golden/*.jsonl is checked. Exit code 1 on errors.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(__dirname, 'golden');

const BANNED = [
  [/https?:\/\/|\bwww\./i, 'web link'],
  [/\bQDN (mode|chat window)\b|\bswitch to (the )?QDN\b/i, 'removed QDN mode'],
  [/\b(Fast|Max) mode\b/, 'removed Fast/Max modes'],
  [/\bas an AI\b|\blanguage model\b/i, 'AI disclaimer'],
  [/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'emoji'],
];

/** "+" versions of the official apps: pre-release, not to be recommended. */
const PRE_RELEASE =
  /\b(Q-Mail|Q-Share|Q-Tube|Q-Node|Q-Trade|Names|Q-Mintership|Q-Shop|Q-Fund|Q-Support|Q-Apps)\+/;

/** Words that say nothing about the topic on their own. */
const GENERIC = new Set(
  'a an the is are was be to of in on for and or how do does did can could would should i me my you your it its this that these what which when where who why whats explain tell about with from work works working use using help please thing stuff mean means info'.split(
    ' '
  )
);

const normQ = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function loadRows(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter((r) => r.line);
}

const args = process.argv.slice(2);
const allFiles = fs
  .readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith('.jsonl'))
  .map((f) => path.join(GOLDEN_DIR, f));
const targets = args.length ? args.map((f) => path.resolve(f)) : allFiles;
const isNewStyle = (file) =>
  !/^(qortal|programming|survival|health|gardening|life-skills|philosophy|earth-changes)\.jsonl$/.test(
    path.basename(file)
  );

// Ids and questions already used by other files.
const idOwner = new Map();
const qOwner = new Map();
for (const file of allFiles) {
  for (const { line, n } of loadRows(file)) {
    try {
      const e = JSON.parse(line);
      const where = `${path.basename(file)}:${n}`;
      if (e.id) {
        if (!idOwner.has(e.id)) idOwner.set(e.id, []);
        idOwner.get(e.id).push(where);
      }
      if (e.q) {
        const k = normQ(e.q);
        if (!qOwner.has(k)) qOwner.set(k, []);
        qOwner.get(k).push(where);
      }
    } catch {
      // Reported below for target files.
    }
  }
}

let errors = 0;
let warnings = 0;
let total = 0;
const err = (where, msg) => {
  errors += 1;
  console.log(`ERROR ${where}: ${msg}`);
};
const warn = (where, msg) => {
  warnings += 1;
  console.log(`warn  ${where}: ${msg}`);
};

for (const file of targets) {
  const strict = isNewStyle(file);
  for (const { line, n } of loadRows(file)) {
    const where = `${path.basename(file)}:${n}`;
    let e;
    try {
      e = JSON.parse(line);
    } catch (x) {
      err(where, `bad JSON (${x.message})`);
      continue;
    }
    total += 1;
    if (!e.id || typeof e.id !== 'string') err(where, 'missing id');
    else if (idOwner.get(e.id)?.length > 1)
      err(where, `id ${e.id} also in ${idOwner.get(e.id).join(', ')}`);
    if (!e.category) err(where, 'missing category');
    if (typeof e.q !== 'string' || e.q.length < 8 || e.q.length > 200)
      err(where, 'q missing or not 8–200 chars');
    else {
      if (strict && !e.q.trim().endsWith('?')) warn(where, 'q should end with ?');
      const dup = qOwner.get(normQ(e.q));
      if (dup?.length > 1) err(where, `same question in ${dup.join(', ')}`);
    }
    if (!Array.isArray(e.aliases)) err(where, 'aliases must be an array');
    else {
      if (strict && (e.aliases.length < 4 || e.aliases.length > 8))
        warn(where, `${e.aliases.length} aliases (want 4–8)`);
      const seen = new Set([normQ(e.q || '')]);
      for (const a of e.aliases) {
        if (typeof a !== 'string' || a.trim().length < 3) {
          err(where, `bad alias ${JSON.stringify(a)}`);
          continue;
        }
        const k = normQ(a);
        if (seen.has(k)) warn(where, `repeated alias "${a}"`);
        seen.add(k);
        if (k.split(' ').filter((w) => w.length >= 2 && !GENERIC.has(w)).length === 0)
          warn(where, `alias "${a}" has no distinguishing word`);
      }
    }
    if (typeof e.a !== 'string' || e.a.trim().length < 40)
      err(where, 'answer missing or under 40 chars');
    else {
      if (strict && e.a.length > 900) warn(where, `answer ${e.a.length} chars (max 900)`);
      for (const [re, label] of BANNED) {
        if (re.test(e.a)) err(where, `answer contains ${label}`);
      }
      if (/\bQuitter\b/.test(e.a) && !/\bTorq\b/.test(e.a))
        err(where, 'mentions Quitter without Torq');
      if (PRE_RELEASE.test(e.a) && !PRE_RELEASE.test(e.q))
        warn(where, 'answer brings up a pre-release + app the question did not ask about');
    }
    if (![1, 2, 3].includes(e.priority)) err(where, 'priority must be 1, 2 or 3');
    if (strict && !e.source) err(where, 'missing source');
  }
}

console.log(
  `\n${total} entries checked in ${targets.length} file(s): ${errors} error(s), ${warnings} warning(s)`
);
process.exit(errors ? 1 : 0);
