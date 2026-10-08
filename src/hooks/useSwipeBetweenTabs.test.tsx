import { act, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSwipeBetweenTabs } from './useSwipeBetweenTabs';

const MID_Y = 300;
let changes: number[] = [];

const Harness = ({ start = 1, count = 4 }) => {
  const [page, setPage] = useState<HTMLElement | null>(null);
  const [index, setIndex] = useState(start);
  useSwipeBetweenTabs(page, {
    enabled: true,
    index,
    count,
    onChange: (next) => {
      changes.push(next);
      setIndex(next);
    },
  });
  return (
    <div ref={setPage} data-testid="page">
      <p data-testid="text">tab {index}</p>
      <input data-testid="field" />
    </div>
  );
};

const touch = (
  type: string,
  target: Element,
  points: Array<{ x: number; y: number }>,
  timeStamp: number,
  changed = points
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const list = (items: typeof points) =>
    items.map((p) => ({ clientX: p.x, clientY: p.y, target }));
  Object.defineProperty(event, 'touches', { value: list(points) });
  Object.defineProperty(event, 'changedTouches', { value: list(changed) });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  act(() => {
    target.dispatchEvent(event);
  });
};

const flick = (target: Element, from: number, to: number, t0 = 1000) => {
  touch('touchstart', target, [{ x: from, y: MID_Y }], t0);
  const step = Math.sign(to - from) * 60;
  let x = from;
  let t = t0;
  while ((to - x) * Math.sign(step) > 0) {
    x = step > 0 ? Math.min(to, x + step) : Math.max(to, x + step);
    t += 16;
    touch('touchmove', target, [{ x, y: MID_Y }], t);
  }
  touch('touchend', target, [], t, [{ x: to, y: MID_Y }]);
};

describe('useSwipeBetweenTabs', () => {
  beforeEach(() => {
    changes = [];
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a flick to the left opens the next tab, to the right the previous', () => {
    const { getByTestId } = render(<Harness />);
    flick(getByTestId('text'), 700, 400);
    // Slide out, switch (React re-renders), then slide in.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(changes).toEqual([2]);
    flick(getByTestId('text'), 300, 600, 3000);
    // Slide out, switch (React re-renders), then slide in.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(changes).toEqual([2, 1]);
    // Settled: nothing left on the page.
    expect(getByTestId('page').style.transform).toBe('');
    expect(getByTestId('page').style.opacity).toBe('');
  });

  it('stays on the last tab, and springs back', () => {
    const { getByTestId } = render(<Harness start={3} />);
    flick(getByTestId('text'), 700, 300);
    // Slide out, switch (React re-renders), then slide in.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(changes).toEqual([]);
    expect(getByTestId('page').style.transform).toBe('');
  });

  it('leaves text fields and vertical scrolling alone', () => {
    const { getByTestId } = render(<Harness />);
    flick(getByTestId('field'), 700, 300);
    const text = getByTestId('text');
    touch('touchstart', text, [{ x: 500, y: 200 }], 5000);
    touch('touchmove', text, [{ x: 497, y: 240 }], 5016);
    touch('touchmove', text, [{ x: 300, y: 330 }], 5032);
    touch('touchend', text, [], 5040, [{ x: 300, y: 330 }]);
    // Slide out, switch (React re-renders), then slide in.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(changes).toEqual([]);
  });
});
