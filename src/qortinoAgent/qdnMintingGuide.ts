/**
 * QDN enrichment for minting / nomination how-tos — curated guides with avatars,
 * not random VIDEO search hits or generic "mint" dictionary answers.
 */
import {
  fetchQAppPublisher,
  matchQAppCatalog,
  Q_APP_CATALOG,
  type MatchedQApp,
} from './qAppCatalog';
import type { OfficialResourceLink } from './officialResources';
import { OFFICIAL_QDN_GUIDES } from './officialResources';

/** Herb / cooking "mint" — not Qortal minting. */
function looksLikeHerbMint(query: string): boolean {
  const t = query.trim().toLowerCase();
  return (
    /\b(grow|plant|harvest|dry|tea|leaves?|herb|mojito|spearmint|peppermint)\b/.test(
      t
    ) && /\bmint\b/.test(t)
  );
}

/**
 * Any how-to / explain question about Qortal minting, becoming a minter,
 * nominations, or sponsorship — used in QDN + offline to keep Qortal context.
 */
export function isMintingHowToQuery(query: string): boolean {
  const t = query.trim().toLowerCase();
  if (!t || looksLikeHerbMint(t)) return false;

  if (
    /\b(how\s+(do\s+i|to)\s+become\s+a\s+minter)\b/.test(t) ||
    /\bbecome\s+a\s+minter\b/.test(t) ||
    /\b(get|earn)\s+minting\s+rights\b/.test(t) ||
    /\bstart\s+minting\b/.test(t) ||
    /\bhow\s+does\s+(q-?)?mintership\b/.test(t) ||
    (/\bmintership\b/.test(t) && /\b(how|what|guide|become|join)\b/.test(t))
  ) {
    return true;
  }

  // "how to mint", "how do I mint", "what is minting", "explain minting"
  if (
    /\bhow\s+(do\s+i|to|can\s+i)\s+mint\b/.test(t) ||
    /\bcan\s+i\s+mint\b/.test(t) ||
    /\bwhat\s+is\s+mint(ing)?\b/.test(t) ||
    /\bexplain\s+mint(ing)?\b/.test(t) ||
    /\bmint(ing)?\s+(on\s+)?qortal\b/.test(t) ||
    (/\bmint(ing)?\b/.test(t) &&
      /\b(how|what|start|begin|guide|explain|work|earn|qort|without|need|want|wanna|ready|interested|help)\b/.test(
        t
      ))
  ) {
    return true;
  }

  // Nominations / sponsorship (Qortal-specific)
  if (
    /\b(nominat(e|ion|ing)|sponsorship|sponsor\s+key)\b/.test(t) &&
    /\b(how|what|start|guide|explain|work|become|join|can|without|need)\b/.test(
      t
    )
  ) {
    return true;
  }

  return false;
}

/** True when the user is asking what nomination/sponsorship is (not Q-Mintership app). */
export function isNominationExplainQuery(query: string): boolean {
  const t = query.trim().toLowerCase();
  if (!t) return false;
  if (/\b(q-?)?mintership\b/.test(t) && !/\bnominat|sponsor/.test(t)) {
    return false;
  }
  return (
    /\b(nominat(e|ion|ing)|sponsorship|sponsor\s+key)\b/.test(t) &&
    /\b(how|what|start|guide|explain|work|become|join|system|mean|means)\b/.test(t)
  );
}

/** Canonical golden FAQ prompt when the user's phrasing is short ("how to mint"). */
export function mintingGoldenSeedQuery(query: string): string {
  const t = query.trim().toLowerCase();
  if (/\bnominat|sponsor/.test(t)) {
    return 'How does the new nomination system work?';
  }
  if (
    /\bbecome\s+a\s+minter\b/.test(t) ||
    /\bminting\s+rights\b/.test(t) ||
    /\bhow\s+(do\s+i|to|can\s+i)\s+mint\b/.test(t) ||
    /\bstart\s+minting\b/.test(t) ||
    // Desire phrasing: "I want to mint(, how)" / "wanna mint" / "help me mint".
    /\b(want|wanna|would\s+like|plan(?:ning)?|ready|help\s+me|trying|try)\s+(?:to\s+)?(?:start\s+)?mint(?:ing)?\b/.test(
      t
    ) ||
    // Process ask: mint + how anywhere — unless clearly a definition question.
    (/\bmint(?:ing|er)?\b/.test(t) &&
      /\bhow\b/.test(t) &&
      !/\bwhat\s+is\b/.test(t))
  ) {
    return 'How do I become a minter?';
  }
  return 'What is minting on Qortal?';
}

const MINT_GUIDE_BLURB = `
## Where to continue on QDN

**Q-Minter Guide** (\`WEBSITE/Q-Minter\`) — full written walkthrough (levels, uptime, nomination concepts, node setup).

**Q-Mintership** (\`APP/Q-Mintership\`) — live nomination board where Level 5+ minters publish cards and Minter Admins vote.

**Welcome to Qortal** — first steps before chasing minting.

Typical path: register a name → run a synced full node → build a visible track record → get nominated in Q-Mintership at Level 5+ → accept JOIN_GROUP → add a minting account in Q-Node and stay online.
`.trim();

const NOMINATION_GUIDE_BLURB = `
## On QDN

Open **Q-Mintership** for the live nomination board, and **Q-Minter Guide** for the longer written reference. Welcome to Qortal covers first steps if you are new.
`.trim();

export function mintingGuideAddonMarkdown(
  kind: 'mint' | 'nomination' = 'mint'
): string {
  return kind === 'nomination' ? NOMINATION_GUIDE_BLURB : MINT_GUIDE_BLURB;
}

export async function fetchMintingGuideApps(): Promise<MatchedQApp[]> {
  const ids = ['q-minter-guide', 'q-mintership', 'welcome'] as const;
  const out: MatchedQApp[] = [];
  for (const id of ids) {
    const entry = Q_APP_CATALOG.find((e) => e.id === id);
    if (!entry) continue;
    const publisher = await fetchQAppPublisher(entry.name).catch(() => null);
    out.push({
      entry,
      score: 1,
      publisher,
    });
  }
  // Fallback via matcher if catalog ids drift
  if (!out.length) {
    const hit = matchQAppCatalog('Q-Mintership');
    if (hit) out.push(hit);
  }
  return out;
}

export function mintingOfficialLinks(): OfficialResourceLink[] {
  return OFFICIAL_QDN_GUIDES.filter((l) =>
    ['welcome', 'q-minter-guide', 'q-mintership'].includes(l.id)
  );
}
