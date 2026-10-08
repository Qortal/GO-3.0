import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QortinoZoomableBox } from './QortinoZoomableBox';

const touch = (x = 100, y = 100) => ({ clientX: x, clientY: y });

function tap(target: HTMLElement, x = 100, y = 100) {
  fireEvent.touchStart(target, { touches: [touch(x, y)] });
  fireEvent.touchEnd(target, { touches: [] });
}

const scaleOf = (el: HTMLElement) =>
  Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? 1);

describe('QortinoZoomableBox', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (
    onSingleTap = vi.fn(),
    onSwipe = vi.fn(),
    canSwipe?: (direction: 'next' | 'prev') => boolean
  ) => {
    render(
      <QortinoZoomableBox
        onSingleTap={onSingleTap}
        onSwipe={onSwipe}
        canSwipe={canSwipe}
      >
        <div data-testid="page">page</div>
      </QortinoZoomableBox>
    );
    const page = screen.getByTestId('page');
    return { page, content: page.parentElement!, onSingleTap, onSwipe };
  };

  it('stays zoomed after a double tap and the dblclick the browser adds', () => {
    const { page, content } = setup();
    tap(page);
    act(() => vi.advanceTimersByTime(120));
    tap(page);
    // The browser's own events for the same two taps.
    fireEvent.click(page);
    fireEvent.doubleClick(page);
    expect(scaleOf(content)).toBe(2.5);
  });

  it('runs onSingleTap once a tap is not followed by a second', () => {
    const { page, onSingleTap } = setup();
    tap(page);
    fireEvent.click(page);
    expect(onSingleTap).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(320));
    expect(onSingleTap).toHaveBeenCalledTimes(1);
  });

  it('does not run onSingleTap for a double tap', () => {
    const { page, onSingleTap } = setup();
    tap(page);
    act(() => vi.advanceTimersByTime(120));
    tap(page);
    act(() => vi.advanceTimersByTime(1000));
    expect(onSingleTap).not.toHaveBeenCalled();
  });

  it('does not run onSingleTap after a drag', () => {
    const { page, onSingleTap } = setup();
    fireEvent.touchStart(page, { touches: [touch(100, 100)] });
    fireEvent.touchMove(page, { touches: [touch(100, 160)] });
    fireEvent.touchEnd(page, { touches: [] });
    act(() => vi.advanceTimersByTime(1000));
    expect(onSingleTap).not.toHaveBeenCalled();
  });

  it('still zooms on a mouse double click', () => {
    const { page, content, onSingleTap } = setup();
    fireEvent.click(page);
    fireEvent.click(page);
    fireEvent.doubleClick(page);
    expect(scaleOf(content)).toBe(2.5);
    act(() => vi.advanceTimersByTime(1000));
    expect(onSingleTap).not.toHaveBeenCalled();
  });

  const swipe = (target: HTMLElement, fromX: number, toX: number, y = 300) => {
    fireEvent.touchStart(target, { touches: [touch(fromX, y)] });
    fireEvent.touchMove(target, { touches: [touch((fromX + toX) / 2, y)] });
    fireEvent.touchMove(target, { touches: [touch(toX, y)] });
    fireEvent.touchEnd(target, {
      touches: [],
      changedTouches: [touch(toX, y)],
    });
  };

  it('turns to the next page on a swipe left, the previous on a swipe right', async () => {
    const { page, onSwipe, onSingleTap } = setup();
    swipe(page, 300, 120);
    expect(onSwipe).toHaveBeenLastCalledWith('next', expect.any(Promise));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    swipe(page, 100, 290);
    expect(onSwipe).toHaveBeenLastCalledWith('prev', expect.any(Promise));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(onSingleTap).not.toHaveBeenCalled();
  });

  it('slides the old page out, then the new page in once it is drawn', async () => {
    let drawn!: () => void;
    const onSwipe = vi.fn(
      () => new Promise<void>((resolve) => (drawn = resolve))
    );
    const { page, content } = setup(vi.fn(), onSwipe);
    swipe(page, 300, 120);
    // Leaving: faded out, while the next page draws.
    expect(content.style.opacity).toBe('0');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(content.style.opacity).toBe('0');
    await act(async () => {
      drawn();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(content.style.opacity).toBe('1');
    expect(content.style.transform).toContain('translate3d(0px, 0, 0)');
  });

  it('springs back at the last page instead of turning', async () => {
    const onSwipe = vi.fn();
    const { page, content } = setup(vi.fn(), onSwipe, (d) => d === 'prev');
    swipe(page, 300, 120);
    expect(onSwipe).not.toHaveBeenCalled();
    expect(content.style.opacity).toBe('1');
    expect(content.style.transform).toContain('translate3d(0px, 0, 0)');
  });

  it('ignores a short or mostly vertical swipe', () => {
    const { page, onSwipe } = setup();
    swipe(page, 200, 160);
    fireEvent.touchStart(page, { touches: [touch(200, 100)] });
    fireEvent.touchMove(page, { touches: [touch(210, 200)] });
    fireEvent.touchMove(page, { touches: [touch(120, 300)] });
    fireEvent.touchEnd(page, {
      touches: [],
      changedTouches: [touch(120, 300)],
    });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('pans instead of turning the page when zoomed in', () => {
    const { page, onSwipe } = setup();
    tap(page);
    act(() => vi.advanceTimersByTime(120));
    tap(page);
    act(() => vi.advanceTimersByTime(1000));
    swipe(page, 300, 120);
    expect(onSwipe).not.toHaveBeenCalled();
  });
});
