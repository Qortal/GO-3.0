/**
 * Resolve chat follow-ups like "that user" / "them" from recent QDN bubbles.
 */
type FollowUpBubble = {
  role: 'user' | 'assistant';
  content: string;
  profiles?: Array<{ name: string }>;
  media?: Array<{ name: string }>;
  ownedNames?: Array<{ name: string; isPrimary?: boolean }>;
};

type FollowUpResolution = {
  /** Query after pronoun/name rewrite */
  text: string;
  resolvedName?: string;
  notes: string[];
};

function lastMentionedName(bubbles: FollowUpBubble[]): string | null {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    if (b.profiles?.length) {
      const p = b.profiles[0]?.name?.trim();
      if (p) return p;
    }
    if (b.ownedNames?.length) {
      const primary =
        b.ownedNames.find((n) => n.isPrimary)?.name || b.ownedNames[0]?.name;
      if (primary?.trim()) return primary.trim();
    }
    if (b.media?.length) {
      const n = b.media[0]?.name?.trim();
      if (n) return n;
    }
  }
  return null;
}

const PRONOUN_RE =
  /\b(that\s+user|the\s+user|that\s+person|that\s+name|them|him|her|he|she|they)\b/gi;

function hasPronoun(query: string): boolean {
  PRONOUN_RE.lastIndex = 0;
  const hit = PRONOUN_RE.test(query);
  PRONOUN_RE.lastIndex = 0;
  return hit;
}

/** True when the query needs a prior entity (pronouns / vague "what about last week"). */
export function needsFollowUpContext(query: string): boolean {
  const t = query.trim().toLowerCase();
  if (!t) return false;
  if (hasPronoun(t)) return true;
  if (
    /^(what\s+about|and|also|how\s+about)\s+(last\s+week|yesterday|this\s+week|last\s+month)\b/.test(
      t
    )
  ) {
    return true;
  }
  // Bare date follow-up after a person card: "on june 12th?" / "what about may 17?"
  if (
    /^(what\s+about|and|also|how\s+about|on)\s+/.test(t) &&
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}(?:st|nd|rd|th)?|yesterday|last\s+week|this\s+week)\b/.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Rewrite follow-up pronouns using the most recent profile/media name in chat.
 * Also expands bare "what about last week" → "what did NAME publish last week".
 */
export function resolveFollowUpQuery(
  query: string,
  recentBubbles: FollowUpBubble[]
): FollowUpResolution {
  const notes: string[] = [];
  let text = query.trim();
  const name = lastMentionedName(recentBubbles);

  if (name && hasPronoun(text)) {
    text = text.replace(PRONOUN_RE, name);
    PRONOUN_RE.lastIndex = 0;
    notes.push(`Resolved follow-up to “${name}”`);
  }

  // "what about last week?" / "on June 12th?" with a known prior user
  if (
    name &&
    /^(what\s+about|and|also|how\s+about|on)\s+/i.test(text) &&
    /\b(last\s+week|yesterday|this\s+week|last\s+month|the\s+past\s+week|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}(?:st|nd|rd|th)?)\b/i.test(
      text
    ) &&
    !/\b(publish|published|post|posted|upload|uploaded)\b/i.test(text)
  ) {
    const range = text
      .replace(/^(what\s+about|and|also|how\s+about|on)\s+/i, '')
      .replace(/[?!.]+$/, '')
      .trim();
    text = `what did ${name} publish on ${range.replace(/^on\s+/i, '')}`;
    notes.push(`Expanded time follow-up for “${name}”`);
  }

  return {
    text,
    resolvedName: name || undefined,
    notes,
  };
}
