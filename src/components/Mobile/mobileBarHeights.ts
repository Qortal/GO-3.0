// Leaf module: no component imports. mobileLayout.ts reads these at module
// top level, and importing them from MobileTopBar/MobileTabBar closed an
// import cycle (MobileTopBar -> MobileTopBarSearch -> mobileLayout ->
// MobileTopBar) that threw a TDZ ReferenceError under the Vite dev server.
export const MOBILE_TOP_BAR_HEIGHT_PX = 52;

export const MOBILE_TAB_BAR_HEIGHT_PX = 60;
