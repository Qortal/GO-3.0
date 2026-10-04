import { IconButton, useTheme } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useTranslation } from 'react-i18next';
import {
  COMPOSER_CORNER_BUTTON_PX,
  COMPOSER_DISCARD_ICON_PX,
} from './composerCornerLayout';

type ComposerDiscardButtonProps = {
  /** Nothing to throw away yet; it fades out with the send button. */
  idle: boolean;
  /** The message is already on its way. */
  disabled?: boolean;
  onDiscard: () => void;
};

/**
 * Throws away the message being written. It sits beside send while the message
 * is one line and hops above it once the message wraps.
 *
 * The rail CSS places it by the `compact-composer-discard` class, the same way
 * it places expiry and send, so it has to be rendered straight into the right
 * rail between the two. It stays mounted while idle so the fade can run both
 * ways.
 *
 * Deliberately quiet: no fill and the secondary text colour, so the send button
 * next to it stays the obvious thing to press. It is as big a target as the
 * other corner controls all the same: a quiet button is still one to hit.
 */
export const ComposerDiscardButton = ({
  idle,
  disabled = false,
  onDiscard,
}: ComposerDiscardButtonProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  return (
    <IconButton
      aria-label={t('core:action.discard_message', {
        postProcess: 'capitalizeFirstChar',
      })}
      className="compact-composer-discard"
      data-idle={idle ? '' : undefined}
      disabled={disabled}
      onClick={() => {
        if (idle || disabled) return;
        onDiscard();
      }}
      size="small"
      sx={{
        backgroundColor: 'transparent',
        borderRadius: '50%',
        color: theme.palette.text.secondary,
        flexShrink: 0,
        height: COMPOSER_CORNER_BUTTON_PX,
        padding: 0,
        width: COMPOSER_CORNER_BUTTON_PX,
        '&.Mui-disabled': {
          color: theme.palette.action.disabled,
        },
      }}
    >
      <CloseRoundedIcon sx={{ fontSize: COMPOSER_DISCARD_ICON_PX }} />
    </IconButton>
  );
};
