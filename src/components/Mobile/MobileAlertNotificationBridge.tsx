import { useEffect, useRef } from 'react';
import { QortalBackground } from '../../plugins/QortalBackground';
import { executeEvent } from '../../utils/events';
import { isCapacitor } from '../../utils/platform';

const openDirectFromNotification = (fromAddress: string) => {
  const address = fromAddress?.trim();
  if (!address) return;
  executeEvent('openDirectMessage', { from: address });
};

export const MobileAlertNotificationBridge = () => {
  const handledPendingRef = useRef(false);

  useEffect(() => {
    if (!isCapacitor()) return undefined;

    let listenerHandle: { remove: () => void } | null = null;

    const consumePending = async () => {
      if (handledPendingRef.current) return;
      try {
        const pending = await QortalBackground.getPendingAlertNotification();
        const fromAddress = pending?.fromAddress?.trim();
        if (fromAddress && pending?.type === 'direct') {
          handledPendingRef.current = true;
          openDirectFromNotification(fromAddress);
          await QortalBackground.clearPendingAlertNotification();
        }
      } catch {
        // ignore — plugin may be unavailable during web dev
      }
    };

    void QortalBackground.addListener('alertNotificationAction', (event) => {
      const fromAddress = event.fromAddress?.trim();
      if (!fromAddress || event.type !== 'direct') return;
      openDirectFromNotification(fromAddress);
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
