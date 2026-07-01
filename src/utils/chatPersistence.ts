// Lightweight, localStorage-backed persistence for the mobile chat experience:
//  - the last-opened conversation (so the Chat tab can resume where the user
//    left off, even after the app was minimised / killed), and
//  - per-conversation unsent draft messages.
//
// Everything is namespaced by account address so switching wallets never leaks
// one account's drafts or last-opened chat into another.

const LAST_OPEN_PREFIX = 'qortal-chat-last-open';
const DRAFTS_PREFIX = 'qortal-chat-drafts';

// Fired whenever the stored drafts change, so UI (e.g. the chat lists showing a
// "DRAFT" marker) can refresh without polling localStorage.
export const DRAFTS_CHANGED_EVENT = 'qortal-chat-drafts-changed';

export type LastOpenChat =
  | { kind: 'group'; id: string }
  | { kind: 'direct'; id: string };

const accountKey = (prefix: string, account?: string | null) =>
  `${prefix}:${account || 'unknown'}`;

export function getLastOpenChat(account?: string | null): LastOpenChat | null {
  try {
    const raw = localStorage.getItem(accountKey(LAST_OPEN_PREFIX, account));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      (parsed.kind === 'group' || parsed.kind === 'direct') &&
      parsed.id != null &&
      parsed.id !== ''
    ) {
      return { kind: parsed.kind, id: String(parsed.id) };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function setLastOpenChat(
  account: string | null | undefined,
  value: LastOpenChat | null
): void {
  try {
    const key = accountKey(LAST_OPEN_PREFIX, account);
    if (!value) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(
        key,
        JSON.stringify({ kind: value.kind, id: String(value.id) })
      );
    }
  } catch {
    /* ignore */
  }
}

type DraftMap = Record<string, string>;

function readDrafts(account?: string | null): DraftMap {
  try {
    const raw = localStorage.getItem(accountKey(DRAFTS_PREFIX, account));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as DraftMap;
  } catch {
    /* ignore */
  }
  return {};
}

function writeDrafts(account: string | null | undefined, map: DraftMap): void {
  try {
    localStorage.setItem(accountKey(DRAFTS_PREFIX, account), JSON.stringify(map));
    try {
      window.dispatchEvent(new Event(DRAFTS_CHANGED_EVENT));
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}

/** Raw drafts JSON string for an account (stable reference for store reads). */
export function getDraftsRaw(account?: string | null): string {
  try {
    return localStorage.getItem(accountKey(DRAFTS_PREFIX, account)) || '';
  } catch {
    return '';
  }
}

const EMPTY_HTML = new Set(['', '<p></p>', '<p><br></p>', '<p><br/></p>']);

export function isEmptyChatHtml(html?: string | null): boolean {
  if (!html) return true;
  const trimmed = html.trim();
  if (EMPTY_HTML.has(trimmed)) return true;
  // Strip tags / non-breaking spaces and see whether anything meaningful is left
  // (so an empty paragraph with formatting marks still counts as empty).
  const text = trimmed
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, '')
    .replace(/\s+/g, '');
  return text.length === 0;
}

export const groupDraftKey = (groupId: string | number) => `group:${groupId}`;
export const directDraftKey = (address: string) => `direct:${address}`;

export function getChatDraft(
  account: string | null | undefined,
  key: string
): string {
  const map = readDrafts(account);
  return map[key] || '';
}

export function setChatDraft(
  account: string | null | undefined,
  key: string,
  html: string
): void {
  const map = readDrafts(account);
  if (isEmptyChatHtml(html)) {
    if (map[key] === undefined) return;
    delete map[key];
  } else {
    if (map[key] === html) return;
    map[key] = html;
  }
  writeDrafts(account, map);
}

export function clearChatDraft(
  account: string | null | undefined,
  key: string
): void {
  const map = readDrafts(account);
  if (map[key] === undefined) return;
  delete map[key];
  writeDrafts(account, map);
}
