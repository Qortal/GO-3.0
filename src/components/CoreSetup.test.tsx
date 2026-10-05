import { act, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOpenCoreSetup } from '../atoms/global';
import { CoreSetup } from './CoreSetup';

// The desktop "Set up Qortal Core" window, reduced to whether it is open.
vi.mock('./CoreSetupDialog', () => ({
  CoreSetupDialog: ({ open }: { open: boolean }) => (
    <div data-testid="core-setup-dialog" data-open={String(open)} />
  ),
}));
vi.mock('./CoreSetupResetApikeyDialog', () => ({
  CoreSetupResetApikeyDialog: () => <div data-testid="reset-apikey-dialog" />,
}));
vi.mock('./CustomNodeApikeyDialog', () => ({
  CustomNodeApikeyDialog: () => <div data-testid="custom-apikey-dialog" />,
}));
vi.mock('./CoreSyncing', () => ({ CoreSyncing: () => null }));
vi.mock('./CoreSettingUp', () => ({ CoreSettingUp: () => null }));
vi.mock('./CoreUrlInvalid', () => ({ CoreUrlInvalid: () => null }));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    authenticate: vi.fn(),
    getBalanceFunc: vi.fn(),
    handleSaveNodeInfo: vi.fn(),
  }),
}));
vi.mock('../background/background', () => ({
  cleanUrl: (url?: string) => url?.replace(/^(https?:\/\/)?(www\.)?/, ''),
}));

async function renderOpenCoreSetup() {
  const store = createStore();
  // Whatever asked for it (an unlock that found no node, say).
  store.set(isOpenCoreSetup, true);
  render(
    <Provider store={store}>
      <CoreSetup />
    </Provider>
  );
  // Let the desktop's Core status check settle.
  await act(async () => {});
}

describe('CoreSetup', () => {
  afterEach(() => {
    delete (window as any).Capacitor;
    delete (window as any).coreSetup;
  });

  it('never opens the Core window on GO, but keeps the API key dialogs', async () => {
    (window as any).Capacitor = { isNativePlatform: () => true };

    await renderOpenCoreSetup();

    expect(screen.getByTestId('core-setup-dialog')).toHaveAttribute(
      'data-open',
      'false'
    );
    expect(screen.getByTestId('reset-apikey-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('custom-apikey-dialog')).toBeInTheDocument();
  });

  it('opens it on the desktop, as before', async () => {
    (window as any).Capacitor = { isNativePlatform: () => true };
    (window as any).coreSetup = {
      onProgress: vi.fn(() => () => {}),
      isCoreRunning: vi.fn(async () => false),
      isCoreInstalled: vi.fn(async () => false),
    };

    await renderOpenCoreSetup();

    expect(screen.getByTestId('core-setup-dialog')).toHaveAttribute(
      'data-open',
      'true'
    );
  });
});
