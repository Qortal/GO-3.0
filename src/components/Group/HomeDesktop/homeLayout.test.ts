import { afterEach, describe, expect, it } from 'vitest';
import { HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY } from './homeDesktopConstants';
import {
  type HomeWindowId,
  HOME_MODULE_STORAGE_KEYS,
  HOME_WINDOW_ORDER_DEFAULT,
  HOME_WINDOW_ORDER_STORAGE_KEY,
  completeHomeWindowOrder,
  isDefaultHomeWindowOrder,
  mergeVisibleWindowOrder,
  orderShownWindows,
  parseHomeWindowOrder,
  readHomeModuleVisibility,
  readHomeWindowOrder,
  setHomeModuleVisible,
  writeHomeWindowOrder,
} from './homeLayout';

afterEach(() => {
  localStorage.clear();
});

describe('Home modules', () => {
  it('shows everything until something is turned off', () => {
    expect(readHomeModuleVisibility()).toEqual({
      qortino: true,
      featured: true,
      status: true,
      groupActivity: true,
      feed: true,
    });
    setHomeModuleVisible('status', false);
    setHomeModuleVisible('qortino', false);
    expect(readHomeModuleVisibility()).toMatchObject({
      qortino: false,
      status: false,
      featured: true,
    });
  });

  it('keeps reading the switches older versions saved', () => {
    localStorage.setItem(HOME_MODULE_STORAGE_KEYS.groupActivity, 'false');
    localStorage.setItem(HOME_MODULE_STORAGE_KEYS.feed, 'not json');
    expect(readHomeModuleVisibility()).toMatchObject({
      groupActivity: false,
      feed: true,
    });
  });
});

describe('Home window order', () => {
  it('starts in the default order', () => {
    expect(readHomeWindowOrder()).toEqual([...HOME_WINDOW_ORDER_DEFAULT]);
    expect(isDefaultHomeWindowOrder(readHomeWindowOrder())).toBe(true);
  });

  it('keeps the feeds the way the old swap button left them', () => {
    localStorage.setItem(
      HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY,
      JSON.stringify({ heights: {}, order: ['quitter', 'groupActivity'] })
    );
    const order = readHomeWindowOrder();
    expect(order.slice(-2)).toEqual(['feed', 'groupActivity']);
    expect(isDefaultHomeWindowOrder(order)).toBe(true);
  });

  it('drops unknown and repeated ids and puts back missing windows', () => {
    expect(
      completeHomeWindowOrder(['status', 'nope', 'status', 'account', 42])
    ).toEqual([
      'workspace',
      'status',
      'wallet',
      'groupActivity',
      'feed',
      'account',
      'tools',
      'featured',
    ]);
    expect(parseHomeWindowOrder('{broken')).toEqual([
      ...HOME_WINDOW_ORDER_DEFAULT,
    ]);
    expect(parseHomeWindowOrder('{"a":1}')).toEqual([
      ...HOME_WINDOW_ORDER_DEFAULT,
    ]);
  });

  it('saves and resets', () => {
    const moved = mergeVisibleWindowOrder(HOME_WINDOW_ORDER_DEFAULT, [
      'wallet',
      ...HOME_WINDOW_ORDER_DEFAULT.filter((id) => id !== 'wallet'),
    ]);
    writeHomeWindowOrder(moved);
    expect(readHomeWindowOrder()[0]).toBe('wallet');
    expect(isDefaultHomeWindowOrder(readHomeWindowOrder())).toBe(false);
    writeHomeWindowOrder(null);
    expect(localStorage.getItem(HOME_WINDOW_ORDER_STORAGE_KEY)).toBeNull();
    expect(readHomeWindowOrder()).toEqual([...HOME_WINDOW_ORDER_DEFAULT]);
  });

  it('leaves hidden windows in their places when the shown ones move', () => {
    const full = [...HOME_WINDOW_ORDER_DEFAULT];
    // Featured and Status hidden; Wallet dragged to the top.
    const shown = full.filter((id) => id !== 'featured' && id !== 'status');
    const reordered: HomeWindowId[] = [
      'wallet',
      ...shown.filter((id) => id !== 'wallet'),
    ];
    expect(mergeVisibleWindowOrder(full, reordered)).toEqual([
      'wallet',
      'workspace',
      'account',
      'featured',
      'status',
      'tools',
      'groupActivity',
      'feed',
    ]);
  });

  it('reads an order saved with the old composer window', () => {
    // Posting had a window of its own before it moved into the Torq window.
    localStorage.setItem(
      HOME_WINDOW_ORDER_STORAGE_KEY,
      JSON.stringify([
        'composer',
        'feed',
        'workspace',
        'account',
        'tools',
        'featured',
        'status',
        'wallet',
        'groupActivity',
      ])
    );
    expect(readHomeWindowOrder()).toEqual([
      'feed',
      'workspace',
      'account',
      'tools',
      'featured',
      'status',
      'wallet',
      'groupActivity',
    ]);

    // The old default order is today's default without it.
    localStorage.setItem(
      HOME_WINDOW_ORDER_STORAGE_KEY,
      JSON.stringify([
        'workspace',
        'account',
        'composer',
        'tools',
        'featured',
        'status',
        'wallet',
        'groupActivity',
        'feed',
      ])
    );
    expect(readHomeWindowOrder()).toEqual([...HOME_WINDOW_ORDER_DEFAULT]);
    expect(isDefaultHomeWindowOrder(readHomeWindowOrder())).toBe(true);
    expect(HOME_WINDOW_ORDER_DEFAULT as readonly string[]).not.toContain(
      'composer'
    );
  });

  it('shows the shown windows in the saved order, new ones last', () => {
    expect(
      orderShownWindows(
        ['workspace', 'status', 'wallet', 'feed'],
        ['wallet', 'account', 'workspace', 'status']
      )
    ).toEqual(['wallet', 'workspace', 'status', 'feed']);
  });
});
