import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { getDefaultStore } from 'jotai';
import { createContext, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n/i18n';

// What GeneralNotifications hands its history sheet; the real dialog is not
// under test here.
const history = vi.hoisted(() => ({
  fullScreen: undefined as boolean | undefined,
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
  getFee: vi.fn(async () => ({ fee: '0.01' })),
  performPowTask: vi.fn(async () => ({ success: true, nonce: 0, hash: '00' })),
}));
vi.mock('../../../utils/globalApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/globalApi')>()),
  getBaseApiReact: () => 'http://localhost:12391',
  getBaseApiReactForAvatar: () => 'http://localhost:12391',
}));
vi.mock('../../../hooks/useSecureScreen', () => ({ useSecureScreen: vi.fn() }));
vi.mock('../../../hooks/useBlockUsers', () => ({
  useBlockedAddresses: () => ({
    refreshBlockedUsers: vi.fn(async () => {}),
    removeBlockFromList: vi.fn(),
  }),
}));
// Heavy neighbours of the sheets, not under test here.
vi.mock('../AddGroupList', () => ({ AddGroupList: () => null }));
vi.mock('../UserListOfInvites', () => ({ UserListOfInvites: () => null }));
vi.mock('../reticulumGroupScore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../reticulumGroupScore')>()),
  refreshReticulumGroupScores: vi.fn(async () => undefined),
}));
vi.mock('../../ContextMenu', () => ({
  ContextMenu: ({ children }: { children: ReactElement }) => children,
}));
vi.mock('../ReticulumGroupAbout', () => ({
  prefetchReticulumGroupAboutMetadata: vi.fn(),
}));
vi.mock('../QChatWhatsNewDialog', () => ({ QChatWhatsNewDialog: () => null }));
vi.mock('../../../qortal/get', () => ({ revokeAppNotificationRules: vi.fn() }));
vi.mock('../../../qortal/qortal-requests', () => ({
  getAppsWithNotificationPermission: vi.fn(async () => []),
  getNotificationOsPushDisabledMap: vi.fn(async () => ({})),
  getNotificationPermissionKey: vi.fn(() => ''),
  setNotificationOsPushDisabled: vi.fn(),
  setPermission: vi.fn(),
}));
vi.mock('../../Chat/MessageDisplay', () => ({ extractComponents: () => null }));
vi.mock('../../Notifications/NotificationHistoryDialog', () => ({
  NotificationHistoryDialog: ({ fullScreen }: { fullScreen?: boolean }) => {
    history.fullScreen = fullScreen;
    return null;
  },
}));
vi.mock('../../../appUpdate/appUpdateController', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../appUpdate/appUpdateController')
  >()),
  checkForUpdatesNow: vi.fn(async () => undefined),
  closeAppUpdateWindow: vi.fn(),
  loadPublishedReleases: vi.fn(async () => undefined),
  markAppUpdateSeen: vi.fn(),
  readInstalledVersion: vi.fn(async () => '0.0.16'),
}));

import { __setGoLayoutForTests } from '../../../layout/goLayout';
import { lightTheme } from '../../../styles/theme-light';
import { appUpdateWindowOpenAtom } from '../../../appUpdate/appUpdateAtoms';
import { FindGroupModal } from '../FindGroupModal';
import { DirectMessageSearchPanel } from '../DirectMessageSearchPanel';
import { AddGroup } from '../AddGroup';
import { ReticulumChatSettingsDialog } from '../GroupList';
import { HomeProfileCard } from '../HomeProfileCard';
import { AppUpdateWindow } from '../../AppUpdate/AppUpdateWindow';
import { GeneralNotifications } from '../../GeneralNotifications';
import {
  openSavedFileActions,
  SavedFileActionsSheet,
} from '../../Mobile/SavedFileActionsSheet';

type Viewport = { width: number; height: number };
const PHONE: Viewport = { width: 393, height: 873 };
const PHONE_LANDSCAPE: Viewport = { width: 873, height: 393 };
const TABLET_LANDSCAPE: Viewport = { width: 1280, height: 800 };

const originalMatchMedia = window.matchMedia;

/** Width queries answer for `width`; nothing else (hover, orientation) matches. */
const setViewport = ({ width }: Viewport) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const matches =
      (!!max || !!min) &&
      (!max || width <= Number(max[1])) &&
      (!min || width >= Number(min[1]));
    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
};

const onGo = (viewport: Viewport) => {
  setViewport(viewport);
  __setGoLayoutForTests({
    go: true,
    width: viewport.width,
    stableHeight: viewport.height,
  });
};

const onHub = (viewport: Viewport) => {
  setViewport(viewport);
  __setGoLayoutForTests({ go: false });
};

const themed = (ui: ReactElement) =>
  render(<ThemeProvider theme={lightTheme}>{ui}</ThemeProvider>);

const dialogIsFullScreen = () =>
  document.querySelector('.MuiDialog-paperFullScreen') !== null;

/** Each consumer of useSheetFullScreen: open it, then report fullScreen. */
const consumers: {
  name: string;
  open: () => void;
  isFullScreen: () => boolean;
}[] = [
  {
    name: 'Find groups',
    open: () =>
      themed(
        <FindGroupModal open setOpen={vi.fn()} onOpenJoinedGroup={vi.fn()} />
      ),
    isFullScreen: dialogIsFullScreen,
  },
  {
    name: 'DM search',
    open: () =>
      themed(
        <DirectMessageSearchPanel
          open
          onClose={vi.fn()}
          myAddress="Qme"
          directs={[]}
          onOpenResult={vi.fn()}
        />
      ),
    isFullScreen: dialogIsFullScreen,
  },
  {
    name: 'AddGroup',
    open: () => themed(<AddGroup address="Qme" open setOpen={vi.fn()} />),
    isFullScreen: dialogIsFullScreen,
  },
  {
    name: 'Q-Chat settings',
    open: () => themed(<ReticulumChatSettingsDialog open onClose={vi.fn()} />),
    isFullScreen: dialogIsFullScreen,
  },
  {
    name: 'Home settings',
    open: () => {
      themed(<HomeProfileCard />);
      fireEvent.click(
        screen.getByRole('button', { name: 'Open account settings' })
      );
    },
    isFullScreen: dialogIsFullScreen,
  },
  {
    name: 'Updates',
    open: () => {
      getDefaultStore().set(appUpdateWindowOpenAtom, true);
      themed(<AppUpdateWindow />);
    },
    isFullScreen: dialogIsFullScreen,
  },
  {
    name: 'Notification history',
    open: () => themed(<GeneralNotifications />),
    isFullScreen: () => history.fullScreen === true,
  },
];

type SendMessageWindow = Window & { sendMessage?: unknown };

beforeEach(() => {
  // User settings the sheets read on open; nothing is saved.
  (window as SendMessageWindow).sendMessage = vi.fn(async () => null);
});

afterEach(() => {
  delete (window as SendMessageWindow).sendMessage;
});

describe('useSheetFullScreen consumers', () => {
  afterEach(() => {
    cleanup();
    __setGoLayoutForTests(null);
    window.matchMedia = originalMatchMedia;
    getDefaultStore().set(appUpdateWindowOpenAtom, false);
    history.fullScreen = undefined;
  });

  const cases: [string, () => void, boolean][] = [
    ['is full screen on a GO phone, as before', () => onGo(PHONE), true],
    [
      'is full screen in a short GO window (phone landscape)',
      () => onGo(PHONE_LANDSCAPE),
      true,
    ],
    ['is a centred dialog on a GO tablet', () => onGo(TABLET_LANDSCAPE), false],
    [
      'keeps the width-only rule on the Hub',
      () => onHub(PHONE_LANDSCAPE),
      false,
    ],
    ['is still full screen on a narrow Hub window', () => onHub(PHONE), true],
  ];

  describe.each(consumers)('$name', ({ open, isFullScreen }) => {
    it.each(cases)('%s', async (_label, setup, expected) => {
      setup();
      open();
      // Let the sheet's own loads settle inside act.
      await act(async () => {});
      expect(isFullScreen()).toBe(expected);
    });
  });
});

describe('SavedFileActionsSheet width', () => {
  afterEach(() => {
    cleanup();
    __setGoLayoutForTests(null);
  });

  const openSheet = () => {
    themed(<SavedFileActionsSheet />);
    act(() =>
      openSavedFileActions({
        fileName: 'receipt.pdf',
        blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
      })
    );
    const paper = document.querySelector<HTMLElement>('.MuiDrawer-paper');
    expect(paper).not.toBeNull();
    return getComputedStyle(paper as HTMLElement);
  };

  it('is centred and at most 560px wide on GO tablets and landscape', () => {
    __setGoLayoutForTests({ go: true, width: 1280, stableHeight: 800 });
    const style = openSheet();
    expect(style.maxWidth).toBe('560px');
    expect(style.marginLeft).toBe('auto');
    expect(style.marginRight).toBe('auto');
  });

  it('spans the width on GO phones', () => {
    __setGoLayoutForTests({ go: true, width: 393, stableHeight: 873 });
    expect(openSheet().maxWidth).toBe('');
  });

  it('spans the width on the Hub', () => {
    __setGoLayoutForTests({ go: false });
    expect(openSheet().maxWidth).toBe('');
  });
});

describe('Home settings dialog on a GO tablet', () => {
  afterEach(() => {
    cleanup();
    __setGoLayoutForTests(null);
    window.matchMedia = originalMatchMedia;
  });

  /** The two-pane row and its tab nav, with the dialog open. */
  const openTwoPane = async () => {
    themed(<HomeProfileCard />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Open account settings' })
    );
    await act(async () => {});
    const row = document.querySelector('.MuiDialog-paper')
      ?.firstElementChild as HTMLElement;
    return { row, nav: row.firstElementChild as HTMLElement };
  };

  const cssText = () =>
    Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join('\n');

  it('lets the row shrink with the window and the nav scroll', async () => {
    onGo(TABLET_LANDSCAPE);
    const { row, nav } = await openTwoPane();
    const rowClass = Array.from(row.classList).find((c) =>
      c.startsWith('css-')
    );
    expect(
      cssText()
        .split('}')
        .find((rule) => rule.includes(`.${rowClass}`))
    ).toContain('min-height:min(530px, calc(100dvh - 64px))');
    expect(getComputedStyle(nav).overflowY).toBe('auto');
  });

  it('keeps the fixed 530px row on the Hub', async () => {
    onHub(TABLET_LANDSCAPE);
    const { row, nav } = await openTwoPane();
    expect(getComputedStyle(row).minHeight).toBe('530px');
    expect(getComputedStyle(nav).overflowY).not.toBe('auto');
  });
});
