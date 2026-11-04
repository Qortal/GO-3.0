/**
 * Persisted Qortino chat sessions, with pin + rename.
 */
import { Preferences } from '@capacitor/preferences';

const SESSIONS_KEY = 'qortino_chat_sessions_v1';
const ACTIVE_KEY = 'qortino_chat_active_v1';

type QortinoChatMode = 'offline' | 'qdn';

/**
 * Serializable bubble — mirrors chat UI fields we care to restore. Sessions
 * saved by the old QDN chat carried more card fields; they stay in storage
 * but only offline sessions are shown.
 */
export type StoredChatBubble = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Exactly what the model was given / wrote for this turn. */
  modelContent?: string;
  links?: unknown[];
  apps?: unknown[];
  canContinueAssemble?: boolean;
  continueQuery?: string;
};

export type QortinoChatSession = {
  id: string;
  title: string;
  /** User renamed — stop auto-titling from first message. */
  titleCustom?: boolean;
  pinned: boolean;
  mode: QortinoChatMode;
  createdAt: number;
  updatedAt: number;
  messages: StoredChatBubble[];
};

type ActiveMap = Partial<Record<QortinoChatMode, string>>;

/** Title of a chat not named yet; shown translated (see the history panel). */
export const UNTITLED_CHAT_TITLE = 'New chat';

function newId(): string {
  return `qchat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function titleFromMessages(messages: StoredChatBubble[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
  if (!firstUser) return UNTITLED_CHAT_TITLE;
  const t = firstUser.content.replace(/\s+/g, ' ').trim();
  return t.length > 42 ? `${t.slice(0, 42)}…` : t;
}

export function createEmptySession(mode: QortinoChatMode): QortinoChatSession {
  const now = Date.now();
  return {
    id: newId(),
    title: UNTITLED_CHAT_TITLE,
    pinned: false,
    mode,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export async function loadChatSessions(): Promise<QortinoChatSession[]> {
  try {
    const { value } = await Preferences.get({ key: SESSIONS_KEY });
    if (!value) return [];
    const parsed = JSON.parse(value) as QortinoChatSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveChatSessions(
  sessions: QortinoChatSession[]
): Promise<void> {
  // Cap storage: keep newest 80 sessions.
  const capped = [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 80);
  await Preferences.set({
    key: SESSIONS_KEY,
    value: JSON.stringify(capped),
  });
}

export async function loadActiveSessionIds(): Promise<ActiveMap> {
  try {
    const { value } = await Preferences.get({ key: ACTIVE_KEY });
    if (!value) return {};
    return JSON.parse(value) as ActiveMap;
  } catch {
    return {};
  }
}

export async function saveActiveSessionIds(map: ActiveMap): Promise<void> {
  await Preferences.set({
    key: ACTIVE_KEY,
    value: JSON.stringify(map),
  });
}

export function sortSessionsForDrawer(
  sessions: QortinoChatSession[],
  mode: QortinoChatMode
): QortinoChatSession[] {
  return sessions
    .filter((s) => s.mode === mode)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
}
