import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImmersiveMode } from './immersiveMode';
import type { ImmersiveTouchEvent } from './immersiveNative';
import {
  IMMERSIVE_REVEAL_MS,
  useImmersiveBars,
  type ImmersiveBars,
} from './useImmersiveBars';

const native = vi.hoisted(() => ({
  statusBar: [] as boolean[],
  touch: null as ((event: ImmersiveTouchEvent) => void) | null,
}));

vi.mock('./immersiveNative', () => ({
  setImmersiveStatusBarHidden: (hidden: boolean) => {
    native.statusBar.push(hidden);
  },
  listenImmersiveTouches: (listener: (event: ImmersiveTouchEvent) => void) => {
    native.touch = listener;
    return () => {
      if (native.touch === listener) native.touch = null;
    };
  },
}));

let bars: ImmersiveBars;

const Harness = ({
  mode,
  eligible = true,
  surfaceKey = 'home',
  holdOpen = false,
  hideStatusBar = false,
  forceHidden = false,
}: {
  mode: ImmersiveMode;
  eligible?: boolean;
  surfaceKey?: string;
  holdOpen?: boolean;
  hideStatusBar?: boolean;
  forceHidden?: boolean;
}) => {
  bars = useImmersiveBars({
    mode,
    eligible,
    surfaceKey,
    holdOpen,
    hideStatusBar,
    forceHidden,
  });
  return (
    <div>
      <div ref={bars.topBarRef}>
        <div>
          <button>bar button</button>
          <input aria-label="address" />
        </div>
      </div>
      <div ref={bars.contentRef} data-testid="content">
        <div data-testid="scroller">content</div>
      </div>
      <div ref={bars.tabBarRef}>
        <button>tab</button>
      </div>
    </div>
  );
};

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** A user scroll of the big list: touch down, move, scroll events. */
const userScroll = (deltas: number[]) => {
  const scroller = screen.getByTestId('scroller');
  fireEvent.pointerDown(scroller);
  let top = scroller.scrollTop;
  for (const delta of deltas) {
    top += delta;
    scroller.scrollTop = top;
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
  }
  fireEvent.pointerUp(scroller);
};

describe('useImmersiveBars', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'],
    });
    native.statusBar = [];
    native.touch = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Off leaves everything as it was', () => {
    render(<Harness mode="off" />);
    expect(bars.active).toBe(false);
    expect(bars.barsShown).toBe(true);
    expect(native.statusBar).not.toContain(true);
    expect(native.touch).toBeNull();
  });

  it('Manual tucks the bars away and hides the status bar', () => {
    render(<Harness mode="manual" />);
    expect(native.statusBar[native.statusBar.length - 1]).toBe(true);
    advance(150);
    expect(bars.barsShown).toBe(false);
    expect(bars.layoutShown).toBe(false);
  });

  it('the button brings the bars back for a few seconds', () => {
    render(<Harness mode="manual" />);
    advance(150);
    act(() => bars.reveal());
    expect(bars.barsShown).toBe(true);
    expect(bars.layoutShown).toBe(true);
    advance(IMMERSIVE_REVEAL_MS - 100);
    expect(bars.barsShown).toBe(true);
    advance(200);
    expect(bars.barsShown).toBe(false);
  });

  it('using the bars keeps them out; tapping the content puts them away', () => {
    render(<Harness mode="manual" />);
    advance(150);
    act(() => bars.reveal());
    advance(3000);
    fireEvent.pointerDown(screen.getByText('tab'));
    advance(3000);
    expect(bars.barsShown).toBe(true);
    fireEvent.pointerDown(screen.getByTestId('scroller'));
    expect(bars.barsShown).toBe(false);
  });

  it('holds the bars while something opened from them is showing', () => {
    const { rerender } = render(<Harness mode="manual" />);
    advance(150);
    act(() => bars.reveal());
    rerender(<Harness mode="manual" holdOpen />);
    advance(IMMERSIVE_REVEAL_MS * 3);
    expect(bars.barsShown).toBe(true);
    rerender(<Harness mode="manual" />);
    advance(IMMERSIVE_REVEAL_MS + 100);
    expect(bars.barsShown).toBe(false);
  });

  it('Auto hides on scroll down and shows on scroll up', () => {
    render(<Harness mode="auto" />);
    const scroller = screen.getByTestId('scroller');
    Object.defineProperty(scroller, 'clientHeight', { value: 600 });
    scroller.scrollTop = 400;
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
    expect(bars.barsShown).toBe(true);
    userScroll([15, 15, 15]);
    expect(bars.barsShown).toBe(false);
    advance(500); // past the quiet time after a change
    userScroll([-10, -10, -10]);
    expect(bars.barsShown).toBe(true);
    // Shown by scrolling: no timer.
    advance(IMMERSIVE_REVEAL_MS * 2);
    expect(bars.barsShown).toBe(true);
  });

  it('a tab button left focused does not hold the bars (Explore)', () => {
    render(<Harness mode="auto" />);
    const scroller = screen.getByTestId('scroller');
    Object.defineProperty(scroller, 'clientHeight', { value: 600 });
    screen.getByText('tab').focus();
    expect(document.activeElement).toBe(screen.getByText('tab'));
    userScroll([0, 20, 20, 20]);
    expect(bars.barsShown).toBe(false);
  });

  it('typing in the address field holds the bars', () => {
    render(<Harness mode="auto" />);
    const scroller = screen.getByTestId('scroller');
    Object.defineProperty(scroller, 'clientHeight', { value: 600 });
    screen.getByLabelText('address').focus();
    userScroll([0, 20, 20, 20]);
    expect(bars.barsShown).toBe(true);
  });

  it('ignores small inner lists and scrolling nobody did', () => {
    render(<Harness mode="auto" />);
    const scroller = screen.getByTestId('scroller');
    let height = 40;
    Object.defineProperty(scroller, 'clientHeight', { get: () => height });
    userScroll([0, 20, 20, 20]);
    expect(bars.barsShown).toBe(true);

    height = 600;
    advance(3000);
    // A list loading more and moving by itself.
    for (const top of [100, 140, 180]) {
      scroller.scrollTop = top;
      act(() => {
        scroller.dispatchEvent(new Event('scroll'));
      });
    }
    expect(bars.barsShown).toBe(true);
  });

  it('follows finger drags over a Q-App frame', () => {
    render(<Harness mode="auto" />);
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const original = document.elementFromPoint;
    document.elementFromPoint = () => frame;
    try {
      expect(native.touch).not.toBeNull();
      act(() => native.touch?.({ phase: 'down', x: 100, y: 300 }));
      act(() => native.touch?.({ phase: 'drag', direction: 'up' }));
      expect(bars.barsShown).toBe(false);
      advance(500);
      act(() => native.touch?.({ phase: 'drag', direction: 'down' }));
      expect(bars.barsShown).toBe(true);
    } finally {
      document.elementFromPoint = original;
      frame.remove();
    }
  });

  it('moves the bars for a drag at once, not after other queued work', () => {
    render(<Harness mode="auto" />);
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const original = document.elementFromPoint;
    document.elementFromPoint = () => frame;
    try {
      act(() => native.touch?.({ phase: 'down', x: 100, y: 300 }));
      act(() => {
        native.touch?.({ phase: 'drag', direction: 'up' });
        // Rendered before the touch's own handler returns.
        expect(bars.barsShown).toBe(false);
        expect(bars.layoutShown).toBe(false);
      });
      advance(500);
      act(() => {
        native.touch?.({ phase: 'drag', direction: 'down' });
        expect(bars.barsShown).toBe(true);
      });
    } finally {
      document.elementFromPoint = original;
      frame.remove();
    }
  });

  it('drags outside a frame are left to the page scroll', () => {
    render(<Harness mode="auto" />);
    const original = document.elementFromPoint;
    document.elementFromPoint = () => screen.getByTestId('scroller');
    try {
      act(() => native.touch?.({ phase: 'down', x: 100, y: 300 }));
      act(() => native.touch?.({ phase: 'drag', direction: 'up' }));
      expect(bars.barsShown).toBe(true);
    } finally {
      document.elementFromPoint = original;
    }
  });

  it('can hide the status bar where the bars stay (Q-Apps library)', () => {
    render(<Harness mode="auto" eligible={false} hideStatusBar />);
    expect(bars.active).toBe(false);
    expect(bars.barsShown).toBe(true);
    expect(native.statusBar[native.statusBar.length - 1]).toBe(true);
  });

  it("a Q-App's full screen hides the bars even with the setting Off", () => {
    const { rerender } = render(<Harness mode="off" />);
    expect(bars.active).toBe(false);
    rerender(<Harness mode="off" forceHidden />);
    expect(bars.active).toBe(true);
    expect(bars.forced).toBe(true);
    expect(bars.barsShown).toBe(false);
    expect(native.statusBar[native.statusBar.length - 1]).toBe(true);
    // Nothing brings them back while it lasts.
    act(() => bars.reveal());
    expect(bars.barsShown).toBe(false);
    // It ends: the bars glide back, then the setting (Off) takes over.
    rerender(<Harness mode="off" />);
    expect(bars.barsShown).toBe(true);
    expect(bars.active).toBe(true);
    advance(600);
    expect(bars.active).toBe(false);
    expect(native.statusBar[native.statusBar.length - 1]).toBe(false);
  });

  it('Manual keeps the bars away after an app full screen ends', () => {
    const { rerender } = render(<Harness mode="manual" forceHidden />);
    expect(bars.barsShown).toBe(false);
    rerender(<Harness mode="manual" />);
    advance(300);
    expect(bars.barsShown).toBe(false);
    expect(bars.active).toBe(true);
  });

  it('Chat (not eligible) keeps the bars and the status bar', () => {
    const { rerender } = render(<Harness mode="manual" />);
    advance(150);
    expect(bars.barsShown).toBe(false);
    rerender(<Harness mode="manual" eligible={false} surfaceKey="chat" />);
    expect(bars.active).toBe(false);
    expect(bars.barsShown).toBe(true);
    expect(bars.layoutShown).toBe(true);
    expect(native.statusBar[native.statusBar.length - 1]).toBe(false);
  });

  it('Auto greets a new screen with the bars', () => {
    const { rerender } = render(<Harness mode="auto" />);
    const scroller = screen.getByTestId('scroller');
    Object.defineProperty(scroller, 'clientHeight', { value: 600 });
    scroller.scrollTop = 300;
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
    userScroll([20, 20]);
    expect(bars.barsShown).toBe(false);
    rerender(<Harness mode="auto" surfaceKey="apps" />);
    expect(bars.barsShown).toBe(true);
  });
});
