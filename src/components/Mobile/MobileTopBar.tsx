import {
  useEffect,
  useRef,
  useState,
  useMemo,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import {
  ThemeProvider,
  alpha,
  keyframes,
  type Theme,
} from '@mui/material/styles';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import PersonSearchRoundedIcon from '@mui/icons-material/PersonSearchRounded';
import SavingsRoundedIcon from '@mui/icons-material/SavingsRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import LayersRoundedIcon from '@mui/icons-material/LayersRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import SystemUpdateAltRoundedIcon from '@mui/icons-material/SystemUpdateAltRounded';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  appUpdateReleaseAtom,
  appUpdateSeenVersionAtom,
} from '../../appUpdate/appUpdateAtoms';
import { openAppUpdateWindow } from '../../appUpdate/appUpdateController';
import {
  nodeInfosAtom,
  p2pHealthAtom,
  rawWalletAtom,
  selectedNodeInfoAtom,
  mobileChatComposeActiveAtom,
  mobileFullscreenComposerActiveAtom,
  mobileGroupPanelOpenAtom,
  navigationControllerAtom,
} from '../../atoms/global';
import { computeP2pHealth } from '../../lib/p2pHealth';
import { onMobileReticulumStatus } from '../../bridge/capacitorBridge';
import { CoreSyncStatus } from '../CoreSyncStatus';
import LanguageSelector from '../Language/LanguageSelector';
import ThemeSelector from '../Theme/ThemeSelector';
import ReticulumTopBadge from '../Reticulum/ReticulumTopBadge';
import {
  GeneralNotifications,
  type GeneralNotificationsHandle,
} from '../GeneralNotifications';
import {
  filterAppTabsForMobile,
  isQChatOpenTab,
} from '../../utils/openQChatTab';
import { executeEvent } from '../../utils/events';
import { useOpenTabs } from './useOpenTabs';
import { liveTabQortalUrl } from './tabQortalLink';
import { QortalUserAvatar } from '../QortalUserAvatar';
import { useQdnDownloadsBadge } from '../Transfers/QdnDownloadsNotice';
import {
  claimVendorFreezeCardPop,
  useVendorFreezeHint,
} from './vendorFreezeHintStore';
import {
  getWalletAvatarCache,
  fetchWalletAvatarDataUrl,
  setWalletAvatarCache,
  type WalletAvatarCacheEntry,
} from '../../utils/walletAvatarCache';
import { getPrimaryNameForAvatar } from '../Group/groupApi';
import { useUnseenNotificationCount } from '../../hooks/useUnseenNotificationCount';
import { HTTPS_EXT_NODE_QORTAL_LINK } from '../../constants/constants';
import { MintingPublicNodeDialog } from './MintingPublicNodeDialog';
import { MobileAccountPanel, type AccountAction } from './MobileAccountPanel';
import { MobileTopBarSearch } from './MobileTopBarSearch';
import { MobileTabBar } from './MobileTabBar';
import { dialogContentSx, getDialogPaperSx } from '../App/dialogSurface';
import { MOBILE_CHAT_TOOLBAR_SLOT_ID } from './mobileChatCompose';
import {
  SAFE_AREA_LEFT,
  SAFE_AREA_RIGHT,
  SAFE_AREA_TOP,
} from '../../utils/mobileSafeArea';
import { MOBILE_TOP_BAR_HEIGHT_PX } from './mobileBarHeights';
import {
  useGoLayout,
  useNavInTopBar,
  useToolbarOneRow,
} from '../../layout/goLayout';

// Tall enough for the two-row formatting toolbar (2 × 40px buttons + gap +
// shell padding) so every action is visible without horizontal scrolling.
const MOBILE_TOP_BAR_COMPOSE_HEIGHT_PX = 96;

const MINTING_LOCAL_DEBUG_STORAGE_KEY = 'hub.mintingLocalDebug';

// Served from the Vite public/ dir (dist root) — referenced by URL, not import.
const qortalLogo = 'qortal.png';

/** Keep above {@link MOBILE_TABS_OVERLAY_Z} (2000) in mobileLayout.ts */
const MOBILE_TOP_BAR_TABS_OPEN_Z = 2001;

// Defined in mobileBarHeights.ts to break an import cycle; re-exported for
// existing importers.
export { MOBILE_TOP_BAR_HEIGHT_PX };

type MobileTopBarProps = {
  userInfo: { name?: string; primaryName?: string; address?: string } | null;
  onOpenWalletsApp: () => void;
  onOpenSendQort: () => void;
  onOpenDrawerLookup: () => void;
  onOpenMinting: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onOpenTabs: () => void;
  tabsOverlayOpen?: boolean;
  desktopViewMode?: string;
  setDesktopViewMode?: (mode: string) => void;
  /**
   * The theme to draw the bar's own controls in, when that differs from
   * GO's (immersive mode, see-through on a page of the other brightness).
   * What they open (menus, dialogs, the bell) keeps GO's theme.
   */
  barTheme?: Theme;
  /** Floats see-through on the page's colour (immersive mode). */
  floating?: boolean;
  /**
   * GO short screens while typing in a chat: shrink to the status-bar strip
   * so the conversation gets the room. Ignored while the search is open.
   */
  collapsed?: boolean;
};

/**
 * Slim mobile top bar.
 *
 * Left: the Qortal logo (doubles as the core-connection button — a small dot
 * reflects sync state, tapping it opens the centered core + settings dialog),
 * the name, and the Reticulum status. Right: a "Tabs" button (with open-tab
 * count) and the account avatar (with optional notification badge).
 */
export const MobileTopBar = ({
  userInfo,
  onOpenWalletsApp,
  onOpenSendQort,
  onOpenDrawerLookup,
  onOpenMinting,
  onOpenSettings,
  onLogout,
  onOpenTabs,
  tabsOverlayOpen = false,
  desktopViewMode = 'home',
  setDesktopViewMode,
  barTheme,
  floating = false,
  collapsed = false,
}: MobileTopBarProps) => {
  const appTheme = useTheme();
  // The bar and its controls; what they open uses `appTheme` (inAppTheme).
  const theme = barTheme ?? appTheme;
  const inAppTheme = (node: ReactNode) =>
    barTheme ? <ThemeProvider theme={appTheme}>{node}</ThemeProvider> : node;
  const { t } = useTranslation(['core']);
  // In landscape the bottom Home/Apps/Chat bar is hidden (vertical room is
  // scarce); we surface those controls inline here, left of the avatar.
  // GO decides it from the window, so the keyboard never moves it.
  const navInTopBar = useNavInTopBar();
  // A one-row formatting toolbar (landscape, GO tablets) only needs one row
  // of height instead of two; matches chat.css.
  const composeBarHeight = useToolbarOneRow()
    ? 56
    : MOBILE_TOP_BAR_COMPOSE_HEIGHT_PX;
  // GO tablets: the search stops at 420 px, so the controls would end
  // mid-bar; keep them (and the account panel anchored to the avatar) at the
  // right edge.
  const pinControlsRight = useGoLayout(
    (l) => l.go && l.widthClass !== 'compact'
  );
  const [accountOpen, setAccountOpen] = useState(false);
  const [coreOpen, setCoreOpen] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [mintingPublicOpen, setMintingPublicOpen] = useState(false);
  const [cachedAvatarEntry, setCachedAvatarEntry] =
    useState<WalletAvatarCacheEntry | null>(null);
  const notifRef = useRef<GeneralNotificationsHandle>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const [panelAnchor, setPanelAnchor] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const rawWallet = useAtomValue(rawWalletAtom);
  const address = (userInfo?.address || rawWallet?.address0 || '').trim();
  const [resolvedPrimaryName, setResolvedPrimaryName] = useState('');
  const effectivePrimaryName =
    resolvedPrimaryName.trim() ||
    userInfo?.name?.trim() ||
    userInfo?.primaryName?.trim() ||
    '';
  const { tabs, selectedTab } = useOpenTabs();
  const navigationController = useAtomValue(navigationControllerAtom);
  const appTabs = useMemo(() => filterAppTabsForMobile(tabs), [tabs]);
  const activeAppTab = useMemo(
    () => (selectedTab && !isQChatOpenTab(selectedTab) ? selectedTab : null),
    [selectedTab]
  );
  const activeTabUrl = useMemo(() => {
    if (!activeAppTab) return '';
    const live = activeAppTab.tabId
      ? (navigationController as Record<string, { currentLink?: string }>)?.[
          String(activeAppTab.tabId)
        ]?.currentLink
      : '';
    return liveTabQortalUrl(activeAppTab, live);
  }, [activeAppTab, navigationController]);
  const showActiveTabUrl =
    desktopViewMode === 'apps' && Boolean(activeTabUrl) && !searchExpanded;
  const hideBrandCluster = searchExpanded || showActiveTabUrl;
  const nodeInfos = useAtomValue(nodeInfosAtom);
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const setP2pHealth = useSetAtom(p2pHealthAtom);
  const {
    hasNewNotifications: hasNewAppNotifications,
    unseenCount: appUnseenCount,
  } = useUnseenNotificationCount();
  // A hidden download progress card goes into the notifications, so the bell
  // counts it (and a file saved but not yet looked at).
  const downloadsBadge = useQdnDownloadsBadge();
  // "GO was stopped in the background" counts 1 until one of its actions is
  // used (opening the panel alone does not clear it).
  const vendorFreezeBell = useVendorFreezeHint().bell;
  const vendorFreezeBadge = vendorFreezeBell?.badge ? 1 : 0;
  const unseenVendorFreezeCardAt = vendorFreezeBell?.badge
    ? vendorFreezeBell.shownAt
    : null;
  const unseenCount =
    appUnseenCount + downloadsBadge.unseen + vendorFreezeBadge;
  const hasNewNotifications =
    hasNewAppNotifications ||
    downloadsBadge.unseen > 0 ||
    vendorFreezeBadge > 0;
  // A newer GO build rings its own bell on GO 3.0 Updates in the account
  // menu (and marks the avatar until that screen has shown it).
  const updateRelease = useAtomValue(appUpdateReleaseAtom);
  const updateSeenVersion = useAtomValue(appUpdateSeenVersionAtom);
  const updateAvailable = Boolean(updateRelease);
  const updateUnseen = Boolean(
    updateRelease && updateSeenVersion !== updateRelease.version
  );
  // The bell pops each time a download (or a new "GO was stopped" card)
  // lands in it.
  const [bellPop, setBellPop] = useState(0);
  const lastDownloadsUnseenRef = useRef(0);
  useEffect(() => {
    // Once per card: not again on a remount or for a card from an earlier run.
    const cardPop = claimVendorFreezeCardPop(unseenVendorFreezeCardAt);
    if (cardPop || downloadsBadge.unseen > lastDownloadsUnseenRef.current) {
      setBellPop((count) => count + 1);
    }
    lastDownloadsUnseenRef.current = downloadsBadge.unseen;
  }, [downloadsBadge.unseen, unseenVendorFreezeCardAt]);
  const chatComposeActive = useAtomValue(mobileChatComposeActiveAtom);
  const fullscreenComposerActive = useAtomValue(
    mobileFullscreenComposerActiveAtom
  );
  // A group panel (Threads, Qortal Land, Members) fills the screen with its own
  // header. Hidden rather than unmounted, so the bell and search keep state.
  const groupPanelOpen = useAtomValue(mobileGroupPanelOpenAtom);
  // The compose strip carries the legacy formatting toolbar, so it never
  // collapses; nor does an open search, which is what is being typed in.
  const collapseBar = collapsed && !searchExpanded && !chatComposeActive;

  useEffect(() => {
    return onMobileReticulumStatus((s) => {
      setP2pHealth(
        computeP2pHealth({
          onlineRemoteHubInterfaces: s.onlineRemoteHubInterfaces,
          p2pActiveOverlayPeers: s.p2pActiveOverlayPeers,
          p2pReceivingOverlayPeers: s.p2pReceivingOverlayPeers,
          p2pReceivingOverlayPeersStableMs: s.p2pReceivingOverlayPeersStableMs,
        })
      );
    });
  }, [setP2pHealth]);

  useEffect(() => {
    setResolvedPrimaryName('');
    if (!address) {
      return;
    }

    let cancelled = false;
    getPrimaryNameForAvatar(address)
      .then((name) => {
        if (!cancelled) {
          setResolvedPrimaryName(name.trim());
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedPrimaryName('');
        }
      });

    return () => {
      cancelled = true;
    };
    // Re-resolve when the connected node changes: a private->public switch must
    // re-query the name against the new node instead of showing the stale one.
  }, [address, selectedNode?.url]);

  useEffect(() => {
    setCachedAvatarEntry(null);
    if (!address) {
      return;
    }

    let cancelled = false;
    getWalletAvatarCache(address, effectivePrimaryName || null)
      .then((entry) => {
        if (!cancelled) {
          setCachedAvatarEntry(entry);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCachedAvatarEntry(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [address, effectivePrimaryName]);

  useEffect(() => {
    const name = effectivePrimaryName;
    if (!address || !name) {
      return;
    }

    if (cachedAvatarEntry?.dataUrl?.startsWith('data:')) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const dataUrl = await fetchWalletAvatarDataUrl(name);
      if (cancelled || !dataUrl) return;
      await setWalletAvatarCache(address, dataUrl, name);
      if (!cancelled) {
        setCachedAvatarEntry({ dataUrl, primaryName: name });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, effectivePrimaryName, cachedAvatarEntry?.dataUrl]);

  const syncPercent = (nodeInfos as { syncPercent?: number })?.syncPercent ?? 0;
  const isSynchronizing = Boolean(
    (nodeInfos as { isSynchronizing?: boolean })?.isSynchronizing
  );
  const coreDotColor =
    syncPercent === 100 && !isSynchronizing
      ? theme.palette.success.main
      : syncPercent > 0
        ? theme.palette.warning.main
        : theme.palette.text.disabled;

  const closeAccount = () => setAccountOpen(false);

  const openAccount = () => {
    const rect = avatarButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setPanelAnchor({
        top: rect.bottom,
        right: Math.max(10, window.innerWidth - rect.right),
      });
    }
    setAccountOpen(true);
  };

  const toggleAccount = () => {
    if (accountOpen) {
      closeAccount();
      return;
    }
    openAccount();
  };

  // Re-anchor the account panel on resize/rotation; otherwise it stays pinned
  // to the avatar's pre-rotation position and floats off-target in landscape.
  useEffect(() => {
    if (!accountOpen) return;
    const recompute = () => {
      const rect = avatarButtonRef.current?.getBoundingClientRect();
      if (rect) {
        setPanelAnchor({
          top: rect.bottom,
          right: Math.max(10, window.innerWidth - rect.right),
        });
      }
    };
    window.addEventListener('resize', recompute);
    window.addEventListener('orientationchange', recompute);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('orientationchange', recompute);
    };
  }, [accountOpen]);
  const run = (fn: () => void) => () => {
    closeAccount();
    fn();
  };

  const handleMinting = () => {
    closeAccount();
    const forceLocalMintingPreview =
      typeof window !== 'undefined' &&
      (localStorage.getItem(MINTING_LOCAL_DEBUG_STORAGE_KEY) === 'true' ||
        localStorage.getItem(MINTING_LOCAL_DEBUG_STORAGE_KEY) === '1');
    const isPublicNode =
      (selectedNode?.url || HTTPS_EXT_NODE_QORTAL_LINK) ===
      HTTPS_EXT_NODE_QORTAL_LINK;
    if (isPublicNode && !forceLocalMintingPreview) {
      setMintingPublicOpen(true);
      return;
    }
    onOpenMinting();
  };

  const openNotifications = (event?: MouseEvent) => {
    event?.stopPropagation();
    closeAccount();
    notifRef.current?.open();
  };

  const accountActions: AccountAction[] = [
    // Always present so the notifications window is reachable even with no new
    // notifications (the popover shows its own "no notifications yet" state).
    {
      icon: hasNewNotifications
        ? NotificationsActiveRoundedIcon
        : NotificationsRoundedIcon,
      label: 'Notifications',
      onClick: () => notifRef.current?.open(),
      accent: hasNewNotifications,
      ...(hasNewNotifications ? { badge: unseenCount } : {}),
    },
    {
      icon: AccountBalanceWalletRoundedIcon,
      label: 'Wallets',
      onClick: onOpenWalletsApp,
    },
    {
      icon: SendRoundedIcon,
      label: 'Send QORT',
      onClick: onOpenSendQort,
    },
    {
      icon: PersonSearchRoundedIcon,
      label: 'Address book',
      onClick: onOpenDrawerLookup,
    },
    {
      icon: SavingsRoundedIcon,
      label: 'Minting',
      onClick: handleMinting,
    },
    {
      icon: SettingsRoundedIcon,
      label: 'Node',
      onClick: onOpenSettings,
    },
    {
      icon: updateAvailable
        ? NotificationsActiveRoundedIcon
        : SystemUpdateAltRoundedIcon,
      label: t('core:go_updates.title'),
      onClick: openAppUpdateWindow,
      accent: updateAvailable,
      ...(updateUnseen ? { badge: 1 } : {}),
    },
    {
      icon: LogoutRoundedIcon,
      label: 'Logout',
      onClick: onLogout,
    },
  ];

  // The full-screen composer draws its own safe-area padding, so leaving even
  // the slim compose strip behind would show as a grey band above it.
  if (fullscreenComposerActive) return null;

  const bar = (
    <Box
      sx={{
        flexShrink: 0,
        boxSizing: 'content-box',
        height: chatComposeActive ? composeBarHeight : MOBILE_TOP_BAR_HEIGHT_PX,
        minHeight: chatComposeActive
          ? composeBarHeight
          : MOBILE_TOP_BAR_HEIGHT_PX,
        paddingTop: SAFE_AREA_TOP,
        paddingLeft: `max(10px, ${SAFE_AREA_LEFT})`,
        paddingRight: `max(10px, ${SAFE_AREA_RIGHT})`,
        display: groupPanelOpen ? 'none' : 'flex',
        alignItems: chatComposeActive ? 'center' : 'center',
        justifyContent: 'flex-start',
        gap: 0.5,
        position: chatComposeActive ? 'sticky' : 'relative',
        top: chatComposeActive ? 0 : undefined,
        zIndex: chatComposeActive
          ? 1400
          : tabsOverlayOpen
            ? MOBILE_TOP_BAR_TABS_OPEN_Z
            : undefined,
        backgroundColor:
          theme.palette.mode === 'dark'
            ? 'rgb(28, 30, 36)'
            : theme.palette.background.paper,
        borderBottom: `1px solid ${theme.palette.border?.subtle ?? 'rgba(255,255,255,0.08)'}`,
        overflow: chatComposeActive ? 'hidden' : undefined,
        // Down to the status-bar strip (paddingTop stays); the controls stay
        // mounted so the bell, search and menus keep their state.
        ...(collapseBar
          ? {
              height: 0,
              minHeight: 0,
              borderBottom: 'none',
              overflow: 'hidden',
              '& > *': { visibility: 'hidden' },
            }
          : {}),
      }}
    >
      <Box
        id={MOBILE_CHAT_TOOLBAR_SLOT_ID}
        sx={{
          alignItems: 'center',
          display: chatComposeActive ? 'flex' : 'none',
          flex: chatComposeActive ? 1 : undefined,
          justifyContent: 'center',
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
          width: '100%',
        }}
      />
      {!chatComposeActive && (
        <>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexShrink: hideBrandCluster ? 0 : 1,
              gap: 0.5,
              maxWidth: hideBrandCluster ? 0 : 240,
              minWidth: 0,
              opacity: hideBrandCluster ? 0 : 1,
              overflow: 'hidden',
              pointerEvents: hideBrandCluster ? 'none' : 'auto',
              transition:
                'opacity 180ms ease, max-width 220ms ease, width 220ms ease',
              width: hideBrandCluster ? 0 : 'auto',
            }}
          >
            <Box
              onClick={() => setCoreOpen(true)}
              role="button"
              aria-label="Core connection status"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 0.5,
                py: 0.4,
                borderRadius: 999,
                cursor: 'pointer',
                '&:active': { opacity: 0.7 },
              }}
            >
              <Box sx={{ position: 'relative', flexShrink: 0, lineHeight: 0 }}>
                <Box
                  component="img"
                  src={qortalLogo}
                  alt="Qortal"
                  sx={{ width: 24, height: 24, objectFit: 'contain' }}
                />
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: -1,
                    right: -1,
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    backgroundColor: coreDotColor,
                    border: `2px solid ${
                      theme.palette.mode === 'dark'
                        ? 'rgb(28, 30, 36)'
                        : theme.palette.background.paper
                    }`,
                  }}
                />
              </Box>
              <Typography
                sx={{
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  display: { xs: 'none', sm: 'block' },
                }}
              >
                Qortal
              </Typography>
            </Box>
            <ReticulumTopBadge />
          </Box>

          <MobileTopBarSearch
            activeTabUrl={desktopViewMode === 'apps' ? activeTabUrl : ''}
            activeTabTitle={
              activeAppTab
                ? String(
                    activeAppTab.label ||
                      (activeAppTab as { metadata?: { title?: string } })
                        .metadata?.title ||
                      activeAppTab.name ||
                      ''
                  )
                : ''
            }
            activeTabId={activeAppTab?.tabId ? String(activeAppTab.tabId) : ''}
            onRefreshActiveTab={
              activeAppTab?.tabId
                ? () => {
                    const tab = activeAppTab as {
                      tabId?: string;
                      refreshFunc?: (tabId?: string) => void;
                    };
                    if (tab.refreshFunc) {
                      tab.refreshFunc(tab.tabId);
                      return;
                    }
                    executeEvent('refreshApp', { tabId: tab.tabId });
                  }
                : undefined
            }
            expanded={searchExpanded}
            onExpandedChange={setSearchExpanded}
            showActiveTabUrl={showActiveTabUrl}
            tabsOverlayOpen={tabsOverlayOpen}
            floating={floating}
          />

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.25,
              flexShrink: 0,
              ...(pinControlsRight ? { marginLeft: 'auto' } : {}),
              opacity: searchExpanded ? 0 : 1,
              pointerEvents: searchExpanded ? 'none' : 'auto',
              transition: 'opacity 160ms ease',
            }}
          >
            {navInTopBar && setDesktopViewMode && (
              <MobileTabBar
                variant="inline"
                desktopViewMode={desktopViewMode}
                setDesktopViewMode={setDesktopViewMode}
              />
            )}
            <Box
              onClick={onOpenTabs}
              role="button"
              aria-label={tabsOverlayOpen ? 'Close tabs' : 'Open tabs'}
              aria-pressed={tabsOverlayOpen}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 0.85,
                py: 0.4,
                borderRadius: 999,
                cursor: 'pointer',
                border: `1px solid ${
                  tabsOverlayOpen
                    ? theme.palette.primary.main
                    : theme.palette.divider
                }`,
                backgroundColor: tabsOverlayOpen
                  ? 'rgba(91,141,239,0.22)'
                  : appTabs.length > 0
                    ? 'rgba(91,141,239,0.12)'
                    : 'transparent',
                '&:active': { opacity: 0.7 },
              }}
            >
              <LayersRoundedIcon
                sx={{
                  fontSize: 18,
                  color:
                    tabsOverlayOpen || appTabs.length > 0
                      ? theme.palette.primary.main
                      : theme.palette.text.secondary,
                }}
              />
              <Typography
                sx={{
                  fontSize: 12,
                  fontWeight: 700,
                  color:
                    tabsOverlayOpen || appTabs.length > 0
                      ? theme.palette.primary.main
                      : theme.palette.text.secondary,
                }}
              >
                Tabs
              </Typography>
              <Box
                component="span"
                sx={{
                  ml: 0.5,
                  display: appTabs.length ? 'inline-flex' : 'none',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  height: 16,
                  minWidth: 16,
                  px: 0.5,
                  borderRadius: 999,
                  bgcolor: theme.palette.primary.main,
                  color: theme.palette.primary.contrastText,
                }}
              >
                {appTabs.length}
              </Box>
            </Box>

            <Box
              data-go-notifications-anchor=""
              sx={{ position: 'relative', flexShrink: 0 }}
            >
              <IconButton
                ref={avatarButtonRef}
                size="small"
                aria-label="Account menu"
                aria-expanded={accountOpen}
                onClick={toggleAccount}
                sx={{
                  p: 0.35,
                  borderRadius: '50%',
                  border: `1.5px solid ${
                    theme.palette.mode === 'dark'
                      ? alpha(theme.palette.common.white, 0.18)
                      : alpha(theme.palette.common.black, 0.08)
                  }`,
                  '&:active': { opacity: 0.75, transform: 'scale(0.96)' },
                }}
              >
                <QortalUserAvatar
                  key={`${address}-${effectivePrimaryName}`}
                  primaryName={effectivePrimaryName}
                  walletAddress={address}
                  cachedAvatarEntry={cachedAvatarEntry}
                  ownAvatar
                  fallbackIconSize={20}
                  sx={{
                    width: 32,
                    height: 32,
                    bgcolor:
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.common.white, 0.1)
                        : alpha(theme.palette.common.black, 0.06),
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                />
              </IconButton>

              {hasNewNotifications && (
                <Box
                  key={bellPop}
                  role="button"
                  aria-label="New notifications"
                  onClick={openNotifications}
                  sx={{
                    // Waits for the card to arrive before it pops.
                    animation:
                      bellPop > 0
                        ? `${bellPopKeyframes} 600ms ease-out 450ms both`
                        : 'none',
                    position: 'absolute',
                    top: -2,
                    right: -2,
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: theme.palette.success.main,
                    color: '#fff',
                    border: `2px solid ${
                      theme.palette.mode === 'dark'
                        ? 'rgb(28, 30, 36)'
                        : theme.palette.background.paper
                    }`,
                    boxShadow: `0 1px 4px ${alpha(theme.palette.success.main, 0.45)}`,
                    cursor: 'pointer',
                    zIndex: 1,
                    '&:active': { transform: 'scale(0.92)' },
                  }}
                >
                  <NotificationsActiveRoundedIcon sx={{ fontSize: 11 }} />
                </Box>
              )}

              {updateUnseen && (
                <Box
                  aria-label={t('core:go_updates.update_marker')}
                  role="img"
                  sx={{
                    // Taps fall through to the avatar, which opens the menu with
                    // GO 3.0 Updates in it.
                    pointerEvents: 'none',
                    position: 'absolute',
                    bottom: -1,
                    right: -2,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: theme.palette.primary.main,
                    color: theme.palette.primary.contrastText,
                    border: `2px solid ${
                      theme.palette.mode === 'dark'
                        ? 'rgb(28, 30, 36)'
                        : theme.palette.background.paper
                    }`,
                    zIndex: 1,
                  }}
                >
                  <SystemUpdateAltRoundedIcon sx={{ fontSize: 9 }} />
                </Box>
              )}

              {inAppTheme(
                <GeneralNotifications
                  ref={notifRef}
                  compact
                  hideTrigger
                  tooltipPlacement="bottom"
                  buttonSx={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 32,
                    height: 32,
                    opacity: 0,
                    pointerEvents: 'none',
                  }}
                />
              )}
            </Box>
          </Box>

          {inAppTheme(
            <>
              <Dialog
                open={coreOpen}
                onClose={() => setCoreOpen(false)}
                fullWidth
                maxWidth="xs"
                disableAutoFocus
                PaperProps={{
                  sx: getDialogPaperSx(appTheme, { maxWidth: 420, radius: 20 }),
                }}
              >
                <DialogTitle
                  sx={{
                    alignItems: 'center',
                    borderBottom: `1px solid ${alpha(
                      appTheme.palette.divider,
                      appTheme.palette.mode === 'light' ? 0.9 : 0.35
                    )}`,
                    color: appTheme.palette.text.primary,
                    display: 'flex',
                    fontSize: '1.02rem',
                    fontWeight: 700,
                    justifyContent: 'space-between',
                    letterSpacing: '-0.01em',
                    pb: 1,
                    pt: 1.25,
                    px: 2.5,
                  }}
                >
                  Core & settings
                  <IconButton
                    size="small"
                    onClick={() => setCoreOpen(false)}
                    aria-label="Close"
                  >
                    <CloseRoundedIcon />
                  </IconButton>
                </DialogTitle>
                <DialogContent
                  sx={{ ...dialogContentSx, px: 2.5, pt: 1.25, pb: 2 }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1.25,
                      width: '100%',
                    }}
                  >
                    <CoreSyncStatus useExternalTooltip compact />
                    <Divider
                      flexItem
                      sx={{
                        borderColor: alpha(
                          appTheme.palette.divider,
                          appTheme.palette.mode === 'light' ? 0.9 : 0.35
                        ),
                      }}
                    />
                    <Box
                      sx={{
                        alignItems: 'flex-start',
                        display: 'flex',
                        gap: 3,
                        justifyContent: 'center',
                      }}
                    >
                      <Box sx={{ textAlign: 'center' }}>
                        <LanguageSelector sidebar />
                        <Typography
                          sx={{
                            color: appTheme.palette.text.secondary,
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            mt: 0.5,
                          }}
                        >
                          Language
                        </Typography>
                      </Box>
                      <Box sx={{ textAlign: 'center' }}>
                        <ThemeSelector sidebar />
                        <Typography
                          sx={{
                            color: appTheme.palette.text.secondary,
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            mt: 0.5,
                          }}
                        >
                          Theme
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                </DialogContent>
              </Dialog>

              <MobileAccountPanel
                open={accountOpen}
                anchor={panelAnchor}
                actions={accountActions}
                address={address}
                primaryName={effectivePrimaryName}
                cachedAvatarEntry={cachedAvatarEntry}
                onClose={closeAccount}
              />

              <MintingPublicNodeDialog
                open={mintingPublicOpen}
                onClose={() => setMintingPublicOpen(false)}
              />
            </>
          )}
        </>
      )}
    </Box>
  );
  return barTheme ? <ThemeProvider theme={barTheme}>{bar}</ThemeProvider> : bar;
};

export default MobileTopBar;

/** The bell badge catching a download card that flew into it. */
const bellPopKeyframes = keyframes`
  0% { transform: scale(0); }
  45% { transform: scale(1.45); }
  70% { transform: scale(0.9); }
  100% { transform: scale(1); }
`;
