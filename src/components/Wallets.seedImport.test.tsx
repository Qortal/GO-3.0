import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ android: true }));
const decrypt = vi.hoisted(() => ({
  seed: vi.fn(async (_phrase: string) => new Uint8Array(1)),
}));

vi.mock('../background/background.ts', () => ({
  getWallets: vi.fn(async () => []),
  storeWallets: vi.fn(async () => undefined),
  walletVersion: 2,
}));
vi.mock('../utils/chromeStorage', () => ({
  getData: vi.fn(async () => null),
  storeData: vi.fn(async () => 'Data saved successfully'),
}));
vi.mock('../utils/globalApi', () => ({
  getArbitraryEndpointReact: () => '/arbitrary/resources/search',
  getBaseApiReactForAvatar: () => '',
  getBaseApiReactForPrimaryName: () => '',
}));
vi.mock('../App', () => ({
  getArbitrarySearchSimpleEndpointReact: () =>
    '/arbitrary/resources/searchsimple',
  getBaseApiReact: () => '',
  getBaseApiReactForPrimaryName: () => '',
}));
vi.mock('../utils/generateWallet/phrase-wallet.ts', () => ({
  default: class {
    generateSaveWalletData = async () => ({});
  },
}));
vi.mock('../utils/decryptWallet.ts', () => ({
  decryptStoredWalletFromSeedPhrase: decrypt.seed,
}));
vi.mock('../constants/decryptWallet.ts', () => ({ crypto: {} }));
vi.mock('../encryption/kdf', () => ({ prewarmKdfWorkers: vi.fn() }));
vi.mock('./index.ts', () => ({
  PasswordField: ({ value, onChange }) =>
    createElement('input', {
      'aria-label': 'wallet password',
      onChange,
      type: 'password',
      value,
    }),
}));
vi.mock('./Auth/AuthShell', () => ({
  AuthButton: ({ children, disabled, onClick }) =>
    createElement('button', { disabled, onClick }, children),
  AuthSectionLabel: ({ children }) => createElement('span', null, children),
}));
vi.mock('../utils/lastAuthenticatedWallet', () => ({
  getLastAuthenticatedWalletAddress: () => '',
  hasAttemptedLastWalletAutoSelectThisSession: () => true,
  markLastWalletAutoSelectAttemptedThisSession: vi.fn(),
}));
vi.mock('../atoms/global', async () => {
  const { atom } = await import('jotai');
  return {
    mobileLoginSettingsOpenAtom: atom(false),
    selectedNodeInfoAtom: atom<{ url: string; apikey: string } | null>(null),
  };
});
vi.mock('../utils/platform', () => ({ isCapacitor: () => false }));
vi.mock('../utils/androidApp', () => ({
  isAndroidApp: () => platform.android,
}));
vi.mock('../utils/walletBiometricAuth', () => ({
  getBiometricEnabledAddresses: vi.fn(async () => []),
  getBiometricEnabledAddressesSync: vi.fn(() => []),
  prefetchWalletSessionProbe: vi.fn(),
  prewarmBiometricUnlockKdf: vi.fn(async () => undefined),
  syncBiometricAutoPromptFlag: vi.fn(),
  syncBiometricPasswordCache: vi.fn(async () => undefined),
  updateEarlyBiometricPromptForTopWallet: vi.fn(),
  warmUpBiometricHardware: vi.fn(async () => undefined),
}));
vi.mock('../plugins/QortalBiometric', () => ({
  isQortalBiometricHardwareAvailable: vi.fn(async () => false),
}));
vi.mock('../hooks/useSecureScreen', () => ({ useSecureScreen: vi.fn() }));

import i18n from '../i18n/i18n';
import { Wallets } from './Wallets';
import { lightTheme } from '../styles/theme-light';
import { useSecureScreen } from '../hooks/useSecureScreen';

const PHRASE = 'alpha bravo charlie delta echo foxtrot';

const renderImport = () =>
  render(
    createElement(
      Provider,
      { store: createStore() },
      createElement(
        ThemeProvider,
        { theme: lightTheme },
        createElement(Wallets, {
          mode: 'import',
          setExtState: vi.fn(),
          setRawWallet: vi.fn(),
        })
      )
    )
  );

const openSeedImport = async () => {
  renderImport();
  fireEvent.click(
    await screen.findByText(i18n.t('auth:entry.import_choice_seed_title'))
  );
  return screen.getByLabelText(
    i18n.t('auth:entry.import_seed_label')
  ) as HTMLInputElement;
};

const lastSecureFlag = () => {
  const calls = vi.mocked(useSecureScreen).mock.calls;
  return calls[calls.length - 1]?.[0]?.secure;
};

const showToggle = () =>
  screen.getByRole('button', { name: i18n.t('auth:entry.show_seed_phrase') });

describe('Wallets seed phrase import', () => {
  beforeEach(() => {
    platform.android = true;
    vi.mocked(useSecureScreen).mockClear();
    decrypt.seed.mockClear();
  });

  it('protects the screen only while the seed phrase view is open', async () => {
    renderImport();
    await screen.findByText(i18n.t('auth:entry.import_choice_seed_title'));
    expect(lastSecureFlag()).toBe(false);

    fireEvent.click(
      screen.getByText(i18n.t('auth:entry.import_choice_seed_title'))
    );
    await waitFor(() => expect(lastSecureFlag()).toBe(true));
  });

  it('is a masked field the keyboard must not learn from (GO-42)', async () => {
    const field = await openSeedImport();
    expect(field.tagName).toBe('INPUT');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('autocorrect', 'off');
    expect(field).toHaveAttribute('autocapitalize', 'none');
    expect(field).toHaveAttribute('spellcheck', 'false');
    expect(field).toHaveAttribute('data-1p-ignore', 'true');
    expect(field).toHaveAttribute('data-lpignore', 'true');
    expect(field).toHaveAttribute('data-bwignore', 'true');
  });

  it('can be shown to check every word, and hidden again', async () => {
    const user = userEvent.setup();
    const field = await openSeedImport();
    await user.click(field);
    await user.paste(PHRASE);
    expect(field).toHaveValue(PHRASE);
    expect(screen.queryByTestId('seed-phrase-preview')).toBeNull();

    const toggle = showToggle();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(field).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAccessibleName(i18n.t('auth:entry.hide_seed_phrase'));
    expect(screen.getByTestId('seed-phrase-preview')).toHaveTextContent(PHRASE);

    await user.click(toggle);
    expect(field).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAccessibleName(i18n.t('auth:entry.show_seed_phrase'));
    expect(screen.queryByTestId('seed-phrase-preview')).toBeNull();
  });

  it('keeps the masked textarea in the desktop app and the browser', async () => {
    platform.android = false;
    const user = userEvent.setup();
    const field = await openSeedImport();
    // Not a password input: a browser's password manager would offer to
    // save the phrase as a second password.
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).not.toHaveAttribute('type');
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('autocorrect', 'off');
    expect(field).toHaveAttribute('autocapitalize', 'none');
    expect(field).toHaveAttribute('spellcheck', 'false');
    expect(lastSecureFlag()).toBe(true);

    await user.click(field);
    await user.paste(PHRASE);
    const toggle = showToggle();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // The textarea itself shows every word: no extra copy below it.
    expect(screen.queryByTestId('seed-phrase-preview')).toBeNull();
  });

  it('imports the typed phrase as before', async () => {
    const user = userEvent.setup();
    const field = await openSeedImport();
    await user.type(field, ` ${PHRASE} `);
    await user.type(screen.getByLabelText('wallet password'), 'password');
    await user.click(
      screen.getByRole('button', {
        name: i18n.t('auth:entry.import_account'),
      })
    );
    await waitFor(() => expect(decrypt.seed).toHaveBeenCalledWith(PHRASE));
  });
});
