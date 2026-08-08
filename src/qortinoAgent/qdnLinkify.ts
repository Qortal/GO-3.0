/**
 * Turn QDN app / site names in prose into markdown links that open in-app.
 */
import { Q_APP_CATALOG } from './qAppCatalog';

const EXTRA_LINKS: Array<{ label: string; href: string }> = [
  // Avoid bare "QDN" — it linkifies section headings like "### QDN activity".
  { label: 'Q-Minter Guide', href: 'qortal://WEBSITE/Q-Minter' },
  { label: 'Q-Minter', href: 'qortal://WEBSITE/Q-Minter' },
  { label: 'Q-Mintership', href: 'qortal://APP/Q-Mintership' },
  { label: 'Welcome to Qortal', href: 'qortal://APP/Welcome to Qortal' },
];

function catalogLinks(): Array<{ label: string; href: string }> {
  const out: Array<{ label: string; href: string }> = [...EXTRA_LINKS];
  for (const entry of Q_APP_CATALOG) {
    out.push({
      label: entry.title || entry.name,
      href: `qortal://${entry.service}/${entry.name}`,
    });
    if (entry.name !== entry.title) {
      out.push({
        label: entry.name,
        href: `qortal://${entry.service}/${entry.name}`,
      });
    }
    for (const alias of entry.aliases || []) {
      out.push({
        label: alias,
        href: `qortal://${entry.service}/${entry.name}`,
      });
    }
  }
  // Longer labels first so "Q-Minter Guide" wins over "Q-Minter".
  out.sort((a, b) => b.label.length - a.label.length);
  return out;
}

let cached: Array<{ label: string; href: string; re: RegExp }> | null = null;

function patterns() {
  if (cached) return cached;
  cached = catalogLinks().map((l) => {
    const escaped = l.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Short generic words (e.g. "Names") must match catalog casing — avoid
    // turning "registered names" into a link.
    const flags = l.label.length <= 5 ? 'g' : 'gi';
    return {
      ...l,
      re: new RegExp(
        `(^|[^\\w/\`\\[])(${escaped})(?![\\w\\]]|\\]\\()`,
        flags
      ),
    };
  });
  return cached;
}

/** Wrap known Q-App / guide names in markdown links (skip already-linked text). */
export function linkifyQdnReferences(text: string): string {
  if (!text.trim()) return text;
  // Split on existing markdown links / code so we don't nest.
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`)/g);
  return parts
    .map((part) => {
      if (!part) return part;
      if (part.startsWith('[') || part.startsWith('`')) return part;
      let out = part;
      for (const p of patterns()) {
        out = out.replace(p.re, `$1[$2](${p.href})`);
      }
      return out;
    })
    .join('');
}
