import {
  Avatar,
  Box,
  ButtonBase,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import CallRoundedIcon from '@mui/icons-material/CallRounded';
import PersonAddRoundedIcon from '@mui/icons-material/PersonAddRounded';
import PersonRemoveRoundedIcon from '@mui/icons-material/PersonRemoveRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import { useShownQdnAvatarSrc } from '../../hooks/useShownQdnAvatarSrc';
import { type GoLayout, useGoLayout } from '../../layout/goLayout';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { getBaseApiReact } from '../../utils/globalApi';
import { buildUserAvatarPreviewUrl } from '../Group/avatarPreviewUrls';
import { mergeAvatarSx } from '../Group/CachedAvatars';
import { SavedMessagesLogo } from '../Group/SavedMessagesLogo';
import { AvatarPreviewModal } from './AvatarPreviewModal';
import { getFallbackAvatarOutlineSx } from './clickableAvatarStyles';
import {
  CHAT_HEADER_PHONE_GUTTER_PX,
  CHAT_HEADER_PHONE_HEIGHT_PX,
  getChatHeaderActionMetrics,
  getChatHeaderActionSx,
  getChatHeaderBackSx,
  HOVER_CAPABLE_MEDIA,
} from './chatHeaderActionStyles';
import { useAvatarPreviewSrc } from './useAvatarPreviewSrc';
import { isGoCallUi } from '../Mobile/call/goCallUi';
import {
  isCallNetworkWarmingUp,
  openGoCallScreen,
  showCallHint,
} from '../Mobile/call/callHints';

/** Partner picture in the phone DM header, the size of the group's. */
const DIRECT_HEADER_AVATAR_PX = 36;
/** Glyph size of the desktop header icons, kept as it was. */
const DESKTOP_ICON_PX = 20;
const selectChatTwoPane = (l: GoLayout) => l.chatTwoPane;

type DirectChatHeaderPartner = {
  name?: string | null;
  address?: string | null;
  /** The user's own "saved messages" chat. */
  savedMessages?: boolean;
};

export type DirectChatHeaderCall = {
  /** Voice calls are available at all (Reticulum is running). */
  enabled: boolean;
  /** A call with this partner is connected: the button hangs up. */
  connected: boolean;
  /** A call with this partner is ringing out. */
  ringing: boolean;
  /**
   * GO: the partner can be rung although shown offline (their GO was heard
   * within the hour; lib/call/recentCallEndpoint). Defaults to peerOnline.
   */
  peerCallable?: boolean;
  blockedByFriend: boolean;
  blockedByP2p: boolean;
  /** Why a bad peer-to-peer connection blocks the call. */
  p2pBlockedTooltip: string;
  onStart: () => void;
  onHangUp: () => void;
};

export type DirectChatHeaderProps = {
  /** Below the `md` breakpoint: big touch targets and the partner avatar. */
  isMobile: boolean;
  /** The Reticulum DM look (an icon-only back button, no address line). */
  reticulumDirectUiEnabled: boolean;
  isNewChat: boolean;
  isSelfDirect: boolean;
  partner?: DirectChatHeaderPartner | null;
  onClose: () => void;
  peerOnline: boolean;
  /** The partner is hidden: offer to unhide them. */
  peerHidden: boolean;
  unhideBusy: boolean;
  onUnhide: () => void;
  isFriend: boolean;
  friendActionBusy: boolean;
  onToggleFriend: () => void;
  call: DirectChatHeaderCall;
};

type HeaderAvatarProps = {
  name?: string | null;
  label: string;
  savedMessages: boolean;
  onOpenPreview: (shownSrc: string) => void;
};

/**
 * The partner's picture from the device avatar cache (it shows at once, also
 * on a slow node), the first letter while there is none. A shown picture
 * opens the preview; the tap area is 44px around the 36px picture.
 */
function DirectChatHeaderAvatar({
  name,
  label,
  savedMessages,
  onOpenPreview,
}: HeaderAvatarProps) {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  // A picture the WebView cannot show counts as none (letter, no preview).
  const { shownSrc, onImgError } = useShownQdnAvatarSrc(name, {
    savedMessages,
    priority: 'high',
  });
  const avatarSx: SxProps<Theme> = mergeAvatarSx(
    {
      background: theme.palette.background.surface,
      color: theme.palette.text.primary,
      fontSize: 16,
      fontWeight: 700,
      height: DIRECT_HEADER_AVATAR_PX,
      width: DIRECT_HEADER_AVATAR_PX,
    },
    shownSrc ? undefined : getFallbackAvatarOutlineSx(theme)
  );
  const avatar = (
    <Avatar
      alt={label}
      data-qdn-avatar={shownSrc ? 'shown' : 'fallback'}
      imgProps={{ onError: onImgError }}
      src={shownSrc}
      sx={avatarSx}
    >
      {savedMessages ? <SavedMessagesLogo /> : label.charAt(0).toUpperCase()}
    </Avatar>
  );
  const slotSx = {
    alignItems: 'center',
    borderRadius: '50%',
    display: 'inline-flex',
    flexShrink: 0,
    height: 44,
    justifyContent: 'center',
    // The tap area grows past the picture without moving it.
    m: '-4px',
    width: 44,
  } as const;

  if (!shownSrc) {
    return (
      <Box component="span" sx={slotSx}>
        {avatar}
      </Box>
    );
  }
  return (
    <ButtonBase
      aria-label={t('group:dm.show_avatar', {
        postProcess: 'capitalizeFirstChar',
      })}
      onClick={() => onOpenPreview(shownSrc)}
      sx={slotSx}
    >
      {avatar}
    </ButtonBase>
  );
}

/**
 * Header of a direct chat: back, the partner (picture and presence on phones,
 * as the group header shows the group), and the unhide / friend / call
 * actions. Phones get 44px targets with the group header's square actions;
 * desktop keeps its compact look.
 */
export function DirectChatHeader({
  isMobile,
  reticulumDirectUiEnabled,
  isNewChat,
  isSelfDirect,
  partner,
  onClose,
  peerOnline,
  peerHidden,
  unhideBusy,
  onUnhide,
  isFriend,
  friendActionBusy,
  onToggleFriend,
  call,
}: DirectChatHeaderProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group']);
  // Always false off GO.
  const chatTwoPane = useGoLayout(selectChatTwoPane);
  const { iconPx: phoneIconPx } = getChatHeaderActionMetrics(true);
  const iconPx = isMobile ? phoneIconPx : DESKTOP_ICON_PX;
  // Phones only: desktop keeps MUI's small round icon buttons.
  const actionSx = isMobile ? getChatHeaderActionSx(theme, { isMobile }) : {};
  // The span a Tooltip needs around a button that can be disabled. On phones
  // it is a flex box, so no text line makes it taller than the button.
  const tooltipTargetSx = isMobile ? { display: 'inline-flex' } : undefined;

  const {
    previewSrc: avatarPreviewSrc,
    showPreview: showAvatarPreview,
    clearPreview: clearAvatarPreview,
  } = useAvatarPreviewSrc();
  // Android back closes the enlarged picture first, not the whole chat.
  useAndroidBack(
    () => {
      if (!avatarPreviewSrc) return false;
      clearAvatarPreview();
      return true;
    },
    { enabled: Boolean(avatarPreviewSrc), priority: BACK_PRIORITY.dialog }
  );

  const partnerAddress = partner?.address || '';
  const partnerLabel =
    partner?.name ||
    partner?.address ||
    t('group:dm.direct_message', { postProcess: 'capitalizeFirstChar' });
  const savedMessages = isSelfDirect || partner?.savedMessages === true;
  const showActions = !isNewChat && Boolean(partnerAddress) && !isSelfDirect;

  const callBusy = call.connected || call.ringing;
  const peerCallable = call.peerCallable ?? peerOnline;
  const callDisabled = !(
    (peerCallable &&
      !callBusy &&
      !call.blockedByFriend &&
      !call.blockedByP2p) ||
    call.connected
  );
  const callTooltip = call.connected
    ? t('group:dm.end_call', { postProcess: 'capitalizeFirstChar' })
    : call.ringing
      ? ''
      : !peerCallable
        ? t('core:presence.call_offline_tooltip')
        : call.blockedByFriend
          ? t('group:dm.add_friend_before_calling')
          : call.blockedByP2p
            ? call.p2pBlockedTooltip
            : t('group:dm.start_voice_call', {
                postProcess: 'capitalizeFirstChar',
              });
  // GO: a greyed call button has no hover tooltip on a phone, so a tap on it
  // says why (the network is still warming up, offline, not a friend); while
  // ringing out it brings the call screen back. The Hub keeps its tooltip.
  const onDisabledCallTap =
    callDisabled && isGoCallUi()
      ? () => {
          if (call.ringing) {
            openGoCallScreen();
            return;
          }
          // Warming up (peers receiving, not steady yet): "try again
          // shortly". No receiving peers at all: the Hub's own reason.
          showCallHint(
            peerCallable &&
              !call.blockedByFriend &&
              call.blockedByP2p &&
              isCallNetworkWarmingUp()
              ? t('core:go_call.calls_not_ready')
              : callTooltip
          );
        }
      : undefined;
  const callLabel = call.connected
    ? t('group:dm.end_call', { postProcess: 'capitalizeFirstChar' })
    : t('group:dm.start_voice_call', { postProcess: 'capitalizeFirstChar' });
  const friendLabel = isFriend
    ? t('core:dm_friends.remove_friend', {
        postProcess: 'capitalizeFirstChar',
      })
    : t('core:dm_friends.add_friend', {
        postProcess: 'capitalizeFirstChar',
      });
  const unhideLabel = t('group:dm.unhide_user', {
    postProcess: 'capitalizeFirstChar',
  });
  const presenceHint = peerOnline
    ? t('core:presence.peer_online_hint')
    : t('core:presence.peer_offline_hint');
  const presenceLabel = peerOnline
    ? t('core:presence.online')
    : t('core:presence.offline');

  const openAvatarPreview = (shownSrc: string) => {
    const fullSrc = buildUserAvatarPreviewUrl(getBaseApiReact(), partner?.name);
    showAvatarPreview(fullSrc, shownSrc);
  };

  return (
    <Box
      sx={{
        alignItems: 'center',
        borderBottom: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexShrink: 0,
        width: '100%',
        // Phones: the group header's height, gutters and gap; the long name
        // and presence ellipsize instead of wrapping the bar.
        ...(isMobile
          ? {
              flexWrap: 'nowrap',
              gap: '6px',
              minHeight: CHAT_HEADER_PHONE_HEIGHT_PX,
              overflow: 'hidden',
              px: `${CHAT_HEADER_PHONE_GUTTER_PX}px`,
              py: 0,
            }
          : { gap: '8px', padding: '12px 16px' }),
      }}
    >
      {/* The Reticulum desktop layout and GO two-pane have no back: the list
          stays beside. */}
      {isMobile && reticulumDirectUiEnabled && !chatTwoPane && (
        // The group header's back: round, rounded arrow, same size.
        <Tooltip
          title={t('core:action.back', { postProcess: 'capitalizeFirstChar' })}
        >
          <IconButton
            aria-label={t('core:action.back', {
              postProcess: 'capitalizeFirstChar',
            })}
            onClick={onClose}
            sx={getChatHeaderBackSx(isMobile)}
          >
            <ArrowBackRoundedIcon sx={{ fontSize: phoneIconPx }} />
          </IconButton>
        </Tooltip>
      )}
      {!reticulumDirectUiEnabled && (
        // The legacy chat: a labelled close button (it reads its own label).
        <ButtonBase
          onClick={onClose}
          sx={
            isMobile
              ? getChatHeaderActionSx(theme, { isMobile, showLabel: true })
              : {
                  alignItems: 'center',
                  borderRadius: '8px',
                  color: theme.palette.text.secondary,
                  display: 'flex',
                  gap: '6px',
                  padding: '6px 10px',
                  transition: 'background-color 0.15s ease, color 0.15s ease',
                  [HOVER_CAPABLE_MEDIA]: {
                    '&:hover': {
                      backgroundColor: theme.palette.action.hover,
                      color: theme.palette.text.primary,
                    },
                  },
                }
          }
        >
          {isMobile ? (
            <ArrowBackRoundedIcon sx={{ fontSize: phoneIconPx }} />
          ) : (
            <ArrowBackIcon sx={{ fontSize: '20px' }} />
          )}
          <Typography sx={{ fontSize: '14px', fontWeight: 500 }}>
            {t('core:action.close_chat', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </ButtonBase>
      )}
      {isNewChat ? (
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '13px',
            fontWeight: 500,
            marginLeft: '8px',
          }}
        >
          {t('core:action.new.chat', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      ) : (
        <>
          {isMobile && (
            <DirectChatHeaderAvatar
              name={partner?.name}
              label={partnerLabel}
              savedMessages={savedMessages}
              onOpenPreview={openAvatarPreview}
            />
          )}
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontSize: 17,
                fontWeight: 700,
                lineHeight: 1.2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {partnerLabel}
            </Typography>
            {!isMobile &&
              !isSelfDirect &&
              partner?.name &&
              partner?.address && (
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: 11,
                    lineHeight: 1.3,
                    mt: 0.25,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {partner.address}
                </Typography>
              )}
            {/* Phones: presence under the name, like the channel line under
                the group name, which leaves the actions room to grow. */}
            {isMobile && showActions && (
              <Tooltip title={presenceHint}>
                <Box
                  data-testid="direct-header-presence"
                  sx={{
                    alignItems: 'center',
                    color: peerOnline ? 'success.main' : 'text.secondary',
                    display: 'flex',
                    gap: '5px',
                    minWidth: 0,
                    mt: '1px',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      backgroundColor: peerOnline
                        ? theme.palette.success.main
                        : theme.palette.action.disabled,
                      borderRadius: '50%',
                      flexShrink: 0,
                      height: 8,
                      width: 8,
                    }}
                  />
                  {/* The size of the channel line under a group name. */}
                  <Typography
                    sx={{
                      color: 'inherit',
                      fontSize: 14,
                      fontWeight: 600,
                      letterSpacing: 0.2,
                      lineHeight: 1.25,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {presenceLabel}
                  </Typography>
                </Box>
              </Tooltip>
            )}
          </Box>
        </>
      )}
      {showActions && (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexShrink: 0,
            gap: isMobile ? '2px' : 1,
            marginLeft: 'auto',
          }}
        >
          {reticulumDirectUiEnabled && peerHidden && (
            <Tooltip title={unhideLabel}>
              <Box component="span" sx={tooltipTargetSx}>
                <IconButton
                  aria-label={unhideLabel}
                  disabled={unhideBusy}
                  onClick={onUnhide}
                  size="small"
                  sx={[
                    actionSx,
                    {
                      color: 'warning.main',
                      [HOVER_CAPABLE_MEDIA]: {
                        '&:hover': { color: 'warning.dark' },
                      },
                    },
                  ]}
                >
                  {unhideBusy ? (
                    <CircularProgress size={iconPx - 2} />
                  ) : (
                    <VisibilityRoundedIcon sx={{ fontSize: iconPx }} />
                  )}
                </IconButton>
              </Box>
            </Tooltip>
          )}
          {!isMobile && (
            <Tooltip title={presenceHint}>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexShrink: 0,
                  gap: 0.5,
                }}
              >
                <Box
                  sx={{
                    backgroundColor: peerOnline
                      ? theme.palette.success.main
                      : theme.palette.action.disabled,
                    borderRadius: '50%',
                    flexShrink: 0,
                    height: 8,
                    width: 8,
                  }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    color: peerOnline ? 'success.main' : 'text.disabled',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 0.2,
                  }}
                >
                  {presenceLabel}
                </Typography>
              </Box>
            </Tooltip>
          )}
          <Tooltip title={friendLabel}>
            <Box component="span" sx={tooltipTargetSx}>
              <IconButton
                aria-label={friendLabel}
                size="small"
                disabled={friendActionBusy}
                onClick={onToggleFriend}
                sx={[actionSx, { color: 'text.secondary' }]}
              >
                {isFriend ? (
                  <PersonRemoveRoundedIcon sx={{ fontSize: iconPx }} />
                ) : (
                  <PersonAddRoundedIcon sx={{ fontSize: iconPx }} />
                )}
              </IconButton>
            </Box>
          </Tooltip>
          {call.enabled && (
            <Tooltip title={callTooltip}>
              <Box
                component="span"
                sx={tooltipTargetSx}
                onClick={onDisabledCallTap}
              >
                <IconButton
                  aria-label={callLabel}
                  size="small"
                  disabled={callDisabled}
                  onClick={call.connected ? call.onHangUp : call.onStart}
                  sx={[
                    actionSx,
                    {
                      color: call.connected ? 'error.main' : 'text.secondary',
                      [HOVER_CAPABLE_MEDIA]: {
                        '&:hover': {
                          color: call.connected ? 'error.dark' : 'text.primary',
                        },
                      },
                      '&.Mui-disabled': {
                        color: theme.palette.action.disabled,
                      },
                    },
                  ]}
                >
                  {call.connected ? (
                    <CallEndRoundedIcon sx={{ fontSize: iconPx }} />
                  ) : (
                    <CallRoundedIcon sx={{ fontSize: iconPx }} />
                  )}
                </IconButton>
              </Box>
            </Tooltip>
          )}
        </Box>
      )}
      <AvatarPreviewModal
        open={Boolean(avatarPreviewSrc)}
        src={avatarPreviewSrc || null}
        alt={partnerLabel}
        onClose={clearAvatarPreview}
      />
    </Box>
  );
}
