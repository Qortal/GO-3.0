import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import {
  isNotificationPanelDismissed,
  isNotificationSeenInAppFromKeyTimes,
  lastPaymentSeenTimestampAtom,
  notificationPanelDismissalsAtom,
  notificationSeenInAppKeyTimesAtom,
  paymentNotificationsAtom,
} from '../atoms/global';

const RESOURCE_EVENT = 'RESOURCE_PUBLISHED';

function toTimestampMs(value: unknown): number | null {
  if (value == null || typeof value !== 'number') return null;
  return value < 1e12 ? value * 1000 : value;
}

function getNotificationTimestamp(notification: {
  data?: { created?: number; timestamp?: number };
  timestamp?: number;
}) {
  return toTimestampMs(
    notification?.data?.created ??
      notification?.data?.timestamp ??
      notification?.timestamp
  );
}

export function useUnseenNotificationCount() {
  const notifications = useAtomValue(paymentNotificationsAtom);
  const lastSeenTimestamp = useAtomValue(lastPaymentSeenTimestampAtom);
  const seenInAppKeyTimes = useAtomValue(notificationSeenInAppKeyTimesAtom);
  const panelDismissals = useAtomValue(notificationPanelDismissalsAtom);

  const resourceNotifications = useMemo(
    () =>
      (notifications ?? []).filter(
        (item) =>
          item?.event === RESOURCE_EVENT &&
          !isNotificationPanelDismissed(item, panelDismissals)
      ),
    [notifications, panelDismissals]
  );

  const unseenCount = useMemo(() => {
    return resourceNotifications.filter((notification) => {
      const timestamp = getNotificationTimestamp(notification);
      if (timestamp == null) return false;
      if (
        isNotificationSeenInAppFromKeyTimes(notification, seenInAppKeyTimes)
      ) {
        return false;
      }
      return !lastSeenTimestamp || timestamp > lastSeenTimestamp;
    }).length;
  }, [resourceNotifications, seenInAppKeyTimes, lastSeenTimestamp]);

  // App updates are not counted here: they have their own GO 3.0 Updates
  // screen and their own marker on the account button.
  return {
    hasNewNotifications: unseenCount > 0,
    unseenCount,
  };
}
