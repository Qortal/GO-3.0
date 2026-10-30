import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_ALERT_MAX_CATCH_UP_MS,
  chatAlertFloor,
  createChatAlertCoalescer,
  isChatAlertCatchUp,
  readChatAlertLastRunMark,
  unreadDirectMessageCount,
  writeChatAlertLastRunMark,
  dismissShownAlert,
  forgetShownAlert,
  hashNotificationId,
  listShownAlertKeys,
  rememberShownAlert,
  reticulumDmAlertKey,
  reticulumMentionAlertKey,
  wasAlertShown,
} from './reticulumChatAlerts';

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    createChannel: vi.fn(async () => undefined),
    checkPermissions: vi.fn(async () => ({ display: 'granted' })),
    requestPermissions: vi.fn(async () => ({ display: 'granted' })),
  },
}));

const dismissChatAlertNotification = vi.fn(async () => ({ success: true }));
vi.mock('../plugins/QortalBackground', () => ({
  QortalBackground: {
    dismissChatAlertNotification: (...args: unknown[]) =>
      dismissChatAlertNotification(...(args as [])),
    showAlertNotification: vi.fn(async () => ({ success: true })),
    dismissChatAlertNotifications: vi.fn(async () => ({ success: true })),
  },
}));

vi.mock('./platform', () => ({
  isCapacitor: () => true,
  isElectron: () => false,
  isMobileViewport: () => false,
}));

/** The hash `mobileOsNotifications` used before it moved; ids must not drift. */
const legacyHashNotificationId = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return (hash % 90000) + 1000;
};

const clearRegistry = () => {
  listShownAlertKeys().forEach((key) => forgetShownAlert(key));
};

describe('reticulumChatAlerts keys and ids', () => {
  it('builds stable per-conversation keys', () => {
    expect(reticulumDmAlertKey('QabcPeer')).toBe('reticulum-dm:QabcPeer');
    expect(reticulumMentionAlertKey(42)).toBe('reticulum-mention:42');
    expect(reticulumMentionAlertKey('42')).toBe('reticulum-mention:42');
  });

  it('keeps hashNotificationId identical to the legacy hash', () => {
    const samples = [
      'reticulum-dm:QabcPeer',
      'reticulum-mention:42',
      'chat_notification_direct_pm_summary',
      '',
      'ünïcödé ✓ key',
      'a'.repeat(200),
    ];
    for (const sample of samples) {
      expect(hashNotificationId(sample)).toBe(legacyHashNotificationId(sample));
    }
    expect(hashNotificationId('reticulum-dm:QabcPeer')).toBe(
      hashNotificationId('reticulum-dm:QabcPeer')
    );
  });

  it('keeps ids inside the 1000..90999 range', () => {
    for (const sample of ['x', 'reticulum-dm:Q1', 'reticulum-mention:99']) {
      const id = hashNotificationId(sample);
      expect(id).toBeGreaterThanOrEqual(1000);
      expect(id).toBeLessThan(91000);
      expect(Number.isInteger(id)).toBe(true);
    }
  });
});

describe('shown-alert registry', () => {
  beforeEach(clearRegistry);
  afterEach(clearRegistry);

  it('remembers, lists and forgets keys', () => {
    expect(wasAlertShown('reticulum-dm:Q1')).toBe(false);
    rememberShownAlert('reticulum-dm:Q1');
    rememberShownAlert('reticulum-dm:Q1');
    rememberShownAlert('reticulum-mention:7');
    expect(wasAlertShown('reticulum-dm:Q1')).toBe(true);
    expect(listShownAlertKeys().sort()).toEqual([
      'reticulum-dm:Q1',
      'reticulum-mention:7',
    ]);
    forgetShownAlert('reticulum-dm:Q1');
    expect(wasAlertShown('reticulum-dm:Q1')).toBe(false);
    expect(listShownAlertKeys()).toEqual(['reticulum-mention:7']);
  });

  it('ignores empty keys', () => {
    rememberShownAlert('');
    expect(listShownAlertKeys()).toEqual([]);
    expect(wasAlertShown('')).toBe(false);
  });
});

describe('dismissShownAlert', () => {
  beforeEach(() => {
    clearRegistry();
    dismissChatAlertNotification.mockClear();
  });
  afterEach(clearRegistry);

  it('is a no-op for keys that were never shown', () => {
    const dismissNative = vi.fn();
    const closeDesktop = vi.fn();
    expect(
      dismissShownAlert('reticulum-dm:Qnever', {
        isNative: true,
        dismissNative,
        closeDesktop,
      })
    ).toBe(false);
    expect(
      dismissShownAlert('reticulum-dm:Qnever', {
        isNative: false,
        dismissNative,
        closeDesktop,
      })
    ).toBe(false);
    expect(dismissNative).not.toHaveBeenCalled();
    expect(closeDesktop).not.toHaveBeenCalled();
  });

  it('dismisses natively once and forgets the key', () => {
    const key = reticulumDmAlertKey('Qshown');
    const dismissNative = vi.fn();
    const closeDesktop = vi.fn();
    rememberShownAlert(key);
    expect(
      dismissShownAlert(key, { isNative: true, dismissNative, closeDesktop })
    ).toBe(true);
    expect(dismissNative).toHaveBeenCalledWith(key);
    expect(closeDesktop).not.toHaveBeenCalled();
    expect(wasAlertShown(key)).toBe(false);
    // Second call: nothing to dismiss any more.
    expect(
      dismissShownAlert(key, { isNative: true, dismissNative, closeDesktop })
    ).toBe(false);
    expect(dismissNative).toHaveBeenCalledTimes(1);
  });

  it('closes the desktop notification on non-native platforms', () => {
    const key = reticulumMentionAlertKey(7);
    const dismissNative = vi.fn();
    const closeDesktop = vi.fn();
    rememberShownAlert(key);
    dismissShownAlert(key, { isNative: false, dismissNative, closeDesktop });
    expect(closeDesktop).toHaveBeenCalledWith(key);
    expect(dismissNative).not.toHaveBeenCalled();
    expect(wasAlertShown(key)).toBe(false);
  });

  it('forgets the key even when the handler throws', () => {
    const key = reticulumDmAlertKey('Qthrow');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    rememberShownAlert(key);
    expect(
      dismissShownAlert(key, {
        isNative: true,
        dismissNative: () => {
          throw new Error('boom');
        },
        closeDesktop: vi.fn(),
      })
    ).toBe(true);
    expect(wasAlertShown(key)).toBe(false);
    consoleError.mockRestore();
  });

  it('routes the native dismiss to the plugin by (hashed id, tag)', async () => {
    const { dismissChatOsNotification } =
      await import('./mobileOsNotifications');
    const key = reticulumDmAlertKey('QpluginPeer');

    // Never shown: the wrapper must not reach the plugin.
    dismissShownAlert(key, {
      isNative: true,
      dismissNative: (alertKey) => {
        void dismissChatOsNotification(alertKey);
      },
      closeDesktop: vi.fn(),
    });
    expect(dismissChatAlertNotification).not.toHaveBeenCalled();

    rememberShownAlert(key);
    dismissShownAlert(key, {
      isNative: true,
      dismissNative: (alertKey) => {
        void dismissChatOsNotification(alertKey);
      },
      closeDesktop: vi.fn(),
    });
    await Promise.resolve();
    expect(dismissChatAlertNotification).toHaveBeenCalledTimes(1);
    expect(dismissChatAlertNotification).toHaveBeenCalledWith({
      alertId: hashNotificationId(key),
      alertTag: key,
    });
  });

  it('never throws from dismissChatOsNotification when the plugin fails', async () => {
    const { dismissChatOsNotification } =
      await import('./mobileOsNotifications');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    dismissChatAlertNotification.mockRejectedValueOnce(new Error('no plugin'));
    await expect(
      dismissChatOsNotification(reticulumDmAlertKey('Qfail'))
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('catch-up alert window', () => {
  const NOW = 1_800_000_000_000;

  afterEach(() => {
    window.localStorage.clear();
  });

  it('starts at listeningSince - 60 s without a last-run mark', () => {
    expect(chatAlertFloor({ listeningSince: NOW, now: NOW })).toBe(
      NOW - 60_000
    );
  });

  it('reaches back to the last run so catch-up messages alert', () => {
    const lastRunMark = NOW - 3 * 60 * 60 * 1000;
    expect(chatAlertFloor({ listeningSince: NOW, lastRunMark, now: NOW })).toBe(
      lastRunMark - 60_000
    );
  });

  it('never reaches back more than 7 days', () => {
    expect(
      chatAlertFloor({
        listeningSince: NOW,
        lastRunMark: NOW - 30 * 24 * 60 * 60 * 1000,
        now: NOW,
      })
    ).toBe(NOW - CHAT_ALERT_MAX_CATCH_UP_MS);
  });

  it('ignores a mark newer than the listener start', () => {
    expect(
      chatAlertFloor({
        listeningSince: NOW - 1000,
        lastRunMark: NOW,
        now: NOW,
      })
    ).toBe(NOW - 1000 - 60_000);
  });

  it('stores the last-run mark per account', () => {
    expect(readChatAlertLastRunMark('Qa')).toBeNull();
    writeChatAlertLastRunMark('Qa', NOW);
    expect(readChatAlertLastRunMark('Qa')).toBe(NOW);
    expect(readChatAlertLastRunMark('Qb')).toBeNull();
  });
});

describe('chat alert coalescer', () => {
  const makeClock = () => {
    let now = 0;
    let timer: { callback: () => void; at: number } | null = null;
    return {
      now: () => now,
      setTimer: (callback: () => void, ms: number) => {
        timer = { callback, at: now + ms };
        return timer;
      },
      clearTimer: (handle: unknown) => {
        if (handle === timer) timer = null;
      },
      advance: (ms: number) => {
        now += ms;
        if (timer && timer.at <= now) {
          const { callback } = timer;
          timer = null;
          callback();
        }
      },
      armed: () => timer !== null,
    };
  };

  it('posts the first alert at once and then at most one per 60 s', () => {
    const clock = makeClock();
    const coalescer = createChatAlertCoalescer(clock);
    const posted: string[] = [];
    const post = (name: string) => () => {
      posted.push(name);
      return true;
    };
    coalescer.offer('dm:a', post('a1'));
    coalescer.offer('dm:a', post('a2'));
    coalescer.offer('dm:b', post('b1'));
    coalescer.offer('dm:c', post('c1'));
    expect(posted).toEqual(['a1']);
    expect(clock.armed()).toBe(true);

    clock.advance(59_999);
    expect(posted).toEqual(['a1']);
    clock.advance(1);
    // Only the newest waiting alert sounds when the window ends.
    expect(posted).toEqual(['a1', 'c1']);
    expect(clock.armed()).toBe(false);

    clock.advance(60_000);
    coalescer.offer('dm:d', post('d1'));
    expect(posted).toEqual(['a1', 'c1', 'd1']);
  });

  it('does not post alerts cancelled while they wait', () => {
    const clock = makeClock();
    const coalescer = createChatAlertCoalescer(clock);
    const posted: string[] = [];
    coalescer.offer('dm:a', () => (posted.push('a'), true));
    coalescer.offer('dm:b', () => (posted.push('b'), true));
    expect(coalescer.isPending('dm:b')).toBe(true);
    coalescer.cancel('dm:b');
    expect(coalescer.isPending('dm:b')).toBe(false);
    expect(clock.armed()).toBe(false);
    clock.advance(120_000);
    expect(posted).toEqual(['a']);
  });

  it('falls back to an older waiting alert when the newest is unwanted', () => {
    const clock = makeClock();
    const coalescer = createChatAlertCoalescer(clock);
    const posted: string[] = [];
    coalescer.offer('dm:a', () => (posted.push('a'), true));
    coalescer.offer('dm:b', () => (posted.push('b'), true));
    coalescer.offer('dm:c', () => false);
    clock.advance(60_000);
    expect(posted).toEqual(['a', 'b']);
  });

  it('does not count an unwanted alert against the audible budget', () => {
    const clock = makeClock();
    const coalescer = createChatAlertCoalescer(clock);
    const posted: string[] = [];
    coalescer.offer('dm:a', () => false);
    coalescer.offer('dm:b', () => (posted.push('b'), true));
    expect(posted).toEqual(['b']);
    expect(clock.armed()).toBe(false);
  });

  it('clear drops waiting alerts and the timer', () => {
    const clock = makeClock();
    const coalescer = createChatAlertCoalescer(clock);
    const posted: string[] = [];
    coalescer.offer('dm:a', () => (posted.push('a'), true));
    coalescer.offer('dm:b', () => (posted.push('b'), true));
    coalescer.clear();
    expect(clock.armed()).toBe(false);
    clock.advance(120_000);
    expect(posted).toEqual(['a']);
  });
  it('holds catch-up alerts for the settle and posts only the newest', () => {
    const clock = makeClock();
    const coalescer = createChatAlertCoalescer(clock);
    const posted: string[] = [];
    const post = (name: string) => () => (posted.push(name), true);
    coalescer.offer('dm:a', post('a'), { settleMs: 10_000 });
    clock.advance(500);
    coalescer.offer('dm:b', post('b'), { settleMs: 10_000 });
    expect(posted).toEqual([]);
    clock.advance(9_500);
    // b was offered 9.5 s ago and is not due yet: only a posts.
    expect(posted).toEqual(['a']);
    expect(clock.armed()).toBe(true);
    clock.advance(59_999);
    expect(posted).toEqual(['a']);
    clock.advance(1);
    expect(posted).toEqual(['a', 'b']);
    expect(clock.armed()).toBe(false);
  });

  it('drops a catch-up alert cancelled by a read sync during the settle', () => {
    const clock = makeClock();
    const coalescer = createChatAlertCoalescer(clock);
    const posted: string[] = [];
    coalescer.offer('dm:a', () => (posted.push('a'), true), {
      settleMs: 10_000,
    });
    coalescer.cancel('dm:a');
    expect(clock.armed()).toBe(false);
    clock.advance(120_000);
    expect(posted).toEqual([]);
  });

  it('awaits async posts and falls back when one resolves unwanted', async () => {
    const clock = makeClock();
    const coalescer = createChatAlertCoalescer(clock);
    const posted: string[] = [];
    coalescer.offer('dm:a', async () => (posted.push('a'), true), {
      settleMs: 10_000,
    });
    coalescer.offer('dm:b', async () => false, { settleMs: 10_000 });
    clock.advance(10_000);
    expect(coalescer.isPending('dm:a')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(posted).toEqual(['a']);
    expect(coalescer.isPending('dm:a')).toBe(false);
    expect(clock.armed()).toBe(false);
  });

  it('tells an async post it was cancelled while it checked', async () => {
    const clock = makeClock();
    const coalescer = createChatAlertCoalescer(clock);
    let release: () => void = () => undefined;
    const seen: boolean[] = [];
    coalescer.offer(
      'dm:a',
      async (isCancelled) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        seen.push(isCancelled());
        return !isCancelled();
      },
      { settleMs: 10_000 }
    );
    clock.advance(10_000);
    coalescer.cancel('dm:a');
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([true]);
  });
});

describe('catch-up classification', () => {
  const NOW = 1_800_000_000_000;

  it('treats messages older than the clock skew as catch-up', () => {
    expect(isChatAlertCatchUp({ timestamp: NOW, now: NOW })).toBe(false);
    expect(isChatAlertCatchUp({ timestamp: NOW - 60_000, now: NOW })).toBe(
      false
    );
    expect(isChatAlertCatchUp({ timestamp: NOW - 60_001, now: NOW })).toBe(
      true
    );
    expect(isChatAlertCatchUp({ timestamp: Number.NaN, now: NOW })).toBe(false);
  });

  it('counts unread DM messages without missed calls', () => {
    expect(
      unreadDirectMessageCount(
        [
          { peerAddress: 'Qx', unreadCount: 5 },
          { peerAddress: 'Qa', unreadCount: 3, unreadMissedCallCount: 1 },
        ],
        'Qa'
      )
    ).toBe(2);
    expect(unreadDirectMessageCount(null, 'Qa')).toBe(0);
    expect(unreadDirectMessageCount([], 'Qa')).toBe(0);
  });
});
