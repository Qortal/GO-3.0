import { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn(async () => true) }),
  extStates: {},
}));
vi.mock('../../../background/background', () => ({
  groupApi: 'http://localhost:12391',
  groupApiSocket: 'ws://localhost:12391',
  cleanUrl: vi.fn((url: string) => url),
  getFee: vi.fn(async () => ({ fee: '0.01' })),
  getProtocol: vi.fn(() => 'http'),
  performPowTask: vi.fn(async () => ({ success: true, nonce: 0, hash: '00' })),
  walletVersion: 2,
}));
vi.mock('../../../hooks/useSecureScreen', () => ({ useSecureScreen: vi.fn() }));
vi.mock('../../../utils/walletAvatarCache', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../utils/walletAvatarCache')
  >()),
  setWalletAvatarCache: vi.fn(async () => undefined),
}));
// Picking a file is not under test: a click hands over a PNG.
vi.mock('../../../common/ImageUploader', async () => {
  const { PNG_BYTES } = await import('../../../lib/qdnAvatars/testHarness');
  return {
    default: ({
      children,
      onPick,
    }: {
      children: React.ReactNode;
      onPick: (file: File) => void;
    }) => (
      <div
        data-testid="pick-avatar"
        onClick={() =>
          onPick(new File([PNG_BYTES], 'me.png', { type: 'image/png' }))
        }
      >
        {children}
      </div>
    ),
  };
});

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: {} },
  interpolation: { escapeValue: false },
});

import { balanceAtom, userInfoAtom } from '../../../atoms/global';
import { setQdnAvatarCacheForTests } from '../../../lib/qdnAvatars/defaultCache';
import { qdnAvatarKey } from '../../../lib/qdnAvatars/keys';
import {
  createAvatarTestHarness,
  flushAsync,
} from '../../../lib/qdnAvatars/testHarness';
import { resetOwnQdnAvatarRefreshForTests } from '../../../hooks/useOwnQdnAvatarRefresh';
import { executeEvent } from '../../../utils/events';
import { setWalletAvatarCache } from '../../../utils/walletAvatarCache';
import { HomeProfileCard } from '../HomeProfileCard';

const ADDRESS = 'QVosNNasvHkNBAQ6rCYVepY3ax8XQsyv1H';

const theme = createTheme({
  palette: {
    other: { positive: '#00a000', danger: '#d00000', unread: '#1976d2' },
  },
});

const renderCard = () => {
  const store = createStore();
  store.set(userInfoAtom, { name: 'alice', address: ADDRESS });
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

const publishFromPanel = async () => {
  act(() => {
    executeEvent('openAvatarUpload', {});
  });
  fireEvent.click(await screen.findByTestId('pick-avatar'));
  const publish = await screen.findByRole('button', {
    name: /publish_avatar/i,
    hidden: true,
  });
  await waitFor(() => expect(publish).not.toBeDisabled());
  await act(async () => {
    fireEvent.click(publish);
    await flushAsync(10);
  });
};

describe('HomeProfileCard avatar publish', () => {
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetOwnQdnAvatarRefreshForTests();
    vi.mocked(setWalletAvatarCache).mockClear();
    sendMessage = vi.fn();
    (window as unknown as { sendMessage: unknown }).sendMessage = sendMessage;
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    setQdnAvatarCacheForTests(null);
    vi.unstubAllGlobals();
  });

  it('puts the published avatar into the cache and the wallet copy', async () => {
    // A slow node: the avatar fetch never answers.
    const h = createAvatarTestHarness({
      handler: () => new Promise<Response>(() => {}),
    });
    setQdnAvatarCacheForTests(h.cache);
    sendMessage.mockResolvedValue({ signature: 'sig' });
    renderCard();
    await publishFromPanel();

    expect(sendMessage).toHaveBeenCalledWith(
      'publishOnQDN',
      expect.objectContaining({
        identifier: 'qortal_avatar',
        service: 'THUMBNAIL',
      })
    );
    await waitFor(() =>
      expect(h.cache.getSnapshot(qdnAvatarKey('alice'))).toMatchObject({
        source: 'cache',
        status: 'ready',
      })
    );
    expect(setWalletAvatarCache).toHaveBeenCalledWith(
      ADDRESS,
      expect.stringMatching(/^data:image\//),
      'alice'
    );
  });

  it('leaves the cache alone when the publish fails', async () => {
    const h = createAvatarTestHarness({
      handler: () => new Promise<Response>(() => {}),
    });
    setQdnAvatarCacheForTests(h.cache);
    sendMessage.mockResolvedValue({ error: 'insufficient funds' });
    renderCard();
    await publishFromPanel();

    expect(sendMessage).toHaveBeenCalled();
    expect(h.cache.getSnapshot(qdnAvatarKey('alice')).source).toBeNull();
    expect(setWalletAvatarCache).not.toHaveBeenCalled();
  });
});
