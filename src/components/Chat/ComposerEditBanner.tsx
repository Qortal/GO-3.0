import type { ReactNode } from 'react';
import { alpha, Box, IconButton, Typography, useTheme } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import { useTranslation } from 'react-i18next';
import {
  ComposerDismissButton,
  useComposerTouchChrome,
} from './ComposerDismissButton';
import { COMPOSER_DISMISS_BUTTON_PX } from './composerCornerLayout';

type ComposerEditBannerProps = {
  /** Leaves edit mode and empties the composer. */
  onCancel: () => void;
  /** What desktop shows beside its small X, as it always has. */
  desktopPreview: ReactNode;
  desktopIcon: ReactNode;
};

/** Size of the filled circle that makes the touch X stand out. */
const CANCEL_DISC_PX = 30;

/**
 * The banner above the typing box while a sent message is being edited.
 *
 * On touch screens the faint "EDITING MESSAGE:" line with a grey X was easy
 * to miss, so the way out was too. There it is a card like the reply strip:
 * an accent bar, a pencil and "Editing message" in the accent colour, and
 * the X on a filled disc that reads as a button. Desktop keeps its look.
 */
export const ComposerEditBanner = ({
  onCancel,
  desktopPreview,
  desktopIcon,
}: ComposerEditBannerProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group']);
  const touch = useComposerTouchChrome();
  const isDark = theme.palette.mode === 'dark';
  const cancelLabel = t('group:chat_group.cancel_edit');

  if (!touch) {
    return (
      <Box
        sx={{
          alignItems: 'flex-start',
          display: 'flex',
          gap: '5px',
          width: '100%',
        }}
      >
        {desktopPreview}
        <ComposerDismissButton
          desktopIcon={desktopIcon}
          label={cancelLabel}
          onClick={onCancel}
        />
      </Box>
    );
  }

  return (
    <Box
      data-composer-edit-banner=""
      sx={{
        alignItems: 'center',
        backgroundColor: alpha(theme.palette.primary.main, isDark ? 0.12 : 0.1),
        border: '1px solid',
        borderColor: alpha(theme.palette.primary.main, isDark ? 0.32 : 0.36),
        borderRadius: '16px',
        boxSizing: 'border-box',
        display: 'flex',
        gap: '8px',
        minHeight: COMPOSER_DISMISS_BUTTON_PX + 4,
        padding: '2px 2px 2px 7px',
        width: '100%',
      }}
    >
      <Box
        aria-hidden
        sx={{
          alignSelf: 'stretch',
          backgroundColor: theme.palette.primary.main,
          borderRadius: '3px',
          flexShrink: 0,
          marginY: '4px',
          width: '3px',
        }}
      />
      <EditRoundedIcon
        aria-hidden
        sx={{ color: 'primary.main', flexShrink: 0, fontSize: 18 }}
      />
      <Typography
        noWrap
        sx={{
          color: 'primary.main',
          flex: 1,
          fontSize: '14px',
          fontWeight: 700,
          minWidth: 0,
        }}
      >
        {t('core:message.generic.editing_message', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Typography>
      <IconButton
        aria-label={cancelLabel}
        onClick={onCancel}
        sx={{
          flexShrink: 0,
          height: COMPOSER_DISMISS_BUTTON_PX,
          padding: 0,
          width: COMPOSER_DISMISS_BUTTON_PX,
          '&:hover .composer-edit-cancel-disc, &:active .composer-edit-cancel-disc':
            {
              backgroundColor: alpha(
                theme.palette.text.primary,
                isDark ? 0.26 : 0.2
              ),
            },
        }}
      >
        <Box
          className="composer-edit-cancel-disc"
          component="span"
          sx={{
            alignItems: 'center',
            backgroundColor: alpha(
              theme.palette.text.primary,
              isDark ? 0.16 : 0.12
            ),
            borderRadius: '50%',
            color: 'text.primary',
            display: 'flex',
            height: CANCEL_DISC_PX,
            justifyContent: 'center',
            transition: 'background-color 120ms ease',
            width: CANCEL_DISC_PX,
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 20 }} />
        </Box>
      </IconButton>
    </Box>
  );
};
