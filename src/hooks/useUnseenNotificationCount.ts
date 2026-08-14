import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import {
  isNotificationSeenInAppFromKeyTimes,
  lastPaymentSeenTimestampAtom,
  notificationSeenInAppKeyTimesAtom,
  paymentNotificationsAtom,
} from '../atoms/global';
import {
  appUpdateReleaseAtom,
  appUpdateSeenVersionAtom,
} from '../appUpdate/appUpdateAtoms';

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
  const updateRelease = useAtomValue(appUpdateReleaseAtom);
  const updateSeenVersion = useAtomValue(appUpdateSeenVersionAtom);
  // A published app update is unread until the panel holding it is opened.
  const updateUnseen = Boolean(
    updateRelease && updateSeenVersion !== updateRelease.version
  );

  const resourceNotifications = useMemo(
    () =>
      (notifications ?? []).filter((item) => item?.event === RESOURCE_EVENT),
    [notifications]
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

  const total = unseenCount + (updateUnseen ? 1 : 0);

  return {
    hasNewNotifications: total > 0,
    unseenCount: total,
  };
}
