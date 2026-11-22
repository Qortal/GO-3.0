import { useEffect, useRef } from 'react';
import { claimHorizontalGesture } from '../../../hooks/horizontalGestureClaim';
import { hitTestSlot } from './homeGrid';
import { FLIP_EASE, prefersReducedMotion } from './flip';

/**
 * Launcher-style press on the items of a grid: a long press lifts the item.
 * Let go without moving and `onMenu` runs (folder or app options); move and
 * the item follows the finger while the others make room (`onMove`, which
 * reorders the list; FLIP animates it), and letting go drops it (`onDrop`).
 *
 * Scrolling stays native and passive: nothing here can cancel a touch. A
 * press that moves before the lift is a scroll and is left alone; after the
 * lift the scroller gets `overflow: hidden`, so the finger drags the item
 * instead of the list.
 */
type LongPressReorderOptions = {
  /** The grid; an element (from a callback ref), so a remount re-binds. */
  container: HTMLElement | null;
  /** The element that scrolls the grid; it is locked while an item is held. */
  scroller?: HTMLElement | null;
  /** Attribute that marks an item and holds its id. */
  itemAttr: string;
  enabled?: boolean;
  /** False: a long press only opens the menu; moving after it cancels. */
  allowDrag?: boolean;
  onMenu: (id: string, element: HTMLElement) => void;
  onMove: (id: string, overId: string) => void;
  /**
   * The item was let go. Return a box to land it there instead of in its
   * slot (it shrinks into the box and fades: dropped into another folder).
   */
  onDrop: (id: string) => LandingBox | void;
  onEnd?: () => void;
  /**
   * Every frame of a drag, with the finger. Return true while the drag is
   * somewhere else (it left the grid): no reordering or edge scrolling here.
   */
  onDragFrame?: (id: string, x: number, y: number) => boolean | void;
  /**
   * The item the dragged one would go into rather than next to (a folder,
   * or another app to make a folder with), from the item under the finger.
   * While there is one, the others do not make room.
   */
  mergeTargetAt?: (
    id: string,
    overId: string | null,
    x: number,
    y: number
  ) => string | null;
  /** The item the dragged one would go into changed (null: none). */
  onMergeOver?: (id: string, targetId: string | null) => void;
  /**
   * How long the finger rests over an item before the others make room, so
   * a drag on its way into an item does not push it away first.
   */
  settleMs?: number;
};

export type LandingBox = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

const LONG_PRESS_MS = 380;
const MOVE_CANCEL_PX = 7;
const DRAG_START_PX = 8;
const REORDER_HYSTERESIS_PX = 14;
const EDGE_SCROLL_PX = 64;
const EDGE_SCROLL_MAX = 14;
/**
 * How far to scroll this frame for a finger at `y` in a scroller spanning
 * `bounds`: up to EDGE_SCROLL_MAX px near either edge, 0 elsewhere.
 */
export function edgeScrollStep(
  bounds: Pick<DOMRect, 'top' | 'bottom'>,
  y: number
): number {
  let step = 0;
  if (y < bounds.top + EDGE_SCROLL_PX) {
    step = -((bounds.top + EDGE_SCROLL_PX - y) / EDGE_SCROLL_PX);
  } else if (y > bounds.bottom - EDGE_SCROLL_PX) {
    step = (y - (bounds.bottom - EDGE_SCROLL_PX)) / EDGE_SCROLL_PX;
  }
  return Math.max(-1, Math.min(1, step)) * EDGE_SCROLL_MAX;
}

/** Mouse events that Android sends after a touch are not a second press. */
const TOUCH_MOUSE_GUARD_MS = 900;

type Press = {
  id: string;
  element: HTMLElement;
  startX: number;
  startY: number;
  startStamp: number;
  x: number;
  y: number;
  timer: number | null;
  lifted: boolean;
  dragging: boolean;
  ghost: HTMLElement | null;
  ghostLeft: number;
  ghostTop: number;
  lastMoveX: number;
  lastMoveY: number;
  lastOver: string | null;
  /** The item the finger rests over, and since when. */
  settleId: string | null;
  settleSince: number;
  /** The item the dragged one would go into. */
  mergeId: string | null;
  frame: number | null;
  scrollerOverflow: string | null;
};

/**
 * An item's box from its offsets, which ignore transforms: items gliding into
 * place (FLIP) are hit where they will be, so the order does not flicker
 * while they move. The container must be the items' offset parent chain end
 * (position: relative).
 */
const layoutBox = (element: HTMLElement, container: HTMLElement) => {
  const origin = container.getBoundingClientRect();
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = element;
  while (node && node !== container) {
    left += node.offsetLeft;
    top += node.offsetTop;
    const parent = node.offsetParent as HTMLElement | null;
    if (!parent || (!container.contains(parent) && parent !== container)) break;
    node = parent;
  }
  return {
    left: origin.left + left,
    top: origin.top + top,
    right: origin.left + left + element.offsetWidth,
    bottom: origin.top + top + element.offsetHeight,
  };
};

export function useLongPressReorder(options: LongPressReorderOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const enabled = options.enabled ?? true;

  useEffect(() => {
    const container = options.container;
    if (!container || !enabled) return;

    let press: Press | null = null;
    let lastTouchAt = 0;
    let swallowClickUntil = 0;

    const itemFrom = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const attr = optionsRef.current.itemAttr;
      const element = target.closest<HTMLElement>(`[${attr}]`);
      if (!element || !container.contains(element)) return null;
      const id = element.getAttribute(attr);
      return id ? { id, element } : null;
    };

    const unlockScroller = (current: Press) => {
      const scroller = optionsRef.current.scroller;
      if (scroller && current.scrollerOverflow !== null) {
        scroller.style.overflowY = current.scrollerOverflow;
      }
      current.scrollerOverflow = null;
    };

    const finish = (current: Press, drop: boolean) => {
      if (current.timer !== null) window.clearTimeout(current.timer);
      if (current.frame !== null) cancelAnimationFrame(current.frame);
      unlockScroller(current);
      if (current.dragging) {
        const landing = drop ? optionsRef.current.onDrop(current.id) : null;
        const { ghost, element } = current;
        const settle = () => {
          ghost?.remove();
          element.style.opacity = '';
          element.removeAttribute('data-reorder-dragging');
        };
        if (ghost && landing && !prefersReducedMotion()) {
          // Into a box somewhere else: shrink into its middle and fade.
          const box = ghost.getBoundingClientRect();
          const dx =
            landing.left + landing.width / 2 - (box.left + box.width / 2);
          const dy =
            landing.top + landing.height / 2 - (box.top + box.height / 2);
          const scale = Math.max(
            0.2,
            Math.min(1, (landing.width * 0.45) / Math.max(1, box.width))
          );
          const fromX = current.x - current.startX;
          const fromY = current.y - current.startY;
          const animation = ghost.animate(
            [
              {
                opacity: 1,
                transform: `translate3d(${fromX}px, ${fromY}px, 0) scale(1.08)`,
              },
              {
                opacity: 0,
                transform: `translate3d(${fromX + dx}px, ${fromY + dy}px, 0) scale(${scale})`,
              },
            ],
            { duration: 260, easing: FLIP_EASE, fill: 'forwards' }
          );
          animation.onfinish = settle;
          animation.oncancel = settle;
        } else if (ghost && !landing && !prefersReducedMotion()) {
          // The dropped item lands in its slot: measured after the drop
          // re-rendered, so it is the final place.
          requestAnimationFrame(() => {
            const box = layoutBox(element, container);
            const dx = box.left - current.ghostLeft;
            const dy = box.top - current.ghostTop;
            const animation = ghost.animate(
              [
                { transform: ghost.style.transform || 'none' },
                { transform: `translate3d(${dx}px, ${dy}px, 0) scale(1)` },
              ],
              { duration: 220, easing: FLIP_EASE, fill: 'forwards' }
            );
            animation.onfinish = settle;
            animation.oncancel = settle;
          });
        } else {
          settle();
        }
      }
      current.element.removeAttribute('data-reorder-lifted');
      if (current.lifted) {
        // The click that ends a long press is not a tap on the item.
        swallowClickUntil = performance.now() + 600;
      }
      optionsRef.current.onEnd?.();
    };

    const startDrag = (current: Press) => {
      current.dragging = true;
      current.element.removeAttribute('data-reorder-lifted');
      const box = current.element.getBoundingClientRect();
      const ghost = current.element.cloneNode(true) as HTMLElement;
      ghost.removeAttribute(optionsRef.current.itemAttr);
      ghost
        .querySelectorAll(`[${optionsRef.current.itemAttr}]`)
        .forEach((node) => node.removeAttribute(optionsRef.current.itemAttr));
      ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, {
        position: 'fixed',
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        margin: '0',
        zIndex: '2600',
        pointerEvents: 'none',
        transform: 'translate3d(0, 0, 0) scale(1.08)',
        filter: 'drop-shadow(0 14px 26px rgba(0, 0, 0, 0.38))',
        willChange: 'transform',
        transition: 'none',
      } satisfies Partial<CSSStyleDeclaration>);
      document.body.appendChild(ghost);
      current.ghost = ghost;
      current.ghostLeft = box.left;
      current.ghostTop = box.top;
      current.element.style.opacity = '0';
      current.element.setAttribute('data-reorder-dragging', 'true');
      current.lastMoveX = current.x;
      current.lastMoveY = current.y;
      tick(current);
    };

    const hitTest = (current: Press) => {
      const attr = optionsRef.current.itemAttr;
      const items = Array.from(
        container.querySelectorAll<HTMLElement>(`[${attr}]`)
      ).map((element) => ({
        id: element.getAttribute(attr) || '',
        rect: layoutBox(element, container),
      }));
      const overId = hitTestSlot(items, current.x, current.y, current.id);
      const options = optionsRef.current;
      const mergeId =
        options.mergeTargetAt?.(current.id, overId, current.x, current.y) ??
        null;
      if (mergeId !== current.mergeId) {
        current.mergeId = mergeId;
        options.onMergeOver?.(current.id, mergeId);
      }
      if (mergeId) {
        current.lastOver = null;
        current.settleId = null;
        return;
      }
      if (!overId) {
        current.lastOver = null;
        current.settleId = null;
        return;
      }
      if (overId === current.lastOver) return;
      const settleMs = options.settleMs ?? 0;
      if (settleMs > 0) {
        const now = performance.now();
        if (current.settleId !== overId) {
          current.settleId = overId;
          current.settleSince = now;
          return;
        }
        if (now - current.settleSince < settleMs) return;
      }
      const moved = Math.hypot(
        current.x - current.lastMoveX,
        current.y - current.lastMoveY
      );
      if (current.lastOver !== null && moved < REORDER_HYSTERESIS_PX) return;
      current.lastOver = overId;
      current.lastMoveX = current.x;
      current.lastMoveY = current.y;
      optionsRef.current.onMove(current.id, overId);
    };

    // One frame loop while dragging: follows the finger, scrolls near the
    // edges and asks for a new order.
    const tick = (current: Press) => {
      current.frame = requestAnimationFrame(() => {
        if (press !== current || !current.dragging) return;
        const dx = current.x - current.startX;
        const dy = current.y - current.startY;
        if (current.ghost) {
          current.ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.08)`;
        }
        const away = optionsRef.current.onDragFrame?.(
          current.id,
          current.x,
          current.y
        );
        const scroller = optionsRef.current.scroller;
        if (scroller && !away) {
          const step = edgeScrollStep(
            scroller.getBoundingClientRect(),
            current.y
          );
          if (step !== 0) scroller.scrollTop += step;
        }
        if (away) {
          current.lastOver = null;
          current.settleId = null;
          if (current.mergeId !== null) {
            current.mergeId = null;
            optionsRef.current.onMergeOver?.(current.id, null);
          }
        } else hitTest(current);
        tick(current);
      });
    };

    const begin = (
      x: number,
      y: number,
      target: EventTarget | null,
      stamp: number
    ) => {
      if (press) finish(press, false);
      const item = itemFrom(target);
      if (!item) return;
      const current: Press = {
        id: item.id,
        element: item.element,
        startX: x,
        startY: y,
        startStamp: stamp,
        x,
        y,
        timer: null,
        lifted: false,
        dragging: false,
        ghost: null,
        ghostLeft: 0,
        ghostTop: 0,
        lastMoveX: x,
        lastMoveY: y,
        lastOver: null,
        settleId: null,
        settleSince: 0,
        mergeId: null,
        frame: null,
        scrollerOverflow: null,
      };
      current.timer = window.setTimeout(() => {
        current.timer = null;
        if (press !== current) return;
        current.lifted = true;
        claimHorizontalGesture(current.startStamp);
        const scroller = optionsRef.current.scroller;
        if (scroller) {
          current.scrollerOverflow = scroller.style.overflowY;
          scroller.style.overflowY = 'hidden';
        }
        window.getSelection?.()?.removeAllRanges();
        navigator.vibrate?.(12);
        current.element.setAttribute('data-reorder-lifted', 'true');
      }, LONG_PRESS_MS);
      press = current;
    };

    const move = (x: number, y: number) => {
      const current = press;
      if (!current) return;
      current.x = x;
      current.y = y;
      const distance = Math.hypot(x - current.startX, y - current.startY);
      if (!current.lifted) {
        if (distance > MOVE_CANCEL_PX) {
          // A scroll or a swipe, not a press.
          if (current.timer !== null) window.clearTimeout(current.timer);
          press = null;
        }
        return;
      }
      if (!current.dragging && distance > DRAG_START_PX) {
        if (optionsRef.current.allowDrag === false) {
          press = null;
          finish(current, false);
          return;
        }
        startDrag(current);
      }
    };

    const end = (cancelled: boolean) => {
      const current = press;
      if (!current) return;
      press = null;
      if (current.lifted && !current.dragging && !cancelled) {
        finish(current, false);
        optionsRef.current.onMenu(current.id, current.element);
        return;
      }
      finish(current, !cancelled || current.dragging);
    };

    const onTouchStart = (event: TouchEvent) => {
      lastTouchAt = performance.now();
      if (event.touches.length !== 1) {
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
      end(event.type === 'touchcancel' && !press?.dragging);
    };

    const fromTouch = () =>
      performance.now() - lastTouchAt < TOUCH_MOUSE_GUARD_MS;
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || fromTouch()) return;
      begin(event.clientX, event.clientY, event.target, event.timeStamp);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };
    const onMouseMove = (event: MouseEvent) =>
      move(event.clientX, event.clientY);
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      end(false);
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
      if (itemFrom(event.target)) event.preventDefault();
    };

    const passive = { passive: true };
    container.addEventListener('touchstart', onTouchStart, passive);
    container.addEventListener('touchmove', onTouchMove, passive);
    container.addEventListener('touchend', onTouchEnd, passive);
    container.addEventListener('touchcancel', onTouchEnd, passive);
    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('click', onClick, true);
    container.addEventListener('contextmenu', onContextMenu);
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('click', onClick, true);
      container.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (press) {
        const current = press;
        press = null;
        finish(current, false);
      }
    };
  }, [enabled, options.container, options.scroller]);
}
