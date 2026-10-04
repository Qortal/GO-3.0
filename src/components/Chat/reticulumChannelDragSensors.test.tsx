import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragStartEvent,
} from '@dnd-kit/core';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReticulumChannelDragTracker,
  hasReticulumDragMoved,
  isReticulumTouchTapDrag,
  RETICULUM_HELD_TAP_CLICK_GUARD_MS,
  RETICULUM_CHANNEL_POINTER_DRAG_DISTANCE_PX,
  RETICULUM_CHANNEL_TOUCH_DRAG_DELAY_MS,
  RETICULUM_CHANNEL_TOUCH_DRAG_TOLERANCE_PX,
  ReticulumMousePointerSensor,
} from './reticulumChannelDragSensors';

function Row({ onClick }: { onClick: () => void }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: 'row' });
  return (
    <button ref={setNodeRef} {...attributes} {...listeners} onClick={onClick}>
      general
    </button>
  );
}

function List({
  mouseOnly = true,
  onClick = () => {},
  onDragStart,
}: {
  mouseOnly?: boolean;
  onClick?: () => void;
  onDragStart: (event: DragStartEvent) => void;
}) {
  const sensors = useSensors(
    useSensor(mouseOnly ? ReticulumMousePointerSensor : PointerSensor, {
      activationConstraint: {
        distance: RETICULUM_CHANNEL_POINTER_DRAG_DISTANCE_PX,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: RETICULUM_CHANNEL_TOUCH_DRAG_DELAY_MS,
        tolerance: RETICULUM_CHANNEL_TOUCH_DRAG_TOLERANCE_PX,
      },
    })
  );
  return (
    <DndContext onDragStart={onDragStart} sensors={sensors}>
      <Row onClick={onClick} />
    </DndContext>
  );
}

// jsdom has no PointerEvent: a MouseEvent carrying the pointer fields is
// what React and dnd-kit read.
function pointer(
  target: EventTarget,
  type: string,
  pointerType: 'mouse' | 'touch',
  x = 0
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: x,
    clientY: 0,
  });
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerType: { value: pointerType },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

function touch(target: EventTarget, type: string, x = 0) {
  const event = new TouchEvent(type, { bubbles: true, cancelable: true });
  const points = type === 'touchend' ? [] : [{ clientX: x, clientY: 0 }];
  Object.defineProperties(event, {
    changedTouches: { value: [{ clientX: x, clientY: 0 }] },
    touches: { value: points },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

describe('ReticulumMousePointerSensor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves a touch to the press-and-hold touch sensor', () => {
    const onDragStart = vi.fn();
    render(<List onDragStart={onDragStart} />);
    const row = screen.getByRole('button', { name: 'general' });

    pointer(row, 'pointerdown', 'touch');
    touch(row, 'touchstart');
    // A wobble the old 6px pointer drag would have taken as a drag.
    pointer(document, 'pointermove', 'touch', 7);
    touch(row, 'touchmove', 7);
    expect(onDragStart).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(RETICULUM_CHANNEL_TOUCH_DRAG_DELAY_MS);
    });
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragStart.mock.calls[0][0].activatorEvent.type).toBe('touchstart');
  });

  it('lets a quick tap through as a click', () => {
    const onDragStart = vi.fn();
    render(<List onDragStart={onDragStart} />);
    const row = screen.getByRole('button', { name: 'general' });

    pointer(row, 'pointerdown', 'touch');
    touch(row, 'touchstart');
    act(() => {
      vi.advanceTimersByTime(RETICULUM_CHANNEL_TOUCH_DRAG_DELAY_MS - 100);
    });
    touch(row, 'touchend');
    act(() => {
      vi.advanceTimersByTime(RETICULUM_CHANNEL_TOUCH_DRAG_DELAY_MS);
    });

    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('gives up the hold once the finger scrolls', () => {
    const onDragStart = vi.fn();
    render(<List onDragStart={onDragStart} />);
    const row = screen.getByRole('button', { name: 'general' });

    pointer(row, 'pointerdown', 'touch');
    touch(row, 'touchstart');
    touch(row, 'touchmove', RETICULUM_CHANNEL_TOUCH_DRAG_TOLERANCE_PX + 4);
    act(() => {
      vi.advanceTimersByTime(RETICULUM_CHANNEL_TOUCH_DRAG_DELAY_MS * 2);
    });

    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('still drags with a mouse after a short move', () => {
    const onDragStart = vi.fn();
    render(<List onDragStart={onDragStart} />);
    const row = screen.getByRole('button', { name: 'general' });

    pointer(row, 'pointerdown', 'mouse');
    pointer(
      document,
      'pointermove',
      'mouse',
      RETICULUM_CHANNEL_POINTER_DRAG_DISTANCE_PX + 1
    );

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragStart.mock.calls[0][0].activatorEvent.type).toBe(
      'pointerdown'
    );
  });

  it('fixes the plain PointerSensor taking touches first', () => {
    const onDragStart = vi.fn();
    render(<List mouseOnly={false} onDragStart={onDragStart} />);
    const row = screen.getByRole('button', { name: 'general' });

    pointer(row, 'pointerdown', 'touch');
    touch(row, 'touchstart');
    pointer(document, 'pointermove', 'touch', 7);

    // The old setup: a 7px wobble on a tap was already a drag.
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragStart.mock.calls[0][0].activatorEvent.type).toBe(
      'pointerdown'
    );
  });
});

describe('isReticulumTouchTapDrag', () => {
  const touchStart = new Event('touchstart');
  const pointerDown = new Event('pointerdown');

  it('treats a held, unmoved touch as a tap', () => {
    expect(
      isReticulumTouchTapDrag(
        { activatorEvent: touchStart, delta: { x: 3, y: -4 } },
        false
      )
    ).toBe(true);
  });

  it('is a reorder once the finger moved, even if it came back', () => {
    expect(
      isReticulumTouchTapDrag(
        { activatorEvent: touchStart, delta: { x: 0, y: 0 } },
        true
      )
    ).toBe(false);
    expect(
      isReticulumTouchTapDrag(
        { activatorEvent: touchStart, delta: { x: 0, y: 30 } },
        false
      )
    ).toBe(false);
  });

  it('never turns a mouse drag into a tap', () => {
    expect(
      isReticulumTouchTapDrag(
        { activatorEvent: pointerDown, delta: { x: 0, y: 0 } },
        false
      )
    ).toBe(false);
    expect(
      isReticulumTouchTapDrag(
        { activatorEvent: null, delta: { x: 0, y: 0 } },
        false
      )
    ).toBe(false);
  });
});

describe('hasReticulumDragMoved', () => {
  it('ignores jitter within the touch tolerance', () => {
    expect(hasReticulumDragMoved({ x: 5, y: 5 })).toBe(false);
    expect(hasReticulumDragMoved({ x: 0, y: 12 })).toBe(true);
  });
});

describe('createReticulumChannelDragTracker', () => {
  const CHANNEL = 'reticulum-channel:general';
  const CATEGORY = 'reticulum-category:projects';
  const held = (id: string, delta = { x: 0, y: 0 }) => ({
    activatorEvent: new Event('touchstart'),
    active: { id },
    delta,
  });
  const setup = () => {
    let clock = 1_000;
    const tracker = createReticulumChannelDragTracker(() => clock);
    return {
      advance: (ms: number) => {
        clock += ms;
      },
      tracker,
    };
  };

  it('treats a held press released in place as a tap', () => {
    const { tracker } = setup();
    tracker.begin();
    expect(tracker.isActive()).toBe(true);
    expect(tracker.move({ x: 2, y: 3 })).toBe(false);
    expect(tracker.finish(held(CHANNEL, { x: 2, y: 3 }))).toBe('tap');
    expect(tracker.isActive()).toBe(false);
  });

  it('is a reorder once the finger moved, even if it came back', () => {
    const { tracker } = setup();
    tracker.begin();
    tracker.move({ x: 0, y: 30 });
    expect(tracker.finish(held(CHANNEL))).toBe('drop');
  });

  it('lets a still hold open the admin menu, which then stops the tap', () => {
    const { tracker } = setup();
    tracker.begin();
    expect(tracker.claimContextMenu()).toBe(true);
    expect(tracker.finish(held(CHANNEL))).toBe('drop');
  });

  it('keeps the admin menu shut once a reorder is under way', () => {
    const { tracker } = setup();
    tracker.begin();
    tracker.move({ x: 0, y: 30 });
    expect(tracker.claimContextMenu()).toBe(false);
  });

  it('asks once to close a menu the hold opened when the drag moves', () => {
    const { tracker } = setup();
    tracker.begin();
    tracker.claimContextMenu();
    expect(tracker.move({ x: 0, y: 4 })).toBe(false);
    expect(tracker.move({ x: 0, y: 30 })).toBe(true);
    expect(tracker.move({ x: 0, y: 60 })).toBe(false);
    expect(tracker.finish(held(CHANNEL, { x: 0, y: 60 }))).toBe('drop');
  });

  it('does not ask to close anything when no menu was open', () => {
    const { tracker } = setup();
    tracker.begin();
    expect(tracker.move({ x: 0, y: 30 })).toBe(false);
  });

  it('never turns a mouse drag into a tap', () => {
    const { tracker } = setup();
    tracker.begin();
    expect(
      tracker.finish({
        activatorEvent: new Event('pointerdown'),
        active: { id: CHANNEL },
        delta: { x: 0, y: 0 },
      })
    ).toBe('drop');
  });

  it('resets on cancel, and menus outside a drag are always allowed', () => {
    const { tracker } = setup();
    tracker.begin();
    tracker.move({ x: 0, y: 30 });
    expect(tracker.finish()).toBe('cancel');
    expect(tracker.isActive()).toBe(false);
    expect(tracker.claimContextMenu()).toBe(true);
    // A right-click outside a drag does not leak into the next one.
    tracker.begin();
    expect(tracker.finish(held(CHANNEL))).toBe('tap');
  });

  it('ignores a leaked click on the same row right after a held tap', () => {
    const { advance, tracker } = setup();
    tracker.begin();
    expect(tracker.finish(held(CATEGORY))).toBe('tap');
    expect(tracker.isRepeatOfHeldTap(CATEGORY)).toBe(true);
    // Other categories still toggle straight away.
    expect(tracker.isRepeatOfHeldTap('reticulum-category:community')).toBe(
      false
    );
    advance(RETICULUM_HELD_TAP_CLICK_GUARD_MS);
    expect(tracker.isRepeatOfHeldTap(CATEGORY)).toBe(false);
  });

  it('does not guard anything after a drop', () => {
    const { tracker } = setup();
    tracker.begin();
    tracker.move({ x: 0, y: 30 });
    tracker.finish(held(CATEGORY, { x: 0, y: 30 }));
    expect(tracker.isRepeatOfHeldTap(CATEGORY)).toBe(false);
  });
});
