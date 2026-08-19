import { Box, Tooltip, useTheme } from '@mui/material';
import type { ReactNode } from 'react';

type MinterAvatarOrnamentProps = {
  accentColor?: string;
  children: ReactNode;
  level: number;
  size?: 'card' | 'message' | 'message-compact';
};

/**
 * The ornament reserves layout space for the level plate that hangs below the
 * avatar, so its box has to shrink with the avatar or it leaves a tall gap
 * between the sender header and the message body on phones.
 */
const ORNAMENT_METRICS = {
  card: {
    boxHeight: 104,
    frameSize: 90,
    ornamentWidth: 98,
    plateHeight: 34,
    plateTop: 82,
    plateWidth: 40,
    childPaddingTop: '4px',
  },
  message: {
    boxHeight: 60,
    frameSize: 42,
    ornamentWidth: 44,
    plateHeight: 20,
    plateTop: 40,
    plateWidth: 24,
    childPaddingTop: '2px',
  },
  'message-compact': {
    boxHeight: 46,
    frameSize: 34,
    ornamentWidth: 36,
    plateHeight: 16,
    plateTop: 30,
    plateWidth: 19,
    childPaddingTop: '2px',
  },
} as const;

export const MinterAvatarOrnament = ({
  accentColor,
  children,
  level,
  size = 'message',
}: MinterAvatarOrnamentProps) => {
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const neutral = isDarkMode ? '#56606d' : '#6b7280';
  const accent = accentColor || neutral;
  const plateFill = isDarkMode ? '#10141b' : '#f4f7fb';
  const plateText = isDarkMode ? '#f5f7fa' : '#171b22';
  const {
    boxHeight,
    childPaddingTop,
    frameSize,
    ornamentWidth,
    plateHeight,
    plateTop,
    plateWidth,
  } = ORNAMENT_METRICS[size];

  return (
    <Tooltip arrow title={`Minter Level ${level}`}>
      <Box
        aria-label={`Minter Level ${level}`}
        role="img"
        tabIndex={0}
        sx={{
          display: 'flex',
          flexShrink: 0,
          height: boxHeight,
          justifyContent: 'center',
          outline: 'none',
          position: 'relative',
          width: ornamentWidth,
          '&:hover .minter-avatar-ornament-frame, &:focus-visible .minter-avatar-ornament-frame':
            {
              filter: 'brightness(1.18)',
            },
          '&:hover .minter-avatar-ornament-plate, &:focus-visible .minter-avatar-ornament-plate':
            {
              filter: 'brightness(1.12)',
            },
        }}
      >
        <Box
          aria-hidden
          className="minter-avatar-ornament-frame"
          sx={{
            border: `1.25px solid ${accent}`,
            borderRadius: '50%',
            boxSizing: 'border-box',
            height: frameSize,
            left: '50%',
            pointerEvents: 'none',
            position: 'absolute',
            top: 0,
            transform: 'translateX(-50%)',
            transition: 'filter 120ms ease',
            width: frameSize,
            zIndex: 1,
          }}
        />
        <Box
          className="minter-avatar-ornament-plate"
          component="svg"
          aria-hidden
          focusable="false"
          viewBox="0 0 24 20"
          sx={{
            height: plateHeight,
            left: '50%',
            overflow: 'visible',
            pointerEvents: 'none',
            position: 'absolute',
            top: plateTop,
            transform: 'translateX(-50%)',
            transition: 'filter 120ms ease',
            width: plateWidth,
            zIndex: 2,
          }}
        >
          <polygon
            fill={plateFill}
            points="12,1 22,6 22,14 12,19 2,14 2,6"
            stroke={accent}
            strokeWidth="1.25"
          />
          <text
            fill={plateText}
            fontFamily="Inter, Arial, sans-serif"
            fontSize="11"
            fontWeight="700"
            textAnchor="middle"
            x="12"
            y="14.2"
          >
            {level}
          </text>
        </Box>
        <Box
          sx={{
            pt: childPaddingTop,
            position: 'relative',
            zIndex: 3,
          }}
        >
          {children}
        </Box>
      </Box>
    </Tooltip>
  );
};
