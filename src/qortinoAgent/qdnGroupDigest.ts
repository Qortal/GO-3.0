/**
 * Group activity digest — "what's new in Welcome to Qortal this week?"
 */
import { apiGetJson } from './qdnApi';
import { findGroupByName, formatRegistered } from './qdnRoster';
import { parseTimeRange } from './qdnDayPublishes';
import type { QdnProfileCard } from './qdnLookup';
import { qAppAvatarUrl } from './qAppCatalog';

type ChatMsg = {
  timestamp?: number;
  sender?: string;
  senderName?: string;
  message?: string;
};

const MS_DAY = 86_400_000;

export function extractGroupDigestQuery(query: string): {
  groupName: string;
  afterMs: number;
  beforeMs: number;
  rangeLabel: string;
} | null {
  const t = query.trim();
  if (!t) return null;
  const lower = t.toLowerCase();

  const looksDigest =
    /\b(what'?s\s+new|whats\s+new|activity|happening|digest|updates?|messages?)\b/.test(
      lower
    ) ||
    /\b(in|for|from)\s+(the\s+)?group\b/.test(lower) ||
    /\bgroup\s+(chat|activity|this\s+week)\b/.test(lower);

  if (!looksDigest && !/\bthis\s+week\b/.test(lower) && !/\blast\s+week\b/.test(lower)) {
    // Still allow "what's new in Welcome to Qortal"
    if (!/\bwhat'?s\s+new\b/.test(lower) && !/\bwhats\s+new\b/.test(lower)) {
      return null;
    }
  }

  const range =
    parseTimeRange(t) || {
      afterMs: Date.now() - 7 * MS_DAY,
      beforeMs: Date.now(),
      dayLabel: 'the past 7 days',
    };

  const patterns = [
    /(?:what'?s|whats)\s+new\s+in(?:\s+the)?\s+(.+?)(?:\s+group)?(?:\s+this\s+week|\s+last\s+week)?\s*\??$/i,
    /(?:activity|digest|updates?|happening)\s+in(?:\s+the)?\s+(.+?)(?:\s+group)?(?:\s+this\s+week|\s+last\s+week)?\s*\??$/i,
    /(?:in|for)\s+(?:the\s+)?(.+?)\s+group(?:\s+this\s+week|\s+last\s+week)?\s*\??$/i,
  ];

  let groupName = '';
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      groupName = m[1]
        .replace(/\b(this|last)\s+week\b/gi, '')
        .replace(/\b(yesterday|activity|digest)\b/gi, '')
        .trim();
      if (groupName.length >= 2) break;
    }
  }
  if (!groupName) return null;

  return {
    groupName,
    afterMs: range.afterMs,
    beforeMs: range.beforeMs,
    rangeLabel: range.dayLabel,
  };
}

function decodeSnippet(raw?: string): string {
  if (!raw) return '';
  try {
    // Many group chats are BASE64 JSON or plain text
    const decoded = atob(raw);
    try {
      const json = JSON.parse(decoded) as { message?: string; text?: string };
      return String(json.message || json.text || decoded).slice(0, 140);
    } catch {
      return decoded.slice(0, 140);
    }
  } catch {
    return raw.slice(0, 140);
  }
}

export async function fetchGroupActivityDigest(
  groupNameQuery: string,
  range: { afterMs: number; beforeMs: number; rangeLabel: string },
  signal?: AbortSignal
): Promise<{
  answer: string;
  profile?: QdnProfileCard;
} | null> {
  const group = await findGroupByName(groupNameQuery, signal);
  if (!group?.groupId) return null;

  const msgs =
    (await apiGetJson<ChatMsg[]>(
      `/chat/messages?txGroupId=${group.groupId}&encoding=BASE64&limit=40&reverse=true&after=${range.afterMs}&before=${range.beforeMs}`,
      signal
    )) || [];

  const inRange = msgs.filter((m) => {
    const ts = m.timestamp;
    if (typeof ts !== 'number') return true;
    return ts >= range.afterMs && ts <= range.beforeMs;
  });

  const speakers = new Map<string, number>();
  for (const m of inRange) {
    const key = (m.senderName || m.sender || 'unknown').trim();
    speakers.set(key, (speakers.get(key) || 0) + 1);
  }
  const topSpeakers = [...speakers.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const snippets = inRange.slice(0, 8).map((m) => {
    const who = m.senderName || (m.sender ? m.sender.slice(0, 8) + '…' : '?');
    const when = m.timestamp ? formatRegistered(m.timestamp) : '';
    const text = decodeSnippet(m.message).replace(/\s+/g, ' ').trim() || '(media/empty)';
    return `• ${who}${when ? ` · ${when}` : ''}: ${text}`;
  });

  const gName = group.groupName || groupNameQuery;
  const answer = inRange.length
    ? `Group “${gName}” (id ${group.groupId}) — ${inRange.length} chat message(s) in ${range.rangeLabel}` +
      (group.memberCount != null ? `; ~${group.memberCount} members.` : '.') +
      (topSpeakers.length
        ? `\nMost active: ${topSpeakers.map(([n, c]) => `${n} (${c})`).join(', ')}.`
        : '') +
      `\n\nRecent lines:\n${snippets.join('\n')}`
    : `Group “${gName}” (id ${group.groupId}) — no chat messages found in ${range.rangeLabel} on this node. The group may be quiet, or messages aren’t synced here yet.`;

  const ownerName = (group.ownerPrimaryName || '').trim();
  const profile: QdnProfileCard | undefined = ownerName
    ? {
        name: ownerName,
        address: group.owner || '',
        level: 0,
        tags: ['Group owner'],
        avatarUrl: qAppAvatarUrl(ownerName),
      }
    : undefined;

  return { answer, profile };
}
