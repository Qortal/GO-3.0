import { act, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { darkTheme } from '../../styles/theme-dark';
import type { ChatScope } from './ChatScopeSwitch';
import {
  MobileChatListPager,
  isChatListSwipeEnabled,
} from './MobileChatListPager';

// jsdom lays nothing out: the pager falls back to the window width.
const SCREEN = 1024;
const MID_Y = 300;

type Point = { x: number; y: number };

/**
 * A native touch event the way the pager reads it. `changed` are the
 * touches that changed: on a touchend the lifted finger, which `points`
 * (the fingers still down) no longer has.
 */
const touchEvent = (
  type: string,
  target: Element,
  points: Point[],
  timeStamp: number,
  changed: Point[] = points
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const asTouches = (list: Point[]) =>
    list.map((point) => ({ clientX: point.x, clientY: point.y, target }));
  Object.defineProperty(event, 'touches', { value: asTouches(points) });
  Object.defineProperty(event, 'changedTouches', { value: asTouches(changed) });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  act(() => {
    target.dispatchEvent(event);
  });
};

/** The finger lifts at `at`, as a browser reports it. */
const lift = (target: Element, at: Point, timeStamp: number) =>
  touchEvent('touchend', target, [], timeStamp, [at]);

/** One finger from `from` through `steps` positions, 16ms apart. */
const swipe = (target: Element, from: Point, steps: Point[]) => {
  let t = 1000;
  touchEvent('touchstart', target, [from], t);
  for (const step of steps) {
    t += 16;
    touchEvent('touchmove', target, [step], t);
  }
  lift(target, steps[steps.length - 1], t);
};

/** A drag along x (60px per 16ms step) ending `dx` from the start, then a
 * rest before the lift. Browsers send no moves for a finger at rest. */
const dragX = (target: Element, startX: number, dx: number, t0 = 1000) => {
  const steps: Point[] = [];
  const count = Math.max(2, Math.ceil(Math.abs(dx) / 60));
  for (let i = 1; i <= count; i += 1) {
    steps.push({ x: startX + (dx * i) / count, y: MID_Y });
  }
  let t = t0;
  touchEvent('touchstart', target, [{ x: startX, y: MID_Y }], t);
  for (const step of steps) {
    t += 16;
    touchEvent('touchmove', target, [step], t);
  }
  lift(target, steps[steps.length - 1], t + 300);
};

/** Carries a finger already down at `fromX` (at time `t`) on by `dx`, 60px
 * per 16ms step, then rests and lifts. */
const dragOn = (target: Element, fromX: number, dx: number, t: number) => {
  const count = Math.max(2, Math.ceil(Math.abs(dx) / 60));
  let at: Point = { x: fromX, y: MID_Y };
  for (let i = 1; i <= count; i += 1) {
    at = { x: fromX + (dx * i) / count, y: MID_Y };
    touchEvent('touchmove', target, [at], t + 16 * i);
  }
  lift(target, at, t + 16 * count + 300);
};

const setScrollTop = (element: HTMLElement, value: number) =>
  Object.defineProperty(element, 'scrollTop', { configurable: true, value });

const mockMatchMedia = (matching: (query: string) => boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matching(query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

function Harness({
  initialScope = 'groups',
  onScopeChange,
  onRowClick = () => {},
  swipeEnabled = true,
}: {
  initialScope?: ChatScope;
  onScopeChange: (scope: ChatScope) => void;
  onRowClick?: (name: string) => void;
  swipeEnabled?: boolean;
}) {
  const [scope, setScope] = useState<ChatScope>(initialScope);
  return (
    <ThemeProvider theme={darkTheme}>
      {/* Stands in for a tap on the Groups / DMs switch. */}
      <button
        type="button"
        onClick={() => setScope(scope === 'groups' ? 'directs' : 'groups')}
      >
        switch
      </button>
      <MobileChatListPager
        swipeEnabled={swipeEnabled}
        scope={scope}
        onScopeChange={(next) => {
          onScopeChange(next);
          setScope(next);
        }}
        renderGroups={(beside) => (
          <div data-beside={String(beside)} data-testid="groups-list">
            <div data-pager-scroller="" data-testid="groups-scroller">
              <button type="button" onClick={() => onRowClick('Hikers')}>
                Hikers
              </button>
              <button
                type="button"
                data-pager-swipe-ignore=""
                onClick={() => onRowClick('Dragged')}
              >
                Dragged
              </button>
            </div>
          </div>
        )}
        renderDirects={(mounted) =>
          mounted ? (
            <div data-testid="directs-list">
              <button type="button" onClick={() => onRowClick('Alice')}>
                Alice
              </button>
            </div>
          ) : null
        }
      />
    </ThemeProvider>
  );
}

const nextFrame = () =>
  act(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  );

const page = (scope: ChatScope) =>
  document.querySelector(`[data-chat-list-page="${scope}"]`) as HTMLElement;
const track = () => page('groups').parentElement as HTMLElement;

describe('isChatListSwipeEnabled', () => {
  it('is on only for the visible full-screen home lists', () => {
    expect(
      isChatListSwipeEnabled({ inChatDetail: false, isVisible: true })
    ).toBe(true);
    // The list swiped in over an open chat (or covered by one).
    expect(
      isChatListSwipeEnabled({ inChatDetail: true, isVisible: true })
    ).toBe(false);
    expect(
      isChatListSwipeEnabled({ inChatDetail: false, isVisible: false })
    ).toBe(false);
  });
});

describe('MobileChatListPager', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    mockMatchMedia(() => false);
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: SCREEN,
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('switches to DMs on a right-to-left swipe, through the switch callback', () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);

    dragX(screen.getByText('Hikers'), 700, -400);

    expect(onScopeChange).toHaveBeenCalledTimes(1);
    expect(onScopeChange).toHaveBeenCalledWith('directs');
    // The track glides on to the DM page.
    expect(track().style.transform).toBe('translate3d(-1024px, 0, 0)');
    expect(track().style.transition).toContain('transform');
    expect(page('directs')).not.toHaveAttribute('inert');
    expect(page('groups')).toHaveAttribute('inert');
  });

  it('switches back to Groups on a left-to-right swipe', () => {
    const onScopeChange = vi.fn();
    render(<Harness initialScope="directs" onScopeChange={onScopeChange} />);

    dragX(screen.getByText('Alice'), 300, 400);

    expect(onScopeChange).toHaveBeenCalledWith('groups');
  });

  it('turns the page on a short quick flick', () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);

    swipe(screen.getByText('Hikers'), { x: 600, y: MID_Y }, [
      { x: 588, y: MID_Y },
      { x: 568, y: MID_Y },
      { x: 548, y: MID_Y },
    ]);

    expect(onScopeChange).toHaveBeenCalledWith('directs');
  });

  it('springs back from a short slow drag', () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);

    dragX(screen.getByText('Hikers'), 600, -150);

    expect(onScopeChange).not.toHaveBeenCalled();
    expect(track().style.transform).toBe('translate3d(0px, 0, 0)');
  });

  it('springs back from a quick short drag that rests before the lift', () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');

    // About 70px in 96ms (a flick's speed), then the finger rests: no
    // moves, and it lifts 800ms later.
    touchEvent('touchstart', row, [{ x: 600, y: MID_Y }], 0);
    for (let i = 1; i <= 6; i += 1) {
      touchEvent('touchmove', row, [{ x: 600 - 12 * i, y: MID_Y }], 16 * i);
    }
    lift(row, { x: 528, y: MID_Y }, 896);

    expect(onScopeChange).not.toHaveBeenCalled();
    expect(track().style.transform).toBe('translate3d(0px, 0, 0)');
  });

  it('turns the page for a long drag whose last moves flicked back before a rest', () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');

    touchEvent('touchstart', row, [{ x: 700, y: MID_Y }], 0);
    let t = 0;
    for (const x of [680, 600, 500, 400, 300]) {
      t += 16;
      touchEvent('touchmove', row, [{ x, y: MID_Y }], t);
    }
    // A pause, then a small quick move back...
    touchEvent('touchmove', row, [{ x: 315, y: MID_Y }], 320);
    touchEvent('touchmove', row, [{ x: 330, y: MID_Y }], 336);
    // ...and a rest before the lift: 350px from the lock at 680 (more than
    // 28% of the width), and no flick left to cancel it.
    lift(row, { x: 330, y: MID_Y }, 636);

    expect(onScopeChange).toHaveBeenCalledWith('directs');
  });

  it('follows the finger while dragging', async () => {
    render(<Harness onScopeChange={vi.fn()} />);
    const row = screen.getByText('Hikers');

    touchEvent('touchstart', row, [{ x: 700, y: MID_Y }], 0);
    touchEvent('touchmove', row, [{ x: 680, y: MID_Y }], 16);
    touchEvent('touchmove', row, [{ x: 560, y: MID_Y }], 32);
    await nextFrame();

    // 120px of finger travel since the drag locked at 680.
    expect(track().style.transform).toBe('translate3d(-120px, 0, 0)');
    expect(track().style.transition).toBe('none');
    touchEvent('touchend', row, [], 32);
  });

  it('rubber-bands and does nothing past the ends', async () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');

    // Groups is the leftmost page: dragging it right has nowhere to go.
    touchEvent('touchstart', row, [{ x: 300, y: MID_Y }], 0);
    touchEvent('touchmove', row, [{ x: 320, y: MID_Y }], 16);
    touchEvent('touchmove', row, [{ x: 700, y: MID_Y }], 600);
    await nextFrame();

    // 380px of pull moves the content only a little.
    const pulled = Number(
      /translate3d\(([-\d.]+)px/.exec(track().style.transform)?.[1]
    );
    expect(pulled).toBeGreaterThan(10);
    expect(pulled).toBeLessThan(48);
    touchEvent('touchend', row, [], 600);

    expect(onScopeChange).not.toHaveBeenCalled();
    expect(track().style.transform).toBe('translate3d(0px, 0, 0)');
  });

  it('leaves vertical drags to the list', () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');
    const before = track().style.transform;

    swipe(row, { x: 500, y: 200 }, [
      { x: 497, y: 215 },
      { x: 440, y: 260 },
      { x: 200, y: 300 },
    ]);

    expect(onScopeChange).not.toHaveBeenCalled();
    expect(track().style.transform).toBe(before);
  });

  it('gives up when the list scrolled under the finger', () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');
    const scroller = screen.getByTestId('groups-scroller');

    touchEvent('touchstart', row, [{ x: 600, y: MID_Y }], 0);
    touchEvent('touchmove', row, [{ x: 597, y: MID_Y + 3 }], 16);
    // The browser started scrolling before the axis was decided.
    setScrollTop(scroller, 6);
    touchEvent('touchmove', row, [{ x: 560, y: MID_Y + 4 }], 64);
    touchEvent('touchmove', row, [{ x: 100, y: MID_Y + 4 }], 80);
    lift(row, { x: 100, y: MID_Y + 4 }, 80);

    expect(onScopeChange).not.toHaveBeenCalled();
  });

  it('swipes when the touch catches a list still settling from a fling', () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');
    const scroller = screen.getByTestId('groups-scroller');
    setScrollTop(scroller, 400);

    touchEvent('touchstart', row, [{ x: 600, y: MID_Y }], 0);
    // The fling's last frames reach the page after the touch stopped it.
    setScrollTop(scroller, 430);
    touchEvent('touchmove', row, [{ x: 598, y: MID_Y }], 16);
    setScrollTop(scroller, 436);
    touchEvent('touchmove', row, [{ x: 580, y: MID_Y }], 32);
    dragOn(row, 580, -400, 32);

    expect(onScopeChange).toHaveBeenCalledWith('directs');
  });

  it('gives up when the list scrolls after the drag locked, not for a pixel', () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');
    const scroller = screen.getByTestId('groups-scroller');

    touchEvent('touchstart', row, [{ x: 700, y: MID_Y }], 0);
    touchEvent('touchmove', row, [{ x: 680, y: MID_Y }], 16);
    // Rounding: still a swipe.
    setScrollTop(scroller, 1);
    touchEvent('touchmove', row, [{ x: 600, y: MID_Y }], 32);
    expect(track().style.transition).toBe('none');
    // A real scroll: the gesture is the browser's.
    setScrollTop(scroller, 12);
    touchEvent('touchmove', row, [{ x: 300, y: MID_Y }], 48);
    lift(row, { x: 300, y: MID_Y }, 348);

    expect(onScopeChange).not.toHaveBeenCalled();
    expect(track().style.transform).toBe('translate3d(0px, 0, 0)');
  });

  it('ignores swipes that start at either screen edge', () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');

    dragX(row, SCREEN - 10, -600);
    dragX(row, 10, -5);
    expect(onScopeChange).not.toHaveBeenCalled();

    dragX(row, SCREEN - 30, -600);
    expect(onScopeChange).toHaveBeenCalledWith('directs');
  });

  it('ignores swipes on rows being dragged to reorder', () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);

    dragX(screen.getByText('Dragged'), 700, -500);

    expect(onScopeChange).not.toHaveBeenCalled();
  });

  it('leaves a press-and-hold (long-press menu) alone when it then slides', () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');

    touchEvent('touchstart', row, [{ x: 600, y: MID_Y }], 0);
    touchEvent('touchmove', row, [{ x: 603, y: MID_Y }], 300);
    // The menu opened at about 500ms; the finger then slides sideways.
    touchEvent('touchmove', row, [{ x: 560, y: MID_Y }], 650);
    touchEvent('touchmove', row, [{ x: 200, y: MID_Y }], 700);
    touchEvent('touchend', row, [], 700);

    expect(onScopeChange).not.toHaveBeenCalled();
    expect(track().style.transform).toBe('translate3d(0%, 0, 0)');
  });

  it('cancels on a second finger', () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');

    touchEvent('touchstart', row, [{ x: 700, y: MID_Y }], 0);
    touchEvent('touchmove', row, [{ x: 600, y: MID_Y }], 16);
    touchEvent(
      'touchstart',
      row,
      [
        { x: 600, y: MID_Y },
        { x: 300, y: 500 },
      ],
      32
    );
    touchEvent('touchmove', row, [{ x: 100, y: MID_Y }], 48);
    touchEvent('touchend', row, [], 48);

    expect(onScopeChange).not.toHaveBeenCalled();
  });

  it('never also clicks the row under the finger', () => {
    const onScopeChange = vi.fn();
    const onRowClick = vi.fn();
    render(<Harness onRowClick={onRowClick} onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');

    dragX(row, 600, -150);
    act(() => {
      row.click();
    });
    expect(onRowClick).not.toHaveBeenCalled();

    // Nor a tap on the pages still gliding after the drag.
    touchEvent('touchstart', row, [{ x: 600, y: MID_Y }], 1400);
    lift(row, { x: 600, y: MID_Y }, 1460);
    act(() => {
      row.click();
    });
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('catches the pages mid-glide and swipes straight back', async () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);

    dragX(screen.getByText('Hikers'), 700, -400);
    expect(onScopeChange).toHaveBeenLastCalledWith('directs');

    // Halfway to the DM page when the finger comes down again.
    const getComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) =>
      element === track()
        ? ({ transform: 'matrix(1, 0, 0, 1, -512, 0)' } as CSSStyleDeclaration)
        : getComputedStyle(element)
    );
    const alice = screen.getByText('Alice');
    touchEvent('touchstart', alice, [{ x: 300, y: MID_Y }], 2000);
    touchEvent('touchmove', alice, [{ x: 320, y: MID_Y }], 2016);
    // Caught where it was, not snapped to either page.
    expect(track().style.transform).toBe('translate3d(-512px, 0, 0)');
    expect(track().style.transition).toBe('none');
    touchEvent('touchmove', alice, [{ x: 400, y: MID_Y }], 2032);
    await nextFrame();
    expect(track().style.transform).toBe('translate3d(-432px, 0, 0)');
    lift(alice, { x: 400, y: MID_Y }, 2332);

    expect(onScopeChange).toHaveBeenLastCalledWith('groups');
    expect(track().style.transform).toBe('translate3d(0px, 0, 0)');
  });

  it('leaves taps alone', () => {
    const onScopeChange = vi.fn();
    const onRowClick = vi.fn();
    render(<Harness onRowClick={onRowClick} onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');

    touchEvent('touchstart', row, [{ x: 600, y: MID_Y }], 0);
    touchEvent('touchmove', row, [{ x: 603, y: MID_Y + 2 }], 40);
    touchEvent('touchend', row, [], 80);
    act(() => {
      row.click();
    });

    expect(onScopeChange).not.toHaveBeenCalled();
    expect(onRowClick).toHaveBeenCalledWith('Hikers');
  });

  it('does nothing over an open chat, where only the current list shows', () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} swipeEnabled={false} />);

    dragX(screen.getByText('Hikers'), 600, -500);

    expect(onScopeChange).not.toHaveBeenCalled();
    expect(track().style.transform).toBe('');
    expect(page('directs')).toHaveStyle({ display: 'none' });
    expect(screen.queryByTestId('directs-list')).toBeNull();
    expect(page('groups')).toHaveStyle({ display: 'flex' });
  });

  it('builds the other list beside this one once the phone is idle', () => {
    vi.useFakeTimers();
    render(<Harness onScopeChange={vi.fn()} />);

    expect(screen.queryByTestId('directs-list')).toBeNull();
    expect(page('directs')).toHaveStyle({ visibility: 'hidden' });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByTestId('directs-list')).toBeInTheDocument();
    expect(page('directs')).toHaveStyle({
      display: 'flex',
      visibility: 'visible',
    });
    expect(page('directs')).toHaveAttribute('inert');
    expect(screen.getByTestId('groups-list')).toHaveAttribute(
      'data-beside',
      'true'
    );
  });

  it('rests on the DM page with the Groups page still in its place', () => {
    render(<Harness initialScope="directs" onScopeChange={vi.fn()} />);

    // Not built yet, but laid out: the track's -100% lands on DMs.
    expect(track().style.transform).toBe('translate3d(-100%, 0, 0)');
    expect(page('groups')).toHaveStyle({
      display: 'flex',
      visibility: 'hidden',
    });
    expect(page('directs')).toHaveStyle({
      display: 'flex',
      visibility: 'visible',
    });
    expect(screen.getByTestId('groups-list')).toHaveAttribute(
      'data-beside',
      'false'
    );
  });

  it('builds the other list at once when a swipe beats the warm-up', () => {
    render(<Harness onScopeChange={vi.fn()} />);
    const row = screen.getByText('Hikers');

    touchEvent('touchstart', row, [{ x: 600, y: MID_Y }], 0);
    touchEvent('touchmove', row, [{ x: 580, y: MID_Y }], 16);

    expect(screen.getByTestId('directs-list')).toBeInTheDocument();
    touchEvent('touchend', row, [], 16);
  });

  it('slides when the switch changes the list', () => {
    vi.useFakeTimers();
    const onRowClick = vi.fn();
    render(<Harness onRowClick={onRowClick} onScopeChange={vi.fn()} />);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      screen.getByText('switch').click();
    });

    expect(track().style.transform).toBe('translate3d(-1024px, 0, 0)');
    expect(track().style.transition).toContain('260ms');
    // A row tapped straight after the switch opens, as before the slide.
    const alice = screen.getByText('Alice');
    touchEvent('touchstart', alice, [{ x: 500, y: MID_Y }], 100);
    lift(alice, { x: 500, y: MID_Y }, 160);
    act(() => {
      alice.click();
    });
    expect(onRowClick).toHaveBeenCalledWith('Alice');

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(track().style.transform).toBe('translate3d(-100%, 0, 0)');
  });

  it('switches without motion under prefers-reduced-motion', () => {
    mockMatchMedia((query) => query.includes('prefers-reduced-motion'));
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');

    touchEvent('touchstart', row, [{ x: 700, y: MID_Y }], 0);
    touchEvent('touchmove', row, [{ x: 650, y: MID_Y }], 16);
    touchEvent('touchmove', row, [{ x: 300, y: MID_Y }], 400);
    // The content did not follow the finger.
    expect(track().style.transform).toBe('translate3d(0%, 0, 0)');
    touchEvent('touchend', row, [], 700);

    expect(onScopeChange).toHaveBeenCalledWith('directs');
    expect(track().style.transform).toBe('translate3d(-100%, 0, 0)');
    expect(track().style.transition).toBe('none');
  });
});
