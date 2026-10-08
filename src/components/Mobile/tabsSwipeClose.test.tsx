import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BIG_SWIPE_RATIO,
  LIST_FLING_TIME_MS,
  bigSwipePx,
  listAtEnd,
  listFlingDistance,
  splitListSwipe,
  swipeCloseOffset,
  swipeCloseShouldClose,
  useTabsSwipeClose,
  type TabsSwipeCloseOptions,
} from './tabsSwipeClose';

describe('swipeCloseOffset', () => {
  it('follows the finger up, no further than the panel', () => {
    expect(swipeCloseOffset(-120, 500)).toBe(-120);
    expect(swipeCloseOffset(-900, 500)).toBe(-500);
  });

  it('only stretches a little when dragged down', () => {
    expect(swipeCloseOffset(50, 500)).toBeCloseTo(9);
    expect(swipeCloseOffset(1000, 500)).toBe(24);
  });
});

describe('swipeCloseShouldClose', () => {
  it('closes past a third of the panel', () => {
    expect(swipeCloseShouldClose(-200, 0, 500)).toBe(true);
    expect(swipeCloseShouldClose(-100, 0, 500)).toBe(false);
  });

  it('closes on a flick up whatever the distance', () => {
    expect(swipeCloseShouldClose(-30, -0.8, 500)).toBe(true);
  });

  it('stays open on a flick back down', () => {
    expect(swipeCloseShouldClose(-200, 0.8, 500)).toBe(false);
  });

  it('takes a shorter distance with a smaller ratio', () => {
    expect(swipeCloseShouldClose(-70, 0, 500, 0.12)).toBe(true);
    expect(swipeCloseShouldClose(-50, 0, 500, 0.12)).toBe(false);
  });
});

describe('listAtEnd', () => {
  const list = (
    scrollTop: number,
    clientHeight: number,
    scrollHeight: number
  ) => ({ scrollTop, clientHeight, scrollHeight }) as HTMLElement;

  it('is true at the end and for a list that does not scroll', () => {
    expect(listAtEnd(list(500, 300, 800))).toBe(true);
    expect(listAtEnd(list(0, 300, 300))).toBe(true);
  });

  it('is false with more to scroll', () => {
    expect(listAtEnd(list(100, 300, 800))).toBe(false);
  });
});

describe('bigSwipePx', () => {
  it('is a share of the panel, within bounds', () => {
    expect(bigSwipePx(600)).toBe(Math.round(600 * BIG_SWIPE_RATIO));
    expect(bigSwipePx(200)).toBe(160);
    expect(bigSwipePx(2000)).toBe(280);
  });
});

describe('splitListSwipe', () => {
  it('scrolls the list for a small swipe', () => {
    expect(splitListSwipe(120, 1000, 300, 210)).toEqual({
      scroll: 120,
      panel: 0,
      canClose: false,
    });
  });

  it('moves the panel with the rest of a big swipe', () => {
    expect(splitListSwipe(300, 1000, 300, 210)).toEqual({
      scroll: 210,
      panel: 90,
      canClose: true,
    });
  });

  it('only stretches the panel past the end until the swipe is big', () => {
    const near = splitListSwipe(150, 50, 300, 210);
    expect(near.scroll).toBe(50);
    expect(near.panel).toBeCloseTo(35);
    expect(near.canClose).toBe(false);
    const far = splitListSwipe(260, 50, 300, 210);
    expect(far.panel).toBeCloseTo(0.35 * 160 + 50);
    expect(far.canClose).toBe(true);
  });

  it('moves the panel at once when the list is already at its end', () => {
    expect(splitListSwipe(40, 0, 300, 210)).toEqual({
      scroll: 0,
      panel: 40,
      canClose: true,
    });
  });

  it('scrolls back up for a swipe down, no further than the top', () => {
    expect(splitListSwipe(-80, 0, 300, 210).scroll).toBe(-80);
    expect(splitListSwipe(-500, 0, 300, 210).scroll).toBe(-300);
  });
});

describe('listFlingDistance', () => {
  it('starts at the finger speed and covers speed x time constant', () => {
    expect(listFlingDistance(2, 1)).toBeCloseTo(2, 1);
    expect(listFlingDistance(2, 100 * LIST_FLING_TIME_MS)).toBeCloseTo(
      2 * LIST_FLING_TIME_MS
    );
    expect(listFlingDistance(-1, 100 * LIST_FLING_TIME_MS)).toBeCloseTo(
      -LIST_FLING_TIME_MS
    );
  });
});

describe('useTabsSwipeClose', () => {
  const PANEL_HEIGHT = 600;
  // bigSwipePx(600) = 210.
  let panel: HTMLElement;
  let header: HTMLElement;
  let list: HTMLElement;
  let card: HTMLElement;
  let below: HTMLElement;
  let onClose = vi.fn();

  const Harness = (props: Partial<TabsSwipeCloseOptions>) => {
    useTabsSwipeClose({
      below,
      enabled: true,
      getList: () => list,
      onClose,
      panel,
      ...props,
    });
    return null;
  };

  const touch = (
    type: string,
    target: Element,
    points: Array<{ x: number; y: number }>,
    timeStamp: number,
    changed = points
  ) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const toList = (items: typeof points) =>
      items.map((p) => ({ clientX: p.x, clientY: p.y, target }));
    Object.defineProperty(event, 'touches', { value: toList(points) });
    Object.defineProperty(event, 'changedTouches', { value: toList(changed) });
    Object.defineProperty(event, 'timeStamp', { value: timeStamp });
    act(() => {
      target.dispatchEvent(event);
    });
  };

  /** A finger from y0 to y1 in 16ms steps of `step` px, then a lift
   * `restMs` after the last move (0: still moving). Returns the lift time. */
  const swipe = (
    target: Element,
    y0: number,
    y1: number,
    { t0 = 1000, step = 20, restMs = 0, x = 200 } = {}
  ) => {
    let t = t0;
    touch('touchstart', target, [{ x, y: y0 }], t);
    const direction = Math.sign(y1 - y0);
    let y = y0;
    while ((y1 - y) * direction > 0) {
      y = direction > 0 ? Math.min(y1, y + step) : Math.max(y1, y - step);
      t += 16;
      touch('touchmove', target, [{ x, y }], t);
    }
    act(() => {
      vi.advanceTimersByTime(16);
    });
    const liftT = t + (restMs || 16);
    const liftY = restMs ? y1 : y1 + (direction * step) / 4;
    touch('touchend', target, [], liftT, [{ x, y: liftY }]);
    return liftT;
  };

  const scrollable = (scrollTop: number, scrollHeight = 2000) => {
    Object.defineProperty(list, 'scrollHeight', {
      configurable: true,
      value: scrollHeight,
    });
    Object.defineProperty(list, 'clientHeight', {
      configurable: true,
      value: 500,
    });
    list.scrollTop = scrollTop;
  };

  beforeEach(() => {
    onClose = vi.fn();
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    });
    panel = document.createElement('div');
    header = document.createElement('div');
    list = document.createElement('div');
    card = document.createElement('button');
    below = document.createElement('div');
    list.append(card);
    panel.append(header, list);
    document.body.append(panel, below);
    Object.defineProperty(panel, 'offsetHeight', { value: PANEL_HEIGHT });
  });

  afterEach(() => {
    panel.remove();
    below.remove();
    vi.useRealTimers();
  });

  it('owns the list scrolling while on', () => {
    const { rerender } = render(<Harness />);
    expect(list.style.touchAction).toBe('none');
    rerender(<Harness enabled={false} />);
    expect(list.style.touchAction).toBe('');
  });

  it('scrolls the list for a small slow swipe and stays open', () => {
    render(<Harness />);
    scrollable(300);
    swipe(card, 600, 480, { restMs: 200 });

    // 120px of finger, less the first 20px step that started it.
    expect(list.scrollTop).toBe(400);
    expect(panel.style.transform).toBe('');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(list.scrollTop).toBe(400);
  });

  it('lets a small flick glide on, without closing', () => {
    render(<Harness />);
    scrollable(300);
    swipe(card, 600, 480);
    const lifted = list.scrollTop;
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(list.scrollTop).toBeGreaterThan(lifted + 100);
    expect(onClose).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe('');
  });

  it('closes on a big flick, the panel following past the big swipe', () => {
    render(<Harness />);
    scrollable(300);
    let t = 1000;
    touch('touchstart', card, [{ x: 200, y: 700 }], t);
    let y = 700;
    while (y > 400) {
      y -= 20;
      t += 16;
      touch('touchmove', card, [{ x: 200, y }], t);
    }
    act(() => {
      vi.advanceTimersByTime(16);
    });
    // 280px of swipe (after the first step): 210 scrolled, 70 on the panel.
    expect(list.scrollTop).toBe(510);
    expect(panel.style.transform).toBe('translate3d(0, -70px, 0)');

    touch('touchend', card, [], t + 16, [{ x: 200, y: 395 }]);
    expect(panel.style.transform).toBe(`translate3d(0, -${PANEL_HEIGHT}px, 0)`);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a slow big swipe once the panel has moved a little', () => {
    render(<Harness />);
    scrollable(300);
    // 300px after the first step: 210 scrolled, 90 on the panel (> 12%).
    swipe(card, 700, 380, { restMs: 200 });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('puts the panel back after a big swipe that stopped short', () => {
    render(<Harness />);
    scrollable(300);
    swipe(card, 700, 450, { restMs: 200 });
    expect(panel.style.transform).toBe('translate3d(0, 0px, 0)');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe('');
  });

  it('does not close on a small flick that runs into the end', () => {
    render(<Harness />);
    scrollable(1450);
    swipe(card, 600, 480);
    expect(list.scrollTop).toBe(1500);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes straight away from a list already at its end', () => {
    render(<Harness />);
    scrollable(1500);
    swipe(card, 600, 480);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('treats a swipe below the panel as one on a long list', () => {
    render(<Harness />);
    scrollable(300);
    swipe(below, 900, 780, { restMs: 200 });
    expect(list.scrollTop).toBe(400);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves a swipe below a short list to the background', () => {
    render(<Harness />);
    scrollable(0, 500);
    swipe(below, 900, 600);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(panel.style.transform).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('slides from the header right away', () => {
    render(<Harness />);
    scrollable(300);
    swipe(header, 100, 0);
    expect(list.scrollTop).toBe(300);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('scrolls back up for a swipe down on the list', () => {
    render(<Harness />);
    scrollable(300);
    swipe(card, 400, 520, { restMs: 200 });
    expect(list.scrollTop).toBe(200);
  });

  it('a touch that stops a glide is not a tap on the card', () => {
    render(<Harness />);
    const onClick = vi.fn();
    card.addEventListener('click', onClick);
    scrollable(300);
    const lifted = swipe(card, 600, 520, { step: 40 });
    act(() => {
      vi.advanceTimersByTime(48);
    });
    const caughtAt = lifted + 48;
    touch('touchstart', card, [{ x: 200, y: 500 }], caughtAt);
    touch('touchend', card, [], caughtAt + 60, [{ x: 200, y: 500 }]);
    const stoppedAt = list.scrollTop;
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(list.scrollTop).toBe(stoppedAt);

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(click, 'timeStamp', { value: caughtAt + 70 });
    act(() => {
      card.dispatchEvent(click);
    });
    expect(onClick).not.toHaveBeenCalled();

    // The next tap is a tap again.
    touch('touchstart', card, [{ x: 200, y: 500 }], caughtAt + 1000);
    touch('touchend', card, [], caughtAt + 1060, [{ x: 200, y: 500 }]);
    const next = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(next, 'timeStamp', { value: caughtAt + 1070 });
    act(() => {
      card.dispatchEvent(next);
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
