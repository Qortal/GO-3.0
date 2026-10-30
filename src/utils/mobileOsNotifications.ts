import { LocalNotifications } from '@capacitor/local-notifications';
import { QortalBackground } from '../plugins/QortalBackground';
import { isCapacitor } from './platform';
import { fetchChatAvatarDataUrl } from './chatAvatarUrl';
import { parseQdnThumbnailRef } from './qdnThumbnailRef';
import { hashNotificationId } from './reticulumChatAlerts';

type OsNotificationOptions = {
  title: string;
  body: string;
  id?: string;
  iconUrl?: string;
  fromAddress?: string;
  notificationType?: 'direct' | 'group' | 'general' | 'payment';
  onClick?: () => void;
};

let channelsReady = false;

/** How long a notification waits for an avatar the device does not have. */
export const NOTIFICATION_AVATAR_WAIT_MS = 4_000;

// Intent extras ride a binder transaction (~1MB cap shared with the rest of
// the intent); only inline reasonably-sized avatars.
const MAX_INLINE_ICON_CHARS = 300_000;

const inlineable = (dataUrl: string | null | undefined): string | undefined =>
  dataUrl?.startsWith('data:') && dataUrl.length <= MAX_INLINE_ICON_CHARS
    ? dataUrl
    : undefined;

/**
 * Icon for a native notification, resolved in the WebView: the native
 * service's own HTTP client cannot always reach the node (base URL + apiKey),
 * so the icon goes over as a data URL the native side just decodes.
 *
 * A QDN avatar (user, Q-App or group) comes from the device's avatar cache:
 * the cached image at once, otherwise a short wait for the node, otherwise a
 * bundled icon. When none is ready the raw URL is kept for the native side to
 * try; it is dropped when the node confirmed there is no avatar. Other URLs
 * are fetched directly as before.
 */
export async function resolveNotificationIconUrl(
  iconUrl: string | undefined
): Promise<string | undefined> {
  if (!iconUrl || !/^https?:\/\//i.test(iconUrl)) return iconUrl;

  const avatar = parseQdnThumbnailRef(iconUrl);
  if (avatar) {
    try {
      // Loaded on demand: background.ts imports this module, and the cache
      // reads the node URL from globalApi, which imports background.ts.
      const avatars = await import('../lib/qdnAvatars');
      const options = { identifier: avatar.identifier };
      const dataUrl = inlineable(
        await avatars.getQdnAvatarDataUrl(avatar.name, {
          ...options,
          timeoutMs: NOTIFICATION_AVATAR_WAIT_MS,
        })
      );
      if (dataUrl) return dataUrl;
      const { status } = avatars.getQdnAvatarSnapshot(avatar.name, options);
      if (status === 'missing') return undefined;
    } catch {
      /* keep the raw URL */
    }
    return iconUrl;
  }

  try {
    return inlineable(await fetchChatAvatarDataUrl(iconUrl)) ?? iconUrl;
  } catch {
    /* keep the raw URL; native side will retry its own fetch */
    return iconUrl;
  }
}

const ensureNotificationChannels = async (): Promise<void> => {
  if (!isCapacitor() || channelsReady) return;

  await LocalNotifications.createChannel({
    id: 'qortal_alerts',
    name: 'Qortal alerts',
    description: 'New messages and Qortal alerts',
    importance: 4,
    visibility: 1,
  });
  await LocalNotifications.createChannel({
    id: 'qortal_alerts_pm',
    name: 'Private messages',
    description: 'Private (direct) chat messages',
    importance: 4,
    visibility: 1,
  });
  await LocalNotifications.createChannel({
    id: 'qortal_alerts_group',
    name: 'Group messages',
    description: 'Group chat messages and mentions',
    importance: 4,
    visibility: 1,
  });
  // No 'qortal_calls' channel: calls ring on the native call channels
  // (CallNotifications.java), and the native service deletes the old one.

  channelsReady = true;
};

export const showOsNotification = async ({
  title,
  body,
  id,
  iconUrl,
  fromAddress,
  notificationType,
}: OsNotificationOptions): Promise<void> => {
  if (!isCapacitor()) {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const notification = new window.Notification(title, {
        body,
        icon: iconUrl || `${window.location.origin}/qortal192.png`,
        data: { id },
      });
      window.setTimeout(() => notification.close(), 10000);
    }
    return;
  }

  try {
    await ensureNotificationChannels();
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== 'granted') {
      const requested = await LocalNotifications.requestPermissions();
      if (requested.display !== 'granted') {
        return;
      }
    }

    const alertId = hashNotificationId(id || `${title}:${body}:${Date.now()}`);

    const resolvedIconUrl = await resolveNotificationIconUrl(iconUrl);

    await QortalBackground.showAlertNotification({
      alertId,
      // A stable id doubles as the Android notification tag, so re-showing
      // the same conversation updates one tray entry and it can be cancelled
      // later by key (see dismissChatOsNotification).
      alertTag: id || undefined,
      title,
      body,
      iconUrl: resolvedIconUrl,
      fromAddress,
      notificationType,
    });
  } catch (error) {
    console.error(
      '[mobileOsNotifications] Failed to show alert notification',
      error
    );
  }
};

export const showIncomingCallOsNotification = async ({
  callId,
  fromAddress,
  fromName,
}: {
  callId: string;
  fromAddress: string;
  fromName: string;
}): Promise<void> => {
  if (!isCapacitor()) return;

  try {
    await ensureNotificationChannels();
    await QortalBackground.showIncomingCallNotification({
      callId,
      fromAddress,
      fromName,
    });
  } catch (error) {
    console.error(
      '[mobileOsNotifications] Failed to show incoming call notification',
      error
    );
  }
};

export const dismissIncomingCallOsNotification = async (): Promise<void> => {
  if (!isCapacitor()) return;

  try {
    await QortalBackground.dismissIncomingCallNotification();
  } catch (error) {
    console.error(
      '[mobileOsNotifications] Failed to dismiss incoming call notification',
      error
    );
  }
};

/**
 * Cancel one Group/DM tray notification by its stable alert key (the `id`
 * it was shown with). Best effort: never throws, no-op off native.
 */
export const dismissChatOsNotification = async (
  alertKey: string
): Promise<void> => {
  if (!isCapacitor() || !alertKey) return;

  try {
    await QortalBackground.dismissChatAlertNotification({
      alertId: hashNotificationId(alertKey),
      alertTag: alertKey,
    });
  } catch (error) {
    console.error(
      '[mobileOsNotifications] Failed to dismiss chat alert notification',
      error
    );
  }
};

/** Remove Group/DM OS tray notifications (e.g. after opening a chat or mark-all-read). */
export const dismissChatOsNotifications = async (): Promise<void> => {
  if (!isCapacitor()) return;

  try {
    await QortalBackground.dismissChatAlertNotifications();
  } catch (error) {
    console.error(
      '[mobileOsNotifications] Failed to dismiss chat alert notifications',
      error
    );
  }
};
