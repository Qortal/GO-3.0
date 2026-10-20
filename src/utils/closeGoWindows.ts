import { useEffect, useRef } from 'react';
import { executeEvent, subscribeToEvent, unsubscribeFromEvent } from './events';

/**
 * Something from outside GO takes the user to a screen (a share from another
 * app opens the chat lists). GO's own windows over the sections (Tabs,
 * Settings, the account panel, viewers, sheets) close then, so that screen is
 * what they see. Windows waiting for an answer (Q-App approvals, payments),
 * calls and the Qortal Card stay.
 */
export const CLOSE_GO_WINDOWS_EVENT = 'go-close-windows';

export function closeGoWindows(): void {
  executeEvent(CLOSE_GO_WINDOWS_EVENT, {});
}

/** For a window: `close` runs on closeGoWindows() while `open`. */
export function useCloseWithGoWindows(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return undefined;
    const onClose = () => closeRef.current();
    subscribeToEvent(CLOSE_GO_WINDOWS_EVENT, onClose);
    return () => unsubscribeFromEvent(CLOSE_GO_WINDOWS_EVENT, onClose);
  }, [open]);
}
