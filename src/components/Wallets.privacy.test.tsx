import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ALICE = 'QRj9ttCJoCmV4kb9GxSHP75ZQWWi7LqPQG';
const BOB = 'QM8eUjZLNTQS9wosWJbcvPEtAUeMkcEraS';
const CAROL = 'Qc436qUreT8v42qUbxWh2U2QJD6SZzXTNg';
/** A wallet removed from this device earlier. */
const DAVE = 'QdSnUy6sUiEnaN87dWmE92g1uQjrvPgrWG';
const REMOTE_NODE = 'https://ext-node.qortal.link';
const OWN_NODE = 'http://127.0.0.1:12391';
const storage = new Map<string, unknown>();
const node = vi.hoisted(() => ({ url: '' }));

vi.mock('../background/background.ts', () => ({
  getWallets: vi.fn(async () => [
    { address0: ALICE },
    { address0: BOB },
    { address0: CAROL, name: 'Carol backup' },
  ]),
  storeWallets: vi.fn(async () => undefined),
  walletVersion: 2,
}));
vi.mock('../utils/chromeStorage', () => ({
  getData: vi.fn(async (key: string) =>
    storage.has(key) ? structuredClone(storage.get(key)) : null
  ),
  storeData: vi.fn(async (key: string, value: unknown) => {
    storage.set(key, structuredClone(value));
    return 'Data saved successfully';
  }),
}));
vi.mock('../utils/globalApi', () => ({
  getArbitraryEndpointReact: () => '/arbitrary/resources/search',
  getBaseApiReactForAvatar: () => node.url,
  getBaseApiReactForPrimaryName: () => node.url,
}));
// groupApi (loaded on demand for a node on this device) reads App's helpers.
vi.mock('../App', () => ({
  getArbitrarySearchSimpleEndpointReact: () =>
    '/arbitrary/resources/searchsimple',
  getBaseApiReact: () => node.url,
  getBaseApiReactForPrimaryName: () => node.url,
}));
vi.mock('../utils/generateWallet/phrase-wallet.ts', () => ({
  default: class {},
}));
vi.mock('../utils/decryptWallet.ts', () => ({
  decryptStoredWalletFromSeedPhrase: vi.fn(),
}));
vi.mock('../constants/decryptWallet.ts', () => ({ crypto: {} }));
vi.mock('../encryption/kdf', () => ({ prewarmKdfWorkers: vi.fn() }));
vi.mock('./index.ts', () => ({ PasswordField: () => null }));
vi.mock('./Auth/AuthShell', () => ({
  AuthButton: ({ children }: { children?: unknown }) =>
    createElement('button', null, children as never),
  AuthSectionLabel: ({ children }: { children?: unknown }) =>
    createElement('span', null, children as never),
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

import { Wallets } from './Wallets';
import { lightTheme } from '../styles/theme-light';
import { selectedNodeInfoAtom } from '../atoms/global';
import { resetWalletPrimaryNameCacheForTests } from '../utils/walletPrimaryNameCache';

const AVATAR = 'data:image/png;base64,iVBORw0KGgoAAAA';

beforeEach(() => {
  storage.clear();
  resetWalletPrimaryNameCacheForTests();
  storage.set('walletAvatarByAddress', {
    [ALICE]: { dataUrl: AVATAR, primaryName: 'Alice' },
  });
  storage.set('walletPrimaryNameByAddress', {
    [BOB]: { name: 'Bob', at: 1 },
  });
  node.url = REMOTE_NODE;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderPicker = (props: Record<string, unknown> = {}) => {
  const store = createStore();
  store.set(selectedNodeInfoAtom, { url: node.url, apikey: '' });
  return render(
    createElement(
      Provider,
      { store },
      createElement(
        ThemeProvider,
        { theme: lightTheme },
        createElement(Wallets, {
          mode: 'entry',
          setExtState: vi.fn(),
          setRawWallet: vi.fn(),
          ...props,
        })
      )
    )
  );
};

describe('Wallets account picker', () => {
  it('shows saved names and avatars without asking the node anything', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('the picker must not use the network');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderPicker();

    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Carol backup')).toBeInTheDocument();

    const imageSources = [...container.querySelectorAll('img')].map((img) =>
      img.getAttribute('src')
    );
    expect(imageSources).toEqual([AVATAR]);
    // Give the (skipped) own-node refresh every chance to run.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hands the unlock screen only a remembered name, never the label', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('no network');
      })
    );
    const onWalletUnlockStart = vi.fn();
    renderPicker({ onWalletUnlockStart });
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Carol backup'));
    expect(onWalletUnlockStart).toHaveBeenLastCalledWith(
      expect.objectContaining({
        displayName: 'Carol backup',
        primaryName: undefined,
        walletAddress: CAROL,
      })
    );

    fireEvent.click(screen.getByText('Bob'));
    expect(onWalletUnlockStart).toHaveBeenLastCalledWith(
      expect.objectContaining({ primaryName: 'Bob', walletAddress: BOB })
    );
  });

  it('forgets the name and avatar of a wallet removed from the device', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('no network');
      })
    );
    storage.set('walletAvatarByAddress', {
      [ALICE]: { dataUrl: AVATAR, primaryName: 'Alice' },
      [DAVE]: { dataUrl: AVATAR, primaryName: 'Dave' },
    });
    storage.set('walletPrimaryNameByAddress', {
      [BOB]: { name: 'Bob', at: 1 },
      [DAVE]: { name: 'Dave', at: 1 },
    });

    renderPicker();

    await waitFor(() => {
      expect(
        Object.keys(storage.get('walletPrimaryNameByAddress') as object)
      ).toEqual([BOB]);
      expect(
        Object.keys(storage.get('walletAvatarByAddress') as object)
      ).toEqual([ALICE]);
    });
    expect(screen.queryByText('Dave')).toBeNull();
  });

  it('asks a node on this device about every wallet, as before', async () => {
    node.url = OWN_NODE;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url === `${OWN_NODE}/names/list`) {
          return new Response(
            JSON.stringify([
              { owner: ALICE, name: 'Alice' },
              { owner: BOB, name: 'Bob' },
              { owner: CAROL, name: 'Carol Q' },
            ]),
            { status: 200 }
          );
        }
        if (url.startsWith(`${OWN_NODE}/arbitrary/resources/search`)) {
          return new Response('[]', { status: 200 });
        }
        return new Response('', { status: 404 });
      }
    );
    vi.stubGlobal('fetch', fetchMock);

    renderPicker();

    await waitFor(() =>
      expect(screen.getByText('Carol Q')).toBeInTheDocument()
    );
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.every((url) => url.startsWith(`${OWN_NODE}/`))).toBe(true);
    const listCalls = fetchMock.mock.calls.filter(
      ([input]) => String(input) === `${OWN_NODE}/names/list`
    );
    expect(listCalls).toHaveLength(1);
    expect(JSON.parse(String(listCalls[0]?.[1]?.body))).toEqual([
      ALICE,
      BOB,
      CAROL,
    ]);
    await waitFor(() =>
      expect(
        (
          storage.get('walletPrimaryNameByAddress') as Record<
            string,
            { name: string }
          >
        )[CAROL]?.name
      ).toBe('Carol Q')
    );
  });
});
