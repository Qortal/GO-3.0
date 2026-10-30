/**
 * MA Helper–inspired written portfolio / nomination prose for Qortino QDN mode.
 * Built in TypeScript so small on-device models can use it almost verbatim.
 */

export type QdnSummaryStats = {
  name: string;
  address: string;
  level: number;
  tags: string[];
  ownedNames: string[];
  ageDays: number | null;
  firstActivityTs?: number;
  lastActivityTs?: number;
  txsSampled: number;
  recent30: number;
  blocksMinted: number;
  balance: number;
  qdnResourceCount: number;
  appCounts: Array<{ app: string; count: number }>;
  publishTitles: string[];
  chatHints: string[];
  topTxTypes: string[];
};

export function detectNominationIntent(query: string): boolean {
  const q = query.toLowerCase();
  return (
    /\bnominat(e|ion|ing)\b/.test(q) ||
    /\bmintership\b/.test(q) ||
    /\breason\s+for\s+(minter|nomination)\b/.test(q) ||
    /\bwrite\s+(a\s+)?(nomination|minter\s+card|reason)\b/.test(q)
  );
}

/** Writing forms that must never be treated as Qortal account names. */
export const CREATIVE_FORM_WORDS = [
  'poem',
  'poems',
  'poetry',
  'song',
  'songs',
  'story',
  'stories',
  'ode',
  'odes',
  'rap',
  'haiku',
  'limerick',
  'ballad',
  'verse',
  'verses',
  'tribute',
  'tributes',
  'rhyme',
  'rhymes',
  'message',
  'messages',
  'msg',
  'email',
  'emails',
  'letter',
  'letters',
  'dm',
  'dms',
  'note',
  'notes',
  'reply',
  'replies',
  'post',
  'posts',
  'question',
  'questions',
  'request',
  'requests',
  'intro',
  'introduction',
  'speech',
  'bio',
  'biography',
  'summary',
  'summaries',
] as const;

type CreativeAboutPersonIntent = {
  form: string;
  /** Display label e.g. "poem" / "message" */
  formLabel: string;
  /** How the person is addressed in the ask */
  relation: 'about' | 'to' | 'for';
};

/**
 * Compose / write intents that need a person from QDN as background,
 * then fulfill the user's request (poem, message, letter, …).
 *
 * Examples:
 * - "write a poem about Crowetic"
 * - "write a message to Crowetic asking how to mint"
 * - "draft an email for Simon James"
 */
export function detectCreativeAboutPersonIntent(
  query: string
): CreativeAboutPersonIntent | null {
  const raw = query.trim();
  if (!raw) return null;
  // Nominations are a different product path.
  if (detectNominationIntent(raw)) return null;

  const forms = CREATIVE_FORM_WORDS.join('|');
  const verbs = 'write|draft|compose|make|create|generate|craft|pen';

  // "write a message to X" / "write a poem about X" / "draft an email for X"
  const withForm = raw.match(
    new RegExp(
      `(?:${verbs})\\s+(?:me\\s+)?(?:a\\s+|an\\s+|the\\s+)?(${forms})\\s+(about|to|for|on)\\s+`,
      'i'
    )
  );
  if (withForm?.[1]) {
    const form = withForm[1].toLowerCase();
    const relRaw = (withForm[2] || 'about').toLowerCase();
    const relation: CreativeAboutPersonIntent['relation'] =
      relRaw === 'to' ? 'to' : relRaw === 'for' ? 'for' : 'about';
    return {
      form,
      formLabel: form.replace(/s$/, '') || form,
      relation,
    };
  }

  // "poem about X" / "message to X" (form first)
  const formFirst = raw.match(
    new RegExp(`\\b(${forms})\\s+(about|to|for|on)\\s+`, 'i')
  );
  if (formFirst?.[1]) {
    const form = formFirst[1].toLowerCase();
    const relRaw = (formFirst[2] || 'about').toLowerCase();
    const relation: CreativeAboutPersonIntent['relation'] =
      relRaw === 'to' ? 'to' : relRaw === 'for' ? 'for' : 'about';
    return {
      form,
      formLabel: form.replace(/s$/, '') || form,
      relation,
    };
  }

  // "write to Crowetic asking…" / "write something to Crowetic…"
  if (
    new RegExp(`(?:${verbs})\\s+(?:to|for)\\s+[A-Za-z0-9]`, 'i').test(raw) ||
    new RegExp(
      `(?:${verbs})\\s+(?:me\\s+)?(?:a\\s+|an\\s+|the\\s+)?(?:short\\s+|quick\\s+)?(?:something|text)\\s+(?:to|for)\\s+`,
      'i'
    ).test(raw)
  ) {
    return { form: 'message', formLabel: 'message', relation: 'to' };
  }

  // "message Crowetic asking how to…" / "email Crowetic about…"
  // Skip "message to X" — already handled by withForm / formFirst.
  if (
    /\b(?:message|email|text|dm)\s+(?!to\b|for\b|about\b|on\b)[A-Za-z][A-Za-z0-9_. -]{1,40}\b/i.test(
      raw
    ) &&
    !/\b(?:who\s+is|information\s+about|look\s*up)\b/i.test(raw)
  ) {
    return { form: 'message', formLabel: 'message', relation: 'to' };
  }

  return null;
}

function formatAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatLongDate(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return 'an unknown date';
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return 'an unknown date';
  }
}

function ageTone(days: number | null): string {
  if (days == null) return 'a Qortal account';
  if (days >= 365) return 'a long-established account';
  if (days >= 180) return 'a well-seasoned account';
  if (days >= 90) return 'an established account';
  if (days >= 30) return 'a maturing account';
  if (days > 0) return 'a relatively new account';
  return 'a recently registered account';
}

function activityTone(s: QdnSummaryStats): string {
  const age = s.ageDays ?? 0;
  const ratio = age > 0 ? s.recent30 / Math.min(age, 30) : 0;
  if (s.recent30 >= 40 || (s.txsSampled >= 80 && ratio >= 0.5)) {
    return 'very active and consistently present';
  }
  if (s.recent30 >= 15 || s.txsSampled >= 40) return 'clearly active';
  if (s.recent30 >= 5 || s.txsSampled >= 15) return 'moderately active';
  return 'still building an on-chain footprint';
}

function appPhrase(app: string, count: number): string {
  const n = count.toLocaleString();
  switch (app) {
    case 'Q-Tube':
      return `${n} Q-Tube video${count === 1 ? '' : 's'}`;
    case 'Quitter':
      return `${n} Quitter post${count === 1 ? '' : 's'}`;
    case 'Q-Blog':
      return `${n} Q-Blog post${count === 1 ? '' : 's'}`;
    case 'Q-Share':
      return `${n} Q-Share file${count === 1 ? '' : 's'}`;
    case 'Audio':
      return `${n} music track${count === 1 ? '' : 's'}`;
    case 'Website':
      return `${n} website${count === 1 ? '' : 's'}`;
    case 'Q-App':
      return `${n} Q-App${count === 1 ? '' : 's'}`;
    case 'Images':
      return `${n} image${count === 1 ? '' : 's'}`;
    default:
      return `${n} ${app} item${count === 1 ? '' : 's'}`;
  }
}

function rolePitch(tags: string[]): string {
  if (tags.includes('Founder')) return 'a Founder of Qortal';
  if (tags.includes('Minter Admin')) return 'a Minter Admin';
  if (tags.includes('Dev Admin')) return 'a Dev Admin';
  if (tags.includes('Admin')) return 'a network Admin';
  if (tags.includes('Forum Admin')) return 'a Forum Admin';
  if (tags.includes('Q-Mintership Admin')) return 'a Q-Mintership Admin';
  if (tags.includes('Minter')) return 'an active Minter';
  return 'a non-minter participant';
}

/** Generalized portfolio-style profile (not a nomination pitch). */
export function buildProfileWrittenSummary(s: QdnSummaryStats): string {
  const who = s.name.trim() || 'This account';
  const paragraphs: string[] = [];

  const agePart =
    s.ageDays != null
      ? `registered on Qortal approximately ${s.ageDays.toLocaleString()} day${s.ageDays === 1 ? '' : 's'} ago (${formatLongDate(s.firstActivityTs)})`
      : 'present on Qortal (exact registration date not in the sampled window)';

  paragraphs.push(
    `${who} is ${ageTone(s.ageDays)}: ${agePart}. ` +
      `They are ${rolePitch(s.tags)} at account level ${s.level}. ` +
      `In the sampled window they show ${s.txsSampled.toLocaleString()} recent transaction${s.txsSampled === 1 ? '' : 's'}, ` +
      `with ${s.recent30.toLocaleString()} in the last 30 days, last seen ${formatLongDate(s.lastActivityTs)}.`
  );

  const mintPart =
    s.blocksMinted > 0
      ? `, with ${s.blocksMinted.toLocaleString()} block${s.blocksMinted === 1 ? '' : 's'} minted`
      : '';
  const balancePart =
    Number.isFinite(s.balance) && s.balance > 0
      ? ` and roughly ${formatAmount(s.balance)} QORT in wallet`
      : '';
  paragraphs.push(
    `Account level ${s.level}${mintPart}${balancePart}. Overall they read as ${activityTone(s)} on the network.`
  );

  const contentApps = s.appCounts.filter((a) => a.count > 0).slice(0, 6);
  if (contentApps.length || s.qdnResourceCount > 0) {
    paragraphs.push(
      `They publish across the Qortal ecosystem — ${contentApps.map((a) => appPhrase(a.app, a.count)).join('; ')}` +
        (s.qdnResourceCount > 0
          ? ` (${s.qdnResourceCount.toLocaleString()} QDN resources total in sample)`
          : '') +
        '.'
    );
  } else {
    paragraphs.push(
      `${who} has little indexed QDN publishing in this quick sample — weight peer activity and account age accordingly.`
    );
  }

  if (s.ownedNames.length > 1) {
    // Names are shown as a compact/collapsible UI list — keep prose short.
    paragraphs.push(
      `They currently hold ${s.ownedNames.length} registered names (listed below).`
    );
  }

  // Only clean publish titles — never dump raw chat snippets (they produced
  // nonsense like "Described as someone selling You anything").
  const cleanTitles = s.publishTitles.filter(isSanePublishTitle).slice(0, 6);
  if (cleanTitles.length) {
    paragraphs.push(`Recent public titles include: ${cleanTitles.join('; ')}.`);
  }

  if (s.topTxTypes.length) {
    paragraphs.push(`Top transaction types in sample: ${s.topTxTypes.join(', ')}.`);
  }

  paragraphs.push(
    `In short, ${who} presents as ${rolePitch(s.tags)} with ` +
      `${contentApps.length >= 2 ? 'multi-app content creation' : contentApps.length === 1 ? 'focused content creation' : 'a lighter public content footprint'} ` +
      `and ${activityTone(s)} network habits.`
  );

  return paragraphs.join('\n\n');
}

function isSanePublishTitle(raw: string): boolean {
  const s = raw.replace(/^\[[^\]]+\]\s*/, '').trim();
  if (s.length < 3 || s.length > 140) return false;
  if (/described as/i.test(s)) return false;
  if (/selling you/i.test(s)) return false;
  if (/^quitter post\b/i.test(s)) return false;
  const letters = (s.match(/[a-zA-Z]/g) || []).length;
  return letters >= Math.min(8, s.length * 0.35);
}

/** Enhanced, convincing nomination Reason text (MA Helper style + stronger pitch). */
export function buildNominationWrittenSummary(
  s: QdnSummaryStats,
  extras?: {
    /** Portrait grounded in what they published on QDN. */
    characterSummary?: string;
    themes?: string[];
  }
): string {
  const who = s.name.trim() || 'This account';
  const base = buildProfileWrittenSummary(s);
  // Drop the casual closing; replace with nomination-focused close.
  const withoutClose = base.replace(/\n\nIn short,[\s\S]*$/, '').trim();

  const themeLine =
    extras?.themes?.length
      ? `Their public publishes lean toward ${extras.themes.slice(0, 4).join(', ')}.`
      : '';
  const characterBlock = (extras?.characterSummary || '').trim();
  const personalize = [characterBlock, themeLine].filter(Boolean).join(' ');
  const personalizeSection = personalize
    ? `\n\nBased on what ${who} has published on QDN:\n${personalize}\n`
    : '';

  const titleBits = s.publishTitles
    .filter(isSanePublishTitle)
    .slice(0, 4)
    .map((t) => t.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean);
  const titlesSection = titleBits.length
    ? `\nRecent titles that show their voice: ${titleBits.map((t) => `“${t}”`).join('; ')}.\n`
    : '';

  const alreadyMinter =
    s.tags.includes('Minter') ||
    s.tags.includes('Minter Admin') ||
    s.tags.includes('Founder');

  if (alreadyMinter) {
    const role = rolePitch(s.tags);
    const note =
      `Note: ${who} is already in the Qortal Minter group` +
      (s.tags.includes('Minter Admin')
        ? ' (Minter Admin)'
        : s.tags.includes('Founder')
          ? ' (Founder)'
          : '') +
      `. A live nomination is not needed — below is an example of the nomination application text that would be used for an account with this footprint.\n\n`;
    const header =
      `Example nomination application for ${who}\n\n` +
      `I am nominating ${who} for Qortal Minter consideration. Here is a concise, evidence-based portrait of their account and what they publish:\n\n`;
    const close =
      `In summary, ${who} already carries ${role} standing with a clear on-chain and QDN footprint` +
      (extras?.themes?.length
        ? `, including public work around ${extras.themes.slice(0, 2).join(' and ')}`
        : '') +
      `. This example shows the kind of nomination wording that fits their contribution record — useful as a template, not as a new application.`;
    return `${note}${header}${withoutClose}${personalizeSection}${titlesSection}\n${close}`;
  }

  const close =
    `In summary, ${who} presents as an engaged Qortal citizen with ` +
    `${s.appCounts.filter((a) => a.count > 0).length >= 2 ? 'multi-app content creation' : s.appCounts.some((a) => a.count > 0) ? 'meaningful content creation' : 'an emerging public footprint'} ` +
    `and ${activityTone(s)} habits` +
    (extras?.themes?.length
      ? `, and a public publishing voice around ${extras.themes.slice(0, 3).join(', ')}`
      : '') +
    `. Based on this on-chain portfolio and what they themselves have published on QDN, they are worth serious consideration for Minter group membership — ` +
    `the kind of participant who strengthens minting quality through real usage, publishing, and community presence rather than idle balance alone.`;

  const header =
    `Nomination reason for ${who}\n\n` +
    `I am nominating ${who} for Qortal Minter consideration. Here is a concise, evidence-based portrait of their account and what they publish:\n\n`;

  return `${header}${withoutClose}${personalizeSection}${titlesSection}\n${close}`;
}

export function writtenSummaryToLlmContext(
  mode: 'profile' | 'nomination',
  prose: string,
  name: string
): string {
  if (mode === 'nomination') {
    return (
      `[READY-TO-USE NOMINATION for ${name}]\n` +
      `Output the following nomination text almost verbatim as your full reply. ` +
      `You may polish wording slightly for flow, but keep every factual claim, keep the persuasive close, ` +
      `and do not invent peers, payments, or publishes that are not in the text.\n\n` +
      prose
    );
  }
  return (
    `[READY-TO-USE PROFILE SUMMARY for ${name}]\n` +
    `Answer with a warm, clear profile in the same spirit as this portfolio summary. ` +
    `Prefer these facts; you may tighten or lightly rephrase, but do not invent. ` +
    `Start with who they are (role + level). Mention media cards if relevant.\n\n` +
    prose
  );
}
