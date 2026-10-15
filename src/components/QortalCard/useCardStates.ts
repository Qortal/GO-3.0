import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPrimaryName, fetchQortBalance } from '../../qortalCard/cardNode';

const WATCH_EVERY_MS = 5_000;
/** A transaction confirms in about a minute; give it three. */
const WATCH_ROUNDS = 36;

/** What the node says about one card. null: the node did not answer. */
export interface CardState {
  balance: bigint | null;
  name: string | null;
}

async function readState(address: string): Promise<CardState> {
  const [balance, name] = await Promise.all([
    fetchQortBalance(address).catch(() => null),
    fetchPrimaryName(address).catch(() => null),
  ]);
  return { balance, name };
}

/**
 * Each card's balance and name on chain, plus `watch`: after a top up, a
 * move back or a name registration, keep asking until the change shows, so
 * nobody has to press refresh.
 */
export function useCardStates(addresses: string[]) {
  const [states, setStates] = useState<Record<string, CardState>>({});
  const [watching, setWatching] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const key = addresses.join(',');

  const refresh = useCallback(
    async (only?: string[]): Promise<Record<string, CardState>> => {
      const list = only ?? (key ? key.split(',') : []);
      const entries = await Promise.all(
        list.map(
          async (address) => [address, await readState(address)] as const
        )
      );
      const fresh = Object.fromEntries(entries);
      setStates((current) => ({ ...current, ...fresh }));
      return fresh;
    },
    [key]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const running = timers.current;
    return () => running.forEach((timer) => clearInterval(timer));
  }, []);

  /** Polls `address` until `done` says the change is there (or time is up). */
  const watch = useCallback(
    (address: string, done: (state: CardState) => boolean) => {
      clearInterval(timers.current.get(address));
      setWatching((current) => new Set(current).add(address));
      let rounds = 0;
      const stop = () => {
        clearInterval(timers.current.get(address));
        timers.current.delete(address);
        setWatching((current) => {
          const next = new Set(current);
          next.delete(address);
          return next;
        });
      };
      timers.current.set(
        address,
        setInterval(async () => {
          rounds += 1;
          const state = await readState(address);
          setStates((current) => {
            const before = current[address];
            return {
              ...current,
              // A missed answer keeps what was there.
              [address]: {
                balance: state.balance ?? before?.balance ?? null,
                name: state.name ?? before?.name ?? null,
              },
            };
          });
          if (done(state) || rounds >= WATCH_ROUNDS) stop();
        }, WATCH_EVERY_MS)
      );
    },
    []
  );

  return { states, refresh, watch, watching };
}
