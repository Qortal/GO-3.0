import { useEffect } from 'react';
import { useVoiceCallContext } from '../../context/VoiceCallContext';
import { QortalBackground } from '../../plugins/QortalBackground';
import {
  dismissIncomingCallOsNotification,
  showIncomingCallOsNotification,
} from '../../utils/mobileOsNotifications';
import { isCapacitor } from '../../utils/platform';

const shortenAddress = (address?: string) => {
  if (!address) return '';
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
};

export const MobileIncomingCallBridge = () => {
  const { callState, incomingCall, acceptCall, rejectCall } =
    useVoiceCallContext();

  useEffect(() => {
    if (!isCapacitor()) return undefined;

    let listenerHandle: { remove: () => void } | null = null;

    void QortalBackground.addListener('incomingCallAction', (event) => {
      if (event.action === 'accept') {
        void acceptCall();
      } else if (event.action === 'decline') {
        void rejectCall();
      }
    }).then((handle) => {
      listenerHandle = handle;
    });

    return () => {
      listenerHandle?.remove();
    };
  }, [acceptCall, rejectCall]);

  useEffect(() => {
    if (!isCapacitor()) return;

    if (callState === 'ringing' && incomingCall) {
      void showIncomingCallOsNotification({
        callId: incomingCall.callId,
        fromAddress: incomingCall.fromAddress,
        fromName: shortenAddress(incomingCall.fromAddress),
      });
      return;
    }

    void dismissIncomingCallOsNotification();
  }, [callState, incomingCall]);

  return null;
};

export default MobileIncomingCallBridge;
