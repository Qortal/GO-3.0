import { useEffect, useState, type ReactNode } from 'react';
import { Box } from '@mui/material';
import type { EmojiGifMode } from './EmojiGifSwitch';

type EmojiGifStageProps = {
  emoji: ReactNode;
  gifs: ReactNode;
  height: number;
  mode: EmojiGifMode;
};

const pane = (active: boolean, offset: number) => ({
  height: '100%',
  left: 0,
  opacity: active ? 1 : 0,
  pointerEvents: active ? 'auto' : 'none',
  position: 'absolute' as const,
  top: 0,
  transform: active ? 'translateX(0)' : `translateX(${offset}px)`,
  transition: 'opacity 240ms ease, transform 240ms cubic-bezier(0.32, 0.72, 0, 1)',
  width: '100%',
});

export const EmojiGifStage = ({
  emoji,
  gifs,
  height,
  mode,
}: EmojiGifStageProps) => {
  const [gifVisited, setGifVisited] = useState(mode === 'gif');

  useEffect(() => {
    if (mode === 'gif') setGifVisited(true);
  }, [mode]);

  return (
    <Box
      sx={{
        height,
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      <Box inert={mode !== 'emoji' ? true : undefined} sx={pane(mode === 'emoji', -16)}>
        {emoji}
      </Box>
      {gifVisited ? (
        <Box inert={mode !== 'gif' ? true : undefined} sx={pane(mode === 'gif', 16)}>
          {gifs}
        </Box>
      ) : null}
    </Box>
  );
};
