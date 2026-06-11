import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Safe-area helpers for mobile shells.
 *
 * iOS exposes env(safe-area-inset-*) via viewport-fit=cover. Android draws
 * edge-to-edge; MainActivity injects --safe-area-inset-* from WindowInsets,
 * but that injection races the page load (vars set on the splash document are
 * lost when the app document replaces it). initMobileSafeAreaInsets() pulls
 * the values from the native SafeArea plugin at boot so they're always set.
 */
export const SAFE_AREA_TOP =
  'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))';
export const SAFE_AREA_BOTTOM =
  'var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))';
export const SAFE_AREA_LEFT =
  'var(--safe-area-inset-left, env(safe-area-inset-left, 0px))';
export const SAFE_AREA_RIGHT =
  'var(--safe-area-inset-right, env(safe-area-inset-right, 0px))';

interface SafeAreaPlugin {
  getInsets(): Promise<{
    top: number;
    bottom: number;
    left: number;
    right: number;
  }>;
}

const SafeArea = registerPlugin<SafeAreaPlugin>('SafeArea');

async function applyNativeInsets(): Promise<void> {
  try {
    const insets = await SafeArea.getInsets();
    const style = document.documentElement.style;
    style.setProperty('--safe-area-inset-top', `${insets.top}px`);
    style.setProperty('--safe-area-inset-bottom', `${insets.bottom}px`);
    style.setProperty('--safe-area-inset-left', `${insets.left}px`);
    style.setProperty('--safe-area-inset-right', `${insets.right}px`);
  } catch {
    /* older native shell without the plugin; keep injected/env values */
  }
}

let safeAreaInitialized = false;

/** Populate --safe-area-inset-* from native (Android only; call once at app boot). */
export function initMobileSafeAreaInsets(): void {
  if (safeAreaInitialized) return;
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return;
  }
  safeAreaInitialized = true;

  void applyNativeInsets();
  // Insets change on rotation/fold; re-query when the viewport changes.
  window.addEventListener('resize', () => void applyNativeInsets());
  window.addEventListener('orientationchange', () =>
    void applyNativeInsets()
  );
}
