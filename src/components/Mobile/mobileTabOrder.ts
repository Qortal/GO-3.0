import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { localJsonStorage } from '../../utils/localJsonStorage';

/**
 * The order of the round Home, Apps and Chat buttons on phones (Settings →
 * System). The sideways swipe between sections follows it too, so the
 * section beside the current one is always the button beside its button.
 *
 * A leaf module (no components, no navigation): MobileTabBar, Group's
 * section swipe and the settings row all read it.
 */
export type MobileTabKey = 'home' | 'apps' | 'chat';

/**
 * Every phone section the sideways swipe moves between: the three buttons'
 * plus the widgets screen, which has no button (it sits left of the first).
 */
export type MobileSectionKey = MobileTabKey | 'widgets';

/** Left to right, as the round buttons sit until the user moves them. */
export const DEFAULT_MOBILE_TAB_ORDER: readonly MobileTabKey[] = [
  'home',
  'apps',
  'chat',
] as const;

/**
 * Every section left to right, as the sideways swipe moves between them: the
 * widgets screen (when shown) always first, left of whichever button the user
 * put on the left, then the buttons in their order.
 */
export const mobileSectionOrder = (
  buttons: readonly MobileTabKey[],
  withWidgets: boolean
): readonly MobileSectionKey[] =>
  withWidgets ? ['widgets', ...buttons] : buttons;

/** Device-wide, not per account: it is about the screen, not the wallet. */
export const MOBILE_TAB_ORDER_STORAGE_KEY = 'go_tab_bar_order';

/** Each of the three sections exactly once, else the default order. */
export const normalizeMobileTabOrder = (
  value: unknown
): readonly MobileTabKey[] => {
  if (!Array.isArray(value) || value.length !== DEFAULT_MOBILE_TAB_ORDER.length)
    return DEFAULT_MOBILE_TAB_ORDER;
  const seen = new Set<MobileTabKey>();
  for (const key of value) {
    if (!DEFAULT_MOBILE_TAB_ORDER.includes(key as MobileTabKey)) {
      return DEFAULT_MOBILE_TAB_ORDER;
    }
    seen.add(key as MobileTabKey);
  }
  return seen.size === DEFAULT_MOBILE_TAB_ORDER.length
    ? (value as MobileTabKey[])
    : DEFAULT_MOBILE_TAB_ORDER;
};

export const isDefaultMobileTabOrder = (
  order: readonly MobileTabKey[]
): boolean => order.every((key, i) => key === DEFAULT_MOBILE_TAB_ORDER[i]);

/** `order` with `key` moved `by` places (clamped to the ends). */
export const moveMobileTab = (
  order: readonly MobileTabKey[],
  key: MobileTabKey,
  by: number
): readonly MobileTabKey[] => {
  const from = order.indexOf(key);
  if (from < 0) return order;
  const to = Math.max(0, Math.min(order.length - 1, from + by));
  if (to === from) return order;
  const next = order.filter((other) => other !== key);
  next.splice(to, 0, key);
  return next;
};

// Read on init so the first frame after login already has the right order.
const mobileTabOrderStoredAtom = atomWithStorage<unknown>(
  MOBILE_TAB_ORDER_STORAGE_KEY,
  DEFAULT_MOBILE_TAB_ORDER,
  localJsonStorage<unknown>(),
  { getOnInit: true }
);

/**
 * The same array for as long as the order is the same (the stored value is
 * parsed once per change), so it is safe as an effect dependency.
 */
export const mobileTabOrderAtom = atom(
  (get): readonly MobileTabKey[] =>
    normalizeMobileTabOrder(get(mobileTabOrderStoredAtom)),
  (_get, set, next: readonly MobileTabKey[]) => {
    set(mobileTabOrderStoredAtom, [...normalizeMobileTabOrder(next)]);
  }
);
