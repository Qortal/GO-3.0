import {
  Avatar,
  Box,
  CircularProgress,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  groupsOwnerNamesSelector,
  reticulumChatSummariesAtom,
  reticulumChatTextScaleAtom,
} from '../../../atoms/global';
import { useGroupRowAvatar } from '../../Group/useGroupRowAvatar';
import { CHAT_LIST_TOUCH_TARGET } from '../../Group/chatListRowStyles';
import { withTabBarSpace } from '../../Mobile/mobileBarHeights';
import {
  ReticulumCategoryHeader,
  ReticulumSortableChannelButton,
} from '../ChatGroup';
import {
  RETICULUM_CATEGORY_CONTENT_GAP_PX,
  RETICULUM_CHANNEL_LIST_HEADER_PX,
  RETICULUM_HIDDEN_CATEGORY_CONTENT_GAP_PX,
  reticulumChannelListPadding,
} from '../reticulumChannelListLayout';
import {
  loadShareChannelBundle,
  noWritableShareChannel,
  normalizeShareChannelId,
  shareChannelSections,
  shareChannelStep,
  type ShareChannelBundle,
  type ShareChannelRow,
} from './chatShareChannels';

const sentence = { postProcess: 'capitalizeFirstChar' };

type Channel = Parameters<typeof ReticulumSortableChannelButton>[0]['channel'];

/** The step shows only once it asks (or takes this long to know). */
const SHOW_LOADING_AFTER_MS = 250;

const noop = () => undefined;

type ChatShareChannelStepGroup = {
  groupId: string | number;
  groupName?: string;
  name?: string;
};

/**
 * The channel step of a share from another app ("GO Groups" in the share
 * sheet): the group tapped in the list shows its channels over the list,
 * with the share still waiting in the header above, and the channel tapped
 * here takes it. The rows and category headers are the group's own channel
 * list (ChatGroup); a channel the user cannot post in is greyed out.
 *
 * A group with one channel the user can post in (or whose channels are not
 * known) never shows the step: `onPick` runs at once with that channel (or
 * null), as a tap on the group did before.
 */
export function ChatShareChannelStep({
  group,
  isAdmin,
  onBack,
  onPick,
}: {
  group: ChatShareChannelStepGroup;
  /** Admins post in admins-only channels too. */
  isAdmin: boolean;
  onBack: () => void;
  onPick: (channelId: string | null) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['group', 'reticulum']);
  const groupId = Number(group?.groupId);
  const groupName =
    String(group?.groupName || group?.name || '') ||
    t('reticulum:group_fallback_name');
  const ownerName = useAtomValue(groupsOwnerNamesSelector(group?.groupId));
  const { src: avatarSrc, imgProps: avatarImgProps } = useGroupRowAvatar(
    ownerName,
    group?.groupId
  );
  const summaries = useAtomValue(reticulumChatSummariesAtom);
  const textScale = useAtomValue(reticulumChatTextScaleAtom);
  const [bundle, setBundle] = useState<ShareChannelBundle<Channel> | null>(
    null
  );
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  // One pick per group: a second tap (or the skip) must not hand it twice.
  const pickedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    pickedRef.current = false;
    setBundle(null);
    setLoaded(false);
    setSlow(false);
    const slowTimer = window.setTimeout(
      () => setSlow(true),
      SHOW_LOADING_AFTER_MS
    );
    void loadShareChannelBundle<Channel>(groupId, () => cancelled).then(
      (next) => {
        if (cancelled) return;
        window.clearTimeout(slowTimer);
        setBundle(next);
        setLoaded(true);
      }
    );
    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
    };
  }, [groupId]);

  const defaultCategoryName = t('group:chat_group.channels');
  const sections = useMemo(
    () => shareChannelSections(bundle, { isAdmin, defaultCategoryName }),
    [bundle, defaultCategoryName, isAdmin]
  );
  const step = useMemo(() => shareChannelStep(sections), [sections]);

  // Nothing to ask: straight into the group, like a tap without the step.
  useEffect(() => {
    if (!loaded || step.kind !== 'direct' || pickedRef.current) return;
    pickedRef.current = true;
    onPickRef.current(step.channelId);
  }, [loaded, step]);

  const summaryByChannelId = useMemo(() => {
    const entries = summaries?.[String(groupId)]?.channels;
    const byId = new Map<string, NonNullable<typeof entries>[number]>();
    for (const entry of Array.isArray(entries) ? entries : []) {
      byId.set(
        normalizeShareChannelId(entry?.channelId || '') || 'general',
        entry
      );
    }
    return byId;
  }, [groupId, summaries]);

  const asking = loaded && step.kind === 'pick';
  const shown = asking || (!loaded && slow);
  const listPadding = reticulumChannelListPadding(true);
  const adminsOnly = t('reticulum:share.admins_only', sentence);

  const toggle = (categoryId: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });

  const renderRow = ({ channel, canWrite }: ShareChannelRow<Channel>) => {
    const summary = summaryByChannelId.get(channel.channelId);
    const unreadCount = Math.max(0, Number(summary?.unreadCount) || 0);
    const replyCount = Math.max(0, Number(summary?.replyCount) || 0);
    const mentionCount = Math.max(0, Number(summary?.mentionCount) || 0);
    return (
      <ReticulumSortableChannelButton
        key={channel.channelId}
        channel={channel}
        disabledReason={canWrite ? undefined : adminsOnly}
        hasUnreadMention={
          summary?.hasUnreadMention === true || mentionCount > 0
        }
        isAdmin={false}
        mentionCount={mentionCount}
        onContextMenu={noop}
        onSelect={(channelId) => {
          if (pickedRef.current) return;
          pickedRef.current = true;
          onPickRef.current(channelId);
        }}
        phone
        replyCount={replyCount}
        selected={false}
        textScale={textScale}
        unreadCount={unreadCount}
      />
    );
  };

  return (
    // Over the Groups list (which keeps its place below): until the step
    // shows, it only holds taps back from the list.
    <Box
      data-chat-share-channel-step=""
      sx={{
        inset: 0,
        position: 'absolute',
        zIndex: 5,
      }}
    >
      {shown && (
        <Box
          role="region"
          aria-label={t('reticulum:share.channel_step_label', {
            ...sentence,
            group: groupName,
          })}
          sx={{
            '@keyframes chatShareChannelStepIn': {
              from: { opacity: 0, transform: 'translateX(24px)' },
              to: { opacity: 1, transform: 'none' },
            },
            animation:
              'chatShareChannelStepIn 200ms cubic-bezier(0.2, 0, 0, 1)',
            backgroundColor: 'background.default',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              borderBottom: `1px solid ${alpha(theme.palette.divider, 0.72)}`,
              display: 'flex',
              flexShrink: 0,
              gap: 1,
              minHeight: RETICULUM_CHANNEL_LIST_HEADER_PX,
              pl: '4px',
              pr: '12px',
            }}
          >
            <IconButton
              aria-label={t('group:chat_group.back_to_groups')}
              onClick={onBack}
              sx={{
                color: 'text.secondary',
                flexShrink: 0,
                height: CHAT_LIST_TOUCH_TARGET,
                width: CHAT_LIST_TOUCH_TARGET,
              }}
            >
              <ArrowBackRoundedIcon sx={{ fontSize: 22 }} />
            </IconButton>
            <Avatar
              alt={groupName}
              src={avatarSrc || undefined}
              slotProps={{ img: avatarImgProps }}
              sx={{
                bgcolor: alpha(theme.palette.text.primary, 0.08),
                color: 'text.primary',
                flexShrink: 0,
                fontSize: 13,
                fontWeight: 700,
                height: 30,
                width: 30,
              }}
            >
              {groupName.charAt(0).toUpperCase()}
            </Avatar>
            {/* The chip above says "pick a channel". */}
            <Typography
              noWrap
              sx={{
                color: 'text.primary',
                flex: '1 1 auto',
                fontFamily: 'Inter, sans-serif',
                fontSize: 15,
                fontWeight: 650,
                minWidth: 0,
                WebkitFontSmoothing: 'antialiased',
              }}
            >
              {groupName}
            </Typography>
          </Box>
          <Box
            // The phone Groups / DMs pager keeps sideways swipes off this
            // list, as off the Groups list.
            data-pager-scroller=""
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              pb: withTabBarSpace(10, '10px'),
              pt: '10px',
              px: `${listPadding.outer}px`,
            }}
          >
            {!loaded ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress
                  aria-label={t('reticulum:share.loading_channels', sentence)}
                  size={26}
                />
              </Box>
            ) : (
              <>
                {noWritableShareChannel(sections) && (
                  <Typography
                    sx={{
                      color: 'text.secondary',
                      fontSize: 13,
                      lineHeight: 1.4,
                      pb: 1,
                      px: `${listPadding.inner + 4}px`,
                    }}
                  >
                    {t('reticulum:share.no_channel_to_post', sentence)}
                  </Typography>
                )}
                {sections.map((section, index) => {
                  const isCollapsed =
                    section.name !== null && collapsed.has(section.categoryId);
                  return (
                    <Box key={section.categoryId || '__default__'}>
                      {section.name !== null && (
                        <ReticulumCategoryHeader
                          draggable={false}
                          isAdmin={false}
                          isCollapsed={isCollapsed}
                          name={section.name}
                          onContextMenu={noop}
                          onCreateChannel={noop}
                          onToggle={() => toggle(section.categoryId)}
                          phone
                          sx={index > 0 ? { mt: '14px' } : undefined}
                        />
                      )}
                      {!isCollapsed && (
                        <Box
                          sx={{
                            pt: `${
                              section.name === null
                                ? RETICULUM_HIDDEN_CATEGORY_CONTENT_GAP_PX
                                : RETICULUM_CATEGORY_CONTENT_GAP_PX
                            }px`,
                            px: `${listPadding.inner}px`,
                          }}
                        >
                          {section.rows.map(renderRow)}
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
