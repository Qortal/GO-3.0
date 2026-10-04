import type { ReactNode, SyntheticEvent } from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  useMediaQuery,
  useTheme,
  type SxProps,
  type Theme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import {
  COMPOSER_DISMISS_BUTTON_PX,
  COMPOSER_DISMISS_ICON_PX,
} from './composerCornerLayout';

type KeepFocus = (event: SyntheticEvent) => void;

/**
 * Whether the controls above the typing box are worked by touch: on phones,
 * and on touch screens too wide to count as one (a tablet, an unfolded
 * foldable, a big phone on its side). None of them can hover, so nothing may
 * hide until hovered, and every X has to take a thumb.
 */
export const useComposerTouchChrome = (): boolean => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const hoverless = useMediaQuery('(hover: none)');
  return isMobile || hoverless;
};

type ComposerDismissButtonProps = {
  /** Accessible name, e.g. "Remove file" or "Cancel edit". */
  label: string;
  onClick: () => void;
  /** Stops the tap from taking focus (and the soft keyboard) away from the
   *  message being written. */
  keepFocus?: KeepFocus;
  /** The glyph desktop keeps showing; phones always get a thumb-sized X. */
  desktopIcon: ReactNode;
  /** Takes the colour of the surface it sits on, like a notice banner. */
  inheritColor?: boolean;
  /** Shows the label on hover. Phones have no hover, so only desktop. */
  tooltip?: boolean;
  /** Pixels the thumb-sized button may reach into the padding above and
   *  below it, so the chip it sits in keeps the height it had with the small
   *  X. Desktop keeps the small X and ignores it. */
  bleed?: number;
  sx?: SxProps<Theme>;
};

/**
 * The small X on the strips and chips stacked above the typing box: the edit
 * banner, attachment chips, notices. On phones it grows to a thumb-sized
 * target with a matching glyph; desktop keeps the compact look it always had.
 */
export const ComposerDismissButton = ({
  label,
  onClick,
  keepFocus,
  desktopIcon,
  inheritColor = false,
  tooltip = false,
  bleed = 0,
  sx,
}: ComposerDismissButtonProps) => {
  const theme = useTheme();
  const touch = useComposerTouchChrome();

  const button = (
    <IconButton
      aria-label={label}
      onClick={onClick}
      onMouseDown={keepFocus}
      onPointerDown={keepFocus}
      size="small"
      sx={[
        {
          color: inheritColor ? 'inherit' : undefined,
          flexShrink: 0,
        },
        touch && {
          color: inheritColor ? 'inherit' : theme.palette.text.secondary,
          height: COMPOSER_DISMISS_BUTTON_PX,
          my: bleed ? `${-bleed}px` : undefined,
          width: COMPOSER_DISMISS_BUTTON_PX,
        },
        ...(sx ? (Array.isArray(sx) ? sx : [sx]) : []),
      ]}
    >
      {touch ? (
        <CloseRoundedIcon sx={{ fontSize: COMPOSER_DISMISS_ICON_PX }} />
      ) : (
        desktopIcon
      )}
    </IconButton>
  );

  return tooltip && !touch ? <Tooltip title={label}>{button}</Tooltip> : button;
};

type ComposerAttachmentTileProps = {
  /** Fills the tile: an image, a GIF or a placeholder icon. */
  children: ReactNode;
  /** Accessible name and tooltip of the remove button. */
  label: string;
  onRemove: () => void;
  keepFocus?: KeepFocus;
};

const TILE_PX = 50;

/**
 * A pending image or GIF above the typing box, with its remove button.
 *
 * Desktop shows the button over the thumbnail on hover. Touch screens have no
 * hover, which left the button invisible (and a tap on the picture removing it
 * unseen), and a thumb-sized one would cover most of a 50px thumbnail, so
 * there the tile becomes a chip with the X beside the picture, like the file
 * chips next to it. The chip adds no padding above or below the picture, so
 * the row is only its border taller than the bare tile.
 */
export const ComposerAttachmentTile = ({
  children,
  label,
  onRemove,
  keepFocus,
}: ComposerAttachmentTileProps) => {
  const theme = useTheme();
  const touch = useComposerTouchChrome();

  if (touch) {
    return (
      <Box
        data-composer-attachment-chip=""
        sx={{
          alignItems: 'center',
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '8px',
          display: 'flex',
          gap: '2px',
          overflow: 'hidden',
          padding: '0 0 0 4px',
        }}
      >
        <Box
          sx={{
            flexShrink: 0,
            height: TILE_PX,
            position: 'relative',
            width: TILE_PX,
          }}
        >
          {children}
        </Box>
        <ComposerDismissButton
          desktopIcon={null}
          keepFocus={keepFocus}
          label={label}
          onClick={onRemove}
        />
      </Box>
    );
  }

  return (
    <div
      style={{
        height: `${TILE_PX}px`,
        position: 'relative',
        width: `${TILE_PX}px`,
      }}
    >
      {children}
      <Tooltip title={label}>
        <IconButton
          aria-label={label}
          onClick={onRemove}
          onMouseDown={keepFocus}
          onPointerDown={keepFocus}
          size="small"
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: theme.palette.background.paper,
            color: theme.palette.text.primary,
            borderRadius: '50%',
            opacity: 0,
            transition: 'opacity 0.2s',
            boxShadow: theme.shadows[2],
            '&:hover': {
              backgroundColor: theme.palette.background.default,
              opacity: 1,
            },
            pointerEvents: 'auto',
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </div>
  );
};
