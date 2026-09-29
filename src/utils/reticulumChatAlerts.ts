/**
 * Stable identities for Reticulum chat OS alerts (DM / mention) and a
 * registry of the alerts this device has actually shown.
 *
 * The alert key is what both platforms use to update or cancel a tray entry:
 * on Android it becomes the notification tag (+ hashed id), on desktop it is
 * the key of the live `Notification` map in `background.ts`. Because keys are
 * stable per conversation, the tray entry can be cancelled when the chat is
 * read on another device (`read_sync`), without knowing which event fired it.
 */

export const reticulumDmAlertKey = (peerAddress: string): string =>
  `reticulum-dm:${peerAddress}`;

export const reticulumMentionAlertKey = (groupId: number | string): string =>
  `reticulum-mention:${groupId}`;

/**
 * Deterministic small integer for an Android notification id. Kept identical
 * to the historical `mobileOsNotifications` hash so ids stay stable across
 * releases (`h = (h * 31 + charCode) >>> 0`, then `h % 90000 + 1000`).
 */
export const hashNotificationId = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return (hash % 90000) + 1000;
};

export const chatAlertIdFromKey = (key: string): number =>
  hashNotificationId(key);

const shownAlertKeys = new Set<string>();

export const rememberShownAlert = (key: string): void => {
  if (!key) return;
  shownAlertKeys.add(key);
};

export const forgetShownAlert = (key: string): void => {
  shownAlertKeys.delete(key);
};

export const wasAlertShown = (key: string): boolean => shownAlertKeys.has(key);

export const listShownAlertKeys = (): string[] => Array.from(shownAlertKeys);

export type AlertDismissHandlers = {
  isNative: boolean;
  /** Cancel the Android tray entry for this key (best effort). */
  dismissNative: (alertKey: string) => void;
  /** Close the desktop `Notification` shown for this key, if still open. */
  closeDesktop: (alertKey: string) => void;
};

/**
 * Core of `dismissOsNotificationByKey` (kept here so it is unit-testable
 * without loading `background.ts`). No-op unless the key was shown on this
 * device; forgets the key afterwards either way. Returns whether a dismiss
 * was attempted.
 */
export const dismissShownAlert = (
  alertKey: string,
  handlers: AlertDismissHandlers
): boolean => {
  if (!alertKey || !wasAlertShown(alertKey)) return false;
  try {
    if (handlers.isNative) {
      handlers.dismissNative(alertKey);
    } else {
      handlers.closeDesktop(alertKey);
    }
  } catch (error) {
    console.error('[reticulumChatAlerts] Failed to dismiss alert', error);
  } finally {
    forgetShownAlert(alertKey);
  }
  return true;
};
