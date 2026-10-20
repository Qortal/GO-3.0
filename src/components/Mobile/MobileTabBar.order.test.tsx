import { act, cleanup, render, screen } from '@testing-library/react';
import { Provider, atom, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileTabBar } from './MobileTabBar';
import {
  MOBILE_TAB_ORDER_STORAGE_KEY,
  mobileTabOrderAtom,
} from './mobileTabOrder';

vi.mock('../../atoms/global', () => ({
  directChatHasUnreadAtom: atom(false),
  groupChatHasUnreadExcludingMutedAtom: atom(false),
}));
vi.mock('./useMobileTabNavigation', () => ({
  useMobileTabNavigation: () => ({ active: 'home', go: vi.fn() }),
}));

const labels = () =>
  screen
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));

describe('MobileTabBar order', () => {
  beforeEach(() => {
    window.localStorage.removeItem(MOBILE_TAB_ORDER_STORAGE_KEY);
  });
  afterEach(() => cleanup());

  it.each(['bottom', 'inline'] as const)(
    'shows Home, Apps, Chat by default (%s)',
    (variant) => {
      render(
        <Provider store={createStore()}>
          <MobileTabBar
            desktopViewMode="home"
            setDesktopViewMode={vi.fn()}
            variant={variant}
            floating
          />
        </Provider>
      );
      expect(labels()).toEqual(['Home', 'Apps', 'Chat']);
    }
  );

  it.each(['bottom', 'inline'] as const)(
    'shows the saved order and follows a change (%s)',
    (variant) => {
      window.localStorage.setItem(
        MOBILE_TAB_ORDER_STORAGE_KEY,
        JSON.stringify(['chat', 'home', 'apps'])
      );
      const store = createStore();
      render(
        <Provider store={store}>
          <MobileTabBar
            desktopViewMode="home"
            setDesktopViewMode={vi.fn()}
            variant={variant}
            floating
          />
        </Provider>
      );
      expect(labels()).toEqual(['Chat', 'Home', 'Apps']);

      act(() => store.set(mobileTabOrderAtom, ['apps', 'chat', 'home']));
      expect(labels()).toEqual(['Apps', 'Chat', 'Home']);
    }
  );
});
