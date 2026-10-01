import { act, render } from '@testing-library/react';
import { Provider, createStore, useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NOTIFICATION_SEEN_IN_APP_STORAGE_KEY,
  isNotificationSeenInAppFromKeyTimes,
  notificationSeenInAppKeyTimesAtom,
  notificationSeenInAppKeysAtom,
  notificationSeenInAppKeysRecordAtom,
  userInfoAtom,
} from './global';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.UTC(2026, 8, 29, 12);
const ME = 'QfX9KhXnoB78v2D36j7nocKaYtzUYcyQyH';
const Q_MAIL_PREFIX = 'RESOURCE_PUBLISHED-q-mail-APP-q-mail-notification';
const OTHER_PREFIX = 'RESOURCE_PUBLISHED-q-blog-APP-new-post';

const qMailAt = (created: number) => ({
  event: 'RESOURCE_PUBLISHED',
  appName: 'Q-Mail',
  appService: 'APP',
  notificationId: 'q-mail-notification',
  data: { identifier: `mail-${created}`, created },
});

// The record GO held when every startTransition in the app starved: one
// built-in Q-Mail mark and no custom subscriptions at all.
const phoneRecord = () => ({ [ME]: { [Q_MAIL_PREFIX]: NOW - 30 * HOUR_MS } });

const seededStore = (record: Record<string, Record<string, number>>) => {
  const store = createStore();
  store.set(userInfoAtom, { address: ME });
  store.set(notificationSeenInAppKeysRecordAtom, record);
  return store;
};

describe('notificationSeenInAppKeysAtom', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('writes nothing and notifies nobody when an update changes nothing', () => {
    localStorage.setItem(
      NOTIFICATION_SEEN_IN_APP_STORAGE_KEY,
      JSON.stringify(phoneRecord())
    );
    const store = createStore();
    store.set(userInfoAtom, { address: ME });
    const listener = vi.fn();
    // Mounting hydrates the record from storage; measure after that.
    store.sub(notificationSeenInAppKeysAtom, listener);
    listener.mockClear();
    const before = store.get(notificationSeenInAppKeysRecordAtom);
    expect(before).toEqual(phoneRecord());
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    store.set(notificationSeenInAppKeysAtom, []);
    store.set(notificationSeenInAppKeysAtom, [Q_MAIL_PREFIX]);
    store.set(notificationSeenInAppKeysAtom, {
      address: ME,
      keys: [Q_MAIL_PREFIX],
    });
    store.set(notificationSeenInAppKeysAtom, {
      address: ME,
      keyTimes: { [Q_MAIL_PREFIX]: NOW - 30 * HOUR_MS },
    });
    store.set(notificationSeenInAppKeysAtom, {
      address: ME,
      keyTimes: { [Q_MAIL_PREFIX]: NOW - 40 * HOUR_MS },
    });

    expect(setItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(store.get(notificationSeenInAppKeysRecordAtom)).toBe(before);
  });

  it('keyTimes keeps the newer time and clamps future times to now', () => {
    const store = seededStore(phoneRecord());

    store.set(notificationSeenInAppKeysAtom, {
      address: ME,
      keyTimes: {
        [Q_MAIL_PREFIX]: NOW - HOUR_MS,
        [OTHER_PREFIX]: NOW + HOUR_MS,
      },
    });

    expect(store.get(notificationSeenInAppKeyTimesAtom)).toEqual({
      [Q_MAIL_PREFIX]: NOW - HOUR_MS,
      [OTHER_PREFIX]: NOW,
    });
    expect(
      JSON.parse(localStorage.getItem(NOTIFICATION_SEEN_IN_APP_STORAGE_KEY))
    ).toEqual({
      [ME]: { [Q_MAIL_PREFIX]: NOW - HOUR_MS, [OTHER_PREFIX]: NOW },
    });
  });

  it('keys adds missing marks at now and never moves an existing mark', () => {
    const store = seededStore(phoneRecord());

    vi.setSystemTime(NOW + HOUR_MS);
    store.set(notificationSeenInAppKeysAtom, [Q_MAIL_PREFIX, OTHER_PREFIX]);

    // Moving the Q-Mail prefix to now would hide the mail below as seen.
    const times = store.get(notificationSeenInAppKeyTimesAtom);
    expect(times).toEqual({
      [Q_MAIL_PREFIX]: NOW - 30 * HOUR_MS,
      [OTHER_PREFIX]: NOW + HOUR_MS,
    });
    expect(
      isNotificationSeenInAppFromKeyTimes(qMailAt(NOW - 2 * HOUR_MS), times)
    ).toBe(false);
    expect(
      isNotificationSeenInAppFromKeyTimes(qMailAt(NOW - 31 * HOUR_MS), times)
    ).toBe(true);
  });

  it('only touches the address it was given', () => {
    const other = 'QgRU2U8Qf1AF72qxf7rFMpp63VYjv89BrC';
    const store = seededStore({
      ...phoneRecord(),
      [other]: { [OTHER_PREFIX]: NOW - DAY_MS },
    });

    store.set(notificationSeenInAppKeysAtom, {
      address: other,
      keys: [Q_MAIL_PREFIX],
    });

    expect(store.get(notificationSeenInAppKeysRecordAtom)).toEqual({
      [ME]: { [Q_MAIL_PREFIX]: NOW - 30 * HOUR_MS },
      [other]: { [OTHER_PREFIX]: NOW - DAY_MS, [Q_MAIL_PREFIX]: NOW },
    });
  });

  it('drops marks older than 3 days when it writes', () => {
    const store = seededStore({
      [ME]: { [Q_MAIL_PREFIX]: NOW - 4 * DAY_MS },
    });

    store.set(notificationSeenInAppKeysAtom, [OTHER_PREFIX]);

    expect(store.get(notificationSeenInAppKeysRecordAtom)).toEqual({
      [ME]: { [OTHER_PREFIX]: NOW },
    });
  });

  it('settles when an effect writes back the keys it reads', () => {
    // The old prune effect in WebsocketNotifications did this, and every
    // write produced a new record, so it re-ran forever at default priority.
    localStorage.setItem(
      NOTIFICATION_SEEN_IN_APP_STORAGE_KEY,
      JSON.stringify(phoneRecord())
    );
    const store = createStore();
    store.set(userInfoAtom, { address: ME });
    let renders = 0;
    const Probe = () => {
      renders += 1;
      const keys = useAtomValue(notificationSeenInAppKeysAtom);
      const setKeys = useSetAtom(notificationSeenInAppKeysAtom);
      useEffect(() => {
        // Cap it so a regression fails the assertions instead of hanging.
        if (renders > 20) return;
        setKeys(keys.filter((key) => key !== Q_MAIL_PREFIX));
      }, [keys, setKeys]);
      return null;
    };
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    render(
      <Provider store={store}>
        <Probe />
      </Provider>
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(store.get(notificationSeenInAppKeysAtom)).toEqual([Q_MAIL_PREFIX]);
    expect(renders).toBeLessThanOrEqual(3);
    expect(
      setItem.mock.calls.filter(
        ([key]) => key === NOTIFICATION_SEEN_IN_APP_STORAGE_KEY
      )
    ).toEqual([]);
  });
});
