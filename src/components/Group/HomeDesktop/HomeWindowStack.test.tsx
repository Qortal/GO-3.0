import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, createTheme } from '@mui/material';
import {
  HOME_WINDOW_ATTR,
  HOME_WINDOW_LONG_PRESS_MS,
  HomeWindowStack,
  type HomeWindow,
} from './HomeWindowStack';
import {
  STRIP_GAP_PX,
  STRIP_HEIGHT_PX,
  arrangeWithHeld,
  compactStackLayout,
  heldTargetIndex,
} from './homeWindowStackLayout';
import type { HomeWindowId } from './homeLayout';

describe('compact stack layout', () => {
  it('puts the held strip under the finger when there is room', () => {
    const layout = compactStackLayout({
      count: 5,
      heldIndex: 2,
      fingerY: 400,
      minTop: 0,
      maxBottom: 800,
    });
    expect(layout.tileHeight).toBe(STRIP_HEIGHT_PX);
    const heldTop = layout.stackTop + 2 * layout.pitch;
    expect(heldTop + layout.tileHeight / 2).toBe(400);
  });

  it('keeps the stack on screen and shrinks strips that do not fit', () => {
    const atTop = compactStackLayout({
      count: 5,
      heldIndex: 4,
      fingerY: 50,
      minTop: 20,
      maxBottom: 800,
    });
    expect(atTop.stackTop).toBe(20);
    const crowded = compactStackLayout({
      count: 9,
      heldIndex: 0,
      fingerY: 100,
      minTop: 0,
      maxBottom: 500,
    });
    expect(crowded.tileHeight).toBeLessThan(STRIP_HEIGHT_PX);
    expect(9 * crowded.tileHeight + 8 * STRIP_GAP_PX).toBeLessThanOrEqual(500);
  });

  it('finds the slot under the held strip and moves the held one there', () => {
    expect(heldTargetIndex(-80, 0, 64, 5)).toBe(0);
    expect(heldTargetIndex(140, 0, 64, 5)).toBe(2);
    expect(heldTargetIndex(9000, 0, 64, 5)).toBe(4);
    expect(arrangeWithHeld(['a', 'b', 'c', 'd'], 'd', 0)).toEqual([
      'd',
      'a',
      'b',
      'c',
    ]);
    expect(arrangeWithHeld(['a', 'b', 'c', 'd'], 'a', 2)).toEqual([
      'b',
      'c',
      'a',
      'd',
    ]);
  });
});

const IDS: HomeWindowId[] = ['workspace', 'account', 'status', 'wallet'];
const WINDOW_HEIGHT = 300;
const WINDOW_GAP = 20;

const windows = (ids = IDS): HomeWindow[] =>
  ids.map((id) => ({
    id,
    icon: null,
    label: id,
    node: (
      <div data-testid={`window-${id}`}>
        <span data-testid={`text-${id}`}>{id}</span>
        <button data-testid={`button-${id}`} type="button">
          open
        </button>
      </div>
    ),
  }));

/** Windows laid out one under the other (jsdom has no layout). */
const layOut = (container: HTMLElement) => {
  const elements = Array.from(
    container.querySelectorAll<HTMLElement>(`[${HOME_WINDOW_ATTR}]`)
  );
  elements.forEach((element, index) => {
    element.getBoundingClientRect = () =>
      ({
        top: index * (WINDOW_HEIGHT + WINDOW_GAP),
        bottom: index * (WINDOW_HEIGHT + WINDOW_GAP) + WINDOW_HEIGHT,
        height: WINDOW_HEIGHT,
        left: 12,
        right: 372,
        width: 360,
        x: 12,
        y: index * (WINDOW_HEIGHT + WINDOW_GAP),
        toJSON: () => null,
      }) as DOMRect;
  });
};

const touch = (
  type: string,
  target: EventTarget,
  y: number,
  remaining = type === 'touchend' ? 0 : 1
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: 180, clientY: y, target };
  Object.defineProperty(event, 'touches', {
    value: Array.from({ length: remaining }, () => point),
  });
  Object.defineProperty(event, 'changedTouches', { value: [point] });
  act(() => {
    target.dispatchEvent(event);
  });
};

const strips = () =>
  Array.from(
    document.body.querySelectorAll<HTMLElement>(
      '[data-home-reorder-overlay] > *'
    )
  );

describe('HomeWindowStack', () => {
  let scroller: HTMLDivElement;
  let onReorder = vi.fn();

  beforeEach(() => {
    onReorder = vi.fn();
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    });
    scroller = document.createElement('div');
    scroller.getBoundingClientRect = () =>
      ({ top: 0, bottom: 800, height: 800, left: 0, width: 384 }) as DOMRect;
    document.body.appendChild(scroller);
  });

  afterEach(() => {
    scroller.remove();
    vi.useRealTimers();
  });

  const renderStack = (ids = IDS) => {
    const utils = render(
      <ThemeProvider theme={createTheme()}>
        <HomeWindowStack
          gap={WINDOW_GAP}
          onReorder={onReorder}
          scroller={scroller}
          windows={windows(ids)}
        />
      </ThemeProvider>
    );
    layOut(utils.container);
    return utils;
  };

  const longPress = (target: Element, y: number) => {
    touch('touchstart', target, y);
    act(() => {
      vi.advanceTimersByTime(HOME_WINDOW_LONG_PRESS_MS + 10);
    });
  };

  const settle = () =>
    act(() => {
      vi.advanceTimersByTime(1000);
    });

  it('folds the windows into strips on a long press of a background', () => {
    const { getByTestId } = renderStack();
    longPress(getByTestId('text-status'), 760);
    expect(strips()).toHaveLength(IDS.length + 1);
    expect(scroller.style.overflowY).toBe('hidden');
    touch('touchend', getByTestId('text-status'), 760);
    settle();
    expect(strips()).toHaveLength(0);
    expect(scroller.style.overflowY).toBe('');
    // Let go where it lifted: nothing moved.
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('leaves buttons and scrolls alone', () => {
    const { getByTestId } = renderStack();
    longPress(getByTestId('button-status'), 760);
    expect(strips()).toHaveLength(0);
    touch('touchend', getByTestId('button-status'), 760);

    // A press that moves before the long press is a scroll.
    const text = getByTestId('text-account');
    touch('touchstart', text, 400);
    touch('touchmove', text, 380);
    act(() => {
      vi.advanceTimersByTime(HOME_WINDOW_LONG_PRESS_MS + 10);
    });
    expect(strips()).toHaveLength(0);
    touch('touchend', text, 380);
  });

  it('moves the held window to where the finger takes it', () => {
    const { getByTestId } = renderStack();
    const text = getByTestId('text-wallet');
    longPress(text, 500);
    // Up past the others: to the top of the stack.
    for (let y = 480; y >= 0; y -= 40) {
      touch('touchmove', text, y);
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
    touch('touchend', text, 0);
    settle();
    expect(onReorder).toHaveBeenCalledWith([
      'wallet',
      'workspace',
      'account',
      'status',
    ]);
    expect(strips()).toHaveLength(0);
  });

  it('puts a window back where it was when a second finger lands', () => {
    const { getByTestId } = renderStack();
    const text = getByTestId('text-workspace');
    longPress(text, 100);
    for (let y = 120; y <= 700; y += 40) {
      touch('touchmove', text, y);
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
    touch('touchstart', text, 700, 2);
    settle();
    expect(onReorder).not.toHaveBeenCalled();
    expect(strips()).toHaveLength(0);
  });
});
