import { act, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
  userInfoAtom,
} from '../../atoms/global';
import { launcherEditsAtom } from '../Apps/AppsLauncher/launcherQdnSync';
import { useTopBarPin } from './useTopBarPin';
import type { OpenTab } from './useOpenTabs';

const setup = (
  tab: OpenTab | null,
  url: string,
  pinned: any[] = [{ name: 'Q-Tube', service: 'APP' }]
) => {
  const store = createStore();
  store.set(sortablePinnedAppsAtom, pinned);
  store.set(settingsLocalLastUpdatedAtom, 0);
  store.set(userInfoAtom, { address: 'QAlice', name: 'Alice' });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(
    ({ t, u }: { t: OpenTab | null; u: string }) => useTopBarPin(t, u),
    { wrapper, initialProps: { t: tab, u: url } }
  );
  return { store, hook };
};

const savedPins = () =>
  JSON.parse(localStorage.getItem('ext_saved_settings') || '{}')
    .sortablePinnedApps;

afterEach(() => {
  localStorage.clear();
});

describe('useTopBarPin', () => {
  it('pins the app on screen, and unpins it again', () => {
    const tab = { tabId: 't1', name: 'Q-Blog', service: 'APP' };
    const { store, hook } = setup(tab, 'qortal://APP/Q-Blog/post/1');
    expect(hook.result.current?.pinned).toBe(false);

    act(() => hook.result.current!.toggle());
    expect(store.get(sortablePinnedAppsAtom)).toEqual([
      { name: 'Q-Tube', service: 'APP' },
      { name: 'Q-Blog', service: 'APP' },
    ]);
    expect(savedPins()).toEqual(store.get(sortablePinnedAppsAtom));
    // Counts as a change to offer to save to QDN.
    expect(store.get(settingsLocalLastUpdatedAtom)).toBeGreaterThan(0);
    expect(hook.result.current?.pinned).toBe(true);

    act(() => hook.result.current!.toggle());
    expect(store.get(sortablePinnedAppsAtom)).toEqual([
      { name: 'Q-Tube', service: 'APP' },
    ]);
    expect(hook.result.current?.pinned).toBe(false);
  });

  it('counts each pin and unpin as a launcher change, to offer a save', () => {
    const tab = { tabId: 't1', name: 'Q-Blog', service: 'APP' };
    const { store, hook } = setup(tab, 'qortal://APP/Q-Blog');
    expect(store.get(launcherEditsAtom).count).toBe(0);

    act(() => hook.result.current!.toggle());
    expect(store.get(launcherEditsAtom)).toEqual({
      address: 'QAlice',
      count: 1,
    });
    act(() => hook.result.current!.toggle());
    expect(store.get(launcherEditsAtom)).toEqual({
      address: 'QAlice',
      count: 2,
    });
  });

  it('knows a pinned app whatever the case of its name', () => {
    const tab = { tabId: 't1', name: 'q-tube', service: 'app' };
    const { hook } = setup(tab, 'qortal://APP/q-tube');
    expect(hook.result.current?.pinned).toBe(true);
  });

  it('pins the website a link inside the tab went to', () => {
    const tab = { tabId: 't1', name: 'Q-Blog', service: 'APP' };
    const { store, hook } = setup(tab, 'qortal://WEBSITE/My%20Site/about');

    act(() => hook.result.current!.toggle());
    expect(store.get(sortablePinnedAppsAtom)).toContainEqual({
      name: 'My Site',
      service: 'WEBSITE',
    });
  });

  it('pins a private app as its tab says', () => {
    const tab = {
      tabId: 't1',
      name: 'Secret',
      service: 'APP',
      isPrivate: true,
      privateAppProperties: {
        name: 'Alice',
        service: 'DOCUMENT',
        identifier: 'private-app-1',
        groupId: 7,
        appName: 'Secret',
      },
    };
    const { store, hook } = setup(tab, 'qortal://DOCUMENT/Alice');

    act(() => hook.result.current!.toggle());
    const pins = store.get(sortablePinnedAppsAtom);
    const added = pins[pins.length - 1];
    expect(added).toMatchObject({
      isPrivate: true,
      privateAppProperties: {
        name: 'Alice',
        service: 'DOCUMENT',
        identifier: 'private-app-1',
        groupId: 7,
      },
    });
    expect(hook.result.current?.pinned).toBe(true);
  });

  it('has nothing to pin without a tab or on a GO page of its own', () => {
    expect(setup(null, '').hook.result.current).toBeNull();
    expect(
      setup({ tabId: 'w', internal: 'wallets' }, 'qortal://wallets').hook.result
        .current
    ).toBeNull();
  });

  it('follows the tab on screen', () => {
    const { hook } = setup(
      { tabId: 't1', name: 'Q-Tube', service: 'APP' },
      'qortal://APP/Q-Tube'
    );
    expect(hook.result.current?.pinned).toBe(true);
    hook.rerender({
      t: { tabId: 't2', name: 'Q-Mail', service: 'APP' },
      u: 'qortal://APP/Q-Mail',
    });
    expect(hook.result.current?.pinned).toBe(false);
  });
});
