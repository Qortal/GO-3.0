import { useSyncExternalStore } from 'react';
import { useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';

/**
 * Layout signals for GO (the Capacitor Android app), at every size and
 * orientation. GO always runs the phone shell (see goBreakpoints.ts); these
 * signals let tablets and landscape adapt inside it.
 *
 * Every signal is keyboard-proof: the usable height comes from native window
 * metrics (P3), falling back to the tallest innerHeight seen since the last
 * width/orientation change, so opening the keyboard never flips a layout.
 *
 * Leaf module: imports only react and @mui/material. It must never import
 * utils/platform.ts, which many tests mock wholesale.
 */

export type GoWidthClass = 'compact' | 'medium' | 'expanded'; // <600 | 600–839 | ≥840
export type GoDeviceOrientation = 'portrait' | 'landscape';

/** Pushed by native (P3) and returned by SafeArea.getInsets; CSS px, integers. */
export interface GoWindowMetrics {
  width: number; // WebView width after native side margins
  height: number; // window content height (WebView parent): the keyboard never changes it
  ime: number; // keyboard height, 0 when closed
  insetLeft: number; // side margins native applied
  insetRight: number;
  smallestWidthDp: number; // Configuration.smallestScreenWidthDp
}
/** detail: GoWindowMetrics; the latest value is also on window.__goWindowMetrics. */
export const GO_WINDOW_METRICS_EVENT = 'go:window-metrics';

export interface GoLayout {
  readonly go: boolean;
  readonly width: number; // innerWidth
  readonly stableHeight: number; // window height without the keyboard
  readonly widthClass: GoWidthClass;
  readonly short: boolean; // stableHeight < 520 (enter) / < 532 (stay)
  readonly landscape: boolean; // width > stableHeight (window, keyboard-proof)
  readonly deviceOrientation: GoDeviceOrientation; // screen.orientation.type
  readonly largeScreen: boolean; // smallestWidthDp >= 600, else min(screen.w, screen.h) >= 600
  readonly navInTopBar: boolean; // landscape && (width >= 600 || short)
  readonly toolbarOneRow: boolean; // short || widthClass !== 'compact'
  readonly chatTwoPane: boolean; // go && !short && width >= 760 (stay while >= 748)
  readonly epoch: number; // ++ when width (>1 px) or deviceOrientation changes
  readonly nativeMetrics: boolean; // stableHeight came from native
}

export const GO_LAYOUT = {
  mediumMin: 600,
  expandedMin: 840,
  shortMax: 520,
  twoPaneMin: 760,
  hysteresis: 12,
  metricsHoldMs: 300,
} as const;

export interface GoLayoutInput {
  go: boolean;
  width: number;
  stableHeight: number;
  deviceOrientation: GoDeviceOrientation;
  largeScreen: boolean;
  epoch: number;
  nativeMetrics: boolean;
}

declare global {
  interface Window {
    __goWindowMetrics?: GoWindowMetrics;
    __goLayout?: () => GoLayout;
  }
}

type GoDetectWindow = Window & {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
  };
  coreSetup?: unknown;
};

const LAYOUT_KEYS: readonly (keyof GoLayout)[] = [
  'go',
  'width',
  'stableHeight',
  'widthClass',
  'short',
  'landscape',
  'deviceOrientation',
  'largeScreen',
  'navInTopBar',
  'toolbarOneRow',
  'chatTwoPane',
  'epoch',
  'nativeMetrics',
];

/**
 * Pure: the layout for one input. `prev` supplies hysteresis, so a window
 * sitting on a threshold does not flicker between layouts.
 */
export function computeGoLayout(
  input: GoLayoutInput,
  prev?: GoLayout | null
): GoLayout {
  const { go, width, stableHeight } = input;
  const widthClass: GoWidthClass =
    width >= GO_LAYOUT.expandedMin
      ? 'expanded'
      : width >= GO_LAYOUT.mediumMin
        ? 'medium'
        : 'compact';
  const short = prev?.short
    ? stableHeight < GO_LAYOUT.shortMax + GO_LAYOUT.hysteresis
    : stableHeight < GO_LAYOUT.shortMax;
  const landscape = width > stableHeight;
  const twoPaneMin = prev?.chatTwoPane
    ? GO_LAYOUT.twoPaneMin - GO_LAYOUT.hysteresis
    : GO_LAYOUT.twoPaneMin;
  return Object.freeze({
    go,
    width,
    stableHeight,
    widthClass,
    short,
    landscape,
    deviceOrientation: input.deviceOrientation,
    largeScreen: input.largeScreen,
    // Short landscape keeps the inline nav even below 600: a 640x360 phone
    // with side 3-button nav is 592 wide and must still look like v0.0.16.
    navInTopBar: landscape && (width >= GO_LAYOUT.mediumMin || short),
    toolbarOneRow: short || widthClass !== 'compact',
    chatTwoPane: go && !short && width >= twoPaneMin,
    epoch: input.epoch,
    nativeMetrics: input.nativeMetrics,
  });
}

// Off GO nothing ever changes; every flag stays off so a reader that forgets
// to gate on `go` still gets the Hub's behaviour.
const OFF_GO_LAYOUT: GoLayout = Object.freeze({
  go: false,
  width: 0,
  stableHeight: 0,
  widthClass: 'compact',
  short: false,
  landscape: false,
  deviceOrientation: 'portrait',
  largeScreen: false,
  navInTopBar: false,
  toolbarOneRow: false,
  chatTwoPane: false,
  epoch: 0,
  nativeMetrics: false,
});

// ---- Detection ----------------------------------------------------------

let goCache: boolean | null = null;

/** Same rule as isGoApp() in utils/platform.ts, which this must not import. */
function detectGoLayout(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as GoDetectWindow;
  try {
    const cap = w.Capacitor;
    if (
      cap?.isNativePlatform?.() === true &&
      cap.getPlatform?.() !== 'electron' &&
      !w.coreSetup
    ) {
      return true;
    }
  } catch {
    // A half-installed bridge counts as not GO.
  }
  // Vite browser previews can opt into the GO layout; never in a build and
  // never in Electron.
  try {
    if (
      import.meta.env.DEV &&
      !w.coreSetup &&
      window.localStorage?.getItem('qortal.devGoLayout') === '1'
    ) {
      return true;
    }
  } catch {
    // Storage can throw in private contexts.
  }
  return false;
}

/**
 * True when the GO layout rules apply. Cached for the session: the themes are
 * built once at module load, so the answer must not change afterwards.
 */
export function isGoLayout(): boolean {
  if (goCache === null) goCache = detectGoLayout();
  return goCache;
}

// ---- Store --------------------------------------------------------------

let installed = false;
let current: GoLayout | null = null;
let metrics: GoWindowMetrics | null = null;
let epoch = 0;
let lastW = -1;
let lastO: GoDeviceOrientation | null = null;
let fallbackH = 0;
let mismatchSince: number | null = null;
let recheckTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
let removeListeners: (() => void) | null = null;

function readMetrics(raw: unknown): GoWindowMetrics | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0;
  const width = num(r.width);
  const height = num(r.height);
  if (width <= 0 || height <= 0) return null;
  return {
    width,
    height,
    ime: Math.max(0, num(r.ime)),
    insetLeft: num(r.insetLeft),
    insetRight: num(r.insetRight),
    smallestWidthDp: num(r.smallestWidthDp),
  };
}

function readDeviceOrientation(): GoDeviceOrientation {
  const scr = window.screen;
  const type = scr?.orientation?.type;
  if (typeof type === 'string') {
    return type.startsWith('landscape') ? 'landscape' : 'portrait';
  }
  return (scr?.width ?? 0) > (scr?.height ?? 0) ? 'landscape' : 'portrait';
}

function writeDom(l: GoLayout): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const flag = (name: string, on: boolean) => {
    if (on) root.setAttribute(name, '');
    else root.removeAttribute(name);
  };
  flag('data-go-layout', true);
  root.setAttribute('data-go-width', l.widthClass);
  flag('data-go-short', l.short);
  flag('data-go-landscape', l.landscape);
  root.setAttribute('data-go-nav', l.navInTopBar ? 'top' : 'bottom');
  flag('data-go-two-pane', l.chatTwoPane);
  root.style.setProperty('--go-stable-height', `${l.stableHeight}px`);
}

function clearDom(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const name of [
    'data-go-layout',
    'data-go-width',
    'data-go-short',
    'data-go-landscape',
    'data-go-nav',
    'data-go-two-pane',
  ]) {
    root.removeAttribute(name);
  }
  root.style.removeProperty('--go-stable-height');
}

function publish(next: GoLayout): void {
  const prev = current;
  if (prev && LAYOUT_KEYS.every((k) => prev[k] === next[k])) return;
  current = next;
  writeDom(next);
  listeners.forEach((cb) => cb());
}

function scheduleRecheck(delayMs: number): void {
  if (recheckTimer !== null) clearTimeout(recheckTimer);
  recheckTimer = setTimeout(
    () => {
      recheckTimer = null;
      recompute();
    },
    Math.max(0, delayMs)
  );
}

function recompute(): void {
  const now = Date.now();
  const w = Math.round(window.innerWidth);
  const h = Math.round(window.innerHeight);
  const o = readDeviceOrientation();
  if (lastO === null || Math.abs(w - lastW) > 1 || o !== lastO) {
    // Rotation, fold or a split-screen width change: a new baseline.
    if (lastO !== null) epoch += 1;
    lastW = w;
    lastO = o;
    fallbackH = h;
  } else {
    // Within one epoch the keyboard can only shrink innerHeight.
    fallbackH = Math.max(fallbackH, h);
  }

  const m = metrics;
  let stableHeight: number;
  let nativeMetrics = false;
  if (m && Math.abs(m.width - w) <= 2) {
    stableHeight = m.height;
    nativeMetrics = true;
    mismatchSince = null;
  } else if (m) {
    // Native and the WebView disagree mid-rotation: hold the old snapshot
    // briefly rather than publish a half-rotated layout.
    if (mismatchSince === null) mismatchSince = now;
    const held = now - mismatchSince;
    if (current && held < GO_LAYOUT.metricsHoldMs) {
      scheduleRecheck(GO_LAYOUT.metricsHoldMs - held);
      return;
    }
    stableHeight = fallbackH;
  } else {
    stableHeight = fallbackH;
  }

  const largeScreen = m
    ? m.smallestWidthDp >= 600
    : Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0) >= 600;

  publish(
    computeGoLayout(
      {
        go: true,
        width: w,
        stableHeight: Math.round(stableHeight),
        deviceOrientation: o,
        largeScreen,
        epoch,
        nativeMetrics,
      },
      current
    )
  );
}

/**
 * Starts the store on GO: main.tsx calls it before createRoot so the <html>
 * attributes exist before the first paint. Idempotent; a no-op off GO.
 */
export function installGoLayout(): void {
  if (installed || typeof window === 'undefined' || !isGoLayout()) return;
  installed = true;

  metrics = readMetrics(window.__goWindowMetrics);
  const onChange = () => recompute();
  const onMetrics = (e: Event) => {
    metrics =
      readMetrics((e as CustomEvent<GoWindowMetrics>).detail) ??
      readMetrics(window.__goWindowMetrics);
    recompute();
  };

  window.addEventListener('resize', onChange);
  window.addEventListener(GO_WINDOW_METRICS_EVENT, onMetrics);
  const vv = window.visualViewport;
  vv?.addEventListener('resize', onChange);
  const so = window.screen?.orientation;
  if (so && typeof so.addEventListener === 'function') {
    so.addEventListener('change', onChange);
  } else {
    window.addEventListener('orientationchange', onChange);
  }
  removeListeners = () => {
    window.removeEventListener('resize', onChange);
    window.removeEventListener(GO_WINDOW_METRICS_EVENT, onMetrics);
    vv?.removeEventListener('resize', onChange);
    if (so && typeof so.removeEventListener === 'function') {
      so.removeEventListener('change', onChange);
    } else {
      window.removeEventListener('orientationchange', onChange);
    }
  };

  window.__goLayout = () => getGoLayout();
  recompute();
}

/** Frozen snapshot; off GO a constant go:false snapshot. */
export function getGoLayout(): GoLayout {
  return current ?? OFF_GO_LAYOUT;
}

export function subscribeGoLayout(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Latest native window metrics, or null before native has sent any. */
export function getGoWindowMetrics(): GoWindowMetrics | null {
  if (installed) return metrics;
  if (typeof window === 'undefined' || !isGoLayout()) return null;
  return readMetrics(window.__goWindowMetrics);
}

/** Re-renders only when the selected (primitive) value changes. */
export function useGoLayout<T extends boolean | number | string>(
  select: (l: GoLayout) => T
): T {
  const read = () => select(getGoLayout());
  return useSyncExternalStore(subscribeGoLayout, read, read);
}

// ---- Drop-in replacements -----------------------------------------------
// Each calls both hooks every render (rules of hooks) and returns exactly the
// old expression off GO.

const LANDSCAPE_QUERY = '(orientation: landscape)';
const selectShort = (l: GoLayout) => l.short;
const selectNavInTopBar = (l: GoLayout) => l.navInTopBar;
const selectToolbarOneRow = (l: GoLayout) => l.toolbarOneRow;

/** GO: short window. Hub: useMediaQuery('(orientation: landscape)'). */
export function useShortLandscape(): boolean {
  const legacy = useMediaQuery(LANDSCAPE_QUERY);
  const v = useGoLayout(selectShort);
  return isGoLayout() ? v : legacy;
}

/** GO: Home/Apps/Chat inline in the top bar. Hub: the landscape query. */
export function useNavInTopBar(): boolean {
  const legacy = useMediaQuery(LANDSCAPE_QUERY);
  const v = useGoLayout(selectNavInTopBar);
  return isGoLayout() ? v : legacy;
}

/** GO: one-row formatting toolbar. Hub: the landscape query. */
export function useToolbarOneRow(): boolean {
  const legacy = useMediaQuery(LANDSCAPE_QUERY);
  const v = useGoLayout(selectToolbarOneRow);
  return isGoLayout() ? v : legacy;
}

/** GO: down('sm') || short. Hub: down('sm'). */
export function useSheetFullScreen(): boolean {
  const theme = useTheme();
  const legacy = useMediaQuery(theme.breakpoints.down('sm'));
  const short = useGoLayout(selectShort);
  return isGoLayout() ? legacy || short : legacy;
}

// ---- Tests --------------------------------------------------------------

/**
 * Forces the layout for tests. `{ go: true, ...input }` makes isGoLayout()
 * true and publishes a snapshot computed without hysteresis; missing fields
 * default to a 393x873 phone in portrait (orientation and largeScreen are
 * derived from the size). `{ go: false }` forces the Hub. `null` undoes it
 * all: removes listeners, attributes and the cached detection.
 */
export function __setGoLayoutForTests(
  o: (Partial<GoLayoutInput> & { go: boolean }) | null
): void {
  if (recheckTimer !== null) clearTimeout(recheckTimer);
  recheckTimer = null;
  removeListeners?.();
  removeListeners = null;
  installed = false;
  metrics = null;
  epoch = 0;
  lastW = -1;
  lastO = null;
  fallbackH = 0;
  mismatchSince = null;
  if (typeof window !== 'undefined') delete window.__goLayout;

  if (o === null) {
    goCache = null;
    current = null;
    clearDom();
  } else if (!o.go) {
    goCache = false;
    current = null;
    clearDom();
  } else {
    goCache = true;
    const width = o.width ?? 393;
    const stableHeight = o.stableHeight ?? 873;
    current = computeGoLayout({
      go: true,
      width,
      stableHeight,
      deviceOrientation:
        o.deviceOrientation ??
        (width > stableHeight ? 'landscape' : 'portrait'),
      largeScreen: o.largeScreen ?? Math.min(width, stableHeight) >= 600,
      epoch: o.epoch ?? 0,
      nativeMetrics: o.nativeMetrics ?? false,
    });
    writeDom(current);
  }
  listeners.forEach((cb) => cb());
}
