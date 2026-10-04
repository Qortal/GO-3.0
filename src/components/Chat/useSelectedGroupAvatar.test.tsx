import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { groupsOwnerNamesAtom } from '../../atoms/global';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
  PNG_BYTES,
} from '../../lib/qdnAvatars/testHarness';
import {
  pickGroupAvatarOwnerName,
  useSelectedGroupAvatar,
} from './useSelectedGroupAvatar';

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

describe('pickGroupAvatarOwnerName', () => {
  it('prefers the groups list owner', () => {
    expect(
      pickGroupAvatarOwnerName({
        selectedGroup: 9,
        listedOwnerName: ' Founder ',
        fetchedOwnerName: 'Other',
        fetchedForGroupId: 9,
      })
    ).toBe('Founder');
  });

  it('uses the fetched owner only for the group it was fetched for', () => {
    const base = { listedOwnerName: null, fetchedOwnerName: 'Old' };
    expect(
      pickGroupAvatarOwnerName({
        ...base,
        selectedGroup: '9',
        fetchedForGroupId: 9,
      })
    ).toBe('Old');
    expect(
      pickGroupAvatarOwnerName({
        ...base,
        selectedGroup: 9,
        fetchedForGroupId: 5,
      })
    ).toBe('');
    expect(
      pickGroupAvatarOwnerName({
        ...base,
        selectedGroup: 9,
        fetchedForGroupId: null,
      })
    ).toBe('');
  });
});

describe('useSelectedGroupAvatar', () => {
  const setup = (ownerNames: Record<string, string> = {}) => {
    const store = createStore();
    store.set(groupsOwnerNamesAtom, ownerNames);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    return { store, wrapper };
  };

  it("never asks for the previous owner's avatar with the new group id", async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { wrapper } = setup();
    const { rerender, result } = renderHook(
      ({ group, owner, fetchedFor }) =>
        useSelectedGroupAvatar(group, owner, fetchedFor),
      {
        initialProps: { group: 5, owner: 'Old', fetchedFor: 5 },
        wrapper,
      }
    );
    await act(async () => {
      await flushAsync();
    });
    expect(result.current.src).toMatch(/^blob:/);
    // First render after the switch: the member data is still group 5's.
    rerender({ group: 9, owner: 'Old', fetchedFor: 5 });
    await act(async () => {
      await flushAsync();
    });
    expect(result.current.ownerName).toBe('');
    expect(result.current.src).toBeUndefined();
    expect(h.calls.map((call) => call.url)).toEqual([
      'http://node:12391/arbitrary/THUMBNAIL/Old/qortal_group_avatar_5?async=true',
    ]);
  });

  it('shows a cached avatar before the member fetch ends', async () => {
    const h = createAvatarTestHarness();
    setQdnAvatarCacheForTests(h.cache);
    await h.cache.putImage('Founder', PNG_BYTES, {
      identifier: 'qortal_group_avatar_9',
    });
    const { wrapper } = setup({ '9': 'Founder' });
    const { result } = renderHook(() => useSelectedGroupAvatar(9, '', null), {
      wrapper,
    });
    await act(async () => {
      await flushAsync();
    });
    expect(result.current.ownerName).toBe('Founder');
    expect(result.current.src).toMatch(/^blob:/);
    expect(h.calls).toHaveLength(0);
  });

  it('asks nothing for the General group or without a group', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ group }: { group: number | null }) =>
        useSelectedGroupAvatar(group, '', null),
      { initialProps: { group: 0 as number | null }, wrapper }
    );
    rerender({ group: null });
    await act(async () => {
      await flushAsync();
    });
    expect(result.current.src).toBeUndefined();
    expect(h.calls).toHaveLength(0);
  });
});
