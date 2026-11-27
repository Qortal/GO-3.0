import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { Provider, atom, createStore } from 'jotai';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setGoLayoutForTests } from '../../layout/goLayout';
import { mobileChatComposeActiveAtom } from '../../atoms/global';
import { MobileTopBar } from './MobileTopBar';

// The bar's own layout is under test; everything it hosts is stubbed.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../atoms/global', async () => {
  const { atom: a } = await import('jotai');
  return {
    nodeInfosAtom: a({}),
    p2pHealthAtom: a(null),
    rawWalletAtom: a(null),
    selectedNodeInfoAtom: a(null),
    mobileChatComposeActiveAtom: a(false),
    mobileFullscreenComposerActiveAtom: a(false),
    mobileGroupPanelOpenAtom: a(false),
    navigationControllerAtom: a({}),
  };
});
vi.mock('../../appUpdate/appUpdateAtoms', async () => {
  const { atom: a } = await import('jotai');
  return { appUpdateReleaseAtom: a(null), appUpdateSeenVersionAtom: a(null) };
});
vi.mock('../../appUpdate/appUpdateController', () => ({
  openAppUpdateWindow: vi.fn(),
}));
vi.mock('../../lib/p2pHealth', () => ({ computeP2pHealth: () => null }));
vi.mock('../../bridge/capacitorBridge', () => ({
  onMobileReticulumStatus: () => () => {},
}));
vi.mock('../CoreSyncStatus', () => ({ CoreSyncStatus: () => null }));
vi.mock('../Language/LanguageSelector', () => ({ default: () => null }));
vi.mock('../Theme/ThemeSelector', () => ({ default: () => null }));
vi.mock('../Reticulum/ReticulumTopBadge', () => ({ default: () => null }));
vi.mock('../GeneralNotifications', () => ({
  GeneralNotifications: forwardRef(() => null),
}));
vi.mock('../../utils/openQChatTab', () => ({
  filterAppTabsForMobile: (tabs: unknown[]) => tabs,
  isQChatOpenTab: () => false,
}));
vi.mock('../../utils/events', () => ({ executeEvent: vi.fn() }));
vi.mock('./useOpenTabs', () => ({
  useOpenTabs: () => ({ tabs: [], selectedTab: null }),
}));
vi.mock('./tabQortalLink', () => ({ liveTabQortalUrl: () => '' }));
vi.mock('./useTopBarPin', () => ({ useTopBarPin: () => null }));
vi.mock('../QortalUserAvatar', () => ({ QortalUserAvatar: () => null }));
vi.mock('../Transfers/QdnDownloadsNotice', () => ({
  useQdnDownloadsBadge: () => ({ unseen: 0 }),
}));
vi.mock('./vendorFreezeHintStore', () => ({
  claimVendorFreezeCardPop: () => false,
  useVendorFreezeHint: () => ({ bell: null }),
}));
vi.mock('../../utils/walletAvatarCache', () => ({
  getWalletAvatarCache: () => Promise.resolve(null),
  fetchWalletAvatarDataUrl: () => Promise.resolve(null),
  setWalletAvatarCache: () => Promise.resolve(),
}));
vi.mock('../Group/groupApi', () => ({
  getPrimaryNameForAvatar: () => Promise.resolve(''),
}));
vi.mock('../../hooks/useUnseenNotificationCount', () => ({
  useUnseenNotificationCount: () => ({
    hasNewNotifications: false,
    unseenCount: 0,
  }),
}));
vi.mock('../../constants/constants', () => ({
  HTTPS_EXT_NODE_QORTAL_LINK: 'https://ext-node.qortal.link',
}));
vi.mock('./MintingPublicNodeDialog', () => ({
  MintingPublicNodeDialog: () => null,
}));
vi.mock('./MobileAccountPanel', () => ({ MobileAccountPanel: () => null }));
vi.mock('../App/dialogSurface', () => ({
  dialogContentSx: {},
  getDialogPaperSx: () => ({}),
}));
vi.mock('../../utils/mobileSafeArea', () => ({
  SAFE_AREA_TOP: 'var(--safe-area-inset-top, 0px)',
  SAFE_AREA_BOTTOM: 'var(--safe-area-inset-bottom, 0px)',
  SAFE_AREA_LEFT: 'var(--safe-area-inset-left, 0px)',
  SAFE_AREA_RIGHT: 'var(--safe-area-inset-right, 0px)',
}));
vi.mock('./MobileTabBar', () => ({
  MobileTabBar: ({ variant }: { variant?: string }) => (
    <div data-testid={`tab-bar-${variant ?? 'bottom'}`} />
  ),
}));
vi.mock('./MobileTopBarSearch', () => ({
  MobileTopBarSearch: ({
    onExpandedChange,
  }: {
    onExpandedChange: (v: boolean) => void;
  }) => (
    <button
      type="button"
      aria-label="open search"
      onClick={() => onExpandedChange(true)}
    />
  ),
}));

/**
 * The emotion rules for `el`'s css-* classes, nested ones (`.css-x>*`)
 * included, as one string.
 */
const cssFor = (el: Element): string => {
  const sheet = Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n');
  return Array.from(el.classList)
    .filter((c) => c.startsWith('css-'))
    .flatMap(
      (c) => sheet.match(new RegExp(`\\.${c}[^{]*\\{[^}]*\\}`, 'g')) ?? []
    )
    .join('\n');
};

const mockLandscapeQuery = (matches: boolean) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('orientation: landscape') ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
};

const renderBar = (
  props: { collapsed?: boolean } = {},
  store = createStore()
) => {
  const utils = render(
    <Provider store={store}>
      <MobileTopBar
        userInfo={null}
        onOpenWalletsApp={vi.fn()}
        onOpenSendQort={vi.fn()}
        onOpenDrawerLookup={vi.fn()}
        onOpenMinting={vi.fn()}
        onOpenSettings={vi.fn()}
        onLogout={vi.fn()}
        onOpenTabs={vi.fn()}
        desktopViewMode="chat"
        setDesktopViewMode={vi.fn()}
        {...props}
      />
    </Provider>
  );
  // The bar is the outermost element MobileTopBar draws.
  const bar = utils.container.firstElementChild as HTMLElement;
  return { ...utils, bar };
};

afterEach(() => {
  // Unmount first: resetting the store notifies mounted subscribers.
  cleanup();
  __setGoLayoutForTests(null);
  vi.unstubAllGlobals();
});

describe('MobileTopBar inline nav', () => {
  it.each([
    ['phone landscape', { width: 873, stableHeight: 393 }, true],
    ['tablet landscape', { width: 1280, stableHeight: 800 }, true],
    ['phone portrait', { width: 393, stableHeight: 873 }, false],
    ['tablet portrait', { width: 800, stableHeight: 1280 }, false],
    // A narrow landscape window (< 600) keeps the bottom bar unless short.
    ['narrow landscape split', { width: 590, stableHeight: 540 }, false],
    // 640x360 phone minus side 3-button nav: short, so still inline.
    ['short landscape 3-button nav', { width: 592, stableHeight: 360 }, true],
  ])('GO %s follows navInTopBar', (_label, size, inline) => {
    // The media query says the opposite, to prove GO ignores it.
    mockLandscapeQuery(!inline);
    __setGoLayoutForTests({ go: true, ...size });
    renderBar();
    expect(Boolean(screen.queryByTestId('tab-bar-inline'))).toBe(inline);
  });

  it.each([true, false])(
    'Hub follows the landscape media query (%s)',
    (landscape) => {
      mockLandscapeQuery(landscape);
      __setGoLayoutForTests({ go: false });
      renderBar();
      expect(Boolean(screen.queryByTestId('tab-bar-inline'))).toBe(landscape);
    }
  );
});

describe('MobileTopBar collapsed', () => {
  it('shrinks to the status-bar strip', () => {
    __setGoLayoutForTests({ go: true, width: 873, stableHeight: 393 });
    const { bar } = renderBar({ collapsed: true });
    const css = cssFor(bar);
    expect(css).toContain('height:0');
    expect(css).toContain('min-height:0');
    expect(css).toContain('border-bottom:none');
    // The safe-area strip stays, so the camera area is still covered.
    expect(css).toContain('padding-top:var(--safe-area-inset-top, 0px)');
    expect(css).toMatch(/>\s*\*\{visibility:hidden;?\}/);
  });

  it('is a normal bar when not collapsed', () => {
    __setGoLayoutForTests({ go: true, width: 873, stableHeight: 393 });
    const { bar } = renderBar();
    const css = cssFor(bar);
    expect(css).toContain('height:52px');
    expect(css).not.toContain('visibility:hidden');
  });

  it('opens back up while its search is expanded', () => {
    __setGoLayoutForTests({ go: true, width: 873, stableHeight: 393 });
    const { bar } = renderBar({ collapsed: true });
    expect(cssFor(bar)).toContain('height:0');
    // Hidden controls have no accessible name, so query the DOM directly.
    fireEvent.click(bar.querySelector('button[aria-label="open search"]')!);
    expect(cssFor(bar)).toContain('height:52px');
    expect(cssFor(bar)).not.toContain('visibility:hidden');
  });

  it('never hides the legacy compose toolbar strip', () => {
    __setGoLayoutForTests({ go: true, width: 873, stableHeight: 393 });
    const store = createStore();
    store.set(
      mobileChatComposeActiveAtom as ReturnType<typeof atom<boolean>>,
      true
    );
    const { bar } = renderBar({ collapsed: true }, store);
    const css = cssFor(bar);
    // One-row toolbar on a short screen: 56, not 0.
    expect(css).toContain('height:56px');
    expect(css).not.toContain('visibility:hidden');
    act(() => {
      store.set(
        mobileChatComposeActiveAtom as ReturnType<typeof atom<boolean>>,
        false
      );
    });
    expect(cssFor(bar)).toContain('height:0');
  });

  it('uses the two-row compose height on GO phones in portrait', () => {
    __setGoLayoutForTests({ go: true, width: 393, stableHeight: 873 });
    const store = createStore();
    store.set(
      mobileChatComposeActiveAtom as ReturnType<typeof atom<boolean>>,
      true
    );
    const { bar } = renderBar({}, store);
    expect(cssFor(bar)).toContain('height:96px');
  });
});

describe('MobileTopBar right-hand controls', () => {
  // The Tabs button sits in the right-hand cluster with the bell and avatar.
  const clusterCss = () =>
    cssFor(screen.getByRole('button', { name: 'Open tabs' }).parentElement!);

  it.each([
    ['tablet landscape', { width: 1280, stableHeight: 800 }],
    ['tablet portrait', { width: 800, stableHeight: 1280 }],
    ['phone landscape', { width: 873, stableHeight: 393 }],
  ])('stay at the right edge on GO %s', (_label, size) => {
    __setGoLayoutForTests({ go: true, ...size });
    renderBar();
    expect(clusterCss()).toContain('margin-left:auto');
  });

  it('keep the phone layout on GO in portrait', () => {
    __setGoLayoutForTests({ go: true, width: 393, stableHeight: 873 });
    renderBar();
    expect(clusterCss()).not.toContain('margin-left:auto');
  });

  it('keep the Hub layout', () => {
    __setGoLayoutForTests({ go: false });
    renderBar();
    expect(clusterCss()).not.toContain('margin-left:auto');
  });
});
