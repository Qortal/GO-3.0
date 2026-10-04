import React, { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { Provider, createStore } from 'jotai';

const storage = vi.hoisted(() => new Map<string, unknown>());

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
}));
vi.mock('../../../utils/events', () => ({
  executeEvent: vi.fn(),
}));
vi.mock('../../../utils/chromeStorage', () => ({
  getData: vi.fn(async (key: string) =>
    storage.has(key) ? structuredClone(storage.get(key)) : null
  ),
  storeData: vi.fn(async (key: string, value: unknown) => {
    storage.set(key, structuredClone(value));
    return 'Data saved successfully';
  }),
}));
vi.mock('../AppsNavBarDesktop', () => ({
  saveToLocalStorage: vi.fn(),
}));
vi.mock('../AppRating', () => ({ AppRating: () => null }));
vi.mock('../appNodeStatus', () => ({
  useAppNodeStatus: () => ({ availability: 'ready' }),
}));
vi.mock('../AppAvailabilityLabel', () => ({
  AppAvailabilityLabel: () => 'Open',
}));

import { executeEvent } from '../../../utils/events';
import { sortablePinnedAppsAtom, userInfoAtom } from '../../../atoms/global';
import { AppCardListItem } from '../AppCard/AppCardListItem';
import { setQdnAvatarCacheForTests } from '../../../lib/qdnAvatars/defaultCache';
import { createAvatarTestHarness } from '../../../lib/qdnAvatars/testHarness';

const WALLET = 'QWallet1';
const STORAGE_KEY = `hub_mobile_tab_org_${WALLET}`;

const i18n = createInstance();
i18n.init({
  lng: 'en',
  resources: {
    en: {
      core: {
        action: {
          pin: 'Pin',
          unpin: 'Unpin',
          pin_to_tabs: 'Pin to Tabs',
          unpin_from_tabs: 'Unpin from Tabs',
        },
        app_detail: { by_developer: 'by @{{developer}}' },
        tabs_overlay: {
          pinned_to_folder: 'Pinned to {{folder}} in Tabs',
          unpinned_from_folder: 'Removed from {{folder}} in Tabs',
        },
      },
    },
  },
});

const app = {
  name: 'Q-Blog',
  service: 'APP',
  metadata: { title: 'Q-Blog' },
};

const mockViewport = (phone: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: phone,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

const renderRow = () => {
  const store = createStore();
  store.set(userInfoAtom, { address: WALLET });
  store.set(sortablePinnedAppsAtom, []);
  render(
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <I18nextProvider i18n={i18n}>
          <AppCardListItem app={app} myName="me" />
        </I18nextProvider>
      </ThemeProvider>
    </Provider>
  );
  return store;
};

describe('AppCardListItem pin', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    storage.clear();
    vi.mocked(executeEvent).mockClear();
    // App icons come from the avatar cache: a node that never answers here.
    setQdnAvatarCacheForTests(
      createAvatarTestHarness({
        handler: () => new Promise<Response>(() => {}),
      }).cache
    );
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    setQdnAvatarCacheForTests(null);
  });

  it('pins into the Tabs Library folder on phones', async () => {
    mockViewport(true);
    const store = renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'Pin to Tabs' }));

    await screen.findByRole('button', { name: 'Unpin from Tabs' });
    await waitFor(() => {
      const saved = storage.get(STORAGE_KEY) as any;
      expect(saved?.folders).toEqual([
        expect.objectContaining({ name: 'Library', tabKeys: ['APP|Q-Blog'] }),
      ]);
    });
    expect(executeEvent).toHaveBeenCalledWith('openGlobalSnackBar', {
      message: 'Pinned to Library in Tabs',
      type: 'success',
      duration: 2400,
    });
    expect(store.get(sortablePinnedAppsAtom)).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Unpin from Tabs' }));
    await screen.findByRole('button', { name: 'Pin to Tabs' });
    expect(executeEvent).toHaveBeenLastCalledWith('openGlobalSnackBar', {
      message: 'Removed from Library in Tabs',
      type: 'success',
      duration: 2400,
    });
  });

  it('keeps pinning to the dashboard on wide screens', async () => {
    mockViewport(false);
    const store = renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));

    await screen.findByRole('button', { name: 'Unpin' });
    expect(store.get(sortablePinnedAppsAtom)).toEqual([
      { name: 'Q-Blog', service: 'APP' },
    ]);
    expect(storage.has(STORAGE_KEY)).toBe(false);
  });
});
