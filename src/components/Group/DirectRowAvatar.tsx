import type { MouseEvent } from 'react';
import { Avatar, useTheme } from '@mui/material';
import type { QdnAvatarPriority } from '../../lib/qdnAvatars';
import { useShownQdnAvatarSrc } from '../../hooks/useShownQdnAvatarSrc';
import {
  getClickableAvatarSx,
  getFallbackAvatarOutlineSx,
} from '../Chat/clickableAvatarStyles';
import { mergeAvatarSx } from './CachedAvatars';
import { SavedMessagesLogo } from './SavedMessagesLogo';

export type DirectRowAvatarProps = {
  /** Registered name of the DM partner, if any. */
  name?: string | null;
  /** Shown name (name or address): alt text and fallback letter. */
  label: string;
  /** The "saved messages" row: the Qortal logo, no avatar lookup. */
  savedMessages?: boolean;
  size: number;
  priority?: QdnAvatarPriority;
  /**
   * Tap on a shown picture (the row itself is not selected). Receives the
   * picture already on screen, to open the preview with at once.
   */
  onOpenPreview?: (shownSrc: string) => void;
};

/**
 * Avatar of a DM list row, from the device avatar cache: it shows at once,
 * also when the node is slow or unreachable, with the first letter as the
 * fallback.
 */
export function DirectRowAvatar({
  name,
  label,
  savedMessages = false,
  size,
  priority,
  onOpenPreview,
}: DirectRowAvatarProps) {
  const theme = useTheme();
  // A picture the WebView cannot show counts as none (letter, not clickable).
  const { shownSrc, onImgError } = useShownQdnAvatarSrc(name, {
    savedMessages,
    priority,
  });

  const handleClick = (event: MouseEvent) => {
    if (!shownSrc || !onOpenPreview) return;
    event.preventDefault();
    event.stopPropagation();
    onOpenPreview(shownSrc);
  };

  return (
    <Avatar
      sx={mergeAvatarSx(
        {
          height: size,
          width: size,
          background: theme.palette.background.surface,
          color: theme.palette.text.primary,
        },
        mergeAvatarSx(
          shownSrc ? undefined : getFallbackAvatarOutlineSx(theme),
          getClickableAvatarSx(theme, Boolean(shownSrc))
        )
      )}
      alt={label}
      src={shownSrc}
      data-qdn-avatar={shownSrc ? 'shown' : 'fallback'}
      onClick={handleClick}
      imgProps={{ onError: onImgError }}
    >
      {/* The logo is white: SavedMessagesLogo inverts it in the light
          theme, where it used to be an empty pale circle. */}
      {savedMessages ? <SavedMessagesLogo /> : label?.charAt(0)}
    </Avatar>
  );
}
