import { useState, type ReactNode } from 'react';
import { useAtomValue } from 'jotai';
import {
  alpha,
  Avatar,
  ButtonBase,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CallIcon from '@mui/icons-material/Call';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded';
import SearchIcon from '@mui/icons-material/Search';
import InsertLinkIcon from '@mui/icons-material/InsertLink';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import {
  groupChatHasUnreadAtom,
  groupsAnnHasUnreadAtom,
  hasUnreadGroupsAtom,
  isUnreadChatAtomFamily,
  chatMentionUnreadAtom,
  mobileChatComposeActiveAtom,
  mobileChatHeaderCollapsedAtom,
  p2pHealthAtom,
  groupsOwnerNamesSelector,
} from '../../atoms/global';
import { buildGroupAvatarUrl } from '../../utils/groupAvatarUrl';
import { executeEvent } from '../../utils/events';
import {
  CHAT_OPTION_SEARCH_EVENT,
  CHAT_OPTION_MENTIONS_EVENT,
  CHAT_OPTION_QMANAGER_EVENT,
} from '../Chat/ChatOptions';
import Box from '@mui/material/Box';
import { NotificationIcon2 } from '../../assets/Icons/NotificationIcon2';
import { ChatIcon } from '../../assets/Icons/ChatIcon';
import { ThreadsIcon } from '../../assets/Icons/ThreadsIcon';
import { MembersIcon } from '../../assets/Icons/MembersIcon';
import { AdminsIcon } from '../../assets/Icons/AdminsIcon';
import LockIcon from '@mui/icons-material/Lock';
import NoEncryptionGmailerrorredIcon from '@mui/icons-material/NoEncryptionGmailerrorred';
import { useTranslation } from 'react-i18next';

const IconWrapper = ({
  children,
  label,
  color,
  selected,
  selectColor,
  customHeight,
}: {
  children: ReactNode;
  label: string;
  color: string;
  selected: boolean;
  selectColor?: string;
  customHeight?: string;
}) => {
  return (
    <Box
      sx={{
        alignItems: 'center',
        backgroundColor: selected
          ? selectColor || 'rgba(28, 29, 32, 1)'
          : 'transparent',
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        height: customHeight || '60px',
        justifyContent: 'center',
        minWidth: '72px',
        padding: '8px 4px',
        transition: 'background-color 0.15s ease',
      }}
    >
      {children}
      <Typography
        sx={{
          color: color,
          fontFamily: 'Inter',
          fontSize: '11px',
          fontWeight: 500,
          letterSpacing: '0.01em',
          lineHeight: 1.2,
          textAlign: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Typography>
    </Box>
  );
};

export const DesktopHeader = ({
  selectedGroup,
  groupSection,
  isUnread,
  goToAnnouncements,
  goToChat,
  goToThreads,
  setOpenManageMembers,
  directChatHasUnread,
  chatMode,
  openDrawerGroups,
  goToHome,
  mobileViewMode,
  setMobileViewMode,
  setMobileViewModeKeepOpen,
  hasUnreadDirects,
  isHome,
  isGroups,
  isDirects,
  setDesktopSideView,
  hasUnreadAnnouncements,
  isAnnouncement,
  isChat,
  isForum,
  setGroupSection,
  isPrivate,
  onGroupCallClick,
  groupCallInCall = false,
  groupCallJoining = false,
  groupCallDisabled = false,
  groupCallTooltip = '',
  isMobile = false,
  onMobileBack,
}) => {
  const [value, setValue] = useState(0);
  const p2pHealth = useAtomValue(p2pHealthAtom);
  const theme = useTheme();
  const groupChatHasUnread = useAtomValue(groupChatHasUnreadAtom);
  const groupsAnnHasUnread = useAtomValue(groupsAnnHasUnreadAtom);
  const hasUnreadGroups = useAtomValue(hasUnreadGroupsAtom);
  const isUnreadChat = useAtomValue(
    isUnreadChatAtomFamily(selectedGroup?.groupId ?? '')
  );
  const hasUnreadChat = isUnreadChat;
  const groupOwnerName = useAtomValue(
    groupsOwnerNamesSelector(selectedGroup?.groupId ?? '')
  );
  const isGeneralGroup = selectedGroup?.groupId === '0';
  const groupAvatarUrl = isGeneralGroup
    ? null
    : buildGroupAvatarUrl(groupOwnerName, selectedGroup?.groupId);
  const groupAvatarFallback = (selectedGroup?.groupName || '?')
    .trim()
    .charAt(0)
    .toUpperCase();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const p2pHealthBadTooltip = t('core:p2p_health_bad_call_tooltip');
  const p2pBlocked =
    typeof onGroupCallClick === 'function' &&
    !groupCallInCall &&
    !groupCallJoining &&
    p2pHealth !== 'good';
  const effectiveGroupCallDisabled =
    groupCallDisabled || groupCallJoining || p2pBlocked;
  const effectiveGroupCallTooltip =
    groupCallTooltip || (p2pBlocked ? p2pHealthBadTooltip : '');

  const chatComposeActive = useAtomValue(mobileChatComposeActiveAtom);
  const headerCollapsed = useAtomValue(mobileChatHeaderCollapsedAtom);
  const mentionUnread = useAtomValue(chatMentionUnreadAtom);
  // Only reclaim header space by collapsing the section tabs in landscape,
  // where vertical room is scarce.
  const isLandscape = useMediaQuery('(orientation: landscape)');
  const collapseSectionTabs = isMobile && isLandscape && headerCollapsed;

  if (isMobile) {
    if (chatComposeActive) {
      return null;
    }
    const isGeneral = selectedGroup?.groupId === '0';
    const sections: Array<{
      key: string;
      label: string;
      selected: boolean;
      onClick: () => void;
      unread?: boolean;
      render: (color: string) => ReactNode;
    }> = [
      {
        key: 'announcement',
        label: t('core:announcement', { postProcess: 'capitalizeFirstChar' }),
        selected: isAnnouncement,
        onClick: goToAnnouncements,
        unread: isUnread,
        render: (c) => <NotificationIcon2 height={22} width={18} color={c} />,
      },
      {
        key: 'chat',
        label: t('core:chat', { postProcess: 'capitalizeFirstChar' }),
        selected: isChat,
        onClick: goToChat,
        unread: hasUnreadChat,
        render: (c) => <ChatIcon height={22} width={18} color={c} />,
      },
      {
        key: 'forum',
        label: t('core:thread_other', { postProcess: 'capitalizeFirstChar' }),
        selected: isForum,
        onClick: () => setGroupSection('forum'),
        render: (c) => <ThreadsIcon height={22} width={18} color={c} />,
      },
      {
        key: 'members',
        label: t('group:group.member_other', {
          postProcess: 'capitalizeFirstChar',
        }),
        selected: false,
        onClick: () => setOpenManageMembers(true),
        render: (c) => <MembersIcon height={22} width={18} color={c} />,
      },
      {
        key: 'adminSpace',
        label: t('core:admin_other', { postProcess: 'capitalizeFirstChar' }),
        selected: groupSection === 'adminSpace',
        onClick: () => setGroupSection('adminSpace'),
        render: (c) => <AdminsIcon height={22} width={18} color={c} />,
      },
    ];

    return (
      <Box
        sx={{
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          flexShrink: 0,
          zIndex: 1,
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '6px',
            height: '50px',
            padding: '0 6px 0 2px',
            width: '100%',
          }}
        >
          <IconButton
            aria-label="Back to chats"
            onClick={() => onMobileBack?.()}
            sx={{ flexShrink: 0 }}
          >
            <ArrowBackIosNewRoundedIcon sx={{ fontSize: 20 }} />
          </IconButton>

          {isPrivate && (
            <LockIcon
              sx={{ color: theme.palette.other.positive, fontSize: '18px' }}
            />
          )}
          {isPrivate === false && (
            <NoEncryptionGmailerrorredIcon
              sx={{ color: theme.palette.other.danger, fontSize: '18px' }}
            />
          )}

          {!isGeneral && (
            <Avatar
              src={groupAvatarUrl || undefined}
              alt={selectedGroup?.groupName || 'Group'}
              sx={{
                width: 26,
                height: 26,
                flexShrink: 0,
                fontSize: 13,
                fontWeight: 700,
                bgcolor: alpha(theme.palette.primary.main, 0.16),
                color: theme.palette.primary.main,
              }}
            >
              {groupAvatarFallback}
            </Avatar>
          )}

          <Typography
            sx={{
              flex: 1,
              minWidth: 0,
              fontSize: '16px',
              fontWeight: 700,
              letterSpacing: '0.01em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {isGeneral
              ? t('core:general', { postProcess: 'capitalizeFirstChar' })
              : selectedGroup?.groupName}
          </Typography>

          {isChat && (
            <Box sx={{ alignItems: 'center', display: 'flex', flexShrink: 0 }}>
              <IconButton
                aria-label={t('core:action.search', {
                  postProcess: 'capitalizeFirstChar',
                })}
                onClick={() => executeEvent(CHAT_OPTION_SEARCH_EVENT, {})}
                size="small"
              >
                <SearchIcon
                  sx={{ fontSize: 21, color: theme.palette.text.secondary }}
                />
              </IconButton>
              <IconButton
                aria-label={t('core:q_apps.q_manager', {
                  postProcess: 'capitalizeFirstChar',
                })}
                onClick={() => executeEvent(CHAT_OPTION_QMANAGER_EVENT, {})}
                size="small"
              >
                <InsertLinkIcon
                  sx={{ fontSize: 21, color: theme.palette.text.secondary }}
                />
              </IconButton>
              <IconButton
                aria-label={t('core:message.generic.mentioned', {
                  postProcess: 'capitalizeFirstChar',
                })}
                onClick={() => executeEvent(CHAT_OPTION_MENTIONS_EVENT, {})}
                size="small"
              >
                <AlternateEmailIcon
                  sx={{
                    fontSize: 21,
                    color: mentionUnread
                      ? theme.palette.other.unread
                      : theme.palette.text.secondary,
                  }}
                />
              </IconButton>
            </Box>
          )}

          {!isGeneral && typeof onGroupCallClick === 'function' && (
            <Tooltip
              title={effectiveGroupCallTooltip}
              disableHoverListener={!effectiveGroupCallTooltip}
            >
              <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                <IconButton
                  aria-label={t('core:group_call', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  disabled={effectiveGroupCallDisabled}
                  onClick={onGroupCallClick}
                  sx={{
                    backgroundColor:
                      groupCallInCall || groupCallJoining
                        ? theme.palette.action.selected
                        : 'transparent',
                  }}
                >
                  {groupCallJoining ? (
                    <CircularProgress
                      size={20}
                      sx={{ color: theme.palette.text.secondary }}
                    />
                  ) : groupCallInCall ? (
                    <CallEndRoundedIcon
                      sx={{ fontSize: 22, color: theme.palette.error.light }}
                    />
                  ) : (
                    <CallIcon
                      sx={{ fontSize: 22, color: theme.palette.text.secondary }}
                    />
                  )}
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>

        {!isGeneral && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'stretch',
              gap: '4px',
              padding: collapseSectionTabs ? '0 6px' : '0 6px 8px',
              // Fixed row: all sections share the width, no horizontal swipe.
              overflowX: 'hidden',
              overflowY: 'hidden',
              // Collapse out of the way once the conversation is scrolled
              // (landscape only) so messages get the vertical space back.
              maxHeight: collapseSectionTabs ? 0 : 80,
              opacity: collapseSectionTabs ? 0 : 1,
              pointerEvents: collapseSectionTabs ? 'none' : 'auto',
              transition:
                'max-height 0.22s ease, opacity 0.18s ease, padding 0.22s ease',
            }}
          >
            {sections.map((section) => {
              const color = section.selected
                ? theme.palette.primary.main
                : theme.palette.text.secondary;
              const iconColor = section.unread
                ? theme.palette.other.unread
                : color;
              return (
                <ButtonBase
                  key={section.key}
                  onClick={section.onClick}
                  aria-label={section.label}
                  aria-current={section.selected ? 'true' : undefined}
                  sx={{
                    flex: '1 1 0',
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    padding: '7px 4px',
                    borderRadius: '12px',
                    backgroundColor: section.selected
                      ? theme.palette.action.selected
                      : 'transparent',
                    transition: 'background-color 0.15s ease, transform 120ms ease',
                    '&:active': { transform: 'scale(0.94)' },
                  }}
                >
                  {section.render(iconColor)}
                  <Typography
                    sx={{
                      color,
                      fontSize: '11px',
                      fontWeight: section.selected ? 700 : 500,
                      lineHeight: 1.1,
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {section.label}
                  </Typography>
                </ButtonBase>
              );
            })}
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        alignItems: 'center',
        borderBottom: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        height: '64px',
        justifyContent: 'space-between',
        padding: '0 16px',
        width: '100%',
        zIndex: 1,
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: '10px',
        }}
      >
        {isPrivate && (
          <LockIcon
            sx={{
              color: theme.palette.other.positive,
              fontSize: '20px',
            }}
          />
        )}

        {isPrivate === false && (
          <NoEncryptionGmailerrorredIcon
            sx={{
              color: theme.palette.other.danger,
              fontSize: '20px',
            }}
          />
        )}

        {!isGeneralGroup && (
          <Avatar
            src={groupAvatarUrl || undefined}
            alt={selectedGroup?.groupName || 'Group'}
            sx={{
              width: 28,
              height: 28,
              flexShrink: 0,
              fontSize: 14,
              fontWeight: 700,
              bgcolor: alpha(theme.palette.primary.main, 0.16),
              color: theme.palette.primary.main,
            }}
          >
            {groupAvatarFallback}
          </Avatar>
        )}

        <Typography
          sx={{
            fontSize: '16px',
            fontWeight: 600,
            letterSpacing: '0.01em',
          }}
        >
          {selectedGroup?.groupId === '0'
            ? t('core:general', { postProcess: 'capitalizeFirstChar' })
            : selectedGroup?.groupName}
        </Typography>
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: '8px',
          visibility: selectedGroup?.groupId === '0' ? 'hidden' : 'visible',
        }}
      >
        {typeof onGroupCallClick === 'function' && (
          <Tooltip
            title={effectiveGroupCallTooltip}
            disableHoverListener={!effectiveGroupCallTooltip}
          >
            <span style={{ display: 'inline-flex' }}>
              <ButtonBase
                disabled={effectiveGroupCallDisabled}
                onClick={onGroupCallClick}
                sx={{
                  borderRadius: '12px',
                  '&:hover': {
                    backgroundColor: theme.palette.action.hover,
                  },
                }}
              >
                <IconWrapper
                  color={
                    groupCallInCall || groupCallJoining
                      ? theme.palette.text.primary
                      : theme.palette.text.secondary
                  }
                  label={
                    groupCallJoining
                      ? t('core:group_call_joining', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : groupCallInCall
                        ? t('core:group_call_leave', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : t('core:group_call', {
                            postProcess: 'capitalizeFirstChar',
                          })
                  }
                  selected={groupCallInCall || groupCallJoining}
                  selectColor={theme.palette.action.selected}
                  customHeight="55px"
                >
                  {groupCallJoining ? (
                    <CircularProgress
                      size={22}
                      sx={{
                        color: theme.palette.text.secondary,
                      }}
                    />
                  ) : groupCallInCall ? (
                    <CallEndRoundedIcon
                      sx={{
                        fontSize: 25,
                        color: theme.palette.error.light,
                      }}
                    />
                  ) : (
                    <CallIcon
                      sx={{
                        fontSize: 25,
                        color: theme.palette.text.secondary,
                      }}
                    />
                  )}
                </IconWrapper>
              </ButtonBase>
            </span>
          </Tooltip>
        )}

        <ButtonBase
          onClick={() => {
            goToAnnouncements();
          }}
        >
          <IconWrapper
            color={
              isAnnouncement
                ? theme.palette.text.primary
                : theme.palette.text.secondary
            }
            label={t('core:announcement', {
              postProcess: 'capitalizeFirstChar',
            })}
            selected={isAnnouncement}
            selectColor={theme.palette.action.selected}
            customHeight="55px"
          >
            <NotificationIcon2
              height={25}
              width={20}
              color={
                isUnread
                  ? theme.palette.other.unread
                  : isAnnouncement
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            goToChat();
          }}
          sx={{
            borderRadius: '12px',
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
            },
          }}
        >
          <IconWrapper
            color={
              isChat ? theme.palette.text.primary : theme.palette.text.secondary
            }
            label={t('core:chat', { postProcess: 'capitalizeFirstChar' })}
            selected={isChat}
            selectColor={theme.palette.action.selected}
            customHeight="56px"
          >
            <ChatIcon
              height={25}
              width={20}
              color={
                isUnreadChat
                  ? theme.palette.other.unread
                  : isChat
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            setGroupSection('forum');
          }}
          sx={{
            borderRadius: '12px',
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
            },
          }}
        >
          <IconWrapper
            color={
              isForum
                ? theme.palette.text.primary
                : theme.palette.text.secondary
            }
            label={t('core:thread_other', {
              postProcess: 'capitalizeFirstChar',
            })}
            selected={isForum}
            selectColor={theme.palette.action.selected}
            customHeight="56px"
          >
            <ThreadsIcon
              height={25}
              width={20}
              color={
                isForum
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            setOpenManageMembers(true);
          }}
          sx={{
            borderRadius: '12px',
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
            },
          }}
        >
          <IconWrapper
            color={theme.palette.text.secondary}
            customHeight="56px"
            label={t('group:group.member_other', {
              postProcess: 'capitalizeFirstChar',
            })}
            selected={false}
          >
            <MembersIcon
              color={theme.palette.text.secondary}
              height={25}
              width={20}
            />
          </IconWrapper>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            setGroupSection('adminSpace');
          }}
          sx={{
            borderRadius: '12px',
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
            },
          }}
        >
          <IconWrapper
            color={
              groupSection === 'adminSpace'
                ? theme.palette.text.primary
                : theme.palette.text.secondary
            }
            label={t('core:admin_other', {
              postProcess: 'capitalizeFirstChar',
            })}
            selected={groupSection === 'adminSpace'}
            customHeight="56px"
            selectColor={theme.palette.action.selected}
          >
            <AdminsIcon
              height={25}
              width={20}
              color={
                groupSection === 'adminSpace'
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        </ButtonBase>
      </Box>
    </Box>
  );
};
