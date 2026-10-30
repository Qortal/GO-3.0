import { PointerSensor, type PointerSensorOptions } from '@dnd-kit/core';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * Admins reorder channels and categories by dragging them. With a mouse a
 * 6px move starts the drag, as before. On a touch screen the row has to be
 * held still first, so a tap always selects the channel and a swipe always
 * scrolls the list.
 */
export const RETICULUM_CHANNEL_POINTER_DRAG_DISTANCE_PX = 6;
/** Under Android's long-press delay (400-500ms), which opens the admin menu,
 *  and well over a normal tap. */
export const RETICULUM_CHANNEL_TOUCH_DRAG_DELAY_MS = 300;
/** How far a finger may wander while held before it counts as a scroll. */
export const RETICULUM_CHANNEL_TOUCH_DRAG_TOLERANCE_PX = 8;

/**
 * PointerSensor that leaves touches to the TouchSensor.
 *
 * Touch screens fire pointer events too, and dnd-kit gives a press to the
 * first sensor that claims it. The plain PointerSensor fires first, so its
 * 6px distance always beat the TouchSensor's press-and-hold: a slightly
 * wobbly tap on a channel started a drag and the tap was swallowed. Mouse
 * and pen keep the PointerSensor.
 */
export class ReticulumMousePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (
        { nativeEvent: event }: ReactPointerEvent,
        { onActivation }: PointerSensorOptions
      ) => {
        if (
          !event.isPrimary ||
          event.button !== 0 ||
          event.pointerType === 'touch'
        ) {
          return false;
        }
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

type DragEndLike = {
  activatorEvent: Event | null;
  delta: { x: number; y: number };
};

/**
 * A touch drag that ended where it started: the finger was only held a bit
 * longer than a tap. dnd-kit swallows the click once a drag has started, so
 * the caller should do what the tap would have done.
 */
export function isReticulumTouchTapDrag(
  event: DragEndLike,
  movedDuringDrag: boolean
): boolean {
  if (movedDuringDrag) return false;
  const type = event.activatorEvent?.type ?? '';
  if (!type.startsWith('touch')) return false;
  return (
    Math.hypot(event.delta.x, event.delta.y) <=
    RETICULUM_CHANNEL_TOUCH_DRAG_TOLERANCE_PX
  );
}

/** True once a drag has moved far enough to be a reorder, not a hold. */
export function hasReticulumDragMoved(delta: { x: number; y: number }) {
  return (
    Math.hypot(delta.x, delta.y) > RETICULUM_CHANNEL_TOUCH_DRAG_TOLERANCE_PX
  );
}

/** A click that slips through after a held tap is ignored for this long. */
export const RETICULUM_HELD_TAP_CLICK_GUARD_MS = 600;

/** What a finished drag turned out to be. */
type ReticulumChannelDragOutcome = 'cancel' | 'drop' | 'tap';

type ReticulumChannelDragTracker = {
  /** dnd-kit onDragStart. */
  begin(): void;
  /**
   * A long-press context menu arrived. False while a reorder is under way:
   * the menu must stay shut. True otherwise, and a menu opened by the hold
   * means releasing without moving is no longer a tap.
   */
  claimContextMenu(): boolean;
  /**
   * dnd-kit onDragEnd (with its event) or onDragCancel (without). A 'tap'
   * should do what the tap would have done: dnd-kit swallows its click.
   */
  finish(
    event?: DragEndLike & { active: { id: number | string } }
  ): ReticulumChannelDragOutcome;
  isActive(): boolean;
  /** A click on `dragId` right after a held tap on it was handled. */
  isRepeatOfHeldTap(dragId: string): boolean;
  /**
   * dnd-kit onDragMove. True on the move that turns a hold which opened the
   * admin menu into a reorder: close the menu, as Android home screens do.
   */
  move(delta: { x: number; y: number }): boolean;
};

/**
 * The tap/drag rules for an admin's channel list on a touch screen. A press
 * held past the drag delay becomes a dnd-kit drag even when the finger never
 * moves, so the list needs to tell a slow tap, the long-press admin menu and
 * a real reorder apart.
 */
export function createReticulumChannelDragTracker(
  now: () => number = Date.now
): ReticulumChannelDragTracker {
  let active = false;
  let menuOpened = false;
  let moved = false;
  let heldTap: { at: number; dragId: string } | null = null;

  return {
    begin() {
      active = true;
      menuOpened = false;
      moved = false;
    },
    claimContextMenu() {
      if (!active) return true;
      if (moved) return false;
      menuOpened = true;
      return true;
    },
    finish(event) {
      const wasTap =
        event !== undefined &&
        !menuOpened &&
        isReticulumTouchTapDrag(event, moved);
      active = false;
      menuOpened = false;
      moved = false;
      if (!event) return 'cancel';
      if (!wasTap) return 'drop';
      heldTap = { at: now(), dragId: String(event.active.id) };
      return 'tap';
    },
    isActive() {
      return active;
    },
    isRepeatOfHeldTap(dragId) {
      return (
        heldTap !== null &&
        heldTap.dragId === dragId &&
        now() - heldTap.at < RETICULUM_HELD_TAP_CLICK_GUARD_MS
      );
    },
    move(delta) {
      if (!active || moved || !hasReticulumDragMoved(delta)) return false;
      moved = true;
      return menuOpened;
    },
  };
}
