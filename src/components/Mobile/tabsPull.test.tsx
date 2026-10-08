import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SECTION_ATTR } from './sectionSwipe/sectionSwipe';
import {
  TABS_PULL_IGNORE_ATTR,
  setTabsPanelElement,
  useTabsPullDown,
  type TabsPullDownOptions,
} from './tabsPull';

const PANEL_HEIGHT = 400;

let onPullStart = vi.fn();
let onPullEnd = vi.fn();

const Harness = (props: Partial<TabsPullDownOptions>) => {
  useTabsPullDown({
    enabled: true,
    canStart: true,
    sections: ['home', 'chat'],
    onPullStart,
    onPullEnd,
    ...props,
  });
  return (
    <>
      <div {...{ [SECTION_ATTR]: 'home' }}>
        <div data-testid="list" style={{ overflowY: 'auto' }}>
          <div data-testid="row">row</div>
          <div data-testid="handle" {...{ [TABS_PULL_IGNORE_ATTR]: '' }}>
            handle
          </div>
        </div>
      </div>
      <div {...{ [SECTION_ATTR]: 'apps' }}>
        <div data-testid="apps-row">app</div>
      </div>
    </>
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

/** A finger from y0 down to y1 in 16ms steps of `step` px, a rest, a lift. */
const pull = (
  target: Element,
  y0: number,
  y1: number,
  { t0 = 1000, step = 30, restMs = 200, x = 200 } = {}
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
  touch('touchend', target, [], t + restMs, [{ x, y: y1 }]);
};

const makeScrollable = (list: HTMLElement, scrollTop = 0) => {
  Object.defineProperty(list, 'scrollHeight', { value: 2000 });
  Object.defineProperty(list, 'clientHeight', { value: 600 });
  list.scrollTop = scrollTop;
};

describe('useTabsPullDown', () => {
  let panel: HTMLElement;

  beforeEach(() => {
    onPullStart = vi.fn();
    onPullEnd = vi.fn();
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
    Object.defineProperty(panel, 'offsetHeight', { value: PANEL_HEIGHT });
    document.body.appendChild(panel);
  });

  afterEach(() => {
    setTabsPanelElement(null);
    panel.remove();
    vi.useRealTimers();
  });

  it('brings the Tabs panel down with the finger from the top of a list', () => {
    const { getByTestId } = render(<Harness />);
    const list = getByTestId('list');
    makeScrollable(list);
    // The window opens for the pull and hands its panel over.
    onPullStart.mockImplementation(() => setTabsPanelElement(panel));

    const row = getByTestId('row');
    touch('touchstart', row, [{ x: 200, y: 100 }], 1000);
    touch('touchmove', row, [{ x: 201, y: 120 }], 1016);
    expect(onPullStart).toHaveBeenCalledTimes(1);
    // Mounted for the pull: hidden above until the first frame.
    expect(panel.style.transform).toBe('translate3d(0, -100%, 0)');
    // The list holds still while the panel moves.
    expect(list.style.overflowY).toBe('hidden');

    touch('touchmove', row, [{ x: 201, y: 270 }], 1032);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    // 150px of travel since the pull began at 120.
    expect(panel.style.transform).toBe('translate3d(0, -250px, 0)');

    touch('touchend', row, [], 1300, [{ x: 201, y: 270 }]);
    // Past a third of the panel: it glides the rest of the way.
    expect(panel.style.transform).toBe('translate3d(0, 0px, 0)');
    expect(panel.style.transition).toContain('transform');
    // The list's own overflow is back.
    expect(list.style.overflowY).toBe('auto');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onPullEnd).toHaveBeenCalledWith(true);
    // Handed back to the window, open.
    expect(panel.style.transform).toBe('');
  });

  it('slides back up from a short pull', () => {
    const { getByTestId } = render(<Harness />);
    onPullStart.mockImplementation(() => setTabsPanelElement(panel));
    pull(getByTestId('row'), 100, 190);

    expect(onPullStart).toHaveBeenCalled();
    expect(panel.style.transform).toBe(`translate3d(0, -${PANEL_HEIGHT}px, 0)`);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onPullEnd).toHaveBeenCalledWith(false);
    // Hidden or gone by now: handed back as it was for the next open.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(panel.style.transform).toBe('');
  });

  it('opens for a short quick flick down', () => {
    const { getByTestId } = render(<Harness />);
    onPullStart.mockImplementation(() => setTabsPanelElement(panel));
    pull(getByTestId('row'), 100, 190, { step: 30, restMs: 0 });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onPullEnd).toHaveBeenCalledWith(true);
  });

  it('leaves a list scrolled down to scroll back up', () => {
    const { getByTestId } = render(<Harness />);
    makeScrollable(getByTestId('list'), 240);
    pull(getByTestId('row'), 100, 400);
    expect(onPullStart).not.toHaveBeenCalled();
  });

  it('leaves a page scrolled down alone, even from an inner list at its top', () => {
    // Home: the section is the page scroller, the feeds inside it scroll
    // too. Scrolled to the bottom, a drag down on a feed sitting at its own
    // top scrolls the page back up, it never brings Tabs down.
    const { getByTestId } = render(<Harness />);
    const list = getByTestId('list');
    const page = list.parentElement as HTMLElement;
    page.style.overflowY = 'auto';
    makeScrollable(page, 900);
    makeScrollable(list, 0);
    pull(getByTestId('row'), 100, 400);
    pull(getByTestId('list'), 100, 400, { t0: 3000 });
    expect(onPullStart).not.toHaveBeenCalled();

    // Back at the top of the page, the same drag pulls.
    page.scrollTop = 0;
    pull(getByTestId('row'), 100, 400, { t0: 5000 });
    expect(onPullStart).toHaveBeenCalledTimes(1);
  });

  it('leaves upward and sideways drags, and press-and-holds, alone', () => {
    const { getByTestId } = render(<Harness />);
    const row = getByTestId('row');
    pull(row, 400, 100, { t0: 2000 });
    // Sideways, drifting down a little.
    touch('touchstart', row, [{ x: 300, y: 100 }], 3000);
    touch('touchmove', row, [{ x: 200, y: 120 }], 3016);
    touch('touchmove', row, [{ x: 100, y: 200 }], 3032);
    touch('touchend', row, [], 3100, [{ x: 100, y: 200 }]);
    // Held before moving: a long press (row menus, reordering).
    touch('touchstart', row, [{ x: 200, y: 100 }], 4000);
    touch('touchmove', row, [{ x: 200, y: 160 }], 4600);
    touch('touchend', row, [], 4700, [{ x: 200, y: 160 }]);
    expect(onPullStart).not.toHaveBeenCalled();
  });

  it('pulls only in the given sections, when allowed, and not on marked parts', () => {
    const { getByTestId, rerender } = render(<Harness />);
    pull(getByTestId('apps-row'), 100, 400, { t0: 5000 });
    pull(getByTestId('handle'), 100, 400, { t0: 6000 });
    rerender(<Harness canStart={false} />);
    pull(getByTestId('row'), 100, 400, { t0: 7000 });
    expect(onPullStart).not.toHaveBeenCalled();
  });

  it('keeps listening through the pull when it can no longer start one', () => {
    const { getByTestId, rerender } = render(<Harness />);
    onPullStart.mockImplementation(() => setTabsPanelElement(panel));
    const row = getByTestId('row');
    touch('touchstart', row, [{ x: 200, y: 100 }], 8000);
    touch('touchmove', row, [{ x: 200, y: 120 }], 8016);
    // The Tabs window is open now.
    rerender(<Harness canStart={false} />);
    touch('touchmove', row, [{ x: 200, y: 320 }], 8032);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(panel.style.transform).toBe('translate3d(0, -200px, 0)');
    touch('touchend', row, [], 8300, [{ x: 200, y: 320 }]);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onPullEnd).toHaveBeenCalledWith(true);
  });
});
