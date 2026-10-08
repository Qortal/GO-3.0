import {
  alpha,
  Avatar,
  Box,
  ButtonBase,
  Dialog,
  DialogContent,
  DialogTitle,
  GlobalStyles,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Switch,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  type DragOverEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import PhoneIcon from '@mui/icons-material/Phone';
import { HubsIcon } from '../../assets/Icons/HubsIcon';
import { MessagingIcon } from '../../assets/Icons/MessagingIcon';
import { ContextMenu } from '../ContextMenu';
import type { QdnAvatarPriority } from '../../lib/qdnAvatars';
import { rowAvatarPriority, useGroupRowAvatar } from './useGroupRowAvatar';
import { prefetchReticulumGroupAboutMetadata } from './ReticulumGroupAbout';
import { formatEmailDate } from './qmailUtils';
import CampaignIcon from '@mui/icons-material/Campaign';
import MarkChatUnreadIcon from '@mui/icons-material/MarkChatUnread';
import LockIcon from '@mui/icons-material/Lock';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import { CustomButton } from '../../styles/App-styles';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import AccessibilityNewOutlinedIcon from '@mui/icons-material/AccessibilityNewOutlined';
import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import {
  groupAnnouncementSelector,
  groupChatTimestampSelector,
  groupPropertySelector,
  groupsAnnHasUnreadAtom,
  groupChatHasUnreadAtom,
  groupsOwnerNamesSelector,
  isRunningPublicNodeAtom,
  memberGroupsWithReticulumChatAtom,
  qortalGroupMeshCallActiveAtom,
  qortalGroupMeshCallMaxParticipantsAtom,
  qortalGroupMeshCallParticipantCountAtom,
  qortalGroupSelfGcallRoomIdAtom,
  reticulumHighlightOwnMessagesAtom,
  reticulumLegacyThreadsEnabledAtom,
  timestampEnterDataSelector,
} from '../../atoms/global';
import { timeDifferenceForNotificationChats } from './groupConstants';
import { useChatDraftKeys } from '../../hooks/useChatDraftKeys';
import { groupDraftKey } from '../../utils/chatPersistence';
import { DraftBadge } from '../Chat/DraftBadge';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { AvatarPreviewModal } from '../Chat/AvatarPreviewModal';
import { getClickableAvatarSx } from '../Chat/clickableAvatarStyles';
import { ReticulumTextSizeSettings } from '../Chat/ReticulumTextSizeSettings';
import {
  meshCallActiveForMemberGroup,
  meshCallMaxParticipantsForMemberGroup,
  meshCallParticipantCountForMemberGroup,
} from '../../lib/group-call/qortalGroupIdKey';
import {
  orderReticulumGroups,
  persistReticulumGroupOrder,
  readReticulumGroupOrder,
} from './reticulumGroupRail';
import { QChatWhatsNewDialog } from './QChatWhatsNewDialog';
import {
  getQChatMentionNotificationsEnabled,
  QCHAT_MENTION_NOTIFICATIONS_UPDATED_EVENT,
  setQChatMentionNotificationsEnabled,
} from '../../utils/qChatMentionNotifications';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { GO_VERSION } from '../../appVersion';
import {
  ReticulumUnreadCountBadge,
  RETICULUM_NOTIFICATION_RED,
} from '../common/ReticulumUnreadCountBadge';
import { ChatScopeSwitch } from './ChatScopeSwitch';
import {
  CHAT_LIST_AVATAR_SIZE,
  CHAT_LIST_TOUCH_TARGET,
  chatListAvatarSlotSx,
  chatListHeaderActionsSx,
  chatListHeaderButtonSx,
  chatListHeaderIconSx,
  chatListHeaderSx,
  chatListRowContentSx,
  chatListRowEdgeActionSx,
  chatListScrollPadding,
  chatListTextSx,
  getChatListAvatarFallbackSx,
  getChatListPanelSx,
  getChatListRowSx,
  getChatListSubtitleSx,
  getChatListTitleSx,
} from './chatListRowStyles';
import CloseIcon from '@mui/icons-material/Close';
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded';
import {
  applyPinnedGroupOrder,
  movePinnedGroup,
  usePinnedGroupIds,
} from '../../utils/pinnedGroups';
import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../../utils/mobileSafeArea';
import { withTabBarSpace } from '../Mobile/mobileBarHeights';

const RETICULUM_ACTIVE_BLUE = '#2563eb';
const RETICULUM_CALL_GREEN = '#22c55e';
/** Finger travel that turns a hold on a group's pin into a swipe or scroll
 * (same as the row's long-press menu). */
const PIN_HOLD_SLOP_PX = 10;

export const ReticulumChatSettingsDialog = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'reticulum']);
  const isNarrow = useMediaQuery(theme.breakpoints.down('sm'));
  const [activeSection, setActiveSection] = useState<
    'text-size' | 'messages' | 'notifications' | 'legacy-threads'
  >('text-size');
  const [accessibilityOpen, setAccessibilityExpanded] = useState(true);
  const [notificationsOpen, setNotificationsExpanded] = useState(true);
  const [legacyOpen, setLegacyExpanded] = useState(true);
  // Section groups are always expanded in the phone nav, where the collapsible
  // headers are hidden.
  const accessibilityExpanded = isNarrow || accessibilityOpen;
  const notificationsExpanded = isNarrow || notificationsOpen;
  const legacyExpanded = isNarrow || legacyOpen;
  const [highlightOwnMessages, setHighlightOwnMessages] = useAtom(
    reticulumHighlightOwnMessagesAtom
  );
  const [legacyThreadsEnabled, setLegacyThreadsEnabled] = useAtom(
    reticulumLegacyThreadsEnabledAtom
  );
  const [mentionNotificationsEnabled, setMentionNotificationsEnabled] =
    useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getQChatMentionNotificationsEnabled().then((enabled) => {
      if (!cancelled) setMentionNotificationsEnabled(enabled);
    });
    const handleSettingUpdated = (
      event: CustomEvent<{ enabled?: boolean }>
    ) => {
      setMentionNotificationsEnabled(event.detail?.enabled === true);
    };
    subscribeToEvent(
      QCHAT_MENTION_NOTIFICATIONS_UPDATED_EVENT,
      handleSettingUpdated as EventListener
    );
    return () => {
      cancelled = true;
      unsubscribeFromEvent(
        QCHAT_MENTION_NOTIFICATIONS_UPDATED_EVENT,
        handleSettingUpdated as EventListener
      );
    };
  }, [open]);
  const navButtonSx = (selected: boolean) => ({
    alignItems: 'center',
    backgroundColor: selected ? theme.palette.action.hover : 'transparent',
    border: '1px solid transparent',
    borderLeft: `${selected ? 3 : 0}px solid ${
      selected ? theme.palette.primary.main : 'transparent'
    }`,
    borderRadius: '7px',
    color: selected ? theme.palette.text.primary : theme.palette.text.secondary,
    display: 'flex',
    fontSize: 14,
    fontWeight: 550,
    gap: '10px',
    height: 40,
    justifyContent: 'flex-start',
    px: 1.5,
    py: 0,
    textTransform: 'none',
    whiteSpace: 'nowrap',
    width: '100%',
    '&:hover': {
      backgroundColor: selected
        ? theme.palette.action.selected
        : theme.palette.action.hover,
    },
  });
  const categoryButtonSx = {
    alignItems: 'center',
    color: 'text.secondary',
    // The horizontal phone nav has no room for collapsible group headers, so
    // every section button is shown directly instead.
    display: isNarrow ? 'none' : 'flex',
    fontSize: 11,
    fontWeight: 650,
    height: 32,
    justifyContent: 'space-between',
    letterSpacing: '0.08em',
    lineHeight: '16px',
    px: 0,
    textTransform: 'uppercase',
    width: '100%',
    '&:hover': {
      color: 'text.primary',
    },
  };

  return (
    <Dialog
      fullScreen={isNarrow}
      fullWidth
      maxWidth={false}
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          fontFamily: 'Inter, system-ui, Segoe UI, sans-serif',
          backgroundImage: 'none',
          border: isNarrow ? 'none' : `1px solid ${theme.palette.divider}`,
          borderRadius: isNarrow ? 0 : '10px',
          boxShadow: isNarrow ? 'none' : '0 24px 70px rgba(0,0,0,0.45)',
          maxWidth: isNarrow ? '100%' : 'calc(100vw - 32px)',
          // Tall enough for the text size preview and all three sizes.
          height: isNarrow ? '100%' : 'min(620px, calc(100vh - 32px))',
          width: isNarrow ? '100%' : 700,
          // Full-screen on phones starts under the system bars.
          ...(isNarrow
            ? {
                paddingBottom: SAFE_AREA_BOTTOM,
                paddingTop: SAFE_AREA_TOP,
              }
            : {}),
          '& button, & input, & textarea': {
            fontFamily: 'inherit',
          },
        },
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          pr: isNarrow ? 1 : 2,
        }}
      >
        <DialogTitle
          sx={{
            color: 'text.primary',
            fontFamily: 'Inter',
            fontSize: isNarrow ? 22 : 30,
            fontWeight: 750,
            lineHeight: isNarrow ? '28px' : '36px',
            pb: isNarrow ? 1 : 1.5,
            pt: { xs: 1.75, sm: 3.5 },
            px: { xs: 2, sm: 4 },
          }}
        >
          {t('core:settings', { postProcess: 'capitalizeFirstChar' })}
        </DialogTitle>
        {isNarrow && (
          <IconButton
            aria-label={t('core:action.close', {
              postProcess: 'capitalizeFirstChar',
            })}
            onClick={onClose}
            sx={chatListHeaderButtonSx}
          >
            <CloseIcon sx={{ fontSize: 24 }} />
          </IconButton>
        )}
      </Box>
      <Box
        sx={{
          borderTop: `1px solid ${theme.palette.divider}`,
          display: 'flex',
          flex: 1,
          flexDirection: isNarrow ? 'column' : 'row',
          minHeight: 0,
        }}
      >
        <Box
          sx={{
            backgroundColor: 'rgba(255,255,255,0.018)',
            display: 'flex',
            gap: 0.75,
            // The section nav becomes a scrollable strip above the content on
            // phones; a 220px column would leave nothing for the settings.
            ...(isNarrow
              ? {
                  alignItems: 'center',
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  flexDirection: 'row',
                  flexShrink: 0,
                  overflowX: 'auto',
                  p: '10px 12px',
                  scrollbarWidth: 'none',
                  width: '100%',
                  '&::-webkit-scrollbar': { display: 'none' },
                  '& > *': { flexShrink: 0, width: 'auto !important' },
                }
              : {
                  borderRight: `1px solid ${theme.palette.divider}`,
                  flexDirection: 'column',
                  p: '20px',
                  width: 220,
                }),
          }}
        >
          <ButtonBase
            aria-expanded={accessibilityExpanded}
            onClick={() => setAccessibilityExpanded((expanded) => !expanded)}
            sx={categoryButtonSx}
          >
            <span>{t('reticulum:settings.category.accessibility')}</span>
            {accessibilityExpanded ? (
              <ExpandMoreRoundedIcon sx={{ fontSize: 18 }} />
            ) : (
              <ChevronRightRoundedIcon sx={{ fontSize: 18 }} />
            )}
          </ButtonBase>
          {accessibilityExpanded && (
            <>
              <ButtonBase
                onClick={() => setActiveSection('text-size')}
                sx={navButtonSx(activeSection === 'text-size')}
              >
                <AccessibilityNewOutlinedIcon sx={{ fontSize: 19 }} />
                {t('reticulum:settings.nav.text_size')}
              </ButtonBase>
              <ButtonBase
                onClick={() => setActiveSection('messages')}
                sx={navButtonSx(activeSection === 'messages')}
              >
                <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 19 }} />
                {t('reticulum:settings.nav.messages')}
              </ButtonBase>
            </>
          )}
          <ButtonBase
            aria-expanded={notificationsExpanded}
            onClick={() => setNotificationsExpanded((expanded) => !expanded)}
            sx={{ ...categoryButtonSx, mt: 2.25 }}
          >
            <span>{t('reticulum:settings.notifications.title')}</span>
            {notificationsExpanded ? (
              <ExpandMoreRoundedIcon sx={{ fontSize: 18 }} />
            ) : (
              <ChevronRightRoundedIcon sx={{ fontSize: 18 }} />
            )}
          </ButtonBase>
          {notificationsExpanded && (
            <ButtonBase
              onClick={() => setActiveSection('notifications')}
              sx={navButtonSx(activeSection === 'notifications')}
            >
              <NotificationsNoneRoundedIcon sx={{ fontSize: 19 }} />
              {t('reticulum:settings.nav.mentions')}
            </ButtonBase>
          )}
          <ButtonBase
            aria-expanded={legacyExpanded}
            onClick={() => setLegacyExpanded((expanded) => !expanded)}
            sx={{ ...categoryButtonSx, mt: 2.25 }}
          >
            <span>{t('reticulum:settings.category.legacy')}</span>
            {legacyExpanded ? (
              <ExpandMoreRoundedIcon sx={{ fontSize: 18 }} />
            ) : (
              <ChevronRightRoundedIcon sx={{ fontSize: 18 }} />
            )}
          </ButtonBase>
          {legacyExpanded && (
            <ButtonBase
              onClick={() => setActiveSection('legacy-threads')}
              sx={navButtonSx(activeSection === 'legacy-threads')}
            >
              <ForumRoundedIcon sx={{ fontSize: 19 }} />
              {t('reticulum:settings.nav.threads')}
            </ButtonBase>
          )}
        </Box>
        <DialogContent
          sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: '28px' }}
        >
          {activeSection === 'text-size' ? (
            <ReticulumTextSizeSettings />
          ) : activeSection === 'messages' ? (
            <>
              <Typography
                component="h2"
                sx={{
                  color: 'text.primary',
                  fontSize: 20,
                  fontWeight: 650,
                  lineHeight: '26px',
                }}
              >
                {t('reticulum:settings.messages.title')}
              </Typography>
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: 14,
                  fontWeight: 400,
                  lineHeight: '20px',
                  maxWidth: 460,
                  mt: 0.75,
                }}
              >
                {t('reticulum:settings.messages.description')}
              </Typography>
              <Box
                sx={{
                  alignItems: 'center',
                  backgroundColor: 'background.default',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '10px',
                  display: 'flex',
                  gap: 2,
                  justifyContent: 'space-between',
                  mt: 2.5,
                  px: 2,
                  py: 1.5,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      color: 'text.primary',
                      fontSize: 14,
                      fontWeight: 600,
                      lineHeight: '20px',
                    }}
                  >
                    {t('reticulum:settings.messages.highlight_own.label')}
                  </Typography>
                  <Typography
                    sx={{
                      color: 'text.secondary',
                      fontSize: 13,
                      lineHeight: '18px',
                      mt: 0.25,
                    }}
                  >
                    {t('reticulum:settings.messages.highlight_own.description')}
                  </Typography>
                </Box>
                <Switch
                  checked={highlightOwnMessages === true}
                  inputProps={{
                    'aria-label': t(
                      'reticulum:settings.messages.highlight_own.label'
                    ),
                  }}
                  onChange={(_, checked) => setHighlightOwnMessages(checked)}
                />
              </Box>
            </>
          ) : activeSection === 'notifications' ? (
            <>
              <Typography
                component="h2"
                sx={{
                  color: 'text.primary',
                  fontSize: 20,
                  fontWeight: 650,
                  lineHeight: '26px',
                }}
              >
                {t('reticulum:settings.notifications.title')}
              </Typography>
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: 14,
                  fontWeight: 400,
                  lineHeight: '20px',
                  maxWidth: 460,
                  mt: 0.75,
                }}
              >
                {t('reticulum:settings.notifications.description')}
              </Typography>
              <Box
                sx={{
                  alignItems: 'center',
                  backgroundColor: 'background.default',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '10px',
                  display: 'flex',
                  gap: 2,
                  justifyContent: 'space-between',
                  mt: 2.5,
                  px: 2,
                  py: 1.5,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      color: 'text.primary',
                      fontSize: 14,
                      fontWeight: 600,
                      lineHeight: '20px',
                    }}
                  >
                    {t('reticulum:settings.notifications.mentions.label')}
                  </Typography>
                  <Typography
                    sx={{
                      color: 'text.secondary',
                      fontSize: 13,
                      lineHeight: '18px',
                      mt: 0.25,
                    }}
                  >
                    {t('reticulum:settings.notifications.mentions.description')}
                  </Typography>
                </Box>
                <Switch
                  checked={mentionNotificationsEnabled === true}
                  inputProps={{
                    'aria-label': t(
                      'reticulum:settings.notifications.mentions.label'
                    ),
                  }}
                  onChange={(_, checked) => {
                    setMentionNotificationsEnabled(checked);
                    void setQChatMentionNotificationsEnabled(checked).catch(
                      () => setMentionNotificationsEnabled(!checked)
                    );
                  }}
                />
              </Box>
            </>
          ) : activeSection === 'legacy-threads' ? (
            <>
              <Typography
                component="h2"
                sx={{
                  color: 'text.primary',
                  fontSize: 20,
                  fontWeight: 650,
                  lineHeight: '26px',
                }}
              >
                {t('reticulum:settings.legacy.title')}
              </Typography>
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: 14,
                  fontWeight: 400,
                  lineHeight: '20px',
                  maxWidth: 460,
                  mt: 0.75,
                }}
              >
                {t('reticulum:settings.legacy.description')}
              </Typography>
              <Box
                sx={{
                  alignItems: 'center',
                  backgroundColor: 'background.default',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '10px',
                  display: 'flex',
                  gap: 2,
                  justifyContent: 'space-between',
                  mt: 2.5,
                  px: 2,
                  py: 1.5,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      color: 'text.primary',
                      fontSize: 14,
                      fontWeight: 600,
                      lineHeight: '20px',
                    }}
                  >
                    {t('reticulum:settings.legacy.toggle.label')}
                  </Typography>
                  <Typography
                    sx={{
                      color: 'text.secondary',
                      fontSize: 13,
                      lineHeight: '18px',
                      mt: 0.25,
                    }}
                  >
                    {t('reticulum:settings.legacy.toggle.description')}
                  </Typography>
                </Box>
                <Switch
                  checked={legacyThreadsEnabled === true}
                  inputProps={{
                    'aria-label': t('reticulum:settings.legacy.toggle.aria'),
                  }}
                  onChange={(_, checked) => setLegacyThreadsEnabled(checked)}
                />
              </Box>
              <Typography
                sx={{
                  color: theme.palette.error.main,
                  fontSize: 13,
                  lineHeight: '19px',
                  mt: 1.5,
                }}
              >
                {t('reticulum:settings.legacy.warning')}
              </Typography>
            </>
          ) : null}
        </DialogContent>
      </Box>
    </Dialog>
  );
};

type GroupDragInsertionPosition = 'before' | 'after';

type GroupDragTarget = {
  activeId: string;
  overId: string;
  position: GroupDragInsertionPosition;
};

const groupDragInsertionPosition = (
  event: DragEndEvent | DragOverEvent
): GroupDragInsertionPosition => {
  const translated = event.active.rect.current.translated;
  if (!translated || !event.over) return 'before';
  const activeMiddle = translated.top + translated.height / 2;
  const overMiddle = event.over.rect.top + event.over.rect.height / 2;
  return activeMiddle > overMiddle ? 'after' : 'before';
};

const moveGroupByInsertion = <T,>(
  items: T[],
  sourceIndex: number,
  targetIndex: number,
  position: GroupDragInsertionPosition
) => {
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  const rawIndex = targetIndex + (position === 'after' ? 1 : 0);
  const insertionIndex = Math.max(
    0,
    Math.min(rawIndex - (sourceIndex < rawIndex ? 1 : 0), next.length)
  );
  next.splice(insertionIndex, 0, moved);
  return next;
};

function GroupDropIndicator({
  position,
}: {
  position: GroupDragInsertionPosition;
}) {
  return (
    <Box
      aria-hidden
      sx={{
        backgroundColor: RETICULUM_ACTIVE_BLUE,
        borderRadius: '999px',
        boxShadow: '0 0 0 1px rgba(37, 99, 235, 0.22)',
        height: 2,
        left: 6,
        pointerEvents: 'none',
        position: 'absolute',
        right: 6,
        ...(position === 'before' ? { top: -4 } : { bottom: -4 }),
        zIndex: 7,
      }}
    />
  );
}

const ReticulumDmMorphIcon = ({
  active,
  color,
}: {
  active: boolean;
  color: string;
}) => (
  <Box
    component="span"
    className="reticulum-dm-morph-icon"
    sx={{
      color,
      display: 'inline-flex',
      height: 25,
      overflow: 'hidden',
      position: 'relative',
      transition: 'color 150ms ease',
      width: 25,
      '@keyframes reticulumDmLand': {
        '0%': { opacity: 0, transform: 'translateY(-30px) scale(0.96)' },
        '55%': { opacity: 1 },
        '100%': { opacity: 1, transform: 'translateY(0) scale(1)' },
      },
      '@keyframes reticulumDmExit': {
        '0%': { opacity: 1, transform: 'translateY(0) scale(1)' },
        '100%': { opacity: 0, transform: 'translateY(30px) scale(0.94)' },
      },
      '@keyframes reticulumQortalDrop': {
        '0%': { opacity: 0, transform: 'translateY(-30px) scale(0.94)' },
        '55%': { opacity: 1 },
        '100%': { opacity: 1, transform: 'translateY(0) scale(1)' },
      },
      '@keyframes reticulumQortalExit': {
        '0%': { opacity: 1, transform: 'translateY(0) scale(1)' },
        '100%': { opacity: 0, transform: 'translateY(30px) scale(0.94)' },
      },
      '& svg': {
        display: 'block',
        height: '100%',
        inset: 0,
        overflow: 'visible',
        position: 'absolute',
        transformBox: 'fill-box',
        transformOrigin: '50% 50%',
        width: '100%',
      },
      '& .reticulum-dm-front': {
        animation: active
          ? 'reticulumDmExit 360ms cubic-bezier(0.3, 0, 0.2, 1) both'
          : 'reticulumDmLand 420ms cubic-bezier(0.2, 0.9, 0.2, 1) both',
        opacity: active ? 0 : 1,
        transform: active
          ? 'translateY(30px) scale(0.94)'
          : 'translateY(0) scale(1)',
      },
      '& .reticulum-dm-back': {
        animation: active
          ? 'reticulumQortalDrop 420ms cubic-bezier(0.2, 0.9, 0.2, 1) both'
          : 'reticulumQortalExit 360ms cubic-bezier(0.3, 0, 0.2, 1) both',
        opacity: active ? 1 : 0,
        transform: active
          ? 'translateY(0) scale(1)'
          : 'translateY(30px) scale(0.94)',
      },
    }}
  >
    <svg
      aria-hidden="true"
      className="reticulum-dm-front"
      focusable="false"
      viewBox="0 0 32 32"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      >
        <path d="M4.8 15.9 26.4 5.7 20 26.2l-4.4-8.1-6.8 5.2 2.3-7.3z" />
        <path d="M11.2 16 20 10.2" opacity="0.55" />
      </g>
    </svg>
    <svg
      aria-hidden="true"
      className="reticulum-dm-back"
      focusable="false"
      viewBox="0 0 32 32"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.45"
      >
        <path d="M16 3.8 25.7 9.4v11.2L16 26.2l-9.7-5.6V9.4z" opacity="0.95" />
        <path d="M16 8.2 22 11.7v7L16 22.2l-6-3.5v-7z" />
        <path d="M13.2 20.5 16 22.1l2.6-1.5" />
        <path d="M20.7 18.1 27.4 22.5" />
      </g>
    </svg>
  </Box>
);

const GroupListInner = ({
  selectGroupFunc,
  setDesktopSideView,
  desktopSideView,
  directChatHasUnread,
  directChatUnreadCount,
  chatMode,
  selectedGroup,
  getUserSettings,
  setOpenAddGroup,
  setOpenFindGroup,
  setIsOpenBlockedUserModal,
  myAddress,
  reticulumChatEnabled,
  // Phones: show the named group list even while DMs are the current scope,
  // for the Groups / DMs pager that keeps it right beside them.
  keepPhoneList = false,
  // Phones: the header with the Groups / DMs switch sits above both lists
  // (MobileChatListHeader), so the list leaves out its own.
  hideMobileHeader = false,
}) => {
  const theme = useTheme();
  // Compact the Groups/DM toggle on landscape phones, where the tall stacked
  // buttons eat the vertical space needed to read the list.
  const isMobileWidth = useMediaQuery(theme.breakpoints.down('md'));
  const isLandscape = useMediaQuery('(orientation: landscape)');
  const compactToggle = isMobileWidth && isLandscape;
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'reticulum',
    'tutorial',
  ]);
  const [isRunningPublicNode] = useAtom(isRunningPublicNodeAtom);
  const [reticulumSettingsOpen, setReticulumSettingsOpen] = useState(false);
  const [reticulumWhatsNewOpen, setReticulumWhatsNewOpen] = useState(false);
  const groups = useAtomValue(memberGroupsWithReticulumChatAtom);
  const groupChatHasUnread = useAtomValue(groupChatHasUnreadAtom);
  const groupsAnnHasUnread = useAtomValue(groupsAnnHasUnreadAtom);
  const draftKeys = useChatDraftKeys(myAddress);
  const railMode = Boolean(reticulumChatEnabled);
  // On phones the rail alone gives no readable group names, so pair it with a
  // list panel unless the DM list already owns that space.
  const showMobileGroupPanel =
    railMode &&
    isMobileWidth &&
    (desktopSideView !== 'directs' || keepPhoneList);
  const [manualGroupOrder, setManualGroupOrder] = useState<string[]>(
    readReticulumGroupOrder
  );
  const [groupDragTarget, setGroupDragTarget] =
    useState<GroupDragTarget | null>(null);
  const groupDragTargetRef = useRef<GroupDragTarget | null>(null);
  const groupDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const pinnedGroupIds = usePinnedGroupIds();
  const orderedGroups = useMemo(() => {
    if (!railMode) return groups;
    return applyPinnedGroupOrder(
      orderReticulumGroups(groups, manualGroupOrder),
      pinnedGroupIds
    );
  }, [groups, manualGroupOrder, pinnedGroupIds, railMode]);
  const pinnedIdSet = useMemo(() => new Set(pinnedGroupIds), [pinnedGroupIds]);
  const pinnedGroups = useMemo(
    () =>
      orderedGroups.filter((group: any) =>
        pinnedIdSet.has(String(group?.groupId))
      ),
    [orderedGroups, pinnedIdSet]
  );
  const unpinnedGroups = useMemo(
    () =>
      orderedGroups.filter(
        (group: any) => !pinnedIdSet.has(String(group?.groupId))
      ),
    [orderedGroups, pinnedIdSet]
  );
  const [pinnedReorderMode, setPinnedReorderMode] = useState(false);
  useEffect(() => {
    if (pinnedGroups.length < 2) setPinnedReorderMode(false);
  }, [pinnedGroups.length]);
  const pinnedDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const handlePinnedDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const ids = pinnedGroups.map((group: any) => String(group?.groupId));
      const from = ids.indexOf(String(active.id));
      const to = ids.indexOf(String(over.id));
      if (from === -1 || to === -1) return;
      void movePinnedGroup(from, to);
    },
    [pinnedGroups]
  );
  const orderedGroupIds = useMemo(
    () => orderedGroups.map((group: any) => String(group?.groupId)),
    [orderedGroups]
  );

  const persistManualGroupOrder = useCallback((nextOrder: string[]) => {
    setManualGroupOrder(nextOrder);
    persistReticulumGroupOrder(nextOrder);
  }, []);

  const handleGroupDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = orderedGroupIds.indexOf(String(active.id));
      const newIndex = orderedGroupIds.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      persistManualGroupOrder(
        moveGroupByInsertion(
          orderedGroupIds,
          oldIndex,
          newIndex,
          groupDragInsertionPosition(event)
        )
      );
    },
    [orderedGroupIds, persistManualGroupOrder]
  );

  const updateGroupDragTarget = useCallback(
    (nextTarget: GroupDragTarget | null) => {
      const currentTarget = groupDragTargetRef.current;
      if (
        currentTarget?.activeId === nextTarget?.activeId &&
        currentTarget?.overId === nextTarget?.overId &&
        currentTarget?.position === nextTarget?.position
      ) {
        return;
      }
      groupDragTargetRef.current = nextTarget;
      setGroupDragTarget(nextTarget);
    },
    []
  );

  const handleGroupDragOver = useCallback(
    (event: DragOverEvent) => {
      if (!event.over || event.active.id === event.over.id) {
        updateGroupDragTarget(null);
        return;
      }
      updateGroupDragTarget({
        activeId: String(event.active.id),
        overId: String(event.over.id),
        position: groupDragInsertionPosition(event),
      });
    },
    [updateGroupDragTarget]
  );

  if (railMode) {
    const rail = (
      <Box
        data-tour="hub-group-rail"
        sx={{
          alignItems: 'center',
          background: theme.palette.background.surface,
          borderRight: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          height: '100%',
          padding: '10px 9px',
          width: '72px',
        }}
      >
        <GlobalStyles
          styles={{
            '.MuiTooltip-tooltip': {
              backgroundColor:
                theme.palette.mode === 'dark'
                  ? `color-mix(in srgb, ${theme.palette.background.surface} 70%, #000) !important`
                  : `${theme.palette.grey[100]} !important`,
              border: `1px solid ${theme.palette.divider} !important`,
              borderRadius: '6px',
              boxShadow: '0 8px 18px rgba(0, 0, 0, 0.28)',
              color: theme.palette.text.primary,
              fontSize: 12,
              fontWeight: 600,
              padding: '6px 8px',
            },
            '.MuiTooltip-arrow': {
              color:
                theme.palette.mode === 'dark'
                  ? `color-mix(in srgb, ${theme.palette.background.surface} 70%, #000) !important`
                  : `${theme.palette.grey[100]} !important`,
            },
          }}
        />
        <Tooltip
          placement="right"
          title={
            desktopSideView === 'directs'
              ? t('reticulum:chat_scope.groups', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('group:dm.direct_messages')
          }
        >
          <ButtonBase
            data-tour="hub-direct-messages"
            onClick={() => {
              setDesktopSideView('directs');
            }}
            sx={{
              alignItems: 'center',
              backgroundColor:
                desktopSideView === 'directs'
                  ? theme.palette.action.selected
                  : 'transparent',
              borderRadius: '8px',
              display: 'flex',
              height: 42,
              justifyContent: 'center',
              mb: 1,
              position: 'relative',
              width: 42,
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
              },
              '&:hover .reticulum-dm-morph-icon': {
                color: theme.palette.primary.main,
              },
            }}
          >
            {directChatHasUnread && (
              <ReticulumUnreadCountBadge
                count={directChatUnreadCount}
                outlineColor={theme.palette.background.surface}
                sx={{
                  bottom: -2,
                  position: 'absolute',
                  right: -2,
                  zIndex: 2,
                }}
              />
            )}
            <ReticulumDmMorphIcon
              active={desktopSideView === 'directs'}
              color={
                desktopSideView === 'directs'
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary
              }
            />
          </ButtonBase>
        </Tooltip>
        <Box
          sx={{
            borderTop: '1px solid',
            borderColor: 'divider',
            mb: 1,
            width: 34,
          }}
        />

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            gap: '6px',
            minHeight: 0,
            overflowX: 'visible',
            overflowY: 'auto',
            scrollbarWidth: 'none',
            width: '100%',
            msOverflowStyle: 'none',
            '&::-webkit-scrollbar': {
              display: 'none',
              height: 0,
              width: 0,
            },
            '&::-webkit-scrollbar-corner': {
              display: 'none',
            },
          }}
        >
          <DndContext
            collisionDetection={closestCenter}
            onDragCancel={() => updateGroupDragTarget(null)}
            onDragEnd={(event) => {
              updateGroupDragTarget(null);
              handleGroupDragEnd(event);
            }}
            onDragOver={handleGroupDragOver}
            sensors={groupDndSensors}
          >
            <SortableContext
              items={orderedGroupIds}
              strategy={verticalListSortingStrategy}
            >
              <List
                className="group-list"
                dense
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  overflow: 'visible',
                  p: 0,
                  width: '100%',
                }}
              >
                {orderedGroups.map((group: any, index: number) => (
                  <GroupItem
                    selectGroupFunc={selectGroupFunc}
                    key={group.groupId}
                    group={group}
                    avatarPriority={rowAvatarPriority(index)}
                    dropPosition={
                      groupDragTarget?.activeId !== String(group.groupId) &&
                      groupDragTarget?.overId === String(group.groupId)
                        ? groupDragTarget.position
                        : undefined
                    }
                    selectedGroupId={selectedGroup?.groupId ?? null}
                    getUserSettings={getUserSettings}
                    myAddress={myAddress}
                    reticulumChatEnabled={reticulumChatEnabled}
                    railMode
                  />
                ))}
              </List>
            </SortableContext>
          </DndContext>
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            borderTop: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            mt: 1.25,
            pb: 1,
            pt: 1.75,
            width: '100%',
          }}
        >
          <Tooltip placement="right" title={t('reticulum:rail.find_groups')}>
            <ButtonBase
              data-tour="hub-group-discovery"
              aria-label={t('reticulum:rail.find_groups')}
              onClick={() => {
                setOpenFindGroup(true);
              }}
              sx={{
                alignItems: 'center',
                borderRadius: '8px',
                color: theme.palette.text.secondary,
                display: 'flex',
                height: 34,
                justifyContent: 'center',
                width: 34,
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                  color: theme.palette.text.primary,
                },
              }}
            >
              <SearchRoundedIcon sx={{ fontSize: 20 }} />
            </ButtonBase>
          </Tooltip>

          <Tooltip
            placement="right"
            title={t('group:action.create_group', {
              postProcess: 'capitalizeFirstChar',
            })}
          >
            <ButtonBase
              aria-label={t('group:action.create_group', {
                postProcess: 'capitalizeFirstChar',
              })}
              onClick={() => {
                setOpenAddGroup(true);
              }}
              sx={{
                alignItems: 'center',
                borderRadius: '8px',
                color: theme.palette.text.secondary,
                display: 'flex',
                height: 34,
                justifyContent: 'center',
                width: 34,
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                  color: theme.palette.text.primary,
                },
              }}
            >
              <AddCircleOutlineIcon sx={{ fontSize: 21 }} />
            </ButtonBase>
          </Tooltip>

          <Tooltip placement="right" title={t('reticulum:rail.group_settings')}>
            <ButtonBase
              aria-label={t('reticulum:rail.group_settings')}
              onClick={() => {
                setReticulumSettingsOpen(true);
              }}
              sx={{
                alignItems: 'center',
                borderRadius: '8px',
                color: theme.palette.text.secondary,
                display: 'flex',
                height: 34,
                justifyContent: 'center',
                width: 34,
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                  color: theme.palette.text.primary,
                },
              }}
            >
              <SettingsOutlinedIcon sx={{ fontSize: 20 }} />
            </ButtonBase>
          </Tooltip>

          <ButtonBase
            aria-label={t('reticulum:rail.whats_new')}
            onClick={() => setReticulumWhatsNewOpen(true)}
            sx={{
              borderRadius: '5px',
              color: theme.palette.text.secondary,
              fontSize: 10.5,
              fontWeight: 650,
              lineHeight: 1,
              mb: 0.25,
              px: 0.75,
              py: 0.5,
              transition: 'color 150ms ease, background-color 150ms ease',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.common.white,
              },
            }}
          >
            {`v${GO_VERSION}`}
          </ButtonBase>
        </Box>
        <ReticulumChatSettingsDialog
          open={reticulumSettingsOpen}
          onClose={() => setReticulumSettingsOpen(false)}
        />
        <QChatWhatsNewDialog
          onClose={() => setReticulumWhatsNewOpen(false)}
          open={reticulumWhatsNewOpen}
        />
      </Box>
    );

    if (!showMobileGroupPanel) return rail;

    // Phones get a single full-width list of named groups instead of the
    // avatar rail plus a second panel. The rail stays mounted but hidden
    // because it owns the settings and what's-new dialogs, which render into
    // portals and so are unaffected by the hidden wrapper.
    return (
      <Box
        // While pinned groups are being reordered, no swipe from anywhere on
        // the list leaves for the DM list mid-arrangement.
        data-pager-swipe-ignore={pinnedReorderMode ? '' : undefined}
        sx={{
          display: 'flex',
          height: '100%',
          minHeight: 0,
          width: '100%',
        }}
      >
        <Box sx={{ display: 'none' }}>{rail}</Box>
        <Box
          sx={{
            ...getChatListPanelSx(theme),
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            minHeight: 0,
            minWidth: 0,
          }}
        >
          {!hideMobileHeader && (
            <Box sx={chatListHeaderSx}>
              <ChatScopeSwitch
                directHasUnread={directChatHasUnread}
                directUnreadCount={directChatUnreadCount}
                onChange={setDesktopSideView}
                value="groups"
              />
              <Box sx={chatListHeaderActionsSx}>
                {/* The onboarding tour's "find groups" step points here on
                  phones; the hidden rail keeps the desktop anchor. */}
                <IconButton
                  aria-label={t('reticulum:rail.find_groups')}
                  data-tour="hub-group-discovery"
                  onClick={() => setOpenFindGroup(true)}
                  sx={chatListHeaderButtonSx}
                >
                  <SearchRoundedIcon sx={chatListHeaderIconSx} />
                </IconButton>
                <IconButton
                  aria-label={t('group:action.create_group', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  onClick={() => setOpenAddGroup(true)}
                  sx={chatListHeaderButtonSx}
                >
                  <AddCircleOutlineIcon sx={chatListHeaderIconSx} />
                </IconButton>
                <IconButton
                  aria-label={t('reticulum:rail.group_settings')}
                  onClick={() => setReticulumSettingsOpen(true)}
                  sx={chatListHeaderButtonSx}
                >
                  <SettingsOutlinedIcon sx={chatListHeaderIconSx} />
                </IconButton>
              </Box>
            </Box>
          )}
          <Box
            // The phone Groups / DMs pager keeps sideways swipes off this
            // list.
            data-pager-scroller=""
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: chatListScrollPadding,
              // The last group scrolls clear of the floating tab buttons.
              paddingBottom: withTabBarSpace(10, '10px'),
            }}
          >
            {orderedGroups.length === 0 && (
              <Box sx={{ px: 1.5, py: 3, textAlign: 'center' }}>
                <Typography
                  sx={{ color: 'text.secondary', fontSize: 14, mb: 1.5 }}
                >
                  {t('reticulum:group_list.empty')}
                </Typography>
                <CustomButton
                  onClick={() => setOpenFindGroup(true)}
                  role="button"
                  sx={{
                    gap: '8px',
                    minHeight: CHAT_LIST_TOUCH_TARGET,
                    padding: '10px 16px',
                  }}
                >
                  <SearchRoundedIcon sx={{ fontSize: 20 }} />
                  {t('reticulum:onboarding.find_communities')}
                </CustomButton>
              </Box>
            )}
            {pinnedReorderMode && (
              <Box
                sx={{
                  alignItems: 'center',
                  backgroundColor: alpha(theme.palette.primary.main, 0.14),
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.45)}`,
                  borderRadius: '10px',
                  display: 'flex',
                  gap: 1,
                  justifyContent: 'space-between',
                  mb: '8px',
                  pl: 1.5,
                  pr: 0.75,
                  py: 0.75,
                }}
              >
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
                  {t('reticulum:group_list.reorder_hint')}
                </Typography>
                <CustomButton
                  onClick={() => setPinnedReorderMode(false)}
                  role="button"
                  sx={{
                    flexShrink: 0,
                    fontSize: 14,
                    minHeight: CHAT_LIST_TOUCH_TARGET,
                    minWidth: 72,
                    padding: '8px 18px',
                  }}
                >
                  {t('group:chat_group.done')}
                </CustomButton>
              </Box>
            )}
            <List className="group-list" dense={false} sx={{ p: 0 }}>
              {pinnedGroups.length > 0 && (
                <DndContext
                  collisionDetection={closestCenter}
                  onDragEnd={handlePinnedDragEnd}
                  sensors={pinnedDragSensors}
                >
                  <SortableContext
                    items={pinnedGroups.map((group: any) =>
                      String(group.groupId)
                    )}
                    strategy={verticalListSortingStrategy}
                  >
                    {pinnedGroups.map((group: any, index: number) => (
                      <GroupItem
                        selectGroupFunc={selectGroupFunc}
                        key={group.groupId}
                        group={group}
                        avatarPriority={rowAvatarPriority(index)}
                        selectedGroupId={selectedGroup?.groupId ?? null}
                        getUserSettings={getUserSettings}
                        myAddress={myAddress}
                        hasDraft={draftKeys.has(groupDraftKey(group.groupId))}
                        reticulumChatEnabled={reticulumChatEnabled}
                        isPinned
                        canReorderPins={pinnedGroups.length > 1}
                        pinDragEnabled={pinnedReorderMode}
                        onRequestPinReorder={() => setPinnedReorderMode(true)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
              {unpinnedGroups.map((group: any, index: number) => (
                <GroupItem
                  selectGroupFunc={selectGroupFunc}
                  key={group.groupId}
                  group={group}
                  avatarPriority={rowAvatarPriority(
                    pinnedGroups.length + index
                  )}
                  selectedGroupId={selectedGroup?.groupId ?? null}
                  getUserSettings={getUserSettings}
                  myAddress={myAddress}
                  hasDraft={draftKeys.has(groupDraftKey(group.groupId))}
                  reticulumChatEnabled={reticulumChatEnabled}
                />
              ))}
            </List>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        // In landscape the layout is a row (list + right rail); children must
        // stretch to full height so the list can scroll. In portrait keep the
        // original top-aligned column.
        alignItems: compactToggle ? 'stretch' : 'flex-start',
        background: theme.palette.background.surface,
        borderRadius: '0 12px 12px 0',
        borderLeft: '1px solid',
        borderColor: 'divider',
        boxShadow: '6px 0 20px rgba(0,0,0,0.18), 2px 0 8px rgba(0,0,0,0.08)',
        display: 'flex',
        // Landscape: list on the left, a vertical toggle/action rail on the
        // right (no wasted top band).
        flexDirection: compactToggle ? 'row' : 'column',
        minHeight: 0,
        height: '100%',
        padding: '0',
        position: 'relative',
        // Fixed 400px rail only on real desktop (md+); below that (incl.
        // landscape phones 600-899px) it fills the screen so there's no
        // empty space beside the list.
        width: { xs: '100%', md: '400px' },
        flexShrink: 0,
      }}
    >
      <Box
        sx={{
          alignItems: 'stretch',
          borderBottom: compactToggle ? 'none' : '1px solid',
          borderLeft: compactToggle ? '1px solid' : 'none',
          borderColor: 'divider',
          display: 'flex',
          flexDirection: compactToggle ? 'column' : 'row',
          flexShrink: 0,
          gap: compactToggle ? '8px' : '10px',
          justifyContent: compactToggle ? 'flex-start' : 'center',
          order: compactToggle ? 2 : 0,
          overflowY: compactToggle ? 'auto' : undefined,
          padding: compactToggle ? '10px 8px' : '14px 12px',
          width: compactToggle ? '92px' : '100%',
        }}
      >
        <ButtonBase
          onClick={() => {
            setDesktopSideView('groups');
          }}
          sx={{
            position: 'relative',
            borderRadius: '12px',
            flex: compactToggle ? '0 0 auto' : 1,
            minWidth: 0,
            padding: compactToggle ? '7px 10px' : '14px 12px',
            backgroundColor:
              desktopSideView === 'groups'
                ? theme.palette.action.selected
                : 'transparent',
            transition: 'background-color 0.15s ease',
            '&:hover': {
              backgroundColor:
                desktopSideView === 'groups'
                  ? theme.palette.action.selected
                  : theme.palette.action.hover,
            },
          }}
        >
          {(groupChatHasUnread || groupsAnnHasUnread) && (
            <Box
              sx={{
                position: 'absolute',
                top: compactToggle ? 4 : 8,
                right: compactToggle ? 4 : 8,
                width: compactToggle ? 11 : 14,
                height: compactToggle ? 11 : 14,
                borderRadius: '50%',
                backgroundColor: theme.palette.primary.main,
                border: `2px solid ${theme.palette.background.paper}`,
              }}
              aria-hidden
            />
          )}
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: compactToggle ? '4px' : '10px',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <HubsIcon
              height={compactToggle ? 20 : 26}
              width={compactToggle ? 20 : 26}
              color={
                groupChatHasUnread || groupsAnnHasUnread
                  ? theme.palette.primary.main
                  : desktopSideView === 'groups'
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary
              }
            />
            <Typography
              sx={{
                color:
                  groupChatHasUnread || groupsAnnHasUnread
                    ? theme.palette.primary.main
                    : desktopSideView === 'groups'
                      ? theme.palette.text.primary
                      : theme.palette.text.secondary,
                fontFamily: 'Inter',
                fontSize: '13px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {t('group:group.group_other', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            setDesktopSideView('directs');
          }}
          sx={{
            position: 'relative',
            borderRadius: '12px',
            flex: compactToggle ? '0 0 auto' : 1,
            minWidth: 0,
            padding: compactToggle ? '7px 10px' : '14px 12px',
            backgroundColor:
              desktopSideView === 'directs'
                ? theme.palette.action.selected
                : 'transparent',
            transition: 'background-color 0.15s ease',
            '&:hover': {
              backgroundColor:
                desktopSideView === 'directs'
                  ? theme.palette.action.selected
                  : theme.palette.action.hover,
            },
          }}
        >
          {directChatHasUnread && (
            <Box
              sx={{
                position: 'absolute',
                top: compactToggle ? 4 : 8,
                right: compactToggle ? 4 : 8,
                width: compactToggle ? 11 : 14,
                height: compactToggle ? 11 : 14,
                borderRadius: '50%',
                backgroundColor: theme.palette.primary.main,
                border: `2px solid ${theme.palette.background.paper}`,
              }}
              aria-hidden
            />
          )}
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: compactToggle ? '4px' : '10px',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <MessagingIcon
              height={compactToggle ? 20 : 26}
              width={compactToggle ? 20 : 26}
              color={
                directChatHasUnread
                  ? theme.palette.primary.main
                  : desktopSideView === 'directs'
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary
              }
            />
            <Typography
              sx={{
                color: directChatHasUnread
                  ? theme.palette.primary.main
                  : desktopSideView === 'directs'
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary,
                fontFamily: 'Inter',
                fontSize: '13px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {t('group:group.dm', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
        </ButtonBase>

        {compactToggle && (
          <>
            <CustomButton
              onClick={() => {
                setOpenAddGroup(true);
              }}
              sx={{
                flex: '0 0 auto',
                flexDirection: 'column',
                fontSize: '11px',
                gap: '4px',
                minWidth: 'unset',
                padding: '8px 4px',
                width: '100%',
              }}
            >
              <AddCircleOutlineIcon
                sx={{ color: theme.palette.text.primary, fontSize: '20px' }}
              />
              {t('group:group.group', { postProcess: 'capitalizeFirstChar' })}
            </CustomButton>

            {!isRunningPublicNode && (
              <CustomButton
                onClick={() => {
                  setIsOpenBlockedUserModal(true);
                }}
                sx={{
                  flex: '0 0 auto',
                  minWidth: 'unset',
                  padding: '8px',
                  width: '100%',
                }}
              >
                <PersonOffIcon
                  sx={{ color: theme.palette.text.secondary, fontSize: '20px' }}
                />
              </CustomButton>
            )}
          </>
        )}
      </Box>

      <Box
        sx={{
          alignItems: 'flex-start',
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          left: chatMode === 'directs' && '-1000px',
          minHeight: 0,
          minWidth: compactToggle ? 0 : undefined,
          order: compactToggle ? 1 : 0,
          overflowY: 'auto',
          padding: '12px 8px',
          position: chatMode === 'directs' && 'fixed',
          visibility: chatMode === 'directs' && 'hidden',
          width: compactToggle ? 'auto' : '100%',
        }}
      >
        <List
          sx={{
            width: '100%',
            padding: 0,
          }}
          className="group-list"
          dense={false}
        >
          {groups.map((group: any, index: number) => (
            <GroupItem
              selectGroupFunc={selectGroupFunc}
              key={group.groupId}
              group={group}
              avatarPriority={rowAvatarPriority(index)}
              selectedGroupId={selectedGroup?.groupId ?? null}
              getUserSettings={getUserSettings}
              myAddress={myAddress}
              hasDraft={draftKeys.has(groupDraftKey(group.groupId))}
              reticulumChatEnabled={reticulumChatEnabled}
            />
          ))}
        </List>
      </Box>

      {!compactToggle && (
        <Box
          sx={{
            borderTop: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            gap: '10px',
            justifyContent: 'center',
            padding: '16px 12px',
            width: '100%',
          }}
        >
          <CustomButton
            onClick={() => {
              setOpenAddGroup(true);
            }}
            sx={{
              flex: 1,
              gap: '8px',
              padding: '10px 16px',
            }}
          >
            <AddCircleOutlineIcon
              sx={{
                color: theme.palette.text.primary,
                fontSize: '20px',
              }}
            />
            {t('group:group.group', { postProcess: 'capitalizeFirstChar' })}
          </CustomButton>

          {!isRunningPublicNode && (
            <CustomButton
              onClick={() => {
                setIsOpenBlockedUserModal(true);
              }}
              sx={{
                minWidth: 'unset',
                padding: '10px',
              }}
            >
              <PersonOffIcon
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '22px',
                }}
              />
            </CustomButton>
          )}
        </Box>
      )}
    </Box>
  );
};

GroupListInner.displayName = 'GroupList';

export const GroupList = memo(GroupListInner);

interface GroupItemProps {
  selectGroupFunc: (group: any) => void;
  group: any;
  dropPosition?: GroupDragInsertionPosition;
  selectedGroupId: string | null;
  getUserSettings: () => Promise<any>;
  myAddress: string;
  hasDraft?: boolean;
  reticulumChatEnabled?: boolean;
  railMode?: boolean;
  isPinned?: boolean;
  canReorderPins?: boolean;
  pinDragEnabled?: boolean;
  onRequestPinReorder?: () => void;
  /** 'low' for rows far down the list, so rows on screen load first. */
  avatarPriority?: QdnAvatarPriority;
}

const GroupItem = memo(
  ({
    selectGroupFunc,
    group,
    dropPosition,
    selectedGroupId,
    getUserSettings,
    myAddress,
    hasDraft,
    reticulumChatEnabled = false,
    railMode = false,
    isPinned = false,
    canReorderPins = false,
    pinDragEnabled = false,
    onRequestPinReorder,
    avatarPriority = 'normal',
  }: GroupItemProps) => {
    const theme = useTheme();
    const { t } = useTranslation(['core', 'group', 'reticulum']);
    const {
      attributes,
      listeners,
      setNodeRef,
      isDragging,
      transform,
      transition,
    } = useSortable({
      id: String(group?.groupId),
      disabled: !railMode && !pinDragEnabled,
    });
    const ownerName = useAtomValue(groupsOwnerNamesSelector(group?.groupId));
    const announcement = useAtomValue(
      groupAnnouncementSelector(group?.groupId)
    );
    const groupProperty = useAtomValue(groupPropertySelector(group?.groupId));
    const groupChatTimestamp = useAtomValue(
      groupChatTimestampSelector(group?.groupId)
    );
    const timestampEnterData = useAtomValue(
      timestampEnterDataSelector(group?.groupId)
    );
    const meshCallActiveByGroup = useAtomValue(qortalGroupMeshCallActiveAtom);
    const meshCallParticipantCountByGroup = useAtomValue(
      qortalGroupMeshCallParticipantCountAtom
    );
    const meshCallMaxParticipantsByGroup = useAtomValue(
      qortalGroupMeshCallMaxParticipantsAtom
    );
    const selfGcallRoomId = useAtomValue(qortalGroupSelfGcallRoomIdAtom);
    const [isGroupTooltipOpen, setIsGroupTooltipOpen] = useState(false);
    const [isGroupContextMenuOpen, setIsGroupContextMenuOpen] = useState(false);
    // Cached on the device, so it shows at once also on a slow node.
    const {
      src: avatarSrc,
      isLoaded: isAvatarLoaded,
      imgProps: avatarImgProps,
      previewOpen: isPreviewOpen,
      previewSrc,
      openPreview: openAvatarPreview,
      closePreview: handleClosePreview,
    } = useGroupRowAvatar(ownerName, group?.groupId, {
      priority: avatarPriority,
    });

    useEffect(() => {
      if (railMode) prefetchReticulumGroupAboutMetadata(group);
    }, [group, railMode]);

    const selectGroupHandler = useCallback(() => {
      selectGroupFunc(group);
    }, [group, selectGroupFunc]);

    const stopEvent = useCallback((event) => {
      event.stopPropagation();
      if (event.nativeEvent?.stopImmediatePropagation) {
        event.nativeEvent.stopImmediatePropagation();
      }
    }, []);

    const handleAvatarClick = useCallback(
      (event) => {
        // Cached copy at once, the full-size image once the node sends it.
        if (!openAvatarPreview()) return;
        event.preventDefault();
        stopEvent(event);
      },
      [openAvatarPreview, stopEvent]
    );

    // Holding the pin itself is what unlocks reordering, so a stray tap on the
    // row still just opens the group.
    const pinHoldTimer = useRef<number | null>(null);
    // Set once a hold has switched to reordering, so the click that follows
    // the release is swallowed; a short tap opens the group like the row.
    const pinHoldFired = useRef(false);
    // Where the hold started: a finger that wanders off (a swipe to the DM
    // list that starts on the pin) is not a hold.
    const pinHoldOrigin = useRef<{ x: number; y: number } | null>(null);
    const cancelPinHold = useCallback(() => {
      pinHoldOrigin.current = null;
      if (pinHoldTimer.current !== null) {
        clearTimeout(pinHoldTimer.current);
        pinHoldTimer.current = null;
      }
    }, []);
    const startPinHold = useCallback(() => {
      if (!canReorderPins || pinDragEnabled) return;
      cancelPinHold();
      pinHoldTimer.current = window.setTimeout(() => {
        pinHoldTimer.current = null;
        pinHoldFired.current = true;
        onRequestPinReorder?.();
      }, 450);
    }, [cancelPinHold, canReorderPins, onRequestPinReorder, pinDragEnabled]);
    useEffect(() => cancelPinHold, [cancelPinHold]);

    const isSelected = group?.groupId === selectedGroupId;
    const reticulumUnreadCount = Math.max(
      0,
      Number(group?.reticulumChatSummary?.unreadCount || 0)
    );
    const reticulumReplyCount = Math.max(
      0,
      Number(group?.reticulumChatSummary?.replyCount || 0)
    );
    const hasReticulumUnread = reticulumUnreadCount > 0;
    const hasReticulumMention =
      group?.reticulumChatSummary?.hasUnreadMention === true ||
      (group?.reticulumChatSummary?.mentionCount ?? 0) > 0;
    const hasUnreadIndicator = Boolean(
      hasReticulumUnread ||
      (!reticulumChatEnabled &&
        group?.data &&
        groupChatTimestamp &&
        group?.sender !== myAddress &&
        group?.timestamp &&
        ((!timestampEnterData &&
          Date.now() - group?.timestamp < timeDifferenceForNotificationChats) ||
          timestampEnterData < group?.timestamp))
    );

    const gcallRoomIdForRow =
      group?.groupId &&
      group.groupId !== '0' &&
      Number.isFinite(Number(group.groupId))
        ? `gcall-qortal-${Number(group.groupId)}`
        : null;
    const imInThisGroupGcall =
      Boolean(gcallRoomIdForRow) && selfGcallRoomId === gcallRoomIdForRow;
    const meshShowsCall = meshCallActiveForMemberGroup(
      meshCallActiveByGroup,
      group?.groupId
    );
    const meshCallParticipantCount = meshCallParticipantCountForMemberGroup(
      meshCallParticipantCountByGroup,
      group?.groupId
    );
    const meshCallMaxParticipants = meshCallMaxParticipantsForMemberGroup(
      meshCallMaxParticipantsByGroup,
      group?.groupId
    );
    const showGroupCallIndicator =
      Boolean(gcallRoomIdForRow) && (imInThisGroupGcall || meshShowsCall);
    const isClosedGroup =
      groupProperty?.isOpen === false ||
      group?.isOpen === false ||
      Number(group?.groupType) === 1 ||
      group?.groupType === 'CLOSED';
    const isOpenGroup = !isClosedGroup;

    if (railMode) {
      const groupLabel =
        group.groupId === '0' ? 'General' : group.groupName || 'Group';
      const fallbackAvatarBackground =
        theme.palette.mode === 'dark'
          ? 'rgba(7, 10, 17, 0.82)'
          : 'rgba(49, 58, 72, 0.88)';
      const avatarNode = ownerName ? (
        <Avatar
          sx={{
            backgroundColor: isAvatarLoaded
              ? 'transparent'
              : fallbackAvatarBackground,
            boxShadow: isAvatarLoaded
              ? 'none'
              : 'inset 0 0 0 1px rgba(255, 255, 255, 0.1)',
            boxSizing: 'border-box',
            color: theme.palette.common.white,
            display: 'flex',
            fontWeight: 800,
            height: 38,
            m: 'auto',
            width: 38,
            zIndex: 1,
            '& .MuiAvatar-img': {
              height: '100%',
              width: '100%',
            },
          }}
          alt={group?.groupName?.charAt(0)}
          src={avatarSrc}
          imgProps={avatarImgProps}
        >
          {group?.groupName?.charAt(0).toUpperCase()}
        </Avatar>
      ) : (
        <Avatar
          alt={group?.groupName?.charAt(0)}
          sx={{
            backgroundColor: fallbackAvatarBackground,
            boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.1)',
            boxSizing: 'border-box',
            color: theme.palette.common.white,
            display: 'flex',
            fontWeight: 800,
            height: 38,
            m: 'auto',
            width: 38,
            zIndex: 1,
          }}
        >
          {group?.groupName?.charAt(0).toUpperCase() || 'G'}
        </Avatar>
      );

      return (
        <Tooltip
          disableFocusListener
          disableHoverListener
          disableTouchListener
          open={isGroupTooltipOpen && !isGroupContextMenuOpen && !isDragging}
          placement="right"
          title={
            <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.65 }}>
              {isOpenGroup ? (
                <PublicRoundedIcon
                  sx={{
                    color:
                      theme.palette.mode === 'dark' ? '#a9c9ff' : '#315d97',
                    fontSize: 15,
                  }}
                />
              ) : (
                <LockIcon
                  sx={{
                    color:
                      theme.palette.mode === 'dark' ? '#f1a0a8' : '#933642',
                    fontSize: 14,
                  }}
                />
              )}
              <Typography
                sx={{ color: 'inherit', fontSize: 12, fontWeight: 600 }}
              >
                {groupLabel}
              </Typography>
            </Box>
          }
          slotProps={{
            tooltip: {
              sx: {
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? isOpenGroup
                      ? 'rgba(27, 58, 112, 0.92)'
                      : 'rgba(79, 27, 34, 0.94)'
                    : theme.palette.background.paper,
                border: `1px solid ${
                  theme.palette.mode === 'dark'
                    ? isOpenGroup
                      ? 'rgba(107, 164, 255, 0.34)'
                      : 'rgba(243, 126, 136, 0.3)'
                    : isOpenGroup
                      ? 'rgba(49, 93, 151, 0.3)'
                      : 'rgba(147, 54, 66, 0.3)'
                }`,
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? '0 8px 18px rgba(0, 0, 0, 0.3)'
                    : '0 8px 18px rgba(20, 28, 42, 0.18)',
                color:
                  theme.palette.mode === 'dark'
                    ? isOpenGroup
                      ? '#d7e6ff'
                      : '#ffd8dc'
                    : isOpenGroup
                      ? '#244f83'
                      : '#822b37',
                px: 0.85,
                py: 0.6,
              },
            },
          }}
        >
          <ListItem
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            onClick={() => {
              setIsGroupTooltipOpen(false);
              selectGroupHandler();
            }}
            onContextMenuCapture={() => setIsGroupTooltipOpen(false)}
            onMouseEnter={() => setIsGroupTooltipOpen(true)}
            onMouseLeave={() => setIsGroupTooltipOpen(false)}
            onPointerDownCapture={() => setIsGroupTooltipOpen(false)}
            sx={{
              alignItems: 'center',
              backgroundColor: isSelected
                ? RETICULUM_ACTIVE_BLUE
                : 'transparent',
              borderRadius: '8px',
              boxSizing: 'border-box',
              cursor: 'pointer',
              display: 'grid',
              flexShrink: 0,
              height: 52,
              justifyContent: 'center',
              minHeight: 52,
              placeItems: 'center',
              mb: 0,
              opacity: isDragging ? 0.58 : 1,
              overflow: 'visible',
              p: 0,
              position: 'relative',
              width: 52,
              zIndex: isDragging ? 4 : 'auto',
              '&:hover': {
                backgroundColor: isSelected
                  ? RETICULUM_ACTIVE_BLUE
                  : theme.palette.action.hover,
              },
            }}
          >
            {dropPosition && <GroupDropIndicator position={dropPosition} />}
            <ContextMenu
              getUserSettings={getUserSettings}
              groupId={group.groupId}
              myAddress={myAddress}
              onMenuOpenChange={setIsGroupContextMenuOpen}
              reticulumGroup={group}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  height: '100%',
                  justifyContent: 'center',
                  left: 0,
                  margin: 'auto',
                  overflow: 'visible',
                  position: 'relative',
                  right: 0,
                  width: '100%',
                }}
              >
                {avatarNode}

                {hasUnreadIndicator && (
                  <ReticulumUnreadCountBadge
                    color={
                      hasReticulumMention
                        ? RETICULUM_NOTIFICATION_RED
                        : theme.palette.primary.main
                    }
                    count={reticulumReplyCount > 0 ? reticulumReplyCount : null}
                    outlineColor={theme.palette.background.surface}
                    size={reticulumReplyCount > 0 ? 18 : 8}
                    sx={{
                      bottom: reticulumReplyCount > 0 ? -2 : 1,
                      position: 'absolute',
                      right: reticulumReplyCount > 0 ? -2 : 1,
                      zIndex: 2,
                    }}
                  />
                )}

                {hasReticulumMention && (
                  <AlternateEmailIcon
                    sx={{
                      backgroundColor: theme.palette.background.surface,
                      borderRadius: '50%',
                      color: RETICULUM_NOTIFICATION_RED,
                      fontSize: 16,
                      position: 'absolute',
                      right: 0,
                      top: 0,
                      zIndex: 2,
                    }}
                  />
                )}

                {!reticulumChatEnabled &&
                  announcement &&
                  !announcement?.seentimestamp && (
                    <CampaignIcon
                      sx={{
                        backgroundColor: theme.palette.background.surface,
                        borderRadius: '50%',
                        color: theme.palette.other.unread,
                        fontSize: 16,
                        left: 0,
                        position: 'absolute',
                        top: 0,
                        zIndex: 2,
                      }}
                    />
                  )}

                {showGroupCallIndicator && (
                  <Tooltip
                    title={
                      imInThisGroupGcall
                        ? t('core:group_list_call_youre_in', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : t('core:group_list_call_active', {
                            postProcess: 'capitalizeFirstChar',
                          })
                    }
                    placement="right"
                  >
                    <ButtonBase
                      aria-label={
                        imInThisGroupGcall
                          ? t('core:group_list_call_youre_in', {
                              postProcess: 'capitalizeFirstChar',
                            })
                          : t('core:group_list_call_active', {
                              postProcess: 'capitalizeFirstChar',
                            })
                      }
                      onClick={(event) => {
                        stopEvent(event);
                        selectGroupHandler();
                      }}
                      onPointerEnter={() => setIsGroupTooltipOpen(false)}
                      sx={{
                        alignItems: 'center',
                        backgroundColor: RETICULUM_CALL_GREEN,
                        border: `3px solid ${theme.palette.background.surface}`,
                        borderRadius: '50%',
                        bottom: -5,
                        boxShadow: '0 2px 5px rgba(0,0,0,0.34)',
                        color: theme.palette.common.white,
                        display: 'flex',
                        height: 23,
                        justifyContent: 'center',
                        left: -4,
                        position: 'absolute',
                        transition:
                          'background-color 120ms ease, transform 120ms ease',
                        width: 23,
                        zIndex: 3,
                        '&:hover': {
                          backgroundColor: '#32d468',
                          transform: 'scale(1.08)',
                        },
                      }}
                    >
                      <PhoneIcon sx={{ fontSize: 14 }} />
                    </ButtonBase>
                  </Tooltip>
                )}
              </Box>
            </ContextMenu>

            <AvatarPreviewModal
              open={isPreviewOpen}
              src={previewSrc}
              alt={group?.groupName}
              onClose={handleClosePreview}
            />
          </ListItem>
        </Tooltip>
      );
    }

    return (
      <ListItem
        ref={pinDragEnabled ? setNodeRef : undefined}
        {...(pinDragEnabled ? attributes : {})}
        {...(pinDragEnabled ? listeners : {})}
        // A row being dragged to reorder never swipes to the DM list.
        data-pager-swipe-ignore={pinDragEnabled ? '' : undefined}
        onClick={pinDragEnabled ? undefined : selectGroupHandler}
        style={
          pinDragEnabled
            ? {
                transform: transform
                  ? `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${
                      isDragging ? 1.03 : 1
                    })`
                  : undefined,
                transition,
              }
            : undefined
        }
        sx={[
          getChatListRowSx(theme, { selected: isSelected }),
          {
            cursor: pinDragEnabled ? 'grab' : 'pointer',
            touchAction: pinDragEnabled ? 'none' : undefined,
            boxShadow: isDragging
              ? `0 10px 26px ${alpha('#000', 0.45)}`
              : undefined,
            opacity: isDragging ? 0.92 : 1,
            zIndex: isDragging ? 4 : undefined,
          },
        ]}
      >
        <ContextMenu
          disabled={pinDragEnabled}
          getUserSettings={getUserSettings}
          groupId={group.groupId}
          myAddress={myAddress}
          onMenuOpenChange={setIsGroupContextMenuOpen}
          reticulumGroup={reticulumChatEnabled ? group : null}
        >
          <Box sx={chatListRowContentSx}>
            <ListItemAvatar sx={chatListAvatarSlotSx}>
              {ownerName ? (
                <Avatar
                  sx={{
                    height: CHAT_LIST_AVATAR_SIZE,
                    width: CHAT_LIST_AVATAR_SIZE,
                    ...(isAvatarLoaded
                      ? {}
                      : getChatListAvatarFallbackSx(theme)),
                    ...getClickableAvatarSx(theme, isAvatarLoaded),
                  }}
                  alt={group?.groupName?.charAt(0)}
                  src={avatarSrc}
                  onClick={handleAvatarClick}
                  onMouseDown={(event) => {
                    if (isAvatarLoaded) {
                      stopEvent(event);
                    }
                  }}
                  onTouchStart={(event) => {
                    if (isAvatarLoaded) {
                      stopEvent(event);
                    }
                  }}
                  imgProps={avatarImgProps}
                >
                  {group?.groupName?.charAt(0).toUpperCase()}
                </Avatar>
              ) : (
                <Avatar
                  alt={group?.groupName?.charAt(0)}
                  sx={{
                    height: CHAT_LIST_AVATAR_SIZE,
                    width: CHAT_LIST_AVATAR_SIZE,
                    ...getChatListAvatarFallbackSx(theme),
                  }}
                >
                  {group?.groupName?.charAt(0).toUpperCase() || 'G'}
                </Avatar>
              )}
            </ListItemAvatar>

            <ListItemText
              primary={
                <Box
                  component="span"
                  sx={{
                    alignItems: 'flex-start',
                    display: 'flex',
                    gap: '6px',
                    minWidth: 0,
                    width: '100%',
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {group.groupId === '0'
                      ? t('group:groups_widget.group_general')
                      : group.groupName}
                  </Box>
                  {hasDraft && <DraftBadge />}
                </Box>
              }
              secondary={
                !group?.timestamp
                  ? t('core:message.generic.no_messages', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('group:last_message_date', {
                      date: formatEmailDate(group?.timestamp),
                    })
              }
              primaryTypographyProps={{
                component: 'div',
                sx: getChatListTitleSx(theme, hasUnreadIndicator),
              }}
              secondaryTypographyProps={{
                sx: getChatListSubtitleSx(theme),
              }}
              sx={chatListTextSx}
            />

            {!reticulumChatEnabled &&
              announcement &&
              !announcement?.seentimestamp && (
                <CampaignIcon
                  sx={{
                    color: theme.palette.other.unread,
                    fontSize: '20px',
                    flexShrink: 0,
                  }}
                />
              )}

            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                flexShrink: 0,
                justifyContent: 'center',
                marginLeft: '4px',
              }}
            >
              {hasUnreadIndicator && (
                <MarkChatUnreadIcon
                  sx={{
                    // Mentions keep the red; ordinary unread traffic matches
                    // the accent dot on the Chat tab.
                    color: hasReticulumMention
                      ? RETICULUM_NOTIFICATION_RED
                      : hasReticulumUnread
                        ? theme.palette.primary.main
                        : theme.palette.other.unread,
                    fontSize: '18px',
                  }}
                />
              )}

              {hasReticulumMention && (
                <AlternateEmailIcon
                  sx={{
                    color: RETICULUM_NOTIFICATION_RED,
                    fontSize: '18px',
                  }}
                />
              )}

              {groupProperty?.isOpen === false && (
                <LockIcon
                  sx={{
                    color: theme.palette.other.positive,
                    fontSize: '18px',
                  }}
                />
              )}

              {showGroupCallIndicator && (
                <Box
                  sx={{
                    alignItems: 'center',
                    color: RETICULUM_CALL_GREEN,
                    display: 'flex',
                    gap: '3px',
                    flexShrink: 0,
                  }}
                  title={
                    imInThisGroupGcall
                      ? t('core:group_list_call_youre_in', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : t('core:group_list_call_active', {
                          postProcess: 'capitalizeFirstChar',
                        })
                  }
                >
                  <PhoneIcon
                    sx={{
                      color: 'inherit',
                      fontSize: '18px',
                      flexShrink: 0,
                    }}
                  />
                  {meshCallParticipantCount !== null && (
                    <Typography
                      component="span"
                      sx={{
                        color: 'inherit',
                        fontFamily: 'Inter',
                        fontSize: '11px',
                        fontWeight: 700,
                        lineHeight: 1,
                        minWidth: '7px',
                      }}
                    >
                      {meshCallParticipantCount}
                      {meshCallMaxParticipants !== null
                        ? `/${meshCallMaxParticipants}`
                        : ''}
                    </Typography>
                  )}
                </Box>
              )}
            </Box>

            {/* The pin owns a fixed slot at the row edge, past the badge
                column, so pins line up no matter how long the group name is
                or which badges a row happens to show. */}
            {isPinned && (
              <Tooltip
                title={
                  canReorderPins
                    ? t('reticulum:group_list.pin_hold_hint')
                    : t('reticulum:group_list.pinned')
                }
              >
                <Box
                  component="span"
                  aria-label={
                    canReorderPins
                      ? t('reticulum:group_list.pin_hold_hint')
                      : t('reticulum:group_list.pinned')
                  }
                  data-testid="group-row-pin"
                  role="img"
                  onClick={(event) => {
                    // Only the click that ends a reorder hold is swallowed.
                    if (!pinHoldFired.current) return;
                    pinHoldFired.current = false;
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onContextMenu={(event) => {
                    if (!canReorderPins) return;
                    event.preventDefault();
                    event.stopPropagation();
                    cancelPinHold();
                    if (pinDragEnabled) return;
                    // Android may fire its own contextmenu before the hold
                    // timer: the click after the release is swallowed too.
                    pinHoldFired.current = true;
                    onRequestPinReorder?.();
                  }}
                  onPointerDown={(event) => {
                    // In reorder mode the pin is a drag handle like the rest
                    // of the row, so the press must reach the sortable row.
                    if (pinDragEnabled) return;
                    pinHoldFired.current = false;
                    event.stopPropagation();
                    startPinHold();
                    pinHoldOrigin.current = Number.isFinite(event.clientX)
                      ? { x: event.clientX, y: event.clientY }
                      : null;
                  }}
                  onPointerMove={(event) => {
                    const origin = pinHoldOrigin.current;
                    if (!origin || pinHoldTimer.current === null) return;
                    if (
                      Math.abs(event.clientX - origin.x) > PIN_HOLD_SLOP_PX ||
                      Math.abs(event.clientY - origin.y) > PIN_HOLD_SLOP_PX
                    ) {
                      cancelPinHold();
                    }
                  }}
                  onTouchStart={(event) => {
                    // A hold on the pin reorders; it must not also open the
                    // row's long-press menu. Known limit: the touch then does
                    // not reach Group.tsx either, so a swipe to close the
                    // swiped-in list cannot start on a reorderable pin.
                    // ContextMenu has no way yet to skip one touch.
                    if (canReorderPins && !pinDragEnabled) {
                      event.stopPropagation();
                    }
                  }}
                  onPointerUp={cancelPinHold}
                  onPointerLeave={cancelPinHold}
                  onPointerCancel={cancelPinHold}
                  sx={{
                    ...chatListRowEdgeActionSx,
                    // A swipe that starts on the pin still scrolls the list
                    // (the browser cancels the hold when it takes over), or
                    // goes sideways like one on the rest of the row.
                    touchAction: 'pan-x pan-y',
                  }}
                >
                  <PushPinRoundedIcon
                    sx={{
                      color: pinDragEnabled
                        ? theme.palette.primary.main
                        : theme.palette.text.secondary,
                      fontSize: 18,
                      transform: 'rotate(35deg)',
                      transition: 'color 140ms ease',
                    }}
                  />
                </Box>
              </Tooltip>
            )}
          </Box>
        </ContextMenu>

        <AvatarPreviewModal
          open={isPreviewOpen}
          src={previewSrc}
          alt={group?.groupName}
          onClose={handleClosePreview}
        />
      </ListItem>
    );
  }
);
