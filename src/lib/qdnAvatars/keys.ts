/**
 * Keys and node URLs for QDN avatar images.
 *
 * Every avatar is a QDN resource: THUMBNAIL/<name>/<identifier>. Users, Q-Apps
 * and QDN websites use the identifier `qortal_avatar`; group avatars are
 * published by the group owner as `qortal_group_avatar_<groupId>`.
 */

const QDN_AVATAR_SERVICE = 'THUMBNAIL';
export const QDN_AVATAR_DEFAULT_IDENTIFIER = 'qortal_avatar';

/** Normalised cache key, e.g. `THUMBNAIL/q-tube/qortal_avatar`. */
export type QdnAvatarKey = string;

export type QdnAvatarRef = {
  /** Registered Qortal name as the caller spelled it (used in node URLs). */
  name: string;
  identifier: string;
};

/** Identifier of a group's avatar, published by the group owner. */
export function qdnGroupAvatarIdentifier(groupId: string | number): string {
  return `qortal_group_avatar_${String(groupId).trim()}`;
}

/** Trimmed name, or '' when the value is not a usable name. */
export function cleanQdnName(name: unknown): string {
  return typeof name === 'string' ? name.trim() : '';
}

function cleanIdentifier(identifier: unknown): string {
  if (typeof identifier !== 'string') return QDN_AVATAR_DEFAULT_IDENTIFIER;
  return identifier.trim() || QDN_AVATAR_DEFAULT_IDENTIFIER;
}

/**
 * Cache key for one avatar resource, or null without a name. Qortal names are
 * case-insensitive (the node serves `q-tube` and `Q-Tube` alike), so the name
 * is lower-cased; identifiers are kept as published.
 */
export function qdnAvatarKey(
  name: string | null | undefined,
  identifier?: string | null
): QdnAvatarKey | null {
  const cleaned = cleanQdnName(name);
  if (!cleaned) return null;
  return `${QDN_AVATAR_SERVICE}/${encodeURIComponent(
    cleaned.toLowerCase()
  )}/${encodeURIComponent(cleanIdentifier(identifier))}`;
}

/** Name + identifier for a key. The name comes back lower-cased. */
export function parseQdnAvatarKey(key: string): QdnAvatarRef | null {
  if (typeof key !== 'string') return null;
  const parts = key.split('/');
  if (parts.length !== 3 || parts[0] !== QDN_AVATAR_SERVICE) return null;
  try {
    const name = decodeURIComponent(parts[1]);
    const identifier = decodeURIComponent(parts[2]);
    if (!name || !identifier) return null;
    return { name, identifier };
  } catch {
    return null;
  }
}

/**
 * Node URL for an avatar. `blocking: false` adds `async=true`: the node answers
 * at once (404 while it still fetches the file from the network);
 * `blocking: true` waits until the node has the file or gives up.
 */
export function buildQdnAvatarUrl(
  apiBase: string,
  ref: QdnAvatarRef,
  options: { blocking?: boolean } = {}
): string {
  const base = (apiBase || '').replace(/\/+$/, '');
  const url = `${base}/arbitrary/${QDN_AVATAR_SERVICE}/${encodeURIComponent(
    ref.name
  )}/${encodeURIComponent(ref.identifier)}`;
  return options.blocking ? url : `${url}?async=true`;
}

/**
 * Resource status URL. Answers at once, also on a slow node: `NOT_PUBLISHED`
 * means the name never published this avatar. Without `build=true` it does not
 * start a download.
 */
export function buildQdnAvatarStatusUrl(
  apiBase: string,
  ref: QdnAvatarRef
): string {
  const base = (apiBase || '').replace(/\/+$/, '');
  return `${base}/arbitrary/resource/status/${QDN_AVATAR_SERVICE}/${encodeURIComponent(
    ref.name
  )}/${encodeURIComponent(ref.identifier)}`;
}
