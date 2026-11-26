/**
 * GO: a friend whose GO was heard within the last hour can be rung even when
 * presence shows them offline. A phone off screen on battery stops sending
 * heartbeats when its page freezes, but its Python bridge still receives a
 * call request and rings natively. Presence keeps showing the truth (the dot
 * stays grey); only the call button and the call routes accept the older
 * endpoint. A sign-out removes the endpoint, so a signed-out friend is not
 * rung. Desktop/web keep the Hub's rule (online only).
 */
import { useEffect, useState } from 'react';
import { isCapacitor } from '../../utils/platform';

/** Matches capacitorBridge CHAT_ENDPOINT_TTL_MS (how long endpoints are kept). */
export const RECENT_CALL_ENDPOINT_MAX_AGE_MS = 60 * 60 * 1_000;

export function isRecentlyReachableForCall(
  address: string | null | undefined,
  now: number = Date.now()
): boolean {
  if (!address || !isCapacitor()) return false;
  let lastSeen: number | null | undefined;
  try {
    lastSeen = window.presence?.getCallEndpointLastSeen?.(address);
  } catch {
    return false;
  }
  return (
    typeof lastSeen === 'number' &&
    lastSeen > 0 &&
    now - lastSeen <= RECENT_CALL_ENDPOINT_MAX_AGE_MS
  );
}

/**
 * Whether `address` can be rung: online, or (GO) heard within the hour.
 * Re-checked every 30 s while offline, so it expires on time.
 */
export function useCallReachable(
  address: string | null | undefined,
  online: boolean
): boolean {
  const [recent, setRecent] = useState(() =>
    online ? false : isRecentlyReachableForCall(address)
  );
  useEffect(() => {
    if (online || !address) {
      setRecent(false);
      return undefined;
    }
    const check = () => setRecent(isRecentlyReachableForCall(address));
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [address, online]);
  return online || recent;
}
