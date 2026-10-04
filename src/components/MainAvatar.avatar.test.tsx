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

vi.mock('../App', () => ({
  getBaseApiReact: () => 'http://node.test',
  getArbitraryEndpointReact: () => '/arbitrary/resources/search',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn(async () => true) }),
}));
vi.mock('../utils/globalApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/globalApi')>()),
  getBaseApiReact: () => 'http://node.test',
}));
vi.mock('../background/background', () => ({
  getFee: vi.fn(async () => ({ fee: '0.01' })),
}));
vi.mock('../utils/walletAvatarCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/walletAvatarCache')>()),
  setWalletAvatarCache: vi.fn(async () => undefined),
}));
// Picking a file is not under test: a click hands over a PNG.
vi.mock('../common/ImageUploader', async () => {
  const { PNG_BYTES } = await import('../lib/qdnAvatars/testHarness');
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

import { userInfoAtom } from '../atoms/global';
import { resetAvatarPublishesForTests } from './Group/avatarPreviewUrls';
import { resetOwnQdnAvatarRefreshForTests } from '../hooks/useOwnQdnAvatarRefresh';
import { setQdnAvatarCacheForTests } from '../lib/qdnAvatars/defaultCache';
import { qdnAvatarKey } from '../lib/qdnAvatars/keys';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
} from '../lib/qdnAvatars/testHarness';
import { setWalletAvatarCache } from '../utils/walletAvatarCache';
import { MainAvatar } from './MainAvatar';

const ADDRESS = 'QVosNNasvHkNBAQ6rCYVepY3ax8XQsyv1H';
const FULL_URL = 'http://node.test/arbitrary/THUMBNAIL/alice/qortal_avatar';

const theme = createTheme({
  palette: {
    other: { positive: '#00a000', danger: '#d00000', unread: '#1976d2' },
  },
});

type FakeLoad = { url: string; onload: (() => void) | null };
const imageLoads: FakeLoad[] = [];
class FakeImage {
  url = '';
  decoding = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) {
    this.url = value;
    if (value) imageLoads.push(this);
  }
}

const renderAvatar = () => {
  const store = createStore();
  store.set(userInfoAtom, { name: 'alice', address: ADDRESS });
  return render(
    <JotaiProvider store={store}>
      <ThemeProvider theme={theme}>
        <I18nextProvider i18n={i18n}>
          <MainAvatar
            balance={5}
            myName="alice"
            setInfoSnack={vi.fn()}
            setOpenSnack={vi.fn()}
          />
        </I18nextProvider>
      </ThemeProvider>
    </JotaiProvider>
  );
};

const avatarImgSrc = () =>
  screen.queryByRole('img', { name: 'alice' })?.getAttribute('src') ?? null;

describe('MainAvatar', () => {
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    imageLoads.length = 0;
    vi.stubGlobal('Image', FakeImage);
    resetOwnQdnAvatarRefreshForTests();
    resetAvatarPublishesForTests();
    vi.mocked(setWalletAvatarCache).mockClear();
    sendMessage = vi.fn();
    (window as unknown as { sendMessage: unknown }).sendMessage = sendMessage;
    // The node search for an existing avatar finds nothing (slow node).
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('[]', { status: 200 })
    );
  });

  afterEach(() => {
    setQdnAvatarCacheForTests(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the cached avatar when the node search fails, then the full size', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    renderAvatar();
    await act(async () => {
      await flushAsync(10);
    });
    expect(avatarImgSrc()).toMatch(/^blob:test\//);
    const fullLoad = imageLoads.find((load) => load.url === FULL_URL);
    expect(fullLoad).toBeTruthy();
    act(() => {
      fullLoad?.onload?.();
    });
    expect(avatarImgSrc()).toBe(FULL_URL);
  });

  it('puts a published avatar into the cache and the wallet copy', async () => {
    // A slow node: the avatar fetch never answers.
    const h = createAvatarTestHarness({
      handler: () => new Promise<Response>(() => {}),
    });
    setQdnAvatarCacheForTests(h.cache);
    sendMessage.mockResolvedValue({ signature: 'sig' });
    renderAvatar();
    fireEvent.click(screen.getByText(/set_avatar/i));
    fireEvent.click(await screen.findByTestId('pick-avatar'));
    const publish = await screen.findByRole('button', {
      name: /publish_avatar/i,
    });
    await waitFor(() => expect(publish).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(publish);
      await flushAsync(10);
    });

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
    // No full-size load of the old node file right after the publish.
    expect(imageLoads.some((load) => load.url.startsWith(FULL_URL))).toBe(
      false
    );
  });
});
