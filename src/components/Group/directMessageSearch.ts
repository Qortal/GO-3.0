import { reticulumVisibleSearchTextFromPayload } from './reticulumSearchText';

/** Fewer letters than this find nothing (as in the engine's search). */
export const DM_SEARCH_MIN_LENGTH = 2;
/** At most this many results are shown. */
export const DM_SEARCH_RESULT_LIMIT = 60;
/**
 * Asked of the engine: more than are shown, since a few of its matches are
 * only in the message's markup (a link's address, a tag) and are dropped.
 */
export const DM_SEARCH_FETCH_LIMIT = 120;

/** One message found by the DM search. */
export interface DirectSearchHit {
  /** The message to open at (an edit's own message). */
  messageId: string;
  /** The other person in the conversation (yourself in Saved Messages). */
  peerAddress: string;
  fromMe: boolean;
  timestamp: number;
  /** The message as shown, without markup. */
  text: string;
}

/** What the engine returns for a found message (a DM event). */
export interface DirectSearchEvent {
  eventId?: string;
  eventType?: string;
  targetEventId?: string;
  senderAddress?: string;
  recipientAddress?: string;
  timestamp?: number;
  payload?: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

/** Turns the HTML entities a message's markup uses back into text. */
export const decodeHtmlEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? safeFromCodePoint(code, match) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? safeFromCodePoint(code, match) : match;
    }
    return ENTITIES[lower] ?? match;
  });

const safeFromCodePoint = (code: number, fallback: string) => {
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
};

/** A DM payload's text as it reads in the chat. */
export const directMessageVisibleText = (payload: unknown): string => {
  let parsed: unknown = payload;
  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload);
    } catch {
      parsed = payload;
    }
  }
  return decodeHtmlEntities(reticulumVisibleSearchTextFromPayload(parsed))
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * The engine's matches as results: only messages whose shown text holds
 * `query` (it also matches markup), one per message (an edit stands for the
 * message it edits), newest first as the engine gave them.
 */
export function directSearchHits(
  events: readonly DirectSearchEvent[],
  query: string,
  myAddress: string,
  limit = DM_SEARCH_RESULT_LIMIT
): DirectSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < DM_SEARCH_MIN_LENGTH) return [];
  const hits: DirectSearchHit[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (hits.length >= limit) break;
    if (!event?.eventId) continue;
    const messageId =
      event.eventType === 'edit' && event.targetEventId
        ? event.targetEventId
        : event.eventId;
    if (seen.has(messageId)) continue;
    const text = directMessageVisibleText(event.payload ?? '');
    if (!text.toLowerCase().includes(needle)) continue;
    const sender = String(event.senderAddress || '');
    const recipient = String(event.recipientAddress || '');
    const fromMe = sender === myAddress;
    const peerAddress = fromMe ? recipient : sender;
    if (!peerAddress) continue;
    seen.add(messageId);
    hits.push({
      messageId,
      peerAddress,
      fromMe,
      timestamp: Number(event.timestamp) || 0,
      text,
    });
  }
  return hits;
}

/**
 * The part of `text` to show for a result: around the first match, so the
 * match is on screen even in a long message.
 */
export function directSearchSnippet(
  text: string,
  query: string,
  context = 48
): { before: string; match: string; after: string } {
  const needle = query.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return { before: '', match: '', after: text };
  const start = Math.max(0, at - context);
  // Start on a word, not inside one.
  const wordStart = start === 0 ? 0 : text.indexOf(' ', start) + 1 || start;
  const from = wordStart > at ? start : wordStart;
  return {
    before: `${from > 0 ? '… ' : ''}${text.slice(from, at)}`,
    match: text.slice(at, at + needle.length),
    after: text.slice(at + needle.length),
  };
}
