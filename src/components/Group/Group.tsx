import {
  Box,
  ButtonBase,
  IconButton,
  Paper,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Activity,
  lazy,
  memo,
  Profiler,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { ChatGroup } from '../Chat/ChatGroup';
import {
  SECTION_ATTR,
  SECTION_SURFACE_TOUCH_ACTION,
  SECTION_SWIPE_IGNORE_ATTR,
} from '../Mobile/sectionSwipe/sectionSwipe';
import { useSectionSwipe } from '../Mobile/sectionSwipe/useSectionSwipe';
import { GO_TAB_BAR_SPACE } from '../Mobile/mobileBarHeights';
import { mobileTabBarElementAtom } from '../Mobile/mobileTabBarElement';
import {
  mobileSectionOrder as mobileSectionOrderFor,
  mobileTabOrderAtom,
} from '../Mobile/mobileTabOrder';
import { useCoverMobileTabBar } from '../Mobile/mobileTabBarCover';
import { IMMERSIVE_SLIDE_TARGET_ATTR } from '../Mobile/immersive/useImmersiveBars';
import {
  mobileSectionForViewMode,
  useMobileTabNavigation,
  type MobileSectionKey,
} from '../Mobile/useMobileTabNavigation';
import { WidgetsScreen } from '../Mobile/widgets/WidgetsScreen';
import {
  goWidgetsEditingAtom,
  goWidgetsEnabledAtom,
} from '../Mobile/widgets/goWidgets';
import {
  nativeSwipeZoneAtom,
  widgetSwipeFeed,
} from '../Mobile/widgets/widgetSwipeZone';
import { mobileQappFrameShowingAtom } from '../Mobile/mobileQappFrame';
import { immersiveMotionReduced } from '../Mobile/immersive/useImmersiveBars';
import { CreateCommonSecret } from '../Chat/CreateCommonSecret';
import { base64ToUint8Array } from '../../qdn/encryption/group-encryption';
import { uint8ArrayToObject } from '../../encryption/encryption';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import CallIcon from '@mui/icons-material/Call';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import CircularProgress from '@mui/material/CircularProgress';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';
import { ReticulumUnreadCountBadge } from '../common/ReticulumUnreadCountBadge';
import { ReticulumModePill } from './ReticulumModePill';

import {
  clearAllQueues,
  getBaseApiReact,
  pauseAllQueues,
  resumeAllQueues,
} from '../../App';
import { ChatDirect } from '../Chat/ChatDirect';
import {
  applyReticulumJoinUnreadBaseline,
  resolveReticulumMembershipJoinedAt,
} from '../Chat/reticulumJoinUnreadBaseline';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { LoadingButton } from '@mui/lab';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import { GroupAnnouncements } from '../Chat/GroupAnnouncements';
import { GroupForum } from '../Chat/GroupForum';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { useAndroidBack, BACK_PRIORITY } from '../../utils/androidBack';
import { WebSocketActive } from './WebsocketActive';
import { WebSocketNotifications } from './WebsocketNotifications';
import { NotificationStateSync } from '../App/NotificationStateSync';
import { PresenceStatusSync } from '../App/PresenceStatusSync';
import {
  getGroupAdmins,
  getGroupMembers,
  getNameInfo,
  getPrimaryNamesForAddresses,
  getPublishesFromAdmins,
} from './groupApi';
import { timeDifferenceForNotificationChats } from './groupConstants';
import { decryptResource } from './groupDataPublishes';
import { requestQueueMemberNames } from './groupQueues';
import {
  groupSectionUsesSecretKey,
  shouldLoadSecretKeyForSection,
  shouldLoadSecretKeyOnGroupEntry,
} from './groupSecretKeyPolicy';
import type { GroupProps } from './groupTypes';
import { areKeysEqual, validateSecretKey } from './groupValidation';
import { useMessageQueue } from '../../messaging/MessageQueueContext';
import { HomeDesktop } from './HomeDesktop';
import { DesktopHeader } from '../Desktop/DesktopHeader';
import { AppsDesktop } from '../Apps/AppsDesktop';
import { DesktopSideBar } from '../Desktop/DesktopLeftSideBar';
import { AdminSpace } from '../Chat/AdminSpace';
import {
  addressInfoControllerAtom,
  chatWidgetClosedAtom,
  enabledDevModeAtom,
  groupAnnouncementsAtom,
  groupChatTimestampsAtom,
  groupsOwnerNamesAtom,
  groupsPropertiesAtom,
  isDisabledEditorEnterAtom,
  isOpenBlockedModalAtom,
  isRunningPublicNodeAtom,
  memberGroupsAtom,
  memberDirectsAtom,
  memberGroupsLoadedAddressAtom,
  memberGroupsWithReticulumChatAtom,
  mobileGroupPanelOpenAtom,
  mutedGroupsAtom,
  myGroupsWhereIAmAdminAtom,
  reticulumDirectSummariesAtom,
  reticulumChatSummariesAtom,
  reticulumChatEnabledAtom,
  reticulumEnabledAtom,
  reticulumLegacyThreadsEnabledAtom,
  selectedGroupIdAtom,
  timestampEnterDataAtom,
  userInfoAtom,
  qortalGroupVoiceCallMinimizedAtom,
  qortalGroupCallPrimaryNamesAtom,
  qortalGroupMeshCallActiveAtom,
  qortalGroupMeshCallParticipantCountAtom,
  dmFriendsByAddressAtom,
  qortinoAgentOpenAtom,
} from '../../atoms/global';
import { closeQortinoAgentSheet } from '../../qortinoAgent/qortinoSheetNav';
import { hasPendingQortinoInstall } from '../../qortinoAgent/installPending';
/**
 * Qortino carries several megabytes of bundled knowledge and golden answers as
 * JSON. Importing it statically put that parse on the critical path of every
 * launch, even for users who never open the assistant, so it loads on demand.
 */
const LazyQortinoAgentSheet = lazy(() =>
  import('./QortinoAgent/QortinoAgentSheet').then((m) => ({
    default: m.QortinoAgentSheet,
  }))
);
import { mergeDirectsWithFriends } from '../../lib/dm/mergeDirectsWithFriends';
import { validateAddress } from '../../utils/validateAddress';
import { sortArrayByTimestampAndGroupName } from '../../utils/time';
import { dismissChatOsNotifications } from '../../utils/mobileOsNotifications';
import { isGroupMuted } from '../../utils/mutedGroups';
import {
  applyPinnedGroupOrder,
  loadPinnedGroupIds,
  subscribePinnedGroups,
} from '../../utils/pinnedGroups';
import { WalletsAppWrapper } from './WalletsAppWrapper';
import { useTranslation } from 'react-i18next';
import { GroupList } from './GroupList';
import { FirstTimeQChatEmptyState } from './FirstTimeQChatEmptyState';
import { ReturningUserActivityDashboard } from './ReturningUserActivityDashboard';
import { ReturningUserCaughtUpState } from './ReturningUserCaughtUpState';
import { startReticulumGroupScoreScheduler } from './reticulumGroupScore';
import {
  RETICULUM_GO_PREFETCH_CONCURRENCY,
  createReticulumBackgroundEventTracker,
  newestKnownReticulumPrefetchTimestamp,
  prefetchReticulumBackgroundHistory,
  processReticulumBackgroundIndexEvent,
  waitForReticulumPrefetchFirstPaintThenIdle,
  waitForReticulumPrefetchIdle,
} from './reticulumBackgroundIndex';
import {
  fetchReticulumAdminGroups,
  getGroupIdFromGroupLike,
  getReticulumGroupMembershipsFromGroupLikeList,
  noteReticulumAdminListAccountChanged,
  noteReticulumAdminListFetchFailed,
  noteReticulumAdminListFetchOk,
  reticulumAdminGroupsAfterFailedFetch,
} from './reticulumAdminList';
import { isGoApp } from '../../utils/platform';
import { useAtom, useSetAtom, useAtomValue, useStore } from 'jotai';
import { useGroupCallContext } from '../../contexts/GroupCallContext';
import { useCallSwitchGuard } from '../../contexts/CallSwitchGuardContext';
import { traceGcallAudioSurface } from '../../lib/group-call/gcallAudioSurfaceTrace';
import {
  TIME_MINUTES_10_IN_MILLISECONDS,
  TIME_MINUTES_2_IN_MILLISECONDS,
  TIME_DAYS_1_IN_MILLISECONDS,
} from '../../constants/constants';
import { useWebsocketStatus } from './useWebsocketStatus';
import { DirectsSidebar } from './DirectsSidebar';
import {
  MobileChatListPager,
  isChatListSwipeEnabled,
  type MobileChatListPagerHandle,
} from './MobileChatListPager';
import {
  CHAT_LIST_PANE_WIDTH,
  getChatPaneLayout,
  sideViewOnCloseDetail,
  sideViewOnTwoPaneExit,
} from './chatPaneLayout';
import { useGoLayout, type GoLayout } from '../../layout/goLayout';
import {
  MobileChatListHeader,
  type MobileChatListHeaderHandle,
} from './MobileChatListHeader';
import { DirectMessageSearchPanel } from './DirectMessageSearchPanel';
import type { DirectSearchHit } from './directMessageSearch';
import { directMessageJumpAtom } from '../Chat/directMessageJump';
import { pendingChatShareAtom } from '../Chat/share/chatShareState';
import { queueChatShareFor } from '../Chat/share/chatShareInbox';
import {
  chatShareKey,
  type ChatShareChat,
} from '../Chat/share/chatShareTarget';
import { ChatShareChannelStep } from '../Chat/share/ChatShareChannelStep';
import { getChatListPanelSx } from './chatListRowStyles';
import { useSwipeBackToList } from './useSwipeBackToList';
import { PerfProfiler } from '../../utils/perfProfiler';
import { useLatestCallback } from '../../hooks/useLatestCallback';
import { FreezeWhenHidden } from '../Mobile/FreezeWhenHidden';
import { QortinoMusicPlaybackController } from './HomeQortinoWorkspaceCard';
import { GlobalChatWidget } from './GlobalChatWidget';
import { openQChatTab, QCHAT_INTERNAL_TAB_ID } from '../../utils/openQChatTab';
import { HubOnboardingTour } from '../Onboarding/HubOnboardingTour';
import { OnboardingQChatPreview } from '../Onboarding/OnboardingQChatPreview';
import { QORTAL_PROJECT_GROUP_ID } from './findGroupsPinned';
import { getLastOpenChat, setLastOpenChat } from '../../utils/chatPersistence';
import { mobileAppsShellSx } from '../Mobile/mobileLayout';
import { rememberQdnAvatarPrewarmPeerNames } from '../../lib/qdnAvatars/prewarmSources';
import {
  MOBILE_PANEL_HEADER_OFFSET,
  MobilePanelHeader,
} from '../Mobile/MobilePanelHeader';
import {
  orderReticulumGroups,
  readReticulumGroupOrder,
} from './reticulumGroupRail';
import {
  beginReticulumSummaryRefresh,
  createReticulumSummaryRefreshFlight,
  getReticulumMentionBadgeCount,
  noteReticulumSummaryRefreshRun,
  RETICULUM_SUMMARY_REFRESH_GO_DEBOUNCE_MS,
  RETICULUM_SUMMARY_REFRESH_GO_MAX_WAIT_MS,
  runReticulumSummaryRefreshSingleFlight,
  scheduleReticulumSummaryRefresh,
  shareReticulumChatSummaries,
} from './reticulumSummaryRefresh';
import {
  AdminRowBox,
  CenterBox,
  ChatContentBox,
  EncryptionKeyMessageDiv,
  FloatingButtonContainerBox,
  InnerChatBox,
  MainContentBox,
  NewChatOverlay,
  NoSelectionTypography,
  NotPartAdminListBox,
  NotPartGroupDiv,
  RootBox,
  SelectedDirectOverlay,
  SelectedGroupWrapper,
} from './Group.styles';

const RETICULUM_ACTIVE_BLUE = '#2563eb';
/** Width of the left screen edge that starts a swipe to the chat list. */
const EDGE_SWIPE_ZONE_PX = 24;
/** Horizontal travel from that edge before the list panel opens. */
const EDGE_SWIPE_OPEN_PX = 44;
const selectChatTwoPane = (l: GoLayout) => l.chatTwoPane;

// Keeps the Reticulum chat tree out of unrelated Group-shell re-renders. The
// legacy ChatGroup instance below deliberately retains its existing behavior.
const ReticulumChatGroup = memo(ChatGroup);

const LazyAddGroup = lazy(() =>
  import('./AddGroup').then((m) => ({ default: m.AddGroup }))
);
const LazyFindGroupModal = lazy(() =>
  import('./FindGroupModal').then((m) => ({ default: m.FindGroupModal }))
);
const LazyFindGroupOverviewModal = lazy(() =>
  import('./FindGroupModal').then((m) => ({
    default: m.FindGroupOverviewModal,
  }))
);
const LazyManageMembers = lazy(() =>
  import('./ManageMembers').then((m) => ({ default: m.ManageMembers }))
);
const LazyBlockedUsersModal = lazy(() =>
  import('./BlockedUsersModal').then((m) => ({ default: m.BlockedUsersModal }))
);
const loadQortalLandModule = () => import('../QortalLand/QortalLand');
const LazyQortalLand = lazy(() =>
  loadQortalLandModule().then((m) => ({ default: m.QortalLand }))
);

// Helpers deliberately are NOT re-exported from here. This module is only
// reachable through AuthenticatedShell's dynamic import, and a re-export makes
// any consumer of a helper drag the whole chat UI back into the entry chunk.
// Import from ./groupApi, ./groupConstants, ./groupDataPublishes,
// ./groupQueues or ./groupValidation instead.
export type { GroupProps } from './groupTypes';

type ReticulumBackgroundEvent = {
  authorAddress?: string;
  authorPrimaryName?: string;
  channelId?: string;
  directMentionAuthorized?: boolean;
  encryptedPayload?: string;
  eventId?: string;
  eventType?: string;
  groupId?: number;
  mentionTargets?: Array<Record<string, unknown>>;
  privilegedMentionAuthorized?: boolean;
  targetEventId?: string;
  timestamp?: number;
  readByOwner?: boolean;
};

const RETICULUM_RENDERER_ONLINE_SINCE_MS = Date.now();

type ReticulumNotificationSummary = {
  groupId?: number;
  channelId?: string;
  lastEvent?: ReticulumBackgroundEvent | null;
  unreadCount?: number;
  replyCount?: number;
  mentionCount?: number;
  hasUnreadMention?: boolean;
  updatedAt?: number;
  channels?: ReticulumNotificationSummary[];
};

const RETICULUM_BACKGROUND_PROCESSED_EVENT_TTL_MS = 2 * 60 * 60_000;
const RETICULUM_BACKGROUND_PROCESSED_EVENT_MAX = 10_000;
const RETICULUM_DIRECT_NAME_RETRY_DELAY_MS = 5 * 60_000;

const getGroupIdsFromGroupLikeList = (groups: unknown): number[] => {
  if (!Array.isArray(groups)) return [];
  return [
    ...new Set(
      groups
        .map(getGroupIdFromGroupLike)
        .filter((groupId): groupId is number => groupId != null)
    ),
  ];
};

const parseReticulumPublicPayload = (value: unknown): unknown => {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const reticulumChannelDisplayName = (channelId?: string): string =>
  `#${String(channelId || 'general').replace(/^#/, '')}`;

const reticulumMentionedAddressesFromPayload = (payload: unknown): string[] => {
  if (!payload || typeof payload !== 'object') return [];
  const value = (payload as { mentionedAddresses?: unknown })
    .mentionedAddresses;
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((address) => (typeof address === 'string' ? address.trim() : ''))
        .filter(Boolean)
    ),
  ];
};

const resolveReticulumMentionAddressesFromPayload = (
  payload: unknown,
  nameToAddress: Map<string, string>
): string[] => {
  const mentioned = new Set<string>();
  const inspectHtml = (html: string) => {
    if (
      typeof DOMParser === 'undefined' ||
      !html.includes('data-type=') ||
      !html.includes('mention')
    )
      return;
    const document = new DOMParser().parseFromString(html, 'text/html');
    for (const node of document.querySelectorAll(
      '[data-type="mention"][data-id]'
    )) {
      const id = node.getAttribute('data-id')?.trim() || '';
      if (
        !id ||
        id === 'here' ||
        id === 'everyone' ||
        id.startsWith('reticulum-group:') ||
        id.startsWith('reticulum-channel:')
      )
        continue;
      if (/^Q[1-9A-HJ-NP-Za-km-z]{20,}$/.test(id)) {
        mentioned.add(id);
        continue;
      }
      const label =
        node.getAttribute('data-label')?.trim().replace(/^@/, '') || id;
      const address = nameToAddress.get(label.toLowerCase());
      if (address) mentioned.add(address);
    }
  };
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      inspectHtml(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (key === 'mentionedAddresses') continue;
      if (
        key === 'data' ||
        key === 'message' ||
        key === 'messageText' ||
        key === 'text' ||
        key === 'htmlContent'
      ) {
        visit(child);
      }
    }
  };
  visit(payload);
  return [...mentioned];
};

const authorizedReticulumBroadcastApplies = (
  event: ReticulumBackgroundEvent
): boolean => {
  if (event.privilegedMentionAuthorized !== true) return false;
  const groupId = Number(event.groupId);
  const eventChannelId = String(event.channelId || 'general');
  for (const target of event.mentionTargets || []) {
    if (Number(target?.groupId) !== groupId) continue;
    if (target?.type === 'everyone') return true;
    if (
      target?.type === 'here' &&
      String(target?.channelId || eventChannelId) === eventChannelId &&
      Number(event.timestamp || 0) >= RETICULUM_RENDERER_ONLINE_SINCE_MS
    ) {
      return true;
    }
  }
  return false;
};

/** Subscribes to memberGroupsAtom and runs effects (Group does not subscribe). */
function MemberGroupsEffects({
  getGroupsWhereIAmAMember,
  getGroupsProperties,
  myAddress,
  groupsPropertiesRef,
  hasInitializedWebsocketRef,
}: {
  getGroupsWhereIAmAMember: (groups: any[]) => Promise<boolean>;
  getGroupsProperties: (address: string) => void;
  myAddress: string;
  groupsPropertiesRef: React.MutableRefObject<Record<string, unknown>>;
  hasInitializedWebsocketRef: React.MutableRefObject<boolean>;
}) {
  const memberGroups = useAtomValue(memberGroupsAtom);
  useEffect(() => {
    if (!myAddress) return;
    let cancelled = false;
    let refreshTimer: number | null = null;
    const refresh = async () => {
      const succeeded = await getGroupsWhereIAmAMember(memberGroups || []);
      if (cancelled) return;
      refreshTimer = window.setTimeout(
        refresh,
        succeeded ? TIME_MINUTES_10_IN_MILLISECONDS / 2 : 10_000
      );
    };
    void refresh();
    return () => {
      cancelled = true;
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
    };
  }, [memberGroups, myAddress, getGroupsWhereIAmAMember]);
  useEffect(() => {
    if (!myAddress) return;
    if (
      !areKeysEqual(
        getGroupIdsFromGroupLikeList(memberGroups),
        Object.keys(groupsPropertiesRef.current || {})
      )
    ) {
      getGroupsProperties(myAddress);
    }
  }, [memberGroups, myAddress, getGroupsProperties, groupsPropertiesRef]);
  useEffect(() => {
    if (
      !myAddress ||
      hasInitializedWebsocketRef.current ||
      !memberGroups?.length
    )
      return;
    window.sendMessage('setupGroupWebsocket', {}).catch((error: Error) => {
      console.error(
        'Failed to setup group websocket:',
        error?.message || 'An error occurred'
      );
    });
    hasInitializedWebsocketRef.current = true;
  }, [myAddress, memberGroups, hasInitializedWebsocketRef]);
  return null;
}

/** Persists the last-used mobile chat side view (groups vs directs/PM). */
const CHAT_SIDE_VIEW_STORAGE_KEY = 'qortal-chat-side-view';
function PersistentSectionLayer({
  active,
  children,
  topOffset = 0,
}: {
  active: boolean;
  children: ReactNode;
  topOffset?: number | string;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (active) return;
    const focusedElement = document.activeElement;
    if (
      focusedElement instanceof HTMLElement &&
      layerRef.current?.contains(focusedElement)
    ) {
      focusedElement.blur();
    }
  }, [active]);

  return (
    <Box
      aria-hidden={!active}
      ref={layerRef}
      sx={{
        bottom: 0,
        display: 'flex',
        left: 0,
        minHeight: 0,
        minWidth: 0,
        opacity: active ? 1 : 0,
        overflow: 'hidden',
        pointerEvents: active ? 'auto' : 'none',
        position: 'absolute',
        right: 0,
        top: topOffset,
        width: '100%',
        zIndex: active ? 1 : 0,
      }}
    >
      {children}
    </Box>
  );
}

function ReticulumGroupSectionHeader({
  activeSection,
  calendarOpen,
  canManageReticulumGroup,
  groupCallDisabled,
  groupCallInCall,
  groupCallJoining,
  groupCallTooltip,
  membersPanelOpen,
  membersNotificationCount,
  onCalendarClick,
  onGroupCallClick,
  onMembersClick,
  onModeSwitchClick,
  onThreadsClick,
  sectionLabel,
}: {
  activeSection: string;
  calendarOpen?: boolean;
  canManageReticulumGroup: boolean;
  groupCallDisabled?: boolean;
  groupCallInCall?: boolean;
  groupCallJoining?: boolean;
  groupCallTooltip?: string;
  membersPanelOpen?: boolean;
  membersNotificationCount?: number;
  onCalendarClick?: () => void;
  onGroupCallClick?: () => void;
  onMembersClick?: () => void;
  onModeSwitchClick?: () => void;
  onThreadsClick?: () => void;
  sectionLabel: string;
}) {
  const theme = useTheme();
  const legacyThreadsEnabled = useAtomValue(reticulumLegacyThreadsEnabledAtom);
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const [isQManagerOpen, setIsQManagerOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    const syncAdminMenu = (event: any) => {
      setIsAdminMenuOpen(Boolean(event?.detail?.open ?? event?.open));
    };
    const syncQManager = (event: any) => {
      setIsQManagerOpen(Boolean(event?.detail?.open ?? event?.open));
    };
    const syncSearch = (event: any) => {
      setIsSearchOpen(Boolean(event?.detail?.open ?? event?.open));
    };
    subscribeToEvent('reticulumAdminKeysOpenState', syncAdminMenu);
    subscribeToEvent('reticulumQManagerOpenState', syncQManager);
    subscribeToEvent('reticulumChatSearchOpenState', syncSearch);
    return () => {
      unsubscribeFromEvent('reticulumAdminKeysOpenState', syncAdminMenu);
      unsubscribeFromEvent('reticulumQManagerOpenState', syncQManager);
      unsubscribeFromEvent('reticulumChatSearchOpenState', syncSearch);
    };
  }, []);
  const actionSx = (active?: boolean, showLabel?: boolean) => ({
    alignItems: 'center',
    borderRadius: '8px',
    color: active ? theme.palette.common.white : theme.palette.text.secondary,
    display: 'inline-flex',
    flexShrink: 0,
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: 600,
    gap: showLabel ? 0.6 : 0,
    height: 36,
    justifyContent: 'center',
    lineHeight: 1,
    minWidth: showLabel ? 0 : 36,
    overflow: 'hidden',
    px: showLabel ? 1 : 0,
    textAlign: 'center',
    transition: 'background-color 140ms ease, color 140ms ease',
    width: showLabel ? 'auto' : 36,
    backgroundColor: active ? RETICULUM_ACTIVE_BLUE : 'transparent',
    '&:hover': {
      backgroundColor: active
        ? RETICULUM_ACTIVE_BLUE
        : theme.palette.action.hover,
      color: active ? theme.palette.common.white : theme.palette.text.primary,
    },
  });
  const renderAction = ({
    active,
    disabled,
    icon,
    label,
    onClick,
    showLabel = false,
    tooltip,
  }: {
    active?: boolean;
    disabled?: boolean;
    icon: ReactNode;
    label: string;
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
    showLabel?: boolean;
    tooltip?: string;
  }) => {
    if (typeof onClick !== 'function') return null;
    return (
      <Tooltip key={label} title={tooltip || label}>
        <span style={{ display: 'inline-flex' }}>
          <ButtonBase
            disabled={disabled}
            onClick={onClick}
            sx={actionSx(active, showLabel)}
          >
            {icon}
            {showLabel && (
              <Box
                component="span"
                sx={{
                  fontSize: 12,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </Box>
            )}
          </ButtonBase>
        </span>
      </Tooltip>
    );
  };

  const isLandSection = activeSection === 'land';

  return (
    <Box
      sx={{
        alignItems: 'center',
        borderBottom: `1px solid ${theme.palette.divider}`,
        display: 'flex',
        flexShrink: 0,
        gap: 0.75,
        minHeight: isLandSection ? 56 : 50,
        overflow: 'hidden',
        px: 1.5,
      }}
    >
      {isLandSection ? (
        <Box sx={{ flex: 1, minWidth: 0, pr: 1 }}>
          <Typography
            sx={{
              color: 'text.secondary',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              lineHeight: 1.2,
              textTransform: 'uppercase',
            }}
          >
            Qortal Land
          </Typography>
          <Typography
            title={sectionLabel}
            sx={{
              fontSize: 18,
              fontWeight: 750,
              letterSpacing: '-0.01em',
              lineHeight: 1.25,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {sectionLabel}
          </Typography>
        </Box>
      ) : (
        <Typography
          sx={{
            flex: 1,
            fontSize: 17,
            fontWeight: 700,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {sectionLabel}
        </Typography>
      )}
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexShrink: 0,
          gap: 0.25,
          minWidth: 0,
          ml: 'auto',
          overflowX: 'auto',
        }}
      >
        {typeof onModeSwitchClick === 'function' && (
          <>
            <ReticulumModePill target="chat" onClick={onModeSwitchClick} />
            {!isLandSection && (
              <Box
                aria-hidden
                sx={{
                  backgroundColor: theme.palette.divider,
                  flexShrink: 0,
                  height: 22,
                  mx: 0.5,
                  width: '1px',
                }}
              />
            )}
          </>
        )}
        {renderAction({
          label: groupCallJoining
            ? 'Joining'
            : groupCallInCall
              ? 'Leave Call'
              : 'Group Call',
          icon: groupCallJoining ? (
            <CircularProgress size={17} sx={{ color: 'inherit' }} />
          ) : groupCallInCall ? (
            <CallEndRoundedIcon sx={{ fontSize: 19 }} />
          ) : (
            <CallIcon sx={{ fontSize: 19 }} />
          ),
          onClick: onGroupCallClick,
          disabled: groupCallDisabled || groupCallJoining,
          tooltip: groupCallTooltip || 'Group Call',
        })}
        {!isLandSection &&
          renderAction({
            active: calendarOpen,
            label: 'Group Calendar',
            icon: <CalendarMonthRoundedIcon sx={{ fontSize: 19 }} />,
            onClick: onCalendarClick,
          })}
        {!isLandSection &&
          legacyThreadsEnabled &&
          renderAction({
            active: activeSection === 'forum',
            label: 'Threads',
            icon: <ForumRoundedIcon sx={{ fontSize: 19 }} />,
            onClick: onThreadsClick,
          })}
        {!isLandSection &&
          legacyThreadsEnabled &&
          canManageReticulumGroup &&
          renderAction({
            active: isAdminMenuOpen,
            label: 'Admins',
            icon: <SecurityRoundedIcon sx={{ fontSize: 19 }} />,
            onClick: (event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              executeEvent('toggleReticulumAdminKeys', {
                anchorRect: {
                  bottom: rect.bottom,
                  height: rect.height,
                  left: rect.left,
                  right: rect.right,
                  top: rect.top,
                  width: rect.width,
                },
                toggle: true,
              });
            },
          })}
        {!isLandSection &&
          renderAction({
            active: isQManagerOpen,
            label: 'Q-Manager',
            icon: <FolderRoundedIcon sx={{ fontSize: 19 }} />,
            onClick: (event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              executeEvent('openReticulumQManager', {
                anchorRect: {
                  bottom: rect.bottom,
                  height: rect.height,
                  left: rect.left,
                  right: rect.right,
                  top: rect.top,
                  width: rect.width,
                },
                toggle: true,
              });
            },
          })}
        {!isLandSection && (
          <Tooltip title={membersPanelOpen ? 'Hide Members' : 'Members'}>
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                flexShrink: 0,
                overflow: 'visible',
                position: 'relative',
              }}
            >
              <IconButton
                aria-label={
                  membersNotificationCount && membersNotificationCount > 0
                    ? `Members, ${membersNotificationCount} pending join ${
                        membersNotificationCount === 1 ? 'request' : 'requests'
                      }`
                    : 'Members'
                }
                onClick={onMembersClick}
                size="small"
                sx={{
                  backgroundColor: membersPanelOpen
                    ? RETICULUM_ACTIVE_BLUE
                    : 'transparent',
                  borderRadius: '8px',
                  color: membersPanelOpen ? 'common.white' : 'text.secondary',
                  flexShrink: 0,
                  height: 36,
                  width: 36,
                  '&:hover': {
                    backgroundColor: membersPanelOpen
                      ? RETICULUM_ACTIVE_BLUE
                      : theme.palette.action.hover,
                    color: membersPanelOpen
                      ? 'common.white'
                      : theme.palette.text.primary,
                  },
                }}
              >
                <PeopleAltRoundedIcon sx={{ fontSize: 19 }} />
              </IconButton>
              {!!membersNotificationCount && membersNotificationCount > 0 && (
                <ReticulumUnreadCountBadge
                  count={membersNotificationCount}
                  outlineColor={theme.palette.background.surface}
                  size={13}
                  fontSize={8}
                  sx={{
                    position: 'absolute',
                    right: -4,
                    top: -4,
                    zIndex: 2,
                  }}
                />
              )}
            </Box>
          </Tooltip>
        )}
        {!isLandSection &&
          renderAction({
            active: isSearchOpen,
            label: 'Search Chat',
            icon: <SearchRoundedIcon sx={{ fontSize: 18 }} />,
            onClick: () =>
              executeEvent('openReticulumChatSearch', { toggle: true }),
          })}
      </Box>
    </Box>
  );
}

const GroupInner = ({
  myAddress,
  setDesktopViewMode,
  desktopViewMode,
  onOpenSettings,
}: GroupProps) => {
  const [desktopSideView, setDesktopSideView] = useState('groups');
  const [chatWidgetClosed, setChatWidgetClosed] = useAtom(chatWidgetClosedAtom);
  const [lastQappViewMode, setLastQappViewMode] = useState('apps');
  const [secretKey, setSecretKey] = useState(null);
  const [secretKeyPublishDate, setSecretKeyPublishDate] = useState(null);
  const lastFetchedSecretKey = useRef(null);
  const [secretKeyDetails, setSecretKeyDetails] = useState(null);
  const [newEncryptionNotification, setNewEncryptionNotification] =
    useState(null);
  const [memberCountFromSecretKeyData, setMemberCountFromSecretKeyData] =
    useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [onboardingQChatPreviewOpen, setOnboardingQChatPreviewOpen] =
    useState(false);
  const [selectedDirect, setSelectedDirect] = useState(null);
  const hasInitializedWebsocket = useRef(false);
  const memberGroupsRef = useRef<any[]>([]);
  const memberGroupsLoadedAddressRef = useRef('');
  const [directs, setDirects] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [adminsWithNames, setAdminsWithNames] = useState([]);
  const [members, setMembers] = useState([]);
  const [groupOwner, setGroupOwner] = useState(null);
  const [triedToFetchSecretKey, setTriedToFetchSecretKey] = useState(false);
  const [openAddGroup, setOpenAddGroup] = useState(false);
  const [openFindGroup, setOpenFindGroup] = useState(false);
  const [openAddGroupTab, setOpenAddGroupTab] = useState<0 | 1 | 2>(0);
  const [openManageMembers, setOpenManageMembers] = useState(false);
  const setMemberGroups = useSetAtom(memberGroupsAtom);
  const setMemberDirects = useSetAtom(memberDirectsAtom);
  const [timestampEnterData, setTimestampEnterData] = useAtom(
    timestampEnterDataAtom
  );
  const groupsPropertiesRef = useRef({});
  const [chatMode, setChatMode] = useState('groups');
  const [newChat, setNewChat] = useState(false);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [isLoadingNotifyAdmin, setIsLoadingNotifyAdmin] = useState(false);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [isLoadingGroup, setIsLoadingGroup] = useState(false);
  const [isLoadingThreadKey, setIsLoadingThreadKey] = useState(false);
  const [firstSecretKeyInCreation, setFirstSecretKeyInCreation] =
    useState(false);
  const [groupSection, setGroupSection] = useState('home');
  const [groupAnnouncements, setGroupAnnouncements] = useAtom(
    groupAnnouncementsAtom
  );
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  // GO tablets and wide windows: the chat list pinned beside the chat
  // (always false on the Hub).
  const chatTwoPane = useGoLayout(selectChatTwoPane);
  // Leaving two-pane with a DM open beside the Groups list: turn the list to
  // DMs in this same render, before the open DM would unmount. (A
  // previous-value tracker, not state seeded from a signal.)
  const [chatTwoPaneBefore, setChatTwoPaneBefore] = useState(chatTwoPane);
  if (chatTwoPaneBefore !== chatTwoPane) {
    setChatTwoPaneBefore(chatTwoPane);
    const sideView = sideViewOnTwoPaneExit({
      wasTwoPane: chatTwoPaneBefore,
      twoPane: chatTwoPane,
      directOpen: !!(selectedDirect || newChat),
      desktopSideView,
    });
    if (sideView) setDesktopSideView(sideView);
  }

  const [defaultThread, setDefaultThread] = useState(null);
  const [, setIsOpenDrawer] = useState(false);
  const [isOpenBlockedModal, setIsOpenBlockedUserModal] = useAtom(
    isOpenBlockedModalAtom
  );
  const [hideCommonKeyPopup, setHideCommonKeyPopup] = useState(false);
  const [isLoadingGroupMessage, setIsLoadingGroupMessage] = useState('');
  const setMutedGroups = useSetAtom(mutedGroupsAtom);
  const mutedGroups = useAtomValue(mutedGroupsAtom);
  // Mention alerts read mute from these, not from a render's closure: an
  // event can wait seconds for the member list, and the first ones after
  // login can arrive before the stored list has loaded.
  const mutedGroupsRef = useRef<unknown>(mutedGroups);
  const mutedGroupsLoadedRef = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    mutedGroupsRef.current = mutedGroups;
  }, [mutedGroups]);
  const memberGroupsForReticulum = useAtomValue(memberGroupsAtom);
  const memberGroupsWithReticulumActivity = useAtomValue(
    memberGroupsWithReticulumChatAtom
  );
  const [memberGroupsLoadedAddress, setMemberGroupsLoadedAddress] = useAtom(
    memberGroupsLoadedAddressAtom
  );

  useEffect(() => {
    memberGroupsLoadedAddressRef.current = memberGroupsLoadedAddress;
  }, [memberGroupsLoadedAddress]);
  const [notificationReticulumChannelId, setNotificationReticulumChannelId] =
    useState('');
  const [notificationReticulumMessageId, setNotificationReticulumMessageId] =
    useState('');
  const [reticulumCalendarOpenRequest, setReticulumCalendarOpenRequest] =
    useState(0);
  const [reticulumCalendarOpen, setReticulumCalendarOpen] = useState(false);
  const [reticulumCalendarTarget, setReticulumCalendarTarget] = useState<{
    groupId: number;
    eventId: string;
    occurrenceStart: number;
    timezone: string;
  } | null>(null);
  const [activeReticulumChannelId, setActiveReticulumChannelId] =
    useState('general');
  const [reticulumReadEntryToken, setReticulumReadEntryToken] = useState(0);
  const [mountedLandGroupId, setMountedLandGroupId] = useState<string | null>(
    null
  );
  // On phones the members panel is a full-width overlay, so opening it by
  // default would hide the conversation the user just tapped into.
  const [reticulumChatMembersPanelOpen, setReticulumChatMembersPanelOpen] =
    useState(!isMobile);
  const [reticulumLandMembersPanelOpen, setReticulumLandMembersPanelOpen] =
    useState(false);
  // Lets the group/DM list slide in over an open conversation on phones.
  const [mobileListPanelOpen, setMobileListPanelOpen] = useState(false);
  const mobileEdgeSwipeRef = useRef<{ x: number; y: number } | null>(null);
  const mobilePanelSwipeRef = useRef<{ x: number; y: number } | null>(null);
  // Phones: the header over the Groups / DMs pages, moved with them.
  const mobileChatListHeaderRef = useRef<MobileChatListHeaderHandle>(null);
  const phoneChatListPagerRef = useRef<MobileChatListPagerHandle>(null);
  const [directMessageSearchOpen, setDirectMessageSearchOpen] = useState(false);
  // Phones: the open conversation and the list panel, for the swipe back from
  // a DM to the DM list.
  const [phoneChatDetailEl, setPhoneChatDetailEl] =
    useState<HTMLElement | null>(null);
  const [phoneChatListPanelEl, setPhoneChatListPanelEl] =
    useState<HTMLElement | null>(null);
  const setDirectMessageJump = useSetAtom(directMessageJumpAtom);
  const [reticulumSearchOverlayOpen, setReticulumSearchOverlayOpen] =
    useState(false);
  const [reticulumJoinRequestCount, setReticulumJoinRequestCount] = useState(0);
  const [mobileViewMode, setMobileViewMode] = useState('home');
  const [, setMobileViewModeKeepOpen] = useState('');
  const [isQChatTabActive, setIsQChatTabActive] = useState(false);
  const timestampEnterDataRef = useRef({});
  const myAddressRef = useRef('');
  const selectedGroupRef = useRef(null);
  const selectedDirectRef = useRef(null);
  const newChatRef = useRef(false);
  const chatSessionInitializedRef = useRef(false);
  // selectGroupFunc is declared further down; keep a ref so callbacks defined
  // before it (e.g. restoreLastOpenChat) can call it without a TDZ reference.
  const selectGroupFuncRef = useRef<((group: any) => void) | null>(null);
  const groupSectionRef = useRef(null);
  const isLoadingOpenSectionFromNotification = useRef(false);
  const settimeoutForRefetchSecretKey = useRef(null);
  const threadKeyLoadRef = useRef<{ groupId: string } | null>(null);
  const secretKeyRef = useRef(null);
  // Bounded quick-retry counter for the first-launch wallet/keyPair race.
  const secretKeyAuthRetriesRef = useRef(0);
  const { clearStatesMessageQueueProvider } = useMessageQueue();
  const initiatedGetMembers = useRef(false);
  const [groupChatTimestamps, setGroupChatTimestamps] = useAtom(
    groupChatTimestampsAtom
  );
  const setReticulumChatSummaries = useSetAtom(reticulumChatSummariesAtom);
  const [reticulumChatEnabled, setReticulumChatEnabled] = useAtom(
    reticulumChatEnabledAtom
  );
  const reticulumChatEnabledRef = useRef(reticulumChatEnabled);
  reticulumChatEnabledRef.current = reticulumChatEnabled;
  const [reticulumEnabled, setReticulumEnabled] = useAtom(reticulumEnabledAtom);
  const [reticulumDirectSummaries, setReticulumDirectSummaries] = useAtom(
    reticulumDirectSummariesAtom
  );
  const [reticulumDirectNamesByAddress, setReticulumDirectNamesByAddress] =
    useState<Record<string, string>>({});
  const reticulumDirectNamesByAddressRef = useRef<Record<string, string>>({});
  const reticulumDirectNameResolutionsRef = useRef(new Set<string>());
  const reticulumDirectNameRetryAfterRef = useRef(new Map<string, number>());
  const reticulumSubscribedGroupIdsRef = useRef<Set<number>>(new Set());
  // Which events this page has indexed and which mention notifications it
  // has recorded, kept apart: a repeated emission of an indexed event only
  // records a missing notification and makes no index RPCs.
  const [reticulumBackgroundEventTracker] = useState(() =>
    createReticulumBackgroundEventTracker({
      ttlMs: RETICULUM_BACKGROUND_PROCESSED_EVENT_TTL_MS,
      maxEntries: RETICULUM_BACKGROUND_PROCESSED_EVENT_MAX,
    })
  );
  const reticulumGroupMentionNameCacheRef = useRef<
    Map<number, Map<string, string>>
  >(new Map());
  const reticulumSummariesRefreshTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const reticulumSummariesRefreshWindowStartedAtRef = useRef<number | null>(
    null
  );
  // GO: a refresh asked for by a user action (a read) keeps the short
  // cadence, in its own timer, so engine bursts on the long one cannot
  // postpone it.
  const reticulumSummariesSoonRefreshTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const reticulumSummariesSoonRefreshWindowStartedAtRef = useRef<number | null>(
    null
  );
  const reticulumDirectSummariesRefreshTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const reticulumSummariesRefreshSequenceRef = useRef(0);
  const [reticulumSummariesRefreshFlight] = useState(
    createReticulumSummaryRefreshFlight
  );
  const jotaiStore = useStore();

  useEffect(() => {
    let cancelled = false;
    let applySequence = 0;
    let settingsChangeReceived = false;
    const applySettings = async (settings?: {
      reticulumEnabled?: boolean;
      reticulumChatEnabled?: boolean;
    }) => {
      const sequence = ++applySequence;
      const globallyEnabled = settings?.reticulumEnabled !== false;
      if (cancelled) return;
      setReticulumEnabled(globallyEnabled);
      if (!globallyEnabled) {
        reticulumSummariesRefreshSequenceRef.current += 1;
        setReticulumChatEnabled(false);
        setReticulumChatSummaries({});
        setReticulumDirectSummaries({});
        void window.reticulumChat?.updateMentionBadge?.(0);
        return;
      }
      const chatEnabled =
        settings?.reticulumChatEnabled !== false &&
        (await window.reticulumChat?.isEnabled?.()) === true;
      if (!cancelled && sequence === applySequence) {
        setReticulumChatEnabled(chatEnabled);
      }
    };

    const unsubscribe = window.electronAPI?.onAppSettingsChanged?.(
      (settings) => {
        settingsChangeReceived = true;
        void applySettings(settings);
      }
    );
    void window.electronAPI?.getAppSettings?.().then((settings) => {
      if (!settingsChangeReceived) void applySettings(settings);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    setReticulumChatEnabled,
    setReticulumChatSummaries,
    setReticulumDirectSummaries,
    setReticulumEnabled,
  ]);
  const activeReticulumChannelIdRef = useRef('general');
  const bumpReticulumReadEntryToken = useCallback(() => {
    setReticulumReadEntryToken((token) => token + 1);
  }, []);
  const setIsEnabledDevMode = useSetAtom(enabledDevModeAtom);
  const setIsDisabledEditorEnter = useSetAtom(isDisabledEditorEnterAtom);

  useEffect(() => {
    if (!openAddGroup) {
      setOpenAddGroupTab(0);
    }
  }, [openAddGroup]);

  useEffect(() => {
    const isDevModeFromStorage = localStorage.getItem('isEnabledDevMode');
    if (isDevModeFromStorage) {
      setIsEnabledDevMode(JSON.parse(isDevModeFromStorage));
    }
    try {
      const val = localStorage.getItem('settings-disable-editor-enter');
      if (val) {
        const parsedVal = JSON.parse(val);
        if (parsedVal === false || parsedVal === true) {
          setIsDisabledEditorEnter(parsedVal);
        }
      }
    } catch (error) {
      console.log(error);
    }
  }, []);
  const [isRunningPublicNode] = useAtom(isRunningPublicNodeAtom);

  useEffect(() => {
    if (desktopViewMode === 'apps' || desktopViewMode === 'dev') {
      setLastQappViewMode(desktopViewMode);
    }
  }, [desktopViewMode]);

  const [appsMode, setAppsMode] = useState('home');
  const [appsModeDev, setAppsModeDev] = useState('home');
  const [isOpenSideViewDirects, setIsOpenSideViewDirects] = useState(false);
  const [isOpenSideViewGroups, setIsOpenSideViewGroups] = useState(false);
  const [isForceShowCreationKeyPopup, setIsForceShowCreationKeyPopup] =
    useState(false);
  const groupsOwnerNamesRef = useRef({});
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);
  useWebsocketStatus();
  const [groupsProperties, setGroupsProperties] = useAtom(groupsPropertiesAtom);
  const setGroupsOwnerNames = useSetAtom(groupsOwnerNamesAtom);
  const userInfo = useAtomValue(userInfoAtom);
  const dmFriendsByAddress = useAtomValue(dmFriendsByAddressAtom);
  const qortinoAgentOpen = useAtomValue(qortinoAgentOpenAtom);
  // Keep the sheet mounted once summoned so park/restore still holds the
  // session, but never pay for it before the first open.
  const [qortinoEverOpened, setQortinoEverOpened] = useState(false);
  useEffect(() => {
    if (qortinoAgentOpen) setQortinoEverOpened(true);
  }, [qortinoAgentOpen]);
  // A Qortino download that GO closed half way carries on after sign-in.
  const signedInAddress = userInfo?.address;
  useEffect(() => {
    if (!signedInAddress || !hasPendingQortinoInstall()) return;
    void import('../../qortinoAgent/installJob')
      .then((job) => job.resumeQortinoInstallIfPending())
      .catch(() => undefined);
  }, [signedInAddress]);

  const {
    roomState: gcallRoomState,
    joinGroupCall,
    leaveGroupCall,
    roomId: gcallActiveRoomId,
  } = useGroupCallContext();
  const { confirmCallSwitch } = useCallSwitchGuard();
  const setQcallMinimized = useSetAtom(qortalGroupVoiceCallMinimizedAtom);
  const setQcallPrimaryNames = useSetAtom(qortalGroupCallPrimaryNamesAtom);
  const meshCallActiveByGroupId = useAtomValue(qortalGroupMeshCallActiveAtom);
  const meshCallParticipantCountByGroupId = useAtomValue(
    qortalGroupMeshCallParticipantCountAtom
  );

  const gcallGroupNumericId = useMemo(() => {
    const id = selectedGroup?.groupId;
    if (id === undefined || id === null || id === '0') return null;
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
  }, [selectedGroup?.groupId]);

  const gcallRoomIdForGroup =
    gcallGroupNumericId !== null ? `gcall-qortal-${gcallGroupNumericId}` : '';

  const inThisGroupGcall =
    gcallRoomState !== 'idle' && gcallActiveRoomId === gcallRoomIdForGroup;
  const inOtherGcall =
    gcallRoomState !== 'idle' && gcallActiveRoomId !== gcallRoomIdForGroup;

  const handleGroupCallHeaderClick = useCallback(async () => {
    traceGcallAudioSurface('ui.Group: header call icon clicked', {
      gcallGroupNumericId,
      gcallRoomIdForGroup,
      hasAudioSurface: Boolean(
        typeof window !== 'undefined' &&
        (window as Window & { audioSurface?: unknown }).audioSurface
      ),
      desktopViewMode,
    });
    if (gcallGroupNumericId === null || !gcallRoomIdForGroup) {
      traceGcallAudioSurface(
        'ui.Group: early exit (no room id for selected group)',
        {}
      );
      return;
    }
    if (inThisGroupGcall) {
      traceGcallAudioSurface('ui.Group: leaving call', { gcallRoomIdForGroup });
      await leaveGroupCall();
      return;
    }
    const confirmed = await confirmCallSwitch({
      type: 'group',
      roomId: gcallRoomIdForGroup,
    });
    if (!confirmed) return;
    // Calls deliberately start in the compact nav widget. The stage is opened
    // only when the user explicitly expands it there.
    setQcallMinimized(true);
    let memberGateAddresses: string[] = [];
    const primaryNamesByAddress: Record<string, string> = {};
    try {
      const data = await getGroupMembers(gcallGroupNumericId);
      const addressSet = new Set<string>();
      if (Array.isArray(data?.members)) {
        for (const member of data.members) {
          const address =
            typeof member?.member === 'string' ? member.member.trim() : '';
          if (address) {
            addressSet.add(address);
            const primaryName =
              typeof member?.primaryName === 'string'
                ? member.primaryName.trim()
                : '';
            if (primaryName) {
              primaryNamesByAddress[address] = primaryName;
            }
          }
        }
      }
      memberGateAddresses = [...addressSet];
      setQcallPrimaryNames(primaryNamesByAddress);
      traceGcallAudioSurface('ui.Group: synced group call member gate', {
        groupId: gcallGroupNumericId,
        memberCount: memberGateAddresses.length,
        primaryNameCount: Object.keys(primaryNamesByAddress).length,
        localIncluded: Boolean(
          userInfo?.address && addressSet.has(userInfo.address)
        ),
      });
    } catch (error) {
      traceGcallAudioSurface('ui.Group: failed group call member gate fetch', {
        groupId: gcallGroupNumericId,
        message: error instanceof Error ? error.message : 'unknown',
      });
      setInfoSnack({
        type: 'error',
        message: t('core:group_call_members_fetch_failed', {
          postProcess: 'capitalizeFirstChar',
        }),
      });
      setOpenSnack(true);
      setQcallPrimaryNames({});
      return;
    }
    // The group row's call badge: people already in this call. The engine
    // then waits for their root instead of electing itself after a second.
    const gcallBadgeKey = String(gcallGroupNumericId);
    const occupiedRoomParticipantHint = meshCallActiveByGroupId[gcallBadgeKey]
      ? Math.max(1, meshCallParticipantCountByGroupId[gcallBadgeKey] ?? 0)
      : 0;
    await joinGroupCall(gcallRoomIdForGroup, `group:${gcallGroupNumericId}`, {
      memberGateGroupId: gcallGroupNumericId,
      memberGateGroupName: selectedGroup?.groupName,
      memberGateAddresses,
      occupiedRoomParticipantHint,
    });
  }, [
    desktopViewMode,
    gcallGroupNumericId,
    gcallRoomIdForGroup,
    inThisGroupGcall,
    confirmCallSwitch,
    joinGroupCall,
    leaveGroupCall,
    meshCallActiveByGroupId,
    meshCallParticipantCountByGroupId,
    selectedGroup?.groupName,
    setQcallMinimized,
    setQcallPrimaryNames,
    t,
    userInfo?.address,
  ]);

  const setUserInfoForLevels = useSetAtom(addressInfoControllerAtom);
  const [myGroupsWhereIAmAdmin, setMyGroupsWhereIAmAdmin] = useAtom(
    myGroupsWhereIAmAdminAtom
  );
  const [
    reticulumAdminGroupsLoadedAddress,
    setReticulumAdminGroupsLoadedAddress,
  ] = useState('');
  // The account whose admin list last loaded successfully this session. Only
  // then is the list authoritative for the engine (see reticulumAdminList).
  const [reticulumAdminListOkAddress, setReticulumAdminListOkAddress] =
    useState('');
  const reticulumAdminListOkAddressRef = useRef('');
  const [reticulumMembershipsAppliedKey, setReticulumMembershipsAppliedKey] =
    useState('');
  const [
    reticulumSummariesLoadedMembershipKey,
    setReticulumSummariesLoadedMembershipKey,
  ] = useState('');
  const [reticulumTransportReadyRevision, setReticulumTransportReadyRevision] =
    useState(0);
  const [reticulumChatReadinessState, setReticulumChatReadinessState] =
    useState<'idle' | 'starting' | 'ready' | 'failed'>('idle');
  const reticulumAdminGroupIds = useMemo(
    () => new Set(getGroupIdsFromGroupLikeList(myGroupsWhereIAmAdmin)),
    [myGroupsWhereIAmAdmin]
  );
  const isPrivate = useMemo(() => {
    if (selectedGroup?.groupId === '0') return false;
    if (!selectedGroup?.groupId || !groupsProperties[selectedGroup?.groupId])
      return null;
    if (groupsProperties[selectedGroup?.groupId]?.isOpen === true) return false;
    if (groupsProperties[selectedGroup?.groupId]?.isOpen === false) return true;
    return null;
  }, [selectedGroup]);

  const setSelectedGroupId = useSetAtom(selectedGroupIdAtom);

  const toggleSideViewDirects = useCallback(() => {
    if (isOpenSideViewGroups) {
      setIsOpenSideViewGroups(false);
    }
    setIsOpenSideViewDirects((prev) => !prev);
  }, [isOpenSideViewGroups]);

  const toggleSideViewGroups = useCallback(() => {
    if (isOpenSideViewDirects) {
      setIsOpenSideViewDirects(false);
    }
    setIsOpenSideViewGroups((prev) => !prev);
  }, [isOpenSideViewDirects]);

  useEffect(() => {
    timestampEnterDataRef.current = timestampEnterData;
  }, [timestampEnterData]);

  useEffect(() => {
    groupSectionRef.current = groupSection;
  }, [groupSection]);
  useEffect(() => {
    selectedGroupRef.current = selectedGroup;
    setSelectedGroupId(selectedGroup?.groupId);
  }, [selectedGroup]);
  useEffect(() => {
    selectedDirectRef.current = selectedDirect;
  }, [selectedDirect]);
  useEffect(() => {
    newChatRef.current = newChat;
  }, [newChat]);
  useEffect(() => {
    activeReticulumChannelIdRef.current = activeReticulumChannelId || 'general';
  }, [activeReticulumChannelId]);

  useEffect(() => {
    setMountedLandGroupId(null);
    setIsLoadingThreadKey(false);
    threadKeyLoadRef.current = null;
    if (settimeoutForRefetchSecretKey.current) {
      clearTimeout(settimeoutForRefetchSecretKey.current);
      settimeoutForRefetchSecretKey.current = null;
    }
  }, [selectedGroup?.groupId]);

  useEffect(() => {
    secretKeyRef.current = secretKey;
  }, [secretKey]);

  useEffect(() => {
    reticulumBackgroundEventTracker.clear();
  }, [myAddress, reticulumBackgroundEventTracker]);

  // Track view modes to prevent marking messages as read when not viewing chat
  const desktopViewModeRef = useRef(desktopViewMode);
  const mobileViewModeRef = useRef(mobileViewMode);
  const qChatTabActiveRef = useRef(false);
  const lastNonQappDesktopViewModeRef = useRef(
    desktopViewMode !== 'apps' && desktopViewMode !== 'dev'
      ? desktopViewMode
      : 'home'
  );

  useEffect(() => {
    desktopViewModeRef.current = desktopViewMode;
    if (desktopViewMode !== 'apps' && desktopViewMode !== 'dev') {
      lastNonQappDesktopViewModeRef.current = desktopViewMode;
    }
  }, [desktopViewMode]);

  useEffect(() => {
    mobileViewModeRef.current = mobileViewMode;
  }, [mobileViewMode]);

  useEffect(() => {
    qChatTabActiveRef.current = isQChatTabActive;
  }, [isQChatTabActive]);

  useEffect(() => {
    if (!isMobile) return;
    setIsQChatTabActive(desktopViewMode === 'chat');
  }, [desktopViewMode, isMobile]);

  // Track previous view mode to detect when user returns to chat
  const prevDesktopViewModeRef = useRef(desktopViewMode);
  const prevMobileViewModeRef = useRef(mobileViewMode);
  const prevQChatTabActiveRef = useRef(isQChatTabActive);

  // Mark messages as read when user returns to chat view
  useEffect(() => {
    const wasInChatMode =
      prevQChatTabActiveRef.current || prevMobileViewModeRef.current === 'chat';

    const isNowInChatMode =
      isQChatTabActive ||
      mobileViewMode === 'chat' ||
      (isMobile && desktopViewMode === 'chat');

    // Only update timestamp when user RETURNS to chat (wasn't in chat, now is in chat)
    if (!wasInChatMode && isNowInChatMode) {
      void dismissChatOsNotifications();
      // Update timestamp for selected group chat
      if (selectedGroupRef.current && groupSectionRef.current === 'chat') {
        window
          .sendMessage('addTimestampEnterChat', {
            timestamp: Date.now(),
            groupId: selectedGroupRef.current.groupId,
          })
          .then(() => {
            // Refresh the timestamp data to update UI
            setTimeout(() => {
              getTimestampEnterChat();
            }, 600);
          })
          .catch((error) => {
            console.error(
              'Failed to add timestamp:',
              error.message || 'An error occurred'
            );
          });
      }

      // Update timestamp for selected direct chat
      if (selectedDirectRef.current) {
        window
          .sendMessage('addTimestampEnterChat', {
            timestamp: Date.now(),
            groupId: selectedDirectRef.current.address,
          })
          .then(() => {
            // Refresh the timestamp data to update UI
            setTimeout(() => {
              getTimestampEnterChat();
            }, 600);
          })
          .catch((error) => {
            console.error(
              'Failed to add timestamp:',
              error.message || 'An error occurred'
            );
          });
      }
    }

    // Update previous view mode refs
    prevDesktopViewModeRef.current = desktopViewMode;
    prevMobileViewModeRef.current = mobileViewMode;
    prevQChatTabActiveRef.current = isQChatTabActive;
  }, [desktopViewMode, isMobile, isQChatTabActive, mobileViewMode]);

  const getUserSettings = useCallback(async () => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getUserSettings', {
            key: 'mutedGroups',
          })
          .then((response) => {
            if (!response?.error) {
              mutedGroupsRef.current = response || [];
              setMutedGroups(response || []);
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
    } catch (error) {
      console.error(error);
    }
  }, [setMutedGroups]);

  useEffect(() => {
    mutedGroupsLoadedRef.current = getUserSettings().catch(() => undefined);
  }, [getUserSettings]);

  const getTimestampEnterChat = useCallback(async () => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getTimestampEnterChat')
          .then((response) => {
            if (!response?.error) {
              setTimestampEnterData(response);
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
    } catch (error) {
      console.log(error);
    }
  }, []);

  const syncReticulumMentionNotifications = useCallback(
    (summaries: Record<string, ReticulumNotificationSummary>) => {
      for (const group of memberGroupsRef.current || []) {
        const groupId = Number(group?.groupId);
        if (!Number.isFinite(groupId)) continue;
        const summary = summaries?.[String(groupId)];
        const channels = Array.isArray(summary?.channels)
          ? summary.channels
          : [];
        const mentionedChannels = channels.filter(
          (channel) => Number(channel?.mentionCount || 0) > 0
        );
        const latestMentionedChannel = mentionedChannels.reduce<
          ReticulumNotificationSummary | undefined
        >((latest, channel) => {
          if (!latest) return channel;
          return Number(channel?.updatedAt || 0) >
            Number(latest?.updatedAt || 0)
            ? channel
            : latest;
        }, undefined);
        const mentionCount = Math.max(0, Number(summary?.mentionCount) || 0);
        executeEvent('q-chat-mention-notification', {
          channelId: String(
            latestMentionedChannel?.channelId || summary?.channelId || 'general'
          ),
          groupId,
          groupName:
            group?.groupName || group?.name || `Group ${String(groupId)}`,
          mentionCount,
          syncUnreadCount: true,
          timestamp: Number(
            latestMentionedChannel?.updatedAt ||
              summary?.updatedAt ||
              Date.now()
          ),
        });
      }
    },
    []
  );

  const refreshReticulumChatSummariesOnce =
    useCallback(async (): Promise<boolean> => {
      const refreshWasSuperseded = beginReticulumSummaryRefresh(
        reticulumSummariesRefreshSequenceRef
      );
      try {
        if (typeof window.reticulumChat?.isEnabled !== 'function') {
          console.error(
            '[ReticulumChat] Activity dashboard cannot initialize: isEnabled bridge is unavailable'
          );
          return false;
        }
        const enabled = await window.reticulumChat?.isEnabled?.();
        if (refreshWasSuperseded()) return true;
        setReticulumChatEnabled(enabled === true);
        if (!enabled) {
          setReticulumChatSummaries({});
          void window.reticulumChat?.updateMentionBadge?.(0);
          return false;
        }
        if (typeof window.reticulumChat?.getSummaries !== 'function') {
          console.error(
            '[ReticulumChat] Activity dashboard cannot initialize: getSummaries bridge is unavailable'
          );
          return false;
        }
        const summariesStartedAt = Date.now();
        const summaries = await window.reticulumChat?.getSummaries?.(myAddress);
        const summariesMs = Date.now() - summariesStartedAt;
        if (refreshWasSuperseded()) return true;
        if (!Array.isArray(summaries)) {
          console.error(
            '[ReticulumChat] Activity dashboard summary refresh returned an invalid result',
            { resultType: summaries === null ? 'null' : typeof summaries }
          );
          setReticulumChatSummaries({});
          void window.reticulumChat?.updateMentionBadge?.(0);
          return false;
        }
        // Unchanged groups keep their summary objects and an unchanged
        // result keeps the atom value, so nothing re-renders for it.
        const previous = jotaiStore.get(reticulumChatSummariesAtom);
        const next = shareReticulumChatSummaries<any>(previous, summaries);
        if (next !== previous) setReticulumChatSummaries(next);
        noteReticulumSummaryRefreshRun(summariesMs, next !== previous);
        syncReticulumMentionNotifications(next);
        void window.reticulumChat?.updateMentionBadge?.(
          getReticulumMentionBadgeCount(next)
        );
        return true;
      } catch (error) {
        if (refreshWasSuperseded()) return true;
        console.error(
          '[ReticulumChat] Failed to refresh group summaries:',
          error
        );
        return false;
      }
    }, [
      jotaiStore,
      myAddress,
      setReticulumChatEnabled,
      setReticulumChatSummaries,
      syncReticulumMentionNotifications,
    ]);

  // Single-flight: getSummaries never runs twice at once on the engine; a
  // request during a run gets one shared follow-up after it.
  const refreshReticulumChatSummaries = useCallback(
    (): Promise<boolean> =>
      runReticulumSummaryRefreshSingleFlight(
        reticulumSummariesRefreshFlight,
        refreshReticulumChatSummariesOnce
      ),
    [refreshReticulumChatSummariesOnce, reticulumSummariesRefreshFlight]
  );

  const runScheduledReticulumChatSummariesRefresh = useCallback(() => {
    // One refresh covers both timers' requests.
    for (const timerRef of [
      reticulumSummariesRefreshTimerRef,
      reticulumSummariesSoonRefreshTimerRef,
    ]) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    reticulumSummariesRefreshWindowStartedAtRef.current = null;
    reticulumSummariesSoonRefreshWindowStartedAtRef.current = null;
    return refreshReticulumChatSummaries();
  }, [refreshReticulumChatSummaries]);

  const scheduleReticulumChatSummariesRefresh = useCallback(() => {
    const goCadence = isGoApp();
    scheduleReticulumSummaryRefresh(
      reticulumSummariesRefreshTimerRef,
      reticulumSummariesRefreshWindowStartedAtRef,
      runScheduledReticulumChatSummariesRefresh,
      goCadence ? RETICULUM_SUMMARY_REFRESH_GO_DEBOUNCE_MS : undefined,
      goCadence ? RETICULUM_SUMMARY_REFRESH_GO_MAX_WAIT_MS : undefined
    );
  }, [runScheduledReticulumChatSummariesRefresh]);

  // For refreshes a user action asked for (a read, a setting): on GO they
  // keep the short cadence; elsewhere this is the one scheduler above.
  const scheduleReticulumChatSummariesRefreshSoon = useCallback(() => {
    if (!isGoApp()) {
      scheduleReticulumChatSummariesRefresh();
      return;
    }
    scheduleReticulumSummaryRefresh(
      reticulumSummariesSoonRefreshTimerRef,
      reticulumSummariesSoonRefreshWindowStartedAtRef,
      runScheduledReticulumChatSummariesRefresh
    );
  }, [
    runScheduledReticulumChatSummariesRefresh,
    scheduleReticulumChatSummariesRefresh,
  ]);

  useEffect(() => {
    reticulumSummariesRefreshSequenceRef.current += 1;
    myAddressRef.current = myAddress || '';
    setReticulumAdminGroupsLoadedAddress('');
    reticulumAdminListOkAddressRef.current = '';
    setReticulumAdminListOkAddress('');
    noteReticulumAdminListAccountChanged();
    setReticulumMembershipsAppliedKey('');
    setReticulumSummariesLoadedMembershipKey('');
    if (!myAddress) {
      void window.reticulumChat?.updateMentionBadge?.(0);
    }
  }, [myAddress]);

  const reticulumMemberships = useMemo(
    () =>
      getReticulumGroupMembershipsFromGroupLikeList(
        memberGroupsForReticulum,
        groupsProperties,
        myAddress,
        reticulumAdminGroupIds,
        // Hysteresis: not authoritative until the first good admin list for
        // this account, then authoritative for the session (a later failure
        // keeps that list), so failed refreshes never flip every group.
        !!myAddress && reticulumAdminListOkAddress === myAddress
      ),
    [
      groupsProperties,
      memberGroupsForReticulum,
      myAddress,
      reticulumAdminGroupIds,
      reticulumAdminListOkAddress,
    ]
  );
  const reticulumMembershipsKey = useMemo(
    () =>
      JSON.stringify(
        reticulumMemberships.map(
          ({
            groupId,
            isPrivate,
            isAdmin,
            adminStatusAuthoritative,
            joinedAt,
            localAddress,
          }) => ({
            groupId,
            isPrivate,
            isAdmin,
            adminStatusAuthoritative,
            joinedAt: joinedAt || 0,
            localAddress: localAddress || '',
          })
        )
      ),
    [reticulumMemberships]
  );

  useEffect(() => {
    return window.presence?.onStarted?.(() => {
      setReticulumTransportReadyRevision((revision) => revision + 1);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let latestRevision = -1;
    let latestState: 'idle' | 'starting' | 'ready' | 'failed' | undefined;
    const applyReadinessStatus = (status: {
      state: 'idle' | 'starting' | 'ready' | 'failed';
      revision: number;
    }) => {
      if (cancelled || status.revision < latestRevision) {
        return;
      }
      if (
        status.revision === latestRevision &&
        latestState === 'ready' &&
        status.state !== 'ready'
      ) {
        return;
      }
      const becameReady = status.state === 'ready' && latestState !== 'ready';
      latestRevision = status.revision;
      latestState = status.state;
      setReticulumChatReadinessState(status.state);
      if (becameReady) {
        setReticulumTransportReadyRevision((revision) => revision + 1);
      }
    };
    const unsubscribe =
      window.reticulumChat?.onReadinessChanged?.(applyReadinessStatus);

    void window.reticulumChat
      ?.getReadinessStatus?.()
      .then(applyReadinessStatus)
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!myAddress) return;
    if (memberGroupsLoadedAddress !== myAddress) {
      return;
    }
    if (reticulumAdminGroupsLoadedAddress !== myAddress) {
      return;
    }
    const groupIds = getGroupIdsFromGroupLikeList(memberGroupsForReticulum);

    let cancelled = false;
    setReticulumMembershipsAppliedKey('');
    setReticulumSummariesLoadedMembershipKey('');
    void (async () => {
      try {
        if (typeof window.reticulumChat?.isEnabled !== 'function') {
          console.error(
            '[ReticulumChat] Membership sync cannot initialize: isEnabled bridge is unavailable'
          );
          return;
        }
        const enabled = await window.reticulumChat.isEnabled();
        if (cancelled || !enabled) {
          if (!cancelled) {
            reticulumSummariesRefreshSequenceRef.current += 1;
            for (const groupId of reticulumSubscribedGroupIdsRef.current) {
              void window.reticulumChat?.unsubscribeGroup?.(groupId);
            }
            reticulumSubscribedGroupIdsRef.current = new Set();
            void window.reticulumChat?.setLocalGroupMemberships?.([]);
            setReticulumChatSummaries({});
            void window.reticulumChat?.updateMentionBadge?.(0);
          }
          return;
        }
        if (
          typeof window.reticulumChat?.setLocalGroupMemberships !== 'function'
        ) {
          console.error(
            '[ReticulumChat] Membership sync cannot initialize: setLocalGroupMemberships bridge is unavailable'
          );
          return;
        }
        const resolvedReticulumMemberships = await Promise.all(
          reticulumMemberships.map(async (membership) => {
            if (membership.joinedAt || !membership.localAddress) {
              return membership;
            }
            const joinedAt = await resolveReticulumMembershipJoinedAt(
              membership.groupId,
              membership.localAddress
            ).catch(() => null);
            return joinedAt ? { ...membership, joinedAt } : membership;
          })
        );
        if (cancelled) return;
        const membershipResult =
          await window.reticulumChat.setLocalGroupMemberships(
            resolvedReticulumMemberships
          );
        if (cancelled) return;
        if (membershipResult?.success !== true) {
          console.error('[ReticulumChat] Membership sync was rejected', {
            groupCount: groupIds.length,
            failureCode:
              typeof membershipResult?.error === 'string'
                ? membershipResult.error
                : 'unknown',
          });
          return;
        }
        await Promise.all(
          resolvedReticulumMemberships.map(
            ({ groupId, joinedAt, localAddress }) =>
              joinedAt && localAddress
                ? applyReticulumJoinUnreadBaseline({
                    address: localAddress,
                    groupId,
                    joinedAt,
                  })
                : Promise.resolve(false)
          )
        );
        if (cancelled) return;
        setReticulumMembershipsAppliedKey(reticulumMembershipsKey);
        const nextIds = new Set(groupIds);
        const activeSubscriptionIds =
          typeof window.reticulumChat?.getSubscriptions === 'function'
            ? await window.reticulumChat
                .getSubscriptions()
                .catch(() => [] as number[])
            : [];
        if (cancelled) return;
        const previousIds = new Set(
          (Array.isArray(activeSubscriptionIds)
            ? activeSubscriptionIds
            : []
          ).filter((groupId) => Number.isInteger(groupId) && groupId > 0)
        );
        for (const groupId of previousIds) {
          if (!nextIds.has(groupId)) {
            void window.reticulumChat?.unsubscribeGroup?.(groupId);
          }
        }
        for (const groupId of nextIds) {
          if (!previousIds.has(groupId)) {
            void window.reticulumChat?.subscribeGroup?.(groupId);
          }
        }
        reticulumSubscribedGroupIdsRef.current = nextIds;
        if (groupIds.length === 0) {
          reticulumSummariesRefreshSequenceRef.current += 1;
          setReticulumChatSummaries({});
          void window.reticulumChat?.updateMentionBadge?.(0);
          return;
        }
        const summariesLoaded = await refreshReticulumChatSummaries();
        if (cancelled) return;
        if (!summariesLoaded) {
          console.error(
            '[ReticulumChat] Activity dashboard did not load after membership sync',
            { groupCount: groupIds.length }
          );
          return;
        }
        setReticulumSummariesLoadedMembershipKey(reticulumMembershipsKey);
        scheduleReticulumChatSummariesRefresh();
      } catch (error) {
        if (!cancelled) {
          console.error(
            '[ReticulumChat] Membership and activity dashboard initialization failed:',
            error
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    memberGroupsLoadedAddress,
    memberGroupsForReticulum,
    myAddress,
    reticulumAdminGroupsLoadedAddress,
    reticulumMemberships,
    reticulumMembershipsKey,
    reticulumTransportReadyRevision,
    refreshReticulumChatSummaries,
    scheduleReticulumChatSummariesRefresh,
    setReticulumChatSummaries,
  ]);

  useEffect(() => {
    const offSummaryChanged = window.reticulumChat?.onSummaryChanged?.(
      (payload) => {
        const groupId = Number(payload?.groupId);
        if (
          Number.isInteger(groupId) &&
          groupId > 0 &&
          !reticulumSubscribedGroupIdsRef.current.has(groupId)
        ) {
          return;
        }
        scheduleReticulumChatSummariesRefresh();
      }
    );
    const refreshHandler = () => {
      scheduleReticulumChatSummariesRefreshSoon();
    };
    subscribeToEvent('reticulum-chat-summaries-refresh', refreshHandler);
    void refreshReticulumChatSummaries();
    return () => {
      offSummaryChanged?.();
      unsubscribeFromEvent('reticulum-chat-summaries-refresh', refreshHandler);
      for (const timerRef of [
        reticulumSummariesRefreshTimerRef,
        reticulumSummariesSoonRefreshTimerRef,
      ]) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      reticulumSummariesRefreshWindowStartedAtRef.current = null;
      reticulumSummariesSoonRefreshWindowStartedAtRef.current = null;
    };
  }, [
    refreshReticulumChatSummaries,
    scheduleReticulumChatSummariesRefresh,
    scheduleReticulumChatSummariesRefreshSoon,
  ]);

  const refreshReticulumDirectSummaries = useCallback(
    async (enabled = reticulumChatEnabled) => {
      if (!myAddress || !enabled) {
        setReticulumDirectSummaries({});
        return;
      }
      try {
        const summaries =
          await window.reticulumChat?.getDirectSummaries?.(myAddress);
        if (!Array.isArray(summaries)) {
          setReticulumDirectSummaries({});
          return;
        }
        const next = summaries.reduce(
          (acc, summary: any) => {
            const peerAddress = String(summary?.peerAddress || '').trim();
            if (!peerAddress) return acc;
            acc[peerAddress] = summary;
            return acc;
          },
          {} as Record<string, any>
        );
        setReticulumDirectSummaries(next);
      } catch (error) {
        console.error('[ReticulumChat] Failed to refresh DM summaries:', error);
      }
    },
    [myAddress, reticulumChatEnabled, setReticulumDirectSummaries]
  );

  const refreshReticulumDirectSummary = useCallback(
    async (peerAddress: string) => {
      const peer = String(peerAddress || '').trim();
      if (!myAddress || !reticulumChatEnabled || !peer) return;
      try {
        const summaries = await window.reticulumChat?.getDirectSummaries?.(
          myAddress,
          peer
        );
        const summary = Array.isArray(summaries)
          ? summaries.find(
              (candidate: any) =>
                String(candidate?.peerAddress || '').trim() === peer
            )
          : undefined;
        setReticulumDirectSummaries((previous) => {
          const next = { ...previous };
          if (summary) next[peer] = summary;
          else delete next[peer];
          return next;
        });
      } catch (error) {
        console.error('[ReticulumChat] Failed to refresh DM summary:', error);
      }
    },
    [myAddress, reticulumChatEnabled, setReticulumDirectSummaries]
  );

  const scheduleReticulumDirectSummariesRefresh = useCallback(
    (delayMs = 150) => {
      if (reticulumDirectSummariesRefreshTimerRef.current) {
        clearTimeout(reticulumDirectSummariesRefreshTimerRef.current);
      }
      reticulumDirectSummariesRefreshTimerRef.current = setTimeout(() => {
        reticulumDirectSummariesRefreshTimerRef.current = null;
        void refreshReticulumDirectSummaries();
      }, delayMs);
    },
    [refreshReticulumDirectSummaries]
  );

  useEffect(() => {
    let cancelled = false;
    const retryTimers: ReturnType<typeof setTimeout>[] = [];
    void (async () => {
      const enabled = (await window.reticulumChat?.isEnabled?.()) === true;
      if (cancelled) return;
      setReticulumChatEnabled(enabled);
      if (!enabled || !myAddress) {
        setReticulumDirectSummaries({});
        return;
      }
      await refreshReticulumDirectSummaries(true);
      for (const delayMs of [750, 2000, 5000]) {
        retryTimers.push(
          setTimeout(() => {
            if (!cancelled) {
              void refreshReticulumDirectSummaries(true);
            }
          }, delayMs)
        );
      }
    })();
    return () => {
      cancelled = true;
      retryTimers.forEach((timer) => clearTimeout(timer));
      if (reticulumDirectSummariesRefreshTimerRef.current) {
        clearTimeout(reticulumDirectSummariesRefreshTimerRef.current);
        reticulumDirectSummariesRefreshTimerRef.current = null;
      }
    };
  }, [
    myAddress,
    refreshReticulumDirectSummaries,
    setReticulumChatEnabled,
    setReticulumDirectSummaries,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled || !myAddress) return;
    const offSummaryChanged = window.reticulumChat?.onDirectSummaryChanged?.(
      (payload) => {
        if (payload.reason === 'expiry' && payload.peerAddress) {
          void refreshReticulumDirectSummary(payload.peerAddress);
          return;
        }
        scheduleReticulumDirectSummariesRefresh();
      }
    );
    scheduleReticulumDirectSummariesRefresh();
    return () => {
      offSummaryChanged?.();
      if (reticulumDirectSummariesRefreshTimerRef.current) {
        clearTimeout(reticulumDirectSummariesRefreshTimerRef.current);
        reticulumDirectSummariesRefreshTimerRef.current = null;
      }
    };
  }, [
    myAddress,
    refreshReticulumDirectSummary,
    reticulumChatEnabled,
    scheduleReticulumDirectSummariesRefresh,
  ]);

  useEffect(() => {
    if (desktopSideView !== 'directs' || !reticulumChatEnabled || !myAddress) {
      return;
    }
    scheduleReticulumDirectSummariesRefresh();
  }, [
    desktopSideView,
    myAddress,
    reticulumChatEnabled,
    scheduleReticulumDirectSummariesRefresh,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled || !myAddress) return;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      scheduleReticulumDirectSummariesRefresh();
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, [
    myAddress,
    reticulumChatEnabled,
    scheduleReticulumDirectSummariesRefresh,
  ]);

  const refreshHomeDataFunc = useCallback(() => {
    setGroupSection('default');
    setTimeout(() => {
      setGroupSection('home');
    }, 300);
  }, []);

  const getGroupAnnouncements = useCallback(async () => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getGroupNotificationTimestamp')
          .then((response) => {
            if (!response?.error) {
              setGroupAnnouncements(response);
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
    } catch (error) {
      console.log(error);
    }
  }, [t]);

  useEffect(() => {
    if (myAddress) {
      getGroupAnnouncements();
      getTimestampEnterChat();
    }
  }, [myAddress, getGroupAnnouncements, getTimestampEnterChat]);

  const getGroupOwner = useCallback(async (groupId) => {
    if (groupId == '0') return; // general group has id=0
    try {
      const url = `${getBaseApiReact()}/groups/${groupId}`;
      const response = await fetch(url);
      const data = await response.json();

      const name = await getNameInfo(data?.owner);
      if (
        String(selectedGroupRef.current?.groupId || '') !==
        String(groupId || '')
      ) {
        return;
      }
      if (name) {
        data.name = name;
      }
      setGroupOwner(data);
    } catch (error) {
      console.log(error);
    }
  }, []);

  useEffect(() => {
    if (!reticulumChatEnabled) {
      reticulumDirectNameResolutionsRef.current.clear();
      reticulumDirectNameRetryAfterRef.current.clear();
      reticulumDirectNamesByAddressRef.current = {};
      setReticulumDirectNamesByAddress((previous) =>
        Object.keys(previous).length ? {} : previous
      );
      return;
    }

    const knownNames: Record<string, string> = {};
    for (const direct of directs || []) {
      const address = typeof direct?.address === 'string' ? direct.address : '';
      const name = typeof direct?.name === 'string' ? direct.name.trim() : '';
      if (address && name && name !== address) knownNames[address] = name;
    }
    for (const [address, friend] of Object.entries(dmFriendsByAddress || {})) {
      const name = friend?.name?.trim();
      if (address && name) knownNames[address] = name;
    }
    if (Object.keys(knownNames).length) {
      // Reticulum DMs only carry addresses: the avatar prewarm needs names.
      rememberQdnAvatarPrewarmPeerNames(knownNames);
      setReticulumDirectNamesByAddress((previous) => {
        const changed = Object.entries(knownNames).some(
          ([address, name]) => previous[address] !== name
        );
        if (!changed) return previous;
        const next = { ...previous, ...knownNames };
        reticulumDirectNamesByAddressRef.current = next;
        return next;
      });
    }

    const now = Date.now();
    const unresolvedAddresses = Object.values(reticulumDirectSummaries || {})
      .map((summary: any) => String(summary?.peerAddress || '').trim())
      .filter(
        (address) =>
          address &&
          !knownNames[address] &&
          !reticulumDirectNamesByAddressRef.current[address] &&
          !reticulumDirectNameResolutionsRef.current.has(address) &&
          (reticulumDirectNameRetryAfterRef.current.get(address) || 0) <= now
      );
    if (!unresolvedAddresses.length) return;
    unresolvedAddresses.forEach((address) =>
      reticulumDirectNameResolutionsRef.current.add(address)
    );
    void Promise.all(
      unresolvedAddresses.map(async (address) => {
        try {
          const name = await requestQueueMemberNames.enqueue(() =>
            getNameInfo(address)
          );
          return [address, name || null] as const;
        } catch {
          return [address, null] as const;
        } finally {
          reticulumDirectNameResolutionsRef.current.delete(address);
        }
      })
    ).then((resolved) => {
      const entries = resolved.filter(
        (entry): entry is readonly [string, string] => Boolean(entry[1])
      );
      for (const [address, name] of resolved) {
        if (name) {
          reticulumDirectNameRetryAfterRef.current.delete(address);
        } else {
          reticulumDirectNameRetryAfterRef.current.set(
            address,
            Date.now() + RETICULUM_DIRECT_NAME_RETRY_DELAY_MS
          );
        }
      }
      if (!entries.length) return;
      rememberQdnAvatarPrewarmPeerNames(Object.fromEntries(entries));
      setReticulumDirectNamesByAddress((previous) => {
        const additions = Object.fromEntries(entries);
        const changed = Object.entries(additions).some(
          ([address, name]) => previous[address] !== name
        );
        if (!changed) return previous;
        const next = { ...previous, ...additions };
        reticulumDirectNamesByAddressRef.current = next;
        return next;
      });
    });
  }, [
    directs,
    dmFriendsByAddress,
    reticulumChatEnabled,
    reticulumDirectSummaries,
  ]);

  const reticulumDirectRows = useMemo(() => {
    if (!reticulumChatEnabled) return [];
    const rows = Object.values(reticulumDirectSummaries || {})
      .map((summary: any) => {
        const peerAddress = String(summary?.peerAddress || '').trim();
        const lastEvent = summary?.lastEvent || null;
        const lastCall = summary?.lastCall || null;
        const silenced = summary?.silenced === true;
        if (
          !validateAddress(peerAddress) ||
          (!lastEvent && !lastCall && !silenced)
        )
          return null;
        const friend = dmFriendsByAddress?.[peerAddress];
        const resolvedName =
          friend?.name || reticulumDirectNamesByAddress[peerAddress];
        return {
          address: peerAddress,
          name: resolvedName || peerAddress,
          timestamp: Number(
            summary?.updatedAt || lastCall?.endedAt || lastEvent?.timestamp || 0
          ),
          sender: lastEvent?.senderAddress || '',
          senderName:
            lastEvent?.senderAddress === myAddress
              ? userInfo?.name
              : resolvedName || peerAddress,
          reticulumDirect: true,
          reticulumSilenced: silenced,
          unreadCount: Number(summary?.unreadCount || 0),
          unreadMissedCallCount: Number(summary?.unreadMissedCallCount || 0),
          lastCall,
          lastMessageTimestamp: Number(lastEvent?.timestamp || 0),
        };
      })
      .filter(Boolean);
    if (!validateAddress(myAddress)) return rows;
    const savedSummary = reticulumDirectSummaries?.[myAddress];
    const savedLastEvent = savedSummary?.lastEvent || null;
    return [
      {
        address: myAddress,
        name: 'Saved Messages',
        timestamp: Number(
          savedSummary?.updatedAt || savedLastEvent?.timestamp || 0
        ),
        sender: myAddress,
        senderName: userInfo?.name || myAddress,
        reticulumDirect: true,
        savedMessages: true,
        unreadCount: 0,
      },
      ...rows.filter((row: any) => row?.address !== myAddress),
    ];
  }, [
    dmFriendsByAddress,
    myAddress,
    reticulumChatEnabled,
    reticulumDirectSummaries,
    reticulumDirectNamesByAddress,
    userInfo?.name,
  ]);

  const mergedDirectRows = useMemo(() => {
    if (reticulumChatEnabled) return reticulumDirectRows;
    return directs;
  }, [directs, reticulumChatEnabled, reticulumDirectRows]);

  const directChatHasUnread = useMemo(() => {
    let hasUnread = false;
    mergedDirectRows.forEach((direct) => {
      if (
        Number(direct?.unreadCount || 0) > 0 ||
        (!reticulumChatEnabled &&
          direct?.sender !== myAddress &&
          direct?.timestamp &&
          ((!timestampEnterData[direct?.address] &&
            Date.now() - direct?.timestamp <
              timeDifferenceForNotificationChats) ||
            timestampEnterData[direct?.address] < direct?.timestamp))
      ) {
        hasUnread = true;
      }
    });
    return hasUnread;
  }, [timestampEnterData, mergedDirectRows, myAddress, reticulumChatEnabled]);

  const reticulumDirectUnreadCount = useMemo(() => {
    if (!reticulumChatEnabled) return 0;
    return mergedDirectRows.reduce(
      (total, direct) => total + Math.max(0, Number(direct?.unreadCount || 0)),
      0
    );
  }, [mergedDirectRows, reticulumChatEnabled]);

  const displayDirects = useMemo(() => {
    if (reticulumChatEnabled) {
      const merged = mergeDirectsWithFriends(
        mergedDirectRows,
        dmFriendsByAddress,
        myAddress,
        userInfo?.name
      );
      return merged.sort((a: any, b: any) => {
        if (a?.savedMessages !== b?.savedMessages) {
          return a?.savedMessages ? -1 : 1;
        }
        const timestampA = Number(a?.timestamp || 0);
        const timestampB = Number(b?.timestamp || 0);
        if (timestampA !== timestampB) return timestampB - timestampA;
        return String(a?.name || a?.address || '').localeCompare(
          String(b?.name || b?.address || '')
        );
      });
    }
    const merged = mergeDirectsWithFriends(
      mergedDirectRows,
      dmFriendsByAddress,
      myAddress,
      userInfo?.name
    );
    return merged;
  }, [
    mergedDirectRows,
    dmFriendsByAddress,
    myAddress,
    reticulumChatEnabled,
    userInfo?.name,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled || desktopSideView !== 'directs') return;
    // Desktop keeps a conversation open next to the DM list. On phones the
    // conversation replaces the list, so auto-selecting would make the list —
    // and the back gesture out of a thread — unreachable.
    if (isMobile) return;
    if (selectedDirect || newChat) return;
    const firstDirect = displayDirects[0];
    if (!firstDirect?.address) {
      return;
    }
    setSelectedDirect(firstDirect);
    window
      .sendMessage('addTimestampEnterChat', {
        timestamp: Date.now(),
        groupId: firstDirect.address,
      })
      .catch((error) => {
        console.error(
          'Failed to add timestamp:',
          error.message || 'An error occurred'
        );
      });
    getTimestampEnterChat();
  }, [
    desktopSideView,
    displayDirects,
    getTimestampEnterChat,
    isMobile,
    newChat,
    reticulumChatEnabled,
    selectedDirect,
  ]);

  const getSecretKey = useCallback(
    async (loadingGroupParam?: boolean, secretKeyToPublish?: boolean) => {
      const useLegacyGroupKeyLoading = !reticulumChatEnabled;
      try {
        if (useLegacyGroupKeyLoading) {
          setIsLoadingGroupMessage(
            t('auth:message.generic.locating_encryption_keys', {
              postProcess: 'capitalizeFirstChar',
            })
          );
          pauseAllQueues();
        }

        let dataFromStorage;
        let publishFromStorage;
        let adminsFromStorage;

        if (
          secretKeyToPublish &&
          secretKeyRef.current &&
          lastFetchedSecretKey.current &&
          Date.now() - lastFetchedSecretKey.current <
            TIME_MINUTES_10_IN_MILLISECONDS
        ) {
          return secretKeyRef.current;
        }

        if (loadingGroupParam && useLegacyGroupKeyLoading) {
          setIsLoadingGroup(true);
        }

        if (selectedGroup?.groupId !== selectedGroupRef.current.groupId) {
          if (settimeoutForRefetchSecretKey.current) {
            clearTimeout(settimeoutForRefetchSecretKey.current);
          }
          return;
        }

        const prevGroupId = selectedGroupRef.current.groupId;
        const selectedGroupIsCurrent = () =>
          String(selectedGroupRef.current?.groupId || '') ===
          String(prevGroupId || '');

        const { names, addresses, both } =
          adminsFromStorage || (await getGroupAdmins(selectedGroup?.groupId));
        if (!selectedGroupIsCurrent()) return;
        setAdmins(addresses);
        setAdminsWithNames(both);

        if (!names.length) throw new Error('Network error');

        const publish =
          publishFromStorage ||
          (await getPublishesFromAdmins(names, selectedGroup?.groupId));

        if (!selectedGroupIsCurrent()) {
          if (settimeoutForRefetchSecretKey.current) {
            clearTimeout(settimeoutForRefetchSecretKey.current);
          }
          return;
        }

        if (publish === false) {
          setTriedToFetchSecretKey(true);
          if (
            groupSectionUsesSecretKey(
              reticulumChatEnabled,
              groupSectionRef.current || ''
            )
          ) {
            settimeoutForRefetchSecretKey.current = setTimeout(() => {
              getSecretKey();
            }, TIME_MINUTES_2_IN_MILLISECONDS);
          }
          return false;
        }

        setSecretKeyPublishDate(publish?.updated || publish?.created);

        // Skip the (slow) encryption-key download when our persisted copy
        // matches the latest published key. Fixes re-entering a group always
        // re-downloading keys, and lets the chat paint immediately. The publish
        // metadata comparison keeps us correct across key rotations. Only for
        // the display path — sending always uses a freshly fetched key.
        if (!secretKeyToPublish && publish) {
          const cached: any = await window
            .sendMessage('getGroupDataSingle', {
              groupId: selectedGroup?.groupId,
            })
            .catch(() => null);
          const cachedPublish = cached?.secretKeyResource;
          if (
            cached?.secretKeyData &&
            !cached?.error &&
            cachedPublish &&
            cachedPublish.identifier === publish.identifier &&
            cachedPublish.name === publish.name &&
            (cachedPublish.updated || cachedPublish.created) ===
              (publish.updated || publish.created)
          ) {
            dataFromStorage = cached.secretKeyData;
          }
        }

        let data;
        if (dataFromStorage) {
          data = dataFromStorage;
        } else {
          if (useLegacyGroupKeyLoading) {
            setIsLoadingGroupMessage(
              t('auth:message.generic.downloading_encryption_keys', {
                postProcess: 'capitalizeFirstChar',
              })
            );
          }
          const res = await fetch(
            `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${publish.identifier}?encoding=base64&rebuild=true`
          );
          data = await res.text();
        }

        const decryptedKey: any = await decryptResource(data, null);
        const dataint8Array = base64ToUint8Array(decryptedKey.data);
        const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);

        if (!validateSecretKey(decryptedKeyToObject)) {
          throw new Error('SecretKey is not valid');
        }
        if (!selectedGroupIsCurrent()) return;

        setSecretKeyDetails(publish);
        setSecretKey(decryptedKeyToObject);
        lastFetchedSecretKey.current = Date.now();
        setMemberCountFromSecretKeyData(decryptedKey.count);

        window
          .sendMessage('setGroupData', {
            groupId: selectedGroup?.groupId,
            secretKeyData: data,
            secretKeyResource: publish,
            admins: { names, addresses, both },
          })
          .catch((error) => {
            console.error(
              'Failed to set group data:',
              error.message || 'An error occurred'
            );
          });

        if (decryptedKeyToObject) {
          secretKeyAuthRetriesRef.current = 0;
          setTriedToFetchSecretKey(true);
          setFirstSecretKeyInCreation(false);
          return decryptedKeyToObject;
        } else {
          setTriedToFetchSecretKey(true);
        }
      } catch (error) {
        const errStr =
          typeof error === 'string'
            ? error
            : (error as { message?: string })?.message || '';
        if (
          error === 'Unable to decrypt data' ||
          error === 'Unable to decrypt'
        ) {
          setTriedToFetchSecretKey(true);
          if (
            groupSectionUsesSecretKey(
              reticulumChatEnabled,
              groupSectionRef.current || ''
            )
          ) {
            settimeoutForRefetchSecretKey.current = setTimeout(() => {
              getSecretKey();
            }, TIME_MINUTES_2_IN_MILLISECONDS);
          }
        } else if (/not authenticated|wallet|keypair|key pair/i.test(errStr)) {
          // First-launch race: the wallet keyPair may not be stored yet when
          // the group view mounts (decrypt needs it). Retry quickly a few
          // times instead of leaving the chat permanently empty until the user
          // restarts the app.
          if (secretKeyAuthRetriesRef.current < 6) {
            secretKeyAuthRetriesRef.current += 1;
            settimeoutForRefetchSecretKey.current = setTimeout(() => {
              getSecretKey();
            }, 1500);
          } else {
            setTriedToFetchSecretKey(true);
          }
        }
      } finally {
        if (useLegacyGroupKeyLoading) {
          setIsLoadingGroup(false);
          setIsLoadingGroupMessage('');
          resumeAllQueues();
        }
      }
    },
    [
      selectedGroup?.groupId,
      setIsLoadingGroup,
      setIsLoadingGroupMessage,
      setSecretKey,
      setSecretKeyDetails,
      setTriedToFetchSecretKey,
      setFirstSecretKeyInCreation,
      setMemberCountFromSecretKeyData,
      setAdmins,
      setAdminsWithNames,
      setSecretKeyPublishDate,
      reticulumChatEnabled,
    ]
  );

  /** Fetch secret key for an arbitrary group (e.g. for widget). Same flow as full chat: try cache, then network; cache on success; retry on decrypt failure. */
  const getSecretKeyForGroup = useCallback(
    async (group: { groupId: string } | null): Promise<any> => {
      if (!group?.groupId) return null;
      const groupIdStr = String(group.groupId);
      try {
        // 1. Try cached key (same as full chat when it would use storage)
        const cached: any = await window
          .sendMessage('getGroupDataSingle', { groupId: groupIdStr })
          .catch(() => null);
        if (cached?.secretKeyData && !cached?.error) {
          try {
            const decryptedKey: any = await decryptResource(
              cached.secretKeyData,
              null
            );
            const dataint8Array = base64ToUint8Array(decryptedKey.data);
            const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
            if (validateSecretKey(decryptedKeyToObject))
              return decryptedKeyToObject;
          } catch {
            // Cached key invalid or decrypt failed, fall through to fetch
          }
        }

        // 2. Fetch from network (same as full getSecretKey)
        const groupIdNum = Number(group.groupId);
        const { names, addresses, both } = await getGroupAdmins(groupIdNum);
        if (!names?.length) return null;
        const publish = await getPublishesFromAdmins(names, groupIdStr);
        if (publish === false) {
          return new Promise((resolve) => {
            setTimeout(
              () => resolve(getSecretKeyForGroup(group)),
              TIME_MINUTES_2_IN_MILLISECONDS
            );
          });
        }
        const res = await fetch(
          `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${publish.identifier}?encoding=base64&rebuild=true`
        );
        const data = await res.text();
        const decryptedKey: any = await decryptResource(data, null);
        const dataint8Array = base64ToUint8Array(decryptedKey.data);
        const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
        if (!validateSecretKey(decryptedKeyToObject)) return null;

        // 3. Cache for next time (same as full chat setGroupData)
        window
          .sendMessage('setGroupData', {
            groupId: groupIdStr,
            secretKeyData: data,
            secretKeyResource: publish,
            admins: { names, addresses, both },
          })
          .catch(() => {});

        return decryptedKeyToObject;
      } catch (e) {
        if (e === 'Unable to decrypt data') {
          return new Promise((resolve) => {
            setTimeout(
              () => resolve(getSecretKeyForGroup(group)),
              TIME_MINUTES_2_IN_MILLISECONDS
            );
          });
        }
        console.error(e);
        return null;
      }
    },
    []
  );

  const getReticulumMentionNameMap = useCallback(
    async (groupId: number): Promise<Map<string, string>> => {
      const cached = reticulumGroupMentionNameCacheRef.current.get(groupId);
      if (cached) return cached;
      const map = new Map<string, string>();
      let loadedMembers = false;
      try {
        const data = await getGroupMembers(groupId);
        loadedMembers = true;
        if (Array.isArray(data?.members)) {
          for (const member of data.members) {
            const address =
              typeof member?.member === 'string' ? member.member.trim() : '';
            const name =
              typeof member?.primaryName === 'string'
                ? member.primaryName.trim()
                : '';
            if (address && name) map.set(name.toLowerCase(), address);
          }
        }
      } catch (error) {
        console.error(
          '[ReticulumChat] Failed to load members for background mentions:',
          error
        );
      }
      if (myAddress && userInfo?.name) {
        map.set(String(userInfo.name).toLowerCase(), myAddress);
      }
      if (loadedMembers) {
        reticulumGroupMentionNameCacheRef.current.set(groupId, map);
      }
      return map;
    },
    [myAddress, userInfo?.name]
  );

  // Keyed on which groups, not on the list object, which is rebuilt often.
  const reticulumMentionNameCacheGroupsKey = useMemo(
    () =>
      getGroupIdsFromGroupLikeList(memberGroupsForReticulum)
        .sort((left, right) => left - right)
        .join(','),
    [memberGroupsForReticulum]
  );
  useEffect(() => {
    reticulumGroupMentionNameCacheRef.current.clear();
  }, [reticulumMentionNameCacheGroupsKey, myAddress, userInfo?.name]);

  const recordReticulumMentionNotification = useCallback(
    (
      event: ReticulumBackgroundEvent,
      groupId: number,
      mentionedAddresses: string[]
    ) => {
      const eventId = String(event?.eventId || '');
      if (
        event.eventType === 'edit' ||
        event.readByOwner === true ||
        !eventId ||
        !myAddressRef.current ||
        event.authorAddress === myAddressRef.current ||
        !mentionedAddresses.includes(myAddressRef.current)
      ) {
        return;
      }

      const group = memberGroupsRef.current?.find(
        (item: any) => Number(item?.groupId) === groupId
      );
      const groupName =
        group?.groupName || group?.name || `Group ${String(groupId)}`;
      const channelId = String(event.channelId || 'general');
      const timestamp = Number(event.timestamp || Date.now());

      void mutedGroupsLoadedRef.current.then(() => {
        if (isGroupMuted(mutedGroupsRef.current, groupId)) return;
        executeEvent('q-chat-mention-notification', {
          channelId,
          eventId,
          groupId,
          groupName,
          timestamp,
        });
      });
    },
    []
  );

  const processReticulumBackgroundEvent = useCallback(
    (
      event: ReticulumBackgroundEvent,
      options: { recordMentionNotification?: boolean } = {}
    ): Promise<void> =>
      processReticulumBackgroundIndexEvent(event, options, {
        tracker: reticulumBackgroundEventTracker,
        bridge: window.reticulumChat,
        isGroupReady: (groupId) => {
          const groupProperty = groupsPropertiesRef.current?.[
            String(groupId)
          ] as { isOpen?: boolean } | undefined;
          return (
            groupProperty?.isOpen === true || groupProperty?.isOpen === false
          );
        },
        mentionedAddresses: async (payload, groupId) => {
          const mentionMap = await getReticulumMentionNameMap(groupId);
          return [
            ...new Set([
              ...reticulumMentionedAddressesFromPayload(payload),
              ...resolveReticulumMentionAddressesFromPayload(
                payload,
                mentionMap
              ),
            ]),
          ];
        },
        notificationAddresses: (backgroundEvent) => {
          const localAddress = myAddressRef.current || '';
          const authorizedBroadcast =
            authorizedReticulumBroadcastApplies(backgroundEvent);
          const directMention =
            backgroundEvent.directMentionAuthorized === true;
          return localAddress && (authorizedBroadcast || directMention)
            ? [localAddress]
            : [];
        },
        recordMentionNotification: recordReticulumMentionNotification,
        scheduleSummaryRefresh: scheduleReticulumChatSummariesRefresh,
      }),
    [
      getReticulumMentionNameMap,
      recordReticulumMentionNotification,
      reticulumBackgroundEventTracker,
      scheduleReticulumChatSummariesRefresh,
    ]
  );

  useEffect(() => {
    if (!myAddress) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const enabled = await window.reticulumChat?.isEnabled?.();
      if (cancelled || enabled !== true) return;
      unsubscribe = window.reticulumChat?.onEvent?.((payload) => {
        const event = payload?.event as ReticulumBackgroundEvent | undefined;
        if (!event?.eventId) return;
        void processReticulumBackgroundEvent(event, {
          recordMentionNotification: true,
        }).catch((error) => {
          console.error(
            '[ReticulumChat] Background event processing failed:',
            error
          );
        });
      });
      if (cancelled) unsubscribe?.();
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [myAddress, processReticulumBackgroundEvent]);

  const prefetchedReticulumHistoryGroupsRef = useRef<Set<number>>(new Set());
  const reticulumBackgroundHistoryGroupsKey = useMemo(() => {
    const groupIds = getGroupIdsFromGroupLikeList(memberGroupsForReticulum);
    // Wait until open/closed is known so indexing does not no-op, but keep the
    // key stable once membership + readiness settle (groupsProperties object
    // identity churn must not re-stampede getHistory for every group).
    return groupIds
      .filter((groupId) => {
        const property = groupsProperties?.[String(groupId)] as
          | { isOpen?: boolean }
          | undefined;
        return property?.isOpen === true || property?.isOpen === false;
      })
      .sort((left, right) => left - right)
      .join(',');
  }, [groupsProperties, memberGroupsForReticulum]);

  useEffect(() => {
    prefetchedReticulumHistoryGroupsRef.current.clear();
  }, [myAddress]);

  // GO reads the summaries to skip unchanged groups, so it waits until they
  // are loaded for the memberships the engine has now (a group missing from
  // them then really has no chat message). Desktop does not wait.
  const reticulumPrefetchSummariesReady =
    !isGoApp() ||
    (reticulumSummariesLoadedMembershipKey !== '' &&
      reticulumSummariesLoadedMembershipKey === reticulumMembershipsKey);

  useEffect(() => {
    if (!myAddress || !reticulumBackgroundHistoryGroupsKey) return;
    if (!reticulumPrefetchSummariesReady) return;
    const groupIds = reticulumBackgroundHistoryGroupsKey
      .split(',')
      .map((value) => Number(value))
      .filter((groupId) => Number.isInteger(groupId) && groupId > 0);
    if (groupIds.length === 0) return;
    let cancelled = false;
    const goPrefetch = isGoApp();
    void (async () => {
      try {
        const enabled = await window.reticulumChat?.isEnabled?.();
        if (cancelled || enabled !== true) return;
        if (goPrefetch) {
          // A safety net, not urgent: never compete with the first screen.
          await waitForReticulumPrefetchFirstPaintThenIdle();
          if (cancelled) return;
        }
        await prefetchReticulumBackgroundHistory<ReticulumBackgroundEvent>({
          groupIds,
          getHistory: async (groupId) =>
            window.reticulumChat?.getHistory?.(groupId, 'general', 50, {
              repairNetwork: false,
            }),
          processEvent: (event) => processReticulumBackgroundEvent(event),
          isCancelled: () => cancelled,
          isPrefetched: (groupId) =>
            prefetchedReticulumHistoryGroupsRef.current.has(groupId),
          markPrefetched: (groupId) => {
            prefetchedReticulumHistoryGroupsRef.current.add(groupId);
          },
          // GO: the engine indexes on insert, so each start only re-indexes
          // messages newer than the last run (per account and group),
          // instead of 50 messages of every group.
          watermarkAddress: goPrefetch ? myAddress : null,
          // GO: a group whose newest 'general' message (summaries, read
          // fresh per group) is not past its watermark needs no getHistory.
          // An emptied atom counts as unknown (read history).
          newestKnownTimestamp: goPrefetch
            ? (groupId) =>
                newestKnownReticulumPrefetchTimestamp(
                  jotaiStore.get(reticulumChatSummariesAtom),
                  groupId
                )
            : undefined,
          concurrency: goPrefetch ? RETICULUM_GO_PREFETCH_CONCURRENCY : 1,
          beforeGroup: goPrefetch
            ? () => waitForReticulumPrefetchIdle()
            : undefined,
          onGroupError: (groupId, error) => {
            // Timeouts after a long chat session are recoverable; never let
            // them become an unhandled rejection / full-screen runtime fault.
            console.warn(
              '[ReticulumChat] Background history prefetch failed:',
              groupId,
              error
            );
          },
        });
      } catch (error) {
        console.warn(
          '[ReticulumChat] Background history prefetch aborted:',
          error
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    jotaiStore,
    myAddress,
    processReticulumBackgroundEvent,
    reticulumBackgroundHistoryGroupsKey,
    reticulumPrefetchSummariesReady,
  ]);

  const getAdminsForGroup = useCallback(async (selectedGroup) => {
    try {
      const groupId = selectedGroup?.groupId;
      const { names, addresses, both } = await getGroupAdmins(groupId);
      if (
        String(selectedGroupRef.current?.groupId || '') !==
        String(groupId || '')
      ) {
        return;
      }
      setAdmins(addresses);
      setAdminsWithNames(both);
    } catch (error) {
      console.log(error);
    }
  }, []);

  useEffect(() => {
    if (selectedGroup && isPrivate !== null) {
      if (isPrivate) {
        if (shouldLoadSecretKeyOnGroupEntry(reticulumChatEnabled, isPrivate)) {
          setTriedToFetchSecretKey(false);
          getSecretKey(true);
        } else {
          // Reticulum group chat authorizes private-group access through Core
          // membership. Load role metadata here, but leave the legacy group key
          // to the Threads view that still needs it.
          getAdminsForGroup(selectedGroup);
        }
      }

      getGroupOwner(selectedGroup?.groupId);
    }
    if (isPrivate === false) {
      setTriedToFetchSecretKey(true);
      if (selectedGroup?.groupId !== '0') {
        getAdminsForGroup(selectedGroup);
      }
    }
  }, [
    selectedGroup,
    isPrivate,
    reticulumChatEnabled,
    getSecretKey,
    getGroupOwner,
    getAdminsForGroup,
  ]);

  useEffect(() => {
    if (
      !shouldLoadSecretKeyForSection(
        reticulumChatEnabled,
        isPrivate === true,
        groupSection
      ) ||
      !selectedGroup?.groupId ||
      secretKey
    ) {
      return;
    }

    const groupId = String(selectedGroup.groupId);
    if (threadKeyLoadRef.current?.groupId === groupId) return;
    const request = { groupId };
    threadKeyLoadRef.current = request;
    setTriedToFetchSecretKey(false);
    setIsLoadingThreadKey(true);

    void getSecretKey(false).finally(() => {
      if (threadKeyLoadRef.current !== request) return;
      if (String(selectedGroupRef.current?.groupId || '') === groupId) {
        setTriedToFetchSecretKey(true);
        setIsLoadingThreadKey(false);
      }
      threadKeyLoadRef.current = null;
    });
  }, [
    getSecretKey,
    groupSection,
    isPrivate,
    reticulumChatEnabled,
    secretKey,
    selectedGroup?.groupId,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled || groupSection === 'forum') return;
    if (settimeoutForRefetchSecretKey.current) {
      clearTimeout(settimeoutForRefetchSecretKey.current);
      settimeoutForRefetchSecretKey.current = null;
    }
  }, [groupSection, reticulumChatEnabled]);

  const getCountNewMesg = async (groupId, after) => {
    try {
      const response = await fetch(
        `${getBaseApiReact()}/chat/messages?after=${after}&txGroupId=${groupId}&haschatreference=false&encoding=BASE64&limit=1`
      );
      const data = await response.json();
      if (data && data[0]) return data[0].timestamp;
    } catch (error) {
      console.log(error);
    }
  };

  const getLatestRegularChat = useCallback(async (groups) => {
    try {
      // Reticulum derives unread state from local summaries, so these legacy
      // per-group `/chat/messages` probes are pure startup cost — one request
      // per joined group before the chat list can settle.
      if (reticulumChatEnabledRef.current) return;
      const groupData = {};

      const getGroupData = groups.map(async (group) => {
        if (!group.groupId || !group?.timestamp) return null;
        if (
          !groupData[group.groupId] ||
          groupData[group.groupId] < group.timestamp
        ) {
          const hasMoreRecentMsg = await getCountNewMesg(
            group.groupId,
            timestampEnterDataRef.current[group?.groupId] ||
              Date.now() - TIME_DAYS_1_IN_MILLISECONDS
          );
          if (hasMoreRecentMsg) {
            groupData[group.groupId] = hasMoreRecentMsg;
          }
        } else {
          return null;
        }
      });

      await Promise.all(getGroupData);
      setGroupChatTimestamps(groupData);
    } catch (error) {
      console.log(error);
    }
  }, []);

  useEffect(() => {
    groupsPropertiesRef.current = groupsProperties;
  }, [groupsProperties]);

  const getGroupsProperties = useCallback(
    async (address) => {
      try {
        const url = `${getBaseApiReact()}/groups/member/${address}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Cannot get group properties');
        const data = await response.json();
        const transformToObject = data.reduce((result, item) => {
          result[item.groupId] = item;
          return result;
        }, {});
        setGroupsProperties(transformToObject);

        const ownerNamesFromApi: Record<string, string> = {};
        const addressesToResolve: string[] = [];

        Object.keys(transformToObject).forEach((key) => {
          const item = transformToObject[key];
          const primary = item?.ownerPrimaryName?.trim();
          if (primary) {
            ownerNamesFromApi[key] = primary;
            groupsOwnerNamesRef.current[key] = primary;
            return;
          }
          const ownerAddress =
            typeof item?.owner === 'string' ? item.owner.trim() : '';
          if (ownerAddress) {
            addressesToResolve.push(ownerAddress);
          }
        });

        if (addressesToResolve.length > 0) {
          try {
            const namesByAddress =
              await getPrimaryNamesForAddresses(addressesToResolve);
            Object.keys(transformToObject).forEach((key) => {
              if (ownerNamesFromApi[key]) return;
              const ownerAddress = transformToObject[key]?.owner;
              const resolved = namesByAddress[ownerAddress]?.trim();
              if (resolved) {
                ownerNamesFromApi[key] = resolved;
                groupsOwnerNamesRef.current[key] = resolved;
              }
            });
          } catch (resolveError) {
            console.log(resolveError);
          }
        }

        if (Object.keys(ownerNamesFromApi).length > 0) {
          setGroupsOwnerNames((prev) => ({ ...prev, ...ownerNamesFromApi }));
        }
      } catch (error) {
        console.log(error);
      }
    },
    [setGroupsOwnerNames, setGroupsProperties]
  );

  const getGroupsWhereIAmAMember = useCallback(
    async (_groups) => {
      if (!myAddress) return false;
      const requestedAddress = myAddress;
      try {
        // Times out after 15 s, so a stalled node counts as a failure.
        const groupsAsAdmin = await fetchReticulumAdminGroups(
          `${getBaseApiReact()}/groups/member/${requestedAddress}?adminOnly=true`
        );
        if (myAddressRef.current !== requestedAddress) return false;
        noteReticulumAdminListFetchOk();
        setMyGroupsWhereIAmAdmin((current) =>
          areKeysEqual(
            getGroupIdsFromGroupLikeList(current),
            getGroupIdsFromGroupLikeList(groupsAsAdmin)
          )
            ? current
            : groupsAsAdmin
        );
        setReticulumAdminGroupsLoadedAddress(requestedAddress);
        reticulumAdminListOkAddressRef.current = requestedAddress;
        setReticulumAdminListOkAddress(requestedAddress);
        return true;
      } catch (error) {
        console.error(
          '[ReticulumChat] Failed to load admin-group metadata required by membership sync:',
          error
        );
        if (myAddressRef.current === requestedAddress) {
          noteReticulumAdminListFetchFailed(error);
          // Keep the last good list for this account; before the first one
          // the list is empty and pushed as non-authoritative, so the engine
          // asks Core instead of reading "not admin" from it.
          const listLoadedForAccount =
            reticulumAdminListOkAddressRef.current === requestedAddress;
          setMyGroupsWhereIAmAdmin((current) =>
            reticulumAdminGroupsAfterFailedFetch(current, listLoadedForAccount)
          );
          setReticulumAdminGroupsLoadedAddress(requestedAddress);
        }
        return false;
      }
    },
    [myAddress, setMyGroupsWhereIAmAdmin]
  );

  useEffect(() => {
    // Handler function for incoming messages
    const messageHandler = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const message = event.data;
      if (message?.action === 'SET_GROUPS') {
        const sortedFiltered = applyPinnedGroupOrder(
          sortArrayByTimestampAndGroupName(message.payload || []).filter(
            (item: any) => item?.groupId !== '0'
          )
        );
        setMemberGroups(sortedFiltered);
        if (myAddressRef.current) {
          setMemberGroupsLoadedAddress(myAddressRef.current);
        }
        memberGroupsRef.current = sortedFiltered;
        getLatestRegularChat(sortedFiltered);

        // Only mark messages as read if user is actually viewing the chat
        if (
          selectedGroupRef.current &&
          groupSectionRef.current === 'chat' &&
          (desktopViewModeRef.current === 'chat' ||
            qChatTabActiveRef.current ||
            mobileViewModeRef.current === 'chat')
        ) {
          window
            .sendMessage('addTimestampEnterChat', {
              timestamp: Date.now(),
              groupId: selectedGroupRef.current.groupId,
            })
            .catch((error) => {
              console.error(
                'Failed to add timestamp:',
                error.message || 'An error occurred'
              );
            });
        }

        // Only mark direct messages as read if user is actually viewing the chat
        if (
          selectedDirectRef.current &&
          (desktopViewModeRef.current === 'chat' ||
            qChatTabActiveRef.current ||
            mobileViewModeRef.current === 'chat')
        ) {
          window
            .sendMessage('addTimestampEnterChat', {
              timestamp: Date.now(),
              groupId: selectedDirectRef.current.address,
            })
            .catch((error) => {
              console.error(
                'Failed to add timestamp:',
                error.message || 'An error occurred'
              );
            });
        }

        setTimeout(() => {
          getTimestampEnterChat();
        }, 600);
      }

      if (message?.action === 'SET_GROUP_ANNOUNCEMENTS') {
        // Update the component state with the received 'sendqort' state
        setGroupAnnouncements(message.payload);

        // Only mark announcements as read if user is actually viewing the announcement section
        if (
          selectedGroupRef.current &&
          groupSectionRef.current === 'announcement' &&
          (desktopViewModeRef.current === 'chat' ||
            qChatTabActiveRef.current ||
            mobileViewModeRef.current === 'group')
        ) {
          window
            .sendMessage('addGroupNotificationTimestamp', {
              timestamp: Date.now(),
              groupId: selectedGroupRef.current.groupId,
            })
            .catch((error) => {
              console.error(
                'Failed to add group notification timestamp:',
                error.message || 'An error occurred'
              );
            });

          setTimeout(() => {
            getGroupAnnouncements();
          }, 200);
        }
      }

      if (message?.action === 'SET_DIRECTS') {
        setDirects(message.payload);
        setMemberDirects(message.payload ?? []);
      } else if (message?.action === 'PLAY_NOTIFICATION_SOUND') {
        // audio.play();
      }
    };

    // Attach the event listener
    window.addEventListener('message', messageHandler);

    // Clean up the event listener on component unmount
    return () => {
      window.removeEventListener('message', messageHandler);
    };
  }, []);

  const getMembers = useCallback(async (groupId) => {
    try {
      const res = await getGroupMembers(groupId);
      if (groupId !== selectedGroupRef.current?.groupId) return;
      setMembers(res);
    } catch (error) {
      console.log(error);
    }
  }, []);

  useEffect(() => {
    if (
      !initiatedGetMembers.current &&
      selectedGroup?.groupId &&
      secretKey &&
      admins.includes(myAddress) &&
      selectedGroup?.groupId !== '0'
    ) {
      // getAdmins(selectedGroup?.groupId);
      getMembers(selectedGroup?.groupId);
      initiatedGetMembers.current = true;
    }
  }, [selectedGroup?.groupId, secretKey, myAddress, admins]);

  const shouldReEncrypt = useMemo(() => {
    if (triedToFetchSecretKey && !secretKeyPublishDate) return true;
    if (
      !secretKeyPublishDate ||
      !memberCountFromSecretKeyData ||
      members?.length === 0
    )
      return false;
    const isDiffMemberNumber =
      memberCountFromSecretKeyData !== members?.memberCount &&
      newEncryptionNotification?.decryptedData?.data?.numberOfMembers !==
        members?.memberCount;

    if (isDiffMemberNumber) return true;

    const latestJoined = members?.members.reduce((maxJoined, current) => {
      return current.joined > maxJoined ? current.joined : maxJoined;
    }, members?.members[0].joined);

    if (
      secretKeyPublishDate < latestJoined &&
      newEncryptionNotification?.data?.timestamp < latestJoined
    ) {
      return true;
    }
    return false;
  }, [
    memberCountFromSecretKeyData,
    members,
    secretKeyPublishDate,
    newEncryptionNotification,
    triedToFetchSecretKey,
  ]);

  const notifyAdmin = useCallback(
    async (admin) => {
      try {
        setIsLoadingNotifyAdmin(true);
        await new Promise((res, rej) => {
          window
            .sendMessage('notifyAdminRegenerateSecretKey', {
              adminAddress: admin.address,
              groupName: selectedGroup?.groupName,
            })
            .then((response) => {
              if (!response?.error) {
                res(response);
                return;
              }
              rej(response.error);
            })
            .catch((error) => {
              rej(
                error.message ||
                  t('core:message.error.generic', {
                    postProcess: 'capitalizeFirstChar',
                  })
              );
            });
        });
        setInfoSnack({
          type: 'success',
          message: 'Successfully sent notification.',
        });
        setOpenSnack(true);
      } catch (error) {
        setInfoSnack({
          type: 'error',
          message: 'Unable to send notification',
        });
      } finally {
        setIsLoadingNotifyAdmin(false);
      }
    },
    [selectedGroup?.groupName, t]
  );

  const isUnread = useMemo(() => {
    if (!selectedGroup) return false;
    return (
      groupAnnouncements?.[selectedGroup?.groupId]?.seentimestamp === false
    );
  }, [groupAnnouncements, selectedGroup]);

  const openDirectChatFromNotification = useCallback(
    (e) => {
      if (isLoadingOpenSectionFromNotification.current) return;
      isLoadingOpenSectionFromNotification.current = true;
      const directAddress = e.detail?.from;

      const findDirect = displayDirects?.find(
        (direct) => direct?.address === directAddress
      );
      if (findDirect?.address === selectedDirect?.address) {
        openQChatTab();
        isLoadingOpenSectionFromNotification.current = false;
        return;
      }
      if (findDirect) {
        setDesktopSideView('directs');
        openQChatTab();
        setSelectedDirect(null);

        setNewChat(false);

        window
          .sendMessage('addTimestampEnterChat', {
            timestamp: Date.now(),
            groupId: findDirect.address,
          })
          .catch((error) => {
            console.error(
              'Failed to add timestamp:',
              error.message || 'An error occurred'
            );
          });

        setTimeout(() => {
          setSelectedDirect(findDirect);
          getTimestampEnterChat();
          isLoadingOpenSectionFromNotification.current = false;
        }, 200);
      } else {
        openQChatTab();
        setDesktopSideView('directs');
        setNewChat(true);
        setTimeout(() => {
          executeEvent('setDirectToValueNewChat', {
            directToValue: directAddress,
          });
          isLoadingOpenSectionFromNotification.current = false;
        }, 500);
      }
    },
    [displayDirects, selectedDirect?.address, getTimestampEnterChat]
  );

  const openDirectChatFromInternal = useCallback(
    (e) => {
      const directAddress = e.detail?.address;
      const name = e.detail?.name;
      const findDirect = displayDirects?.find(
        (direct) => direct?.address === directAddress || direct?.name === name
      );

      if (findDirect) {
        openQChatTab();
        setDesktopSideView('directs');
        setSelectedDirect(null);

        setNewChat(false);

        window
          .sendMessage('addTimestampEnterChat', {
            timestamp: Date.now(),
            groupId: findDirect.address,
          })
          .catch((error) => {
            console.error(
              'Failed to add timestamp:',
              error.message || 'An error occurred'
            );
          });

        setTimeout(() => {
          setSelectedDirect(findDirect);
          getTimestampEnterChat();
        }, 200);
      } else {
        openQChatTab();
        setDesktopSideView('directs');
        setNewChat(true);
        setTimeout(() => {
          executeEvent('setDirectToValueNewChat', {
            directToValue: name || directAddress,
          });
        }, 500);
      }
    },
    [displayDirects, getTimestampEnterChat]
  );

  useEffect(() => {
    subscribeToEvent('openDirectMessageInternal', openDirectChatFromInternal);

    return () => {
      unsubscribeFromEvent(
        'openDirectMessageInternal',
        openDirectChatFromInternal
      );
    };
  }, [displayDirects, selectedDirect, openDirectChatFromInternal]);

  useEffect(() => {
    subscribeToEvent('openDirectMessage', openDirectChatFromNotification);

    return () => {
      unsubscribeFromEvent('openDirectMessage', openDirectChatFromNotification);
    };
  }, [
    displayDirects,
    selectedDirect,
    openDirectChatFromNotification,
    openDirectChatFromInternal,
  ]);

  const markReticulumGroupsRead = useCallback(
    async (groupIds: Array<string | number>) => {
      if (
        !reticulumChatEnabled ||
        !myAddress ||
        typeof window.reticulumChat?.markGroupsRead !== 'function'
      ) {
        return;
      }

      const requestedGroupIds = [
        ...new Set(
          groupIds
            .map((groupId) => Number(groupId))
            .filter((groupId) => Number.isInteger(groupId) && groupId > 0)
        ),
      ];
      if (!requestedGroupIds.length) return;

      try {
        const result = await window.reticulumChat.markGroupsRead(
          requestedGroupIds,
          myAddress
        );
        if (result?.success !== true) {
          throw new Error(result?.error || 'Reticulum chat is unavailable');
        }
        executeEvent('reticulum-chat-summaries-refresh', {});
      } catch (error) {
        console.error(
          '[ReticulumChat] Failed to mark group chat as read:',
          error
        );
      }
    },
    [myAddress, reticulumChatEnabled]
  );

  const handleMarkAsRead = useCallback(
    (e) => {
      const { groupId } = e.detail;
      void dismissChatOsNotifications();
      void markReticulumGroupsRead([groupId]);
      window
        .sendMessage('addTimestampEnterChat', {
          timestamp: Date.now(),
          groupId,
        })
        .catch((error) => {
          console.error(
            'Failed to add timestamp:',
            error.message || 'An error occurred'
          );
        });

      window
        .sendMessage('addGroupNotificationTimestamp', {
          timestamp: Date.now(),
          groupId,
        })
        .catch((error) => {
          console.error(
            'Failed to add group notification timestamp:',
            error.message || 'An error occurred'
          );
        });

      setTimeout(() => {
        getGroupAnnouncements();
        getTimestampEnterChat();
      }, 200);
    },
    [getGroupAnnouncements, getTimestampEnterChat, markReticulumGroupsRead]
  );

  const handleMarkAllMemberGroupsRead = useCallback(() => {
    const ids = (memberGroupsRef.current || [])
      .map((g) => g?.groupId)
      .filter((id) => id != null && id !== '');
    if (!ids.length) return;

    void dismissChatOsNotifications();
    void markReticulumGroupsRead(ids);

    window
      .sendMessage('markAllMemberGroupsRead', { groupIds: ids })
      .then((response) => {
        if (response?.error) {
          console.error('Failed to mark all groups read:', response.error);
        }
      })
      .catch((error) => {
        console.error(
          'Failed to mark all groups read:',
          error.message || 'An error occurred'
        );
      });

    setTimeout(() => {
      getGroupAnnouncements();
      getTimestampEnterChat();
    }, 200);
  }, [getGroupAnnouncements, getTimestampEnterChat, markReticulumGroupsRead]);

  useEffect(() => {
    void loadPinnedGroupIds();
    const reapplyPins = () => {
      const current = memberGroupsRef.current || [];
      if (!current.length) return;
      const next = applyPinnedGroupOrder(current);
      setMemberGroups(next);
      memberGroupsRef.current = next;
    };
    return subscribePinnedGroups(reapplyPins);
  }, [setMemberGroups]);

  useEffect(() => {
    subscribeToEvent('markAsRead', handleMarkAsRead);

    return () => {
      unsubscribeFromEvent('markAsRead', handleMarkAsRead);
    };
  }, [handleMarkAsRead]);

  useEffect(() => {
    subscribeToEvent('markAllMemberGroupsRead', handleMarkAllMemberGroupsRead);

    return () => {
      unsubscribeFromEvent(
        'markAllMemberGroupsRead',
        handleMarkAllMemberGroupsRead
      );
    };
  }, [handleMarkAllMemberGroupsRead]);

  const resetAllStatesAndRefs = useCallback(() => {
    // Reset all useState values to their initial states
    setSecretKey(null);
    secretKeyRef.current = null;
    lastFetchedSecretKey.current = null;
    reticulumBackgroundEventTracker.clear();
    setSecretKeyPublishDate(null);
    setSecretKeyDetails(null);
    setNewEncryptionNotification(null);
    setMemberCountFromSecretKeyData(null);
    setIsForceShowCreationKeyPopup(false);
    setSelectedGroup(null);
    setSelectedDirect(null);
    setMemberGroups([]);
    setMemberGroupsLoadedAddress('');
    memberGroupsRef.current = [];
    setDirects([]);
    setMemberDirects([]);
    setAdmins([]);
    setAdminsWithNames([]);
    setMembers([]);
    setGroupOwner(null);
    setTriedToFetchSecretKey(false);
    setHideCommonKeyPopup(false);
    setOpenAddGroup(false);
    setOpenManageMembers(false);
    setTimestampEnterData({});
    setChatMode('groups');
    setNewChat(false);
    setOpenSnack(false);
    setInfoSnack(null);
    setIsLoadingNotifyAdmin(false);
    setIsLoadingGroups(false);
    setIsLoadingGroup(false);
    setIsLoadingThreadKey(false);
    setFirstSecretKeyInCreation(false);
    setMountedLandGroupId(null);
    setNotificationReticulumChannelId('');
    setNotificationReticulumMessageId('');
    setGroupSection('home');
    setGroupAnnouncements({});
    setDefaultThread(null);
    setMobileViewMode('home');
    setIsQChatTabActive(false);
    // Reset all useRef values to their initial states
    hasInitializedWebsocket.current = false;
    myAddressRef.current = '';
    selectedGroupRef.current = null;
    selectedDirectRef.current = null;
    newChatRef.current = false;
    chatSessionInitializedRef.current = false;
    groupSectionRef.current = null;
    qChatTabActiveRef.current = false;
    isLoadingOpenSectionFromNotification.current = false;
    settimeoutForRefetchSecretKey.current = null;
    threadKeyLoadRef.current = null;
    initiatedGetMembers.current = false;
    setDesktopViewMode('home');
  }, []);

  const logoutEventFunc = useCallback(() => {
    resetAllStatesAndRefs();
    clearStatesMessageQueueProvider();
  }, [resetAllStatesAndRefs, clearStatesMessageQueueProvider]);

  useEffect(() => {
    subscribeToEvent('logout-event', logoutEventFunc);

    return () => {
      unsubscribeFromEvent('logout-event', logoutEventFunc);
    };
  }, [logoutEventFunc]);

  const openAppsMode = useCallback(() => {
    setDesktopViewMode('apps');
  }, []);

  useEffect(() => {
    subscribeToEvent('open-apps-mode', openAppsMode);

    return () => {
      unsubscribeFromEvent('open-apps-mode', openAppsMode);
    };
  }, [openAppsMode]);

  const openHomeMode = useCallback(() => {
    setDesktopViewMode('home');
  }, []);

  useEffect(() => {
    subscribeToEvent('open-home-mode', openHomeMode);

    return () => {
      unsubscribeFromEvent('open-home-mode', openHomeMode);
    };
  }, [openHomeMode]);

  const openChatMode = useCallback(() => {
    setDesktopViewMode('chat');
    setMobileViewMode('chat');
  }, [setDesktopViewMode]);

  useEffect(() => {
    subscribeToEvent('open-chat-mode', openChatMode);

    return () => {
      unsubscribeFromEvent('open-chat-mode', openChatMode);
    };
  }, [openChatMode]);

  // Mobile bottom-tab bar switches the Q-Chat side view (Chat = directs,
  // Groups = group list) without exposing the desktop hover sidebar.
  const setChatSideViewFromMobile = useCallback((e: CustomEvent) => {
    let view = e?.detail?.data?.view;
    // The bottom Chat tab asks for the last-used view so Chat remembers whether
    // Groups or PM was open last (persisted in localStorage on change below).
    if (view === 'last') {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(CHAT_SIDE_VIEW_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      view = stored === 'groups' ? 'groups' : 'directs';
    }
    // On mobile the list and an open chat occupy the same single column, so we
    // must clear any open group/DM/new-chat detail when switching the side view;
    // otherwise the open detail keeps covering the screen and the user is stuck
    // inside (e.g. a group) with no way back to the list.
    if (view === 'directs') {
      setSelectedGroup(null);
      setSelectedDirect(null);
      setNewChat(false);
      setDesktopSideView('directs');
    } else if (view === 'groups') {
      setSelectedGroup(null);
      setSelectedDirect(null);
      setNewChat(false);
      setChatMode('groups');
      setDesktopSideView('groups');
    }
  }, []);

  useEffect(() => {
    subscribeToEvent('mobile-chat-side-view', setChatSideViewFromMobile);

    return () => {
      unsubscribeFromEvent('mobile-chat-side-view', setChatSideViewFromMobile);
    };
  }, [setChatSideViewFromMobile]);

  // Remember whether Groups or PM (directs) was the last-used chat view so the
  // bottom Chat tab can restore it (see view === 'last' above).
  useEffect(() => {
    if (desktopSideView === 'groups' || desktopSideView === 'directs') {
      try {
        localStorage.setItem(CHAT_SIDE_VIEW_STORAGE_KEY, desktopSideView);
      } catch {
        /* ignore */
      }
    }
  }, [desktopSideView]);

  // Remember the most-recently opened conversation so the bottom Chat tab can
  // resume it later — even after the app was minimised or killed by the OS.
  useEffect(() => {
    if (selectedGroup?.groupId != null) {
      setLastOpenChat(myAddress, {
        kind: 'group',
        id: String(selectedGroup.groupId),
      });
    } else if (selectedDirect?.address) {
      setLastOpenChat(myAddress, {
        kind: 'direct',
        id: selectedDirect.address,
      });
    }
  }, [selectedGroup?.groupId, selectedDirect?.address, myAddress]);

  // Restore which list (Groups vs PM) was last used, without opening any
  // conversation.
  const restoreChatSideView = useCallback(() => {
    try {
      const storedSide = localStorage.getItem(CHAT_SIDE_VIEW_STORAGE_KEY);
      if (storedSide === 'groups' || storedSide === 'directs') {
        setDesktopSideView(storedSide);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Reopen the conversation persisted above. Best-effort: silently no-ops if
  // the relevant list hasn't loaded yet.
  const restoreLastOpenChat = useCallback(() => {
    restoreChatSideView();

    const last = getLastOpenChat(myAddress);
    if (!last) return;

    if (last.kind === 'group') {
      const group = memberGroupsRef.current?.find(
        (g) => String(g?.groupId) === String(last.id)
      );
      if (group) {
        setDesktopSideView('groups');
        selectGroupFuncRef.current?.(group);
      }
    } else if (last.kind === 'direct') {
      const direct = displayDirects?.find((d) => d?.address === last.id);
      if (direct) {
        setDesktopSideView('directs');
        setSelectedDirect(null);
        setNewChat(false);
        window
          .sendMessage('addTimestampEnterChat', {
            timestamp: Date.now(),
            groupId: direct.address,
          })
          .catch(() => {});
        setTimeout(() => {
          setSelectedDirect(direct);
          getTimestampEnterChat();
        }, 200);
      }
    }
  }, [myAddress, displayDirects, getTimestampEnterChat, restoreChatSideView]);

  // Bottom Chat tab behaviour:
  //  - first entry after the app was launched: always the list, never a
  //    conversation, so a cold start never drops the user straight into a chat;
  //  - coming back from another section with a conversation still open: resume
  //    that conversation;
  //  - tapping Chat while already on Chat: toggle between the open conversation
  //    and its list (Groups or PM).
  const handleMobileChatTab = useCallback(
    (e: CustomEvent) => {
      const reEntry = e?.detail?.data?.reEntry;
      const inDetail = !!(
        selectedGroupRef.current ||
        selectedDirectRef.current ||
        newChatRef.current
      );

      if (reEntry) {
        chatSessionInitializedRef.current = true;
        if (inDetail) {
          if (selectedDirectRef.current || newChatRef.current) {
            setDesktopSideView('directs');
          } else {
            setDesktopSideView('groups');
          }
          setSelectedGroup(null);
          setSelectedDirect(null);
          setNewChat(false);
          setMobileListPanelOpen(false);
          return;
        }
        // Back into the conversation. The slide-over list would otherwise stay
        // on top of it and the tap would look like it did nothing.
        setMobileListPanelOpen(false);
        restoreLastOpenChat();
        return;
      }

      // Arriving from another section: keep the conversation that is still in
      // memory so the user continues where they left off.
      if (inDetail) {
        chatSessionInitializedRef.current = true;
        return;
      }
      if (chatSessionInitializedRef.current) return;
      chatSessionInitializedRef.current = true;
      restoreChatSideView();
    },
    [restoreChatSideView, restoreLastOpenChat]
  );

  useEffect(() => {
    subscribeToEvent('mobile-chat-tab', handleMobileChatTab);

    return () => {
      unsubscribeFromEvent('mobile-chat-tab', handleMobileChatTab);
    };
  }, [handleMobileChatTab]);

  // Leaving a conversation on mobile returns to the list it came from, so a
  // group never drops the user into the DM list (or vice versa). A pinned
  // list (GO two-pane; on GO Chat lives only in the phone section) stays on
  // the page the user chose.
  const closeMobileChatDetail = useCallback(() => {
    const sideView = sideViewOnCloseDetail({
      twoPane: chatTwoPane,
      groupOpen: !!selectedGroupRef.current,
      directOpen: !!(selectedDirectRef.current || newChatRef.current),
    });
    if (sideView) setDesktopSideView(sideView);
    setSelectedGroup(null);
    setSelectedDirect(null);
    setNewChat(false);
    setMobileListPanelOpen(false);
  }, [chatTwoPane]);

  // The slide-in list sits above the conversation, so back dismisses it before
  // the thread underneath.
  useAndroidBack(
    () => {
      if (!mobileListPanelOpen) return false;
      setMobileListPanelOpen(false);
      return true;
    },
    {
      priority: BACK_PRIORITY.overlay,
      enabled: isMobile && mobileListPanelOpen,
    }
  );

  // A pinned list (GO two-pane) has nothing to slide over: drop a slide-over
  // left open from the single column, e.g. by rotating a tablet.
  useEffect(() => {
    if (chatTwoPane && mobileListPanelOpen) setMobileListPanelOpen(false);
  }, [chatTwoPane, mobileListPanelOpen]);

  // About Group is opened from the long-press menu on this panel — tuck the
  // panel away so the dialog is not obscured by the slide-over surface.
  useEffect(() => {
    const hideListForAbout = () => setMobileListPanelOpen(false);
    subscribeToEvent('openReticulumGroupAbout', hideListForAbout);
    return () =>
      unsubscribeFromEvent('openReticulumGroupAbout', hideListForAbout);
  }, []);

  // Android back inside Q-Chat: if a thread (group / DM / new chat) is open in
  // the single mobile column, collapse back to the list instead of leaving the
  // section. Runs above the App-level "return to Home" handler.
  useAndroidBack(
    () => {
      if (selectedGroup || selectedDirect || newChat) {
        closeMobileChatDetail();
        return true;
      }
      return false;
    },
    {
      priority: BACK_PRIORITY.detail,
      enabled: isMobile && desktopViewMode !== 'home',
    }
  );

  const returnFromAppsMode = useCallback(() => {
    setDesktopViewMode(lastNonQappDesktopViewModeRef.current || 'home');
  }, [setDesktopViewMode]);

  useEffect(() => {
    subscribeToEvent('return-from-apps-mode', returnFromAppsMode);

    return () => {
      unsubscribeFromEvent('return-from-apps-mode', returnFromAppsMode);
    };
  }, [returnFromAppsMode]);

  const openGroupDiscovery = useCallback(
    (event?: CustomEvent<{ modalOnly?: boolean }>) => {
      setOnboardingQChatPreviewOpen(false);
      if (!event?.detail?.modalOnly) {
        setChatMode('groups');
        setDesktopSideView('groups');
        setSelectedGroup(null);
        setSelectedDirect(null);
        setNewChat(false);
        openQChatTab();
      }
      setOpenAddGroup(false);
      setOpenFindGroup(true);
    },
    []
  );

  const hasConfirmedNoReticulumGroups =
    reticulumChatEnabled &&
    memberGroupsLoadedAddress === myAddress &&
    getGroupIdsFromGroupLikeList(memberGroupsForReticulum).length === 0;
  const hasConfirmedReticulumGroups =
    reticulumChatEnabled &&
    memberGroupsLoadedAddress === myAddress &&
    getGroupIdsFromGroupLikeList(memberGroupsForReticulum).length > 0;
  const qortalProjectMember =
    memberGroupsLoadedAddress === myAddress
      ? memberGroupsForReticulum.some(
          (group) => Number(group?.groupId) === QORTAL_PROJECT_GROUP_ID
        )
      : null;
  const reticulumActivityDashboardReady =
    hasConfirmedReticulumGroups &&
    reticulumMembershipsAppliedKey === reticulumMembershipsKey &&
    reticulumSummariesLoadedMembershipKey === reticulumMembershipsKey;
  useEffect(() => {
    if (
      !isQChatTabActive ||
      !hasConfirmedReticulumGroups ||
      reticulumChatReadinessState !== 'ready' ||
      reticulumActivityDashboardReady ||
      selectedGroup ||
      selectedDirect ||
      newChat
    ) {
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      console.error(
        '[ReticulumChat] Activity dashboard is still not ready after 10 seconds',
        {
          adminMetadataReady: reticulumAdminGroupsLoadedAddress === myAddress,
          bridgeAvailable: Boolean(window.reticulumChat),
          groupCount: getGroupIdsFromGroupLikeList(memberGroupsForReticulum)
            .length,
          membershipsApplied:
            reticulumMembershipsAppliedKey === reticulumMembershipsKey,
          summariesLoaded:
            reticulumSummariesLoadedMembershipKey === reticulumMembershipsKey,
        }
      );
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [
    hasConfirmedReticulumGroups,
    isQChatTabActive,
    memberGroupsForReticulum,
    myAddress,
    newChat,
    reticulumActivityDashboardReady,
    reticulumAdminGroupsLoadedAddress,
    reticulumChatReadinessState,
    reticulumMembershipsAppliedKey,
    reticulumMembershipsKey,
    reticulumSummariesLoadedMembershipKey,
    selectedDirect,
    selectedGroup,
  ]);
  const reticulumHasUnreadActivity = memberGroupsWithReticulumActivity.some(
    (group: any) => {
      const summary = group?.reticulumChatSummary;
      return (
        Number(summary?.unreadCount || 0) > 0 ||
        Number(summary?.mentionCount || 0) > 0 ||
        summary?.hasUnreadMention === true
      );
    }
  );
  const reticulumWelcomeDisplayName =
    typeof userInfo?.name === 'string' &&
    userInfo.name.trim() &&
    userInfo.name.trim() !== myAddress
      ? userInfo.name.trim()
      : undefined;

  useEffect(() => {
    if (!reticulumChatEnabled) return undefined;
    return startReticulumGroupScoreScheduler();
  }, [reticulumChatEnabled]);

  useEffect(() => {
    subscribeToEvent('open-group-discovery', openGroupDiscovery);

    return () => {
      unsubscribeFromEvent('open-group-discovery', openGroupDiscovery);
    };
  }, [openGroupDiscovery]);

  const openDevMode = useCallback(() => {
    setDesktopViewMode('dev');
  }, []);

  useEffect(() => {
    subscribeToEvent('open-dev-mode', openDevMode);

    return () => {
      unsubscribeFromEvent('open-dev-mode', openDevMode);
    };
  }, [openDevMode]);

  const openGroupChatFromNotification = useCallback(
    (e) => {
      if (isLoadingOpenSectionFromNotification.current) return;

      const groupId = e.detail?.from;
      const channelId =
        typeof e.detail?.channelId === 'string' ? e.detail.channelId : '';
      const eventId =
        typeof e.detail?.eventId === 'string' ? e.detail.eventId : '';
      const openCalendar = e.detail?.openCalendar === true;
      if (openCalendar) {
        setReticulumCalendarTarget({
          groupId: Number(groupId),
          eventId,
          occurrenceStart: Number(e.detail?.occurrenceStart || Date.now()),
          timezone: String(e.detail?.timezone || ''),
        });
        setReticulumCalendarOpenRequest((value) => value + 1);
      } else {
        if (channelId) {
          setNotificationReticulumChannelId(channelId);
        }
        setNotificationReticulumMessageId(eventId);
      }
      const findGroup = memberGroupsRef.current?.find(
        (group: any) => +group?.groupId === +groupId
      );
      if (findGroup?.groupId === selectedGroup?.groupId) {
        isLoadingOpenSectionFromNotification.current = false;
        setChatMode('groups');
        setGroupSection('chat');
        bumpReticulumReadEntryToken();
        openQChatTab();
        return;
      }
      if (findGroup) {
        setChatMode('groups');
        setSelectedGroup(null);
        setSelectedDirect(null);

        setNewChat(false);
        setSecretKey(null);
        secretKeyRef.current = null;
        setGroupOwner(null);
        lastFetchedSecretKey.current = null;
        initiatedGetMembers.current = false;
        setSecretKeyPublishDate(null);
        setAdmins([]);
        setSecretKeyDetails(null);
        setAdminsWithNames([]);
        setMembers([]);
        setMemberCountFromSecretKeyData(null);
        setIsForceShowCreationKeyPopup(false);
        setTriedToFetchSecretKey(false);
        setFirstSecretKeyInCreation(false);
        setGroupSection('chat');
        bumpReticulumReadEntryToken();
        openQChatTab();

        window
          .sendMessage('addTimestampEnterChat', {
            timestamp: Date.now(),
            groupId: findGroup.groupId,
          })
          .catch((error) => {
            console.error(
              'Failed to add timestamp:',
              error.message || 'An error occurred'
            );
          });

        setTimeout(() => {
          setSelectedGroup(findGroup);
          setMobileViewMode('group');
          setDesktopSideView('groups');
          getTimestampEnterChat();
          isLoadingOpenSectionFromNotification.current = false;
        }, 350);
      } else {
        isLoadingOpenSectionFromNotification.current = false;
      }
    },
    [bumpReticulumReadEntryToken, selectedGroup?.groupId, getTimestampEnterChat]
  );

  useEffect(() => {
    subscribeToEvent('openGroupMessage', openGroupChatFromNotification);

    return () => {
      unsubscribeFromEvent('openGroupMessage', openGroupChatFromNotification);
    };
  }, [openGroupChatFromNotification]);

  const openGroupAnnouncementFromNotification = useCallback(
    (e) => {
      const groupId = e.detail?.from;

      const findGroup = memberGroupsRef.current?.find(
        (group: any) => +group?.groupId === +groupId
      );
      if (findGroup?.groupId === selectedGroup?.groupId) {
        setGroupSection('announcement');
        openQChatTab();
        return;
      }
      if (findGroup) {
        setChatMode('groups');
        setSelectedGroup(null);
        setSecretKey(null);
        secretKeyRef.current = null;
        setGroupOwner(null);
        lastFetchedSecretKey.current = null;
        initiatedGetMembers.current = false;
        setSecretKeyPublishDate(null);
        setAdmins([]);
        setSecretKeyDetails(null);
        setAdminsWithNames([]);
        setMembers([]);
        setMemberCountFromSecretKeyData(null);
        setIsForceShowCreationKeyPopup(false);
        setTriedToFetchSecretKey(false);
        setFirstSecretKeyInCreation(false);
        setGroupSection('announcement');
        openQChatTab();
        window
          .sendMessage('addGroupNotificationTimestamp', {
            timestamp: Date.now(),
            groupId: findGroup.groupId,
          })
          .catch((error) => {
            console.error(
              'Failed to add group notification timestamp:',
              error.message || 'An error occurred'
            );
          });

        setTimeout(() => {
          setSelectedGroup(findGroup);
          setMobileViewMode('group');
          setDesktopSideView('groups');
          getGroupAnnouncements();
        }, 350);
      }
    },
    [selectedGroup?.groupId, getGroupAnnouncements]
  );

  useEffect(() => {
    subscribeToEvent(
      'openGroupAnnouncement',
      openGroupAnnouncementFromNotification
    );

    return () => {
      unsubscribeFromEvent(
        'openGroupAnnouncement',
        openGroupAnnouncementFromNotification
      );
    };
  }, [openGroupAnnouncementFromNotification]);

  const openThreadNewPostFunc = useCallback(
    (e) => {
      const data = e.detail?.data;
      const { groupId } = data;
      const findGroup = memberGroupsRef.current?.find(
        (group: any) => +group?.groupId === +groupId
      );
      if (findGroup?.groupId === selectedGroup?.groupId) {
        setGroupSection('forum');
        setDefaultThread(data);
        openQChatTab();

        return;
      }
      if (findGroup) {
        setChatMode('groups');
        setSelectedGroup(null);
        setSecretKey(null);
        secretKeyRef.current = null;
        setGroupOwner(null);
        lastFetchedSecretKey.current = null;
        initiatedGetMembers.current = false;
        setSecretKeyPublishDate(null);
        setAdmins([]);
        setSecretKeyDetails(null);
        setAdminsWithNames([]);
        setMembers([]);
        setMemberCountFromSecretKeyData(null);
        setIsForceShowCreationKeyPopup(false);
        setTriedToFetchSecretKey(false);
        setFirstSecretKeyInCreation(false);
        setGroupSection('forum');
        setDefaultThread(data);
        openQChatTab();
        setTimeout(() => {
          setSelectedGroup(findGroup);
          setMobileViewMode('group');
          setDesktopSideView('groups');
          getGroupAnnouncements();
        }, 350);
      }
    },
    [selectedGroup?.groupId, getGroupAnnouncements]
  );

  useEffect(() => {
    subscribeToEvent('openThreadNewPost', openThreadNewPostFunc);

    return () => {
      unsubscribeFromEvent('openThreadNewPost', openThreadNewPostFunc);
    };
  }, [openThreadNewPostFunc]);

  const handleSecretKeyCreationInProgress = useCallback(() => {
    setFirstSecretKeyInCreation(true);
  }, []);

  const goToHome = useCallback(async () => {
    setDesktopViewMode('home');

    await new Promise((res) => {
      setTimeout(() => {
        res(null);
      }, 200);
    });
  }, []);

  const goToAnnouncements = useCallback(() => {
    setSelectedDirect(null);
    setNewChat(false);
    setGroupSection('announcement');
    window
      .sendMessage('addGroupNotificationTimestamp', {
        timestamp: Date.now(),
        groupId: selectedGroupRef.current.groupId,
      })
      .catch((error) => {
        console.error(
          'Failed to add group notification timestamp:',
          error.message || 'An error occurred'
        );
      });

    setTimeout(() => {
      getGroupAnnouncements();
    }, 200);
  }, [getGroupAnnouncements]);

  const openDrawerGroups = useCallback(() => {
    setIsOpenDrawer(true);
  }, []);

  const goToThreads = useCallback(() => {
    setSelectedDirect(null);
    setNewChat(false);
    if (reticulumChatEnabled && groupSection === 'forum') {
      setGroupSection('chat');
      bumpReticulumReadEntryToken();
      return;
    }
    setGroupSection('forum');
  }, [bumpReticulumReadEntryToken, groupSection, reticulumChatEnabled]);

  const goToQortalLand = useCallback(() => {
    const groupId = selectedGroupRef.current?.groupId;
    if (groupId !== undefined && groupId !== null) {
      setMountedLandGroupId(String(groupId));
    }
    setSelectedDirect(null);
    setNewChat(false);
    setGroupSection('land');
  }, []);

  const goToChat = useCallback(() => {
    setGroupSection('chat');
    bumpReticulumReadEntryToken();
    setNewChat(false);
    setSelectedDirect(null);
    if (selectedGroupRef.current) {
      window
        .sendMessage('addTimestampEnterChat', {
          timestamp: Date.now(),
          groupId: selectedGroupRef.current.groupId,
        })
        .catch((error) => {
          console.error(
            'Failed to add timestamp:',
            error.message || 'An error occurred'
          );
        });

      setTimeout(() => {
        getTimestampEnterChat();
      }, 200);
    }
  }, [bumpReticulumReadEntryToken, getTimestampEnterChat]);

  const closeOnboardingGroupDiscovery = useCallback(() => {
    setOpenFindGroup(false);
  }, []);

  const navigateOnboardingHome = useCallback(() => {
    setOnboardingQChatPreviewOpen(false);
    void goToHome();
  }, [goToHome]);

  const navigateOnboardingQChat = useCallback(() => {
    openQChatTab();
  }, []);

  const showOnboardingQortalProject = useCallback(async () => {
    const startedAt = Date.now();
    while (
      memberGroupsLoadedAddressRef.current !== myAddressRef.current &&
      Date.now() - startedAt < 10_000
    ) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
    }

    const qortalProjectGroup = (memberGroupsRef.current || []).find(
      (group) => Number(group?.groupId) === QORTAL_PROJECT_GROUP_ID
    );

    setOpenFindGroup(false);
    setDesktopSideView('groups');
    setSelectedDirect(null);
    setNewChat(false);
    setGroupSection('chat');

    if (
      memberGroupsLoadedAddressRef.current === myAddressRef.current &&
      qortalProjectGroup
    ) {
      setOnboardingQChatPreviewOpen(false);
      setSelectedGroup(qortalProjectGroup);
      return 'member' as const;
    }

    setSelectedGroup(null);
    setOnboardingQChatPreviewOpen(true);
    return 'preview' as const;
  }, []);

  const closeOnboardingQChatPreview = useCallback(() => {
    setOnboardingQChatPreviewOpen(false);
  }, []);

  const showOnboardingDirectMessages = useCallback(() => {
    setOnboardingQChatPreviewOpen(false);
    setDesktopSideView('directs');
    setSelectedGroup(null);
    setNewChat(false);
    setSelectedDirect((current) => current ?? displayDirects[0] ?? null);
    setGroupSection('chat');
  }, [displayDirects]);

  useEffect(() => {
    if (
      reticulumChatEnabled &&
      (groupSection === 'announcement' || groupSection === 'adminSpace')
    ) {
      setGroupSection('chat');
    }
  }, [groupSection, reticulumChatEnabled]);

  const reticulumMembersPanelOpen =
    groupSection === 'land'
      ? reticulumLandMembersPanelOpen
      : reticulumChatMembersPanelOpen;
  const toggleReticulumMembersPanel = useCallback(() => {
    if (groupSection === 'land') {
      const next = !reticulumLandMembersPanelOpen;
      if (next) {
        executeEvent('closeReticulumGroupOverlays', { except: 'members' });
      }
      setReticulumLandMembersPanelOpen(next);
      return;
    }
    const next = !reticulumChatMembersPanelOpen;
    if (next) {
      executeEvent('closeReticulumGroupOverlays', { except: 'members' });
    }
    setReticulumChatMembersPanelOpen(next);
  }, [
    groupSection,
    reticulumChatMembersPanelOpen,
    reticulumLandMembersPanelOpen,
  ]);

  // Switching groups (or leaving chat/land) should tuck away members sheets.
  useEffect(() => {
    setReticulumChatMembersPanelOpen(false);
    setReticulumLandMembersPanelOpen(false);
  }, [selectedGroup?.groupId]);

  useEffect(() => {
    if (groupSection !== 'chat') {
      setReticulumChatMembersPanelOpen(false);
      executeEvent('closeReticulumGroupOverlays', { except: 'members' });
    }
    if (groupSection !== 'land') {
      setReticulumLandMembersPanelOpen(false);
    }
  }, [groupSection]);

  const handleReticulumChannelSelected = useCallback(
    (channelId: string) => {
      const normalizedChannelId = channelId || 'general';
      setActiveReticulumChannelId((previousChannelId) => {
        const previous = previousChannelId || 'general';
        if (previous !== normalizedChannelId) {
          bumpReticulumReadEntryToken();
        }
        return normalizedChannelId;
      });
      if (
        notificationReticulumChannelId &&
        notificationReticulumChannelId === normalizedChannelId
      ) {
        setNotificationReticulumChannelId('');
        setNotificationReticulumMessageId('');
      }
    },
    [bumpReticulumReadEntryToken, notificationReticulumChannelId]
  );
  const handleReticulumNotificationHandled = useCallback(() => {
    setNotificationReticulumChannelId('');
    setNotificationReticulumMessageId('');
  }, []);

  const closeReticulumMembersPanel = useCallback(() => {
    setReticulumChatMembersPanelOpen(false);
    setReticulumLandMembersPanelOpen(false);
  }, []);

  // On phones Members, Threads and Qortal Land are full-screen panels over the
  // conversation, so back does what their X does: return to the chat instead
  // of leaving the group. Members can sit over Qortal Land, so it closes first.
  const mobileSectionPanelOpen =
    groupSection === 'forum' || groupSection === 'land';
  useAndroidBack(
    () => {
      if (reticulumMembersPanelOpen) {
        closeReticulumMembersPanel();
        return true;
      }
      goToChat();
      return true;
    },
    {
      priority: BACK_PRIORITY.sheet,
      enabled:
        isMobile &&
        reticulumChatEnabled &&
        (reticulumMembersPanelOpen || mobileSectionPanelOpen),
    }
  );

  useEffect(() => {
    if (!reticulumChatEnabled) return;
    const closeMembersPanel = () => {
      setReticulumChatMembersPanelOpen(false);
      setReticulumLandMembersPanelOpen(false);
    };
    subscribeToEvent('closeReticulumMembersPanel', closeMembersPanel);
    return () =>
      unsubscribeFromEvent('closeReticulumMembersPanel', closeMembersPanel);
  }, [reticulumChatEnabled]);

  useEffect(() => {
    const syncSearchOverlayState = (event: any) => {
      setReticulumSearchOverlayOpen(
        Boolean(event?.detail?.open ?? event?.open)
      );
    };
    subscribeToEvent('reticulumSearchOverlayOpenState', syncSearchOverlayState);
    return () =>
      unsubscribeFromEvent(
        'reticulumSearchOverlayOpenState',
        syncSearchOverlayState
      );
  }, []);

  const loadingGroupSnackbarInfo = useMemo(
    () => ({
      message:
        isLoadingGroupMessage ||
        t('group:message.generic.setting_group', {
          postProcess: 'capitalizeFirstChar',
        }),
    }),
    [isLoadingGroupMessage, t]
  );

  const loadingGroupsSnackbarInfo = useMemo(
    () => ({
      message: t('group:message.generic.setting_group', {
        postProcess: 'capitalizeFirstChar',
      }),
    }),
    [t]
  );

  const notPartOfKeys = useMemo(() => {
    return (
      isPrivate &&
      !admins.includes(myAddress) &&
      !secretKey &&
      triedToFetchSecretKey
    );
  }, [isPrivate, admins, myAddress, secretKey, triedToFetchSecretKey]);
  const activeSectionUsesSecretKey = groupSectionUsesSecretKey(
    reticulumChatEnabled,
    groupSection
  );

  const closeChatDirect = useCallback(() => {
    setSelectedDirect(null);
    setNewChat(false);
  }, []);
  const getNoReticulumGroupSecretKey = useCallback(async () => null, []);

  // Phones run the new chat as a single column: the DM list sits beside the
  // group rail and the conversation replaces it, so the desktop side-by-side
  // overlay would only hide both.
  const reticulumDirectsInline = reticulumChatEnabled && isMobile;
  const isReticulumDirectOverlayOpen =
    reticulumChatEnabled && !isMobile && desktopSideView === 'directs';
  const showDirectsList =
    desktopSideView === 'directs' &&
    (!reticulumChatEnabled || reticulumDirectsInline);
  const mobileDirectConversationOpen =
    reticulumDirectsInline && Boolean(selectedDirect || newChat);

  // Threads, Qortal Land and Members fill the phone screen like Calendar and
  // Files do, so the app's top and tab bars step aside while one is up.
  const setMobileGroupPanelOpen = useSetAtom(mobileGroupPanelOpenAtom);
  const mobileGroupPanelOpen =
    isMobile &&
    reticulumChatEnabled &&
    desktopViewMode === 'chat' &&
    Boolean(selectedGroup) &&
    !mobileDirectConversationOpen &&
    !mobileListPanelOpen &&
    (mobileSectionPanelOpen || reticulumMembersPanelOpen);
  // The group chat's message search runs to the bottom of the phone screen
  // (its results and page buttons), so the floating Home/Apps/Chat buttons
  // step aside while it is open on the chat on screen, and come back over the
  // list that slides in over it.
  useCoverMobileTabBar(
    isMobile &&
      reticulumChatEnabled &&
      desktopViewMode === 'chat' &&
      Boolean(selectedGroup) &&
      groupSection === 'chat' &&
      !mobileDirectConversationOpen &&
      !mobileListPanelOpen &&
      reticulumSearchOverlayOpen
  );
  // Phones: sideways swipes on an open chat lead back to the lists, like the
  // system back. On a DM (Saved Messages included) a swipe to the right goes
  // to the DM list; on a group chat to the right goes to the Groups list and
  // to the left to the DMs (the Groups / DMs switch's order). The list being
  // swiped to slides in under the chat. Replaces the edge swipe that slid
  // the list over a chat. Off while the list is pinned beside the chat.
  const swipeBackFrom: 'direct' | 'group' | null =
    !isMobile || !reticulumChatEnabled || newChat || chatTwoPane
      ? null
      : selectedDirect && desktopSideView === 'directs'
        ? 'direct'
        : selectedGroup && !selectedDirect
          ? 'group'
          : null;
  const openDirectsFromGroupChat = useCallback(() => {
    setSelectedGroup(null);
    setSelectedDirect(null);
    setNewChat(false);
    setMobileListPanelOpen(false);
    setDesktopSideView('directs');
  }, []);
  useSwipeBackToList(phoneChatDetailEl, phoneChatListPanelEl, {
    enabled:
      swipeBackFrom !== null &&
      !mobileListPanelOpen &&
      !mobileGroupPanelOpen &&
      desktopViewMode === 'chat',
    onBack: closeMobileChatDetail,
    onForward: swipeBackFrom === 'group' ? openDirectsFromGroupChat : undefined,
    onReveal: (direction) =>
      phoneChatListPagerRef.current?.preview(
        direction === null
          ? null
          : direction === 'forward' || swipeBackFrom === 'direct'
            ? 'directs'
            : 'groups'
      ),
    reducedMotion: immersiveMotionReduced(),
  });

  useLayoutEffect(() => {
    setMobileGroupPanelOpen(mobileGroupPanelOpen);
  }, [mobileGroupPanelOpen, setMobileGroupPanelOpen]);
  useEffect(
    () => () => setMobileGroupPanelOpen(false),
    [setMobileGroupPanelOpen]
  );

  // Phones build Chat once, soon after start, at normal priority and out of
  // sight, then park it like Home. React would otherwise build a hidden
  // <Activity> only in idle time, which on a busy start can take many
  // seconds, and a swipe or tap to Chat would meet an empty screen.
  const [chatWarmUp, setChatWarmUp] = useState(false);
  const chatBuiltRef = useRef(false);
  useEffect(() => {
    if (!isMobile || chatBuiltRef.current) return;
    if (desktopViewMode === 'chat') {
      chatBuiltRef.current = true;
      return;
    }
    const id = window.setTimeout(() => {
      chatBuiltRef.current = true;
      setChatWarmUp(true);
    }, 1200);
    return () => window.clearTimeout(id);
  }, [desktopViewMode, isMobile]);
  useEffect(() => {
    if (!chatWarmUp) return;
    // Built and committed: park it (effects stop until Chat is opened).
    const id = window.requestAnimationFrame(() => setChatWarmUp(false));
    return () => window.cancelAnimationFrame(id);
  }, [chatWarmUp]);

  // Phones: a sideways swipe moves between Home, Apps and Chat, landing
  // where the tab buttons would. Not over a Q-App (its frame owns its
  // swipes), not on full-screen group panels.
  const mainContentRef = useRef<HTMLDivElement | null>(null);
  const qappFrameOnScreen = useAtomValue(mobileQappFrameShowingAtom);
  const { go: goToMobileTab } = useMobileTabNavigation(
    desktopViewMode,
    setDesktopViewMode
  );
  const currentMobileTab = mobileSectionForViewMode(desktopViewMode);
  // Swipes along the bottom bar switch sections too, even over a Q-App.
  const mobileTabBarElement = useAtomValue(mobileTabBarElementAtom);
  // The sections sit side by side as the user arranged the round buttons,
  // with the widgets screen (GO phones, unless switched off) left of them.
  const mobileTabOrder = useAtomValue(mobileTabOrderAtom);
  const widgetsEnabled = useAtomValue(goWidgetsEnabledAtom);
  const showWidgets = isMobile && widgetsEnabled && isGoApp();
  const widgetsEditing = useAtomValue(goWidgetsEditingAtom);
  const widgetSwipeZone = useAtomValue(nativeSwipeZoneAtom);
  const mobileSectionOrder = useMemo(
    () => mobileSectionOrderFor(mobileTabOrder, showWidgets),
    [showWidgets, mobileTabOrder]
  );
  const goToMobileSection = useCallback(
    (section: MobileSectionKey) => {
      if (section === 'widgets') setDesktopViewMode('widgets');
      else goToMobileTab(section);
    },
    [goToMobileTab, setDesktopViewMode]
  );
  // Switched off while showing: back to Home.
  useEffect(() => {
    if (desktopViewMode === 'widgets' && !showWidgets) {
      setDesktopViewMode('home');
    }
  }, [desktopViewMode, showWidgets, setDesktopViewMode]);
  useSectionSwipe(mainContentRef, {
    enabled:
      isMobile &&
      currentMobileTab !== null &&
      desktopViewMode !== 'dev' &&
      !(currentMobileTab === 'apps' && qappFrameOnScreen) &&
      !mobileGroupPanelOpen &&
      // Arranging widgets: drags are the widgets'.
      !(currentMobileTab === 'widgets' && widgetsEditing),
    bar: mobileTabBarElement,
    barEnabled:
      isMobile &&
      currentMobileTab !== null &&
      desktopViewMode !== 'dev' &&
      !mobileGroupPanelOpen,
    current: currentMobileTab,
    onNavigate: goToMobileSection,
    externalTouches: widgetSwipeFeed,
    nativeZone: widgetSwipeZone,
    reducedMotion: immersiveMotionReduced(),
    // A Q-App ends above the round buttons once Apps is current; Home and
    // Chat (immersive mode on) scroll on behind them (GO_TAB_BAR_SPACE is
    // that room, 0 when they don't).
    peekPaddingBottom: qappFrameOnScreen ? { apps: GO_TAB_BAR_SPACE } : {},
    order: mobileSectionOrder,
  });

  const setDesktopSideViewFromRail = useCallback(
    (view: 'groups' | 'directs') => {
      if (reticulumChatEnabled && view === 'directs') {
        setDesktopSideView((currentView) =>
          currentView === 'directs' ? 'groups' : 'directs'
        );
        return;
      }
      setDesktopSideView(view);
    },
    [reticulumChatEnabled]
  );

  // The chat header's back arrow slides the list over the conversation rather
  // than tearing it down, so switching channels keeps the thread warm.
  const openMobileListPanel = useCallback(() => {
    setDesktopSideView(selectedGroupRef.current ? 'groups' : 'directs');
    setMobileListPanelOpen(true);
  }, []);

  // Picking a conversation from the slide-in list dismisses the panel so the
  // thread underneath becomes visible.
  const selectDirectFromList = useCallback((direct) => {
    setMobileListPanelOpen(false);
    setSelectedDirect(direct);
  }, []);

  const startNewChatFromList = useCallback((value) => {
    setMobileListPanelOpen(false);
    setNewChat(value);
  }, []);

  // A DM message search result: open that chat, scrolled to the message
  // (ChatDirect takes the jump), the way a tap on its list row opens it.
  const openDirectSearchResult = useCallback(
    (hit: DirectSearchHit, direct: { address?: string }) => {
      setDirectMessageSearchOpen(false);
      setDirectMessageJump({
        address: hit.peerAddress,
        eventId: hit.messageId,
        nonce: Date.now(),
      });
      setMobileListPanelOpen(false);
      setSelectedDirect({ ...direct, address: hit.peerAddress });
      setNewChat(false);
      setIsOpenDrawer(false);
      window
        .sendMessage?.('addTimestampEnterChat', {
          timestamp: Date.now(),
          groupId: hit.peerAddress,
        })
        ?.catch?.(() => undefined);
      getTimestampEnterChat();
    },
    [getTimestampEnterChat, setDirectMessageJump]
  );

  const handleNotifyAdminClick = useCallback(
    (e: { currentTarget: HTMLElement | null }) => {
      const address = e.currentTarget?.getAttribute('data-admin-address');
      const admin = adminsWithNames.find((a) => a?.address === address);
      if (admin) notifyAdmin(admin);
    },
    [adminsWithNames, notifyAdmin]
  );

  const selectGroupFunc = useCallback(
    (group) => {
      setMobileViewMode('group');
      setDesktopSideView('groups');
      setMobileListPanelOpen(false);
      initiatedGetMembers.current = false;
      clearAllQueues();
      setSelectedDirect(null);
      setTriedToFetchSecretKey(false);
      setNewChat(false);
      secretKeyAuthRetriesRef.current = 0;
      setSelectedGroup(group);
      setUserInfoForLevels({});
      setSecretKey(null);
      secretKeyRef.current = null;
      threadKeyLoadRef.current = null;
      setIsLoadingThreadKey(false);
      lastFetchedSecretKey.current = null;
      setSecretKeyPublishDate(null);
      setAdmins([]);
      setSecretKeyDetails(null);
      setAdminsWithNames([]);
      setGroupOwner(null);
      setMembers([]);
      setMemberCountFromSecretKeyData(null);
      setHideCommonKeyPopup(false);
      setFirstSecretKeyInCreation(false);
      setGroupSection('chat');
      bumpReticulumReadEntryToken();
      setIsOpenDrawer(false);
      setIsForceShowCreationKeyPopup(false);
    },
    [bumpReticulumReadEntryToken]
  );

  // Something shared from another app ("GO Groups", "GO DMs" or "GO Self-DM"
  // in the share sheet, see Chat/share/): the Groups or DM list comes up with
  // the share in its header, and the chat tapped there takes it. Self-DM puts
  // it straight into Saved Messages.
  const [pendingChatShare, setPendingChatShare] = useAtom(pendingChatShareAtom);
  const pendingChatShareRef = useRef(pendingChatShare);
  pendingChatShareRef.current = pendingChatShare;
  const handOverChatShare = useCallback(
    (chat: ChatShareChat) => {
      const share = pendingChatShareRef.current;
      if (!share) return;
      pendingChatShareRef.current = null;
      setPendingChatShare(null);
      // Queued before the chat opens: it goes in once the chat's draft is.
      // A group's channel step names the channel to open first; a share a
      // chat handed back forgets the one picked then.
      queueChatShareFor(chatShareKey(chat), {
        ...share,
        channelId: chat.kind === 'group' ? chat.channelId : undefined,
      });
    },
    [setPendingChatShare]
  );
  // The group tapped while a share waits (phones): its channels come up over
  // the Groups list first (ChatShareChannelStep), and the channel tapped
  // there takes the share; a group with one channel to post in goes
  // straight in.
  const [shareChannelGroup, setShareChannelGroup] = useState<any>(null);
  // Row taps in the lists (not the other ways a chat opens) take the share.
  const selectGroupFromList = useCallback(
    (group) => {
      const groupId = String(group?.groupId ?? '');
      const isGroupId = /^[1-9]\d*$/.test(groupId);
      if (
        isGroupId &&
        pendingChatShareRef.current &&
        isMobile &&
        reticulumChatEnabled
      ) {
        setShareChannelGroup(group);
        return;
      }
      if (isGroupId) handOverChatShare({ kind: 'group', groupId });
      selectGroupFunc(group);
    },
    [handOverChatShare, isMobile, reticulumChatEnabled, selectGroupFunc]
  );
  const pickShareChannel = useCallback(
    (channelId: string | null) => {
      const group = shareChannelGroup;
      setShareChannelGroup(null);
      if (!group) return;
      handOverChatShare({
        kind: 'group',
        groupId: String(group.groupId),
        ...(channelId ? { channelId } : {}),
      });
      selectGroupFunc(group);
    },
    [handOverChatShare, selectGroupFunc, shareChannelGroup]
  );
  // The step belongs to the waiting share and the Groups list: it closes
  // with the share (X, sent, account switch) or on a swipe to the DMs.
  useEffect(() => {
    if (!pendingChatShare || desktopSideView !== 'groups') {
      setShareChannelGroup(null);
    }
  }, [desktopSideView, pendingChatShare]);
  // Back on the channel step goes back to the Groups list; the share waits.
  useAndroidBack(
    () => {
      setShareChannelGroup(null);
      return true;
    },
    {
      priority: BACK_PRIORITY.overlay,
      enabled: isMobile && Boolean(shareChannelGroup),
    }
  );
  const selectDirectFromShareList = useCallback(
    (direct) => {
      if (typeof direct?.address === 'string' && direct.address) {
        handOverChatShare({ kind: 'dm', address: direct.address });
      }
      selectDirectFromList(direct);
    },
    [handOverChatShare, selectDirectFromList]
  );
  const handledChatShareIdRef = useRef<number | null>(null);
  useEffect(() => {
    const share = pendingChatShare;
    if (!share || handledChatShareIdRef.current === share.id) return;
    // The lists and Saved Messages are the Reticulum chat's.
    if (!reticulumChatEnabled || !myAddress) return;
    handledChatShareIdRef.current = share.id;
    openQChatTab();
    // The list itself: no chat, panel, dialog or older channel step over it.
    setShareChannelGroup(null);
    setSelectedGroup(null);
    setSelectedDirect(null);
    setNewChat(false);
    setMobileListPanelOpen(false);
    setGroupSection('chat');
    setDirectMessageSearchOpen(false);
    setOpenFindGroup(false);
    setOpenAddGroup(false);
    if (share.scope === 'groups') {
      setChatMode('groups');
      setDesktopSideView('groups');
      return;
    }
    setDesktopSideView('directs');
    if (share.scope !== 'self') return;
    const savedMessages = displayDirects?.find(
      (direct) => direct?.savedMessages === true
    ) ?? {
      address: myAddress,
      name: 'Saved Messages',
      reticulumDirect: true,
      savedMessages: true,
      unreadCount: 0,
    };
    handOverChatShare({ kind: 'dm', address: myAddress });
    // As a tap on its row.
    selectDirectFromList(savedMessages);
    window
      .sendMessage?.('addTimestampEnterChat', {
        timestamp: Date.now(),
        groupId: myAddress,
      })
      ?.catch?.(() => undefined);
    getTimestampEnterChat();
  }, [
    displayDirects,
    getTimestampEnterChat,
    handOverChatShare,
    myAddress,
    pendingChatShare,
    reticulumChatEnabled,
    selectDirectFromList,
  ]);
  // Back on the list drops the waiting share, like the X beside it.
  useAndroidBack(
    () => {
      setPendingChatShare(null);
      return true;
    },
    {
      priority: BACK_PRIORITY.sheet,
      enabled:
        isMobile &&
        Boolean(pendingChatShare) &&
        desktopViewMode === 'chat' &&
        !selectedGroup &&
        !selectedDirect &&
        !newChat,
    }
  );

  const openTopGroupQortalLand = useCallback(() => {
    if (!reticulumEnabled) {
      executeEvent('openGlobalSnackBar', {
        message: 'Enable Reticulum to enter QortalLand.',
        type: 'info',
        duration: 4800,
      });
      return;
    }

    const availableGroups =
      memberGroupsWithReticulumActivity.length > 0
        ? memberGroupsWithReticulumActivity
        : memberGroupsForReticulum;
    const [topGroup] = orderReticulumGroups(
      availableGroups,
      readReticulumGroupOrder()
    );

    if (!topGroup?.groupId) {
      executeEvent('openGlobalSnackBar', {
        message: 'Join a Q-Chat group to enter QortalLand.',
        type: 'info',
        duration: 4800,
      });
      return;
    }

    // Begin downloading the game bundle while Q-Chat resolves the selected
    // group's membership/key state instead of waiting for that work to finish.
    void loadQortalLandModule();
    selectGroupFunc(topGroup);
    setMountedLandGroupId(String(topGroup.groupId));
    setGroupSection('land');
    openQChatTab();
  }, [
    memberGroupsForReticulum,
    memberGroupsWithReticulumActivity,
    reticulumEnabled,
    selectGroupFunc,
  ]);
  // Home is memoized: hand it one function that stays the same.
  const openTopGroupQortalLandForHome = useLatestCallback(
    openTopGroupQortalLand
  );

  const selectedGroupIdKey = selectedGroup?.groupId
    ? String(selectedGroup.groupId)
    : '';
  const canManageReticulumGroup = Boolean(
    reticulumAdminGroupIds.has(Number(selectedGroup?.groupId)) ||
    admins.includes(myAddress) ||
    groupOwner?.owner === myAddress
  );
  useEffect(() => {
    if (
      !reticulumChatEnabled ||
      isPrivate !== true ||
      !canManageReticulumGroup ||
      !selectedGroupIdKey
    ) {
      setReticulumJoinRequestCount(0);
      return;
    }

    let cancelled = false;
    const refreshJoinRequestCount = async () => {
      try {
        const response = await fetch(
          `${getBaseApiReact()}/groups/joinrequests/${selectedGroupIdKey}?limit=0`
        );
        if (!response.ok) {
          throw new Error(`Unable to load join requests (${response.status})`);
        }
        const requests = await response.json();
        if (!cancelled) {
          setReticulumJoinRequestCount(
            Array.isArray(requests) ? requests.length : 0
          );
        }
      } catch (error) {
        console.error(
          '[ReticulumChat] Failed to refresh selected-group join requests:',
          error
        );
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshJoinRequestCount();
      }
    };

    void refreshJoinRequestCount();
    const refreshTimer = window.setInterval(refreshJoinRequestCount, 30_000);
    window.addEventListener('focus', refreshJoinRequestCount);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', refreshJoinRequestCount);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [
    canManageReticulumGroup,
    isPrivate,
    reticulumChatEnabled,
    selectedGroupIdKey,
  ]);
  const handleReticulumJoinRequestCountChange = useCallback((count: number) => {
    setReticulumJoinRequestCount(Math.max(0, Number(count) || 0));
  }, []);
  const canMountQortalLand = Boolean(
    reticulumEnabled &&
    selectedGroup &&
    (reticulumChatEnabled ||
      (triedToFetchSecretKey &&
        !notPartOfKeys &&
        !(admins.includes(myAddress) && !secretKey && isPrivate)))
  );
  const shouldMountGroupSection = useCallback(
    (section: string) => {
      if (section === 'land') {
        if (!reticulumEnabled) return false;
        return (
          groupSection === section || mountedLandGroupId === selectedGroupIdKey
        );
      }
      return groupSection === section;
    },
    [groupSection, mountedLandGroupId, reticulumEnabled, selectedGroupIdKey]
  );

  useEffect(() => {
    if (!reticulumEnabled && groupSection === 'land') {
      setGroupSection('chat');
    }
  }, [groupSection, reticulumEnabled]);

  // Keep a ref to selectGroupFunc so earlier-defined callbacks can invoke it
  // (avoids a temporal-dead-zone reference to the const above).
  useEffect(() => {
    selectGroupFuncRef.current = selectGroupFunc;
  }, [selectGroupFunc]);

  const renderQChatTabContent = ({
    hide = false,
    isSelected,
    phoneSection = false,
  }: {
    hide?: boolean;
    isSelected: boolean;
    /** The phone's Chat section (not a desktop Q-Chat tab). */
    phoneSection?: boolean;
  }) => {
    const isVisible = isSelected && !hide;
    const isInQChatSurface =
      desktopViewMode === 'apps' ||
      desktopViewMode === 'dev' ||
      desktopViewMode === 'chat';
    // On mobile the list and the open chat can't sit side-by-side; switch to a
    // single column (list OR chat detail) so the chat pane is actually visible.
    const inChatDetail = !!(selectedDirect || selectedGroup || newChat);
    const showMobileListPanel = !inChatDetail || mobileListPanelOpen;
    // GO tablets: the list pinned beside the chat. Same elements either way;
    // with twoPane false every field is the old single-column expression.
    const twoPane = chatTwoPane && phoneSection;
    const chatPane = getChatPaneLayout({
      twoPane,
      isMobile,
      inChatDetail,
      directOpen: !!(selectedDirect || newChat),
      desktopSideView,
      mobileListPanelOpen,
      mobileGroupPanelOpen,
    });
    const { dmSideView, listPinned } = chatPane;
    const isGroupContentVisible =
      isVisible &&
      !isReticulumDirectOverlayOpen &&
      !(
        (!reticulumChatEnabled || reticulumDirectsInline) &&
        dmSideView === 'directs' &&
        (newChat || selectedDirect)
      );

    const renderGroupList = (keepPhoneList: boolean) => (
      <GroupList
        selectGroupFunc={selectGroupFromList}
        setDesktopSideView={setDesktopSideViewFromRail}
        desktopSideView={desktopSideView}
        directChatHasUnread={directChatHasUnread}
        directChatUnreadCount={reticulumDirectUnreadCount}
        chatMode={chatMode}
        // Two-pane with a DM on the right: no group highlighted beside it.
        selectedGroup={chatPane.suppressGroupHighlight ? null : selectedGroup}
        getUserSettings={getUserSettings}
        setOpenAddGroup={setOpenAddGroup}
        setOpenFindGroup={setOpenFindGroup}
        setIsOpenBlockedUserModal={setIsOpenBlockedUserModal}
        myAddress={myAddress}
        reticulumChatEnabled={reticulumChatEnabled}
        keepPhoneList={keepPhoneList}
        hideMobileHeader={isMobile && reticulumChatEnabled}
      />
    );
    const renderDirectsSidebar = () => (
      <DirectsSidebar
        setDesktopSideView={setDesktopSideViewFromRail}
        desktopSideView={desktopSideView}
        directChatHasUnread={directChatHasUnread}
        directs={displayDirects}
        dmFriendsByAddress={dmFriendsByAddress}
        setSelectedDirect={selectDirectFromShareList}
        setNewChat={startNewChatFromList}
        setIsOpenDrawer={setIsOpenDrawer}
        getTimestampEnterChat={getTimestampEnterChat}
        selectedDirect={selectedDirect}
        timestampEnterData={timestampEnterData}
        timeDifferenceForNotificationChats={timeDifferenceForNotificationChats}
        myAddress={myAddress}
        isRunningPublicNode={isRunningPublicNode}
        setIsOpenBlockedUserModal={setIsOpenBlockedUserModal}
        reticulumChatEnabled={reticulumChatEnabled}
        hideMobileHeader={isMobile && reticulumChatEnabled}
      />
    );

    return (
      <Box
        // An open chat keeps its own sideways gestures (the list's edge
        // swipe, messages): no switching sections from there. A pinned list
        // moves this onto the detail pane.
        {...(chatPane.ignoreSectionSwipeOnRoot
          ? { [SECTION_SWIPE_IGNORE_ATTR]: '' }
          : {})}
        onTouchStart={
          chatPane.edgeSwipeEnabled && swipeBackFrom === null
            ? (event) => {
                const touch = event.touches[0];
                mobileEdgeSwipeRef.current =
                  touch && touch.clientX <= EDGE_SWIPE_ZONE_PX
                    ? { x: touch.clientX, y: touch.clientY }
                    : null;
              }
            : undefined
        }
        onTouchMove={
          chatPane.edgeSwipeEnabled && swipeBackFrom === null
            ? (event) => {
                const start = mobileEdgeSwipeRef.current;
                const touch = event.touches[0];
                if (!start || !touch) return;
                const dx = touch.clientX - start.x;
                const dy = Math.abs(touch.clientY - start.y);
                if (dx > EDGE_SWIPE_OPEN_PX && dy < dx) {
                  mobileEdgeSwipeRef.current = null;
                  setMobileListPanelOpen(true);
                }
              }
            : undefined
        }
        onTouchEnd={
          isMobile ? () => (mobileEdgeSwipeRef.current = null) : undefined
        }
        sx={{
          backgroundColor: 'background.default',
          display: 'flex',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
          width: '100%',
        }}
      >
        {reticulumChatEnabled && (
          <Suspense fallback={null}>
            <LazyFindGroupOverviewModal />
          </Suspense>
        )}
        {isMobile && reticulumChatEnabled && (
          <DirectMessageSearchPanel
            open={directMessageSearchOpen}
            onClose={() => setDirectMessageSearchOpen(false)}
            myAddress={myAddress}
            directs={displayDirects}
            onOpenResult={openDirectSearchResult}
          />
        )}
        {chatPane.listOverlayOpen && (
          <Box
            onClick={() => setMobileListPanelOpen(false)}
            onTouchStart={(event) => {
              const touch = event.touches[0];
              mobilePanelSwipeRef.current = touch
                ? { x: touch.clientX, y: touch.clientY }
                : null;
            }}
            onTouchMove={(event) => {
              const start = mobilePanelSwipeRef.current;
              const touch = event.touches[0];
              if (!start || !touch) return;
              const dx = start.x - touch.clientX;
              const dy = Math.abs(touch.clientY - start.y);
              if (dx > EDGE_SWIPE_OPEN_PX && dy < dx) {
                mobilePanelSwipeRef.current = null;
                setMobileListPanelOpen(false);
              }
            }}
            onTouchEnd={() => (mobilePanelSwipeRef.current = null)}
            sx={{
              backgroundColor: alpha(theme.palette.common.black, 0.45),
              inset: 0,
              position: 'absolute',
              zIndex: 39,
            }}
          />
        )}
        <Box
          ref={phoneSection ? setPhoneChatListPanelEl : undefined}
          onTouchStart={
            chatPane.listOverlayOpen
              ? (event) => {
                  const touch = event.touches[0];
                  mobilePanelSwipeRef.current = touch
                    ? { x: touch.clientX, y: touch.clientY }
                    : null;
                }
              : undefined
          }
          onTouchMove={
            chatPane.listOverlayOpen
              ? (event) => {
                  const start = mobilePanelSwipeRef.current;
                  const touch = event.touches[0];
                  if (!start || !touch) return;
                  const dx = start.x - touch.clientX;
                  const dy = Math.abs(touch.clientY - start.y);
                  if (dx > EDGE_SWIPE_OPEN_PX && dy < dx) {
                    mobilePanelSwipeRef.current = null;
                    setMobileListPanelOpen(false);
                  }
                }
              : undefined
          }
          onTouchEnd={
            isMobile ? () => (mobilePanelSwipeRef.current = null) : undefined
          }
          sx={{
            display: 'flex',
            flexShrink: 0,
            minHeight: 0,
            // On phones the list is a panel that slides in from the left: it
            // fills the screen when no chat is open and overlays the
            // conversation when swiped in from the edge.
            ...(isMobile
              ? {
                  bottom: 0,
                  boxShadow: mobileListPanelOpen
                    ? `0 0 28px ${alpha(theme.palette.common.black, 0.45)}`
                    : 'none',
                  left: 0,
                  maxWidth: inChatDetail ? 400 : 'none',
                  pointerEvents: showMobileListPanel ? 'auto' : 'none',
                  position: 'absolute',
                  top: 0,
                  transform: showMobileListPanel
                    ? 'translateX(0)'
                    : 'translateX(-100%)',
                  transition: 'transform 220ms cubic-bezier(0.2, 0, 0, 1)',
                  width: inChatDetail ? '86%' : '100%',
                  zIndex: 40,
                }
              : {}),
            // GO two-pane: a fixed column beside the chat, in the flow.
            ...(listPinned
              ? {
                  borderRight: `1px solid ${theme.palette.divider}`,
                  boxShadow: 'none',
                  flexBasis: CHAT_LIST_PANE_WIDTH,
                  maxWidth: 'none',
                  pointerEvents: 'auto',
                  position: 'relative',
                  transform: 'none',
                  transition: 'none',
                  width: CHAT_LIST_PANE_WIDTH,
                  zIndex: 'auto',
                }
              : {}),
          }}
        >
          {isMobile && reticulumChatEnabled ? (
            // Phones: Groups and DMs are two pages side by side on the home
            // screen, so a sideways swipe moves between them like the switch
            // does. Over an open chat only the current list shows, as before.
            // One header stays above both: only the lists slide, and the
            // switch's pill moves with them.
            <Box
              sx={{
                ...getChatListPanelSx(theme),
                display: 'flex',
                flex: '1 1 auto',
                flexDirection: 'column',
                minHeight: 0,
                minWidth: 0,
                width: '100%',
              }}
            >
              <MobileChatListPager
                ref={phoneSection ? phoneChatListPagerRef : undefined}
                header={
                  <MobileChatListHeader
                    ref={mobileChatListHeaderRef}
                    scope={desktopSideView === 'directs' ? 'directs' : 'groups'}
                    // The lists glide over first, then the scope switches
                    // (re-rendering the chat would hold the slide back).
                    onScopeChange={(scope) => {
                      const pager = phoneSection
                        ? phoneChatListPagerRef.current
                        : null;
                      if (pager) pager.slideTo(scope);
                      else setDesktopSideViewFromRail(scope);
                    }}
                    directHasUnread={directChatHasUnread}
                    directUnreadCount={reticulumDirectUnreadCount}
                    onFindGroups={() => setOpenFindGroup(true)}
                    onCreateGroup={() => setOpenAddGroup(true)}
                    onSearchMessages={() => setDirectMessageSearchOpen(true)}
                    onNewChat={() => {
                      startNewChatFromList(true);
                      selectDirectFromList(null);
                      setIsOpenDrawer(false);
                    }}
                    share={pendingChatShare}
                    sharePicksChannel={Boolean(shareChannelGroup)}
                    onCancelShare={() => setPendingChatShare(null)}
                  />
                }
                swipeEnabled={isChatListSwipeEnabled({
                  inChatDetail,
                  isVisible,
                  twoPane: listPinned,
                })}
                scope={desktopSideView === 'directs' ? 'directs' : 'groups'}
                // Sets the list (never toggles it, as the desktop rail
                // does): the pager may ask twice for the same one.
                onScopeChange={setDesktopSideView}
                onTrackPosition={(position, durationMs, easing) =>
                  mobileChatListHeaderRef.current?.setPosition(
                    position,
                    durationMs,
                    easing
                  )
                }
                renderGroups={(keepPhoneList) => (
                  <>
                    {renderGroupList(keepPhoneList)}
                    {shareChannelGroup && pendingChatShare ? (
                      <ChatShareChannelStep
                        group={shareChannelGroup}
                        isAdmin={reticulumAdminGroupIds.has(
                          Number(shareChannelGroup.groupId)
                        )}
                        onBack={() => setShareChannelGroup(null)}
                        onPick={pickShareChannel}
                      />
                    ) : null}
                  </>
                )}
                renderDirects={(mounted) =>
                  mounted ? renderDirectsSidebar() : null
                }
              />
            </Box>
          ) : (
            <>
              {!showDirectsList || reticulumChatEnabled ? (
                // The DM list owns the whole column on phones; the group rail
                // would only steal 72px from it. Hidden rather than unmounted
                // so the list keeps its order, avatars and unread state.
                <Box
                  sx={{
                    display: isMobile && showDirectsList ? 'none' : 'contents',
                  }}
                >
                  {renderGroupList(false)}
                </Box>
              ) : null}
              {showDirectsList && renderDirectsSidebar()}
            </>
          )}
        </Box>

        <Box
          ref={phoneSection ? setPhoneChatDetailEl : undefined}
          {...(chatPane.ignoreSectionSwipeOnDetail
            ? { [SECTION_SWIPE_IGNORE_ATTR]: '' }
            : {})}
          sx={{
            flex: 1,
            height: '100%',
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
            position: 'relative',
            // Two-pane: always shown; with nothing open the empty states
            // fill it. Never container-type here: it would trap the
            // position:fixed composer and popups inside the pane.
            display: chatPane.showDetail ? 'block' : 'none',
            ...(isMobile ? { width: listPinned ? 'auto' : '100%' } : {}),
            // The swipe back from a DM: a sideways drag never scrolls the
            // messages (vertical scrolling stays the browser's).
            ...(phoneSection && swipeBackFrom !== null
              ? {
                  '& [data-reticulum-chat-scroll-viewport], & [data-reticulum-chat-scroll-viewport] > *':
                    { touchAction: SECTION_SURFACE_TOUCH_ACTION },
                }
              : {}),
          }}
        >
          {newChat && (!reticulumChatEnabled || reticulumDirectsInline) && (
            <NewChatOverlay isChatMode={isVisible}>
              <ChatDirect
                myAddress={myAddress}
                isNewChat={newChat}
                selectedDirect={undefined}
                setSelectedDirect={setSelectedDirect}
                setNewChat={setNewChat}
                getTimestampEnterChat={getTimestampEnterChat}
                close={closeChatDirect}
                setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
                isActive={isVisible}
                reticulumEnabled={reticulumEnabled}
                reticulumChatEnabled={reticulumChatEnabled}
              />
            </NewChatOverlay>
          )}

          {isVisible &&
            !selectedDirect &&
            !newChat &&
            !selectedGroup &&
            !isReticulumDirectOverlayOpen &&
            (reticulumChatEnabled ? (
              hasConfirmedNoReticulumGroups ? (
                <FirstTimeQChatEmptyState
                  onFindCommunities={openGroupDiscovery}
                />
              ) : reticulumActivityDashboardReady ? (
                reticulumHasUnreadActivity ? (
                  <ReturningUserActivityDashboard
                    displayName={reticulumWelcomeDisplayName}
                    groups={memberGroupsWithReticulumActivity}
                    onBrowseCommunities={openGroupDiscovery}
                    onSelectGroup={selectGroupFunc}
                  />
                ) : (
                  <ReturningUserCaughtUpState
                    displayName={reticulumWelcomeDisplayName}
                    onBrowseCommunities={openGroupDiscovery}
                  />
                )
              ) : (
                <CenterBox>
                  <CircularProgress size={28} />
                </CenterBox>
              )
            ) : (
              <CenterBox>
                <NoSelectionTypography>
                  {t('group:message.generic.no_selection', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </NoSelectionTypography>
              </CenterBox>
            ))}

          <SelectedGroupWrapper
            isVisible={
              isVisible &&
              !!selectedGroup &&
              ((reticulumChatEnabled &&
                !(reticulumDirectsInline && (selectedDirect || newChat))) ||
                (desktopSideView !== 'directs' && !selectedDirect && !newChat))
            }
          >
            {reticulumChatEnabled && (
              <Box
                aria-hidden={groupSection === 'chat'}
                sx={{
                  left: 0,
                  pointerEvents: groupSection === 'chat' ? 'none' : 'auto',
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  visibility: groupSection === 'chat' ? 'hidden' : 'visible',
                  zIndex: 3,
                }}
              >
                {isMobile && mobileSectionPanelOpen ? (
                  // Phones: the same panel header as Calendar, Files, Members
                  // and Admin keys; the X returns to the chat.
                  <MobilePanelHeader
                    safeAreaTop
                    icon={
                      groupSection === 'land' ? (
                        <PublicRoundedIcon />
                      ) : (
                        <ForumRoundedIcon />
                      )
                    }
                    title={
                      groupSection === 'land'
                        ? t('group:chat_group.qortal_land')
                        : t('group:panel.threads', {
                            postProcess: 'capitalizeFirstChar',
                          })
                    }
                    actions={
                      groupSection === 'land' &&
                      reticulumEnabled &&
                      gcallGroupNumericId !== null ? (
                        <IconButton
                          aria-label={t(
                            gcallRoomState === 'joining'
                              ? 'core:group_call_joining'
                              : inThisGroupGcall &&
                                  gcallRoomState === 'connected'
                                ? 'core:group_call_leave'
                                : 'core:group_call',
                            { postProcess: 'capitalizeFirstChar' }
                          )}
                          disabled={
                            inOtherGcall || gcallRoomState === 'joining'
                          }
                          onClick={handleGroupCallHeaderClick}
                          sx={{ color: 'text.secondary', flexShrink: 0 }}
                        >
                          {gcallRoomState === 'joining' ? (
                            <CircularProgress
                              size={20}
                              sx={{ color: 'inherit' }}
                            />
                          ) : inThisGroupGcall &&
                            gcallRoomState === 'connected' ? (
                            <CallEndRoundedIcon />
                          ) : (
                            <CallIcon />
                          )}
                        </IconButton>
                      ) : null
                    }
                    onClose={goToChat}
                  />
                ) : (
                  <ReticulumGroupSectionHeader
                    activeSection={groupSection}
                    calendarOpen={reticulumCalendarOpen}
                    canManageReticulumGroup={canManageReticulumGroup}
                    sectionLabel={
                      groupSection === 'land'
                        ? selectedGroup?.groupName || 'Group'
                        : groupSection === 'forum'
                          ? 'Threads'
                          : groupSection === 'members'
                            ? 'Members'
                            : selectedGroup?.groupName || 'Group'
                    }
                    onCalendarClick={() => {
                      const groupId = Number(selectedGroup?.groupId);
                      if (!Number.isInteger(groupId) || groupId <= 0) return;
                      setReticulumCalendarTarget({
                        groupId,
                        eventId: '',
                        occurrenceStart: Date.now(),
                        timezone: '',
                      });
                      setReticulumCalendarOpenRequest((value) => value + 1);
                    }}
                    onGroupCallClick={
                      reticulumEnabled && gcallGroupNumericId !== null
                        ? handleGroupCallHeaderClick
                        : undefined
                    }
                    onModeSwitchClick={
                      groupSection === 'land' ? goToChat : undefined
                    }
                    onThreadsClick={goToThreads}
                    groupCallInCall={
                      inThisGroupGcall && gcallRoomState === 'connected'
                    }
                    groupCallJoining={gcallRoomState === 'joining'}
                    groupCallDisabled={inOtherGcall}
                    groupCallTooltip={
                      inOtherGcall
                        ? t('core:group_call_blocked', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : ''
                    }
                    membersPanelOpen={reticulumMembersPanelOpen}
                    membersNotificationCount={reticulumJoinRequestCount}
                    onMembersClick={toggleReticulumMembersPanel}
                  />
                )}
              </Box>
            )}
            {!reticulumChatEnabled && (
              <DesktopHeader
                isPrivate={isPrivate}
                selectedGroup={selectedGroup}
                groupSection={groupSection}
                isUnread={isUnread}
                goToAnnouncements={goToAnnouncements}
                goToChat={goToChat}
                goToThreads={goToThreads}
                setOpenManageMembers={setOpenManageMembers}
                directChatHasUnread={directChatHasUnread}
                chatMode={chatMode}
                openDrawerGroups={openDrawerGroups}
                goToHome={goToHome}
                mobileViewMode={mobileViewMode}
                setMobileViewMode={setMobileViewMode}
                setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
                hasUnreadDirects={directChatHasUnread}
                isHome={groupSection === 'home'}
                isGroups={desktopSideView === 'groups'}
                isDirects={desktopSideView === 'directs'}
                setDesktopSideView={setDesktopSideView}
                hasUnreadAnnouncements={isUnread}
                isAnnouncement={groupSection === 'announcement'}
                isChat={groupSection === 'chat'}
                isQortalLand={groupSection === 'land'}
                setGroupSection={setGroupSection}
                isForum={groupSection === 'forum'}
                onGroupCallClick={
                  reticulumEnabled && gcallGroupNumericId !== null
                    ? handleGroupCallHeaderClick
                    : undefined
                }
                onQortalLandClick={
                  reticulumEnabled ? goToQortalLand : undefined
                }
                groupCallInCall={
                  inThisGroupGcall && gcallRoomState === 'connected'
                }
                groupCallJoining={gcallRoomState === 'joining'}
                groupCallDisabled={inOtherGcall}
                groupCallTooltip={
                  inOtherGcall
                    ? t('core:group_call_blocked', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    : ''
                }
              />
            )}

            <ChatContentBox
              sx={{
                mr: 0,
              }}
            >
              {reticulumChatEnabled && !!selectedGroup && (
                <PersistentSectionLayer active={groupSection === 'chat'}>
                  <ReticulumChatGroup
                    myAddress={myAddress}
                    adminsWithNames={adminsWithNames}
                    isReticulumChannelAdmin={canManageReticulumGroup}
                    reticulumChannelAccessReady={
                      reticulumAdminGroupsLoadedAddress === myAddress &&
                      reticulumMembershipsAppliedKey === reticulumMembershipsKey
                    }
                    selectedGroup={selectedGroup?.groupId}
                    selectedGroupName={
                      selectedGroup?.groupName || selectedGroup?.name || ''
                    }
                    getSecretKey={getNoReticulumGroupSecretKey}
                    secretKey={null}
                    isPrivate={isPrivate}
                    isActive={
                      isVisible &&
                      groupSection === 'chat' &&
                      !isReticulumDirectOverlayOpen &&
                      !mobileDirectConversationOpen
                    }
                    handleNewEncryptionNotification={
                      setNewEncryptionNotification
                    }
                    hide={false}
                    hideView={
                      !(isVisible && selectedGroup) ||
                      (desktopViewMode !== 'apps' && desktopViewMode !== 'dev')
                    }
                    handleSecretKeyCreationInProgress={
                      handleSecretKeyCreationInProgress
                    }
                    triedToFetchSecretKey={true}
                    getTimestampEnterChatParent={getTimestampEnterChat}
                    notificationReticulumChannelId={
                      notificationReticulumChannelId
                    }
                    notificationReticulumMessageId={
                      notificationReticulumMessageId
                    }
                    onGroupCallClick={
                      reticulumEnabled && gcallGroupNumericId !== null
                        ? handleGroupCallHeaderClick
                        : undefined
                    }
                    onQortalLandClick={goToQortalLand}
                    onThreadsClick={goToThreads}
                    onMobileBack={
                      chatPane.phoneBackArrows ? openMobileListPanel : undefined
                    }
                    onMembersClick={toggleReticulumMembersPanel}
                    membersPanelOpen={reticulumMembersPanelOpen}
                    membersNotificationCount={reticulumJoinRequestCount}
                    groupCallInCall={
                      inThisGroupGcall && gcallRoomState === 'connected'
                    }
                    groupCallJoining={gcallRoomState === 'joining'}
                    groupCallDisabled={inOtherGcall}
                    groupCallTooltip={
                      inOtherGcall
                        ? t('core:group_call_blocked', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : ''
                    }
                    onReticulumChannelSelected={handleReticulumChannelSelected}
                    onReticulumNotificationHandled={
                      handleReticulumNotificationHandled
                    }
                    reticulumReadEntryToken={reticulumReadEntryToken}
                    reticulumCalendarOpenRequest={reticulumCalendarOpenRequest}
                    reticulumCalendarTarget={reticulumCalendarTarget}
                    onReticulumCalendarOpenChange={setReticulumCalendarOpen}
                    isGroupOwner={groupOwner?.owner === myAddress}
                  />
                </PersistentSectionLayer>
              )}
              {!reticulumChatEnabled && triedToFetchSecretKey && (
                <PersistentSectionLayer
                  active={
                    groupSection === 'chat' && !selectedDirect && !newChat
                  }
                >
                  <ChatGroup
                    myAddress={myAddress}
                    selectedGroup={selectedGroup?.groupId}
                    selectedGroupName={
                      selectedGroup?.groupName || selectedGroup?.name || ''
                    }
                    getSecretKey={getSecretKey}
                    secretKey={secretKey}
                    isPrivate={isPrivate}
                    isActive={
                      isVisible &&
                      groupSection === 'chat' &&
                      !selectedDirect &&
                      !newChat
                    }
                    setSecretKey={setSecretKey}
                    handleNewEncryptionNotification={
                      setNewEncryptionNotification
                    }
                    hide={false}
                    hideView={
                      !(isVisible && selectedGroup) ||
                      (desktopViewMode !== 'apps' && desktopViewMode !== 'dev')
                    }
                    handleSecretKeyCreationInProgress={
                      handleSecretKeyCreationInProgress
                    }
                    triedToFetchSecretKey={triedToFetchSecretKey}
                    getTimestampEnterChatParent={getTimestampEnterChat}
                    notificationReticulumChannelId={
                      notificationReticulumChannelId
                    }
                    onGroupCallClick={
                      reticulumEnabled && gcallGroupNumericId !== null
                        ? handleGroupCallHeaderClick
                        : undefined
                    }
                    onQortalLandClick={
                      reticulumEnabled ? goToQortalLand : undefined
                    }
                    onAnnouncementsClick={goToAnnouncements}
                    onThreadsClick={goToThreads}
                    onMembersClick={() => setGroupSection('members')}
                    onAdminsClick={() => setGroupSection('adminSpace')}
                    groupCallInCall={
                      inThisGroupGcall && gcallRoomState === 'connected'
                    }
                    groupCallJoining={gcallRoomState === 'joining'}
                    groupCallDisabled={inOtherGcall}
                    groupCallTooltip={
                      inOtherGcall
                        ? t('core:group_call_blocked', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : ''
                    }
                    hasUnreadAnnouncements={isUnread}
                    onReticulumChannelSelected={(channelId) => {
                      const normalizedChannelId = channelId || 'general';
                      setActiveReticulumChannelId((previousChannelId) => {
                        const previous = previousChannelId || 'general';
                        if (previous !== normalizedChannelId) {
                          bumpReticulumReadEntryToken();
                        }
                        return normalizedChannelId;
                      });
                      if (
                        notificationReticulumChannelId &&
                        notificationReticulumChannelId === normalizedChannelId
                      ) {
                        setNotificationReticulumChannelId('');
                      }
                    }}
                    reticulumReadEntryToken={reticulumReadEntryToken}
                  />
                </PersistentSectionLayer>
              )}
              {isPrivate &&
                activeSectionUsesSecretKey &&
                firstSecretKeyInCreation &&
                triedToFetchSecretKey &&
                !secretKeyPublishDate && (
                  <EncryptionKeyMessageDiv>
                    <Typography>
                      {t('group:message.generic.encryption_key', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                  </EncryptionKeyMessageDiv>
                )}

              {reticulumChatEnabled &&
                groupSection === 'forum' &&
                isPrivate &&
                isLoadingThreadKey && (
                  <PersistentSectionLayer
                    active
                    topOffset={isMobile ? MOBILE_PANEL_HEADER_OFFSET : 50}
                  >
                    <CenterBox
                      sx={{
                        backgroundColor: 'background.default',
                        flexDirection: 'column',
                        gap: 1.5,
                      }}
                    >
                      <CircularProgress size={28} />
                      <Typography color="text.secondary" variant="body2">
                        Preparing Threads…
                      </Typography>
                    </CenterBox>
                  </PersistentSectionLayer>
                )}

              {notPartOfKeys && activeSectionUsesSecretKey ? (
                <>
                  {secretKeyPublishDate ||
                  (!secretKeyPublishDate && !firstSecretKeyInCreation) ? (
                    <NotPartGroupDiv>
                      <Paper
                        elevation={0}
                        sx={{
                          maxWidth: 480,
                          p: 3,
                          textAlign: 'center',
                          border: `1px solid ${theme.palette.divider}`,
                          borderRadius: 2,
                          mb: 3,
                        }}
                      >
                        <LockOutlinedIcon
                          sx={{
                            fontSize: 48,
                            color: theme.palette.text.secondary,
                            mb: 2,
                          }}
                        />
                        <Typography
                          variant="subtitle1"
                          sx={{
                            color: theme.palette.text.primary,
                            fontWeight: 500,
                            mb: 1.5,
                          }}
                        >
                          {t('group:message.generic.not_part_group', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            color: theme.palette.warning.main,
                            fontWeight: 600,
                            px: 1,
                          }}
                        >
                          {t('group:message.generic.only_encrypted', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                      </Paper>
                      <Typography
                        variant="body2"
                        sx={{
                          color: theme.palette.text.secondary,
                          mb: 2,
                          textAlign: 'center',
                        }}
                      >
                        {t('group:message.error.notify_admins', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                      <NotPartAdminListBox>
                        {adminsWithNames.map((admin) => (
                          <AdminRowBox key={admin?.address}>
                            <Typography
                              variant="body1"
                              sx={{
                                fontWeight: 500,
                                color: theme.palette.text.primary,
                              }}
                            >
                              {admin?.name}
                            </Typography>
                            <LoadingButton
                              data-admin-address={admin?.address}
                              loading={isLoadingNotifyAdmin}
                              loadingPosition="start"
                              size="small"
                              variant="contained"
                              onClick={handleNotifyAdminClick}
                              sx={{
                                textTransform: 'none',
                                fontWeight: 600,
                              }}
                            >
                              {t('core:action.notify', {
                                postProcess: 'capitalizeFirstChar',
                              })}
                            </LoadingButton>
                          </AdminRowBox>
                        ))}
                      </NotPartAdminListBox>
                    </NotPartGroupDiv>
                  ) : null}
                </>
              ) : admins.includes(myAddress) &&
                !secretKey &&
                isPrivate &&
                triedToFetchSecretKey ? null : !triedToFetchSecretKey ? null : reticulumChatEnabled ? (
                <>
                  {groupSection === 'forum' && (
                    <PersistentSectionLayer
                      active={groupSection === 'forum'}
                      topOffset={isMobile ? MOBILE_PANEL_HEADER_OFFSET : 50}
                    >
                      <GroupForum
                        myAddress={myAddress}
                        selectedGroup={selectedGroup}
                        getSecretKey={getSecretKey}
                        secretKey={secretKey}
                        setSecretKey={setSecretKey}
                        isAdmin={admins.includes(myAddress)}
                        hide={false}
                        defaultThread={defaultThread}
                        setDefaultThread={setDefaultThread}
                        isPrivate={isPrivate}
                      />
                    </PersistentSectionLayer>
                  )}
                </>
              ) : (
                <>
                  <GroupAnnouncements
                    myAddress={myAddress}
                    selectedGroup={selectedGroup?.groupId}
                    getSecretKey={getSecretKey}
                    secretKey={secretKey}
                    setSecretKey={setSecretKey}
                    isAdmin={admins.includes(myAddress)}
                    handleNewEncryptionNotification={
                      setNewEncryptionNotification
                    }
                    hide={groupSection !== 'announcement'}
                    isPrivate={isPrivate}
                  />
                  <GroupForum
                    myAddress={myAddress}
                    selectedGroup={selectedGroup}
                    getSecretKey={getSecretKey}
                    secretKey={secretKey}
                    setSecretKey={setSecretKey}
                    isAdmin={admins.includes(myAddress)}
                    hide={groupSection !== 'forum'}
                    defaultThread={defaultThread}
                    setDefaultThread={setDefaultThread}
                    isPrivate={isPrivate}
                  />
                  {groupSection === 'adminSpace' && (
                    <AdminSpace
                      adminsWithNames={adminsWithNames}
                      hide={groupSection !== 'adminSpace'}
                      isAdmin={admins.includes(myAddress)}
                      isOwner={groupOwner?.owner === myAddress}
                      selectedGroup={selectedGroup?.groupId}
                    />
                  )}
                  {groupSection === 'members' && (
                    <Suspense fallback={null}>
                      <LazyManageMembers
                        inline
                        selectedGroup={selectedGroup}
                        address={myAddress}
                        open
                        setOpen={setOpenManageMembers}
                        isAdmin={admins.includes(myAddress)}
                        isOwner={groupOwner?.owner === myAddress}
                      />
                    </Suspense>
                  )}
                </>
              )}

              {canMountQortalLand && shouldMountGroupSection('land') && (
                <PersistentSectionLayer
                  active={groupSection === 'land'}
                  topOffset={
                    !reticulumChatEnabled
                      ? 0
                      : isMobile
                        ? MOBILE_PANEL_HEADER_OFFSET
                        : 50
                  }
                >
                  <Suspense
                    fallback={
                      <CenterBox
                        sx={{
                          backgroundColor: 'background.default',
                          flexDirection: 'column',
                          gap: 1.5,
                        }}
                      >
                        <CircularProgress size={28} />
                        <Typography color="text.secondary" variant="body2">
                          Entering QortalLand…
                        </Typography>
                      </CenterBox>
                    }
                  >
                    <LazyQortalLand
                      key={selectedGroup?.groupId}
                      groupId={Number(selectedGroup?.groupId)}
                      groupName={
                        selectedGroup?.groupName || selectedGroup?.name || ''
                      }
                      myAddress={myAddress}
                      isActive={
                        isGroupContentVisible && groupSection === 'land'
                      }
                    />
                  </Suspense>
                </PersistentSectionLayer>
              )}

              {!canMountQortalLand &&
                groupSection === 'land' &&
                selectedGroup && (
                  <PersistentSectionLayer
                    active
                    topOffset={
                      !reticulumChatEnabled
                        ? 0
                        : isMobile
                          ? MOBILE_PANEL_HEADER_OFFSET
                          : 50
                    }
                  >
                    <CenterBox
                      sx={{
                        backgroundColor: 'background.default',
                        flexDirection: 'column',
                        gap: 1.5,
                      }}
                    >
                      <CircularProgress size={28} />
                      <Typography color="text.secondary" variant="body2">
                        Preparing QortalLand…
                      </Typography>
                    </CenterBox>
                  </PersistentSectionLayer>
                )}

              <FloatingButtonContainerBox>
                {activeSectionUsesSecretKey &&
                  ((isPrivate &&
                    admins.includes(myAddress) &&
                    shouldReEncrypt &&
                    triedToFetchSecretKey &&
                    !firstSecretKeyInCreation &&
                    !hideCommonKeyPopup) ||
                    isForceShowCreationKeyPopup) && (
                    <CreateCommonSecret
                      isForceShowCreationKeyPopup={isForceShowCreationKeyPopup}
                      setHideCommonKeyPopup={setHideCommonKeyPopup}
                      groupId={selectedGroup?.groupId}
                      secretKey={secretKey}
                      secretKeyDetails={secretKeyDetails}
                      myAddress={myAddress}
                      isOwner={groupOwner?.owner === myAddress}
                      setIsForceShowCreationKeyPopup={
                        setIsForceShowCreationKeyPopup
                      }
                      noSecretKey={
                        admins.includes(myAddress) &&
                        !secretKey &&
                        triedToFetchSecretKey
                      }
                    />
                  )}
              </FloatingButtonContainerBox>
            </ChatContentBox>

            {reticulumChatEnabled &&
              selectedGroup &&
              reticulumMembersPanelOpen && (
                <Box
                  sx={{
                    borderLeft: `1px solid ${theme.palette.divider}`,
                    bottom: 0,
                    boxShadow:
                      groupSection === 'land'
                        ? '-12px 0 24px rgba(0, 0, 0, 0.22)'
                        : 'none',
                    position: 'absolute',
                    right: 0,
                    // Phones show the member list as a full-screen panel with
                    // its own header and X, over the group header; a 280px
                    // rail would leave the chat unusably narrow.
                    top: isMobile ? 0 : 50,
                    width: { xs: '100%', md: 280 },
                    zIndex: reticulumSearchOverlayOpen ? 0 : 8,
                  }}
                >
                  <Suspense fallback={null}>
                    <LazyManageMembers
                      inline
                      reticulumSidebar
                      selectedGroup={selectedGroup}
                      address={myAddress}
                      open
                      setOpen={setOpenManageMembers}
                      isAdmin={admins.includes(myAddress)}
                      isOwner={groupOwner?.owner === myAddress}
                      isPrivate={isPrivate === true}
                      joinRequestCount={reticulumJoinRequestCount}
                      onJoinRequestCountChange={
                        handleReticulumJoinRequestCountChange
                      }
                      onClose={
                        isMobile ? closeReticulumMembersPanel : undefined
                      }
                    />
                  </Suspense>
                </Box>
              )}

            {openManageMembers && !reticulumChatEnabled && (
              <Suspense fallback={null}>
                <LazyManageMembers
                  selectedGroup={selectedGroup}
                  address={myAddress}
                  open={openManageMembers}
                  setOpen={setOpenManageMembers}
                  isAdmin={admins.includes(myAddress)}
                  isOwner={groupOwner?.owner === myAddress}
                />
              </Suspense>
            )}
          </SelectedGroupWrapper>

          <Suspense fallback={null}>
            <LazyBlockedUsersModal />
          </Suspense>

          {isReticulumDirectOverlayOpen && (
            <Box
              sx={{
                backgroundColor: 'background.default',
                bottom: 0,
                boxShadow: '-18px 0 36px rgba(0, 0, 0, 0.26)',
                display: 'flex',
                left: 0,
                minHeight: 0,
                minWidth: 0,
                position: 'absolute',
                right: 0,
                top: 0,
                zIndex: 16,
              }}
            >
              <DirectsSidebar
                setDesktopSideView={setDesktopSideViewFromRail}
                desktopSideView={desktopSideView}
                directChatHasUnread={directChatHasUnread}
                directs={displayDirects}
                dmFriendsByAddress={dmFriendsByAddress}
                setSelectedDirect={setSelectedDirect}
                setNewChat={setNewChat}
                setIsOpenDrawer={setIsOpenDrawer}
                getTimestampEnterChat={getTimestampEnterChat}
                selectedDirect={selectedDirect}
                timestampEnterData={timestampEnterData}
                timeDifferenceForNotificationChats={
                  timeDifferenceForNotificationChats
                }
                myAddress={myAddress}
                isRunningPublicNode={isRunningPublicNode}
                setIsOpenBlockedUserModal={setIsOpenBlockedUserModal}
                reticulumChatEnabled={reticulumChatEnabled}
              />
              <Box
                sx={{
                  backgroundColor: 'background.default',
                  display: 'flex',
                  flex: 1,
                  minHeight: 0,
                  minWidth: 0,
                  position: 'relative',
                }}
              >
                {newChat ? (
                  <ChatDirect
                    myAddress={myAddress}
                    isNewChat={newChat}
                    selectedDirect={undefined}
                    setSelectedDirect={setSelectedDirect}
                    setNewChat={setNewChat}
                    getTimestampEnterChat={getTimestampEnterChat}
                    close={closeChatDirect}
                    setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
                    isActive={isVisible && isReticulumDirectOverlayOpen}
                    reticulumEnabled={reticulumEnabled}
                    reticulumChatEnabled={reticulumChatEnabled}
                  />
                ) : selectedDirect ? (
                  <ChatDirect
                    myAddress={myAddress}
                    isNewChat={newChat}
                    selectedDirect={selectedDirect}
                    setSelectedDirect={setSelectedDirect}
                    setNewChat={setNewChat}
                    getTimestampEnterChat={getTimestampEnterChat}
                    close={closeChatDirect}
                    setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
                    isActive={isVisible && isReticulumDirectOverlayOpen}
                    reticulumEnabled={reticulumEnabled}
                    reticulumChatEnabled={reticulumChatEnabled}
                  />
                ) : (
                  <CenterBox>
                    <NoSelectionTypography>
                      No current private messages.
                    </NoSelectionTypography>
                  </CenterBox>
                )}
              </Box>
            </Box>
          )}

          {/* Two-pane: the selection decides (dmSideView), so the DM stays,
              and keeps marking messages read, while the list shows Groups. */}
          {selectedDirect &&
            !newChat &&
            dmSideView === 'directs' &&
            (!reticulumChatEnabled || reticulumDirectsInline) && (
              <SelectedDirectOverlay isChatMode={isVisible}>
                <InnerChatBox>
                  <ChatDirect
                    myAddress={myAddress}
                    isNewChat={newChat}
                    selectedDirect={selectedDirect}
                    setSelectedDirect={setSelectedDirect}
                    setNewChat={setNewChat}
                    getTimestampEnterChat={getTimestampEnterChat}
                    close={closeChatDirect}
                    setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
                    isActive={isVisible && dmSideView === 'directs'}
                    reticulumEnabled={reticulumEnabled}
                    reticulumChatEnabled={reticulumChatEnabled}
                  />
                </InnerChatBox>
              </SelectedDirectOverlay>
            )}
        </Box>
        {onboardingQChatPreviewOpen && <OnboardingQChatPreview />}
      </Box>
    );
  };

  return (
    <>
      <WebSocketNotifications
        myAddress={userInfo?.address || myAddress}
        userName={userInfo?.name}
      />
      <NotificationStateSync myAddress={userInfo?.address || myAddress} />
      <PresenceStatusSync myAddress={userInfo?.address || myAddress} />
      <WebSocketActive
        myAddress={myAddress}
        setIsLoadingGroups={setIsLoadingGroups}
      />

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />

      <RootBox>
        <MemberGroupsEffects
          getGroupsWhereIAmAMember={getGroupsWhereIAmAMember}
          getGroupsProperties={getGroupsProperties}
          myAddress={myAddress}
          groupsPropertiesRef={groupsPropertiesRef}
          hasInitializedWebsocketRef={hasInitializedWebsocket}
        />
        {!isMobile && (
          <DesktopSideBar
            desktopViewMode={desktopViewMode}
            toggleSideViewGroups={toggleSideViewGroups}
            toggleSideViewDirects={toggleSideViewDirects}
            goToHome={goToHome}
            mode={appsMode}
            setMode={setAppsMode}
            setDesktopSideView={setDesktopSideView}
            hasUnreadDirects={directChatHasUnread}
            isApps={desktopViewMode === 'apps'}
            isGroups={isOpenSideViewGroups}
            isDirects={isOpenSideViewDirects}
            setDesktopViewMode={setDesktopViewMode}
            lastQappViewMode={lastQappViewMode}
            setAppsModeDev={setAppsModeDev}
          />
        )}

        <MainContentBox
          ref={mainContentRef}
          // Immersive mode slides this (on the GPU) when the bars come and
          // go, rather than the shell's whole content box.
          {...{ [IMMERSIVE_SLIDE_TARGET_ATTR]: '' }}
          // Phones: the sections waiting beside the current one sit just off
          // screen. Clipped (not a scroll box), nothing in them, a focused
          // field say, can ever scroll the page sideways to them.
          sx={isMobile ? { overflowX: 'clip' } : undefined}
        >
          {openAddGroup && (
            <Suspense fallback={null}>
              <LazyAddGroup
                address={myAddress}
                open={openAddGroup}
                initialTab={openAddGroupTab}
                setOpen={setOpenAddGroup}
              />
            </Suspense>
          )}

          {openFindGroup && (
            <Suspense fallback={null}>
              <LazyFindGroupModal
                open={openFindGroup}
                onOpenJoinedGroup={selectGroupFunc}
                setOpen={setOpenFindGroup}
              />
            </Suspense>
          )}

          <PerfProfiler id="apps">
            <AppsDesktop
              desktopViewMode={desktopViewMode}
              setDesktopViewMode={setDesktopViewMode}
              devMode={appsModeDev}
              setDevMode={setAppsModeDev}
              mode={appsMode}
              setMode={setAppsMode}
              onInternalTabVisibilityChange={({ isVisible, tab }) => {
                if (isMobile) return;
                setIsQChatTabActive(
                  isVisible && tab?.internal === QCHAT_INTERNAL_TAB_ID
                );
              }}
              renderInternalTab={({ hide, isSelected, tab }) =>
                tab?.internal === QCHAT_INTERNAL_TAB_ID
                  ? renderQChatTabContent({ hide, isSelected })
                  : null
              }
              show={desktopViewMode === 'apps' || desktopViewMode === 'dev'}
            />
          </PerfProfiler>

          {isMobile ? (
            // Kept alive while hidden, like Home: coming back is instant and
            // the sideways swipe can slide it in live (scrolled where it was).
            <Activity
              mode={
                desktopViewMode === 'chat' || chatWarmUp ? 'visible' : 'hidden'
              }
            >
              <Box
                {...{ [SECTION_ATTR]: 'chat' }}
                // Out of sight while the warm-up builds it.
                style={
                  desktopViewMode === 'chat' ? undefined : { display: 'none' }
                }
                sx={{
                  ...mobileAppsShellSx,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <PerfProfiler id="chat">
                  {/* Parked behind Home or Apps it keeps its last screen
                      (and its scroll) without re-rendering on every Group
                      update; it catches up the moment it shows. */}
                  <FreezeWhenHidden
                    hidden={desktopViewMode !== 'chat' && !chatWarmUp}
                  >
                    {renderQChatTabContent({
                      hide: false,
                      isSelected: true,
                      phoneSection: true,
                    })}
                  </FreezeWhenHidden>
                </PerfProfiler>
              </Box>
            </Activity>
          ) : null}

          {showWidgets ? (
            <PerfProfiler id="widgets">
              <WidgetsScreen active={desktopViewMode === 'widgets'} />
            </PerfProfiler>
          ) : null}

          {desktopViewMode !== 'home' ? (
            <QortinoMusicPlaybackController />
          ) : null}
          {/* Home stays built while hidden (effects paused) and is never
              re-rendered just to show or hide it. */}
          <Activity mode={desktopViewMode === 'home' ? 'visible' : 'hidden'}>
            <PerfProfiler id="home">
              <HomeDesktop
                refreshHomeDataFunc={refreshHomeDataFunc}
                myAddress={myAddress}
                isLoadingGroups={isLoadingGroups}
                onOpenSettings={onOpenSettings}
                setGroupSection={setGroupSection}
                getTimestampEnterChat={getTimestampEnterChat}
                setOpenManageMembers={setOpenManageMembers}
                setOpenAddGroup={setOpenAddGroup}
                setOpenAddGroupTab={setOpenAddGroupTab}
                setMobileViewMode={setMobileViewMode}
                setDesktopViewMode={setDesktopViewMode}
                desktopViewMode="home"
                onOpenQortalLand={openTopGroupQortalLandForHome}
              />
            </PerfProfiler>
          </Activity>
        </MainContentBox>

        <LoadingSnackbar
          open={isLoadingGroup}
          info={loadingGroupSnackbarInfo}
        />

        <LoadingSnackbar
          open={isLoadingGroups}
          info={loadingGroupsSnackbarInfo}
        />
        <WalletsAppWrapper />

        {!chatWidgetClosed && !isMobile && (
          <GlobalChatWidget
            directs={displayDirects}
            directChatHasUnread={directChatHasUnread}
            timestampEnterData={timestampEnterData}
            timeDifferenceForNotificationChats={
              timeDifferenceForNotificationChats
            }
            myAddress={myAddress}
            getTimestampEnterChat={getTimestampEnterChat}
            getSecretKeyForGroup={getSecretKeyForGroup}
            onClose={() => setChatWidgetClosed(true)}
          />
        )}
      </RootBox>
      {/* Mounted at Group level so park/restore survives Home Activity hide / Q-App navigation. */}
      {qortinoEverOpened && (
        <Suspense fallback={null}>
          <LazyQortinoAgentSheet
            open={qortinoAgentOpen}
            onClose={() => closeQortinoAgentSheet()}
          />
        </Suspense>
      )}
      <HubOnboardingTour
        closeGroupDiscovery={closeOnboardingGroupDiscovery}
        closeQChatPreview={closeOnboardingQChatPreview}
        navigateHome={navigateOnboardingHome}
        navigateQChat={navigateOnboardingQChat}
        openQortalProject={showOnboardingQortalProject}
        qortalProjectMember={qortalProjectMember}
        showDirectMessages={showOnboardingDirectMessages}
        showGroupDiscovery={openGroupDiscovery}
      />
    </>
  );
};

/**
 * Memoized: the app shell re-renders for its own reasons (immersive bars
 * sliding, the keyboard, balance updates) and Group is the whole UI below
 * it, so it re-renders only when one of its own props changes.
 */
export const Group = memo(GroupInner);
