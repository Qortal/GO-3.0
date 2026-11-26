/**
 * Android replaced GO's default network: Wi-Fi and mobile data, or another
 * Wi-Fi. The phone stays "online" through such a switch, so neither
 * `navigator.onLine` nor the plugin's 'deviceNetwork' event shows it, yet
 * every connection made before it is on a network that is gone or no longer
 * used (native: DefaultNetworkSwitch, BackgroundKeepAlive).
 */

import { isCapacitor } from '../utils/platform';

const listeners = new Set<() => void>();
let bound = false;

/** Native reported a switch. Exported for tests. */
export function reportDefaultNetworkChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (err) {
      console.warn('[Network] default network listener failed', err);
    }
  }
}

function bindNativeEvent(): void {
  if (bound || !isCapacitor()) return;
  bound = true;
  void import('../plugins/QortalBackground')
    .then(({ QortalBackground }) =>
      // Older native builds never send it.
      QortalBackground.addListener('defaultNetworkChanged', () =>
        reportDefaultNetworkChanged()
      )
    )
    .catch(() => {});
}

/** Called right after each switch of GO's default network. */
export function subscribeDefaultNetworkChanged(
  listener: () => void
): () => void {
  bindNativeEvent();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
