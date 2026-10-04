import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  WalletAccountEditDialog: ({ onRemove }: { onRemove: () => void }) => (
    <button onClick={onRemove}>remove account</button>
  ),
}));
vi.mock('../utils/receivedChatFiles', () => ({
  clearReceivedChatFiles: vi.fn(async () => 0),
}));
vi.mock('./QortalUserAvatar', () => ({ QortalUserAvatar: () => null }));
vi.mock('../lib/qdnAvatars', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/qdnAvatars')>()),
  clearQdnAvatarCache: vi.fn(async () => undefined),
}));
vi.mock('../lib/qdnAvatars/prewarmSources', () => ({
  clearQdnAvatarPrewarmPeerNames: vi.fn(),
}));
vi.mock('../hooks/useSecureScreen', () => ({ useSecureScreen: vi.fn() }));

import { getWallets, storeWallets } from '../background/background.ts';
import { clearQdnAvatarCache } from '../lib/qdnAvatars';
import { clearQdnAvatarPrewarmPeerNames } from '../lib/qdnAvatars/prewarmSources';
import { clearReceivedChatFiles } from '../utils/receivedChatFiles';
import { clearWalletAvatarCache } from '../utils/walletAvatarCache';
import { forgetWalletPrimaryName } from '../utils/walletPrimaryNameCache';
import { lightTheme } from '../styles/theme-light';
import { AuthenticationForm } from './AuthenticationForm';

const ADDRESS = 'QVosNNasvHkNBAQ6rCYVepY3ax8XQsyv1H';

describe('AuthenticationForm account removal', () => {
  beforeEach(() => {
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

  it('leaves no received chat files behind when an account is removed (N-22)', async () => {
    vi.mocked(getWallets).mockResolvedValue([
      { address0: ADDRESS },
      { address0: 'QOther' },
    ]);
    const onWalletRemoved = vi.fn();
    render(
      <Provider store={createStore()}>
        <ThemeProvider theme={lightTheme}>
          <AuthenticationForm
            rawWallet={{ address0: ADDRESS }}
            selectedNode={null}
            walletToBeDecryptedError=""
            initialPasswordFallback
            onBack={vi.fn()}
            onAuthenticate={vi.fn(async () => undefined)}
            onWalletRemoved={onWalletRemoved}
          />
        </ThemeProvider>
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'remove account' }));

    await waitFor(() => expect(onWalletRemoved).toHaveBeenCalled());
    expect(storeWallets).toHaveBeenCalledWith([{ address0: 'QOther' }]);
    expect(forgetWalletPrimaryName).toHaveBeenCalledWith(ADDRESS);
    expect(clearWalletAvatarCache).toHaveBeenCalledWith(ADDRESS);
    expect(clearReceivedChatFiles).toHaveBeenCalledTimes(1);
    // Cached avatars and DM partner names show who the account talked to.
    expect(clearQdnAvatarCache).toHaveBeenCalledTimes(1);
    expect(clearQdnAvatarPrewarmPeerNames).toHaveBeenCalledTimes(1);
  });
});
