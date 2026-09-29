import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chatAlertIdFromKey,
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

  it('keeps chatAlertIdFromKey identical to the legacy hash', () => {
    const samples = [
      'reticulum-dm:QabcPeer',
      'reticulum-mention:42',
      'chat_notification_direct_pm_summary',
      '',
      'ünïcödé ✓ key',
      'a'.repeat(200),
    ];
    for (const sample of samples) {
      expect(chatAlertIdFromKey(sample)).toBe(legacyHashNotificationId(sample));
      expect(hashNotificationId(sample)).toBe(legacyHashNotificationId(sample));
    }
    expect(chatAlertIdFromKey('reticulum-dm:QabcPeer')).toBe(
      chatAlertIdFromKey('reticulum-dm:QabcPeer')
    );
  });

  it('keeps ids inside the 1000..90999 range', () => {
    for (const sample of ['x', 'reticulum-dm:Q1', 'reticulum-mention:99']) {
      const id = chatAlertIdFromKey(sample);
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
      alertId: chatAlertIdFromKey(key),
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
