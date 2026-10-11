import { useEffect, useRef, useState } from 'react';
import { Box, alpha, useTheme } from '@mui/material';
import { useSetAtom } from 'jotai';
import { MOBILE_TAB_BAR_HEIGHT_PX } from '../mobileBarHeights';
import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../../../utils/mobileSafeArea';
import { immersiveEdgeColorAtom } from './immersiveMode';
import { listenImmersiveEdge } from './immersiveNative';
import { IMMERSIVE_EASING } from './useImmersiveBars';
import { useGoLayout } from '../../../layout/goLayout';

/** Under the floating bars (1200 tab bar, 1250 top bar), over the content. */
const EDGE_Z = 1190;
/**
 * How far each strip fades out over the content. The native side starts
 * reading past this (EDGE_SAMPLE_OFFSET_DP in ImmersivePlugin.java), so keep
 * the two in step.
 */
export const IMMERSIVE_EDGE_FADE_PX = 14;
/** How long a new page colour takes to fade in. */
export const EDGE_CROSSFADE_MS = 600;
/** After the bars' slide, before the colour is read again. */
const SAMPLE_SETTLE_MS = 180;

/** Relative luminance (0 black, 1 white) of a #rrggbb colour, or null. */
const luminanceOf = (color: string | null): number | null => {
  if (!color) return null;
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
};

/**
 * The theme GO's controls read best in over `color`: light (dark text) over
 * a page where black text contrasts more than white, dark otherwise. Null
 * for a colour that is not known (yet).
 */
export const edgeControlsMode = (
  color: string | null
): 'light' | 'dark' | null => {
  const luminance = luminanceOf(color);
  if (luminance === null) return null;
  // Equal contrast with black and white text at about 0.179.
  return luminance > 0.179 ? 'light' : 'dark';
};

/**
 * Solid, then fading to clear over its last IMMERSIVE_EDGE_FADE_PX (toward
 * the content). Measured from the strip's own edge, so it stays right while
 * the strip's height slides with the bars.
 */
export const edgeStrip = (color: string, toward: 'bottom' | 'top') => {
  let clear = 'transparent';
  try {
    clear = alpha(color, 0);
  } catch {
    /* not a colour MUI can read: plain transparent */
  }
  return `linear-gradient(to ${toward}, ${color} 0px, ${color} calc(100% - ${IMMERSIVE_EDGE_FADE_PX}px), ${clear} 100%)`;
};

type Layer = { key: number; color: string };

type ImmersiveEdgesProps = {
  barsShown: boolean;
  /** Measured top bar height (safe area included), for the strip behind it. */
  topBarHeight: number;
  /** The tab bar is on screen when the bars are (portrait, no keyboard). */
  tabBarSlot: boolean;
  showMs: number;
  hideMs: number;
};

const readCssPx = (name: string) => {
  try {
    const n = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(name)
    );
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
};

/**
 * The screen edges in immersive mode, painted in the colour the app shows
 * right under the top strip when that is painted flat (a header, a viewer's
 * black, the page), else the page's own background (read natively from the
 * screen sides, where cards and pictures usually stop), else black for a
 * photo or video out to the sides. At the top it fills
 * the camera strip, and the whole bar
 * area while the top bar is out, so a transparent bar floats on the app's
 * colour; at the bottom it sits behind the floating tab buttons. Each strip
 * fades out over the content, and a new background cross-fades in.
 */
export const ImmersiveEdges = ({
  barsShown,
  topBarHeight,
  tabBarSlot,
  showMs,
  hideMs,
}: ImmersiveEdgesProps) => {
  const theme = useTheme();
  const setEdgeColor = useSetAtom(immersiveEdgeColorAtom);
  const [layers, setLayers] = useState<Layer[]>(() => [
    { key: 0, color: theme.palette.background.default },
  ]);
  const nextKeyRef = useRef(0);
  const bottomOut = barsShown && tabBarSlot;
  const sampledOnceRef = useRef(false);
  // GO: rotation, a fold or a split resize moves the band that is read.
  const layoutEpoch = useGoLayout((l) => l.epoch);
  const stableHeight = useGoLayout((l) => l.stableHeight);

  // Read between the strips, never the strips themselves. When the bars
  // come or go, wait until they have: mid-slide the content moves through
  // the band that is read, and a passing header would flash the strips (and
  // the see-through top bar) to its colour and back.
  useEffect(() => {
    const top = barsShown ? topBarHeight : readCssPx('--safe-area-inset-top');
    const bottomBand =
      readCssPx('--safe-area-inset-bottom') +
      (bottomOut ? MOBILE_TAB_BAR_HEIGHT_PX : 0);
    const fromCssPx = top + IMMERSIVE_EDGE_FADE_PX + 2;
    const toCssPx =
      window.innerHeight - bottomBand - IMMERSIVE_EDGE_FADE_PX - 2;
    const delayMs = sampledOnceRef.current
      ? (barsShown ? showMs : hideMs) + SAMPLE_SETTLE_MS
      : 0;
    sampledOnceRef.current = true;
    let stop: (() => void) | null = null;
    const start = () => {
      stop = listenImmersiveEdge(
        (color) => {
          setEdgeColor(color);
          setLayers((current) => {
            if (current[current.length - 1]?.color === color) return current;
            nextKeyRef.current += 1;
            // The one on show stays underneath while the new one fades in.
            return [...current.slice(-1), { key: nextKeyRef.current, color }];
          });
        },
        { fromCssPx, toCssPx: toCssPx > fromCssPx ? toCssPx : undefined }
      );
    };
    if (delayMs <= 0) {
      start();
      return () => stop?.();
    }
    const timer = window.setTimeout(start, delayMs);
    return () => {
      window.clearTimeout(timer);
      stop?.();
    };
  }, [
    barsShown,
    bottomOut,
    hideMs,
    layoutEpoch,
    setEdgeColor,
    showMs,
    stableHeight,
    topBarHeight,
  ]);

  useEffect(() => () => setEdgeColor(null), [setEdgeColor]);

  const dropOlder = (key: number) =>
    setLayers((current) =>
      current.length > 1 && current[current.length - 1].key === key
        ? current.slice(-1)
        : current
    );

  const ms = barsShown ? showMs : hideMs;
  // Each strip keeps its full height and slides (a transform the GPU runs,
  // smooth even while a Q-App re-lays itself out) instead of growing and
  // shrinking: tucked away, only its camera / home-bar part shows.
  const topFull = topBarHeight > 0 ? `${topBarHeight}px` : SAFE_AREA_TOP;
  const topShift =
    barsShown || topBarHeight <= 0
      ? 'none'
      : `translate3d(0, calc(${SAFE_AREA_TOP} - ${topBarHeight}px), 0)`;
  const bottomFull = `calc(${MOBILE_TAB_BAR_HEIGHT_PX}px + ${SAFE_AREA_BOTTOM})`;
  // With gesture navigation there is no bottom gap once the bar is away, so
  // nothing is left to paint (a lone fade would only tint the app).
  const hasBottomInset = readCssPx('--safe-area-inset-bottom') > 0;
  const bottomShift = bottomOut
    ? 'none'
    : hasBottomInset
      ? `translate3d(0, ${MOBILE_TAB_BAR_HEIGHT_PX}px, 0)`
      : 'translate3d(0, 100%, 0)';

  const renderLayers = (toward: 'bottom' | 'top') =>
    layers.map((layer, index) => {
      const incoming = index === layers.length - 1 && layers.length > 1;
      return (
        <Box
          key={layer.key}
          onAnimationEnd={incoming ? () => dropOlder(layer.key) : undefined}
          sx={{
            background: edgeStrip(layer.color, toward),
            inset: 0,
            position: 'absolute',
            ...(incoming
              ? {
                  animation: `immersive-edge-in ${EDGE_CROSSFADE_MS}ms ease both`,
                  '@keyframes immersive-edge-in': {
                    from: { opacity: 0 },
                    to: { opacity: 1 },
                  },
                }
              : {}),
          }}
        />
      );
    });

  const stripSx = {
    left: 0,
    pointerEvents: 'none',
    position: 'fixed',
    right: 0,
    transition: `transform ${ms}ms ${IMMERSIVE_EASING}`,
    willChange: 'transform',
    zIndex: EDGE_Z,
  } as const;

  return (
    <>
      <Box
        aria-hidden
        data-immersive-top-edge
        sx={{
          ...stripSx,
          height: `calc(${topFull} + ${IMMERSIVE_EDGE_FADE_PX}px)`,
          top: 0,
          transform: topShift,
        }}
      >
        {renderLayers('bottom')}
      </Box>
      <Box
        aria-hidden
        data-immersive-bottom-edge
        sx={{
          ...stripSx,
          bottom: 0,
          height: `calc(${bottomFull} + ${IMMERSIVE_EDGE_FADE_PX}px)`,
          transform: bottomShift,
        }}
      >
        {renderLayers('top')}
      </Box>
    </>
  );
};
