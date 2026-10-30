#!/usr/bin/env node
/**
 * Offline knowledge pack builder for Qortino.
 *
 * Usage:
 *   node tools/qortino-knowledge/build-pack.mjs
 *   node tools/qortino-knowledge/build-pack.mjs --docs ./my-docs --out ./dist/qortino-knowledge-v1.json --version v1
 *   node tools/qortino-knowledge/build-pack.mjs --no-embeddings --out src/qortinoAgent/bundledKnowledge.json --version v2
 *
 * --no-embeddings is for the bundled in-app copy only: the app fills each
 * vector with hashEmbed(text) when it loads that pack.
 *
 * Output JSON is suitable for QDN publish as FILE identifier qortino_knowledge_vN.
 * Chunks include hash embeddings so the phone can RAG without MiniLM.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HASH_DIM = 384;
const TARGET_CHARS = 1800;
const OVERLAP_CHARS = 240;

function parseArgs(argv) {
  const out = {
    docs: path.join(__dirname, 'docs'),
    out: path.join(__dirname, 'dist', 'qortino-knowledge-v1.json'),
    version: 'v1',
    noEmbeddings: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--docs') out.docs = path.resolve(argv[++i]);
    else if (a === '--out') out.out = path.resolve(argv[++i]);
    else if (a === '--version') out.version = argv[++i];
    else if (a === '--no-embeddings') out.noEmbeddings = true;
  }
  return out;
}

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

function walkMarkdown(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMarkdown(full));
    } else if (/\.(md|txt)$/i.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function pushChunk(chunks, source, title, body, index) {
  const text = body.trim();
  if (!text) return index;
  const id = createHash('sha1')
    .update(`${source}:${index}:${text}`)
    .digest('hex')
    .slice(0, 12);
  chunks.push({
    id,
    source: source.replace(/\\/g, '/'),
    title,
    text,
    embedding: hashEmbed(text),
  });
  return index + 1;
}

/** FAQ files: one retrieval unit per `## Q:` so answers stay intact. */
function chunkFaqText(text, source) {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];
  const titleMatch = cleaned.match(/^#\s+(.+)$/m);
  const docTitle = titleMatch?.[1]?.trim() || path.basename(source);
  const parts = cleaned.split(/\n(?=##\s+Q:\s+)/);
  const chunks = [];
  let index = 0;
  for (const part of parts) {
    const body = part.trim();
    if (!body || body.startsWith('# ') && !body.includes('\n## Q:')) {
      // intro blurb — keep short as its own chunk only if useful
      if (body.length > 80 && !/^#\s/.test(body.split('\n')[0] || '')) {
        index = pushChunk(chunks, source, docTitle, body, index);
      }
      continue;
    }
    const qMatch = body.match(/^##\s+Q:\s+(.+)$/m);
    const qTitle = qMatch?.[1]?.trim() || docTitle;
    index = pushChunk(chunks, source, qTitle, body, index);
  }
  return chunks;
}

function chunkText(text, source) {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];
  const rel = source.replace(/\\/g, '/');
  if (rel.includes('/faq/') || /-faq\.md$/i.test(rel)) {
    return chunkFaqText(cleaned, rel);
  }
  const titleMatch = cleaned.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() || path.basename(source);
  const chunks = [];
  let start = 0;
  let index = 0;
  while (start < cleaned.length) {
    let end = Math.min(cleaned.length, start + TARGET_CHARS);
    if (end < cleaned.length) {
      const slice = cleaned.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '));
      if (lastBreak > TARGET_CHARS * 0.4) {
        end = start + lastBreak + 1;
      }
    }
    const body = cleaned.slice(start, end).trim();
    if (body) {
      index = pushChunk(chunks, rel, title, body, index);
    }
    if (end >= cleaned.length) break;
    start = Math.max(end - OVERLAP_CHARS, start + 1);
  }
  return chunks;
}

function main() {
  const args = parseArgs(process.argv);
  const files = walkMarkdown(args.docs);
  if (!files.length) {
    console.error(`No markdown/text docs found under ${args.docs}`);
    process.exit(1);
  }

  const chunks = [];
  for (const file of files) {
    const rel = path.relative(args.docs, file);
    const text = fs.readFileSync(file, 'utf8');
    chunks.push(...chunkText(text, rel));
  }
  if (args.noEmbeddings) for (const c of chunks) delete c.embedding;

  const pack = {
    version: args.version,
    embeddingMethod: 'hash',
    embeddingDim: HASH_DIM,
    builtAt: new Date().toISOString(),
    sourceCount: files.length,
    chunkCount: chunks.length,
    chunks,
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(pack));
  console.log(`Wrote ${chunks.length} chunks from ${files.length} docs → ${args.out}`);
  console.log(`Publish on QDN as FILE / ${'Qortino'} / qortino_knowledge_${args.version}`);
}

main();
