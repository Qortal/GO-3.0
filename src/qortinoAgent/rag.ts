import {
  isPlayingQortalKnowledgeUnit,
  wantsPlayingQortalMaterial,
} from './persona';

type KnowledgeChunk = {
  id: string;
  text: string;
  source: string;
  title?: string;
  embedding?: number[];
};

export type KnowledgePack = {
  version: string;
  embeddingDim?: number;
  embeddingMethod?: 'minilm' | 'hash' | string;
  chunks: KnowledgeChunk[];
};

type RetrievedChunk = KnowledgeChunk & { score: number };

const HASH_DIM = 384;

/** Deterministic feature-hash embedding shared by pack builder + on-device fallback. */
export function hashEmbed(text: string, dim = HASH_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (const token of normalized) {
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

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export async function retrieveKnowledge(
  pack: KnowledgePack | null | undefined,
  query: string,
  topK = 4
): Promise<RetrievedChunk[]> {
  if (!pack?.chunks?.length || !query.trim()) {
    return [];
  }

  const allowPlaying = wantsPlayingQortalMaterial(query);
  const vector = hashEmbed(query.trim());
  const scored = pack.chunks
    .filter((chunk) => allowPlaying || !isPlayingQortalKnowledgeUnit(chunk))
    .map((chunk) => {
      const cv = chunk.embedding?.length
        ? chunk.embedding
        : hashEmbed(chunk.text);
      let score = cosineSimilarity(
        vector,
        cv.length === vector.length ? cv : hashEmbed(chunk.text)
      );
      // Prefer curated FAQ units when scores are close — they carry full answers.
      if ((chunk.source || '').startsWith('faq/')) {
        score += 0.04;
      }
      // Prefer network Qortal FAQ over adjacent packs for "what can I do on Qortal".
      if ((chunk.source || '').includes('qortal-faq')) {
        score += 0.03;
      }
      return { ...chunk, score };
    });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((c) => c.score > 0.05).slice(0, topK);
}

export function parseKnowledgePackJson(raw: string): KnowledgePack {
  const parsed = JSON.parse(raw) as KnowledgePack;
  if (!parsed || !Array.isArray(parsed.chunks)) {
    throw new Error('Invalid knowledge pack JSON');
  }
  return parsed;
}
