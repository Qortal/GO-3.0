import { LocalNotifications } from '@capacitor/local-notifications';
import { QortalBackground } from '../plugins/QortalBackground';
import { isCapacitor } from './platform';
import { fetchChatAvatarDataUrl } from './chatAvatarUrl';
import { chatAlertIdFromKey, hashNotificationId } from './reticulumChatAlerts';

type OsNotificationOptions = {
  title: string;
  body: string;
  id?: string;
  iconUrl?: string;
  fromAddress?: string;
  notificationType?: 'direct' | 'group' | 'general';
  onClick?: () => void;
};

let channelsReady = false;

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
  await LocalNotifications.createChannel({
    id: 'qortal_calls',
    name: 'Incoming calls',
    description: 'Incoming voice calls',
    importance: 5,
    visibility: 1,
  });

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

    // Resolve the sender avatar in the WebView: this fetch goes through the
    // app's existing node connection (base URL + apiKey), which the native
    // service's own HTTP client cannot always reach. The native side then just
    // decodes the data-URL. The raw URL is kept as a native-side fallback.
    let resolvedIconUrl = iconUrl;
    if (iconUrl && /^https?:\/\//i.test(iconUrl)) {
      try {
        const dataUrl = await fetchChatAvatarDataUrl(iconUrl);
        // Intent extras ride a binder transaction (~1MB cap shared with the
        // rest of the intent); only inline reasonably-sized avatars.
        if (dataUrl && dataUrl.length <= 300_000) {
          resolvedIconUrl = dataUrl;
          console.log('[mobileOsNotifications] avatar inlined as data URL');
        } else {
          console.log(
            '[mobileOsNotifications] avatar not inlined (size or fetch), using raw URL'
          );
        }
      } catch {
        /* keep the raw URL; native side will retry its own fetch */
      }
    }

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
      alertId: chatAlertIdFromKey(alertKey),
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
