import { Box, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import InfoOutlineRoundedIcon from '@mui/icons-material/InfoOutlineRounded';
import { useTranslation } from 'react-i18next';
import { MAX_SPLIT_MESSAGE_PARTS } from '../../constants/constants';

/** Why an over-limit composer text cannot be sent, even split. */
export type MessageSplitError = 'too_many_parts' | 'unsplittable' | 'edit';

type MessageSizeLimitLipProps = {
  floating?: boolean;
  maximum: number;
  shakeKey: number;
  size: number;
  /**
   * How many messages the over-limit text will be sent as. From 2 up the lip
   * becomes an informational notice instead of an error.
   */
  splitParts?: number | null;
  /** Why the over-limit text cannot be sent even split; beats splitParts. */
  splitError?: MessageSplitError | null;
  /** Most messages one text may be split into, for the too_many_parts text. */
  maxParts?: number;
};

/**
 * The lip over the composer while the text is over the size limit: an error
 * when it cannot be sent, or a notice when it will go out as several messages.
 * Renders nothing while size <= maximum.
 */
export const MessageSizeLimitLip = ({
  floating = false,
  maximum,
  shakeKey,
  size,
  splitParts = null,
  splitError = null,
  maxParts = MAX_SPLIT_MESSAGE_PARTS,
}: MessageSizeLimitLipProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  if (size <= maximum) return null;
  // One part means trimming blank lines was enough: it sends as it is.
  if (!splitError && splitParts === 1) return null;

  const isNotice =
    !splitError && typeof splitParts === 'number' && splitParts > 1;
  const tone = isNotice ? theme.palette.primary.main : theme.palette.error.main;
  const Icon = isNotice ? InfoOutlineRoundedIcon : ErrorOutlineRoundedIcon;

  let sentence: string;
  if (splitError === 'too_many_parts') {
    sentence = t('core:message.error.long_message_too_many_parts', {
      maximum: maxParts,
    });
  } else if (splitError === 'unsplittable') {
    sentence = t('core:message.error.long_message_unsplittable');
  } else if (splitError === 'edit') {
    sentence = t('core:message.error.edit_message_too_long', { maximum });
  } else if (isNotice) {
    sentence = t('core:message.generic.long_message_split', {
      count: splitParts,
    });
  } else {
    sentence = t('core:message.error.message_size', {
      maximum,
      size,
      postProcess: 'capitalizeFirstChar',
    });
  }

  return (
    <Box
      aria-live={isNotice ? 'polite' : 'assertive'}
      role={isNotice ? 'status' : 'alert'}
      sx={{
        alignItems: 'center',
        backgroundColor: alpha(tone, 0.12),
        border: '1px solid',
        borderColor: alpha(tone, 0.52),
        borderBottomColor: floating ? alpha(tone, 0.4) : alpha(tone, 0.52),
        borderRadius: floating ? '8px 8px 0 0' : '8px',
        boxSizing: 'border-box',
        boxShadow: `0 -4px 14px ${alpha(tone, 0.08)}`,
        color: tone,
        display: 'flex',
        gap: '7px',
        justifyContent: 'center',
        left: floating ? 0 : undefined,
        minHeight: 30,
        px: 1.5,
        py: 0.5,
        position: floating ? 'absolute' : 'relative',
        right: floating ? 0 : undefined,
        top: floating ? 0 : undefined,
        transform: floating ? 'translateY(-100%)' : undefined,
        width: '100%',
        zIndex: floating ? 4 : undefined,
      }}
    >
      <Icon aria-hidden="true" sx={{ flexShrink: 0, fontSize: 17 }} />
      <Typography
        key={shakeKey}
        sx={{
          '@keyframes qchatMessageLimitShake': {
            '0%, 100%': { transform: 'translateX(0)' },
            '20%': { transform: 'translateX(-4px)' },
            '40%': { transform: 'translateX(4px)' },
            '60%': { transform: 'translateX(-3px)' },
            '80%': { transform: 'translateX(3px)' },
          },
          '@media (prefers-reduced-motion: reduce)': {
            animation: 'none',
          },
          animation:
            shakeKey > 0 ? 'qchatMessageLimitShake 280ms ease-in-out' : 'none',
          fontSize: 12,
          fontWeight: 650,
          lineHeight: 1.35,
          textAlign: 'center',
        }}
      >
        {sentence}
      </Typography>
    </Box>
  );
};
