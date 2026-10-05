import { createContext } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider as JotaiProvider } from 'jotai';

// Both private key screens derive the key from the saved entry. A saved entry
// whose key opens another account must show an error, never that account's
// private key under the user's name.

const decrypted = vi.hoisted(() => ({ seed: new Uint8Array(0) as Uint8Array }));

vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
vi.mock('../../../utils/decryptWallet', () => ({
  decryptStoredWallet: vi.fn(async () => decrypted.seed.slice()),
}));
vi.mock('../../../utils/globalApi', () => ({
  getBaseApiReactForAvatar: () => 'http://localhost:12391',
}));
vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
  extStates: {},
}));
vi.mock('../../../background/background', () => ({
  groupApi: 'http://localhost:12391',
  groupApiSocket: 'ws://localhost:12391',
  cleanUrl: vi.fn((url: string) => url),
  getProtocol: vi.fn(() => 'http'),
  performPowTask: vi.fn(async () => ({ success: true, nonce: 0, hash: '00' })),
}));
vi.mock('../../Mobile/MobileNodeConnectionSettings', () => ({
  MobileNodeConnectionSettings: () => null,
}));
vi.mock('../../Theme/ThemeManager', () => ({ default: () => null }));
vi.mock('../../../hooks/useSecureScreen', () => ({ useSecureScreen: vi.fn() }));

import Base58Untyped from '../../../encryption/Base58';
import i18n from '../../../i18n/i18n';
import PhraseWalletUntyped from '../../../utils/generateWallet/phrase-wallet';
import {
  balanceAtom,
  infoSnackGlobalAtom,
  rawWalletAtom,
  userInfoAtom,
} from '../../../atoms/global';
import { lightTheme } from '../../../styles/theme-light';
import { HomeProfileCard } from '../HomeProfileCard';
import { ExportPrivateKey } from '../Settings';

/* eslint-disable @typescript-eslint/no-explicit-any */
const Base58 = Base58Untyped as any;
const PhraseWallet = PhraseWalletUntyped as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function seedBytes(length: number, fill: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (fill * 47 + i * 19) & 0xff;
  return bytes;
}

function derive(seed: Uint8Array, version: number) {
  const entry = new PhraseWallet(seed.slice(), version, { qortOnly: true })
    ._addresses[0];
  return {
    address: entry.address as string,
    privateKey: Base58.encode(entry.keyPair.privateKey) as string,
  };
}

const seed32 = seedBytes(32, 1);
const seed64 = seedBytes(64, 2);
const v1Account = derive(seed32, 1);
const v2Account = derive(seed64, 2);
const otherAccount = derive(seedBytes(64, 3), 2);
const short = (address: string) =>
  `${address.slice(0, 7)}…${address.slice(-5)}`;

const storedEntry = (address0: string, version?: number) => ({
  address0,
  ...(version ? { version } : {}),
  encryptedSeed: 'enc',
  iv: 'iv',
  salt: 'salt',
  mac: 'mac',
});

describe('Settings > Export private key', () => {
  const renderExport = (rawWallet: unknown) => {
    const store = createStore();
    render(
      <JotaiProvider store={store}>
        <ThemeProvider theme={lightTheme}>
          <ExportPrivateKey rawWallet={rawWallet} />
        </ThemeProvider>
      </JotaiProvider>
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('group:action.export_private_key', {
          postProcess: 'capitalizeFirstChar',
        }),
      })
    );
    const password = document.querySelector(
      'input[name="settings-private-key-decrypt"]'
    ) as HTMLInputElement;
    fireEvent.focus(password);
    fireEvent.change(password, { target: { value: 'pw' } });
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('core:action.decrypt', {
          postProcess: 'capitalizeFirstChar',
        }),
        hidden: true,
      })
    );
    return store;
  };

  const copyButton = () =>
    screen.queryByRole('button', {
      name: i18n.t('group:action.copy_private_key', {
        postProcess: 'capitalizeFirstChar',
      }),
      hidden: true,
    });

  it("shows the account's own key, with the version that derives it", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    decrypted.seed = seed32;
    // Saved without its version: version 2 derives another account.
    renderExport(storedEntry(v1Account.address));
    await waitFor(() => expect(copyButton()).not.toBeNull());
    fireEvent.click(copyButton() as HTMLElement);
    expect(writeText).toHaveBeenCalledWith(v1Account.privateKey);
  });

  it("refuses to export another account's key", async () => {
    decrypted.seed = seed64;
    const store = renderExport(storedEntry(otherAccount.address, 2));
    await waitFor(() =>
      expect(store.get(infoSnackGlobalAtom)?.type).toBe('error')
    );
    const message = String(store.get(infoSnackGlobalAtom)?.message);
    expect(message).toContain(short(otherAccount.address));
    expect(message).toContain(short(v2Account.address));
    expect(message).not.toContain(v2Account.privateKey);
    expect(copyButton()).toBeNull();
  });
});

describe('HomeProfileCard > Security > private key', () => {
  const theme = createTheme({
    palette: {
      other: { positive: '#00a000', danger: '#d00000', unread: '#1976d2' },
    },
  });

  const reveal = (rawWallet: unknown) => {
    const store = createStore();
    store.set(userInfoAtom, {
      name: 'alice',
      address: (rawWallet as { address0: string }).address0,
    });
    store.set(balanceAtom, 1);
    store.set(rawWalletAtom, rawWallet);
    render(
      <JotaiProvider store={store}>
        <ThemeProvider theme={theme}>
          <HomeProfileCard />
        </ThemeProvider>
      </JotaiProvider>
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Open account settings' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: /^security$/i, hidden: true })
    );
    const password = document.querySelector(
      'input[name="hub-private-key-decrypt"]'
    ) as HTMLInputElement;
    fireEvent.focus(password);
    fireEvent.change(password, { target: { value: 'pw' } });
    fireEvent.click(
      screen.getByRole('button', { name: /^decrypt$/i, hidden: true })
    );
  };

  it("reveals the account's own key", async () => {
    decrypted.seed = seed32;
    reveal(storedEntry(v1Account.address));
    expect(
      await screen.findByText(v1Account.privateKey, undefined, {
        timeout: 3000,
      })
    ).toBeTruthy();
  });

  it("shows an error instead of another account's key", async () => {
    decrypted.seed = seed64;
    reveal(storedEntry(otherAccount.address, 2));
    const error = await screen.findByText(
      new RegExp(short(otherAccount.address)),
      undefined,
      { timeout: 3000 }
    );
    expect(error).toHaveTextContent(short(v2Account.address));
    expect(screen.queryByText(v2Account.privateKey)).toBeNull();
  });
});
