import { useEffect, useRef } from 'react';

/**
 * Runs `effect` on mount and whenever `key` changes, but not when an
 * <Activity> shows the component again: hiding one unmounts its effects and
 * showing it runs them all again, deps unchanged. The phone's Chat section is
 * parked in one, so a plain `[selectedGroup]` reset used to put the open chat
 * back in General (and drop the reply being written) on every return to it.
 * Refs survive the hiding, so the last key handled is still known.
 */
export function useEffectOnKeyChange(key: string, effect: () => void): void {
  const lastKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    effect();
  }, [key]);
}
