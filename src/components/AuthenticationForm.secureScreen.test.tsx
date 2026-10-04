import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../background/background.ts', () => ({
  getWallets: vi.fn(async () => []),
  storeWallets: vi.fn(async () => undefined),
}));
vi.mock('./Group/groupApi', () => ({
  getPrimaryNameForAvatar: vi.fn(async () => null),
}));
vi.mock('../utils/walletAvatarCache', () => ({
  clearWalletAvatarCache: vi.fn(async () => undefined),
  getWalletAvatarCache: vi.fn(async () => null),
  resolveWalletAvatarSrc: vi.fn(() => ''),
}));
vi.mock('../utils/walletPrimaryNameCache', () => ({
  forgetWalletPrimaryName: vi.fn(async () => undefined),
}));
vi.mock('../utils/walletBiometricAuth', () => ({
  biometricUnlockWallet: vi.fn(async () => false),
  isBiometricHardwareAvailable: vi.fn(async () => false),
  isBiometricUnlockConfigured: vi.fn(async () => false),
  prefetchWalletSessionProbe: vi.fn(),
  prewarmBiometricUnlockKdf: vi.fn(async () => undefined),
  syncBiometricAutoPromptFlag: vi.fn(),
  warmUpBiometricHardware: vi.fn(async () => undefined),
  wasEarlyBiometricPromptCancelled: vi.fn(() => false),
}));
vi.mock('../encryption/kdf', () => ({ prewarmKdfWorkers: vi.fn() }));
vi.mock('./Auth/ConnectionModeModal', () => ({
  ConnectionModeModal: () => null,
}));
vi.mock('./Auth/MobileLoginSettingsModal', () => ({
  MobileLoginSettingsModal: () => null,
}));
vi.mock('./Auth/WalletAccountEditDialog', () => ({
  WalletAccountEditDialog: () => null,
}));
vi.mock('./QortalUserAvatar', () => ({ QortalUserAvatar: () => null }));
vi.mock('../hooks/useSecureScreen', () => ({ useSecureScreen: vi.fn() }));

import { useSecureScreen } from '../hooks/useSecureScreen';
import { lightTheme } from '../styles/theme-light';
import { AuthenticationForm } from './AuthenticationForm';

describe('AuthenticationForm screen protection (GO-37)', () => {
  beforeEach(() => {
    vi.mocked(useSecureScreen).mockClear();
    // jsdom has no matchMedia; the form checks the viewport size.
    window.matchMedia ??= ((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  it('protects the unlock screen and keeps its password out of autofill', () => {
    const { unmount } = render(
      <Provider store={createStore()}>
        <ThemeProvider theme={lightTheme}>
          <AuthenticationForm
            rawWallet={{ address0: 'QVosNNasvHkNBAQ6rCYVepY3ax8XQsyv1H' }}
            selectedNode={null}
            walletToBeDecryptedError=""
            initialPasswordFallback
            onBack={vi.fn()}
            onAuthenticate={vi.fn(async () => undefined)}
          />
        </ThemeProvider>
      </Provider>
    );
    const calls = vi.mocked(useSecureScreen).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(([options]) => options?.secure === true)).toBe(true);
    // N-33: the unlock password is never offered to a password manager.
    const password = document.querySelector('input[type="password"]');
    expect(password).toHaveAttribute('autocomplete', 'off');
    expect(password).toHaveAttribute('data-1p-ignore', 'true');
    unmount();
  });
});
