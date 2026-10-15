import { atom, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import {
  IMMERSIVE_EASING,
  IMMERSIVE_HIDE_MS,
  IMMERSIVE_SHOW_MS,
  immersiveMotionReduced,
} from './immersive/useImmersiveBars';

/**
 * The panels open right now that reach the bottom of the phone screen inside
 * the page (the channel list drawer, ...): the floating Home, Apps and Chat
 * buttons would sit over their lowest rows. While any is open the buttons
 * slide off the bottom edge; the layout under them stays as it is, so nothing
 * behind the panel moves (MobileTabBar's `covered`).
 */
const mobileTabBarCoversAtom = atom<ReadonlySet<symbol>>(new Set<symbol>());

/** True while a panel holds the floating tab buttons away. */
export const mobileTabBarCoveredAtom = atom(
  (get) => get(mobileTabBarCoversAtom).size > 0
);

/**
 * For a panel that opens over the bottom of the phone screen: the floating
 * tab buttons step aside while `covering` holds and the caller is mounted.
 * Pass false while the panel's screen is not the one on show (a parked
 * section), so the buttons come back there.
 */
export function useCoverMobileTabBar(covering: boolean): void {
  const setCovers = useSetAtom(mobileTabBarCoversAtom);
  useEffect(() => {
    if (!covering) return;
    const cover = Symbol('tab-bar-cover');
    setCovers((covers) => new Set(covers).add(cover));
    return () =>
      setCovers((covers) => {
        if (!covers.has(cover)) return covers;
        const next = new Set(covers);
        next.delete(cover);
        return next;
      });
  }, [covering, setCovers]);
}

/** The buttons' slide while covered, as immersive mode's (MobileTabBar). */
export const tabBarCoverMotion = () => {
  const reduced = immersiveMotionReduced();
  return {
    showMs: reduced ? 0 : IMMERSIVE_SHOW_MS,
    hideMs: reduced ? 0 : IMMERSIVE_HIDE_MS,
    easing: IMMERSIVE_EASING,
  };
};
