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
  listeners: {} as Record<string, (event: any) => void>,
  prefs: new Map<string, string>(),
  plugin: {
    getBackgroundSyncState: vi.fn(),
    setBackgroundSyncMode: vi.fn(),
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

import { MobileBackgroundSyncSetting } from './MobileBackgroundSyncSetting';
import { normalizeBackgroundSyncState } from './backgroundSync';
import { initialUiState } from './vendorFreezeHintPolicy';
import {
  VENDOR_FREEZE_HINT_PREFS_KEY,
  resetVendorFreezeHintStoreForTests,
  startVendorFreezeHintStore,
} from './vendorFreezeHintStore';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

const baseState = {
  mode: 'charging',
  charging: false,
  unmetered: false,
  relayProfile: 'leaf',
  keepAliveActive: false,
  vendorFreezeCount: 0,
  vendorFreezeLastAt: null,
  vendorFreezeHintPending: false,
  manufacturer: 'vivo',
};

describe('backgroundSync helpers', () => {
  it('defaults a missing or unknown mode to charging', () => {
    expect(normalizeBackgroundSyncState({})?.mode).toBe('charging');
    expect(normalizeBackgroundSyncState({ mode: 'bogus' })?.mode).toBe(
      'charging'
    );
    expect(normalizeBackgroundSyncState(null)).toBeNull();
  });
});

/** Two 6-hour freezes on the charger in the last two nights. */
const twoNights = () => [
  {
    at: Date.now() - 2 * DAY,
    gapMs: 6 * HOUR,
    ignoring: false,
    charging: true,
  },
  { at: Date.now() - DAY, gapMs: 6 * HOUR, ignoring: false, charging: true },
];

/** The app-wide store, as MobileBackgroundSetup starts it. */
const startStore = async (ui: Record<string, unknown> = {}) => {
  native.prefs.set(
    VENDOR_FREEZE_HINT_PREFS_KEY,
    JSON.stringify({ ...initialUiState(Date.now() - 30 * DAY), ...ui })
  );
  const stop = startVendorFreezeHintStore();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return stop;
};

describe('MobileBackgroundSyncSetting', () => {
  let stopStore: (() => void) | null = null;

  beforeEach(() => {
    resetVendorFreezeHintStoreForTests();
    native.android = true;
    native.listeners = {};
    native.prefs.clear();
    // Mirrors the native side: a successful write is what the next read returns.
    let stored = { ...baseState };
    native.plugin.getBackgroundSyncState.mockImplementation(async () => ({
      ...stored,
    }));
    native.plugin.setBackgroundSyncMode.mockImplementation(
      async ({ mode }: { mode: string }) => {
        stored = { ...stored, mode };
        return { ok: true };
      }
    );
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
      async (name: string, fn: (event: any) => void) => {
        native.listeners[name] = fn;
        return { remove: vi.fn() };
      }
    );
  });
  afterEach(() => {
    stopStore?.();
    stopStore = null;
    resetVendorFreezeHintStoreForTests();
    vi.clearAllMocks();
  });

  it('renders nothing off Android', async () => {
    native.android = false;
    const { container } = render(<MobileBackgroundSyncSetting />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    expect(native.plugin.getBackgroundSyncState).not.toHaveBeenCalled();
  });

  it('renders nothing when the APK lacks the native methods', async () => {
    native.plugin.getBackgroundSyncState.mockRejectedValue(
      new Error('not implemented')
    );
    const { container } = render(<MobileBackgroundSyncSetting />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the stored mode and writes a new one natively', async () => {
    render(<MobileBackgroundSyncSetting />);
    const charging = await screen.findByRole('radio', {
      name: 'While charging',
    });
    expect(charging).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByText(/finishes sending your waiting messages/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Always' }));
    await waitFor(() =>
      expect(native.plugin.setBackgroundSyncMode).toHaveBeenCalledWith({
        mode: 'always',
      })
    );
    expect(screen.getByRole('radio', { name: 'Always' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByText(/noticeably more battery/)).toBeInTheDocument();
  });

  it('reverts and reports when the native write fails', async () => {
    native.plugin.setBackgroundSyncMode.mockResolvedValue({ ok: false });
    render(<MobileBackgroundSyncSetting />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Off' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not change background sync'
    );
    expect(
      screen.getByRole('radio', { name: 'While charging' })
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('shows the outbox note only for While charging', async () => {
    for (const mode of ['off', 'always']) {
      native.plugin.getBackgroundSyncState.mockResolvedValue({
        ...baseState,
        mode,
      });
      const { unmount } = render(<MobileBackgroundSyncSetting />);
      await waitFor(() =>
        expect(
          screen.getByRole('radio', {
            name: mode === 'off' ? 'Off' : 'Always',
          })
        ).toHaveAttribute('aria-checked', 'true')
      );
      // 'Always' keeps syncing on battery; a 3-minute note would read as a cap.
      expect(
        screen.queryByText(/finishes sending your waiting messages/)
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  it('explains relaying in every mode, not as part of While charging', async () => {
    for (const mode of ['off', 'charging', 'always']) {
      native.plugin.getBackgroundSyncState.mockResolvedValue({
        ...baseState,
        mode,
      });
      const { unmount } = render(<MobileBackgroundSyncSetting />);
      expect(
        await screen.findByText(/GO also helps relay messages for others/)
      ).toBeInTheDocument();
      unmount();
    }
    native.plugin.getBackgroundSyncState.mockResolvedValue({ ...baseState });
    render(<MobileBackgroundSyncSetting />);
    expect(
      await screen.findByText('Keeps chat syncing while the phone charges.')
    ).toBeInTheDocument();
  });

  it('shows the live status lines', async () => {
    // What the native side reports while the card is on screen: the keep-alive
    // itself is only active once GO has left the screen.
    native.plugin.getBackgroundSyncState.mockResolvedValue({
      ...baseState,
      mode: 'charging',
      charging: true,
      keepAliveActive: false,
    });
    render(<MobileBackgroundSyncSetting />);
    expect(
      await screen.findByText('Syncing in background now')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Relaying for others/)).not.toBeInTheDocument();

    act(() => native.listeners.relayProfileChanged?.({ profile: 'full' }));
    expect(
      screen.getByText('Relaying for others (charging on Wi-Fi)')
    ).toBeInTheDocument();
  });

  it('hides the syncing line on battery in charging mode', async () => {
    render(<MobileBackgroundSyncSetting />);
    await screen.findByRole('radio', { name: 'While charging' });
    expect(
      screen.queryByText('Syncing in background now')
    ).not.toBeInTheDocument();
  });

  it('ignores a read that raced a mode change', async () => {
    render(<MobileBackgroundSyncSetting />);
    await screen.findByRole('radio', { name: 'While charging' });

    let resolveRead: (value: unknown) => void = () => {};
    native.plugin.getBackgroundSyncState.mockImplementationOnce(
      () => new Promise((resolve) => (resolveRead = resolve))
    );
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Always' }));
    await waitFor(() =>
      expect(native.plugin.setBackgroundSyncMode).toHaveBeenCalled()
    );
    await act(async () => {
      resolveRead({ ...baseState, mode: 'charging' });
    });
    expect(screen.getByRole('radio', { name: 'Always' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('shows no stop notice while nothing was stopped', async () => {
    stopStore = await startStore();
    render(<MobileBackgroundSyncSetting />);
    await screen.findByRole('radio', { name: 'While charging' });
    expect(
      screen.queryByText('GO was stopped in the background')
    ).not.toBeInTheDocument();
  });

  it('shows the stop facts and the brand steps from the store, in place', async () => {
    native.plugin.getBackgroundSyncState.mockResolvedValue({
      ...baseState,
      vendorFreezeRecent: twoNights(),
      ignoringBatteryOptimizations: false,
    });
    stopStore = await startStore();
    render(<MobileBackgroundSyncSetting />);
    expect(
      await screen.findByText('GO was stopped in the background')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your vivo phone stopped GO 2 times in the last 7 days while background sync was on.'
      )
    ).toBeInTheDocument();
    // In the settings: no X, no alert, never a dialog, no outside website.
    expect(
      screen.queryByRole('button', { name: 'Dismiss' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/dontkillmyapp/i);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'How to allow it on your vivo / iQOO',
      })
    );
    expect(
      screen.getByText(
        'Open Settings > Battery > "Background power consumption management".'
      )
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        JSON.parse(native.prefs.get(VENDOR_FREEZE_HINT_PREFS_KEY) ?? '{}')
          .cooldownFrom
      ).toEqual(expect.any(Number))
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Open battery settings' })
    );
    await waitFor(() =>
      expect(native.plugin.openVendorBatterySettings).toHaveBeenCalled()
    );
  });

  it('hides the stop notice at once when background sync is turned off', async () => {
    let stored: Record<string, unknown> = {
      ...baseState,
      vendorFreezeRecent: twoNights(),
      ignoringBatteryOptimizations: false,
    };
    native.plugin.getBackgroundSyncState.mockImplementation(async () => ({
      ...stored,
    }));
    native.plugin.setBackgroundSyncMode.mockImplementation(
      async ({ mode }: { mode: string }) => {
        stored = { ...stored, mode };
        return { ok: true };
      }
    );
    stopStore = await startStore();
    render(<MobileBackgroundSyncSetting />);
    await screen.findByText('GO was stopped in the background');

    fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
    await waitFor(() =>
      expect(
        screen.queryByText('GO was stopped in the background')
      ).not.toBeInTheDocument()
    );
  });

  it('turns the bell warnings back on from the settings', async () => {
    native.plugin.getBackgroundSyncState.mockResolvedValue({
      ...baseState,
      vendorFreezeRecent: twoNights(),
      ignoringBatteryOptimizations: false,
    });
    stopStore = await startStore({ dontShowAgain: true });
    render(<MobileBackgroundSyncSetting />);
    await screen.findByText('GO was stopped in the background');
    expect(
      screen.queryByRole('checkbox', { name: "Don't show again" })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Turn warnings back on' })
    );
    await waitFor(() =>
      expect(
        JSON.parse(native.prefs.get(VENDOR_FREEZE_HINT_PREFS_KEY) ?? '{}')
          .dontShowAgain
      ).toBe(false)
    );
    expect(
      await screen.findByRole('checkbox', { name: "Don't show again" })
    ).not.toBeChecked();
  });
});
