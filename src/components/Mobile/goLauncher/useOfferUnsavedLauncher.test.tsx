import { act, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { sortablePinnedAppsAtom } from '../../../atoms/global';
import { launcherEditsAtom } from '../../Apps/AppsLauncher/launcherQdnSync';
import { savedAppsStateAtom } from '../../Apps/AppsLauncher/savedAppsSync';
import { useOfferUnsavedLauncher } from './useOfferUnsavedLauncher';

const qMail = { name: 'Q-Mail', service: 'APP' };
const qBlog = { name: 'Q-Blog', service: 'APP' };

/** QDN's copy as read at sign-in: Q-Mail pinned. */
const readState = (address = 'QAlice') => ({
  address,
  status: 'read' as const,
  saved: { pins: [qMail], data: { folders: [], bookmarks: [] }, order: [] },
  hasCopy: true,
});

const setup = (pins: unknown[], address = 'QAlice') => {
  const store = createStore();
  store.set(sortablePinnedAppsAtom, pins as never);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(
    ({ a }: { a: string }) => useOfferUnsavedLauncher(a, null),
    { wrapper, initialProps: { a: address } }
  );
  return { store, hook };
};

afterEach(() => {
  localStorage.clear();
});

describe('useOfferUnsavedLauncher', () => {
  it('offers pins left unsaved at the last close, once QDN is read', () => {
    const { store } = setup([qMail, qBlog]);
    // Not before the account's settings are read.
    expect(store.get(launcherEditsAtom).count).toBe(0);

    act(() => store.set(savedAppsStateAtom, readState()));
    expect(store.get(launcherEditsAtom)).toEqual({
      address: 'QAlice',
      count: 1,
    });
  });

  it('offers nothing when the launcher is as QDN has it', () => {
    const { store } = setup([qMail]);
    act(() => store.set(savedAppsStateAtom, readState()));
    expect(store.get(launcherEditsAtom).count).toBe(0);
  });

  it('counts once: changes made in this run are counted by themselves', () => {
    const { store } = setup([qMail, qBlog]);
    act(() => store.set(launcherEditsAtom, { address: 'QAlice', count: 3 }));
    act(() => store.set(savedAppsStateAtom, readState()));
    expect(store.get(launcherEditsAtom).count).toBe(3);

    // Pins changed again, still unsaved: no extra count.
    act(() => store.set(sortablePinnedAppsAtom, [qBlog] as never));
    expect(store.get(launcherEditsAtom).count).toBe(3);
  });

  it("doesn't take another account's copy for this one's", () => {
    const { store } = setup([qMail, qBlog]);
    act(() => store.set(savedAppsStateAtom, readState('QBob')));
    expect(store.get(launcherEditsAtom).count).toBe(0);
  });
});
