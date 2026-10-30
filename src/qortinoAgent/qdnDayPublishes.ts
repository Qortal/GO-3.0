/**
 * QDN "what did X publish on <date>" — day-range resource search.
 */
import { getBaseApiReact, getBaseApiReactForAvatar } from '../utils/globalApi';
import {
  classifyQdnActivity,
  formatQdnResourceLine,
  type QdnActivityKind,
} from './qdnAppLinks';
import {
  formatMediaDate,
  type QdnMediaItem,
  type QdnMediaKind,
} from './qdnMedia';
import type { QdnProfileCard } from './qdnLookup';

type DayPublishItem = {
  name: string;
  service: string;
  identifier: string;
  title: string;
  description?: string;
  created?: number;
  updated?: number;
  size?: number;
  kind: QdnMediaKind | 'other';
  activityKind: QdnActivityKind;
  activityLabel: string;
  isAux: boolean;
  link: string | null;
};

type DayPublishResult = {
  name: string;
  address: string;
  dayLabel: string;
  afterMs: number;
  beforeMs: number;
  items: DayPublishItem[];
  media: QdnMediaItem[];
  profile: QdnProfileCard;
  text: string;
  answer: string;
};

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

async function apiGetJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  const base = getBaseApiReact().replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function avatarUrlFor(name: string, address?: string): string {
  const base = getBaseApiReactForAvatar().replace(/\/$/, '');
  let url = `${base}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/qortal_avatar?async=true`;
  if (address) url += `&_=${encodeURIComponent(address)}`;
  return url;
}

const MS_DAY = 86_400_000;

export type TimeRange = {
  afterMs: number;
  beforeMs: number;
  dayLabel: string;
};

/** Relative + absolute ranges: yesterday, last week, March 2025, March 1st 2025. */
export function parseTimeRange(query: string): TimeRange | null {
  const t = query.trim().toLowerCase();
  const now = Date.now();

  if (/\byesterday\b/.test(t)) {
    const d = new Date();
    const y = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1);
    return {
      afterMs: y,
      beforeMs: y + MS_DAY - 1,
      dayLabel: 'yesterday (UTC)',
    };
  }
  if (/\b(last|past)\s+week\b/.test(t) || /\bpast\s+7\s+days\b/.test(t)) {
    return {
      afterMs: now - 7 * MS_DAY,
      beforeMs: now,
      dayLabel: 'the past 7 days',
    };
  }
  if (/\bthis\s+week\b/.test(t)) {
    const d = new Date();
    const day = d.getUTCDay(); // 0 Sun
    const mondayOffset = day === 0 ? 6 : day - 1;
    const start = Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() - mondayOffset
    );
    return { afterMs: start, beforeMs: now, dayLabel: 'this week (UTC)' };
  }
  if (/\b(last|past)\s+month\b/.test(t)) {
    return {
      afterMs: now - 30 * MS_DAY,
      beforeMs: now,
      dayLabel: 'the past 30 days',
    };
  }

  // Whole month: March 2025
  const monthNames = Object.keys(MONTHS).join('|');
  const monthOnly = t.match(
    new RegExp(`\\b(${monthNames})\\s+(20\\d{2})\\b`, 'i')
  );
  if (monthOnly && !/\b\d{1,2}(?:st|nd|rd|th)?\b/.test(t.replace(monthOnly[0], ' '))) {
    const month = MONTHS[monthOnly[1].toLowerCase()];
    const year = +monthOnly[2];
    const afterMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
    const beforeMs = Date.UTC(year, month, 0, 23, 59, 59, 999);
    return {
      afterMs,
      beforeMs,
      dayLabel: `${monthOnly[1]} ${year}`,
    };
  }

  return parseCalendarDay(query);
}

/** If the spoken day is still in the future this UTC year, use last year. */
function defaultYearForMonthDay(month: number, day: number): number {
  const now = new Date();
  const y = now.getUTCFullYear();
  const candidate = Date.UTC(y, month - 1, day, 0, 0, 0, 0);
  const todayStart = Date.UTC(y, now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
  return candidate > todayStart ? y - 1 : y;
}

/** Parse a calendar day from natural language. Returns UTC midnight..end. */
export function parseCalendarDay(query: string): TimeRange | null {
  const t = query.trim().toLowerCase();

  // ISO / numeric: 2025-03-01, 2025/3/1, 01.03.2025, 3/1/2025
  const iso = t.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) {
    return dayBounds(+iso[1], +iso[2], +iso[3]);
  }
  const us = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (us) {
    // Prefer D-M-Y when day > 12, else M-D-Y (US-style common in user phrasing)
    const a = +us[1];
    const b = +us[2];
    const y = +us[3];
    if (a > 12) return dayBounds(y, b, a);
    if (b > 12) return dayBounds(y, a, b);
    return dayBounds(y, a, b);
  }

  // March 1st 2025 / 1 March 2025 / March 1, 2025 / 24th of July 2025
  const monthNames = Object.keys(MONTHS).join('|');
  const mdy = t.match(
    new RegExp(
      `\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(20\\d{2})\\b`,
      'i'
    )
  );
  if (mdy) {
    const month = MONTHS[mdy[1].toLowerCase()];
    return dayBounds(+mdy[3], month, +mdy[2]);
  }
  const dmy = t.match(
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})(?:,)?\\s+(20\\d{2})\\b`,
      'i'
    )
  );
  if (dmy) {
    const month = MONTHS[dmy[2].toLowerCase()];
    return dayBounds(+dmy[3], month, +dmy[1]);
  }

  // Year omitted (common): "24th of July", "July 24th", "24 July"
  const mdyNoYear = t.match(
    new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i')
  );
  if (mdyNoYear) {
    const month = MONTHS[mdyNoYear[1].toLowerCase()];
    const day = +mdyNoYear[2];
    return dayBounds(defaultYearForMonthDay(month, day), month, day);
  }
  const dmyNoYear = t.match(
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})\\b`,
      'i'
    )
  );
  if (dmyNoYear) {
    const month = MONTHS[dmyNoYear[2].toLowerCase()];
    const day = +dmyNoYear[1];
    return dayBounds(defaultYearForMonthDay(month, day), month, day);
  }

  return null;
}

function dayBounds(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Use UTC day bounds so "March 1st 2025" is stable across devices.
  const afterMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const beforeMs = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  if (Number.isNaN(afterMs) || Number.isNaN(beforeMs)) return null;
  const dayLabel = new Date(afterMs).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return { afterMs, beforeMs, dayLabel };
}

/**
 * Detect “what did NAME publish/post on DATE” style questions.
 * Returns the publisher name candidate (without the date phrase).
 */
export function extractDayPublishQuery(query: string): {
  name: string;
  day: TimeRange;
} | null {
  const day = parseTimeRange(query);
  if (!day) return null;

  const t = query.trim();
  const lower = t.toLowerCase();
  const looksLikePublish =
    /\b(post|posted|publish|published|publishes|upload|uploaded|qdn|activity|did)\b/.test(
      lower
    ) ||
    /\bwhat\s+(did|were|was)\b/.test(lower) ||
    /\bon\s+that\s+day\b/.test(lower) ||
    /\b(last|past|this)\s+(week|month)\b/.test(lower) ||
    /\byesterday\b/.test(lower);

  if (!looksLikePublish && !/\bon\b/.test(lower) && !/\bfrom\b/.test(lower)) {
    return null;
  }

  // Prefer an explicit "for/by/from NAME" before stripping those words.
  const forName = t.match(/\b(?:for|by|from)\s+([A-Za-z0-9 _.'-]{2,60})\s*$/i);
  if (forName?.[1]) {
    const name = forName[1].trim();
    // Avoid treating "from March 2025" as a name
    if (
      name.length >= 2 &&
      !/^(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
        name
      )
    ) {
      return { name, day };
    }
  }

  let cleaned = t
    // strip date / relative phrases (with or without year; allow "24th of July")
    .replace(
      /\b(?:on\s+)?(?:the\s+)?(?:\d{1,2}(?:st|nd|rd|th)?\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?(?:\s+20\d{2})?\b/gi,
      ' '
    )
    .replace(
      /\b(?:on\s+)?(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:,)?(?:\s+20\d{2})?\b/gi,
      ' '
    )
    .replace(
      /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2}\b/gi,
      ' '
    )
    .replace(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]20\d{2}\b/g, ' ')
    .replace(/\b(?:on\s+)?(?:that\s+day|yesterday)\b/gi, ' ')
    .replace(/\b(?:last|past|this)\s+(?:week|month)\b/gi, ' ')
    .replace(/\bpast\s+7\s+days\b/gi, ' ')
    .replace(
      /\b(what\s+did|what\s+has|what\s+were|what\s+was|show\s+me|list|tell\s+me)\b/gi,
      ' '
    )
    .replace(
      /\b(post|posted|publish|published|publishes|uploads?|uploaded|across\s+qdn|on\s+qdn|activity|that\s+user|the\s+user)\b/gi,
      ' '
    )
    // Keep "qortal" inside names like "Qortal Justin" — only strip bare QDN filler.
    .replace(/\b(for|by|from|about|did|were|was|on)\b/gi, ' ')
    .replace(/[?!.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // "Simon James" left; drop trailing filler
  cleaned = cleaned.replace(/^(me|please)\s+/i, '').trim();
  if (!cleaned || cleaned.length < 2) return null;
  // Pronouns must be rewritten by follow-up context — never name-search them
  // (e.g. "he" fuzzy-matching HELLO!).
  if (/^(user|someone|they|him|her|he|she|them|that)$/i.test(cleaned)) {
    return null;
  }

  return { name: cleaned, day };
}

function classifyKind(service: string, identifier: string): QdnMediaKind | 'other' {
  const activity = classifyQdnActivity(service, identifier);
  // Aux reactions (likes/comments) are not playable media cards
  if (activity.isAux) return 'other';
  switch (activity.kind) {
    case 'qtube_video':
    case 'qtube_playlist':
      return 'video';
    case 'qmusic_song':
    case 'qmusic_playlist':
    case 'earbump_playlist':
      return 'audio';
    case 'image':
      return 'image';
    case 'pdf':
      return 'pdf';
    case 'qshare_file':
    case 'file':
    case 'qblog_post':
      return 'file';
    default:
      return 'other';
  }
}

function displayTitle(
  metadataTitle: string | undefined,
  identifier: string,
  activityLabel: string
): string {
  const t = (metadataTitle || '').trim();
  if (t && t.toLowerCase() !== identifier.toLowerCase()) return t;
  return activityLabel;
}

type SearchHit = {
  name?: string;
  service?: string;
  identifier?: string;
  size?: number;
  created?: number;
  updated?: number;
  timestamp?: number;
  metadata?: { title?: string; description?: string };
};

async function resolvePublisher(
  candidate: string,
  signal?: AbortSignal
): Promise<{ name: string; address: string } | null> {
  const tryOne = async (q: string) => {
    const exact = await apiGetJson<{ name?: string; owner?: string }>(
      `/names/${encodeURIComponent(q)}`,
      signal
    );
    if (exact?.owner) {
      return { name: exact.name || q, address: exact.owner };
    }
    const search = await apiGetJson<Array<{ name?: string; owner?: string }>>(
      `/names/search?query=${encodeURIComponent(q)}&prefix=true&limit=12`,
      signal
    );
    if (!search?.length) return null;
    const lower = q.toLowerCase();
    const hit =
      search.find((n) => (n.name || '').toLowerCase() === lower) ||
      search.find((n) => (n.name || '').toLowerCase().startsWith(lower)) ||
      search.find((n) => (n.name || '').toLowerCase().includes(lower)) ||
      search[0];
    if (!hit?.owner || !hit.name) return null;
    return { name: hit.name, address: hit.owner };
  };

  const primary = await tryOne(candidate);
  if (primary) return primary;

  // "qortal justin" sometimes registered without the leading "Qortal "
  const stripped = candidate.replace(/^qortal\s+/i, '').trim();
  if (stripped && stripped.toLowerCase() !== candidate.toLowerCase()) {
    const alt = await tryOne(stripped);
    if (alt) return alt;
  }
  return null;
}

export async function fetchPublishesOnDay(
  nameCandidate: string,
  day: { afterMs: number; beforeMs: number; dayLabel: string },
  signal?: AbortSignal
): Promise<DayPublishResult | null> {
  const resolved = await resolvePublisher(nameCandidate, signal);
  console.info('[Qortino QDN] day publishes', {
    candidate: nameCandidate,
    dayLabel: day.dayLabel,
    afterMs: day.afterMs,
    beforeMs: day.beforeMs,
    resolved: resolved?.name || null,
  });
  if (!resolved) return null;

  const qs = new URLSearchParams({
    name: resolved.name,
    exactmatchnames: 'true',
    mode: 'ALL',
    limit: '80',
    offset: '0',
    reverse: 'true',
    includemetadata: 'true',
    includestatus: 'true',
    after: String(day.afterMs),
    before: String(day.beforeMs),
  });

  let hits =
    (await apiGetJson<SearchHit[]>(
      `/arbitrary/resources/search?${qs.toString()}`,
      signal
    )) || [];

  // Fallback without exactmatch if empty
  if (!hits.length) {
    const qs2 = new URLSearchParams(qs);
    qs2.delete('exactmatchnames');
    hits =
      (await apiGetJson<SearchHit[]>(
        `/arbitrary/resources/search?${qs2.toString()}`,
        signal
      )) || [];
    hits = hits.filter(
      (h) => (h.name || '').toLowerCase() === resolved.name.toLowerCase()
    );
  }

  // Client-side filter in case node ignores after/before.
  // Some nodes return seconds; normalize to ms before comparing.
  const toMs = (ts: number) => (ts > 0 && ts < 1e12 ? ts * 1000 : ts);
  hits = hits.filter((h) => {
    const raw = h.created || h.updated || h.timestamp;
    if (typeof raw !== 'number') return true;
    const ts = toMs(raw);
    return ts >= day.afterMs && ts <= day.beforeMs;
  });

  const items: DayPublishItem[] = hits.map((h) => {
    const name = h.name || resolved.name;
    const service = h.service || 'UNKNOWN';
    const identifier = h.identifier || 'default';
    const activity = classifyQdnActivity(service, identifier, name);
    const kind = classifyKind(service, identifier);
    const title = displayTitle(h.metadata?.title, identifier, activity.label);
    return {
      name,
      service,
      identifier,
      title,
      description: h.metadata?.description,
      created: h.created || h.timestamp,
      updated: h.updated,
      size: h.size,
      kind,
      activityKind: activity.kind,
      activityLabel: activity.label,
      isAux: activity.isAux,
      link: activity.link,
    };
  });

  // Prefer primary publishes first; keep likes/replies but labeled as aux
  items.sort((a, b) => Number(a.isAux) - Number(b.isAux));

  const media: QdnMediaItem[] = items
    .filter((i) => i.kind !== 'other' && !i.isAux)
    .map((i) => ({
      kind: i.kind as QdnMediaKind,
      name: i.name,
      service: i.service,
      identifier: i.identifier,
      title: i.title,
      description: i.description,
      size: i.size,
      created: i.created,
      updated: i.updated,
    }));

  const addr = await apiGetJson<{ level?: number }>(
    `/addresses/${encodeURIComponent(resolved.address)}`,
    signal
  );

  const profile: QdnProfileCard = {
    name: resolved.name,
    address: resolved.address,
    level: typeof addr?.level === 'number' ? addr.level : 0,
    tags: ['Publisher'],
    avatarUrl: avatarUrlFor(resolved.name, resolved.address),
  };

  const primary = items.filter((i) => !i.isAux);
  const aux = items.filter((i) => i.isAux);

  const lines = items.slice(0, 40).map((i, idx) =>
    formatQdnResourceLine({
      index: idx + 1,
      name: i.name,
      service: i.service,
      identifier: i.identifier,
      title: i.title,
      when: formatMediaDate(i.created || i.updated) || day.dayLabel,
    })
  );

  const text =
    items.length === 0
      ? `[QDN day publishes · ${resolved.name} · ${day.dayLabel}]\nNo QDN resources found for this name in that UTC day range (${day.afterMs}–${day.beforeMs}). Say so clearly.`
      : `[QDN day publishes · ${resolved.name} · ${day.dayLabel}]\n${primary.length} primary publish(es), ${aux.length} reaction/aux item(s):\n${lines.join('\n')}\nREQUIRED: Use the markdown [Open…](qortal://…) links in your reply. Distinguish likes/replies from real posts/videos. Do NOT dump raw identifier hashes as the main text — hashes may appear only in small backticks if at all. Mention media cards when present.`;

  const answerParts: string[] = [];
  if (items.length === 0) {
    answerParts.push(
      `I didn’t find QDN publishes from ${resolved.name} on ${day.dayLabel} (UTC day window) on this node. They may have been inactive that day, or the resources aren’t synced here yet.`
    );
  } else {
    answerParts.push(
      `On ${day.dayLabel} (UTC), **${resolved.name}** has ${primary.length} primary QDN publish(es)` +
        (aux.length ? ` and ${aux.length} reaction/aux item(s)` : '') +
        `:`
    );
    if (primary.length) {
      answerParts.push('');
      answerParts.push('### Publishes');
      for (const [idx, i] of primary.slice(0, 20).entries()) {
        answerParts.push(
          formatQdnResourceLine({
            index: idx + 1,
            name: i.name,
            service: i.service,
            identifier: i.identifier,
            title: i.title,
            when: i.created ? formatMediaDate(i.created) : undefined,
          })
        );
      }
      if (primary.length > 20) {
        answerParts.push(`…and ${primary.length - 20} more publishes.`);
      }
    }
    if (aux.length) {
      answerParts.push('');
      answerParts.push('### Likes / replies / other activity');
      for (const [idx, i] of aux.slice(0, 12).entries()) {
        answerParts.push(
          formatQdnResourceLine({
            index: idx + 1,
            name: i.name,
            service: i.service,
            identifier: i.identifier,
            title: i.title,
            when: i.created ? formatMediaDate(i.created) : undefined,
          })
        );
      }
      if (aux.length > 12) {
        answerParts.push(`…and ${aux.length - 12} more reactions.`);
      }
    }
  }
  const answer = answerParts.join('\n');

  return {
    name: resolved.name,
    address: resolved.address,
    dayLabel: day.dayLabel,
    afterMs: day.afterMs,
    beforeMs: day.beforeMs,
    items,
    media,
    profile,
    text,
    answer,
  };
}
