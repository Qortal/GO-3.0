/**
 * Mount point for the background avatar prewarm (App.tsx): while the wallet
 * is signed in and unlocked, fetches the avatars GO is about to show (own
 * avatar, Tabs apps, most opened apps, recent DM partners, groups, then the
 * Q-Apps GO ships an icon for) at the lowest priority, after the visible
 * avatars, so lists keep their icons when the node is slow. See
 * prewarmPlan.ts for the order and prewarmScheduler.ts for when it runs.
 *
 * The prewarm code and the avatar cache are loaded only after login.
 */
import { useEffect, useRef } from 'react';
import { useStore } from 'jotai';
import { userInfoAtom } from '../../atoms/global';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import type { QdnAvatarPrewarmAppLike } from './prewarmPlan';
import type { QdnAvatarPrewarmTiming } from './prewarmScheduler';

type OpenTabsSnapshot = { account: string; tabs: QdnAvatarPrewarmAppLike[] };

type UseQdnAvatarPrewarmOptions = {
  /** Signed in, unlocked, main window. Nothing runs while false. */
  enabled: boolean;
  /** Signed-in wallet address. */
  address: string | null | undefined;
  /** Tests only. */
  timing?: Partial<QdnAvatarPrewarmTiming>;
};

export function useQdnAvatarPrewarm({
  enabled,
  address,
  timing,
}: UseQdnAvatarPrewarmOptions): void {
  const store = useStore();
  const openTabsRef = useRef<OpenTabsSnapshot>({ account: '', tabs: [] });
  const timingRef = useRef(timing);
  timingRef.current = timing;

  // The open tabs live in AppsDesktop; it broadcasts them on every change.
  // They are remembered with the account they belong to.
  useEffect(() => {
    const onTabs = (event: Event) => {
      const tabs = (event as CustomEvent)?.detail?.data?.tabs;
      if (!Array.isArray(tabs)) return;
      let owner = '';
      try {
        owner = (store.get(userInfoAtom) as any)?.address ?? '';
      } catch {
        owner = '';
      }
      openTabsRef.current = { account: owner, tabs };
    };
    subscribeToEvent('setTabsToNav', onTabs);
    return () => unsubscribeFromEvent('setTabsToNav', onTabs);
  }, [store]);

  const account = typeof address === 'string' ? address.trim() : '';

  useEffect(() => {
    if (!enabled || !account) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    import('./prewarmRuntime')
      .then(({ startQdnAvatarPrewarm }) => {
        if (cancelled) return;
        stop = startQdnAvatarPrewarm({
          store,
          account,
          getOpenTabs: () =>
            openTabsRef.current.account === account
              ? openTabsRef.current.tabs
              : [],
          timing: timingRef.current,
        });
      })
      .catch(() => {
        // Prewarm is optional; visible avatars still load on their own.
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [account, enabled, store]);
}
