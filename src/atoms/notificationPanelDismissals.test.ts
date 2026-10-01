import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NOTIFICATION_PANEL_DISMISSED_STORAGE_KEY,
  getNotificationPanelDismissKey,
  isNotificationPanelDismissed,
  notificationPanelDismissalsAtom,
  notificationPanelDismissalsRecordAtom,
  parseNotificationPanelDismissals,
  userInfoAtom,
} from './global';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 29, 12);

const qMail = {
  event: 'RESOURCE_PUBLISHED',
  appName: 'Q-Mail',
  appService: 'APP',
  notificationId: 'q-mail-notification',
  data: { identifier: 'qortal_qmail_abc_mail_1', created: NOW - 1000 },
};

const mention = (mentionCount: number) => ({
  appName: 'Q-Chat mentions',
  event: 'Q_CHAT_MENTION',
  notificationId: 'q-chat-mention-7',
  data: { groupId: 7, mentionCount, qChatMention: true },
});

describe('bell panel dismissals', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keys each kind of panel item on something that survives a replay', () => {
    expect(getNotificationPanelDismissKey(qMail)).toBe(
      'RESOURCE_PUBLISHED-q-mail-APP-q-mail-notification-qortal_qmail_abc_mail_1'
    );
    expect(getNotificationPanelDismissKey(mention(2))).toBe('q-chat-mention-7');
    expect(
      getNotificationPanelDismissKey({
        data: { reticulumDmMissedCall: true, reticulumDmCallId: 'c1' },
      })
    ).toBe('reticulum-dm-call-c1');
    expect(
      getNotificationPanelDismissKey({
        notificationId: 'reticulum-calendar-o1',
        data: { reticulumCalendarReminder: true },
      })
    ).toBe('reticulum-calendar-o1');
    expect(
      getNotificationPanelDismissKey({ event: 'RESOURCE_PUBLISHED', data: {} })
    ).toBeNull();
    expect(getNotificationPanelDismissKey({ event: 'SOMETHING_ELSE' })).toBe(
      null
    );
  });

  it('hides a dismissed item, and a mention only until it has more mentions', () => {
    const dismissals = {
      [getNotificationPanelDismissKey(qMail)!]: { at: NOW },
      'q-chat-mention-7': { at: NOW, mentionCount: 2 },
    };
    expect(isNotificationPanelDismissed(qMail, dismissals)).toBe(true);
    expect(isNotificationPanelDismissed(qMail, {})).toBe(false);
    expect(isNotificationPanelDismissed(mention(2), dismissals)).toBe(true);
    expect(isNotificationPanelDismissed(mention(3), dismissals)).toBe(false);
  });

  it('drops malformed and week-old entries when parsing', () => {
    const parsed = parseNotificationPanelDismissals(
      JSON.stringify({
        Qaddr: {
          fresh: { at: NOW - DAY_MS },
          stale: { at: NOW - 8 * DAY_MS },
          broken: { at: 'yesterday' },
          mention: { at: NOW, mentionCount: 3 },
        },
        Qempty: { stale: { at: NOW - 30 * DAY_MS } },
        Qjunk: [1, 2],
      })
    );
    expect(parsed).toEqual({
      Qaddr: {
        fresh: { at: NOW - DAY_MS },
        mention: { at: NOW, mentionCount: 3 },
      },
    });
    expect(parseNotificationPanelDismissals('not json')).toEqual({});
    expect(parseNotificationPanelDismissals(null)).toEqual({});
  });

  it('stores dismissals per account and lowers a mention bar as mentions are read', () => {
    const store = createStore();
    store.set(userInfoAtom, { address: 'Qme' });

    store.set(notificationPanelDismissalsAtom, {
      type: 'dismiss',
      key: 'q-chat-mention-7',
      mentionCount: 3,
    });
    expect(store.get(notificationPanelDismissalsAtom)).toEqual({
      'q-chat-mention-7': { at: NOW, mentionCount: 3 },
    });
    expect(
      JSON.parse(
        localStorage.getItem(NOTIFICATION_PANEL_DISMISSED_STORAGE_KEY)!
      )
    ).toEqual({ Qme: { 'q-chat-mention-7': { at: NOW, mentionCount: 3 } } });

    // A sync at the same or a higher count leaves the bar alone.
    store.set(notificationPanelDismissalsAtom, {
      type: 'mentionCount',
      groupId: 7,
      mentionCount: 4,
    });
    expect(
      store.get(notificationPanelDismissalsAtom)['q-chat-mention-7']
    ).toEqual({ at: NOW, mentionCount: 3 });

    // Reading some mentions lowers it, so the next new one shows again.
    store.set(notificationPanelDismissalsAtom, {
      type: 'mentionCount',
      groupId: 7,
      mentionCount: 1,
    });
    expect(
      isNotificationPanelDismissed(
        mention(2),
        store.get(notificationPanelDismissalsAtom)
      )
    ).toBe(false);

    // Reading all of them clears the dismissal.
    store.set(notificationPanelDismissalsAtom, {
      type: 'mentionCount',
      groupId: 7,
      mentionCount: 0,
    });
    expect(store.get(notificationPanelDismissalsAtom)).toEqual({});

    store.set(userInfoAtom, { address: 'Qother' });
    store.set(notificationPanelDismissalsAtom, {
      type: 'dismiss',
      key: 'reticulum-dm-call-c1',
    });
    expect(store.get(notificationPanelDismissalsRecordAtom)).toEqual({
      Qother: { 'reticulum-dm-call-c1': { at: NOW } },
    });
  });

  it('clears everything in one write for the panel Clear all', () => {
    const store = createStore();
    store.set(userInfoAtom, { address: 'Qme' });
    store.set(notificationPanelDismissalsAtom, {
      type: 'dismiss',
      key: 'reticulum-dm-call-c1',
    });

    store.set(notificationPanelDismissalsAtom, {
      type: 'dismissMany',
      items: [
        { key: getNotificationPanelDismissKey(qMail)! },
        { key: 'q-chat-mention-7', mentionCount: 2 },
        { key: '' },
      ],
    });

    const dismissals = store.get(notificationPanelDismissalsAtom);
    expect(dismissals).toEqual({
      'reticulum-dm-call-c1': { at: NOW },
      [getNotificationPanelDismissKey(qMail)!]: { at: NOW },
      'q-chat-mention-7': { at: NOW, mentionCount: 2 },
    });
    expect(isNotificationPanelDismissed(qMail, dismissals)).toBe(true);
    // The mention rule still applies: a new mention brings the card back.
    expect(isNotificationPanelDismissed(mention(3), dismissals)).toBe(false);

    const before = store.get(notificationPanelDismissalsRecordAtom);
    store.set(notificationPanelDismissalsAtom, {
      type: 'dismissMany',
      items: [],
    });
    expect(store.get(notificationPanelDismissalsRecordAtom)).toBe(before);
  });
});
