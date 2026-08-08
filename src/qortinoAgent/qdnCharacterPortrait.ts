/**
 * Personalized character portraits for Qortino who-is / Users search.
 * Deterministic seed from publish themes + optional on-device LLM polish.
 */

export type PublishSignal = {
  source: string;
  title: string;
  excerpt?: string;
};

export type ContentTheme = {
  id: string;
  label: string;
};

const THEME_RULES: Array<{ id: string; label: string; re: RegExp }> = [
  {
    id: 'censorship',
    label: 'anti-censorship / free speech',
    re: /\b(censor(?:ship|ed|ing)?|free\s*speech|deplatform|banned|ban\b|cancel\s*culture|unfiltered|uncensored|speak\s*freely|silenced|whistleblow)/i,
  },
  {
    id: 'privacy',
    label: 'privacy / digital sovereignty',
    re: /\b(privacy|surveillance|sovereign(?:ty)?|self[- ]?custody|decentrali[sz]e?d?|own\s*your\s*data|no\s*kyc|anonymous|pseudonym)/i,
  },
  {
    id: 'freedom',
    label: 'freedom / liberty',
    re: /\b(freedom|liberty|rights?\b|constitution|tyranny|authoritarian|oppression|resistance)/i,
  },
  {
    id: 'geopolitics',
    label: 'geopolitics / world events',
    re: /\b(war|military|conflict|ukraine|gaza|israel|weapon|geopolitic|nato|empire|propaganda)/i,
  },
  {
    id: 'politics',
    label: 'politics / civic life',
    re: /\b(politic|election|government|parliament|congress|democracy|vote|policy)/i,
  },
  {
    id: 'qortal',
    label: 'Qortal / decentralized web',
    re: /\b(qortal|qort\b|qdn|mint(?:ing|er)?|blockchain|crypto|node\b|peer[- ]to[- ]peer|web3)/i,
  },
  {
    id: 'ai',
    label: 'AI / emerging tech',
    re: /\b(\bai\b|artificial\s*intelligence|llm|machine\s*learning|robot|automation)/i,
  },
  {
    id: 'faith',
    label: 'faith / spirituality',
    re: /\b(god|faith|church|bible|spiritual|pray|gospel|christ|islam|muslim|torah)/i,
  },
  {
    id: 'music',
    label: 'music',
    re: /\b(music|song|album|concert|lyrics|beat|remix|ear[- ]?bump)/i,
  },
  {
    id: 'sports',
    label: 'sports',
    re: /\b(fifa|football|soccer|messi|world\s*cup|sport|nba|olympics|athlete)/i,
  },
  {
    id: 'health',
    label: 'food / health / land',
    re: /\b(garden|food|farm|seed|health|nutrition|homestead|organic|herb)/i,
  },
  {
    id: 'education',
    label: 'education / how-tos',
    re: /\b(how\s*to|tutorial|guide|learn|teach|explainer|lesson|course|tips?)\b/i,
  },
  {
    id: 'art',
    label: 'art / creative work',
    re: /\b(art\b|artist|painting|illustration|design|creative|photography|photo\b)/i,
  },
  {
    id: 'news',
    label: 'independent media / commentary',
    re: /\b(news|report|investigat|journalis|commentary|analysis|expose|truth\b)/i,
  },
  {
    id: 'community',
    label: 'community / culture',
    re: /\b(community|culture|together|meetup|family|friends|collective)/i,
  },
];

function bagOf(publishes: PublishSignal[]): string {
  return publishes
    .map((p) => `${p.source} ${p.title} ${p.excerpt || ''}`.toLowerCase())
    .join(' · ');
}

/** Structured themes from public titles/excerpts. */
export function extractContentThemes(
  publishes: PublishSignal[]
): ContentTheme[] {
  const bag = bagOf(publishes);
  if (!bag.trim()) return [];
  const out: ContentTheme[] = [];
  for (const rule of THEME_RULES) {
    if (rule.re.test(bag)) out.push({ id: rule.id, label: rule.label });
  }
  return out;
}

/** Human line for LLM / dossier notes (back-compat with deriveThemeHints). */
export function formatThemeHintLine(themes: ContentTheme[]): string {
  if (!themes.length) {
    return 'Theme hints: mixed / general (see titles below).';
  }
  return `Theme hints from publishes: ${themes.map((t) => t.label).join(', ')}`;
}

function sourceMix(publishes: PublishSignal[]): string {
  const counts = new Map<string, number>();
  for (const p of publishes) {
    const key = (p.source || 'QDN').trim() || 'QDN';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([src]) => src);
  if (!ranked.length) return 'public QDN posts';
  if (ranked.length === 1) return ranked[0];
  if (ranked.length === 2) return `${ranked[0]} and ${ranked[1]}`;
  return `${ranked.slice(0, -1).join(', ')}, and ${ranked[ranked.length - 1]}`;
}

function cleanTitle(raw: string): string | null {
  const s = raw.replace(/^\[[^\]]+\]\s*/, '').trim();
  if (s.length < 3 || s.length > 100) return null;
  if (/described as|selling you|^quitter post\b/i.test(s)) return null;
  const letters = (s.match(/[a-zA-Z]/g) || []).length;
  if (letters < Math.min(6, s.length * 0.3)) return null;
  return s;
}

/**
 * Deterministic character portrait — always safe, no LLM required.
 * Used as the seed for on-device polish and as the fallback if polish fails.
 */
export function buildCharacterPortrait(options: {
  name: string;
  rolePitch: string;
  level: number;
  themes: ContentTheme[];
  publishes: PublishSignal[];
  appCounts?: Array<{ app: string; count: number }>;
}): string {
  const who = options.name.trim() || 'This person';
  const themes = options.themes.slice(0, 4);
  const titles = options.publishes
    .map((p) => cleanTitle(p.title))
    .filter((t): t is string => !!t)
    .slice(0, 5);
  const mix = sourceMix(options.publishes);
  const apps = (options.appCounts || [])
    .filter((a) => a.count > 0)
    .slice(0, 3)
    .map((a) => a.app);

  if (!themes.length && !titles.length && !apps.length) {
    return (
      `${who} keeps a light public content trail on this node so far — ` +
      `their character shows more in on-chain activity than in a loud publishing style.`
    );
  }

  const parts: string[] = [];

  if (themes.length) {
    const themePhrase =
      themes.length === 1
        ? themes[0].label
        : themes.length === 2
          ? `${themes[0].label} and ${themes[1].label}`
          : `${themes
              .slice(0, -1)
              .map((t) => t.label)
              .join(', ')}, and ${themes[themes.length - 1].label}`;
    parts.push(
      `Based on what ${who} has published on QDN (${mix}), they come across as someone drawn to ${themePhrase}.`
    );
  } else {
    parts.push(
      `Based on what ${who} has published across ${mix}, their titles and posts show a clear personal voice.`
    );
  }

  if (titles.length) {
    const sample =
      titles.length <= 2
        ? titles.map((t) => `“${t}”`).join(' and ')
        : `${titles
            .slice(0, 2)
            .map((t) => `“${t}”`)
            .join(', ')}, and more`;
    parts.push(`Recent titles they published lean that way — ${sample}.`);
  }

  if (apps.length >= 2) {
    parts.push(
      `They publish across ${apps.join(' and ')}, so this reads as an active multi-app creator, not a one-channel lurker.`
    );
  } else if (apps.length === 1) {
    parts.push(
      `Most of that publishing voice lives on ${apps[0]}, which fits a focused creator rather than a scattershot account.`
    );
  }

  // Soft close tied to role without inventing biography.
  parts.push(
    `Altogether they read as ${options.rolePitch}, based on information published by the user on QDN — not a canned bio.`
  );

  return parts.join(' ');
}

/** Prompt for a short on-device LLM polish of the seed portrait. */
export function buildCharacterPolishPrompt(options: {
  name: string;
  roleLine: string;
  level: number;
  themes: ContentTheme[];
  publishes: PublishSignal[];
  seedPortrait: string;
}): string {
  const titleLines = options.publishes
    .slice(0, 12)
    .map((p) => {
      const ex = p.excerpt ? ` — ${p.excerpt.slice(0, 120)}` : '';
      return `- [${p.source}] ${p.title}${ex}`;
    })
    .join('\n');

  return [
    `Write a warm, personalized 3–5 sentence character summary of Qortal user "${options.name}".`,
    `Base it on information published by the user on QDN (titles/themes below) — not on generic "provided information".`,
    `Ground EVERY claim in those publishes. Do not invent biography, jobs, location, or topics not listed.`,
    `Never say the profile/name/data "appears incomplete" or that you lack information — describe what their publishes do show.`,
    `Third person. No "as an AI". No bullet lists. No markdown headings.`,
    `Open by echoing their role (${options.roleLine}) and Level ${options.level} in the first sentence, then focus on personality / interests from what they published.`,
    options.themes.length
      ? `Themes from their publishes: ${options.themes.map((t) => t.label).join('; ')}.`
      : 'Themes: mixed / general from their titles.',
    '',
    'Seed portrait (improve the voice; keep the facts):',
    options.seedPortrait,
    '',
    'What they published (titles / excerpts):',
    titleLines || '(none sampled)',
  ].join('\n');
}

export const CHARACTER_POLISH_SYSTEM = `You are Qortino writing a short character portrait of a Qortal user from what they published on QDN.
Rules:
- 3 to 5 sentences, third person, warm and specific.
- Base the portrait on information published by the user (titles/themes), never invent.
- No "as an AI", no web search claims, no game lore.
- Prefer personality ("cares about free speech", "leans into geopolitics") over wallet stats.
- Never say the name, profile, account, or data "appears incomplete", "is incomplete", or that you lack information — describe what their publishes do show.
- Return plain prose only.`;

/** Strip obvious LLM junk / unsafe inventiveness markers. */
export function sanitizeCharacterPortrait(raw: string, name: string): string {
  let t = (raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  // Drop leading role labels the model sometimes echoes as headings.
  t = t.replace(/^(character summary|portrait|about)\s*[:\-—]\s*/i, '');
  // Reject if it wanders into game fiction (known failure mode).
  if (/\b(video\s*game|playing qortal|quantum|as an ai|i cannot|i don't have access)\b/i.test(t)) {
    return '';
  }
  // Small models sometimes refuse with "X appears to be incomplete" instead of a portrait.
  if (
    /\b(appears? to be|seems?|is)\s+incomplete\b/i.test(t) ||
    /\b(incomplete|insufficient|not enough)\s+(information|data|profile|account|content)\b/i.test(
      t
    ) ||
    /\b(cannot|can't|unable to)\s+(determine|assess|summarize|write)\b/i.test(t)
  ) {
    return '';
  }
  // Must mention the person or be reasonably short prose.
  const mentions =
    t.toLowerCase().includes(name.toLowerCase()) ||
    /\b(they|their|this (?:user|person|account|publisher))\b/i.test(t);
  if (!mentions) return '';
  if (t.length < 40 || t.length > 900) return '';
  return t;
}
