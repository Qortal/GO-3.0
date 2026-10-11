import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  GO_WINDOW_METRICS_EVENT,
  type GoWindowMetrics,
} from '../layout/goLayout';

/**
 * Safe-area helpers for mobile shells.
 *
 * iOS exposes env(safe-area-inset-*) via viewport-fit=cover. Android draws
 * edge-to-edge; MainActivity injects --safe-area-inset-* from WindowInsets,
 * but that injection races the page load (vars set on the splash document are
 * lost when the app document replaces it). initMobileSafeAreaInsets() pulls
 * the values from the native SafeArea plugin at boot so they're always set.
 * The same call hands the native window metrics to the layout store
 * (src/layout/goLayout.ts), so a fresh document has them before the next
 * native push.
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
    // Window metrics (CSS px); missing on older native shells.
    windowWidth?: number;
    windowHeight?: number;
    ime?: number;
    insetLeft?: number;
    insetRight?: number;
    smallestWidthDp?: number;
  }>;
}

type NativeInsets = Awaited<ReturnType<SafeAreaPlugin['getInsets']>>;

/** The metrics part of a getInsets result, or null when it has none. */
export function windowMetricsFromInsets(
  insets: NativeInsets | null | undefined
): GoWindowMetrics | null {
  if (!insets) return null;
  const { windowWidth, windowHeight } = insets;
  if (
    typeof windowWidth !== 'number' ||
    typeof windowHeight !== 'number' ||
    !(windowWidth > 0) ||
    !(windowHeight > 0)
  ) {
    return null;
  }
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return {
    width: windowWidth,
    height: windowHeight,
    ime: num(insets.ime),
    insetLeft: num(insets.insetLeft),
    insetRight: num(insets.insetRight),
    smallestWidthDp: num(insets.smallestWidthDp),
  };
}

function publishWindowMetrics(m: GoWindowMetrics): void {
  window.__goWindowMetrics = m;
  window.dispatchEvent(
    new CustomEvent<GoWindowMetrics>(GO_WINDOW_METRICS_EVENT, { detail: m })
  );
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
    const metrics = windowMetricsFromInsets(insets);
    if (metrics) publishWindowMetrics(metrics);
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
  // Rotation always resizes, and native pushes its own update on every
  // configuration change, so orientationchange (which fires before the new
  // size and returned half-rotated insets) is not listened to.
  window.addEventListener('resize', () => void applyNativeInsets());
}

/** Test hook: lets initMobileSafeAreaInsets run again. */
export function __resetMobileSafeAreaForTests(): void {
  safeAreaInitialized = false;
}
