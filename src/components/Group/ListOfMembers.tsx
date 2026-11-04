import {
  alpha,
  Box,
  ButtonBase,
  CircularProgress,
  IconButton,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import AddModeratorRoundedIcon from '@mui/icons-material/AddModeratorRounded';
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import Groups2RoundedIcon from '@mui/icons-material/Groups2Rounded';
import LocalFloristRoundedIcon from '@mui/icons-material/LocalFloristRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import NightlifeRoundedIcon from '@mui/icons-material/NightlifeRounded';
import BedtimeRoundedIcon from '@mui/icons-material/BedtimeRounded';
import PersonRemoveRoundedIcon from '@mui/icons-material/PersonRemoveRounded';
import RemoveModeratorRoundedIcon from '@mui/icons-material/RemoveModeratorRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AutoSizer, List } from 'react-virtualized';
import { getFee } from '../../background/background.ts';
import { useTranslation } from 'react-i18next';
import { useOnlineAddresses } from '../../hooks/usePresence';
import { useAtomValue } from 'jotai';
import { statusMapAtom } from '../../atoms/presence';
import { reticulumChatTextScaleAtom, userInfoAtom } from '../../atoms/global';
import { PresenceStatusBadge } from '../common/PresenceStatusBadge';
import { getFallbackAvatarOutlineSx } from '../Chat/clickableAvatarStyles';
import { CachedUserAvatar } from './CachedAvatars';
import { hasInvisibleCharacters } from '../../utils/hasInvisibleCharacters';
import { WrapperUserAction } from '../WrapperUserAction';
import {
  QORTAL_LAND_PRESENCE_EVENT,
  getQortalLandPresence,
} from '../QortalLand/qortalLandPresence';
import { QortalLandAvailabilityTags } from '../QortalLand/QortalLandAvailabilityTags';
import { MemberCategoryHeader } from './MemberCategoryHeader';
import { executeEvent } from '../../utils/events';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import {
  MemberActionsNotice,
  MemberAdminAction,
  PendingMemberAction,
  getAvailableMemberActions,
  getMemberActionsNotice,
  prunePendingMemberActions,
} from './memberAdminActions';
import {
  reticulumMemberNamePx,
  type ReticulumChatTextScale,
} from '../Chat/reticulumChatTextScale';
import { immersiveMotionReduced } from '../Mobile/immersive/useImmersiveBars';

const MEMBER_ROW_HEIGHT = 64;
/** Q-Chat member rows grow and shrink with the chat's text size. */
const COMPACT_MEMBER_ROW_HEIGHT_PX: Record<ReticulumChatTextScale, number> = {
  small: 48,
  default: 52,
  large: 60,
};
const QORTAL_LAND_REMOTE_TTL_MS = 30_000;
// Re-read the member list this often while a promotion, demotion, kick or ban
// waits for a block, so the row flips as soon as Core reports the change.
const PENDING_MEMBER_REFRESH_MS = 15_000;
/** How long a member picked in the search stays marked in the list. */
const MEMBER_FOCUS_HOLD_MS = 2_000;
const MEMBER_FOCUS_PULSE_MS = 1_200;

const MEMBER_SECTION_KEYS = [
  'admins',
  'lounge',
  'park',
  'members',
  'offline',
] as const;
type MemberSectionKey = (typeof MEMBER_SECTION_KEYS)[number];
const MEMBER_SECTION_LABEL_KEY: Record<MemberSectionKey, string> = {
  admins: 'group:member_category.admins',
  lounge: 'group:member_category.lounge',
  park: 'group:member_category.park',
  members: 'group:member_category.members',
  offline: 'group:member_category.offline',
};

/** A section header or a member row in the virtualized list. */
type MemberListRow = {
  type: 'section' | 'member';
  member?: any;
  offline?: boolean;
  section?: MemberSectionKey;
  count?: number;
  totalCount?: number;
  expanded?: boolean;
  first?: boolean;
  label?: string;
};

/** Ask the list to scroll to a member and mark it; a new nonce asks again. */
export type MemberFocusRequest = { address: string; nonce: number };

// Broadcast-but-unconfirmed actions per group. Kept outside the component so
// closing and reopening the Members screen still shows "pending" instead of
// offering the same paid transaction again.
const pendingActionsByGroup = new Map<
  string,
  Record<string, PendingMemberAction>
>();

const MEMBER_ACTION_TX: Record<
  MemberAdminAction,
  { feeType: string; request: string; successKey: string }
> = {
  make_admin: {
    feeType: 'ADD_GROUP_ADMIN',
    request: 'makeAdmin',
    successKey: 'group:message.success.group_member_admin',
  },
  remove_admin: {
    feeType: 'REMOVE_GROUP_ADMIN',
    request: 'removeAdmin',
    successKey: 'group:message.success.group_remove_member',
  },
  kick: {
    feeType: 'GROUP_KICK',
    request: 'kickFromGroup',
    successKey: 'group:message.success.group_kick',
  },
  ban: {
    feeType: 'GROUP_BAN',
    request: 'banFromGroup',
    successKey: 'group:message.success.group_ban',
  },
};

const MEMBER_ACTION_LABEL_KEY: Record<MemberAdminAction, string> = {
  make_admin: 'group:action.make_admin',
  remove_admin: 'group:action.remove_admin',
  kick: 'group:action.kick_member',
  ban: 'group:action.ban',
};

const MEMBER_ACTIONS_NOTICE_KEY: Record<MemberActionsNotice, string> = {
  owner_only: 'group:member_actions.owner_only_notice',
  needs_approval: 'group:member_actions.needs_approval_notice',
};

const MEMBER_ACTION_ICON: Record<MemberAdminAction, typeof BlockRoundedIcon> = {
  make_admin: AddModeratorRoundedIcon,
  remove_admin: RemoveModeratorRoundedIcon,
  kick: PersonRemoveRoundedIcon,
  ban: BlockRoundedIcon,
};

const ListOfMembers = ({
  members,
  groupId,
  setInfoSnack,
  setOpenSnack,
  isAdmin,
  isOwner,
  show,
  ownerAddress,
  compact = false,
  reticulumUserCards = false,
  onRefreshMembers = undefined,
  focusMemberRequest = null,
}: {
  members: any[];
  groupId: number | string;
  setInfoSnack: (info: any) => void;
  setOpenSnack: (open: boolean) => void;
  isAdmin?: boolean;
  isOwner?: boolean;
  show: (data: any) => Promise<unknown>;
  ownerAddress?: string;
  compact?: boolean;
  reticulumUserCards?: boolean;
  onRefreshMembers?: () => unknown;
  /** Scroll to this member and mark the row (the Members search). */
  focusMemberRequest?: MemberFocusRequest | null;
}) => {
  // One action menu for the whole list, opened from a row's ⋮ button or by
  // holding / right-clicking the row.
  const [actionMenu, setActionMenu] = useState<{
    anchorEl: HTMLElement;
    address: string;
    label: string;
    actions: MemberAdminAction[];
  } | null>(null);
  // The transaction being confirmed or broadcast right now. Only one at a
  // time: parallel sends from one account race for the same last reference.
  const [busyAction, setBusyAction] = useState<{
    address: string;
    action: MemberAdminAction;
  } | null>(null);
  const busyActionRef = useRef(false);
  // Broadcast but not yet visible in the member list, by member address.
  const [pendingActions, setPendingActions] = useState<
    Record<string, PendingMemberAction>
  >(() => pendingActionsByGroup.get(String(groupId)) ?? {});
  const [expandedSections, setExpandedSections] = useState({
    admins: true,
    lounge: true,
    park: true,
    members: true,
    offline: true,
  });
  const [landPresence, setLandPresence] = useState(
    () => getQortalLandPresence(Number(groupId))?.members ?? []
  );
  const landSessionsRef = useRef(new Map());
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);
  const listRef = useRef(null);
  const onlineAddresses = useOnlineAddresses();
  const statusMap = useAtomValue(statusMapAtom);
  const currentAddress = useAtomValue(userInfoAtom)?.address;
  const reticulumTextScale = useAtomValue(reticulumChatTextScaleAtom);
  const compactTextSize = reticulumMemberNamePx(reticulumTextScale);
  const compactRowHeight = COMPACT_MEMBER_ROW_HEIGHT_PX[reticulumTextScale];
  const categorizedReticulumMembers = compact && reticulumUserCards;

  useEffect(() => {
    if (!categorizedReticulumMembers) return;
    const numericGroupId = Number(groupId);
    if (!Number.isInteger(numericGroupId) || numericGroupId <= 0) return;

    const initialMembers = getQortalLandPresence(numericGroupId)?.members ?? [];
    landSessionsRef.current = new Map(
      initialMembers.map((presence) => [
        `${presence.address}:snapshot`,
        {
          ...presence,
          sequence: 0,
          sessionId: 'snapshot',
        },
      ])
    );
    setLandPresence(initialMembers);

    const publishCurrentPresence = () => {
      const now = Date.now();
      const newestByAddress = new Map();
      for (const [key, presence] of landSessionsRef.current.entries()) {
        if (now - presence.lastSeenAt > QORTAL_LAND_REMOTE_TTL_MS) {
          landSessionsRef.current.delete(key);
          continue;
        }
        const previous = newestByAddress.get(presence.address);
        if (!previous || presence.lastSeenAt > previous.lastSeenAt) {
          newestByAddress.set(presence.address, presence);
        }
      }
      const nextMembers = [...newestByAddress.values()].map(
        ({ sequence: _sequence, sessionId: _sessionId, ...presence }) =>
          presence
      );
      setLandPresence(nextMembers);
    };

    void window.reticulumChat?.subscribeGroup?.(numericGroupId);
    void window.reticulumChat?.subscribeChannel?.(
      numericGroupId,
      'qortal-land'
    );
    const unsubscribe = window.reticulumChat?.onLandState?.((payload) => {
      if (payload.groupId !== numericGroupId || !payload.authorAddress) return;
      // The mounted QortalLand view is the authoritative source for our own
      // presence. Treating its echoed network state as a remote session can
      // resurrect the local user after leaving or let an old echo outlive the
      // shared snapshot.
      if (payload.authorAddress === currentAddress) return;
      const sessionId = payload.sessionId || 'default';
      const key = `${payload.authorAddress}:${sessionId}`;
      const previous = landSessionsRef.current.get(key);
      if (payload.movement === 'leave') {
        if (!previous || payload.sequence >= previous.sequence) {
          landSessionsRef.current.delete(key);
          publishCurrentPresence();
        }
        return;
      }
      if (previous && payload.sequence < previous.sequence) return;
      landSessionsRef.current.delete(`${payload.authorAddress}:snapshot`);
      landSessionsRef.current.set(key, {
        address: payload.authorAddress,
        afk: payload.afk === true,
        dnd: payload.dnd === true,
        voiceEnabled: payload.voiceEnabled === true,
        voiceMuted:
          payload.voiceEnabled === true && payload.voiceMuted === true,
        lastSeenAt: Date.now(),
        roomId: payload.roomId === 'park' ? 'park' : 'club',
        sequence: payload.sequence,
        sessionId,
      });
      publishCurrentPresence();
    });
    const pruneTimer = window.setInterval(
      publishCurrentPresence,
      Math.min(5_000, QORTAL_LAND_REMOTE_TTL_MS)
    );
    const onSharedPresence = (event) => {
      const snapshot = event.detail;
      if (snapshot?.groupId !== numericGroupId) return;
      for (const key of landSessionsRef.current.keys()) {
        if (key.endsWith(':shared')) {
          landSessionsRef.current.delete(key);
        }
      }
      for (const presence of snapshot.members || []) {
        const key = `${presence.address}:shared`;
        landSessionsRef.current.set(key, {
          ...presence,
          sequence: 0,
          sessionId: 'shared',
        });
      }
      setLandPresence(snapshot.members || []);
    };
    window.addEventListener(QORTAL_LAND_PRESENCE_EVENT, onSharedPresence);
    return () => {
      unsubscribe?.();
      window.clearInterval(pruneTimer);
      window.removeEventListener(QORTAL_LAND_PRESENCE_EVENT, onSharedPresence);
    };
  }, [categorizedReticulumMembers, currentAddress, groupId]);

  const landPresenceByAddress = useMemo(() => {
    const byAddress = new Map();
    for (const presence of landPresence) {
      const previous = byAddress.get(presence.address);
      if (!previous || presence.lastSeenAt > previous.lastSeenAt) {
        byAddress.set(presence.address, presence);
      }
    }
    return byAddress;
  }, [landPresence]);
  const sortedMembers = useMemo(() => {
    return [...(members || [])].sort((a, b) => {
      const aIsOwner = a?.member === ownerAddress;
      const bIsOwner = b?.member === ownerAddress;
      if (aIsOwner !== bIsOwner) return aIsOwner ? -1 : 1;

      const aIsAdmin = Boolean(a?.isAdmin);
      const bIsAdmin = Boolean(b?.isAdmin);
      if (aIsAdmin !== bIsAdmin) return aIsAdmin ? -1 : 1;

      const aLabel = (a?.primaryName || a?.name || a?.member || '').toString();
      const bLabel = (b?.primaryName || b?.name || b?.member || '').toString();
      return aLabel.localeCompare(bLabel, undefined, {
        sensitivity: 'base',
      });
    });
  }, [members, ownerAddress]);
  // Who sits in which section, whether or not the section is folded.
  const memberSections = useMemo(() => {
    if (!categorizedReticulumMembers) return null;

    const labelForMember = (member) =>
      (member?.primaryName || member?.name || member?.member || '').toString();
    const sortByName = (left, right) => {
      return labelForMember(left).localeCompare(
        labelForMember(right),
        undefined,
        {
          sensitivity: 'base',
        }
      );
    };
    const sortAdmins = (left, right) => {
      const leftIsOwner = left?.member === ownerAddress;
      const rightIsOwner = right?.member === ownerAddress;
      if (leftIsOwner !== rightIsOwner) return leftIsOwner ? -1 : 1;
      return sortByName(left, right);
    };
    const memberByAddress = new Map(
      (members || []).map((member) => [member?.member, member])
    );
    for (const address of landPresenceByAddress.keys()) {
      if (!memberByAddress.has(address)) {
        memberByAddress.set(address, { member: address });
      }
    }
    const allMembers = [...memberByAddress.values()].filter(
      (member) => member?.member
    );
    const isMemberOnline = (member) =>
      landPresenceByAddress.has(member?.member) ||
      onlineAddresses.has(member?.member) ||
      statusMap.has(member?.member);
    const allAdmins = allMembers.filter(
      (member) => member?.member === ownerAddress || Boolean(member?.isAdmin)
    );
    const admins = allAdmins.filter(isMemberOnline).sort(sortAdmins);
    const allRegularMembers = allMembers.filter(
      (member) => member?.member !== ownerAddress && !member?.isAdmin
    );
    const loungeMembers = allRegularMembers
      .filter(
        (member) =>
          isMemberOnline(member) &&
          landPresenceByAddress.has(member.member) &&
          landPresenceByAddress.get(member.member)?.roomId !== 'park'
      )
      .sort(sortByName);
    const parkMembers = allRegularMembers
      .filter(
        (member) =>
          isMemberOnline(member) &&
          landPresenceByAddress.get(member.member)?.roomId === 'park'
      )
      .sort(sortByName);
    const remainingMembers = allRegularMembers
      .filter(
        (member) =>
          isMemberOnline(member) && !landPresenceByAddress.has(member.member)
      )
      .sort(sortByName);
    const offlineMembers = allMembers
      .filter((member) => !isMemberOnline(member))
      .sort(sortByName);

    return {
      admins,
      lounge: loungeMembers,
      park: parkMembers,
      members: remainingMembers,
      offline: offlineMembers,
      adminsTotal: allAdmins.length,
      regularTotal: allRegularMembers.length,
    };
  }, [
    categorizedReticulumMembers,
    landPresenceByAddress,
    members,
    onlineAddresses,
    ownerAddress,
    statusMap,
  ]);
  const memberSectionsRef = useRef(memberSections);
  memberSectionsRef.current = memberSections;

  const categorizedRows = useMemo<MemberListRow[]>(() => {
    if (!memberSections) {
      return sortedMembers.map((member) => ({ member, type: 'member' }));
    }
    const sectionRows = (
      section: MemberSectionKey,
      totalCount: number | undefined
    ): MemberListRow[] => {
      const list = memberSections[section];
      const expanded = expandedSections[section];
      return [
        {
          count: list.length,
          totalCount,
          expanded,
          first: section === 'admins',
          label: t(MEMBER_SECTION_LABEL_KEY[section]),
          section,
          type: 'section',
        },
        ...(expanded
          ? list.map(
              (member): MemberListRow => ({
                member,
                type: 'member',
                ...(section === 'offline' ? { offline: true } : {}),
              })
            )
          : []),
      ];
    };
    return [
      ...sectionRows('admins', memberSections.adminsTotal),
      ...sectionRows('lounge', memberSections.regularTotal),
      ...sectionRows('park', memberSections.regularTotal),
      ...sectionRows('members', memberSections.regularTotal),
      ...sectionRows('offline', undefined),
    ];
  }, [expandedSections, memberSections, sortedMembers, t]);

  // The Members search picked someone: unfold their section, scroll them to
  // the middle of the list and mark the row for a moment.
  const [focusTarget, setFocusTarget] = useState<MemberFocusRequest | null>(
    null
  );
  const scrolledFocusNonceRef = useRef<number | null>(null);
  const listBoxRef = useRef<HTMLDivElement>(null);
  const focusAddress = focusMemberRequest?.address;
  const focusNonce = focusMemberRequest?.nonce;
  useEffect(() => {
    if (!focusAddress) return;
    const sections = memberSectionsRef.current;
    const section = sections
      ? MEMBER_SECTION_KEYS.find((key) =>
          sections[key].some((member) => member?.member === focusAddress)
        )
      : undefined;
    if (section) {
      setExpandedSections((current) =>
        current[section] ? current : { ...current, [section]: true }
      );
    }
    setFocusTarget({ address: focusAddress, nonce: focusNonce });
    const timer = window.setTimeout(() => {
      setFocusTarget((current) =>
        current?.nonce === focusNonce ? null : current
      );
    }, MEMBER_FOCUS_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [focusAddress, focusNonce]);

  const scrollRowToCentre = (index: number) => {
    const list = listRef.current;
    if (!list || index < 0) return;
    // Row heights depend on what each index holds, which shifts when a
    // section folds or a member changes section.
    list.recomputeRowHeights?.();
    const top = list.getOffsetForRow?.({ alignment: 'center', index });
    if (typeof top !== 'number' || !Number.isFinite(top)) return;
    const scroller = listBoxRef.current?.querySelector<HTMLElement>(
      '.ReactVirtualized__List'
    );
    if (
      scroller &&
      typeof scroller.scrollTo === 'function' &&
      !immersiveMotionReduced()
    ) {
      scroller.scrollTo({ top, behavior: 'smooth' });
    } else {
      list.scrollToPosition?.(top);
    }
  };
  const focusRowIndex = (address?: string) =>
    address
      ? categorizedRows.findIndex(
          (row) => row.type === 'member' && row.member?.member === address
        )
      : -1;

  useEffect(() => {
    if (!focusTarget || scrolledFocusNonceRef.current === focusTarget.nonce) {
      return;
    }
    const index = focusRowIndex(focusTarget.address);
    if (index < 0) return;
    scrolledFocusNonceRef.current = focusTarget.nonce;
    scrollRowToCentre(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorizedRows, focusTarget]);

  // The keyboard going away (or the search bar giving way to the tabs)
  // resizes the list mid-scroll: keep the picked member in the middle.
  const recentreFocusedRow = () => {
    if (!focusTarget) return;
    scrollRowToCentre(focusRowIndex(focusTarget.address));
  };

  const focusPulseSx = {
    '@keyframes memberFocusPulse': {
      '0%': { backgroundColor: alpha(theme.palette.primary.main, 0) },
      '15%': { backgroundColor: alpha(theme.palette.primary.main, 0.26) },
      '55%': { backgroundColor: alpha(theme.palette.primary.main, 0.2) },
      '100%': { backgroundColor: alpha(theme.palette.primary.main, 0) },
    },
    animation: `memberFocusPulse ${MEMBER_FOCUS_PULSE_MS}ms ease-out`,
    borderRadius: '8px',
  };

  const groupMemberAddresses = useMemo(
    () =>
      new Set((members || []).map((member) => member?.member).filter(Boolean)),
    [members]
  );
  const getMemberActions = (member) =>
    getAvailableMemberActions(member, {
      viewerAddress: currentAddress,
      ownerAddress,
      isOwner: Boolean(isOwner),
      inGroup: groupMemberAddresses.has(member?.member),
    });
  // Admins who can't kick or ban get the reason instead of the buttons.
  const actionsNotice = getMemberActionsNotice({
    ownerAddress,
    isOwner: Boolean(isOwner),
    isAdmin: Boolean(isAdmin),
  });

  const openActionMenu = (anchorEl: HTMLElement, member, label: string) => {
    const actions = getMemberActions(member);
    if (!anchorEl || actions.length === 0) return;
    setActionMenu({ anchorEl, address: member.member, label, actions });
  };

  const closeActionMenu = useCallback(() => setActionMenu(null), []);

  useAndroidBack(
    () => {
      closeActionMenu();
      return true;
    },
    { priority: BACK_PRIORITY.dialog, enabled: Boolean(actionMenu) }
  );

  // Rows that settled (or waited too long) stop showing "pending" as soon as a
  // fresh member list arrives.
  const membersRef = useRef(members);
  membersRef.current = members;
  useEffect(() => {
    setPendingActions((previous) =>
      prunePendingMemberActions(previous, members, Date.now())
    );
  }, [members]);

  const hasPendingActions = Object.keys(pendingActions).length > 0;
  useEffect(() => {
    const key = String(groupId);
    if (hasPendingActions) pendingActionsByGroup.set(key, pendingActions);
    else pendingActionsByGroup.delete(key);
  }, [groupId, hasPendingActions, pendingActions]);
  const onRefreshMembersRef = useRef(onRefreshMembers);
  onRefreshMembersRef.current = onRefreshMembers;
  useEffect(() => {
    if (!hasPendingActions) return;
    const timer = window.setInterval(() => {
      setPendingActions((previous) =>
        prunePendingMemberActions(previous, membersRef.current, Date.now())
      );
      void onRefreshMembersRef.current?.();
    }, PENDING_MEMBER_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [hasPendingActions]);

  // Owners and admins hold (touch) or right-click a member row for the same
  // menu the ⋮ button opens. One timer is enough because only one finger can
  // hold.
  const memberHold = useRef<{
    timer: number | null;
    origin: { x: number; y: number } | null;
    fired: boolean;
  }>({ timer: null, origin: null, fired: false });
  const cancelMemberHold = () => {
    if (memberHold.current.timer !== null) {
      window.clearTimeout(memberHold.current.timer);
      memberHold.current.timer = null;
    }
  };
  const memberLongPressProps = (member, label: string) => ({
    onTouchStart: (event: React.TouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      if (!touch) return;
      const target = event.currentTarget;
      memberHold.current.origin = { x: touch.clientX, y: touch.clientY };
      memberHold.current.fired = false;
      cancelMemberHold();
      memberHold.current.timer = window.setTimeout(() => {
        memberHold.current.timer = null;
        memberHold.current.fired = true;
        openActionMenu(target, member, label);
      }, 450);
    },
    onTouchMove: (event: React.TouchEvent<HTMLElement>) => {
      if (memberHold.current.timer === null) return;
      const touch = event.touches[0];
      const origin = memberHold.current.origin;
      if (!touch || !origin) return;
      if (
        Math.abs(touch.clientX - origin.x) > 10 ||
        Math.abs(touch.clientY - origin.y) > 10
      ) {
        cancelMemberHold();
      }
    },
    onTouchEnd: (event: React.TouchEvent<HTMLElement>) => {
      cancelMemberHold();
      if (memberHold.current.fired) {
        memberHold.current.fired = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onTouchCancel: () => cancelMemberHold(),
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      openActionMenu(event.currentTarget, member, label);
    },
  });

  const runMemberAction = async (
    action: MemberAdminAction,
    address: string
  ) => {
    if (!address || busyActionRef.current) return;
    const config = MEMBER_ACTION_TX[action];
    busyActionRef.current = true;
    setActionMenu(null);
    setBusyAction({ address, action });
    try {
      const fee = await getFee(config.feeType);
      await show({
        message: t('core:message.question.perform_transaction', {
          action: config.feeType,
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });
      const response: any = await window.sendMessage(config.request, {
        groupId,
        qortalAddress: address,
        ...(action === 'ban' ? { rBanTime: 0 } : {}),
      });
      if (response?.error) {
        throw new Error(
          typeof response.error === 'string'
            ? response.error
            : response.error?.message
        );
      }
      setPendingActions((previous) => ({
        ...previous,
        [address]: { action, startedAt: Date.now() },
      }));
      setInfoSnack({
        type: 'success',
        message: t(config.successKey, { postProcess: 'capitalizeFirstChar' }),
      });
      setOpenSnack(true);
    } catch (error) {
      // Declining the fee confirmation is not an error.
      if (error?.isCanceled) return;
      console.log(error);
      setInfoSnack({
        type: 'error',
        message:
          error?.message ||
          t('core:message.error.generic', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
      setOpenSnack(true);
    } finally {
      busyActionRef.current = false;
      setBusyAction(null);
    }
  };

  const renderMemberActions = (member, label: string) => {
    const address = member?.member;
    const pending = address ? pendingActions[address] : undefined;
    const isBusy = busyAction?.address === address;
    if (pending || isBusy) {
      return (
        <Tooltip
          title={
            pending
              ? t('group:member_actions.pending_hint', {
                  postProcess: 'capitalizeFirstChar',
                })
              : ''
          }
        >
          <Box
            aria-live="polite"
            sx={{
              alignItems: 'center',
              color: 'text.secondary',
              display: 'flex',
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 650,
              gap: 0.6,
              pl: 0.5,
              pr: 1,
            }}
          >
            <CircularProgress size={14} sx={{ color: 'inherit' }} />
            {pending &&
              t('group:member_actions.pending', {
                postProcess: 'capitalizeFirstChar',
              })}
          </Box>
        </Tooltip>
      );
    }
    const actions = getMemberActions(member);
    if (actions.length === 0) return null;
    const adminAction = actions.find(
      (action) => action === 'make_admin' || action === 'remove_admin'
    );
    const AdminActionIcon = adminAction
      ? MEMBER_ACTION_ICON[adminAction]
      : null;
    const iconButtonSx = {
      color: 'text.secondary',
      height: 36,
      width: 36,
      '&:hover': { color: 'text.primary' },
    };
    return (
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexShrink: 0,
          gap: 0.25,
          pr: 0.25,
        }}
      >
        {adminAction && AdminActionIcon && (
          <Tooltip
            title={t(MEMBER_ACTION_LABEL_KEY[adminAction], {
              postProcess: 'capitalizeFirstChar',
            })}
          >
            <span style={{ display: 'inline-flex' }}>
              <IconButton
                aria-label={t(
                  adminAction === 'make_admin'
                    ? 'group:member_actions.make_admin_named'
                    : 'group:member_actions.remove_admin_named',
                  { name: label, postProcess: 'capitalizeFirstChar' }
                )}
                disabled={Boolean(busyAction)}
                onClick={(event) => {
                  event.stopPropagation();
                  void runMemberAction(adminAction, address);
                }}
                size="small"
                sx={iconButtonSx}
              >
                <AdminActionIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </span>
          </Tooltip>
        )}
        <IconButton
          aria-haspopup="menu"
          aria-label={t('group:member_actions.more_named', {
            name: label,
            postProcess: 'capitalizeFirstChar',
          })}
          disabled={Boolean(busyAction)}
          onClick={(event) => {
            event.stopPropagation();
            openActionMenu(event.currentTarget, member, label);
          }}
          size="small"
          sx={iconButtonSx}
        >
          <MoreVertRoundedIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>
    );
  };

  const rowRenderer = ({ index, key, style }) => {
    const row = categorizedRows[index];
    const semanticRowKey =
      row?.type === 'section'
        ? `member-section-${row.section}`
        : row?.member?.member
          ? `member-${row.member.member}`
          : key;
    if (row?.type === 'section') {
      const expanded = Boolean(row.expanded);
      const SectionIcon =
        row.section === 'admins'
          ? AdminPanelSettingsRoundedIcon
          : row.section === 'lounge'
            ? NightlifeRoundedIcon
            : row.section === 'park'
              ? LocalFloristRoundedIcon
              : row.section === 'offline'
                ? BedtimeRoundedIcon
                : Groups2RoundedIcon;
      return (
        <div key={semanticRowKey} style={style}>
          <MemberCategoryHeader
            count={row.count}
            totalCount={row.totalCount}
            expanded={expanded}
            first={row.first}
            icon={<SectionIcon sx={{ fontSize: 17 }} />}
            label={row.label}
            onToggle={() =>
              setExpandedSections((current) => ({
                ...current,
                [row.section]: !current[row.section],
              }))
            }
            type={row.section}
          />
        </div>
      );
    }

    const member = row?.member;
    if (!member) return null;
    const isOfflineRow = row?.offline === true;
    const memberLabel = compact
      ? member?.primaryName || member?.name || 'Member'
      : member?.primaryName || member?.member;
    const hasUnsafeMemberName = Boolean(
      member?.primaryName && hasInvisibleCharacters(member.primaryName)
    );
    const memberRole =
      member?.member === ownerAddress
        ? 'Owner'
        : member?.isAdmin
          ? 'Admin'
          : null;
    const memberLandPresence =
      landPresenceByAddress.get(member?.member) ?? null;
    const memberRoleColor = isOfflineRow
      ? theme.palette.text.secondary
      : memberRole === 'Owner'
        ? theme.palette.mode === 'dark'
          ? '#ffb454'
          : '#a84a00'
        : memberRole === 'Admin'
          ? theme.palette.mode === 'dark'
            ? '#58a6ff'
            : '#1d4ed8'
          : theme.palette.mode === 'dark'
            ? '#f2f2f4'
            : '#1b1d24';
    const reticulumUserCard =
      reticulumUserCards && member?.member
        ? {
            address: member.member,
            // The card loads the avatar by name from the device cache.
            isMinterResolved: false,
            isOwn: member.member === currentAddress,
            name: member?.primaryName || member?.name,
            role:
              memberRole === 'Owner'
                ? 'owner'
                : memberRole === 'Admin'
                  ? 'admin'
                  : undefined,
            roleColor: memberRole ? memberRoleColor : undefined,
            status: statusMap.get(member.member) ?? null,
          }
        : undefined;
    const reticulumSilenceContext =
      reticulumUserCards &&
      currentAddress &&
      member?.member &&
      (member.member !== currentAddress || memberRole === 'Owner')
        ? {
            disabled: memberRole === 'Owner',
            groupId: Number(groupId),
            ownerAddress: currentAddress,
            scopeType: 'group' as const,
          }
        : undefined;
    const memberContent = (
      <>
        <ListItemAvatar sx={{ minWidth: compact ? 42 : undefined }}>
          <PresenceStatusBadge
            online={
              onlineAddresses.has(member?.member) || Boolean(memberLandPresence)
            }
            status={
              memberLandPresence?.afk
                ? 'idle'
                : (statusMap.get(member?.member) ?? null)
            }
          >
            <CachedUserAvatar
              alt={memberLabel}
              name={member?.primaryName}
              sx={{
                height: compact ? 34 : undefined,
                width: compact ? 34 : undefined,
                ...(!member?.primaryName
                  ? getFallbackAvatarOutlineSx(theme)
                  : {}),
              }}
            />
          </PresenceStatusBadge>
        </ListItemAvatar>
        <ListItemText
          id={memberLabel}
          primary={
            <Box
              component="span"
              sx={{
                alignItems: 'baseline',
                display: 'flex',
                gap: 0.5,
                minWidth: 0,
              }}
            >
              <Box
                component="span"
                sx={{
                  color: memberRoleColor,
                  fontSize:
                    compact && reticulumUserCards
                      ? compactTextSize
                      : compact
                        ? 13
                        : undefined,
                  fontWeight: compact ? 700 : undefined,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  ...(hasUnsafeMemberName
                    ? {
                        textDecorationColor: theme.palette.error.main,
                        textDecorationLine: 'line-through',
                        textDecorationThickness: '2px',
                      }
                    : {}),
                }}
              >
                {memberLabel}
              </Box>
              {memberRole && memberLandPresence && (
                <Box
                  component="span"
                  sx={{
                    backgroundColor: alpha('#20c7d9', 0.13),
                    border: `1px solid ${alpha('#20c7d9', 0.52)}`,
                    borderRadius: '4px',
                    color:
                      theme.palette.mode === 'dark' ? '#55dcea' : '#087b88',
                    flexShrink: 0,
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: '0.035em',
                    lineHeight: '14px',
                    px: 0.55,
                  }}
                >
                  Q-LAND
                </Box>
              )}
              <QortalLandAvailabilityTags availability={memberLandPresence} />
            </Box>
          }
          primaryTypographyProps={{
            sx: {
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          }}
        />
      </>
    );

    const rowHasActions = getMemberActions(member).length > 0;
    const isFocusTarget =
      Boolean(focusTarget) && focusTarget.address === member?.member;

    return (
      <div key={semanticRowKey} style={style}>
        <ListItem
          key={member?.member}
          data-member-focus={isFocusTarget ? 'true' : undefined}
          disablePadding
          sx={isFocusTarget ? focusPulseSx : undefined}
        >
          {reticulumUserCard ? (
            <Box sx={{ display: 'flex', flex: 1, minWidth: 0 }}>
              <WrapperUserAction
                address={member.member}
                fullWidth
                name={memberLabel}
                reticulumUserCard={reticulumUserCard}
                reticulumSilenceContext={reticulumSilenceContext}
              >
                <ListItemButton
                  {...(rowHasActions
                    ? memberLongPressProps(member, memberLabel)
                    : {})}
                  sx={{
                    borderRadius: '6px',
                    cursor: 'pointer',
                    minHeight:
                      compact && reticulumUserCards ? compactRowHeight : 50,
                    minWidth: 0,
                    px: 1,
                    py: 0.5,
                    opacity: isOfflineRow ? 0.58 : 1,
                    transition: 'opacity 140ms ease',
                    width: '100%',
                    '&:hover': {
                      opacity: isOfflineRow ? 0.78 : 1,
                    },
                  }}
                >
                  {memberContent}
                </ListItemButton>
              </WrapperUserAction>
            </Box>
          ) : (
            <ListItemButton
              onClick={
                rowHasActions
                  ? (event) =>
                      openActionMenu(event.currentTarget, member, memberLabel)
                  : undefined
              }
              sx={{
                borderRadius: compact ? '6px' : undefined,
                cursor: rowHasActions ? 'pointer' : 'default',
                minHeight:
                  compact && reticulumUserCards
                    ? compactRowHeight
                    : compact
                      ? 50
                      : undefined,
                minWidth: 0,
                px: compact ? 1 : undefined,
                py: compact ? 0.5 : undefined,
                opacity: isOfflineRow ? 0.58 : 1,
              }}
            >
              {memberContent}
            </ListItemButton>
          )}
          {renderMemberActions(member, memberLabel)}
        </ListItem>
      </div>
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {!compact && (
        <p>
          {t('core:list.members', {
            postProcess: 'capitalizeFirstChar',
          })}
        </p>
      )}
      {actionsNotice && (
        <Typography
          sx={{
            color: 'text.secondary',
            flexShrink: 0,
            fontSize: 12,
            lineHeight: 1.4,
            px: 1.5,
            py: 0.75,
          }}
        >
          {t(MEMBER_ACTIONS_NOTICE_KEY[actionsNotice], {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      )}
      <div
        ref={listBoxRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 1,
          height: compact ? '100%' : '500px',
          minHeight: 0,
          boxSizing: 'border-box',
          padding: categorizedReticulumMembers ? '8px 0 8px 10px' : undefined,
          position: 'relative',
          width: '100%',
        }}
      >
        <AutoSizer onResize={recentreFocusedRow}>
          {({ height, width }) => (
            <List
              height={height}
              overscanRowCount={8}
              ref={listRef}
              rowCount={categorizedRows.length}
              rowHeight={
                categorizedReticulumMembers
                  ? ({ index }) =>
                      categorizedRows[index]?.type === 'section'
                        ? categorizedRows[index]?.first
                          ? 40
                          : 46
                        : compactRowHeight
                  : compact
                    ? 52
                    : MEMBER_ROW_HEIGHT
              }
              rowRenderer={rowRenderer}
              style={{
                boxSizing: 'border-box',
                outline: 'none',
                paddingRight: categorizedReticulumMembers ? 10 : undefined,
              }}
              tabIndex={-1}
              width={width}
            />
          )}
        </AutoSizer>
      </div>
      {categorizedReticulumMembers && (
        <ButtonBase
          aria-label={t('group:chat_group.open_hidden_members')}
          onClick={() =>
            executeEvent('openReticulumHiddenMembers', {
              groupId: Number(groupId),
            })
          }
          sx={{
            alignItems: 'center',
            borderTop: `1px solid ${theme.palette.divider}`,
            color: 'text.secondary',
            display: 'flex',
            flexShrink: 0,
            fontSize: 12,
            fontWeight: 650,
            gap: 0.85,
            justifyContent: 'center',
            minHeight: 38,
            px: 1.5,
            transition: 'background-color 140ms ease, color 140ms ease',
            width: '100%',
            '&:hover': {
              backgroundColor: alpha(theme.palette.text.primary, 0.045),
              color: 'text.primary',
            },
          }}
        >
          <VisibilityOffRoundedIcon sx={{ fontSize: 17 }} />
          {t('group:chat_group.hidden_members')}
        </ButtonBase>
      )}
      <Menu
        anchorEl={actionMenu?.anchorEl}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        onClose={closeActionMenu}
        open={Boolean(actionMenu)}
        slotProps={{
          paper: {
            sx: {
              backgroundColor: theme.palette.background.paper,
              backgroundImage: 'none',
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: '8px',
              boxShadow: theme.shadows[8],
              maxWidth: 'calc(100vw - 32px)',
              minWidth: 220,
            },
          },
          list: { dense: true, sx: { p: 0.5 } },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
      >
        {actionMenu?.label && (
          <Typography
            component="li"
            role="presentation"
            sx={{
              color: 'text.secondary',
              fontSize: 12,
              fontWeight: 700,
              overflow: 'hidden',
              px: 1,
              py: 0.5,
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {actionMenu.label}
          </Typography>
        )}
        {(actionMenu?.actions || []).map((action) => {
          const ActionIcon = MEMBER_ACTION_ICON[action];
          const danger = action === 'ban';
          return (
            <MenuItem
              key={action}
              onClick={() => void runMemberAction(action, actionMenu.address)}
              sx={{
                borderRadius: '6px',
                color: danger ? 'error.main' : 'text.primary',
                fontSize: 13,
                fontWeight: 600,
                minHeight: 40,
                px: 1,
                '& .MuiListItemIcon-root': {
                  color: danger ? 'error.main' : 'text.secondary',
                  minWidth: 32,
                },
              }}
            >
              <ListItemIcon>
                <ActionIcon sx={{ fontSize: 19 }} />
              </ListItemIcon>
              {t(MEMBER_ACTION_LABEL_KEY[action], {
                postProcess: 'capitalizeFirstChar',
              })}
            </MenuItem>
          );
        })}
      </Menu>
    </div>
  );
};

export default ListOfMembers;
