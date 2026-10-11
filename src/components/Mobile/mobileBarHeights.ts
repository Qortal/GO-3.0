// Leaf module: no component imports. mobileLayout.ts reads these at module
// top level, and importing them from MobileTopBar/MobileTabBar closed an
// import cycle (MobileTopBar -> MobileTopBarSearch -> mobileLayout ->
// MobileTopBar) that threw a TDZ ReferenceError under the Vite dev server.
export const MOBILE_TOP_BAR_HEIGHT_PX = 52;

export const MOBILE_TAB_BAR_HEIGHT_PX = 60;

/**
 * CSS variable (on <html>) holding the room the floating tab buttons take at
 * the bottom of GO's own screens, which scroll on behind them: pad a
 * scrolling list's end by `var(--go-tab-bar-space, 0px)`, and lift anything
 * pinned to the bottom by it. 0px wherever the bar is not over the content.
 */
export const GO_TAB_BAR_SPACE_VAR = '--go-tab-bar-space';
export const GO_TAB_BAR_SPACE = `var(${GO_TAB_BAR_SPACE_VAR}, 0px)`;

/**
 * Bottom padding for a list or composer on a screen the tab buttons float
 * over: `extraPx` above the buttons while they are there, otherwise the
 * padding it had before (`fallback`).
 */
export const withTabBarSpace = (extraPx: number, fallback: string): string =>
  `max(calc(${extraPx}px + ${GO_TAB_BAR_SPACE}), ${fallback})`;

/**
 * The bottom safe area for a phone chat composer. On GO with Home/Apps/Chat in
 * the top bar (landscape) the shell's content box already pads the safe area,
 * so goLayout.css sets --go-composer-safe-bottom to 0 and it isn't taken
 * twice. Everywhere else (portrait, the Hub) it is the plain safe area.
 */
export const COMPOSER_SAFE_BOTTOM =
  'var(--go-composer-safe-bottom, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))';
