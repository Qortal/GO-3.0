import { act, renderHook, waitFor } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrimaryNamesForAddresses } from '../components/Group/groupApi';
import { appLockedAtom } from '../atoms/presence';
import {
  reticulumChatSummariesAtom,
  reticulumDirectSummariesAtom,
} from '../atoms/global';
import { executeEvent } from '../utils/events';
import {
  CHAT_WARM_CACHE_LIMIT,
  readWarmDirectHistory,
  readWarmGroupHistory,
  setChatWarmCacheOwner,
  setKnownReticulumChatEnabled,
  writeWarmDirectHistory,
  writeWarmGroupHistory,
  writeWarmName,
  readWarmName,
  markWarmChatOpen,
} from './chatWarmCache';
import { useChatHistoryWarmUp } from './useChatHistoryWarmUp';
import { useReticulumGroupChat } from '../hooks/useReticulumGroupChat';
import {
  useReticulumDirectChat,
  type ReticulumDmEvent,
} from '../hooks/useReticulumDirectChat';

vi.mock('../components/Group/groupApi', () => ({
  getPrimaryNamesForAddresses: vi.fn(async () => ({})),
}));

const ME = 'Qme';
const PEER = 'Qpeer';

const groupEvent = (eventId: string, timestamp: number, extra = {}) => ({
  eventId,
  groupId: 42,
  channelId: 'general',
  timestamp,
  authorAddress: 'Qauthor',
  eventType: 'message',
  ...extra,
});

const dm = (eventId: string, timestamp: number): ReticulumDmEvent => ({
  eventId,
  conversationId: 'conversation',
  senderAddress: PEER,
  recipientAddress: ME,
  senderPublicKey: 'public-key',
  senderSeq: timestamp,
  timestamp,
  eventType: 'message',
  payload: JSON.stringify({ messageText: `<p>${eventId}</p>` }),
  payloadHash: `hash-${eventId}`,
  signature: `signature-${eventId}`,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const store = getDefaultStore();

const setGroupLatest = (groupId: number, timestamp: number) =>
  store.set(reticulumChatSummariesAtom, {
    ...store.get(reticulumChatSummariesAtom),
    [String(groupId)]: {
      groupId,
      lastEvent: { timestamp },
      channels: [{ groupId, channelId: 'general', lastEvent: { timestamp } }],
    },
  });

const setDirectLatest = (peer: string, timestamp: number) =>
  store.set(reticulumDirectSummariesAtom, {
    ...store.get(reticulumDirectSummariesAtom),
    [peer]: { peerAddress: peer, lastEvent: { timestamp } },
  });

describe('chat warm cache', () => {
  const original = window.reticulumChat;

  beforeEach(() => {
    store.set(reticulumChatSummariesAtom, {});
    store.set(reticulumDirectSummariesAtom, {});
    store.set(appLockedAtom, false);
    vi.mocked(getPrimaryNamesForAddresses).mockClear();
    vi.mocked(getPrimaryNamesForAddresses).mockResolvedValue({});
  });

  afterEach(() => {
    window.reticulumChat = original;
    store.set(appLockedAtom, false);
    vi.useRealTimers();
  });

  describe('the cache', () => {
    it('serves a copy only while it ends at the chat latest event', () => {
      writeWarmGroupHistory(42, 'general', {
        events: [groupEvent('a', 100), groupEvent('b', 200)],
        hasOlder: false,
      });
      setGroupLatest(42, 200);
      expect(readWarmGroupHistory(42, 'general')?.events).toHaveLength(2);
      // A newer message arrived: the chat opens the usual way.
      setGroupLatest(42, 300);
      expect(readWarmGroupHistory(42, 'general')).toBeNull();

      writeWarmDirectHistory(ME, PEER, [dm('x', 100)]);
      setDirectLatest(PEER, 100);
      expect(readWarmDirectHistory(ME, PEER)).toHaveLength(1);
      setDirectLatest(PEER, 101);
      expect(readWarmDirectHistory(ME, PEER)).toBeNull();
    });

    it('empties on lock, logout and another account, and keeps nothing while locked', () => {
      setChatWarmCacheOwner(ME);
      writeWarmDirectHistory(ME, PEER, [dm('x', 100)]);
      writeWarmName('Qauthor', 'Author');
      act(() => store.set(appLockedAtom, true));
      expect(readWarmDirectHistory(ME, PEER)).toBeNull();
      expect(readWarmName('Qauthor')).toBeUndefined();
      writeWarmDirectHistory(ME, PEER, [dm('x', 100)]);
      act(() => store.set(appLockedAtom, false));
      expect(readWarmDirectHistory(ME, PEER)).toBeNull();

      writeWarmDirectHistory(ME, PEER, [dm('x', 100)]);
      executeEvent('logout-event', {});
      expect(readWarmDirectHistory(ME, PEER)).toBeNull();

      setChatWarmCacheOwner(ME);
      writeWarmDirectHistory(ME, PEER, [dm('x', 100)]);
      // Another account's copy is never shown, nor written.
      expect(readWarmDirectHistory('Qother', PEER)).toBeNull();
      writeWarmDirectHistory('Qother', 'Qelse', [dm('y', 100)]);
      expect(readWarmDirectHistory('Qother', 'Qelse')).toBeNull();
      setChatWarmCacheOwner('Qother');
      expect(readWarmDirectHistory(ME, PEER)).toBeNull();
    });

    it('keeps only the most recently used chats', () => {
      for (let groupId = 1; groupId <= CHAT_WARM_CACHE_LIMIT + 2; groupId++) {
        writeWarmGroupHistory(groupId, 'general', {
          events: [groupEvent(`e${groupId}`, groupId)],
          hasOlder: false,
        });
      }
      expect(readWarmGroupHistory(1, 'general')).toBeNull();
      expect(readWarmGroupHistory(2, 'general')).toBeNull();
      expect(readWarmGroupHistory(3, 'general')).not.toBeNull();
    });
  });

  describe('group chat', () => {
    let listeners: Array<(payload: { event: unknown }) => void>;
    let getMessageHistoryPage: ReturnType<typeof vi.fn>;
    let isEnabled: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      listeners = [];
      getMessageHistoryPage = vi.fn();
      isEnabled = vi.fn(async () => true);
      window.reticulumChat = {
        isEnabled,
        subscribeGroup: vi.fn(async () => ({ success: true })),
        subscribeChannel: vi.fn(async () => ({ success: true })),
        unsubscribeChannel: vi.fn(async () => ({ success: true })),
        getMessageHistoryPage,
        getDiscussionIndex: vi.fn(async () => ({
          replyCounts: {},
          rootByEventId: {},
        })),
        onEvent: vi.fn((listener: (payload: { event: unknown }) => void) => {
          listeners.push(listener);
          return () => {
            listeners = listeners.filter((other) => other !== listener);
          };
        }),
        onTyping: vi.fn(() => () => undefined),
        onSilenceChanged: vi.fn(() => () => undefined),
      } as any;
    });

    it('opens with a current copy at once, then the read replaces it, keeping what came in live', async () => {
      setKnownReticulumChatEnabled(true);
      writeWarmGroupHistory(42, 'general', {
        events: [groupEvent('gone', 100), groupEvent('kept', 200)],
        hasOlder: true,
      });
      const page = deferred<{ events: unknown[]; hasMore: boolean }>();
      getMessageHistoryPage.mockReturnValue(page.promise);

      const { result } = renderHook(() => useReticulumGroupChat(42, 'general'));
      // The first render already has it: no settings round trip, no read.
      expect(result.current.enabled).toBe(true);
      expect(result.current.initialHistoryReady).toBe(true);
      expect(result.current.events.map((e: any) => e.eventId)).toEqual([
        'gone',
        'kept',
      ]);
      expect(result.current.hasOlder).toBe(true);

      // A message arrives live before the read is back.
      await waitFor(() => expect(listeners.length).toBe(1));
      vi.useFakeTimers();
      act(() => {
        listeners[0]({ event: groupEvent('live', 400) });
        vi.advanceTimersByTime(500);
      });
      vi.useRealTimers();

      await act(async () => {
        page.resolve({
          events: [groupEvent('kept', 200), groupEvent('new', 300)],
          hasMore: false,
        });
      });
      await waitFor(() =>
        expect(result.current.events.map((e: any) => e.eventId)).toEqual([
          'kept',
          'new',
          'live',
        ])
      );
      expect(getMessageHistoryPage).toHaveBeenCalledWith(42, 'general', 200);
    });

    it('opens the usual way when the chat has newer messages than its copy', async () => {
      setKnownReticulumChatEnabled(true);
      writeWarmGroupHistory(42, 'general', {
        events: [groupEvent('old', 100)],
        hasOlder: false,
      });
      setGroupLatest(42, 500);
      const page = deferred<{ events: unknown[]; hasMore: boolean }>();
      getMessageHistoryPage.mockReturnValue(page.promise);

      const { result } = renderHook(() => useReticulumGroupChat(42, 'general'));
      expect(result.current.initialHistoryReady).toBe(false);
      await act(async () => {
        page.resolve({
          events: [groupEvent('old', 100), groupEvent('newest', 500)],
          hasMore: false,
        });
      });
      await waitFor(() =>
        expect(result.current.initialHistoryReady).toBe(true)
      );
      expect(result.current.events.map((e: any) => e.eventId)).toEqual([
        'old',
        'newest',
      ]);
    });

    it('keeps the chat for next time when it closes', async () => {
      getMessageHistoryPage.mockResolvedValue({
        events: [groupEvent('a', 100), groupEvent('b', 200)],
        hasMore: true,
      });
      const { result, unmount } = renderHook(() =>
        useReticulumGroupChat(42, 'general')
      );
      await waitFor(() =>
        expect(result.current.initialHistoryReady).toBe(true)
      );
      unmount();
      const kept = readWarmGroupHistory(42, 'general');
      expect(kept?.events.map((e: any) => e.eventId)).toEqual(['a', 'b']);
      expect(kept?.hasOlder).toBe(true);

      // The next open shows it on its first render.
      const next = renderHook(() => useReticulumGroupChat(42, 'general'));
      expect(next.result.current.initialHistoryReady).toBe(true);
      expect(next.result.current.events).toHaveLength(2);
    });
  });

  describe('DM chat', () => {
    beforeEach(() => {
      window.reticulumChat = {
        isEnabled: async () => true,
        setLocalDmAddresses: vi.fn(async () => undefined),
        getDirectHistory: vi.fn(async () => [dm('m1', 100), dm('m2', 200)]),
        onDirectEvent: () => () => {},
        onDirectTyping: () => () => {},
        onDirectSummaryChanged: () => () => {},
        onSilenceChanged: () => () => {},
      } as any;
    });

    it('shows the messages without waiting for the names', async () => {
      // The Qortal node never answers.
      vi.mocked(getPrimaryNamesForAddresses).mockReturnValue(
        new Promise(() => {})
      );
      const { result } = renderHook(() => useReticulumDirectChat(ME, PEER));
      await waitFor(() =>
        expect(result.current.initialHistoryReady).toBe(true)
      );
      expect(result.current.messages).toHaveLength(2);
    });

    it('opens with a current copy on its first render', () => {
      setKnownReticulumChatEnabled(true);
      writeWarmDirectHistory(ME, PEER, [dm('m1', 100), dm('m2', 200)]);
      const { result } = renderHook(() => useReticulumDirectChat(ME, PEER));
      expect(result.current.initialHistoryReady).toBe(true);
      expect(result.current.messages).toHaveLength(2);
    });

    it('uses a name already known instead of asking the node', async () => {
      writeWarmName(PEER, 'Peer Name');
      const { result } = renderHook(() => useReticulumDirectChat(ME, PEER));
      await waitFor(() =>
        expect(result.current.initialHistoryReady).toBe(true)
      );
      expect(getPrimaryNamesForAddresses).not.toHaveBeenCalled();
    });
  });

  describe('warm-up', () => {
    const timing = {
      startDelayMs: 10,
      replanDelayMs: 10,
      gapMs: 0,
      rereadAfterMs: 0,
    };

    it('reads the most recent chats from the phone only, then keeps them', async () => {
      const getMessageHistoryPage = vi.fn(async () => ({
        events: [groupEvent('g', 500)],
        hasMore: false,
      }));
      const getDirectHistory = vi.fn(async () => [dm('d', 600)]);
      const getDirectCallHistory = vi.fn(async () => []);
      window.reticulumChat = {
        isEnabled: async () => true,
        getMessageHistoryPage,
        getDirectHistory,
        getDirectCallHistory,
      } as any;
      setGroupLatest(42, 500);
      setDirectLatest(PEER, 600);

      const { unmount } = renderHook(() =>
        useChatHistoryWarmUp({ enabled: true, address: ME, timing })
      );
      await waitFor(() =>
        expect(readWarmDirectHistory(ME, PEER)).toHaveLength(1)
      );
      await waitFor(() =>
        expect(readWarmGroupHistory(42, 'general')?.events).toHaveLength(1)
      );
      // Local reads: no network repair for the group page.
      expect(getMessageHistoryPage).toHaveBeenCalledWith(42, 'general', 200, {
        repairNetwork: false,
      });
      expect(getDirectHistory).toHaveBeenCalledWith(ME, PEER, 200);

      // Stopping (lock, logout) empties it.
      unmount();
      expect(readWarmDirectHistory(ME, PEER)).toBeNull();
      expect(readWarmGroupHistory(42, 'general')).toBeNull();
    });

    it('reads a warm chat again when its latest message changes', async () => {
      let latest = 500;
      const getMessageHistoryPage = vi.fn(async () => ({
        events: [groupEvent(`g${latest}`, latest)],
        hasMore: false,
      }));
      window.reticulumChat = {
        isEnabled: async () => true,
        getMessageHistoryPage,
        getDirectHistory: vi.fn(async () => []),
        getDirectCallHistory: vi.fn(async () => []),
      } as any;
      setGroupLatest(42, latest);
      renderHook(() =>
        useChatHistoryWarmUp({ enabled: true, address: ME, timing })
      );
      await waitFor(() =>
        expect(readWarmGroupHistory(42, 'general')?.events).toHaveLength(1)
      );
      latest = 700;
      act(() => setGroupLatest(42, 700));
      await waitFor(() =>
        expect(
          (readWarmGroupHistory(42, 'general')?.events[0] as any)?.eventId
        ).toBe('g700')
      );
      expect(getMessageHistoryPage).toHaveBeenCalledTimes(2);
    });

    it('waits while a chat is open, then catches up', async () => {
      const getMessageHistoryPage = vi.fn(async () => ({
        events: [groupEvent('g', 500)],
        hasMore: false,
      }));
      window.reticulumChat = {
        isEnabled: async () => true,
        getMessageHistoryPage,
        getDirectHistory: vi.fn(async () => []),
        getDirectCallHistory: vi.fn(async () => []),
      } as any;
      setGroupLatest(42, 500);
      // A chat on screen (reactions, typing): no warm-up read beside it.
      const close = markWarmChatOpen('g:7');
      renderHook(() =>
        useChatHistoryWarmUp({ enabled: true, address: ME, timing })
      );
      await new Promise((done) => setTimeout(done, 120));
      expect(getMessageHistoryPage).not.toHaveBeenCalled();
      act(() => close());
      await waitFor(() =>
        expect(readWarmGroupHistory(42, 'general')?.events).toHaveLength(1)
      );
    });

    it('looks up unknown sender names once, so the chat opens with names', async () => {
      vi.mocked(getPrimaryNamesForAddresses).mockResolvedValue({
        Qauthor: 'Author Name',
      });
      window.reticulumChat = {
        isEnabled: async () => true,
        getMessageHistoryPage: vi.fn(async () => ({
          events: [groupEvent('g', 500)],
          hasMore: false,
        })),
        getDirectHistory: vi.fn(async () => []),
        getDirectCallHistory: vi.fn(async () => []),
      } as any;
      setGroupLatest(42, 500);
      renderHook(() =>
        useChatHistoryWarmUp({ enabled: true, address: ME, timing })
      );
      await waitFor(() =>
        expect(
          (readWarmGroupHistory(42, 'general')?.events[0] as any)
            ?.authorPrimaryName
        ).toBe('Author Name')
      );
      expect(getPrimaryNamesForAddresses).toHaveBeenCalledTimes(1);
      expect(getPrimaryNamesForAddresses).toHaveBeenCalledWith(['Qauthor']);
    });

    it('does nothing when Reticulum chat is off', async () => {
      const getMessageHistoryPage = vi.fn();
      window.reticulumChat = {
        isEnabled: async () => false,
        getMessageHistoryPage,
      } as any;
      setGroupLatest(42, 500);
      renderHook(() =>
        useChatHistoryWarmUp({ enabled: true, address: ME, timing })
      );
      await new Promise((done) => setTimeout(done, 80));
      expect(getMessageHistoryPage).not.toHaveBeenCalled();
    });
  });
});
