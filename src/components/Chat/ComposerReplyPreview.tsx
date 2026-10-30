import { useMemo } from 'react';
import {
  alpha,
  Box,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import { useTranslation } from 'react-i18next';
import {
  COMPOSER_DISMISS_BUTTON_PX,
  COMPOSER_DISMISS_ICON_PX,
} from './composerCornerLayout';
import { ReplyImageThumbnail } from './ReplyImageThumbnail';
import {
  extractReplyPreviewText,
  getReplyMedia,
  replyMediaLabelKey,
} from './replyMedia';

type ComposerReplyPreviewProps = {
  /** The message being replied to. */
  message: any;
  onCancel: () => void;
  /** Jumps the conversation to the quoted message when provided. */
  onJumpToMessage?: () => void;
  /** Phone composers render the strip as a card inside the rounded bubble. */
  rounded?: boolean;
};

export const ComposerReplyPreview = ({
  message,
  onCancel,
  onJumpToMessage,
  rounded = false,
}: ComposerReplyPreviewProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group']);
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const previewText = useMemo(
    () =>
      extractReplyPreviewText(
        message?.messageText ||
          message?.text ||
          message?.decryptedData?.data?.message
      ),
    [message?.messageText, message?.text, message?.decryptedData?.data?.message]
  );

  // The quoted message's picture, shown Telegram style between the accent
  // bar and the text. Only what this device already has; never downloaded.
  const media = useMemo(
    () => getReplyMedia(message),
    [message?.images, message?.attachments, message?.deleted]
  );

  const attachmentCount =
    (message?.images?.length || 0) +
    (message?.attachments?.length || 0) +
    (message?.files?.length || 0);

  const senderName =
    message?.senderName ||
    message?.sender ||
    message?.senderAddress ||
    t('core:unknown', { postProcess: 'capitalizeFirstChar' });

  return (
    <Box
      sx={{
        alignItems: 'stretch',
        backgroundColor: alpha(theme.palette.text.primary, 0.07),
        border: `1px solid ${theme.palette.divider}`,
        borderBottom: rounded ? undefined : 0,
        borderRadius: rounded ? '16px' : '8px 8px 0 0',
        boxSizing: 'border-box',
        display: 'flex',
        gap: '8px',
        padding: '4px 4px 4px 7px',
        width: '100%',
      }}
    >
      <Box
        aria-hidden
        sx={{
          backgroundColor: theme.palette.primary.main,
          borderRadius: '3px',
          flexShrink: 0,
          width: '3px',
        }}
      />

      {media && (
        <ReplyImageThumbnail
          media={media}
          size="36px"
          decorative={!previewText}
          onClick={onJumpToMessage}
          sx={{
            alignSelf: 'center',
            cursor: onJumpToMessage ? 'pointer' : 'default',
            ...(rounded && { borderRadius: '8px' }),
          }}
        />
      )}

      <Box
        onClick={onJumpToMessage}
        role={onJumpToMessage ? 'button' : undefined}
        sx={{
          cursor: onJumpToMessage ? 'pointer' : 'default',
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          minWidth: 0,
          paddingY: '2px',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '4px',
            minWidth: 0,
          }}
        >
          <ReplyRoundedIcon
            sx={{
              color: theme.palette.primary.main,
              flexShrink: 0,
              fontSize: 14,
            }}
          />
          <Typography
            noWrap
            sx={{
              color: theme.palette.primary.main,
              fontSize: '12px',
              fontWeight: 700,
              lineHeight: 1.3,
              minWidth: 0,
            }}
          >
            {senderName}
          </Typography>
        </Box>

        <Box
          sx={{
            // Long quotes stay readable: three lines are shown and the rest is
            // scrollable in place rather than truncated.
            maxHeight: '52px',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            paddingRight: '4px',
            touchAction: 'pan-y',
            '&::-webkit-scrollbar': { width: '3px' },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: alpha(theme.palette.text.secondary, 0.35),
              borderRadius: '3px',
            },
          }}
        >
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '12.5px',
              lineHeight: 1.35,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {previewText ||
              (media && media.kind !== 'file'
                ? t(replyMediaLabelKey(media.kind), {
                    postProcess: 'capitalizeFirstChar',
                  })
                : attachmentCount > 1
                  ? t('core:composer.attachment_count', {
                      count: attachmentCount,
                      postProcess: 'capitalizeFirstChar',
                    })
                  : attachmentCount === 1
                    ? t('core:attachment', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    : t('core:message.message', {
                        postProcess: 'capitalizeFirstChar',
                      }))}
          </Typography>
        </Box>
      </Box>

      <IconButton
        aria-label={t('group:chat_group.cancel_reply')}
        onClick={onCancel}
        size="small"
        sx={{
          alignSelf: 'flex-start',
          color: 'text.secondary',
          flexShrink: 0,
          // A thumb-sized target on phones. It reaches into the strip's
          // padding rather than making the strip, and the composer, taller.
          ...(isMobile && {
            height: COMPOSER_DISMISS_BUTTON_PX,
            margin: '-4px -4px -4px 0',
            width: COMPOSER_DISMISS_BUTTON_PX,
          }),
        }}
      >
        <CloseIcon
          sx={{ fontSize: isMobile ? COMPOSER_DISMISS_ICON_PX : 17 }}
        />
      </IconButton>
    </Box>
  );
};
