import { act, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimHorizontalGesture } from '../../hooks/horizontalGestureClaim';
import { useSwipeBackToList } from './useSwipeBackToList';

const SCREEN = 400;
const MID_Y = 300;

let backs = 0;
let forwards = 0;
let reveals: Array<string | null> = [];

function Harness({ enabledFromStart = true, withForward = false }) {
  const [chat, setChat] = useState<HTMLElement | null>(null);
  const [list, setList] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(enabledFromStart);
  useSwipeBackToList(chat, list, {
    enabled: open,
    onBack: () => {
      backs += 1;
      setOpen(false);
    },
    onForward: withForward
      ? () => {
          forwards += 1;
          setOpen(false);
        }
      : undefined,
    onReveal: (direction) => reveals.push(direction),
  });
  return (
    <div>
      <div ref={setList} data-testid="list" />
      <div ref={setChat} data-testid="chat">
        <p data-testid="message">hello</p>
        <input data-testid="field" />
      </div>
    </div>
  );
}

type Point = { x: number; y: number };

const touch = (
  type: string,
  target: Element,
  points: Point[],
  timeStamp: number,
  changed: Point[] = points
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const list = (items: Point[]) =>
    items.map((p) => ({ clientX: p.x, clientY: p.y, target }));
  Object.defineProperty(event, 'touches', { value: list(points) });
  Object.defineProperty(event, 'changedTouches', { value: list(changed) });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  act(() => {
    target.dispatchEvent(event);
  });
};

/** A drag along x, 40px per 16ms, then a rest before the lift. */
const drag = (target: Element, fromX: number, dx: number, t0: number) => {
  const steps = Math.max(2, Math.ceil(Math.abs(dx) / 40));
  let t = t0;
  touch('touchstart', target, [{ x: fromX, y: MID_Y }], t);
  let x = fromX;
  for (let i = 1; i <= steps; i += 1) {
    t += 16;
    x = fromX + (dx * i) / steps;
    touch('touchmove', target, [{ x, y: MID_Y }], t);
  }
  touch('touchend', target, [], t + 300, [{ x, y: MID_Y }]);
};

const frame = () =>
  act(async () => {
    vi.advanceTimersByTime(20);
  });

describe('useSwipeBackToList', () => {
  beforeEach(() => {
    backs = 0;
    forwards = 0;
    reveals = [];
    vi.useFakeTimers();
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: SCREEN,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('follows the finger, the list coming out from under the chat', async () => {
    const { getByTestId } = render(<Harness />);
    const message = getByTestId('message');
    touch('touchstart', message, [{ x: 100, y: MID_Y }], 1000);
    touch('touchmove', message, [{ x: 120, y: MID_Y }], 1016);
    touch('touchmove', message, [{ x: 220, y: MID_Y }], 1032);
    await frame();

    const chat = getByTestId('chat');
    const list = getByTestId('list');
    expect(chat.style.transform).toBe('translate3d(100px, 0, 0)');
    expect(chat.style.zIndex).toBe('41');
    // A quarter of the way: the list has come a quarter of its 30% back.
    expect(list.style.transform).toBe('translate3d(-90px, 0, 0)');
    expect(list.style.width).toBe('100%');
    touch('touchend', message, [], 1040, [{ x: 220, y: MID_Y }]);
  });

  it('goes back past a quarter of the width, then hands the layout back', async () => {
    const { getByTestId } = render(<Harness />);
    drag(getByTestId('message'), 60, 200, 2000);

    const chat = getByTestId('chat');
    expect(chat.style.transform).toBe(`translate3d(${SCREEN}px, 0, 0)`);
    expect(chat.style.transition).toContain('transform');
    expect(backs).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(backs).toBe(1);
    // The chat closed: no inline styles left behind.
    expect(chat.getAttribute('style') ?? '').toBe('');
    expect(getByTestId('list').getAttribute('style') ?? '').toBe('');
  });

  it('closes the chat at once for a tap on the list while it glides off', async () => {
    const { getByTestId } = render(<Harness />);
    drag(getByTestId('message'), 60, 200, 2500);
    const chat = getByTestId('chat');
    const list = getByTestId('list');
    // Gliding off: taps go to the list now, not the chat leaving over it.
    expect(chat.style.pointerEvents).toBe('none');
    expect(list.style.pointerEvents).toBe('auto');
    expect(backs).toBe(0);

    touch('touchstart', list, [{ x: 150, y: MID_Y }], 2900);
    touch('touchend', list, [], 2960, [{ x: 152, y: MID_Y }]);
    expect(backs).toBe(1);
    expect(list.getAttribute('style') ?? '').toBe('');

    // The glide's own timer does not close it a second time.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(backs).toBe(1);
  });

  it('leaves a scroll on the list to the glide', async () => {
    const { getByTestId } = render(<Harness />);
    drag(getByTestId('message'), 60, 200, 2700);
    const list = getByTestId('list');
    touch('touchstart', list, [{ x: 150, y: MID_Y }], 3100);
    touch('touchend', list, [], 3160, [{ x: 150, y: MID_Y - 60 }]);
    expect(backs).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(backs).toBe(1);
  });

  it('springs back from a short drag', async () => {
    const { getByTestId } = render(<Harness />);
    drag(getByTestId('message'), 60, 60, 3000);

    expect(getByTestId('chat').style.transform).toBe('translate3d(0px, 0, 0)');
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(backs).toBe(0);
    expect(getByTestId('chat').getAttribute('style') ?? '').toBe('');
    expect(getByTestId('list').getAttribute('style') ?? '').toBe('');
  });

  it('leaves drags to the left, text fields and claimed swipes alone', async () => {
    const { getByTestId } = render(<Harness />);
    drag(getByTestId('message'), 300, -200, 4000);
    drag(getByTestId('field'), 60, 200, 5000);

    const message = getByTestId('message');
    touch('touchstart', message, [{ x: 60, y: MID_Y }], 6000);
    claimHorizontalGesture(6000);
    touch('touchmove', message, [{ x: 100, y: MID_Y }], 6016);
    touch('touchmove', message, [{ x: 300, y: MID_Y }], 6032);
    touch('touchend', message, [], 6040, [{ x: 300, y: MID_Y }]);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(backs).toBe(0);
    expect(getByTestId('chat').style.transform).toBe('');
  });

  it('does nothing while off', async () => {
    const { getByTestId } = render(<Harness enabledFromStart={false} />);
    drag(getByTestId('message'), 60, 200, 7000);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(backs).toBe(0);
    expect(getByTestId('chat').style.transform).toBe('');
  });

  it('goes to the list on the right on a swipe to the left, when it has one', async () => {
    const { getByTestId } = render(<Harness withForward />);
    const message = getByTestId('message');
    touch('touchstart', message, [{ x: 300, y: MID_Y }], 8000);
    touch('touchmove', message, [{ x: 280, y: MID_Y }], 8016);
    touch('touchmove', message, [{ x: 200, y: MID_Y }], 8032);
    await frame();
    // The chat goes left; the list waits to the right and follows.
    expect(getByTestId('chat').style.transform).toBe(
      'translate3d(-80px, 0, 0)'
    );
    expect(getByTestId('list').style.transform).toBe('translate3d(96px, 0, 0)');
    expect(reveals).toEqual(['forward']);
    touch('touchmove', message, [{ x: 100, y: MID_Y }], 8048);
    touch('touchend', message, [], 8300, [{ x: 100, y: MID_Y }]);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(forwards).toBe(1);
    expect(backs).toBe(0);
  });

  it('shows the usual list again after springing back', async () => {
    const { getByTestId } = render(<Harness withForward />);
    drag(getByTestId('message'), 300, -50, 9000);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(reveals).toEqual(['forward', null]);
    expect(forwards).toBe(0);
    expect(getByTestId('list').getAttribute('style') ?? '').toBe('');
  });
});
