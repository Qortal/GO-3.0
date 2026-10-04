import {
  buildQdnAvatarUrl,
  qdnAvatarKey,
  qdnGroupAvatarIdentifier,
  QDN_AVATAR_DEFAULT_IDENTIFIER,
} from '../../lib/qdnAvatars';

/**
 * Full-size avatar URLs on the node, for the tap-to-enlarge preview. Lists
 * show the cached copy (at most 128 px); the preview asks the node for the
 * original. Blocking (no `async=true`), so a slow node still answers with the
 * image instead of an empty 404.
 */

const cleanName = (name: unknown) =>
  typeof name === 'string' ? name.trim() : '';

export function buildUserAvatarPreviewUrl(
  apiBase: string,
  name: string | null | undefined
): string | null {
  const cleaned = cleanName(name);
  if (!cleaned || !apiBase) return null;
  return buildQdnAvatarUrl(
    apiBase,
    { name: cleaned, identifier: QDN_AVATAR_DEFAULT_IDENTIFIER },
    { blocking: true }
  );
}

export function buildGroupAvatarPreviewUrl(
  apiBase: string,
  ownerName: string | null | undefined,
  groupId: string | number | null | undefined
): string | null {
  const cleaned = cleanName(ownerName);
  if (!cleaned || !apiBase || groupId == null) return null;
  if (String(groupId).trim() === '') return null;
  return buildQdnAvatarUrl(
    apiBase,
    { name: cleaned, identifier: qdnGroupAvatarIdentifier(groupId) },
    { blocking: true }
  );
}

/**
 * For this long after the user published an avatar from this device, the
 * node (and the WebView's HTTP cache) may still serve the old file, so the
 * preview keeps the cached copy, which is already the new image. Same as the
 * avatar cache's own re-check after a publish.
 */
export const PUBLISHED_AVATAR_SETTLE_MS = 10 * 60 * 1000;

/** Avatars published from this device in this session: cache key -> time. */
const publishedHere = new Map<string, number>();

export function noteAvatarPublishedHere(
  name: string | null | undefined,
  identifier?: string | null,
  at = Date.now()
): void {
  const key = qdnAvatarKey(name, identifier);
  if (key) publishedHere.set(key, at);
}

/** Tests only. */
export function resetAvatarPublishesForTests(): void {
  publishedHere.clear();
}

/** Cache key of a node avatar URL made by buildQdnAvatarUrl, or null. */
function avatarKeyFromNodeUrl(url: string): string | null {
  const match = /\/arbitrary\/THUMBNAIL\/([^/?#]+)\/([^/?#]+)/.exec(url);
  if (!match) return null;
  try {
    return qdnAvatarKey(
      decodeURIComponent(match[1]),
      decodeURIComponent(match[2])
    );
  } catch {
    return null;
  }
}

/**
 * Where to load a full-size avatar from. null while an avatar the user just
 * published from this device may not have reached the node yet (keep the
 * cached copy). A version parameter is added after such a publish, or when
 * `reload` is set (the cached copy changed since the last full-size load), so
 * the WebView does not reuse the old file from its HTTP cache.
 */
export function fullSizeAvatarRequestUrl(
  fullUrl: string,
  options: { reload?: number; now?: number } = {}
): string | null {
  const key = avatarKeyFromNodeUrl(fullUrl);
  const publishedAt = key ? publishedHere.get(key) : undefined;
  const now = options.now ?? Date.now();
  if (publishedAt != null && now - publishedAt < PUBLISHED_AVATAR_SETTLE_MS) {
    return null;
  }
  const parts: string[] = [];
  if (publishedAt != null) parts.push(String(publishedAt));
  if (options.reload) parts.push(`r${options.reload}`);
  if (!parts.length) return fullUrl;
  const separator = fullUrl.includes('?') ? '&' : '?';
  return `${fullUrl}${separator}v=${parts.join('-')}`;
}
