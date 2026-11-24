import { useSyncExternalStore } from 'react';
import { isCapacitor } from '../utils/platform';
import {
  isRingWakeUnattended,
  subscribeRingWakeAttention,
} from '../utils/ringWakeAttention';

/**
 * Whether the user can see GO, for work that must stop while GO is off
 * screen (read marking). Native only: the phone's keep-alive holds the page
 * visible to Chromium in the background, and capacitorBridge makes
 * document.hidden follow Android instead (with a visibilitychange on every
 * edge). An incoming call that woke GO does not count as the user looking
 * until they touch it (utils/ringWakeAttention). Desktop and web always
 * report true, so their behaviour is unchanged.
 */
function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  const offRingWake = subscribeRingWakeAttention(onChange);
  return () => {
    document.removeEventListener('visibilitychange', onChange);
    offRingWake();
  };
}

const getSnapshot = (): boolean =>
  !isCapacitor() || (!document.hidden && !isRingWakeUnattended());

const getServerSnapshot = (): boolean => true;

export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
