// keys.ts has no imports: safe for modules that background.ts loads.
import { QDN_AVATAR_DEFAULT_IDENTIFIER } from '../lib/qdnAvatars/keys';

export type QdnThumbnailRef = { name: string; identifier: string };

const THUMBNAIL_PATH =
  /\/arbitrary\/THUMBNAIL\/([^/?#]+)\/([^/?#]+)\/?(?:[?#]|$)/;

/**
 * Name and identifier of a node THUMBNAIL URL or path, e.g.
 * `/arbitrary/THUMBNAIL/Q-Mail/qortal_avatar?async=true` or the full URL with
 * the node base, so it can be shown from the avatar cache. null when the URL
 * is something else.
 */
export function parseQdnThumbnailRef(
  url: string | null | undefined
): QdnThumbnailRef | null {
  if (typeof url !== 'string' || !url) return null;
  const match = THUMBNAIL_PATH.exec(url);
  if (!match) return null;
  try {
    const name = decodeURIComponent(match[1]).trim();
    const identifier =
      decodeURIComponent(match[2]).trim() || QDN_AVATAR_DEFAULT_IDENTIFIER;
    return name ? { name, identifier } : null;
  } catch {
    return null;
  }
}
