import { useEffect, useLayoutEffect, useRef, type TouchEvent } from 'react';
import { ButtonBase, Typography, useTheme } from '@mui/material';
import type { MessageActionSizes } from './messageActionSizes';
import { registerOwnReaction } from './ownReactionWiggle';
import {
  playReactionLanding,
  playReactionPop,
  revealInScrollParent,
  takeReactionLanding,
} from './reactionLanding';

/** A row mounted this recently is still showing what it loaded with. */
const SETTLE_MS = 1200;

type ReactionChipProps = {
  reaction: string;
  count: number;
  /** How many of `count` are other people's. */
  othersCount: number;
  isMine: boolean;
  sizes: MessageActionSizes;
  /** The message's signature: where a landing for this chip is waiting. */
  messageKey: string;
  /** When the message row mounted (ms), to tell loaded from live chips. */
  mountedAt: number;
  onToggle: () => void;
  onShowWho: (anchor: HTMLElement) => void;
  onTouchStart: (event: TouchEvent<HTMLElement>) => void;
  onTouchMove: (event: TouchEvent<HTMLElement>) => void;
  onTouchEnd: (event: TouchEvent<HTMLElement>) => void;
};

/**
 * One reaction under a message. When it becomes the viewer's own, the emoji
 * the viewer picked flies into it (see reactionLanding.ts) and the chat
 * scrolls it into view; a reaction from someone else pops in. The viewer's
 * own ones move now and then (see ownReactionWiggle.ts).
 */
export const ReactionChip = ({
  reaction,
  count,
  othersCount,
  isMine,
  sizes,
  messageKey,
  mountedAt,
  onToggle,
  onShowWho,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}: ReactionChipProps) => {
  const theme = useTheme();
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const emojiRef = useRef<HTMLSpanElement | null>(null);
  const previousRef = useRef<{ othersCount: number; isMine: boolean } | null>(
    null
  );
  // Outlives re-renders: a count change mid-flight must not cut the flight.
  const cancelFlightRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cancelFlightRef.current?.();
    },
    []
  );

  useEffect(() => {
    const node = emojiRef.current;
    if (!isMine || !node) return;
    return registerOwnReaction(node);
  }, [isMine]);

  // Before paint, so a landing emoji is never seen sitting in the chip early.
  useLayoutEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { othersCount, isMine };
    const chip = chipRef.current;
    const emojiNode = emojiRef.current;
    if (!chip || !emojiNode) return;
    const becameMine = isMine && !previous?.isMine;
    // An emoji in the air lands even if the row has just remounted.
    const flight = becameMine
      ? takeReactionLanding(messageKey, reaction)
      : null;
    if (flight) {
      cancelFlightRef.current?.();
      cancelFlightRef.current = playReactionLanding({
        appear: previous === null,
        chip,
        colors: {
          ring: theme.palette.primary.main,
          sparks: [
            theme.palette.primary.main,
            theme.palette.warning.main,
            theme.palette.error.light,
            theme.palette.success.main,
          ],
        },
        emojiNode,
        flight,
        zIndex: theme.zIndex.snackbar + 100,
      });
      return;
    }
    const live = previous !== null || Date.now() - mountedAt > SETTLE_MS;
    if (!live) return;
    if (becameMine) {
      // Reacted where there is no flight (the desktop's hover bar).
      window.requestAnimationFrame(() => {
        if (chip.isConnected) revealInScrollParent(chip);
      });
      playReactionPop(chip, emojiNode);
      return;
    }
    // Someone else reacted; the viewer's own changes never pop it.
    if (othersCount > (previous?.othersCount ?? 0)) {
      playReactionPop(chip, emojiNode);
    }
    // Only a change in the reaction itself replays it, not a re-render.
  }, [othersCount, isMine]);

  return (
    <ButtonBase
      ref={chipRef}
      sx={{
        background: isMine
          ? `${theme.palette.primary.main}22`
          : theme.palette.background.surface,
        border: '1px solid',
        borderColor: isMine
          ? theme.palette.primary.main
          : theme.palette.divider,
        borderRadius: `${sizes.reactionChipHeightPx / 2}px`,
        height: `${sizes.reactionChipHeightPx}px`,
        minWidth: `${sizes.reactionChipMinWidthPx}px`,
        padding: `0 ${sizes.reactionChipPaddingXPx}px`,
        transition: 'background-color 0.1s ease, border-color 0.1s ease',
        '&:hover': {
          backgroundColor: theme.palette.action.hover,
        },
      }}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onShowWho(event.currentTarget);
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <span
        ref={emojiRef}
        style={{
          display: 'inline-block',
          fontSize: `${sizes.reactionChipEmojiPx}px`,
          lineHeight: 1,
        }}
      >
        {reaction}
      </span>
      {count > 1 && (
        <Typography
          sx={{
            color: isMine
              ? theme.palette.primary.main
              : theme.palette.text.secondary,
            fontFamily: 'Inter',
            fontSize: `${sizes.reactionChipCountPx}px`,
            fontWeight: 600,
            marginLeft: '4px',
          }}
        >
          {count}
        </Typography>
      )}
    </ButtonBase>
  );
};
