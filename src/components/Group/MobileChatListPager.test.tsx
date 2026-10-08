import { act, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { useState, type ReactNode, type Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { darkTheme } from '../../styles/theme-dark';
import type { ChatScope } from './ChatScopeSwitch';
import { isHorizontalGestureClaimed } from '../../hooks/horizontalGestureClaim';
import {
  MobileChatListPager,
  isChatListSwipeEnabled,
  type MobileChatListPagerHandle,
} from './MobileChatListPager';
import { createRef } from 'react';

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
  header,
  initialScope = 'groups',
  onScopeChange,
  onRowClick = () => {},
  onTrackPosition,
  pagerRef,
  parentDelayMs,
  swipeEnabled = true,
}: {
  header?: ReactNode;
  /** How long the parent takes to switch after it is asked (null: never). */
  parentDelayMs?: number | null;
  pagerRef?: Ref<MobileChatListPagerHandle>;
  initialScope?: ChatScope;
  onScopeChange: (scope: ChatScope) => void;
  onRowClick?: (name: string) => void;
  onTrackPosition?: (
    position: number,
    durationMs: number,
    easing: string
  ) => void;
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
        ref={pagerRef}
        swipeEnabled={swipeEnabled}
        scope={scope}
        onScopeChange={(next) => {
          onScopeChange(next);
          if (parentDelayMs === undefined) setScope(next);
          else if (parentDelayMs !== null) {
            window.setTimeout(() => setScope(next), parentDelayMs);
          }
        }}
        onTrackPosition={onTrackPosition}
        header={header}
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

/** A released swipe tells the parent once its glide is on screen: after
 * the next frame. */
const afterGlideStarts = () =>
  act(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => window.setTimeout(resolve, 0))
      )
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

  it('switches to DMs on a right-to-left swipe, through the switch callback', async () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);

    dragX(screen.getByText('Hikers'), 700, -400);

    await afterGlideStarts();
    expect(onScopeChange).toHaveBeenCalledTimes(1);
    expect(onScopeChange).toHaveBeenCalledWith('directs');
    // The track glides on to the DM page.
    expect(track().style.transform).toBe('translate3d(-1024px, 0, 0)');
    expect(track().style.transition).toContain('transform');
    expect(page('directs')).not.toHaveAttribute('inert');
    expect(page('groups')).toHaveAttribute('inert');
  });

  it('switches back to Groups on a left-to-right swipe', async () => {
    const onScopeChange = vi.fn();
    render(<Harness initialScope="directs" onScopeChange={onScopeChange} />);

    dragX(screen.getByText('Alice'), 300, 400);

    await afterGlideStarts();
    expect(onScopeChange).toHaveBeenCalledWith('groups');
  });

  it('turns the page on a short quick flick', async () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);

    swipe(screen.getByText('Hikers'), { x: 600, y: MID_Y }, [
      { x: 588, y: MID_Y },
      { x: 568, y: MID_Y },
      { x: 548, y: MID_Y },
    ]);

    await afterGlideStarts();
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

  it('turns the page for a long drag whose last moves flicked back before a rest', async () => {
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

    await afterGlideStarts();
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

  it('leaves a swipe past the ends to the section swipe', async () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');
    const before = track().style.transform;

    // Groups is the leftmost page: dragging it right is the section swipe's
    // (on to Apps), so the pager neither moves nor claims it.
    touchEvent('touchstart', row, [{ x: 300, y: MID_Y }], 7000);
    touchEvent('touchmove', row, [{ x: 320, y: MID_Y }], 7016);
    touchEvent('touchmove', row, [{ x: 700, y: MID_Y }], 7600);
    await nextFrame();
    expect(track().style.transform).toBe(before);
    expect(isHorizontalGestureClaimed(7000)).toBe(false);
    touchEvent('touchend', row, [], 7600);

    expect(onScopeChange).not.toHaveBeenCalled();
    expect(track().style.transform).toBe(before);
  });

  it('claims the swipes it takes', () => {
    render(<Harness onScopeChange={vi.fn()} />);
    const row = screen.getByText('Hikers');
    touchEvent('touchstart', row, [{ x: 500, y: MID_Y }], 8000);
    touchEvent('touchmove', row, [{ x: 480, y: MID_Y }], 8016);
    expect(isHorizontalGestureClaimed(8000)).toBe(true);
    touchEvent('touchend', row, [], 8100);
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

  it('swipes when the touch catches a list still settling from a fling', async () => {
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

    await afterGlideStarts();
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

  it('ignores swipes that start at either screen edge', async () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');

    dragX(row, SCREEN - 10, -600);
    dragX(row, 10, -5);
    await afterGlideStarts();
    expect(onScopeChange).not.toHaveBeenCalled();

    dragX(row, SCREEN - 30, -600);
    await afterGlideStarts();
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
  });

  it('lands the pages for a tap while they still glide, and opens the row', () => {
    const onScopeChange = vi.fn();
    const onRowClick = vi.fn();
    render(<Harness onRowClick={onRowClick} onScopeChange={onScopeChange} />);
    const row = screen.getByText('Hikers');

    // A short drag: the pages glide back.
    dragX(row, 600, -150);
    expect(track().style.transition).toContain('transform');

    // A tap before they are still: they land, and the tap counts.
    touchEvent('touchstart', row, [{ x: 600, y: MID_Y }], 1400);
    lift(row, { x: 600, y: MID_Y }, 1460);
    expect(track().style.transition).toBe('none');
    expect(track().style.transform).toBe('translate3d(0%, 0, 0)');
    act(() => {
      row.click();
    });
    expect(onRowClick).toHaveBeenCalledWith('Hikers');
    expect(onScopeChange).not.toHaveBeenCalled();
  });

  it('switches at once for a tap on the DMs before the switch to them has rendered', () => {
    vi.useFakeTimers();
    const onScopeChange = vi.fn();
    const onRowClick = vi.fn();
    render(<Harness onRowClick={onRowClick} onScopeChange={onScopeChange} />);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    dragX(screen.getByText('Hikers'), 700, -400);
    // Gliding to the DMs; the parent is not asked yet, so they are inert.
    expect(onScopeChange).not.toHaveBeenCalled();
    expect(page('directs')).toHaveAttribute('inert');

    const alice = screen.getByText('Alice');
    touchEvent('touchstart', alice, [{ x: 300, y: MID_Y }], 2000);
    lift(alice, { x: 300, y: MID_Y }, 2060);
    // Landed and switched before the tap's click.
    expect(onScopeChange).toHaveBeenCalledWith('directs');
    expect(track().style.transform).toBe('translate3d(-100%, 0, 0)');
    expect(page('directs')).not.toHaveAttribute('inert');
    act(() => {
      alice.click();
    });
    expect(onRowClick).toHaveBeenCalledWith('Alice');

    // The ask that was waiting for the glide is not sent again.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onScopeChange).toHaveBeenCalledTimes(1);
    expect(track().style.transform).toBe('translate3d(-100%, 0, 0)');
  });

  it('catches the pages mid-glide and swipes straight back', async () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);

    dragX(screen.getByText('Hikers'), 700, -400);
    await afterGlideStarts();
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
    await afterGlideStarts();

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

  it('switches without motion under prefers-reduced-motion', async () => {
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

    await afterGlideStarts();
    expect(onScopeChange).toHaveBeenCalledWith('directs');
    expect(track().style.transform).toBe('translate3d(-100%, 0, 0)');
    expect(track().style.transition).toBe('none');
  });
  it('reports where the pages are while dragging and gliding', async () => {
    const onTrackPosition = vi.fn();
    render(
      <Harness onScopeChange={vi.fn()} onTrackPosition={onTrackPosition} />
    );
    const row = screen.getByText('Hikers');
    onTrackPosition.mockClear();

    touchEvent('touchstart', row, [{ x: 700, y: MID_Y }], 0);
    touchEvent('touchmove', row, [{ x: 680, y: MID_Y }], 16);
    touchEvent('touchmove', row, [{ x: 168, y: MID_Y }], 32);
    await nextFrame();
    // Half a screen of travel since the lock: halfway to DMs, at once.
    expect(onTrackPosition).toHaveBeenLastCalledWith(
      0.5,
      0,
      expect.any(String)
    );

    lift(row, { x: 168, y: MID_Y }, 48);
    const [position, durationMs, easing] =
      onTrackPosition.mock.calls[onTrackPosition.mock.calls.length - 1];
    expect(position).toBe(1);
    expect(durationMs).toBeGreaterThan(0);
    expect(easing).toContain('cubic-bezier');
  });

  it('reports a tap on the switch as a glide to the other page', () => {
    vi.useFakeTimers();
    const onTrackPosition = vi.fn();
    render(
      <Harness onScopeChange={vi.fn()} onTrackPosition={onTrackPosition} />
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });
    onTrackPosition.mockClear();

    act(() => {
      screen.getByText('switch').click();
    });

    expect(onTrackPosition.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [0, 0],
      [1, 260],
    ]);
  });

  it('still glides the header over an open chat, where the lists only swap', () => {
    const onTrackPosition = vi.fn();
    render(
      <Harness
        onScopeChange={vi.fn()}
        onTrackPosition={onTrackPosition}
        swipeEnabled={false}
      />
    );
    expect(onTrackPosition).toHaveBeenLastCalledWith(0, 0, expect.any(String));

    act(() => {
      screen.getByText('switch').click();
    });

    expect(onTrackPosition).toHaveBeenLastCalledWith(
      1,
      260,
      expect.any(String)
    );
    // The lists themselves do not move.
    expect(track().style.transform).toBe('');
  });
  it('keeps the header still and lets a swipe on it move the pages', async () => {
    const onScopeChange = vi.fn();
    render(
      <Harness
        onScopeChange={onScopeChange}
        header={<div data-testid="header">Groups | DMs</div>}
      />
    );
    const header = screen.getByTestId('header');
    // Above the track, not on it: only the lists slide.
    expect(track().contains(header)).toBe(false);

    dragX(header, 700, -400);

    await afterGlideStarts();
    expect(onScopeChange).toHaveBeenCalledWith('directs');
    expect(header.style.transform).toBe('');
  });

  it('shows the DM list under an open group chat for a swipe towards it', () => {
    const ref = createRef<MobileChatListPagerHandle>();
    const onTrackPosition = vi.fn();
    render(
      <ThemeProvider theme={darkTheme}>
        <MobileChatListPager
          ref={ref}
          swipeEnabled={false}
          scope="groups"
          onScopeChange={vi.fn()}
          onTrackPosition={onTrackPosition}
          renderGroups={() => <div>Hikers</div>}
          renderDirects={(mounted) =>
            mounted ? <div data-testid="directs-list">Alice</div> : null
          }
        />
      </ThemeProvider>
    );
    // A chat covers the lists: only Groups, and the DM list not built.
    expect(page('directs')).toHaveStyle({ display: 'none' });
    expect(screen.queryByTestId('directs-list')).toBeNull();

    act(() => ref.current?.preview('directs'));
    expect(screen.getByTestId('directs-list')).toBeInTheDocument();
    expect(page('directs')).toHaveStyle({ display: 'flex' });
    expect(page('groups')).toHaveStyle({ display: 'none' });
    expect(onTrackPosition).toHaveBeenLastCalledWith(1, 0, expect.any(String));

    act(() => ref.current?.preview(null));
    expect(page('groups')).toHaveStyle({ display: 'flex' });
    expect(page('directs')).toHaveStyle({ display: 'none' });
    expect(onTrackPosition).toHaveBeenLastCalledWith(0, 0, expect.any(String));
  });
  it('glides on before it tells the parent, which would hold the first frame back', async () => {
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} />);

    dragX(screen.getByText('Hikers'), 700, -400);
    // Already on its way...
    expect(track().style.transform).toBe('translate3d(-1024px, 0, 0)');
    expect(track().style.transition).toContain('transform');
    // ...and the switch (a re-render of the whole chat) waits for its frame.
    expect(onScopeChange).not.toHaveBeenCalled();

    await afterGlideStarts();
    expect(onScopeChange).toHaveBeenCalledTimes(1);
    expect(onScopeChange).toHaveBeenCalledWith('directs');
    // Taking the page does not restart the glide.
    expect(track().style.transform).toBe('translate3d(-1024px, 0, 0)');
  });

  it('glides at once for a tap on the switch, then switches', async () => {
    vi.useFakeTimers();
    const pagerRef = createRef<MobileChatListPagerHandle>();
    const onScopeChange = vi.fn();
    const onTrackPosition = vi.fn();
    render(
      <Harness
        onScopeChange={onScopeChange}
        onTrackPosition={onTrackPosition}
        pagerRef={pagerRef}
      />
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });
    onTrackPosition.mockClear();

    act(() => pagerRef.current?.slideTo('directs'));
    expect(track().style.transform).toBe('translate3d(-1024px, 0, 0)');
    expect(track().style.transition).toContain('260ms');
    expect(onTrackPosition.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [0, 0],
      [1, 260],
    ]);
    expect(onScopeChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(onScopeChange).toHaveBeenCalledTimes(1);
    expect(onScopeChange).toHaveBeenCalledWith('directs');
    expect(page('directs')).not.toHaveAttribute('inert');
    // The header got one glide, not a second one for the switch.
    expect(onTrackPosition).toHaveBeenCalledTimes(2);

    // A tap on the list already showing does nothing.
    act(() => pagerRef.current?.slideTo('directs'));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onScopeChange).toHaveBeenCalledTimes(1);
    expect(track().style.transform).toBe('translate3d(-100%, 0, 0)');
  });

  it('just switches for a tap when the other list is not built yet', () => {
    const pagerRef = createRef<MobileChatListPagerHandle>();
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} pagerRef={pagerRef} />);

    act(() => pagerRef.current?.slideTo('directs'));

    expect(onScopeChange).toHaveBeenCalledWith('directs');
    expect(track().style.transform).toBe('translate3d(-100%, 0, 0)');
  });

  it('just switches for a tap over an open chat', () => {
    const pagerRef = createRef<MobileChatListPagerHandle>();
    const onScopeChange = vi.fn();
    render(
      <Harness
        onScopeChange={onScopeChange}
        pagerRef={pagerRef}
        swipeEnabled={false}
      />
    );

    act(() => pagerRef.current?.slideTo('directs'));

    expect(onScopeChange).toHaveBeenCalledWith('directs');
    expect(page('directs')).toHaveStyle({ display: 'flex' });
    expect(page('groups')).toHaveStyle({ display: 'none' });
  });

  it('waits for a parent slow to switch instead of gliding back', () => {
    vi.useFakeTimers();
    const onTrackPosition = vi.fn();
    render(
      <Harness
        onScopeChange={vi.fn()}
        onTrackPosition={onTrackPosition}
        parentDelayMs={900}
      />
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });
    onTrackPosition.mockClear();

    dragX(screen.getByText('Hikers'), 700, -400);
    // The glide is long over before the parent switches...
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(track().style.transform).toBe('translate3d(-100%, 0, 0)');
    expect(page('directs')).toHaveAttribute('inert');
    // ...which it does a little later.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(page('directs')).not.toHaveAttribute('inert');
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(track().style.transform).toBe('translate3d(-100%, 0, 0)');
    const positions = onTrackPosition.mock.calls.map((call) => call[0]);
    expect(positions[positions.length - 1]).toBe(1);
    expect(positions).not.toContain(0);
  });

  it('goes back to the page the parent shows when it never switches', () => {
    vi.useFakeTimers();
    const onScopeChange = vi.fn();
    render(<Harness onScopeChange={onScopeChange} parentDelayMs={null} />);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    dragX(screen.getByText('Hikers'), 700, -400);
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(onScopeChange).toHaveBeenCalledWith('directs');
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(track().style.transform).toBe('translate3d(0%, 0, 0)');
    expect(page('groups')).not.toHaveAttribute('inert');
  });
});
