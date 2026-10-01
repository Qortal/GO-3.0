import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';

const native = vi.hoisted(() => ({
  android: true,
  listeners: {} as Record<string, (event: any) => void>,
  plugin: {
    getBackgroundSyncState: vi.fn(),
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

import { VendorFreezeHintDialog } from './VendorFreezeHintDialog';

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

describe('VendorFreezeHintDialog', () => {
  beforeEach(() => {
    native.android = true;
    native.listeners = {};
    native.plugin.getBackgroundSyncState.mockResolvedValue({ ...baseState });
    native.plugin.acknowledgeVendorFreezeHint.mockResolvedValue({ ok: true });
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

  it('shows a pending hint at start, outside notification settings', async () => {
    native.plugin.getBackgroundSyncState.mockResolvedValue({
      ...baseState,
      vendorFreezeHintPending: true,
    });
    render(<VendorFreezeHintDialog />);
    expect(
      await screen.findByRole('dialog', {
        name: 'GO was stopped in the background',
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/Your vivo phone stopped GO/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(native.plugin.acknowledgeVendorFreezeHint).toHaveBeenCalledTimes(1);
  });

  it('shows nothing while no hint is pending, and opens on the live event', async () => {
    render(<VendorFreezeHintDialog />);
    await act(async () => {});
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() =>
      native.listeners.vendorFreezeDetected?.({
        count: 1,
        lastAt: 1_700_000_000_000,
        manufacturer: 'samsung',
      })
    );
    expect(
      await screen.findByText(/Your Samsung phone stopped GO/)
    ).toBeInTheDocument();
  });

  it('re-reads the pending hint when GO returns to the screen', async () => {
    render(<VendorFreezeHintDialog />);
    await act(async () => {});
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    native.plugin.getBackgroundSyncState.mockResolvedValue({
      ...baseState,
      vendorFreezeHintPending: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('waits while another prompt is suspended over it', async () => {
    native.plugin.getBackgroundSyncState.mockResolvedValue({
      ...baseState,
      vendorFreezeHintPending: true,
    });
    const { rerender } = render(<VendorFreezeHintDialog suspended />);
    await act(async () => {});
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<VendorFreezeHintDialog />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('does nothing off Android', async () => {
    native.android = false;
    render(<VendorFreezeHintDialog />);
    await act(async () => {});
    expect(native.plugin.getBackgroundSyncState).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
