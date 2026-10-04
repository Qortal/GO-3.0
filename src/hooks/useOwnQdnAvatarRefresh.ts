import { useEffect } from 'react';
import {
  qdnAvatarKey,
  refreshQdnAvatar,
  type QdnAvatarKey,
  type QdnAvatarStatus,
} from '../lib/qdnAvatars';
import { getQdnAvatarCache } from '../lib/qdnAvatars/defaultCache';

// Own avatars already checked on the node in this app session.
const checkedThisSession = new Set<string>();

// App start (this module loads with the first avatar component).
let sessionStartMs = Date.now();

type DebugMeta = {
  key?: string;
  fetchedAt?: number;
  missingCheckedAt?: number;
};

/**
 * True when the cache itself asked the node for `key` in this app session:
 * a fetch is queued or running, the last one failed (in-memory backoff), or
 * an answer arrived after app start. Then a refresh would only fetch the
 * same file a second time.
 *
 * TODO(core): the cache has no public "checked since" yet; this reads its
 * diagnostic view, like prewarmRuntime does. Unknown shape = not checked
 * (refresh as before).
 */
function nodeAskedThisSession(key: QdnAvatarKey): boolean {
  try {
    const cache = getQdnAvatarCache();
    const state =
      typeof cache.debugState === 'function' ? cache.debugState() : null;
    if (!state) return false;
    if (Array.isArray(state.active) && state.active.includes(key)) return true;
    if (
      Array.isArray(state.queued) &&
      state.queued.some((job) => job?.key === key)
    ) {
      return true;
    }
    if (
      Array.isArray(state.failures) &&
      state.failures.some((entry) => Array.isArray(entry) && entry[0] === key)
    ) {
      return true;
    }
    const meta = Array.isArray(state.metas)
      ? (state.metas as DebugMeta[]).find((item) => item?.key === key)
      : undefined;
    if (!meta) return false;
    const answeredAt = Math.max(
      Number(meta.fetchedAt) || 0,
      Number(meta.missingCheckedAt) || 0
    );
    return answeredAt >= sessionStartMs;
  } catch {
    return false;
  }
}

/**
 * The user's own avatar can change outside GO's publish dialogs (a Q-App,
 * another device, Hub). Asks the node for it again once per app session,
 * after the cache has answered from the device (status 'ready' or
 * 'missing'), so the cached image stays on screen meanwhile. Skipped when the
 * cache already asked the node in this session (no device copy, a stale copy
 * being refreshed, or a failure in backoff). True when a refresh was started.
 */
export function refreshOwnQdnAvatarOnce(
  name: string | null | undefined,
  status: QdnAvatarStatus
): boolean {
  try {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || (status !== 'ready' && status !== 'missing')) return false;
    const key = qdnAvatarKey(trimmed);
    if (!key || checkedThisSession.has(key)) return false;
    checkedThisSession.add(key);
    if (nodeAskedThisSession(key)) return false;
    refreshQdnAvatar(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Call after putting a just-published own avatar into the cache: a node
 * that has not caught up yet would hand back the old file.
 */
export function markOwnQdnAvatarChecked(name: string | null | undefined) {
  try {
    const key = qdnAvatarKey(typeof name === 'string' ? name.trim() : '');
    if (key) checkedThisSession.add(key);
  } catch {
    // ignore
  }
}

/** refreshOwnQdnAvatarOnce for a component showing the own avatar. */
export function useOwnQdnAvatarRefresh(
  name: string | null | undefined,
  status: QdnAvatarStatus,
  enabled = true
) {
  useEffect(() => {
    if (enabled) refreshOwnQdnAvatarOnce(name, status);
  }, [enabled, name, status]);
}

/** Tests only. `sessionStartMs`: app start on the test clock. */
export function resetOwnQdnAvatarRefreshForTests(
  options: { sessionStartMs?: number } = {}
) {
  checkedThisSession.clear();
  sessionStartMs = options.sessionStartMs ?? Date.now();
}
