import { useCallback, useEffect, useRef, useState } from 'react';
import { CardError } from '../../qortalCard/cardProtocol';
import { waitForCard, type CardLink } from '../../qortalCard/qortalNfc';

type CardTapPhase = 'waiting' | 'working';

export interface CardTapState {
  phase: CardTapPhase;
  /** What to tell the person holding the card. */
  prompt: string;
  /** A tag that is not a smart card came close. */
  otherTag: boolean;
  /** The card slipped away mid-read; this is the next try. */
  retry: boolean;
}

interface CardTapOptions {
  /**
   * How many times to wait for the card again when it moves away mid-read.
   * Safe for payments: nothing is sent before a checked signature is back.
   */
  retries?: number;
}

const slippedAway = (error: unknown): boolean =>
  error instanceof CardError &&
  (error.code === 'CARD_LOST' || error.code === 'CARD_IO');

/**
 * Runs one job with a card: shows the tap prompt, turns reading on, runs the
 * job while the card is held, then turns reading off again. Reading is never
 * on outside a job.
 */
export function useCardTap() {
  const [tap, setTap] = useState<CardTapState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const run = useCallback(
    async <T>(
      prompt: string,
      job: (card: CardLink) => Promise<T>,
      options: CardTapOptions = {}
    ): Promise<T> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const retries = options.retries ?? 0;
      try {
        for (let attempt = 0; ; attempt++) {
          setTap({
            phase: 'waiting',
            prompt,
            otherTag: false,
            retry: attempt > 0,
          });
          let card: CardLink | null = null;
          try {
            card = await waitForCard(controller.signal, () =>
              setTap((current) =>
                current ? { ...current, otherTag: true } : null
              )
            );
            setTap((current) =>
              current ? { ...current, phase: 'working' } : null
            );
            const result = await job(card);
            // Done: the card can go.
            navigator.vibrate?.(40);
            return result;
          } catch (error) {
            if (
              attempt < retries &&
              slippedAway(error) &&
              !controller.signal.aborted
            ) {
              navigator.vibrate?.([20, 40, 20]);
              continue;
            }
            throw error;
          } finally {
            if (card) await card.close();
          }
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setTap(null);
        }
      }
    },
    []
  );

  return { tap, run, cancel };
}

export type RunWithCard = ReturnType<typeof useCardTap>['run'];
