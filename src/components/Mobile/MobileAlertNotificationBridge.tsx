import { useEffect, useRef } from 'react';
import { QortalBackground } from '../../plugins/QortalBackground';
import { executeEvent } from '../../utils/events';
import { openQWalletsTab } from '../../utils/openQWalletsTab';
import { PAYMENT_ALERT_TYPE } from '../../utils/paymentNotifications';
import { isCapacitor } from '../../utils/platform';

const openDirectFromNotification = (fromAddress: string) => {
  const address = fromAddress?.trim();
  if (!address) return;
  executeEvent('openDirectMessage', { from: address });
};

/** `fromAddress` carries the group id for mention alerts. */
const openGroupFromNotification = (fromAddress: string) => {
  const groupId = fromAddress?.trim();
  if (!groupId) return;
  executeEvent('openGroupMessage', { from: groupId });
};

/** Routes a tapped tray alert; returns false when the type is not handled. */
const openFromAlert = (
  fromAddress: string | undefined,
  type: string | undefined
): boolean => {
  const target = fromAddress?.trim();
  if (!target) return false;
  if (type === 'direct') {
    openDirectFromNotification(target);
    return true;
  }
  if (type === 'group') {
    openGroupFromNotification(target);
    return true;
  }
  // `fromAddress` is the payer; the wallet shows the payment.
  if (type === PAYMENT_ALERT_TYPE) {
    openQWalletsTab();
    return true;
  }
  return false;
};

export const MobileAlertNotificationBridge = () => {
  const handledPendingRef = useRef(false);

  useEffect(() => {
    if (!isCapacitor()) return undefined;

    let listenerHandle: { remove: () => void } | null = null;

    const clearPending = async () => {
      try {
        await QortalBackground.clearPendingAlertNotification();
      } catch {
        // ignore — plugin may be unavailable during web dev
      }
    };

    const consumePending = async () => {
      if (handledPendingRef.current) return;
      try {
        const pending = await QortalBackground.getPendingAlertNotification();
        if (openFromAlert(pending?.fromAddress, pending?.type)) {
          handledPendingRef.current = true;
          await clearPending();
        }
      } catch {
        // ignore — plugin may be unavailable during web dev
      }
    };

    void QortalBackground.addListener('alertNotificationAction', (event) => {
      if (!openFromAlert(event.fromAddress, event.type)) return;
      handledPendingRef.current = true;
      void clearPending();
    }).then((handle) => {
      listenerHandle = handle;
      void consumePending();
    });

    return () => {
      listenerHandle?.remove();
    };
  }, []);

  return null;
};

export default MobileAlertNotificationBridge;
