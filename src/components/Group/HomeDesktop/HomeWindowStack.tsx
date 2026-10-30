import { Box, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import { claimHorizontalGesture } from '../../../hooks/horizontalGestureClaim';
import { GO_TAB_BAR_SPACE_VAR } from '../../Mobile/mobileBarHeights';
import { dashboardPanelSx } from '../dashboardPanelEffects';
import {
  type HomeWindowId,
  orderShownWindows,
  useHomeWindowOrder,
} from './homeLayout';
import {
  arrangeWithHeld,
  clampNumber,
  compactStackLayout,
  heldTargetIndex,
} from './homeWindowStackLayout';

/**
 * Home's windows on a phone, one under the other, in the user's order.
 *
 * Long press the background of a window (not a button, link or field) and
 * every window folds into a short labelled strip, the held one under the
 * finger; drag it up or down, the others make room, let go and the strips
 * unfold back into the windows in their new order. Strips instead of the
 * windows themselves because Home's windows are as tall as half the screen:
 * dragging one past another would be a long trip.
 *
 * Smooth on a phone because nothing heavy happens while it moves: the strips
 * are plain elements that only move and fade (transform, opacity), and the
 * windows take their new places through CSS `order`, so no window is
 * re-rendered or moved in the page.
 *
 * Listeners are passive, as everywhere on Home: a press that moves before
 * the long press is a scroll and is left alone. Once lifted, the page is held
 * still (overflow hidden) and the gesture is claimed, so neither the swipe
 * between sections nor the pull for Tabs take it.
 */
export type HomeWindow = {
  id: HomeWindowId;
  label: string;
  icon: ReactNode;
  node: ReactNode;
};

export const HOME_WINDOW_ATTR = 'data-home-window';
/** Presses inside an element with this attribute never lift a window. */
export const HOME_REORDER_IGNORE_ATTR = 'data-home-reorder-ignore';

export const HOME_WINDOW_LONG_PRESS_MS = 420;
const MOVE_CANCEL_PX = 8;
/** Finger travel after the lift before the strip looks for a new slot: a
 * long press let go where it lifted changes nothing. */
const ARM_PX = 12;
const FOLD_MS = 280;
const SHIFT_MS = 200;
const SETTLE_MS = 150;
const UNFOLD_MS = 300;
/** Decelerating: things arrive gently (as the rest of GO's motion). */
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const STACK_EDGE_INSET_PX = 14;
const HELD_SCALE = 1.04;
/** Mouse events Android sends after a touch are not a second press. */
const TOUCH_MOUSE_GUARD_MS = 900;

const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'textarea',
  'select',
  'label',
  'video',
  'audio',
  'iframe',
  '[role="button"]',
  '[role="link"]',
  '[role="slider"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  `[${HOME_REORDER_IGNORE_ATTR}]`,
].join(', ');

/**
 * Whether a press on `target` is on the window's background: not on
 * anything it uses itself (buttons, links, fields, and plain elements made
 * clickable, which show a pointer).
 */
export const isWindowBackground = (target: Element, windowEl: Element) => {
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  if (interactive && windowEl.contains(interactive)) return false;
  let element: Element | null = target;
  while (element && element !== windowEl) {
    if (window.getComputedStyle(element).cursor === 'pointer') return false;
    element = element.parentElement;
  }
  return true;
};

type Session = {
  /** The shown windows, in their order when the press lifted. */
  ids: HomeWindowId[];
  heldId: HomeWindowId;
  heldIndex: number;
  /** Where each window's top was on screen at the lift. */
  from: Record<string, number>;
  left: number;
  width: number;
  /** The screen part the page shows (its scroller), and the stack's room. */
  viewTop: number;
  viewHeight: number;
  minTop: number;
  maxBottom: number;
  liftY: number;
  tileHeight: number;
  pitch: number;
  stackTop: number;
};

type Press = {
  id: HomeWindowId;
  startX: number;
  startY: number;
  stamp: number;
  y: number;
  timer: number | null;
  lifted: boolean;
};

type Props = {
  /** Every window that is shown, in any order: the saved order applies. */
  windows: HomeWindow[];
  /** The shown windows in their new order, after a drag. */
  onReorder: (order: HomeWindowId[]) => void;
  /** Home's scroller: held still while a window is lifted. */
  scroller: HTMLElement | null;
  gap: number;
};

const translateY = (y: number) => `0 ${Math.round(y)}px`;

/** Each window as wide as the column. */
const STACK_SX = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  width: '100%',
  [`& > [${HOME_WINDOW_ATTR}]`]: {
    display: 'block',
    minWidth: 0,
    position: 'relative',
    width: '100%',
  },
  [`& > [${HOME_WINDOW_ATTR}] > *`]: { width: '100%' },
} as const;

export const HomeWindowStack = ({
  windows,
  onReorder,
  scroller,
  gap,
}: Props) => {
  const theme = useTheme();
  const savedOrder = useHomeWindowOrder();
  const ids = useMemo(
    () =>
      orderShownWindows(
        windows.map((item) => item.id),
        savedOrder
      ),
    [windows, savedOrder]
  );
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const tileRefs = useRef(new Map<HomeWindowId, HTMLDivElement>());
  const backdropRef = useRef<HTMLDivElement | null>(null);

  // Latest values for the listeners, which are bound once per container.
  const containerRef = useRef<HTMLDivElement | null>(null);
  containerRef.current = container;
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const scrollerRef = useRef(scroller);
  scrollerRef.current = scroller;

  // The running drag, outside React: written every frame.
  const live = useRef<{
    session: Session | null;
    unfolding: boolean;
    fingerY: number;
    armed: boolean;
    target: number;
    frame: number | null;
    scrollerOverflow: string | null;
    timers: number[];
  }>({
    session: null,
    unfolding: false,
    fingerY: 0,
    armed: false,
    target: 0,
    frame: null,
    scrollerOverflow: null,
    timers: [],
  });

  const later = (fn: () => void, ms: number) => {
    live.current.timers.push(window.setTimeout(fn, ms));
  };

  const lockScroller = () => {
    const element = scrollerRef.current;
    if (!element || live.current.scrollerOverflow !== null) return;
    live.current.scrollerOverflow = element.style.overflowY;
    element.style.overflowY = 'hidden';
  };

  const unlockScroller = () => {
    const element = scrollerRef.current;
    if (element && live.current.scrollerOverflow !== null) {
      element.style.overflowY = live.current.scrollerOverflow;
    }
    live.current.scrollerOverflow = null;
  };

  /**
   * Moves a strip. Only translate, scale and opacity ever change (all on
   * the compositor), each with its own timing: the held strip follows the
   * finger at once while its size still eases.
   */
  const place = (
    id: HomeWindowId,
    y: number,
    {
      ms,
      scale = 1,
      scaleMs = ms,
      opacity = 1,
      fadeMs = ms,
      fadeDelayMs = 0,
    }: {
      ms: number;
      scale?: number;
      scaleMs?: number;
      opacity?: number;
      fadeMs?: number;
      fadeDelayMs?: number;
    }
  ) => {
    const tile = tileRefs.current.get(id);
    if (!tile) return;
    tile.style.transition = [
      `translate ${ms}ms ${EASE}`,
      `scale ${scaleMs}ms ${EASE}`,
      `opacity ${fadeMs}ms linear ${fadeDelayMs}ms`,
    ].join(', ');
    tile.style.translate = translateY(y);
    tile.style.scale = String(scale);
    tile.style.opacity = String(opacity);
  };

  /** The held strip rides under the finger, within the stack's room. */
  const heldTop = (current: Session, fingerY: number) =>
    clampNumber(
      fingerY - current.tileHeight / 2,
      current.minTop - current.tileHeight * 0.35,
      current.maxBottom - current.tileHeight * 0.65
    );

  /** Every other strip to its slot for the held one at `target`. */
  const layoutOthers = (current: Session, target: number, ms: number) => {
    arrangeWithHeld(current.ids, current.heldId, target).forEach((id, slot) => {
      if (id === current.heldId) return;
      place(id, current.stackTop + slot * current.pitch, {
        ms,
        fadeMs: Math.round(ms * 0.7),
      });
    });
  };

  /**
   * Where the held window lands for the finger now. The gap in the stack is
   * where it lands: where it came from until the finger moves, then
   * wherever the finger takes it.
   */
  const targetForFinger = (current: Session) => {
    const state = live.current;
    if (!state.armed && Math.abs(state.fingerY - current.liftY) >= ARM_PX) {
      state.armed = true;
    }
    return state.armed
      ? heldTargetIndex(
          heldTop(current, state.fingerY),
          current.stackTop,
          current.pitch,
          current.ids.length
        )
      : current.heldIndex;
  };

  const writeFrame = () => {
    const state = live.current;
    state.frame = null;
    const current = state.session;
    if (!current || state.unfolding) return;
    // Follows the finger at once; its size and fade finish easing.
    place(current.heldId, heldTop(current, state.fingerY), {
      ms: 0,
      scale: HELD_SCALE,
      scaleMs: 180,
      fadeMs: 150,
    });
    const target = targetForFinger(current);
    if (target !== state.target) {
      state.target = target;
      layoutOthers(current, target, SHIFT_MS);
      navigator.vibrate?.(4);
    }
  };

  const requestFrame = () => {
    if (live.current.frame === null) {
      live.current.frame = requestAnimationFrame(writeFrame);
    }
  };

  // The strips come out of the windows and gather into the stack.
  useLayoutEffect(() => {
    if (!session) return;
    const backdrop = backdropRef.current;
    // Start values (from render) painted first, then sent on their way.
    void backdrop?.getBoundingClientRect();
    if (backdrop) {
      backdrop.style.transition = `opacity ${Math.round(FOLD_MS * 0.75)}ms linear`;
      backdrop.style.opacity = '1';
    }
    layoutOthers(session, session.heldIndex, FOLD_MS);
    place(session.heldId, heldTop(session, live.current.fingerY), {
      ms: 0,
      scale: HELD_SCALE,
      scaleMs: FOLD_MS,
      fadeMs: Math.round(FOLD_MS * 0.5),
    });
    // Runs once per lift: the session object is new each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const finishSession = useCallback(() => {
    const state = live.current;
    state.timers.forEach((timer) => window.clearTimeout(timer));
    state.timers = [];
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = null;
    state.session = null;
    state.unfolding = false;
    unlockScroller();
    setSession(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Let go: the order is saved and the strips unfold into the windows. */
  const drop = useCallback(
    (cancelled: boolean) => {
      const state = live.current;
      const current = state.session;
      if (!current || state.unfolding) return;
      if (state.frame !== null) cancelAnimationFrame(state.frame);
      state.frame = null;
      state.unfolding = true;

      // From the finger itself: it may lift before the last frame ran.
      const target = cancelled ? current.heldIndex : targetForFinger(current);
      const order = arrangeWithHeld(current.ids, current.heldId, target);
      const changed = order.some((id, index) => id !== current.ids[index]);
      const heldSlotTop = current.stackTop + target * current.pitch;

      // The held strip settles into its slot.
      place(current.heldId, heldSlotTop, { ms: SETTLE_MS });
      layoutOthers(current, target, SETTLE_MS);

      later(() => {
        const page = scrollerRef.current;
        const host = containerRef.current;
        if (changed) {
          // Only the windows' CSS order changes: nothing re-renders.
          flushSync(() => onReorderRef.current(order));
          const moved = host?.querySelector<HTMLElement>(
            `[${HOME_WINDOW_ATTR}="${current.heldId}"]`
          );
          if (page && moved) {
            // Hidden under the backdrop: the moved window opens where its
            // strip is.
            const pageTop = page.getBoundingClientRect().top;
            const contentTop =
              moved.getBoundingClientRect().top - pageTop + page.scrollTop;
            page.scrollTop = clampNumber(
              contentTop - (heldSlotTop - pageTop),
              0,
              Math.max(0, page.scrollHeight - page.clientHeight)
            );
          }
        }
        unlockScroller();

        // Each strip goes back to its window's top and fades into it.
        const viewBottom = current.viewTop + current.viewHeight;
        current.ids.forEach((id) => {
          const element = host?.querySelector<HTMLElement>(
            `[${HOME_WINDOW_ATTR}="${id}"]`
          );
          const top = element
            ? clampNumber(
                element.getBoundingClientRect().top,
                current.viewTop - current.tileHeight - 24,
                viewBottom + 24
              )
            : heldSlotTop;
          // Gone before it reaches the window, so its label never doubles
          // the window's own title.
          place(id, top, {
            ms: UNFOLD_MS,
            opacity: 0,
            fadeMs: Math.round(UNFOLD_MS * 0.55),
          });
        });
        const backdrop = backdropRef.current;
        if (backdrop) {
          backdrop.style.transition = `opacity ${UNFOLD_MS}ms linear`;
          backdrop.style.opacity = '0';
        }
        later(finishSession, UNFOLD_MS + 40);
      }, SETTLE_MS);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finishSession]
  );

  /** The press lifted: measure the windows and open the stack. */
  const lift = useCallback(
    (press: Press) => {
      const host = containerRef.current;
      const page = scrollerRef.current;
      if (!host) return;
      const order = idsRef.current;
      const heldIndex = order.indexOf(press.id);
      if (heldIndex === -1 || order.length < 2) return;

      const from: Record<string, number> = {};
      host
        .querySelectorAll<HTMLElement>(`[${HOME_WINDOW_ATTR}]`)
        .forEach((element) => {
          const id = element.getAttribute(HOME_WINDOW_ATTR);
          if (id) from[id] = element.getBoundingClientRect().top;
        });
      const hostRect = host.getBoundingClientRect();
      const view = (page ?? document.documentElement).getBoundingClientRect();
      const viewTop = page ? view.top : 0;
      const viewHeight = page ? view.height : window.innerHeight;
      const tabBarSpace =
        parseFloat(
          window
            .getComputedStyle(document.documentElement)
            .getPropertyValue(GO_TAB_BAR_SPACE_VAR)
        ) || 0;
      const minTop = viewTop + STACK_EDGE_INSET_PX;
      const maxBottom =
        viewTop + viewHeight - STACK_EDGE_INSET_PX - tabBarSpace;

      claimHorizontalGesture(press.stamp);
      lockScroller();
      window.getSelection?.()?.removeAllRanges();
      navigator.vibrate?.(12);

      const next: Session = {
        ids: [...order],
        heldId: press.id,
        heldIndex,
        from,
        left: hostRect.left,
        width: hostRect.width,
        viewTop,
        viewHeight,
        minTop,
        maxBottom,
        liftY: press.y,
        ...compactStackLayout({
          count: order.length,
          heldIndex,
          fingerY: press.y,
          minTop,
          maxBottom,
        }),
      };
      const state = live.current;
      state.session = next;
      state.unfolding = false;
      state.fingerY = press.y;
      state.armed = false;
      state.target = heldIndex;
      setSession(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (!container) return;
    let press: Press | null = null;
    let lastTouchAt = 0;
    let swallowClickUntil = 0;

    const windowFrom = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const element = target.closest<HTMLElement>(`[${HOME_WINDOW_ATTR}]`);
      if (!element || !container.contains(element)) return null;
      if (!isWindowBackground(target, element)) return null;
      return element.getAttribute(HOME_WINDOW_ATTR) as HomeWindowId | null;
    };

    // Android's own long press selects text: not on a window being held.
    const holdSelection = (hold: boolean) => {
      for (const property of ['user-select', '-webkit-user-select']) {
        if (hold) container.style.setProperty(property, 'none');
        else container.style.removeProperty(property);
      }
    };

    const cancelPress = () => {
      if (press?.timer != null) window.clearTimeout(press.timer);
      if (press) holdSelection(false);
      press = null;
    };

    const begin = (
      x: number,
      y: number,
      target: EventTarget | null,
      stamp: number
    ) => {
      cancelPress();
      if (live.current.session) return;
      const id = windowFrom(target);
      if (!id) return;
      const current: Press = {
        id,
        startX: x,
        startY: y,
        stamp,
        y,
        timer: null,
        lifted: false,
      };
      current.timer = window.setTimeout(() => {
        current.timer = null;
        if (press !== current) return;
        current.lifted = true;
        lift(current);
      }, HOME_WINDOW_LONG_PRESS_MS);
      press = current;
      holdSelection(true);
    };

    const move = (x: number, y: number) => {
      const current = press;
      if (!current) return;
      current.y = y;
      if (!current.lifted) {
        if (
          Math.hypot(x - current.startX, y - current.startY) > MOVE_CANCEL_PX
        ) {
          // A scroll or a swipe, not a press.
          cancelPress();
        }
        return;
      }
      live.current.fingerY = y;
      if (!live.current.unfolding) requestFrame();
    };

    const end = (cancelled: boolean) => {
      const current = press;
      press = null;
      if (!current) return;
      holdSelection(false);
      if (current.timer !== null) window.clearTimeout(current.timer);
      if (!current.lifted) return;
      // The click that ends a long press is not a tap on the window.
      swallowClickUntil = performance.now() + 600;
      drop(cancelled);
    };

    const onTouchStart = (event: TouchEvent) => {
      lastTouchAt = performance.now();
      if (event.touches.length !== 1) {
        // A second finger: a lifted window goes back where it was.
        if (press) end(true);
        return;
      }
      const touch = event.touches[0];
      begin(touch.clientX, touch.clientY, event.target, event.timeStamp);
    };
    const onTouchMove = (event: TouchEvent) => {
      lastTouchAt = performance.now();
      const touch = event.touches[0];
      if (touch) move(touch.clientX, touch.clientY);
    };
    const onTouchEnd = (event: TouchEvent) => {
      lastTouchAt = performance.now();
      if (event.touches.length > 0) return;
      end(event.type === 'touchcancel');
    };

    const fromTouch = () =>
      performance.now() - lastTouchAt < TOUCH_MOUSE_GUARD_MS;
    const onMouseMove = (event: MouseEvent) =>
      move(event.clientX, event.clientY);
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      end(false);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || fromTouch()) return;
      begin(event.clientX, event.clientY, event.target, event.timeStamp);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };

    const onClick = (event: MouseEvent) => {
      if (performance.now() < swallowClickUntil) {
        swallowClickUntil = 0;
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Android's long-press menu and text selection would fight the lift.
    const onContextMenu = (event: Event) => {
      if (press || live.current.session) event.preventDefault();
    };

    const passive = { passive: true };
    container.addEventListener('touchstart', onTouchStart, passive);
    // On the document: the finger may leave the window it pressed.
    document.addEventListener('touchmove', onTouchMove, passive);
    document.addEventListener('touchend', onTouchEnd, passive);
    document.addEventListener('touchcancel', onTouchEnd, passive);
    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('click', onClick, true);
    container.addEventListener('contextmenu', onContextMenu);
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('click', onClick, true);
      container.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      cancelPress();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, drop, lift]);

  useEffect(
    () => () => {
      const state = live.current;
      state.timers.forEach((timer) => window.clearTimeout(timer));
      if (state.frame !== null) cancelAnimationFrame(state.frame);
      unlockScroller();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const labels = new Map(windows.map((item) => [item.id, item]));

  // Plain styles for the strips: nothing to work out when they appear.
  const panel = dashboardPanelSx(theme, 'base');
  const dark = theme.palette.mode === 'dark';
  const stripStyle: CSSProperties = {
    alignItems: 'center',
    backgroundColor: panel.backgroundColor,
    backgroundImage: panel.backgroundImage,
    border: panel.border,
    borderRadius: 16,
    boxShadow: `0 6px 18px ${alpha(theme.palette.common.black, dark ? 0.35 : 0.12)}`,
    boxSizing: 'border-box',
    display: 'flex',
    gap: 12,
    left: 0,
    overflow: 'hidden',
    padding: '0 14px',
    position: 'absolute',
    top: 0,
    willChange: 'translate, scale, opacity',
  };
  const iconStyle: CSSProperties = {
    alignItems: 'center',
    backgroundColor: alpha(theme.palette.primary.main, 0.14),
    borderRadius: 10,
    color: theme.palette.primary.light,
    display: 'flex',
    flexShrink: 0,
    height: 32,
    justifyContent: 'center',
    width: 32,
  };
  const labelStyle: CSSProperties = {
    color: theme.palette.text.primary,
    flex: 1,
    fontSize: '0.9rem',
    fontWeight: 700,
    letterSpacing: '-0.01em',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  return (
    <>
      <Box ref={setContainer} sx={STACK_SX} style={{ gap }}>
        {windows.map((item) => (
          <div
            key={item.id}
            {...{ [HOME_WINDOW_ATTR]: item.id }}
            style={{ order: ids.indexOf(item.id) }}
          >
            {item.node}
          </div>
        ))}
      </Box>
      {session
        ? createPortal(
            <div
              aria-hidden
              data-home-reorder-overlay=""
              style={{
                inset: 0,
                pointerEvents: 'none',
                position: 'fixed',
                zIndex: theme.zIndex.drawer + 1,
              }}
            >
              <div
                ref={backdropRef}
                style={{
                  backgroundColor: alpha(
                    theme.palette.background.default,
                    0.96
                  ),
                  height: session.viewHeight,
                  left: 0,
                  opacity: 0,
                  position: 'absolute',
                  right: 0,
                  top: session.viewTop,
                }}
              />
              {session.ids.map((id) => {
                const held = id === session.heldId;
                const item = labels.get(id);
                // Each strip starts at its window's top (the held one under
                // the finger), a little small and see-through.
                const startTop = held
                  ? heldTop(session, session.liftY)
                  : clampNumber(
                      session.from[id] ?? session.viewTop + session.viewHeight,
                      session.viewTop - session.tileHeight - 24,
                      session.viewTop + session.viewHeight + 24
                    );
                return (
                  <div
                    key={id}
                    ref={(element) => {
                      if (element) tileRefs.current.set(id, element);
                      else tileRefs.current.delete(id);
                    }}
                    style={{
                      ...stripStyle,
                      borderColor: held
                        ? alpha(theme.palette.primary.main, 0.55)
                        : undefined,
                      boxShadow: held
                        ? `0 18px 36px ${alpha(theme.palette.common.black, dark ? 0.5 : 0.22)}`
                        : stripStyle.boxShadow,
                      height: session.tileHeight,
                      left: session.left,
                      opacity: 0,
                      scale: held ? 0.92 : 0.96,
                      translate: translateY(startTop),
                      width: session.width,
                      zIndex: held ? 2 : 1,
                    }}
                  >
                    <div
                      style={{
                        ...iconStyle,
                        backgroundColor: alpha(
                          theme.palette.primary.main,
                          held ? 0.24 : 0.14
                        ),
                      }}
                    >
                      {item?.icon}
                    </div>
                    <div style={labelStyle}>{item?.label}</div>
                    <DragIndicatorRoundedIcon
                      sx={{
                        color: alpha(
                          theme.palette.text.secondary,
                          held ? 0.9 : 0.55
                        ),
                        fontSize: 22,
                      }}
                    />
                  </div>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
};
