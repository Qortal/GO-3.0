import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  DRAFTS_CHANGED_EVENT,
  getDraftsRaw,
  isEmptyChatHtml,
} from '../utils/chatPersistence';

/** The keys holding a non-empty draft, sorted, one per line. */
function draftKeysSnapshot(raw: string): string {
  if (!raw) return '';
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    return Object.keys(map)
      .filter((key) => !isEmptyChatHtml(map[key]))
      .sort()
      .join('\n');
  } catch {
    return ''; // malformed
  }
}

/**
 * Reactive set of draft keys (e.g. "group:0", "group:12/ch-…" for a channel,
 * "direct:Qxyz...") that currently hold a non-empty unsent draft for the given
 * account. Updates whenever a draft appears or goes (same tab via the custom
 * event, other tabs via storage); typing on in a draft re-renders nobody.
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

  // Parsed once per stored version, not on every render.
  const lastRef = useRef<{ raw: string; keys: string } | null>(null);
  const getSnapshot = useCallback(() => {
    const raw = getDraftsRaw(account);
    if (lastRef.current?.raw !== raw) {
      lastRef.current = { raw, keys: draftKeysSnapshot(raw) };
    }
    return lastRef.current.keys;
  }, [account]);
  const keys = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(() => new Set(keys ? keys.split('\n') : []), [keys]);
}
