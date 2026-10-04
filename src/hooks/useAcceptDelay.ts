import { useEffect, useMemo, useState } from 'react';
import { APPROVAL_ACCEPT_DELAY_MS } from '../utils/qappApproval';

/**
 * GO-28 / GO-29: keeps an approval's Accept disabled for `delayMs` after the
 * dialog appears, after its request changes (`resetKey`), and after GO comes
 * back to the screen. A tap meant for something else (a double tap, a tap on
 * the screen underneath, a "tap here" bait from another app) then cannot
 * approve a request that just appeared.
 *
 * Returns true once Accept may be used.
 */
export function useAcceptDelay(
  active: boolean,
  resetKey: unknown,
  delayMs: number = APPROVAL_ACCEPT_DELAY_MS
): boolean {
  const [visibilityEpoch, setVisibilityEpoch] = useState(0);

  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    // Hidden or shown again: start over, so the delay runs while visible.
    const onVisibilityChange = () => setVisibilityEpoch((epoch) => epoch + 1);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [active]);

  // A new object whenever anything restarts the delay. Comparing against it
  // disarms Accept in the very render that shows new content, not one effect
  // later.
  const token = useMemo(
    () => ({ active, resetKey, visibilityEpoch }),
    [active, resetKey, visibilityEpoch]
  );
  const [armedToken, setArmedToken] = useState<object | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    if (typeof document !== 'undefined' && document.hidden) return undefined;
    const timer = setTimeout(() => setArmedToken(token), Math.max(0, delayMs));
    return () => clearTimeout(timer);
  }, [active, delayMs, token]);

  return active && armedToken === token;
}
