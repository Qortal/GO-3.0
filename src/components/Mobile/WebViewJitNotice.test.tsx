import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';

const native = vi.hoisted(() => ({
  android: true,
  prefs: new Map<string, string>(),
  prefsReadFails: false,
  runtimeInfo: vi.fn(),
  background: {
    getBackgroundSyncState: vi.fn(),
    acknowledgeVendorFreezeHint: vi.fn(),
    isIgnoringBatteryOptimizations: vi.fn(),
    requestIgnoreBatteryOptimizations: vi.fn(),
    openAppBatterySettings: vi.fn(),
    openVendorBatterySettings: vi.fn(),
    addListener: vi.fn(),
  },
}));

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      isNativePlatform: () => native.android,
      getPlatform: () => (native.android ? 'android' : 'web'),
    },
    registerPlugin: (name: string, ...rest: unknown[]) =>
      name === 'NativeBcrypt'
        ? { runtimeInfo: native.runtimeInfo }
        : (actual.registerPlugin as (...args: unknown[]) => unknown)(
            name,
            ...rest
          ),
  };
});
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => {
      if (native.prefsReadFails) throw new Error('storage busy');
      return { value: native.prefs.get(key) ?? null };
    }),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      native.prefs.set(key, value);
    }),
  },
}));
vi.mock('../../plugins/QortalBackground', () => ({
  QortalBackground: native.background,
}));

// The bell panel's heavy neighbours, not under test here.
vi.mock('../../qortal/get', () => ({ revokeAppNotificationRules: vi.fn() }));
vi.mock('../../qortal/qortal-requests', () => ({
  getAppsWithNotificationPermission: vi.fn(async () => []),
  getNotificationOsPushDisabledMap: vi.fn(async () => ({})),
  getNotificationPermissionKey: vi.fn(() => ''),
  setNotificationOsPushDisabled: vi.fn(),
  setPermission: vi.fn(),
}));
vi.mock('../Chat/MessageDisplay', () => ({ extractComponents: () => null }));

import { GeneralNotifications } from '../GeneralNotifications';
import {
  WEBVIEW_JIT_NOTICE_TEXT_KEYS,
  WebViewJitNotice,
  WebViewJitNoticeView,
} from './WebViewJitNotice';
import {
  WEBVIEW_JIT_NOTICE_PREFS_KEY,
  WEBVIEW_JIT_NOTICE_READ_DELAY_MS,
  acknowledgeWebViewJitNoticeUi,
  applyWebViewJitFlag,
  closeTickedWebViewJitNoticeCardOnStartUi,
  closeWebViewJitNoticeCardUi,
  getWebViewJitNoticeSnapshot,
  initialWebViewJitNoticeUi,
  parseWebViewJitNoticeUi,
  resetWebViewJitNoticeStoreForTests,
  setWebViewJitNoticeDontShowAgainUi,
  startWebViewJitNoticeStore,
  webViewJitNoticeActions,
} from './webViewJitNoticeStore';

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const DAY = 24 * 60 * 60_000;
const TITLE = 'GO runs slower with WebView JIT off';
const LANGS = [
  'ar',
  'de',
  'en',
  'es',
  'et',
  'fi',
  'fr',
  'it',
  'ja',
  'pt',
  'ru',
  'zh',
];

const runtimeInfo = (webViewJitRestricted?: boolean | null) => ({
  debuggable: false,
  poolSize: 7,
  cores: 8,
  probeMs: 4,
  ...(webViewJitRestricted === undefined ? {} : { webViewJitRestricted }),
});

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
};

/** Starts the store as MobileBackgroundSetup does, with no read delay. */
let stop: (() => void) | null = null;
const startStore = async (flag?: boolean | null) => {
  native.runtimeInfo.mockResolvedValue(runtimeInfo(flag));
  stop = startWebViewJitNoticeStore(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  await settle();
};

/** A fresh app start with what is stored now. */
const restart = async (flag?: boolean | null) => {
  stop?.();
  resetWebViewJitNoticeStoreForTests();
  await startStore(flag);
};

const storedUi = () =>
  JSON.parse(native.prefs.get(WEBVIEW_JIT_NOTICE_PREFS_KEY) ?? 'null');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  native.android = true;
  native.prefs.clear();
  native.prefsReadFails = false;
  native.runtimeInfo.mockReset();
  resetWebViewJitNoticeStoreForTests();
});

afterEach(() => {
  stop?.();
  stop = null;
  resetWebViewJitNoticeStoreForTests();
  vi.useRealTimers();
});

describe('applyWebViewJitFlag', () => {
  it('raises one card when JIT is off, and the same card again after that', () => {
    const first = applyWebViewJitFlag(initialWebViewJitNoticeUi(), true, NOW);
    expect(first.card).toEqual({ shownAt: NOW, badge: true });
    expect(first.ui.cardShownAt).toBe(NOW);

    // Later starts: the stored card, not a new one, and nothing to store.
    const again = applyWebViewJitFlag(first.ui, true, NOW + DAY);
    expect(again.card).toEqual({ shownAt: NOW, badge: true });
    expect(again.ui).toBe(first.ui);

    const seen = acknowledgeWebViewJitNoticeUi(first.ui, NOW + 1);
    expect(applyWebViewJitFlag(seen, true, NOW + 2).card).toEqual({
      shownAt: NOW,
      badge: false,
    });
  });

  it('never shows a card when JIT is allowed or the OS has no such flag', () => {
    const fresh = initialWebViewJitNoticeUi();
    for (const flag of [false, null] as const) {
      const result = applyWebViewJitFlag(fresh, flag, NOW);
      expect(result.card).toBeNull();
      expect(result.ui).toBe(fresh);
    }
  });

  it('stays closed after X, and comes back only after JIT was allowed and is off again', () => {
    const shown = applyWebViewJitFlag(
      initialWebViewJitNoticeUi(),
      true,
      NOW
    ).ui;
    const closed = closeWebViewJitNoticeCardUi(shown, NOW + 1);
    expect(applyWebViewJitFlag(closed, true, NOW + 30 * DAY).card).toBeNull();
    expect(applyWebViewJitFlag(closed, null, NOW + 30 * DAY).card).toBeNull();

    const allowed = applyWebViewJitFlag(closed, false, NOW + DAY).ui;
    expect(allowed.rearmed).toBe(true);
    const offAgain = applyWebViewJitFlag(allowed, true, NOW + 2 * DAY);
    expect(offAgain.card).toEqual({ shownAt: NOW + 2 * DAY, badge: true });
  });

  it('honours "Don\'t show again": the open card stays readable, no new card ever', () => {
    const shown = applyWebViewJitFlag(
      initialWebViewJitNoticeUi(),
      true,
      NOW
    ).ui;
    const ticked = setWebViewJitNoticeDontShowAgainUi(shown, true, NOW + 1);
    expect(applyWebViewJitFlag(ticked, true, NOW + 2).card).toEqual({
      shownAt: NOW,
      badge: false,
    });
    const closed = closeWebViewJitNoticeCardUi(ticked, NOW + 3);
    const allowed = applyWebViewJitFlag(closed, false, NOW + DAY).ui;
    expect(applyWebViewJitFlag(allowed, true, NOW + 2 * DAY).card).toBeNull();
  });

  it('closes a ticked card that was never closed at the next start only', () => {
    const shown = applyWebViewJitFlag(
      initialWebViewJitNoticeUi(),
      true,
      NOW
    ).ui;
    // Not ticked, or already closed: unchanged (same object).
    expect(closeTickedWebViewJitNoticeCardOnStartUi(shown, NOW + DAY)).toBe(
      shown
    );
    const ticked = setWebViewJitNoticeDontShowAgainUi(shown, true, NOW + 1);
    const closedByX = closeWebViewJitNoticeCardUi(ticked, NOW + 2);
    expect(closeTickedWebViewJitNoticeCardOnStartUi(closedByX, NOW + DAY)).toBe(
      closedByX
    );
    const fresh = initialWebViewJitNoticeUi();
    expect(
      closeTickedWebViewJitNoticeCardOnStartUi(
        { ...fresh, dontShowAgain: true },
        NOW
      ).cardClosed
    ).toBe(false);
    // Ticked and left open: closed now, and no card on any later start.
    const started = closeTickedWebViewJitNoticeCardOnStartUi(ticked, NOW + DAY);
    expect(started).toMatchObject({ cardClosed: true, dontShowAgain: true });
    expect(applyWebViewJitFlag(started, true, NOW + DAY).card).toBeNull();
  });

  it('reads only its own stored shape', () => {
    expect(parseWebViewJitNoticeUi('not json')).toBeNull();
    expect(parseWebViewJitNoticeUi('[1]')).toBeNull();
    expect(
      parseWebViewJitNoticeUi(
        JSON.stringify({ dontShowAgain: 'yes', cardShownAt: -4, ackAt: NOW })
      )
    ).toEqual({
      dontShowAgain: false,
      cardShownAt: null,
      cardClosed: false,
      ackAt: NOW,
      rearmed: false,
    });
  });
});

describe('webViewJitNoticeStore', () => {
  it('reads the flag only after the start-up delay', async () => {
    native.runtimeInfo.mockResolvedValue(runtimeInfo(true));
    stop = startWebViewJitNoticeStore();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WEBVIEW_JIT_NOTICE_READ_DELAY_MS - 50);
    });
    expect(native.runtimeInfo).not.toHaveBeenCalled();
    expect(getWebViewJitNoticeSnapshot().card).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await settle();
    expect(native.runtimeInfo).toHaveBeenCalledTimes(1);
    const card = getWebViewJitNoticeSnapshot().card;
    expect(card?.badge).toBe(true);
    expect(card?.shownAt).toBeGreaterThanOrEqual(
      NOW + WEBVIEW_JIT_NOTICE_READ_DELAY_MS
    );
  });

  it.each([
    ['JIT allowed', false],
    ['no GrapheneOS flag', null],
    ['an older app without the field', undefined],
  ])('shows nothing with %s', async (_label, flag) => {
    await startStore(flag);
    expect(getWebViewJitNoticeSnapshot()).toMatchObject({
      ready: true,
      card: null,
    });
    render(<WebViewJitNotice />);
    expect(screen.queryByRole('region', { name: TITLE })).toBeNull();
    // Nothing worth storing either.
    expect(native.prefs.has(WEBVIEW_JIT_NOTICE_PREFS_KEY)).toBe(false);
  });

  it('shows nothing when the native call fails, and does nothing off Android', async () => {
    native.runtimeInfo.mockRejectedValue(new Error('no plugin'));
    stop = startWebViewJitNoticeStore(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await settle();
    expect(getWebViewJitNoticeSnapshot().card).toBeNull();

    stop();
    resetWebViewJitNoticeStoreForTests();
    native.android = false;
    native.runtimeInfo.mockReset();
    stop = startWebViewJitNoticeStore(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(native.runtimeInfo).not.toHaveBeenCalled();
    expect(getWebViewJitNoticeSnapshot().ready).toBe(false);
  });

  it('shows the card once: the same card after a restart, gone for good after X', async () => {
    await startStore(true);
    const view = render(<WebViewJitNotice />);
    expect(screen.getByRole('region', { name: TITLE })).toBeInTheDocument();
    expect(storedUi()).toMatchObject({ cardShownAt: NOW, cardClosed: false });
    view.unmount();

    vi.setSystemTime(NOW + DAY);
    await restart(true);
    expect(getWebViewJitNoticeSnapshot().card?.shownAt).toBe(NOW);

    const again = render(<WebViewJitNotice />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await settle();
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: TITLE })).toBeNull()
    );
    expect(storedUi()).toMatchObject({ cardClosed: true });
    again.unmount();

    vi.setSystemTime(NOW + 40 * DAY);
    await restart(true);
    render(<WebViewJitNotice />);
    expect(screen.queryByRole('region', { name: TITLE })).toBeNull();
  });

  it('keeps "Don\'t show again" across restarts, even when JIT is turned off again', async () => {
    await startStore(true);
    render(<WebViewJitNotice />);
    fireEvent.click(screen.getByRole('checkbox', { name: "Don't show again" }));
    await settle();
    expect(storedUi()).toMatchObject({ dontShowAgain: true });
    // Still readable after ticking; X takes it away.
    expect(
      screen.getByRole('checkbox', { name: "Don't show again" })
    ).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await settle();

    await restart(false); // JIT allowed for a while...
    await restart(true); // ...and off again: still nothing, it was ticked.
    expect(getWebViewJitNoticeSnapshot().card).toBeNull();
    expect(storedUi()).toMatchObject({ dontShowAgain: true });

    // Without the tick the same history would have raised one more card.
    native.prefs.set(
      WEBVIEW_JIT_NOTICE_PREFS_KEY,
      JSON.stringify({ ...storedUi(), dontShowAgain: false, rearmed: true })
    );
    await restart(true);
    expect(getWebViewJitNoticeSnapshot().card).not.toBeNull();
  });

  it('a ticked card left open is readable this session and gone from the next start', async () => {
    await startStore(true);
    const view = render(<WebViewJitNotice />);
    fireEvent.click(screen.getByRole('checkbox', { name: "Don't show again" }));
    await settle();
    // No X: still readable for the rest of this session.
    expect(screen.getByRole('region', { name: TITLE })).toBeInTheDocument();
    expect(storedUi()).toMatchObject({
      dontShowAgain: true,
      cardClosed: false,
    });
    view.unmount();

    for (const days of [1, 7, 30]) {
      vi.setSystemTime(NOW + days * DAY);
      await restart(true);
      expect(getWebViewJitNoticeSnapshot().card).toBeNull();
    }
    expect(storedUi()).toMatchObject({ dontShowAgain: true, cardClosed: true });
  });

  it('shows no card while the stored state cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    native.prefsReadFails = true;
    await startStore(true);
    expect(getWebViewJitNoticeSnapshot().card).toBeNull();
    await act(async () => {
      await webViewJitNoticeActions.closeCard();
    });
    expect(native.prefs.has(WEBVIEW_JIT_NOTICE_PREFS_KEY)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('WebViewJitNotice text', () => {
  it('has every text in all 12 locales, with no web address or link', () => {
    const urlLike = /(https?:|:\/\/|www\.|\.(com|org|net|io|app|dev)\b)/i;
    for (const lang of LANGS) {
      const core = JSON.parse(
        readFileSync(
          resolve(process.cwd(), `src/i18n/locales/${lang}/core.json`),
          'utf8'
        )
      );
      for (const key of WEBVIEW_JIT_NOTICE_TEXT_KEYS) {
        const path = key.replace(/^core:/, '').split('.');
        const value = path.reduce(
          (node: Record<string, unknown> | undefined, part) =>
            node?.[part] as Record<string, unknown> | undefined,
          core
        ) as unknown;
        expect(typeof value, `${lang} ${key}`).toBe('string');
        expect(String(value), `${lang} ${key}`).not.toMatch(urlLike);
      }
    }
  });

  it('renders the steps in the app, with no link and no dialog', () => {
    const actions = {
      closeCard: vi.fn(async () => {}),
      setDontShowAgain: vi.fn(async (_value: boolean) => {}),
    };
    const { container } = render(
      <WebViewJitNoticeView
        actions={actions}
        snapshot={{
          ready: true,
          card: { shownAt: NOW, badge: true },
          dontShowAgain: false,
        }}
      />
    );
    const card = screen.getByRole('region', { name: TITLE });
    expect(
      within(card).getByText(
        'Open Settings > Apps > GO > "Exploit protection".'
      )
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        'Allow "WebView JIT". GO uses the new setting the next time it starts.'
      )
    ).toBeInTheDocument();
    expect(within(card).getByText(/security setting/)).toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.textContent).not.toMatch(/https?:|www\./i);

    fireEvent.click(screen.getByRole('checkbox', { name: "Don't show again" }));
    expect(actions.setDontShowAgain).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(actions.closeCard).toHaveBeenCalled();
  });
});

describe('WebViewJitNotice in the bell panel', () => {
  it('counts 1 on the bell until the panel was seen, then stays until X', async () => {
    await startStore(true);
    render(<GeneralNotifications />);
    const bell = screen.getByRole('button', { name: /, 1 unread$/ });

    fireEvent.click(bell);
    const card = await screen.findByRole('region', { name: TITLE });
    // At the top of the panel, above the push switch.
    const pushRow = screen.getByText(/push notifications/i);
    expect(
      card.compareDocumentPosition(pushRow) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Closing the panel counts as seen: the badge goes, the card stays.
    fireEvent.keyDown(card, { key: 'Escape' });
    await settle();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /, 1 unread$/, hidden: true })
      ).not.toBeInTheDocument()
    );
    expect(storedUi().ackAt).toBeGreaterThanOrEqual(NOW);
    expect(getWebViewJitNoticeSnapshot().card).toEqual({
      shownAt: NOW,
      badge: false,
    });
  });

  it('clears the badge however the panel closes (here: History)', async () => {
    await startStore(true);
    render(<GeneralNotifications />);
    fireEvent.click(screen.getByRole('button', { name: /, 1 unread$/ }));
    await screen.findByRole('region', { name: TITLE });
    // History closes the panel directly, not through its own close handler.
    fireEvent.click(screen.getByText('Notification history'));
    await settle();
    await waitFor(() =>
      expect(getWebViewJitNoticeSnapshot().card).toEqual({
        shownAt: NOW,
        badge: false,
      })
    );
    expect(storedUi().ackAt).toBeGreaterThanOrEqual(NOW);
  });

  it('is not in the panel when JIT is allowed', async () => {
    await startStore(false);
    render(<GeneralNotifications />);
    expect(
      screen.queryByRole('button', { name: /, 1 unread$/ })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    await settle();
    expect(screen.queryByRole('region', { name: TITLE })).toBeNull();
  });
});
