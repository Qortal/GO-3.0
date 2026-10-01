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
  plugin: {
    getBackgroundSyncState: vi.fn(),
    setBackgroundSyncMode: vi.fn(),
    acknowledgeVendorFreezeHint: vi.fn(),
    openAppBatterySettings: vi.fn(),
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
vi.mock('../../utils/openExternalHttp', () => ({
  openHttpUrlExternally: vi.fn(() => true),
}));

import { MobileBackgroundSyncSetting } from './MobileBackgroundSyncSetting';
import {
  dontKillMyAppUrl,
  normalizeBackgroundSyncState,
} from './backgroundSync';
import { openHttpUrlExternally } from '../../utils/openExternalHttp';

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
  it('links known vendors and aliases, else the general page', () => {
    expect(dontKillMyAppUrl('vivo')).toBe('https://dontkillmyapp.com/vivo');
    expect(dontKillMyAppUrl('Xiaomi')).toBe('https://dontkillmyapp.com/xiaomi');
    expect(dontKillMyAppUrl('HMD Global')).toBe(
      'https://dontkillmyapp.com/nokia'
    );
    expect(dontKillMyAppUrl('Acme')).toBe('https://dontkillmyapp.com/general');
    expect(dontKillMyAppUrl('')).toBe('https://dontkillmyapp.com/general');
  });

  it('defaults a missing or unknown mode to charging', () => {
    expect(normalizeBackgroundSyncState({})?.mode).toBe('charging');
    expect(normalizeBackgroundSyncState({ mode: 'bogus' })?.mode).toBe(
      'charging'
    );
    expect(normalizeBackgroundSyncState(null)).toBeNull();
  });
});

describe('MobileBackgroundSyncSetting', () => {
  beforeEach(() => {
    native.android = true;
    native.listeners = {};
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
    native.plugin.openAppBatterySettings.mockResolvedValue({ success: true });
    native.plugin.addListener.mockImplementation(
      async (name: string, fn: (event: any) => void) => {
        native.listeners[name] = fn;
        return { remove: vi.fn() };
      }
    );
  });
  afterEach(() => {
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

  it('ignores a read that raced a dismiss', async () => {
    native.plugin.getBackgroundSyncState.mockResolvedValue({
      ...baseState,
      vendorFreezeHintPending: true,
    });
    render(<MobileBackgroundSyncSetting />);
    await screen.findByText(/stopped GO/);

    let resolveRead: (value: unknown) => void = () => {};
    native.plugin.getBackgroundSyncState.mockImplementationOnce(
      () => new Promise((resolve) => (resolveRead = resolve))
    );
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await act(async () => {
      resolveRead({ ...baseState, vendorFreezeHintPending: true });
    });
    expect(screen.queryByText(/stopped GO/)).not.toBeInTheDocument();
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

  it('shows the vendor-freeze notice from state and dismisses it', async () => {
    native.plugin.getBackgroundSyncState.mockResolvedValue({
      ...baseState,
      vendorFreezeHintPending: true,
      vendorFreezeCount: 2,
    });
    render(<MobileBackgroundSyncSetting />);
    expect(
      await screen.findByText(/Your vivo phone stopped GO/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Step-by-step guide/ }));
    expect(openHttpUrlExternally).toHaveBeenCalledWith(
      'https://dontkillmyapp.com/vivo'
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Open battery settings' })
    );
    expect(native.plugin.openAppBatterySettings).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(native.plugin.acknowledgeVendorFreezeHint).toHaveBeenCalled();
    expect(screen.queryByText(/stopped GO/)).not.toBeInTheDocument();
  });

  it('opens the notice when the native event arrives', async () => {
    render(<MobileBackgroundSyncSetting />);
    await screen.findByRole('radio', { name: 'Off' });
    expect(screen.queryByText(/stopped GO/)).not.toBeInTheDocument();

    act(() =>
      native.listeners.vendorFreezeDetected?.({
        count: 1,
        lastAt: 1_700_000_000_000,
        manufacturer: 'samsung',
      })
    );
    expect(
      screen.getByText(/Your Samsung phone stopped GO/)
    ).toBeInTheDocument();
  });
});
