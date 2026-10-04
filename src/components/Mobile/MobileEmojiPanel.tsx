import { useState } from 'react';
import { Box, useTheme } from '@mui/material';
import Picker, { EmojiStyle, Theme } from 'emoji-picker-react';
import { SAFE_AREA_BOTTOM } from '../../utils/mobileSafeArea';
import { emitEmojiPanelSelection, emitGifPanelSelection } from './emojiPanelBus';
import { ChatGifPicker } from '../Chat/gifs/ChatGifPicker';
import { EmojiGifStage } from '../Chat/gifs/EmojiGifStage';
import { PHONE_EMOJI_PICKER_EMOJI_PX } from '../Chat/messageActionSizes';
import {
  EMOJI_GIF_SWITCH_HEIGHT,
  EmojiGifSwitch,
  type EmojiGifMode,
} from '../Chat/gifs/EmojiGifSwitch';

type MobileEmojiPanelProps = {
  /** Space the panel fills, i.e. what the soft keyboard was covering. */
  heightPx: number;
  /**
   * How much of the viewport the OS keyboard is still covering. The panel sits
   * in that same screen slot so it is revealed as the keyboard retracts,
   * instead of popping in after it is gone.
   */
  keyboardInsetPx?: number;
  /**
   * Search field is focused and the OS keyboard is up: sit above the keyboard
   * so results stay visible, the way Telegram's emoji search does.
   */
  searchLifted?: boolean;
};

/**
 * Emoji keyboard that takes over the soft keyboard's slot at the bottom of the
 * screen, the way Telegram's does. The shell reserves the same height as
 * padding, so swapping between this and the real keyboard leaves the composer
 * exactly where it was.
 */
export const MobileEmojiPanel = ({
  heightPx,
  keyboardInsetPx = 0,
  searchLifted = false,
}: MobileEmojiPanelProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [mode, setMode] = useState<EmojiGifMode>('emoji');
  const revealingOverKeyboard = !searchLifted && keyboardInsetPx > 40;
  const overlayGap =
    typeof window !== 'undefined' && window.visualViewport
      ? Math.max(0, window.innerHeight - window.visualViewport.height)
      : 0;
  const liftedBottom = overlayGap > 80 ? keyboardInsetPx : 0;
  const pickerHeight = Math.max(160, heightPx - EMOJI_GIF_SWITCH_HEIGHT);

  return (
    <Box
      // Marks the slot so the composer can tell "the keyboard came back because
      // the user tapped the panel's search box" from "…because they went back to
      // typing", and only give the slot up for the latter.
      data-emoji-panel="true"
      sx={{
        '@keyframes qortal-emoji-panel-in': {
          from: { opacity: 0.55, transform: 'translateY(10px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        animation: revealingOverKeyboard
          ? 'none'
          : 'qortal-emoji-panel-in 180ms ease-out',
        backgroundColor: isDark
          ? 'rgb(28, 30, 36)'
          : theme.palette.background.paper,
        borderTop: `1px solid ${theme.palette.divider}`,
        bottom: searchLifted ? liftedBottom : -keyboardInsetPx,
        display: 'flex',
        flexDirection: 'column',
        height: `calc(${heightPx}px + ${SAFE_AREA_BOTTOM})`,
        left: 0,
        overflow: 'hidden',
        paddingBottom: SAFE_AREA_BOTTOM,
        position: 'fixed',
        right: 0,
        transition: searchLifted
          ? 'bottom 180ms ease-out, height 180ms ease-out'
          : undefined,
        // Above the bottom tab bar (1200), below the top bar (1400).
        zIndex: 1300,
        '& .EmojiPickerReact': {
          border: 'none !important',
          borderRadius: '0 !important',
          // Same glyph size as the message-toolbar picker on phones.
          '--epr-emoji-size': `${PHONE_EMOJI_PICKER_EMOJI_PX}px !important`,
          '--epr-emoji-padding': '4px !important',
          '--epr-emoji-fullsize':
            'calc(var(--epr-emoji-size) + var(--epr-emoji-padding) * 2) !important',
          '--epr-category-icon-size': '20px !important',
        },
        '& .epr-emoji-category-content': {
          gridTemplateColumns: 'repeat(8, 1fr) !important',
          justifyContent: 'center !important',
          justifyItems: 'center !important',
        },
        ...(searchLifted
          ? {
              '& .epr-category-nav': { display: 'none !important' },
            }
          : {}),
      }}
    >
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <EmojiGifStage
          height={pickerHeight}
          mode={mode}
          emoji={
            <Picker
              autoFocusSearch={false}
              emojiStyle={EmojiStyle.NATIVE}
              height={pickerHeight}
              lazyLoadEmojis
              onEmojiClick={(emojiObject) =>
                emitEmojiPanelSelection(emojiObject.emoji)
              }
              previewConfig={{ showPreview: false }}
              theme={isDark ? Theme.DARK : Theme.LIGHT}
              width="100%"
            />
          }
          gifs={
            <ChatGifPicker
              height={pickerHeight}
              onSelect={emitGifPanelSelection}
            />
          }
        />
      </Box>
      <EmojiGifSwitch mode={mode} onChange={setMode} />
    </Box>
  );
};

export default MobileEmojiPanel;
