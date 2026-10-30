/**
 * Persisted Qortino chat sessions (Offline + QDN), with pin + rename.
 */
import { Preferences } from '@capacitor/preferences';

const SESSIONS_KEY = 'qortino_chat_sessions_v1';
const ACTIVE_KEY = 'qortino_chat_active_v1';

type QortinoChatMode = 'offline' | 'qdn';

/** Serializable bubble — mirrors chat UI fields we care to restore. */
export type StoredChatBubble = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  profiles?: Array<{
    name: string;
    address: string;
    level: number;
    tags: string[];
    avatarUrl: string;
    description?: string;
    characterSummary?: string;
    nameRole?: 'primary' | 'secondary';
    primaryName?: string;
  }>;
  media?: unknown[];
  mediaLayout?: 'grid' | 'list';
  links?: unknown[];
  apps?: unknown[];
  publishedSites?: Array<{
    service: 'APP' | 'WEBSITE';
    name: string;
    title: string;
    avatarUrl: string;
  }>;
  quitterPosts?: Array<{
    name: string;
    identifier: string;
    text: string;
    created?: number;
  }>;
  ownedNames?: unknown[];
  nudgeQdn?: boolean;
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

function newId(): string {
  return `qchat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function titleFromMessages(messages: StoredChatBubble[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
  if (!firstUser) return 'New chat';
  const t = firstUser.content.replace(/\s+/g, ' ').trim();
  return t.length > 42 ? `${t.slice(0, 42)}…` : t;
}

export function createEmptySession(mode: QortinoChatMode): QortinoChatSession {
  const now = Date.now();
  return {
    id: newId(),
    title: 'New chat',
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
