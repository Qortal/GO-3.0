import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import type { ImmersiveMode } from './immersiveMode';
import {
  createScrollDirectionTracker,
  signalForFingerDirection,
  type ImmersiveScrollSignal,
} from './scrollDirection';
import {
  listenImmersiveTouches,
  setImmersiveStatusBarHidden,
  type ImmersiveTouchEvent,
} from './immersiveNative';
import { subscribeToEvent, unsubscribeFromEvent } from '../../../utils/events';

export const IMMERSIVE_SHOW_MS = 280;
export const IMMERSIVE_HIDE_MS = 240;
/** Quick to start, soft to land: the bars glide in rather than snap. */
export const IMMERSIVE_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
/** Bars brought back with the button go away again after this long. */
export const IMMERSIVE_REVEAL_MS = 4000;

/**
 * Marks the element the content slide moves (the box holding Home, Apps and
 * Chat). It moves on a transform, which the GPU animates even while the page
 * is busy (a Q-App re-laying itself out for its new height runs on the same
 * thread); without one the whole content box slides on `top`.
 */
export const IMMERSIVE_SLIDE_TARGET_ATTR = 'data-immersive-slide-target';

/** Overlays that own the screen while open: never hide the bars under them. */
const HOLD_SELECTOR = '[data-immersive-hold]';
const OPEN_MODAL_SELECTOR = '.MuiModal-root:not(.MuiModal-hidden)';
/** Scrolling in these never moves the bars. */
const IGNORE_SCROLL_SELECTOR = [
  '.MuiModal-root',
  '.MuiPopover-root',
  '[role="dialog"]',
  '[data-immersive-ignore]',
  HOLD_SELECTOR,
].join(',');

type RevealKind = 'auto' | 'button';

export const immersiveMotionReduced = (): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    if (document.documentElement.dataset.hubUiAnimations === 'off') {
      return true;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

const contains = (root: Element | null, node: EventTarget | null) =>
  Boolean(root && node instanceof Node && root.contains(node));

const isEditable = (node: Element | null): boolean => {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  if (
    node instanceof HTMLTextAreaElement ||
    node instanceof HTMLSelectElement
  ) {
    return true;
  }
  if (node instanceof HTMLInputElement) {
    return ![
      'button',
      'checkbox',
      'radio',
      'submit',
      'reset',
      'range',
    ].includes(node.type);
  }
  return false;
};

const readPx = (value: string | null | undefined) => {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) ? n : 0;
};

export type UseImmersiveBarsOptions = {
  mode: ImmersiveMode;
  /** The current screen may go full screen (section, not locked, etc.). */
  eligible: boolean;
  /** Changes when the section or the open Q-App changes. */
  surfaceKey: string;
  /** Something opened from the bars is showing (Tabs grid): keep them. */
  holdOpen: boolean;
  /**
   * Hide the phone's status bar even where the bars themselves stay (the
   * Q-Apps library with immersive mode on).
   */
  hideStatusBar?: boolean;
  /**
   * The Q-App on screen asked for full screen (SET_FULL_SCREEN): bars and
   * status bar away whatever the mode, no button, nothing brings them back
   * until it ends.
   */
  forceHidden?: boolean;
};

export type ImmersiveBars = {
  active: boolean;
  /** A Q-App's own full screen is holding the bars away. */
  forced: boolean;
  /** Where the bars are heading (drives their slide). */
  barsShown: boolean;
  /** Whether the content is laid out between the bars right now. */
  layoutShown: boolean;
  /** Measured top bar height, safe area included. */
  topBarHeight: number;
  showMs: number;
  hideMs: number;
  topBarRef: (node: HTMLElement | null) => void;
  tabBarRef: (node: HTMLElement | null) => void;
  pillRef: (node: HTMLElement | null) => void;
  contentRef: (node: HTMLElement | null) => void;
  /** The floating button: bars back for a few seconds. */
  reveal: () => void;
};

/**
 * Runs immersive mode for the phone shell.
 *
 * The bars float above the content and slide on transforms. The content is
 * re-laid out only once per change, never per frame: on the way in it slides
 * down with the top bar and then settles between the bars; on the way out it
 * is laid out full screen first and slides up from where it was. Q-App and
 * website frames therefore resize once (like a rotation) and are never left
 * under a bar.
 */
export function useImmersiveBars({
  mode,
  eligible,
  surfaceKey,
  holdOpen,
  hideStatusBar = false,
  forceHidden = false,
}: UseImmersiveBarsOptions): ImmersiveBars {
  const forced = eligible && forceHidden;
  // After an app's full screen ends with the setting Off, stay on just long
  // enough for the bars to glide back in.
  const [releasing, setReleasing] = useState(false);
  const active = eligible && (mode !== 'off' || forced || releasing);
  const [barsShown, setBarsShown] = useState(true);
  const [layoutShown, setLayoutShown] = useState(true);
  const [topBarHeight, setTopBarHeight] = useState(0);
  const reduced = immersiveMotionReduced();
  const showMs = reduced ? 0 : IMMERSIVE_SHOW_MS;
  const hideMs = reduced ? 0 : IMMERSIVE_HIDE_MS;

  const activeRef = useRef(active);
  const forcedRef = useRef(forced);
  forcedRef.current = forced;
  const modeRef = useRef(mode);
  const holdOpenRef = useRef(holdOpen);
  const barsShownRef = useRef(true);
  const layoutShownRef = useRef(true);
  const topBarHeightRef = useRef(0);
  const revealKindRef = useRef<RevealKind>('auto');
  const autoHideTimerRef = useRef<number | null>(null);
  const quietUntilRef = useRef(0);
  const animationRef = useRef<Animation | null>(null);
  const pendingHideFromRef = useRef<number | null>(null);
  const pendingShowCommitRef = useRef(false);
  const pendingShowSlideRef = useRef(false);
  const trackerRef = useRef(createScrollDirectionTracker());

  const topBarElRef = useRef<HTMLElement | null>(null);
  const tabBarElRef = useRef<HTMLElement | null>(null);
  const pillElRef = useRef<HTMLElement | null>(null);
  const contentElRef = useRef<HTMLElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  activeRef.current = active;
  modeRef.current = mode;
  holdOpenRef.current = holdOpen;

  // ---- measuring the top bar ---------------------------------------------
  const measureTopBar = useCallback(() => {
    const wrapper = topBarElRef.current;
    // The wrapper is display:contents outside immersive mode; the bar itself
    // is its first child either way.
    const bar = (wrapper?.firstElementChild as HTMLElement | null) ?? null;
    const height = bar ? bar.getBoundingClientRect().height : 0;
    if (height > 0 && Math.abs(height - topBarHeightRef.current) > 0.1) {
      topBarHeightRef.current = height;
      setTopBarHeight(height);
    }
  }, []);

  const observedBarRef = useRef<Element | null>(null);
  const observeTopBar = useCallback(() => {
    const bar = topBarElRef.current?.firstElementChild ?? null;
    if (bar === observedBarRef.current) return;
    observedBarRef.current = bar;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (bar && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measureTopBar);
      observer.observe(bar);
      resizeObserverRef.current = observer;
    }
    measureTopBar();
  }, [measureTopBar]);

  const topBarRef = useCallback(
    (node: HTMLElement | null) => {
      topBarElRef.current = node;
      observeTopBar();
    },
    [observeTopBar]
  );
  const tabBarRef = useCallback((node: HTMLElement | null) => {
    tabBarElRef.current = node;
  }, []);
  const pillRef = useCallback((node: HTMLElement | null) => {
    pillElRef.current = node;
  }, []);
  const contentRef = useCallback((node: HTMLElement | null) => {
    contentElRef.current = node;
  }, []);

  useLayoutEffect(() => {
    // The bar can be swapped (or come back from null) as screens change;
    // this is a cheap identity check unless it did.
    observeTopBar();
  });

  useEffect(() => () => resizeObserverRef.current?.disconnect(), []);

  // ---- content slide ------------------------------------------------------
  /** What moves, and how: the sections box on a transform, else the
   * content box on `top`. */
  const slideTargetRef = useRef<{ el: HTMLElement; transform: boolean } | null>(
    null
  );
  const slideTarget = useCallback(() => {
    const content = contentElRef.current;
    if (!content) return null;
    const sections = content.querySelector<HTMLElement>(
      `[${IMMERSIVE_SLIDE_TARGET_ATTR}]`
    );
    return sections
      ? { el: sections, transform: true }
      : { el: content, transform: false };
  }, []);

  const clearContentMotion = useCallback(() => {
    animationRef.current?.cancel();
    animationRef.current = null;
    const target = slideTargetRef.current;
    slideTargetRef.current = null;
    if (target && !target.transform) target.el.style.position = '';
    if (target?.transform) target.el.style.willChange = '';
  }, []);

  /** Where the running slide has the content right now (px from rest). */
  const currentOffset = useCallback(() => {
    const target = slideTargetRef.current;
    if (!target || !animationRef.current) return 0;
    const style = getComputedStyle(target.el);
    if (!target.transform) return readPx(style.top);
    try {
      return new DOMMatrixReadOnly(style.transform).m42;
    } catch {
      return 0;
    }
  }, []);

  const slideContent = useCallback(
    (from: number, to: number, ms: number, onDone?: () => void) => {
      clearContentMotion();
      const target = slideTarget();
      const el = target?.el;
      if (
        !target ||
        !el ||
        ms <= 0 ||
        from === to ||
        typeof el.animate !== 'function'
      ) {
        onDone?.();
        return;
      }
      slideTargetRef.current = target;
      let animation: Animation;
      if (target.transform) {
        el.style.willChange = 'transform';
        animation = el.animate(
          [
            { transform: `translate3d(0, ${from}px, 0)` },
            { transform: `translate3d(0, ${to}px, 0)` },
          ],
          { duration: ms, easing: IMMERSIVE_EASING, fill: 'forwards' }
        );
      } else {
        // `top` on a relative box moves it (and any frame inside) without
        // resizing anything, and unlike a transform it leaves fixed-position
        // children where they are.
        el.style.position = 'relative';
        animation = el.animate([{ top: `${from}px` }, { top: `${to}px` }], {
          duration: ms,
          easing: IMMERSIVE_EASING,
          fill: 'forwards',
        });
      }
      animationRef.current = animation;
      // A paused WebView (screen off, app in the background) stops the
      // animation clock; finish on time anyway so the layout never waits.
      const safety = window.setTimeout(() => {
        if (animationRef.current === animation) animation.finish();
      }, ms + 120);
      // The promise, not onfinish: finish events wait for the next painted
      // frame, which a paused WebView may not draw for a while.
      animation.finished
        .then(() => {
          window.clearTimeout(safety);
          if (animationRef.current !== animation) return;
          if (onDone) onDone();
          else clearContentMotion();
        })
        .catch(() => window.clearTimeout(safety));
    },
    [clearContentMotion, slideTarget]
  );

  // ---- show / hide --------------------------------------------------------
  const clearAutoHide = useCallback(() => {
    if (autoHideTimerRef.current !== null) {
      window.clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
  }, []);

  /**
   * Typing in the bars (the address field): keep them. A tapped button keeps
   * focus too, but that is not a reason to hold them, or the Apps tab would
   * pin the bars on screens that never take focus back (Explore).
   */
  const barsHaveFocus = useCallback(() => {
    const focused = document.activeElement;
    if (!isEditable(focused)) return false;
    return (
      contains(topBarElRef.current, focused) ||
      contains(tabBarElRef.current, focused)
    );
  }, []);

  const isHeld = useCallback(
    () =>
      holdOpenRef.current ||
      barsHaveFocus() ||
      Boolean(document.querySelector(HOLD_SELECTOR)) ||
      Boolean(document.querySelector(OPEN_MODAL_SELECTOR)),
    [barsHaveFocus]
  );

  const markQuiet = useCallback((ms: number) => {
    // Re-laying out the content can itself fire scroll events; ignore them.
    quietUntilRef.current = performance.now() + ms + 160;
    trackerRef.current.reset();
  }, []);

  const hide = useCallback(() => {
    if (!activeRef.current || !barsShownRef.current) return;
    clearAutoHide();
    barsShownRef.current = false;
    pendingShowSlideRef.current = false;
    setBarsShown(false);
    markQuiet(hideMs);
    if (layoutShownRef.current) {
      // Lay out full screen first, then slide up from where it was.
      const el = contentElRef.current;
      pendingHideFromRef.current = el
        ? readPx(getComputedStyle(el).paddingTop) + currentOffset()
        : 0;
      layoutShownRef.current = false;
      setLayoutShown(false);
    } else {
      // Caught mid-way in: just glide back.
      slideContent(currentOffset(), 0, hideMs);
    }
  }, [clearAutoHide, currentOffset, hideMs, markQuiet, slideContent]);

  const scheduleAutoHide = useCallback(() => {
    clearAutoHide();
    if (modeRef.current !== 'manual' && revealKindRef.current !== 'button') {
      return;
    }
    const tick = () => {
      autoHideTimerRef.current = null;
      if (!activeRef.current || !barsShownRef.current) return;
      if (isHeld()) {
        autoHideTimerRef.current = window.setTimeout(tick, 1200);
        return;
      }
      flushSync(hide);
    };
    autoHideTimerRef.current = window.setTimeout(tick, IMMERSIVE_REVEAL_MS);
  }, [clearAutoHide, hide, isHeld]);

  const show = useCallback(
    (kind: RevealKind) => {
      if (!activeRef.current || forcedRef.current) return;
      revealKindRef.current = kind;
      scheduleAutoHide();
      if (barsShownRef.current) return;
      barsShownRef.current = true;
      markQuiet(showMs);
      // The slide starts with the bar's own transition (same commit, see
      // below), so the two move as one.
      pendingShowSlideRef.current = true;
      setBarsShown(true);
    },
    [markQuiet, scheduleAutoHide, showMs]
  );

  useLayoutEffect(() => {
    if (!barsShown || !pendingShowSlideRef.current) return;
    pendingShowSlideRef.current = false;
    const el = contentElRef.current;
    const padTop = el ? readPx(getComputedStyle(el).paddingTop) : 0;
    const target = Math.max(0, topBarHeightRef.current - padTop);
    // Slide down with the bar, then settle between the bars in one go.
    slideContent(currentOffset(), target, showMs, () => {
      pendingShowCommitRef.current = true;
      layoutShownRef.current = true;
      setLayoutShown(true);
    });
  }, [barsShown, currentOffset, showMs, slideContent]);

  // Runs in the same frame as the new padding, so nothing visibly jumps.
  useLayoutEffect(() => {
    if (layoutShown && pendingShowCommitRef.current) {
      pendingShowCommitRef.current = false;
      clearContentMotion();
      return;
    }
    if (!layoutShown && pendingHideFromRef.current !== null) {
      const el = contentElRef.current;
      const before = pendingHideFromRef.current;
      pendingHideFromRef.current = null;
      const after = el ? readPx(getComputedStyle(el).paddingTop) : 0;
      slideContent(Math.max(0, before - after), 0, hideMs);
    }
  }, [layoutShown, clearContentMotion, hideMs, slideContent]);

  const reveal = useCallback(() => show('button'), [show]);

  // ---- turning on / off, changing screens ---------------------------------
  const wasActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (!active) {
      clearAutoHide();
      clearContentMotion();
      pendingHideFromRef.current = null;
      pendingShowCommitRef.current = false;
      pendingShowSlideRef.current = false;
      barsShownRef.current = true;
      layoutShownRef.current = true;
      setBarsShown(true);
      setLayoutShown(true);
      return;
    }
    if (!wasActive) {
      // Arrive with the bars where they were (shown), then let the mode act.
      revealKindRef.current = 'auto';
      window.setTimeout(() => {
        if (activeRef.current && modeRef.current === 'manual') hide();
      }, 120);
    }
  }, [active, clearAutoHide, clearContentMotion, hide]);

  // Switching mode while on: Manual tucks the bars away, Auto shows them.
  const lastModeRef = useRef(mode);
  useEffect(() => {
    if (lastModeRef.current === mode) return;
    lastModeRef.current = mode;
    if (!activeRef.current) return;
    if (mode === 'auto') show('auto');
    else if (mode === 'manual') hide();
  }, [mode, show, hide]);

  // New section or Q-App: Auto greets it with the bars; Manual keeps them
  // where they are (restarting the timer if they are out).
  const onSurfaceChanged = useCallback(() => {
    trackerRef.current.reset();
    if (!activeRef.current) return;
    if (modeRef.current === 'auto') show('auto');
    else if (barsShownRef.current) scheduleAutoHide();
  }, [show, scheduleAutoHide]);

  const lastSurfaceRef = useRef(surfaceKey);
  useEffect(() => {
    if (lastSurfaceRef.current === surfaceKey) return;
    lastSurfaceRef.current = surfaceKey;
    onSurfaceChanged();
  }, [surfaceKey, onSurfaceChanged]);

  // Switching between open Q-Apps counts as a new screen too. Read from the
  // tab broadcast here so the shell does not re-render on every tab update.
  const lastAppTabRef = useRef<string | null>(null);
  useEffect(() => {
    const onTabs = (event: Event) => {
      const selected = (event as CustomEvent).detail?.data?.selectedTab;
      const id = selected?.tabId ? String(selected.tabId) : null;
      if (id === lastAppTabRef.current) return;
      const hadOne = lastAppTabRef.current !== null;
      lastAppTabRef.current = id;
      if (hadOne && id) onSurfaceChanged();
    };
    subscribeToEvent('setTabsToNav', onTabs);
    return () => unsubscribeFromEvent('setTabsToNav', onTabs);
  }, [onSurfaceChanged]);

  // Something opened from the bars closed again: restart the timer.
  useEffect(() => {
    if (!holdOpen && activeRef.current && barsShownRef.current) {
      scheduleAutoHide();
    }
  }, [holdOpen, scheduleAutoHide]);

  useEffect(
    () => () => {
      clearAutoHide();
      animationRef.current?.cancel();
    },
    [clearAutoHide]
  );

  // An app's full screen: tuck everything away now; when it ends, bring the
  // bars back (Manual keeps them away, as before it started).
  const wasForcedRef = useRef(false);
  const releaseTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const wasForced = wasForcedRef.current;
    wasForcedRef.current = forced;
    if (forced && !wasForced) {
      hide();
      return;
    }
    if (!forced && wasForced && eligible) {
      if (modeRef.current !== 'manual') show('auto');
      if (modeRef.current === 'off') {
        setReleasing(true);
        if (releaseTimerRef.current !== null) {
          window.clearTimeout(releaseTimerRef.current);
        }
        releaseTimerRef.current = window.setTimeout(() => {
          releaseTimerRef.current = null;
          setReleasing(false);
        }, showMs + 120);
      }
    }
  }, [eligible, forced, hide, show, showMs]);
  useEffect(
    () => () => {
      if (releaseTimerRef.current !== null) {
        window.clearTimeout(releaseTimerRef.current);
      }
    },
    []
  );

  // ---- status bar ----------------------------------------------------------
  useEffect(() => {
    setImmersiveStatusBarHidden(active || hideStatusBar);
  }, [active, hideStatusBar]);
  useEffect(() => () => setImmersiveStatusBarHidden(false), []);

  // ---- signals: scrolling, finger drags, taps ------------------------------
  // These (and the auto-hide timer) render their change at once (flushSync)
  // rather than queuing it behind whatever else waits for this thread, a
  // busy Q-App's own work say: the bars and the content then start moving
  // on the very next frame.
  const applySignal = useCallback(
    (signal: ImmersiveScrollSignal | null) => {
      if (!signal || !activeRef.current) return;
      if (performance.now() < quietUntilRef.current) return;
      if (signal === 'hide') {
        if (holdOpenRef.current || barsHaveFocus()) return;
        flushSync(hide);
      } else if (modeRef.current === 'auto') {
        flushSync(() => show('auto'));
      }
    },
    [barsHaveFocus, hide, show]
  );

  /** A tap on the content puts button-revealed bars away again. */
  const onContentTap = useCallback(() => {
    if (!activeRef.current || !barsShownRef.current) return;
    if (modeRef.current !== 'manual' && revealKindRef.current !== 'button') {
      return;
    }
    if (isHeld()) return;
    flushSync(hide);
  }, [hide, isHeld]);

  useEffect(() => {
    if (!active) return undefined;
    const lastTop = new WeakMap<Element, number>();
    let lastTarget: Element | null = null;
    let touching = false;
    let lastUserScrollAt = 0;
    let gestureInFrame = false;

    const inBars = (node: EventTarget | null) =>
      contains(topBarElRef.current, node) ||
      contains(tabBarElRef.current, node) ||
      contains(pillElRef.current, node);

    const onPointerDown = (event: PointerEvent) => {
      touching = true;
      lastUserScrollAt = performance.now();
      const target = event.target;
      if (contains(pillElRef.current, target)) return;
      if (inBars(target)) {
        // Using the bars keeps them out a little longer.
        if (barsShownRef.current) scheduleAutoHide();
        return;
      }
      if (
        target instanceof Element &&
        target.closest(`${IGNORE_SCROLL_SELECTOR},${OPEN_MODAL_SELECTOR}`)
      ) {
        return;
      }
      onContentTap();
    };
    const onPointerEnd = () => {
      touching = false;
      lastUserScrollAt = performance.now();
    };
    const onWheel = () => {
      lastUserScrollAt = performance.now();
    };

    const onScroll = (event: Event) => {
      const raw = event.target;
      const target =
        raw instanceof Element
          ? raw
          : (document.scrollingElement as Element | null);
      if (!target) return;
      const top = target.scrollTop;
      const previous = lastTop.get(target);
      lastTop.set(target, top);
      if (previous === undefined) return;
      const delta = top - previous;
      if (delta === 0) return; // sideways carousels
      // Only scrolling You do (or its fling), not lists loading or jumping.
      if (!touching && performance.now() - lastUserScrollAt > 1200) return;
      if (inBars(target)) return;
      if (target.closest(IGNORE_SCROLL_SELECTOR)) return;
      // Small inner lists (menus, pickers) don't move the bars.
      if (target.clientHeight < window.innerHeight * 0.35) return;
      if (target !== lastTarget) {
        lastTarget = target;
        trackerRef.current.reset();
      }
      if (performance.now() < quietUntilRef.current) return;
      if (top <= 2 && delta < 0 && modeRef.current === 'auto') {
        show('auto');
        return;
      }
      applySignal(trackerRef.current.push(delta));
    };

    // Q-App and website frames: the native side tells us which way the
    // finger goes, since their scrolling never reaches this page.
    const onNativeTouch = (event: ImmersiveTouchEvent) => {
      if (event.phase === 'down') {
        const hit = document.elementFromPoint(event.x, event.y);
        gestureInFrame = hit instanceof HTMLIFrameElement;
        if (gestureInFrame) {
          trackerRef.current.reset();
          onContentTap();
        }
        return;
      }
      if (event.phase === 'drag' && gestureInFrame) {
        applySignal(signalForFingerDirection(event.direction));
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerEnd, true);
    document.addEventListener('pointercancel', onPointerEnd, true);
    document.addEventListener('wheel', onWheel, {
      capture: true,
      passive: true,
    });
    document.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    });
    const stopNative = listenImmersiveTouches(onNativeTouch);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerEnd, true);
      document.removeEventListener('pointercancel', onPointerEnd, true);
      document.removeEventListener('wheel', onWheel, true);
      document.removeEventListener('scroll', onScroll, true);
      stopNative();
    };
  }, [active, applySignal, onContentTap, scheduleAutoHide, show]);

  return {
    active,
    forced,
    barsShown: active ? barsShown : true,
    layoutShown: active ? layoutShown : true,
    topBarHeight,
    showMs,
    hideMs,
    topBarRef,
    tabBarRef,
    pillRef,
    contentRef,
    reveal,
  };
}
