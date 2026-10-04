import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';

const native = vi.hoisted(() => ({
  android: true,
  listeners: {} as Record<string, (event: unknown) => void>,
  prefs: new Map<string, string>(),
  plugin: {
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
  };
});
vi.mock('../../plugins/QortalBackground', () => ({
  QortalBackground: native.plugin,
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({
      value: native.prefs.get(key) ?? null,
    })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      native.prefs.set(key, value);
    }),
  },
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
  BackgroundStopNotice,
  BackgroundStopNoticeView,
  type BackgroundStopNoticeActions,
} from './BackgroundStopNotice';
import { initialUiState } from './vendorFreezeHintPolicy';
import {
  VENDOR_FREEZE_HINT_PREFS_KEY,
  resetVendorFreezeHintStoreForTests,
  startVendorFreezeHintStore,
  type VendorFreezeHintSnapshot,
} from './vendorFreezeHintStore';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

const TITLE = 'GO was stopped in the background';

const snapshot = (
  extra: Partial<VendorFreezeHintSnapshot> = {}
): VendorFreezeHintSnapshot => ({
  ready: true,
  manufacturer: 'vivo',
  brand: 'vivo',
  mode: 'charging',
  ignoringBatteryOptimizations: false,
  freezeCount: 4,
  bell: {
    episodes: 2,
    lastAt: NOW - HOUR,
    since: NOW - 7 * DAY,
    variant: 'fixable',
    shownAt: NOW,
    badge: true,
    isNew: false,
  },
  settings: { episodes7d: 2, lastAt: NOW - HOUR, variant: 'fixable' },
  dontShowAgain: false,
  ...extra,
});

const fakeActions = () => ({
  allowInBackground: vi.fn(async () => true),
  closeCard: vi.fn(async () => {}),
  expandSteps: vi.fn(async () => {}),
  openBatterySettings: vi.fn(
    async (): Promise<'vendor' | 'app_details' | null> => 'vendor'
  ),
  setDontShowAgain: vi.fn(async (_value: boolean) => {}),
});

const renderView = (
  variant: 'bell' | 'settings',
  snap: VendorFreezeHintSnapshot = snapshot(),
  actions: BackgroundStopNoticeActions = fakeActions()
) => ({
  actions,
  ...render(
    <BackgroundStopNoticeView
      actions={actions}
      snapshot={snap}
      variant={variant}
    />
  ),
});

describe('BackgroundStopNoticeView', () => {
  it('shows the facts on the bell card, never as a dialog or an alert', () => {
    renderView('bell');
    expect(screen.getByRole('region', { name: TITLE })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your vivo phone stopped GO 2 times in the last 7 days while background sync was on.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('Chats only caught up when you opened GO again.')
    ).toBeInTheDocument();
    expect(screen.getByText(/^Last stopped: /)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // No outside website any more.
    expect(document.body.textContent).not.toMatch(/dontkillmyapp/i);
    expect(document.querySelector('a')).toBeNull();
  });

  it('uses the singular, the unknown brand and the no-number sentence', () => {
    const one = snapshot({
      settings: { episodes7d: 1, lastAt: NOW, variant: 'fixable' },
    });
    const { unmount } = renderView('settings', one);
    expect(
      screen.getByText(
        'Your vivo phone stopped GO 1 time in the last 7 days while background sync was on.'
      )
    ).toBeInTheDocument();
    unmount();

    const unknown = renderView('bell', snapshot({ manufacturer: '' }));
    expect(
      screen.getByText(
        'Your phone stopped GO 2 times in the last 7 days while background sync was on.'
      )
    ).toBeInTheDocument();
    unknown.unmount();

    // The card outlived the 7-day window: no number that is no longer true.
    renderView(
      'bell',
      snapshot({
        manufacturer: 'samsung',
        settings: { episodes7d: 0, lastAt: null, variant: 'none' },
      })
    );
    expect(
      screen.getByText(
        'Your Samsung phone stopped GO in the background while background sync was on.'
      )
    ).toBeInTheDocument();
  });

  it('calls the right store action for each control', async () => {
    const { actions } = renderView('bell');

    fireEvent.click(
      screen.getByRole('button', { name: 'Allow GO in background' })
    );
    expect(actions.allowInBackground).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole('button', { name: 'Open battery settings' })
    );
    expect(actions.openBatterySettings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('checkbox', { name: "Don't show again" }));
    expect(actions.setDontShowAgain).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(actions.closeCard).toHaveBeenCalledTimes(1);
    await act(async () => {});
  });

  it('acknowledges when the steps open, not when they close', () => {
    const { actions } = renderView('bell');
    const toggle = screen.getByRole('button', {
      name: 'How to allow it on your vivo / iQOO',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    // Collapsed steps are unmounted, so nothing to point at.
    expect(toggle).not.toHaveAttribute('aria-controls');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(actions.expandSteps).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    const controlled = document.getElementById(
      toggle.getAttribute('aria-controls') ?? ''
    );
    expect(controlled).toContainElement(screen.getByRole('list'));
    expect(
      screen.getByText(
        'Menu names can differ a little between phone models and Android versions.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("Don't swipe GO away from your recent apps.")
    ).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(actions.expandSteps).toHaveBeenCalledTimes(1);
  });

  it('opens the steps for the way back from the battery settings', async () => {
    const { actions } = renderView('bell');
    fireEvent.click(
      screen.getByRole('button', { name: 'Open battery settings' })
    );
    await act(async () => {});
    expect(actions.openBatterySettings).toHaveBeenCalledTimes(1);
    expect(actions.expandSteps).not.toHaveBeenCalled();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('says so when the settings could not open', async () => {
    const actions = fakeActions();
    actions.openBatterySettings.mockResolvedValue(null);
    renderView('settings', snapshot(), actions);
    // The live region is there, empty, before anything fails, so the text
    // put into it is announced.
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();
    fireEvent.click(
      screen.getByRole('button', { name: 'Open battery settings' })
    );
    expect(
      await screen.findByText(/Could not open the settings/)
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent(/Could not open the settings/);

    actions.allowInBackground.mockResolvedValue(false);
    fireEvent.click(
      screen.getByRole('button', { name: 'Allow GO in background' })
    );
    await act(async () => {});
    expect(screen.getByText(/Could not open the settings/)).toBeInTheDocument();
  });

  it('hides Allow once GO is exempt', () => {
    renderView('bell', snapshot({ ignoringBatteryOptimizations: true }));
    expect(
      screen.queryByRole('button', { name: 'Allow GO in background' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open battery settings' })
    ).toBeInTheDocument();
  });

  it.each([
    [
      'vivo',
      'How to allow it on your vivo / iQOO',
      'Open Settings > Battery > "Background power consumption management".',
      3,
    ],
    [
      'iQOO',
      'How to allow it on your vivo / iQOO',
      'Find GO and choose "Allow" (or "Don\'t restrict").',
      3,
    ],
    [
      'Xiaomi',
      'How to allow it on your Xiaomi / Redmi / POCO',
      'Open Settings > Apps > "Manage apps" > GO.',
      3,
    ],
    [
      'samsung',
      'How to allow it on your Samsung',
      'Open Settings > Apps > GO > Battery and choose "Unrestricted".',
      2,
    ],
    [
      'Google',
      'How to allow it on your phone',
      'Open Settings > Apps > GO > "App battery usage" (or "Battery").',
      2,
    ],
  ])('shows the %s steps', (manufacturer, toggleName, stepText, stepCount) => {
    renderView('settings', snapshot({ manufacturer }));
    fireEvent.click(screen.getByRole('button', { name: toggleName }));
    expect(screen.getByText(stepText)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(stepCount);
  });

  it('settings: no X, and the honest text instead of Allow when exempt', () => {
    renderView(
      'settings',
      snapshot({
        ignoringBatteryOptimizations: true,
        settings: {
          episodes7d: 3,
          lastAt: NOW,
          variant: 'exempt_still_frozen',
        },
      })
    );
    expect(screen.getByRole('region', { name: TITLE })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Battery restrictions are already off for GO, but your vivo phone still stops it while the screen is off. Background sync works while the screen is on; chats catch up when you open GO.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Chats only caught up when you opened GO again.')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Allow GO in background' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Dismiss' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('bell: the honest text when the card turned exempt', () => {
    renderView(
      'bell',
      snapshot({
        manufacturer: '',
        ignoringBatteryOptimizations: true,
        bell: { ...snapshot().bell!, variant: 'exempt_still_frozen' },
      })
    );
    expect(
      screen.getByText(
        /^Battery restrictions are already off for GO, but your phone/
      )
    ).toBeInTheDocument();
  });

  it('settings: ticked off offers to turn the warnings back on', () => {
    const { actions } = renderView(
      'settings',
      snapshot({ dontShowAgain: true })
    );
    expect(
      screen.queryByRole('checkbox', { name: "Don't show again" })
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Turn warnings back on' })
    );
    expect(actions.setDontShowAgain).toHaveBeenCalledWith(false);
  });

  it('settings: only the way back when ticked off and nothing is recent', () => {
    const quiet = {
      bell: null,
      settings: { episodes7d: 0, lastAt: null, variant: 'none' as const },
    };
    const { unmount } = renderView(
      'settings',
      snapshot({ ...quiet, dontShowAgain: true })
    );
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Turn warnings back on' })
    ).toBeInTheDocument();
    unmount();

    const { container, unmount: unmount2 } = renderView(
      'settings',
      snapshot(quiet)
    );
    expect(container).toBeEmptyDOMElement();
    unmount2();

    // Background sync off: nothing at all.
    const off = renderView(
      'settings',
      snapshot({ ...quiet, mode: 'off', dontShowAgain: true })
    );
    expect(off.container).toBeEmptyDOMElement();
  });

  it('bell: nothing without a card, the tick shown ticked when set', () => {
    const { container, unmount } = renderView('bell', snapshot({ bell: null }));
    expect(container).toBeEmptyDOMElement();
    unmount();

    renderView('bell', snapshot({ dontShowAgain: true }));
    expect(
      screen.getByRole('checkbox', { name: "Don't show again" })
    ).toBeChecked();
    // Still readable after ticking; X takes it away.
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });
});

describe('BackgroundStopNotice with the store', () => {
  let nativeState: Record<string, unknown>;
  let stop: (() => void) | null = null;

  const night = (at: number) => ({
    at,
    gapMs: 6 * HOUR,
    ignoring: false,
    charging: true,
  });

  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const storedUi = () =>
    JSON.parse(native.prefs.get(VENDOR_FREEZE_HINT_PREFS_KEY) ?? 'null');

  const startStore = async () => {
    stop = startVendorFreezeHintStore();
    await settle();
  };

  const resume = async () => {
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    resetVendorFreezeHintStoreForTests();
    native.android = true;
    native.listeners = {};
    native.prefs.clear();
    // Installed (and migrated) a month ago; two long freezes since.
    native.prefs.set(
      VENDOR_FREEZE_HINT_PREFS_KEY,
      JSON.stringify(initialUiState(NOW - 30 * DAY))
    );
    nativeState = {
      mode: 'charging',
      manufacturer: 'vivo',
      vendorFreezeCount: 2,
      vendorFreezeRecent: [night(NOW - 2 * DAY), night(NOW - DAY)],
      ignoringBatteryOptimizations: false,
    };
    native.plugin.getBackgroundSyncState.mockImplementation(async () => ({
      ...nativeState,
    }));
    native.plugin.acknowledgeVendorFreezeHint.mockResolvedValue({ ok: true });
    native.plugin.isIgnoringBatteryOptimizations.mockResolvedValue({
      ignoring: false,
    });
    native.plugin.requestIgnoreBatteryOptimizations.mockResolvedValue({
      success: true,
    });
    native.plugin.openAppBatterySettings.mockResolvedValue({ success: true });
    native.plugin.openVendorBatterySettings.mockResolvedValue({
      opened: 'vendor',
    });
    native.plugin.addListener.mockImplementation(
      async (name: string, fn: (event: unknown) => void) => {
        native.listeners[name] = fn;
        return { remove: vi.fn() };
      }
    );
  });

  afterEach(() => {
    stop?.();
    stop = null;
    resetVendorFreezeHintStoreForTests();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('never renders a dialog, also after a resume and the live event', async () => {
    await startStore();
    render(
      <>
        <BackgroundStopNotice variant="bell" />
        <BackgroundStopNotice variant="settings" />
      </>
    );
    expect(screen.getAllByRole('region', { name: TITLE })).toHaveLength(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await resume();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    nativeState = {
      ...nativeState,
      vendorFreezeCount: 3,
      vendorFreezeRecent: [
        night(NOW - 2 * DAY),
        night(NOW - DAY),
        night(NOW - MIN),
      ],
    };
    await act(async () => {
      native.listeners.vendorFreezeDetected?.({
        count: 3,
        lastAt: NOW - MIN,
        manufacturer: 'vivo',
        gapMs: 6 * HOUR,
        ignoring: false,
        charging: true,
      });
    });
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getAllByText(
        'Your vivo phone stopped GO 3 times in the last 7 days while background sync was on.'
      )
    ).toHaveLength(2);
  });

  it('the tick persists and keeps new bell cards away', async () => {
    await startStore();
    const { unmount } = render(<BackgroundStopNotice variant="bell" />);
    expect(screen.getByRole('region', { name: TITLE })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: "Don't show again" }));
    await settle();
    expect(storedUi()).toMatchObject({ dontShowAgain: true });
    // Still readable after ticking (the steps); X takes it away.
    expect(
      screen.getByRole('checkbox', { name: "Don't show again" })
    ).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await settle();
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: TITLE })).toBeNull()
    );

    // Weeks later, more long freezes: no new card while ticked.
    const later = NOW + 20 * DAY;
    vi.setSystemTime(later);
    nativeState = {
      ...nativeState,
      vendorFreezeRecent: [night(later - 2 * DAY), night(later - DAY)],
    };
    await resume();
    expect(screen.queryByRole('region', { name: TITLE })).toBeNull();

    // And after a restart, from what was stored.
    unmount();
    stop?.();
    resetVendorFreezeHintStoreForTests();
    await startStore();
    const restarted = render(<BackgroundStopNotice variant="bell" />);
    await settle();
    expect(screen.queryByRole('region', { name: TITLE })).toBeNull();
    expect(storedUi()).toMatchObject({ dontShowAgain: true });
    restarted.unmount();

    // Without the tick the same facts would have raised a new card.
    native.prefs.set(
      VENDOR_FREEZE_HINT_PREFS_KEY,
      JSON.stringify({ ...storedUi(), dontShowAgain: false })
    );
    stop?.();
    resetVendorFreezeHintStoreForTests();
    await startStore();
    render(<BackgroundStopNotice variant="bell" />);
    await settle();
    expect(screen.getByRole('region', { name: TITLE })).toBeInTheDocument();
  });

  it('adds the card to the bell badge; opening the panel does not acknowledge', async () => {
    await startStore();
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
    await settle();
    expect(storedUi().ackAt).toBe(NOW - 30 * DAY);
    expect(
      screen.getByRole('button', { name: /, 1 unread$/, hidden: true })
    ).toBeInTheDocument();

    // An action clears the badge; the card stays readable.
    fireEvent.click(
      screen.getByRole('button', { name: 'Allow GO in background' })
    );
    await settle();
    expect(native.plugin.requestIgnoreBatteryOptimizations).toHaveBeenCalled();
    expect(storedUi().ackAt).toBe(NOW);
    expect(
      screen.queryByRole('button', { name: /, 1 unread$/, hidden: true })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: TITLE })).toBeInTheDocument();
  });
});
