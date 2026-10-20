import { createStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MOBILE_TAB_ORDER,
  MOBILE_TAB_ORDER_STORAGE_KEY,
  isDefaultMobileTabOrder,
  mobileSectionOrder,
  mobileTabOrderAtom,
  moveMobileTab,
  normalizeMobileTabOrder,
} from './mobileTabOrder';

describe('mobileTabOrder', () => {
  beforeEach(() => {
    window.localStorage.removeItem(MOBILE_TAB_ORDER_STORAGE_KEY);
  });

  it('keeps any order of the three sections', () => {
    expect(normalizeMobileTabOrder(['chat', 'home', 'apps'])).toEqual([
      'chat',
      'home',
      'apps',
    ]);
  });

  it.each([
    ['nothing', undefined],
    ['a string', 'home,apps,chat'],
    ['a missing section', ['home', 'apps']],
    ['a section twice', ['home', 'home', 'chat']],
    ['an unknown section', ['home', 'apps', 'wallet']],
    ['an extra section', ['home', 'apps', 'chat', 'chat']],
  ])('falls back to Home, Apps, Chat for %s', (_label, value) => {
    expect(normalizeMobileTabOrder(value)).toBe(DEFAULT_MOBILE_TAB_ORDER);
  });

  it('moves a button by places, stopping at the ends', () => {
    const order = DEFAULT_MOBILE_TAB_ORDER;
    expect(moveMobileTab(order, 'chat', -1)).toEqual(['home', 'chat', 'apps']);
    expect(moveMobileTab(order, 'chat', -2)).toEqual(['chat', 'home', 'apps']);
    expect(moveMobileTab(order, 'home', 1)).toEqual(['apps', 'home', 'chat']);
    // Already at the end: the same array, so nothing re-renders.
    expect(moveMobileTab(order, 'chat', 1)).toBe(order);
    expect(moveMobileTab(order, 'home', -1)).toBe(order);
  });

  it.each([
    [['home', 'apps', 'chat']],
    [['chat', 'home', 'apps']],
    [['apps', 'chat', 'home']],
  ] as const)(
    'puts the widgets screen left of the left button, however they sit (%j)',
    (buttons) => {
      expect(mobileSectionOrder(buttons, true)).toEqual([
        'widgets',
        ...buttons,
      ]);
      expect(mobileSectionOrder(buttons, false)).toEqual(buttons);
    }
  );

  it('knows the default order', () => {
    expect(isDefaultMobileTabOrder(['home', 'apps', 'chat'])).toBe(true);
    expect(isDefaultMobileTabOrder(['apps', 'home', 'chat'])).toBe(false);
  });

  it('saves the order on the device and reads it back on start', async () => {
    const store = createStore();
    expect(store.get(mobileTabOrderAtom)).toEqual(['home', 'apps', 'chat']);
    store.set(mobileTabOrderAtom, ['chat', 'apps', 'home']);
    expect(
      JSON.parse(window.localStorage.getItem(MOBILE_TAB_ORDER_STORAGE_KEY)!)
    ).toEqual(['chat', 'apps', 'home']);

    // A fresh start (the module loaded again) has it on its first read,
    // before anything has subscribed.
    vi.resetModules();
    const fresh = await import('./mobileTabOrder');
    expect(createStore().get(fresh.mobileTabOrderAtom)).toEqual([
      'chat',
      'apps',
      'home',
    ]);
  });

  it('ignores a broken saved value', async () => {
    window.localStorage.setItem(MOBILE_TAB_ORDER_STORAGE_KEY, '["home"]');
    vi.resetModules();
    const fresh = await import('./mobileTabOrder');
    expect(createStore().get(fresh.mobileTabOrderAtom)).toBe(
      fresh.DEFAULT_MOBILE_TAB_ORDER
    );
  });

  it('gives the same array until the order changes', () => {
    const store = createStore();
    store.set(mobileTabOrderAtom, ['apps', 'chat', 'home']);
    expect(store.get(mobileTabOrderAtom)).toBe(store.get(mobileTabOrderAtom));
  });
});
