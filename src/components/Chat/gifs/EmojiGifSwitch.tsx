import { Box, ButtonBase } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { keepPanelKeyboardDown } from '../../Mobile/emojiPanelBus';

export type EmojiGifMode = 'emoji' | 'gif';

type EmojiGifSwitchProps = {
  mode: EmojiGifMode;
  onChange: (mode: EmojiGifMode) => void;
};

export const EMOJI_GIF_SWITCH_HEIGHT = 46;

export const EmojiGifSwitch = ({ mode, onChange }: EmojiGifSwitchProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return (
    <Box
      sx={{
        alignItems: 'center',
        borderTop: `1px solid ${theme.palette.divider}`,
        display: 'flex',
        flexShrink: 0,
        height: EMOJI_GIF_SWITCH_HEIGHT,
        justifyContent: 'center',
        px: 1,
      }}
    >
      <Box
        sx={{
          backgroundColor: isDark
            ? 'rgba(255, 255, 255, 0.08)'
            : 'rgba(0, 0, 0, 0.06)',
          borderRadius: '999px',
          display: 'inline-flex',
          p: '3px',
          position: 'relative',
        }}
      >
        <Box
          sx={{
            backgroundColor: theme.palette.background.paper,
            borderRadius: '999px',
            bottom: 3,
            boxShadow: theme.shadows[1],
            left: mode === 'emoji' ? 3 : '50%',
            position: 'absolute',
            top: 3,
            transition: 'left 240ms cubic-bezier(0.32, 0.72, 0, 1)',
            width: 'calc(50% - 3px)',
          }}
        />
        {(
          [
            ['emoji', 'Emojis'],
            ['gif', 'GIFs'],
          ] as const
        ).map(([value, label]) => {
          const active = mode === value;
          return (
            <ButtonBase
              key={value}
              onClick={() => {
                if (value === mode) return;
                keepPanelKeyboardDown();
                onChange(value);
              }}
              onMouseDown={(event) => event.preventDefault()}
              onPointerDown={(event) => event.preventDefault()}
              sx={{
                backgroundColor: 'transparent',
                borderRadius: '999px',
                color: active
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary,
                fontSize: 13,
                fontWeight: 700,
                minWidth: 72,
                px: 1.75,
                py: 0.6,
                transition: 'color 200ms ease',
                zIndex: 1,
              }}
            >
              {label}
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
};
