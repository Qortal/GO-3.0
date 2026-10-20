import { act, cleanup, render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  memberGroupsAtom,
  memberGroupsWithReticulumChatAtom,
  reticulumChatEnabledAtom,
  reticulumChatSummariesAtom,
  type ReticulumChatSummaryAtomEntry,
} from '../../atoms/global';
import { shareReticulumChatSummaries } from '../Group/reticulumSummaryRefresh';
import {
  reticulumOpenGroupSummaryEqual,
  useReticulumOpenGroupSummary,
} from './reticulumOpenGroupSummary';

const groupSummary = (
  groupId: number,
  channels: Array<Partial<ReticulumChatSummaryAtomEntry>>,
  payload = 'hello'
): ReticulumChatSummaryAtomEntry => ({
  groupId,
  unreadCount: channels.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
  updatedAt: 1_000,
  lastEvent: {
    eventId: `e${groupId}`,
    timestamp: 1_000,
    encryptedPayload: payload,
  },
  channels: channels.map((channel) => ({
    groupId,
    channelId: 'general',
    unreadCount: 0,
    mentionCount: 0,
    replyCount: 0,
    updatedAt: 1_000,
    lastEvent: { timestamp: 1_000 },
    ...channel,
  })),
});

// What Group.tsx does with a getSummaries result.
const refresh = (
  store: ReturnType<typeof createStore>,
  summaries: ReticulumChatSummaryAtomEntry[]
) => {
  const previous = store.get(reticulumChatSummariesAtom);
  const next = shareReticulumChatSummaries(previous, summaries);
  if (next !== previous) store.set(reticulumChatSummariesAtom, next);
};

describe('useReticulumOpenGroupSummary', () => {
  afterEach(() => cleanup());

  // Counts committed renders (React may call a component once more on mount
  // and then bail out without committing; that is not a re-render).
  const mountOpenChat = (store: ReturnType<typeof createStore>) => {
    const renders: Array<ReticulumChatSummaryAtomEntry | undefined> = [];
    const OpenChat = () => {
      const summary = useReticulumOpenGroupSummary('1');
      useEffect(() => {
        renders.push(summary);
      });
      return null;
    };
    render(
      <Provider store={store}>
        <OpenChat />
      </Provider>
    );
    return renders;
  };

  it('does not re-render the open chat when only another group changes', () => {
    const store = createStore();
    refresh(store, [
      groupSummary(1, [{ unreadCount: 2 }]),
      groupSummary(2, [{ unreadCount: 0 }]),
    ]);
    const renders = mountOpenChat(store);
    expect(renders).toHaveLength(1);

    for (let unread = 1; unread <= 10; unread += 1) {
      act(() =>
        refresh(store, [
          groupSummary(1, [{ unreadCount: 2 }]),
          groupSummary(2, [{ unreadCount: unread }]),
        ])
      );
    }
    expect(renders).toHaveLength(1);
  });

  it('does not re-render for an equal refresh or a non-badge change', () => {
    const store = createStore();
    refresh(store, [groupSummary(1, [{ unreadCount: 2 }])]);
    const renders = mountOpenChat(store);
    const before = store.get(reticulumChatSummariesAtom);

    act(() => refresh(store, [groupSummary(1, [{ unreadCount: 2 }])]));
    expect(store.get(reticulumChatSummariesAtom)).toBe(before);
    act(() =>
      refresh(store, [groupSummary(1, [{ unreadCount: 2 }], 'edited text')])
    );
    expect(renders).toHaveLength(1);
  });

  it('re-renders with fresh counts when its own channel changes', () => {
    const store = createStore();
    refresh(store, [
      groupSummary(1, [
        { unreadCount: 2 },
        { channelId: 'dev', unreadCount: 0 },
      ]),
    ]);
    const renders = mountOpenChat(store);

    act(() =>
      refresh(store, [
        groupSummary(1, [
          { unreadCount: 0 },
          { channelId: 'dev', mentionCount: 1, hasUnreadMention: true },
        ]),
      ])
    );
    expect(renders).toHaveLength(2);
    const latest = renders[renders.length - 1];
    expect(latest?.channels?.[0].unreadCount).toBe(0);
    expect(latest?.channels?.[1].mentionCount).toBe(1);
    expect(latest?.channels?.[1].hasUnreadMention).toBe(true);

    act(() =>
      refresh(store, [
        groupSummary(1, [
          { unreadCount: 0, updatedAt: 2_000, lastEvent: { timestamp: 2_000 } },
          { channelId: 'dev', mentionCount: 1, hasUnreadMention: true },
        ]),
      ])
    );
    expect(renders).toHaveLength(3);
    expect(renders[2]?.channels?.[0].updatedAt).toBe(2_000);
  });

  it('compares the badge fields of every channel', () => {
    const base = groupSummary(1, [{ unreadCount: 1 }, { channelId: 'dev' }]);
    expect(
      reticulumOpenGroupSummaryEqual(
        base,
        groupSummary(1, [{ unreadCount: 1 }, { channelId: 'dev' }], 'x')
      )
    ).toBe(true);
    for (const change of [
      { replyCount: 1 },
      { mentionCount: 1 },
      { unreadCount: 3 },
      { hasUnreadMention: true },
      { updatedAt: 5 },
      { lastEvent: { timestamp: 5 } },
      { channelId: 'other' },
    ]) {
      expect(
        reticulumOpenGroupSummaryEqual(
          base,
          groupSummary(1, [{ unreadCount: 1 }, { channelId: 'dev', ...change }])
        )
      ).toBe(false);
    }
    expect(
      reticulumOpenGroupSummaryEqual(
        base,
        groupSummary(1, [{ unreadCount: 1 }])
      )
    ).toBe(false);
    expect(reticulumOpenGroupSummaryEqual(base, undefined)).toBe(false);
  });
});

describe('memberGroupsWithReticulumChatAtom rows', () => {
  it('keeps the rows of groups whose summary did not change', () => {
    const store = createStore();
    store.set(reticulumChatEnabledAtom, true);
    store.set(memberGroupsAtom, [
      { groupId: 1, groupName: 'one' },
      { groupId: 2, groupName: 'two' },
    ] as any);
    refresh(store, [
      groupSummary(1, [{ unreadCount: 1 }]),
      groupSummary(2, [{ unreadCount: 0 }]),
    ]);
    const before = store.get(memberGroupsWithReticulumChatAtom) as any[];
    const rowOf = (rows: any[], groupId: number) =>
      rows.find((row) => row.groupId === groupId);

    refresh(store, [
      groupSummary(1, [{ unreadCount: 1 }]),
      groupSummary(2, [{ unreadCount: 4 }]),
    ]);
    const after = store.get(memberGroupsWithReticulumChatAtom) as any[];
    expect(rowOf(after, 1)).toBe(rowOf(before, 1));
    expect(rowOf(after, 2)).not.toBe(rowOf(before, 2));
    expect(rowOf(after, 2).reticulumChatSummary.unreadCount).toBe(4);

    // An equal refresh leaves the list value itself untouched.
    refresh(store, [
      groupSummary(1, [{ unreadCount: 1 }]),
      groupSummary(2, [{ unreadCount: 4 }]),
    ]);
    expect(store.get(memberGroupsWithReticulumChatAtom)).toBe(after);
  });

  it('rebuilds rows when the chat switch flips', () => {
    const store = createStore();
    store.set(memberGroupsAtom, [{ groupId: 1, timestamp: 5_000 }] as any);
    store.set(reticulumChatEnabledAtom, true);
    refresh(store, [groupSummary(1, [{ unreadCount: 1 }])]);
    const enabledRow = (
      store.get(memberGroupsWithReticulumChatAtom) as any[]
    )[0];
    expect(enabledRow.timestamp).toBe(1_000);
    store.set(reticulumChatEnabledAtom, false);
    const disabledRow = (
      store.get(memberGroupsWithReticulumChatAtom) as any[]
    )[0];
    expect(disabledRow).not.toBe(enabledRow);
    expect(disabledRow.timestamp).toBe(5_000);
  });
});
