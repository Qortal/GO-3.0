import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from 'react';
import {
  animate,
  motion,
  useMotionValue,
  type AnimationPlaybackControls,
  type MotionValue,
} from 'framer-motion';
import {
  alpha,
  Box,
  Button,
  IconButton,
  keyframes,
  LinearProgress,
  Typography,
  useTheme,
} from '@mui/material';
import AudiotrackRoundedIcon from '@mui/icons-material/AudiotrackRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded';
import MovieRoundedIcon from '@mui/icons-material/MovieRounded';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { QappIcon } from '../App/QappIcon';
import { mobileQappFrameShowingAtom } from '../Mobile/mobileQappFrame';
import { MOBILE_TAB_BAR_HEIGHT_PX } from '../Mobile/mobileBarHeights';
import { immersiveMotionReduced } from '../Mobile/immersive/useImmersiveBars';
import { selectOpenTab, useOpenTabs } from '../Mobile/useOpenTabs';
import { useSoftKeyboardInset } from '../../hooks/useSoftKeyboardInset';
import {
  dismissPublishWindow,
  expandPublishWindow,
  getPublishWindowSnapshot,
  isRowFinal,
  minimizePublishWindow,
  publishJobProgress,
  publishJobSecondsLeft,
  subscribePublishWindow,
  type PublishJob,
  type PublishRow,
  type PublishWindowView,
} from '../../qdn/publish/publishJobs';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { useCloseWithGoWindows } from '../../utils/closeGoWindows';
import { executeEvent } from '../../utils/events';
import {
  SAFE_AREA_BOTTOM,
  SAFE_AREA_LEFT,
  SAFE_AREA_RIGHT,
} from '../../utils/mobileSafeArea';
import {
  BUBBLE_SIZE_PX,
  bubbleBounds,
  loadBubblePlacement,
  placementPoint,
  readScreenInsets,
  releaseVelocity,
  saveBubblePlacement,
  type BubbleBounds,
  type BubblePlacement,
} from './publishBubblePosition';
import { QdnPublishBubble, type BubbleArrival } from './QdnPublishBubble';
import {
  combinedOutcome,
  combinedProgress,
  isProcessing,
  isRetrying,
  needsNodeKey,
  percentText,
  filesPublishedText,
  rowPercent,
  rowStatusText,
  sizeProgressText,
  speedText,
  timeLeftText,
  windowSubtitle,
  windowTitle,
} from './publishWindowText';

const CARD_RADIUS_PX = 28;

const sheen = keyframes`
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
`;
const CARD_Z = 1285;
const BACKDROP_Z = 1284;
/** A pull on the card's top this far down (or flung) minimizes it. */
const PULL_TO_MINIMIZE_PX = 84;
const PULL_TO_MINIMIZE_SPEED = 650;
/** Movement before a press on the card's top becomes a pull. */
const PULL_SLOP_PX = 6;

type CardEnter = 'fresh' | 'from-bubble';
type CardLeave = null | 'to-bubble' | 'away';
type CardState = { key: number; enter: CardEnter; leaving: CardLeave };
type BubbleState = {
  key: number;
  arrival: BubbleArrival;
  waiting: boolean;
  leaving: boolean;
};
type Rect = { left: number; top: number; size: number };

const SERVICE_ICONS: Record<string, typeof MovieRoundedIcon> = {
  VIDEO: MovieRoundedIcon,
  AUDIO: AudiotrackRoundedIcon,
  PODCAST: AudiotrackRoundedIcon,
  VOICE: AudiotrackRoundedIcon,
  IMAGE: ImageRoundedIcon,
  THUMBNAIL: ImageRoundedIcon,
  QCHAT_IMAGE: ImageRoundedIcon,
  DOCUMENT: DescriptionRoundedIcon,
  JSON: DescriptionRoundedIcon,
  BLOG_POST: DescriptionRoundedIcon,
  BLOG_COMMENT: DescriptionRoundedIcon,
  APP: LanguageRoundedIcon,
  WEBSITE: LanguageRoundedIcon,
};

const serviceIcon = (service: string) =>
  SERVICE_ICONS[service.replace(/_PRIVATE$/, '')] ?? InsertDriveFileRoundedIcon;

/** Border radius in percent of the box, so it scales with the morph. */
const radiusOf = (width: number, height: number) =>
  `${(CARD_RADIUS_PX / Math.max(1, width)) * 100}% / ${
    (CARD_RADIUS_PX / Math.max(1, height)) * 100
  }%`;

/**
 * GO's QDN publish window (see qdn/publish/publishJobs.ts). While a Q-App's
 * big or slow publish runs, this window takes the place of the app's own
 * one. "Keep using" (or a pull down, the back button, a tap beside it)
 * shrinks it into a bubble that floats over GO, so the app can be used while
 * the files go up; a tap on the bubble opens it again from where it sits.
 */
export function QdnPublishWindow({ enabled }: { enabled: boolean }) {
  const snapshot = useSyncExternalStore(
    subscribePublishWindow,
    getPublishWindowSnapshot,
    getPublishWindowSnapshot
  );
  const shownJobs = useMemo(
    () => snapshot.jobs.filter((job) => job.shown),
    [snapshot.jobs]
  );
  const view: PublishWindowView = shownJobs.length ? snapshot.view : 'closed';
  // A surface that leaves keeps showing what it showed.
  const lastJobsRef = useRef<PublishJob[]>(shownJobs);
  if (shownJobs.length) lastJobsRef.current = shownJobs;
  const jobs = shownJobs.length ? shownJobs : lastJobsRef.current;

  const reducedMotion = immersiveMotionReduced();
  const keyboardInset = useSoftKeyboardInset();

  // Where the bubble sits; the card shrinks into (and grows out of) it.
  const [placement, setPlacement] =
    useState<BubblePlacement>(loadBubblePlacement);
  const [bounds, setBounds] = useState<BubbleBounds>(() =>
    bubbleBounds(
      { width: window.innerWidth, height: window.innerHeight },
      readScreenInsets()
    )
  );
  const start = placementPoint(placement, bounds);
  const bubbleX = useMotionValue(start.x);
  const bubbleY = useMotionValue(start.y);
  const placementRef = useRef(placement);
  placementRef.current = placement;

  useEffect(() => {
    const onResize = () => {
      const next = bubbleBounds(
        { width: window.innerWidth, height: window.innerHeight },
        readScreenInsets()
      );
      setBounds(next);
      const point = placementPoint(placementRef.current, next);
      bubbleX.set(point.x);
      bubbleY.set(point.y);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [bubbleX, bubbleY]);

  const onSettle = useCallback(
    (next: BubblePlacement) => {
      setPlacement(next);
      saveBubblePlacement(next);
      const point = placementPoint(next, bounds);
      const spring = { type: 'spring' as const, stiffness: 380, damping: 30 };
      animate(bubbleX, point.x, spring);
      animate(bubbleY, point.y, spring);
    },
    [bounds, bubbleX, bubbleY]
  );

  const getBubbleRect = useCallback(
    (): Rect => ({
      left: bubbleX.get(),
      top: bubbleY.get(),
      size: BUBBLE_SIZE_PX,
    }),
    [bubbleX, bubbleY]
  );

  // Which surfaces are on screen, and how they come and go.
  const keySeq = useRef(0);
  const [card, setCard] = useState<CardState | null>(null);
  const [bubble, setBubble] = useState<BubbleState | null>(null);
  const cardRef = useRef(card);
  cardRef.current = card;
  const bubbleRef = useRef(bubble);
  bubbleRef.current = bubble;
  const prevViewRef = useRef<PublishWindowView>('closed');

  useLayoutEffect(() => {
    const prev = prevViewRef.current;
    prevViewRef.current = view;
    if (prev === view) return;
    const liveCard = cardRef.current;
    const liveBubble = bubbleRef.current;
    if (view === 'expanded') {
      // Out of the bubble when there is one on screen, else up from below.
      const fromBubble = Boolean(
        liveBubble && !liveBubble.leaving && !liveBubble.waiting
      );
      setCard(
        liveCard
          ? { ...liveCard, leaving: null }
          : {
              key: ++keySeq.current,
              enter: fromBubble ? 'from-bubble' : 'fresh',
              leaving: null,
            }
      );
      setBubble(null);
    } else if (view === 'minimized') {
      if (liveCard && !liveCard.leaving) {
        setCard({ ...liveCard, leaving: 'to-bubble' });
        setBubble({
          key: ++keySeq.current,
          arrival: 'pop',
          waiting: true,
          leaving: false,
        });
      } else if (!liveBubble || liveBubble.leaving) {
        setBubble({
          key: ++keySeq.current,
          arrival: 'slide',
          waiting: false,
          leaving: false,
        });
      }
    } else {
      if (liveCard) setCard({ ...liveCard, leaving: 'away' });
      if (liveBubble) setBubble({ ...liveBubble, leaving: true });
    }
  }, [view]);

  const onCardLeft = useCallback(() => {
    const leaving = cardRef.current?.leaving;
    setCard(null);
    if (leaving === 'to-bubble') {
      setBubble((current) =>
        current ? { ...current, waiting: false } : current
      );
    }
  }, []);
  // The bubble pops up as the card reaches it, so the two cross-fade.
  const onCardLanding = useCallback(() => {
    setBubble((current) =>
      current?.waiting ? { ...current, waiting: false } : current
    );
  }, []);
  const onBubbleLeft = useCallback(() => setBubble(null), []);

  // Back on Android minimizes the window; the publish carries on.
  useAndroidBack(
    () => {
      if (view !== 'expanded') return false;
      minimizePublishWindow();
      return true;
    },
    { priority: BACK_PRIORITY.dialog, enabled: enabled && view === 'expanded' }
  );
  // Shrinks to its bubble (the publish goes on) when a share opens a chat.
  useCloseWithGoWindows(enabled && view === 'expanded', minimizePublishWindow);

  // "Open <app>" when the app that publishes is not the one on screen.
  const { tabs, selectedTab } = useOpenTabs();
  const qappFrameShowing = useAtomValue(mobileQappFrameShowingAtom);
  const primary = jobs[jobs.length - 1] ?? null;
  const appTab = primary
    ? (tabs.find((tab) => tab.tabId === primary.tabId) ?? null)
    : null;
  const appOnScreen =
    Boolean(primary) &&
    qappFrameShowing &&
    selectedTab?.tabId === primary?.tabId;
  const openApp =
    appTab && !appOnScreen
      ? () => {
          selectOpenTab(appTab);
          minimizePublishWindow();
        }
      : null;

  const backdrop = useMotionValue(0);
  const backdropShown = Boolean(card && card.leaving === null);

  if (!enabled) return null;

  return (
    <>
      {card ? (
        <motion.div
          aria-hidden
          data-testid="qdn-publish-backdrop"
          onClick={() => minimizePublishWindow()}
          style={{
            backdropFilter: 'blur(4px)',
            background: 'rgba(0, 0, 0, 0.42)',
            inset: 0,
            opacity: backdrop,
            pointerEvents: backdropShown ? 'auto' : 'none',
            position: 'fixed',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: BACKDROP_Z,
          }}
        />
      ) : null}
      {card ? (
        <PublishCard
          key={card.key}
          jobs={jobs}
          enter={card.enter}
          leaving={card.leaving}
          backdrop={backdrop}
          getBubbleRect={getBubbleRect}
          reducedMotion={reducedMotion}
          onLanding={onCardLanding}
          onLeft={onCardLeft}
          onOpenApp={openApp}
        />
      ) : null}
      {bubble ? (
        <QdnPublishBubble
          key={bubble.key}
          jobs={jobs}
          x={bubbleX}
          y={bubbleY}
          bounds={bounds}
          side={placement.side}
          arrival={bubble.arrival}
          waiting={bubble.waiting}
          leaving={bubble.leaving}
          hidden={keyboardInset > 0}
          reducedMotion={reducedMotion}
          onExpand={expandPublishWindow}
          onSettle={onSettle}
          onLeft={onBubbleLeft}
        />
      ) : null}
    </>
  );
}

function PublishCard({
  jobs,
  enter,
  leaving,
  backdrop,
  getBubbleRect,
  reducedMotion,
  onLanding,
  onLeft,
  onOpenApp,
}: {
  jobs: PublishJob[];
  enter: CardEnter;
  leaving: CardLeave;
  backdrop: MotionValue<number>;
  getBubbleRect: () => Rect;
  reducedMotion: boolean;
  /** Shrinking into the bubble, nearly there. */
  onLanding: () => void;
  onLeft: () => void;
  onOpenApp: (() => void) | null;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const cardRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scaleX = useMotionValue(1);
  const scaleY = useMotionValue(1);
  const opacity = useMotionValue(1);
  const radius = useMotionValue(`${CARD_RADIUS_PX}px`);
  const content = useMotionValue(1);
  const pull = useRef<{
    id: number;
    startY: number;
    moved: boolean;
    samples: { t: number; y: number }[];
  } | null>(null);

  /**
   * The card's box without the transform the animations put on it. Read
   * from layout, never from getBoundingClientRect: framer paints a motion
   * value on the next frame, so the box on screen can still be the old one.
   */
  const layoutBox = () => {
    const el = cardRef.current;
    if (!el) return null;
    const parent = el.offsetParent as HTMLElement | null;
    const base = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
    return {
      left: base.left + el.offsetLeft,
      top: base.top + el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight,
    };
  };

  /** The transform that lays the card over `rect` (the bubble's circle). */
  const poseAt = (rect: Rect) => {
    const box = layoutBox();
    if (!box) return null;
    return {
      x: rect.left - box.left,
      y: rect.top - box.top,
      scaleX: rect.size / box.width,
      scaleY: rect.size / box.height,
      radius: '50% / 50%',
      fullRadius: radiusOf(box.width, box.height),
    };
  };

  // Starting pose, before the first paint.
  useLayoutEffect(() => {
    const box = layoutBox();
    if (box) radius.set(radiusOf(box.width, box.height));
    if (reducedMotion) {
      opacity.set(0);
      return;
    }
    if (enter === 'from-bubble') {
      const pose = poseAt(getBubbleRect());
      if (pose) {
        x.set(pose.x);
        y.set(pose.y);
        scaleX.set(pose.scaleX);
        scaleY.set(pose.scaleY);
        radius.set(pose.radius);
        content.set(0);
        return;
      }
    }
    y.set(48);
    scaleX.set(0.94);
    scaleY.set(0.94);
    opacity.set(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const running: AnimationPlaybackControls[] = [];
    const run = (control: AnimationPlaybackControls) => running.push(control);
    let landing: ReturnType<typeof setTimeout> | null = null;
    const box = layoutBox();
    const fullRadius = box ? radiusOf(box.width, box.height) : radius.get();

    if (leaving === null) {
      if (reducedMotion) {
        run(animate(opacity, 1, { duration: 0.15 }));
        run(animate(backdrop, 1, { duration: 0.15 }));
        x.set(0);
        y.set(0);
        scaleX.set(1);
        scaleY.set(1);
        content.set(1);
        radius.set(fullRadius);
      } else {
        // Grows out of the bubble (or rises from below) with a little give.
        const spring = { type: 'spring' as const, duration: 0.5, bounce: 0.18 };
        run(animate(x, 0, spring));
        run(animate(y, 0, spring));
        run(animate(scaleX, 1, spring));
        run(animate(scaleY, 1, spring));
        run(
          animate(radius, fullRadius, {
            duration: 0.32,
            ease: [0.3, 0, 0.2, 1],
          })
        );
        run(animate(opacity, 1, { duration: 0.18, ease: 'easeOut' }));
        run(animate(backdrop, 1, { duration: 0.28, ease: 'easeOut' }));
        run(
          animate(content, 1, {
            duration: 0.22,
            delay: enter === 'from-bubble' ? 0.14 : 0.04,
            ease: 'easeOut',
          })
        );
      }
    } else if (leaving === 'to-bubble') {
      const pose = poseAt(getBubbleRect());
      run(animate(backdrop, 0, { duration: 0.26, ease: 'easeOut' }));
      if (!pose || reducedMotion) {
        onLanding();
        run(animate(opacity, 0, { duration: 0.16, onComplete: onLeft }));
      } else {
        landing = setTimeout(onLanding, 280);
        // The content goes first, so it is never seen squeezed; then the
        // card rounds into the bubble's circle on its way there.
        const flight = {
          duration: 0.42,
          delay: 0.05,
          ease: [0.32, 0.72, 0, 1] as const,
        };
        run(animate(content, 0, { duration: 0.06, ease: 'easeIn' }));
        run(animate(x, pose.x, flight));
        run(animate(y, pose.y, flight));
        run(animate(scaleX, pose.scaleX, flight));
        run(animate(scaleY, pose.scaleY, flight));
        run(
          animate(radius, pose.radius, {
            duration: 0.22,
            delay: 0.05,
            ease: 'easeOut',
          })
        );
        run(
          animate(opacity, 0, {
            duration: 0.12,
            delay: 0.34,
            onComplete: onLeft,
          })
        );
      }
    } else {
      run(animate(backdrop, 0, { duration: 0.22, ease: 'easeOut' }));
      run(animate(y, 32, { duration: 0.24, ease: [0.4, 0, 1, 1] }));
      run(animate(scaleX, 0.97, { duration: 0.24 }));
      run(animate(scaleY, 0.97, { duration: 0.24 }));
      run(
        animate(opacity, 0, {
          duration: 0.2,
          ease: 'easeIn',
          onComplete: onLeft,
        })
      );
    }
    return () => {
      if (landing) clearTimeout(landing);
      running.forEach((control) => control.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  // Pulling the top of the card down minimizes it.
  const onPullDown = (event: PointerEvent<HTMLDivElement>) => {
    if (leaving || event.button > 0) return;
    pull.current = {
      id: event.pointerId,
      startY: event.clientY,
      moved: false,
      samples: [{ t: performance.now(), y: event.clientY }],
    };
  };
  const onPullMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = pull.current;
    if (!state || state.id !== event.pointerId) return;
    const dy = event.clientY - state.startY;
    if (!state.moved) {
      if (Math.abs(dy) < PULL_SLOP_PX) return;
      state.moved = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* see QdnPublishBubble */
      }
    }
    // Free downwards, stiff upwards.
    y.set(dy > 0 ? dy : dy * 0.18);
    backdrop.set(1 - Math.min(1, Math.max(0, dy) / 320));
    const now = performance.now();
    state.samples.push({ t: now, y: event.clientY });
    while (state.samples.length > 2 && now - state.samples[0].t > 100) {
      state.samples.shift();
    }
  };
  const onPullEnd = (event: PointerEvent<HTMLDivElement>) => {
    const state = pull.current;
    if (!state || state.id !== event.pointerId) return;
    pull.current = null;
    if (!state.moved) return;
    const speed = releaseVelocity(state.samples, performance.now()).y;
    const dy = event.clientY - state.startY;
    if (dy > PULL_TO_MINIMIZE_PX || speed > PULL_TO_MINIMIZE_SPEED) {
      minimizePublishWindow();
      return;
    }
    animate(y, 0, { type: 'spring', stiffness: 520, damping: 34 });
    animate(backdrop, 1, { duration: 0.2 });
  };

  const outcome = combinedOutcome(jobs);
  const progress = combinedProgress(jobs);
  const processing = isProcessing(jobs);
  const retrying = isRetrying(jobs);
  const nodeKeyNeeded = needsNodeKey(jobs);
  const running = outcome === 'running';
  const failed =
    outcome === 'failed' || outcome === 'partial' || outcome === 'cancelled';
  const primary = jobs[jobs.length - 1];
  const appName = primary?.appName ?? '';
  const speed = running
    ? jobs.reduce((sum, job) => sum + (job.speed ?? 0), 0) || null
    : null;
  const secondsLeft = running
    ? jobs.reduce<number | null>((longest, job) => {
        const left = publishJobSecondsLeft(job);
        if (left === null) return longest;
        return longest === null ? left : Math.max(longest, left);
      }, null)
    : null;
  const details = [
    sizeProgressText(progress.sentBytes, progress.totalBytes, t),
    processing ? null : timeLeftText(secondsLeft, t),
  ]
    .filter(Boolean)
    .join(' · ');
  const accent =
    outcome === 'published'
      ? theme.palette.success.main
      : failed
        ? theme.palette.error.main
        : retrying
          ? theme.palette.warning.main
          : theme.palette.primary.main;

  const titleId = 'qdn-publish-window-title';
  return (
    <Box
      sx={{
        bottom: `calc(${MOBILE_TAB_BAR_HEIGHT_PX}px + ${SAFE_AREA_BOTTOM} + 12px)`,
        display: 'flex',
        justifyContent: 'center',
        left: `max(12px, ${SAFE_AREA_LEFT})`,
        pointerEvents: 'none',
        position: 'fixed',
        right: `max(12px, ${SAFE_AREA_RIGHT})`,
        zIndex: CARD_Z,
      }}
    >
      <motion.div
        ref={cardRef}
        role="dialog"
        aria-labelledby={titleId}
        data-testid="qdn-publish-window"
        style={{
          background: theme.palette.background.paper,
          border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
          borderRadius: radius,
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0 24px 60px rgba(0,0,0,0.6), 0 4px 14px rgba(0,0,0,0.4)'
              : '0 24px 60px rgba(15,20,30,0.24), 0 4px 14px rgba(15,20,30,0.12)',
          maxWidth: 460,
          opacity,
          overflow: 'hidden',
          pointerEvents: leaving ? 'none' : 'auto',
          scaleX,
          scaleY,
          transformOrigin: '0 0',
          width: '100%',
          willChange: 'transform',
          x,
          y,
        }}
      >
        <motion.div style={{ opacity: content }}>
          <Box
            onPointerDown={onPullDown}
            onPointerMove={onPullMove}
            onPointerUp={onPullEnd}
            onPointerCancel={onPullEnd}
            onDragStart={(event) => event.preventDefault()}
            sx={{
              pt: '10px',
              px: 2,
              touchAction: 'none',
              '& img': { pointerEvents: 'none', WebkitUserDrag: 'none' },
            }}
          >
            <Box
              aria-hidden
              sx={{
                bgcolor: alpha(theme.palette.text.primary, 0.18),
                borderRadius: 2,
                height: 4,
                mb: 1.25,
                mx: 'auto',
                width: 38,
              }}
            />
            <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.5 }}>
              <Box sx={{ flex: '0 0 auto', position: 'relative' }}>
                <QappIcon
                  name={appName}
                  sx={{
                    bgcolor: alpha(theme.palette.primary.main, 0.12),
                    borderRadius: '14px',
                    height: 46,
                    width: 46,
                  }}
                />
                {!running ? (
                  <motion.div
                    key={outcome}
                    initial={reducedMotion ? false : { scale: 0.2, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 560, damping: 17 }}
                    style={{
                      background: theme.palette.background.paper,
                      borderRadius: '50%',
                      bottom: -5,
                      display: 'flex',
                      position: 'absolute',
                      right: -5,
                    }}
                  >
                    {outcome === 'published' ? (
                      <CheckCircleRoundedIcon
                        sx={{ color: 'success.main', fontSize: 22 }}
                      />
                    ) : (
                      <ErrorRoundedIcon
                        sx={{ color: 'error.main', fontSize: 22 }}
                      />
                    )}
                  </motion.div>
                ) : null}
              </Box>
              <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
                <Typography
                  id={titleId}
                  aria-live="polite"
                  sx={{ fontSize: '17px', fontWeight: 750, lineHeight: 1.25 }}
                  noWrap
                >
                  {windowTitle(outcome, t)}
                </Typography>
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: '13px',
                    lineHeight: 1.35,
                  }}
                  noWrap
                >
                  {windowSubtitle(jobs, t)}
                </Typography>
              </Box>
              {running ? (
                <IconButton
                  aria-label={t('core:qdn_publish.minimize')}
                  title={t('core:qdn_publish.minimize')}
                  onClick={() => minimizePublishWindow()}
                  sx={{ bgcolor: alpha(theme.palette.text.primary, 0.06) }}
                >
                  <KeyboardArrowDownRoundedIcon />
                </IconButton>
              ) : (
                <IconButton
                  aria-label={t('core:qdn_publish.close')}
                  title={t('core:qdn_publish.close')}
                  onClick={() => dismissPublishWindow()}
                  sx={{ bgcolor: alpha(theme.palette.text.primary, 0.06) }}
                >
                  <CloseRoundedIcon />
                </IconButton>
              )}
            </Box>
          </Box>

          <Box sx={{ pt: 2, px: 2 }}>
            <Box
              sx={{
                alignItems: 'baseline',
                display: 'flex',
                gap: 1,
                justifyContent: 'space-between',
              }}
            >
              {failed ? (
                // A share of bytes says little once it stopped: how many
                // files made it does.
                <Typography
                  sx={{
                    color: accent,
                    fontSize: '17px',
                    fontWeight: 750,
                    lineHeight: 1.3,
                  }}
                >
                  {filesPublishedText(jobs, t)}
                </Typography>
              ) : (
                <Typography
                  sx={{
                    color: running ? 'text.primary' : accent,
                    fontSize: '30px',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 800,
                    letterSpacing: '-0.02em',
                    lineHeight: 1,
                  }}
                >
                  {percentText(running ? progress.fraction : 1, t)}
                </Typography>
              )}
              {running && !processing ? (
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: '12.5px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {speedText(speed, t) ?? ''}
                </Typography>
              ) : null}
            </Box>
            {failed ? null : (
              <LinearProgress
                variant={
                  running && processing ? 'indeterminate' : 'determinate'
                }
                value={running ? Math.round(progress.fraction * 100) : 100}
                aria-label={windowTitle(outcome, t)}
                sx={{
                  bgcolor: alpha(accent, 0.16),
                  borderRadius: 4,
                  height: 8,
                  mt: 1.25,
                  '& .MuiLinearProgress-bar': {
                    bgcolor: accent,
                    borderRadius: 4,
                    overflow: 'hidden',
                    transition:
                      'transform 0.6s cubic-bezier(0.25, 0.8, 0.25, 1)',
                  },
                  // A soft sheen runs along the filled part while the parts
                  // go up, so the bar looks alive between the node's 5 MB
                  // steps. Inside .MuiLinearProgress-root, GO's idle pause
                  // lets it run.
                  '& .MuiLinearProgress-bar1Determinate::after':
                    running && !processing && !reducedMotion
                      ? {
                          animation: `${sheen} 1.8s linear infinite`,
                          background: `linear-gradient(90deg, transparent 0%, ${alpha(
                            '#fff',
                            theme.palette.mode === 'dark' ? 0.28 : 0.45
                          )} 50%, transparent 100%)`,
                          content: '""',
                          inset: 0,
                          position: 'absolute',
                        }
                      : {},
                }}
              />
            )}
            {failed ? null : (
              <Typography
                sx={{
                  color: retrying ? 'warning.main' : 'text.secondary',
                  fontSize: '12.5px',
                  minHeight: '18px',
                  mt: 0.75,
                }}
              >
                {retrying
                  ? t('core:qdn_publish.retrying_hint')
                  : processing
                    ? t('core:qdn_publish.processing_hint')
                    : details}
              </Typography>
            )}
          </Box>

          <Box
            sx={{
              maxHeight: 'min(34vh, 232px)',
              mt: 1.5,
              mx: 2,
              overflowY: 'auto',
              overscrollBehavior: 'contain',
            }}
          >
            {jobs.map((job) => (
              <Box key={job.id}>
                {jobs.length > 1 ? <JobHeader job={job} /> : null}
                {job.rows.map((row, index) => (
                  <PublishRowItem key={`${job.id}-${index}`} row={row} />
                ))}
              </Box>
            ))}
          </Box>

          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              p: 2,
              pt: 1.5,
            }}
          >
            {running ? (
              <>
                <Button
                  variant="contained"
                  disableElevation
                  startIcon={<KeyboardArrowDownRoundedIcon />}
                  onClick={() => minimizePublishWindow()}
                  sx={{
                    borderRadius: '14px',
                    fontWeight: 700,
                    py: 1.1,
                    textTransform: 'none',
                  }}
                >
                  {t('core:qdn_publish.keep_using', { app: appName })}
                </Button>
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: '12px',
                    lineHeight: 1.4,
                    textAlign: 'center',
                  }}
                >
                  {t('core:qdn_publish.keep_using_hint')}
                </Typography>
                {onOpenApp ? (
                  <Button
                    variant="text"
                    onClick={onOpenApp}
                    sx={{ borderRadius: '14px', textTransform: 'none' }}
                  >
                    {t('core:qdn_publish.open_app', { app: appName })}
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                {nodeKeyNeeded ? (
                  <Button
                    variant="contained"
                    disableElevation
                    startIcon={<KeyRoundedIcon />}
                    onClick={() => {
                      executeEvent('openNodeSettings', null);
                      dismissPublishWindow();
                    }}
                    sx={{
                      borderRadius: '14px',
                      fontWeight: 700,
                      py: 1.1,
                      textTransform: 'none',
                    }}
                  >
                    {t('core:qdn_publish.open_node_settings')}
                  </Button>
                ) : null}
                <Button
                  variant={
                    nodeKeyNeeded ? 'text' : failed ? 'contained' : 'outlined'
                  }
                  color={failed && !nodeKeyNeeded ? 'error' : 'primary'}
                  disableElevation
                  onClick={() => {
                    onOpenApp?.();
                    dismissPublishWindow();
                  }}
                  sx={{
                    borderRadius: '14px',
                    fontWeight: 700,
                    py: 1.1,
                    textTransform: 'none',
                  }}
                >
                  {failed
                    ? t(
                        onOpenApp
                          ? 'core:qdn_publish.open_app'
                          : 'core:qdn_publish.back_to_app',
                        { app: appName }
                      )
                    : t('core:qdn_publish.done')}
                </Button>
              </>
            )}
          </Box>
        </motion.div>
      </motion.div>
    </Box>
  );
}

function JobHeader({ job }: { job: PublishJob }) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const { fraction } = publishJobProgress(job);
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: 1,
        pb: 0.5,
        pt: 1,
      }}
    >
      <QappIcon
        name={job.appName}
        logoWidth={14}
        sx={{
          bgcolor: alpha(theme.palette.primary.main, 0.12),
          borderRadius: '7px',
          height: 22,
          width: 22,
        }}
      />
      <Typography sx={{ flex: 1, fontSize: '13px', fontWeight: 700 }} noWrap>
        {job.appName}
      </Typography>
      <Typography
        sx={{
          color: 'text.secondary',
          fontSize: '12px',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {job.outcome === 'running'
          ? percentText(fraction, t)
          : windowTitle(job.outcome, t)}
      </Typography>
    </Box>
  );
}

function PublishRowItem({ row }: { row: PublishRow }) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const Icon = serviceIcon(row.service);
  const percent = rowPercent(row);
  const active = !isRowFinal(row) && row.state !== 'waiting';
  const color =
    row.state === 'published'
      ? theme.palette.success.main
      : row.state === 'failed' || row.state === 'cancelled'
        ? theme.palette.error.main
        : row.retrying
          ? theme.palette.warning.main
          : theme.palette.primary.main;
  return (
    <Box
      data-testid="qdn-publish-row"
      sx={{
        alignItems: 'center',
        borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.06)}`,
        display: 'flex',
        gap: 1.25,
        py: 1,
        '&:first-of-type': { borderTop: 'none' },
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          bgcolor: alpha(color, 0.12),
          borderRadius: '10px',
          color,
          display: 'flex',
          flex: '0 0 auto',
          height: 34,
          justifyContent: 'center',
          transition: 'background-color 240ms ease, color 240ms ease',
          width: 34,
        }}
      >
        {row.state === 'published' ? (
          <CheckCircleRoundedIcon sx={{ fontSize: 20 }} />
        ) : row.state === 'failed' || row.state === 'cancelled' ? (
          <ErrorRoundedIcon sx={{ fontSize: 20 }} />
        ) : (
          <Icon sx={{ fontSize: 20 }} />
        )}
      </Box>
      <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
        <Box sx={{ alignItems: 'baseline', display: 'flex', gap: 1 }}>
          <Typography
            sx={{ flex: 1, fontSize: '14px', fontWeight: 600 }}
            noWrap
          >
            {row.label}
          </Typography>
          <Typography
            sx={{
              color: row.state === 'waiting' ? 'text.secondary' : color,
              flex: '0 0 auto',
              fontSize: '12px',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 600,
            }}
          >
            {rowStatusText(row, t)}
          </Typography>
        </Box>
        {row.error && row.state === 'failed' ? (
          <Typography
            sx={{
              color: 'error.main',
              display: '-webkit-box',
              fontSize: '12px',
              lineHeight: 1.35,
              mt: 0.25,
              overflow: 'hidden',
              overflowWrap: 'anywhere',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
            }}
          >
            {row.error}
          </Typography>
        ) : active ? (
          <LinearProgress
            variant={
              row.state === 'processing' || percent === null
                ? 'indeterminate'
                : 'determinate'
            }
            value={percent ?? 0}
            aria-label={row.label}
            sx={{
              bgcolor: alpha(color, 0.14),
              borderRadius: 2,
              height: 3,
              mt: 0.75,
              '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 2 },
            }}
          />
        ) : null}
      </Box>
    </Box>
  );
}
