import type { ReactNode } from 'react';
import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';

export type CallControlVariant = 'neutral' | 'danger' | 'accept';

export type CallControlButtonProps = {
  icon: ReactNode;
  /** Visible label under the circle, also the accessible name. */
  label: string;
  onClick: () => void;
  /** Toggle buttons: drawn filled while on (mute on, speaker on). */
  active?: boolean;
  disabled?: boolean;
  variant?: CallControlVariant;
  size?: number;
  /** Hide the text under the circle (the label stays the aria-label). */
  hideLabel?: boolean;
  testId?: string;
  ariaPressed?: boolean;
  ariaHasPopup?: boolean;
};

/**
 * Round call control (64-72 px) with its label underneath, like the dialer:
 * big enough to hit without looking, labelled for TalkBack.
 */
export function CallControlButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  variant = 'neutral',
  size = 64,
  hideLabel = false,
  testId,
  ariaPressed,
  ariaHasPopup,
}: CallControlButtonProps) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const fg = theme.palette.text.primary;

  let background: string;
  let color: string;
  if (variant === 'danger') {
    background = theme.palette.error.main;
    color = theme.palette.error.contrastText;
  } else if (variant === 'accept') {
    background = theme.palette.success.main;
    color = theme.palette.success.contrastText;
  } else if (active) {
    background = fg;
    color = theme.palette.background.default;
  } else {
    background = alpha(fg, dark ? 0.12 : 0.08);
    color = fg;
  }

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.9,
        minWidth: size,
      }}
    >
      <ButtonBase
        aria-label={label}
        aria-pressed={ariaPressed}
        aria-haspopup={ariaHasPopup ? 'dialog' : undefined}
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
        sx={{
          backgroundColor: background,
          borderRadius: '50%',
          boxShadow:
            variant === 'neutral'
              ? 'none'
              : `0 8px 22px ${alpha(background, dark ? 0.45 : 0.32)}`,
          color,
          height: size,
          opacity: disabled ? 0.38 : 1,
          transition:
            'background-color 160ms ease, color 160ms ease, transform 120ms ease, opacity 200ms ease',
          width: size,
          '& .MuiSvgIcon-root': { fontSize: Math.round(size * 0.42) },
          '&:active': { transform: 'scale(0.94)' },
          '&.Mui-focusVisible': {
            outline: `3px solid ${alpha(theme.palette.primary.main, 0.7)}`,
            outlineOffset: 3,
          },
        }}
      >
        {icon}
      </ButtonBase>
      {hideLabel ? null : (
        <Typography
          aria-hidden
          sx={{
            color: alpha(fg, disabled ? 0.45 : 0.82),
            fontSize: 12.5,
            fontWeight: 600,
            lineHeight: 1.2,
            maxWidth: size + 28,
            overflow: 'hidden',
            textAlign: 'center',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </Typography>
      )}
    </Box>
  );
}
