import type { SxProps, Theme } from '@mui/material';
import { MOBILE_TOP_BAR_HEIGHT_PX } from '../mobileBarHeights';
import { SAFE_AREA_TOP } from '../../../utils/mobileSafeArea';
import { IMMERSIVE_EASING, type ImmersiveBars } from './useImmersiveBars';

/** z-index of the floating top bar: over content and tab bar, under dialogs. */
const IMMERSIVE_TOP_BAR_Z = 1250;

/**
 * Paint the bar (the wrapper's only child) with `background` (a colour or
 * layered CSS background), without its divider.
 */
const barColor = (background: string) => ({
  '& > *': {
    background: `${background} !important`,
    borderBottomColor: 'transparent !important',
  },
});

/**
 * The top bar's wrapper. Outside immersive mode it is display:contents, so
 * the bar sits in the column exactly as before (optionally in the page's
 * own colour, `pageBackground`); inside, it floats and slides, see-through
 * on the page colour when `transparent`.
 */
export const immersiveTopBarSx = (
  bars: ImmersiveBars,
  {
    raisedZIndex,
    transparent = false,
    pageBackground,
  }: {
    raisedZIndex?: number;
    /** Let the page colour (ImmersiveEdges) show through the bar itself. */
    transparent?: boolean;
    /** Outside immersive mode: blend the bar into this page background. */
    pageBackground?: string;
  } = {}
): SxProps<Theme> => {
  if (!bars.active) {
    return {
      display: 'contents',
      ...(pageBackground ? barColor(pageBackground) : {}),
    };
  }
  return {
    // The bar's search field, Tabs button and avatar keep their own
    // backgrounds and float on the page colour.
    ...(transparent ? barColor('transparent') : {}),
    left: 0,
    position: 'fixed',
    right: 0,
    top: 0,
    zIndex: raisedZIndex ?? IMMERSIVE_TOP_BAR_Z,
    ...(bars.barsShown
      ? {
          transform: 'none',
          transition: `transform ${bars.showMs}ms ${IMMERSIVE_EASING}`,
          visibility: 'visible',
        }
      : {
          pointerEvents: 'none',
          transform: 'translateY(-100%)',
          transition: `transform ${bars.hideMs}ms ${IMMERSIVE_EASING}, visibility 0s linear ${bars.hideMs}ms`,
          visibility: 'hidden',
        }),
  };
};

/**
 * Top padding of the content box in immersive mode: room for the bar while
 * it is out, otherwise just the camera strip (ImmersiveTopEdge paints it in
 * the content's own colours).
 */
export const immersiveContentTop = (bars: ImmersiveBars): string => {
  if (!bars.layoutShown) return SAFE_AREA_TOP;
  return bars.topBarHeight > 0
    ? `${bars.topBarHeight}px`
    : `calc(${MOBILE_TOP_BAR_HEIGHT_PX + 1}px + ${SAFE_AREA_TOP})`;
};

/** Props for MobileTabBar's `immersive` option (its slide). */
export const immersiveTabBarProps = (bars: ImmersiveBars) =>
  bars.active
    ? {
        hidden: !bars.barsShown,
        showMs: bars.showMs,
        hideMs: bars.hideMs,
        easing: IMMERSIVE_EASING,
        barRef: bars.tabBarRef,
      }
    : undefined;
