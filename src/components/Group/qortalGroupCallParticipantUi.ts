import { getBaseApiReactForAvatar } from '../../App';
import {
  buildQdnAvatarUrl,
  QDN_AVATAR_DEFAULT_IDENTIFIER,
  useQdnAvatar,
} from '../../lib/qdnAvatars';
import { getQdnAvatarCache } from '../../lib/qdnAvatars/defaultCache';

export function shortAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function initialsFromDisplayLabel(label: string, address: string): string {
  const compact = label.replace(/[^a-zA-Z0-9]/g, '');
  if (compact.length >= 2) return compact.slice(0, 2).toUpperCase();
  return address.slice(0, 2).toUpperCase();
}

export function addrHue(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) {
    h = (h * 31 + addr.charCodeAt(i)) & 0xffff;
  }
  return `hsl(${h % 360}, 58%, 46%)`;
}

export function registeredNameForAvatar(
  address: string,
  isSelf: boolean,
  memberPrimaryNames: Record<string, string>,
  selfRegisteredName: string | undefined
): string | undefined {
  const fromList = memberPrimaryNames[address]?.trim();
  if (fromList) return fromList;
  if (isSelf) return selfRegisteredName?.trim() || undefined;
  return undefined;
}

const pendingAvatarLookups = new Set<string>();

/**
 * Asks the cache for the avatar after the current render: a lookup can start
 * a fetch and notify other components showing the same name, which React
 * does not allow while rendering.
 */
function requestAvatarAfterRender(name: string): void {
  if (pendingAvatarLookups.has(name)) return;
  pendingAvatarLookups.add(name);
  queueMicrotask(() => {
    pendingAvatarLookups.delete(name);
    try {
      const cache = getQdnAvatarCache();
      const key = cache.keyFor(name);
      cache.request(key, { name, priority: 'normal' });
      cache.noteUse(key);
    } catch {
      // the node URL is still shown
    }
  });
}

const nodeAvatarUrl = (name: string) =>
  buildQdnAvatarUrl(getBaseApiReactForAvatar(), {
    name,
    identifier: QDN_AVATAR_DEFAULT_IDENTIFIER,
  });

/**
 * Avatar src for a call participant, for code that cannot use a hook. Not
 * reactive, so it never leaves a caller waiting for a re-render: the cached
 * copy (or bundled seed) when there is one, undefined when the node said the
 * name has no avatar (show the initials), otherwise the node URL as before
 * (the <img> loads it itself while the cache fetches its own copy for next
 * time). Safe to call while rendering: the cache lookup runs after it.
 * Prefer useQortalAvatarThumbnailSrc in components.
 */
export function qortalAvatarThumbnailSrc(
  registeredName: string | undefined
): string | undefined {
  const n = typeof registeredName === 'string' ? registeredName.trim() : '';
  if (!n) return undefined;
  try {
    // A plain read: the src is not pinned, the next render reads again.
    const cache = getQdnAvatarCache();
    const snapshot = cache.getSnapshot(cache.keyFor(n));
    requestAvatarAfterRender(n);
    if (snapshot.src) return snapshot.src;
    if (snapshot.status === 'missing') return undefined;
  } catch {
    // no cache: the node URL
  }
  return nodeAvatarUrl(n);
}

/**
 * Hook form: the cached avatar (or bundled seed) for a participant, updated
 * when the image arrives; undefined means show the initials.
 */
export function useQortalAvatarThumbnailSrc(
  registeredName: string | null | undefined
): string | undefined {
  return useQdnAvatar(registeredName).src;
}
