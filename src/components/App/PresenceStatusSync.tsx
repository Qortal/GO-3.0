import { useAtomValue } from 'jotai';
import { useEffect, useRef } from 'react';
import { reticulumChatEnabledAtom } from '../../atoms/global';
import type { SelectableStatus } from '../../atoms/presence';
import { useMyStatus } from '../../hooks/usePresence';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import {
  PRESENCE_STATUS_CHOSEN_EVENT,
  PresenceStatusSyncController,
} from '../../utils/presenceStatusSync';

/**
 * Mounted once for the authenticated user. Keeps the status picked in the
 * status picker (Online / Busy / Offline) the same on the account's own
 * devices, GO and Hub; see `utils/presenceStatusSync.ts`.
 */
export function PresenceStatusSync({
  myAddress,
}: {
  myAddress?: string | null;
}) {
  const reticulumChatEnabled = useAtomValue(reticulumChatEnabledAtom);
  const [myStatus, setMyStatus] = useMyStatus();
  const myStatusRef = useRef(myStatus);
  const setMyStatusRef = useRef(setMyStatus);
  myStatusRef.current = myStatus;
  setMyStatusRef.current = setMyStatus;

  useEffect(() => {
    const chat = window.reticulumChat;
    if (!myAddress || !reticulumChatEnabled || !chat?.setDeviceState) return;
    const controller = new PresenceStatusSyncController({
      address: myAddress,
      chat,
      getStatus: () => myStatusRef.current,
      applyStatus: (status) => setMyStatusRef.current(status),
    });
    const onChosen = (event: CustomEvent<{ status?: SelectableStatus }>) => {
      const status = event.detail?.status;
      if (status) controller.onLocalChoice(status);
    };
    subscribeToEvent(PRESENCE_STATUS_CHOSEN_EVENT, onChosen);
    controller.start();
    return () => {
      unsubscribeFromEvent(PRESENCE_STATUS_CHOSEN_EVENT, onChosen);
      controller.dispose();
    };
  }, [myAddress, reticulumChatEnabled]);

  return null;
}
