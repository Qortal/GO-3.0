import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core';

/**
 * Native half of immersive mode (Android): hides the status bar (a swipe from
 * the top shows it for a moment, as in any full-screen app) and reports which
 * way a finger drags across the WebView, because scrolling inside a Q-App or
 * website frame never reaches GO's page.
 */
export type ImmersiveTouchEvent =
  | { phase: 'down'; x: number; y: number }
  | { phase: 'drag'; direction: 'up' | 'down' };

/** Dark icons on light bars; `background` (#rrggbb) also fills the gutters. */
export interface SystemBarAppearance {
  lightStatus: boolean;
  lightNav: boolean;
  background?: string;
}

interface ImmersivePlugin {
  setStatusBarHidden(options: { hidden: boolean }): Promise<void>;
  setBarAppearance(options: SystemBarAppearance): Promise<void>;
  setTouchReports(options: { enabled: boolean }): Promise<void>;
  setEdgeSampling(options: {
    enabled: boolean;
    fromCssPx?: number;
    toCssPx?: number;
  }): Promise<void>;
  addListener(
    eventName: 'touch',
    listener: (event: ImmersiveTouchEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'edge',
    listener: (event: { color: string }) => void
  ): Promise<PluginListenerHandle>;
}

const Immersive = registerPlugin<ImmersivePlugin>('Immersive');

const isAndroidNative = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

let statusBarHidden: boolean | null = null;

export function setImmersiveStatusBarHidden(hidden: boolean): void {
  if (!isAndroidNative() || statusBarHidden === hidden) return;
  statusBarHidden = hidden;
  // Older shells without the plugin keep their status bar; nothing else breaks.
  void Immersive.setStatusBarHidden({ hidden }).catch(() => undefined);
}

/**
 * Status/nav bar icon colour and the window colour behind the WebView
 * (landscape side gutters). Android only; older shells without the method
 * keep their bars as they are.
 */
export function setSystemBarAppearance(options: SystemBarAppearance): void {
  if (!isAndroidNative()) return;
  void Immersive.setBarAppearance(options).catch(() => undefined);
}

/**
 * Starts the finger reports and returns a stop function. Reports only flow
 * while someone listens, so Off mode costs nothing.
 */
export function listenImmersiveTouches(
  onEvent: (event: ImmersiveTouchEvent) => void
): () => void {
  if (!isAndroidNative()) return () => undefined;
  let stopped = false;
  let handle: PluginListenerHandle | null = null;
  void Immersive.addListener('touch', onEvent)
    .then((h) => {
      if (stopped) void h.remove();
      else handle = h;
    })
    .catch(() => undefined);
  void Immersive.setTouchReports({ enabled: true }).catch(() => undefined);
  return () => {
    stopped = true;
    void handle?.remove();
    void Immersive.setTouchReports({ enabled: false }).catch(() => undefined);
  };
}

/**
 * The colour for the strips, reported when it changes; native only: the
 * colour right under the top strip when it is painted flat from edge to edge
 * (a header, a viewer's black, the page), else the page's background (the
 * colour covering most of the left and right screen edges between
 * `fromCssPx` and `toCssPx`), else black for a photo or video out to the
 * edges (see pickEdgeColor in ImmersivePlugin.java). Returns a stop function.
 */
export function listenImmersiveEdge(
  onColor: (color: string) => void,
  range: { fromCssPx?: number; toCssPx?: number } = {}
): () => void {
  if (!isAndroidNative()) return () => undefined;
  let stopped = false;
  let handle: PluginListenerHandle | null = null;
  void Immersive.addListener('edge', (event) => {
    if (typeof event?.color === 'string') onColor(event.color);
  })
    .then((h) => {
      if (stopped) void h.remove();
      else handle = h;
    })
    .catch(() => undefined);
  void Immersive.setEdgeSampling({ enabled: true, ...range }).catch(
    () => undefined
  );
  return () => {
    stopped = true;
    void handle?.remove();
    void Immersive.setEdgeSampling({ enabled: false }).catch(() => undefined);
  };
}
