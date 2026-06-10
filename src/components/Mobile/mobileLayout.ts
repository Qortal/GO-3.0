import { MOBILE_TOP_BAR_HEIGHT_PX } from './MobileTopBar';
import { MOBILE_TAB_BAR_HEIGHT_PX } from './MobileTabBar';

export const mobileAppsViewerTopInset = `calc(${MOBILE_TOP_BAR_HEIGHT_PX}px + env(safe-area-inset-top, 0px))`;

export const mobileAppsViewerBottomInset = `calc(${MOBILE_TAB_BAR_HEIGHT_PX}px + env(safe-area-inset-bottom, 0px))`;

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
