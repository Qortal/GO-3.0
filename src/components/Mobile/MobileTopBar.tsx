import { useEffect, useRef, useState, useMemo, type MouseEvent } from 'react';
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
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
import { useAtomValue, useSetAtom } from 'jotai';
import { nodeInfosAtom, p2pHealthAtom, rawWalletAtom, selectedNodeInfoAtom, mobileChatComposeActiveAtom } from '../../atoms/global';
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
import { filterAppTabsForMobile, isQChatOpenTab } from '../../utils/openQChatTab';
import { executeEvent } from '../../utils/events';
import { useOpenTabs } from './useOpenTabs';
import { buildTabQortalUrl } from './tabQortalLink';
import { QortalUserAvatar } from '../QortalUserAvatar';
import { getWalletAvatarCache, fetchWalletAvatarDataUrl, setWalletAvatarCache, type WalletAvatarCacheEntry } from '../../utils/walletAvatarCache';
import { getPrimaryNameForAvatar } from '../Group/groupApi';
import { useUnseenNotificationCount } from '../../hooks/useUnseenNotificationCount';
import { HTTPS_EXT_NODE_QORTAL_LINK } from '../../constants/constants';
import { MintingPublicNodeDialog } from './MintingPublicNodeDialog';
import { MobileTopBarSearch } from './MobileTopBarSearch';
import { MobileTabBar } from './MobileTabBar';
import {
  dialogContentSx,
  getDialogPaperSx,
} from '../App/dialogSurface';
import { MOBILE_CHAT_TOOLBAR_SLOT_ID } from './mobileChatCompose';
import { SAFE_AREA_LEFT, SAFE_AREA_RIGHT, SAFE_AREA_TOP } from '../../utils/mobileSafeArea';

// Tall enough for the two-row formatting toolbar (2 × 40px buttons + gap +
// shell padding) so every action is visible without horizontal scrolling.
const MOBILE_TOP_BAR_COMPOSE_HEIGHT_PX = 96;

const MINTING_LOCAL_DEBUG_STORAGE_KEY = 'hub.mintingLocalDebug';

// Served from the Vite public/ dir (dist root) — referenced by URL, not import.
const qortalLogo = 'qortal.png';

/** Keep above {@link MOBILE_TABS_OVERLAY_Z} (2000) in mobileLayout.ts */
const MOBILE_TOP_BAR_TABS_OPEN_Z = 2001;

export const MOBILE_TOP_BAR_HEIGHT_PX = 52;

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
};

type AccountAction = {
  icon: typeof AccountBalanceWalletRoundedIcon;
  label: string;
  onClick: () => void;
  accent?: boolean;
  badge?: number;
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
}: MobileTopBarProps) => {
  const theme = useTheme();
  // In landscape the bottom Home/Apps/Chat bar is hidden (vertical room is
  // scarce); we surface those controls inline here, left of the avatar.
  const isLandscape = useMediaQuery('(orientation: landscape)');
  // Landscape compose collapses the formatting toolbar to a single row, so the
  // top bar only needs one row of height instead of two.
  const composeBarHeight = isLandscape
    ? 56
    : MOBILE_TOP_BAR_COMPOSE_HEIGHT_PX;
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
  const appTabs = useMemo(() => filterAppTabsForMobile(tabs), [tabs]);
  const activeAppTab = useMemo(
    () => (selectedTab && !isQChatOpenTab(selectedTab) ? selectedTab : null),
    [selectedTab]
  );
  const activeTabUrl = useMemo(
    () => (activeAppTab ? buildTabQortalUrl(activeAppTab) : ''),
    [activeAppTab]
  );
  const showActiveTabUrl =
    desktopViewMode === 'apps' && Boolean(activeTabUrl) && !searchExpanded;
  const hideBrandCluster = searchExpanded || showActiveTabUrl;
  const nodeInfos = useAtomValue(nodeInfosAtom);
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const setP2pHealth = useSetAtom(p2pHealthAtom);
  const { hasNewNotifications, unseenCount } = useUnseenNotificationCount();
  const chatComposeActive = useAtomValue(mobileChatComposeActiveAtom);

  useEffect(() => {
    return onMobileReticulumStatus((s) => {
      setP2pHealth(
        computeP2pHealth({
          onlineRemoteHubInterfaces: s.onlineRemoteHubInterfaces,
          p2pActiveOverlayPeers: s.p2pActiveOverlayPeers,
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
      icon: LogoutRoundedIcon,
      label: 'Logout',
      onClick: onLogout,
    },
  ];

  return (
    <Box
      sx={{
        flexShrink: 0,
        boxSizing: 'content-box',
        height: chatComposeActive
          ? composeBarHeight
          : MOBILE_TOP_BAR_HEIGHT_PX,
        minHeight: chatComposeActive
          ? composeBarHeight
          : MOBILE_TOP_BAR_HEIGHT_PX,
        paddingTop: SAFE_AREA_TOP,
        paddingLeft: `max(10px, ${SAFE_AREA_LEFT})`,
        paddingRight: `max(10px, ${SAFE_AREA_RIGHT})`,
        display: 'flex',
        alignItems: chatComposeActive ? 'center' : 'center',
        justifyContent: 'flex-start',
        gap: 0.5,
        position: chatComposeActive ? 'sticky' : 'relative',
        top: chatComposeActive ? 0 : undefined,
        zIndex: chatComposeActive ? 1400 : tabsOverlayOpen ? MOBILE_TOP_BAR_TABS_OPEN_Z : undefined,
        backgroundColor:
          theme.palette.mode === 'dark'
            ? 'rgb(28, 30, 36)'
            : theme.palette.background.paper,
        borderBottom: `1px solid ${theme.palette.border?.subtle ?? 'rgba(255,255,255,0.08)'}`,
        overflow: chatComposeActive ? 'hidden' : undefined,
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
                  (activeAppTab as { metadata?: { title?: string } }).metadata
                    ?.title ||
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
      />

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          flexShrink: 0,
          opacity: searchExpanded ? 0 : 1,
          pointerEvents: searchExpanded ? 'none' : 'auto',
          transition: 'opacity 160ms ease',
        }}
      >
        {isLandscape && setDesktopViewMode && (
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
              tabsOverlayOpen ? theme.palette.primary.main : theme.palette.divider
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

        <Box sx={{ position: 'relative', flexShrink: 0 }}>
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
              role="button"
              aria-label="New notifications"
              onClick={openNotifications}
              sx={{
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
        </Box>
      </Box>

      <Dialog
        open={coreOpen}
        onClose={() => setCoreOpen(false)}
        fullWidth
        maxWidth="xs"
        disableAutoFocus
        PaperProps={{
          sx: getDialogPaperSx(theme, { maxWidth: 420, radius: 20 }),
        }}
      >
        <DialogTitle
          sx={{
            alignItems: 'center',
            borderBottom: `1px solid ${alpha(
              theme.palette.divider,
              theme.palette.mode === 'light' ? 0.9 : 0.35
            )}`,
            color: theme.palette.text.primary,
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
        <DialogContent sx={{ ...dialogContentSx, px: 2.5, pt: 1.25, pb: 2 }}>
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
                  theme.palette.divider,
                  theme.palette.mode === 'light' ? 0.9 : 0.35
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
                    color: theme.palette.text.secondary,
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
                    color: theme.palette.text.secondary,
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

      {accountOpen && panelAnchor ? (
        <>
          <Box
            aria-hidden
            onClick={closeAccount}
            sx={{
              bgcolor: alpha(theme.palette.common.black, 0.28),
              inset: 0,
              position: 'fixed',
              zIndex: 1290,
            }}
          />
          <Box
            role="menu"
            aria-label="Account menu"
            sx={{
              '@keyframes accountPanelIn': {
                from: {
                  opacity: 0,
                  transform: 'scale(0.95) translateY(-8px)',
                },
                to: {
                  opacity: 1,
                  transform: 'scale(1) translateY(0)',
                },
              },
              '@keyframes accountItemIn': {
                from: {
                  opacity: 0,
                  transform: 'translateY(-12px)',
                },
                to: {
                  opacity: 1,
                  transform: 'translateY(0)',
                },
              },
              animation: 'accountPanelIn 200ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
              backgroundColor:
                theme.palette.mode === 'dark'
                  ? 'rgb(34, 36, 42)'
                  : theme.palette.background.paper,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: '16px',
              boxShadow:
                theme.palette.mode === 'dark'
                  ? `0 16px 40px ${alpha('#000', 0.45)}`
                  : `0 14px 36px ${alpha('#1E3248', 0.14)}`,
              maxWidth: 'min(300px, calc(100vw - 20px))',
              minWidth: 248,
              // Cap to the viewport so the full action list (incl. Logout) is
              // reachable on short landscape screens; actions scroll if needed.
              maxHeight: `calc(100dvh - ${panelAnchor.top + 8}px - 12px)`,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              position: 'fixed',
              right: panelAnchor.right,
              top: panelAnchor.top + 8,
              transformOrigin: 'top right',
              zIndex: 1291,
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                animation: 'accountItemIn 180ms ease 40ms forwards',
                borderBottom: `1px solid ${theme.palette.divider}`,
                display: 'flex',
                flexShrink: 0,
                gap: 1,
                opacity: 0,
                px: 1.25,
                py: 1.1,
              }}
            >
              <QortalUserAvatar
                key={`${address}-${effectivePrimaryName}-panel`}
                primaryName={effectivePrimaryName}
                walletAddress={address}
                cachedAvatarEntry={cachedAvatarEntry}
                fallbackIconSize={22}
                sx={{
                  width: 40,
                  height: 40,
                  bgcolor:
                    theme.palette.mode === 'dark'
                      ? alpha(theme.palette.common.white, 0.1)
                      : alpha(theme.palette.common.black, 0.06),
                  fontSize: 16,
                  fontWeight: 700,
                }}
              />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography
                  sx={{
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {effectivePrimaryName || 'Account'}
                </Typography>
                {address ? (
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontFamily: 'monospace',
                      fontSize: '0.7rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {address.slice(0, 8)}…{address.slice(-6)}
                  </Typography>
                ) : null}
              </Box>
            </Box>

            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.35,
                p: 0.75,
                minHeight: 0,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                overscrollBehavior: 'contain',
              }}
            >
              {accountActions.map(({ icon: Icon, label, onClick, accent, badge }, index) => (
                <Box
                  key={label}
                  role="menuitem"
                  onClick={run(onClick)}
                  sx={{
                    '@keyframes accountItemIn': {
                      from: {
                        opacity: 0,
                        transform: 'translateY(-12px)',
                      },
                      to: {
                        opacity: 1,
                        transform: 'translateY(0)',
                      },
                    },
                    alignItems: 'center',
                    animation: `accountItemIn 200ms cubic-bezier(0.22, 1, 0.36, 1) ${70 + index * 45}ms forwards`,
                    borderRadius: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    gap: 1,
                    opacity: 0,
                    px: 1,
                    py: 0.95,
                    transition: 'background-color 120ms ease',
                    ...(accent
                      ? {
                          bgcolor: alpha(theme.palette.success.main, 0.1),
                          border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`,
                        }
                      : {
                          '&:active': {
                            bgcolor: alpha(theme.palette.text.primary, 0.08),
                          },
                        }),
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      bgcolor: accent
                        ? alpha(theme.palette.success.main, 0.16)
                        : alpha(theme.palette.primary.main, 0.1),
                      borderRadius: '10px',
                      color: accent
                        ? theme.palette.success.main
                        : theme.palette.primary.main,
                      display: 'flex',
                      height: 32,
                      justifyContent: 'center',
                      width: 32,
                      flexShrink: 0,
                    }}
                  >
                    <Icon sx={{ fontSize: 18 }} />
                  </Box>
                  <Typography sx={{ flex: 1, fontSize: '0.88rem', fontWeight: 600 }}>
                    {label}
                  </Typography>
                  {badge != null && badge > 0 ? (
                    <Box
                      sx={{
                        alignItems: 'center',
                        bgcolor: theme.palette.success.main,
                        borderRadius: 999,
                        color: '#fff',
                        display: 'inline-flex',
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        height: 18,
                        justifyContent: 'center',
                        minWidth: 18,
                        px: 0.5,
                      }}
                    >
                      {badge > 99 ? '99+' : badge}
                    </Box>
                  ) : null}
                  <ChevronRightRoundedIcon
                    sx={{ color: theme.palette.text.disabled, fontSize: 18 }}
                  />
                </Box>
              ))}
            </Box>
          </Box>
        </>
      ) : null}

      <MintingPublicNodeDialog
        open={mintingPublicOpen}
        onClose={() => setMintingPublicOpen(false)}
      />
      </>
      )}
    </Box>
  );
};

export default MobileTopBar;
