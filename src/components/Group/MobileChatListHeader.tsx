import { Box, IconButton } from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import CreateIcon from '@mui/icons-material/Create';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { ChatShareChip } from '../Chat/share/ChatShareChip';
import type { PreparedChatShare } from '../Chat/share/chatShareIntake';
import {
  CHAT_SCOPES,
  ChatScopeSwitch,
  type ChatScope,
  type ChatScopeSwitchHandle,
} from './ChatScopeSwitch';
import {
  chatListHeaderActionsSx,
  chatListHeaderButtonSx,
  chatListHeaderIconSx,
  chatListHeaderSx,
} from './chatListRowStyles';
import { ReticulumChatSettingsDialog } from './GroupList';

/** Moves the header with the Groups / DMs pages below it. */
export type MobileChatListHeaderHandle = ChatScopeSwitchHandle;

/**
 * How much of the DM page's middle icon (new chat) shows at `position`
 * (0 = Groups, 1 = DMs): the Groups icon (new group) fades out over the
 * middle of the swipe as this one fades in.
 */
export const directIconShare = (position: number): number =>
  Math.max(0, Math.min(1, (position - 0.2) / 0.6));

const showIcon = (
  element: HTMLElement | null,
  shown: number,
  durationMs: number,
  easing: string
) => {
  if (!element) return;
  element.style.transition =
    durationMs > 0
      ? `opacity ${durationMs}ms ${easing}, transform ${durationMs}ms ${easing}`
      : 'none';
  element.style.opacity = String(Math.round(shown * 1000) / 1000);
  element.style.transform = `scale(${Math.round((0.6 + 0.4 * shown) * 1000) / 1000})`;
};

const iconLayerSx = {
  alignItems: 'center',
  display: 'flex',
  inset: 0,
  justifyContent: 'center',
  position: 'absolute',
} as const;

interface MobileChatListHeaderProps {
  ref?: Ref<MobileChatListHeaderHandle>;
  scope: ChatScope;
  onScopeChange: (scope: ChatScope) => void;
  directHasUnread?: boolean;
  directUnreadCount?: number;
  onFindGroups: () => void;
  onCreateGroup: () => void;
  onSearchMessages: () => void;
  onNewChat: () => void;
  /**
   * Something shared from another app, waiting for a chat to be tapped: it
   * shows in place of the buttons, with an X (`onCancelShare`) to drop it.
   */
  share?: PreparedChatShare | null;
  /** The share's channel step is up: the share asks for a channel. */
  sharePicksChannel?: boolean;
  onCancelShare?: () => void;
}

/**
 * The phone Q-Chat header over both lists. It stays put while the Groups and
 * DM pages slide under it: the switch's pill follows the swipe, and the
 * buttons belong to the page that is (nearly) showing. Search finds groups
 * on Groups and searches messages on DMs, the middle button starts a group
 * or a chat (the icons cross-fade during a swipe), and Q-Chat settings stay
 * in the same spot on both. While a share from another app waits, it takes
 * the buttons' place.
 */
export function MobileChatListHeader({
  ref,
  scope,
  onScopeChange,
  directHasUnread = false,
  directUnreadCount = 0,
  onFindGroups,
  onCreateGroup,
  onSearchMessages,
  onNewChat,
  share = null,
  sharePicksChannel = false,
  onCancelShare,
}: MobileChatListHeaderProps) {
  const { t } = useTranslation(['core', 'group', 'reticulum']);
  const switchRef = useRef<ChatScopeSwitchHandle>(null);
  const groupIconRef = useRef<HTMLSpanElement>(null);
  const directIconRef = useRef<HTMLSpanElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const placeIcons = (position: number, durationMs = 0, easing = 'ease') => {
    const share = directIconShare(position);
    showIcon(groupIconRef.current, 1 - share, durationMs, easing);
    showIcon(directIconRef.current, share, durationMs, easing);
  };
  const placeIconsRef = useRef(placeIcons);
  placeIconsRef.current = placeIcons;

  useImperativeHandle(
    ref,
    () => ({
      setPosition: (position, durationMs, easing) => {
        switchRef.current?.setPosition(position, durationMs, easing);
        placeIconsRef.current(position, durationMs, easing);
      },
    }),
    []
  );

  // Where the icons start; the pages below report every move after that.
  useLayoutEffect(() => {
    placeIconsRef.current(CHAT_SCOPES.indexOf(scope));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useAndroidBack(
    () => {
      setSettingsOpen(false);
      return true;
    },
    { priority: BACK_PRIORITY.dialog, enabled: settingsOpen }
  );

  const onGroups = scope === 'groups';
  const searchLabel = onGroups
    ? t('reticulum:rail.find_groups')
    : t('reticulum:dm_search.title', { postProcess: 'capitalizeFirstChar' });
  const createLabel = onGroups
    ? t('group:action.create_group', { postProcess: 'capitalizeFirstChar' })
    : t('core:action.new.chat', { postProcess: 'capitalizeFirstChar' });

  return (
    <Box sx={chatListHeaderSx}>
      <ChatScopeSwitch
        ref={switchRef}
        sliding
        directHasUnread={directHasUnread}
        directUnreadCount={directUnreadCount}
        onChange={onScopeChange}
        value={scope}
      />
      {share ? (
        <ChatShareChip
          share={share}
          picking={sharePicksChannel ? 'channel' : 'chat'}
          onCancel={() => onCancelShare?.()}
        />
      ) : null}
      {/* Hidden, not removed, while a share waits: the middle button's icons
          keep the place the pages gave them. */}
      <Box
        sx={{
          ...chatListHeaderActionsSx,
          ...(share ? { display: 'none' } : {}),
        }}
      >
        {/* The onboarding tour's "find groups" step points here on phones;
            the hidden rail keeps the desktop anchor. */}
        <IconButton
          aria-label={searchLabel}
          data-tour="hub-group-discovery"
          onClick={onGroups ? onFindGroups : onSearchMessages}
          sx={chatListHeaderButtonSx}
        >
          <SearchRoundedIcon sx={chatListHeaderIconSx} />
        </IconButton>
        <IconButton
          aria-label={createLabel}
          onClick={onGroups ? onCreateGroup : onNewChat}
          sx={chatListHeaderButtonSx}
        >
          <Box
            component="span"
            sx={{
              display: 'block',
              height: chatListHeaderIconSx.fontSize,
              position: 'relative',
              width: chatListHeaderIconSx.fontSize,
            }}
          >
            <Box component="span" ref={groupIconRef} sx={iconLayerSx}>
              <AddCircleOutlineIcon sx={chatListHeaderIconSx} />
            </Box>
            <Box component="span" ref={directIconRef} sx={iconLayerSx}>
              <CreateIcon sx={chatListHeaderIconSx} />
            </Box>
          </Box>
        </IconButton>
        <IconButton
          aria-label={t('core:settings', {
            postProcess: 'capitalizeFirstChar',
          })}
          onClick={() => setSettingsOpen(true)}
          sx={chatListHeaderButtonSx}
        >
          <SettingsOutlinedIcon sx={chatListHeaderIconSx} />
        </IconButton>
      </Box>
      <ReticulumChatSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </Box>
  );
}
