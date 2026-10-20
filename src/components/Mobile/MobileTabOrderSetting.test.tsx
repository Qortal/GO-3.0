import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { beforeEach, describe, expect, it } from 'vitest';
import '../../i18n/i18n';
import { MobileTabOrderSetting } from './MobileTabOrderSetting';
import {
  MOBILE_TAB_ORDER_STORAGE_KEY,
  mobileTabOrderAtom,
} from './mobileTabOrder';
import { findHorizontalOwner } from './sectionSwipe/sectionSwipe';

const renderSetting = (store = createStore()) => {
  render(
    <Provider store={store}>
      <MobileTabOrderSetting />
    </Provider>
  );
  return store;
};

const shown = () =>
  screen.getAllByRole('listitem').map((item) => item.textContent);

const item = (name: string) =>
  screen.getAllByRole('listitem').find((el) => el.textContent === name)!;

const saved = () =>
  JSON.parse(window.localStorage.getItem(MOBILE_TAB_ORDER_STORAGE_KEY)!);

describe('MobileTabOrderSetting', () => {
  beforeEach(() => {
    window.localStorage.removeItem(MOBILE_TAB_ORDER_STORAGE_KEY);
  });

  it('shows the three round buttons in the bar order, without Reset', () => {
    renderSetting();
    expect(screen.getByText('Bottom buttons')).toBeInTheDocument();
    expect(shown()).toEqual(['Home', 'Apps', 'Chat']);
    expect(item('Home')).toHaveAccessibleName(
      'Home, 1 of 3. Use the left and right arrow keys to move it.'
    );
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  });

  it('moves a button with the arrow keys and saves the order', () => {
    const store = renderSetting();
    fireEvent.keyDown(item('Chat'), { key: 'ArrowLeft' });
    expect(shown()).toEqual(['Home', 'Chat', 'Apps']);
    expect(store.get(mobileTabOrderAtom)).toEqual(['home', 'chat', 'apps']);
    expect(saved()).toEqual(['home', 'chat', 'apps']);

    fireEvent.keyDown(item('Chat'), { key: 'ArrowLeft' });
    expect(shown()).toEqual(['Chat', 'Home', 'Apps']);
    expect(item('Chat')).toHaveAccessibleName(
      'Chat, 1 of 3. Use the left and right arrow keys to move it.'
    );

    // Already first: nothing moves, nothing is written.
    const before = store.get(mobileTabOrderAtom);
    fireEvent.keyDown(item('Chat'), { key: 'ArrowLeft' });
    expect(store.get(mobileTabOrderAtom)).toBe(before);

    fireEvent.keyDown(item('Home'), { key: 'ArrowRight' });
    expect(saved()).toEqual(['chat', 'apps', 'home']);
  });

  it('puts the default order back with Reset', () => {
    window.localStorage.setItem(
      MOBILE_TAB_ORDER_STORAGE_KEY,
      JSON.stringify(['chat', 'apps', 'home'])
    );
    const store = renderSetting();
    expect(shown()).toEqual(['Chat', 'Apps', 'Home']);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(shown()).toEqual(['Home', 'Apps', 'Chat']);
    expect(store.get(mobileTabOrderAtom)).toEqual(['home', 'apps', 'chat']);
  });

  it('follows a change made elsewhere', () => {
    const store = renderSetting();
    act(() => store.set(mobileTabOrderAtom, ['apps', 'home', 'chat']));
    expect(shown()).toEqual(['Apps', 'Home', 'Chat']);
  });

  it('keeps sideways drags for itself (not the swipe between settings tabs)', () => {
    renderSetting();
    const button = item('Apps');
    // framer-motion's drag="x": vertical scrolling stays the page's.
    expect(button.style.touchAction).toBe('pan-y');
    const readStyle = (el: Element) => ({
      overflowX: 'visible',
      touchAction: (el as HTMLElement).style?.touchAction ?? '',
    });
    expect(
      findHorizontalOwner(button.querySelector('svg'), document.body, readStyle)
    ).toBe(button);
  });

  it('uses the arrow keys the other way round in right-to-left layouts', async () => {
    const { ThemeProvider, createTheme } = await import('@mui/material');
    const store = createStore();
    render(
      <ThemeProvider theme={createTheme({ direction: 'rtl' })}>
        <Provider store={store}>
          <MobileTabOrderSetting />
        </Provider>
      </ThemeProvider>
    );
    fireEvent.keyDown(item('Home'), { key: 'ArrowLeft' });
    expect(store.get(mobileTabOrderAtom)).toEqual(['apps', 'home', 'chat']);
  });
});
