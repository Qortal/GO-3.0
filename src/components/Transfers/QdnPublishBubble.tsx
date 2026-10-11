import { useEffect, useLayoutEffect, useRef, type PointerEvent } from 'react';
import {
  animate,
  motion,
  useMotionValue,
  type AnimationPlaybackControls,
  type MotionValue,
} from 'framer-motion';
import { alpha, Box, keyframes, useTheme } from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import PriorityHighRoundedIcon from '@mui/icons-material/PriorityHighRounded';
import { useTranslation } from 'react-i18next';
import { QappIcon } from '../App/QappIcon';
import type { PublishJob } from '../../qdn/publish/publishJobs';
import {
  BUBBLE_SIZE_PX,
  releaseVelocity,
  settlePlacement,
  type BubbleBounds,
  type BubblePlacement,
} from './publishBubblePosition';
import {
  combinedOutcome,
  combinedProgress,
  isProcessing,
  isRetrying,
  percentText,
} from './publishWindowText';

/** Movement before a press becomes a drag rather than a tap. */
const DRAG_SLOP_PX = 8;
/** How far past its strip the bubble follows the finger. */
const DRAG_GIVE_PX = 18;
const RING_STROKE = 3.5;
const RING_RADIUS = BUBBLE_SIZE_PX / 2 - RING_STROKE / 2 - 0.5;
const ICON_PX = 42;

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

export type BubbleArrival = 'slide' | 'pop';

/**
 * The minimized publish window: the app's icon in a ring that fills as the
 * files go up, spinning while the node processes them, green with a tick
 * once published and red when something failed. Tap it to open the window;
 * drag it out of the way and it settles against the nearer edge.
 */
export function QdnPublishBubble({
  jobs,
  x,
  y,
  bounds,
  side,
  arrival,
  waiting,
  leaving,
  hidden,
  reducedMotion,
  onExpand,
  onSettle,
  onLeft,
}: {
  jobs: PublishJob[];
  /** Top-left corner, owned by the window (the card shrinks into it). */
  x: MotionValue<number>;
  y: MotionValue<number>;
  bounds: BubbleBounds;
  side: BubblePlacement['side'];
  arrival: BubbleArrival;
  /** The card is still shrinking into this spot: stay invisible. */
  waiting: boolean;
  leaving: boolean;
  /** Out of the way for now (the keyboard is up). */
  hidden: boolean;
  reducedMotion: boolean;
  onExpand: () => void;
  onSettle: (placement: BubblePlacement) => void;
  onLeft: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const scale = useMotionValue(waiting ? 0.9 : arrival === 'slide' ? 0.6 : 0.9);
  const opacity = useMotionValue(0);
  const slide = useMotionValue(0);
  const ring = useMotionValue(0);
  // Under the finger it gives a little; dragged, it lifts.
  const press = useMotionValue(1);
  const pressTo = (value: number) =>
    animate(press, value, { type: 'spring', stiffness: 600, damping: 30 });
  const drag = useRef<{
    id: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    samples: { t: number; x: number; y: number }[];
  } | null>(null);

  const outcome = combinedOutcome(jobs);
  const { fraction } = combinedProgress(jobs);
  const processing = outcome === 'running' && isProcessing(jobs);
  const retrying = outcome === 'running' && isRetrying(jobs);
  const failed =
    outcome === 'failed' || outcome === 'partial' || outcome === 'cancelled';
  const ringColor =
    outcome === 'published'
      ? theme.palette.success.main
      : failed
        ? theme.palette.error.main
        : retrying
          ? theme.palette.warning.main
          : theme.palette.primary.main;
  const appName = jobs[jobs.length - 1]?.appName ?? '';
  const percent = percentText(fraction, t);

  // In: from the edge it docks against, or popping up where the card landed.
  useLayoutEffect(() => {
    if (waiting) return;
    if (arrival === 'slide' && !reducedMotion) {
      slide.set(side === 'left' ? -BUBBLE_SIZE_PX * 1.5 : BUBBLE_SIZE_PX * 1.5);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const running: AnimationPlaybackControls[] = [];
    if (leaving) {
      running.push(
        animate(scale, 0.4, {
          duration: reducedMotion ? 0 : 0.22,
          ease: [0.4, 0, 1, 1],
        }),
        animate(opacity, 0, {
          duration: reducedMotion ? 0 : 0.2,
          ease: 'easeIn',
          onComplete: onLeft,
        })
      );
    } else if (!waiting) {
      if (reducedMotion) {
        scale.set(1);
        opacity.set(1);
        slide.set(0);
      } else {
        running.push(
          animate(slide, 0, { type: 'spring', stiffness: 420, damping: 30 }),
          animate(scale, 1, { type: 'spring', stiffness: 520, damping: 22 }),
          animate(opacity, 1, { duration: 0.16, ease: 'easeOut' })
        );
      }
    }
    return () => running.forEach((control) => control.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, waiting]);

  // The ring fills smoothly between the node's 5 MB steps.
  useEffect(() => {
    const target = outcome === 'running' ? fraction : 1;
    const control = animate(ring, target, {
      duration: reducedMotion ? 0 : 0.6,
      ease: [0.25, 0.8, 0.25, 1],
    });
    return () => control.stop();
  }, [fraction, outcome, reducedMotion, ring]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button > 0 || leaving || waiting) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic events have no capture */
    }
    x.stop();
    y.stop();
    pressTo(0.92);
    drag.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: x.get(),
      originY: y.get(),
      moved: false,
      samples: [{ t: performance.now(), x: event.clientX, y: event.clientY }],
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) < DRAG_SLOP_PX) return;
    if (!state.moved) pressTo(1.08);
    state.moved = true;
    x.set(
      Math.min(
        bounds.maxX + DRAG_GIVE_PX,
        Math.max(bounds.minX - DRAG_GIVE_PX, state.originX + dx)
      )
    );
    y.set(
      Math.min(
        bounds.maxY + DRAG_GIVE_PX,
        Math.max(bounds.minY - DRAG_GIVE_PX, state.originY + dy)
      )
    );
    const now = performance.now();
    state.samples.push({ t: now, x: event.clientX, y: event.clientY });
    while (state.samples.length > 2 && now - state.samples[0].t > 100) {
      state.samples.shift();
    }
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>, tap: boolean) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    pressTo(1);
    if (!state.moved) {
      if (tap) onExpand();
      return;
    }
    onSettle(
      settlePlacement(
        { x: x.get(), y: y.get() },
        releaseVelocity(state.samples, performance.now()),
        bounds
      )
    );
  };

  const label =
    outcome === 'published'
      ? t('core:qdn_publish.bubble_label_published', { app: appName })
      : failed
        ? t('core:qdn_publish.bubble_label_failed', { app: appName })
        : t('core:qdn_publish.bubble_label', { app: appName, percent });

  return (
    <motion.div
      role="button"
      tabIndex={hidden || waiting ? -1 : 0}
      aria-label={label}
      aria-hidden={hidden || waiting || undefined}
      data-testid="qdn-publish-bubble"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endDrag(event, true)}
      onPointerCancel={(event) => endDrag(event, false)}
      // A press held on the icon would start the browser's own image drag
      // (which cancels the pointer) or its long-press menu.
      onDragStart={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onExpand();
        }
      }}
      style={{
        height: BUBBLE_SIZE_PX,
        left: 0,
        opacity,
        pointerEvents: hidden || waiting || leaving ? 'none' : 'auto',
        position: 'fixed',
        scale,
        top: 0,
        touchAction: 'none',
        width: BUBBLE_SIZE_PX,
        x,
        y,
        zIndex: 1280,
      }}
    >
      <motion.div
        style={{
          height: '100%',
          // Not animated by framer, so a plain transition is safe here.
          opacity: hidden ? 0 : 1,
          transition: 'opacity 160ms ease',
          width: '100%',
          x: slide,
        }}
      >
        <motion.div style={{ height: '100%', scale: press, width: '100%' }}>
          <Box
            sx={{
              bgcolor: 'background.paper',
              border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
              borderRadius: '50%',
              boxShadow:
                theme.palette.mode === 'dark'
                  ? '0 10px 28px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.4)'
                  : '0 10px 28px rgba(15,20,30,0.22), 0 2px 6px rgba(15,20,30,0.12)',
              cursor: 'pointer',
              height: '100%',
              position: 'relative',
              userSelect: 'none',
              width: '100%',
              WebkitTapHighlightColor: 'transparent',
              WebkitTouchCallout: 'none',
              // Every press lands on the bubble itself, never on the icon.
              '& *': { pointerEvents: 'none' },
              '& img': { WebkitUserDrag: 'none' },
            }}
          >
            <svg
              width={BUBBLE_SIZE_PX}
              height={BUBBLE_SIZE_PX}
              viewBox={`0 0 ${BUBBLE_SIZE_PX} ${BUBBLE_SIZE_PX}`}
              // The ring starts at twelve o'clock.
              style={{
                inset: 0,
                position: 'absolute',
                transform: 'rotate(-90deg)',
              }}
              aria-hidden
            >
              <circle
                cx={BUBBLE_SIZE_PX / 2}
                cy={BUBBLE_SIZE_PX / 2}
                r={RING_RADIUS}
                fill="none"
                stroke={alpha(ringColor, 0.18)}
                strokeWidth={RING_STROKE}
              />
              {processing ? (
                // A progress spinner, so GO's idle pause leaves it turning.
                <Box
                  component="g"
                  data-hub-keep-animating
                  sx={{
                    animation: reducedMotion
                      ? 'none'
                      : `${spin} 1.1s linear infinite`,
                    transformOrigin: '50% 50%',
                  }}
                >
                  <circle
                    cx={BUBBLE_SIZE_PX / 2}
                    cy={BUBBLE_SIZE_PX / 2}
                    r={RING_RADIUS}
                    fill="none"
                    stroke={ringColor}
                    strokeWidth={RING_STROKE}
                    strokeLinecap="round"
                    strokeDasharray={`${RING_RADIUS * 1.6} ${RING_RADIUS * 10}`}
                  />
                </Box>
              ) : (
                <motion.circle
                  cx={BUBBLE_SIZE_PX / 2}
                  cy={BUBBLE_SIZE_PX / 2}
                  r={RING_RADIUS}
                  fill="none"
                  stroke={ringColor}
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  style={{ pathLength: ring, transition: 'stroke 240ms ease' }}
                />
              )}
            </svg>
            <Box
              sx={{
                borderRadius: '50%',
                height: ICON_PX,
                left: (BUBBLE_SIZE_PX - ICON_PX) / 2 - 1,
                overflow: 'hidden',
                position: 'absolute',
                top: (BUBBLE_SIZE_PX - ICON_PX) / 2 - 1,
                width: ICON_PX,
              }}
            >
              <QappIcon
                name={appName}
                logoWidth={26}
                sx={{
                  bgcolor: alpha(theme.palette.primary.main, 0.12),
                  borderRadius: '50%',
                  height: ICON_PX,
                  width: ICON_PX,
                }}
              />
            </Box>
            {outcome !== 'running' ? (
              <motion.div
                key={outcome}
                initial={reducedMotion ? false : { scale: 0.3, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 520, damping: 18 }}
                style={{
                  alignItems: 'center',
                  background: ringColor,
                  borderRadius: '50%',
                  color: theme.palette.getContrastText(ringColor),
                  display: 'flex',
                  height: ICON_PX,
                  justifyContent: 'center',
                  left: (BUBBLE_SIZE_PX - ICON_PX) / 2 - 1,
                  position: 'absolute',
                  top: (BUBBLE_SIZE_PX - ICON_PX) / 2 - 1,
                  width: ICON_PX,
                }}
              >
                {outcome === 'published' ? (
                  <CheckRoundedIcon sx={{ fontSize: 28 }} />
                ) : (
                  <PriorityHighRoundedIcon sx={{ fontSize: 26 }} />
                )}
              </motion.div>
            ) : null}
            {outcome === 'running' && !processing ? (
              <Box
                aria-hidden
                sx={{
                  alignItems: 'center',
                  bgcolor: ringColor,
                  border: `2px solid ${theme.palette.background.paper}`,
                  borderRadius: '10px',
                  bottom: -7,
                  color: theme.palette.getContrastText(ringColor),
                  display: 'flex',
                  fontSize: '10.5px',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 800,
                  height: 20,
                  justifyContent: 'center',
                  left: '50%',
                  lineHeight: 1,
                  minWidth: 34,
                  position: 'absolute',
                  px: '5px',
                  transform: 'translateX(-50%)',
                  transition: 'background-color 240ms ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {percent}
              </Box>
            ) : null}
            {jobs.length > 1 ? (
              <Box
                aria-hidden
                sx={{
                  alignItems: 'center',
                  bgcolor: 'text.primary',
                  border: `2px solid ${theme.palette.background.paper}`,
                  borderRadius: '10px',
                  color: 'background.paper',
                  display: 'flex',
                  fontSize: '10.5px',
                  fontWeight: 800,
                  height: 20,
                  justifyContent: 'center',
                  minWidth: 20,
                  position: 'absolute',
                  px: '4px',
                  right: -4,
                  top: -4,
                }}
              >
                {jobs.length}
              </Box>
            ) : null}
          </Box>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
