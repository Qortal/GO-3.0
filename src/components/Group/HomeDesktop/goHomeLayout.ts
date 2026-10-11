import { HOME_DASHBOARD_WIDGET_HEIGHT_PX } from './homeDesktopConstants';

/**
 * Home sizing for GO on tablets and in landscape. GO keeps the phone stack
 * at every size; these only cap how wide it grows and how tall its two feed
 * widgets are. Off GO both return today's values.
 */

/** From this width GO centres Home in a column this wide. */
export const GO_HOME_MAX_WIDTH_PX = 760;
/** Room a short window keeps for the top bar and a peek of the next window. */
const GO_HOME_SHORT_WIDGET_RESERVE_PX = 120;
const GO_HOME_SHORT_WIDGET_MIN_PX = 260;

/** Root Box maxWidth: one readable column on tablets, the Hub's 1320 otherwise. */
export function goHomeMaxWidth(go: boolean, width: number): string {
  return go && width >= GO_HOME_MAX_WIDTH_PX
    ? `${GO_HOME_MAX_WIDTH_PX}px`
    : '1320px';
}

/**
 * Group Activity and feed widget height. A 612 px widget is twice a phone's
 * landscape height, so its inner list traps every swipe; a short window gets
 * one that fits with the window title on screen.
 */
export function goHomeWidgetHeight(
  go: boolean,
  short: boolean,
  stableHeight: number
): number {
  if (!go || !short) return HOME_DASHBOARD_WIDGET_HEIGHT_PX;
  return Math.max(
    GO_HOME_SHORT_WIDGET_MIN_PX,
    Math.min(
      HOME_DASHBOARD_WIDGET_HEIGHT_PX,
      Math.round(stableHeight - GO_HOME_SHORT_WIDGET_RESERVE_PX)
    )
  );
}
