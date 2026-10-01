import { useSyncExternalStore } from 'react';
import { isCapacitor } from '../utils/platform';

/**
 * Whether the user can see GO, for work that must stop while GO is off
 * screen (read marking). Native only: the phone's keep-alive holds the page
 * visible to Chromium in the background, and capacitorBridge makes
 * document.hidden follow Android instead (with a visibilitychange on every
 * edge). Desktop and web always report true, so their behaviour is unchanged.
 */
function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

const getSnapshot = (): boolean => !isCapacitor() || !document.hidden;

const getServerSnapshot = (): boolean => true;

export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
