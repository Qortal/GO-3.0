import {
  Box,
  ButtonBase,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { ChatScopeSwitch } from './ChatScopeSwitch';
import GroupRoundedIcon from '@mui/icons-material/GroupRounded';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import CreateIcon from '@mui/icons-material/Create';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import MarkChatUnreadIcon from '@mui/icons-material/MarkChatUnread';
import PhoneMissedRoundedIcon from '@mui/icons-material/PhoneMissedRounded';
import { useTranslation } from 'react-i18next';
import React, { useCallback, useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  groupChatHasUnreadAtom,
  groupsAnnHasUnreadAtom,
} from '../../atoms/global';
import { CustomButton } from '../../styles/App-styles';
import { HubsIcon } from '../../assets/Icons/HubsIcon';
import { MessagingIcon } from '../../assets/Icons/MessagingIcon';
import { formatEmailDate } from './qmailUtils';
import { AvatarPreviewModal } from '../Chat/AvatarPreviewModal';
import { useAvatarPreviewSrc } from '../Chat/useAvatarPreviewSrc';
import { getBaseApiReact } from '../../utils/globalApi';
import { buildUserAvatarPreviewUrl } from './avatarPreviewUrls';
import { DirectRowAvatar } from './DirectRowAvatar';
import { rowAvatarPriority } from './useGroupRowAvatar';
import { effectivePresenceStatusAtomFamily } from '../../atoms/presence';
import type { DmFriendStored } from '../../atoms/global';
import { PresenceStatusBadge } from '../common/PresenceStatusBadge';
import { hasInvisibleCharacters } from '../../utils/hasInvisibleCharacters';
import { useChatDraftKeys } from '../../hooks/useChatDraftKeys';
import { directDraftKey } from '../../utils/chatPersistence';
import { DraftBadge } from '../Chat/DraftBadge';
import {
  CHAT_LIST_AVATAR_SIZE,
  CHAT_LIST_ICON_SIZE,
  chatListAvatarSlotSx,
  chatListHeaderButtonSx,
  chatListHeaderIconSx,
  chatListHeaderSx,
  chatListRowContentSx,
  chatListRowEdgeActionSx,
  chatListScrollPadding,
  chatListTextSx,
  getChatListPanelSx,
  getChatListRowSx,
  getChatListSubtitleSx,
  getChatListTitleSx,
} from './chatListRowStyles';

/** Renders only the presence badge for a single DM address.
 * Subscribes to per-address atoms so a change to any other peer
 * does NOT trigger a re-render of this component.
 */
const DirectsPresenceBadge = React.memo(
  ({
    address,
    children,
    disabled = false,
  }: {
    address: string;
    children: React.ReactNode;
    disabled?: boolean;
  }) => {
    const status = useAtomValue(effectivePresenceStatusAtomFamily(address));
    if (disabled) return <>{children}</>;
    return (
      <PresenceStatusBadge online={status !== null} status={status}>
        {children}
      </PresenceStatusBadge>
    );
  }
);

/** reticulum:call_history key for the outcome of a DM's last call. */
const callOutcomeKey = (outcome?: string) =>
  outcome === 'missed' ||
  outcome === 'declined' ||
  outcome === 'no_answer' ||
  outcome === 'cancelled'
    ? outcome
    : 'answered';

export interface DirectsSidebarProps {
  setDesktopSideView: (view: 'groups' | 'directs') => void;
  desktopSideView: string;
  directChatHasUnread: boolean;
  directs: any[];
  dmFriendsByAddress: Record<string, DmFriendStored>;
  setSelectedDirect: (direct: any) => void;
  setNewChat: (value: boolean) => void;
  setIsOpenDrawer: (value: boolean) => void;
  getTimestampEnterChat: () => Promise<any>;
  selectedDirect: any;
  timestampEnterData: Record<string, number>;
  timeDifferenceForNotificationChats: number;
  myAddress: string;
  isRunningPublicNode: boolean;
  setIsOpenBlockedUserModal: (value: boolean) => void;
  reticulumChatEnabled?: boolean;
}

export const DirectsSidebar = (props: DirectsSidebarProps) => {
  const groupChatHasUnread = useAtomValue(groupChatHasUnreadAtom);
  const groupsAnnHasUnread = useAtomValue(groupsAnnHasUnreadAtom);
  const {
    setDesktopSideView,
    desktopSideView,
    directChatHasUnread,
    directs,
    dmFriendsByAddress,
    setSelectedDirect,
    setNewChat,
    setIsOpenDrawer,
    getTimestampEnterChat,
    selectedDirect,
    timestampEnterData,
    timeDifferenceForNotificationChats,
    myAddress,
    isRunningPublicNode,
    setIsOpenBlockedUserModal,
    reticulumChatEnabled = false,
  } = props;

  const theme = useTheme();
  // Compact the legacy Groups/DM toggle on landscape phones (matches
  // GroupList). The Reticulum list has no such toggle, so it keeps its header
  // above the rows in landscape too.
  const isMobileWidth = useMediaQuery(theme.breakpoints.down('md'));
  const isLandscape = useMediaQuery('(orientation: landscape)');
  const compactToggle = isMobileWidth && isLandscape && !reticulumChatEnabled;
  // Phones (and the legacy list) use the shared Q-Chat list rows, the same as
  // the Groups list; only the narrow desktop Reticulum DM column keeps its
  // compact rows.
  const compactRows = reticulumChatEnabled && !isMobileWidth;
  const phoneReticulumList = reticulumChatEnabled && isMobileWidth;
  const { t } = useTranslation(['core', 'group', 'reticulum']);
  const draftKeys = useChatDraftKeys(myAddress);
  // Tap on a DM avatar: the picture on screen at once, the full-size image
  // from the node once it has loaded.
  const {
    previewSrc: dmAvatarPreviewSrc,
    showPreview: showDmAvatarPreview,
    clearPreview: clearDmAvatarPreview,
  } = useAvatarPreviewSrc();
  const [dmAvatarPreviewAlt, setDmAvatarPreviewAlt] = useState('');
  const openDmAvatarPreview = useCallback(
    (name: string | undefined, shownSrc: string, alt: string) => {
      const fullSrc = buildUserAvatarPreviewUrl(getBaseApiReact(), name);
      if (showDmAvatarPreview(fullSrc, shownSrc)) setDmAvatarPreviewAlt(alt);
    },
    [showDmAvatarPreview]
  );
  const directUnreadCount = directs.reduce(
    (total, direct) => total + Math.max(0, Number(direct?.unreadCount || 0)),
    0
  );

  return (
    <Box
      sx={{
        // In landscape the layout is a row (list + right rail); children must
        // stretch to full height so the list can scroll. In portrait keep the
        // original top-aligned column.
        alignItems: compactToggle ? 'stretch' : 'flex-start',
        background: phoneReticulumList
          ? getChatListPanelSx(theme).background
          : theme.palette.background.surface,
        borderRadius: reticulumChatEnabled ? 0 : '0 15px 15px 0',
        borderRight: compactRows ? '1px solid' : 'none',
        borderColor: 'divider',
        boxShadow: reticulumChatEnabled
          ? 'none'
          : '6px 0 20px rgba(0,0,0,0.18), 2px 0 8px rgba(0,0,0,0.08)',
        display: 'flex',
        // Landscape: list on the left, a vertical toggle/action rail on the
        // right (no wasted top band). New Reticulum chat uses the fixed rail
        // widths from upstream instead.
        flexDirection: compactToggle ? 'row' : 'column',
        minHeight: 0,
        position: 'relative',
        height: '100%',
        width: reticulumChatEnabled
          ? { xs: '100%', md: 286 }
          : { xs: '100%', md: '400px' },
        // Phones give the DM list the whole surface beside the group rail.
        flex: reticulumChatEnabled ? { xs: 1, md: '0 0 auto' } : undefined,
        minWidth: 0,
        flexShrink: 0,
        padding: reticulumChatEnabled ? 0 : '0 2px 0 0',
      }}
    >
      {!reticulumChatEnabled && (
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
                  top: 8,
                  right: 8,
                  width: 14,
                  height: 14,
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
                gap: '10px',
                justifyContent: 'center',
                width: '100%',
              }}
            >
              <HubsIcon
                height={26}
                width={26}
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
              flex: 1,
              minWidth: 0,
              padding: '14px 12px',
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
                  top: 8,
                  right: 8,
                  width: 14,
                  height: 14,
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
                gap: '10px',
                justifyContent: 'center',
                width: '100%',
              }}
            >
              <MessagingIcon
                height={26}
                width={26}
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
        </Box>
      )}
      {reticulumChatEnabled && (
        <Box
          sx={{
            ...chatListHeaderSx,
            // The desktop column is narrower; phones match the Groups header.
            px: isMobileWidth ? chatListHeaderSx.px : '10px',
          }}
        >
          <Box sx={{ display: { xs: 'flex', md: 'none' }, minWidth: 0 }}>
            <ChatScopeSwitch
              directHasUnread={directChatHasUnread}
              directUnreadCount={directUnreadCount}
              onChange={setDesktopSideView}
              value="directs"
            />
          </Box>
          <Box
            sx={{
              display: { xs: 'none', md: 'block' },
              flex: 1,
              minWidth: 0,
            }}
          >
            <Typography
              sx={{
                color: 'text.primary',
                fontSize: 15,
                fontWeight: 800,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {t('group:dm.direct_messages')}
            </Typography>
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: 11,
                fontWeight: 600,
                mt: 0.25,
              }}
            >
              {t('reticulum:dm_list.subtitle')}
            </Typography>
          </Box>
          <Tooltip
            title={t('core:action.new.chat', {
              postProcess: 'capitalizeFirstChar',
            })}
          >
            <IconButton
              aria-label={t('core:action.new.chat', {
                postProcess: 'capitalizeFirstChar',
              })}
              size="small"
              onClick={() => {
                setNewChat(true);
                setSelectedDirect(null);
                setIsOpenDrawer(false);
              }}
              sx={
                isMobileWidth
                  ? chatListHeaderButtonSx
                  : { color: 'text.secondary', p: 0.5 }
              }
            >
              <CreateIcon
                sx={isMobileWidth ? chatListHeaderIconSx : { fontSize: 17 }}
              />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      <Box
        // The phone Groups / DMs pager keeps sideways swipes off this list.
        data-pager-scroller=""
        sx={{
          alignItems: 'flex-start',
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          minHeight: 0,
          minWidth: compactToggle ? 0 : undefined,
          order: compactToggle ? 1 : 0,
          overflowY: 'auto',
          padding: reticulumChatEnabled
            ? isMobileWidth
              ? chatListScrollPadding
              : '10px'
            : '12px 8px',
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
          {directs.length === 0 && (
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: 13,
                lineHeight: 1.45,
                px: 1,
                py: 1.5,
              }}
            >
              {t('reticulum:dm_list.empty')}
            </Typography>
          )}
          {directs.map((direct: any, index: number) => {
            const rowKey =
              direct?.address ||
              direct?.name ||
              `${direct?.timestamp}-${direct?.sender}`;
            const isSelected = direct?.address === selectedDirect?.address;
            const hasUnread =
              !reticulumChatEnabled &&
              direct?.sender !== myAddress &&
              direct?.timestamp &&
              ((!timestampEnterData[direct?.address] &&
                Date.now() - direct?.timestamp <
                  timeDifferenceForNotificationChats) ||
                timestampEnterData[direct?.address] < direct?.timestamp);
            const hasReticulumUnread =
              reticulumChatEnabled && Number(direct?.unreadCount || 0) > 0;
            const hasMissedCall =
              reticulumChatEnabled &&
              Number(direct?.unreadMissedCallCount || 0) > 0;
            const lastActivityIsCall = Boolean(
              reticulumChatEnabled &&
              direct?.lastCall &&
              Number(direct.lastCall.endedAt || 0) >=
                Number(direct?.lastMessageTimestamp || 0)
            );
            const callActivityLabel = t(
              `reticulum:call_history.${callOutcomeKey(direct?.lastCall?.outcome)}`,
              { postProcess: 'capitalizeFirstChar' }
            );
            const isDmFriend = Boolean(
              direct?.address && dmFriendsByAddress[direct.address]
            );
            const directName = direct?.name || direct?.address;
            const hasUnsafeName = Boolean(
              direct?.name && hasInvisibleCharacters(direct.name)
            );
            const hasDraft = Boolean(
              direct?.address && draftKeys.has(directDraftKey(direct.address))
            );
            const isUnread = Boolean(hasUnread || hasReticulumUnread);
            // Adding a friend is handled by the open DM chat (ChatDirect).
            // On phones the full list shows exactly when no DM is open, so a
            // row button would do nothing there: phones show only the Friend
            // badge and add friends from the chat header.
            const showFriendControl =
              direct?.savedMessages !== true && (isDmFriend || !isMobileWidth);

            return (
              <ListItem
                key={direct?.address || rowKey}
                onClick={() => {
                  setSelectedDirect(direct);
                  setNewChat(false);
                  setIsOpenDrawer(false);
                  window
                    .sendMessage('addTimestampEnterChat', {
                      timestamp: Date.now(),
                      groupId: direct.address,
                    })
                    .catch((error) => {
                      console.error(
                        'Failed to add timestamp:',
                        error.message || 'An error occurred'
                      );
                    });
                  getTimestampEnterChat();
                }}
                sx={[
                  compactRows
                    ? {
                        borderRadius: '10px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        marginBottom: '6px',
                        padding: '8px 9px',
                        position: 'relative',
                        width: '100%',
                        backgroundColor: isSelected
                          ? theme.palette.action.selected
                          : 'transparent',
                        transition:
                          'background-color 0.15s ease, border-color 0.15s ease',
                        '&::before': {
                          backgroundColor: isSelected
                            ? theme.palette.primary.main
                            : 'transparent',
                          borderRadius: '999px',
                          bottom: '5px',
                          content: '""',
                          left: 0,
                          position: 'absolute',
                          top: '5px',
                          width: '3px',
                        },
                        '&:hover': {
                          backgroundColor: isSelected
                            ? theme.palette.action.selected
                            : theme.palette.action.hover,
                        },
                      }
                    : getChatListRowSx(theme, { selected: isSelected }),
                  {
                    '&:hover .dm-friend-indicator': {
                      opacity: 1,
                    },
                  },
                ]}
              >
                <Box
                  sx={
                    compactRows
                      ? {
                          alignItems: 'center',
                          display: 'flex',
                          gap: '10px',
                          width: '100%',
                        }
                      : chatListRowContentSx
                  }
                >
                  <ListItemAvatar sx={chatListAvatarSlotSx}>
                    <DirectsPresenceBadge
                      address={direct?.address}
                      disabled={direct?.savedMessages === true}
                    >
                      <DirectRowAvatar
                        name={direct?.name}
                        label={direct?.name || direct?.address}
                        savedMessages={direct?.savedMessages === true}
                        size={compactRows ? 34 : CHAT_LIST_AVATAR_SIZE}
                        priority={rowAvatarPriority(index)}
                        onOpenPreview={(shownSrc) =>
                          openDmAvatarPreview(
                            direct?.name,
                            shownSrc,
                            direct?.name || direct?.address
                          )
                        }
                      />
                    </DirectsPresenceBadge>
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
                            ...(hasUnsafeName
                              ? {
                                  textDecorationLine: 'line-through',
                                  textDecorationThickness: '2px',
                                  textDecorationColor: theme.palette.error.main,
                                }
                              : {}),
                          }}
                        >
                          {directName}
                        </Box>
                        {hasDraft && <DraftBadge />}
                      </Box>
                    }
                    secondary={
                      !direct?.timestamp
                        ? t('core:message.generic.no_messages', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : lastActivityIsCall
                          ? `${callActivityLabel} • ${formatEmailDate(direct?.timestamp)}`
                          : t('group:last_message_date', {
                              date: formatEmailDate(direct?.timestamp),
                              postProcess: 'capitalizeFirstChar',
                            })
                    }
                    primaryTypographyProps={{
                      component: 'div',
                      sx: compactRows
                        ? {
                            color: isUnread
                              ? theme.palette.primary.main
                              : theme.palette.text.primary,
                            fontFamily: 'Inter',
                            fontSize: '13px',
                            fontWeight: 600,
                            lineHeight: 1.3,
                          }
                        : getChatListTitleSx(theme, isUnread),
                    }}
                    secondaryTypographyProps={{
                      sx: compactRows
                        ? {
                            color: theme.palette.text.secondary,
                            fontFamily: 'Inter',
                            fontSize: '11px',
                            lineHeight: 1.4,
                            marginTop: '3px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }
                        : getChatListSubtitleSx(theme),
                    }}
                    sx={chatListTextSx}
                  />

                  {showFriendControl && (
                    <Tooltip
                      title={
                        isDmFriend
                          ? t('core:dm_friends.friend_badge_aria', {
                              postProcess: 'capitalizeFirstChar',
                            })
                          : t('core:dm_friends.add_friend', {
                              postProcess: 'capitalizeFirstChar',
                            })
                      }
                    >
                      {isDmFriend ? (
                        <Box
                          component="span"
                          className="dm-friend-indicator"
                          aria-label={t('core:dm_friends.friend_badge_aria', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                          role="img"
                          sx={
                            isMobileWidth
                              ? {
                                  ...chatListRowEdgeActionSx,
                                  color: theme.palette.primary.main,
                                  order: 1,
                                }
                              : {
                                  color: theme.palette.primary.main,
                                  display: 'inline-flex',
                                  flexShrink: 0,
                                  marginLeft: '4px',
                                }
                          }
                        >
                          <GroupRoundedIcon
                            sx={{
                              fontSize: isMobileWidth
                                ? CHAT_LIST_ICON_SIZE
                                : '19px',
                            }}
                          />
                        </Box>
                      ) : (
                        <IconButton
                          className="dm-friend-indicator"
                          aria-label={t('core:dm_friends.add_friend', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            window.dispatchEvent(
                              new CustomEvent('qchat:add-dm-friend', {
                                detail: {
                                  address: direct?.address,
                                  name: direct?.name,
                                },
                              })
                            );
                          }}
                          size="small"
                          sx={{
                            color: theme.palette.text.secondary,
                            flexShrink: 0,
                            marginLeft: '4px',
                            // Desktop only: shown while the row is hovered
                            // or the button has keyboard focus.
                            opacity: 0,
                            padding: 0,
                            transition: 'opacity 0.15s ease',
                            '&:focus-visible, &.Mui-focusVisible': {
                              opacity: 1,
                            },
                            // A touch screen cannot hover, so the button
                            // would stay invisible yet tappable.
                            '@media (hover: none)': {
                              display: 'none',
                            },
                          }}
                        >
                          <GroupOutlinedIcon sx={{ fontSize: '19px' }} />
                        </IconButton>
                      )}
                    </Tooltip>
                  )}
                  {isUnread &&
                    (hasMissedCall ? (
                      <PhoneMissedRoundedIcon
                        sx={{
                          color: theme.palette.error.main,
                          fontSize: '18px',
                          flexShrink: 0,
                          marginLeft: '4px',
                        }}
                      />
                    ) : (
                      <MarkChatUnreadIcon
                        sx={{
                          color: theme.palette.primary.main,
                          fontSize: '18px',
                          flexShrink: 0,
                          marginLeft: '4px',
                        }}
                      />
                    ))}
                </Box>
              </ListItem>
            );
          })}
        </List>
      </Box>

      {!compactToggle && !reticulumChatEnabled && (
        <Box
          sx={{
            borderTop: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            width: '100%',
            gap: '10px',
            justifyContent: 'center',
            padding: '16px 12px',
          }}
        >
          <CustomButton
            onClick={() => {
              setNewChat(true);
              setSelectedDirect(null);
              setIsOpenDrawer(false);
            }}
            sx={{
              flex: 1,
              gap: '8px',
              padding: '10px 16px',
            }}
          >
            <CreateIcon
              sx={{
                color: theme.palette.text.primary,
                fontSize: '20px',
              }}
            />
            {t('core:action.new.chat', {
              postProcess: 'capitalizeFirstChar',
            })}
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

      <AvatarPreviewModal
        open={Boolean(dmAvatarPreviewSrc)}
        src={dmAvatarPreviewSrc || null}
        alt={dmAvatarPreviewAlt}
        onClose={clearDmAvatarPreview}
      />
    </Box>
  );
};
