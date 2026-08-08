/**
 * Compare two Qortal names side-by-side for Qortino QDN mode.
 */
import { fetchUserQdnDossier, type QdnDossier, type QdnProfileCard } from './qdnLookup';

export function extractCompareNames(query: string): [string, string] | null {
  const t = query.trim();
  if (!t) return null;

  const patterns = [
    /\bcompare\s+(.+?)\s+(?:vs\.?|versus|and|with|to)\s+(.+?)(?:\?|$)/i,
    /\b(.+?)\s+(?:vs\.?|versus)\s+(.+?)(?:\?|$)/i,
    /\bdifference\s+between\s+(.+?)\s+and\s+(.+?)(?:\?|$)/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[1] || !m?.[2]) continue;
    const a = tidy(m[1]);
    const b = tidy(m[2]);
    if (!a || !b || a.toLowerCase() === b.toLowerCase()) continue;
    if (a.length < 2 || b.length < 2) continue;
    return [a, b];
  }
  return null;
}

function tidy(raw: string): string {
  return raw
    .replace(/^(who\s+is|tell\s+me\s+about|the\s+user)\s+/i, '')
    .replace(/[?!.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectCompareIntent(query: string): boolean {
  return !!extractCompareNames(query);
}

export async function fetchNameCompare(
  nameA: string,
  nameB: string,
  options?: { viewerAddress?: string | null; signal?: AbortSignal }
): Promise<{
  dossiers: QdnDossier[];
  profiles: QdnProfileCard[];
  answer: string;
} | null> {
  const [da, db] = await Promise.all([
    fetchUserQdnDossier(nameA, options?.signal, {
      viewerAddress: options?.viewerAddress,
    }),
    fetchUserQdnDossier(nameB, options?.signal, {
      viewerAddress: options?.viewerAddress,
    }),
  ]);

  const dossiers = [da, db].filter((d): d is QdnDossier => !!d);
  if (dossiers.length < 2) return null;

  const [a, b] = dossiers;
  const profiles: QdnProfileCard[] = dossiers.map((d) => ({
    name: d.name,
    address: d.address,
    level: d.level,
    tags: d.tags,
    avatarUrl: d.avatarUrl,
  }));

  const tagLine = (d: QdnDossier) =>
    d.tags.length ? d.tags.join(', ') : 'no special role tags';

  const answer =
    `Side-by-side on QDN:\n\n` +
    `• ${a.name} — Level ${a.level}; ${tagLine(a)}. ${a.stats.blocksMinted.toLocaleString()} blocks minted.\n` +
    `• ${b.name} — Level ${b.level}; ${tagLine(b)}. ${b.stats.blocksMinted.toLocaleString()} blocks minted.\n\n` +
    (a.level === b.level
      ? `Same account level (${a.level}). `
      : `${a.level > b.level ? a.name : b.name} is higher level. `) +
    `Tap either blue name below for copy / search. Details from their public publishes are in the notes for a fuller summary.`;

  return { dossiers, profiles, answer };
}
