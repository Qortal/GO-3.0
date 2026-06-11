import { MOBILE_TOP_BAR_HEIGHT_PX } from './MobileTopBar';
import { MOBILE_TAB_BAR_HEIGHT_PX } from './MobileTabBar';
import {
  SAFE_AREA_BOTTOM,
  SAFE_AREA_LEFT,
  SAFE_AREA_RIGHT,
  SAFE_AREA_TOP,
} from '../../utils/mobileSafeArea';

export { SAFE_AREA_TOP, SAFE_AREA_BOTTOM, SAFE_AREA_LEFT, SAFE_AREA_RIGHT };

export const mobileAppsViewerTopInset = `calc(${MOBILE_TOP_BAR_HEIGHT_PX}px + ${SAFE_AREA_TOP})`;

export const mobileAppsViewerBottomInset = `calc(${MOBILE_TAB_BAR_HEIGHT_PX}px + ${SAFE_AREA_BOTTOM})`;

/**
 * Fill the authenticated main content column on mobile.
 * App.tsx already lays out content below MobileTopBar and above MobileTabBar,
 * so we anchor to the parent instead of re-subtracting the top bar from the viewport.
 */
export const MOBILE_TABS_OVERLAY_Z = 2000;
/** Dialogs/menus opened from the tabs overlay must sit above it. */
export const MOBILE_TABS_DIALOG_Z = 2100;

export const mobileAppsShellSx = {
  bottom: 0,
  display: 'flex',
  flexDirection: 'column' as const,
  left: 0,
  overflow: 'hidden',
  position: 'absolute' as const,
  right: 0,
  top: 0,
  width: '100%',
  zIndex: 100,
};
