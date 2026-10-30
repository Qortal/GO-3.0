import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../../utils/mobileSafeArea';

export { SAFE_AREA_TOP, SAFE_AREA_BOTTOM };

export const MOBILE_TABS_OVERLAY_Z = 2000;
/** Dialogs/menus opened from the tabs overlay must sit above it. */
export const MOBILE_TABS_DIALOG_Z = 2100;

/**
 * Fill the authenticated main content column on mobile.
 * App.tsx already lays out content below MobileTopBar and above MobileTabBar,
 * so we anchor to the parent instead of re-subtracting the top bar from the viewport.
 */
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
