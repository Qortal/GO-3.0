import {
  memo,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useInView } from 'react-intersection-observer';
import {
  MessageDisplay,
  type ReticulumChannelLinkAccess,
} from './MessageDisplay';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  ClickAwayListener,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Popper,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { formatTimestamp } from '../../utils/time';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import { generateHTML } from '@tiptap/react';
import Highlight from '@tiptap/extension-highlight';
import Mention from '@tiptap/extension-mention';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { WrapperUserAction } from '../WrapperUserAction';
import ReplyIcon from '@mui/icons-material/Reply';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import { ReactionPicker } from '../ReactionPicker';
import KeyOffIcon from '@mui/icons-material/KeyOff';
import EditIcon from '@mui/icons-material/Edit';
import { canEditOwnReticulumMessage } from './reticulumMessagePermissions';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import SaveAltRoundedIcon from '@mui/icons-material/SaveAltRounded';
import { getQchatFileApi } from '../../utils/qchatFileApi';
import { openFileViewer } from '../../utils/fileViewerEvents';
import { cleanFileName } from '../../utils/receivedFileName';
import { FileNameWithExtension } from './FileNameWithExtension';
import { useReceivedQchatFile } from './useReceivedQchatFile';
import { isPrivateReceivedChatFile } from '../../utils/receivedChatFiles';
import { Capacitor } from '@capacitor/core';
import {
  buildQdnAvatarUrl,
  qdnGroupAvatarIdentifier,
  QDN_AVATAR_DEFAULT_IDENTIFIER,
} from '../../lib/qdnAvatars';
import { useQdnAvatarSrc } from '../../hooks/useQdnAvatarSrc';
import { useAvatarPreviewSrc } from './useAvatarPreviewSrc';
import CancelRoundedIcon from '@mui/icons-material/CancelRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import TextStyle from '@tiptap/extension-text-style';
import messageExpiresIcon from '../../assets/Icons/message-expires-icon.png';
import noExpiryIcon from '../../assets/Icons/no-expiry-icon.png';
import level0Img from '../../assets/badges/level-0.png';
import level1Img from '../../assets/badges/level-1.png';
import level2Img from '../../assets/badges/level-2.png';
import level3Img from '../../assets/badges/level-3.png';
import level4Img from '../../assets/badges/level-4.png';
import level5Img from '../../assets/badges/level-5.png';
import level6Img from '../../assets/badges/level-6.png';
import level7Img from '../../assets/badges/level-7.png';
import level8Img from '../../assets/badges/level-8.png';
import level9Img from '../../assets/badges/level-9.png';
import level10Img from '../../assets/badges/level-10.png';
import { Embed } from '../Embeds/Embed';
import CommentsDisabledIcon from '@mui/icons-material/CommentsDisabled';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import {
  buildImageEmbedLink,
  isHtmlString,
  messageHasImage,
} from '../../utils/chat';
import { isLibraryGifImage } from './gifs/libraryGifs';
import { GifImage } from './gifs/GifImage';
import { useTranslation } from 'react-i18next';
import { ReactionsMap } from './ChatList';
import { AvatarPreviewModal } from '../Chat/AvatarPreviewModal';
import { useStatus } from '../../hooks/usePresence';
import { useLongPress } from '../../hooks/useLongPress';
import {
  getClickableAvatarSx,
  getFallbackAvatarOutlineSx,
} from './clickableAvatarStyles';
import { PresenceStatusBadge } from '../common/PresenceStatusBadge';
import { hasInvisibleCharacters } from '../../utils/hasInvisibleCharacters';
import { MinterAvatarOrnament } from './MinterAvatarOrnament';
import { ReticulumImageViewer } from './ReticulumImageViewer';
import { ReticulumGroupInvitePreviews } from './ReticulumGroupInvitePreview';
import {
  parseReticulumQAppLinks,
  ReticulumQAppLinkPreviews,
} from './ReticulumQAppLinkPreview';
import {
  parseReticulumEventLinks,
  ReticulumEventLinkPreviews,
} from './ReticulumEventLinkPreview';
import { CustomStyledMenu } from '../ContextMenu';
import FormatQuoteRoundedIcon from '@mui/icons-material/FormatQuoteRounded';
import { ReticulumRoleBadge } from './ReticulumRoleBadge';
import { createReticulumImageRequestGate } from './reticulumImageRequestGate';
import { ReticulumDmDeliveryGlyph } from './ReticulumDmDeliveryGlyph';
import { hasReticulumDmDeliveryState } from './reticulumDmDeliveryState';
import {
  DESKTOP_MESSAGE_ACTION_SIZES,
  getMessageActionSizes,
  PHONE_AVATAR_HIT_SLOP_BOTTOM_PX,
  PHONE_AVATAR_HIT_SLOP_TOP_PX,
  PHONE_AVATAR_HIT_SLOP_X_PX,
  PHONE_MESSAGE_AVATAR_PX,
  PHONE_MESSAGE_BUTTON_MIN_HEIGHT_PX,
  PHONE_RETRY_PILL_MIN_HEIGHT_PX,
} from './messageActionSizes';
import {
  MessageActionsDetailRow,
  MessageActionsPopup,
  type MessageActionsPopupAction,
} from './MessageActionsPopup';
import { ReactionChip } from './ReactionChip';
import {
  ChatMediaGalleryContext,
  findChatMediaIndex,
  type ChatMediaItem,
} from './chatMediaGallery';
import { requestLibraryGifUrl } from './gifs/gifMediaCache';
import { rememberRecentReaction } from './reactionEmojiData';
import { requestReactionLanding } from './reactionLanding';
import {
  getDoubleTapReaction,
  readReactionPrefs,
  recordReactionUse,
} from './reactionPreferences';
import { executeEvent } from '../../utils/events';
import { useAtomValue } from 'jotai';
import {
  reticulumChatTextScaleAtom,
  reticulumHighlightOwnMessagesAtom,
} from '../../atoms/global';
import {
  qchatMetaTextSize,
  qchatTextSize,
  reticulumChatTextScaleClassName,
} from './reticulumChatTextScale';

const QCHAT_FILE_TRANSFER_TTL_MS = 2 * 60 * 60 * 1000;
const RETICULUM_FILE_DOWNLOAD_STALL_MS = 2 * 60 * 1000;
const RETICULUM_FILE_UNAVAILABLE_TIMEOUT_MS = 12_000;
const RETICULUM_EXPIRING_SOON_MS = 15 * 60 * 60 * 1000;
const RETICULUM_INLINE_IMAGE_THRESHOLD_BYTES = 1_000_000;
const RETICULUM_IMAGE_REQUEST_BACKOFF_MS = 30_000;
const RETICULUM_IMAGE_UNAVAILABLE_TIMEOUT_MS = 12_000;
const RETICULUM_IMAGE_AVAILABILITY_RECHECK_MS = 15_000;
const RETICULUM_IMAGE_REQUEST_TRACK_LIMIT = 500;
const RETICULUM_INLINE_IMAGE_MAX_WIDTH = 640;
const RETICULUM_INLINE_IMAGE_MAX_HEIGHT = 360;
const RETICULUM_INLINE_IMAGE_FALLBACK_WIDTH = 480;
const RETICULUM_INLINE_IMAGE_FALLBACK_ASPECT_RATIO = '4 / 3';

const normalizeReticulumExpiryMs = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
};

const formatReticulumExpiry = (value: number | null): string => {
  if (!value) return 'No Expiry';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No Expiry';
  const pad = (part: number) => String(part).padStart(2, '0');
  const monthAndDay = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  return `${monthAndDay} | ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
// React passes events from a portal up the component tree, so a tap on the
// user card, its invisible backdrop or a reaction list drawn for this message
// reaches the row too. Only taps on the row's own page content count.
const isEventFromRowItself = (event: {
  currentTarget: EventTarget;
  target: EventTarget;
}): boolean =>
  event.currentTarget instanceof Node &&
  event.target instanceof Node &&
  event.currentTarget.contains(event.target);
// Full date and time in the reader's locale, for the long-press details.
const formatMessageDetailMoment = (value: unknown): string => {
  const ms = normalizeReticulumExpiryMs(value);
  if (!ms) return '';
  const date = new Date(ms);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
};
const RETICULUM_QUICK_REACTIONS = ['👍', '💯', '😂', '❤️'] as const;
/**
 * A second tap this soon (and this close) is a double tap: it reacts with
 * the chat's double-tap emoji. A single tap waits this long for its popup.
 */
export const DOUBLE_TAP_WINDOW_MS = 280;
const DOUBLE_TAP_SLOP_PX = 36;
/** The emoji that pops up under the finger on a double tap, in px. */
const DOUBLE_TAP_EMOJI_PX = 40;

const reticulumImageRequestGate = createReticulumImageRequestGate(
  RETICULUM_IMAGE_REQUEST_BACKOFF_MS,
  RETICULUM_IMAGE_REQUEST_TRACK_LIMIT
);
const reticulumMintershipCache = new Map<string, boolean>();
const reticulumMintershipRequests = new Map<string, Promise<boolean>>();

function getReticulumInlineImageDisplaySize(
  width: number | null,
  height: number | null
): { width: number; height: number; aspectRatio: string } {
  if (!width || !height) {
    return {
      width: RETICULUM_INLINE_IMAGE_FALLBACK_WIDTH,
      height: Math.round(RETICULUM_INLINE_IMAGE_FALLBACK_WIDTH * 0.75),
      aspectRatio: RETICULUM_INLINE_IMAGE_FALLBACK_ASPECT_RATIO,
    };
  }

  const scale = Math.min(
    1,
    RETICULUM_INLINE_IMAGE_MAX_WIDTH / width,
    RETICULUM_INLINE_IMAGE_MAX_HEIGHT / height
  );
  const displayWidth = Math.max(1, Math.round(width * scale));
  const displayHeight = Math.max(1, Math.round(height * scale));
  return {
    width: displayWidth,
    height: displayHeight,
    aspectRatio: `${displayWidth} / ${displayHeight}`,
  };
}

const getReticulumMintership = (address: string): Promise<boolean> => {
  const normalizedAddress = address.trim();
  if (!normalizedAddress) return Promise.resolve(false);

  const cachedResult = reticulumMintershipCache.get(normalizedAddress);
  if (cachedResult !== undefined) return Promise.resolve(cachedResult);

  const existingRequest = reticulumMintershipRequests.get(normalizedAddress);
  if (existingRequest) return existingRequest;

  const request = fetch(
    `${getBaseApiReact()}/groups/member/${encodeURIComponent(normalizedAddress)}`
  )
    .then(async (response) => {
      if (!response.ok) return false;
      const data = await response.json();
      const groups = Array.isArray(data) ? data : (data?.groups ?? []);
      return groups.some(
        (group) =>
          String(group?.groupName ?? '')
            .trim()
            .toUpperCase() === 'MINTER'
      );
    })
    .catch(() => false)
    .then((isMinter) => {
      reticulumMintershipCache.set(normalizedAddress, isMinter);
      return isMinter;
    })
    .finally(() => {
      reticulumMintershipRequests.delete(normalizedAddress);
    });

  reticulumMintershipRequests.set(normalizedAddress, request);
  return request;
};

// Block boundaries have to survive as line breaks, otherwise a copied multi
// paragraph message comes back as one run-on line.
const messageHtmlToPlainText = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const normalizeMessageHtmlContent = (raw: unknown): string | null => {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof raw === 'object') {
    try {
      const doc = raw as { type?: string; content?: unknown };
      if (doc.type === 'doc' && Array.isArray(doc.content)) {
        return generateHTML(doc, [
          StarterKit,
          Underline,
          Highlight,
          Mention,
          TextStyle,
        ]);
      }
    } catch {
      return null;
    }
  }
  return null;
};

const formatQchatFileSize = (bytes?: number) => {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 bytes';
  if (size < 1024) return `${size} ${size === 1 ? 'byte' : 'bytes'}`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.ceil(size / 1024))} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const formatQchatFileSpeed = (bytesPerSecond?: number) => {
  const speed = Number(bytesPerSecond || 0);
  if (!Number.isFinite(speed) || speed <= 0) return '';
  return `${formatQchatFileSize(speed)}/s`;
};

const getBadgeImg = (level) => {
  switch (level?.toString()) {
    case '0':
      return level0Img;
    case '1':
      return level1Img;
    case '2':
      return level2Img;
    case '3':
      return level3Img;
    case '4':
      return level4Img;
    case '5':
      return level5Img;
    case '6':
      return level6Img;
    case '7':
      return level7Img;
    case '8':
      return level8Img;
    case '9':
      return level9Img;
    case '10':
      return level10Img;
    default:
      return level0Img;
  }
};

const UserBadge = memo(({ userInfo }) => {
  return (
    <Tooltip disableFocusListener title={`level ${userInfo ?? 0}`}>
      <img
        style={{
          visibility: userInfo !== undefined ? 'visible' : 'hidden',
          width: '30px',
          height: 'auto',
        }}
        src={getBadgeImg(userInfo)}
      />
    </Tooltip>
  );
});

const getQchatFileTransfer = (message: any) => {
  if (message?.decryptedData?.type === 'qchat-dm-file-transfer') {
    return {
      ...(message.decryptedData || {}),
      data: message.decryptedData.data || {},
    };
  }
  if (message?.decryptedData?.data?.type === 'qchat-dm-file-transfer') {
    return {
      ...(message.decryptedData.data || {}),
      data: message.decryptedData.data.data || {},
    };
  }
  if (message?.type === 'qchat-dm-file-transfer') {
    return {
      ...message,
      data: message.data || {},
    };
  }
  return null;
};

type MessageItemProps = {
  handleReaction: (
    reaction: string,
    chatMessage: any,
    reactionState?: boolean
  ) => void;
  isLast: boolean;
  isGroupedWithPrevious?: boolean;
  isPrivate: boolean;
  isScrollTarget?: boolean;
  isShowingAsReply?: boolean;
  isTemp: boolean;
  isUpdating: boolean;
  lastSignature: string;
  message: string;
  myAddress: string;
  onEdit: (messageId: string) => void;
  onDelete?: (message: any) => void;
  onReply: (messageId: string) => void;
  onAcceptQchatFileTransfer?: (message: any) => void;
  qchatFileTransferStates?: Record<string, any>;
  qchatCompletedTransfers?: Record<string, any>;
  selectedGroup?: any;
  secretKeyObject?: any;
  onSeen: () => void;
  reactions: ReactionsMap | null;
  reply: string | null;
  replyIndex: number;
  replyExpiredMeta?: any;
  reticulumChatEnabled?: boolean;
  reticulumDiscussionReplyCount?: number;
  onOpenReticulumDiscussion?: (message: any) => void;
  reticulumDiscussionRootId?: string;
  reticulumDiscussionView?: boolean;
  reticulumGroupAvatarOwnerName?: string;
  reticulumGroupDisplayName?: string;
  reticulumMentionUsers?: Record<
    string,
    { address: string; name?: string; role?: 'admin' | 'owner' }
  >;
  reticulumChannelLinkAccess?: ReticulumChannelLinkAccess;
  reticulumMemberJoinedByAddress?: Record<string, number>;
  reticulumMemberRolesByAddress?: Record<string, 'owner' | 'admin'>;
  reticulumMemberRolesReady?: boolean;
  /** This DM or group (`direct:<address>`, `group:<id>`): its double tap. */
  reactionChatKey?: string;
  scrollToItem: (index: number) => void;
};

export const MessageItemComponent = ({
  handleReaction,
  isLast,
  isGroupedWithPrevious = false,
  isPrivate,
  isScrollTarget,
  isShowingAsReply,
  isTemp,
  isUpdating,
  lastSignature,
  message,
  myAddress,
  onEdit,
  onDelete,
  onReply,
  onAcceptQchatFileTransfer,
  qchatFileTransferStates,
  qchatCompletedTransfers,
  selectedGroup,
  secretKeyObject,
  onSeen,
  reactions,
  reply,
  replyIndex,
  replyExpiredMeta,
  reticulumChatEnabled = false,
  reticulumDiscussionReplyCount = 0,
  onOpenReticulumDiscussion,
  reticulumDiscussionRootId,
  reticulumDiscussionView = false,
  reticulumGroupAvatarOwnerName,
  reticulumGroupDisplayName,
  reticulumMentionUsers,
  reticulumChannelLinkAccess,
  reticulumMemberJoinedByAddress,
  reticulumMemberRolesByAddress,
  reticulumMemberRolesReady = true,
  reactionChatKey,
  scrollToItem,
}: MessageItemProps) => {
  const { getIndividualUserInfo } = useContext(QORTAL_APP_CONTEXT);
  // Queue-side fields on an optimistic row (see MessageQueueContext); the
  // row is typed loosely upstream, so read them through a narrow view.
  const queuedRow = message as unknown as
    | { status?: unknown; sendError?: unknown }
    | null
    | undefined;
  const queuedSendError =
    isTemp &&
    queuedRow?.status === 'failed-permanent' &&
    typeof queuedRow?.sendError === 'string'
      ? queuedRow.sendError
      : '';
  const highlightOwnReticulumMessages = useAtomValue(
    reticulumHighlightOwnMessagesAtom
  );
  // Only for the Select text sheet: a portal, outside the chat's size root.
  const reticulumChatTextScale = useAtomValue(reticulumChatTextScaleAtom);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [selectedReaction, setSelectedReaction] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState(null);
  const [isUserInfoResolved, setIsUserInfoResolved] = useState(false);
  const [isReticulumMinter, setIsReticulumMinter] = useState(false);
  const [isReticulumMinterResolved, setIsReticulumMinterResolved] =
    useState(false);
  const [isAvatarPreviewOpen, setIsAvatarPreviewOpen] = useState(false);
  const {
    previewSrc: avatarPreviewSrc,
    showPreview: showAvatarPreview,
    clearPreview: clearAvatarPreview,
  } = useAvatarPreviewSrc();
  const [isAvatarLoaded, setIsAvatarLoaded] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [expiryClockMs, setExpiryClockMs] = useState(Date.now());
  const [reticulumMessageMenuPosition, setReticulumMessageMenuPosition] =
    useState<{ mouseX: number; mouseY: number } | null>(null);
  // Reactions already there when the row mounted don't animate in.
  const [mountedAt] = useState(Date.now);
  const pendingTapRef = useRef<{
    timer: number;
    x: number;
    y: number;
  } | null>(null);
  // Touch equivalent of right-clicking a reaction chip to see who reacted.
  // A single set of refs is enough since only one finger can hold at a time.
  const reactionHold = useRef<{
    timer: number | null;
    origin: { x: number; y: number } | null;
    fired: boolean;
  }>({ timer: null, origin: null, fired: false });
  // Phones show the message actions as a Telegram-style popup where the
  // message was touched: a tap opens the short version, a long press the one
  // with every action and the details. It stays mounted through its closing
  // fade, so `open` and the anchor are separate.
  const [phoneActions, setPhoneActions] = useState<{
    mode: 'tap' | 'hold';
    x: number;
    y: number;
  } | null>(null);
  const [phoneActionsOpen, setPhoneActionsOpen] = useState(false);
  const openPhoneActions = useCallback(
    (mode: 'tap' | 'hold', x: number, y: number) => {
      setPhoneActions({ mode, x, y });
      setPhoneActionsOpen(true);
    },
    []
  );
  const closePhoneActions = useCallback(() => setPhoneActionsOpen(false), []);
  const cancelReactionHold = useCallback(() => {
    if (reactionHold.current.timer !== null) {
      window.clearTimeout(reactionHold.current.timer);
      reactionHold.current.timer = null;
    }
  }, []);
  const startReactionHold = useCallback(
    (event: React.TouchEvent<HTMLElement>, reaction: string) => {
      const touch = event.touches[0];
      if (!touch) return;
      // Keep the row-level hold (which opens the message menu) from arming too.
      event.stopPropagation();
      const target = event.currentTarget;
      reactionHold.current.origin = { x: touch.clientX, y: touch.clientY };
      reactionHold.current.fired = false;
      cancelReactionHold();
      reactionHold.current.timer = window.setTimeout(() => {
        reactionHold.current.timer = null;
        reactionHold.current.fired = true;
        setAnchorEl(target);
        setSelectedReaction(reaction);
      }, 450);
    },
    [cancelReactionHold]
  );
  const moveReactionHold = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      if (reactionHold.current.timer === null) return;
      const touch = event.touches[0];
      const origin = reactionHold.current.origin;
      if (!touch || !origin) return;
      if (
        Math.abs(touch.clientX - origin.x) > 10 ||
        Math.abs(touch.clientY - origin.y) > 10
      ) {
        cancelReactionHold();
      }
    },
    [cancelReactionHold]
  );
  const endReactionHold = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      cancelReactionHold();
      if (reactionHold.current.fired) {
        reactionHold.current.fired = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [cancelReactionHold]
  );
  const signedGroupWelcomeSystem =
    message?.qchatSystem?.type === 'group-welcome'
      ? message.qchatSystem
      : message?.decryptedData?.qchatSystem?.type === 'group-welcome'
        ? message.decryptedData.qchatSystem
        : null;
  const signedWelcomeJoinedAt = Number(signedGroupWelcomeSystem?.joinedAt);
  const recordedWelcomeJoinedAt = Number(
    reticulumMemberJoinedByAddress?.[message?.sender]
  );
  const groupWelcomeSystem =
    reticulumChatEnabled &&
    reticulumMemberRolesReady &&
    signedGroupWelcomeSystem?.joinedAddress === message?.sender &&
    Number(signedGroupWelcomeSystem?.groupId) === Number(message?.groupId) &&
    Number.isFinite(signedWelcomeJoinedAt) &&
    signedWelcomeJoinedAt > 0 &&
    signedWelcomeJoinedAt === recordedWelcomeJoinedAt
      ? signedGroupWelcomeSystem
      : null;
  const shouldSuppressUnvalidatedGroupWelcome =
    reticulumChatEnabled &&
    Boolean(signedGroupWelcomeSystem) &&
    (!reticulumMemberRolesReady || !groupWelcomeSystem);
  const isOfficialGroupWelcome = Boolean(
    reticulumChatEnabled && groupWelcomeSystem
  );
  const calendarSystem =
    reticulumChatEnabled &&
    message?.syntheticReticulumCalendarSystem === true &&
    typeof message?.qchatSystem?.type === 'string' &&
    message.qchatSystem.type.startsWith('calendar-event-') &&
    Number(message.qchatSystem.groupId) === Number(message?.groupId)
      ? message.qchatSystem
      : null;
  const officialGroupSystem = groupWelcomeSystem || calendarSystem;
  const isOfficialGroupSystem = Boolean(
    isOfficialGroupWelcome || calendarSystem
  );
  const displaySenderName = isOfficialGroupSystem
    ? reticulumGroupDisplayName || officialGroupSystem?.groupName || 'Group'
    : message?.senderName || message?.sender;

  useEffect(() => {
    const getInfo = async () => {
      if (isOfficialGroupSystem) {
        setUserInfo(null);
        setIsUserInfoResolved(true);
        return;
      }
      if (!message?.sender) {
        setIsUserInfoResolved(true);
        return;
      }
      setIsUserInfoResolved(false);
      try {
        const res = await getIndividualUserInfo(message?.sender);
        if (!res && !(reticulumChatEnabled && res === 0)) return null;
        setUserInfo(res);
      } catch (error) {
        //
      } finally {
        setIsUserInfoResolved(true);
      }
    };

    getInfo();
  }, [
    getIndividualUserInfo,
    isOfficialGroupSystem,
    message?.sender,
    reticulumChatEnabled,
  ]);

  useEffect(() => {
    let cancelled = false;
    const senderAddress = message?.sender;

    if (!reticulumChatEnabled || !senderAddress || isOfficialGroupSystem) {
      setIsReticulumMinter(false);
      setIsReticulumMinterResolved(isOfficialGroupSystem);
      return () => {
        cancelled = true;
      };
    }

    setIsReticulumMinter(false);
    setIsReticulumMinterResolved(false);
    void getReticulumMintership(senderAddress).then((isMinter) => {
      if (!cancelled) {
        setIsReticulumMinter(isMinter);
        setIsReticulumMinterResolved(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOfficialGroupSystem, message?.sender, reticulumChatEnabled]);

  // Defer only main message body so generateHTML runs when React has time (reduces scroll-time CPU spikes).
  // Reply block uses reply/replyExpiredMeta directly so the reply preview always shows.
  const deferredMessage = useDeferredValue(message);

  const htmlText = useMemo(() => {
    const source = deferredMessage?.messageText;
    if (source) {
      const isHtml = isHtmlString(source);
      if (isHtml) return source;
      return normalizeMessageHtmlContent(source);
    }
  }, [deferredMessage?.messageText, deferredMessage?.editTimestamp]);

  const reticulumInviteSource = useMemo(() => {
    const candidates = reticulumChatEnabled
      ? [
          deferredMessage?.messageText,
          deferredMessage?.text,
          message?.decryptedData?.data?.message,
        ]
      : [
          deferredMessage?.text,
          message?.decryptedData?.data?.message,
          deferredMessage?.messageText,
        ];
    for (const candidate of candidates) {
      const normalized = normalizeMessageHtmlContent(candidate);
      if (normalized) return normalized;
    }
    return '';
  }, [
    deferredMessage?.messageText,
    deferredMessage?.text,
    message?.decryptedData?.data?.message,
    reticulumChatEnabled,
  ]);
  const reticulumQAppPreviewLinks = useMemo(
    () =>
      reticulumChatEnabled
        ? parseReticulumQAppLinks(reticulumInviteSource).map(
            (previewLink) => previewLink.link
          )
        : [],
    [reticulumChatEnabled, reticulumInviteSource]
  );
  const reticulumEventPreviewLinks = useMemo(
    () =>
      parseReticulumEventLinks(deferredMessage).map(
        (previewLink) => previewLink.link
      ),
    [deferredMessage]
  );
  const reticulumHiddenPreviewLinks = useMemo(
    () => [...reticulumQAppPreviewLinks, ...reticulumEventPreviewLinks],
    [reticulumEventPreviewLinks, reticulumQAppPreviewLinks]
  );

  const htmlReply = useMemo(() => {
    const source = reply?.messageText || reply?.text;
    if (source) {
      const isHtml = isHtmlString(source);
      if (isHtml) return source;
      return normalizeMessageHtmlContent(source);
    }
  }, [reply?.messageText, reply?.text, reply?.editTimestamp]);

  const htmlReplyExpired = useMemo(() => {
    if (!replyExpiredMeta) return null;
    const source = replyExpiredMeta?.messageText;
    if (source) {
      const isHtml = isHtmlString(source);
      if (isHtml) return source;
      return normalizeMessageHtmlContent(source);
    }
    return null;
  }, [replyExpiredMeta?.messageText, replyExpiredMeta?.editTimestamp]);

  // Official group system messages show the group's avatar, everyone else
  // their own; both come from the device cache (no request per row).
  const avatarGroupOwnerName =
    isOfficialGroupSystem && officialGroupSystem?.groupId
      ? reticulumGroupAvatarOwnerName ||
        officialGroupSystem?.groupAvatarOwnerName ||
        ''
      : '';
  const avatarGroupId = avatarGroupOwnerName
    ? officialGroupSystem?.groupId
    : null;
  // Only the src: a status-only change (a retry on a slow node) does not
  // re-render the whole row. System rows never show a person's avatar: their
  // senderName can be the group name (calendar), which may also be a user's
  // or a Q-App's name. Without a known owner they keep the group letter.
  const senderAvatarSrc = useQdnAvatarSrc(message?.senderName, {
    enabled: !isOfficialGroupSystem,
  });
  const groupSenderAvatarSrc = useQdnAvatarSrc(avatarGroupOwnerName, {
    identifier: avatarGroupOwnerName
      ? qdnGroupAvatarIdentifier(avatarGroupId)
      : null,
    enabled: !!avatarGroupOwnerName,
  });
  const userAvatarUrl = avatarGroupOwnerName
    ? groupSenderAvatarSrc
    : senderAvatarSrc;
  // Cached images are at most 128 px: the preview loads the full one.
  const getUserAvatarPreviewUrl = useCallback((): string | undefined => {
    const name = (
      isOfficialGroupSystem ? avatarGroupOwnerName : message?.senderName || ''
    ).trim();
    if (!name) return undefined;
    try {
      return buildQdnAvatarUrl(
        getBaseApiReact(),
        {
          name,
          identifier: avatarGroupOwnerName
            ? qdnGroupAvatarIdentifier(avatarGroupId)
            : QDN_AVATAR_DEFAULT_IDENTIFIER,
        },
        { blocking: true }
      );
    } catch {
      return undefined;
    }
  }, [
    avatarGroupId,
    avatarGroupOwnerName,
    isOfficialGroupSystem,
    message?.senderName,
  ]);

  useEffect(() => {
    setIsAvatarLoaded(false);
  }, [userAvatarUrl]);

  // Opens with the small cached image at once; the full-size one replaces it
  // when it has loaded (it can take long on a slow node).
  const handleAvatarPreview = useCallback(
    (event, src?: string, requireLoaded = true, placeholderSrc?: string) => {
      if (requireLoaded && !isAvatarLoaded) return;
      const fullSrc = typeof src === 'string' ? src : getUserAvatarPreviewUrl();
      const smallSrc = typeof src === 'string' ? placeholderSrc : userAvatarUrl;
      if (!fullSrc && !smallSrc) return;
      event.preventDefault();
      event.stopPropagation();
      if (!showAvatarPreview(fullSrc, smallSrc)) return;
      setIsAvatarPreviewOpen(true);
    },
    [
      getUserAvatarPreviewUrl,
      isAvatarLoaded,
      setIsAvatarPreviewOpen,
      showAvatarPreview,
      userAvatarUrl,
    ]
  );

  const closeAvatarPreview = useCallback(() => {
    setIsAvatarPreviewOpen(false);
    clearAvatarPreview();
  }, [clearAvatarPreview, setIsAvatarPreviewOpen]);

  const onSeenFunc = useCallback(() => {
    onSeen(message.id);
  }, [message?.id]);

  const theme = useTheme();
  const isMobileLayout = useMediaQuery(theme.breakpoints.down('md'));
  const reactionListRef = useRef<HTMLDivElement | null>(null);
  const closeReactionList = useCallback(() => {
    setAnchorEl(null);
    setSelectedReaction(null);
  }, []);
  // On phones the first touch outside the "who reacted" list only closes it,
  // like Telegram. Caught on the document before React sees it, so the tap
  // never reaches the message underneath (which would open its popup) and a
  // long press there doesn't arm either. Scrolling still works: nothing is
  // prevented on touchstart, and a drag ends without a click.
  const isReactionListOpen = Boolean(selectedReaction && anchorEl);
  useEffect(() => {
    if (!isMobileLayout || !isReactionListOpen) return;
    const isInsideList = (target: EventTarget | null) =>
      target instanceof Node &&
      Boolean(reactionListRef.current?.contains(target));
    const swallowTouchStart = (event: TouchEvent) => {
      if (isInsideList(event.target)) return;
      event.stopPropagation();
    };
    const closeOnOutside = (event: MouseEvent) => {
      if (isInsideList(event.target)) return;
      // Android's long-press contextmenu on the chip is what opened the list.
      if (
        event.type === 'contextmenu' &&
        event.target instanceof Node &&
        anchorEl?.contains(event.target)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeReactionList();
    };
    document.addEventListener('touchstart', swallowTouchStart, true);
    document.addEventListener('click', closeOnOutside, true);
    document.addEventListener('contextmenu', closeOnOutside, true);
    return () => {
      document.removeEventListener('touchstart', swallowTouchStart, true);
      document.removeEventListener('click', closeOnOutside, true);
      document.removeEventListener('contextmenu', closeOnOutside, true);
    };
  }, [anchorEl, closeReactionList, isMobileLayout, isReactionListOpen]);
  const messageRowLongPress = useLongPress(
    ({ clientX, clientY }) => {
      if (isMobileLayout) {
        // A short buzz says "held", as on Telegram, before the menu lands.
        try {
          navigator.vibrate?.(10);
        } catch {
          // Vibration is a nicety; some WebViews refuse it.
        }
        openPhoneActions('hold', clientX, clientY);
        return;
      }
      setReticulumMessageMenuPosition({
        mouseX: clientX + 2,
        mouseY: clientY - 6,
      });
    },
    { enabled: reticulumChatEnabled }
  );
  // A tap anywhere on a message that is not a link, a control or a picture
  // opens the short popup; a picture opens itself. Threads open read-only, so
  // they skip the tap version.
  // `message` is typed loosely upstream; read the signature through a view.
  const rawSignature = (message as unknown as { signature?: unknown } | null)
    ?.signature;
  const messageSignature = typeof rawSignature === 'string' ? rawSignature : '';
  const canDoubleTapReact = Boolean(
    handleReaction && messageSignature && !reticulumDiscussionView && !isTemp
  );
  // A double tap reacts with this chat's double-tap emoji (thumbs up unless
  // changed), or takes it back if it is already there, like Telegram.
  const reactWithDoubleTap = useCallback(
    (x: number, y: number) => {
      const emoji = getDoubleTapReaction(readReactionPrefs(), reactionChatKey);
      const alreadyMine = Boolean(
        reactions?.[emoji]?.some((item) => item?.sender === myAddress)
      );
      if (!alreadyMine) {
        rememberRecentReaction(emoji);
        recordReactionUse(emoji);
        requestReactionLanding(messageSignature, emoji, {
          x,
          y,
          size: DOUBLE_TAP_EMOJI_PX,
          pop: true,
        });
      }
      try {
        navigator.vibrate?.(8);
      } catch {
        // Vibration is a nicety; some WebViews refuse it.
      }
      handleReaction(emoji, message, !alreadyMine);
    },
    [
      handleReaction,
      message,
      messageSignature,
      myAddress,
      reactionChatKey,
      reactions,
    ]
  );
  useEffect(
    () => () => {
      if (pendingTapRef.current) {
        window.clearTimeout(pendingTapRef.current.timer);
      }
    },
    []
  );
  const handleMobileActionsTap = useCallback(
    (event: React.MouseEvent) => {
      if (reticulumDiscussionView) return;
      if (!isEventFromRowItself(event)) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'a, button, input, textarea, [role="button"], img, video'
        )
      ) {
        return;
      }
      const x = event.clientX;
      const y = event.clientY;
      if (!canDoubleTapReact) {
        openPhoneActions('tap', x, y);
        return;
      }
      const pending = pendingTapRef.current;
      if (pending) {
        window.clearTimeout(pending.timer);
        pendingTapRef.current = null;
        if (Math.hypot(x - pending.x, y - pending.y) <= DOUBLE_TAP_SLOP_PX) {
          reactWithDoubleTap(x, y);
          return;
        }
      }
      // Wait to see whether a second tap follows before opening the popup.
      pendingTapRef.current = {
        x,
        y,
        timer: window.setTimeout(() => {
          pendingTapRef.current = null;
          openPhoneActions('tap', x, y);
        }, DOUBLE_TAP_WINDOW_MS),
      };
    },
    [
      canDoubleTapReact,
      openPhoneActions,
      reactWithDoubleTap,
      reticulumDiscussionView,
    ]
  );
  const reticulumMemberRole = reticulumChatEnabled
    ? reticulumMemberRolesByAddress?.[message?.sender]
    : undefined;
  const reticulumMemberRoleColor =
    reticulumMemberRole === 'owner'
      ? theme.palette.mode === 'dark'
        ? '#ffb454'
        : '#a84a00'
      : reticulumMemberRole === 'admin'
        ? theme.palette.mode === 'dark'
          ? '#58a6ff'
          : '#1d4ed8'
        : theme.palette.mode === 'dark'
          ? '#f2f2f4'
          : '#1b1d24';
  const reticulumMinterLevel =
    reticulumChatEnabled &&
    isReticulumMinter &&
    typeof userInfo === 'number' &&
    Number.isFinite(userInfo) &&
    userInfo >= 0
      ? Math.trunc(userInfo)
      : null;
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const hasUnsafeSenderName = Boolean(
    message?.senderName && hasInvisibleCharacters(message.senderName)
  );
  const hasUnsafeReplyName = Boolean(
    reply?.senderName && hasInvisibleCharacters(reply.senderName)
  );
  const hasUnsafeExpiredReplyName = Boolean(
    replyExpiredMeta?.senderName &&
    hasInvisibleCharacters(replyExpiredMeta.senderName)
  );

  const qchatFileTransfer = getQchatFileTransfer(message);
  const isReticulumMessageWithResources =
    message?.reticulumChat === true || message?.reticulumDirect === true;
  const isReticulumDirectResourceMessage = message?.reticulumDirect === true;
  const reticulumDirectPeerAddress = isReticulumDirectResourceMessage
    ? message?.sender === myAddress
      ? typeof message?.recipientAddress === 'string'
        ? message.recipientAddress
        : ''
      : typeof message?.sender === 'string'
        ? message.sender
        : ''
    : '';
  const isReticulumResourceImage =
    isReticulumMessageWithResources &&
    message?.images?.[0]?.reticulumResource === true &&
    typeof message?.images?.[0]?.fileHash === 'string';
  const imageResourceId = isReticulumResourceImage
    ? message.images[0].fileHash
    : '';
  const imageResourceManifest =
    isReticulumResourceImage &&
    message?.images?.[0] &&
    typeof message.images[0] === 'object'
      ? message.images[0]
      : null;
  const imageResourceManifestRef = useRef(imageResourceManifest);
  imageResourceManifestRef.current = imageResourceManifest;
  const imageResourceFileHash =
    typeof imageResourceManifest?.fileHash === 'string'
      ? imageResourceManifest.fileHash
      : '';
  const imageResourceSize =
    typeof imageResourceManifest?.sizeBytes === 'number'
      ? imageResourceManifest.sizeBytes
      : 0;
  const shouldAutoDownloadReticulumImage =
    isReticulumResourceImage &&
    (!imageResourceSize ||
      imageResourceSize < RETICULUM_INLINE_IMAGE_THRESHOLD_BYTES);
  const largeReticulumImageAttachment =
    isReticulumResourceImage && !shouldAutoDownloadReticulumImage
      ? imageResourceManifest
      : null;
  const imageResourceMetadataWidth = (() => {
    const direct = Number(imageResourceManifest?.width);
    const metadata = Number(
      (imageResourceManifest?.metadata as Record<string, unknown> | undefined)
        ?.width
    );
    const value = Number.isFinite(direct) && direct > 0 ? direct : metadata;
    return Number.isFinite(value) && value > 0 ? value : null;
  })();
  const imageResourceMetadataHeight = (() => {
    const direct = Number(imageResourceManifest?.height);
    const metadata = Number(
      (imageResourceManifest?.metadata as Record<string, unknown> | undefined)
        ?.height
    );
    const value = Number.isFinite(direct) && direct > 0 ? direct : metadata;
    return Number.isFinite(value) && value > 0 ? value : null;
  })();
  const [loadedResourceImageSize, setLoadedResourceImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const imageResourceWidth =
    loadedResourceImageSize?.width ?? imageResourceMetadataWidth;
  const imageResourceHeight =
    loadedResourceImageSize?.height ?? imageResourceMetadataHeight;
  const imageResourceDisplaySize = getReticulumInlineImageDisplaySize(
    imageResourceWidth,
    imageResourceHeight
  );
  const imageResourceAspectRatio = imageResourceDisplaySize.aspectRatio;
  const imageResourceDisplayWidth = imageResourceDisplaySize.width;
  const reticulumFileAttachment =
    isReticulumMessageWithResources && Array.isArray(message?.attachments)
      ? message.attachments.find(
          (attachment) =>
            attachment &&
            typeof attachment === 'object' &&
            attachment.reticulumResource === true &&
            typeof attachment.fileHash === 'string'
        )
      : null;
  const reticulumDownloadAttachment =
    reticulumFileAttachment || largeReticulumImageAttachment;
  const reticulumFileResourceId =
    typeof reticulumDownloadAttachment?.fileHash === 'string'
      ? reticulumDownloadAttachment.fileHash
      : '';
  // The sender picks the name: shown, saved and opened without bidi or other
  // invisible characters (N-27).
  const reticulumFileName =
    cleanFileName(reticulumDownloadAttachment?.fileName) ||
    (largeReticulumImageAttachment ? 'Image attachment' : 'File attachment');
  const reticulumFileSize =
    typeof reticulumDownloadAttachment?.sizeBytes === 'number'
      ? reticulumDownloadAttachment.sizeBytes
      : 0;
  const reticulumResourceGroupId = Number(
    message?.groupId ??
      message?.decryptedData?.groupId ??
      selectedGroup?.groupId ??
      selectedGroup?.id ??
      0
  );
  const reticulumSilenceContext = useMemo(() => {
    if (!reticulumChatEnabled || !myAddress) {
      return undefined;
    }
    if (message?.reticulumDirect === true) {
      if (myAddress === message?.sender) return undefined;
      return {
        ownerAddress: myAddress,
        scopeType: 'dm' as const,
      };
    }
    if (!reticulumMemberRolesReady) {
      return undefined;
    }
    const groupId = Number(
      message?.groupId ??
        selectedGroup?.groupId ??
        selectedGroup?.id ??
        selectedGroup
    );
    if (!Number.isInteger(groupId) || groupId <= 0) return undefined;
    if (myAddress === message?.sender && reticulumMemberRole !== 'owner') {
      return undefined;
    }
    return {
      disabled: reticulumMemberRole === 'owner',
      ownerAddress: myAddress,
      scopeType: 'group' as const,
      groupId,
    };
  }, [
    message?.groupId,
    message?.reticulumDirect,
    message?.sender,
    myAddress,
    reticulumChatEnabled,
    reticulumMemberRole,
    reticulumMemberRolesReady,
    selectedGroup,
  ]);
  const reticulumResourceEventId =
    typeof message?.signature === 'string'
      ? message.signature
      : typeof message?.tempSignature === 'string'
        ? message.tempSignature
        : '';
  const libraryGifImage = isLibraryGifImage(message?.images?.[0])
    ? message.images[0]
    : null;
  const imageEmbedLink = messageHasImage(message)
    ? buildImageEmbedLink(message.images[0])
    : null;
  const [localResourceImageUrl, setLocalResourceImageUrl] = useState<
    string | null
  >(null);
  const [isReticulumImageViewerOpen, setIsReticulumImageViewerOpen] =
    useState(false);
  const [reticulumImageViewerSrc, setReticulumImageViewerSrc] = useState<
    string | null
  >(null);
  const [reticulumImageViewerContainer, setReticulumImageViewerContainer] =
    useState<HTMLElement | null>(null);
  // The chat's pictures and videos, to swipe through from this one.
  const chatMediaGallery = useContext(ChatMediaGalleryContext);
  const [reticulumImageViewerGallery, setReticulumImageViewerGallery] =
    useState<{ items: ChatMediaItem[]; index: number } | null>(null);
  const displayImageUrl = localResourceImageUrl || imageEmbedLink;
  useEffect(() => {
    setLoadedResourceImageSize(null);
  }, [imageResourceId]);
  const reticulumImageFileName =
    typeof imageResourceManifest?.fileName === 'string' &&
    imageResourceManifest.fileName.trim()
      ? imageResourceManifest.fileName.trim()
      : 'image.png';
  const reticulumImageMimeType =
    typeof imageResourceManifest?.mimeType === 'string'
      ? imageResourceManifest.mimeType
      : typeof imageResourceManifest?.metadata?.originalMimeType === 'string'
        ? imageResourceManifest.metadata.originalMimeType
        : 'image/png';
  const canOpenReticulumImage =
    reticulumChatEnabled &&
    Boolean(
      displayImageUrl &&
      (localResourceImageUrl || displayImageUrl.startsWith('data:image/'))
    );
  const [resourceReloadNonce, setResourceReloadNonce] = useState(0);
  const [reticulumImageDownloadIssue, setReticulumImageDownloadIssue] =
    useState<'unavailable' | 'error' | null>(null);
  const reticulumImageRequestKey =
    isReticulumResourceImage && imageResourceId
      ? isReticulumDirectResourceMessage
        ? myAddress && reticulumDirectPeerAddress
          ? `dm:${myAddress}:${reticulumDirectPeerAddress}:${imageResourceId}:${
              reticulumResourceEventId || ''
            }`
          : ''
        : Number.isInteger(reticulumResourceGroupId) &&
            reticulumResourceGroupId > 0
          ? `${reticulumResourceGroupId}:${imageResourceId}:${
              reticulumResourceEventId || ''
            }`
          : ''
      : '';
  useEffect(() => {
    setReticulumImageDownloadIssue(null);
  }, [imageResourceId]);
  const retryReticulumImageDownload = useCallback(() => {
    if (reticulumImageRequestKey) {
      reticulumImageRequestGate.clear(reticulumImageRequestKey);
    }
    setReticulumImageDownloadIssue(null);
    setResourceReloadNonce((value) => value + 1);
  }, [reticulumImageRequestKey]);
  const openReticulumImageViewer = useCallback(
    async (containerElement: HTMLElement | null) => {
      let viewerSrc = displayImageUrl;
      if (
        imageResourceId &&
        localResourceImageUrl?.startsWith('qortal-reticulum-resource:')
      ) {
        const refreshed = await window.reticulumResources
          ?.getUrl?.(imageResourceId)
          .catch(() => null);
        if (!refreshed?.success || !refreshed.url) {
          setLocalResourceImageUrl(null);
          setResourceReloadNonce((value) => value + 1);
          return;
        }
        viewerSrc = refreshed.url;
        setLocalResourceImageUrl(refreshed.url);
      }
      if (!viewerSrc) return;
      const galleryItems = chatMediaGallery?.getItems() ?? [];
      const galleryIndex = galleryItems.findIndex(
        (item) =>
          item.kind === 'image' &&
          item.fileHash === imageResourceId &&
          item.messageKey === messageSignature
      );
      setReticulumImageViewerGallery(
        galleryIndex >= 0 ? { items: galleryItems, index: galleryIndex } : null
      );
      setReticulumImageViewerContainer(containerElement);
      setReticulumImageViewerSrc(viewerSrc);
      setIsReticulumImageViewerOpen(true);
    },
    [
      chatMediaGallery,
      displayImageUrl,
      imageResourceId,
      localResourceImageUrl,
      messageSignature,
    ]
  );
  // A library GIF opens in the same viewer: copy, save, swipe on.
  const openLibraryGifViewer = useCallback(
    async (containerElement: HTMLElement | null) => {
      if (!libraryGifImage) return;
      if (!isMobileLayout && !containerElement) return;
      const url = await requestLibraryGifUrl(libraryGifImage, 12).catch(
        () => ''
      );
      if (!url) return;
      const galleryItems = chatMediaGallery?.getItems() ?? [];
      const galleryIndex = findChatMediaIndex(galleryItems, {
        messageKey: messageSignature,
        gif: true,
      });
      setReticulumImageViewerGallery(
        galleryIndex >= 0 ? { items: galleryItems, index: galleryIndex } : null
      );
      setReticulumImageViewerContainer(containerElement);
      setReticulumImageViewerSrc(url);
      setIsReticulumImageViewerOpen(true);
    },
    [chatMediaGallery, isMobileLayout, libraryGifImage, messageSignature]
  );
  const [fileResourceStatus, setFileResourceStatus] = useState<
    'idle' | 'downloading' | 'ready' | 'saving' | 'error'
  >('idle');
  const [fileResourceFailureReason, setFileResourceFailureReason] = useState<
    'verification_failed' | null
  >(null);
  const [fileResourceProgress, setFileResourceProgress] = useState<
    number | null
  >(null);
  const [fileResourceBytes, setFileResourceBytes] = useState<{
    received: number;
    total: number;
  } | null>(null);
  const [fileResourceLastChunkAt, setFileResourceLastChunkAt] = useState<
    number | null
  >(null);
  const [fileResourceCheckedAt, setFileResourceCheckedAt] = useState<
    number | null
  >(null);
  const [fileResourceStartedAt, setFileResourceStartedAt] = useState<
    number | null
  >(null);
  const [fileResourceRuntime, setFileResourceRuntime] = useState<{
    active?: boolean;
    peerCount?: number;
    candidatePeerCount?: number;
    advertisedPeerCount?: number;
    activeTransfers?: number;
    pendingTransfers?: number;
    requestedRangeCount?: number;
    inFlightRangeCount?: number;
    currentBytesPerSecond?: number;
    averageBytesPerSecond?: number;
    nextRequestAt?: number | null;
  } | null>(null);
  const [isFileOpenWarningOpen, setIsFileOpenWarningOpen] = useState(false);
  const [isOpeningFile, setIsOpeningFile] = useState(false);
  const [fileOpenError, setFileOpenError] = useState<string | null>(null);
  useEffect(() => {
    if (
      !isReticulumResourceImage ||
      !shouldAutoDownloadReticulumImage ||
      !imageResourceId ||
      !imageResourceManifest ||
      (!isReticulumDirectResourceMessage &&
        (!Number.isInteger(reticulumResourceGroupId) ||
          reticulumResourceGroupId <= 0)) ||
      (isReticulumDirectResourceMessage &&
        (!myAddress || !reticulumDirectPeerAddress))
    ) {
      return;
    }

    let cancelled = false;
    let availabilityTimer: number | null = null;
    const key = reticulumImageRequestKey;
    const nowMs = Date.now();
    const requestBackoffRemainingMs = reticulumImageRequestGate.getRemainingMs(
      key,
      nowMs
    );

    const clearAvailabilityTimer = () => {
      if (availabilityTimer === null) return;
      window.clearTimeout(availabilityTimer);
      availabilityTimer = null;
    };
    const scheduleAvailabilityCheck = (delayMs: number) => {
      clearAvailabilityTimer();
      availabilityTimer = window.setTimeout(
        () => {
          availabilityTimer = null;
          void window.reticulumResources
            ?.getStatus?.(imageResourceId)
            .then((status) => {
              if (cancelled) return;
              if (status?.success && status.complete) {
                reticulumImageRequestGate.clear(key);
                setReticulumImageDownloadIssue(null);
                setResourceReloadNonce((value) => value + 1);
                return;
              }

              const runtime = status?.runtime;
              const hasActiveTransfer = Boolean(
                (runtime?.activeTransfers ?? 0) > 0 ||
                (runtime?.pendingTransfers ?? 0) > 0 ||
                (runtime?.inFlightRangeCount ?? 0) > 0
              );
              if (hasActiveTransfer) {
                scheduleAvailabilityCheck(
                  RETICULUM_IMAGE_AVAILABILITY_RECHECK_MS
                );
                return;
              }
              setReticulumImageDownloadIssue('unavailable');
            })
            .catch(() => {
              if (!cancelled) setReticulumImageDownloadIssue('error');
            });
        },
        Math.max(0, delayMs)
      );
    };

    if (requestBackoffRemainingMs > 0) {
      const remainingAvailabilityWait = Math.max(
        0,
        RETICULUM_IMAGE_UNAVAILABLE_TIMEOUT_MS -
          (RETICULUM_IMAGE_REQUEST_BACKOFF_MS - requestBackoffRemainingMs)
      );
      scheduleAvailabilityCheck(remainingAvailabilityWait);
      return () => {
        cancelled = true;
        clearAvailabilityTimer();
      };
    }

    setReticulumImageDownloadIssue(null);
    void (async () => {
      try {
        const status =
          await window.reticulumResources?.getStatus?.(imageResourceId);
        if (cancelled) return;
        if (status?.success && status.complete) {
          clearAvailabilityTimer();
          reticulumImageRequestGate.clear(key);
          setReticulumImageDownloadIssue(null);
          return;
        }

        const requestStartedAt = Date.now();
        if (!reticulumImageRequestGate.claim(key, requestStartedAt)) {
          const remainingMs = reticulumImageRequestGate.getRemainingMs(
            key,
            requestStartedAt
          );
          scheduleAvailabilityCheck(
            Math.max(
              0,
              RETICULUM_IMAGE_UNAVAILABLE_TIMEOUT_MS -
                (RETICULUM_IMAGE_REQUEST_BACKOFF_MS - remainingMs)
            )
          );
          return;
        }

        const currentManifest = imageResourceManifestRef.current;
        if (!currentManifest || currentManifest.fileHash !== imageResourceId) {
          reticulumImageRequestGate.clear(key);
          setReticulumImageDownloadIssue('error');
          return;
        }

        scheduleAvailabilityCheck(RETICULUM_IMAGE_UNAVAILABLE_TIMEOUT_MS);

        const response = isReticulumDirectResourceMessage
          ? await window.reticulumChat?.requestDirectResource?.(
              myAddress,
              reticulumDirectPeerAddress,
              currentManifest,
              reticulumResourceEventId || undefined
            )
          : await window.reticulumChat?.requestResource?.(
              reticulumResourceGroupId,
              currentManifest,
              reticulumResourceEventId || undefined
            );
        if (!response?.success) {
          reticulumImageRequestGate.clear(key);
          if (cancelled) return;
          clearAvailabilityTimer();
          setReticulumImageDownloadIssue('error');
          console.warn(
            '[ReticulumResource] Image resource request failed:',
            response?.error || 'request API unavailable',
            imageResourceId
          );
        }
      } catch (error) {
        reticulumImageRequestGate.clear(key);
        if (cancelled) return;
        clearAvailabilityTimer();
        setReticulumImageDownloadIssue('error');
        console.warn(
          '[ReticulumResource] Image resource request failed:',
          error instanceof Error ? error.message : error,
          imageResourceId
        );
      }
    })();

    return () => {
      cancelled = true;
      clearAvailabilityTimer();
    };
  }, [
    imageResourceId,
    isReticulumResourceImage,
    isReticulumDirectResourceMessage,
    myAddress,
    reticulumDirectPeerAddress,
    reticulumResourceEventId,
    reticulumResourceGroupId,
    reticulumImageRequestKey,
    resourceReloadNonce,
    shouldAutoDownloadReticulumImage,
  ]);

  const qchatFileData = qchatFileTransfer?.data || {};
  const qchatTransferState =
    qchatFileData?.transferId && qchatFileTransferStates
      ? qchatFileTransferStates[qchatFileData.transferId]
      : null;
  const qchatDownloaded =
    !!qchatFileData?.transferId &&
    !!qchatCompletedTransfers?.[qchatFileData.transferId];
  const qchatCompletedRecord = qchatFileData?.transferId
    ? qchatCompletedTransfers?.[qchatFileData.transferId]
    : null;
  // Android keeps a received file in GO's private storage (N-22, N-27):
  // "Open" shows it in GO's viewer and "Save to device" exports it on
  // request. Builds up to v0.0.14 also copied it to public Downloads; that
  // copy (downloadsUri) is still opened when the private one is gone.
  const qchatReceivedPath = qchatCompletedRecord?.path || '';
  const qchatReceivedLegacyUri = qchatCompletedRecord?.downloadsUri || '';
  const qchatReceivedFileName =
    qchatCompletedRecord?.fileName || qchatFileData?.fileName || '';
  const qchatReceivedFile = useMemo(
    () => ({
      path: qchatReceivedPath,
      legacyUri: qchatReceivedLegacyUri,
      fileName: qchatReceivedFileName,
    }),
    [qchatReceivedFileName, qchatReceivedLegacyUri, qchatReceivedPath]
  );
  const qchatReceivedActionsEnabled =
    qchatDownloaded &&
    (!!qchatReceivedPath || !!qchatReceivedLegacyUri) &&
    Capacitor.isNativePlatform() &&
    typeof getQchatFileApi()?.qchatFileOpen === 'function';
  const qchatReceived = useReceivedQchatFile(
    qchatReceivedFile,
    qchatReceivedActionsEnabled
  );
  const qchatReceivedGone =
    qchatReceivedActionsEnabled && qchatReceived.state === 'gone';
  const qchatDisplayStatus = qchatDownloaded
    ? 'received'
    : qchatTransferState?.status || qchatFileData?.status || 'offer';
  const qchatProgress =
    typeof qchatTransferState?.progress === 'number'
      ? Math.max(
          0,
          Math.min(100, Math.round(qchatTransferState.progress * 100))
        )
      : null;
  const qchatTransferBusy =
    qchatDisplayStatus === 'accepted' ||
    qchatDisplayStatus === 'connecting' ||
    qchatDisplayStatus === 'retrying' ||
    qchatDisplayStatus === 'link_established' ||
    qchatDisplayStatus === 'auth_sent' ||
    qchatDisplayStatus === 'auth' ||
    qchatDisplayStatus === 'authorized' ||
    qchatDisplayStatus === 'sending' ||
    qchatDisplayStatus === 'receiving';
  const qchatTransferDone =
    qchatDisplayStatus === 'sent' ||
    qchatDisplayStatus === 'received' ||
    qchatDownloaded;
  const qchatTransferError =
    qchatDisplayStatus === 'failed' || qchatDisplayStatus === 'rejected';
  const qchatShowOfferExpiry =
    qchatDisplayStatus === 'offer' || qchatDisplayStatus === 'registered';
  const qchatExpiresAt =
    typeof qchatFileData?.expiresAt === 'number'
      ? qchatFileData.expiresAt
      : typeof message?.timestamp === 'number'
        ? message.timestamp + QCHAT_FILE_TRANSFER_TTL_MS
        : null;
  const qchatMsLeft =
    qchatShowOfferExpiry &&
    qchatExpiresAt &&
    !qchatTransferDone &&
    !qchatTransferError
      ? Math.max(0, qchatExpiresAt - nowMs)
      : null;
  const qchatOfferExpired =
    qchatShowOfferExpiry &&
    !qchatTransferDone &&
    !qchatTransferError &&
    !!qchatExpiresAt &&
    qchatExpiresAt <= nowMs;
  const qchatExpiryText =
    qchatMsLeft === null
      ? ''
      : qchatMsLeft <= 0
        ? 'expired'
        : `${Math.floor(qchatMsLeft / 60000)}:${Math.floor(
            (qchatMsLeft % 60000) / 1000
          )
            .toString()
            .padStart(2, '0')} left`;
  const qchatStatusText = (() => {
    switch (qchatDisplayStatus) {
      case 'offer':
        if (qchatDownloaded) return 'downloaded';
        if (qchatOfferExpired) return 'expired';
        return 'offer';
      case 'registered':
        return 'waiting for downloader';
      case 'accepted':
      case 'connecting':
        return 'creating link';
      case 'retrying':
        return `retrying link ${qchatTransferState?.attempt || ''}`.trim();
      case 'link_established':
        return 'link established';
      case 'auth_sent':
        return 'waiting for sender authorization';
      case 'auth':
        return 'verifying downloader';
      case 'authorized':
        return 'authorized';
      case 'sending':
        return qchatProgress !== null
          ? `uploading ${qchatProgress}%`
          : 'uploading';
      case 'receiving':
        return qchatProgress !== null
          ? `downloading ${qchatProgress}%`
          : 'downloading';
      case 'sent':
        return 'sent';
      case 'received':
        return 'downloaded';
      case 'failed':
      case 'rejected':
        return `error: ${
          qchatTransferState?.error ||
          qchatTransferState?.reason ||
          'transfer failed'
        }`;
      default:
        return qchatDisplayStatus;
    }
  })();

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    setLocalResourceImageUrl(null);
    if (!imageResourceId || !shouldAutoDownloadReticulumImage) return;
    const arrayBufferToBinaryString = (buffer: ArrayBuffer): string => {
      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000;
      let out = '';
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        out += String.fromCharCode(
          ...bytes.subarray(offset, offset + chunkSize)
        );
      }
      return out;
    };
    const load = async (attempt = 0) => {
      const result = await window.reticulumResources
        ?.getUrl?.(imageResourceId)
        .catch(() => null);
      if (cancelled) return;
      if (result?.success && result.url) {
        const manifest = result.manifest as
          | {
              encrypted?: boolean;
              metadata?: Record<string, unknown>;
            }
          | undefined;
        if (manifest?.encrypted) {
          if (!secretKeyObject) return;
          try {
            const response = await fetch(result.url);
            if (response.ok) {
              const encryptedPayload = arrayBufferToBinaryString(
                await response.arrayBuffer()
              );
              const decrypted = await window.sendMessage?.('decryptSingle', {
                data: [{ data: encryptedPayload }],
                secretKeyObject,
              });
              if (cancelled) return;
              const decryptedData = decrypted?.[0]?.decryptedData;
              const imageBase64 =
                typeof decryptedData?.imageBase64 === 'string'
                  ? decryptedData.imageBase64
                  : '';
              if (imageBase64) {
                const mimeType =
                  typeof decryptedData?.mimeType === 'string'
                    ? decryptedData.mimeType
                    : typeof manifest.metadata?.originalMimeType === 'string'
                      ? manifest.metadata.originalMimeType
                      : 'image/webp';
                setLocalResourceImageUrl(
                  `data:${mimeType};base64,${imageBase64}`
                );
                return;
              }
            }
          } catch (error) {
            console.error(
              '[ReticulumResource] Failed to load encrypted image:',
              error
            );
          }
        }
        if (!manifest?.encrypted) {
          setLocalResourceImageUrl(result.url);
          return;
        }
      }
      if (attempt < 5) {
        const delay = attempt === 0 ? 1_500 : Math.min(8_000, 2_000 * attempt);
        timers.push(window.setTimeout(() => void load(attempt + 1), delay));
      }
    };
    void load();
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [
    imageResourceFileHash,
    imageResourceId,
    resourceReloadNonce,
    secretKeyObject,
    shouldAutoDownloadReticulumImage,
  ]);

  const applyFileResourceStatus = useCallback(
    (payload?: {
      bytesTransferred?: number;
      totalBytes?: number;
      progress?: number;
      complete?: boolean;
      failed?: boolean;
      failureReason?: 'verification_failed';
      latestRangeUpdatedAt?: number | null;
      checkedAt?: number;
      runtime?: {
        active?: boolean;
        peerCount?: number;
        candidatePeerCount?: number;
        advertisedPeerCount?: number;
        activeTransfers?: number;
        pendingTransfers?: number;
        requestedRangeCount?: number;
        inFlightRangeCount?: number;
        currentBytesPerSecond?: number;
        averageBytesPerSecond?: number;
        nextRequestAt?: number | null;
      } | null;
    }) => {
      if (!payload) return;
      const verificationFailed =
        payload.failureReason === 'verification_failed';
      if (verificationFailed) {
        const restartedAt = Date.now();
        setFileResourceFailureReason('verification_failed');
        setFileResourceProgress(0);
        setFileResourceBytes(
          typeof payload.totalBytes === 'number' && payload.totalBytes > 0
            ? { received: 0, total: payload.totalBytes }
            : null
        );
        setFileResourceLastChunkAt(null);
        setFileResourceStartedAt(restartedAt);
        setFileResourceStatus(payload.failed ? 'error' : 'downloading');
      } else if (
        payload.complete ||
        (typeof payload.bytesTransferred === 'number' &&
          payload.bytesTransferred > 0)
      ) {
        setFileResourceFailureReason(null);
      }
      if (typeof payload.checkedAt === 'number') {
        setFileResourceCheckedAt(payload.checkedAt);
      }
      if (payload.runtime && typeof payload.runtime === 'object') {
        setFileResourceRuntime(payload.runtime);
      }
      if (typeof payload.progress === 'number') {
        const maximumProgress = payload.complete ? 100 : 99;
        const nextProgress = Math.max(
          0,
          Math.min(maximumProgress, Math.round(payload.progress * 100))
        );
        setFileResourceProgress((progress) =>
          typeof progress === 'number'
            ? Math.max(progress, nextProgress)
            : nextProgress
        );
        if (nextProgress > 0) {
          setFileResourceLastChunkAt(Date.now());
        }
      }
      if (
        typeof payload.bytesTransferred === 'number' &&
        typeof payload.totalBytes === 'number' &&
        payload.totalBytes > 0
      ) {
        const received = Math.max(
          0,
          Math.min(payload.bytesTransferred, payload.totalBytes)
        );
        const byteProgress = Math.max(
          0,
          Math.min(
            payload.complete ? 100 : 99,
            Math.round((received / payload.totalBytes) * 100)
          )
        );
        setFileResourceBytes((bytes) => ({
          received:
            bytes && bytes.total === payload.totalBytes
              ? Math.max(bytes.received, received)
              : received,
          total: payload.totalBytes,
        }));
        setFileResourceProgress((progress) =>
          typeof progress === 'number'
            ? Math.max(progress, byteProgress)
            : byteProgress
        );
        if (received > 0) {
          setFileResourceLastChunkAt(Date.now());
        }
      }
      if (
        typeof payload.latestRangeUpdatedAt === 'number' &&
        payload.latestRangeUpdatedAt > 0
      ) {
        setFileResourceLastChunkAt(payload.latestRangeUpdatedAt);
      }
      if (payload.canceled) {
        setFileResourceFailureReason(null);
        setFileResourceStatus('idle');
        setFileResourceProgress(null);
        setFileResourceBytes(null);
        setFileResourceRuntime(null);
        setFileResourceStartedAt(null);
        setFileResourceLastChunkAt(null);
        return;
      }
      if (payload.complete) {
        setFileResourceFailureReason(null);
        setFileResourceStatus('ready');
        setFileResourceProgress(100);
        setFileResourceBytes(null);
      }
      if (payload.failed) {
        setFileResourceStatus('error');
      }
    },
    []
  );

  const markFileResourceReadyIfComplete = useCallback(async () => {
    if (!reticulumFileResourceId) return false;
    const status = await window.reticulumResources?.getStatus?.(
      reticulumFileResourceId
    );
    if (!status?.success) return false;
    applyFileResourceStatus(status);
    return status.complete === true;
  }, [applyFileResourceStatus, reticulumFileResourceId]);

  useEffect(() => {
    if (
      (!imageResourceId && !reticulumFileResourceId) ||
      typeof window.reticulumChat?.onResource !== 'function'
    )
      return;
    return window.reticulumChat.onResource((payload) => {
      if (
        shouldAutoDownloadReticulumImage &&
        payload?.fileHash === imageResourceId
      ) {
        if (payload.complete === true) {
          if (reticulumImageRequestKey) {
            reticulumImageRequestGate.clear(reticulumImageRequestKey);
          }
          setReticulumImageDownloadIssue(null);
          setResourceReloadNonce((value) => value + 1);
        } else if (payload.failed === true) {
          setReticulumImageDownloadIssue('error');
        }
      }
      if (payload?.fileHash === reticulumFileResourceId) {
        applyFileResourceStatus(payload);
        if (payload.complete) {
          void markFileResourceReadyIfComplete();
        }
      }
    });
  }, [
    applyFileResourceStatus,
    imageResourceId,
    markFileResourceReadyIfComplete,
    reticulumFileResourceId,
    reticulumImageRequestKey,
    shouldAutoDownloadReticulumImage,
  ]);

  const requestReticulumFileResource = useCallback(async () => {
    if (
      !reticulumDownloadAttachment ||
      !reticulumFileResourceId ||
      (!isReticulumDirectResourceMessage &&
        (!Number.isInteger(reticulumResourceGroupId) ||
          reticulumResourceGroupId <= 0)) ||
      (isReticulumDirectResourceMessage &&
        (!myAddress || !reticulumDirectPeerAddress))
    ) {
      return { success: false, error: 'Invalid resource attachment' };
    }
    const ready = await markFileResourceReadyIfComplete();
    if (ready) {
      return { success: true };
    }
    setFileResourceStatus('downloading');
    setFileResourceFailureReason(null);
    setFileResourceProgress((progress) =>
      typeof progress === 'number' ? progress : 0
    );
    setFileResourceLastChunkAt(null);
    const startedAt = Date.now();
    setFileResourceCheckedAt(startedAt);
    setFileResourceStartedAt(startedAt);
    setFileResourceRuntime(null);
    setFileResourceBytes(
      reticulumFileSize > 0
        ? {
            received: 0,
            total: reticulumFileSize,
          }
        : null
    );
    const response = isReticulumDirectResourceMessage
      ? await window.reticulumChat?.requestDirectResource?.(
          myAddress,
          reticulumDirectPeerAddress,
          reticulumDownloadAttachment,
          reticulumResourceEventId || undefined
        )
      : await window.reticulumChat?.requestResource?.(
          reticulumResourceGroupId,
          reticulumDownloadAttachment,
          reticulumResourceEventId || undefined
        );
    if (response?.success === false) {
      setFileResourceStatus('error');
      return response;
    }
    return { success: true };
  }, [
    reticulumDownloadAttachment,
    reticulumFileSize,
    reticulumFileResourceId,
    reticulumResourceEventId,
    reticulumResourceGroupId,
    isReticulumDirectResourceMessage,
    markFileResourceReadyIfComplete,
    myAddress,
    reticulumDirectPeerAddress,
  ]);

  const cancelReticulumFileResource = useCallback(async () => {
    if (!reticulumFileResourceId) return;
    setFileResourceStatus('idle');
    setFileResourceFailureReason(null);
    setFileResourceProgress(null);
    setFileResourceBytes(null);
    setFileResourceRuntime(null);
    setFileResourceStartedAt(null);
    setFileResourceLastChunkAt(null);
    await window.reticulumChat?.cancelResource?.(reticulumFileResourceId);
  }, [reticulumFileResourceId]);

  const saveReticulumFileResource = useCallback(async () => {
    if (!reticulumFileResourceId) return;
    setFileResourceStatus((status) => (status === 'ready' ? 'saving' : status));
    const ready = await markFileResourceReadyIfComplete();
    if (!ready) {
      const requested = await requestReticulumFileResource();
      if (requested?.success === false) return;
      return;
    }
    const saved = await window.reticulumResources
      ?.saveAs?.(reticulumFileResourceId, reticulumFileName)
      .catch((error: unknown) => ({
        success: false as const,
        error: error instanceof Error ? error.message : 'Save failed',
      }));
    if (saved?.success) {
      setFileResourceStatus('ready');
      // The phone has no save dialog: say where the file went. The save
      // reports the folder its type put it in.
      if (Capacitor.isNativePlatform()) {
        const { mobileSaveLocationLabelFor } =
          await import('../../utils/mobileFileSave');
        const savedLocation = (saved as { location?: unknown }).location;
        executeEvent('openGlobalSnackBar', {
          message: t('core:file_transfer.saved_to', {
            location:
              typeof savedLocation === 'string' && savedLocation
                ? savedLocation
                : mobileSaveLocationLabelFor(reticulumFileName),
          }),
          type: 'success',
        });
      }
      return;
    }
    setFileResourceStatus(saved?.canceled ? 'ready' : 'error');
  }, [
    markFileResourceReadyIfComplete,
    requestReticulumFileResource,
    reticulumFileName,
    reticulumFileResourceId,
    t,
  ]);

  const openReticulumFileResource = useCallback(async () => {
    if (!reticulumFileResourceId || fileResourceStatus !== 'ready') return;
    setIsOpeningFile(true);
    setFileOpenError(null);
    try {
      const result = await window.reticulumResources?.open?.(
        reticulumFileResourceId,
        reticulumFileName
      );
      if (!result?.success) {
        setFileOpenError(
          result?.error || 'The operating system could not open this file.'
        );
        return;
      }
      setIsFileOpenWarningOpen(false);
    } catch (error) {
      setFileOpenError(
        error instanceof Error
          ? error.message
          : 'The operating system could not open this file.'
      );
    } finally {
      setIsOpeningFile(false);
    }
  }, [fileResourceStatus, reticulumFileName, reticulumFileResourceId]);

  useEffect(() => {
    let cancelled = false;
    if (!reticulumFileResourceId) {
      setFileResourceStatus('idle');
      setFileResourceFailureReason(null);
      setFileResourceProgress(null);
      setFileResourceBytes(null);
      return;
    }
    void window.reticulumResources
      ?.getStatus?.(reticulumFileResourceId)
      .then((result) => {
        if (cancelled) return;
        if (result?.success && result.complete) {
          applyFileResourceStatus(result);
        } else {
          setFileResourceStatus('idle');
          setFileResourceFailureReason(null);
          setFileResourceProgress(null);
          setFileResourceBytes(null);
          setFileResourceLastChunkAt(null);
          setFileResourceCheckedAt(null);
          setFileResourceStartedAt(null);
          setFileResourceRuntime(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyFileResourceStatus, reticulumFileResourceId, resourceReloadNonce]);

  useEffect(() => {
    if (!reticulumFileResourceId || fileResourceStatus !== 'downloading')
      return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void window.reticulumResources
        ?.getStatus?.(reticulumFileResourceId)
        .then((status) => {
          if (cancelled || !status?.success) return;
          applyFileResourceStatus(status);
          if (status.complete) {
            window.clearInterval(timer);
          }
        });
    }, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyFileResourceStatus, fileResourceStatus, reticulumFileResourceId]);
  useEffect(() => {
    if (!qchatFileTransfer) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [qchatFileTransfer]);
  useEffect(() => {
    if (fileResourceStatus !== 'downloading') return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [fileResourceStatus]);
  const reticulumExpiryMs = reticulumChatEnabled
    ? normalizeReticulumExpiryMs(message?.expiresAt)
    : null;
  useEffect(() => {
    if (!reticulumExpiryMs) return;
    const currentTime = Date.now();
    const nextBoundary =
      reticulumExpiryMs - currentTime > RETICULUM_EXPIRING_SOON_MS
        ? reticulumExpiryMs - RETICULUM_EXPIRING_SOON_MS
        : reticulumExpiryMs;
    const delay = nextBoundary - currentTime;
    if (delay <= 0) return;
    const timer = window.setTimeout(
      () => setExpiryClockMs(Date.now()),
      Math.min(delay + 50, 2_147_483_647)
    );
    return () => window.clearTimeout(timer);
  }, [expiryClockMs, reticulumExpiryMs]);
  useEffect(() => {
    if (fileResourceStatus !== 'downloading') return;
    const referenceAt = fileResourceLastChunkAt || fileResourceStartedAt;
    if (!referenceAt) return;
    if (Date.now() - referenceAt < RETICULUM_FILE_DOWNLOAD_STALL_MS) return;
    setFileResourceStatus('error');
  }, [
    fileResourceLastChunkAt,
    fileResourceStartedAt,
    fileResourceStatus,
    nowMs,
  ]);
  const fileResourceActivityText = (() => {
    if (fileResourceStatus !== 'downloading') return '';
    const referenceAt = fileResourceLastChunkAt || fileResourceStartedAt;
    if (!referenceAt) return 'waiting for first range';
    const ageSeconds = Math.max(0, Math.floor((nowMs - referenceAt) / 1000));
    const activeTransfers = Number(fileResourceRuntime?.activeTransfers || 0);
    const isReceivingBundle =
      Boolean(fileResourceRuntime?.active) && activeTransfers > 0;
    if (!fileResourceBytes?.received) {
      if (isReceivingBundle) {
        if ((fileResourceProgress ?? 0) > 0) return 'receiving first range';
        return `receiving first range ${ageSeconds}s`;
      }
      if (ageSeconds < 8) return 'requesting ranges';
      if (ageSeconds < 30) return `waiting for first range ${ageSeconds}s`;
      return `retrying / waiting for first range ${ageSeconds}s`;
    }
    if (ageSeconds < 8) return 'receiving';
    if (ageSeconds < 30) return `waiting ${ageSeconds}s`;
    return `retrying / waiting for peers ${ageSeconds}s`;
  })();
  const fileResourcePeerText = (() => {
    if (fileResourceStatus !== 'downloading' || !fileResourceRuntime?.active) {
      return '';
    }
    const peerCount = Number(fileResourceRuntime.peerCount || 0);
    const candidatePeerCount = Number(
      fileResourceRuntime.candidatePeerCount || 0
    );
    const advertisedPeerCount = Number(
      fileResourceRuntime.advertisedPeerCount || 0
    );
    const activeTransfers = Number(fileResourceRuntime.activeTransfers || 0);
    const pendingTransfers = Number(fileResourceRuntime.pendingTransfers || 0);
    const currentSpeedText = formatQchatFileSpeed(
      Number(fileResourceRuntime.currentBytesPerSecond || 0)
    );
    const averageSpeedText = formatQchatFileSpeed(
      Number(fileResourceRuntime.averageBytesPerSecond || 0)
    );
    const sourceCount = Math.max(peerCount, advertisedPeerCount);
    const peersText =
      sourceCount > 0
        ? `sources ${sourceCount}`
        : candidatePeerCount > 0
          ? `checking ${candidatePeerCount} peer${candidatePeerCount !== 1 ? 's' : ''}`
          : '';
    const transferParts: string[] = [];
    if (activeTransfers > 0) {
      transferParts.push(`${activeTransfers} active`);
    }
    if (pendingTransfers > 0) {
      transferParts.push(`${pendingTransfers} queued`);
    }
    const transfersText =
      transferParts.length > 0 ? `transfers ${transferParts.join(', ')}` : '';
    const speedText = currentSpeedText
      ? `speed ${currentSpeedText}`
      : averageSpeedText
        ? `avg ${averageSpeedText}`
        : '';
    return [peersText, transfersText, speedText].filter(Boolean).join(' · ');
  })();
  const fileResourceUnavailableNoPeers = (() => {
    if (
      (fileResourceStatus !== 'downloading' &&
        fileResourceStatus !== 'error') ||
      !fileResourceStartedAt ||
      nowMs - fileResourceStartedAt < RETICULUM_FILE_UNAVAILABLE_TIMEOUT_MS ||
      fileResourceBytes?.received
    ) {
      return false;
    }
    const runtime = fileResourceRuntime;
    if (!runtime?.active) return false;
    const providerCount = Math.max(
      Number(runtime.peerCount || 0),
      Number(runtime.advertisedPeerCount || 0)
    );
    const activeTransferCount =
      Number(runtime.activeTransfers || 0) +
      Number(runtime.pendingTransfers || 0) +
      Number(runtime.inFlightRangeCount || 0);
    return providerCount === 0 && activeTransferCount === 0;
  })();
  const fileResourceStatusText = (() => {
    if (fileResourceStatus === 'ready') return 'ready';
    if (fileResourceStatus === 'saving') return 'saving';
    if (fileResourceUnavailableNoPeers) {
      return 'file unavailable right now (no peers)';
    }
    if (fileResourceFailureReason === 'verification_failed') {
      return fileResourceStatus === 'error'
        ? 'file verification failed'
        : 'file verification failed · retrying';
    }
    if (fileResourceStatus === 'downloading') {
      if (fileResourceProgress === null) return 'downloading';
      const bytesText =
        fileResourceBytes && fileResourceBytes.total > 0
          ? `${formatQchatFileSize(fileResourceBytes.received)} / ${formatQchatFileSize(fileResourceBytes.total)}`
          : '';
      const details = [fileResourceActivityText, fileResourcePeerText]
        .filter(Boolean)
        .join(' · ');
      return `downloading ${fileResourceProgress}%${
        bytesText ? ` · ${bytesText}` : ''
      }${details ? ` · ${details}` : ''}`;
    }
    if (fileResourceStatus === 'error') {
      if (!fileResourceBytes?.received) return 'download failed';
      return `download paused at ${fileResourceProgress ?? 0}%`;
    }
    return 'not downloaded';
  })();
  const fileResourceStatusLabel = (() => {
    if (fileResourceStatus === 'ready') return 'Downloaded';
    if (fileResourceStatus === 'saving') return 'Saving...';
    if (fileResourceUnavailableNoPeers) return 'File unavailable';
    if (fileResourceFailureReason === 'verification_failed') {
      return 'Verification failed';
    }
    if (fileResourceStatus === 'error') return 'Download failed';
    if (fileResourceStatus === 'downloading') {
      return fileResourceProgress === null
        ? 'Downloading...'
        : `Downloading ${fileResourceProgress}%`;
    }
    return 'Not downloaded';
  })();
  const fileResourceActionLabel =
    fileResourceStatus === 'downloading' && !fileResourceUnavailableNoPeers
      ? 'Cancel'
      : fileResourceUnavailableNoPeers || fileResourceStatus === 'error'
        ? 'Try again'
        : fileResourceStatus === 'ready'
          ? 'Save'
          : fileResourceStatus === 'saving'
            ? 'Saving...'
            : 'Download';
  const fileResourceActionAriaLabel = `${fileResourceActionLabel} ${reticulumFileName}, ${formatQchatFileSize(
    reticulumFileSize
  )}`;
  const hasNoMessage =
    !qchatFileTransfer &&
    !reticulumDownloadAttachment &&
    (!message.decryptedData?.data?.message ||
      message.decryptedData?.data?.message === '<p></p>') &&
    (message?.images || [])?.length === 0 &&
    (!message?.messageText || message?.messageText === '<p></p>') &&
    (!message?.text || message?.text === '<p></p>');

  const isOwn = message?.sender === myAddress;
  // Phones get the familiar messenger layout where your own messages sit on the
  // right. Reply previews and system posts stay left so they read as context.
  const ownAligned =
    isOwn &&
    reticulumChatEnabled &&
    isMobileLayout &&
    !isShowingAsReply &&
    !isOfficialGroupSystem;
  // On phones the avatar joins the name/timestamp line instead of owning a
  // column, so the body can use the full row width underneath it.
  const mobileStackedLayout =
    reticulumChatEnabled && isMobileLayout && !isShowingAsReply;
  const avatarSizePx = mobileStackedLayout
    ? `${PHONE_MESSAGE_AVATAR_PX}px`
    : '38px';
  // Name + role badge on one line, timestamp tucked underneath. `display:
  // contents` leaves the desktop header as the single flat row it was.
  const headerMetaColumnSx = mobileStackedLayout
    ? {
        alignItems: ownAligned ? 'flex-end' : 'flex-start',
        display: 'flex',
        flexDirection: 'column',
        gap: '1px',
        minWidth: 0,
      }
    : { display: 'contents' };
  const headerInlineRowSx = mobileStackedLayout
    ? {
        alignItems: 'center',
        display: 'flex',
        flexDirection: ownAligned ? 'row-reverse' : 'row',
        gap: '6px',
        minWidth: 0,
      }
    : { display: 'contents' };
  const headerNameRowSx = headerInlineRowSx;
  const headerTimeRowSx = headerInlineRowSx;
  const mentionedAddresses = [
    ...(Array.isArray(message?.mentionedAddresses)
      ? message.mentionedAddresses
      : []),
    ...(Array.isArray(message?.decryptedData?.mentionedAddresses)
      ? message.decryptedData.mentionedAddresses
      : []),
    ...(Array.isArray(message?.decryptedData?.data?.mentionedAddresses)
      ? message.decryptedData.data.mentionedAddresses
      : []),
  ];
  const isCurrentUserMentioned =
    reticulumChatEnabled &&
    !isOwn &&
    Boolean(myAddress) &&
    (message?.reticulumChat
      ? message?.directMentionAuthorized === true ||
        message?.privilegedMentionAuthorized === true
      : mentionedAddresses.some(
          (address) => String(address).trim() === myAddress
        ));
  const isOwnReticulumDeletable =
    isOwn &&
    !isOfficialGroupSystem &&
    message?.reticulumChat &&
    typeof onDelete === 'function';
  const isOwnReticulumEditable = canEditOwnReticulumMessage({
    isOfficialGroupWelcome: isOfficialGroupSystem,
    message,
    myAddress,
  });
  const reticulumMessagePlainText = useMemo(
    () =>
      messageHtmlToPlainText(
        String(
          message?.decryptedData?.data?.message ??
            message?.messageText ??
            message?.text ??
            ''
        )
      ),
    [message]
  );
  const copyReticulumMessage = useCallback(async () => {
    if (!reticulumMessagePlainText || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(reticulumMessagePlainText);
  }, [reticulumMessagePlainText]);
  const [isSelectTextOpen, setIsSelectTextOpen] = useState(false);
  const [selectTextCopied, setSelectTextCopied] = useState(false);
  const selectTextBodyRef = useRef<HTMLDivElement | null>(null);

  // Copy whatever the reader highlighted; if they highlighted nothing, fall
  // back to the whole message so the button is never a dead end.
  const copySelectedMessageText = useCallback(async () => {
    const selected = String(window.getSelection?.() ?? '').trim();
    const text = selected || reticulumMessagePlainText;
    if (!text || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(text);
    setSelectTextCopied(true);
    window.setTimeout(() => setSelectTextCopied(false), 1500);
  }, [reticulumMessagePlainText]);

  // Pre-select the whole message so a reader only has to drag the handles in.
  useEffect(() => {
    if (!isSelectTextOpen) return;
    const node = selectTextBodyRef.current;
    if (!node) return;
    const frame = window.requestAnimationFrame(() => {
      const selection = window.getSelection?.();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isSelectTextOpen]);
  const [isOwnReticulumMessageHovered, setIsOwnReticulumMessageHovered] =
    useState(false);

  useEffect(() => {
    if (!isOwnReticulumMessageHovered || !isOwnReticulumDeletable) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Delete' ||
        !event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.repeat
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      onDelete(message);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isOwnReticulumDeletable,
    isOwnReticulumMessageHovered,
    message,
    onDelete,
  ]);

  const senderStatus = useStatus(message?.sender);
  const reticulumUserCard =
    reticulumChatEnabled && message?.sender && !isOfficialGroupSystem
      ? {
          address: message.sender,
          avatarUrl: userAvatarUrl,
          isMinterResolved: isReticulumMinterResolved && isUserInfoResolved,
          isOwn,
          minterLevel:
            isReticulumMinterResolved && isUserInfoResolved
              ? reticulumMinterLevel
              : undefined,
          name: message.senderName,
          onAvatarPreview: (event, src, placeholderSrc) =>
            handleAvatarPreview(event, src, false, placeholderSrc),
          role: reticulumMemberRole,
          roleColor: reticulumMemberRoleColor,
          status: senderStatus,
        }
      : undefined;
  const isRepliedToMe =
    reply?.sender === myAddress || replyExpiredMeta?.sender === myAddress;
  const isQchatFileOffer = qchatFileTransfer?.data?.status === 'offer';
  const displayTimestamp = reticulumChatEnabled
    ? (() => {
        const timestamp = Number(message?.timestamp);
        if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
        const timestampMs =
          timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
        const date = new Date(timestampMs);
        const now = new Date();
        const isToday =
          date.getFullYear() === now.getFullYear() &&
          date.getMonth() === now.getMonth() &&
          date.getDate() === now.getDate();
        const time = date.toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        });
        const minutesAgo = Math.max(
          0,
          Math.floor((Date.now() - timestampMs) / 60_000)
        );
        if (minutesAgo < 60) {
          return `${time} (${minutesAgo}min ago)`;
        }
        return isToday ? time : `${date.toLocaleDateString()} ${time}`;
      })()
    : formatTimestamp(message.timestamp);
  const hasReticulumDiscussion =
    reticulumChatEnabled && reticulumDiscussionReplyCount > 0;
  const collapseGroupedHeader = isGroupedWithPrevious;
  const reticulumExpiryText = formatReticulumExpiry(reticulumExpiryMs);
  const hasReticulumExpiry = Boolean(reticulumExpiryMs);
  const isReticulumExpiringSoon = Boolean(
    reticulumExpiryMs &&
    reticulumExpiryMs > expiryClockMs &&
    reticulumExpiryMs - expiryClockMs < RETICULUM_EXPIRING_SOON_MS
  );
  const reticulumExpiringSoonLabel = isReticulumExpiringSoon ? (
    <Tooltip title={`Message Expiry: ${reticulumExpiryText}`}>
      <Typography
        component="span"
        sx={{
          color: alpha(theme.palette.warning.main, 0.9),
          cursor: 'help',
          flexShrink: 0,
          fontSize: qchatMetaTextSize(9.5),
          fontWeight: 500,
          letterSpacing: '0.035em',
          lineHeight: 1,
          marginLeft: '6px',
          whiteSpace: 'nowrap',
        }}
      >
        (EXPIRING SOON)
      </Typography>
    </Tooltip>
  ) : null;
  // Own DM delivery state (Sending / Only on this phone / On your other
  // device / Delivered). Saved Messages and group posts show nothing. Only
  // engine-built lists qualify: a legacy Core DM payload can set these fields.
  const reticulumDeliveryGlyph =
    reticulumChatEnabled &&
    !isShowingAsReply &&
    !isTemp &&
    !isUpdating &&
    hasReticulumDmDeliveryState(message, myAddress) ? (
      <ReticulumDmDeliveryGlyph message={message} myAddress={myAddress} />
    ) : null;
  // A grouped message has no header row, so its labels trail the text.
  const collapsedTrailingContent =
    collapseGroupedHeader &&
    (reticulumExpiringSoonLabel || reticulumDeliveryGlyph) ? (
      <>
        {reticulumExpiringSoonLabel}
        {reticulumDeliveryGlyph}
      </>
    ) : null;
  const isReticulumDiscussionInitialPost =
    reticulumDiscussionView &&
    String(message?.signature || '') === reticulumDiscussionRootId;
  const showReplyPreview =
    !isReticulumDiscussionInitialPost &&
    (!reticulumDiscussionView ||
      String(message?.repliedTo || '') !== reticulumDiscussionRootId);
  // Phones size the reaction chips, the replies chip and the long-press menu
  // for fingers; reply previews keep their compact desktop look.
  const touchSizedChips = isMobileLayout && !isShowingAsReply;
  const chipSizes = getMessageActionSizes(touchSizedChips);
  // Buttons inside a message (file offers) get the same finger-sized height.
  const inMessageButtonSx = touchSizedChips
    ? {
        fontSize: '14px',
        minHeight: `${PHONE_MESSAGE_BUTTON_MIN_HEIGHT_PX}px`,
        padding: '6px 14px',
      }
    : {};
  // Only the desktop opens this menu; phones get MessageActionsPopup.
  const menuSizes = DESKTOP_MESSAGE_ACTION_SIZES;
  // The defaultValues keep English (not key names) on screen until the
  // locales carry this surface's new keys.
  const reticulumDiscussionLabel = t('group:message_item.view_replies', {
    count: reticulumDiscussionReplyCount,
    defaultValue: 'view {{count}} replies',
    defaultValue_one: 'view {{count}} reply',
    postProcess: 'capitalizeFirstChar',
  });
  const reticulumDiscussionAccent =
    theme.palette.mode === 'light' ? '#174ea6' : theme.palette.primary.main;
  const reticulumDiscussionChipSx = {
    alignItems: 'center',
    backgroundColor:
      theme.palette.mode === 'light'
        ? alpha('#174ea6', 0.14)
        : alpha(theme.palette.primary.main, 0.12),
    border:
      theme.palette.mode === 'light'
        ? '1px solid rgba(23, 78, 166, 0.24)'
        : '1px solid transparent',
    color: reticulumDiscussionAccent,
    display: 'inline-flex',
    flexShrink: 0,
    fontWeight: 700,
    justifyContent: 'center',
    lineHeight: 1,
    '&:hover': {
      backgroundColor:
        theme.palette.mode === 'light'
          ? alpha('#174ea6', 0.22)
          : alpha(theme.palette.primary.main, 0.2),
    },
  };
  // Phones show a labelled pill with the reaction chips, under the message;
  // the desktop keeps the small "+N" badge beside the timestamp.
  const reticulumDiscussionButton =
    hasReticulumDiscussion && onOpenReticulumDiscussion ? (
      touchSizedChips ? (
        <ButtonBase
          aria-label={reticulumDiscussionLabel}
          onClick={(event) => {
            event.stopPropagation();
            onOpenReticulumDiscussion(message);
          }}
          sx={{
            ...reticulumDiscussionChipSx,
            borderRadius: `${chipSizes.discussionChipHeightPx / 2}px`,
            fontSize: `${chipSizes.discussionChipFontPx}px`,
            gap: '6px',
            height: chipSizes.discussionChipHeightPx,
            minWidth: chipSizes.reactionChipMinWidthPx,
            padding: `0 ${chipSizes.reactionChipPaddingXPx + 2}px 0 ${chipSizes.reactionChipPaddingXPx}px`,
          }}
        >
          <ForumRoundedIcon aria-hidden="true" sx={{ fontSize: '18px' }} />
          {t('group:message_item.reply_count', {
            count: reticulumDiscussionReplyCount,
            defaultValue: '{{count}} replies',
            defaultValue_one: '{{count}} reply',
          })}
        </ButtonBase>
      ) : (
        <Tooltip
          title={reticulumDiscussionLabel}
          slotProps={{
            tooltip: {
              sx: {
                backgroundColor:
                  theme.palette.mode === 'light' ? '#f8fafc' : undefined,
                border:
                  theme.palette.mode === 'light'
                    ? '1px solid rgba(15, 23, 42, 0.16)'
                    : undefined,
                color: theme.palette.mode === 'light' ? '#111827' : undefined,
                fontWeight: 600,
              },
            },
          }}
        >
          <ButtonBase
            aria-label={reticulumDiscussionLabel}
            onClick={() => onOpenReticulumDiscussion(message)}
            sx={{
              ...reticulumDiscussionChipSx,
              borderRadius: '50%',
              fontSize: `${chipSizes.discussionChipFontPx}px`,
              height: chipSizes.discussionChipHeightPx,
              minWidth: chipSizes.discussionChipHeightPx,
              px: reticulumDiscussionReplyCount > 99 ? 0.5 : 0,
            }}
          >
            +{reticulumDiscussionReplyCount}
          </ButtonBase>
        </Tooltip>
      )
    ) : null;
  const hasVisibleReactions = Boolean(
    reactions &&
    Object.keys(reactions).some((r) => (reactions[r]?.length ?? 0) > 0)
  );
  // On phones the replies chip joins the reactions row instead of the header.
  const discussionChipInReactionsRow = Boolean(
    touchSizedChips && reticulumDiscussionButton
  );
  const discussionChipInHeader = Boolean(
    reticulumDiscussionButton && !discussionChipInReactionsRow
  );

  // What the phone popup offers. Threads show their messages read-only (the
  // host passes no-op handlers), so there only copying and the details make
  // sense. The long-press version adds Select text and the details card.
  const phoneActionsHold = phoneActions?.mode === 'hold';
  const phoneActionsInteractive = !reticulumDiscussionView;
  const capitalized = { postProcess: 'capitalizeFirstChar' } as const;
  const phoneActionCandidates: Array<
    MessageActionsPopupAction | false | undefined
  > = phoneActions
    ? [
        phoneActionsInteractive && {
          icon: <ReplyRoundedIcon />,
          key: 'reply',
          label: t('core:action.reply', capitalized),
          onSelect: () => onReply(message),
        },
        phoneActionsInteractive &&
          onOpenReticulumDiscussion && {
            icon: <ForumOutlinedIcon />,
            key: 'discussion',
            label:
              reticulumDiscussionReplyCount > 0
                ? reticulumDiscussionLabel
                : t('group:message_item.reply_in_discussion', capitalized),
            onSelect: () => onOpenReticulumDiscussion(message),
          },
        Boolean(reticulumMessagePlainText) && {
          icon: <ContentCopyRoundedIcon />,
          key: 'copy',
          label: t('core:action.copy', capitalized),
          onSelect: () => void copyReticulumMessage(),
        },
        phoneActionsHold &&
          Boolean(reticulumMessagePlainText) && {
            icon: <TextFieldsRoundedIcon />,
            key: 'select-text',
            label: t('group:message_item.select_text', capitalized),
            onSelect: () => {
              setSelectTextCopied(false);
              setIsSelectTextOpen(true);
            },
          },
        phoneActionsInteractive &&
          isOwnReticulumEditable && {
            icon: <EditOutlinedIcon />,
            key: 'edit',
            label: t('core:action.edit', capitalized),
            onSelect: () => onEdit(message),
          },
        phoneActionsInteractive &&
          isOwnReticulumDeletable && {
            destructive: true,
            icon: <DeleteOutlineRoundedIcon />,
            key: 'delete',
            label: t('core:action.delete', capitalized),
            onSelect: () => onDelete(message),
          },
      ]
    : [];
  const phoneMessageActions = phoneActionCandidates.filter(
    (action): action is MessageActionsPopupAction => Boolean(action)
  );
  // The row is typed loosely upstream; read the times through a narrow view.
  const messageTimes = message as unknown as
    | { editTimestamp?: unknown; isEdit?: unknown; timestamp?: unknown }
    | null
    | undefined;
  const phoneActionsSentAt = phoneActionsHold
    ? formatMessageDetailMoment(messageTimes?.timestamp)
    : '';
  const phoneActionsEditedAt =
    phoneActionsHold && messageTimes?.isEdit
      ? formatMessageDetailMoment(messageTimes?.editTimestamp)
      : '';
  const phoneActionDetails = phoneActionsHold ? (
    <>
      {phoneActionsSentAt && (
        <MessageActionsDetailRow
          icon={<ScheduleRoundedIcon />}
          label={t('group:message_item.sent', capitalized)}
          value={phoneActionsSentAt}
        />
      )}
      {phoneActionsEditedAt && (
        <MessageActionsDetailRow
          icon={<EditOutlinedIcon />}
          label={t('core:message.generic.edited', capitalized)}
          value={phoneActionsEditedAt}
        />
      )}
      {reticulumChatEnabled &&
        (hasReticulumExpiry ? (
          <MessageActionsDetailRow
            icon={<img alt="" src={messageExpiresIcon} />}
            label={t('group:message_item.message_expires', capitalized)}
            tone="warning"
            value={formatMessageDetailMoment(reticulumExpiryMs)}
          />
        ) : (
          <MessageActionsDetailRow
            icon={<img alt="" src={noExpiryIcon} />}
            label={t('reticulum:expiry.title', capitalized)}
            value={t('reticulum:expiry.no_expiry', capitalized)}
          />
        ))}
    </>
  ) : undefined;
  const myReactionEmojis = phoneActions
    ? Object.keys(reactions || {}).filter((emoji) =>
        reactions?.[emoji]?.some((item) => item?.sender === myAddress)
      )
    : [];

  if (shouldSuppressUnvalidatedGroupWelcome) return null;

  const avatarBlock = (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        gap: '4px',
        paddingTop: mobileStackedLayout ? 0 : '2px',
        // The phone avatar is drawn at 30px; a transparent ring on the tap
        // wrapper (the avatar itself clips overflow) makes it a 44px target.
        // It reaches less far down, so taps on the text below still open the
        // message actions.
        ...(mobileStackedLayout
          ? {
              '& > :first-of-type': { position: 'relative' },
              '& > :first-of-type::after': {
                content: '""',
                inset: `-${PHONE_AVATAR_HIT_SLOP_TOP_PX}px -${PHONE_AVATAR_HIT_SLOP_X_PX}px -${PHONE_AVATAR_HIT_SLOP_BOTTOM_PX}px`,
                position: 'absolute',
              },
            }
          : {}),
      }}
    >
      <WrapperUserAction
        disabled={
          isOfficialGroupSystem ||
          (!reticulumChatEnabled && myAddress === message?.sender)
        }
        address={message?.sender}
        name={message?.senderName}
        reticulumMenu={reticulumChatEnabled}
        reticulumSilenceContext={reticulumSilenceContext}
        reticulumUserCard={reticulumUserCard}
        trigger={reticulumChatEnabled ? 'contextMenu' : 'click'}
      >
        {isOfficialGroupSystem ? (
          <Avatar
            alt={displaySenderName}
            src={userAvatarUrl}
            sx={{
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: 0,
              boxShadow: 'none',
              color:
                theme.palette.mode === 'light'
                  ? theme.palette.primary.dark
                  : theme.palette.primary.light,
              fontSize: '15px',
              fontWeight: 700,
              height: avatarSizePx,
              overflow: 'visible',
              width: avatarSizePx,
              '& .MuiAvatar-img': {
                borderRadius: 0,
                objectFit: 'contain',
              },
            }}
          >
            {(officialGroupSystem?.groupName || 'G').charAt(0)}
          </Avatar>
        ) : reticulumMinterLevel !== null ? (
          <MinterAvatarOrnament
            accentColor={
              reticulumMemberRole ? reticulumMemberRoleColor : undefined
            }
            level={reticulumMinterLevel}
            size={mobileStackedLayout ? 'message-compact' : 'message'}
          >
            <PresenceStatusBadge
              online={Boolean(senderStatus)}
              status={senderStatus}
            >
              <Avatar
                sx={{
                  backgroundColor: alpha(theme.palette.text.primary, 0.06),
                  color: theme.palette.text.primary,
                  height: avatarSizePx,
                  width: avatarSizePx,
                  fontSize: '15px',
                  fontWeight: 600,
                  ...(!isAvatarLoaded ? getFallbackAvatarOutlineSx(theme) : {}),
                  ...getClickableAvatarSx(theme, isAvatarLoaded),
                }}
                alt={message?.senderName}
                src={userAvatarUrl}
                onClick={reticulumChatEnabled ? undefined : handleAvatarPreview}
                imgProps={{
                  onLoad: () => {
                    setIsAvatarLoaded(true);
                  },
                  onError: () => {
                    setIsAvatarLoaded(false);
                  },
                }}
              >
                {message?.senderName?.charAt(0)}
              </Avatar>
            </PresenceStatusBadge>
          </MinterAvatarOrnament>
        ) : (
          <PresenceStatusBadge
            online={Boolean(senderStatus)}
            status={senderStatus}
          >
            <Avatar
              sx={{
                backgroundColor: alpha(theme.palette.text.primary, 0.06),
                color: theme.palette.text.primary,
                height: avatarSizePx,
                width: avatarSizePx,
                fontSize: '15px',
                fontWeight: 600,
                ...(!isAvatarLoaded ? getFallbackAvatarOutlineSx(theme) : {}),
                ...getClickableAvatarSx(theme, isAvatarLoaded),
              }}
              alt={message?.senderName}
              src={userAvatarUrl}
              onClick={reticulumChatEnabled ? undefined : handleAvatarPreview}
              imgProps={{
                onLoad: () => {
                  setIsAvatarLoaded(true);
                },
                onError: () => {
                  setIsAvatarLoaded(false);
                },
              }}
            >
              {message?.senderName?.charAt(0)}
            </Avatar>
          </PresenceStatusBadge>
        )}
      </WrapperUserAction>
      {!reticulumChatEnabled && <UserBadge userInfo={userInfo} />}
    </Box>
  );

  // The desktop's hover bar in the header; phones use MessageActionsPopup.
  const renderMessageActionToolbar = () => {
    const toolbarSizes = DESKTOP_MESSAGE_ACTION_SIZES;
    const toolbarButtonSx = {
      borderRadius: '6px',
      flexShrink: 0,
      padding: '4px',
    };
    const toolbarGroupSx = {
      alignItems: 'center',
      display: 'flex',
      gap: '2px',
    };

    return (
      <Box
        className="message-item-toolbar"
        sx={{
          alignItems: 'center',
          backgroundColor: theme.palette.background.paper,
          border: '1px solid',
          borderColor: theme.palette.divider,
          borderRadius: '8px',
          boxShadow: theme.shadows[2],
          display: 'flex',
          flexShrink: 0,
          gap: '2px',
          padding: '3px 6px',
          transition: 'opacity 0.15s ease',
          zIndex: 2,
        }}
      >
        <Box sx={toolbarGroupSx}>
          {reticulumChatEnabled &&
            RETICULUM_QUICK_REACTIONS.map((emoji) => (
              <Tooltip
                key={emoji}
                title={t('group:message_item.react_with', {
                  defaultValue: 'react with {{emoji}}',
                  emoji,
                  postProcess: 'capitalizeFirstChar',
                })}
                disableFocusListener
              >
                <ButtonBase
                  aria-label={t('group:message_item.react_with', {
                    defaultValue: 'react with {{emoji}}',
                    emoji,
                    postProcess: 'capitalizeFirstChar',
                  })}
                  sx={{
                    ...toolbarButtonSx,
                    fontSize: `${toolbarSizes.toolbarEmojiPx}px`,
                    lineHeight: 1,
                    '&:hover': {
                      backgroundColor: theme.palette.action.hover,
                    },
                  }}
                  onClick={() => {
                    const hasReacted = reactions?.[emoji]?.some(
                      (item) => item?.sender === myAddress
                    );
                    handleReaction(emoji, message, !hasReacted);
                  }}
                >
                  {emoji}
                </ButtonBase>
              </Tooltip>
            ))}

          {handleReaction && (
            <ReactionPicker
              neutralIcon={reticulumChatEnabled}
              onReaction={(val) => {
                if (
                  reactions &&
                  reactions[val] &&
                  reactions[val]?.find((item) => item?.sender === myAddress)
                ) {
                  handleReaction(val, message, false);
                } else {
                  handleReaction(val, message, true);
                }
              }}
            />
          )}
        </Box>

        <Box sx={toolbarGroupSx}>
          {isOwnReticulumEditable && (
            <Tooltip
              title={t('core:action.edit', {
                postProcess: 'capitalizeFirstChar',
              })}
              disableFocusListener
            >
              <ButtonBase
                sx={{
                  ...toolbarButtonSx,
                  color: theme.palette.text.secondary,
                  '&:hover': {
                    backgroundColor: theme.palette.action.hover,
                    color: theme.palette.text.primary,
                  },
                }}
                onClick={() => {
                  onEdit(message);
                }}
              >
                <EditIcon
                  sx={{ fontSize: `${toolbarSizes.toolbarIconPx}px` }}
                />
              </ButtonBase>
            </Tooltip>
          )}

          <Tooltip
            title={t('core:action.reply', {
              postProcess: 'capitalizeFirstChar',
            })}
            disableFocusListener
          >
            <ButtonBase
              sx={{
                ...toolbarButtonSx,
                color: theme.palette.text.secondary,
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                  color: theme.palette.text.primary,
                },
              }}
              onClick={() => {
                onReply(message);
              }}
            >
              <ReplyIcon sx={{ fontSize: `${toolbarSizes.toolbarIconPx}px` }} />
            </ButtonBase>
          </Tooltip>

          {isOwnReticulumDeletable && (
            <Tooltip
              title={t('group:message_item.delete_shortcut')}
              disableFocusListener
            >
              <ButtonBase
                sx={{
                  ...toolbarButtonSx,
                  color: theme.palette.error.main,
                  '&:hover': {
                    backgroundColor: theme.palette.action.hover,
                    color: theme.palette.error.light,
                  },
                }}
                onClick={() => {
                  onDelete(message);
                }}
              >
                <DeleteOutlineIcon
                  sx={{ fontSize: `${toolbarSizes.toolbarIconPx}px` }}
                />
              </ButtonBase>
            </Tooltip>
          )}
        </Box>
      </Box>
    );
  };

  return (
    <>
      {message?.divide && (
        <div
          className={`unread-divider${reticulumChatEnabled ? ' reticulum-unread-divider' : ''}`}
          id="unread-divider-id"
        >
          {reticulumChatEnabled
            ? 'New messages'
            : t('core:message.generic.unread_messages', {
                postProcess: 'capitalizeFirstChar',
              })}
        </div>
      )}

      <MessageWragger
        lastMessage={lastSignature === message?.signature}
        isLast={isLast}
        onSeen={onSeenFunc}
      >
        <Box
          className="message-item-row"
          onContextMenu={
            reticulumChatEnabled
              ? (event) => {
                  if (!isEventFromRowItself(event)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  // Android also sends this for a long press: same popup.
                  if (isMobileLayout) {
                    openPhoneActions('hold', event.clientX, event.clientY);
                    return;
                  }
                  setReticulumMessageMenuPosition({
                    mouseX: event.clientX + 2,
                    mouseY: event.clientY - 6,
                  });
                }
              : undefined
          }
          {...(reticulumChatEnabled
            ? {
                ...messageRowLongPress,
                onTouchStart: (event: React.TouchEvent) => {
                  if (isEventFromRowItself(event)) {
                    messageRowLongPress.onTouchStart(event);
                  }
                },
              }
            : {})}
          onClick={
            reticulumChatEnabled && isMobileLayout && !isShowingAsReply
              ? handleMobileActionsTap
              : undefined
          }
          onMouseEnter={
            isOwnReticulumDeletable
              ? () => setIsOwnReticulumMessageHovered(true)
              : undefined
          }
          onMouseLeave={
            isOwnReticulumDeletable
              ? () => setIsOwnReticulumMessageHovered(false)
              : undefined
          }
          sx={{
            display: 'flex',
            flexDirection: mobileStackedLayout
              ? 'column'
              : ownAligned
                ? 'row-reverse'
                : 'row',
            gap: mobileStackedLayout
              ? 0
              : reticulumChatEnabled
                ? '10px'
                : '12px',
            opacity: isTemp || isUpdating ? 0.5 : 1,
            padding: isShowingAsReply
              ? '2px 8px'
              : reticulumChatEnabled
                ? isGroupedWithPrevious
                  ? '1px 14px 2px'
                  : '5px 14px 6px'
                : '8px 16px 10px',
            marginBottom: isShowingAsReply
              ? 0
              : reticulumChatEnabled
                ? 0
                : '3px',
            position: 'relative',
            transition: 'background-color 0.1s ease',
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
            ...(isOfficialGroupSystem && {
              backgroundColor: alpha(theme.palette.primary.main, 0.085),
              boxShadow: `inset 3px 0 0 ${alpha(
                theme.palette.primary.main,
                0.9
              )}`,
            }),
            ...(isCurrentUserMentioned && {
              backgroundColor: alpha(theme.palette.warning.main, 0.06),
              boxShadow: `inset 3px 0 0 ${theme.palette.warning.main}`,
            }),
            ...(isOwn &&
              reticulumChatEnabled &&
              highlightOwnReticulumMessages &&
              !isOfficialGroupSystem &&
              !isScrollTarget && {
                backgroundColor: alpha(
                  theme.palette.mode === 'dark'
                    ? theme.palette.common.white
                    : theme.palette.common.black,
                  theme.palette.mode === 'dark' ? 0.028 : 0.025
                ),
                borderRadius: '18px',
              }),
            ...(isOwn &&
              !reticulumChatEnabled &&
              !isScrollTarget && {
                backgroundColor: alpha(theme.palette.primary.main, 0.045),
                ...(!reticulumChatEnabled
                  ? {
                      borderLeft: `2px solid ${alpha(theme.palette.primary.main, 0.5)}`,
                      paddingLeft: '14px',
                    }
                  : {}),
              }),
            ...(!isOwn &&
              !reticulumChatEnabled &&
              !isScrollTarget && {
                borderLeft: `2px solid ${alpha(theme.palette.text.secondary, 0.35)}`,
                paddingLeft: '14px',
              }),
            ...(isScrollTarget && {
              backgroundColor: alpha(theme.palette.primary.main, 0.07),
              ...(isOwn && reticulumChatEnabled
                ? { borderRadius: '18px' }
                : {}),
              ...(!reticulumChatEnabled
                ? {
                    borderLeft: `2px solid ${theme.palette.primary.main}`,
                    paddingLeft: '14px',
                  }
                : {}),
            }),
            ...(!isShowingAsReply && {
              // Touch devices toggle the bar explicitly; emulated hover would
              // otherwise leave it stuck open after the first tap.
              ...(isMobileLayout
                ? {}
                : {
                    '& .message-item-toolbar': {
                      opacity: 0,
                      pointerEvents: 'none',
                    },
                    '&:hover .message-item-toolbar': {
                      opacity: 1,
                      pointerEvents: 'auto',
                    },
                  }),
              '&:hover': {
                backgroundColor: reticulumChatEnabled
                  ? isOfficialGroupSystem || isCurrentUserMentioned
                    ? isCurrentUserMentioned
                      ? alpha(theme.palette.warning.main, 0.1)
                      : alpha(theme.palette.primary.main, 0.14)
                    : isOwn && highlightOwnReticulumMessages
                      ? alpha(
                          theme.palette.mode === 'dark'
                            ? theme.palette.common.white
                            : theme.palette.common.black,
                          theme.palette.mode === 'dark' ? 0.045 : 0.04
                        )
                      : alpha(theme.palette.text.primary, 0.035)
                  : undefined,
              },
            }),
            // The message the open popup belongs to.
            ...(phoneActionsOpen && {
              backgroundColor: alpha(theme.palette.primary.main, 0.12),
              '&:hover': {
                backgroundColor: alpha(theme.palette.primary.main, 0.12),
              },
            }),
          }}
          id={message?.signature}
        >
          {/* Left column: avatar + badge (phones move this into the header) */}
          {isShowingAsReply ? (
            <ReplyIcon
              sx={{
                color: theme.palette.text.secondary,
                flexShrink: 0,
                fontSize: '18px',
                mt: '2px',
              }}
            />
          ) : mobileStackedLayout ? null : isGroupedWithPrevious ? (
            <Box
              sx={{
                flexShrink: 0,
                width: reticulumMinterLevel !== null ? '44px' : '38px',
              }}
            />
          ) : (
            avatarBlock
          )}

          {/* Right column: header + body + reactions */}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: isGroupedWithPrevious
                ? 0
                : mobileStackedLayout
                  ? '2px'
                  : '4px',
              height: isShowingAsReply ? '40px' : undefined,
              minWidth: 0,
              width: '100%',
              // Blocks hug the right edge, but text inside them stays
              // left-aligned so long messages remain readable.
              ...(ownAligned ? { alignItems: 'flex-end' } : {}),
            }}
          >
            {/* Header: sender name + timestamp + edited label inline, toolbar on the right */}
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                justifyContent: 'space-between',
                height: collapseGroupedHeader ? 0 : undefined,
                minHeight: collapseGroupedHeader
                  ? 0
                  : mobileStackedLayout
                    ? '26px'
                    : '32px',
                overflow: collapseGroupedHeader ? 'visible' : undefined,
                ...(ownAligned
                  ? {
                      flexDirection: 'row-reverse',
                      width: '100%',
                    }
                  : {}),
                ...(collapseGroupedHeader
                  ? {
                      alignSelf: ownAligned ? 'flex-start' : 'flex-end',
                      position: 'absolute',
                      ...(ownAligned ? { left: '14px' } : { right: '14px' }),
                      top: '1px',
                      width: 'auto',
                      zIndex: 3,
                    }
                  : {}),
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: mobileStackedLayout ? '7px' : '8px',
                  minWidth: 0,
                  display: collapseGroupedHeader ? 'none' : 'flex',
                  // Own messages put the avatar on the outer right edge.
                  ...(ownAligned ? { flexDirection: 'row-reverse' } : {}),
                }}
              >
                {mobileStackedLayout && !isGroupedWithPrevious && avatarBlock}
                {/* On phones the name and its role badge sit on one line with
                    the timestamp tucked underneath; `display: contents` keeps
                    the desktop header a single flat row. */}
                <Box sx={headerMetaColumnSx}>
                  <Box sx={headerNameRowSx}>
                    <WrapperUserAction
                      disabled={
                        isOfficialGroupSystem ||
                        (!reticulumChatEnabled && myAddress === message?.sender)
                      }
                      address={message?.sender}
                      name={message?.senderName}
                      reticulumMenu={reticulumChatEnabled}
                      reticulumSilenceContext={reticulumSilenceContext}
                      reticulumUserCard={reticulumUserCard}
                      trigger={reticulumChatEnabled ? 'contextMenu' : 'click'}
                    >
                      <Typography
                        sx={{
                          color: reticulumChatEnabled
                            ? isOfficialGroupSystem
                              ? theme.palette.mode === 'light'
                                ? theme.palette.primary.dark
                                : theme.palette.primary.light
                              : reticulumMemberRoleColor
                            : isOwn
                              ? theme.palette.primary.main
                              : theme.palette.text.primary,
                          fontFamily: 'Inter',
                          fontSize: qchatTextSize(
                            reticulumDiscussionView ? 18 : 15.5
                          ),
                          fontWeight: reticulumDiscussionView ? 700 : 600,
                          lineHeight: reticulumDiscussionView
                            ? qchatTextSize(22)
                            : 1.3,
                          letterSpacing: reticulumDiscussionView
                            ? '-0.015em'
                            : undefined,
                          maxWidth: reticulumChatEnabled
                            ? { xs: 170, sm: 260, md: 360 }
                            : undefined,
                          overflow: reticulumChatEnabled ? 'hidden' : undefined,
                          textOverflow: reticulumChatEnabled
                            ? 'ellipsis'
                            : undefined,
                          whiteSpace: reticulumChatEnabled
                            ? 'nowrap'
                            : undefined,
                          ...(hasUnsafeSenderName
                            ? {
                                textDecorationLine: 'line-through',
                                textDecorationThickness: '2px',
                                textDecorationColor: theme.palette.error.main,
                              }
                            : {}),
                        }}
                      >
                        {displaySenderName}
                      </Typography>
                    </WrapperUserAction>

                    {reticulumChatEnabled &&
                      !isOfficialGroupSystem &&
                      reticulumMemberRole && (
                        <ReticulumRoleBadge
                          color={reticulumMemberRoleColor}
                          role={reticulumMemberRole}
                          size={reticulumDiscussionView ? 'card' : 'message'}
                        />
                      )}
                  </Box>
                  <Box sx={headerTimeRowSx}>
                    {!isUpdating && !isTemp && (
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          flexShrink: 0,
                          fontFamily: 'Inter',
                          fontSize: qchatMetaTextSize(
                            reticulumDiscussionView ? 13 : 11
                          ),
                          fontWeight: reticulumDiscussionView ? 400 : undefined,
                          lineHeight: reticulumDiscussionView
                            ? qchatMetaTextSize(18)
                            : 1,
                        }}
                      >
                        {displayTimestamp}
                      </Typography>
                    )}

                    {!collapseGroupedHeader && reticulumDeliveryGlyph}

                    {!collapseGroupedHeader && reticulumExpiringSoonLabel}

                    {!collapseGroupedHeader &&
                      discussionChipInHeader &&
                      reticulumDiscussionButton}

                    {message?.isEdit && !isUpdating && !isTemp && (
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          fontFamily: 'Inter',
                          fontSize: qchatMetaTextSize(11),
                          fontStyle: 'italic',
                          lineHeight: 1,
                        }}
                      >
                        {t('core:message.generic.edited', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                    )}
                  </Box>
                </Box>
              </Box>

              {/* Desktop hover toolbar stays in the header row. Phones get
                  MessageActionsPopup from a tap or a long press instead. */}
              {!isShowingAsReply &&
                !reticulumDiscussionView &&
                !isMobileLayout &&
                renderMessageActionToolbar()}
            </Box>

            {/* Reply preview - active reply */}
            {showReplyPreview && reply && (
              <ButtonBase
                className={
                  reticulumChatEnabled
                    ? 'reticulum-inline-reply-card'
                    : undefined
                }
                sx={{
                  borderLeft: reticulumChatEnabled
                    ? `4px solid ${theme.palette.warning.main}`
                    : isRepliedToMe
                      ? `2px solid ${theme.palette.warning.main}`
                      : `2px solid ${alpha(theme.palette.primary.main, 0.5)}`,
                  backgroundColor: reticulumChatEnabled
                    ? theme.palette.mode === 'dark'
                      ? '#17181d'
                      : theme.palette.background.paper
                    : isRepliedToMe
                      ? alpha(theme.palette.warning.main, 0.06)
                      : 'transparent',
                  borderRadius: reticulumChatEnabled ? '9px' : '0 6px 6px 0',
                  ...(reticulumChatEnabled
                    ? {
                        borderBottom: `1px solid ${alpha(theme.palette.divider, 0.72)}`,
                        borderRight: `1px solid ${alpha(theme.palette.divider, 0.72)}`,
                        borderTop: `1px solid ${alpha(theme.palette.divider, 0.72)}`,
                      }
                    : {}),
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'row',
                  justifyContent: 'flex-start',
                  marginTop: reticulumChatEnabled ? '5px' : '4px',
                  marginBottom: reticulumChatEnabled ? '8px' : '6px',
                  marginLeft: '2px',
                  height:
                    !reticulumChatEnabled && isRepliedToMe ? '72px' : undefined,
                  // Two lines of the reply's text under its header, at the
                  // chat's text size.
                  maxHeight: reticulumChatEnabled ? qchatTextSize(92) : '72px',
                  minHeight: reticulumChatEnabled
                    ? qchatTextSize(72)
                    : undefined,
                  minWidth: reticulumChatEnabled ? 'min(540px, 100%)' : 0,
                  maxWidth: '100%',
                  overflow: 'hidden',
                  padding: reticulumChatEnabled
                    ? '10px 100px 10px 14px'
                    : '4px 0 4px 10px',
                  position: 'relative',
                  textAlign: 'left',
                  transition:
                    'background-color 0.15s ease, border-color 0.15s ease, opacity 0.1s ease',
                  width: reticulumChatEnabled ? 'fit-content' : 'auto',
                  alignSelf: reticulumChatEnabled ? 'flex-start' : 'stretch',
                  boxSizing: 'border-box',
                  opacity: reticulumChatEnabled ? 1 : isRepliedToMe ? 1 : 0.72,
                  '& *': {
                    cursor: 'pointer',
                  },
                  '&:hover': {
                    opacity: 1,
                    ...(reticulumChatEnabled
                      ? {
                          backgroundColor: alpha(
                            theme.palette.text.primary,
                            theme.palette.mode === 'dark' ? 0.055 : 0.035
                          ),
                          borderColor: alpha(theme.palette.warning.main, 0.36),
                        }
                      : {}),
                  },
                }}
                onClick={() => {
                  scrollToItem(replyIndex);
                }}
              >
                {reticulumChatEnabled && (
                  <FormatQuoteRoundedIcon
                    aria-hidden
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.7),
                      fontSize: '24px',
                      position: 'absolute',
                      right: 16,
                      top: 10,
                    }}
                  />
                )}
                <Box sx={{ minWidth: 0, overflow: 'hidden', width: '100%' }}>
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: '6px',
                      marginBottom: '2px',
                    }}
                  >
                    <ReplyIcon
                      sx={{
                        color: isRepliedToMe
                          ? theme.palette.warning.main
                          : theme.palette.mode === 'light'
                            ? theme.palette.text.primary
                            : theme.palette.primary.main,
                        fontSize: reticulumChatEnabled
                          ? qchatTextSize(17)
                          : '14px',
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      sx={{
                        color: isRepliedToMe
                          ? theme.palette.warning.main
                          : theme.palette.mode === 'light'
                            ? theme.palette.text.primary
                            : theme.palette.primary.main,
                        fontSize: reticulumChatEnabled
                          ? qchatTextSize(14)
                          : '13px',
                        fontWeight: reticulumChatEnabled
                          ? 650
                          : isRepliedToMe
                            ? 600
                            : 500,
                        ...(hasUnsafeReplyName
                          ? {
                              textDecorationLine: 'line-through',
                              textDecorationThickness: '2px',
                              textDecorationColor: theme.palette.error.main,
                            }
                          : {}),
                      }}
                    >
                      {reticulumChatEnabled
                        ? isRepliedToMe
                          ? 'Replying to you'
                          : `Replying to ${
                              reply?.senderName ||
                              reply?.senderAddress ||
                              'message'
                            }`
                        : isRepliedToMe
                          ? t('core:message.generic.replied_to_you', {
                              postProcess: 'capitalizeFirstChar',
                            })
                          : t('core:message.generic.replied_to', {
                              person: reply?.senderName || reply?.senderAddress,
                              postProcess: 'capitalizeFirstChar',
                            })}
                    </Typography>
                  </Box>

                  {htmlReply ? (
                    <MessageDisplay
                      isReply
                      htmlContent={htmlReply}
                      privilegedMentionAuthorized={
                        reply?.privilegedMentionAuthorized === true
                      }
                      reticulumChannelLinkAccess={reticulumChannelLinkAccess}
                    />
                  ) : reply?.decryptedData?.type === 'notification' ? (
                    <MessageDisplay
                      isReply
                      htmlContent={reply.decryptedData?.data?.message}
                      privilegedMentionAuthorized={
                        reply?.privilegedMentionAuthorized === true
                      }
                      reticulumChannelLinkAccess={reticulumChannelLinkAccess}
                    />
                  ) : reply?.text ? (
                    <MessageDisplay
                      isReply
                      htmlContent={reply.text}
                      privilegedMentionAuthorized={
                        reply?.privilegedMentionAuthorized === true
                      }
                      reticulumChannelLinkAccess={reticulumChannelLinkAccess}
                    />
                  ) : null}
                </Box>
              </ButtonBase>
            )}

            {/* Reply preview - expired/missing reply */}
            {showReplyPreview &&
              !reply &&
              (replyExpiredMeta || message?.repliedTo) && (
                <Box
                  sx={{
                    borderLeft: isRepliedToMe
                      ? `2px solid ${theme.palette.warning.main}`
                      : `2px solid ${alpha(theme.palette.text.secondary, 0.4)}`,
                    backgroundColor: isRepliedToMe
                      ? alpha(theme.palette.warning.main, 0.06)
                      : 'transparent',
                    borderRadius: '0 6px 6px 0',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'row',
                    marginTop: '4px',
                    marginBottom: '6px',
                    marginLeft: '2px',
                    height: isRepliedToMe ? '72px' : undefined,
                    maxHeight: '72px',
                    minWidth: 0,
                    overflow: 'hidden',
                    padding: '4px 0 4px 10px',
                    width: 'auto',
                    alignSelf: 'stretch',
                    boxSizing: 'border-box',
                    opacity: isRepliedToMe ? 1 : 0.6,
                    '& *': {
                      cursor: 'pointer',
                    },
                  }}
                >
                  <Box sx={{ minWidth: 0, overflow: 'hidden', width: '100%' }}>
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        gap: '6px',
                        marginBottom: '2px',
                      }}
                    >
                      <ReplyIcon
                        sx={{
                          color:
                            theme.palette.mode === 'light'
                              ? theme.palette.text.primary
                              : theme.palette.text.secondary,
                          fontSize: qchatTextSize(14),
                          flexShrink: 0,
                        }}
                      />
                      <Typography
                        sx={{
                          color:
                            theme.palette.mode === 'light'
                              ? theme.palette.text.primary
                              : theme.palette.text.secondary,
                          fontSize: qchatTextSize(13),
                          fontWeight: 500,
                          ...(hasUnsafeExpiredReplyName
                            ? {
                                textDecorationLine: 'line-through',
                                textDecorationThickness: '2px',
                                textDecorationColor: theme.palette.error.main,
                              }
                            : {}),
                        }}
                      >
                        {replyExpiredMeta?.deleted === true
                          ? t(
                              'core:message.generic.replied_to_deleted_message',
                              {
                                defaultValue: 'Replied to deleted message',
                              }
                            )
                          : replyExpiredMeta?.senderName ||
                              replyExpiredMeta?.sender
                            ? t('core:message.generic.replied_to', {
                                person:
                                  replyExpiredMeta?.senderName ||
                                  replyExpiredMeta?.sender,
                                postProcess: 'capitalizeFirstChar',
                              })
                            : t('core:message.generic.replied_to', {
                                person: t('core:message.error.missing_fields', {
                                  fields: t('core:message.message'),
                                }),
                                postProcess: 'capitalizeFirstChar',
                              })}
                      </Typography>
                    </Box>

                    {htmlReplyExpired ? (
                      <MessageDisplay
                        isReply
                        htmlContent={htmlReplyExpired}
                        reticulumChannelLinkAccess={reticulumChannelLinkAccess}
                      />
                    ) : replyExpiredMeta?.text ? (
                      <MessageDisplay
                        isReply
                        htmlContent={replyExpiredMeta.text}
                        reticulumChannelLinkAccess={reticulumChannelLinkAccess}
                      />
                    ) : null}
                  </Box>
                </Box>
              )}

            {reticulumChatEnabled && reticulumInviteSource && (
              <>
                <ReticulumGroupInvitePreviews source={reticulumInviteSource} />
                <ReticulumQAppLinkPreviews source={reticulumInviteSource} />
              </>
            )}
            <ReticulumEventLinkPreviews source={deferredMessage} />

            {/* Message body - show only one of htmlText or message.text to avoid duplicate for open groups */}
            {qchatFileTransfer ? (
              <Box
                sx={{
                  alignItems: 'center',
                  border: '1px solid',
                  borderColor: theme.palette.divider,
                  borderRadius: '8px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '10px',
                  maxWidth: 420,
                  p: 1.25,
                }}
              >
                <InsertDriveFileRoundedIcon
                  sx={{ color: theme.palette.text.secondary, flexShrink: 0 }}
                />
                <Box sx={{ minWidth: 0, flex: '1 1 140px' }}>
                  <Typography
                    component="div"
                    sx={{
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    <FileNameWithExtension
                      name={qchatFileData?.fileName}
                      fallback={t('core:file_transfer.file_transfer_fallback')}
                    />
                  </Typography>
                  <Typography
                    sx={{
                      color: qchatTransferError
                        ? theme.palette.error.main
                        : theme.palette.text.secondary,
                      fontSize: 12,
                    }}
                  >
                    {formatQchatFileSize(qchatFileData?.size)} ·{' '}
                    {qchatReceivedGone
                      ? t('core:file_transfer.received_file_removed')
                      : qchatStatusText}
                  </Typography>
                  {qchatReceivedActionsEnabled &&
                    !isOwn &&
                    qchatReceived.state === 'present' &&
                    isPrivateReceivedChatFile(qchatReceivedFile) && (
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: 11,
                          mt: 0.25,
                        }}
                      >
                        {t('core:file_transfer.received_private_hint')}
                      </Typography>
                    )}
                  {qchatExpiryText && (
                    <Typography
                      sx={{
                        color:
                          qchatMsLeft === 0
                            ? theme.palette.error.main
                            : theme.palette.text.secondary,
                        fontSize: 11,
                        mt: 0.25,
                      }}
                    >
                      expires: {qchatExpiryText}
                    </Typography>
                  )}
                  {(qchatProgress !== null ||
                    qchatTransferBusy ||
                    (qchatTransferDone && !qchatDownloaded)) &&
                    !qchatTransferError && (
                      <LinearProgress
                        variant={
                          qchatProgress !== null
                            ? 'determinate'
                            : 'indeterminate'
                        }
                        value={
                          qchatTransferDone ? 100 : (qchatProgress ?? undefined)
                        }
                        color="primary"
                        sx={{
                          mt: 0.75,
                          height: 4,
                          borderRadius: 1,
                        }}
                      />
                    )}
                </Box>
                {!isOwn &&
                  isQchatFileOffer &&
                  onAcceptQchatFileTransfer &&
                  (qchatReceivedActionsEnabled ? (
                    qchatReceivedGone ? null : (
                      <Box
                        sx={{
                          display: 'flex',
                          flexShrink: 0,
                          gap: 1,
                          marginLeft: 'auto',
                        }}
                      >
                        {/* An app package is saved but never opened: only
                            GO's own updater installs apps. */}
                        {!qchatReceived.isPackage && (
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={
                              qchatReceived.busy === 'open' ? (
                                <CircularProgress size={14} color="inherit" />
                              ) : (
                                <OpenInNewRoundedIcon />
                              )
                            }
                            disabled={qchatReceived.busy !== null}
                            onClick={() => void qchatReceived.open()}
                            sx={{
                              flexShrink: 0,
                              textTransform: 'none',
                              ...inMessageButtonSx,
                            }}
                          >
                            {t('core:file_transfer.open')}
                          </Button>
                        )}
                        <Button
                          size="small"
                          variant="outlined"
                          color="inherit"
                          startIcon={
                            qchatReceived.busy === 'save' ? (
                              <CircularProgress size={14} color="inherit" />
                            ) : (
                              <SaveAltRoundedIcon />
                            )
                          }
                          disabled={qchatReceived.busy !== null}
                          onClick={() => void qchatReceived.save()}
                          sx={{
                            flexShrink: 0,
                            textTransform: 'none',
                            ...inMessageButtonSx,
                          }}
                        >
                          {t('core:file_transfer.save_to_device')}
                        </Button>
                      </Box>
                    )
                  ) : (
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<DownloadRoundedIcon />}
                      disabled={
                        qchatTransferBusy ||
                        qchatTransferDone ||
                        qchatOfferExpired
                      }
                      onClick={() => onAcceptQchatFileTransfer(message)}
                      sx={{
                        flexShrink: 0,
                        textTransform: 'none',
                        ...inMessageButtonSx,
                      }}
                    >
                      {qchatDownloaded
                        ? t('core:file_transfer.downloaded', {
                            defaultValue: 'Downloaded',
                          })
                        : qchatOfferExpired
                          ? t('core:file_transfer.offer_expired', {
                              defaultValue: 'Expired',
                            })
                          : t('core:action.accept', {
                              postProcess: 'capitalizeFirstChar',
                            })}
                    </Button>
                  ))}
              </Box>
            ) : message?.decryptedData?.type === 'notification' ? (
              <MessageDisplay
                fitContent={ownAligned}
                htmlContent={message.decryptedData?.data?.message}
                trailingContent={collapsedTrailingContent}
                mentionedAddresses={mentionedAddresses}
                mentionUsers={reticulumMentionUsers}
                myAddress={myAddress}
                privilegedMentionAuthorized={
                  message?.privilegedMentionAuthorized === true
                }
                reticulumChannelLinkAccess={reticulumChannelLinkAccess}
              />
            ) : hasNoMessage ? null : htmlText ? (
              <MessageDisplay
                fitContent={ownAligned}
                htmlContent={htmlText}
                trailingContent={collapsedTrailingContent}
                hiddenQortalUrls={reticulumHiddenPreviewLinks}
                mentionedAddresses={mentionedAddresses}
                mentionUsers={reticulumMentionUsers}
                myAddress={myAddress}
                privilegedMentionAuthorized={
                  message?.privilegedMentionAuthorized === true
                }
                reticulumChannelLinkAccess={reticulumChannelLinkAccess}
                textColor={
                  isOfficialGroupSystem
                    ? theme.palette.mode === 'light'
                      ? theme.palette.primary.dark
                      : theme.palette.primary.light
                    : undefined
                }
              />
            ) : (
              <MessageDisplay
                fitContent={ownAligned}
                htmlContent={message.text}
                trailingContent={collapsedTrailingContent}
                hiddenQortalUrls={reticulumHiddenPreviewLinks}
                mentionedAddresses={mentionedAddresses}
                mentionUsers={reticulumMentionUsers}
                myAddress={myAddress}
                privilegedMentionAuthorized={
                  message?.privilegedMentionAuthorized === true
                }
                reticulumChannelLinkAccess={reticulumChannelLinkAccess}
                textColor={
                  isOfficialGroupSystem
                    ? theme.palette.mode === 'light'
                      ? theme.palette.primary.dark
                      : theme.palette.primary.light
                    : undefined
                }
              />
            )}

            {hasNoMessage && (
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: '8px',
                }}
              >
                <CommentsDisabledIcon
                  color="primary"
                  sx={{ fontSize: '18px' }}
                />
                <Typography
                  color="primary"
                  sx={{ fontSize: qchatTextSize(14) }}
                >
                  {t('core:message.generic.no_message', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Box>
            )}

            {libraryGifImage ? (
              <Box
                onClick={(event) =>
                  void openLibraryGifViewer(
                    event.currentTarget.closest<HTMLElement>(
                      '[data-reticulum-chat-root="true"]'
                    )
                  )
                }
                sx={{
                  alignSelf: ownAligned ? 'flex-end' : 'flex-start',
                  cursor: 'zoom-in',
                  display: 'flex',
                  margin: '8px 0 0',
                  maxWidth: 'min(100%, 240px)',
                }}
              >
                <GifImage
                  fit="contain"
                  gif={libraryGifImage}
                  spinnerSize={20}
                  sx={{
                    borderRadius: '8px',
                    maxHeight: 280,
                    maxWidth: '100%',
                  }}
                />
              </Box>
            ) : (
              (displayImageUrl ||
                (isReticulumResourceImage &&
                  shouldAutoDownloadReticulumImage)) &&
              (displayImageUrl &&
              (localResourceImageUrl ||
                displayImageUrl.startsWith('data:image/')) ? (
                <Box
                  sx={{
                    aspectRatio: imageResourceAspectRatio,
                    alignSelf: ownAligned ? 'flex-end' : 'flex-start',
                    borderRadius: '8px',
                    contain: 'layout paint',
                    isolation: 'isolate',
                    margin: '8px 0 0',
                    overflow: 'hidden',
                    width: `min(100%, ${imageResourceDisplayWidth}px)`,
                  }}
                >
                  <Box
                    component="img"
                    src={displayImageUrl}
                    alt={reticulumImageFileName}
                    loading="lazy"
                    decoding="async"
                    onClick={(event) => {
                      if (canOpenReticulumImage) {
                        void openReticulumImageViewer(
                          event.currentTarget.closest(
                            '[data-reticulum-chat-root="true"]'
                          ) as HTMLElement | null
                        );
                      }
                    }}
                    onError={() => {
                      if (!isReticulumResourceImage || !localResourceImageUrl)
                        return;
                      setLocalResourceImageUrl(null);
                      setResourceReloadNonce((value) => value + 1);
                    }}
                    onLoad={(event) => {
                      const width = Number(
                        event.currentTarget.naturalWidth || 0
                      );
                      const height = Number(
                        event.currentTarget.naturalHeight || 0
                      );
                      if (
                        !Number.isFinite(width) ||
                        !Number.isFinite(height) ||
                        width <= 0 ||
                        height <= 0
                      ) {
                        return;
                      }
                      setLoadedResourceImageSize((previous) =>
                        previous?.width === width && previous?.height === height
                          ? previous
                          : { width, height }
                      );
                    }}
                    sx={{
                      cursor: canOpenReticulumImage ? 'pointer' : 'default',
                      display: 'block',
                      height: '100%',
                      objectFit: 'contain',
                      width: '100%',
                    }}
                  />
                </Box>
              ) : imageEmbedLink ? (
                <Embed embedLink={imageEmbedLink} />
              ) : isReticulumResourceImage &&
                shouldAutoDownloadReticulumImage ? (
                <Box
                  sx={{
                    alignItems: 'center',
                    aspectRatio: imageResourceAspectRatio,
                    backgroundColor: alpha(theme.palette.text.primary, 0.045),
                    border: '1px solid',
                    borderColor: alpha(theme.palette.text.primary, 0.08),
                    borderRadius: '8px',
                    color: theme.palette.text.secondary,
                    display: 'flex',
                    justifyContent: 'center',
                    marginTop: '8px',
                    maxHeight: 360,
                    minHeight: 96,
                    overflow: 'hidden',
                    position: 'relative',
                    width: `min(100%, ${imageResourceDisplayWidth}px)`,
                  }}
                >
                  {reticulumImageDownloadIssue ? (
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        // The bigger phone pill still fits a 96px placeholder.
                        padding: touchSizedChips ? '12px' : '16px',
                        textAlign: 'center',
                      }}
                    >
                      <Typography
                        sx={{
                          color: theme.palette.text.primary,
                          fontSize: '13px',
                          fontWeight: 500,
                          lineHeight: 1.35,
                        }}
                      >
                        {reticulumImageDownloadIssue === 'unavailable'
                          ? t('group:message_item.image_unavailable_no_peers')
                          : t('group:message_item.image_download_failed', {
                              defaultValue: "Couldn't download image",
                            })}
                      </Typography>
                      <Button
                        size="small"
                        onClick={retryReticulumImageDownload}
                        sx={{
                          backgroundColor: alpha(
                            theme.palette.primary.main,
                            0.1
                          ),
                          borderRadius: '999px',
                          fontSize: touchSizedChips ? '14px' : '12px',
                          fontWeight: 600,
                          lineHeight: 1,
                          minWidth: 0,
                          padding: touchSizedChips ? '0 20px' : '7px 14px',
                          textTransform: 'none',
                          ...(touchSizedChips
                            ? {
                                minHeight: `${PHONE_RETRY_PILL_MIN_HEIGHT_PX}px`,
                              }
                            : {}),
                          '&:hover': {
                            backgroundColor: alpha(
                              theme.palette.primary.main,
                              0.17
                            ),
                          },
                        }}
                      >
                        {t('group:message_item.try_again')}
                      </Button>
                    </Box>
                  ) : (
                    <>
                      <Typography sx={{ fontSize: '13px' }}>
                        {t('group:message_item.downloading_image', {
                          defaultValue: 'Downloading image…',
                        })}
                      </Typography>
                      <LinearProgress
                        sx={{
                          bottom: 0,
                          left: 0,
                          position: 'absolute',
                          right: 0,
                        }}
                      />
                    </>
                  )}
                </Box>
              ) : null)
            )}

            {reticulumDownloadAttachment && (
              <Box
                sx={{
                  alignItems: 'center',
                  backgroundColor:
                    theme.palette.mode === 'dark'
                      ? alpha(theme.palette.common.white, 0.035)
                      : alpha(theme.palette.common.black, 0.025),
                  border: '1px solid',
                  borderColor:
                    theme.palette.mode === 'dark'
                      ? alpha(theme.palette.text.secondary, 0.23)
                      : alpha(theme.palette.text.primary, 0.16),
                  borderRadius: '12px',
                  boxSizing: 'border-box',
                  boxShadow:
                    theme.palette.mode === 'dark'
                      ? '0 8px 24px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.018)'
                      : '0 8px 24px rgba(32, 42, 58, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.45)',
                  columnGap: '18px',
                  display: 'grid',
                  gridTemplateColumns: '56px minmax(0, 1fr) auto',
                  marginTop: '4px',
                  maxWidth: '640px',
                  minHeight: '100px',
                  overflow: 'hidden',
                  padding: '18px 20px',
                  position: 'relative',
                  transition:
                    'background-color 150ms ease, border-color 150ms ease',
                  width: 'min(100%, 640px)',
                  '&:hover': {
                    backgroundColor:
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.common.white, 0.055)
                        : alpha(theme.palette.primary.main, 0.045),
                    borderColor: alpha(theme.palette.primary.main, 0.38),
                  },
                  '@media (max-width: 600px)': {
                    columnGap: '14px',
                    gridTemplateColumns: '48px minmax(0, 1fr) auto',
                    padding: '15px',
                  },
                  '@media (max-width: 460px)': {
                    gridTemplateColumns: '48px minmax(0, 1fr)',
                  },
                }}
              >
                <Box
                  aria-hidden="true"
                  sx={{
                    alignItems: 'center',
                    alignSelf: 'center',
                    backgroundColor:
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.text.secondary, 0.13)
                        : alpha(theme.palette.text.primary, 0.07),
                    border: '1px solid',
                    borderColor:
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.text.secondary, 0.12)
                        : alpha(theme.palette.text.primary, 0.09),
                    borderRadius: '10px',
                    display: 'flex',
                    height: '56px',
                    justifyContent: 'center',
                    width: '56px',
                    '@media (max-width: 600px)': {
                      height: '48px',
                      width: '48px',
                    },
                  }}
                >
                  <InsertDriveFileRoundedIcon
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '30px',
                      '@media (max-width: 600px)': {
                        fontSize: '26px',
                      },
                    }}
                  />
                </Box>
                <Box
                  sx={{
                    alignSelf: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    minWidth: 0,
                  }}
                >
                  <Tooltip
                    arrow
                    disableFocusListener={false}
                    title={reticulumFileName}
                  >
                    <Typography
                      component="span"
                      tabIndex={0}
                      sx={{
                        color: theme.palette.text.primary,
                        fontSize: '17px',
                        fontWeight: 700,
                        letterSpacing: '-0.018em',
                        lineHeight: '22px',
                        outline: 'none',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        '&:focus-visible': {
                          borderRadius: '3px',
                          boxShadow: `0 0 0 2px ${alpha(
                            theme.palette.primary.main,
                            0.65
                          )}`,
                        },
                      }}
                    >
                      <FileNameWithExtension
                        name={reticulumFileName}
                        fallback={reticulumFileName}
                      />
                    </Typography>
                  </Tooltip>
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '10px',
                      marginTop: '6px',
                      minWidth: 0,
                    }}
                  >
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '13.5px',
                        fontWeight: 400,
                        lineHeight: '18px',
                      }}
                    >
                      {formatQchatFileSize(reticulumFileSize)}
                    </Typography>
                    <Box
                      aria-hidden="true"
                      sx={{
                        backgroundColor: theme.palette.text.disabled,
                        borderRadius: '50%',
                        height: '3px',
                        width: '3px',
                      }}
                    />
                    <Box
                      aria-label={fileResourceStatusLabel}
                      title={fileResourceStatusText}
                      sx={{
                        alignItems: 'center',
                        backgroundColor:
                          theme.palette.mode === 'dark'
                            ? alpha(theme.palette.common.white, 0.055)
                            : alpha(theme.palette.common.black, 0.045),
                        border: '1px solid',
                        borderColor:
                          theme.palette.mode === 'dark'
                            ? alpha(theme.palette.common.white, 0.055)
                            : alpha(theme.palette.common.black, 0.055),
                        borderRadius: '999px',
                        color:
                          fileResourceStatus === 'error' ||
                          fileResourceUnavailableNoPeers ||
                          fileResourceFailureReason === 'verification_failed'
                            ? theme.palette.error.main
                            : theme.palette.text.secondary,
                        display: 'inline-flex',
                        fontSize: '13px',
                        fontWeight: 400,
                        gap: '8px',
                        height: '26px',
                        lineHeight: 1,
                        maxWidth: '100%',
                        padding: '0 12px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <Box
                        aria-hidden="true"
                        sx={{
                          backgroundColor:
                            fileResourceStatus === 'ready'
                              ? theme.palette.success.main
                              : fileResourceStatus === 'downloading' ||
                                  fileResourceStatus === 'saving'
                                ? theme.palette.primary.main
                                : fileResourceStatus === 'error' ||
                                    fileResourceUnavailableNoPeers ||
                                    fileResourceFailureReason ===
                                      'verification_failed'
                                  ? theme.palette.error.main
                                  : theme.palette.text.disabled,
                          borderRadius: '50%',
                          flexShrink: 0,
                          height: '7px',
                          width: '7px',
                        }}
                      />
                      <Box
                        component="span"
                        sx={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {fileResourceStatusLabel}
                      </Box>
                    </Box>
                  </Box>
                </Box>
                <Box
                  sx={{
                    alignItems: 'center',
                    alignSelf: 'center',
                    display: 'flex',
                    flexShrink: 0,
                    gap: '8px',
                    justifyContent: 'flex-end',
                    '@media (max-width: 460px)': {
                      gridColumn: '1 / -1',
                      marginTop: '12px',
                      width: '100%',
                    },
                  }}
                >
                  {fileResourceStatus === 'downloading' &&
                  !fileResourceUnavailableNoPeers ? (
                    <Button
                      size="small"
                      variant="outlined"
                      color="inherit"
                      startIcon={<CancelRoundedIcon />}
                      onClick={() => {
                        void cancelReticulumFileResource();
                      }}
                      aria-label={fileResourceActionAriaLabel}
                      sx={{
                        borderRadius: '9px',
                        flexShrink: 0,
                        fontSize: '14px',
                        fontWeight: 600,
                        height: '42px',
                        minWidth: '128px',
                        padding: '0 18px',
                        textTransform: 'none',
                        '@media (max-width: 600px)': {
                          minWidth: '108px',
                        },
                        '@media (max-width: 460px)': {
                          width: '100%',
                        },
                      }}
                    >
                      Cancel
                    </Button>
                  ) : fileResourceStatus === 'ready' ? (
                    <>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<OpenInNewRoundedIcon />}
                        onClick={() => {
                          // In the app, files open in the in-app viewer and
                          // stay in the sandbox, so the warning about OS apps
                          // does not apply.
                          if (Capacitor.isNativePlatform()) {
                            openFileViewer({
                              fileHash: reticulumFileResourceId,
                              fileName: reticulumFileName,
                              fileSize: reticulumFileSize,
                            });
                            return;
                          }
                          setFileOpenError(null);
                          setIsFileOpenWarningOpen(true);
                        }}
                        aria-label={`Open ${reticulumFileName}, ${formatQchatFileSize(
                          reticulumFileSize
                        )}`}
                        sx={{
                          background:
                            'linear-gradient(180deg, #5b96ee 0%, #3f7ed8 100%)',
                          border: '1px solid #69a4f2',
                          borderRadius: '9px',
                          boxShadow:
                            '0 4px 12px rgba(46, 111, 207, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.14)',
                          color: '#ffffff',
                          flexShrink: 0,
                          fontSize: '14px',
                          fontWeight: 600,
                          height: '42px',
                          minWidth: '104px',
                          padding: '0 15px',
                          textTransform: 'none',
                          '&:hover': {
                            background:
                              'linear-gradient(180deg, #68a1f5 0%, #4a88e3 100%)',
                            borderColor: '#82b5f6',
                          },
                          '@media (max-width: 600px)': {
                            minWidth: '92px',
                          },
                          '@media (max-width: 460px)': {
                            flex: 1,
                          },
                        }}
                      >
                        {t('core:file_transfer.open')}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="inherit"
                        startIcon={<DownloadRoundedIcon />}
                        onClick={() => {
                          void saveReticulumFileResource();
                        }}
                        aria-label={fileResourceActionAriaLabel}
                        sx={{
                          borderColor: alpha(theme.palette.text.primary, 0.3),
                          borderRadius: '9px',
                          flexShrink: 0,
                          fontSize: '14px',
                          fontWeight: 600,
                          height: '42px',
                          minWidth: '104px',
                          padding: '0 15px',
                          textTransform: 'none',
                          '&:hover': {
                            backgroundColor: alpha(
                              theme.palette.text.primary,
                              0.06
                            ),
                            borderColor: alpha(
                              theme.palette.text.primary,
                              0.45
                            ),
                          },
                          '@media (max-width: 600px)': {
                            minWidth: '92px',
                          },
                          '@media (max-width: 460px)': {
                            flex: 1,
                          },
                        }}
                      >
                        {Capacitor.isNativePlatform()
                          ? t('core:file_transfer.save_to_device')
                          : t('core:file_transfer.save')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<DownloadRoundedIcon />}
                      disabled={fileResourceStatus === 'saving'}
                      onClick={() => {
                        if (fileResourceUnavailableNoPeers) {
                          void requestReticulumFileResource();
                          return;
                        }
                        void saveReticulumFileResource();
                      }}
                      aria-label={fileResourceActionAriaLabel}
                      sx={{
                        background:
                          'linear-gradient(180deg, #5b96ee 0%, #3f7ed8 100%)',
                        border: '1px solid #69a4f2',
                        borderRadius: '9px',
                        boxShadow:
                          '0 4px 12px rgba(46, 111, 207, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.14)',
                        color: '#ffffff',
                        flexShrink: 0,
                        fontSize: '14px',
                        fontWeight: 600,
                        height: '42px',
                        letterSpacing: '-0.005em',
                        lineHeight: 1,
                        minWidth: '128px',
                        padding: '0 18px',
                        textTransform: 'none',
                        '& .MuiButton-startIcon svg': {
                          fontSize: '20px',
                        },
                        '&:hover': {
                          background:
                            'linear-gradient(180deg, #68a1f5 0%, #4a88e3 100%)',
                          borderColor: '#82b5f6',
                          boxShadow:
                            '0 5px 14px rgba(46, 111, 207, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.16)',
                        },
                        '&:active': {
                          background: '#3772ca',
                          boxShadow: 'none',
                        },
                        '&:focus-visible': {
                          outline: `3px solid ${alpha(
                            theme.palette.primary.light,
                            0.55
                          )}`,
                          outlineOffset: '2px',
                        },
                        '&.Mui-disabled': {
                          background:
                            'linear-gradient(180deg, #5b96ee 0%, #3f7ed8 100%)',
                          color: '#ffffff',
                          opacity: 0.55,
                        },
                        '@media (max-width: 600px)': {
                          minWidth: '108px',
                        },
                        '@media (max-width: 460px)': {
                          width: '100%',
                        },
                      }}
                    >
                      {fileResourceActionLabel}
                    </Button>
                  )}
                </Box>
                {(fileResourceStatus === 'downloading' ||
                  fileResourceStatus === 'saving') && (
                  <LinearProgress
                    aria-hidden="true"
                    variant={
                      fileResourceProgress !== null
                        ? 'determinate'
                        : 'indeterminate'
                    }
                    value={fileResourceProgress ?? undefined}
                    sx={{
                      bottom: 0,
                      height: '2px',
                      left: 0,
                      position: 'absolute',
                      right: 0,
                      '& .MuiLinearProgress-bar': {
                        backgroundColor: theme.palette.primary.main,
                      },
                    }}
                  />
                )}
              </Box>
            )}

            {collapseGroupedHeader && discussionChipInHeader && (
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  marginTop: '4px',
                }}
              >
                {reticulumDiscussionButton}
              </Box>
            )}

            {/* Failure status. Reticulum sends and mutations update in place,
                so pending state must not add a transient status row. */}
            {(isUpdating || isTemp) &&
              (!reticulumChatEnabled ||
                message?.status === 'failed-permanent') && (
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontFamily: 'Inter',
                    fontSize: qchatMetaTextSize(12),
                    fontStyle: 'italic',
                    marginTop: '2px',
                  }}
                >
                  {!isTemp
                    ? message?.status === 'failed-permanent'
                      ? t('core:message.error.update_failed', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : t('core:message.generic.updating', {
                          postProcess: 'capitalizeFirstChar',
                        })
                    : message?.status === 'failed-permanent'
                      ? t('core:message.error.send_failed', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : t('core:message.generic.sending', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                </Typography>
              )}
            {/* The reason a send was given up on (queue error text). Lets a
                phone user report something more useful than "failed". */}
            {queuedSendError && (
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontFamily: 'Inter',
                  fontSize: qchatMetaTextSize(11),
                  lineHeight: 1.35,
                  marginTop: '2px',
                  opacity: 0.85,
                  overflowWrap: 'anywhere',
                  userSelect: 'text',
                }}
              >
                {queuedSendError}
              </Typography>
            )}

            {/* Reactions row (phones also put the replies chip here) */}
            {(hasVisibleReactions || discussionChipInReactionsRow) && (
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: `${chipSizes.reactionRowGapPx}px`,
                  marginTop: touchSizedChips ? '6px' : '4px',
                }}
              >
                {message?.isNotEncrypted &&
                  isPrivate &&
                  !reticulumChatEnabled && (
                    <Tooltip
                      title={t('group:message_item.unencrypted')}
                      disableFocusListener
                    >
                      <KeyOffIcon
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: '16px',
                          mr: '4px',
                        }}
                      />
                    </Tooltip>
                  )}

                {Object.keys(reactions || {}).map((reaction) => {
                  const numberOfReactions = reactions[reaction]?.length;
                  if (numberOfReactions === 0) return null;
                  const isMine = !!reactions[reaction]?.find(
                    (item) => item?.sender === myAddress
                  );
                  return (
                    <ReactionChip
                      count={numberOfReactions}
                      isMine={isMine}
                      othersCount={
                        reactions[reaction].filter(
                          (item) => item?.sender !== myAddress
                        ).length
                      }
                      key={reaction}
                      messageKey={messageSignature}
                      mountedAt={mountedAt}
                      onShowWho={(anchor) => {
                        setAnchorEl(anchor);
                        setSelectedReaction(reaction);
                      }}
                      onToggle={() =>
                        handleReaction(reaction, message, !isMine)
                      }
                      onTouchEnd={endReactionHold}
                      onTouchMove={moveReactionHold}
                      onTouchStart={(event) =>
                        startReactionHold(event, reaction)
                      }
                      reaction={reaction}
                      sizes={chipSizes}
                    />
                  );
                })}

                {discussionChipInReactionsRow && reticulumDiscussionButton}
              </Box>
            )}

            {/* KeyOff when no reactions to show it beside */}
            {message?.isNotEncrypted &&
              isPrivate &&
              !reticulumChatEnabled &&
              !hasVisibleReactions && (
                <Tooltip
                  title={t('group:message_item.unencrypted')}
                  disableFocusListener
                >
                  <KeyOffIcon
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '16px',
                      marginTop: '2px',
                    }}
                  />
                </Tooltip>
              )}

            {/* Reaction popover — zIndex 1400 so it appears above GlobalChatWidget (1300).
                Own (right-aligned) messages use top-end so the panel opens left of
                the chip instead of spilling past the right edge of the screen. */}
            {selectedReaction && (
              <Popper
                open={Boolean(anchorEl)}
                anchorEl={anchorEl}
                container={
                  anchorEl?.closest('[data-reticulum-chat-root="true"]') ||
                  undefined
                }
                modifiers={[
                  {
                    name: 'offset',
                    options: { offset: [0, 10] },
                  },
                  {
                    enabled: false,
                    name: 'flip',
                  },
                  {
                    name: 'preventOverflow',
                    options: {
                      altAxis: true,
                      boundary: 'viewport',
                      mainAxis: true,
                      padding: 12,
                      tether: false,
                    },
                  },
                ]}
                placement={ownAligned ? 'top-end' : 'top-start'}
                popperOptions={{ strategy: 'fixed' }}
                sx={{ zIndex: 1400 }}
              >
                <ClickAwayListener
                  // Phones close it from the document listener above instead.
                  mouseEvent={isMobileLayout ? false : 'onClick'}
                  touchEvent={isMobileLayout ? false : 'onTouchEnd'}
                  onClickAway={closeReactionList}
                >
                  <Box
                    ref={reactionListRef}
                    sx={{
                      backgroundColor:
                        theme.palette.mode === 'dark'
                          ? '#1e2027'
                          : theme.palette.background.paper,
                      backgroundImage: 'none',
                      border: '1px solid',
                      borderColor:
                        theme.palette.mode === 'dark'
                          ? '#3a414d'
                          : theme.palette.divider,
                      borderRadius: '10px',
                      boxShadow:
                        theme.palette.mode === 'dark'
                          ? '0 14px 32px rgba(0, 0, 0, 0.42)'
                          : theme.shadows[8],
                      // Cap width to the viewport so preventOverflow can keep the
                      // whole panel on-screen even on narrow phones.
                      maxWidth: 'min(320px, calc(100vw - 24px))',
                      minWidth: 'min(260px, calc(100vw - 24px))',
                      padding: '16px 16px 12px',
                    }}
                  >
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        gap: '8px',
                        marginBottom: '12px',
                      }}
                    >
                      <Box
                        sx={{
                          alignItems: 'center',
                          backgroundColor: theme.palette.action.hover,
                          borderRadius: '8px',
                          display: 'flex',
                          fontSize: '18px',
                          height: '36px',
                          justifyContent: 'center',
                          width: '36px',
                        }}
                      >
                        {selectedReaction}
                      </Box>
                      <Typography
                        sx={{
                          fontSize: '14px',
                          fontWeight: 600,
                          color: theme.palette.text.primary,
                        }}
                      >
                        {t('core:message.generic.people_reaction', {
                          reaction: selectedReaction,
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                    </Box>

                    <List
                      disablePadding
                      sx={{
                        maxHeight: '240px',
                        overflow: 'auto',
                      }}
                    >
                      {reactions[selectedReaction]?.map((reactionItem) => {
                        const hasUnsafeReactionName = Boolean(
                          reactionItem.senderName &&
                          hasInvisibleCharacters(reactionItem.senderName)
                        );

                        return (
                          <ListItem
                            key={reactionItem.sender}
                            disablePadding
                            sx={{
                              borderRadius: '8px',
                              marginBottom: '2px',
                              '&:last-of-type': { marginBottom: 0 },
                              '&:hover': {
                                backgroundColor: theme.palette.action.hover,
                              },
                            }}
                          >
                            <ListItemText
                              primary={
                                reactionItem.senderName || reactionItem.sender
                              }
                              primaryTypographyProps={{
                                sx: {
                                  fontSize: '14px',
                                  fontWeight: 500,
                                  ...(hasUnsafeReactionName
                                    ? {
                                        textDecorationLine: 'line-through',
                                        textDecorationThickness: '2px',
                                        textDecorationColor:
                                          theme.palette.error.main,
                                      }
                                    : {}),
                                },
                              }}
                              sx={{ py: '8px', px: '12px' }}
                            />
                          </ListItem>
                        );
                      })}
                    </List>
                  </Box>
                </ClickAwayListener>
              </Popper>
            )}
          </Box>
        </Box>
        <AvatarPreviewModal
          open={isAvatarPreviewOpen}
          src={avatarPreviewSrc}
          alt={message?.senderName}
          onClose={closeAvatarPreview}
        />
        {reticulumImageViewerSrc && (
          <ReticulumImageViewer
            alt={reticulumImageFileName}
            containerElement={reticulumImageViewerContainer}
            fileName={
              libraryGifImage
                ? `${libraryGifImage.identifier}.gif`
                : reticulumImageFileName
            }
            gallery={reticulumImageViewerGallery}
            mimeType={libraryGifImage ? 'image/gif' : reticulumImageMimeType}
            open={isReticulumImageViewerOpen}
            src={reticulumImageViewerSrc}
            onClose={() => {
              setIsReticulumImageViewerOpen(false);
              setReticulumImageViewerSrc(null);
            }}
          />
        )}
      </MessageWragger>
      <Dialog
        aria-labelledby="reticulum-select-text-title"
        fullWidth
        maxWidth="sm"
        open={isSelectTextOpen}
        onClose={() => setIsSelectTextOpen(false)}
        slotProps={{
          backdrop: {
            sx: {
              backdropFilter: 'blur(2px)',
              backgroundColor: 'rgba(3, 6, 12, 0.78)',
            },
          },
          paper: {
            // The message text keeps the chat's text size in here.
            className: reticulumChatTextScaleClassName(reticulumChatTextScale),
            sx: {
              backgroundColor: theme.palette.background.paper,
              backgroundImage: 'none',
              border: '1px solid',
              borderColor: alpha(theme.palette.text.secondary, 0.22),
              borderRadius: '16px',
              boxShadow: '0 24px 70px rgba(0, 0, 0, 0.48)',
            },
          },
        }}
      >
        <DialogTitle
          id="reticulum-select-text-title"
          sx={{
            fontSize: '17px',
            fontWeight: 750,
            padding: '18px 22px 10px',
          }}
        >
          Select text
        </DialogTitle>
        <DialogContent sx={{ padding: '0 22px 8px' }}>
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '12.5px',
              marginBottom: '10px',
            }}
          >
            Drag the handles to keep only the part you want, then copy.
          </Typography>
          <Box
            ref={selectTextBodyRef}
            sx={{
              backgroundColor: alpha(theme.palette.text.primary, 0.06),
              border: '1px solid',
              borderColor: theme.palette.divider,
              borderRadius: '10px',
              cursor: 'text',
              fontSize: qchatTextSize(15),
              lineHeight: 1.45,
              maxHeight: '52vh',
              overflowY: 'auto',
              padding: '12px 14px',
              userSelect: 'text',
              WebkitUserSelect: 'text',
              WebkitTouchCallout: 'default',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {reticulumMessagePlainText}
          </Box>
        </DialogContent>
        <DialogActions sx={{ padding: '8px 18px 16px' }}>
          <Button
            onClick={() => setIsSelectTextOpen(false)}
            sx={{ borderRadius: '9px', fontWeight: 650, textTransform: 'none' }}
          >
            Close
          </Button>
          <Button
            onClick={() => void copySelectedMessageText()}
            startIcon={<ContentCopyRoundedIcon sx={{ fontSize: 16 }} />}
            variant="contained"
            sx={{ borderRadius: '9px', fontWeight: 750, textTransform: 'none' }}
          >
            {selectTextCopied ? 'Copied' : 'Copy selection'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        aria-describedby="reticulum-file-open-warning-description"
        aria-labelledby="reticulum-file-open-warning-title"
        maxWidth="xs"
        fullWidth
        open={isFileOpenWarningOpen}
        onClose={() => {
          if (isOpeningFile) return;
          setIsFileOpenWarningOpen(false);
          setFileOpenError(null);
        }}
        slotProps={{
          backdrop: {
            sx: {
              backgroundColor: 'rgba(3, 6, 12, 0.78)',
              backdropFilter: 'blur(2px)',
            },
          },
          paper: {
            sx: {
              backgroundColor: theme.palette.background.paper,
              backgroundImage:
                theme.palette.mode === 'dark'
                  ? `linear-gradient(180deg, ${alpha(
                      theme.palette.common.white,
                      0.035
                    )} 0%, transparent 100%)`
                  : 'none',
              border: '1px solid',
              borderColor: alpha(theme.palette.text.secondary, 0.22),
              borderRadius: '16px',
              boxShadow: '0 24px 70px rgba(0, 0, 0, 0.48)',
              overflow: 'hidden',
            },
          },
        }}
      >
        <DialogTitle
          id="reticulum-file-open-warning-title"
          sx={{
            alignItems: 'center',
            borderBottom: '1px solid',
            borderColor: alpha(theme.palette.text.secondary, 0.14),
            display: 'flex',
            fontSize: '18px',
            fontWeight: 750,
            gap: '12px',
            padding: '20px 22px 17px',
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              backgroundColor: alpha(theme.palette.warning.main, 0.12),
              border: '1px solid',
              borderColor: alpha(theme.palette.warning.main, 0.28),
              borderRadius: '10px',
              display: 'flex',
              flexShrink: 0,
              height: '38px',
              justifyContent: 'center',
              width: '38px',
            }}
          >
            <WarningAmberRoundedIcon
              sx={{ color: theme.palette.warning.main, fontSize: '22px' }}
            />
          </Box>
          Open attachment?
        </DialogTitle>
        <DialogContent sx={{ padding: '20px 22px 8px !important' }}>
          <Typography
            id="reticulum-file-open-warning-description"
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '14px',
              lineHeight: 1.6,
            }}
          >
            Attachments can contain harmful content. Only open this file if you
            trust who sent it and were expecting it.
          </Typography>
          <Box
            sx={{
              alignItems: 'center',
              backgroundColor: alpha(theme.palette.text.primary, 0.035),
              border: '1px solid',
              borderColor: alpha(theme.palette.text.secondary, 0.15),
              borderRadius: '11px',
              display: 'grid',
              gap: '12px',
              gridTemplateColumns: '38px minmax(0, 1fr)',
              marginTop: '17px',
              padding: '12px 14px',
            }}
          >
            <InsertDriveFileRoundedIcon
              sx={{ color: theme.palette.text.secondary, fontSize: '28px' }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography
                title={reticulumFileName}
                sx={{
                  fontSize: '14px',
                  fontWeight: 650,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {reticulumFileName}
              </Typography>
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '12px',
                  marginTop: '2px',
                }}
              >
                {formatQchatFileSize(reticulumFileSize)} · Opens with your
                default app
              </Typography>
            </Box>
          </Box>
          {fileOpenError && (
            <Box
              role="alert"
              sx={{
                backgroundColor: alpha(theme.palette.error.main, 0.09),
                border: '1px solid',
                borderColor: alpha(theme.palette.error.main, 0.24),
                borderRadius: '9px',
                color: theme.palette.error.light,
                fontSize: '13px',
                lineHeight: 1.45,
                marginTop: '13px',
                padding: '10px 12px',
              }}
            >
              {fileOpenError}
            </Box>
          )}
        </DialogContent>
        <DialogActions
          sx={{
            gap: '8px',
            padding: '14px 22px 20px',
          }}
        >
          <Button
            autoFocus
            color="inherit"
            disabled={isOpeningFile}
            onClick={() => {
              setIsFileOpenWarningOpen(false);
              setFileOpenError(null);
            }}
            sx={{
              borderRadius: '9px',
              color: theme.palette.text.secondary,
              fontWeight: 650,
              minHeight: '40px',
              minWidth: '96px',
              textTransform: 'none',
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={isOpeningFile}
            startIcon={<OpenInNewRoundedIcon />}
            variant="contained"
            onClick={() => {
              void openReticulumFileResource();
            }}
            sx={{
              borderRadius: '9px',
              fontWeight: 650,
              minHeight: '40px',
              minWidth: '112px',
              textTransform: 'none',
            }}
          >
            {isOpeningFile ? 'Opening...' : 'Open file'}
          </Button>
        </DialogActions>
      </Dialog>
      <CustomStyledMenu
        reticulumMenu
        anchorReference="anchorPosition"
        anchorPosition={
          reticulumMessageMenuPosition
            ? {
                left: reticulumMessageMenuPosition.mouseX,
                top: reticulumMessageMenuPosition.mouseY,
              }
            : undefined
        }
        onClose={() => setReticulumMessageMenuPosition(null)}
        open={Boolean(reticulumMessageMenuPosition)}
        slotProps={{
          paper: {
            sx: {
              backdropFilter: 'none !important',
              background: 'transparent !important',
              backgroundColor: 'transparent !important',
              backgroundImage: 'none !important',
              border: 'none !important',
              borderRadius: '0 !important',
              boxShadow: 'none !important',
              minWidth: '190px !important',
              padding: '0 !important',
              WebkitBackdropFilter: 'none !important',
              '& .MuiMenu-list': {
                background: 'transparent !important',
                backgroundColor: 'transparent !important',
                backgroundImage: 'none !important',
              },
            },
          },
        }}
        MenuListProps={{
          sx: {
            background: 'transparent !important',
            backgroundColor: 'transparent !important',
            backgroundImage: 'none !important',
            padding: 0,
          },
        }}
      >
        <Box
          aria-label={t('group:message_item.quick_reactions')}
          role="group"
          sx={{
            alignItems: 'center',
            backgroundColor: theme.palette.background.surface,
            border: '1px solid',
            borderColor: theme.palette.divider,
            borderRadius: '8px',
            boxShadow: '0 12px 28px rgba(0, 0, 0, 0.28)',
            display: 'flex',
            gap: '8px',
            justifyContent: 'center',
            boxSizing: 'border-box',
            minWidth: `${menuSizes.menuMinWidthPx}px`,
            padding: '7px 10px',
            width: '100%',
          }}
        >
          {RETICULUM_QUICK_REACTIONS.map((emoji) => (
            <Tooltip
              key={emoji}
              title={t('group:message_item.react_with', {
                defaultValue: 'react with {{emoji}}',
                emoji,
                postProcess: 'capitalizeFirstChar',
              })}
              disableFocusListener
            >
              <ButtonBase
                aria-label={t('group:message_item.react_with', {
                  defaultValue: 'react with {{emoji}}',
                  emoji,
                  postProcess: 'capitalizeFirstChar',
                })}
                sx={{
                  borderRadius: '6px',
                  fontSize: `${menuSizes.menuQuickReactionEmojiPx}px`,
                  lineHeight: 1,
                  padding: '5px 8px',
                  '&:hover': {
                    backgroundColor: theme.palette.action.hover,
                  },
                }}
                onClick={() => {
                  const hasReacted = reactions?.[emoji]?.some(
                    (item) => item?.sender === myAddress
                  );
                  setReticulumMessageMenuPosition(null);
                  handleReaction(emoji, message, !hasReacted);
                }}
              >
                {emoji}
              </ButtonBase>
            </Tooltip>
          ))}
        </Box>
        <Box
          sx={{
            backgroundColor: theme.palette.background.surface,
            border: '1px solid',
            borderColor: theme.palette.divider,
            borderBottomColor: 'transparent',
            borderRadius: '8px',
            boxShadow: '0 12px 28px rgba(0, 0, 0, 0.28)',
            boxSizing: 'border-box',
            marginTop: '6px',
            minWidth: `${menuSizes.menuMinWidthPx}px`,
            padding: '5px',
            width: '100%',
            // The doubled class outranks MenuItem's own icon column rule.
            '&& .MuiListItemIcon-root': {
              minWidth: `${menuSizes.menuIconColumnPx}px`,
            },
            '& .MuiListItemIcon-root .MuiSvgIcon-root': {
              fontSize: `${menuSizes.menuIconPx}px`,
            },
            '& .message-menu-label': {
              fontSize: `${menuSizes.menuLabelPx}px`,
            },
          }}
        >
          <MenuItem
            onClick={() => {
              setReticulumMessageMenuPosition(null);
              void copyReticulumMessage();
            }}
          >
            <ListItemIcon>
              <ContentCopyRoundedIcon fontSize="small" />
            </ListItemIcon>
            <Typography className="message-menu-label" variant="inherit">
              {t('group:message_item.copy_message', {
                defaultValue: 'copy message',
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </MenuItem>
          <MenuItem
            disabled={!reticulumMessagePlainText}
            onClick={() => {
              setReticulumMessageMenuPosition(null);
              setSelectTextCopied(false);
              setIsSelectTextOpen(true);
            }}
          >
            <ListItemIcon>
              <TextFieldsRoundedIcon fontSize="small" />
            </ListItemIcon>
            <Typography className="message-menu-label" variant="inherit">
              {t('group:message_item.select_text', {
                defaultValue: 'select text',
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </MenuItem>
          <MenuItem
            onClick={() => {
              setReticulumMessageMenuPosition(null);
              onReply(message);
            }}
          >
            <ListItemIcon>
              <ReplyIcon fontSize="small" />
            </ListItemIcon>
            <Typography className="message-menu-label" variant="inherit">
              {t('group:message_item.reply_message', {
                defaultValue: 'reply message',
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </MenuItem>
          {isOwnReticulumEditable && (
            <MenuItem
              onClick={() => {
                setReticulumMessageMenuPosition(null);
                onEdit(message);
              }}
            >
              <ListItemIcon>
                <EditIcon fontSize="small" />
              </ListItemIcon>
              <Typography className="message-menu-label" variant="inherit">
                {t('group:message_item.edit_message', {
                  defaultValue: 'edit message',
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </MenuItem>
          )}
          {isOwnReticulumDeletable && (
            <MenuItem
              onClick={() => {
                setReticulumMessageMenuPosition(null);
                onDelete(message);
              }}
              sx={{ color: 'error.main' }}
            >
              <ListItemIcon sx={{ color: 'inherit' }}>
                <DeleteOutlineIcon fontSize="small" />
              </ListItemIcon>
              <Typography className="message-menu-label" variant="inherit">
                {t('group:message_item.delete_message', {
                  defaultValue: 'delete message',
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </MenuItem>
          )}
        </Box>
        <Box
          aria-label={
            hasReticulumExpiry
              ? `Message expires ${reticulumExpiryText}`
              : 'No Expiry'
          }
          role="status"
          sx={{
            boxSizing: 'border-box',
            marginTop: '6px',
            minWidth: `${menuSizes.menuMinWidthPx}px`,
            width: '100%',
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              backgroundColor: hasReticulumExpiry
                ? `color-mix(in srgb, ${theme.palette.background.surface} 91%, ${theme.palette.error.main} 9%)`
                : theme.palette.background.surface,
              backgroundImage: 'none',
              border: '1px solid',
              borderColor: hasReticulumExpiry
                ? alpha(theme.palette.error.main, 0.4)
                : alpha(theme.palette.text.secondary, 0.28),
              borderRadius: '8px',
              boxSizing: 'border-box',
              display: 'grid',
              gridTemplateColumns: '42px 1px minmax(0, 1fr)',
              minHeight: '62px',
              padding: '8px 10px',
              isolation: 'isolate',
              width: '100%',
            }}
          >
            <Box
              alt=""
              aria-hidden="true"
              component="img"
              src={hasReticulumExpiry ? messageExpiresIcon : noExpiryIcon}
              sx={{
                display: 'block',
                filter: hasReticulumExpiry ? 'none' : 'brightness(1.2)',
                height: '34px',
                justifySelf: 'center',
                objectFit: 'contain',
                opacity: hasReticulumExpiry ? 0.94 : 0.9,
                width: '34px',
              }}
            />
            <Box
              aria-hidden="true"
              sx={{
                alignSelf: 'stretch',
                backgroundColor: hasReticulumExpiry
                  ? alpha(theme.palette.error.main, 0.48)
                  : alpha(theme.palette.text.secondary, 0.32),
                marginY: '2px',
                width: '1px',
              }}
            />
            <Box
              sx={{
                alignSelf: 'center',
                minWidth: 0,
                paddingLeft: '10px',
              }}
            >
              {hasReticulumExpiry ? (
                <>
                  <Typography
                    sx={{
                      color: alpha(theme.palette.error.light, 0.92),
                      fontSize: '11px',
                      fontWeight: 600,
                      lineHeight: 1.2,
                    }}
                  >
                    Message expires
                  </Typography>
                  <Typography
                    sx={{
                      color:
                        theme.palette.mode === 'dark'
                          ? theme.palette.common.white
                          : theme.palette.text.primary,
                      fontSize: '14px',
                      fontWeight: 600,
                      lineHeight: 1.35,
                      marginTop: '2px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {reticulumExpiryText}
                  </Typography>
                </>
              ) : (
                <Typography
                  sx={{
                    color:
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.common.white, 0.8)
                        : theme.palette.text.secondary,
                    fontSize: '14px',
                    fontWeight: 600,
                    lineHeight: 1.35,
                    whiteSpace: 'nowrap',
                  }}
                >
                  No Expiry
                </Typography>
              )}
            </Box>
          </Box>
        </Box>
      </CustomStyledMenu>
      {phoneActions && (
        <MessageActionsPopup
          actions={phoneMessageActions}
          alignEnd={ownAligned}
          anchor={phoneActions}
          details={phoneActionDetails}
          myReactions={myReactionEmojis}
          onClose={closePhoneActions}
          onExited={() => setPhoneActions(null)}
          onReact={
            phoneActionsInteractive && handleReaction
              ? (emoji, source) => {
                  const adding = !myReactionEmojis.includes(emoji);
                  if (adding && source && messageSignature) {
                    requestReactionLanding(messageSignature, emoji, source);
                  }
                  handleReaction(emoji, message, adding);
                }
              : undefined
          }
          open={phoneActionsOpen}
          reactionChatKey={reactionChatKey}
        />
      )}
    </>
  );
};

const MemoizedMessageItem = memo(MessageItemComponent);
MemoizedMessageItem.displayName = 'MessageItem'; // It ensures React DevTools shows MessageItem as the name (instead of "Anonymous" or "Memo")

export const MessageItem = MemoizedMessageItem;

export const ReplyPreview = ({
  message,
  isEdit = false,
  // Kept for callers; reply body rendering is always exclusive now.
  reticulumOnlyContent: _reticulumOnlyContent = false,
}) => {
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const replyMessageText = useMemo(() => {
    if (!message?.messageText) return null;
    const isHtml = isHtmlString(message?.messageText);
    if (isHtml) return message?.messageText;
    return normalizeMessageHtmlContent(message?.messageText);
  }, [message?.messageText]);

  if (isEdit) {
    return (
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: '6px',
          minHeight: '28px',
          padding: '4px 2px',
          width: '100%',
        }}
      >
        <EditIcon
          sx={{
            color: theme.palette.text.secondary,
            flexShrink: 0,
            fontSize: '14px',
          }}
        />
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
          }}
        >
          {t('core:message.generic.editing_message', {
            postProcess: 'capitalizeFirstChar',
          })}
          :
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        backgroundColor: theme.palette.background.surface,
        border: '1px solid',
        borderColor: theme.palette.divider,
        borderRadius: '0 8px 8px 0',
        cursor: 'pointer',
        display: 'flex',
        marginTop: '8px',
        maxHeight: '72px',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <Box
        sx={{
          background: theme.palette.primary.main,
          borderRadius: '4px 0 0 4px',
          flexShrink: 0,
          width: '4px',
        }}
      />
      <Box sx={{ padding: '8px 12px', minWidth: 0 }}>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '6px',
            marginBottom: '4px',
          }}
        >
          <ReplyIcon
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '14px',
              flexShrink: 0,
            }}
          />
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}
          >
            {t('core:message.generic.replied_to', {
              person: message?.senderName || message?.senderAddress,
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>

        {replyMessageText ? (
          <MessageDisplay isReply htmlContent={replyMessageText} />
        ) : message?.decryptedData?.type === 'notification' ? (
          <MessageDisplay
            isReply
            htmlContent={message.decryptedData?.data?.message}
          />
        ) : message?.text ? (
          <MessageDisplay isReply htmlContent={message.text} />
        ) : null}
      </Box>
    </Box>
  );
};

const MessageWragger = ({ lastMessage, onSeen, isLast, children }) => {
  if (lastMessage) {
    return (
      <WatchComponent onSeen={onSeen} isLast={isLast}>
        {children}
      </WatchComponent>
    );
  }
  return children;
};

const WatchComponent = ({ onSeen, isLast, children }) => {
  const { ref, inView } = useInView({
    threshold: 0.7, // Fully visible
    triggerOnce: true, // Only trigger once when it becomes visible
    delay: 100,
    trackVisibility: false,
  });

  useEffect(() => {
    if (inView && isLast && onSeen) {
      setTimeout(() => {
        onSeen();
      }, 100);
    }
  }, [inView, isLast, onSeen]);

  return (
    <div
      ref={ref}
      style={{
        display: 'flex',
        justifyContent: 'center',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
};
