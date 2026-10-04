import { ThemeProvider } from '@mui/material/styles';
import { act, render, screen } from '@testing-library/react';
import { forwardRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NODE = 'http://127.0.0.1:12391';

vi.mock('../../../App', () => ({ getBaseApiReact: () => NODE }));
vi.mock('../../../atoms/global', async () => {
  const { atom } = await import('jotai');
  return {
    isNewTabWindowAtom: atom(false),
    navigationControllerAtom: atom({}),
    userInfoAtom: atom(null),
  };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (k: string) => k }),
}));
vi.mock('../AppsHomeDesktop', () => ({ AppsHomeDesktop: () => null }));
vi.mock('../AppsDevModeHome', () => ({ AppsDevModeHome: () => null }));
vi.mock('../AppInfo', () => ({ AppInfo: () => null }));
vi.mock('../AppPublish', () => ({ AppPublish: () => null }));
vi.mock('../AppsLibraryDesktop', () => ({ AppsLibraryDesktop: () => null }));
vi.mock('../AppsCategoryDesktop', () => ({ AppsCategoryDesktop: () => null }));
vi.mock('../TabComponent', () => ({ default: () => null }));
vi.mock('../AppViewerContainer', () => ({
  default: forwardRef<HTMLDivElement, { app: Record<string, unknown> }>(
    ({ app }, ref) => (
      <div
        data-testid="app-viewer"
        data-name={String(app?.name)}
        data-path={String(app?.path ?? '')}
        data-tabid={String(app?.tabId)}
        ref={ref}
      />
    )
  ),
}));
vi.mock('../appNodeStatus', () => ({
  invalidateAppNodeStatuses: vi.fn(),
  watchAppNodeStatus: vi.fn(),
}));
vi.mock('../../../hooks/useAppRatings', () => ({
  RatingsCacheInitializer: () => null,
  useAppRatings: () => ({ refreshRatings: vi.fn() }),
}));
vi.mock('../../../hooks/useHandlePrivateApps', () => ({
  useHandlePrivateApps: () => ({ openApp: vi.fn() }),
}));
vi.mock('../../../qortal/qortal-requests', () => ({
  clearSessionPermissionsByTabId: vi.fn(),
}));
vi.mock('../../Chat/MessageDisplay', () => ({
  extractComponents: vi.fn(() => null),
}));
vi.mock('../../Mobile/mobileOpenTabsSession', () => ({
  loadMobileOpenTabsSession: vi.fn(async () => null),
  saveMobileOpenTabsSession: vi.fn(async () => undefined),
  serializeTabForSession: vi.fn(() => null),
}));
vi.mock('../../Mobile/mobileAppOpenCounts', () => ({
  incrementAppOpenCount: vi.fn((prev) => prev),
  loadAppOpenCounts: vi.fn(async () => ({})),
  saveAppOpenCounts: vi.fn(async () => undefined),
}));
vi.mock('../../Snackbar/Snackbar', () => ({
  CustomizedSnackbars: ({
    open,
    info,
  }: {
    open: boolean;
    info: { message?: string; type?: string } | null;
  }) =>
    open ? (
      <div data-testid="apps-snack" data-type={info?.type}>
        {info?.message}
      </div>
    ) : null,
}));

import { lightTheme } from '../../../styles/theme-light';
import { AppsDesktop } from '../AppsDesktop';

const Harness = () => {
  const [mode, setMode] = useState('home');
  const [devMode, setDevMode] = useState('home');
  const [desktopViewMode, setDesktopViewMode] = useState('apps');
  return (
    <ThemeProvider theme={lightTheme}>
      <AppsDesktop
        desktopViewMode={desktopViewMode}
        devMode={devMode}
        mode={mode}
        setDesktopViewMode={setDesktopViewMode}
        setDevMode={setDevMode}
        setMode={setMode}
        show
      />
    </ThemeProvider>
  );
};

const addTab = (data: Record<string, unknown>) => {
  act(() => {
    document.dispatchEvent(new CustomEvent('addTab', { detail: { data } }));
  });
};

const viewers = () =>
  screen.queryAllByTestId('app-viewer').map((el) => ({
    name: el.getAttribute('data-name'),
    path: el.getAttribute('data-path'),
    tabId: el.getAttribute('data-tabid'),
  }));

// Audit GO-21: addTab is the one gate every route into a Q-App tab passes
// (chat links, deep links, notifications, SET_TAB, Qortino, the library).
describe('AppsDesktop addTab gate', () => {
  let navigations: { type: string; path: unknown }[];
  const recordNavigation = (e: Event) => {
    navigations.push({
      type: e.type,
      path: (e as CustomEvent).detail?.path,
    });
  };
  let tabId: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => [] }))
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    navigations = [];
    render(<Harness />);
    addTab({ service: 'APP', name: 'Q-Wallets' });
    const open = viewers();
    expect(open).toHaveLength(1);
    expect(open[0].name).toBe('Q-Wallets');
    tabId = open[0].tabId as string;
    document.addEventListener(`navigateToPath-${tabId}`, recordNavigation);
  });

  afterEach(() => {
    document.removeEventListener(`navigateToPath-${tabId}`, recordNavigation);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('navigates an open app to an ordinary path', async () => {
    addTab({
      service: 'APP',
      name: 'Q-Wallets',
      path: 'qortal?authOnMount=true',
      navigateIfAlreadyOpen: true,
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(navigations).toEqual([
      { type: `navigateToPath-${tabId}`, path: 'qortal?authOnMount=true' },
    ]);
    expect(viewers()).toHaveLength(1);
    expect(screen.queryByTestId('apps-snack')).toBeNull();
  });

  it.each([
    '../../../render/APP/Evil',
    '%2e%2e/%2e%2e/render/APP/Evil',
    '..;/..;/render/APP/Evil',
    '%c0%ae%c0%ae/render/APP/Evil',
    '%252e%252e/render/APP/Evil',
  ])('refuses the path %j before navigating the open app', async (path) => {
    addTab({
      service: 'APP',
      name: 'Q-Wallets',
      path,
      navigateIfAlreadyOpen: true,
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(navigations).toEqual([]);
    expect(viewers()).toHaveLength(1);
    const snack = screen.getByTestId('apps-snack');
    expect(snack.getAttribute('data-type')).toBe('error');
    expect(snack.textContent).toBe('auth:message.error.invalid_qortal_link');
  });

  it.each([
    { service: 'APP', name: 'Q-Wallets', path: '../../../render/APP/Evil' },
    { service: 'APP', name: '..', path: 'render/APP/Evil' },
    { service: 'APP', name: 'Q-Wallets/../Evil' },
    { service: '../APP', name: 'Evil' },
  ])('opens no new tab for %j', async (data) => {
    addTab(data);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(viewers().map((v) => v.name)).toEqual(['Q-Wallets']);
    expect(screen.getByTestId('apps-snack').textContent).toBe(
      'auth:message.error.invalid_qortal_link'
    );
  });

  it('still opens a second, ordinary app', () => {
    addTab({ service: 'APP', name: 'Q-Tube', path: 'video/abc' });
    expect(viewers().map((v) => [v.name, v.path])).toEqual([
      ['Q-Wallets', ''],
      ['Q-Tube', 'video/abc'],
    ]);
    expect(screen.queryByTestId('apps-snack')).toBeNull();
  });
});
