import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { useSetAtom } from 'jotai';
import { atomWithReset } from 'jotai/utils';
import { useEffect, useRef, type RefObject } from 'react';
import { isAndroidApp } from '../../../utils/androidApp';

/**
 * Sideways swipes over GO widgets (native half: SectionSwipePlugin).
 *
 * A widget is a Q-App in a frame, and a frame takes every touch on it, so
 * the page's own swipe between sections never sees a swipe that starts on
 * one. While the widgets screen shows, Android watches touches inside it:
 * a swipe that turns out sideways is taken from the frame (it gets a cancel,
 * as when a scroll takes over) and handed to the section swipe through
 * `widgetSwipeFeed`. A long press there is taken too and handed to the
 * widgets screen through `widgetHoldFeed` (it picks the widget up to move).
 * Taps, typing and vertical scrolling stay the widget's. Each touch is first
 * confirmed here: only when the widgets screen is what is on top under the
 * finger (not a panel or dialog over it) and may take it now (`canClaim`).
 */

interface SectionSwipePlugin {
  setZone(options: {
    enabled: boolean;
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
  }): Promise<void>;
  confirm(options: { id: number; ok: boolean }): Promise<void>;
  addListener(
    eventName: 'probe',
    listener: (event: { id: number; x: number; y: number }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'swipe',
    listener: (event: NativeSwipeEvent) => void
  ): Promise<PluginListenerHandle>;
}

type NativeSwipeEvent = {
  phase: 'start' | 'hold' | 'move' | 'end' | 'cancel';
  x: number;
  y: number;
  /** Event time on the phone's uptime clock (ms). */
  t: number;
  /** That clock when the event was sent. */
  now: number;
};

/** A claimed swipe's touch, for useSectionSwipe's `externalTouches`. */
type ExternalTouch = {
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel';
  x: number;
  y: number;
  /** On the page's clock (event.timeStamp's). */
  timeStamp: number;
  target: Element;
};

export interface ExternalTouchSource {
  subscribe(listener: (touch: ExternalTouch) => void): () => void;
}

const listeners = new Set<(touch: ExternalTouch) => void>();

export const widgetSwipeFeed: ExternalTouchSource & {
  emit(touch: ExternalTouch): void;
} = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  emit(touch) {
    for (const listener of [...listeners]) listener(touch);
  },
};

/** A long press Android took on the widgets screen, then its moves. */
type HoldTouch = {
  type: 'hold' | 'move' | 'end' | 'cancel';
  x: number;
  y: number;
};

const holdListeners = new Set<(touch: HoldTouch) => void>();

export const widgetHoldFeed = {
  subscribe(listener: (touch: HoldTouch) => void): () => void {
    holdListeners.add(listener);
    return () => holdListeners.delete(listener);
  },
  emit(touch: HoldTouch) {
    for (const listener of [...holdListeners]) listener(touch);
  },
};

/**
 * The element Android watches swipes in, once it does (null before, and on
 * shells without the plugin). The page's own swipe leaves touches inside it
 * to the native one, so a swipe is never taken twice.
 */
export const nativeSwipeZoneAtom = atomWithReset<HTMLElement | null>(null);

const SectionSwipe = registerPlugin<SectionSwipePlugin>('SectionSwipe');

const PHASES: Record<
  Exclude<NativeSwipeEvent['phase'], 'hold'>,
  ExternalTouch['type']
> = {
  start: 'touchstart',
  move: 'touchmove',
  end: 'touchend',
  cancel: 'touchcancel',
};

/**
 * Watches `ref`'s element for swipes and long presses over widgets while
 * `enabled`; `canClaim` (read at each touch) says whether they may be taken
 * now (not while the widgets are being arranged).
 */
export function useWidgetSwipeZone(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  canClaim: () => boolean = () => true
): void {
  const setZoneElement = useSetAtom(nativeSwipeZoneAtom);
  const canClaimLatest = useRef(canClaim);
  canClaimLatest.current = canClaim;

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || !isAndroidApp()) return;
    const canClaimRef = () => canClaimLatest.current();
    let stopped = false;
    const handles: PluginListenerHandle[] = [];
    // The phone's clock onto the page's, set per swipe.
    let offset = 0;
    // What the touch under way became: a swipe or a long press.
    let stream: 'swipe' | 'hold' | null = null;

    const sendZone = () => {
      if (stopped) return;
      const box = element.getBoundingClientRect();
      void SectionSwipe.setZone({
        enabled: true,
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
      }).catch(() => undefined);
    };

    const keep = (promise: Promise<PluginListenerHandle>) =>
      promise
        .then((handle) => {
          if (stopped) void handle.remove();
          else handles.push(handle);
        })
        .catch(() => undefined);

    void Promise.all([
      keep(
        SectionSwipe.addListener('probe', ({ id, x, y }) => {
          const top = document.elementFromPoint(x, y);
          const ok = Boolean(top && element.contains(top)) && canClaimRef();
          void SectionSwipe.confirm({ id, ok }).catch(() => undefined);
        })
      ),
      keep(
        SectionSwipe.addListener('swipe', (event) => {
          if (event.phase === 'hold') {
            stream = 'hold';
            widgetHoldFeed.emit({ type: 'hold', x: event.x, y: event.y });
            return;
          }
          if (event.phase === 'start') {
            stream = 'swipe';
            offset = performance.now() - event.now;
          }
          if (stream === 'hold') {
            widgetHoldFeed.emit({
              type: event.phase as HoldTouch['type'],
              x: event.x,
              y: event.y,
            });
          } else {
            widgetSwipeFeed.emit({
              type: PHASES[event.phase as keyof typeof PHASES],
              x: event.x,
              y: event.y,
              timeStamp: event.t + offset,
              target: element,
            });
          }
          if (event.phase === 'end' || event.phase === 'cancel') stream = null;
        })
      ),
    ]).then(() => {
      if (stopped) return;
      sendZone();
      setZoneElement(element);
    });

    // The zone follows the screen's box (rotation, the keyboard, the bars).
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(sendZone);
    observer?.observe(element);
    window.addEventListener('resize', sendZone);

    return () => {
      stopped = true;
      observer?.disconnect();
      window.removeEventListener('resize', sendZone);
      for (const handle of handles) void handle.remove();
      void SectionSwipe.setZone({ enabled: false }).catch(() => undefined);
      setZoneElement((current) => (current === element ? null : current));
    };
  }, [enabled, ref, setZoneElement]);
}
