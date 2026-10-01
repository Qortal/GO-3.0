import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      core: {
        'action.return': 'return',
        'action.search_apps': 'search apps',
        all: 'all',
        'app_category.title': 'category: {{name}}',
        'filter.sort_by': 'sort by',
        'message.generic.no_results': 'no results',
        'tabs.community_apps': 'community apps',
      },
    },
  },
  interpolation: { escapeValue: false },
});

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));

vi.mock('../../../utils/events', () => ({
  executeEvent: vi.fn(),
}));

vi.mock('../../../hooks/useAppRatings', async () => {
  const { atom } = await import('jotai');
  return {
    getCacheKey: (name: string, service: string) =>
      `${service.toLowerCase()}-${name.toLowerCase()}`,
    ratingsStoreAtom: atom(new Map()),
  };
});

vi.mock('../AppCard', () => ({
  FeaturedAppBanner: ({
    featuredApps,
  }: {
    featuredApps: { name: string }[];
  }) => (
    <div data-testid="featured">
      {featuredApps.map((app) => app.name).join(',')}
    </div>
  ),
  AppCardEnhanced: ({ app }: { app: { name: string } }) => (
    <div data-testid="card">{app.name}</div>
  ),
  AppCardListItem: ({
    app,
    isFromCategory,
  }: {
    app: { name: string };
    isFromCategory?: boolean;
  }) => (
    <div data-from-category={String(!!isFromCategory)} data-testid="row">
      {app.name}
    </div>
  ),
}));

import { Provider, createStore } from 'jotai';
import { ratingsStoreAtom } from '../../../hooks/useAppRatings';
import { CommunityAppsTab } from '../AppsLibrary/CommunityAppsTab';
import { AppsCategoryDesktop } from '../AppsCategoryDesktop';

const theme = createTheme();

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme={theme}>
    <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
  </ThemeProvider>
);

const apps = [
  ...Array.from({ length: 40 }, (_, index) => ({
    name: `community${index}`,
    service: 'APP',
    metadata: { category: index % 2 ? 'games' : 'tools' },
  })),
  // An official app, never listed under Community.
  { name: 'q-tube', service: 'APP', metadata: {} },
];

const CommunityHarness = ({
  categoryValue = 'all',
  isMobile,
}: {
  categoryValue?: string;
  isMobile: boolean;
}) => {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setScroller}>
      <CommunityAppsTab
        availableQapps={apps}
        categoryValue={categoryValue}
        isActive
        isMobile={isMobile}
        myName="me"
        scrollParent={scroller}
        searchValue=""
        sortValue="alphabetical"
        statusValue="all"
      />
    </div>
  );
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // A tall viewport so every row is in view.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    bottom: 5000,
    height: 5000,
    left: 0,
    right: 400,
    top: 0,
    width: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CommunityAppsTab', () => {
  it('lists community apps as compact rows under a counted header on phones', () => {
    render(<CommunityHarness isMobile />, { wrapper: Wrapper });

    expect(screen.getByText(/^community apps$/i)).toBeInTheDocument();
    expect(screen.getByText('(40)')).toBeInTheDocument();
    expect(screen.getAllByTestId('row')).toHaveLength(40);
    expect(screen.queryByTestId('card')).not.toBeInTheDocument();
    expect(screen.queryByText('q-tube')).not.toBeInTheDocument();
  });

  it('keeps the desktop card grid without the header', () => {
    render(<CommunityHarness isMobile={false} />, { wrapper: Wrapper });

    expect(screen.queryByText(/^community apps$/i)).not.toBeInTheDocument();
    expect(screen.getAllByTestId('card').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('row')).not.toBeInTheDocument();
  });
});

describe('Community Featured', () => {
  const rating = (averageRating: number, totalVotes: number) => ({
    averageRating,
    hasPublishedRating: true,
    lastFetched: 0,
    pollInfo: null,
    totalVotes,
    voteCounts: [],
  });

  const renderWithRatings = (categoryValue = 'all') => {
    const store = createStore();
    store.set(
      ratingsStoreAtom,
      new Map([
        ['app-community1', rating(5, 1)], // a lone self-rating
        ['app-community2', rating(4.8, 10)],
        ['app-community3', rating(5, 3)],
        ['app-q-tube', rating(5, 50)], // official, never featured here
      ]) as any
    );
    return render(
      <Provider store={store}>
        <CommunityHarness categoryValue={categoryValue} isMobile />
      </Provider>,
      { wrapper: Wrapper }
    );
  };

  it('features the best rated community apps, weighing the votes', () => {
    renderWithRatings();
    expect(screen.getByTestId('featured')).toHaveTextContent(
      /^community2,community3$/
    );
  });

  it('leaves Featured out while a filter narrows the list', () => {
    renderWithRatings('games');
    expect(screen.queryByTestId('featured')).not.toBeInTheDocument();
  });
});

describe('AppsCategoryDesktop', () => {
  const games = { id: 'games', name: 'Games' };

  it('features the best rated apps of the category', () => {
    const store = createStore();
    const rating = (averageRating: number, totalVotes: number) => ({
      averageRating,
      hasPublishedRating: true,
      lastFetched: 0,
      pollInfo: null,
      totalVotes,
      voteCounts: [],
    });
    store.set(
      ratingsStoreAtom,
      new Map([
        ['app-community1', rating(4.5, 6)], // games
        ['app-community3', rating(5, 4)], // games
        ['app-community2', rating(5, 20)], // tools: not this category
      ]) as any
    );
    render(
      <Provider store={store}>
        <AppsCategoryDesktop
          availableQapps={apps}
          category={games}
          contentHeight="100%"
          isMobile
          isShow
          myName="me"
        />
      </Provider>,
      { wrapper: Wrapper }
    );

    expect(screen.getByTestId('featured')).toHaveTextContent(
      /^community3,community1$/
    );
  });

  it('shows the category as compact rows on phones', () => {
    render(
      <AppsCategoryDesktop
        availableQapps={apps}
        category={games}
        contentHeight="100%"
        isMobile
        isShow
        myName="me"
      />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText(/^category: games$/i)).toBeInTheDocument();
    expect(screen.getByText('(20)')).toBeInTheDocument();
    const rows = screen.getAllByTestId('row');
    expect(rows).toHaveLength(20);
    expect(rows[0]).toHaveAttribute('data-from-category', 'true');
    expect(screen.queryByTestId('card')).not.toBeInTheDocument();
  });

  it('renders no rows while hidden on phones', () => {
    render(
      <AppsCategoryDesktop
        availableQapps={apps}
        category={games}
        contentHeight="100%"
        isMobile
        isShow={false}
        myName="me"
      />,
      { wrapper: Wrapper }
    );

    expect(screen.queryAllByTestId('row')).toHaveLength(0);
  });

  it('keeps the desktop card grid and translates the title', () => {
    render(
      <AppsCategoryDesktop
        availableQapps={apps}
        category={{ id: 'all', name: 'All' }}
        contentHeight="100%"
        isShow
        myName="me"
      />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText(/^category: all$/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('card')).toHaveLength(apps.length);
    expect(screen.queryByTestId('row')).not.toBeInTheDocument();
  });
});
