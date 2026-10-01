import { act, render } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dmFriendsByAddressAtom, userInfoAtom } from '../../atoms/global';
import {
  CHAT_ALERT_CATCH_UP_SETTLE_MS,
  readChatAlertLastRunMark,
  writeChatAlertLastRunMark,
} from '../../utils/reticulumChatAlerts';
import { WebSocketNotifications } from './WebsocketNotifications';

const mocks = vi.hoisted(() => ({
  fire: vi.fn(async (..._args: unknown[]) => undefined),
  dismiss: vi.fn(),
  isCapacitor: vi.fn(() => true),
  hubViewed: vi.fn(() => false),
}));

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  getBaseApiReactSocket: () => 'ws://localhost:12391',
}));
vi.mock('../../background/background', () => ({
  fireOsNotificationPayment: mocks.fire,
  dismissOsNotificationByKey: mocks.dismiss,
}));
vi.mock('../../qortal/qortal-requests', () => ({
  getNotificationPermissionKey: (appName: string) => appName,
  getPermission: vi.fn(async () => false),
}));
vi.mock('../../assets/svgs/LogoSelected.svg', () => ({ default: 'logo' }));
vi.mock('../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/platform')>()),
  isCapacitor: mocks.isCapacitor,
}));
vi.mock('../../utils/reticulumDmNotifications', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../utils/reticulumDmNotifications')
  >()),
  isHubBeingViewed: mocks.hubViewed,
}));
vi.mock('../../utils/qChatMentionNotifications', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../utils/qChatMentionNotifications')
  >()),
  getQChatMentionNotificationsEnabled: vi.fn(async () => true),
}));

const ME = 'Qme';
const ALICE = 'Qalice';
const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

let directListener: ((payload: { event: unknown }) => void) | null = null;
let summaryListener: ((payload: { peerAddress: string }) => void) | null = null;
let unreadCount = 1;
let eventSeq = 0;

const installChat = () => {
  window.reticulumChat = {
    onDirectEvent: vi.fn((listener) => {
      directListener = listener;
      return () => {
        directListener = null;
      };
    }),
    onDirectSummaryChanged: vi.fn((listener) => {
      summaryListener = listener;
      return () => {
        summaryListener = null;
      };
    }),
    onDirectCallHistory: vi.fn(() => () => undefined),
    getDirectCallHistory: vi.fn(async () => []),
    getDirectSummaries: vi.fn(async (_me: string, peer: string) => [
      { peerAddress: peer, unreadCount, unreadMissedCallCount: 0 },
    ]),
  } as unknown as typeof window.reticulumChat;
};

const renderNotifications = () => {
  const store = createStore();
  store.set(userInfoAtom, { address: ME });
  store.set(dmFriendsByAddressAtom, {
    [ALICE]: { name: 'Alice', publicKey: 'alice-key', addedAt: 1 },
  } as never);
  return render(
    <Provider store={store}>
      <WebSocketNotifications myAddress={ME} userName={undefined} />
    </Provider>
  );
};

const deliverDm = (timestamp: number) =>
  act(() => {
    eventSeq += 1;
    directListener?.({
      event: {
        eventId: `evt-${eventSeq}`,
        eventType: 'message',
        senderAddress: ALICE,
        recipientAddress: ME,
        timestamp,
        readByOwner: false,
      },
    });
  });

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const deliverMention = async (timestamp: number) => {
  eventSeq += 1;
  await act(async () => {
    document.dispatchEvent(
      new CustomEvent('q-chat-mention-notification', {
        detail: {
          eventId: `mention-${eventSeq}`,
          groupId: 7,
          groupName: 'Lab',
          channelId: 'general',
          timestamp,
        },
      })
    );
    await Promise.resolve();
  });
};

describe('WebSocketNotifications catch-up alerts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    window.localStorage.clear();
    mocks.fire.mockClear();
    mocks.dismiss.mockClear();
    mocks.isCapacitor.mockReturnValue(true);
    mocks.hubViewed.mockReturnValue(false);
    unreadCount = 1;
    installChat();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    delete (window as { reticulumChat?: unknown }).reticulumChat;
  });

  it('alerts once, after the settle, for a catch-up DM sent after GO last ran', async () => {
    writeChatAlertLastRunMark(ME, NOW - HOUR);
    renderNotifications();
    deliverDm(NOW - 30 * 60 * 1000);
    // Catch-up never takes the leading edge.
    expect(mocks.fire).not.toHaveBeenCalled();
    await advance(CHAT_ALERT_CATCH_UP_SETTLE_MS);
    expect(mocks.fire).toHaveBeenCalledTimes(1);
    expect(mocks.fire.mock.calls[0][1]).toBe('New message from Alice');
  });

  it('does not alert for a catch-up DM older than the last-run mark', async () => {
    writeChatAlertLastRunMark(ME, NOW - HOUR);
    renderNotifications();
    deliverDm(NOW - 2 * HOUR);
    await advance(120_000);
    expect(mocks.fire).not.toHaveBeenCalled();
  });

  it('does not alert when a read sync lands during the settle', async () => {
    writeChatAlertLastRunMark(ME, NOW - HOUR);
    renderNotifications();
    deliverDm(NOW - 30 * 60 * 1000);
    unreadCount = 0;
    act(() => summaryListener?.({ peerAddress: ALICE }));
    await advance(CHAT_ALERT_CATCH_UP_SETTLE_MS * 2);
    expect(mocks.fire).not.toHaveBeenCalled();
    // Cancelled by the dismiss check itself: the post never ran its own.
    expect(window.reticulumChat.getDirectSummaries).toHaveBeenCalledTimes(1);
  });

  it('does not alert when the chat was read before the settle ended', async () => {
    writeChatAlertLastRunMark(ME, NOW - HOUR);
    renderNotifications();
    deliverDm(NOW - 30 * 60 * 1000);
    // No summary event reached this device; the post-time check catches it.
    unreadCount = 0;
    await advance(CHAT_ALERT_CATCH_UP_SETTLE_MS);
    expect(mocks.fire).not.toHaveBeenCalled();
  });

  it('posts live DMs at once, each with its own alert', async () => {
    renderNotifications();
    deliverDm(NOW);
    vi.setSystemTime(NOW + 10_000);
    deliverDm(NOW + 10_000);
    expect(mocks.fire).toHaveBeenCalledTimes(2);
  });

  it('keeps the listening-time gate on desktop', async () => {
    mocks.isCapacitor.mockReturnValue(false);
    writeChatAlertLastRunMark(ME, NOW - HOUR);
    renderNotifications();
    deliverDm(NOW - 30 * 60 * 1000);
    await advance(120_000);
    expect(mocks.fire).not.toHaveBeenCalled();
    deliverDm(Date.now());
    expect(mocks.fire).toHaveBeenCalledTimes(1);
  });

  it('writes the last-run mark on hide and pagehide only, without timers', async () => {
    renderNotifications();
    // jsdom queues a 0 ms task per localStorage write (the storage event);
    // flush those so only timers armed by the component remain.
    vi.advanceTimersByTime(0);
    const timersWhileIdle = vi.getTimerCount();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    expect(readChatAlertLastRunMark(ME)).toBeNull();

    vi.setSystemTime(NOW + 5_000);
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    visibility.mockRestore();
    expect(readChatAlertLastRunMark(ME)).toBe(NOW + 5_000);

    vi.setSystemTime(NOW + 9_000);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(readChatAlertLastRunMark(ME)).toBe(NOW + 9_000);

    // A visible edge does not write.
    vi.setSystemTime(NOW + 20_000);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(readChatAlertLastRunMark(ME)).toBe(NOW + 9_000);

    vi.advanceTimersByTime(0);
    expect(vi.getTimerCount()).toBe(timersWhileIdle);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('uses the mark read at session start, not one written by a later hide', async () => {
    writeChatAlertLastRunMark(ME, NOW - HOUR);
    renderNotifications();
    // A hide after start moves the stored mark forward...
    writeChatAlertLastRunMark(ME, NOW);
    vi.setSystemTime(NOW + 60 * 60 * 1000);
    // ...but this session still alerts for what arrived after the old mark.
    deliverDm(NOW - 30 * 60 * 1000);
    await advance(CHAT_ALERT_CATCH_UP_SETTLE_MS);
    expect(mocks.fire).toHaveBeenCalledTimes(1);
  });

  it('drops mentions older than the catch-up window', async () => {
    writeChatAlertLastRunMark(ME, NOW - HOUR);
    renderNotifications();
    await deliverMention(NOW - 2 * HOUR);
    await advance(120_000);
    expect(mocks.fire).not.toHaveBeenCalled();
  });

  it('does not post a deferred mention while GO is on screen', async () => {
    writeChatAlertLastRunMark(ME, NOW - HOUR);
    renderNotifications();
    await deliverMention(NOW - 30 * 60 * 1000);
    expect(mocks.fire).not.toHaveBeenCalled();
    mocks.hubViewed.mockReturnValue(true);
    await advance(CHAT_ALERT_CATCH_UP_SETTLE_MS);
    expect(mocks.fire).not.toHaveBeenCalled();
  });

  it('posts a catch-up mention after the settle when GO is off screen', async () => {
    writeChatAlertLastRunMark(ME, NOW - HOUR);
    renderNotifications();
    await deliverMention(NOW - 30 * 60 * 1000);
    await advance(CHAT_ALERT_CATCH_UP_SETTLE_MS);
    expect(mocks.fire).toHaveBeenCalledTimes(1);
    expect(mocks.fire.mock.calls[0][1]).toBe('Mention in Lab');
  });
});
