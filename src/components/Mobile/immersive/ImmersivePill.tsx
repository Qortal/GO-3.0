import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, ButtonBase, Typography, alpha, useTheme } from '@mui/material';
import UnfoldMoreRoundedIcon from '@mui/icons-material/UnfoldMoreRounded';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
} from 'framer-motion';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  directChatHasUnreadAtom,
  groupChatHasUnreadExcludingMutedAtom,
} from '../../../atoms/global';
import { useUnseenNotificationCount } from '../../../hooks/useUnseenNotificationCount';
import {
  immersiveHintSeenAtom,
  immersivePillPositionAtom,
  type ImmersivePillPosition,
} from './immersiveMode';
import { immersiveMotionReduced } from './useImmersiveBars';

export const IMMERSIVE_PILL_SIZE = 46;
const EDGE_GAP = 12;
/** Room kept clear above (where the top bar comes in) and below. */
const TOP_CLEARANCE = 76;
const BOTTOM_CLEARANCE = 28;
const IDLE_AFTER_MS = 2600;
const PILL_Z = 1210;
const SNAP_SPRING = { type: 'spring', stiffness: 520, damping: 36 } as const;

const readInset = (name: string) => {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(
      `--safe-area-inset-${name}`
    );
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
};

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

const readBounds = (): Bounds => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const minY = readInset('top') + TOP_CLEARANCE;
  const maxY = Math.max(
    minY,
    height - readInset('bottom') - IMMERSIVE_PILL_SIZE - BOTTOM_CLEARANCE
  );
  return {
    minX: readInset('left') + EDGE_GAP,
    maxX: width - readInset('right') - IMMERSIVE_PILL_SIZE - EDGE_GAP,
    minY,
    maxY,
  };
};

const toPoint = (position: ImmersivePillPosition, bounds: Bounds) => ({
  x: position.side === 'left' ? bounds.minX : bounds.maxX,
  y: bounds.minY + position.y * (bounds.maxY - bounds.minY),
});

const fromPoint = (
  x: number,
  y: number,
  bounds: Bounds
): ImmersivePillPosition => ({
  // Whichever half of the screen the button's middle is on.
  side:
    x + IMMERSIVE_PILL_SIZE / 2 <
    (bounds.minX + bounds.maxX + IMMERSIVE_PILL_SIZE) / 2
      ? 'left'
      : 'right',
  y:
    bounds.maxY > bounds.minY
      ? Math.min(
          1,
          Math.max(0, (y - bounds.minY) / (bounds.maxY - bounds.minY))
        )
      : 0,
});

type ImmersivePillProps = {
  /** Bars are away: the button is out. */
  visible: boolean;
  onReveal: () => void;
  pillRef?: (node: HTMLElement | null) => void;
};

/**
 * The floating "bring the bars back" button of immersive mode. It sits on a
 * screen edge, can be dragged anywhere along either side (it snaps to the
 * nearest one and remembers it), fades back when left alone, and carries a
 * dot when chats or the bell have something new.
 */
export const ImmersivePill = ({
  visible,
  onReveal,
  pillRef,
}: ImmersivePillProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const [position, setPosition] = useAtom(immersivePillPositionAtom);
  const [hintSeen, setHintSeen] = useAtom(immersiveHintSeenAtom);
  const hasDmUnread = useAtomValue(directChatHasUnreadAtom);
  const hasGroupUnread = useAtomValue(groupChatHasUnreadExcludingMutedAtom);
  const { hasNewNotifications } = useUnseenNotificationCount();
  const reduced = immersiveMotionReduced();
  const isDark = theme.palette.mode === 'dark';

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const draggedRef = useRef(false);
  const [idle, setIdle] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const idleTimerRef = useRef<number | null>(null);

  const wake = useCallback(() => {
    setIdle(false);
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = window.setTimeout(
      () => setIdle(true),
      IDLE_AFTER_MS
    );
  }, []);

  useEffect(
    () => () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
    },
    []
  );

  // Put the button where it was left, and keep it there through rotations.
  const place = useCallback(
    (smooth: boolean) => {
      const point = toPoint(position, readBounds());
      if (smooth && !reduced) {
        void animate(x, point.x, SNAP_SPRING);
        void animate(y, point.y, SNAP_SPRING);
      } else {
        x.set(point.x);
        y.set(point.y);
      }
    },
    [position, reduced, x, y]
  );

  useEffect(() => {
    place(false);
    const onResize = () => place(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // Only re-place on mount/resize; drag end animates on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (visible) wake();
  }, [visible, wake]);

  // First time only: a small bubble explains the button.
  useEffect(() => {
    if (!visible || hintSeen) {
      setShowHint(false);
      return;
    }
    const id = window.setTimeout(() => setShowHint(true), 650);
    return () => window.clearTimeout(id);
  }, [visible, hintSeen]);

  const dismissHint = useCallback(() => {
    setShowHint(false);
    setHintSeen(true);
  }, [setHintSeen]);

  const onDragEnd = useCallback(() => {
    const bounds = readBounds();
    const next = fromPoint(x.get(), y.get(), bounds);
    setPosition(next);
    const point = toPoint(next, bounds);
    if (reduced) {
      x.set(point.x);
      y.set(point.y);
    } else {
      void animate(x, point.x, SNAP_SPRING);
      void animate(y, point.y, SNAP_SPRING);
    }
    wake();
    // A drag is not a tap; let the click that follows it pass.
    window.setTimeout(() => {
      draggedRef.current = false;
    }, 0);
  }, [reduced, setPosition, wake, x, y]);

  const onTap = useCallback(() => {
    if (draggedRef.current) return;
    dismissHint();
    onReveal();
  }, [dismissHint, onReveal]);

  const dot = hasDmUnread
    ? 'pulse'
    : hasGroupUnread || hasNewNotifications
      ? 'still'
      : null;
  const dotColor = hasDmUnread
    ? theme.palette.error.main
    : theme.palette.primary.main;
  const surface = isDark
    ? alpha(theme.palette.background.paper, 0.62)
    : alpha(theme.palette.background.paper, 0.78);
  const hintOnLeft = position.side === 'right';

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="immersive-pill"
          ref={pillRef as never}
          data-immersive-pill
          drag
          dragMomentum={false}
          dragElastic={0}
          onDragStart={() => {
            draggedRef.current = true;
            wake();
          }}
          onDragEnd={onDragEnd}
          onPointerDown={wake}
          initial={reduced ? false : { opacity: 0, scale: 0.4 }}
          animate={{ opacity: idle && !showHint ? 0.42 : 1, scale: 1 }}
          exit={
            reduced
              ? { opacity: 0, transition: { duration: 0 } }
              : {
                  opacity: 0,
                  scale: 0.5,
                  transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
                }
          }
          transition={{
            opacity: { duration: reduced ? 0 : idle ? 0.6 : 0.18 },
            scale: reduced
              ? { duration: 0 }
              : { type: 'spring', stiffness: 460, damping: 26 },
          }}
          whileTap={reduced ? undefined : { scale: 0.86 }}
          style={{
            height: IMMERSIVE_PILL_SIZE,
            left: 0,
            position: 'fixed',
            top: 0,
            touchAction: 'none',
            width: IMMERSIVE_PILL_SIZE,
            x,
            y,
            zIndex: PILL_Z,
          }}
        >
          <ButtonBase
            aria-label={t('group:dashboard.immersive_show_bars', {
              defaultValue: 'Show bars',
            })}
            onClick={onTap}
            sx={{
              alignItems: 'center',
              backdropFilter: 'blur(14px) saturate(140%)',
              WebkitBackdropFilter: 'blur(14px) saturate(140%)',
              backgroundColor: surface,
              border: `1px solid ${alpha(theme.palette.text.primary, isDark ? 0.14 : 0.1)}`,
              borderRadius: '50%',
              boxShadow: isDark
                ? '0 6px 18px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)'
                : '0 6px 18px rgba(15,20,30,0.18), inset 0 1px 0 rgba(255,255,255,0.7)',
              color: theme.palette.text.primary,
              display: 'flex',
              height: '100%',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <UnfoldMoreRoundedIcon sx={{ fontSize: 24 }} />
          </ButtonBase>
          {dot ? (
            <Box
              aria-hidden
              sx={{
                backgroundColor: dotColor,
                border: `2px solid ${theme.palette.background.paper}`,
                borderRadius: '50%',
                height: 11,
                pointerEvents: 'none',
                position: 'absolute',
                right: 1,
                top: 1,
                width: 11,
                ...(dot === 'pulse' && !reduced
                  ? {
                      animation: 'immersive-pill-dot 1.5s ease-in-out infinite',
                      '@keyframes immersive-pill-dot': {
                        '0%, 100%': {
                          boxShadow: `0 0 0 0 ${alpha(dotColor, 0.6)}`,
                          transform: 'scale(1)',
                        },
                        '50%': {
                          boxShadow: `0 0 0 5px ${alpha(dotColor, 0.2)}`,
                          transform: 'scale(1.12)',
                        },
                      },
                    }
                  : {}),
              }}
            />
          ) : null}
          <AnimatePresence>
            {showHint ? (
              <motion.div
                key="immersive-hint"
                initial={
                  reduced
                    ? false
                    : { opacity: 0, scale: 0.85, x: hintOnLeft ? 8 : -8 }
                }
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{
                  opacity: 0,
                  scale: 0.9,
                  transition: { duration: 0.14 },
                }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 380, damping: 28 }
                }
                style={{
                  position: 'absolute',
                  top: '50%',
                  translateY: '-50%',
                  transformOrigin: hintOnLeft ? 'right center' : 'left center',
                  ...(hintOnLeft
                    ? { right: IMMERSIVE_PILL_SIZE + 10 }
                    : { left: IMMERSIVE_PILL_SIZE + 10 }),
                }}
              >
                <Box
                  role="status"
                  sx={{
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    backgroundColor: isDark
                      ? alpha(theme.palette.background.paper, 0.9)
                      : alpha(theme.palette.background.paper, 0.96),
                    border: `1px solid ${alpha(theme.palette.text.primary, 0.1)}`,
                    borderRadius: '14px',
                    boxShadow: isDark
                      ? '0 10px 28px rgba(0,0,0,0.5)'
                      : '0 10px 28px rgba(15,20,30,0.18)',
                    px: 1.5,
                    py: 1.1,
                    width: 196,
                  }}
                >
                  <Typography
                    sx={{
                      color: theme.palette.text.primary,
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      lineHeight: 1.35,
                    }}
                  >
                    {t('group:dashboard.immersive_hint_tap', {
                      defaultValue: 'Tap to bring the bars back',
                    })}
                  </Typography>
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.74rem',
                      lineHeight: 1.4,
                      mt: 0.3,
                    }}
                  >
                    {t('group:dashboard.immersive_hint_drag', {
                      defaultValue: 'Drag it to move it out of the way.',
                    })}
                  </Typography>
                  <ButtonBase
                    onClick={dismissHint}
                    sx={{
                      borderRadius: '8px',
                      color: theme.palette.primary.main,
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      mt: 0.8,
                      px: 1,
                      py: 0.4,
                      ml: -1,
                    }}
                  >
                    {t('group:dashboard.immersive_hint_got_it', {
                      defaultValue: 'Got it',
                    })}
                  </ButtonBase>
                </Box>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
