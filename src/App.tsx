import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
} from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Box,
  Button,
  ButtonBase,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { AnimatePresence } from 'framer-motion';
import { decryptStoredWallet } from './utils/decryptWallet';
import {
  getWalletErrorMessage,
  getWalletFieldLabel,
} from './utils/walletErrorMessages';
import './utils/seedPhrase/randomSentenceGenerator.ts';
import {
  createAccount,
  generateRandomSentence,
  saveFileToDisk,
  saveSeedPhraseToDisk,
} from './utils/generateWallet/generateWallet';
import { crypto } from './constants/decryptWallet';
import { deriveVerifiedWalletKey } from './utils/generateWallet/verifiedWalletKey';
import { AppContainer } from './styles/App-styles.ts';
import { Loader } from './components/Loader';
import ErrorBoundary from './common/ErrorBoundary';
import { AuthenticationForm } from './components/AuthenticationForm';
import {
  BuyOrderRequestScreen,
  ConnectionRequestScreen,
  CountdownOverlay,
  CreateWalletView,
  ElectronPersistentStorageHydration,
  InfoDialog,
  NotAuthenticatedFooter,
  NotificationPermissionSlideDown,
  PaymentPublishDialog,
  PaymentRequestScreen,
  QortalRequestExtensionDialog,
  QortalRequestScreen,
  ReceiveQortOverlay,
  SendQortOverlay,
  SuccessOverlay,
  SuccessScreen,
  UnsavedChangesDialog,
  WalletsView,
  WebAppAuthRequestScreen,
} from './components/App';

import { LazyAuthenticatedShell } from './components/App/LazyAuthenticatedShell';
import { PerfProfiler } from './utils/perfProfiler';
import { AppLockLayer } from './components/App/AppLockLayer';
import {
  MobileTabBar,
  MOBILE_TAB_BAR_HEIGHT_PX,
} from './components/Mobile/MobileTabBar';
import { MobileEmojiPanel } from './components/Mobile/MobileEmojiPanel';
import {
  useLastSoftKeyboardHeight,
  useSoftKeyboardInset,
} from './hooks/useSoftKeyboardInset';
import { MobileTopBar } from './components/Mobile/MobileTopBar';
import { GO_TAB_BAR_SPACE_VAR } from './components/Mobile/mobileBarHeights';
import { mobileTabBarCoveredAtom } from './components/Mobile/mobileTabBarCover';
import {
  shouldCollapseForTyping,
  useChatComposerFocus,
} from './components/Mobile/goShellLayout';
import { useGoLayout, useNavInTopBar } from './layout/goLayout';
import {
  mobileQappFrameShowingAtom,
  qappFullScreenTabAtom,
} from './components/Mobile/mobileQappFrame';
import { ImmersivePill } from './components/Mobile/immersive/ImmersivePill';
import { ImmersiveEdges } from './components/Mobile/immersive/ImmersiveEdges';
import { useImmersiveBarTheme } from './components/Mobile/immersive/useImmersiveBarTheme';
import {
  immersiveEdgeColorAtom,
  immersiveModeAtom,
  isImmersiveSurface,
} from './components/Mobile/immersive/immersiveMode';
import {
  immersiveMotionReduced,
  useImmersiveBars,
} from './components/Mobile/immersive/useImmersiveBars';
import { useTabsPullDown } from './components/Mobile/tabsPull';
import {
  immersiveContentTop,
  immersiveTabBarProps,
  immersiveTopBarSx,
} from './components/Mobile/immersive/immersiveStyles';
import { MobileTabsOverlay } from './components/Mobile/MobileTabsOverlay';
import { ChatShareHost } from './components/Chat/share/ChatShareHost';
import { initChatShareIntake } from './components/Chat/share/chatShareIntake';
import { isShareReceiverAvailable } from './plugins/ShareReceiver';
import {
  TabSnapshotScheduler,
  captureVisibleTabSnapshot,
} from './components/Mobile/tabsHome/TabSnapshotScheduler';
import { MobileBackgroundSetup } from './components/Mobile/MobileBackgroundSetup';
import { MobileCallRoot } from './components/Mobile/call/MobileCallRoot';
import { MobileCallStripSlot } from './components/Mobile/call/MobileCallStrip';
import { isGoCallUi } from './components/Mobile/call/goCallUi';
import { MobileAlertNotificationBridge } from './components/Mobile/MobileAlertNotificationBridge';
import { MintingPublicNodeDialog } from './components/Mobile/MintingPublicNodeDialog';
import { SupportChat, SUPPORT_ADDRESSES } from './components/Chat/SupportChat';
import { VoiceCallProvider } from './context/VoiceCallContext';
import { DirectVoiceCallGlobalOverlay } from './components/Chat/DirectVoiceCallGlobalOverlay';
import { DirectVoiceScreenShareOverlay } from './components/Chat/DirectVoiceScreenShareOverlay';
import { DirectVoiceCallNavWidget } from './components/Group/DirectVoiceCallNavWidget';
import { MobileVoiceCallBar } from './components/Mobile/MobileVoiceCallBar';
import { AgentSupportDashboard } from './components/Chat/AgentSupportDashboard';
import {
  GroupSupportChat,
  GROUP_SUPPORT_ADDRESSES,
} from './components/Chat/GroupSupportChat';
import { GroupAgentDashboard } from './components/Chat/GroupAgentDashboard';
import { CallSwitchGuardProvider } from './contexts/CallSwitchGuardContext';
import { GroupCallProvider } from './contexts/GroupCallContext';
import { QortalGroupVoiceCallNavWidget } from './components/Group/QortalGroupVoiceCallNavWidget';
import { QortalGroupVoiceCallStage } from './components/Group/QortalGroupVoiceCallStage';
import { useAppModals } from './hooks/useAppModals';
import { useAppReset } from './hooks/useAppReset';
import { useAppMessageHandler } from './hooks/useAppMessageHandler';
import { QortinoNotificationHost } from './components/Snackbar/QortinoNotificationHost';
import { SavedFileActionsSheet } from './components/Mobile/SavedFileActionsSheet';
import { AppUpdateWindow } from './components/AppUpdate/AppUpdateWindow';
import { BackgroundPlayerHost } from './components/Mobile/backgroundPlayer/BackgroundPlayerHost';
import { QortalCardWindow } from './components/QortalCard/QortalCardWindow';
import { useAppUpdateWatcher } from './appUpdate/useAppUpdateWatcher';
import { getWallets, storeWallets } from './background/background.ts';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from './utils/events';
import { useAndroidBack, BACK_PRIORITY } from './utils/androidBack';
import { useCloseWithGoWindows } from './utils/closeGoWindows';
import { stopSharedEarbumpPlayback } from './components/Group/earbumpSharedAudio';
import { Settings } from './components/Group/Settings';
import { useRetrieveDataLocalStorage } from './hooks/useRetrieveDataLocalStorage.tsx';
import { useQortalGetSaveSettings } from './hooks/useQortalGetSaveSettings.tsx';
import {
  authenticatePasswordAtom,
  balanceAtom,
  enableAuthWhenSyncingAtom,
  extStateAtom,
  hasSettingsChangedAtom,
  infoSnackGlobalAtom,
  isLoadingAuthenticateAtom,
  isOpenCoreSetup,
  isPublicNodeUnavailableAtom,
  isRunningPublicNodeAtom,
  openSnackGlobalAtom,
  qortalGroupCallPrimaryNamesAtom,
  qortBalanceLoadingAtom,
  rawWalletAtom,
  reticulumEnabledAtom,
  selectedNodeInfoAtom,
  userInfoAtom,
  walletToBeDecryptedErrorAtom,
  mobileChatComposeActiveAtom,
  mobileGroupPanelOpenAtom,
  mobileEmojiPanelOpenAtom,
  mobileFullscreenComposerActiveAtom,
} from './atoms/global';
import { NotAuthenticated } from './components/NotAuthenticated.tsx';
import { useFetchResources } from './hooks/useFetchResources.tsx';
import { useHandleUserInfo } from './hooks/useHandleUserInfo.tsx';
import { useHandleTutorials } from './hooks/useHandleTutorials.tsx';
import { Minting } from './components/Minting/Minting';
import { isRunningGateway } from './qortal/qortal-requests.ts';
import { useBlockedAddressesLoader } from './hooks/useBlockUsers.tsx';
import { UserLookup } from './components/UserLookup.tsx/UserLookup';
import { RegisterName } from './components/RegisterName';
import { BuyQortInformation } from './components/BuyQortInformation';
import { PdfViewer } from './common/PdfViewer';
import { ReticulumFileViewer } from './components/Chat/ReticulumFileViewer';
import { QdnTransfersOverlay } from './components/Transfers/QdnTransfersOverlay';
import { QdnPublishWindow } from './components/Transfers/QdnPublishWindow';
import { PublicNodeDownWindow } from './components/Mobile/PublicNodeDownWindow';
import { useTranslation } from 'react-i18next';
import { DownloadWallet } from './components/Auth/DownloadWallet.tsx';
import { BackupWalletModal } from './components/Auth/BackupWalletModal.tsx';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import {
  HTTP_LOCALHOST_12391,
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
  TIME_SECONDS_10_IN_MILLISECONDS,
} from './constants/constants.ts';
import { CoreSetup } from './components/CoreSetup.tsx';
import { usePresence } from './hooks/usePresence';
import { useReticulumDmAccountRegistration } from './hooks/useReticulumDmAccountRegistration';
import { useAuth } from './hooks/useAuth.tsx';
import type { extStates } from './types/app';
import { AppContextInterface, QORTAL_APP_CONTEXT } from './context/AppContext';
import { handleSetGlobalApikey } from './utils/globalApi';
import { isMainWindow } from './constants/app';
import type { CustomTitleBarRightNavProps } from './components/Desktop/CustomTitleBar';
import {
  CustomTitleBar,
  CUSTOM_TITLE_BAR_HEIGHT,
} from './components/Desktop/CustomTitleBar';
import { isDisabledLegacy } from './constants/featureFlags';
import { roundUpToDecimals } from './utils/numberFunctions.ts';
import { GlobalQortalNavBar } from './components/Desktop/GlobalQortalNavBar.tsx';
import type { AuthUnlockTransitionSnapshot } from './types/authTransition';
import { openQWalletsTab } from './utils/openQWalletsTab';
import {
  acceptedPermissionResult,
  isApprovalAcceptable,
  type ApprovalDecision,
} from './utils/qappApproval';
import {
  DECLINE_ALL_MUTE_MS,
  createApprovalMuteList,
  requestQappApproval,
} from './utils/qappApprovalQueue';
import { clearLastAuthenticatedWalletAddress } from './utils/lastAuthenticatedWallet';
import { clearWalletKdfSessionCache } from './utils/walletKdfSessionCache';
import { clearWalletUnlockSession } from './utils/walletUnlockSession';
import {
  initMobileSafeAreaInsets,
  SAFE_AREA_BOTTOM,
} from './utils/mobileSafeArea';

// Make sure the CSS safe-area vars exist before anything renders: the native
// injection can land on the splash document and be lost, leaving the top bar
// under the status bar.
initMobileSafeAreaInsets();
import { biometricUnlockWallet } from './utils/walletBiometricAuth';
import { allowReticulumStart } from './components/Reticulum/reticulumStatus';
import { isCapacitor, isGoApp } from './utils/platform';
import { pauseReticulumNetworkForLogout } from './bridge/capacitorBridge';
import { noteIdlePauseActivity } from './utils/idleAnimationPause';
import { appLockedAtom, isIdleAtom } from './atoms/presence';
import {
  AUTO_LOCK_PREFERENCE_CHANGE_EVENT,
  clearAutoLockLastActivityAt,
  isAutoLockDue,
  normalizeAutoLockTimeoutMinutes,
  readAutoLockLastActivityAt,
  readAutoLockTimeoutFromStorage,
  resolveAutoLockTimeoutMinutes,
  type AutoLockTimeoutMinutes,
  writeAutoLockLastActivityAt,
  writeAutoLockTimeoutToStorage,
} from './lib/autoLock';
import {
  canResumeSessionAtBoot,
  clearAppSessionUnlocked,
  isAppSessionUnlocked,
  readAppLockLatch,
  readAppSessionUnlockedAddress,
} from './lib/appLock';
import { useAppLock } from './hooks/useAppLock';
import { useQdnAvatarPrewarm } from './lib/qdnAvatars/useQdnAvatarPrewarm';
import { useChatHistoryWarmUp } from './reticulumChat/useChatHistoryWarmUp';
import { clearQdnAvatarPrewarmPeerNames } from './lib/qdnAvatars/prewarmSources';
import { useSendQortOverlay } from './hooks/useSendQortOverlay';

const MINTING_LOCAL_DEBUG_STORAGE_KEY = 'hub.mintingLocalDebug';
const LOCAL_CORE_READY_SYNC_PERCENT = 99.95;

// Re-export for consumers that still import from App
export type { extStates } from './types/app';
export { QORTAL_APP_CONTEXT } from './context/AppContext';
export {
  allQueues,
  clearAllQueues,
  pauseAllQueues,
  resumeAllQueues,
} from './utils/appQueues';
export {
  globalApiKey,
  handleSetGlobalApikey,
  getBaseApiReact,
  getBaseApiReactForAvatar,
  getBaseApiReactForPrimaryName,
  getArbitraryEndpointReact,
  getArbitrarySearchSimpleEndpointReact,
  getBaseApiReactSocket,
} from './utils/globalApi';
export { isMainWindow } from './constants/app';

const formatRuntimeFaultMessage = (
  value: unknown,
  fallbackMessage: string
): string => {
  if (value instanceof Error) {
    return value.stack || value.message || fallbackMessage;
  }

  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  if (
    value &&
    typeof value === 'object' &&
    'message' in value &&
    typeof (value as { message?: unknown }).message === 'string' &&
    (value as { message: string }).message.trim()
  ) {
    return (value as { message: string }).message;
  }

  if (
    value &&
    typeof value === 'object' &&
    'reason' in value &&
    typeof (value as { reason?: unknown }).reason === 'string' &&
    (value as { reason: string }).reason.trim()
  ) {
    return (value as { reason: string }).reason;
  }

  if (value != null) {
    try {
      const serialized = JSON.stringify(value, null, 2);
      if (serialized && serialized !== '{}') {
        return `${fallbackMessage}\n${serialized}`;
      }
    } catch {
      // Fall through to String(value) below.
    }

    const stringified = String(value);
    if (
      stringified &&
      stringified !== '[object Object]' &&
      stringified !== 'undefined'
    ) {
      return `${fallbackMessage}\n${stringified}`;
    }
  }

  return fallbackMessage;
};

/** Chromium reports this when resize work spans the same frame; not an app fault. */
const RESIZE_OBSERVER_LOOP_MESSAGE =
  /ResizeObserver loop completed with undelivered notifications/i;

/**
 * Transient / recoverable conditions that must NOT trip the full-screen runtime
 * fault overlay. These are background bridge, presence and network hiccups that
 * the app already retries — surfacing them as a fatal "GO runtime error" was a
 * dead-end for users (reported community feedback). Genuine render crashes are
 * still caught by the authenticated ErrorBoundary.
 */
const IGNORABLE_RUNTIME_FAULT_MESSAGES: RegExp[] = [
  RESIZE_OBSERVER_LOOP_MESSAGE,
  /ResizeObserver loop limit exceeded/i,
  // Background message bridge / Reticulum bridge timeouts (retried elsewhere).
  /Request timed out after \d+ ms\b/i,
  /Reticulum command timed out/i,
  /Reticulum bridge is not installed/i,
  // Mobile chat-engine RPC timeouts (history/summaries/etc.). Callers already
  // retry or degrade; they must not become a full-screen "GO runtime error".
  /reticulumChat:[\w:]+ timed out/i,
  /Chat engine start timed out/i,
  /worker->main request timed out/i,
  /presence command/i,
  /publish_presence/i,
  // Transient network failures while fetching from a node / gateway.
  /Failed to fetch/i,
  /Load failed/i,
  /NetworkError\b/i,
  /network request failed/i,
  /The user aborted a request/i,
  // Benign ProseMirror/TipTap DOM selection-sync hiccup during focus/blur or
  // content swaps on mobile — the editor recovers on the next render.
  /Failed to execute 'collapse' on 'Selection'/i,
  /The offset \d+ is larger than the node's length/i,
];

const isIgnorableRuntimeFault = (value: unknown): boolean => {
  const extractMessage = (): string => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message || '';
    if (
      value &&
      typeof value === 'object' &&
      'message' in value &&
      typeof (value as { message?: unknown }).message === 'string'
    ) {
      return (value as { message: string }).message;
    }
    return '';
  };

  // AbortError surfaces as a DOMException with no useful message; treat the
  // name as transient (request cancelled during navigation/unmount).
  if (
    value &&
    typeof value === 'object' &&
    'name' in value &&
    ((value as { name?: unknown }).name === 'AbortError' ||
      (value as { name?: unknown }).name === 'GifLoadCancelled')
  ) {
    return true;
  }

  const message = extractMessage().trim();
  return IGNORABLE_RUNTIME_FAULT_MESSAGES.some((re) => re.test(message));
};

function App() {
  type SendQortOriginRect = {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;

  const [extState, setExtstate] = useAtom(extStateAtom);
  const [isAppLocked, setIsAppLocked] = useAtom(appLockedAtom);
  const setIsIdle = useSetAtom(isIdleAtom);
  const [autoLockTimeoutMinutes, setAutoLockTimeoutMinutes] =
    useState<AutoLockTimeoutMinutes>(readAutoLockTimeoutFromStorage);
  const [reticulumEnabled, setReticulumEnabled] = useAtom(reticulumEnabledAtom);
  const [reticulumChatEnabled, setReticulumChatEnabled] = useState(true);
  const [desktopViewMode, setDesktopViewMode] = useState('home');
  const [rawWallet, setRawWallet] = useAtom(rawWalletAtom);
  const rawWalletRef = useRef(rawWallet);
  rawWalletRef.current = rawWallet;
  const [qortBalanceLoading, setQortBalanceLoading] = useAtom(
    qortBalanceLoadingAtom
  );
  const [requestConnection, setRequestConnection] = useState<any>(null);
  const [requestBuyOrder, setRequestBuyOrder] = useState<any>(null);
  const [userInfo, setUserInfo] = useAtom(userInfoAtom);
  useAppUpdateWatcher();
  useEffect(() => {
    let cancelled = false;
    let settingsChangeReceived = false;
    const applySettings = (settings?: {
      autoLockTimeoutMinutes?: number;
      disableAutoLockOnIdle?: boolean;
      reticulumEnabled?: boolean;
      reticulumChatEnabled?: boolean;
    }) => {
      if (cancelled) return;
      setReticulumEnabled(settings?.reticulumEnabled !== false);
      setReticulumChatEnabled(settings?.reticulumChatEnabled !== false);
      const nextTimeout = resolveAutoLockTimeoutMinutes(
        settings?.autoLockTimeoutMinutes,
        settings?.disableAutoLockOnIdle === true
      );
      setAutoLockTimeoutMinutes(nextTimeout);
      // Keep the mobile/localStorage preference in sync with Electron settings.
      writeAutoLockTimeoutToStorage(nextTimeout, { notify: false });
    };
    const onLocalPreference = (event: Event) => {
      setAutoLockTimeoutMinutes(
        normalizeAutoLockTimeoutMinutes(
          (event as CustomEvent<{ timeoutMinutes?: number }>).detail
            ?.timeoutMinutes
        )
      );
    };
    window.addEventListener(
      AUTO_LOCK_PREFERENCE_CHANGE_EVENT,
      onLocalPreference
    );
    const unsubscribe = window.electronAPI?.onAppSettingsChanged?.(
      (settings) => {
        settingsChangeReceived = true;
        applySettings(settings);
      }
    );
    void window.electronAPI?.getAppSettings?.().then((settings) => {
      if (!settingsChangeReceived) applySettings(settings);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
      window.removeEventListener(
        AUTO_LOCK_PREFERENCE_CHANGE_EVENT,
        onLocalPreference
      );
    };
  }, [setReticulumEnabled]);
  useEffect(() => {
    const w = window as Window & { __qortalCurrentAddress?: string | null };
    w.__qortalCurrentAddress = userInfo?.address ?? null;
    return () => {
      delete w.__qortalCurrentAddress;
    };
  }, [userInfo?.address]);
  const [balance, setBalance] = useAtom(balanceAtom);
  const [sendPaymentError, setSendPaymentError] = useState<string>('');
  const [countdown, setCountdown] = useState<null | number>(null);
  const [globalRuntimeFault, setGlobalRuntimeFault] = useState<{
    message: string;
    source: 'boundary' | 'error' | 'promise';
  } | null>(null);
  const [authUnlockTransition, setAuthUnlockTransition] =
    useState<AuthUnlockTransitionSnapshot | null>(null);
  const [unlockInitialPasswordFallback, setUnlockInitialPasswordFallback] =
    useState(false);
  const [walletToBeDownloaded, setWalletToBeDownloaded] = useState<any>(null);
  const [isBackupWalletModalOpen, setIsBackupWalletModalOpen] = useState(false);
  const [walletToBeDownloadedPassword, setWalletToBeDownloadedPassword] =
    useState<string>('');
  const setOpenCoreSetup = useSetAtom(isOpenCoreSetup);
  const setPublicNodeUnavailable = useSetAtom(isPublicNodeUnavailableAtom);
  const setAuthenticatePassword = useSetAtom(authenticatePasswordAtom);
  const setQcallPrimaryNames = useSetAtom(qortalGroupCallPrimaryNamesAtom);
  const [sendqortState, setSendqortState] = useState<any>(null);
  const [isLoading, setIsLoading] = useAtom(isLoadingAuthenticateAtom);
  const isAuthenticated = extState === 'authenticated';
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  // In landscape we move the Home/Apps/Chat nav into the top bar and drop the
  // bottom bar so the conversation/app content gets the vertical space back.
  // GO decides it from the window size, so the keyboard never moves it.
  const navInTopBar = useNavInTopBar();
  const showMobileBottomBar = isMobile && !navInTopBar;
  const mobileChatComposeActive = useAtomValue(mobileChatComposeActiveAtom);
  // Threads / Qortal Land / Members fill the screen, so the tab bar steps aside.
  const mobileGroupPanelOpen = useAtomValue(mobileGroupPanelOpenAtom);
  // A panel open over the bottom of the screen (the channel list drawer and
  // the like): the buttons slide away while the layout stays.
  const mobileTabBarCovered = useAtomValue(mobileTabBarCoveredAtom);
  const [tabsGridOpen, setTabsGridOpen] = useState(false);
  const tabsGridOpeningRef = useRef(false);
  // The tab cards show a picture of each page: take one of the page on
  // screen before the Tabs panel covers it (waits at most a few frames).
  const toggleTabsGrid = useCallback(() => {
    if (tabsGridOpen) {
      setTabsGridOpen(false);
      return;
    }
    if (tabsGridOpeningRef.current) return;
    tabsGridOpeningRef.current = true;
    void captureVisibleTabSnapshot(160).finally(() => {
      tabsGridOpeningRef.current = false;
      setTabsGridOpen(true);
    });
  }, [tabsGridOpen]);
  // The in-app emoji keyboard replaces the soft keyboard *and* the tab bar it
  // was sitting above (if any), so the composer above it does not move when
  // they swap.
  const emojiPanelOpen = useAtomValue(mobileEmojiPanelOpenAtom);
  const lastKeyboardHeight = useLastSoftKeyboardHeight();
  const keyboardInset = useSoftKeyboardInset();
  // In Q-Apps and Chat the tab bar steps aside while the soft keyboard is up,
  // so the app or conversation gets that strip above the keyboard back.
  const keyboardOwnsTabBarSlot =
    desktopViewMode === 'apps' ||
    desktopViewMode === 'dev' ||
    desktopViewMode === 'chat';
  const tabBarHiddenByKeyboard = keyboardOwnsTabBarSlot && keyboardInset > 0;
  const showEmojiPanel =
    emojiPanelOpen && isMobile && isAuthenticated && isMainWindow;
  // Inputs to collapseTopBarForTyping, which is worked out further down once
  // the lock state exists.
  const goShort = useGoLayout((l) => l.go && l.short);
  const chatComposerFocused = useChatComposerFocus(goShort);
  const [emojiSearchFocused, setEmojiSearchFocused] = useState(false);
  useEffect(() => {
    if (!showEmojiPanel) {
      setEmojiSearchFocused(false);
      return;
    }
    const sync = () => {
      const active = document.activeElement as HTMLElement | null;
      setEmojiSearchFocused(Boolean(active?.closest('[data-emoji-panel]')));
    };
    const onFocusOut = () => {
      window.requestAnimationFrame(sync);
    };
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', onFocusOut);
    sync();
    return () => {
      document.removeEventListener('focusin', sync);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [showEmojiPanel]);
  // Search field focused with the OS keyboard up: lift the picker above the
  // keyboard so results stay visible (Telegram-style), instead of sitting in
  // the keyboard's slot underneath it.
  const emojiSearchLifted =
    showEmojiPanel && keyboardInset > 120 && emojiSearchFocused;
  const emojiSearchPanelPx = 208;
  const emojiPanelHeightPx = showEmojiPanel
    ? emojiSearchLifted
      ? emojiSearchPanelPx
      : lastKeyboardHeight +
        (showMobileBottomBar &&
        !mobileChatComposeActive &&
        !mobileGroupPanelOpen &&
        !keyboardOwnsTabBarSlot
          ? MOBILE_TAB_BAR_HEIGHT_PX
          : 0)
    : 0;
  // While the OS keyboard is still retracting, only reserve the gap it has
  // already given back. Adding the full panel height on top of a still-open
  // keyboard would shove the composer up; tracking the inset keeps it still.
  // Search-lifted is the opposite: the keyboard is open on purpose, so reserve
  // the picker band above it.
  const emojiPanelReservePx = showEmojiPanel
    ? emojiSearchLifted
      ? emojiSearchPanelPx
      : Math.max(0, emojiPanelHeightPx - keyboardInset)
    : 0;
  const [
    walletToBeDownloadedPasswordConfirm,
    setWalletToBeDownloadedPasswordConfirm,
  ] = useState<string>('');

  const [walletToBeDownloadedError, setWalletToBeDownloadedError] =
    useState<string>('');

  const [walletToBeDecryptedError, setWalletToBeDecryptedError] = useAtom(
    walletToBeDecryptedErrorAtom
  );

  const [hasSettingsChanged, setHasSettingsChanged] = useAtom(
    hasSettingsChangedAtom
  );

  useEffect(() => {
    const w = window as Window & { __qortalCurrentAddress?: string | null };
    w.__qortalCurrentAddress = userInfo?.address ?? null;
    return () => {
      delete w.__qortalCurrentAddress;
    };
  }, [userInfo?.address]);

  const downloadResource = useFetchResources();
  const holdRefExtState = useRef<extStates>('not-authenticated');
  const suppressWalletInfoRestoreRef = useRef(false);
  const isFocusedRef = useRef<boolean>(true);
  const permissionHandlerRef = useRef<
    ((message: any, event: MessageEvent) => void) | null
  >(null);

  const { resetAllRecoil } = useAppReset();
  const { showTutorial } = useHandleTutorials();

  const modals = useAppModals();
  const {
    paymentPublish,
    unsavedChanges,
    info,
    qortalRequest,
    qortalRequestExtension,
    qortalRequestCheckbox1Ref,
  } = modals;
  const isShow = paymentPublish.isShow;
  const onCancel = paymentPublish.onCancel;
  const onOk = paymentPublish.onOk;
  const show = paymentPublish.show;
  const message = paymentPublish.message;
  const isShowUnsavedChanges = unsavedChanges.isShow;
  const onCancelUnsavedChanges = unsavedChanges.onCancel;
  const onOkUnsavedChanges = unsavedChanges.onOk;
  const showUnsavedChanges = unsavedChanges.show;
  const messageUnsavedChanges = unsavedChanges.message;
  const isShowInfo = info.isShow;
  const onOkInfo = info.onOk;
  const showInfo = info.show;
  const messageInfo = info.message;
  const onCancelQortalRequest = qortalRequest.onCancel;
  const onOkQortalRequest = qortalRequest.onOk;
  const showQortalRequest = qortalRequest.show;
  const isShowQortalRequest = qortalRequest.isShow;
  const messageQortalRequest = qortalRequest.message;
  const showQortalRequestExtension = qortalRequestExtension.show;
  const isShowQortalRequestExtension = qortalRequestExtension.isShow;
  const messageQortalRequestExtension = qortalRequestExtension.message;
  // GO-28: Q-App requests queue; Accept/Decline answer only the request whose
  // id was on screen.
  const requestIdQortalRequestExtension = qortalRequestExtension.requestId;
  const pendingQortalRequestExtension = qortalRequestExtension.pendingCount;
  const okQortalRequestExtension = qortalRequestExtension.okRequest;
  const cancelQortalRequestExtension = qortalRequestExtension.cancelRequest;
  const sameAppPendingQortalRequestExtension =
    qortalRequestExtension.sameGroupPendingCount;
  const groupKeyQortalRequestExtension = qortalRequestExtension.groupKey;
  const cancelWhereQortalRequestExtension = qortalRequestExtension.cancelWhere;
  // Apps whose requests are declined for a while after "Decline all".
  const approvalMuteListRef = useRef(createApprovalMuteList());

  const confirmRef = useRef(null);

  const setIsRunningPublicNode = useSetAtom(isRunningPublicNodeAtom);

  const [infoSnack, setInfoSnack] = useAtom(infoSnackGlobalAtom);
  const [openSnack, setOpenSnack] = useAtom(openSnackGlobalAtom);
  const [isOpenDrawerLookup, setIsOpenDrawerLookup] = useState(false);
  const [isOpenReceiveQort, setIsOpenReceiveQort] = useState(false);
  const [receiveQortOriginRect, setReceiveQortOriginRect] =
    useState<SendQortOriginRect>(null);
  const [receiveQortTargetRect, setReceiveQortTargetRect] =
    useState<SendQortOriginRect>(null);
  const [receiveQortAddress, setReceiveQortAddress] = useState('');
  const [selectedNode, setSelectedNode] = useAtom(selectedNodeInfoAtom);
  const {
    checkNodeBeforeUnlock,
    authenticate,
    getBalanceFunc,
    handleSaveNodeInfo,
    validateApiKeyFromRegistration,
  } = useAuth();
  useBlockedAddressesLoader(extState === 'authenticated');
  const { sendOfflineBeforeLogout } = usePresence();

  // App lock (N-09, GO-04, GO-39): the idle timer below, "Lock now", and a
  // lock that survives reloads and covers everything (hooks/useAppLock.ts).
  const {
    lockScreenActive,
    walletUnlocked,
    walletUnlockedRef,
    bootLastActivityAt,
    lockApp,
    unlockApp,
    runVerifiedEntry,
    noteVerifiedWalletEntry,
  } = useAppLock({
    authenticated: isAuthenticated,
    mainWindow: isMainWindow,
    walletAddress: rawWallet?.address0,
    verifyPassword: async (password) => {
      if (!rawWallet) throw new Error('Wallet data is unavailable');
      await decryptStoredWallet(password, structuredClone(rawWallet));
    },
    // Declines the request on screen and every queued one in one go, so no
    // queued request surfaces (hidden) under the lock.
    approvals: [
      {
        open: isShowQortalRequestExtension,
        decline: qortalRequestExtension.cancelAll,
      },
      { open: isShow, decline: paymentPublish.cancelAll },
      { open: isShowUnsavedChanges, decline: onCancelUnsavedChanges },
    ],
    // A backup shows the seed or the decrypted wallet: close it, not hide it.
    onLock: () => setIsBackupWalletModalOpen(false),
  });

  // Fetches the avatars GO is about to show (featured Q-Apps, tabs, recent
  // DMs and groups) in the background, so lists keep their icons when the
  // node is slow. Starts a few seconds after login, never while locked.
  useQdnAvatarPrewarm({ enabled: walletUnlocked, address: userInfo?.address });
  // Phones: the most recently active chats open with their messages already
  // on screen (local reads only, memory only, emptied on lock and logout).
  useChatHistoryWarmUp({
    enabled: walletUnlocked && isMobile,
    address: userInfo?.address,
  });

  useEffect(() => {
    if (extState !== 'authenticated') {
      setIsIdle(false);
      setIsAppLocked(false);
      clearAutoLockLastActivityAt();
    }
  }, [extState, setIsAppLocked, setIsIdle]);

  // Reaching the authenticated shell follows a user action (a password typed,
  // or a biometric prompt confirmed, which is not DOM input), so count it as
  // activity for the idle animation pause: Home animates for the usual 10 s
  // instead of staying frozen from a lock-screen timer that already ran out.
  useEffect(() => {
    if (extState === 'authenticated' && !isAppLocked) noteIdlePauseActivity();
  }, [extState, isAppLocked]);

  useEffect(() => {
    if (
      extState !== 'authenticated' ||
      !isMainWindow ||
      isAppLocked ||
      autoLockTimeoutMinutes === 0
    ) {
      return;
    }

    // Prefer the persisted stamp so a remount mid-idle does not reset the clock
    // (otherwise a long screen-off can look "fresh" until the next interval).
    let lastActivityAt = readAutoLockLastActivityAt(Date.now());
    const recordActivity = () => {
      const now = Date.now();
      if (isAutoLockDue(lastActivityAt, now, autoLockTimeoutMinutes)) {
        lockApp();
        return;
      }
      lastActivityAt = now;
      writeAutoLockLastActivityAt(now);
    };
    const checkAutoLock = () => {
      if (isAutoLockDue(lastActivityAt, Date.now(), autoLockTimeoutMinutes)) {
        lockApp();
      }
    };
    const activityEvents = [
      'mousemove',
      'keydown',
      'click',
      'touchstart',
      'wheel',
    ] as const;

    activityEvents.forEach((eventName) =>
      document.addEventListener(eventName, recordActivity, { passive: true })
    );
    window.addEventListener('focus', checkAutoLock);
    // Fire on both hide and show: locking while the screen is already off means
    // the lock modal is mounted before wake, so it paints as soon as the WebView
    // compositor recovers instead of waiting for the next 15s interval.
    document.addEventListener('visibilitychange', checkAutoLock);
    const intervalId = window.setInterval(checkAutoLock, 15_000);
    checkAutoLock();

    let appStateListenerCancelled = false;
    let removeAppStateListener: (() => void) | undefined;
    if (isCapacitor()) {
      void import('@capacitor/app')
        .then(({ App }) =>
          App.addListener('appStateChange', ({ isActive }) => {
            if (isActive) checkAutoLock();
          })
        )
        .then((handle) => {
          if (appStateListenerCancelled) {
            void handle?.remove();
            return;
          }
          removeAppStateListener = () => {
            void handle?.remove();
          };
        })
        .catch(() => {});
    }

    return () => {
      appStateListenerCancelled = true;
      window.clearInterval(intervalId);
      activityEvents.forEach((eventName) =>
        document.removeEventListener(eventName, recordActivity)
      );
      window.removeEventListener('focus', checkAutoLock);
      document.removeEventListener('visibilitychange', checkAutoLock);
      removeAppStateListener?.();
    };
  }, [autoLockTimeoutMinutes, extState, isAppLocked, lockApp]);

  useEffect(() => {
    if (typeof window.electronAPI?.onSystemLockRequested !== 'function') return;
    return window.electronAPI.onSystemLockRequested(lockApp);
  }, [lockApp]);

  const useLocalNode = isLocalNodeUrl(selectedNode?.url);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showSeed, setShowSeed] = useState(false);
  const [creationStep, setCreationStep] = useState(1);
  const getIndividualUserInfo = useHandleUserInfo();
  useRetrieveDataLocalStorage(userInfo?.address);
  useQortalGetSaveSettings(
    userInfo?.name,
    extState === 'authenticated',
    userInfo?.address
  );
  const setEnableAuthWhenSyncing = useSetAtom(enableAuthWhenSyncingAtom);

  const [isOpenMinting, setIsOpenMinting] = useState(false);
  const [mintingPublicNodeDialogOpen, setMintingPublicNodeDialogOpen] =
    useState(false);
  const generatorRef = useRef(null);

  // Android hardware back: collapse open overlays in priority order, then fall
  // back to navigating toward Home before the OS minimizes the app. Section /
  // detail level back (open chat thread, groups<->DMs) is handled closer to the
  // chat components at higher priority bands.
  useAndroidBack(
    () => {
      if (isSettingsOpen) {
        setIsSettingsOpen(false);
        return true;
      }
      return false;
    },
    {
      priority: BACK_PRIORITY.dialog,
      enabled: isMobile && isAuthenticated,
    }
  );
  useAndroidBack(
    () => {
      if (tabsGridOpen) {
        setTabsGridOpen(false);
        return true;
      }
      if (isOpenDrawerLookup) {
        setIsOpenDrawerLookup(false);
        return true;
      }
      if (mintingPublicNodeDialogOpen) {
        setMintingPublicNodeDialogOpen(false);
        return true;
      }
      if (isOpenMinting) {
        setIsOpenMinting(false);
        return true;
      }
      return false;
    },
    {
      priority: BACK_PRIORITY.overlay,
      enabled: isMobile && isAuthenticated,
    }
  );
  // A share from another app opens the chat lists: these must not cover it.
  useCloseWithGoWindows(
    tabsGridOpen ||
      isSettingsOpen ||
      isOpenDrawerLookup ||
      mintingPublicNodeDialogOpen ||
      isOpenMinting,
    () => {
      setTabsGridOpen(false);
      setIsSettingsOpen(false);
      setIsOpenDrawerLookup(false);
      setMintingPublicNodeDialogOpen(false);
      setIsOpenMinting(false);
    }
  );
  useAndroidBack(
    () => {
      // Any non-Home view returns to Home before the app minimizes.
      if (desktopViewMode !== 'home') {
        setDesktopViewMode('home');
        executeEvent('open-home-mode', {});
        return true;
      }
      return false;
    },
    {
      priority: BACK_PRIORITY.root,
      enabled: isMobile && isAuthenticated,
    }
  );

  const ensureGeneratedSeedphrase = useCallback(() => {
    const currentPhrase = generatorRef.current?.parsedString;
    if (currentPhrase) return currentPhrase;

    const generatedPhrase = generateRandomSentence();
    generatorRef.current = {
      parsedString: generatedPhrase,
    };
    return generatedPhrase;
  }, []);

  const prepareNewSeedphrase = useCallback(() => {
    const generatedPhrase = generateRandomSentence();
    generatorRef.current = {
      parsedString: generatedPhrase,
    };
    return generatedPhrase;
  }, []);

  const exportSeedphrase = () => {
    const seedPhrase = ensureGeneratedSeedphrase();
    saveSeedPhraseToDisk(seedPhrase);
  };

  useEffect(() => {
    const enableAuthWhenSyncingFromStorage = localStorage.getItem(
      'enableAuthWhenSyncing'
    );
    if (enableAuthWhenSyncingFromStorage) {
      setEnableAuthWhenSyncing(JSON.parse(enableAuthWhenSyncingFromStorage));
    }
  }, []);

  useEffect(() => {
    isRunningGateway()
      .then((res) => {
        setIsRunningPublicNode(res);
      })
      .catch((error) => {
        console.error(error);
      });
  }, [extState]);

  const [storeAccount, setStoredAccount] = useState<boolean>(true);

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      if (isIgnorableRuntimeFault(event.error ?? event.message)) {
        console.warn(
          'Ignoring non-fatal runtime fault',
          event.error || event.message,
          event
        );
        return;
      }
      console.error(
        'Global runtime error',
        event.error || event.message,
        event
      );
      setGlobalRuntimeFault({
        message: formatRuntimeFaultMessage(
          event.error ?? event.message,
          'Unknown runtime error'
        ),
        source: 'error',
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (isIgnorableRuntimeFault(reason)) {
        console.warn('Ignoring non-fatal runtime fault', reason, event);
        return;
      }
      console.error('Unhandled promise rejection', reason, event);
      setGlobalRuntimeFault({
        message: formatRuntimeFaultMessage(
          reason,
          'Unhandled promise rejection'
        ),
        source: 'promise',
      });
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener(
        'unhandledrejection',
        handleUnhandledRejection
      );
    };
  }, []);

  useEffect(() => {
    if (extState !== 'authenticated' && globalRuntimeFault) {
      setGlobalRuntimeFault(null);
    }
  }, [extState, globalRuntimeFault]);

  const contextValue = useMemo(
    () => ({
      onCancel,
      onOk,
      show,
      showInfo,
      downloadResource,
      getIndividualUserInfo,
    }),
    [onCancel, onOk, show, showInfo, downloadResource, getIndividualUserInfo]
  );

  useEffect(() => {
    try {
      setIsLoading(true);
      window
        .sendMessage('getApiKey')
        .then((response) => {
          if (response?.url) {
            handleSetGlobalApikey(response);
            setSelectedNode(response);
          } else {
            const payload = {
              url: HTTPS_EXT_NODE_QORTAL_LINK,
              apikey: '',
            };
            handleSetGlobalApikey(payload);
            setSelectedNode(payload);
          }
        })
        .catch((error) => {
          console.error(
            'Failed to get API key:',
            error?.message || 'An error occurred'
          );
        })
        .finally(() => {
          window
            .sendMessage('getWalletInfo')
            .then((response) => {
              if (response && response?.walletInfo) {
                if (suppressWalletInfoRestoreRef.current) return;

                if (
                  holdRefExtState.current === 'web-app-request-payment' ||
                  holdRefExtState.current === 'web-app-request-connection' ||
                  holdRefExtState.current === 'web-app-request-buy-order'
                )
                  return;

                if (holdRefExtState.current !== 'not-authenticated') return;

                if (response?.hasKeyPair) {
                  // Only a reload of a tab that was unlocked for this same
                  // wallet goes straight back in. Locked, timed out, a cold
                  // start or a crash: the picker asks for the fingerprint or
                  // password (N-09).
                  if (
                    !canResumeSessionAtBoot({
                      walletAddress: (
                        response as { walletInfo?: { address0?: string } }
                      )?.walletInfo?.address0,
                      latch: readAppLockLatch(),
                      unlockedSessionAddress: readAppSessionUnlockedAddress(),
                      lastActivityAt: bootLastActivityAt,
                      timeoutMinutes: readAutoLockTimeoutFromStorage(),
                      now: Date.now(),
                    })
                  ) {
                    return;
                  }
                  // Keep the idle clock running from the last activity.
                  if (bootLastActivityAt) {
                    writeAutoLockLastActivityAt(bootLastActivityAt);
                  }
                  setRawWallet(response?.walletInfo);
                  setExtstate('authenticated');
                  window.sendMessage('startNotificationCheck').catch(() => {});
                }
              }
            })
            .catch((error) => {
              console.error('Failed to get wallet info:', error);
            });
        });
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (extState) {
      holdRefExtState.current = extState;
    }
  }, [extState]);

  const address = useMemo(() => {
    if (!rawWallet?.address0) return '';
    return rawWallet.address0;
  }, [rawWallet]);

  // Send QORT and the payment / join-group deep links (GO-10): Send opens
  // only in an open, unlocked wallet, and never keeps an old recipient.
  const {
    isOpen: isOpenSendQort,
    isSuccessOpen: isOpenSendQortSuccess,
    paymentTo,
    paymentAmount,
    originRect: sendQortOriginRect,
    targetRect: sendQortTargetRect,
    openManual: onOpenSendQort,
    close: closeSendQortOverlay,
    markSent: onSendQortSent,
    continueAfterSuccess: onTransferSuccessContinue,
    closeAll: closeAllSendQort,
  } = useSendQortOverlay({ walletUnlocked, walletUnlockedRef, address });

  useReticulumDmAccountRegistration({
    managed: isMainWindow,
    authenticated: extState === 'authenticated',
    enabled: reticulumEnabled && reticulumChatEnabled,
    address,
  });

  const { getRootProps, getInputProps } = useDropzone({
    accept: {
      'application/json': ['.json'], // Only accept JSON files
    },
    maxFiles: 1,
    onDrop: async (acceptedFiles) => {
      const file: any = acceptedFiles[0];
      const fileContents = await new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onabort = () => reject('File reading was aborted');
        reader.onerror = () => reject('File reading has failed');
        reader.onload = () => {
          // Resolve the promise with the reader result when reading completes
          resolve(reader.result);
        };

        // Read the file as text
        reader.readAsText(file);
      });

      let pf: any;

      try {
        if (typeof fileContents !== 'string') return;
        pf = JSON.parse(fileContents);
      } catch (e) {
        console.log(e);
      }

      try {
        const requiredFields = [
          'address0',
          'salt',
          'iv',
          'version',
          'encryptedSeed',
          'mac',
          'kdfThreads',
        ];
        for (const field of requiredFields) {
          if (!(field in pf))
            throw new Error(
              t('auth:message.error.field_not_found_json', {
                field: getWalletFieldLabel(field),
                postProcess: 'capitalizeFirstChar',
              })
            );
        }
        setRawWallet(pf);
        setExtstate('wallet-dropped');
      } catch (e) {
        console.log(e);
      }
    },
  });

  const saveWalletFunc = async (password: string) => {
    let wallet = structuredClone(rawWallet);

    const res = await decryptStoredWallet(password, wallet);
    const wallet2 = deriveVerifiedWalletKey(res, wallet, {
      qortOnly: true,
    }).wallet;
    wallet = await wallet2.generateSaveWalletData(
      password,
      crypto.kdfThreads,
      () => {}
    );

    setWalletToBeDownloaded({
      wallet,
      qortAddress: wallet.address0,
    });
    return {
      wallet,
      qortAddress: wallet.address0,
    };
  };

  const refetchUserInfo = () => {
    window
      .sendMessage('userInfo')
      .then((response) => {
        if (response && !response.error) {
          setUserInfo(response);
        }
      })
      .catch((error) => {
        console.error('Failed to get user info:', error);
      });
  };

  const getBalanceAndUserInfoFunc = () => {
    getBalanceFunc();
    refetchUserInfo();
  };

  const qortalRequestPermissionFromExtension = async (message, event) => {
    if (message.action !== 'QORTAL_REQUEST_PERMISSION') return;
    // GO-28: names the app from appInfo only, queues behind an open request
    // (per-app limit, equal value-moving requests coalesce), and answers with
    // the result of the request that was on screen (utils/qappApprovalQueue).
    await requestQappApproval({
      message,
      show: showQortalRequestExtension,
      now: Date.now(),
      muteList: approvalMuteListRef.current,
      respond: (result) => {
        event.source.postMessage(
          {
            action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
            requestId: message?.requestId,
            result,
          },
          event.origin
        );
      },
    });
  };
  permissionHandlerRef.current = qortalRequestPermissionFromExtension;
  useAppMessageHandler(isFocusedRef, permissionHandlerRef);

  //param = isDecline
  const confirmPayment = useCallback((isDecline: boolean) => {
    // REMOVED FOR MOBILE APP
  }, []);

  const confirmBuyOrder = useCallback((isDecline: boolean) => {
    // REMOVED FOR MOBILE APP
  }, []);
  const responseToConnectionRequest = useCallback(
    (isOkay: boolean, hostname: string, interactionId: string) => {
      // REMOVED FOR MOBILE APP
    },
    []
  );
  const onConnectionRequestAccept = useCallback(
    () =>
      responseToConnectionRequest(
        true,
        requestConnection?.hostname ?? '',
        requestConnection?.interactionId ?? ''
      ),
    [
      responseToConnectionRequest,
      requestConnection?.hostname,
      requestConnection?.interactionId,
    ]
  );
  const onConnectionRequestDecline = useCallback(
    () =>
      responseToConnectionRequest(
        false,
        requestConnection?.hostname ?? '',
        requestConnection?.interactionId ?? ''
      ),
    [
      responseToConnectionRequest,
      requestConnection?.hostname,
      requestConnection?.interactionId,
    ]
  );

  const getUserInfo = useCallback(async (useTimer?: boolean) => {
    try {
      if (useTimer) {
        await new Promise((res) => {
          setTimeout(() => {
            res(null);
          }, TIME_SECONDS_10_IN_MILLISECONDS);
        });
      }
      window
        .sendMessage('userInfo')
        .then((response) => {
          if (response && !response.error) {
            setUserInfo(response);
          }
        })
        .catch((error) => {
          console.error('Failed to get user info:', error);
        });

      getBalanceFunc();
    } catch (error) {
      console.log(error);
    }
  }, []);

  useEffect(() => {
    if (!address) return;
    getUserInfo();
  }, [address]);

  const saveFileToDiskFunc = useCallback(async () => {
    try {
      if (!walletToBeDownloaded?.wallet || !walletToBeDownloaded?.qortAddress) {
        setWalletToBeDownloadedError('No wallet backup is ready yet.');
        return false;
      }

      const saved = await saveFileToDisk(
        walletToBeDownloaded.wallet,
        walletToBeDownloaded.qortAddress
      );
      if (saved && isCapacitor()) {
        executeEvent('openGlobalSnackBar', {
          message: t('auth:create_wallet.backup_saved_to_documents', {
            postProcess: 'capitalizeFirstChar',
          }),
          type: 'success',
          duration: 5600,
        });
      }
      return Boolean(saved);
    } catch (error: any) {
      setWalletToBeDownloadedError(
        getWalletErrorMessage(
          error,
          t('auth:wallet_errors.unable_to_save_backup', {
            postProcess: 'capitalizeFirstChar',
          })
        )
      );
      return false;
    }
  }, [walletToBeDownloaded, t]);

  const saveWalletToLocalStorage = async (newWallet) => {
    try {
      getWallets()
        .then((res) => {
          if (res && Array.isArray(res)) {
            const wallets = [...res, newWallet];
            storeWallets(wallets);
          } else {
            storeWallets([newWallet]);
          }
          setIsLoading(false);
        })
        .catch((error) => {
          console.error(error);
          setIsLoading(false);
        });
    } catch (error) {
      console.error(error);
    }
  };

  const createAccountFunc = async () => {
    try {
      setWalletToBeDownloadedError('');
      if (!walletToBeDownloadedPassword) {
        setWalletToBeDownloadedError(
          t('core:message.generic.password_enter', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        return;
      }
      if (!walletToBeDownloadedPasswordConfirm) {
        setWalletToBeDownloadedError(
          t('core:message.generic.password_confirm', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        return;
      }
      if (
        walletToBeDownloadedPasswordConfirm !== walletToBeDownloadedPassword
      ) {
        setWalletToBeDownloadedError(
          t('core:message.error.password_not_matching', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        return;
      }
      const generatedSeedphrase = ensureGeneratedSeedphrase();
      if (!generatedSeedphrase) {
        setWalletToBeDownloadedError(
          'We could not prepare the seedphrase. Please go back and try again.'
        );
        return;
      }
      setIsLoading(true);

      await new Promise<void>((res) => {
        setTimeout(() => {
          res();
        }, 250);
      });

      const res = await createAccount(generatedSeedphrase);
      const wallet = await res.generateSaveWalletData(
        walletToBeDownloadedPassword,
        crypto.kdfThreads,
        () => {}
      );
      await validateApiKeyFromRegistration();
      window
        .sendMessage('decryptWallet', {
          password: walletToBeDownloadedPassword,
          wallet,
        })
        .then((response) => {
          if (response && !response.error) {
            setRawWallet(wallet);
            // Created here with the password just typed: an unlocked wallet.
            noteVerifiedWalletEntry(wallet?.address0);
            if (storeAccount) {
              saveWalletToLocalStorage(wallet);
            }
            setWalletToBeDownloaded({
              wallet,
              qortAddress: wallet.address0,
            });

            window
              .sendMessage('userInfo')
              .then((response2) => {
                setIsLoading(false);
                if (response2 && !response2.error) {
                  setUserInfo(response2);
                }
              })
              .catch((error) => {
                setIsLoading(false);
                console.error('Failed to get user info:', error);
              });

            getBalanceFunc();
          } else if (response?.error) {
            setIsLoading(false);
            setWalletToBeDecryptedError(getWalletErrorMessage(response.error));
          }
        })
        .catch((error) => {
          setIsLoading(false);
          setWalletToBeDecryptedError(getWalletErrorMessage(error));
          console.error('Failed to decrypt wallet:', error);
        });
    } catch (error: any) {
      console.error('Failed to create account:', error);
      setWalletToBeDownloadedError(
        'We could not create this account. Please try again.'
      );
      setIsLoading(false);
    }
  };

  const cleanupAudioSurfaceBeforeLogout = useCallback(async () => {
    if (typeof window.audioSurface?.sendCommand !== 'function') return;
    try {
      await Promise.race([
        window.audioSurface.sendCommand({ type: 'logout-cleanup' }),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, 2_000);
        }),
      ]);
    } catch (error) {
      console.warn('[GCall] Audio surface logout cleanup failed:', error);
    }
  }, []);

  const cleanupReticulumAccountBeforeLogout = useCallback(async () => {
    if (typeof window.reticulumChat?.clearLocalAccountState !== 'function')
      return;
    let timeoutId: number | undefined;
    try {
      await Promise.race([
        window.reticulumChat.clearLocalAccountState(),
        new Promise<void>((resolve) => {
          timeoutId = window.setTimeout(resolve, 2_000);
        }),
      ]);
    } catch (error) {
      // Logout must remain available if Reticulum is disabled or shutting
      // down. The main-process cleanup invalidates account work before its
      // first await, so it remains safe to continue after this bounded wait.
      console.warn('[ReticulumChat] Logout cleanup failed:', error);
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    }
  }, []);

  const logoutFunc = useCallback(async () => {
    try {
      if (extState === 'authenticated') {
        await showUnsavedChanges({
          message: t('core:message.question.logout', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
      }
      // Send the offline presence notice while the key is still in secure
      // storage. The background clears keyPair as part of logout, so signing
      // must happen here — before sendMessage('logout') is called.
      await cleanupAudioSurfaceBeforeLogout();
      await sendOfflineBeforeLogout();
      await cleanupReticulumAccountBeforeLogout();
      const response = await window.sendMessage('logout', {});
      if (response) {
        // The offline notice went out above; close the hub sockets after
        // the native delay so it can leave first. Only a real logout does
        // this, never a layout unmount.
        pauseReticulumNetworkForLogout();
        clearLastAuthenticatedWalletAddress();
        stopSharedEarbumpPlayback();
        executeEvent('logout-event', {});
        resetAllStates();
        // Let authenticated children unmount, then sweep once more. This
        // catches a registration IPC that was already queued when the first
        // cleanup invalidated the account lifecycle.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        await cleanupReticulumAccountBeforeLogout();
      }
    } catch (error) {
      console.error(
        'Failed to log out:',
        error instanceof Error ? error.message : 'An error occurred'
      );
    }
  }, [
    hasSettingsChanged,
    extState,
    cleanupAudioSurfaceBeforeLogout,
    cleanupReticulumAccountBeforeLogout,
    sendOfflineBeforeLogout,
  ]);

  const returnToMain = useCallback(() => {
    suppressWalletInfoRestoreRef.current = true;
    // Back into the wallet only when this tab unlocked it (password,
    // fingerprint, or a wallet just created here); otherwise to the picker.
    const nextState: extStates = isAppSessionUnlocked(
      rawWalletRef.current?.address0
    )
      ? 'authenticated'
      : 'not-authenticated';
    holdRefExtState.current = nextState;
    setSendPaymentError('');
    setCountdown(null);
    setWalletToBeDownloaded(null);
    setWalletToBeDownloadedPassword('');
    generatorRef.current = null;
    setShowSeed(false);
    setCreationStep(1);
    setReceiveQortOriginRect(null);
    setReceiveQortTargetRect(null);
    setReceiveQortAddress('');
    setExtstate(nextState);
    closeAllSendQort();
    setIsOpenReceiveQort(false);
  }, [closeAllSendQort]);

  const resetAllStates = () => {
    clearWalletKdfSessionCache();
    clearWalletUnlockSession();
    clearAppSessionUnlocked();
    suppressWalletInfoRestoreRef.current = true;
    holdRefExtState.current = 'not-authenticated';
    setExtstate('not-authenticated');
    setRawWallet(null);
    setRequestConnection(null);
    setRequestBuyOrder(null);
    setUserInfo(null);
    setBalance(null);
    setSendPaymentError('');
    setCountdown(null);
    setWalletToBeDownloaded(null);
    setWalletToBeDownloadedPassword('');
    generatorRef.current = null;
    setShowSeed(false);
    setCreationStep(1);
    setWalletToBeDownloadedPasswordConfirm('');
    setWalletToBeDownloadedError('');
    setSendqortState(null);
    // Send/Receive belong to the signed-in wallet; never carry them over.
    closeAllSendQort();
    setIsOpenReceiveQort(false);
    setQcallPrimaryNames({});
    // DM partner names of this account must not reach the next one's prewarm.
    clearQdnAvatarPrewarmPeerNames();
    downloadResource.cancelAllResourceDownloads();
    resetAllRecoil();
  };

  // Repeat Unlock taps / Enter while a password unlock is still checking the
  // node (or decrypting) are ignored instead of starting the checks again.
  const passwordUnlockInFlightRef = useRef(false);

  const authenticateWallet = async (options?: {
    skipNodeCheck?: boolean;
    skipLocalCheck?: boolean;
  }) => {
    const checkNode = !options?.skipNodeCheck;
    if (checkNode) {
      if (passwordUnlockInFlightRef.current) return;
      passwordUnlockInFlightRef.current = true;
      // A remote node (e.g. over an SSH tunnel) can take a few round trips;
      // show the loader now, not only once the decrypt starts.
      setIsLoading(true);
    }
    try {
      if (checkNode) {
        // authenticate() fetches user info itself after the decrypt. On GO a
        // node that cannot be reached does not stop the unlock (as with the
        // fingerprint); a rejected key does.
        const mayUnlock = await checkNodeBeforeUnlock({
          refreshUserInfo: false,
        });
        if (!mayUnlock) {
          setIsLoading(false);
          return;
        }
      }
      // The password (or the form's fingerprint) is checked in here, so the
      // shell it opens is not held behind a lock latch.
      const unlocked = await runVerifiedEntry(
        () => authenticate(undefined, options?.skipLocalCheck),
        () => rawWalletRef.current?.address0
      );
      // Covers the early returns that never touch the loader (local node
      // still syncing, another unlock already running).
      if (!unlocked && checkNode) setIsLoading(false);
    } catch (error) {
      if (checkNode) setIsLoading(false);
      setWalletToBeDecryptedError(
        t('core:message.error.password_wrong', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    } finally {
      if (checkNode) passwordUnlockInFlightRef.current = false;
    }
  };

  const handleBiometricWalletUnlock = useCallback(
    async (
      wallet: any,
      transitionSnapshot?: AuthUnlockTransitionSnapshot
    ): Promise<boolean> => {
      const address = wallet?.address0?.trim();
      if (!address) return false;

      const unlockPromise = biometricUnlockWallet(address, wallet);

      if (transitionSnapshot) {
        setAuthUnlockTransition(transitionSnapshot);
      }
      setRawWallet(wallet);
      setUnlockInitialPasswordFallback(false);

      try {
        const unlockResult = await unlockPromise;
        if (unlockResult !== 'resume') {
          setAuthenticatePassword(unlockResult);
        }

        // The fingerprint was verified above.
        return await runVerifiedEntry(
          () => authenticate(undefined, true),
          () => address
        );
      } catch {
        return false;
      }
    },
    [
      authenticate,
      runVerifiedEntry,
      setAuthUnlockTransition,
      setAuthenticatePassword,
      setRawWallet,
    ]
  );

  const handleWalletPasswordFallbackUnlock = useCallback(() => {
    setUnlockInitialPasswordFallback(true);
  }, []);

  useEffect(() => {
    if (!isMainWindow) return;
    // Handler for when the window gains focus
    const handleFocus = () => {
      // On the phone, window focus can arrive while GO is off screen (page
      // kept alive); document.hidden follows Android there.
      isFocusedRef.current = !document.hidden;
    };

    // Handler for when the window loses focus
    const handleBlur = () => {
      isFocusedRef.current = false;
    };

    // Attach the event listeners
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    // Optionally, listen for visibility changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        isFocusedRef.current = true;
      } else {
        isFocusedRef.current = false;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup the event listeners on component unmount
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const openReceiveQortInternal = (e) => {
    const anchorRect = e.detail?.anchorRect;
    const targetRect = e.detail?.targetRect;
    setReceiveQortOriginRect(
      anchorRect
        ? {
            left: anchorRect.left,
            top: anchorRect.top,
            width: anchorRect.width,
            height: anchorRect.height,
          }
        : null
    );
    setReceiveQortTargetRect(
      targetRect
        ? {
            left: targetRect.left,
            top: targetRect.top,
            width: targetRect.width,
            height: targetRect.height,
          }
        : null
    );
    setReceiveQortAddress(e.detail?.address || address || '');
    setIsOpenReceiveQort(true);
  };

  useEffect(() => {
    subscribeToEvent('openReceiveQortInternal', openReceiveQortInternal);

    if (address) {
      // Photos/videos shared from other apps via the "Quitter" share-sheet
      // target (Android). Idempotent — safe to call on every auth.
      void import('./components/Widgets/quitter/quitterShareIntake')
        .then(({ initQuitterShareIntake }) => initQuitterShareIntake())
        .catch(() => undefined);
      // Text, links and files shared into a group or a DM ("GO Groups" /
      // "GO DMs" in the share sheet); ChatShareHost below shows the picker.
      initChatShareIntake();
    }

    return () => {
      unsubscribeFromEvent('openReceiveQortInternal', openReceiveQortInternal);
    };
  }, [address]);

  const onOpenRegisterName = useCallback(
    () => executeEvent('openRegisterName', {}),
    []
  );
  const onOpenSettings = useCallback(() => setIsSettingsOpen(true), []);
  const onOpenDrawerLookup = useCallback(
    () => setIsOpenDrawerLookup((prev) => !prev),
    []
  );
  const onOpenWalletsApp = useCallback(() => openQWalletsTab(), []);
  const onOpenMinting = useCallback(async () => {
    try {
      const forceLocalMintingPreview =
        typeof window !== 'undefined' &&
        (localStorage.getItem(MINTING_LOCAL_DEBUG_STORAGE_KEY) === 'true' ||
          localStorage.getItem(MINTING_LOCAL_DEBUG_STORAGE_KEY) === '1');
      const selectedUrl = selectedNode?.url || HTTPS_EXT_NODE_QORTAL_LINK;
      const isPublicNode = selectedUrl === HTTPS_EXT_NODE_QORTAL_LINK;
      if (isPublicNode && !forceLocalMintingPreview) {
        setMintingPublicNodeDialogOpen(true);
        return;
      }
      const res = await isRunningGateway();
      if (res && !forceLocalMintingPreview)
        throw new Error(
          t('core:message.generic.no_minting_details', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      setIsOpenMinting(true);
    } catch (error: any) {
      setOpenSnack(true);
      setInfoSnack({
        type: 'error',
        message: error?.message,
      });
    }
  }, [selectedNode?.url, t]);
  const onBackupWallet = useCallback(() => {
    if (extState === 'authenticated' && rawWallet) {
      setIsBackupWalletModalOpen(true);
      return;
    }

    setExtstate('download-wallet');
  }, [extState, rawWallet, setExtstate]);

  // Defer the Python/Reticulum transport until after login: booting it on the
  // unlock screen saturates the CPU and the JS bridge, delaying the biometric
  // prompt and the wallet decrypt by many seconds on mid-range devices.
  useEffect(() => {
    if (extState !== 'authenticated') return;
    const idleStart = window.setTimeout(() => {
      allowReticulumStart();
      if (!reticulumEnabled) return;
      // Warm the chat engine here instead of waiting for the chat UI to mount
      // and ask for it. The worker has to open OPFS and sqlite-wasm before it
      // can answer anything, so starting it now overlaps that cost with the
      // authenticated shell chunk and the group websocket's first payload.
      void (async () => {
        try {
          const chatEnabled = await window.reticulumChat?.isEnabled?.();
          if (chatEnabled === false) return;
          await window.reticulumChat?.getReadinessStatus?.();
        } catch {
          /* best effort: the chat UI starts the engine itself if this fails */
        }
      })();
    }, 400);
    return () => window.clearTimeout(idleStart);
  }, [extState, reticulumEnabled]);

  const closeBackupWalletModal = useCallback(() => {
    setIsBackupWalletModalOpen(false);
  }, []);

  // GO keeps its node settings in Settings; the desktop in Core setup.
  const onOpenNodeSettings = useCallback(() => {
    if (isGoApp()) setIsSettingsOpen(true);
    else setOpenCoreSetup(true);
  }, [setOpenCoreSetup]);

  useEffect(() => {
    subscribeToEvent('openMintingPanel', onOpenMinting);
    subscribeToEvent('openBackupWallet', onBackupWallet);
    subscribeToEvent('openNodeSettings', onOpenNodeSettings);

    return () => {
      unsubscribeFromEvent('openMintingPanel', onOpenMinting);
      unsubscribeFromEvent('openBackupWallet', onBackupWallet);
      unsubscribeFromEvent('openNodeSettings', onOpenNodeSettings);
    };
  }, [onBackupWallet, onOpenMinting, onOpenNodeSettings]);

  const onOkQortalRequestAccepted = useCallback(
    () => onOkQortalRequest('accepted'),
    [onOkQortalRequest]
  );
  const onConfirmBuyOrderAccept = useCallback(
    () => confirmBuyOrder(false),
    [confirmBuyOrder]
  );
  const onConfirmBuyOrderDecline = useCallback(
    () => confirmBuyOrder(true),
    [confirmBuyOrder]
  );
  const onConfirmPaymentAccept = useCallback(
    () => confirmPayment(false),
    [confirmPayment]
  );
  const onConfirmPaymentDecline = useCallback(
    () => confirmPayment(true),
    [confirmPayment]
  );
  const onGoToCreateWallet = useCallback(() => {
    suppressWalletInfoRestoreRef.current = true;
    holdRefExtState.current = 'create-wallet';
    prepareNewSeedphrase();
    setWalletToBeDownloadedError('');
    setWalletToBeDownloadedPassword('');
    setWalletToBeDownloadedPasswordConfirm('');
    setCreationStep(1);
    setExtstate('create-wallet');
  }, [
    prepareNewSeedphrase,
    setExtstate,
    setWalletToBeDownloadedPassword,
    setWalletToBeDownloadedPasswordConfirm,
  ]);
  const onWalletsBack = useCallback(() => {
    suppressWalletInfoRestoreRef.current = true;
    holdRefExtState.current = 'not-authenticated';
    setRawWallet(null);
    setExtstate('not-authenticated');
    logoutFunc();
  }, [setExtstate, logoutFunc]);
  const onAuthenticationFormBack = useCallback(() => {
    suppressWalletInfoRestoreRef.current = true;
    holdRefExtState.current = 'not-authenticated';
    clearLastAuthenticatedWalletAddress();
    setRawWallet(null);
    setUnlockInitialPasswordFallback(false);
    setExtstate('not-authenticated');
    setAuthenticatePassword('');
    logoutFunc();
  }, [setExtstate, logoutFunc]);
  const onCreateWalletReturnBack = useCallback(() => {
    if (creationStep === 2) {
      setCreationStep(1);
      setWalletToBeDownloadedPasswordConfirm('');
      setWalletToBeDownloadedPassword('');
      return;
    }
    suppressWalletInfoRestoreRef.current = true;
    holdRefExtState.current = 'not-authenticated';
    setExtstate('not-authenticated');
    setShowSeed(false);
    setCreationStep(1);
    setWalletToBeDownloadedPasswordConfirm('');
    setWalletToBeDownloadedPassword('');
    setWalletToBeDownloadedError('');
    generatorRef.current = null;
  }, [
    creationStep,
    setExtstate,
    setWalletToBeDownloadedPasswordConfirm,
    setWalletToBeDownloadedPassword,
  ]);
  const onShowSeed = useCallback(() => setShowSeed(true), []);
  const onHideSeed = useCallback(() => setShowSeed(false), []);
  const onCreationStepNext = useCallback(() => {
    ensureGeneratedSeedphrase();
    setWalletToBeDownloadedError('');
    setCreationStep(2);
  }, [ensureGeneratedSeedphrase]);

  const isPublicNodeReachable = useCallback(async () => {
    try {
      const response = await fetch(
        `${HTTPS_EXT_NODE_QORTAL_LINK}/admin/status`
      );
      return response.ok;
    } catch (error) {
      return false;
    }
  }, []);

  const isLocalCoreReadyForHub = useCallback(async () => {
    try {
      const response = await fetch(`${HTTP_LOCALHOST_12391}/admin/status`);
      if (!response.ok) return false;

      const status = await response.json();
      const syncPercent = Number(status?.syncPercent);
      return (
        Number.isFinite(syncPercent) &&
        syncPercent >= LOCAL_CORE_READY_SYNC_PERCENT
      );
    } catch (error) {
      return false;
    }
  }, []);

  const prepareNodeForHubEntry = useCallback(async () => {
    const selectedUrl = selectedNode?.url || HTTPS_EXT_NODE_QORTAL_LINK;
    const usingDefaultPublic = selectedUrl === HTTPS_EXT_NODE_QORTAL_LINK;
    const blockedEntry = {
      canEnter: false,
      shouldOpenCoreSetupAfterEntry: false,
    };
    // GO has no Core to set up: a node it cannot reach does not keep the new
    // account out (as with an unlock).
    const enterWithoutNode = {
      canEnter: true,
      shouldOpenCoreSetupAfterEntry: false,
    };
    const goApp = isGoApp();

    if (usingDefaultPublic) {
      if (!(await isPublicNodeReachable())) {
        if (goApp) return enterWithoutNode;
        setPublicNodeUnavailable(true);
        setOpenCoreSetup(true);
        return blockedEntry;
      }

      setPublicNodeUnavailable(false);
      return {
        canEnter: true,
        shouldOpenCoreSetupAfterEntry: true,
      };
    }

    if (isLocalNodeUrl(selectedUrl) && !(await isLocalCoreReadyForHub())) {
      if (await isPublicNodeReachable()) {
        setPublicNodeUnavailable(false);
        await handleSaveNodeInfo({
          url: HTTPS_EXT_NODE_QORTAL_LINK,
          apikey: '',
        });
        return {
          canEnter: true,
          shouldOpenCoreSetupAfterEntry: true,
        };
      }

      if (goApp) return enterWithoutNode;
      setPublicNodeUnavailable(true);
      setOpenCoreSetup(true);
      return blockedEntry;
    }

    setPublicNodeUnavailable(false);
    return {
      canEnter: true,
      shouldOpenCoreSetupAfterEntry: false,
    };
  }, [
    handleSaveNodeInfo,
    isLocalCoreReadyForHub,
    isPublicNodeReachable,
    selectedNode?.url,
    setOpenCoreSetup,
    setPublicNodeUnavailable,
  ]);

  const onBackupAccountConfirm = useCallback(async () => {
    return saveFileToDiskFunc();
  }, [saveFileToDiskFunc]);

  const onEnterHubAfterCreate = useCallback(async () => {
    const entryPreparation = await prepareNodeForHubEntry();
    if (!entryPreparation.canEnter) return;

    returnToMain();

    if (window?.coreSetup && entryPreparation.shouldOpenCoreSetupAfterEntry) {
      window.setTimeout(() => {
        setOpenCoreSetup(true);
      }, 650);
    }
  }, [prepareNodeForHubEntry, returnToMain, setOpenCoreSetup]);
  const onCountdownComplete = useCallback(() => {
    window.close();
  }, []);
  const onTransferSuccessRequestClose = useCallback(() => window.close(), []);
  const onBuyOrderSubmittedClose = useCallback(() => window.close(), []);
  const onOkQortalRequestExtensionAccept = useCallback(
    (decision: ApprovalDecision) => {
      // Only the request that was on screen, and only once ticked when it
      // asks for the tick (GO-28).
      if (
        !isApprovalAcceptable(
          messageQortalRequestExtension,
          requestIdQortalRequestExtension,
          decision
        )
      ) {
        return;
      }
      okQortalRequestExtension(
        requestIdQortalRequestExtension,
        acceptedPermissionResult(messageQortalRequestExtension, decision)
      );
    },
    [
      messageQortalRequestExtension,
      requestIdQortalRequestExtension,
      okQortalRequestExtension,
    ]
  );
  // Declines every request from the app on screen, and that app's new
  // requests for a short while, so a Q-App that keeps asking cannot hold the
  // dialog open (GO-28).
  const onDeclineAllQortalRequestExtension = useCallback(() => {
    const groupKey = groupKeyQortalRequestExtension;
    if (groupKey === null) return;
    approvalMuteListRef.current.mute(
      groupKey,
      Date.now() + DECLINE_ALL_MUTE_MS
    );
    cancelWhereQortalRequestExtension(
      (request) => request.groupKey === groupKey
    );
  }, [groupKeyQortalRequestExtension, cancelWhereQortalRequestExtension]);
  // GO's own payment / publish confirmation answers only the request on
  // screen, so a late tap cannot answer the next one.
  const onAcceptPaymentPublish = useCallback(() => {
    if (paymentPublish.requestId === null) return;
    paymentPublish.okRequest(paymentPublish.requestId, undefined);
  }, [paymentPublish]);
  const onCancelPaymentPublish = useCallback(() => {
    if (paymentPublish.requestId === null) return;
    paymentPublish.cancelRequest(paymentPublish.requestId);
  }, [paymentPublish]);
  const onOpenCoreSetup = useCallback(
    () => setOpenCoreSetup(true),
    [setOpenCoreSetup]
  );
  const isElectron =
    typeof window !== 'undefined' &&
    typeof (
      window as Window & { electronAPI?: { windowMinimize?: () => unknown } }
    ).electronAPI?.windowMinimize === 'function';
  const shouldReduceAuthTransition =
    typeof window !== 'undefined' &&
    (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      window.localStorage.getItem('hub_ui_animations_enabled') === 'false');

  // Immersive mode (GO phones): the bars slide away so an open Q-App or
  // website gets the whole screen. Home, Chat, the Q-Apps library and the
  // full-screen panels keep the normal layout.
  const immersiveMode = useAtomValue(immersiveModeAtom);
  // A Q-App or website frame is what is on screen (not the library).
  const qappFrameOnScreen = useAtomValue(mobileQappFrameShowingAtom);
  // A Q-App asked for full screen (SET_FULL_SCREEN) for its viewer.
  const qappFullScreenTab = useAtomValue(qappFullScreenTabAtom);
  const immersiveEdgeColor = useAtomValue(immersiveEdgeColorAtom);
  const mobileFullscreenComposerActive = useAtomValue(
    mobileFullscreenComposerActiveAtom
  );
  // GO short screens: while typing in a chat the top bar and status bar step
  // aside, the way portrait drops the tab bar for the keyboard.
  const collapseTopBarForTyping = shouldCollapseForTyping({
    goShort,
    desktopViewMode,
    keyboardInset,
    composerFocused: chatComposerFocused,
    emojiPanelOpen: showEmojiPanel,
    appCovered: lockScreenActive || Boolean(globalRuntimeFault),
  });
  const immersive = useImmersiveBars({
    mode: immersiveMode,
    eligible:
      isMobile &&
      isAuthenticated &&
      isMainWindow &&
      !lockScreenActive &&
      !globalRuntimeFault &&
      isImmersiveSurface(desktopViewMode) &&
      // The Q-Apps library keeps its bars; only an open app goes full screen.
      qappFrameOnScreen &&
      !mobileChatComposeActive &&
      !mobileGroupPanelOpen &&
      !mobileFullscreenComposerActive,
    surfaceKey: desktopViewMode,
    holdOpen: tabsGridOpen,
    forceHidden: Boolean(qappFullScreenTab),
    // With immersive mode on, the whole Apps section (the library too, which
    // keeps its bars) goes without the phone's status bar.
    // Typing on a GO short screen hides it too (collapseTopBarForTyping).
    hideStatusBar:
      (immersiveMode !== 'off' &&
        isMobile &&
        isAuthenticated &&
        isMainWindow &&
        !lockScreenActive &&
        !globalRuntimeFault &&
        isImmersiveSurface(desktopViewMode)) ||
      collapseTopBarForTyping,
  });
  // Immersive mode: the top bar floats see-through on the page's colour and
  // draws its controls for it (a light page gets a light bar even in the
  // dark theme). Not over the Tabs grid, which has GO's own background.
  const immersiveBarTheme = useImmersiveBarTheme(
    immersiveEdgeColor,
    theme.palette.mode,
    immersive.active && !tabsGridOpen
  );

  // Pulling down from the top of Home, the Q-Apps library or the chat lists
  // brings the Tabs window down with the finger (see tabsPull).
  const [tabsPulling, setTabsPulling] = useState(false);
  useTabsPullDown({
    enabled: isMobile && isAuthenticated && isMainWindow,
    canStart:
      !tabsGridOpen &&
      !lockScreenActive &&
      !globalRuntimeFault &&
      !showEmojiPanel &&
      !mobileGroupPanelOpen,
    // Apps only shows a list (the library) with no Q-App on screen; open
    // chats are marked to keep their own gestures.
    sections: qappFrameOnScreen
      ? ['widgets', 'home', 'chat']
      : ['widgets', 'home', 'apps', 'chat'],
    onPullStart: () => {
      // The tab cards' pictures: the page on screen, before the panel
      // covers it (as the Tabs button does).
      void captureVisibleTabSnapshot();
      setTabsPulling(true);
      setTabsGridOpen(true);
    },
    onPullEnd: (open) => {
      setTabsPulling(false);
      if (!open) setTabsGridOpen(false);
    },
    reducedMotion: immersiveMotionReduced(),
  });
  const mobileTabBarSlotShown =
    showMobileBottomBar &&
    !mobileChatComposeActive &&
    !mobileGroupPanelOpen &&
    !tabBarHiddenByKeyboard;
  // The tab bar is three floating round buttons on a see-through bar. With
  // immersive mode on, GO's own screens (Home, Chat, the Apps library) scroll
  // on behind it and pad their lists by --go-tab-bar-space. With it off, and
  // always for a Q-App or website frame (its own bottom menu would sit under
  // the buttons), the content ends above them and the buttons sit on the
  // page colour.
  const qappFrameShowing =
    (desktopViewMode === 'apps' || desktopViewMode === 'dev') &&
    qappFrameOnScreen;
  const contentBehindTabBar =
    immersiveMode !== 'off' &&
    isMobile &&
    isAuthenticated &&
    isMainWindow &&
    mobileTabBarSlotShown &&
    !showEmojiPanel &&
    !qappFrameShowing;
  useEffect(() => {
    document.documentElement.style.setProperty(
      GO_TAB_BAR_SPACE_VAR,
      contentBehindTabBar
        ? `calc(${MOBILE_TAB_BAR_HEIGHT_PX}px + ${SAFE_AREA_BOTTOM})`
        : '0px'
    );
  }, [contentBehindTabBar]);

  const mainContent = (
    <>
      <PdfViewer />
      <ReticulumFileViewer />
      <QdnTransfersOverlay />
      <QdnPublishWindow
        enabled={isAuthenticated && isMainWindow && !lockScreenActive}
      />
      {isGoApp() ? (
        <PublicNodeDownWindow
          enabled={isAuthenticated && isMainWindow && !lockScreenActive}
        />
      ) : null}

      <QORTAL_APP_CONTEXT.Provider value={contextValue as AppContextInterface}>
        <ElectronPersistentStorageHydration />
        <CoreSetup />
        {extState === 'not-authenticated' && (
          <NotAuthenticated
            onWalletUnlockStart={setAuthUnlockTransition}
            onBiometricWalletUnlock={handleBiometricWalletUnlock}
            onWalletPasswordFallbackUnlock={handleWalletPasswordFallbackUnlock}
            setExtstate={setExtstate}
            setRawWallet={setRawWallet}
            rawWallet={rawWallet}
          />
        )}

        {extState === 'authenticated' && isMainWindow && (
          <Suspense fallback={<Loader />}>
            <ErrorBoundary
              isRecoverable={isIgnorableRuntimeFault}
              fallback={({ error, componentStack }) => (
                <Box
                  sx={{
                    alignItems: 'flex-start',
                    backdropFilter: 'blur(18px)',
                    background:
                      theme.palette.mode === 'dark'
                        ? 'linear-gradient(180deg, rgba(18,22,29,0.92) 0%, rgba(11,14,20,0.96) 100%)'
                        : 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(244,247,252,0.96) 100%)',
                    border: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(20,24,32,0.08)'}`,
                    borderRadius: '24px',
                    boxShadow:
                      theme.palette.mode === 'dark'
                        ? '0 24px 48px rgba(0,0,0,0.3)'
                        : '0 18px 36px rgba(15,20,30,0.12)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    m: '24px',
                    maxWidth: '560px',
                    p: '22px',
                  }}
                >
                  <Typography sx={{ fontSize: '1.05rem', fontWeight: 800 }}>
                    GO runtime error
                  </Typography>
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.85rem',
                      lineHeight: 1.55,
                    }}
                  >
                    The authenticated shell crashed during render.
                  </Typography>
                  {error?.message ? (
                    <Typography
                      sx={{
                        color: 'rgba(246,248,252,0.9)',
                        fontFamily:
                          'ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace',
                        fontSize: '0.78rem',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {error.message}
                    </Typography>
                  ) : null}
                  {componentStack ? (
                    <Typography
                      sx={{
                        color: 'rgba(214,221,233,0.55)',
                        fontFamily:
                          'ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace',
                        fontSize: '0.7rem',
                        lineHeight: 1.45,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {componentStack.trim()}
                    </Typography>
                  ) : null}
                </Box>
              )}
            >
              <GroupCallProvider>
                <VoiceCallProvider>
                  <CallSwitchGuardProvider>
                    <Box
                      sx={{
                        animation: shouldReduceAuthTransition
                          ? 'none'
                          : 'dashboardAfterAuthIn 720ms cubic-bezier(0.4, 0, 0.2, 1) both',
                        height: '100%',
                        width: '100%',
                        '@keyframes dashboardAfterAuthIn': {
                          from: {
                            opacity: 0,
                            transform: 'translateY(8px)',
                          },
                          to: {
                            opacity: 1,
                            transform: 'translateY(0)',
                          },
                        },
                      }}
                    >
                      <PerfProfiler id="shell">
                        <LazyAuthenticatedShell
                          balance={balance}
                          desktopViewMode={desktopViewMode}
                          isMain={true}
                          logoutFunc={logoutFunc}
                          myAddress={address}
                          setDesktopViewMode={setDesktopViewMode}
                          userInfo={userInfo}
                          rawWallet={rawWallet}
                          qortBalanceLoading={qortBalanceLoading}
                          setOpenSnack={setOpenSnack}
                          setInfoSnack={setInfoSnack}
                          onRefreshBalance={getBalanceAndUserInfoFunc}
                          onOpenSendQort={onOpenSendQort}
                          onOpenRegisterName={onOpenRegisterName}
                          extState={extState}
                          isMainWindow={isMainWindow}
                          onOpenSettings={onOpenSettings}
                          onOpenDrawerLookup={onOpenDrawerLookup}
                          onOpenWalletsApp={onOpenWalletsApp}
                          getUserInfo={getUserInfo}
                          onOpenMinting={onOpenMinting}
                          onBackupWallet={onBackupWallet}
                          showTutorial={showTutorial}
                        />
                      </PerfProfiler>
                    </Box>
                    {reticulumEnabled && (
                      <>
                        <QortalGroupVoiceCallNavWidget />
                        <DirectVoiceCallNavWidget />
                        {isGoCallUi() ? (
                          // GO app: one phone call UI (full screen, strip,
                          // ring screen that also shows over the lock).
                          <MobileCallRoot
                            isAppLocked={lockScreenActive}
                            onHomeSection={desktopViewMode === 'home'}
                          />
                        ) : (
                          <>
                            <MobileVoiceCallBar />
                            <QortalGroupVoiceCallStage />
                            <DirectVoiceCallGlobalOverlay
                              isAppLocked={isAppLocked}
                            />
                          </>
                        )}
                        <DirectVoiceScreenShareOverlay
                          isAppLocked={isAppLocked}
                        />
                        <MobileAlertNotificationBridge />
                      </>
                    )}
                  </CallSwitchGuardProvider>
                </VoiceCallProvider>
              </GroupCallProvider>
            </ErrorBoundary>
          </Suspense>
        )}

        {isMainWindow && (
          <BackupWalletModal
            open={isBackupWalletModalOpen && !lockScreenActive}
            onClose={closeBackupWalletModal}
            rawWallet={rawWallet}
          />
        )}

        <AnimatePresence>
          {isOpenSendQort && walletUnlocked && (
            <SendQortOverlay
              balance={balance}
              originRect={sendQortOriginRect}
              targetRect={sendQortTargetRect}
              paymentTo={paymentTo}
              paymentAmount={paymentAmount}
              onReturn={closeSendQortOverlay}
              onSuccess={onSendQortSent}
              show={show}
            />
          )}
          {isOpenReceiveQort && walletUnlocked && (
            <ReceiveQortOverlay
              address={receiveQortAddress || address || ''}
              originRect={receiveQortOriginRect}
              targetRect={receiveQortTargetRect}
              onReturn={() => {
                setIsOpenReceiveQort(false);
                setReceiveQortOriginRect(null);
                setReceiveQortTargetRect(null);
                setReceiveQortAddress('');
              }}
            />
          )}
        </AnimatePresence>

        {isShowQortalRequest && !isMainWindow && (
          <QortalRequestScreen
            message={messageQortalRequest}
            sendPaymentError={sendPaymentError}
            onAccept={onOkQortalRequestAccepted}
            onDecline={onCancelQortalRequest}
            onCheckboxChange={(checked) => {
              qortalRequestCheckbox1Ref.current = checked;
            }}
            checkboxDefaultChecked={
              (messageQortalRequest as { checkbox1?: { value?: boolean } })
                ?.checkbox1?.value
            }
          />
        )}

        {extState === 'web-app-request-buy-order' && !isMainWindow && (
          <BuyOrderRequestScreen
            hostname={requestBuyOrder?.hostname}
            crosschainAtInfo={requestBuyOrder?.crosschainAtInfo}
            sendPaymentError={sendPaymentError}
            roundUpToDecimals={roundUpToDecimals}
            onAccept={onConfirmBuyOrderAccept}
            onDecline={onConfirmBuyOrderDecline}
          />
        )}
        {extState === 'web-app-request-payment' && !isMainWindow && (
          <PaymentRequestScreen
            hostname={requestBuyOrder?.hostname}
            count={requestBuyOrder?.crosschainAtInfo?.length || 0}
            description={sendqortState?.description}
            amount={sendqortState?.amount}
            sendPaymentError={sendPaymentError}
            onAccept={onConfirmPaymentAccept}
            onDecline={onConfirmPaymentDecline}
          />
        )}

        {extState === 'web-app-request-connection' && !isMainWindow && (
          <ConnectionRequestScreen
            hostname={requestConnection?.hostname}
            onAccept={onConnectionRequestAccept}
            onDecline={onConnectionRequestDecline}
          />
        )}

        {extState === 'web-app-request-authentication' && !isMainWindow && (
          <WebAppAuthRequestScreen
            hostname={requestConnection?.hostname}
            getRootProps={getRootProps}
            getInputProps={getInputProps}
            onCreateAccount={onGoToCreateWallet}
          />
        )}

        {extState === 'wallets' && (
          <WalletsView
            onBack={onWalletsBack}
            setRawWallet={setRawWallet}
            setExtState={setExtstate}
            rawWallet={rawWallet}
          />
        )}

        {rawWallet && extState === 'wallet-dropped' && (
          <AuthenticationForm
            rawWallet={rawWallet}
            selectedNode={selectedNode}
            unlockTransition={authUnlockTransition}
            initialPasswordFallback={unlockInitialPasswordFallback}
            walletToBeDecryptedError={walletToBeDecryptedError}
            onBack={onAuthenticationFormBack}
            onAuthenticate={authenticateWallet}
            onUnlockTransitionComplete={() => setAuthUnlockTransition(null)}
            onWalletUpdated={(wallet) => setRawWallet(wallet)}
            onWalletRemoved={onAuthenticationFormBack}
          />
        )}
        {extState === 'download-wallet' && (
          <DownloadWallet
            returnToMain={returnToMain}
            setIsLoading={setIsLoading}
            rawWallet={rawWallet}
            setWalletToBeDownloaded={setWalletToBeDownloaded}
            walletToBeDownloaded={walletToBeDownloaded}
          />
        )}

        {extState === 'create-wallet' && (
          <CreateWalletView
            creationStep={creationStep}
            walletToBeDownloaded={walletToBeDownloaded}
            walletToBeDownloadedPassword={walletToBeDownloadedPassword}
            walletToBeDownloadedPasswordConfirm={
              walletToBeDownloadedPasswordConfirm
            }
            walletToBeDownloadedError={walletToBeDownloadedError}
            showSeed={showSeed}
            storeAccount={storeAccount}
            generatorRef={generatorRef}
            confirmRef={confirmRef}
            onReturnBack={onCreateWalletReturnBack}
            onShowSeed={onShowSeed}
            onHideSeed={onHideSeed}
            onCreationStepNext={onCreationStepNext}
            setWalletToBeDownloadedPassword={setWalletToBeDownloadedPassword}
            setWalletToBeDownloadedPasswordConfirm={
              setWalletToBeDownloadedPasswordConfirm
            }
            setStoredAccount={setStoredAccount}
            onCreateAccount={createAccountFunc}
            onBackupAccountConfirm={onBackupAccountConfirm}
            onEnterHub={onEnterHubAfterCreate}
            exportSeedphrase={exportSeedphrase}
          />
        )}

        {isOpenSendQortSuccess && walletUnlocked && (
          <SuccessOverlay
            messageKey="message.success.transfer"
            buttonLabelKey="action.continue"
            onAction={onTransferSuccessContinue}
            fullPage
          />
        )}

        {extState === 'transfer-success-request' && (
          <SuccessScreen
            messageKey="message.success.transfer"
            buttonLabelKey="action.continue"
            onAction={onTransferSuccessRequestClose}
          />
        )}

        {extState === 'buy-order-submitted' && (
          <SuccessScreen
            messageKey="message.success.order_submitted"
            buttonLabelKey="action.close"
            onAction={onBuyOrderSubmittedClose}
          />
        )}

        {countdown && (
          <CountdownOverlay
            countdown={countdown}
            onComplete={onCountdownComplete}
          />
        )}

        {isLoading && <Loader />}
        <PaymentPublishDialog
          open={isShow && !lockScreenActive}
          requestId={paymentPublish.requestId}
          pendingCount={paymentPublish.pendingCount}
          message={message}
          onAccept={onAcceptPaymentPublish}
          onCancel={onCancelPaymentPublish}
        />
        <InfoDialog
          open={isShowInfo && !lockScreenActive}
          message={messageInfo.message}
          onClose={() => onOkInfo(undefined)}
        />
        <UnsavedChangesDialog
          open={isShowUnsavedChanges && !lockScreenActive}
          message={messageUnsavedChanges.message}
          onCancel={onCancelUnsavedChanges}
          onConfirm={() => onOkUnsavedChanges(undefined)}
        />
        {isMainWindow && <NotificationPermissionSlideDown />}
        {isShowQortalRequestExtension && isMainWindow && !lockScreenActive && (
          // A request the dialog cannot draw is declined instead of taking
          // GO down to the crash screen (N-09). The dialog declines a single
          // request it cannot draw itself; reaching this boundary declines
          // every queued one, so the next request gets a fresh boundary.
          <ErrorBoundary
            fallback={null}
            onCatch={() => qortalRequestExtension.cancelAll()}
          >
            <QortalRequestExtensionDialog
              open={isShowQortalRequestExtension}
              requestId={requestIdQortalRequestExtension}
              pendingCount={pendingQortalRequestExtension}
              sameAppPendingCount={sameAppPendingQortalRequestExtension}
              message={messageQortalRequestExtension}
              sendPaymentError={sendPaymentError}
              onAccept={onOkQortalRequestExtensionAccept}
              onCancel={cancelQortalRequestExtension}
              onDeclineAll={onDeclineAllQortalRequestExtension}
              onCountdownComplete={cancelQortalRequestExtension}
            />
          </ErrorBoundary>
        )}

        {isSettingsOpen && !lockScreenActive && (
          <Settings
            open={isSettingsOpen}
            setOpen={setIsSettingsOpen}
            rawWallet={rawWallet}
          />
        )}

        <QortinoNotificationHost
          open={openSnack}
          setOpen={setOpenSnack}
          info={infoSnack}
          setInfo={setInfoSnack}
        />

        <SavedFileActionsSheet />

        <AppUpdateWindow />

        {/* Background player: notification + lock screen media controls,
            opened from Settings → System or the notification's gear. */}
        {isGoApp() && (
          <BackgroundPlayerHost ready={isAuthenticated && !isAppLocked} />
        )}

        {/* Qortal Card (testing): opened from the avatar menu. */}
        {isGoApp() && isAuthenticated && address && (
          <QortalCardWindow address={address} />
        )}

        <UserLookup
          isOpenDrawerLookup={isOpenDrawerLookup}
          setIsOpenDrawerLookup={setIsOpenDrawerLookup}
        />

        <RegisterName
          balance={balance}
          show={show}
          userInfo={userInfo}
          setOpenSnack={setOpenSnack}
          setInfoSnack={
            setInfoSnack as (
              info: { type: string; message: string } | null
            ) => void
          }
        />
        <BuyQortInformation balance={balance} />
      </QORTAL_APP_CONTEXT.Provider>

      {isOpenMinting && (
        <Minting
          setIsOpenMinting={setIsOpenMinting}
          myAddress={address}
          show={show}
        />
      )}

      <MintingPublicNodeDialog
        open={mintingPublicNodeDialogOpen}
        onClose={() => setMintingPublicNodeDialogOpen(false)}
      />

      {!isAuthenticated && (
        <NotAuthenticatedFooter
          showCoreSetup
          onOpenCoreSetup={onOpenCoreSetup}
        />
      )}
    </>
  );

  const titleBarRightNav: CustomTitleBarRightNavProps | null =
    extState === 'authenticated' && isMainWindow
      ? {
          desktopViewMode,
          extState,
          isMainWindow,
          userInfo,
          onOpenSettings,
          onOpenDrawerLookup,
          onOpenWalletsApp,
          onLock: lockApp,
          onLogout: logoutFunc,
          getUserInfo,
          onOpenMinting,
          onBackupWallet,
        }
      : null;

  return (
    <AppContainer
      sx={{
        // dvh tracks the dynamic viewport so the shell re-fits on rotation and
        // when mobile browser/system chrome changes height.
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        ['--electron-title-bar-height' as string]: isMobile
          ? '0px'
          : `${CUSTOM_TITLE_BAR_HEIGHT}px`,
      }}
    >
      {!isMobile && <CustomTitleBar rightNav={titleBarRightNav} />}
      {!isMobile && extState === 'authenticated' && isMainWindow && (
        <GlobalQortalNavBar
          desktopViewMode={desktopViewMode}
          utilityNav={titleBarRightNav}
        />
      )}
      {isMobile && extState === 'authenticated' && isMainWindow && (
        <Box
          ref={immersive.topBarRef}
          // Over the Tabs grid while it is open, as the bar always is; see-
          // through on the page's colour (its controls drawn for that
          // colour, immersiveBarTheme). On Home, in Chat and on the Q-Apps
          // library the bar takes the page's own background, so it blends
          // into the page; all three share the plain page colour.
          sx={immersiveTopBarSx(immersive, {
            raisedZIndex: tabsGridOpen ? 2001 : undefined,
            transparent: true,
            pageBackground:
              desktopViewMode === 'home' ||
              desktopViewMode === 'widgets' ||
              desktopViewMode === 'chat' ||
              !qappFrameOnScreen
                ? theme.palette.background.default
                : undefined,
          })}
        >
          <MobileTopBar
            barTheme={immersiveBarTheme}
            floating={immersive.active && !tabsGridOpen}
            userInfo={userInfo}
            onOpenWalletsApp={onOpenWalletsApp}
            onOpenSendQort={onOpenSendQort}
            onOpenDrawerLookup={onOpenDrawerLookup}
            onOpenMinting={onOpenMinting}
            onOpenSettings={onOpenSettings}
            onLogout={logoutFunc}
            onOpenTabs={toggleTabsGrid}
            tabsOverlayOpen={tabsGridOpen}
            desktopViewMode={desktopViewMode}
            setDesktopViewMode={setDesktopViewMode}
            collapsed={collapseTopBarForTyping}
          />
          {/* GO: a minimized call as a bar in the top bar's flow (it pushes
              the page down instead of covering headers). Only while the top
              bar is drawn: in immersive mode it floats over the Q-App, and a
              full-screen group panel or composer hides it (the slot would
              sit under the status bar), so the call floats as a pill. */}
          {isGoCallUi() &&
          !immersive.active &&
          !mobileGroupPanelOpen &&
          !mobileFullscreenComposerActive ? (
            <MobileCallStripSlot />
          ) : null}
        </Box>
      )}
      {extState === 'authenticated' &&
        isMainWindow &&
        address &&
        isShareReceiverAvailable() && <ChatShareHost account={address} />}
      {isMobile && extState === 'authenticated' && isMainWindow && (
        <>
          <MobileTabsOverlay
            open={tabsGridOpen}
            pulling={tabsPulling}
            onClose={() => setTabsGridOpen(false)}
          />
          <TabSnapshotScheduler paused={tabsGridOpen} />
        </>
      )}

      <Box
        ref={immersive.contentRef}
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          ...(isMobile &&
            extState === 'authenticated' &&
            isMainWindow && {
              alignItems: 'stretch',
              pb: showEmojiPanel
                ? `calc(${emojiPanelReservePx}px + ${SAFE_AREA_BOTTOM})`
                : contentBehindTabBar
                  ? 0
                  : !mobileTabBarSlotShown ||
                      (immersive.active && !immersive.layoutShown)
                    ? SAFE_AREA_BOTTOM
                    : `calc(${MOBILE_TAB_BAR_HEIGHT_PX}px + ${SAFE_AREA_BOTTOM})`,
              // Immersive: the top bar floats, so the content makes room for
              // it only while it is out, and clears the camera strip otherwise.
              ...(immersive.active && { pt: immersiveContentTop(immersive) }),
            }),
          ...(!isMobile || extState !== 'authenticated' || !isMainWindow
            ? { alignItems: 'center' }
            : {}),
        }}
      >
        {globalRuntimeFault && extState === 'authenticated' && isMainWindow ? (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'center',
              p: 3,
              width: '100%',
            }}
          >
            <Box
              sx={{
                alignItems: 'flex-start',
                backdropFilter: 'blur(18px)',
                background:
                  theme.palette.mode === 'dark'
                    ? 'linear-gradient(180deg, rgba(18,22,29,0.92) 0%, rgba(11,14,20,0.96) 100%)'
                    : 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(244,247,252,0.96) 100%)',
                border: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(20,24,32,0.08)'}`,
                borderRadius: '24px',
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? '0 24px 48px rgba(0,0,0,0.3)'
                    : '0 18px 36px rgba(15,20,30,0.12)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                maxWidth: '620px',
                p: '22px',
                width: '100%',
              }}
            >
              <Typography sx={{ fontSize: '1.05rem', fontWeight: 800 }}>
                GO runtime error
              </Typography>
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '0.85rem',
                  lineHeight: 1.55,
                }}
              >
                The authenticated app hit a runtime fault after login. We are
                surfacing it here instead of leaving a white screen.
              </Typography>
              <Box
                sx={{
                  background:
                    theme.palette.mode === 'dark'
                      ? 'rgba(255,255,255,0.03)'
                      : 'rgba(24,32,44,0.04)',
                  border: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(24,32,44,0.08)'}`,
                  borderRadius: '16px',
                  px: 1.5,
                  py: 1.2,
                }}
              >
                <Typography
                  sx={{ fontSize: '0.78rem', fontWeight: 700, mb: 0.45 }}
                >
                  {globalRuntimeFault.source}
                </Typography>
                <Typography
                  sx={{
                    color: theme.palette.text.primary,
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {globalRuntimeFault.message}
                </Typography>
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  gap: '10px',
                  justifyContent: 'flex-end',
                  mt: '4px',
                  width: '100%',
                }}
              >
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setGlobalRuntimeFault(null)}
                >
                  Dismiss
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => window.location.reload()}
                >
                  Reload app
                </Button>
              </Box>
            </Box>
          </Box>
        ) : (
          mainContent
        )}
      </Box>
      {mobileTabBarSlotShown &&
        extState === 'authenticated' &&
        isMainWindow &&
        !showEmojiPanel && (
          <MobileTabBar
            desktopViewMode={desktopViewMode}
            setDesktopViewMode={setDesktopViewMode}
            immersive={immersiveTabBarProps(immersive)}
            floating
            stripTakesTouches={!contentBehindTabBar}
            covered={mobileTabBarCovered}
          />
        )}
      {immersive.active && (
        <ImmersiveEdges
          barsShown={immersive.barsShown}
          topBarHeight={immersive.topBarHeight}
          tabBarSlot={
            mobileTabBarSlotShown && !showEmojiPanel && !contentBehindTabBar
          }
          showMs={immersive.showMs}
          hideMs={immersive.hideMs}
        />
      )}
      {immersive.active && (
        <ImmersivePill
          // Manual only: Auto brings the bars back with a downward swipe.
          visible={
            immersiveMode === 'manual' &&
            !immersive.barsShown &&
            !immersive.forced &&
            !showEmojiPanel &&
            keyboardInset === 0
          }
          onReveal={immersive.reveal}
          pillRef={immersive.pillRef}
        />
      )}
      {showEmojiPanel && (
        <MobileEmojiPanel
          heightPx={emojiPanelHeightPx}
          keyboardInsetPx={keyboardInset}
          searchLifted={emojiSearchLifted}
        />
      )}
      {/* Native: independent of width, so rotation, tablets and fullscreen
          video do not stop the status service. Web keeps the width gate. */}
      {(isCapacitor() || isMobile) &&
        extState === 'authenticated' &&
        isMainWindow && <MobileBackgroundSetup enabled />}
      {lockScreenActive && (
        <AppLockLayer
          accountLabel={userInfo?.name || address || null}
          walletAddress={rawWallet?.address0 || address || null}
          onUnlock={unlockApp}
        />
      )}
    </AppContainer>
  );
}

export default App;
