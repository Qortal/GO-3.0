import { Box } from '@mui/material';
import qortalWhiteLogo from '../../assets/sidebar/qortal-logo-white.png';

export type SavedMessagesLogoProps = {
  /** Width and height of the logo inside its avatar circle. */
  size?: number;
};

/**
 * The faint Qortal logo of the "saved messages" chat, inside its avatar.
 * The asset is white, so the light theme inverts it to dark: the same faint
 * mark in both themes.
 */
export function SavedMessagesLogo({ size = 22 }: SavedMessagesLogoProps) {
  return (
    <Box
      alt=""
      aria-hidden
      component="img"
      data-saved-messages-logo
      src={qortalWhiteLogo}
      sx={(theme) => ({
        filter: theme.palette.mode === 'light' ? 'invert(1)' : 'none',
        height: size,
        objectFit: 'contain',
        opacity: theme.palette.mode === 'light' ? 0.3 : 0.15,
        width: size,
      })}
    />
  );
}
