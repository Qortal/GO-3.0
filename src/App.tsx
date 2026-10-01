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
import { crypto, walletVersion } from './constants/decryptWallet';
import PhraseWallet from './utils/generateWallet/phrase-wallet';
import { AppContainer } from './styles/App-styles.ts';
import { Loader } from './components/Loader';
import ErrorBoundary from './common/ErrorBoundary';
import { AuthenticationForm } from './components/AuthenticationForm';
import {
  BuyOrderRequestScreen,
  AuthenticatedLockScreen,
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
import { MobileTabsOverlay } from './components/Mobile/MobileTabsOverlay';
import { MobileBackgroundSetup } from './components/Mobile/MobileBackgroundSetup';
import { MobileIncomingCallBridge } from './components/Mobile/MobileIncomingCallBridge';
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
import { AppUpdateWindow } from './components/AppUpdate/AppUpdateWindow';
import { useAppUpdateWatcher } from './appUpdate/useAppUpdateWatcher';
import { getWallets, storeWallets } from './background/background.ts';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from './utils/events';
import {
  getPendingPaymentRequest,
  clearPendingPaymentRequest,
  getPendingJoinGroupRequest,
  clearPendingJoinGroupRequest,
} from './utils/paymentLink';
import { useAndroidBack, BACK_PRIORITY } from './utils/androidBack';
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
import { isCapacitor } from './utils/platform';
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
  const [paymentTo, setPaymentTo] = useState<string>('');
  const [paymentAmount, setPaymentAmount] = useState<number | undefined>(
    undefined
  );
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
  const isLandscape = useMediaQuery('(orientation: landscape)');
  const showMobileBottomBar = isMobile && !isLandscape;
  const mobileChatComposeActive = useAtomValue(mobileChatComposeActiveAtom);
  // Threads / Qortal Land / Members fill the screen, so the tab bar steps aside.
  const mobileGroupPanelOpen = useAtomValue(mobileGroupPanelOpenAtom);
  const [tabsGridOpen, setTabsGridOpen] = useState(false);
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
    confirmRequestRead,
    setConfirmRequestRead,
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
  const onCancelQortalRequestExtension = qortalRequestExtension.onCancel;
  const onOkQortalRequestExtension = qortalRequestExtension.onOk;
  const showQortalRequestExtension = qortalRequestExtension.show;
  const isShowQortalRequestExtension = qortalRequestExtension.isShow;
  const messageQortalRequestExtension = qortalRequestExtension.message;

  const confirmRef = useRef(null);

  const setIsRunningPublicNode = useSetAtom(isRunningPublicNodeAtom);

  const [infoSnack, setInfoSnack] = useAtom(infoSnackGlobalAtom);
  const [openSnack, setOpenSnack] = useAtom(openSnackGlobalAtom);
  const [isOpenDrawerLookup, setIsOpenDrawerLookup] = useState(false);
  const [isOpenSendQort, setIsOpenSendQort] = useState(false);
  const [isOpenReceiveQort, setIsOpenReceiveQort] = useState(false);
  const [isOpenSendQortSuccess, setIsOpenSendQortSuccess] = useState(false);
  const [sendQortOriginRect, setSendQortOriginRect] =
    useState<SendQortOriginRect>(null);
  const [sendQortTargetRect, setSendQortTargetRect] =
    useState<SendQortOriginRect>(null);
  const [receiveQortOriginRect, setReceiveQortOriginRect] =
    useState<SendQortOriginRect>(null);
  const [receiveQortTargetRect, setReceiveQortTargetRect] =
    useState<SendQortOriginRect>(null);
  const [receiveQortAddress, setReceiveQortAddress] = useState('');
  const [selectedNode, setSelectedNode] = useAtom(selectedNodeInfoAtom);
  const {
    isNodeValid,
    authenticate,
    getBalanceFunc,
    handleSaveNodeInfo,
    validateApiKeyFromRegistration,
  } = useAuth();
  useBlockedAddressesLoader(extState === 'authenticated');
  const { sendOfflineBeforeLogout } = usePresence();

  const lockApp = useCallback(() => {
    if (extState !== 'authenticated' || !isMainWindow) return;
    setIsIdle(true);
    setIsAppLocked(true);
  }, [extState, setIsAppLocked, setIsIdle]);

  const unlockApp = useCallback(
    async (password: string) => {
      if (!rawWallet) throw new Error('Wallet data is unavailable');
      await decryptStoredWallet(password, structuredClone(rawWallet));
      // Clear idle before releasing the latch so the idle watcher cannot lock
      // the app again between these state updates.
      const unlockedAt = Date.now();
      writeAutoLockLastActivityAt(unlockedAt);
      setIsIdle(false);
      setIsAppLocked(false);
    },
    [rawWallet, setIsAppLocked, setIsIdle]
  );

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
  useQortalGetSaveSettings(userInfo?.name, extState === 'authenticated');
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
    const wallet2 = new PhraseWallet(res, wallet?.version || walletVersion);
    wallet = await wallet2.generateSaveWalletData(
      password,
      crypto.kdfThreads,
      () => {}
    );

    setWalletToBeDownloaded({
      wallet,
      qortAddress: rawWallet.address0,
    });
    return {
      wallet,
      qortAddress: rawWallet.address0,
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
    if (message.action === 'QORTAL_REQUEST_PERMISSION') {
      try {
        if (message?.payload?.checkbox1) {
          qortalRequestCheckbox1Ref.current =
            message?.payload?.checkbox1?.value || false;
        }
        setConfirmRequestRead(false);
        await showQortalRequestExtension(message?.payload);

        if (qortalRequestCheckbox1Ref.current) {
          event.source.postMessage(
            {
              action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
              requestId: message?.requestId,
              result: {
                accepted: true,
                checkbox1: qortalRequestCheckbox1Ref.current,
              },
            },
            event.origin
          );
          return;
        }
        event.source.postMessage(
          {
            action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
            requestId: message?.requestId,
            result: {
              accepted: true,
            },
          },
          event.origin
        );
      } catch (error) {
        event.source.postMessage(
          {
            action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
            requestId: message?.requestId,
            result: {
              accepted: false,
            },
          },
          event.origin
        );
      }
    }
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
    holdRefExtState.current = 'authenticated';
    setPaymentTo('');
    setSendPaymentError('');
    setCountdown(null);
    setWalletToBeDownloaded(null);
    setWalletToBeDownloadedPassword('');
    generatorRef.current = null;
    setShowSeed(false);
    setCreationStep(1);
    setSendQortOriginRect(null);
    setSendQortTargetRect(null);
    setReceiveQortOriginRect(null);
    setReceiveQortTargetRect(null);
    setReceiveQortAddress('');
    setExtstate('authenticated');
    setIsOpenSendQort(false);
    setIsOpenReceiveQort(false);
    setIsOpenSendQortSuccess(false);
  }, []);

  const resetAllStates = () => {
    clearWalletKdfSessionCache();
    clearWalletUnlockSession();
    suppressWalletInfoRestoreRef.current = true;
    holdRefExtState.current = 'not-authenticated';
    setExtstate('not-authenticated');
    setRawWallet(null);
    setRequestConnection(null);
    setRequestBuyOrder(null);
    setUserInfo(null);
    setBalance(null);
    setPaymentTo('');
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
    setQcallPrimaryNames({});
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
        // authenticate() fetches user info itself after the decrypt.
        const isValid = await isNodeValid({ refreshUserInfo: false });
        if (!isValid) {
          setIsLoading(false);
          return;
        }
      }
      const unlocked = await authenticate(undefined, options?.skipLocalCheck);
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

        return await authenticate(undefined, true);
      } catch {
        return false;
      }
    },
    [
      authenticate,
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

  const openPaymentInternal = (e) => {
    const directAddress = e.detail?.address;
    const name = e.detail?.name;
    const anchorRect = e.detail?.anchorRect;
    const targetRect = e.detail?.targetRect;
    setSendQortOriginRect(
      anchorRect
        ? {
            left: anchorRect.left,
            top: anchorRect.top,
            width: anchorRect.width,
            height: anchorRect.height,
          }
        : null
    );
    setSendQortTargetRect(
      targetRect
        ? {
            left: targetRect.left,
            top: targetRect.top,
            width: targetRect.width,
            height: targetRect.height,
          }
        : null
    );
    setIsOpenSendQort(true);
    setPaymentTo(name || directAddress || '');
    const amount = Number(e.detail?.amount);
    setPaymentAmount(
      Number.isFinite(amount) && amount > 0 ? amount : undefined
    );
  };

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
    subscribeToEvent('openPaymentInternal', openPaymentInternal);
    subscribeToEvent('openReceiveQortInternal', openReceiveQortInternal);

    // Replay a payment / join-group deep link that arrived before the
    // authenticated app UI was mounted (cold launch from an external scanner).
    if (address) {
      const pending = getPendingPaymentRequest();
      if (pending?.recipient) {
        clearPendingPaymentRequest();
        openPaymentInternal({
          detail: { address: pending.recipient, amount: pending.amount },
        });
      }
      const pendingJoinGroupId = getPendingJoinGroupRequest();
      if (pendingJoinGroupId) {
        clearPendingJoinGroupRequest();
        executeEvent('globalActionJoinGroup', { groupId: pendingJoinGroupId });
      }
      // Photos/videos shared from other apps via the "Quitter" share-sheet
      // target (Android). Idempotent — safe to call on every auth.
      void import('./components/Widgets/quitter/quitterShareIntake')
        .then(({ initQuitterShareIntake }) => initQuitterShareIntake())
        .catch(() => undefined);
    }

    return () => {
      unsubscribeFromEvent('openPaymentInternal', openPaymentInternal);
      unsubscribeFromEvent('openReceiveQortInternal', openReceiveQortInternal);
    };
  }, [address]);

  const onOpenSendQort = useCallback(() => {
    setSendQortOriginRect(null);
    setSendQortTargetRect(null);
    executeEvent('openSendQortInternal', {});
    setIsOpenSendQort(true);
  }, []);
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

  useEffect(() => {
    subscribeToEvent('openMintingPanel', onOpenMinting);
    subscribeToEvent('openBackupWallet', onBackupWallet);

    return () => {
      unsubscribeFromEvent('openMintingPanel', onOpenMinting);
      unsubscribeFromEvent('openBackupWallet', onBackupWallet);
    };
  }, [onBackupWallet, onOpenMinting]);

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

    if (usingDefaultPublic) {
      if (!(await isPublicNodeReachable())) {
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
  const onTransferSuccessContinue = useCallback(() => returnToMain(), []);
  const onTransferSuccessRequestClose = useCallback(() => window.close(), []);
  const onBuyOrderSubmittedClose = useCallback(() => window.close(), []);
  const onOkQortalRequestExtensionAccept = useCallback(() => {
    const ext = messageQortalRequestExtension as
      | { confirmCheckbox?: boolean }
      | null
      | undefined;
    if (ext?.confirmCheckbox && !confirmRequestRead) return;
    onOkQortalRequestExtension('accepted');
  }, [
    messageQortalRequestExtension,
    confirmRequestRead,
    onOkQortalRequestExtension,
  ]);
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

  const mainContent = (
    <>
      <PdfViewer />
      <ReticulumFileViewer />
      <QdnTransfersOverlay />

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
                    </Box>
                    {reticulumEnabled && (
                      <>
                        <QortalGroupVoiceCallNavWidget />
                        <DirectVoiceCallNavWidget />
                        <MobileVoiceCallBar />
                        <QortalGroupVoiceCallStage />
                        <DirectVoiceCallGlobalOverlay
                          isAppLocked={isAppLocked}
                        />
                        <DirectVoiceScreenShareOverlay
                          isAppLocked={isAppLocked}
                        />
                        <MobileIncomingCallBridge />
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
            open={isBackupWalletModalOpen}
            onClose={closeBackupWalletModal}
            rawWallet={rawWallet}
          />
        )}

        <AnimatePresence>
          {isOpenSendQort && isMainWindow && (
            <SendQortOverlay
              balance={balance}
              originRect={sendQortOriginRect}
              targetRect={sendQortTargetRect}
              paymentTo={paymentTo}
              paymentAmount={paymentAmount}
              onReturn={returnToMain}
              onSuccess={() => {
                setIsOpenSendQort(false);
                setSendQortOriginRect(null);
                setSendQortTargetRect(null);
                setIsOpenSendQortSuccess(true);
              }}
              show={show}
            />
          )}
          {isOpenReceiveQort && isMainWindow && (
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

        {isOpenSendQortSuccess && (
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
          open={isShow}
          message={message}
          onAccept={() => onOk(undefined)}
          onCancel={() => onCancel(undefined)}
        />
        <InfoDialog
          open={isShowInfo}
          message={messageInfo.message}
          onClose={() => onOkInfo(undefined)}
        />
        <UnsavedChangesDialog
          open={isShowUnsavedChanges}
          message={messageUnsavedChanges.message}
          onCancel={onCancelUnsavedChanges}
          onConfirm={() => onOkUnsavedChanges(undefined)}
        />
        {isMainWindow && <NotificationPermissionSlideDown />}
        {isShowQortalRequestExtension && isMainWindow && (
          <QortalRequestExtensionDialog
            open={isShowQortalRequestExtension}
            message={messageQortalRequestExtension}
            sendPaymentError={sendPaymentError}
            confirmRequestRead={confirmRequestRead}
            onConfirmRequestReadChange={setConfirmRequestRead}
            onCheckbox1Change={(checked) => {
              qortalRequestCheckbox1Ref.current = checked;
            }}
            onAccept={onOkQortalRequestExtensionAccept}
            onCancel={onCancelQortalRequestExtension}
            onCountdownComplete={onCancelQortalRequestExtension}
          />
        )}

        {isSettingsOpen && (
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

        <AppUpdateWindow />

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
        <MobileTopBar
          userInfo={userInfo}
          onOpenWalletsApp={onOpenWalletsApp}
          onOpenSendQort={onOpenSendQort}
          onOpenDrawerLookup={onOpenDrawerLookup}
          onOpenMinting={onOpenMinting}
          onOpenSettings={onOpenSettings}
          onLogout={logoutFunc}
          onOpenTabs={() => setTabsGridOpen((open) => !open)}
          tabsOverlayOpen={tabsGridOpen}
          desktopViewMode={desktopViewMode}
          setDesktopViewMode={setDesktopViewMode}
        />
      )}
      {isMobile && extState === 'authenticated' && isMainWindow && (
        <MobileTabsOverlay
          open={tabsGridOpen}
          onClose={() => setTabsGridOpen(false)}
        />
      )}

      <Box
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
                : mobileChatComposeActive ||
                    mobileGroupPanelOpen ||
                    tabBarHiddenByKeyboard ||
                    !showMobileBottomBar
                  ? SAFE_AREA_BOTTOM
                  : `calc(${MOBILE_TAB_BAR_HEIGHT_PX}px + ${SAFE_AREA_BOTTOM})`,
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
      {showMobileBottomBar &&
        extState === 'authenticated' &&
        isMainWindow &&
        !mobileChatComposeActive &&
        !mobileGroupPanelOpen &&
        !tabBarHiddenByKeyboard &&
        !showEmojiPanel && (
          <MobileTabBar
            desktopViewMode={desktopViewMode}
            setDesktopViewMode={setDesktopViewMode}
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
      {isAuthenticated && isMainWindow && isAppLocked && (
        <AuthenticatedLockScreen
          accountLabel={userInfo?.name || address || null}
          walletAddress={rawWallet?.address0 || address || null}
          onUnlock={unlockApp}
        />
      )}
    </AppContainer>
  );
}

export default App;
