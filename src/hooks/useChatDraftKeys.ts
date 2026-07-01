import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  DRAFTS_CHANGED_EVENT,
  getDraftsRaw,
  isEmptyChatHtml,
} from '../utils/chatPersistence';

/**
 * Reactive set of draft keys (e.g. "group:0", "direct:Qxyz...") that currently
 * hold a non-empty unsent draft for the given account. Updates whenever a draft
 * is saved or cleared (same tab via the custom event, other tabs via storage).
 */
export function useChatDraftKeys(account?: string | null): Set<string> {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener(DRAFTS_CHANGED_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(DRAFTS_CHANGED_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  const getSnapshot = useCallback(() => getDraftsRaw(account), [account]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(() => {
    const keys = new Set<string>();
    if (!raw) return keys;
    try {
      const map = JSON.parse(raw) as Record<string, string>;
      for (const key of Object.keys(map)) {
        if (!isEmptyChatHtml(map[key])) keys.add(key);
      }
    } catch {
      /* ignore malformed */
    }
    return keys;
  }, [raw]);
}
