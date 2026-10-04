import { createContext } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { createStore, Provider as JotaiProvider } from 'jotai';

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

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: {} },
  interpolation: { escapeValue: false },
});

import { balanceAtom, userInfoAtom } from '../../../atoms/global';
import { appLockedAtom } from '../../../atoms/presence';
import { useSecureScreen } from '../../../hooks/useSecureScreen';
import { HomeProfileCard } from '../HomeProfileCard';

const theme = createTheme({
  palette: {
    other: { positive: '#00a000', danger: '#d00000', unread: '#1976d2' },
  },
});

const lastSecureFlag = () => {
  const calls = vi.mocked(useSecureScreen).mock.calls;
  return calls[calls.length - 1]?.[0]?.secure;
};

const renderCard = (store = createStore()) => {
  store.set(userInfoAtom, {
    name: 'alice',
    address: 'QVosNNasvHkNBAQ6rCYVepY3ax8XQsyv1H',
  });
  store.set(balanceAtom, 1);
  return render(
    <JotaiProvider store={store}>
      <ThemeProvider theme={theme}>
        <I18nextProvider i18n={i18n}>
          <HomeProfileCard />
        </I18nextProvider>
      </ThemeProvider>
    </JotaiProvider>
  );
};

describe('HomeProfileCard screen protection (GO-37)', () => {
  beforeEach(() => {
    vi.mocked(useSecureScreen).mockClear();
  });

  it('protects the account settings only while the Security tab is shown', async () => {
    renderCard();
    expect(lastSecureFlag()).toBe(false);

    fireEvent.click(
      screen.getByRole('button', { name: 'Open account settings' })
    );
    // Settings open on the Profile tab: still capturable.
    expect(lastSecureFlag()).toBe(false);

    // The dialog is still fading in under jsdom, hence `hidden: true`.
    const tab = (name: RegExp) =>
      screen.getByRole('button', { name, hidden: true });
    fireEvent.click(tab(/^security$/i));
    expect(lastSecureFlag()).toBe(true);

    fireEvent.click(tab(/^profile$/i));
    expect(lastSecureFlag()).toBe(false);

    // Closing the settings from the Security tab ends the protection too.
    fireEvent.click(tab(/^security$/i));
    expect(lastSecureFlag()).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog', { hidden: true }), {
      key: 'Escape',
    });
    await waitFor(() => expect(lastSecureFlag()).toBe(false));
  });

  it('clears the typed wallet password when the app locks', async () => {
    const store = createStore();
    renderCard(store);
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
    fireEvent.change(password, { target: { value: 'secret' } });
    expect(password.value).toBe('secret');

    act(() => {
      store.set(appLockedAtom, true);
    });
    await waitFor(() =>
      expect(
        (
          document.querySelector(
            'input[name="hub-private-key-decrypt"]'
          ) as HTMLInputElement
        ).value
      ).toBe('')
    );
  });
});
