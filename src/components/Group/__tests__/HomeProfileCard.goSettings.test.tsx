import { createContext } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { createStore, Provider as JotaiProvider } from 'jotai';

const platform = vi.hoisted(() => ({ capacitor: false }));

vi.mock('../../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/platform')>()),
  isCapacitor: () => platform.capacitor,
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
vi.mock('../../../hooks/useSecureScreen', () => ({ useSecureScreen: vi.fn() }));
vi.mock('../../../hooks/useBlockUsers', () => ({
  useBlockedAddresses: () => ({
    refreshBlockedUsers: vi.fn(async () => {}),
    removeBlockFromList: vi.fn(),
  }),
}));

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: {} },
  interpolation: { escapeValue: false },
});

import {
  balanceAtom,
  selectedNodeInfoAtom,
  userInfoAtom,
} from '../../../atoms/global';
import { HomeProfileCard } from '../HomeProfileCard';

const theme = createTheme({
  palette: {
    other: { positive: '#00a000', danger: '#d00000', unread: '#1976d2' },
  },
});

const openSettings = (store = createStore()) => {
  store.set(userInfoAtom, {
    name: 'alice',
    address: 'QVosNNasvHkNBAQ6rCYVepY3ax8XQsyv1H',
  });
  store.set(balanceAtom, 1);
  render(
    <JotaiProvider store={store}>
      <ThemeProvider theme={theme}>
        <I18nextProvider i18n={i18n}>
          <HomeProfileCard />
        </I18nextProvider>
      </ThemeProvider>
    </JotaiProvider>
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Open account settings' })
  );
};

// The dialog is still fading in under jsdom, hence `hidden: true`.
const tab = (name: RegExp) =>
  screen.queryByRole('button', { name, hidden: true });

describe('HomeProfileCard settings on GO', () => {
  afterEach(() => {
    platform.capacitor = false;
  });

  it('leaves out the tabs that only reach the desktop shell', () => {
    platform.capacitor = true;
    openSettings();
    expect(tab(/^profile$/i)).not.toBeNull();
    expect(tab(/^blocked$/i)).not.toBeNull();
    expect(tab(/^developer$/i)).toBeNull();
    expect(tab(/^help$/i)).toBeNull();
    expect(tab(/^reticulum$/i)).toBeNull();
  });

  it('keeps every tab on Hub', () => {
    openSettings();
    expect(tab(/^developer$/i)).not.toBeNull();
    expect(tab(/^help$/i)).not.toBeNull();
    expect(tab(/^reticulum$/i)).not.toBeNull();
  });

  it('hides the desktop-only System rows on GO', () => {
    platform.capacitor = true;
    openSettings();
    fireEvent.click(tab(/^system$/i)!);
    expect(screen.queryByText('Filter Developer Logs')).toBeNull();
    expect(screen.queryByText('Pinned Q-App backup')).toBeNull();
    expect(screen.getByText('Auto-Lock When Idle')).toBeTruthy();
  });
});

describe('HomeProfileCard blocked accounts', () => {
  it('explains that a public node decides who is blocked', () => {
    openSettings();
    fireEvent.click(tab(/^blocked$/i)!);
    expect(screen.getByText("You're on a public node")).toBeTruthy();
  });

  it('drops the note on your own node', () => {
    const store = createStore();
    store.set(selectedNodeInfoAtom, {
      url: 'http://127.0.0.1:12391',
      apikey: 'key',
    });
    openSettings(store);
    fireEvent.click(tab(/^blocked$/i)!);
    expect(screen.queryByText("You're on a public node")).toBeNull();
  });
});
