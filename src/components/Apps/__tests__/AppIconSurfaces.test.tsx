import { createContext, type ReactNode } from 'react';
import { act, render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
}));
vi.mock('../../../utils/events', () => ({
  executeEvent: vi.fn(),
  subscribeToEvent: vi.fn(),
  unsubscribeFromEvent: vi.fn(),
}));
vi.mock('../../../utils/chromeStorage', () => ({
  getData: vi.fn(async () => null),
  storeData: vi.fn(async () => 'Data saved successfully'),
}));
vi.mock('../AppsNavBarDesktop', () => ({ saveToLocalStorage: vi.fn() }));
vi.mock('../AppRating', () => ({ AppRating: () => null }));
vi.mock('../appNodeStatus', () => ({
  useAppNodeStatus: () => ({ availability: 'ready' }),
}));
vi.mock('../AppAvailabilityLabel', () => ({
  AppAvailabilityLabel: () => null,
}));
vi.mock('../../../hooks/useAppRatings', () => ({
  useAppRating: () => ({ rating: null, refresh: vi.fn(), containerRef: null }),
}));
vi.mock('../../../background/background', () => ({
  getFee: vi.fn(async () => ({ fee: '0' })),
  createEndpoint: vi.fn(),
  isUsingLocal: vi.fn(async () => false),
}));

import { setQdnAvatarCacheForTests } from '../../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  notPublishedResponse,
  PNG_BYTES,
  statusResponse,
} from '../../../lib/qdnAvatars/testHarness';
import { lightTheme } from '../../../styles/theme-light';
import { AppCardCompact } from '../AppCard/AppCardCompact';
import { AppCardEnhanced } from '../AppCard/AppCardEnhanced';
import { AppCardListItem } from '../AppCard/AppCardListItem';
import { FeaturedAppBanner } from '../AppCard/FeaturedAppBanner';
import { PublishedAppCard } from '../AppCard/PublishedAppCard';
import { AppInfo } from '../AppInfo';
import { AppInfoSnippet } from '../AppInfoSnippet';
import { AppsDevModeHome } from '../AppsDevModeHome';

const app = (name: string) => ({
  name,
  service: 'APP',
  created: 1_700_000_000_000,
  metadata: { title: name, description: 'An app', category: 'games' },
  status: { status: 'READY' },
});

/** Every place in the Q-Apps screens that shows an app's icon. */
const surfaces: [string, string, (name: string) => ReactNode][] = [
  [
    'compact card',
    'Q-Blog',
    (name) => <AppCardCompact app={app(name)} myName="me" />,
  ],
  [
    'enhanced card',
    'Q-Blog',
    (name) => <AppCardEnhanced app={app(name)} myName="me" />,
  ],
  [
    'library list row',
    'Q-Blog',
    (name) => <AppCardListItem app={app(name)} myName="me" />,
  ],
  [
    'featured banner',
    'Q-Blog',
    (name) => <FeaturedAppBanner featuredApps={[app(name)]} />,
  ],
  [
    'published app card',
    'Q-Blog',
    (name) => (
      <PublishedAppCard app={app(name)} onUpdate={vi.fn()} variant="card" />
    ),
  ],
  [
    'published app list row',
    'Q-Blog',
    (name) => (
      <PublishedAppCard app={app(name)} onUpdate={vi.fn()} variant="list" />
    ),
  ],
  [
    'app info snippet',
    'Q-Blog',
    (name) => (
      <AppInfoSnippet app={app(name)} myName="me" isFromCategory={false} />
    ),
  ],
  [
    'app detail page',
    'Q-Blog',
    (name) => <AppInfo app={app(name)} myName="me" />,
  ],
  // The dev-mode home always shows the Q-Sandbox tile.
  [
    'dev-mode Q-Sandbox tile',
    'Q-Sandbox',
    () => (
      <AppsDevModeHome
        setMode={vi.fn()}
        myApp={null}
        myWebsite={null}
        availableQapps={[]}
        myName="me"
      />
    ),
  ],
];

const renderSurface = (node: ReactNode) =>
  render(
    <Provider store={createStore()}>
      <ThemeProvider theme={lightTheme}>{node}</ThemeProvider>
    </Provider>
  );

const imageSources = (container: HTMLElement) =>
  [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));

beforeEach(() => {
  // PublishedAppCard asks the node for its rating.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 }))
  );
});

afterEach(() => {
  setQdnAvatarCacheForTests(null);
  vi.unstubAllGlobals();
});

describe.each(surfaces)('%s', (_label, name, view) => {
  it('shows the cached icon at once', async () => {
    const h = createAvatarTestHarness({
      handler: () => new Promise<Response>(() => {}),
    });
    setQdnAvatarCacheForTests(h.cache);
    await h.cache.putImage(name, PNG_BYTES);

    const { container } = renderSurface(view(name));

    expect(imageSources(container)).toContain('blob:test/1');
    expect(h.calls).toHaveLength(0);
  });

  it('shows the Qortal logo when the app has no icon', async () => {
    const h = createAvatarTestHarness({
      handler: (_url, { kind }) =>
        kind === 'status'
          ? statusResponse('NOT_PUBLISHED')
          : notPublishedResponse(name),
    });
    setQdnAvatarCacheForTests(h.cache);

    const { container } = renderSurface(view(name));
    await act(async () => {
      await flushAsync();
    });

    expect(h.calls.some((call) => call.name === name)).toBe(true);
    expect(
      imageSources(container).some((src) => src?.includes('LogoSelected'))
    ).toBe(true);
    expect(
      imageSources(container).some((src) => src?.startsWith('blob:'))
    ).toBe(false);
  });
});
