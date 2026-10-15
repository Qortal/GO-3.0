import { QDN_AVATAR_DEFAULT_IDENTIFIER } from '../lib/qdnAvatars/keys';
import { pinNotificationToOwnerApp } from './notificationOwnerApp';
import { parseQdnThumbnailRef, type QdnThumbnailRef } from './qdnThumbnailRef';

export type NotificationAppIcon = {
  /** QDN avatar to show from the device cache. */
  avatar: QdnThumbnailRef | null;
  /** Any other image: a node URL, a bundled asset or an inline image. */
  src?: string;
};

const INLINE_IMAGE = /^(?:data:image\/|blob:)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:|^\/\//i;

/**
 * Icon of a bell notification: the app's QDN avatar (shown from the device
 * cache, so it does not depend on the node), another node image path, a
 * bundled asset or an inline image. Images on other hosts are dropped (they
 * could track the user). Q-Chat mentions have no app icon. A Q-App's icon
 * that names another app shows the Q-App's own avatar instead.
 */
export function getNotificationAppIcon(
  raw:
    | {
        event?: unknown;
        appName?: unknown;
        image?: unknown;
        data?: { name?: unknown } | null;
      }
    | null
    | undefined,
  options: { isQChatMention: boolean; getApiBase: () => string }
): NotificationAppIcon {
  if (options.isQChatMention) return { avatar: null };
  const notification = raw ? pinNotificationToOwnerApp(raw) : raw;
  const image =
    typeof notification?.image === 'string' ? notification.image.trim() : '';
  if (!image) {
    const appName =
      typeof notification?.appName === 'string' && notification.appName.trim()
        ? notification.appName.trim()
        : 'Q-Mail';
    return {
      avatar: { name: appName, identifier: QDN_AVATAR_DEFAULT_IDENTIFIER },
    };
  }
  const avatar = parseQdnThumbnailRef(image);
  if (avatar) return { avatar };
  if (INLINE_IMAGE.test(image)) return { avatar: null, src: image };
  let apiBase = '';
  try {
    apiBase = options.getApiBase() || '';
  } catch {
    apiBase = '';
  }
  if (HAS_SCHEME.test(image)) {
    // A full URL: only the user's own node is asked.
    return apiBase && image.startsWith(`${apiBase}/`)
      ? { avatar: null, src: image }
      : { avatar: null };
  }
  // Node API paths get the node base; anything else is an app asset
  // (e.g. the bundled Qortal logo) and stays as it is.
  if (!image.startsWith('/arbitrary/')) return { avatar: null, src: image };
  return apiBase
    ? { avatar: null, src: `${apiBase}${image}` }
    : { avatar: null };
}
