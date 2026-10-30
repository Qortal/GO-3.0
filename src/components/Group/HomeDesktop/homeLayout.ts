import { useEffect, useState } from 'react';
import {
  HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY,
  HOME_DASHBOARD_MODULE_VISIBILITY_CHANGE_EVENT,
  HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY,
  HOME_QUITTER_FEED_VISIBLE_STORAGE_KEY,
} from './homeDesktopConstants';

/**
 * What Home shows and in which order: the modules a user can turn off
 * (Profile settings) and the order of the windows on a phone (long press a
 * window, drag it). Both live in localStorage for the device and are read
 * by Home and by the settings, which stay in sync through a window event.
 */

/** Home parts that can be turned off. */
export type HomeModuleId =
  | 'qortino'
  | 'featured'
  | 'status'
  | 'groupActivity'
  | 'feed';

const HOME_MODULE_IDS: readonly HomeModuleId[] = [
  'qortino',
  'featured',
  'status',
  'groupActivity',
  'feed',
];

export const HOME_MODULE_STORAGE_KEYS: Record<HomeModuleId, string> = {
  qortino: 'home-dashboard-module-qortino-visible',
  featured: 'home-dashboard-module-featured-apps-visible',
  status: 'home-dashboard-module-status-visible',
  groupActivity: HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY,
  feed: HOME_QUITTER_FEED_VISIBLE_STORAGE_KEY,
};

type HomeModuleVisibility = Record<HomeModuleId, boolean>;

/** Shown unless turned off: a missing or unreadable value means on. */
const readHomeModuleVisible = (id: HomeModuleId): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(HOME_MODULE_STORAGE_KEYS[id]);
    if (raw === null) return true;
    return JSON.parse(raw) !== false;
  } catch {
    return true;
  }
};

export const readHomeModuleVisibility = (): HomeModuleVisibility =>
  HOME_MODULE_IDS.reduce((visibility, id) => {
    visibility[id] = readHomeModuleVisible(id);
    return visibility;
  }, {} as HomeModuleVisibility);

export const setHomeModuleVisible = (id: HomeModuleId, visible: boolean) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      HOME_MODULE_STORAGE_KEYS[id],
      JSON.stringify(visible)
    );
  } catch (error) {
    console.warn('Unable to persist dashboard module preference.', error);
  }
  window.dispatchEvent(
    new CustomEvent(HOME_DASHBOARD_MODULE_VISIBILITY_CHANGE_EVENT)
  );
};

const sameVisibility = (a: HomeModuleVisibility, b: HomeModuleVisibility) =>
  HOME_MODULE_IDS.every((id) => a[id] === b[id]);

/** Which modules Home shows, kept in sync with the settings. */
export function useHomeModuleVisibility(): HomeModuleVisibility {
  const [visibility, setVisibility] = useState(readHomeModuleVisibility);

  useEffect(() => {
    const sync = () => {
      const next = readHomeModuleVisibility();
      setVisibility((current) =>
        sameVisibility(current, next) ? current : next
      );
    };
    sync();
    window.addEventListener(
      HOME_DASHBOARD_MODULE_VISIBILITY_CHANGE_EVENT,
      sync
    );
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(
        HOME_DASHBOARD_MODULE_VISIBILITY_CHANGE_EVENT,
        sync
      );
      window.removeEventListener('storage', sync);
    };
  }, []);

  return visibility;
}

/** The windows of Home on a phone, one under the other. */
export type HomeWindowId =
  | 'workspace'
  | 'account'
  | 'composer'
  | 'tools'
  | 'featured'
  | 'status'
  | 'wallet'
  | 'groupActivity'
  | 'feed';

export const HOME_WINDOW_ORDER_DEFAULT: readonly HomeWindowId[] = [
  'workspace',
  'account',
  'composer',
  'tools',
  'featured',
  'status',
  'wallet',
  'groupActivity',
  'feed',
];

export const HOME_WINDOW_ORDER_STORAGE_KEY = 'home-dashboard-window-order-v1';
const HOME_WINDOW_ORDER_CHANGE_EVENT = 'home-dashboard-window-order-change';

const isHomeWindowId = (value: unknown): value is HomeWindowId =>
  typeof value === 'string' &&
  (HOME_WINDOW_ORDER_DEFAULT as readonly string[]).includes(value);

/**
 * The default order, with the two feeds the way the older swap button left
 * them (desktop's Group Activity / feed swap).
 */
const defaultWindowOrder = (): HomeWindowId[] => {
  const order = [...HOME_WINDOW_ORDER_DEFAULT];
  try {
    const raw = window.localStorage.getItem(
      HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY
    );
    const cards = raw ? JSON.parse(raw)?.order : null;
    if (
      Array.isArray(cards) &&
      cards.indexOf('quitter') !== -1 &&
      cards.indexOf('quitter') < cards.indexOf('groupActivity')
    ) {
      const feed = order.indexOf('feed');
      const groups = order.indexOf('groupActivity');
      order[feed] = 'groupActivity';
      order[groups] = 'feed';
    }
  } catch {
    // The default order, then.
  }
  return order;
};

/**
 * A stored order made whole: unknown and repeated ids dropped, and windows
 * it does not know yet (added in a later version) put back next to the
 * window they follow by default.
 */
export const completeHomeWindowOrder = (
  stored: readonly unknown[],
  fallback: readonly HomeWindowId[] = HOME_WINDOW_ORDER_DEFAULT
): HomeWindowId[] => {
  const result: HomeWindowId[] = [];
  stored.forEach((id) => {
    if (isHomeWindowId(id) && !result.includes(id)) result.push(id);
  });
  fallback.forEach((id, index) => {
    if (result.includes(id)) return;
    let insertAt = 0;
    for (let before = index - 1; before >= 0; before -= 1) {
      const at = result.indexOf(fallback[before]);
      if (at !== -1) {
        insertAt = at + 1;
        break;
      }
    }
    result.splice(insertAt, 0, id);
  });
  return result;
};

export const parseHomeWindowOrder = (raw: string | null): HomeWindowId[] => {
  const fallback = defaultWindowOrder();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? completeHomeWindowOrder(parsed, fallback)
      : fallback;
  } catch {
    return fallback;
  }
};

export const readHomeWindowOrder = (): HomeWindowId[] => {
  if (typeof window === 'undefined') return [...HOME_WINDOW_ORDER_DEFAULT];
  try {
    return parseHomeWindowOrder(
      window.localStorage.getItem(HOME_WINDOW_ORDER_STORAGE_KEY)
    );
  } catch {
    return [...HOME_WINDOW_ORDER_DEFAULT];
  }
};

/** Saves the order; null goes back to the default. */
export const writeHomeWindowOrder = (order: HomeWindowId[] | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (order) {
      window.localStorage.setItem(
        HOME_WINDOW_ORDER_STORAGE_KEY,
        JSON.stringify(order)
      );
    } else {
      window.localStorage.removeItem(HOME_WINDOW_ORDER_STORAGE_KEY);
    }
  } catch (error) {
    console.warn('Unable to persist the Home window order.', error);
  }
  window.dispatchEvent(new CustomEvent(HOME_WINDOW_ORDER_CHANGE_EVENT));
};

export const isDefaultHomeWindowOrder = (order: readonly HomeWindowId[]) =>
  defaultWindowOrder().every((id, index) => order[index] === id);

/**
 * The whole order after the shown windows were rearranged: hidden windows
 * keep their places, the shown ones fill the other places in their new
 * order.
 */
export const mergeVisibleWindowOrder = (
  full: readonly HomeWindowId[],
  visibleInNewOrder: readonly HomeWindowId[]
): HomeWindowId[] => {
  const shown = new Set(visibleInNewOrder);
  let next = 0;
  return full.map((id) => (shown.has(id) ? visibleInNewOrder[next++] : id));
};

const sameOrder = (a: readonly HomeWindowId[], b: readonly HomeWindowId[]) =>
  a.length === b.length && a.every((id, index) => b[index] === id);

/** The phone order of Home's windows, kept in sync with the settings. */
export function useHomeWindowOrder(): HomeWindowId[] {
  const [order, setOrder] = useState(readHomeWindowOrder);

  useEffect(() => {
    const sync = () => {
      const next = readHomeWindowOrder();
      setOrder((current) => (sameOrder(current, next) ? current : next));
    };
    sync();
    window.addEventListener(HOME_WINDOW_ORDER_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(HOME_WINDOW_ORDER_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return order;
}

/**
 * The shown windows in the saved order: those the order knows first, in
 * its order, then any it doesn't (in the order given).
 */
export const orderShownWindows = (
  shown: readonly HomeWindowId[],
  order: readonly HomeWindowId[]
): HomeWindowId[] => {
  const shownSet = new Set(shown);
  const known = order.filter((id) => shownSet.has(id));
  const knownSet = new Set(known);
  return [...known, ...shown.filter((id) => !knownSet.has(id))];
};
