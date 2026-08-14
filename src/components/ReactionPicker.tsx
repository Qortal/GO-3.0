import { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import Picker, { EmojiStyle, Theme } from 'emoji-picker-react';
import '../styles/ReactionPicker.css';
import { ButtonBase } from '@mui/material';
import SentimentSatisfiedAltOutlinedIcon from '@mui/icons-material/SentimentSatisfiedAltOutlined';
import { ChatGifPicker } from './Chat/gifs/ChatGifPicker';
import { EmojiGifStage } from './Chat/gifs/EmojiGifStage';
import {
  EMOJI_GIF_SWITCH_HEIGHT,
  EmojiGifSwitch,
  type EmojiGifMode,
} from './Chat/gifs/EmojiGifSwitch';
import type { LibraryGif } from './Chat/gifs/libraryGifs';

export const ReactionPicker = ({
  onReaction,
  onGifSelect,
  neutralIcon = false,
  compactComposer = false,
}: {
  onReaction: (emoji: string) => void;
  onGifSelect?: (gif: LibraryGif) => void;
  neutralIcon?: boolean;
  compactComposer?: boolean;
}) => {
  const [showPicker, setShowPicker] = useState(false);
  const [mode, setMode] = useState<EmojiGifMode>('emoji');
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const [pickerSize, setPickerSize] = useState({ height: 400, width: 350 });
  const pickerRef = useRef(null);
  const buttonRef = useRef(null);
  const showGifTab = typeof onGifSelect === 'function';
  const innerHeight = showGifTab
    ? Math.max(200, pickerSize.height - EMOJI_GIF_SWITCH_HEIGHT)
    : pickerSize.height;

  const handleReaction = (emojiObject) => {
    onReaction(emojiObject.emoji);
    setShowPicker(false);
  };

  const handlePicker = (emojiObject) => {
    onReaction(emojiObject.emoji);
    setShowPicker(false);
  };

  const togglePicker = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (showPicker) {
      setShowPicker(false);
      return;
    }
    const button = buttonRef.current;
    if (!button) return;

    const buttonRect = button.getBoundingClientRect();
    // Keep the panel inside whatever is actually visible: with the soft
    // keyboard up the viewport is short, and a fixed 350x400 box anchored to
    // the button ends up pinned against the top-left corner.
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const margin = 8;
    const width = Math.min(350, viewportWidth - margin * 2);
    const spaceAbove = buttonRect.top - margin * 2;
    const spaceBelow = viewportHeight - buttonRect.bottom - margin * 2;
    const above = spaceBelow < spaceAbove;
    const height = Math.max(
      240,
      Math.min(400, Math.floor(above ? spaceAbove : spaceBelow))
    );

    const top = Math.min(
      Math.max(
        margin,
        above ? buttonRect.top - height - margin : buttonRect.bottom + margin
      ),
      Math.max(margin, viewportHeight - height - margin)
    );
    const left = Math.min(
      Math.max(margin, buttonRect.left + buttonRect.width / 2 - width / 2),
      Math.max(margin, viewportWidth - width - margin)
    );

    setPickerSize({ height, width });
    setPickerPosition({
      top: top + window.scrollY,
      left: left + window.scrollX,
    });
    setMode('emoji');
    setShowPicker(true);
  };

  // Close picker if clicked outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setShowPicker(false);
      }
    };

    if (showPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPicker]);

  return (
    <div className="reaction-container">
      {/* Emoji CTA */}
      <ButtonBase
        sx={{
          borderRadius: '6px',
          color: neutralIcon ? 'text.secondary' : undefined,
          fontSize: '22px',
          height: compactComposer ? 32 : undefined,
          minWidth: compactComposer ? 32 : undefined,
          padding: neutralIcon ? (compactComposer ? '2px' : '4px') : undefined,
          width: compactComposer ? 32 : undefined,
          '&:hover': neutralIcon
            ? { backgroundColor: 'action.hover', color: 'text.primary' }
            : undefined,
        }}
        ref={buttonRef}
        onClick={togglePicker}
        // Opening the picker must not blur the composer, or Android takes the
        // soft keyboard down with it.
        onMouseDown={(event) => event.preventDefault()}
      >
        {neutralIcon ? (
          <SentimentSatisfiedAltOutlinedIcon
            sx={{ fontSize: compactComposer ? '23px' : '18px' }}
          />
        ) : (
          '😃'
        )}
      </ButtonBase>

      {/* Emoji Picker rendered in a portal with calculated position */}
      {showPicker &&
        ReactDOM.createPortal(
          <div
            className="emoji-picker"
            ref={pickerRef}
            style={{
              background: '#1c1e24',
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              left: pickerPosition.left,
              overflow: 'hidden',
              position: 'absolute',
              top: pickerPosition.top,
              width: pickerSize.width,
              zIndex: 1400,
            }}
          >
            {showGifTab ? (
              <EmojiGifStage
                height={innerHeight}
                mode={mode}
                emoji={
                  <Picker
                    allowExpandReactions={true}
                    autoFocusSearch={false}
                    emojiStyle={EmojiStyle.NATIVE}
                    height={innerHeight}
                    onEmojiClick={handlePicker}
                    onReactionClick={handleReaction}
                    theme={Theme.DARK}
                    width={pickerSize.width}
                  />
                }
                gifs={
                  <ChatGifPicker
                    height={innerHeight}
                    onSelect={(gif) => {
                      onGifSelect(gif);
                      setShowPicker(false);
                      setMode('emoji');
                    }}
                  />
                }
              />
            ) : (
              <Picker
                allowExpandReactions={true}
                autoFocusSearch={false}
                emojiStyle={EmojiStyle.NATIVE}
                height={innerHeight}
                onEmojiClick={handlePicker}
                onReactionClick={handleReaction}
                theme={Theme.DARK}
                width={pickerSize.width}
              />
            )}
            {showGifTab ? (
              <EmojiGifSwitch mode={mode} onChange={setMode} />
            ) : null}
          </div>,
          document.body
        )}
    </div>
  );
};
