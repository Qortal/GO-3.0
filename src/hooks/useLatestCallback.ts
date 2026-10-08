import { useCallback, useRef } from 'react';

/**
 * A function that never changes identity but always calls the latest `fn`:
 * for handing callbacks to memoized children without their re-rendering each
 * time the parent creates a new closure. Only for event-style callbacks (not
 * called during render).
 */
export function useLatestCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result
): (...args: Args) => Result {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: Args) => ref.current(...args), []);
}
