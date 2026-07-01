import {
  Avatar,
  Box,
  ButtonBase,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import CreateIcon from '@mui/icons-material/Create';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import MarkChatUnreadIcon from '@mui/icons-material/MarkChatUnread';
import { useTranslation } from 'react-i18next';
import React from 'react';
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
import {
  getClickableAvatarSx,
  getFallbackAvatarOutlineSx,
} from '../Chat/clickableAvatarStyles';
import { isOnlineAtomFamily, statusAtomFamily } from '../../atoms/presence';
import type { DmFriendStored } from '../../atoms/global';
import { PresenceStatusBadge } from '../common/PresenceStatusBadge';
import { hasInvisibleCharacters } from '../../utils/hasInvisibleCharacters';
import { useChatDraftKeys } from '../../hooks/useChatDraftKeys';
import { directDraftKey } from '../../utils/chatPersistence';
import { DraftBadge } from '../Chat/DraftBadge';

/** Renders only the presence badge for a single DM address.
 * Subscribes to per-address atoms so a change to any other peer
 * does NOT trigger a re-render of this component.
 */
const DirectsPresenceBadge = React.memo(
  ({
    address,
    children,
  }: {
    address: string;
    children: React.ReactNode;
  }) => {
    const isOnline = useAtomValue(isOnlineAtomFamily(address));
    const status = useAtomValue(statusAtomFamily(address));
    return (
      <PresenceStatusBadge online={isOnline} status={status}>
        {children}
      </PresenceStatusBadge>
    );
  }
);

export interface DirectsSidebarProps {
  setDesktopSideView: (view: 'groups' | 'directs') => void;
  desktopSideView: string;
  directChatHasUnread: boolean;
  directs: any[];
  dmFriendsByAddress: Record<string, DmFriendStored>;
  getUserAvatarUrl: (name?: string) => string;
  directAvatarLoaded: Record<string, boolean>;
  setDirectAvatarLoaded: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  setSelectedDirect: (direct: any) => void;
  setNewChat: (value: boolean) => void;
  setIsOpenDrawer: (value: boolean) => void;
  getTimestampEnterChat: () => Promise<any>;
  selectedDirect: any;
  timestampEnterData: Record<string, number>;
  timeDifferenceForNotificationChats: number;
  myAddress: string;
  openAvatarPreview: (src: string | null, alt?: string) => void;
  avatarPreviewData: { src: string; alt: string } | null;
  closeAvatarPreview: () => void;
  isRunningPublicNode: boolean;
  setIsOpenBlockedUserModal: (value: boolean) => void;
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
    getUserAvatarUrl,
    directAvatarLoaded,
    setDirectAvatarLoaded,
    setSelectedDirect,
    setNewChat,
    setIsOpenDrawer,
    getTimestampEnterChat,
    selectedDirect,
    timestampEnterData,
    timeDifferenceForNotificationChats,
    myAddress,
    openAvatarPreview,
    avatarPreviewData,
    closeAvatarPreview,
    isRunningPublicNode,
    setIsOpenBlockedUserModal,
  } = props;

  const theme = useTheme();
  // Compact the Groups/DM toggle on landscape phones (matches GroupList).
  const isMobileWidth = useMediaQuery(theme.breakpoints.down('md'));
  const isLandscape = useMediaQuery('(orientation: landscape)');
  const compactToggle = isMobileWidth && isLandscape;
  const { t } = useTranslation();
  const draftKeys = useChatDraftKeys(myAddress);

  return (
    <Box
      sx={{
        // In landscape the layout is a row (list + right rail); children must
        // stretch to full height so the list can scroll. In portrait keep the
        // original top-aligned column.
        alignItems: compactToggle ? 'stretch' : 'flex-start',
        background: theme.palette.background.surface,
        borderRadius: '0 15px 15px 0',
        boxShadow: '6px 0 20px rgba(0,0,0,0.18), 2px 0 8px rgba(0,0,0,0.08)',
        display: 'flex',
        // Landscape: list on the left, a vertical toggle/action rail on the
        // right (no wasted top band).
        flexDirection: compactToggle ? 'row' : 'column',
        minHeight: 0,
        position: 'relative',
        // Fixed 400px rail only on real desktop (md+); below that (incl.
        // landscape phones) it fills the width so the list isn't stuck on
        // the left with empty space beside it.
        width: { xs: '100%', md: '400px' },
        flexShrink: 0,
        padding: '0 2px 0 0',
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
                setNewChat(true);
                setSelectedDirect(null);
                setIsOpenDrawer(false);
              }}
              sx={{
                flex: '0 0 auto',
                flexDirection: 'column',
                fontSize: '11px',
                gap: '4px',
                lineHeight: 1.1,
                minWidth: 'unset',
                padding: '8px 4px',
                textAlign: 'center',
                width: '100%',
              }}
            >
              <CreateIcon
                sx={{ color: theme.palette.text.primary, fontSize: '20px' }}
              />
              {t('core:action.new.chat', { postProcess: 'capitalizeFirstChar' })}
            </CustomButton>

            {!isRunningPublicNode && (
              <CustomButton
                onClick={() => {
                  setIsOpenBlockedUserModal(true);
                }}
                sx={{ flex: '0 0 auto', minWidth: 'unset', padding: '8px', width: '100%' }}
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
          minHeight: 0,
          minWidth: compactToggle ? 0 : undefined,
          order: compactToggle ? 1 : 0,
          overflowY: 'auto',
          padding: '12px 8px',
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
          {directs.map((direct: any) => {
            const avatarUrl = getUserAvatarUrl(direct?.name);
            const avatarKey =
              direct?.address ||
              direct?.name ||
              `${direct?.timestamp}-${direct?.sender}`;
            const isAvatarLoaded = Boolean(
              avatarUrl && avatarKey && directAvatarLoaded[avatarKey]
            );
            const isSelected = direct?.address === selectedDirect?.address;
            const hasUnread =
              direct?.sender !== myAddress &&
              direct?.timestamp &&
              ((!timestampEnterData[direct?.address] &&
                Date.now() - direct?.timestamp <
                  timeDifferenceForNotificationChats) ||
                timestampEnterData[direct?.address] < direct?.timestamp);
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

            return (
              <ListItem
                key={direct?.address || avatarKey}
                onClick={() => {
                  setSelectedDirect(null);
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

                  setTimeout(() => {
                    setSelectedDirect(direct);

                    getTimestampEnterChat();
                  }, 200);
                }}
                sx={{
                  borderRadius: '10px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  marginBottom: '6px',
                  padding: '12px 14px',
                  width: '100%',
                  backgroundColor: isSelected
                    ? theme.palette.action.selected
                    : 'transparent',
                  borderLeft: isSelected
                    ? `3px solid ${theme.palette.primary.main}`
                    : '3px solid transparent',
                  transition:
                    'background-color 0.15s ease, border-color 0.15s ease',
                  '&:hover': {
                    backgroundColor: isSelected
                      ? theme.palette.action.selected
                      : theme.palette.action.hover,
                  },
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: '20px',
                    width: '100%',
                  }}
                >
                  <ListItemAvatar sx={{ minWidth: 44, marginRight: 0 }}>
                    <DirectsPresenceBadge address={direct?.address}>
                      <Avatar
                        sx={{
                          height: 40,
                          width: 40,
                          background: theme.palette.background.surface,
                          color: theme.palette.text.primary,
                          ...(!isAvatarLoaded
                            ? getFallbackAvatarOutlineSx(theme)
                            : {}),
                          ...getClickableAvatarSx(theme, isAvatarLoaded),
                        }}
                        alt={direct?.name || direct?.address}
                        src={avatarUrl}
                        onClick={(event) => {
                          if (!avatarUrl || !isAvatarLoaded) return;
                          event.preventDefault();
                          event.stopPropagation();
                          openAvatarPreview(
                            avatarUrl,
                            direct?.name || direct?.address
                          );
                        }}
                        imgProps={{
                          onLoad: () => {
                            if (!avatarKey) return;
                            setDirectAvatarLoaded((prev) => {
                              if (prev[avatarKey]) return prev;
                              return {
                                ...prev,
                                [avatarKey]: true,
                              };
                            });
                          },
                          onError: () => {
                            if (!avatarKey) return;
                            setDirectAvatarLoaded((prev) => {
                              if (prev[avatarKey] === false) return prev;
                              return {
                                ...prev,
                                [avatarKey]: false,
                              };
                            });
                          },
                        }}
                      >
                        {(direct?.name || direct?.address)?.charAt(0)}
                      </Avatar>
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
                        : t('group:last_message_date', {
                            date: formatEmailDate(direct?.timestamp),
                            postProcess: 'capitalizeFirstChar',
                          })
                    }
                    primaryTypographyProps={{
                      component: 'div',
                      sx: {
                        color: hasUnread
                          ? theme.palette.primary.main
                          : theme.palette.text.primary,
                        fontFamily: 'Inter',
                        fontSize: '15px',
                        fontWeight: 600,
                        lineHeight: 1.3,
                      },
                    }}
                    secondaryTypographyProps={{
                      sx: {
                        color: theme.palette.text.secondary,
                        fontFamily: 'Inter',
                        fontSize: '12px',
                        lineHeight: 1.4,
                        marginTop: '3px',
                      },
                    }}
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      margin: 0,
                      overflow: 'hidden',
                    }}
                  />

                  {isDmFriend && (
                    <Tooltip title={t('core:dm_friends.friend_badge_aria')}>
                      <StarRoundedIcon
                        aria-label={t('core:dm_friends.friend_badge_aria')}
                        sx={{
                          color: theme.palette.warning.main,
                          fontSize: '20px',
                          flexShrink: 0,
                          marginLeft: '4px',
                        }}
                      />
                    </Tooltip>
                  )}
                  {hasUnread && (
                    <MarkChatUnreadIcon
                      sx={{
                        color: theme.palette.primary.main,
                        fontSize: '18px',
                        flexShrink: 0,
                        marginLeft: '4px',
                      }}
                    />
                  )}
                </Box>
              </ListItem>
            );
          })}
        </List>
      </Box>

      {!compactToggle && (
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
        open={Boolean(avatarPreviewData)}
        src={avatarPreviewData?.src || null}
        alt={avatarPreviewData?.alt}
        onClose={closeAvatarPreview}
      />
    </Box>
  );
};
